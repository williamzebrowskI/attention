import { createLaunchFleetController } from "../app/static/js/physics/launch/launchFleetController.js";
import { LAUNCH_VEHICLE_CONFIG } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";
import { MOON_ORBIT_INJECT_ALTITUDE_KM } from "../app/static/js/physics/launch/lunar/constants.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const SUN_MASS_KG = 1.9885e30;
const NOW_MS = Date.UTC(2026, 2, 5, 12, 0, 0);
const EARTH_MU_KM3_S2 = G_KM3_KG_S2 * EARTH_MASS_KG;
const SAMPLE_END_SEC = 720;
const STEP_SEC = 20;
const MIN_SAFE_PERIAPSIS_KM = 200;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertApprox(actual, expected, tolerance, message) {
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  assert(
    Number.isFinite(actualNumber)
      && Number.isFinite(expectedNumber)
      && Math.abs(actualNumber - expectedNumber) <= tolerance,
    `${message}: expected ${expectedNumber} +/- ${tolerance}, got ${actualNumber}`,
  );
}

function stageAtIndex(index) {
  return LAUNCH_VEHICLE_CONFIG.stages[index] || null;
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
    staticSources: new Map(),
  };
}

function addStaticBody(state, id, position, velocity, massKg) {
  state.staticSources.set(id, {
    id,
    position,
    velocity,
    massKg,
  });
}

function seedWorld(state) {
  addStaticBody(
    state,
    "earth",
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    EARTH_MASS_KG,
  );
  addStaticBody(
    state,
    "moon",
    { x: 384400, y: 0, z: 0 },
    { x: 0, y: 1.022, z: 0 },
    MOON_MASS_KG,
  );
  addStaticBody(
    state,
    "sun",
    { x: 149597870.7, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    SUN_MASS_KG,
  );
}

function vAdd(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function vScale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function vLen(a) {
  return Math.sqrt((a.x * a.x) + (a.y * a.y) + (a.z * a.z));
}

function gravityAccelKmS2(positionKm) {
  const radiusKm = Math.max(1, vLen(positionKm));
  return vScale(positionKm, -EARTH_MU_KM3_S2 / (radiusKm * radiusKm * radiusKm));
}

function integrateBody(bodyState, commandedAccelerationKmS2, dtSec) {
  const grav = gravityAccelKmS2(bodyState.position);
  const accel = vAdd(grav, commandedAccelerationKmS2 || { x: 0, y: 0, z: 0 });
  bodyState.velocity = vAdd(bodyState.velocity, vScale(accel, dtSec));
  bodyState.position = vAdd(bodyState.position, vScale(bodyState.velocity, dtSec));
}

function main() {
  const runtime = {
    windSeed: 1,
    fleet: {
      nextShipSequence: 1,
      vehicles: new Map(),
    },
    refuel: {
      flights: [],
    },
  };
  const controller = createLaunchFleetController({
    runtime,
    stageAtIndex,
    getEarthRadiusKm: () => EARTH_RADIUS_KM,
    getEarthMassKg: () => EARTH_MASS_KG,
    getBodyRadiusKm: (id) => (String(id) === "moon" ? MOON_RADIUS_KM : EARTH_RADIUS_KM),
    getBodyMassKg: (id) => (String(id) === "moon" ? MOON_MASS_KG : EARTH_MASS_KG),
    sampleEarthAtmosphere,
    earthAxes,
    gravitationalConstantKm3PerKgS2: G_KM3_KG_S2,
    emitLaunchEvent: null,
  });
  const state = makeState();
  seedWorld(state);

  const launch = controller.launchMissionShip(
    state,
    LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
    NOW_MS,
    { mode: "orbit_inject" },
  );
  assert(
    launch.accepted,
    `moon_orbit_inject_periapsis_margin: launch rejected (${launch.reason || "unknown"})`,
  );
  assertApprox(
    launch.orbitInjectAltitudeKm,
    MOON_ORBIT_INJECT_ALTITUDE_KM,
    1e-6,
    "moon_orbit_inject_periapsis_margin: launch should use the shared moon inject altitude",
  );

  const shipId = launch.shipId;
  let minPeriapsisKm = Number.POSITIVE_INFINITY;
  let firstSurvivalSnapshot = null;
  let firstReacquireSnapshot = null;
  let lastSnapshot = null;

  for (let second = STEP_SEC; second <= SAMPLE_END_SEC; second += STEP_SEC) {
    const nowMs = NOW_MS + (second * 1000);
    controller.prepareStep(state, STEP_SEC, nowMs);
    for (const [bodyId, bodyState] of state.dynamicBodies.entries()) {
      integrateBody(bodyState, controller.externalAccelerationKmS2(bodyId), STEP_SEC);
    }
    controller.finalizeStep(state, STEP_SEC, nowMs);

    const snapshot = controller.statusSnapshotForBody({
      state,
      bodyId: shipId,
      nowMs,
      baseSnapshot: {},
    });
    lastSnapshot = snapshot;

    const periapsisKm = Number(snapshot.periapsisKm);
    if (Number.isFinite(periapsisKm)) {
      minPeriapsisKm = Math.min(minPeriapsisKm, periapsisKm);
    }

    const guidanceMode = String(snapshot.guidanceMode || "");
    if (!firstSurvivalSnapshot && guidanceMode.includes("navsys:moon-survival-recovery")) {
      firstSurvivalSnapshot = {
        second,
        guidanceMode,
        periapsisKm,
        altitudeKm: Number(snapshot.altitudeKm),
      };
    }
    if (!firstReacquireSnapshot && guidanceMode.includes("navsys:gnc-lambert-tli-hold")) {
      firstReacquireSnapshot = {
        second,
        guidanceMode,
      };
    }
  }

  assert(
    !firstSurvivalSnapshot,
    `moon_orbit_inject_periapsis_margin: nominal inject should not enter survival recovery (${firstSurvivalSnapshot?.second}s, peri ${firstSurvivalSnapshot?.periapsisKm}, alt ${firstSurvivalSnapshot?.altitudeKm}, ${firstSurvivalSnapshot?.guidanceMode})`,
  );
  assert(
    !firstReacquireSnapshot,
    `moon_orbit_inject_periapsis_margin: nominal inject should not enter reacquire-window (${firstReacquireSnapshot?.second}s, ${firstReacquireSnapshot?.guidanceMode})`,
  );
  assert(
    Number.isFinite(minPeriapsisKm) && minPeriapsisKm >= MIN_SAFE_PERIAPSIS_KM,
    `moon_orbit_inject_periapsis_margin: expected minimum periapsis >= ${MIN_SAFE_PERIAPSIS_KM} km, got ${minPeriapsisKm}`,
  );
  assert(
    String(lastSnapshot?.guidanceMode || "").includes("navsys:gnc-lambert-tli-burn+seed-lock"),
    `moon_orbit_inject_periapsis_margin: expected late TLI to remain in seed-lock burn, got ${lastSnapshot?.guidanceMode}`,
  );
  assert(
    Number(lastSnapshot?.guidanceRequestedThrottle) > 0.5,
    `moon_orbit_inject_periapsis_margin: expected late TLI to keep requesting burn, got ${lastSnapshot?.guidanceRequestedThrottle}`,
  );
  assert(
    String(lastSnapshot?.missionPhase || "") === "tli_burn",
    `moon_orbit_inject_periapsis_margin: expected late checkpoint to remain in tli_burn, got ${lastSnapshot?.missionPhase}`,
  );

  console.log("PASS moon-orbit-inject-periapsis-margin-e2e");
}

main();
