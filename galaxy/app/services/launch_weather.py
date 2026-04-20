from __future__ import annotations

import asyncio
import math
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

try:
    import httpx
except Exception:  # pragma: no cover - optional dependency in simulated mode
    httpx = None


WEATHER_GOV_POINTS_URL = "https://api.weather.gov/points/{latitude:.4f},{longitude:.4f}"

_CARDINAL_DIRECTION_DEG = {
    "N": 0.0,
    "NNE": 22.5,
    "NE": 45.0,
    "ENE": 67.5,
    "E": 90.0,
    "ESE": 112.5,
    "SE": 135.0,
    "SSE": 157.5,
    "S": 180.0,
    "SSW": 202.5,
    "SW": 225.0,
    "WSW": 247.5,
    "W": 270.0,
    "WNW": 292.5,
    "NW": 315.0,
    "NNW": 337.5,
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _normalize_mode(value: str | None) -> str:
    mode = str(value or "").strip().lower()
    if mode in {"live", "api", "network"}:
        return "live"
    if mode in {"hybrid", "auto"}:
        return "hybrid"
    return "simulated"


def _parse_iso_time(value: object) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        return raw
    if "+" in raw or raw.rfind("-") > 9:
        return raw
    return f"{raw}Z"


def _direction_deg_from_string(value: object) -> float | None:
    raw = str(value or "").strip().upper()
    if not raw:
        return None
    if raw in _CARDINAL_DIRECTION_DEG:
        return _CARDINAL_DIRECTION_DEG[raw]
    match = re.search(r"-?\d+(?:\.\d+)?", raw)
    if not match:
        return None
    return float(match.group(0)) % 360.0


def _wind_speed_m_s_from_string(value: object) -> float | None:
    raw = str(value or "").strip().lower()
    if not raw:
        return None
    samples = [float(token) for token in re.findall(r"-?\d+(?:\.\d+)?", raw)]
    if not samples:
        return None
    scalar = sum(samples) / len(samples)
    if "kt" in raw or "knot" in raw:
        return scalar * 0.514444
    if "km/h" in raw or "kph" in raw:
        return scalar / 3.6
    return scalar * 0.44704


def _temperature_c_from_value(value: object, unit: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    unit_norm = str(unit or "").strip().upper()
    if unit_norm == "F":
        return (numeric - 32.0) * (5.0 / 9.0)
    return numeric


@dataclass(frozen=True)
class LaunchWeatherRecord:
    site_name: str
    latitude_deg: float
    longitude_deg: float
    temperature_c: float | None
    relative_humidity: float | None
    wind_speed_m_s: float | None
    wind_direction_deg: float | None
    wind_gust_m_s: float | None
    source: str
    refreshed_at_utc: str
    valid_time_utc: str | None = None
    short_forecast: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "site_name": self.site_name,
            "latitude_deg": self.latitude_deg,
            "longitude_deg": self.longitude_deg,
            "temperature_c": self.temperature_c,
            "relative_humidity": self.relative_humidity,
            "wind_speed_m_s": self.wind_speed_m_s,
            "wind_direction_deg": self.wind_direction_deg,
            "wind_gust_m_s": self.wind_gust_m_s,
            "source": self.source,
            "refreshed_at_utc": self.refreshed_at_utc,
            "valid_time_utc": self.valid_time_utc,
            "short_forecast": self.short_forecast,
        }


DEFAULT_LAUNCH_WEATHER = LaunchWeatherRecord(
    site_name="Launch Site",
    latitude_deg=28.5618571,
    longitude_deg=-80.577366,
    temperature_c=27.0,
    relative_humidity=0.72,
    wind_speed_m_s=5.0,
    wind_direction_deg=110.0,
    wind_gust_m_s=None,
    source="default_static",
    refreshed_at_utc=_utc_now_iso(),
    valid_time_utc=None,
    short_forecast="Default launch weather",
)


class LaunchWeatherService:
    def __init__(
        self,
        timeout_seconds: float = 8.0,
        min_refresh_seconds: float = 300.0,
        mode: str | None = None,
        launch_site_provider: Callable[[], object] | None = None,
        forcing_context_provider: Callable[[], dict[str, object]] | None = None,
    ) -> None:
        self._timeout_seconds = max(2.0, float(timeout_seconds))
        self._min_refresh_seconds = max(30.0, float(min_refresh_seconds))
        self._mode = _normalize_mode(
            mode or os.getenv("LAUNCH_WEATHER_MODE") or os.getenv("ENVIRONMENT_FORCING_MODE")
        )
        self._launch_site_provider = launch_site_provider if callable(launch_site_provider) else None
        self._forcing_context_provider = forcing_context_provider if callable(forcing_context_provider) else None
        self._record = DEFAULT_LAUNCH_WEATHER
        self._last_refresh_monotonic = 0.0
        self._refresh_lock = asyncio.Lock()
        self._site_key = self._site_key_for(
            DEFAULT_LAUNCH_WEATHER.latitude_deg,
            DEFAULT_LAUNCH_WEATHER.longitude_deg,
            DEFAULT_LAUNCH_WEATHER.site_name,
        )

    def current_record(self) -> LaunchWeatherRecord:
        return self._record

    async def refresh_on_startup(self) -> None:
        site = self._resolved_site()
        await self.get_snapshot(
            latitude_deg=site["latitude_deg"],
            longitude_deg=site["longitude_deg"],
            site_name=site["site_name"],
            force_refresh=True,
        )

    async def get_snapshot(
        self,
        latitude_deg: float | None = None,
        longitude_deg: float | None = None,
        site_name: str | None = None,
        force_refresh: bool = False,
    ) -> LaunchWeatherRecord:
        requested = self._resolved_site(latitude_deg, longitude_deg, site_name)
        requested_key = self._site_key_for(
            requested["latitude_deg"],
            requested["longitude_deg"],
            requested["site_name"],
        )
        now_monotonic = time.monotonic()
        if (
            not force_refresh
            and requested_key == self._site_key
            and (now_monotonic - self._last_refresh_monotonic) < self._min_refresh_seconds
        ):
            return self._record

        async with self._refresh_lock:
            now_monotonic = time.monotonic()
            if (
                not force_refresh
                and requested_key == self._site_key
                and (now_monotonic - self._last_refresh_monotonic) < self._min_refresh_seconds
            ):
                return self._record

            env_override = self._record_from_env(requested)
            if env_override is not None:
                self._record = env_override
                self._site_key = requested_key
                self._last_refresh_monotonic = now_monotonic
                return self._record

            simulated = self._simulated_record(requested)
            if self._mode == "simulated":
                self._record = simulated
                self._site_key = requested_key
                self._last_refresh_monotonic = now_monotonic
                return self._record

            fetched = await self._fetch_weather_gov_record(requested)
            if fetched is not None:
                self._record = fetched
            elif self._mode == "hybrid":
                self._record = simulated

            self._site_key = requested_key
            self._last_refresh_monotonic = now_monotonic
            return self._record

    def _resolved_site(
        self,
        latitude_deg: float | None = None,
        longitude_deg: float | None = None,
        site_name: str | None = None,
    ) -> dict[str, object]:
        if latitude_deg is not None and longitude_deg is not None:
            lat = _clamp(float(latitude_deg), -90.0, 90.0)
            lon = ((float(longitude_deg) + 180.0) % 360.0) - 180.0
            name = str(site_name or DEFAULT_LAUNCH_WEATHER.site_name).strip() or DEFAULT_LAUNCH_WEATHER.site_name
            return {
                "latitude_deg": lat,
                "longitude_deg": lon,
                "site_name": name,
            }
        site = self._launch_site_provider() if self._launch_site_provider else None
        if site is not None:
            lat = float(getattr(site, "latitude_deg", getattr(site, "latitude", DEFAULT_LAUNCH_WEATHER.latitude_deg)))
            lon = float(getattr(site, "longitude_deg", getattr(site, "longitude", DEFAULT_LAUNCH_WEATHER.longitude_deg)))
            name = str(getattr(site, "name", DEFAULT_LAUNCH_WEATHER.site_name)).strip() or DEFAULT_LAUNCH_WEATHER.site_name
            return {
                "latitude_deg": _clamp(lat, -90.0, 90.0),
                "longitude_deg": ((lon + 180.0) % 360.0) - 180.0,
                "site_name": name,
            }
        return {
            "latitude_deg": DEFAULT_LAUNCH_WEATHER.latitude_deg,
            "longitude_deg": DEFAULT_LAUNCH_WEATHER.longitude_deg,
            "site_name": DEFAULT_LAUNCH_WEATHER.site_name,
        }

    def _site_key_for(self, latitude_deg: float, longitude_deg: float, site_name: str) -> str:
        return f"{round(latitude_deg, 3)}:{round(longitude_deg, 3)}:{site_name.strip().lower()}"

    def _record_from_env(self, site: dict[str, object]) -> LaunchWeatherRecord | None:
        temp_raw = os.getenv("LAUNCH_WEATHER_TEMPERATURE_C")
        rh_raw = os.getenv("LAUNCH_WEATHER_RELATIVE_HUMIDITY")
        wind_speed_raw = os.getenv("LAUNCH_WEATHER_WIND_SPEED_MS")
        wind_dir_raw = os.getenv("LAUNCH_WEATHER_WIND_DIRECTION_DEG")
        if temp_raw is None and rh_raw is None and wind_speed_raw is None and wind_dir_raw is None:
            return None

        try:
            temp_c = float(temp_raw) if temp_raw is not None else self._record.temperature_c
            rh = float(rh_raw) if rh_raw is not None else self._record.relative_humidity
            wind_speed = float(wind_speed_raw) if wind_speed_raw is not None else self._record.wind_speed_m_s
            wind_dir = float(wind_dir_raw) if wind_dir_raw is not None else self._record.wind_direction_deg
        except ValueError:
            return None

        return LaunchWeatherRecord(
            site_name=str(site["site_name"]),
            latitude_deg=float(site["latitude_deg"]),
            longitude_deg=float(site["longitude_deg"]),
            temperature_c=None if temp_c is None else _clamp(float(temp_c), -80.0, 60.0),
            relative_humidity=None if rh is None else _clamp(float(rh), 0.0, 1.0),
            wind_speed_m_s=None if wind_speed is None else _clamp(float(wind_speed), 0.0, 120.0),
            wind_direction_deg=None if wind_dir is None else (float(wind_dir) % 360.0),
            wind_gust_m_s=None,
            source="env_override",
            refreshed_at_utc=_utc_now_iso(),
            valid_time_utc=None,
            short_forecast="Environment override",
        )

    def _simulated_record(self, site: dict[str, object]) -> LaunchWeatherRecord:
        forcing_context = self._forcing_context_provider() if self._forcing_context_provider else {}
        scenario = str((forcing_context or {}).get("scenario") or "moderate").strip().lower() or "moderate"
        now = datetime.now(timezone.utc)
        doy_phase = (2.0 * math.pi * now.timetuple().tm_yday) / 365.25
        time_phase = (2.0 * math.pi * (now.hour + (now.minute / 60.0))) / 24.0
        latitude = float(site["latitude_deg"])
        coastal_bias = math.cos(math.radians(latitude))
        scenario_wind_gain = {
            "quiet": 0.70,
            "moderate": 1.0,
            "storm": 1.45,
            "extreme": 2.0,
        }.get(scenario, 1.0)
        scenario_temp_bias = {
            "quiet": -1.0,
            "moderate": 0.0,
            "storm": 1.8,
            "extreme": 3.5,
        }.get(scenario, 0.0)
        scenario_rh_bias = {
            "quiet": -0.05,
            "moderate": 0.0,
            "storm": 0.08,
            "extreme": 0.12,
        }.get(scenario, 0.0)
        temperature_c = 26.0 + (4.5 * coastal_bias) + (3.0 * math.sin(time_phase - 1.2)) + (1.8 * math.sin(doy_phase)) + scenario_temp_bias
        relative_humidity = 0.70 + (0.08 * math.cos(time_phase + 0.4)) - (0.04 * math.sin(doy_phase)) + scenario_rh_bias
        wind_speed_m_s = (4.8 + (2.0 * coastal_bias) + (1.4 * math.sin(time_phase + 0.8))) * scenario_wind_gain
        wind_direction_deg = (105.0 + (28.0 * math.sin(doy_phase + 0.5)) + (12.0 * math.sin(time_phase - 0.6))) % 360.0
        return LaunchWeatherRecord(
            site_name=str(site["site_name"]),
            latitude_deg=float(site["latitude_deg"]),
            longitude_deg=float(site["longitude_deg"]),
            temperature_c=_clamp(temperature_c, -40.0, 45.0),
            relative_humidity=_clamp(relative_humidity, 0.15, 0.99),
            wind_speed_m_s=_clamp(wind_speed_m_s, 0.0, 45.0),
            wind_direction_deg=wind_direction_deg,
            wind_gust_m_s=None,
            source=f"simulated_launch_weather:{scenario}",
            refreshed_at_utc=_utc_now_iso(),
            valid_time_utc=now.isoformat(),
            short_forecast="Simulated launch-site weather",
        )

    async def _fetch_weather_gov_record(self, site: dict[str, object]) -> LaunchWeatherRecord | None:
        if httpx is None:
            return None
        headers = {"User-Agent": "galaxy-sim/1.0 (launch-weather)"}
        timeout = httpx.Timeout(self._timeout_seconds)
        latitude = float(site["latitude_deg"])
        longitude = float(site["longitude_deg"])
        try:
            async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
                points_response = await client.get(
                    WEATHER_GOV_POINTS_URL.format(latitude=latitude, longitude=longitude),
                )
                points_response.raise_for_status()
                points_payload = points_response.json()
                hourly_url = (
                    points_payload.get("properties", {}).get("forecastHourly")
                    if isinstance(points_payload, dict)
                    else None
                )
                if not isinstance(hourly_url, str) or not hourly_url.strip():
                    return None
                forecast_response = await client.get(hourly_url.strip())
                forecast_response.raise_for_status()
                forecast_payload = forecast_response.json()
        except Exception:
            return None

        periods = []
        if isinstance(forecast_payload, dict):
            periods = forecast_payload.get("properties", {}).get("periods", [])
        if not isinstance(periods, list) or len(periods) <= 0:
            return None

        now_utc = datetime.now(timezone.utc).timestamp()
        selected = None
        for period in periods:
            if not isinstance(period, dict):
                continue
            end_time_raw = _parse_iso_time(period.get("endTime"))
            end_timestamp = datetime.fromisoformat(end_time_raw.replace("Z", "+00:00")).timestamp() if end_time_raw else None
            if end_timestamp is None or end_timestamp >= now_utc:
                selected = period
                break
        if selected is None:
            selected = periods[0] if isinstance(periods[0], dict) else None
        if selected is None:
            return None
        return self._record_from_weather_gov_period(selected, latitude, longitude, str(site["site_name"]))

    def _record_from_weather_gov_period(
        self,
        period: dict[str, object],
        latitude_deg: float,
        longitude_deg: float,
        site_name: str,
    ) -> LaunchWeatherRecord | None:
        temperature_c = _temperature_c_from_value(period.get("temperature"), period.get("temperatureUnit"))
        rh_raw = None
        if isinstance(period.get("relativeHumidity"), dict):
            rh_raw = period["relativeHumidity"].get("value")
        relative_humidity = None
        try:
            if rh_raw is not None:
                relative_humidity = _clamp(float(rh_raw) / 100.0, 0.0, 1.0)
        except (TypeError, ValueError):
            relative_humidity = None
        wind_speed_m_s = _wind_speed_m_s_from_string(period.get("windSpeed"))
        wind_direction_deg = _direction_deg_from_string(period.get("windDirection"))
        valid_time_utc = _parse_iso_time(period.get("startTime"))
        short_forecast = str(period.get("shortForecast") or "").strip() or None
        if temperature_c is None and relative_humidity is None and wind_speed_m_s is None and wind_direction_deg is None:
            return None
        return LaunchWeatherRecord(
            site_name=site_name,
            latitude_deg=latitude_deg,
            longitude_deg=longitude_deg,
            temperature_c=temperature_c,
            relative_humidity=relative_humidity,
            wind_speed_m_s=wind_speed_m_s,
            wind_direction_deg=wind_direction_deg,
            wind_gust_m_s=None,
            source="weather_gov_hourly",
            refreshed_at_utc=_utc_now_iso(),
            valid_time_utc=valid_time_utc,
            short_forecast=short_forecast,
        )

