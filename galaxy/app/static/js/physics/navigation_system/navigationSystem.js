import {
  missionDefaultPhase,
  normalizeMissionId,
} from "./navigationMissionProfiles.js";
import { evaluateMissionPhase } from "./navigationPhaseEvaluator.js";
import { createNavigationStateEstimator } from "./navigationStateEstimator.js";
import { createNavigationTrajectoryPlanner } from "./navigationTrajectoryPlanner.js";
import {
  createNavigationSystemState,
  transitionMissionPhase,
} from "./navigationSystemState.js";
import { NAVIGATION_DEFAULTS, normalizeNavigationMode } from "./navigationSystemConfig.js";

function defaultTimestampSec() {
  return Date.now() / 1000;
}

export function createNavigationSystem({
  missionId,
  mode = NAVIGATION_DEFAULTS.mode,
  estimatorOptions = NAVIGATION_DEFAULTS.estimator,
  plannerOptions = NAVIGATION_DEFAULTS.planner,
} = {}) {
  const runtime = createNavigationSystemState({
    missionId,
    mode,
    timestampSec: defaultTimestampSec(),
  });
  const estimator = createNavigationStateEstimator(estimatorOptions);
  const planner = createNavigationTrajectoryPlanner({
    mode: runtime.mode,
    plannerConfig: plannerOptions,
  });

  function setMode(nextMode) {
    const normalizedMode = normalizeNavigationMode(nextMode);
    runtime.mode = normalizedMode;
    planner.setMode(normalizedMode);
    return runtime.mode;
  }

  function setMission(missionIdOverride, timestampSec = defaultTimestampSec()) {
    const normalizedMission = normalizeMissionId(missionIdOverride);
    runtime.missionId = normalizedMission;
    runtime.missionPhase = missionDefaultPhase(normalizedMission);
    runtime.missionCompleted = false;
    runtime.phaseStartedAtSec = Number(timestampSec) || defaultTimestampSec();
    return runtime.missionId;
  }

  function reset({
    missionIdOverride = runtime.missionId,
    modeOverride = runtime.mode,
    timestampSec = defaultTimestampSec(),
  } = {}) {
    estimator.reset();
    runtime.phaseHistory = [];
    runtime.lastCommand = null;
    runtime.missionCompleted = false;
    runtime.initializedAtSec = Number(timestampSec) || defaultTimestampSec();
    runtime.lastUpdateSec = runtime.initializedAtSec;
    setMode(modeOverride);
    setMission(missionIdOverride, runtime.initializedAtSec);
    planner.reset?.({
      missionId: runtime.missionId,
      missionPhase: runtime.missionPhase,
    });
    return snapshot();
  }

  function update({
    measurement = null,
    orbital = null,
    moonOrbit = null,
    metrics = {},
    targetVectors = {},
    timestampSec = defaultTimestampSec(),
  } = {}) {
    const nowSec = Number(timestampSec) || defaultTimestampSec();
    runtime.lastUpdateSec = nowSec;

    if (measurement?.position && measurement?.velocity) {
      estimator.update({
        position: measurement.position,
        velocity: measurement.velocity,
        nextTimestampSec: nowSec,
      });
    } else {
      estimator.predict(nowSec);
    }

    const phaseElapsedSec = Math.max(0, nowSec - (Number(runtime.phaseStartedAtSec) || nowSec));
    const phaseDecision = evaluateMissionPhase({
      missionId: runtime.missionId,
      phase: runtime.missionPhase,
      orbital,
      moonOrbit,
      metrics,
      missionElapsedInPhaseSec: phaseElapsedSec,
    });

    if (phaseDecision?.nextPhase) {
      transitionMissionPhase(runtime, phaseDecision.nextPhase, nowSec, phaseDecision.reason || "");
    }

    const command = planner.planCommand({
      missionId: runtime.missionId,
      missionPhase: runtime.missionPhase,
      targetVectors,
      metrics,
      timestampSec: nowSec,
    });
    runtime.lastCommand = command;
    runtime.missionCompleted = runtime.missionPhase === "earth_orbit_hold";
    return {
      command,
      state: snapshot(),
      phaseDecision: phaseDecision || null,
    };
  }

  function snapshot() {
    const estimate = estimator.snapshot();
    return {
      mode: runtime.mode,
      missionId: runtime.missionId,
      missionPhase: runtime.missionPhase,
      missionCompleted: Boolean(runtime.missionCompleted),
      initializedAtSec: runtime.initializedAtSec,
      phaseStartedAtSec: runtime.phaseStartedAtSec,
      lastUpdateSec: runtime.lastUpdateSec,
      phaseHistory: Array.isArray(runtime.phaseHistory) ? [...runtime.phaseHistory] : [],
      plannerState: planner.snapshot?.() || null,
      estimate: estimate ? {
        position: { ...estimate.position },
        velocity: { ...estimate.velocity },
        timestampSec: estimate.timestampSec,
        positionSigmaKm: Number.isFinite(Number(estimate.positionSigmaKm))
          ? Number(estimate.positionSigmaKm)
          : null,
        velocitySigmaKmS: Number.isFinite(Number(estimate.velocitySigmaKmS))
          ? Number(estimate.velocitySigmaKmS)
          : null,
      } : null,
      lastCommand: runtime.lastCommand ? {
        ...runtime.lastCommand,
        direction: runtime.lastCommand.direction ? { ...runtime.lastCommand.direction } : null,
      } : null,
    };
  }

  function restore(
    nextSnapshot = null,
    {
      missionIdFallback = runtime.missionId,
      modeFallback = runtime.mode,
      timestampSec = defaultTimestampSec(),
    } = {},
  ) {
    if (!nextSnapshot || typeof nextSnapshot !== "object") {
      return reset({
        missionIdOverride: missionIdFallback,
        modeOverride: modeFallback,
        timestampSec,
      });
    }
    const fallbackTimeSec = Number(timestampSec) || defaultTimestampSec();
    setMode(nextSnapshot.mode ?? modeFallback);
    runtime.missionId = normalizeMissionId(nextSnapshot.missionId ?? missionIdFallback);
    const missionPhaseRaw = String(nextSnapshot.missionPhase || "").trim();
    runtime.missionPhase = missionPhaseRaw || missionDefaultPhase(runtime.missionId);
    runtime.missionCompleted = Boolean(nextSnapshot.missionCompleted);
    runtime.initializedAtSec = Number.isFinite(Number(nextSnapshot.initializedAtSec))
      ? Number(nextSnapshot.initializedAtSec)
      : fallbackTimeSec;
    runtime.phaseStartedAtSec = Number.isFinite(Number(nextSnapshot.phaseStartedAtSec))
      ? Number(nextSnapshot.phaseStartedAtSec)
      : runtime.initializedAtSec;
    runtime.lastUpdateSec = Number.isFinite(Number(nextSnapshot.lastUpdateSec))
      ? Number(nextSnapshot.lastUpdateSec)
      : runtime.phaseStartedAtSec;
    runtime.phaseHistory = Array.isArray(nextSnapshot.phaseHistory)
      ? nextSnapshot.phaseHistory.map((entry) => ({
        atSec: Number(entry?.atSec) || runtime.lastUpdateSec,
        from: String(entry?.from || ""),
        to: String(entry?.to || ""),
        reason: String(entry?.reason || ""),
      }))
      : [];
    runtime.lastCommand = nextSnapshot.lastCommand && typeof nextSnapshot.lastCommand === "object"
      ? {
        ...nextSnapshot.lastCommand,
        direction: nextSnapshot.lastCommand.direction
          ? { ...nextSnapshot.lastCommand.direction }
          : null,
      }
      : null;
    planner.restore?.(nextSnapshot.plannerState || null, {
      missionIdFallback: runtime.missionId,
      missionPhaseFallback: runtime.missionPhase,
    });
    estimator.restore(nextSnapshot.estimate || null);
    return snapshot();
  }

  return {
    setMode,
    setMission,
    reset,
    update,
    restore,
    snapshot,
  };
}
