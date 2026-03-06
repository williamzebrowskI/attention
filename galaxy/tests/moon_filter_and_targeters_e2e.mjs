import { planMoonMissionCommand } from "../app/static/js/physics/navigation_system/planners/moonMissionPlanner.js";
import { createPlannerRuntime } from "../app/static/js/physics/navigation_system/planners/moonGuidanceState.js";
import { NAVIGATION_DEFAULTS } from "../app/static/js/physics/navigation_system/navigationSystemConfig.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function earthDepartureVectors() {
  return {
    tangent: { x: 0, y: 1, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    toMoon: { x: 1, y: 0, z: 0 },
    toEarth: { x: -1, y: 0, z: 0 },
    shipEarthPositionKm: { x: 6556, y: 0, z: 0 },
    shipEarthVelocityKmS: { x: 0, y: 7.82, z: 0 },
    moonEarthPositionKm: { x: 384400, y: 0, z: 0 },
    moonEarthVelocityKmS: { x: 0, y: 1.022, z: 0 },
    sunEarthPositionKm: { x: 149597870, y: 0, z: 0 },
    sunEarthVelocityKmS: { x: 0, y: 29.78, z: 0 },
    shipMinusMoonRelativeVelocityKmS: { x: 0, y: 6.798, z: 0 },
    moonMinusShipRelativeVelocityKmS: { x: 0, y: -6.798, z: 0 },
  };
}

