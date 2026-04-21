# Physics Runtime Migration

## Goal

Make the browser-side simulation the authoritative source of truth for body state, vehicle state, and environment state. Horizons should remain a startup seed and validation source, not the runtime owner of the world.

## Extraction Status

Completed in the repo so far:

- `physics/runtime/worldState.js`
  - snapshot seeding
  - vector parsing
  - world-state creation
  - momentum neutralization
- `physics/runtime/forceModel.js`
  - oblate source context generation
  - point-mass gravity
  - Earth solid tides
  - lunar mascons
  - solar radiation pressure
  - total acceleration composition
- `physics/runtime/integrator.js`
  - velocity-Verlet stepping
  - substep/backlog policy
  - launch lifecycle step hooks
- `physics/runtime/launchRuntime.js`
  - launch-body mutation bridge
  - runtime-owned startup/reset/start/delete/tanker/mission launch entrypoints
- `physics/runtime/startupRuntime.js`
  - startup payload normalization
  - startup seed injection
  - runtime-owned world bootstrap from startup entries
- `physics/runtime/lunarSourceModel.js`
  - Moon guidance source descriptors
  - runtime-owned source ephemeris interpolation
  - lunar planner source-model cache clone and restore helpers
- `physics/runtime/lunarPropagation.js`
  - runtime-owned lunar guidance acceleration
  - shared runtime integrator-backed lunar propagation
  - runtime-owned B-plane and burn-duration helpers
- `physics/environment/internalEnvironmentModels.js`
  - runtime-owned environment forcing scenarios
  - deterministic internal space-weather generation
  - deterministic internal Earth EOP generation
  - deterministic internal launch-weather generation

`app/static/js/app.js` now delegates world seeding, force evaluation, and integrator stepping through the runtime modules, while still retaining the higher-level orchestration shell.

The runtime coordinate path is also now strict:

- scene placement reads `nBodyState`-derived runtime coordinates only
- orbit marker phase sync reads runtime coordinates only
- light/overlay/detail queries no longer fall back to live snapshots for body position authority

Numeric repair is also now runtime-owned:

- non-finite dynamic bodies are repaired from runtime-held stable snapshots
- `app.js` no longer repairs dynamic body state from `positionsById` before integration

Launch-body ownership has also moved inward:

- the app shell no longer mutates `nBodyState` through `launchController` directly
- shell-side launch body insertion/reset/delete/start/tanker/mission launch calls now flow through the runtime bridge

Startup authority has also moved inward:

- startup payload entry normalization now lives in the runtime namespace
- app bootstrap and launch-runtime bootstrap both seed world state through the startup runtime
- `initializeNBodyFromSnapshot(...)` is no longer an app-owned authority path

Lunar source-model authority has also moved inward:

- lunar planners no longer build guidance source models from `moonDynamicsModel.js`
- source descriptors, interpolation, and source-model cache restore now live in the runtime namespace
- `moonDynamicsModel.js` now consumes the runtime-owned source-model surface instead of defining it locally

Lunar propagation authority has also moved inward:

- lunar planners no longer propagate guidance trajectories through `moonDynamicsModel.js`
- lunar acceleration and propagation stepping now live in the runtime namespace
- lunar propagation now reuses the runtime force model for gravity, oblateness, mascons, and Earth solid tides
- lunar propagation now steps through the shared runtime integrator instead of a separate planner-owned loop

Earth environment forcing has also moved inward:

- browser runtime space weather no longer depends on `/api/space-weather`
- browser runtime Earth orientation forcing no longer depends on `/api/earth-eop`
- browser runtime launch-site weather no longer depends on `/api/launch-weather`
- scenario changes no longer post through `/api/environment-forcing`
- `app.js` now drives those providers from internal deterministic forcing models

## Current State

The codebase already has most of the physics pieces, but authority is split across several places:

- `app/static/js/app.js`
  - seeds `nBodyState` from live payloads
  - computes global accelerations
  - integrates dynamic bodies
  - mixes n-body, live-velocity propagation, and orbital fallbacks when resolving positions
- `app/static/js/physics/launch/launchController.js`
  - owns launch vehicle state transitions
  - injects thrust and vehicle-specific state into the global loop
- `app/static/js/physics/navigation_system/lunar/moonDynamicsModel.js`
  - remains as a compatibility wrapper around the runtime lunar planner surface
- `app/services/solar_system.py`
  - provides startup and validation ephemerides from Horizons

That still leaves startup body seeding from Horizons and a higher-level launch mission shell, but the live Earth-environment forcing path is now runtime-local.

## Target Architecture

Add a dedicated `app/static/js/physics/runtime/` namespace with four layers:

