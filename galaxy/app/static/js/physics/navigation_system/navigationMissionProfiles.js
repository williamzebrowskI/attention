import { clamp } from "./navigationMath.js";
import {
  MOON_PARKING_ORBIT_APOAPSIS_KM,
  MOON_PARKING_ORBIT_PERIAPSIS_KM,
} from "../launch/lunar/constants.js";

export const NAVIGATION_MISSION_IDS = Object.freeze({
  EARTH_ORBIT_HOLD: "earth_orbit_hold",
  MOON_ORBIT_RETURN: "moon_orbit_return",
});

export const NAVIGATION_MISSION_PHASES = Object.freeze({
  LAUNCH: "launch",
  PARKING_ORBIT: "parking_orbit",
  DEPARTURE_WINDOW_WAIT: "departure_window_wait",
  TLI_BURN: "tli_burn",
  MIDCOURSE: "midcourse",
  LUNAR_ORBIT_INSERTION: "lunar_orbit_insertion",
  LUNAR_ORBIT_TRIM: "lunar_orbit_trim",
  LUNAR_LOITER: "lunar_loiter",
  TEI_BURN: "tei_burn",
  EARTH_APPROACH: "earth_approach",
  EARTH_CAPTURE: "earth_capture",
  EARTH_ORBIT_HOLD: "earth_orbit_hold",
});

export const LEGACY_MOON_MISSION_PHASES = Object.freeze({
  LAUNCH_TO_PARKING: "launch_to_parking",
  ORBITAL_REFUEL: "orbital_refuel",
  TLI_BURN: "tli_burn",
  COAST_TO_MOON: "coast_to_moon",
  LUNAR_INSERTION: "lunar_insertion",
  LUNAR_CAPTURE: "lunar_capture",
  LUNAR_ORBIT_HOLD: "lunar_orbit_hold",
  TEI_BURN: "tei_burn",
  COAST_TO_EARTH: "coast_to_earth",
  EARTH_CAPTURE: "earth_capture",
  EARTH_ORBIT_HOLD: "earth_orbit_hold",
});

export const DEFAULT_MOON_MISSION_PROFILE = Object.freeze({
  parkingOrbitPeriapsisMinKm: MOON_PARKING_ORBIT_PERIAPSIS_KM,
  parkingOrbitApoapsisMinKm: MOON_PARKING_ORBIT_APOAPSIS_KM,
  parkingCoastMinDurationSec: 15,
  refuelTargetFillFraction: 0.88,
  tliTargetApoapsisKm: 382_000,
  tliApoapsisMarginKm: 3_000,
  tliMinSpecificEnergyKm2S2: -0.28,
  tliPeriapsisMinKm: 130,
  tliInterceptMissDistanceKm: 140_000,
  midcourseMinClosingSpeedKmS: 0.02,
  moonApproachDistanceKm: 120_000,
  lunarInsertionAltitudeGateKm: 16_000,
  lunarOrbitApoapsisMaxKm: 14_000,
  lunarOrbitPeriapsisMinKm: 45,
  lunarHoldDurationSec: 2 * 3600,
  teiDepartureDistanceKm: 140_000,
  earthCaptureDistanceKm: 180_000,
  earthCaptureApoapsisMaxKm: 75_000,
  earthCapturePeriapsisMinKm: 120,
});

export function normalizeMissionId(missionId) {
  const value = String(missionId || "").trim().toLowerCase();
  if (value === NAVIGATION_MISSION_IDS.MOON_ORBIT_RETURN) {
    return NAVIGATION_MISSION_IDS.MOON_ORBIT_RETURN;
  }
  return NAVIGATION_MISSION_IDS.EARTH_ORBIT_HOLD;
}

export function missionDefaultPhase(missionId) {
  const normalized = normalizeMissionId(missionId);
  if (normalized === NAVIGATION_MISSION_IDS.MOON_ORBIT_RETURN) {
    return NAVIGATION_MISSION_PHASES.LAUNCH;
  }
  return NAVIGATION_MISSION_PHASES.EARTH_ORBIT_HOLD;
}

