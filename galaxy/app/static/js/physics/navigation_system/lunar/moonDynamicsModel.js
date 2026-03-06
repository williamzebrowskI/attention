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
import {
  computeSolarRadiationAccelerationKmS2,
  computeSolarShadowTransmittance,
} from "../../dynamics/solarRadiationPressure.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const DEFAULT_EARTH_MASS_KG = 5.97237e24;
const DEFAULT_MOON_MASS_KG = 7.342e22;
const DEFAULT_SUN_MASS_KG = 1.98847e30;
const DEFAULT_EARTH_RADIUS_KM = 6371;
const DEFAULT_MOON_RADIUS_KM = 1737.4;
const DEFAULT_SUN_RADIUS_KM = 696340;
const DEFAULT_EARTH_J2 = 1.08262668e-3;
const DEFAULT_EARTH_J4 = -1.61962159137e-6;
const DEFAULT_EARTH_J6 = 5.40681239107e-7;
const DEFAULT_MOON_J2 = 2.034e-4;
const DEFAULT_MOON_C22 = 2.241e-5;
const DEFAULT_MOON_STEP_SEC = 90;

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

function stateVector(positionKm, velocityKmS) {
  return {
    positionKm: finiteVector(positionKm) ? { ...positionKm } : { x: 0, y: 0, z: 0 },
    velocityKmS: finiteVector(velocityKmS) ? { ...velocityKmS } : { x: 0, y: 0, z: 0 },
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
  j2 = 0,
  j4 = 0,
  j6 = 0,
  c22 = 0,
  s22 = 0,
  axes = null,
} = {}) {
  return {
    id: String(id || ""),
    positionKm: finiteVector(positionKm) ? { ...positionKm } : { x: 0, y: 0, z: 0 },
    velocityKmS: finiteVector(velocityKmS) ? { ...velocityKmS } : { x: 0, y: 0, z: 0 },
    massKg: Math.max(0, finiteNumber(massKg, 0)),
    radiusKm: Math.max(1, finiteNumber(radiusKm, 1)),
    j2: finiteNumber(j2, 0),
    j4: finiteNumber(j4, 0),
    j6: finiteNumber(j6, 0),
    c22: finiteNumber(c22, 0),
    s22: finiteNumber(s22, 0),
    axes: axes || defaultAxesForSource(id, positionKm, velocityKmS),
  };
}

