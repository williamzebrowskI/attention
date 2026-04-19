import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import {
  LAUNCH_BODY_ID,
  LAUNCH_BOOSTER_BODY_ID,
  LAUNCH_VEHICLE_CONFIG,
} from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 5, 18, 0, 0);
const DT_SEC = 1;
const MAX_STEPS = 1200;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

function main() {
  const controller = createLaunchController({
    getEarthRadiusKm: () => EARTH_RADIUS_KM,
    getEarthMassKg: () => EARTH_MASS_KG,
    getBodyRadiusKm: (id) => (String(id) === "moon" ? MOON_RADIUS_KM : EARTH_RADIUS_KM),
    getBodyMassKg: (id) => (String(id) === "moon" ? MOON_MASS_KG : EARTH_MASS_KG),
    getEarthFixedAxesEcliptic: earthAxes,
    sampleEarthAtmosphere,
    gravitationalConstantKm3PerKgS2: G_KM3_KG_S2,
  });
  const state = makeState();
  controller.setMissionProfile(LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN);
  const started = controller.startLaunch(state, NOW_MS, { launchKind: "surface-launch-test" });
  assert(started, "surface_launch_hotstage_realism: startLaunch rejected");

  const guidance = LAUNCH_VEHICLE_CONFIG.guidance || {};
  let nowMs = NOW_MS;
  let ignition = null;
  let detach = null;

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
    controller.finalizeStep(state, DT_SEC, nowMs);
    nowMs += DT_SEC * 1000;
    const snapshot = controller.statusSnapshot(state);

    if (!ignition && Boolean(snapshot?.hotstageActive)) {
      ignition = {
        elapsedSec: Number(snapshot?.elapsedSeconds),
        altitudeKm: Number(snapshot?.altitudeKm),
        speedKmS: Number(snapshot?.speedKmS),
      };
    }
    if (!detach && Boolean(snapshot?.boosterActive)) {
      detach = {
        elapsedSec: Number(snapshot?.elapsedSeconds),
        altitudeKm: Number(snapshot?.altitudeKm),
        speedKmS: Number(snapshot?.speedKmS),
        boosterAltitudeKm: Number(snapshot?.boosterAltitudeKm),
      };
      break;
    }
  }

  assert(ignition, "surface_launch_hotstage_realism: never observed hotstage ignition");
  assert(detach, "surface_launch_hotstage_realism: never observed booster detach");

  assert(
    ignition.elapsedSec >= Number(guidance.hotstageMinElapsedSec)
      && ignition.elapsedSec <= Number(guidance.hotstageMaxElapsedSec),
    `surface_launch_hotstage_realism: ignition time ${ignition.elapsedSec}s outside ${guidance.hotstageMinElapsedSec}-${guidance.hotstageMaxElapsedSec}s`,
  );
  assert(
    ignition.altitudeKm >= Number(guidance.hotstageMinAltitudeKm)
      && ignition.altitudeKm <= Number(guidance.hotstageMaxAltitudeKm),
    `surface_launch_hotstage_realism: ignition altitude ${ignition.altitudeKm}km outside ${guidance.hotstageMinAltitudeKm}-${guidance.hotstageMaxAltitudeKm}km`,
  );
  assert(
    ignition.speedKmS >= Number(guidance.hotstageMinSpeedKmS)
      && ignition.speedKmS <= Number(guidance.hotstageMaxSpeedKmS),
    `surface_launch_hotstage_realism: ignition speed ${ignition.speedKmS}km/s outside ${guidance.hotstageMinSpeedKmS}-${guidance.hotstageMaxSpeedKmS}km/s`,
  );
  assert(
    Math.abs(ignition.elapsedSec - Number(guidance.hotstageNominalElapsedSec)) <= 5,
    `surface_launch_hotstage_realism: ignition time ${ignition.elapsedSec}s drifted too far from nominal ${guidance.hotstageNominalElapsedSec}s`,
  );
  assert(
    Math.abs(ignition.altitudeKm - Number(guidance.hotstageNominalAltitudeKm)) <= 5,
    `surface_launch_hotstage_realism: ignition altitude ${ignition.altitudeKm}km drifted too far from nominal ${guidance.hotstageNominalAltitudeKm}km`,
  );
  assert(
    Math.abs(ignition.speedKmS - Number(guidance.hotstageNominalSpeedKmS)) <= 0.15,
    `surface_launch_hotstage_realism: ignition speed ${ignition.speedKmS}km/s drifted too far from nominal ${guidance.hotstageNominalSpeedKmS}km/s`,
  );
  assert(
    detach.elapsedSec >= ignition.elapsedSec
      && (detach.elapsedSec - ignition.elapsedSec) <= 5,
    `surface_launch_hotstage_realism: detach should follow ignition quickly, got ignition ${ignition.elapsedSec}s detach ${detach.elapsedSec}s`,
  );
  assert(
    Number.isFinite(detach.boosterAltitudeKm)
      && Math.abs(detach.boosterAltitudeKm - detach.altitudeKm) <= 0.5,
    `surface_launch_hotstage_realism: stacked ship/booster detach altitudes diverged unexpectedly (${detach.altitudeKm} vs ${detach.boosterAltitudeKm})`,
  );

  console.log(JSON.stringify({
    ignition,
    detach,
  }, null, 2));
  console.log("PASS surface-launch-hotstage-realism-e2e");
}

main();
