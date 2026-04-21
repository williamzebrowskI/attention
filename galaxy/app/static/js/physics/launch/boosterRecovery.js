import {
  STANDARD_GRAVITY_M_S2,
  LAUNCH_BOOSTER_CONFIG,
  resolveConfiguredThrustBoundsN,
} from "./launchConfig.js";
import { resolveBoosterCatchCommand } from "./boosterCatchGuidance.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resolveGridFinAuthority({
  altitudeKm = 0,
  dynamicPressurePa = 0,
  tangentialSpeedKmS = 0,
  downwardSpeedKmS = 0,
}) {
  const qBuild = clamp((dynamicPressurePa - 1_200) / 12_000, 0, 1);
  const qSaturation = 1 - (0.35 * clamp((dynamicPressurePa - 42_000) / 38_000, 0, 1));
  const altitudeWindow = clamp((74 - altitudeKm) / 42, 0, 1) * clamp((altitudeKm - 1.4) / 8, 0, 1);
  const speedWindow = clamp((Math.max(tangentialSpeedKmS, downwardSpeedKmS) - 0.08) / 0.85, 0, 1);
  return clamp(qBuild * qSaturation * Math.max(altitudeWindow, speedWindow * 0.8), 0, 1);
}

function resolveBoostbackInterceptDemand({
  catchTotalRangeKm = 0,
  catchLateralRangeKm = 0,
  launchSiteLateralRangeKm = 0,
  launchSiteLateralClosingSpeedKmS = 0,
  tangentialSpeedKmS = 0,
  timeToGroundSec = 0,
}) {
  const passiveLateralRecoveryKm = Math.max(0, launchSiteLateralClosingSpeedKmS) * Math.max(0, timeToGroundSec);
  const unrecoveredCatchLateralKm = Math.max(0, catchLateralRangeKm - passiveLateralRecoveryKm);
  const unrecoveredSiteLateralKm = Math.max(0, launchSiteLateralRangeKm - passiveLateralRecoveryKm);
  const lateralMissNorm = clamp(
    Math.max(unrecoveredCatchLateralKm, unrecoveredSiteLateralKm) / 42,
    0,
    1,
  );
  const catchRangeNorm = clamp((catchTotalRangeKm - 24) / 90, 0, 1);
  const tangentialNorm = clamp((tangentialSpeedKmS - 0.9) / 2.1, 0, 1);
  const demandNorm = Math.max(
    lateralMissNorm,
    catchRangeNorm,
    tangentialNorm * 0.9,
  );
  return {
    demandNorm,
    lateralMissNorm,
    catchRangeNorm,
    tangentialNorm,
    ignitionAlignmentMin: clamp(
      0.34 + (0.14 * lateralMissNorm) + (0.08 * tangentialNorm),
      0.34,
      0.62,
    ),
  };
}

function resolveAeroCrossrangeDemand({
  altitudeKm = 0,
  dynamicPressurePa = 0,
  gridFinAuthority = 0,
  launchSiteLateralRangeKm = 0,
  launchSiteLateralClosingSpeedKmS = 0,
  catchLateralRangeKm = 0,
  catchLateralSpeedKmS = 0,
  desiredLateralClosingKmS = 0,
}) {
  const siteLateralNorm = clamp(launchSiteLateralRangeKm / 18, 0, 1);
  const catchLateralNorm = clamp(catchLateralRangeKm / 18, 0, 1);
  const desiredClosingKmS = Math.max(0.04, Number(desiredLateralClosingKmS) || 0);
  const closingNeedNorm = clamp(
    (desiredClosingKmS - launchSiteLateralClosingSpeedKmS) / Math.max(desiredClosingKmS, 0.08),
    0,
    1,
  );
  const overClosingNorm = clamp(
    (launchSiteLateralClosingSpeedKmS - ((desiredClosingKmS * 1.8) + 0.03)) / Math.max(desiredClosingKmS, 0.08),
    0,
    1,
  );
  const catchLateralSpeedNorm = clamp(catchLateralSpeedKmS / 0.18, 0, 1);
  const qNorm = clamp((dynamicPressurePa - 3_000) / 20_000, 0, 1);
  const altitudeNorm = clamp((74 - altitudeKm) / 56, 0, 1);
  const aeroCorrectionNorm = clamp(
    Math.max(
      Number(gridFinAuthority) || 0,
      (0.74 * qNorm) + (0.18 * altitudeNorm),
    ),
    0,
    1,
  );
  const crossrangeDemandNorm = Math.max(
    catchLateralNorm,
    siteLateralNorm * 0.85,
    closingNeedNorm,
    catchLateralSpeedNorm * 0.72,
    overClosingNorm * 0.42,
  );
  return {
    siteLateralNorm,
    catchLateralNorm,
    closingNeedNorm,
    overClosingNorm,
    catchLateralSpeedNorm,
    aeroCorrectionNorm,
    crossrangeDemandNorm,
    targetingActive: aeroCorrectionNorm > 0.06 && crossrangeDemandNorm > 0.04,
  };
}

