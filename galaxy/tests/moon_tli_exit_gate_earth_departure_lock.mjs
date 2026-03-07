import {
  describeMoonTliExitGate,
  evaluateMoonTliExitGate,
} from "../app/static/js/physics/navigation_system/lunar/lunarPhaseGates.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const earthBoundGate = evaluateMoonTliExitGate({
    vehicle: {
      phaseElapsedSec: 576,
      tliDurationSec: 520,
      propellantKg: 3_500_000,
      fuelBudget: {
        feasible: true,
        marginKg: 800_000,
      },
    },
    orbital: {
      periapsisKm: 147.48,
      apoapsisKm: 11_597.86,
      specificEnergy: -26.5,
    },
    moonMetrics: {
      closingSpeedKmS: 3.0647,
      projectedMissDistanceKm: 8_048.4,
      projectedPeriluneAltitudeKm: 299.8,
      bPlaneErrorKm: 2_744.5,
    },
  });
  assert(
    earthBoundGate.ready === false,
    "moon_tli_exit_gate_earth_departure_lock: Earth-bound orbit should not clear the TLI gate",
  );
  assert(
    earthBoundGate.apoapsisReady === false && earthBoundGate.specificEnergyReady === false,
    "moon_tli_exit_gate_earth_departure_lock: Earth departure checks should hold a low orbit",
  );
  const earthBoundDescription = describeMoonTliExitGate(earthBoundGate);
  assert(
    earthBoundDescription.includes("Earth apo") && earthBoundDescription.includes("Specific energy"),
    `moon_tli_exit_gate_earth_departure_lock: gate description should show Earth departure checks, got ${earthBoundDescription}`,
  );

  const departureReadyGate = evaluateMoonTliExitGate({
    vehicle: {
      phaseElapsedSec: 576,
      tliDurationSec: 520,
      propellantKg: 3_500_000,
      fuelBudget: {
        feasible: true,
        marginKg: 800_000,
      },
    },
    orbital: {
      periapsisKm: 170,
      apoapsisKm: 381_200,
      specificEnergy: -0.12,
    },
    moonMetrics: {
      closingSpeedKmS: 3.5,
      projectedMissDistanceKm: 8_000,
      projectedPeriluneAltitudeKm: 320,
      bPlaneErrorKm: 2_700,
    },
  });
  assert(
    departureReadyGate.ready === true,
    "moon_tli_exit_gate_earth_departure_lock: departure-ready orbit should clear the TLI gate",
  );

  console.log("PASS moon-tli-exit-gate-earth-departure-lock");
}

main();
