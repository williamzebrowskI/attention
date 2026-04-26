import { NAVIGATION_MISSION_IDS } from "./navigationMissionProfiles.js";
import {
  NAVIGATION_DEFAULTS,
  normalizeNavigationMode,
} from "./navigationSystemConfig.js";
import { planEarthOrbitHoldCommand } from "./planners/earthOrbitHoldPlanner.js";
import {
  createPlannerRuntime,
  normalizePlannerRuntimeSnapshot,
  syncPlannerRuntime,
} from "./planners/moonGuidanceState.js";
import { planMoonMissionCommand } from "./planners/moonMissionPlanner.js";

function snapshotMoonFilter(filter = null) {
  if (!filter || typeof filter !== "object") {
    return null;
  }
  return {
    estimate: filter.estimate
      ? {
        positionKm: {
          x: Number(filter.estimate.positionKm?.x) || 0,
          y: Number(filter.estimate.positionKm?.y) || 0,
          z: Number(filter.estimate.positionKm?.z) || 0,
        },
        velocityKmS: {
          x: Number(filter.estimate.velocityKmS?.x) || 0,
          y: Number(filter.estimate.velocityKmS?.y) || 0,
          z: Number(filter.estimate.velocityKmS?.z) || 0,
        },
      }
      : null,
    covariance: {
      px: Number(filter.covariance?.px) || 0,
      py: Number(filter.covariance?.py) || 0,
      pz: Number(filter.covariance?.pz) || 0,
      vx: Number(filter.covariance?.vx) || 0,
      vy: Number(filter.covariance?.vy) || 0,
      vz: Number(filter.covariance?.vz) || 0,
    },
    lastTimestampSec: Number.isFinite(Number(filter.lastTimestampSec))
      ? Number(filter.lastTimestampSec)
      : null,
    lastMeasurementTimestampSec: Number.isFinite(Number(filter.lastMeasurementTimestampSec))
      ? Number(filter.lastMeasurementTimestampSec)
      : null,
    lastMeasurement: filter.lastMeasurement ? { ...filter.lastMeasurement } : null,
    lastControlAccelKmS2: {
      x: Number(filter.lastControlAccelKmS2?.x) || 0,
      y: Number(filter.lastControlAccelKmS2?.y) || 0,
      z: Number(filter.lastControlAccelKmS2?.z) || 0,
    },
    imuBiasAccelKmS2: filter.imuBiasAccelKmS2
      ? {
        x: Number(filter.imuBiasAccelKmS2.x) || 0,
        y: Number(filter.imuBiasAccelKmS2.y) || 0,
        z: Number(filter.imuBiasAccelKmS2.z) || 0,
      }
      : null,
  };
}

