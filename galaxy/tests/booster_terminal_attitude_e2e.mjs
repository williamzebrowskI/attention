import fs from "node:fs";
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

const controllerSource = fs.readFileSync(
  new URL("../app/static/js/physics/launch/launchController.js", import.meta.url),
  "utf8",
);

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

function simulateMissionBoosterRecovery(missionId) {
  const controller = createLaunchController({
    getEarthRadiusKm: () => EARTH_RADIUS_KM,
    getEarthMassKg: () => EARTH_MASS_KG,
    getBodyRadiusKm: (id) => (String(id) === "moon" ? MOON_RADIUS_KM : EARTH_RADIUS_KM),
    getBodyMassKg: (id) => (String(id) === "moon" ? MOON_MASS_KG : EARTH_MASS_KG),
    getEarthFixedAxesEcliptic: earthAxes,
    sampleEarthAtmosphere,
    windSeed: 1,
    gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
  });
  const state = makeState();
  controller.setMissionProfile(missionId);
  assert(
    controller.startLaunch(state, NOW_MS, {
      launchKind: `booster-terminal-attitude-e2e-${missionId}`,
      boosterEngineCount: 33,
    }),
    `booster_terminal_attitude_e2e: startLaunch rejected for ${missionId}`,
  );

  let nowMs = NOW_MS;
  const phasesSeen = new Set();
  let boosterSeparated = false;
  let sawPhysicalTorque = false;
  let maxBodyAngularRateRadS = 0;
  let terminalPhase = null;

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
    if (state.dynamicBodies.has(LAUNCH_BOOSTER_BODY_ID)) {
      boosterSeparated = true;
    }
    const mode = String(snapshot?.boosterGuidanceMode || "").toLowerCase();
    if (mode) {
      phasesSeen.add(mode);
    }
    const exported = controller.exportPersistentSnapshot(state, nowMs);
    const lastStep = exported?.runtime?.booster?.lastStep || {};
    const torqueText = String(lastStep.attitudeTorqueSourceText || "");
    if (
      torqueText.includes("grid-fins")
      || torqueText.includes("engine-gimbal")
      || torqueText.includes("rcs-thrusters")
      || torqueText.includes("aero-moment")
    ) {
      sawPhysicalTorque = true;
    }
    maxBodyAngularRateRadS = Math.max(
      maxBodyAngularRateRadS,
      length(lastStep.bodyAngularRateRadS || { x: 0, y: 0, z: 0 }),
    );

    if (
      !terminalPhase
      && (
        mode.includes("landing-burn")
        || mode.includes("catch-burn")
        || mode.includes("catch-approach")
        || mode.includes("terminal-intercept")
      )
    ) {
      terminalPhase = {
        elapsedSec: Number(snapshot?.elapsedSeconds) || 0,
        altitudeKm: Number(snapshot?.boosterAltitudeKm) || 0,
        bodyUpAlignment: Number(lastStep.bodyUpAlignment) || 0,
        thrustN: Number(lastStep.thrustN) || 0,
        attitudeTorqueSourceText: torqueText,
        guidanceMode: String(snapshot?.boosterGuidanceMode || ""),
      };
      break;
    }
  }

  return {
    missionId,
    boosterSeparated,
    phasesSeen: Array.from(phasesSeen),
    sawPhysicalTorque,
    maxBodyAngularRateRadS,
    terminalPhase,
  };
}

function main() {
  for (const token of [
    "BOOSTER_FULL_6DOF_RECOVERY_ENABLED",
    "stabilizeBoosterAttitudeTowardDirection",
    "BOOSTER_KINEMATIC_CATCH_ASSIST_ENABLED",
  ]) {
    assert(
      !controllerSource.includes(token),
      `booster_terminal_attitude_e2e: obsolete booster fallback token remains: ${token}`,
    );
  }

  const missionResults = Object.values(LAUNCH_MISSION_IDS)
    .map((missionId) => simulateMissionBoosterRecovery(missionId));

  for (const result of missionResults) {
    assert(
      result.boosterSeparated,
      `booster_terminal_attitude_e2e: booster never separated for ${result.missionId}`,
    );
    for (const expectedPhase of [
      "booster-separation-flip",
      "booster-boostback",
      "booster-descent-coast",
      "booster-entry-align",
    ]) {
      assert(
        result.phasesSeen.includes(expectedPhase),
        `booster_terminal_attitude_e2e: ${result.missionId} missed ${expectedPhase}; saw ${result.phasesSeen.join(", ")}`,
      );
    }
    assert(
      result.terminalPhase,
      `booster_terminal_attitude_e2e: never observed terminal booster phase for ${result.missionId}`,
    );
    assert(
      result.sawPhysicalTorque,
      `booster_terminal_attitude_e2e: no physical attitude torque observed for ${result.missionId}`,
    );
    assert(
      result.maxBodyAngularRateRadS > 1e-4,
      `booster_terminal_attitude_e2e: no integrated booster angular motion for ${result.missionId}`,
    );
  }

  const referencePhases = missionResults[0].phasesSeen.join("|");
  for (const result of missionResults.slice(1)) {
    assert(
      result.phasesSeen.join("|") === referencePhases,
      `booster_terminal_attitude_e2e: booster recovery phases differ by mission ${JSON.stringify(missionResults)}`,
    );
  }

  console.log("PASS booster-terminal-attitude-e2e");
}

main();
