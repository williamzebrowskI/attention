import {
  add,
  clamp,
  dot,
  finiteVector,
  length,
  normalize,
  scale,
} from "../navigationMath.js";
import { REFUEL_TANKER_CONFIG } from "../../launch/refuel/config.js";

const DEFAULT_REFUEL_ACCEL_AT_THROTTLE1_KM_S2 = 0.0024;

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
  const relSpeedSq = dot(relativeVelocityKmS, relativeVelocityKmS);
  if (!(relSpeedSq > 1e-12)) {
    return {
      distanceKm: length(relativePositionKm),
      timeToClosestSec: 0,
    };
  }
  const safeHorizonSec = Math.max(1, Number(horizonSec) || 1);
  const timeToClosestSec = clamp(
    -dot(relativePositionKm, relativeVelocityKmS) / relSpeedSq,
    0,
    safeHorizonSec,
  );
  return {
    distanceKm: length(add(
      relativePositionKm,
      scale(relativeVelocityKmS, timeToClosestSec),
    )),
    timeToClosestSec,
  };
}

function legacyRefuelRendezvousCommand({
  refuelDistanceKm,
  refuelRelativeSpeedKmS,
  tangentDirection,
  directionToTarget,
  shipMinusTargetRelVel,
  targetMinusShipRelVel,
  dockDistanceKm,
  dockSpeedKmS,
}) {
  const relativeSpeedKmS = Number.isFinite(refuelRelativeSpeedKmS)
    ? Math.max(0, refuelRelativeSpeedKmS)
    : length(targetMinusShipRelVel || { x: 0, y: 0, z: 0 });
  const closingSpeedKmS = Number.isFinite(refuelDistanceKm) && refuelDistanceKm > 1e-9
    ? dot(shipMinusTargetRelVel, directionToTarget)
    : 0;
  if (refuelDistanceKm <= dockDistanceKm && relativeSpeedKmS <= dockSpeedKmS) {
    return {
      phase: "coast",
      throttle: 0,
      direction: tangentDirection,
      mode: "navsys:orbital-refuel-docked-hold",
    };
  }

  if (refuelDistanceKm > 15) {
    const throttle = clamp(0.12 + (refuelDistanceKm / 220), 0.12, 0.34);
    const direction = normalize(
      add(
        scale(directionToTarget, 0.92),
        scale(tangentDirection, 0.08),
      ),
      directionToTarget,
    );
    return {
      phase: "powered",
      throttle,
      direction,
      mode: "navsys:orbital-refuel-rendezvous-far",
    };
  }

  if (refuelDistanceKm > 1.5) {
    const velocityDampingDir = normalize(scale(shipMinusTargetRelVel, -1), directionToTarget);
    const direction = normalize(
      add(
        scale(directionToTarget, 0.72),
        scale(velocityDampingDir, 0.28),
      ),
      directionToTarget,
    );
    const throttle = clamp(
      0.028 + (refuelDistanceKm / 120) + (relativeSpeedKmS * 28),
      0.02,
      0.12,
    );
    return {
      phase: "powered",
      throttle,
      direction,
      mode: "navsys:orbital-refuel-rendezvous-mid",
    };
  }

  const desiredClosingKmS = clamp(refuelDistanceKm * 0.00009, 0.00001, 0.00008);
  if (closingSpeedKmS > (desiredClosingKmS * 1.35) || relativeSpeedKmS > 0.00028) {
    const brakeDirection = normalize(scale(shipMinusTargetRelVel, -1), scale(directionToTarget, -1));
    return {
      phase: "powered",
      throttle: clamp(0.003 + (relativeSpeedKmS * 22), 0.003, 0.03),
      direction: brakeDirection,
      mode: "navsys:orbital-refuel-brake",
    };
  }

  const closeApproachDirection = normalize(
    add(
      scale(directionToTarget, 0.58),
      scale(normalize(scale(shipMinusTargetRelVel, -1), directionToTarget), 0.42),
    ),
    directionToTarget,
  );
  return {
    phase: "powered",
    throttle: clamp(0.002 + (refuelDistanceKm * 0.01), 0.002, 0.02),
    direction: closeApproachDirection,
    mode: "navsys:orbital-refuel-final-approach",
  };
}

