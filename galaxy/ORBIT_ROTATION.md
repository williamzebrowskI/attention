# Orbit And Rotation Model

This document describes the orbital and spin calculations that run each frame.

## Runtime Orbit Sources

Implemented in `app/static/js/app.js`:

1. `updatePositions(...)` loads startup Horizons coordinates/velocities.
2. `initializeNBodyFromSnapshot(...)` seeds N-body state.
3. `updateNBodySimulation(nowMs)` advances all dynamic bodies.
4. `computeRuntimeCoordinatesKm(nowMs)` resolves final per-body coordinates.

Coordinate priority in runtime resolution:

1. N-body position (`nBodyCoordinatesKmById`)
2. Live-propagated coordinate path (if present)
3. Orbital-state fallback (`kepler` or `circular`)

## Kepler Moon Fallback Path

Implemented in:

- `syncOrbitalStateFromSnapshot(...)`
- `resolveRuntimeCoordinates(...)`
- `app/static/js/physics/celestialPhysics.js`

For moon fallback mode:

1. Mean anomaly `M` is stepped in time.
2. Solve Kepler equation with Newton iterations:
   - `E - e*sin(E) = M`
3. Compute perifocal coordinates:
   - `x = a*(cos(E)-e)`
   - `y = b*sin(E)`, `b = a*sqrt(1-e^2)`
4. Rotate from perifocal to inertial frame with:
   - argument of periapsis
   - inclination
   - ascending node

## Circular Fallback Path

For non-Kepler fallback mode:

1. Keep `radiusKmXY`, `relZKm`, and `baseAngleRad`.
2. Advance `baseAngleRad` using `angularSpeedRadPerSecond`.
3. Resolve body position relative to parent coordinate.

## Rotation / Prime Meridian

Implemented in:

- `primeMeridianModelForBody(...)`
- `primeMeridianSpinRadians(...)`
- `updatePrimeMeridianSpins(...)`
- `currentPoleEquatorialDegForBody(...)`

Spin model:

- `W(t) = W0 + Wdot * d`
- `d = days since J2000`

Pole model:

- `RA(t) = RA0 + RA_rate*T`
- `DEC(t) = DEC0 + DEC_rate*T`
- `T = Julian centuries since J2000`

If explicit prime-meridian constants are missing, spin rate falls back to
sidereal rotation period.

## Notes

1. Rigid-body managed bodies use quaternion attitude updates and do not use the
   simple spin increment path.
2. Earth and Moon can be calibration-adjusted for texture alignment while
   staying tied to the physical orientation model.
