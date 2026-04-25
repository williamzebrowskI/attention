import {
  LAUNCH_PAD_DECK_HEIGHT_KM,
} from "../app/static/js/physics/launch/launchConfig.js";
import {
  BOOSTER_CATCH_BASE_CLEARANCE_KM,
  BOOSTER_CATCH_GEOMETRY_KM,
  BOOSTER_CHOPSTICK_CATCH_HEIGHT_ABOVE_BASE_KM,
  BOOSTER_CATCH_PIN_HEIGHT_ABOVE_BASE_KM,
  computeBoosterCatchPinHeightErrorKm,
} from "../app/static/js/physics/launch/launchSiteCatchGeometry.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  assert(
    BOOSTER_CATCH_BASE_CLEARANCE_KM > 0,
    `expected positive catch clearance, got ${BOOSTER_CATCH_BASE_CLEARANCE_KM}`,
  );
  assert(
    BOOSTER_CATCH_BASE_CLEARANCE_KM > LAUNCH_PAD_DECK_HEIGHT_KM,
    `expected caught booster base to hang above the launch mount deck, got ${BOOSTER_CATCH_BASE_CLEARANCE_KM}`,
  );
  assert(
    BOOSTER_CHOPSTICK_CATCH_HEIGHT_ABOVE_BASE_KM > BOOSTER_CATCH_PIN_HEIGHT_ABOVE_BASE_KM,
    "expected chopsticks to sit above the raw booster pin height",
  );
  const alignedErrorKm = computeBoosterCatchPinHeightErrorKm(BOOSTER_CATCH_BASE_CLEARANCE_KM);
  assert(
    Math.abs(alignedErrorKm) <= 1e-9,
    `expected catch pin height error to cancel at modeled clearance, got ${alignedErrorKm}`,
  );
  assert(
    BOOSTER_CATCH_GEOMETRY_KM.finalizePinHeightToleranceKm < BOOSTER_CATCH_BASE_CLEARANCE_KM,
    "expected pin-height tolerance to stay tighter than full catch clearance",
  );

  console.log("PASS launch-site-catch-geometry-lock");
}

main();
