import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { createLaunchFleetController } from "../app/static/js/physics/launch/launchFleetController.js";
import { LAUNCH_VEHICLE_CONFIG } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";
import { MOON_ORBIT_INJECT_ALTITUDE_KM } from "../app/static/js/physics/launch/lunar/constants.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const EARTH_MU_KM3_S2 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * EARTH_MASS_KG;
const STAGE2_PROPELLANT_KG = 5_000_000;
const STAGE2_DRY_MASS_KG = 120_000;
const EARLY_COMMIT_ELAPSED_SEC = 25;
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
    String(holdSnapshot.guidanceMode || "").includes("navsys:gnc-lambert-tli-burn+seed-lock"),
    `fleet telemetry progression: expected stored departure-plan lock, got ${holdSnapshot.guidanceMode}`,
  );
  assert(
    holdSnapshot.guidanceBurnRequested === true,
    "fleet telemetry progression: stored departure-plan lock should request burn",
  );
  assert(
    Number(holdSnapshot.guidanceRequestedThrottle) > 0.5,
    `fleet telemetry progression: expected strong requested throttle under stored departure-plan lock, got ${holdSnapshot.guidanceRequestedThrottle}`,
  );
  assert(
    String(holdSnapshot.missionPhaseGateReason || "").includes("t=323s / "),
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
  if (Number(burnSnapshot.guidanceRequestedThrottle) > 0.4) {
    assert(
      String(burnSnapshot.guidanceMode || "").includes("+reacquire")
        || String(burnSnapshot.guidanceMode || "").includes("+seed-lock"),
      `fleet telemetry progression: expected stored-plan or reacquire-tagged powered burn, got ${burnSnapshot.guidanceMode}`,
    );
    assert(
      burnSnapshot.guidanceBurnRequested === true,
      "fleet telemetry progression: burn state should request thrust",
    );
  } else {
    assert(
      String(burnSnapshot.guidanceMode || "").includes("go-no-go-hold"),
      `fleet telemetry progression: bad corridor should remain held, got ${burnSnapshot.guidanceMode}`,
    );
    assert(
      burnSnapshot.guidanceBurnRequested === false,
      "fleet telemetry progression: go/no-go hold should not request thrust",
    );
  }
  assert(
    String(burnSnapshot.missionPhaseGateReason || "").includes("t=430s / ")
      || String(burnSnapshot.missionPhaseGateReason || "").includes("departure corridor not acceptable"),
    `fleet telemetry progression: expected updated TLI timing or corridor gate, got ${burnSnapshot.missionPhaseGateReason}`,
  );
}

function testFleetControllerOrbitInjectDepartureCommit() {
  const state = makeState();
  seedWorld(state);
  const { controller, runtime } = createFleetHarness();
  const launch = controller.launchMissionShip(
    state,
    LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
    NOW_MS,
    { mode: "orbit_inject" },
  );
  assert(launch.accepted, `fleet departure commit: launch rejected (${launch.reason || "unknown"})`);
  const shipId = launch.shipId;
  const vehicle = runtime.fleet.vehicles.get(shipId);
  assert(vehicle, "fleet departure commit: missing fleet vehicle");
  assert(
    vehicle.moonDeparturePlanDirectionKm
      && Number.isFinite(Number(vehicle.moonDeparturePlanThrottle))
      && Number.isFinite(Number(vehicle.moonDeparturePlanCommitWindowSec)),
    "fleet departure commit: missing stored departure plan",
  );
  const shipState = state.dynamicBodies.get(shipId);
  assert(shipState, "fleet departure commit: missing ship state");
  shipState.massKg = STAGE2_DRY_MASS_KG + STAGE2_PROPELLANT_KG;
  vehicle.stageIndex = 1;
  vehicle.stagePropellantKg = STAGE2_PROPELLANT_KG;
  vehicle.missionPhase = "tli_burn";
  vehicle.elapsedSeconds = EARLY_COMMIT_ELAPSED_SEC;
  vehicle.phaseElapsedSec = EARLY_COMMIT_ELAPSED_SEC;

  controller.prepareStep(state, 1, NOW_MS + (EARLY_COMMIT_ELAPSED_SEC * 1000));
  const snapshot = controller.statusSnapshotForBody({
    state,
    bodyId: shipId,
    nowMs: NOW_MS + (EARLY_COMMIT_ELAPSED_SEC * 1000),
    baseSnapshot: {},
  });
  assertApprox(
    snapshot.altitudeKm,
    MOON_ORBIT_INJECT_ALTITUDE_KM,
    1.0,
    "fleet departure commit: starting altitude",
  );
  if (vehicle.moonDeparturePlanReady) {
    assert(
      String(snapshot.guidanceMode || "").includes("navsys:gnc-lambert-tli-burn+departure-commit"),
      `fleet departure commit: expected early departure burn mode, got ${snapshot.guidanceMode}`,
    );
    assert(
      Number(snapshot.guidanceRequestedThrottle) > 0.5,
      `fleet departure commit: expected positive early throttle, got ${snapshot.guidanceRequestedThrottle}`,
    );
    assert(
      snapshot.guidanceBurnRequested === true,
      "fleet departure commit: expected burn request during departure commit",
    );
  } else {
    assert(
      String(snapshot.guidanceMode || "").includes("go-no-go-hold"),
      `fleet departure commit: expected hold for bad corridor seed, got ${snapshot.guidanceMode}`,
    );
    assert(
      !String(snapshot.guidanceMode || "").includes("+departure-commit"),
      `fleet departure commit: bad corridor should not use departure commit, got ${snapshot.guidanceMode}`,
    );
  }
}

