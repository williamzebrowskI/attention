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
  scale,
} from "./launchMath.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
    { includeTerrain: false },
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
  return {
    centerPosition: add(earthState.position, relPositionKm),
    centerVelocity: add(
      earthState.velocity || { x: 0, y: 0, z: 0 },
      localRotationalVelocityKmS,
    ),
    surfaceNormal: { ...surfaceState.surfaceNormal },
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
