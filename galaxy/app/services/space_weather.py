from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

try:
    import httpx
except Exception:  # pragma: no cover - optional dependency in simulated mode
    httpx = None

from app.services.simulated_environment import generate_simulated_space_weather_snapshot

NOAA_PLANETARY_KP_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"
NOAA_SOLAR_CYCLE_INDICES_URL = "https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _parse_iso_time(value: str | None) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    # NOAA Kp feed commonly uses "YYYY-MM-DD HH:MM:SS.sss".
    raw = raw.replace(" ", "T")
    if raw.endswith("Z"):
        return raw
    return f"{raw}Z"


@dataclass(frozen=True)
class SpaceWeatherRecord:
    f107_sfu: float
    kp_index: float
    source: str
    refreshed_at_utc: str
    kp_time_utc: str | None = None
    f107_time_utc: str | None = None
    kp_history: list[dict[str, object]] | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "f107_sfu": self.f107_sfu,
            "kp_index": self.kp_index,
            "source": self.source,
            "refreshed_at_utc": self.refreshed_at_utc,
            "kp_time_utc": self.kp_time_utc,
            "f107_time_utc": self.f107_time_utc,
            "kp_history": list(self.kp_history or []),
        }


DEFAULT_SPACE_WEATHER = SpaceWeatherRecord(
    f107_sfu=150.0,
    kp_index=3.0,
    source="default_quiet",
    refreshed_at_utc=_utc_now_iso(),
    kp_time_utc=None,
    f107_time_utc=None,
    kp_history=[],
)


