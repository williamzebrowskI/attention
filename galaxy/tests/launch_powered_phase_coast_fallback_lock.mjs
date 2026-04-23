import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const G_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 5, 18, 0, 0);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
    staticSources: new Map([
      [
        "earth",
        {
          id: "earth",
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          massKg: EARTH_MASS_KG,
        },
      ],
      [
        "moon",
        {
          id: "moon",
          position: { x: 384400, y: 0, z: 0 },
          velocity: { x: 0, y: 1.022, z: 0 },
          massKg: MOON_MASS_KG,
        },
      ],
    ]),
  };
}

function createHarness() {
  return createLaunchController({
    getEarthRadiusKm: () => EARTH_RADIUS_KM,
    getEarthMassKg: () => EARTH_MASS_KG,
    getBodyRadiusKm: (id) => (String(id) === "moon" ? MOON_RADIUS_KM : EARTH_RADIUS_KM),
    getBodyMassKg: (id) => (String(id) === "moon" ? MOON_MASS_KG : EARTH_MASS_KG),
    getEarthFixedAxesEcliptic: earthAxes,
    sampleEarthAtmosphere,
    gravitationalConstantKm3PerKgS2: G_KM3_PER_KG_S2,
    windSeed: 1,
  });
}

function main() {
  const state = makeState();
  const controller = createHarness();
  controller.setMissionProfile(LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN);
  const started = controller.startLaunch(state, NOW_MS, { launchKind: "phase-fallback-lock" });
  assert(started, "launch_powered_phase_coast_fallback: startLaunch rejected");

  const snapshot = controller.exportPersistentSnapshot(state, NOW_MS + 1_000);
  assert(snapshot?.runtime, "launch_powered_phase_coast_fallback: missing runtime snapshot");

  snapshot.runtime.phase = "powered";
  snapshot.runtime.commandPhase = "powered";
  snapshot.runtime.stageIndex = 1;
  snapshot.runtime.stagePropellantKg = 12_000;
  snapshot.runtime.lastTelemetry = {
    ...(snapshot.runtime.lastTelemetry || {}),
    altitudeAboveTerrainKm: 120,
    groundRelativeSpeedKmS: 1.2,
    altitudeKm: 120,
    stageIndex: 1,
  };
  snapshot.runtime.lastStep = {
    ...(snapshot.runtime.lastStep || {}),
    throttle: 0,
    throttleCommand: 0.82,
    thrustN: 0,
    guidanceMode: "autopilot-high-orbit-insertion+coast-fallback",
  };

  const restored = controller.importPersistentSnapshot(state, snapshot, NOW_MS + 2_000);
  assert(restored?.applied, `launch_powered_phase_coast_fallback: import failed (${restored?.reason || "unknown"})`);

  const status = controller.statusSnapshot(state);
  assert(status, "launch_powered_phase_coast_fallback: missing status snapshot");
  assert(
    status.phase === "coast",
    `launch_powered_phase_coast_fallback: expected coast phase when thrust is zero, got ${status.phase}`,
  );
  assert(
    String(status.phaseLabel || "") === "Coast",
    `launch_powered_phase_coast_fallback: expected Coast label, got ${status.phaseLabel}`,
  );

  console.log("PASS launch-powered-phase-coast-fallback-lock");
}

main();