export function normalizeMissionPhase(phase, missionId = NAVIGATION_MISSION_IDS.EARTH_ORBIT_HOLD) {
  const normalizedMissionId = normalizeMissionId(missionId);
  const key = String(phase || "").trim().toLowerCase();
  if (!key) {
    return missionDefaultPhase(normalizedMissionId);
  }
  if (normalizedMissionId !== NAVIGATION_MISSION_IDS.MOON_ORBIT_RETURN) {
    return key;
  }
  const moonPhaseMap = {
    launch: NAVIGATION_MISSION_PHASES.LAUNCH,
    launch_to_parking: NAVIGATION_MISSION_PHASES.LAUNCH,
    parking_orbit: NAVIGATION_MISSION_PHASES.PARKING_ORBIT,
    departure_window_wait: NAVIGATION_MISSION_PHASES.DEPARTURE_WINDOW_WAIT,
    orbital_refuel: NAVIGATION_MISSION_PHASES.DEPARTURE_WINDOW_WAIT,
    tli_burn: NAVIGATION_MISSION_PHASES.TLI_BURN,
    midcourse: NAVIGATION_MISSION_PHASES.MIDCOURSE,
    coast_to_moon: NAVIGATION_MISSION_PHASES.MIDCOURSE,
    lunar_orbit_insertion: NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_INSERTION,
    lunar_insertion: NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_INSERTION,
    lunar_capture: NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_INSERTION,
    lunar_orbit_trim: NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_TRIM,
    lunar_loiter: NAVIGATION_MISSION_PHASES.LUNAR_LOITER,
    lunar_orbit_hold: NAVIGATION_MISSION_PHASES.LUNAR_LOITER,
    tei_burn: NAVIGATION_MISSION_PHASES.TEI_BURN,
    earth_approach: NAVIGATION_MISSION_PHASES.EARTH_APPROACH,
    coast_to_earth: NAVIGATION_MISSION_PHASES.EARTH_APPROACH,
    earth_capture: NAVIGATION_MISSION_PHASES.EARTH_CAPTURE,
    earth_orbit_hold: NAVIGATION_MISSION_PHASES.EARTH_ORBIT_HOLD,
  };
  return moonPhaseMap[key] || key;
}

export function legacyMoonMissionPhase(phase) {
  const normalized = normalizeMissionPhase(phase, NAVIGATION_MISSION_IDS.MOON_ORBIT_RETURN);
  switch (normalized) {
    case NAVIGATION_MISSION_PHASES.LAUNCH:
    case NAVIGATION_MISSION_PHASES.PARKING_ORBIT:
      return LEGACY_MOON_MISSION_PHASES.LAUNCH_TO_PARKING;
    case NAVIGATION_MISSION_PHASES.DEPARTURE_WINDOW_WAIT:
      return LEGACY_MOON_MISSION_PHASES.ORBITAL_REFUEL;
    case NAVIGATION_MISSION_PHASES.TLI_BURN:
      return LEGACY_MOON_MISSION_PHASES.TLI_BURN;
    case NAVIGATION_MISSION_PHASES.MIDCOURSE:
      return LEGACY_MOON_MISSION_PHASES.COAST_TO_MOON;
    case NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_INSERTION:
    case NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_TRIM:
      return LEGACY_MOON_MISSION_PHASES.LUNAR_INSERTION;
    case NAVIGATION_MISSION_PHASES.LUNAR_LOITER:
      return LEGACY_MOON_MISSION_PHASES.LUNAR_ORBIT_HOLD;
    case NAVIGATION_MISSION_PHASES.TEI_BURN:
      return LEGACY_MOON_MISSION_PHASES.TEI_BURN;
    case NAVIGATION_MISSION_PHASES.EARTH_APPROACH:
      return LEGACY_MOON_MISSION_PHASES.COAST_TO_EARTH;
    case NAVIGATION_MISSION_PHASES.EARTH_CAPTURE:
      return LEGACY_MOON_MISSION_PHASES.EARTH_CAPTURE;
    case NAVIGATION_MISSION_PHASES.EARTH_ORBIT_HOLD:
      return LEGACY_MOON_MISSION_PHASES.EARTH_ORBIT_HOLD;
    default:
      return normalized;
  }
}

export function displayMissionPhase(phase, missionId = NAVIGATION_MISSION_IDS.EARTH_ORBIT_HOLD) {
  return normalizeMissionPhase(phase, missionId);
}

export function normalizeFillFraction(value, fallback = DEFAULT_MOON_MISSION_PROFILE.refuelTargetFillFraction) {
  return clamp(
    Number.isFinite(Number(value)) ? Number(value) : Number(fallback),
    0.25,
    1,
  );
}
