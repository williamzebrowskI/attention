import {
  add,
  clamp,
  dot,
  finiteVector,
  length,
  normalize,
  scale,
} from "../navigationMath.js";
import {
  burnDurationForDeltaVSec,
  estimateBPlaneErrorKm,
  propagateMoonGuidanceState,
} from "./moonDynamicsModel.js";

const EARTH_MU_KM3_S2 = 398600.4418;

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback);
}

function cross(a, b) {
  return {
    x: ((Number(a?.y) || 0) * (Number(b?.z) || 0)) - ((Number(a?.z) || 0) * (Number(b?.y) || 0)),
    y: ((Number(a?.z) || 0) * (Number(b?.x) || 0)) - ((Number(a?.x) || 0) * (Number(b?.z) || 0)),
    z: ((Number(a?.x) || 0) * (Number(b?.y) || 0)) - ((Number(a?.y) || 0) * (Number(b?.x) || 0)),
  };
}

function basisFromPrimary(primary, up) {
  const primaryDir = normalize(primary, { x: 0, y: 1, z: 0 });
  const radialDir = normalize(up, { x: 0, y: 0, z: 1 });
  let normalDir = normalize(cross(primaryDir, radialDir), { x: 1, y: 0, z: 0 });
  if (length(normalDir) <= 1e-9) {
    normalDir = { x: 1, y: 0, z: 0 };
  }
  return { primaryDir, radialDir, normalDir };
}

function combineBasis({ primaryDir, radialDir, normalDir, primaryWeight, radialWeight, normalWeight }) {
  return normalize(
    add(
      scale(primaryDir, primaryWeight),
      add(scale(radialDir, radialWeight), scale(normalDir, normalWeight)),
    ),
    primaryDir,
  );
}

export function getMoonClosedLoopSolveCadenceSec(plannerConfig = {}) {
  return Math.max(20, finiteNumber(plannerConfig.moonClosedLoopSolveCadenceSec, 120));
}

export function nominalTliDeltaVEstimateKmS(
  shipEarthRadiusKm,
  moonEarthDistanceKm,
  earthMuKm3S2 = EARTH_MU_KM3_S2,
) {
  const r1 = Math.max(6500, finiteNumber(shipEarthRadiusKm, 0));
  const r2 = Math.max(r1 + 1, finiteNumber(moonEarthDistanceKm, 0));
  if (!(r2 > r1) || !(earthMuKm3S2 > 0)) {
    return 3.15;
  }
  const semiMajorKm = (r1 + r2) * 0.5;
  const circularSpeed = Math.sqrt(earthMuKm3S2 / r1);
  const transferSpeed = Math.sqrt(earthMuKm3S2 * ((2 / r1) - (1 / semiMajorKm)));
  return Math.max(0.25, transferSpeed - circularSpeed);
}

export function nominalTransferTimeSec(
  shipEarthRadiusKm,
  moonEarthDistanceKm,
  earthMuKm3S2 = EARTH_MU_KM3_S2,
) {
  const r1 = Math.max(6500, finiteNumber(shipEarthRadiusKm, 0));
  const r2 = Math.max(r1 + 1, finiteNumber(moonEarthDistanceKm, 0));
  if (!(r2 > r1) || !(earthMuKm3S2 > 0)) {
    return 72 * 3600;
  }
  const semiMajorKm = (r1 + r2) * 0.5;
  return Math.PI * Math.sqrt((semiMajorKm ** 3) / earthMuKm3S2);
}

function minDistanceForBody(propagation, targetBodyId) {
  if (targetBodyId === "earth") {
    return propagation?.minEarthDistanceKm;
  }
  return propagation?.minMoonDistanceKm;
}

function gravitationalParameterForBody(sources = null, targetBodyId = "moon") {
  const source = targetBodyId === "earth"
    ? sources?.earth
    : sources?.moon;
  const massKg = Math.max(0, finiteNumber(source?.massKg, Number.NaN));
  if (massKg > 0) {
    return 6.67430e-20 * massKg;
  }
  return targetBodyId === "earth"
    ? EARTH_MU_KM3_S2
    : (6.67430e-20 * 7.342e22);
}

function minAltitudeForBody(propagation, targetBodyId) {
  if (targetBodyId === "earth") {
    return propagation?.minEarthAltitudeKm;
  }
  return propagation?.minMoonAltitudeKm;
}

function closestRelativeStateForBody(propagation, targetBodyId) {
  if (targetBodyId === "earth") {
    return {
      positionKm: propagation?.closestEarthRelativePositionKm || null,
      velocityKmS: propagation?.closestEarthRelativeVelocityKmS || null,
    };
  }
  return {
    positionKm: propagation?.closestMoonRelativePositionKm || null,
    velocityKmS: propagation?.closestMoonRelativeVelocityKmS || null,
  };
}

