import { evaluateMoonBurnAttitudeGate } from "../app/static/js/physics/launch/lunar/moonBurnAttitudeGate.js";
import { MOON_BURN_ATTITUDE_GATE_PHASES } from "../app/static/js/physics/launch/lunar/constants.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  assert(
    !MOON_BURN_ATTITUDE_GATE_PHASES.has("tli_burn"),
    "moon burn attitude gate TLI release: tli_burn should not be an attitude-gated phase",
  );

  const released = evaluateMoonBurnAttitudeGate({
    gateEligible: false,
    gateWasActive: true,
    currentAxis: { x: 1, y: 0, z: 0 },
    desiredDirection: { x: 0, y: 1, z: 0 },
    latchedDirection: { x: 0, y: 1, z: 0 },
    alignStableSec: 0.2,
    dtSeconds: 1,
  });

  assert(
    released && released.gateActive === false,
    "moon burn attitude gate TLI release: ineligible gate should release immediately",
  );
  assert(
    released && released.throttleSuppressed === false,
    "moon burn attitude gate TLI release: released gate should not suppress throttle",
  );

  console.log("PASS moon-burn-attitude-gate-tli-release");
}

main();
