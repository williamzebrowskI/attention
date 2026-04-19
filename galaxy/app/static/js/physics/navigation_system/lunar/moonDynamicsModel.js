import {
  add,
  clamp,
  dot,
  finiteVector,
  length,
  normalize,
  scale,
  subtract,
} from "../navigationMath.js";
import { orbitalStateFromRelative } from "../../launch/launchGuidance.js";
import { computeOblateGravityPerturbationKmS2 } from "../../dynamics/oblateGravityPerturbation.js";
import { computeLunarMasconAccelerationKmS2 } from "../../dynamics/lunarMasconModel.js";
import { earthConventionalGravityModel } from "../../dynamics/earthGravityModel.js";
import {
  computeSolarRadiationAccelerationKmS2,
  computeSolarShadowTransmittance,
} from "../../dynamics/solarRadiationPressure.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const DEFAULT_EARTH_MASS_KG = 5.97237e24;
const DEFAULT_MOON_MASS_KG = 7.342e22;
const DEFAULT_SUN_MASS_KG = 1.98847e30;
const DEFAULT_EARTH_RADIUS_KM = 6371.0084;
const DEFAULT_MOON_RADIUS_KM = 1737.4;
const DEFAULT_SUN_RADIUS_KM = 696340;
const STANDARD_GRAVITY_M_S2 = 9.80665;
const DEFAULT_EARTH_MU_KM3_S2 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * DEFAULT_EARTH_MASS_KG;
const DEFAULT_MOON_MU_KM3_S2 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * DEFAULT_MOON_MASS_KG;
const DEFAULT_EARTH_J2 = earthConventionalGravityModel(Date.UTC(2000, 0, 1, 12, 0, 0, 0)).j2;
const DEFAULT_EARTH_J3 = earthConventionalGravityModel(Date.UTC(2000, 0, 1, 12, 0, 0, 0)).j3;
const DEFAULT_EARTH_J4 = earthConventionalGravityModel(Date.UTC(2000, 0, 1, 12, 0, 0, 0)).j4;
const DEFAULT_EARTH_J5 = earthConventionalGravityModel(Date.UTC(2000, 0, 1, 12, 0, 0, 0)).j5;
const DEFAULT_EARTH_J6 = 5.40681239107e-7;
const DEFAULT_MOON_J2 = 2.034e-4;
const DEFAULT_MOON_C22 = 2.241e-5;
const DEFAULT_MOON_STEP_SEC = 90;
const DEFAULT_SOURCE_EPHEMERIS_STEP_SEC = 1800;
const DEFAULT_SOURCE_EPHEMERIS_MARGIN_SEC = 3600;

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback);
}

function cross(a, b) {
  return {
    x: ((Number(a?.y) || 0) * (Number(b?.z) || 0)) - ((Number(a?.z) || 0) * (Number(b?.y) || 0)),
    y: ((Number(a?.z) || 0) * (Number(b?.x) || 0)) - ((Number(a?.x) || 0) * (Number(b?.z) || 0)),
    z: ((Number(a?.x) || 0) * (Number(b?.y) || 0)) - ((Number(a?.y) || 0) * (Number(b?.x) || 0)),
  };
}

function rotateAroundAxis(vector, axis, angleRad) {
  if (!finiteVector(vector)) {
    return { x: 0, y: 0, z: 0 };
  }
  const normalizedAxis = normalize(axis, { x: 0, y: 0, z: 1 });
  const angle = finiteNumber(angleRad, 0);
  if (length(normalizedAxis) <= 1e-9 || Math.abs(angle) <= 1e-12) {
    return { ...vector };
  }
  const cosTheta = Math.cos(angle);
  const sinTheta = Math.sin(angle);
  const axisDotVector = dot(normalizedAxis, vector);
  return add(
    add(
      scale(vector, cosTheta),
      scale(cross(normalizedAxis, vector), sinTheta),
    ),
    scale(normalizedAxis, axisDotVector * (1 - cosTheta)),
  );
}

function stateVector(positionKm, velocityKmS, massKg = Number.NaN, minMassKg = Number.NaN) {
  const resolvedMassKg = Number.isFinite(Number(massKg))
    ? Number(massKg)
    : Number.NaN;
  return {
    positionKm: finiteVector(positionKm) ? { ...positionKm } : { x: 0, y: 0, z: 0 },
    velocityKmS: finiteVector(velocityKmS) ? { ...velocityKmS } : { x: 0, y: 0, z: 0 },
    massKg: Number.isFinite(resolvedMassKg)
      ? Math.max(
        Number.isFinite(Number(minMassKg)) ? Number(minMassKg) : 0,
        resolvedMassKg,
      )
      : Number.NaN,
  };
}

function interpolateSeaToVac(vacuumValue, seaLevelValue, pressurePa = 0) {
  const vac = Math.max(0, finiteNumber(vacuumValue, 0));
  const sea = Math.max(0, finiteNumber(seaLevelValue, vac));
  const clampedPressurePa = clamp(finiteNumber(pressurePa, 0), 0, 101325);
  const blend = 1 - (clampedPressurePa / 101325);
  return sea + ((vac - sea) * blend);
}

function resolveSpacecraftDryMassKg(spacecraft = null) {
  if (!spacecraft || typeof spacecraft !== "object") {
    return Number.NaN;
  }
  const massKg = finiteNumber(spacecraft.massKg, Number.NaN);
  const propellantMassKg = Math.max(0, finiteNumber(spacecraft.propellantMassKg, Number.NaN));
  const dryMassKg = finiteNumber(spacecraft.dryMassKg, Number.NaN);
  if (Number.isFinite(dryMassKg) && dryMassKg > 0) {
    return dryMassKg;
  }
  if (Number.isFinite(massKg) && Number.isFinite(propellantMassKg)) {
    return Math.max(1, massKg - propellantMassKg);
  }
  return Number.NaN;
}

function resolveBurnSample({
  sampleState = null,
  burnCommand = null,
  spacecraft = null,
  sampleTimeSec = 0,
} = {}) {
  const zero = {
    accelerationKmS2: { x: 0, y: 0, z: 0 },
    massFlowKgS: 0,
  };
  if (!burnCommand || sampleTimeSec >= Math.max(0, finiteNumber(burnCommand.burnDurationSec, 0))) {
    return zero;
  }
  const throttle = clamp(finiteNumber(burnCommand.throttle, 0), 0, 1);
  if (!(throttle > 1e-9)) {
    return zero;
  }
  const currentMassKg = Math.max(1, finiteNumber(sampleState?.massKg, spacecraft?.massKg));
  const dryMassKg = Math.max(1, finiteNumber(resolveSpacecraftDryMassKg(spacecraft), 1));
  if (!(currentMassKg > dryMassKg + 1e-9)) {
    return zero;
  }
  const pressurePa = Math.max(0, finiteNumber(spacecraft?.ambientPressurePa, 0));
  const thrustPerThrottleN = interpolateSeaToVac(
    finiteNumber(spacecraft?.thrustVacuumN, 0),
    finiteNumber(spacecraft?.thrustSeaLevelN, spacecraft?.thrustVacuumN),
    pressurePa,
  );
  const ispS = interpolateSeaToVac(
    finiteNumber(spacecraft?.ispVacuumS, 0),
    finiteNumber(spacecraft?.ispSeaLevelS, spacecraft?.ispVacuumS),
    pressurePa,
  );
  if (!(thrustPerThrottleN > 0) || !(ispS > 0)) {
    const accelAtThrottle1 = Math.max(0, finiteNumber(burnCommand.accelAtThrottle1KmS2, 0));
    const direction = normalize(burnCommand.direction, { x: 0, y: 1, z: 0 });
    return {
      accelerationKmS2: scale(direction, throttle * accelAtThrottle1),
      massFlowKgS: 0,
    };
  }
  const thrustN = thrustPerThrottleN * throttle;
  const direction = normalize(burnCommand.direction, { x: 0, y: 1, z: 0 });
  return {
    accelerationKmS2: scale(direction, (thrustN / currentMassKg) / 1000),
    massFlowKgS: Math.max(0, thrustN / (ispS * STANDARD_GRAVITY_M_S2)),
  };
}

