import {
  buildMoonGuidanceSourceModel,
  sampleMoonGuidanceSourceModelAtTimeSec,
} from "../app/static/js/physics/runtime/index.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function add(a, b) {
  return {
    x: (Number(a?.x) || 0) + (Number(b?.x) || 0),
    y: (Number(a?.y) || 0) + (Number(b?.y) || 0),
    z: (Number(a?.z) || 0) + (Number(b?.z) || 0),
  };
}

function subtract(a, b) {
  return {
    x: (Number(a?.x) || 0) - (Number(b?.x) || 0),
    y: (Number(a?.y) || 0) - (Number(b?.y) || 0),
    z: (Number(a?.z) || 0) - (Number(b?.z) || 0),
  };
}

function scale(vector, scalar) {
  return {
    x: (Number(vector?.x) || 0) * scalar,
    y: (Number(vector?.y) || 0) * scalar,
    z: (Number(vector?.z) || 0) * scalar,
  };
}

function dot(a, b) {
  return (
    ((Number(a?.x) || 0) * (Number(b?.x) || 0))
    + ((Number(a?.y) || 0) * (Number(b?.y) || 0))
    + ((Number(a?.z) || 0) * (Number(b?.z) || 0))
  );
}

function length(vector) {
  return Math.sqrt(dot(vector, vector));
}

function normalize(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const magnitude = length(vector);
  return magnitude > 1e-12 ? scale(vector, 1 / magnitude) : { ...fallback };
}

function cross(a, b) {
  return {
    x: ((Number(a?.y) || 0) * (Number(b?.z) || 0)) - ((Number(a?.z) || 0) * (Number(b?.y) || 0)),
    y: ((Number(a?.z) || 0) * (Number(b?.x) || 0)) - ((Number(a?.x) || 0) * (Number(b?.z) || 0)),
    z: ((Number(a?.x) || 0) * (Number(b?.y) || 0)) - ((Number(a?.y) || 0) * (Number(b?.x) || 0)),
  };
}

function rotateAroundAxis(vector, axis, angleRad) {
  const normalizedAxis = normalize(axis, { x: 0, y: 0, z: 1 });
  const cosTheta = Math.cos(angleRad);
  const sinTheta = Math.sin(angleRad);
  const axisDotVector = dot(normalizedAxis, vector);
  return add(
    add(
      scale(vector, cosTheta),
      scale(cross(normalizedAxis, vector), sinTheta),
    ),
    scale(normalizedAxis, axisDotVector * (1 - cosTheta)),
  );
}

function propagateConstantRateSource(positionKm, velocityKmS, elapsedSec) {
  const radiusKm = Math.max(1e-9, length(positionKm));
  const angularMomentum = cross(positionKm, velocityKmS);
  const angularMomentumMag = Math.max(1e-12, length(angularMomentum));
  const radial = normalize(positionKm, { x: 1, y: 0, z: 0 });
  const tangentialSpeedKmS = length(subtract(
    velocityKmS,
    scale(radial, dot(velocityKmS, radial)),
  ));
  const planeNormal = scale(angularMomentum, 1 / angularMomentumMag);
  const angleRad = (tangentialSpeedKmS / radiusKm) * elapsedSec;
  return {
    positionKm: rotateAroundAxis(positionKm, planeNormal, angleRad),
    velocityKmS: rotateAroundAxis(velocityKmS, planeNormal, angleRad),
  };
}

function main() {
  const moonEarthPositionKm = { x: 363300, y: 121000, z: 15000 };
  const moonEarthVelocityKmS = { x: -0.33, y: 0.94, z: 0.12 };
  const sunEarthPositionKm = { x: -121000000, y: 88000000, z: 34000000 };
  const sunEarthVelocityKmS = { x: -17.2, y: -22.8, z: -8.9 };
  const elapsedSec = 72 * 3600;

  const sources = buildMoonGuidanceSourceModel({
    targetVectors: {
      moonEarthPositionKm,
      moonEarthVelocityKmS,
      sunEarthPositionKm,
      sunEarthVelocityKmS,
    },
    metrics: {},
    plannerConfig: {
      moonClosedLoopPropagationStepSec: 90,
    },
  });

  const sampled = sampleMoonGuidanceSourceModelAtTimeSec(sources, elapsedSec);
  assert(sampled, "expected sampled source model");
  assert(Array.isArray(sources.ephemeris?.samples) && sources.ephemeris.samples.length > 120, "expected dense ephemeris samples");
  assert(length(sampled.earth?.positionKm) < 1e-9, `expected Earth to remain frame origin, got ${JSON.stringify(sampled.earth?.positionKm)}`);

  const legacyMoon = propagateConstantRateSource(moonEarthPositionKm, moonEarthVelocityKmS, elapsedSec);
  const legacySun = propagateConstantRateSource(sunEarthPositionKm, sunEarthVelocityKmS, elapsedSec);
  const moonDeviationKm = length(subtract(sampled.moon.positionKm, legacyMoon.positionKm));
  const sunDeviationKm = length(subtract(sampled.sun.positionKm, legacySun.positionKm));

  assert(moonDeviationKm > 1000, `expected integrated moon ephemeris to diverge from constant-rate fallback, got ${moonDeviationKm.toFixed(3)} km`);
  assert(sunDeviationKm > 100000, `expected integrated sun ephemeris to diverge from constant-rate fallback, got ${sunDeviationKm.toFixed(3)} km`);
  assert(sampled.moon.positionKm.y > 300000, `unexpected sampled moon Y position ${sampled.moon.positionKm.y}`);
  assert(sampled.sun.positionKm.x < -120000000, `unexpected sampled sun X position ${sampled.sun.positionKm.x}`);

  console.log("moon-source-ephemeris-lock: ok");
}

main();
