import { createLaunchFleetController } from "../app/static/js/physics/launch/launchFleetController.js";
import { LAUNCH_VEHICLE_CONFIG } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";
import { solveMoonOrbitInjectWindowForLaunch } from "../app/static/js/physics/navigation_system/lunar/departureWindowSolver.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const SUN_MASS_KG = 1.9885e30;
const NOW_MS = Date.UTC(2026, 2, 7, 12, 0, 0);
const DT_SEC = 10;
const MAX_STEPS = 360;
const MIN_COAST_CLOSE_SPEED_KM_S = 0.05;
const MAX_COAST_MISS_KM = 120_000;

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

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function scale(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function length(vector) {
  return Math.sqrt(
    (vector.x * vector.x)
    + (vector.y * vector.y)
    + (vector.z * vector.z),
  );
}

function pointMassAccelerationKmS2(targetPosKm, sourcePosKm, sourceMassKg) {
  const relative = subtract(targetPosKm, sourcePosKm);
  const radiusKm = Math.max(1e-6, length(relative));
  const scaleFactor = -(G_KM3_KG_S2 * sourceMassKg) / (radiusKm * radiusKm * radiusKm);
  return scale(relative, scaleFactor);
}

function totalAccelerationKmS2(state, bodyId, controller) {
  const bodyState = state.dynamicBodies.get(bodyId);
  let acceleration = { x: 0, y: 0, z: 0 };
  for (const [sourceId, sourceState] of state.dynamicBodies.entries()) {
    if (sourceId === bodyId) {
      continue;
    }
    acceleration = add(
      acceleration,
      pointMassAccelerationKmS2(bodyState.position, sourceState.position, Number(sourceState.massKg) || 0),
    );
  }
  return add(acceleration, controller.externalAccelerationKmS2(bodyId) || { x: 0, y: 0, z: 0 });
}

function integrateStep(state, controller, nowMs) {
  controller.prepareStep(state, DT_SEC, nowMs);
  const accelerations = new Map();
  for (const [bodyId] of state.dynamicBodies.entries()) {
    accelerations.set(bodyId, totalAccelerationKmS2(state, bodyId, controller));
  }
  for (const [bodyId, bodyState] of state.dynamicBodies.entries()) {
    const acceleration = accelerations.get(bodyId) || { x: 0, y: 0, z: 0 };
    bodyState.velocity = add(bodyState.velocity, scale(acceleration, 0.5 * DT_SEC));
    bodyState.position = add(bodyState.position, scale(bodyState.velocity, DT_SEC));
  }
  for (const [bodyId, bodyState] of state.dynamicBodies.entries()) {
    const acceleration = totalAccelerationKmS2(state, bodyId, controller);
    bodyState.velocity = add(bodyState.velocity, scale(acceleration, 0.5 * DT_SEC));
  }
  controller.finalizeStep(state, DT_SEC, nowMs);
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
  const earthPositionKm = { x: -144_640_607.16, y: 33_471_673.02, z: 3_282.29 };
  const earthVelocityKmS = { x: -6.85, y: -28.72, z: 0.0004 };
  const moonOffsetKm = { x: 304_173, y: 258_525, z: 32_449 };
  const moonVelocityOffsetKmS = { x: -0.69, y: 0.79, z: 0.02 };
  return {
    dynamicBodies: new Map([
      [
        "sun",
        {
          id: "sun",
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          massKg: SUN_MASS_KG,
        },
      ],
      [
        "earth",
        {
          id: "earth",
          position: earthPositionKm,
          velocity: earthVelocityKmS,
          massKg: EARTH_MASS_KG,
        },
      ],
      [
        "moon",
        {
          id: "moon",
          position: add(earthPositionKm, moonOffsetKm),
          velocity: add(earthVelocityKmS, moonVelocityOffsetKmS),
          massKg: MOON_MASS_KG,
        },
      ],
    ]),
    staticSources: new Map(),
  };
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
  const earthState = state.dynamicBodies.get("earth");
  const moonState = state.dynamicBodies.get("moon");
  const stage2 = stageAtIndex(1);
  const stage2DryMassKg = Math.max(30_000, Number(stage2?.dryMassKg) || 120_000);
  const stage2PropellantMassKg = Math.max(1_200_000, Number(stage2?.propellantMassKg) || 1_200_000);
  const stage2ThrustVacuumN = Math.max(
    0,
    Number(stage2?.thrustVacuumN) || Number(stage2?.thrustSeaLevelN) || 0,
  );
  const spacecraftMassKg = stage2DryMassKg + stage2PropellantMassKg;
  const engineAccelAtThrottle1KmS2 = (stage2ThrustVacuumN / spacecraftMassKg) / 1000;
  const earthMuKm3S2 = G_KM3_KG_S2 * EARTH_MASS_KG;
  const moonDepartureWindowSeed = solveMoonOrbitInjectWindowForLaunch({
    earthState,
    moonState,
    inclinationDeg: 28.5,
    orbitAltitudeKm: 500,
    earthRadiusKm: EARTH_RADIUS_KM,
    earthMuKm3S2,
    engineAccelAtThrottle1KmS2,
    spacecraftMassKg,
    nodeSamples: 8,
    searchProfile: "fast",
  });
  assert(
    moonDepartureWindowSeed?.valid && moonDepartureWindowSeed?.ready && moonDepartureWindowSeed?.corridorAccepted,
    "moon_orbit_inject_live_coast_guard: inject seed unavailable",
  );

  const launch = controller.launchMissionShip(
    state,
    LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
    NOW_MS,
    { mode: "orbit_inject", moonDepartureWindowSeed },
  );
  assert(
    launch.accepted,
    `moon_orbit_inject_live_coast_guard: launch rejected (${launch.reason || "unknown"})`,
  );

  let coastSnapshot = null;
  let lateCoastSnapshot = null;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const nowMs = NOW_MS + (step * DT_SEC * 1000);
    integrateStep(state, controller, nowMs);
    const snapshot = controller.statusSnapshotForBody({
      state,
      bodyId: launch.shipId,
      nowMs,
      baseSnapshot: {},
    });
    if (String(snapshot?.missionPhase || "") === "coast_to_moon") {
      coastSnapshot ||= snapshot;
      if ((Number(snapshot?.elapsedSeconds) || 0) >= ((14 * 60) + (20 * 60))) {
        lateCoastSnapshot = snapshot;
        break;
      }
    }
  }

  assert(coastSnapshot, "moon_orbit_inject_live_coast_guard: never reached coast_to_moon");
  assert(lateCoastSnapshot, "moon_orbit_inject_live_coast_guard: missing late coast snapshot");
  assert(
    String(lateCoastSnapshot.guidanceMode || "").includes("midcourse-coast"),
    `moon_orbit_inject_live_coast_guard: expected coast guidance, got ${lateCoastSnapshot.guidanceMode}`,
  );
  assert(
    !String(lateCoastSnapshot.guidanceMode || "").includes("ballistic-track")
    || Number(lateCoastSnapshot.targetClosingSpeedKmS) > MIN_COAST_CLOSE_SPEED_KM_S,
    `moon_orbit_inject_live_coast_guard: departure hold persisted with weak closure (${lateCoastSnapshot.targetClosingSpeedKmS} km/s)`,
  );
  assert(
    String(lateCoastSnapshot.moonDirectionState || "") !== "away",
    `moon_orbit_inject_live_coast_guard: expected late coast not to point away from Moon, got ${lateCoastSnapshot.moonDirectionState}`,
  );
  assert(
    Number(lateCoastSnapshot.moonProjectedMissDistanceKm) < MAX_COAST_MISS_KM,
    `moon_orbit_inject_live_coast_guard: projected miss too large in late coast (${lateCoastSnapshot.moonProjectedMissDistanceKm} km)`,
  );

  console.log("PASS moon-orbit-inject-live-coast-guard-e2e");
}

main();
