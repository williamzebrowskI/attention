import { enforceMoonEarthAvoidanceDirection } from "../app/static/js/physics/launch/lunar/guidanceSafety.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function testSafeTliDepartureDoesNotTriggerLowEarthGuard() {
  const result = enforceMoonEarthAvoidanceDirection({
    missionPhase: "tli_burn",
    commandPhase: "powered",
    direction: { x: 0.98, y: 0.18, z: 0.02 },
    tangent: { x: 0, y: 1, z: 0 },
    up: { x: 1, y: 0, z: 0 },
    previousApplied: false,
    toMoonVectorKm: { x: 390000, y: 12000, z: 8000 },
    earthDistanceKm: 6556,
    earthRadiusKm: 6371,
    periapsisKm: 184.4,
  });
  assert(result, "safe_tli: missing result");
  assert(result.applied === false, `safe_tli: guard should stay off, got ${result.reason}`);
}

function testLowEarthInwardBurnStillTriggersGuard() {
  const result = enforceMoonEarthAvoidanceDirection({
    missionPhase: "tli_burn",
    commandPhase: "powered",
    direction: { x: -0.08, y: 0.99, z: 0 },
    tangent: { x: 0, y: 1, z: 0 },
    up: { x: 1, y: 0, z: 0 },
    previousApplied: false,
    toMoonVectorKm: { x: 1000, y: 390000, z: 2000 },
    earthDistanceKm: 6485,
    earthRadiusKm: 6371,
    periapsisKm: 128,
  });
  assert(result, "low_earth_guard: missing result");
  assert(result.applied === true, "low_earth_guard: expected guard to apply");
  assert(
    String(result.reason || "").includes("guard"),
    `low_earth_guard: unexpected reason ${result.reason}`,
  );
}

function main() {
  testSafeTliDepartureDoesNotTriggerLowEarthGuard();
  testLowEarthInwardBurnStillTriggersGuard();
  console.log("PASS moon-guidance-safety-regression");
}

main();
