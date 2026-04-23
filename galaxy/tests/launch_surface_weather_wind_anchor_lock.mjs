import { sampleWindVectorKmS } from "../app/static/js/physics/launch/launchAeroModel.js";

const EARTH_RADIUS_KM = 6371.0084;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

const baseGround = sampleWindVectorKmS({
  altitudeKm: 0,
  relPos: relativePositionKm(25.9968983, -97.1547571, 0),
  earthPole: earthAxes.pole,
  earthAxes,
  timestampMs: Date.UTC(2026, 3, 19, 22, 0, 0),
  elapsedSeconds: 75,
  seed: 42,
});

const anchoredGround = sampleWindVectorKmS({
  altitudeKm: 0,
  relPos: relativePositionKm(25.9968983, -97.1547571, 0),
  earthPole: earthAxes.pole,
  earthAxes,
  timestampMs: Date.UTC(2026, 3, 19, 22, 0, 0),
  elapsedSeconds: 75,
  seed: 42,
  surfaceWindEastMS: -6,
  surfaceWindNorthMS: -9,
});

assert(
  Math.abs(anchoredGround.eastMS + 6) < Math.abs(baseGround.eastMS + 6),
  "surface weather anchor should pull low-altitude east wind toward the real surface value",
);
assert(
  Math.abs(anchoredGround.northMS + 9) < Math.abs(baseGround.northMS + 9),
  "surface weather anchor should pull low-altitude north wind toward the real surface value",
);

const baseUpper = sampleWindVectorKmS({
  altitudeKm: 12,
  relPos: relativePositionKm(25.9968983, -97.1547571, 12),
  earthPole: earthAxes.pole,
  earthAxes,
  timestampMs: Date.UTC(2026, 3, 19, 22, 0, 0),
  elapsedSeconds: 75,
  seed: 42,
});

const anchoredUpper = sampleWindVectorKmS({
  altitudeKm: 12,
  relPos: relativePositionKm(25.9968983, -97.1547571, 12),
  earthPole: earthAxes.pole,
  earthAxes,
  timestampMs: Date.UTC(2026, 3, 19, 22, 0, 0),
  elapsedSeconds: 75,
  seed: 42,
  surfaceWindEastMS: -6,
  surfaceWindNorthMS: -9,
});

assert(
  Math.abs(anchoredUpper.eastMS - baseUpper.eastMS) < Math.abs(anchoredGround.eastMS - baseGround.eastMS),
  "surface weather anchor should decay with altitude",
);
assert(
  Math.abs(anchoredUpper.northMS - baseUpper.northMS) < Math.abs(anchoredGround.northMS - baseGround.northMS),
  "surface weather anchor should decay with altitude for north wind too",
);

console.log("launch-surface-weather-wind-anchor-lock: ok");
