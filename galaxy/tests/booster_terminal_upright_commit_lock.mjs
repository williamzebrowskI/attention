import { computeBoosterRecoveryCommand } from "../app/static/js/physics/launch/boosterRecovery.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const sharedInput = {
    currentPhase: "descent-coast",
    altitudeKm: 3.8,
    radialSpeedKmS: -0.18,
    tangentialSpeedKmS: 0.04,
    launchSiteRangeKm: 0.82,
    launchSiteLateralRangeKm: 0.54,
    launchSiteLateralClosingSpeedKmS: 0.02,
    timeSinceSeparationSec: 338,
    remainingPropellantKg: 206_000,
    reserveLandingPropellantKg: 160_000,
    dynamicPressurePa: 1_600,
  };

  const alignedTerminalDescent = computeBoosterRecoveryCommand({
    ...sharedInput,
    bodyUpAlignment: 0.92,
  });
  assert(
    alignedTerminalDescent.phase === "descent-coast",
    `expected aligned late descent to stay in descent-coast, got ${alignedTerminalDescent.phase}`,
  );
  assert(
    alignedTerminalDescent.attitudeControlMode === "grid-fins+rcs",
    `expected aligned late descent to stay aero+rcs controlled, got ${alignedTerminalDescent.attitudeControlMode}`,
  );
  assert(
    alignedTerminalDescent.terminalUprightCommit === true,
    "expected aligned late descent to keep upright commitment active",
  );

  const misalignedTerminalDescent = computeBoosterRecoveryCommand({
    ...sharedInput,
    bodyUpAlignment: 0.34,
  });
  assert(
    misalignedTerminalDescent.phase === "landing-burn",
    `expected poor body-up alignment to trigger an earlier landing burn, got ${misalignedTerminalDescent.phase}`,
  );
  assert(
    misalignedTerminalDescent.attitudeControlMode === "engines+rcs",
    `expected poor body-up alignment to promote engines+rcs terminal control, got ${misalignedTerminalDescent.attitudeControlMode}`,
  );
  assert(
    misalignedTerminalDescent.terminalUprightCommit === true,
    "expected misaligned terminal descent to stay hard-committed upright",
  );
  assert(
    Number(misalignedTerminalDescent.uprightTiltLimitDeg) <= 4,
    `expected tight terminal upright tilt limit, got ${misalignedTerminalDescent.uprightTiltLimitDeg}`,
  );
  assert(
    Number(misalignedTerminalDescent.attitudeResponseScale) > Number(alignedTerminalDescent.attitudeResponseScale),
    "expected misaligned terminal descent to command stronger attitude response than an already-upright descent",
  );

  console.log("PASS booster-terminal-upright-commit-lock");
}

main();
