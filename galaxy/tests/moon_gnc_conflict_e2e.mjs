import { planMoonLambertGncCommand } from "../app/static/js/physics/navigation_system/gnc/moonLambertGncStack.js";
import { NAVIGATION_DEFAULTS } from "../app/static/js/physics/navigation_system/navigationSystemConfig.js";
import { createPlannerRuntime } from "../app/static/js/physics/navigation_system/planners/moonGuidanceState.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function baseTargetVectors() {
  const shipEarthPositionKm = { x: 6521, y: 0, z: 0 };
  const shipEarthVelocityKmS = { x: 0, y: 7.82, z: 0 };
  const moonEarthPositionKm = { x: 384400, y: 0, z: 0 };
  const moonEarthVelocityKmS = { x: 0, y: 1.022, z: 0 };
  return {
    tangent: { x: 0, y: 1, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    toMoon: { x: 1, y: 0, z: 0 },
    shipEarthPositionKm,
    shipEarthVelocityKmS,
    moonEarthPositionKm,
    moonEarthVelocityKmS,
  };
}

function baseMetrics(overrides = {}) {
  return {
    moonDistanceKm: 385000,
    moonClosingSpeedKmS: 0.01,
    moonProjectedMissTrendKmS: 0.01,
    timeToPeriapsisSec: 1200,
    moonRadiusKm: 1737.4,
    ...overrides,
  };
}

function runCommand({
  phase,
  metrics = {},
  plannerRuntime = createPlannerRuntime(),
  timestampSec = 0,
}) {
  return planMoonLambertGncCommand({
    phase,
    targetVectors: baseTargetVectors(),
    metrics: baseMetrics(metrics),
    plannerConfig: NAVIGATION_DEFAULTS.planner,
    plannerRuntime,
    timestampSec,
  });
}

function testTliReacquireHoldMovingAway() {
  const runtime = createPlannerRuntime();
  const result = runCommand({
    phase: "tli_burn",
    plannerRuntime: runtime,
    timestampSec: 0,
    metrics: {
      moonClosingSpeedKmS: -0.03,
      moonProjectedMissTrendKmS: 0.12,
      timeToPeriapsisSec: 1200,
    },
  });
  assert(result, "reacquire_hold_moving_away: missing result");
  assert(result.phase === "coast", "reacquire_hold_moving_away: expected coast");
  assert(Number(result.throttle) === 0, "reacquire_hold_moving_away: expected zero throttle");
  assert(
    String(result.mode || "").includes("navsys:gnc-lambert-tli-reacquire-window"),
    `reacquire_hold_moving_away: unexpected mode ${result.mode}`,
  );
  assert(Boolean(result.diagnostics?.tliReacquireHold), "reacquire_hold_moving_away: expected reacquire hold");
}

function testTliReacquireHoldMissDivergingOnly() {
  const runtime = createPlannerRuntime();
  const result = runCommand({
    phase: "tli_burn",
    plannerRuntime: runtime,
    timestampSec: 0,
    metrics: {
      moonClosingSpeedKmS: 0.004,
      moonProjectedMissTrendKmS: 0.25,
      timeToPeriapsisSec: 1000,
    },
  });
  assert(result, "reacquire_hold_diverging: missing result");
  assert(result.phase === "coast", "reacquire_hold_diverging: expected coast");
  assert(Number(result.throttle) === 0, "reacquire_hold_diverging: expected zero throttle");
  assert(
    String(result.mode || "").includes("navsys:gnc-lambert-tli-reacquire-window"),
    `reacquire_hold_diverging: unexpected mode ${result.mode}`,
  );
  assert(Boolean(result.diagnostics?.tliReacquireHold), "reacquire_hold_diverging: expected reacquire hold");
}

function testNearPeriapsisOverridesReacquireHold() {
  const runtime = createPlannerRuntime();
  const result = runCommand({
    phase: "tli_burn",
    plannerRuntime: runtime,
    timestampSec: 0,
    metrics: {
      moonClosingSpeedKmS: -0.03,
      moonProjectedMissTrendKmS: 0.12,
      timeToPeriapsisSec: 100,
    },
  });
  assert(result, "near_periapsis_override: missing result");
  assert(result.phase === "powered", "near_periapsis_override: expected powered");
  assert(
    String(result.mode || "").includes("navsys:gnc-lambert-tli-burn"),
    `near_periapsis_override: unexpected mode ${result.mode}`,
  );
  assert(
    String(result.mode || "").includes("+reacquire"),
    `near_periapsis_override: expected reacquire tag in mode ${result.mode}`,
  );
  assert(
    Number(result.throttle) > 0 && Number(result.throttle) <= 0.56 + 1e-6,
    `near_periapsis_override: throttle out of range (${result.throttle})`,
  );
  assert(!Boolean(result.diagnostics?.tliReacquireHold), "near_periapsis_override: reacquire hold should be false");
  assert(Boolean(result.diagnostics?.nearPeriapsisBurnWindow), "near_periapsis_override: expected periapsis window true");
}