export function buildMoonGuidanceSourceModel({
  targetVectors = {},
  metrics = {},
  plannerConfig = {},
} = {}) {
  const earth = sourceDescriptor({
    id: "earth",
    positionKm: { x: 0, y: 0, z: 0 },
    velocityKmS: { x: 0, y: 0, z: 0 },
    massKg: finiteNumber(metrics.earthMassKg, DEFAULT_EARTH_MASS_KG),
    radiusKm: finiteNumber(metrics.earthRadiusKm, DEFAULT_EARTH_RADIUS_KM),
    j2: finiteNumber(metrics.earthJ2, DEFAULT_EARTH_J2),
    j4: finiteNumber(metrics.earthJ4, DEFAULT_EARTH_J4),
    j6: finiteNumber(metrics.earthJ6, DEFAULT_EARTH_J6),
  });
  const moon = sourceDescriptor({
    id: "moon",
    positionKm: targetVectors.moonEarthPositionKm,
    velocityKmS: targetVectors.moonEarthVelocityKmS,
    massKg: finiteNumber(metrics.moonMassKg, DEFAULT_MOON_MASS_KG),
    radiusKm: finiteNumber(metrics.moonRadiusKm, DEFAULT_MOON_RADIUS_KM),
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
    earth,
    moon,
    sun,
  };
}

export function computeMoonGuidanceAccelerationKmS2({
  positionKm = null,
  velocityKmS = null,
  sources = null,
  spacecraft = null,
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
      referenceRadiusKm: earth.radiusKm,
      pole: earth.axes?.pole || { x: 0, y: 0, z: 1 },
      xAxis: earth.axes?.xAxis || { x: 1, y: 0, z: 0 },
      yAxis: earth.axes?.yAxis || { x: 0, y: 1, z: 0 },
      j2: earth.j2,
      j4: earth.j4,
      j6: earth.j6,
      c22: earth.c22,
      s22: earth.s22,
    }));
  }

  if (moon) {
    total = add(total, pointMassAccelerationKmS2(statePos, moon.positionKm, moon.massKg));
    const relMoon = subtract(statePos, moon.positionKm);
    const moonRadius = Math.max(1e-6, length(relMoon));
    const moonMuOverR3 = (GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * moon.massKg) / Math.max(1e-12, moonRadius ** 3);
    total = add(total, computeOblateGravityPerturbationKmS2({
      relPosKm: relMoon,
      radiusKm: moonRadius,
      muOverR3: moonMuOverR3,
      referenceRadiusKm: moon.radiusKm,
      pole: moon.axes?.pole || { x: 0, y: 0, z: 1 },
      xAxis: moon.axes?.xAxis || { x: 1, y: 0, z: 0 },
      yAxis: moon.axes?.yAxis || { x: 0, y: 1, z: 0 },
      j2: moon.j2,
      j4: moon.j4,
      j6: moon.j6,
      c22: moon.c22,
      s22: moon.s22,
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
    total = add(total, pointMassAccelerationKmS2(statePos, sun.positionKm, sun.massKg));
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
      bodyMassKg: Math.max(1, finiteNumber(spacecraft?.massKg, 1)),
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

function rk4Step(state, dtSec, sources, spacecraft, burnCommand = null, elapsedSec = 0) {
  const dt = Math.max(0, Number(dtSec) || 0);
  if (!(dt > 0)) {
    return stateVector(state.positionKm, state.velocityKmS);
  }
  const accelForSample = (sampleState, sampleTimeSec) => {
    let control = { x: 0, y: 0, z: 0 };
    if (burnCommand && sampleTimeSec < Math.max(0, finiteNumber(burnCommand.burnDurationSec, 0))) {
      const throttle = clamp(finiteNumber(burnCommand.throttle, 0), 0, 1);
      const accelAtThrottle1 = Math.max(0, finiteNumber(burnCommand.accelAtThrottle1KmS2, 0));
      const direction = normalize(burnCommand.direction, { x: 0, y: 1, z: 0 });
      control = scale(direction, throttle * accelAtThrottle1);
    }
    return computeMoonGuidanceAccelerationKmS2({
      positionKm: sampleState.positionKm,
      velocityKmS: sampleState.velocityKmS,
      sources,
      spacecraft,
      controlAccelerationKmS2: control,
    });
  };
  const derivative = (sampleState, sampleTimeSec) => ({
    dPosition: sampleState.velocityKmS,
    dVelocity: accelForSample(sampleState, sampleTimeSec),
  });

  const k1 = derivative(state, elapsedSec);
  const k2State = stateVector(
    add(state.positionKm, scale(k1.dPosition, dt * 0.5)),
    add(state.velocityKmS, scale(k1.dVelocity, dt * 0.5)),
  );
  const k2 = derivative(k2State, elapsedSec + (dt * 0.5));
  const k3State = stateVector(
    add(state.positionKm, scale(k2.dPosition, dt * 0.5)),
    add(state.velocityKmS, scale(k2.dVelocity, dt * 0.5)),
  );
  const k3 = derivative(k3State, elapsedSec + (dt * 0.5));
  const k4State = stateVector(
    add(state.positionKm, scale(k3.dPosition, dt)),
    add(state.velocityKmS, scale(k3.dVelocity, dt)),
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
  let elapsedSec = 0;
  let state = stateVector(initialState.positionKm, initialState.velocityKmS);
  const earthRadiusKm = Math.max(1, finiteNumber(sources?.earth?.radiusKm, DEFAULT_EARTH_RADIUS_KM));
  const moonRadiusKm = Math.max(1, finiteNumber(sources?.moon?.radiusKm, DEFAULT_MOON_RADIUS_KM));
  const earthMuKm3S2 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * Math.max(1, finiteNumber(sources?.earth?.massKg, DEFAULT_EARTH_MASS_KG));
  const moonMuKm3S2 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * Math.max(1, finiteNumber(sources?.moon?.massKg, DEFAULT_MOON_MASS_KG));

  let minMoonDistanceKm = Number.POSITIVE_INFINITY;
  let minEarthDistanceKm = Number.POSITIVE_INFINITY;
  let closestMoonState = null;
  let closestEarthState = null;

  while (elapsedSec < duration - 1e-9) {
    const dt = Math.min(step, duration - elapsedSec);
    state = rk4Step(state, dt, sources, spacecraft, burnCommand, elapsedSec);
    elapsedSec += dt;

    const moonDistanceKm = sources?.moon ? length(subtract(state.positionKm, sources.moon.positionKm)) : Number.POSITIVE_INFINITY;
    const earthDistanceKm = length(subtract(state.positionKm, sources?.earth?.positionKm || { x: 0, y: 0, z: 0 }));
    if (moonDistanceKm < minMoonDistanceKm) {
      minMoonDistanceKm = moonDistanceKm;
      closestMoonState = stateVector(state.positionKm, state.velocityKmS);
    }
    if (earthDistanceKm < minEarthDistanceKm) {
      minEarthDistanceKm = earthDistanceKm;
      closestEarthState = stateVector(state.positionKm, state.velocityKmS);
    }
  }

  const finalMoonRelPos = sources?.moon ? subtract(state.positionKm, sources.moon.positionKm) : null;
  const finalMoonRelVel = sources?.moon ? subtract(state.velocityKmS, sources.moon.velocityKmS) : null;
  const finalEarthRelPos = subtract(state.positionKm, sources?.earth?.positionKm || { x: 0, y: 0, z: 0 });
  const finalEarthRelVel = subtract(state.velocityKmS, sources?.earth?.velocityKmS || { x: 0, y: 0, z: 0 });
  const moonOrbit = finalMoonRelPos && finalMoonRelVel
    ? orbitalStateFromRelative(moonMuKm3S2, moonRadiusKm, finalMoonRelPos, finalMoonRelVel)
    : null;
  const earthOrbit = orbitalStateFromRelative(earthMuKm3S2, earthRadiusKm, finalEarthRelPos, finalEarthRelVel);

  const closestMoonRelPos = closestMoonState && sources?.moon
    ? subtract(closestMoonState.positionKm, sources.moon.positionKm)
    : null;
  const closestMoonRelVel = closestMoonState && sources?.moon
    ? subtract(closestMoonState.velocityKmS, sources.moon.velocityKmS)
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
    closestMoonClosingSpeedKmS,
    earthOrbit,
    moonOrbit,
    finalMoonDistanceKm: finalMoonRelPos ? length(finalMoonRelPos) : Number.POSITIVE_INFINITY,
    finalMoonRelativeSpeedKmS: finalMoonRelVel ? length(finalMoonRelVel) : Number.POSITIVE_INFINITY,
  };
}

export function estimateBPlaneErrorKm({
  relativePositionKm = null,
  relativeVelocityKmS = null,
  targetPeriluneAltitudeKm = 120,
  bodyRadiusKm = DEFAULT_MOON_RADIUS_KM,
} = {}) {
  if (!finiteVector(relativePositionKm) || !finiteVector(relativeVelocityKmS)) {
    return Number.NaN;
  }
  const velocityMag = Math.max(1e-9, length(relativeVelocityKmS));
  const approachAxis = scale(relativeVelocityKmS, 1 / velocityMag);
  const lateral = subtract(relativePositionKm, scale(approachAxis, dot(relativePositionKm, approachAxis)));
  const impactParameterKm = length(lateral);
  const targetImpactKm = Math.max(0, Number(bodyRadiusKm) + Math.max(20, Number(targetPeriluneAltitudeKm) || 120));
  return Math.abs(impactParameterKm - targetImpactKm);
}

export function burnDurationForDeltaVSec(deltaVNeedKmS, accelAtThrottle1KmS2, throttle = 1) {
  const accel = Math.max(1e-8, finiteNumber(accelAtThrottle1KmS2, 0) * clamp(Number(throttle) || 0, 0, 1));
  const dv = Math.max(0, finiteNumber(deltaVNeedKmS, 0));
  return dv / accel;
}
