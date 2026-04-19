import { resolveBoosterCatchCommand } from "./boosterCatchGuidance.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function computeBoosterRecoveryCommand(input = {}) {
  const altitudeKm = Math.max(0, Number(input.altitudeKm) || 0);
  const radialSpeedKmS = Number(input.radialSpeedKmS) || 0;
  const tangentialSpeedKmS = Math.max(0, Number(input.tangentialSpeedKmS) || 0);
  const launchSiteRangeKm = Math.max(0, Number(input.launchSiteRangeKm) || 0);
  const launchSiteLateralRangeKm = Math.max(0, Number(input.launchSiteLateralRangeKm) || 0);
  const launchSiteLateralClosingSpeedKmS = Number(input.launchSiteLateralClosingSpeedKmS) || 0;
  const elapsedSec = Math.max(0, Number(input.timeSinceSeparationSec) || 0);
  const propellantKg = Math.max(0, Number(input.remainingPropellantKg) || 0);
  const dynamicPressurePa = Math.max(0, Number(input.dynamicPressurePa) || 0);
  const reserveLandingKg = Math.max(0, Number(input.reserveLandingPropellantKg) || 0);

  const separationFlipSec = 1.6;
  const separationCoastSec = 4.2;
  const entryBurnUpperKm = 72;
  const entryBurnLowerKm = 26;
  const landingBurnStartKm = 16.0;
  const touchdownBandKm = 0.03;
  const rtlsLateralWindowKm = 130;
  const significantSiteErrorKm = 18;
  const landingSiteTightenKm = 3.0;

  if (altitudeKm <= touchdownBandKm && Math.abs(radialSpeedKmS) < 0.025 && tangentialSpeedKmS < 0.02) {
    return {
      phase: "landed",
      guidanceMode: "booster-landed",
      throttle: 0,
      directionMix: { up: 1, retrograde: 0, antiTangent: 0 },
      siteVectorWeight: 0,
      siteVelocityWeight: 0,
      touchdownReady: true,
    };
  }

  if (elapsedSec < separationFlipSec) {
    return {
      phase: "separation-flip",
      guidanceMode: "booster-separation-flip",
      throttle: 0,
      directionMix: { up: 0.14, retrograde: 0.72, antiTangent: 0.46 },
      siteVectorWeight: 0.14,
      siteVelocityWeight: 0.18,
      touchdownReady: false,
    };
  }

  if (elapsedSec < separationCoastSec) {
    return {
      phase: "separation-coast",
      guidanceMode: "booster-separation-coast",
      throttle: 0,
      directionMix: { up: 0.18, retrograde: 0.36, antiTangent: 0.28 },
      siteVectorWeight: 0.22,
      siteVelocityWeight: 0.26,
      touchdownReady: false,
    };
  }

  const lateralErrorNorm = clamp(launchSiteLateralRangeKm / rtlsLateralWindowKm, 0, 1);
  const closingDeficitNorm = clamp(
    (0.12 - launchSiteLateralClosingSpeedKmS) / 0.24,
    0,
    1,
  );
  const farFromLaunchSite =
    launchSiteLateralRangeKm > significantSiteErrorKm
    || launchSiteRangeKm > (rtlsLateralWindowKm * 1.1);
  const hasBoostbackBudget = propellantKg > (reserveLandingKg * 1.12);
  if (
    altitudeKm > entryBurnUpperKm
    && hasBoostbackBudget
    && (
      tangentialSpeedKmS > 1.05
      || farFromLaunchSite
    )
  ) {
    const tangentialScale = clamp((tangentialSpeedKmS - 1.05) / 2.8, 0, 1);
    const rtlsDemand = Math.max(lateralErrorNorm, closingDeficitNorm);
    return {
      phase: "boostback",
      guidanceMode: "booster-boostback",
      throttle: clamp(
        0.34
          + (0.24 * tangentialScale)
          + (0.20 * rtlsDemand),
        0.3,
        0.78,
      ),
      directionMix: { up: 0.12, retrograde: 0.92, antiTangent: 0.62 },
      siteVectorWeight: clamp(0.46 + (0.4 * rtlsDemand), 0.36, 0.88),
      siteVelocityWeight: clamp(0.28 + (0.28 * rtlsDemand), 0.18, 0.62),
      touchdownReady: false,
    };
  }

  if (altitudeKm <= entryBurnUpperKm && altitudeKm >= entryBurnLowerKm) {
    if (radialSpeedKmS < -0.08 || dynamicPressurePa > 9_500) {
      const descentFactor = clamp((-radialSpeedKmS - 0.08) / 0.32, 0, 1);
      return {
        phase: "entry-burn",
        guidanceMode: "booster-entry-burn",
        throttle: clamp(0.28 + (0.42 * descentFactor), 0.24, 0.8),
        directionMix: { up: 0.74, retrograde: 0.42, antiTangent: 0.74 },
        siteVectorWeight: clamp(0.42 + (0.22 * lateralErrorNorm), 0.3, 0.68),
        siteVelocityWeight: clamp(0.26 + (0.16 * closingDeficitNorm), 0.2, 0.52),
        touchdownReady: false,
      };
    }
    return {
      phase: "ballistic-descent",
      guidanceMode: "booster-ballistic",
      throttle: 0,
      directionMix: { up: 0.2, retrograde: 0.24, antiTangent: 0.42 },
      siteVectorWeight: clamp(0.34 + (0.24 * lateralErrorNorm), 0.24, 0.58),
      siteVelocityWeight: clamp(0.2 + (0.14 * closingDeficitNorm), 0.16, 0.42),
      touchdownReady: false,
    };
  }

  if (altitudeKm > landingBurnStartKm) {
    return {
      phase: "descent-coast",
      guidanceMode: "booster-descent-coast",
      throttle: 0,
      directionMix: { up: 0.18, retrograde: 0.22, antiTangent: 0.54 },
      siteVectorWeight: clamp(0.34 + (0.34 * lateralErrorNorm), 0.22, 0.72),
      siteVelocityWeight: clamp(0.24 + (0.18 * closingDeficitNorm), 0.16, 0.5),
      touchdownReady: false,
    };
  }

  const catchCommand = resolveBoosterCatchCommand({
    altitudeKm,
    radialSpeedKmS,
    tangentialSpeedKmS,
    launchSiteRangeKm,
    launchSiteLateralRangeKm,
  });
  if (catchCommand) {
    return catchCommand;
  }

  // Simple terminal guidance profile: reduce target descent as altitude decreases.
  const targetDescentRateKmS = clamp(
    0.002 + (altitudeKm * 0.0105),
    0.004,
    0.09,
  );
  const targetRadialSpeedKmS = -targetDescentRateKmS;
  const radialErrorKmS = targetRadialSpeedKmS - radialSpeedKmS;
  let throttle = clamp(
    0.24 + (radialErrorKmS * 4.1) + (tangentialSpeedKmS * 0.22),
    0.2,
    1.0,
  );
  if (altitudeKm < 2.0 && radialSpeedKmS < -0.04) {
    const flareScale = clamp((-radialSpeedKmS - 0.04) / 0.12, 0, 1);
    throttle = Math.max(throttle, clamp(0.52 + (0.32 * flareScale), 0.52, 0.92));
  }
  const terminalRangeNorm = clamp(
    Math.min(launchSiteLateralRangeKm, launchSiteRangeKm) / landingSiteTightenKm,
    0,
    1,
  );
  return {
    phase: "landing-burn",
    guidanceMode: "booster-landing-burn",
    throttle,
    directionMix: { up: 1.0, retrograde: 0.18, antiTangent: 0.95 },
    siteVectorWeight: clamp(0.08 + (0.22 * terminalRangeNorm), 0.04, 0.32),
    siteVelocityWeight: clamp(0.06 + (0.18 * terminalRangeNorm), 0.04, 0.28),
    touchdownReady: altitudeKm <= touchdownBandKm && Math.abs(radialSpeedKmS) < 0.03,
  };
}
