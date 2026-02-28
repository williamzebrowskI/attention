# Gravitational / N-body Implementation

This document describes the **current** gravitational-orbit logic in the app.

## Runtime Mode (Current)

Configured in `app/static/js/app.js`:

- `HORIZONS_STARTUP_FETCH_ONLY = true`
- `N_BODY_ALL_BODIES_MODE = true`
- `N_BODY_STATIC_SOURCE_IDS = new Set()`
- `N_BODY_EXCLUDED_IDS = new Set()`
- `N_BODY_MAX_FRAME_SECONDS = 20`
- `N_BODY_STEP_SECONDS = 2`
- `GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20`

Meaning:

1. We fetch Horizons once at startup.
2. We do not stream periodic Horizons updates.
3. Orbits are advanced locally with N-body gravity after startup.

## Startup Seeding

On startup snapshot load (`updatePositions(payload)`), we:

1. Store snapshot bodies in `positionsById`.
2. Run `initializeNBodyFromSnapshot(Date.now())`.
3. Build an N-body state containing:
   - dynamic bodies: bodies with valid `mass + position + velocity`
   - static sources: bodies listed in `N_BODY_STATIC_SOURCE_IDS` (currently none)

If a body is missing required startup data, it is not included as an N-body dynamic body.

## Momentum Neutralization

Before simulation begins, we call:

- `neutralizeTotalMomentum(dynamicBodies, "sun")`

This adjusts Sun velocity so total system linear momentum is near zero in the seeded frame.

## Integrator

Per frame (`animate()`), we run:

- `updateNBodySimulation(nowMs)`

Time handling:

1. `elapsedSeconds = clamp((nowMs - lastUpdateMs)/1000, 0, N_BODY_MAX_FRAME_SECONDS)`
2. Simulated in fixed-size chunks up to `N_BODY_STEP_SECONDS`

Step method (`integrateNBodyStep`):

1. Compute acceleration at step start for every dynamic body.
2. Half-kick velocities.
3. Drift positions.
4. Recompute acceleration at new positions.
5. Final half-kick velocities.

This is a velocity-Verlet style symplectic update.

## Gravity Equation Used

For each target body, acceleration from each source body:

- `a = G * M / r^2` toward source direction
- Implemented with vector form using `invRadiusCubed`:
  - `scalar = G * M / r^3`
  - `a_vec += scalar * (sourcePos - targetPos)`

All units are in km, kg, s:

- Position: km
- Velocity: km/s
- Acceleration: km/s²

## Coordinate Source Priority

`computeRuntimeCoordinatesKm()` / `resolveRuntimeCoordinates()` use:

1. N-body coordinates first (`nBodyCoordinatesKmById`)
2. If unavailable: existing live/propagated fallback paths

So bodies not included in dynamic N-body will still render through fallback logic.

## Fallback Detection / UI

A body is treated as N-body fallback if:

- startup snapshot has been loaded, and
- `isNBodyDrivenBodyId(bodyId) === false`

Legend behavior:

1. Fallback bodies get class `fallback`.
2. CSS renders a red indicator dot (`.legend-button.fallback::after`).

## Gravity Arrows

Gravity values are computed for diagnostics by `updateGravityVectors()`.

Display policy:

1. Arrows are hidden by default.
2. Arrows only show after explicit legend activation in the current session.
3. Only the legend-selected/focused body arrow is visible at a time.

This is controlled by:

- `gravityArrowsLegendActivated`
- `gravityArrowFocusBodyId`
- `selectedId`

## What Is Gravity-driven vs Not

Gravity-driven now:

1. Planet and moon translational orbital motion (when body is N-body-driven).

Not gravity-driven in this implementation:

1. Axial spin/rotation rates (still controlled by rotation/prime-meridian model).
2. Tidal locking dynamics, torques, relativity, non-gravitational forces.
3. Periodic re-sync to Horizons (intentionally disabled in this mode).

## Verification Pointers

Files:

- `app/static/js/app.js` (N-body, fallback, arrow logic)
- `app/static/css/styles.css` (legend fallback red indicator)

Quick checks:

1. Start app and verify no gravity arrows appear until legend click.
2. Click a legend body and verify only one arrow is shown.
3. Confirm info panel line: `Orbit Dynamics: N-body gravity (startup-seeded from Horizons)` for N-body bodies.
4. Confirm fallback bodies show red legend indicator.
