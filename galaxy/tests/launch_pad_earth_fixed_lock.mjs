import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import {
  EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
  LAUNCH_BODY_ID,
  LAUNCH_SITE,
  setLaunchSite,
  STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM,
} from "../app/static/js/physics/launch/launchConfig.js";
import { sampleEarthSurfaceAtRelativePosition } from "../app/static/js/physics/surface/earthSurfacePhysics.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const T0_MS = Date.UTC(2026, 3, 19, 12, 0, 0);
const T1_MS = T0_MS + (6 * 3600 * 1000);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function earthAxesAt(timestampMs) {
  const elapsedSec = (Number(timestampMs) - T0_MS) / 1000;
  const theta = EARTH_SIDEREAL_ANGULAR_RATE_RAD_S * elapsedSec;
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);
  return {
    xAxis: { x: cosTheta, y: sinTheta, z: 0 },
    yAxis: { x: -sinTheta, y: cosTheta, z: 0 },
    pole: { x: 0, y: 0, z: 1 },
  };
}

function sampleEarthAtmosphere() {
  return {
    densityKgM3: 1.225,
    pressurePa: 101325,
    temperatureK: 288.15,
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

function createHarness() {
  return createLaunchController({
    getEarthRadiusKm: () => EARTH_RADIUS_KM,
    getEarthMassKg: () => EARTH_MASS_KG,
    getBodyRadiusKm: () => EARTH_RADIUS_KM,
    getBodyMassKg: () => EARTH_MASS_KG,
    getEarthFixedAxesEcliptic: earthAxesAt,
    sampleEarthAtmosphere,
    windSeed: 1,
    gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
  });
}

function earthFixedRelativeKm(relativePositionKm, axes) {
  return {
    x: dot(relativePositionKm, axes.xAxis),
    y: dot(relativePositionKm, axes.yAxis),
    z: dot(relativePositionKm, axes.pole),
  };
}

function main() {
  const previousLaunchSite = { ...LAUNCH_SITE };
  const testSite = {
    name: "Earth Fixed Pad Lock Site",
    latitudeDeg: 35.0,
    longitudeDeg: -106.0,
    altitudeKm: 0,
  };
  try {
    setLaunchSite(testSite);
    const controller = createHarness();
    const state = makeState();

    assert(controller.resetToPad(state, T0_MS), "expected resetToPad at T0 to succeed");
    const earthState = state.staticSources.get("earth");
    const body0 = state.dynamicBodies.get(LAUNCH_BODY_ID);
    assert(body0 && earthState, "expected launch body at T0");
    const rel0 = subtract(body0.position, earthState.position);
    const fixed0 = earthFixedRelativeKm(rel0, earthAxesAt(T0_MS));
    const sample0 = sampleEarthSurfaceAtRelativePosition(
      rel0,
      earthAxesAt(T0_MS),
      EARTH_RADIUS_KM,
      { includeTerrain: true },
    );

    controller.finalizeStep(state, 0, T1_MS);
    const bodyLive = state.dynamicBodies.get(LAUNCH_BODY_ID);
    assert(bodyLive, "expected launch body after idle finalize sync");
    const relLive = subtract(bodyLive.position, earthState.position);
    const fixedLive = earthFixedRelativeKm(relLive, earthAxesAt(T1_MS));
    const sampleLive = sampleEarthSurfaceAtRelativePosition(
      relLive,
      earthAxesAt(T1_MS),
      EARTH_RADIUS_KM,
      { includeTerrain: true },
    );

    assert(controller.resetToPad(state, T1_MS), "expected resetToPad at T1 to succeed");
    const body1 = state.dynamicBodies.get(LAUNCH_BODY_ID);
    assert(body1, "expected launch body at T1");
    const rel1 = subtract(body1.position, earthState.position);
    const fixed1 = earthFixedRelativeKm(rel1, earthAxesAt(T1_MS));
    const sample1 = sampleEarthSurfaceAtRelativePosition(
      rel1,
      earthAxesAt(T1_MS),
      EARTH_RADIUS_KM,
      { includeTerrain: true },
    );

    assert(
      Math.abs(fixed1.x - fixed0.x) <= 1e-6
        && Math.abs(fixed1.y - fixed0.y) <= 1e-6
        && Math.abs(fixed1.z - fixed0.z) <= 1e-6,
      `expected Earth-fixed pad coordinates to remain constant, got ${JSON.stringify({ fixed0, fixed1 })}`,
    );
    assert(
      Math.abs(fixedLive.x - fixed0.x) <= 1e-6
        && Math.abs(fixedLive.y - fixed0.y) <= 1e-6
        && Math.abs(fixedLive.z - fixed0.z) <= 1e-6,
      `expected idle launch body to stay Earth-fixed across rotation, got ${JSON.stringify({ fixed0, fixedLive })}`,
    );
    assert(
      Math.abs(Number(sample0?.latitudeDeg) - testSite.latitudeDeg) <= 1e-6
        && Math.abs(Number(sampleLive?.latitudeDeg) - testSite.latitudeDeg) <= 1e-6
        && Math.abs(Number(sample1?.latitudeDeg) - testSite.latitudeDeg) <= 1e-6,
      `expected fixed pad latitude ${testSite.latitudeDeg}, got ${sample0?.latitudeDeg}, ${sampleLive?.latitudeDeg}, and ${sample1?.latitudeDeg}`,
    );
    assert(
      Math.abs(Number(sample0?.longitudeDeg) - testSite.longitudeDeg) <= 1e-6
        && Math.abs(Number(sampleLive?.longitudeDeg) - testSite.longitudeDeg) <= 1e-6
        && Math.abs(Number(sample1?.longitudeDeg) - testSite.longitudeDeg) <= 1e-6,
      `expected fixed pad longitude ${testSite.longitudeDeg}, got ${sample0?.longitudeDeg}, ${sampleLive?.longitudeDeg}, and ${sample1?.longitudeDeg}`,
    );
    assert(
      Math.abs(Number(sample0?.altitudeAboveTerrainKm) - STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM) <= 1e-6
        && Math.abs(Number(sampleLive?.altitudeAboveTerrainKm) - STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM) <= 1e-6
        && Math.abs(Number(sample1?.altitudeAboveTerrainKm) - STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM) <= 1e-6,
      `expected pad reference altitude ${STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM}, got ${sample0?.altitudeAboveTerrainKm}, ${sampleLive?.altitudeAboveTerrainKm}, and ${sample1?.altitudeAboveTerrainKm}`,
    );

    console.log("PASS launch-pad-earth-fixed-lock");
  } finally {
    setLaunchSite(previousLaunchSite);
  }
}

main();
