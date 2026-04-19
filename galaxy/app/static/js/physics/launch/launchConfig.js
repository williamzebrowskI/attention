export const LAUNCH_BODY_ID = "earth_launch_vehicle";
export const LAUNCH_BOOSTER_BODY_ID = "earth_launch_booster";
export const LAUNCH_REFUEL_TANKER_BODY_IDS = Object.freeze([
  "earth_refuel_tanker_1",
  "earth_refuel_tanker_2",
  "earth_refuel_tanker_3",
  "earth_refuel_tanker_4",
  "earth_refuel_tanker_5",
  "earth_refuel_tanker_6",
]);

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
export const BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM = STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm * 0.5;

const DEFAULT_LAUNCH_SITE = Object.freeze({
  name: "Cape Canaveral, FL (SLC-40)",
  latitudeDeg: 28.5618571,
  longitudeDeg: -80.577366,
  altitudeKm: 0.0,
});
export let LAUNCH_SITE = { ...DEFAULT_LAUNCH_SITE };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLongitudeDeg(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_LAUNCH_SITE.longitudeDeg;
  }
  let lon = value % 360;
  if (lon > 180) {
    lon -= 360;
  } else if (lon < -180) {
    lon += 360;
  }
  return lon;
}

export function setLaunchSite(nextSite = {}) {
  const latRaw = Number(nextSite.latitudeDeg ?? nextSite.latitude_deg);
  const lonRaw = Number(nextSite.longitudeDeg ?? nextSite.longitude_deg);
  const altRaw = Number(nextSite.altitudeKm ?? nextSite.altitude_km);
  const nextName = String(nextSite.name || "").trim();

  const latitudeDeg = Number.isFinite(latRaw)
    ? clamp(latRaw, -90, 90)
    : LAUNCH_SITE.latitudeDeg;
  const longitudeDeg = Number.isFinite(lonRaw)
    ? normalizeLongitudeDeg(lonRaw)
    : LAUNCH_SITE.longitudeDeg;
  const altitudeKm = Number.isFinite(altRaw)
    ? clamp(altRaw, -1, 20)
    : LAUNCH_SITE.altitudeKm;

  LAUNCH_SITE = {
    name: nextName || LAUNCH_SITE.name || DEFAULT_LAUNCH_SITE.name,
    latitudeDeg,
    longitudeDeg,
    altitudeKm,
  };
  return LAUNCH_SITE;
}

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
    maxQThrottleStartSec: 54,
    maxQThrottleEndSec: 98,
    maxQThrottleValue: 0.62,
    maxQTargetPa: 28_000,
    maxQControlStartRatio: 0.6,
    maxQThrottleFloor: 0.50,
    maxQThrottleGain: 1.08,
    maxThrustAccelerationGsStage1: 2.65,
    maxThrustAccelerationGsStage2: 3.2,
    verticalHoldSeconds: 26,
    verticalHoldMaxAltitudeKm: 12,
    verticalHoldMaxLateralSpeedKmS: 0.015,
    verticalHoldCorrectionGain: 0.85,
    verticalHoldMaxTiltDeg: 7.0,
    boosterLandingReservePropellantKg: 320_000,
    // Starship-style hot staging is expected high in the atmosphere, roughly around
    // the 3-minute mark and near the 70 km band. Keep this as an explicit realism
    // envelope so the launch profile does not silently drift away from that regime.
    hotstageNominalElapsedSec: 185,
    hotstageMinElapsedSec: 165,
    hotstageMaxElapsedSec: 205,
    hotstageNominalAltitudeKm: 70,
    hotstageMinAltitudeKm: 60,
    hotstageMaxAltitudeKm: 85,
    hotstageNominalSpeedKmS: 1.9,
    hotstageMinSpeedKmS: 1.6,
    hotstageMaxSpeedKmS: 2.4,
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
      thrustSeaLevelN: 6_900_000,
      thrustVacuumN: 15_600_000,
      ispSeaLevelS: 353,
      ispVacuumS: 380,
      coastAfterBurnSec: 0,
    }),
  ]),
});

