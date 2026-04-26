import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { LAUNCH_BODY_ID } from "../app/static/js/physics/launch/launchConfig.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const NOW_MS = Date.UTC(2026, 2, 5, 18, 0, 0);
const DT_SEC = 0.25;
const MAX_STEPS = 2000;

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

function normalize(vector, fallback = { x: 0, y: 0, z: 1 }) {
  const magnitude = length(vector);
  if (!(magnitude > 1e-9)) {
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
    ]),
  };
}

function tiltDegFromVertical(direction, up) {
  return Math.acos(Math.max(-1, Math.min(1, dot(direction, up)))) * (180 / Math.PI);
}

const controller = createLaunchController({
  getEarthRadiusKm: () => EARTH_RADIUS_KM,
  getEarthMassKg: () => EARTH_MASS_KG,
  getBodyRadiusKm: () => EARTH_RADIUS_KM,
  getBodyMassKg: () => EARTH_MASS_KG,
  getEarthFixedAxesEcliptic: earthAxes,
  sampleEarthAtmosphere,
  windSeed: 1,
  gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
});

const state = makeState();
const started = controller.startLaunch(state, NOW_MS, {
  launchKind: "pitchover-visibility-lock",
  boosterEngineCount: 33,
});
assert(started, "launch_pitchover_visibility_lock: startLaunch rejected");

let nowMs = NOW_MS;
const marks = {
  "1": null,
  "3": null,
  "5": null,
  "10": null,
};

for (let step = 0; step < MAX_STEPS; step += 1) {
  controller.prepareStep(state, DT_SEC, nowMs);
  const earthState = state.staticSources.get("earth");
  const shipState = state.dynamicBodies.get(LAUNCH_BODY_ID);
  assert(shipState, "launch_pitchover_visibility_lock: missing launch body");
  const commandedAccelerationKmS2 = controller.externalAccelerationKmS2(LAUNCH_BODY_ID);
  integrateBody(shipState, earthState, commandedAccelerationKmS2, DT_SEC);
  controller.finalizeStep(state, DT_SEC, nowMs);
  nowMs += DT_SEC * 1000;

  const snapshot = controller.statusSnapshot(state);
  const altitudeKm = Number(snapshot?.altitudeKm) || 0;
  const up = normalize(subtract(shipState.position, earthState.position));
  const commandedDirection = normalize(commandedAccelerationKmS2, up);
  const tiltDeg = tiltDegFromVertical(commandedDirection, up);
  const guidanceMode = String(snapshot?.guidanceMode || "");

  for (const targetAltitudeKm of [1, 3, 5, 10]) {
    const key = String(targetAltitudeKm);
    if (!marks[key] && altitudeKm >= targetAltitudeKm) {
      marks[key] = {
        elapsedSec: Number(snapshot?.elapsedSeconds) || 0,
        altitudeKm,
        tiltDeg,
        telemetryCommandPitchDeg: Number.isFinite(Number(snapshot?.commandedPitchFromVerticalDeg))
          ? Number(snapshot.commandedPitchFromVerticalDeg)
          : null,
        telemetryBodyPitchDeg: Number.isFinite(Number(snapshot?.bodyPitchFromVerticalDeg))
          ? Number(snapshot.bodyPitchFromVerticalDeg)
          : null,
        ascentCorridorName: String(snapshot?.ascentCorridorName || ""),
        ascentHeadingDegFromEast: Number.isFinite(Number(snapshot?.ascentHeadingDegFromEast))
          ? Number(snapshot.ascentHeadingDegFromEast)
          : null,
        hasGuidanceRequestedDirection: Boolean(snapshot?.guidanceRequestedDirectionKm),
        hasBodyAxisDirection: Boolean(snapshot?.bodyAxisDirectionKm),
        guidanceMode,
      };
    }
  }

  if (Object.values(marks).every(Boolean)) {
    break;
  }
}

for (const [altitudeKm, sample] of Object.entries(marks)) {
  assert(sample, `launch_pitchover_visibility_lock: missing sample at ${altitudeKm} km`);
}

assert(
  marks["1"].tiltDeg >= 1.4,
  `launch_pitchover_visibility_lock: expected visible pitchover by 1 km, got ${marks["1"].tiltDeg.toFixed(2)} deg`,
);
assert(
  marks["3"].tiltDeg >= 4.0,
  `launch_pitchover_visibility_lock: expected meaningful pitchover by 3 km, got ${marks["3"].tiltDeg.toFixed(2)} deg`,
);
assert(
  marks["5"].tiltDeg >= 4.8,
  `launch_pitchover_visibility_lock: expected clear pitchover by 5 km, got ${marks["5"].tiltDeg.toFixed(2)} deg`,
);
assert(
  marks["10"].tiltDeg >= 6.0,
  `launch_pitchover_visibility_lock: expected sustained early gravity-turn posture by 10 km, got ${marks["10"].tiltDeg.toFixed(2)} deg`,
);
assert(
  marks["1"].guidanceMode.includes("pitch-program"),
  `launch_pitchover_visibility_lock: expected pitch-program guidance by 1 km, got ${marks["1"].guidanceMode}`,
);
assert(
  marks["1"].hasGuidanceRequestedDirection && marks["1"].hasBodyAxisDirection,
  "launch_pitchover_visibility_lock: expected ascent attitude vectors in launch snapshot by 1 km",
);
assert(
  Number.isFinite(marks["1"].telemetryCommandPitchDeg) && marks["1"].telemetryCommandPitchDeg >= 1.4,
  `launch_pitchover_visibility_lock: expected commanded pitch telemetry by 1 km, got ${marks["1"].telemetryCommandPitchDeg}`,
);
assert(
  Number.isFinite(marks["1"].telemetryBodyPitchDeg) && marks["1"].telemetryBodyPitchDeg >= 1.4,
  `launch_pitchover_visibility_lock: expected body pitch telemetry by 1 km, got ${marks["1"].telemetryBodyPitchDeg}`,
);
assert(
  String(marks["1"].ascentCorridorName).includes("Gulf")
    && marks["1"].ascentHeadingDegFromEast > 0
    && marks["1"].ascentHeadingDegFromEast < 45,
  `launch_pitchover_visibility_lock: expected Gulf offshore ascent corridor telemetry, got ${marks["1"].ascentCorridorName} ${marks["1"].ascentHeadingDegFromEast}`,
);

console.log("launch-pitchover-visibility-lock: ok");
