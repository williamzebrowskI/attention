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
    lastControlAccelKmS2: { x: 0, y: 0, z: 0 },
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
      filterState.estimate = predicted.finalState;
      const positionProcessVar = Math.max(1e-10, finiteNumber(estimatorConfig.processPositionSigmaKmPerSec, 0.00005) ** 2 * dtSec);
      const velocityProcessVar = Math.max(1e-12, finiteNumber(estimatorConfig.processVelocitySigmaKmSPerSec, 0.000004) ** 2 * dtSec);
      filterState.covariance = {
        px: filterState.covariance.px + positionProcessVar,
        py: filterState.covariance.py + positionProcessVar,
        pz: filterState.covariance.pz + positionProcessVar,
        vx: filterState.covariance.vx + velocityProcessVar,
        vy: filterState.covariance.vy + velocityProcessVar,
        vz: filterState.covariance.vz + velocityProcessVar,
      };
    }
  }

  const measurement = synthesizeMoonNavigationMeasurement({
    shipEarthPositionKm: targetVectors.shipEarthPositionKm,
    shipEarthVelocityKmS: targetVectors.shipEarthVelocityKmS,
    moonEarthPositionKm: targetVectors.moonEarthPositionKm,
    timestampSec: nowSec,
    estimatorConfig,
  });
  if (!measurement) {
    return filterState.estimate;
  }

  if (!filterState.estimate) {
    filterState.estimate = {
      positionKm: { ...measurement.positionKm },
      velocityKmS: { ...measurement.velocityKmS },
    };
    filterState.covariance = componentVarianceMap(measurement.positionSigmaKm, measurement.velocitySigmaKmS);
    filterState.lastMeasurement = measurement.diagnostics;
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
  filterState.lastTimestampSec = Number.isFinite(nowSec) ? nowSec : filterState.lastTimestampSec;
  return filterState.estimate;
}