function testMidcourseApproachCoastNearMoon() {
  const runtime = createPlannerRuntime();
  const result = runCommand({
    phase: "coast_to_moon",
    plannerRuntime: runtime,
    timestampSec: 0,
    metrics: {
      moonDistanceKm: 50000,
      moonClosingSpeedKmS: 0.18,
      moonProjectedMissTrendKmS: 0.01,
      timeToPeriapsisSec: 1200,
    },
  });
  assert(result, "midcourse_approach_coast: missing result");
  assert(result.phase === "coast", "midcourse_approach_coast: expected coast");
  assert(Number(result.throttle) === 0, "midcourse_approach_coast: expected zero throttle");
  assert(
    String(result.mode || "").includes("navsys:gnc-lambert-approach-coast"),
    `midcourse_approach_coast: unexpected mode ${result.mode}`,
  );
}

function testRetargetCadenceDoesNotRetriggerEveryTick() {
  const runtime = createPlannerRuntime();
  const first = runCommand({
    phase: "tli_burn",
    plannerRuntime: runtime,
    timestampSec: 0,
    metrics: {
      moonClosingSpeedKmS: -0.03,
      moonProjectedMissTrendKmS: 0.12,
      timeToPeriapsisSec: 100,
    },
  });
  const second = runCommand({
    phase: "tli_burn",
    plannerRuntime: runtime,
    timestampSec: 10,
    metrics: {
      moonClosingSpeedKmS: -0.03,
      moonProjectedMissTrendKmS: 0.12,
      timeToPeriapsisSec: 100,
    },
  });
  assert(String(first.mode || "").includes("+retarget"), "retarget_cadence: first solve should retarget");
  assert(
    !String(second.mode || "").includes("+retarget"),
    `retarget_cadence: second solve should not retarget inside cadence, got ${second.mode}`,
  );
}

function testRuntimeDiagnosticsArePopulated() {
  const runtime = createPlannerRuntime();
  const result = runCommand({
    phase: "coast_to_moon",
    plannerRuntime: runtime,
    timestampSec: 0,
    metrics: {
      moonDistanceKm: 260000,
      moonClosingSpeedKmS: 0.03,
      moonProjectedMissTrendKmS: 0.05,
      timeToPeriapsisSec: 1800,
    },
  });
  assert(result, "runtime_diagnostics: missing result");
  assert(
    Number.isFinite(Number(runtime.moon?.approach?.projectedPeriluneAltitudeKm)),
    "runtime_diagnostics: projected perilune should be finite",
  );
  assert(
    Number.isFinite(Number(runtime.moon?.approach?.bPlaneErrorKm)),
    "runtime_diagnostics: B-plane error should be finite",
  );
  assert(
    String(runtime.moon?.approach?.lastDecision || "") === String(result.mode || ""),
    "runtime_diagnostics: last decision should match command mode",
  );
}

function testTelemetrySnapshotReacquireWindowHold() {
  const runtime = createPlannerRuntime();
  runCommand({
    phase: "tli_burn",
    plannerRuntime: runtime,
    timestampSec: 300,
    metrics: {
      moonDistanceKm: 386200,
      moonClosingSpeedKmS: 0.9,
      moonProjectedMissTrendKmS: 0.02,
      timeToPeriapsisSec: 1100,
    },
  });
  const result = runCommand({
    phase: "tli_burn",
    plannerRuntime: runtime,
    timestampSec: 323,
    metrics: {
      moonDistanceKm: 386188.2,
      moonClosingSpeedKmS: 1.0887,
      moonProjectedMissTrendKmS: 86.713,
      timeToPeriapsisSec: 900,
    },
  });
  assert(result, "telemetry_snapshot_reacquire_window: missing result");
  assert(result.phase === "coast", "telemetry_snapshot_reacquire_window: expected coast");
  assert(Number(result.throttle) === 0, "telemetry_snapshot_reacquire_window: expected zero throttle");
  assert(
    String(result.mode || "") === "navsys:gnc-lambert-tli-reacquire-window",
    `telemetry_snapshot_reacquire_window: unexpected mode ${result.mode}`,
  );
  assert(
    Boolean(result.diagnostics?.tliReacquireHold),
    "telemetry_snapshot_reacquire_window: expected reacquire hold true",
  );
  assert(
    !Boolean(result.diagnostics?.nearPeriapsisBurnWindow),
    "telemetry_snapshot_reacquire_window: periapsis burn window should be false",
  );
}

