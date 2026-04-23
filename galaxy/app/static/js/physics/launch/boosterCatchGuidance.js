import {
  BOOSTER_CATCH_BASE_CLEARANCE_KM,
  BOOSTER_CATCH_GEOMETRY_KM,
} from "./launchSiteCatchGeometry.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const BOOSTER_CATCH_CONFIG = Object.freeze({
  startAltitudeKm: 6.0,
  maxApproachRangeKm: 7.5,
  maxApproachLateralKm: 6.0,
  maxApproachVerticalErrorKm: 4.0,
  maxApproachSpeedKmS: 0.95,
  minApproachBodyUpAlignment: -0.10,
  minFinalBurnBodyUpAlignment: 0.75,
  maxPositionSigmaKm: 0.030,
  maxVelocitySigmaKmS: 0.00045,
  minInterceptTimeSec: 0.65,
  maxInterceptTimeSec: 90.0,
  maxPredictiveApproachLateralMissKm: 8.0,
  maxPredictiveApproachVerticalMissKm: 4.0,
  sustainApproachRangeKm: 9.0,
  sustainApproachLateralKm: 7.0,
  sustainApproachVerticalErrorKm: 5.0,
  sustainApproachSpeedKmS: 1.00,
  sustainPredictiveApproachLateralMissKm: 10.0,
  sustainPredictiveApproachVerticalMissKm: 5.0,
  latchedApproachRangeKm: 12.0,
  latchedApproachLateralKm: 9.0,
  latchedApproachVerticalErrorKm: 6.0,
  latchedApproachSpeedKmS: 1.05,
  minLatchedBodyUpAlignment: -0.20,
  finalBurnAltitudeKm: 5.5,
  finalBurnRangeKm: 4.8,
  finalBurnLateralRangeKm: 4.2,
  finalBurnVerticalErrorKm: 3.0,
  finalBurnApproachSpeedKmS: 0.22,
  finalPredictiveLateralMissKm: 1.8,
  finalPredictiveVerticalMissKm: 0.8,
  finalizeHoldSec: 0.45,
  finalizeSpeedKmS: 0.028,
  finalizeVerticalSpeedKmS: 0.018,
});

function resolveInterceptTimeSec({
  catchTotalRangeKm = 0,
  catchApproachSpeedKmS = 0,
  catchVerticalErrorKm = 0,
  catchVerticalSpeedKmS = 0,
}) {
  const rangeTimeSec = catchTotalRangeKm / Math.max(catchApproachSpeedKmS, 0.04);
  const verticalTimeSec = Math.abs(catchVerticalErrorKm) / Math.max(Math.abs(catchVerticalSpeedKmS), 0.015);
  return clamp(
    (0.55 * rangeTimeSec) + (0.45 * verticalTimeSec) + 0.3,
    BOOSTER_CATCH_CONFIG.minInterceptTimeSec,
    BOOSTER_CATCH_CONFIG.maxInterceptTimeSec,
  );
}

