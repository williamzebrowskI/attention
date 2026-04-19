import { sampleWindVectorKmS } from "../app/static/js/physics/launch/launchAeroModel.js";

const EARTH_RADIUS_KM = 6371.0084;

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

function relativePositionKm(latitudeDeg, longitudeDeg, altitudeKm = 0) {
  const latRad = (Math.PI / 180) * latitudeDeg;
  const lonRad = (Math.PI / 180) * longitudeDeg;
  const radiusKm = EARTH_RADIUS_KM + altitudeKm;
  return {
    x: radiusKm * Math.cos(latRad) * Math.cos(lonRad),
    y: radiusKm * Math.cos(latRad) * Math.sin(lonRad),
    z: radiusKm * Math.sin(latRad),
  };
}

const earthAxes = {
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 1, z: 0 },
  pole: { x: 0, y: 0, z: 1 },
};

const bocaTimestampMs = Date.UTC(2026, 3, 18, 16, 0, 0);
const bocaAltitudes = [
  { altitudeKm: 0, eastMS: 2.61658, northMS: -4.53922, speedMS: 5.23937, tol: 0.08 },
  { altitudeKm: 5, eastMS: 12.39690, northMS: 0.75472, speedMS: 12.41985, tol: 0.08 },
  { altitudeKm: 10, eastMS: 27.27317, northMS: -1.76771, speedMS: 27.33040, tol: 0.12 },
  { altitudeKm: 12, eastMS: 32.01680, northMS: -2.44360, speedMS: 32.10991, tol: 0.12 },
  { altitudeKm: 25, eastMS: 8.14330, northMS: -2.49791, speedMS: 8.51780, tol: 0.08 },
  { altitudeKm: 50, eastMS: -7.10061, northMS: -1.26945, speedMS: 7.21319, tol: 0.08 },
  { altitudeKm: 80, eastMS: -1.66536, northMS: -0.08959, speedMS: 1.66777, tol: 0.05 },
];

let strongestJetSample = null;
for (const reference of bocaAltitudes) {
  const sample = sampleWindVectorKmS({
    altitudeKm: reference.altitudeKm,
    relPos: relativePositionKm(25.9, -97.2, reference.altitudeKm),
    earthPole: earthAxes.pole,
    earthAxes,
    timestampMs: bocaTimestampMs,
    elapsedSeconds: 120,
    seed: 12345,
  });
  assertApprox(sample.eastMS, reference.eastMS, reference.tol, `Boca east wind at ${reference.altitudeKm} km`);
  assertApprox(sample.northMS, reference.northMS, reference.tol, `Boca north wind at ${reference.altitudeKm} km`);
  assertApprox(sample.speedKmS * 1000, reference.speedMS, reference.tol, `Boca wind speed at ${reference.altitudeKm} km`);
  if (!strongestJetSample || sample.speedKmS > strongestJetSample.speedKmS) {
    strongestJetSample = sample;
  }
}

assert(strongestJetSample && strongestJetSample.speedKmS * 1000 > 30, "Boca profile should produce a subtropical jet core above 30 m/s");

const bocaSpringJet = sampleWindVectorKmS({
  altitudeKm: 12,
  relPos: relativePositionKm(25.9, -97.2, 12),
  earthPole: earthAxes.pole,
  earthAxes,
  timestampMs: bocaTimestampMs,
  elapsedSeconds: 120,
  seed: 12345,
});
const midlatitudeWinterJet = sampleWindVectorKmS({
  altitudeKm: 12,
  relPos: relativePositionKm(40, -75, 12),
  earthPole: earthAxes.pole,
  earthAxes,
  timestampMs: Date.UTC(2026, 0, 15, 18, 0, 0),
  elapsedSeconds: 120,
  seed: 12345,
});
const equatorialJet = sampleWindVectorKmS({
  altitudeKm: 12,
  relPos: relativePositionKm(0, -75, 12),
  earthPole: earthAxes.pole,
  earthAxes,
  timestampMs: Date.UTC(2026, 0, 15, 18, 0, 0),
  elapsedSeconds: 120,
  seed: 12345,
});

assert(
  midlatitudeWinterJet.speedKmS > bocaSpringJet.speedKmS,
  "midlatitude winter jet should exceed Boca spring jet strength",
);
assert(
  bocaSpringJet.speedKmS > equatorialJet.speedKmS,
  "subtropical jet should exceed equatorial upper-troposphere winds",
);
assert(
  Math.abs(midlatitudeWinterJet.gustEastMS) < 2.5 && Math.abs(midlatitudeWinterJet.gustNorthMS) < 2.5,
  "gust terms should remain bounded relative to the background jet",
);

console.log("wind-profile-lock: ok");
