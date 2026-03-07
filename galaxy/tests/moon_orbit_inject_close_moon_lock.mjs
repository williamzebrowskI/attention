import { createLaunchFleetController } from "../app/static/js/physics/launch/launchFleetController.js";
import { LAUNCH_VEHICLE_CONFIG } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";
import {
  buildMoonGuidanceSourceModel,
  propagateMoonGuidanceState,
} from "../app/static/js/physics/navigation_system/lunar/moonDynamicsModel.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const SUN_MASS_KG = 1.9885e30;
const NOW_MS = Date.UTC(2026, 2, 5, 12, 0, 0);
const MAX_CLOSE_APPROACH_ALTITUDE_KM = 55_000;

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
    `moon_orbit_inject_close_moon_lock: launch rejected (${launch.reason || "unknown"})`,
  );

  const shipId = launch.shipId;
  const shipBody = state.dynamicBodies.get(shipId);
  const vehicle = runtime.fleet.vehicles.get(shipId);
  const stage2 = stageAtIndex(1);
  assert(shipBody, "moon_orbit_inject_close_moon_lock: missing ship body");
  assert(vehicle, "moon_orbit_inject_close_moon_lock: missing fleet vehicle");
  assert(vehicle.moonDeparturePlanReady === true, "moon_orbit_inject_close_moon_lock: departure plan not ready");
  assert(vehicle.moonDepartureCorridorAccepted === true, "moon_orbit_inject_close_moon_lock: departure corridor not accepted");
  assert(
    vehicle.moonDeparturePlanDirectionKm
      && Number.isFinite(Number(vehicle.moonDeparturePlanThrottle))
      && Number.isFinite(Number(vehicle.moonDeparturePlanBurnDurationSec))
      && Number.isFinite(Number(vehicle.moonDeparturePlanTransferTimeSec)),
    "moon_orbit_inject_close_moon_lock: accepted departure plan is incomplete",
  );

  const spacecraftMassKg = Math.max(1, Number(shipBody.massKg) || 0);
  const accelAtThrottle1KmS2 = (
    Math.max(
      0,
      Number(stage2?.thrustVacuumN) || Number(stage2?.thrustSeaLevelN) || 0,
    ) / spacecraftMassKg
  ) / 1000;
  const earthState = state.staticSources.get("earth");
  const moonState = state.staticSources.get("moon");
  const sources = buildMoonGuidanceSourceModel({
    targetVectors: {
      moonEarthPositionKm: {
        x: Number(moonState.position.x) - Number(earthState.position.x),
        y: Number(moonState.position.y) - Number(earthState.position.y),
        z: Number(moonState.position.z) - Number(earthState.position.z),
      },
      moonEarthVelocityKmS: {
        x: Number(moonState.velocity.x) - Number(earthState.velocity.x),
        y: Number(moonState.velocity.y) - Number(earthState.velocity.y),
        z: Number(moonState.velocity.z) - Number(earthState.velocity.z),
      },
    },
    metrics: {
      earthMassKg: EARTH_MASS_KG,
      earthRadiusKm: EARTH_RADIUS_KM,
      moonMassKg: MOON_MASS_KG,
      moonRadiusKm: MOON_RADIUS_KM,
    },
    plannerConfig: {
      moonClosedLoopPropagationStepSec: 1800,
    },
  });
  const propagation = propagateMoonGuidanceState({
    initialState: {
      positionKm: { ...shipBody.position },
      velocityKmS: { ...shipBody.velocity },
    },
    durationSec: Math.max(
      72 * 3600,
      Number(vehicle.moonDeparturePlanTransferTimeSec) * 1.2,
    ),
    stepSec: 1800,
    sources,
    spacecraft: {
      bodyId: shipId,
      massKg: spacecraftMassKg,
      radiusKm: 0.0045,
      reflectivityCoeff: 1.45,
    },
    burnCommand: {
      direction: { ...vehicle.moonDeparturePlanDirectionKm },
      throttle: Number(vehicle.moonDeparturePlanThrottle),
      accelAtThrottle1KmS2,
      burnDurationSec: Number(vehicle.moonDeparturePlanBurnDurationSec),
    },
  });

  assert(
    Number.isFinite(Number(propagation?.minMoonAltitudeKm)),
    "moon_orbit_inject_close_moon_lock: propagated close approach is not finite",
  );
  assert(
    Number(propagation.minMoonAltitudeKm) < MAX_CLOSE_APPROACH_ALTITUDE_KM,
    `moon_orbit_inject_close_moon_lock: direct inject plan does not get close enough to the Moon (alt ${propagation.minMoonAltitudeKm} km)`,
  );
  assert(
    Number.isFinite(Number(propagation.minEarthAltitudeKm))
      && Number(propagation.minEarthAltitudeKm) > 130,
    `moon_orbit_inject_close_moon_lock: propagated plan violates Earth safety floor (${propagation.minEarthAltitudeKm} km)`,
  );

  console.log("PASS moon-orbit-inject-close-moon-lock");
}

main();
