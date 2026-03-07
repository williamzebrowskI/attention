import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import {
  LAUNCH_BODY_ID,
  LAUNCH_BOOSTER_BODY_ID,
} from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";
import {
  MOON_PARKING_ORBIT_APOAPSIS_KM,
  MOON_PARKING_ORBIT_PERIAPSIS_KM,
} from "../app/static/js/physics/launch/lunar/constants.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 5, 18, 0, 0);
const DT_SEC = 1;
const MAX_STEPS = 2600;
const EARTH_MU_KM3_S2 = G_KM3_KG_S2 * EARTH_MASS_KG;

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
  return scale(relative, -EARTH_MU_KM3_S2 / (radiusKm * radiusKm * radiusKm));
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
  assert(started, "moon_pad_launch_high_parking_orbit: startLaunch rejected");

  let nowMs = NOW_MS;
  let stage2AtStep = -1;
  let maxAltitudeAfterStage2Km = -Infinity;
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
      integrateBody(boosterState, earthState, controller.externalAccelerationKmS2(LAUNCH_BOOSTER_BODY_ID), DT_SEC);
    }
    controller.finalizeStep(state, DT_SEC, nowMs);
    nowMs += DT_SEC * 1000;
    finalSnapshot = controller.statusSnapshot(state);

    if (Number(finalSnapshot?.stageIndex) >= 1) {
      if (stage2AtStep < 0) {
        stage2AtStep = step;
      }
      maxAltitudeAfterStage2Km = Math.max(
        maxAltitudeAfterStage2Km,
        Number(finalSnapshot?.altitudeKm) || -Infinity,
      );
    }
  }

  assert(stage2AtStep >= 0 && stage2AtStep <= 260, `moon_pad_launch_high_parking_orbit: expected stage 2 handoff within 260 s, got ${stage2AtStep}`);
  assert(
    Number(finalSnapshot?.targetOrbitAltitudeKm) === MOON_PARKING_ORBIT_APOAPSIS_KM,
    `moon_pad_launch_high_parking_orbit: expected mission target altitude ${MOON_PARKING_ORBIT_APOAPSIS_KM}, got ${finalSnapshot?.targetOrbitAltitudeKm}`,
  );
  assert(
    maxAltitudeAfterStage2Km >= (MOON_PARKING_ORBIT_PERIAPSIS_KM * 0.9),
    `moon_pad_launch_high_parking_orbit: expected stage 2 climb into the ${MOON_PARKING_ORBIT_PERIAPSIS_KM} km band, got ${maxAltitudeAfterStage2Km}`,
  );
  assert(
    String(finalSnapshot?.missionPhase || "") === "orbital_refuel",
    `moon_pad_launch_high_parking_orbit: expected orbital_refuel after parking insertion, got ${finalSnapshot?.missionPhase}`,
  );
  assert(
    Number(finalSnapshot?.apoapsisKm) >= MOON_PARKING_ORBIT_APOAPSIS_KM,
    `moon_pad_launch_high_parking_orbit: expected apoapsis >= ${MOON_PARKING_ORBIT_APOAPSIS_KM} km, got ${finalSnapshot?.apoapsisKm}`,
  );
  assert(
    Number(finalSnapshot?.periapsisKm) >= MOON_PARKING_ORBIT_PERIAPSIS_KM,
    `moon_pad_launch_high_parking_orbit: expected periapsis >= ${MOON_PARKING_ORBIT_PERIAPSIS_KM} km, got ${finalSnapshot?.periapsisKm}`,
  );

  console.log("PASS moon-pad-launch-high-parking-orbit-e2e");
}

main();
