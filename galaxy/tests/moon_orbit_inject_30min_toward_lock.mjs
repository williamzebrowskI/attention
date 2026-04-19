import { createLaunchFleetController } from "../app/static/js/physics/launch/launchFleetController.js";
import { LAUNCH_VEHICLE_CONFIG } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";
import {
  MOON_ORBIT_INJECT_LAUNCH_NODE_SAMPLES,
  MOON_ORBIT_INJECT_LAUNCH_SEARCH_PROFILE,
} from "../app/static/js/physics/launch/lunar/constants.js";
import {
  buildMoonGuidanceSourceModel,
  propagateMoonGuidanceState,
} from "../app/static/js/physics/navigation_system/lunar/moonDynamicsModel.js";
import { solveMoonOrbitInjectWindowForLaunch } from "../app/static/js/physics/navigation_system/lunar/departureWindowSolver.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const SUN_MASS_KG = 1.9885e30;
const NOW_MS = Date.UTC(2026, 2, 7, 12, 0, 0);
const SAMPLE_TIMES_SEC = [14 * 60, 30 * 60];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function length(v) {
  return Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z));
}

function normalize(v, fallback = { x: 1, y: 0, z: 0 }) {
  const magnitude = length(v);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-9) {
    return { ...fallback };
  }
  return scale(v, 1 / magnitude);
}

function classifyMoonDirection(relativePositionKm, relativeVelocityKmS) {
  const towardMoonUnit = normalize(scale(relativePositionKm, -1));
  const velocityUnit = normalize(relativeVelocityKmS, towardMoonUnit);
  const alignment = dot(velocityUnit, towardMoonUnit);
  if (alignment >= 0.35) {
    return "toward";
  }
  if (alignment <= -0.35) {
    return "away";
  }
  return "sideways";
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
  state.staticSources.set(id, { id, position, velocity, massKg });
}

function seedWorld(state) {
  addStaticBody(state, "earth", { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, EARTH_MASS_KG);
  addStaticBody(state, "moon", { x: 384400, y: 0, z: 0 }, { x: 0, y: 1.022, z: 0 }, MOON_MASS_KG);
  addStaticBody(state, "sun", { x: 149597870.7, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, SUN_MASS_KG);
}

function main() {
  const runtime = {
    windSeed: 1,
    fleet: { nextShipSequence: 1, vehicles: new Map() },
    refuel: { flights: [] },
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

  const earthState = state.staticSources.get("earth");
  const moonState = state.staticSources.get("moon");
  const stage2 = stageAtIndex(1);
  const stage2DryMassKg = Math.max(30_000, Number(stage2?.dryMassKg) || 120_000);
  const stage2PropellantMassKg = Math.max(1_200_000, Number(stage2?.propellantMassKg) || 1_200_000);
  const stage2ThrustVacuumN = Math.max(0, Number(stage2?.thrustVacuumN) || Number(stage2?.thrustSeaLevelN) || 0);
  const spacecraftMassKgForSeed = stage2DryMassKg + stage2PropellantMassKg;
  const accelAtThrottle1KmS2ForSeed = (stage2ThrustVacuumN / spacecraftMassKgForSeed) / 1000;
  const earthMuKm3S2 = G_KM3_KG_S2 * EARTH_MASS_KG;
  const seed = solveMoonOrbitInjectWindowForLaunch({
    earthState,
    moonState,
    inclinationDeg: 28.5,
    orbitAltitudeKm: 500,
    earthRadiusKm: EARTH_RADIUS_KM,
    earthMuKm3S2,
    engineAccelAtThrottle1KmS2: accelAtThrottle1KmS2ForSeed,
    spacecraftMassKg: spacecraftMassKgForSeed,
    nodeSamples: MOON_ORBIT_INJECT_LAUNCH_NODE_SAMPLES,
    searchProfile: MOON_ORBIT_INJECT_LAUNCH_SEARCH_PROFILE,
  });
  assert(
    seed?.valid && seed?.ready && seed?.corridorAccepted,
    "moon_orbit_inject_30min_toward_lock: launch seed unavailable",
  );

  const launch = controller.launchMissionShip(
    state,
    LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
    NOW_MS,
    { mode: "orbit_inject", moonDepartureWindowSeed: seed },
  );
  assert(
    launch?.accepted,
    `moon_orbit_inject_30min_toward_lock: launch rejected (${launch?.reason || "unknown"})`,
  );

  const shipId = launch.shipId;
  const shipBody = state.dynamicBodies.get(shipId);
  const vehicle = runtime.fleet.vehicles.get(shipId);
  assert(vehicle?.moonDeparturePlanReady, "moon_orbit_inject_30min_toward_lock: departure plan not ready");
  const spacecraftMassKg = Math.max(1, Number(shipBody?.massKg) || 0);
  const accelAtThrottle1KmS2 = (stage2ThrustVacuumN / spacecraftMassKg) / 1000;
  const sources = buildMoonGuidanceSourceModel({
    targetVectors: {
      moonEarthPositionKm: subtract(moonState.position, earthState.position),
      moonEarthVelocityKmS: subtract(moonState.velocity, earthState.velocity),
    },
    metrics: {
      earthMassKg: EARTH_MASS_KG,
      earthRadiusKm: EARTH_RADIUS_KM,
      moonMassKg: MOON_MASS_KG,
      moonRadiusKm: MOON_RADIUS_KM,
    },
    plannerConfig: {
      moonClosedLoopPropagationStepSec: 300,
    },
  });

  for (const elapsedSec of SAMPLE_TIMES_SEC) {
    const propagation = propagateMoonGuidanceState({
      initialState: {
        positionKm: { ...shipBody.position },
        velocityKmS: { ...shipBody.velocity },
      },
      durationSec: elapsedSec,
      stepSec: 300,
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
    const relativePositionKm = propagation.finalMoonRelativePositionKm;
    const relativeVelocityKmS = propagation.finalMoonRelativeVelocityKmS;
    const moonDistanceKm = length(relativePositionKm);
    const closingKmS = moonDistanceKm > 1e-9
      ? -dot(relativeVelocityKmS, scale(relativePositionKm, 1 / moonDistanceKm))
      : Number.NaN;
    const directionState = classifyMoonDirection(relativePositionKm, relativeVelocityKmS);
    assert(
      directionState === "toward",
      `moon_orbit_inject_30min_toward_lock: expected toward-Moon coast at ${elapsedSec}s, got ${directionState}`,
    );
    assert(
      Number.isFinite(closingKmS) && closingKmS > 0,
      `moon_orbit_inject_30min_toward_lock: expected positive Moon approach at ${elapsedSec}s, got ${closingKmS}`,
    );
  }

  console.log("PASS moon-orbit-inject-30min-toward-lock");
}

main();