function snapshotMoonGnc(gnc = null) {
  if (!gnc || typeof gnc !== "object") {
    return null;
  }
  return {
    lastSolveSec: Number.isFinite(Number(gnc.lastSolveSec)) ? Number(gnc.lastSolveSec) : null,
    lastSolveReason: String(gnc.lastSolveReason || ""),
    lastCommandMode: String(gnc.lastCommandMode || ""),
    solution: gnc.solution
      ? {
        cost: Number.isFinite(Number(gnc.solution.cost)) ? Number(gnc.solution.cost) : null,
        throttle: Number.isFinite(Number(gnc.solution.throttle)) ? Number(gnc.solution.throttle) : 0,
        deltaVNeedKmS: Number.isFinite(Number(gnc.solution.deltaVNeedKmS))
          ? Number(gnc.solution.deltaVNeedKmS)
          : null,
        burnDurationSec: Number.isFinite(Number(gnc.solution.burnDurationSec))
          ? Number(gnc.solution.burnDurationSec)
          : null,
        burnDirection: gnc.solution.burnDirection
          ? {
            x: Number(gnc.solution.burnDirection.x) || 0,
            y: Number(gnc.solution.burnDirection.y) || 0,
            z: Number(gnc.solution.burnDirection.z) || 0,
          }
          : null,
        predictedMissDistanceKm: Number.isFinite(Number(gnc.solution.predictedMissDistanceKm))
          ? Number(gnc.solution.predictedMissDistanceKm)
          : null,
        predictedPeriluneAltitudeKm: Number.isFinite(Number(gnc.solution.predictedPeriluneAltitudeKm))
          ? Number(gnc.solution.predictedPeriluneAltitudeKm)
          : null,
        bPlaneErrorKm: Number.isFinite(Number(gnc.solution.bPlaneErrorKm))
          ? Number(gnc.solution.bPlaneErrorKm)
          : null,
        closestClosingSpeedKmS: Number.isFinite(Number(gnc.solution.closestClosingSpeedKmS))
          ? Number(gnc.solution.closestClosingSpeedKmS)
          : null,
        propagation: gnc.solution.propagation
          ? {
            durationSec: Number.isFinite(Number(gnc.solution.propagation.durationSec))
              ? Number(gnc.solution.propagation.durationSec)
              : null,
            closestClosingSpeedKmS: Number.isFinite(Number(gnc.solution.propagation.closestClosingSpeedKmS))
              ? Number(gnc.solution.propagation.closestClosingSpeedKmS)
              : null,
          }
          : null,
      }
      : null,
    solutionStatePositionKm: gnc.solutionStatePositionKm
      ? {
        x: Number(gnc.solutionStatePositionKm.x) || 0,
        y: Number(gnc.solutionStatePositionKm.y) || 0,
        z: Number(gnc.solutionStatePositionKm.z) || 0,
      }
      : null,
    solutionStateVelocityKmS: gnc.solutionStateVelocityKmS
      ? {
        x: Number(gnc.solutionStateVelocityKmS.x) || 0,
        y: Number(gnc.solutionStateVelocityKmS.y) || 0,
        z: Number(gnc.solutionStateVelocityKmS.z) || 0,
      }
      : null,
    solutionStateTimestampSec: Number.isFinite(Number(gnc.solutionStateTimestampSec))
      ? Number(gnc.solutionStateTimestampSec)
      : null,
    predictedMissDistanceKm: Number.isFinite(Number(gnc.predictedMissDistanceKm))
      ? Number(gnc.predictedMissDistanceKm)
      : null,
    solutionStateDriftKm: Number.isFinite(Number(gnc.solutionStateDriftKm))
      ? Number(gnc.solutionStateDriftKm)
      : null,
    solutionStateDriftKmS: Number.isFinite(Number(gnc.solutionStateDriftKmS))
      ? Number(gnc.solutionStateDriftKmS)
      : null,
    solutionInvalidatedForStateDrift: Boolean(gnc.solutionInvalidatedForStateDrift),
    predictedPeriluneAltitudeKm: Number.isFinite(Number(gnc.predictedPeriluneAltitudeKm))
      ? Number(gnc.predictedPeriluneAltitudeKm)
      : null,
    bPlaneErrorKm: Number.isFinite(Number(gnc.bPlaneErrorKm)) ? Number(gnc.bPlaneErrorKm) : null,
    deltaVNeedKmS: Number.isFinite(Number(gnc.deltaVNeedKmS)) ? Number(gnc.deltaVNeedKmS) : null,
  };
}

