import { computeBoosterRecoveryCommand } from "../app/static/js/physics/launch/boosterRecovery.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const thinEntryAlign = computeBoosterRecoveryCommand({
    currentPhase: "entry-align",
    altitudeKm: 86,
    radialSpeedKmS: -0.10,
    tangentialSpeedKmS: 0.42,
    launchSiteRangeKm: 12,
    launchSiteLateralRangeKm: 8,
    launchSiteLateralClosingSpeedKmS: 0.03,
    catchTotalRangeKm: 11,
    catchLateralRangeKm: 7,
    catchLateralSpeedKmS: 0.05,
    timeSinceSeparationSec: 118,
    remainingPropellantKg: 275_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 900,
    bodyRetrogradeAlignment: 0.62,
    bodyAntiTangentAlignment: 0.34,
    bodyUpAlignment: -0.18,
  });
  assert(thinEntryAlign.phase === "entry-align", `expected entry-align, got ${thinEntryAlign.phase}`);
  assert(thinEntryAlign.siteTargetingEnabled === false, "expected thin-air entry align to avoid site targeting");

  const ballisticGuidance = computeBoosterRecoveryCommand({
    currentPhase: "entry-burn",
    altitudeKm: 52,
    radialSpeedKmS: -0.06,
    tangentialSpeedKmS: 0.32,
    launchSiteRangeKm: 12,
    launchSiteLateralRangeKm: 7,
    launchSiteLateralClosingSpeedKmS: 0.00,
    catchTotalRangeKm: 11,
    catchLateralRangeKm: 6,
    catchLateralSpeedKmS: 0.06,
    timeSinceSeparationSec: 170,
    remainingPropellantKg: 262_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 9_500,
    bodyRetrogradeAlignment: 0.78,
    bodyAntiTangentAlignment: 0.42,
    bodyUpAlignment: -0.12,
  });
  assert(ballisticGuidance.phase === "ballistic-descent", `expected ballistic-descent, got ${ballisticGuidance.phase}`);
  assert(ballisticGuidance.siteTargetingEnabled === true, "expected ballistic descent to use aerodynamic site targeting");
  assert(ballisticGuidance.siteVectorWeight >= 0.23, `expected meaningful ballistic site-vector weight, got ${ballisticGuidance.siteVectorWeight}`);
  assert(ballisticGuidance.siteVelocityWeight >= 0.14, `expected meaningful ballistic site-velocity weight, got ${ballisticGuidance.siteVelocityWeight}`);

  const entryBurn = computeBoosterRecoveryCommand({
    currentPhase: "entry-align",
    altitudeKm: 42,
    radialSpeedKmS: -0.26,
    tangentialSpeedKmS: 0.84,
    launchSiteRangeKm: 18,
    launchSiteLateralRangeKm: 12,
    launchSiteLateralClosingSpeedKmS: 0.01,
    catchTotalRangeKm: 15,
    catchLateralRangeKm: 10,
    catchLateralSpeedKmS: 0.08,
    timeSinceSeparationSec: 160,
    remainingPropellantKg: 270_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 19_000,
  });
  assert(entryBurn.phase === "entry-burn", `expected entry-burn, got ${entryBurn.phase}`);
  assert(entryBurn.siteTargetingEnabled === true, "expected entry-burn to keep aerodynamic site targeting active");

  const descentCoast = computeBoosterRecoveryCommand({
    currentPhase: "entry-burn",
    altitudeKm: 14,
    radialSpeedKmS: -0.08,
    tangentialSpeedKmS: 0.20,
    launchSiteRangeKm: 3.2,
    launchSiteLateralRangeKm: 2.8,
    launchSiteLateralClosingSpeedKmS: 0.05,
    catchTotalRangeKm: 2.7,
    catchLateralRangeKm: 2.3,
    catchLateralSpeedKmS: 0.06,
    timeSinceSeparationSec: 310,
    remainingPropellantKg: 215_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 3_500,
  });
  assert(descentCoast.phase === "descent-coast", `expected descent-coast, got ${descentCoast.phase}`);
  assert(descentCoast.siteTargetingEnabled === true, "expected descent-coast to stay site-targeted under grid-fin control");
  assert(
    descentCoast.siteVectorWeight >= 0.22 && descentCoast.siteVectorWeight < entryBurn.siteVectorWeight,
    `expected descent-coast to keep meaningful but reduced site-vector weighting under predictive corridor guidance, got ${descentCoast.siteVectorWeight} vs ${entryBurn.siteVectorWeight}`,
  );
  assert(
    descentCoast.siteVelocityWeight >= 0.14,
    `expected descent-coast to keep meaningful fin-driven site velocity correction, got ${descentCoast.siteVelocityWeight}`,
  );

  console.log("PASS booster-entry-crossrange-guidance-lock");
}

main();
