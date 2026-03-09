import { resolveMoonMissionGuidanceArbitration } from "../app/static/js/physics/navigation_system/gnc/moonMissionGuidanceArbiter.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const PROGRADE = { x: 1, y: 0, z: 0 };
const UP = { x: 0, y: 1, z: 0 };

function main() {
  const result = resolveMoonMissionGuidanceArbitration({
    vehicleRole: "mission_ship",
    missionId: "moon_orbit_return",
    missionPhase: "coast_to_moon",
    requestedThrottle: 0.9,
    desiredDirection: PROGRADE,
    guidanceMode: "navsys:gnc-lambert-midcourse-correction+diffcorr",
    orbital: {
      periapsisKm: 129.8,
      altitudeKm: 900,
      radialSpeedKmS: -0.002,
      specificEnergy: 0.42,
    },
    missionFuelBudget: {
      feasible: true,
      marginKg: 500_000,
    },
    availablePropellantKg: 1_000_000,
    prograde: PROGRADE,
    up: UP,
    recoveryWasActive: true,
  });

  assert(result, "moon_guidance_arbiter_escape_lock: missing result");
  assert(
    result.survivalRecoveryActive === false,
    "moon_guidance_arbiter_escape_lock: survival recovery should be disabled after Earth escape on coast_to_moon",
  );
  assert(
    !String(result.guidanceMode || "").includes("moon-survival"),
    `moon_guidance_arbiter_escape_lock: unexpected survival mode ${result.guidanceMode}`,
  );
  assert(
    String(result.guidanceMode || "") === "navsys:gnc-lambert-midcourse-correction+diffcorr",
    `moon_guidance_arbiter_escape_lock: expected base coast guidance to persist, got ${result.guidanceMode}`,
  );
  assert(
    Boolean(result.diagnostics?.earthEscapeTrajectory),
    "moon_guidance_arbiter_escape_lock: expected Earth escape trajectory diagnostic",
  );
  assert(
    result.diagnostics?.survivalRecoveryAllowed === false,
    "moon_guidance_arbiter_escape_lock: survival recovery should be disallowed in outbound coast",
  );

  console.log("PASS moon-guidance-arbiter-escape-lock");
}

main();
