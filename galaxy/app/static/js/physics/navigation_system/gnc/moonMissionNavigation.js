import { finiteVector } from "../navigationMath.js";
import {
  createMoonNavigationFilterState,
  updateMoonNavigationFilter,
} from "../lunar/moonStateFilter.js";

function finiteTimestampSec(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function ensureMoonNavigationRuntime(moonRuntime = null) {
  if (!moonRuntime || typeof moonRuntime !== "object") {
    return null;
  }
  if (!moonRuntime.filter || typeof moonRuntime.filter !== "object") {
    moonRuntime.filter = createMoonNavigationFilterState();
  }
  return moonRuntime.filter;
}

export function prepareMoonMissionNavigationEstimate({
  plannerRuntime = null,
  targetVectors = {},
  metrics = {},
  plannerConfig = {},
  estimatorConfig = {},
  timestampSec = Number.NaN,
} = {}) {
  const moonRuntime = plannerRuntime?.moon || null;
  const filterState = ensureMoonNavigationRuntime(moonRuntime);
  if (!filterState) {
    return {
      moonRuntime: null,
      filterState: null,
      estimatedPositionKm: finiteVector(targetVectors.shipEarthPositionKm)
        ? targetVectors.shipEarthPositionKm
        : null,
      estimatedVelocityKmS: finiteVector(targetVectors.shipEarthVelocityKmS)
        ? targetVectors.shipEarthVelocityKmS
        : null,
    };
  }

  updateMoonNavigationFilter({
    filterState,
    targetVectors,
    metrics,
    plannerConfig,
    estimatorConfig,
    timestampSec,
  });
  moonRuntime.lastTimestampSec = finiteTimestampSec(timestampSec, moonRuntime.lastTimestampSec);

  const estimatedPositionKm = finiteVector(moonRuntime.filter?.estimate?.positionKm)
    ? moonRuntime.filter.estimate.positionKm
    : (finiteVector(targetVectors.shipEarthPositionKm) ? targetVectors.shipEarthPositionKm : null);
  const estimatedVelocityKmS = finiteVector(moonRuntime.filter?.estimate?.velocityKmS)
    ? moonRuntime.filter.estimate.velocityKmS
    : (finiteVector(targetVectors.shipEarthVelocityKmS) ? targetVectors.shipEarthVelocityKmS : null);

  return {
    moonRuntime,
    filterState,
    estimatedPositionKm,
    estimatedVelocityKmS,
  };
}
