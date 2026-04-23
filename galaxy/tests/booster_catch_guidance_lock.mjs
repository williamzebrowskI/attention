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
    catchTotalRangeKm: 0.08,
    catchLateralRangeKm: 0.035,
    catchVerticalErrorKm: 0.012,
    catchLateralSpeedKmS: 0.022,
    catchVerticalSpeedKmS: -0.028,
    catchApproachSpeedKmS: 0.036,
    towerRelativeActive: true,
    catchPositionSigmaKm: 0.003,
    catchVelocitySigmaKmS: 0.00004,
  });
  assert(catchCommand, "expected near-pad terminal guidance to enter catch burn");
  assert(catchCommand.phase === "catch-burn", `expected catch-burn phase, got ${catchCommand?.phase}`);
  assert(catchCommand.guidanceMode === "booster-catch-burn", `expected booster-catch-burn mode, got ${catchCommand?.guidanceMode}`);
  assert(Number(catchCommand.throttle) > 0.18, `expected positive catch throttle, got ${catchCommand?.throttle}`);
  assert(catchCommand.attitudeControlMode === "engines+rcs", `expected engines+rcs catch burn, got ${catchCommand?.attitudeControlMode}`);
  assert(catchCommand.captureLike === true, "expected terminal catch command to stay catch-like");
  assert(catchCommand.siteTargetingEnabled === false, "expected predictive catch guidance to bypass generic site targeting");
  assert(catchCommand.predictiveCatchControl?.enabled === true, "expected predictive catch control to be active");
  assert(catchCommand.predictiveCatchControl?.translationOnly === true, "expected catch burn translation to stay off the main thrust vector");
  assert(catchCommand.terminalUprightCommit === true, "expected catch burn to commit to upright attitude");
  assert(catchCommand.predictiveCatchControl?.blend >= 0.82, `expected strong terminal catch blend, got ${catchCommand.predictiveCatchControl?.blend}`);

  const catchApproach = resolveBoosterCatchCommand({
    altitudeKm: 5.6,
    radialSpeedKmS: -0.06,
    tangentialSpeedKmS: 0.08,
    launchSiteRangeKm: 4.1,
    launchSiteLateralRangeKm: 3.1,
    catchTotalRangeKm: 4.0,
    catchLateralRangeKm: 3.0,
    catchVerticalErrorKm: 0.5,
    catchLateralSpeedKmS: 0.20,
    catchVerticalSpeedKmS: -0.10,
    catchApproachSpeedKmS: 0.24,
    towerRelativeActive: true,
    catchPositionSigmaKm: 0.006,
    catchVelocitySigmaKmS: 0.00008,
    bodyUpAlignment: 0.82,
  });
  assert(catchApproach, "expected tower-relative corridor to enter catch approach");
  assert(catchApproach.phase === "catch-approach", `expected catch-approach phase, got ${catchApproach?.phase}`);
  assert(catchApproach.guidanceMode === "booster-catch-approach", `expected booster-catch-approach mode, got ${catchApproach?.guidanceMode}`);
  assert(catchApproach.throttle === 0, `expected catch-approach to avoid main-thrust positioning, got ${catchApproach?.throttle}`);
  assert(catchApproach.attitudeControlMode === "grid-fins+rcs", `expected grid-fins+rcs catch approach, got ${catchApproach?.attitudeControlMode}`);
  assert(catchApproach.siteTargetingEnabled === false, "expected catch approach to bypass generic site targeting");
  assert(catchApproach.predictiveCatchControl?.enabled === true, "expected predictive catch approach control");
  assert(catchApproach.predictiveCatchControl?.translationOnly === true, "expected catch approach translation-only predictive control");
  assert(catchApproach.terminalUprightCommit === true, "expected catch approach to commit upright");
  assert(
    catchApproach.predictiveCatchControl?.predictedLateralMissKm <= 3.1,
    `expected bounded predictive lateral miss, got ${catchApproach.predictiveCatchControl?.predictedLateralMissKm}`,
  );
  assert(
    Number.isFinite(catchApproach.predictiveCatchControl?.interceptTimeSec),
    "expected finite predictive intercept time",
  );

  const noCatchCommand = resolveBoosterCatchCommand({
    altitudeKm: 6.8,
    radialSpeedKmS: -0.04,
    tangentialSpeedKmS: 0.03,
    launchSiteRangeKm: 0.09,
    launchSiteLateralRangeKm: 0.04,
    towerRelativeActive: true,
    catchPositionSigmaKm: 0.003,
    catchVelocitySigmaKmS: 0.00004,
  });
  assert(!noCatchCommand, "expected high-altitude descent to stay out of catch mode");

  const noTowerRelativeCatch = resolveBoosterCatchCommand({
    altitudeKm: 0.32,
    radialSpeedKmS: -0.04,
    tangentialSpeedKmS: 0.03,
    launchSiteRangeKm: 0.09,
    launchSiteLateralRangeKm: 0.04,
    catchTotalRangeKm: 0.08,
    catchLateralRangeKm: 0.035,
    catchVerticalErrorKm: 0.012,
    catchLateralSpeedKmS: 0.022,
    catchVerticalSpeedKmS: -0.028,
    catchApproachSpeedKmS: 0.036,
    towerRelativeActive: false,
    catchPositionSigmaKm: 0.003,
    catchVelocitySigmaKmS: 0.00004,
  });
  assert(!noTowerRelativeCatch, "expected terminal catch mode to require tower-relative navigation");

  const noCatchLooseCorridor = resolveBoosterCatchCommand({
    altitudeKm: 4.2,
    radialSpeedKmS: -0.04,
    tangentialSpeedKmS: 0.09,
    launchSiteRangeKm: 12.0,
    launchSiteLateralRangeKm: 9.5,
    catchTotalRangeKm: 12.0,
    catchLateralRangeKm: 9.5,
    catchVerticalErrorKm: 0.4,
    catchLateralSpeedKmS: 1.15,
    catchVerticalSpeedKmS: -0.05,
    catchApproachSpeedKmS: 1.16,
    towerRelativeActive: true,
    catchPositionSigmaKm: 0.003,
    catchVelocitySigmaKmS: 0.00004,
  });
  assert(!noCatchLooseCorridor, "expected loose tower-relative corridor to stay out of catch mode");

  const noCatchPoorUprightAlignment = resolveBoosterCatchCommand({
    altitudeKm: 0.85,
    radialSpeedKmS: -0.03,
    tangentialSpeedKmS: 0.04,
    launchSiteRangeKm: 0.22,
    launchSiteLateralRangeKm: 0.12,
    catchTotalRangeKm: 0.18,
    catchLateralRangeKm: 0.09,
    catchVerticalErrorKm: 0.03,
    catchLateralSpeedKmS: 0.03,
    catchVerticalSpeedKmS: -0.025,
    catchApproachSpeedKmS: 0.039,
    towerRelativeActive: true,
    catchPositionSigmaKm: 0.004,
    catchVelocitySigmaKmS: 0.00005,
    bodyUpAlignment: -0.15,
  });
  assert(!noCatchPoorUprightAlignment, "expected catch guidance to stay disarmed when the booster is still too far from upright");

  const finalizeCatch = shouldFinalizeBoosterCatch({
    guidanceMode: "booster-catch-burn",
    launchSiteLateralRangeKm: 0.02,
    catchPinHeightErrorKm: 0.001,
    speedKmS: 0.02,
    radialSpeedKmS: -0.01,
    catchHoldSec: 0.6,
  });
  assert(finalizeCatch, "expected aligned low-speed booster to finalize as caught");

  const noFinalizeCatch = shouldFinalizeBoosterCatch({
    guidanceMode: "booster-landing-burn",
    launchSiteLateralRangeKm: 0.02,
    catchPinHeightErrorKm: BOOSTER_CATCH_BASE_CLEARANCE_KM,
    speedKmS: 0.02,
    radialSpeedKmS: -0.01,
    catchHoldSec: 0.6,
  });
  assert(!noFinalizeCatch, "expected non-catch guidance to avoid catch finalization");

  const noFinalizeShortHold = shouldFinalizeBoosterCatch({
    guidanceMode: "booster-catch-burn",
    launchSiteLateralRangeKm: 0.01,
    catchPinHeightErrorKm: 0.001,
    speedKmS: 0.015,
    radialSpeedKmS: -0.008,
    catchHoldSec: 0.1,
  });
  assert(!noFinalizeShortHold, "expected short catch hold to avoid early catch finalization");

  const finalizeCatchFromVerticalError = shouldFinalizeBoosterCatch({
    guidanceMode: "booster-catch-burn",
    launchSiteLateralRangeKm: 0.012,
    catchVerticalErrorKm: 0.0015,
    speedKmS: 0.018,
    radialSpeedKmS: -0.009,
    catchHoldSec: 0.7,
  });
  assert(finalizeCatchFromVerticalError, "expected tower-relative vertical error fallback to finalize catch");

  console.log("PASS booster-catch-guidance-lock");
}

main();
