import { createLaunchFleetController } from "../app/static/js/physics/launch/launchFleetController.js";
import { LAUNCH_VEHICLE_CONFIG } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";
import { syncPlannerRuntime } from "../app/static/js/physics/navigation_system/planners/moonGuidanceState.js";
import { NAVIGATION_MISSION_IDS } from "../app/static/js/physics/navigation_system/navigationMissionProfiles.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const EARTH_MU_KM3_S2 = G_KM3_KG_S2 * EARTH_MASS_KG;
const MOON_MU_KM3_S2 = G_KM3_KG_S2 * MOON_MASS_KG;
const NOW_MS = Date.UTC(2026, 2, 7, 12, 0, 0);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function add(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
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
    dynamicBodies: new Map([
      [
        "earth",
        {
          id: "earth",
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          massKg: EARTH_MASS_KG,
        },
      ],
      [
        "moon",
        {
          id: "moon",
          position: { x: 384400, y: 0, z: 0 },
          velocity: { x: 0, y: 1.022, z: 0 },
          massKg: MOON_MASS_KG,
        },
      ],
    ]),
    staticSources: new Map(),
  };
}

function createFleetHarness() {
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

function launchMoonShip() {
  const state = makeState();
  const { controller, runtime } = createFleetHarness();
  const launch = controller.launchMissionShip(
    state,
    LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
    NOW_MS,
  );
  assert(launch.accepted, `moon_fleet_return_phase_lock: launch rejected (${launch.reason || "unknown"})`);
  const vehicle = runtime.fleet.vehicles.get(launch.shipId);
  const shipState = state.dynamicBodies.get(launch.shipId);
  assert(vehicle, "moon_fleet_return_phase_lock: missing fleet vehicle");
  assert(shipState, "moon_fleet_return_phase_lock: missing ship state");
  vehicle.stageIndex = 1;
  vehicle.stagePropellantKg = Math.max(0, Number(stageAtIndex(1)?.propellantMassKg) || 0);
  vehicle.missionCompleted = false;
  return {
    state,
    controller,
    vehicle,
    shipState,
    moonState: state.dynamicBodies.get("moon"),
  };
}

function syncMoonRuntime(vehicle, missionPhase) {
  if (!vehicle?.navPlannerRuntime) {
    return;
  }
  syncPlannerRuntime({
    plannerRuntime: vehicle.navPlannerRuntime,
    missionId: NAVIGATION_MISSION_IDS.MOON_ORBIT_RETURN,
    missionPhase,
  });
}

function setLunarCircularOrbit(shipState, moonState, altitudeKm = 120) {
  const orbitRadiusKm = MOON_RADIUS_KM + altitudeKm;
  const circularVelocityKmS = Math.sqrt(MOON_MU_KM3_S2 / orbitRadiusKm);
  shipState.position = add(moonState.position, { x: orbitRadiusKm, y: 0, z: 0 });
  shipState.velocity = add(moonState.velocity, { x: 0, y: circularVelocityKmS, z: 0 });
}

function setEarthApproachState(shipState, { earthDistanceKm, radialSpeedKmS }) {
  shipState.position = { x: earthDistanceKm, y: 0, z: 0 };
  shipState.velocity = { x: radialSpeedKmS, y: 0, z: 0 };
}

function setEarthCaptureOrbit(shipState, {
  periapsisKm = 180,
  apoapsisKm = 50000,
  trueAnomalyRad = 0,
} = {}) {
  const periapsisRadiusKm = EARTH_RADIUS_KM + periapsisKm;
  const apoapsisRadiusKm = EARTH_RADIUS_KM + apoapsisKm;
  const semiMajorAxisKm = 0.5 * (periapsisRadiusKm + apoapsisRadiusKm);
  const eccentricity = (apoapsisRadiusKm - periapsisRadiusKm) / (apoapsisRadiusKm + periapsisRadiusKm);
  const semiLatusRectumKm = semiMajorAxisKm * (1 - (eccentricity * eccentricity));
  const radiusKm = semiLatusRectumKm / (1 + (eccentricity * Math.cos(trueAnomalyRad)));
  const angularMomentumKm2S = Math.sqrt(EARTH_MU_KM3_S2 * semiLatusRectumKm);
  shipState.position = {
    x: radiusKm * Math.cos(trueAnomalyRad),
    y: radiusKm * Math.sin(trueAnomalyRad),
    z: 0,
  };
  shipState.velocity = {
    x: -(EARTH_MU_KM3_S2 / angularMomentumKm2S) * Math.sin(trueAnomalyRad),
    y: (EARTH_MU_KM3_S2 / angularMomentumKm2S) * (eccentricity + Math.cos(trueAnomalyRad)),
    z: 0,
  };
}

function testLunarOrbitHoldTransitionsToTeiBurn() {
  const { state, controller, vehicle, shipState, moonState } = launchMoonShip();
  setLunarCircularOrbit(shipState, moonState, 120);
  vehicle.missionPhase = "lunar_orbit_hold";
  vehicle.phaseElapsedSec = 7200;
  vehicle.elapsedSeconds = 7200;
  syncMoonRuntime(vehicle, "lunar_orbit_hold");
  controller.prepareStep(state, 1, NOW_MS + (7200 * 1000));
  controller.finalizeStep(state, 1, NOW_MS + (7200 * 1000));
  assert(
    vehicle.missionPhase === "tei_burn",
    `moon_fleet_return_phase_lock: expected lunar_orbit_hold -> tei_burn, got ${vehicle.missionPhase}`,
  );
}

function testTeiBurnTransitionsToCoastToEarth() {
  const { state, controller, vehicle, shipState } = launchMoonShip();
  setEarthApproachState(shipState, { earthDistanceKm: 220000, radialSpeedKmS: -0.2 });
  vehicle.missionPhase = "tei_burn";
  vehicle.phaseElapsedSec = 600;
  vehicle.elapsedSeconds = 600;
  syncMoonRuntime(vehicle, "tei_burn");
  controller.prepareStep(state, 1, NOW_MS + (600 * 1000));
  controller.finalizeStep(state, 1, NOW_MS + (600 * 1000));
  assert(
    vehicle.missionPhase === "coast_to_earth",
    `moon_fleet_return_phase_lock: expected tei_burn -> coast_to_earth, got ${vehicle.missionPhase}`,
  );
}

function testCoastToEarthTransitionsToEarthCapture() {
  const { state, controller, vehicle, shipState } = launchMoonShip();
  setEarthApproachState(shipState, { earthDistanceKm: 170000, radialSpeedKmS: -0.2 });
  vehicle.missionPhase = "coast_to_earth";
  vehicle.phaseElapsedSec = 3600;
  vehicle.elapsedSeconds = 3600;
  syncMoonRuntime(vehicle, "coast_to_earth");
  controller.prepareStep(state, 1, NOW_MS + (3600 * 1000));
  controller.finalizeStep(state, 1, NOW_MS + (3600 * 1000));
  assert(
    vehicle.missionPhase === "earth_capture",
    `moon_fleet_return_phase_lock: expected coast_to_earth -> earth_capture, got ${vehicle.missionPhase}`,
  );
}

function testEarthCaptureTransitionsToEarthOrbitHold() {
  const { state, controller, vehicle, shipState } = launchMoonShip();
  setEarthCaptureOrbit(shipState, { periapsisKm: 180, apoapsisKm: 50000, trueAnomalyRad: 0.15 });
  vehicle.missionPhase = "earth_capture";
  vehicle.phaseElapsedSec = 1800;
  vehicle.elapsedSeconds = 1800;
  syncMoonRuntime(vehicle, "earth_capture");
  controller.prepareStep(state, 1, NOW_MS + (1800 * 1000));
  controller.finalizeStep(state, 1, NOW_MS + (1800 * 1000));
  assert(
    vehicle.missionPhase === "earth_orbit_hold",
    `moon_fleet_return_phase_lock: expected earth_capture -> earth_orbit_hold, got ${vehicle.missionPhase}`,
  );
  assert(
    vehicle.missionCompleted === true,
    "moon_fleet_return_phase_lock: earth_orbit_hold should mark mission complete",
  );
}

function main() {
  testLunarOrbitHoldTransitionsToTeiBurn();
  testTeiBurnTransitionsToCoastToEarth();
  testCoastToEarthTransitionsToEarthCapture();
  testEarthCaptureTransitionsToEarthOrbitHold();
  console.log("moon_fleet_return_phase_lock: ok");
}

main();
