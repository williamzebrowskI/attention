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
    alignedTerminalDescent.phase === "terminal-intercept",
    `expected aligned late descent to enter terminal-intercept, got ${alignedTerminalDescent.phase}`,
  );
  assert(
    alignedTerminalDescent.attitudeControlMode === "grid-fins+rcs",
    `expected aligned late descent to stay unpowered on grid-fins+rcs terminal control, got ${alignedTerminalDescent.attitudeControlMode}`,
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
    misalignedTerminalDescent.phase === "terminal-intercept",
    `expected poor body-up alignment to stay in terminal-intercept, got ${misalignedTerminalDescent.phase}`,
  );
  assert(
    misalignedTerminalDescent.attitudeControlMode === "grid-fins+rcs",
    `expected poor body-up alignment to use unpowered grid-fins+rcs terminal control, got ${misalignedTerminalDescent.attitudeControlMode}`,
  );
  assert(
    misalignedTerminalDescent.terminalUprightCommit === true,
    "expected misaligned terminal descent to stay hard-committed upright",
  );
  assert(
    Number(misalignedTerminalDescent.uprightTiltLimitDeg) <= 14,
    `expected bounded terminal upright tilt limit, got ${misalignedTerminalDescent.uprightTiltLimitDeg}`,
  );
  assert(
    Number(misalignedTerminalDescent.attitudeResponseScale) > Number(alignedTerminalDescent.attitudeResponseScale),
    "expected misaligned terminal descent to command stronger attitude response than an already-upright descent",
  );

  console.log("PASS booster-terminal-upright-commit-lock");
}

main();
