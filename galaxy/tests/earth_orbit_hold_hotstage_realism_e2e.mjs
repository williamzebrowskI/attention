import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { createPhysicsEnvironmentRuntime } from "../app/static/js/physics/runtime/environmentRuntime.js";
import {
  LAUNCH_BODY_ID,
  LAUNCH_BOOSTER_BODY_ID,
  LAUNCH_VEHICLE_CONFIG,
} from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 3, 22, 23, 0, 0);
const DT_SEC = 1 / 60;
const MAX_STEPS = 60 * 260;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function add(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function scale(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
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
    sampleEarthAtmosphere: (altitudeKm, sampleOptions = {}) => (
      physicsEnvironmentRuntime.sampleEarthAtmosphere(altitudeKm, sampleOptions)
    ),
    sampleLaunchWeather: (sampleOptions = {}) => (
      physicsEnvironmentRuntime.sampleLaunchWeather(sampleOptions)
    ),
    windSeed: 1,
    gravitationalConstantKm3PerKgS2: G_KM3_KG_S2,
  });
  const state = makeState();
  controller.setMissionProfile(LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD);
  const started = controller.startLaunch(state, NOW_MS, {
    launchKind: "earth-orbit-hold-hotstage-realism",
    boosterEngineCount: 33,
  });
  assert(started, "earth_orbit_hold_hotstage_realism: startLaunch rejected");

  const guidance = LAUNCH_VEHICLE_CONFIG.guidance || {};
  let nowMs = NOW_MS;
  let ignition = null;
  let detach = null;
  let afterDetachSnapshot = null;
  const physicalSeparation = {
    shipReferenceActiveSeen: false,
    attachedJointShipReferenceActiveSeen: false,
    maxPlumeImpingementMN: 0,
    maxPhysicalSeparationKm: 0,
    maxAbsPhysicalSeparationRateKmS: 0,
  };

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
    const exported = controller.exportPersistentSnapshot(state, nowMs);
    const hotstageRuntime = exported?.runtime?.hotstage || {};
    const attachedJointRuntime = exported?.runtime?.attachedJoint || {};

    if (Boolean(snapshot?.hotstageActive)) {
      physicalSeparation.shipReferenceActiveSeen ||= Boolean(hotstageRuntime.shipReferenceActive);
      physicalSeparation.attachedJointShipReferenceActiveSeen ||= Boolean(attachedJointRuntime.shipReferenceActive);
      physicalSeparation.maxPlumeImpingementMN = Math.max(
        physicalSeparation.maxPlumeImpingementMN,
        Number(snapshot?.attachedJointPlumeImpingementMN) || 0,
        (Number(attachedJointRuntime.plumeImpingementForceN) || 0) / 1e6,
      );
      physicalSeparation.maxPhysicalSeparationKm = Math.max(
        physicalSeparation.maxPhysicalSeparationKm,
        Math.abs(Number(snapshot?.hotstagePhysicalSeparationKm) || 0),
        Math.abs(Number(hotstageRuntime.physicalSeparationKm) || 0),
        Math.abs(Number(attachedJointRuntime.physicalSeparationKm) || 0),
      );
      physicalSeparation.maxAbsPhysicalSeparationRateKmS = Math.max(
        physicalSeparation.maxAbsPhysicalSeparationRateKmS,
        Math.abs(Number(snapshot?.hotstagePhysicalSeparationRateKmS) || 0),
        Math.abs(Number(hotstageRuntime.physicalSeparationRateKmS) || 0),
        Math.abs(Number(attachedJointRuntime.physicalSeparationRateKmS) || 0),
      );
    }

    if (!ignition && Boolean(snapshot?.hotstageActive)) {
      ignition = {
        elapsedSec: Number(snapshot?.elapsedSeconds),
        altitudeKm: Number(snapshot?.altitudeKm),
        speedKmS: Number(snapshot?.speedKmS),
        guidanceMode: String(snapshot?.guidanceMode || ""),
        shipReferenceActive: Boolean(hotstageRuntime.shipReferenceActive),
        attachedJointShipReferenceActive: Boolean(attachedJointRuntime.shipReferenceActive),
        plumeImpingementMN: Number(snapshot?.attachedJointPlumeImpingementMN) || 0,
        physicalSeparationKm: Number(snapshot?.hotstagePhysicalSeparationKm) || 0,
        physicalSeparationRateKmS: Number(snapshot?.hotstagePhysicalSeparationRateKmS) || 0,
      };
    }
    if (!detach && Boolean(snapshot?.boosterActive)) {
      detach = {
        elapsedSec: Number(snapshot?.elapsedSeconds),
        altitudeKm: Number(snapshot?.altitudeKm),
        speedKmS: Number(snapshot?.speedKmS),
        boosterAltitudeKm: Number(snapshot?.boosterAltitudeKm),
        boosterGuidanceMode: String(snapshot?.boosterGuidanceMode || ""),
        physicalSeparationKm: Number(snapshot?.hotstagePhysicalSeparationKm) || 0,
        physicalSeparationRateKmS: Number(snapshot?.hotstagePhysicalSeparationRateKmS) || 0,
        shipReferenceActive: Boolean(hotstageRuntime.shipReferenceActive),
      };
    }
    if (
      detach
      && !afterDetachSnapshot
      && Number(snapshot?.elapsedSeconds) >= (detach.elapsedSec + 10)
    ) {
      afterDetachSnapshot = {
        elapsedSec: Number(snapshot?.elapsedSeconds),
        altitudeKm: Number(snapshot?.altitudeKm),
        stageIndex: Number(snapshot?.stageIndex),
        phase: String(snapshot?.phase || ""),
        guidanceMode: String(snapshot?.guidanceMode || ""),
        boosterActive: Boolean(snapshot?.boosterActive),
        boosterGuidanceMode: String(snapshot?.boosterGuidanceMode || ""),
      };
      break;
    }
  }

  assert(ignition, "earth_orbit_hold_hotstage_realism: never observed hotstage ignition");
  assert(detach, "earth_orbit_hold_hotstage_realism: never observed booster detach");
  assert(afterDetachSnapshot, "earth_orbit_hold_hotstage_realism: never observed sustained post-detach stage 2 state");

  assert(
    ignition.elapsedSec >= Number(guidance.hotstageMinElapsedSec)
      && ignition.elapsedSec <= Number(guidance.hotstageMaxElapsedSec),
    `earth_orbit_hold_hotstage_realism: ignition time ${ignition.elapsedSec}s outside ${guidance.hotstageMinElapsedSec}-${guidance.hotstageMaxElapsedSec}s`,
  );
  assert(
    ignition.altitudeKm >= Number(guidance.hotstageMinAltitudeKm)
      && ignition.altitudeKm <= Number(guidance.hotstageMaxAltitudeKm),
    `earth_orbit_hold_hotstage_realism: ignition altitude ${ignition.altitudeKm}km outside ${guidance.hotstageMinAltitudeKm}-${guidance.hotstageMaxAltitudeKm}km`,
  );
  assert(
    Math.abs(ignition.altitudeKm - Number(guidance.hotstageNominalAltitudeKm)) <= 12,
    `earth_orbit_hold_hotstage_realism: ignition altitude ${ignition.altitudeKm}km drifted too far from nominal ${guidance.hotstageNominalAltitudeKm}km`,
  );
  assert(
    ignition.guidanceMode === "stage-transition:hotstage-authorized"
      || ignition.guidanceMode.includes("hotstage-ramp"),
    `earth_orbit_hold_hotstage_realism: expected hotstage authorization/ramp guidance, got ${ignition.guidanceMode}`,
  );
  assert(
    detach.elapsedSec >= ignition.elapsedSec
      && (detach.elapsedSec - ignition.elapsedSec) <= 5,
    `earth_orbit_hold_hotstage_realism: detach should follow ignition quickly, got ignition ${ignition.elapsedSec}s detach ${detach.elapsedSec}s`,
  );
  assert(
    Number.isFinite(detach.boosterAltitudeKm)
      && Math.abs(detach.boosterAltitudeKm - detach.altitudeKm) <= 0.5,
    `earth_orbit_hold_hotstage_realism: stacked ship/booster detach altitudes diverged unexpectedly (${detach.altitudeKm} vs ${detach.boosterAltitudeKm})`,
  );
  assert(
    detach.boosterGuidanceMode === "booster-separation-flip",
    `earth_orbit_hold_hotstage_realism: expected booster separation flip, got ${detach.boosterGuidanceMode}`,
  );
  assert(
    physicalSeparation.shipReferenceActiveSeen
      && physicalSeparation.attachedJointShipReferenceActiveSeen,
    `earth_orbit_hold_hotstage_realism: hotstage never switched to a physical ship/booster reference ${JSON.stringify(physicalSeparation)}`,
  );
  assert(
    physicalSeparation.maxPlumeImpingementMN > 0.05,
    `earth_orbit_hold_hotstage_realism: expected measurable hotstage plume loading, got ${JSON.stringify(physicalSeparation)}`,
  );
  assert(
    physicalSeparation.maxPhysicalSeparationKm > 1e-7
      && physicalSeparation.maxAbsPhysicalSeparationRateKmS > 1e-8,
    `earth_orbit_hold_hotstage_realism: expected measured physical separation gap/rate, got ${JSON.stringify(physicalSeparation)}`,
  );
  assert(
    afterDetachSnapshot.stageIndex === 1,
    `earth_orbit_hold_hotstage_realism: expected stage 2 after detach, got stage ${afterDetachSnapshot.stageIndex}`,
  );
  assert(
    afterDetachSnapshot.phase === "powered",
    `earth_orbit_hold_hotstage_realism: expected powered stage 2 after detach, got ${afterDetachSnapshot.phase}`,
  );
  assert(
    afterDetachSnapshot.guidanceMode.includes("stage2-initial-climb"),
    `earth_orbit_hold_hotstage_realism: expected stage2 initial climb guidance after detach, got ${afterDetachSnapshot.guidanceMode}`,
  );
  assert(
    afterDetachSnapshot.boosterActive,
    "earth_orbit_hold_hotstage_realism: booster should remain active after detach",
  );

  console.log(JSON.stringify({
    ignition,
    detach,
    afterDetachSnapshot,
    physicalSeparation,
  }, null, 2));
  console.log("PASS earth-orbit-hold-hotstage-realism-e2e");
}

main();
