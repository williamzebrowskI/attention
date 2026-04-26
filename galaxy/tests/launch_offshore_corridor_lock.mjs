import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import {
  LAUNCH_BODY_ID,
  LAUNCH_BOOSTER_BODY_ID,
  LAUNCH_SITE,
  LAUNCH_VEHICLE_CONFIG,
} from "../app/static/js/physics/launch/launchConfig.js";
import { earthAtmosphereSampleUS1976 } from "../app/static/js/physics/atmosphere/atmosphereDynamics.js";

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

function cross(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function length(vector) {
  return Math.sqrt(dot(vector, vector));
}

function normalize(vector, fallback = { x: 0, y: 0, z: 1 }) {
  const magnitude = length(vector);
  if (!(magnitude > 1e-12)) {
    return fallback;
  }
  return scale(vector, 1 / magnitude);
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

function localEastNorth(up) {
  const axes = earthAxes();
  const east = normalize(
    cross(axes.pole, up),
    normalize(cross({ x: 0, y: 0, z: 1 }, up), { x: 1, y: 0, z: 0 }),
  );
  return {
    east,
    north: normalize(cross(up, east), { x: 0, y: 1, z: 0 }),
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
    sampleEarthAtmosphere: (altitudeKm, sampleOptions = {}) => earthAtmosphereSampleUS1976(altitudeKm, sampleOptions),
    windSeed: 1,
    gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
  });
}

const configuredHeadingDeg = Number(LAUNCH_VEHICLE_CONFIG.guidance?.ascentHeadingDegFromEast);
assert(
  Number.isFinite(configuredHeadingDeg) && configuredHeadingDeg >= 0 && configuredHeadingDeg <= 25,
  `launch_offshore_corridor_lock: expected Starbase offshore heading in the east/northeast Gulf corridor, got ${configuredHeadingDeg}`,
);

const state = makeState();
const controller = createHarness();
assert(
  controller.startLaunch(state, NOW_MS, { launchKind: "offshore-corridor-lock" }),
  "launch_offshore_corridor_lock: startLaunch rejected",
);

let nowMs = NOW_MS;
let sample = null;
for (let step = 0; step < 140; step += 1) {
  controller.prepareStep(state, DT_SEC, nowMs);
  const earthState = state.staticSources.get("earth");
  for (const bodyId of [LAUNCH_BODY_ID, LAUNCH_BOOSTER_BODY_ID]) {
    const bodyState = state.dynamicBodies.get(bodyId);
    if (bodyState) {
      integrateBody(
        bodyState,
        earthState,
        controller.externalAccelerationKmS2(bodyId),
        DT_SEC,
      );
    }
  }
  controller.finalizeStep(state, DT_SEC, nowMs);
  nowMs += DT_SEC * 1000;

  const snapshot = controller.statusSnapshot(state);
  const altitudeKm = Number(snapshot?.altitudeKm) || 0;
  if (altitudeKm < 10) {
    continue;
  }
  const shipState = state.dynamicBodies.get(LAUNCH_BODY_ID);
  assert(shipState, "launch_offshore_corridor_lock: missing launch body");
  const up = normalize(subtract(shipState.position, earthState.position));
  const { east, north } = localEastNorth(up);
  const commandedDirection = normalize(controller.externalAccelerationKmS2(LAUNCH_BODY_ID), up);
  const verticalComponent = scale(up, dot(commandedDirection, up));
  const horizontalDirection = normalize(subtract(commandedDirection, verticalComponent), east);
  sample = {
    altitudeKm,
    elapsedSeconds: Number(snapshot?.elapsedSeconds) || 0,
    guidanceMode: String(snapshot?.guidanceMode || ""),
    eastComponent: dot(horizontalDirection, east),
    northComponent: dot(horizontalDirection, north),
    headingDegFromEast: Math.atan2(
      dot(horizontalDirection, north),
      dot(horizontalDirection, east),
    ) * (180 / Math.PI),
  };
  break;
}

assert(sample, "launch_offshore_corridor_lock: missing 10 km ascent sample");
assert(
  sample.guidanceMode.includes("pitch-program") || sample.guidanceMode.includes("gravity-turn"),
  `launch_offshore_corridor_lock: expected ascent guidance, got ${sample.guidanceMode}`,
);
assert(
  sample.eastComponent > 0.94,
  `launch_offshore_corridor_lock: expected strong east/offshore heading, got ${JSON.stringify(sample)}`,
);
assert(
  sample.northComponent > 0.05 && sample.northComponent < 0.45,
  `launch_offshore_corridor_lock: expected east/northeast Gulf corridor, got ${JSON.stringify(sample)}`,
);
assert(
  Math.abs(sample.headingDegFromEast - configuredHeadingDeg) <= 4,
  `launch_offshore_corridor_lock: commanded heading should track config ${configuredHeadingDeg} deg, got ${JSON.stringify(sample)}`,
);

console.log("PASS launch-offshore-corridor-lock");
