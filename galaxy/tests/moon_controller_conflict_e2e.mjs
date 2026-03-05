import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { createLaunchFleetController } from "../app/static/js/physics/launch/launchFleetController.js";
import { LAUNCH_VEHICLE_CONFIG } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const EARTH_MU_KM3_S2 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * EARTH_MASS_KG;
const STAGE2_PROPELLANT_KG = 5_000_000;
const STAGE2_DRY_MASS_KG = 120_000;
const HOLD_ELAPSED_SEC = 323;
const BURN_ELAPSED_SEC = 430;
const NOW_MS = Date.UTC(2026, 2, 5, 12, 0, 0);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertApprox(actual, expected, tolerance, message) {
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  const toleranceNumber = Math.max(0, Number(tolerance) || 0);
  assert(
    Number.isFinite(actualNumber)
      && Number.isFinite(expectedNumber)
      && Math.abs(actualNumber - expectedNumber) <= toleranceNumber,
    `${message}: expected ${expectedNumber} +/- ${toleranceNumber}, got ${actualNumber}`,
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

function makeState() {
  return {
    dynamicBodies: new Map(),
    staticSources: new Map(),
  };
}

function addStaticBody(state, id, position, velocity, massKg) {
  state.staticSources.set(id, {
    id,
    position,
    velocity,
    massKg,
  });
}

function seedWorld(state) {
  addStaticBody(
    state,
    "earth",
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    EARTH_MASS_KG,
  );
  addStaticBody(
    state,
    "moon",
    { x: 384400, y: 0, z: 0 },
    { x: 0, y: 1.022, z: 0 },
    MOON_MASS_KG,
  );
}

function makeEllipticOrbitState({
  periapsisKm = 185,
  apoapsisKm = 221,
  trueAnomalyRad = 0,
} = {}) {
  const periapsisRadiusKm = EARTH_RADIUS_KM + periapsisKm;
  const apoapsisRadiusKm = EARTH_RADIUS_KM + apoapsisKm;
  const semiMajorAxisKm = (periapsisRadiusKm + apoapsisRadiusKm) * 0.5;
  const eccentricity = (apoapsisRadiusKm - periapsisRadiusKm) / (apoapsisRadiusKm + periapsisRadiusKm);
  const semiLatusRectumKm = semiMajorAxisKm * (1 - (eccentricity * eccentricity));
  const radiusKm = semiLatusRectumKm / (1 + (eccentricity * Math.cos(trueAnomalyRad)));
  const specificAngularMomentumKm2S = Math.sqrt(EARTH_MU_KM3_S2 * semiLatusRectumKm);
  return {
    position: {
      x: radiusKm * Math.cos(trueAnomalyRad),
      y: radiusKm * Math.sin(trueAnomalyRad),
      z: 0,
    },
    velocity: {
      x: -(EARTH_MU_KM3_S2 / specificAngularMomentumKm2S) * Math.sin(trueAnomalyRad),
      y: (EARTH_MU_KM3_S2 / specificAngularMomentumKm2S) * (eccentricity + Math.cos(trueAnomalyRad)),
      z: 0,
    },
  };
}

function createFleetHarness() {
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

function createPrimaryHarness() {
  return createLaunchController({
    getEarthRadiusKm: () => EARTH_RADIUS_KM,
    getEarthMassKg: () => EARTH_MASS_KG,
    getBodyRadiusKm: (id) => (String(id) === "moon" ? MOON_RADIUS_KM : EARTH_RADIUS_KM),
    getBodyMassKg: (id) => (String(id) === "moon" ? MOON_MASS_KG : EARTH_MASS_KG),
    getEarthFixedAxesEcliptic: earthAxes,
    sampleEarthAtmosphere,
    gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
  });
}

function seedConflictFrame({
  state,
  shipId,
  vehicle = null,
  elapsedSec = 0,
  trueAnomalyRad = 0,
}) {
  const shipState = state.dynamicBodies.get(shipId);
  assert(shipState, `missing ship state for ${shipId}`);
  const orbitState = makeEllipticOrbitState({
    periapsisKm: 185,
    apoapsisKm: 221,
    trueAnomalyRad,
  });
  shipState.position = orbitState.position;
  shipState.velocity = orbitState.velocity;
  shipState.massKg = STAGE2_DRY_MASS_KG + STAGE2_PROPELLANT_KG;
  if (vehicle) {
    vehicle.stageIndex = 1;
    vehicle.stagePropellantKg = STAGE2_PROPELLANT_KG;
    vehicle.missionPhase = "tli_burn";
    vehicle.elapsedSeconds = elapsedSec;
    vehicle.phaseElapsedSec = elapsedSec;
  }
}

function testFleetControllerTelemetryScenarioProgression() {
  const state = makeState();
  seedWorld(state);
  const { controller, runtime } = createFleetHarness();
  const launch = controller.launchMissionShip(
    state,
    LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
    NOW_MS,
    { mode: "orbit_inject" },
  );
  assert(launch.accepted, `fleet telemetry progression: launch rejected (${launch.reason || "unknown"})`);
  const shipId = launch.shipId;
  const vehicle = runtime.fleet.vehicles.get(shipId);
  assert(vehicle, "fleet telemetry progression: missing fleet vehicle");

  seedConflictFrame({
    state,
    shipId,
    vehicle,
    elapsedSec: HOLD_ELAPSED_SEC,
    trueAnomalyRad: 0.25,
  });
  controller.prepareStep(state, 1, NOW_MS + (HOLD_ELAPSED_SEC * 1000));
  const holdSnapshot = controller.statusSnapshotForBody({
    state,
    bodyId: shipId,
    nowMs: NOW_MS + (HOLD_ELAPSED_SEC * 1000),
    baseSnapshot: {},
  });
  assertApprox(holdSnapshot.altitudeKm, 185.56, 0.25, "fleet telemetry progression: hold altitude");
  assertApprox(holdSnapshot.speedKmS, 7.8075, 0.01, "fleet telemetry progression: hold speed");
  assert(
    String(holdSnapshot.guidanceMode || "").includes("navsys:gnc-lambert-tli-reacquire-window"),
    `fleet telemetry progression: expected reacquire-window hold, got ${holdSnapshot.guidanceMode}`,
  );
  assert(
    holdSnapshot.guidanceBurnRequested === false,
    "fleet telemetry progression: hold should not request burn",
  );
  assert(
    Number(holdSnapshot.guidanceRequestedThrottle) === 0,
    `fleet telemetry progression: expected zero requested throttle in hold, got ${holdSnapshot.guidanceRequestedThrottle}`,
  );
  assert(
    String(holdSnapshot.missionPhaseGateReason || "").includes("t=323s / 520s"),
    `fleet telemetry progression: expected TLI phase time in gate reason, got ${holdSnapshot.missionPhaseGateReason}`,
  );

  seedConflictFrame({
    state,
    shipId,
    vehicle,
    elapsedSec: BURN_ELAPSED_SEC,
    trueAnomalyRad: -0.08,
  });
  controller.prepareStep(state, 1, NOW_MS + (BURN_ELAPSED_SEC * 1000));
  const burnSnapshot = controller.statusSnapshotForBody({
    state,
    bodyId: shipId,
    nowMs: NOW_MS + (BURN_ELAPSED_SEC * 1000),
    baseSnapshot: {},
  });
  assert(
    String(burnSnapshot.guidanceMode || "").includes("navsys:gnc-lambert-tli-burn"),
    `fleet telemetry progression: expected powered TLI burn, got ${burnSnapshot.guidanceMode}`,
  );
  assert(
    String(burnSnapshot.guidanceMode || "").includes("+reacquire"),
    `fleet telemetry progression: expected reacquire tag during burn, got ${burnSnapshot.guidanceMode}`,
  );
  assert(
    Number(burnSnapshot.guidanceRequestedThrottle) > 0.4,
    `fleet telemetry progression: expected positive burn request, got ${burnSnapshot.guidanceRequestedThrottle}`,
  );
  assert(
    burnSnapshot.guidanceBurnRequested === true,
    "fleet telemetry progression: burn state should request thrust",
  );
  assert(
    String(burnSnapshot.missionPhaseGateReason || "").includes("t=430s / 520s"),
    `fleet telemetry progression: expected updated TLI phase time in gate reason, got ${burnSnapshot.missionPhaseGateReason}`,
  );
}

function testPrimaryLaunchControllerConflictProgression() {
  const state = makeState();
  seedWorld(state);
  const controller = createPrimaryHarness();
  const launch = controller.launchMissionShip(
    state,
    LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
    NOW_MS,
    { mode: "orbit_inject" },
  );
  assert(launch.accepted, `primary telemetry progression: launch rejected (${launch.reason || "unknown"})`);
  const shipId = launch.shipId;

  seedConflictFrame({
    state,
    shipId,
    vehicle: null,
    trueAnomalyRad: 0.25,
  });
  controller.prepareStep(state, 1, NOW_MS);
  const holdSnapshot = controller.statusSnapshotForBody(state, shipId, NOW_MS);
  assert(
    String(holdSnapshot.guidanceMode || "").includes("navsys:gnc-lambert-tli-reacquire-window"),
    `primary telemetry progression: expected public controller hold mode, got ${holdSnapshot.guidanceMode}`,
  );
  assert(
    Number(holdSnapshot.guidanceRequestedThrottle) === 0,
    `primary telemetry progression: expected zero requested throttle in hold, got ${holdSnapshot.guidanceRequestedThrottle}`,
  );

  seedConflictFrame({
    state,
    shipId,
    vehicle: null,
    trueAnomalyRad: -0.08,
  });
  controller.prepareStep(state, 1, NOW_MS + 1000);
  const burnSnapshot = controller.statusSnapshotForBody(state, shipId, NOW_MS + 1000);
  assert(
    String(burnSnapshot.guidanceMode || "").includes("navsys:gnc-lambert-tli-burn"),
    `primary telemetry progression: expected public controller burn mode, got ${burnSnapshot.guidanceMode}`,
  );
  assert(
    Number(burnSnapshot.guidanceRequestedThrottle) > 0.4,
    `primary telemetry progression: expected positive burn request, got ${burnSnapshot.guidanceRequestedThrottle}`,
  );
}

function main() {
  testFleetControllerTelemetryScenarioProgression();
  testPrimaryLaunchControllerConflictProgression();
  console.log("PASS moon-controller-conflict-e2e");
}

main();
