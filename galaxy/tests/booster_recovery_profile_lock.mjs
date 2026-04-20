import { computeBoosterRecoveryCommand } from "../app/static/js/physics/launch/boosterRecovery.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const separationFlip = computeBoosterRecoveryCommand({
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
  assert(separationFlip.siteVectorWeight === 0, `expected no separation-flip site vector weight, got ${separationFlip.siteVectorWeight}`);
  assert(separationFlip.siteVelocityWeight === 0, `expected no separation-flip site velocity weight, got ${separationFlip.siteVelocityWeight}`);

  const separationCoast = computeBoosterRecoveryCommand({
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
  assert(separationCoast.siteVectorWeight === 0, `expected no separation-coast site vector weight, got ${separationCoast.siteVectorWeight}`);
  assert(separationCoast.siteVelocityWeight === 0, `expected no separation-coast site velocity weight, got ${separationCoast.siteVelocityWeight}`);

  const postSeparationSettle = computeBoosterRecoveryCommand({
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
  assert(postSeparationSettle.phase === "separation-coast", `expected continued separation-coast while still climbing, got ${postSeparationSettle.phase}`);

  const boostback = computeBoosterRecoveryCommand({
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
  });
  assert(boostback.phase === "boostback", `expected boostback, got ${boostback.phase}`);
  assert(boostback.throttle >= 0.34, `expected meaningful boostback throttle, got ${boostback.throttle}`);

  const entryBurn = computeBoosterRecoveryCommand({
    altitudeKm: 42,
    radialSpeedKmS: -0.26,
    tangentialSpeedKmS: 0.84,
    launchSiteRangeKm: 18,
    launchSiteLateralRangeKm: 12,
    launchSiteLateralClosingSpeedKmS: 0.01,
    timeSinceSeparationSec: 160,
    remainingPropellantKg: 270_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 19_000,
  });
  assert(entryBurn.phase === "entry-burn", `expected entry-burn, got ${entryBurn.phase}`);
  assert(entryBurn.throttle >= 0.30, `expected strong entry-burn throttle, got ${entryBurn.throttle}`);
  assert(entryBurn.attitudeControlMode === "grid-fins+engines", `expected grid-fins+engines control, got ${entryBurn.attitudeControlMode}`);
  assert(entryBurn.aeroAuthority > 0.45, `expected strong grid-fin authority in entry burn, got ${entryBurn.aeroAuthority}`);

  const descentCoast = computeBoosterRecoveryCommand({
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
  });
  assert(descentCoast.phase === "descent-coast", `expected descent-coast, got ${descentCoast.phase}`);
  assert(descentCoast.throttle === 0, `expected descent coast throttle 0, got ${descentCoast.throttle}`);
  assert(descentCoast.attitudeControlMode === "grid-fins", `expected grid-fin-only control, got ${descentCoast.attitudeControlMode}`);
  assert(descentCoast.aeroAuthority > 0.05, `expected nonzero grid-fin authority in descent coast, got ${descentCoast.aeroAuthority}`);

  const landingBurn = computeBoosterRecoveryCommand({
    altitudeKm: 3,
    radialSpeedKmS: -0.52,
    tangentialSpeedKmS: 0.05,
    launchSiteRangeKm: 0.9,
    launchSiteLateralRangeKm: 0.6,
    launchSiteLateralClosingSpeedKmS: 0.02,
    timeSinceSeparationSec: 345,
    remainingPropellantKg: 205_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 1_200,
  });
  assert(landingBurn.phase === "landing-burn", `expected landing-burn, got ${landingBurn.phase}`);
  assert(landingBurn.throttle > 0.3, `expected positive landing burn throttle, got ${landingBurn.throttle}`);
  assert(landingBurn.attitudeControlMode === "engines", `expected engine-led landing control, got ${landingBurn.attitudeControlMode}`);

  console.log("PASS booster-recovery-profile-lock");
}

main();