function evaluateTransferCandidate({
  initialState,
  sources,
  spacecraft,
  burnDirection,
  deltaVNeedKmS,
  throttle,
  accelAtThrottle1KmS2,
  predictDurationSec,
  stepSec,
  targetBodyId,
  targetBodyRadiusKm,
  targetPeriluneAltitudeKm,
  safetyBodyId,
  safetyMinAltitudeKm,
}) {
  const burnDurationSec = burnDurationForDeltaVSec(deltaVNeedKmS, accelAtThrottle1KmS2, throttle, spacecraft);
  const propagation = propagateMoonGuidanceState({
    initialState,
    durationSec: predictDurationSec,
    stepSec,
    sources,
    spacecraft,
    burnCommand: {
      direction: burnDirection,
      throttle,
      accelAtThrottle1KmS2,
      burnDurationSec,
    },
  });
  if (!propagation) {
    return null;
  }
  const closestRelativeState = closestRelativeStateForBody(propagation, targetBodyId);
  const predictedMissDistanceKm = Number.isFinite(minDistanceForBody(propagation, targetBodyId))
    ? minDistanceForBody(propagation, targetBodyId)
    : Number.POSITIVE_INFINITY;
  const predictedPeriluneAltitudeKm = Number.isFinite(minAltitudeForBody(propagation, targetBodyId))
    ? minAltitudeForBody(propagation, targetBodyId)
    : Number.POSITIVE_INFINITY;
  const closestTargetRelPos = finiteVector(closestRelativeState.positionKm)
    ? closestRelativeState.positionKm
    : null;
  const closestTargetRelVel = finiteVector(closestRelativeState.velocityKmS)
    ? closestRelativeState.velocityKmS
    : null;
  const bPlaneErrorKm = estimateBPlaneErrorKm({
    relativePositionKm: closestTargetRelPos,
    relativeVelocityKmS: closestTargetRelVel,
    targetPeriluneAltitudeKm,
    bodyRadiusKm: targetBodyRadiusKm,
    bodyMuKm3S2: gravitationalParameterForBody(sources, targetBodyId),
  });
  const closestTargetRangeKm = finiteVector(closestTargetRelPos) ? length(closestTargetRelPos) : Number.NaN;
  const closestClosingSpeedKmS = (
    finiteVector(closestTargetRelPos)
    && finiteVector(closestTargetRelVel)
    && closestTargetRangeKm > 1e-9
  )
    ? -dot(closestTargetRelVel, scale(closestTargetRelPos, 1 / closestTargetRangeKm))
    : Number.NaN;
  const safetyAltitudeKm = Number.isFinite(minAltitudeForBody(propagation, safetyBodyId))
    ? minAltitudeForBody(propagation, safetyBodyId)
    : Number.NaN;
  const safetyRiskKm = Number.isFinite(safetyAltitudeKm)
    ? Math.max(0, safetyMinAltitudeKm - safetyAltitudeKm)
    : safetyMinAltitudeKm;
  const closingPenalty = Number.isFinite(closestClosingSpeedKmS)
    ? Math.max(0, -closestClosingSpeedKmS) * 10_000
    : 5_000;
  const cost = (
    predictedMissDistanceKm
    + (Math.abs(predictedPeriluneAltitudeKm - targetPeriluneAltitudeKm) * 0.8)
    + ((Number.isFinite(bPlaneErrorKm) ? bPlaneErrorKm : predictedMissDistanceKm) * 0.55)
    + (safetyRiskKm * 8_000)
    + closingPenalty
    + (deltaVNeedKmS * 600)
  );
  return {
    cost,
    throttle,
    deltaVNeedKmS,
    burnDurationSec,
    burnDirection,
    propagation,
    predictedMissDistanceKm,
    predictedPeriluneAltitudeKm,
    bPlaneErrorKm,
    closestClosingSpeedKmS,
  };
}

