import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import {
  STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM,
} from "../app/static/js/physics/launch/launchConfig.js";
import {
  sampleEarthSurfaceAtRelativePosition,
} from "../app/static/js/physics/surface/earthSurfacePhysics.js";
import {
  subtract,
} from "../app/static/js/physics/launch/launchMath.js";

const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const NOW_MS = Date.UTC(2026, 3, 24, 16, 0, 0);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function earthAxes() {
  return {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    pole: { x: 0, y: 0, z: 1 },
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
    gravitationalConstantKm3PerKgS2: 6.67430e-20,
  });
}

function makeState() {
  return {
    dynamicBodies: new Map([
      [
        "earth_refuel_tanker_1",
        {
          id: "earth_refuel_tanker_1",
          massKg: 220000,
          position: { x: EARTH_RADIUS_KM - 3, y: 0, z: 0 },
          velocity: { x: -0.025, y: 0.002, z: 0 },
        },
      ],
    ]),
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

function main() {
  const state = makeState();
  const controller = makeController();

  controller.finalizeStep(state, 1 / 60, NOW_MS);

  const earthState = state.staticSources.get("earth");
  const tankerState = state.dynamicBodies.get("earth_refuel_tanker_1");
  const surface = sampleEarthSurfaceAtRelativePosition(
    subtract(tankerState.position, earthState.position),
    earthAxes(),
    EARTH_RADIUS_KM,
    { includeTerrain: true },
  );

  assert(surface, "earth_solid_surface_guard_lock: missing surface sample after guard");
  assert(
    Number(surface.altitudeAboveTerrainKm) >= STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM - 1e-9,
    `earth_solid_surface_guard_lock: managed vehicle remained below solid surface (${surface.altitudeAboveTerrainKm}km)`,
  );
  assert(
    tankerState.velocity.x >= -1e-9,
    `earth_solid_surface_guard_lock: inward velocity was not removed (${tankerState.velocity.x}km/s)`,
  );

  console.log("PASS earth-solid-surface-guard-lock");
}

main();
