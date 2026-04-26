import fs from "node:fs";
import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import {
  LAUNCH_BODY_ID,
  LAUNCH_BOOSTER_BODY_ID,
} from "../app/static/js/physics/launch/launchConfig.js";
import { STARSHIP_THRUSTER_LAYOUT } from "../app/static/js/physics/launch/thrusterLayout.js";

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
      ["earth", { id: "earth", position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, massKg: EARTH_MASS_KG }],
      ["moon", { id: "moon", position: { x: 384400, y: 0, z: 0 }, velocity: { x: 0, y: 1.022, z: 0 }, massKg: MOON_MASS_KG }],
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
  for (const token of [
    "STARSHIP_THRUSTER_LAYOUT",
    "computeStarshipRcsControlState",
    "stageRcsCombustion",
    "stageRcsPropellantKg",
    "navSensorNoiseActive",
    "desiredEngineIndices: canFire ? commandedThrusterIndices : []",
    "appliedMassLossKg",
  ]) {
    assert(controllerSource.includes(token), `missing Starship RCS/GNC token ${token}`);
  }
  assert(
    !controllerSource.includes("moonCoastRcsAssist || computeRcsAssist"),
    "stage 2 RCS must use the primary physical thruster-layout controller, not the old generic assist",
  );
  assert(
    !controllerSource.includes("function computeRcsAssist(")
      && !controllerSource.includes("function computeStageRcsAngularControlState("),
    "obsolete generic stage RCS assist functions should not remain as fallbacks",
  );

  const thrusterIds = new Set(Object.keys(STARSHIP_THRUSTER_LAYOUT));
  assert(thrusterIds.size >= 6, "expected public-inference Starship RCS layout to include six named thrusters");

  const state = makeState();
  const controller = createHarness();
  assert(controller.startLaunch(state, NOW_MS, { launchKind: "starship-rcs-avionics-lock" }), "startLaunch rejected");

  let nowMs = NOW_MS;
  let sawStage2 = false;
  let sawRcsActive = false;
  let sawRcsTorque = false;
  let sawFinitePropellantUse = false;
  let sawNavNoise = false;
  let sawRcsCombustionTelemetry = false;
  let initialRcsPropellantKg = 0;
  let minRcsPropellantKg = Number.POSITIVE_INFINITY;

  for (let step = 0; step < 230; step += 1) {
    controller.prepareStep(state, DT_SEC, nowMs);
    const earthState = state.staticSources.get("earth");
    for (const bodyId of [LAUNCH_BODY_ID, LAUNCH_BOOSTER_BODY_ID]) {
      const bodyState = state.dynamicBodies.get(bodyId);
      if (bodyState) {
        integrateBody(bodyState, earthState, controller.externalAccelerationKmS2(bodyId), DT_SEC);
      }
    }
    controller.finalizeStep(state, DT_SEC, nowMs);
    nowMs += DT_SEC * 1000;

    const snapshot = controller.statusSnapshot(state);
    if (Number(snapshot?.stageIndex) < 1) {
      continue;
    }
    sawStage2 = true;
    initialRcsPropellantKg = Math.max(initialRcsPropellantKg, Number(snapshot.rcsInitialPropellantKg) || 0);
    const propellantKg = Number(snapshot.rcsPropellantKg);
    if (Number.isFinite(propellantKg) && propellantKg > 0) {
      minRcsPropellantKg = Math.min(minRcsPropellantKg, propellantKg);
    }
    if (
      snapshot.navSource === "starship-gnc-ekf-sim"
      && Number(snapshot.navPositionSigmaKm) > 0
      && Number(snapshot.navVelocitySigmaKmS) > 0
      && Number(snapshot.navAttitudeSigmaDeg) > 0
      && snapshot.navSensorNoiseActive
    ) {
      sawNavNoise = true;
    }
    if (Array.isArray(snapshot.rcsChamberPressurePaByIndex) && snapshot.rcsChamberPressurePaByIndex.length === thrusterIds.size) {
      sawRcsCombustionTelemetry = true;
    }
    if (snapshot.rcsActive) {
      sawRcsActive = true;
      assert(Number(snapshot.rcsThrustN) > 0, "active Starship RCS should report physical thrust");
      assert(Number(snapshot.rcsAccelerationMagKmS2) > 0, "active Starship RCS should report translational acceleration");
      assert(Number(snapshot.rcsBurnRateKgS) > 0, "active Starship RCS should consume propellant");
      assert(Array.isArray(snapshot.rcsActiveThrusterIds) && snapshot.rcsActiveThrusterIds.length > 0, "active Starship RCS should name active thrusters");
      for (const thrusterId of snapshot.rcsActiveThrusterIds) {
        assert(thrusterIds.has(thrusterId), `unknown Starship RCS thruster id ${thrusterId}`);
      }
    }
    if (String(snapshot.attitudeTorqueSourceText || "").includes("rcs-thrusters")) {
      sawRcsTorque = true;
    }
    if (initialRcsPropellantKg > 0 && minRcsPropellantKg < initialRcsPropellantKg) {
      sawFinitePropellantUse = true;
    }
    if (sawRcsActive && sawRcsTorque && sawFinitePropellantUse && sawNavNoise && sawRcsCombustionTelemetry) {
      break;
    }
  }

  assert(sawStage2, "expected launch to reach Starship stage 2");
  assert(sawRcsActive, "expected Starship RCS thrusters to fire after hotstage");
  assert(sawRcsTorque, "expected Starship attitude torque to include RCS thrusters");
  assert(sawFinitePropellantUse, "expected Starship RCS propellant to decrease");
  assert(sawNavNoise, "expected Starship closed-loop navigation to expose sensor noise");
  assert(sawRcsCombustionTelemetry, "expected Starship RCS combustion telemetry for each named thruster");

  console.log("PASS starship-rcs-avionics-realism-lock");
}

main();
