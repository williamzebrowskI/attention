import {
  BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM,
  EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
  LAUNCH_AUTOPILOT_CONFIG,
  LAUNCH_BOOSTER_BODY_ID,
  LAUNCH_BOOSTER_CONFIG,
  LAUNCH_BOOSTER_META,
  LAUNCH_BODY_ID,
  LAUNCH_BODY_META,
  LAUNCH_INITIAL_MASS_KG,
  LAUNCH_RCS_CONFIG,
  LAUNCH_SITE,
  LAUNCH_VEHICLE_CONFIG,
  SEA_LEVEL_PRESSURE_PA,
  STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM,
  STANDARD_GRAVITY_M_S2,
} from "./launchConfig.js";
import { computeBoosterRecoveryCommand } from "./boosterRecovery.js";
import {
  DEFAULT_LAUNCH_MISSION_ID,
  LAUNCH_MISSION_IDS,
  LAUNCH_MISSION_PROFILES,
  missionProfileById,
  normalizeMissionId,
} from "./launchMissions.js";
import {
  applyEarthSurfaceContactForVehicle,
  sampleEarthSurfaceAtRelativePosition,
  terrainHeightKmAtLatLon,
} from "../surface/earthSurfacePhysics.js";

const MIN_ROCKET_MASS_KG = 500;
const EPS = 1e-12;
const TWO_PI = Math.PI * 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rad(degrees) {
  return (degrees * Math.PI) / 180;
}

