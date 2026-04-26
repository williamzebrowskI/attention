import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { LAUNCH_BODY_ID } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const G_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 3, 26, 12, 0, 0);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
  const magnitude = length(vector || fallback);
  if (!(magnitude > 1e-9)) {
    return { ...fallback };
  }
  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude,
    z: vector.z / magnitude,
  };
}

function rad(degrees) {
  return degrees * Math.PI / 180;
}

function pitchFromVerticalDeg(axis, up) {
  const cosine = Math.max(-1, Math.min(1, dot(normalize(axis), normalize(up))));
  return Math.acos(cosine) * 180 / Math.PI;
}

function normalizeQuaternion(quat) {
  const magnitude = Math.hypot(quat.x, quat.y, quat.z, quat.w);
  if (!(magnitude > 1e-9)) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  return {
    x: quat.x / magnitude,
    y: quat.y / magnitude,
    z: quat.z / magnitude,
    w: quat.w / magnitude,
  };
}

function quaternionFromUnitVectors(from, to) {
  const a = normalize(from);
  const b = normalize(to);
  const c = cross(a, b);
  const w = 1 + dot(a, b);
  if (w < 1e-8) {
    return normalizeQuaternion({ x: 0, y: 0, z: 1, w: 0 });
  }
  return normalizeQuaternion({ x: c.x, y: c.y, z: c.z, w });
}

function rotateVectorByQuaternion(vector, quat) {
  const q = normalizeQuaternion(quat);
  const u = { x: q.x, y: q.y, z: q.z };
  const s = q.w;
  const uv = cross(u, vector);
  const uuv = cross(u, uv);
  return {
    x: vector.x + (2 * ((s * uv.x) + uuv.x)),
    y: vector.y + (2 * ((s * uv.y) + uuv.y)),
    z: vector.z + (2 * ((s * uv.z) + uuv.z)),
  };
}

function bodyAxisFromAttitude(attitude) {
  return normalize(rotateVectorByQuaternion({ x: 0, y: 1, z: 0 }, attitude.orientation));
}

function earthAxes() {
  return {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    pole: { x: 0, y: 0, z: 1 },
  };
}

function sampleEarthAtmosphere() {
  return {
    densityKgM3: 0,
    pressurePa: 0,
    temperatureK: 0,
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
    gravitationalConstantKm3PerKgS2: G_KM3_PER_KG_S2,
    windSeed: 7,
  });
}

function main() {
  const state = makeState();
  const controller = createHarness();
  controller.setMissionProfile(LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN);
  const started = controller.startLaunch(state, NOW_MS, { launchKind: "coast-fallback-attitude-lock" });
  assert(started, "starship_coast_fallback_attitude_continuity: startLaunch rejected");

  const snapshot = controller.exportPersistentSnapshot(state, NOW_MS + 1000);
  assert(snapshot?.runtime, "starship_coast_fallback_attitude_continuity: missing runtime snapshot");

  const up = { x: 1, y: 0, z: 0 };
  const inertialAttitudeAxis = normalize({
    x: Math.cos(rad(68)),
    y: Math.sin(rad(68)),
    z: 0,
  });
  const commandAxis = normalize({
    x: Math.cos(rad(72)),
    y: Math.sin(rad(72)),
    z: 0,
  });
  const position = { x: EARTH_RADIUS_KM + 354, y: 0, z: 0 };
  const velocity = { x: 0, y: 7.2, z: 0 };

  snapshot.runtime.commandPhase = "powered";
  snapshot.runtime.phase = "powered";
  snapshot.runtime.elapsedSeconds = 609;
  snapshot.runtime.stageIndex = 1;
  snapshot.runtime.stagePropellantKg = 0;
  snapshot.runtime.autopilotEnabled = true;
  snapshot.runtime.autopilotMode = "autopilot-high-orbit-insertion";
  snapshot.runtime.mission = {
    ...(snapshot.runtime.mission || {}),
    selectedId: LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
    phase: "launch",
    completed: false,
  };
  snapshot.runtime.booster = {
    ...(snapshot.runtime.booster || {}),
    attached: false,
    active: false,
  };
  snapshot.runtime.stageActuator = {
    ...(snapshot.runtime.stageActuator || {}),
    throttleCommand: 1,
    throttleActual: 1,
    directionCommand: commandAxis,
    directionActual: inertialAttitudeAxis,
    gimbalErrorDeg: 4,
    angularRateRadS: 0.004,
  };
  snapshot.runtime.stageAttitude = {
    orientation: quaternionFromUnitVectors({ x: 0, y: 1, z: 0 }, inertialAttitudeAxis),
    omegaBodyRadS: { x: 0.004, y: 0.001, z: 0 },
  };
  snapshot.runtime.lastStep = {
    ...(snapshot.runtime.lastStep || {}),
    burnKg: 20,
    thrustN: 800_000,
    throttle: 0.12,
    throttleCommand: 0.72,
    requestedDirectionKm: commandAxis,
    bodyAxisDirectionKm: inertialAttitudeAxis,
    guidanceMode: "autopilot-high-orbit-insertion+coast-fallback",
  };
  snapshot.managedBodies = [
    {
      id: LAUNCH_BODY_ID,
      massKg: 180_000,
      position,
      velocity,
      relativeToEarth: { position, velocity },
    },
  ];

  const restored = controller.importPersistentSnapshot(state, snapshot, NOW_MS + 2000);
  assert(restored?.applied, `starship_coast_fallback_attitude_continuity: import failed (${restored?.reason || "unknown"})`);

  controller.finalizeStep(state, 1, NOW_MS + 3000);

  const after = controller.exportPersistentSnapshot(state, NOW_MS + 4000);
  const postDryoutAxis = bodyAxisFromAttitude(after.runtime.stageAttitude);
  const postDryoutActuatorAxis = normalize(after.runtime.stageActuator.directionActual);
  const bodyPitchDeg = pitchFromVerticalDeg(postDryoutAxis, up);
  const actuatorPitchDeg = pitchFromVerticalDeg(postDryoutActuatorAxis, up);

  assert(
    bodyPitchDeg > 55,
    `starship_coast_fallback_attitude_continuity: dry-out snapped body vertical (${bodyPitchDeg.toFixed(2)} deg)`,
  );
  assert(
    actuatorPitchDeg > 55,
    `starship_coast_fallback_attitude_continuity: dry-out snapped actuator vertical (${actuatorPitchDeg.toFixed(2)} deg)`,
  );
  assert(
    String(after.runtime.commandPhase || "") === "coast",
    `starship_coast_fallback_attitude_continuity: expected coast command phase, got ${after.runtime.commandPhase}`,
  );

  console.log("PASS starship-coast-fallback-attitude-continuity-lock");
}

main();
