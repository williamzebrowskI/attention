# Rigid-Body Attitude And Tidal Torque

This document describes the torque-driven orientation model used for planets
and moons.

## Where It Runs

- Controller: `app/static/js/physics/rigidBodyAttitude.js`
- Constants: `app/static/js/physics/config/rigidBodyConstants.js`
- Called from render loop via `updatePrimeMeridianSpins(...)` in `app/static/js/app.js`

## State Per Managed Body

Each managed body tracks:

1. Quaternion orientation
2. Body-frame angular velocity `omegaBody`
3. Principal moments/inertia tensor (`A,B,C`)
4. Mass and radius
5. Torque source configuration
6. Optional tidal model parameters

## Core Dynamics

Euler rigid-body equation is integrated in body frame:

- `I * omega_dot + omega x (I*omega) = tau_total`

Where `tau_total` includes:

1. Gravity-gradient torque
2. Tidal torque (if enabled for that source/body pair)

## Gravity-Gradient Torque

`computeGravityGradientTorqueBody(...)` computes:

- `tau = 3*G*M_source/r^3 * (n x (I*n))`

Where:

1. `n` is source direction unit vector in target body frame.
2. `I` is target principal inertia tensor.

## Tidal Torque (Constant Time Lag)

`computeConstantTimeLagTidalInteraction(...)` uses a CTL-style model:

1. Compute relative spin-orbit angular rate mismatch.
2. Apply torque scaled by `k2`, `deltaT`, body radius, and `r^-6`.
3. Clamp max torque if configured.

Back-reaction:

1. Compute equal/opposite tangential force pair.
2. Convert force to `delta-v` on both bodies.
3. Apply through `applyBodyDeltaVelocityKmS(...)`.

This couples spin damping with orbital angular momentum exchange.

## Major Two-Body Tidal Systems

The runtime explicitly applies bidirectional tidal interactions (both bodies in
the pair) with orbital back-reaction for:

1. Earth <-> Moon
2. Jupiter <-> Io
3. Jupiter <-> Europa
4. Jupiter <-> Ganymede
5. Saturn <-> Titan
6. Saturn <-> Enceladus

For each pair and each substep:

1. Compute tide on primary raised by secondary.
2. Compute tide on secondary raised by primary.
3. Add both torques to spin integration.
4. Apply equal/opposite orbital back-reaction forces for both interactions.

## Integration Method

`update(deltaSeconds)`:

1. Substep loop (`stepSeconds` limit, frame clamp by `maxFrameSeconds`)
2. Accumulate torques per body from selected sources
3. Integrate `omega` with Euler equation
4. Integrate quaternion with axis-angle increment
5. Apply orientation back to visuals

## Source Selection

Torque sources can be dynamic:

1. Always include parent and/or Sun if configured.
2. Rank other bodies by torque proxy `M/r^3`.
3. Include top-N above threshold.

## Notes

1. This is full attitude dynamics for managed bodies, not just a visual spin.
2. It runs alongside translational N-body and can feed orbital back-reaction.