function length(v) {
  return Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z));
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v, scalar) {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function cross(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function normalize(v, fallback = { x: 0, y: 0, z: 1 }) {
  const mag = length(v);
  if (!(mag > EPS)) {
    return { ...fallback };
  }
  return {
    x: v.x / mag,
    y: v.y / mag,
    z: v.z / mag,
  };
}

function mixVectors(a, b, t) {
  const tt = clamp(t, 0, 1);
  return {
    x: (a.x * (1 - tt)) + (b.x * tt),
    y: (a.y * (1 - tt)) + (b.y * tt),
    z: (a.z * (1 - tt)) + (b.z * tt),
  };
}

function fallbackAxes() {
  return {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    pole: { x: 0, y: 0, z: 1 },
  };
}

function sanitizeAxes(rawAxes) {
  if (!rawAxes) {
    return fallbackAxes();
  }
  const pole = normalize(rawAxes.pole || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const xAxisRaw = normalize(rawAxes.xAxis || { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const yAxisOrtho = normalize(cross(pole, xAxisRaw), { x: 0, y: 1, z: 0 });
  const xAxisOrtho = normalize(cross(yAxisOrtho, pole), { x: 1, y: 0, z: 0 });
  return { xAxis: xAxisOrtho, yAxis: yAxisOrtho, pole };
}

function stageAtIndex(stageIndex) {
  return LAUNCH_VEHICLE_CONFIG.stages[stageIndex] || null;
}

function stageReservePropellantKg(stageIndex) {
  if (stageIndex !== 0) {
    return 0;
  }
  const stage = stageAtIndex(0);
  const configuredReserve = Number(LAUNCH_VEHICLE_CONFIG.guidance?.boosterLandingReservePropellantKg) || 0;
  return clamp(configuredReserve, 0, Number(stage?.propellantMassKg) || configuredReserve);
}

function bodyDirectionFromLatLon(axes, latitudeDeg, longitudeDeg) {
  const lat = rad(latitudeDeg);
  const lon = rad(longitudeDeg);
  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const cosLon = Math.cos(lon);
  const sinLon = Math.sin(lon);

  const localX = cosLat * cosLon;
  const localY = cosLat * sinLon;
  const localZ = sinLat;
  const direction = {
    x: (axes.xAxis.x * localX) + (axes.yAxis.x * localY) + (axes.pole.x * localZ),
    y: (axes.xAxis.y * localX) + (axes.yAxis.y * localY) + (axes.pole.y * localZ),
    z: (axes.xAxis.z * localX) + (axes.yAxis.z * localY) + (axes.pole.z * localZ),
  };
  return normalize(direction);
}

function computePadState({
  earthState,
  earthRadiusKm,
  earthAxes,
  referenceOffsetKm = STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM,
}) {
  if (!earthState?.position) {
    return null;
  }
  const up = bodyDirectionFromLatLon(
    earthAxes,
    LAUNCH_SITE.latitudeDeg,
    LAUNCH_SITE.longitudeDeg,
  );
  const terrainElevationKm = terrainHeightKmAtLatLon(
    LAUNCH_SITE.latitudeDeg,
    LAUNCH_SITE.longitudeDeg,
  );
  const launchRadiusKm =
    earthRadiusKm
    + terrainElevationKm
    + LAUNCH_SITE.altitudeKm
    + Math.max(0, Number(referenceOffsetKm) || 0);
  const relPositionKm = scale(up, launchRadiusKm);
  const angularVelocity = scale(earthAxes.pole, EARTH_SIDEREAL_ANGULAR_RATE_RAD_S);
  const localRotationalVelocityKmS = cross(angularVelocity, relPositionKm);
  return {
    position: add(earthState.position, relPositionKm),
    velocity: add(earthState.velocity || { x: 0, y: 0, z: 0 }, localRotationalVelocityKmS),
  };
}

function pressureRatio(pressurePa) {
  if (!Number.isFinite(pressurePa) || pressurePa <= 0) {
    return 0;
  }
  return clamp(pressurePa / SEA_LEVEL_PRESSURE_PA, 0, 1);
}

function interpolateSeaToVac(vacuumValue, seaLevelValue, pressurePa) {
  const sea = Number.isFinite(seaLevelValue) ? seaLevelValue : vacuumValue;
  return vacuumValue - ((vacuumValue - sea) * pressureRatio(pressurePa));
}

function atmosphereRelativeVelocityKmS(relPos, relVel, earthPole) {
  const pole = normalize(earthPole || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const omega = scale(pole, EARTH_SIDEREAL_ANGULAR_RATE_RAD_S);
  const atmosphereCoRotation = cross(omega, relPos);
  return subtract(relVel, atmosphereCoRotation);
}

function dynamicPressurePaFromAtmosphere(atmosphereSample, relPos, relVel, earthPole) {
  const densityKgM3 = Number(atmosphereSample?.densityKgM3) || 0;
  if (!(densityKgM3 > 0) || !relPos || !relVel) {
    return 0;
  }
  const relAirVelocity = atmosphereRelativeVelocityKmS(relPos, relVel, earthPole);
  const speedKmS = length(relAirVelocity);
  if (!(speedKmS > 1e-12)) {
    return 0;
  }
  return 0.5 * densityKgM3 * Math.pow(speedKmS * 1000, 2);
}

function guidanceDirection({
  rocketState,
  earthState,
  earthAxes,
  elapsedSeconds,
}) {
  const up = normalize(
    subtract(rocketState.position, earthState.position),
    earthAxes.pole,
  );
  if (LAUNCH_VEHICLE_CONFIG.guidance?.enforceVerticalAscent) {
    return {
      direction: up,
      mode: "vertical-ascent",
    };
  }
  const east = normalize(
    cross(earthAxes.pole, up),
    normalize(cross({ x: 0, y: 0, z: 1 }, up), { x: 1, y: 0, z: 0 }),
  );
  const north = normalize(cross(up, east), { x: 0, y: 1, z: 0 });
  const heading = rad(LAUNCH_VEHICLE_CONFIG.guidance.ascentHeadingDegFromEast);
  const headingDirection = normalize(
    add(scale(east, Math.cos(heading)), scale(north, Math.sin(heading))),
    east,
  );

  const pitchover = clamp(
    (elapsedSeconds - LAUNCH_VEHICLE_CONFIG.guidance.pitchoverStartSec)
      / Math.max(LAUNCH_VEHICLE_CONFIG.guidance.pitchoverDurationSec, 1),
    0,
    1,
  );
  let command = normalize(mixVectors(up, headingDirection, pitchover), headingDirection);

  const relVelocity = subtract(
    rocketState.velocity,
    earthState.velocity || { x: 0, y: 0, z: 0 },
  );
  const prograde = normalize(relVelocity, command);
  const progradeBlend = clamp(
    (elapsedSeconds - LAUNCH_VEHICLE_CONFIG.guidance.progradeBlendStartSec)
      / Math.max(LAUNCH_VEHICLE_CONFIG.guidance.progradeBlendDurationSec, 1),
    0,
    LAUNCH_VEHICLE_CONFIG.guidance.maxProgradeBlend,
  );
  command = normalize(mixVectors(command, prograde, progradeBlend), command);

  return {
    direction: command,
    mode: progradeBlend > 0.05 ? "gravity-turn-prograde" : "pitch-program",
  };
}

function normalizeAngleRadians(angle) {
  if (!Number.isFinite(angle)) {
    return 0;
  }
  let normalized = angle % TWO_PI;
  if (normalized < 0) {
    normalized += TWO_PI;
  }
  return normalized;
}

function unitOrNull(v) {
  const mag = length(v);
  if (!(mag > EPS)) {
    return null;
  }
  return { x: v.x / mag, y: v.y / mag, z: v.z / mag };
}

function angleBetweenRadians(a, b) {
  const ua = unitOrNull(a);
  const ub = unitOrNull(b);
  if (!ua || !ub) {
    return 0;
  }
  const cosTheta = clamp(dot(ua, ub), -1, 1);
  return Math.acos(cosTheta);
}

function degrees(valueRad) {
  return (valueRad * 180) / Math.PI;
}

function rcsJetSelection(correctionDir, referenceForward, referenceUp) {
  const jets = [];
  const forward = unitOrNull(referenceForward) || { x: 0, y: 1, z: 0 };
  const up = unitOrNull(referenceUp) || { x: 0, y: 0, z: 1 };
  const right = unitOrNull(cross(forward, up)) || { x: 1, y: 0, z: 0 };
  const vertical = unitOrNull(cross(right, forward)) || up;
  const threshold = 0.2;
  const side = dot(correctionDir, right);
  const verticalComp = dot(correctionDir, vertical);
  const forwardComp = dot(correctionDir, forward);

  if (side > threshold) {
    jets.push("starboard");
  } else if (side < -threshold) {
    jets.push("port");
  }

  if (verticalComp > threshold) {
    jets.push("dorsal");
  } else if (verticalComp < -threshold) {
    jets.push("ventral");
  }

  if (forwardComp > threshold) {
    jets.push("aft");
  } else if (forwardComp < -threshold) {
    jets.push("forward");
  }
  return jets;
}

function computeRcsAssist({
  stageIndex,
  desiredDirection,
  relVel,
  up,
}) {
  if (!LAUNCH_RCS_CONFIG.enabled || stageIndex < LAUNCH_RCS_CONFIG.minStageIndex) {
    return {
      accelerationKmS2: { x: 0, y: 0, z: 0 },
      active: false,
      errorDeg: 0,
      authority: 0,
      jets: [],
    };
  }

  const speedKmS = length(relVel);
  const forward = speedKmS > LAUNCH_RCS_CONFIG.minReferenceSpeedKmS
    ? normalize(relVel, desiredDirection || up || { x: 0, y: 1, z: 0 })
    : normalize(desiredDirection || up || { x: 0, y: 1, z: 0 });
  const desired = normalize(desiredDirection || forward, forward);
  const errorRad = angleBetweenRadians(forward, desired);
  const errorDeg = degrees(errorRad);
  const deadbandDeg = LAUNCH_RCS_CONFIG.deadbandDeg;
  const fullAuthorityDeg = Math.max(deadbandDeg + 0.1, LAUNCH_RCS_CONFIG.fullAuthorityDeg);
  const authority = clamp((errorDeg - deadbandDeg) / (fullAuthorityDeg - deadbandDeg), 0, 1);
  if (!(authority > 0)) {
    return {
      accelerationKmS2: { x: 0, y: 0, z: 0 },
      active: false,
      errorDeg,
      authority: 0,
      jets: [],
    };
  }

  const lateralCorrection = subtract(desired, scale(forward, dot(desired, forward)));
  const correctionDir = unitOrNull(lateralCorrection);
  if (!correctionDir) {
    return {
      accelerationKmS2: { x: 0, y: 0, z: 0 },
      active: false,
      errorDeg,
      authority: 0,
      jets: [],
    };
  }

  const accelerationMagnitude = LAUNCH_RCS_CONFIG.maxAccelerationKmS2 * authority;
  const accelerationKmS2 = scale(correctionDir, accelerationMagnitude);
  return {
    accelerationKmS2,
    active: true,
    errorDeg,
    authority,
    jets: rcsJetSelection(correctionDir, forward, up),
  };
}

function computeBoosterRcsAssist({
  desiredDirection,
  relVel,
  up,
  throttle = 0,
  phase = "",
  guidanceMode = "",
}) {
  const safeUp = normalize(up || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const desired = normalize(desiredDirection || safeUp, safeUp);
  const speedKmS = length(relVel);
  const forward = speedKmS > 0.02
    ? normalize(relVel, desired)
    : desired;
  const errorRad = angleBetweenRadians(forward, desired);
  const errorDeg = degrees(errorRad);
  const errorAuthority = clamp((errorDeg - 0.35) / 15, 0, 1);
  const throttleBlend = clamp(1 - ((Number(throttle) || 0) / 0.45), 0, 1);
  const modeText = `${String(phase || "")} ${String(guidanceMode || "")}`.toLowerCase();
  const maneuveringMode = /(boostback|entry|landing|descent|separation|ballistic|coast)/.test(modeText);
  const phaseAuthorityFloor = maneuveringMode
    ? (0.08 + (0.24 * throttleBlend))
    : 0;
  const authority = Math.max(errorAuthority, phaseAuthorityFloor);
  if (!(authority > 0.01)) {
    return {
      active: false,
      errorDeg,
      authority: 0,
      jets: [],
    };
  }

  const lateralCorrection = subtract(desired, scale(forward, dot(desired, forward)));
  let correctionDir = unitOrNull(lateralCorrection);
  if (!correctionDir && maneuveringMode) {
    correctionDir = unitOrNull(cross(forward, safeUp)) || safeUp;
  }
  if (!correctionDir) {
    return {
      active: false,
      errorDeg,
      authority: 0,
      jets: [],
    };
  }
  const jets = Array.from(
    new Set(rcsJetSelection(correctionDir, forward, safeUp)),
  );
  return {
    active: jets.length > 0 && authority > 0.02,
    errorDeg,
    authority,
    jets,
  };
}

function boosterRcsPropellantBurnRateKgS(rcsAssist) {
  if (!rcsAssist?.active) {
    return 0;
  }
  const authority = clamp(Number(rcsAssist.authority) || 0, 0, 1);
  if (!(authority > 1e-6)) {
    return 0;
  }
  const jetCount = Array.isArray(rcsAssist.jets) ? rcsAssist.jets.length : 0;
  if (!(jetCount > 0)) {
    return 0;
  }
  const normalizedJetUtilization = clamp(jetCount / 6, 0.12, 1);
  const configuredFlow = Number(LAUNCH_BOOSTER_CONFIG.rcsPropellantFlowKgS) || 0;
  if (!(configuredFlow > 0)) {
    return 0;
  }
  return configuredFlow * authority * normalizedJetUtilization;
}

function circularOrbitSpeedKmS(muKm3S2, radiusKm) {
  if (!(muKm3S2 > 0) || !(radiusKm > 0)) {
    return 0;
  }
  return Math.sqrt(muKm3S2 / radiusKm);
}

function computeLaunchPlaneNormal(earthAxes) {
  const up = bodyDirectionFromLatLon(
    earthAxes,
    LAUNCH_SITE.latitudeDeg,
    LAUNCH_SITE.longitudeDeg,
  );
  const east = normalize(
    cross(earthAxes.pole, up),
    normalize(cross({ x: 0, y: 0, z: 1 }, up), { x: 1, y: 0, z: 0 }),
  );
  const north = normalize(cross(up, east), { x: 0, y: 1, z: 0 });
  const heading = rad(LAUNCH_VEHICLE_CONFIG.guidance.ascentHeadingDegFromEast);
  const headingDirection = normalize(
    add(scale(east, Math.cos(heading)), scale(north, Math.sin(heading))),
    east,
  );
  return normalize(cross(up, headingDirection), cross(up, east));
}

function orbitalStateFromRelative(muKm3S2, earthRadiusKm, relPos, relVel) {
  const radiusKm = length(relPos);
  const speedKmS = length(relVel);
  const altitudeKm = radiusKm - earthRadiusKm;
  const up = normalize(relPos, { x: 0, y: 0, z: 1 });
  const radialSpeedKmS = dot(relVel, up);
  const tangentialVector = subtract(relVel, scale(up, radialSpeedKmS));
  const tangentialSpeedKmS = length(tangentialVector);
  const circularSpeedKmS = circularOrbitSpeedKmS(muKm3S2, radiusKm);
  const specificEnergy = (radiusKm > 0)
    ? (0.5 * speedKmS * speedKmS) - (muKm3S2 / radiusKm)
    : Number.NaN;
  const hVector = cross(relPos, relVel);
  const h = length(hVector);

  let semimajorKm = Number.NaN;
  let eccentricity = Number.NaN;
  let apoapsisKm = Number.NaN;
  let periapsisKm = Number.NaN;
  let timeToApoapsisSec = Number.NaN;

  if (muKm3S2 > 0 && radiusKm > 0 && h > 0) {
    if (specificEnergy < 0) {
      semimajorKm = -muKm3S2 / (2 * specificEnergy);
      eccentricity = Math.sqrt(
        Math.max(0, 1 + ((2 * specificEnergy * h * h) / (muKm3S2 * muKm3S2))),
      );
      apoapsisKm = (semimajorKm * (1 + eccentricity)) - earthRadiusKm;
      periapsisKm = (semimajorKm * (1 - eccentricity)) - earthRadiusKm;
      if (eccentricity > 1e-8 && eccentricity < 0.99999 && semimajorKm > 0) {
        const sqrtMuA = Math.sqrt(muKm3S2 * semimajorKm);
        const cosE = clamp((1 - (radiusKm / semimajorKm)) / eccentricity, -1, 1);
        const sinE = clamp(dot(relPos, relVel) / (eccentricity * sqrtMuA), -1, 1);
        const E = Math.atan2(sinE, cosE);
        const M = E - (eccentricity * Math.sin(E));
        const meanMotion = Math.sqrt(muKm3S2 / (semimajorKm * semimajorKm * semimajorKm));
        if (meanMotion > 0) {
          const targetM = Math.PI;
          const deltaM = normalizeAngleRadians(targetM - M);
          timeToApoapsisSec = deltaM / meanMotion;
        }
      }
    }
  }

  return {
    radiusKm,
    altitudeKm,
    speedKmS,
    radialSpeedKmS,
    tangentialSpeedKmS,
    tangentialVector,
    circularSpeedKmS,
    specificEnergy,
    semimajorKm,
    eccentricity,
    apoapsisKm,
    periapsisKm,
    timeToApoapsisSec,
    up,
    hVector,
  };
}

function autopilotDirectionInTargetPlane(relVel, up, planeNormal, earthPole) {
  let tangent = normalize(
    cross(planeNormal, up),
    normalize(cross(up, earthPole), normalize(relVel, up)),
  );
  if (dot(tangent, relVel) < 0) {
    tangent = scale(tangent, -1);
  }
  return tangent;
}

function orbitInsertionWithinTolerance(orbital, config, targetAltitudeKm) {
  if (!orbital || !config) {
    return false;
  }
  const periapsisKm = Number(orbital.periapsisKm);
  const apoapsisKm = Number(orbital.apoapsisKm);
  if (!Number.isFinite(periapsisKm) || !Number.isFinite(apoapsisKm)) {
    return false;
  }
  if (!(Number(orbital.specificEnergy) < 0)) {
    return false;
  }
  const periTolKm = Math.max(0, Number(config.orbitalHoldMaxPeriapsisErrorKm) || 0);
  const apoTolKm = Math.max(0, Number(config.orbitalHoldMaxApoapsisErrorKm) || 0);
  const periErrorKm = Math.abs(targetAltitudeKm - periapsisKm);
  const apoErrorKm = Math.abs(targetAltitudeKm - apoapsisKm);
  return periErrorKm <= periTolKm && apoErrorKm <= apoTolKm;
}

function applyVerticalHoldSteering({
  baseDirection,
  relPos,
  relVel,
  earthPole,
  altitudeKm,
  elapsedSeconds,
}) {
  const guidance = LAUNCH_VEHICLE_CONFIG.guidance || {};
  const holdSeconds = Math.max(0, Number(guidance.verticalHoldSeconds) || 0);
  const holdAltitudeKm = Math.max(0, Number(guidance.verticalHoldMaxAltitudeKm) || 0);
  const holdActive =
    (holdSeconds > 0 && elapsedSeconds < holdSeconds)
    || (holdAltitudeKm > 0 && altitudeKm < holdAltitudeKm);
  if (!holdActive) {
    return {
      direction: normalize(baseDirection, normalize(relPos)),
      active: false,
    };
  }

  const up = normalize(relPos, normalize(baseDirection, { x: 0, y: 0, z: 1 }));
  const relAir = atmosphereRelativeVelocityKmS(relPos, relVel, earthPole);
  const radialAirKmS = dot(relAir, up);
  const lateralAir = subtract(relAir, scale(up, radialAirKmS));
  const lateralSpeedKmS = length(lateralAir);
  const maxLateralSpeedKmS = Math.max(0, Number(guidance.verticalHoldMaxLateralSpeedKmS) || 0);

  if (!(lateralSpeedKmS > maxLateralSpeedKmS + 1e-9)) {
    return {
      direction: up,
      active: true,
    };
  }

  const lateralDir = normalize(lateralAir, { x: 0, y: 0, z: 0 });
  const gain = clamp(Number(guidance.verticalHoldCorrectionGain) || 0.85, 0, 3);
  const maxTiltRad = rad(clamp(Number(guidance.verticalHoldMaxTiltDeg) || 7, 0, 20));
  const overSpeedRatio = clamp(
    (lateralSpeedKmS - maxLateralSpeedKmS) / Math.max(maxLateralSpeedKmS, 1e-6),
    0,
    3,
  );
  const correctionWeight = Math.min(Math.tan(maxTiltRad), overSpeedRatio * gain * 0.35);
  const corrected = normalize(
    add(up, scale(lateralDir, -correctionWeight)),
    up,
  );
  return {
    direction: corrected,
    active: true,
  };
}

function computeAutopilotCommand({
  runtime,
  orbital,
  relPos,
  dynamicPressurePa,
  relVel,
  up,
  earthPole,
  muKm3S2,
  earthRadiusKm,
}) {
  const config = LAUNCH_AUTOPILOT_CONFIG;
  const targetAltitudeKm = Number(runtime?.targetOrbitAltitudeKm) || config.targetOrbitAltitudeKm;
  const targetAltitudeSafe = Math.max(targetAltitudeKm, 1);
  const apoapsisKm = Number(orbital.apoapsisKm);
  const periapsisKm = Number(orbital.periapsisKm);
  const apoDefined = Number.isFinite(apoapsisKm);
  const periDefined = Number.isFinite(periapsisKm);
  const radialSpeedKmS = Number(orbital.radialSpeedKmS) || 0;
  const circularSpeedKmS = Number(orbital.circularSpeedKmS) || 0;
  const tangentialSpeedKmS = Number(orbital.tangentialSpeedKmS) || 0;
  const targetRadiusKm = Math.max(1, earthRadiusKm + targetAltitudeKm);
  const targetCircularSpeedKmS = circularOrbitSpeedKmS(muKm3S2, targetRadiusKm);
  const stableTargetOrbit = orbitInsertionWithinTolerance(orbital, config, targetAltitudeKm);

  const planeNormal = runtime.launchPlaneNormal || normalize(cross(up, relVel), earthPole);
  const tangent = autopilotDirectionInTargetPlane(relVel, up, planeNormal, earthPole);

  if (runtime.autopilotMode === "autopilot-orbital-hold") {
    if (!stableTargetOrbit) {
      runtime.autopilotMode = "autopilot-coast-to-circularize";
      return {
        phase: "coast",
        throttle: 0,
        direction: tangent,
        mode: "autopilot-reacquire-orbit",
      };
    }
    return {
      phase: "orbit",
      throttle: 0,
      direction: tangent,
      mode: "autopilot-orbital-hold",
    };
  }

  if (runtime.autopilotMode === "autopilot-coast-to-circularize") {
    const coastMinAltitudeKm = Math.max(config.ascentCoastMinAltitudeKm || 0, 0);
    const belowSafeCoastAltitude = orbital.altitudeKm < coastMinAltitudeKm;
    const descendingTooFast = radialSpeedKmS < (config.ascentClimbRecoverRadialSpeedKmS ?? -0.01);
    if (belowSafeCoastAltitude && descendingTooFast) {
      runtime.autopilotMode = "autopilot-apoapsis-raise";
      const recoveryDirection = normalize(
        add(scale(tangent, 1), scale(up, 0.5)),
        up,
      );
      return {
        phase: "powered",
        throttle: clamp(config.ascentClimbThrottleFloor ?? 0.92, 0.3, 1),
        direction: recoveryDirection,
        mode: "autopilot-climb-recovery",
      };
    }
    const tta = Number(orbital.timeToApoapsisSec);
    const readyForCircularization =
      (Number.isFinite(tta) && tta <= config.circularizationIgnitionLeadSeconds)
      || (radialSpeedKmS <= 0 && orbital.altitudeKm >= config.circularizationMinAltitudeKm)
      || (!Number.isFinite(tta) && orbital.altitudeKm >= config.circularizationMinAltitudeKm);
    if (!readyForCircularization) {
      return {
        phase: "coast",
        throttle: 0,
        direction: tangent,
        mode: "autopilot-coast-to-apoapsis",
      };
    }
    runtime.autopilotMode = "autopilot-circularization";
  }

  if (runtime.autopilotMode === "autopilot-circularization") {
    const periErrorKm = periDefined ? targetAltitudeKm - periapsisKm : targetAltitudeKm;
    const tangentialSpeedErrorKmS = circularSpeedKmS - tangentialSpeedKmS;
    const aboveCircularSpeed = tangentialSpeedErrorKmS <= -0.02;
    const doneCircularizing = stableTargetOrbit && tangentialSpeedErrorKmS <= 0.02;
    if (doneCircularizing) {
      runtime.autopilotMode = "autopilot-orbital-hold";
      return {
        phase: "orbit",
        throttle: 0,
        direction: tangent,
        mode: "autopilot-orbital-hold",
      };
    }
    if (aboveCircularSpeed) {
      runtime.autopilotMode = "autopilot-coast-to-circularize";
      return {
        phase: "coast",
        throttle: 0,
        direction: tangent,
        mode: "autopilot-coast-for-recapture",
      };
    }
    const radialDamping = clamp(-radialSpeedKmS * 0.55, -0.22, 0.22);
    const direction = normalize(
      add(scale(tangent, 1), scale(up, radialDamping)),
      tangent,
    );
    const throttle = clamp(
      config.circularizationThrottle + clamp(periErrorKm / targetAltitudeSafe, -0.2, 0.35),
      0.18,
      1,
    );
    return {
      phase: "powered",
      throttle,
      direction,
      mode: "autopilot-circularization",
    };
  }

  if (
    runtime.elapsedSeconds < config.verticalAscentMinSeconds
    || orbital.altitudeKm < config.verticalAscentMaxAltitudeKm
  ) {
    const hold = applyVerticalHoldSteering({
      baseDirection: up,
      relPos,
      relVel,
      earthPole,
      altitudeKm: orbital.altitudeKm,
      elapsedSeconds: runtime.elapsedSeconds,
    });
    runtime.autopilotMode = "autopilot-vertical-ascent";
    return {
      phase: "powered",
      throttle: throttleForState(runtime.stageIndex, runtime.elapsedSeconds, dynamicPressurePa),
      direction: hold.direction,
      mode: hold.active ? "autopilot-vertical-hold" : "autopilot-vertical-ascent",
    };
  }

  const gravityTurnBlend = clamp(
    (orbital.altitudeKm - config.verticalAscentMaxAltitudeKm)
      / Math.max(config.gravityTurnEndAltitudeKm - config.verticalAscentMaxAltitudeKm, 1),
    0,
    1,
  );
  const turnDirection = normalize(
    mixVectors(up, tangent, Math.pow(gravityTurnBlend, 0.85)),
    tangent,
  );

  let direction = turnDirection;
  let throttle = throttleForState(runtime.stageIndex, runtime.elapsedSeconds, dynamicPressurePa);
  let mode = "autopilot-gravity-turn";
  if (gravityTurnBlend >= 1) {
    runtime.autopilotMode = "autopilot-apoapsis-raise";
    const apoDeficitKm = apoDefined ? targetAltitudeKm - apoapsisKm : targetAltitudeKm;
    const radialBias = clamp((apoDeficitKm / targetAltitudeSafe) * 0.30, -0.12, 0.18);
    direction = normalize(
      add(scale(tangent, 1), scale(up, radialBias)),
      tangent,
    );
    throttle = clamp(
      0.84 + clamp((apoDeficitKm / targetAltitudeSafe) * 0.28, -0.10, 0.14),
      0.72,
      config.ascentMaxThrottle,
    );
    mode = "autopilot-apoapsis-raise";
  } else {
    runtime.autopilotMode = "autopilot-gravity-turn";
  }

  const climbGuardAltitudeKm = Math.max(config.ascentClimbGuardAltitudeKm || 0, config.verticalAscentMaxAltitudeKm || 0);
  if (orbital.altitudeKm < climbGuardAltitudeKm) {
    const altitudeDeficit = clamp((climbGuardAltitudeKm - orbital.altitudeKm) / Math.max(climbGuardAltitudeKm, 1), 0, 1);
    const radialRecovery = clamp(
      ((config.ascentClimbRecoverRadialSpeedKmS ?? -0.01) - radialSpeedKmS) * 3.5,
      0,
      0.85,
    );
    const upWeight = clamp(
      (config.ascentClimbUpWeightMin ?? 0.2) + altitudeDeficit + radialRecovery,
      config.ascentClimbUpWeightMin ?? 0.2,
      config.ascentClimbUpWeightMax ?? 0.68,
    );
    direction = normalize(
      add(scale(direction, 1), scale(up, upWeight)),
      up,
    );
    if (radialSpeedKmS < (config.ascentClimbRecoverRadialSpeedKmS ?? -0.01)) {
      throttle = Math.max(throttle, clamp(config.ascentClimbThrottleFloor ?? 0.92, 0.3, 1));
      mode = "autopilot-climb-guard";
    }
  }

  // Prevent shallow descents during late ascent: keep slight "up" authority until
  // we're safely above circularization gate and not bleeding altitude.
  const highAltitudeGuardKm = Math.max(config.circularizationMinAltitudeKm + 30, climbGuardAltitudeKm);
  if (orbital.altitudeKm < highAltitudeGuardKm && radialSpeedKmS < -0.002) {
    const descentSeverity = clamp((-radialSpeedKmS) / 0.12, 0, 1);
    const upWeight = clamp(0.30 + (descentSeverity * 0.44), 0.24, 0.76);
    direction = normalize(
      add(scale(direction, 1), scale(up, upWeight)),
      up,
    );
    throttle = Math.max(throttle, clamp(0.9 + (descentSeverity * 0.1), 0.9, 1));
    mode = "autopilot-climb-guard";
  }

  const shouldCoastToApoapsis =
    (
      apoDefined
      && apoapsisKm >= (targetAltitudeKm + config.insertionCutoffApoapsisMarginKm)
      && radialSpeedKmS > -0.005
      && orbital.altitudeKm >= Math.max(config.ascentCoastMinAltitudeKm || 0, 0)
    )
    || (
      orbital.altitudeKm >= config.circularizationMinAltitudeKm
      && tangentialSpeedKmS >= (targetCircularSpeedKmS * 0.9)
      && radialSpeedKmS > -0.01
    );
  if (shouldCoastToApoapsis) {
    runtime.autopilotMode = "autopilot-coast-to-circularize";
    return {
      phase: "coast",
      throttle: 0,
      direction,
      mode: "autopilot-meco-coast",
    };
  }

  const hold = applyVerticalHoldSteering({
    baseDirection: direction,
    relPos,
    relVel,
    earthPole,
    altitudeKm: orbital.altitudeKm,
    elapsedSeconds: runtime.elapsedSeconds,
  });
  if (hold.active) {
    direction = hold.direction;
    if (!mode.includes("vertical-hold")) {
      mode = `${mode}+vertical-hold`;
    }
  }

  return {
    phase: "powered",
    throttle,
    direction,
    mode,
  };
}

function throttleForState(stageIndex, elapsedSeconds, dynamicPressurePa = 0) {
  const guidance = LAUNCH_VEHICLE_CONFIG.guidance || {};
  if (stageIndex !== 0) {
    return 1;
  }
  let throttle = 1;
  if (elapsedSeconds < guidance.liftoffThrottleSec) {
    throttle = Math.min(throttle, clamp(guidance.liftoffThrottleValue, 0.3, 1));
  }

  const qTargetPa = Number(guidance.maxQTargetPa) || 0;
  const qControlStartRatio = clamp(Number(guidance.maxQControlStartRatio) || 0.78, 0.2, 1.2);
  if (qTargetPa > 0 && Number.isFinite(dynamicPressurePa) && dynamicPressurePa > 0) {
    const qRatio = dynamicPressurePa / qTargetPa;
    if (qRatio > qControlStartRatio) {
      const gain = Math.max(0.05, Number(guidance.maxQThrottleGain) || 0.92);
      const floor = clamp(
        Number(guidance.maxQThrottleFloor ?? guidance.maxQThrottleValue ?? 0.58),
        0.3,
        1,
      );
      const reduction = clamp((qRatio - qControlStartRatio) * gain, 0, 1);
      throttle = Math.min(throttle, clamp(1 - reduction, floor, 1));
    }
  }

  if (elapsedSeconds >= guidance.maxQThrottleStartSec && elapsedSeconds <= guidance.maxQThrottleEndSec) {
    throttle = Math.min(throttle, clamp(Number(guidance.maxQThrottleValue) || 0.72, 0.3, 1));
  }
  return clamp(throttle, 0, 1);
}

function limitThrottleByThrustAccelerationG({
  stage,
  stageIndex,
  pressurePa,
  throttle,
  massKg,
}) {
  if (!stage || !(massKg > 0)) {
    return clamp(throttle, 0, 1);
  }
  const guidance = LAUNCH_VEHICLE_CONFIG.guidance || {};
  const stageSpecificLimitGs = stageIndex === 0
    ? Number(guidance.maxThrustAccelerationGsStage1)
    : Number(guidance.maxThrustAccelerationGsStage2);
  const fallbackLimitGs = Number(guidance.maxThrustAccelerationGs);
  const limitGs = Number.isFinite(stageSpecificLimitGs) && stageSpecificLimitGs > 0
    ? stageSpecificLimitGs
    : (Number.isFinite(fallbackLimitGs) && fallbackLimitGs > 0 ? fallbackLimitGs : 0);
  if (!(limitGs > 0)) {
    return clamp(throttle, 0, 1);
  }

  const stageFullThrustN = interpolateSeaToVac(
    Number(stage.thrustVacuumN) || 0,
    Number(stage.thrustSeaLevelN) || 0,
    pressurePa,
  );
  if (!(stageFullThrustN > 0)) {
    return 0;
  }

  const maxAllowedThrustN = limitGs * STANDARD_GRAVITY_M_S2 * massKg;
  const throttleCap = clamp(maxAllowedThrustN / stageFullThrustN, 0, 1);
  return clamp(Math.min(throttle, throttleCap), 0, 1);
}

function telemetryFromState({
  gravitationalConstantKm3PerKgS2,
  earthMassKg,
  earthRadiusKm,
  earthState,
  rocketState,
  atmosphereSample,
  earthPole,
  dynamicPressurePaOverride,
  runtime,
}) {
  if (!rocketState || !earthState) {
    return null;
  }
  const relPos = subtract(rocketState.position, earthState.position);
  const relVel = subtract(
    rocketState.velocity,
    earthState.velocity || { x: 0, y: 0, z: 0 },
  );
  const mu = gravitationalConstantKm3PerKgS2 * earthMassKg;
  const orbital = orbitalStateFromRelative(mu, earthRadiusKm, relPos, relVel);
  const apoapsisKm = Number.isFinite(orbital.apoapsisKm) ? orbital.apoapsisKm : null;
  const periapsisKm = Number.isFinite(orbital.periapsisKm) ? orbital.periapsisKm : null;

  const dynamicPressurePa =
    Number.isFinite(Number(dynamicPressurePaOverride))
      ? Number(dynamicPressurePaOverride)
      : dynamicPressurePaFromAtmosphere(atmosphereSample, relPos, relVel, earthPole);
  const surfaceSample = runtime.lastSurfaceSample || null;
  const centerAltitudeAboveTerrainKm = Number(surfaceSample?.altitudeAboveTerrainKm);
  const vehicleAltitudeAboveTerrainKm = Number.isFinite(centerAltitudeAboveTerrainKm)
    ? centerAltitudeAboveTerrainKm - STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM
    : null;
  return {
    phase: runtime.phase,
    elapsedSeconds: runtime.elapsedSeconds,
    stageIndex: runtime.stageIndex,
    stageName: stageAtIndex(runtime.stageIndex)?.name || "Coast/Complete",
    massKg: rocketState.massKg,
    altitudeKm: orbital.altitudeKm,
    speedKmS: orbital.speedKmS,
    radialSpeedKmS: orbital.radialSpeedKmS,
    tangentialSpeedKmS: orbital.tangentialSpeedKmS,
    circularSpeedKmS: orbital.circularSpeedKmS,
    apoapsisKm,
    periapsisKm,
    timeToApoapsisSec: Number.isFinite(orbital.timeToApoapsisSec) ? orbital.timeToApoapsisSec : null,
    autopilotMode: runtime.autopilotMode || "manual",
    targetOrbitAltitudeKm: runtime.targetOrbitAltitudeKm || LAUNCH_AUTOPILOT_CONFIG.targetOrbitAltitudeKm,
    throttle: runtime.lastStep?.throttle || 0,
    thrustN: runtime.lastStep?.thrustN || 0,
    burnRateKgS: runtime.lastStep?.burnRateKgS || 0,
    dynamicPressurePa,
    terrainElevationKm: Number.isFinite(Number(surfaceSample?.terrainHeightKm))
      ? Number(surfaceSample.terrainHeightKm)
      : null,
    altitudeAboveTerrainKm: Number.isFinite(vehicleAltitudeAboveTerrainKm)
      ? vehicleAltitudeAboveTerrainKm
      : null,
    latitudeDeg: Number.isFinite(Number(surfaceSample?.latitudeDeg))
      ? Number(surfaceSample.latitudeDeg)
      : null,
    longitudeDeg: Number.isFinite(Number(surfaceSample?.longitudeDeg))
      ? Number(surfaceSample.longitudeDeg)
      : null,
    guidanceMode: runtime.lastStep?.guidanceMode || "idle",
    missionId: runtime.mission.selectedId,
    missionName: safeMissionProfile(runtime.mission.selectedId)?.name || "Mission",
    missionPhase: runtime.mission.phase,
    missionCompleted: Boolean(runtime.mission.completed),
    rcsActive: Boolean(runtime.lastStep?.rcsActive),
    rcsErrorDeg: Number(runtime.lastStep?.rcsErrorDeg) || 0,
    rcsAuthority: Number(runtime.lastStep?.rcsAuthority) || 0,
    rcsJets: Array.isArray(runtime.lastStep?.rcsJets) ? [...runtime.lastStep.rcsJets] : [],
    boosterDistanceKm: runtime.boosterDistanceKm,
    starshipDistanceKm: runtime.starshipDistanceKm,
  };
}

function boosterTelemetryFromState({
  gravitationalConstantKm3PerKgS2,
  earthMassKg,
  earthRadiusKm,
  earthState,
  boosterState,
  atmosphereSample,
  earthPole,
  dynamicPressurePaOverride,
  runtime,
}) {
  if (!boosterState || !earthState) {
    return null;
  }
  const relPos = subtract(boosterState.position, earthState.position);
  const relVel = subtract(
    boosterState.velocity,
    earthState.velocity || { x: 0, y: 0, z: 0 },
  );
  const mu = gravitationalConstantKm3PerKgS2 * earthMassKg;
  const orbital = orbitalStateFromRelative(mu, earthRadiusKm, relPos, relVel);
  const dynamicPressurePa =
    Number.isFinite(Number(dynamicPressurePaOverride))
      ? Number(dynamicPressurePaOverride)
      : dynamicPressurePaFromAtmosphere(atmosphereSample, relPos, relVel, earthPole);
  const pressurePa = Math.max(0, Number(atmosphereSample?.pressurePa) || 0);
  const densityKgM3 = Math.max(0, Number(atmosphereSample?.densityKgM3) || 0);
  const surfaceSample = runtime.booster.lastSurfaceSample || null;
  const centerAltitudeAboveTerrainKm = Number(surfaceSample?.altitudeAboveTerrainKm);
  const boosterAltitudeAboveTerrainKm = Number.isFinite(centerAltitudeAboveTerrainKm)
    ? centerAltitudeAboveTerrainKm - BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM
    : null;
  return {
    phase: runtime.booster.phase,
    guidanceMode: runtime.booster.guidanceMode,
    massKg: boosterState.massKg,
    propellantKg: runtime.booster.propellantKg,
    initialPropellantKg: runtime.booster.initialPropellantKg,
    fuelFraction: runtime.booster.initialPropellantKg > 1e-6
      ? clamp(runtime.booster.propellantKg / runtime.booster.initialPropellantKg, 0, 1)
      : null,
    altitudeKm: orbital.altitudeKm,
    speedKmS: orbital.speedKmS,
    radialSpeedKmS: orbital.radialSpeedKmS,
    tangentialSpeedKmS: orbital.tangentialSpeedKmS,
    pressurePa,
    densityKgM3,
    dynamicPressurePa,
    throttle: runtime.booster.lastStep?.throttle || 0,
    thrustN: runtime.booster.lastStep?.thrustN || 0,
    burnRateKgS: runtime.booster.lastStep?.burnRateKgS || 0,
    rcsBurnRateKgS: runtime.booster.lastStep?.rcsBurnRateKgS || 0,
    rcsActive: Boolean(runtime.booster.lastStep?.rcsActive),
    rcsErrorDeg: Number(runtime.booster.lastStep?.rcsErrorDeg) || 0,
    rcsAuthority: Number(runtime.booster.lastStep?.rcsAuthority) || 0,
    rcsJets: Array.isArray(runtime.booster.lastStep?.rcsJets) ? [...runtime.booster.lastStep.rcsJets] : [],
    terrainElevationKm: Number.isFinite(Number(surfaceSample?.terrainHeightKm))
      ? Number(surfaceSample.terrainHeightKm)
      : null,
    altitudeAboveTerrainKm: Number.isFinite(boosterAltitudeAboveTerrainKm)
      ? boosterAltitudeAboveTerrainKm
      : null,
    latitudeDeg: Number.isFinite(Number(surfaceSample?.latitudeDeg))
      ? Number(surfaceSample.latitudeDeg)
      : null,
    longitudeDeg: Number.isFinite(Number(surfaceSample?.longitudeDeg))
      ? Number(surfaceSample.longitudeDeg)
      : null,
    landed: Boolean(runtime.booster.landed),
  };
}

function composeBoosterDirection(up, relVel, tangentialVector, directionMix = null) {
  const safeUp = normalize(up || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const retrograde = normalize(scale(relVel || { x: 0, y: 0, z: 0 }, -1), safeUp);
  const antiTangent = normalize(scale(tangentialVector || { x: 0, y: 0, z: 0 }, -1), { x: 0, y: 0, z: 0 });
  const upWeight = Number(directionMix?.up) || 0;
  const retrogradeWeight = Number(directionMix?.retrograde) || 0;
  const antiTangentWeight = Number(directionMix?.antiTangent) || 0;
  const command = add(
    scale(safeUp, upWeight),
    add(
      scale(retrograde, retrogradeWeight),
      scale(antiTangent, antiTangentWeight),
    ),
  );
  return normalize(command, safeUp);
}

function lateralDirectionTowardTarget(fromPosition, toPosition, up, fallbackDirection) {
  const targetVector = subtract(toPosition || { x: 0, y: 0, z: 0 }, fromPosition || { x: 0, y: 0, z: 0 });
  const lateral = subtract(targetVector, scale(up, dot(targetVector, up)));
  return normalize(lateral, fallbackDirection);
}

function zeroBoosterStep(guidanceMode = "booster-idle") {
  return {
    accelerationKmS2: { x: 0, y: 0, z: 0 },
    throttle: 0,
    thrustN: 0,
    burnKg: 0,
    burnRateKgS: 0,
    rcsBurnKg: 0,
    rcsBurnRateKgS: 0,
    dynamicPressurePa: 0,
    guidanceMode,
    rcsActive: false,
    rcsErrorDeg: 0,
    rcsAuthority: 0,
    rcsJets: [],
  };
}

const MOON_RETURN_MISSION_CONFIG = Object.freeze({
  parkingOrbitPeriapsisMinKm: 150,
  parkingOrbitApoapsisMinKm: 180,
  tliTargetApoapsisKm: 382_000,
  tliApoapsisMarginKm: 3_000,
  tliMinSpecificEnergyKm2S2: -0.28,
  tliReigniteEarthDistanceKm: 370_000,
  tliReigniteFallbackRadialKmS: -0.006,
  tliReigniteThrottleBase: 0.42,
  tliReigniteThrottleMax: 0.96,
  moonApproachDistanceKm: 120_000,
  midcourseMinClosingSpeedKmS: 0.02,
  midcourseClosingSpeedWindowKmS: 0.18,
  midcourseCorrectionThrottleBase: 0.22,
  midcourseCorrectionThrottleMax: 0.78,
  earthFallBackRadialSpeedKmS: -0.01,
  lunarInsertionAltitudeGateKm: 16_000,
  lunarOrbitApoapsisMaxKm: 14_000,
  lunarOrbitPeriapsisMinKm: 45,
  lunarHoldDurationSec: 2 * 3600,
  teiDepartureDistanceKm: 140_000,
  earthCaptureDistanceKm: 180_000,
  earthCaptureApoapsisMaxKm: 75_000,
  earthCapturePeriapsisMinKm: 120,
});

const EARTH_ORBIT_HOLD_MISSION_CONFIG = Object.freeze({
  insertionPeriapsisMinKm: 80,
  insertionApoapsisMinKm: 120,
  stablePeriapsisErrorKm: 3.5,
  stableApoapsisErrorKm: 3.5,
  stableRadialSpeedKmS: 0.0035,
  stableTangentialSpeedErrorKmS: 0.012,
  burnApoapsisErrorWeight: 0.65,
  burnPeriapsisErrorWeight: 0.95,
  burnRadialSpeedWeight: 4.2,
  burnDirectionRadialMixLimit: 0.38,
  throttleMin: 0.05,
  throttleMax: 0.74,
  throttleBase: 0.08,
  throttleAltitudeNormWindowKm: 18,
  throttleSpeedNormWindowKmS: 0.09,
  throttleRadialNormWindowKmS: 0.03,
  sustainedOrbitReserveKg: 20_000,
});

function safeMissionProfile(missionId) {
  return missionProfileById(normalizeMissionId(missionId));
}

function defaultMissionPhaseForProfileId(missionId) {
  if (missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
    return "launch_to_parking";
  }
  return "earth_orbit_hold";
}

function setMissionPhase(runtime, nextPhase) {
  const phaseName = String(nextPhase || "").trim();
  if (!phaseName || runtime.mission.phase === phaseName) {
    return;
  }
  runtime.mission.phase = phaseName;
  runtime.mission.phaseStartedElapsedSec = runtime.elapsedSeconds;
}

function missionElapsedInPhaseSeconds(runtime) {
  return Math.max(0, runtime.elapsedSeconds - (Number(runtime.mission.phaseStartedElapsedSec) || 0));
}

function isMoonTransferMissionActive(runtime) {
  if (!runtime?.mission) {
    return false;
  }
  if (runtime.mission.selectedId !== LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
    return false;
  }
  return runtime.mission.phase !== "earth_orbit_hold";
}

function bodyStateFromNBody(state, bodyId) {
  return state?.dynamicBodies?.get(bodyId)
    || state?.staticSources?.get(bodyId)
    || null;
}

function missionOrbitTangent(relVel, up, planeNormal, pole) {
  return autopilotDirectionInTargetPlane(
    relVel,
    up,
    planeNormal || normalize(cross(up, relVel), pole),
    pole,
  );
}

function missionUsesSustainedOrbitReserve(runtime) {
  if (
    runtime?.mission?.selectedId !== LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD
    || Number(runtime?.stageIndex) < 1
  ) {
    return false;
  }
  const guidanceMode = String(runtime?.lastStep?.guidanceMode || runtime?.autopilotMode || "");
  const stationKeepingActive = guidanceMode.startsWith("mission-earth-orbit-hold:station-keeping");
  return runtime?.phase === "orbit" || stationKeepingActive;
}

function computeEarthOrbitHoldAutopilotCommand({
  runtime,
  orbital,
  relVel,
  up,
  earthPole,
  muKm3S2,
  earthRadiusKm,
}) {
  if (Number(runtime.stageIndex) < 1) {
    setMissionPhase(runtime, "earth_orbit_hold");
    return null;
  }

  const config = EARTH_ORBIT_HOLD_MISSION_CONFIG;
  const periapsisKm = Number(orbital.periapsisKm);
  const apoapsisKm = Number(orbital.apoapsisKm);
  const hasBoundOrbit = Number(orbital.specificEnergy) < 0;
  const insertionReady = hasBoundOrbit
    && Number.isFinite(periapsisKm)
    && Number.isFinite(apoapsisKm)
    && periapsisKm >= config.insertionPeriapsisMinKm
    && apoapsisKm >= config.insertionApoapsisMinKm;
  if (!insertionReady) {
    return null;
  }

  setMissionPhase(runtime, "earth_orbit_hold");
  runtime.mission.completed = false;

  const tangent = missionOrbitTangent(relVel, up, runtime.launchPlaneNormal, earthPole);
  const targetAltitudeKm = Number(runtime.targetOrbitAltitudeKm) || Number(LAUNCH_AUTOPILOT_CONFIG.targetOrbitAltitudeKm) || 250;
  const targetRadiusKm = Math.max(1, earthRadiusKm + targetAltitudeKm);
  const targetTangentialSpeedKmS = circularOrbitSpeedKmS(muKm3S2, targetRadiusKm);
  const radialSpeedKmS = Number(orbital.radialSpeedKmS) || 0;
  const tangentialSpeedKmS = Number(orbital.tangentialSpeedKmS) || 0;

  const apoErrorKm = Number.isFinite(apoapsisKm) ? (targetAltitudeKm - apoapsisKm) : targetAltitudeKm;
  const periErrorKm = Number.isFinite(periapsisKm) ? (targetAltitudeKm - periapsisKm) : targetAltitudeKm;
  const tangentialSpeedErrorKmS = targetTangentialSpeedKmS - tangentialSpeedKmS;

  const stable = Math.abs(apoErrorKm) <= config.stableApoapsisErrorKm
    && Math.abs(periErrorKm) <= config.stablePeriapsisErrorKm
    && Math.abs(radialSpeedKmS) <= config.stableRadialSpeedKmS
    && Math.abs(tangentialSpeedErrorKmS) <= config.stableTangentialSpeedErrorKmS;

  if (stable) {
    return {
      phase: "orbit",
      throttle: 0,
      direction: tangent,
      mode: "mission-earth-orbit-hold:station-keeping",
    };
  }

  const tangentialSign = tangentialSpeedErrorKmS >= 0 ? 1 : -1;
  const tangentialDirection = scale(tangent, tangentialSign);
  const radialMixRaw = (
    (periErrorKm * config.burnPeriapsisErrorWeight)
    + (apoErrorKm * config.burnApoapsisErrorWeight)
  ) / Math.max(targetAltitudeKm, 1) - (radialSpeedKmS * config.burnRadialSpeedWeight);
  const radialMix = clamp(
    radialMixRaw,
    -config.burnDirectionRadialMixLimit,
    config.burnDirectionRadialMixLimit,
  );
  const direction = normalize(
    add(scale(tangentialDirection, 1), scale(up, radialMix)),
    tangentialDirection,
  );

  const altitudeErrorNorm = clamp(
    Math.max(Math.abs(apoErrorKm), Math.abs(periErrorKm)) / Math.max(config.throttleAltitudeNormWindowKm, 1),
    0,
    1,
  );
  const speedErrorNorm = clamp(
    Math.abs(tangentialSpeedErrorKmS) / Math.max(config.throttleSpeedNormWindowKmS, 1e-6),
    0,
    1,
  );
  const radialErrorNorm = clamp(
    Math.abs(radialSpeedKmS) / Math.max(config.throttleRadialNormWindowKmS, 1e-6),
    0,
    1,
  );
  const throttle = clamp(
    config.throttleBase
      + (altitudeErrorNorm * 0.44)
      + (speedErrorNorm * 0.4)
      + (radialErrorNorm * 0.24),
    config.throttleMin,
    config.throttleMax,
  );

  return {
    phase: "powered",
    throttle,
    direction,
    mode: "mission-earth-orbit-hold:station-keeping-burn",
  };
}

function computeMoonOrbitReturnAutopilotCommand({
  runtime,
  state,
  earthState,
  rocketState,
  orbital,
  relPos,
  relVel,
  up,
  earthPole,
  muKm3S2,
  gravitationalConstantKm3PerKgS2,
  earthRadiusKm,
  getBodyRadiusKm,
  getBodyMassKg,
}) {
  if (runtime.stageIndex < 1) {
    setMissionPhase(runtime, "launch_to_parking");
    return null;
  }
  const tangent = missionOrbitTangent(relVel, up, runtime.launchPlaneNormal, earthPole);
  const moonState = bodyStateFromNBody(state, "moon");
  const moonMassKg = Number(getBodyMassKg?.("moon")) || Number(moonState?.massKg) || 7.342e22;
  const moonRadiusKm = Number(getBodyRadiusKm?.("moon")) || 1737.4;
  const moonMuKm3S2 = gravitationalConstantKm3PerKgS2 * moonMassKg;

  const moonRelPos = moonState?.position ? subtract(rocketState.position, moonState.position) : null;
  const moonRelVel = moonState?.velocity
    ? subtract(rocketState.velocity, moonState.velocity)
    : null;
  const moonDistanceKm = moonRelPos ? length(moonRelPos) : Number.POSITIVE_INFINITY;
  const moonAltitudeKm = moonDistanceKm - moonRadiusKm;
  const moonOrbit = moonRelPos && moonRelVel
    ? orbitalStateFromRelative(moonMuKm3S2, moonRadiusKm, moonRelPos, moonRelVel)
    : null;
  const earthDistanceKm = length(relPos);
  const earthDirection = normalize(scale(relPos, -1), scale(up, -1));
  const moonDirection = moonRelPos
    ? normalize(scale(moonRelPos, -1), tangent)
    : tangent;
  const moonClosingSpeedKmS = moonRelPos && moonRelVel
    ? -dot(moonRelVel, normalize(moonRelPos, tangent))
    : 0;
  const earthRadialSpeedKmS = earthDistanceKm > 1e-6
    ? dot(relPos, relVel) / earthDistanceKm
    : 0;

  const phase = runtime.mission.phase || "launch_to_parking";
  const config = MOON_RETURN_MISSION_CONFIG;

  if (phase === "launch_to_parking") {
    const parkingReady = Number(orbital.periapsisKm) >= config.parkingOrbitPeriapsisMinKm
      && Number(orbital.apoapsisKm) >= config.parkingOrbitApoapsisMinKm
      && orbital.specificEnergy < 0;
    if (parkingReady) {
      setMissionPhase(runtime, "tli_burn");
      return {
        phase: "coast",
        throttle: 0,
        direction: tangent,
        mode: "mission-moon-orbit-return:tli-setup",
      };
    }
    return null;
  }

  if (phase === "tli_burn") {
    const apo = Number(orbital.apoapsisKm);
    const apoReached = Number.isFinite(apo) && apo >= (config.tliTargetApoapsisKm - config.tliApoapsisMarginKm);
    const lunarInterceptTrending =
      moonDistanceKm <= config.tliTargetApoapsisKm
      || moonClosingSpeedKmS >= config.midcourseMinClosingSpeedKmS;
    const escapeReady = Number(orbital.specificEnergy) >= config.tliMinSpecificEnergyKm2S2;
    if (apoReached && lunarInterceptTrending && escapeReady) {
      setMissionPhase(runtime, "coast_to_moon");
      return {
        phase: "coast",
        throttle: 0,
        direction: tangent,
        mode: "mission-moon-orbit-return:coast-to-moon",
      };
    }
    const apoDeficitKm = Number.isFinite(apo) ? (config.tliTargetApoapsisKm - apo) : config.tliTargetApoapsisKm;
    const energyDeficit = clamp(
      (config.tliMinSpecificEnergyKm2S2 - Number(orbital.specificEnergy))
        / Math.max(Math.abs(config.tliMinSpecificEnergyKm2S2), 1e-6),
      0,
      1,
    );
    const closingDeficit = clamp(
      (config.midcourseMinClosingSpeedKmS - moonClosingSpeedKmS) / Math.max(config.midcourseClosingSpeedWindowKmS, 1e-6),
      0,
      1,
    );
    const throttle = clamp(
      0.24
        + (clamp(apoDeficitKm / config.tliTargetApoapsisKm, 0, 1) * 0.42)
        + (closingDeficit * 0.18)
        + (energyDeficit * 0.24),
      0.18,
      0.96,
    );
    const direction = normalize(
      add(
        scale(tangent, 0.68),
        add(
          scale(moonDirection, 0.26),
          scale(up, 0.08),
        ),
      ),
      tangent,
    );
    return {
      phase: "powered",
      throttle,
      direction,
      mode: "mission-moon-orbit-return:tli-burn",
    };
  }

  if (phase === "coast_to_moon") {
    if (moonDistanceKm <= config.moonApproachDistanceKm) {
      setMissionPhase(runtime, "lunar_insertion");
      return {
        phase: "coast",
        throttle: 0,
        direction: tangent,
        mode: "mission-moon-orbit-return:lunar-insertion-setup",
      };
    }
    const needsEscapeReignite =
      Number(orbital.specificEnergy) < config.tliMinSpecificEnergyKm2S2
      && earthDistanceKm < config.tliReigniteEarthDistanceKm
      && earthRadialSpeedKmS < config.tliReigniteFallbackRadialKmS;
    if (needsEscapeReignite) {
      const radialFallbackFactor = clamp(
        (config.tliReigniteFallbackRadialKmS - earthRadialSpeedKmS)
          / Math.max(Math.abs(config.tliReigniteFallbackRadialKmS), 1e-6),
        0,
        1,
      );
      const reigniteDirection = normalize(
        add(
          scale(tangent, 0.66),
          add(
            scale(moonDirection, 0.28),
            scale(up, 0.06),
          ),
        ),
        tangent,
      );
      const reigniteThrottle = clamp(
        config.tliReigniteThrottleBase + (radialFallbackFactor * 0.34),
        config.tliReigniteThrottleBase,
        config.tliReigniteThrottleMax,
      );
      return {
        phase: "powered",
        throttle: reigniteThrottle,
        direction: reigniteDirection,
        mode: "mission-moon-orbit-return:tli-reignite",
      };
    }
    const fallingBackToEarth =
      earthRadialSpeedKmS < config.earthFallBackRadialSpeedKmS
      && earthDistanceKm < config.tliTargetApoapsisKm;
    const needsMidcourseCorrection =
      moonDistanceKm > config.moonApproachDistanceKm
      && (
        moonClosingSpeedKmS < config.midcourseMinClosingSpeedKmS
        || fallingBackToEarth
      );
    if (needsMidcourseCorrection) {
      const closingDeficit = clamp(
        (config.midcourseMinClosingSpeedKmS - moonClosingSpeedKmS) / Math.max(config.midcourseClosingSpeedWindowKmS, 1e-6),
        0,
        1,
      );
      const correctionDirection = normalize(
        add(scale(moonDirection, 0.86), scale(tangent, 0.14)),
        moonDirection,
      );
      const throttle = clamp(
        config.midcourseCorrectionThrottleBase
          + (closingDeficit * 0.34)
          + (fallingBackToEarth ? 0.16 : 0),
        config.midcourseCorrectionThrottleBase,
        config.midcourseCorrectionThrottleMax,
      );
      return {
        phase: "powered",
        throttle,
        direction: correctionDirection,
        mode: "mission-moon-orbit-return:midcourse-correction",
      };
    }
    return {
      phase: "coast",
      throttle: 0,
      direction: moonDirection,
      mode: "mission-moon-orbit-return:coast-to-moon",
    };
  }

  if (phase === "lunar_insertion") {
    if (moonOrbit && moonOrbit.specificEnergy < 0
      && Number(moonOrbit.apoapsisKm) > 0
      && Number(moonOrbit.apoapsisKm) <= config.lunarOrbitApoapsisMaxKm
      && Number(moonOrbit.periapsisKm) >= config.lunarOrbitPeriapsisMinKm) {
      setMissionPhase(runtime, "lunar_orbit_hold");
      return {
        phase: "coast",
        throttle: 0,
        direction: normalize(scale(moonRelVel || tangent, 1), tangent),
        mode: "mission-moon-orbit-return:lunar-orbit-hold",
      };
    }
    if (moonRelVel && moonRelPos && moonAltitudeKm <= config.lunarInsertionAltitudeGateKm) {
      const moonRetrograde = normalize(scale(moonRelVel, -1), earthDirection);
      const moonUp = normalize(moonRelPos, up);
      const direction = normalize(add(scale(moonRetrograde, 1), scale(moonUp, 0.22)), moonRetrograde);
      const moonSpeedTargetKmS = clamp(
        (moonMuKm3S2 > 0 && moonDistanceKm > 1)
          ? (Math.sqrt(moonMuKm3S2 / moonDistanceKm) * 1.08)
          : 1.4,
        0.55,
        2.2,
      );
      const moonSpeedErrorKmS = (Number(moonOrbit?.speedKmS) || 0) - moonSpeedTargetKmS;
      const throttle = clamp(
        0.14 + (moonSpeedErrorKmS * 0.38) + clamp((6000 - moonAltitudeKm) / 6000, 0, 1) * 0.26,
        0.08,
        0.96,
      );
      return {
        phase: "powered",
        throttle,
        direction,
        mode: "mission-moon-orbit-return:lunar-insertion",
      };
    }
    return {
      phase: "coast",
      throttle: 0,
      direction: tangent,
      mode: "mission-moon-orbit-return:coast-near-moon",
    };
  }

  if (phase === "lunar_orbit_hold") {
    if (missionElapsedInPhaseSeconds(runtime) >= config.lunarHoldDurationSec) {
      setMissionPhase(runtime, "tei_burn");
    }
    return {
      phase: "coast",
      throttle: 0,
      direction: moonRelVel ? normalize(moonRelVel, tangent) : tangent,
      mode: "mission-moon-orbit-return:lunar-orbit-hold",
    };
  }

  if (phase === "tei_burn") {
    const moonRetrograde = moonRelVel ? normalize(scale(moonRelVel, -1), earthDirection) : earthDirection;
    const teiDirection = normalize(
      add(scale(earthDirection, 1), scale(moonRetrograde, 0.36)),
      earthDirection,
    );
    const throttle = clamp(
      moonAltitudeKm < 25_000 ? 0.55 : 0.34,
      0.22,
      0.86,
    );
    if (moonDistanceKm >= config.teiDepartureDistanceKm && dot(relPos, relVel) < 0) {
      setMissionPhase(runtime, "coast_to_earth");
      return {
        phase: "coast",
        throttle: 0,
        direction: teiDirection,
        mode: "mission-moon-orbit-return:coast-to-earth",
      };
    }
    return {
      phase: "powered",
      throttle,
      direction: teiDirection,
      mode: "mission-moon-orbit-return:tei-burn",
    };
  }

  if (phase === "coast_to_earth") {
    if (earthDistanceKm <= config.earthCaptureDistanceKm) {
      setMissionPhase(runtime, "earth_capture");
    }
    return {
      phase: "coast",
      throttle: 0,
      direction: tangent,
      mode: "mission-moon-orbit-return:coast-to-earth",
    };
  }

  if (phase === "earth_capture") {
    const captureReady = orbital.specificEnergy < 0
      && Number(orbital.apoapsisKm) > 0
      && Number(orbital.apoapsisKm) <= config.earthCaptureApoapsisMaxKm
      && Number(orbital.periapsisKm) >= config.earthCapturePeriapsisMinKm;
    if (captureReady) {
      setMissionPhase(runtime, "earth_orbit_hold");
      runtime.mission.completed = true;
      return {
        phase: "orbit",
        throttle: 0,
        direction: tangent,
        mode: "mission-moon-orbit-return:earth-orbit-hold",
      };
    }
    const retrograde = normalize(scale(relVel, -1), earthDirection);
    const direction = normalize(add(scale(retrograde, 1), scale(up, 0.08)), retrograde);
    const altitudeDeficit = clamp((config.earthCaptureDistanceKm - orbital.altitudeKm) / config.earthCaptureDistanceKm, 0, 1);
    const throttle = clamp(0.18 + (altitudeDeficit * 0.48), 0.12, 0.9);
    return {
      phase: "powered",
      throttle,
      direction,
      mode: "mission-moon-orbit-return:earth-capture",
    };
  }

  return {
    phase: "orbit",
    throttle: 0,
    direction: tangent,
    mode: "mission-moon-orbit-return:earth-orbit-hold",
  };
}

function computeMissionAutopilotCommand({
  runtime,
  state,
  earthState,
  rocketState,
  orbital,
  relPos,
  relVel,
  up,
  earthPole,
  muKm3S2,
  gravitationalConstantKm3PerKgS2,
  earthRadiusKm,
  getBodyRadiusKm,
  getBodyMassKg,
}) {
  if (runtime?.mission?.selectedId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
    return computeMoonOrbitReturnAutopilotCommand({
      runtime,
      state,
      earthState,
      rocketState,
      orbital,
      relPos,
      relVel,
      up,
      earthPole,
      muKm3S2,
      gravitationalConstantKm3PerKgS2,
      earthRadiusKm,
      getBodyRadiusKm,
      getBodyMassKg,
    });
  }
  if (runtime?.mission?.selectedId === LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD) {
    return computeEarthOrbitHoldAutopilotCommand({
      runtime,
      orbital,
      relVel,
      up,
      earthPole,
      muKm3S2,
      earthRadiusKm,
    });
  }
  return null;
}

function phaseLabel(phase) {
  if (phase === "powered") {
    return "Powered Ascent";
  }
  if (phase === "coast") {
    return "Coast";
  }
  if (phase === "orbit") {
    return "Orbit";
  }
  if (phase === "complete") {
    return "Mission Complete";
  }
  return "Idle";
}

export { LAUNCH_BODY_ID, LAUNCH_BODY_META, LAUNCH_BOOSTER_BODY_ID, LAUNCH_BOOSTER_META };

export function createLaunchController(options) {
  const {
    getEarthRadiusKm,
    getEarthMassKg,
    getBodyRadiusKm,
    getBodyMassKg,
    getEarthFixedAxesEcliptic,
    sampleEarthAtmosphere,
    gravitationalConstantKm3PerKgS2,
    onEvent,
    onError,
  } = options || {};

  const runtime = {
    phase: "idle",
    elapsedSeconds: 0,
    stageIndex: 0,
    stagePropellantKg: stageAtIndex(0)?.propellantMassKg || 0,
    coastRemainingSec: 0,
    lastStep: null,
    lastTelemetry: null,
    lastError: "",
    autopilotEnabled: Boolean(LAUNCH_AUTOPILOT_CONFIG.enabled),
    autopilotMode: "idle",
    targetOrbitAltitudeKm: Number(LAUNCH_AUTOPILOT_CONFIG.targetOrbitAltitudeKm) || 250,
    launchPlaneNormal: null,
    boosterDistanceKm: 0,
    starshipDistanceKm: 0,
    earthDistanceKm: null,
    earthClosingSpeedKmS: null,
    moonDistanceKm: null,
    moonClosingSpeedKmS: null,
    lastTrackedPositionKm: null,
    lastSurfaceSample: null,
    mission: {
      selectedId: DEFAULT_LAUNCH_MISSION_ID,
      phase: defaultMissionPhaseForProfileId(DEFAULT_LAUNCH_MISSION_ID),
      phaseStartedElapsedSec: 0,
      completed: false,
    },
    booster: {
      active: false,
      phase: "idle",
      guidanceMode: "booster-idle",
      propellantKg: 0,
      initialPropellantKg: 0,
      separationTimeSec: 0,
      landed: false,
      lastStep: null,
      lastSurfaceSample: null,
      lastTrackedPositionKm: null,
      telemetry: null,
      contactHoldSec: 0,
    },
  };
  const lastEmittedEventByKey = new Map();

  function finiteVector(v) {
    return Boolean(
      v
      && Number.isFinite(Number(v.x))
      && Number.isFinite(Number(v.y))
      && Number.isFinite(Number(v.z)),
    );
  }

  function shouldEmitEvent(name, details) {
    const signature = `${name}|${JSON.stringify(details || {})}`;
    const now = Date.now();
    const lastMs = lastEmittedEventByKey.get(signature) || 0;
    if (now - lastMs < 400) {
      return false;
    }
    lastEmittedEventByKey.set(signature, now);
    return true;
  }

  function telemetryLogDetails(telemetry) {
    if (!telemetry) {
      return {};
    }
    return {
      altitudeKm: Number(telemetry.altitudeKm),
      speedKmS: Number(telemetry.speedKmS),
      stageIndex: Number(telemetry.stageIndex),
      stageName: telemetry.stageName,
      guidanceMode: telemetry.guidanceMode,
      missionId: telemetry.missionId,
      missionPhase: telemetry.missionPhase,
      boosterPhase: telemetry.boosterPhase,
      boosterAltitudeKm: Number(telemetry.boosterAltitudeKm),
      boosterSpeedKmS: Number(telemetry.boosterSpeedKmS),
    };
  }

  function emitLaunchEvent(name, details = {}) {
    if (typeof onEvent !== "function") {
      return;
    }
    if (!shouldEmitEvent(name, details)) {
      return;
    }
    const payload = {
      timestampUtc: new Date().toISOString(),
      name,
      elapsedSeconds: Number(runtime.elapsedSeconds) || 0,
      phase: runtime.phase,
      stageIndex: runtime.stageIndex,
      stageName: stageAtIndex(runtime.stageIndex)?.name || "Coast/Complete",
      missionId: runtime.mission.selectedId,
      missionPhase: runtime.mission.phase,
      boosterPhase: runtime.booster.phase,
      ...details,
    };
    try {
      onEvent(payload);
    } catch (error) {
      console.warn("[launch] event callback failed:", error);
    }
  }

  function emitLaunchError(name, details = {}) {
    if (!shouldEmitEvent(`${name}:error`, details)) {
      return;
    }
    const payload = {
      timestampUtc: new Date().toISOString(),
      name,
      severity: "error",
      elapsedSeconds: Number(runtime.elapsedSeconds) || 0,
      phase: runtime.phase,
      stageIndex: runtime.stageIndex,
      stageName: stageAtIndex(runtime.stageIndex)?.name || "Coast/Complete",
      missionId: runtime.mission.selectedId,
      missionPhase: runtime.mission.phase,
      boosterPhase: runtime.booster.phase,
      ...details,
    };
    if (typeof onError === "function") {
      try {
        onError(payload);
      } catch (error) {
        console.warn("[launch] error callback failed:", error);
      }
      return;
    }
    emitLaunchEvent(name, { severity: "error", ...details });
  }

  function captureRuntimeLogState() {
    return {
      phase: runtime.phase,
      stageIndex: runtime.stageIndex,
      missionPhase: runtime.mission.phase,
      missionCompleted: Boolean(runtime.mission.completed),
      boosterActive: Boolean(runtime.booster.active),
      boosterPhase: runtime.booster.phase,
      boosterLanded: Boolean(runtime.booster.landed),
      lastError: runtime.lastError || "",
    };
  }

  let lastRuntimeLogState = captureRuntimeLogState();

  function emitRuntimeTransitionEvents(trigger) {
    const current = captureRuntimeLogState();
    const previous = lastRuntimeLogState;

    if (current.phase !== previous.phase) {
      emitLaunchEvent("starship_phase_changed", {
        trigger,
        fromPhase: previous.phase,
        toPhase: current.phase,
        ...telemetryLogDetails(runtime.lastTelemetry),
      });
    }
    if (current.stageIndex !== previous.stageIndex) {
      emitLaunchEvent("starship_stage_changed", {
        trigger,
        fromStageIndex: previous.stageIndex,
        toStageIndex: current.stageIndex,
        fromStageName: stageAtIndex(previous.stageIndex)?.name || "Coast/Complete",
        toStageName: stageAtIndex(current.stageIndex)?.name || "Coast/Complete",
      });
    }
    if (current.missionPhase !== previous.missionPhase) {
      emitLaunchEvent("mission_phase_changed", {
        trigger,
        fromMissionPhase: previous.missionPhase,
        toMissionPhase: current.missionPhase,
      });
    }
    if (!previous.missionCompleted && current.missionCompleted) {
      emitLaunchEvent("mission_completed", {
        trigger,
        missionPhase: current.missionPhase,
      });
    }
    if (current.boosterActive !== previous.boosterActive) {
      emitLaunchEvent("booster_activity_changed", {
        trigger,
        boosterActive: current.boosterActive,
      });
    }
    if (current.boosterPhase !== previous.boosterPhase) {
      emitLaunchEvent("booster_phase_changed", {
        trigger,
        fromBoosterPhase: previous.boosterPhase,
        toBoosterPhase: current.boosterPhase,
        ...telemetryLogDetails(runtime.booster.telemetry),
      });
    }
    if (!previous.boosterLanded && current.boosterLanded) {
      emitLaunchEvent("booster_landed", {
        trigger,
        ...telemetryLogDetails(runtime.booster.telemetry),
      });
    }
    if (current.lastError !== previous.lastError && current.lastError) {
      emitLaunchError("launch_runtime_error", {
        trigger,
        errorMessage: current.lastError,
        ...telemetryLogDetails(runtime.lastTelemetry),
      });
    }

    lastRuntimeLogState = current;
  }

  function earthAxes(timestampMs = Date.now()) {
    return sanitizeAxes(getEarthFixedAxesEcliptic?.(timestampMs) || fallbackAxes());
  }

  function earthStateFromNBody(state) {
    return state?.dynamicBodies?.get("earth") || state?.staticSources?.get("earth") || null;
  }

  function rocketStateFromNBody(state) {
    return state?.dynamicBodies?.get(LAUNCH_BODY_ID) || null;
  }

  function boosterStateFromNBody(state) {
    return state?.dynamicBodies?.get(LAUNCH_BOOSTER_BODY_ID) || null;
  }

  function resetRuntime() {
    const missionId = normalizeMissionId(runtime.mission.selectedId);
    runtime.phase = "idle";
    runtime.elapsedSeconds = 0;
    runtime.stageIndex = 0;
    runtime.stagePropellantKg = stageAtIndex(0)?.propellantMassKg || 0;
    runtime.coastRemainingSec = 0;
    runtime.lastStep = null;
    runtime.lastError = "";
    runtime.autopilotMode = runtime.autopilotEnabled ? "autopilot-standby" : "manual-standby";
    runtime.launchPlaneNormal = null;
    runtime.boosterDistanceKm = 0;
    runtime.starshipDistanceKm = 0;
    runtime.earthDistanceKm = null;
    runtime.earthClosingSpeedKmS = null;
    runtime.moonDistanceKm = null;
    runtime.moonClosingSpeedKmS = null;
    runtime.lastTrackedPositionKm = null;
    runtime.lastSurfaceSample = null;
    runtime.mission.selectedId = missionId;
    runtime.mission.phase = defaultMissionPhaseForProfileId(missionId);
    runtime.mission.phaseStartedElapsedSec = 0;
    runtime.mission.completed = false;
    runtime.booster.active = false;
    runtime.booster.phase = "idle";
    runtime.booster.guidanceMode = "booster-idle";
    runtime.booster.propellantKg = 0;
    runtime.booster.initialPropellantKg = 0;
    runtime.booster.separationTimeSec = 0;
    runtime.booster.landed = false;
    runtime.booster.lastStep = null;
    runtime.booster.lastSurfaceSample = null;
    runtime.booster.lastTrackedPositionKm = null;
    runtime.booster.telemetry = null;
    runtime.booster.contactHoldSec = 0;
    lastRuntimeLogState = captureRuntimeLogState();
  }

  function clearBoosterFromState(state) {
    state?.dynamicBodies?.delete?.(LAUNCH_BOOSTER_BODY_ID);
    runtime.booster.active = false;
    runtime.booster.phase = "idle";
    runtime.booster.guidanceMode = "booster-idle";
    runtime.booster.propellantKg = 0;
    runtime.booster.initialPropellantKg = 0;
    runtime.booster.separationTimeSec = 0;
    runtime.booster.landed = false;
    runtime.booster.lastStep = null;
    runtime.booster.lastSurfaceSample = null;
    runtime.booster.lastTrackedPositionKm = null;
    runtime.booster.telemetry = null;
    runtime.booster.contactHoldSec = 0;
  }

  function updateRuntimeTargetMetrics(state, relPos, relVel) {
    const earthDistanceKm = length(relPos || { x: 0, y: 0, z: 0 });
    runtime.earthDistanceKm = Number.isFinite(earthDistanceKm) ? earthDistanceKm : null;
    runtime.earthClosingSpeedKmS = (runtime.earthDistanceKm && runtime.earthDistanceKm > 1e-9)
      ? -dot(relVel, scale(relPos, 1 / runtime.earthDistanceKm))
      : null;

    const moonState = bodyStateFromNBody(state, "moon");
    const rocketState = rocketStateFromNBody(state);
    if (
      !moonState
      || !rocketState
      || !finiteVector(moonState.position)
      || !finiteVector(moonState.velocity || { x: 0, y: 0, z: 0 })
      || !finiteVector(rocketState.position)
      || !finiteVector(rocketState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      runtime.moonDistanceKm = null;
      runtime.moonClosingSpeedKmS = null;
      return;
    }
    const moonRelPos = subtract(rocketState.position, moonState.position);
    const moonRelVel = subtract(
      rocketState.velocity || { x: 0, y: 0, z: 0 },
      moonState.velocity || { x: 0, y: 0, z: 0 },
    );
    const moonDistanceKm = length(moonRelPos);
    runtime.moonDistanceKm = Number.isFinite(moonDistanceKm) ? moonDistanceKm : null;
    runtime.moonClosingSpeedKmS = (runtime.moonDistanceKm && runtime.moonDistanceKm > 1e-9)
      ? -dot(moonRelVel, scale(moonRelPos, 1 / runtime.moonDistanceKm))
      : null;
  }

  function missionTargetDescriptor() {
    const missionId = runtime.mission.selectedId;
    const missionPhase = runtime.mission.phase || "";
    if (missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
      const moonwardPhases = new Set([
        "launch_to_parking",
        "tli_burn",
        "coast_to_moon",
        "lunar_insertion",
        "lunar_orbit_hold",
      ]);
      if (moonwardPhases.has(missionPhase)) {
        return {
          bodyId: "moon",
          bodyName: "Moon",
          distanceKm: runtime.moonDistanceKm,
          closingSpeedKmS: runtime.moonClosingSpeedKmS,
        };
      }
      return {
        bodyId: "earth",
        bodyName: "Earth",
        distanceKm: runtime.earthDistanceKm,
        closingSpeedKmS: runtime.earthClosingSpeedKmS,
      };
    }
    return {
      bodyId: "earth",
      bodyName: "Earth",
      distanceKm: runtime.earthDistanceKm,
      closingSpeedKmS: runtime.earthClosingSpeedKmS,
    };
  }

  function earthFixedRelativePositionKm(rocketState, earthState, earthFrameAxes) {
    if (!rocketState?.position || !earthState?.position || !earthFrameAxes) {
      return null;
    }
    const rel = subtract(rocketState.position, earthState.position);
    return {
      x: dot(rel, earthFrameAxes.xAxis),
      y: dot(rel, earthFrameAxes.yAxis),
      z: dot(rel, earthFrameAxes.pole),
    };
  }

  function updateRuntimeSurfaceSample(rocketState, earthState, earthFrameAxes, earthRadiusKm) {
    if (!rocketState?.position || !earthState?.position) {
      runtime.lastSurfaceSample = null;
      return null;
    }
    const relativePosition = subtract(rocketState.position, earthState.position);
    const sample = sampleEarthSurfaceAtRelativePosition(
      relativePosition,
      earthFrameAxes,
      earthRadiusKm,
    );
    runtime.lastSurfaceSample = sample || null;
    return runtime.lastSurfaceSample;
  }

  function accumulateBodyDistanceKm(
    bodyState,
    earthState,
    earthFrameAxes,
    tracker,
  ) {
    const relativePositionKm = earthFixedRelativePositionKm(
      bodyState,
      earthState,
      earthFrameAxes,
    );
    if (!relativePositionKm) {
      return { distanceKm: 0, tracker };
    }
    const current = {
      x: Number(relativePositionKm.x) || 0,
      y: Number(relativePositionKm.y) || 0,
      z: Number(relativePositionKm.z) || 0,
    };
    if (!tracker) {
      return { distanceKm: 0, tracker: current };
    }
    const dx = current.x - tracker.x;
    const dy = current.y - tracker.y;
    const dz = current.z - tracker.z;
    const stepDistanceKm = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
    return {
      distanceKm: Number.isFinite(stepDistanceKm) && stepDistanceKm > 0 ? stepDistanceKm : 0,
      tracker: current,
    };
  }

  function accumulateDistanceTravelled(
    rocketState,
    earthState,
    earthFrameAxes,
    stageIndexForDistance = runtime.stageIndex,
  ) {
    const result = accumulateBodyDistanceKm(
      rocketState,
      earthState,
      earthFrameAxes,
      runtime.lastTrackedPositionKm,
    );
    runtime.lastTrackedPositionKm = result.tracker;
    if (!(result.distanceKm > 0)) {
      return;
    }
    if (stageIndexForDistance <= 0) {
      runtime.boosterDistanceKm += result.distanceKm;
    } else {
      runtime.starshipDistanceKm += result.distanceKm;
    }
  }

  function accumulateBoosterDistanceTravelled(boosterState, earthState, earthFrameAxes) {
    const result = accumulateBodyDistanceKm(
      boosterState,
      earthState,
      earthFrameAxes,
      runtime.booster.lastTrackedPositionKm,
    );
    runtime.booster.lastTrackedPositionKm = result.tracker;
    if (result.distanceKm > 0) {
      runtime.boosterDistanceKm += result.distanceKm;
    }
  }

  function ensureCatalogBodies(catalogBodies) {
    const next = Array.isArray(catalogBodies) ? [...catalogBodies] : [];
    const mergeOrInsert = (meta) => {
      const index = next.findIndex((body) => body.id === meta.id);
      if (index >= 0) {
        next[index] = {
          ...next[index],
          ...meta,
          mass_kg: Number(next[index].mass_kg) > 0 ? Number(next[index].mass_kg) : meta.mass_kg,
        };
        return;
      }
      next.push({ ...meta });
    };
    mergeOrInsert(LAUNCH_BODY_META);
    mergeOrInsert(LAUNCH_BOOSTER_META);
    return next;
  }

  function injectStartupEntry(entriesById, timestampMs = Date.now()) {
    if (!entriesById || entriesById.has(LAUNCH_BODY_ID)) {
      return;
    }
    const earthEntry = entriesById.get("earth");
    const earthPosition = earthEntry?.coordinates_km;
    if (
      !Number.isFinite(Number(earthPosition?.x))
      || !Number.isFinite(Number(earthPosition?.y))
      || !Number.isFinite(Number(earthPosition?.z))
    ) {
      return;
    }
    const earthVelocity = earthEntry?.coordinates_velocity_km_s;
    const earthState = {
      position: {
        x: Number(earthPosition.x),
        y: Number(earthPosition.y),
        z: Number(earthPosition.z),
      },
      velocity: {
        x: Number(earthVelocity?.x) || 0,
        y: Number(earthVelocity?.y) || 0,
        z: Number(earthVelocity?.z) || 0,
      },
    };
    const pad = computePadState({
      earthState,
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
      earthAxes: earthAxes(timestampMs),
    });
    if (!pad) {
      return;
    }
    entriesById.set(LAUNCH_BODY_ID, {
      id: LAUNCH_BODY_ID,
      name: LAUNCH_BODY_META.name,
      source: "SIMULATED",
      coordinates_km: pad.position,
      coordinates_velocity_km_s: pad.velocity,
      source_error: null,
    });
  }

  function ensureRocketInNBody(state, nowMs = Date.now()) {
    if (!state?.dynamicBodies) {
      return null;
    }
    const existing = state.dynamicBodies.get(LAUNCH_BODY_ID);
    if (existing) {
      return existing;
    }
    const earthState = earthStateFromNBody(state);
    if (!earthState) {
      return null;
    }
    const pad = computePadState({
      earthState,
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
      earthAxes: earthAxes(nowMs),
    });
    if (!pad) {
      return null;
    }
    const rocketState = {
      id: LAUNCH_BODY_ID,
      massKg: LAUNCH_INITIAL_MASS_KG,
      position: { ...pad.position },
      velocity: { ...pad.velocity },
    };
    state.dynamicBodies.set(LAUNCH_BODY_ID, rocketState);
    return rocketState;
  }

  function resetToPad(state, nowMs = Date.now()) {
    clearBoosterFromState(state);
    const earthState = earthStateFromNBody(state);
    const rocketState = ensureRocketInNBody(state, nowMs);
    if (!earthState || !rocketState) {
      runtime.lastError = "Earth/rocket state unavailable";
      emitLaunchError("reset_to_pad_failed", { reason: runtime.lastError });
      emitRuntimeTransitionEvents("reset_to_pad_failed");
      return false;
    }
    const currentEarthAxes = earthAxes(nowMs);
    const pad = computePadState({
      earthState,
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
      earthAxes: currentEarthAxes,
    });
    if (!pad) {
      runtime.lastError = "Pad state unavailable";
      emitLaunchError("reset_to_pad_failed", { reason: runtime.lastError });
      emitRuntimeTransitionEvents("reset_to_pad_failed");
      return false;
    }
    rocketState.position = { ...pad.position };
    rocketState.velocity = { ...pad.velocity };
    rocketState.massKg = LAUNCH_INITIAL_MASS_KG;
    applyEarthSurfaceContactForVehicle({
      rocketState,
      earthState,
      earthAxes: currentEarthAxes,
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
      earthSiderealRateRadS: EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
      referenceOffsetKm: STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM,
      dtSeconds: 0,
      thrustN: 0,
    });
    resetRuntime();
    runtime.lastTrackedPositionKm = earthFixedRelativePositionKm(
      rocketState,
      earthState,
      currentEarthAxes,
    );
    updateRuntimeSurfaceSample(
      rocketState,
      earthState,
      currentEarthAxes,
      Number(getEarthRadiusKm?.()) || 6371,
    );
    runtime.launchPlaneNormal = computeLaunchPlaneNormal(currentEarthAxes);
    runtime.phase = "idle";
    const relPos = subtract(rocketState.position, earthState.position);
    const relVel = subtract(
      rocketState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    updateRuntimeTargetMetrics(state, relPos, relVel);
    const atmosphereSample = sampleEarthAtmosphere?.(LAUNCH_SITE.altitudeKm) || null;
    const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
      atmosphereSample,
      relPos,
      relVel,
      currentEarthAxes.pole,
    );
    runtime.lastTelemetry = telemetryFromState({
      gravitationalConstantKm3PerKgS2,
      earthMassKg: Number(getEarthMassKg?.()) || 0,
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
      earthState,
      rocketState,
      atmosphereSample,
      earthPole: currentEarthAxes.pole,
      dynamicPressurePaOverride: dynamicPressurePa,
      runtime,
    });
    emitLaunchEvent("launch_vehicle_reset_to_pad", {
      launchSiteName: LAUNCH_SITE.name || "Launch Site",
      launchSiteLatitudeDeg: Number(LAUNCH_SITE.latitudeDeg),
      launchSiteLongitudeDeg: Number(LAUNCH_SITE.longitudeDeg),
      ...telemetryLogDetails(runtime.lastTelemetry),
    });
    emitRuntimeTransitionEvents("reset_to_pad");
    return true;
  }

  function startLaunch(state, nowMs = Date.now()) {
    if (!resetToPad(state, nowMs)) {
      return false;
    }
    runtime.phase = "powered";
    runtime.autopilotMode = runtime.autopilotEnabled ? "autopilot-vertical-ascent" : "manual-ascent";
    setMissionPhase(runtime, defaultMissionPhaseForProfileId(runtime.mission.selectedId));
    runtime.mission.phaseStartedElapsedSec = runtime.elapsedSeconds;
    runtime.mission.completed = false;
    emitLaunchEvent("launch_started", {
      launchSiteName: LAUNCH_SITE.name || "Launch Site",
      autopilotEnabled: runtime.autopilotEnabled,
      missionId: runtime.mission.selectedId,
      missionPhase: runtime.mission.phase,
    });
    emitRuntimeTransitionEvents("start_launch");
    return true;
  }

  function createSeparatedBoosterState({
    state,
    rocketState,
    earthState,
    currentEarthAxes,
    stage,
  }) {
    if (!state?.dynamicBodies || !rocketState || !earthState || !stage) {
      return null;
    }
    const reservePropellantKg = Math.min(
      Math.max(0, runtime.stagePropellantKg),
      stageReservePropellantKg(0),
    );
    const boosterDryMassKg = Number(stage.dryMassKg) || Number(LAUNCH_BOOSTER_CONFIG.dryMassKg) || 0;
    const boosterMassKg = boosterDryMassKg + reservePropellantKg;
    if (!(boosterMassKg > 0)) {
      return null;
    }

    const relPos = subtract(rocketState.position, earthState.position);
    const relVel = subtract(
      rocketState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    const up = normalize(relPos, currentEarthAxes.pole);
    const retrograde = normalize(scale(relVel, -1), scale(up, -1));
    const separationOffsetKm = STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM + BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM + 0.02;
    const separationImpulseKmS = add(
      scale(retrograde, 0.018),
      scale(up, -0.010),
    );
    const boosterState = {
      id: LAUNCH_BOOSTER_BODY_ID,
      massKg: boosterMassKg,
      position: add(rocketState.position, scale(up, -separationOffsetKm)),
      velocity: add(rocketState.velocity, separationImpulseKmS),
    };
    state.dynamicBodies.set(LAUNCH_BOOSTER_BODY_ID, boosterState);

    runtime.booster.active = true;
    runtime.booster.phase = "separation-coast";
    runtime.booster.guidanceMode = "booster-separation-coast";
    runtime.booster.propellantKg = reservePropellantKg;
    runtime.booster.initialPropellantKg = reservePropellantKg;
    runtime.booster.separationTimeSec = runtime.elapsedSeconds;
    runtime.booster.landed = false;
    runtime.booster.lastStep = zeroBoosterStep("booster-separation-coast");
    runtime.booster.lastSurfaceSample = null;
    runtime.booster.contactHoldSec = 0;
    runtime.booster.lastTrackedPositionKm = earthFixedRelativePositionKm(
      boosterState,
      earthState,
      currentEarthAxes,
    );
    runtime.booster.telemetry = null;
    emitLaunchEvent("stage_separation_booster_detached", {
      stageIndex: runtime.stageIndex,
      boosterMassKg,
      reservePropellantKg,
      separationOffsetKm,
      separationImpulseKmS,
    });
    emitRuntimeTransitionEvents("stage_separation");
    return boosterState;
  }

  function prepareBoosterStep(state, dtSeconds, nowMs = Date.now()) {
    if (!runtime.booster.active) {
      runtime.booster.lastStep = null;
      return;
    }
    const earthState = earthStateFromNBody(state);
    const boosterState = boosterStateFromNBody(state);
    if (!earthState || !boosterState) {
      runtime.booster.lastStep = zeroBoosterStep("booster-inactive");
      runtime.booster.active = false;
      runtime.booster.phase = "idle";
      runtime.booster.guidanceMode = "booster-inactive";
      return;
    }
    if (
      !finiteVector(earthState.position) ||
      !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 }) ||
      !finiteVector(boosterState.position) ||
      !finiteVector(boosterState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      emitLaunchError("booster_state_non_finite_prepare", {
        earthPositionFinite: finiteVector(earthState.position),
        earthVelocityFinite: finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 }),
        boosterPositionFinite: finiteVector(boosterState.position),
        boosterVelocityFinite: finiteVector(boosterState.velocity || { x: 0, y: 0, z: 0 }),
      });
      clearBoosterFromState(state);
      runtime.booster.lastStep = zeroBoosterStep("booster-invalid-state");
      return;
    }

    const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
    const currentEarthAxes = earthAxes(nowMs);
    const relPos = subtract(boosterState.position, earthState.position);
    const relVel = subtract(
      boosterState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    const muKm3S2 = gravitationalConstantKm3PerKgS2 * (Number(getEarthMassKg?.()) || 0);
    const orbital = orbitalStateFromRelative(muKm3S2, earthRadiusKm, relPos, relVel);
    const altitudeKm = Math.max(0, orbital.altitudeKm);
    const atmosphereSample = sampleEarthAtmosphere?.(altitudeKm) || null;
    const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
      atmosphereSample,
      relPos,
      relVel,
      currentEarthAxes.pole,
    );
    const padState = computePadState({
      earthState,
      earthRadiusKm,
      earthAxes: currentEarthAxes,
      referenceOffsetKm: BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM,
    });
    const launchSiteVector = padState
      ? subtract(padState.position, boosterState.position)
      : { x: 0, y: 0, z: 0 };
    const launchSiteRangeKm = padState ? length(launchSiteVector) : Number.POSITIVE_INFINITY;
    const launchSiteLateralVector = subtract(launchSiteVector, scale(orbital.up, dot(launchSiteVector, orbital.up)));
    const launchSiteLateralRangeKm = padState ? length(launchSiteLateralVector) : Number.POSITIVE_INFINITY;
    const padVelocity = padState?.velocity || earthState.velocity || { x: 0, y: 0, z: 0 };
    const relVelocityToPad = subtract(
      boosterState.velocity || { x: 0, y: 0, z: 0 },
      padVelocity,
    );
    const launchSiteLateralDirection = normalize(
      launchSiteLateralVector,
      normalize(scale(orbital.tangentialVector, -1), orbital.up),
    );
    const launchSiteLateralClosingSpeedKmS = dot(scale(relVelocityToPad, -1), launchSiteLateralDirection);
    const command = computeBoosterRecoveryCommand({
      altitudeKm,
      radialSpeedKmS: orbital.radialSpeedKmS,
      tangentialSpeedKmS: orbital.tangentialSpeedKmS,
      dynamicPressurePa,
      remainingPropellantKg: runtime.booster.propellantKg,
      reserveLandingPropellantKg: stageReservePropellantKg(0),
      timeSinceSeparationSec: Math.max(0, runtime.elapsedSeconds - runtime.booster.separationTimeSec),
      launchSiteRangeKm,
      launchSiteLateralRangeKm,
      launchSiteLateralClosingSpeedKmS,
    });

    const up = orbital.up;
    let direction = composeBoosterDirection(up, relVel, orbital.tangentialVector, command.directionMix);
    if (padState) {
      const lateralToSiteDirection = lateralDirectionTowardTarget(
        boosterState.position,
        padState.position,
        up,
        direction,
      );
      const siteVectorWeight = clamp(
        Number(command.siteVectorWeight) || 0,
        0,
        altitudeKm > 40 ? 0.85 : altitudeKm > 10 ? 0.42 : 0.16,
      );
      if (siteVectorWeight > 1e-6) {
        direction = normalize(mixVectors(direction, lateralToSiteDirection, siteVectorWeight), direction);
      }
      const siteVelocityWeight = clamp(
        Number(command.siteVelocityWeight) || 0,
        0,
        altitudeKm > 25 ? 0.62 : altitudeKm > 8 ? 0.34 : 0.18,
      );
      if (siteVelocityWeight > 1e-6) {
        const padRetrogradeDirection = normalize(scale(relVelocityToPad, -1), direction);
        direction = normalize(mixVectors(direction, padRetrogradeDirection, siteVelocityWeight), direction);
      }
    }
    const pressurePa = Number(atmosphereSample?.pressurePa) || 0;
    const landingPhase = command.phase === "landing-burn" || command.phase === "landed";
    const protectedReserveKg = landingPhase
      ? 0
      : (
        command.phase === "entry-burn"
          ? stageReservePropellantKg(0) * 0.7
          : stageReservePropellantKg(0)
      );
    const burnablePropellantKg = Math.max(0, runtime.booster.propellantKg - protectedReserveKg);
    const canBurn = burnablePropellantKg > 1e-6 && !runtime.booster.landed;
    const requestedThrottle = canBurn ? clamp(Number(command.throttle) || 0, 0, 1) : 0;
    const fullThrustN = interpolateSeaToVac(
      Number(LAUNCH_BOOSTER_CONFIG.thrustVacuumN) || 0,
      Number(LAUNCH_BOOSTER_CONFIG.thrustSeaLevelN) || 0,
      pressurePa,
    );
    const thrustN = fullThrustN * requestedThrottle;
    const ispS = interpolateSeaToVac(
      Number(LAUNCH_BOOSTER_CONFIG.ispVacuumS) || 0,
      Number(LAUNCH_BOOSTER_CONFIG.ispSeaLevelS) || 0,
      pressurePa,
    );
    const burnRateKgS = thrustN > 0 && ispS > 0
      ? thrustN / (ispS * STANDARD_GRAVITY_M_S2)
      : 0;
    const burnKg = Math.min(burnablePropellantKg, burnRateKgS * dtSeconds);
    const effectiveMassKg = Math.max(
      MIN_ROCKET_MASS_KG,
      (Number(boosterState.massKg) || MIN_ROCKET_MASS_KG) - (0.5 * burnKg),
    );
    const accelerationMagKmS2 = thrustN > 0
      ? (thrustN / effectiveMassKg) / 1000
      : 0;
    runtime.booster.phase = command.phase || "descent";
    runtime.booster.guidanceMode = command.guidanceMode || "booster-guidance";
    const boosterRcs = computeBoosterRcsAssist({
      desiredDirection: direction,
      relVel,
      up,
      throttle: requestedThrottle,
      phase: command.phase || runtime.booster.phase,
      guidanceMode: command.guidanceMode || runtime.booster.guidanceMode,
    });
    let rcsBurnRateKgS = runtime.booster.propellantKg > 1e-9
      ? boosterRcsPropellantBurnRateKgS(boosterRcs)
      : 0;
    const burnKgAfterMain = Math.max(0, runtime.booster.propellantKg - burnKg);
    const rcsBurnKg = Math.min(burnKgAfterMain, rcsBurnRateKgS * dtSeconds);
    if (!(rcsBurnKg > 1e-12)) {
      boosterRcs.active = false;
      boosterRcs.authority = 0;
      boosterRcs.jets = [];
      rcsBurnRateKgS = 0;
    }
    runtime.booster.lastStep = {
      accelerationKmS2: scale(direction, accelerationMagKmS2),
      throttle: requestedThrottle,
      thrustN,
      burnKg,
      burnRateKgS,
      rcsBurnKg,
      rcsBurnRateKgS,
      dynamicPressurePa,
      guidanceMode: requestedThrottle <= 0 && !landingPhase && stageReservePropellantKg(0) > 0
        ? `${runtime.booster.guidanceMode}+reserve-hold`
        : runtime.booster.guidanceMode,
      touchdownReady: Boolean(command.touchdownReady),
      rcsActive: boosterRcs.active,
      rcsErrorDeg: boosterRcs.errorDeg,
      rcsAuthority: boosterRcs.authority,
      rcsJets: boosterRcs.jets,
    };
    runtime.booster.telemetry = boosterTelemetryFromState({
      gravitationalConstantKm3PerKgS2,
      earthMassKg: Number(getEarthMassKg?.()) || 0,
      earthRadiusKm,
      earthState,
      boosterState,
      atmosphereSample,
      earthPole: currentEarthAxes.pole,
      dynamicPressurePaOverride: dynamicPressurePa,
      runtime,
    });
    if (runtime.booster.telemetry) {
      runtime.booster.telemetry.launchSiteRangeKm = Number.isFinite(launchSiteRangeKm) ? launchSiteRangeKm : null;
      runtime.booster.telemetry.launchSiteLateralRangeKm = Number.isFinite(launchSiteLateralRangeKm)
        ? launchSiteLateralRangeKm
        : null;
      runtime.booster.telemetry.launchSiteLateralClosingSpeedKmS = Number.isFinite(launchSiteLateralClosingSpeedKmS)
        ? launchSiteLateralClosingSpeedKmS
        : null;
    }
  }

  function finalizeBoosterStep(state, dtSeconds, nowMs = Date.now()) {
    if (!runtime.booster.active && !runtime.booster.landed) {
      return;
    }
    const boosterState = boosterStateFromNBody(state);
    const earthState = earthStateFromNBody(state);
    if (!boosterState || !earthState) {
      clearBoosterFromState(state);
      return;
    }
    if (
      !finiteVector(earthState.position) ||
      !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 }) ||
      !finiteVector(boosterState.position) ||
      !finiteVector(boosterState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      emitLaunchError("booster_state_non_finite_finalize", {
        earthPositionFinite: finiteVector(earthState.position),
        earthVelocityFinite: finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 }),
        boosterPositionFinite: finiteVector(boosterState.position),
        boosterVelocityFinite: finiteVector(boosterState.velocity || { x: 0, y: 0, z: 0 }),
      });
      clearBoosterFromState(state);
      return;
    }

    const burnKg = Number(runtime.booster.lastStep?.burnKg) || 0;
    const rcsBurnKg = Number(runtime.booster.lastStep?.rcsBurnKg) || 0;
    const totalBurnKg = Math.max(0, burnKg + rcsBurnKg);
    if (totalBurnKg > 0) {
      boosterState.massKg = Math.max(
        Number(LAUNCH_BOOSTER_CONFIG.dryMassKg) || MIN_ROCKET_MASS_KG,
        boosterState.massKg - totalBurnKg,
      );
      runtime.booster.propellantKg = Math.max(0, runtime.booster.propellantKg - totalBurnKg);
    }

    const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
    const currentEarthAxes = earthAxes(nowMs);
    const contact = applyEarthSurfaceContactForVehicle({
      rocketState: boosterState,
      earthState,
      earthAxes: currentEarthAxes,
      earthRadiusKm,
      earthSiderealRateRadS: EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
      referenceOffsetKm: BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM,
      dtSeconds,
      thrustN: Number(runtime.booster.lastStep?.thrustN) || 0,
    });
    if (contact?.surfaceSample) {
      runtime.booster.lastSurfaceSample = contact.surfaceSample;
    }

    const relPosNow = subtract(boosterState.position, earthState.position);
    const relVelNow = subtract(
      boosterState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    const speedKmS = length(relVelNow);
    const altitudeKm = Math.max(0, length(relPosNow) - earthRadiusKm);
    const terrainAltKm = Number(runtime.booster.lastSurfaceSample?.altitudeAboveTerrainKm);
    const centerAboveTerrainKm = Number.isFinite(terrainAltKm) ? terrainAltKm : altitudeKm;
    const bodyAboveTerrainKm = centerAboveTerrainKm - BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM;

    if (
      (contact?.contact || bodyAboveTerrainKm <= 0.02)
      && speedKmS < 0.04
    ) {
      runtime.booster.contactHoldSec += Math.max(0, dtSeconds);
    } else {
      runtime.booster.contactHoldSec = 0;
    }
    if (runtime.booster.contactHoldSec >= 1.5) {
      runtime.booster.landed = true;
      runtime.booster.phase = "landed";
      runtime.booster.guidanceMode = "booster-landed";
      runtime.booster.lastStep = zeroBoosterStep("booster-landed");
      runtime.booster.active = false;
    }

    const atmosphereSample = sampleEarthAtmosphere?.(Math.max(0, altitudeKm)) || null;
    const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
      atmosphereSample,
      relPosNow,
      relVelNow,
      currentEarthAxes.pole,
    );
    const padState = computePadState({
      earthState,
      earthRadiusKm,
      earthAxes: currentEarthAxes,
      referenceOffsetKm: BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM,
    });
    const launchSiteVector = padState
      ? subtract(padState.position, boosterState.position)
      : { x: 0, y: 0, z: 0 };
    const launchSiteRangeKm = padState ? length(launchSiteVector) : Number.POSITIVE_INFINITY;
    const launchSiteLateralVector = subtract(launchSiteVector, scale(normalize(relPosNow, currentEarthAxes.pole), dot(launchSiteVector, normalize(relPosNow, currentEarthAxes.pole))));
    const launchSiteLateralRangeKm = padState ? length(launchSiteLateralVector) : Number.POSITIVE_INFINITY;
    const padVelocity = padState?.velocity || earthState.velocity || { x: 0, y: 0, z: 0 };
    const relVelocityToPad = subtract(
      boosterState.velocity || { x: 0, y: 0, z: 0 },
      padVelocity,
    );
    const launchSiteLateralDirection = normalize(
      launchSiteLateralVector,
      normalize(scale(relVelNow, -1), currentEarthAxes.pole),
    );
    const launchSiteLateralClosingSpeedKmS = dot(scale(relVelocityToPad, -1), launchSiteLateralDirection);
    runtime.booster.telemetry = boosterTelemetryFromState({
      gravitationalConstantKm3PerKgS2,
      earthMassKg: Number(getEarthMassKg?.()) || 0,
      earthRadiusKm,
      earthState,
      boosterState,
      atmosphereSample,
      earthPole: currentEarthAxes.pole,
      dynamicPressurePaOverride: dynamicPressurePa,
      runtime,
    });
    if (runtime.booster.telemetry) {
      runtime.booster.telemetry.launchSiteRangeKm = Number.isFinite(launchSiteRangeKm) ? launchSiteRangeKm : null;
      runtime.booster.telemetry.launchSiteLateralRangeKm = Number.isFinite(launchSiteLateralRangeKm)
        ? launchSiteLateralRangeKm
        : null;
      runtime.booster.telemetry.launchSiteLateralClosingSpeedKmS = Number.isFinite(launchSiteLateralClosingSpeedKmS)
        ? launchSiteLateralClosingSpeedKmS
        : null;
    }
  }

  function prepareStep(state, dtSeconds, nowMs = Date.now()) {
    runtime.lastStep = null;
    try {
      prepareBoosterStep(state, dtSeconds, nowMs);
      if (runtime.phase === "idle") {
        return;
      }
      if (runtime.phase === "complete") {
        runtime.phase = "coast";
      }

    const earthState = earthStateFromNBody(state);
    const rocketState = ensureRocketInNBody(state, nowMs);
    if (!earthState || !rocketState) {
      runtime.lastError = "Earth/rocket state unavailable";
      runtime.phase = "idle";
      return;
    }
    if (
      !finiteVector(earthState.position) ||
      !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 }) ||
      !finiteVector(rocketState.position) ||
      !finiteVector(rocketState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      runtime.lastError = "Earth/rocket state became non-finite during prepare step";
      emitLaunchError("starship_state_non_finite_prepare", {
        earthPositionFinite: finiteVector(earthState.position),
        earthVelocityFinite: finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 }),
        rocketPositionFinite: finiteVector(rocketState.position),
        rocketVelocityFinite: finiteVector(rocketState.velocity || { x: 0, y: 0, z: 0 }),
      });
      runtime.phase = "idle";
      return;
    }

    const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
    const relPos = subtract(rocketState.position, earthState.position);
    const relVel = subtract(
      rocketState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    updateRuntimeTargetMetrics(state, relPos, relVel);
    const muKm3S2 = gravitationalConstantKm3PerKgS2 * (Number(getEarthMassKg?.()) || 0);
    const orbital = orbitalStateFromRelative(muKm3S2, earthRadiusKm, relPos, relVel);
    const altitudeKm = Math.max(0, length(relPos) - earthRadiusKm);
    const atmo = sampleEarthAtmosphere?.(altitudeKm) || null;
    const currentEarthAxes = earthAxes(nowMs);
    const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
      atmo,
      relPos,
      relVel,
      currentEarthAxes.pole,
    );
    const moonTransferMissionActive = isMoonTransferMissionActive(runtime);
    updateRuntimeSurfaceSample(rocketState, earthState, currentEarthAxes, earthRadiusKm);

    if (runtime.phase === "orbit" && moonTransferMissionActive) {
      runtime.phase = "coast";
    }
    if (runtime.phase === "orbit") {
      const stableTargetOrbit = orbitInsertionWithinTolerance(
        orbital,
        LAUNCH_AUTOPILOT_CONFIG,
        runtime.targetOrbitAltitudeKm || LAUNCH_AUTOPILOT_CONFIG.targetOrbitAltitudeKm,
      );
      if (!stableTargetOrbit) {
        runtime.phase = "coast";
        runtime.autopilotMode = "autopilot-coast-to-circularize";
      } else {
        runtime.lastStep = {
          accelerationKmS2: { x: 0, y: 0, z: 0 },
          throttle: 0,
          thrustN: 0,
          burnKg: 0,
          burnRateKgS: 0,
          dynamicPressurePa,
          guidanceMode: runtime.autopilotMode || "orbit-hold",
          rcsActive: false,
          rcsErrorDeg: 0,
          rcsAuthority: 0,
          rcsJets: [],
        };
        runtime.lastTelemetry = telemetryFromState({
          gravitationalConstantKm3PerKgS2,
          earthMassKg: Number(getEarthMassKg?.()) || 0,
          earthRadiusKm,
          earthState,
          rocketState,
          atmosphereSample: atmo,
          earthPole: currentEarthAxes.pole,
          dynamicPressurePaOverride: dynamicPressurePa,
          runtime,
        });
        return;
      }
    }

    if (runtime.coastRemainingSec > 0) {
      runtime.coastRemainingSec = Math.max(0, runtime.coastRemainingSec - dtSeconds);
      runtime.phase = runtime.coastRemainingSec > 0 ? "coast" : "powered";
      const coastDirection = normalize(relVel, orbital.up);
      const rcs = computeRcsAssist({
        stageIndex: runtime.stageIndex,
        desiredDirection: coastDirection,
        relVel,
        up: orbital.up,
      });
      runtime.lastStep = {
        accelerationKmS2: rcs.accelerationKmS2,
        throttle: 0,
        thrustN: 0,
        burnKg: 0,
        burnRateKgS: 0,
        dynamicPressurePa,
        guidanceMode: "stage-separation-coast",
        rcsActive: rcs.active,
        rcsErrorDeg: rcs.errorDeg,
        rcsAuthority: rcs.authority,
        rcsJets: rcs.jets,
      };
      runtime.lastTelemetry = telemetryFromState({
        gravitationalConstantKm3PerKgS2,
        earthMassKg: Number(getEarthMassKg?.()) || 0,
        earthRadiusKm,
        earthState,
        rocketState,
        atmosphereSample: atmo,
        earthPole: currentEarthAxes.pole,
        dynamicPressurePaOverride: dynamicPressurePa,
        runtime,
      });
      return;
    }

    if (runtime.phase === "coast") {
      if (runtime.autopilotEnabled) {
        let autopilotCommand = computeAutopilotCommand({
          runtime,
          orbital,
          relPos,
          relVel,
          up: orbital.up,
          earthPole: currentEarthAxes.pole,
          muKm3S2,
          earthRadiusKm,
          dynamicPressurePa,
        });
        const missionCommand = computeMissionAutopilotCommand({
          runtime,
          state,
          earthState,
          rocketState,
          orbital,
          relPos,
          relVel,
          up: orbital.up,
          earthPole: currentEarthAxes.pole,
          muKm3S2,
          gravitationalConstantKm3PerKgS2,
          earthRadiusKm,
          getBodyRadiusKm,
          getBodyMassKg,
        });
        if (missionCommand) {
          autopilotCommand = missionCommand;
        }
        if (autopilotCommand.phase === "powered") {
          runtime.phase = "powered";
        } else if (autopilotCommand.phase === "orbit" && !moonTransferMissionActive) {
          runtime.phase = "orbit";
          runtime.autopilotMode = autopilotCommand.mode || runtime.autopilotMode;
          const rcs = computeRcsAssist({
            stageIndex: runtime.stageIndex,
            desiredDirection: autopilotCommand.direction || normalize(relVel, orbital.up),
            relVel,
            up: orbital.up,
          });
          runtime.lastStep = {
            accelerationKmS2: rcs.accelerationKmS2,
            throttle: 0,
            thrustN: 0,
            burnKg: 0,
            burnRateKgS: 0,
            dynamicPressurePa,
            guidanceMode: autopilotCommand.mode || "autopilot-orbital-hold",
            rcsActive: rcs.active,
            rcsErrorDeg: rcs.errorDeg,
            rcsAuthority: rcs.authority,
            rcsJets: rcs.jets,
          };
          runtime.lastTelemetry = telemetryFromState({
            gravitationalConstantKm3PerKgS2,
            earthMassKg: Number(getEarthMassKg?.()) || 0,
            earthRadiusKm,
            earthState,
            rocketState,
            atmosphereSample: atmo,
            earthPole: currentEarthAxes.pole,
            dynamicPressurePaOverride: dynamicPressurePa,
            runtime,
          });
          return;
        } else {
          const rcs = computeRcsAssist({
            stageIndex: runtime.stageIndex,
            desiredDirection: autopilotCommand.direction || normalize(relVel, orbital.up),
            relVel,
            up: orbital.up,
          });
          runtime.lastStep = {
            accelerationKmS2: rcs.accelerationKmS2,
            throttle: 0,
            thrustN: 0,
            burnKg: 0,
            burnRateKgS: 0,
            dynamicPressurePa,
            guidanceMode: autopilotCommand.mode || "coast",
            rcsActive: rcs.active,
            rcsErrorDeg: rcs.errorDeg,
            rcsAuthority: rcs.authority,
            rcsJets: rcs.jets,
          };
          runtime.lastTelemetry = telemetryFromState({
            gravitationalConstantKm3PerKgS2,
            earthMassKg: Number(getEarthMassKg?.()) || 0,
            earthRadiusKm,
            earthState,
            rocketState,
            atmosphereSample: atmo,
            earthPole: currentEarthAxes.pole,
            dynamicPressurePaOverride: dynamicPressurePa,
            runtime,
          });
          return;
        }
      } else {
        const rcs = computeRcsAssist({
          stageIndex: runtime.stageIndex,
          desiredDirection: normalize(relVel, orbital.up),
          relVel,
          up: orbital.up,
        });
        runtime.lastStep = {
          accelerationKmS2: rcs.accelerationKmS2,
          throttle: 0,
          thrustN: 0,
          burnKg: 0,
          burnRateKgS: 0,
          dynamicPressurePa,
          guidanceMode: "coast",
          rcsActive: rcs.active,
          rcsErrorDeg: rcs.errorDeg,
          rcsAuthority: rcs.authority,
          rcsJets: rcs.jets,
        };
        runtime.lastTelemetry = telemetryFromState({
          gravitationalConstantKm3PerKgS2,
          earthMassKg: Number(getEarthMassKg?.()) || 0,
          earthRadiusKm,
          earthState,
          rocketState,
          atmosphereSample: atmo,
          earthPole: currentEarthAxes.pole,
          dynamicPressurePaOverride: dynamicPressurePa,
          runtime,
        });
        return;
      }
    }

    const stage = stageAtIndex(runtime.stageIndex);
    if (!stage) {
      const stableOrbit = orbital.specificEnergy < 0 && Number(orbital.periapsisKm) > 80;
      runtime.phase = stableOrbit ? "orbit" : "coast";
      runtime.autopilotMode = stableOrbit ? "autopilot-ballistic-hold" : "ballistic-coast";
      return;
    }

    const pressurePa = Number(atmo?.pressurePa) || 0;
    let throttle = throttleForState(runtime.stageIndex, runtime.elapsedSeconds, dynamicPressurePa);
    let guidance = guidanceDirection({
      rocketState,
      earthState,
      earthAxes: currentEarthAxes,
      elapsedSeconds: runtime.elapsedSeconds,
    });

    if (runtime.autopilotEnabled) {
      let autopilotCommand = computeAutopilotCommand({
        runtime,
        orbital,
        relPos,
        relVel,
        up: orbital.up,
        earthPole: currentEarthAxes.pole,
        muKm3S2,
        earthRadiusKm,
        dynamicPressurePa,
      });
      const missionCommand = computeMissionAutopilotCommand({
        runtime,
        state,
        earthState,
        rocketState,
        orbital,
        relPos,
        relVel,
        up: orbital.up,
        earthPole: currentEarthAxes.pole,
        muKm3S2,
        gravitationalConstantKm3PerKgS2,
        earthRadiusKm,
        getBodyRadiusKm,
        getBodyMassKg,
      });
      if (missionCommand) {
        autopilotCommand = missionCommand;
      }
      if (autopilotCommand.phase === "coast") {
        runtime.phase = "coast";
        const rcs = computeRcsAssist({
          stageIndex: runtime.stageIndex,
          desiredDirection: autopilotCommand.direction || guidance.direction,
          relVel,
          up: orbital.up,
        });
        runtime.lastStep = {
          accelerationKmS2: rcs.accelerationKmS2,
          throttle: 0,
          thrustN: 0,
          burnKg: 0,
          burnRateKgS: 0,
          dynamicPressurePa,
          guidanceMode: autopilotCommand.mode || "autopilot-coast",
          rcsActive: rcs.active,
          rcsErrorDeg: rcs.errorDeg,
          rcsAuthority: rcs.authority,
          rcsJets: rcs.jets,
        };
        runtime.lastTelemetry = telemetryFromState({
          gravitationalConstantKm3PerKgS2,
          earthMassKg: Number(getEarthMassKg?.()) || 0,
          earthRadiusKm,
          earthState,
          rocketState,
          atmosphereSample: atmo,
          earthPole: currentEarthAxes.pole,
          dynamicPressurePaOverride: dynamicPressurePa,
          runtime,
        });
        return;
      }
      if (autopilotCommand.phase === "orbit" && !moonTransferMissionActive) {
        runtime.phase = "orbit";
        runtime.autopilotMode = autopilotCommand.mode || runtime.autopilotMode;
        const rcs = computeRcsAssist({
          stageIndex: runtime.stageIndex,
          desiredDirection: autopilotCommand.direction || guidance.direction,
          relVel,
          up: orbital.up,
        });
        runtime.lastStep = {
          accelerationKmS2: rcs.accelerationKmS2,
          throttle: 0,
          thrustN: 0,
          burnKg: 0,
          burnRateKgS: 0,
          dynamicPressurePa,
          guidanceMode: autopilotCommand.mode || "autopilot-orbital-hold",
          rcsActive: rcs.active,
          rcsErrorDeg: rcs.errorDeg,
          rcsAuthority: rcs.authority,
          rcsJets: rcs.jets,
        };
        runtime.lastTelemetry = telemetryFromState({
          gravitationalConstantKm3PerKgS2,
          earthMassKg: Number(getEarthMassKg?.()) || 0,
          earthRadiusKm,
          earthState,
          rocketState,
          atmosphereSample: atmo,
          earthPole: currentEarthAxes.pole,
          dynamicPressurePaOverride: dynamicPressurePa,
          runtime,
        });
        return;
      }
      if (autopilotCommand.phase === "orbit" && moonTransferMissionActive) {
        runtime.phase = "coast";
        const rcs = computeRcsAssist({
          stageIndex: runtime.stageIndex,
          desiredDirection: autopilotCommand.direction || guidance.direction,
          relVel,
          up: orbital.up,
        });
        runtime.lastStep = {
          accelerationKmS2: rcs.accelerationKmS2,
          throttle: 0,
          thrustN: 0,
          burnKg: 0,
          burnRateKgS: 0,
          dynamicPressurePa,
          guidanceMode: autopilotCommand.mode || "mission-moon-orbit-return:coast",
          rcsActive: rcs.active,
          rcsErrorDeg: rcs.errorDeg,
          rcsAuthority: rcs.authority,
          rcsJets: rcs.jets,
        };
        runtime.lastTelemetry = telemetryFromState({
          gravitationalConstantKm3PerKgS2,
          earthMassKg: Number(getEarthMassKg?.()) || 0,
          earthRadiusKm,
          earthState,
          rocketState,
          atmosphereSample: atmo,
          earthPole: currentEarthAxes.pole,
          dynamicPressurePaOverride: dynamicPressurePa,
          runtime,
        });
        return;
      }
      throttle = clamp(Number(autopilotCommand.throttle), 0, 1);
      guidance = {
        direction: autopilotCommand.direction || guidance.direction,
        mode: autopilotCommand.mode || guidance.mode,
      };
    }

    throttle = limitThrottleByThrustAccelerationG({
      stage,
      stageIndex: runtime.stageIndex,
      pressurePa,
      throttle,
      massKg: Math.max(MIN_ROCKET_MASS_KG, Number(rocketState.massKg) || 0),
    });

    const thrustN =
      interpolateSeaToVac(stage.thrustVacuumN, stage.thrustSeaLevelN, pressurePa)
      * throttle;
    const ispS = interpolateSeaToVac(stage.ispVacuumS, stage.ispSeaLevelS, pressurePa);
    const burnRateKgS = thrustN > 0 && ispS > 0
      ? thrustN / (ispS * STANDARD_GRAVITY_M_S2)
      : 0;
    const reservePropellantKg = stageReservePropellantKg(runtime.stageIndex);
    const availablePropellantKg = Math.max(0, runtime.stagePropellantKg - reservePropellantKg);
    const burnKg = Math.min(availablePropellantKg, burnRateKgS * dtSeconds);
    const effectiveMassKg = Math.max(
      MIN_ROCKET_MASS_KG,
      rocketState.massKg - (0.5 * burnKg),
    );
    const accelerationMagKmS2 = thrustN > 0
      ? (thrustN / effectiveMassKg) / 1000
      : 0;
    const mainAccelerationKmS2 = scale(guidance.direction, accelerationMagKmS2);
    const rcs = computeRcsAssist({
      stageIndex: runtime.stageIndex,
      desiredDirection: guidance.direction,
      relVel,
      up: orbital.up,
    });
    runtime.lastStep = {
      accelerationKmS2: add(mainAccelerationKmS2, rcs.accelerationKmS2),
      throttle,
      thrustN,
      burnKg,
      burnRateKgS,
      dynamicPressurePa,
      guidanceMode: guidance.mode,
      rcsActive: rcs.active,
      rcsErrorDeg: rcs.errorDeg,
      rcsAuthority: rcs.authority,
      rcsJets: rcs.jets,
    };
      runtime.lastTelemetry = telemetryFromState({
        gravitationalConstantKm3PerKgS2,
        earthMassKg: Number(getEarthMassKg?.()) || 0,
        earthRadiusKm,
        earthState,
        rocketState,
        atmosphereSample: atmo,
        earthPole: currentEarthAxes.pole,
        dynamicPressurePaOverride: dynamicPressurePa,
        runtime,
      });
    } finally {
      emitRuntimeTransitionEvents("prepare_step");
    }
  }

  function externalAccelerationKmS2(bodyId) {
    if (bodyId === LAUNCH_BODY_ID) {
      return runtime.lastStep?.accelerationKmS2 || { x: 0, y: 0, z: 0 };
    }
    if (bodyId === LAUNCH_BOOSTER_BODY_ID) {
      return runtime.booster.lastStep?.accelerationKmS2 || { x: 0, y: 0, z: 0 };
    }
    return { x: 0, y: 0, z: 0 };
  }

  function finalizeStep(state, dtSeconds, nowMs = Date.now()) {
    try {
      if (runtime.phase === "idle" && !runtime.booster.active) {
        return;
      }
      if (runtime.phase === "complete") {
        runtime.phase = "coast";
      }
      const rocketState = rocketStateFromNBody(state);
      const earthState = earthStateFromNBody(state);
      if (!rocketState || !earthState) {
        runtime.phase = "idle";
        return;
      }
      if (
        !finiteVector(earthState.position) ||
        !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 }) ||
        !finiteVector(rocketState.position) ||
        !finiteVector(rocketState.velocity || { x: 0, y: 0, z: 0 })
      ) {
        runtime.lastError = "Earth/rocket state became non-finite during finalize step";
        emitLaunchError("starship_state_non_finite_finalize", {
          earthPositionFinite: finiteVector(earthState.position),
          earthVelocityFinite: finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 }),
          rocketPositionFinite: finiteVector(rocketState.position),
          rocketVelocityFinite: finiteVector(rocketState.velocity || { x: 0, y: 0, z: 0 }),
        });
        runtime.phase = "idle";
        return;
      }
      const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
      const currentEarthAxes = earthAxes(nowMs);
      const distanceStageIndex = runtime.stageIndex;
      accumulateDistanceTravelled(
        rocketState,
        earthState,
        currentEarthAxes,
        distanceStageIndex,
      );
      const boosterState = boosterStateFromNBody(state);
      if (boosterState) {
        accumulateBoosterDistanceTravelled(
          boosterState,
          earthState,
          currentEarthAxes,
        );
      }
      const contact = applyEarthSurfaceContactForVehicle({
        rocketState,
        earthState,
        earthAxes: currentEarthAxes,
        earthRadiusKm,
        earthSiderealRateRadS: EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
        referenceOffsetKm: STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM,
        dtSeconds,
        thrustN: Number(runtime.lastStep?.thrustN) || 0,
      });
      if (contact?.surfaceSample) {
        runtime.lastSurfaceSample = contact.surfaceSample;
      } else {
        updateRuntimeSurfaceSample(rocketState, earthState, currentEarthAxes, earthRadiusKm);
      }

    if (runtime.phase === "orbit" && isMoonTransferMissionActive(runtime)) {
      runtime.phase = "coast";
    }
    if (runtime.phase === "orbit") {
      const relPosNow = subtract(rocketState.position, earthState.position);
      const relVelNow = subtract(
        rocketState.velocity || { x: 0, y: 0, z: 0 },
        earthState.velocity || { x: 0, y: 0, z: 0 },
      );
      const muKm3S2 = gravitationalConstantKm3PerKgS2 * (Number(getEarthMassKg?.()) || 0);
      const orbitalNow = orbitalStateFromRelative(muKm3S2, earthRadiusKm, relPosNow, relVelNow);
      const stableTargetOrbit = orbitInsertionWithinTolerance(
        orbitalNow,
        LAUNCH_AUTOPILOT_CONFIG,
        runtime.targetOrbitAltitudeKm || LAUNCH_AUTOPILOT_CONFIG.targetOrbitAltitudeKm,
      );
      if (!stableTargetOrbit) {
        runtime.phase = "coast";
        runtime.autopilotMode = "autopilot-coast-to-circularize";
      } else {
      const altitudeKm = Math.max(0, length(relPosNow) - earthRadiusKm);
      const atmosphereSample = sampleEarthAtmosphere?.(altitudeKm) || null;
      const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
        atmosphereSample,
        relPosNow,
        relVelNow,
        currentEarthAxes.pole,
      );
      runtime.lastTelemetry = telemetryFromState({
        gravitationalConstantKm3PerKgS2,
        earthMassKg: Number(getEarthMassKg?.()) || 0,
        earthRadiusKm,
        earthState,
        rocketState,
        atmosphereSample,
        earthPole: currentEarthAxes.pole,
        dynamicPressurePaOverride: dynamicPressurePa,
        runtime,
      });
      finalizeBoosterStep(state, dtSeconds, nowMs);
      runtime.elapsedSeconds += dtSeconds;
      return;
      }
    }

    runtime.elapsedSeconds += dtSeconds;

    const burnKg = Number(runtime.lastStep?.burnKg) || 0;
    const sustainedOrbitReserveActive = missionUsesSustainedOrbitReserve(runtime);
    const appliedBurnKg = sustainedOrbitReserveActive ? 0 : burnKg;
    if (appliedBurnKg > 0) {
      rocketState.massKg = Math.max(
        MIN_ROCKET_MASS_KG,
        rocketState.massKg - appliedBurnKg,
      );
      runtime.stagePropellantKg = Math.max(0, runtime.stagePropellantKg - appliedBurnKg);
    }

    const stage = stageAtIndex(runtime.stageIndex);
    const reservePropellantKg = stageReservePropellantKg(runtime.stageIndex);
    const stagePropellantThresholdKg = reservePropellantKg + 1e-6;
    if (
      stage
      && sustainedOrbitReserveActive
      && runtime.stageIndex >= 1
      && runtime.stagePropellantKg <= stagePropellantThresholdKg
    ) {
      runtime.stagePropellantKg = Math.max(
        runtime.stagePropellantKg,
        stagePropellantThresholdKg + EARTH_ORBIT_HOLD_MISSION_CONFIG.sustainedOrbitReserveKg,
      );
    } else if (stage && runtime.stagePropellantKg <= stagePropellantThresholdKg) {
      if (runtime.stageIndex === 0) {
        const separatedBooster = createSeparatedBoosterState({
          state,
          rocketState,
          earthState,
          currentEarthAxes,
          stage,
        });
        if (separatedBooster) {
          const detachedMassKg =
            (Number(stage.dryMassKg) || Number(LAUNCH_BOOSTER_CONFIG.dryMassKg) || 0)
            + runtime.booster.propellantKg;
          rocketState.massKg = Math.max(
            MIN_ROCKET_MASS_KG,
            rocketState.massKg - detachedMassKg,
          );
        } else {
          rocketState.massKg = Math.max(
            MIN_ROCKET_MASS_KG,
            rocketState.massKg - (Number(stage.dryMassKg) || 0),
          );
        }
      } else {
        rocketState.massKg = Math.max(
          MIN_ROCKET_MASS_KG,
          rocketState.massKg - (Number(stage.dryMassKg) || 0),
        );
      }

      runtime.stageIndex += 1;
      const nextStage = stageAtIndex(runtime.stageIndex);
      if (nextStage) {
        runtime.stagePropellantKg = Number(nextStage.propellantMassKg) || 0;
        runtime.coastRemainingSec = Math.max(0, Number(stage.coastAfterBurnSec) || 0);
        runtime.phase = runtime.coastRemainingSec > 0 ? "coast" : "powered";
      } else {
        runtime.stagePropellantKg = 0;
        const relPos = subtract(rocketState.position, earthState.position);
        const relVel = subtract(
          rocketState.velocity || { x: 0, y: 0, z: 0 },
          earthState.velocity || { x: 0, y: 0, z: 0 },
        );
        const muKm3S2 = gravitationalConstantKm3PerKgS2 * (Number(getEarthMassKg?.()) || 0);
        const orbital = orbitalStateFromRelative(muKm3S2, earthRadiusKm, relPos, relVel);
        const stableOrbit = orbital.specificEnergy < 0 && Number(orbital.periapsisKm) > 80;
        runtime.phase = stableOrbit ? "orbit" : "coast";
        runtime.autopilotMode = stableOrbit ? "autopilot-ballistic-hold" : "ballistic-coast";
      }
    }

    const relPosNow = subtract(rocketState.position, earthState.position);
    const relVelNow = subtract(
      rocketState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    updateRuntimeTargetMetrics(state, relPosNow, relVelNow);
    const altitudeKm = Math.max(0, length(relPosNow) - earthRadiusKm);
    const atmosphereSample = sampleEarthAtmosphere?.(altitudeKm) || null;
    const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
      atmosphereSample,
      relPosNow,
      relVelNow,
      currentEarthAxes.pole,
    );
      runtime.lastTelemetry = telemetryFromState({
        gravitationalConstantKm3PerKgS2,
        earthMassKg: Number(getEarthMassKg?.()) || 0,
        earthRadiusKm,
        earthState,
        rocketState,
        atmosphereSample,
        earthPole: currentEarthAxes.pole,
        dynamicPressurePaOverride: dynamicPressurePa,
        runtime,
      });
      finalizeBoosterStep(state, dtSeconds, nowMs);
    } finally {
      emitRuntimeTransitionEvents("finalize_step");
    }
  }

  function statusSnapshot() {
    const telemetry = runtime.lastTelemetry;
    const targetDescriptor = missionTargetDescriptor();
    if (!telemetry) {
      return {
        bodyId: LAUNCH_BODY_ID,
        phase: runtime.phase,
        phaseLabel: phaseLabel(runtime.phase),
        stageIndex: runtime.stageIndex,
        autopilotMode: runtime.autopilotMode || "manual",
        targetOrbitAltitudeKm: runtime.targetOrbitAltitudeKm,
        missionId: runtime.mission.selectedId,
        missionName: safeMissionProfile(runtime.mission.selectedId)?.name || "Mission",
        missionPhase: runtime.mission.phase,
        missionCompleted: Boolean(runtime.mission.completed),
        moonDistanceKm: runtime.moonDistanceKm,
        moonClosingSpeedKmS: runtime.moonClosingSpeedKmS,
        targetBodyId: targetDescriptor.bodyId,
        targetBodyName: targetDescriptor.bodyName,
        targetDistanceKm: targetDescriptor.distanceKm,
        targetClosingSpeedKmS: targetDescriptor.closingSpeedKmS,
        rcsActive: false,
        rcsErrorDeg: 0,
        rcsAuthority: 0,
        rcsJets: [],
        boosterDistanceKm: runtime.boosterDistanceKm,
        starshipDistanceKm: runtime.starshipDistanceKm,
        boosterPhase: runtime.booster.phase,
        boosterGuidanceMode: runtime.booster.guidanceMode,
        boosterActive: runtime.booster.active,
        boosterLanded: runtime.booster.landed,
        boosterThrottle: Number(runtime.booster.lastStep?.throttle) || 0,
        boosterThrustN: Number(runtime.booster.lastStep?.thrustN) || 0,
        boosterRcsActive: Boolean(runtime.booster.lastStep?.rcsActive),
        boosterRcsErrorDeg: Number(runtime.booster.lastStep?.rcsErrorDeg) || 0,
        boosterRcsAuthority: Number(runtime.booster.lastStep?.rcsAuthority) || 0,
        boosterRcsJets: Array.isArray(runtime.booster.lastStep?.rcsJets)
          ? [...runtime.booster.lastStep.rcsJets]
          : [],
        boosterPressurePa: Number.isFinite(Number(runtime.booster.telemetry?.pressurePa))
          ? Number(runtime.booster.telemetry?.pressurePa)
          : null,
        boosterDensityKgM3: Number.isFinite(Number(runtime.booster.telemetry?.densityKgM3))
          ? Number(runtime.booster.telemetry?.densityKgM3)
          : null,
        boosterDynamicPressurePa: Number.isFinite(Number(runtime.booster.telemetry?.dynamicPressurePa))
          ? Number(runtime.booster.telemetry?.dynamicPressurePa)
          : null,
        boosterAltitudeKm: Number(runtime.booster.telemetry?.altitudeKm) || null,
        boosterSpeedKmS: Number(runtime.booster.telemetry?.speedKmS) || null,
        boosterAltitudeAboveTerrainKm: Number.isFinite(Number(runtime.booster.telemetry?.altitudeAboveTerrainKm))
          ? Number(runtime.booster.telemetry?.altitudeAboveTerrainKm)
          : null,
        boosterPropellantKg: Number(runtime.booster.propellantKg) || 0,
        boosterInitialPropellantKg: Number(runtime.booster.initialPropellantKg) || 0,
        boosterFuelFraction: Number(runtime.booster.initialPropellantKg) > 1e-6
          ? clamp((Number(runtime.booster.propellantKg) || 0) / Number(runtime.booster.initialPropellantKg), 0, 1)
          : null,
        boosterLaunchSiteRangeKm: Number(runtime.booster.telemetry?.launchSiteRangeKm) || null,
        boosterLaunchSiteLateralRangeKm: Number(runtime.booster.telemetry?.launchSiteLateralRangeKm) || null,
        boosterLaunchSiteLateralClosingSpeedKmS: Number(runtime.booster.telemetry?.launchSiteLateralClosingSpeedKmS) || null,
        terrainElevationKm: null,
        altitudeAboveTerrainKm: null,
        latitudeDeg: null,
        longitudeDeg: null,
        launchSiteName: LAUNCH_SITE.name || "Launch Site",
        statusLine: `Launch vehicle initialized at ${LAUNCH_SITE.name || "launch site"}.`,
      };
    }
    return {
      bodyId: LAUNCH_BODY_ID,
      phase: runtime.phase,
      phaseLabel: phaseLabel(runtime.phase),
      stageName: telemetry.stageName,
      stageIndex: telemetry.stageIndex,
      launchSiteName: LAUNCH_SITE.name || "Launch Site",
      elapsedSeconds: telemetry.elapsedSeconds,
      massKg: telemetry.massKg,
      altitudeKm: telemetry.altitudeKm,
      speedKmS: telemetry.speedKmS,
      apoapsisKm: telemetry.apoapsisKm,
      periapsisKm: telemetry.periapsisKm,
      throttle: telemetry.throttle,
      thrustN: telemetry.thrustN,
      burnRateKgS: telemetry.burnRateKgS,
      dynamicPressurePa: telemetry.dynamicPressurePa,
      guidanceMode: telemetry.guidanceMode,
      missionId: telemetry.missionId,
      missionName: telemetry.missionName,
      missionPhase: telemetry.missionPhase,
      missionCompleted: telemetry.missionCompleted,
      moonDistanceKm: runtime.moonDistanceKm,
      moonClosingSpeedKmS: runtime.moonClosingSpeedKmS,
      targetBodyId: targetDescriptor.bodyId,
      targetBodyName: targetDescriptor.bodyName,
      targetDistanceKm: targetDescriptor.distanceKm,
      targetClosingSpeedKmS: targetDescriptor.closingSpeedKmS,
      autopilotMode: telemetry.autopilotMode,
      rcsActive: telemetry.rcsActive,
      rcsErrorDeg: telemetry.rcsErrorDeg,
      rcsAuthority: telemetry.rcsAuthority,
      rcsJets: telemetry.rcsJets,
      targetOrbitAltitudeKm: telemetry.targetOrbitAltitudeKm,
      radialSpeedKmS: telemetry.radialSpeedKmS,
      tangentialSpeedKmS: telemetry.tangentialSpeedKmS,
      circularSpeedKmS: telemetry.circularSpeedKmS,
      timeToApoapsisSec: telemetry.timeToApoapsisSec,
      boosterDistanceKm: telemetry.boosterDistanceKm,
      starshipDistanceKm: telemetry.starshipDistanceKm,
      boosterPhase: runtime.booster.telemetry?.phase || runtime.booster.phase,
      boosterGuidanceMode: runtime.booster.telemetry?.guidanceMode || runtime.booster.guidanceMode,
      boosterActive: runtime.booster.active,
      boosterLanded: runtime.booster.landed,
      boosterThrottle: Number(runtime.booster.telemetry?.throttle) || Number(runtime.booster.lastStep?.throttle) || 0,
      boosterThrustN: Number(runtime.booster.telemetry?.thrustN) || Number(runtime.booster.lastStep?.thrustN) || 0,
      boosterRcsActive: Boolean(runtime.booster.telemetry?.rcsActive ?? runtime.booster.lastStep?.rcsActive),
      boosterRcsErrorDeg: Number(runtime.booster.telemetry?.rcsErrorDeg) || Number(runtime.booster.lastStep?.rcsErrorDeg) || 0,
      boosterRcsAuthority: Number(runtime.booster.telemetry?.rcsAuthority) || Number(runtime.booster.lastStep?.rcsAuthority) || 0,
      boosterRcsJets: Array.isArray(runtime.booster.telemetry?.rcsJets)
        ? [...runtime.booster.telemetry.rcsJets]
        : (Array.isArray(runtime.booster.lastStep?.rcsJets) ? [...runtime.booster.lastStep.rcsJets] : []),
      boosterPressurePa: Number.isFinite(Number(runtime.booster.telemetry?.pressurePa))
        ? Number(runtime.booster.telemetry?.pressurePa)
        : null,
      boosterDensityKgM3: Number.isFinite(Number(runtime.booster.telemetry?.densityKgM3))
        ? Number(runtime.booster.telemetry?.densityKgM3)
        : null,
      boosterDynamicPressurePa: Number.isFinite(Number(runtime.booster.telemetry?.dynamicPressurePa))
        ? Number(runtime.booster.telemetry?.dynamicPressurePa)
        : null,
      boosterAltitudeKm: Number(runtime.booster.telemetry?.altitudeKm) || null,
      boosterSpeedKmS: Number(runtime.booster.telemetry?.speedKmS) || null,
      boosterAltitudeAboveTerrainKm: Number.isFinite(Number(runtime.booster.telemetry?.altitudeAboveTerrainKm))
        ? Number(runtime.booster.telemetry?.altitudeAboveTerrainKm)
        : null,
      boosterPropellantKg: Number(runtime.booster.telemetry?.propellantKg) || Number(runtime.booster.propellantKg) || 0,
      boosterInitialPropellantKg: Number(runtime.booster.telemetry?.initialPropellantKg) || Number(runtime.booster.initialPropellantKg) || 0,
      boosterFuelFraction: Number.isFinite(Number(runtime.booster.telemetry?.fuelFraction))
        ? clamp(Number(runtime.booster.telemetry?.fuelFraction), 0, 1)
        : (
          Number(runtime.booster.initialPropellantKg) > 1e-6
            ? clamp((Number(runtime.booster.propellantKg) || 0) / Number(runtime.booster.initialPropellantKg), 0, 1)
            : null
        ),
      boosterLaunchSiteRangeKm: Number(runtime.booster.telemetry?.launchSiteRangeKm) || null,
      boosterLaunchSiteLateralRangeKm: Number(runtime.booster.telemetry?.launchSiteLateralRangeKm) || null,
      boosterLaunchSiteLateralClosingSpeedKmS: Number(runtime.booster.telemetry?.launchSiteLateralClosingSpeedKmS) || null,
      terrainElevationKm: telemetry.terrainElevationKm,
      altitudeAboveTerrainKm: telemetry.altitudeAboveTerrainKm,
      latitudeDeg: telemetry.latitudeDeg,
      longitudeDeg: telemetry.longitudeDeg,
      statusLine: runtime.lastError || `${phaseLabel(runtime.phase)} | ${telemetry.stageName}`,
    };
  }

  function setMissionProfile(missionId) {
    const previousMissionId = runtime.mission.selectedId;
    const previousMissionPhase = runtime.mission.phase;
    const normalized = normalizeMissionId(missionId);
    runtime.mission.selectedId = normalized;
    runtime.mission.completed = false;
    setMissionPhase(runtime, defaultMissionPhaseForProfileId(normalized));
    emitLaunchEvent("mission_profile_selected", {
      fromMissionId: previousMissionId,
      toMissionId: normalized,
      fromMissionPhase: previousMissionPhase,
      toMissionPhase: runtime.mission.phase,
    });
    emitRuntimeTransitionEvents("set_mission_profile");
    return {
      ...safeMissionProfile(normalized),
      phase: runtime.mission.phase,
      completed: runtime.mission.completed,
    };
  }

  function getMissionProfile() {
    const profile = safeMissionProfile(runtime.mission.selectedId);
    return {
      ...profile,
      phase: runtime.mission.phase,
      completed: runtime.mission.completed,
    };
  }

  function getMissionProfiles() {
    return LAUNCH_MISSION_PROFILES.map((profile) => ({ ...profile }));
  }

  emitLaunchEvent("launch_controller_initialized", {
    autopilotEnabled: runtime.autopilotEnabled,
    defaultMissionId: runtime.mission.selectedId,
    defaultMissionPhase: runtime.mission.phase,
    launchSiteName: LAUNCH_SITE.name || "Launch Site",
  });
  emitRuntimeTransitionEvents("controller_initialized");

  return {
    ensureCatalogBodies,
    injectStartupEntry,
    ensureRocketInNBody,
    resetToPad,
    startLaunch,
    prepareStep,
    externalAccelerationKmS2,
    finalizeStep,
    statusSnapshot,
    setMissionProfile,
    getMissionProfile,
    getMissionProfiles,
    isActive() {
      return runtime.phase !== "idle" || runtime.booster.active;
    },
  };
}
