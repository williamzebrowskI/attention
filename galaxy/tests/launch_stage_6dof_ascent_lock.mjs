import fs from "node:fs";
import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { LAUNCH_BODY_ID } from "../app/static/js/physics/launch/launchConfig.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 5, 18, 0, 0);
const DT_SEC = 1;

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

function main() {
  assert(
    controllerSource.includes("const STAGE_FULL_6DOF_ASCENT_ENABLED = true;"),
    "stage ascent 6-DOF flag must stay enabled",
  );
  assert(
    !controllerSource.includes("runtime.stageActuator = applyActuatorModel(runtime.stageActuator"),
    "stage ascent must not use direct actuator direction slewing",
  );
  for (const token of [
    "runtime.stageActuator = updateStageThrottleState(runtime.stageActuator",
    "computeStageEngineAngularControlState",
    "integrateBoosterAttitudeState(runtime.stageAttitude",
    "thrustVectorDirectionActual",
    "attitudeTorqueSources: stageAttitudeTorqueSources",
  ]) {
    assert(controllerSource.includes(token), `missing physical stage attitude token ${token}`);
  }

  const state = makeState();
  const controller = createHarness();
  assert(controller.startLaunch(state, NOW_MS, { launchKind: "stage-6dof-lock" }), "startLaunch rejected");

  let nowMs = NOW_MS;
  let sawPitchProgram = false;
  let sawEngineGimbalTorque = false;
  let sawPhysicalThrustVector = false;
  let maxCommandBodyLagDeg = 0;
  let maxBodyPitchDeg = 0;
  let maxBodyAngularRate = 0;

  for (let step = 0; step < 85; step += 1) {
    controller.prepareStep(state, DT_SEC, nowMs);
    const earthState = state.staticSources.get("earth");
    const shipState = state.dynamicBodies.get(LAUNCH_BODY_ID);
    assert(shipState, "missing launch body during stage ascent lock");
    integrateBody(shipState, earthState, controller.externalAccelerationKmS2(LAUNCH_BODY_ID), DT_SEC);
    controller.finalizeStep(state, DT_SEC, nowMs);
    nowMs += DT_SEC * 1000;

    const snapshot = controller.statusSnapshot(state);
    const guidanceMode = String(snapshot?.guidanceMode || "");
    if (guidanceMode.includes("pitch-program")) {
      sawPitchProgram = true;
    }
    const torqueText = String(snapshot?.attitudeTorqueSourceText || "");
    if (torqueText.includes("engine-gimbal")) {
      sawEngineGimbalTorque = true;
    }
    if (snapshot?.thrustVectorDirectionKm) {
      sawPhysicalThrustVector = true;
    }
    const commandPitch = Number(snapshot?.commandedPitchFromVerticalDeg) || 0;
    const bodyPitch = Number(snapshot?.bodyPitchFromVerticalDeg) || 0;
    if (commandPitch > 1) {
      maxCommandBodyLagDeg = Math.max(maxCommandBodyLagDeg, Math.abs(commandPitch - bodyPitch));
    }
    maxBodyPitchDeg = Math.max(maxBodyPitchDeg, bodyPitch);
    maxBodyAngularRate = Math.max(maxBodyAngularRate, length(snapshot?.bodyAngularRateRadS || { x: 0, y: 0, z: 0 }));
  }

  assert(sawPitchProgram, "expected launch guidance to enter pitch-program");
  assert(sawEngineGimbalTorque, "expected stage attitude to be driven by engine-gimbal torque");
  assert(sawPhysicalThrustVector, "expected translational thrust to use a physical thrust vector");
  assert(maxCommandBodyLagDeg > 0.25, `expected body attitude to lag command physically, got ${maxCommandBodyLagDeg} deg`);
  assert(maxBodyPitchDeg > 3.0, `expected physical stage attitude to pitch over, got ${maxBodyPitchDeg} deg`);
  assert(maxBodyAngularRate > 1e-4, `expected nonzero integrated body angular rate, got ${maxBodyAngularRate}`);

  console.log("PASS launch-stage-6dof-ascent-lock");
}

main();
