export const MOON_ORBIT_INJECT_ALTITUDE_KM = 500;

export const MOON_BURN_ATTITUDE_GATE_PHASES = new Set([
  "coast_to_moon",
  "lunar_insertion",
  "tei_burn",
  "earth_capture",
]);

export const MOON_BURN_ATTITUDE_GATE_ENTER_ERROR_DEG = 5;
export const MOON_BURN_ATTITUDE_GATE_EXIT_ERROR_DEG = 2;
export const MOON_BURN_ATTITUDE_GATE_RELEASE_DWELL_SEC = 0.75;
