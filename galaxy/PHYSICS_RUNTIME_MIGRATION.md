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
- `physics/runtime/environmentRuntime.js`
  - runtime-owned environment provider lifecycle
  - runtime-owned Earth atmosphere and launch-weather sampling
  - runtime-owned environment forcing scenario application
- `physics/runtime/ephemerisRuntime.js`
  - runtime-owned local ephemeris bootstrap surface
  - catalog-wide recursive orbital state generation
  - startup seed supplements when live startup positions are unavailable

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
- reported ship/booster vehicle phase now derives from runtime body state, contact, thrust, and orbit conditions
- scripted launch/booster phase is now treated as command state and exposed separately from physics-derived vehicle phase
- launch-controller idle/orbit handling now reconciles command phase against physics-derived vehicle phase during `prepareStep` and `finalizeStep`
- burn sequencing, staging transitions, and booster recovery intent now write through explicit `commandPhase` fields that persist separately from reported vehicle phase
- stage burnout no longer mutates stages immediately; runtime now requests, authorizes, and then executes hotstage ignition / next-stage separation from physical flight conditions
- guidance no longer hard-owns command phase inside autopilot branches; runtime now resolves command phase from applied control plus physics-aware advisory intent
- moon mission phase progression no longer mutates immediately from planner output; runtime now holds pending mission-phase advisories briefly before authorizing them
- launch thrust authority now scales from configured engine counts instead of treating stage/booster thrust as engine-count-independent aggregate force
- launch runtime now accepts a manual Super Heavy engine-count override per launch, so launch-panel selections from `1..33` feed the actual ascent combustion cluster and cap separated-booster recovery burns to the physically available subset instead of remaining global fixed config only
- Super Heavy ascent/recovery now resolves actual lit-engine subsets from the shared engine layout, and booster plume visuals now follow the runtime engine mask instead of firing the full cluster
- per-engine combustion faults, flame presence, chamber pressure, and exhaust temperature now flow through runtime telemetry, with mission-control/HUD engine-out state and plume color/brightness driven from those live chamber states
- Super Heavy side-thruster RCS is now modeled as its own six-channel combustion cluster, with per-thruster chamber pressure, exhaust temperature, thrust, burn rate, and fault/flame telemetry instead of a single aggregate RCS burn-rate shortcut
- the attached Starship/Super Heavy stack no longer reports one opaque joint load; runtime now resolves separate axial compression, lateral flex/bending, and angular structural moment channels while attached
- attached ascent no longer carries a booster-separation visual handoff path; the persistent booster visual stays on the same scene object and attached render mode until physical release
- early ascent no longer allows `tower-clear` to hold vertical indefinitely; a bounded tower-clear window now hands off to pitch-program / gravity-turn guidance and the visual blend now follows that turn within the first few kilometers instead of staying near-vertical deep into ascent
- launch sequencing now exposes explicit runtime event gates for `launch_commit_ready`, `pad_release_complete`, `tower_clear_satisfied`, `pitchover_enabled`, `hotstage_armed`, `hotstage_ignition_authorized`, and `hotstage_release_authorized`, and hot-stage ignition now requires that armed state instead of relying on envelope checks alone
- pending hotstage ignition no longer has a generic low-q failsafe authorization path; it now requires the nominal hotstage envelope and records explicit `hold` / `anomaly` reasons when stage-0 depletion occurs off-nominal, with hotstage arming keyed to flight-path alignment instead of an unrealistic near-vertical attitude check
- Super Heavy return guidance now uses tower-relative navigation as a predictive terminal intercept controller: the old tower-corridor site-weight heuristics are removed, catch approach/burn solve against the chopsticks frame directly, and the terminal burn only commits when predicted miss and relative-state gates are inside the catch box
- final Super Heavy catch no longer teleports straight from "aligned" to "caught": the booster now enters a damped chopsticks capture phase with contact/closure/settle state and only becomes `caught` after the tower-relative constraint has absorbed and settled it
- Super Heavy return sequencing is now more state-gated and less timer/altitude-owned: thin-air entry, aero entry, descent coast, and landing burn now depend on dynamic pressure, fin authority, body-up alignment, and terminal corridor state; poor late body-up alignment raises the landing-burn trigger altitude so the booster commits upright earlier instead of staying belly-like into the tower approach
- tower-relative catch guidance now requires meaningful upright body alignment before it can own the terminal intercept, and late descent exposes booster body-up / retrograde / anti-tangent alignment telemetry so the runtime can prove the booster is tail-first before catch authority takes over
- Moon-mission upper-stage ascent now keeps its early post-hotstage climb physically prioritized: stage-2 q-alpha steering stays inactive until thin-air dynamic pressure is meaningfully present, and high-orbit climb guidance no longer flattens just because apoapsis rises early, so the ship continues a stronger near-full-thrust climb into the parking-orbit band before easing into insertion

Startup authority has also moved inward:

- startup payload entry normalization now lives in the runtime namespace
- app bootstrap and launch-runtime bootstrap both seed world state through the startup runtime
- `initializeNBodyFromSnapshot(...)` is no longer an app-owned authority path

Lunar source-model authority has also moved inward:

- lunar planners no longer build guidance source models from `moonDynamicsModel.js`
- source descriptors, interpolation, and source-model cache restore now live in the runtime namespace
- the `moonDynamicsModel.js` compatibility wrapper has been removed; tests and callers now import the runtime surface directly

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

Startup fallback authority has also been reduced:

- startup seeding now backfills missing catalog bodies from a dedicated runtime local ephemeris surface
- startup no longer hard-fails if `/api/positions` is unavailable during bootstrap
- launch/runtime Earth-environment queries now route through the runtime environment surface instead of app-owned provider state

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
- `app/services/solar_system.py`
  - provides startup and validation ephemerides from Horizons

That still leaves startup preference for Horizons when available and a higher-level launch mission shell, but the live Earth-environment forcing path is now runtime-local and bootstrap no longer hard-depends on a startup positions fetch.

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

Align the lunar planner/runtime surface with the same force-source definitions used by the global runtime.

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
- the runtime lunar propagation/source-model surface is now the only supported import path.
- The existing regression suite is a major advantage. Use it to lock each phase before moving on.
- hotstage now has a proactive nominal commit path near the public altitude/speed window, plus an explicit stage-0 anomaly hold if the booster misses that window instead of silently drifting into generic `apoapsis-raise+coast-fallback`.
- a terminal stage-0 hotstage anomaly no longer counts as an active primary launch, so a restored failed stack cannot block the next fresh pad launch from the browser UI.
- the nominal hotstage gate now treats altitude/time as the hard realism envelope and keeps speed as advisory telemetry, which fixes the browser-rate `Earth Orbit Hold` path that was missing hotstage and drifting into `hotstage_window_missed_high` at ~100 km.
- the early ascent profile now releases from the hard-vertical regime sooner and uses a stronger pitch kick, with a regression lock on actual commanded pitchover tilt so the turn remains visibly established by the first few kilometers of ascent.
- booster tower return now uses a harder mechanical capture constraint after chopstick contact, so the successful end-to-end path is `catch-approach -> catch-burn -> catch-contact -> catch-capture -> caught` under the app-grade physics harness instead of stalling near the tower with residual lateral drift.
