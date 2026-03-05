import {
  updateFleetTransferGuidance,
  advanceFleetTransferMass,
} from "../app/static/js/physics/launch/refuel/fleetTransferPipeline.js";
import { REFUEL_TANKER_CONFIG } from "../app/static/js/physics/launch/refuel/config.js";

const PHASE = Object.freeze({
  IDLE: "idle",
  STABILIZE: "stabilize_orbit",
  PHASING: "phasing",
  TRANSFER: "transfer",
  VELOCITY: "velocity_match",
  HOLD: "hold_point",
  FINAL: "final_approach",
  LOCK: "docked_lock",
  TRANSFERRING: "transferring",
  UNDOCKING: "undocking",
  COMPLETE: "complete",
});

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeRuntime() {
  const shipStageCapacityKg = 1_450_000;
  const tankerStageCapacityKg = 1_500_000;
  const ship = {
    id: "close_alt_ship",
    missionId: "orbital_refuel_demo",
    stageIndex: 0,
    stageProfiles: [{ propellantMassKg: shipStageCapacityKg }],
    stageActuator: { directionActual: { x: 0, y: 1, z: 0 } },
    stagePropellantKg: 450_000,
    propellantKg: 450_000,
  };
  const tanker = {
    id: "close_alt_tanker",
    missionId: "orbital_tanker_ops",
    stageIndex: 0,
    stageProfiles: [{ propellantMassKg: tankerStageCapacityKg }],
    stagePropellantKg: 1_250_000,
    propellantKg: 1_250_000,
  };
  return {
    ship,
    tanker,
    shipState: {
      position: { x: 6521, y: 0, z: 0 },
      velocity: { x: 0, y: 7.818, z: 0 },
      massKg: 220_000,
    },
    tankerState: {
      position: { x: 6521, y: 6, z: 0 },
      velocity: { x: 0, y: 7.818, z: 0 },
      massKg: 220_000,
    },
    earthState: {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    },
    orbitalState: {
      periapsisKm: 146,
      apoapsisKm: 166,
      radialSpeedKmS: 0.0015,
      timeToApoapsisSec: 360,
      timeToPeriapsisSec: 2200,
      orbitalPeriodSec: 5400,
    },
    nowSec: 0,
    targetFillFraction: REFUEL_TANKER_CONFIG.targetFillFraction,
  };
}

function baseProfileForPhase(phase) {
  if (phase === PHASE.IDLE || phase === PHASE.STABILIZE) {
    return { distanceKm: 6.0, relativeSpeedKmS: 0.02, closingSpeedKmS: 0.0025 };
  }
  if (phase === PHASE.PHASING) {
    return { distanceKm: 4.0, relativeSpeedKmS: 0.012, closingSpeedKmS: 0.0018 };
  }
  if (phase === PHASE.TRANSFER) {
    return { distanceKm: 2.6, relativeSpeedKmS: 0.007, closingSpeedKmS: 0.0011 };
  }
  if (phase === PHASE.VELOCITY) {
    return { distanceKm: 0.22, relativeSpeedKmS: 0.0015, closingSpeedKmS: 0.00025 };
  }
  if (phase === PHASE.HOLD) {
    return { distanceKm: 0.12, relativeSpeedKmS: 0.00035, closingSpeedKmS: 0.00008 };
  }
  if (phase === PHASE.FINAL || phase === PHASE.LOCK || phase === PHASE.TRANSFERRING) {
    return { distanceKm: 0.014, relativeSpeedKmS: 0.00005, closingSpeedKmS: 0.00002 };
  }
  return { distanceKm: 0.2, relativeSpeedKmS: 0.001, closingSpeedKmS: 0.0002 };
}

function buildTarget(phase, nowSec) {
  const profile = baseProfileForPhase(phase);
  const distanceKm = Math.max(0.001, Number(profile.distanceKm) || 0.001);
  const closing = Number(profile.closingSpeedKmS) || 0;

  let altitudeErrorKm = 0.4;
  let radialSpeedErrorKmS = 0.0006;
  // Start with a large vertical mismatch (10 km), then let stabilization converge.
  if ((phase === PHASE.IDLE || phase === PHASE.STABILIZE) && nowSec < 80) {
    altitudeErrorKm = 10.0;
    radialSpeedErrorKmS = 0.0021;
  } else if (phase === PHASE.PHASING || phase === PHASE.TRANSFER) {
    altitudeErrorKm = 2.5;
    radialSpeedErrorKmS = 0.0011;
  }

  return {
    tankerId: "close_alt_tanker",
    distanceKm,
    relativeSpeedKmS: Math.max(0, Number(profile.relativeSpeedKmS) || 0),
    closingSpeedKmS: closing,
    altitudeErrorKm,
    radialSpeedErrorKmS,
    relativePositionKm: { x: altitudeErrorKm, y: 6, z: 0 },
    relativeVelocityKmS: { x: radialSpeedErrorKmS, y: -Math.abs(closing), z: 0 },
  };
}

