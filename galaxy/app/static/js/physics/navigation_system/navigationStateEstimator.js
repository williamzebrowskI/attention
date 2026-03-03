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
  measurementPositionSigmaKm = NAVIGATION_DEFAULTS.estimator.measurementPositionSigmaKm,
  measurementVelocitySigmaKmS = NAVIGATION_DEFAULTS.estimator.measurementVelocitySigmaKmS,
  processPositionSigmaKmPerSec = NAVIGATION_DEFAULTS.estimator.processPositionSigmaKmPerSec,
  processVelocitySigmaKmSPerSec = NAVIGATION_DEFAULTS.estimator.processVelocitySigmaKmSPerSec,
} = {}) {
  let estimate = null;
  let timestampSec = null;
  let covariance = null;
  const positionAlpha = clamp(Number(positionBlend) || 0.35, 0.05, 1);
  const velocityAlpha = clamp(Number(velocityBlend) || 0.45, 0.05, 1);
  const measurementPositionVarKm2 = Math.max(1e-9, (Number(measurementPositionSigmaKm) || 0.2) ** 2);
  const measurementVelocityVarKm2S2 = Math.max(1e-12, (Number(measurementVelocitySigmaKmS) || 0.0002) ** 2);
  const processPositionVarRateKm2PerSec = Math.max(0, (Number(processPositionSigmaKmPerSec) || 0.00005) ** 2);
  const processVelocityVarRateKm2S2PerSec = Math.max(0, (Number(processVelocitySigmaKmSPerSec) || 0.000004) ** 2);

  function ensureCovariance() {
    if (covariance && Number.isFinite(Number(covariance.positionVarKm2)) && Number.isFinite(Number(covariance.velocityVarKm2S2))) {
      return covariance;
    }
    covariance = {
      positionVarKm2: measurementPositionVarKm2,
      velocityVarKm2S2: measurementVelocityVarKm2S2,
    };
    return covariance;
  }

  function reset() {
    estimate = null;
    timestampSec = null;
    covariance = null;
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
    const cov = ensureCovariance();
    const positionVarKm2 = Math.max(
      1e-9,
      Number(cov.positionVarKm2)
      + (Number(cov.velocityVarKm2S2) * (dt ** 2))
      + (processPositionVarRateKm2PerSec * dt),
    );
    const velocityVarKm2S2 = Math.max(
      1e-12,
      Number(cov.velocityVarKm2S2) + (processVelocityVarRateKm2S2PerSec * dt),
    );
    covariance = {
      positionVarKm2,
      velocityVarKm2S2,
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
      covariance = {
        positionVarKm2: measurementPositionVarKm2,
        velocityVarKm2S2: measurementVelocityVarKm2S2,
      };
      timestampSec = Number.isFinite(incomingTime) ? incomingTime : timestampSec;
      return estimate;
    }
    const cov = ensureCovariance();
    const kalmanGainPosition = clamp(
      Number(cov.positionVarKm2) / (Number(cov.positionVarKm2) + measurementPositionVarKm2),
      0.02,
      0.98,
    );
    const kalmanGainVelocity = clamp(
      Number(cov.velocityVarKm2S2) / (Number(cov.velocityVarKm2S2) + measurementVelocityVarKm2S2),
      0.02,
      0.98,
    );
    const gainPosition = clamp(
      1 - ((1 - kalmanGainPosition) * (1 - positionAlpha)),
      0.02,
      0.98,
    );
    const gainVelocity = clamp(
      1 - ((1 - kalmanGainVelocity) * (1 - velocityAlpha)),
      0.02,
      0.98,
    );
    estimate = {
      position: mixVectors(estimate.position, position, gainPosition),
      velocity: mixVectors(estimate.velocity, velocity, gainVelocity),
    };
    covariance = {
      positionVarKm2: Math.max(1e-9, (1 - gainPosition) * Number(cov.positionVarKm2)),
      velocityVarKm2S2: Math.max(1e-12, (1 - gainVelocity) * Number(cov.velocityVarKm2S2)),
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
      positionSigmaKm: Math.sqrt(Math.max(0, Number(covariance?.positionVarKm2) || 0)),
      velocitySigmaKmS: Math.sqrt(Math.max(0, Number(covariance?.velocityVarKm2S2) || 0)),
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
    const restorePositionSigmaKm = Number(nextSnapshot.positionSigmaKm);
    const restoreVelocitySigmaKmS = Number(nextSnapshot.velocitySigmaKmS);
    covariance = {
      positionVarKm2: Number.isFinite(restorePositionSigmaKm)
        ? Math.max(1e-9, restorePositionSigmaKm ** 2)
        : measurementPositionVarKm2,
      velocityVarKm2S2: Number.isFinite(restoreVelocitySigmaKmS)
        ? Math.max(1e-12, restoreVelocitySigmaKmS ** 2)
        : measurementVelocityVarKm2S2,
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
