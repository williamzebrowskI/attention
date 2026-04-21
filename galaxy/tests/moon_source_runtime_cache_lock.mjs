import { planMoonMissionCommand } from "../app/static/js/physics/navigation_system/planners/moonMissionPlanner.js";
import { createPlannerRuntime } from "../app/static/js/physics/navigation_system/planners/moonGuidanceState.js";
import { NAVIGATION_DEFAULTS } from "../app/static/js/physics/navigation_system/navigationSystemConfig.js";
import { sampleMoonGuidanceSourceModelAtTimeSec } from "../app/static/js/physics/runtime/index.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function subtract(a, b) {
  return {
    x: (Number(a?.x) || 0) - (Number(b?.x) || 0),
    y: (Number(a?.y) || 0) - (Number(b?.y) || 0),
    z: (Number(a?.z) || 0) - (Number(b?.z) || 0),
  };
}

function length(vector) {
  return Math.sqrt(
    ((Number(vector?.x) || 0) ** 2)
    + ((Number(vector?.y) || 0) ** 2)
    + ((Number(vector?.z) || 0) ** 2)
  );
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

function main() {
  const runtime = createPlannerRuntime();
  const initialVectors = earthDepartureVectors();
  const metrics = baseMetrics();

  const first = planMoonMissionCommand({
    phase: "tli_burn",
    targetVectors: initialVectors,
    metrics,
    plannerConfig: NAVIGATION_DEFAULTS.planner,
    estimatorConfig: NAVIGATION_DEFAULTS.estimator,
    plannerRuntime: runtime,
    timestampSec: 0,
  });
  assert(first, "expected initial moon mission command");

  const firstCache = runtime.moon?.gnc?.sourceModelCache;
  assert(firstCache?.ephemeris?.samples?.length > 3, "expected first solve to populate source cache");
  assert(runtime.moon?.gnc?.sourceModelCacheTimestampSec === 0, "expected initial cache timestamp 0");

  const advancedSources = sampleMoonGuidanceSourceModelAtTimeSec(firstCache, 60);
  assert(advancedSources?.moon && advancedSources?.sun, "expected advanced cached moon/sun sources");

  const secondVectors = {
    ...initialVectors,
    moonEarthPositionKm: advancedSources.moon.positionKm,
    moonEarthVelocityKmS: advancedSources.moon.velocityKmS,
    sunEarthPositionKm: advancedSources.sun.positionKm,
    sunEarthVelocityKmS: advancedSources.sun.velocityKmS,
  };

  const second = planMoonMissionCommand({
    phase: "tli_burn",
    targetVectors: secondVectors,
    metrics,
    plannerConfig: NAVIGATION_DEFAULTS.planner,
    estimatorConfig: NAVIGATION_DEFAULTS.estimator,
    plannerRuntime: runtime,
    timestampSec: 60,
  });
  assert(second, "expected second moon mission command");

  const secondCache = runtime.moon?.gnc?.sourceModelCache;
  assert(secondCache?.ephemeris?.samples?.length > 3, "expected second solve to preserve shifted source cache");
  assert(runtime.moon?.gnc?.sourceModelCacheTimestampSec === 60, "expected shifted cache timestamp 60");
  const moonOriginErrorKm = length(subtract(
    secondCache.ephemeris.samples[0]?.moon?.positionKm,
    advancedSources.moon.positionKm,
  ));
  const sunOriginErrorKm = length(subtract(
    secondCache.ephemeris.samples[0]?.sun?.positionKm,
    advancedSources.sun.positionKm,
  ));
  assert(moonOriginErrorKm < 1e-6, `expected moon cache origin to shift to +60s sample, got ${moonOriginErrorKm} km`);
  assert(sunOriginErrorKm < 1e-3, `expected sun cache origin to shift to +60s sample, got ${sunOriginErrorKm} km`);

  console.log("moon-source-runtime-cache-lock: ok");
}

main();
