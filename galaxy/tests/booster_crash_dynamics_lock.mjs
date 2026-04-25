import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import {
  LAUNCH_BOOSTER_BODY_ID,
  LAUNCH_BODY_ID,
} from "../app/static/js/physics/launch/launchConfig.js";
import {
  add,
  dot,
  length,
  normalize,
  quaternionFromUnitVectors,
  scale,
  subtract,
} from "../app/static/js/physics/launch/launchMath.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const EQUATORIAL_SURFACE_RADIUS_KM = 6378.137;
const NOW_MS = Date.UTC(2026, 3, 23, 16, 0, 0);
const DT_SEC = 1 / 60;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
    ]),
  };
}

function makeController() {
  return createLaunchController({
    getEarthRadiusKm: () => EARTH_RADIUS_KM,
    getEarthMassKg: () => EARTH_MASS_KG,
    getBodyRadiusKm: () => EARTH_RADIUS_KM,
    getBodyMassKg: () => EARTH_MASS_KG,
    getEarthFixedAxesEcliptic: earthAxes,
    sampleEarthAtmosphere: () => ({
      pressurePa: 101325,
      densityKgM3: 1.225,
      speedOfSoundMS: 340,
    }),
    sampleLaunchWeather: () => ({
      windEastMS: 0,
      windNorthMS: 0,
    }),
    gravitationalConstantKm3PerKgS2: G_KM3_KG_S2,
  });
}

function main() {
  const state = makeState();
  const controller = makeController();
  const up = { x: 1, y: 0, z: 0 };
  const tiltedAxis = normalize({ x: 0.88, y: 0.34, z: 0.20 }, up);
  const attitude = {
    orientation: quaternionFromUnitVectors({ x: 0, y: 1, z: 0 }, tiltedAxis),
    omegaBodyRadS: { x: 0.34, y: 0, z: 0.12 },
  };
  const boosterPosition = { x: EQUATORIAL_SURFACE_RADIUS_KM + 0.045, y: 0, z: 0 };
  const boosterVelocity = { x: -0.035, y: 0.030, z: 0.010 };
  const imported = controller.importPersistentSnapshot(state, {
    version: 1,
    savedAtMs: NOW_MS,
    runtime: {
      commandPhase: "coast",
      elapsedSeconds: 360,
      booster: {
        attached: false,
        active: false,
        crashed: true,
        landed: false,
        commandPhase: "crashed",
        guidanceMode: "booster-crashed-surface-impact-attitude",
        terminalOutcome: "crashed",
        terminalReason: "surface-impact-attitude",
        impactSpeedKmS: 0.047,
        impactVerticalSpeedKmS: -0.035,
        impactLateralSpeedKmS: 0.032,
        impactBodyUpAlignment: dot(tiltedAxis, up),
        attitude,
        crashDynamics: {
          active: true,
          mode: "surface-impact",
        },
        lastStep: {
          accelerationKmS2: { x: 0, y: 0, z: 0 },
          guidanceMode: "booster-crashed-surface-impact-attitude",
          bodyAxisDirectionKm: tiltedAxis,
          bodyAngularRateRadS: attitude.omegaBodyRadS,
        },
      },
    },
    managedBodies: [
      {
        id: LAUNCH_BOOSTER_BODY_ID,
        massKg: 240000,
        position: boosterPosition,
        velocity: boosterVelocity,
      },
      {
        id: LAUNCH_BODY_ID,
        massKg: 200000,
        position: { x: EQUATORIAL_SURFACE_RADIUS_KM + 2, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
      },
    ],
  }, NOW_MS);
  assert(imported.applied, `booster_crash_dynamics_lock: import failed ${JSON.stringify(imported)}`);

  let nowMs = NOW_MS;
  let firstTipDeg = null;
  let maxTipDeg = 0;
  let maxSlideKmS = 0;
  let observedSurfaceContact = false;
  let observedSettled = false;

  for (let step = 0; step < 240; step += 1) {
    controller.prepareStep(state, DT_SEC, nowMs);
    const earthState = state.staticSources.get("earth");
    const boosterState = state.dynamicBodies.get(LAUNCH_BOOSTER_BODY_ID);
    integrateBody(
      boosterState,
      earthState,
      controller.externalAccelerationKmS2(LAUNCH_BOOSTER_BODY_ID),
      DT_SEC,
    );
    controller.finalizeStep(state, DT_SEC, nowMs);
    nowMs += DT_SEC * 1000;

    const snapshot = controller.statusSnapshot(state);
    const tipDeg = Number(snapshot.boosterCrashTipAngleDeg) || 0;
    const slideKmS = Number(snapshot.boosterCrashSlideSpeedKmS) || 0;
    if (firstTipDeg === null && tipDeg > 0) {
      firstTipDeg = tipDeg;
    }
    maxTipDeg = Math.max(maxTipDeg, tipDeg);
    maxSlideKmS = Math.max(maxSlideKmS, slideKmS);
    observedSurfaceContact = observedSurfaceContact || Boolean(snapshot.boosterCrashSurfaceContact);
    observedSettled = observedSettled || Boolean(snapshot.boosterCrashSettled);
  }

  const finalSnapshot = controller.statusSnapshot(state);
  assert(finalSnapshot.boosterCrashed, "booster_crash_dynamics_lock: booster should remain crashed");
  assert(
    finalSnapshot.boosterCrashDynamicsActive || finalSnapshot.boosterCrashSettled,
    `booster_crash_dynamics_lock: crash dynamics stopped without settling ${JSON.stringify(finalSnapshot)}`,
  );
  assert(observedSurfaceContact, "booster_crash_dynamics_lock: never observed crash surface contact");
  assert(
    maxSlideKmS > 0.002,
    `booster_crash_dynamics_lock: expected post-impact sliding, got max ${maxSlideKmS}`,
  );
  assert(
    maxTipDeg >= Math.max(35, (firstTipDeg || 0) + 6) || observedSettled,
    `booster_crash_dynamics_lock: expected tip-over progression, got first=${firstTipDeg} max=${maxTipDeg}`,
  );
  assert(
    Number(finalSnapshot.boosterCrashClearanceKm) < 0.036,
    `booster_crash_dynamics_lock: clearance did not respond to tilted body ${finalSnapshot.boosterCrashClearanceKm}`,
  );

  console.log("PASS booster-crash-dynamics-lock");
}

main();