function evaluateRendezvousCandidate({
  candidate = null,
  toRefuelTarget = null,
  targetMinusShipRelVel = null,
  refuelDistanceKm = Number.POSITIVE_INFINITY,
  dockDistanceKm = 0.014,
  dockSpeedKmS = 0.000045,
  accelAtThrottle1KmS2 = DEFAULT_REFUEL_ACCEL_AT_THROTTLE1_KM_S2,
  horizonSec = 1_800,
  burnDurationSec = 24,
  steps = 48,
  directionToTarget = { x: 0, y: 1, z: 0 },
} = {}) {
  if (!candidate || !finiteVector(toRefuelTarget) || !finiteVector(targetMinusShipRelVel)) {
    return null;
  }
  const phase = String(candidate.phase || "").trim() === "coast"
    ? "coast"
    : "powered";
  const throttle = phase === "powered"
    ? clamp(Number(candidate.throttle) || 0, 0, 1)
    : 0;
  const direction = normalize(candidate.direction, directionToTarget);
  const safeHorizonSec = Math.max(180, Number(horizonSec) || 1_800);
  const safeBurnSec = clamp(Number(burnDurationSec) || 0, 0, safeHorizonSec);
  const safeSteps = Math.max(12, Math.min(180, Math.round(Number(steps) || 48)));
  const dtSec = safeHorizonSec / safeSteps;

  const commandAccelKmS2 = scale(
    direction,
    Math.max(0, Number(accelAtThrottle1KmS2) || 0) * throttle,
  );
  let relPos = {
    x: Number(toRefuelTarget.x) || 0,
    y: Number(toRefuelTarget.y) || 0,
    z: Number(toRefuelTarget.z) || 0,
  };
  let relVel = {
    x: Number(targetMinusShipRelVel.x) || 0,
    y: Number(targetMinusShipRelVel.y) || 0,
    z: Number(targetMinusShipRelVel.z) || 0,
  };

  let minRangeKm = length(relPos);
  let relSpeedAtMinRangeKmS = length(relVel);
  let closingAtMinRangeKmS = minRangeKm > 1e-9
    ? -dot(relVel, scale(relPos, 1 / minRangeKm))
    : 0;
  let finalRangeKm = minRangeKm;
  let finalRelSpeedKmS = relSpeedAtMinRangeKmS;
  let finalClosingKmS = closingAtMinRangeKmS;

  for (let stepIndex = 0; stepIndex < safeSteps; stepIndex += 1) {
    const tSec = stepIndex * dtSec;
    if (phase === "powered" && throttle > 1e-6 && tSec < safeBurnSec) {
      // Relative velocity is target-minus-ship, so ship thrust subtracts from it.
      relVel = add(relVel, scale(commandAccelKmS2, -dtSec));
    }
    relPos = add(relPos, scale(relVel, dtSec));
    const rangeKm = length(relPos);
    const relSpeedKmS = length(relVel);
    const radialDirection = rangeKm > 1e-9
      ? scale(relPos, 1 / rangeKm)
      : directionToTarget;
    const closingKmS = -dot(relVel, radialDirection);
    if (rangeKm < minRangeKm) {
      minRangeKm = rangeKm;
      relSpeedAtMinRangeKmS = relSpeedKmS;
      closingAtMinRangeKmS = closingKmS;
    }
    finalRangeKm = rangeKm;
    finalRelSpeedKmS = relSpeedKmS;
    finalClosingKmS = closingKmS;
  }

  const distanceBand = refuelDistanceKm > 15
    ? "far"
    : (refuelDistanceKm > 1.5 ? "mid" : "close");
  const desiredMinRangeKm = distanceBand === "far"
    ? Math.max(dockDistanceKm * 1.1, refuelDistanceKm * 0.08)
    : (distanceBand === "mid"
      ? Math.max(dockDistanceKm * 1.1, refuelDistanceKm * 0.18)
      : dockDistanceKm * 1.02);
  const speedLimitKmS = distanceBand === "far"
    ? 0.22
    : (distanceBand === "mid" ? 0.006 : Math.max(0.0002, dockSpeedKmS * 4.5));
  const desiredClosingKmS = distanceBand === "far"
    ? clamp(refuelDistanceKm / 85_000, 0.01, 0.2)
    : (distanceBand === "mid"
      ? clamp(refuelDistanceKm / 12_000, 0.0002, 0.01)
      : clamp(refuelDistanceKm * 0.00009, 0.00001, 0.00008));
  const directionalPenalty = Math.max(0, -dot(direction, directionToTarget));
  let score = 0;
  score += Math.max(0, minRangeKm - desiredMinRangeKm) * 220;
  score += Math.max(0, relSpeedAtMinRangeKmS - speedLimitKmS) * 11_500;
  score += Math.max(0, desiredClosingKmS - Math.max(0, closingAtMinRangeKmS)) * 8_600;
  score += Math.max(0, -closingAtMinRangeKmS) * 9_500;
  score += Math.max(0, finalRangeKm - minRangeKm) * 120;
  score += Math.max(0, finalRelSpeedKmS - relSpeedAtMinRangeKmS) * 1_600;
  score += Math.max(0, -finalClosingKmS) * 2_400;
  score += directionalPenalty * 800;
  score += throttle * 180;
  if (phase === "coast" && refuelDistanceKm > 2) {
    score += 260;
  }
  if (distanceBand === "close" && phase !== "powered") {
    score += 220;
  }
  if (minRangeKm <= dockDistanceKm && relSpeedAtMinRangeKmS <= (dockSpeedKmS * 1.2)) {
    score -= 4_000;
  }

  return {
    ...candidate,
    phase,
    throttle,
    direction,
    score,
    predictedMinRangeKm: minRangeKm,
    predictedSpeedAtMinRangeKmS: relSpeedAtMinRangeKmS,
    predictedClosingAtMinRangeKmS: closingAtMinRangeKmS,
    predictedFinalRangeKm: finalRangeKm,
  };
}

