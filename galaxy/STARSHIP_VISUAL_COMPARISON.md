# Starship Visual Comparison (Procedural Model vs Real Vehicle)

## Reference Baseline
- **FAA Programmatic Environmental Assessment (Starship/Super Heavy, 2022)**:
  - Vehicle stack is approximately **120 m** tall and **9 m** in diameter.
  - Upper stage (Starship) is approximately **50 m**.
  - Booster (Super Heavy) is approximately **70 m**.
  - Public configuration references up to **6 Raptor engines on Starship** and high engine count on booster family variants.

References:
- https://www.faa.gov/newsroom/faa-seeks-public-comment-draft-spacex-starship-super-heavy-launch-vehicle-programmatic
- https://www.faa.gov/space/stakeholder_engagement/spacex_starship

## Procedural Model Values In This Repo
Source of truth:
- `app/static/js/physics/launch/launchConfig.js`
- `app/static/js/physics/launch/launchVisuals.js`

Current configured dimensions:
- Diameter: `9.0 m` (`0.009 km`)
- Starship height: `50.3 m` (`0.0503 km`)
- Super Heavy height: `71.0 m` (`0.071 km`)
- Stack height: `121.3 m`

## Dimension Check
- Stack height: `121.3 m` vs `~120 m` reference (delta `+1.3 m`, `+1.08%`)
- Diameter: `9.0 m` vs `9.0 m` reference (delta `0`)
- Starship stage height: `50.3 m` vs `~50 m` reference (delta `+0.3 m`, `+0.6%`)
- Booster height: `71.0 m` vs `~70 m` reference (delta `+1.0 m`, `+1.43%`)

## Visual/Geometry Alignment Implemented
- Smooth cylindrical body + ogive-style nose (lathed profile) for Starship upper stage.
- Windward black thermal-tile side covering the hull and nose (half-shell style).
- Four flap layout: two forward flaps + two aft flaps with hinge hardware placement.
- Hot-staging ring + vent ring representation at ship base.
- Weld seam ring bands across the stainless body sections.
- Upper-stage engine deck represented as six-engine cluster (3 outer + 3 inner bell distribution).
- Booster remains high-detail with grid fins and dense multi-engine skirt layout.

## Known Approximation Notes
- This is still a physically scaled procedural representation, not a photogrammetry mesh.
- Flap planforms, chine curvature, and engine bell internals are simplified for real-time rendering stability.
- Exact per-vehicle block revisions (e.g., engine count/layout differences by specific test article) are not yet parameterized per serial vehicle.
