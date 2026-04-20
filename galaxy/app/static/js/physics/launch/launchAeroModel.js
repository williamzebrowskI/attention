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

function speedOfSoundMs(atmosphereSample) {
  const temp = Number(atmosphereSample?.temperatureK) || 0;
  const gasConstantJPerKgK = Number(atmosphereSample?.gasConstantJPerKgK) || 287.05287;
  const heatCapacityRatio = Number(atmosphereSample?.heatCapacityRatio) || 1.4;
  if (!(temp > 0) || !(gasConstantJPerKgK > 0) || !(heatCapacityRatio > 1)) {
    return 0;
  }
  return Math.sqrt(heatCapacityRatio * gasConstantJPerKgK * temp);
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

function gaussian(x, center, sigma) {
  const width = Math.max(1e-6, Number(sigma) || 1);
  const delta = ((Number(x) || 0) - (Number(center) || 0)) / width;
  return Math.exp(-(delta * delta));
}

function dayOfYearUtc(timestampMs) {
  const date = new Date(Number(timestampMs) || Date.now());
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return 1 + Math.floor((current - start) / 86_400_000);
}

function localSolarTimeHours(timestampMs, longitudeDeg) {
  const ts = Number(timestampMs);
  const lon = Number(longitudeDeg);
  if (!Number.isFinite(ts) || !Number.isFinite(lon)) {
    return 12;
  }
  const date = new Date(ts);
  const utcHours = date.getUTCHours() + (date.getUTCMinutes() / 60) + (date.getUTCSeconds() / 3600);
  let localHours = utcHours + (lon / 15);
  while (localHours < 0) {
    localHours += 24;
  }
  while (localHours >= 24) {
    localHours -= 24;
  }
  return localHours;
}

function earthLatLonFromRelativePosition(relPos, earthAxes = null, earthPole = null) {
  if (!finiteVectorLike(relPos)) {
    return { latitudeDeg: 0, longitudeDeg: 0 };
  }
  const radius = length(relPos);
  if (!(radius > EPSILON)) {
    return { latitudeDeg: 0, longitudeDeg: 0 };
  }
  const pole = normalize(earthAxes?.pole || earthPole || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  let xAxis = finiteVectorLike(earthAxes?.xAxis)
    ? normalize(earthAxes.xAxis, { x: 1, y: 0, z: 0 })
    : null;
  let yAxis = finiteVectorLike(earthAxes?.yAxis)
    ? normalize(earthAxes.yAxis, { x: 0, y: 1, z: 0 })
    : null;
  if (!xAxis || !yAxis) {
    xAxis = normalize(
      { x: 1 - (pole.x * pole.x), y: -(pole.x * pole.y), z: -(pole.x * pole.z) },
      { x: 1, y: 0, z: 0 },
    );
    yAxis = normalize(cross(pole, xAxis), { x: 0, y: 1, z: 0 });
  }
  const unit = scale(relPos, 1 / radius);
  const localX = dot(unit, xAxis);
  const localY = dot(unit, yAxis);
  const localZ = clamp(dot(unit, pole), -1, 1);
  return {
    latitudeDeg: degrees(Math.asin(localZ)),
    longitudeDeg: degrees(Math.atan2(localY, localX)),
  };
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

function gridFinProfile(kind) {
  if (kind === "booster") {
    return LAUNCH_REALISM_CONFIG.gridFins?.booster || null;
  }
  return null;
}

function finiteVectorLike(v) {
  return Boolean(
    v
    && Number.isFinite(Number(v.x))
    && Number.isFinite(Number(v.y))
    && Number.isFinite(Number(v.z)),
  );
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? fallbackNumeric : 0;
}

function bodyAxesFromForward(forwardWorld, referenceUpWorld = null) {
  const forward = normalize(forwardWorld || { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 });
  const upHint = normalize(referenceUpWorld || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const right = normalize(
    cross(upHint, forward),
    normalize(cross({ x: 0, y: 0, z: 1 }, forward), { x: 1, y: 0, z: 0 }),
  );
  const top = normalize(cross(forward, right), upHint);
  return { right, forward, top };
}

function worldVectorToBody(vectorWorld, bodyAxesWorld) {
  return {
    x: dot(vectorWorld || { x: 0, y: 0, z: 0 }, bodyAxesWorld?.right || { x: 1, y: 0, z: 0 }),
    y: dot(vectorWorld || { x: 0, y: 0, z: 0 }, bodyAxesWorld?.forward || { x: 0, y: 1, z: 0 }),
    z: dot(vectorWorld || { x: 0, y: 0, z: 0 }, bodyAxesWorld?.top || { x: 0, y: 0, z: 1 }),
  };
}

function bodyVectorToWorld(vectorBody, bodyAxesWorld) {
  const x = finiteNumber(vectorBody?.x, 0);
  const y = finiteNumber(vectorBody?.y, 0);
  const z = finiteNumber(vectorBody?.z, 0);
  return add(
    scale(bodyAxesWorld?.right || { x: 1, y: 0, z: 0 }, x),
    add(
      scale(bodyAxesWorld?.forward || { x: 0, y: 1, z: 0 }, y),
      scale(bodyAxesWorld?.top || { x: 0, y: 0, z: 1 }, z),
    ),
  );
}

function signedAngleAroundAxis(fromVector, toVector, axisVector) {
  const axis = unitOrNull(axisVector);
  const from = unitOrNull(fromVector);
  const to = unitOrNull(toVector);
  if (!axis || !from || !to) {
    return 0;
  }
  return Math.atan2(dot(axis, cross(from, to)), clamp(dot(from, to), -1, 1));
}

function controlErrorsBodyFromDirections(desiredDirection, bodyAxisDirection, bodyAxesWorld) {
  const desiredWorld = normalize(desiredDirection, { x: 0, y: 0, z: 1 });
  const desiredBody = normalize(
    worldVectorToBody(desiredWorld, bodyAxesWorld),
    { x: 0, y: 1, z: 0 },
  );
  let alignAxisBody = cross({ x: 0, y: 1, z: 0 }, desiredBody);
  const alignAngleRad = angleBetweenRadians({ x: 0, y: 1, z: 0 }, desiredBody);
  if (!(length(alignAxisBody) > 1e-9) && dot({ x: 0, y: 1, z: 0 }, desiredBody) < 0) {
    alignAxisBody = { x: 1, y: 0, z: 0 };
  }
  const alignAxisUnitBody = normalize(alignAxisBody, { x: 1, y: 0, z: 0 });
  const currentTopProjected = normalize(
    subtract(bodyAxesWorld.top, scale(bodyAxesWorld.forward, dot(bodyAxesWorld.top, bodyAxesWorld.forward))),
    bodyAxesWorld.top,
  );
  const referenceUpWorld = { x: 0, y: 0, z: 1 };
  const desiredTopWorldRaw = subtract(referenceUpWorld, scale(desiredWorld, dot(referenceUpWorld, desiredWorld)));
  const desiredTopWorld = normalize(desiredTopWorldRaw, bodyAxesWorld.top);
  const desiredTopProjected = normalize(
    subtract(desiredTopWorld, scale(bodyAxesWorld.forward, dot(desiredTopWorld, bodyAxesWorld.forward))),
    desiredTopWorld,
  );
  const rollAlignWeight = clamp((dot(normalize(bodyAxisDirection || desiredWorld, desiredWorld), desiredWorld) + 0.15) / 0.85, 0, 1);
  return {
    pitchErrorRad: alignAxisUnitBody.x * alignAngleRad,
    yawErrorRad: alignAxisUnitBody.z * alignAngleRad,
    rollErrorRad: signedAngleAroundAxis(currentTopProjected, desiredTopProjected, bodyAxesWorld.forward) * rollAlignWeight,
  };
}

export function sampleWindVectorKmS({
  altitudeKm,
  relPos,
  earthPole,
  earthAxes = null,
  timestampMs = Date.now(),
  elapsedSeconds,
  seed = 0,
  surfaceWindEastMS = null,
  surfaceWindNorthMS = null,
}) {
  const altitudeSafeKm = Math.max(0, Number(altitudeKm) || 0);
  const up = normalize(relPos || earthPole || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const { east, north } = localEastNorthAxes(up, earthPole);
  const { latitudeDeg, longitudeDeg } = earthLatLonFromRelativePosition(relPos, earthAxes, earthPole);
  const layers = LAUNCH_REALISM_CONFIG.wind.layers;
  const layerAltitudes = layers.map((layer) => Number(layer.altitudeKm) || 0);
  const eastSamples = layers.map((layer) => Number(layer.eastMS) || 0);
  const northSamples = layers.map((layer) => Number(layer.northMS) || 0);
  const baseEastMS = sampleTableLinear(altitudeSafeKm, layerAltitudes, eastSamples);
  const baseNorthMS = sampleTableLinear(altitudeSafeKm, layerAltitudes, northSamples);
  const latitudeAbsDeg = Math.abs(latitudeDeg);
  const latitudeRad = rad(latitudeDeg);
  const dayOfYear = dayOfYearUtc(timestampMs);
  const localSolarHours = localSolarTimeHours(timestampMs, longitudeDeg);
  const winterPhase = Math.cos(((dayOfYear - 15) / 365.25) * Math.PI * 2);
  const localWinterFactor = latitudeDeg >= 0 ? winterPhase : -winterPhase;
  const subtropicalBand = gaussian(latitudeAbsDeg, 28, 14);
  const midlatitudeBand = gaussian(latitudeAbsDeg, 42, 18);
  const polarBand = gaussian(latitudeAbsDeg, 63, 13);
  const boundaryLayerFactor = Math.exp(-altitudeSafeKm / 2.3);
  const jetCoreFactor = gaussian(altitudeSafeKm, 11.5, 4.4);
  const lowerStratosphereFactor = gaussian(altitudeSafeKm, 23, 8.5);
  const mesosphereFactor = gaussian(altitudeSafeKm, 50, 13);
  const winterJetBoost = Math.max(0, localWinterFactor);
  const zonalBaseScale = clamp(
    0.62
      + (0.16 * subtropicalBand)
      + (0.18 * midlatitudeBand)
      + (0.12 * polarBand)
      + (0.10 * winterJetBoost * jetCoreFactor),
    0.35,
    1.25,
  );
  const tradeWindMS = -7.5 * gaussian(latitudeAbsDeg, 15, 16) * Math.exp(-altitudeSafeKm / 3.6);
  const surfaceWesterlyMS = 6.5 * midlatitudeBand * boundaryLayerFactor * (0.85 + (0.25 * winterJetBoost));
  const jetAugmentationMS = (5 * subtropicalBand + 7 * midlatitudeBand + 6 * polarBand)
    * (0.65 + (0.45 * winterJetBoost))
    * jetCoreFactor;
  const stratosphericReversalMS =
    -6.5
    * subtropicalBand
    * Math.sin(((dayOfYear - 95) / 365.25) * Math.PI * 2)
    * lowerStratosphereFactor;
  const mesosphericReversalMS = -4.5 * midlatitudeBand * mesosphereFactor;
  const steadyEastMS =
    (baseEastMS * zonalBaseScale)
    + tradeWindMS
    + surfaceWesterlyMS
    + jetAugmentationMS
    + stratosphericReversalMS
    + mesosphericReversalMS;
  const seaBreezePhase = Math.sin(((localSolarHours - 14) / 24) * Math.PI * 2);
  const diurnalMeridionalMS =
    3.2
    * gaussian(latitudeAbsDeg, 25, 18)
    * seaBreezePhase
    * Math.exp(-altitudeSafeKm / 2.8);
  const jetCrossflowMS =
    4.4
    * Math.sin(2 * latitudeRad)
    * Math.sin(((localSolarHours - 16) / 24) * Math.PI * 2)
    * jetCoreFactor;
  const seasonalMeridionalMS =
    2.6
    * (0.35 + (0.65 * midlatitudeBand))
    * Math.sin(((dayOfYear - 172) / 365.25) * Math.PI * 2)
    * lowerStratosphereFactor;
  const steadyNorthMS =
    (baseNorthMS * clamp(0.45 + (0.30 * midlatitudeBand) + (0.12 * polarBand), 0.2, 0.95))
    + diurnalMeridionalMS
    + jetCrossflowMS
    + seasonalMeridionalMS;

  const t = Math.max(0, Number(elapsedSeconds) || 0);
  const posPhase = (Number(relPos?.x) || 0) * 0.0003
    + (Number(relPos?.y) || 0) * 0.0002
    + (Number(relPos?.z) || 0) * 0.00025;
  const seedPhase = ((Number(seed) || 0) * 0.000001) + posPhase;
  const shearEastMSPerKm = Math.abs(
    sampleTableLinear(Math.max(0, altitudeSafeKm - 1), layerAltitudes, eastSamples)
    - sampleTableLinear(altitudeSafeKm + 1, layerAltitudes, eastSamples),
  ) / 2;
  const nearSurfaceFactor = clamp(boundaryLayerFactor, 0, 1);
  const jetFactor = clamp(jetCoreFactor, 0, 1);
  const turbulenceEnvelope = clamp(
    (0.60 * nearSurfaceFactor)
      + (0.28 * jetFactor)
      + (0.02 * Math.min(10, shearEastMSPerKm)),
    0,
    1,
  );
  const gustScaleMS = linearInterpolate(
    LAUNCH_REALISM_CONFIG.wind.gustMinMS,
    LAUNCH_REALISM_CONFIG.wind.gustMaxMS,
    turbulenceEnvelope,
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

  const hasSurfaceWindAnchor = (
    surfaceWindEastMS !== null
    && surfaceWindEastMS !== undefined
    && surfaceWindNorthMS !== null
    && surfaceWindNorthMS !== undefined
    && Number.isFinite(Number(surfaceWindEastMS))
    && Number.isFinite(Number(surfaceWindNorthMS))
  );
  const surfaceBlend = hasSurfaceWindAnchor ? Math.exp(-altitudeSafeKm / 2.2) : 0;
  const anchoredSteadyEastMS = surfaceBlend > 0
    ? linearInterpolate(steadyEastMS, Number(surfaceWindEastMS), surfaceBlend)
    : steadyEastMS;
  const anchoredSteadyNorthMS = surfaceBlend > 0
    ? linearInterpolate(steadyNorthMS, Number(surfaceWindNorthMS), surfaceBlend)
    : steadyNorthMS;
  const gustDamping = linearInterpolate(1, 0.35, surfaceBlend);
  const eastMS = anchoredSteadyEastMS + (gustEastMS * gustDamping);
  const northMS = anchoredSteadyNorthMS + (gustNorthMS * gustDamping);
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
    latitudeDeg,
    longitudeDeg,
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
  const densityKgM3 = Number(atmosphereSample?.dragEffectiveDensityKgM3) || Number(atmosphereSample?.densityKgM3) || 0;
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
  massModel = null,
  throttle = 0,
}) {
  const densityKgM3 = Number(atmosphereSample?.dragEffectiveDensityKgM3) || Number(atmosphereSample?.densityKgM3) || 0;
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

  const soundSpeedMs = Number(atmosphereSample?.speedOfSoundMs) > 0
    ? Number(atmosphereSample.speedOfSoundMs)
    : speedOfSoundMs(atmosphereSample);
  const machNumber = soundSpeedMs > 1e-9
    ? (relAirSpeedKmS * 1000) / soundSpeedMs
    : 0;
  const profile = stageAeroProfile(bodyKind);
  const cd0 = sampleTableLinear(machNumber, profile.mach, profile.cd0);
  const clAlphaPerRad = sampleTableLinear(machNumber, profile.mach, profile.clAlphaPerRad);
  const cpNormalized = sampleTableLinear(machNumber, profile.mach, profile.cpNormalized || []);
  const cgNormalized = clamp(Number(massModel?.comNormalized) || 0.5, 0, 1);
  const staticMarginNormalized = cgNormalized - cpNormalized;
  const stabilityGain = Math.max(0, Number(profile.stabilityGain) || 1.4);
  const cmAlphaPerRad = -clAlphaPerRad * staticMarginNormalized * stabilityGain;
  const transonicWaveDragCd =
    Math.max(0, Number(profile.transonicWaveDragCd) || 0)
    * gaussian(
      machNumber,
      Number(profile.transonicWaveDragMach) || 1.03,
      Math.max(0.05, Number(profile.transonicWaveDragWidth) || 0.16),
    );
  const inducedDragFactor = Math.max(0, Number(profile.inducedDragFactor) || 0);
  const cl = clamp(clAlphaPerRad * aoaRad, -2.8, 2.8);
  const poweredDragReliefCd = clamp(Number(throttle) || 0, 0, 1)
    * Math.max(0, Number(profile.powerOnBaseDragFactor) || 0);
  const cd = clamp(
    cd0
      + transonicWaveDragCd
      + (Number(profile.cdAlpha2) * aoaRad * aoaRad)
      + (inducedDragFactor * cl * cl)
      - poweredDragReliefCd,
    0.12,
    1.8,
  );
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
    centerOfPressureNormalized: cpNormalized,
    staticMarginNormalized,
    relAirVelocityKmS,
    relAirSpeedKmS,
  };
}

export function computeGridFinControlState({
  bodyKind = "booster",
  atmosphereSample,
  relPos,
  relVel,
  earthPole,
  windVectorKmS,
  desiredDirection,
  bodyAxisDirection,
  bodyAxesWorld = null,
  controlErrorsBody = null,
  omegaBodyRadS = null,
  massKg,
  massModel = null,
}) {
  const profile = gridFinProfile(bodyKind);
  if (!profile || !relPos || !relVel) {
    return {
      active: false,
      authority: 0,
      relAirSpeedKmS: 0,
      dynamicPressurePa: 0,
      deflectionDeg: 0,
      maxDeflectionDeg: 0,
      momentNm: 0,
      bodyTorqueNm: { x: 0, y: 0, z: 0 },
      finStates: [],
      angularAccelerationRadS2: 0,
      dampingPerS: 0,
    };
  }

  const relAirVelocityKmS = atmosphereRelativeVelocityKmS(
    relPos,
    relVel,
    earthPole,
    windVectorKmS,
  );
  const relAirSpeedKmS = length(relAirVelocityKmS);
  const qPa = dynamicPressurePaFromAtmosphere(
    atmosphereSample,
    relPos,
    relVel,
    earthPole,
    windVectorKmS,
  );
  const maxDeflectionDeg = Math.max(0, Number(profile.maxDeflectionDeg) || 0);
  if (!(relAirSpeedKmS > 1e-6) || !(qPa > Math.max(1, Number(profile.qMinPa) || 1_000))) {
    return {
      active: false,
      authority: 0,
      relAirSpeedKmS,
      dynamicPressurePa: qPa,
      deflectionDeg: 0,
      maxDeflectionDeg,
      momentNm: 0,
      bodyTorqueNm: { x: 0, y: 0, z: 0 },
      finStates: [],
      angularAccelerationRadS2: 0,
      dampingPerS: 0,
    };
  }

  const desired = normalize(desiredDirection, { x: 0, y: 0, z: 1 });
  const bodyAxis = normalize(bodyAxisDirection || desired, desired);
  const bodyAxes = bodyAxesWorld || bodyAxesFromForward(bodyAxis, earthPole);
  const controls = controlErrorsBody || controlErrorsBodyFromDirections(desired, bodyAxis, bodyAxes);
  const errorRad = Math.hypot(
    finiteNumber(controls?.pitchErrorRad, 0),
    finiteNumber(controls?.yawErrorRad, 0),
    finiteNumber(controls?.rollErrorRad, 0),
  );
  if (!(errorRad > 1e-6)) {
    return {
      active: false,
      authority: 0,
      relAirSpeedKmS,
      dynamicPressurePa: qPa,
      deflectionDeg: 0,
      maxDeflectionDeg,
      momentNm: 0,
      bodyTorqueNm: { x: 0, y: 0, z: 0 },
      finStates: [],
      angularAccelerationRadS2: 0,
      dampingPerS: 0,
    };
  }

  const qMinPa = Math.max(1, Number(profile.qMinPa) || 1_000);
  const qPeakPa = Math.max(qMinPa, Number(profile.qPeakPa) || 18_000);
  const qFadePa = Math.max(qPeakPa, Number(profile.qFadePa) || 70_000);
  const qBuild = clamp((qPa - qMinPa) / Math.max(qPeakPa - qMinPa, EPSILON), 0, 1);
  const qFade = 1 - (0.45 * clamp((qPa - qPeakPa) / Math.max(qFadePa - qPeakPa, EPSILON), 0, 1));
  const flowEffectiveness = clamp(qBuild * qFade, 0, 1);
  if (!(flowEffectiveness > 1e-4)) {
    return {
      active: false,
      authority: 0,
      relAirSpeedKmS,
      dynamicPressurePa: qPa,
      deflectionDeg: 0,
      maxDeflectionDeg,
      momentNm: 0,
      bodyTorqueNm: { x: 0, y: 0, z: 0 },
      finStates: [],
      angularAccelerationRadS2: 0,
      dampingPerS: 0,
    };
  }

  const maxDeflectionRad = rad(maxDeflectionDeg);
  const fins = Array.isArray(profile.fins) && profile.fins.length > 0
    ? profile.fins
    : [{
      name: "aggregate",
      areaM2: Math.max(0, Number(profile.totalAreaM2) || 0),
      positionBodyM: { x: 0, y: Math.max(0.1, Number(profile.leverArmM) || 0.1), z: 0 },
      forceAxisBody: { x: 0, y: 0, z: 1 },
      controlMix: { pitch: 1, yaw: 0, roll: 0 },
    }];
  const relAirBodyKmS = worldVectorToBody(relAirVelocityKmS, bodyAxes);
  const omegaBody = {
    x: finiteNumber(omegaBodyRadS?.x, 0),
    y: finiteNumber(omegaBodyRadS?.y, 0),
    z: finiteNumber(omegaBodyRadS?.z, 0),
  };
  const pitchCommand = finiteNumber(controls?.pitchErrorRad, 0);
  const yawCommand = finiteNumber(controls?.yawErrorRad, 0);
  const rollCommand = finiteNumber(controls?.rollErrorRad, 0);
  const totalBodyTorqueNm = fins.reduce((sum, fin) => {
    const positionBodyM = {
      x: finiteNumber(fin?.positionBodyM?.x, 0),
      y: finiteNumber(fin?.positionBodyM?.y, 0),
      z: finiteNumber(fin?.positionBodyM?.z, 0),
    };
    const localRotationalVelocityMS = cross(omegaBody, positionBodyM);
    const localRelAirMS = {
      x: (relAirBodyKmS.x * 1000) + localRotationalVelocityMS.x,
      y: (relAirBodyKmS.y * 1000) + localRotationalVelocityMS.y,
      z: (relAirBodyKmS.z * 1000) + localRotationalVelocityMS.z,
    };
    const localSpeedMS = length(localRelAirMS);
    const localQPa = 0.5 * Math.max(MIN_AIR_DENSITY_KG_M3, Number(atmosphereSample?.dragEffectiveDensityKgM3) || Number(atmosphereSample?.densityKgM3) || 0) * localSpeedMS * localSpeedMS;
    const localQBuild = clamp((localQPa - qMinPa) / Math.max(qPeakPa - qMinPa, EPSILON), 0, 1);
    const localQFade = 1 - (0.45 * clamp((localQPa - qPeakPa) / Math.max(qFadePa - qPeakPa, EPSILON), 0, 1));
    const localEffectiveness = clamp(localQBuild * localQFade, 0, 1);
    const controlMix = fin?.controlMix || {};
    const normalizedCommand = clamp(
      (pitchCommand * finiteNumber(controlMix.pitch, 0))
      + (yawCommand * finiteNumber(controlMix.yaw, 0))
      + (rollCommand * finiteNumber(controlMix.roll, 0)),
      -1,
      1,
    );
    const commandedDeflectionRad = normalizedCommand * maxDeflectionRad;
    const effectiveDeflectionRad = commandedDeflectionRad * localEffectiveness;
    const finLiftCoefficient = Math.max(0, Number(profile.liftSlopePerRad) || 0) * effectiveDeflectionRad;
    const forceAxisBody = normalize(fin?.forceAxisBody || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
    const controlForceN = localQPa * Math.max(0, finiteNumber(fin?.areaM2, 0)) * finLiftCoefficient;
    const forceBodyN = scale(forceAxisBody, controlForceN);
    const torqueBodyNm = cross(positionBodyM, forceBodyN);
    sum.torque = add(sum.torque, torqueBodyNm);
    sum.deflections.push(Math.abs(degrees(commandedDeflectionRad)));
    sum.finStates.push({
      name: String(fin?.name || "fin"),
      deflectionDeg: degrees(commandedDeflectionRad),
      dynamicPressurePa: localQPa,
      forceBodyN,
      torqueBodyNm,
      effectiveness: localEffectiveness,
    });
    return sum;
  }, { torque: { x: 0, y: 0, z: 0 }, deflections: [], finStates: [] });
  const momentNm = length(totalBodyTorqueNm.torque);
  const bodyLengthM = Math.max(1, Number(profile.bodyLengthM) || 1);
  const safeMassKg = Math.max(1, Number(massKg) || 0);
  const inertiaNormalized = Math.max(0.25, Number(massModel?.inertiaNormalized) || 1);
  const effectiveInertiaKgM2 = (safeMassKg * bodyLengthM * bodyLengthM / 12) * inertiaNormalized;
  const angularAccelerationRadS2 = momentNm / Math.max(effectiveInertiaKgM2, 1e-6);
  const dampingPerS = Math.max(0, Number(profile.baseDampingPerS) || 0.85) * flowEffectiveness;
  const referenceMomentNm = fins.reduce((sum, fin) => {
    const positionBodyM = {
      x: finiteNumber(fin?.positionBodyM?.x, 0),
      y: finiteNumber(fin?.positionBodyM?.y, 0),
      z: finiteNumber(fin?.positionBodyM?.z, 0),
    };
    const forceAxisBody = normalize(fin?.forceAxisBody || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
    const refForceN =
      qPeakPa
      * Math.max(0, finiteNumber(fin?.areaM2, 0))
      * (Math.max(0, Number(profile.liftSlopePerRad) || 0) * maxDeflectionRad);
    return sum + length(cross(positionBodyM, scale(forceAxisBody, refForceN)));
  }, 0);
  const authority = clamp(momentNm / Math.max(referenceMomentNm, 1e-6), 0, 1);

  return {
    active: authority > 1e-4,
    authority,
    relAirSpeedKmS,
    dynamicPressurePa: qPa,
    deflectionDeg: totalBodyTorqueNm.deflections.length > 0
      ? Math.max(...totalBodyTorqueNm.deflections)
      : 0,
    maxDeflectionDeg,
    momentNm,
    bodyTorqueNm: totalBodyTorqueNm.torque,
    finStates: totalBodyTorqueNm.finStates,
    angularAccelerationRadS2,
    dampingPerS,
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
