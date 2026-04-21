import {
  add,
  clamp,
  dot,
  finiteVector,
  length,
  normalize,
  scale,
  subtract,
} from "../navigation_system/navigationMath.js";
import { earthConventionalGravityModel } from "../dynamics/earthGravityModel.js";

const DEFAULT_EARTH_MASS_KG = 5.97237e24;
const DEFAULT_MOON_MASS_KG = 7.342e22;
const DEFAULT_SUN_MASS_KG = 1.98847e30;
const DEFAULT_EARTH_RADIUS_KM = 6371.0084;
const DEFAULT_MOON_RADIUS_KM = 1737.4;
const DEFAULT_SUN_RADIUS_KM = 696340;
const DEFAULT_SOURCE_EPHEMERIS_STEP_SEC = 1800;
const DEFAULT_SOURCE_EPHEMERIS_MARGIN_SEC = 3600;
const DEFAULT_MOON_STEP_SEC = 90;
const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const DEFAULT_EARTH_J2 = earthConventionalGravityModel(Date.UTC(2000, 0, 1, 12, 0, 0, 0)).j2;
const DEFAULT_EARTH_J3 = earthConventionalGravityModel(Date.UTC(2000, 0, 1, 12, 0, 0, 0)).j3;
const DEFAULT_EARTH_J4 = earthConventionalGravityModel(Date.UTC(2000, 0, 1, 12, 0, 0, 0)).j4;
const DEFAULT_EARTH_J5 = earthConventionalGravityModel(Date.UTC(2000, 0, 1, 12, 0, 0, 0)).j5;
const DEFAULT_EARTH_J6 = 5.40681239107e-7;
const DEFAULT_MOON_J2 = 2.034e-4;
const DEFAULT_MOON_C22 = 2.241e-5;

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

export function createLunarSourceDescriptor({
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
  return source ? createLunarSourceDescriptor(source) : null;
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
  return createLunarSourceDescriptor({
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
  return createLunarSourceDescriptor({
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
  return createLunarSourceDescriptor({
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
    return createLunarSourceDescriptor({
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
    return createLunarSourceDescriptor({
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
  return createLunarSourceDescriptor({
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
  const earth = createLunarSourceDescriptor({
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
  const moon = createLunarSourceDescriptor({
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
    ? createLunarSourceDescriptor({
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

export function sampleMoonGuidanceSourceModelAtTimeSec(sources = null, elapsedSec = 0, cache = null) {
  return sourceModelAtTimeSec(sources, elapsedSec, cache);
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
  for (const sourceId of ["moon", "sun"]) {
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
