import {
  STANDARD_GRAVITY_M_S2,
  LAUNCH_BOOSTER_CONFIG,
  resolveConfiguredThrustBoundsN,
} from "./launchConfig.js";
import { resolveBoosterCatchCommand } from "./boosterCatchGuidance.js";

export const BOOSTER_STAGE_ATTITUDE_POLICY = Object.freeze({
  "attached-stack": Object.freeze({
    positionIntent: "locked-under-starship",
    attitudeIntent: "coaxial-with-stack",
    targetPosture: "shared-stack-axis",
    terminalUprightCommit: false,
  }),
  "separation-flip": Object.freeze({
    positionIntent: "clear-stage-separation-corridor",
    attitudeIntent: "rotate-away-from-stack-toward-return-axis",
    targetPosture: "transition-to-retrograde-return",
    terminalUprightCommit: false,
    qAlphaSteeringEnabled: false,
    siteTargetingEnabled: false,
    minRetrogradeWeight: 0.9,
  }),
  "separation-coast": Object.freeze({
    positionIntent: "build-clean-separation-spacing",
    attitudeIntent: "continue-rotation-into-return-attitude",
    targetPosture: "retrograde-biased-return",
    terminalUprightCommit: false,
    qAlphaSteeringEnabled: false,
    siteTargetingEnabled: false,
    minRetrogradeWeight: 0.9,
  }),
  boostback: Object.freeze({
    positionIntent: "drive-return-corridor-back-to-launch-site",
    attitudeIntent: "engines-first-return-burn",
    targetPosture: "retrograde-burn-with-lateral-corridor-shaping",
    terminalUprightCommit: false,
    qAlphaSteeringEnabled: false,
    siteTargetingEnabled: true,
    minRetrogradeWeight: 0.95,
  }),
  "entry-align": Object.freeze({
    positionIntent: "settle-onto-controlled-entry-corridor",
    attitudeIntent: "rotate-upright-before-atmospheric-braking",
    targetPosture: "upright-entry-alignment",
    terminalUprightCommit: true,
    minUpWeight: 0.95,
  }),
  "ballistic-descent": Object.freeze({
    positionIntent: "continue-return-corridor-during-thin-air-fall",
    attitudeIntent: "maintain-upright-entry-stability",
    targetPosture: "upright-ballistic-descent",
    terminalUprightCommit: true,
    minUpWeight: 0.95,
  }),
  "ballistic-settle": Object.freeze({
    positionIntent: "hold-stable-return-corridor-while-aero-builds",
    attitudeIntent: "stabilize-upright-body-before-next-burn",
    targetPosture: "upright-ballistic-settle",
    terminalUprightCommit: true,
    minUpWeight: 0.95,
  }),
  "entry-burn": Object.freeze({
    positionIntent: "kill-entry-energy-without-losing-return-corridor",
    attitudeIntent: "burn-engines-down-and-near-vertical",
    targetPosture: "near-vertical-entry-burn",
    terminalUprightCommit: true,
    minUpWeight: 0.95,
  }),
  "descent-coast": Object.freeze({
    positionIntent: "stay-inside-terminal-return-corridor",
    attitudeIntent: "upright-aero-descent-with-low-tilt",
    targetPosture: "upright-descent-coast",
    terminalUprightCommit: true,
    minUpWeight: 0.95,
  }),
  "terminal-intercept": Object.freeze({
    positionIntent: "solve-terminal-corridor-miss-before-catch",
    attitudeIntent: "upright-engines-assisted-intercept",
    targetPosture: "upright-terminal-intercept",
    terminalUprightCommit: true,
    minUpWeight: 0.25,
    siteTargetingEnabled: true,
  }),
  "catch-approach": Object.freeze({
    positionIntent: "align-with-tower-catch-frame",
    attitudeIntent: "upright-low-rate-catch-approach",
    targetPosture: "upright-catch-approach",
    terminalUprightCommit: true,
    minUpWeight: 0.85,
  }),
  "catch-burn": Object.freeze({
    positionIntent: "remove-final-vertical-energy-inside-catch-box",
    attitudeIntent: "upright-catch-burn",
    targetPosture: "upright-catch-burn",
    terminalUprightCommit: true,
    minUpWeight: 0.98,
  }),
  "landing-burn": Object.freeze({
    positionIntent: "kill-final-descent-for-vertical-touchdown",
    attitudeIntent: "upright-vertical-landing-burn",
    targetPosture: "upright-landing-burn",
    terminalUprightCommit: true,
    minUpWeight: 0.98,
  }),
  "catch-contact": Object.freeze({
    positionIntent: "enter-mechanical-contact-with-chopsticks",
    attitudeIntent: "upright-contact-alignment",
    targetPosture: "upright-catch-contact",
    terminalUprightCommit: true,
  }),
  "catch-capture": Object.freeze({
    positionIntent: "damp-into-chopstick-capture-constraint",
    attitudeIntent: "upright-capture-stabilization",
    targetPosture: "upright-catch-capture",
    terminalUprightCommit: true,
  }),
  caught: Object.freeze({
    positionIntent: "settled-in-catch-frame",
    attitudeIntent: "upright-captured",
    targetPosture: "upright-caught",
    terminalUprightCommit: true,
  }),
  landed: Object.freeze({
    positionIntent: "settled-on-pad",
    attitudeIntent: "upright-landed",
    targetPosture: "upright-landed",
    terminalUprightCommit: true,
  }),
});

export function resolveBoosterStageAttitudePolicy(phase = "") {
  return BOOSTER_STAGE_ATTITUDE_POLICY[String(phase || "").toLowerCase()] || null;
}

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
  altitudeKm = 0,
  radialSpeedKmS = 0,
  timeToGroundSec = 0,
}) {
  const boostbackInterceptTimeSec = radialSpeedKmS >= -0.04
    ? clamp(62 + (0.42 * altitudeKm), 70, 140)
    : clamp(Math.max(0, timeToGroundSec) * 0.28, 55, 140);
  const desiredLateralClosingKmS = clamp(
    Math.max(catchLateralRangeKm, launchSiteLateralRangeKm) / Math.max(boostbackInterceptTimeSec, 1),
    0.70,
    2.40,
  );
  const passiveLateralRecoveryKm = Math.max(0, launchSiteLateralClosingSpeedKmS) * boostbackInterceptTimeSec;
  const unrecoveredCatchLateralKm = Math.max(0, catchLateralRangeKm - passiveLateralRecoveryKm);
  const unrecoveredSiteLateralKm = Math.max(0, launchSiteLateralRangeKm - passiveLateralRecoveryKm);
  const lateralMissNorm = clamp(
    Math.max(unrecoveredCatchLateralKm, unrecoveredSiteLateralKm) / 30,
    0,
    1,
  );
  const catchRangeNorm = clamp((catchTotalRangeKm - 24) / 90, 0, 1);
  const tangentialNorm = clamp((tangentialSpeedKmS - 0.9) / 2.1, 0, 1);
  const closingNeedNorm = clamp(
    (desiredLateralClosingKmS - launchSiteLateralClosingSpeedKmS) / Math.max(desiredLateralClosingKmS, 0.12),
    0,
    1,
  );
  const demandNorm = Math.max(
    lateralMissNorm,
    catchRangeNorm,
    tangentialNorm * 0.9,
    closingNeedNorm,
  );
  return {
    demandNorm,
    lateralMissNorm,
    catchRangeNorm,
    tangentialNorm,
    closingNeedNorm,
    desiredLateralClosingKmS,
    interceptTimeSec: boostbackInterceptTimeSec,
    ignitionAlignmentMin: clamp(
      0.34 + (0.14 * lateralMissNorm) + (0.08 * tangentialNorm),
      0.34,
      0.62,
    ),
  };
}

