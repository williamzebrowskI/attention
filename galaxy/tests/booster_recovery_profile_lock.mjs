import { computeBoosterRecoveryCommand } from "../app/static/js/physics/launch/boosterRecovery.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
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
  assert(separationFlip.siteTargetingEnabled === false, "expected separation-flip to suppress pad-target steering");
  assert(separationFlip.qAlphaSteeringEnabled === false, "expected separation-flip to bypass q-alpha steering");

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
  assert(separationCoast.siteTargetingEnabled === false, "expected separation-coast to suppress pad-target steering");
  assert(separationCoast.qAlphaSteeringEnabled === false, "expected separation-coast to bypass q-alpha steering");

  const earlyBoostback = computeBoosterRecoveryCommand({
    currentPhase: "separation-coast",
    altitudeKm: 71,
    radialSpeedKmS: 0.08,
    tangentialSpeedKmS: 1.52,
    launchSiteRangeKm: 98,
    launchSiteLateralRangeKm: 81,
    launchSiteLateralClosingSpeedKmS: -0.02,
    timeSinceSeparationSec: 5.4,
    remainingPropellantKg: 320_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 260,
    bodyRetrogradeAlignment: 0.54,
    bodyAntiTangentAlignment: 0.36,
    bodyUpAlignment: 0.08,
  });
  assert(earlyBoostback.phase === "boostback", `expected early post-separation boostback, got ${earlyBoostback.phase}`);
  assert(earlyBoostback.throttle >= 0.38, `expected early boostback throttle, got ${earlyBoostback.throttle}`);

  const postSeparationIgnition = computeBoosterRecoveryCommand({
    currentPhase: "separation-flip",
    altitudeKm: 73,
    radialSpeedKmS: 0.04,
    tangentialSpeedKmS: 0.92,
    launchSiteRangeKm: 64,
    launchSiteLateralRangeKm: 50,
    launchSiteLateralClosingSpeedKmS: 0.00,
    timeSinceSeparationSec: 10.5,
    remainingPropellantKg: 320_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 800,
    bodyRetrogradeAlignment: 0.78,
    bodyAntiTangentAlignment: 0.62,
    bodyUpAlignment: 0.22,
  });
  assert(postSeparationIgnition.phase === "boostback", `expected boostback once the flip has settled enough for ignition, got ${postSeparationIgnition.phase}`);
  assert(postSeparationIgnition.throttle >= 0.38, `expected meaningful post-separation ignition throttle, got ${postSeparationIgnition.throttle}`);

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
  assert(boostback.throttle >= 0.34, `expected meaningful boostback throttle, got ${boostback.throttle}`);

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
  assert(highAltitudeDescentCoast.phase === "entry-align", `expected entry-align, got ${highAltitudeDescentCoast.phase}`);
  assert(highAltitudeDescentCoast.throttle === 0, `expected entry-align throttle 0, got ${highAltitudeDescentCoast.throttle}`);
  assert(highAltitudeDescentCoast.siteTargetingEnabled === false, "expected thin-air entry alignment to suppress site targeting until grid-fin authority builds");

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
  assert(terminalIntercept.throttle === 0, `expected terminal-intercept throttle 0, got ${terminalIntercept.throttle}`);
  assert(terminalIntercept.attitudeControlMode === "grid-fins+rcs", `expected grid-fins+rcs terminal control, got ${terminalIntercept.attitudeControlMode}`);
  assert(terminalIntercept.aeroAuthority > 0.45, `expected strong grid-fin authority in terminal intercept, got ${terminalIntercept.aeroAuthority}`);

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
    `expected unpowered descent/terminal phase, got ${descentCoast.phase}`,
  );
  assert(descentCoast.throttle === 0, `expected descent/terminal throttle 0, got ${descentCoast.throttle}`);
  assert(descentCoast.attitudeControlMode === "grid-fins+rcs", `expected grid-fins+rcs control, got ${descentCoast.attitudeControlMode}`);
  assert(descentCoast.aeroAuthority > 0.05, `expected nonzero grid-fin authority in descent coast, got ${descentCoast.aeroAuthority}`);

  const terminalCatchApproach = computeBoosterRecoveryCommand({
    currentPhase: "descent-coast",
    altitudeKm: 15.8,
    radialSpeedKmS: -0.12,
    tangentialSpeedKmS: 0.34,
    launchSiteRangeKm: 18.5,
    launchSiteLateralRangeKm: 10.4,
    launchSiteLateralClosingSpeedKmS: 0.08,
    catchTotalRangeKm: 16.7,
    catchLateralRangeKm: 10.0,
    catchVerticalErrorKm: 14.9,
    catchLateralSpeedKmS: 0.42,
    catchVerticalSpeedKmS: -0.12,
    catchApproachSpeedKmS: 0.44,
    catchEastErrorKm: 7.1,
    catchNorthErrorKm: 7.0,
    catchEastSpeedKmS: 0.28,
    catchNorthSpeedKmS: 0.24,
    catchClosingSpeedKmS: 0.09,
    towerRelativeActive: true,
    catchPositionSigmaKm: 0.010,
    catchVelocitySigmaKmS: 0.00008,
    timeSinceSeparationSec: 360,
    remainingPropellantKg: 202_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 6_200,
    bodyUpAlignment: 0.76,
  });
  assert(terminalCatchApproach.phase === "terminal-intercept", `expected terminal-intercept before the physical catch box, got ${terminalCatchApproach.phase}`);
  assert(terminalCatchApproach.guidanceMode === "booster-terminal-intercept", `expected booster-terminal-intercept mode, got ${terminalCatchApproach.guidanceMode}`);
  assert(terminalCatchApproach.attitudeControlMode === "grid-fins+rcs", `expected unpowered grid-fins+rcs terminal intercept control, got ${terminalCatchApproach.attitudeControlMode}`);
  assert(terminalCatchApproach.siteTargetingEnabled === false, "expected terminal intercept to use the tower-relative catch frame instead of pad site targeting");
  assert(terminalCatchApproach.qAlphaSteeringEnabled === false, "expected terminal intercept to bypass q-alpha throttle suppression");
  assert(terminalCatchApproach.predictiveCatchControl?.enabled === true, "expected predictive catch control in terminal catch approach");
  assert(terminalCatchApproach.predictiveCatchControl?.translationAuthority > 0, "expected terminal intercept to steer physical attitude/aero, not fake translate");

  const earlyTowerCorridorTranslation = computeBoosterRecoveryCommand({
    currentPhase: "descent-coast",
    altitudeKm: 64,
    radialSpeedKmS: -0.22,
    tangentialSpeedKmS: 0.36,
    launchSiteRangeKm: 12,
    launchSiteLateralRangeKm: 8,
    launchSiteLateralClosingSpeedKmS: 0.05,
    catchTotalRangeKm: 12.8,
    catchLateralRangeKm: 9.5,
    catchVerticalErrorKm: 63.9,
    catchLateralSpeedKmS: 0.20,
    catchVerticalSpeedKmS: -0.22,
    catchApproachSpeedKmS: 0.30,
    catchEastErrorKm: 8.1,
    catchNorthErrorKm: 5.0,
    catchEastSpeedKmS: 0.15,
    catchNorthSpeedKmS: 0.12,
    catchClosingSpeedKmS: 0.08,
    towerRelativeActive: true,
    catchPositionSigmaKm: 0.006,
    catchVelocitySigmaKmS: 0.00008,
    timeSinceSeparationSec: 260,
    remainingPropellantKg: 230_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 9_000,
    bodyUpAlignment: 0.88,
  });
  assert(earlyTowerCorridorTranslation.phase === "descent-coast", `expected early tower corridor to stay in unpowered descent, got ${earlyTowerCorridorTranslation.phase}`);
  assert(earlyTowerCorridorTranslation.predictiveCatchControl?.enabled === true, "expected early tower corridor predictive control");
  assert(earlyTowerCorridorTranslation.predictiveCatchControl?.interceptTimeSec <= 16, `expected earlier lateral intercept deadline, got ${earlyTowerCorridorTranslation.predictiveCatchControl?.interceptTimeSec}`);
  assert(earlyTowerCorridorTranslation.predictiveCatchControl?.translationAuthority >= 0.62, `expected strong early lateral translation authority, got ${earlyTowerCorridorTranslation.predictiveCatchControl?.translationAuthority}`);
  assert(
    Math.hypot(
      earlyTowerCorridorTranslation.predictiveCatchControl?.desiredEastSpeedKmS || 0,
      earlyTowerCorridorTranslation.predictiveCatchControl?.desiredNorthSpeedKmS || 0,
    ) >= 0.35,
    "expected early tower corridor to command meaningful lateral closing speed",
  );
  assert(
    Number(earlyTowerCorridorTranslation.predictiveCatchControl?.localDirection?.up) <= 0.10,
    `expected early corridor steering to favor lateral translation, got up=${earlyTowerCorridorTranslation.predictiveCatchControl?.localDirection?.up}`,
  );

  const towerCorridorDescent = computeBoosterRecoveryCommand({
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
    catchPositionSigmaKm: 0.006,
    catchVelocitySigmaKmS: 0.00008,
    timeSinceSeparationSec: 332,
    remainingPropellantKg: 210_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 2_400,
    bodyUpAlignment: 0.82,
  });
  assert(towerCorridorDescent.phase === "terminal-intercept", `expected physical terminal intercept outside the catch box, got ${towerCorridorDescent.phase}`);
  assert(towerCorridorDescent.siteTargetingEnabled === false, "expected terminal intercept to use the tower-relative catch frame instead of pad site targeting");
  assert(towerCorridorDescent.predictiveCatchControl?.enabled === true, "expected predictive catch control in tower corridor");
  assert(towerCorridorDescent.attitudeControlMode === "grid-fins+rcs", `expected unpowered grid-fins+rcs terminal intercept, got ${towerCorridorDescent.attitudeControlMode}`);
  assert(towerCorridorDescent.terminalUprightCommit === true, "expected tower-corridor catch approach to commit upright");

  const lateralLandingBurn = computeBoosterRecoveryCommand({
    currentPhase: "landing-burn",
    altitudeKm: 5.2,
    radialSpeedKmS: -0.32,
    tangentialSpeedKmS: 0.05,
    launchSiteRangeKm: 3.4,
    launchSiteLateralRangeKm: 3.0,
    launchSiteLateralClosingSpeedKmS: 0.10,
    catchTotalRangeKm: 4.7,
    catchLateralRangeKm: 3.4,
    catchVerticalErrorKm: 5.1,
    catchLateralSpeedKmS: 0.12,
    catchVerticalSpeedKmS: -0.30,
    catchApproachSpeedKmS: 0.33,
    catchEastErrorKm: 2.9,
    catchNorthErrorKm: 1.8,
    catchEastSpeedKmS: -0.05,
    catchNorthSpeedKmS: -0.02,
    catchClosingSpeedKmS: 0.02,
    towerRelativeActive: true,
    catchPositionSigmaKm: 0.004,
    catchVelocitySigmaKmS: 0.00004,
    timeSinceSeparationSec: 386,
    remainingPropellantKg: 198_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 700,
    bodyUpAlignment: 0.96,
  });
  assert(lateralLandingBurn.phase === "landing-burn", `expected landing burn while still outside the lateral catch box, got ${lateralLandingBurn.phase}`);
  assert(lateralLandingBurn.throttle >= 0.70, `expected landing burn to preserve vertical braking throttle, got ${lateralLandingBurn.throttle}`);
  assert(lateralLandingBurn.predictiveCatchControl?.translationAuthority >= 0.84, `expected landing burn lateral translation authority, got ${lateralLandingBurn.predictiveCatchControl?.translationAuthority}`);
  assert(
    Number(lateralLandingBurn.predictiveCatchControl?.localDirection?.up) <= 0.72,
    `expected landing burn to leave lateral steering room, got up=${lateralLandingBurn.predictiveCatchControl?.localDirection?.up}`,
  );

  const landingBurn = computeBoosterRecoveryCommand({
    currentPhase: "descent-coast",
    altitudeKm: 0.4,
    radialSpeedKmS: -0.18,
    tangentialSpeedKmS: 0.02,
    launchSiteRangeKm: 0.08,
    launchSiteLateralRangeKm: 0.05,
    launchSiteLateralClosingSpeedKmS: 0.008,
    timeSinceSeparationSec: 345,
    remainingPropellantKg: 205_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 500,
    bodyUpAlignment: 0.97,
  });
  assert(landingBurn.phase === "terminal-intercept", `expected terminal-intercept outside the physical catch solution, got ${landingBurn.phase}`);
  assert(landingBurn.throttle === 0, `expected no pad-fake landing throttle outside the catch solution, got ${landingBurn.throttle}`);
  assert(landingBurn.attitudeControlMode === "grid-fins+rcs", `expected grid-fins+rcs terminal control, got ${landingBurn.attitudeControlMode}`);

  console.log("PASS booster-recovery-profile-lock");
}

main();
