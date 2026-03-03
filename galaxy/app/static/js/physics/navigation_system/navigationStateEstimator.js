import {
  add,
  clamp,
  finiteVector,
  mixVectors,
  scale,
} from "./navigationMath.js";
import { NAVIGATION_DEFAULTS } from "./navigationSystemConfig.js";

export function createNavigationStateEstimator({
  positionBlend = NAVIGATION_DEFAULTS.estimator.positionBlend,
  velocityBlend = NAVIGATION_DEFAULTS.estimator.velocityBlend,
} = {}) {
  let estimate = null;
  let timestampSec = null;
  const positionAlpha = clamp(Number(positionBlend) || 0.35, 0.05, 1);
  const velocityAlpha = clamp(Number(velocityBlend) || 0.45, 0.05, 1);

  function reset() {
    estimate = null;
    timestampSec = null;
  }

  function predict(nextTimestampSec) {
    if (!estimate || !Number.isFinite(Number(nextTimestampSec)) || !Number.isFinite(Number(timestampSec))) {
      timestampSec = Number.isFinite(Number(nextTimestampSec)) ? Number(nextTimestampSec) : timestampSec;
      return estimate;
    }
    const dt = Math.max(0, Number(nextTimestampSec) - Number(timestampSec));
    if (dt <= 0) {
      return estimate;
    }
    estimate = {
      ...estimate,
      position: add(estimate.position, scale(estimate.velocity, dt)),
    };
    timestampSec = Number(nextTimestampSec);
    return estimate;
  }

  function update({
    position,
    velocity,
    nextTimestampSec,
  } = {}) {
    if (!finiteVector(position) || !finiteVector(velocity)) {
      return estimate;
    }
    const incomingTime = Number(nextTimestampSec);
    if (Number.isFinite(incomingTime)) {
      predict(incomingTime);
    }
    if (!estimate) {
      estimate = {
        position: { ...position },
        velocity: { ...velocity },
      };
      timestampSec = Number.isFinite(incomingTime) ? incomingTime : timestampSec;
      return estimate;
    }
    estimate = {
      position: mixVectors(estimate.position, position, positionAlpha),
      velocity: mixVectors(estimate.velocity, velocity, velocityAlpha),
    };
    timestampSec = Number.isFinite(incomingTime) ? incomingTime : timestampSec;
    return estimate;
  }

  function snapshot() {
    if (!estimate) {
      return null;
    }
    return {
      position: { ...estimate.position },
      velocity: { ...estimate.velocity },
      timestampSec,
    };
  }

  function restore(nextSnapshot = null) {
    if (
      !nextSnapshot
      || !finiteVector(nextSnapshot.position)
      || !finiteVector(nextSnapshot.velocity)
    ) {
      reset();
      return null;
    }
    estimate = {
      position: { ...nextSnapshot.position },
      velocity: { ...nextSnapshot.velocity },
    };
    const nextTime = Number(nextSnapshot.timestampSec);
    timestampSec = Number.isFinite(nextTime) ? nextTime : null;
    return snapshot();
  }

  return {
    reset,
    predict,
    update,
    restore,
    snapshot,
  };
}
