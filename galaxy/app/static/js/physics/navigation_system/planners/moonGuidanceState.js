import { finiteVector } from "../navigationMath.js";
import {
  NAVIGATION_MISSION_IDS,
  NAVIGATION_MISSION_PHASES,
} from "../navigationMissionProfiles.js";
import { createMoonNavigationFilterState } from "../lunar/moonStateFilter.js";

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback);
}

function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  return finiteVector(vector)
    ? {
      x: finiteNumber(vector.x, fallback.x),
      y: finiteNumber(vector.y, fallback.y),
      z: finiteNumber(vector.z, fallback.z),
    }
    : { ...fallback };
}

function createMoonGncRuntime() {
  return {
    lastSolveSec: null,
    lastSolveReason: "",
    lastCommandMode: "",
    solution: null,
    predictedMissDistanceKm: null,
    predictedPeriluneAltitudeKm: null,
    bPlaneErrorKm: null,
    deltaVNeedKmS: null,
  };
}

function normalizeMoonGncSolution(solution = null) {
  if (!solution || typeof solution !== "object") {
    return null;
  }
  return {
    cost: Number.isFinite(Number(solution.cost)) ? Number(solution.cost) : null,
    throttle: Number.isFinite(Number(solution.throttle)) ? Number(solution.throttle) : 0,
    deltaVNeedKmS: Number.isFinite(Number(solution.deltaVNeedKmS)) ? Number(solution.deltaVNeedKmS) : null,
    burnDurationSec: Number.isFinite(Number(solution.burnDurationSec)) ? Number(solution.burnDurationSec) : null,
    burnDirection: cloneVector(solution.burnDirection, { x: 0, y: 1, z: 0 }),
    predictedMissDistanceKm: Number.isFinite(Number(solution.predictedMissDistanceKm))
      ? Number(solution.predictedMissDistanceKm)
      : null,
    predictedPeriluneAltitudeKm: Number.isFinite(Number(solution.predictedPeriluneAltitudeKm))
      ? Number(solution.predictedPeriluneAltitudeKm)
      : null,
    bPlaneErrorKm: Number.isFinite(Number(solution.bPlaneErrorKm)) ? Number(solution.bPlaneErrorKm) : null,
    closestClosingSpeedKmS: Number.isFinite(Number(solution.closestClosingSpeedKmS))
      ? Number(solution.closestClosingSpeedKmS)
      : null,
    propagation: {
      durationSec: Number.isFinite(Number(solution.propagation?.durationSec))
        ? Number(solution.propagation.durationSec)
        : null,
      closestClosingSpeedKmS: Number.isFinite(Number(solution.propagation?.closestClosingSpeedKmS))
        ? Number(solution.propagation.closestClosingSpeedKmS)
        : null,
    },
  };
}

function createMoonApproachRuntime() {
  return {
    projectedPeriluneAltitudeKm: null,
    corridorErrorKm: null,
    bPlaneErrorKm: null,
    timeToClosestSec: null,
    lastDecision: "",
  };
}

export function createMoonGuidanceRuntime() {
  return {
    filter: createMoonNavigationFilterState(),
    gnc: createMoonGncRuntime(),
    approach: createMoonApproachRuntime(),
    lastTimestampSec: null,
  };
}

export function createPlannerRuntime() {
  return {
    missionId: "",
    missionPhase: "",
    moon: createMoonGuidanceRuntime(),
  };
}

function normalizeMoonFilterSnapshot(filterSnapshot = null) {
  const normalized = createMoonNavigationFilterState();
  if (!filterSnapshot || typeof filterSnapshot !== "object") {
    return normalized;
  }
  if (filterSnapshot.estimate && typeof filterSnapshot.estimate === "object") {
    const positionKm = cloneVector(filterSnapshot.estimate.positionKm);
    const velocityKmS = cloneVector(filterSnapshot.estimate.velocityKmS);
    normalized.estimate = {
      positionKm,
      velocityKmS,
    };
  }
  const covariance = filterSnapshot.covariance;
  if (covariance && typeof covariance === "object") {
    normalized.covariance = {
      px: Math.max(1e-12, finiteNumber(covariance.px, normalized.covariance.px)),
      py: Math.max(1e-12, finiteNumber(covariance.py, normalized.covariance.py)),
      pz: Math.max(1e-12, finiteNumber(covariance.pz, normalized.covariance.pz)),
      vx: Math.max(1e-14, finiteNumber(covariance.vx, normalized.covariance.vx)),
      vy: Math.max(1e-14, finiteNumber(covariance.vy, normalized.covariance.vy)),
      vz: Math.max(1e-14, finiteNumber(covariance.vz, normalized.covariance.vz)),
    };
  }
  normalized.lastTimestampSec = Number.isFinite(Number(filterSnapshot.lastTimestampSec))
    ? Number(filterSnapshot.lastTimestampSec)
    : null;
  normalized.lastControlAccelKmS2 = cloneVector(filterSnapshot.lastControlAccelKmS2);
  if (filterSnapshot.lastMeasurement && typeof filterSnapshot.lastMeasurement === "object") {
    normalized.lastMeasurement = {
      ...filterSnapshot.lastMeasurement,
      rangeKm: Number.isFinite(Number(filterSnapshot.lastMeasurement.rangeKm))
        ? Number(filterSnapshot.lastMeasurement.rangeKm)
        : null,
      rangeRateKmS: Number.isFinite(Number(filterSnapshot.lastMeasurement.rangeRateKmS))
        ? Number(filterSnapshot.lastMeasurement.rangeRateKmS)
        : null,
      moonLosErrorDeg: Number.isFinite(Number(filterSnapshot.lastMeasurement.moonLosErrorDeg))
        ? Number(filterSnapshot.lastMeasurement.moonLosErrorDeg)
        : null,
      positionResidualKm: Number.isFinite(Number(filterSnapshot.lastMeasurement.positionResidualKm))
        ? Number(filterSnapshot.lastMeasurement.positionResidualKm)
        : null,
      velocityResidualKmS: Number.isFinite(Number(filterSnapshot.lastMeasurement.velocityResidualKmS))
        ? Number(filterSnapshot.lastMeasurement.velocityResidualKmS)
        : null,
      positionSigmaKm: Number.isFinite(Number(filterSnapshot.lastMeasurement.positionSigmaKm))
        ? Number(filterSnapshot.lastMeasurement.positionSigmaKm)
        : null,
      velocitySigmaKmS: Number.isFinite(Number(filterSnapshot.lastMeasurement.velocitySigmaKmS))
        ? Number(filterSnapshot.lastMeasurement.velocitySigmaKmS)
        : null,
    };
  }
  return normalized;
}

