import { EARTH_SIDEREAL_ANGULAR_RATE_RAD_S } from "./launchConfig.js";
import { LAUNCH_REALISM_CONFIG } from "./launchRealismConfig.js";
import {
  add,
  angleBetweenRadians,
  clamp,
  cross,
  degrees,
  dot,
  length,
  mixVectors,
  normalize,
  rad,
  scale,
  subtract,
  unitOrNull,
} from "./launchMath.js";

const EPSILON = 1e-12;
const MIN_AIR_DENSITY_KG_M3 = 1e-7;
const MIN_DYNAMIC_PRESSURE_PA = 1;

function linearInterpolate(a, b, t) {
  const tt = clamp(Number(t) || 0, 0, 1);
  return a + ((b - a) * tt);
}

function sampleTableLinear(x, xs, ys) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length <= 0 || ys.length <= 0) {
    return Number(ys?.[0]) || 0;
  }
  const sample = Number(x) || 0;
  if (sample <= xs[0]) {
    return Number(ys[0]) || 0;
  }
  const last = xs.length - 1;
  if (sample >= xs[last]) {
    return Number(ys[Math.min(last, ys.length - 1)]) || 0;
  }
  for (let i = 0; i < last; i += 1) {
    const x0 = Number(xs[i]) || 0;
    const x1 = Number(xs[i + 1]) || x0;
    if (!(sample >= x0 && sample <= x1)) {
      continue;
    }
    const y0 = Number(ys[i]) || 0;
    const y1 = Number(ys[Math.min(i + 1, ys.length - 1)]) || y0;
    const ratio = (sample - x0) / Math.max(x1 - x0, EPSILON);
    return linearInterpolate(y0, y1, ratio);
  }
  return Number(ys[0]) || 0;
}

function speedOfSoundMs(temperatureK) {
  const temp = Number(temperatureK) || 0;
  if (!(temp > 0)) {
    return 0;
  }
  return Math.sqrt(1.4 * 287.05287 * temp);
}

