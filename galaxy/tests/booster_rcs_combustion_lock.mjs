import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { LAUNCH_BODY_ID, LAUNCH_BOOSTER_BODY_ID } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const NOW_MS = Date.UTC(2026, 2, 5, 18, 30, 0);
const DT_SEC = 1;
const MAX_STEPS = 360;

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
  const scaleHeightKm = 7.5;
  const attenuation = Math.exp(-safeAltitudeKm / scaleHeightKm);
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

function validThrusterIndex(index) {
  return Number.isInteger(index) && index >= 0 && index < 6;
}

function main() {
  const state = makeState();
  const controller = createHarness();
  controller.setMissionProfile(LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO);
  assert(controller.startLaunch(state, NOW_MS, { launchKind: "booster-rcs-combustion-lock" }), "startLaunch rejected");

  let nowMs = NOW_MS;
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
    if (!snapshot.boosterActive || !snapshot.boosterRcsActive) {
      continue;
    }

    assert(snapshot.boosterRcsBurnRateKgS > 0, `expected positive booster RCS burn rate, got ${snapshot.boosterRcsBurnRateKgS}`);
    assert(Array.isArray(snapshot.boosterRcsActiveThrusterIndices), "expected active booster RCS thruster indices array");
    assert(Array.isArray(snapshot.boosterRcsJets), "expected active booster RCS jet id array");
    assert(snapshot.boosterRcsActiveThrusterIndices.length > 0, "expected at least one active booster RCS thruster");
    assert(
      snapshot.boosterRcsActiveThrusterIndices.every(validThrusterIndex),
      `expected active booster RCS thruster indices within 0..5, got ${JSON.stringify(snapshot.boosterRcsActiveThrusterIndices)}`,
    );
    assert(
      snapshot.boosterRcsFailedThrusterIndices.every(validThrusterIndex),
      `expected failed booster RCS thruster indices within 0..5, got ${JSON.stringify(snapshot.boosterRcsFailedThrusterIndices)}`,
    );
    assert(
      snapshot.boosterRcsFaultedThrusterIndices.every(validThrusterIndex),
      `expected faulted booster RCS thruster indices within 0..5, got ${JSON.stringify(snapshot.boosterRcsFaultedThrusterIndices)}`,
    );
    assert(
      snapshot.boosterRcsFlamePresentThrusterIndices.every(validThrusterIndex),
      `expected flame-present booster RCS thruster indices within 0..5, got ${JSON.stringify(snapshot.boosterRcsFlamePresentThrusterIndices)}`,
    );
    assert(
      Array.isArray(snapshot.boosterRcsChamberPressurePaByIndex) && snapshot.boosterRcsChamberPressurePaByIndex.length === 6,
      `expected six booster RCS chamber-pressure channels, got ${JSON.stringify(snapshot.boosterRcsChamberPressurePaByIndex)}`,
    );
    assert(
      Array.isArray(snapshot.boosterRcsExhaustTemperatureKByIndex) && snapshot.boosterRcsExhaustTemperatureKByIndex.length === 6,
      `expected six booster RCS exhaust-temperature channels, got ${JSON.stringify(snapshot.boosterRcsExhaustTemperatureKByIndex)}`,
    );
    assert(
      Array.isArray(snapshot.boosterRcsCombustionEfficiencyByIndex) && snapshot.boosterRcsCombustionEfficiencyByIndex.length === 6,
      `expected six booster RCS combustion-efficiency channels, got ${JSON.stringify(snapshot.boosterRcsCombustionEfficiencyByIndex)}`,
    );
    assert(
      Array.isArray(snapshot.boosterRcsTurbopumpNormByIndex) && snapshot.boosterRcsTurbopumpNormByIndex.length === 6,
      `expected six booster RCS turbopump channels, got ${JSON.stringify(snapshot.boosterRcsTurbopumpNormByIndex)}`,
    );
    assert(
      Array.isArray(snapshot.boosterRcsThrusterThrustNByIndex) && snapshot.boosterRcsThrusterThrustNByIndex.length === 6,
      `expected six booster RCS thrust channels, got ${JSON.stringify(snapshot.boosterRcsThrusterThrustNByIndex)}`,
    );
    assert(snapshot.boosterRcsAvgChamberPressurePa > 0, `expected positive booster RCS avg chamber pressure, got ${snapshot.boosterRcsAvgChamberPressurePa}`);
    assert(snapshot.boosterRcsMaxChamberPressurePa > 0, `expected positive booster RCS max chamber pressure, got ${snapshot.boosterRcsMaxChamberPressurePa}`);
    assert(snapshot.boosterRcsAvgCombustionEfficiency > 0, `expected positive booster RCS avg combustion efficiency, got ${snapshot.boosterRcsAvgCombustionEfficiency}`);
    assert(snapshot.boosterRcsAvgTurbopumpNorm > 0, `expected positive booster RCS avg turbopump norm, got ${snapshot.boosterRcsAvgTurbopumpNorm}`);
    assert(snapshot.boosterRcsMaxExhaustTemperatureK > 700, `expected hot booster RCS exhaust temperature, got ${snapshot.boosterRcsMaxExhaustTemperatureK}`);
    assert(
      snapshot.boosterRcsThrusterThrustNByIndex.some((value) => Number(value) > 1),
      `expected at least one firing booster RCS thruster, got ${JSON.stringify(snapshot.boosterRcsThrusterThrustNByIndex)}`,
    );
    assert(
      snapshot.boosterRcsChamberPressurePaByIndex.some((value) => Number(value) > 1),
      `expected at least one pressurized booster RCS chamber, got ${JSON.stringify(snapshot.boosterRcsChamberPressurePaByIndex)}`,
    );

    console.log("PASS booster-rcs-combustion-lock");
    return;
  }

  throw new Error("expected booster RCS combustion telemetry during booster return");
}

main();
