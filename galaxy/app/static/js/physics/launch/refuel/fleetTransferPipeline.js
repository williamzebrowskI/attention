import {
  angleBetweenRadians,
  clamp,
  degrees,
  normalize,
  scale,
  subtract,
} from "../launchMath.js";
import { REFUEL_TANKER_CONFIG } from "./config.js";

const FLEET_TRANSFER_PHASES = Object.freeze({
  IDLE: "idle",
  APPROACH: "approach",
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
      lastDistanceKm: null,
      lastRelativeSpeedKmS: null,
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
  transfer.lastDistanceKm = null;
  transfer.lastRelativeSpeedKmS = null;
  transfer.lastAction = "";
  transfer.lastActionTimeSec = 0;
  transfer.targetFillFraction = 0;
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
  if (phase === FLEET_TRANSFER_PHASES.APPROACH) {
    return {
      requestedThrottle: clamp(Number(requestedThrottle) || 0, 0, 1),
      desiredDirection: safeDirection,
      guidanceMode: String(guidanceMode || "navsys:orbital-refuel-approach"),
      lockTarget: false,
    };
  }
  if (phase === FLEET_TRANSFER_PHASES.HOLD_POINT) {
    return {
      requestedThrottle: 0,
      desiredDirection: safeDirection,
      guidanceMode: composeMode(guidanceMode, "orbital-refuel-hold-point"),
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
      requestedThrottle: 0.26,
      desiredDirection: scale(safeDirection, -1),
      guidanceMode: "navsys:orbital-refuel-abort-brake",
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
  distanceKm = 0,
  relativeSpeedKmS = 0,
} = {}) {
  const safePrograde = normalize(prograde, { x: 0, y: 1, z: 0 });
  const toTarget = normalize(directionToTarget, safePrograde);
  const targetRelativePositionKm = target?.relativePositionKm || { x: 0, y: 0, z: 0 };
  const targetRelativeVelocityKmS = target?.relativeVelocityKmS || { x: 0, y: 0, z: 0 };
  const shipMinusTargetRelVel = scale(targetRelativeVelocityKmS, -1);
  const up = normalize({ x: 0, y: 0, z: Number(safePrograde.z) >= 0 ? 1 : -1 }, { x: 0, y: 0, z: 1 });
  const crossTrack = normalize(
    {
      x: (safePrograde.y * up.z) - (safePrograde.z * up.y),
      y: (safePrograde.z * up.x) - (safePrograde.x * up.z),
      z: (safePrograde.x * up.y) - (safePrograde.y * up.x),
    },
    { x: 1, y: 0, z: 0 },
  );
  const alongKm = (
    (Number(targetRelativePositionKm.x) || 0) * safePrograde.x
    + (Number(targetRelativePositionKm.y) || 0) * safePrograde.y
    + (Number(targetRelativePositionKm.z) || 0) * safePrograde.z
  );
  const radialKm = (
    (Number(targetRelativePositionKm.x) || 0) * up.x
    + (Number(targetRelativePositionKm.y) || 0) * up.y
    + (Number(targetRelativePositionKm.z) || 0) * up.z
  );
  const crossKm = (
    (Number(targetRelativePositionKm.x) || 0) * crossTrack.x
    + (Number(targetRelativePositionKm.y) || 0) * crossTrack.y
    + (Number(targetRelativePositionKm.z) || 0) * crossTrack.z
  );
  const distance = Math.max(0, Number(distanceKm) || 0);
  const desiredClosingKmS = distance > 80
    ? clamp(distance / 2200, 0.02, 0.055)
    : (
      distance > 20
        ? clamp(distance / 3800, 0.005, 0.02)
        : (
          distance > 2
            ? clamp(distance / 2500, 0.0008, 0.005)
            : (
              distance > 0.5
                ? clamp(distance / 4000, 0.00012, 0.0009)
                : clamp(distance / 7000, 0.00002, 0.00018)
            )
        )
    );
  const desiredShipMinusTargetRelVel = scale(toTarget, desiredClosingKmS);
  const velocityErrorKmS = {
    x: (Number(desiredShipMinusTargetRelVel.x) || 0) - (Number(shipMinusTargetRelVel.x) || 0),
    y: (Number(desiredShipMinusTargetRelVel.y) || 0) - (Number(shipMinusTargetRelVel.y) || 0),
    z: (Number(desiredShipMinusTargetRelVel.z) || 0) - (Number(shipMinusTargetRelVel.z) || 0),
  };
  const phasingDirection = alongKm >= 0
    ? scale(safePrograde, -1)
    : safePrograde;
  const radialCorrectionDirection = radialKm >= 0
    ? scale(up, -1)
    : up;
  const crossCorrectionDirection = crossKm >= 0
    ? scale(crossTrack, -1)
    : crossTrack;
  const direction = normalize(
    {
      x: ((Number(velocityErrorKmS.x) || 0) * 0.74)
        + (phasingDirection.x * clamp(Math.abs(alongKm) / 220, 0, 0.22))
        + (radialCorrectionDirection.x * clamp(Math.abs(radialKm) / 180, 0, 0.13))
        + (crossCorrectionDirection.x * clamp(Math.abs(crossKm) / 180, 0, 0.13)),
      y: ((Number(velocityErrorKmS.y) || 0) * 0.74)
        + (phasingDirection.y * clamp(Math.abs(alongKm) / 220, 0, 0.22))
        + (radialCorrectionDirection.y * clamp(Math.abs(radialKm) / 180, 0, 0.13))
        + (crossCorrectionDirection.y * clamp(Math.abs(crossKm) / 180, 0, 0.13)),
      z: ((Number(velocityErrorKmS.z) || 0) * 0.74)
        + (phasingDirection.z * clamp(Math.abs(alongKm) / 220, 0, 0.22))
        + (radialCorrectionDirection.z * clamp(Math.abs(radialKm) / 180, 0, 0.13))
        + (crossCorrectionDirection.z * clamp(Math.abs(crossKm) / 180, 0, 0.13)),
    },
    toTarget,
  );
  if (distance <= 2.0) {
    return {
      requestedThrottle: 0,
      desiredDirection: direction,
      guidanceMode: "navsys:orbital-refuel-rcs-translate",
    };
  }
  const relSpeed = Math.max(0, Number(relativeSpeedKmS) || 0);
  const velocityErrorMagKmS = Math.max(0, relSpeed - desiredClosingKmS);
  const throttle = distance > 20
    ? clamp(0.05 + (velocityErrorMagKmS * 2.2), 0.05, 0.22)
    : clamp(0.03 + (velocityErrorMagKmS * 1.8), 0.03, 0.12);
  const mode = distance > 80
    ? "navsys:orbital-refuel-coelliptic-phasing"
    : (distance > 8 ? "navsys:orbital-refuel-transfer-burn" : "navsys:orbital-refuel-velocity-match");
  return {
    requestedThrottle: throttle,
    desiredDirection: direction,
    guidanceMode: mode,
  };
}

export function updateFleetTransferGuidance({
  vehicle,
  target = null,
  shipState = null,
  tankerState = null,
  earthState = null,
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
      transfer.abortRemainingSec = 0;
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
  transfer.shipAlignmentDeg = alignment.shipAlignmentDeg;
  transfer.tankerAlignmentDeg = alignment.tankerAlignmentDeg;
  transfer.corridorAlignmentDeg = alignment.corridorAlignmentDeg;

  const distanceKm = Math.max(0, Number(target.distanceKm) || 0);
  const relativeSpeedKmS = Math.max(0, Number(target.relativeSpeedKmS) || 0);
  const closingSpeedKmS = Math.max(0, Number(target.closingSpeedKmS) || 0);
  transfer.lastDistanceKm = distanceKm;
  transfer.lastRelativeSpeedKmS = relativeSpeedKmS;

  const holdDistanceKm = Math.max(
    0.3,
    Number(REFUEL_TANKER_CONFIG.dockHoldPointDistanceKm) || 0.065,
  );
  const holdSpeedKmS = Math.max(0.00025, Number(REFUEL_TANKER_CONFIG.dockHoldPointMaxRelativeSpeedKmS) || 0.000085);
  const holdStableRequiredSec = Math.max(4, Number(REFUEL_TANKER_CONFIG.dockHoldPointStableSec) || 10);
  const dockDistanceKm = Math.max(0.005, Number(REFUEL_TANKER_CONFIG.dockDistanceKm) || 0.014);
  const dockSpeedKmS = Math.max(0.00002, Number(REFUEL_TANKER_CONFIG.dockMaxRelativeSpeedKmS) || 0.000045);
  const dockStableRequiredSec = Math.max(2, Number(REFUEL_TANKER_CONFIG.dockStableSeconds) || 8);
  const abortDistanceKm = Math.max(dockDistanceKm * 2, Number(REFUEL_TANKER_CONFIG.dockAbortDistanceKm) || 0.22);
  const abortRelativeSpeedKmS = Math.max(
    dockSpeedKmS * 2,
    Number(REFUEL_TANKER_CONFIG.dockAbortRelativeSpeedKmS) || 0.00014,
  );
  const abortAttitudeDeg = Math.max(12, Number(REFUEL_TANKER_CONFIG.dockAbortAttitudeErrorDeg) || 16);
  const shipAlignGateDeg = Math.max(2, Number(REFUEL_TANKER_CONFIG.dockShipAttitudeMaxErrorDeg) || 9);
  const tankerAlignGateDeg = Math.max(2, Number(REFUEL_TANKER_CONFIG.dockTankerAttitudeMaxErrorDeg) || 8);

  const holdStable = (
    distanceKm <= (holdDistanceKm * 1.35)
    && distanceKm >= (holdDistanceKm * 0.55)
    && relativeSpeedKmS <= (holdSpeedKmS * 1.25)
    && alignment.shipAlignmentDeg <= Math.max(shipAlignGateDeg * 1.4, 12)
    && alignment.tankerAlignmentDeg <= Math.max(tankerAlignGateDeg * 1.4, 12)
    && alignment.corridorAlignmentDeg <= 22
  );
  const dockStable = (
    distanceKm <= (dockDistanceKm * 1.1)
    && relativeSpeedKmS <= (dockSpeedKmS * 1.2)
    && alignment.shipAlignmentDeg <= shipAlignGateDeg
    && alignment.tankerAlignmentDeg <= tankerAlignGateDeg
    && alignment.corridorAlignmentDeg <= 9
  );
  const abortTrigger = (
    distanceKm > abortDistanceKm
    || relativeSpeedKmS > abortRelativeSpeedKmS
    || alignment.shipAlignmentDeg > abortAttitudeDeg
    || alignment.tankerAlignmentDeg > abortAttitudeDeg
  );
  const emergencyOverspeed = (
    distanceKm <= Math.max(250, holdDistanceKm * 280)
    && (
      relativeSpeedKmS > 0.08
      || closingSpeedKmS > 0.06
    )
  );

  const previousPhase = transfer.phase;
  if (transfer.phase === FLEET_TRANSFER_PHASES.IDLE) {
    transfer.phase = stageDeficitKg <= 1e-3
      ? FLEET_TRANSFER_PHASES.COMPLETE
      : FLEET_TRANSFER_PHASES.APPROACH;
  } else if (transfer.phase === FLEET_TRANSFER_PHASES.COMPLETE && stageDeficitKg > 1e-3) {
    transfer.phase = FLEET_TRANSFER_PHASES.APPROACH;
  }

  if (transfer.phase === FLEET_TRANSFER_PHASES.APPROACH) {
    transfer.holdPointStableSec = 0;
    transfer.dockStableSec = 0;
    if (emergencyOverspeed) {
      transfer.phase = FLEET_TRANSFER_PHASES.ABORTING;
      transfer.abortRemainingSec = Math.max(8, Number(REFUEL_TANKER_CONFIG.dockAbortDurationSec) || 36);
      transfer.lastAction = "overspeed_abort";
      transfer.lastActionTimeSec = safeNow;
    } else if (
      distanceKm <= (holdDistanceKm * 2.1)
      && relativeSpeedKmS <= Math.max(holdSpeedKmS * 8, 0.0016)
    ) {
      transfer.phase = FLEET_TRANSFER_PHASES.HOLD_POINT;
    }
  } else if (transfer.phase === FLEET_TRANSFER_PHASES.HOLD_POINT) {
    transfer.holdPointStableSec = holdStable
      ? Math.min(holdStableRequiredSec, transfer.holdPointStableSec + safeDt)
      : 0;
    if (emergencyOverspeed) {
      transfer.phase = FLEET_TRANSFER_PHASES.ABORTING;
      transfer.abortRemainingSec = Math.max(8, Number(REFUEL_TANKER_CONFIG.dockAbortDurationSec) || 36);
      transfer.lastAction = "overspeed_abort";
      transfer.lastActionTimeSec = safeNow;
    } else if (transfer.holdPointStableSec + 1e-6 >= holdStableRequiredSec) {
      transfer.phase = FLEET_TRANSFER_PHASES.FINAL_APPROACH;
      transfer.dockStableSec = 0;
    } else if (distanceKm > (holdDistanceKm * 3.4)) {
      transfer.phase = FLEET_TRANSFER_PHASES.APPROACH;
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
    transfer.abortRemainingSec = Math.max(0, Number(transfer.abortRemainingSec) || 0);
    if (transfer.abortRemainingSec <= 1e-6) {
      transfer.phase = FLEET_TRANSFER_PHASES.APPROACH;
      transfer.holdPointStableSec = 0;
      transfer.dockStableSec = 0;
    }
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

  const approachGuidance = transfer.phase === FLEET_TRANSFER_PHASES.APPROACH
    ? computeApproachGuidance({
      target,
      prograde,
      directionToTarget,
      distanceKm,
      relativeSpeedKmS,
    })
    : null;
  const mode = phaseWithMode({
    phase: transfer.phase,
    guidanceMode: approachGuidance?.guidanceMode || guidanceMode,
    requestedThrottle: approachGuidance
      ? approachGuidance.requestedThrottle
      : clamp(Number(requestedThrottle) || 0, 0, 1),
    desiredDirection: approachGuidance?.desiredDirection || directionToTarget,
    directionFallback: prograde || { x: 0, y: 1, z: 0 },
  });
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

  if (transfer.phase === FLEET_TRANSFER_PHASES.ABORTING) {
    transfer.abortRemainingSec = Math.max(0, (Number(transfer.abortRemainingSec) || 0) - safeDt);
    if (transfer.abortRemainingSec <= 1e-6) {
      transfer.phase = FLEET_TRANSFER_PHASES.APPROACH;
      transfer.holdPointStableSec = 0;
      transfer.dockStableSec = 0;
      transfer.lockStableSec = 0;
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
    shipAlignmentDeg: finiteNumber(transfer?.shipAlignmentDeg, null),
    tankerAlignmentDeg: finiteNumber(transfer?.tankerAlignmentDeg, null),
    corridorAlignmentDeg: finiteNumber(transfer?.corridorAlignmentDeg, null),
  };
}
