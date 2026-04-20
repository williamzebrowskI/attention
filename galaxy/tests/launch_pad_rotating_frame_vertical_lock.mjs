import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import {
  EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
  LAUNCH_BODY_ID,
  LAUNCH_SITE,
} from "../app/static/js/physics/launch/launchConfig.js";
import { surfacePointRelativeKmAtLatLon } from "../app/static/js/physics/surface/earthSurfacePhysics.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 3, 20, 18, 38, 14);
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

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function scale(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function cross(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function length(vector) {
  return Math.sqrt(dot(vector, vector));
}

function normalize(vector, fallback = { x: 0, y: 0, z: 1 }) {
  const magnitude = length(vector);
  if (!(magnitude > 1e-12)) {
    return { ...fallback };
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

function earthAxesAt(timestampMs) {
  const elapsedSec = (Number(timestampMs) - NOW_MS) / 1000;
  const theta = EARTH_SIDEREAL_ANGULAR_RATE_RAD_S * elapsedSec;
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);
  return {
    xAxis: { x: cosTheta, y: sinTheta, z: 0 },
    yAxis: { x: -sinTheta, y: cosTheta, z: 0 },
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
    getEarthFixedAxesEcliptic: earthAxesAt,
    sampleEarthAtmosphere,
    windSeed: 1,
    gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
  });
}

function launchSiteSurfaceNormal(nowMs) {
  const surface = surfacePointRelativeKmAtLatLon(
    LAUNCH_SITE.latitudeDeg,
    LAUNCH_SITE.longitudeDeg,
    earthAxesAt(nowMs),
    { includeTerrain: true },
  );
  assert(surface?.surfaceNormal, "expected launch-site surface normal");
  return normalize(surface.surfaceNormal);
}

function decompose(vector, up) {
  const radial = dot(vector, up);
  const lateral = subtract(vector, scale(up, radial));
  return {
    radial,
    lateralMagnitude: length(lateral),
  };
}

function corotationVelocityKmS(relativePositionKm, nowMs) {
  return cross(
    scale(earthAxesAt(nowMs).pole, EARTH_SIDEREAL_ANGULAR_RATE_RAD_S),
    relativePositionKm,
  );
}

const state = makeState();
const controller = createHarness();
assert(
  controller.startLaunch(state, NOW_MS, { launchKind: "rotating-frame-vertical-lock" }),
  "launch start rejected",
);

let nowMs = NOW_MS;
let maxAccelerationLateralKmS2 = 0;
let maxGroundLateralSpeedKmS = 0;
let maxAltitudeKm = 0;

for (let step = 0; step < 5; step += 1) {
  controller.prepareStep(state, DT_SEC, nowMs);
  const earthState = state.staticSources.get("earth");
  const shipState = state.dynamicBodies.get(LAUNCH_BODY_ID);
  assert(earthState && shipState, "missing Earth or ship state during rotating-frame lock");

  const up = launchSiteSurfaceNormal(nowMs);
  const relativePosition = subtract(shipState.position, earthState.position);
  const groundRelativeVelocity = subtract(
    subtract(shipState.velocity || { x: 0, y: 0, z: 0 }, earthState.velocity || { x: 0, y: 0, z: 0 }),
    corotationVelocityKmS(relativePosition, nowMs),
  );
  const commandedAcceleration = controller.externalAccelerationKmS2(LAUNCH_BODY_ID);

  const accelParts = decompose(commandedAcceleration, up);
  const groundVelocityParts = decompose(groundRelativeVelocity, up);
  maxAccelerationLateralKmS2 = Math.max(maxAccelerationLateralKmS2, accelParts.lateralMagnitude);
  maxGroundLateralSpeedKmS = Math.max(maxGroundLateralSpeedKmS, groundVelocityParts.lateralMagnitude);

  integrateBody(shipState, earthState, commandedAcceleration, DT_SEC);
  controller.finalizeStep(state, DT_SEC, nowMs);
  nowMs += DT_SEC * 1000;

  const snapshot = controller.statusSnapshot(state);
  maxAltitudeKm = Math.max(maxAltitudeKm, Number(snapshot?.altitudeKm) || 0);
}

assert(
  maxAccelerationLateralKmS2 < 0.001,
  `expected early rotating-frame acceleration to stay near local vertical, got lateral accel ${maxAccelerationLateralKmS2} km/s^2`,
);
assert(
  maxGroundLateralSpeedKmS < 0.001,
  `expected early rotating-frame climb to avoid large lateral drift, got lateral speed ${maxGroundLateralSpeedKmS} km/s`,
);
assert(
  maxAltitudeKm > 0.01,
  `expected vehicle to gain altitude in early ascent, got peak altitude ${maxAltitudeKm} km`,
);

console.log("PASS launch-pad-rotating-frame-vertical-lock");
