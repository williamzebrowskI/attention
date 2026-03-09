import { createLaunchFleetController } from "../app/static/js/physics/launch/launchFleetController.js";
import { LAUNCH_VEHICLE_CONFIG } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 5, 12, 0, 0);
const EARTH_MU_KM3_S2 = G_KM3_KG_S2 * EARTH_MASS_KG;
const STAGE2_PROPELLANT_KG = 5_000_000;
const STAGE2_DRY_MASS_KG = 120_000;
const HOLD_ELAPSED_SEC = 323;

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

function makeState() {
  return {
    dynamicBodies: new Map(),
    staticSources: new Map(),
  };
}

function addStaticBody(state, id, position, velocity, massKg) {
  state.staticSources.set(id, {
    id,
    position,
    velocity,
    massKg,
  });
}

function seedWorld(state) {
  addStaticBody(
    state,
    "earth",
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    EARTH_MASS_KG,
  );
  addStaticBody(
    state,
    "moon",
    { x: 384400, y: 0, z: 0 },
    { x: 0, y: 1.022, z: 0 },
    MOON_MASS_KG,
  );
}

function makeEllipticOrbitState({
  periapsisKm = 185,
  apoapsisKm = 221,
  trueAnomalyRad = 0,
} = {}) {
  const periapsisRadiusKm = EARTH_RADIUS_KM + periapsisKm;
  const apoapsisRadiusKm = EARTH_RADIUS_KM + apoapsisKm;
  const semiMajorAxisKm = (periapsisRadiusKm + apoapsisRadiusKm) * 0.5;
  const eccentricity = (apoapsisRadiusKm - periapsisRadiusKm) / (apoapsisRadiusKm + periapsisRadiusKm);
  const semiLatusRectumKm = semiMajorAxisKm * (1 - (eccentricity * eccentricity));
  const radiusKm = semiLatusRectumKm / (1 + (eccentricity * Math.cos(trueAnomalyRad)));
  const specificAngularMomentumKm2S = Math.sqrt(EARTH_MU_KM3_S2 * semiLatusRectumKm);
  return {
    position: {
      x: radiusKm * Math.cos(trueAnomalyRad),
      y: radiusKm * Math.sin(trueAnomalyRad),
      z: 0,
    },
    velocity: {
      x: -(EARTH_MU_KM3_S2 / specificAngularMomentumKm2S) * Math.sin(trueAnomalyRad),
      y: (EARTH_MU_KM3_S2 / specificAngularMomentumKm2S) * (eccentricity + Math.cos(trueAnomalyRad)),
      z: 0,
    },
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
  const state = makeState();
  seedWorld(state);

  const launch = controller.launchMissionShip(
    state,
    LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
    NOW_MS,
    { mode: "orbit_inject" },
  );
  assert(launch.accepted, `moon_tli_reacquire_snapshot_consistency: launch rejected (${launch.reason || "unknown"})`);
  const shipId = launch.shipId;
  const vehicle = runtime.fleet.vehicles.get(shipId);
  const shipState = state.dynamicBodies.get(shipId);
  assert(vehicle, "moon_tli_reacquire_snapshot_consistency: missing fleet vehicle");
  assert(shipState, "moon_tli_reacquire_snapshot_consistency: missing ship state");

  const orbitState = makeEllipticOrbitState({
    periapsisKm: 185,
    apoapsisKm: 221,
    trueAnomalyRad: 0.25,
  });
  shipState.position = orbitState.position;
  shipState.velocity = orbitState.velocity;
  shipState.massKg = STAGE2_DRY_MASS_KG + STAGE2_PROPELLANT_KG;
  vehicle.stageIndex = 1;
  vehicle.stagePropellantKg = STAGE2_PROPELLANT_KG;
  vehicle.missionPhase = "tli_burn";
  vehicle.elapsedSeconds = HOLD_ELAPSED_SEC;
  vehicle.phaseElapsedSec = HOLD_ELAPSED_SEC;

  controller.prepareStep(state, 1, NOW_MS + (HOLD_ELAPSED_SEC * 1000));
  const snapshot = controller.statusSnapshotForBody({
    state,
    bodyId: shipId,
    nowMs: NOW_MS + (HOLD_ELAPSED_SEC * 1000),
    baseSnapshot: {},
  });
  assert(snapshot, "moon_tli_reacquire_snapshot_consistency: missing snapshot");
  assert(
    String(snapshot.phaseLabel || "") === "TLI Reacquire Hold",
    `moon_tli_reacquire_snapshot_consistency: expected TLI Reacquire Hold label, got ${snapshot.phaseLabel}`,
  );
  assert(
    String(snapshot.guidanceMode || "").includes("navsys:gnc-lambert-tli-hold"),
    `moon_tli_reacquire_snapshot_consistency: expected reacquire guidance, got ${snapshot.guidanceMode}`,
  );
  assert(
    Number(snapshot.guidanceRequestedThrottle) === 0,
    `moon_tli_reacquire_snapshot_consistency: hold should command zero throttle, got ${snapshot.guidanceRequestedThrottle}`,
  );
  assertApprox(
    snapshot.moonProjectedMissDistanceKm,
    snapshot.moonTliTargetMissKm,
    1e-6,
    "moon_tli_reacquire_snapshot_consistency: projected miss should follow live TLI diagnostics",
  );
  assertApprox(
    snapshot.moonProjectedPeriluneAltitudeKm,
    snapshot.moonTliTargetPeriluneKm,
    1e-6,
    "moon_tli_reacquire_snapshot_consistency: projected perilune should follow live TLI diagnostics",
  );
  assertApprox(
    snapshot.moonBPlaneErrorKm,
    snapshot.moonTliTargetBPlaneKm,
    1e-6,
    "moon_tli_reacquire_snapshot_consistency: B-plane should follow live TLI diagnostics",
  );
  assert(
    snapshot.moonProjectedMissTrendKmS === null,
    `moon_tli_reacquire_snapshot_consistency: miss trend should be suppressed while using guidance diagnostics, got ${snapshot.moonProjectedMissTrendKmS}`,
  );
  assert(
    String(snapshot.missionPhaseGateReason || "").includes("Miss ")
      && String(snapshot.missionPhaseGateReason || "").includes("[hold]")
      && String(snapshot.missionPhaseGateReason || "").includes("B-plane")
      && String(snapshot.missionPhaseGateReason || "").includes("Perilune est"),
    `moon_tli_reacquire_snapshot_consistency: expected explicit hold statuses in gate reason, got ${snapshot.missionPhaseGateReason}`,
  );

  console.log("PASS moon-tli-reacquire-snapshot-consistency");
}

main();
