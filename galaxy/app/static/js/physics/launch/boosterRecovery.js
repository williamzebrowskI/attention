import { STANDARD_GRAVITY_M_S2, LAUNCH_BOOSTER_CONFIG } from "./launchConfig.js";
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
  const downwardSpeedKmS = Math.max(0, -radialSpeedKmS);
  const dryMassKg = Math.max(1, Number(LAUNCH_BOOSTER_CONFIG.dryMassKg) || 1);
  const totalMassKg = Math.max(dryMassKg + propellantKg, dryMassKg + 1);
  const maxThrustN = Math.max(
    0,
    Number(LAUNCH_BOOSTER_CONFIG.thrustSeaLevelN)
      || Number(LAUNCH_BOOSTER_CONFIG.thrustVacuumN)
      || 0,
  );
  const gravityKmS2 = STANDARD_GRAVITY_M_S2 / 1000;
  const maxAccelerationKmS2 = maxThrustN > 0
    ? (maxThrustN / totalMassKg) / 1000
    : 0;
  const landingNetDecelKmS2 = Math.max(0.008, maxAccelerationKmS2 - (gravityKmS2 * 0.72));
  const timeToGroundSec = altitudeKm / Math.max(downwardSpeedKmS, 0.02);
  const desiredLateralClosingKmS = clamp(
    launchSiteLateralRangeKm / Math.max(timeToGroundSec, 18),
    0,
    0.42,
  );
  const lateralClosingNeedNorm = clamp(
    (desiredLateralClosingKmS - launchSiteLateralClosingSpeedKmS) / Math.max(desiredLateralClosingKmS, 0.10),
    0,
    1,
  );
  const landingBurnTriggerAltitudeKm = clamp(
    (
      (downwardSpeedKmS * downwardSpeedKmS) / Math.max(2 * landingNetDecelKmS2, 1e-6)
    )
      + (0.32 * downwardSpeedKmS)
      + (0.95 * tangentialSpeedKmS)
      + (0.08 * Math.min(launchSiteLateralRangeKm, 6))
      + 0.08,
    0.45,
    15.5,
  );

  const separationFlipSec = 1.6;
  const separationCoastSec = 4.2;
  const entryBurnUpperKm = 74;
  const entryBurnLowerKm = 18;
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
  const returnEnergyNorm = Math.max(
    lateralErrorNorm,
    clamp((tangentialSpeedKmS - 0.95) / 2.6, 0, 1),
    lateralClosingNeedNorm,
  );
  if (
    altitudeKm > 46
    && hasBoostbackBudget
    && (
      tangentialSpeedKmS > 1.05
      || farFromLaunchSite
      || returnEnergyNorm > 0.2
    )
  ) {
    const tangentialScale = clamp((tangentialSpeedKmS - 1.05) / 2.8, 0, 1);
    const rtlsDemand = Math.max(returnEnergyNorm, closingDeficitNorm);
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
    const entryInterfaceNorm = Math.max(
      clamp((dynamicPressurePa - 8_000) / 18_000, 0, 1),
      clamp((downwardSpeedKmS - 0.12) / 0.42, 0, 1),
      clamp((launchSiteLateralRangeKm - 4) / 18, 0, 1),
    );
    if (entryInterfaceNorm > 0.08) {
      return {
        phase: "entry-burn",
        guidanceMode: "booster-entry-burn",
        throttle: clamp(0.30 + (0.44 * entryInterfaceNorm), 0.28, 0.82),
        directionMix: { up: 0.82, retrograde: 0.34, antiTangent: 0.66 },
        siteVectorWeight: clamp(0.36 + (0.20 * lateralErrorNorm), 0.28, 0.64),
        siteVelocityWeight: clamp(0.24 + (0.18 * lateralClosingNeedNorm), 0.18, 0.54),
        touchdownReady: false,
      };
    }
    return {
      phase: "ballistic-descent",
      guidanceMode: "booster-entry-guidance",
      throttle: 0,
      directionMix: { up: 0.22, retrograde: 0.18, antiTangent: 0.48 },
      siteVectorWeight: clamp(0.38 + (0.20 * lateralErrorNorm), 0.26, 0.58),
      siteVelocityWeight: clamp(0.22 + (0.16 * lateralClosingNeedNorm), 0.18, 0.44),
      touchdownReady: false,
    };
  }

  if (altitudeKm > landingBurnTriggerAltitudeKm) {
    return {
      phase: "descent-coast",
      guidanceMode: "booster-descent-coast",
      throttle: 0,
      directionMix: { up: 0.18, retrograde: 0.16, antiTangent: 0.56 },
      siteVectorWeight: clamp(0.38 + (0.30 * lateralErrorNorm), 0.24, 0.76),
      siteVelocityWeight: clamp(0.26 + (0.22 * lateralClosingNeedNorm), 0.18, 0.54),
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
    0.28 + (radialErrorKmS * 4.6) + (tangentialSpeedKmS * 0.24) + (lateralClosingNeedNorm * 0.10),
    0.24,
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
    directionMix: { up: 1.0, retrograde: 0.20, antiTangent: 0.92 },
    siteVectorWeight: clamp(0.10 + (0.26 * terminalRangeNorm), 0.06, 0.36),
    siteVelocityWeight: clamp(0.08 + (0.20 * terminalRangeNorm), 0.05, 0.30),
    touchdownReady: altitudeKm <= touchdownBandKm && Math.abs(radialSpeedKmS) < 0.03,
  };
}
