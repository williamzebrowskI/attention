import {
  computeBoosterRecoveryCommand,
  resolveBoosterStageAttitudePolicy,
} from "../app/static/js/physics/launch/boosterRecovery.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertPolicy(phase) {
  const policy = resolveBoosterStageAttitudePolicy(phase);
  assert(policy, `missing booster stage attitude policy for ${phase}`);
  assert(policy.positionIntent, `missing position intent for ${phase}`);
  assert(policy.attitudeIntent, `missing attitude intent for ${phase}`);
  assert(policy.targetPosture, `missing target posture for ${phase}`);
  return policy;
}

function assertCommandMatchesPolicy(command) {
  const policy = assertPolicy(command.phase);
  if (typeof policy.terminalUprightCommit === "boolean") {
    assert(
      Boolean(command.terminalUprightCommit) === policy.terminalUprightCommit,
      `expected ${command.phase} terminalUprightCommit=${policy.terminalUprightCommit}, got ${command.terminalUprightCommit}`,
    );
  }
  if (typeof policy.siteTargetingEnabled === "boolean") {
    assert(
      Boolean(command.siteTargetingEnabled) === policy.siteTargetingEnabled,
      `expected ${command.phase} siteTargetingEnabled=${policy.siteTargetingEnabled}, got ${command.siteTargetingEnabled}`,
    );
  }
  if (typeof policy.qAlphaSteeringEnabled === "boolean") {
    assert(
      Boolean(command.qAlphaSteeringEnabled) === policy.qAlphaSteeringEnabled,
      `expected ${command.phase} qAlphaSteeringEnabled=${policy.qAlphaSteeringEnabled}, got ${command.qAlphaSteeringEnabled}`,
    );
  }
  if (Number.isFinite(Number(policy.minUpWeight))) {
    assert(
      Number(command.directionMix?.up) >= Number(policy.minUpWeight) - 1e-6,
      `expected ${command.phase} up weight >= ${policy.minUpWeight}, got ${command.directionMix?.up}`,
    );
  }
  if (Number.isFinite(Number(policy.minRetrogradeWeight))) {
    assert(
      Number(command.directionMix?.retrograde) >= Number(policy.minRetrogradeWeight) - 1e-6,
      `expected ${command.phase} retrograde weight >= ${policy.minRetrogradeWeight}, got ${command.directionMix?.retrograde}`,
    );
  }
}

