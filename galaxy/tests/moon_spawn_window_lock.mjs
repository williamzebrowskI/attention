import { createLaunchFleetController } from "../app/static/js/physics/launch/launchFleetController.js";
import {
  EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
  LAUNCH_SITE,
  LAUNCH_VEHICLE_CONFIG,
} from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";
import {
  solveBestMoonOrbitInjectWindow,
  solveMoonDepartureWindow,
} from "../app/static/js/physics/navigation_system/lunar/departureWindowSolver.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const EARTH_MU_KM3_S2 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * EARTH_MASS_KG;
const NOW_MS = Date.UTC(2026, 2, 5, 12, 0, 0);
const MOON_TEST_INCLINATION_DEG = Number(LAUNCH_SITE?.latitudeDeg) || 28.5;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertApprox(actual, expected, tolerance, message) {
  const actualValue = Number(actual);
  const expectedValue = Number(expected);
  const toleranceValue = Math.max(0, Number(tolerance) || 0);
  assert(
    Number.isFinite(actualValue)
      && Number.isFinite(expectedValue)
      && Math.abs(actualValue - expectedValue) <= toleranceValue,
    `${message}: expected ${expectedValue} +/- ${toleranceValue}, got ${actualValue}`,
  );
}

function length(vector) {
  return Math.sqrt(
    (Number(vector?.x) || 0) ** 2
    + (Number(vector?.y) || 0) ** 2
    + (Number(vector?.z) || 0) ** 2,
  );
}

function normalize(vector) {
  const magnitude = length(vector);
  if (!(magnitude > 1e-9)) {
    return { x: 1, y: 0, z: 0 };
  }
  return {
    x: Number(vector.x) / magnitude,
    y: Number(vector.y) / magnitude,
    z: Number(vector.z) / magnitude,
  };
}

function dot(a, b) {
  return (
    (Number(a?.x) || 0) * (Number(b?.x) || 0)
    + (Number(a?.y) || 0) * (Number(b?.y) || 0)
    + (Number(a?.z) || 0) * (Number(b?.z) || 0)
  );
}

function stageAtIndex(index) {
  return LAUNCH_VEHICLE_CONFIG.stages[index] || null;
}

function earthAxes() {
  return {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    pole: { x: 0, y: 0, z: 1 },
  };
}

function sampleEarthAtmosphere() {
  return {
    densityKgM3: 0,
    pressurePa: 0,
    temperatureK: 0,
  };
}

function createHarness() {
  const runtime = {
    windSeed: 1,
    fleet: {
      nextShipSequence: 1,
      vehicles: new Map(),
    },
    refuel: {
      flights: [],
    },
  };
  const controller = createLaunchFleetController({
    runtime,
    stageAtIndex,
    getEarthRadiusKm: () => EARTH_RADIUS_KM,
    getEarthMassKg: () => EARTH_MASS_KG,
    getBodyRadiusKm: (id) => (String(id) === "moon" ? MOON_RADIUS_KM : EARTH_RADIUS_KM),
    getBodyMassKg: (id) => (String(id) === "moon" ? MOON_MASS_KG : EARTH_MASS_KG),
    sampleEarthAtmosphere,
    earthAxes,
    gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
    emitLaunchEvent: null,
  });
  return { controller, runtime };
}

function createState({ moonPositionKm, moonVelocityKmS }) {
  const state = {
    dynamicBodies: new Map(),
    staticSources: new Map(),
  };
  state.staticSources.set("earth", {
    id: "earth",
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    massKg: EARTH_MASS_KG,
  });
  state.staticSources.set("moon", {
    id: "moon",
    position: { ...moonPositionKm },
    velocity: { ...moonVelocityKmS },
    massKg: MOON_MASS_KG,
  });
  return state;
}

function launchMoonInjectScenario({ moonPositionKm, moonVelocityKmS }) {
  const state = createState({ moonPositionKm, moonVelocityKmS });
  const { controller, runtime } = createHarness();
  const launch = controller.launchMissionShip(
    state,
    LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
    NOW_MS,
    { mode: "orbit_inject" },
  );
  assert(launch.accepted, `moon spawn window lock: launch rejected (${launch.reason || "unknown"})`);
  const shipState = state.dynamicBodies.get(launch.shipId);
  const vehicle = runtime.fleet.vehicles.get(launch.shipId);
  assert(shipState, "moon spawn window lock: missing ship state");
  assert(vehicle, "moon spawn window lock: missing fleet vehicle");
  return {
    launch,
    state,
    shipState,
    vehicle,
  };
}

