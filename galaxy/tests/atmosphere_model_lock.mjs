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
  { altitudeKm: 0, layerName: "troposphere", region: "troposphere", temperatureK: 288.15, pressurePa: 101325, densityKgM3: 1.2250000181, speedOfSoundMs: 340.2939880, gamma: 1.4, pressureScaleHeightKm: 8.42285059, dynamicViscosityPaS: 1.789297626e-5, meanFreePathM: 6.633377216e-8, tolTemp: 0.001, tolPressure: 0.1, tolDensity: 1e-6, tolSound: 1e-6, tolScaleHeight: 1e-6, tolViscosity: 1e-12, tolMeanFreePath: 1e-12 },
  { altitudeKm: 5, layerName: "troposphere", region: "troposphere", temperatureK: 255.6755432, pressurePa: 54048.2622, densityKgM3: 0.7364286134, speedOfSoundMs: 320.5454069, gamma: 1.4, pressureScaleHeightKm: 7.48533197, dynamicViscosityPaS: 1.628172926e-5, meanFreePathM: 1.103418181e-7, tolTemp: 0.01, tolPressure: 0.1, tolDensity: 1e-6, tolSound: 1e-6, tolScaleHeight: 1e-6, tolViscosity: 1e-12, tolMeanFreePath: 1e-12 },
  { altitudeKm: 11, layerName: "troposphere", region: "troposphere", temperatureK: 216.7735127, pressurePa: 22699.9368, densityKgM3: 0.3648014368, speedOfSoundMs: 295.1535914, gamma: 1.4, pressureScaleHeightKm: 6.35835945, dynamicViscosityPaS: 1.422226116e-5, meanFreePathM: 2.227482238e-7, tolTemp: 0.01, tolPressure: 0.2, tolDensity: 1e-6, tolSound: 1e-6, tolScaleHeight: 1e-6, tolViscosity: 1e-12, tolMeanFreePath: 1e-12 },
  { altitudeKm: 20, layerName: "tropopause", region: "stratosphere", temperatureK: 216.65, pressurePa: 5529.3054, densityKgM3: 0.0889098739, speedOfSoundMs: 295.0694935, gamma: 1.4, pressureScaleHeightKm: 6.37267232, dynamicViscosityPaS: 1.421547415e-5, meanFreePathM: 9.139465457e-7, tolTemp: 0.001, tolPressure: 0.1, tolDensity: 1e-7, tolSound: 1e-6, tolScaleHeight: 1e-6, tolViscosity: 1e-12, tolMeanFreePath: 1e-12 },
  { altitudeKm: 32, layerName: "stratosphere_lower", region: "stratosphere", temperatureK: 228.4897187, pressurePa: 889.0633333, densityKgM3: 0.0135551442, speedOfSoundMs: 303.0248856, gamma: 1.4, pressureScaleHeightKm: 6.74619552, dynamicViscosityPaS: 1.485864013e-5, meanFreePathM: 5.994688855e-6, tolTemp: 0.01, tolPressure: 0.01, tolDensity: 1e-9, tolSound: 1e-6, tolScaleHeight: 1e-6, tolViscosity: 1e-12, tolMeanFreePath: 1e-11 },
  { altitudeKm: 47, layerName: "stratosphere_upper", region: "stratosphere", temperatureK: 269.6841309, pressurePa: 115.8509516, densityKgM3: 0.0014965193, speedOfSoundMs: 329.2097284, gamma: 1.4, pressureScaleHeightKm: 7.99981736, dynamicViscosityPaS: 1.698794372e-5, meanFreePathM: 5.429857969e-5, tolTemp: 0.01, tolPressure: 0.01, tolDensity: 1e-9, tolSound: 1e-6, tolScaleHeight: 1e-6, tolViscosity: 1e-12, tolMeanFreePath: 1e-10 },
  { altitudeKm: 51, layerName: "stratopause", region: "mesosphere", temperatureK: 270.65, pressurePa: 70.4579830, densityKgM3: 0.0009069018, speedOfSoundMs: 329.7987310, gamma: 1.4, pressureScaleHeightKm: 8.03847911, dynamicViscosityPaS: 1.703599659e-5, meanFreePathM: 8.960051548e-5, tolTemp: 0.001, tolPressure: 0.01, tolDensity: 1e-9, tolSound: 1e-6, tolScaleHeight: 1e-6, tolViscosity: 1e-12, tolMeanFreePath: 1e-10 },
  { altitudeKm: 71, layerName: "mesosphere_lower", region: "mesosphere", temperatureK: 216.8459107, pressurePa: 4.4795545, densityKgM3: 0.0000719650607, speedOfSoundMs: 295.2028750, gamma: 1.4, pressureScaleHeightKm: 6.48064046, dynamicViscosityPaS: 1.422623865e-5, meanFreePathM: 0.001129143383, tolTemp: 0.01, tolPressure: 1e-4, tolDensity: 1e-10, tolSound: 1e-6, tolScaleHeight: 1e-6, tolViscosity: 1e-12, tolMeanFreePath: 1e-9 },
  { altitudeKm: 86, layerName: "mesosphere_upper", region: "mesosphere", temperatureK: 186.9459083, pressurePa: 0.3733798011, densityKgM3: 0.0000069578164, speedOfSoundMs: 274.0961571, gamma: 1.4, pressureScaleHeightKm: 5.61310007, dynamicViscosityPaS: 1.253283849e-5, meanFreePathM: 0.011678789411, tolTemp: 0.01, tolPressure: 1e-5, tolDensity: 1e-10, tolSound: 1e-6, tolScaleHeight: 1e-6, tolViscosity: 1e-12, tolMeanFreePath: 1e-9 },
  { altitudeKm: 120, layerName: "thermosphere", region: "thermosphere", temperatureK: 346.3503546, pressurePa: 0.0028018593, densityKgM3: 2.77913481e-8, speedOfSoundMs: 376.9949150, gamma: 1.40972458, pressureScaleHeightKm: 10.65671325, dynamicViscosityPaS: 2.057462958e-5, meanFreePathM: 2.883380732, tolTemp: 0.01, tolPressure: 1e-7, tolDensity: 1e-11, tolSound: 1e-4, tolScaleHeight: 1e-6, tolViscosity: 1e-12, tolMeanFreePath: 1e-8 },
  { altitudeKm: 200, layerName: "thermosphere", region: "thermosphere", temperatureK: 539.6335700, pressurePa: 0.0000121065, densityKgM3: 6.44089878e-11, speedOfSoundMs: 525.5244530, gamma: 1.46931106, pressureScaleHeightKm: 20.36096607, dynamicViscosityPaS: 2.811577867e-5, meanFreePathM: 1039.7120002, tolTemp: 0.05, tolPressure: 1e-8, tolDensity: 1e-12, tolSound: 1e-4, tolScaleHeight: 1e-6, tolViscosity: 1e-12, tolMeanFreePath: 1e-5 },
  { altitudeKm: 400, layerName: "thermosphere", region: "thermosphere", temperatureK: 782.0379793, pressurePa: 0.0000000268, densityKgM3: 6.58853259e-14, speedOfSoundMs: 818.6200652, gamma: 1.64736069, pressureScaleHeightKm: 46.78913334, dynamicViscosityPaS: 3.572738142e-5, meanFreePathM: 680605.9760212, tolTemp: 0.05, tolPressure: 1e-10, tolDensity: 1e-15, tolSound: 1e-4, tolScaleHeight: 1e-6, tolViscosity: 1e-12, tolMeanFreePath: 1e-2 },
];