export function computeBoosterRecoveryCommand(input = {}) {
  const currentPhase = String(input.currentPhase || "").toLowerCase();
  const altitudeKm = Math.max(0, Number(input.altitudeKm) || 0);
  const radialSpeedKmS = Number(input.radialSpeedKmS) || 0;
  const tangentialSpeedKmS = Math.max(0, Number(input.tangentialSpeedKmS) || 0);
  const launchSiteRangeKm = Math.max(0, Number(input.launchSiteRangeKm) || 0);
  const launchSiteLateralRangeKm = Math.max(0, Number(input.launchSiteLateralRangeKm) || 0);
  const launchSiteLateralClosingSpeedKmS = Number(input.launchSiteLateralClosingSpeedKmS) || 0;
  const catchTotalRangeKm = Math.max(0, Number(input.catchTotalRangeKm) || launchSiteRangeKm);
  const catchLateralRangeKm = Math.max(0, Number(input.catchLateralRangeKm) || launchSiteLateralRangeKm);
  const catchVerticalErrorKm = Number(input.catchVerticalErrorKm) || 0;
  const catchLateralSpeedKmS = Math.max(0, Number(input.catchLateralSpeedKmS) || tangentialSpeedKmS);
  const catchVerticalSpeedKmS = Number(input.catchVerticalSpeedKmS) || radialSpeedKmS;
  const catchApproachSpeedKmS = Math.max(0, Number(input.catchApproachSpeedKmS) || Math.hypot(catchLateralSpeedKmS, catchVerticalSpeedKmS));
  const elapsedSec = Math.max(0, Number(input.timeSinceSeparationSec) || 0);
  const propellantKg = Math.max(0, Number(input.remainingPropellantKg) || 0);
  const dynamicPressurePa = Math.max(0, Number(input.dynamicPressurePa) || 0);
  const reserveLandingKg = Math.max(0, Number(input.reserveLandingPropellantKg) || 0);
  const bodyRetrogradeAlignment = clamp(Number(input.bodyRetrogradeAlignment) || 0, -1, 1);
  const bodyAntiTangentAlignment = clamp(Number(input.bodyAntiTangentAlignment) || 0, -1, 1);
  const bodyUpAlignment = clamp(Number(input.bodyUpAlignment) || 0, -1, 1);
  const downwardSpeedKmS = Math.max(0, -radialSpeedKmS);
  const dryMassKg = Math.max(1, Number(LAUNCH_BOOSTER_CONFIG.dryMassKg) || 1);
  const totalMassKg = Math.max(dryMassKg + propellantKg, dryMassKg + 1);
  const boosterThrustBounds = resolveConfiguredThrustBoundsN(LAUNCH_BOOSTER_CONFIG);
  const maxThrustN = Math.max(
    0,
    Number(boosterThrustBounds.thrustSeaLevelN)
      || Number(boosterThrustBounds.thrustVacuumN)
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

  const separationFlipMinSec = 0.9;
  const separationFlipSettleSec = 2.6;
  const boostbackMinimumIgnitionSec = 2.8;
  const boostbackAlignmentGraceSec = 4.2;
  const entryBurnUpperKm = 74;
  const entryBurnLowerKm = 18;
  const touchdownBandKm = 0.03;
  const rtlsLateralWindowKm = 130;
  const significantSiteErrorKm = 18;
  const landingSiteTightenKm = 3.0;
  const gridFinAuthority = resolveGridFinAuthority({
    altitudeKm,
    dynamicPressurePa,
    tangentialSpeedKmS,
    downwardSpeedKmS,
  });
  const separationPhaseActive = !currentPhase || currentPhase === "separation-flip" || currentPhase === "separation-coast";
  const lateralErrorNorm = clamp(launchSiteLateralRangeKm / rtlsLateralWindowKm, 0, 1);
  const closingDeficitNorm = clamp(
    (0.12 - launchSiteLateralClosingSpeedKmS) / 0.24,
    0,
    1,
  );
  const farFromLaunchSite =
    launchSiteLateralRangeKm > significantSiteErrorKm
    || launchSiteRangeKm > (rtlsLateralWindowKm * 1.1);
  const hasBoostbackBudget = propellantKg > (reserveLandingKg * 0.55);
  const returnEnergyNorm = Math.max(
    lateralErrorNorm,
    clamp((tangentialSpeedKmS - 0.95) / 2.6, 0, 1),
    lateralClosingNeedNorm,
  );
  const boostbackInterceptDemand = resolveBoostbackInterceptDemand({
    catchTotalRangeKm,
    catchLateralRangeKm,
    launchSiteLateralRangeKm,
    launchSiteLateralClosingSpeedKmS,
    tangentialSpeedKmS,
    timeToGroundSec,
  });
  const aeroCrossrangeDemand = resolveAeroCrossrangeDemand({
    altitudeKm,
    dynamicPressurePa,
    gridFinAuthority,
    launchSiteLateralRangeKm,
    launchSiteLateralClosingSpeedKmS,
    catchLateralRangeKm,
    catchLateralSpeedKmS,
    desiredLateralClosingKmS,
  });

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

  const flipAlignment = clamp((0.68 * bodyRetrogradeAlignment) + (0.32 * bodyAntiTangentAlignment), -1, 1);
  const flipComplete = flipAlignment >= 0.82;
  const attitudeStillMostlyUp = bodyUpAlignment > 0.35;
  const flipPhaseProgress = clamp(
    (elapsedSec - separationFlipMinSec) / Math.max(separationFlipSettleSec - separationFlipMinSec, 0.1),
    0,
    1,
  );
  const boostbackDemand =
    altitudeKm > 38
    && hasBoostbackBudget
    && (
      boostbackInterceptDemand.demandNorm > 0.18
      || farFromLaunchSite
      || returnEnergyNorm > 0.2
    );
  const boostbackSettledIgnitionEligible = boostbackDemand
    && elapsedSec >= boostbackMinimumIgnitionSec
    && (
      flipAlignment >= boostbackInterceptDemand.ignitionAlignmentMin
      || bodyRetrogradeAlignment >= Math.max(0.28, boostbackInterceptDemand.ignitionAlignmentMin - 0.08)
    );
  const boostbackRollingIgnitionEligible = boostbackDemand
    && elapsedSec >= boostbackAlignmentGraceSec
    && (
      flipAlignment >= Math.max(0.18, boostbackInterceptDemand.ignitionAlignmentMin - 0.18)
      || bodyRetrogradeAlignment >= Math.max(0.14, boostbackInterceptDemand.ignitionAlignmentMin - 0.22)
    );
  const boostbackIgnitionEligible =
    boostbackSettledIgnitionEligible
    || boostbackRollingIgnitionEligible;

  if (
    separationPhaseActive
    && (
    elapsedSec < separationFlipMinSec
    || (
      elapsedSec < separationFlipSettleSec
      && !boostbackIgnitionEligible
      && (!flipComplete || attitudeStillMostlyUp)
    )
    )
  ) {
    const settleBlend = clamp((elapsedSec - 1.2) / Math.max(separationFlipSettleSec - 1.2, 0.1), 0, 1);
    return {
      phase: "separation-flip",
      guidanceMode: "booster-separation-flip",
      attitudeResponseScale: elapsedSec < 1.8
        ? 0.18
        : (0.74 + (1.08 * settleBlend)),
      attitudeTargetBlend: elapsedSec < 1.8
        ? 0.10
        : (0.28 + (0.42 * settleBlend)),
      angularDampingPerS: 0.08 + (0.08 * settleBlend),
      maxBodyRateDegS: 7.4 + (3.2 * settleBlend),
      siteTargetingEnabled: false,
      qAlphaSteeringEnabled: false,
      throttle: 0,
      directionMix: {
        up: 0.24 - (0.16 * flipPhaseProgress),
        retrograde: 1.0,
        antiTangent: 0.08 + (0.18 * flipPhaseProgress),
      },
    };
  }

  if (
    separationPhaseActive
    && !boostbackIgnitionEligible
    && (
    altitudeKm > 48
    && (
      catchTotalRangeKm > 6
      || launchSiteLateralRangeKm > 4
      || downwardSpeedKmS < 0.32
      || radialSpeedKmS > -0.06
    )
    )
  ) {
    const coastPhaseProgress = clamp(
      (elapsedSec - separationFlipSettleSec) / 4.2,
      0,
      1,
    );
    return {
      phase: "separation-coast",
      guidanceMode: "booster-separation-coast",
      attitudeResponseScale: 1.28 + (0.32 * coastPhaseProgress),
      attitudeTargetBlend: 0.68 + (0.18 * coastPhaseProgress),
      angularDampingPerS: 0.14 + (0.08 * coastPhaseProgress),
      maxBodyRateDegS: 10.2 + (1.8 * coastPhaseProgress),
      siteTargetingEnabled: false,
      qAlphaSteeringEnabled: false,
      throttle: 0,
      directionMix: {
        up: 0.08 - (0.03 * coastPhaseProgress),
        retrograde: 1.0,
        antiTangent: 0.18 + (0.12 * coastPhaseProgress),
      },
      };
  }
  if (
    (
      boostbackIgnitionEligible
      || (
        currentPhase === "boostback"
        && altitudeKm > 34
        && hasBoostbackBudget
        && (
          boostbackInterceptDemand.demandNorm > 0.06
          || tangentialSpeedKmS > 0.55
          || launchSiteLateralRangeKm > 8
          || lateralClosingNeedNorm > 0.10
        )
      )
    )
  ) {
    const tangentialScale = boostbackInterceptDemand.tangentialNorm;
    const rtlsDemand = Math.max(
      returnEnergyNorm,
      closingDeficitNorm,
      boostbackInterceptDemand.demandNorm,
    );
    const flipIgnitionBlend = clamp(
      (
        Math.max(flipAlignment, bodyRetrogradeAlignment)
        - (boostbackInterceptDemand.ignitionAlignmentMin - 0.12)
      ) / 0.30,
      0,
      1,
    );
    const ignitionBlend = clamp(
      Math.max(
        (elapsedSec - boostbackMinimumIgnitionSec) / Math.max(boostbackAlignmentGraceSec - boostbackMinimumIgnitionSec, 0.1),
        flipIgnitionBlend,
      ),
      0,
      1,
    );
      return {
        phase: "boostback",
        guidanceMode: "booster-boostback",
        attitudeControlMode: "engines+rcs",
        aeroAuthority: 0,
        attitudeResponseScale: 2.2 + (0.40 * ignitionBlend),
        attitudeTargetBlend: 0.42 + (0.40 * ignitionBlend),
        angularDampingPerS: 0.10 + (0.08 * ignitionBlend),
        maxBodyRateDegS: 11.4 + (2.6 * ignitionBlend),
        siteTargetingEnabled: false,
        qAlphaSteeringEnabled: false,
        throttle: clamp(
          0.28
            + (0.14 * tangentialScale)
            + (0.20 * rtlsDemand)
            + (0.18 * ignitionBlend),
          0.26,
          0.86,
        ),
        directionMix: {
        up: 0.04,
        retrograde: 1.0,
        antiTangent: clamp(0.14 + (0.14 * boostbackInterceptDemand.lateralMissNorm), 0.12, 0.32),
      },
      siteVectorWeight: 0,
      siteVelocityWeight: 0,
    };
  }

  if (
    altitudeKm > entryBurnUpperKm
    && altitudeKm <= 108
    && radialSpeedKmS < -0.03
  ) {
    const entryAlignNeedNorm = clamp(
      Math.max(
        (0.95 - bodyRetrogradeAlignment) / 0.30,
        (0.10 + tangentialSpeedKmS) / 1.4,
      ),
      0,
      1,
    );
    if (entryAlignNeedNorm > 0.04) {
      return {
        phase: "entry-align",
        guidanceMode: "booster-entry-align",
        attitudeControlMode: dynamicPressurePa > 1_800 ? "grid-fins+rcs" : "rcs",
        aeroAuthority: clamp(gridFinAuthority, 0, 0.4),
        attitudeResponseScale: 0.52 + (0.16 * entryAlignNeedNorm),
        angularDampingPerS: 0.54 + (0.18 * entryAlignNeedNorm),
        maxBodyRateDegS: 7.0,
        siteTargetingEnabled: Boolean(aeroCrossrangeDemand.targetingActive && gridFinAuthority > 0.08),
        throttle: 0,
        directionMix: {
          up: 0.06,
          retrograde: 1.0,
          antiTangent: clamp(
            0.12 + (0.12 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
            0.12,
            0.28,
          ),
        },
        siteVectorWeight: clamp(
          0.08 + (0.22 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.08,
          0.28,
        ),
        siteVelocityWeight: clamp(
          0.06 + (0.18 * aeroCrossrangeDemand.closingNeedNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.06,
          0.22,
        ),
      };
    }
  }

  if (altitudeKm <= entryBurnUpperKm && altitudeKm >= entryBurnLowerKm) {
    const descendingIntoEntry = downwardSpeedKmS > 0.08 && radialSpeedKmS < -0.08;
    if (!descendingIntoEntry) {
      return {
        phase: "ballistic-descent",
        guidanceMode: "booster-ballistic-settle",
        attitudeControlMode: "grid-fins",
        aeroAuthority: gridFinAuthority,
        attitudeResponseScale: 0.42,
        attitudeTargetBlend: 0.36,
        angularDampingPerS: 0.58,
        maxBodyRateDegS: 6.5,
        siteTargetingEnabled: aeroCrossrangeDemand.targetingActive,
        throttle: 0,
        directionMix: {
          up: 0.34 - (0.10 * aeroCrossrangeDemand.aeroCorrectionNorm),
          retrograde: 0.16 + (0.12 * aeroCrossrangeDemand.aeroCorrectionNorm),
          antiTangent: clamp(
            0.20 + (0.28 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
            0.20,
            0.48,
          ),
        },
        siteVectorWeight: clamp(
          0.16 + (0.44 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.14,
          0.62,
        ),
        siteVelocityWeight: clamp(
          0.10 + (0.30 * aeroCrossrangeDemand.closingNeedNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.08,
          0.42,
        ),
      };
    }
    const entryInterfaceNorm = Math.max(
      clamp((dynamicPressurePa - 8_000) / 18_000, 0, 1),
      clamp((downwardSpeedKmS - 0.12) / 0.42, 0, 1),
      clamp((launchSiteLateralRangeKm - 4) / 18, 0, 1),
    );
    if (entryInterfaceNorm > 0.08) {
      return {
        phase: "entry-burn",
        guidanceMode: "booster-entry-burn",
        attitudeControlMode: "grid-fins+engines",
        aeroAuthority: gridFinAuthority,
        angularDampingPerS: 0.64,
        maxBodyRateDegS: 7.5,
        throttle: clamp(0.30 + (0.44 * entryInterfaceNorm), 0.28, 0.82),
        directionMix: {
          up: 0.78,
          retrograde: 0.40,
          antiTangent: clamp(
            0.18 + (0.22 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
            0.18,
            0.40,
          ),
        },
        siteTargetingEnabled: aeroCrossrangeDemand.targetingActive,
        siteVectorWeight: clamp(
          0.10 + (0.22 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.10,
          0.34,
        ),
        siteVelocityWeight: clamp(
          0.08 + (0.18 * aeroCrossrangeDemand.closingNeedNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.08,
          0.26,
        ),
      };
    }
    return {
      phase: "ballistic-descent",
      guidanceMode: "booster-entry-guidance",
      attitudeControlMode: "grid-fins",
      aeroAuthority: gridFinAuthority,
      angularDampingPerS: 0.52,
      maxBodyRateDegS: 7.0,
      throttle: 0,
      directionMix: {
        up: 0.18,
        retrograde: 0.20 + (0.10 * aeroCrossrangeDemand.aeroCorrectionNorm),
        antiTangent: clamp(
          0.22 + (0.36 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.22,
          0.58,
        ),
      },
      siteTargetingEnabled: aeroCrossrangeDemand.targetingActive,
      siteVectorWeight: clamp(
        0.18 + (0.50 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
        0.14,
        0.72,
      ),
      siteVelocityWeight: clamp(
        0.12 + (0.34 * aeroCrossrangeDemand.closingNeedNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
        0.10,
        0.48,
      ),
    };
  }

  if (altitudeKm > landingBurnTriggerAltitudeKm) {
    return {
      phase: "descent-coast",
      guidanceMode: "booster-descent-coast",
      attitudeControlMode: "grid-fins",
      aeroAuthority: gridFinAuthority,
      angularDampingPerS: 0.48,
      maxBodyRateDegS: 6.5,
      throttle: 0,
      directionMix: {
        up: 0.14,
        retrograde: 0.18 + (0.10 * aeroCrossrangeDemand.aeroCorrectionNorm),
        antiTangent: clamp(
          0.28 + (0.34 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.28,
          0.62,
        ),
      },
      siteTargetingEnabled: aeroCrossrangeDemand.targetingActive,
      siteVectorWeight: clamp(
        0.22 + (0.62 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
        0.18,
        0.82,
      ),
      siteVelocityWeight: clamp(
        0.14 + (0.46 * aeroCrossrangeDemand.closingNeedNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
        0.12,
        0.62,
      ),
    };
  }

  const catchCommand = resolveBoosterCatchCommand({
    altitudeKm,
    radialSpeedKmS,
    tangentialSpeedKmS,
    launchSiteRangeKm,
    launchSiteLateralRangeKm,
    catchTotalRangeKm,
    catchLateralRangeKm,
    catchVerticalErrorKm,
    catchLateralSpeedKmS,
    catchVerticalSpeedKmS,
    catchApproachSpeedKmS,
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
    attitudeControlMode: "engines",
    aeroAuthority: clamp(gridFinAuthority * 0.25, 0, 0.2),
    angularDampingPerS: 0.80,
    maxBodyRateDegS: 5.5,
    throttle,
    directionMix: { up: 1.0, retrograde: 0.20, antiTangent: 0.92 },
    siteVectorWeight: clamp(0.10 + (0.26 * terminalRangeNorm), 0.06, 0.36),
    siteVelocityWeight: clamp(0.08 + (0.20 * terminalRangeNorm), 0.05, 0.30),
    touchdownReady: altitudeKm <= touchdownBandKm && Math.abs(radialSpeedKmS) < 0.03,
  };
}
