import {
  add,
  clamp,
  finiteVector,
  length,
  scale,
  subtract,
} from "../navigationMath.js";
import {
  propagateMoonGuidanceState,
} from "../../runtime/lunarPropagation.js";
import { buildMoonGuidanceSourceModel } from "../../runtime/lunarSourceModel.js";
import { synthesizeMoonNavigationMeasurement } from "./moonMeasurementModel.js";

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback);
}

function axisKalmanGain(predictedVar, measuredVar) {
  const numerator = Math.max(1e-12, finiteNumber(predictedVar, 0));
  const denominator = numerator + Math.max(1e-12, finiteNumber(measuredVar, 0));
  return clamp(numerator / denominator, 0.01, 0.98);
}

function hashStringToUnit(value = "") {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * 2 - 1;
}

function resolveImuBiasAccelKmS2(filterState, metrics = {}, estimatorConfig = {}) {
  if (finiteVector(filterState?.imuBiasAccelKmS2)) {
    return filterState.imuBiasAccelKmS2;
  }
  const magnitude = Math.max(0, finiteNumber(estimatorConfig.imuAccelBiasKmS2, 1.2e-8));
  const seed = String(metrics.bodyId || "starship-moon-mission");
  const bias = {
    x: hashStringToUnit(`${seed}:x`) * magnitude,
    y: hashStringToUnit(`${seed}:y`) * magnitude,
    z: hashStringToUnit(`${seed}:z`) * magnitude,
  };
  filterState.imuBiasAccelKmS2 = bias;
  return bias;
}

function covarianceSigmaSummary(covariance = {}) {
  return {
    positionSigmaKm: Math.sqrt(Math.max(
      0,
      finiteNumber(covariance.px, 0),
      finiteNumber(covariance.py, 0),
      finiteNumber(covariance.pz, 0),
    )),
    velocitySigmaKmS: Math.sqrt(Math.max(
      0,
      finiteNumber(covariance.vx, 0),
      finiteNumber(covariance.vy, 0),
      finiteNumber(covariance.vz, 0),
    )),
  };
}

function componentVarianceMap(positionSigmaKm = {}, velocitySigmaKmS = {}) {
  return {
    px: Math.max(1e-12, finiteNumber(positionSigmaKm.radial, 0.2) ** 2),
    py: Math.max(1e-12, finiteNumber(positionSigmaKm.alongTrack, 0.2) ** 2),
    pz: Math.max(1e-12, finiteNumber(positionSigmaKm.crossTrack, 0.2) ** 2),
    vx: Math.max(1e-14, finiteNumber(velocitySigmaKmS.radial, 0.0002) ** 2),
    vy: Math.max(1e-14, finiteNumber(velocitySigmaKmS.alongTrack, 0.0002) ** 2),
    vz: Math.max(1e-14, finiteNumber(velocitySigmaKmS.crossTrack, 0.0002) ** 2),
  };
}

export function createMoonNavigationFilterState() {
  return {
    estimate: null,
    covariance: {
      px: 0.04,
      py: 0.04,
      pz: 0.04,
      vx: 4e-8,
      vy: 4e-8,
      vz: 4e-8,
    },
    lastTimestampSec: null,
    lastMeasurement: null,
    lastMeasurementTimestampSec: null,
    lastControlAccelKmS2: { x: 0, y: 0, z: 0 },
    imuBiasAccelKmS2: null,
  };
}

