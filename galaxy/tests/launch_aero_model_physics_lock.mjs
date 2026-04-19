import { computeAerodynamicResponse } from "../app/static/js/physics/launch/launchAeroModel.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const atmosphere = {
  densityKgM3: 0.7,
  dragEffectiveDensityKgM3: 0.7,
  temperatureK: 250,
  speedOfSoundMs: 320,
};

const relPos = { x: 0, y: 0, z: 6500 };
const relVel = { x: 0.9, y: 0, z: 0 };
const earthPole = { x: 0, y: 0, z: 1 };
const bodyAxisDirection = { x: 0.995, y: 0, z: 0.1 };
const fullMassModel = { comNormalized: 0.55 };
const lateMassModel = { comNormalized: 0.66 };

const powerOff = computeAerodynamicResponse({
  bodyKind: "stage1",
  atmosphereSample: atmosphere,
  relPos,
  relVel,
  earthPole,
  bodyAxisDirection,
  referenceAreaM2: 63.62,
  massKg: 3_000_000,
  massModel: fullMassModel,
  throttle: 0,
});

const powerOn = computeAerodynamicResponse({
  bodyKind: "stage1",
  atmosphereSample: atmosphere,
  relPos,
  relVel,
  earthPole,
  bodyAxisDirection,
  referenceAreaM2: 63.62,
  massKg: 3_000_000,
  massModel: fullMassModel,
  throttle: 1,
});

const lateBurn = computeAerodynamicResponse({
  bodyKind: "stage1",
  atmosphereSample: atmosphere,
  relPos,
  relVel,
  earthPole,
  bodyAxisDirection,
  referenceAreaM2: 63.62,
  massKg: 1_200_000,
  massModel: lateMassModel,
  throttle: 1,
});

assert(powerOn.dragCoefficient < powerOff.dragCoefficient, "aero-model-lock: expected power-on base drag relief");
assert(powerOn.centerOfPressureNormalized < fullMassModel.comNormalized, "aero-model-lock: expected stable CP aft of CG");
assert(lateBurn.staticMarginNormalized > powerOn.staticMarginNormalized, "aero-model-lock: expected static margin to grow as CG shifts forward");
assert(Math.abs(lateBurn.momentCoefficient) > Math.abs(powerOn.momentCoefficient), "aero-model-lock: expected stronger restoring moment late in burn");

console.log("launch-aero-model-physics-lock: ok");
