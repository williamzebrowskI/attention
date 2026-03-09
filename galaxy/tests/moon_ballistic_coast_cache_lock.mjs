import { planMoonMissionGncCommand } from "../app/static/js/physics/navigation_system/gnc/moonMissionGncStack.js";
import { NAVIGATION_DEFAULTS } from "../app/static/js/physics/navigation_system/navigationSystemConfig.js";
import { createPlannerRuntime } from "../app/static/js/physics/navigation_system/planners/moonGuidanceState.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function baseTargetVectors() {
  const shipEarthPositionKm = { x: 12000, y: 22000, z: 3000 };
  const shipEarthVelocityKmS = { x: -1.2, y: 8.6, z: 0.2 };
  const moonEarthPositionKm = { x: 384400, y: 20000, z: -5000 };
  const moonEarthVelocityKmS = { x: -0.1, y: 1.022, z: 0.01 };
  return {
    tangent: { x: 0, y: 1, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    toMoon: { x: 0.78, y: 0.62, z: -0.03 },
    shipEarthPositionKm,
    shipEarthVelocityKmS,
    moonEarthPositionKm,
    moonEarthVelocityKmS,
  };
}

function baseMetrics(overrides = {}) {
  return {
    moonDistanceKm: 394000,
    moonClosingSpeedKmS: 3.7,
    moonProjectedMissTrendKmS: 0,
    timeToPeriapsisSec: 10000,
    moonRadiusKm: 1737.4,
    predictedMissDistanceKm: 9000,
    predictedPeriluneAltitudeKm: 320,
    bPlaneErrorKm: 3000,
    ...overrides,
  };
}

function runCommand({ plannerRuntime, timestampSec }) {
  return planMoonMissionGncCommand({
    phase: "coast_to_moon",
    targetVectors: baseTargetVectors(),
    metrics: baseMetrics(),
    plannerConfig: NAVIGATION_DEFAULTS.planner,
    plannerRuntime,
    timestampSec,
  });
}

function main() {
  const runtime = createPlannerRuntime();

  const first = runCommand({ plannerRuntime: runtime, timestampSec: 1000 });
  const firstEvalSec = runtime.moon.gnc.ballisticCoastEvalSec;
  assert(
    Number.isFinite(firstEvalSec),
    "moon_ballistic_coast_cache_lock: expected first ballistic coast evaluation timestamp",
  );
  assert(
    String(first?.mode || "").includes("navsys:gnc-lambert-midcourse"),
    `moon_ballistic_coast_cache_lock: unexpected first mode ${first?.mode}`,
  );

  runCommand({ plannerRuntime: runtime, timestampSec: 1005 });
  const secondEvalSec = runtime.moon.gnc.ballisticCoastEvalSec;
  assert(
    secondEvalSec === firstEvalSec,
    `moon_ballistic_coast_cache_lock: expected cached ballistic evaluation within cadence, got ${firstEvalSec} then ${secondEvalSec}`,
  );

  runCommand({ plannerRuntime: runtime, timestampSec: 1027 });
  const thirdEvalSec = runtime.moon.gnc.ballisticCoastEvalSec;
  assert(
    Number.isFinite(thirdEvalSec) && thirdEvalSec > secondEvalSec,
    `moon_ballistic_coast_cache_lock: expected ballistic evaluation refresh after cadence, got ${secondEvalSec} then ${thirdEvalSec}`,
  );

  console.log("PASS moon-ballistic-coast-cache-lock");
}

main();
