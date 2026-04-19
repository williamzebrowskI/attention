import { createLaunchFleetController } from "../app/static/js/physics/launch/launchFleetController.js";
import { LAUNCH_VEHICLE_CONFIG } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const SUN_MASS_KG = 1.9885e30;
const NOW_MS = Date.UTC(2026, 2, 7, 12, 0, 0);

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
  addStaticBody(state, "moon", { x: 384400, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, MOON_MASS_KG);
  addStaticBody(state, "sun", { x: 149597870.7, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, SUN_MASS_KG);
}

function buildController() {
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
  return { controller, runtime };
}

function makeLaunchHarness() {
  const { controller, runtime } = buildController();
  const state = makeState();
  seedWorld(state);
  const shipId = "earth_mission_ship_test_direction";
  const vehicle = {
    id: shipId,
    vehicleRole: "mission",
    vehicleName: "Starship Test",
    launchMode: "orbit_inject",
    missionId: LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
    missionPhase: "coast_to_moon",
    missionCompleted: false,
    stageProfiles: LAUNCH_VEHICLE_CONFIG.stages,
    stageIndex: 1,
    stagePropellantKg: 900_000,
    elapsedSeconds: 1800,
    guidanceMode: "navsys:gnc-lambert-midcourse-coast",
    lastStep: {
      throttle: 0,
      guidanceMode: "navsys:gnc-lambert-midcourse-coast",
      guidanceBurnRequested: false,
      guidanceRequestedThrottle: 0,
    },
    moonDepartureWindowReady: true,
    moonDepartureWindowWaitSec: 0,
  };
  runtime.fleet.vehicles.set(shipId, vehicle);
  const shipBody = {
    id: shipId,
    position: { x: 10000, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    massKg: 1_500_000,
  };
  state.dynamicBodies.set(shipId, shipBody);
  vehicle.missionPhase = "coast_to_moon";
  vehicle.elapsedSeconds = 1800;
  vehicle.guidanceMode = "navsys:gnc-lambert-midcourse-coast";
  vehicle.lastStep = {
    throttle: 0,
    guidanceMode: vehicle.guidanceMode,
    guidanceBurnRequested: false,
    guidanceRequestedThrottle: 0,
    requestedDirectionKm: { x: 1, y: 0, z: 0 },
    bodyAxisDirectionKm: { x: 1, y: 0, z: 0 },
  };
  shipBody.position = { x: 10000, y: 0, z: 0 };
  return { controller, runtime, state, shipId, shipBody };
}

function main() {
  {
    const { controller, state, shipId, shipBody } = makeLaunchHarness();
    shipBody.velocity = { x: 2, y: 0, z: 0 };
    const snapshot = controller.statusSnapshotForBody({
      state,
      bodyId: shipId,
      nowMs: NOW_MS + 1800 * 1000,
      baseSnapshot: {},
    });
    assert(snapshot, "moon_directional_telemetry_lock: missing toward snapshot");
    assert(snapshot.earthDirectionState === "outbound", `expected outbound earth motion, got ${snapshot.earthDirectionState}`);
    assert(snapshot.moonDirectionState === "toward", `expected moon toward motion, got ${snapshot.moonDirectionState}`);
    assert(Number(snapshot.targetClosingSpeedKmS) > 0, `expected positive moon approach rate, got ${snapshot.targetClosingSpeedKmS}`);
    assert(Number(snapshot.earthDirectionAngleDeg) < 1, `expected near-zero earth off-radial angle, got ${snapshot.earthDirectionAngleDeg}`);
    assert(Number(snapshot.moonDirectionAngleDeg) < 1, `expected near-zero moon off-target angle, got ${snapshot.moonDirectionAngleDeg}`);
    assert(Number(snapshot.moonRelativePositionKm?.x) > 0, `expected positive x moon vector, got ${snapshot.moonRelativePositionKm?.x}`);
    assert(Number(snapshot.earthRelativePositionKm?.x) < 0, `expected negative x earth vector, got ${snapshot.earthRelativePositionKm?.x}`);
    assert(snapshot.guidanceVelocityState === "prograde", `expected prograde command axis, got ${snapshot.guidanceVelocityState}`);
    assert(snapshot.guidanceRadialState === "upward", `expected upward command axis, got ${snapshot.guidanceRadialState}`);
    assert(snapshot.bodyVelocityState === "prograde", `expected prograde nose axis, got ${snapshot.bodyVelocityState}`);
    assert(snapshot.bodyRadialState === "upward", `expected upward nose axis, got ${snapshot.bodyRadialState}`);
    assert(Number(snapshot.guidanceVelocityAngleDeg) < 1, `expected near-zero command off-velocity angle, got ${snapshot.guidanceVelocityAngleDeg}`);
    assert(Number(snapshot.bodyVelocityAngleDeg) < 1, `expected near-zero nose off-velocity angle, got ${snapshot.bodyVelocityAngleDeg}`);
    assert(snapshot.guidanceMoonState === "toward", `expected command moon aim toward, got ${snapshot.guidanceMoonState}`);
    assert(snapshot.bodyMoonState === "toward", `expected nose moon aim toward, got ${snapshot.bodyMoonState}`);
    assert(Number(snapshot.guidanceMoonAngleDeg) < 1, `expected near-zero command off-moon angle, got ${snapshot.guidanceMoonAngleDeg}`);
    assert(Number(snapshot.bodyMoonAngleDeg) < 1, `expected near-zero nose off-moon angle, got ${snapshot.bodyMoonAngleDeg}`);
  }

  {
    const { controller, runtime, state, shipId, shipBody } = makeLaunchHarness();
    shipBody.velocity = { x: -2, y: 0, z: 0 };
    const vehicle = runtime?.fleet?.vehicles?.get?.(shipId) || null;
    if (vehicle?.lastStep) {
      vehicle.lastStep.requestedDirectionKm = { x: -1, y: 0, z: 0 };
      vehicle.lastStep.bodyAxisDirectionKm = { x: -1, y: 0, z: 0 };
    }
    const snapshot = controller.statusSnapshotForBody({
      state,
      bodyId: shipId,
      nowMs: NOW_MS + 1800 * 1000,
      baseSnapshot: {},
    });
    assert(snapshot, "moon_directional_telemetry_lock: missing away snapshot");
    assert(snapshot.earthDirectionState === "inbound", `expected inbound earth motion, got ${snapshot.earthDirectionState}`);
    assert(snapshot.moonDirectionState === "away", `expected moon away motion, got ${snapshot.moonDirectionState}`);
    assert(Number(snapshot.targetClosingSpeedKmS) < 0, `expected negative moon approach rate, got ${snapshot.targetClosingSpeedKmS}`);
    assert(Number(snapshot.earthDirectionAngleDeg) > 179, `expected near-180 earth off-radial angle, got ${snapshot.earthDirectionAngleDeg}`);
    assert(Number(snapshot.moonDirectionAngleDeg) > 179, `expected near-180 moon off-target angle, got ${snapshot.moonDirectionAngleDeg}`);
    assert(snapshot.guidanceVelocityState === "prograde", `expected retro burn along current velocity vector, got ${snapshot.guidanceVelocityState}`);
    assert(snapshot.guidanceRadialState === "downward", `expected downward command axis, got ${snapshot.guidanceRadialState}`);
    assert(snapshot.bodyVelocityState === "prograde", `expected prograde nose axis on reversed velocity case, got ${snapshot.bodyVelocityState}`);
    assert(snapshot.bodyRadialState === "downward", `expected downward nose axis, got ${snapshot.bodyRadialState}`);
    assert(snapshot.guidanceMoonState === "away", `expected command moon aim away, got ${snapshot.guidanceMoonState}`);
    assert(snapshot.bodyMoonState === "away", `expected nose moon aim away, got ${snapshot.bodyMoonState}`);
    assert(Number(snapshot.guidanceMoonAngleDeg) > 179, `expected near-180 command off-moon angle, got ${snapshot.guidanceMoonAngleDeg}`);
    assert(Number(snapshot.bodyMoonAngleDeg) > 179, `expected near-180 nose off-moon angle, got ${snapshot.bodyMoonAngleDeg}`);
  }

  console.log("PASS moon-directional-telemetry-lock");
}

main();
