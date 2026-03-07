import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { LAUNCH_VEHICLE_CONFIG, LAUNCH_BODY_ID, LAUNCH_BOOSTER_BODY_ID } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 5, 18, 0, 0);
const DT_SEC = 1;
const MAX_STEPS = 700;
const BASE_LAUNCH_MASS_KG = (
  (Number(LAUNCH_VEHICLE_CONFIG?.payloadMassKg) || 0)
  + (Array.isArray(LAUNCH_VEHICLE_CONFIG?.stages)
    ? LAUNCH_VEHICLE_CONFIG.stages.reduce(
      (total, stage) => total + (Number(stage?.dryMassKg) || 0) + (Number(stage?.propellantMassKg) || 0),
      0,
    )
    : 0)
);

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
      && Math.abs(actualNumber - expectedNumber) <= toleranceNumber,
    `${message}: expected ${expectedNumber} +/- ${toleranceNumber}, got ${actualNumber}`,
  );
}

function add(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function scale(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function length(vector) {
  return Math.sqrt(dot(vector, vector));
}

function gravityAccelerationKmS2(bodyState, earthState) {
  const relative = subtract(bodyState.position, earthState.position);
  const radiusKm = Math.max(1, length(relative));
  const muKm3S2 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * EARTH_MASS_KG;
  return scale(relative, -muKm3S2 / (radiusKm * radiusKm * radiusKm));
}

function integrateBody(bodyState, earthState, commandedAccelerationKmS2, dtSeconds) {
  const totalAccelerationKmS2 = add(
    gravityAccelerationKmS2(bodyState, earthState),
    commandedAccelerationKmS2 || { x: 0, y: 0, z: 0 },
  );
  bodyState.velocity = add(bodyState.velocity, scale(totalAccelerationKmS2, dtSeconds));
  bodyState.position = add(bodyState.position, scale(bodyState.velocity, dtSeconds));
}

function earthAxes() {
  return {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    pole: { x: 0, y: 0, z: 1 },
  };
}

function sampleEarthAtmosphere(altitudeKm = 0) {
  const safeAltitudeKm = Math.max(0, Number(altitudeKm) || 0);
  const scaleHeightKm = 7.5;
  const attenuation = Math.exp(-safeAltitudeKm / scaleHeightKm);
  return {
    densityKgM3: 1.225 * attenuation,
    pressurePa: 101325 * attenuation,
    temperatureK: 288.15,
  };
}

function makeState() {
  return {
    dynamicBodies: new Map(),
    staticSources: new Map([
      [
        "earth",
        {
          id: "earth",
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          massKg: EARTH_MASS_KG,
        },
      ],
      [
        "moon",
        {
          id: "moon",
          position: { x: 384400, y: 0, z: 0 },
          velocity: { x: 0, y: 1.022, z: 0 },
          massKg: MOON_MASS_KG,
        },
      ],
    ]),
  };
}

function createHarness() {
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

function runSurfaceLaunchScenario(missionId) {
  const state = makeState();
  const controller = createHarness();
  controller.setMissionProfile(missionId);
  const started = controller.startLaunch(state, NOW_MS, { launchKind: "surface-launch-test" });
  assert(started, `${missionId}: startLaunch rejected`);

  const launchBody = state.dynamicBodies.get(LAUNCH_BODY_ID);
  assert(launchBody, `${missionId}: missing launch body after startLaunch`);
  assertApprox(
    launchBody.massKg,
    BASE_LAUNCH_MASS_KG,
    1,
    `${missionId}: expected surface-launch mass to use base stack loadout`,
  );

  let nowMs = NOW_MS;
  let maxAltitudeKm = -Infinity;
  let maxAltitudeAfterStage2Km = -Infinity;
  let stage2AtStep = -1;
  let boosterActiveAtStep = -1;
  let boosterBodySeen = false;
  let finalSnapshot = controller.statusSnapshot(state);

  for (let step = 0; step < MAX_STEPS; step += 1) {
    controller.prepareStep(state, DT_SEC, nowMs);
    const earthState = state.staticSources.get("earth");
    const shipState = state.dynamicBodies.get(LAUNCH_BODY_ID);
    if (shipState) {
      integrateBody(shipState, earthState, controller.externalAccelerationKmS2(LAUNCH_BODY_ID), DT_SEC);
    }
    const boosterState = state.dynamicBodies.get(LAUNCH_BOOSTER_BODY_ID);
    if (boosterState) {
      boosterBodySeen = true;
      integrateBody(boosterState, earthState, controller.externalAccelerationKmS2(LAUNCH_BOOSTER_BODY_ID), DT_SEC);
    }
    controller.finalizeStep(state, DT_SEC, nowMs);
    nowMs += DT_SEC * 1000;

    finalSnapshot = controller.statusSnapshot(state);
    maxAltitudeKm = Math.max(maxAltitudeKm, Number(finalSnapshot.altitudeKm) || -Infinity);
    if (Number(finalSnapshot.stageIndex) >= 1) {
      maxAltitudeAfterStage2Km = Math.max(
        maxAltitudeAfterStage2Km,
        Number(finalSnapshot.altitudeKm) || -Infinity,
      );
      if (stage2AtStep < 0) {
        stage2AtStep = step;
      }
    }
    if (Boolean(finalSnapshot.boosterActive) && boosterActiveAtStep < 0) {
      boosterActiveAtStep = step;
    }
  }

  return {
    state,
    finalSnapshot,
    maxAltitudeKm,
    maxAltitudeAfterStage2Km,
    stage2AtStep,
    boosterActiveAtStep,
    boosterBodySeen,
  };
}

function assertSurfaceLaunchProgress(missionId) {
  const result = runSurfaceLaunchScenario(missionId);
  const snapshot = result.finalSnapshot;

  assert(
    snapshot.missionPhase === "launch_to_parking",
    `${missionId}: expected launch_to_parking during ascent, got ${snapshot.missionPhase}`,
  );
  assert(
    result.stage2AtStep >= 0 && result.stage2AtStep <= 260,
    `${missionId}: expected stage-2 handoff within 260 s, got ${result.stage2AtStep}`,
  );
  assert(
    result.boosterActiveAtStep >= 0 && result.boosterActiveAtStep <= 300,
    `${missionId}: expected booster detachment/recovery within 300 s, got ${result.boosterActiveAtStep}`,
  );
  assert(result.boosterBodySeen, `${missionId}: booster body was never created in the state map`);
  assert(
    result.maxAltitudeKm >= 130,
    `${missionId}: expected ascent above 130 km, got ${result.maxAltitudeKm}`,
  );
  assert(
    result.maxAltitudeAfterStage2Km >= 130,
    `${missionId}: expected stage 2 to continue climbing above 130 km, got ${result.maxAltitudeAfterStage2Km}`,
  );
  assert(
    Number(snapshot.altitudeKm) >= 130,
    `${missionId}: expected final altitude >= 130 km, got ${snapshot.altitudeKm}`,
  );
  assert(
    Number(snapshot.periapsisKm) >= 120,
    `${missionId}: expected periapsis >= 120 km, got ${snapshot.periapsisKm}`,
  );
  assert(
    Number(snapshot.speedKmS) >= 7.4,
    `${missionId}: expected stage-2 orbital-speed climb, got ${snapshot.speedKmS}`,
  );
  assert(
    snapshot.phase !== "idle",
    `${missionId}: launch controller fell back to idle unexpectedly`,
  );
  assert(
    Number(snapshot.stageIndex) === 1,
    `${missionId}: expected to remain on stage 2 after hot-stage, got ${snapshot.stageIndex}`,
  );
}

assertSurfaceLaunchProgress(LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO);
assertSurfaceLaunchProgress(LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN);

console.log("booster-surface-launch-smoke: ok");
