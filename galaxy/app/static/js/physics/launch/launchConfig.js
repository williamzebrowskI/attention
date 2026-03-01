export const LAUNCH_BODY_ID = "earth_launch_vehicle";

export const STARSHIP_STACK_DIMENSIONS_KM = Object.freeze({
  diameterKm: 0.009,
  boosterHeightKm: 0.071,
  shipHeightKm: 0.0503,
  shipCylinderHeightKm: 0.0335,
  shipNoseHeightKm: 0.0168,
  hotstageRingHeightKm: 0.0016,
});

export const STARSHIP_STACK_TOTAL_HEIGHT_KM =
  STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm
  + STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm;

export const STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM = STARSHIP_STACK_TOTAL_HEIGHT_KM * 0.5;

export const LAUNCH_SITE = Object.freeze({
  name: "Cape Canaveral, FL (SLC-40)",
  latitudeDeg: 28.5618571,
  longitudeDeg: -80.577366,
  altitudeKm: 0.0,
});

export const STANDARD_GRAVITY_M_S2 = 9.80665;
export const EARTH_SIDEREAL_ANGULAR_RATE_RAD_S = 7.2921150e-5;
export const SEA_LEVEL_PRESSURE_PA = 101325;

export const LAUNCH_VEHICLE_CONFIG = Object.freeze({
  name: "Earth Launch Vehicle",
  payloadMassKg: 100_000,
  referenceAreaM2: 63.62,
  dragCoefficient: 0.32,
  guidance: Object.freeze({
    enforceVerticalAscent: true,
    ascentHeadingDegFromEast: 18,
    pitchoverStartSec: 12,
    pitchoverDurationSec: 170,
    progradeBlendStartSec: 95,
    progradeBlendDurationSec: 220,
    maxProgradeBlend: 0.95,
    maxQThrottleStartSec: 58,
    maxQThrottleEndSec: 88,
    maxQThrottleValue: 0.72,
    liftoffThrottleSec: 6,
    liftoffThrottleValue: 0.7,
  }),
  stages: Object.freeze([
    Object.freeze({
      name: "Stage 1",
      dryMassKg: 200_000,
      propellantMassKg: 3_400_000,
      thrustSeaLevelN: 74_000_000,
      thrustVacuumN: 77_000_000,
      ispSeaLevelS: 327,
      ispVacuumS: 350,
      coastAfterBurnSec: 2,
    }),
    Object.freeze({
      name: "Stage 2",
      dryMassKg: 120_000,
      propellantMassKg: 1_200_000,
      thrustSeaLevelN: 10_500_000,
      thrustVacuumN: 13_800_000,
      ispSeaLevelS: 353,
      ispVacuumS: 380,
      coastAfterBurnSec: 0,
    }),
  ]),
});

export const LAUNCH_AUTOPILOT_CONFIG = Object.freeze({
  enabled: true,
  targetOrbitAltitudeKm: 250,
  targetAltitudeToleranceKm: 8,
  verticalAscentMinSeconds: 10,
  verticalAscentMaxAltitudeKm: 2.2,
  gravityTurnEndAltitudeKm: 60,
  insertionCutoffApoapsisMarginKm: 14,
  circularizationIgnitionLeadSeconds: 95,
  circularizationMinAltitudeKm: 140,
  circularizationThrottle: 0.26,
  ascentMaxThrottle: 1.0,
  orbitalHoldMaxPeriapsisErrorKm: 8,
  orbitalHoldMaxApoapsisErrorKm: 14,
});

// Visual-only exhaust sizing in physical km (kept true-to-scale, not visibility-scaled).
export const LAUNCH_EXHAUST_VISUAL_CONFIG = Object.freeze({
  plumeSeaLevelLengthKm: 0.016,
  plumeVacuumLengthKm: 0.064,
  plumeSeaLevelRadiusScaleToVehicleRadius: 0.28,
  plumeVacuumRadiusScaleToVehicleRadius: 0.62,
  smokeMaxAltitudeKm: 35,
  trailPointSpacingKm: 0.018,
  smokePointRadiusScaleToVehicleRadius: 0.48,
  smokeTrailPersistSeconds: 42,
});

export const LAUNCH_INITIAL_MASS_KG = LAUNCH_VEHICLE_CONFIG.stages.reduce(
  (mass, stage) => mass + stage.dryMassKg + stage.propellantMassKg,
  LAUNCH_VEHICLE_CONFIG.payloadMassKg,
);

export const LAUNCH_BODY_META = Object.freeze({
  id: LAUNCH_BODY_ID,
  name: "Earth Launch Vehicle",
  body_type: "spacecraft",
  parent: "earth",
  radius_km: STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 0.5,
  mass_kg: LAUNCH_INITIAL_MASS_KG,
  semimajor_axis_km: null,
  orbital_period_days: null,
  phase: 0,
  description: "Two-stage launch vehicle driven by onboard thrust, staging, and guidance.",
});
