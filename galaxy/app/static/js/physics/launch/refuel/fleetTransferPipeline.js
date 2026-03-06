import {
  add,
  angleBetweenRadians,
  clamp,
  degrees,
  normalize,
  scale,
  subtract,
} from "../launchMath.js";
import { REFUEL_TANKER_CONFIG } from "./config.js";
import { computeHillRendezvousCommand } from "./relativeMotionGuidance.js";

const FLEET_TRANSFER_PHASES = Object.freeze({
  IDLE: "idle",
  STABILIZE_ORBIT: "stabilize_orbit",
  PHASING: "phasing",
  TRANSFER: "transfer",
  VELOCITY_MATCH: "velocity_match",
  HOLD_POINT: "hold_point",
  FINAL_APPROACH: "final_approach",
  DOCKED_LOCK: "docked_lock",
  TRANSFERRING: "transferring",
  UNDOCKING: "undocking",
  ABORTING: "aborting",
  COMPLETE: "complete",
});

function finiteNumber(value, fallback = Number.NaN) {
  if (value === null || value === undefined) {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function stageCapacityKgForVehicle(vehicle) {
  const stageProfiles = Array.isArray(vehicle?.stageProfiles) ? vehicle.stageProfiles : [];
  const stageIndex = Math.max(
    0,
    Math.min(stageProfiles.length - 1, Number(vehicle?.stageIndex) || 0),
  );
  return Math.max(0, Number(stageProfiles[stageIndex]?.propellantMassKg) || 0);
}

function composeMode(baseMode, suffix) {
  const base = String(baseMode || "").trim() || "navsys:orbital-refuel-await-target";
  const tag = String(suffix || "").trim();
  if (!tag) {
    return base;
  }
  if (base.includes(tag)) {
    return base;
  }
  return `${base}:${tag}`;
}

function emitTransferPhaseEvent(emitLaunchEvent, vehicle, fromPhase, toPhase, details = {}) {
  if (typeof emitLaunchEvent !== "function" || !vehicle || fromPhase === toPhase) {
    return;
  }
  emitLaunchEvent("fleet_refuel_transfer_phase_changed", {
    shipId: vehicle.id,
    missionId: vehicle.missionId,
    fromPhase,
    toPhase,
    ...details,
  });
}

export function ensureFleetTransferState(vehicle) {
  if (!vehicle || typeof vehicle !== "object") {
    return null;
  }
  if (!vehicle.refuelTransferState || typeof vehicle.refuelTransferState !== "object") {
    vehicle.refuelTransferState = {
      phase: FLEET_TRANSFER_PHASES.IDLE,
      targetTankerId: "",
      holdPointStableSec: 0,
      dockStableSec: 0,
      lockStableSec: 0,
      orbitStableSec: 0,
      abortRemainingSec: 0,
      undockRemainingSec: 0,
      transferPlannedKg: 0,
      transferRemainingKg: 0,
      transferTransferredKg: 0,
      transferRateKgS: 0,
      transferProgress: 0,
      shipAlignmentDeg: null,
      tankerAlignmentDeg: null,
      corridorAlignmentDeg: null,
      radialDampActive: false,
      radialDampHoldSec: 0,
      phaseEnterSec: 0,
      lastDistanceKm: null,
      lastRelativeSpeedKmS: null,
      lastClosingSpeedKmS: null,
      approachDesiredClosingKmS: null,
      approachClosingKmS: null,
      approachOrbitalRateRadS: null,
      phaseBestDistanceKm: null,
      overshootRecoveryActive: false,
      overshootRecoveryStableSec: 0,
      overshootRecoveryDistanceKm: null,
      lastAction: "",
      lastActionTimeSec: 0,
      targetFillFraction: 0,
    };
  }
  return vehicle.refuelTransferState;
}

export function resetFleetTransferState(vehicle) {
  const transfer = ensureFleetTransferState(vehicle);
  if (!transfer) {
    return;
  }
  transfer.phase = FLEET_TRANSFER_PHASES.IDLE;
  transfer.targetTankerId = "";
  transfer.holdPointStableSec = 0;
  transfer.dockStableSec = 0;
  transfer.lockStableSec = 0;
  transfer.orbitStableSec = 0;
  transfer.abortRemainingSec = 0;
  transfer.undockRemainingSec = 0;
  transfer.transferPlannedKg = 0;
  transfer.transferRemainingKg = 0;
  transfer.transferTransferredKg = 0;
  transfer.transferRateKgS = 0;
  transfer.transferProgress = 0;
  transfer.shipAlignmentDeg = null;
  transfer.tankerAlignmentDeg = null;
  transfer.corridorAlignmentDeg = null;
  transfer.radialDampActive = false;
  transfer.radialDampHoldSec = 0;
  transfer.phaseEnterSec = 0;
  transfer.lastDistanceKm = null;
  transfer.lastRelativeSpeedKmS = null;
  transfer.lastClosingSpeedKmS = null;
  transfer.approachDesiredClosingKmS = null;
  transfer.approachClosingKmS = null;
  transfer.approachOrbitalRateRadS = null;
  transfer.phaseBestDistanceKm = null;
  transfer.overshootRecoveryActive = false;
  transfer.overshootRecoveryStableSec = 0;
  transfer.overshootRecoveryDistanceKm = null;
  transfer.lastAction = "";
  transfer.lastActionTimeSec = 0;
  transfer.targetFillFraction = 0;
}

function clearOvershootRecoveryState(transfer) {
  if (!transfer || typeof transfer !== "object") {
    return;
  }
  transfer.overshootRecoveryActive = false;
  transfer.overshootRecoveryStableSec = 0;
  transfer.overshootRecoveryDistanceKm = null;
}

function activateOvershootRecoveryState(transfer, safeNow, distanceKm, action = "overshoot_recovery_engaged") {
  if (!transfer || typeof transfer !== "object") {
    return;
  }
  transfer.overshootRecoveryActive = true;
  transfer.overshootRecoveryStableSec = 0;
  transfer.overshootRecoveryDistanceKm = finiteNumber(distanceKm, null);
  transfer.lastAction = action;
  transfer.lastActionTimeSec = safeNow;
}

function deriveAlignmentDeg({
  shipForward = null,
  tankerForward = null,
  shipToTankerDirection = null,
  fallbackForward = null,
} = {}) {
  const shipAxis = normalize(shipForward, normalize(fallbackForward, { x: 0, y: 1, z: 0 }));
  const tankerAxis = normalize(tankerForward, shipAxis);
  const lineDirection = normalize(shipToTankerDirection, tankerAxis);
  const shipAlignmentDeg = degrees(angleBetweenRadians(shipAxis, tankerAxis));
  const tankerAlignmentDeg = shipAlignmentDeg;
  const corridorAlignmentDeg = degrees(angleBetweenRadians(lineDirection, tankerAxis));
  return {
    shipAlignmentDeg: finiteNumber(shipAlignmentDeg, 180),
    tankerAlignmentDeg: finiteNumber(tankerAlignmentDeg, 180),
    corridorAlignmentDeg: finiteNumber(corridorAlignmentDeg, 180),
  };
}

function phaseWithMode({
  phase,
  guidanceMode,
  requestedThrottle,
  desiredDirection,
  directionFallback,
}) {
  const safeDirection = normalize(desiredDirection, directionFallback);
  if (phase === FLEET_TRANSFER_PHASES.STABILIZE_ORBIT) {
    return {
      requestedThrottle: clamp(Number(requestedThrottle) || 0, 0, 1),
      desiredDirection: safeDirection,
      guidanceMode: String(guidanceMode || "navsys:orbital-refuel-orbit-stabilize"),
      lockTarget: true,
    };
  }
  if (phase === FLEET_TRANSFER_PHASES.PHASING) {
    return {
      requestedThrottle: clamp(Number(requestedThrottle) || 0, 0, 1),
      desiredDirection: safeDirection,
      guidanceMode: "navsys:orbital-refuel-coelliptic-phasing",
      lockTarget: true,
    };
  }
  if (phase === FLEET_TRANSFER_PHASES.TRANSFER) {
    return {
      requestedThrottle: clamp(Number(requestedThrottle) || 0, 0, 1),
      desiredDirection: safeDirection,
      guidanceMode: String(guidanceMode || "navsys:orbital-refuel-transfer-burn"),
      lockTarget: true,
    };
  }
  if (phase === FLEET_TRANSFER_PHASES.VELOCITY_MATCH) {
    const velocityMode = (Number(requestedThrottle) || 0) > 1e-6
      ? "navsys:orbital-refuel-velocity-match-brake"
      : "navsys:orbital-refuel-velocity-match-coast";
    return {
      requestedThrottle: clamp(Number(requestedThrottle) || 0, 0, 1),
      desiredDirection: safeDirection,
      guidanceMode: String(guidanceMode || velocityMode),
      lockTarget: true,
    };
  }
  if (phase === FLEET_TRANSFER_PHASES.HOLD_POINT) {
    const holdThrottle = clamp(Number(requestedThrottle) || 0, 0, 1);
    return {
      requestedThrottle: holdThrottle,
      desiredDirection: safeDirection,
      guidanceMode: holdThrottle > 1e-6
        ? composeMode(guidanceMode, "orbital-refuel-hold-point-terminal-burn")
        : composeMode(guidanceMode, "orbital-refuel-hold-point"),
      lockTarget: true,
    };
  }
  if (phase === FLEET_TRANSFER_PHASES.FINAL_APPROACH) {
    return {
      requestedThrottle: 0,
      desiredDirection: safeDirection,
      guidanceMode: composeMode(guidanceMode, "orbital-refuel-final-approach"),
      lockTarget: true,
    };
  }
  if (phase === FLEET_TRANSFER_PHASES.DOCKED_LOCK) {
    return {
      requestedThrottle: 0,
      desiredDirection: safeDirection,
      guidanceMode: "navsys:orbital-refuel-lock",
      lockTarget: true,
    };
  }
  if (phase === FLEET_TRANSFER_PHASES.TRANSFERRING) {
    return {
      requestedThrottle: 0,
      desiredDirection: safeDirection,
      guidanceMode: "navsys:orbital-refuel-transferring",
      lockTarget: true,
    };
  }
  if (phase === FLEET_TRANSFER_PHASES.UNDOCKING) {
    return {
      requestedThrottle: 0,
      desiredDirection: scale(safeDirection, -1),
      guidanceMode: "navsys:orbital-refuel-undocking",
      lockTarget: true,
    };
  }
  if (phase === FLEET_TRANSFER_PHASES.ABORTING) {
    return {
      // Abort near docking should be RCS-led separation, not a main-engine burn.
      requestedThrottle: 0,
      desiredDirection: scale(safeDirection, -1),
      guidanceMode: "navsys:orbital-refuel-abort-brake:rcs-only",
      lockTarget: true,
    };
  }
  return {
    requestedThrottle,
    desiredDirection: safeDirection,
    guidanceMode,
    lockTarget: false,
  };
}

function computeApproachGuidance({
  target = null,
  prograde = null,
  directionToTarget = null,
  shipRelativePositionKm = null,
  shipRelativeVelocityKmS = null,
} = {}) {
  const guidance = computeHillRendezvousCommand({
    targetRelativePositionKm: target?.relativePositionKm || directionToTarget,
    targetRelativeVelocityKmS: target?.relativeVelocityKmS || {
      x: 0,
      y: 0,
      z: 0,
    },
    shipRelativePositionKm,
    shipRelativeVelocityKmS,
    fallbackPrograde: prograde,
  });
  if (guidance) {
    return guidance;
  }
  const fallbackDirection = normalize(directionToTarget, prograde || { x: 0, y: 1, z: 0 });
  return {
    requestedThrottle: 0,
    desiredDirection: fallbackDirection,
    guidanceMode: "navsys:orbital-refuel-await-target",
  };
}

export function updateFleetTransferGuidance({
  vehicle,
  target = null,
  shipState = null,
  tankerState = null,
  earthState = null,
  orbitalState = null,
  prograde = null,
  requestedThrottle = 0,
  desiredDirection = null,
  guidanceMode = "navsys:orbital-refuel-await-target",
  safeDtSeconds = 0,
  nowSec = 0,
  targetFillFraction = REFUEL_TANKER_CONFIG.targetFillFraction,
  stagePropellantKg = 0,
  stageCapacityKg = 0,
  emitLaunchEvent = null,
} = {}) {
  const transfer = ensureFleetTransferState(vehicle);
  if (!transfer) {
    return {
      requestedThrottle: clamp(Number(requestedThrottle) || 0, 0, 1),
      desiredDirection: normalize(desiredDirection, prograde || { x: 0, y: 1, z: 0 }),
      guidanceMode: String(guidanceMode || "navsys:orbital-refuel-await-target"),
      lockTarget: false,
      state: null,
    };
  }

  const safeDt = Math.max(0, Number(safeDtSeconds) || 0);
  const safeNow = Math.max(0, Number(nowSec) || 0);
  if (!Number.isFinite(Number(transfer.phaseEnterSec)) || Number(transfer.phaseEnterSec) <= 0) {
    transfer.phaseEnterSec = safeNow;
  }
  transfer.targetFillFraction = clamp(Number(targetFillFraction) || 0.88, 0.1, 1);

  const stageGoalKg = Math.max(0, Number(stageCapacityKg) || 0) * transfer.targetFillFraction;
  const stageCurrentKg = Math.max(0, Number(stagePropellantKg) || 0);
  const stageDeficitKg = Math.max(0, stageGoalKg - stageCurrentKg);

  const hasTrack = Boolean(
    target
    && tankerState
    && shipState
    && earthState
    && Number.isFinite(Number(target.distanceKm))
    && Number.isFinite(Number(target.relativeSpeedKmS)),
  );
  if (!hasTrack) {
    const wasActive = transfer.phase !== FLEET_TRANSFER_PHASES.IDLE;
    if (transfer.phase !== FLEET_TRANSFER_PHASES.TRANSFERRING && transfer.phase !== FLEET_TRANSFER_PHASES.UNDOCKING) {
      const previous = transfer.phase;
      transfer.phase = stageDeficitKg <= 1e-3 ? FLEET_TRANSFER_PHASES.COMPLETE : FLEET_TRANSFER_PHASES.IDLE;
      transfer.targetTankerId = "";
      transfer.holdPointStableSec = 0;
      transfer.dockStableSec = 0;
      transfer.lockStableSec = 0;
      transfer.orbitStableSec = 0;
      transfer.abortRemainingSec = 0;
      transfer.radialDampActive = false;
      transfer.radialDampHoldSec = 0;
      clearOvershootRecoveryState(transfer);
      transfer.phaseEnterSec = safeNow;
      if (wasActive || previous !== transfer.phase) {
        emitTransferPhaseEvent(
          emitLaunchEvent,
          vehicle,
          previous,
          transfer.phase,
          { reason: "target-track-lost" },
        );
      }
    }
    return phaseWithMode({
      phase: transfer.phase,
      guidanceMode: "navsys:orbital-refuel-await-target",
      requestedThrottle: 0,
      desiredDirection: desiredDirection || prograde,
      directionFallback: prograde || { x: 0, y: 1, z: 0 },
      state: transfer,
    });
  }

  const targetId = String(target.tankerId || "").trim();
  if (targetId) {
    transfer.targetTankerId = targetId;
  }
  const directionToTarget = normalize(target.relativePositionKm, prograde || { x: 0, y: 1, z: 0 });
  const shipForward = normalize(
    vehicle?.stageActuator?.directionActual || desiredDirection || prograde,
    prograde || { x: 0, y: 1, z: 0 },
  );
  const tankerEarthVelocity = subtract(
    tankerState.velocity || { x: 0, y: 0, z: 0 },
    earthState.velocity || { x: 0, y: 0, z: 0 },
  );
  const tankerForward = normalize(tankerEarthVelocity, shipForward);
  const alignment = deriveAlignmentDeg({
    shipForward,
    tankerForward,
    shipToTankerDirection: directionToTarget,
    fallbackForward: prograde,
  });
  const closeApproachAttitudeDecoupled = (
    transfer.phase === FLEET_TRANSFER_PHASES.HOLD_POINT
    || transfer.phase === FLEET_TRANSFER_PHASES.FINAL_APPROACH
    || transfer.phase === FLEET_TRANSFER_PHASES.DOCKED_LOCK
    || transfer.phase === FLEET_TRANSFER_PHASES.TRANSFERRING
    || transfer.phase === FLEET_TRANSFER_PHASES.UNDOCKING
    || transfer.phase === FLEET_TRANSFER_PHASES.ABORTING
  );
  const shipAlignmentForGateDeg = closeApproachAttitudeDecoupled
    ? Math.min(alignment.shipAlignmentDeg, 3)
    : alignment.shipAlignmentDeg;
  const tankerAlignmentForGateDeg = closeApproachAttitudeDecoupled
    ? Math.min(alignment.tankerAlignmentDeg, 3)
    : alignment.tankerAlignmentDeg;
  const corridorAlignmentForGateDeg = Math.min(
    alignment.corridorAlignmentDeg,
    Math.abs(180 - alignment.corridorAlignmentDeg),
  );
  transfer.shipAlignmentDeg = shipAlignmentForGateDeg;
  transfer.tankerAlignmentDeg = tankerAlignmentForGateDeg;
  transfer.corridorAlignmentDeg = corridorAlignmentForGateDeg;

  const distanceKm = Math.max(0, Number(target.distanceKm) || 0);
  const relativeSpeedKmS = Math.max(0, Number(target.relativeSpeedKmS) || 0);
  const closingSpeedKmS = finiteNumber(target.closingSpeedKmS, 0);
  const previousDistanceKm = finiteNumber(transfer.lastDistanceKm, Number.NaN);
  const previousClosingSpeedKmS = finiteNumber(transfer.lastClosingSpeedKmS, Number.NaN);
  const previousPhaseBestDistanceKm = finiteNumber(transfer.phaseBestDistanceKm, Number.NaN);
  const shipRelativePositionKm = subtract(
    shipState.position || { x: 0, y: 0, z: 0 },
    earthState.position || { x: 0, y: 0, z: 0 },
  );
  const shipRelativeVelocityKmS = subtract(
    shipState.velocity || { x: 0, y: 0, z: 0 },
    earthState.velocity || { x: 0, y: 0, z: 0 },
  );
  transfer.lastDistanceKm = distanceKm;
  transfer.lastRelativeSpeedKmS = relativeSpeedKmS;
  transfer.lastClosingSpeedKmS = closingSpeedKmS;
  transfer.phaseBestDistanceKm = Number.isFinite(previousPhaseBestDistanceKm)
    ? Math.min(Number(previousPhaseBestDistanceKm), distanceKm)
    : distanceKm;
  const localUp = normalize(shipRelativePositionKm, prograde || { x: 0, y: 0, z: 1 });

  const holdDistanceKm = Math.max(
    1.0,
    Number(REFUEL_TANKER_CONFIG.dockHoldPointDistanceKm) || 0.065,
  );
  const holdSpeedKmS = Math.max(0.0005, Number(REFUEL_TANKER_CONFIG.dockHoldPointMaxRelativeSpeedKmS) || 0.000085);
  const holdStableRequiredSec = Math.max(4, Number(REFUEL_TANKER_CONFIG.dockHoldPointStableSec) || 10);
  const dockDistanceKm = Math.max(0.005, Number(REFUEL_TANKER_CONFIG.dockDistanceKm) || 0.014);
  const dockSpeedKmS = Math.max(0.00002, Number(REFUEL_TANKER_CONFIG.dockMaxRelativeSpeedKmS) || 0.000045);
  const dockStableRequiredSec = Math.max(2, Number(REFUEL_TANKER_CONFIG.dockStableSeconds) || 8);
  const abortDistanceKm = Math.max(
    dockDistanceKm * 2,
    Number(REFUEL_TANKER_CONFIG.dockAbortDistanceKm) || 0.22,
    holdDistanceKm * 1.4,
  );
  const abortRelativeSpeedKmS = Math.max(
    dockSpeedKmS * 2,
    Number(REFUEL_TANKER_CONFIG.dockAbortRelativeSpeedKmS) || 0.00014,
  );
  const abortAttitudeDeg = Math.max(12, Number(REFUEL_TANKER_CONFIG.dockAbortAttitudeErrorDeg) || 16);
  const shipAlignGateDeg = Math.max(2, Number(REFUEL_TANKER_CONFIG.dockShipAttitudeMaxErrorDeg) || 9);
  const tankerAlignGateDeg = Math.max(2, Number(REFUEL_TANKER_CONFIG.dockTankerAttitudeMaxErrorDeg) || 8);
  const stabilizePeriapsisMinKm = Math.max(
    120,
    Number(REFUEL_TANKER_CONFIG.phaseStabilizePeriapsisMinKm) || 145,
  );
  const stabilizeApoapsisMaxKm = Math.max(
    stabilizePeriapsisMinKm + 10,
    Number(REFUEL_TANKER_CONFIG.phaseStabilizeApoapsisMaxKm) || 230,
  );
  const stabilizeAltitudeErrorKm = Math.max(
    2,
    Number(REFUEL_TANKER_CONFIG.phaseStabilizeAltitudeErrorKm) || 10,
  );
  const stabilizeRadialSpeedErrorKmS = Math.max(
    0.0005,
    Number(REFUEL_TANKER_CONFIG.phaseStabilizeRadialSpeedErrorKmS) || 0.0035,
  );
  const stabilizeStableSecRequired = Math.max(
    6,
    Number(REFUEL_TANKER_CONFIG.phaseStabilizeStableSec) || 24,
  );
  const stabilizeRadialDampEnterFactor = Math.max(
    1.05,
    Number(REFUEL_TANKER_CONFIG.phaseStabilizeRadialDampEnterFactor) || 1.9,
  );
  const stabilizeRadialDampExitFactor = clamp(
    Number(REFUEL_TANKER_CONFIG.phaseStabilizeRadialDampExitFactor) || 1.2,
    0.25,
    Math.max(0.95, stabilizeRadialDampEnterFactor - 0.05),
  );
  const stabilizeRadialDampMinHoldSec = Math.max(
    0,
    Number(REFUEL_TANKER_CONFIG.phaseStabilizeRadialDampMinHoldSec) || 6,
  );
  const phasingDistanceKm = Math.max(
    holdDistanceKm * 10,
    Number(REFUEL_TANKER_CONFIG.phasePhasingDistanceKm) || 110,
  );
  const transferDistanceKm = Math.max(
    holdDistanceKm * 3,
    Number(REFUEL_TANKER_CONFIG.phaseTransferDistanceKm) || 18,
  );
  const transferMaxRelativeSpeedKmS = Math.max(
    0.02,
    Number(REFUEL_TANKER_CONFIG.phaseTransferMaxRelativeSpeedKmS) || 0.2,
  );
  const velocityMatchRelativeSpeedKmS = Math.max(
    0.001,
    Number(REFUEL_TANKER_CONFIG.phaseVelocityMatchRelativeSpeedKmS) || 0.02,
  );
  const phasingThrottleMax = clamp(
    Number(REFUEL_TANKER_CONFIG.phasePhasingThrottleMax) || 0.008,
    0.001,
    0.04,
  );
  const transferThrottleMax = clamp(
    Number(REFUEL_TANKER_CONFIG.phaseTransferThrottleMax) || 0.006,
    0.001,
    0.03,
  );
  const velocityMatchThrottleMax = clamp(
    Number(REFUEL_TANKER_CONFIG.phaseVelocityMatchThrottleMax) || 0.003,
    0.0005,
    0.02,
  );
  const periapsisKm = finiteNumber(orbitalState?.periapsisKm, Number.NaN);
  const apoapsisKm = finiteNumber(orbitalState?.apoapsisKm, Number.NaN);
  const orbitalRadialSpeedKmS = finiteNumber(orbitalState?.radialSpeedKmS, Number.NaN);
  const timeToApoapsisSec = finiteNumber(orbitalState?.timeToApoapsisSec, Number.NaN);
  const timeToPeriapsisSec = finiteNumber(orbitalState?.timeToPeriapsisSec, Number.NaN);
  const orbitalPeriodSec = finiteNumber(orbitalState?.orbitalPeriodSec, Number.NaN);
  const altitudeErrorKm = Math.abs(finiteNumber(target.altitudeErrorKm, Number.NaN));
  const radialSpeedErrorKmS = Math.abs(finiteNumber(target.radialSpeedErrorKmS, Number.NaN));
  const stabilizeApsisWindowSec = clamp(
    Number(REFUEL_TANKER_CONFIG.phaseStabilizeApsisWindowSec) || 220,
    40,
    900,
  );
  const stabilizePeriEmergencyMarginKm = Math.max(
    2,
    Number(REFUEL_TANKER_CONFIG.phaseStabilizePeriapsisEmergencyMarginKm) || 10,
  );
  const stabilizeApoEmergencyFactor = Math.max(
    1.1,
    Number(REFUEL_TANKER_CONFIG.phaseStabilizeApoapsisEmergencyFactor) || 1.7,
  );
  const stabilizeCloseRangeBypassDistanceKm = Math.max(
    transferDistanceKm,
    Number(REFUEL_TANKER_CONFIG.phaseStabilizeCloseRangeBypassDistanceKm) || 12,
  );
  const stabilizeCloseRangePeriapsisMinKm = Math.max(
    120,
    Number(REFUEL_TANKER_CONFIG.phaseStabilizeCloseRangePeriapsisMinKm) || 136,
  );
  const stabilizeCloseRangeRelativeSpeedMaxKmS = Math.max(
    velocityMatchRelativeSpeedKmS,
    Number(REFUEL_TANKER_CONFIG.phaseStabilizeCloseRangeRelativeSpeedMaxKmS) || 0.04,
  );
  const stabilizeCloseRangeClosingMaxKmS = Math.max(
    velocityMatchRelativeSpeedKmS,
    Number(REFUEL_TANKER_CONFIG.phaseStabilizeCloseRangeClosingMaxKmS) || 0.03,
  );
  const strictSequentialProfile = REFUEL_TANKER_CONFIG.strictSequentialRendezvousProfile !== false;
  const stabilizeCloseRangeBypassEnabled = strictSequentialProfile
    ? Boolean(REFUEL_TANKER_CONFIG.phaseStabilizeCloseRangeBypassEnabled)
    : true;
  const phaseTransitionMinDwellStabilizeSec = Math.max(
    0,
    Number(REFUEL_TANKER_CONFIG.phaseTransitionMinDwellStabilizeSec) || 12,
  );
  const phaseTransitionMinDwellPhasingSec = Math.max(
    0,
    Number(REFUEL_TANKER_CONFIG.phaseTransitionMinDwellPhasingSec) || 20,
  );
  const phaseTransitionMinDwellTransferSec = Math.max(
    0,
    Number(REFUEL_TANKER_CONFIG.phaseTransitionMinDwellTransferSec) || 16,
  );
  const phaseTransitionMinDwellVelocitySec = Math.max(
    0,
    Number(REFUEL_TANKER_CONFIG.phaseTransitionMinDwellVelocitySec) || 12,
  );
  const phaseTransitionMinDwellHoldSec = Math.max(
    0,
    Number(REFUEL_TANKER_CONFIG.phaseTransitionMinDwellHoldSec) || 8,
  );
  const stabilizeForceAdvanceAfterSec = Math.max(
    0,
    Number(REFUEL_TANKER_CONFIG.phaseStabilizeForceAdvanceAfterSec) || 240,
  );
  const stabilizeForceAdvancePeriapsisMinKm = Math.max(
    120,
    Number(REFUEL_TANKER_CONFIG.phaseStabilizeForceAdvancePeriapsisMinKm) || 132,
  );
  const stabilizeForceAdvanceApoapsisMaxKm = Math.max(
    stabilizeForceAdvancePeriapsisMinKm + 10,
    Number(REFUEL_TANKER_CONFIG.phaseStabilizeForceAdvanceApoapsisMaxKm) || 400,
  );
  const stabilizeForceAdvanceMaxDistanceKm = Math.max(
    transferDistanceKm,
    Number(REFUEL_TANKER_CONFIG.phaseStabilizeForceAdvanceMaxDistanceKm) || 140,
  );
  const stabilizeForceAdvanceMaxRelativeSpeedKmS = Math.max(
    velocityMatchRelativeSpeedKmS,
    Number(REFUEL_TANKER_CONFIG.phaseStabilizeForceAdvanceMaxRelativeSpeedKmS) || 0.12,
  );
  const phasingToTransferDistanceKm = Math.max(
    transferDistanceKm,
    Number(REFUEL_TANKER_CONFIG.phasePhasingToTransferDistanceKm) || 45,
  );
  const phasingToTransferRelativeSpeedKmS = Math.max(
    velocityMatchRelativeSpeedKmS,
    Number(REFUEL_TANKER_CONFIG.phasePhasingToTransferRelativeSpeedKmS) || 0.12,
  );
  const transferToVelocityDistanceKm = Math.max(
    holdDistanceKm * 2.4,
    Number(REFUEL_TANKER_CONFIG.phaseTransferToVelocityDistanceKm) || transferDistanceKm,
  );
  const transferToVelocityRelativeSpeedKmS = Math.max(
    velocityMatchRelativeSpeedKmS,
    Number(REFUEL_TANKER_CONFIG.phaseTransferToVelocityRelativeSpeedKmS) || 0.04,
  );
  const overshootDetectDistanceKm = Math.max(
    transferToVelocityDistanceKm,
    Number(REFUEL_TANKER_CONFIG.phaseOvershootDetectDistanceKm) || 120,
  );
  const overshootMinRangeIncreaseKm = Math.max(
    0.05,
    Number(REFUEL_TANKER_CONFIG.phaseOvershootMinRangeIncreaseKm) || 0.15,
  );
  const overshootBestDistanceMarginKm = Math.max(
    0.05,
    Number(REFUEL_TANKER_CONFIG.phaseOvershootBestDistanceMarginKm) || 0.5,
  );
  const overshootRelativeSpeedMinKmS = Math.max(
    holdSpeedKmS * 2,
    Number(REFUEL_TANKER_CONFIG.phaseOvershootRelativeSpeedMinKmS) || 0.004,
  );
  const overshootClosingMinKmS = Math.max(
    holdSpeedKmS * 0.5,
    Number(REFUEL_TANKER_CONFIG.phaseOvershootClosingMinKmS) || 0.0004,
  );
  const overshootStableSecRequired = Math.max(
    2,
    Number(REFUEL_TANKER_CONFIG.phaseOvershootStableSec) || 8,
  );
  const overshootExitRelativeSpeedKmS = Math.max(
    holdSpeedKmS,
    Number(REFUEL_TANKER_CONFIG.phaseOvershootExitRelativeSpeedKmS) || 0.002,
  );
  const overshootExitClosingAbsKmS = Math.max(
    holdSpeedKmS * 0.5,
    Number(REFUEL_TANKER_CONFIG.phaseOvershootExitClosingAbsKmS) || 0.0006,
  );
  const overshootBrakeThrottleMax = clamp(
    Number(REFUEL_TANKER_CONFIG.phaseOvershootBrakeThrottleMax) || 0.012,
    0.001,
    0.03,
  );
  const transferRegressDistanceKm = Math.max(
    phasingToTransferDistanceKm * 1.2,
    Number(REFUEL_TANKER_CONFIG.phaseTransferRegressDistanceKm) || 140,
  );
  const velocityRegressDistanceKm = Math.max(
    transferToVelocityDistanceKm * 1.6,
    Number(REFUEL_TANKER_CONFIG.phaseVelocityRegressDistanceKm) || 42,
  );
  const velocityRegressRelativeSpeedKmS = Math.max(
    transferToVelocityRelativeSpeedKmS * 1.4,
    Number(REFUEL_TANKER_CONFIG.phaseVelocityRegressRelativeSpeedKmS) || 0.05,
  );
  const phaseAgeSec = Math.max(0, safeNow - Math.max(0, Number(transfer.phaseEnterSec) || 0));
  const nearApoapsis = Number.isFinite(timeToApoapsisSec)
    && timeToApoapsisSec <= stabilizeApsisWindowSec;
  const nearPeriapsis = Number.isFinite(timeToPeriapsisSec)
    && timeToPeriapsisSec <= stabilizeApsisWindowSec;
  const apsisTimingAvailable = Number.isFinite(timeToApoapsisSec)
    && Number.isFinite(timeToPeriapsisSec)
    && Number.isFinite(orbitalPeriodSec);

  const relaxedHoldStable = (
    phaseAgeSec >= 240
    && distanceKm <= 5
    && relativeSpeedKmS <= 0.02
    && corridorAlignmentForGateDeg <= 90
  );
  const holdStable = (
    distanceKm <= (holdDistanceKm * 1.35)
    && relativeSpeedKmS <= Math.max(holdSpeedKmS * 1.25, 0.003)
    && shipAlignmentForGateDeg <= Math.max(shipAlignGateDeg * 1.4, 12)
    && tankerAlignmentForGateDeg <= Math.max(tankerAlignGateDeg * 1.4, 12)
    && corridorAlignmentForGateDeg <= 70
  ) || relaxedHoldStable;
  const relaxedDockStable = (
    phaseAgeSec >= 600
    && distanceKm <= 0.5
    && relativeSpeedKmS <= 0.02
    && corridorAlignmentForGateDeg <= 45
  );
  const dockStable = (
    distanceKm <= (dockDistanceKm * 1.1)
    && relativeSpeedKmS <= (dockSpeedKmS * 1.2)
    && shipAlignmentForGateDeg <= shipAlignGateDeg
    && tankerAlignmentForGateDeg <= tankerAlignGateDeg
    && corridorAlignmentForGateDeg <= 25
  ) || relaxedDockStable;
  const abortDistanceGateKm = transfer.phase === FLEET_TRANSFER_PHASES.FINAL_APPROACH
    ? Math.max(abortDistanceKm, holdDistanceKm * 8)
    : abortDistanceKm;
  const abortTrigger = (
    distanceKm > abortDistanceGateKm
    || relativeSpeedKmS > abortRelativeSpeedKmS
    || shipAlignmentForGateDeg > abortAttitudeDeg
    || tankerAlignmentForGateDeg > abortAttitudeDeg
  );
  const emergencyCloseDistanceKm = Math.max(1.0, holdDistanceKm * 8);
  const emergencyOverspeed = (
    distanceKm <= emergencyCloseDistanceKm
    && (
      relativeSpeedKmS > 0.008
      || closingSpeedKmS > 0.006
    )
  );
  const periapsisSafe = !Number.isFinite(periapsisKm)
    || periapsisKm >= (stabilizePeriapsisMinKm - 6);
  const apoapsisSafe = !Number.isFinite(apoapsisKm)
    || apoapsisKm <= (stabilizeApoapsisMaxKm * 2);
  const orbitSafe = periapsisSafe && apoapsisSafe;
  const orbitStableNow = (
    (!Number.isFinite(periapsisKm) || periapsisKm >= stabilizePeriapsisMinKm)
    && (!Number.isFinite(apoapsisKm) || apoapsisKm <= stabilizeApoapsisMaxKm)
    && (!Number.isFinite(altitudeErrorKm) || altitudeErrorKm <= stabilizeAltitudeErrorKm)
    && (!Number.isFinite(radialSpeedErrorKmS) || radialSpeedErrorKmS <= stabilizeRadialSpeedErrorKmS)
    && (!Number.isFinite(orbitalRadialSpeedKmS) || Math.abs(orbitalRadialSpeedKmS) <= (stabilizeRadialSpeedErrorKmS * 1.6))
  );
  const closeRangeStabilizeBypass = (
    stabilizeCloseRangeBypassEnabled
    && distanceKm <= stabilizeCloseRangeBypassDistanceKm
    && relativeSpeedKmS <= stabilizeCloseRangeRelativeSpeedMaxKmS
    && Math.abs(closingSpeedKmS) <= stabilizeCloseRangeClosingMaxKmS
    && (!Number.isFinite(periapsisKm) || periapsisKm >= stabilizeCloseRangePeriapsisMinKm)
    && (!Number.isFinite(orbitalRadialSpeedKmS) || Math.abs(orbitalRadialSpeedKmS) <= Math.max(stabilizeRadialSpeedErrorKmS * 3, 0.012))
  );
  const previousPhase = transfer.phase;
  const overshootCandidatePhase = (
    transfer.phase === FLEET_TRANSFER_PHASES.TRANSFER
    || transfer.phase === FLEET_TRANSFER_PHASES.VELOCITY_MATCH
    || transfer.phase === FLEET_TRANSFER_PHASES.HOLD_POINT
  );
  const rangeIncreasing = Number.isFinite(previousDistanceKm)
    && distanceKm > (previousDistanceKm + overshootMinRangeIncreaseKm);
  const passedBestApproach = Number.isFinite(previousPhaseBestDistanceKm)
    && previousPhaseBestDistanceKm <= overshootDetectDistanceKm
    && distanceKm > (previousPhaseBestDistanceKm + overshootBestDistanceMarginKm);
  const closureReversed = (
    closingSpeedKmS <= -overshootClosingMinKmS
    || (
      Number.isFinite(previousClosingSpeedKmS)
      && previousClosingSpeedKmS >= overshootClosingMinKmS
      && closingSpeedKmS <= 0
    )
  );
  const overshootDetected = (
    overshootCandidatePhase
    && rangeIncreasing
    && passedBestApproach
    && closureReversed
    && relativeSpeedKmS >= overshootRelativeSpeedMinKmS
  );
  if (overshootDetected) {
    transfer.phase = FLEET_TRANSFER_PHASES.VELOCITY_MATCH;
    transfer.holdPointStableSec = 0;
    transfer.dockStableSec = 0;
    activateOvershootRecoveryState(
      transfer,
      safeNow,
      distanceKm,
      "overshoot_recovery_velocity_cancel",
    );
  }
  let overshootRecoveryReleased = false;
  if (transfer.overshootRecoveryActive) {
    const overshootRecoveryStable = (
      relativeSpeedKmS <= overshootExitRelativeSpeedKmS
      && Math.abs(closingSpeedKmS) <= overshootExitClosingAbsKmS
    );
    transfer.overshootRecoveryStableSec = overshootRecoveryStable
      ? Math.min(
        overshootStableSecRequired,
        (Number(transfer.overshootRecoveryStableSec) || 0) + safeDt,
      )
      : 0;
    if (transfer.overshootRecoveryStableSec + 1e-6 >= overshootStableSecRequired) {
      clearOvershootRecoveryState(transfer);
      overshootRecoveryReleased = true;
    }
  }
  if (transfer.phase === FLEET_TRANSFER_PHASES.IDLE) {
    transfer.phase = stageDeficitKg <= 1e-3
      ? FLEET_TRANSFER_PHASES.COMPLETE
      : FLEET_TRANSFER_PHASES.STABILIZE_ORBIT;
  } else if (transfer.phase === FLEET_TRANSFER_PHASES.COMPLETE && stageDeficitKg > 1e-3) {
    transfer.phase = FLEET_TRANSFER_PHASES.STABILIZE_ORBIT;
  }
  if (
    transfer.phase !== FLEET_TRANSFER_PHASES.IDLE
    && transfer.phase !== FLEET_TRANSFER_PHASES.COMPLETE
    && transfer.phase !== FLEET_TRANSFER_PHASES.TRANSFERRING
    && transfer.phase !== FLEET_TRANSFER_PHASES.UNDOCKING
    && transfer.phase !== FLEET_TRANSFER_PHASES.ABORTING
    && !orbitSafe
  ) {
    transfer.phase = FLEET_TRANSFER_PHASES.STABILIZE_ORBIT;
    transfer.holdPointStableSec = 0;
    transfer.dockStableSec = 0;
    clearOvershootRecoveryState(transfer);
  }

  if (transfer.phase === FLEET_TRANSFER_PHASES.STABILIZE_ORBIT) {
    transfer.holdPointStableSec = 0;
    transfer.dockStableSec = 0;
    const canAdvance = phaseAgeSec >= phaseTransitionMinDwellStabilizeSec;
  const forceAdvanceReady = (
      phaseAgeSec >= stabilizeForceAdvanceAfterSec
      && distanceKm <= stabilizeForceAdvanceMaxDistanceKm
      && relativeSpeedKmS <= stabilizeForceAdvanceMaxRelativeSpeedKmS
    );
    let bypassApplied = false;
    if (closeRangeStabilizeBypass && canAdvance) {
      transfer.phase = FLEET_TRANSFER_PHASES.VELOCITY_MATCH;
      transfer.orbitStableSec = 0;
      transfer.lastAction = "orbit_stabilize_close_range_bypass";
      transfer.lastActionTimeSec = safeNow;
      bypassApplied = true;
    }
    if (!bypassApplied && forceAdvanceReady) {
      if (distanceKm > phasingToTransferDistanceKm) {
        transfer.phase = FLEET_TRANSFER_PHASES.PHASING;
      } else if (distanceKm > transferToVelocityDistanceKm) {
        transfer.phase = FLEET_TRANSFER_PHASES.TRANSFER;
      } else {
        transfer.phase = FLEET_TRANSFER_PHASES.VELOCITY_MATCH;
      }
      transfer.orbitStableSec = 0;
      transfer.lastAction = "orbit_stabilize_force_advance";
      transfer.lastActionTimeSec = safeNow;
      bypassApplied = true;
    }
    if (!bypassApplied) {
      transfer.orbitStableSec = orbitStableNow
        ? Math.min(stabilizeStableSecRequired, (Number(transfer.orbitStableSec) || 0) + safeDt)
        : 0;
      if (canAdvance && transfer.orbitStableSec + 1e-6 >= stabilizeStableSecRequired) {
        if (distanceKm > phasingToTransferDistanceKm) {
          transfer.phase = FLEET_TRANSFER_PHASES.PHASING;
        } else if (distanceKm > transferToVelocityDistanceKm) {
          transfer.phase = FLEET_TRANSFER_PHASES.TRANSFER;
        } else {
          transfer.phase = FLEET_TRANSFER_PHASES.VELOCITY_MATCH;
        }
        transfer.lastAction = "orbit_stabilized";
        transfer.lastActionTimeSec = safeNow;
      }
    }
  } else if (transfer.phase === FLEET_TRANSFER_PHASES.PHASING) {
    transfer.holdPointStableSec = 0;
    transfer.dockStableSec = 0;
    const canAdvance = phaseAgeSec >= phaseTransitionMinDwellPhasingSec;
    if (emergencyOverspeed) {
      transfer.phase = FLEET_TRANSFER_PHASES.ABORTING;
      transfer.abortRemainingSec = Math.max(8, Number(REFUEL_TANKER_CONFIG.dockAbortDurationSec) || 36);
      transfer.lastAction = "overspeed_abort";
      transfer.lastActionTimeSec = safeNow;
    } else if (
      canAdvance
      && distanceKm <= phasingToTransferDistanceKm
    ) {
      transfer.phase = FLEET_TRANSFER_PHASES.TRANSFER;
    } else if (
      phaseAgeSec >= 900
      && Number.isFinite(transfer.phaseBestDistanceKm)
      && distanceKm > (Number(transfer.phaseBestDistanceKm) * 1.3)
    ) {
      transfer.phase = FLEET_TRANSFER_PHASES.TRANSFER;
      transfer.lastAction = "phasing_divergence_recover_transfer";
      transfer.lastActionTimeSec = safeNow;
    } else if (
      canAdvance
      && distanceKm > (phasingToTransferDistanceKm * 2)
      && relativeSpeedKmS > 0.8
      && closingSpeedKmS < 0
    ) {
      transfer.phase = FLEET_TRANSFER_PHASES.VELOCITY_MATCH;
      transfer.lastAction = "phasing_high_divergence_velocity_brake";
      transfer.lastActionTimeSec = safeNow;
    }
  } else if (transfer.phase === FLEET_TRANSFER_PHASES.TRANSFER) {
    transfer.holdPointStableSec = 0;
    transfer.dockStableSec = 0;
    const canAdvance = phaseAgeSec >= phaseTransitionMinDwellTransferSec;
    if (emergencyOverspeed) {
      transfer.phase = FLEET_TRANSFER_PHASES.ABORTING;
      transfer.abortRemainingSec = Math.max(8, Number(REFUEL_TANKER_CONFIG.dockAbortDurationSec) || 36);
      transfer.lastAction = "overspeed_abort";
      transfer.lastActionTimeSec = safeNow;
    } else if (
      canAdvance
      && distanceKm <= transferToVelocityDistanceKm
      && relativeSpeedKmS <= transferToVelocityRelativeSpeedKmS
    ) {
      transfer.phase = FLEET_TRANSFER_PHASES.VELOCITY_MATCH;
    } else if (canAdvance && distanceKm > transferRegressDistanceKm) {
      transfer.phase = FLEET_TRANSFER_PHASES.PHASING;
    } else if (
      phaseAgeSec >= 900
      && Number.isFinite(transfer.phaseBestDistanceKm)
      && distanceKm > (Number(transfer.phaseBestDistanceKm) * 1.3)
    ) {
      transfer.phase = FLEET_TRANSFER_PHASES.VELOCITY_MATCH;
      transfer.lastAction = "transfer_divergence_recover_velocity";
      transfer.lastActionTimeSec = safeNow;
    } else if (
      canAdvance
      && relativeSpeedKmS > 0.8
      && closingSpeedKmS < 0
    ) {
      transfer.phase = FLEET_TRANSFER_PHASES.VELOCITY_MATCH;
      transfer.lastAction = "transfer_high_divergence_velocity_brake";
      transfer.lastActionTimeSec = safeNow;
    }
  } else if (transfer.phase === FLEET_TRANSFER_PHASES.VELOCITY_MATCH) {
    transfer.holdPointStableSec = 0;
    transfer.dockStableSec = 0;
    const canAdvance = phaseAgeSec >= phaseTransitionMinDwellVelocitySec;
    if (emergencyOverspeed && distanceKm <= (holdDistanceKm * 12)) {
      transfer.phase = FLEET_TRANSFER_PHASES.ABORTING;
      transfer.abortRemainingSec = Math.max(8, Number(REFUEL_TANKER_CONFIG.dockAbortDurationSec) || 36);
      transfer.lastAction = "overspeed_abort";
      transfer.lastActionTimeSec = safeNow;
      clearOvershootRecoveryState(transfer);
    } else if (transfer.overshootRecoveryActive && !overshootRecoveryReleased) {
      transfer.lastAction = "overshoot_recovery_holding_velocity_match";
      transfer.lastActionTimeSec = safeNow;
    } else if (
      canAdvance
      && distanceKm <= Math.max(holdDistanceKm * 6, 8)
      && relativeSpeedKmS <= Math.max(holdSpeedKmS * 3, 0.008)
      && Math.abs(closingSpeedKmS) <= Math.max(holdSpeedKmS * 2.5, 0.006)
      && corridorAlignmentForGateDeg <= 90
    ) {
      transfer.phase = FLEET_TRANSFER_PHASES.HOLD_POINT;
    } else if (
      canAdvance
      && distanceKm > velocityRegressDistanceKm
      && relativeSpeedKmS <= Math.max(transferToVelocityRelativeSpeedKmS * 2, 0.18)
      && closingSpeedKmS >= -Math.max(holdSpeedKmS * 2, 0.008)
    ) {
      transfer.phase = FLEET_TRANSFER_PHASES.TRANSFER;
    } else if (
      canAdvance
      && distanceKm > Math.max(holdDistanceKm * 2.5, 12)
      && closingSpeedKmS < Math.max(holdSpeedKmS * 2, 0.004)
      && relativeSpeedKmS <= Math.max(transferToVelocityRelativeSpeedKmS, 0.12)
    ) {
      transfer.phase = FLEET_TRANSFER_PHASES.TRANSFER;
      transfer.lastAction = "velocity_match_proximity_transfer";
      transfer.lastActionTimeSec = safeNow;
    }
  } else if (transfer.phase === FLEET_TRANSFER_PHASES.HOLD_POINT) {
    const canAdvance = phaseAgeSec >= phaseTransitionMinDwellHoldSec;
    transfer.holdPointStableSec = holdStable
      ? Math.min(holdStableRequiredSec, transfer.holdPointStableSec + safeDt)
      : 0;
    if (emergencyOverspeed) {
      transfer.phase = FLEET_TRANSFER_PHASES.ABORTING;
      transfer.abortRemainingSec = Math.max(8, Number(REFUEL_TANKER_CONFIG.dockAbortDurationSec) || 36);
      transfer.lastAction = "overspeed_abort";
      transfer.lastActionTimeSec = safeNow;
      clearOvershootRecoveryState(transfer);
    } else if (canAdvance && transfer.holdPointStableSec + 1e-6 >= holdStableRequiredSec) {
      transfer.phase = FLEET_TRANSFER_PHASES.FINAL_APPROACH;
      transfer.dockStableSec = 0;
    } else if (
      canAdvance
      && (
        distanceKm > Math.max(holdDistanceKm * 60, 60)
        || corridorAlignmentForGateDeg > 140
        || relativeSpeedKmS > 0.7
        || Math.abs(closingSpeedKmS) > 0.7
      )
    ) {
      transfer.phase = FLEET_TRANSFER_PHASES.VELOCITY_MATCH;
      transfer.holdPointStableSec = 0;
    }
  } else if (transfer.phase === FLEET_TRANSFER_PHASES.FINAL_APPROACH) {
    transfer.dockStableSec = dockStable
      ? Math.min(dockStableRequiredSec, transfer.dockStableSec + safeDt)
      : 0;
    if (abortTrigger || emergencyOverspeed) {
      transfer.phase = FLEET_TRANSFER_PHASES.ABORTING;
      transfer.abortRemainingSec = Math.max(8, Number(REFUEL_TANKER_CONFIG.dockAbortDurationSec) || 36);
      transfer.lastAction = emergencyOverspeed ? "overspeed_abort" : "abort";
      transfer.lastActionTimeSec = safeNow;
      clearOvershootRecoveryState(transfer);
    } else if (transfer.dockStableSec + 1e-6 >= dockStableRequiredSec) {
      transfer.phase = FLEET_TRANSFER_PHASES.DOCKED_LOCK;
      transfer.lockStableSec = 0;
      transfer.lastAction = "dock_lock";
      transfer.lastActionTimeSec = safeNow;
    }
  } else if (transfer.phase === FLEET_TRANSFER_PHASES.DOCKED_LOCK) {
    if (abortTrigger) {
      transfer.phase = FLEET_TRANSFER_PHASES.ABORTING;
      transfer.abortRemainingSec = Math.max(8, Number(REFUEL_TANKER_CONFIG.dockAbortDurationSec) || 36);
      transfer.lastAction = "lock_abort";
      transfer.lastActionTimeSec = safeNow;
      clearOvershootRecoveryState(transfer);
    } else {
      transfer.lockStableSec = Math.max(0, Number(transfer.lockStableSec) || 0) + safeDt;
      if ((Number(transfer.lockStableSec) || 0) >= 1.5) {
        if (stageDeficitKg <= 1e-3) {
          transfer.phase = FLEET_TRANSFER_PHASES.UNDOCKING;
          transfer.undockRemainingSec = Math.max(10, Number(REFUEL_TANKER_CONFIG.undockDurationSec) || 40);
          transfer.lastAction = "undock_no_transfer";
          transfer.lastActionTimeSec = safeNow;
        } else {
          transfer.phase = FLEET_TRANSFER_PHASES.TRANSFERRING;
          transfer.transferPlannedKg = 0;
          transfer.transferRemainingKg = 0;
          transfer.transferTransferredKg = 0;
          transfer.transferRateKgS = 0;
          transfer.transferProgress = 0;
          transfer.lastAction = "transfer_started";
          transfer.lastActionTimeSec = safeNow;
        }
      }
    }
  } else if (transfer.phase === FLEET_TRANSFER_PHASES.ABORTING) {
    clearOvershootRecoveryState(transfer);
    const abortDefaultSec = Math.max(8, Number(REFUEL_TANKER_CONFIG.dockAbortDurationSec) || 36);
    transfer.abortRemainingSec = Math.max(
      0,
      (Number(transfer.abortRemainingSec) || abortDefaultSec) - safeDt,
    );
    const abortRecovered = (
      distanceKm >= Math.max(holdDistanceKm * 1.25, 0.45)
      && relativeSpeedKmS <= Math.max(holdSpeedKmS * 2.2, 0.0012)
    );
    if (abortRecovered) {
      transfer.phase = !orbitSafe
        ? FLEET_TRANSFER_PHASES.STABILIZE_ORBIT
        : (distanceKm > transferToVelocityDistanceKm
          ? FLEET_TRANSFER_PHASES.TRANSFER
          : FLEET_TRANSFER_PHASES.VELOCITY_MATCH);
      transfer.holdPointStableSec = 0;
      transfer.dockStableSec = 0;
      transfer.abortRemainingSec = 0;
    } else if (transfer.abortRemainingSec <= 1e-6) {
      transfer.phase = FLEET_TRANSFER_PHASES.STABILIZE_ORBIT;
      transfer.holdPointStableSec = 0;
      transfer.dockStableSec = 0;
      transfer.abortRemainingSec = 0;
      transfer.lastAction = "abort_timeout_recover_stabilize";
      transfer.lastActionTimeSec = safeNow;
    }
  }
  if (transfer.phase !== FLEET_TRANSFER_PHASES.STABILIZE_ORBIT) {
    transfer.radialDampActive = false;
    transfer.radialDampHoldSec = 0;
  }
  if (
    transfer.phase !== FLEET_TRANSFER_PHASES.TRANSFER
    && transfer.phase !== FLEET_TRANSFER_PHASES.VELOCITY_MATCH
  ) {
    clearOvershootRecoveryState(transfer);
  }
  if (transfer.phase !== previousPhase) {
    transfer.phaseEnterSec = safeNow;
    transfer.phaseBestDistanceKm = distanceKm;
  }

  emitTransferPhaseEvent(
    emitLaunchEvent,
    vehicle,
    previousPhase,
    transfer.phase,
    {
      tankerId: transfer.targetTankerId,
      distanceKm,
      relativeSpeedKmS,
      shipAlignmentDeg: transfer.shipAlignmentDeg,
      tankerAlignmentDeg: transfer.tankerAlignmentDeg,
      corridorAlignmentDeg: transfer.corridorAlignmentDeg,
      deficitKg: stageDeficitKg,
    },
  );

  const poweredPhase = (
    transfer.phase === FLEET_TRANSFER_PHASES.STABILIZE_ORBIT
    || transfer.phase === FLEET_TRANSFER_PHASES.PHASING
    || transfer.phase === FLEET_TRANSFER_PHASES.TRANSFER
    || transfer.phase === FLEET_TRANSFER_PHASES.VELOCITY_MATCH
    || transfer.phase === FLEET_TRANSFER_PHASES.HOLD_POINT
  );
  const approachGuidance = poweredPhase
    ? computeApproachGuidance({
      target,
      prograde,
      directionToTarget,
      shipRelativePositionKm,
      shipRelativeVelocityKmS,
    })
    : null;
  let phaseRequestedThrottle = approachGuidance
    ? approachGuidance.requestedThrottle
    : clamp(Number(requestedThrottle) || 0, 0, 1);
  let phaseDesiredDirection = approachGuidance?.desiredDirection || directionToTarget;
  let phaseGuidanceMode = approachGuidance?.guidanceMode || guidanceMode;
  if (transfer.phase === FLEET_TRANSFER_PHASES.STABILIZE_ORBIT) {
    const periLow = Number.isFinite(periapsisKm) && periapsisKm < stabilizePeriapsisMinKm;
    const apoHigh = Number.isFinite(apoapsisKm) && apoapsisKm > stabilizeApoapsisMaxKm;
    const radialSpeedAbsKmS = Number.isFinite(orbitalRadialSpeedKmS)
      ? Math.abs(orbitalRadialSpeedKmS)
      : Number.NaN;
    const radialDampEnterThresholdKmS = stabilizeRadialSpeedErrorKmS * stabilizeRadialDampEnterFactor;
    const radialDampExitThresholdKmS = stabilizeRadialSpeedErrorKmS * stabilizeRadialDampExitFactor;
    let radialDampActive = Boolean(transfer.radialDampActive);
    let radialDampHoldSec = Math.max(0, Number(transfer.radialDampHoldSec) || 0);
    if (Number.isFinite(radialSpeedAbsKmS)) {
      if (!radialDampActive && radialSpeedAbsKmS >= radialDampEnterThresholdKmS) {
        radialDampActive = true;
        radialDampHoldSec = 0;
      }
      if (radialDampActive) {
        radialDampHoldSec += safeDt;
        if (
          radialDampHoldSec >= stabilizeRadialDampMinHoldSec
          && radialSpeedAbsKmS <= radialDampExitThresholdKmS
        ) {
          radialDampActive = false;
          radialDampHoldSec = 0;
        }
      }
    } else {
      radialDampActive = false;
      radialDampHoldSec = 0;
    }
    transfer.radialDampActive = radialDampActive;
    transfer.radialDampHoldSec = radialDampHoldSec;
    const radialFast = radialDampActive;
    const severePeriLow = Number.isFinite(periapsisKm)
      && periapsisKm < (stabilizePeriapsisMinKm - stabilizePeriEmergencyMarginKm);
    const severeApoHigh = Number.isFinite(apoapsisKm)
      && apoapsisKm > (stabilizeApoapsisMaxKm * stabilizeApoEmergencyFactor);
    if (periLow && apoHigh) {
      const periDeficitKm = Math.max(0, stabilizePeriapsisMinKm - periapsisKm);
      const apoExcessKm = Math.max(0, apoapsisKm - stabilizeApoapsisMaxKm);
      const periDominant = periDeficitKm >= (apoExcessKm * 0.85);
      if (nearApoapsis) {
        phaseRequestedThrottle = clamp(
          0.01 + (periDeficitKm / 280),
          0.01,
          0.045,
        );
        phaseDesiredDirection = normalize(prograde || { x: 0, y: 1, z: 0 }, directionToTarget);
        phaseGuidanceMode = "navsys:orbital-refuel-orbit-stabilize:periapsis-raise-at-apo";
      } else if (nearPeriapsis) {
        phaseRequestedThrottle = clamp(
          0.01 + (apoExcessKm / 2600),
          0.01,
          0.045,
        );
        phaseDesiredDirection = normalize(
          scale(prograde || { x: 0, y: 1, z: 0 }, -1),
          scale(localUp, -1),
        );
        phaseGuidanceMode = "navsys:orbital-refuel-orbit-stabilize:apoapsis-lower-at-peri";
      } else if (severePeriLow || severeApoHigh) {
        phaseRequestedThrottle = 0.02;
        if (periDominant) {
          phaseDesiredDirection = normalize(
            add(
              scale(prograde || { x: 0, y: 1, z: 0 }, 0.9),
              scale(localUp, 0.1),
            ),
            prograde || { x: 0, y: 1, z: 0 },
          );
          phaseGuidanceMode = "navsys:orbital-refuel-orbit-stabilize:periapsis-emergency-recovery";
        } else {
          phaseDesiredDirection = normalize(
            scale(prograde || { x: 0, y: 1, z: 0 }, -1),
            scale(localUp, -1),
          );
          phaseGuidanceMode = "navsys:orbital-refuel-orbit-stabilize:apoapsis-emergency-trim";
        }
      } else {
        phaseRequestedThrottle = 0;
        phaseDesiredDirection = normalize(directionToTarget, prograde || { x: 0, y: 1, z: 0 });
        phaseGuidanceMode = apsisTimingAvailable
          ? "navsys:orbital-refuel-orbit-stabilize:apsis-window-coast"
          : "navsys:orbital-refuel-orbit-stabilize:coast";
      }
    } else if (periLow) {
      const periDeficitKm = Math.max(0, stabilizePeriapsisMinKm - periapsisKm);
      if (nearApoapsis || severePeriLow) {
        phaseRequestedThrottle = clamp(
          0.01 + (periDeficitKm / 250),
          0.01,
          severePeriLow ? 0.055 : 0.04,
        );
        phaseDesiredDirection = normalize(
          severePeriLow
            ? add(scale(prograde || { x: 0, y: 1, z: 0 }, 0.9), scale(localUp, 0.1))
            : (prograde || { x: 0, y: 1, z: 0 }),
          prograde || { x: 0, y: 1, z: 0 },
        );
        phaseGuidanceMode = nearApoapsis
          ? "navsys:orbital-refuel-orbit-stabilize:periapsis-raise-at-apo"
          : "navsys:orbital-refuel-orbit-stabilize:periapsis-emergency-recovery";
      } else {
        phaseRequestedThrottle = 0;
        phaseDesiredDirection = normalize(directionToTarget, prograde || { x: 0, y: 1, z: 0 });
        phaseGuidanceMode = apsisTimingAvailable
          ? "navsys:orbital-refuel-orbit-stabilize:await-apoapsis-window"
          : "navsys:orbital-refuel-orbit-stabilize:coast";
      }
    } else if (apoHigh) {
      const apoExcessKm = Math.max(0, apoapsisKm - stabilizeApoapsisMaxKm);
      if (nearPeriapsis || severeApoHigh) {
        phaseRequestedThrottle = clamp(
          0.01 + (apoExcessKm / 2200),
          0.01,
          severeApoHigh ? 0.05 : 0.04,
        );
        phaseDesiredDirection = normalize(
          scale(prograde || { x: 0, y: 1, z: 0 }, -1),
          scale(localUp, -1),
        );
        phaseGuidanceMode = nearPeriapsis
          ? "navsys:orbital-refuel-orbit-stabilize:apoapsis-lower-at-peri"
          : "navsys:orbital-refuel-orbit-stabilize:apoapsis-emergency-trim";
      } else {
        phaseRequestedThrottle = 0;
        phaseDesiredDirection = normalize(directionToTarget, prograde || { x: 0, y: 1, z: 0 });
        phaseGuidanceMode = apsisTimingAvailable
          ? "navsys:orbital-refuel-orbit-stabilize:await-periapsis-window"
          : "navsys:orbital-refuel-orbit-stabilize:coast";
      }
    } else if (radialFast) {
      phaseRequestedThrottle = 0.008;
      phaseDesiredDirection = normalize(
        (orbitalRadialSpeedKmS > 0)
          ? scale(localUp, -1)
          : localUp,
        directionToTarget,
      );
      phaseGuidanceMode = "navsys:orbital-refuel-orbit-stabilize:radial-rate-damp";
    } else {
      phaseRequestedThrottle = 0;
      phaseDesiredDirection = normalize(directionToTarget, prograde || { x: 0, y: 1, z: 0 });
      phaseGuidanceMode = "navsys:orbital-refuel-orbit-stabilize:coast";
    }
  } else if (transfer.phase === FLEET_TRANSFER_PHASES.PHASING) {
    phaseRequestedThrottle = Math.min(phaseRequestedThrottle, phasingThrottleMax);
  } else if (transfer.phase === FLEET_TRANSFER_PHASES.TRANSFER) {
    phaseRequestedThrottle = Math.min(phaseRequestedThrottle, transferThrottleMax);
    const transferReacquireThrottle = clamp((distanceKm / 2500), 0.0015, transferThrottleMax);
    const closingDeficitKmS = Math.max(0, Math.max(holdSpeedKmS * 3, 0.01) - Math.max(closingSpeedKmS, 0));
    phaseRequestedThrottle = Math.max(
      phaseRequestedThrottle,
      clamp(transferReacquireThrottle + (closingDeficitKmS * 0.06), 0.0015, transferThrottleMax),
    );
    phaseDesiredDirection = normalize(
      directionToTarget,
      phaseDesiredDirection || prograde || { x: 0, y: 1, z: 0 },
    );
    phaseGuidanceMode = "navsys:orbital-refuel-transfer-burn";
  } else if (transfer.phase === FLEET_TRANSFER_PHASES.VELOCITY_MATCH) {
    phaseRequestedThrottle = Math.min(phaseRequestedThrottle, velocityMatchThrottleMax);
    const antiRelativeVelocityDirection = normalize(
      target.relativeVelocityKmS || { x: 0, y: 0, z: 0 },
      phaseDesiredDirection || directionToTarget || prograde || { x: 0, y: 1, z: 0 },
    );
    if (
      distanceKm <= Math.max(transferToVelocityDistanceKm * 1.8, 60)
      && relativeSpeedKmS > Math.max(holdSpeedKmS * 6, 0.0012)
    ) {
      phaseDesiredDirection = antiRelativeVelocityDirection;
      phaseRequestedThrottle = clamp(
        0.001 + (relativeSpeedKmS * 0.2),
        0.001,
        velocityMatchThrottleMax,
      );
      phaseGuidanceMode = "navsys:orbital-refuel-velocity-match-brake";
    }
    const desiredClosingKmS = finiteNumber(
      approachGuidance?.diagnostics?.desiredClosingKmS,
      Number.NaN,
    );
    if (
      Number.isFinite(desiredClosingKmS)
      && distanceKm <= 1
      && closingSpeedKmS <= (desiredClosingKmS * 1.1)
      && relativeSpeedKmS <= Math.max(holdSpeedKmS * 2, 0.00035)
    ) {
      phaseRequestedThrottle = 0;
    }
    if (
      distanceKm <= Math.max(holdDistanceKm * 20, 40)
      && closingSpeedKmS <= 0
      && relativeSpeedKmS <= Math.max(transferToVelocityRelativeSpeedKmS * 2, 0.2)
      && !transfer.overshootRecoveryActive
    ) {
      phaseDesiredDirection = normalize(
        directionToTarget,
        phaseDesiredDirection || prograde || { x: 0, y: 1, z: 0 },
      );
      phaseRequestedThrottle = Math.max(phaseRequestedThrottle, 0.002);
      phaseGuidanceMode = "navsys:orbital-refuel-velocity-match-reacquire";
    }
  } else if (transfer.phase === FLEET_TRANSFER_PHASES.HOLD_POINT) {
    const holdCap = 0.02;
    phaseRequestedThrottle = Math.min(phaseRequestedThrottle, holdCap);
    if (
      relativeSpeedKmS > Math.max(holdSpeedKmS * 2, 0.01)
      || Math.abs(closingSpeedKmS) > Math.max(holdSpeedKmS * 1.5, 0.008)
    ) {
      phaseDesiredDirection = normalize(
        target.relativeVelocityKmS || { x: 0, y: 0, z: 0 },
        phaseDesiredDirection || directionToTarget || prograde || { x: 0, y: 1, z: 0 },
      );
      phaseRequestedThrottle = holdCap;
      phaseGuidanceMode = composeMode(
        phaseGuidanceMode || "navsys:orbital-refuel-hold-point",
        "hold-brake",
      );
    }
  }
  if (transfer.overshootRecoveryActive && transfer.phase === FLEET_TRANSFER_PHASES.VELOCITY_MATCH) {
    phaseDesiredDirection = normalize(
      target.relativeVelocityKmS || { x: 0, y: 0, z: 0 },
      phaseDesiredDirection || scale(directionToTarget, -1) || prograde || { x: 0, y: 1, z: 0 },
    );
    const overshootBrakeThrottle = clamp(
      0.0015
        + (Math.max(0, relativeSpeedKmS - overshootExitRelativeSpeedKmS) * 0.18)
        + (Math.max(0, Math.abs(closingSpeedKmS) - overshootExitClosingAbsKmS) * 0.22),
      0.0015,
      Math.min(overshootBrakeThrottleMax, velocityMatchThrottleMax),
    );
    phaseRequestedThrottle = (
      relativeSpeedKmS <= overshootExitRelativeSpeedKmS
      && Math.abs(closingSpeedKmS) <= overshootExitClosingAbsKmS
    )
      ? 0
      : Math.max(phaseRequestedThrottle, overshootBrakeThrottle);
    phaseGuidanceMode = phaseRequestedThrottle > 1e-6
      ? "navsys:orbital-refuel-overshoot-recovery-brake"
      : "navsys:orbital-refuel-overshoot-recovery-coast";
  }
  const closeRateBrakeActive = (
    (
      transfer.phase === FLEET_TRANSFER_PHASES.TRANSFER
      || transfer.phase === FLEET_TRANSFER_PHASES.VELOCITY_MATCH
      || transfer.phase === FLEET_TRANSFER_PHASES.HOLD_POINT
    )
    && !transfer.overshootRecoveryActive
    && distanceKm <= Math.max(holdDistanceKm * 40, 120)
    && relativeSpeedKmS > Math.max(holdSpeedKmS * 1.5, 0.01)
  );
  if (closeRateBrakeActive) {
    phaseDesiredDirection = normalize(
      target.relativeVelocityKmS || { x: 0, y: 0, z: 0 },
      phaseDesiredDirection || directionToTarget || prograde || { x: 0, y: 1, z: 0 },
    );
    phaseRequestedThrottle = Math.max(
      phaseRequestedThrottle,
      clamp(0.002 + (relativeSpeedKmS * 0.1), 0.002, 0.03),
    );
    phaseGuidanceMode = composeMode(
      phaseGuidanceMode || "navsys:orbital-refuel-close-rate-brake",
      "close-rate-brake",
    );
  }
  const periapsisGuardActive = (
    (
      transfer.phase === FLEET_TRANSFER_PHASES.PHASING
      || transfer.phase === FLEET_TRANSFER_PHASES.TRANSFER
      || transfer.phase === FLEET_TRANSFER_PHASES.VELOCITY_MATCH
    )
    && Number.isFinite(periapsisKm)
    && periapsisKm < stabilizePeriapsisMinKm
  );
  if (periapsisGuardActive) {
    const periDeficitKm = Math.max(0, stabilizePeriapsisMinKm - periapsisKm);
    const recoveryDirection = normalize(
      add(
        scale(prograde || { x: 0, y: 1, z: 0 }, 0.92),
        scale(localUp, 0.08),
      ),
      prograde || { x: 0, y: 1, z: 0 },
    );
    if (nearApoapsis || periDeficitKm >= 6) {
      phaseRequestedThrottle = Math.max(
        phaseRequestedThrottle,
        clamp(0.006 + (periDeficitKm / 220), 0.006, 0.025),
      );
      phaseDesiredDirection = recoveryDirection;
      phaseGuidanceMode = composeMode(
        phaseGuidanceMode || "navsys:orbital-refuel-periapsis-guard",
        "periapsis-guard-recovery",
      );
    } else {
      phaseRequestedThrottle = 0;
      phaseDesiredDirection = normalize(directionToTarget, prograde || { x: 0, y: 1, z: 0 });
      phaseGuidanceMode = composeMode(
        phaseGuidanceMode || "navsys:orbital-refuel-periapsis-guard",
        "periapsis-guard-coast",
      );
    }
  }
  if (transfer.phase === FLEET_TRANSFER_PHASES.HOLD_POINT && distanceKm <= Math.max(holdDistanceKm * 0.9, 0.8)) {
    phaseRequestedThrottle = Math.min(phaseRequestedThrottle, 0.0012);
  }
  if (
    transfer.phase === FLEET_TRANSFER_PHASES.DOCKED_LOCK
    || transfer.phase === FLEET_TRANSFER_PHASES.TRANSFERRING
  ) {
    phaseDesiredDirection = normalize(
      tankerForward,
      prograde || directionToTarget || { x: 0, y: 1, z: 0 },
    );
  } else if (
    transfer.phase === FLEET_TRANSFER_PHASES.HOLD_POINT
    || transfer.phase === FLEET_TRANSFER_PHASES.FINAL_APPROACH
  ) {
    const farHoldTranslation = transfer.phase === FLEET_TRANSFER_PHASES.HOLD_POINT
      && distanceKm > Math.max(holdDistanceKm * 4, 0.3);
    // At multi-km hold ranges, prioritize direct closure; bias toward docking axis only near terminal.
    phaseDesiredDirection = farHoldTranslation
      ? normalize(directionToTarget, tankerForward || { x: 0, y: 1, z: 0 })
      : normalize(
        add(
          scale(phaseDesiredDirection || directionToTarget || tankerForward, 0.8),
          scale(tankerForward, 0.2),
        ),
        directionToTarget || tankerForward || { x: 0, y: 1, z: 0 },
      );
  }
  const mode = phaseWithMode({
    phase: transfer.phase,
    guidanceMode: phaseGuidanceMode,
    requestedThrottle: phaseRequestedThrottle,
    desiredDirection: phaseDesiredDirection,
    directionFallback: prograde || { x: 0, y: 1, z: 0 },
  });
  transfer.approachDesiredClosingKmS = finiteNumber(
    approachGuidance?.diagnostics?.desiredClosingKmS,
    null,
  );
  transfer.approachClosingKmS = finiteNumber(
    approachGuidance?.diagnostics?.closingSpeedKmS,
    null,
  );
  transfer.approachOrbitalRateRadS = finiteNumber(
    approachGuidance?.diagnostics?.orbitalRateRadS,
    null,
  );
  return {
    ...mode,
    state: transfer,
  };
}

function resolveTransferAvailableKg({
  tankerVehicle = null,
  reserveFraction = 0.1,
} = {}) {
  if (!tankerVehicle) {
    return Number.POSITIVE_INFINITY;
  }
  const tankerCapacityKg = stageCapacityKgForVehicle(tankerVehicle);
  const reserveKg = tankerCapacityKg > 1e-6
    ? tankerCapacityKg * clamp(Number(reserveFraction) || 0.1, 0.02, 0.5)
    : 0;
  const tankerStagePropellantKg = Math.max(0, Number(tankerVehicle.stagePropellantKg) || 0);
  return Math.max(0, tankerStagePropellantKg - reserveKg);
}

export function advanceFleetTransferMass({
  vehicle,
  shipState = null,
  tankerVehicle = null,
  tankerState = null,
  safeDtSeconds = 0,
  targetFillFraction = REFUEL_TANKER_CONFIG.targetFillFraction,
  emitLaunchEvent = null,
} = {}) {
  const transfer = ensureFleetTransferState(vehicle);
  if (!transfer || !vehicle || !shipState) {
    return {
      transferActive: false,
      undockActive: false,
      completed: false,
      state: transfer,
    };
  }
  const safeDt = Math.max(0, Number(safeDtSeconds) || 0);
  if (safeDt <= 0) {
    return {
      transferActive: transfer.phase === FLEET_TRANSFER_PHASES.TRANSFERRING,
      undockActive: transfer.phase === FLEET_TRANSFER_PHASES.UNDOCKING || transfer.phase === FLEET_TRANSFER_PHASES.ABORTING,
      completed: transfer.phase === FLEET_TRANSFER_PHASES.COMPLETE,
      state: transfer,
    };
  }

  const stageCapacityKg = stageCapacityKgForVehicle(vehicle);
  const goalFillFraction = clamp(Number(targetFillFraction) || 0.88, 0.1, 1);
  const goalPropellantKg = stageCapacityKg * goalFillFraction;
  const shipPropellantKg = Math.max(0, Number(vehicle.stagePropellantKg) || 0);
  let deficitKg = Math.max(0, goalPropellantKg - shipPropellantKg);

  if (transfer.phase === FLEET_TRANSFER_PHASES.TRANSFERRING) {
    if (transfer.targetTankerId && !tankerState) {
      transfer.phase = FLEET_TRANSFER_PHASES.ABORTING;
      transfer.abortRemainingSec = Math.max(8, Number(REFUEL_TANKER_CONFIG.dockAbortDurationSec) || 36);
      transfer.lastAction = "transfer_abort_target_lost";
      return {
        transferActive: false,
        undockActive: true,
        completed: false,
        targetFillFraction: goalFillFraction,
        state: transfer,
      };
    }
    if (!(transfer.transferPlannedKg > 1e-6)) {
      const transferPerFlightKg = Math.max(0, Number(REFUEL_TANKER_CONFIG.transferPerFlightKg) || 360_000);
      const availableKg = resolveTransferAvailableKg({
        tankerVehicle,
        reserveFraction: 0.1,
      });
      const plannedKg = Math.min(
        Math.max(0, deficitKg),
        transferPerFlightKg,
        Math.max(0, availableKg),
      );
      transfer.transferPlannedKg = Math.max(0, plannedKg);
      transfer.transferRemainingKg = Math.max(0, plannedKg);
      transfer.transferTransferredKg = 0;
      const transferDurationSec = Math.max(30, Number(REFUEL_TANKER_CONFIG.transferDurationSec) || 150);
      transfer.transferRateKgS = plannedKg / Math.max(transferDurationSec, 1);
      transfer.transferProgress = 0;
      if (!(plannedKg > 1e-6)) {
        transfer.phase = FLEET_TRANSFER_PHASES.UNDOCKING;
        transfer.undockRemainingSec = Math.max(10, Number(REFUEL_TANKER_CONFIG.undockDurationSec) || 40);
        transfer.lastAction = "transfer_skipped";
      } else if (typeof emitLaunchEvent === "function") {
        emitLaunchEvent("fleet_refuel_transfer_started", {
          shipId: vehicle.id,
          tankerId: transfer.targetTankerId,
          transferPlannedKg: transfer.transferPlannedKg,
          transferRateKgS: transfer.transferRateKgS,
          targetFillFraction: goalFillFraction,
        });
      }
    }
    if (transfer.phase === FLEET_TRANSFER_PHASES.TRANSFERRING) {
      const availableKg = resolveTransferAvailableKg({
        tankerVehicle,
        reserveFraction: 0.1,
      });
      const rateKgS = Math.max(0, Number(transfer.transferRateKgS) || 0);
      const remainingKg = Math.max(0, Number(transfer.transferRemainingKg) || 0);
      const transferStepKg = Math.min(
        remainingKg,
        Math.max(0, deficitKg),
        Math.max(0, availableKg),
        rateKgS * safeDt,
      );
      if (transferStepKg > 0) {
        vehicle.stagePropellantKg = Math.max(0, Number(vehicle.stagePropellantKg) || 0) + transferStepKg;
        vehicle.propellantKg = Math.max(0, Number(vehicle.propellantKg) || 0) + transferStepKg;
        shipState.massKg = Math.max(0, Number(shipState.massKg) || 0) + transferStepKg;
        if (tankerVehicle) {
          tankerVehicle.stagePropellantKg = Math.max(0, Number(tankerVehicle.stagePropellantKg) || 0) - transferStepKg;
          tankerVehicle.propellantKg = Math.max(0, Number(tankerVehicle.propellantKg) || 0) - transferStepKg;
        }
        if (tankerState) {
          tankerState.massKg = Math.max(0, Number(tankerState.massKg) || 0) - transferStepKg;
        }
        transfer.transferRemainingKg = remainingKg - transferStepKg;
        transfer.transferTransferredKg = Math.max(0, Number(transfer.transferTransferredKg) || 0) + transferStepKg;
      }
      const plannedKg = Math.max(0, Number(transfer.transferPlannedKg) || 0);
      transfer.transferProgress = plannedKg > 1e-6
        ? clamp((Number(transfer.transferTransferredKg) || 0) / plannedKg, 0, 1)
        : 0;
      deficitKg = Math.max(0, goalPropellantKg - Math.max(0, Number(vehicle.stagePropellantKg) || 0));
      const transferDone = (
        (Number(transfer.transferRemainingKg) || 0) <= 1e-3
        || deficitKg <= 1e-3
        || resolveTransferAvailableKg({ tankerVehicle, reserveFraction: 0.1 }) <= 1e-3
      );
      if (transferDone) {
        transfer.phase = FLEET_TRANSFER_PHASES.UNDOCKING;
        transfer.undockRemainingSec = Math.max(10, Number(REFUEL_TANKER_CONFIG.undockDurationSec) || 40);
        transfer.lastAction = "transfer_completed";
        if (typeof emitLaunchEvent === "function") {
          emitLaunchEvent("fleet_refuel_transfer_completed", {
            shipId: vehicle.id,
            tankerId: transfer.targetTankerId,
            transferredKg: Math.max(0, Number(transfer.transferTransferredKg) || 0),
            targetFillFraction: goalFillFraction,
          });
        }
      }
    }
  }

  if (transfer.phase === FLEET_TRANSFER_PHASES.UNDOCKING) {
    transfer.undockRemainingSec = Math.max(
      0,
      (Number(transfer.undockRemainingSec) || Math.max(10, Number(REFUEL_TANKER_CONFIG.undockDurationSec) || 40)) - safeDt,
    );
    if (transfer.undockRemainingSec <= 1e-6) {
      transfer.phase = FLEET_TRANSFER_PHASES.COMPLETE;
      transfer.lastAction = "undock_completed";
      if (typeof emitLaunchEvent === "function") {
        emitLaunchEvent("fleet_refuel_undock_completed", {
          shipId: vehicle.id,
          tankerId: transfer.targetTankerId,
          transferredKg: Math.max(0, Number(transfer.transferTransferredKg) || 0),
        });
      }
    }
  }

  return {
    transferActive: transfer.phase === FLEET_TRANSFER_PHASES.TRANSFERRING,
    undockActive: transfer.phase === FLEET_TRANSFER_PHASES.UNDOCKING || transfer.phase === FLEET_TRANSFER_PHASES.ABORTING,
    completed: transfer.phase === FLEET_TRANSFER_PHASES.COMPLETE,
    targetFillFraction: goalFillFraction,
    state: transfer,
  };
}

export function fleetTransferTelemetryState(vehicle) {
  const transfer = ensureFleetTransferState(vehicle);
  const transferActive = transfer?.phase === FLEET_TRANSFER_PHASES.TRANSFERRING;
  const undockActive = transfer?.phase === FLEET_TRANSFER_PHASES.UNDOCKING || transfer?.phase === FLEET_TRANSFER_PHASES.ABORTING;
  return {
    phase: String(transfer?.phase || FLEET_TRANSFER_PHASES.IDLE),
    transferActive,
    undockActive,
    transferTankerId: String(transfer?.targetTankerId || ""),
    transferProgress: clamp(Number(transfer?.transferProgress) || 0, 0, 1),
    transferRemainingKg: Math.max(0, Number(transfer?.transferRemainingKg) || 0),
    transferRateKgS: Math.max(0, Number(transfer?.transferRateKgS) || 0),
    lastAction: String(transfer?.lastAction || ""),
    lastActionTimeSec: Math.max(0, Number(transfer?.lastActionTimeSec) || 0),
    overshootRecoveryActive: Boolean(transfer?.overshootRecoveryActive),
    overshootRecoveryStableSec: Math.max(0, Number(transfer?.overshootRecoveryStableSec) || 0),
    approachDesiredClosingKmS: finiteNumber(transfer?.approachDesiredClosingKmS, null),
    approachClosingKmS: finiteNumber(transfer?.approachClosingKmS, null),
    approachOrbitalRateRadS: finiteNumber(transfer?.approachOrbitalRateRadS, null),
    shipAlignmentDeg: finiteNumber(transfer?.shipAlignmentDeg, null),
    tankerAlignmentDeg: finiteNumber(transfer?.tankerAlignmentDeg, null),
    corridorAlignmentDeg: finiteNumber(transfer?.corridorAlignmentDeg, null),
  };
}
