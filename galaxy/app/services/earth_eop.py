from __future__ import annotations

import asyncio
import csv
import io
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

try:
    import httpx
except Exception:  # pragma: no cover - optional dependency in simulated mode
    httpx = None

from app.services.simulated_environment import generate_simulated_earth_eop_snapshot

CELESTRAK_EOP_LAST5Y_URL = "https://celestrak.org/spacedata/EOP-Last5Years.csv"
CELESTRAK_EOP_ALL_URL = "https://celestrak.org/spacedata/EOP-All.csv"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _finite_float(value: object, fallback: float | None = None) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return fallback
    if numeric != numeric:  # NaN
        return fallback
    return numeric


def _unix_to_mjd(unix_seconds: float) -> float:
    return (float(unix_seconds) / 86400.0) + 40587.0


def _mjd_to_iso(mjd: float) -> str:
    unix_seconds = (float(mjd) - 40587.0) * 86400.0
    return datetime.fromtimestamp(unix_seconds, timezone.utc).isoformat()


def _normalize_header(value: str) -> str:
    raw = str(value or "").strip().lower()
    return "".join(ch for ch in raw if ch.isalnum())


@dataclass(frozen=True)
class EarthEopRecord:
    mjd: float
    x_arcsec: float
    y_arcsec: float
    ut1_utc_sec: float
    lod_sec: float | None = None
    data_type: str = ""
    time_utc: str = ""

    def to_dict(self) -> dict[str, object]:
        return {
            "mjd": self.mjd,
            "x_arcsec": self.x_arcsec,
            "y_arcsec": self.y_arcsec,
            "ut1_utc_sec": self.ut1_utc_sec,
            "lod_sec": self.lod_sec,
            "data_type": self.data_type,
            "time_utc": self.time_utc,
        }


@dataclass(frozen=True)
class EarthEopSnapshot:
    source: str
    refreshed_at_utc: str
    records: list[EarthEopRecord]

    def to_dict(self) -> dict[str, object]:
        return {
            "source": self.source,
            "refreshed_at_utc": self.refreshed_at_utc,
            "count": len(self.records),
            "records": [record.to_dict() for record in self.records],
        }


DEFAULT_EOP_SNAPSHOT = EarthEopSnapshot(
    source="default_empty",
    refreshed_at_utc=_utc_now_iso(),
    records=[],
)


