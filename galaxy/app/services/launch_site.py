from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_QUERIES = (
    "SpaceX Starbase, Cameron County, Texas, USA",
    "Starbase Launch Site, Boca Chica Boulevard, Starbase, Cameron County, Texas, USA",
    "Starbase, Cameron County, Texas, USA",
)


@dataclass(frozen=True)
class LaunchSiteRecord:
    name: str
    latitude_deg: float
    longitude_deg: float
    altitude_km: float
    source: str
    refreshed_at_utc: str

    def to_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "latitude_deg": self.latitude_deg,
            "longitude_deg": self.longitude_deg,
            "altitude_km": self.altitude_km,
            "source": self.source,
            "refreshed_at_utc": self.refreshed_at_utc,
        }


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


DEFAULT_LAUNCH_SITE = LaunchSiteRecord(
    name="Starbase, TX (Boca Chica Launch Site)",
    latitude_deg=25.9968983,
    longitude_deg=-97.1547571,
    altitude_km=0.0,
    source="default_static",
    refreshed_at_utc=_utc_now_iso(),
)


class LaunchSiteService:
    def __init__(self, timeout_seconds: float = 5.0) -> None:
        self._timeout_seconds = max(1.0, float(timeout_seconds))
        self._site = DEFAULT_LAUNCH_SITE

    def current_site(self) -> LaunchSiteRecord:
        return self._site

    async def refresh_on_startup(self) -> None:
        env_site = self._site_from_env()
        if env_site is not None:
            self._site = env_site
            return

        fetched = await self._fetch_starbase_coordinates()
        if fetched is not None:
            self._site = fetched
            return

        self._site = LaunchSiteRecord(
            name=DEFAULT_LAUNCH_SITE.name,
            latitude_deg=DEFAULT_LAUNCH_SITE.latitude_deg,
            longitude_deg=DEFAULT_LAUNCH_SITE.longitude_deg,
            altitude_km=DEFAULT_LAUNCH_SITE.altitude_km,
            source="default_static_fallback",
            refreshed_at_utc=_utc_now_iso(),
        )

    def _site_from_env(self) -> LaunchSiteRecord | None:
        lat_raw = os.getenv("LAUNCH_SITE_LATITUDE_DEG")
        lon_raw = os.getenv("LAUNCH_SITE_LONGITUDE_DEG")
        if lat_raw is None or lon_raw is None:
            return None
        try:
            lat = float(lat_raw)
            lon = float(lon_raw)
        except ValueError:
            return None
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return None

        name = (os.getenv("LAUNCH_SITE_NAME") or DEFAULT_LAUNCH_SITE.name).strip() or DEFAULT_LAUNCH_SITE.name
        try:
            altitude_km = float(os.getenv("LAUNCH_SITE_ALTITUDE_KM") or DEFAULT_LAUNCH_SITE.altitude_km)
        except ValueError:
            altitude_km = DEFAULT_LAUNCH_SITE.altitude_km
        altitude_km = max(-1.0, min(20.0, altitude_km))

        return LaunchSiteRecord(
            name=name,
            latitude_deg=lat,
            longitude_deg=lon,
            altitude_km=altitude_km,
            source="env_override",
            refreshed_at_utc=_utc_now_iso(),
        )

    async def _fetch_starbase_coordinates(self) -> LaunchSiteRecord | None:
        headers = {
            "User-Agent": "galaxy-sim/1.0 (local startup geocode)",
        }
        timeout = httpx.Timeout(self._timeout_seconds)
        async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
            for query in NOMINATIM_QUERIES:
                try:
                    response = await client.get(
                        NOMINATIM_URL,
                        params={
                            "q": query,
                            "format": "jsonv2",
                            "limit": 1,
                        },
                    )
                    response.raise_for_status()
                    payload = response.json()
                except Exception:
                    continue
                if not isinstance(payload, list) or not payload:
                    continue
                entry = payload[0] if isinstance(payload[0], dict) else None
                if entry is None:
                    continue
                try:
                    lat = float(entry.get("lat"))
                    lon = float(entry.get("lon"))
                except (TypeError, ValueError):
                    continue
                if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                    continue
                display_name = str(entry.get("display_name") or "").strip()
                name = display_name if display_name else DEFAULT_LAUNCH_SITE.name
                return LaunchSiteRecord(
                    name=name,
                    latitude_deg=lat,
                    longitude_deg=lon,
                    altitude_km=DEFAULT_LAUNCH_SITE.altitude_km,
                    source="nominatim_startup",
                    refreshed_at_utc=_utc_now_iso(),
                )
        return None
