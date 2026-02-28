from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from app.services.catalog import BODY_BY_ID, BODY_DEFINITIONS, BodyDefinition
from app.services.horizons import HorizonsClient, HorizonsError, HorizonsVector

AU_IN_KM = 149_597_870.7
SUN_CENTER_CODE = "500@10"


@dataclass
class CacheEntry:
    expires_at_epoch: float
    payload: dict[str, Any]


class SolarSystemService:
    def __init__(
        self,
        horizons_client: HorizonsClient,
        cache_ttl_seconds: int = 30,
    ) -> None:
        self._horizons = horizons_client
        self._cache_ttl_seconds = cache_ttl_seconds
        self._cache: dict[tuple[int, bool], CacheEntry] = {}
        self._last_horizons_positions: dict[str, tuple[float, float, float]] = {}
        self._last_horizons_velocities: dict[str, tuple[float, float, float]] = {}

    def list_bodies(self, include_moons: bool = True) -> list[dict[str, Any]]:
        return [body.to_dict() for body in self._filter_bodies(include_moons)]

    async def get_positions(
        self,
        at: datetime | None = None,
        include_moons: bool = True,
    ) -> dict[str, Any]:
        at_utc = (at or datetime.now(timezone.utc)).astimezone(timezone.utc)
        slot = int(at_utc.timestamp() // self._cache_ttl_seconds)
        cache_key = (slot, include_moons)
        now_epoch = datetime.now(timezone.utc).timestamp()
        cached = self._cache.get(cache_key)
        if at is None and cached and cached.expires_at_epoch > now_epoch:
            return cached.payload

        bodies = self._filter_bodies(include_moons)
        body_positions: dict[str, tuple[float, float, float]] = {"sun": (0.0, 0.0, 0.0)}
        body_velocities: dict[str, tuple[float, float, float]] = {"sun": (0.0, 0.0, 0.0)}
        source_by_id: dict[str, str] = {"sun": "DEFINED_ORIGIN"}
        errors_by_id: dict[str, str] = {}

        # Always fetch live planet vectors from Horizons.
        targets = [body for body in bodies if body.body_type == "planet" and body.id != "sun" and body.command]
        vectors = await asyncio.gather(
            *(self._horizons.fetch_heliocentric_vector(body.command or "", at_utc) for body in targets),
            return_exceptions=True,
        )
        failed_planet_targets: list[BodyDefinition] = []
        for body, vector in zip(targets, vectors, strict=False):
            if isinstance(vector, Exception):
                cached = self._last_horizons_positions.get(body.id)
                if cached is not None:
                    body_positions[body.id] = cached
                    body_velocities[body.id] = self._last_horizons_velocities.get(body.id, (0.0, 0.0, 0.0))
                    source_by_id[body.id] = "HORIZONS_CACHED"
                else:
                    errors_by_id[body.id] = self._format_source_error(vector)
                    failed_planet_targets.append(body)
                continue
            body_positions[body.id] = vector.position_km
            body_velocities[body.id] = vector.velocity_km_s
            self._last_horizons_positions[body.id] = vector.position_km
            self._last_horizons_velocities[body.id] = vector.velocity_km_s
            source_by_id[body.id] = "HORIZONS"

        # Retry uncached planet failures once, sequentially, to reduce startup
        # fallbacks from transient upstream 5xx/rate-limit responses.
        for body in failed_planet_targets:
            try:
                vector = await self._horizons.fetch_heliocentric_vector(body.command or "", at_utc)
            except Exception as exc:  # noqa: BLE001 - preserve best-known fallback behavior
                errors_by_id[body.id] = self._format_source_error(exc)
                continue
            body_positions[body.id] = vector.position_km
            body_velocities[body.id] = vector.velocity_km_s
            self._last_horizons_positions[body.id] = vector.position_km
            self._last_horizons_velocities[body.id] = vector.velocity_km_s
            source_by_id[body.id] = "HORIZONS"
            errors_by_id.pop(body.id, None)

        if include_moons:
            await self._populate_moon_positions(
                bodies=bodies,
                at_utc=at_utc,
                body_positions=body_positions,
                body_velocities=body_velocities,
                source_by_id=source_by_id,
                errors_by_id=errors_by_id,
            )

        for body in bodies:
            if body.id in body_positions:
                continue
            source_by_id.setdefault(body.id, "UNAVAILABLE")
            errors_by_id.setdefault(body.id, "No live Horizons data and no cached coordinates available.")

        payload = {
            "timestamp_utc": at_utc.isoformat(),
            "frame": "Ecliptic/J2000 heliocentric (km)",
            "center": "sun",
            "bodies": [
                self._build_body_payload(
                    body=body,
                    position=body_positions.get(body.id),
                    velocity=body_velocities.get(body.id),
                    parent_position=body_positions.get(body.parent) if body.parent else None,
                    parent_velocity=body_velocities.get(body.parent) if body.parent else None,
                    source=source_by_id.get(body.id, "UNKNOWN"),
                    error=errors_by_id.get(body.id),
                )
                for body in bodies
            ],
        }

        if at is None:
            self._cache[cache_key] = CacheEntry(
                expires_at_epoch=now_epoch + self._cache_ttl_seconds,
                payload=payload,
            )
        return payload

    async def _populate_moon_positions(
        self,
        bodies: list[BodyDefinition],
        at_utc: datetime,
        body_positions: dict[str, tuple[float, float, float]],
        body_velocities: dict[str, tuple[float, float, float]],
        source_by_id: dict[str, str],
        errors_by_id: dict[str, str],
    ) -> None:
        moon_targets = [body for body in bodies if body.body_type == "moon" and body.command and body.parent]
        if not moon_targets:
            return

        uncached_failed_moons: list[BodyDefinition] = []
        moon_vectors = await asyncio.gather(
            *(
                self._horizons.fetch_vector(
                    command=moon.command or "",
                    at=at_utc,
                    center=self._moon_center_code(moon),
                )
                for moon in moon_targets
            ),
            return_exceptions=True,
        )

        for moon, vector in zip(moon_targets, moon_vectors, strict=False):
            if isinstance(vector, Exception):
                cached = self._last_horizons_positions.get(moon.id)
                if cached is not None:
                    body_positions[moon.id] = cached
                    body_velocities[moon.id] = self._last_horizons_velocities.get(moon.id, (0.0, 0.0, 0.0))
                    source_by_id[moon.id] = "HORIZONS_CACHED"
                    errors_by_id.pop(moon.id, None)
                else:
                    errors_by_id[moon.id] = self._format_source_error(vector)
                    uncached_failed_moons.append(moon)
                continue

            self._apply_moon_vector(
                moon=moon,
                vector=vector,
                body_positions=body_positions,
                body_velocities=body_velocities,
                source_by_id=source_by_id,
                errors_by_id=errors_by_id,
            )

        # Give uncached moon failures extra attempts before marking them
        # unavailable, so first-load moon placement stays as live-accurate as possible.
        for moon in uncached_failed_moons:
            success = False
            last_exc: Exception | None = None
            for _ in range(2):
                try:
                    vector = await self._horizons.fetch_vector(
                        command=moon.command or "",
                        at=at_utc,
                        center=self._moon_center_code(moon),
                    )
                except Exception as exc:  # noqa: BLE001 - preserve stream resilience
                    last_exc = exc
                    await asyncio.sleep(0.2)
                    continue
                success = self._apply_moon_vector(
                    moon=moon,
                    vector=vector,
                    body_positions=body_positions,
                    body_velocities=body_velocities,
                    source_by_id=source_by_id,
                    errors_by_id=errors_by_id,
                )
                if success:
                    break
            if not success and last_exc is not None:
                errors_by_id[moon.id] = self._format_source_error(last_exc)

    @staticmethod
    def _filter_bodies(include_moons: bool) -> list[BodyDefinition]:
        if include_moons:
            return list(BODY_DEFINITIONS)
        return [body for body in BODY_DEFINITIONS if body.body_type != "moon"]

    @staticmethod
    def _moon_center_code(moon: BodyDefinition) -> str:
        parent = BODY_BY_ID.get(moon.parent or "")
        if parent and parent.command:
            return f"500@{parent.command}"
        return SUN_CENTER_CODE

    def _apply_moon_vector(
        self,
        moon: BodyDefinition,
        vector: HorizonsVector,
        body_positions: dict[str, tuple[float, float, float]],
        body_velocities: dict[str, tuple[float, float, float]],
        source_by_id: dict[str, str],
        errors_by_id: dict[str, str],
    ) -> bool:
        parent_id = moon.parent or "sun"
        parent_position = body_positions.get(parent_id)
        if parent_position is None:
            errors_by_id[moon.id] = f"Parent position unavailable for {parent_id}"
            source_by_id.setdefault(moon.id, "UNAVAILABLE")
            return False

        parent_velocity = body_velocities.get(parent_id) or (0.0, 0.0, 0.0)
        rel_x, rel_y, rel_z = vector.position_km
        rel_vx, rel_vy, rel_vz = vector.velocity_km_s
        absolute = (
            parent_position[0] + rel_x,
            parent_position[1] + rel_y,
            parent_position[2] + rel_z,
        )
        absolute_velocity = (
            parent_velocity[0] + rel_vx,
            parent_velocity[1] + rel_vy,
            parent_velocity[2] + rel_vz,
        )
        body_positions[moon.id] = absolute
        body_velocities[moon.id] = absolute_velocity
        self._last_horizons_positions[moon.id] = absolute
        self._last_horizons_velocities[moon.id] = absolute_velocity
        source_by_id[moon.id] = "HORIZONS"
        errors_by_id.pop(moon.id, None)
        return True

    @staticmethod
    def _build_body_payload(
        body: BodyDefinition,
        position: tuple[float, float, float] | None,
        velocity: tuple[float, float, float] | None,
        parent_position: tuple[float, float, float] | None,
        parent_velocity: tuple[float, float, float] | None,
        source: str,
        error: str | None,
    ) -> dict[str, Any]:
        if position is None:
            output = {
                "id": body.id,
                "name": body.name,
                "type": body.body_type,
                "parent": body.parent,
                "coordinates_km": None,
                "coordinates_velocity_km_s": None,
                "distance_from_sun_km": None,
                "distance_from_sun_au": None,
                "source": source,
                "radius_km": body.radius_km,
                "mass_kg": body.mass_kg,
                "orbital_period_days": body.orbital_period_days,
                "semimajor_axis_km": body.semimajor_axis_km,
                "color": body.color,
                "description": body.description,
            }
            if error:
                output["source_error"] = error
            return output

        x, y, z = position
        distance_km = math.sqrt((x * x) + (y * y) + (z * z))
        output = {
            "id": body.id,
            "name": body.name,
            "type": body.body_type,
            "parent": body.parent,
            "coordinates_km": {"x": x, "y": y, "z": z},
            "coordinates_velocity_km_s": (
                {"x": velocity[0], "y": velocity[1], "z": velocity[2]} if velocity is not None else None
            ),
            "distance_from_sun_km": distance_km,
            "distance_from_sun_au": distance_km / AU_IN_KM,
            "source": source,
            "radius_km": body.radius_km,
            "mass_kg": body.mass_kg,
            "orbital_period_days": body.orbital_period_days,
            "semimajor_axis_km": body.semimajor_axis_km,
            "color": body.color,
            "description": body.description,
        }
        if body.parent and parent_position is not None:
            rel_x = x - parent_position[0]
            rel_y = y - parent_position[1]
            rel_z = z - parent_position[2]
            output["coordinates_relative_to_parent_km"] = {
                "x": rel_x,
                "y": rel_y,
                "z": rel_z,
            }
            if velocity is not None and parent_velocity is not None:
                output["coordinates_velocity_relative_to_parent_km_s"] = {
                    "x": velocity[0] - parent_velocity[0],
                    "y": velocity[1] - parent_velocity[1],
                    "z": velocity[2] - parent_velocity[2],
                }
            output["distance_from_parent_km"] = math.sqrt((rel_x * rel_x) + (rel_y * rel_y) + (rel_z * rel_z))
        if error:
            output["source_error"] = error
        return output

    @staticmethod
    def _format_source_error(error: Exception | str) -> str:
        message = str(error).replace("\n", " ").strip()
        if "INPUT ERROR" in message:
            message = message[message.find("INPUT ERROR") :]
            for separator in (";", " LINE=", " WLDINI", " BATVAR"):
                if separator in message:
                    message = message.split(separator, 1)[0].strip()
                    break
        if "for url" in message:
            message = message.split("for url", 1)[0].strip()
        return message[:140]


def create_default_service() -> SolarSystemService:
    return SolarSystemService(
        horizons_client=HorizonsClient(),
        cache_ttl_seconds=1,
    )