function resolvePredictiveCatchMetrics({
  interceptTimeSec = 1,
  catchEastErrorKm = 0,
  catchNorthErrorKm = 0,
  catchVerticalErrorKm = 0,
  catchEastSpeedKmS = 0,
  catchNorthSpeedKmS = 0,
  catchVerticalSpeedKmS = 0,
  altitudeKm = 0,
}) {
  const desiredEastSpeedKmS = clamp(
    -catchEastErrorKm / Math.max(interceptTimeSec, 0.5),
    -0.12,
    0.12,
  );
  const desiredNorthSpeedKmS = clamp(
    -catchNorthErrorKm / Math.max(interceptTimeSec, 0.5),
    -0.12,
    0.12,
  );
  const desiredVerticalSpeedLimitKmS = altitudeKm <= 0.4
    ? 0.018
    : altitudeKm <= 1.0
      ? 0.035
      : altitudeKm <= 4.0
        ? 0.065
        : 0.08;
  const desiredVerticalSpeedKmS = clamp(
    -catchVerticalErrorKm / Math.max(interceptTimeSec * 1.05, 0.75),
    -desiredVerticalSpeedLimitKmS,
    0.01,
  );
  const eastSpeedErrorKmS = desiredEastSpeedKmS - catchEastSpeedKmS;
  const northSpeedErrorKmS = desiredNorthSpeedKmS - catchNorthSpeedKmS;
  const verticalSpeedErrorKmS = desiredVerticalSpeedKmS - catchVerticalSpeedKmS;
  const predictedEastMissKm = catchEastErrorKm + (catchEastSpeedKmS * interceptTimeSec);
  const predictedNorthMissKm = catchNorthErrorKm + (catchNorthSpeedKmS * interceptTimeSec);
  const predictedVerticalMissKm = catchVerticalErrorKm + (catchVerticalSpeedKmS * interceptTimeSec);
  const predictedLateralMissKm = Math.hypot(predictedEastMissKm, predictedNorthMissKm);
  const predictedTotalMissKm = Math.hypot(predictedLateralMissKm, predictedVerticalMissKm);
  const localDirection = {
    east: clamp(
      (eastSpeedErrorKmS / 0.12) - (catchEastErrorKm / 1.8),
      -0.55,
      0.55,
    ),
    north: clamp(
      (northSpeedErrorKmS / 0.12) - (catchNorthErrorKm / 1.8),
      -0.55,
      0.55,
    ),
    up: clamp(
      0.92
        + (verticalSpeedErrorKmS / 0.035)
        - (Math.max(0, catchVerticalErrorKm) / 3.6)
        + (Math.max(0, -catchVerticalErrorKm) / 4.8),
      0.70,
      1.35,
    ),
  };
  const lateralDemandNorm = clamp(
    Math.hypot(localDirection.east, localDirection.north) / 1.45,
    0,
    1,
  );
  const verticalDemandNorm = clamp(Math.abs(verticalSpeedErrorKmS) / 0.05, 0, 1);
  const predictiveLateralMissNorm = clamp(predictedLateralMissKm / 0.32, 0, 1);
  const predictiveVerticalMissNorm = clamp(Math.abs(predictedVerticalMissKm) / 0.12, 0, 1);
  return {
    desiredEastSpeedKmS,
    desiredNorthSpeedKmS,
    desiredVerticalSpeedKmS,
    eastSpeedErrorKmS,
    northSpeedErrorKmS,
    verticalSpeedErrorKmS,
    predictedEastMissKm,
    predictedNorthMissKm,
    predictedVerticalMissKm,
    predictedLateralMissKm,
    predictedTotalMissKm,
    localDirection,
    lateralDemandNorm,
    verticalDemandNorm,
    predictiveLateralMissNorm,
    predictiveVerticalMissNorm,
  };
}

