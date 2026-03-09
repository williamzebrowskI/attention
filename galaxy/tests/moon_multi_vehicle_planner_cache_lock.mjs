import { createLaunchFleetController } from "../app/static/js/physics/launch/launchFleetController.js";
import { LAUNCH_VEHICLE_CONFIG } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const SUN_MASS_KG = 1.9885e30;
const NOW_MS = Date.UTC(2026, 2, 9, 12, 0, 0);
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
  addStaticBody(state, "moon", { x: 384400, y: 0, z: 28000 }, { x: 0, y: 1.022, z: 0.02 }, MOON_MASS_KG);
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

function addMoonMissionVehicle(runtime, state, shipId, position, velocity) {
  runtime.fleet.vehicles.set(shipId, {
    id: shipId,
    vehicleRole: "mission",
    vehicleName: `Starship ${shipId}`,
    launchMode: "orbit_inject",
    missionId: LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
    missionPhase: "coast_to_moon",
    missionCompleted: false,
    stageProfiles: LAUNCH_VEHICLE_CONFIG.stages,
    stageIndex: 1,
    stagePropellantKg: 900_000,
    elapsedSeconds: 3600,
    guidanceMode: "navsys:gnc-lambert-midcourse-coast",
    moonDepartureWindowReady: true,
    moonDepartureWindowWaitSec: 0,
    moonDepartureCorridorAccepted: true,
    moonDeparturePlanReady: true,
    moonDeparturePlanDirectionKm: { x: 0.5, y: 0.86, z: 0.02 },
    moonDeparturePlanPredictedMissDistanceKm: 9000,
    moonDeparturePlanPredictedPeriluneAltitudeKm: 320,
    moonDeparturePlanBPlaneErrorKm: 3000,
    lastStep: {
      throttle: 0,
      thrustN: 0,
      guidanceMode: "navsys:gnc-lambert-midcourse-coast",
      guidanceBurnRequested: false,
      guidanceRequestedThrottle: 0,
      requestedDirectionKm: { x: 0.5, y: 0.86, z: 0.02 },
      bodyAxisDirectionKm: { x: 0.5, y: 0.86, z: 0.02 },
    },
  });
  state.dynamicBodies.set(shipId, {
    id: shipId,
    position,
    velocity,
    massKg: 1_500_000,
  });
}

function main() {
  const previousWindow = globalThis.window;
  globalThis.window = globalThis.window || {};

  try {
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
    addMoonMissionVehicle(
      runtime,
      state,
      "earth_mission_ship_a",
      { x: 9000, y: 0, z: 0 },
      { x: 2.2, y: 8.8, z: 0.05 },
    );
    addMoonMissionVehicle(
      runtime,
      state,
      "earth_mission_ship_b",
      { x: 9300, y: 200, z: -40 },
      { x: 2.15, y: 8.82, z: 0.04 },
    );

    const shipIds = ["earth_mission_ship_a", "earth_mission_ship_b"];
    const firstStepMs = NOW_MS + 2000;
    controller.prepareStep(state, 0.1, firstStepMs);
    for (const shipId of shipIds) {
      const bodyState = state.dynamicBodies.get(shipId);
      integrateBody(bodyState, controller.externalAccelerationKmS2(shipId), 0.1);
    }
    controller.finalizeStep(state, 0.1, firstStepMs);

    const cachedAtByShip = new Map();
    for (const shipId of shipIds) {
      const vehicle = runtime.fleet.vehicles.get(shipId);
      const cachedAtSec = Number(vehicle?.moonPlannerCachedEvalSec);
      assert(Number.isFinite(cachedAtSec), `expected cached planner timestamp for ${shipId}`);
      cachedAtByShip.set(shipId, cachedAtSec);
    }

    const secondStepMs = firstStepMs + 100;
    controller.prepareStep(state, 0.1, secondStepMs);
    for (const shipId of shipIds) {
      const bodyState = state.dynamicBodies.get(shipId);
      integrateBody(bodyState, controller.externalAccelerationKmS2(shipId), 0.1);
    }
    controller.finalizeStep(state, 0.1, secondStepMs);

    for (const shipId of shipIds) {
      const vehicle = runtime.fleet.vehicles.get(shipId);
      const nextCachedAtSec = Number(vehicle?.moonPlannerCachedEvalSec);
      assert(
        nextCachedAtSec === cachedAtByShip.get(shipId),
        `expected browser multi-moon planner cache reuse for ${shipId}, got ${cachedAtByShip.get(shipId)} then ${nextCachedAtSec}`,
      );
    }

    console.log("PASS moon-multi-vehicle-planner-cache-lock");
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
}

main();