function testFleetControllerRejectsBadStoredDeparturePlanCommit() {
  const state = makeState();
  seedWorld(state);
  const { controller, runtime } = createFleetHarness();
  const launch = controller.launchMissionShip(
    state,
    LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
    NOW_MS,
    { mode: "orbit_inject" },
  );
  assert(launch.accepted, `fleet bad departure plan: launch rejected (${launch.reason || "unknown"})`);
  const shipId = launch.shipId;
  const vehicle = runtime.fleet.vehicles.get(shipId);
  const shipState = state.dynamicBodies.get(shipId);
  assert(vehicle, "fleet bad departure plan: missing fleet vehicle");
  assert(shipState, "fleet bad departure plan: missing ship state");
  shipState.massKg = STAGE2_DRY_MASS_KG + STAGE2_PROPELLANT_KG;
  vehicle.stageIndex = 1;
  vehicle.stagePropellantKg = STAGE2_PROPELLANT_KG;
  vehicle.missionPhase = "tli_burn";
  vehicle.elapsedSeconds = EARLY_COMMIT_ELAPSED_SEC;
  vehicle.phaseElapsedSec = EARLY_COMMIT_ELAPSED_SEC;
  vehicle.moonDeparturePlanReady = true;
  vehicle.moonDeparturePlanPredictedMissDistanceKm = 384340.9;
  vehicle.moonDeparturePlanPredictedPeriluneAltitudeKm = 382603.5;
  vehicle.moonDeparturePlanBPlaneErrorKm = 382436.0;
  vehicle.moonDepartureGeometryScore = 0.956;
  vehicle.moonDepartureAlignNow = 0.978;

  controller.prepareStep(state, 1, NOW_MS + (EARLY_COMMIT_ELAPSED_SEC * 1000));
  const snapshot = controller.statusSnapshotForBody({
    state,
    bodyId: shipId,
    nowMs: NOW_MS + (EARLY_COMMIT_ELAPSED_SEC * 1000),
    baseSnapshot: {},
  });
  assert(
    !String(snapshot.guidanceMode || "").includes("+departure-commit"),
    `fleet bad departure plan: bad corridor should not force departure commit, got ${snapshot.guidanceMode}`,
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
  if (String(holdSnapshot.guidanceMode || "").includes("+departure-commit")) {
    assert(
      Number(holdSnapshot.guidanceRequestedThrottle) > 0.5,
      `primary telemetry progression: expected positive requested throttle during departure commit, got ${holdSnapshot.guidanceRequestedThrottle}`,
    );
  } else {
    assert(
      String(holdSnapshot.guidanceMode || "").includes("navsys:gnc-lambert-tli-reacquire-window"),
      `primary telemetry progression: expected departure commit or reacquire hold, got ${holdSnapshot.guidanceMode}`,
    );
  }

  seedConflictFrame({
    state,
    shipId,
    vehicle: null,
    trueAnomalyRad: -0.08,
  });
  controller.prepareStep(state, 1, NOW_MS + 1000);
  const burnSnapshot = controller.statusSnapshotForBody(state, shipId, NOW_MS + 1000);
  assert(
    String(burnSnapshot.guidanceMode || "").includes("navsys:gnc-lambert-tli-burn")
      || String(burnSnapshot.guidanceMode || "").includes("navsys:gnc-lambert-tli-reacquire-window"),
    `primary telemetry progression: expected public controller burn or hold mode, got ${burnSnapshot.guidanceMode}`,
  );
  if (
    String(burnSnapshot.guidanceMode || "").includes("navsys:gnc-lambert-tli-burn")
    && !String(burnSnapshot.guidanceMode || "").includes("go-no-go-hold")
  ) {
    assert(
      Number(burnSnapshot.guidanceRequestedThrottle) > 0.4,
      `primary telemetry progression: expected positive burn request, got ${burnSnapshot.guidanceRequestedThrottle}`,
    );
  } else {
    assert(
      Number(burnSnapshot.guidanceRequestedThrottle) === 0,
      `primary telemetry progression: hold should keep throttle at zero, got ${burnSnapshot.guidanceRequestedThrottle}`,
    );
  }
}

function main() {
  testFleetControllerOrbitInjectDepartureCommit();
  testFleetControllerRejectsBadStoredDeparturePlanCommit();
  testFleetControllerTelemetryScenarioProgression();
  testPrimaryLaunchControllerConflictProgression();
  console.log("PASS moon-controller-conflict-e2e");
}

main();
