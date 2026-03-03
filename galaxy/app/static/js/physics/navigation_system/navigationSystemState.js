import {
  missionDefaultPhase,
  normalizeMissionId,
} from "./navigationMissionProfiles.js";
import {
  NAVIGATION_DEFAULTS,
  normalizeNavigationMode,
} from "./navigationSystemConfig.js";

function nowSeconds() {
  return Date.now() / 1000;
}

export function createNavigationSystemState({
  missionId,
  mode = NAVIGATION_DEFAULTS.mode,
  timestampSec = nowSeconds(),
} = {}) {
  const normalizedMissionId = normalizeMissionId(missionId);
  return {
    mode: normalizeNavigationMode(mode),
    missionId: normalizedMissionId,
    missionPhase: missionDefaultPhase(normalizedMissionId),
    missionCompleted: false,
    initializedAtSec: Number(timestampSec) || nowSeconds(),
    phaseStartedAtSec: Number(timestampSec) || nowSeconds(),
    lastUpdateSec: Number(timestampSec) || nowSeconds(),
    lastCommand: null,
    phaseHistory: [],
  };
}

export function transitionMissionPhase(state, nextPhase, timestampSec = nowSeconds(), reason = "") {
  const phaseName = String(nextPhase || "").trim();
  if (!state || !phaseName || state.missionPhase === phaseName) {
    return state;
  }
  state.phaseHistory = Array.isArray(state.phaseHistory) ? state.phaseHistory : [];
  state.phaseHistory.push({
    atSec: Number(timestampSec) || nowSeconds(),
    from: String(state.missionPhase || ""),
    to: phaseName,
    reason: String(reason || ""),
  });
  state.missionPhase = phaseName;
  state.phaseStartedAtSec = Number(timestampSec) || nowSeconds();
  return state;
}
