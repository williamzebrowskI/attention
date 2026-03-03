import { clamp } from "./navigationMath.js";

export const NAVIGATION_MISSION_IDS = Object.freeze({
  EARTH_ORBIT_HOLD: "earth_orbit_hold",
  MOON_ORBIT_RETURN: "moon_orbit_return",
});

export const NAVIGATION_MISSION_PHASES = Object.freeze({
  LAUNCH_TO_PARKING: "launch_to_parking",
  ORBITAL_REFUEL: "orbital_refuel",
  TLI_BURN: "tli_burn",
  COAST_TO_MOON: "coast_to_moon",
  LUNAR_INSERTION: "lunar_insertion",
  LUNAR_ORBIT_HOLD: "lunar_orbit_hold",
  TEI_BURN: "tei_burn",
  COAST_TO_EARTH: "coast_to_earth",
  EARTH_CAPTURE: "earth_capture",
  EARTH_ORBIT_HOLD: "earth_orbit_hold",
});

export const DEFAULT_MOON_MISSION_PROFILE = Object.freeze({
  parkingOrbitPeriapsisMinKm: 150,
  parkingOrbitApoapsisMinKm: 180,
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
    return NAVIGATION_MISSION_PHASES.LAUNCH_TO_PARKING;
  }
  return NAVIGATION_MISSION_PHASES.EARTH_ORBIT_HOLD;
}

export function normalizeFillFraction(value, fallback = DEFAULT_MOON_MISSION_PROFILE.refuelTargetFillFraction) {
  return clamp(
    Number.isFinite(Number(value)) ? Number(value) : Number(fallback),
    0.25,
    1,
  );
}
