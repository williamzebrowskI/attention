import { computeBoosterRecoveryCommand } from "../app/static/js/physics/launch/boosterRecovery.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
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

  console.log("PASS booster-recovery-profile-lock");
}

main();