function moonLocalVectors() {
  const moonEarthPositionKm = { x: 384400, y: 0, z: 0 };
  const moonEarthVelocityKmS = { x: 0, y: 1.022, z: 0 };
  const relativePositionKm = { x: -4200, y: 0, z: 0 };
  const relativeVelocityKmS = { x: 0, y: 1.65, z: 0.04 };
  return {
    tangent: { x: 0, y: 1, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    toMoon: { x: 1, y: 0, z: 0 },
    toEarth: { x: -1, y: 0, z: 0 },
    shipEarthPositionKm: {
      x: moonEarthPositionKm.x + relativePositionKm.x,
      y: moonEarthPositionKm.y + relativePositionKm.y,
      z: moonEarthPositionKm.z + relativePositionKm.z,
    },
    shipEarthVelocityKmS: {
      x: moonEarthVelocityKmS.x + relativeVelocityKmS.x,
      y: moonEarthVelocityKmS.y + relativeVelocityKmS.y,
      z: moonEarthVelocityKmS.z + relativeVelocityKmS.z,
    },
    moonEarthPositionKm,
    moonEarthVelocityKmS,
    sunEarthPositionKm: { x: 149597870, y: 0, z: 0 },
    sunEarthVelocityKmS: { x: 0, y: 29.78, z: 0 },
    shipMinusMoonRelativeVelocityKmS: relativeVelocityKmS,
    moonMinusShipRelativeVelocityKmS: {
      x: -relativeVelocityKmS.x,
      y: -relativeVelocityKmS.y,
      z: -relativeVelocityKmS.z,
    },
  };
}

function earthReturnVectors() {
  return {
    tangent: { x: 0, y: 1, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    toMoon: { x: 1, y: 0, z: 0 },
    toEarth: { x: -1, y: 0, z: 0 },
    shipEarthPositionKm: { x: 7200, y: 0, z: 0 },
    shipEarthVelocityKmS: { x: 0, y: 10.6, z: 0.1 },
    moonEarthPositionKm: { x: 384400, y: 0, z: 0 },
    moonEarthVelocityKmS: { x: 0, y: 1.022, z: 0 },
    sunEarthPositionKm: { x: 149597870, y: 0, z: 0 },
    sunEarthVelocityKmS: { x: 0, y: 29.78, z: 0 },
    shipMinusMoonRelativeVelocityKmS: { x: 0, y: 9.578, z: 0.1 },
    moonMinusShipRelativeVelocityKmS: { x: 0, y: -9.578, z: -0.1 },
  };
}

function baseMetrics(overrides = {}) {
  return {
    earthDistanceKm: 7000,
    earthRadialSpeedKmS: 0,
    moonDistanceKm: 385000,
    moonAltitudeKm: 383200,
    moonClosingSpeedKmS: 0.05,
    moonRelativeSpeedKmS: 7.4,
    moonCircularSpeedKmS: 1.6,
    moonProjectedMissDistanceKm: 160000,
    moonProjectedMissTrendKmS: 0.02,
    apoapsisKm: 200,
    periapsisKm: 180,
    timeToPeriapsisSec: 900,
    timeToApoapsisSec: 900,
    stageMassKg: 1_100_000,
    engineAccelAtThrottle1KmS2: 0.0095,
    bodyId: "test_starship",
    ...overrides,
  };
}

function testMoonFilterStateAndCovariance() {
  const runtime = createPlannerRuntime();
  const vectors = earthDepartureVectors();
  const metrics = baseMetrics();

  const first = planMoonMissionCommand({
    phase: "tli_burn",
    targetVectors: vectors,
    metrics,
    plannerConfig: NAVIGATION_DEFAULTS.planner,
    estimatorConfig: NAVIGATION_DEFAULTS.estimator,
    plannerRuntime: runtime,
    timestampSec: 0,
  });
  const second = planMoonMissionCommand({
    phase: "tli_burn",
    targetVectors: vectors,
    metrics: { ...metrics, moonProjectedMissTrendKmS: 0.05 },
    plannerConfig: NAVIGATION_DEFAULTS.planner,
    estimatorConfig: NAVIGATION_DEFAULTS.estimator,
    plannerRuntime: runtime,
    timestampSec: 60,
  });

  assert(first && second, "filter_state: missing command");
  assert(runtime.moon.filter && runtime.moon.filter.estimate, "filter_state: missing filter estimate");
  assert(Number.isFinite(Number(runtime.moon.filter.covariance?.px)), "filter_state: covariance px missing");
  assert(Number.isFinite(Number(runtime.moon.filter.covariance?.vx)), "filter_state: covariance vx missing");
  assert(
    String(runtime.moon.filter.lastMeasurement?.source || "") === "simulated_dsn_star_tracker",
    `filter_state: unexpected measurement source ${runtime.moon.filter.lastMeasurement?.source}`,
  );
  assert(
    Number.isFinite(Number(runtime.moon.filter.lastMeasurement?.positionResidualKm)),
    "filter_state: position residual missing",
  );
  assert(
    Number.isFinite(Number(runtime.moon.filter.lastMeasurement?.velocityResidualKmS)),
    "filter_state: velocity residual missing",
  );
}

function testLoiTargeterIsActive() {
  const runtime = createPlannerRuntime();
  const result = planMoonMissionCommand({
    phase: "lunar_insertion",
    targetVectors: moonLocalVectors(),
    metrics: baseMetrics({
      moonDistanceKm: 4200,
      moonAltitudeKm: 2462.6,
      moonClosingSpeedKmS: 0.12,
      moonRelativeSpeedKmS: 1.65,
      moonCircularSpeedKmS: 1.1,
      stageMassKg: 950_000,
      engineAccelAtThrottle1KmS2: 0.0105,
    }),
    plannerConfig: NAVIGATION_DEFAULTS.planner,
    estimatorConfig: NAVIGATION_DEFAULTS.estimator,
    plannerRuntime: runtime,
    timestampSec: 120,
  });
  assert(result, "loi_targeter: missing command");
  assert(result.phase === "powered", "loi_targeter: expected powered burn");
  assert(
    String(result.diagnostics?.requestedMode || "") === "nbody-loi-targeter",
    `loi_targeter: unexpected requested mode ${result.diagnostics?.requestedMode}`,
  );
}

function testTeiTargeterIsActive() {
  const runtime = createPlannerRuntime();
  const result = planMoonMissionCommand({
    phase: "tei_burn",
    targetVectors: moonLocalVectors(),
    metrics: baseMetrics({
      earthDistanceKm: 384000,
      earthRadialSpeedKmS: 0.18,
      moonDistanceKm: 4800,
      moonAltitudeKm: 3062.6,
      moonClosingSpeedKmS: -0.02,
      moonRelativeSpeedKmS: 1.7,
      stageMassKg: 900_000,
      engineAccelAtThrottle1KmS2: 0.011,
    }),
    plannerConfig: NAVIGATION_DEFAULTS.planner,
    estimatorConfig: NAVIGATION_DEFAULTS.estimator,
    plannerRuntime: runtime,
    timestampSec: 180,
  });
  assert(result, "tei_targeter: missing command");
  assert(
    String(result.diagnostics?.requestedMode || "") === "nbody-tei-targeter",
    `tei_targeter: unexpected requested mode ${result.diagnostics?.requestedMode}`,
  );
}

function testEarthCaptureTargeterIsActive() {
  const runtime = createPlannerRuntime();
  const result = planMoonMissionCommand({
    phase: "earth_capture",
    targetVectors: earthReturnVectors(),
    metrics: baseMetrics({
      earthDistanceKm: 7200,
      earthRadialSpeedKmS: -0.8,
      moonDistanceKm: 377200,
      moonAltitudeKm: 375462.6,
      moonClosingSpeedKmS: 0.01,
      moonRelativeSpeedKmS: 9.6,
      stageMassKg: 850_000,
      engineAccelAtThrottle1KmS2: 0.012,
    }),
    plannerConfig: NAVIGATION_DEFAULTS.planner,
    estimatorConfig: NAVIGATION_DEFAULTS.estimator,
    plannerRuntime: runtime,
    timestampSec: 240,
  });
  assert(result, "earth_capture_targeter: missing command");
  assert(result.phase === "powered", "earth_capture_targeter: expected powered burn");
  assert(
    String(result.diagnostics?.requestedMode || "") === "nbody-earth-capture-targeter",
    `earth_capture_targeter: unexpected requested mode ${result.diagnostics?.requestedMode}`,
  );
}

function main() {
  testMoonFilterStateAndCovariance();
  testLoiTargeterIsActive();
  testTeiTargeterIsActive();
  testEarthCaptureTargeterIsActive();
  console.log("PASS moon-filter-and-targeters-e2e");
}

main();
