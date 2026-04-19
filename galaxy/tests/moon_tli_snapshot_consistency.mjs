import { createLaunchFleetController } from "../app/static/js/physics/launch/launchFleetController.js";
import { LAUNCH_VEHICLE_CONFIG } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const SUN_MASS_KG = 1.9885e30;
const NOW_MS = Date.UTC(2026, 2, 5, 12, 0, 0);
const EARTH_MU_KM3_S2 = G_KM3_KG_S2 * EARTH_MASS_KG;

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
  assert(launch.accepted, `moon_tli_snapshot_consistency: launch rejected (${launch.reason || "unknown"})`);

  for (let second = 1; second <= 90; second += 1) {
    const nowMs = NOW_MS + (second * 1000);
    controller.prepareStep(state, 1, nowMs);
    for (const [bodyId, bodyState] of state.dynamicBodies.entries()) {
      integrateBody(bodyState, controller.externalAccelerationKmS2(bodyId), 1);
    }
    controller.finalizeStep(state, 1, nowMs);
  }

  const snapshot = controller.statusSnapshotForBody({
    state,
    bodyId: launch.shipId,
    nowMs: NOW_MS + (90 * 1000),
    baseSnapshot: {},
  });
  assert(snapshot, "moon_tli_snapshot_consistency: missing snapshot");
  assert(
    String(snapshot.phaseLabel || "") === "TLI Burn",
    `moon_tli_snapshot_consistency: expected TLI Burn phase label, got ${snapshot.phaseLabel}`,
  );
  assertApprox(
    snapshot.moonProjectedMissDistanceKm,
    snapshot.moonTliTargetMissKm,
    1e-6,
    "moon_tli_snapshot_consistency: projected miss should follow TLI diagnostics",
  );
  assertApprox(
    snapshot.moonProjectedPeriluneAltitudeKm,
    snapshot.moonTliTargetPeriluneKm,
    1e-6,
    "moon_tli_snapshot_consistency: projected perilune should follow TLI diagnostics",
  );
  assertApprox(
    snapshot.moonBPlaneErrorKm,
    snapshot.moonTliTargetBPlaneKm,
    1e-6,
    "moon_tli_snapshot_consistency: B-plane should follow TLI diagnostics",
  );
  assert(
    snapshot.moonProjectedMissTrendKmS === null,
    `moon_tli_snapshot_consistency: projected miss trend should be suppressed during TLI seed lock, got ${snapshot.moonProjectedMissTrendKmS}`,
  );
  assert(
    String(snapshot.missionPhaseGateReason || "").includes("Miss ")
      && String(snapshot.missionPhaseGateReason || "").includes("vs gate")
      && String(snapshot.missionPhaseGateReason || "").includes("[go]"),
    `moon_tli_snapshot_consistency: gate reason should report explicit TLI gate status, got ${snapshot.missionPhaseGateReason}`,
  );

  console.log("PASS moon-tli-snapshot-consistency");
}

main();
