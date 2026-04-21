import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { LAUNCH_BODY_ID, LAUNCH_BOOSTER_BODY_ID } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 5, 18, 0, 0);
const DT_SEC = 1;
const MAX_STEPS = 360;

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
    gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
  });
}

function main() {
  const state = makeState();
  const controller = createHarness();
  controller.setMissionProfile(LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO);
  assert(controller.startLaunch(state, NOW_MS, { launchKind: "booster-post-hotstage-boostback-lock" }), "startLaunch rejected");

  let nowMs = NOW_MS;
  const phaseChanges = [];

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
    if (!snapshot.boosterActive) {
      continue;
    }
    const currentPhase = String(snapshot.boosterPhase || "").trim().toLowerCase();
    const lastPhase = phaseChanges[phaseChanges.length - 1]?.phase || "";
    if (currentPhase && currentPhase !== lastPhase) {
      phaseChanges.push({
        elapsedSec: Number(snapshot.elapsedSeconds) || 0,
        phase: currentPhase,
        guidanceMode: String(snapshot.boosterGuidanceMode || ""),
        throttle: Number(snapshot.boosterThrottle) || 0,
        altitudeKm: Number(snapshot.boosterAltitudeKm) || 0,
        lateralRangeKm: Number(snapshot.boosterLaunchSiteLateralRangeKm) || 0,
      });
    }
    if (phaseChanges.some((entry) => entry.phase === "boostback")) {
      break;
    }
  }

  const separationFlipIndex = phaseChanges.findIndex((entry) => entry.phase === "separation-flip");
  const boostbackIndex = phaseChanges.findIndex((entry) => entry.phase === "boostback");
  assert(separationFlipIndex >= 0, `expected separation-flip in phase trace, got ${JSON.stringify(phaseChanges)}`);
  assert(boostbackIndex >= 0, `expected boostback soon after hotstage, got ${JSON.stringify(phaseChanges)}`);
  assert(boostbackIndex > separationFlipIndex, `expected boostback after separation-flip, got ${JSON.stringify(phaseChanges)}`);

  const preBoostbackPhases = phaseChanges.slice(separationFlipIndex + 1, boostbackIndex).map((entry) => entry.phase);
  assert(
    !preBoostbackPhases.includes("descent-coast") && !preBoostbackPhases.includes("entry-align") && !preBoostbackPhases.includes("entry-burn"),
    `expected no descent/entry phases before boostback, got ${JSON.stringify(phaseChanges)}`,
  );

  const separationFlip = phaseChanges[separationFlipIndex];
  const boostback = phaseChanges[boostbackIndex];
  assert(
    (boostback.elapsedSec - separationFlip.elapsedSec) <= 14,
    `expected boostback within 14 s of hotstage separation, got ${boostback.elapsedSec - separationFlip.elapsedSec} s`,
  );
  assert(
    boostback.throttle >= 0.35,
    `expected meaningful boostback throttle, got ${boostback.throttle}`,
  );

  console.log("PASS booster-post-hotstage-boostback-lock");
}

main();
