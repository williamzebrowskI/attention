import {
  BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM,
  EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
  LAUNCH_PAD_DECK_HEIGHT_KM,
  LAUNCH_SITE,
} from "./launchConfig.js";
import {
  BOOSTER_CURRENT_GRID_FIN_THICKNESS_M,
  BOOSTER_CURRENT_GRID_FIN_Y_M,
} from "./launchRealismConfig.js";
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

const boosterGridFinThicknessKm = BOOSTER_CURRENT_GRID_FIN_THICKNESS_M / 1000;
const boosterGridFinYFromCenterKm = BOOSTER_CURRENT_GRID_FIN_Y_M / 1000;

export const BOOSTER_CATCH_BASE_CLEARANCE_KM = Math.max(
  0.026,
  LAUNCH_PAD_DECK_HEIGHT_KM + 0.006,
);
export const BOOSTER_CATCH_PIN_HEIGHT_ABOVE_BASE_KM =
  BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM
  + boosterGridFinYFromCenterKm
  - (boosterGridFinThicknessKm * 1.55);

export const BOOSTER_CHOPSTICK_CATCH_HEIGHT_ABOVE_BASE_KM =
  BOOSTER_CATCH_BASE_CLEARANCE_KM + BOOSTER_CATCH_PIN_HEIGHT_ABOVE_BASE_KM;

export const BOOSTER_CATCH_GEOMETRY_KM = Object.freeze({
  baseClearanceKm: BOOSTER_CATCH_BASE_CLEARANCE_KM,
  pinHeightAboveBaseKm: BOOSTER_CATCH_PIN_HEIGHT_ABOVE_BASE_KM,
  chopstickCatchHeightAboveBaseKm: BOOSTER_CHOPSTICK_CATCH_HEIGHT_ABOVE_BASE_KM,
  finalizeLateralToleranceKm: 0.05,
  finalizePinHeightToleranceKm: 0.0075,
  finalizeBodyUpAlignmentMin: 0.985,
  finalizeBodyRateRadSMax: 0.08,
  missBodyUpAlignmentMin: 0.94,
  missBodyRateRadSMax: 0.24,
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
