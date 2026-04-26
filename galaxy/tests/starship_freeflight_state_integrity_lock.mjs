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
const NOW_MS = Date.UTC(2026, 3, 26, 18, 0, 0);
const DT_SEC = 1 / 10;
const MAX_STEPS = 12000;
const FINALIZE_STATE_TOLERANCE = 1e-10;

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

function cloneVector(vector) {
  return vector ? { x: vector.x, y: vector.y, z: vector.z } : null;
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
      ["earth", { id: "earth", position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, massKg: EARTH_MASS_KG }],
      ["moon", { id: "moon", position: { x: 384400, y: 0, z: 0 }, velocity: { x: 0, y: 1.022, z: 0 }, massKg: MOON_MASS_KG }],
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
  controller.setMissionProfile(LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD);
  const started = controller.startLaunch(state, NOW_MS, { launchKind: "starship-freeflight-integrity-lock" });
  assert(started, "starship_freeflight_state_integrity: startLaunch rejected");

  let nowMs = NOW_MS;
  let cleanFreeFlightSeen = false;
  let cleanFreeFlightElapsedSec = null;
  let maxFinalizePositionDeltaKm = 0;
  let maxFinalizeVelocityDeltaKmS = 0;
  let finalGuard = null;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    controller.prepareStep(state, DT_SEC, nowMs);
    const earthState = state.staticSources.get("earth");
    const shipState = state.dynamicBodies.get(LAUNCH_BODY_ID);
    if (shipState) {
      integrateBody(shipState, earthState, controller.externalAccelerationKmS2(LAUNCH_BODY_ID), DT_SEC);
    }
    const boosterState = state.dynamicBodies.get(LAUNCH_BOOSTER_BODY_ID);
    if (boosterState) {
      integrateBody(boosterState, earthState, controller.externalAccelerationKmS2(LAUNCH_BOOSTER_BODY_ID), DT_SEC);
    }

    const integratedShipState = shipState
      ? {
        position: cloneVector(shipState.position),
        velocity: cloneVector(shipState.velocity),
      }
      : null;
    controller.finalizeStep(state, DT_SEC, nowMs);
    nowMs += DT_SEC * 1000;

    const exported = controller.exportPersistentSnapshot(state, nowMs);
    const guard = exported?.runtime?.starshipStateGuard || {};
    finalGuard = guard;
    if (guard.cleanFreeFlightActive) {
      cleanFreeFlightSeen = true;
      cleanFreeFlightElapsedSec ??= Number(guard.cleanFreeFlightElapsedSec);
      const finalizedShipState = state.dynamicBodies.get(LAUNCH_BODY_ID);
      if (integratedShipState && finalizedShipState) {
        maxFinalizePositionDeltaKm = Math.max(
          maxFinalizePositionDeltaKm,
          length(subtract(finalizedShipState.position, integratedShipState.position)),
        );
        maxFinalizeVelocityDeltaKmS = Math.max(
          maxFinalizeVelocityDeltaKmS,
          length(subtract(finalizedShipState.velocity, integratedShipState.velocity)),
        );
      }
    }

    if (
      cleanFreeFlightSeen
      && Number(exported?.runtime?.elapsedSeconds) >= cleanFreeFlightElapsedSec + 20
    ) {
      break;
    }
  }

  assert(cleanFreeFlightSeen, "starship_freeflight_state_integrity: clean free-flight guard never armed");
  assert(finalGuard, "starship_freeflight_state_integrity: missing final guard");
  assert(
    Number(finalGuard.blockedPositionCorrectionCount) === 0
      && Number(finalGuard.blockedVelocityCorrectionCount) === 0,
    `starship_freeflight_state_integrity: unexpected blocked correction ${JSON.stringify(finalGuard)}`,
  );
  assert(
    Number(finalGuard.postCleanFreeFlightPositionCorrectionCount) === 0
      && Number(finalGuard.postCleanFreeFlightVelocityCorrectionCount) === 0,
    `starship_freeflight_state_integrity: direct clean-freeflight correction recorded ${JSON.stringify(finalGuard)}`,
  );
  assert(
    maxFinalizePositionDeltaKm <= FINALIZE_STATE_TOLERANCE,
    `starship_freeflight_state_integrity: finalize moved Starship position after clean free flight by ${maxFinalizePositionDeltaKm} km`,
  );
  assert(
    maxFinalizeVelocityDeltaKmS <= FINALIZE_STATE_TOLERANCE,
    `starship_freeflight_state_integrity: finalize moved Starship velocity after clean free flight by ${maxFinalizeVelocityDeltaKmS} km/s`,
  );

  console.log(JSON.stringify({
    cleanFreeFlightElapsedSec,
    maxFinalizePositionDeltaKm,
    maxFinalizeVelocityDeltaKmS,
    finalGuard,
  }, null, 2));
  console.log("PASS starship-freeflight-state-integrity-lock");
}

main();
