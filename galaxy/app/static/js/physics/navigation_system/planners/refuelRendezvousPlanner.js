import {
  add,
  clamp,
  dot,
  finiteVector,
  length,
  normalize,
  scale,
  subtract,
} from "../navigationMath.js";
import { REFUEL_TANKER_CONFIG } from "../../launch/refuel/config.js";

const EPSILON = 1e-9;
const ZERO_VECTOR = Object.freeze({ x: 0, y: 0, z: 0 });

function cross(a, b) {
  return {
    x: ((Number(a?.y) || 0) * (Number(b?.z) || 0)) - ((Number(a?.z) || 0) * (Number(b?.y) || 0)),
    y: ((Number(a?.z) || 0) * (Number(b?.x) || 0)) - ((Number(a?.x) || 0) * (Number(b?.z) || 0)),
    z: ((Number(a?.x) || 0) * (Number(b?.y) || 0)) - ((Number(a?.y) || 0) * (Number(b?.x) || 0)),
  };
}

function projectedCoastClosestApproach({
  relativePositionKm = null,
  relativeVelocityKmS = null,
  horizonSec = 1_800,
} = {}) {
  if (!finiteVector(relativePositionKm)) {
    return {
      distanceKm: Number.POSITIVE_INFINITY,
      timeToClosestSec: 0,
    };
  }
  if (!finiteVector(relativeVelocityKmS)) {
    return {
      distanceKm: length(relativePositionKm),
      timeToClosestSec: 0,
    };
  }
  const speedSq = dot(relativeVelocityKmS, relativeVelocityKmS);
  if (!(speedSq > EPSILON)) {
    return {
      distanceKm: length(relativePositionKm),
      timeToClosestSec: 0,
    };
  }
  const safeHorizonSec = Math.max(60, Number(horizonSec) || 1_800);
  const timeToClosestSec = clamp(
    -dot(relativePositionKm, relativeVelocityKmS) / speedSq,
    0,
    safeHorizonSec,
  );
  return {
    distanceKm: length(add(relativePositionKm, scale(relativeVelocityKmS, timeToClosestSec))),
    timeToClosestSec,
  };
}

function resolveRefuelFrame({
  tangentDirection,
  toTargetDirection,
  toTargetVectorKm,
  shipMinusTargetRelVel,
  targetMinusShipRelVel,
} = {}) {
  const prograde = normalize(tangentDirection, { x: 0, y: 1, z: 0 });
  const toTarget = normalize(toTargetDirection, prograde);
  const upSeed = Math.abs(Number(prograde.z) || 0) < 0.9
    ? { x: 0, y: 0, z: 1 }
    : { x: 1, y: 0, z: 0 };
  const radial = normalize(
    subtract(toTarget, scale(prograde, dot(toTarget, prograde))),
    normalize(cross(prograde, upSeed), { x: 1, y: 0, z: 0 }),
  );
  const crossTrack = normalize(
    cross(prograde, radial),
    normalize(cross(radial, upSeed), { x: 0, y: 0, z: 1 }),
  );

  return {
    prograde,
    radial,
    crossTrack,
    toTarget,
    alongKm: dot(toTargetVectorKm, prograde),
    radialKm: dot(toTargetVectorKm, radial),
    crossKm: dot(toTargetVectorKm, crossTrack),
    alongRateKmS: dot(targetMinusShipRelVel, prograde),
    radialRateKmS: dot(targetMinusShipRelVel, radial),
    crossRateKmS: dot(targetMinusShipRelVel, crossTrack),
    closingSpeedKmS: dot(shipMinusTargetRelVel, toTarget),
  };
}

function desiredClosingSpeedKmS(distanceKm) {
  if (!Number.isFinite(distanceKm) || !(distanceKm > 0)) {
    return 0;
  }
  if (distanceKm > 60) {
    return clamp(distanceKm / 140_000, 0.01, 0.06);
  }
  if (distanceKm > 8) {
    return clamp(distanceKm / 48_000, 0.0012, 0.014);
  }
  if (distanceKm > 1.2) {
    return clamp(distanceKm / 20_000, 0.00018, 0.0028);
  }
  return clamp(distanceKm * 0.00005, 0.000004, 0.000075);
}

