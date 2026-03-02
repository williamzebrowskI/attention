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
  STARSHIP_STACK_DIMENSIONS_KM,
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
import {
  add,
  angleBetweenRadians,
  clamp,
  cross,
  degrees,
  dot,
  length,
  mixVectors,
  normalize,
  rad,
  scale,
  subtract,
  unitOrNull,
} from "./launchMath.js";
import {
  circularOrbitSpeedKmS as circularOrbitSpeedKmSModel,
  computeAutopilotCommand as computeAutopilotCommandModel,
  computeLaunchPlaneNormal as computeLaunchPlaneNormalModel,
  guidanceDirection as guidanceDirectionModel,
  orbitInsertionWithinTolerance as orbitInsertionWithinToleranceModel,
  orbitalStateFromRelative as orbitalStateFromRelativeModel,
  throttleForState as throttleForStateModel,
} from "./launchGuidance.js";
import {
  computeMissionAutopilotCommand as computeMissionAutopilotCommandModel,
  defaultMissionPhaseForProfileId as defaultMissionPhaseForProfileIdModel,
  isMoonTransferMissionActive as isMoonTransferMissionActiveModel,
  missionUsesSustainedOrbitReserve as missionUsesSustainedOrbitReserveModel,
  setMissionPhase as setMissionPhaseModel,
} from "./launchMissionEngine.js";
import {
  applyQAlphaSteeringLimit,
  atmosphereRelativeVelocityKmS,
  computeAerodynamicResponse,
  dynamicPressurePaFromAtmosphere,
  limitThrottleByQAlpha,
  sampleWindVectorKmS,
} from "./launchAeroModel.js";
import {
  applyActuatorModel,
  createActuatorState,
  createMassModelState,
  updateMassModelState,
} from "./launchActuators.js";
import { LAUNCH_REALISM_CONFIG } from "./launchRealismConfig.js";
import {
  createHotstageState,
  finishHotstageDetach,
  hotstageOverlapSeconds,
  hotstageSeparationRelativeSpeedKmS,
  hotstageTimeSinceIgnitionSec,
  resetHotstageState,
  startHotstageSequence,
  updateHotstageGates,
} from "./hotstageLogic.js";

const MIN_ROCKET_MASS_KG = 500;

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

function separationGapKm() {
  return 0.0025;
}

