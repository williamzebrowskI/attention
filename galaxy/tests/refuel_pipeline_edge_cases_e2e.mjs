import {
  updateFleetTransferGuidance,
  advanceFleetTransferMass,
} from "../app/static/js/physics/launch/refuel/fleetTransferPipeline.js";
import { REFUEL_TANKER_CONFIG } from "../app/static/js/physics/launch/refuel/config.js";

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

function makeRuntime({
  shipPropellantKg = 450_000,
  tankerPropellantKg = 1_250_000,
} = {}) {
  const shipStageCapacityKg = 1_450_000;
  const tankerStageCapacityKg = 1_500_000;
  const ship = {
    id: "edge_ship",
    missionId: "orbital_refuel_demo",
    stageIndex: 0,
    stageProfiles: [{ propellantMassKg: shipStageCapacityKg }],
    stageActuator: { directionActual: { x: 0, y: 1, z: 0 } },
    stagePropellantKg: shipPropellantKg,
    propellantKg: shipPropellantKg,
  };
  const tanker = {
    id: "edge_tanker",
    missionId: "orbital_tanker_ops",
    stageIndex: 0,
    stageProfiles: [{ propellantMassKg: tankerStageCapacityKg }],
    stagePropellantKg: tankerPropellantKg,
    propellantKg: tankerPropellantKg,
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

function defaultProfile(phase) {
  if (phase === PHASE.IDLE || phase === PHASE.STABILIZE) {
    return { distanceKm: 18, relativeSpeedKmS: 0.016, closingSpeedKmS: 0.0015, altitudeErrorKm: 1.2, radialSpeedErrorKmS: 0.0008, relativePosXKm: 0 };
  }
  if (phase === PHASE.PHASING) {
    return { distanceKm: 11, relativeSpeedKmS: 0.012, closingSpeedKmS: 0.0011, altitudeErrorKm: 0.9, radialSpeedErrorKmS: 0.0006, relativePosXKm: 0 };
  }
  if (phase === PHASE.TRANSFER) {
    return { distanceKm: 5.5, relativeSpeedKmS: 0.007, closingSpeedKmS: 0.0009, altitudeErrorKm: 0.6, radialSpeedErrorKmS: 0.0004, relativePosXKm: 0 };
  }
  if (phase === PHASE.VELOCITY) {
    return { distanceKm: 0.28, relativeSpeedKmS: 0.0014, closingSpeedKmS: 0.00022, altitudeErrorKm: 0.22, radialSpeedErrorKmS: 0.00015, relativePosXKm: 0 };
  }
  if (phase === PHASE.HOLD) {
    return { distanceKm: 0.11, relativeSpeedKmS: 0.00035, closingSpeedKmS: 0.00007, altitudeErrorKm: 0.1, radialSpeedErrorKmS: 0.00006, relativePosXKm: 0 };
  }
  if (phase === PHASE.FINAL || phase === PHASE.LOCK || phase === PHASE.TRANSFERRING) {
    return { distanceKm: 0.012, relativeSpeedKmS: 0.00005, closingSpeedKmS: 0.00002, altitudeErrorKm: 0.04, radialSpeedErrorKmS: 0.00002, relativePosXKm: 0 };
  }
  return { distanceKm: 0.2, relativeSpeedKmS: 0.001, closingSpeedKmS: 0.0002, altitudeErrorKm: 0.2, radialSpeedErrorKmS: 0.0001, relativePosXKm: 0 };
}

function buildTarget(phase, nowSec, profileFn) {
  const profile = (typeof profileFn === "function" ? profileFn(phase, nowSec) : null) || defaultProfile(phase);
  const distanceKm = Math.max(0.001, Number(profile.distanceKm) || 0.001);
  const altitudeErrorKm = Math.max(0, Number(profile.altitudeErrorKm) || 0);
  const radialSpeedErrorKmS = Number(profile.radialSpeedErrorKmS) || 0;
  const closingSpeedKmS = Number(profile.closingSpeedKmS) || 0;
  const relativeSpeedKmS = Math.max(0, Number(profile.relativeSpeedKmS) || 0);
  const relPosY = Math.sign(closingSpeedKmS || 1) * Math.max(0.001, distanceKm);
  const relPosXCandidate = Number(profile.relativePosXKm);
  const relPosZCandidate = Number(profile.relativePosZKm);
  const relVelZCandidate = Number(profile.relativeVelZKmS);
  const relPosX = Number.isFinite(relPosXCandidate) ? relPosXCandidate : altitudeErrorKm;
  const relPosZ = Number.isFinite(relPosZCandidate) ? relPosZCandidate : 0;
  const relVelZ = Number.isFinite(relVelZCandidate) ? relVelZCandidate : 0;
  return {
    tankerId: "edge_tanker",
    distanceKm,
    relativeSpeedKmS,
    closingSpeedKmS,
    altitudeErrorKm,
    radialSpeedErrorKmS,
    relativePositionKm: { x: relPosX, y: relPosY, z: relPosZ },
    relativeVelocityKmS: {
      x: radialSpeedErrorKmS,
      y: -Math.abs(closingSpeedKmS),
      z: relVelZ,
    },
  };
}

function runScenario({
  name,
  runtimeOptions = {},
  profileFn = null,
  maxSimSeconds = 1800,
}) {
  const runtime = makeRuntime(runtimeOptions);
  const visited = new Set();
  const initialShipPropKg = runtime.ship.stagePropellantKg;
  const initialTankerPropKg = runtime.tanker.stagePropellantKg;

  for (let i = 0; i < maxSimSeconds; i += 1) {
    runtime.nowSec += 1;
    const currentPhase = String(runtime.ship.refuelTransferState?.phase || PHASE.IDLE);
    const target = buildTarget(currentPhase, runtime.nowSec, profileFn);

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
      break;
    }
  }

  const targetGoalKg = runtime.ship.stageProfiles[0].propellantMassKg * runtime.targetFillFraction;
  return {
    name,
    completed: String(runtime.ship.refuelTransferState?.phase || "") === PHASE.COMPLETE,
    simSeconds: runtime.nowSec,
    visited,
    finalPhase: String(runtime.ship.refuelTransferState?.phase || PHASE.IDLE),
    shipPropellantKg: runtime.ship.stagePropellantKg,
    tankerPropellantKg: runtime.tanker.stagePropellantKg,
    targetGoalKg,
    initialShipPropKg,
    initialTankerPropKg,
  };
}

function assertFullDockPath(result, label) {
  assert(result.completed, `${label}: scenario did not complete`);
  assert(result.visited.has(PHASE.STABILIZE), `${label}: missing stabilize_orbit`);
  assert(result.visited.has(PHASE.VELOCITY), `${label}: missing velocity_match`);
  assert(result.visited.has(PHASE.HOLD), `${label}: missing hold_point`);
  assert(result.visited.has(PHASE.FINAL), `${label}: missing final_approach`);
  assert(result.visited.has(PHASE.LOCK), `${label}: missing docked_lock`);
  assert(result.visited.has(PHASE.TRANSFERRING), `${label}: missing transferring`);
  assert(result.visited.has(PHASE.UNDOCKING), `${label}: missing undocking`);
  assert(result.visited.has(PHASE.COMPLETE), `${label}: missing complete`);
}

function main() {
  const cases = [
    {
      name: "edge_ship_already_full",
      runtimeOptions: { shipPropellantKg: 1_300_000, tankerPropellantKg: 1_250_000 },
      maxSimSeconds: 120,
      verify: (result) => {
        assert(result.completed, "already_full: should complete immediately");
        assert(result.visited.has(PHASE.COMPLETE), "already_full: missing complete");
        assert(!result.visited.has(PHASE.TRANSFERRING), "already_full: should not enter transferring");
        assert(
          Math.abs(result.shipPropellantKg - result.initialShipPropKg) <= 1e-6,
          "already_full: ship propellant should not change",
        );
      },
    },
    {
      name: "edge_tanker_reserve_limited",
      runtimeOptions: { shipPropellantKg: 450_000, tankerPropellantKg: 170_000 },
      maxSimSeconds: 1800,
      verify: (result) => {
        assertFullDockPath(result, "reserve_limited");
        const expectedTransferKg = 20_000;
        const expectedShipKg = result.initialShipPropKg + expectedTransferKg;
        assert(
          Math.abs(result.shipPropellantKg - expectedShipKg) <= 3_000,
          `reserve_limited: ship propellant unexpected (${result.shipPropellantKg.toFixed(0)})`,
        );
        assert(
          result.tankerPropellantKg >= 149_500 && result.tankerPropellantKg <= 151_500,
          `reserve_limited: tanker should end near reserve, got ${result.tankerPropellantKg.toFixed(0)} kg`,
        );
      },
    },
    {
      name: "edge_abort_then_recover",
      runtimeOptions: { shipPropellantKg: 450_000, tankerPropellantKg: 1_250_000 },
      maxSimSeconds: 2200,
      profileFn: (phase, nowSec) => {
        const base = defaultProfile(phase);
        if ((phase === PHASE.HOLD || phase === PHASE.FINAL) && nowSec <= 120) {
          return {
            ...base,
            distanceKm: 0.14,
            relativeSpeedKmS: 0.014,
            closingSpeedKmS: 0.009,
            altitudeErrorKm: 0.5,
            radialSpeedErrorKmS: 0.003,
          };
        }
        return base;
      },
      verify: (result) => {
        assertFullDockPath(result, "abort_then_recover");
        assert(result.visited.has(PHASE.ABORTING), "abort_then_recover: should hit aborting at least once");
      },
    },
    {
      name: "edge_off_plane_3d_alignment",
      runtimeOptions: { shipPropellantKg: 450_000, tankerPropellantKg: 1_250_000 },
      maxSimSeconds: 1900,
      profileFn: (phase, nowSec) => {
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
          return { ...base, relativePosXKm: 0, relativePosZKm: 0, relativeVelZKmS: 0 };
        }
        return { ...base, relativePosXKm: 0.12, relativePosZKm: 0.2, relativeVelZKmS: -0.00003 };
      },
      verify: (result) => {
        assertFullDockPath(result, "off_plane_3d_alignment");
      },
    },
  ];

  const results = cases.map((scenario) => {
    const result = runScenario(scenario);
    try {
      scenario.verify(result);
    } catch (error) {
      const details = `DEBUG ${scenario.name} phase=${result.finalPhase} t=${result.simSeconds}s `
        + `ship=${result.shipPropellantKg.toFixed(0)} tanker=${result.tankerPropellantKg.toFixed(0)} `
        + `visited=[${[...result.visited.values()].join("->")}]`;
      console.log(details);
      throw error;
    }
    return result;
  });

  for (const result of results) {
    console.log(
      `PASS ${result.name} phase=${result.finalPhase} t=${result.simSeconds}s `
      + `ship=${result.shipPropellantKg.toFixed(0)} tanker=${result.tankerPropellantKg.toFixed(0)} `
      + `visited=[${[...result.visited.values()].join("->")}]`,
    );
  }
  console.log(`PASS refuel edge-case suite (${results.length} scenarios)`);
}

main();
