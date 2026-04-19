import { createLaunchFleetController } from "../app/static/js/physics/launch/launchFleetController.js";
import { LAUNCH_VEHICLE_CONFIG } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";
import { REFUEL_TANKER_CONFIG } from "../app/static/js/physics/launch/refuel/config.js";
import { ensureFleetTransferState } from "../app/static/js/physics/launch/refuel/fleetTransferPipeline.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const EARTH_MU_KM3_S2 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * EARTH_MASS_KG;
const SHIP_STAGE_CAPACITY_KG = 1_450_000;
const TANKER_STAGE_CAPACITY_KG = 1_500_000;
const SHIP_DRY_MASS_KG = 220_000;
const TANKER_DRY_MASS_KG = 220_000;

const PHASE = Object.freeze({
  IDLE: "idle",
  COMPLETE: "complete",
  STABILIZE: "stabilize_orbit",
  PHASING: "phasing",
  TRANSFER: "transfer",
  VELOCITY: "velocity_match",
  HOLD: "hold_point",
  FINAL: "final_approach",
  LOCK: "docked_lock",
  TRANSFERRING: "transferring",
  UNDOCKING: "undocking",
  ABORTING: "aborting",
});

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

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function cross(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function length(vector) {
  return Math.sqrt(dot(vector, vector));
}

function normalize(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const magnitude = length(vector);
  if (!(magnitude > 1e-9)) {
    return fallback;
  }
  return scale(vector, 1 / magnitude);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
  const runtime = {
    windSeed: 1,
    fleet: {
      nextShipSequence: 2,
      vehicles: new Map(),
    },
    refuel: {
      flights: [
        {
          id: "earth_refuel_tanker_1",
          active: true,
          status: "external_orbit",
        },
      ],
      nextGeneratedId: 2,
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
    gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
    emitLaunchEvent: null,
  });
  return { controller, runtime };
}

function configureOrbitStage(vehicle, {
  stageCapacityKg,
  stagePropellantKg,
  dryMassKg,
} = {}) {
  vehicle.stageProfiles = [
    {
      name: "Stage 1",
      dryMassKg: 0,
      propellantMassKg: 0,
      thrustSeaLevelN: 0,
      thrustVacuumN: 0,
      ispSeaLevelS: 1,
      ispVacuumS: 1,
    },
    {
      name: "Stage 2",
      dryMassKg,
      propellantMassKg: stageCapacityKg,
      thrustSeaLevelN: 0,
      thrustVacuumN: 15_600_000,
      ispSeaLevelS: 350,
      ispVacuumS: 380,
    },
  ];
  vehicle.stageIndex = 1;
  vehicle.stagePropellantKg = stagePropellantKg;
  vehicle.propellantKg = stagePropellantKg;
}

function launchControllerRefuelPair({
  shipPropellantKg = 450_000,
  tankerPropellantKg = 1_250_000,
} = {}) {
  const state = makeState();
  const { controller, runtime } = createHarness();
  const shipLaunch = controller.launchMissionShip(
    state,
    LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO,
    Date.now(),
    { mode: "orbit_inject" },
  );
  assert(shipLaunch.accepted, `mission ship launch rejected (${shipLaunch.reason || "unknown"})`);
  const tankerLaunch = controller.launchMissionShip(
    state,
    LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD,
    Date.now(),
    {
      mode: "orbit_inject",
      vehicleRole: "tanker",
      forcedId: "earth_refuel_tanker_1",
      forcedSequenceNumber: 1,
      orbitInjectAltitudeKm: 155,
    },
  );
  assert(tankerLaunch.accepted, `tanker launch rejected (${tankerLaunch.reason || "unknown"})`);

  const shipVehicle = runtime.fleet.vehicles.get(String(shipLaunch.shipId || ""));
  const tankerVehicle = runtime.fleet.vehicles.get("earth_refuel_tanker_1");
  const shipBody = state.dynamicBodies.get(String(shipLaunch.shipId || ""));
  const tankerBody = state.dynamicBodies.get("earth_refuel_tanker_1");
  assert(shipVehicle && tankerVehicle && shipBody && tankerBody, "missing launched refuel bodies");

  configureOrbitStage(shipVehicle, {
    stageCapacityKg: SHIP_STAGE_CAPACITY_KG,
    stagePropellantKg: shipPropellantKg,
    dryMassKg: SHIP_DRY_MASS_KG,
  });
  configureOrbitStage(tankerVehicle, {
    stageCapacityKg: TANKER_STAGE_CAPACITY_KG,
    stagePropellantKg: tankerPropellantKg,
    dryMassKg: TANKER_DRY_MASS_KG,
  });
  shipBody.massKg = SHIP_DRY_MASS_KG + shipPropellantKg;
  tankerBody.massKg = TANKER_DRY_MASS_KG + tankerPropellantKg;

  return {
    state,
    controller,
    runtime,
    shipVehicle,
    tankerVehicle,
    shipBody,
    tankerBody,
    tankerFlight: runtime.refuel.flights[0],
  };
}

function makeEllipticOrbitState({
  periapsisKm = 150,
  apoapsisKm = 160,
  trueAnomalyRad = 0,
} = {}) {
  const periapsisRadiusKm = EARTH_RADIUS_KM + periapsisKm;
  const apoapsisRadiusKm = EARTH_RADIUS_KM + apoapsisKm;
  const semiMajorAxisKm = (periapsisRadiusKm + apoapsisRadiusKm) * 0.5;
  const eccentricity = (apoapsisRadiusKm - periapsisRadiusKm) / (apoapsisRadiusKm + periapsisRadiusKm);
  const semiLatusRectumKm = semiMajorAxisKm * (1 - (eccentricity * eccentricity));
  const radiusKm = semiLatusRectumKm / (1 + (eccentricity * Math.cos(trueAnomalyRad)));
  const specificAngularMomentumKm2S = Math.sqrt(EARTH_MU_KM3_S2 * semiLatusRectumKm);
  return {
    position: {
      x: radiusKm * Math.cos(trueAnomalyRad),
      y: radiusKm * Math.sin(trueAnomalyRad),
      z: 0,
    },
    velocity: {
      x: -(EARTH_MU_KM3_S2 / specificAngularMomentumKm2S) * Math.sin(trueAnomalyRad),
      y: (EARTH_MU_KM3_S2 / specificAngularMomentumKm2S) * (eccentricity + Math.cos(trueAnomalyRad)),
      z: 0,
    },
  };
}

const orbitFrameCache = new Map();

function orbitFrameForProfile(profile = {}) {
  const key = JSON.stringify({
    periapsisKm: Number(profile.periapsisKm),
    apoapsisKm: Number(profile.apoapsisKm),
    trueAnomalyRad: Number(profile.trueAnomalyRad),
  });
  if (orbitFrameCache.has(key)) {
    return orbitFrameCache.get(key);
  }

  const periapsisKm = Math.max(80, Number(profile.periapsisKm) || 150);
  const apoapsisKm = Math.max(periapsisKm + 0.1, Number(profile.apoapsisKm) || (periapsisKm + 4));
  const resolved = makeEllipticOrbitState({
    periapsisKm,
    apoapsisKm,
    trueAnomalyRad: Number.isFinite(Number(profile.trueAnomalyRad))
      ? Number(profile.trueAnomalyRad)
      : 0.2,
  });
  orbitFrameCache.set(key, resolved);
  return resolved;
}

function defaultOrbitalProfile() {
  return {
    periapsisKm: 152,
    apoapsisKm: 156,
    radialSpeedKmS: 0.0004,
    timeToApoapsisSec: 120,
    timeToPeriapsisSec: 2500,
    orbitalPeriodSec: 5400,
  };
}

function defaultProfile(phase) {
  if (phase === PHASE.IDLE || phase === PHASE.STABILIZE) {
    return {
      distanceKm: 18,
      relativeSpeedKmS: 0.016,
      closingSpeedKmS: 0.0015,
      altitudeErrorKm: 1.2,
      radialSpeedErrorKmS: 0.0008,
      relativePosXKm: 0,
    };
  }
  if (phase === PHASE.PHASING) {
    return {
      distanceKm: 11,
      relativeSpeedKmS: 0.012,
      closingSpeedKmS: 0.0011,
      altitudeErrorKm: 0.9,
      radialSpeedErrorKmS: 0.0006,
      relativePosXKm: 0,
    };
  }
  if (phase === PHASE.TRANSFER) {
    return {
      distanceKm: 5.5,
      relativeSpeedKmS: 0.007,
      closingSpeedKmS: 0.0009,
      altitudeErrorKm: 0.6,
      radialSpeedErrorKmS: 0.0004,
      relativePosXKm: 0,
    };
  }
  if (phase === PHASE.VELOCITY) {
    return {
      distanceKm: 0.28,
      relativeSpeedKmS: 0.0014,
      closingSpeedKmS: 0.00022,
      altitudeErrorKm: 0.22,
      radialSpeedErrorKmS: 0.00015,
      relativePosXKm: 0,
    };
  }
  if (phase === PHASE.HOLD) {
    return {
      distanceKm: 0.11,
      relativeSpeedKmS: 0.00035,
      closingSpeedKmS: 0.00007,
      altitudeErrorKm: 0.1,
      radialSpeedErrorKmS: 0.00006,
      relativePosXKm: 0,
    };
  }
  if (phase === PHASE.FINAL || phase === PHASE.LOCK || phase === PHASE.TRANSFERRING) {
    return {
      distanceKm: 0.012,
      relativeSpeedKmS: 0.00005,
      closingSpeedKmS: 0.00002,
      altitudeErrorKm: 0.04,
      radialSpeedErrorKmS: 0.00002,
      relativePosXKm: 0,
    };
  }
  return {
    distanceKm: 0.2,
    relativeSpeedKmS: 0.001,
    closingSpeedKmS: 0.0002,
    altitudeErrorKm: 0.2,
    radialSpeedErrorKmS: 0.0001,
    relativePosXKm: 0,
  };
}

function buildPhaseTarget(phase, nowSec, profileFn) {
  const profile = (typeof profileFn === "function" ? profileFn(phase, nowSec) : null) || defaultProfile(phase);
  const distanceKm = Math.max(0.001, Number(profile.distanceKm) || 0.001);
  const altitudeErrorKm = Math.max(0, Number(profile.altitudeErrorKm) || 0);
  const radialSpeedErrorKmS = Number(profile.radialSpeedErrorKmS) || 0;
  const closingSpeedKmS = Number(profile.closingSpeedKmS) || 0;
  const relativeSpeedKmS = Math.max(0, Number(profile.relativeSpeedKmS) || 0);
  const relPosX = Number.isFinite(Number(profile.relativePosXKm))
    ? Number(profile.relativePosXKm)
    : 0;
  const relPosZ = Number.isFinite(Number(profile.relativePosZKm))
    ? Number(profile.relativePosZKm)
    : 0;
  const relVelZ = Number.isFinite(Number(profile.relativeVelZKmS))
    ? Number(profile.relativeVelZKmS)
    : 0;
  const relVelX = Number.isFinite(Number(profile.relativeVelXKmS))
    ? Number(profile.relativeVelXKmS)
    : 0;
  const alongTrackSign = Number.isFinite(Number(profile.relativePosYSign))
    ? Math.sign(Number(profile.relativePosYSign) || 1)
    : 1;
  const alongTrackKm = Math.sqrt(Math.max(0.001 * 0.001, (distanceKm * distanceKm) - (relPosX * relPosX) - (relPosZ * relPosZ)));
  return {
    distanceKm,
    relativeSpeedKmS,
    closingSpeedKmS,
    altitudeErrorKm,
    radialSpeedErrorKmS,
    relativePositionKm: {
      x: relPosX,
      y: alongTrackSign * alongTrackKm,
      z: relPosZ,
    },
    relativeVelocityKmS: {
      x: relVelX,
      y: -Math.abs(closingSpeedKmS),
      z: relVelZ,
    },
  };
}

function placeScenarioBodies({
  shipBody,
  tankerBody,
  tankerFlight,
  orbitalProfile,
  targetProfile,
}) {
  const shipOrbit = orbitFrameForProfile(orbitalProfile);
  const up = normalize(shipOrbit.position, { x: 1, y: 0, z: 0 });
  const prograde = normalize(shipOrbit.velocity, { x: 0, y: 1, z: 0 });
  const normal = normalize(cross(up, prograde), { x: 0, y: 0, z: 1 });
  const relativePositionKm = add(
    add(
      scale(up, Number(targetProfile.relativePositionKm.x) || 0),
      scale(prograde, Number(targetProfile.relativePositionKm.y) || 0),
    ),
    scale(normal, Number(targetProfile.relativePositionKm.z) || 0),
  );
  const relativeVelocityKmS = add(
    add(
      scale(up, Number(targetProfile.relativeVelocityKmS.x) || 0),
      scale(prograde, Number(targetProfile.relativeVelocityKmS.y) || 0),
    ),
    scale(normal, Number(targetProfile.relativeVelocityKmS.z) || 0),
  );

  shipBody.position = shipOrbit.position;
  shipBody.velocity = shipOrbit.velocity;
  tankerBody.position = add(shipBody.position, relativePositionKm);
  tankerBody.velocity = add(shipBody.velocity, relativeVelocityKmS);
  tankerFlight.sensorAltitudeKm = Math.max(0, length(tankerBody.position) - EARTH_RADIUS_KM);
  tankerFlight.sensorRadialSpeedKmS = dot(tankerBody.position, tankerBody.velocity) / Math.max(1e-9, length(tankerBody.position));
  tankerFlight.status = "external_orbit";
  tankerFlight.active = true;
}

function runControllerScenario({
  name,
  shipPropellantKg = 450_000,
  tankerPropellantKg = 1_250_000,
  profileFn = null,
  orbitalProfileFn = null,
  initializeFn = null,
  maxSimSeconds = 1800,
} = {}) {
  const {
    state,
    controller,
    shipVehicle,
    tankerVehicle,
    shipBody,
    tankerBody,
    tankerFlight,
  } = launchControllerRefuelPair({
    shipPropellantKg,
    tankerPropellantKg,
  });
  if (typeof initializeFn === "function") {
    initializeFn({
      state,
      controller,
      shipVehicle,
      tankerVehicle,
      shipBody,
      tankerBody,
      tankerFlight,
    });
  }
  const visitedPhases = new Set();
  const visitedModes = new Set();
  const phaseFirstSeenSec = new Map();
  const initialShipPropellantKg = shipVehicle.stagePropellantKg;
  const initialTankerPropellantKg = tankerVehicle.stagePropellantKg;
  let lastSnapshot = null;
  let lastPhase = PHASE.IDLE;

  for (let i = 0; i < maxSimSeconds; i += 1) {
    const nowSec = i + 1;
    const currentPhase = String(shipVehicle.refuelTransferState?.phase || PHASE.IDLE);
    const targetProfile = buildPhaseTarget(currentPhase, nowSec, profileFn);
    const orbitalProfile = (
      typeof orbitalProfileFn === "function"
        ? (orbitalProfileFn(currentPhase, nowSec) || defaultOrbitalProfile())
        : defaultOrbitalProfile()
    );

    placeScenarioBodies({
      shipBody,
      tankerBody,
      tankerFlight,
      orbitalProfile,
      targetProfile,
    });

    controller.prepareStep(state, 1, nowSec * 1000);
    controller.finalizeStep(state, 1, nowSec * 1000);

    lastPhase = String(shipVehicle.refuelTransferState?.phase || PHASE.IDLE);
    visitedPhases.add(lastPhase);
    if (!phaseFirstSeenSec.has(lastPhase)) {
      phaseFirstSeenSec.set(lastPhase, nowSec);
    }
    lastSnapshot = controller.statusSnapshotForBody({
      state,
      bodyId: shipVehicle.id,
      nowMs: nowSec * 1000,
      baseSnapshot: {},
    });
    if (lastSnapshot?.guidanceMode) {
      visitedModes.add(String(lastSnapshot.guidanceMode));
    }
    if (lastPhase === PHASE.COMPLETE) {
      break;
    }
  }

  const reserveKg = TANKER_STAGE_CAPACITY_KG * 0.1;
  const availableFromTankerKg = Math.max(0, initialTankerPropellantKg - reserveKg);
  const stageGoalKg = SHIP_STAGE_CAPACITY_KG * REFUEL_TANKER_CONFIG.targetFillFraction;
  const expectedTransferKg = Math.min(
    Number(REFUEL_TANKER_CONFIG.transferPerFlightKg) || 360_000,
    Math.max(0, stageGoalKg - initialShipPropellantKg),
    availableFromTankerKg,
  );

  return {
    name,
    finalPhase: lastPhase,
    missionPhase: String(shipVehicle.missionPhase || ""),
    missionCompleted: Boolean(shipVehicle.missionCompleted),
    visitedPhases,
    visitedModes,
    phaseFirstSeenSec,
    shipPropellantKg: Number(shipVehicle.stagePropellantKg) || 0,
    tankerPropellantKg: Number(tankerVehicle.stagePropellantKg) || 0,
    expectedTransferKg,
    initialShipPropellantKg,
    initialTankerPropellantKg,
    snapshot: lastSnapshot,
  };
}

function assertVisitedMode(result, token, label) {
  const matched = [...result.visitedModes.values()].some((mode) => String(mode).includes(token));
  assert(matched, `${label}: missing guidance token ${token}`);
}

function assertFullTransferCycle(result, label) {
  assert(result.finalPhase === PHASE.COMPLETE, `${label}: final transfer phase should be complete`);
  assert(result.visitedPhases.has(PHASE.STABILIZE), `${label}: missing stabilize_orbit`);
  assert(result.visitedPhases.has(PHASE.VELOCITY), `${label}: missing velocity_match`);
  assert(result.visitedPhases.has(PHASE.HOLD), `${label}: missing hold_point`);
  assert(result.visitedPhases.has(PHASE.FINAL), `${label}: missing final_approach`);
  assert(result.visitedPhases.has(PHASE.LOCK), `${label}: missing docked_lock`);
  assert(result.visitedPhases.has(PHASE.TRANSFERRING), `${label}: missing transferring`);
  assert(result.visitedPhases.has(PHASE.UNDOCKING), `${label}: missing undocking`);
  assert(result.visitedPhases.has(PHASE.COMPLETE), `${label}: missing complete`);
}

function runNominalScenario() {
  const result = runControllerScenario({
    name: "controller_nominal",
    profileFn: (phase) => {
      if (phase === PHASE.IDLE || phase === PHASE.STABILIZE) {
        return { distanceKm: 120, relativeSpeedKmS: 0.03, closingSpeedKmS: 0.004, altitudeErrorKm: 0.35, radialSpeedErrorKmS: 0.0007 };
      }
      if (phase === PHASE.PHASING) {
        return { distanceKm: 40, relativeSpeedKmS: 0.05, closingSpeedKmS: 0.003, altitudeErrorKm: 0.35, radialSpeedErrorKmS: 0.0007 };
      }
      if (phase === PHASE.TRANSFER) {
        return { distanceKm: 14.5, relativeSpeedKmS: 0.022, closingSpeedKmS: 0.0018, altitudeErrorKm: 0.35, radialSpeedErrorKmS: 0.0007 };
      }
      if (phase === PHASE.VELOCITY) {
        return { distanceKm: 0.18, relativeSpeedKmS: 0.0012, closingSpeedKmS: 0.00028, altitudeErrorKm: 0.35, radialSpeedErrorKmS: 0.0007 };
      }
      if (phase === PHASE.HOLD) {
        return { distanceKm: 0.1, relativeSpeedKmS: 0.0002, closingSpeedKmS: 0.00005, altitudeErrorKm: 0.35, radialSpeedErrorKmS: 0.0007 };
      }
      return { distanceKm: 0.012, relativeSpeedKmS: 0.00003, closingSpeedKmS: 0.000015, altitudeErrorKm: 0.35, radialSpeedErrorKmS: 0.0007 };
    },
    orbitalProfileFn: () => ({
      periapsisKm: 152,
      apoapsisKm: 156,
      radialSpeedKmS: 0.0004,
      timeToApoapsisSec: 120,
      timeToPeriapsisSec: 2500,
      orbitalPeriodSec: 5400,
    }),
    maxSimSeconds: 900,
  });
  assertFullTransferCycle(result, "nominal");
  assertVisitedMode(result, "orbital-refuel-orbit-stabilize", "nominal");
  assertVisitedMode(result, "orbital-refuel-transfer-burn", "nominal");
  assertVisitedMode(result, "orbital-refuel-lock", "nominal");
  assertVisitedMode(result, "orbital-refuel-undocking", "nominal");
  assert(
    Math.abs(result.shipPropellantKg - (result.initialShipPropellantKg + result.expectedTransferKg)) <= 5_000,
    `nominal: unexpected ship propellant ${result.shipPropellantKg.toFixed(0)}`,
  );
  assert(
    result.missionPhase === "orbital_refuel" && result.missionCompleted === false,
    "nominal: mission should still await additional refuel after one transfer cycle",
  );
  return result;
}

function runCloseRangeAltitudeScenario() {
  const result = runControllerScenario({
    name: "controller_close_range_altitude",
    profileFn: (phase, nowSec) => {
      if (phase === PHASE.IDLE || phase === PHASE.STABILIZE) {
        if (nowSec < 80) {
          return {
            distanceKm: 6,
            relativeSpeedKmS: 0.02,
            closingSpeedKmS: 0.0025,
            altitudeErrorKm: 10.0,
            radialSpeedErrorKmS: 0.0021,
            relativePosXKm: 10.0,
            relativeVelXKmS: 0.0021,
          };
        }
        return {
          distanceKm: 6.0,
          relativeSpeedKmS: 0.02,
          closingSpeedKmS: 0.0025,
          altitudeErrorKm: 0.4,
          radialSpeedErrorKmS: 0.0006,
          relativePosXKm: 0.4,
          relativeVelXKmS: 0.0006,
        };
      }
      if (phase === PHASE.PHASING) {
        return {
          distanceKm: 4.0,
          relativeSpeedKmS: 0.012,
          closingSpeedKmS: 0.0018,
          altitudeErrorKm: 2.5,
          radialSpeedErrorKmS: 0.0011,
          relativePosXKm: 2.5,
          relativeVelXKmS: 0.0011,
        };
      }
      if (phase === PHASE.TRANSFER) {
        return {
          distanceKm: 2.6,
          relativeSpeedKmS: 0.007,
          closingSpeedKmS: 0.0011,
          altitudeErrorKm: 2.5,
          radialSpeedErrorKmS: 0.0011,
          relativePosXKm: 2.5,
          relativeVelXKmS: 0.0011,
        };
      }
      if (phase === PHASE.VELOCITY) {
        return {
          distanceKm: 0.22,
          relativeSpeedKmS: 0.0015,
          closingSpeedKmS: 0.00025,
          altitudeErrorKm: 0.4,
          radialSpeedErrorKmS: 0.0006,
          relativePosXKm: 0.12,
          relativeVelXKmS: 0.00018,
        };
      }
      if (phase === PHASE.HOLD) {
        return {
          distanceKm: 0.12,
          relativeSpeedKmS: 0.00035,
          closingSpeedKmS: 0.00008,
          altitudeErrorKm: 0.4,
          radialSpeedErrorKmS: 0.0006,
          relativePosXKm: 0.03,
          relativeVelXKmS: 0.00005,
        };
      }
      return {
        distanceKm: 0.014,
        relativeSpeedKmS: 0.00005,
        closingSpeedKmS: 0.00002,
        altitudeErrorKm: 0.4,
        radialSpeedErrorKmS: 0.0006,
        relativePosXKm: 0,
        relativeVelXKmS: 0,
      };
    },
    orbitalProfileFn: () => ({
      periapsisKm: 146,
      apoapsisKm: 166,
      radialSpeedKmS: 0.0015,
      timeToApoapsisSec: 360,
      timeToPeriapsisSec: 2200,
      orbitalPeriodSec: 5400,
    }),
    maxSimSeconds: 1600,
  });
  assertFullTransferCycle(result, "close_range_altitude");
  assertVisitedMode(result, "orbital-refuel-orbit-stabilize", "close_range_altitude");
  assertVisitedMode(result, "orbital-refuel-final-approach", "close_range_altitude");
  return result;
}

function runEdgeSuite() {
  const cases = [
    {
      name: "controller_edge_ship_already_full",
      shipPropellantKg: 1_300_000,
      tankerPropellantKg: 1_250_000,
      maxSimSeconds: 20,
      verify: (result) => {
        assert(result.finalPhase === PHASE.COMPLETE, "already_full: should complete transfer state immediately");
        assert(result.visitedPhases.size === 1 && result.visitedPhases.has(PHASE.COMPLETE), "already_full: should not enter rendezvous phases");
        assert(result.missionPhase === "orbital_refuel" && result.missionCompleted === false, "already_full: mission should not auto-complete without a transfer");
      },
    },
    {
      name: "controller_edge_tanker_reserve_limited",
      shipPropellantKg: 450_000,
      tankerPropellantKg: 170_000,
      maxSimSeconds: 1800,
      verify: (result) => {
        assertFullTransferCycle(result, "reserve_limited");
        assert(
          Math.abs(result.shipPropellantKg - (result.initialShipPropellantKg + 20_000)) <= 4_000,
          `reserve_limited: unexpected ship propellant ${result.shipPropellantKg.toFixed(0)}`,
        );
        assert(
          result.tankerPropellantKg >= 149_500 && result.tankerPropellantKg <= 151_500,
          `reserve_limited: tanker should end near reserve, got ${result.tankerPropellantKg.toFixed(0)}`,
        );
        assert(result.missionPhase === "orbital_refuel", "reserve_limited: mission should remain in orbital_refuel");
      },
    },
    {
      name: "controller_edge_low_periapsis_recovery_then_dock",
      shipPropellantKg: 450_000,
      tankerPropellantKg: 1_250_000,
      maxSimSeconds: 2200,
      orbitalProfileFn: (_phase, nowSec) => {
        if (nowSec <= 180) {
          return {
            periapsisKm: 114,
            apoapsisKm: 178,
            radialSpeedKmS: 0.0008,
            timeToApoapsisSec: 70,
            timeToPeriapsisSec: 2500,
            orbitalPeriodSec: 5400,
          };
        }
        return {
          periapsisKm: 150,
          apoapsisKm: 156,
          radialSpeedKmS: 0.0003,
          timeToApoapsisSec: 130,
          timeToPeriapsisSec: 2450,
          orbitalPeriodSec: 5400,
        };
      },
      verify: (result) => {
        assertFullTransferCycle(result, "low_periapsis");
        const firstRendezvousSec = Math.min(
          Number(result.phaseFirstSeenSec.get(PHASE.PHASING)) || Number.POSITIVE_INFINITY,
          Number(result.phaseFirstSeenSec.get(PHASE.TRANSFER)) || Number.POSITIVE_INFINITY,
          Number(result.phaseFirstSeenSec.get(PHASE.VELOCITY)) || Number.POSITIVE_INFINITY,
        );
        assert(
          Number.isFinite(firstRendezvousSec) && firstRendezvousSec > 90,
          `low_periapsis: rendezvous started too early (${firstRendezvousSec})`,
        );
      },
    },
    {
      name: "controller_edge_high_apoapsis_trim_then_dock",
      shipPropellantKg: 450_000,
      tankerPropellantKg: 1_250_000,
      maxSimSeconds: 2200,
      orbitalProfileFn: (_phase, nowSec) => {
        if (nowSec <= 160) {
          return {
            periapsisKm: 149,
            apoapsisKm: 540,
            radialSpeedKmS: 0.0004,
            timeToApoapsisSec: 2500,
            timeToPeriapsisSec: 80,
            orbitalPeriodSec: 5400,
          };
        }
        return {
          periapsisKm: 151,
          apoapsisKm: 158,
          radialSpeedKmS: 0.00025,
          timeToApoapsisSec: 120,
          timeToPeriapsisSec: 2480,
          orbitalPeriodSec: 5400,
        };
      },
      verify: (result) => {
        assertFullTransferCycle(result, "high_apoapsis");
      },
    },
    {
      name: "controller_edge_transfer_gate_low_periapsis_below_tanker",
      shipPropellantKg: 450_000,
      tankerPropellantKg: 1_250_000,
      maxSimSeconds: 2400,
      initializeFn: ({ shipVehicle, tankerVehicle }) => {
        const transfer = ensureFleetTransferState(shipVehicle);
        transfer.phase = PHASE.TRANSFER;
        transfer.phaseEnterSec = 0;
        transfer.targetTankerId = tankerVehicle.id;
      },
      profileFn: (phase, nowSec) => {
        const base = defaultProfile(phase);
        if (nowSec <= 180) {
          return {
            ...base,
            distanceKm: 29.2,
            relativeSpeedKmS: 0.013,
            closingSpeedKmS: 0.0128,
            altitudeErrorKm: 12.95,
            radialSpeedErrorKmS: 0.0016,
            relativePosXKm: 12.95,
            relativeVelXKmS: 0.00015,
          };
        }
        if (phase === PHASE.STABILIZE) {
          return {
            ...base,
            distanceKm: 22,
            relativeSpeedKmS: 0.009,
            closingSpeedKmS: 0.0032,
            altitudeErrorKm: 4.2,
            radialSpeedErrorKmS: 0.0007,
            relativePosXKm: 4.2,
            relativeVelXKmS: 0.00008,
          };
        }
        if (phase === PHASE.TRANSFER || phase === PHASE.VELOCITY) {
          return {
            ...base,
            distanceKm: phase === PHASE.TRANSFER ? 8.5 : 0.42,
            relativeSpeedKmS: phase === PHASE.TRANSFER ? 0.010 : 0.0018,
            closingSpeedKmS: phase === PHASE.TRANSFER ? 0.0016 : 0.00025,
            altitudeErrorKm: phase === PHASE.TRANSFER ? 2.3 : 0.22,
            radialSpeedErrorKmS: phase === PHASE.TRANSFER ? 0.00035 : 0.00009,
            relativePosXKm: phase === PHASE.TRANSFER ? 2.3 : 0.12,
            relativeVelXKmS: phase === PHASE.TRANSFER ? 0.00006 : 0.00002,
          };
        }
        if (
          phase === PHASE.HOLD
          || phase === PHASE.FINAL
          || phase === PHASE.LOCK
          || phase === PHASE.TRANSFERRING
        ) {
          return {
            ...base,
            relativePosXKm: 0,
            relativeVelXKmS: 0,
          };
        }
        return base;
      },
      orbitalProfileFn: (_phase, nowSec) => {
        if (nowSec <= 180) {
          return {
            periapsisKm: 118.2,
            apoapsisKm: 162.11,
            radialSpeedKmS: 0.0006,
            timeToApoapsisSec: 220,
            timeToPeriapsisSec: 2400,
            orbitalPeriodSec: 5400,
          };
        }
        if (nowSec <= 360) {
          return {
            periapsisKm: 141,
            apoapsisKm: 160,
            radialSpeedKmS: 0.00045,
            timeToApoapsisSec: 180,
            timeToPeriapsisSec: 2450,
            orbitalPeriodSec: 5400,
          };
        }
        return {
          periapsisKm: 150,
          apoapsisKm: 156,
          radialSpeedKmS: 0.00025,
          timeToApoapsisSec: 120,
          timeToPeriapsisSec: 2480,
          orbitalPeriodSec: 5400,
        };
      },
      verify: (result) => {
        assert(result.finalPhase === PHASE.COMPLETE, "transfer_low_peri_below_tanker: final phase should be complete");
        assert(result.visitedPhases.has(PHASE.TRANSFER), "transfer_low_peri_below_tanker: missing transfer");
        assert(result.visitedPhases.has(PHASE.VELOCITY), "transfer_low_peri_below_tanker: missing velocity_match");
        assert(result.visitedPhases.has(PHASE.HOLD), "transfer_low_peri_below_tanker: missing hold_point");
        assert(result.visitedPhases.has(PHASE.FINAL), "transfer_low_peri_below_tanker: missing final_approach");
        assert(result.visitedPhases.has(PHASE.LOCK), "transfer_low_peri_below_tanker: missing docked_lock");
        assert(result.visitedPhases.has(PHASE.TRANSFERRING), "transfer_low_peri_below_tanker: missing transferring");
        assert(result.visitedPhases.has(PHASE.UNDOCKING), "transfer_low_peri_below_tanker: missing undocking");
        assert(result.visitedPhases.has(PHASE.COMPLETE), "transfer_low_peri_below_tanker: missing complete");
        assertVisitedMode(result, "orbital-refuel-transfer-burn", "transfer_low_peri_below_tanker");
        const velocitySec = Number(result.phaseFirstSeenSec.get(PHASE.VELOCITY));
        assert(
          Number.isFinite(velocitySec) && velocitySec < 900,
          `transfer_low_peri_below_tanker: should not remain trapped before velocity match (${velocitySec})`,
        );
      },
    },
    {
      name: "controller_edge_transfer_overshoot_recover_then_dock",
      shipPropellantKg: 450_000,
      tankerPropellantKg: 1_250_000,
      maxSimSeconds: 2200,
      initializeFn: ({ shipVehicle, tankerVehicle }) => {
        const transfer = ensureFleetTransferState(shipVehicle);
        transfer.phase = PHASE.TRANSFER;
        transfer.phaseEnterSec = 0;
        transfer.targetTankerId = tankerVehicle.id;
        transfer.phaseBestDistanceKm = 7.8;
        transfer.lastDistanceKm = 8.0;
        transfer.lastClosingSpeedKmS = 0.0032;
      },
      profileFn: (phase, nowSec) => {
        const base = defaultProfile(phase);
        if (nowSec <= 60) {
          return {
            ...base,
            distanceKm: 8.6,
            relativeSpeedKmS: 0.019,
            closingSpeedKmS: -0.0042,
            altitudeErrorKm: 0.8,
            radialSpeedErrorKmS: 0.0005,
            relativePosXKm: 0.8,
          };
        }
        if (phase === PHASE.VELOCITY && nowSec <= 220) {
          return {
            ...base,
            distanceKm: 8.9,
            relativeSpeedKmS: 0.0014,
            closingSpeedKmS: -0.00022,
            altitudeErrorKm: 0.35,
            radialSpeedErrorKmS: 0.00008,
            relativePosXKm: 0.35,
          };
        }
        if (phase === PHASE.TRANSFER) {
          return {
            ...base,
            distanceKm: 5.2,
            relativeSpeedKmS: 0.006,
            closingSpeedKmS: 0.0008,
            altitudeErrorKm: 0.22,
            radialSpeedErrorKmS: 0.00008,
            relativePosXKm: 0.22,
          };
        }
        if (
          phase === PHASE.HOLD
          || phase === PHASE.FINAL
          || phase === PHASE.LOCK
          || phase === PHASE.TRANSFERRING
        ) {
          return {
            ...base,
            relativePosXKm: 0,
            relativeVelXKmS: 0,
          };
        }
        return base;
      },
      verify: (result) => {
        assert(result.finalPhase === PHASE.COMPLETE, "transfer_overshoot_recover_then_dock: final phase should be complete");
        assert(result.visitedPhases.has(PHASE.VELOCITY), "transfer_overshoot_recover_then_dock: missing velocity_match");
        assert(result.visitedPhases.has(PHASE.HOLD), "transfer_overshoot_recover_then_dock: missing hold_point");
        const velocitySec = Number(result.phaseFirstSeenSec.get(PHASE.VELOCITY));
        assert(
          Number.isFinite(velocitySec) && velocitySec <= 15,
          `transfer_overshoot_recover_then_dock: should brake into velocity_match immediately (${velocitySec})`,
        );
        assertVisitedMode(result, "orbital-refuel-lock", "transfer_overshoot_recover_then_dock");
      },
    },
    {
      name: "controller_edge_abort_then_recover",
      shipPropellantKg: 450_000,
      tankerPropellantKg: 1_250_000,
      maxSimSeconds: 2200,
      profileFn: (phase, nowSec) => {
        const base = defaultProfile(phase);
        if ((phase === PHASE.HOLD || phase === PHASE.FINAL) && nowSec <= 400) {
          return {
            ...base,
            distanceKm: 0.14,
            relativeSpeedKmS: 0.014,
            closingSpeedKmS: 0.009,
            altitudeErrorKm: 0.5,
            radialSpeedErrorKmS: 0.003,
            relativePosXKm: 0.05,
            relativeVelXKmS: 0.0012,
          };
        }
        return base;
      },
      verify: (result) => {
        assertFullTransferCycle(result, "abort_then_recover");
        assert(result.visitedPhases.has(PHASE.ABORTING), "abort_then_recover: should hit aborting");
        assertVisitedMode(result, "orbital-refuel-abort-brake", "abort_then_recover");
      },
    },
    {
      name: "controller_edge_off_plane_3d_alignment",
      shipPropellantKg: 450_000,
      tankerPropellantKg: 1_250_000,
      maxSimSeconds: 1900,
      profileFn: (phase) => {
        const base = defaultProfile(phase);
        if (phase === PHASE.IDLE || phase === PHASE.STABILIZE) {
          return {
            ...base,
            distanceKm: 14,
            altitudeErrorKm: 6,
            radialSpeedErrorKmS: 0.0018,
            relativePosXKm: 6,
            relativePosZKm: 8,
            relativeVelZKmS: -0.0012,
          };
        }
        if (phase === PHASE.TRANSFER || phase === PHASE.VELOCITY) {
          return {
            ...base,
            relativePosXKm: 0.9,
            relativePosZKm: 1.6,
            relativeVelZKmS: -0.00025,
          };
        }
        if (phase === PHASE.HOLD || phase === PHASE.FINAL || phase === PHASE.LOCK || phase === PHASE.TRANSFERRING) {
          return {
            ...base,
            relativePosXKm: 0,
            relativePosZKm: 0,
            relativeVelZKmS: 0,
          };
        }
        return {
          ...base,
          relativePosXKm: 0.12,
          relativePosZKm: 0.2,
          relativeVelZKmS: -0.00003,
        };
      },
      verify: (result) => {
        assertFullTransferCycle(result, "off_plane_3d_alignment");
      },
    },
    {
      name: "controller_edge_close_range_6km_track_10km_altitude_delta",
      shipPropellantKg: 450_000,
      tankerPropellantKg: 1_250_000,
      maxSimSeconds: 2100,
      profileFn: (phase) => {
        const base = defaultProfile(phase);
        if (phase === PHASE.IDLE || phase === PHASE.STABILIZE) {
          return {
            ...base,
            distanceKm: 6,
            relativeSpeedKmS: 0.0105,
            closingSpeedKmS: 0.0012,
            altitudeErrorKm: 10,
            radialSpeedErrorKmS: 0.0019,
            relativePosXKm: 10,
            relativePosZKm: 0.8,
            relativeVelZKmS: -0.0005,
          };
        }
        if (phase === PHASE.TRANSFER || phase === PHASE.VELOCITY) {
          return {
            ...base,
            distanceKm: phase === PHASE.TRANSFER ? 2.6 : 0.32,
            altitudeErrorKm: phase === PHASE.TRANSFER ? 2.8 : 0.28,
            radialSpeedErrorKmS: phase === PHASE.TRANSFER ? 0.00045 : 0.00012,
            relativePosXKm: phase === PHASE.TRANSFER ? 2.8 : 0.2,
            relativePosZKm: phase === PHASE.TRANSFER ? 0.7 : 0.05,
            relativeVelZKmS: phase === PHASE.TRANSFER ? -0.00012 : -0.00002,
          };
        }
        if (phase === PHASE.HOLD || phase === PHASE.FINAL || phase === PHASE.LOCK || phase === PHASE.TRANSFERRING) {
          return {
            ...base,
            relativePosXKm: 0,
            relativePosZKm: 0,
            relativeVelZKmS: 0,
          };
        }
        return base;
      },
      verify: (result) => {
        assertFullTransferCycle(result, "close_6km_10km_alt");
      },
    },
  ];

  const results = cases.map((scenario) => {
    const result = runControllerScenario(scenario);
    scenario.verify(result);
    return result;
  });

  return results;
}

function main() {
  const nominal = runNominalScenario();
  const closeRange = runCloseRangeAltitudeScenario();
  const edgeResults = runEdgeSuite();

  console.log(
    `PASS refuel-controller nominal phases=[${[...nominal.visitedPhases.values()].join("->")}] `
    + `ship=${nominal.shipPropellantKg.toFixed(0)} tanker=${nominal.tankerPropellantKg.toFixed(0)}`,
  );
  console.log(
    `PASS refuel-controller close-range phases=[${[...closeRange.visitedPhases.values()].join("->")}] `
    + `ship=${closeRange.shipPropellantKg.toFixed(0)} tanker=${closeRange.tankerPropellantKg.toFixed(0)}`,
  );
  for (const result of edgeResults) {
    console.log(
      `PASS ${result.name} phase=${result.finalPhase} mission=${result.missionPhase} `
      + `ship=${result.shipPropellantKg.toFixed(0)} tanker=${result.tankerPropellantKg.toFixed(0)} `
      + `visited=[${[...result.visitedPhases.values()].join("->")}]`,
    );
  }
  console.log(`PASS refuel-controller state progression suite (${edgeResults.length + 2} scenarios)`);
}

main();
