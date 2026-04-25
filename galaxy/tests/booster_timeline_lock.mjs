import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { LAUNCH_BODY_ID, LAUNCH_BOOSTER_BODY_ID } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 5, 18, 0, 0);
const DT_SEC = 1;
const MAX_STEPS = 1200;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(vector, scalar) {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function length(vector) {
  return Math.sqrt(dot(vector, vector));
}

function gravityAccelerationKmS2(bodyState, earthState) {
  const relative = subtract(bodyState.position, earthState.position);
  const radiusKm = Math.max(1, length(relative));
  const muKm3S2 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * EARTH_MASS_KG;
  return scale(relative, -muKm3S2 / (radiusKm * radiusKm * radiusKm));
}

function integrateBody(bodyState, earthState, commandedAccelerationKmS2, dtSeconds) {
  const totalAccelerationKmS2 = add(
    gravityAccelerationKmS2(bodyState, earthState),
    commandedAccelerationKmS2 || { x: 0, y: 0, z: 0 },
  );
  bodyState.velocity = add(bodyState.velocity, scale(totalAccelerationKmS2, dtSeconds));
  bodyState.position = add(bodyState.position, scale(bodyState.velocity, dtSeconds));
}

function earthAxes() {
  return {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    pole: { x: 0, y: 0, z: 1 },
  };
}

function sampleEarthAtmosphere(altitudeKm = 0) {
  const safeAltitudeKm = Math.max(0, Number(altitudeKm) || 0);
  const attenuation = Math.exp(-safeAltitudeKm / 7.5);
  return {
    densityKgM3: 1.225 * attenuation,
    pressurePa: 101325 * attenuation,
    temperatureK: 288.15,
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
    windSeed: 1,
    gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
  });
}

