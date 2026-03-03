import {
  add,
  clamp,
  dot,
  finiteVector,
  length,
  normalize,
  scale,
} from "../navigationMath.js";
import { NAVIGATION_DEFAULTS } from "../navigationSystemConfig.js";

export function projectedClosestApproachDistanceKm({
  relativePositionKm = null,
  relativeVelocityKmS = null,
  horizonSec = NAVIGATION_DEFAULTS.planner.moonMidcoursePredictHorizonSec,
} = {}) {
  if (!finiteVector(relativePositionKm)) {
    return Number.POSITIVE_INFINITY;
  }
  const initialDistanceKm = length(relativePositionKm);
  if (!finiteVector(relativeVelocityKmS)) {
    return initialDistanceKm;
  }
  const relativeSpeedSq = dot(relativeVelocityKmS, relativeVelocityKmS);
  if (!(relativeSpeedSq > 1e-12)) {
    return initialDistanceKm;
  }
  const safeHorizonSec = Math.max(1, Number(horizonSec) || 1);
  const timeToClosestSec = clamp(
    -dot(relativePositionKm, relativeVelocityKmS) / relativeSpeedSq,
    0,
    safeHorizonSec,
  );
  return length(add(
    relativePositionKm,
    scale(relativeVelocityKmS, timeToClosestSec),
  ));
}

export function projectedClosestApproachStateKm({
  relativePositionKm = null,
  relativeVelocityKmS = null,
  horizonSec = NAVIGATION_DEFAULTS.planner.moonMidcoursePredictHorizonSec,
} = {}) {
  if (!finiteVector(relativePositionKm)) {
    return {
      distanceKm: Number.POSITIVE_INFINITY,
      timeToClosestSec: 0,
      closestPositionKm: null,
      relativeSpeedKmS: 0,
      alongTrackDirection: null,
    };
  }
  const initialDistanceKm = length(relativePositionKm);
  if (!finiteVector(relativeVelocityKmS)) {
    return {
      distanceKm: initialDistanceKm,
      timeToClosestSec: 0,
      closestPositionKm: { ...relativePositionKm },
      relativeSpeedKmS: 0,
      alongTrackDirection: null,
    };
  }
  const relativeSpeedSq = dot(relativeVelocityKmS, relativeVelocityKmS);
  if (!(relativeSpeedSq > 1e-12)) {
    return {
      distanceKm: initialDistanceKm,
      timeToClosestSec: 0,
      closestPositionKm: { ...relativePositionKm },
      relativeSpeedKmS: 0,
      alongTrackDirection: null,
    };
  }
  const safeHorizonSec = Math.max(1, Number(horizonSec) || 1);
  const timeToClosestSec = clamp(
    -dot(relativePositionKm, relativeVelocityKmS) / relativeSpeedSq,
    0,
    safeHorizonSec,
  );
  const closestPositionKm = add(
    relativePositionKm,
    scale(relativeVelocityKmS, timeToClosestSec),
  );
  const relativeSpeedKmS = Math.sqrt(relativeSpeedSq);
  return {
    distanceKm: length(closestPositionKm),
    timeToClosestSec,
    closestPositionKm,
    relativeSpeedKmS,
    alongTrackDirection: normalize(relativeVelocityKmS, { x: 0, y: 1, z: 0 }),
  };
}