export function normalizePlannerRuntimeSnapshot(nextSnapshot = null) {
  const normalized = createPlannerRuntime();
  if (!nextSnapshot || typeof nextSnapshot !== "object") {
    return normalized;
  }
  normalized.missionId = String(nextSnapshot.missionId || "");
  normalized.missionPhase = String(nextSnapshot.missionPhase || "");
  const moonSnapshot = nextSnapshot.moon;
  if (moonSnapshot && typeof moonSnapshot === "object") {
    normalized.moon.filter = normalizeMoonFilterSnapshot(moonSnapshot.filter);
    const gnc = moonSnapshot.gnc;
    if (gnc && typeof gnc === "object") {
      normalized.moon.gnc = {
        lastSolveSec: Number.isFinite(Number(gnc.lastSolveSec)) ? Number(gnc.lastSolveSec) : null,
        lastSolveReason: String(gnc.lastSolveReason || ""),
        lastCommandMode: String(gnc.lastCommandMode || ""),
        solution: normalizeMoonGncSolution(gnc.solution),
        predictedMissDistanceKm: Number.isFinite(Number(gnc.predictedMissDistanceKm))
          ? Number(gnc.predictedMissDistanceKm)
          : null,
        predictedPeriluneAltitudeKm: Number.isFinite(Number(gnc.predictedPeriluneAltitudeKm))
          ? Number(gnc.predictedPeriluneAltitudeKm)
          : null,
        bPlaneErrorKm: Number.isFinite(Number(gnc.bPlaneErrorKm)) ? Number(gnc.bPlaneErrorKm) : null,
        deltaVNeedKmS: Number.isFinite(Number(gnc.deltaVNeedKmS)) ? Number(gnc.deltaVNeedKmS) : null,
      };
    }
    const approach = moonSnapshot.approach;
    if (approach && typeof approach === "object") {
      normalized.moon.approach = {
        projectedPeriluneAltitudeKm: Number.isFinite(Number(approach.projectedPeriluneAltitudeKm))
          ? Number(approach.projectedPeriluneAltitudeKm)
          : null,
        corridorErrorKm: Number.isFinite(Number(approach.corridorErrorKm))
          ? Number(approach.corridorErrorKm)
          : null,
        bPlaneErrorKm: Number.isFinite(Number(approach.bPlaneErrorKm))
          ? Number(approach.bPlaneErrorKm)
          : null,
        timeToClosestSec: Number.isFinite(Number(approach.timeToClosestSec))
          ? Number(approach.timeToClosestSec)
          : null,
        lastDecision: String(approach.lastDecision || ""),
      };
    }
    normalized.moon.lastTimestampSec = Number.isFinite(Number(moonSnapshot.lastTimestampSec))
      ? Number(moonSnapshot.lastTimestampSec)
      : null;
  }
  return normalized;
}

function resetMoonGuidanceRuntime(moonRuntime, { clearFilter = false } = {}) {
  if (!moonRuntime || typeof moonRuntime !== "object") {
    return;
  }
  moonRuntime.gnc = createMoonGncRuntime();
  moonRuntime.approach = createMoonApproachRuntime();
  if (clearFilter || !moonRuntime.filter || typeof moonRuntime.filter !== "object") {
    moonRuntime.filter = createMoonNavigationFilterState();
  } else {
    moonRuntime.filter.lastControlAccelKmS2 = { x: 0, y: 0, z: 0 };
  }
}

export function syncPlannerRuntime({
  plannerRuntime,
  missionId,
  missionPhase,
} = {}) {
  if (!plannerRuntime || typeof plannerRuntime !== "object") {
    return;
  }
  const nextMissionId = String(missionId || NAVIGATION_MISSION_IDS.EARTH_ORBIT_HOLD);
  const nextMissionPhase = String(missionPhase || "").trim();
  const missionChanged = plannerRuntime.missionId !== nextMissionId;
  const phaseChanged = plannerRuntime.missionPhase !== nextMissionPhase;
  if (missionChanged) {
    plannerRuntime.moon = createMoonGuidanceRuntime();
  } else if (phaseChanged) {
    if (nextMissionPhase === NAVIGATION_MISSION_PHASES.TLI_BURN) {
      resetMoonGuidanceRuntime(plannerRuntime.moon, { clearFilter: true });
    } else if (nextMissionPhase !== NAVIGATION_MISSION_PHASES.COAST_TO_MOON) {
      resetMoonGuidanceRuntime(plannerRuntime.moon, { clearFilter: false });
    }
  }
  plannerRuntime.missionId = nextMissionId;
  plannerRuntime.missionPhase = nextMissionPhase;
}