export function resolveBoosterCatchCommand(input = {}) {
  const currentPhase = String(input.currentPhase || "").toLowerCase();
  const sustainingCatchApproach = currentPhase === "catch-approach" || currentPhase === "catch-burn";
  const sustainOverride = Boolean(input.sustainOverride);
  const sustainRelaxed = Boolean(input.sustainRelaxed);
  const latchedCatchApproach = sustainingCatchApproach && sustainOverride && sustainRelaxed;
  const altitudeKm = Math.max(0, Number(input.altitudeKm) || 0);
  const catchTotalRangeKm = Math.max(0, Number(input.catchTotalRangeKm) || Number(input.launchSiteRangeKm) || 0);
  const catchLateralRangeKm = Math.max(0, Number(input.catchLateralRangeKm) || Number(input.launchSiteLateralRangeKm) || 0);
  const catchVerticalErrorKm = Number(input.catchVerticalErrorKm) || 0;
  const catchApproachSpeedKmS = Math.max(0, Number(input.catchApproachSpeedKmS) || 0);
  const catchLateralSpeedKmS = Math.max(0, Number(input.catchLateralSpeedKmS) || Number(input.tangentialSpeedKmS) || 0);
  const catchVerticalSpeedKmS = Number(input.catchVerticalSpeedKmS) || Number(input.radialSpeedKmS) || 0;
  const catchEastErrorKm = Number(input.catchEastErrorKm) || 0;
  const catchNorthErrorKm = Number(input.catchNorthErrorKm) || 0;
  const catchEastSpeedKmS = Number(input.catchEastSpeedKmS) || 0;
  const catchNorthSpeedKmS = Number(input.catchNorthSpeedKmS) || 0;
  const towerRelativeActive = Boolean(input.towerRelativeActive);
  const catchPositionSigmaKm = Math.max(0, Number(input.catchPositionSigmaKm) || Number.POSITIVE_INFINITY);
  const catchVelocitySigmaKmS = Math.max(0, Number(input.catchVelocitySigmaKmS) || Number.POSITIVE_INFINITY);
  const bodyUpAlignment = clamp(
    Number.isFinite(Number(input.bodyUpAlignment))
      ? Number(input.bodyUpAlignment)
      : 1,
    -1,
    1,
  );

  if (!towerRelativeActive) {
    return null;
  }
  if (catchPositionSigmaKm > BOOSTER_CATCH_CONFIG.maxPositionSigmaKm) {
    return null;
  }
  if (catchVelocitySigmaKmS > BOOSTER_CATCH_CONFIG.maxVelocitySigmaKmS) {
    return null;
  }
  if (altitudeKm > BOOSTER_CATCH_CONFIG.startAltitudeKm) {
    return null;
  }
  const approachRangeLimitKm = latchedCatchApproach
    ? BOOSTER_CATCH_CONFIG.latchedApproachRangeKm
    : sustainingCatchApproach
    ? BOOSTER_CATCH_CONFIG.sustainApproachRangeKm
    : BOOSTER_CATCH_CONFIG.maxApproachRangeKm;
  const approachLateralLimitKm = latchedCatchApproach
    ? BOOSTER_CATCH_CONFIG.latchedApproachLateralKm
    : sustainingCatchApproach
    ? BOOSTER_CATCH_CONFIG.sustainApproachLateralKm
    : BOOSTER_CATCH_CONFIG.maxApproachLateralKm;
  const approachVerticalLimitKm = latchedCatchApproach
    ? BOOSTER_CATCH_CONFIG.latchedApproachVerticalErrorKm
    : sustainingCatchApproach
    ? BOOSTER_CATCH_CONFIG.sustainApproachVerticalErrorKm
    : BOOSTER_CATCH_CONFIG.maxApproachVerticalErrorKm;
  const approachSpeedLimitKmS = latchedCatchApproach
    ? BOOSTER_CATCH_CONFIG.latchedApproachSpeedKmS
    : sustainingCatchApproach
    ? BOOSTER_CATCH_CONFIG.sustainApproachSpeedKmS
    : BOOSTER_CATCH_CONFIG.maxApproachSpeedKmS;
  const predictiveApproachLateralLimitKm = sustainingCatchApproach
    ? BOOSTER_CATCH_CONFIG.sustainPredictiveApproachLateralMissKm
    : BOOSTER_CATCH_CONFIG.maxPredictiveApproachLateralMissKm;
  const predictiveApproachVerticalLimitKm = sustainingCatchApproach
    ? BOOSTER_CATCH_CONFIG.sustainPredictiveApproachVerticalMissKm
    : BOOSTER_CATCH_CONFIG.maxPredictiveApproachVerticalMissKm;

  if (catchTotalRangeKm > approachRangeLimitKm) {
    return null;
  }
  if (catchLateralRangeKm > approachLateralLimitKm) {
    return null;
  }
  if (Math.abs(catchVerticalErrorKm) > approachVerticalLimitKm) {
    return null;
  }
  if (catchApproachSpeedKmS > approachSpeedLimitKmS) {
    return null;
  }
  if (
    bodyUpAlignment < (
      latchedCatchApproach
        ? BOOSTER_CATCH_CONFIG.minLatchedBodyUpAlignment
        : BOOSTER_CATCH_CONFIG.minApproachBodyUpAlignment
    )
  ) {
    return null;
  }

  const interceptTimeSec = resolveInterceptTimeSec({
    catchTotalRangeKm,
    catchApproachSpeedKmS,
    catchVerticalErrorKm,
    catchVerticalSpeedKmS,
  });
  const predictive = resolvePredictiveCatchMetrics({
    interceptTimeSec,
    catchEastErrorKm,
    catchNorthErrorKm,
    catchVerticalErrorKm,
    catchEastSpeedKmS,
    catchNorthSpeedKmS,
    catchVerticalSpeedKmS,
    altitudeKm,
  });

  if (
    !latchedCatchApproach
    && (
      predictive.predictedLateralMissKm > (sustainingCatchApproach ? predictiveApproachLateralLimitKm * 2.5 : predictiveApproachLateralLimitKm)
      || Math.abs(predictive.predictedVerticalMissKm) > (sustainingCatchApproach ? predictiveApproachVerticalLimitKm * 2.0 : predictiveApproachVerticalLimitKm)
    )
  ) {
    return null;
  }

  const finalBurnEligible =
    bodyUpAlignment >= BOOSTER_CATCH_CONFIG.minFinalBurnBodyUpAlignment
    && (
      (
        altitudeKm <= BOOSTER_CATCH_CONFIG.finalBurnAltitudeKm
        && catchTotalRangeKm <= BOOSTER_CATCH_CONFIG.finalBurnRangeKm
        && catchLateralRangeKm <= BOOSTER_CATCH_CONFIG.finalBurnLateralRangeKm
        && Math.abs(catchVerticalErrorKm) <= BOOSTER_CATCH_CONFIG.finalBurnVerticalErrorKm
        && catchApproachSpeedKmS <= BOOSTER_CATCH_CONFIG.finalBurnApproachSpeedKmS
      )
      || (
        catchTotalRangeKm <= BOOSTER_CATCH_CONFIG.finalBurnRangeKm
        && catchLateralRangeKm <= BOOSTER_CATCH_CONFIG.finalBurnLateralRangeKm
        && Math.abs(catchVerticalErrorKm) <= BOOSTER_CATCH_CONFIG.finalBurnVerticalErrorKm
        && catchApproachSpeedKmS <= BOOSTER_CATCH_CONFIG.finalBurnApproachSpeedKmS
        && predictive.predictedLateralMissKm <= BOOSTER_CATCH_CONFIG.finalPredictiveLateralMissKm
        && Math.abs(predictive.predictedVerticalMissKm) <= BOOSTER_CATCH_CONFIG.finalPredictiveVerticalMissKm
      )
    );

  const phase = finalBurnEligible ? "catch-burn" : "catch-approach";
  const guidanceMode = finalBurnEligible ? "booster-catch-burn" : "booster-catch-approach";
  const approachThrottle = clamp(
    (
      0.22
      + (0.18 * predictive.verticalDemandNorm)
      + (0.08 * predictive.predictiveVerticalMissNorm)
      + (0.04 * predictive.predictiveLateralMissNorm)
    ) * clamp(1 - (catchApproachSpeedKmS / 1.10), 0.75, 1),
    0.18,
    0.48,
  );
  const uprightApproachNorm = clamp(
    (
      bodyUpAlignment - BOOSTER_CATCH_CONFIG.minApproachBodyUpAlignment
    ) / Math.max(
      BOOSTER_CATCH_CONFIG.minFinalBurnBodyUpAlignment - BOOSTER_CATCH_CONFIG.minApproachBodyUpAlignment,
      1e-6,
    ),
    0,
    1,
  );
  const uprightErrorNorm = clamp(
    (1 - bodyUpAlignment) / 0.24,
    0,
    1,
  );
  const blend = clamp(
    (finalBurnEligible ? 0.82 : 0.58)
      + (0.18 * predictive.lateralDemandNorm)
      + (0.10 * predictive.predictiveVerticalMissNorm),
    finalBurnEligible ? 0.82 : 0.56,
    finalBurnEligible ? 0.96 : 0.82,
  );
  const retrogradeBias = clamp(
    (finalBurnEligible ? 0.04 : 0.10)
      + (0.12 * predictive.lateralDemandNorm),
    finalBurnEligible ? 0.03 : 0.08,
    finalBurnEligible ? 0.14 : 0.20,
  );
  const throttle = clamp(
    (finalBurnEligible ? 0.34 : approachThrottle)
      + (0.32 * predictive.verticalDemandNorm)
      + (0.08 * predictive.predictiveVerticalMissNorm),
    finalBurnEligible ? 0.30 : 0.18,
    finalBurnEligible ? 0.92 : 0.70,
  );

  return {
    phase,
    guidanceMode,
    attitudeControlMode: finalBurnEligible ? "engines+rcs" : "grid-fins+rcs",
    qAlphaSteeringEnabled: false,
    siteTargetingEnabled: false,
    throttle: finalBurnEligible ? throttle : 0,
    directionMix: {
      up: finalBurnEligible ? 1.0 : 0.88,
      retrograde: finalBurnEligible ? 0.08 : 0.12,
      antiTangent: finalBurnEligible ? 0.02 : 0.04,
    },
    captureLike: true,
    terminalUprightCommit: true,
    uprightTiltLimitDeg: finalBurnEligible
      ? clamp(6 + (0.55 * catchLateralRangeKm), 6, 12)
      : clamp(12 + (0.42 * catchLateralRangeKm), 12, 22),
    attitudeResponseScale: finalBurnEligible
      ? 1.35
      : 1.08 + (0.46 * uprightErrorNorm),
    attitudeTargetBlend: finalBurnEligible
      ? 0.93
      : 0.78 + (0.12 * uprightErrorNorm),
    angularDampingPerS: finalBurnEligible
      ? 1.00
      : 0.78 + (0.18 * uprightErrorNorm),
    maxBodyRateDegS: finalBurnEligible ? 6.5 : 7.6,
    predictiveCatchControl: {
      enabled: true,
      blend,
      retrogradeBias,
      translationOnly: true,
      translationAuthority: clamp(
        (
          0.46
          + (0.34 * predictive.lateralDemandNorm)
          + (0.12 * predictive.predictiveLateralMissNorm)
        ) * (
          finalBurnEligible
            ? 1
            : clamp(0.18 + (0.82 * uprightApproachNorm), 0.18, 1)
        ),
        0.35,
        finalBurnEligible ? 0.88 : 0.92,
      ),
      interceptTimeSec,
      localDirection: { ...predictive.localDirection },
      desiredEastSpeedKmS: predictive.desiredEastSpeedKmS,
      desiredNorthSpeedKmS: predictive.desiredNorthSpeedKmS,
      desiredVerticalSpeedKmS: predictive.desiredVerticalSpeedKmS,
      predictedEastMissKm: predictive.predictedEastMissKm,
      predictedNorthMissKm: predictive.predictedNorthMissKm,
      predictedVerticalMissKm: predictive.predictedVerticalMissKm,
      predictedLateralMissKm: predictive.predictedLateralMissKm,
      predictedTotalMissKm: predictive.predictedTotalMissKm,
    },
  };
}

