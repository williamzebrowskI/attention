import { burnDurationForDeltaVSec } from "../app/static/js/physics/navigation_system/lunar/moonDynamicsModel.js";
import { createLaunchFleetController } from "../app/static/js/physics/launch/launchFleetController.js";
import { LAUNCH_VEHICLE_CONFIG } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 5, 12, 0, 0);

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
  assert(launch.accepted, `moon_orbit_inject_departure_plan_accel_lock: launch rejected (${launch.reason || "unknown"})`);

  const vehicle = runtime.fleet.vehicles.get(launch.shipId);
  const stage2 = stageAtIndex(1);
  assert(vehicle, "moon_orbit_inject_departure_plan_accel_lock: missing vehicle");
  assert(
    Number.isFinite(Number(vehicle.moonDeparturePlanBurnDurationSec))
      && Number.isFinite(Number(vehicle.moonDeparturePlanThrottle))
      && Number.isFinite(Number(vehicle.moonEstimatedTliDeltaVKmS)),
    "moon_orbit_inject_departure_plan_accel_lock: missing departure plan timing",
  );

  const initialStageMassKg = Math.max(1, Number(vehicle.dryMassKg) || 0) + Math.max(0, Number(vehicle.stagePropellantKg) || 0);
  const engineAccelAtThrottle1KmS2 = (
    Number(stage2?.thrustVacuumN) > 0
    && initialStageMassKg > 0
  )
    ? ((Number(stage2.thrustVacuumN) / initialStageMassKg) / 1000)
    : Number.NaN;
  const expectedBurnDurationSec = burnDurationForDeltaVSec(
    Number(vehicle.moonEstimatedTliDeltaVKmS),
    engineAccelAtThrottle1KmS2,
    Number(vehicle.moonDeparturePlanThrottle),
    {
      massKg: initialStageMassKg,
      dryMassKg: Math.max(1, Number(stage2?.dryMassKg) || 120_000),
      propellantMassKg: Math.max(0, Number(vehicle.stagePropellantKg) || 0),
      thrustVacuumN: Math.max(0, Number(stage2?.thrustVacuumN) || 0),
      thrustSeaLevelN: Math.max(
        0,
        Number(stage2?.thrustSeaLevelN) || Number(stage2?.thrustVacuumN) || 0,
      ),
      ispVacuumS: Math.max(1, Number(stage2?.ispVacuumS) || 360),
      ispSeaLevelS: Math.max(
        1,
        Number(stage2?.ispSeaLevelS) || Number(stage2?.ispVacuumS) || 360,
      ),
      ambientPressurePa: 0,
    },
  );
  const actualBurnDurationSec = Number(vehicle.moonDeparturePlanBurnDurationSec);

  assert(
    expectedBurnDurationSec > 180,
    `moon_orbit_inject_departure_plan_accel_lock: expected burn duration is unrealistically short (${expectedBurnDurationSec}s)`,
  );
  assert(
    actualBurnDurationSec > Math.max(180, expectedBurnDurationSec * 0.55),
    `moon_orbit_inject_departure_plan_accel_lock: TLI burn duration is still unrealistically short for the current thrust/Isp model (${actualBurnDurationSec}s vs expected ~${expectedBurnDurationSec}s)`,
  );
  assert(
    Math.abs(actualBurnDurationSec - expectedBurnDurationSec) <= Math.max(120, expectedBurnDurationSec * 0.25),
    `moon_orbit_inject_departure_plan_accel_lock: burn duration should reflect actual stage accel (expected ~${expectedBurnDurationSec}s, got ${actualBurnDurationSec}s)`,
  );
  assert(
    Math.abs(Number(vehicle.tliDurationSec) - actualBurnDurationSec) <= 1,
    `moon_orbit_inject_departure_plan_accel_lock: TLI gate duration should track the accepted plan burn duration (expected ~${actualBurnDurationSec}s, got ${vehicle.tliDurationSec}s)`,
  );

  console.log("PASS moon-orbit-inject-departure-plan-accel-lock");
}

main();
