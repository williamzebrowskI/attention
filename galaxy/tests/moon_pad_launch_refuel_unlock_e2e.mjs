import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const G_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 5, 18, 0, 0);
const DT_SEC = 1;
const MAX_STEPS = 12_000;

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

function scale(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function length(vector) {
  return Math.sqrt(dot(vector, vector));
}

function gravityAccelerationKmS2(bodyState, earthState) {
  const relative = subtract(bodyState.position, earthState.position);
  const radiusKm = Math.max(1, length(relative));
  const muKm3S2 = G_KM3_PER_KG_S2 * EARTH_MASS_KG;
  return scale(relative, -muKm3S2 / (radiusKm * radiusKm * radiusKm));
}

function integrateBody(bodyState, earthState, commandedAccelerationKmS2, dtSeconds) {
  const totalAccelerationKmS2 = add(
    gravityAccelerationKmS2(bodyState, earthState),
    commandedAccelerationKmS2 || { x: 0, y: 0, z: 0 },
  );
  bodyState.velocity = add(bodyState.velocity, scale(totalAccelerationKmS2, dtSeconds));
  bodyState.position = add(bodyState.position, scale(bodyState.velocity, dtSeconds));
}

function earthAxes() {
  return {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    pole: { x: 0, y: 0, z: 1 },
  };
}

function sampleEarthAtmosphere(altitudeKm = 0) {
  const safeAltitudeKm = Math.max(0, Number(altitudeKm) || 0);
  const attenuation = Math.exp(-safeAltitudeKm / 7.5);
  return {
    densityKgM3: 1.225 * attenuation,
    pressurePa: 101325 * attenuation,
    temperatureK: 288.15,
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
    gravitationalConstantKm3PerKgS2: G_KM3_PER_KG_S2,
  });
}

function main() {
  const state = makeState();
  const controller = createHarness();
  controller.setMissionProfile(LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN);
  const started = controller.startLaunch(state, NOW_MS, { launchKind: "moon-pad-refuel-test" });
  assert(started, "moon-pad-refuel: startLaunch rejected");

  let nowMs = NOW_MS;
  let tankerLaunches = 0;
  let reachedRefuel = false;
  let initialRefuelPropellantKg = null;
  let maxRefuelPropellantKg = 0;
  let finalSnapshot = null;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    controller.prepareStep(state, DT_SEC, nowMs);
    const earthState = state.staticSources.get("earth");
    for (const [bodyId, bodyState] of state.dynamicBodies.entries()) {
      integrateBody(bodyState, earthState, controller.externalAccelerationKmS2(bodyId), DT_SEC);
    }
    controller.finalizeStep(state, DT_SEC, nowMs);
    nowMs += DT_SEC * 1000;

    const snapshot = controller.statusSnapshot(state);
    finalSnapshot = snapshot;

    if (snapshot.missionPhase === "orbital_refuel") {
      reachedRefuel = true;
      if (initialRefuelPropellantKg === null) {
        initialRefuelPropellantKg = Number(snapshot.stagePropellantKg) || 0;
      }
      maxRefuelPropellantKg = Math.max(
        maxRefuelPropellantKg,
        Number(snapshot.stagePropellantKg) || 0,
      );
      if (
        tankerLaunches < 4
        && Number(snapshot.refuelFillFraction) < 0.88
        && Number(snapshot.refuelActiveFlights) < 1
      ) {
        const launchResult = controller.launchRefuelTanker(state, nowMs, { mode: "orbit_inject" });
        assert(
          launchResult?.accepted,
          `moon-pad-refuel: tanker launch ${tankerLaunches + 1} rejected (${launchResult?.reason || "unknown"})`,
        );
        tankerLaunches += 1;
      }
    }

    if (snapshot.missionPhase === "tli_burn") {
      break;
    }
  }

  assert(reachedRefuel, "moon-pad-refuel: never reached orbital_refuel");
  assert(
    tankerLaunches === 3,
    `moon-pad-refuel: expected 3 instant tanker injections to unlock TLI, got ${tankerLaunches}`,
  );
  assert(finalSnapshot, "moon-pad-refuel: missing final snapshot");
  assert(
    finalSnapshot.missionPhase === "tli_burn",
    `moon-pad-refuel: expected transition to tli_burn, got ${finalSnapshot.missionPhase}`,
  );
  assert(
    Number(finalSnapshot.refuelFillFraction) >= 0.88,
    `moon-pad-refuel: expected refuel fill >= 88%, got ${finalSnapshot.refuelFillFraction}`,
  );
  assert(
    Number(finalSnapshot.refuelCompletedFlights) >= 2,
    `moon-pad-refuel: expected at least 2 completed transfers before TLI, got ${finalSnapshot.refuelCompletedFlights}`,
  );
  assert(
    maxRefuelPropellantKg >= ((Number(initialRefuelPropellantKg) || 0) + 300_000),
    `moon-pad-refuel: expected propellant to increase materially during refuel, entry=${initialRefuelPropellantKg}, max=${maxRefuelPropellantKg}`,
  );

  console.log("PASS moon-pad-launch-refuel-unlock-e2e");
}

main();
