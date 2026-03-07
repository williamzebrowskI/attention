import { createLaunchFleetController } from "../app/static/js/physics/launch/launchFleetController.js";
import { LAUNCH_VEHICLE_CONFIG } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371;
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
  assert(launch.accepted, `moon orbit inject parity: launch rejected (${launch.reason || "unknown"})`);

  const shipId = launch.shipId;
  const vehicle = runtime.fleet.vehicles.get(shipId);
  const shipBody = state.dynamicBodies.get(shipId);
  assert(vehicle, "moon orbit inject parity: missing fleet vehicle");
  assert(shipBody, "moon orbit inject parity: missing ship body");

  assert(vehicle.moonDepartureWindowReady === true, "moon orbit inject parity: departure window should be ready");
  assert(vehicle.moonDepartureCorridorAccepted === true, "moon orbit inject parity: departure corridor should be accepted");
  assert(vehicle.moonDeparturePlanReady === true, "moon orbit inject parity: departure plan should be ready");
  assert(
    Number.isFinite(Number(vehicle.moonDeparturePlanPredictedMissDistanceKm))
      && Number.isFinite(Number(vehicle.moonDeparturePlanPredictedPeriluneAltitudeKm))
      && Number.isFinite(Number(vehicle.moonDeparturePlanBPlaneErrorKm)),
    "moon orbit inject parity: accepted departure plan should have finite propagated metrics",
  );
  const commitWindowSec = Math.max(1, Math.round(Number(vehicle.moonDeparturePlanCommitWindowSec) || 0));
  const commitCheckpointSec = Math.max(25, Math.min(commitWindowSec - 30, Math.round(commitWindowSec * 0.35)));
  const lateCommitCheckpointSec = Math.max(
    commitCheckpointSec + 15,
    Math.min(commitWindowSec - 5, Math.round(commitWindowSec * 0.8)),
  );
  const seedLockCheckpointSec = Math.max(commitWindowSec + 15, lateCommitCheckpointSec + 15);
  const checkpointTimes = [1, commitCheckpointSec, lateCommitCheckpointSec, seedLockCheckpointSec];

  const checkpoints = new Map();
  for (let second = 1; second <= seedLockCheckpointSec; second += 1) {
    const nowMs = NOW_MS + (second * 1000);
    controller.prepareStep(state, 1, nowMs);
    for (const [bodyId, bodyState] of state.dynamicBodies.entries()) {
      integrateBody(bodyState, controller.externalAccelerationKmS2(bodyId), 1);
    }
    controller.finalizeStep(state, 1, nowMs);
    if (checkpointTimes.includes(second)) {
      checkpoints.set(
        second,
        controller.statusSnapshotForBody({
          state,
          bodyId: shipId,
          nowMs,
          baseSnapshot: {},
        }),
      );
    }
  }

  const early = checkpoints.get(1);
  const commit = checkpoints.get(commitCheckpointSec);
  const lateCommit = checkpoints.get(lateCommitCheckpointSec);
  const seedLock = checkpoints.get(seedLockCheckpointSec);
  assert(early, "moon orbit inject parity: missing early checkpoint");
  assert(commit, "moon orbit inject parity: missing commit checkpoint");
  assert(lateCommit, "moon orbit inject parity: missing late commit checkpoint");
  assert(seedLock, "moon orbit inject parity: missing seed-lock checkpoint");

  for (const [label, snapshot] of [["early", early], ["commit", commit], ["lateCommit", lateCommit]]) {
    assert(
      String(snapshot.guidanceMode || "").includes("navsys:gnc-lambert-tli-burn"),
      `moon orbit inject parity: ${label} should stay in powered TLI burn, got ${snapshot.guidanceMode}`,
    );
    assert(
      !String(snapshot.guidanceMode || "").includes("go-no-go-hold"),
      `moon orbit inject parity: ${label} should not fall into go/no-go hold, got ${snapshot.guidanceMode}`,
    );
    assert(
      Number(snapshot.guidanceRequestedThrottle) > 0.5,
      `moon orbit inject parity: ${label} should request substantial throttle, got ${snapshot.guidanceRequestedThrottle}`,
    );
    assert(
      !String(snapshot.missionPhaseGateReason || "").includes("NO-GO for TLI burn"),
      `moon orbit inject parity: ${label} should not report a TLI no-go, got ${snapshot.missionPhaseGateReason}`,
    );
    assertApprox(
      snapshot.moonProjectedPeriluneAltitudeKm,
      vehicle.moonDeparturePlanPredictedPeriluneAltitudeKm,
      1,
      `moon orbit inject parity: ${label} perilune should track accepted departure plan`,
    );
    assertApprox(
      snapshot.moonBPlaneErrorKm,
      vehicle.moonDeparturePlanBPlaneErrorKm,
      1,
      `moon orbit inject parity: ${label} B-plane should track accepted departure plan`,
    );
  }

  assert(
    String(seedLock.guidanceMode || "").includes("navsys:gnc-lambert-tli-burn+seed-lock"),
    `moon orbit inject parity: expected seed-lock guidance after commit window (${commitWindowSec}s), got ${seedLock.guidanceMode}`,
  );
  assert(
    !String(seedLock.guidanceMode || "").includes("navsys:gnc-lambert-tli-reacquire-window"),
    `moon orbit inject parity: should not fall into reacquire-window at ${seedLockCheckpointSec}s, got ${seedLock.guidanceMode}`,
  );
  assert(
    Number(seedLock.guidanceRequestedThrottle) > 0.5,
    `moon orbit inject parity: seed-lock should keep positive throttle, got ${seedLock.guidanceRequestedThrottle}`,
  );
  assert(
    !String(seedLock.missionPhaseGateReason || "").includes("NO-GO for TLI burn"),
    `moon orbit inject parity: seed-lock should not report TLI no-go, got ${seedLock.missionPhaseGateReason}`,
  );
  assertApprox(
    seedLock.moonProjectedPeriluneAltitudeKm,
    vehicle.moonDeparturePlanPredictedPeriluneAltitudeKm,
    1,
    "moon orbit inject parity: seed-lock perilune should remain tied to the accepted departure plan",
  );
  assertApprox(
    seedLock.moonBPlaneErrorKm,
    vehicle.moonDeparturePlanBPlaneErrorKm,
    1,
    "moon orbit inject parity: seed-lock B-plane should remain tied to the accepted departure plan",
  );

  console.log("PASS moon-orbit-inject-live-parity-e2e");
}

main();
