import { orbitalStateFromRelative } from "../app/static/js/physics/launch/launchGuidance.js";
import {
  describeMoonTliExitGate,
  evaluateMoonTliExitGate,
} from "../app/static/js/physics/navigation_system/lunar/lunarPhaseGates.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const EARTH_MU_KM3_S2 = 398600.4418;
const EARTH_RADIUS_KM = 6371;

function main() {
  const radiusKm = EARTH_RADIUS_KM + 500;
  const relPos = { x: radiusKm, y: 0, z: 0 };
  const relVel = { x: 0, y: 11.2, z: 0 };
  const orbital = orbitalStateFromRelative(EARTH_MU_KM3_S2, EARTH_RADIUS_KM, relPos, relVel);

  assert(
    Number.isFinite(orbital.specificEnergy) && orbital.specificEnergy > 0,
    `moon_hyperbolic_escape_diagnostics_lock: expected positive specific energy, got ${orbital.specificEnergy}`,
  );
  assert(
    Number.isFinite(orbital.periapsisKm) && orbital.periapsisKm > 100,
    `moon_hyperbolic_escape_diagnostics_lock: expected finite hyperbolic periapsis, got ${orbital.periapsisKm}`,
  );
  assert(
    !Number.isFinite(orbital.apoapsisKm),
    `moon_hyperbolic_escape_diagnostics_lock: expected no finite apoapsis for escape trajectory, got ${orbital.apoapsisKm}`,
  );

  const gate = evaluateMoonTliExitGate({
    vehicle: {
      tliDurationSec: 834,
      phaseElapsedSec: 900,
      propellantKg: 1_000,
      fuelBudget: { feasible: true, marginKg: 500_000 },
    },
    orbital,
    moonMetrics: {
      projectedMissDistanceKm: 8_425,
      projectedPeriluneAltitudeKm: 298,
      bPlaneErrorKm: 2_753,
      closingSpeedKmS: 4.0,
    },
    minPeriapsisKm: 130,
  });

  assert(
    gate.escapeTrajectory === true,
    `moon_hyperbolic_escape_diagnostics_lock: expected escape trajectory flag, got ${gate.escapeTrajectory}`,
  );
  assert(
    gate.periapsisReady === true,
    "moon_hyperbolic_escape_diagnostics_lock: expected hyperbolic periapsis to remain valid",
  );
  assert(
    gate.apoapsisReady === true && gate.specificEnergyReady === true && gate.earthDepartureReady === true,
    "moon_hyperbolic_escape_diagnostics_lock: expected Earth departure gate to accept escape trajectory",
  );

  const reason = describeMoonTliExitGate(gate);
  assert(
    reason.includes("Earth escape trajectory"),
    `moon_hyperbolic_escape_diagnostics_lock: expected escape label in gate reason, got ${reason}`,
  );

  console.log("PASS moon-hyperbolic-escape-diagnostics-lock");
}

main();
