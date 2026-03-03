import {
  add,
  clamp,
  dot,
  finiteVector,
  length,
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
