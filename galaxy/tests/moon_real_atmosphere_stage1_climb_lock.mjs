import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import {
  LAUNCH_BODY_ID,
  LAUNCH_BOOSTER_BODY_ID,
} from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";
import { earthAtmosphereSampleUS1976 } from "../app/static/js/physics/atmosphere/atmosphereDynamics.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 5, 18, 0, 0);
const DT_SEC = 1;
const MAX_STEPS = 160;

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
    sampleEarthAtmosphere: (altitudeKm, sampleOptions = {}) => earthAtmosphereSampleUS1976(altitudeKm, sampleOptions),
    sampleLaunchWeather: () => ({
      windEastMS: -6,
      windNorthMS: -2,
      relativeHumidity: 0.72,
    }),
    windSeed: 1,
    gravitationalConstantKm3PerKgS2: G_KM3_KG_S2,
  });
  const state = makeState();
  controller.setMissionProfile(LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN);
  const started = controller.startLaunch(state, NOW_MS, { launchKind: "surface-launch-test" });
  assert(started, "moon_real_atmosphere_stage1_climb: startLaunch rejected");

  let nowMs = NOW_MS;
  let peakAltitudeKm = -Infinity;
  let altitudeAt60Sec = Number.NaN;
  let altitudeAt90Sec = Number.NaN;
  let altitudeAt120Sec = Number.NaN;
  let groundSpeedAt60Sec = Number.NaN;
  let guidanceAt90Sec = "";

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

    const altitudeKm = Number(snapshot?.altitudeKm) || 0;
    peakAltitudeKm = Math.max(peakAltitudeKm, altitudeKm);
    if (step === 60) {
      altitudeAt60Sec = altitudeKm;
      groundSpeedAt60Sec = Number(snapshot?.groundRelativeSpeedKmS) || 0;
    }
    if (step === 90) {
      altitudeAt90Sec = altitudeKm;
      guidanceAt90Sec = String(snapshot?.guidanceMode || "");
    }
    if (step === 120) {
      altitudeAt120Sec = altitudeKm;
    }
    if (step >= 85 && altitudeKm < (peakAltitudeKm - 2)) {
      throw new Error(
        `moon_real_atmosphere_stage1_climb: stage 1 lost climb margin near ${step}s (alt ${altitudeKm} km, peak ${peakAltitudeKm} km, guidance ${snapshot?.guidanceMode})`,
      );
    }
  }

  assert(
    altitudeAt60Sec >= 8.5,
    `moon_real_atmosphere_stage1_climb: expected altitude >= 8.5 km at 60 s, got ${altitudeAt60Sec}`,
  );
  assert(
    groundSpeedAt60Sec >= 0.25,
    `moon_real_atmosphere_stage1_climb: expected ground speed >= 0.25 km/s at 60 s, got ${groundSpeedAt60Sec}`,
  );
  assert(
    altitudeAt90Sec >= 18,
    `moon_real_atmosphere_stage1_climb: expected altitude >= 18 km at 90 s, got ${altitudeAt90Sec}`,
  );
  assert(
    altitudeAt120Sec >= 32,
    `moon_real_atmosphere_stage1_climb: expected altitude >= 32 km at 120 s, got ${altitudeAt120Sec}`,
  );
  assert(
    guidanceAt90Sec.includes("gravity-turn")
      || guidanceAt90Sec.includes("apoapsis-raise")
      || guidanceAt90Sec.includes("stage1-hotstage-climb"),
    `moon_real_atmosphere_stage1_climb: expected gravity-turn/apoapsis-raise/hotstage-climb guidance at 90 s, got ${guidanceAt90Sec}`,
  );

  console.log("PASS moon-real-atmosphere-stage1-climb-lock");
}

main();
