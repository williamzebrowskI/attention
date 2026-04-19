import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { LAUNCH_BODY_ID } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 7, 22, 0, 0);

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
    densityKgM3: 1.225,
    pressurePa: 101325,
    temperatureK: 288.15,
  };
}

function makeState() {
  return {
    dynamicBodies: new Map([
      [
        LAUNCH_BODY_ID,
        {
          id: LAUNCH_BODY_ID,
          massKg: 1_000_000,
          position: { x: -145_843_859.94, y: 30_953_334.6, z: 2_782_089.06 },
          velocity: { x: 18_549.1671, y: 0, z: 0 },
        },
      ],
    ]),
    staticSources: new Map([
      [
        "earth",
        {
          id: "earth",
          position: { x: -144_793_793.24, y: 32_867_207.0, z: -670_767.94 },
          velocity: { x: 0, y: 0, z: 0 },
          massKg: EARTH_MASS_KG,
        },
      ],
      [
        "moon",
        {
          id: "moon",
          position: { x: -144_495_447.84, y: 33_132_772.9, z: -638_327.04 },
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
    windSeed: 1,
    gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
  });
}

function main() {
  const state = makeState();
  const controller = createHarness();
  controller.setMissionProfile(LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN);

  const snapshot = controller.statusSnapshot(state);

  assert(
    Number.isFinite(Number(snapshot.altitudeKm)) && Number(snapshot.altitudeKm) < 1,
    `expected repaired pad altitude, got ${snapshot.altitudeKm}`,
  );
  assert(
    Number.isFinite(Number(snapshot.earthDistanceKm))
      && Math.abs(Number(snapshot.earthDistanceKm) - (EARTH_RADIUS_KM + 0.06)) < 10,
    `expected repaired Earth distance near pad radius, got ${snapshot.earthDistanceKm}`,
  );
  assert(
    Number.isFinite(Number(snapshot.targetDistanceKm)) && Number(snapshot.targetDistanceKm) < 600_000,
    `expected repaired Moon distance in Earth-Moon range, got ${snapshot.targetDistanceKm}`,
  );
  assert(
    snapshot.targetBodyId === "moon",
    `expected moon target after repair, got ${snapshot.targetBodyId}`,
  );

  const repairedBody = state.dynamicBodies.get(LAUNCH_BODY_ID);
  assert(repairedBody, "expected repaired primary launch body in dynamic state");
  const earthState = state.staticSources.get("earth");
  const relX = Number(repairedBody.position.x) - Number(earthState.position.x);
  const relY = Number(repairedBody.position.y) - Number(earthState.position.y);
  const relZ = Number(repairedBody.position.z) - Number(earthState.position.z);
  const repairedEarthDistanceKm = Math.sqrt((relX * relX) + (relY * relY) + (relZ * relZ));
  assert(
    Math.abs(repairedEarthDistanceKm - (EARTH_RADIUS_KM + 0.06)) < 10,
    `expected repaired launch body near pad radius, got ${repairedEarthDistanceKm}`,
  );

  console.log("PASS idle-primary-launch-body-pad-repair-lock");
}

main();
