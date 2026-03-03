export const NAVIGATION_SYSTEM_MODES = Object.freeze({
  RULE_BASED_BASELINE: "rule_based_baseline",
  PREDICTIVE_OPTIMIZER: "predictive_optimizer",
});

export const NAVIGATION_DEFAULTS = Object.freeze({
  mode: NAVIGATION_SYSTEM_MODES.RULE_BASED_BASELINE,
  estimator: Object.freeze({
    positionBlend: 0.35,
    velocityBlend: 0.45,
    measurementPositionSigmaKm: 0.2,
    measurementVelocitySigmaKmS: 0.0002,
    processPositionSigmaKmPerSec: 0.00005,
    processVelocitySigmaKmSPerSec: 0.000004,
  }),
  planner: Object.freeze({
    maxThrottle: 1.0,
    minThrottle: 0.0,
    moonApproachDistanceKm: 120_000,
    moonCaptureGateDistanceKm: 55_000,
    moonCaptureTargetAltitudeKm: 120,
    moonCaptureUpperAltitudeKm: 16_000,
    moonMidcourseMinClosingSpeedKmS: 0.02,
    moonMidcourseClosingWindowKmS: 0.18,
    moonMidcourseMissDistanceKm: 95_000,
    moonMidcoursePredictHorizonSec: 36 * 3600,
    moonMidcourseThrottleBase: 0.06,
    moonMidcourseThrottleMax: 0.3,
    moonMidcourseMinBurnSec: 24,
    moonMidcourseExitStableSec: 28,
    moonMidcoursePulsePeriodSec: 240,
    moonMidcoursePulseBurnSec: 18,
    moonMidcourseContinuousRiskThreshold: 0.86,
    moonMidcourseSpeedBrakeThresholdKmS: 1.1,
    moonMidcourseSpeedBrakeThrottleMax: 0.22,
    moonMidcoursePredictiveHorizonSec: 1_800,
    moonMidcoursePredictiveBurnSec: 18,
    moonMidcoursePredictiveSteps: 36,
    moonMidcourseAccelAtThrottle1KmS2: 0.0065,
    moonRetargetCadenceSec: 180,
    moonRetargetForceCadenceSec: 420,
    moonRetargetMinTimeToClosestSec: 1_200,
    moonTargetPeriluneAltitudeKm: 120,
    moonTargetPeriluneToleranceKm: 80,
    moonBPlaneToleranceKm: 6_000,
    moonMidcourseCooldownSec: 12,
    moonMidcourseLateralGain: 0.35,
    moonMidcourseTangentialGain: 0.22,
    moonMidcourseVerticalGain: 0.12,
    tliPeriapsisProtectMinKm: 130,
    tliPeriapsisRecoverTargetKm: 155,
    tliPeriapsisProtectThrottleMin: 0.16,
    tliPeriapsisProtectThrottleMax: 0.6,
    tliPeriapsisProtectUpBias: 0.24,
    earthFallbackRadialSpeedKmS: -0.01,
    sensorTimeConstantSec: 24,
  }),
});

export function normalizeNavigationMode(mode) {
  const value = String(mode || "").trim().toLowerCase();
  if (value === NAVIGATION_SYSTEM_MODES.PREDICTIVE_OPTIMIZER) {
    return NAVIGATION_SYSTEM_MODES.PREDICTIVE_OPTIMIZER;
  }
  return NAVIGATION_SYSTEM_MODES.RULE_BASED_BASELINE;
}