export function evaluateBallisticTransferSync({
  initialState,
  sources,
  spacecraft,
  primaryDirection,
  targetBodyId,
  targetBodyRadiusKm,
  targetPeriluneAltitudeKm,
  safetyBodyId,
  safetyMinAltitudeKm,
  predictDurationSec,
  plannerConfig,
} = {}) {
  const accelAtThrottle1KmS2 = Math.max(0.0002, finiteNumber(plannerConfig?.engineAccelAtThrottle1KmS2, 0.0055));
  const stepSec = Math.max(30, finiteNumber(plannerConfig?.moonClosedLoopPropagationStepSec, 600));
  const ballisticDirection = normalize(primaryDirection, { x: 0, y: 1, z: 0 });
  const propagation = propagateMoonGuidanceState({
    initialState,
    durationSec: predictDurationSec,
    stepSec,
    sources,
    spacecraft,
    burnCommand: {
      direction: ballisticDirection,
      throttle: 0,
      accelAtThrottle1KmS2,
      burnDurationSec: 0,
    },
  });
  if (!propagation) {
    return null;
  }
  const closestRelativeState = closestRelativeStateForBody(propagation, targetBodyId);
  const predictedMissDistanceKm = Number.isFinite(minDistanceForBody(propagation, targetBodyId))
    ? minDistanceForBody(propagation, targetBodyId)
    : Number.POSITIVE_INFINITY;
  const predictedPeriluneAltitudeKm = Number.isFinite(minAltitudeForBody(propagation, targetBodyId))
    ? minAltitudeForBody(propagation, targetBodyId)
    : Number.POSITIVE_INFINITY;
  const closestTargetRelPos = finiteVector(closestRelativeState.positionKm)
    ? closestRelativeState.positionKm
    : null;
  const closestTargetRelVel = finiteVector(closestRelativeState.velocityKmS)
    ? closestRelativeState.velocityKmS
    : null;
  const bPlaneErrorKm = estimateBPlaneErrorKm({
    relativePositionKm: closestTargetRelPos,
    relativeVelocityKmS: closestTargetRelVel,
    targetPeriluneAltitudeKm,
    bodyRadiusKm: targetBodyRadiusKm,
    bodyMuKm3S2: gravitationalParameterForBody(sources, targetBodyId),
  });
  const closestTargetRangeKm = finiteVector(closestTargetRelPos) ? length(closestTargetRelPos) : Number.NaN;
  const closestClosingSpeedKmS = (
    finiteVector(closestTargetRelPos)
    && finiteVector(closestTargetRelVel)
    && closestTargetRangeKm > 1e-9
  )
    ? -dot(closestTargetRelVel, scale(closestTargetRelPos, 1 / closestTargetRangeKm))
    : Number.NaN;
  const safetyAltitudeKm = Number.isFinite(minAltitudeForBody(propagation, safetyBodyId))
    ? minAltitudeForBody(propagation, safetyBodyId)
    : Number.NaN;
  const safetyRiskKm = Number.isFinite(safetyAltitudeKm)
    ? Math.max(0, safetyMinAltitudeKm - safetyAltitudeKm)
    : safetyMinAltitudeKm;
  const closingPenalty = Number.isFinite(closestClosingSpeedKmS)
    ? Math.max(0, -closestClosingSpeedKmS) * 10_000
    : 5_000;
  const cost = (
    predictedMissDistanceKm
    + (Math.abs(predictedPeriluneAltitudeKm - targetPeriluneAltitudeKm) * 0.8)
    + ((Number.isFinite(bPlaneErrorKm) ? bPlaneErrorKm : predictedMissDistanceKm) * 0.55)
    + (safetyRiskKm * 8_000)
    + closingPenalty
  );
  return {
    cost,
    throttle: 0,
    deltaVNeedKmS: 0,
    burnDurationSec: 0,
    burnDirection: ballisticDirection,
    propagation,
    predictedMissDistanceKm,
    predictedPeriluneAltitudeKm,
    bPlaneErrorKm,
    closestClosingSpeedKmS,
  };
}

