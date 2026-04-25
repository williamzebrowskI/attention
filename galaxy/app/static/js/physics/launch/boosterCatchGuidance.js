import { BOOSTER_CATCH_GEOMETRY_KM } from "./launchSiteCatchGeometry.js?v=20260424b";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const BOOSTER_CATCH_CONFIG = Object.freeze({
  startAltitudeKm: 31.0,
  maxApproachRangeKm: 44.0,
  maxApproachLateralKm: 44.0,
  maxApproachVerticalErrorKm: 34.0,
  maxApproachSpeedKmS: 2.35,
  minApproachBodyUpAlignment: 0.90,
  minFinalBurnBodyUpAlignment: 0.82,
  maxPositionSigmaKm: 0.030,
  maxVelocitySigmaKmS: 0.00045,
  minInterceptTimeSec: 0.65,
  maxInterceptTimeSec: 90.0,
  maxPredictiveApproachLateralMissKm: 72.0,
  maxPredictiveApproachVerticalMissKm: 28.0,
  sustainApproachRangeKm: 44.0,
  sustainApproachLateralKm: 44.0,
  sustainApproachVerticalErrorKm: 34.0,
  sustainApproachSpeedKmS: 2.45,
  sustainPredictiveApproachLateralMissKm: 24.0,
  sustainPredictiveApproachVerticalMissKm: 24.0,
  latchedApproachRangeKm: 44.0,
  latchedApproachLateralKm: 44.0,
  latchedApproachVerticalErrorKm: 34.0,
  latchedApproachSpeedKmS: 2.45,
  minLatchedBodyUpAlignment: 0.88,
  finalBurnAltitudeKm: 1.65,
  finalBurnRangeKm: 3.40,
  finalBurnLateralRangeKm: 2.80,
  finalBurnVerticalErrorKm: 2.25,
  finalBurnApproachSpeedKmS: 0.95,
  finalPredictiveLateralMissKm: 0.58,
  finalPredictiveVerticalMissKm: 0.90,
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
  currentPhase = "",
  interceptTimeSec = 1,
  catchEastErrorKm = 0,
  catchNorthErrorKm = 0,
  catchVerticalErrorKm = 0,
  catchEastSpeedKmS = 0,
  catchNorthSpeedKmS = 0,
  catchVerticalSpeedKmS = 0,
  altitudeKm = 0,
}) {
  const catchLateralRangeKm = Math.hypot(catchEastErrorKm, catchNorthErrorKm);
  const phaseText = String(currentPhase || "").toLowerCase();
  const poweredFinalBurnActive = phaseText === "landing-burn" || phaseText === "catch-burn";
  const precisionCenteringActive = phaseText === "catch-burn";
  const terminalLateralDeadlineSec = poweredFinalBurnActive
    ? (
      altitudeKm > 24
        ? 18
        : altitudeKm > 16
          ? 14
          : altitudeKm > 10
            ? 10
            : altitudeKm > 6
              ? 7.5
              : altitudeKm > 3
                ? 5.0
                : altitudeKm > 1.5
                  ? 3.4
                  : 2.2
    )
    : interceptTimeSec;
  const effectiveInterceptTimeSec = poweredFinalBurnActive
    ? Math.min(interceptTimeSec, terminalLateralDeadlineSec)
    : interceptTimeSec;
  const towerCorridorLimitKm = altitudeKm > 28
    ? (phaseText === "landing-burn" ? 3.40 : 6.40)
    : altitudeKm > 18
      ? (phaseText === "landing-burn" ? 3.60 : 4.20)
      : altitudeKm > 10
        ? (phaseText === "landing-burn" ? 3.10 : 2.40)
        : altitudeKm > 6
          ? (phaseText === "landing-burn" ? 2.20 : 1.10)
          : altitudeKm > 3
            ? (phaseText === "landing-burn" ? 1.20 : 0.42)
            : 0.04;
  const unpoweredTowerCorridorHoldRadiusKm = clamp(
    (phaseText === "landing-burn" ? 0.22 : 0.020)
      + ((phaseText === "landing-burn" ? 0.11 : 0.20) * Math.max(0, Math.abs(catchVerticalErrorKm) - 0.4)),
    0,
    towerCorridorLimitKm,
  );
  const towerCorridorHoldRadiusKm = precisionCenteringActive
    ? 0
    : unpoweredTowerCorridorHoldRadiusKm;
  const rawLateralGuidanceScale = catchLateralRangeKm > 1e-6
    ? (catchLateralRangeKm - towerCorridorHoldRadiusKm) / catchLateralRangeKm
    : 0;
  const lateralGuidanceScale = catchLateralRangeKm > 1e-6
    ? (
      poweredFinalBurnActive
        ? (
          precisionCenteringActive
            ? clamp(rawLateralGuidanceScale, 0, 1)
            : clamp(rawLateralGuidanceScale, -1, 1)
        )
        : clamp(rawLateralGuidanceScale, -1, 1)
    )
    : 0;
  const guidedEastErrorKm = catchEastErrorKm * lateralGuidanceScale;
  const guidedNorthErrorKm = catchNorthErrorKm * lateralGuidanceScale;
  const eastCrosslineDriftNorm = clamp((1.4 - Math.abs(guidedEastErrorKm)) / 1.4, 0, 1)
    * clamp(Math.abs(catchEastSpeedKmS) / 0.18, 0, 1);
  const northCrosslineDriftNorm = clamp((1.4 - Math.abs(guidedNorthErrorKm)) / 1.4, 0, 1)
    * clamp(Math.abs(catchNorthSpeedKmS) / 0.18, 0, 1);
  const crosslineDriftNorm = clamp(
    Math.max(eastCrosslineDriftNorm, northCrosslineDriftNorm),
    0,
    1,
  );
  const desiredLateralSpeedLimitKmS = altitudeKm > 14
    ? (
      catchLateralRangeKm > 8
        ? 1.05
        : catchLateralRangeKm > 4
          ? 0.85
          : 0.55
    )
    : altitudeKm > 6
      ? (
        catchLateralRangeKm > 8
          ? 0.90
          : catchLateralRangeKm > 4
            ? 0.78
            : catchLateralRangeKm > 2
              ? 0.58
              : 0.32
      )
      : altitudeKm > 2
        ? (
          catchLateralRangeKm > 4
            ? 0.62
            : catchLateralRangeKm > 2
              ? 0.44
              : 0.22
        )
        : (
          catchLateralRangeKm > 6
            ? 0.50
            : catchLateralRangeKm > 3
              ? 0.42
              : catchLateralRangeKm > 1
                ? 0.24
                : 0.12
        );
  let desiredEastSpeedKmS = clamp(
    -guidedEastErrorKm / Math.max(effectiveInterceptTimeSec, 0.5),
    -desiredLateralSpeedLimitKmS,
    desiredLateralSpeedLimitKmS,
  );
  let desiredNorthSpeedKmS = clamp(
    -guidedNorthErrorKm / Math.max(effectiveInterceptTimeSec, 0.5),
    -desiredLateralSpeedLimitKmS,
    desiredLateralSpeedLimitKmS,
  );
  const guidedLateralRangeKm = Math.hypot(guidedEastErrorKm, guidedNorthErrorKm);
  const outsideTowerCorridorKm = Math.max(0, catchLateralRangeKm - towerCorridorHoldRadiusKm);
  const terminalTranslateSpeedFloorKmS = (
    outsideTowerCorridorKm > 0.12
    && altitudeKm <= 34
    && guidedLateralRangeKm > 0.08
  )
    ? Math.min(
      desiredLateralSpeedLimitKmS,
      clamp(
        outsideTowerCorridorKm / (
          altitudeKm > 24 ? 8.0 : altitudeKm > 20 ? 5.5 : altitudeKm > 14 ? 3.2 : altitudeKm > 8 ? 3.0 : altitudeKm > 5 ? 3.8 : altitudeKm > 2 ? 4.8 : 5.2
        ),
        altitudeKm > 24 ? 0.62 : altitudeKm > 20 ? 0.56 : altitudeKm > 14 ? 0.48 : altitudeKm > 8 ? 0.42 : altitudeKm > 5 ? 0.26 : altitudeKm > 2 ? 0.18 : 0.14,
        altitudeKm > 24 ? 0.92 : altitudeKm > 20 ? 0.88 : altitudeKm > 14 ? 0.88 : altitudeKm > 8 ? 0.76 : altitudeKm > 5 ? 0.52 : altitudeKm > 2 ? 0.42 : 0.34,
      ),
    )
    : 0;
  const desiredLateralSpeedKmS = Math.hypot(desiredEastSpeedKmS, desiredNorthSpeedKmS);
  if (terminalTranslateSpeedFloorKmS > desiredLateralSpeedKmS) {
    desiredEastSpeedKmS = -guidedEastErrorKm / guidedLateralRangeKm * terminalTranslateSpeedFloorKmS;
    desiredNorthSpeedKmS = -guidedNorthErrorKm / guidedLateralRangeKm * terminalTranslateSpeedFloorKmS;
  }
  const desiredVerticalSpeedLimitKmS = altitudeKm <= 0.4
    ? 0.018
    : altitudeKm <= 1.0
      ? 0.035
      : altitudeKm <= 2.0
        ? 0.075
        : altitudeKm <= 4.0
          ? 0.16
        : altitudeKm <= 8.0
          ? 0.42
          : 0.65;
  let desiredVerticalSpeedKmS = clamp(
    -catchVerticalErrorKm / Math.max(effectiveInterceptTimeSec * 1.05, 0.75),
    -desiredVerticalSpeedLimitKmS,
    0.01,
  );
  if (catchVerticalErrorKm > 1.2) {
    const descentRateFloorKmS = altitudeKm > 12
      ? -0.62
      : altitudeKm > 8
        ? -0.46
        : altitudeKm > 5
          ? -0.30
          : altitudeKm > 3
            ? -0.18
            : -0.08;
    desiredVerticalSpeedKmS = Math.min(desiredVerticalSpeedKmS, descentRateFloorKmS);
  }
  const eastSpeedErrorKmS = desiredEastSpeedKmS - catchEastSpeedKmS;
  const northSpeedErrorKmS = desiredNorthSpeedKmS - catchNorthSpeedKmS;
  const verticalSpeedErrorKmS = desiredVerticalSpeedKmS - catchVerticalSpeedKmS;
  const predictedEastMissKm = catchEastErrorKm + (catchEastSpeedKmS * effectiveInterceptTimeSec);
  const predictedNorthMissKm = catchNorthErrorKm + (catchNorthSpeedKmS * effectiveInterceptTimeSec);
  const predictedVerticalMissKm = catchVerticalErrorKm + (catchVerticalSpeedKmS * effectiveInterceptTimeSec);
  const predictedLateralMissKm = Math.hypot(predictedEastMissKm, predictedNorthMissKm);
  const predictedTotalMissKm = Math.hypot(predictedLateralMissKm, predictedVerticalMissKm);
  const predictedGuidedEastMissKm = guidedEastErrorKm + (catchEastSpeedKmS * effectiveInterceptTimeSec);
  const predictedGuidedNorthMissKm = guidedNorthErrorKm + (catchNorthSpeedKmS * effectiveInterceptTimeSec);
  const predictedGuidedLateralMissKm = Math.hypot(
    predictedGuidedEastMissKm,
    predictedGuidedNorthMissKm,
  );
  const guidedLateralMissDotKm2 =
    (guidedEastErrorKm * predictedGuidedEastMissKm)
    + (guidedNorthErrorKm * predictedGuidedNorthMissKm);
  const predictedCenterlineOvershootNorm = poweredFinalBurnActive && guidedLateralRangeKm > 1e-6
    ? clamp(
      (-guidedLateralMissDotKm2) / Math.max(guidedLateralRangeKm * guidedLateralRangeKm, 1e-6),
      0,
      1,
    )
    : 0;
  const poweredCloseBrakeNorm = poweredFinalBurnActive
    ? clamp(
      Math.max(
        (1.15 - catchLateralRangeKm) / 1.15,
        predictedCenterlineOvershootNorm * ((0.28 - predictedGuidedLateralMissKm) / 0.28),
      )
        * clamp(Math.hypot(catchEastSpeedKmS, catchNorthSpeedKmS) / 0.055, 0, 1),
      0,
      1,
    )
    : 0;
  const poweredCorridorBrakeNorm = poweredFinalBurnActive
    ? clamp(
      Math.max(
        (1.65 - catchLateralRangeKm) / 1.65,
        predictedCenterlineOvershootNorm * ((0.55 - predictedGuidedLateralMissKm) / 0.55),
      )
        * clamp(Math.hypot(catchEastSpeedKmS, catchNorthSpeedKmS) / 0.12, 0, 1),
      0,
      1,
    )
    : 0;
  const localDirection = {
	    east: clamp(
	      (eastSpeedErrorKmS / Math.max(0.07, desiredLateralSpeedLimitKmS * 0.42))
	        - (predictedGuidedEastMissKm / 4.0)
	        - (guidedEastErrorKm / 18.0)
        - ((catchEastSpeedKmS / 0.18) * eastCrosslineDriftNorm)
        - ((catchEastSpeedKmS / 0.070) * poweredCloseBrakeNorm)
        - ((catchEastSpeedKmS / 0.120) * poweredCorridorBrakeNorm)
        - ((guidedEastErrorKm / 1.20) * poweredCloseBrakeNorm),
			      -1.35,
			      1.35,
		    ),
	    north: clamp(
	      (northSpeedErrorKmS / Math.max(0.07, desiredLateralSpeedLimitKmS * 0.42))
	        - (predictedGuidedNorthMissKm / 4.0)
	        - (guidedNorthErrorKm / 18.0)
        - ((catchNorthSpeedKmS / 0.18) * northCrosslineDriftNorm)
        - ((catchNorthSpeedKmS / 0.070) * poweredCloseBrakeNorm)
        - ((catchNorthSpeedKmS / 0.120) * poweredCorridorBrakeNorm)
        - ((guidedNorthErrorKm / 1.20) * poweredCloseBrakeNorm),
			      -1.35,
			      1.35,
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
  const verticalDemandNorm = clamp(verticalSpeedErrorKmS / 0.05, 0, 1);
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
    crosslineDriftNorm,
    effectiveInterceptTimeSec,
  };
}

export function resolveBoosterCatchCommand(input = {}) {
  const currentPhase = String(input.currentPhase || "").toLowerCase();
  const sustainingCatchApproach =
    currentPhase === "catch-approach"
    || currentPhase === "catch-burn"
    || currentPhase === "landing-burn"
    || currentPhase === "terminal-intercept";
  const sustainingPoweredCatchBurn =
    currentPhase === "landing-burn"
    || currentPhase === "catch-burn";
  const sustainOverride = Boolean(input.sustainOverride);
  const sustainRelaxed = Boolean(input.sustainRelaxed);
  const allowFinalBurn = input.allowFinalBurn !== false;
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
  const catchPositionSigmaLimitKm = altitudeKm > 20
    ? 0.090
    : BOOSTER_CATCH_CONFIG.maxPositionSigmaKm;
  const catchVelocitySigmaLimitKmS = altitudeKm > 20
    ? 0.0012
    : BOOSTER_CATCH_CONFIG.maxVelocitySigmaKmS;
  if (catchPositionSigmaKm > catchPositionSigmaLimitKm) {
    return null;
  }
  if (catchVelocitySigmaKmS > catchVelocitySigmaLimitKmS) {
    return null;
  }
  if (altitudeKm > BOOSTER_CATCH_CONFIG.startAltitudeKm) {
    return null;
  }
  const terminalCatchBurnReacquire = Boolean(
    currentPhase === "terminal-intercept"
    && altitudeKm <= BOOSTER_CATCH_CONFIG.finalBurnAltitudeKm
    && catchLateralRangeKm <= BOOSTER_CATCH_CONFIG.finalBurnLateralRangeKm
    && Math.abs(catchVerticalErrorKm) <= BOOSTER_CATCH_CONFIG.finalBurnVerticalErrorKm
    && catchLateralSpeedKmS <= 0.22
    && catchApproachSpeedKmS <= BOOSTER_CATCH_CONFIG.finalBurnApproachSpeedKmS
    && bodyUpAlignment >= BOOSTER_CATCH_CONFIG.minFinalBurnBodyUpAlignment
	  );
  const stagedBurnStartAltitudeKm = sustainingPoweredCatchBurn ? 30.5 : 20.5;
	  const stagedLandingBurnWindow = Boolean(
	    allowFinalBurn
	    && sustainingCatchApproach
	    && currentPhase !== "terminal-intercept"
	    && altitudeKm <= stagedBurnStartAltitudeKm
    && altitudeKm > BOOSTER_CATCH_CONFIG.finalBurnAltitudeKm
    && catchLateralRangeKm <= (
      altitudeKm > 24.0
        ? 20.0
        : altitudeKm > 14.0
        ? 20.0
        : altitudeKm > 8.0
          ? 14.0
          : (sustainingPoweredCatchBurn ? 14.0 : 6.0)
    )
    && Math.abs(catchVerticalErrorKm) <= (
      altitudeKm > 24.0
        ? 34.0
        : altitudeKm > 14.0
        ? 26.0
        : altitudeKm > 8.0
          ? 16.0
          : 8.0
    )
    && catchApproachSpeedKmS <= (altitudeKm > 24.0 ? 2.05 : 1.85)
    && bodyUpAlignment >= BOOSTER_CATCH_CONFIG.minFinalBurnBodyUpAlignment
  );
  const stagedLandingBurnCandidate = Boolean(
    stagedLandingBurnWindow
    && (
      catchVerticalSpeedKmS < -0.42
      || catchLateralSpeedKmS > 0.34
      || (
        currentPhase === "landing-burn"
        && catchVerticalSpeedKmS < -0.035
        && catchLateralSpeedKmS > 0.08
      )
    )
  );
  const highCorridorBurnLatch = Boolean(
    (currentPhase === "landing-burn" || currentPhase === "catch-burn")
    && (
      (
        altitudeKm <= BOOSTER_CATCH_CONFIG.finalBurnAltitudeKm
        && catchLateralRangeKm <= BOOSTER_CATCH_CONFIG.finalBurnLateralRangeKm
        && Math.abs(catchVerticalErrorKm) <= BOOSTER_CATCH_CONFIG.finalBurnVerticalErrorKm
        && catchLateralSpeedKmS <= 0.22
        && catchApproachSpeedKmS <= BOOSTER_CATCH_CONFIG.finalBurnApproachSpeedKmS
      )
      || stagedLandingBurnWindow
    )
    && bodyUpAlignment >= BOOSTER_CATCH_CONFIG.minFinalBurnBodyUpAlignment
  );
  if (
    altitudeKm <= 30
    && catchLateralRangeKm > (altitudeKm > 24 ? 20 : 12)
  ) {
    return null;
  }
  if (
    altitudeKm <= 24
    && catchLateralRangeKm > (
      sustainingCatchApproach
        ? (altitudeKm > 14 ? 14 : 10)
        : 8
    )
    && !stagedLandingBurnCandidate
    && !(
      sustainingCatchApproach
      && catchLateralRangeKm <= (altitudeKm > 14 ? 14 : 10)
      && catchApproachSpeedKmS <= (altitudeKm > 14 ? 1.45 : 0.55)
    )
  ) {
    return null;
  }
  if (
    altitudeKm <= 10
    && catchLateralRangeKm > 5.0
    && !highCorridorBurnLatch
    && !stagedLandingBurnCandidate
  ) {
    return null;
  }
  if (
    altitudeKm <= 8
    && (
      catchLateralRangeKm > (
        sustainingPoweredCatchBurn ? 5.0 : (sustainingCatchApproach ? 2.8 : 2.2)
      )
      || catchLateralSpeedKmS > (sustainingCatchApproach ? 0.85 : 0.32)
    )
    && !highCorridorBurnLatch
    && !stagedLandingBurnCandidate
  ) {
    return null;
  }
  if (
    altitudeKm <= 8
    && Math.abs(catchVerticalErrorKm) > 4.0
    && !latchedCatchApproach
    && !highCorridorBurnLatch
    && !stagedLandingBurnCandidate
  ) {
    return null;
  }
  if (
    altitudeKm > 3.0
    && catchLateralSpeedKmS > (
      altitudeKm > 10.0
        ? 1.15
        : altitudeKm > 6.0
          ? (sustainingCatchApproach ? 0.95 : 0.62)
          : (sustainingCatchApproach ? 0.58 : 0.30)
    )
  ) {
    return null;
  }
  if (
    altitudeKm <= 6
    && (
      catchLateralRangeKm > (
        sustainingPoweredCatchBurn ? 4.2 : (sustainingCatchApproach ? 2.4 : 2.8)
      )
      || catchLateralSpeedKmS > (sustainingCatchApproach ? 0.58 : 0.34)
    )
    && !highCorridorBurnLatch
    && !stagedLandingBurnCandidate
  ) {
    return null;
  }
  if (
    altitudeKm <= 4
    && (
      catchLateralRangeKm > (
        sustainingPoweredCatchBurn ? 10.0 : (sustainingCatchApproach ? 1.2 : 1.4)
      )
      || catchLateralSpeedKmS > (
        sustainingPoweredCatchBurn ? 0.46 : (sustainingCatchApproach ? 0.34 : 0.24)
      )
    )
    && !stagedLandingBurnCandidate
  ) {
    return null;
  }
  if (
    altitudeKm <= 2.6
    && (
      catchLateralRangeKm > (sustainingPoweredCatchBurn ? 14.0 : 1.05)
      || catchLateralSpeedKmS > (sustainingPoweredCatchBurn ? 0.45 : 0.22)
      || Math.abs(catchVerticalErrorKm) > 2.6
    )
    && !stagedLandingBurnCandidate
  ) {
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
  const altitudeRangeLimitKm = altitudeKm > 20
    ? approachRangeLimitKm
    : altitudeKm > 10
      ? Math.min(approachRangeLimitKm, 30)
      : highCorridorBurnLatch
        ? Math.min(
          approachRangeLimitKm,
          altitudeKm > 5
            ? 16
            : (sustainingPoweredCatchBurn ? 18 : 8),
        )
        : Math.min(approachRangeLimitKm, sustainingCatchApproach ? 12 : 8);
  const altitudeLateralLimitKm = altitudeKm > 20
    ? approachLateralLimitKm
    : altitudeKm > 10
      ? Math.min(approachLateralLimitKm, 18)
      : highCorridorBurnLatch
	        ? Math.min(
	          approachLateralLimitKm,
	          altitudeKm > 8
	            ? 12.5
	            : altitudeKm > 5
	              ? 10.5
	              : (sustainingPoweredCatchBurn ? 14.0 : 3.6),
	        )
	        : Math.min(approachLateralLimitKm, sustainingPoweredCatchBurn ? 16 : 6);

  if (catchTotalRangeKm > altitudeRangeLimitKm) {
    return null;
  }
  if (catchLateralRangeKm > altitudeLateralLimitKm) {
    return null;
  }
  if (Math.abs(catchVerticalErrorKm) > approachVerticalLimitKm) {
    return null;
  }
  if (catchApproachSpeedKmS > approachSpeedLimitKmS) {
    return null;
  }
	  const minimumApproachBodyUpAlignment = highCorridorBurnLatch
	    ? 0.50
	    : sustainingPoweredCatchBurn
	      ? 0.50
	      : latchedCatchApproach
	        ? BOOSTER_CATCH_CONFIG.minLatchedBodyUpAlignment
	        : BOOSTER_CATCH_CONFIG.minApproachBodyUpAlignment;
  if (bodyUpAlignment < minimumApproachBodyUpAlignment) {
    return null;
  }

  const interceptTimeSec = resolveInterceptTimeSec({
    catchTotalRangeKm,
    catchApproachSpeedKmS,
    catchVerticalErrorKm,
    catchVerticalSpeedKmS,
  });
  const predictive = resolvePredictiveCatchMetrics({
    currentPhase,
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

  const sustainedFinalBurnEligible =
    (currentPhase === "landing-burn" || currentPhase === "catch-burn")
    && altitudeKm <= (BOOSTER_CATCH_CONFIG.finalBurnAltitudeKm + (currentPhase === "landing-burn" ? 0.85 : 0.35))
    && catchTotalRangeKm <= (currentPhase === "landing-burn" ? 6.0 : BOOSTER_CATCH_CONFIG.finalBurnRangeKm * 1.18)
    && catchLateralRangeKm <= (currentPhase === "landing-burn" ? 5.0 : BOOSTER_CATCH_CONFIG.finalBurnLateralRangeKm * 3.00)
    && Math.abs(catchVerticalErrorKm) <= (currentPhase === "landing-burn" ? 3.2 : BOOSTER_CATCH_CONFIG.finalBurnVerticalErrorKm * 1.10)
    && catchApproachSpeedKmS <= (currentPhase === "landing-burn" ? 0.90 : BOOSTER_CATCH_CONFIG.finalBurnApproachSpeedKmS * 1.20)
    && catchLateralSpeedKmS <= (currentPhase === "landing-burn" ? 0.38 : 0.24)
    && catchVerticalSpeedKmS <= (currentPhase === "landing-burn" ? 0.12 : 0.08);
  const sustainedHighCorridorBurnEligible =
    highCorridorBurnLatch
    && catchVerticalSpeedKmS <= 0.14;
  const highCorridorFarBrakeBurnEligible =
    false;
  const highCorridorNearBrakeBurnEligible =
    altitudeKm <= BOOSTER_CATCH_CONFIG.finalBurnAltitudeKm
    && catchLateralRangeKm <= BOOSTER_CATCH_CONFIG.finalBurnLateralRangeKm
    && Math.abs(catchVerticalErrorKm) <= BOOSTER_CATCH_CONFIG.finalBurnVerticalErrorKm
    && catchLateralSpeedKmS <= 0.24
    && catchVerticalSpeedKmS <= 0.06
    && catchApproachSpeedKmS <= 0.50
    && bodyUpAlignment >= BOOSTER_CATCH_CONFIG.minFinalBurnBodyUpAlignment;
  const highCorridorBrakeBurnEligible =
    (sustainingCatchApproach || terminalCatchBurnReacquire)
    && altitudeKm <= BOOSTER_CATCH_CONFIG.finalBurnAltitudeKm
    && (
      highCorridorFarBrakeBurnEligible
      || highCorridorNearBrakeBurnEligible
      || sustainedHighCorridorBurnEligible
      || terminalCatchBurnReacquire
    );
  const immediateFinalBurnEligible =
    !sustainingCatchApproach
    && altitudeKm <= 1.0
    && catchTotalRangeKm <= 0.75
    && catchLateralRangeKm <= 0.45
    && Math.abs(catchVerticalErrorKm) <= 0.20
    && catchApproachSpeedKmS <= 0.16;
	  const finalBurnBodyUpAlignmentMin = currentPhase === "catch-burn"
	    ? 0.50
	    : BOOSTER_CATCH_CONFIG.minFinalBurnBodyUpAlignment;
  const finalBurnEligible =
    allowFinalBurn
    && bodyUpAlignment >= finalBurnBodyUpAlignmentMin
    && (
      immediateFinalBurnEligible
      || stagedLandingBurnCandidate
      || highCorridorBrakeBurnEligible
      || sustainedHighCorridorBurnEligible
      || sustainedFinalBurnEligible
	      || (
	        currentPhase === "landing-burn"
	        && catchTotalRangeKm <= 36.0
	        && catchLateralRangeKm <= 16.0
	        && Math.abs(catchVerticalErrorKm) <= 34.0
	        && catchApproachSpeedKmS <= 1.65
	        && catchLateralSpeedKmS <= 0.72
        && catchVerticalSpeedKmS <= 0.20
      )
	      || (
	        currentPhase === "catch-burn"
	        && catchTotalRangeKm <= 42.0
	        && catchLateralRangeKm <= 16.0
	        && Math.abs(catchVerticalErrorKm) <= 34.0
	        && catchApproachSpeedKmS <= 1.45
	        && catchLateralSpeedKmS <= 0.68
        && catchVerticalSpeedKmS <= 0.20
      )
      || (
        sustainingCatchApproach
        && (
          (
            altitudeKm <= BOOSTER_CATCH_CONFIG.finalBurnAltitudeKm
            && catchTotalRangeKm <= BOOSTER_CATCH_CONFIG.finalBurnRangeKm
            && catchLateralRangeKm <= BOOSTER_CATCH_CONFIG.finalBurnLateralRangeKm
            && Math.abs(catchVerticalErrorKm) <= BOOSTER_CATCH_CONFIG.finalBurnVerticalErrorKm
            && catchApproachSpeedKmS <= BOOSTER_CATCH_CONFIG.finalBurnApproachSpeedKmS
            && catchLateralSpeedKmS <= 0.24
          )
          || (
            altitudeKm <= BOOSTER_CATCH_CONFIG.finalBurnAltitudeKm
            &&
            catchTotalRangeKm <= BOOSTER_CATCH_CONFIG.finalBurnRangeKm
            && catchLateralRangeKm <= BOOSTER_CATCH_CONFIG.finalBurnLateralRangeKm
            && Math.abs(catchVerticalErrorKm) <= BOOSTER_CATCH_CONFIG.finalBurnVerticalErrorKm
            && catchApproachSpeedKmS <= BOOSTER_CATCH_CONFIG.finalBurnApproachSpeedKmS
            && catchLateralSpeedKmS <= 0.24
            && predictive.predictedLateralMissKm <= BOOSTER_CATCH_CONFIG.finalPredictiveLateralMissKm
            && Math.abs(predictive.predictedVerticalMissKm) <= BOOSTER_CATCH_CONFIG.finalPredictiveVerticalMissKm
          )
        )
      )
    );

  const precisionCatchBurnEligible = Boolean(
    finalBurnEligible
    && bodyUpAlignment >= 0.82
    && (
      (
        catchTotalRangeKm <= 0.42
        && catchLateralRangeKm <= 0.16
        && Math.abs(catchVerticalErrorKm) <= 0.45
        && catchApproachSpeedKmS <= 0.14
        && catchLateralSpeedKmS <= 0.08
      )
      || (
	        currentPhase === "catch-burn"
	        && catchTotalRangeKm <= 24.0
	        && catchLateralRangeKm <= 12.0
	        && Math.abs(catchVerticalErrorKm) <= 24.0
	        && catchApproachSpeedKmS <= 1.20
	        && catchLateralSpeedKmS <= 0.60
	        && catchVerticalSpeedKmS <= 0.20
	      )
      || (
        (currentPhase === "landing-burn" || currentPhase === "catch-burn")
        && altitudeKm <= (currentPhase === "landing-burn" ? 16.0 : 22.0)
        && catchTotalRangeKm <= (currentPhase === "catch-burn" ? 18.0 : 18.0)
        && catchLateralRangeKm <= (currentPhase === "catch-burn" ? 5.6 : 4.8)
        && Math.abs(catchVerticalErrorKm) <= (currentPhase === "catch-burn" ? 18.0 : 18.0)
        && catchApproachSpeedKmS <= (currentPhase === "catch-burn" ? 1.25 : 1.18)
        && catchLateralSpeedKmS <= (currentPhase === "catch-burn" ? 0.58 : 0.50)
        && catchVerticalSpeedKmS <= 0.08
      )
    )
  );
  const phase = finalBurnEligible
    ? (precisionCatchBurnEligible ? "catch-burn" : "landing-burn")
    : "catch-approach";
  const guidanceMode = finalBurnEligible
    ? (precisionCatchBurnEligible ? "booster-catch-burn" : "booster-landing-burn")
    : "booster-catch-approach";
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
    (finalBurnEligible ? 0.18 : 0.10)
      + (0.18 * predictive.lateralDemandNorm),
    finalBurnEligible ? 0.14 : 0.08,
    finalBurnEligible ? 0.36 : 0.20,
  );
  const finalBurnBrakeNorm = clamp(
    (predictive.desiredVerticalSpeedKmS - catchVerticalSpeedKmS) / 0.28,
    0,
    1,
  );
  const finalBurnLateralBrakeNorm = clamp(
    Math.max(
      predictive.lateralDemandNorm * clamp(catchLateralSpeedKmS / 0.45, 0, 1),
      0.68 * predictive.lateralDemandNorm * clamp(catchLateralRangeKm / 4.0, 0, 1),
    ),
    0,
    1,
  );
  const highCorridorFinalBurn = finalBurnEligible && (
    stagedLandingBurnCandidate
    || highCorridorBrakeBurnEligible
    || sustainedFinalBurnEligible
  );
  const finalBurnSlowOrAscendingNorm = clamp(
    (catchVerticalSpeedKmS - predictive.desiredVerticalSpeedKmS + 0.015) / 0.12,
    0,
    1,
  );
  const finalBurnSlowPenaltyNorm = finalBurnSlowOrAscendingNorm * (
    1 - ((highCorridorFinalBurn ? 0.35 : 0.90) * finalBurnLateralBrakeNorm)
  );
  const highCorridorLateralSpeedBrakeNorm = highCorridorFinalBurn
    ? clamp((catchLateralSpeedKmS - 0.14) / 0.58, 0, 1)
    : 0;
  const highCorridorLateralSettledNorm = highCorridorFinalBurn
    ? clamp((0.26 - catchLateralSpeedKmS) / 0.16, 0, 1)
    : 1;
  const crosslineCorrectionFloor = Number(predictive.crosslineDriftNorm || 0) > 0.10
    && altitudeKm > 3.2
    ? clamp(0.04 + (0.10 * Number(predictive.crosslineDriftNorm || 0)), 0.04, 0.14)
    : 0;
  let throttle = finalBurnEligible
    ? clamp(
      (highCorridorFinalBurn ? 0.04 : 0.12)
        + (0.66 * finalBurnBrakeNorm)
        + (0.52 * finalBurnLateralBrakeNorm)
        + (0.30 * highCorridorLateralSpeedBrakeNorm)
        + (0.10 * clamp(-predictive.predictedVerticalMissKm / 0.24, 0, 1))
        + (0.08 * predictive.lateralDemandNorm)
        + (0.14 * Number(predictive.crosslineDriftNorm || 0))
        - ((highCorridorFinalBurn ? 0.72 : 0.50) * finalBurnSlowPenaltyNorm),
      highCorridorFinalBurn
        ? Math.max(0.42 + (0.22 * highCorridorLateralSpeedBrakeNorm), crosslineCorrectionFloor)
        : Math.max(finalBurnLateralBrakeNorm > 0.25 ? 0.08 : 0, crosslineCorrectionFloor),
      highCorridorFinalBurn ? 0.94 : 0.98,
    )
    : clamp(
      approachThrottle
        + (0.38 * predictive.verticalDemandNorm)
        + (0.10 * clamp(-predictive.predictedVerticalMissKm / 0.12, 0, 1)),
      0.18,
      0.70,
    );
  if (finalBurnEligible && highCorridorFinalBurn) {
    const highCorridorBallisticSettleNorm = clamp(
      (catchVerticalSpeedKmS - predictive.desiredVerticalSpeedKmS + 0.020) / 0.18,
      0,
      1,
    )
      * clamp((catchLateralRangeKm - 0.9) / 0.9, 0, 1)
      * clamp((12.2 - altitudeKm) / 2.8, 0, 1)
      * clamp((altitudeKm - 4.8) / 3.0, 0, 1);
    if (highCorridorBallisticSettleNorm > 1e-6) {
      const ballisticSettleThrottleCap = clamp(
        0.02
          + (0.06 * highCorridorLateralSpeedBrakeNorm)
          + (0.04 * predictive.lateralDemandNorm),
        0.02,
        0.14,
      );
      throttle = Math.min(
        throttle,
        (throttle * (1 - highCorridorBallisticSettleNorm))
          + (ballisticSettleThrottleCap * highCorridorBallisticSettleNorm),
      );
    }
  }
  if (finalBurnEligible && phase === "landing-burn") {
    throttle = Math.max(
      throttle,
      clamp(
        0.42
          + (0.24 * clamp(catchLateralSpeedKmS / 0.14, 0, 1))
          + (0.14 * clamp(catchLateralRangeKm / 2.8, 0, 1)),
        0.42,
        0.86,
      ),
    );
    const verticalSpeedExcessKmS = catchVerticalSpeedKmS - predictive.desiredVerticalSpeedKmS;
    if (verticalSpeedExcessKmS > 0.015) {
      const positiveVerticalNorm = clamp((verticalSpeedExcessKmS - 0.015) / 0.14, 0, 1);
      const lateralBrakeAllowance = 0.18 * finalBurnLateralBrakeNorm;
      throttle = Math.min(
        throttle,
        clamp(0.32 + lateralBrakeAllowance - (0.12 * positiveVerticalNorm), 0.20, 0.50),
      );
    }
  }
  if (finalBurnEligible && phase === "catch-burn" && catchLateralRangeKm > 2.0) {
    const lateralThrottleVerticalGate = clamp((0.04 - catchVerticalSpeedKmS) / 0.18, 0, 1);
    const terminalLateralThrottleFloor = clamp(
      0.52
        + (0.035 * Math.min(catchLateralRangeKm, 10))
        + (0.18 * clamp((catchLateralSpeedKmS - 0.08) / 0.26, 0, 1)),
      0.56,
      0.92,
    );
    throttle = Math.max(throttle, terminalLateralThrottleFloor * lateralThrottleVerticalGate);
  }
  const finalTerminalTightenNorm = clamp(
    Math.max(
      (1.2 - altitudeKm) / 1.2,
      (0.35 - catchTotalRangeKm) / 0.35,
      (0.16 - catchLateralRangeKm) / 0.16,
    ),
    0,
    1,
  );
	  const highCorridorTiltLimitDeg = highCorridorFinalBurn
	    ? clamp(
	      20.0
	        + (0.65 * Math.min(Math.abs(catchVerticalErrorKm), 8))
	        + (3.00 * Math.min(catchLateralRangeKm, 10)),
	      20.0,
	      52.0,
	    )
    : 25.0;
  const closeLateralVelocityBrakeTiltDeg = (
    phase === "landing-burn"
    && catchLateralSpeedKmS > 0.035
  )
    ? 18.0
      * clamp(catchLateralSpeedKmS / 0.13, 0, 1)
      * clamp((1.4 - catchLateralRangeKm) / 1.4, 0, 1)
    : 0;
  const landingBurnTiltLimitDeg = phase === "landing-burn"
    ? clamp(
      18.0
        + (5.0 * clamp(catchLateralRangeKm / 2.5, 0, 1))
        + (8.0 * clamp(catchLateralSpeedKmS / 0.24, 0, 1))
        + (4.0 * predictive.lateralDemandNorm),
      18.0,
      35.0,
    ) + closeLateralVelocityBrakeTiltDeg
    : highCorridorTiltLimitDeg;
  const landingBurnTiltLimitClampedDeg = phase === "landing-burn"
    ? clamp(
      landingBurnTiltLimitDeg,
      18.0,
      42.0,
    )
    : highCorridorTiltLimitDeg;
  const highCorridorTerminalTightenNorm = highCorridorFinalBurn
    ? clamp(
      Math.max(
        (5.0 - altitudeKm) / 3.0,
        (2.2 - catchTotalRangeKm) / 2.2,
        ((1.1 - catchLateralRangeKm) / 1.1) * highCorridorLateralSettledNorm,
      ),
      0,
      1,
    )
    : 0;
  const finalBurnTiltLimitDeg = clamp(
    highCorridorFinalBurn
      ? (
        phase === "landing-burn"
          ? landingBurnTiltLimitClampedDeg
          : highCorridorTiltLimitDeg
          - (highCorridorTerminalTightenNorm * Math.max(0, highCorridorTiltLimitDeg - 8.0))
      )
      : (
        4.0
          + (18.0 * (1 - finalTerminalTightenNorm))
          + (0.42 * Math.min(catchLateralRangeKm, 8))
      ),
    4.0,
    landingBurnTiltLimitClampedDeg,
  );

  return {
    phase,
    guidanceMode,
    attitudeControlMode: finalBurnEligible ? "engines+rcs" : "grid-fins+rcs",
    qAlphaSteeringEnabled: false,
    siteTargetingEnabled: false,
    throttle: finalBurnEligible ? throttle : 0,
    directionMix: {
      up: finalBurnEligible ? (phase === "landing-burn" ? 0.86 : 1.0) : 0.92,
      retrograde: finalBurnEligible ? (phase === "landing-burn" ? 0.10 : 0.06) : 0.12,
      antiTangent: finalBurnEligible ? (phase === "landing-burn" ? 0.06 : 0.02) : 0.08,
    },
    captureLike: true,
    terminalUprightCommit: true,
    uprightTiltLimitDeg: finalBurnEligible
      ? finalBurnTiltLimitDeg
      : clamp(
        8 + (0.8 * Math.min(catchLateralRangeKm, 14)),
        8,
        altitudeKm > 2.0 ? 24 : 14,
      ),
    attitudeResponseScale: finalBurnEligible
      ? (phase === "landing-burn" ? 4.85 : (highCorridorFinalBurn ? 4.60 : 1.48))
      : 1.58 + (0.78 * uprightErrorNorm),
    attitudeTargetBlend: finalBurnEligible
      ? (highCorridorFinalBurn ? 0.985 : 0.96)
      : 0.88 + (0.08 * uprightErrorNorm),
    angularDampingPerS: finalBurnEligible
      ? (phase === "landing-burn" ? 1.95 : (highCorridorFinalBurn ? 1.90 : 1.14))
      : 1.08 + (0.24 * uprightErrorNorm),
    maxBodyRateDegS: finalBurnEligible
      ? (phase === "landing-burn" ? 40.0 : (highCorridorFinalBurn ? 44.0 : 5.8))
      : 16.0,
    predictiveCatchControl: {
      enabled: true,
      blend,
      retrogradeBias,
      translationOnly: false,
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
        finalBurnEligible ? 0.35 : 0.52,
        finalBurnEligible ? 0.88 : 1.18,
      ),
	      interceptTimeSec: predictive.effectiveInterceptTimeSec || interceptTimeSec,
      localDirection: highCorridorFinalBurn
        ? {
          ...predictive.localDirection,
          up: clamp(
            Number(predictive.localDirection?.up) || 0,
	            phase === "landing-burn"
	              ? 0.72
	              : (
		                catchLateralRangeKm > 2.0
		                  ? 0.36
	                  : catchLateralRangeKm > 0.45 || catchLateralSpeedKmS > 0.045
	                    ? 0.56
	                  : 0.92
	              ),
	            phase === "landing-burn" ? 1.10 : (
		              catchLateralRangeKm > 2.0
		                ? 0.58
	                : catchLateralRangeKm > 0.45 || catchLateralSpeedKmS > 0.045
	                  ? 0.76
	                : 1.10
	            ),
          ),
        }
        : { ...predictive.localDirection },
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
  bodyUpAlignment,
  bodyAngularRateRadS,
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
  const finalBodyUpAlignment = clamp(
    Number.isFinite(Number(bodyUpAlignment)) ? Number(bodyUpAlignment) : 1,
    -1,
    1,
  );
  const finalBodyRateRadS = Math.max(0, Number(bodyAngularRateRadS) || 0);
  const holdSec = Math.max(0, Number(catchHoldSec) || 0);
  const verticalToleranceKm = BOOSTER_CATCH_GEOMETRY_KM.finalizePinHeightToleranceKm;
  return (
    lateralRangeKm <= BOOSTER_CATCH_GEOMETRY_KM.finalizeLateralToleranceKm
    && verticalErrorKm <= verticalToleranceKm
    && speed <= BOOSTER_CATCH_CONFIG.finalizeSpeedKmS
    && radialSpeed <= BOOSTER_CATCH_CONFIG.finalizeVerticalSpeedKmS
    && finalBodyUpAlignment >= BOOSTER_CATCH_GEOMETRY_KM.finalizeBodyUpAlignmentMin
    && finalBodyRateRadS <= BOOSTER_CATCH_GEOMETRY_KM.finalizeBodyRateRadSMax
    && holdSec >= BOOSTER_CATCH_CONFIG.finalizeHoldSec
  );
}
