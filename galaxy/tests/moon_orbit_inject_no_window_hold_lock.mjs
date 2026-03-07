import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { LAUNCH_VEHICLE_CONFIG, LAUNCH_SITE } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 5, 12, 0, 0);

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
  const state = {
    dynamicBodies: new Map(),
    staticSources: new Map(),
  };
  state.staticSources.set("earth", {
    id: "earth",
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    massKg: EARTH_MASS_KG,
  });
  state.staticSources.set("moon", {
    id: "moon",
    position: { x: 384400, y: 0, z: 28000 },
    velocity: { x: 0, y: 1.022, z: 0.02 },
    massKg: MOON_MASS_KG,
  });
  return state;
}

function createHarness() {
  return createLaunchController({
    stageAtIndex: (index) => LAUNCH_VEHICLE_CONFIG.stages[index] || null,
    getEarthRadiusKm: () => EARTH_RADIUS_KM,
    getEarthMassKg: () => EARTH_MASS_KG,
    getBodyRadiusKm: (id) => (String(id) === "moon" ? MOON_RADIUS_KM : EARTH_RADIUS_KM),
    getBodyMassKg: (id) => (String(id) === "moon" ? MOON_MASS_KG : EARTH_MASS_KG),
    getEarthFixedAxesEcliptic: earthAxes,
    sampleEarthAtmosphere,
    gravitationalConstantKm3PerKgS2: G_KM3_KG_S2,
  });
}

function main() {
  const controller = createHarness();
  const state = makeState();
  const launch = controller.launchMissionShip(
    state,
    LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
    NOW_MS,
    { mode: "orbit_inject" },
  );
  assert(
    launch.accepted,
    `moon_orbit_inject_no_window_hold_lock: launch rejected (${launch.reason || "unknown"})`,
  );
  const initialSnapshot = controller.statusSnapshotForBody(state, launch.shipId, NOW_MS);
  assert(initialSnapshot, "moon_orbit_inject_no_window_hold_lock: missing initial snapshot");
  assert(
    String(initialSnapshot.guidanceMode || "").includes("navsys:gnc-lambert-tli-burn"),
    `moon_orbit_inject_no_window_hold_lock: expected injected ship to start in TLI guidance, got ${initialSnapshot.guidanceMode}`,
  );
  assert(
    !String(initialSnapshot.guidanceMode || "").includes("ballistic-hold"),
    `moon_orbit_inject_no_window_hold_lock: injected ship should not start in ballistic hold (${initialSnapshot.guidanceMode})`,
  );
  assert(
    String(launch.shipMeta?.description || "").includes("Orbit-injected"),
    `moon_orbit_inject_no_window_hold_lock: expected direct-inject metadata, got ${launch.shipMeta?.description}`,
  );
  controller.prepareStep(state, 1, NOW_MS + 1000);
  const snapshot = controller.statusSnapshotForBody(state, launch.shipId, NOW_MS + 1000);
  assert(snapshot, "moon_orbit_inject_no_window_hold_lock: missing snapshot");
  assert(
    String(snapshot.launchSiteName || "").includes(LAUNCH_SITE.name.split(",")[0]),
    `moon_orbit_inject_no_window_hold_lock: expected launch site metadata, got ${snapshot.launchSiteName}`,
  );
  assert(
    String(snapshot.guidanceMode || "").includes("navsys:gnc-lambert-tli-burn"),
    `moon_orbit_inject_no_window_hold_lock: expected powered TLI guidance, got ${snapshot.guidanceMode}`,
  );
  assert(
    !String(snapshot.guidanceMode || "").includes("go-no-go-hold"),
    `moon_orbit_inject_no_window_hold_lock: direct inject should not inherit a launch-window hold (${snapshot.guidanceMode})`,
  );
  assert(
    Number(snapshot.guidanceRequestedThrottle) > 0.5,
    `moon_orbit_inject_no_window_hold_lock: expected positive burn request, got ${snapshot.guidanceRequestedThrottle}`,
  );
  assert(
    snapshot.moonDepartureWindowReady === true,
    `moon_orbit_inject_no_window_hold_lock: expected direct inject window ready, got ${snapshot.moonDepartureWindowReady}`,
  );
  assert(
    !Number.isFinite(Number(snapshot.moonDepartureWindowWaitSec))
      || Number(snapshot.moonDepartureWindowWaitSec) <= 1,
    `moon_orbit_inject_no_window_hold_lock: direct inject should not show a meaningful wait, got ${snapshot.moonDepartureWindowWaitSec}`,
  );
  assert(
    !String(snapshot.missionPhaseGateReason || "").includes("launch window not ready")
      && !String(snapshot.missionPhaseGateReason || "").includes("corridor-ready"),
    `moon_orbit_inject_no_window_hold_lock: unexpected TLI hold reason (${snapshot.missionPhaseGateReason})`,
  );
  console.log("PASS moon-orbit-inject-no-window-hold-lock");
  process.exit(0);
}

main();