class SpaceWeatherService:
    def __init__(
        self,
        timeout_seconds: float = 8.0,
        min_refresh_seconds: float = 300.0,
        forcing_context_provider: Callable[[], dict[str, object]] | None = None,
    ) -> None:
        self._timeout_seconds = max(2.0, float(timeout_seconds))
        self._min_refresh_seconds = max(30.0, float(min_refresh_seconds))
        self._mode = _normalize_forcing_mode(os.getenv("SPACE_WEATHER_MODE") or os.getenv("ENVIRONMENT_FORCING_MODE"))
        self._simulation_seed = str(os.getenv("SIM_SPACE_WEATHER_SEED") or os.getenv("SIM_ENV_SEED") or "galaxy-space-weather-v1")
        self._forcing_context_provider = forcing_context_provider if callable(forcing_context_provider) else None
        self._record = DEFAULT_SPACE_WEATHER
        self._last_refresh_monotonic = 0.0
        self._refresh_lock = asyncio.Lock()

    def current_record(self) -> SpaceWeatherRecord:
        return self._record

    async def refresh_on_startup(self) -> None:
        await self.get_snapshot(force_refresh=True)

    async def get_snapshot(self, force_refresh: bool = False) -> SpaceWeatherRecord:
        now_monotonic = time.monotonic()
        if (
            not force_refresh
            and (now_monotonic - self._last_refresh_monotonic) < self._min_refresh_seconds
        ):
            return self._record

        async with self._refresh_lock:
            now_monotonic = time.monotonic()
            if (
                not force_refresh
                and (now_monotonic - self._last_refresh_monotonic) < self._min_refresh_seconds
            ):
                return self._record

            env_override = self._record_from_env()
            if env_override is not None:
                self._record = env_override
                self._last_refresh_monotonic = now_monotonic
                return self._record

            simulated = self._simulated_record()
            if self._mode == "simulated":
                self._record = simulated
                self._last_refresh_monotonic = now_monotonic
                return self._record

            fetched = await self._fetch_noaa_record()
            if fetched is not None:
                self._record = fetched
            elif self._mode == "hybrid":
                self._record = simulated
            self._last_refresh_monotonic = now_monotonic
            return self._record

    def _record_from_env(self) -> SpaceWeatherRecord | None:
        f107_raw = os.getenv("SPACE_WEATHER_F107_SFU")
        kp_raw = os.getenv("SPACE_WEATHER_KP_INDEX")
        if f107_raw is None and kp_raw is None:
            return None

        f107 = self._record.f107_sfu
        kp = self._record.kp_index
        try:
            if f107_raw is not None:
                f107 = float(f107_raw)
            if kp_raw is not None:
                kp = float(kp_raw)
        except ValueError:
            return None

        return SpaceWeatherRecord(
            f107_sfu=_clamp(f107, 60.0, 300.0),
            kp_index=_clamp(kp, 0.0, 9.0),
            source="env_override",
            refreshed_at_utc=_utc_now_iso(),
            kp_time_utc=None,
            f107_time_utc=None,
            kp_history=[],
        )

    def _simulated_record(self) -> SpaceWeatherRecord:
        forcing_context = self._forcing_context_provider() if self._forcing_context_provider else {}
        scenario = str((forcing_context or {}).get("scenario") or "moderate")
        payload = generate_simulated_space_weather_snapshot(
            seed=self._simulation_seed,
            scenario=scenario,
        )
        return SpaceWeatherRecord(
            f107_sfu=_clamp(float(payload.get("f107_sfu", self._record.f107_sfu)), 60.0, 300.0),
            kp_index=_clamp(float(payload.get("kp_index", self._record.kp_index)), 0.0, 9.0),
            source=str(payload.get("source") or "simulated_space_weather"),
            refreshed_at_utc=str(payload.get("refreshed_at_utc") or _utc_now_iso()),
            kp_time_utc=str(payload.get("kp_time_utc") or ""),
            f107_time_utc=str(payload.get("f107_time_utc") or ""),
            kp_history=list(payload.get("kp_history") or []),
        )

    async def _fetch_noaa_record(self) -> SpaceWeatherRecord | None:
        if httpx is None:
            return None
        timeout = httpx.Timeout(self._timeout_seconds)
        headers = {"User-Agent": "galaxy-sim/1.0 (space-weather)"}

        try:
            async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
                kp_task = client.get(NOAA_PLANETARY_KP_URL)
                f107_task = client.get(NOAA_SOLAR_CYCLE_INDICES_URL)
                kp_response, f107_response = await asyncio.gather(kp_task, f107_task)
                kp_response.raise_for_status()
                f107_response.raise_for_status()
                kp_payload = kp_response.json()
                f107_payload = f107_response.json()
        except Exception:
            return None

        kp_value, kp_time_utc, kp_history = self._parse_planetary_kp(kp_payload)
        f107_value, f107_time_utc = self._parse_observed_f107(f107_payload)
        if kp_value is None and f107_value is None:
            return None

        return SpaceWeatherRecord(
            f107_sfu=_clamp(
                f107_value if f107_value is not None else self._record.f107_sfu,
                60.0,
                300.0,
            ),
            kp_index=_clamp(
                kp_value if kp_value is not None else self._record.kp_index,
                0.0,
                9.0,
            ),
            source="noaa_swpc",
            refreshed_at_utc=_utc_now_iso(),
            kp_time_utc=kp_time_utc,
            f107_time_utc=f107_time_utc,
            kp_history=kp_history,
        )

    def _parse_planetary_kp(self, payload: object) -> tuple[float | None, str | None, list[dict[str, object]]]:
        if not isinstance(payload, list):
            return (None, None, [])

        history: list[dict[str, object]] = []
        latest_value: float | None = None
        latest_time_utc: str | None = None
        for row in reversed(payload):
            if not isinstance(row, list) or len(row) < 2:
                continue
            try:
                kp_value = float(row[1])
            except (TypeError, ValueError):
                continue
            if not (kp_value >= 0):
                continue
            kp_time_utc = _parse_iso_time(str(row[0]) if len(row) > 0 else None)
            if latest_value is None:
                latest_value = kp_value
                latest_time_utc = kp_time_utc
            if len(history) < 8:
                history.append(
                    {
                        "time_utc": kp_time_utc or "",
                        "kp": _clamp(kp_value, 0.0, 9.0),
                    }
                )
            else:
                break
        return (latest_value, latest_time_utc, history)

    def _parse_observed_f107(self, payload: object) -> tuple[float | None, str | None]:
        if not isinstance(payload, list):
            return (None, None)

        for row in reversed(payload):
            if not isinstance(row, dict):
                continue
            try:
                f107_value = float(row.get("f10.7"))
            except (TypeError, ValueError):
                continue
            if not (f107_value > 0):
                continue
            time_tag = str(row.get("time-tag") or "").strip()
            f107_time_utc = f"{time_tag}-01T00:00:00Z" if time_tag else None
            return (f107_value, f107_time_utc)
        return (None, None)


def _normalize_forcing_mode(value: str | None) -> str:
    mode = str(value or "").strip().lower()
    if mode in {"live", "api", "network"}:
        return "live"
    if mode in {"hybrid", "auto"}:
        return "hybrid"
    return "simulated"
