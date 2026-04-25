import { createPhysicsEnvironmentRuntime } from "../app/static/js/physics/runtime/environmentRuntime.js";

const STARBASE_LAT_DEG = 25.9968983;
const STARBASE_LON_DEG = -97.1547571;

const earthAxes = {
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 1, z: 0 },
  pole: { x: 0, y: 0, z: 1 },
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function finiteVector(value) {
  return Number.isFinite(value?.x)
    && Number.isFinite(value?.y)
    && Number.isFinite(value?.z);
}

function vectorLength(value) {
  return Math.sqrt((value.x * value.x) + (value.y * value.y) + (value.z * value.z));
}

const runtime = createPhysicsEnvironmentRuntime({
  getLaunchSite: () => ({
    latitudeDeg: STARBASE_LAT_DEG,
    longitudeDeg: STARBASE_LON_DEG,
    siteName: "Starbase",
  }),
});

await runtime.start();
await runtime.setScenario("moderate", true);

const launchSurface = runtime.sampleEarthSurface({
  latitudeDeg: STARBASE_LAT_DEG,
  longitudeDeg: STARBASE_LON_DEG,
  earthAxes,
});

assert(launchSurface, "launch-site surface sample should be available");
assert(finiteVector(launchSurface.surfacePointRelativeKm), "surface point should be a finite world vector");
assert(Number.isFinite(launchSurface.terrainHeightKm), "terrain height should be finite");
assert(launchSurface.source.includes("wgs84"), "surface source should identify the WGS84 terrain model");

const sample = runtime.sampleEnvironment({
  relativePositionKm: launchSurface.surfacePointRelativeKm,
  earthAxes,
  timestampMs: Date.UTC(2026, 3, 24, 18, 0, 0),
});

assert(sample.source === "physics-environment-runtime", "environment sample should come from the runtime provider");
assert(Math.abs(sample.latitudeDeg - STARBASE_LAT_DEG) < 0.05, "sample latitude should resolve from the surface point");
assert(Math.abs(sample.longitudeDeg - STARBASE_LON_DEG) < 0.05, "sample longitude should resolve from the surface point");
assert(sample.surface?.altitudeAboveTerrainKm > -0.001, "surface altitude should be at or above terrain");
assert(sample.atmosphere?.densityKgM3 > 1.0, "sea-level atmosphere density should be realistic");
assert(sample.atmosphere?.pressurePa > 90_000, "sea-level pressure should be realistic");
assert(sample.launchWeather?.windSpeedMS > 0, "launch weather should expose a surface wind");
assert(sample.wind?.speedMS > 0, "environment wind profile should be available");
assert(finiteVector(sample.wind?.vectorKmS), "wind profile should include a world-space vector");
assert(sample.gravity?.normalGravityMS2 > 9.7 && sample.gravity.normalGravityMS2 < 9.9, "normal gravity should be Earth-like");
assert(finiteVector(sample.gravity?.accelerationKmS2), "gravity should include a J2 acceleration vector when position is known");
assert(
  vectorLength(sample.gravity.accelerationKmS2) > 0.0096
    && vectorLength(sample.gravity.accelerationKmS2) < 0.0099,
  "gravity acceleration magnitude should be Earth-like",
);
assert(sample.earthOrientation, "environment sample should include Earth orientation data");

runtime.stop();

console.log("environment-provider-sample-lock: ok");
