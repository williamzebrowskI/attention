import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { LAUNCH_BODY_ID, LAUNCH_BOOSTER_BODY_ID } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 5, 18, 0, 0);
const DT_SEC = 1;
const MAX_STEPS = 320;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
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
    windSeed: 1,
    gravitationalConstantKm3PerKgS2: G_KM3_KG_S2,
  });
  const state = makeState();
  controller.setMissionProfile(LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN);
  const started = controller.startLaunch(state, NOW_MS, {
    launchKind: "hotstage-window-miss-lock",
    boosterEngineCount: 24,
  });
  assert(started, "launch_hotstage_window_miss_anomaly_lock: startLaunch rejected");

  let nowMs = NOW_MS;
  let finalStatus = null;
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
    finalStatus = controller.statusSnapshot(state);
  }

  assert(finalStatus, "launch_hotstage_window_miss_anomaly_lock: missing final status snapshot");
  assert(finalStatus.stageIndex === 0, `launch_hotstage_window_miss_anomaly_lock: expected to remain on stage 0, got ${finalStatus.stageIndex}`);
  assert(finalStatus.stageTransitionPending, "launch_hotstage_window_miss_anomaly_lock: expected pending hotstage transition after missing window");
  assert(finalStatus.stageTransitionKind === "hotstage_ignite", `launch_hotstage_window_miss_anomaly_lock: expected hotstage_ignite transition, got ${finalStatus.stageTransitionKind || "missing"}`);
  assert(finalStatus.stageTransitionAnomalyActive, "launch_hotstage_window_miss_anomaly_lock: expected hotstage anomaly state");
  assert(
    String(finalStatus.stageTransitionAnomalyReason || "").startsWith("hotstage_window_missed")
      || String(finalStatus.stageTransitionAnomalyReason || "") === "hotstage_never_armed",
    `launch_hotstage_window_miss_anomaly_lock: unexpected anomaly reason ${finalStatus.stageTransitionAnomalyReason || "missing"}`,
  );
  assert(
    String(finalStatus.guidanceMode || "").includes("hotstage-anomaly-hold"),
    `launch_hotstage_window_miss_anomaly_lock: expected hotstage anomaly guidance hold, got ${finalStatus.guidanceMode || "missing"}`,
  );
  assert(
    finalStatus.phase === "coast",
    `launch_hotstage_window_miss_anomaly_lock: expected coast/hold phase after hotstage anomaly, got ${finalStatus.phase || "missing"}`,
  );
  assert(
    controller.isPrimaryLaunchActive() === false,
    "launch_hotstage_window_miss_anomaly_lock: missed hotstage anomaly should not block a fresh primary pad launch",
  );

  controller.setMissionProfile(LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD);
  const restarted = controller.startLaunch(state, nowMs, {
    launchKind: "hotstage-window-miss-relaunch-lock",
    boosterEngineCount: 33,
  });
  assert(restarted, "launch_hotstage_window_miss_anomaly_lock: relaunch after anomaly was rejected");
  controller.prepareStep(state, DT_SEC, nowMs);
  const relaunchShipState = state.dynamicBodies.get(LAUNCH_BODY_ID);
  const relaunchEarthState = state.staticSources.get("earth");
  if (relaunchShipState) {
    integrateBody(relaunchShipState, relaunchEarthState, controller.externalAccelerationKmS2(LAUNCH_BODY_ID), DT_SEC);
  }
  controller.finalizeStep(state, DT_SEC, nowMs);
  const relaunchStatus = controller.statusSnapshot(state);
  assert(
    relaunchStatus.stageIndex === 0 && relaunchStatus.phase === "powered",
    `launch_hotstage_window_miss_anomaly_lock: relaunch should reset to powered stage 1, got stage ${relaunchStatus.stageIndex} phase ${relaunchStatus.phase || "missing"}`,
  );
  assert(
    !relaunchStatus.stageTransitionPending,
    "launch_hotstage_window_miss_anomaly_lock: relaunch should clear pending hotstage anomaly state",
  );

  console.log("PASS launch-hotstage-window-miss-anomaly-lock");
}

main();
