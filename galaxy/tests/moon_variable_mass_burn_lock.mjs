import {
  burnDurationForDeltaVSec,
  propagateMoonGuidanceState,
} from "../app/static/js/physics/runtime/index.js";

const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const STANDARD_GRAVITY_M_S2 = 9.80665;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function closeEnough(actual, expected, tolerance, message) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message} (expected ${expected}, got ${actual}, tol ${tolerance})`);
  }
}

function main() {
  const spacecraft = {
    bodyId: "moon_variable_mass_lock_vehicle",
    massKg: 1_320_000,
    dryMassKg: 120_000,
    propellantMassKg: 1_200_000,
    thrustVacuumN: 13_500_000,
    thrustSeaLevelN: 11_400_000,
    ispVacuumS: 380,
    ispSeaLevelS: 330,
    ambientPressurePa: 0,
    radiusKm: 0.0045,
    reflectivityCoeff: 1.45,
  };
  const accelAtThrottle1KmS2 = (spacecraft.thrustVacuumN / spacecraft.massKg) / 1000;
  const throttle = 0.72;
  const deltaVNeedKmS = 3.18;
  const burnDurationSec = burnDurationForDeltaVSec(
    deltaVNeedKmS,
    accelAtThrottle1KmS2,
    throttle,
    spacecraft,
  );
  const massFlowKgS = (spacecraft.thrustVacuumN * throttle) / (spacecraft.ispVacuumS * STANDARD_GRAVITY_M_S2);
  const expectedFinalMassKg = Math.max(spacecraft.dryMassKg, spacecraft.massKg - (massFlowKgS * burnDurationSec));

  const propagation = propagateMoonGuidanceState({
    initialState: {
      positionKm: { x: EARTH_RADIUS_KM + 500, y: 0, z: 0 },
      velocityKmS: { x: 0, y: 7.62, z: 0 },
      massKg: spacecraft.massKg,
    },
    durationSec: burnDurationSec,
    stepSec: 10,
    sources: {
      earth: {
        id: "earth",
        positionKm: { x: 0, y: 0, z: 0 },
        velocityKmS: { x: 0, y: 0, z: 0 },
        massKg: EARTH_MASS_KG,
        radiusKm: EARTH_RADIUS_KM,
        referenceRadiusKm: 6378.137,
        axes: {
          pole: { x: 0, y: 0, z: 1 },
          xAxis: { x: 1, y: 0, z: 0 },
          yAxis: { x: 0, y: 1, z: 0 },
        },
      },
    },
    spacecraft,
    burnCommand: {
      direction: { x: 0, y: 1, z: 0 },
      throttle,
      accelAtThrottle1KmS2,
      burnDurationSec,
    },
  });

  assert(propagation?.finalState, "moon_variable_mass_burn_lock: missing propagated final state");
  assert(
    Number(propagation.finalState.massKg) < spacecraft.massKg - 1,
    `moon_variable_mass_burn_lock: spacecraft mass did not decrease (${propagation.finalState.massKg}kg)`,
  );
  assert(
    Number(propagation.finalState.massKg) > spacecraft.dryMassKg,
    `moon_variable_mass_burn_lock: burn should not deplete to dry mass (${propagation.finalState.massKg}kg)`,
  );
  closeEnough(
    Number(propagation.finalState.massKg),
    expectedFinalMassKg,
    Math.max(50, expectedFinalMassKg * 0.001),
    "moon_variable_mass_burn_lock: propagated mass should track thrust/Isp consumption",
  );

  const constantAccelDurationSec = burnDurationForDeltaVSec(
    deltaVNeedKmS,
    accelAtThrottle1KmS2,
    throttle,
  );
  assert(
    Math.abs(burnDurationSec - constantAccelDurationSec) > 5,
    "moon_variable_mass_burn_lock: variable-mass burn duration should differ from constant-acceleration fallback",
  );

  console.log("PASS moon-variable-mass-burn-lock");
}

main();
