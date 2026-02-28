# Solar System Live Map

Interactive solar-system visualization backed by a Python API. The backend fetches heliocentric coordinates from JPL Horizons and streams updates to a 3D frontend.

## Features

- FastAPI backend with REST + WebSocket endpoints
- Live heliocentric coordinates for Sun/planets, plus Earth-Moon relative ephemeris from JPL Horizons
- Data source tags (`HORIZONS` or `APPROXIMATE`) per body
- Fullscreen black-space renderer focused only on the solar system
- 3D-only navigation with click-to-focus bodies
- Zoom-proximity planet detail overlay
- 260-degree azimuth rotation sweep for wide POV control
- PBR-style textured planets (surface maps, bump/specular where available)
- Atmospheric glow and cloud layers (Earth, Venus)
- Ring systems (Saturn, Uranus)
- Multi-level mesh LOD for smoother close/far rendering
- Physically-correct lighting and filmic tone mapping
- Moons rendered at true relative size scale (same linear scale model as planets)
- Moon-specific terrain/color generation for non-Earth moons
- Expanded moon catalog across moon-bearing planets (31 moons)
- Real-time heliocentric orbit paths for planets, with live orbital phase markers
- Orbit spacing is intentionally compressed for a user-friendly view while preserving live orbital timing

## Data Sources

- JPL Horizons API: `https://ssd.jpl.nasa.gov/api/horizons.api`
- Fallback approximation: circular orbit model using known semimajor axes and periods

## Run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open:

- App: `http://127.0.0.1:8000`
- API docs: `http://127.0.0.1:8000/docs`

## API

- `GET /api/bodies?include_moons=true`
- `GET /api/positions?include_moons=true`
- `WS /ws/positions?include_moons=true&interval=5`

Example:

```bash
curl "http://127.0.0.1:8000/api/positions?include_moons=false"
```

## Notes

- Coordinates are heliocentric ecliptic/J2000 in kilometers.
- Position payloads now include `coordinates_relative_to_parent_km` and `distance_from_parent_km` when a parent body exists.
- Horizons failures are surfaced per body via `source_error` and automatically replaced by approximate coordinates.
- The frontend is 3D-only and requires loading Three.js from CDN.
- Planet textures are loaded from public map assets hosted via jsDelivr (THREEx planets image set).