1. `worldState`
   Owns dynamic bodies, static sources, simulation time, and seeding from startup snapshots.

2. `forceModel`
   Owns all acceleration terms:
   - point-mass gravity
   - oblateness harmonics
   - Earth solid tides
   - lunar mascons
   - atmospheric drag
   - solar radiation pressure
   - thrust and control accelerations

3. `integrator`
   Owns time stepping, substep policy, numeric guards, and world advancement.

4. `runtime`
   Owns the public interface consumed by the app shell:
   - seed from startup snapshot
   - step simulation
   - query body coordinates and velocities
   - apply vehicle delta-v / thrust providers
   - report diagnostics

The scene and UI should consume runtime state only. They should not own propagation logic.

## Phase Plan

### Phase 1: Extract World State

Create `physics/runtime/worldState.js` and move these concerns out of `app.js`:

- seeding dynamic and static bodies from `positionsById`
- finite vector parsing
- momentum neutralization
- runtime world record shape
- "is this body physics-driven?" checks

This phase is behavior-preserving. No authority changes yet.

### Phase 2: Extract Global Force Model

Move these concerns from `app.js` into `physics/runtime/forceModel.js`:

- source-frame context building
- oblate source context lookup
- point-mass gravity
- Earth solid tide perturbation
- lunar mascon perturbation
- solar radiation pressure
- atmosphere controller contribution
- launch thrust contribution interface

At the end of this phase, `app.js` should not directly sum accelerations.

### Phase 3: Extract Integrator

Move these concerns into `physics/runtime/integrator.js`:

- leapfrog / velocity-Verlet stepping
- substep policy
- launch-time step override handling
- backlog handling
- finite-state rollback and recovery

At the end of this phase, `app.js` should call one runtime step entrypoint instead of managing the loop itself.

### Phase 4: Unify Coordinate Authority

Replace the mixed runtime resolution path in `app.js`:

- n-body coordinates
- propagated live coordinates
- circular fallback
- Kepler moon fallback

with a single runtime answer per body.

Recommended split:

- authoritative dynamic bodies
- authoritative static sources
- explicit fallback bodies only during bootstrap or degraded mode

This is the phase that makes the environment meaningfully physics-driven.

### Phase 5: Launch Runtime Integration

Keep `launchController.js` focused on mission state, guidance, staging, and vehicle systems, but make it a provider to the physics runtime rather than a peer owner of state.

New contract shape:

- runtime asks launch for thrust / mass / actuator effects
- launch asks runtime for world state queries
- launch no longer needs to own integration timing

Existing hooks already point in the right direction:

- `prepareStep(...)`
- `externalAccelerationKmS2(...)`
- `finalizeStep(...)`

### Phase 6: Moon Navigation Unification

Align `moonDynamicsModel.js` with the same force-source definitions used by the global runtime.

Do not immediately force the mission solver to use the same integrator implementation. First unify:

- source descriptors
- perturbation term definitions
- body constants
- atmosphere and radiation policies

Completed for this slice:

- source descriptors
- source ephemeris interpolation
- source-model cache clone and restore
- runtime-owned lunar acceleration composition
- runtime-owned lunar propagation on the shared runtime integrator

Still remaining:

- direct runtime-backed planner state queries
- decision on whether the Moon propagator remains specialized or becomes a runtime plugin

### Phase 7: Worker Isolation

Move the physics runtime into a Worker once authority is consolidated.

The main thread should retain:

- scene graph updates
- camera
- UI
- visual effects
- input

The Worker should own:

- world state
- time stepping
- force evaluation
- diagnostics

### Phase 8: Horizons as Seed and Validation

Keep Horizons for:

- startup initial conditions
- periodic drift checks
- recovery from catastrophic numeric failure
- optional comparison overlays

Do not use Horizons as the routine owner of runtime body positions.

## Definition of Done

The environment is "physics-driven" when these conditions hold:

- the browser runtime owns current positions and velocities for all active bodies
- scene placement reads runtime state only
- launch vehicles, Moon mission vehicles, and environment bodies share one authority path
- live ephemeris is optional after startup
- fallback propagation modes are explicit degraded modes, not the default path

## First Extraction Order

1. `physics/runtime/worldState.js`
2. `physics/runtime/forceModel.js`
3. `physics/runtime/integrator.js`
4. `physics/runtime/runtime.js`
5. reroute `app.js` through the new runtime API

## Notes For This Repo

- `app.js` is the primary extraction target.
- `launchController.js` should stay mission-focused, not become the global world owner.
- `moonDynamicsModel.js` is valuable reference code for higher-fidelity local propagation, not something to delete early.
- The existing regression suite is a major advantage. Use it to lock each phase before moving on.
