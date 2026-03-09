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
    missionPhase: "tli_burn",
    requestedThrottle: 1,
    desiredDirection: PROGRADE,
    guidanceMode: "navsys:gnc-lambert-tli-burn+seed-lock+diffcorr",
    orbital: {
      periapsisKm: 129.9,
      altitudeKm: 652.4,
      radialSpeedKmS: -0.002,
      specificEnergy: -15,
    },
    missionFuelBudget: {
      feasible: false,
      marginKg: -250_000,
    },
    availablePropellantKg: 1_000_000,
    prograde: PROGRADE,
    up: UP,
    recoveryWasActive: false,
    missionElapsedInPhaseSec: 620,
    moonDepartureWindowReady: true,
    departurePredictedMissDistanceKm: 8_000,
    departurePredictedPeriluneAltitudeKm: 300,
    departureBPlaneErrorKm: 2_700,
    minPeriapsisKm: 130,
    minAltitudeKm: 120,
    minPropellantKg: 1,
  });

  assert(result, "moon_guidance_arbiter_priority_lock: missing result");
  assert(
    result.survivalRecoveryActive,
    "moon_guidance_arbiter_priority_lock: expected survival recovery to take priority on periapsis failure",
  );
  assert(
    String(result.guidanceMode || "").includes("moon-survival-recovery"),
    `moon_guidance_arbiter_priority_lock: unexpected mode ${result.guidanceMode}`,
  );
  assert(
    !String(result.guidanceMode || "").includes("go-no-go-hold"),
    "moon_guidance_arbiter_priority_lock: go/no-go hold must not stack on top of survival recovery",
  );
  assert(
    !String(result.guidanceMode || "").includes("fuel-budget-hold"),
    "moon_guidance_arbiter_priority_lock: fuel budget hold must not stack on top of survival recovery",
  );
  assert(
    Number(result.requestedThrottle) > 0,
    `moon_guidance_arbiter_priority_lock: expected positive recovery throttle, got ${result.requestedThrottle}`,
  );
  assert(
    String(result.moonGoNoGoStatus || "") === "NO-GO",
    `moon_guidance_arbiter_priority_lock: expected NO-GO status, got ${result.moonGoNoGoStatus}`,
  );
  assert(
    String(result.diagnostics?.selectedOverride || "") === "go-no-go-survival-recovery",
    `moon_guidance_arbiter_priority_lock: unexpected override source ${result.diagnostics?.selectedOverride}`,
  );

  console.log("PASS moon-guidance-arbiter-priority-lock");
}

main();