export const LAUNCH_BOOSTER_CONFIG = Object.freeze({
  name: "Super Heavy Booster",
  dryMassKg: 200_000,
  referenceAreaM2: 78,
  dragCoefficient: 0.42,
  thrustSeaLevelN: 19_000_000,
  thrustVacuumN: 20_500_000,
  ispSeaLevelS: 327,
  ispVacuumS: 350,
  // Approximate aggregate propellant flow for attitude-control jets at full authority.
  rcsPropellantFlowKgS: 6.5,
});

export const LAUNCH_AUTOPILOT_CONFIG = Object.freeze({
  enabled: true,
  targetOrbitAltitudeKm: 250,
  targetAltitudeToleranceKm: 8,
  verticalAscentMaxAltitudeKm: 1.4,
  pitchKickStartAltitudeKm: 0.12,
  pitchKickEndAltitudeKm: 4.5,
  pitchKickMaxDeg: 13.0,
  progradeTrackMinAirSpeedKmS: 0.12,
  ascentAoALimitDeg: 7.5,
  maxQAoALimitDeg: 4.5,
  maxQAoALimitStartRatio: 0.55,
  gravityTurnEndAltitudeKm: 24,
  insertionCutoffApoapsisMarginKm: 14,
  circularizationIgnitionLeadSeconds: 25,
  circularizationMinAltitudeKm: 140,
  circularizationThrottle: 0.44,
  ascentMaxThrottle: 1.0,
  ascentCoastMinAltitudeKm: 105,
  ascentClimbGuardAltitudeKm: 58,
  ascentClimbRecoverRadialSpeedKmS: -0.015,
  ascentClimbThrottleFloor: 0.95,
  ascentClimbUpWeightMin: 0.08,
  ascentClimbUpWeightMax: 0.32,
  orbitalHoldMaxPeriapsisErrorKm: 8,
  orbitalHoldMaxApoapsisErrorKm: 14,
});

export const LAUNCH_RCS_CONFIG = Object.freeze({
  enabled: true,
  minStageIndex: 1,
  deadbandDeg: 0.8,
  fullAuthorityDeg: 10.0,
  moonCoastFullAuthorityDeg: 18.0,
  moonCoastTurnRateDegS: 3.0,
  maxAccelerationKmS2: 0.00004,
  minReferenceSpeedKmS: 0.05,
});

export const LAUNCH_MOON_COAST_TRIM_CONFIG = Object.freeze({
  enabled: true,
  alignThresholdDeg: 6.0,
  pulseThrottle: 0.01,
  pulseDurationSec: 3.0,
  cooldownSec: 900.0,
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

export const LAUNCH_BOOSTER_META = Object.freeze({
  id: LAUNCH_BOOSTER_BODY_ID,
  name: "Super Heavy Booster",
  body_type: "spacecraft",
  parent: "earth",
  radius_km: STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 0.5,
  mass_kg: LAUNCH_BOOSTER_CONFIG.dryMassKg + (Number(LAUNCH_VEHICLE_CONFIG.guidance.boosterLandingReservePropellantKg) || 0),
  semimajor_axis_km: null,
  orbital_period_days: null,
  phase: 0,
  description: "Separated first stage booster with controlled atmospheric reentry and landing burn.",
});

export const LAUNCH_REFUEL_TANKER_METAS = Object.freeze(
  LAUNCH_REFUEL_TANKER_BODY_IDS.map((id, index) => Object.freeze({
    id,
    name: `Starship Tanker ${index + 1}`,
    body_type: "spacecraft",
    parent: "earth",
    radius_km: STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 0.5,
    mass_kg: (Number(LAUNCH_VEHICLE_CONFIG.stages?.[1]?.dryMassKg) || 120_000) + 220_000,
    semimajor_axis_km: null,
    orbital_period_days: null,
    phase: 0,
    description: "Reusable orbital tanker Starship used for in-space propellant transfer.",
  })),
);
