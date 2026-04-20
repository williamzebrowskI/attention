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
const MAX_STEPS = 320;

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

function angleDeg(a, b) {
  const ua = normalize(a);
  const ub = normalize(b);
  const cosine = Math.max(-1, Math.min(1, dot(ua, ub)));
  return Math.acos(cosine) * (180 / Math.PI);
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

function main() {
  const state = makeState();
  const controller = createHarness();
  controller.setMissionProfile(LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO);
  assert(controller.startLaunch(state, NOW_MS, { launchKind: "booster-6dof-lock" }), "startLaunch rejected");

  let nowMs = NOW_MS;
  let boosterActivationStep = -1;
  const samples = [];

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
    const liveBooster = state.dynamicBodies.get(LAUNCH_BOOSTER_BODY_ID);
    if (Boolean(snapshot.boosterActive) && liveBooster) {
      if (boosterActivationStep < 0) {
        boosterActivationStep = step;
      }
      if (snapshot.boosterBodyAxisDirectionKm) {
        const up = normalize(subtract(liveBooster.position, earthState.position));
        const retrograde = normalize(
          scale(subtract(liveBooster.velocity, earthState.velocity || { x: 0, y: 0, z: 0 }), -1),
          up,
        );
        samples.push({
          axis: normalize(snapshot.boosterBodyAxisDirectionKm),
          up,
          req: snapshot.boosterRequestedDirectionKm
            ? normalize(snapshot.boosterRequestedDirectionKm, retrograde)
            : null,
          reqRetro: snapshot.boosterRequestedDirectionKm
            ? dot(normalize(snapshot.boosterRequestedDirectionKm, retrograde), retrograde)
            : null,
          cmdOffRetro: Number.isFinite(Number(snapshot.boosterRequestedOffRetrogradeDeg))
            ? Number(snapshot.boosterRequestedOffRetrogradeDeg)
            : null,
          omega: length(snapshot.boosterBodyAngularRateRadS || { x: 0, y: 0, z: 0 }),
          rcsAccel: Number(snapshot.boosterRcsAccelerationMagKmS2) || 0,
        });
      }
      if (samples.length >= 24) {
        break;
      }
    }
  }

  assert(boosterActivationStep >= 0, `expected booster to activate, got ${boosterActivationStep}`);
  assert(samples.length >= 12, `expected early booster attitude samples, got ${samples.length}`);

  const initial = samples[0];
  const initialCommandSample = samples.find((sample) => Number.isFinite(sample.reqRetro));
  const initialUpDot = dot(initial.axis, initial.up);
  assert(
    initialUpDot < 0.985,
    `expected staged booster axis to inherit the pitched stack, got dot(body, up)=${initialUpDot}`,
  );
  assert(
    Number.isFinite(initialCommandSample?.reqRetro) && initialCommandSample.reqRetro < -0.95,
    `expected early separation command to stay near inherited attitude, got requested retrograde alignment ${initialCommandSample?.reqRetro}`,
  );

  let maxStepAngleDeg = 0;
  let maxEarlyStepAngleDeg = 0;
  let totalTurnDeg = 0;
  let maxOmega = 0;
  let maxRcsAccel = 0;
  let minCommandOffRetroDeg = Number.POSITIVE_INFINITY;
  for (let index = 1; index < samples.length; index += 1) {
    const stepAngle = angleDeg(samples[index - 1].axis, samples[index].axis);
    maxStepAngleDeg = Math.max(maxStepAngleDeg, stepAngle);
    if (index <= 5) {
      maxEarlyStepAngleDeg = Math.max(maxEarlyStepAngleDeg, stepAngle);
    }
    totalTurnDeg += stepAngle;
    maxOmega = Math.max(maxOmega, Number(samples[index].omega) || 0);
    maxRcsAccel = Math.max(maxRcsAccel, Number(samples[index].rcsAccel) || 0);
    if (Number.isFinite(samples[index].cmdOffRetro)) {
      minCommandOffRetroDeg = Math.min(minCommandOffRetroDeg, Number(samples[index].cmdOffRetro));
    }
  }

  const midSample = samples[Math.min(10, samples.length - 1)];
  const lateSample = samples[samples.length - 1];

  assert(maxStepAngleDeg < 18, `expected continuous 6-DOF attitude motion, got max step angle ${maxStepAngleDeg} deg`);
  assert(maxEarlyStepAngleDeg < 8, `expected gentle early post-hotstage settling, got max early step angle ${maxEarlyStepAngleDeg} deg`);
  assert(totalTurnDeg > 4.2, `expected the booster to keep rotating after separation, got total turn ${totalTurnDeg} deg`);
  assert(
    Number.isFinite(midSample?.reqRetro) && Number.isFinite(initialCommandSample?.reqRetro) && midSample.reqRetro > initialCommandSample.reqRetro + 0.05,
    `expected commanded flip target to start slewing methodically, got initial reqRetro ${initialCommandSample?.reqRetro} mid ${midSample?.reqRetro}`,
  );
  assert(
    Number.isFinite(lateSample?.reqRetro) && lateSample.reqRetro > 0.1,
    `expected commanded flip target to progress well toward retrograde, got late requested retrograde alignment ${lateSample?.reqRetro}`,
  );
  assert(minCommandOffRetroDeg < 90, `expected the commanded flip target to move materially toward retrograde, got minimum off-retro ${minCommandOffRetroDeg} deg`);
  assert(maxOmega > 0.01, `expected nontrivial angular-rate build-up, got ${maxOmega} rad/s`);
  assert(maxRcsAccel > 1e-7, `expected booster RCS to contribute translational acceleration, got ${maxRcsAccel} km/s^2`);

  console.log("PASS booster-6dof-attitude-lock");
}

main();