let previousDensityKgM3 = Number.POSITIVE_INFINITY;
let previousMolarMass = Number.POSITIVE_INFINITY;
let previousGasConstant = 0;
let previousGamma = 0;
let previousMeanFreePathM = 0;

for (const reference of references) {
  const sample = earthAtmosphereSampleUS1976(reference.altitudeKm, context);
  assertApprox(sample.temperatureK, reference.temperatureK, reference.tolTemp, `alt ${reference.altitudeKm} km temperature`);
  assertApprox(sample.pressurePa, reference.pressurePa, reference.tolPressure, `alt ${reference.altitudeKm} km pressure`);
  assertApprox(sample.densityKgM3, reference.densityKgM3, reference.tolDensity, `alt ${reference.altitudeKm} km density`);
  assertApprox(sample.speedOfSoundMs, reference.speedOfSoundMs, reference.tolSound, `alt ${reference.altitudeKm} km speed of sound`);
  assertApprox(sample.heatCapacityRatio, reference.gamma, 1e-6, `alt ${reference.altitudeKm} km heat capacity ratio`);
  assertApprox(sample.pressureScaleHeightKm, reference.pressureScaleHeightKm, reference.tolScaleHeight, `alt ${reference.altitudeKm} km pressure scale height`);
  assertApprox(sample.dynamicViscosityPaS, reference.dynamicViscosityPaS, reference.tolViscosity, `alt ${reference.altitudeKm} km dynamic viscosity`);
  assertApprox(sample.meanFreePathM, reference.meanFreePathM, reference.tolMeanFreePath, `alt ${reference.altitudeKm} km mean free path`);
  assert(sample.layerName === reference.layerName, `alt ${reference.altitudeKm} km layer name`);
  assert(sample.atmosphericRegion === reference.region, `alt ${reference.altitudeKm} km atmospheric region`);
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
  assert(
    Number(sample.meanFreePathM) >= previousMeanFreePathM,
    `alt ${reference.altitudeKm} km mean free path should not decrease`,
  );
  previousMeanFreePathM = Number(sample.meanFreePathM);
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
  assert(sample.relativeHumidity === null, `alt ${reference.altitudeKm} km should default to dry atmosphere`);
  if (reference.altitudeKm <= 86) {
    assert(sample.upperAtmosphereModel === null, `alt ${reference.altitudeKm} km should use lower-atmosphere model`);
  } else {
    assert(sample.upperAtmosphereModel === "nrlmsise-00-class", `alt ${reference.altitudeKm} km should use upper-atmosphere model`);
    assert(
      Number(sample.dragEffectiveDensityKgM3) >= Number(sample.densityKgM3),
      `alt ${reference.altitudeKm} km drag-effective density should be >= bulk density`,
    );
  }
}

const highAltitudeDrag = earthAtmosphereSampleUS1976(600, context);
assert(
  Number(highAltitudeDrag.dragEffectiveDensityKgM3) > Number(highAltitudeDrag.densityKgM3),
  "600 km drag-effective density should include anomalous oxygen enhancement",
);

console.log("atmosphere-model-lock: ok");