function runScenario(maxSimSeconds = 1600) {
  const runtime = makeRuntime();
  const visited = new Set();
  const initialShipPropKg = runtime.ship.stagePropellantKg;
  const initialTankerPropKg = runtime.tanker.stagePropellantKg;

  for (let i = 0; i < maxSimSeconds; i += 1) {
    runtime.nowSec += 1;
    const currentPhase = String(runtime.ship.refuelTransferState?.phase || PHASE.IDLE);
    const target = buildTarget(currentPhase, runtime.nowSec);

    const mode = updateFleetTransferGuidance({
      vehicle: runtime.ship,
      target,
      shipState: runtime.shipState,
      tankerState: runtime.tankerState,
      earthState: runtime.earthState,
      orbitalState: runtime.orbitalState,
      prograde: { x: 0, y: 1, z: 0 },
      requestedThrottle: 0,
      desiredDirection: { x: 0, y: 1, z: 0 },
      guidanceMode: "navsys:orbital-refuel-await-target",
      safeDtSeconds: 1,
      nowSec: runtime.nowSec,
      targetFillFraction: runtime.targetFillFraction,
      stagePropellantKg: runtime.ship.stagePropellantKg,
      stageCapacityKg: runtime.ship.stageProfiles[0].propellantMassKg,
      emitLaunchEvent: null,
    });

    runtime.ship.stageActuator.directionActual = mode?.desiredDirection || runtime.ship.stageActuator.directionActual;

    const massStep = advanceFleetTransferMass({
      vehicle: runtime.ship,
      shipState: runtime.shipState,
      tankerVehicle: runtime.tanker,
      tankerState: runtime.tankerState,
      safeDtSeconds: 1,
      targetFillFraction: runtime.targetFillFraction,
      emitLaunchEvent: null,
    });

    const phaseNow = String(runtime.ship.refuelTransferState?.phase || PHASE.IDLE);
    visited.add(phaseNow);

    if (massStep.completed || phaseNow === PHASE.COMPLETE) {
      const targetGoalKg = runtime.ship.stageProfiles[0].propellantMassKg * runtime.targetFillFraction;
      return {
        completed: true,
        simSeconds: runtime.nowSec,
        visited,
        shipPropellantKg: runtime.ship.stagePropellantKg,
        tankerPropellantKg: runtime.tanker.stagePropellantKg,
        targetGoalKg,
        initialShipPropKg,
        initialTankerPropKg,
      };
    }
  }

  return {
    completed: false,
    simSeconds: runtime.nowSec,
    visited,
    shipPropellantKg: runtime.ship.stagePropellantKg,
    tankerPropellantKg: runtime.tanker.stagePropellantKg,
    initialShipPropKg,
    initialTankerPropKg,
  };
}

function main() {
  const result = runScenario(1600);
  assert(result.completed, `Close-range altitude-offset case did not complete in ${result.simSeconds}s`);
  const visited = result.visited;
  assert(result.visited.has(PHASE.STABILIZE), "Missing stabilize_orbit phase");
  assert(
    visited.has(PHASE.PHASING) || visited.has(PHASE.TRANSFER) || visited.has(PHASE.VELOCITY),
    "Missing rendezvous maneuver phase (phasing/transfer/velocity_match)",
  );
  assert(result.visited.has(PHASE.HOLD), "Missing hold_point phase");
  assert(result.visited.has(PHASE.FINAL), "Missing final_approach phase");
  assert(result.visited.has(PHASE.LOCK), "Missing docked_lock phase");
  assert(result.visited.has(PHASE.TRANSFERRING), "Missing transferring phase");
  assert(result.visited.has(PHASE.UNDOCKING), "Missing undocking phase");
  assert(result.visited.has(PHASE.COMPLETE), "Missing complete phase");

  const reserveKg = 0.1 * 1_500_000;
  const availableFromTankerKg = Math.max(0, result.initialTankerPropKg - reserveKg);
  const deficitKg = Math.max(0, result.targetGoalKg - result.initialShipPropKg);
  const expectedTransferKg = Math.min(REFUEL_TANKER_CONFIG.transferPerFlightKg, availableFromTankerKg, deficitKg);
  const expectedShipKg = result.initialShipPropKg + expectedTransferKg;
  assert(
    Math.abs(result.shipPropellantKg - expectedShipKg) <= 3_500,
    `Unexpected transfer amount (ship=${result.shipPropellantKg.toFixed(0)} expected≈${expectedShipKg.toFixed(0)})`,
  );
  assert(
    result.tankerPropellantKg < result.initialTankerPropKg,
    "Tanker propellant did not decrease after transfer",
  );

  console.log(`PASS refuel-close-range-alt-offset e2e in ${result.simSeconds}s`);
  console.log(`PASS phases: ${[...result.visited.values()].join(" -> ")}`);
  console.log(
    `PASS mass ship ${result.initialShipPropKg.toFixed(0)} -> ${result.shipPropellantKg.toFixed(0)} kg`
    + ` | tanker ${result.initialTankerPropKg.toFixed(0)} -> ${result.tankerPropellantKg.toFixed(0)} kg`,
  );
}

main();
