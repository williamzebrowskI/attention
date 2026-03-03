export const NAVIGATION_SYSTEM_MODES = Object.freeze({
  RULE_BASED_BASELINE: "rule_based_baseline",
  PREDICTIVE_OPTIMIZER: "predictive_optimizer",
});

export const NAVIGATION_DEFAULTS = Object.freeze({
  mode: NAVIGATION_SYSTEM_MODES.RULE_BASED_BASELINE,
  estimator: Object.freeze({
    positionBlend: 0.35,
    velocityBlend: 0.45,
  }),
  planner: Object.freeze({
    maxThrottle: 1.0,
    minThrottle: 0.0,
    moonCaptureTargetAltitudeKm: 120,
    moonCaptureUpperAltitudeKm: 16_000,
  }),
});

export function normalizeNavigationMode(mode) {
  const value = String(mode || "").trim().toLowerCase();
  if (value === NAVIGATION_SYSTEM_MODES.PREDICTIVE_OPTIMIZER) {
    return NAVIGATION_SYSTEM_MODES.PREDICTIVE_OPTIMIZER;
  }
  return NAVIGATION_SYSTEM_MODES.RULE_BASED_BASELINE;
}
