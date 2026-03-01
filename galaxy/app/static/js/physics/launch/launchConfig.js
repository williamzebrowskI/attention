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
  payloadMassKg: 15_000,
  referenceAreaM2: 10.75,
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
      dryMassKg: 25_600,
      propellantMassKg: 395_700,
      thrustSeaLevelN: 7_607_000,
      thrustVacuumN: 8_227_000,
      ispSeaLevelS: 282,
      ispVacuumS: 311,
      coastAfterBurnSec: 2,
    }),
    Object.freeze({
      name: "Stage 2",
      dryMassKg: 4_000,
      propellantMassKg: 92_670,
      thrustVacuumN: 934_000,
      ispVacuumS: 348,
      coastAfterBurnSec: 0,
    }),
  ]),
});

// Visual-only exhaust sizing in physical km (kept true-to-scale, not visibility-scaled).
export const LAUNCH_EXHAUST_VISUAL_CONFIG = Object.freeze({
  plumeSeaLevelLengthKm: 0.022,
  plumeVacuumLengthKm: 0.095,
  plumeSeaLevelRadiusScaleToVehicleRadius: 0.42,
  plumeVacuumRadiusScaleToVehicleRadius: 1.05,
  smokeMaxAltitudeKm: 35,
  trailPointSpacingKm: 0.012,
  smokePointRadiusScaleToVehicleRadius: 0.75,
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
