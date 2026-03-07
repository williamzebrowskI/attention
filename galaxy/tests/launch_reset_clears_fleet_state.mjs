import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { LAUNCH_BODY_ID } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 6, 15, 0, 0);

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

function makeState() {
  return {
    dynamicBodies: new Map(),
    staticSources: new Map([
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
  };
}

function createHarness() {
  return createLaunchController({
    getEarthRadiusKm: () => EARTH_RADIUS_KM,
    getEarthMassKg: () => EARTH_MASS_KG,
    getBodyRadiusKm: (id) => (String(id) === "moon" ? MOON_RADIUS_KM : EARTH_RADIUS_KM),
    getBodyMassKg: (id) => (String(id) === "moon" ? MOON_MASS_KG : EARTH_MASS_KG),
    getEarthFixedAxesEcliptic: earthAxes,
    sampleEarthAtmosphere,
    gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
  });
}

function main() {
  const state = makeState();
  const controller = createHarness();

  controller.ensureRocketInNBody(state, NOW_MS);
  assert(
    controller.resetToPad(state, NOW_MS, { clearFleetVehicles: true }),
    "reset test: initial resetToPad failed",
  );

  const tankerLaunch = controller.launchRefuelTanker(state, NOW_MS + 1, { mode: "orbit_inject" });
  assert(tankerLaunch?.accepted, `reset test: tanker launch rejected (${tankerLaunch?.reason || "unknown"})`);

  const missionLaunch = controller.launchMissionShip(
    state,
    LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO,
    NOW_MS + 2,
    { mode: "orbit_inject" },
  );
  assert(missionLaunch?.accepted, `reset test: mission launch rejected (${missionLaunch?.reason || "unknown"})`);

  assert(state.dynamicBodies.has(LAUNCH_BODY_ID), "reset test: primary launch body missing before reset");
  assert(state.dynamicBodies.has(String(tankerLaunch.tankerId || "")), "reset test: tanker body missing before reset");
  assert(state.dynamicBodies.has(String(missionLaunch.shipId || "")), "reset test: mission body missing before reset");

  const beforeSnapshot = controller.exportPersistentSnapshot(state, NOW_MS + 3);
  assert(beforeSnapshot, "reset test: expected persistent snapshot before reset");
  assert(
    Array.isArray(beforeSnapshot?.runtime?.fleet?.vehicles)
      && beforeSnapshot.runtime.fleet.vehicles.length > 0,
    "reset test: expected fleet vehicles before reset",
  );

  assert(
    controller.resetToPad(state, NOW_MS + 4, { clearFleetVehicles: true }),
    "reset test: full resetToPad failed",
  );

  const afterSnapshot = controller.exportPersistentSnapshot(state, NOW_MS + 5);
  assert(afterSnapshot, "reset test: expected persistent snapshot after reset");
  assert(
    Array.isArray(afterSnapshot?.runtime?.fleet?.vehicles)
      && afterSnapshot.runtime.fleet.vehicles.length === 0,
    `reset test: expected no fleet vehicles after reset, got ${afterSnapshot?.runtime?.fleet?.vehicles?.length}`,
  );
  assert(
    Array.isArray(afterSnapshot?.runtime?.refuel?.flights)
      && afterSnapshot.runtime.refuel.flights.length === 0,
    `reset test: expected no refuel flights after reset, got ${afterSnapshot?.runtime?.refuel?.flights?.length}`,
  );
  assert(
    Array.isArray(afterSnapshot?.managedBodies)
      && afterSnapshot.managedBodies.length === 1
      && String(afterSnapshot.managedBodies[0]?.id || "") === LAUNCH_BODY_ID,
    `reset test: expected only primary launch body after reset, got ${afterSnapshot?.managedBodies?.map((body) => body.id).join(", ")}`,
  );
  assert(
    afterSnapshot?.runtime?.phase === "idle",
    `reset test: expected idle runtime phase after reset, got ${afterSnapshot?.runtime?.phase}`,
  );
  assert(state.dynamicBodies.has(LAUNCH_BODY_ID), "reset test: primary launch body missing after reset");
  assert(
    !state.dynamicBodies.has(String(tankerLaunch.tankerId || "")),
    "reset test: tanker body should be removed by reset",
  );
  assert(
    !state.dynamicBodies.has(String(missionLaunch.shipId || "")),
    "reset test: mission body should be removed by reset",
  );

  console.log("PASS launch-reset-clears-fleet-state");
}

main();