function within(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function main() {
  const state = makeState();
  const controller = createHarness();
  controller.setMissionProfile(LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN);
  assert(
    controller.startLaunch(state, NOW_MS, {
      launchKind: "booster-timeline-lock",
      boosterEngineCount: 33,
    }),
    "booster_timeline_lock: startLaunch rejected",
  );

  let nowMs = NOW_MS;
  const marks = {
    pitchover: null,
    hotstageArmed: null,
    hotstageIgnition: null,
    boosterActive: null,
    boostback: null,
    entryAlign: null,
    highAltitudeDescentCoast: null,
    entryBurn: null,
    ballisticSettle: null,
    catchApproach: null,
    catchBurn: null,
  };
  let lastBoosterMode = "";

  for (let step = 0; step < MAX_STEPS; step += 1) {
    controller.prepareStep(state, DT_SEC, nowMs);
    const earthState = state.staticSources.get("earth");
    const shipState = state.dynamicBodies.get(LAUNCH_BODY_ID);
    if (shipState) {
      integrateBody(shipState, earthState, controller.externalAccelerationKmS2(LAUNCH_BODY_ID), DT_SEC);
    }
    const boosterState = state.dynamicBodies.get(LAUNCH_BOOSTER_BODY_ID);
    if (boosterState) {
      integrateBody(boosterState, earthState, controller.externalAccelerationKmS2(LAUNCH_BOOSTER_BODY_ID), DT_SEC);
    }
    controller.finalizeStep(state, DT_SEC, nowMs);
    nowMs += DT_SEC * 1000;

    const snapshot = controller.statusSnapshot(state);
    const elapsedSec = Number(snapshot.elapsedSeconds) || 0;
    const altitudeKm = Number(snapshot.altitudeKm) || 0;
    const boosterAltitudeKm = Number(snapshot.boosterAltitudeKm) || 0;
    const boosterMode = String(snapshot.boosterGuidanceMode || "").trim().toLowerCase();

    if (!marks.pitchover && snapshot.pitchoverEnabled) {
      marks.pitchover = { elapsedSec, altitudeKm };
    }
    if (!marks.hotstageArmed && snapshot.hotstageArmed) {
      marks.hotstageArmed = { elapsedSec, altitudeKm };
    }
    if (!marks.hotstageIgnition && snapshot.hotstageIgnitionAuthorized) {
      marks.hotstageIgnition = {
        elapsedSec,
        altitudeKm,
        guidanceMode: String(snapshot.guidanceMode || ""),
      };
    }
    if (!marks.boosterActive && snapshot.boosterActive) {
      marks.boosterActive = {
        elapsedSec,
        altitudeKm: boosterAltitudeKm,
        guidanceMode: boosterMode,
      };
    }

    if (snapshot.boosterActive && boosterMode && boosterMode !== lastBoosterMode) {
      lastBoosterMode = boosterMode;
      const mark = { elapsedSec, altitudeKm: boosterAltitudeKm, guidanceMode: boosterMode };
      if (!marks.boostback && boosterMode.includes("boostback")) {
        marks.boostback = mark;
      } else if (!marks.entryAlign && boosterMode.includes("entry-align")) {
        marks.entryAlign = mark;
      } else if (!marks.highAltitudeDescentCoast && marks.entryAlign && !marks.entryBurn && boosterMode.includes("descent-coast")) {
        marks.highAltitudeDescentCoast = mark;
      } else if (!marks.entryBurn && boosterMode.includes("entry-burn")) {
        marks.entryBurn = mark;
      } else if (!marks.ballisticSettle && marks.entryBurn && boosterMode.includes("ballistic-settle")) {
        marks.ballisticSettle = mark;
      } else if (!marks.catchApproach && boosterMode.includes("catch-approach")) {
        marks.catchApproach = mark;
      } else if (!marks.catchBurn && boosterMode.includes("catch-burn")) {
        marks.catchBurn = mark;
        break;
      }
    }
  }

  for (const [name, value] of Object.entries(marks)) {
    assert(value, `booster_timeline_lock: missing milestone ${name}`);
  }

  assert(
    within(marks.pitchover.elapsedSec, 5, 10) && within(marks.pitchover.altitudeKm, 0.1, 0.3),
    `booster_timeline_lock: pitchover out of band ${JSON.stringify(marks.pitchover)}`,
  );
  assert(
    within(marks.hotstageArmed.elapsedSec, 164, 168) && within(marks.hotstageArmed.altitudeKm, 70, 73),
    `booster_timeline_lock: hotstageArmed out of band ${JSON.stringify(marks.hotstageArmed)}`,
  );
  assert(
    within(marks.hotstageIgnition.elapsedSec, 165, 169) && within(marks.hotstageIgnition.altitudeKm, 71, 74),
    `booster_timeline_lock: hotstageIgnition out of band ${JSON.stringify(marks.hotstageIgnition)}`,
  );
  assert(
    marks.hotstageIgnition.guidanceMode.includes("hotstage-ramp"),
    `booster_timeline_lock: expected hotstage ramp guidance, got ${marks.hotstageIgnition.guidanceMode}`,
  );
  assert(
    within(marks.boosterActive.elapsedSec, 166, 170)
      && within(marks.boosterActive.altitudeKm, 71, 74)
      && marks.boosterActive.guidanceMode === "booster-separation-flip",
    `booster_timeline_lock: boosterActive out of band ${JSON.stringify(marks.boosterActive)}`,
  );
  assert(
    (marks.boosterActive.elapsedSec - marks.hotstageIgnition.elapsedSec) <= 2,
    `booster_timeline_lock: booster activation lagged too long after hotstage ignition (${marks.hotstageIgnition.elapsedSec} -> ${marks.boosterActive.elapsedSec})`,
  );
  assert(
    within(marks.boostback.elapsedSec, 194, 199) && within(marks.boostback.altitudeKm, 83, 87),
    `booster_timeline_lock: boostback out of band ${JSON.stringify(marks.boostback)}`,
  );
  assert(
    within(marks.entryAlign.elapsedSec, 296, 303) && within(marks.entryAlign.altitudeKm, 67, 72),
    `booster_timeline_lock: entryAlign out of band ${JSON.stringify(marks.entryAlign)}`,
  );
  assert(
    within(marks.highAltitudeDescentCoast.elapsedSec, 319, 326) && within(marks.highAltitudeDescentCoast.altitudeKm, 50, 55),
    `booster_timeline_lock: highAltitudeDescentCoast out of band ${JSON.stringify(marks.highAltitudeDescentCoast)}`,
  );
  assert(
    within(marks.entryBurn.elapsedSec, 335, 342) && within(marks.entryBurn.altitudeKm, 37, 41),
    `booster_timeline_lock: entryBurn out of band ${JSON.stringify(marks.entryBurn)}`,
  );
  assert(
    within(marks.ballisticSettle.elapsedSec, 372, 376) && within(marks.ballisticSettle.altitudeKm, 27, 30),
    `booster_timeline_lock: ballisticSettle out of band ${JSON.stringify(marks.ballisticSettle)}`,
  );
  assert(
    within(marks.catchApproach.elapsedSec, 373, 379) && within(marks.catchApproach.altitudeKm, 27, 30),
    `booster_timeline_lock: catchApproach out of band ${JSON.stringify(marks.catchApproach)}`,
  );
  assert(
    within(marks.catchBurn.elapsedSec, 416, 422) && within(marks.catchBurn.altitudeKm, 20, 23),
    `booster_timeline_lock: catchBurn out of band ${JSON.stringify(marks.catchBurn)}`,
  );

  assert(
    marks.pitchover.elapsedSec < marks.hotstageArmed.elapsedSec
      && marks.hotstageArmed.elapsedSec < marks.hotstageIgnition.elapsedSec
      && marks.hotstageIgnition.elapsedSec < marks.boosterActive.elapsedSec
      && marks.boosterActive.elapsedSec < marks.boostback.elapsedSec
      && marks.boostback.elapsedSec < marks.entryAlign.elapsedSec
      && marks.entryAlign.elapsedSec < marks.highAltitudeDescentCoast.elapsedSec
      && marks.highAltitudeDescentCoast.elapsedSec < marks.entryBurn.elapsedSec
      && marks.entryBurn.elapsedSec < marks.ballisticSettle.elapsedSec
      && marks.ballisticSettle.elapsedSec < marks.catchApproach.elapsedSec
      && marks.catchApproach.elapsedSec < marks.catchBurn.elapsedSec,
    `booster_timeline_lock: milestone ordering invalid ${JSON.stringify(marks)}`,
  );

  console.log("PASS booster-timeline-lock");
}

main();
