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
const STEP_SEC = 20;
const END_SEC = 2000;

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
  addStaticBody(state, "earth", { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, EARTH_MASS_KG);
  addStaticBody(state, "moon", { x: 384400, y: 0, z: 0 }, { x: 0, y: 1.022, z: 0 }, MOON_MASS_KG);
  addStaticBody(state, "sun", { x: 149597870.7, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, SUN_MASS_KG);
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
  assert(launch.accepted, `moon_coast_departure_hold_planned_eta: launch rejected (${launch.reason || "unknown"})`);

  const shipId = launch.shipId;
  let snapshot = null;
  for (let second = STEP_SEC; second <= END_SEC; second += STEP_SEC) {
    const nowMs = NOW_MS + (second * 1000);
    controller.prepareStep(state, STEP_SEC, nowMs);
    for (const [bodyId, bodyState] of state.dynamicBodies.entries()) {
      integrateBody(bodyState, controller.externalAccelerationKmS2(bodyId), STEP_SEC);
    }
    controller.finalizeStep(state, STEP_SEC, nowMs);
    snapshot = controller.statusSnapshotForBody({
      state,
      bodyId: shipId,
      nowMs,
      baseSnapshot: {},
    });
  }

  const vehicle = runtime.fleet.vehicles.get(shipId);
  assert(snapshot, "moon_coast_departure_hold_planned_eta: missing final snapshot");
  assert(vehicle, "moon_coast_departure_hold_planned_eta: missing vehicle runtime");
  assert(
    String(snapshot.missionPhase || "") === "coast_to_moon",
    `moon_coast_departure_hold_planned_eta: expected coast_to_moon, got ${snapshot?.missionPhase}`,
  );
  assert(
    String(snapshot.guidanceMode || "").includes("departure-hold"),
    `moon_coast_departure_hold_planned_eta: expected departure-hold guidance, got ${snapshot.guidanceMode}`,
  );
  assert(
    snapshot.targetEtaSource === "planned-transfer",
    `moon_coast_departure_hold_planned_eta: expected planned-transfer ETA source, got ${snapshot.targetEtaSource}`,
  );
  assert(
    snapshot.targetRateLabel === "Approach",
    `moon_coast_departure_hold_planned_eta: expected approach label, got ${snapshot.targetRateLabel}`,
  );
  assert(
    snapshot.targetEtaLabel === "Plan ETA",
    `moon_coast_departure_hold_planned_eta: expected plan ETA label, got ${snapshot.targetEtaLabel}`,
  );
  const expectedRemainingSec = Number(vehicle.moonDeparturePlanTransferTimeSec) - (
    Number(vehicle.elapsedSeconds) - Number(vehicle.moonDeparturePlanTransitStartElapsedSec)
  );
  assertApprox(
    snapshot.targetEtaSeconds,
    Math.max(0, expectedRemainingSec),
    STEP_SEC + 1,
    "moon_coast_departure_hold_planned_eta: planned ETA should follow preserved transfer time",
  );
  const instantaneousEtaSec = Number(snapshot.targetDistanceKm) / Number(snapshot.targetClosingSpeedKmS);
  assert(
    Number.isFinite(instantaneousEtaSec)
      && instantaneousEtaSec > (Number(snapshot.targetEtaSeconds) * 2),
    `moon_coast_departure_hold_planned_eta: expected instantaneous ETA to diverge materially from planned ETA, got instant ${instantaneousEtaSec}, planned ${snapshot.targetEtaSeconds}`,
  );
  assert(
    Number(snapshot.moonProjectedMissDistanceKm) < 20_000,
    `moon_coast_departure_hold_planned_eta: expected preserved miss band, got ${snapshot.moonProjectedMissDistanceKm}`,
  );

  console.log("PASS moon-coast-departure-hold-planned-eta-e2e");
  process.exit(0);
}

main();
