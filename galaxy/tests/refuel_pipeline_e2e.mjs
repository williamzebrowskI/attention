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
    id: "e2e_ship",
    missionId: "orbital_refuel_demo",
    stageIndex: 0,
    stageProfiles: [{ propellantMassKg: shipStageCapacityKg }],
    stageActuator: { directionActual: { x: 0, y: 1, z: 0 } },
    stagePropellantKg: 450_000,
    propellantKg: 450_000,
  };
  const tanker = {
    id: "e2e_tanker",
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
      position: { x: 6521, y: 25, z: 0 },
      velocity: { x: 0, y: 7.818, z: 0 },
      massKg: 220_000,
    },
    earthState: {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    },
    orbitalState: {
      periapsisKm: 152,
      apoapsisKm: 156,
      radialSpeedKmS: 0.0004,
      timeToApoapsisSec: 120,
      timeToPeriapsisSec: 2500,
      orbitalPeriodSec: 5400,
    },
    nowSec: 0,
    targetFillFraction: REFUEL_TANKER_CONFIG.targetFillFraction,
  };
}

function targetForPhase(phase) {
  if (phase === PHASE.STABILIZE || phase === PHASE.IDLE) {
    return { distanceKm: 120, relativeSpeedKmS: 0.03, closingSpeedKmS: 0.004 };
  }
  if (phase === PHASE.PHASING) {
    return { distanceKm: 40, relativeSpeedKmS: 0.05, closingSpeedKmS: 0.003 };
  }
  if (phase === PHASE.TRANSFER) {
    return { distanceKm: 14.5, relativeSpeedKmS: 0.022, closingSpeedKmS: 0.0018 };
  }
  if (phase === PHASE.VELOCITY) {
    return { distanceKm: 0.18, relativeSpeedKmS: 0.0012, closingSpeedKmS: 0.00028 };
  }
  if (phase === PHASE.HOLD) {
    return { distanceKm: 0.1, relativeSpeedKmS: 0.0002, closingSpeedKmS: 0.00005 };
  }
  if (phase === PHASE.FINAL || phase === PHASE.LOCK || phase === PHASE.TRANSFERRING) {
    return { distanceKm: 0.012, relativeSpeedKmS: 0.00003, closingSpeedKmS: 0.000015 };
  }
  return { distanceKm: 0.18, relativeSpeedKmS: 0.001, closingSpeedKmS: 0.0002 };
}

function buildTarget(phase) {
  const profile = targetForPhase(phase);
  const d = Math.max(0.001, Number(profile.distanceKm) || 0.001);
  const closing = Number(profile.closingSpeedKmS) || 0;
  return {
    tankerId: "e2e_tanker",
    distanceKm: d,
    relativeSpeedKmS: Math.max(0, Number(profile.relativeSpeedKmS) || 0),
    closingSpeedKmS: closing,
    altitudeErrorKm: 0.35,
    radialSpeedErrorKmS: 0.0007,
    relativePositionKm: { x: 0, y: d, z: 0 },
    relativeVelocityKmS: { x: 0, y: -Math.abs(closing), z: 0 },
  };
}

function runNominalE2E(maxSimSeconds = 900) {
  const runtime = makeRuntime();
  const visited = new Set();
  const phaseCounts = new Map();
  const initialShipPropKg = runtime.ship.stagePropellantKg;
  const initialTankerPropKg = runtime.tanker.stagePropellantKg;

  for (let i = 0; i < maxSimSeconds; i += 1) {
    runtime.nowSec += 1;
    const currentPhase = String(runtime.ship.refuelTransferState?.phase || PHASE.IDLE);
    const target = buildTarget(currentPhase);

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
    phaseCounts.set(phaseNow, (phaseCounts.get(phaseNow) || 0) + 1);

    if (massStep.completed || phaseNow === PHASE.COMPLETE) {
      const targetGoalKg = runtime.ship.stageProfiles[0].propellantMassKg * runtime.targetFillFraction;
      const phaseSummary = [...visited.values()].join(" -> ");
      return {
        completed: true,
        simSeconds: runtime.nowSec,
        visited,
        phaseSummary,
        phaseCounts,
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
    phaseCounts,
    shipPropellantKg: runtime.ship.stagePropellantKg,
    tankerPropellantKg: runtime.tanker.stagePropellantKg,
    initialShipPropKg,
    initialTankerPropKg,
  };
}

function main() {
  const result = runNominalE2E(900);
  assert(result.completed, `E2E did not complete in ${result.simSeconds}s`);
  assert(result.visited.has(PHASE.STABILIZE), "Missing stabilize phase");
  assert(result.visited.has(PHASE.PHASING), "Missing phasing phase");
  assert(result.visited.has(PHASE.TRANSFER), "Missing transfer phase");
  assert(result.visited.has(PHASE.VELOCITY), "Missing velocity_match phase");
  assert(result.visited.has(PHASE.HOLD), "Missing hold_point phase");
  assert(result.visited.has(PHASE.FINAL), "Missing final_approach phase");
  assert(result.visited.has(PHASE.LOCK), "Missing docked_lock phase");
  assert(result.visited.has(PHASE.TRANSFERRING), "Missing transferring phase");
  assert(result.visited.has(PHASE.UNDOCKING), "Missing undocking phase");
  assert(result.visited.has(PHASE.COMPLETE), "Missing complete phase");

  assert(
    result.shipPropellantKg > result.initialShipPropKg,
    "Ship propellant did not increase after refuel transfer",
  );
  assert(
    result.tankerPropellantKg < result.initialTankerPropKg,
    "Tanker propellant did not decrease after transfer",
  );
  assert(
    result.shipPropellantKg > result.initialShipPropKg,
    "Ship propellant did not increase after refuel transfer",
  );

  const reserveKg = 0.1 * 1_500_000;
  const availableFromTankerKg = Math.max(0, result.initialTankerPropKg - reserveKg);
  const deficitKg = Math.max(0, result.targetGoalKg - result.initialShipPropKg);
  const expectedTransferKg = Math.min(360_000, availableFromTankerKg, deficitKg);
  const expectedShipKg = result.initialShipPropKg + expectedTransferKg;
  assert(
    Math.abs(result.shipPropellantKg - expectedShipKg) <= 2_500,
    `Unexpected transfer amount (ship=${result.shipPropellantKg.toFixed(0)} expected≈${expectedShipKg.toFixed(0)})`,
  );

  console.log(`PASS refuel-e2e complete in ${result.simSeconds}s`);
  console.log(`PASS refuel-e2e phases: ${result.phaseSummary}`);
  console.log(
    `PASS refuel-e2e mass ship ${result.initialShipPropKg.toFixed(0)} -> ${result.shipPropellantKg.toFixed(0)} kg`
    + ` | tanker ${result.initialTankerPropKg.toFixed(0)} -> ${result.tankerPropellantKg.toFixed(0)} kg`,
  );
}

main();
