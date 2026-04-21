import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import {
  LAUNCH_BODY_ID,
  LAUNCH_BOOSTER_BODY_ID,
} from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 5, 18, 0, 0);
const DT_SEC = 1;
const MAX_STEPS = 80;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(vector, scalar) {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
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
  const muKm3S2 = G_KM3_KG_S2 * EARTH_MASS_KG;
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
  const attenuation = Math.exp(-safeAltitudeKm / 7.5);
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
    windSeed: 1,
    gravitationalConstantKm3PerKgS2: G_KM3_KG_S2,
  });
}

function main() {
  const controller = createHarness();
  const state = makeState();
  controller.setMissionProfile(LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO);
  assert(controller.startLaunch(state, NOW_MS, { launchKind: "attached-joint-lock" }), "startLaunch rejected");

  let nowMs = NOW_MS;
  let sampleCount = 0;
  let maxJointLoadMN = 0;
  let maxJointErrorM = 0;
  let maxJointRelativeSpeedMS = 0;
  let maxAccelerationSplitKmS2 = 0;
  let maxBoosterMassKg = 0;
  let maxShipMassKg = 0;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    controller.prepareStep(state, DT_SEC, nowMs);
    const snapshot = controller.statusSnapshot(state);
    const shipAccelerationKmS2 = controller.externalAccelerationKmS2(LAUNCH_BODY_ID);
    const boosterAccelerationKmS2 = controller.externalAccelerationKmS2(LAUNCH_BOOSTER_BODY_ID);
    const earthState = state.staticSources.get("earth");
    const shipState = state.dynamicBodies.get(LAUNCH_BODY_ID);
    const boosterState = state.dynamicBodies.get(LAUNCH_BOOSTER_BODY_ID);

    if (
      snapshot?.boosterAttached
      && !snapshot?.boosterActive
      && Number(snapshot?.throttle) > 0.05
      && Number(snapshot?.elapsedSeconds) > 2
    ) {
      sampleCount += 1;
      maxJointLoadMN = Math.max(maxJointLoadMN, Number(snapshot.attachedJointLoadMN) || 0);
      maxJointErrorM = Math.max(maxJointErrorM, Number(snapshot.attachedJointErrorM) || 0);
      maxJointRelativeSpeedMS = Math.max(
        maxJointRelativeSpeedMS,
        Number(snapshot.attachedJointRelativeSpeedMS) || 0,
      );
      maxBoosterMassKg = Math.max(maxBoosterMassKg, Number(snapshot.attachedJointBoosterMassKg) || 0);
      maxShipMassKg = Math.max(maxShipMassKg, Number(snapshot.attachedJointShipMassKg) || 0);
      maxAccelerationSplitKmS2 = Math.max(
        maxAccelerationSplitKmS2,
        length(subtract(shipAccelerationKmS2, boosterAccelerationKmS2)),
      );
      assert(
        snapshot.attachedJointActive,
        "launch_attached_structural_joint: expected attached structural joint to be active during ascent",
      );
    }

    if (shipState) {
      integrateBody(shipState, earthState, shipAccelerationKmS2, DT_SEC);
    }
    if (boosterState) {
      integrateBody(boosterState, earthState, boosterAccelerationKmS2, DT_SEC);
    }
    controller.finalizeStep(state, DT_SEC, nowMs);
    nowMs += DT_SEC * 1000;

    if (controller.statusSnapshot(state)?.hotstageActive) {
      break;
    }
  }

  assert(sampleCount >= 12, `launch_attached_structural_joint: expected enough attached samples, got ${sampleCount}`);
  assert(maxJointLoadMN > 20, `launch_attached_structural_joint: joint load too small (${maxJointLoadMN} MN)`);
  assert(maxJointErrorM > 0.01, `launch_attached_structural_joint: joint error never developed (${maxJointErrorM} m)`);
  assert(maxJointErrorM < 25, `launch_attached_structural_joint: joint error too large (${maxJointErrorM} m)`);
  assert(
    maxJointRelativeSpeedMS < 12,
    `launch_attached_structural_joint: joint relative speed too large (${maxJointRelativeSpeedMS} m/s)`,
  );
  assert(
    maxAccelerationSplitKmS2 > 0.0001,
    `launch_attached_structural_joint: ship/booster accelerations never separated (${maxAccelerationSplitKmS2} km/s^2)`,
  );
  assert(maxShipMassKg > 1_000_000, `launch_attached_structural_joint: unexpected attached ship mass ${maxShipMassKg} kg`);
  assert(maxBoosterMassKg > 3_000_000, `launch_attached_structural_joint: unexpected attached booster mass ${maxBoosterMassKg} kg`);

  console.log("PASS launch-attached-structural-joint-lock");
}

main();
