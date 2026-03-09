import { moonParkingOrbitReady } from "../app/static/js/physics/navigation_system/lunar/moonParkingOrbitGate.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  assert(
    moonParkingOrbitReady({
      specificEnergy: -1.2,
      apoapsisKm: 600.41,
      periapsisKm: 489.27,
    }, {
      parkingOrbitApoapsisMinKm: 500,
      parkingOrbitPeriapsisMinKm: 500,
    }),
    "moon_parking_orbit_gate_tolerance: expected near-target high parking orbit to count as ready",
  );

  assert(
    !moonParkingOrbitReady({
      specificEnergy: -1.2,
      apoapsisKm: 600.41,
      periapsisKm: 470,
    }, {
      parkingOrbitApoapsisMinKm: 500,
      parkingOrbitPeriapsisMinKm: 500,
    }),
    "moon_parking_orbit_gate_tolerance: expected clearly low periapsis orbit to remain not ready",
  );

  console.log("PASS moon-parking-orbit-gate-tolerance-lock");
}

main();
