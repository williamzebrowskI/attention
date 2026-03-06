import {
  updateFleetTransferGuidance,
  advanceFleetTransferMass,
  ensureFleetTransferState,
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
  orbitalProfileFn = null,
  initializeFn = null,
  maxSimSeconds = 1800,
}) {
  const runtime = makeRuntime(runtimeOptions);
  if (typeof initializeFn === "function") {
    initializeFn(runtime);
  }
  const visited = new Set();
  const phaseFirstSeenSec = new Map();
  const initialShipPropKg = runtime.ship.stagePropellantKg;
  const initialTankerPropKg = runtime.tanker.stagePropellantKg;

  for (let i = 0; i < maxSimSeconds; i += 1) {
    runtime.nowSec += 1;
    const currentPhase = String(runtime.ship.refuelTransferState?.phase || PHASE.IDLE);
    const target = buildTarget(currentPhase, runtime.nowSec, profileFn);
    const orbitalState = typeof orbitalProfileFn === "function"
      ? (orbitalProfileFn(currentPhase, runtime.nowSec, runtime) || runtime.orbitalState)
      : runtime.orbitalState;

    const mode = updateFleetTransferGuidance({
      vehicle: runtime.ship,
      target,
      shipState: runtime.shipState,
      tankerState: runtime.tankerState,
      earthState: runtime.earthState,
      orbitalState,
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
    if (!phaseFirstSeenSec.has(phaseNow)) {
      phaseFirstSeenSec.set(phaseNow, runtime.nowSec);
    }
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
    phaseFirstSeenSec,
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

function firstSeenSec(result, phases = []) {
  let earliest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < phases.length; i += 1) {
    const sec = Number(result.phaseFirstSeenSec.get(phases[i]));
    if (Number.isFinite(sec)) {
      earliest = Math.min(earliest, sec);
    }
  }
  return Number.isFinite(earliest) ? earliest : Number.NaN;
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
      name: "edge_low_periapsis_recovery_then_dock",
      runtimeOptions: { shipPropellantKg: 450_000, tankerPropellantKg: 1_250_000 },
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
        assertFullDockPath(result, "low_periapsis_recovery_then_dock");
        const transferSec = firstSeenSec(result, [PHASE.PHASING, PHASE.TRANSFER, PHASE.VELOCITY]);
        assert(
          Number.isFinite(transferSec) && transferSec > 90,
          `low_periapsis_recovery_then_dock: transfer started too early (${transferSec})`,
        );
      },
    },
    {
      name: "edge_high_apoapsis_trim_then_dock",
      runtimeOptions: { shipPropellantKg: 450_000, tankerPropellantKg: 1_250_000 },
      maxSimSeconds: 2200,
      profileFn: (phase, nowSec) => {
        const base = defaultProfile(phase);
        if ((phase === PHASE.IDLE || phase === PHASE.STABILIZE) && nowSec <= 160) {
          return {
            ...base,
            distanceKm: 24,
            relativeSpeedKmS: 0.018,
            closingSpeedKmS: 0.0022,
            altitudeErrorKm: 2.5,
            radialSpeedErrorKmS: 0.001,
          };
        }
        return base;
      },
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
        assertFullDockPath(result, "high_apoapsis_trim_then_dock");
        assert(
          result.visited.has(PHASE.STABILIZE),
          "high_apoapsis_trim_then_dock: missing stabilize_orbit",
        );
      },
    },
    {
      name: "edge_transfer_gate_low_periapsis_below_tanker",
      runtimeOptions: { shipPropellantKg: 450_000, tankerPropellantKg: 1_250_000 },
      maxSimSeconds: 2400,
      initializeFn: (runtime) => {
        const transfer = ensureFleetTransferState(runtime.ship);
        transfer.phase = PHASE.TRANSFER;
        transfer.phaseEnterSec = 0;
        transfer.targetTankerId = runtime.tanker.id;
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
        assert(result.completed, "transfer_gate_low_periapsis_below_tanker: scenario did not complete");
        assert(result.visited.has(PHASE.TRANSFER), "transfer_gate_low_periapsis_below_tanker: missing transfer");
        assert(result.visited.has(PHASE.VELOCITY), "transfer_gate_low_periapsis_below_tanker: missing velocity_match");
        assert(result.visited.has(PHASE.HOLD), "transfer_gate_low_periapsis_below_tanker: missing hold_point");
        assert(result.visited.has(PHASE.FINAL), "transfer_gate_low_periapsis_below_tanker: missing final_approach");
        assert(result.visited.has(PHASE.LOCK), "transfer_gate_low_periapsis_below_tanker: missing docked_lock");
        assert(result.visited.has(PHASE.TRANSFERRING), "transfer_gate_low_periapsis_below_tanker: missing transferring");
        assert(result.visited.has(PHASE.UNDOCKING), "transfer_gate_low_periapsis_below_tanker: missing undocking");
        assert(result.visited.has(PHASE.COMPLETE), "transfer_gate_low_periapsis_below_tanker: missing complete");
        const velocitySec = Number(result.phaseFirstSeenSec.get(PHASE.VELOCITY));
        assert(
          Number.isFinite(velocitySec) && velocitySec < 900,
          `transfer_gate_low_periapsis_below_tanker: should not remain trapped before velocity match (${velocitySec})`,
        );
      },
    },
    {
      name: "edge_transfer_overshoot_recover_then_dock",
      runtimeOptions: { shipPropellantKg: 450_000, tankerPropellantKg: 1_250_000 },
      maxSimSeconds: 2200,
      initializeFn: (runtime) => {
        const transfer = ensureFleetTransferState(runtime.ship);
        transfer.phase = PHASE.TRANSFER;
        transfer.phaseEnterSec = 0;
        transfer.targetTankerId = runtime.tanker.id;
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
        assert(result.completed, "transfer_overshoot_recover_then_dock: scenario did not complete");
        assert(result.visited.has(PHASE.VELOCITY), "transfer_overshoot_recover_then_dock: missing velocity_match");
        assert(result.visited.has(PHASE.HOLD), "transfer_overshoot_recover_then_dock: missing hold_point");
        assert(result.visited.has(PHASE.FINAL), "transfer_overshoot_recover_then_dock: missing final_approach");
        assert(result.visited.has(PHASE.LOCK), "transfer_overshoot_recover_then_dock: missing docked_lock");
        assert(result.visited.has(PHASE.TRANSFERRING), "transfer_overshoot_recover_then_dock: missing transferring");
        assert(result.visited.has(PHASE.UNDOCKING), "transfer_overshoot_recover_then_dock: missing undocking");
        const velocitySec = Number(result.phaseFirstSeenSec.get(PHASE.VELOCITY));
        assert(
          Number.isFinite(velocitySec) && velocitySec <= 5,
          `transfer_overshoot_recover_then_dock: should brake into velocity_match immediately (${velocitySec})`,
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
    {
      name: "edge_close_range_6km_track_10km_altitude_delta",
      runtimeOptions: { shipPropellantKg: 450_000, tankerPropellantKg: 1_250_000 },
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
          return { ...base, relativePosXKm: 0, relativePosZKm: 0, relativeVelZKmS: 0 };
        }
        return base;
      },
      verify: (result) => {
        assertFullDockPath(result, "close_range_6km_track_10km_altitude_delta");
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
