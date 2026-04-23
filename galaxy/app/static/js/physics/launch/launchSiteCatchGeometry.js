import {
  BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM,
  EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
  LAUNCH_SITE,
  STARSHIP_STACK_DIMENSIONS_KM,
} from "./launchConfig.js";
import { surfacePointRelativeKmAtLatLon } from "../surface/earthSurfacePhysics.js";
import {
  add,
  cross,
  dot,
  length,
  normalize,
  scale,
  subtract,
} from "./launchMath.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + ((b - a) * t);
}

function blendVector(a, b, t) {
  const blend = clamp(Number(t) || 0, 0, 1);
  return {
    x: lerp(a?.x || 0, b?.x || 0, blend),
    y: lerp(a?.y || 0, b?.y || 0, blend),
    z: lerp(a?.z || 0, b?.z || 0, blend),
  };
}

const boosterRadiusKm = STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 0.5;
const boosterGridFinHeightKm = clamp(
  boosterRadiusKm * 0.96,
  boosterRadiusKm * 0.46,
  boosterRadiusKm * 1.22,
);
const boosterGridFinYFromCenterKm =
  (0.5 * STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm)
  - (boosterRadiusKm * 1.04);

export const BOOSTER_CATCH_BASE_CLEARANCE_KM = 0.008;
export const BOOSTER_CATCH_PIN_HEIGHT_ABOVE_BASE_KM =
  BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM
  + boosterGridFinYFromCenterKm
  + (boosterGridFinHeightKm * 0.35);

export const BOOSTER_CHOPSTICK_CATCH_HEIGHT_ABOVE_BASE_KM =
  BOOSTER_CATCH_BASE_CLEARANCE_KM + BOOSTER_CATCH_PIN_HEIGHT_ABOVE_BASE_KM;

export const BOOSTER_CATCH_GEOMETRY_KM = Object.freeze({
  baseClearanceKm: BOOSTER_CATCH_BASE_CLEARANCE_KM,
  pinHeightAboveBaseKm: BOOSTER_CATCH_PIN_HEIGHT_ABOVE_BASE_KM,
  chopstickCatchHeightAboveBaseKm: BOOSTER_CHOPSTICK_CATCH_HEIGHT_ABOVE_BASE_KM,
  finalizeLateralToleranceKm: 0.03,
  finalizePinHeightToleranceKm: 0.006,
});

export function computeLaunchSiteCatchFrame({
  earthState,
  earthRadiusKm,
  earthAxes,
} = {}) {
  if (!earthState?.position || !earthAxes) {
    return null;
  }
  const surfaceState = surfacePointRelativeKmAtLatLon(
    LAUNCH_SITE.latitudeDeg,
    LAUNCH_SITE.longitudeDeg,
    earthAxes,
    { includeTerrain: true },
  );
  if (!surfaceState?.pointRelativeKm || !surfaceState?.surfaceNormal) {
    return null;
  }
  const lodSec = Number(earthAxes?.earthOrientation?.lodSec);
  const angularRateRadS = EARTH_SIDEREAL_ANGULAR_RATE_RAD_S
    * (1 - ((Number.isFinite(lodSec) ? lodSec : 0) / 86400));
  const catchReferenceOffsetKm =
    BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM + BOOSTER_CATCH_BASE_CLEARANCE_KM;
  const relPositionKm = add(
    surfaceState.pointRelativeKm,
    scale(
      surfaceState.surfaceNormal,
      LAUNCH_SITE.altitudeKm + catchReferenceOffsetKm,
    ),
  );
  const angularVelocity = scale(earthAxes.pole, angularRateRadS);
  const localRotationalVelocityKmS = cross(angularVelocity, relPositionKm);
  const eastAxis = normalize(
    cross(earthAxes.pole, surfaceState.surfaceNormal),
    normalize(cross({ x: 0, y: 0, z: 1 }, surfaceState.surfaceNormal), { x: 1, y: 0, z: 0 }),
  );
  const northAxis = normalize(cross(surfaceState.surfaceNormal, eastAxis), earthAxes.pole);
  return {
    centerPosition: add(earthState.position, relPositionKm),
    centerVelocity: add(
      earthState.velocity || { x: 0, y: 0, z: 0 },
      localRotationalVelocityKmS,
    ),
    surfaceNormal: { ...surfaceState.surfaceNormal },
    eastAxis,
    northAxis,
    baseClearanceKm: BOOSTER_CATCH_BASE_CLEARANCE_KM,
    pinHeightAboveBaseKm: BOOSTER_CATCH_PIN_HEIGHT_ABOVE_BASE_KM,
    chopstickCatchHeightAboveBaseKm: BOOSTER_CHOPSTICK_CATCH_HEIGHT_ABOVE_BASE_KM,
    earthRadiusKm: Number(earthRadiusKm) || 0,
  };
}

