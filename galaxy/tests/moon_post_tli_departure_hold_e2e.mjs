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
  assert(launch.accepted, `moon_post_tli_departure_hold: launch rejected (${launch.reason || "unknown"})`);

  const shipId = launch.shipId;
  const vehicle = runtime.fleet.vehicles.get(shipId);
  const shipBody = state.dynamicBodies.get(shipId);
  assert(vehicle, "moon_post_tli_departure_hold: missing vehicle runtime");
  assert(shipBody, "moon_post_tli_departure_hold: missing ship body");

  vehicle.missionPhase = "coast_to_moon";
  vehicle.guidanceMode = "navsys:gnc-lambert-midcourse-coast";
  vehicle.guidanceBurnRequested = false;
  vehicle.guidanceRequestedThrottle = 0;
  vehicle.elapsedSeconds = 1500;
  vehicle.moonDeparturePlanTransitStartElapsedSec = 900;
  vehicle.moonDeparturePlanTransferTimeSec = 12_000;
  vehicle.moonDeparturePlanPredictedMissDistanceKm = 8_392;
  vehicle.moonDeparturePlanPredictedPeriluneAltitudeKm = 272;
  vehicle.moonDeparturePlanBPlaneErrorKm = 2_647;
  vehicle.moonProjectedPeriluneAltitudeKm = null;
  vehicle.moonBPlaneErrorKm = null;
  vehicle.moonProjectedMissTrendKmS = null;
  vehicle.lastStep = {
    throttle: 0,
    guidanceMode: vehicle.guidanceMode,
    guidanceBurnRequested: false,
    guidanceRequestedThrottle: 0,
  };
  shipBody.position = { x: -8_000, y: 0, z: 0 };
  shipBody.velocity = { x: 0.5, y: 9.8, z: 0 };

  const snapshot = controller.statusSnapshotForBody({
    state,
    bodyId: shipId,
    nowMs: NOW_MS + (Number(vehicle.elapsedSeconds) * 1000),
    baseSnapshot: {},
  });

  assert(snapshot, "moon_post_tli_departure_hold: missing final snapshot");
  assert(
    String(snapshot.missionPhase || "") === "coast_to_moon",
    `moon_post_tli_departure_hold: expected coast_to_moon, got ${snapshot?.missionPhase}`,
  );
  assert(
    String(snapshot.guidanceMode || "").includes("navsys:gnc-lambert-midcourse-coast"),
    `moon_post_tli_departure_hold: expected early lunar coast tracking mode, got ${snapshot.guidanceMode}`,
  );
  assert(
    Number(snapshot.guidanceRequestedThrottle) === 0,
    `moon_post_tli_departure_hold: expected zero requested throttle in early coast hold, got ${snapshot.guidanceRequestedThrottle}`,
  );
  assert(
    Number(snapshot.throttle) === 0,
    `moon_post_tli_departure_hold: expected zero applied throttle in early coast hold, got ${snapshot.throttle}`,
  );
  assert(
    Number(snapshot.moonProjectedMissDistanceKm) < 20_000,
    `moon_post_tli_departure_hold: expected preserved departure miss band, got ${snapshot.moonProjectedMissDistanceKm}`,
  );
  assert(
    snapshot.moonProjectedMissTrendKmS === null,
    `moon_post_tli_departure_hold: expected preserved departure hold to suppress miss trend, got ${snapshot.moonProjectedMissTrendKmS}`,
  );
  assert(
    Number(snapshot.moonBPlaneErrorKm) < 10_000,
    `moon_post_tli_departure_hold: expected preserved B-plane band, got ${snapshot.moonBPlaneErrorKm}`,
  );

  console.log("PASS moon-post-tli-departure-hold-e2e");
  process.exit(0);
}

main();
