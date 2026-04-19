import { earthAtmosphereSampleUS1976 } from "../app/static/js/physics/atmosphere/atmosphereDynamics.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertApprox(actual, expected, tolerance, message) {
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  const toleranceNumber = Math.max(0, Number(tolerance) || 0);
  assert(
    Number.isFinite(actualNumber)
      && Math.abs(actualNumber - expectedNumber) <= toleranceNumber,
    `${message}: expected ${expectedNumber} +/- ${toleranceNumber}, got ${actualNumber}`,
  );
}

const context = {
  timestampMs: Date.UTC(2026, 3, 18, 16, 0, 0),
  latitudeDeg: 25.9,
  longitudeDeg: -97.2,
};

const references = [
  { altitudeKm: 0, temperatureK: 288.15, pressurePa: 101325, densityKgM3: 1.2250000181, speedOfSoundMs: 340.2939880, gamma: 1.4, tolTemp: 0.001, tolPressure: 0.1, tolDensity: 1e-6, tolSound: 1e-6 },
  { altitudeKm: 11, temperatureK: 216.7735127, pressurePa: 22699.9368, densityKgM3: 0.3648014368, speedOfSoundMs: 295.1535914, gamma: 1.4, tolTemp: 0.01, tolPressure: 0.2, tolDensity: 1e-6, tolSound: 1e-6 },
  { altitudeKm: 20, temperatureK: 216.65, pressurePa: 5529.3054, densityKgM3: 0.0889098739, speedOfSoundMs: 295.0694935, gamma: 1.4, tolTemp: 0.001, tolPressure: 0.1, tolDensity: 1e-7, tolSound: 1e-6 },
  { altitudeKm: 47, temperatureK: 269.6841309, pressurePa: 115.8509516, densityKgM3: 0.0014965193, speedOfSoundMs: 329.2097284, gamma: 1.4, tolTemp: 0.01, tolPressure: 0.01, tolDensity: 1e-9, tolSound: 1e-6 },
  { altitudeKm: 86, temperatureK: 186.9459083, pressurePa: 0.3733798011, densityKgM3: 0.0000069578164, speedOfSoundMs: 274.0961571, gamma: 1.4, tolTemp: 0.01, tolPressure: 1e-5, tolDensity: 1e-10, tolSound: 1e-6 },
  { altitudeKm: 120, temperatureK: 360, pressurePa: 0.0092367482, densityKgM3: 7.56046496e-8, speedOfSoundMs: 414.0718005, gamma: 1.40339753, tolTemp: 0.01, tolPressure: 1e-6, tolDensity: 1e-10, tolSound: 1e-4 },
  { altitudeKm: 200, temperatureK: 900.1078078, pressurePa: 0.0019931067, densityKgM3: 4.01928344e-9, speedOfSoundMs: 883.1362447, gamma: 1.5728, tolTemp: 0.05, tolPressure: 1e-6, tolDensity: 1e-11, tolSound: 1e-4 },
  { altitudeKm: 400, temperatureK: 1076.0512065, pressurePa: 0.0003092699, densityKgM3: 3.04748851e-10, speedOfSoundMs: 1300.5353041, gamma: 5 / 3, tolTemp: 0.05, tolPressure: 1e-7, tolDensity: 1e-12, tolSound: 1e-4 },
];

let previousDensityKgM3 = Number.POSITIVE_INFINITY;
let previousMolarMass = Number.POSITIVE_INFINITY;
let previousGasConstant = 0;
let previousGamma = 0;

for (const reference of references) {
  const sample = earthAtmosphereSampleUS1976(reference.altitudeKm, context);
  assertApprox(sample.temperatureK, reference.temperatureK, reference.tolTemp, `alt ${reference.altitudeKm} km temperature`);
  assertApprox(sample.pressurePa, reference.pressurePa, reference.tolPressure, `alt ${reference.altitudeKm} km pressure`);
  assertApprox(sample.densityKgM3, reference.densityKgM3, reference.tolDensity, `alt ${reference.altitudeKm} km density`);
  assertApprox(sample.speedOfSoundMs, reference.speedOfSoundMs, reference.tolSound, `alt ${reference.altitudeKm} km speed of sound`);
  assertApprox(sample.heatCapacityRatio, reference.gamma, 1e-6, `alt ${reference.altitudeKm} km heat capacity ratio`);
  assert(
    Math.abs(
      sample.speedOfSoundMs
      - Math.sqrt(sample.heatCapacityRatio * sample.gasConstantJPerKgK * sample.temperatureK),
    ) <= 1e-9,
    `alt ${reference.altitudeKm} km speed of sound consistency`,
  );
  assert(
    sample.densityKgM3 < previousDensityKgM3,
    `alt ${reference.altitudeKm} km density should keep decreasing`,
  );
  previousDensityKgM3 = sample.densityKgM3;
  if (Number.isFinite(Number(sample.meanMolarMassKgPerMol))) {
    assert(
      Number(sample.meanMolarMassKgPerMol) <= previousMolarMass,
      `alt ${reference.altitudeKm} km mean molar mass should not increase`,
    );
    previousMolarMass = Number(sample.meanMolarMassKgPerMol);
  }
  assert(
    Number(sample.gasConstantJPerKgK) >= previousGasConstant,
    `alt ${reference.altitudeKm} km gas constant should not decrease`,
  );
  previousGasConstant = Number(sample.gasConstantJPerKgK);
  assert(
    Number(sample.heatCapacityRatio) >= previousGamma,
    `alt ${reference.altitudeKm} km gamma should not decrease`,
  );
  previousGamma = Number(sample.heatCapacityRatio);
  if (reference.altitudeKm <= 86) {
    assert(sample.upperAtmosphereModel === null, `alt ${reference.altitudeKm} km should use lower-atmosphere model`);
  } else {
    assert(sample.upperAtmosphereModel === "nrlmsise-approx", `alt ${reference.altitudeKm} km should use upper-atmosphere model`);
  }
}

console.log("atmosphere-model-lock: ok");
