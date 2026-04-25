import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { createPhysicsEnvironmentRuntime } from "../app/static/js/physics/runtime/environmentRuntime.js";
import {
  LAUNCH_PAD_DECK_HEIGHT_KM,
  LAUNCH_BODY_ID,
  LAUNCH_BOOSTER_BODY_ID,
} from "../app/static/js/physics/launch/launchConfig.js";
import { BOOSTER_CATCH_BASE_CLEARANCE_KM } from "../app/static/js/physics/launch/launchSiteCatchGeometry.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 3, 22, 23, 0, 0);
const DT_SEC = 1 / 60;
const MAX_STEPS = 60 * 520;
const WIND_SEED = Number.isFinite(Number(process.env.BOOSTER_CATCH_WIND_SEED))
  ? Number(process.env.BOOSTER_CATCH_WIND_SEED)
  : 1;

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

function normalize(vector, fallback = { x: 0, y: 0, z: 1 }) {
  const magnitude = length(vector);
  if (!(magnitude > 1e-12)) {
    return { ...fallback };
  }
  return scale(vector, 1 / magnitude);
}

function gravityAccelerationKmS2(bodyState, earthState) {
  const relative = subtract(bodyState.position, earthState.position);
  const radiusKm = Math.max(1, length(relative));
  const muKm3S2 = G_KM3_KG_S2 * EARTH_MASS_KG;
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

function main() {
  const physicsEnvironmentRuntime = createPhysicsEnvironmentRuntime({
    getLaunchSite: () => ({
      latitudeDeg: 25.9969,
      longitudeDeg: -97.1548,
      siteName: "Starbase",
    }),
    getEarthFixedAxesEcliptic: () => earthAxes(),
  });
  const controller = createLaunchController({
    getEarthRadiusKm: () => EARTH_RADIUS_KM,
    getEarthMassKg: () => EARTH_MASS_KG,
    getBodyRadiusKm: (id) => (String(id) === "moon" ? MOON_RADIUS_KM : EARTH_RADIUS_KM),
    getBodyMassKg: (id) => (String(id) === "moon" ? MOON_MASS_KG : EARTH_MASS_KG),
    getEarthFixedAxesEcliptic: earthAxes,
    sampleEnvironment: (sampleOptions = {}) => (
      physicsEnvironmentRuntime.sampleEnvironment(sampleOptions)
    ),
    sampleEarthAtmosphere: (altitudeKm, sampleOptions = {}) => (
      physicsEnvironmentRuntime.sampleEarthAtmosphere(altitudeKm, sampleOptions)
    ),
    sampleLaunchWeather: (sampleOptions = {}) => (
      physicsEnvironmentRuntime.sampleLaunchWeather(sampleOptions)
    ),
    windSeed: WIND_SEED,
    gravitationalConstantKm3PerKgS2: G_KM3_KG_S2,
  });
  const state = makeState();
  controller.setMissionProfile(LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD);
  const started = controller.startLaunch(state, NOW_MS, {
    launchKind: "earth-orbit-hold-booster-catch-e2e",
    boosterEngineCount: 33,
  });
  assert(started, "earth_orbit_hold_booster_catch_e2e: startLaunch rejected");

  let nowMs = NOW_MS;
  const marks = {
    hotstageIgnition: null,
    boosterActive: null,
    catchApproach: null,
    catchBurn: null,
    catchContact: null,
    catchCapture: null,
    caught: null,
    crashed: null,
  };
  let lastBoosterMode = "";
  let activeBurnSegment = null;
  const burnSegments = [];
  let finalLoopState = null;

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
    const elapsedSec = Number(snapshot?.elapsedSeconds) || 0;
    const altitudeKm = Number(snapshot?.altitudeKm) || 0;
    const boosterAltitudeKm = Number(snapshot?.boosterAltitudeKm) || 0;
    const boosterRangeKm = Number(snapshot?.boosterCatchTotalRangeKm) || 0;
    const boosterLateralSpeedKmS = Number(snapshot?.boosterCatchLateralSpeedKmS) || 0;
    const boosterMode = String(snapshot?.boosterGuidanceMode || "");
    const exported = controller.exportPersistentSnapshot(state, nowMs);
    const boosterLastStep = exported?.runtime?.booster?.lastStep || {};
    const bodyUpAlignment = Number(boosterLastStep.bodyUpAlignment) || 0;
    const liveBoosterAxis = snapshot?.boosterBodyAxisDirectionKm;
    const liveBodyUpAlignment = liveBoosterAxis && boosterState && earthState
      ? dot(
        normalize(liveBoosterAxis),
        normalize(subtract(boosterState.position, earthState.position)),
      )
      : bodyUpAlignment;
    const boosterThrottle = Number(snapshot?.boosterThrottle) || Number(boosterLastStep.throttle) || 0;
    const boosterBurning = boosterThrottle > 0.01;
    finalLoopState = { elapsedSec, boosterAltitudeKm, boosterMode };

    if (boosterBurning && !activeBurnSegment) {
      activeBurnSegment = {
        startElapsedSec: elapsedSec,
        startAltitudeKm: boosterAltitudeKm,
        startMode: boosterMode,
      };
    } else if (!boosterBurning && activeBurnSegment) {
      burnSegments.push({
        ...activeBurnSegment,
        endElapsedSec: elapsedSec,
        endAltitudeKm: boosterAltitudeKm,
        endMode: boosterMode,
        durationSec: elapsedSec - activeBurnSegment.startElapsedSec,
      });
      activeBurnSegment = null;
    }

    if (!marks.hotstageIgnition && Boolean(snapshot?.hotstageIgnitionAuthorized)) {
      marks.hotstageIgnition = {
        elapsedSec,
        altitudeKm,
        guidanceMode: String(snapshot?.guidanceMode || ""),
      };
    }
    if (!marks.boosterActive && Boolean(snapshot?.boosterActive)) {
      marks.boosterActive = {
        elapsedSec,
        altitudeKm: boosterAltitudeKm,
        guidanceMode: boosterMode,
      };
    }
    if (boosterMode && boosterMode !== lastBoosterMode) {
      lastBoosterMode = boosterMode;
      const mark = {
        elapsedSec,
        altitudeKm: boosterAltitudeKm,
        baseClearanceKm: Number(snapshot?.boosterAltitudeAboveTerrainKm),
        rangeKm: boosterRangeKm,
        lateralSpeedKmS: boosterLateralSpeedKmS,
        bodyUpAlignment: liveBodyUpAlignment,
      };
      if (!marks.catchApproach && boosterMode === "booster-catch-approach") {
        marks.catchApproach = mark;
      } else if (!marks.catchBurn && boosterMode === "booster-catch-burn") {
        marks.catchBurn = mark;
      } else if (!marks.catchContact && boosterMode === "booster-catch-contact") {
        marks.catchContact = mark;
      } else if (!marks.catchCapture && boosterMode === "booster-catch-capture") {
        marks.catchCapture = mark;
      } else if (!marks.caught && boosterMode === "booster-caught") {
        marks.caught = {
          ...mark,
          landed: Boolean(snapshot?.boosterLanded),
          terminalReason: String(snapshot?.boosterTerminalReason || ""),
        };
        break;
      }
    }
    if (!marks.crashed && Boolean(snapshot?.boosterCrashed)) {
      marks.crashed = {
        elapsedSec,
        altitudeKm: boosterAltitudeKm,
        rangeKm: boosterRangeKm,
        lateralSpeedKmS: boosterLateralSpeedKmS,
        reason: String(snapshot?.boosterTerminalReason || ""),
        impactSpeedKmS: Number(snapshot?.boosterImpactSpeedKmS) || 0,
      };
      break;
    }
  }
  if (activeBurnSegment && finalLoopState) {
    burnSegments.push({
      ...activeBurnSegment,
      endElapsedSec: finalLoopState.elapsedSec,
      endAltitudeKm: finalLoopState.boosterAltitudeKm,
      endMode: finalLoopState.boosterMode,
      durationSec: finalLoopState.elapsedSec - activeBurnSegment.startElapsedSec,
    });
    activeBurnSegment = null;
  }

  for (const [name, mark] of Object.entries({
    hotstageIgnition: marks.hotstageIgnition,
    boosterActive: marks.boosterActive,
    catchApproach: marks.catchApproach,
    catchBurn: marks.catchBurn,
  })) {
    assert(mark, `earth_orbit_hold_booster_catch_e2e: missing milestone ${name}`);
  }
  assert(
    !marks.crashed,
    `earth_orbit_hold_booster_catch_e2e: booster crashed before catch ${JSON.stringify(marks.crashed)}`,
  );
  for (const [name, mark] of Object.entries({
    catchContact: marks.catchContact,
    catchCapture: marks.catchCapture,
    caught: marks.caught,
  })) {
    assert(mark, `earth_orbit_hold_booster_catch_e2e: missing milestone ${name}`);
  }

  assert(
    marks.hotstageIgnition.elapsedSec >= 150 && marks.hotstageIgnition.elapsedSec <= 180,
    `earth_orbit_hold_booster_catch_e2e: hotstage ignition timing out of band ${JSON.stringify(marks.hotstageIgnition)}`,
  );
  assert(
    marks.hotstageIgnition.altitudeKm >= 60 && marks.hotstageIgnition.altitudeKm <= 75,
    `earth_orbit_hold_booster_catch_e2e: hotstage ignition altitude out of band ${JSON.stringify(marks.hotstageIgnition)}`,
  );
  assert(
    marks.boosterActive.elapsedSec >= marks.hotstageIgnition.elapsedSec
      && (marks.boosterActive.elapsedSec - marks.hotstageIgnition.elapsedSec) <= 5,
    `earth_orbit_hold_booster_catch_e2e: booster did not separate promptly ${JSON.stringify({ hotstage: marks.hotstageIgnition, boosterActive: marks.boosterActive })}`,
  );
  assert(
    marks.catchApproach.altitudeKm >= 28 && marks.catchApproach.altitudeKm <= 34,
    `earth_orbit_hold_booster_catch_e2e: catch approach altitude out of band ${JSON.stringify(marks.catchApproach)}`,
  );
  assert(
    marks.catchBurn.altitudeKm >= 10 && marks.catchBurn.altitudeKm <= 22,
    `earth_orbit_hold_booster_catch_e2e: catch burn altitude out of band ${JSON.stringify(marks.catchBurn)}`,
  );
  const poweredDescentSegments = burnSegments.filter((segment) => {
    const startMode = String(segment.startMode || "").toLowerCase();
    return (
      !startMode.includes("boostback")
      && !startMode.includes("catch-burn")
      && Number(segment.startElapsedSec) > Number(marks.boosterActive.elapsedSec)
      && Number(segment.endElapsedSec) < Number(marks.catchBurn.elapsedSec)
    );
  });
  assert(
    poweredDescentSegments.every((segment) => Number(segment.durationSec) <= 8),
    `earth_orbit_hold_booster_catch_e2e: unexpected long powered descent before catch burn ${JSON.stringify(poweredDescentSegments)}`,
  );
  const catchBurnSegments = burnSegments.filter((segment) => (
    String(segment.startMode || "").toLowerCase().includes("catch-burn")
    || String(segment.endMode || "").toLowerCase().includes("catch")
  ));
  assert(
    catchBurnSegments.some((segment) => (
      Number(segment.startAltitudeKm) <= 22
      && Number(segment.durationSec) <= 14
    )),
    `earth_orbit_hold_booster_catch_e2e: catch burn did not stay terminal ${JSON.stringify(burnSegments)}`,
  );
  assert(
    marks.catchContact.rangeKm <= 0.04
      && marks.catchContact.altitudeKm <= 0.04
      && marks.catchContact.lateralSpeedKmS <= 0.012,
    `earth_orbit_hold_booster_catch_e2e: catch contact not inside capture box ${JSON.stringify(marks.catchContact)}`,
  );
  assert(
    marks.catchCapture.rangeKm <= 0.008 && marks.catchCapture.lateralSpeedKmS <= 0.001,
    `earth_orbit_hold_booster_catch_e2e: catch capture not mechanically damped ${JSON.stringify(marks.catchCapture)}`,
  );
  assert(
    marks.caught.landed === true
      && marks.caught.rangeKm <= 0.006
      && marks.caught.lateralSpeedKmS <= 0.001,
    `earth_orbit_hold_booster_catch_e2e: final caught state out of band ${JSON.stringify(marks.caught)}`,
  );
  assert(
    marks.caught.terminalReason === "chopstick-capture"
      && marks.caught.baseClearanceKm >= LAUNCH_PAD_DECK_HEIGHT_KM + 0.004
      && Math.abs(marks.caught.baseClearanceKm - BOOSTER_CATCH_BASE_CLEARANCE_KM) <= 0.003,
    `earth_orbit_hold_booster_catch_e2e: final state should be suspended on chopsticks, not surface-landed ${JSON.stringify(marks.caught)}`,
  );

  assert(
    marks.hotstageIgnition.elapsedSec < marks.boosterActive.elapsedSec
      && marks.boosterActive.elapsedSec < marks.catchApproach.elapsedSec
      && marks.catchApproach.elapsedSec < marks.catchBurn.elapsedSec
      && marks.catchBurn.elapsedSec < marks.catchContact.elapsedSec
      && marks.catchContact.elapsedSec < marks.catchCapture.elapsedSec
      && marks.catchCapture.elapsedSec < marks.caught.elapsedSec,
    `earth_orbit_hold_booster_catch_e2e: booster catch sequence out of order ${JSON.stringify(marks)}`,
  );
  assert(
    marks.catchApproach.bodyUpAlignment >= 0.90,
    `earth_orbit_hold_booster_catch_e2e: catch approach not upright enough ${JSON.stringify(marks.catchApproach)}`,
  );
  assert(
    marks.catchBurn.bodyUpAlignment >= 0.90,
    `earth_orbit_hold_booster_catch_e2e: catch burn not upright enough ${JSON.stringify(marks.catchBurn)}`,
  );
  assert(
    marks.catchContact.bodyUpAlignment >= 0.95
      && marks.catchCapture.bodyUpAlignment >= 0.95
      && marks.caught.bodyUpAlignment >= 0.95,
    `earth_orbit_hold_booster_catch_e2e: final capture states not upright enough ${JSON.stringify({
      catchContact: marks.catchContact,
      catchCapture: marks.catchCapture,
      caught: marks.caught,
    })}`,
  );

  console.log("PASS earth-orbit-hold-booster-catch-e2e");
}

main();
