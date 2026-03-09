# GNC Implementation Status

This is the current project-specific map of the lunar mission stack, organized the same
way NASA-style flight software is usually discussed: navigation, guidance, and control.

## Current module boundaries

- Navigation:
  - `/Users/williamzebrowski/attention/galaxy/app/static/js/physics/navigation_system/navigationStateEstimator.js`
  - `/Users/williamzebrowski/attention/galaxy/app/static/js/physics/navigation_system/lunar/moonStateFilter.js`
  - `/Users/williamzebrowski/attention/galaxy/app/static/js/physics/navigation_system/gnc/moonMissionNavigation.js`
- Guidance:
  - `/Users/williamzebrowski/attention/galaxy/app/static/js/physics/navigation_system/planners/moonMissionPlanner.js`
  - `/Users/williamzebrowski/attention/galaxy/app/static/js/physics/navigation_system/gnc/moonMissionGncStack.js`
  - `/Users/williamzebrowski/attention/galaxy/app/static/js/physics/navigation_system/gnc/moonMissionGuidanceArbiter.js`
  - `/Users/williamzebrowski/attention/galaxy/app/static/js/physics/navigation_system/lunar/moonClosedLoopTargeters.js`
  - `/Users/williamzebrowski/attention/galaxy/app/static/js/physics/navigation_system/lunar/departureWindowSolver.js`
- Control:
  - `/Users/williamzebrowski/attention/galaxy/app/static/js/physics/launch/launchController.js`
  - `/Users/williamzebrowski/attention/galaxy/app/static/js/physics/launch/launchGuidance.js`
  - `/Users/williamzebrowski/attention/galaxy/app/static/js/physics/launch/lunar/moonBurnAttitudeGate.js`
  - `/Users/williamzebrowski/attention/galaxy/app/static/js/physics/launch/lunar/moonSurvivalRecovery.js`

## Already implemented

- State-vector-based propagation and orbit evaluation.
- Mission-phase logic for launch, parking, refuel, TLI, coast, lunar insertion, and return.
- Lambert-style/closed-loop lunar targeting.
- Midcourse correction logic with B-plane and perilune corridor diagnostics.
- Periapsis protection and recovery for risky TLI profiles.
- Explicit Moon guidance arbitration so survival recovery, go/no-go holds, and fuel-budget holds do not stack conflicting commands.
- RCS / fine-control logic for docking and close-range orbital operations.
- Worker-backed heavy lunar solve paths.

## Implemented but simplified

- Navigation filtering:
  - The project has a Kalman-like estimator in
    `/Users/williamzebrowski/attention/galaxy/app/static/js/physics/navigation_system/navigationStateEstimator.js`
    and a moon-specific filter in
    `/Users/williamzebrowski/attention/galaxy/app/static/js/physics/navigation_system/lunar/moonStateFilter.js`.
  - This is not a full high-fidelity EKF/UKF tied to a real rigid-body sensor model.
- Sensor model:
  - The moon filter already synthesizes DSN/star-tracker-like measurements.
  - These are simulated guidance measurements, not a full hardware error-budget model.
- Ground vs onboard split:
  - The planner/runtime acts like an onboard + mission-control hybrid.
  - There is not yet a strict separation between “truth state”, “ground estimate”, and “vehicle estimate”.

## Missing or incomplete if the goal is NASA-like realism

- Explicit IMU drift and bias accumulation over long coast arcs.
- Distinct star-tracker attitude measurements versus translational navigation measurements.
- Explicit DSN update cadence, delay, and uplinked state corrections.
- Optical navigation against lunar landmarks during approach.
- Free-return trajectory as a first-class mission design/safety mode.
- A strict live coast monitor that never hides a failed lunar intercept behind stale plan telemetry.

## NASA-like checklist for this repo

- Good:
  - TLI burn follows a solved future intercept corridor.
  - Coast uses live ballistic tracking from the current estimated state.
  - Midcourse corrections are sparse and deliberate.
  - Lunar approach and capture use Moon-relative targeting, not Earth-relative heuristics.
- Acceptable simplifications:
  - Simulated DSN/star-tracker measurements.
  - Kalman-like blended filter instead of a full mission-grade estimator.
  - Unified mission planner/runtime instead of separate ground and onboard systems.
- Wrong:
  - Coasting away from the Moon while still presenting frozen “good” intercept telemetry.
  - Phase transitions that happen before Earth escape or before lunar capture gates are physically satisfied.
  - Multiple overlapping fallback paths that fight each other or silently replace the accepted corridor.

## Next architecture step

If this stack is pushed further toward NASA-like behavior, the next additions should be:

1. A dedicated sensor suite module for IMU, star-tracker, DSN, and optical-nav measurement synthesis.
2. A clearer estimate pipeline: truth state -> measurement set -> navigation estimate -> guidance command.
3. A coast supervisor that compares planned corridor and live corridor continuously and escalates earlier.