function buildCommand({
  phase,
  throttle = 0,
  direction = null,
  mode,
  rcsAssistProfile = "off",
  rationale = "",
  relative = null,
  fallbackDirection = { x: 0, y: 1, z: 0 },
} = {}) {
  const commandPhase = String(phase || "").trim() === "powered"
    ? "powered"
    : "coast";
  const powered = commandPhase === "powered";
  const normalizedDirection = normalize(direction, fallbackDirection);
  const safeProfile = String(rcsAssistProfile || "off").trim() || "off";
  const rcsTranslation = safeProfile !== "off";
  return {
    phase: commandPhase,
    throttle: powered ? clamp(Number(throttle) || 0, 0, 1) : 0,
    direction: normalizedDirection,
    mode: String(mode || "navsys:orbital-refuel-await-target"),
    actuators: {
      primary: powered ? "main-engine" : "rcs",
      mainEngine: powered,
      rcsTranslation,
      rcsAttitude: true,
      rationale: String(rationale || ""),
    },
    rcsAssistProfile: safeProfile,
    relative,
  };
}

export function planRefuelRendezvousCommand({
  targetVectors = {},
  metrics = {},
  tangent = null,
  plannerConfig = null,
} = {}) {
  const tangentDirection = normalize(tangent || targetVectors.tangent, { x: 0, y: 1, z: 0 });
  const toRefuelTarget = finiteVector(targetVectors.toRefuelTarget)
    ? targetVectors.toRefuelTarget
    : null;
  const refuelDistanceKm = Number(metrics.refuelTargetDistanceKm);
  if (!toRefuelTarget || !Number.isFinite(refuelDistanceKm) || !(refuelDistanceKm > 0)) {
    return buildCommand({
      phase: "coast",
      direction: tangentDirection,
      mode: "navsys:orbital-refuel-await-target",
      rationale: "No eligible tanker track yet.",
      fallbackDirection: tangentDirection,
    });
  }

  const dockDistanceKm = Math.max(0.005, Number(REFUEL_TANKER_CONFIG.dockDistanceKm) || 0.014);
  const dockSpeedKmS = Math.max(0.00002, Number(REFUEL_TANKER_CONFIG.dockMaxRelativeSpeedKmS) || 0.000045);
  const targetMinusShipRelVel = finiteVector(targetVectors.refuelTargetRelativeVelocityKmS)
    ? targetVectors.refuelTargetRelativeVelocityKmS
    : { ...ZERO_VECTOR };
  const shipMinusTargetRelVel = scale(targetMinusShipRelVel, -1);
  const relativeSpeedKmS = Number.isFinite(Number(metrics.refuelRelativeSpeedKmS))
    ? Math.max(0, Number(metrics.refuelRelativeSpeedKmS))
    : length(targetMinusShipRelVel);
  const frame = resolveRefuelFrame({
    tangentDirection,
    toTargetDirection: normalize(toRefuelTarget, tangentDirection),
    toTargetVectorKm: toRefuelTarget,
    shipMinusTargetRelVel,
    targetMinusShipRelVel,
  });

  const relativeDiagnostic = {
    distanceKm: refuelDistanceKm,
    relativeSpeedKmS,
    closingSpeedKmS: frame.closingSpeedKmS,
    alongKm: frame.alongKm,
    radialKm: frame.radialKm,
    crossKm: frame.crossKm,
    alongRateKmS: frame.alongRateKmS,
    radialRateKmS: frame.radialRateKmS,
    crossRateKmS: frame.crossRateKmS,
  };

  if (refuelDistanceKm <= dockDistanceKm && relativeSpeedKmS <= dockSpeedKmS) {
    return buildCommand({
      phase: "coast",
      direction: tangentDirection,
      mode: "navsys:orbital-refuel-docked-hold",
      rcsAssistProfile: "fine",
      rationale: "Dock corridor and relative velocity are inside lock limits.",
      relative: relativeDiagnostic,
      fallbackDirection: tangentDirection,
    });
  }

  const finalApproachDistanceKm = Math.max(
    dockDistanceKm * 2.8,
    Number(plannerConfig?.refuelFinalApproachDistanceKm) || 0.08,
  );
  const rcsOnlyDistanceKm = Math.max(
    finalApproachDistanceKm * 2.2,
    Number(plannerConfig?.refuelRcsOnlyDistanceKm) || 1.2,
  );
  const midDistanceKm = Math.max(
    rcsOnlyDistanceKm * 1.8,
    Number(plannerConfig?.refuelMidDistanceKm) || 8,
  );
  const farDistanceKm = Math.max(
    midDistanceKm + 5,
    Number(plannerConfig?.refuelFarDistanceKm) || 60,
  );
  const desiredClosingKmS = desiredClosingSpeedKmS(refuelDistanceKm);

  const targetAheadInTrack = frame.alongKm >= 0;
  const phasingDirection = targetAheadInTrack
    ? scale(frame.prograde, -1)
    : frame.prograde;
  const velocityMatchDirection = normalize(targetMinusShipRelVel, scale(frame.toTarget, -1));
  const interceptDirection = normalize(
    add(
      add(
        scale(frame.toTarget, 0.66),
        scale(velocityMatchDirection, 0.24),
      ),
      add(
        scale(frame.radial, clamp((frame.radialKm / 140) - (frame.radialRateKmS / 0.018), -0.12, 0.12)),
        scale(frame.crossTrack, clamp((frame.crossKm / 120) - (frame.crossRateKmS / 0.016), -0.1, 0.1)),
      ),
    ),
    frame.toTarget,
  );
  const longRangePhasingDirection = normalize(
    add(scale(phasingDirection, 0.72), scale(interceptDirection, 0.28)),
    phasingDirection,
  );

  const coastHorizonSec = clamp(
    Number(plannerConfig?.refuelCoastWindowHorizonSec) || (refuelDistanceKm > 80 ? 4_800 : 2_400),
    400,
    9_600,
  );
  const coastClosest = projectedCoastClosestApproach({
    relativePositionKm: toRefuelTarget,
    relativeVelocityKmS: targetMinusShipRelVel,
    horizonSec: coastHorizonSec,
  });
  const coastDistanceGateKm = Math.max(
    dockDistanceKm * 4,
    refuelDistanceKm * clamp(Number(plannerConfig?.refuelCoastWindowDistanceScale) || 0.62, 0.35, 0.9),
  );
  const coastWindowUsable = Number.isFinite(coastClosest.distanceKm)
    && coastClosest.distanceKm <= coastDistanceGateKm
    && coastClosest.timeToClosestSec <= (coastHorizonSec * 0.9);

  if (refuelDistanceKm <= finalApproachDistanceKm) {
    return buildCommand({
      phase: "coast",
      direction: frame.prograde,
      mode: "navsys:orbital-refuel-final-approach",
      rcsAssistProfile: "fine",
      rationale: "Inside final approach corridor; hold main engines off and translate with RCS only.",
      relative: {
        ...relativeDiagnostic,
        desiredClosingKmS,
      },
      fallbackDirection: frame.prograde,
    });
  }

  if (refuelDistanceKm <= rcsOnlyDistanceKm) {
    const separating = frame.closingSpeedKmS < -(desiredClosingKmS * 1.2);
    if (separating) {
      return buildCommand({
        phase: "powered",
        throttle: clamp(0.008 + (Math.abs(frame.closingSpeedKmS) * 8), 0.008, 0.03),
        direction: interceptDirection,
        mode: "navsys:orbital-refuel-rcs-reacquire-burn",
        rcsAssistProfile: "fine",
        rationale: "Range is close but separation is growing; apply tiny corrective burn before returning to RCS translation.",
        relative: {
          ...relativeDiagnostic,
          desiredClosingKmS,
          coastClosestDistanceKm: coastClosest.distanceKm,
          coastClosestTimeSec: coastClosest.timeToClosestSec,
        },
        fallbackDirection: frame.prograde,
      });
    }
    return buildCommand({
      phase: "coast",
      direction: frame.prograde,
      mode: "navsys:orbital-refuel-rcs-translate",
      rcsAssistProfile: "fine",
      rationale: "Close approach corridor; translational closure is delegated to RCS.",
      relative: {
        ...relativeDiagnostic,
        desiredClosingKmS,
      },
      fallbackDirection: frame.prograde,
    });
  }

  if (refuelDistanceKm <= midDistanceKm) {
    const tooFastForMid = frame.closingSpeedKmS > (desiredClosingKmS * 2.1)
      || relativeSpeedKmS > Math.max(0.0024, dockSpeedKmS * 18);
    if (tooFastForMid) {
      return buildCommand({
        phase: "powered",
        throttle: clamp(0.012 + (relativeSpeedKmS * 4.5), 0.012, 0.09),
        direction: velocityMatchDirection,
        mode: "navsys:orbital-refuel-velocity-match",
        rcsAssistProfile: "coarse",
        rationale: "Mid-range closure is too fast; burn opposite relative velocity to match tanker speed.",
        relative: {
          ...relativeDiagnostic,
          desiredClosingKmS,
        },
        fallbackDirection: frame.prograde,
      });
    }
    if (coastWindowUsable && frame.closingSpeedKmS >= (desiredClosingKmS * 0.72)) {
      return buildCommand({
        phase: "coast",
        direction: frame.prograde,
        mode: "navsys:orbital-refuel-coast-window",
        rcsAssistProfile: "coarse",
        rationale: "Natural orbital geometry can reduce range safely; coast window selected.",
        relative: {
          ...relativeDiagnostic,
          desiredClosingKmS,
          coastClosestDistanceKm: coastClosest.distanceKm,
          coastClosestTimeSec: coastClosest.timeToClosestSec,
        },
        fallbackDirection: frame.prograde,
      });
    }
    return buildCommand({
      phase: "powered",
      throttle: clamp(0.02 + (refuelDistanceKm / 220), 0.02, 0.1),
      direction: interceptDirection,
      mode: "navsys:orbital-refuel-transfer-burn",
      rcsAssistProfile: "coarse",
      rationale: "Mid-range rendezvous burn for range closure with relative-velocity damping.",
      relative: {
        ...relativeDiagnostic,
        desiredClosingKmS,
      },
      fallbackDirection: frame.prograde,
    });
  }

  if (refuelDistanceKm <= farDistanceKm) {
    const highEnergyMismatch = relativeSpeedKmS > 0.05
      || frame.closingSpeedKmS > (desiredClosingKmS * 2.4);
    if (highEnergyMismatch) {
      return buildCommand({
        phase: "powered",
        throttle: clamp(0.03 + (Math.max(0, relativeSpeedKmS - desiredClosingKmS) * 1.8), 0.03, 0.16),
        direction: velocityMatchDirection,
        mode: "navsys:orbital-refuel-velocity-match",
        rationale: "High relative energy requires velocity-matching burn before precision closure.",
        relative: {
          ...relativeDiagnostic,
          desiredClosingKmS,
        },
        fallbackDirection: frame.prograde,
      });
    }
    if (coastWindowUsable && frame.closingSpeedKmS >= (desiredClosingKmS * 0.82)) {
      return buildCommand({
        phase: "coast",
        direction: frame.prograde,
        mode: "navsys:orbital-refuel-coast-window",
        rationale: "Relative trajectory already converges; hold propellant and coast.",
        relative: {
          ...relativeDiagnostic,
          desiredClosingKmS,
          coastClosestDistanceKm: coastClosest.distanceKm,
          coastClosestTimeSec: coastClosest.timeToClosestSec,
        },
        fallbackDirection: frame.prograde,
      });
    }
    return buildCommand({
      phase: "powered",
      throttle: clamp(0.05 + (refuelDistanceKm / 320), 0.05, 0.18),
      direction: normalize(
        add(
          scale(interceptDirection, 0.84),
          scale(phasingDirection, 0.16),
        ),
        interceptDirection,
      ),
      mode: "navsys:orbital-refuel-transfer-burn",
      rationale: "Transfer burn to collapse range while keeping orbit geometry aligned.",
      relative: {
        ...relativeDiagnostic,
        desiredClosingKmS,
      },
      fallbackDirection: frame.prograde,
    });
  }

  if (coastWindowUsable && coastClosest.distanceKm <= (refuelDistanceKm * 0.58)) {
    return buildCommand({
      phase: "coast",
      direction: frame.prograde,
      mode: "navsys:orbital-refuel-phase-coast-window",
      rationale: "Long-range phasing has a favorable passive intercept window; coast and preserve propellant.",
      relative: {
        ...relativeDiagnostic,
        desiredClosingKmS,
        coastClosestDistanceKm: coastClosest.distanceKm,
        coastClosestTimeSec: coastClosest.timeToClosestSec,
      },
      fallbackDirection: frame.prograde,
    });
  }

  return buildCommand({
    phase: "powered",
    throttle: clamp(0.08 + (refuelDistanceKm / 2_400), 0.08, 0.24),
    direction: longRangePhasingDirection,
    mode: "navsys:orbital-refuel-phasing-burn",
    rationale: "Long-range phasing burn: reshape orbital period first, then converge for transfer.",
    relative: {
      ...relativeDiagnostic,
      desiredClosingKmS,
    },
    fallbackDirection: frame.prograde,
  });
}