export function createNavigationTrajectoryPlanner({
  mode = NAVIGATION_DEFAULTS.mode,
  plannerConfig = NAVIGATION_DEFAULTS.planner,
  estimatorConfig = NAVIGATION_DEFAULTS.estimator,
} = {}) {
  let currentMode = normalizeNavigationMode(mode);
  let plannerRuntime = createPlannerRuntime();

  function setMode(nextMode) {
    currentMode = normalizeNavigationMode(nextMode);
    return currentMode;
  }

  function snapshot() {
    return {
      missionId: plannerRuntime.missionId,
      missionPhase: plannerRuntime.missionPhase,
      moon: {
        filter: snapshotMoonFilter(plannerRuntime.moon.filter),
        gnc: snapshotMoonGnc(plannerRuntime.moon.gnc),
        approach: {
          projectedPeriluneAltitudeKm: Number.isFinite(Number(plannerRuntime.moon.approach?.projectedPeriluneAltitudeKm))
            ? Number(plannerRuntime.moon.approach.projectedPeriluneAltitudeKm)
            : null,
          corridorErrorKm: Number.isFinite(Number(plannerRuntime.moon.approach?.corridorErrorKm))
            ? Number(plannerRuntime.moon.approach.corridorErrorKm)
            : null,
          bPlaneErrorKm: Number.isFinite(Number(plannerRuntime.moon.approach?.bPlaneErrorKm))
            ? Number(plannerRuntime.moon.approach.bPlaneErrorKm)
            : null,
          timeToClosestSec: Number.isFinite(Number(plannerRuntime.moon.approach?.timeToClosestSec))
            ? Number(plannerRuntime.moon.approach.timeToClosestSec)
            : null,
          lastDecision: String(plannerRuntime.moon.approach?.lastDecision || ""),
        },
        lastTimestampSec: Number.isFinite(Number(plannerRuntime.moon.lastTimestampSec))
          ? Number(plannerRuntime.moon.lastTimestampSec)
          : null,
      },
    };
  }

  function restore(nextSnapshot = null, {
    missionIdFallback = NAVIGATION_MISSION_IDS.EARTH_ORBIT_HOLD,
    missionPhaseFallback = "",
  } = {}) {
    plannerRuntime = normalizePlannerRuntimeSnapshot(nextSnapshot);
    if (!plannerRuntime.missionId) {
      plannerRuntime.missionId = String(missionIdFallback || NAVIGATION_MISSION_IDS.EARTH_ORBIT_HOLD);
    }
    if (!plannerRuntime.missionPhase) {
      plannerRuntime.missionPhase = String(missionPhaseFallback || "");
    }
    return snapshot();
  }

  function reset({
    missionId = NAVIGATION_MISSION_IDS.EARTH_ORBIT_HOLD,
    missionPhase = "",
  } = {}) {
    plannerRuntime = createPlannerRuntime();
    plannerRuntime.missionId = String(missionId || NAVIGATION_MISSION_IDS.EARTH_ORBIT_HOLD);
    plannerRuntime.missionPhase = String(missionPhase || "");
    return snapshot();
  }

  function planCommand({
    missionId,
    missionPhase,
    targetVectors = {},
    metrics = {},
    timestampSec = Number.NaN,
  } = {}) {
    const normalizedMissionId = String(missionId || NAVIGATION_MISSION_IDS.EARTH_ORBIT_HOLD);
    syncPlannerRuntime({
      plannerRuntime,
      missionId: normalizedMissionId,
      missionPhase,
    });
    const baselineCommand = normalizedMissionId === NAVIGATION_MISSION_IDS.MOON_ORBIT_RETURN
      ? planMoonMissionCommand({
        phase: missionPhase,
        targetVectors,
        metrics,
        plannerConfig,
        estimatorConfig,
        plannerRuntime,
        timestampSec,
      })
      : planEarthOrbitHoldCommand({ targetVectors });

    return {
      ...baselineCommand,
      diagnostics: {
        ...(baselineCommand?.diagnostics && typeof baselineCommand.diagnostics === "object"
          ? baselineCommand.diagnostics
          : {}),
        optimizerReady: true,
        plannerMode: currentMode,
        moonPlanner: normalizedMissionId === NAVIGATION_MISSION_IDS.MOON_ORBIT_RETURN
          ? snapshot().moon
          : null,
      },
    };
  }

  return {
    setMode,
    mode() {
      return currentMode;
    },
    reset,
    restore,
    snapshot,
    planCommand,
  };
}
