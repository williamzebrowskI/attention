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

const dry = earthAtmosphereSampleUS1976(0);
const moist = earthAtmosphereSampleUS1976(0, { relativeHumidity: 0.8 });

assert(dry.relativeHumidity === null, "dry atmosphere should not report relative humidity by default");
assertApprox(moist.relativeHumidity, 0.8, 1e-12, "moist atmosphere relative humidity");
assertApprox(moist.vaporPressurePa, 1364.1382688841659, 1e-9, "moist atmosphere vapor pressure");
assertApprox(moist.specificHumidityKgKg, 0.008416549673654109, 1e-15, "moist atmosphere specific humidity");
assertApprox(moist.gasConstantJPerKgK, 288.521304902303, 1e-12, "moist atmosphere gas constant");
assertApprox(moist.heatCapacityRatio, 1.398860918085529, 1e-12, "moist atmosphere heat capacity ratio");
assertApprox(moist.densityKgM3, 1.2187654652250661, 1e-12, "moist atmosphere density");
assert(
  moist.densityKgM3 < dry.densityKgM3,
  "moist air should be less dense than dry air at the same temperature and pressure",
);
assert(
  moist.gasConstantJPerKgK > dry.gasConstantJPerKgK,
  "moist air gas constant should exceed dry-air gas constant",
);
assert(
  moist.heatCapacityRatio < dry.heatCapacityRatio,
  "moist air gamma should be below dry-air gamma",
);

const highAltitudeHumid = earthAtmosphereSampleUS1976(30, { relativeHumidity: 0.8 });
assert(
  highAltitudeHumid.relativeHumidity === null,
  "humidity correction should not apply in the thin upper lower-atmosphere layers by default",
);

console.log("atmosphere-moist-air-lock: ok");