function verifyOptimalSpawn({ launch, state, shipState, vehicle }, label) {
  const solved = solveMoonDepartureWindow({
    earthState: state.staticSources.get("earth"),
    moonState: state.staticSources.get("moon"),
    shipPositionKm: shipState.position,
    inclinationDeg: MOON_TEST_INCLINATION_DEG,
    ascendingNodeRad: Number(vehicle.moonDepartureAscendingNodeRad),
    orbitAltitudeKm: 185,
    earthRadiusKm: EARTH_RADIUS_KM,
    earthMuKm3S2: EARTH_MU_KM3_S2,
    padAngularRateRadS: EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
  });
  assert(solved.valid, `${label}: window solve invalid`);
  assert(
    Boolean(vehicle.moonDepartureWindowReady) === Boolean(solved.ready),
    `${label}: stored window-ready flag should match solve result`,
  );
  assert(
    Boolean(vehicle.moonDeparturePlanReady) === Boolean(solved.ready),
    `${label}: stored departure plan readiness should match solve readiness`,
  );
  if (solved.ready) {
    assert(
      !Number.isFinite(Number(solved.phaseErrorDeg))
        || Math.abs(Number(solved.phaseErrorDeg)) <= Number(solved.toleranceDeg) + 1e-6,
      `${label}: ready spawn phase should be within tolerance, got ${solved.phaseErrorDeg} deg`,
    );
    assert(
      !Number.isFinite(Number(vehicle.moonDepartureWindowWaitSec))
        || Number(vehicle.moonDepartureWindowWaitSec) <= 1,
      `${label}: ready window should not have a meaningful wait, got ${vehicle.moonDepartureWindowWaitSec}`,
    );
  } else {
    assert(
      !Boolean(solved.corridorAccepted) || !Boolean(solved.phaseReady),
      `${label}: unready solve should fail phase or corridor acceptance`,
    );
  }
  assert(
    vehicle.moonDeparturePlanDirectionKm
      && Number.isFinite(Number(vehicle.moonDeparturePlanThrottle))
      && Number.isFinite(Number(vehicle.moonDeparturePlanCommitWindowSec)),
    `${label}: expected stored departure plan for early TLI guidance`,
  );
  assert(Number.isFinite(Number(vehicle.launchLongitudeDeg)), `${label}: launch longitude missing`);
  assert(Number.isFinite(Number(vehicle.launchLatitudeDeg)), `${label}: launch latitude missing`);
  const optimized = solveBestMoonOrbitInjectWindow({
    earthState: state.staticSources.get("earth"),
    moonState: state.staticSources.get("moon"),
    inclinationDeg: MOON_TEST_INCLINATION_DEG,
    orbitAltitudeKm: 185,
    earthRadiusKm: EARTH_RADIUS_KM,
    earthMuKm3S2: EARTH_MU_KM3_S2,
  });
  assert(optimized.valid, `${label}: optimized window solve invalid`);
  assert(
    String(optimized.optimizerMode) === "global-nbody-optimal-departure",
    `${label}: expected global optimizer mode, got ${optimized.optimizerMode}`,
  );
  assert(
    Number.isFinite(Number(optimized.optimizedApoapsisAltitudeKm))
      && Number(optimized.optimizedApoapsisAltitudeKm) >= 185,
    `${label}: optimized apoapsis altitude missing`,
  );
  assert(
    Number.isFinite(Number(optimized.planeCompositeScore))
      && Number(optimized.planeCompositeScore) > 0,
    `${label}: optimizer composite score missing`,
  );
  assert(
    Number.isFinite(Number(optimized.predictedMissDistanceKm))
      && Number.isFinite(Number(optimized.predictedPeriluneAltitudeKm))
      && Number.isFinite(Number(optimized.bPlaneErrorKm)),
    `${label}: optimizer propagated metrics missing`,
  );
  assert(
    Boolean(optimized.ready) === Boolean(optimized.corridorAccepted),
    `${label}: optimizer ready state should track corridor acceptance`,
  );
  assert(
    Number(optimized.predictedMissDistanceKm) < 2_000_000
      && Number(optimized.predictedPeriluneAltitudeKm) < 2_000_000
      && Number(optimized.bPlaneErrorKm) < 2_000_000,
    `${label}: optimizer propagated metrics should stay bounded, got miss=${optimized.predictedMissDistanceKm}, perilune=${optimized.predictedPeriluneAltitudeKm}, bPlane=${optimized.bPlaneErrorKm}`,
  );
  assertApprox(
    launch.orbitInjectApoapsisKm,
    optimized.optimizedApoapsisAltitudeKm,
    1.0,
    `${label}: injected apoapsis should follow optimizer`,
  );
}

const scenarioA = launchMoonInjectScenario({
  moonPositionKm: { x: 384400, y: 0, z: 28000 },
  moonVelocityKmS: { x: 0, y: 1.022, z: 0.02 },
});

const scenarioB = launchMoonInjectScenario({
  moonPositionKm: { x: 0, y: 384400, z: -28000 },
  moonVelocityKmS: { x: -1.022, y: 0, z: -0.02 },
});

verifyOptimalSpawn(scenarioA, "scenario-a");
verifyOptimalSpawn(scenarioB, "scenario-b");

const earthRelA = normalize(scenarioA.shipState.position);
const earthRelB = normalize(scenarioB.shipState.position);
const separationCos = dot(earthRelA, earthRelB);
assert(
  separationCos < 0.8,
  `moon spawn window lock: expected dynamic spawn point, got cosine separation ${separationCos}`,
);

assert(
  Math.abs(Number(scenarioA.vehicle.launchLongitudeDeg) - Number(scenarioB.vehicle.launchLongitudeDeg)) > 20,
  "moon spawn window lock: expected moon-driven longitude shift between scenarios",
);

console.log("PASS moon-spawn-window-lock");
