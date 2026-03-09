import { computeMoonSurvivalRecoveryOverride } from "../app/static/js/physics/launch/lunar/moonSurvivalRecovery.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const PROGRADE = { x: 1, y: 0, z: 0 };
const UP = { x: 0, y: 1, z: 0 };

function main() {
  const initial = computeMoonSurvivalRecoveryOverride({
    missionPhase: "tli_burn",
    periapsisKm: 129.98,
    altitudeKm: 652.4,
    radialSpeedKmS: -0.002,
    prograde: PROGRADE,
    up: UP,
    availablePropellantKg: 1_000,
    recoveryWasActive: false,
  });
  assert(initial, "moon survival hysteresis: expected initial recovery override");
  assert(
    String(initial.mode || "").includes("moon-survival-recovery"),
    `moon survival hysteresis: expected survival recovery mode, got ${initial?.mode}`,
  );

  const latched = computeMoonSurvivalRecoveryOverride({
    missionPhase: "tli_burn",
    periapsisKm: 147,
    altitudeKm: 700,
    radialSpeedKmS: 0.0001,
    prograde: PROGRADE,
    up: UP,
    availablePropellantKg: 1_000,
    recoveryWasActive: true,
  });
  assert(latched, "moon survival hysteresis: expected latched recovery to remain active below release band");

  const released = computeMoonSurvivalRecoveryOverride({
    missionPhase: "tli_burn",
    periapsisKm: 153,
    altitudeKm: 160,
    radialSpeedKmS: 0,
    prograde: PROGRADE,
    up: UP,
    availablePropellantKg: 1_000,
    recoveryWasActive: true,
  });
  assert(!released, "moon survival hysteresis: expected recovery to release above the safety band");

  console.log("PASS moon-survival-recovery-hysteresis");
}

main();