class EarthEopService:
    def __init__(
        self,
        timeout_seconds: float = 10.0,
        min_refresh_seconds: float = 6 * 3600.0,
        max_records: int = 2200,
        forcing_context_provider: Callable[[], dict[str, object]] | None = None,
    ) -> None:
        self._timeout_seconds = max(2.0, float(timeout_seconds))
        self._min_refresh_seconds = max(60.0, float(min_refresh_seconds))
        self._max_records = max(100, int(max_records))
        self._mode = _normalize_forcing_mode(os.getenv("EARTH_EOP_MODE") or os.getenv("ENVIRONMENT_FORCING_MODE"))
        self._simulation_seed = str(os.getenv("SIM_EARTH_EOP_SEED") or os.getenv("SIM_ENV_SEED") or "galaxy-earth-eop-v1")
        self._forcing_context_provider = forcing_context_provider if callable(forcing_context_provider) else None
        self._snapshot = DEFAULT_EOP_SNAPSHOT
        self._last_refresh_monotonic = 0.0
        self._refresh_lock = asyncio.Lock()

    def current_snapshot(self) -> EarthEopSnapshot:
        return self._snapshot

    async def refresh_on_startup(self) -> None:
        await self.get_snapshot(force_refresh=True)

    async def get_snapshot(self, force_refresh: bool = False) -> EarthEopSnapshot:
        now_monotonic = time.monotonic()
        if (
            not force_refresh
            and (now_monotonic - self._last_refresh_monotonic) < self._min_refresh_seconds
        ):
            return self._snapshot

        async with self._refresh_lock:
            now_monotonic = time.monotonic()
            if (
                not force_refresh
                and (now_monotonic - self._last_refresh_monotonic) < self._min_refresh_seconds
            ):
                return self._snapshot

            env_snapshot = self._snapshot_from_env()
            if env_snapshot is not None:
                self._snapshot = env_snapshot
                self._last_refresh_monotonic = now_monotonic
                return self._snapshot

            simulated = self._simulated_snapshot()
            if self._mode == "simulated":
                self._snapshot = simulated
                self._last_refresh_monotonic = now_monotonic
                return self._snapshot

            fetched = await self._fetch_celestrak_snapshot()
            if fetched is not None:
                self._snapshot = fetched
            elif self._mode == "hybrid":
                self._snapshot = simulated
            self._last_refresh_monotonic = now_monotonic
            return self._snapshot

    def _snapshot_from_env(self) -> EarthEopSnapshot | None:
        ut1_raw = os.getenv("EARTH_EOP_UT1_UTC_SEC")
        x_raw = os.getenv("EARTH_EOP_X_ARCSEC")
        y_raw = os.getenv("EARTH_EOP_Y_ARCSEC")
        lod_raw = os.getenv("EARTH_EOP_LOD_SEC")
        if ut1_raw is None and x_raw is None and y_raw is None:
            return None

        ut1 = _finite_float(ut1_raw, 0.0)
        x_arcsec = _finite_float(x_raw, 0.0)
        y_arcsec = _finite_float(y_raw, 0.0)
        lod_sec = _finite_float(lod_raw, None)
        if ut1 is None or x_arcsec is None or y_arcsec is None:
            return None

        now_unix = time.time()
        record = EarthEopRecord(
            mjd=_unix_to_mjd(now_unix),
            x_arcsec=x_arcsec,
            y_arcsec=y_arcsec,
            ut1_utc_sec=ut1,
            lod_sec=lod_sec,
            data_type="E",
            time_utc=datetime.fromtimestamp(now_unix, timezone.utc).isoformat(),
        )
        return EarthEopSnapshot(
            source="env_override",
            refreshed_at_utc=_utc_now_iso(),
            records=[record],
        )

    def _simulated_snapshot(self) -> EarthEopSnapshot:
        forcing_context = self._forcing_context_provider() if self._forcing_context_provider else {}
        scenario = str((forcing_context or {}).get("scenario") or "moderate")
        payload = generate_simulated_earth_eop_snapshot(
            seed=self._simulation_seed,
            max_records=self._max_records,
            scenario=scenario,
        )
        records: list[EarthEopRecord] = []
        for row in payload.get("records") or []:
            mjd = _finite_float(row.get("mjd"))
            x_arcsec = _finite_float(row.get("x_arcsec"))
            y_arcsec = _finite_float(row.get("y_arcsec"))
            ut1_utc_sec = _finite_float(row.get("ut1_utc_sec"))
            if mjd is None or x_arcsec is None or y_arcsec is None or ut1_utc_sec is None:
                continue
            lod_sec = _finite_float(row.get("lod_sec"))
            records.append(
                EarthEopRecord(
                    mjd=mjd,
                    x_arcsec=x_arcsec,
                    y_arcsec=y_arcsec,
                    ut1_utc_sec=ut1_utc_sec,
                    lod_sec=lod_sec,
                    data_type=str(row.get("data_type") or "").strip(),
                    time_utc=str(row.get("time_utc") or _mjd_to_iso(mjd)),
                )
            )
        if not records:
            return DEFAULT_EOP_SNAPSHOT
        records.sort(key=lambda entry: entry.mjd)
        if len(records) > self._max_records:
            records = records[-self._max_records :]
        return EarthEopSnapshot(
            source=str(payload.get("source") or "simulated_earth_eop"),
            refreshed_at_utc=str(payload.get("refreshed_at_utc") or _utc_now_iso()),
            records=records,
        )

    async def _fetch_celestrak_snapshot(self) -> EarthEopSnapshot | None:
        if httpx is None:
            return None
        timeout = httpx.Timeout(self._timeout_seconds)
        headers = {"User-Agent": "galaxy-sim/1.0 (earth-eop)"}
        urls = [CELESTRAK_EOP_LAST5Y_URL, CELESTRAK_EOP_ALL_URL]

        async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
            for url in urls:
                try:
                    response = await client.get(url)
                    response.raise_for_status()
                    text = response.text
                except Exception:
                    continue
                snapshot = self._parse_celestrak_csv(text)
                if snapshot is not None:
                    return snapshot
        return None

    def _parse_celestrak_csv(self, text: str) -> EarthEopSnapshot | None:
        if not text or "," not in text:
            return None

        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            return None
        headers = {_normalize_header(name): name for name in reader.fieldnames}
        mjd_key = headers.get("mjd")
        x_key = headers.get("x")
        y_key = headers.get("y")
        ut1_key = headers.get("ut1utc")
        lod_key = headers.get("lod")
        data_type_key = headers.get("datatype")
        if not mjd_key or not x_key or not y_key or not ut1_key:
            return None

        records: list[EarthEopRecord] = []
        for row in reader:
            mjd = _finite_float(row.get(mjd_key))
            x_arcsec = _finite_float(row.get(x_key))
            y_arcsec = _finite_float(row.get(y_key))
            ut1_utc_sec = _finite_float(row.get(ut1_key))
            if mjd is None or x_arcsec is None or y_arcsec is None or ut1_utc_sec is None:
                continue
            lod_sec = _finite_float(row.get(lod_key)) if lod_key else None
            data_type = str(row.get(data_type_key) or "").strip() if data_type_key else ""
            records.append(
                EarthEopRecord(
                    mjd=mjd,
                    x_arcsec=x_arcsec,
                    y_arcsec=y_arcsec,
                    ut1_utc_sec=ut1_utc_sec,
                    lod_sec=lod_sec,
                    data_type=data_type,
                    time_utc=_mjd_to_iso(mjd),
                )
            )

        if not records:
            return None

        records.sort(key=lambda entry: entry.mjd)
        now_mjd = _unix_to_mjd(time.time())
        filtered = [entry for entry in records if abs(entry.mjd - now_mjd) <= 1500]
        if not filtered:
            filtered = records[-self._max_records :]
        if len(filtered) > self._max_records:
            filtered = filtered[-self._max_records :]

        return EarthEopSnapshot(
            source="celestrak_eop_csv",
            refreshed_at_utc=_utc_now_iso(),
            records=filtered,
        )


def _normalize_forcing_mode(value: str | None) -> str:
    mode = str(value or "").strip().lower()
    if mode in {"live", "api", "network"}:
        return "live"
    if mode in {"hybrid", "auto"}:
        return "hybrid"
    return "simulated"