function pointMassAccelerationKmS2(targetPosKm, sourcePosKm, sourceMassKg) {
  if (!finiteVector(targetPosKm) || !finiteVector(sourcePosKm)) {
    return { x: 0, y: 0, z: 0 };
  }
  const massKg = Math.max(0, finiteNumber(sourceMassKg, 0));
  if (!(massKg > 0)) {
    return { x: 0, y: 0, z: 0 };
  }
  const rel = subtract(targetPosKm, sourcePosKm);
  const radiusKm = Math.max(1e-6, length(rel));
  const muKm3S2 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * massKg;
  const scaleFactor = -muKm3S2 / (radiusKm * radiusKm * radiusKm);
  return scale(rel, scaleFactor);
}

function thirdBodyDifferentialAccelerationKmS2({
  targetPosKm = null,
  sourcePosKm = null,
  sourceMassKg = 0,
  frameOriginPosKm = null,
} = {}) {
  const targetAccel = pointMassAccelerationKmS2(targetPosKm, sourcePosKm, sourceMassKg);
  const originAccel = pointMassAccelerationKmS2(
    finiteVector(frameOriginPosKm) ? frameOriginPosKm : { x: 0, y: 0, z: 0 },
    sourcePosKm,
    sourceMassKg,
  );
  return subtract(targetAccel, originAccel);
}

