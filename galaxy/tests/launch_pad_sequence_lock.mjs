import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { LAUNCH_BODY_ID } from "../app/static/js/physics/launch/launchConfig.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 5, 18, 0, 0);
const DT_SEC = 1;

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

const state = makeState();
const controller = createHarness();
const started = controller.startLaunch(state, NOW_MS, { launchKind: "pad-sequence-lock" });
assert(started, "launch start rejected");
const earthState0 = state.staticSources.get("earth");
const shipState0 = state.dynamicBodies.get(LAUNCH_BODY_ID);
assert(earthState0 && shipState0, "expected launch body at pad start");
const initialRelative = subtract(shipState0.position, earthState0.position);
const initialRadius = Math.max(1e-9, length(initialRelative));
const initialUp = scale(initialRelative, 1 / initialRadius);

let nowMs = NOW_MS;
let sawPadRelease = false;
let sawTowerClear = false;
let sawPitchProgram = false;
let towerClearAltitudeKm = Number.NaN;
let maxEarlyLateralDisplacementKm = 0;

for (let step = 0; step < 20; step += 1) {
  controller.prepareStep(state, DT_SEC, nowMs);
  const earthState = state.staticSources.get("earth");
  const shipState = state.dynamicBodies.get(LAUNCH_BODY_ID);
  assert(shipState, "missing launch body during pad sequence lock");
  integrateBody(shipState, earthState, controller.externalAccelerationKmS2(LAUNCH_BODY_ID), DT_SEC);
  controller.finalizeStep(state, DT_SEC, nowMs);
  nowMs += DT_SEC * 1000;

  const snapshot = controller.statusSnapshot(state);
  const guidanceMode = String(snapshot?.guidanceMode || "");
  const displacement = subtract(shipState.position, shipState0.position);
  const lateralDisplacement = subtract(
    displacement,
    scale(initialUp, dot(displacement, initialUp)),
  );
  if ((guidanceMode.includes("autopilot-pad-release") || guidanceMode.includes("autopilot-tower-clear"))
    && Number(snapshot?.altitudeKm) < 0.3) {
    maxEarlyLateralDisplacementKm = Math.max(
      maxEarlyLateralDisplacementKm,
      length(lateralDisplacement),
    );
  }
  if (guidanceMode.includes("autopilot-pad-release")) {
    sawPadRelease = true;
  }
  if (guidanceMode.includes("autopilot-tower-clear")) {
    sawTowerClear = true;
    towerClearAltitudeKm = Number(snapshot?.altitudeKm);
  }
  if (guidanceMode.includes("pitch-program")) {
    sawPitchProgram = true;
  }
}

assert(sawPadRelease, "expected early ascent to enter autopilot-pad-release");
assert(sawTowerClear, "expected early ascent to enter autopilot-tower-clear");
assert(
  Number.isFinite(towerClearAltitudeKm) && towerClearAltitudeKm < 0.35,
  `expected tower-clear guidance while still near the pad, got altitude ${towerClearAltitudeKm}`,
);
assert(
  maxEarlyLateralDisplacementKm < 0.03,
  `expected early pad release to remain nearly vertical, got lateral displacement ${maxEarlyLateralDisplacementKm} km`,
);
assert(sawPitchProgram, "expected ascent to transition from pad/tower-clear into pitch-program");
console.log("launch-pad-sequence-lock: ok");