export function computeBoosterCatchPinHeightErrorKm(bodyAboveTerrainKm) {
  const baseHeightKm = Number(bodyAboveTerrainKm);
  if (!Number.isFinite(baseHeightKm)) {
    return Number.NaN;
  }
  return (
    baseHeightKm
    + BOOSTER_CATCH_PIN_HEIGHT_ABOVE_BASE_KM
    - BOOSTER_CHOPSTICK_CATCH_HEIGHT_ABOVE_BASE_KM
  );
}

export function computeBoosterCatchRelativeState({
  boosterState,
  catchFrame,
} = {}) {
  if (!boosterState?.position || !boosterState?.velocity || !catchFrame?.centerPosition || !catchFrame?.centerVelocity) {
    return null;
  }
  const up = normalize(catchFrame.surfaceNormal || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const east = normalize(catchFrame.eastAxis || { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const north = normalize(catchFrame.northAxis || cross(up, east), { x: 0, y: 1, z: 0 });
  const relativePositionKm = subtract(boosterState.position, catchFrame.centerPosition);
  const relativeVelocityKmS = subtract(boosterState.velocity, catchFrame.centerVelocity);
  const verticalErrorKm = dot(relativePositionKm, up);
  const verticalSpeedKmS = dot(relativeVelocityKmS, up);
  const lateralPositionKm = subtract(relativePositionKm, scale(up, verticalErrorKm));
  const lateralVelocityKmS = subtract(relativeVelocityKmS, scale(up, verticalSpeedKmS));
  const eastErrorKm = dot(relativePositionKm, east);
  const northErrorKm = dot(relativePositionKm, north);
  const eastSpeedKmS = dot(relativeVelocityKmS, east);
  const northSpeedKmS = dot(relativeVelocityKmS, north);
  const lateralRangeKm = length(lateralPositionKm);
  const totalRangeKm = length(relativePositionKm);
  const lateralSpeedKmS = length(lateralVelocityKmS);
  const totalSpeedKmS = length(relativeVelocityKmS);
  const lineOfSight = normalize(relativePositionKm, scale(up, -1));
  const closingSpeedKmS = -dot(relativeVelocityKmS, lineOfSight);
  return {
    relativePositionKm,
    relativeVelocityKmS,
    verticalErrorKm,
    verticalSpeedKmS,
    lateralPositionKm,
    lateralVelocityKmS,
    lateralRangeKm,
    lateralSpeedKmS,
    totalRangeKm,
    totalSpeedKmS,
    eastErrorKm,
    northErrorKm,
    eastSpeedKmS,
    northSpeedKmS,
    closingSpeedKmS,
    upAxisKm: up,
    eastAxisKm: east,
    northAxisKm: north,
  };
}

export function computeBoosterCatchConstraintStep({
  boosterState,
  catchFrame,
  dtSeconds = 1 / 60,
  contactProgress = 0,
  captureProgress = 0,
  targetOffsetUpKm = 0,
  maxCorrectionAccelKmS2 = 0.065,
} = {}) {
  if (!boosterState?.position || !boosterState?.velocity || !catchFrame?.centerPosition || !catchFrame?.centerVelocity) {
    return null;
  }
  const safeDt = clamp(Number(dtSeconds) || 0, 1 / 240, 0.25);
  const phaseBlend = clamp(
    Math.max(Number(contactProgress) || 0, Number(captureProgress) || 0),
    0,
    1,
  );
  const up = normalize(catchFrame.surfaceNormal || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const east = normalize(catchFrame.eastAxis || { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const north = normalize(catchFrame.northAxis || cross(up, east), { x: 0, y: 1, z: 0 });
  const targetPosition = add(
    catchFrame.centerPosition,
    scale(up, Number(targetOffsetUpKm) || 0),
  );
  const targetVelocity = { ...(catchFrame.centerVelocity || { x: 0, y: 0, z: 0 }) };
  const relativePositionKm = subtract(boosterState.position, targetPosition);
  const relativeVelocityKmS = subtract(boosterState.velocity, targetVelocity);
  const eastErrorKm = dot(relativePositionKm, east);
  const northErrorKm = dot(relativePositionKm, north);
  const verticalErrorKm = dot(relativePositionKm, up);
  const eastSpeedKmS = dot(relativeVelocityKmS, east);
  const northSpeedKmS = dot(relativeVelocityKmS, north);
  const verticalSpeedKmS = dot(relativeVelocityKmS, up);
  const lateralKp = 3.2 + (4.8 * phaseBlend);
  const lateralKd = 4.4 + (2.8 * phaseBlend);
  const verticalKp = 2.4 + (3.6 * phaseBlend);
  const verticalKd = 3.6 + (2.6 * phaseBlend);
  let eastAccelKmS2 = -((lateralKp * eastErrorKm) + (lateralKd * eastSpeedKmS));
  let northAccelKmS2 = -((lateralKp * northErrorKm) + (lateralKd * northSpeedKmS));
  let verticalAccelKmS2 = -((verticalKp * verticalErrorKm) + (verticalKd * verticalSpeedKmS));
  const axisAccelLimitKmS2 = Math.max(0.01, Number(maxCorrectionAccelKmS2) || 0.065);
  eastAccelKmS2 = clamp(eastAccelKmS2, -axisAccelLimitKmS2, axisAccelLimitKmS2);
  northAccelKmS2 = clamp(northAccelKmS2, -axisAccelLimitKmS2, axisAccelLimitKmS2);
  verticalAccelKmS2 = clamp(verticalAccelKmS2, -axisAccelLimitKmS2, axisAccelLimitKmS2);
  let correctionAccelerationKmS2 = add(
    add(scale(east, eastAccelKmS2), scale(north, northAccelKmS2)),
    scale(up, verticalAccelKmS2),
  );
  const accelMagnitudeKmS2 = length(correctionAccelerationKmS2);
  if (accelMagnitudeKmS2 > axisAccelLimitKmS2) {
    const accelScale = axisAccelLimitKmS2 / accelMagnitudeKmS2;
    eastAccelKmS2 *= accelScale;
    northAccelKmS2 *= accelScale;
    verticalAccelKmS2 *= accelScale;
    correctionAccelerationKmS2 = scale(correctionAccelerationKmS2, accelScale);
  }
  const nextEastSpeedKmS = eastSpeedKmS + (eastAccelKmS2 * safeDt);
  const nextNorthSpeedKmS = northSpeedKmS + (northAccelKmS2 * safeDt);
  const nextVerticalSpeedKmS = verticalSpeedKmS + (verticalAccelKmS2 * safeDt);
  const nextEastErrorKm = eastErrorKm + (nextEastSpeedKmS * safeDt);
  const nextNorthErrorKm = northErrorKm + (nextNorthSpeedKmS * safeDt);
  const nextVerticalErrorKm = verticalErrorKm + (nextVerticalSpeedKmS * safeDt);
  const nextRelativePositionKm = add(
    add(scale(east, nextEastErrorKm), scale(north, nextNorthErrorKm)),
    scale(up, nextVerticalErrorKm),
  );
  const nextRelativeVelocityKmS = add(
    add(scale(east, nextEastSpeedKmS), scale(north, nextNorthSpeedKmS)),
    scale(up, nextVerticalSpeedKmS),
  );
  let nextPosition = add(targetPosition, nextRelativePositionKm);
  let nextVelocity = add(targetVelocity, nextRelativeVelocityKmS);
  let resolvedRelativePositionKm = nextRelativePositionKm;
  let resolvedRelativeVelocityKmS = nextRelativeVelocityKmS;
  const hardCaptureBlend = clamp((phaseBlend - 0.35) / 0.65, 0, 1);
  if (hardCaptureBlend > 0) {
    const positionBlend = clamp(0.12 + (0.76 * hardCaptureBlend), 0.12, 0.88);
    const velocityBlend = clamp(0.18 + (0.80 * hardCaptureBlend), 0.18, 0.96);
    nextPosition = blendVector(nextPosition, targetPosition, positionBlend);
    nextVelocity = blendVector(nextVelocity, targetVelocity, velocityBlend);
    resolvedRelativePositionKm = subtract(nextPosition, targetPosition);
    resolvedRelativeVelocityKmS = subtract(nextVelocity, targetVelocity);
  }
  const lateralErrorKm = Math.hypot(
    dot(resolvedRelativePositionKm, east),
    dot(resolvedRelativePositionKm, north),
  );
  const totalErrorKm = length(resolvedRelativePositionKm);
  const totalSpeedKmS = length(resolvedRelativeVelocityKmS);
  return {
    position: nextPosition,
    velocity: nextVelocity,
    targetPosition,
    targetVelocity,
    correctionAccelerationKmS2,
    lateralErrorKm,
    verticalErrorKm: nextVerticalErrorKm,
    totalErrorKm,
    totalSpeedKmS,
    relativePositionKm: resolvedRelativePositionKm,
    relativeVelocityKmS: resolvedRelativeVelocityKmS,
    eastErrorKm: dot(resolvedRelativePositionKm, east),
    northErrorKm: dot(resolvedRelativePositionKm, north),
    eastSpeedKmS: dot(resolvedRelativeVelocityKmS, east),
    northSpeedKmS: dot(resolvedRelativeVelocityKmS, north),
    verticalSpeedKmS: dot(resolvedRelativeVelocityKmS, up),
    closureNorm: clamp(0.25 + (0.75 * phaseBlend), 0.25, 1),
  };
}