function defaultAxesForSource(sourceId, positionKm = null, velocityKmS = null) {
  if (sourceId === "earth") {
    return {
      pole: { x: 0, y: 0, z: 1 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
    };
  }
  const radial = normalize(positionKm || { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const planeNormal = normalize(cross(positionKm || radial, velocityKmS || { x: 0, y: 0, z: 1 }), { x: 0, y: 0, z: 1 });
  const tangential = normalize(cross(planeNormal, radial), { x: 0, y: 1, z: 0 });
  return {
    pole: planeNormal,
    xAxis: radial,
    yAxis: tangential,
  };
}

function sourceDescriptor({
  id,
  positionKm,
  velocityKmS,
  massKg,
  radiusKm,
  referenceRadiusKm = null,
  j2 = 0,
  j3 = 0,
  j4 = 0,
  j5 = 0,
  j6 = 0,
  c21 = 0,
  s21 = 0,
  c22 = 0,
  s22 = 0,
  harmonicTerms = null,
  axes = null,
} = {}) {
  return {
    id: String(id || ""),
    positionKm: finiteVector(positionKm) ? { ...positionKm } : { x: 0, y: 0, z: 0 },
    velocityKmS: finiteVector(velocityKmS) ? { ...velocityKmS } : { x: 0, y: 0, z: 0 },
    massKg: Math.max(0, finiteNumber(massKg, 0)),
    radiusKm: Math.max(1, finiteNumber(radiusKm, 1)),
    referenceRadiusKm: Math.max(1, finiteNumber(referenceRadiusKm, radiusKm)),
    j2: finiteNumber(j2, 0),
    j3: finiteNumber(j3, 0),
    j4: finiteNumber(j4, 0),
    j5: finiteNumber(j5, 0),
    j6: finiteNumber(j6, 0),
    c21: finiteNumber(c21, 0),
    s21: finiteNumber(s21, 0),
    c22: finiteNumber(c22, 0),
    s22: finiteNumber(s22, 0),
    harmonicTerms: Array.isArray(harmonicTerms) ? harmonicTerms.map((term) => ({ ...term })) : null,
    axes: axes || defaultAxesForSource(id, positionKm, velocityKmS),
  };
}

function cloneSourceDescriptor(source) {
  return source ? sourceDescriptor(source) : null;
}

function cloneSourceEphemerisSample(sample = null) {
  if (!sample || typeof sample !== "object") {
    return null;
  }
  return {
    elapsedSec: finiteNumber(sample.elapsedSec, 0),
    earth: cloneSourceDescriptor(sample.earth),
    moon: cloneSourceDescriptor(sample.moon),
    sun: cloneSourceDescriptor(sample.sun),
  };
}

function cloneSourceEphemeris(ephemeris = null) {
  if (!ephemeris || typeof ephemeris !== "object") {
    return null;
  }
  return {
    stepSec: Math.max(60, finiteNumber(ephemeris.stepSec, DEFAULT_SOURCE_EPHEMERIS_STEP_SEC)),
    marginSec: Math.max(60, finiteNumber(ephemeris.marginSec, DEFAULT_SOURCE_EPHEMERIS_MARGIN_SEC)),
    horizonSec: Math.max(0, finiteNumber(ephemeris.horizonSec, 0)),
    absoluteBodies: ephemeris.absoluteBodies
      ? {
        earth: cloneSourceDescriptor(ephemeris.absoluteBodies.earth),
        moon: cloneSourceDescriptor(ephemeris.absoluteBodies.moon),
        sun: cloneSourceDescriptor(ephemeris.absoluteBodies.sun),
      }
      : null,
    samples: Array.isArray(ephemeris.samples)
      ? ephemeris.samples.map((sample) => cloneSourceEphemerisSample(sample)).filter(Boolean)
      : [],
  };
}

function sourceEphemerisStepSecForSources(sources = null) {
  return Math.max(
    60,
    finiteNumber(
      sources?.sourceEphemerisStepSec,
      Math.max(
        300,
        Math.min(
          3600,
          Math.max(
            DEFAULT_SOURCE_EPHEMERIS_STEP_SEC,
            finiteNumber(sources?.stepSec, DEFAULT_MOON_STEP_SEC) * 10,
          ),
        ),
      ),
    ),
  );
}

function sourceEphemerisMarginSecForSources(sources = null, stepSec = DEFAULT_SOURCE_EPHEMERIS_STEP_SEC) {
  return Math.max(
    stepSec,
    finiteNumber(
      sources?.sourceEphemerisMarginSec,
      Math.max(DEFAULT_SOURCE_EPHEMERIS_MARGIN_SEC, stepSec * 2),
    ),
  );
}

function absoluteSourceStateDescriptor(source = null) {
  if (!source || typeof source !== "object") {
    return null;
  }
  return sourceDescriptor({
    ...source,
    positionKm: source.positionKm,
    velocityKmS: source.velocityKmS,
    axes: defaultAxesForSource(source.id, source.positionKm, source.velocityKmS),
  });
}

function sourceDescriptorRelativeToEarth(source = null, earthSource = null, template = null) {
  if (!source || typeof source !== "object") {
    return null;
  }
  const earthPositionKm = finiteVector(earthSource?.positionKm) ? earthSource.positionKm : { x: 0, y: 0, z: 0 };
  const earthVelocityKmS = finiteVector(earthSource?.velocityKmS) ? earthSource.velocityKmS : { x: 0, y: 0, z: 0 };
  const positionKm = String(source.id || "") === "earth"
    ? { x: 0, y: 0, z: 0 }
    : subtract(source.positionKm, earthPositionKm);
  const velocityKmS = String(source.id || "") === "earth"
    ? { x: 0, y: 0, z: 0 }
    : subtract(source.velocityKmS, earthVelocityKmS);
  return sourceDescriptor({
    ...(template || source),
    id: String(source.id || template?.id || ""),
    positionKm,
    velocityKmS,
    axes: defaultAxesForSource(source.id, positionKm, velocityKmS),
  });
}

function initializeSourceEphemeris(sources = null) {
  if (!sources || typeof sources !== "object") {
    return null;
  }
  const earth = absoluteSourceStateDescriptor(sources.earth);
  const moon = absoluteSourceStateDescriptor(sources.moon);
  const sun = absoluteSourceStateDescriptor(sources.sun);
  if (!earth) {
    return null;
  }
  const stepSec = sourceEphemerisStepSecForSources(sources);
  return {
    stepSec,
    marginSec: sourceEphemerisMarginSecForSources(sources, stepSec),
    horizonSec: 0,
    absoluteBodies: {
      earth,
      moon,
      sun,
    },
    samples: [
      {
        elapsedSec: 0,
        earth: sourceDescriptorRelativeToEarth(earth, earth, sources.earth),
        moon: moon ? sourceDescriptorRelativeToEarth(moon, earth, sources.moon) : null,
        sun: sun ? sourceDescriptorRelativeToEarth(sun, earth, sources.sun) : null,
      },
    ],
  };
}

function computeSourceBodyAccelerationKmS2(absoluteBodies = {}, targetId = "") {
  const targetBody = absoluteBodies?.[targetId];
  if (!targetBody) {
    return { x: 0, y: 0, z: 0 };
  }
  let total = { x: 0, y: 0, z: 0 };
  for (const sourceId of ["earth", "moon", "sun"]) {
    if (sourceId === targetId) {
      continue;
    }
    const sourceBody = absoluteBodies?.[sourceId];
    if (!sourceBody) {
      continue;
    }
    total = add(
      total,
      pointMassAccelerationKmS2(targetBody.positionKm, sourceBody.positionKm, sourceBody.massKg),
    );
  }
  return total;
}

function propagateSourceEphemerisAbsoluteBodiesStep(absoluteBodies = {}, dtSec = 0) {
  const dt = Math.max(0, finiteNumber(dtSec, 0));
  if (!(dt > 0)) {
    return {
      earth: absoluteSourceStateDescriptor(absoluteBodies.earth),
      moon: absoluteSourceStateDescriptor(absoluteBodies.moon),
      sun: absoluteSourceStateDescriptor(absoluteBodies.sun),
    };
  }
  const nextBodies = {
    earth: absoluteSourceStateDescriptor(absoluteBodies.earth),
    moon: absoluteSourceStateDescriptor(absoluteBodies.moon),
    sun: absoluteSourceStateDescriptor(absoluteBodies.sun),
  };
  const accelerationStartById = new Map();
  for (const sourceId of ["earth", "moon", "sun"]) {
    if (!nextBodies[sourceId]) {
      continue;
    }
    accelerationStartById.set(sourceId, computeSourceBodyAccelerationKmS2(nextBodies, sourceId));
  }
  for (const sourceId of ["earth", "moon", "sun"]) {
    const body = nextBodies[sourceId];
    if (!body) {
      continue;
    }
    const accel = accelerationStartById.get(sourceId) || { x: 0, y: 0, z: 0 };
    body.velocityKmS = add(body.velocityKmS, scale(accel, 0.5 * dt));
    body.positionKm = add(body.positionKm, scale(body.velocityKmS, dt));
  }
  for (const sourceId of ["earth", "moon", "sun"]) {
    const body = nextBodies[sourceId];
    if (!body) {
      continue;
    }
    const accel = computeSourceBodyAccelerationKmS2(nextBodies, sourceId);
    body.velocityKmS = add(body.velocityKmS, scale(accel, 0.5 * dt));
    body.axes = defaultAxesForSource(sourceId, body.positionKm, body.velocityKmS);
  }
  return nextBodies;
}

function appendSourceEphemerisSample(ephemeris = null, sources = null, elapsedSec = 0) {
  if (!ephemeris || !sources) {
    return;
  }
  const absoluteBodies = ephemeris.absoluteBodies || {};
  const earth = absoluteBodies.earth || absoluteSourceStateDescriptor(sources.earth);
  if (!earth) {
    return;
  }
  ephemeris.samples.push({
    elapsedSec,
    earth: sourceDescriptorRelativeToEarth(earth, earth, sources.earth),
    moon: absoluteBodies.moon
      ? sourceDescriptorRelativeToEarth(absoluteBodies.moon, earth, sources.moon)
      : null,
    sun: absoluteBodies.sun
      ? sourceDescriptorRelativeToEarth(absoluteBodies.sun, earth, sources.sun)
      : null,
  });
}

function ensureSourceEphemerisCoverage(sources = null, requiredElapsedSec = 0) {
  if (!sources || typeof sources !== "object") {
    return null;
  }
  if (!sources.ephemeris || !Array.isArray(sources.ephemeris.samples) || !sources.ephemeris.samples.length) {
    sources.ephemeris = initializeSourceEphemeris(sources);
  }
  const ephemeris = sources.ephemeris;
  if (!ephemeris) {
    return null;
  }
  const targetElapsedSec = Math.max(0, finiteNumber(requiredElapsedSec, 0));
  const stepSec = Math.max(60, finiteNumber(ephemeris.stepSec, sourceEphemerisStepSecForSources(sources)));
  const marginSec = Math.max(stepSec, finiteNumber(ephemeris.marginSec, sourceEphemerisMarginSecForSources(sources, stepSec)));
  const targetHorizonSec = targetElapsedSec + marginSec;
  let horizonSec = Math.max(0, finiteNumber(ephemeris.horizonSec, 0));
  let absoluteBodies = ephemeris.absoluteBodies || initializeSourceEphemeris(sources)?.absoluteBodies || null;
  if (!absoluteBodies) {
    return ephemeris;
  }
  while (horizonSec + 1e-9 < targetHorizonSec) {
    const dt = Math.min(stepSec, targetHorizonSec - horizonSec);
    absoluteBodies = propagateSourceEphemerisAbsoluteBodiesStep(absoluteBodies, dt);
    horizonSec += dt;
    ephemeris.absoluteBodies = absoluteBodies;
    appendSourceEphemerisSample(ephemeris, sources, horizonSec);
  }
  ephemeris.horizonSec = horizonSec;
  ephemeris.stepSec = stepSec;
  ephemeris.marginSec = marginSec;
  sources.ephemeris = ephemeris;
  return ephemeris;
}

function interpolateHermiteVector(positionA, velocityA, positionB, velocityB, normalizedTime, spanSec) {
  const u = clamp(normalizedTime, 0, 1);
  const dt = Math.max(1e-9, finiteNumber(spanSec, 1));
  const h00 = (2 * u * u * u) - (3 * u * u) + 1;
  const h10 = (u * u * u) - (2 * u * u) + u;
  const h01 = (-2 * u * u * u) + (3 * u * u);
  const h11 = (u * u * u) - (u * u);
  const m0 = scale(velocityA, dt);
  const m1 = scale(velocityB, dt);
  return add(
    add(scale(positionA, h00), scale(m0, h10)),
    add(scale(positionB, h01), scale(m1, h11)),
  );
}

function interpolateHermiteVelocity(positionA, velocityA, positionB, velocityB, normalizedTime, spanSec) {
  const u = clamp(normalizedTime, 0, 1);
  const dt = Math.max(1e-9, finiteNumber(spanSec, 1));
  const dh00 = (6 * u * u) - (6 * u);
  const dh10 = (3 * u * u) - (4 * u) + 1;
  const dh01 = (-6 * u * u) + (6 * u);
  const dh11 = (3 * u * u) - (2 * u);
  const m0 = scale(velocityA, dt);
  const m1 = scale(velocityB, dt);
  return scale(
    add(
      add(scale(positionA, dh00), scale(m0, dh10)),
      add(scale(positionB, dh01), scale(m1, dh11)),
    ),
    1 / dt,
  );
}

function interpolateSourceDescriptorAtElapsedSec(sampleA, sampleB, elapsedSec = 0, sourceId = "", fallback = null) {
  const first = sampleA?.[sourceId] || null;
  const second = sampleB?.[sourceId] || null;
  if (!first && !second) {
    return null;
  }
  if (!first || !second) {
    return cloneSourceDescriptor(first || second || fallback);
  }
  const spanSec = Math.max(1e-9, finiteNumber(sampleB?.elapsedSec, 0) - finiteNumber(sampleA?.elapsedSec, 0));
  const normalizedTime = (
    finiteNumber(elapsedSec, 0) - finiteNumber(sampleA?.elapsedSec, 0)
  ) / spanSec;
  const positionKm = interpolateHermiteVector(
    first.positionKm,
    first.velocityKmS,
    second.positionKm,
    second.velocityKmS,
    normalizedTime,
    spanSec,
  );
  const velocityKmS = interpolateHermiteVelocity(
    first.positionKm,
    first.velocityKmS,
    second.positionKm,
    second.velocityKmS,
    normalizedTime,
    spanSec,
  );
  return sourceDescriptor({
    ...(fallback || first),
    id: String(first.id || fallback?.id || sourceId),
    positionKm,
    velocityKmS,
    axes: defaultAxesForSource(first.id || sourceId, positionKm, velocityKmS),
  });
}

function propagateMovingSourceDescriptor(source, elapsedSec = 0) {
  if (!source || typeof source !== "object") {
    return null;
  }
  const timeSec = finiteNumber(elapsedSec, 0);
  if (String(source.id || "") === "earth" || Math.abs(timeSec) <= 1e-9) {
    return sourceDescriptor({
      ...source,
      axes: defaultAxesForSource(source.id, source.positionKm, source.velocityKmS),
    });
  }
  const positionKm = finiteVector(source.positionKm) ? source.positionKm : { x: 0, y: 0, z: 0 };
  const velocityKmS = finiteVector(source.velocityKmS) ? source.velocityKmS : { x: 0, y: 0, z: 0 };
  const radiusKm = Math.max(1e-9, length(positionKm));
  const angularMomentum = cross(positionKm, velocityKmS);
  const angularMomentumMag = length(angularMomentum);
  const tangentialSpeedKmS = length(subtract(
    velocityKmS,
    scale(normalize(positionKm, { x: 1, y: 0, z: 0 }), dot(velocityKmS, normalize(positionKm, { x: 1, y: 0, z: 0 }))),
  ));
  if (angularMomentumMag <= 1e-9 || tangentialSpeedKmS <= 1e-9) {
    const propagatedPositionKm = add(positionKm, scale(velocityKmS, timeSec));
    return sourceDescriptor({
      ...source,
      positionKm: propagatedPositionKm,
      velocityKmS,
      axes: defaultAxesForSource(source.id, propagatedPositionKm, velocityKmS),
    });
  }
  const planeNormal = scale(angularMomentum, 1 / angularMomentumMag);
  const angularSpeedRadS = tangentialSpeedKmS / radiusKm;
  const angleRad = angularSpeedRadS * timeSec;
  const propagatedPositionKm = rotateAroundAxis(positionKm, planeNormal, angleRad);
  const propagatedVelocityKmS = rotateAroundAxis(velocityKmS, planeNormal, angleRad);
  return sourceDescriptor({
    ...source,
    positionKm: propagatedPositionKm,
    velocityKmS: propagatedVelocityKmS,
    axes: defaultAxesForSource(source.id, propagatedPositionKm, propagatedVelocityKmS),
  });
}

function sourceModelAtTimeSec(sources, elapsedSec = 0, cache = null) {
  if (!sources || typeof sources !== "object") {
    return null;
  }
  const cacheKey = Number.isFinite(Number(elapsedSec))
    ? String(Math.round(Number(elapsedSec) * 1000) / 1000)
    : "0";
  if (cache instanceof Map && cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  const timeSec = Math.max(0, finiteNumber(elapsedSec, 0));
  const ephemeris = ensureSourceEphemerisCoverage(sources, timeSec);
  const samples = Array.isArray(ephemeris?.samples) ? ephemeris.samples : [];
  if (samples.length > 0) {
    const firstSample = samples[0];
    const lastSample = samples[samples.length - 1];
    let model = null;
    if (samples.length === 1 || timeSec <= finiteNumber(firstSample?.elapsedSec, 0)) {
      model = {
        frame: String(sources.frame || "earth-centered-inertial"),
        stepSec: Math.max(5, finiteNumber(sources.stepSec, DEFAULT_MOON_STEP_SEC)),
        earth: cloneSourceDescriptor(firstSample?.earth || sources.earth),
        moon: cloneSourceDescriptor(firstSample?.moon || sources.moon),
        sun: cloneSourceDescriptor(firstSample?.sun || sources.sun),
      };
    } else if (timeSec >= finiteNumber(lastSample?.elapsedSec, 0)) {
      model = {
        frame: String(sources.frame || "earth-centered-inertial"),
        stepSec: Math.max(5, finiteNumber(sources.stepSec, DEFAULT_MOON_STEP_SEC)),
        earth: cloneSourceDescriptor(lastSample?.earth || sources.earth),
        moon: cloneSourceDescriptor(lastSample?.moon || sources.moon),
        sun: cloneSourceDescriptor(lastSample?.sun || sources.sun),
      };
    } else {
      let low = 0;
      let high = samples.length - 1;
      while (low + 1 < high) {
        const mid = Math.floor((low + high) * 0.5);
        if (finiteNumber(samples[mid]?.elapsedSec, 0) <= timeSec) {
          low = mid;
        } else {
          high = mid;
        }
      }
      const sampleA = samples[low];
      const sampleB = samples[high];
      model = {
        frame: String(sources.frame || "earth-centered-inertial"),
        stepSec: Math.max(5, finiteNumber(sources.stepSec, DEFAULT_MOON_STEP_SEC)),
        earth: interpolateSourceDescriptorAtElapsedSec(sampleA, sampleB, timeSec, "earth", sources.earth),
        moon: interpolateSourceDescriptorAtElapsedSec(sampleA, sampleB, timeSec, "moon", sources.moon),
        sun: interpolateSourceDescriptorAtElapsedSec(sampleA, sampleB, timeSec, "sun", sources.sun),
      };
    }
    if (cache instanceof Map) {
      cache.set(cacheKey, model);
    }
    return model;
  }
  const model = {
    frame: String(sources.frame || "earth-centered-inertial"),
    stepSec: Math.max(5, finiteNumber(sources.stepSec, DEFAULT_MOON_STEP_SEC)),
    earth: propagateMovingSourceDescriptor(sources.earth, 0),
    moon: propagateMovingSourceDescriptor(sources.moon, elapsedSec),
    sun: propagateMovingSourceDescriptor(sources.sun, elapsedSec),
  };
  if (cache instanceof Map) {
    cache.set(cacheKey, model);
  }
  return model;
}

export function buildMoonGuidanceSourceModel({
  targetVectors = {},
  metrics = {},
  plannerConfig = {},
} = {}) {
  const earthGravity = earthConventionalGravityModel(
    Number.isFinite(Number(metrics?.timestampMs)) ? Number(metrics.timestampMs) : Date.now(),
    {
      xpArcsec: finiteNumber(metrics.earthXpArcsec, 0),
      ypArcsec: finiteNumber(metrics.earthYpArcsec, 0),
    },
  );
  const earth = sourceDescriptor({
    id: "earth",
    positionKm: { x: 0, y: 0, z: 0 },
    velocityKmS: { x: 0, y: 0, z: 0 },
    massKg: finiteNumber(metrics.earthMassKg, DEFAULT_EARTH_MASS_KG),
    radiusKm: finiteNumber(metrics.earthRadiusKm, DEFAULT_EARTH_RADIUS_KM),
    referenceRadiusKm: finiteNumber(metrics.earthReferenceRadiusKm, earthGravity.equatorialRadiusKm),
    j2: finiteNumber(metrics.earthJ2, earthGravity.j2 || DEFAULT_EARTH_J2),
    j3: finiteNumber(metrics.earthJ3, earthGravity.j3 || DEFAULT_EARTH_J3),
    j4: finiteNumber(metrics.earthJ4, earthGravity.j4 || DEFAULT_EARTH_J4),
    j5: finiteNumber(metrics.earthJ5, earthGravity.j5 || DEFAULT_EARTH_J5),
    j6: finiteNumber(metrics.earthJ6, earthGravity.j6 || DEFAULT_EARTH_J6),
    c21: finiteNumber(metrics.earthC21, earthGravity.c21),
    s21: finiteNumber(metrics.earthS21, earthGravity.s21),
    c22: finiteNumber(metrics.earthC22, earthGravity.c22),
    s22: finiteNumber(metrics.earthS22, earthGravity.s22),
    harmonicTerms: Array.isArray(earthGravity.harmonics) ? earthGravity.harmonics : null,
  });
  const moon = sourceDescriptor({
    id: "moon",
    positionKm: targetVectors.moonEarthPositionKm,
    velocityKmS: targetVectors.moonEarthVelocityKmS,
    massKg: finiteNumber(metrics.moonMassKg, DEFAULT_MOON_MASS_KG),
    radiusKm: finiteNumber(metrics.moonRadiusKm, DEFAULT_MOON_RADIUS_KM),
    referenceRadiusKm: finiteNumber(metrics.moonReferenceRadiusKm, metrics.moonRadiusKm ?? DEFAULT_MOON_RADIUS_KM),
    j2: finiteNumber(metrics.moonJ2, DEFAULT_MOON_J2),
    c22: finiteNumber(metrics.moonC22, DEFAULT_MOON_C22),
    axes: defaultAxesForSource("moon", targetVectors.moonEarthPositionKm, targetVectors.moonEarthVelocityKmS),
  });
  const sun = finiteVector(targetVectors.sunEarthPositionKm)
    ? sourceDescriptor({
      id: "sun",
      positionKm: targetVectors.sunEarthPositionKm,
      velocityKmS: targetVectors.sunEarthVelocityKmS,
      massKg: finiteNumber(metrics.sunMassKg, DEFAULT_SUN_MASS_KG),
      radiusKm: finiteNumber(metrics.sunRadiusKm, DEFAULT_SUN_RADIUS_KM),
    })
    : null;
  return {
    frame: "earth-centered-inertial",
    stepSec: Math.max(15, finiteNumber(plannerConfig.moonClosedLoopPropagationStepSec, DEFAULT_MOON_STEP_SEC)),
    sourceEphemerisStepSec: Math.max(
      60,
      finiteNumber(
        plannerConfig.moonSourceEphemerisStepSec,
        Math.max(
          300,
          Math.min(
            3600,
            Math.max(
              DEFAULT_SOURCE_EPHEMERIS_STEP_SEC,
              finiteNumber(plannerConfig.moonClosedLoopPropagationStepSec, DEFAULT_MOON_STEP_SEC) * 10,
            ),
          ),
        ),
      ),
    ),
    sourceEphemerisMarginSec: Math.max(
      DEFAULT_SOURCE_EPHEMERIS_MARGIN_SEC,
      finiteNumber(plannerConfig.moonSourceEphemerisMarginSec, DEFAULT_SOURCE_EPHEMERIS_MARGIN_SEC),
    ),
    earth,
    moon,
    sun,
  };
}

export function sampleMoonGuidanceSourceModelAtTimeSec(sources = null, elapsedSec = 0) {
  return sourceModelAtTimeSec(sources, elapsedSec, null);
}

export function cloneMoonGuidanceSourceModelForCache(sources = null) {
  if (!sources || typeof sources !== "object") {
    return null;
  }
  return {
    frame: String(sources.frame || "earth-centered-inertial"),
    stepSec: Math.max(5, finiteNumber(sources.stepSec, DEFAULT_MOON_STEP_SEC)),
    sourceEphemerisStepSec: sourceEphemerisStepSecForSources(sources),
    sourceEphemerisMarginSec: sourceEphemerisMarginSecForSources(
      sources,
      sourceEphemerisStepSecForSources(sources),
    ),
    earth: cloneSourceDescriptor(sources.earth),
    moon: cloneSourceDescriptor(sources.moon),
    sun: cloneSourceDescriptor(sources.sun),
    ephemeris: cloneSourceEphemeris(sources.ephemeris),
  };
}

export function restoreMoonGuidanceSourceModelFromCache({
  sources = null,
  cachedSources = null,
  timestampSec = Number.NaN,
  cachedTimestampSec = Number.NaN,
  positionToleranceKm = 2500,
  velocityToleranceKmS = 0.05,
} = {}) {
  if (!sources || typeof sources !== "object" || !cachedSources || typeof cachedSources !== "object") {
    return false;
  }
  if (!cachedSources.ephemeris || !Array.isArray(cachedSources.ephemeris.samples) || !cachedSources.ephemeris.samples.length) {
    return false;
  }
  const nowSec = Number(timestampSec);
  const cacheSec = Number(cachedTimestampSec);
  if (!Number.isFinite(nowSec) || !Number.isFinite(cacheSec)) {
    return false;
  }
  const elapsedSec = nowSec - cacheSec;
  if (!(elapsedSec >= 0)) {
    return false;
  }
  const sampled = sampleMoonGuidanceSourceModelAtTimeSec(cachedSources, elapsedSec);
  if (!sampled) {
    return false;
  }
  const sourceIds = ["moon", "sun"];
  for (const sourceId of sourceIds) {
    const currentSource = sources[sourceId];
    const cachedSource = sampled[sourceId];
    if (!currentSource || !cachedSource) {
      continue;
    }
    const positionErrorKm = length(subtract(
      currentSource.positionKm || { x: 0, y: 0, z: 0 },
      cachedSource.positionKm || { x: 0, y: 0, z: 0 },
    ));
    const velocityErrorKmS = length(subtract(
      currentSource.velocityKmS || { x: 0, y: 0, z: 0 },
      cachedSource.velocityKmS || { x: 0, y: 0, z: 0 },
    ));
    if (positionErrorKm > Math.max(1, finiteNumber(positionToleranceKm, 2500))) {
      return false;
    }
    if (velocityErrorKmS > Math.max(1e-4, finiteNumber(velocityToleranceKmS, 0.05))) {
      return false;
    }
  }

  const cachedEphemeris = ensureSourceEphemerisCoverage(cachedSources, elapsedSec);
  if (!cachedEphemeris || !Array.isArray(cachedEphemeris.samples) || !cachedEphemeris.samples.length) {
    return false;
  }
  const shiftedSamples = [
    {
      elapsedSec: 0,
      earth: cloneSourceDescriptor(sampled.earth),
      moon: cloneSourceDescriptor(sampled.moon),
      sun: cloneSourceDescriptor(sampled.sun),
    },
  ];
  for (const sample of cachedEphemeris.samples) {
    const sampleElapsedSec = finiteNumber(sample?.elapsedSec, Number.NaN);
    if (!Number.isFinite(sampleElapsedSec) || sampleElapsedSec <= (elapsedSec + 1e-6)) {
      continue;
    }
    shiftedSamples.push({
      elapsedSec: sampleElapsedSec - elapsedSec,
      earth: cloneSourceDescriptor(sample.earth),
      moon: cloneSourceDescriptor(sample.moon),
      sun: cloneSourceDescriptor(sample.sun),
    });
  }
  sources.earth = cloneSourceDescriptor(sampled.earth || sources.earth);
  sources.moon = cloneSourceDescriptor(sampled.moon || sources.moon);
  sources.sun = cloneSourceDescriptor(sampled.sun || sources.sun);
  sources.ephemeris = {
    stepSec: Math.max(60, finiteNumber(cachedEphemeris.stepSec, sourceEphemerisStepSecForSources(cachedSources))),
    marginSec: Math.max(60, finiteNumber(cachedEphemeris.marginSec, sourceEphemerisMarginSecForSources(cachedSources))),
    horizonSec: Math.max(0, finiteNumber(cachedEphemeris.horizonSec, 0) - elapsedSec),
    absoluteBodies: cachedEphemeris.absoluteBodies
      ? {
        earth: cloneSourceDescriptor(cachedEphemeris.absoluteBodies.earth),
        moon: cloneSourceDescriptor(cachedEphemeris.absoluteBodies.moon),
        sun: cloneSourceDescriptor(cachedEphemeris.absoluteBodies.sun),
      }
      : null,
    samples: shiftedSamples,
  };
  sources.sourceEphemerisStepSec = sourceEphemerisStepSecForSources(cachedSources);
  sources.sourceEphemerisMarginSec = sourceEphemerisMarginSecForSources(
    cachedSources,
    sourceEphemerisStepSecForSources(cachedSources),
  );
  return true;
}

export function computeMoonGuidanceAccelerationKmS2({
  positionKm = null,
  velocityKmS = null,
  sources = null,
  spacecraft = null,
  spacecraftMassKg = Number.NaN,
  controlAccelerationKmS2 = null,
} = {}) {
  const statePos = finiteVector(positionKm) ? positionKm : { x: 0, y: 0, z: 0 };
  const stateVel = finiteVector(velocityKmS) ? velocityKmS : { x: 0, y: 0, z: 0 };
  const earth = sources?.earth || sourceDescriptor({
    id: "earth",
    positionKm: { x: 0, y: 0, z: 0 },
    massKg: DEFAULT_EARTH_MASS_KG,
    radiusKm: DEFAULT_EARTH_RADIUS_KM,
  });
  const moon = sources?.moon || null;
  const sun = sources?.sun || null;

  let total = { x: 0, y: 0, z: 0 };
  total = add(total, pointMassAccelerationKmS2(statePos, earth.positionKm, earth.massKg));

  if (finiteVector(statePos) && earth.massKg > 0 && earth.radiusKm > 0) {
    const relEarth = subtract(statePos, earth.positionKm);
    const earthRadius = Math.max(1e-6, length(relEarth));
    const earthMuOverR3 = (GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * earth.massKg) / Math.max(1e-12, earthRadius ** 3);
    total = add(total, computeOblateGravityPerturbationKmS2({
      relPosKm: relEarth,
      radiusKm: earthRadius,
      muOverR3: earthMuOverR3,
      referenceRadiusKm: Math.max(1, finiteNumber(earth.referenceRadiusKm, earth.radiusKm)),
      pole: earth.axes?.pole || { x: 0, y: 0, z: 1 },
      xAxis: earth.axes?.xAxis || { x: 1, y: 0, z: 0 },
      yAxis: earth.axes?.yAxis || { x: 0, y: 1, z: 0 },
      j2: earth.j2,
      j3: earth.j3,
      j4: earth.j4,
      j5: earth.j5,
      j6: earth.j6,
      c21: earth.c21,
      s21: earth.s21,
      c22: earth.c22,
      s22: earth.s22,
      harmonicTerms: earth.harmonicTerms,
    }));
  }

  if (moon) {
    total = add(total, thirdBodyDifferentialAccelerationKmS2({
      targetPosKm: statePos,
      sourcePosKm: moon.positionKm,
      sourceMassKg: moon.massKg,
      frameOriginPosKm: earth.positionKm,
    }));
    const relMoon = subtract(statePos, moon.positionKm);
    const moonRadius = Math.max(1e-6, length(relMoon));
    const moonMuOverR3 = (GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * moon.massKg) / Math.max(1e-12, moonRadius ** 3);
    total = add(total, computeOblateGravityPerturbationKmS2({
      relPosKm: relMoon,
      radiusKm: moonRadius,
      muOverR3: moonMuOverR3,
      referenceRadiusKm: Math.max(1, finiteNumber(moon.referenceRadiusKm, moon.radiusKm)),
      pole: moon.axes?.pole || { x: 0, y: 0, z: 1 },
      xAxis: moon.axes?.xAxis || { x: 1, y: 0, z: 0 },
      yAxis: moon.axes?.yAxis || { x: 0, y: 1, z: 0 },
      j2: moon.j2,
      j3: moon.j3,
      j4: moon.j4,
      j5: moon.j5,
      j6: moon.j6,
      c21: moon.c21,
      s21: moon.s21,
      c22: moon.c22,
      s22: moon.s22,
      harmonicTerms: moon.harmonicTerms,
    }));
    total = add(total, computeLunarMasconAccelerationKmS2({
      targetPosKm: statePos,
      moonCenterPosKm: moon.positionKm,
      moonMassKg: moon.massKg,
      moonRadiusKm: moon.radiusKm,
      moonAxes: moon.axes,
      gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
    }));
  }

  if (sun) {
    total = add(total, thirdBodyDifferentialAccelerationKmS2({
      targetPosKm: statePos,
      sourcePosKm: sun.positionKm,
      sourceMassKg: sun.massKg,
      frameOriginPosKm: earth.positionKm,
    }));
    const transmittance = computeSolarShadowTransmittance({
      targetId: String(spacecraft?.bodyId || "earth_launch_vehicle"),
      targetPosKm: statePos,
      sunPosKm: sun.positionKm,
      sunRadiusKm: sun.radiusKm,
      occluders: [earth, moon].filter(Boolean).map((entry) => ({
        id: entry.id,
        positionKm: entry.positionKm,
        radiusKm: entry.radiusKm,
      })),
    });
    total = add(total, computeSolarRadiationAccelerationKmS2({
      bodyId: String(spacecraft?.bodyId || "earth_launch_vehicle"),
      bodyMeta: { body_type: "spacecraft", radius_km: finiteNumber(spacecraft?.radiusKm, 0) },
      bodyMassKg: Math.max(1, finiteNumber(spacecraftMassKg, finiteNumber(spacecraft?.massKg, 1))),
      targetPosKm: statePos,
      sunPosKm: sun.positionKm,
      transmittance,
      reflectivityCoeff: finiteNumber(spacecraft?.reflectivityCoeff, 1.45),
    }));
  }

  if (finiteVector(controlAccelerationKmS2)) {
    total = add(total, controlAccelerationKmS2);
  }
  return total;
}

function rk4Step(state, dtSec, sources, spacecraft, burnCommand = null, elapsedSec = 0, sourceCache = null) {
  const dt = Math.max(0, Number(dtSec) || 0);
  if (!(dt > 0)) {
    return stateVector(state.positionKm, state.velocityKmS, state.massKg, resolveSpacecraftDryMassKg(spacecraft));
  }
  const derivative = (sampleState, sampleTimeSec) => {
    const dynamicSources = sourceModelAtTimeSec(sources, sampleTimeSec, sourceCache);
    const burnSample = resolveBurnSample({
      sampleState,
      burnCommand,
      spacecraft,
      sampleTimeSec,
    });
    return {
      dPosition: sampleState.velocityKmS,
      dVelocity: computeMoonGuidanceAccelerationKmS2({
        positionKm: sampleState.positionKm,
        velocityKmS: sampleState.velocityKmS,
        sources: dynamicSources,
        spacecraft,
        spacecraftMassKg: sampleState.massKg,
        controlAccelerationKmS2: burnSample.accelerationKmS2,
      }),
      dMassKg: -burnSample.massFlowKgS,
    };
  };
  const minMassKg = resolveSpacecraftDryMassKg(spacecraft);

  const k1 = derivative(state, elapsedSec);
  const k2State = stateVector(
    add(state.positionKm, scale(k1.dPosition, dt * 0.5)),
    add(state.velocityKmS, scale(k1.dVelocity, dt * 0.5)),
    finiteNumber(state.massKg, spacecraft?.massKg) + (k1.dMassKg * dt * 0.5),
    minMassKg,
  );
  const k2 = derivative(k2State, elapsedSec + (dt * 0.5));
  const k3State = stateVector(
    add(state.positionKm, scale(k2.dPosition, dt * 0.5)),
    add(state.velocityKmS, scale(k2.dVelocity, dt * 0.5)),
    finiteNumber(state.massKg, spacecraft?.massKg) + (k2.dMassKg * dt * 0.5),
    minMassKg,
  );
  const k3 = derivative(k3State, elapsedSec + (dt * 0.5));
  const k4State = stateVector(
    add(state.positionKm, scale(k3.dPosition, dt)),
    add(state.velocityKmS, scale(k3.dVelocity, dt)),
    finiteNumber(state.massKg, spacecraft?.massKg) + (k3.dMassKg * dt),
    minMassKg,
  );
  const k4 = derivative(k4State, elapsedSec + dt);

  const weightedPosition = add(
    add(scale(k1.dPosition, 1), scale(k2.dPosition, 2)),
    add(scale(k3.dPosition, 2), scale(k4.dPosition, 1)),
  );
  const weightedVelocity = add(
    add(scale(k1.dVelocity, 1), scale(k2.dVelocity, 2)),
    add(scale(k3.dVelocity, 2), scale(k4.dVelocity, 1)),
  );
  return stateVector(
    add(state.positionKm, scale(weightedPosition, dt / 6)),
    add(state.velocityKmS, scale(weightedVelocity, dt / 6)),
    finiteNumber(state.massKg, spacecraft?.massKg) + (((k1.dMassKg + (2 * k2.dMassKg) + (2 * k3.dMassKg) + k4.dMassKg) * dt) / 6),
    minMassKg,
  );
}

export function propagateMoonGuidanceState({
  initialState = null,
  durationSec = 0,
  stepSec = DEFAULT_MOON_STEP_SEC,
  sources = null,
  spacecraft = null,
  burnCommand = null,
} = {}) {
  if (!initialState || !finiteVector(initialState.positionKm) || !finiteVector(initialState.velocityKmS)) {
    return null;
  }
  const duration = Math.max(0, Number(durationSec) || 0);
  const step = Math.max(5, Number(stepSec) || DEFAULT_MOON_STEP_SEC);
  const sourceCache = new Map();
  let elapsedSec = 0;
  let state = stateVector(
    initialState.positionKm,
    initialState.velocityKmS,
    finiteNumber(initialState.massKg, spacecraft?.massKg),
    resolveSpacecraftDryMassKg(spacecraft),
  );
  const earthRadiusKm = Math.max(1, finiteNumber(sources?.earth?.radiusKm, DEFAULT_EARTH_RADIUS_KM));
  const moonRadiusKm = Math.max(1, finiteNumber(sources?.moon?.radiusKm, DEFAULT_MOON_RADIUS_KM));
  const earthMuKm3S2 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * Math.max(1, finiteNumber(sources?.earth?.massKg, DEFAULT_EARTH_MASS_KG));
  const moonMuKm3S2 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * Math.max(1, finiteNumber(sources?.moon?.massKg, DEFAULT_MOON_MASS_KG));

  let minMoonDistanceKm = Number.POSITIVE_INFINITY;
  let minEarthDistanceKm = Number.POSITIVE_INFINITY;
  let closestMoonState = null;
  let closestEarthState = null;
  let closestMoonSourceState = null;
  let closestEarthSourceState = null;
  let closestMoonTimeSec = Number.NaN;
  let closestEarthTimeSec = Number.NaN;

  while (elapsedSec < duration - 1e-9) {
    const dt = Math.min(step, duration - elapsedSec);
    state = rk4Step(state, dt, sources, spacecraft, burnCommand, elapsedSec, sourceCache);
    elapsedSec += dt;

    const sampleSources = sourceModelAtTimeSec(sources, elapsedSec, sourceCache);
    const sampleMoon = sampleSources?.moon || null;
    const sampleEarth = sampleSources?.earth || null;
    const moonDistanceKm = sampleMoon
      ? length(subtract(state.positionKm, sampleMoon.positionKm))
      : Number.POSITIVE_INFINITY;
    const earthDistanceKm = length(subtract(state.positionKm, sampleEarth?.positionKm || { x: 0, y: 0, z: 0 }));
    if (moonDistanceKm < minMoonDistanceKm) {
      minMoonDistanceKm = moonDistanceKm;
      closestMoonState = stateVector(state.positionKm, state.velocityKmS, state.massKg, resolveSpacecraftDryMassKg(spacecraft));
      closestMoonSourceState = sampleMoon
        ? stateVector(sampleMoon.positionKm, sampleMoon.velocityKmS)
        : null;
      closestMoonTimeSec = elapsedSec;
    }
    if (earthDistanceKm < minEarthDistanceKm) {
      minEarthDistanceKm = earthDistanceKm;
      closestEarthState = stateVector(state.positionKm, state.velocityKmS, state.massKg, resolveSpacecraftDryMassKg(spacecraft));
      closestEarthSourceState = sampleEarth
        ? stateVector(sampleEarth.positionKm, sampleEarth.velocityKmS)
        : null;
      closestEarthTimeSec = elapsedSec;
    }
  }

  const finalSources = sourceModelAtTimeSec(sources, elapsedSec, sourceCache);
  const finalMoonSourceState = finalSources?.moon
    ? stateVector(finalSources.moon.positionKm, finalSources.moon.velocityKmS)
    : null;
  const finalEarthSourceState = finalSources?.earth
    ? stateVector(finalSources.earth.positionKm, finalSources.earth.velocityKmS)
    : stateVector({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  const finalMoonRelPos = finalMoonSourceState ? subtract(state.positionKm, finalMoonSourceState.positionKm) : null;
  const finalMoonRelVel = finalMoonSourceState ? subtract(state.velocityKmS, finalMoonSourceState.velocityKmS) : null;
  const finalEarthRelPos = subtract(state.positionKm, finalEarthSourceState.positionKm);
  const finalEarthRelVel = subtract(state.velocityKmS, finalEarthSourceState.velocityKmS);
  const moonOrbit = finalMoonRelPos && finalMoonRelVel
    ? orbitalStateFromRelative(moonMuKm3S2, moonRadiusKm, finalMoonRelPos, finalMoonRelVel)
    : null;
  const earthOrbit = orbitalStateFromRelative(earthMuKm3S2, earthRadiusKm, finalEarthRelPos, finalEarthRelVel);

  const closestMoonRelPos = closestMoonState && closestMoonSourceState
    ? subtract(closestMoonState.positionKm, closestMoonSourceState.positionKm)
    : null;
  const closestMoonRelVel = closestMoonState && closestMoonSourceState
    ? subtract(closestMoonState.velocityKmS, closestMoonSourceState.velocityKmS)
    : null;
  const closestEarthRelPos = closestEarthState && closestEarthSourceState
    ? subtract(closestEarthState.positionKm, closestEarthSourceState.positionKm)
    : null;
  const closestEarthRelVel = closestEarthState && closestEarthSourceState
    ? subtract(closestEarthState.velocityKmS, closestEarthSourceState.velocityKmS)
    : null;
  const closestMoonRangeKm = closestMoonRelPos ? length(closestMoonRelPos) : Number.POSITIVE_INFINITY;
  const closestMoonClosingSpeedKmS = (
    closestMoonRelPos
    && closestMoonRelVel
    && closestMoonRangeKm > 1e-9
  )
    ? -dot(closestMoonRelVel, scale(closestMoonRelPos, 1 / closestMoonRangeKm))
    : Number.NaN;

  return {
    finalState: state,
    durationSec: duration,
    minMoonDistanceKm,
    minMoonAltitudeKm: Number.isFinite(minMoonDistanceKm) ? (minMoonDistanceKm - moonRadiusKm) : Number.NaN,
    minEarthDistanceKm,
    minEarthAltitudeKm: Number.isFinite(minEarthDistanceKm) ? (minEarthDistanceKm - earthRadiusKm) : Number.NaN,
    closestMoonState,
    closestEarthState,
    closestMoonSourceState,
    closestEarthSourceState,
    closestMoonTimeSec,
    closestEarthTimeSec,
    closestMoonRelativePositionKm: closestMoonRelPos,
    closestMoonRelativeVelocityKmS: closestMoonRelVel,
    closestEarthRelativePositionKm: closestEarthRelPos,
    closestEarthRelativeVelocityKmS: closestEarthRelVel,
    closestMoonClosingSpeedKmS,
    earthOrbit,
    moonOrbit,
    finalMoonSourceState,
    finalEarthSourceState,
    finalMoonRelativePositionKm: finalMoonRelPos,
    finalMoonRelativeVelocityKmS: finalMoonRelVel,
    finalEarthRelativePositionKm: finalEarthRelPos,
    finalEarthRelativeVelocityKmS: finalEarthRelVel,
    finalMoonDistanceKm: finalMoonRelPos ? length(finalMoonRelPos) : Number.POSITIVE_INFINITY,
    finalMoonRelativeSpeedKmS: finalMoonRelVel ? length(finalMoonRelVel) : Number.POSITIVE_INFINITY,
  };
}

export function estimateBPlaneErrorKm({
  relativePositionKm = null,
  relativeVelocityKmS = null,
  targetPeriluneAltitudeKm = 120,
  bodyRadiusKm = DEFAULT_MOON_RADIUS_KM,
  bodyMuKm3S2 = DEFAULT_MOON_MU_KM3_S2,
} = {}) {
  if (!finiteVector(relativePositionKm) || !finiteVector(relativeVelocityKmS)) {
    return Number.NaN;
  }
  const muKm3S2 = Math.max(1e-9, finiteNumber(bodyMuKm3S2, DEFAULT_MOON_MU_KM3_S2));
  const radiusKm = Math.max(1e-9, length(relativePositionKm));
  const speedKmS = Math.max(1e-9, length(relativeVelocityKmS));
  const specificEnergyKm2S2 = (0.5 * speedKmS * speedKmS) - (muKm3S2 / radiusKm);
  const angularMomentumVec = cross(relativePositionKm, relativeVelocityKmS);
  const angularMomentumKm2S = length(angularMomentumVec);
  const targetPeriapsisRadiusKm = Math.max(
    1,
    finiteNumber(bodyRadiusKm, DEFAULT_MOON_RADIUS_KM) + Math.max(20, finiteNumber(targetPeriluneAltitudeKm, 120)),
  );
  if (specificEnergyKm2S2 > 1e-9 && angularMomentumKm2S > 1e-9) {
    const eccentricityVec = subtract(
      scale(cross(relativeVelocityKmS, angularMomentumVec), 1 / muKm3S2),
      scale(relativePositionKm, 1 / radiusKm),
    );
    const eccentricity = length(eccentricityVec);
    if (eccentricity > 1 + 1e-9) {
      const hyperbolicExcessSpeedKmS = Math.sqrt(2 * specificEnergyKm2S2);
      const actualImpactParameterKm = angularMomentumKm2S / hyperbolicExcessSpeedKmS;
      const targetImpactParameterKm = targetPeriapsisRadiusKm * Math.sqrt(
        1 + ((2 * muKm3S2) / (targetPeriapsisRadiusKm * hyperbolicExcessSpeedKmS * hyperbolicExcessSpeedKmS)),
      );
      return Math.abs(actualImpactParameterKm - targetImpactParameterKm);
    }
  }
  const approachAxis = scale(relativeVelocityKmS, 1 / speedKmS);
  const lateral = subtract(relativePositionKm, scale(approachAxis, dot(relativePositionKm, approachAxis)));
  const impactParameterKm = length(lateral);
  return Math.abs(impactParameterKm - targetPeriapsisRadiusKm);
}

export function burnDurationForDeltaVSec(deltaVNeedKmS, accelAtThrottle1KmS2, throttle = 1, spacecraft = null) {
  return burnDurationForDeltaVSecWithSpacecraft(deltaVNeedKmS, accelAtThrottle1KmS2, throttle, spacecraft);
}

function burnDurationForDeltaVSecWithSpacecraft(deltaVNeedKmS, accelAtThrottle1KmS2, throttle = 1, spacecraft = null) {
  const accel = Math.max(1e-8, finiteNumber(accelAtThrottle1KmS2, 0) * clamp(Number(throttle) || 0, 0, 1));
  const dv = Math.max(0, finiteNumber(deltaVNeedKmS, 0));
  const pressurePa = Math.max(0, finiteNumber(spacecraft?.ambientPressurePa, 0));
  const thrustPerThrottleN = interpolateSeaToVac(
    finiteNumber(spacecraft?.thrustVacuumN, 0),
    finiteNumber(spacecraft?.thrustSeaLevelN, spacecraft?.thrustVacuumN),
    pressurePa,
  );
  const ispS = interpolateSeaToVac(
    finiteNumber(spacecraft?.ispVacuumS, 0),
    finiteNumber(spacecraft?.ispSeaLevelS, spacecraft?.ispVacuumS),
    pressurePa,
  );
  const throttleClamped = clamp(Number(throttle) || 0, 0, 1);
  const thrustN = thrustPerThrottleN * throttleClamped;
  const initialMassKg = Math.max(1, finiteNumber(spacecraft?.massKg, Number.NaN));
  const dryMassKg = Math.max(1, finiteNumber(resolveSpacecraftDryMassKg(spacecraft), Number.NaN));
  if (
    Number.isFinite(initialMassKg)
    && Number.isFinite(dryMassKg)
    && initialMassKg > dryMassKg
    && thrustN > 0
    && ispS > 0
  ) {
    const exhaustVelocityMS = ispS * STANDARD_GRAVITY_M_S2;
    const dvMS = dv * 1000;
    const targetFinalMassKg = initialMassKg / Math.exp(dvMS / exhaustVelocityMS);
    const boundedFinalMassKg = Math.max(dryMassKg, targetFinalMassKg);
    const propellantUseKg = Math.max(0, initialMassKg - boundedFinalMassKg);
    const massFlowKgS = thrustN / exhaustVelocityMS;
    if (massFlowKgS > 0) {
      return propellantUseKg / massFlowKgS;
    }
  }
  return dv / accel;
}