function testTelemetrySnapshotReacquireWindowProgression() {
  const runtime = createPlannerRuntime();
  const visited = [];

  const holdA = runCommand({
    phase: "tli_burn",
    plannerRuntime: runtime,
    timestampSec: 323,
    metrics: {
      moonDistanceKm: 386188.2,
      moonClosingSpeedKmS: 1.0887,
      moonProjectedMissTrendKmS: 86.713,
      timeToPeriapsisSec: 900,
    },
  });
  visited.push(String(holdA?.mode || ""));
  assert(holdA.phase === "coast", "telemetry_progression.holdA: expected coast");
  assert(
    String(holdA.mode || "").includes("navsys:gnc-lambert-tli-reacquire-window"),
    `telemetry_progression.holdA: unexpected mode ${holdA?.mode}`,
  );

  const holdB = runCommand({
    phase: "tli_burn",
    plannerRuntime: runtime,
    timestampSec: 340,
    metrics: {
      moonDistanceKm: 386160,
      moonClosingSpeedKmS: 1.02,
      moonProjectedMissTrendKmS: 74,
      timeToPeriapsisSec: 700,
    },
  });
  visited.push(String(holdB?.mode || ""));
  assert(holdB.phase === "coast", "telemetry_progression.holdB: expected coast");
  assert(
    String(holdB.mode || "").includes("navsys:gnc-lambert-tli-reacquire-window"),
    `telemetry_progression.holdB: unexpected mode ${holdB?.mode}`,
  );

  const burnA = runCommand({
    phase: "tli_burn",
    plannerRuntime: runtime,
    timestampSec: 430,
    metrics: {
      moonDistanceKm: 386120,
      moonClosingSpeedKmS: 0.95,
      moonProjectedMissTrendKmS: 81,
      timeToPeriapsisSec: 120,
    },
  });
  visited.push(String(burnA?.mode || ""));
  assert(burnA.phase === "powered", "telemetry_progression.burnA: expected powered");
  assert(
    String(burnA.mode || "").includes("navsys:gnc-lambert-tli-burn"),
    `telemetry_progression.burnA: unexpected mode ${burnA?.mode}`,
  );
  assert(
    String(burnA.mode || "").includes("+reacquire"),
    `telemetry_progression.burnA: expected reacquire tag in mode ${burnA?.mode}`,
  );
  assert(
    Number(burnA.throttle) > 0,
    `telemetry_progression.burnA: expected positive throttle, got ${burnA?.throttle}`,
  );

  const burnB = runCommand({
    phase: "tli_burn",
    plannerRuntime: runtime,
    timestampSec: 440,
    metrics: {
      moonDistanceKm: 386105,
      moonClosingSpeedKmS: 0.88,
      moonProjectedMissTrendKmS: 60,
      timeToPeriapsisSec: 90,
    },
  });
  visited.push(String(burnB?.mode || ""));
  assert(burnB.phase === "powered", "telemetry_progression.burnB: expected powered");
  assert(
    String(burnB.mode || "").includes("navsys:gnc-lambert-tli-burn"),
    `telemetry_progression.burnB: unexpected mode ${burnB?.mode}`,
  );
  assert(
    Number(burnB.throttle) > 0,
    `telemetry_progression.burnB: expected positive throttle, got ${burnB?.throttle}`,
  );

  assert(
    visited[0] !== visited[2],
    `telemetry_progression: expected state transition from hold to burn, visited=[${visited.join(" -> ")}]`,
  );
}

function main() {
  testTliReacquireHoldMovingAway();
  testTliReacquireHoldMissDivergingOnly();
  testNearPeriapsisOverridesReacquireHold();
  testMidcourseApproachCoastNearMoon();
  testRetargetCadenceDoesNotRetriggerEveryTick();
  testRuntimeDiagnosticsArePopulated();
  testTelemetrySnapshotReacquireWindowHold();
  testTelemetrySnapshotReacquireWindowProgression();
  console.log("PASS moon-gnc-conflict-e2e");
}

main();