function main() {
  assertPolicy("attached-stack");
  assertPolicy("catch-contact");
  assertPolicy("catch-capture");
  assertPolicy("caught");
  assertPolicy("landed");

  const separationFlip = computeBoosterRecoveryCommand({
    currentPhase: "separation-flip",
    altitudeKm: 72,
    radialSpeedKmS: 0.02,
    tangentialSpeedKmS: 1.45,
    launchSiteRangeKm: 90,
    launchSiteLateralRangeKm: 76,
    launchSiteLateralClosingSpeedKmS: -0.01,
    timeSinceSeparationSec: 2.4,
    remainingPropellantKg: 320_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 120,
    bodyRetrogradeAlignment: 0.28,
    bodyAntiTangentAlignment: 0.12,
    bodyUpAlignment: 0.64,
  });
  assert(separationFlip.phase === "separation-flip", `expected separation-flip, got ${separationFlip.phase}`);
  assertCommandMatchesPolicy(separationFlip);

  const separationCoast = computeBoosterRecoveryCommand({
    currentPhase: "separation-coast",
    altitudeKm: 70,
    radialSpeedKmS: -0.01,
    tangentialSpeedKmS: 1.25,
    launchSiteRangeKm: 82,
    launchSiteLateralRangeKm: 66,
    launchSiteLateralClosingSpeedKmS: 0.01,
    timeSinceSeparationSec: 2.4,
    remainingPropellantKg: 320_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 180,
    bodyRetrogradeAlignment: 0.92,
    bodyAntiTangentAlignment: 0.81,
    bodyUpAlignment: -0.08,
  });
  assert(separationCoast.phase === "separation-coast", `expected separation-coast, got ${separationCoast.phase}`);
  assertCommandMatchesPolicy(separationCoast);

  const boostback = computeBoosterRecoveryCommand({
    currentPhase: "boostback",
    altitudeKm: 68,
    radialSpeedKmS: 0.04,
    tangentialSpeedKmS: 1.9,
    launchSiteRangeKm: 112,
    launchSiteLateralRangeKm: 88,
    launchSiteLateralClosingSpeedKmS: -0.03,
    timeSinceSeparationSec: 22,
    remainingPropellantKg: 310_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 200,
    bodyRetrogradeAlignment: 0.78,
    bodyAntiTangentAlignment: 0.62,
    bodyUpAlignment: 0.12,
  });
  assert(boostback.phase === "boostback", `expected boostback, got ${boostback.phase}`);
  assertCommandMatchesPolicy(boostback);

  const highAltitudeDescentCoast = computeBoosterRecoveryCommand({
    currentPhase: "entry-align",
    altitudeKm: 86,
    radialSpeedKmS: -0.10,
    tangentialSpeedKmS: 0.42,
    launchSiteRangeKm: 12,
    launchSiteLateralRangeKm: 8,
    launchSiteLateralClosingSpeedKmS: 0.03,
    timeSinceSeparationSec: 118,
    remainingPropellantKg: 275_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 900,
    bodyRetrogradeAlignment: 0.62,
    bodyAntiTangentAlignment: 0.34,
    bodyUpAlignment: -0.18,
  });
  assert(highAltitudeDescentCoast.phase === "descent-coast", `expected descent-coast, got ${highAltitudeDescentCoast.phase}`);
  assertCommandMatchesPolicy(highAltitudeDescentCoast);

  const terminalIntercept = computeBoosterRecoveryCommand({
    currentPhase: "entry-align",
    altitudeKm: 36,
    radialSpeedKmS: -0.26,
    tangentialSpeedKmS: 0.84,
    launchSiteRangeKm: 18,
    launchSiteLateralRangeKm: 12,
    launchSiteLateralClosingSpeedKmS: 0.01,
    timeSinceSeparationSec: 160,
    remainingPropellantKg: 270_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 19_000,
    bodyUpAlignment: 0.62,
  });
  assert(terminalIntercept.phase === "terminal-intercept", `expected terminal-intercept, got ${terminalIntercept.phase}`);
  assertCommandMatchesPolicy(terminalIntercept);

  const descentCoast = computeBoosterRecoveryCommand({
    currentPhase: "entry-burn",
    altitudeKm: 14,
    radialSpeedKmS: -0.08,
    tangentialSpeedKmS: 0.20,
    launchSiteRangeKm: 3.2,
    launchSiteLateralRangeKm: 2.8,
    launchSiteLateralClosingSpeedKmS: 0.05,
    timeSinceSeparationSec: 310,
    remainingPropellantKg: 215_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 3_500,
    bodyUpAlignment: 0.84,
  });
  assert(
    descentCoast.phase === "descent-coast" || descentCoast.phase === "terminal-intercept",
    `expected late terminal phase, got ${descentCoast.phase}`,
  );
  assertCommandMatchesPolicy(descentCoast);

  const catchApproach = computeBoosterRecoveryCommand({
    currentPhase: "descent-coast",
    altitudeKm: 5.6,
    radialSpeedKmS: -0.06,
    tangentialSpeedKmS: 0.08,
    launchSiteRangeKm: 4.1,
    launchSiteLateralRangeKm: 3.1,
    launchSiteLateralClosingSpeedKmS: 0.08,
    catchTotalRangeKm: 4.0,
    catchLateralRangeKm: 3.0,
    catchVerticalErrorKm: 0.5,
    catchLateralSpeedKmS: 0.20,
    catchVerticalSpeedKmS: -0.10,
    catchApproachSpeedKmS: 0.24,
    catchEastErrorKm: 2.1,
    catchNorthErrorKm: 2.0,
    catchEastSpeedKmS: 0.12,
    catchNorthSpeedKmS: 0.10,
    catchClosingSpeedKmS: 0.05,
    towerRelativeActive: true,
    catchPositionSigmaKm: 0.010,
    catchVelocitySigmaKmS: 0.00008,
    timeSinceSeparationSec: 360,
    remainingPropellantKg: 202_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 1_600,
    bodyUpAlignment: 0.92,
  });
  assert(catchApproach.phase === "terminal-intercept", `expected terminal-intercept for loose tower corridor, got ${catchApproach.phase}`);
  assertCommandMatchesPolicy(catchApproach);

  const landingBrake = computeBoosterRecoveryCommand({
    currentPhase: "catch-approach",
    altitudeKm: 8.2,
    radialSpeedKmS: -1.24,
    tangentialSpeedKmS: 0.08,
    launchSiteRangeKm: 8.6,
    launchSiteLateralRangeKm: 2.2,
    launchSiteLateralClosingSpeedKmS: 0.42,
    catchTotalRangeKm: 8.4,
    catchLateralRangeKm: 2.1,
    catchVerticalErrorKm: 8.1,
    catchLateralSpeedKmS: 0.54,
    catchVerticalSpeedKmS: -1.24,
    catchApproachSpeedKmS: 1.35,
    catchEastErrorKm: 1.8,
    catchNorthErrorKm: 1.1,
    catchEastSpeedKmS: -0.48,
    catchNorthSpeedKmS: -0.20,
    catchClosingSpeedKmS: 0.03,
    towerRelativeActive: true,
    catchPositionSigmaKm: 0.004,
    catchVelocitySigmaKmS: 0.00004,
    timeSinceSeparationSec: 386,
    remainingPropellantKg: 198_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 600,
    bodyUpAlignment: 0.96,
  });
  assert(landingBrake.phase === "landing-burn", `expected 13-engine landing-burn brake before precision catch, got ${landingBrake.phase}`);
  assertCommandMatchesPolicy(landingBrake);

  const catchBurn = computeBoosterRecoveryCommand({
    currentPhase: "landing-burn",
    altitudeKm: 0.95,
    radialSpeedKmS: -0.025,
    tangentialSpeedKmS: 0.02,
    launchSiteRangeKm: 0.72,
    launchSiteLateralRangeKm: 0.26,
    launchSiteLateralClosingSpeedKmS: 0.018,
    catchTotalRangeKm: 0.70,
    catchLateralRangeKm: 0.24,
    catchVerticalErrorKm: 0.55,
    catchLateralSpeedKmS: 0.035,
    catchVerticalSpeedKmS: -0.025,
    catchApproachSpeedKmS: 0.045,
    catchEastErrorKm: 0.17,
    catchNorthErrorKm: 0.16,
    catchEastSpeedKmS: 0.020,
    catchNorthSpeedKmS: 0.018,
    catchClosingSpeedKmS: 0.025,
    towerRelativeActive: true,
    catchPositionSigmaKm: 0.004,
    catchVelocitySigmaKmS: 0.00004,
    timeSinceSeparationSec: 388,
    remainingPropellantKg: 197_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 540,
    bodyUpAlignment: 0.985,
  });
  assert(catchBurn.phase === "catch-burn", `expected catch-burn, got ${catchBurn.phase}`);
  assertCommandMatchesPolicy(catchBurn);

  const outsideCatchSolution = computeBoosterRecoveryCommand({
    currentPhase: "descent-coast",
    altitudeKm: 0.3,
    radialSpeedKmS: -0.04,
    tangentialSpeedKmS: 0.02,
    launchSiteRangeKm: 0.22,
    launchSiteLateralRangeKm: 0.15,
    launchSiteLateralClosingSpeedKmS: 0.02,
    timeSinceSeparationSec: 420,
    remainingPropellantKg: 180_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 400,
    bodyUpAlignment: 0.97,
  });
  assert(outsideCatchSolution.phase === "terminal-intercept", `expected terminal-intercept outside the physical catch solution, got ${outsideCatchSolution.phase}`);
  assertCommandMatchesPolicy(outsideCatchSolution);

  console.log("PASS booster-stage-attitude-policy-lock");
}

main();
