import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import {
  EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
  LAUNCH_SITE,
  setLaunchSite,
} from "../app/static/js/physics/launch/launchConfig.js";
import { resolveLaunchSiteAnchorWorldKm } from "../app/static/js/physics/launch/launchSiteStructures.js";
import {
  surfacePointRelativeKmAtLatLon,
  terrainHeightKmAtLatLon,
} from "../app/static/js/physics/surface/earthSurfacePhysics.js";

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

function length(vector) {
  return Math.sqrt(dot(vector, vector));
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function cloneVector(vector) {
  return {
    x: Number(vector?.x) || 0,
    y: Number(vector?.y) || 0,
    z: Number(vector?.z) || 0,
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

function earthFixedRelativeKm(worldPositionKm, axes) {
  return {
    x: dot(worldPositionKm, axes.xAxis),
    y: dot(worldPositionKm, axes.yAxis),
    z: dot(worldPositionKm, axes.pole),
  };
}

function main() {
  const previousLaunchSite = { ...LAUNCH_SITE };
  const testSite = {
    name: "Visual Earth Fixed Site",
    latitudeDeg: 35.0,
    longitudeDeg: -106.0,
    altitudeKm: 0,
  };
  try {
    setLaunchSite(testSite);

    const controller = createHarness();
    const state = makeState();
    const earthState = state.staticSources.get("earth");
    assert(earthState, "expected Earth state");
    assert(controller.resetToPad(state, T0_MS), "expected resetToPad at T0");
    const rocket0 = state.dynamicBodies.get("earth_launch_vehicle");
    assert(rocket0, "expected pad vehicle at T0");
    const rocketPosition0 = cloneVector(rocket0.position);

    assert(controller.resetToPad(state, T1_MS), "expected resetToPad at T1");
    const rocket1 = state.dynamicBodies.get("earth_launch_vehicle");
    assert(rocket1, "expected pad vehicle at T1");
    const rocketPosition1 = cloneVector(rocket1.position);

    const anchor0 = resolveLaunchSiteAnchorWorldKm({
      launchSite: testSite,
      earthPositionKm: earthState.position,
      earthAxes: earthAxesAt(T0_MS),
      rocketPositionKm: rocketPosition0,
      stackPresent: true,
    });
    const anchor1 = resolveLaunchSiteAnchorWorldKm({
      launchSite: testSite,
      earthPositionKm: earthState.position,
      earthAxes: earthAxesAt(T1_MS),
      rocketPositionKm: rocketPosition1,
      stackPresent: true,
    });
    const bogusAnchor0 = resolveLaunchSiteAnchorWorldKm({
      launchSite: testSite,
      earthPositionKm: earthState.position,
      earthAxes: earthAxesAt(T0_MS),
      rocketPositionKm: { x: 999999, y: -999999, z: 555555 },
      stackPresent: true,
    });
    const bogusAnchor1 = resolveLaunchSiteAnchorWorldKm({
      launchSite: testSite,
      earthPositionKm: earthState.position,
      earthAxes: earthAxesAt(T1_MS),
      rocketPositionKm: { x: -555555, y: 777777, z: -888888 },
      stackPresent: true,
    });
    assert(anchor0 && anchor1, "expected visual anchors");
    assert(bogusAnchor0 && bogusAnchor1, "expected bogus visual anchors");

    const fixed0 = earthFixedRelativeKm(anchor0, earthAxesAt(T0_MS));
    const fixed1 = earthFixedRelativeKm(anchor1, earthAxesAt(T1_MS));
    const worldDriftKm = length(subtract(anchor1, anchor0));
    const fixedDriftKm = length(subtract(fixed1, fixed0));

    assert(
      worldDriftKm > 1000,
      `expected world-space anchor to move with Earth rotation, got ${worldDriftKm} km`,
    );
    assert(
      fixedDriftKm <= 1e-6,
      `expected Earth-fixed visual anchor to remain constant, got drift ${fixedDriftKm} km`,
    );
    assert(
      length(subtract(anchor0, bogusAnchor0)) <= 1e-9
        && length(subtract(anchor1, bogusAnchor1)) <= 1e-9,
      "expected launch-site visual anchor to ignore rocket-position input and remain Earth-fixed",
    );

    const siteSurface = surfacePointRelativeKmAtLatLon(
      testSite.latitudeDeg,
      testSite.longitudeDeg,
      earthAxesAt(T0_MS),
      { includeTerrain: true },
    );
    const expectedRadiusKm = Number(siteSurface?.localSurfaceRadiusKm);
    assert(
      Math.abs(length(fixed0) - expectedRadiusKm) <= 0.02
        && Math.abs(length(fixed1) - expectedRadiusKm) <= 0.02,
      `expected visual anchor radius ${expectedRadiusKm}, got ${length(fixed0)} and ${length(fixed1)}`,
    );

    console.log("PASS launch-site-visual-earth-fixed-lock");
  } finally {
    setLaunchSite(previousLaunchSite);
  }
}

main();