function predictiveRefuelRendezvousCommand({
  refuelDistanceKm,
  refuelRelativeSpeedKmS,
  tangentDirection,
  directionToTarget,
  targetMinusShipRelVel,
  shipMinusTargetRelVel,
  dockDistanceKm,
  dockSpeedKmS,
  plannerConfig = null,
}) {
  if (
    !Number.isFinite(refuelDistanceKm)
    || !finiteVector(directionToTarget)
    || !finiteVector(targetMinusShipRelVel)
  ) {
    return null;
  }
  const relativeSpeedKmS = Number.isFinite(refuelRelativeSpeedKmS)
    ? Math.max(0, refuelRelativeSpeedKmS)
    : length(targetMinusShipRelVel);
  const closingSpeedKmS = refuelDistanceKm > 1e-9
    ? dot(shipMinusTargetRelVel, directionToTarget)
    : 0;
  const horizonSec = clamp(
    Number(plannerConfig?.refuelPredictiveHorizonSec)
      || (refuelDistanceKm > 60
        ? 4_800
        : (refuelDistanceKm > 8 ? 2_600 : 1_200)),
    300,
    7_200,
  );
  const burnDurationSec = clamp(
    Number(plannerConfig?.refuelPredictiveBurnSec)
      || (refuelDistanceKm > 40
        ? 72
        : (refuelDistanceKm > 6 ? 34 : 16)),
    8,
    220,
  );
  const steps = clamp(
    Number(plannerConfig?.refuelPredictiveSteps)
      || (refuelDistanceKm > 40 ? 72 : (refuelDistanceKm > 6 ? 56 : 40)),
    20,
    140,
  );
  const accelAtThrottle1KmS2 = Math.max(
    0.0004,
    Number(plannerConfig?.refuelAccelAtThrottle1KmS2) || DEFAULT_REFUEL_ACCEL_AT_THROTTLE1_KM_S2,
  );
  const velocityDampingDirection = normalize(scale(shipMinusTargetRelVel, -1), directionToTarget);
  const tangentSign = dot(directionToTarget, tangentDirection) >= 0 ? 1 : -1;
  const phaseDirection = tangentSign >= 0
    ? scale(tangentDirection, -1)
    : tangentDirection;
  const phaseMode = tangentSign >= 0 ? "lower" : "raise";
  const approachDirection = normalize(
    add(
      scale(directionToTarget, 0.82),
      scale(tangentDirection, 0.18),
    ),
    directionToTarget,
  );
  const interceptDirection = normalize(
    add(
      scale(directionToTarget, 0.64),
      scale(velocityDampingDirection, 0.36),
    ),
    directionToTarget,
  );
  const phaseCatchupDirection = normalize(
    add(
      scale(phaseDirection, 0.72),
      scale(directionToTarget, 0.28),
    ),
    phaseDirection,
  );
  const brakeDirection = normalize(
    scale(shipMinusTargetRelVel, -1),
    scale(directionToTarget, -1),
  );
  const desiredFarClosingKmS = clamp(refuelDistanceKm / 80_000, 0.018, 0.22);

  const candidates = [];
  const addCandidate = ({
    mode,
    phase = "powered",
    throttle = 0,
    direction = directionToTarget,
    basePenalty = 0,
  }) => {
    candidates.push({
      mode,
      phase,
      throttle,
      direction,
      basePenalty: Number(basePenalty) || 0,
    });
  };

  addCandidate({
    mode: "navsys:orbital-refuel-coast-window",
    phase: "coast",
    throttle: 0,
    direction: tangentDirection,
    basePenalty: refuelDistanceKm > 2 ? 120 : 24,
  });

  if (refuelDistanceKm > 15) {
    addCandidate({
      mode: `navsys:orbital-refuel-phase-catchup-${phaseMode}`,
      throttle: clamp(0.08 + (refuelDistanceKm / 140_000), 0.08, 0.22),
      direction: phaseCatchupDirection,
    });
    addCandidate({
      mode: "navsys:orbital-refuel-rendezvous-far",
      throttle: clamp(0.12 + (refuelDistanceKm / 220), 0.12, 0.34),
      direction: approachDirection,
    });
    addCandidate({
      mode: "navsys:orbital-refuel-rendezvous-predictive",
      throttle: clamp(0.08 + (refuelDistanceKm / 320), 0.08, 0.24),
      direction: interceptDirection,
    });
    if (closingSpeedKmS > (desiredFarClosingKmS * 1.5) || relativeSpeedKmS > 0.32) {
      addCandidate({
        mode: "navsys:orbital-refuel-brake",
        throttle: clamp(0.05 + (relativeSpeedKmS * 1.2), 0.05, 0.2),
        direction: brakeDirection,
      });
    }
  } else if (refuelDistanceKm > 1.5) {
    addCandidate({
      mode: "navsys:orbital-refuel-rendezvous-mid",
      throttle: clamp(
        0.028 + (refuelDistanceKm / 120) + (relativeSpeedKmS * 28),
        0.02,
        0.12,
      ),
      direction: interceptDirection,
    });
    addCandidate({
      mode: "navsys:orbital-refuel-rendezvous-predictive",
      throttle: clamp(0.02 + (refuelDistanceKm / 160), 0.02, 0.1),
      direction: normalize(
        add(
          add(
            scale(directionToTarget, 0.54),
            scale(phaseDirection, 0.24),
          ),
          scale(velocityDampingDirection, 0.22),
        ),
        directionToTarget,
      ),
    });
    if (relativeSpeedKmS > 0.0018 || closingSpeedKmS > 0.0026) {
      addCandidate({
        mode: "navsys:orbital-refuel-brake",
        throttle: clamp(0.01 + (relativeSpeedKmS * 6), 0.01, 0.08),
        direction: brakeDirection,
      });
    }
  } else {
    addCandidate({
      mode: "navsys:orbital-refuel-final-approach",
      throttle: clamp(0.002 + (refuelDistanceKm * 0.01), 0.002, 0.02),
      direction: normalize(
        add(
          scale(directionToTarget, 0.56),
          scale(velocityDampingDirection, 0.44),
        ),
        directionToTarget,
      ),
    });
    addCandidate({
      mode: "navsys:orbital-refuel-brake",
      throttle: clamp(0.003 + (relativeSpeedKmS * 22), 0.003, 0.03),
      direction: brakeDirection,
      basePenalty: 24,
    });
  }

  const coastClosest = projectedCoastClosestApproach({
    relativePositionKm: {
      x: Number(directionToTarget.x) * refuelDistanceKm,
      y: Number(directionToTarget.y) * refuelDistanceKm,
      z: Number(directionToTarget.z) * refuelDistanceKm,
    },
    relativeVelocityKmS: targetMinusShipRelVel,
    horizonSec,
  });
  if (
    Number.isFinite(coastClosest.distanceKm)
    && coastClosest.distanceKm <= Math.max(dockDistanceKm * 4, refuelDistanceKm * 0.72)
    && coastClosest.timeToClosestSec <= (horizonSec * 0.65)
  ) {
    addCandidate({
      mode: "navsys:orbital-refuel-coast-window",
      phase: "coast",
      throttle: 0,
      direction: tangentDirection,
      basePenalty: 0,
    });
  }

  let best = null;
  for (const candidate of candidates) {
    const evaluated = evaluateRendezvousCandidate({
      candidate,
      toRefuelTarget: {
        x: Number(directionToTarget.x) * refuelDistanceKm,
        y: Number(directionToTarget.y) * refuelDistanceKm,
        z: Number(directionToTarget.z) * refuelDistanceKm,
      },
      targetMinusShipRelVel,
      refuelDistanceKm,
      dockDistanceKm,
      dockSpeedKmS,
      accelAtThrottle1KmS2,
      horizonSec,
      burnDurationSec,
      steps,
      directionToTarget,
    });
    if (!evaluated || !Number.isFinite(Number(evaluated.score))) {
      continue;
    }
    evaluated.score += Number(candidate.basePenalty) || 0;
    if (!best || evaluated.score < best.score) {
      best = evaluated;
    }
  }
  if (!best) {
    return null;
  }
  if (refuelDistanceKm > 3 && Number(best.predictedMinRangeKm) > (refuelDistanceKm * 1.03)) {
    return null;
  }
  return {
    phase: best.phase,
    throttle: best.phase === "powered" ? clamp(Number(best.throttle) || 0, 0, 1) : 0,
    direction: normalize(best.direction, directionToTarget),
    mode: best.mode || "navsys:orbital-refuel-rendezvous-predictive",
  };
}