function enumerateTransferCandidates({
  initialState,
  sources,
  spacecraft,
  primaryDirection,
  up,
  nominalDeltaVKmS,
  accelAtThrottle1KmS2,
  predictDurationSec,
  plannerConfig,
  targetBodyId,
  targetBodyRadiusKm,
  targetPeriluneAltitudeKm,
  safetyBodyId,
  safetyMinAltitudeKm,
  phase,
}) {
  const { primaryDir, radialDir, normalDir } = basisFromPrimary(primaryDirection, up);
  const defaultDvOffsets = phase === "tli_burn"
    ? [-0.45, -0.15, 0, 0.18, 0.42]
    : [-0.06, -0.02, 0, 0.02, 0.06];
  const defaultRadialOffsets = phase === "tli_burn" ? [-0.12, 0, 0.12] : [-0.05, 0, 0.05];
  const defaultNormalOffsets = phase === "tli_burn" ? [-0.05, 0, 0.05] : [-0.03, 0, 0.03];
  const dvOffsets = Array.isArray(plannerConfig?.moonClosedLoopDvOffsetsKmS)
    && plannerConfig.moonClosedLoopDvOffsetsKmS.length > 0
    ? plannerConfig.moonClosedLoopDvOffsetsKmS
        .map((value) => finiteNumber(value, Number.NaN))
        .filter((value) => Number.isFinite(value))
    : defaultDvOffsets;
  const radialOffsets = Array.isArray(plannerConfig?.moonClosedLoopRadialOffsets)
    && plannerConfig.moonClosedLoopRadialOffsets.length > 0
    ? plannerConfig.moonClosedLoopRadialOffsets
        .map((value) => finiteNumber(value, Number.NaN))
        .filter((value) => Number.isFinite(value))
    : defaultRadialOffsets;
  const normalOffsets = Array.isArray(plannerConfig?.moonClosedLoopNormalOffsets)
    && plannerConfig.moonClosedLoopNormalOffsets.length > 0
    ? plannerConfig.moonClosedLoopNormalOffsets
        .map((value) => finiteNumber(value, Number.NaN))
        .filter((value) => Number.isFinite(value))
    : defaultNormalOffsets;
  const stepSec = Math.max(30, finiteNumber(plannerConfig.moonClosedLoopPropagationStepSec, 600));
  let best = null;
  for (let dvIndex = 0; dvIndex < dvOffsets.length; dvIndex += 1) {
    const dvNeedKmS = Math.max(0.002, nominalDeltaVKmS + dvOffsets[dvIndex]);
    for (let radialIndex = 0; radialIndex < radialOffsets.length; radialIndex += 1) {
      for (let normalIndex = 0; normalIndex < normalOffsets.length; normalIndex += 1) {
        const burnDirection = combineBasis({
          primaryDir,
          radialDir,
          normalDir,
          primaryWeight: 1,
          radialWeight: radialOffsets[radialIndex],
          normalWeight: normalOffsets[normalIndex],
        });
        const throttle = clamp(
          dvNeedKmS / Math.max(0.02, finiteNumber(plannerConfig.moonClosedLoopThrottleDvScaleKmS, 1.15)),
          finiteNumber(plannerConfig.moonClosedLoopThrottleMin, 0.08),
          finiteNumber(plannerConfig.moonClosedLoopThrottleMax, 0.78),
        );
        const candidate = evaluateTransferCandidate({
          initialState,
          sources,
          spacecraft,
          burnDirection,
          deltaVNeedKmS: dvNeedKmS,
          throttle,
          accelAtThrottle1KmS2,
          predictDurationSec,
          stepSec,
          targetBodyId,
          targetBodyRadiusKm,
          targetPeriluneAltitudeKm,
          safetyBodyId,
          safetyMinAltitudeKm,
        });
        if (candidate && (!best || candidate.cost < best.cost)) {
          best = candidate;
        }
      }
    }
  }
  return best;
}

export function solveBestClosedLoopTransferSync({
  initialState,
  sources,
  spacecraft,
  tangent,
  up,
  primaryDirection,
  targetBodyId,
  targetBodyRadiusKm,
  targetDistanceKm,
  targetPeriluneAltitudeKm,
  safetyBodyId,
  safetyMinAltitudeKm,
  nominalDeltaVKmS,
  predictDurationsSec,
  plannerConfig,
  phase,
}) {
  const shipEarthRadiusKm = length(initialState.positionKm);
  const accelAtThrottle1KmS2 = Math.max(0.0002, finiteNumber(plannerConfig.engineAccelAtThrottle1KmS2, 0.0055));
  let best = null;
  const normalizedPrimaryDirection = normalize(primaryDirection, tangent);
  const normalizedNominalDeltaV = Math.max(0.002, finiteNumber(nominalDeltaVKmS, 0.15));
  const durations = Array.isArray(predictDurationsSec) && predictDurationsSec.length > 0
    ? predictDurationsSec
    : [nominalTransferTimeSec(shipEarthRadiusKm, targetDistanceKm, EARTH_MU_KM3_S2)];
  for (let i = 0; i < durations.length; i += 1) {
    const predictDurationSec = Math.max(3 * 3600, finiteNumber(durations[i], durations[0]));
    const candidate = enumerateTransferCandidates({
      initialState,
      sources,
      spacecraft,
      primaryDirection: normalizedPrimaryDirection,
      up,
      nominalDeltaVKmS: normalizedNominalDeltaV,
      accelAtThrottle1KmS2,
      predictDurationSec,
      plannerConfig,
      targetBodyId,
      targetBodyRadiusKm,
      targetPeriluneAltitudeKm,
      safetyBodyId,
      safetyMinAltitudeKm,
      phase,
    });
    if (candidate && (!best || candidate.cost < best.cost)) {
      best = candidate;
    }
  }
  return best;
}
