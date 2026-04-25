import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import {
  LAUNCH_BODY_ID,
  LAUNCH_BOOSTER_BODY_ID,
  STARSHIP_STACK_DIMENSIONS_KM,
} from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 5, 18, 0, 0);
const DT_SEC = 1 / 10;
const MAX_STEPS = 12000;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(vector, scalar) {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
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
      ["earth", { id: "earth", position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, massKg: EARTH_MASS_KG }],
      ["moon", { id: "moon", position: { x: 384400, y: 0, z: 0 }, velocity: { x: 0, y: 1.022, z: 0 }, massKg: MOON_MASS_KG }],
    ]),
  };
}

function createHarness(onEvent = null) {
  return createLaunchController({
    getEarthRadiusKm: () => EARTH_RADIUS_KM,
    getEarthMassKg: () => EARTH_MASS_KG,
    getBodyRadiusKm: (id) => (String(id) === "moon" ? MOON_RADIUS_KM : EARTH_RADIUS_KM),
    getBodyMassKg: (id) => (String(id) === "moon" ? MOON_MASS_KG : EARTH_MASS_KG),
    getEarthFixedAxesEcliptic: earthAxes,
    sampleEarthAtmosphere,
    windSeed: 1,
    gravitationalConstantKm3PerKgS2: G_KM3_KG_S2,
    onEvent,
  });
}

function main() {
  let detachEvent = null;
  const controller = createHarness((event) => {
    if (event?.name === "stage_separation_booster_detached") {
      detachEvent = event;
    }
  });

  const state = makeState();
  controller.setMissionProfile(LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN);
  const started = controller.startLaunch(state, NOW_MS, { launchKind: "surface-launch-test" });
  assert(started, "launch_hotstage_overlap_continuity: startLaunch rejected");

  let nowMs = NOW_MS;
  let overlapSeen = false;
  let detachSeen = false;
  let persistentBoosterRef = null;
  let boosterSeenAttached = false;

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
    const attachedBooster = state.dynamicBodies.get(LAUNCH_BOOSTER_BODY_ID) || null;

    if (!snapshot?.boosterActive && attachedBooster) {
      boosterSeenAttached = true;
      if (!persistentBoosterRef) {
        persistentBoosterRef = attachedBooster;
      }
    }

    if (snapshot?.hotstageActive) {
      overlapSeen = true;
      assert(!snapshot?.boosterActive, "launch_hotstage_overlap_continuity: booster should not be physically detached during overlap");
    }

    if (snapshot?.boosterActive) {
      const separationAxis = normalize(detachEvent?.separationAxisWorldKm, null);
      const expectedDetachDistanceKm = (
        0.5 * STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm
        + 0.5 * STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm
      );
      assert(separationAxis, "launch_hotstage_overlap_continuity: missing detach separation axis");
      assert(
        Number.isFinite(expectedDetachDistanceKm) && expectedDetachDistanceKm > 0,
        "launch_hotstage_overlap_continuity: missing expected detach distance",
      );
      const liveShip = state.dynamicBodies.get(LAUNCH_BODY_ID);
      const liveBooster = state.dynamicBodies.get(LAUNCH_BOOSTER_BODY_ID);
      assert(liveShip && liveBooster, "launch_hotstage_overlap_continuity: detached bodies unavailable");
      assert(boosterSeenAttached, "launch_hotstage_overlap_continuity: booster body never existed before detach");
      assert(
        persistentBoosterRef && liveBooster === persistentBoosterRef,
        "launch_hotstage_overlap_continuity: booster body was replaced at detach instead of being released",
      );
      const shipToBooster = subtract(liveBooster.position, liveShip.position);
      const shipToBoosterDir = normalize(shipToBooster);
      const detachAxisAlignment = dot(shipToBoosterDir, scale(separationAxis, -1));
      const detachDistanceKm = length(shipToBooster);
      assert(
        detachAxisAlignment >= 0.995,
        `launch_hotstage_overlap_continuity: detach jumped off-axis with alignment ${detachAxisAlignment}`,
      );
      assert(
        Math.abs(detachDistanceKm - expectedDetachDistanceKm) <= 0.002,
        `launch_hotstage_overlap_continuity: detach distance ${detachDistanceKm}km diverged from overlap ${expectedDetachDistanceKm}km`,
      );
      detachSeen = true;
      break;
    }
  }

  assert(overlapSeen, "launch_hotstage_overlap_continuity: never observed hotstage overlap");
  assert(detachSeen, "launch_hotstage_overlap_continuity: never observed hotstage detach");

  console.log("PASS launch-hotstage-overlap-continuity-lock");
}

main();
