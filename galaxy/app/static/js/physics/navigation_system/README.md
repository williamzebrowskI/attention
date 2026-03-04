# Navigation System

## Directory layout

- `navigationSystemConfig.js`:
  - Modes and defaults.
- `navigationMissionProfiles.js`:
  - Mission IDs, phase names, and baseline Moon mission thresholds.
- `navigationMath.js`:
  - Minimal vector/math helpers used by the navigation modules.
- `navigationSystemState.js`:
  - Runtime state object creation and phase-transition bookkeeping.
- `navigationStateEstimator.js`:
  - Lightweight state estimation filter scaffold.
- `navigationPhaseEvaluator.js`:
  - Mission phase gate evaluation logic.
- `navigationTrajectoryPlanner.js`:
  - Thin planner dispatcher and runtime state wrapper.
- `planners/`:
  - `earthOrbitHoldPlanner.js`: Earth-hold command policy.
  - `refuelRendezvousPlanner.js`: Orbital refuel rendezvous command policy.
  - `moonMissionPlanner.js`: Moon mission command policy (TLI, coast, midcourse, capture).
  - `moonGuidanceState.js`: Moon guidance sensor/midcourse runtime state helpers.
  - `interceptMath.js`: Closest-approach/miss-distance math helpers.
- `lunar/`:
  - `departureWindowSolver.js`: Moon departure/orbit-inject window solve helpers.
  - `tliFiniteBurnTargeter.js`: Finite-duration TLI burn command targeter.
  - `lunarPhaseGates.js`: TLI exit and lunar-capture gate evaluation + descriptions.
- `navigationSystem.js`:
  - High-level facade that composes estimator + evaluator + planner.
- `index.js`:
  - Re-exports used by launch controllers.

## Runtime integration

1. Create one navigation system instance per controlled vehicle.
2. Feed orbital metrics + state measurements each simulation step.
3. Consume returned command (`phase`, `throttle`, `direction`, `mode`) inside flight-control loops.
4. Planner runtime state is persisted/restored through `navigationSystem` snapshots.