export function shouldFinalizeBoosterCatch({
  guidanceMode = "",
  launchSiteLateralRangeKm,
  catchVerticalErrorKm,
  catchPinHeightErrorKm,
  speedKmS,
  radialSpeedKmS,
  catchHoldSec = 0,
} = {}) {
  if (!String(guidanceMode || "").startsWith("booster-catch")) {
    return false;
  }
  const lateralRangeKm = Math.max(0, Number(launchSiteLateralRangeKm) || Number.POSITIVE_INFINITY);
  const verticalErrorCandidateKm = Number.isFinite(Number(catchVerticalErrorKm))
    ? Math.abs(Number(catchVerticalErrorKm))
    : Math.abs(Number(catchPinHeightErrorKm));
  const verticalErrorKm = Number.isFinite(verticalErrorCandidateKm)
    ? verticalErrorCandidateKm
    : Number.POSITIVE_INFINITY;
  const speed = Math.max(0, Number(speedKmS) || Number.POSITIVE_INFINITY);
  const radialSpeed = Math.abs(Number(radialSpeedKmS) || Number.POSITIVE_INFINITY);
  const holdSec = Math.max(0, Number(catchHoldSec) || 0);
  const verticalToleranceKm = Math.max(
    BOOSTER_CATCH_GEOMETRY_KM.finalizePinHeightToleranceKm,
    BOOSTER_CATCH_BASE_CLEARANCE_KM * 0.5,
  );
  return (
    lateralRangeKm <= BOOSTER_CATCH_GEOMETRY_KM.finalizeLateralToleranceKm
    && verticalErrorKm <= verticalToleranceKm
    && speed <= BOOSTER_CATCH_CONFIG.finalizeSpeedKmS
    && radialSpeed <= BOOSTER_CATCH_CONFIG.finalizeVerticalSpeedKmS
    && holdSec >= BOOSTER_CATCH_CONFIG.finalizeHoldSec
  );
}
