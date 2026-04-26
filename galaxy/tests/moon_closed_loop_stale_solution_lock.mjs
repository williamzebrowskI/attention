import { planMoonMissionCommand } from "../app/static/js/physics/navigation_system/planners/moonMissionPlanner.js";
import { createPlannerRuntime } from "../app/static/js/physics/navigation_system/planners/moonGuidanceState.js";
import { NAVIGATION_DEFAULTS } from "../app/static/js/physics/navigation_system/navigationSystemConfig.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function vectors(positionKm) {
  const moonEarthPositionKm = { x: 384_400, y: 0, z: 0 };
  const moonEarthVelocityKmS = { x: 0, y: 1.022, z: 0 };
  const shipEarthVelocityKmS = { x: 0, y: 7.82, z: 0 };
  return {
    tangent: { x: 0, y: 1, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    toMoon: { x: 1, y: 0, z: 0 },
    toEarth: { x: -1, y: 0, z: 0 },
    shipEarthPositionKm: positionKm,
    shipEarthVelocityKmS,
    moonEarthPositionKm,
    moonEarthVelocityKmS,
    sunEarthPositionKm: { x: 149_597_870, y: 0, z: 0 },
    sunEarthVelocityKmS: { x: 0, y: 29.78, z: 0 },
    shipMinusMoonRelativeVelocityKmS: {
      x: shipEarthVelocityKmS.x - moonEarthVelocityKmS.x,
      y: shipEarthVelocityKmS.y - moonEarthVelocityKmS.y,
      z: shipEarthVelocityKmS.z - moonEarthVelocityKmS.z,
    },
    moonMinusShipRelativeVelocityKmS: {
      x: moonEarthVelocityKmS.x - shipEarthVelocityKmS.x,
      y: moonEarthVelocityKmS.y - shipEarthVelocityKmS.y,
      z: moonEarthVelocityKmS.z - shipEarthVelocityKmS.z,
    },
  };
}

function metrics(overrides = {}) {
  return {
    earthDistanceKm: 6_556,
    earthRadialSpeedKmS: 0,
    moonDistanceKm: 385_000,
    moonAltitudeKm: 383_200,
    moonClosingSpeedKmS: 0.05,
    moonRelativeSpeedKmS: 7.4,
    moonCircularSpeedKmS: 1.6,
    moonProjectedMissDistanceKm: 160_000,
    moonProjectedMissTrendKmS: 0.02,
    apoapsisKm: 500,
    periapsisKm: 180,
    timeToPeriapsisSec: 900,
    timeToApoapsisSec: 900,
    stageMassKg: 1_100_000,
    engineAccelAtThrottle1KmS2: 0.0095,
    bodyId: "test_starship_stale_solution",
    ...overrides,
  };
}

function main() {
  const runtime = createPlannerRuntime();
  const plannerConfig = {
    ...NAVIGATION_DEFAULTS.planner,
    moonClosedLoopSolveCadenceSec: 10_000,
  };
  const first = planMoonMissionCommand({
    phase: "tli_burn",
    targetVectors: vectors({ x: 6_556, y: 0, z: 0 }),
    metrics: metrics(),
    plannerConfig,
    estimatorConfig: NAVIGATION_DEFAULTS.estimator,
    plannerRuntime: runtime,
    timestampSec: 0,
  });
  assert(first, "stale_solution: missing initial command");
  assert(runtime.moon.gnc.solution, "stale_solution: expected initial closed-loop solution");

  const second = planMoonMissionCommand({
    phase: "tli_burn",
    targetVectors: vectors({ x: 6_556, y: 2_400, z: 0 }),
    metrics: metrics({
      earthDistanceKm: 6_982,
      moonProjectedMissDistanceKm: 120_000,
      moonProjectedMissTrendKmS: 0.08,
    }),
    plannerConfig,
    estimatorConfig: NAVIGATION_DEFAULTS.estimator,
    plannerRuntime: runtime,
    timestampSec: 60,
  });
  assert(second, "stale_solution: missing second command");
  assert(
    second.diagnostics?.solutionInvalidatedForStateDrift === true,
    "stale_solution: expected stale transfer solve to be invalidated after estimated-state drift",
  );
  assert(
    Number(second.diagnostics?.solutionStateDriftKm) > 25,
    `stale_solution: expected meaningful state drift, got ${second.diagnostics?.solutionStateDriftKm}`,
  );

  console.log("PASS moon-closed-loop-stale-solution-lock");
}

main();