export function planRefuelRendezvousCommand({
  targetVectors = {},
  metrics = {},
  tangent = null,
  plannerConfig = null,
} = {}) {
  const tangentDirection = normalize(tangent || targetVectors.tangent, { x: 0, y: 1, z: 0 });
  const refuelDistanceKm = Number(metrics.refuelTargetDistanceKm);
  const refuelRelativeSpeedKmS = Number(metrics.refuelRelativeSpeedKmS);
  const refuelRelativeVelocityKmS = targetVectors.refuelTargetRelativeVelocityKmS;
  const toRefuelTarget = targetVectors.toRefuelTarget;

  if (!Number.isFinite(refuelDistanceKm) || !toRefuelTarget) {
    return {
      phase: "coast",
      throttle: 0,
      direction: tangentDirection,
      mode: "navsys:orbital-refuel-await-target",
    };
  }
  const dockDistanceKm = Number(REFUEL_TANKER_CONFIG.dockDistanceKm) || 0.014;
  const dockSpeedKmS = Number(REFUEL_TANKER_CONFIG.dockMaxRelativeSpeedKmS) || 0.000045;
  const directionToTarget = normalize(toRefuelTarget, tangentDirection);
  const targetMinusShipRelVel = refuelRelativeVelocityKmS || { x: 0, y: 0, z: 0 };
  const shipMinusTargetRelVel = scale(targetMinusShipRelVel, -1);
  const relativeSpeedKmS = Number.isFinite(refuelRelativeSpeedKmS)
    ? Math.max(0, refuelRelativeSpeedKmS)
    : length(targetMinusShipRelVel);
  if (refuelDistanceKm <= dockDistanceKm && relativeSpeedKmS <= dockSpeedKmS) {
    return {
      phase: "coast",
      throttle: 0,
      direction: tangentDirection,
      mode: "navsys:orbital-refuel-docked-hold",
    };
  }
  const predictiveCommand = predictiveRefuelRendezvousCommand({
    refuelDistanceKm,
    refuelRelativeSpeedKmS: relativeSpeedKmS,
    tangentDirection,
    directionToTarget,
    targetMinusShipRelVel,
    shipMinusTargetRelVel,
    dockDistanceKm,
    dockSpeedKmS,
    plannerConfig,
  });
  if (predictiveCommand) {
    return predictiveCommand;
  }
  return legacyRefuelRendezvousCommand({
    refuelDistanceKm,
    refuelRelativeSpeedKmS: relativeSpeedKmS,
    tangentDirection,
    directionToTarget,
    shipMinusTargetRelVel,
    targetMinusShipRelVel,
    dockDistanceKm,
    dockSpeedKmS,
  });
}
