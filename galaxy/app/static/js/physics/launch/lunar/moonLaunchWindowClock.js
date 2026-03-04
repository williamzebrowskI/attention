import { LAUNCH_MISSION_IDS } from "../launchMissions.js";
import { solveMoonDepartureWindow } from "../../navigation_system/lunar/departureWindowSolver.js";

export const PRIMARY_MOON_WINDOW_REFERENCE_ORBIT_ALTITUDE_KM = 185;

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function clearMoonDepartureWindowClock(runtime) {
  if (!runtime || typeof runtime !== "object") {
    return;
  }
  runtime.moonDepartureWindowScore = null;
  runtime.moonDepartureWindowWaitSec = null;
  runtime.moonDepartureWindowPhaseErrorDeg = null;
  runtime.moonDepartureGeometryScore = null;
  runtime.moonDepartureAlignNow = null;
  runtime.moonDepartureAlignProjected = null;
  runtime.moonEstimatedTliDeltaVKmS = null;
  runtime.moonDepartureWindowReady = false;
  runtime.moonDepartureWindowLaunchTimeMs = null;
}

export function updateMoonDepartureWindowClock({
  runtime,
  missionId,
  nowMs = Date.now(),
  earthState = null,
  moonState = null,
  shipPositionKm = null,
  launchLatitudeDeg = 28.5,
  getEarthMassKg = null,
  getEarthRadiusKm = null,
  gravitationalConstantKm3PerKgS2 = Number.NaN,
  padAngularRateRadS = Number.NaN,
} = {}) {
  if (!runtime || typeof runtime !== "object") {
    return;
  }
  if (missionId !== LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
    clearMoonDepartureWindowClock(runtime);
    return;
  }

  const earthMuKm3S2 = Number(gravitationalConstantKm3PerKgS2)
    * (
      Number(getEarthMassKg?.())
      || Number(earthState?.massKg)
      || 0
    );
  const window = solveMoonDepartureWindow({
    earthState,
    moonState,
    shipPositionKm,
    inclinationDeg: Number(launchLatitudeDeg) || 28.5,
    orbitAltitudeKm: PRIMARY_MOON_WINDOW_REFERENCE_ORBIT_ALTITUDE_KM,
    earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
    earthMuKm3S2,
    padAngularRateRadS: Number(padAngularRateRadS),
  });
  const waitSecRaw = Number(window?.waitSec);
  const waitSec = Number.isFinite(waitSecRaw)
    ? Math.max(0, waitSecRaw)
    : Number.NaN;
  const ready = Boolean(window?.valid) && Boolean(window?.ready);

  runtime.moonDepartureWindowScore = finiteOrNull(window?.windowScore);
  runtime.moonDepartureWindowWaitSec = Number.isFinite(waitSec) ? waitSec : null;
  runtime.moonDepartureWindowPhaseErrorDeg = finiteOrNull(window?.phaseErrorDeg);
  runtime.moonDepartureGeometryScore = finiteOrNull(window?.geometryScore);
  runtime.moonDepartureAlignNow = finiteOrNull(window?.selectedDepartureAlignment);
  runtime.moonDepartureAlignProjected = finiteOrNull(window?.selectedProjectedAlignment);
  runtime.moonEstimatedTliDeltaVKmS = finiteOrNull(window?.estimatedTliDeltaVKmS);
  runtime.moonDepartureWindowReady = ready;
  runtime.moonDepartureWindowLaunchTimeMs = ready
    ? Number(nowMs)
    : (Number.isFinite(waitSec) ? (Number(nowMs) + (waitSec * 1000)) : null);
}