export function updateMoonNavigationFilter({
  filterState = null,
  targetVectors = {},
  metrics = {},
  plannerConfig = {},
  estimatorConfig = {},
  timestampSec = Number.NaN,
} = {}) {
  if (!filterState || typeof filterState !== "object") {
    return null;
  }
  if (!finiteVector(targetVectors.shipEarthPositionKm) || !finiteVector(targetVectors.shipEarthVelocityKmS)) {
    return null;
  }
  const nowSec = Number(timestampSec);
  const prevSec = Number(filterState.lastTimestampSec);
  const dtSec = Number.isFinite(nowSec) && Number.isFinite(prevSec)
    ? Math.max(0, nowSec - prevSec)
    : 0;
  const sources = buildMoonGuidanceSourceModel({ targetVectors, metrics, plannerConfig });
  const spacecraft = {
    bodyId: String(metrics.bodyId || "earth_launch_vehicle"),
    massKg: Math.max(1, finiteNumber(metrics.stageMassKg, metrics.massKg || 1)),
    radiusKm: 0.0045,
    reflectivityCoeff: finiteNumber(metrics.reflectivityCoeff, 1.45),
  };

  if (filterState.estimate && dtSec > 1e-6) {
    const imuBiasAccelKmS2 = resolveImuBiasAccelKmS2(filterState, metrics, estimatorConfig);
    const predicted = propagateMoonGuidanceState({
      initialState: filterState.estimate,
      durationSec: dtSec,
      stepSec: Math.max(5, Math.min(60, finiteNumber(plannerConfig.moonClosedLoopFilterStepSec, 20))),
      sources,
      spacecraft,
      burnCommand: {
        direction: filterState.lastControlAccelKmS2,
        throttle: length(filterState.lastControlAccelKmS2) > 1e-9 ? 1 : 0,
        accelAtThrottle1KmS2: length(filterState.lastControlAccelKmS2),
        burnDurationSec: dtSec,
      },
    });
    if (predicted?.finalState) {
      const inertialPositionDriftKm = scale(imuBiasAccelKmS2, 0.5 * (dtSec ** 2));
      const inertialVelocityDriftKmS = scale(imuBiasAccelKmS2, dtSec);
      filterState.estimate = {
        ...predicted.finalState,
        positionKm: add(predicted.finalState.positionKm, inertialPositionDriftKm),
        velocityKmS: add(predicted.finalState.velocityKmS, inertialVelocityDriftKmS),
      };
      const positionProcessVar = Math.max(1e-10, finiteNumber(estimatorConfig.processPositionSigmaKmPerSec, 0.00005) ** 2 * dtSec);
      const velocityProcessVar = Math.max(1e-12, finiteNumber(estimatorConfig.processVelocitySigmaKmSPerSec, 0.000004) ** 2 * dtSec);
      const imuAccelNoiseKmS2 = Math.max(0, finiteNumber(estimatorConfig.imuAccelNoiseKmS2, 2.8e-8));
      const imuPositionVar = 0.25 * (imuAccelNoiseKmS2 ** 2) * (dtSec ** 4);
      const imuVelocityVar = (imuAccelNoiseKmS2 ** 2) * (dtSec ** 2);
      filterState.covariance = {
        px: filterState.covariance.px + positionProcessVar + imuPositionVar,
        py: filterState.covariance.py + positionProcessVar + imuPositionVar,
        pz: filterState.covariance.pz + positionProcessVar + imuPositionVar,
        vx: filterState.covariance.vx + velocityProcessVar + imuVelocityVar,
        vy: filterState.covariance.vy + velocityProcessVar + imuVelocityVar,
        vz: filterState.covariance.vz + velocityProcessVar + imuVelocityVar,
      };
    }
  }

  const measurement = synthesizeMoonNavigationMeasurement({
    shipEarthPositionKm: targetVectors.shipEarthPositionKm,
    shipEarthVelocityKmS: targetVectors.shipEarthVelocityKmS,
    moonEarthPositionKm: targetVectors.moonEarthPositionKm,
    timestampSec: nowSec,
    estimatorConfig,
    previousMeasurementTimestampSec: filterState.lastMeasurementTimestampSec === null
      ? Number.NaN
      : filterState.lastMeasurementTimestampSec,
  });
  if (!measurement) {
    return filterState.estimate;
  }
  if (measurement.fresh === false) {
    const sigma = covarianceSigmaSummary(filterState.covariance);
    filterState.lastMeasurement = {
      ...(filterState.lastMeasurement || {}),
      ...(measurement.diagnostics || {}),
      positionResidualKm: null,
      velocityResidualKmS: null,
      positionSigmaKm: sigma.positionSigmaKm,
      velocitySigmaKmS: sigma.velocitySigmaKmS,
      imuPropagationAgeSec: Math.max(
        0,
        Number.isFinite(nowSec) && Number.isFinite(Number(filterState.lastMeasurementTimestampSec))
          ? nowSec - Number(filterState.lastMeasurementTimestampSec)
          : 0,
      ),
    };
    filterState.lastTimestampSec = Number.isFinite(nowSec) ? nowSec : filterState.lastTimestampSec;
    return filterState.estimate;
  }

  if (!filterState.estimate) {
    filterState.estimate = {
      positionKm: { ...measurement.positionKm },
      velocityKmS: { ...measurement.velocityKmS },
    };
    filterState.covariance = componentVarianceMap(measurement.positionSigmaKm, measurement.velocitySigmaKmS);
    filterState.lastMeasurement = measurement.diagnostics;
    filterState.lastMeasurementTimestampSec = Number.isFinite(Number(measurement.diagnostics?.measurementTimestampSec))
      ? Number(measurement.diagnostics.measurementTimestampSec)
      : (Number.isFinite(nowSec) ? nowSec : filterState.lastMeasurementTimestampSec);
    filterState.lastTimestampSec = Number.isFinite(nowSec) ? nowSec : filterState.lastTimestampSec;
    return filterState.estimate;
  }

  const measurementVar = componentVarianceMap(measurement.positionSigmaKm, measurement.velocitySigmaKmS);
  const gainPx = axisKalmanGain(filterState.covariance.px, measurementVar.px);
  const gainPy = axisKalmanGain(filterState.covariance.py, measurementVar.py);
  const gainPz = axisKalmanGain(filterState.covariance.pz, measurementVar.pz);
  const gainVx = axisKalmanGain(filterState.covariance.vx, measurementVar.vx);
  const gainVy = axisKalmanGain(filterState.covariance.vy, measurementVar.vy);
  const gainVz = axisKalmanGain(filterState.covariance.vz, measurementVar.vz);

  const predictedPosition = filterState.estimate.positionKm;
  const predictedVelocity = filterState.estimate.velocityKmS;
  const positionResidual = subtract(measurement.positionKm, predictedPosition);
  const velocityResidual = subtract(measurement.velocityKmS, predictedVelocity);

  filterState.estimate = {
    positionKm: {
      x: predictedPosition.x + (positionResidual.x * gainPx),
      y: predictedPosition.y + (positionResidual.y * gainPy),
      z: predictedPosition.z + (positionResidual.z * gainPz),
    },
    velocityKmS: {
      x: predictedVelocity.x + (velocityResidual.x * gainVx),
      y: predictedVelocity.y + (velocityResidual.y * gainVy),
      z: predictedVelocity.z + (velocityResidual.z * gainVz),
    },
  };
  filterState.covariance = {
    px: Math.max(1e-12, (1 - gainPx) * filterState.covariance.px),
    py: Math.max(1e-12, (1 - gainPy) * filterState.covariance.py),
    pz: Math.max(1e-12, (1 - gainPz) * filterState.covariance.pz),
    vx: Math.max(1e-14, (1 - gainVx) * filterState.covariance.vx),
    vy: Math.max(1e-14, (1 - gainVy) * filterState.covariance.vy),
    vz: Math.max(1e-14, (1 - gainVz) * filterState.covariance.vz),
  };
  filterState.lastMeasurement = {
    ...measurement.diagnostics,
    positionResidualKm: length(positionResidual),
    velocityResidualKmS: length(velocityResidual),
    positionSigmaKm: Math.sqrt(Math.max(filterState.covariance.px, filterState.covariance.py, filterState.covariance.pz)),
    velocitySigmaKmS: Math.sqrt(Math.max(filterState.covariance.vx, filterState.covariance.vy, filterState.covariance.vz)),
  };
  filterState.lastMeasurementTimestampSec = Number.isFinite(Number(measurement.diagnostics?.measurementTimestampSec))
    ? Number(measurement.diagnostics.measurementTimestampSec)
    : (Number.isFinite(nowSec) ? nowSec : filterState.lastMeasurementTimestampSec);
  filterState.lastTimestampSec = Number.isFinite(nowSec) ? nowSec : filterState.lastTimestampSec;
  return filterState.estimate;
}
