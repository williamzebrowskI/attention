import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
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

function createHarness() {
  return createLaunchController({
    stageAtIndex: (index) => LAUNCH_VEHICLE_CONFIG.stages[index] || null,
    getEarthRadiusKm: () => EARTH_RADIUS_KM,
    getEarthMassKg: () => EARTH_MASS_KG,
    getBodyRadiusKm: (id) => (String(id) === "moon" ? MOON_RADIUS_KM : EARTH_RADIUS_KM),
    getBodyMassKg: (id) => (String(id) === "moon" ? MOON_MASS_KG : EARTH_MASS_KG),
    getEarthFixedAxesEcliptic: earthAxes,
    sampleEarthAtmosphere,
    gravitationalConstantKm3PerKgS2: G_KM3_KG_S2,
  });
}

function makeState() {
  const state = {
    dynamicBodies: new Map(),
    staticSources: new Map(),
  };
  state.staticSources.set("earth", {
    id: "earth",
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    massKg: EARTH_MASS_KG,
  });
  state.staticSources.set("moon", {
    id: "moon",
    position: { x: 384400, y: 0, z: 28000 },
    velocity: { x: 0, y: 1.022, z: 0.02 },
    massKg: MOON_MASS_KG,
  });
  return state;
}

async function main() {
  const controller = createHarness();
  const state = makeState();
  const launch = await controller.launchMissionShipAsync(
    state,
    LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO,
    NOW_MS,
    { mode: "orbit_inject" },
  );
  assert(
    launch?.accepted,
    `orbital_refuel_mission_orbit_inject_launch_smoke: launch rejected (${launch?.reason || "unknown"})`,
  );
  console.log("PASS orbital-refuel-mission-orbit-inject-launch-smoke");
}

await main();