function resolveBoostbackPredictiveMetrics({
  altitudeKm = 0,
  catchEastErrorKm = 0,
  catchNorthErrorKm = 0,
  catchEastSpeedKmS = 0,
  catchNorthSpeedKmS = 0,
  catchVerticalSpeedKmS = 0,
  catchLateralRangeKm = 0,
  catchApproachSpeedKmS = 0,
  timeToGroundSec = 0,
}) {
  const lateralRangeKm = Math.hypot(catchEastErrorKm, catchNorthErrorKm);
  const rangeDrivenInterceptSec = clamp(
    (0.26 * Math.max(0, timeToGroundSec))
      + (0.18 * altitudeKm)
      + (0.20 * catchApproachSpeedKmS)
      + 12,
    55,
    140,
  );
  const geometryDrivenInterceptSec = clamp(
    34 + (0.26 * altitudeKm) + (0.18 * lateralRangeKm),
    50,
    140,
  );
  const interceptTimeSec = clamp(
    Math.min(rangeDrivenInterceptSec, geometryDrivenInterceptSec),
    50,
    140,
  );
  const desiredEastSpeedKmS = clamp(
    -catchEastErrorKm / Math.max(interceptTimeSec, 1),
    -2.20,
    2.20,
  );
  const desiredNorthSpeedKmS = clamp(
    -catchNorthErrorKm / Math.max(interceptTimeSec, 1),
    -2.20,
    2.20,
  );
  const eastSpeedErrorKmS = desiredEastSpeedKmS - catchEastSpeedKmS;
  const northSpeedErrorKmS = desiredNorthSpeedKmS - catchNorthSpeedKmS;
  const predictedEastMissKm = catchEastErrorKm + (catchEastSpeedKmS * interceptTimeSec);
  const predictedNorthMissKm = catchNorthErrorKm + (catchNorthSpeedKmS * interceptTimeSec);
  const predictedLateralMissKm = Math.hypot(predictedEastMissKm, predictedNorthMissKm);
  const localDirection = {
    east: clamp(
      (eastSpeedErrorKmS / 0.60) - (catchEastErrorKm / 18),
      -1.35,
      1.35,
    ),
    north: clamp(
      (northSpeedErrorKmS / 0.60) - (catchNorthErrorKm / 18),
      -1.35,
      1.35,
    ),
    up: clamp(
      -0.06 + clamp((-catchVerticalSpeedKmS - 0.10) / 0.42, 0, 1) * 0.12,
      -0.08,
      0.08,
    ),
  };
  return {
    interceptTimeSec,
    desiredEastSpeedKmS,
    desiredNorthSpeedKmS,
    eastSpeedErrorKmS,
    northSpeedErrorKmS,
    predictedEastMissKm,
    predictedNorthMissKm,
    predictedLateralMissKm,
    localDirection,
    lateralDemandNorm: clamp(lateralRangeKm / 75, 0, 1),
    speedDemandNorm: clamp(Math.hypot(eastSpeedErrorKmS, northSpeedErrorKmS) / 0.75, 0, 1),
    predictiveLateralMissNorm: clamp(predictedLateralMissKm / 42, 0, 1),
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

function resolveTerminalInterceptMetrics({
  altitudeKm = 0,
  catchTotalRangeKm = 0,
  catchLateralRangeKm = 0,
  catchVerticalErrorKm = 0,
  catchApproachSpeedKmS = 0,
  catchEastErrorKm = 0,
  catchNorthErrorKm = 0,
  catchEastSpeedKmS = 0,
  catchNorthSpeedKmS = 0,
  catchVerticalSpeedKmS = 0,
  towerRelativeActive = false,
}) {
  const rangeTimeSec = catchTotalRangeKm / Math.max(catchApproachSpeedKmS, 0.12);
  const descentTimeSec = Math.abs(catchVerticalErrorKm) / Math.max(Math.abs(catchVerticalSpeedKmS), 0.05);
  const interceptTimeSec = clamp(
    (0.34 * rangeTimeSec)
      + (0.14 * descentTimeSec)
      + (0.12 * altitudeKm)
      + (0.06 * catchLateralRangeKm)
      + 1.0,
    8,
    towerRelativeActive ? 28 : 60,
  );
  const desiredHorizontalSpeedLimitKmS = towerRelativeActive
    ? (
      altitudeKm > 16
        ? 0.40
        : altitudeKm > 10
          ? 0.28
          : altitudeKm > 6
            ? 0.18
            : 0.12
    )
    : (
      altitudeKm > 16
        ? 0.80
        : altitudeKm > 8
          ? 0.62
          : 0.38
    );
  const desiredEastSpeedKmS = clamp(
    -catchEastErrorKm / Math.max(interceptTimeSec, 1),
    -desiredHorizontalSpeedLimitKmS,
    desiredHorizontalSpeedLimitKmS,
  );
  const desiredNorthSpeedKmS = clamp(
    -catchNorthErrorKm / Math.max(interceptTimeSec, 1),
    -desiredHorizontalSpeedLimitKmS,
    desiredHorizontalSpeedLimitKmS,
  );
  const lateralRangeNorm = clamp(catchLateralRangeKm / 24, 0, 1);
  const desiredVerticalSpeedKmS = -clamp(
    0.055
      + (0.0068 * altitudeKm)
      + (0.30 * lateralRangeNorm)
      + (0.06 * clamp(catchApproachSpeedKmS / 0.9, 0, 1)),
    altitudeKm > 9 ? 0.14 : 0.085,
    altitudeKm > 12 ? 0.38 : altitudeKm > 6 ? 0.30 : 0.20,
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
      (eastSpeedErrorKmS / Math.max(desiredHorizontalSpeedLimitKmS, 0.12))
        - (catchEastErrorKm / 2.0),
      -1.45,
      1.45,
    ),
    north: clamp(
      (northSpeedErrorKmS / Math.max(desiredHorizontalSpeedLimitKmS, 0.12))
        - (catchNorthErrorKm / 2.0),
      -1.45,
      1.45,
    ),
    up: clamp(
      0.26
        + (verticalSpeedErrorKmS / 0.08)
        - (Math.max(0, catchVerticalErrorKm - 0.5) / 10.0)
        + (Math.max(0, -catchVerticalErrorKm) / 6.5),
      0.02,
      0.60,
    ),
  };
  const lateralDemandNorm = clamp(
    Math.hypot(localDirection.east, localDirection.north) / 0.75,
    0,
    1,
  );
  const verticalDemandNorm = clamp(Math.abs(verticalSpeedErrorKmS) / 0.06, 0, 1);
  const predictiveLateralMissNorm = clamp(predictedLateralMissKm / 3.0, 0, 1);
  const predictiveVerticalMissNorm = clamp(Math.abs(predictedVerticalMissKm) / 14.0, 0, 1);
  return {
    interceptTimeSec,
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
  const catchEastErrorKm = Number(input.catchEastErrorKm) || 0;
  const catchNorthErrorKm = Number(input.catchNorthErrorKm) || 0;
  const catchEastSpeedKmS = Number(input.catchEastSpeedKmS) || 0;
  const catchNorthSpeedKmS = Number(input.catchNorthSpeedKmS) || 0;
  const catchClosingSpeedKmS = Number(input.catchClosingSpeedKmS) || 0;
  const towerRelativeActive = Boolean(input.towerRelativeActive);
  const catchPositionSigmaKm = Math.max(0, Number(input.catchPositionSigmaKm) || Number.POSITIVE_INFINITY);
  const catchVelocitySigmaKmS = Math.max(0, Number(input.catchVelocitySigmaKmS) || Number.POSITIVE_INFINITY);
  const elapsedSec = Math.max(0, Number(input.timeSinceSeparationSec) || 0);
  const propellantKg = Math.max(0, Number(input.remainingPropellantKg) || 0);
  const dynamicPressurePa = Math.max(0, Number(input.dynamicPressurePa) || 0);
  const reserveLandingKg = Math.max(0, Number(input.reserveLandingPropellantKg) || 0);
  const bodyRetrogradeAlignment = clamp(Number(input.bodyRetrogradeAlignment) || 0, -1, 1);
  const bodyAntiTangentAlignment = clamp(Number(input.bodyAntiTangentAlignment) || 0, -1, 1);
  const bodyUpAlignment = clamp(
    Number.isFinite(Number(input.bodyUpAlignment))
      ? Number(input.bodyUpAlignment)
      : 1,
    -1,
    1,
  );
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
  const desiredLateralClosingBaseKmS = clamp(
    launchSiteLateralRangeKm / Math.max(timeToGroundSec, 18),
    0,
    1.40,
  );
  const towerRelativeTerminalClosingCapKmS = towerRelativeActive
    ? (
      altitudeKm > 20
        ? 0.62
        : altitudeKm > 14
          ? 0.42
          : altitudeKm > 10
            ? 0.28
            : altitudeKm > 6
              ? 0.18
              : 0.12
    )
    : 1.40;
  const towerRelativeDesiredClosingKmS = towerRelativeActive
    ? clamp(
      catchLateralRangeKm / Math.max(timeToGroundSec * 1.8, altitudeKm > 12 ? 26 : altitudeKm > 8 ? 20 : 14),
      0.06,
      towerRelativeTerminalClosingCapKmS,
    )
    : desiredLateralClosingBaseKmS;
  const desiredLateralClosingKmS = towerRelativeActive
    ? Math.min(desiredLateralClosingBaseKmS, towerRelativeDesiredClosingKmS)
    : desiredLateralClosingBaseKmS;
  const maxResidualLateralSpeedKmS = clamp(
    0.16 + (0.0045 * altitudeKm),
    0.24,
    0.82,
  );
  const lateralClosingNeedNorm = clamp(
    (desiredLateralClosingKmS - launchSiteLateralClosingSpeedKmS) / Math.max(desiredLateralClosingKmS, 0.10),
    0,
    1,
  );
  const baseLandingBurnTriggerAltitudeKm = clamp(
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
  const towerRelativeTerminalWindow =
    towerRelativeActive
    && (
      catchTotalRangeKm <= 18
      || catchLateralRangeKm <= 14
      || altitudeKm <= Math.max(14, baseLandingBurnTriggerAltitudeKm * 2.1)
    );
  const towerRelativeFinalWindow =
    towerRelativeActive
    && (
      catchTotalRangeKm <= 6
      || catchLateralRangeKm <= 4.5
      || altitudeKm <= Math.max(6, baseLandingBurnTriggerAltitudeKm * 1.25)
    );
  const terminalApproachWindow =
    towerRelativeTerminalWindow
    || catchTotalRangeKm <= 5.6
    || launchSiteLateralRangeKm <= 7.4
    || altitudeKm <= Math.max(14, baseLandingBurnTriggerAltitudeKm * 2.1);
  const strictTerminalUprightWindow =
    towerRelativeFinalWindow
    || catchTotalRangeKm <= 2.6
    || launchSiteLateralRangeKm <= 3.8
    || altitudeKm <= Math.max(8.5, baseLandingBurnTriggerAltitudeKm * 1.5);
  const committedTowerCatch =
    towerRelativeActive
    && propellantKg > (reserveLandingKg * 0.02)
    && (
      currentPhase === "terminal-intercept"
      || currentPhase === "catch-approach"
      || currentPhase === "catch-burn"
      || catchTotalRangeKm <= 18
    );
  const targetUprightAlignment = strictTerminalUprightWindow
    ? 0.92
    : (terminalApproachWindow ? 0.82 : 0.68);
  const uprightAlignmentDeficitNorm = clamp(
    (targetUprightAlignment - bodyUpAlignment) / 0.38,
    0,
    1,
  );
  const landingBurnTriggerAltitudeKm = clamp(
    baseLandingBurnTriggerAltitudeKm
      + (uprightAlignmentDeficitNorm * (strictTerminalUprightWindow ? 2.8 : (terminalApproachWindow ? 1.6 : 0.6)))
      + (
        strictTerminalUprightWindow
          ? clamp((0.70 - bodyUpAlignment) / 0.32, 0, 1) * 1.4
          : 0
      ),
    0.45,
    towerRelativeActive ? 7.8 : 18.5,
  );
  const lateTerminalInterceptAltitudeKm = clamp(
    Math.max(
      towerRelativeActive
        ? (
          10.5
            + (0.42 * Math.min(catchLateralRangeKm, 12))
            + (3.6 * clamp(catchLateralSpeedKmS / 0.45, 0, 1))
        )
        : 5.8,
      landingBurnTriggerAltitudeKm + 0.8,
    ),
    towerRelativeActive ? 10.5 : 5.8,
    towerRelativeActive ? 18.0 : 12.5,
  );

  const separationFlipMinSec = 0.9;
  const separationFlipSettleSec = 2.6;
  const boostbackMinimumIgnitionSec = 2.8;
  const boostbackAlignmentGraceSec = 4.2;
  const highAltitudeEntryFloorKm = Math.max(24, landingBurnTriggerAltitudeKm * 2.6);
  const lowAltitudeEntryFloorKm = Math.max(16, landingBurnTriggerAltitudeKm * 1.35);
  const boostbackContinuationFloorKm = Math.max(12, lowAltitudeEntryFloorKm * 0.80);
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
  const hasBoostbackBudget = propellantKg > (reserveLandingKg * 0.28);
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
    altitudeKm,
    radialSpeedKmS,
    timeToGroundSec,
  });
  const boostbackPredictiveMetrics = resolveBoostbackPredictiveMetrics({
    altitudeKm,
    catchEastErrorKm,
    catchNorthErrorKm,
    catchEastSpeedKmS,
    catchNorthSpeedKmS,
    catchVerticalSpeedKmS,
    catchLateralRangeKm,
    catchApproachSpeedKmS,
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
  const aeroPredictiveIntercept = resolveTerminalInterceptMetrics({
    altitudeKm,
    catchTotalRangeKm,
    catchLateralRangeKm,
    catchVerticalErrorKm,
    catchApproachSpeedKmS,
    catchEastErrorKm,
    catchNorthErrorKm,
    catchEastSpeedKmS,
    catchNorthSpeedKmS,
    catchVerticalSpeedKmS,
    towerRelativeActive,
  });
  const aeroPredictiveCatchControl = aeroCrossrangeDemand.targetingActive
    ? {
      enabled: true,
      blend: clamp(
        0.22
          + (0.20 * aeroCrossrangeDemand.crossrangeDemandNorm)
          + (0.14 * aeroPredictiveIntercept.predictiveLateralMissNorm)
          + (towerRelativeActive ? 0.08 : 0),
        0.22,
        0.72,
      ),
      retrogradeBias: clamp(
        0.08
          + (0.08 * aeroCrossrangeDemand.closingNeedNorm)
          + (towerRelativeActive ? 0.04 : 0),
        0.06,
        0.24,
      ),
      translationOnly: false,
      interceptTimeSec: aeroPredictiveIntercept.interceptTimeSec,
      localDirection: { ...aeroPredictiveIntercept.localDirection },
      desiredEastSpeedKmS: aeroPredictiveIntercept.desiredEastSpeedKmS,
      desiredNorthSpeedKmS: aeroPredictiveIntercept.desiredNorthSpeedKmS,
      desiredVerticalSpeedKmS: aeroPredictiveIntercept.desiredVerticalSpeedKmS,
      predictedEastMissKm: aeroPredictiveIntercept.predictedEastMissKm,
      predictedNorthMissKm: aeroPredictiveIntercept.predictedNorthMissKm,
      predictedVerticalMissKm: aeroPredictiveIntercept.predictedVerticalMissKm,
      predictedLateralMissKm: aeroPredictiveIntercept.predictedLateralMissKm,
      predictedTotalMissKm: aeroPredictiveIntercept.predictedTotalMissKm,
    }
    : null;
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
  const thinAirEntryWindow =
    radialSpeedKmS < -0.03
    && altitudeKm > highAltitudeEntryFloorKm
    && (
      dynamicPressurePa < 4_500
      || gridFinAuthority < 0.10
    );
  const aeroEntryWindow =
    radialSpeedKmS < -0.05
    && altitudeKm > lowAltitudeEntryFloorKm
    && (
      dynamicPressurePa > 3_000
      || gridFinAuthority > 0.08
    );
  const terminalUprightCommitNorm = clamp(
    Math.max(
      terminalApproachWindow ? 0.35 : 0,
      strictTerminalUprightWindow ? 0.55 : 0,
      uprightAlignmentDeficitNorm,
    ),
    0,
    1,
  );
  const landingBurnCommitted = currentPhase === "landing-burn";
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
  const boostbackBurnDurationSec = Math.max(0, elapsedSec - boostbackMinimumIgnitionSec);
  const maxUsefulBoostbackBurnSec = clamp(
    70
      + (0.18 * catchTotalRangeKm)
      + (34 * clamp(catchLateralSpeedKmS / 0.55, 0, 1))
      + (22 * clamp(catchLateralRangeKm / 36, 0, 1)),
    90,
    240,
  );
  const boostbackDivergenceNorm = clamp(
    (-launchSiteLateralClosingSpeedKmS) / Math.max(boostbackInterceptDemand.desiredLateralClosingKmS, 0.18),
    0,
    1,
  );
  const boostbackClosingDeficitNorm = clamp(
    (
      (boostbackInterceptDemand.desiredLateralClosingKmS * 0.72)
      - launchSiteLateralClosingSpeedKmS
    ) / Math.max(boostbackInterceptDemand.desiredLateralClosingKmS, 0.12),
    0,
    1,
  );
  const boostbackThinAirWindow =
    altitudeKm > Math.max(lowAltitudeEntryFloorKm, 32)
    && dynamicPressurePa < 18_000;
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
  const initialBoostbackIgnitionEligible =
    separationPhaseActive
    && (
      boostbackSettledIgnitionEligible
      || boostbackRollingIgnitionEligible
    );

  if (
    separationPhaseActive
    && (
    elapsedSec < separationFlipMinSec
    || (
      elapsedSec < separationFlipSettleSec
      && !initialBoostbackIgnitionEligible
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
    && !initialBoostbackIgnitionEligible
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
      initialBoostbackIgnitionEligible
      || (
        currentPhase === "boostback"
        && boostbackThinAirWindow
        && hasBoostbackBudget
        && boostbackBurnDurationSec <= maxUsefulBoostbackBurnSec
        && (
          boostbackInterceptDemand.demandNorm > 0.12
          || boostbackDivergenceNorm > 0.10
          || boostbackClosingDeficitNorm > 0.10
          || boostbackPredictiveMetrics.speedDemandNorm > 0.18
          || catchLateralSpeedKmS > maxResidualLateralSpeedKmS
          || boostbackPredictiveMetrics.predictedLateralMissKm > 3.5
          || (
            catchLateralRangeKm <= 14
            && catchLateralSpeedKmS > 0.30
          )
          || (
            catchLateralRangeKm <= 6
            && catchLateralSpeedKmS > 0.16
          )
          || catchLateralRangeKm > 4
          || launchSiteLateralRangeKm > 3.5
          || (
            launchSiteLateralRangeKm > 1.5
            && launchSiteLateralClosingSpeedKmS < (boostbackInterceptDemand.desiredLateralClosingKmS * 1.45)
          )
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
      const boostbackBurnAlignment = Math.max(bodyRetrogradeAlignment, flipAlignment);
    const boostbackThrottleGate = clamp(
        (boostbackBurnAlignment - 0.18) / 0.42,
        0,
        1,
      );
      const boostbackSiteTargetingActive = true;
      return {
        phase: "boostback",
        guidanceMode: "booster-boostback",
        attitudeControlMode: "engines+rcs",
        aeroAuthority: 0,
        attitudeResponseScale: 3.55 + (0.65 * ignitionBlend),
        attitudeTargetBlend: 0.88 + (0.08 * ignitionBlend),
        angularDampingPerS: 0.34 + (0.14 * ignitionBlend),
        maxBodyRateDegS: 24.0 + (6.0 * ignitionBlend),
        siteTargetingEnabled: boostbackSiteTargetingActive,
        maxSiteSteeringAngleDeg: boostbackSiteTargetingActive ? 62 : 0,
        qAlphaSteeringEnabled: false,
        throttle: clamp(
          Math.max(
            (
              0.78
                + (0.08 * tangentialScale)
                + (0.10 * rtlsDemand)
                + (0.12 * boostbackInterceptDemand.closingNeedNorm)
                + (0.10 * boostbackDivergenceNorm)
                + (0.14 * boostbackPredictiveMetrics.speedDemandNorm)
                + (0.10 * boostbackPredictiveMetrics.predictiveLateralMissNorm)
                + (0.06 * ignitionBlend)
            ) * boostbackThrottleGate,
            currentPhase === "boostback" && boostbackSiteTargetingActive ? 0.58 : 0,
          ),
          0.22,
          0.98,
        ),
        directionMix: {
        up: 0.01,
        retrograde: 1.0,
        antiTangent: clamp(
          0.08
            + (
              0.16
                * boostbackInterceptDemand.lateralMissNorm
                * boostbackThrottleGate
                * (boostbackSiteTargetingActive ? 1 : 0)
            ),
            boostbackSiteTargetingActive ? 0.08 : 0,
            0.56,
        ),
        },
        siteVectorWeight: boostbackSiteTargetingActive
          ? clamp(
            0.42
              + (0.32 * boostbackInterceptDemand.lateralMissNorm)
              + (0.18 * boostbackPredictiveMetrics.predictiveLateralMissNorm),
            0.34,
            0.90,
          )
          : 0,
        siteVelocityWeight: boostbackSiteTargetingActive
          ? clamp(
            0.30
              + (0.30 * boostbackInterceptDemand.closingNeedNorm)
              + (0.22 * boostbackPredictiveMetrics.speedDemandNorm)
              + (0.18 * boostbackPredictiveMetrics.speedDemandNorm),
            0.24,
            0.92,
          )
          : 0,
        padInterceptBlend: boostbackSiteTargetingActive
          ? clamp(
            0.72
              + (0.18 * boostbackDivergenceNorm)
              + (0.24 * boostbackInterceptDemand.closingNeedNorm)
              + (0.12 * boostbackPredictiveMetrics.speedDemandNorm)
              + (0.10 * boostbackPredictiveMetrics.predictiveLateralMissNorm),
            0.72,
            1.0,
          )
          : 0,
        padInterceptLateralWeight: boostbackSiteTargetingActive
          ? clamp(
            0.98
              + (0.62 * boostbackInterceptDemand.lateralMissNorm)
              + (0.30 * boostbackPredictiveMetrics.predictiveLateralMissNorm),
            0.86,
            2.20,
          )
          : 0,
        padDesiredLateralClosingSpeedKmS: boostbackSiteTargetingActive
          ? clamp(
            Math.max(
              boostbackInterceptDemand.desiredLateralClosingKmS,
              Math.hypot(
                boostbackPredictiveMetrics.desiredEastSpeedKmS,
                boostbackPredictiveMetrics.desiredNorthSpeedKmS,
              ),
            ),
            0.32,
            2.80,
          )
          : 0,
        padInterceptTimeSec: boostbackSiteTargetingActive
          ? Math.min(
            boostbackInterceptDemand.interceptTimeSec,
            boostbackPredictiveMetrics.interceptTimeSec,
          )
          : 0,
        predictiveCatchControl: boostbackSiteTargetingActive
          ? {
            enabled: true,
            blend: clamp(
              0.46
                + (0.22 * boostbackPredictiveMetrics.lateralDemandNorm)
                + (0.12 * boostbackPredictiveMetrics.speedDemandNorm),
              0.46,
              0.84,
            ),
            retrogradeBias: clamp(
              0.12 + (0.10 * boostbackPredictiveMetrics.speedDemandNorm),
              0.12,
              0.28,
            ),
            translationOnly: false,
            interceptTimeSec: boostbackPredictiveMetrics.interceptTimeSec,
            localDirection: { ...boostbackPredictiveMetrics.localDirection },
            desiredEastSpeedKmS: boostbackPredictiveMetrics.desiredEastSpeedKmS,
            desiredNorthSpeedKmS: boostbackPredictiveMetrics.desiredNorthSpeedKmS,
            desiredVerticalSpeedKmS: 0,
            predictedEastMissKm: boostbackPredictiveMetrics.predictedEastMissKm,
            predictedNorthMissKm: boostbackPredictiveMetrics.predictedNorthMissKm,
            predictedVerticalMissKm: 0,
            predictedLateralMissKm: boostbackPredictiveMetrics.predictedLateralMissKm,
            predictedTotalMissKm: boostbackPredictiveMetrics.predictedLateralMissKm,
          }
          : null,
      };
  }

  const highAltitudeTowerCorridorHold =
    towerRelativeActive
    && altitudeKm > 28
    && altitudeKm <= 120
    && catchLateralRangeKm <= 24
    && propellantKg > (reserveLandingKg * 0.08);
  if (highAltitudeTowerCorridorHold) {
    const highAltitudeIntercept = resolveTerminalInterceptMetrics({
      altitudeKm,
      catchTotalRangeKm,
      catchLateralRangeKm,
      catchVerticalErrorKm,
      catchApproachSpeedKmS,
      catchEastErrorKm,
      catchNorthErrorKm,
      catchEastSpeedKmS,
      catchNorthSpeedKmS,
      catchVerticalSpeedKmS,
      towerRelativeActive: true,
    });
    return {
      phase: "terminal-intercept",
      guidanceMode: "booster-terminal-intercept",
      attitudeControlMode: "engines+rcs",
      qAlphaSteeringEnabled: false,
      aeroAuthority: clamp(gridFinAuthority * 0.12, 0, 0.12),
      siteTargetingEnabled: true,
      throttle: clamp(
        0.22
          + (0.28 * highAltitudeIntercept.lateralDemandNorm)
          + (0.18 * clamp(catchLateralSpeedKmS / 0.90, 0, 1))
          + (0.10 * clamp(Math.abs(catchVerticalSpeedKmS) / 0.30, 0, 1)),
        0.20,
        0.58,
      ),
      directionMix: {
        up: 0.18,
        retrograde: 0.66,
        antiTangent: 0.12,
      },
      terminalUprightCommit: true,
      uprightTiltLimitDeg: clamp(18 + (0.35 * Math.min(catchLateralRangeKm, 18)), 18, 28),
      siteVectorWeight: 0.72,
      siteVelocityWeight: 0.68,
      padInterceptBlend: 0.94,
      padInterceptLateralWeight: 1.40,
      padDesiredLateralClosingSpeedKmS: clamp(
        Math.max(
          0.30,
          Math.hypot(
            highAltitudeIntercept.desiredEastSpeedKmS,
            highAltitudeIntercept.desiredNorthSpeedKmS,
          ),
        ),
        0.30,
        1.40,
      ),
      maxSiteSteeringAngleDeg: 78,
      attitudeResponseScale: 1.34,
      attitudeTargetBlend: 0.92,
      angularDampingPerS: 0.98,
      maxBodyRateDegS: 13.5,
      predictiveCatchControl: {
        enabled: true,
        blend: 0.92,
        retrogradeBias: 0.10,
        translationOnly: false,
        translationAuthority: 0.88,
        interceptTimeSec: highAltitudeIntercept.interceptTimeSec,
        localDirection: { ...highAltitudeIntercept.localDirection },
        desiredEastSpeedKmS: highAltitudeIntercept.desiredEastSpeedKmS,
        desiredNorthSpeedKmS: highAltitudeIntercept.desiredNorthSpeedKmS,
        desiredVerticalSpeedKmS: highAltitudeIntercept.desiredVerticalSpeedKmS,
        predictedEastMissKm: highAltitudeIntercept.predictedEastMissKm,
        predictedNorthMissKm: highAltitudeIntercept.predictedNorthMissKm,
        predictedVerticalMissKm: highAltitudeIntercept.predictedVerticalMissKm,
        predictedLateralMissKm: highAltitudeIntercept.predictedLateralMissKm,
        predictedTotalMissKm: highAltitudeIntercept.predictedTotalMissKm,
      },
    };
  }

  if (thinAirEntryWindow && altitudeKm <= 108 && currentPhase !== "terminal-intercept") {
    const entryAlignNeedNorm = clamp(
      Math.max(
        (0.84 - bodyUpAlignment) / 0.34,
        (0.90 - bodyRetrogradeAlignment) / 0.30,
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
        terminalUprightCommit: true,
        uprightTiltLimitDeg: clamp(
          (strictTerminalUprightWindow ? 7 : (terminalApproachWindow ? 10 : 13))
            + (0.08 * Math.min(launchSiteLateralRangeKm, 70)),
          strictTerminalUprightWindow ? 7 : (terminalApproachWindow ? 10 : 13),
          28,
        ),
        attitudeResponseScale: 1.18 + (0.42 * Math.max(entryAlignNeedNorm, terminalUprightCommitNorm)),
        attitudeTargetBlend: 0.88 + (0.08 * Math.max(entryAlignNeedNorm, terminalUprightCommitNorm)),
        angularDampingPerS: 0.94 + (0.18 * Math.max(entryAlignNeedNorm, terminalUprightCommitNorm)),
        maxBodyRateDegS: 14.0,
        siteTargetingEnabled: Boolean(
          terminalApproachWindow
          && aeroCrossrangeDemand.targetingActive
          && gridFinAuthority > 0.12
        ),
        throttle: 0,
        directionMix: {
          up: 0.98 + (0.10 * terminalUprightCommitNorm),
          retrograde: 0.34 - (0.08 * terminalUprightCommitNorm),
          antiTangent: clamp(
            0.05 + (0.06 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
            0.05,
            0.12,
          ),
        },
        siteVectorWeight: clamp(
          0.16 + (0.34 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.08,
          0.52,
        ),
        siteVelocityWeight: clamp(
          0.10 + (0.22 * aeroCrossrangeDemand.closingNeedNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.06,
          0.34,
        ),
        padInterceptBlend: clamp(
          0.18 + (0.22 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.10,
          0.42,
        ),
        padInterceptLateralWeight: clamp(
          0.22 + (0.30 * aeroCrossrangeDemand.crossrangeDemandNorm),
          0.14,
          0.56,
        ),
        padDesiredLateralClosingSpeedKmS: clamp(
          desiredLateralClosingKmS * (1.30 + (0.28 * aeroCrossrangeDemand.crossrangeDemandNorm)),
          0.08,
          0.92,
        ),
        maxSiteSteeringAngleDeg: 36,
        predictiveCatchControl: aeroPredictiveCatchControl,
      };
    }
  }

  if (aeroEntryWindow && currentPhase !== "terminal-intercept") {
    const descendingIntoEntry = downwardSpeedKmS > 0.08 && radialSpeedKmS < -0.08;
    if (!descendingIntoEntry) {
      return {
        phase: "ballistic-descent",
        guidanceMode: "booster-ballistic-settle",
        attitudeControlMode: "grid-fins+rcs",
        aeroAuthority: gridFinAuthority,
        terminalUprightCommit: true,
        uprightTiltLimitDeg: clamp(
          (strictTerminalUprightWindow ? 7 : 10) + (0.08 * Math.min(launchSiteLateralRangeKm, 70)),
          strictTerminalUprightWindow ? 7 : 10,
          28,
        ),
        attitudeResponseScale: 1.08 + (0.34 * terminalUprightCommitNorm),
        attitudeTargetBlend: 0.84 + (0.10 * terminalUprightCommitNorm),
        angularDampingPerS: 0.86 + (0.16 * terminalUprightCommitNorm),
        maxBodyRateDegS: 12.5,
        siteTargetingEnabled: aeroCrossrangeDemand.targetingActive,
        throttle: 0,
        directionMix: {
          up: 1.00 + (0.08 * terminalUprightCommitNorm),
          retrograde: 0.18 - (0.04 * terminalUprightCommitNorm),
          antiTangent: clamp(
            0.06 + (0.08 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
            0.06,
            0.14,
          ),
        },
        siteVectorWeight: clamp(
          0.24 + (0.50 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.14,
          0.82,
        ),
        siteVelocityWeight: clamp(
          0.14 + (0.36 * aeroCrossrangeDemand.closingNeedNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.08,
          0.56,
        ),
        padInterceptBlend: clamp(
          0.18 + (0.26 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.10,
          0.50,
        ),
        padInterceptLateralWeight: clamp(
          0.24 + (0.38 * aeroCrossrangeDemand.crossrangeDemandNorm),
          0.16,
          0.64,
        ),
        padDesiredLateralClosingSpeedKmS: clamp(
          desiredLateralClosingKmS * (1.34 + (0.30 * aeroCrossrangeDemand.crossrangeDemandNorm)),
          0.10,
          1.00,
        ),
        maxSiteSteeringAngleDeg: 38,
        predictiveCatchControl: aeroPredictiveCatchControl,
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
        terminalUprightCommit: true,
        uprightTiltLimitDeg: clamp(
          (strictTerminalUprightWindow ? 6 : 9) + (0.08 * Math.min(launchSiteLateralRangeKm, 70)),
          strictTerminalUprightWindow ? 6 : 9,
          24,
        ),
        attitudeResponseScale: 1.20 + (0.30 * terminalUprightCommitNorm),
        attitudeTargetBlend: 0.86 + (0.08 * terminalUprightCommitNorm),
        angularDampingPerS: 0.92 + (0.12 * terminalUprightCommitNorm),
        maxBodyRateDegS: 11.5,
        throttle: clamp(0.34 + (0.40 * entryInterfaceNorm), 0.34, 0.82),
        directionMix: {
          up: 0.98,
          retrograde: 0.12,
          antiTangent: clamp(
            0.08 + (0.10 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
            0.08,
            0.16,
          ),
        },
        siteTargetingEnabled: aeroCrossrangeDemand.targetingActive,
        siteVectorWeight: clamp(
          0.18 + (0.28 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.10,
          0.48,
        ),
        siteVelocityWeight: clamp(
          0.12 + (0.24 * aeroCrossrangeDemand.closingNeedNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.08,
          0.38,
        ),
        padInterceptBlend: clamp(
          0.20 + (0.22 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.12,
          0.46,
        ),
        padInterceptLateralWeight: clamp(
          0.24 + (0.30 * aeroCrossrangeDemand.crossrangeDemandNorm),
          0.16,
          0.58,
        ),
        padDesiredLateralClosingSpeedKmS: clamp(
          desiredLateralClosingKmS * (1.34 + (0.26 * aeroCrossrangeDemand.crossrangeDemandNorm)),
          0.10,
          1.05,
        ),
        maxSiteSteeringAngleDeg: 34,
        predictiveCatchControl: aeroPredictiveCatchControl,
      };
    }
    return {
      phase: "ballistic-descent",
      guidanceMode: "booster-entry-guidance",
      attitudeControlMode: "grid-fins+rcs",
      aeroAuthority: gridFinAuthority,
      terminalUprightCommit: true,
      uprightTiltLimitDeg: clamp(
        (strictTerminalUprightWindow ? 6 : 9) + (0.08 * Math.min(launchSiteLateralRangeKm, 70)),
        strictTerminalUprightWindow ? 6 : 9,
        26,
      ),
      attitudeResponseScale: 1.10 + (0.34 * terminalUprightCommitNorm),
      attitudeTargetBlend: 0.84 + (0.08 * terminalUprightCommitNorm),
      angularDampingPerS: 0.86 + (0.14 * terminalUprightCommitNorm),
      maxBodyRateDegS: 11.5,
      throttle: 0,
      directionMix: {
        up: 1.00 + (0.08 * terminalUprightCommitNorm),
        retrograde: 0.12,
        antiTangent: clamp(
          0.08 + (0.10 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.08,
          0.16,
        ),
      },
      siteTargetingEnabled: aeroCrossrangeDemand.targetingActive,
      siteVectorWeight: clamp(
        0.24 + (0.56 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
        0.14,
        0.90,
      ),
      siteVelocityWeight: clamp(
        0.16 + (0.40 * aeroCrossrangeDemand.closingNeedNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
        0.10,
        0.62,
      ),
      padInterceptBlend: clamp(
        0.22 + (0.26 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
        0.14,
        0.56,
      ),
      padInterceptLateralWeight: clamp(
        0.28 + (0.40 * aeroCrossrangeDemand.crossrangeDemandNorm),
        0.18,
        0.72,
      ),
      padDesiredLateralClosingSpeedKmS: clamp(
        desiredLateralClosingKmS * (1.42 + (0.30 * aeroCrossrangeDemand.crossrangeDemandNorm)),
        0.10,
        1.12,
      ),
      maxSiteSteeringAngleDeg: 38,
      predictiveCatchControl: aeroPredictiveCatchControl,
    };
  }

  const sustainingCatchApproach = currentPhase === "catch-approach" || currentPhase === "catch-burn";
  const sustainCatchCorridor =
    sustainingCatchApproach
    && towerRelativeActive
    && altitudeKm <= 30
    && catchTotalRangeKm <= 40
    && catchLateralRangeKm <= 15
    && Math.abs(catchVerticalErrorKm) <= 28
    && propellantKg > (reserveLandingKg * 0.02);

  let catchCommand = resolveBoosterCatchCommand({
    currentPhase,
    sustainOverride: sustainingCatchApproach,
    sustainRelaxed: sustainCatchCorridor,
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
    catchEastErrorKm,
    catchNorthErrorKm,
    catchEastSpeedKmS,
    catchNorthSpeedKmS,
    catchClosingSpeedKmS,
    towerRelativeActive,
    catchPositionSigmaKm,
    catchVelocitySigmaKmS,
    bodyUpAlignment,
  });
  const catchCorridorLatch =
    towerRelativeActive
    && altitudeKm <= 26
    && catchTotalRangeKm <= 26
    && catchLateralRangeKm <= 9
    && Math.abs(catchVerticalErrorKm) <= 22
    && propellantKg > (reserveLandingKg * 0.02);
  if (!catchCommand && catchCorridorLatch) {
    catchCommand = resolveBoosterCatchCommand({
      currentPhase: sustainingCatchApproach ? currentPhase : "catch-approach",
      sustainOverride: true,
      sustainRelaxed: true,
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
      catchEastErrorKm,
      catchNorthErrorKm,
      catchEastSpeedKmS,
      catchNorthSpeedKmS,
      catchClosingSpeedKmS,
      towerRelativeActive,
      catchPositionSigmaKm,
      catchVelocitySigmaKmS,
      bodyUpAlignment,
    });
  }
  if (catchCommand) {
    return catchCommand;
  }

  const sustainingTerminalIntercept =
    currentPhase === "terminal-intercept"
    || (
      committedTowerCatch
      && altitudeKm <= lateTerminalInterceptAltitudeKm
    );
  const terminalInterceptWindow =
    altitudeKm > 0.8
    && altitudeKm <= lateTerminalInterceptAltitudeKm
    && catchTotalRangeKm <= (sustainingTerminalIntercept ? 60.0 : 48.0)
    && catchLateralRangeKm <= (sustainingTerminalIntercept ? 60.0 : 52.0)
    && Math.abs(catchVerticalErrorKm) <= (sustainingTerminalIntercept ? 34.0 : 24.0)
    && propellantKg > (reserveLandingKg * 0.05)
    && !sustainCatchCorridor;
  if (terminalInterceptWindow) {
    const terminalIntercept = resolveTerminalInterceptMetrics({
      altitudeKm,
      catchTotalRangeKm,
      catchLateralRangeKm,
      catchVerticalErrorKm,
      catchApproachSpeedKmS,
      catchEastErrorKm,
      catchNorthErrorKm,
      catchEastSpeedKmS,
      catchNorthSpeedKmS,
      catchVerticalSpeedKmS,
      towerRelativeActive,
    });
    const terminalAscentPenaltyNorm = clamp((radialSpeedKmS + 0.015) / 0.10, 0, 1);
    const terminalVerticalThrottleDemandNorm = clamp(
      (terminalIntercept.desiredVerticalSpeedKmS - catchVerticalSpeedKmS) / 0.18,
      0,
      1,
    );
    const terminalVerticalHoldPenaltyNorm = Math.max(
      terminalAscentPenaltyNorm,
      clamp(
        (catchVerticalSpeedKmS - terminalIntercept.desiredVerticalSpeedKmS) / 0.20,
        0,
        1,
      ),
    );
    const terminalLateralRangeNorm = clamp(catchLateralRangeKm / 24, 0, 1);
    const uprightInterceptNorm = clamp((bodyUpAlignment - 0.55) / 0.35, 0, 1);
    return {
      phase: "terminal-intercept",
      guidanceMode: "booster-terminal-intercept",
      attitudeControlMode: "engines+rcs",
      qAlphaSteeringEnabled: false,
      aeroAuthority: clamp(gridFinAuthority * 0.18, 0, 0.18),
      siteTargetingEnabled: true,
      throttle: clamp(
        0.14
          + (0.30 * terminalVerticalThrottleDemandNorm)
          + (0.24 * terminalIntercept.lateralDemandNorm)
          + (0.12 * terminalIntercept.predictiveLateralMissNorm)
          + (0.08 * terminalLateralRangeNorm)
          - (0.44 * terminalVerticalHoldPenaltyNorm),
        0.06,
        0.72 - (0.26 * terminalVerticalHoldPenaltyNorm),
      ),
      directionMix: {
        up: clamp(
          0.28
            + (0.22 * (1 - terminalLateralRangeNorm))
            - (0.56 * terminalVerticalHoldPenaltyNorm),
          0.10,
          0.42,
        ),
        retrograde: clamp(
          0.26
            + (0.16 * terminalLateralRangeNorm)
            + (0.42 * terminalVerticalHoldPenaltyNorm),
          0.26,
          0.76,
        ),
        antiTangent: clamp(0.08 + (0.06 * terminalLateralRangeNorm), 0.08, 0.14),
      },
      terminalUprightCommit: true,
      uprightTiltLimitDeg: clamp(
        (towerRelativeActive ? 12 : 12) + (0.55 * Math.min(catchLateralRangeKm, 20)),
        towerRelativeActive ? 12 : 12,
        24,
      ),
      siteVectorWeight: clamp(
        0.34 + (0.32 * terminalLateralRangeNorm),
        0.34,
        0.82,
      ),
      siteVelocityWeight: clamp(
        0.28 + (0.28 * terminalIntercept.lateralDemandNorm),
        0.26,
        0.66,
      ),
      padInterceptBlend: clamp(
        0.62 + (0.24 * terminalLateralRangeNorm),
        0.62,
        0.96,
      ),
      padInterceptLateralWeight: clamp(
        0.78 + (0.40 * terminalIntercept.lateralDemandNorm),
        0.72,
        1.18,
      ),
      padDesiredLateralClosingSpeedKmS: clamp(
        Math.max(
          0.24,
          Math.hypot(
            terminalIntercept.desiredEastSpeedKmS,
            terminalIntercept.desiredNorthSpeedKmS,
          ),
        ),
        0.24,
        1.20,
      ),
      maxSiteSteeringAngleDeg: clamp(
        26 + (0.55 * Math.min(catchLateralRangeKm, 30)),
        26,
        60,
      ),
      attitudeResponseScale: 1.28 + (0.34 * Math.max(terminalUprightCommitNorm, 1 - uprightInterceptNorm)),
      attitudeTargetBlend: 0.90 + (0.05 * terminalUprightCommitNorm),
      angularDampingPerS: 0.94 + (0.10 * terminalUprightCommitNorm),
      maxBodyRateDegS: 11.5,
      predictiveCatchControl: {
        enabled: true,
        blend: clamp(
          0.60
            + (0.20 * terminalIntercept.lateralDemandNorm)
            + (0.08 * terminalVerticalThrottleDemandNorm)
            + (towerRelativeActive ? 0.06 : 0),
          0.60,
          0.96,
        ),
        retrogradeBias: clamp(
          0.03 + (0.08 * terminalIntercept.lateralDemandNorm) + (0.10 * terminalVerticalHoldPenaltyNorm),
          0.03,
          0.24,
        ),
        translationOnly: false,
        translationAuthority: clamp(
          0.48
            + (0.26 * terminalIntercept.lateralDemandNorm)
            + (towerRelativeActive ? 0.08 : 0),
          0.48,
          0.88,
        ),
        interceptTimeSec: terminalIntercept.interceptTimeSec,
        localDirection: {
          ...terminalIntercept.localDirection,
          up: clamp(
            Number(terminalIntercept.localDirection?.up) * (1 - (0.82 * terminalVerticalHoldPenaltyNorm)),
            0.02,
            0.84,
          ),
        },
        desiredEastSpeedKmS: terminalIntercept.desiredEastSpeedKmS,
        desiredNorthSpeedKmS: terminalIntercept.desiredNorthSpeedKmS,
        desiredVerticalSpeedKmS: terminalIntercept.desiredVerticalSpeedKmS,
        predictedEastMissKm: terminalIntercept.predictedEastMissKm,
        predictedNorthMissKm: terminalIntercept.predictedNorthMissKm,
        predictedVerticalMissKm: terminalIntercept.predictedVerticalMissKm,
        predictedLateralMissKm: terminalIntercept.predictedLateralMissKm,
        predictedTotalMissKm: terminalIntercept.predictedTotalMissKm,
      },
    };
  }

  if (
    altitudeKm > landingBurnTriggerAltitudeKm
    && currentPhase !== "terminal-intercept"
    && !(
      landingBurnCommitted
      && altitudeKm <= (landingBurnTriggerAltitudeKm + 2.4)
    )
  ) {
    const towerRelativeAeroInterceptNorm = towerRelativeActive
      ? clamp(
        Math.max(
          (18 - altitudeKm) / 10,
          (20 - catchLateralRangeKm) / 18,
        ),
        0,
        1,
      )
      : 0;
    const towerRelativeAeroCatchMetrics =
      towerRelativeActive && catchTotalRangeKm <= 20
        ? resolveTerminalInterceptMetrics({
          altitudeKm,
          catchTotalRangeKm,
          catchLateralRangeKm,
          catchVerticalErrorKm,
          catchApproachSpeedKmS,
          catchEastErrorKm,
          catchNorthErrorKm,
          catchEastSpeedKmS,
          catchNorthSpeedKmS,
          catchVerticalSpeedKmS,
          towerRelativeActive,
        })
        : null;
    return {
      phase: "descent-coast",
      guidanceMode: "booster-descent-coast",
      attitudeControlMode: "grid-fins+rcs",
      aeroAuthority: gridFinAuthority,
      terminalUprightCommit: true,
      uprightTiltLimitDeg: clamp(
        (towerRelativeActive ? 10 : (strictTerminalUprightWindow ? 6 : 8))
          + (0.36 * Math.min(catchLateralRangeKm, 18))
          + (altitudeKm > 10 ? 1.5 : 0),
        towerRelativeActive ? 10 : (strictTerminalUprightWindow ? 6 : 8),
        towerRelativeActive ? 20 : 16,
      ),
      attitudeResponseScale: 1.24 + (0.40 * terminalUprightCommitNorm),
      attitudeTargetBlend: 0.90 + (0.06 * terminalUprightCommitNorm),
      angularDampingPerS: 0.92 + (0.12 * terminalUprightCommitNorm),
      maxBodyRateDegS: 10.5,
      throttle: 0,
      directionMix: {
        up: 0.98,
        retrograde: 0.08,
        antiTangent: clamp(
          0.03
            + (0.06 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm)
            + (0.05 * towerRelativeAeroInterceptNorm),
          0.04,
          0.16,
        ),
      },
      siteTargetingEnabled: towerRelativeAeroCatchMetrics
        ? false
        : aeroCrossrangeDemand.targetingActive,
      siteVectorWeight: clamp(
        0.22
          + (0.62 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
        0.18,
        0.82 + (0.12 * towerRelativeAeroInterceptNorm),
      ),
      siteVelocityWeight: clamp(
        0.14
          + (0.46 * aeroCrossrangeDemand.closingNeedNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
        0.12,
        0.62 + (0.12 * towerRelativeAeroInterceptNorm),
      ),
      padInterceptBlend: clamp(
        0.18
          + (0.26 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm)
          + (0.18 * towerRelativeAeroInterceptNorm),
        0.18,
        0.60,
      ),
      padInterceptLateralWeight: clamp(
        0.22
          + (0.44 * aeroCrossrangeDemand.crossrangeDemandNorm)
          + (0.22 * towerRelativeAeroInterceptNorm),
        0.22,
        0.84,
      ),
      padDesiredLateralClosingSpeedKmS: clamp(
        towerRelativeAeroCatchMetrics
          ? Math.max(
            0.08,
            Math.hypot(
              towerRelativeAeroCatchMetrics.desiredEastSpeedKmS,
              towerRelativeAeroCatchMetrics.desiredNorthSpeedKmS,
            ) * 0.88,
          )
          : (
            desiredLateralClosingKmS
              * (
                1.28
                + (0.30 * aeroCrossrangeDemand.crossrangeDemandNorm)
                + (0.26 * towerRelativeAeroInterceptNorm)
              )
          ),
        0.08,
        towerRelativeAeroCatchMetrics ? 0.46 : 1.02,
      ),
      maxSiteSteeringAngleDeg: clamp(26 + (14 * towerRelativeAeroInterceptNorm), 26, 40),
      predictiveCatchControl: towerRelativeAeroCatchMetrics
        ? {
          enabled: true,
          blend: clamp(
            0.52
              + (0.18 * towerRelativeAeroCatchMetrics.lateralDemandNorm)
              + (0.10 * towerRelativeAeroCatchMetrics.predictiveLateralMissNorm),
            0.52,
            0.88,
          ),
          retrogradeBias: clamp(
            0.08 + (0.06 * towerRelativeAeroCatchMetrics.lateralDemandNorm),
            0.08,
            0.24,
          ),
          translationOnly: false,
          translationAuthority: clamp(
            0.28 + (0.26 * towerRelativeAeroCatchMetrics.lateralDemandNorm),
            0.28,
            0.60,
          ),
          interceptTimeSec: towerRelativeAeroCatchMetrics.interceptTimeSec,
          localDirection: {
            ...towerRelativeAeroCatchMetrics.localDirection,
            up: clamp(
              Number(towerRelativeAeroCatchMetrics.localDirection?.up),
              0.02,
              0.32,
            ),
          },
          desiredEastSpeedKmS: towerRelativeAeroCatchMetrics.desiredEastSpeedKmS,
          desiredNorthSpeedKmS: towerRelativeAeroCatchMetrics.desiredNorthSpeedKmS,
          desiredVerticalSpeedKmS: towerRelativeAeroCatchMetrics.desiredVerticalSpeedKmS,
          predictedEastMissKm: towerRelativeAeroCatchMetrics.predictedEastMissKm,
          predictedNorthMissKm: towerRelativeAeroCatchMetrics.predictedNorthMissKm,
          predictedVerticalMissKm: towerRelativeAeroCatchMetrics.predictedVerticalMissKm,
          predictedLateralMissKm: towerRelativeAeroCatchMetrics.predictedLateralMissKm,
          predictedTotalMissKm: towerRelativeAeroCatchMetrics.predictedTotalMissKm,
        }
        : null,
    };
  }

  if (committedTowerCatch && altitudeKm <= lateTerminalInterceptAltitudeKm) {
    const terminalIntercept = resolveTerminalInterceptMetrics({
      altitudeKm,
      catchTotalRangeKm,
      catchLateralRangeKm,
      catchVerticalErrorKm,
      catchApproachSpeedKmS,
      catchEastErrorKm,
      catchNorthErrorKm,
      catchEastSpeedKmS,
      catchNorthSpeedKmS,
      catchVerticalSpeedKmS,
      towerRelativeActive,
    });
    const terminalAscentPenaltyNorm = clamp((radialSpeedKmS + 0.015) / 0.10, 0, 1);
    const terminalVerticalThrottleDemandNorm = clamp(
      (terminalIntercept.desiredVerticalSpeedKmS - catchVerticalSpeedKmS) / 0.18,
      0,
      1,
    );
    const terminalVerticalHoldPenaltyNorm = Math.max(
      terminalAscentPenaltyNorm,
      clamp(
        (catchVerticalSpeedKmS - terminalIntercept.desiredVerticalSpeedKmS) / 0.20,
        0,
        1,
      ),
    );
    const terminalLateralRangeNorm = clamp(catchLateralRangeKm / 24, 0, 1);
    return {
      phase: "terminal-intercept",
      guidanceMode: "booster-terminal-intercept",
      attitudeControlMode: "engines+rcs",
      qAlphaSteeringEnabled: false,
      aeroAuthority: clamp(gridFinAuthority * 0.18, 0, 0.18),
      siteTargetingEnabled: true,
      throttle: clamp(
        0.16
          + (0.32 * terminalVerticalThrottleDemandNorm)
          + (0.24 * terminalIntercept.lateralDemandNorm)
          + (0.12 * terminalIntercept.predictiveLateralMissNorm)
          + (0.08 * terminalLateralRangeNorm)
          - (0.46 * terminalVerticalHoldPenaltyNorm),
        0.06,
        0.74 - (0.28 * terminalVerticalHoldPenaltyNorm),
      ),
      directionMix: {
        up: clamp(
          0.30
            + (0.22 * (1 - terminalLateralRangeNorm))
            - (0.58 * terminalVerticalHoldPenaltyNorm),
          0.10,
          0.44,
        ),
        retrograde: clamp(
          0.26
            + (0.16 * terminalLateralRangeNorm)
            + (0.44 * terminalVerticalHoldPenaltyNorm),
          0.26,
          0.78,
        ),
        antiTangent: clamp(0.08 + (0.06 * terminalLateralRangeNorm), 0.08, 0.14),
      },
      terminalUprightCommit: true,
      uprightTiltLimitDeg: clamp(
        12 + (0.55 * Math.min(catchLateralRangeKm, 20)),
        12,
        22,
      ),
      siteVectorWeight: clamp(
        0.34 + (0.32 * terminalLateralRangeNorm),
        0.34,
        0.82,
      ),
      siteVelocityWeight: clamp(
        0.28 + (0.28 * terminalIntercept.lateralDemandNorm),
        0.26,
        0.66,
      ),
      padInterceptBlend: clamp(
        0.62 + (0.24 * terminalLateralRangeNorm),
        0.62,
        0.96,
      ),
      padInterceptLateralWeight: clamp(
        0.78 + (0.40 * terminalIntercept.lateralDemandNorm),
        0.72,
        1.18,
      ),
      padDesiredLateralClosingSpeedKmS: clamp(
        Math.max(
          0.24,
          Math.hypot(
            terminalIntercept.desiredEastSpeedKmS,
            terminalIntercept.desiredNorthSpeedKmS,
          ),
        ),
        0.24,
        1.20,
      ),
      maxSiteSteeringAngleDeg: clamp(
        26 + (0.46 * Math.min(catchLateralRangeKm, 26)),
        26,
        60,
      ),
      attitudeResponseScale: 1.30 + (0.34 * terminalUprightCommitNorm),
      attitudeTargetBlend: 0.90 + (0.05 * terminalUprightCommitNorm),
      angularDampingPerS: 0.96 + (0.10 * terminalUprightCommitNorm),
      maxBodyRateDegS: 11.5,
      predictiveCatchControl: {
        enabled: true,
        blend: clamp(
          0.68
            + (0.18 * terminalIntercept.lateralDemandNorm)
            + (towerRelativeActive ? 0.06 : 0),
          0.68,
          0.96,
        ),
        retrogradeBias: clamp(
          0.05 + (0.08 * terminalIntercept.lateralDemandNorm) + (0.10 * terminalVerticalHoldPenaltyNorm),
          0.05,
          0.26,
        ),
        translationOnly: false,
        translationAuthority: clamp(
          0.56
            + (0.26 * terminalIntercept.lateralDemandNorm)
            + (towerRelativeActive ? 0.08 : 0),
          0.56,
          0.92,
        ),
        interceptTimeSec: terminalIntercept.interceptTimeSec,
        localDirection: {
          ...terminalIntercept.localDirection,
          up: clamp(
            Number(terminalIntercept.localDirection?.up) * (1 - (0.80 * terminalVerticalHoldPenaltyNorm)),
            0.02,
            0.84,
          ),
        },
        desiredEastSpeedKmS: terminalIntercept.desiredEastSpeedKmS,
        desiredNorthSpeedKmS: terminalIntercept.desiredNorthSpeedKmS,
        desiredVerticalSpeedKmS: terminalIntercept.desiredVerticalSpeedKmS,
        predictedEastMissKm: terminalIntercept.predictedEastMissKm,
        predictedNorthMissKm: terminalIntercept.predictedNorthMissKm,
        predictedVerticalMissKm: terminalIntercept.predictedVerticalMissKm,
        predictedLateralMissKm: terminalIntercept.predictedLateralMissKm,
        predictedTotalMissKm: terminalIntercept.predictedTotalMissKm,
      },
    };
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
    0.32,
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
    attitudeControlMode: "engines+rcs",
    qAlphaSteeringEnabled: false,
    aeroAuthority: clamp(gridFinAuthority * 0.25, 0, 0.2),
    terminalUprightCommit: true,
    uprightTiltLimitDeg: 3.5,
    attitudeResponseScale: 1.48 + (0.40 * terminalUprightCommitNorm),
    attitudeTargetBlend: 0.90 + (0.06 * terminalUprightCommitNorm),
    angularDampingPerS: 1.02 + (0.18 * terminalUprightCommitNorm),
    maxBodyRateDegS: 6.2,
    throttle,
    directionMix: { up: 1.0, retrograde: 0.05, antiTangent: 0.02 },
    siteVectorWeight: clamp(
      0.10 + (0.26 * terminalRangeNorm),
      0.06,
      0.36,
    ),
    siteVelocityWeight: clamp(
      0.08 + (0.20 * terminalRangeNorm),
      0.05,
      0.30,
    ),
    padInterceptBlend: clamp(
      0.12 + (0.16 * terminalRangeNorm),
      0.12,
      0.28,
    ),
    padInterceptLateralWeight: clamp(
      0.16 + (0.24 * terminalRangeNorm),
      0.16,
      0.34,
    ),
    padDesiredLateralClosingSpeedKmS: clamp(
      desiredLateralClosingKmS * (1.06 + (0.18 * terminalRangeNorm)),
      0.08,
      0.48,
    ),
    maxSiteSteeringAngleDeg: 14,
    touchdownReady: altitudeKm <= touchdownBandKm && Math.abs(radialSpeedKmS) < 0.03,
  };
}
