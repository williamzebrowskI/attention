# Physics Overlay Calculations

This document covers calculation logic for diagnostic/analysis overlays.

## Gravity Vector Overlay

Implemented in `app/static/js/app.js`:

- `computeGravityById()`
- `updateGravityVectors()`

Per body:

1. Sum acceleration from all mass sources using
   `computeGravityAccelerationFromSource(...)`.
2. Convert to `m/s^2` for UI.
3. Track dominant contributing source.

Arrows are a display layer only; they do not change dynamics.

## Tidal Force Overlay

Implemented in `app/static/js/physics/overlays/tidalOverlay.js`.

For each configured body/source set:

1. Compute source direction and distance.
2. Compute near-side and far-side accelerations:
   - `a_near = G*M/(r-R)^2`
   - `a_far = G*M/(r+R)^2`
3. Differential axis magnitude:
   - `0.5 * (a_near - a_far)`
4. Sum source contributions along axis.

Overlay shows:

1. Near-side arrow
2. Far-side arrow
3. Shell opacity scaled by tidal magnitude

This overlay is diagnostic and visual only.

## Lagrange Point Overlay

Implemented in `app/static/js/physics/overlays/lagrangeOverlay.js`.

For each two-body system:

1. Build primary-secondary line and orbital plane normal.
2. Solve collinear points `L1/L2/L3` by Newton iteration on rotating-frame
   equilibrium equation.
3. Compute `L4/L5` as equilateral points from system midpoint and plane tangent.

Collinear equation combines:

1. Primary gravity
2. Secondary gravity
3. Rotating-frame centrifugal term

The result is rendered as markers; it does not modify orbit integration.
