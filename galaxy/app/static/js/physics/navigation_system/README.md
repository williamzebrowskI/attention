# Navigation System Foundation

This directory is a standalone scaffold for a future physics-aware mission navigation stack.
It is intentionally not wired into launch or vehicle controllers yet.

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
  - Command planner scaffold with baseline commands and predictive optimizer placeholder.
- `navigationSystem.js`:
  - High-level facade that composes estimator + evaluator + planner.
- `index.js`:
  - Re-exports for future integration.

## Integration intent (later)

1. Create one navigation system instance per controlled vehicle.
2. Feed orbital metrics + state measurements each simulation step.
3. Consume returned command (`phase`, `throttle`, `direction`, `mode`) inside the existing flight control pipeline.
4. Replace fallback planner path with a predictive optimizer implementation.
