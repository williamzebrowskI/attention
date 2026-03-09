import { planMoonMissionGncCommand } from "../app/static/js/physics/navigation_system/gnc/moonMissionGncStack.js";
import {
  doesMoonCorridorCandidateImproveCommittedPlan,
  evaluateMoonPassiveCoastEligibility,
  shouldBridgeDeparturePlanIntoEarlyCoast,
} from "../app/static/js/physics/navigation_system/lunar/moonClosedLoopTargeters.js";
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
  targetVectors = {},
  plannerRuntime = createPlannerRuntime(),
  timestampSec = 0,
}) {
  return planMoonMissionGncCommand({
    phase,
    targetVectors: {
      ...baseTargetVectors(),
      ...targetVectors,
    },
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
    String(result.mode || "").includes("navsys:gnc-lambert-tli-hold"),
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
    String(result.mode || "").includes("navsys:gnc-lambert-tli-hold"),
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
    String(result.mode || "").includes("navsys:gnc-lambert-midcourse-coast"),
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

function testEarlyCoastNoLegacyDepartureHold() {
  const runtime = createPlannerRuntime();
  const result = runCommand({
    phase: "coast_to_moon",
    plannerRuntime: runtime,
    timestampSec: 600,
    targetVectors: {
      departurePlanBurnDirectionKm: { x: 0.15, y: 0.988, z: 0.02 },
      shipEarthPositionKm: { x: 15000, y: 0, z: 0 },
      shipEarthVelocityKmS: { x: 0, y: 10.2, z: 0 },
    },
    metrics: {
      moonDistanceKm: 390600,
      moonClosingSpeedKmS: 0.24,
      moonProjectedMissTrendKmS: 0,
      timeToPeriapsisSec: 999999,
      missionPhaseElapsedSec: 600,
      departurePlanReady: true,
      departurePlanThrottle: 1,
      departurePlanBurnDurationSec: 834,
      departurePlanCommitWindowSec: 105,
      departurePlanPredictedMissDistanceKm: 8200,
      departurePlanPredictedPeriluneAltitudeKm: 283,
      departurePlanBPlaneErrorKm: 2685,
      departurePlanGeometryScore: 0.95,
      departurePlanAlignNow: 0.8,
      earthDistanceKm: 18000,
      periapsisKm: 250,
      stageMassKg: 1_500_000,
      engineAccelAtThrottle1KmS2: 0.01,
    },
  });
  assert(result, "early_coast_no_legacy_hold: missing result");
  assert(
    !String(result.mode || "").includes("departure-hold"),
    `early_coast_no_legacy_hold: expected legacy departure hold to be removed, got ${result.mode}`,
  );
  assert(
    String(result.mode || "").includes("midcourse"),
    `early_coast_no_legacy_hold: expected lunar coast guidance family, got ${result.mode}`,
  );
}

function testEarlyCoastDepartureBridgePrefersAcceptedTliCorridor() {
  const bridgeActive = shouldBridgeDeparturePlanIntoEarlyCoast({
    phaseName: "coast_to_moon",
    missionPhaseElapsedSec: 45,
    moonClosingSpeedKmS: 3.9,
    predictedMissDistanceKm: 361_000,
    predictedPeriluneAltitudeKm: 374_000,
    bPlaneErrorKm: 374_000,
    departurePlanCorridorAcceptable: true,
    departurePlanDirection: { x: 0.18, y: 0.98, z: 0.06 },
    departurePlanPredictedMissDistanceKm: 8_400,
    departurePlanPredictedPeriluneAltitudeKm: 290,
    departurePlanBPlaneErrorKm: 2_700,
    missGateKm: 95_000,
    plannerConfig: NAVIGATION_DEFAULTS.planner,
  });
  assert(
    bridgeActive,
    "early_coast_departure_bridge: expected early coast to preserve accepted departure corridor",
  );
}

function testEarlyCoastDepartureBridgeReleasesWhenLateAndDiverging() {
  const bridgeActive = shouldBridgeDeparturePlanIntoEarlyCoast({
    phaseName: "coast_to_moon",
    missionPhaseElapsedSec: 2_400,
    moonClosingSpeedKmS: -0.1,
    predictedMissDistanceKm: 361_000,
    predictedPeriluneAltitudeKm: 374_000,
    bPlaneErrorKm: 374_000,
    departurePlanCorridorAcceptable: true,
    departurePlanDirection: { x: 0.18, y: 0.98, z: 0.06 },
    departurePlanPredictedMissDistanceKm: 8_400,
    departurePlanPredictedPeriluneAltitudeKm: 290,
    departurePlanBPlaneErrorKm: 2_700,
    missGateKm: 95_000,
    plannerConfig: NAVIGATION_DEFAULTS.planner,
  });
  assert(
    !bridgeActive,
    "early_coast_departure_bridge_release: expected late diverging coast to stop preserving departure corridor",
  );
}

function testCommittedDepartureCorridorRejectsCatastrophicLiveReplacement() {
  const improves = doesMoonCorridorCandidateImproveCommittedPlan({
    candidatePredictedMissDistanceKm: 361_000,
    candidatePredictedPeriluneAltitudeKm: 374_000,
    candidateBPlaneErrorKm: 374_000,
    departurePlanPredictedMissDistanceKm: 8_400,
    departurePlanPredictedPeriluneAltitudeKm: 290,
    departurePlanBPlaneErrorKm: 2_700,
    plannerConfig: NAVIGATION_DEFAULTS.planner,
  });
  assert(
    !improves,
    "committed_departure_corridor_lock: catastrophic live solution should not replace accepted departure plan",
  );
}

function testCommittedDepartureCorridorAllowsMaterialImprovement() {
  const improves = doesMoonCorridorCandidateImproveCommittedPlan({
    candidatePredictedMissDistanceKm: 7_100,
    candidatePredictedPeriluneAltitudeKm: 220,
    candidateBPlaneErrorKm: 2_050,
    departurePlanPredictedMissDistanceKm: 8_400,
    departurePlanPredictedPeriluneAltitudeKm: 290,
    departurePlanBPlaneErrorKm: 2_700,
    plannerConfig: NAVIGATION_DEFAULTS.planner,
  });
  assert(
    improves,
    "committed_departure_corridor_lock: materially better live solution should be allowed to replace accepted departure plan",
  );
}

function testLateCoastDepartureHoldReleasesWhenMovingAway() {
  const runtime = createPlannerRuntime();
  const result = runCommand({
    phase: "coast_to_moon",
    plannerRuntime: runtime,
    timestampSec: 2400,
    targetVectors: {
      departurePlanBurnDirectionKm: { x: 0.15, y: 0.988, z: 0.02 },
      shipEarthPositionKm: { x: 15000, y: 0, z: 0 },
      shipEarthVelocityKmS: { x: 0, y: 10.2, z: 0 },
    },
    metrics: {
      moonDistanceKm: 390600,
      moonClosingSpeedKmS: -0.24,
      moonProjectedMissTrendKmS: 0,
      timeToPeriapsisSec: 999999,
      missionPhaseElapsedSec: 2400,
      departurePlanReady: true,
      departurePlanThrottle: 1,
      departurePlanBurnDurationSec: 834,
      departurePlanCommitWindowSec: 105,
      departurePlanPredictedMissDistanceKm: 8200,
      departurePlanPredictedPeriluneAltitudeKm: 283,
      departurePlanBPlaneErrorKm: 2685,
      departurePlanGeometryScore: 0.95,
      departurePlanAlignNow: 0.8,
      earthDistanceKm: 18000,
      periapsisKm: 250,
      stageMassKg: 1_500_000,
      engineAccelAtThrottle1KmS2: 0.01,
    },
  });
  assert(result, "late_coast_departure_release: missing result");
  assert(
    !String(result.mode || "").includes("navsys:gnc-lambert-midcourse-coast"),
    `late_coast_departure_release: late diverging coast should not stay in passive coast, got ${result.mode}`,
  );
  assert(result.phase === "powered", `late_coast_departure_release: expected powered correction, got ${result.phase}`);
  assert(Number(result.throttle) > 0, `late_coast_departure_release: expected positive throttle, got ${result.throttle}`);
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
    String(result.mode || "") === "navsys:gnc-lambert-tli-hold",
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
    String(holdA.mode || "").includes("navsys:gnc-lambert-tli-hold"),
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
    String(holdB.mode || "").includes("navsys:gnc-lambert-tli-hold"),
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

function testDepartureCommitOverridesEarlyTliHold() {
  const runtime = createPlannerRuntime();
  const result = runCommand({
    phase: "tli_burn",
    plannerRuntime: runtime,
    timestampSec: 25,
    targetVectors: {
      departurePlanBurnDirectionKm: { x: 0.19, y: 0.98, z: 0.02 },
    },
    metrics: {
      missionPhaseElapsedSec: 25,
      moonDistanceKm: 391745.7,
      moonClosingSpeedKmS: 7.529,
      moonProjectedMissTrendKmS: 435.286,
      timeToPeriapsisSec: 1180,
      departurePlanReady: true,
      departurePlanThrottle: 0.655,
      departurePlanBurnDurationSec: 1380,
      departurePlanCommitWindowSec: 165,
      departurePlanPredictedMissDistanceKm: 55123.5,
      departurePlanPredictedPeriluneAltitudeKm: 120,
      departurePlanBPlaneErrorKm: 38000,
      departurePlanGeometryScore: 0.956,
      departurePlanAlignNow: 0.978,
    },
  });
  assert(result, "departure_commit_early_tli: missing result");
  assert(result.phase === "powered", "departure_commit_early_tli: expected powered burn");
  assert(
    String(result.mode || "").includes("navsys:gnc-lambert-tli-burn+departure-commit"),
    `departure_commit_early_tli: unexpected mode ${result.mode}`,
  );
  assert(
    Number(result.throttle) > 0.6,
    `departure_commit_early_tli: expected departure-plan throttle, got ${result.throttle}`,
  );
  assert(
    Boolean(result.diagnostics?.departureCommitActive),
    "departure_commit_early_tli: expected departure commit to be active",
  );
  assert(
    !Boolean(result.diagnostics?.tliReacquireHold),
    "departure_commit_early_tli: reacquire hold should be suppressed",
  );
}

function testDepartureCommitUsesLiveDiagnosticsNotSeedTelemetry() {
  const runtime = createPlannerRuntime();
  const result = runCommand({
    phase: "tli_burn",
    plannerRuntime: runtime,
    timestampSec: 22,
    metrics: {
      missionPhaseElapsedSec: 22,
      moonDistanceKm: 391956.5,
      moonClosingSpeedKmS: 7.5517,
      moonProjectedMissTrendKmS: 466.332,
      timeToPeriapsisSec: 1200,
      departurePlanReady: true,
      departurePlanThrottle: 0.78,
      departurePlanBurnDurationSec: 1200,
      departurePlanCommitWindowSec: 180,
      departurePlanPredictedMissDistanceKm: 148079302,
      departurePlanPredictedPeriluneAltitudeKm: 148077564.6,
      departurePlanBPlaneErrorKm: 145677093.2,
      departurePlanGeometryScore: 0.956,
      departurePlanAlignNow: 0.977,
      earthDistanceKm: 6555.84,
      periapsisKm: 183.58,
      stageMassKg: 4_945_637,
      engineAccelAtThrottle1KmS2: 0.0159,
    },
    targetVectors: {
      departurePlanBurnDirectionKm: { x: 0.19, y: 0.98, z: 0.02 },
      shipEarthPositionKm: { x: 6555.84, y: 0, z: 0 },
      shipEarthVelocityKmS: { x: 0, y: 7.8564, z: 0 },
      moonEarthPositionKm: { x: 391956.5, y: 0, z: 0 },
      moonEarthVelocityKmS: { x: 0, y: 1.022, z: 0 },
      sunEarthPositionKm: { x: 149597870, y: 0, z: 0 },
      sunEarthVelocityKmS: { x: 0, y: 29.78, z: 0 },
    },
  });
  assert(result, "departure_commit_live_diag: missing result");
  assert(
    Number(result.diagnostics?.missDistanceKm) < 2_000_000,
    `departure_commit_live_diag: miss should use live bounded solve, got ${result.diagnostics?.missDistanceKm}`,
  );
  assert(
    Number(result.diagnostics?.periluneEstimateKm) < 2_000_000,
    `departure_commit_live_diag: perilune should use live bounded solve, got ${result.diagnostics?.periluneEstimateKm}`,
  );
  assert(
    Number(result.diagnostics?.bPlaneErrorKm) < 2_000_000,
    `departure_commit_live_diag: B-plane should use live bounded solve, got ${result.diagnostics?.bPlaneErrorKm}`,
  );
  assert(
    !Boolean(result.diagnostics?.departureCommitActive),
    "departure_commit_live_diag: invalid seed corridor should not keep departure commit active",
  );
}

function testDepartureCommitRejectsBadCorridorSeed() {
  const runtime = createPlannerRuntime();
  const result = runCommand({
    phase: "tli_burn",
    plannerRuntime: runtime,
    timestampSec: 317,
    metrics: {
      missionPhaseElapsedSec: 317,
      moonDistanceKm: 389850.9,
      moonClosingSpeedKmS: 6.6923,
      moonProjectedMissTrendKmS: 410.837,
      timeToPeriapsisSec: 900,
      departurePlanReady: true,
      departurePlanThrottle: 0.78,
      departurePlanBurnDurationSec: 1200,
      departurePlanCommitWindowSec: 360,
      departurePlanPredictedMissDistanceKm: 384340.9,
      departurePlanPredictedPeriluneAltitudeKm: 382603.5,
      departurePlanBPlaneErrorKm: 382436.0,
      departurePlanGeometryScore: 0.956,
      departurePlanAlignNow: 0.978,
      earthDistanceKm: 6555.0,
      periapsisKm: 177.54,
      stageMassKg: 4_508_919,
      engineAccelAtThrottle1KmS2: 0.0159,
    },
    targetVectors: {
      departurePlanBurnDirectionKm: { x: 0.19, y: 0.98, z: 0.02 },
      shipEarthPositionKm: { x: 6555.0, y: 0, z: 0 },
      shipEarthVelocityKmS: { x: 0, y: 8.1654, z: 0 },
      moonEarthPositionKm: { x: 391956.5, y: 0, z: 0 },
      moonEarthVelocityKmS: { x: 0, y: 1.022, z: 0 },
      sunEarthPositionKm: { x: 149597870, y: 0, z: 0 },
      sunEarthVelocityKmS: { x: 0, y: 29.78, z: 0 },
    },
  });
  assert(result, "departure_commit_bad_corridor: missing result");
  assert(
    !Boolean(result.diagnostics?.departureCommitActive),
    "departure_commit_bad_corridor: bad corridor should not activate departure commit",
  );
  assert(
    !String(result.mode || "").includes("+departure-commit"),
    `departure_commit_bad_corridor: unexpected departure commit mode ${result.mode}`,
  );
}

function testLateCoastWeakClosureTriggersRescueCorrection() {
  const runtime = createPlannerRuntime();
  const result = runCommand({
    phase: "coast_to_moon",
    plannerRuntime: runtime,
    timestampSec: 2700,
    targetVectors: {
      departurePlanBurnDirectionKm: { x: 0.18, y: 0.983, z: 0.02 },
      shipEarthPositionKm: { x: 26_000, y: 7_500, z: 0 },
      shipEarthVelocityKmS: { x: 0.15, y: 10.45, z: 0.01 },
      moonEarthPositionKm: { x: 355_000, y: 128_000, z: 9_000 },
      moonEarthVelocityKmS: { x: -0.35, y: 0.94, z: 0.01 },
    },
    metrics: {
      moonDistanceKm: 390_500,
      moonClosingSpeedKmS: 0.03,
      moonProjectedMissTrendKmS: 0.18,
      timeToPeriapsisSec: 999999,
      missionPhaseElapsedSec: 2700,
      departurePlanReady: true,
      departurePlanThrottle: 1,
      departurePlanBurnDurationSec: 834,
      departurePlanCommitWindowSec: 105,
      departurePlanPredictedMissDistanceKm: 8_300,
      departurePlanPredictedPeriluneAltitudeKm: 280,
      departurePlanBPlaneErrorKm: 2_700,
      departurePlanGeometryScore: 0.95,
      departurePlanAlignNow: 0.8,
      earthDistanceKm: 27_000,
      periapsisKm: 245,
      stageMassKg: 1_450_000,
      engineAccelAtThrottle1KmS2: 0.01,
    },
  });
  assert(result, "late_coast_weak_closure_rescue: missing result");
  assert(
    !String(result.mode || "").includes("navsys:gnc-lambert-midcourse-coast"),
    `late_coast_weak_closure_rescue: expected passive coast to release, got ${result.mode}`,
  );
  assert(
    result.phase === "powered",
    `late_coast_weak_closure_rescue: expected powered correction, got ${result.phase}`,
  );
  assert(
    Number(result.throttle) >= 0.15,
    `late_coast_weak_closure_rescue: expected meaningful correction throttle, got ${result.throttle}`,
  );
}

function testPassiveCoastRejectedForCatastrophicLiveCorridor() {
  const eligibility = evaluateMoonPassiveCoastEligibility({
    phaseName: "coast_to_moon",
    predictedMissDistanceKm: 333_424.4,
    predictedPeriluneAltitudeKm: 330_871.9,
    bPlaneErrorKm: 330_751.9,
    deltaVNeedKmS: 0.001,
    moonClosingSpeedKmS: 3.472,
    missTrendKmS: -0.023,
    plannerConfig: NAVIGATION_DEFAULTS.planner,
    missGateKm: 95_000,
  });
  assert(eligibility, "passive_coast_bad_corridor: missing eligibility");
  assert(
    !eligibility.corridorAccepted,
    "passive_coast_bad_corridor: catastrophic live corridor should not be accepted",
  );
  assert(
    !eligibility.allowPassiveCoast,
    "passive_coast_bad_corridor: passive coast should be disallowed for catastrophic live corridor",
  );
}

function main() {
  testTliReacquireHoldMovingAway();
  testTliReacquireHoldMissDivergingOnly();
  testNearPeriapsisOverridesReacquireHold();
  testMidcourseApproachCoastNearMoon();
  testRetargetCadenceDoesNotRetriggerEveryTick();
testRuntimeDiagnosticsArePopulated();
testEarlyCoastNoLegacyDepartureHold();
testEarlyCoastDepartureBridgePrefersAcceptedTliCorridor();
testEarlyCoastDepartureBridgeReleasesWhenLateAndDiverging();
testCommittedDepartureCorridorRejectsCatastrophicLiveReplacement();
testCommittedDepartureCorridorAllowsMaterialImprovement();
testLateCoastDepartureHoldReleasesWhenMovingAway();
  testTelemetrySnapshotReacquireWindowHold();
  testTelemetrySnapshotReacquireWindowProgression();
  testDepartureCommitOverridesEarlyTliHold();
  testDepartureCommitUsesLiveDiagnosticsNotSeedTelemetry();
  testDepartureCommitRejectsBadCorridorSeed();
  testLateCoastWeakClosureTriggersRescueCorrection();
  testPassiveCoastRejectedForCatastrophicLiveCorridor();
  console.log("PASS moon-gnc-conflict-e2e");
}

main();
