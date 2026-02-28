# Oblateness And Harmonic Gravity

This document describes higher-order gravity terms used on top of point-mass
N-body acceleration.

## Where It Runs

- Config: `app/static/js/physics/config/oblatenessConfig.js`
- Runtime model build: `oblateModelForBody(...)` in `app/static/js/app.js`
- Per-step acceleration: `computeGravityAccelerationFromSource(...)`

## Terms Included

For configured source bodies, the solver applies:

1. `J2` zonal term
2. `J4` zonal term
3. `C22/S22` tesseral terms

`referenceRadiusKm` is required for all harmonic terms.

## C22/S22 Coverage Rules

1. If `c22/s22` exist in `OBLATE_GRAVITY_MODEL`, those exact values are used.
2. If missing, runtime tries a principal-moment derived `C22`:
   - `C22 ~= (B - A) / (4*M*R^2)`
   - `S22` defaults to `0` in principal-axis frame.
3. If all harmonic terms are effectively zero, the body is treated as point mass.

Principal moments come from:

- `app/static/js/physics/config/rigidBodyConstants.js`

## Body-Fixed Axes For Tesseral Terms

Tesseral acceleration uses source-body fixed axes (`xAxis`, `yAxis`, `pole`)
computed from:

1. Pole orientation (`RA/DEC` model converted to ecliptic)
2. Prime meridian angle `W(t)` at current timestamp

This keeps the tesseral field rotating with the body.

## Implementation Details

`computeGravityAccelerationFromSource(...)` applies contributions in order:

1. Point-mass term
2. `J2` correction
3. `J4` correction
4. `C22/S22` correction in body frame, then transformed back to world frame

All units stay in `km`, `kg`, `s`.

## Practical Effect

Compared with point-mass-only gravity:

1. Better near-field orbit behavior around oblate bodies.
2. Longitude-dependent gravity asymmetry where `C22/S22` are non-zero.
3. More realistic perturbations and precession trends over time.
