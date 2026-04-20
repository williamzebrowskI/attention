export const BOOSTER_CATCH_CONFIG = Object.freeze({
  enabled: true,
  startAltitudeKm: 0.85,
  maxLateralRangeKm: 0.22,
  maxVerticalErrorKm: 0.10,
  maxTotalRangeKm: 0.30,
  maxLateralSpeedKmS: 0.10,
  maxVerticalSpeedKmS: 0.14,
  maxApproachSpeedKmS: 0.16,
  finalizeLateralRangeKm: 0.02,
  finalizePinHeightErrorKm: 0.0045,
  finalizeSpeedKmS: 0.04,
  finalizeHoldSec: 0.45,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? fallbackNumeric : 0;
}

export function resolveBoosterCatchCommand(input = {}) {
  if (!BOOSTER_CATCH_CONFIG.enabled || input?.catchEnabled === false) {
    return null;
  }

  const altitudeKm = Math.max(0, finiteNumber(input.altitudeKm, 0));
  const radialSpeedKmS = finiteNumber(input.radialSpeedKmS, 0);
  const tangentialSpeedKmS = Math.max(0, finiteNumber(input.tangentialSpeedKmS, 0));
  const launchSiteRangeKm = Math.max(0, finiteNumber(input.launchSiteRangeKm, 0));
  const launchSiteLateralRangeKm = Math.max(0, finiteNumber(input.launchSiteLateralRangeKm, 0));

  const catchTotalRangeKm = Math.max(0, finiteNumber(input.catchTotalRangeKm, launchSiteRangeKm));
  const catchLateralRangeKm = Math.max(0, finiteNumber(input.catchLateralRangeKm, launchSiteLateralRangeKm));
  const catchVerticalErrorKm = finiteNumber(input.catchVerticalErrorKm, 0);
  const catchLateralSpeedKmS = Math.max(0, finiteNumber(input.catchLateralSpeedKmS, tangentialSpeedKmS));
  const catchVerticalSpeedKmS = finiteNumber(input.catchVerticalSpeedKmS, radialSpeedKmS);
  const catchApproachSpeedKmS = Math.max(
    0,
    finiteNumber(input.catchApproachSpeedKmS, Math.hypot(catchLateralSpeedKmS, catchVerticalSpeedKmS)),
  );

  if (altitudeKm > BOOSTER_CATCH_CONFIG.startAltitudeKm) {
    return null;
  }
  if (catchTotalRangeKm > BOOSTER_CATCH_CONFIG.maxTotalRangeKm) {
    return null;
  }
  if (catchLateralRangeKm > BOOSTER_CATCH_CONFIG.maxLateralRangeKm) {
    return null;
  }
  if (Math.abs(catchVerticalErrorKm) > BOOSTER_CATCH_CONFIG.maxVerticalErrorKm) {
    return null;
  }
  if (catchLateralSpeedKmS > BOOSTER_CATCH_CONFIG.maxLateralSpeedKmS) {
    return null;
  }
  if (catchVerticalSpeedKmS > 0.03 || (-catchVerticalSpeedKmS) > BOOSTER_CATCH_CONFIG.maxVerticalSpeedKmS) {
    return null;
  }
  if (catchApproachSpeedKmS > BOOSTER_CATCH_CONFIG.maxApproachSpeedKmS) {
    return null;
  }

  const lateralNorm = clamp(catchLateralRangeKm / BOOSTER_CATCH_CONFIG.maxLateralRangeKm, 0, 1);
  const verticalNorm = clamp(Math.abs(catchVerticalErrorKm) / BOOSTER_CATCH_CONFIG.maxVerticalErrorKm, 0, 1);
  const lateralSpeedNorm = clamp(catchLateralSpeedKmS / BOOSTER_CATCH_CONFIG.maxLateralSpeedKmS, 0, 1);
  const verticalSpeedNorm = clamp(Math.abs(catchVerticalSpeedKmS) / BOOSTER_CATCH_CONFIG.maxVerticalSpeedKmS, 0, 1);
  const predictedInterceptSec = clamp(
    Math.max(catchLateralRangeKm / Math.max(catchLateralSpeedKmS, 0.01), Math.abs(catchVerticalErrorKm) / Math.max(Math.abs(catchVerticalSpeedKmS), 0.01)),
    0.4,
    6.0,
  );
  const predictedSettleNorm = clamp(predictedInterceptSec / 3.2, 0, 1);

  const targetVerticalSpeedKmS = -clamp(
    0.010
      + (0.040 * verticalNorm)
      + (0.022 * lateralNorm)
      + (0.012 * predictedSettleNorm),
    0.010,
    0.070,
  );
  const verticalRateErrorNorm = clamp(
    Math.abs(catchVerticalSpeedKmS - targetVerticalSpeedKmS) / Math.max(BOOSTER_CATCH_CONFIG.maxVerticalSpeedKmS, 1e-6),
    0,
    1,
  );

  return {
    phase: "catch-burn",
    guidanceMode: "booster-catch-burn",
    throttle: clamp(
      0.24
        + (0.22 * verticalNorm)
        + (0.20 * lateralNorm)
        + (0.16 * lateralSpeedNorm)
        + (0.14 * verticalRateErrorNorm),
      0.18,
      0.78,
    ),
    directionMix: {
      up: 1.0,
      retrograde: clamp(0.06 + (0.12 * verticalSpeedNorm), 0.04, 0.18),
      antiTangent: clamp(0.54 + (0.28 * lateralSpeedNorm) + (0.12 * lateralNorm), 0.54, 0.92),
    },
    siteVectorWeight: clamp(0.76 + (0.20 * lateralNorm) + (0.06 * verticalNorm), 0.72, 0.98),
    siteVelocityWeight: clamp(0.42 + (0.26 * lateralSpeedNorm) + (0.12 * verticalRateErrorNorm), 0.34, 0.84),
    touchdownReady: false,
    captureLike: true,
    towerRelative: true,
  };
}

export function shouldFinalizeBoosterCatch(input = {}) {
  if (!BOOSTER_CATCH_CONFIG.enabled || input?.catchEnabled === false) {
    return false;
  }
  const guidanceMode = String(input.guidanceMode || "").trim().toLowerCase();
  if (!guidanceMode.includes("catch")) {
    return false;
  }
  const launchSiteLateralRangeKm = Math.max(0, finiteNumber(input.launchSiteLateralRangeKm, 0));
  const catchPinHeightErrorKm = Math.abs(finiteNumber(
    input.catchPinHeightErrorKm,
    input.catchVerticalErrorKm,
  ));
  const speedKmS = Math.max(0, finiteNumber(input.speedKmS, 0));
  const radialSpeedKmS = Math.abs(finiteNumber(input.radialSpeedKmS, 0));
  const catchHoldSec = Math.max(0, finiteNumber(input.catchHoldSec, 0));

  return (
    launchSiteLateralRangeKm <= BOOSTER_CATCH_CONFIG.finalizeLateralRangeKm
    && Number.isFinite(catchPinHeightErrorKm)
    && catchPinHeightErrorKm <= BOOSTER_CATCH_CONFIG.finalizePinHeightErrorKm
    && speedKmS <= BOOSTER_CATCH_CONFIG.finalizeSpeedKmS
    && radialSpeedKmS <= 0.03
    && catchHoldSec >= BOOSTER_CATCH_CONFIG.finalizeHoldSec
  );
}
