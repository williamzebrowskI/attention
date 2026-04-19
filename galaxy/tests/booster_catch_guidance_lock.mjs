import {
  resolveBoosterCatchCommand,
  shouldFinalizeBoosterCatch,
} from "../app/static/js/physics/launch/boosterCatchGuidance.js";
import { BOOSTER_CATCH_BASE_CLEARANCE_KM } from "../app/static/js/physics/launch/launchSiteCatchGeometry.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const catchCommand = resolveBoosterCatchCommand({
    altitudeKm: 0.32,
    radialSpeedKmS: -0.04,
    tangentialSpeedKmS: 0.03,
    launchSiteRangeKm: 0.09,
    launchSiteLateralRangeKm: 0.04,
  });
  assert(catchCommand, "expected near-pad terminal guidance to enter catch burn");
  assert(catchCommand.phase === "catch-burn", `expected catch-burn phase, got ${catchCommand?.phase}`);
  assert(catchCommand.guidanceMode === "booster-catch-burn", `expected booster-catch-burn mode, got ${catchCommand?.guidanceMode}`);
  assert(Number(catchCommand.throttle) > 0.18, `expected positive catch throttle, got ${catchCommand?.throttle}`);

  const noCatchCommand = resolveBoosterCatchCommand({
    altitudeKm: 3.2,
    radialSpeedKmS: -0.04,
    tangentialSpeedKmS: 0.03,
    launchSiteRangeKm: 0.09,
    launchSiteLateralRangeKm: 0.04,
  });
  assert(!noCatchCommand, "expected high-altitude descent to stay out of catch mode");

  const finalizeCatch = shouldFinalizeBoosterCatch({
    guidanceMode: "booster-catch-burn",
    launchSiteLateralRangeKm: 0.02,
    catchPinHeightErrorKm: 0.001,
    speedKmS: 0.02,
    radialSpeedKmS: -0.01,
  });
  assert(finalizeCatch, "expected aligned low-speed booster to finalize as caught");

  const noFinalizeCatch = shouldFinalizeBoosterCatch({
    guidanceMode: "booster-landing-burn",
    launchSiteLateralRangeKm: 0.02,
    catchPinHeightErrorKm: BOOSTER_CATCH_BASE_CLEARANCE_KM,
    speedKmS: 0.02,
    radialSpeedKmS: -0.01,
  });
  assert(!noFinalizeCatch, "expected non-catch guidance to avoid catch finalization");

  console.log("PASS booster-catch-guidance-lock");
}

main();
