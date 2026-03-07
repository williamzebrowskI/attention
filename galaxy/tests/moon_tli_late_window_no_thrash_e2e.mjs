import { createLaunchFleetController } from "../app/static/js/physics/launch/launchFleetController.js";
import { LAUNCH_VEHICLE_CONFIG } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const SUN_MASS_KG = 1.9885e30;
const NOW_MS = Date.UTC(2026, 2, 5, 12, 0, 0);
const EARTH_MU_KM3_S2 = G_KM3_KG_S2 * EARTH_MASS_KG;
const SAMPLE_START_SEC = 620;
const SAMPLE_END_SEC = 800;
const SAMPLE_STEP_SEC = 5;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
  addStaticBody(
    state,
    "sun",
    { x: 149597870.7, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    SUN_MASS_KG,
  );
}

function vAdd(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function vScale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function vLen(a) {
  return Math.sqrt((a.x * a.x) + (a.y * a.y) + (a.z * a.z));
}

function gravityAccelKmS2(positionKm) {
  const radiusKm = Math.max(1, vLen(positionKm));
  return vScale(positionKm, -EARTH_MU_KM3_S2 / (radiusKm * radiusKm * radiusKm));
}

function integrateBody(bodyState, commandedAccelerationKmS2, dtSec) {
  const grav = gravityAccelKmS2(bodyState.position);
  const accel = vAdd(grav, commandedAccelerationKmS2 || { x: 0, y: 0, z: 0 });
  bodyState.velocity = vAdd(bodyState.velocity, vScale(accel, dtSec));
  bodyState.position = vAdd(bodyState.position, vScale(bodyState.velocity, dtSec));
}

function modeFamily(mode = "") {
  const label = String(mode || "");
  if (label.includes("navsys:moon-survival-periapsis-recovery")) {
    return "survival";
  }
  if (label.includes("navsys:gnc-lambert-tli-reacquire-window")) {
    return "reacquire_hold";
  }
  if (label.includes("go-no-go-hold")) {
    return "go_no_go_hold";
  }
  if (label.includes("attitude-align")) {
    return "attitude_align";
  }
  if (label.includes("navsys:gnc-lambert-tli-burn+seed-lock")) {
    return "seed_lock";
  }
  if (label.includes("navsys:gnc-lambert-tli-burn+departure-commit")) {
    return "departure_commit";
  }
  if (label.includes("navsys:gnc-lambert-tli-burn")) {
    return "tli_burn";
  }
  return "other";
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
  assert(
    launch.accepted,
    `moon_tli_late_window_no_thrash: launch rejected (${launch.reason || "unknown"})`,
  );

  const shipId = launch.shipId;
  const samples = [];
  for (let second = 1; second <= SAMPLE_END_SEC; second += 1) {
    const nowMs = NOW_MS + (second * 1000);
    controller.prepareStep(state, 1, nowMs);
    for (const [bodyId, bodyState] of state.dynamicBodies.entries()) {
      integrateBody(bodyState, controller.externalAccelerationKmS2(bodyId), 1);
    }
    controller.finalizeStep(state, 1, nowMs);
    if (second >= SAMPLE_START_SEC && second % SAMPLE_STEP_SEC === 0) {
      const snapshot = controller.statusSnapshotForBody({
        state,
        bodyId: shipId,
        nowMs,
        baseSnapshot: {},
      });
      samples.push({
        second,
        guidanceMode: String(snapshot.guidanceMode || ""),
        family: modeFamily(snapshot.guidanceMode),
        throttle: Number(snapshot.throttle) || 0,
        guidanceRequestedThrottle: Number(snapshot.guidanceRequestedThrottle) || 0,
        altitudeKm: Number(snapshot.altitudeKm),
        periapsisKm: Number(snapshot.periapsisKm),
      });
    }
  }

  assert(samples.length > 0, "moon_tli_late_window_no_thrash: expected late-window samples");

  let survivalLatched = false;
  const familySequence = [];
  for (const sample of samples) {
    familySequence.push(sample.family);
    assert(
      sample.family !== "attitude_align",
      `moon_tli_late_window_no_thrash: attitude-align should not appear in late TLI window (${sample.second}s, ${sample.guidanceMode})`,
    );
    if (sample.family === "seed_lock") {
      assert(
        sample.throttle > 0.4,
        `moon_tli_late_window_no_thrash: seed-lock should keep real thrust in late window (${sample.second}s, throttle ${sample.throttle})`,
      );
      assert(
        sample.guidanceRequestedThrottle > 0.5,
        `moon_tli_late_window_no_thrash: seed-lock should keep strong requested throttle (${sample.second}s, requested ${sample.guidanceRequestedThrottle})`,
      );
    }
    const recoveryReleaseReady = (
      Number.isFinite(sample.periapsisKm)
      && sample.periapsisKm >= 152
      && Number.isFinite(sample.altitudeKm)
      && sample.altitudeKm >= 138
    );
    if (survivalLatched && !recoveryReleaseReady) {
      assert(
        sample.family !== "seed_lock" && sample.family !== "attitude_align",
        `moon_tli_late_window_no_thrash: survival should not bounce back into ${sample.family} before release (${sample.second}s, peri ${sample.periapsisKm}, alt ${sample.altitudeKm}, ${sample.guidanceMode})`,
      );
    }
    if (sample.family === "survival") {
      survivalLatched = true;
    } else if (survivalLatched && recoveryReleaseReady) {
      survivalLatched = false;
    }
  }

  console.log("PASS moon-tli-late-window-no-thrash-e2e");
}

main();
