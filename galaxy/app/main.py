from __future__ import annotations

import asyncio
import os
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.services.launch_site import LaunchSiteService
from app.services.physics_lock import PhysicsLockError, validate_catalog_lock
from app.services.earth_eop import EarthEopService
from app.services.environment_forcing import (
    SCENARIO_PROFILES,
    EnvironmentForcingService,
    normalize_environment_scenario,
)
from app.services.space_weather import SpaceWeatherService
from app.services.solar_system import SolarSystemService, create_default_service

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"


def _load_dotenv_file(dotenv_path: Path) -> None:
    if not dotenv_path.exists():
        return
    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if (
            len(value) >= 2
            and ((value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")))
        ):
            value = value[1:-1]
        os.environ.setdefault(key, value)


_load_dotenv_file(BASE_DIR.parent / ".env")

app = FastAPI(title="Solar System Live Map", version="0.1.0")

try:
    validate_catalog_lock()
except PhysicsLockError as exc:
    raise RuntimeError(f"Physics lock validation failed at startup: {exc}") from exc

service: SolarSystemService = create_default_service()
launch_site_service = LaunchSiteService()
environment_forcing_service = EnvironmentForcingService()
space_weather_service = SpaceWeatherService(
    forcing_context_provider=environment_forcing_service.current_context,
)
earth_eop_service = EarthEopService(
    forcing_context_provider=environment_forcing_service.current_context,
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.on_event("startup")
async def startup_refresh_launch_site() -> None:
    await launch_site_service.refresh_on_startup()
    await space_weather_service.refresh_on_startup()
    await earth_eop_service.refresh_on_startup()


@app.get("/api/config")
async def runtime_config() -> dict[str, object]:
    forcing_mode = str(os.getenv("ENVIRONMENT_FORCING_MODE") or "simulated").strip().lower() or "simulated"
    forcing_snapshot = environment_forcing_service.snapshot()
    return {
        "features": {
            "starship_launch": _parse_bool(os.getenv("ENABLE_STARSHIP_LAUNCH"), default=True),
        },
        "environment_forcing": {
            "mode": forcing_mode,
            "space_weather_mode": str(os.getenv("SPACE_WEATHER_MODE") or forcing_mode).strip().lower() or forcing_mode,
            "earth_eop_mode": str(os.getenv("EARTH_EOP_MODE") or forcing_mode).strip().lower() or forcing_mode,
            "scenario": forcing_snapshot.get("scenario"),
            "updated_at_utc": forcing_snapshot.get("updated_at_utc"),
            "profile": forcing_snapshot.get("profile"),
        },
        "launch_site": launch_site_service.current_site().to_dict(),
    }


@app.get("/api/environment-forcing")
async def runtime_environment_forcing() -> dict[str, object]:
    return environment_forcing_service.snapshot()


@app.post("/api/environment-forcing")
async def update_environment_forcing(
    scenario: str = Query(
        ...,
        description="Environment scenario: quiet, moderate, storm, extreme.",
    ),
    force_refresh: bool = Query(
        default=True,
        description="Refresh simulated forcing services immediately after scenario update.",
    ),
) -> dict[str, object]:
    requested = str(scenario or "").strip().lower()
    if requested not in SCENARIO_PROFILES:
        raise HTTPException(status_code=400, detail=f"Invalid scenario '{scenario}'.")
    normalized = normalize_environment_scenario(requested)
    snapshot = environment_forcing_service.set_scenario(normalized)
    if force_refresh:
        await space_weather_service.get_snapshot(force_refresh=True)
        await earth_eop_service.get_snapshot(force_refresh=True)
    return snapshot


@app.get("/api/space-weather")
async def runtime_space_weather(
    force_refresh: bool = Query(default=False, description="Force a live refresh of cached space-weather inputs."),
) -> dict[str, object]:
    snapshot = await space_weather_service.get_snapshot(force_refresh=force_refresh)
    return snapshot.to_dict()


@app.get("/api/earth-eop")
async def runtime_earth_eop(
    force_refresh: bool = Query(default=False, description="Force a live refresh of cached Earth orientation parameters."),
) -> dict[str, object]:
    snapshot = await earth_eop_service.get_snapshot(force_refresh=force_refresh)
    return snapshot.to_dict()


@app.get("/api/bodies")
async def list_bodies(
    include_moons: bool = Query(default=True, description="Include moons in body catalog."),
) -> dict[str, object]:
    return {"count": len(service.list_bodies(include_moons=include_moons)), "bodies": service.list_bodies(include_moons)}


@app.get("/api/positions")
async def get_positions(
    include_moons: bool = Query(default=True, description="Include moons in position response."),
    at: datetime | None = Query(
        default=None,
        description="Optional datetime in ISO-8601; defaults to now in UTC.",
    ),
) -> dict[str, object]:
    return await service.get_positions(at=at, include_moons=include_moons)


@app.websocket("/ws/positions")
async def stream_positions(websocket: WebSocket) -> None:
    await websocket.accept()
    include_moons = _parse_bool(websocket.query_params.get("include_moons"), default=True)
    interval_seconds = _clamp_interval(websocket.query_params.get("interval"), default=5.0)
    try:
        while True:
            payload = await service.get_positions(include_moons=include_moons)
            await websocket.send_json(payload)
            await asyncio.sleep(interval_seconds)
    except WebSocketDisconnect:
        return


def _parse_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    value_norm = value.strip().lower()
    if value_norm in {"1", "true", "yes", "y", "on"}:
        return True
    if value_norm in {"0", "false", "no", "n", "off"}:
        return False
    return default


def _clamp_interval(value: str | None, default: float) -> float:
    if value is None:
        return default
    try:
        parsed = float(value)
    except ValueError:
        return default
    return max(1.0, min(60.0, parsed))
