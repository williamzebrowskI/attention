import { NAVIGATION_MISSION_IDS } from "./navigationMissionProfiles.js";
import {
  NAVIGATION_DEFAULTS,
  NAVIGATION_SYSTEM_MODES,
  normalizeNavigationMode,
} from "./navigationSystemConfig.js";
import { planEarthOrbitHoldCommand } from "./planners/earthOrbitHoldPlanner.js";
import {
  createPlannerRuntime,
  normalizePlannerRuntimeSnapshot,
  syncPlannerRuntime,
} from "./planners/moonGuidanceState.js";
import { planMoonMissionCommand } from "./planners/moonMissionPlanner.js";

export function createNavigationTrajectoryPlanner({
  mode = NAVIGATION_DEFAULTS.mode,
  plannerConfig = NAVIGATION_DEFAULTS.planner,
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
        sensorEstimate: plannerRuntime.moon.sensorEstimate
          ? {
            distanceKm: Number(plannerRuntime.moon.sensorEstimate.distanceKm) || 0,
            closingSpeedKmS: Number(plannerRuntime.moon.sensorEstimate.closingSpeedKmS) || 0,
            projectedMissDistanceKm: Number(plannerRuntime.moon.sensorEstimate.projectedMissDistanceKm) || 0,
            direction: {
              x: Number(plannerRuntime.moon.sensorEstimate.direction?.x) || 0,
              y: Number(plannerRuntime.moon.sensorEstimate.direction?.y) || 0,
              z: Number(plannerRuntime.moon.sensorEstimate.direction?.z) || 0,
            },
          }
          : null,
        midcourse: {
          active: Boolean(plannerRuntime.moon.midcourse.active),
          burnSec: Math.max(0, Number(plannerRuntime.moon.midcourse.burnSec) || 0),
          stableSec: Math.max(0, Number(plannerRuntime.moon.midcourse.stableSec) || 0),
          cooldownSec: Math.max(0, Number(plannerRuntime.moon.midcourse.cooldownSec) || 0),
          lastStartSec: Number.isFinite(Number(plannerRuntime.moon.midcourse.lastStartSec))
            ? Number(plannerRuntime.moon.midcourse.lastStartSec)
            : null,
          lastStopSec: Number.isFinite(Number(plannerRuntime.moon.midcourse.lastStopSec))
            ? Number(plannerRuntime.moon.midcourse.lastStopSec)
            : null,
        },
        tli: {
          mode: String(plannerRuntime.moon.tli?.mode || ""),
          modeHoldSec: Math.max(0, Number(plannerRuntime.moon.tli?.modeHoldSec) || 0),
          lastTimestampSec: Number.isFinite(Number(plannerRuntime.moon.tli?.lastTimestampSec))
            ? Number(plannerRuntime.moon.tli.lastTimestampSec)
            : null,
          protectCooldownSec: Math.max(0, Number(plannerRuntime.moon.tli?.protectCooldownSec) || 0),
        },
        retarget: {
          lastSolveSec: Number.isFinite(Number(plannerRuntime.moon.retarget?.lastSolveSec))
            ? Number(plannerRuntime.moon.retarget.lastSolveSec)
            : null,
          lastSolveReason: String(plannerRuntime.moon.retarget?.lastSolveReason || ""),
        },
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
        plannerRuntime,
        timestampSec,
      })
      : planEarthOrbitHoldCommand({ targetVectors });

    if (currentMode === NAVIGATION_SYSTEM_MODES.PREDICTIVE_OPTIMIZER) {
      return {
        ...baselineCommand,
        mode: `${baselineCommand.mode}+predictive-fallback`,
        diagnostics: {
          optimizerReady: false,
          plannerMode: currentMode,
          note: "Predictive optimizer scaffold exists but is not yet active.",
          moonPlanner: normalizedMissionId === NAVIGATION_MISSION_IDS.MOON_ORBIT_RETURN
            ? snapshot().moon
            : null,
        },
      };
    }
    return {
      ...baselineCommand,
      diagnostics: {
        optimizerReady: false,
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
