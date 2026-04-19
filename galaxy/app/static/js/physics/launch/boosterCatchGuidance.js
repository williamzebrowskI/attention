export const BOOSTER_CATCH_CONFIG = Object.freeze({
  enabled: true,
  startAltitudeKm: 0.9,
  maxLateralRangeKm: 0.35,
  maxTotalRangeKm: 0.55,
  maxTangentialSpeedKmS: 0.18,
  maxDownwardSpeedKmS: 0.18,
  finalizeLateralRangeKm: 0.03,
  finalizePinHeightErrorKm: 0.006,
  finalizeSpeedKmS: 0.05,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function resolveBoosterCatchCommand(input = {}) {
  if (!BOOSTER_CATCH_CONFIG.enabled || input?.catchEnabled === false) {
    return null;
  }

  const altitudeKm = Math.max(0, Number(input.altitudeKm) || 0);
  const radialSpeedKmS = Number(input.radialSpeedKmS) || 0;
  const tangentialSpeedKmS = Math.max(0, Number(input.tangentialSpeedKmS) || 0);
  const launchSiteRangeKm = Math.max(0, Number(input.launchSiteRangeKm) || 0);
  const launchSiteLateralRangeKm = Math.max(0, Number(input.launchSiteLateralRangeKm) || 0);

  if (altitudeKm > BOOSTER_CATCH_CONFIG.startAltitudeKm) {
    return null;
  }
  if (launchSiteRangeKm > BOOSTER_CATCH_CONFIG.maxTotalRangeKm) {
    return null;
  }
  if (launchSiteLateralRangeKm > BOOSTER_CATCH_CONFIG.maxLateralRangeKm) {
    return null;
  }
  if (tangentialSpeedKmS > BOOSTER_CATCH_CONFIG.maxTangentialSpeedKmS) {
    return null;
  }
  if (radialSpeedKmS > 0.03 || (-radialSpeedKmS) > BOOSTER_CATCH_CONFIG.maxDownwardSpeedKmS) {
    return null;
  }

  const descentNorm = clamp((-radialSpeedKmS) / BOOSTER_CATCH_CONFIG.maxDownwardSpeedKmS, 0, 1);
  const lateralNorm = clamp(launchSiteLateralRangeKm / BOOSTER_CATCH_CONFIG.maxLateralRangeKm, 0, 1);
  const tangentialNorm = clamp(tangentialSpeedKmS / BOOSTER_CATCH_CONFIG.maxTangentialSpeedKmS, 0, 1);

  return {
    phase: "catch-burn",
    guidanceMode: "booster-catch-burn",
    throttle: clamp(
      0.24
        + (0.30 * descentNorm)
        + (0.14 * lateralNorm)
        + (0.12 * tangentialNorm),
      0.18,
      0.72,
    ),
    directionMix: { up: 1.0, retrograde: 0.16, antiTangent: 0.94 },
    siteVectorWeight: clamp(0.82 + (0.16 * lateralNorm), 0.82, 0.98),
    siteVelocityWeight: clamp(0.34 + (0.22 * tangentialNorm), 0.28, 0.62),
    touchdownReady: false,
    captureLike: true,
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
  const launchSiteLateralRangeKm = Math.max(0, Number(input.launchSiteLateralRangeKm) || 0);
  const catchPinHeightErrorKm = Math.abs(Number(input.catchPinHeightErrorKm));
  const speedKmS = Math.max(0, Number(input.speedKmS) || 0);
  const radialSpeedKmS = Math.abs(Number(input.radialSpeedKmS) || 0);

  return (
    launchSiteLateralRangeKm <= BOOSTER_CATCH_CONFIG.finalizeLateralRangeKm
    && Number.isFinite(catchPinHeightErrorKm)
    && catchPinHeightErrorKm <= BOOSTER_CATCH_CONFIG.finalizePinHeightErrorKm
    && speedKmS <= BOOSTER_CATCH_CONFIG.finalizeSpeedKmS
    && radialSpeedKmS <= 0.03
  );
}