function stage2HotStagingThrottleCap(timeSinceIgnitionSec) {
  const t = Math.max(0, Number(timeSinceIgnitionSec) || 0);
  const ramp = clamp(t / 4.5, 0, 1);
  return 0.20 + (0.70 * ramp);
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

function stageBodyKindFromStageIndex(stageIndex) {
  return Number(stageIndex) >= 1 ? "stage2" : "stage1";
}

function guidanceDirection({
  rocketState,
  earthState,
  earthAxes,
  elapsedSeconds,
}) {
  return guidanceDirectionModel({
    rocketState,
    earthState,
    earthAxes,
    elapsedSeconds,
  });
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
  controlAuthorityScale = 1,
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

  const accelerationMagnitude = LAUNCH_RCS_CONFIG.maxAccelerationKmS2
    * authority
    * clamp(Number(controlAuthorityScale) || 1, 0.4, 1.4);
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
  controlAuthorityScale = 1,
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
  const authority = Math.max(errorAuthority, phaseAuthorityFloor)
    * clamp(Number(controlAuthorityScale) || 1, 0.35, 1.4);
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
  return circularOrbitSpeedKmSModel(muKm3S2, radiusKm);
}

function computeLaunchPlaneNormal(earthAxes) {
  return computeLaunchPlaneNormalModel(earthAxes);
}

function orbitalStateFromRelative(muKm3S2, earthRadiusKm, relPos, relVel) {
  return orbitalStateFromRelativeModel(muKm3S2, earthRadiusKm, relPos, relVel);
}

function orbitInsertionWithinTolerance(orbital, config, targetAltitudeKm) {
  return orbitInsertionWithinToleranceModel(orbital, config, targetAltitudeKm);
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
  return computeAutopilotCommandModel({
    runtime,
    orbital,
    relPos,
    dynamicPressurePa,
    relVel,
    up,
    earthPole,
    muKm3S2,
    earthRadiusKm,
  });
}

function throttleForState(stageIndex, elapsedSeconds, dynamicPressurePa = 0) {
  return throttleForStateModel(stageIndex, elapsedSeconds, dynamicPressurePa);
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
    throttleCommand: runtime.lastStep?.throttleCommand || 0,
    thrustN: runtime.lastStep?.thrustN || 0,
    burnRateKgS: runtime.lastStep?.burnRateKgS || 0,
    dynamicPressurePa,
    angleOfAttackDeg: Number(runtime.lastStep?.angleOfAttackDeg) || 0,
    qAlphaPaRad: Number(runtime.lastStep?.qAlphaPaRad) || 0,
    machNumber: Number(runtime.lastStep?.machNumber) || 0,
    dragCoefficient: Number(runtime.lastStep?.dragCoefficient) || 0,
    liftCoefficient: Number(runtime.lastStep?.liftCoefficient) || 0,
    gimbalErrorDeg: Number(runtime.lastStep?.gimbalErrorDeg) || 0,
    windSpeedKmS: Number(runtime.lastStep?.windSpeedKmS) || 0,
    windEastMS: Number(runtime.lastStep?.windEastMS) || 0,
    windNorthMS: Number(runtime.lastStep?.windNorthMS) || 0,
    comNormalized: Number(runtime.lastStep?.comNormalized) || 0,
    inertiaNormalized: Number(runtime.lastStep?.inertiaNormalized) || 0,
    controlAuthorityScale: Number(runtime.lastStep?.controlAuthorityScale) || 0,
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
    hotstageActive: Boolean(runtime.hotstage.active),
    hotstageTimeSinceIgnitionSec: hotstageTimeSinceIgnitionSec(runtime.hotstage, runtime.elapsedSeconds),
    hotstageOverlapSeconds: Number(runtime.hotstage.overlapSeconds) || hotstageOverlapSeconds(),
    hotstageIgnitionStableSec: Number(runtime.hotstage.ignitionStableSec) || 0,
    hotstageVirtualSeparationKm: Number(runtime.hotstage.virtualSeparationKm) || 0,
    hotstageDetachReason: runtime.hotstage.detachReason || null,
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
    throttleCommand: runtime.booster.lastStep?.throttleCommand || 0,
    thrustN: runtime.booster.lastStep?.thrustN || 0,
    burnRateKgS: runtime.booster.lastStep?.burnRateKgS || 0,
    rcsBurnRateKgS: runtime.booster.lastStep?.rcsBurnRateKgS || 0,
    rcsActive: Boolean(runtime.booster.lastStep?.rcsActive),
    rcsErrorDeg: Number(runtime.booster.lastStep?.rcsErrorDeg) || 0,
    rcsAuthority: Number(runtime.booster.lastStep?.rcsAuthority) || 0,
    rcsJets: Array.isArray(runtime.booster.lastStep?.rcsJets) ? [...runtime.booster.lastStep.rcsJets] : [],
    angleOfAttackDeg: Number(runtime.booster.lastStep?.angleOfAttackDeg) || 0,
    qAlphaPaRad: Number(runtime.booster.lastStep?.qAlphaPaRad) || 0,
    machNumber: Number(runtime.booster.lastStep?.machNumber) || 0,
    dragCoefficient: Number(runtime.booster.lastStep?.dragCoefficient) || 0,
    liftCoefficient: Number(runtime.booster.lastStep?.liftCoefficient) || 0,
    gimbalErrorDeg: Number(runtime.booster.lastStep?.gimbalErrorDeg) || 0,
    windSpeedKmS: Number(runtime.booster.lastStep?.windSpeedKmS) || 0,
    windEastMS: Number(runtime.booster.lastStep?.windEastMS) || 0,
    windNorthMS: Number(runtime.booster.lastStep?.windNorthMS) || 0,
    comNormalized: Number(runtime.booster.lastStep?.comNormalized) || 0,
    inertiaNormalized: Number(runtime.booster.lastStep?.inertiaNormalized) || 0,
    controlAuthorityScale: Number(runtime.booster.lastStep?.controlAuthorityScale) || 0,
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

function safeMissionProfile(missionId) {
  return missionProfileById(normalizeMissionId(missionId));
}

function defaultMissionPhaseForProfileId(missionId) {
  return defaultMissionPhaseForProfileIdModel(missionId);
}

function setMissionPhase(runtime, nextPhase) {
  setMissionPhaseModel(runtime, nextPhase);
}

function isMoonTransferMissionActive(runtime) {
  return isMoonTransferMissionActiveModel(runtime);
}

function bodyStateFromNBody(state, bodyId) {
  return state?.dynamicBodies?.get(bodyId)
    || state?.staticSources?.get(bodyId)
    || null;
}

function missionUsesSustainedOrbitReserve(runtime) {
  return missionUsesSustainedOrbitReserveModel(runtime);
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
  return computeMissionAutopilotCommandModel({
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
    windSeed: Date.now() % 1_000_000,
    stageActuator: createActuatorState({ x: 0, y: 0, z: 1 }),
    stageMassModel: createMassModelState(),
    boosterActuator: createActuatorState({ x: 0, y: 0, z: 1 }),
    boosterMassModel: createMassModelState(),
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
    hotstage: createHotstageState(),
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
    runtime.windSeed = Date.now() % 1_000_000;
    runtime.stageActuator = createActuatorState({ x: 0, y: 0, z: 1 });
    runtime.stageMassModel = createMassModelState();
    runtime.boosterActuator = createActuatorState({ x: 0, y: 0, z: 1 });
    runtime.boosterMassModel = createMassModelState();
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
    runtime.hotstage = resetHotstageState(runtime.hotstage);
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
    runtime.boosterActuator = createActuatorState({ x: 0, y: 0, z: 1 });
    runtime.boosterMassModel = createMassModelState();
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
    reservePropellantKgOverride = null,
  }) {
    if (!state?.dynamicBodies || !rocketState || !earthState || !stage) {
      return null;
    }
    const reserveLimitKg = stageReservePropellantKg(0);
    const reserveOverride = Number(reservePropellantKgOverride);
    const reservePropellantKg = Number.isFinite(reserveOverride)
      ? clamp(reserveOverride, 0, reserveLimitKg)
      : Math.min(Math.max(0, runtime.stagePropellantKg), reserveLimitKg);
    const boosterDryMassKg = Number(stage.dryMassKg) || Number(LAUNCH_BOOSTER_CONFIG.dryMassKg) || 0;
    const boosterMassKg = boosterDryMassKg + reservePropellantKg;
    if (!(boosterMassKg > 0)) {
      return null;
    }
    const preSeparationStackMassKg = Math.max(MIN_ROCKET_MASS_KG, Number(rocketState.massKg) || 0);
    const shipMassKg = Math.max(MIN_ROCKET_MASS_KG, preSeparationStackMassKg - boosterMassKg);

    const relPos = subtract(rocketState.position, earthState.position);
    const relVel = subtract(
      rocketState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    const up = normalize(relPos, currentEarthAxes.pole);

    // Align the dynamic reference from stacked center to Starship center at staging.
    const shipCenterShiftKm = STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm * 0.5;
    rocketState.position = add(rocketState.position, scale(up, shipCenterShiftKm));

    // Place booster directly below Starship with only a small physical gap; add a tiny separation
    // impulse that conserves momentum and yields a gentle relative separation speed.
    const separationOffsetKm =
      (STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm * 0.5)
      + (STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm * 0.5)
      + separationGapKm();
    const separationRelativeSpeedKmS = Math.max(0, hotstageSeparationRelativeSpeedKmS());
    const totalMassKg = shipMassKg + boosterMassKg;
    const dvShipKmS = totalMassKg > 0
      ? separationRelativeSpeedKmS * (boosterMassKg / totalMassKg)
      : 0;
    const dvBoosterKmS = totalMassKg > 0
      ? separationRelativeSpeedKmS * (shipMassKg / totalMassKg)
      : 0;
    const baseVelocityKmS = rocketState.velocity || { x: 0, y: 0, z: 0 };
    const shipImpulseKmS = scale(up, dvShipKmS);
    const separationImpulseKmS = scale(up, -dvBoosterKmS);
    rocketState.velocity = add(baseVelocityKmS, shipImpulseKmS);
    const boosterState = {
      id: LAUNCH_BOOSTER_BODY_ID,
      massKg: boosterMassKg,
      position: add(rocketState.position, scale(up, -separationOffsetKm)),
      velocity: add(baseVelocityKmS, separationImpulseKmS),
    };
    state.dynamicBodies.set(LAUNCH_BOOSTER_BODY_ID, boosterState);

    runtime.booster.active = true;
    runtime.booster.phase = "separation-flip";
    runtime.booster.guidanceMode = "booster-separation-flip";
    runtime.booster.propellantKg = reservePropellantKg;
    runtime.booster.initialPropellantKg = reservePropellantKg;
    runtime.booster.separationTimeSec = runtime.elapsedSeconds;
    runtime.booster.landed = false;
    runtime.booster.lastStep = zeroBoosterStep("booster-separation-flip");
    runtime.boosterActuator = createActuatorState(up);
    runtime.boosterMassModel = createMassModelState();
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
      shipCenterShiftKm,
      separationOffsetKm,
      shipMassKg,
      shipImpulseKmS,
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
    const windSample = sampleWindVectorKmS({
      altitudeKm,
      relPos,
      earthPole: currentEarthAxes.pole,
      elapsedSeconds: runtime.elapsedSeconds,
      seed: runtime.windSeed,
    });
    const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
      atmosphereSample,
      relPos,
      relVel,
      currentEarthAxes.pole,
      windSample.vectorKmS,
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
    const relAirVelocityKmS = atmosphereRelativeVelocityKmS(
      relPos,
      relVel,
      currentEarthAxes.pole,
      windSample.vectorKmS,
    );
    const qAlphaSteering = applyQAlphaSteeringLimit({
      desiredDirection: direction,
      relAirVelocityKmS,
      dynamicPressurePa,
      bodyKind: "booster",
    });
    direction = qAlphaSteering.direction;
    let requestedThrottle = canBurn ? clamp(Number(command.throttle) || 0, 0, 1) : 0;
    requestedThrottle = limitThrottleByQAlpha({
      throttle: requestedThrottle,
      qAlphaPaRad: qAlphaSteering.qAlphaPaRad,
      bodyKind: "booster",
    });

    const boosterPropellantFraction = runtime.booster.initialPropellantKg > 1e-6
      ? clamp(runtime.booster.propellantKg / runtime.booster.initialPropellantKg, 0, 1)
      : 0;
    runtime.boosterMassModel = updateMassModelState(runtime.boosterMassModel, {
      propellantFraction: boosterPropellantFraction,
      bodyKind: "booster",
      dtSeconds,
    });
    runtime.boosterActuator = applyActuatorModel(runtime.boosterActuator, {
      requestedThrottle,
      requestedDirection: direction,
      dtSeconds,
      config: LAUNCH_REALISM_CONFIG.actuator.booster,
      massModel: runtime.boosterMassModel,
    });
    const throttleActual = clamp(Number(runtime.boosterActuator.throttleActual) || 0, 0, 1);
    const directionActual = normalize(runtime.boosterActuator.directionActual, direction);

    const fullThrustN = interpolateSeaToVac(
      Number(LAUNCH_BOOSTER_CONFIG.thrustVacuumN) || 0,
      Number(LAUNCH_BOOSTER_CONFIG.thrustSeaLevelN) || 0,
      pressurePa,
    );
    const thrustN = fullThrustN * throttleActual;
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
    const aero = computeAerodynamicResponse({
      bodyKind: "booster",
      atmosphereSample,
      relPos,
      relVel,
      earthPole: currentEarthAxes.pole,
      windVectorKmS: windSample.vectorKmS,
      bodyAxisDirection: directionActual,
      referenceAreaM2: Number(LAUNCH_BOOSTER_CONFIG.referenceAreaM2) || 0,
      massKg: effectiveMassKg,
    });
    runtime.booster.phase = command.phase || "descent";
    runtime.booster.guidanceMode = command.guidanceMode || "booster-guidance";
    const boosterRcs = computeBoosterRcsAssist({
      desiredDirection: directionActual,
      relVel,
      up,
      throttle: throttleActual,
      phase: command.phase || runtime.booster.phase,
      guidanceMode: command.guidanceMode || runtime.booster.guidanceMode,
      controlAuthorityScale: runtime.boosterMassModel.controlAuthorityScale,
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
      accelerationKmS2: add(scale(directionActual, accelerationMagKmS2), aero.accelerationKmS2),
      throttle: throttleActual,
      throttleCommand: requestedThrottle,
      thrustN,
      burnKg,
      burnRateKgS,
      rcsBurnKg,
      rcsBurnRateKgS,
      dynamicPressurePa: aero.dynamicPressurePa,
      guidanceMode: throttleActual <= 0 && !landingPhase && stageReservePropellantKg(0) > 0
        ? `${runtime.booster.guidanceMode}+reserve-hold`
        : runtime.booster.guidanceMode,
      touchdownReady: Boolean(command.touchdownReady),
      rcsActive: boosterRcs.active,
      rcsErrorDeg: boosterRcs.errorDeg,
      rcsAuthority: boosterRcs.authority,
      rcsJets: boosterRcs.jets,
      angleOfAttackDeg: aero.angleOfAttackDeg,
      qAlphaPaRad: aero.qAlphaPaRad,
      machNumber: aero.machNumber,
      dragCoefficient: aero.dragCoefficient,
      liftCoefficient: aero.liftCoefficient,
      gimbalErrorDeg: runtime.boosterActuator.gimbalErrorDeg,
      windSpeedKmS: windSample.speedKmS,
      windEastMS: windSample.eastMS,
      windNorthMS: windSample.northMS,
      comNormalized: runtime.boosterMassModel.comNormalized,
      inertiaNormalized: runtime.boosterMassModel.inertiaNormalized,
      controlAuthorityScale: runtime.boosterMassModel.controlAuthorityScale,
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
    const windSample = sampleWindVectorKmS({
      altitudeKm: Math.max(0, altitudeKm),
      relPos: relPosNow,
      earthPole: currentEarthAxes.pole,
      elapsedSeconds: runtime.elapsedSeconds,
      seed: (Number(runtime.windSeed) || 0) + 131_071,
    });
    const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
      atmosphereSample,
      relPosNow,
      relVelNow,
      currentEarthAxes.pole,
      windSample.vectorKmS,
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
      const currentEarthAxes = earthAxes(nowMs);
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
      const windSample = sampleWindVectorKmS({
        altitudeKm,
        relPos,
        earthPole: currentEarthAxes.pole,
        elapsedSeconds: runtime.elapsedSeconds,
        seed: runtime.windSeed,
      });
      const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
        atmo,
        relPos,
        relVel,
        currentEarthAxes.pole,
        windSample.vectorKmS,
      );
      const relAirVelocityKmS = atmosphereRelativeVelocityKmS(
        relPos,
        relVel,
        currentEarthAxes.pole,
        windSample.vectorKmS,
      );
      const moonTransferMissionActive = isMoonTransferMissionActive(runtime);
      updateRuntimeSurfaceSample(rocketState, earthState, currentEarthAxes, earthRadiusKm);

      const activeStage = stageAtIndex(runtime.stageIndex);
      const stageNominalPropellantKg = Number(activeStage?.propellantMassKg) || 0;
      const stagePropellantFraction = stageNominalPropellantKg > 1e-6
        ? clamp(runtime.stagePropellantKg / stageNominalPropellantKg, 0, 1)
        : 0;
      runtime.stageMassModel = updateMassModelState(runtime.stageMassModel, {
        propellantFraction: stagePropellantFraction,
        bodyKind: stageBodyKindFromStageIndex(runtime.stageIndex),
        dtSeconds,
      });

      const updateTelemetry = () => {
        runtime.lastTelemetry = telemetryFromState({
          gravitationalConstantKm3PerKgS2,
          earthMassKg: Number(getEarthMassKg?.()) || 0,
          earthRadiusKm,
          earthState,
          rocketState,
          atmosphereSample: atmo,
          earthPole: currentEarthAxes.pole,
          dynamicPressurePaOverride: runtime.lastStep?.dynamicPressurePa ?? dynamicPressurePa,
          runtime,
        });
      };

      const setFlightStep = ({
        desiredDirection,
        requestedThrottle = 0,
        guidanceMode = "coast",
      }) => {
        const directionRequested = normalize(
          desiredDirection || normalize(relVel, orbital.up),
          orbital.up,
        );
        const bodyKind = stageBodyKindFromStageIndex(runtime.stageIndex);
        const stageForStep = stageAtIndex(runtime.stageIndex);
        const lowAltitudeQAlphaBypass =
          runtime.stageIndex === 0
          && (
            orbital.altitudeKm <= ((Number(LAUNCH_AUTOPILOT_CONFIG.verticalAscentMaxAltitudeKm) || 0) + 2)
            || String(guidanceMode || "").includes("vertical")
          );
        const qAlphaSteering = lowAltitudeQAlphaBypass
          ? {
            direction: directionRequested,
            limited: false,
            angleOfAttackDeg: 0,
            maxAllowedAoADeg: Number(LAUNCH_REALISM_CONFIG.aero?.maxAoADegLowQ) || 12,
            qAlphaPaRad: 0,
          }
          : applyQAlphaSteeringLimit({
            desiredDirection: directionRequested,
            relAirVelocityKmS,
            dynamicPressurePa,
            bodyKind,
          });
        const steeringDirection = qAlphaSteering.direction;
        const pressurePa = Number(atmo?.pressurePa) || 0;
        let throttleCommand = clamp(Number(requestedThrottle) || 0, 0, 1);
        let canThrust = Boolean(stageForStep);
        const reservePropellantKg = canThrust ? stageReservePropellantKg(runtime.stageIndex) : 0;
        const availablePropellantKg = canThrust
          ? Math.max(0, runtime.stagePropellantKg - reservePropellantKg)
          : 0;
        if (!(availablePropellantKg > 1e-6)) {
          canThrust = false;
          throttleCommand = 0;
        } else {
          if (!lowAltitudeQAlphaBypass) {
            throttleCommand = limitThrottleByQAlpha({
              throttle: throttleCommand,
              qAlphaPaRad: qAlphaSteering.qAlphaPaRad,
              bodyKind,
            });
          }
          throttleCommand = limitThrottleByThrustAccelerationG({
            stage: stageForStep,
            stageIndex: runtime.stageIndex,
            pressurePa,
            throttle: throttleCommand,
            massKg: Math.max(MIN_ROCKET_MASS_KG, Number(rocketState.massKg) || 0),
          });
        }

        runtime.stageActuator = applyActuatorModel(runtime.stageActuator, {
          requestedThrottle: canThrust ? throttleCommand : 0,
          requestedDirection: steeringDirection,
          dtSeconds,
          config: LAUNCH_REALISM_CONFIG.actuator.stage,
          massModel: runtime.stageMassModel,
        });
        const throttleActual = canThrust
          ? clamp(Number(runtime.stageActuator.throttleActual) || 0, 0, 1)
          : 0;
        const directionActual = normalize(
          runtime.stageActuator.directionActual,
          steeringDirection,
        );
        let thrustN = 0;
        let burnRateKgS = 0;
        let burnKg = 0;
        if (canThrust && throttleActual > 1e-7 && stageForStep) {
          const fullThrustN = interpolateSeaToVac(
            Number(stageForStep.thrustVacuumN) || 0,
            Number(stageForStep.thrustSeaLevelN) || 0,
            pressurePa,
          );
          thrustN = fullThrustN * throttleActual;
          const ispS = interpolateSeaToVac(
            Number(stageForStep.ispVacuumS) || 0,
            Number(stageForStep.ispSeaLevelS) || 0,
            pressurePa,
          );
          burnRateKgS = thrustN > 0 && ispS > 0
            ? thrustN / (ispS * STANDARD_GRAVITY_M_S2)
            : 0;
          burnKg = Math.min(availablePropellantKg, burnRateKgS * dtSeconds);
        }

        const effectiveMassKg = Math.max(
          MIN_ROCKET_MASS_KG,
          (Number(rocketState.massKg) || MIN_ROCKET_MASS_KG) - (0.5 * burnKg),
        );
        const thrustAccelerationKmS2 = thrustN > 0
          ? scale(directionActual, (thrustN / effectiveMassKg) / 1000)
          : { x: 0, y: 0, z: 0 };
        const aero = computeAerodynamicResponse({
          bodyKind,
          atmosphereSample: atmo,
          relPos,
          relVel,
          earthPole: currentEarthAxes.pole,
          windVectorKmS: windSample.vectorKmS,
          bodyAxisDirection: directionActual,
          referenceAreaM2: Number(LAUNCH_VEHICLE_CONFIG.referenceAreaM2) || 0,
          massKg: effectiveMassKg,
        });
        const rcs = computeRcsAssist({
          stageIndex: runtime.stageIndex,
          desiredDirection: steeringDirection,
          relVel,
          up: orbital.up,
          controlAuthorityScale: runtime.stageMassModel.controlAuthorityScale,
        });
        const guidanceModeLabel = qAlphaSteering.limited
          ? `${guidanceMode}+qalpha-limit`
          : guidanceMode;
        runtime.lastStep = {
          accelerationKmS2: add(add(thrustAccelerationKmS2, aero.accelerationKmS2), rcs.accelerationKmS2),
          throttle: throttleActual,
          throttleCommand: canThrust ? throttleCommand : 0,
          thrustN,
          burnKg,
          burnRateKgS,
          dynamicPressurePa: aero.dynamicPressurePa,
          guidanceMode: guidanceModeLabel,
          rcsActive: rcs.active,
          rcsErrorDeg: rcs.errorDeg,
          rcsAuthority: rcs.authority,
          rcsJets: rcs.jets,
          angleOfAttackDeg: aero.angleOfAttackDeg,
          qAlphaPaRad: aero.qAlphaPaRad,
          machNumber: aero.machNumber,
          dragCoefficient: aero.dragCoefficient,
          liftCoefficient: aero.liftCoefficient,
          gimbalErrorDeg: runtime.stageActuator.gimbalErrorDeg,
          windSpeedKmS: windSample.speedKmS,
          windEastMS: windSample.eastMS,
          windNorthMS: windSample.northMS,
          comNormalized: runtime.stageMassModel.comNormalized,
          inertiaNormalized: runtime.stageMassModel.inertiaNormalized,
          controlAuthorityScale: runtime.stageMassModel.controlAuthorityScale,
          maxAllowedAoADeg: qAlphaSteering.maxAllowedAoADeg,
        };
        updateTelemetry();
      };

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
          setFlightStep({
            desiredDirection: normalize(relVel, orbital.up),
            requestedThrottle: 0,
            guidanceMode: runtime.autopilotMode || "orbit-hold",
          });
          return;
        }
      }

      if (runtime.coastRemainingSec > 0) {
        runtime.coastRemainingSec = Math.max(0, runtime.coastRemainingSec - dtSeconds);
        runtime.phase = runtime.coastRemainingSec > 0 ? "coast" : "powered";
        setFlightStep({
          desiredDirection: normalize(relVel, orbital.up),
          requestedThrottle: 0,
          guidanceMode: "stage-separation-coast",
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
            setFlightStep({
              desiredDirection: autopilotCommand.direction || normalize(relVel, orbital.up),
              requestedThrottle: 0,
              guidanceMode: autopilotCommand.mode || "autopilot-orbital-hold",
            });
            return;
          } else {
            runtime.phase = "coast";
            setFlightStep({
              desiredDirection: autopilotCommand.direction || normalize(relVel, orbital.up),
              requestedThrottle: 0,
              guidanceMode: autopilotCommand.mode || "coast",
            });
            return;
          }
        } else {
          setFlightStep({
            desiredDirection: normalize(relVel, orbital.up),
            requestedThrottle: 0,
            guidanceMode: "coast",
          });
          return;
        }
      }

      const stage = stageAtIndex(runtime.stageIndex);
      if (!stage) {
        const stableOrbit = orbital.specificEnergy < 0 && Number(orbital.periapsisKm) > 80;
        runtime.phase = stableOrbit ? "orbit" : "coast";
        runtime.autopilotMode = stableOrbit ? "autopilot-ballistic-hold" : "ballistic-coast";
        setFlightStep({
          desiredDirection: normalize(relVel, orbital.up),
          requestedThrottle: 0,
          guidanceMode: runtime.autopilotMode,
        });
        return;
      }

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
          setFlightStep({
            desiredDirection: autopilotCommand.direction || guidance.direction,
            requestedThrottle: 0,
            guidanceMode: autopilotCommand.mode || "autopilot-coast",
          });
          return;
        }
        if (autopilotCommand.phase === "orbit") {
          runtime.phase = moonTransferMissionActive ? "coast" : "orbit";
          runtime.autopilotMode = autopilotCommand.mode || runtime.autopilotMode;
          setFlightStep({
            desiredDirection: autopilotCommand.direction || guidance.direction,
            requestedThrottle: 0,
            guidanceMode: moonTransferMissionActive
              ? (autopilotCommand.mode || "mission-moon-orbit-return:coast")
              : (autopilotCommand.mode || "autopilot-orbital-hold"),
          });
          return;
        }
        throttle = clamp(Number(autopilotCommand.throttle), 0, 1);
        guidance = {
          direction: autopilotCommand.direction || guidance.direction,
          mode: autopilotCommand.mode || guidance.mode,
        };
      }

      // Gentle hot-staging ramp: avoid abrupt Stage 2 shove right after ignition.
      const ignitionTimeSec = Number(runtime.hotstage?.ignitionTimeSec);
      const timeSinceIgnitionSec = Number.isFinite(ignitionTimeSec)
        ? Math.max(0, runtime.elapsedSeconds - ignitionTimeSec)
        : Number.POSITIVE_INFINITY;
      if (
        runtime.stageIndex === 1
        && Number.isFinite(timeSinceIgnitionSec)
        && timeSinceIgnitionSec < 6
      ) {
        const cap = stage2HotStagingThrottleCap(timeSinceIgnitionSec);
        throttle = Math.min(throttle, cap);
        const rampBlend = clamp(timeSinceIgnitionSec / 4.5, 0, 1);
        const upBias = 0.30 * (1 - rampBlend);
        if (upBias > 1e-6) {
          guidance = {
            direction: normalize(
              add(scale(guidance.direction, 1), scale(orbital.up, upBias)),
              guidance.direction,
            ),
            mode: `${guidance.mode}+hotstage-ramp`,
          };
        } else {
          guidance = {
            direction: guidance.direction,
            mode: `${guidance.mode}+hotstage-ramp`,
          };
        }
      }

      setFlightStep({
        desiredDirection: guidance.direction,
        requestedThrottle: throttle,
        guidanceMode: guidance.mode,
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
          const windSample = sampleWindVectorKmS({
            altitudeKm,
            relPos: relPosNow,
            earthPole: currentEarthAxes.pole,
            elapsedSeconds: runtime.elapsedSeconds,
            seed: runtime.windSeed,
          });
          const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
            atmosphereSample,
            relPosNow,
            relVelNow,
            currentEarthAxes.pole,
            windSample.vectorKmS,
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
        const nextStage = stageAtIndex(1);
        if (nextStage) {
          const boosterReservePropellantKg = clamp(
            Math.max(0, Number(runtime.stagePropellantKg) || 0),
            0,
            stageReservePropellantKg(0),
          );

          runtime.hotstage = startHotstageSequence(runtime.hotstage, {
            elapsedSeconds: runtime.elapsedSeconds,
            boosterReservePropellantKg,
            overlapSeconds: hotstageOverlapSeconds(),
          });

          // Switch propulsion to Stage 2 immediately (hot-staging overlap). Physical detachment is handled
          // separately after a short overlap window.
          runtime.stageIndex = 1;
          runtime.stagePropellantKg = Number(nextStage.propellantMassKg) || 0;
          runtime.coastRemainingSec = 0;
          runtime.phase = "powered";
          runtime.stageActuator = createActuatorState(
            normalize(subtract(rocketState.position, earthState.position), currentEarthAxes.pole),
          );
          runtime.stageMassModel = createMassModelState();

          emitLaunchEvent("hotstage_ignition", {
            boosterReservePropellantKg,
            overlapSeconds: runtime.hotstage.overlapSeconds,
          });
        } else {
          rocketState.massKg = Math.max(
            MIN_ROCKET_MASS_KG,
            rocketState.massKg - (Number(stage.dryMassKg) || 0),
          );
          runtime.stageIndex += 1;
          runtime.stagePropellantKg = 0;
          runtime.phase = "coast";
          runtime.autopilotMode = "ballistic-coast";
          runtime.stageActuator = createActuatorState(
            normalize(subtract(rocketState.position, earthState.position), currentEarthAxes.pole),
          );
          runtime.stageMassModel = createMassModelState();
        }
      } else {
        rocketState.massKg = Math.max(
          MIN_ROCKET_MASS_KG,
          rocketState.massKg - (Number(stage.dryMassKg) || 0),
        );

        runtime.stageIndex += 1;
        const nextStage = stageAtIndex(runtime.stageIndex);
        if (nextStage) {
          runtime.stagePropellantKg = Number(nextStage.propellantMassKg) || 0;
          runtime.coastRemainingSec = Math.max(0, Number(stage.coastAfterBurnSec) || 0);
          runtime.phase = runtime.coastRemainingSec > 0 ? "coast" : "powered";
          runtime.stageActuator = createActuatorState(
            normalize(subtract(rocketState.position, earthState.position), currentEarthAxes.pole),
          );
          runtime.stageMassModel = createMassModelState();
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
          runtime.stageActuator = createActuatorState(normalize(relPos, currentEarthAxes.pole));
          runtime.stageMassModel = createMassModelState();
        }
      }
    }

    // Hot-staging overlap: detach booster when stage-2 ignition is stable and overlap gates are met.
    if (runtime.hotstage.active && !runtime.booster.active) {
      const stage2 = stageAtIndex(1);
      const stage2PeakThrustN = Math.max(
        Number(stage2?.thrustVacuumN) || 0,
        Number(stage2?.thrustSeaLevelN) || 0,
      );
      const hotstageGate = updateHotstageGates(runtime.hotstage, {
        elapsedSeconds: runtime.elapsedSeconds,
        stageIndex: runtime.stageIndex,
        phase: runtime.phase,
        stage2ThrustN: Number(runtime.lastStep?.thrustN) || 0,
        stage2PeakThrustN,
        dtSeconds,
      });
      if (
        Number.isFinite(hotstageGate.timeSinceIgnitionSec)
        && hotstageGate.detachReady
      ) {
        const detachReason = hotstageGate.timeoutExceeded ? "timeout-failsafe" : "state-gated-ready";
        const ignitionStableSec = hotstageGate.ignitionStableSec;
        const boosterStage = stageAtIndex(0);
        const separatedBooster = createSeparatedBoosterState({
          state,
          rocketState,
          earthState,
          currentEarthAxes,
          stage: boosterStage,
          reservePropellantKgOverride: runtime.hotstage.boosterReservePropellantKg,
        });
        if (separatedBooster) {
          rocketState.massKg = Math.max(
            MIN_ROCKET_MASS_KG,
            rocketState.massKg - (Number(separatedBooster.massKg) || 0),
          );
        }
        runtime.hotstage = finishHotstageDetach(runtime.hotstage, detachReason);
        emitLaunchEvent("hotstage_detach", {
          reason: detachReason,
          overlapSeconds: hotstageGate.overlapSeconds,
          timeoutSeconds: hotstageGate.timeoutSec,
          timeSinceIgnitionSec: hotstageGate.timeSinceIgnitionSec,
          ignitionStableSec,
          requiredIgnitionStableSec: hotstageGate.requiredStableSec,
          stage2ThrustN: hotstageGate.stage2ThrustN,
          ignitionStableThrustN: hotstageGate.ignitionStableThrustN,
          virtualSeparationKm: hotstageGate.virtualSeparationKm,
          requiredSeparationKm: hotstageGate.requiredSeparationKm,
          boosterCreated: Boolean(separatedBooster),
        });
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
      const windSample = sampleWindVectorKmS({
        altitudeKm,
        relPos: relPosNow,
        earthPole: currentEarthAxes.pole,
        elapsedSeconds: runtime.elapsedSeconds,
        seed: runtime.windSeed,
      });
      const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
        atmosphereSample,
        relPosNow,
        relVelNow,
        currentEarthAxes.pole,
        windSample.vectorKmS,
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
    const hotstageSinceIgnitionSec = hotstageTimeSinceIgnitionSec(runtime.hotstage, runtime.elapsedSeconds);
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
        hotstageActive: Boolean(runtime.hotstage.active),
        hotstageTimeSinceIgnitionSec: hotstageSinceIgnitionSec,
        hotstageOverlapSeconds: Number(runtime.hotstage.overlapSeconds) || hotstageOverlapSeconds(),
        hotstageIgnitionStableSec: Number(runtime.hotstage.ignitionStableSec) || 0,
        hotstageVirtualSeparationKm: Number(runtime.hotstage.virtualSeparationKm) || 0,
        hotstageDetachReason: runtime.hotstage.detachReason || null,
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
      throttleCommand: telemetry.throttleCommand,
      angleOfAttackDeg: telemetry.angleOfAttackDeg,
      qAlphaPaRad: telemetry.qAlphaPaRad,
      machNumber: telemetry.machNumber,
      dragCoefficient: telemetry.dragCoefficient,
      liftCoefficient: telemetry.liftCoefficient,
      gimbalErrorDeg: telemetry.gimbalErrorDeg,
      windSpeedKmS: telemetry.windSpeedKmS,
      windEastMS: telemetry.windEastMS,
      windNorthMS: telemetry.windNorthMS,
      comNormalized: telemetry.comNormalized,
      inertiaNormalized: telemetry.inertiaNormalized,
      controlAuthorityScale: telemetry.controlAuthorityScale,
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
      boosterThrottleCommand: Number(runtime.booster.telemetry?.throttleCommand) || Number(runtime.booster.lastStep?.throttleCommand) || 0,
      boosterAngleOfAttackDeg: Number(runtime.booster.telemetry?.angleOfAttackDeg) || 0,
      boosterQAlphaPaRad: Number(runtime.booster.telemetry?.qAlphaPaRad) || 0,
      boosterMachNumber: Number(runtime.booster.telemetry?.machNumber) || 0,
      boosterDragCoefficient: Number(runtime.booster.telemetry?.dragCoefficient) || 0,
      boosterLiftCoefficient: Number(runtime.booster.telemetry?.liftCoefficient) || 0,
      boosterGimbalErrorDeg: Number(runtime.booster.telemetry?.gimbalErrorDeg) || 0,
      boosterWindSpeedKmS: Number(runtime.booster.telemetry?.windSpeedKmS) || 0,
      boosterWindEastMS: Number(runtime.booster.telemetry?.windEastMS) || 0,
      boosterWindNorthMS: Number(runtime.booster.telemetry?.windNorthMS) || 0,
      boosterComNormalized: Number(runtime.booster.telemetry?.comNormalized) || 0,
      boosterInertiaNormalized: Number(runtime.booster.telemetry?.inertiaNormalized) || 0,
      boosterControlAuthorityScale: Number(runtime.booster.telemetry?.controlAuthorityScale) || 0,
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
      hotstageActive: Boolean(telemetry.hotstageActive),
      hotstageTimeSinceIgnitionSec: telemetry.hotstageTimeSinceIgnitionSec,
      hotstageOverlapSeconds: telemetry.hotstageOverlapSeconds,
      hotstageIgnitionStableSec: telemetry.hotstageIgnitionStableSec,
      hotstageVirtualSeparationKm: telemetry.hotstageVirtualSeparationKm,
      hotstageDetachReason: telemetry.hotstageDetachReason,
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
