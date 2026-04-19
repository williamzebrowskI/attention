import { createLaunchFleetController } from "../app/static/js/physics/launch/launchFleetController.js";
import { LAUNCH_VEHICLE_CONFIG } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const SUN_MASS_KG = 1.9885e30;
const NOW_MS = Date.UTC(2026, 2, 5, 12, 0, 0);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertApprox(actual, expected, tolerance, message) {
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  assert(
    Number.isFinite(actualNumber)
      && Number.isFinite(expectedNumber)
      && Math.abs(actualNumber - expectedNumber) <= tolerance,
    `${message}: expected ${expectedNumber} +/- ${tolerance}, got ${actualNumber}`,
  );
}

function stageAtIndex(index) {
  return LAUNCH_VEHICLE_CONFIG.stages[index] || null;
}

function earthAxes() {
  return {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    pole: { x: 0, y: 0, z: 1 },
  };
}

function sampleEarthAtmosphere() {
  return {
    densityKgM3: 0,
    pressurePa: 0,
    temperatureK: 0,
  };
}

function main() {
  const runtime = {
    windSeed: 1,
    fleet: {
      nextShipSequence: 1,
      vehicles: new Map(),
    },
    refuel: {
      flights: [],
    },
  };
  const controller = createLaunchFleetController({
    runtime,
    stageAtIndex,
    getEarthRadiusKm: () => EARTH_RADIUS_KM,
    getEarthMassKg: () => EARTH_MASS_KG,
    getBodyRadiusKm: (id) => (String(id) === "moon" ? MOON_RADIUS_KM : EARTH_RADIUS_KM),
    getBodyMassKg: (id) => (String(id) === "moon" ? MOON_MASS_KG : EARTH_MASS_KG),
    sampleEarthAtmosphere,
    earthAxes,
    gravitationalConstantKm3PerKgS2: G_KM3_KG_S2,
    emitLaunchEvent: null,
  });
  const state = {
    dynamicBodies: new Map(),
    staticSources: new Map([
      ["earth", {
        id: "earth",
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        massKg: EARTH_MASS_KG,
      }],
      ["moon", {
        id: "moon",
        position: { x: 384400, y: 0, z: 0 },
        velocity: { x: 0, y: 1.022, z: 0 },
        massKg: MOON_MASS_KG,
      }],
      ["sun", {
        id: "sun",
        position: { x: 149597870.7, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        massKg: SUN_MASS_KG,
      }],
    ]),
  };

  const launch = controller.launchMissionShip(
    state,
    LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
    NOW_MS,
    { mode: "orbit_inject" },
  );
  assert(launch.accepted, `moon_tli_seed_snapshot_fallback: launch rejected (${launch.reason || "unknown"})`);
  const vehicle = runtime.fleet.vehicles.get(launch.shipId);
  assert(vehicle, "moon_tli_seed_snapshot_fallback: missing fleet vehicle");

  const snapshot = controller.statusSnapshotForBody({
    state,
    bodyId: launch.shipId,
    nowMs: NOW_MS,
    baseSnapshot: {},
  });
  assert(snapshot, "moon_tli_seed_snapshot_fallback: missing snapshot");
  assert(
    String(snapshot.phaseLabel || "") === "TLI Hold",
    `moon_tli_seed_snapshot_fallback: expected TLI Hold label before first live solve, got ${snapshot.phaseLabel}`,
  );
  assert(
    snapshot.moonTliTargetMissKm === null
      && snapshot.moonTliTargetPeriluneKm === null
      && snapshot.moonTliTargetBPlaneKm === null,
    `moon_tli_seed_snapshot_fallback: live TLI diagnostics should be null before first guidance step, got miss=${snapshot.moonTliTargetMissKm}, peri=${snapshot.moonTliTargetPeriluneKm}, b=${snapshot.moonTliTargetBPlaneKm}`,
  );
  assertApprox(
    snapshot.moonProjectedMissDistanceKm,
    vehicle.moonDeparturePlanPredictedMissDistanceKm,
    1e-6,
    "moon_tli_seed_snapshot_fallback: projected miss should fall back to the stored departure plan",
  );
  assertApprox(
    snapshot.moonProjectedPeriluneAltitudeKm,
    vehicle.moonDeparturePlanPredictedPeriluneAltitudeKm,
    1e-6,
    "moon_tli_seed_snapshot_fallback: projected perilune should fall back to the stored departure plan",
  );
  assertApprox(
    snapshot.moonBPlaneErrorKm,
    vehicle.moonDeparturePlanBPlaneErrorKm,
    1e-6,
    "moon_tli_seed_snapshot_fallback: B-plane should fall back to the stored departure plan",
  );
  assert(
    String(snapshot.missionPhaseGateReason || "").includes("Miss ")
      && !String(snapshot.missionPhaseGateReason || "").includes("Miss 0 km")
      && String(snapshot.missionPhaseGateReason || "").includes("[go]"),
    `moon_tli_seed_snapshot_fallback: gate reason should use seeded departure telemetry, got ${snapshot.missionPhaseGateReason}`,
  );

  console.log("PASS moon-tli-seed-snapshot-fallback");
}

main();