function localEastNorthAxes(up, earthPole) {
  const safeUp = normalize(up || earthPole || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const pole = normalize(earthPole || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const east = normalize(
    cross(pole, safeUp),
    normalize(cross({ x: 0, y: 0, z: 1 }, safeUp), { x: 1, y: 0, z: 0 }),
  );
  const north = normalize(cross(safeUp, east), pole);
  return { east, north };
}

function stageAeroProfile(kind) {
  if (kind === "stage2") {
    return LAUNCH_REALISM_CONFIG.aero.stage2;
  }
  if (kind === "booster") {
    return LAUNCH_REALISM_CONFIG.aero.booster;
  }
  return LAUNCH_REALISM_CONFIG.aero.stage1;
}

function finiteVectorLike(v) {
  return Boolean(
    v
    && Number.isFinite(Number(v.x))
    && Number.isFinite(Number(v.y))
    && Number.isFinite(Number(v.z)),
  );
}

export function sampleWindVectorKmS({
  altitudeKm,
  relPos,
  earthPole,
  elapsedSeconds,
  seed = 0,
}) {
  const altitudeSafeKm = Math.max(0, Number(altitudeKm) || 0);
  const up = normalize(relPos || earthPole || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const { east, north } = localEastNorthAxes(up, earthPole);
  const layers = LAUNCH_REALISM_CONFIG.wind.layers;
  const layerAltitudes = layers.map((layer) => Number(layer.altitudeKm) || 0);
  const eastSamples = layers.map((layer) => Number(layer.eastMS) || 0);
  const northSamples = layers.map((layer) => Number(layer.northMS) || 0);
  const steadyEastMS = sampleTableLinear(altitudeSafeKm, layerAltitudes, eastSamples);
  const steadyNorthMS = sampleTableLinear(altitudeSafeKm, layerAltitudes, northSamples);

  const t = Math.max(0, Number(elapsedSeconds) || 0);
  const posPhase = (Number(relPos?.x) || 0) * 0.0003
    + (Number(relPos?.y) || 0) * 0.0002
    + (Number(relPos?.z) || 0) * 0.00025;
  const seedPhase = ((Number(seed) || 0) * 0.000001) + posPhase;
  const nearSurfaceFactor = clamp(1 - (altitudeSafeKm / 48), 0, 1);
  const jetFactor = clamp(1 - (Math.abs(altitudeSafeKm - 14) / 22), 0, 1);
  const gustScaleMS = linearInterpolate(
    LAUNCH_REALISM_CONFIG.wind.gustMinMS,
    LAUNCH_REALISM_CONFIG.wind.gustMaxMS,
    clamp((nearSurfaceFactor * 0.45) + (jetFactor * 0.55), 0, 1),
  );
  const gustEastMS = gustScaleMS * (
    (0.48 * Math.sin((t * 0.28) + seedPhase))
    + (0.22 * Math.sin((t * 0.73) + (seedPhase * 1.7)))
    + (0.13 * Math.sin((t * 1.6) + (seedPhase * 0.8)))
  );
  const gustNorthMS = gustScaleMS * (
    (0.41 * Math.sin((t * 0.24) + (seedPhase * 1.13) + 1.4))
    + (0.26 * Math.sin((t * 0.66) + (seedPhase * 1.95) + 0.7))
    + (0.12 * Math.sin((t * 1.48) + (seedPhase * 0.67) + 2.1))
  );

  const eastMS = steadyEastMS + gustEastMS;
  const northMS = steadyNorthMS + gustNorthMS;
  const vectorKmS = add(
    scale(east, eastMS / 1000),
    scale(north, northMS / 1000),
  );
  return {
    vectorKmS,
    eastMS,
    northMS,
    gustEastMS,
    gustNorthMS,
    speedKmS: length(vectorKmS),
  };
}

export function atmosphereRelativeVelocityKmS(relPos, relVel, earthPole, windVectorKmS = null) {
  const pole = normalize(earthPole || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const omega = scale(pole, EARTH_SIDEREAL_ANGULAR_RATE_RAD_S);
  const atmosphereCoRotation = cross(omega, relPos);
  const relativeToCoRotation = subtract(relVel, atmosphereCoRotation);
  if (windVectorKmS && finiteVectorLike(windVectorKmS)) {
    return subtract(relativeToCoRotation, windVectorKmS);
  }
  return relativeToCoRotation;
}

export function dynamicPressurePaFromAtmosphere(
  atmosphereSample,
  relPos,
  relVel,
  earthPole,
  windVectorKmS = null,
) {
  const densityKgM3 = Number(atmosphereSample?.densityKgM3) || 0;
  if (!(densityKgM3 > 0) || !relPos || !relVel) {
    return 0;
  }
  const relAirVelocity = atmosphereRelativeVelocityKmS(relPos, relVel, earthPole, windVectorKmS);
  const speedKmS = length(relAirVelocity);
  if (!(speedKmS > 1e-12)) {
    return 0;
  }
  return 0.5 * densityKgM3 * Math.pow(speedKmS * 1000, 2);
}

export function computeAerodynamicResponse({
  bodyKind = "stage1",
  atmosphereSample,
  relPos,
  relVel,
  earthPole,
  windVectorKmS,
  bodyAxisDirection,
  referenceAreaM2,
  massKg,
  minMassKg = 500,
}) {
  const densityKgM3 = Number(atmosphereSample?.densityKgM3) || 0;
  const safeMassKg = Math.max(minMassKg, Number(massKg) || minMassKg);
  const areaM2 = Math.max(0, Number(referenceAreaM2) || 0);
  if (!(densityKgM3 > MIN_AIR_DENSITY_KG_M3) || !(areaM2 > 0) || !relPos || !relVel) {
    return {
      accelerationKmS2: { x: 0, y: 0, z: 0 },
      dynamicPressurePa: 0,
      angleOfAttackDeg: 0,
      angleOfAttackRad: 0,
      machNumber: 0,
      qAlphaPaRad: 0,
      dragCoefficient: 0,
      liftCoefficient: 0,
      momentCoefficient: 0,
      relAirVelocityKmS: { x: 0, y: 0, z: 0 },
      relAirSpeedKmS: 0,
    };
  }

  const relAirVelocityKmS = atmosphereRelativeVelocityKmS(
    relPos,
    relVel,
    earthPole,
    windVectorKmS,
  );
  const relAirSpeedKmS = length(relAirVelocityKmS);
  if (!(relAirSpeedKmS > 1e-9)) {
    return {
      accelerationKmS2: { x: 0, y: 0, z: 0 },
      dynamicPressurePa: 0,
      angleOfAttackDeg: 0,
      angleOfAttackRad: 0,
      machNumber: 0,
      qAlphaPaRad: 0,
      dragCoefficient: 0,
      liftCoefficient: 0,
      momentCoefficient: 0,
      relAirVelocityKmS,
      relAirSpeedKmS: 0,
    };
  }

  const qPa = 0.5 * densityKgM3 * Math.pow(relAirSpeedKmS * 1000, 2);
  const relAirDirection = normalize(relAirVelocityKmS, { x: 0, y: 0, z: 1 });
  const bodyAxis = normalize(bodyAxisDirection || relAirDirection, relAirDirection);
  const aoaRad = angleBetweenRadians(bodyAxis, relAirDirection);
  const aoaDeg = degrees(aoaRad);

  const soundSpeedMs = speedOfSoundMs(Number(atmosphereSample?.temperatureK) || 0);
  const machNumber = soundSpeedMs > 1e-9
    ? (relAirSpeedKmS * 1000) / soundSpeedMs
    : 0;
  const profile = stageAeroProfile(bodyKind);
  const cd0 = sampleTableLinear(machNumber, profile.mach, profile.cd0);
  const clAlphaPerRad = sampleTableLinear(machNumber, profile.mach, profile.clAlphaPerRad);
  const cmAlphaPerRad = sampleTableLinear(machNumber, profile.mach, profile.cmAlphaPerRad);
  const cd = clamp(cd0 + (Number(profile.cdAlpha2) * aoaRad * aoaRad), 0.12, 1.8);
  const cl = clamp(clAlphaPerRad * aoaRad, -2.8, 2.8);
  const cm = clamp(cmAlphaPerRad * aoaRad, -1.4, 1.4);

  const dragAccKmS2 = (qPa * areaM2 * cd) / safeMassKg / 1000;
  const dragAcceleration = scale(relAirDirection, -dragAccKmS2);
  const liftPlaneDirection = subtract(
    bodyAxis,
    scale(relAirDirection, dot(bodyAxis, relAirDirection)),
  );
  const liftDirection = unitOrNull(liftPlaneDirection);
  const liftAccKmS2 = (qPa * areaM2 * cl) / safeMassKg / 1000;
  const liftAcceleration = liftDirection
    ? scale(liftDirection, liftAccKmS2)
    : { x: 0, y: 0, z: 0 };
  return {
    accelerationKmS2: add(dragAcceleration, liftAcceleration),
    dynamicPressurePa: qPa,
    angleOfAttackDeg: aoaDeg,
    angleOfAttackRad: aoaRad,
    machNumber,
    qAlphaPaRad: qPa * Math.abs(aoaRad),
    dragCoefficient: cd,
    liftCoefficient: cl,
    momentCoefficient: cm,
    relAirVelocityKmS,
    relAirSpeedKmS,
  };
}

export function applyQAlphaSteeringLimit({
  desiredDirection,
  relAirVelocityKmS,
  dynamicPressurePa,
  bodyKind = "stage1",
}) {
  const desired = normalize(desiredDirection, { x: 0, y: 0, z: 1 });
  const relAirSpeed = length(relAirVelocityKmS || { x: 0, y: 0, z: 0 });
  if (!(relAirSpeed > 1e-9) || !(dynamicPressurePa > MIN_DYNAMIC_PRESSURE_PA)) {
    return {
      direction: desired,
      limited: false,
      angleOfAttackDeg: 0,
      maxAllowedAoADeg: LAUNCH_REALISM_CONFIG.aero.maxAoADegLowQ,
      qAlphaPaRad: 0,
    };
  }

  const profile = stageAeroProfile(bodyKind);
  const qPa = Math.max(MIN_DYNAMIC_PRESSURE_PA, Number(dynamicPressurePa) || 0);
  const progradeAir = normalize(relAirVelocityKmS, desired);
  const aoaRad = angleBetweenRadians(desired, progradeAir);
  const qAlphaPaRad = qPa * Math.abs(aoaRad);
  const qRatioForAoA = clamp(
    qPa / Math.max(LAUNCH_REALISM_CONFIG.aero.qHighForAoALimitPa, 1),
    0,
    1,
  );
  const qDrivenAoALimitRad = rad(linearInterpolate(
    LAUNCH_REALISM_CONFIG.aero.maxAoADegLowQ,
    LAUNCH_REALISM_CONFIG.aero.maxAoADegHighQ,
    qRatioForAoA,
  ));
  const qAlphaLimitRad = Math.max(rad(0.8), (Number(profile.qAlphaTargetPaRad) || 1_100) / qPa);
  const maxAllowedAoARad = Math.max(rad(0.8), Math.min(qDrivenAoALimitRad, qAlphaLimitRad));
  if (!(aoaRad > maxAllowedAoARad)) {
    return {
      direction: desired,
      limited: false,
      angleOfAttackDeg: degrees(aoaRad),
      maxAllowedAoADeg: degrees(maxAllowedAoARad),
      qAlphaPaRad,
    };
  }
  const excess = aoaRad - maxAllowedAoARad;
  const blend = clamp(excess / Math.max(aoaRad, EPSILON), 0, 1);
  const corrected = normalize(
    mixVectors(desired, progradeAir, 0.75 * blend),
    progradeAir,
  );
  return {
    direction: corrected,
    limited: true,
    angleOfAttackDeg: degrees(aoaRad),
    maxAllowedAoADeg: degrees(maxAllowedAoARad),
    qAlphaPaRad,
  };
}

export function limitThrottleByQAlpha({
  throttle,
  qAlphaPaRad,
  bodyKind = "stage1",
}) {
  const profile = stageAeroProfile(bodyKind);
  const target = Math.max(1, Number(profile.qAlphaTargetPaRad) || 1_200);
  const start = target * clamp(Number(LAUNCH_REALISM_CONFIG.aero.qAlphaStartRatio) || 0.72, 0.2, 1.1);
  if (!(qAlphaPaRad > start)) {
    return clamp(throttle, 0, 1);
  }
  const gain = Math.max(0.05, Number(profile.qAlphaThrottleGain) || 1);
  const floor = clamp(Number(profile.qAlphaThrottleFloor) || 0.42, 0.2, 1);
  const reduction = clamp(((qAlphaPaRad - start) / target) * gain, 0, 1);
  return clamp(Math.min(throttle, clamp(1 - reduction, floor, 1)), 0, 1);
}
