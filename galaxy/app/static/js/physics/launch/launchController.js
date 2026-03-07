import {
  BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM,
  EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
  LAUNCH_AUTOPILOT_CONFIG,
  LAUNCH_BOOSTER_BODY_ID,
  LAUNCH_BOOSTER_CONFIG,
  LAUNCH_BOOSTER_META,
  LAUNCH_BODY_ID,
  LAUNCH_BODY_META,
  LAUNCH_REFUEL_TANKER_METAS,
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
} from "./launchMissions.js?v=20260302n";
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
import {
  createLaunchRefuelController,
  computeRefuelFillFraction,
  refuelDefaults,
  resolveRefuelTargetKg,
} from "./launchRefuel.js";
import { isFlightDockingEligible } from "./refuel/availability.js";
import {
  buildVehicleStatusSnapshot,
  tankerMetaForId,
} from "./launchVehicleTelemetry.js";
import { createLaunchFleetController } from "./launchFleetController.js";
import {
  createNavigationSystem,
  DEFAULT_MOON_MISSION_PROFILE,
  NAVIGATION_DEFAULTS,
  NAVIGATION_SYSTEM_MODES,
} from "../navigation_system/index.js";
import { enforceMoonEarthAvoidanceDirection } from "./lunar/guidanceSafety.js";
import { computeMoonRefuelRecoveryOverride } from "./lunar/refuelRecovery.js";
import {
  clearMoonDepartureWindowClock,
  updateMoonDepartureWindowClock,
} from "./lunar/moonLaunchWindowClock.js";
import { evaluateMoonTliGoNoGo } from "./lunar/moonGoNoGoGates.js";
import { computeMoonSurvivalRecoveryOverride } from "./lunar/moonSurvivalRecovery.js";
import {
  MOON_BURN_ATTITUDE_GATE_ENTER_ERROR_DEG,
  MOON_BURN_ATTITUDE_GATE_EXIT_ERROR_DEG,
  MOON_BURN_ATTITUDE_GATE_PHASES,
  MOON_PARKING_ORBIT_APOAPSIS_KM,
} from "./lunar/constants.js";
import { evaluateMoonBurnAttitudeGate } from "./lunar/moonBurnAttitudeGate.js";

const MIN_ROCKET_MASS_KG = 500;
const PRIMARY_ORBITAL_REFUEL_DEMO_STAGE2_MIN_PROPELLANT_KG = 2_400_000;
const PRIMARY_MOON_MISSION_STAGE2_MIN_PROPELLANT_KG = 5_000_000;
const PAD_TANKER_DEPLOYMENT_MIN_PERIAPSIS_KM = 145;
const PAD_TANKER_DEPLOYMENT_MIN_APOAPSIS_KM = 150;
const PAD_TANKER_DEPLOYMENT_MAX_PERIAPSIS_KM = 165;
const PAD_TANKER_DEPLOYMENT_MAX_APOAPSIS_KM = 165;
const PRIMARY_QALPHA_ACTIVE_MAX_ALTITUDE_KM = 105;
const PRIMARY_QALPHA_ACTIVE_MIN_DYNAMIC_PRESSURE_PA = 120;
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

function stagePropellantCapacityKgForMissionStage(stageIndex, missionId = null) {
  const stage = stageAtIndex(stageIndex);
  const baseCapacityKg = Math.max(0, Number(stage?.propellantMassKg) || 0);
  const normalizedMissionId = normalizeMissionId(missionId);
  if (Number(stageIndex) === 1 && normalizedMissionId === LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO) {
    return Math.max(baseCapacityKg, PRIMARY_ORBITAL_REFUEL_DEMO_STAGE2_MIN_PROPELLANT_KG);
  }
  if (Number(stageIndex) === 1 && normalizedMissionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
    return Math.max(baseCapacityKg, PRIMARY_MOON_MISSION_STAGE2_MIN_PROPELLANT_KG);
  }
  return baseCapacityKg;
}

function surfaceLaunchStagePropellantCapacityKgForMissionStage(stageIndex, missionId = null) {
  const stage = stageAtIndex(stageIndex);
  const baseCapacityKg = Math.max(0, Number(stage?.propellantMassKg) || 0);
  if (Number(stageIndex) !== 1) {
    return baseCapacityKg;
  }
  const normalizedMissionId = normalizeMissionId(missionId);
  if (
    normalizedMissionId === LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO
    || normalizedMissionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
  ) {
    return baseCapacityKg;
  }
  return baseCapacityKg;
}

function stage2PropellantCapacityKg(missionId = null) {
  return stagePropellantCapacityKgForMissionStage(
    1,
    normalizeMissionId(missionId || DEFAULT_LAUNCH_MISSION_ID),
  );
}

function launchInitialMassKgForMission(missionId = null) {
  const normalizedMissionId = normalizeMissionId(missionId || DEFAULT_LAUNCH_MISSION_ID);
  const payloadMassKg = Math.max(0, Number(LAUNCH_VEHICLE_CONFIG?.payloadMassKg) || 0);
  const stages = Array.isArray(LAUNCH_VEHICLE_CONFIG?.stages) ? LAUNCH_VEHICLE_CONFIG.stages : [];
  const stageMassKg = stages.reduce((totalMassKg, stage, index) => (
    totalMassKg
      + Math.max(0, Number(stage?.dryMassKg) || 0)
      + stagePropellantCapacityKgForMissionStage(index, normalizedMissionId)
  ), 0);
  return Math.max(MIN_ROCKET_MASS_KG, payloadMassKg + stageMassKg);
}

function surfaceLaunchInitialMassKgForMission(missionId = null) {
  const normalizedMissionId = normalizeMissionId(missionId || DEFAULT_LAUNCH_MISSION_ID);
  const payloadMassKg = Math.max(0, Number(LAUNCH_VEHICLE_CONFIG?.payloadMassKg) || 0);
  const stages = Array.isArray(LAUNCH_VEHICLE_CONFIG?.stages) ? LAUNCH_VEHICLE_CONFIG.stages : [];
  const stageMassKg = stages.reduce((totalMassKg, stage, index) => (
    totalMassKg
      + Math.max(0, Number(stage?.dryMassKg) || 0)
      + surfaceLaunchStagePropellantCapacityKgForMissionStage(index, normalizedMissionId)
  ), 0);
  return Math.max(MIN_ROCKET_MASS_KG, payloadMassKg + stageMassKg);
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

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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
  const refuelTargetPropellantKg = resolveRefuelTargetKg(
    runtime.refuel,
    stage2PropellantCapacityKg(runtime?.mission?.selectedId),
  );
  const refuelFillFraction = computeRefuelFillFraction(
    runtime.stagePropellantKg,
    refuelTargetPropellantKg,
  );
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
    stagePropellantKg: Math.max(0, Number(runtime.stagePropellantKg) || 0),
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
    moonDepartureWindowScore: finiteOrNull(runtime.moonDepartureWindowScore),
    moonDepartureWindowWaitSec: finiteOrNull(runtime.moonDepartureWindowWaitSec),
    moonDepartureWindowPhaseErrorDeg: finiteOrNull(runtime.moonDepartureWindowPhaseErrorDeg),
    moonDepartureGeometryScore: finiteOrNull(runtime.moonDepartureGeometryScore),
    moonDepartureAlignNow: finiteOrNull(runtime.moonDepartureAlignNow),
    moonDepartureAlignProjected: finiteOrNull(runtime.moonDepartureAlignProjected),
    moonEstimatedTliDeltaVKmS: finiteOrNull(runtime.moonEstimatedTliDeltaVKmS),
    moonDepartureWindowReady: Boolean(runtime.moonDepartureWindowReady),
    moonDepartureWindowLaunchTimeMs: Number.isFinite(Number(runtime.moonDepartureWindowLaunchTimeMs))
      ? Number(runtime.moonDepartureWindowLaunchTimeMs)
      : null,
    refuelRequiredFlights: Math.max(0, Number(runtime.refuel.requiredFlights) || 0),
    refuelCompletedFlights: Math.max(0, Number(runtime.refuel.completedFlights) || 0),
    refuelActiveFlights: Math.max(0, Number(runtime.refuel.activeFlights) || 0),
    refuelLaunchedFlights: Math.max(0, Number(runtime.refuel.launchedFlights) || 0),
    refuelTargetPropellantKg,
    refuelFillFraction,
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

function missionTargetOrbitAltitudeKm(missionId) {
  const normalized = normalizeMissionId(missionId);
  if (normalized === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
    return Math.max(120, Number(MOON_PARKING_ORBIT_APOAPSIS_KM) || 500);
  }
  return Math.max(80, Number(LAUNCH_AUTOPILOT_CONFIG.targetOrbitAltitudeKm) || 250);
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
    targetOrbitAltitudeKm: missionTargetOrbitAltitudeKm(DEFAULT_LAUNCH_MISSION_ID),
    launchPlaneNormal: null,
    boosterDistanceKm: 0,
    starshipDistanceKm: 0,
    earthDistanceKm: null,
    earthClosingSpeedKmS: null,
    moonDistanceKm: null,
    moonClosingSpeedKmS: null,
    moonRelativeSpeedKmS: null,
    moonProjectedMissDistanceKm: null,
    moonProjectedPeriluneAltitudeKm: null,
    moonBPlaneErrorKm: null,
    moonDepartureWindowScore: null,
    moonDepartureWindowWaitSec: null,
    moonDepartureWindowPhaseErrorDeg: null,
    moonDepartureGeometryScore: null,
    moonDepartureAlignNow: null,
    moonDepartureAlignProjected: null,
    moonEstimatedTliDeltaVKmS: null,
    moonDepartureWindowReady: false,
    moonDepartureWindowLaunchTimeMs: null,
    moonEarthGuardActive: false,
    moonBurnAttitudeGateActive: false,
    moonBurnAttitudeGateDirection: null,
    moonBurnAttitudeGateAlignSec: 0,
    missionPhaseGateReason: "",
    lastTrackedPositionKm: null,
    lastSurfaceSample: null,
    windSeed: Date.now() % 1_000_000,
    stageActuator: createActuatorState({ x: 0, y: 0, z: 1 }),
    stageMassModel: createMassModelState(),
    boosterActuator: createActuatorState({ x: 0, y: 0, z: 1 }),
    boosterMassModel: createMassModelState(),
    stage2RefuelRecoveryApplied: false,
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
    refuel: refuelDefaults({
      targetPropellantKg: stage2PropellantCapacityKg(DEFAULT_LAUNCH_MISSION_ID),
    }),
    fleet: {
      nextShipSequence: 1,
      vehicles: new Map(),
    },
    hotstage: createHotstageState(),
    pendingPadTankerLaunch: null,
  };
  const primaryNavigationSystem = createNavigationSystem({
    missionId: runtime.mission.selectedId,
    mode: NAVIGATION_SYSTEM_MODES.RULE_BASED_BASELINE,
  });
  const lastEmittedEventByKey = new Map();

  function finiteVector(v) {
    return Boolean(
      v
      && Number.isFinite(Number(v.x))
      && Number.isFinite(Number(v.y))
      && Number.isFinite(Number(v.z)),
    );
  }

  function finiteNumber(value, fallback = 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const fallbackNumeric = Number(fallback);
    return Number.isFinite(fallbackNumeric) ? fallbackNumeric : 0;
  }

  function finiteOrNull(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function cloneVector(value, fallback = { x: 0, y: 0, z: 0 }) {
    if (!finiteVector(value)) {
      return {
        x: Number(fallback?.x) || 0,
        y: Number(fallback?.y) || 0,
        z: Number(fallback?.z) || 0,
      };
    }
    return {
      x: Number(value.x),
      y: Number(value.y),
      z: Number(value.z),
    };
  }

  function cloneVectorOrNull(value) {
    return finiteVector(value) ? cloneVector(value) : null;
  }

  function cloneJson(value, fallback = null) {
    if (value === undefined) {
      return fallback;
    }
    if (value === null) {
      return null;
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return fallback;
    }
  }

  function isManagedLaunchBodyId(bodyId) {
    const id = String(bodyId || "");
    return id === LAUNCH_BODY_ID
      || id === LAUNCH_BOOSTER_BODY_ID
      || id.startsWith("earth_refuel_tanker_")
      || id.startsWith("earth_mission_ship_");
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

  const refuelController = createLaunchRefuelController({
    runtime,
    missionIdMoonOrbitReturn: LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
    missionIdsRefuelEligible: [
      LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
      LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO,
    ],
    stage2CapacityKg: stage2PropellantCapacityKg,
    stage2DryMassKg: () => Math.max(10_000, Number(stageAtIndex(1)?.dryMassKg) || 120_000),
    getEarthRadiusKm,
    getEarthMassKg,
    gravitationalConstantKm3PerKgS2,
    minRocketMassKg: MIN_ROCKET_MASS_KG,
    rocketStateFromNBody,
    earthStateFromNBody,
    finiteVector,
    emitLaunchEvent,
    buildTankerMeta: ({ id, sequenceNumber, massKg }) => (
      tankerMetaForId(id, sequenceNumber, massKg, LAUNCH_REFUEL_TANKER_METAS[0] || null)
    ),
  });
  const fleetController = createLaunchFleetController({
    runtime,
    stageAtIndex,
    minRocketMassKg: MIN_ROCKET_MASS_KG,
    getEarthRadiusKm,
    getEarthMassKg,
    getBodyRadiusKm,
    getBodyMassKg,
    sampleEarthAtmosphere,
    earthAxes,
    gravitationalConstantKm3PerKgS2,
    emitLaunchEvent,
  });

  function projectedClosestApproachDistanceKm({
    relativePositionKm = null,
    relativeVelocityKmS = null,
    horizonSec = 36 * 3600,
  } = {}) {
    if (!finiteVector(relativePositionKm)) {
      return Number.POSITIVE_INFINITY;
    }
    const initialDistanceKm = length(relativePositionKm);
    if (!finiteVector(relativeVelocityKmS)) {
      return initialDistanceKm;
    }
    const relativeSpeedSq = dot(relativeVelocityKmS, relativeVelocityKmS);
    if (!(relativeSpeedSq > 1e-12)) {
      return initialDistanceKm;
    }
    const safeHorizonSec = Math.max(1, Number(horizonSec) || 1);
    const timeToClosestSec = clamp(
      -dot(relativePositionKm, relativeVelocityKmS) / relativeSpeedSq,
      0,
      safeHorizonSec,
    );
    return length(add(
      relativePositionKm,
      scale(relativeVelocityKmS, timeToClosestSec),
    ));
  }

  function gateReasonLabel(reasonCode = "") {
    const code = String(reasonCode || "").trim().toLowerCase();
    if (!code) {
      return "";
    }
    const labels = {
      parking_orbit_ready: "Parking orbit gate passed",
      refuel_target_met: "Refuel target gate passed",
      tli_escape_conditions_met: "TLI escape gate passed",
      moon_approach_gate: "Moon approach gate passed",
      lunar_capture_achieved: "Lunar capture gate passed",
      lunar_hold_complete: "Lunar hold gate passed",
      tei_departure_complete: "TEI departure gate passed",
      earth_capture_gate: "Earth capture approach gate passed",
      earth_capture_complete: "Earth orbit capture gate passed",
    };
    return labels[code] || code.replace(/[_-]+/g, " ");
  }

  function formatGateKm(value, digits = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return "n/a";
    }
    return `${numeric.toFixed(Math.max(0, Number(digits) || 0))} km`;
  }

  function formatGateSpeed(value, digits = 4) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return "n/a";
    }
    return `${numeric.toFixed(Math.max(0, Number(digits) || 0))} km/s`;
  }

  function formatGatePercent(value, digits = 1) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return "n/a";
    }
    return `${(numeric * 100).toFixed(Math.max(0, Number(digits) || 0))}%`;
  }

  function moonMissionPhaseGateReason({
    phase = "",
    orbital = null,
    moonOrbit = null,
    moonDistanceKm = Number.POSITIVE_INFINITY,
    moonAltitudeKm = Number.POSITIVE_INFINITY,
    moonClosingSpeedKmS = 0,
    moonProjectedMissDistanceKm = Number.POSITIVE_INFINITY,
    moonProjectedPeriluneAltitudeKm = Number.POSITIVE_INFINITY,
    moonBPlaneErrorKm = Number.POSITIVE_INFINITY,
    earthDistanceKm = Number.POSITIVE_INFINITY,
    earthRadialSpeedKmS = 0,
    refuelFillFraction = 0,
    missionElapsedInPhaseSec = 0,
    phaseDecisionReason = "",
  } = {}) {
    const profile = DEFAULT_MOON_MISSION_PROFILE;
    if (phaseDecisionReason) {
      return gateReasonLabel(phaseDecisionReason);
    }
    const missionPhase = String(phase || "").trim();
    if (missionPhase === "launch_to_parking") {
      return `Awaiting parking orbit gate: apo/peri >= ${formatGateKm(profile.parkingOrbitApoapsisMinKm)} / ${formatGateKm(profile.parkingOrbitPeriapsisMinKm)}.`;
    }
    if (missionPhase === "orbital_refuel") {
      return `Awaiting refuel target: fill ${formatGatePercent(refuelFillFraction)} / ${formatGatePercent(profile.refuelTargetFillFraction)}.`;
    }
    if (missionPhase === "tli_burn") {
      return `Awaiting TLI gate: apo >= ${formatGateKm(profile.tliTargetApoapsisKm - profile.tliApoapsisMarginKm)}, miss <= ${formatGateKm(profile.tliInterceptMissDistanceKm)}.`;
    }
    if (missionPhase === "coast_to_moon") {
      return `Awaiting lunar approach: distance ${formatGateKm(moonDistanceKm)} <= ${formatGateKm(profile.moonApproachDistanceKm)} (closing ${formatGateSpeed(moonClosingSpeedKmS)}, miss ${formatGateKm(moonProjectedMissDistanceKm)}).`;
    }
    if (missionPhase === "lunar_insertion") {
      return `Awaiting lunar capture: altitude ${formatGateKm(moonAltitudeKm)} | periapsis est ${formatGateKm(moonProjectedPeriluneAltitudeKm)} | B-plane ${formatGateKm(moonBPlaneErrorKm)}.`;
    }
    if (missionPhase === "lunar_orbit_hold") {
      const remainingSec = Math.max(0, Number(profile.lunarHoldDurationSec) - Math.max(0, Number(missionElapsedInPhaseSec) || 0));
      return `Holding lunar orbit: TEI unlock in ${Math.round(remainingSec)}s.`;
    }
    if (missionPhase === "tei_burn") {
      return `Awaiting TEI departure: moon distance ${formatGateKm(moonDistanceKm)} >= ${formatGateKm(profile.teiDepartureDistanceKm)} and Earth radial < 0 (${formatGateSpeed(earthRadialSpeedKmS)}).`;
    }
    if (missionPhase === "coast_to_earth") {
      return `Awaiting Earth capture approach: Earth distance ${formatGateKm(earthDistanceKm)} <= ${formatGateKm(profile.earthCaptureDistanceKm)}.`;
    }
    if (missionPhase === "earth_capture") {
      return `Awaiting Earth capture orbit: apo/peri <= ${formatGateKm(profile.earthCaptureApoapsisMaxKm)} / >= ${formatGateKm(profile.earthCapturePeriapsisMinKm)}.`;
    }
    if (missionPhase === "earth_orbit_hold") {
      return "Mission phase gate complete: Earth orbit hold.";
    }
    if (Number(orbital?.specificEnergy) >= 0 && Number(orbital?.periapsisKm) < 0) {
      return "Awaiting bounded Earth orbit energy.";
    }
    if (moonOrbit && Number(moonOrbit.specificEnergy) < 0) {
      return "Moon-relative captured orbit detected.";
    }
    return "Awaiting next mission gate.";
  }

  function computePrimaryNavigationAutopilotCommand({
    state,
    earthState,
    rocketState,
    orbital,
    relPos,
    relVel,
    up,
    activeRefuelTarget,
  }) {
    if (runtime.mission.selectedId !== LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
      runtime.missionPhaseGateReason = "";
      return null;
    }
    if (!state || !earthState || !rocketState || !orbital) {
      runtime.missionPhaseGateReason = "Awaiting valid navigation state.";
      return null;
    }

    const moonState = bodyStateFromNBody(state, "moon");
    const sunState = bodyStateFromNBody(state, "sun");
    const activeStage = stageAtIndex(runtime.stageIndex);
    const moonMassKg = Number(getBodyMassKg?.("moon")) || Number(moonState?.massKg) || 7.342e22;
    const moonRadiusKm = Number(getBodyRadiusKm?.("moon")) || 1737.4;
    const moonMuKm3S2 = gravitationalConstantKm3PerKgS2 * moonMassKg;
    const moonRelPos = (moonState?.position && finiteVector(moonState.position))
      ? subtract(rocketState.position, moonState.position)
      : null;
    const moonRelVel = (moonState?.velocity && finiteVector(moonState.velocity))
      ? subtract(
        rocketState.velocity || { x: 0, y: 0, z: 0 },
        moonState.velocity || { x: 0, y: 0, z: 0 },
      )
      : null;
    const moonOrbit = moonRelPos && moonRelVel && moonMuKm3S2 > 0
      ? orbitalStateFromRelative(moonMuKm3S2, moonRadiusKm, moonRelPos, moonRelVel)
      : null;

    const earthDistanceKm = length(relPos);
    const earthRadialSpeedKmS = earthDistanceKm > 1e-9
      ? dot(relPos, relVel) / earthDistanceKm
      : 0;
    const moonDistanceKm = moonRelPos ? length(moonRelPos) : Number.POSITIVE_INFINITY;
    const moonAltitudeKm = moonDistanceKm - moonRadiusKm;
    const moonClosingSpeedKmS = moonRelPos && moonRelVel && moonDistanceKm > 1e-9
      ? -dot(moonRelVel, scale(moonRelPos, 1 / moonDistanceKm))
      : 0;
    const moonRelativeSpeedKmS = moonRelVel ? length(moonRelVel) : 0;
    const moonCircularSpeedKmS = moonMuKm3S2 > 0 && moonDistanceKm > 1
      ? Math.sqrt(moonMuKm3S2 / moonDistanceKm)
      : null;
    const toMoonVectorKm = moonState?.position
      ? subtract(moonState.position, rocketState.position)
      : null;
    const moonEarthPositionKm = moonState?.position
      ? subtract(moonState.position, earthState.position)
      : null;
    const moonEarthVelocityKmS = moonState?.velocity
      ? subtract(
        moonState.velocity || { x: 0, y: 0, z: 0 },
        earthState.velocity || { x: 0, y: 0, z: 0 },
      )
      : null;
    const sunEarthPositionKm = sunState?.position
      ? subtract(sunState.position, earthState.position)
      : null;
    const sunEarthVelocityKmS = sunState?.velocity
      ? subtract(
        sunState.velocity || { x: 0, y: 0, z: 0 },
        earthState.velocity || { x: 0, y: 0, z: 0 },
      )
      : null;
    const moonMinusShipRelativeVelocityKmS = moonRelVel ? scale(moonRelVel, -1) : null;
    const moonProjectedMissDistanceKm = projectedClosestApproachDistanceKm({
      relativePositionKm: toMoonVectorKm,
      relativeVelocityKmS: moonMinusShipRelativeVelocityKmS,
      horizonSec: 36 * 3600,
    });
    runtime.moonRelativeSpeedKmS = Number.isFinite(moonRelativeSpeedKmS)
      ? moonRelativeSpeedKmS
      : null;
    runtime.moonProjectedMissDistanceKm = Number.isFinite(moonProjectedMissDistanceKm)
      ? moonProjectedMissDistanceKm
      : null;
    const nearestRefuelTarget = activeRefuelTarget || refuelController.activeRendezvousTarget?.(state) || null;

    const refuelTargetKg = resolveRefuelTargetKg(
      runtime.refuel,
      stage2PropellantCapacityKg(runtime.mission.selectedId),
    );
    const refuelFillFraction = computeRefuelFillFraction(
      runtime.stagePropellantKg,
      refuelTargetKg,
    );
    const tangent = normalize(relVel, up);
    const stageMassKg = Math.max(
      MIN_ROCKET_MASS_KG,
      Number(rocketState?.massKg) || MIN_ROCKET_MASS_KG,
    );
    const engineAccelAtThrottle1KmS2 = (
      Number(activeStage?.thrustVacuumN) > 0
      && stageMassKg > 0
    )
      ? ((Number(activeStage.thrustVacuumN) / stageMassKg) / 1000)
      : null;
    const navResult = primaryNavigationSystem.update({
      measurement: {
        position: rocketState.position || { x: 0, y: 0, z: 0 },
        velocity: rocketState.velocity || { x: 0, y: 0, z: 0 },
      },
      orbital,
      moonOrbit,
      metrics: {
        altitudeKm: Number(orbital?.altitudeKm),
        apoapsisKm: Number(orbital?.apoapsisKm),
        periapsisKm: Number(orbital?.periapsisKm),
        earthDistanceKm,
        earthRadialSpeedKmS,
        moonDistanceKm,
        moonAltitudeKm,
        moonClosingSpeedKmS,
        moonRelativeSpeedKmS,
        moonCircularSpeedKmS,
        moonProjectedMissDistanceKm,
        stageMassKg,
        engineAccelAtThrottle1KmS2,
        bodyId: String(rocketState?.id || "primary_launch_vehicle"),
        refuelFillFraction,
        refuelTargetDistanceKm: Number(nearestRefuelTarget?.distanceKm),
        refuelRelativeSpeedKmS: Number(nearestRefuelTarget?.relativeSpeedKmS),
        refuelClosingSpeedKmS: Number(nearestRefuelTarget?.closingSpeedKmS),
      },
      targetVectors: {
        tangent,
        up,
        toMoon: toMoonVectorKm || tangent,
        toEarth: scale(relPos, -1),
        shipEarthPositionKm: relPos,
        shipEarthVelocityKmS: relVel,
        moonEarthPositionKm,
        moonEarthVelocityKmS,
        sunEarthPositionKm,
        sunEarthVelocityKmS,
        shipMinusMoonRelativeVelocityKmS: moonRelVel || null,
        moonMinusShipRelativeVelocityKmS,
        toRefuelTarget: nearestRefuelTarget?.relativePositionKm || null,
        refuelTargetRelativeVelocityKmS: nearestRefuelTarget?.relativeVelocityKmS || null,
      },
      timestampSec: runtime.elapsedSeconds,
    });

    const navState = navResult?.state;
    const navMoonPlanner = navState?.plannerState?.moon || null;
    runtime.moonProjectedPeriluneAltitudeKm = finiteOrNull(
      navMoonPlanner?.approach?.projectedPeriluneAltitudeKm,
    );
    runtime.moonBPlaneErrorKm = finiteOrNull(navMoonPlanner?.approach?.bPlaneErrorKm);
    const navPhaseDecisionReason = String(navResult?.phaseDecision?.reason || "").trim();
    const missionElapsedInPhaseSec = Math.max(
      0,
      Number(runtime.elapsedSeconds) - (Number(runtime.mission.phaseStartedElapsedSec) || 0),
    );
    runtime.missionPhaseGateReason = moonMissionPhaseGateReason({
      phase: String(navState?.missionPhase || runtime.mission.phase || ""),
      orbital,
      moonOrbit,
      moonDistanceKm,
      moonAltitudeKm,
      moonClosingSpeedKmS,
      moonProjectedMissDistanceKm,
      moonProjectedPeriluneAltitudeKm: runtime.moonProjectedPeriluneAltitudeKm,
      moonBPlaneErrorKm: runtime.moonBPlaneErrorKm,
      earthDistanceKm,
      earthRadialSpeedKmS,
      refuelFillFraction,
      missionElapsedInPhaseSec,
      phaseDecisionReason: navPhaseDecisionReason,
    });
    const navPhase = String(navState?.missionPhase || "").trim();
    if (navPhase && runtime.mission.phase !== navPhase) {
      setMissionPhase(runtime, navPhase);
    }
    runtime.mission.completed = Boolean(navState?.missionCompleted);
    const navDrivenMoonPhases = new Set([
      "orbital_refuel",
      "tli_burn",
      "coast_to_moon",
      "lunar_insertion",
      "lunar_orbit_hold",
      "tei_burn",
      "coast_to_earth",
      "earth_capture",
    ]);
    if (runtime.stageIndex < 1 || !navDrivenMoonPhases.has(navPhase)) {
      return null;
    }

    const refuelRecoveryCommand = computeMoonRefuelRecoveryOverride({
      missionPhase: navPhase,
      orbital,
      tangent,
      up,
    });
    if (refuelRecoveryCommand) {
      runtime.moonEarthGuardActive = false;
      runtime.missionPhaseGateReason = refuelRecoveryCommand.gateReason;
      return {
        phase: refuelRecoveryCommand.phase,
        throttle: clamp(Number(refuelRecoveryCommand.throttle) || 0, 0, 1),
        direction: normalize(refuelRecoveryCommand.direction || tangent, tangent),
        mode: String(refuelRecoveryCommand.mode || "navsys:orbital-refuel-orbit-recovery"),
      };
    }

    const command = navResult?.command;
    if (!command) {
      return null;
    }
    const phaseRaw = String(command.phase || "").trim().toLowerCase();
    const phase = phaseRaw === "powered" || phaseRaw === "orbit" ? phaseRaw : "coast";
    const constrainedCommand = enforceMoonEarthAvoidanceDirection({
      missionPhase: navPhase,
      commandPhase: phase,
      direction: normalize(command.direction || tangent, tangent),
      tangent,
      up,
      previousApplied: Boolean(runtime.moonEarthGuardActive),
      toMoonVectorKm,
      earthDistanceKm,
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
      periapsisKm: Number(orbital?.periapsisKm),
    });
    runtime.moonEarthGuardActive = constrainedCommand.applied;
    const modeBase = String(command.mode || "navigation-system");
    const survivalRecoveryOverride = computeMoonSurvivalRecoveryOverride({
      missionPhase: navPhase,
      periapsisKm: Number(orbital?.periapsisKm),
      altitudeKm: Number(orbital?.altitudeKm),
      radialSpeedKmS: Number(orbital?.radialSpeedKmS),
      prograde: tangent,
      up,
      availablePropellantKg: Number(runtime.stagePropellantKg),
    });
    if (survivalRecoveryOverride) {
      const overrideMode = constrainedCommand.applied
        ? `${String(survivalRecoveryOverride.mode || modeBase)}+${constrainedCommand.reason}:survival-priority`
        : `${String(survivalRecoveryOverride.mode || modeBase)}:survival-priority`;
      runtime.missionPhaseGateReason = String(survivalRecoveryOverride.gateReason || "");
      return {
        phase: "powered",
        throttle: clamp(Number(survivalRecoveryOverride.throttle) || 0, 0, 1),
        direction: normalize(
          survivalRecoveryOverride.direction || tangent,
          constrainedCommand.direction,
        ),
        mode: overrideMode,
      };
    }
    const goNoGo = evaluateMoonTliGoNoGo({
      missionId: runtime.mission.selectedId,
      missionPhase: navPhase,
      commandPhase: phase,
      requestedThrottle: phase === "powered" ? Number(command.throttle) || 0 : 0,
      periapsisKm: Number(orbital?.periapsisKm),
      altitudeKm: Number(orbital?.altitudeKm),
      propellantKg: Number(runtime.stagePropellantKg),
      missionElapsedInPhaseSec,
      moonDepartureWindowReady: runtime.moonDepartureWindowReady,
      moonDepartureWindowWaitSec: runtime.moonDepartureWindowWaitSec,
      plannerConfig: NAVIGATION_DEFAULTS.planner,
    });
    if (goNoGo.applies && !goNoGo.go) {
      const failures = Array.isArray(goNoGo.failures) ? goNoGo.failures : [];
      const periapsisFailure = failures.includes("periapsis-safe");
      const survivalRecovery = periapsisFailure
        ? computeMoonSurvivalRecoveryOverride({
          missionPhase: navPhase,
          periapsisKm: Number(goNoGo?.diagnostics?.periapsisKm),
          altitudeKm: Number(goNoGo?.diagnostics?.altitudeKm),
          radialSpeedKmS: Number(orbital?.radialSpeedKmS),
          prograde: tangent,
          up,
          availablePropellantKg: Number(runtime.stagePropellantKg),
          reasonPrefix: goNoGo.reason,
        })
        : null;
      if (survivalRecovery) {
        const recoveryMode = constrainedCommand.applied
          ? `${String(survivalRecovery.mode || modeBase)}+${constrainedCommand.reason}:go-no-go-survival-recovery`
          : `${String(survivalRecovery.mode || modeBase)}:go-no-go-survival-recovery`;
        runtime.missionPhaseGateReason = String(survivalRecovery.gateReason || goNoGo.reason);
        return {
          phase: "powered",
          throttle: clamp(Number(survivalRecovery.throttle) || 0, 0, 1),
          direction: normalize(survivalRecovery.direction || tangent, constrainedCommand.direction),
          mode: recoveryMode,
        };
      }
      runtime.missionPhaseGateReason = goNoGo.reason;
      const holdMode = constrainedCommand.applied
        ? `${modeBase}+${constrainedCommand.reason}:go-no-go-hold`
        : `${modeBase}:go-no-go-hold`;
      return {
        phase: "coast",
        throttle: 0,
        direction: constrainedCommand.direction,
        mode: holdMode,
      };
    }
    return {
      phase,
      throttle: phase === "powered" ? clamp(Number(command.throttle) || 0, 0, 1) : 0,
      direction: constrainedCommand.direction,
      mode: constrainedCommand.applied
        ? `${modeBase}+${constrainedCommand.reason}`
        : modeBase,
    };
  }

  function captureRuntimeLogState() {
    const targetDescriptor = missionTargetDescriptor();
    const activeRendezvousTankerId = String(runtime?.refuel?.activeRendezvousTankerId || "").trim();
    const targetBodyId = activeRendezvousTankerId || String(targetDescriptor?.bodyId || "").trim();
    const targetBodyName = targetBodyId.startsWith("earth_refuel_tanker_")
      ? "Refuel Tanker"
      : String(targetDescriptor?.bodyName || "");
    const guidanceMode = String(
      runtime.lastStep?.guidanceMode
      || runtime.lastTelemetry?.guidanceMode
      || runtime.autopilotMode
      || "",
    );
    const burnActive = (
      (Number(runtime.lastStep?.throttle) || 0) > 1e-3
      || (Number(runtime.lastStep?.thrustN) || 0) > 1
    );
    return {
      phase: runtime.phase,
      stageIndex: runtime.stageIndex,
      missionPhase: runtime.mission.phase,
      missionCompleted: Boolean(runtime.mission.completed),
      boosterActive: Boolean(runtime.booster.active),
      boosterPhase: runtime.booster.phase,
      boosterLanded: Boolean(runtime.booster.landed),
      guidanceMode,
      targetBodyId,
      targetBodyName,
      burnActive,
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
    if (current.guidanceMode !== previous.guidanceMode) {
      emitLaunchEvent("guidance_decision_changed", {
        trigger,
        fromGuidanceMode: previous.guidanceMode || "",
        toGuidanceMode: current.guidanceMode || "",
        targetBodyId: current.targetBodyId || "",
        targetBodyName: current.targetBodyName || "",
        burnActive: Boolean(current.burnActive),
      });
    }
    if (current.targetBodyId !== previous.targetBodyId) {
      emitLaunchEvent("guidance_target_changed", {
        trigger,
        fromTargetBodyId: previous.targetBodyId || "",
        toTargetBodyId: current.targetBodyId || "",
        toTargetBodyName: current.targetBodyName || "",
        guidanceMode: current.guidanceMode || runtime.autopilotMode || "",
      });
    }
    if (Boolean(current.burnActive) !== Boolean(previous.burnActive)) {
      emitLaunchEvent("guidance_burn_state_changed", {
        trigger,
        burnActive: Boolean(current.burnActive),
        guidanceMode: current.guidanceMode || runtime.autopilotMode || "",
        targetBodyId: current.targetBodyId || "",
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
    runtime.moonRelativeSpeedKmS = null;
    runtime.moonProjectedMissDistanceKm = null;
    runtime.moonProjectedPeriluneAltitudeKm = null;
    runtime.moonBPlaneErrorKm = null;
    runtime.moonDepartureWindowScore = null;
    runtime.moonDepartureWindowWaitSec = null;
    runtime.moonDepartureWindowPhaseErrorDeg = null;
    runtime.moonDepartureGeometryScore = null;
    runtime.moonDepartureAlignNow = null;
    runtime.moonDepartureAlignProjected = null;
    runtime.moonEstimatedTliDeltaVKmS = null;
    runtime.moonDepartureWindowReady = false;
    runtime.moonDepartureWindowLaunchTimeMs = null;
    runtime.moonEarthGuardActive = false;
    runtime.moonBurnAttitudeGateActive = false;
    runtime.moonBurnAttitudeGateDirection = null;
    runtime.moonBurnAttitudeGateAlignSec = 0;
    runtime.missionPhaseGateReason = "";
    runtime.lastTrackedPositionKm = null;
    runtime.lastSurfaceSample = null;
    runtime.windSeed = Date.now() % 1_000_000;
    runtime.stageActuator = createActuatorState({ x: 0, y: 0, z: 1 });
    runtime.stageMassModel = createMassModelState();
    runtime.boosterActuator = createActuatorState({ x: 0, y: 0, z: 1 });
    runtime.boosterMassModel = createMassModelState();
    runtime.stage2RefuelRecoveryApplied = false;
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
    refuelController.resetRefuelState();
    runtime.hotstage = resetHotstageState(runtime.hotstage);
    runtime.pendingPadTankerLaunch = null;
    primaryNavigationSystem.reset({
      missionIdOverride: missionId,
      modeOverride: NAVIGATION_SYSTEM_MODES.RULE_BASED_BASELINE,
      timestampSec: runtime.elapsedSeconds,
    });
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

  function clearFleetVehiclesFromState(state) {
    const dynamicBodies = state?.dynamicBodies;
    if (dynamicBodies && typeof dynamicBodies.keys === "function") {
      for (const bodyId of dynamicBodies.keys()) {
        const id = String(bodyId || "");
        if (!id || id === LAUNCH_BODY_ID || id === LAUNCH_BOOSTER_BODY_ID) {
          continue;
        }
        if (isManagedLaunchBodyId(id)) {
          dynamicBodies.delete(id);
        }
      }
    }
    if (!runtime.fleet || typeof runtime.fleet !== "object") {
      runtime.fleet = { nextShipSequence: 1, vehicles: new Map() };
      return;
    }
    runtime.fleet.vehicles = new Map();
    runtime.fleet.nextShipSequence = 1;
  }

  function updateRuntimeTargetMetrics(state, relPos, relVel, nowMs = Date.now()) {
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
      runtime.moonRelativeSpeedKmS = null;
      runtime.moonProjectedMissDistanceKm = null;
      runtime.moonProjectedPeriluneAltitudeKm = null;
      runtime.moonBPlaneErrorKm = null;
      clearMoonDepartureWindowClock(runtime);
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
    const moonRelativeSpeedKmS = length(moonRelVel);
    runtime.moonRelativeSpeedKmS = Number.isFinite(moonRelativeSpeedKmS)
      ? moonRelativeSpeedKmS
      : null;
    const projectedMissDistanceKm = projectedClosestApproachDistanceKm({
      relativePositionKm: moonRelPos,
      relativeVelocityKmS: moonRelVel,
      horizonSec: Number(NAVIGATION_DEFAULTS?.planner?.moonMidcoursePredictHorizonSec) || (36 * 3600),
    });
    runtime.moonProjectedMissDistanceKm = Number.isFinite(projectedMissDistanceKm)
      ? projectedMissDistanceKm
      : null;

    updateMoonDepartureWindowClock({
      runtime,
      missionId: runtime.mission.selectedId,
      nowMs,
      earthState: earthStateFromNBody(state),
      moonState,
      shipPositionKm: rocketState.position,
      launchLatitudeDeg: Number(LAUNCH_SITE.latitudeDeg) || 28.5,
      getEarthMassKg,
      getEarthRadiusKm,
      gravitationalConstantKm3PerKgS2,
      padAngularRateRadS: EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
    });
  }

  function missionTargetDescriptor() {
    const missionId = runtime.mission.selectedId;
    const missionPhase = runtime.mission.phase || "";
    if (missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
      const moonwardPhases = new Set([
        "launch_to_parking",
        "orbital_refuel",
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

  function refuelTankerIndicatorsFromState(state) {
    const indicators = {
      onlineTankers: 0,
      availableTankers: 0,
    };
    if (!state?.dynamicBodies || state.dynamicBodies.size <= 0) {
      return indicators;
    }
    const earthState = earthStateFromNBody(state);
    if (
      !earthState
      || !finiteVector(earthState.position)
      || !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      return indicators;
    }
    const refuelFlights = Array.isArray(runtime?.refuel?.flights) ? runtime.refuel.flights : [];
    const flightsById = new Map();
    for (let i = 0; i < refuelFlights.length; i += 1) {
      const flight = refuelFlights[i];
      const id = String(flight?.id || "").trim();
      if (id) {
        flightsById.set(id, flight);
      }
    }
    const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
    const earthMassKg = Number(getEarthMassKg?.()) || Number(earthState.massKg) || 0;
    const muKm3S2 = Number(gravitationalConstantKm3PerKgS2) * earthMassKg;
    for (const [bodyId, tankerState] of state.dynamicBodies.entries()) {
      const tankerId = String(bodyId || "");
      if (!tankerId.startsWith("earth_refuel_tanker_")) {
        continue;
      }
      if (
        !finiteVector(tankerState?.position)
        || !finiteVector(tankerState?.velocity || { x: 0, y: 0, z: 0 })
      ) {
        continue;
      }
      indicators.onlineTankers += 1;
      if (!(muKm3S2 > 0)) {
        continue;
      }
      const relPos = subtract(tankerState.position, earthState.position);
      const relVel = subtract(
        tankerState.velocity || { x: 0, y: 0, z: 0 },
        earthState.velocity || { x: 0, y: 0, z: 0 },
      );
      const orbital = orbitalStateFromRelative(muKm3S2, earthRadiusKm, relPos, relVel);
      const periapsisKm = Number(orbital?.periapsisKm);
      const apoapsisKm = Number(orbital?.apoapsisKm);
      const inStableEarthOrbit =
        Number(orbital?.specificEnergy) < 0
        && periapsisKm >= 145
        && periapsisKm <= 165
        && apoapsisKm >= 145
        && apoapsisKm <= 165;
      const refuelFlight = flightsById.get(tankerId) || null;
      const inferredAltitudeKm = length(relPos) - earthRadiusKm;
      const dockingEligible = isFlightDockingEligible(
        refuelFlight
          ? {
            ...refuelFlight,
            active: true,
            sensorAltitudeKm: Number.isFinite(inferredAltitudeKm)
              ? inferredAltitudeKm
              : refuelFlight.sensorAltitudeKm,
          }
          : {
            active: true,
            sensorAltitudeKm: inferredAltitudeKm,
            status: "external_orbit",
          },
        runtime?.refuel,
      );
      if (inStableEarthOrbit && dockingEligible) {
        indicators.availableTankers += 1;
      }
    }
    return indicators;
  }

  function launchMissionShip(state, missionId = runtime.mission.selectedId, nowMs = Date.now(), options = {}) {
    const safeOptions = {
      ...(options && typeof options === "object" ? options : {}),
      vehicleRole: "mission",
    };
    return fleetController.launchMissionShip(state, missionId, nowMs, safeOptions);
  }

  function removeVehicleById(state, bodyId, nowMs = Date.now()) {
    const id = String(bodyId || "").trim();
    if (!id) {
      return { accepted: false, reason: "invalid_body_id" };
    }
    if (id === LAUNCH_BODY_ID || id === LAUNCH_BOOSTER_BODY_ID) {
      return { accepted: false, reason: "primary_vehicle_protected" };
    }
    const dynamicBodies = state?.dynamicBodies;
    if (!dynamicBodies || typeof dynamicBodies.delete !== "function") {
      return { accepted: false, reason: "state_unavailable" };
    }

    const fleetRemoval = fleetController.removeVehicleById?.(
      state,
      id,
      { preserveDynamicBody: true },
    ) || { removed: false };
    const refuelRemoval = refuelController.removeTankerById?.(
      state,
      id,
      { preserveDynamicBody: true },
    ) || false;
    const removedDynamic = dynamicBodies.delete(id);

    if (String(runtime.pendingPadTankerLaunch?.tankerId || "") === id) {
      runtime.pendingPadTankerLaunch = null;
    }

    const removedAny = removedDynamic || fleetRemoval.removed || Boolean(refuelRemoval);
    if (!removedAny) {
      return { accepted: false, reason: "vehicle_not_found" };
    }

    const vehicleRole = fleetRemoval.removed
      ? String(fleetRemoval.vehicleRole || "mission")
      : (id.startsWith("earth_refuel_tanker_") ? "tanker" : "mission");
    emitLaunchEvent("vehicle_removed", {
      bodyId: id,
      vehicleRole,
      vehicleName: fleetRemoval.vehicleName || (vehicleRole === "tanker" ? "Starship Tanker" : "Starship"),
      missionId: fleetRemoval.missionId || null,
      missionPhase: fleetRemoval.missionPhase || null,
      removedDynamicBody: Boolean(removedDynamic),
      removedFleetVehicle: Boolean(fleetRemoval.removed),
      removedRefuelTracking: Boolean(refuelRemoval),
      timestampMs: nowMs,
    });
    emitRuntimeTransitionEvents("vehicle_removed");
    return {
      accepted: true,
      bodyId: id,
      vehicleRole,
      vehicleName: fleetRemoval.vehicleName || "",
      removedDynamicBody: Boolean(removedDynamic),
      removedFleetVehicle: Boolean(fleetRemoval.removed),
      removedRefuelTracking: Boolean(refuelRemoval),
    };
  }

  function reserveNextTankerIdentity(state) {
    if (!state?.dynamicBodies) {
      return null;
    }
    const activeFlights = Array.isArray(runtime.refuel.flights) ? runtime.refuel.flights : [];
    let sequenceNumber = Math.max(1, Number(runtime.refuel.nextGeneratedId) || 1);
    while (sequenceNumber < 1_000_000_000) {
      const id = `earth_refuel_tanker_${sequenceNumber}`;
      const existsInDynamics = state.dynamicBodies.has(id);
      const existsInFlights = activeFlights.some((flight) => String(flight?.id || "") === id);
      const existsPending = String(runtime.pendingPadTankerLaunch?.tankerId || "") === id;
      if (!existsInDynamics && !existsInFlights && !existsPending) {
        runtime.refuel.nextGeneratedId = sequenceNumber + 1;
        return { id, sequenceNumber };
      }
      sequenceNumber += 1;
    }
    return null;
  }

  function tankerDeploymentOrbitReady(orbital) {
    const specificEnergy = Number(orbital?.specificEnergy);
    const periapsisKm = Number(orbital?.periapsisKm);
    const apoapsisKm = Number(orbital?.apoapsisKm);
    if (!(specificEnergy < 0)) {
      return false;
    }
    if (!Number.isFinite(periapsisKm) || !Number.isFinite(apoapsisKm)) {
      return false;
    }
    return periapsisKm >= PAD_TANKER_DEPLOYMENT_MIN_PERIAPSIS_KM
      && apoapsisKm >= PAD_TANKER_DEPLOYMENT_MIN_APOAPSIS_KM
      && periapsisKm <= PAD_TANKER_DEPLOYMENT_MAX_PERIAPSIS_KM
      && apoapsisKm <= PAD_TANKER_DEPLOYMENT_MAX_APOAPSIS_KM;
  }

  function maybeFinalizePendingPadTankerLaunch(state, nowMs, {
    rocketState,
    orbital,
  } = {}) {
    const pending = runtime.pendingPadTankerLaunch;
    if (!pending?.active || !pending.tankerId) {
      return false;
    }
    if (!state?.dynamicBodies || !rocketState || runtime.stageIndex < 1) {
      return false;
    }
    if (!tankerDeploymentOrbitReady(orbital)) {
      return false;
    }

    const tankerMassKg = Math.max(MIN_ROCKET_MASS_KG, Number(rocketState.massKg) || MIN_ROCKET_MASS_KG);
    const tankerState = {
      id: pending.tankerId,
      massKg: tankerMassKg,
      position: { ...(rocketState.position || { x: 0, y: 0, z: 0 }) },
      velocity: { ...(rocketState.velocity || { x: 0, y: 0, z: 0 }) },
    };
    state.dynamicBodies.set(pending.tankerId, tankerState);

    emitLaunchEvent("refuel_tanker_pad_launch_completed", {
      tankerId: pending.tankerId,
      sequenceNumber: Number(pending.sequenceNumber) || 1,
      missionId: pending.missionId || LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD,
      deployedMassKg: tankerMassKg,
      orbitApoapsisKm: Number(orbital?.apoapsisKm),
      orbitPeriapsisKm: Number(orbital?.periapsisKm),
    });

    const restoreMissionId = normalizeMissionId(
      pending.restoreMissionId || DEFAULT_LAUNCH_MISSION_ID,
    );
    runtime.pendingPadTankerLaunch = null;
    const resetOk = resetToPad(state, nowMs, { clearRefuelTankers: false });
    if (!resetOk) {
      return true;
    }
    setMissionProfile(restoreMissionId);
    if (Number.isFinite(Number(pending.restoreTargetOrbitAltitudeKm))) {
      runtime.targetOrbitAltitudeKm = Math.max(80, Number(pending.restoreTargetOrbitAltitudeKm));
    }
    return true;
  }

  function launchRefuelTanker(state, nowMs = Date.now(), options = {}) {
    const requestedModeRaw = String(options?.mode || "pad_launch").trim().toLowerCase();
    const requestedMode = requestedModeRaw === "orbit_inject" ? "orbit_inject" : "pad_launch";
    const pendingPadTankerLaunchActive = Boolean(runtime.pendingPadTankerLaunch?.active);
    const launchStackIdle = runtime.phase === "idle"
      && !runtime.booster.active
      && !pendingPadTankerLaunchActive;
    if (requestedMode === "orbit_inject") {
      const orbitInject = refuelController.launchDirectOrbitTanker?.(state, nowMs);
      if (!orbitInject?.accepted) {
        return {
          accepted: false,
          reason: String(orbitInject?.reason || "orbit_inject_unavailable"),
          mode: "orbit_inject",
        };
      }
      emitLaunchEvent("refuel_tanker_orbit_inject_requested", {
        tankerId: orbitInject.tankerId,
        mode: "orbit_inject",
        orbitAltitudeKm: Number(orbitInject.orbitAltitudeKm),
      });
      return {
        ...orbitInject,
        mode: "orbit_inject",
        pending: false,
        launchKind: "tanker-orbit-inject",
      };
    }
    if (!launchStackIdle) {
      const identity = reserveNextTankerIdentity(state);
      if (!identity) {
        return {
          accepted: false,
          reason: "tanker_id_exhausted",
        };
      }
      const fleetLaunch = fleetController.launchMissionShip(
        state,
        LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD,
        nowMs,
        {
          forcedId: identity.id,
          forcedSequenceNumber: identity.sequenceNumber,
          vehicleRole: "tanker",
          vehicleName: `Starship Tanker ${identity.sequenceNumber}`,
        },
      );
      if (!fleetLaunch?.accepted) {
        return {
          accepted: false,
          reason: String(fleetLaunch?.reason || "fleet_tanker_launch_failed"),
        };
      }
      emitLaunchEvent("refuel_tanker_fleet_launch_requested", {
        tankerId: identity.id,
        sequenceNumber: identity.sequenceNumber,
        mode: pendingPadTankerLaunchActive ? "pad_fleet_launch_while_pad_pending" : "pad_fleet_launch",
      });
      return {
        accepted: true,
        tankerId: identity.id,
        tankerMeta: fleetLaunch.shipMeta
          || tankerMetaForId(identity.id, identity.sequenceNumber, null, LAUNCH_REFUEL_TANKER_METAS[0] || null),
        mode: pendingPadTankerLaunchActive ? "pad_fleet_launch_while_pad_pending" : "pad_fleet_launch",
        pending: false,
        launchKind: "tanker-pad-fleet",
      };
    }

    const identity = reserveNextTankerIdentity(state);
    if (!identity) {
      return {
        accepted: false,
        reason: "tanker_id_exhausted",
      };
    }
    const previousMissionId = normalizeMissionId(runtime.mission.selectedId);
    const previousTargetOrbitAltitudeKm = Number(runtime.targetOrbitAltitudeKm);
    runtime.targetOrbitAltitudeKm = 155;
    const started = startLaunch(state, nowMs, {
      missionIdOverride: LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD,
      preserveRefuelTankers: true,
      launchKind: "tanker-pad",
    });
    if (!started) {
      if (Number.isFinite(previousTargetOrbitAltitudeKm)) {
        runtime.targetOrbitAltitudeKm = Math.max(80, previousTargetOrbitAltitudeKm);
      }
      return {
        accepted: false,
        reason: "pad_launch_start_failed",
      };
    }

    const tankerMeta = tankerMetaForId(
      identity.id,
      identity.sequenceNumber,
      null,
      LAUNCH_REFUEL_TANKER_METAS[0] || null,
    );
    runtime.pendingPadTankerLaunch = {
      active: true,
      tankerId: identity.id,
      sequenceNumber: identity.sequenceNumber,
      restoreMissionId: previousMissionId,
      restoreTargetOrbitAltitudeKm: Number.isFinite(previousTargetOrbitAltitudeKm)
        ? previousTargetOrbitAltitudeKm
        : null,
      missionId: LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD,
    };
    runtime.refuel.nextGeneratedId = Math.max(
      Number(runtime.refuel.nextGeneratedId) || 1,
      identity.sequenceNumber + 1,
    );
    emitLaunchEvent("refuel_tanker_pad_launch_started", {
      tankerId: identity.id,
      sequenceNumber: identity.sequenceNumber,
      restoreMissionId: previousMissionId,
    });
    return {
      accepted: true,
      tankerId: identity.id,
      tankerMeta,
      mode: "pad_launch",
      pending: true,
      launchKind: "tanker-pad",
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
    for (let i = 0; i < LAUNCH_REFUEL_TANKER_METAS.length; i += 1) {
      mergeOrInsert(LAUNCH_REFUEL_TANKER_METAS[i]);
    }
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

  function resetToPad(state, nowMs = Date.now(), options = {}) {
    const clearFleetVehicles = options?.clearFleetVehicles === true;
    const clearRefuelTankers = clearFleetVehicles || options?.clearRefuelTankers !== false;
    clearBoosterFromState(state);
    if (clearFleetVehicles) {
      clearFleetVehiclesFromState(state);
    }
    if (clearRefuelTankers) {
      refuelController.clearRefuelTankersFromState(state);
    }
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
    updateRuntimeTargetMetrics(state, relPos, relVel, nowMs);
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

  function startLaunch(state, nowMs = Date.now(), options = {}) {
    const missionIdForLaunch = normalizeMissionId(
      options?.missionIdOverride || runtime.mission.selectedId,
    );
    const requestedTargetOrbitAltitudeKm = Number(options?.targetOrbitAltitudeKm);
    const preserveRefuelTankers = options?.preserveRefuelTankers !== false;
    if (!resetToPad(state, nowMs, { clearRefuelTankers: !preserveRefuelTankers })) {
      return false;
    }
    runtime.mission.selectedId = missionIdForLaunch;
    runtime.targetOrbitAltitudeKm = Number.isFinite(requestedTargetOrbitAltitudeKm)
      ? Math.max(80, requestedTargetOrbitAltitudeKm)
      : missionTargetOrbitAltitudeKm(missionIdForLaunch);
    const launchVehicleState = rocketStateFromNBody(state);
    if (launchVehicleState) {
      launchVehicleState.massKg = surfaceLaunchInitialMassKgForMission(runtime.mission.selectedId);
    }
    if (runtime.mission.selectedId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
      const earthState = earthStateFromNBody(state);
      const rocketState = rocketStateFromNBody(state);
      const moonState = bodyStateFromNBody(state, "moon");
      const currentEarthAxes = earthAxes(nowMs);
      if (
        finiteVector(earthState?.position)
        && finiteVector(rocketState?.position)
        && finiteVector(moonState?.position)
      ) {
        const up = normalize(
          subtract(rocketState.position, earthState.position),
          currentEarthAxes.pole,
        );
        const toMoon = subtract(moonState.position, rocketState.position);
        const toMoonDir = normalize(toMoon, up);
        const moonHorizontal = subtract(toMoonDir, scale(up, dot(toMoonDir, up)));
        let moonHeading = unitOrNull(moonHorizontal);
        if (moonHeading) {
          const east = normalize(
            cross(currentEarthAxes.pole, up),
            normalize(cross({ x: 0, y: 0, z: 1 }, up), { x: 1, y: 0, z: 0 }),
          );
          if (dot(moonHeading, east) < 0) {
            moonHeading = scale(moonHeading, -1);
          }
          const moonWindowPlaneNormal = unitOrNull(cross(up, moonHeading));
          if (moonWindowPlaneNormal) {
            runtime.launchPlaneNormal = moonWindowPlaneNormal;
          }
        }
      }
    }
    refuelController.applyMissionProfile(runtime.mission.selectedId);
    runtime.phase = "powered";
    runtime.autopilotMode = runtime.autopilotEnabled ? "autopilot-vertical-ascent" : "manual-ascent";
    setMissionPhase(runtime, defaultMissionPhaseForProfileId(runtime.mission.selectedId));
    runtime.mission.phaseStartedElapsedSec = runtime.elapsedSeconds;
    runtime.mission.completed = false;
    primaryNavigationSystem.reset({
      missionIdOverride: runtime.mission.selectedId,
      timestampSec: runtime.elapsedSeconds,
    });
    emitLaunchEvent("launch_started", {
      launchSiteName: LAUNCH_SITE.name || "Launch Site",
      autopilotEnabled: runtime.autopilotEnabled,
      missionId: runtime.mission.selectedId,
      missionPhase: runtime.mission.phase,
      launchKind: String(options?.launchKind || "primary"),
      moonWindowLocked: runtime.mission.selectedId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
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
    const qAlphaActive = (
      Number.isFinite(altitudeKm)
      && altitudeKm <= PRIMARY_QALPHA_ACTIVE_MAX_ALTITUDE_KM
      && Number(dynamicPressurePa) >= PRIMARY_QALPHA_ACTIVE_MIN_DYNAMIC_PRESSURE_PA
    );
    const qAlphaSteering = qAlphaActive
      ? applyQAlphaSteeringLimit({
        desiredDirection: direction,
        relAirVelocityKmS,
        dynamicPressurePa,
        bodyKind: "booster",
      })
      : {
        direction: normalize(direction, { x: 0, y: 0, z: 1 }),
        limited: false,
        qAlphaPaRad: 0,
      };
    direction = qAlphaSteering.direction;
    let requestedThrottle = canBurn ? clamp(Number(command.throttle) || 0, 0, 1) : 0;
    if (qAlphaActive) {
      requestedThrottle = limitThrottleByQAlpha({
        throttle: requestedThrottle,
        qAlphaPaRad: qAlphaSteering.qAlphaPaRad,
        bodyKind: "booster",
      });
    }

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
      fleetController.prepareStep(state, dtSeconds, nowMs);
      if (runtime.phase === "idle") {
        const earthState = earthStateFromNBody(state);
        const rocketState = rocketStateFromNBody(state);
        if (
          earthState
          && rocketState
          && finiteVector(earthState.position)
          && finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 })
          && finiteVector(rocketState.position)
          && finiteVector(rocketState.velocity || { x: 0, y: 0, z: 0 })
        ) {
          const relPos = subtract(rocketState.position, earthState.position);
          const relVel = subtract(
            rocketState.velocity || { x: 0, y: 0, z: 0 },
            earthState.velocity || { x: 0, y: 0, z: 0 },
          );
          updateRuntimeTargetMetrics(state, relPos, relVel, nowMs);
        }
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
      updateRuntimeTargetMetrics(state, relPos, relVel, nowMs);
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
        const qAlphaAtmosphereActive = (
          Number.isFinite(orbital.altitudeKm)
          && orbital.altitudeKm <= PRIMARY_QALPHA_ACTIVE_MAX_ALTITUDE_KM
          && Number(dynamicPressurePa) >= PRIMARY_QALPHA_ACTIVE_MIN_DYNAMIC_PRESSURE_PA
        );
        const qAlphaSteering = lowAltitudeQAlphaBypass || !qAlphaAtmosphereActive
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
        let steeringDirection = qAlphaSteering.direction;
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
          if (!lowAltitudeQAlphaBypass && qAlphaAtmosphereActive) {
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
        const moonBurnPhase = String(runtime?.mission?.phase || "");
        const moonAttitudeGateEligible = (
          canThrust
          && throttleCommand > 1e-3
          && runtime.stageIndex >= 1
          && runtime.mission.selectedId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
          && MOON_BURN_ATTITUDE_GATE_PHASES.has(moonBurnPhase)
        );
        const moonAttitudeGate = evaluateMoonBurnAttitudeGate({
          gateEligible: moonAttitudeGateEligible,
          gateWasActive: Boolean(runtime.moonBurnAttitudeGateActive),
          currentAxis: runtime.stageActuator?.directionActual || steeringDirection,
          desiredDirection: steeringDirection,
          latchedDirection: runtime.moonBurnAttitudeGateDirection,
          alignStableSec: runtime.moonBurnAttitudeGateAlignSec,
          dtSeconds,
          enterErrorDeg: MOON_BURN_ATTITUDE_GATE_ENTER_ERROR_DEG,
          exitErrorDeg: MOON_BURN_ATTITUDE_GATE_EXIT_ERROR_DEG,
        });
        steeringDirection = moonAttitudeGate.requestedDirection;
        if (moonAttitudeGate.throttleSuppressed && canThrust) {
          throttleCommand = 0;
        }
        runtime.moonBurnAttitudeGateActive = moonAttitudeGate.gateActive;
        runtime.moonBurnAttitudeGateDirection = moonAttitudeGate.latchedDirection;
        runtime.moonBurnAttitudeGateAlignSec = moonAttitudeGate.alignStableSec;

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
        let guidanceModeLabel = qAlphaSteering.limited
          ? `${guidanceMode}+qalpha-limit`
          : guidanceMode;
        if (runtime.moonBurnAttitudeGateActive && !guidanceModeLabel.includes("attitude-align")) {
          guidanceModeLabel = `${guidanceModeLabel}+attitude-align`;
        }
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

      const orbitalRefuelMissionActive =
        runtime.stageIndex >= 1
        && String(runtime?.mission?.phase || "") === "orbital_refuel";
      if (runtime.phase === "orbit" && orbitalRefuelMissionActive) {
        runtime.phase = "coast";
        runtime.autopilotMode = "navsys:orbital-refuel-await-target";
      }
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
          const activeRefuelTarget = refuelController.activeRendezvousTarget?.(state) || null;
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
          const missionCommand = computePrimaryNavigationAutopilotCommand({
            state,
            earthState,
            rocketState,
            orbital,
            relPos,
            relVel,
            up: orbital.up,
            activeRefuelTarget,
          }) || computeMissionAutopilotCommand({
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
            activeRefuelTarget,
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
        const activeRefuelTarget = refuelController.activeRendezvousTarget?.(state) || null;
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
        const missionCommand = computePrimaryNavigationAutopilotCommand({
          state,
          earthState,
          rocketState,
          orbital,
          relPos,
          relVel,
          up: orbital.up,
          activeRefuelTarget,
        }) || computeMissionAutopilotCommand({
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
          activeRefuelTarget,
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
    return fleetController.externalAccelerationKmS2(bodyId);
  }

  function finalizeStep(state, dtSeconds, nowMs = Date.now()) {
    try {
      const fleetActive = fleetController.hasActiveVehicles();
      if (runtime.phase === "idle" && !runtime.booster.active && !fleetActive) {
        return;
      }
      if (runtime.phase === "idle" && !runtime.booster.active) {
        fleetController.finalizeStep(state, dtSeconds, nowMs);
        return;
      }
      if (runtime.phase === "complete") {
        runtime.phase = "coast";
      }
      const rocketState = rocketStateFromNBody(state);
      const earthState = earthStateFromNBody(state);
      if (!rocketState || !earthState) {
        runtime.phase = "idle";
        fleetController.finalizeStep(state, dtSeconds, nowMs);
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
        fleetController.finalizeStep(state, dtSeconds, nowMs);
        return;
      }
      const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
      const currentEarthAxes = earthAxes(nowMs);
      const moonRefuelRecoveryEligible =
        runtime.stageIndex > 1
        && isMoonTransferMissionActive(runtime)
        && runtime.mission.phase === "orbital_refuel";
      if (moonRefuelRecoveryEligible) {
        const stage2 = stageAtIndex(1);
        const stage2DryMassKg = Math.max(0, Number(stage2?.dryMassKg) || 0);
        if (!runtime.stage2RefuelRecoveryApplied && stage2DryMassKg > 0) {
          rocketState.massKg = Math.max(
            MIN_ROCKET_MASS_KG,
            (Number(rocketState.massKg) || MIN_ROCKET_MASS_KG) + stage2DryMassKg,
          );
          runtime.stage2RefuelRecoveryApplied = true;
          emitLaunchEvent("terminal_stage_refuel_recovery_enabled", {
            restoredDryMassKg: stage2DryMassKg,
            missionId: runtime.mission.selectedId,
            missionPhase: runtime.mission.phase,
          });
        }
        runtime.stageIndex = 1;
        runtime.phase = "coast";
        runtime.autopilotMode = "navsys:orbital-refuel-await-target";
      }
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
          if (maybeFinalizePendingPadTankerLaunch(state, nowMs, {
            rocketState,
            orbital: orbitalNow,
          })) {
            fleetController.finalizeStep(state, dtSeconds, nowMs);
            return;
          }
          finalizeBoosterStep(state, dtSeconds, nowMs);
          fleetController.finalizeStep(state, dtSeconds, nowMs);
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
    const stagePropellantDepleted = Boolean(
      stage && runtime.stagePropellantKg <= stagePropellantThresholdKg,
    );
    const stageDepletedThisStep = stagePropellantDepleted
      && (
        appliedBurnKg > 1e-8
        || (Number(runtime.lastStep?.thrustN) || 0) > 1
      );
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
    } else if (stagePropellantDepleted && stageDepletedThisStep) {
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
          runtime.stagePropellantKg = surfaceLaunchStagePropellantCapacityKgForMissionStage(
            runtime.stageIndex,
            runtime.mission.selectedId,
          );
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
        const nextStage = stageAtIndex(runtime.stageIndex + 1);
        if (nextStage) {
          rocketState.massKg = Math.max(
            MIN_ROCKET_MASS_KG,
            rocketState.massKg - (Number(stage.dryMassKg) || 0),
          );
          runtime.stageIndex += 1;
          runtime.stagePropellantKg = stagePropellantCapacityKgForMissionStage(
            runtime.stageIndex,
            runtime.mission.selectedId,
          );
          runtime.coastRemainingSec = Math.max(0, Number(stage.coastAfterBurnSec) || 0);
          runtime.phase = runtime.coastRemainingSec > 0 ? "coast" : "powered";
          runtime.stageActuator = createActuatorState(
            normalize(subtract(rocketState.position, earthState.position), currentEarthAxes.pole),
          );
          runtime.stageMassModel = createMassModelState();
        } else {
          // Terminal stage dry-out: keep stage attached so on-orbit refuel can re-enable propulsion.
          runtime.stagePropellantKg = 0;
          const relPos = subtract(rocketState.position, earthState.position);
          const relVel = subtract(
            rocketState.velocity || { x: 0, y: 0, z: 0 },
            earthState.velocity || { x: 0, y: 0, z: 0 },
          );
          const muKm3S2 = gravitationalConstantKm3PerKgS2 * (Number(getEarthMassKg?.()) || 0);
          const orbital = orbitalStateFromRelative(muKm3S2, earthRadiusKm, relPos, relVel);
          const stableOrbit = orbital.specificEnergy < 0 && Number(orbital.periapsisKm) > 80;
          runtime.phase = "coast";
          runtime.autopilotMode = (
            isMoonTransferMissionActive(runtime) && runtime.mission.phase === "orbital_refuel"
          )
            ? "navsys:orbital-refuel-await-target"
            : (stableOrbit ? "autopilot-ballistic-hold" : "ballistic-coast");
          runtime.stageActuator = createActuatorState(normalize(relPos, currentEarthAxes.pole));
          runtime.stageMassModel = createMassModelState();
          emitLaunchEvent("terminal_stage_propellant_depleted", {
            missionId: runtime.mission.selectedId,
            missionPhase: runtime.mission.phase,
            orbitalApoapsisKm: Number(orbital?.apoapsisKm),
            orbitalPeriapsisKm: Number(orbital?.periapsisKm),
            stableOrbit,
          });
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

      refuelController.updateRefuelFlights(state, earthState, dtSeconds);

      const relPosNow = subtract(rocketState.position, earthState.position);
      const relVelNow = subtract(
        rocketState.velocity || { x: 0, y: 0, z: 0 },
        earthState.velocity || { x: 0, y: 0, z: 0 },
      );
      updateRuntimeTargetMetrics(state, relPosNow, relVelNow, nowMs);
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
      const muKm3S2Final = gravitationalConstantKm3PerKgS2 * (Number(getEarthMassKg?.()) || 0);
      const orbitalNow = orbitalStateFromRelative(muKm3S2Final, earthRadiusKm, relPosNow, relVelNow);
      if (maybeFinalizePendingPadTankerLaunch(state, nowMs, {
        rocketState,
        orbital: orbitalNow,
      })) {
        fleetController.finalizeStep(state, dtSeconds, nowMs);
        return;
      }
      finalizeBoosterStep(state, dtSeconds, nowMs);
      fleetController.finalizeStep(state, dtSeconds, nowMs);
    } finally {
      emitRuntimeTransitionEvents("finalize_step");
    }
  }

  function statusSnapshot(state = null) {
    const telemetry = runtime.lastTelemetry;
    const targetDescriptor = missionTargetDescriptor();
    const hotstageSinceIgnitionSec = hotstageTimeSinceIgnitionSec(runtime.hotstage, runtime.elapsedSeconds);
    const refuelStatus = refuelController.status();
    const tankerIndicators = refuelTankerIndicatorsFromState(state);
    const refuelTargetKg = refuelStatus.targetPropellantKg;
    const refuelRequiredFlights = refuelStatus.requiredFlights;
    const refuelCompletedFlights = refuelStatus.completedFlights;
    const refuelActiveFlights = refuelStatus.activeFlights;
    const refuelLaunchedFlights = refuelStatus.launchedFlights;
    const refuelFill = refuelStatus.fillFraction;
    const refuelCanLaunchTanker = refuelStatus.refuelCanLaunchTanker;
    const refuelTransferActive = Boolean(refuelStatus.transferActive);
    const refuelTransferTankerId = String(refuelStatus.transferTankerId || "");
    const refuelTransferProgress = clamp(Number(refuelStatus.transferProgress) || 0, 0, 1);
    const refuelTransferRemainingKg = Math.max(0, Number(refuelStatus.transferRemainingKg) || 0);
    const refuelTransferRateKgS = Math.max(0, Number(refuelStatus.transferRateKgS) || 0);
    const refuelTransferLocked = Boolean(refuelStatus.transferLocked);
    const refuelUndockActive = Boolean(refuelStatus.undockActive);
    const refuelShipRcsActive = Boolean(refuelStatus.shipRcsActive);
    const refuelShipRcsAuthority = clamp(Number(refuelStatus.shipRcsAuthority) || 0, 0, 1);
    const refuelShipRcsJets = Array.isArray(refuelStatus.shipRcsJets) ? refuelStatus.shipRcsJets : [];
    const refuelShipRcsMode = String(refuelStatus.shipRcsMode || "");
    const refuelDockShipAttitudeErrorDeg = Math.max(0, Number(refuelStatus.activeFlightShipAttitudeErrorDeg) || 0);
    const refuelDockTankerAttitudeErrorDeg = Math.max(0, Number(refuelStatus.activeFlightTankerAttitudeErrorDeg) || 0);
    const refuelDockHoldStableSec = Math.max(0, Number(refuelStatus.activeFlightDockHoldStableSec) || 0);
    const refuelDockAbortRemainingSec = Math.max(0, Number(refuelStatus.activeFlightDockAbortRemainingSec) || 0);
    const refuelOnlineTankers = Math.max(0, Number(tankerIndicators.onlineTankers) || 0);
    const refuelAvailableTankers = Math.max(
      0,
      Number(tankerIndicators.availableTankers) || Number(refuelStatus.activeFlights) || 0,
    );
    const refuelIndicatorState = refuelAvailableTankers > 0
      ? "available"
      : (refuelOnlineTankers > 0 ? "online" : "offline");
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
        stagePropellantKg: Math.max(0, Number(runtime.stagePropellantKg) || 0),
        refuelRequiredFlights,
        refuelCompletedFlights,
        refuelActiveFlights,
        refuelLaunchedFlights,
        refuelTargetPropellantKg: refuelTargetKg,
        refuelFillFraction: refuelFill,
        refuelCanLaunchTanker,
        refuelOnlineTankers,
        refuelAvailableTankers,
        refuelAtSlotTankers: refuelAvailableTankers,
        refuelIndicatorState,
        refuelLastAction: runtime.refuel.lastAction || "",
        refuelLastActionTimeSec: Number(runtime.refuel.lastActionTimeSec) || 0,
        refuelTransferActive,
        refuelTransferTankerId,
        refuelTransferProgress,
        refuelTransferRemainingKg,
        refuelTransferRateKgS,
        refuelTransferLocked,
        refuelUndockActive,
        refuelDockShipAttitudeErrorDeg,
        refuelDockTankerAttitudeErrorDeg,
        refuelDockHoldStableSec,
        refuelDockAbortRemainingSec,
        moonDistanceKm: runtime.moonDistanceKm,
        moonClosingSpeedKmS: runtime.moonClosingSpeedKmS,
        moonRelativeSpeedKmS: runtime.moonRelativeSpeedKmS,
        moonProjectedMissDistanceKm: runtime.moonProjectedMissDistanceKm,
        moonProjectedPeriluneAltitudeKm: runtime.moonProjectedPeriluneAltitudeKm,
        moonBPlaneErrorKm: runtime.moonBPlaneErrorKm,
        moonDepartureWindowScore: finiteOrNull(runtime.moonDepartureWindowScore),
        moonDepartureWindowWaitSec: finiteOrNull(runtime.moonDepartureWindowWaitSec),
        moonDepartureWindowPhaseErrorDeg: finiteOrNull(runtime.moonDepartureWindowPhaseErrorDeg),
        moonDepartureGeometryScore: finiteOrNull(runtime.moonDepartureGeometryScore),
        moonDepartureAlignNow: finiteOrNull(runtime.moonDepartureAlignNow),
        moonDepartureAlignProjected: finiteOrNull(runtime.moonDepartureAlignProjected),
        moonEstimatedTliDeltaVKmS: finiteOrNull(runtime.moonEstimatedTliDeltaVKmS),
        moonDepartureWindowReady: Boolean(runtime.moonDepartureWindowReady),
        moonDepartureWindowLaunchTimeMs: Number.isFinite(Number(runtime.moonDepartureWindowLaunchTimeMs))
          ? Number(runtime.moonDepartureWindowLaunchTimeMs)
          : null,
        missionPhaseGateReason: runtime.missionPhaseGateReason || "",
        targetBodyId: targetDescriptor.bodyId,
        targetBodyName: targetDescriptor.bodyName,
        targetDistanceKm: targetDescriptor.distanceKm,
        targetClosingSpeedKmS: targetDescriptor.closingSpeedKmS,
        rcsActive: refuelShipRcsActive,
        rcsErrorDeg: 0,
        rcsAuthority: refuelShipRcsActive ? refuelShipRcsAuthority : 0,
        rcsJets: refuelShipRcsActive ? refuelShipRcsJets : [],
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
    const telemetryGuidanceMode = refuelShipRcsMode
      ? `${telemetry.guidanceMode}:${refuelShipRcsMode}`
      : telemetry.guidanceMode;
    const telemetryRcsActive = Boolean(telemetry.rcsActive || refuelShipRcsActive);
    const telemetryRcsAuthority = clamp(
      Math.max(
        Number(telemetry.rcsAuthority) || 0,
        refuelShipRcsActive ? refuelShipRcsAuthority : 0,
      ),
      0,
      1,
    );
    const telemetryRcsJets = (
      refuelShipRcsActive && refuelShipRcsJets.length > 0
    )
      ? refuelShipRcsJets
      : (Array.isArray(telemetry.rcsJets) ? telemetry.rcsJets : []);
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
      guidanceMode: telemetryGuidanceMode,
      missionId: telemetry.missionId,
      missionName: telemetry.missionName,
      missionPhase: telemetry.missionPhase,
      missionCompleted: telemetry.missionCompleted,
      stagePropellantKg: Number(telemetry.stagePropellantKg) || 0,
      refuelRequiredFlights: Number(telemetry.refuelRequiredFlights) || refuelRequiredFlights,
      refuelCompletedFlights: Number(telemetry.refuelCompletedFlights) || refuelCompletedFlights,
      refuelActiveFlights: Number(telemetry.refuelActiveFlights) || refuelActiveFlights,
      refuelLaunchedFlights: Number(telemetry.refuelLaunchedFlights) || refuelLaunchedFlights,
      refuelTargetPropellantKg: Number(telemetry.refuelTargetPropellantKg) || refuelTargetKg,
      refuelFillFraction: Number.isFinite(Number(telemetry.refuelFillFraction))
        ? clamp(Number(telemetry.refuelFillFraction), 0, 1)
        : refuelFill,
      refuelCanLaunchTanker,
      refuelOnlineTankers,
      refuelAvailableTankers,
      refuelAtSlotTankers: refuelAvailableTankers,
      refuelIndicatorState,
      refuelLastAction: runtime.refuel.lastAction || "",
      refuelLastActionTimeSec: Number(runtime.refuel.lastActionTimeSec) || 0,
      refuelTransferActive,
      refuelTransferTankerId,
      refuelTransferProgress,
      refuelTransferRemainingKg,
      refuelTransferRateKgS,
      refuelTransferLocked,
      refuelUndockActive,
      refuelDockShipAttitudeErrorDeg,
      refuelDockTankerAttitudeErrorDeg,
      refuelDockHoldStableSec,
      refuelDockAbortRemainingSec,
      moonDistanceKm: runtime.moonDistanceKm,
      moonClosingSpeedKmS: runtime.moonClosingSpeedKmS,
      moonRelativeSpeedKmS: runtime.moonRelativeSpeedKmS,
      moonProjectedMissDistanceKm: runtime.moonProjectedMissDistanceKm,
      moonProjectedPeriluneAltitudeKm: runtime.moonProjectedPeriluneAltitudeKm,
      moonBPlaneErrorKm: runtime.moonBPlaneErrorKm,
      moonDepartureWindowScore: finiteOrNull(runtime.moonDepartureWindowScore),
      moonDepartureWindowWaitSec: finiteOrNull(runtime.moonDepartureWindowWaitSec),
      moonDepartureWindowPhaseErrorDeg: finiteOrNull(runtime.moonDepartureWindowPhaseErrorDeg),
      moonDepartureGeometryScore: finiteOrNull(runtime.moonDepartureGeometryScore),
      moonDepartureAlignNow: finiteOrNull(runtime.moonDepartureAlignNow),
      moonDepartureAlignProjected: finiteOrNull(runtime.moonDepartureAlignProjected),
      moonEstimatedTliDeltaVKmS: finiteOrNull(runtime.moonEstimatedTliDeltaVKmS),
      moonDepartureWindowReady: Boolean(runtime.moonDepartureWindowReady),
      moonDepartureWindowLaunchTimeMs: Number.isFinite(Number(runtime.moonDepartureWindowLaunchTimeMs))
        ? Number(runtime.moonDepartureWindowLaunchTimeMs)
        : null,
      missionPhaseGateReason: runtime.missionPhaseGateReason || "",
      targetBodyId: targetDescriptor.bodyId,
      targetBodyName: targetDescriptor.bodyName,
      targetDistanceKm: targetDescriptor.distanceKm,
      targetClosingSpeedKmS: targetDescriptor.closingSpeedKmS,
      autopilotMode: telemetry.autopilotMode,
      rcsActive: telemetryRcsActive,
      rcsErrorDeg: telemetry.rcsErrorDeg,
      rcsAuthority: telemetryRcsAuthority,
      rcsJets: telemetryRcsJets,
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

  function statusSnapshotForBody(state, bodyId = LAUNCH_BODY_ID, nowMs = Date.now()) {
    const baseSnapshot = statusSnapshot(state);
    const fleetSnapshot = fleetController.statusSnapshotForBody({
      state,
      bodyId,
      nowMs,
      baseSnapshot,
      phaseLabel,
    });
    if (fleetSnapshot) {
      return fleetSnapshot;
    }
    return buildVehicleStatusSnapshot({
      baseSnapshot,
      trackedBodyId: bodyId,
      state,
      nowMs,
      runtime,
      refuelStatus: refuelController.status(),
      getEarthRadiusKm,
      getEarthMassKg,
      gravitationalConstantKm3PerKgS2,
      sampleEarthAtmosphere,
      earthAxes,
      earthStateFromNBody,
      finiteVector,
      orbitalStateFromRelative,
      dynamicPressurePaFromAtmosphere,
      resolveMissionName: () => safeMissionProfile(runtime.mission.selectedId)?.name || "Mission",
      phaseLabel,
    });
  }

  function setMissionProfile(missionId) {
    const previousMissionId = runtime.mission.selectedId;
    const previousMissionPhase = runtime.mission.phase;
    const normalized = normalizeMissionId(missionId);
    runtime.mission.selectedId = normalized;
    runtime.targetOrbitAltitudeKm = missionTargetOrbitAltitudeKm(normalized);
    runtime.mission.completed = false;
    runtime.missionPhaseGateReason = "";
    runtime.moonProjectedPeriluneAltitudeKm = null;
    runtime.moonBPlaneErrorKm = null;
    setMissionPhase(runtime, defaultMissionPhaseForProfileId(normalized));
    refuelController.applyMissionProfile(normalized);
    primaryNavigationSystem.setMission(normalized, runtime.elapsedSeconds);
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

  function managedCatalogMetaForBody(bodyId, bodyState = null) {
    const id = String(bodyId || "").trim();
    if (!id || id === LAUNCH_BODY_ID || id === LAUNCH_BOOSTER_BODY_ID) {
      return null;
    }
    const vehicle = runtime.fleet?.vehicles instanceof Map
      ? runtime.fleet.vehicles.get(id)
      : null;
    const sequenceNumber = Number(id.match(/_(\d+)$/)?.[1]) || 1;
    const vehicleRole = String(vehicle?.vehicleRole || (id.startsWith("earth_refuel_tanker_") ? "tanker" : "mission")).toLowerCase();
    const massKg = Math.max(
      MIN_ROCKET_MASS_KG,
      finiteNumber(bodyState?.massKg, vehicle?.dryMassKg),
    );
    if (vehicleRole === "tanker" || id.startsWith("earth_refuel_tanker_")) {
      return tankerMetaForId(
        id,
        sequenceNumber,
        massKg,
        LAUNCH_REFUEL_TANKER_METAS[0] || null,
      );
    }
    const missionId = normalizeMissionId(vehicle?.missionId || runtime.mission.selectedId);
    const missionName = safeMissionProfile(missionId)?.name || "Mission";
    const vehicleName = String(vehicle?.vehicleName || `Starship ${sequenceNumber}`).trim() || `Starship ${sequenceNumber}`;
    return {
      id,
      name: `${vehicleName} (${missionName})`,
      body_type: "spacecraft",
      parent: "earth",
      radius_km: STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 0.5,
      mass_kg: massKg,
      semimajor_axis_km: null,
      orbital_period_days: null,
      phase: 0,
      description: `Pad-launched autonomous Starship assigned to ${missionName}.`,
    };
  }

  function serializeRuntimeForPersistence() {
    const fleetVehicles = [];
    if (runtime.fleet?.vehicles instanceof Map) {
      for (const [id, vehicle] of runtime.fleet.vehicles.entries()) {
        const normalizedId = String(id || vehicle?.id || "").trim();
        if (!normalizedId) {
          continue;
        }
        const snapshot = cloneJson(vehicle, {});
        snapshot.id = normalizedId;
        fleetVehicles.push(snapshot);
      }
    }
    return {
      phase: String(runtime.phase || "idle"),
      elapsedSeconds: Math.max(0, finiteNumber(runtime.elapsedSeconds, 0)),
      stageIndex: Math.max(0, Math.floor(finiteNumber(runtime.stageIndex, 0))),
      stagePropellantKg: Math.max(0, finiteNumber(runtime.stagePropellantKg, 0)),
      coastRemainingSec: Math.max(0, finiteNumber(runtime.coastRemainingSec, 0)),
      lastStep: cloneJson(runtime.lastStep),
      lastTelemetry: cloneJson(runtime.lastTelemetry),
      lastError: String(runtime.lastError || ""),
      autopilotEnabled: Boolean(runtime.autopilotEnabled),
      autopilotMode: String(runtime.autopilotMode || "idle"),
      targetOrbitAltitudeKm: finiteNumber(runtime.targetOrbitAltitudeKm, 250),
      launchPlaneNormal: cloneVectorOrNull(runtime.launchPlaneNormal),
      boosterDistanceKm: Math.max(0, finiteNumber(runtime.boosterDistanceKm, 0)),
      starshipDistanceKm: Math.max(0, finiteNumber(runtime.starshipDistanceKm, 0)),
      earthDistanceKm: finiteOrNull(runtime.earthDistanceKm),
      earthClosingSpeedKmS: finiteOrNull(runtime.earthClosingSpeedKmS),
      moonDistanceKm: finiteOrNull(runtime.moonDistanceKm),
      moonClosingSpeedKmS: finiteOrNull(runtime.moonClosingSpeedKmS),
      moonRelativeSpeedKmS: finiteOrNull(runtime.moonRelativeSpeedKmS),
      moonProjectedMissDistanceKm: finiteOrNull(runtime.moonProjectedMissDistanceKm),
      moonProjectedPeriluneAltitudeKm: finiteOrNull(runtime.moonProjectedPeriluneAltitudeKm),
      moonBPlaneErrorKm: finiteOrNull(runtime.moonBPlaneErrorKm),
      moonDepartureWindowScore: finiteOrNull(runtime.moonDepartureWindowScore),
      moonDepartureWindowWaitSec: finiteOrNull(runtime.moonDepartureWindowWaitSec),
      moonDepartureWindowPhaseErrorDeg: finiteOrNull(runtime.moonDepartureWindowPhaseErrorDeg),
      moonDepartureGeometryScore: finiteOrNull(runtime.moonDepartureGeometryScore),
      moonDepartureAlignNow: finiteOrNull(runtime.moonDepartureAlignNow),
      moonDepartureAlignProjected: finiteOrNull(runtime.moonDepartureAlignProjected),
      moonEstimatedTliDeltaVKmS: finiteOrNull(runtime.moonEstimatedTliDeltaVKmS),
      moonDepartureWindowReady: Boolean(runtime.moonDepartureWindowReady),
      moonDepartureWindowLaunchTimeMs: Number.isFinite(Number(runtime.moonDepartureWindowLaunchTimeMs))
        ? Number(runtime.moonDepartureWindowLaunchTimeMs)
        : null,
      moonBurnAttitudeGateActive: Boolean(runtime.moonBurnAttitudeGateActive),
      moonBurnAttitudeGateDirection: cloneVectorOrNull(runtime.moonBurnAttitudeGateDirection),
      moonBurnAttitudeGateAlignSec: Math.max(0, finiteNumber(runtime.moonBurnAttitudeGateAlignSec, 0)),
      missionPhaseGateReason: String(runtime.missionPhaseGateReason || ""),
      lastTrackedPositionKm: cloneVectorOrNull(runtime.lastTrackedPositionKm),
      lastSurfaceSample: cloneJson(runtime.lastSurfaceSample),
      windSeed: Math.max(0, Math.floor(finiteNumber(runtime.windSeed, Date.now() % 1_000_000))),
      stageActuator: cloneJson(runtime.stageActuator, createActuatorState({ x: 0, y: 0, z: 1 })),
      stageMassModel: cloneJson(runtime.stageMassModel, createMassModelState()),
      boosterActuator: cloneJson(runtime.boosterActuator, createActuatorState({ x: 0, y: 0, z: 1 })),
      boosterMassModel: cloneJson(runtime.boosterMassModel, createMassModelState()),
      stage2RefuelRecoveryApplied: Boolean(runtime.stage2RefuelRecoveryApplied),
      mission: {
        selectedId: normalizeMissionId(runtime.mission.selectedId),
        phase: String(runtime.mission.phase || ""),
        phaseStartedElapsedSec: Math.max(0, finiteNumber(runtime.mission.phaseStartedElapsedSec, 0)),
        completed: Boolean(runtime.mission.completed),
      },
      booster: {
        active: Boolean(runtime.booster.active),
        phase: String(runtime.booster.phase || "idle"),
        guidanceMode: String(runtime.booster.guidanceMode || "booster-idle"),
        propellantKg: Math.max(0, finiteNumber(runtime.booster.propellantKg, 0)),
        initialPropellantKg: Math.max(0, finiteNumber(runtime.booster.initialPropellantKg, 0)),
        separationTimeSec: Math.max(0, finiteNumber(runtime.booster.separationTimeSec, 0)),
        landed: Boolean(runtime.booster.landed),
        lastStep: cloneJson(runtime.booster.lastStep),
        lastSurfaceSample: cloneJson(runtime.booster.lastSurfaceSample),
        lastTrackedPositionKm: cloneVectorOrNull(runtime.booster.lastTrackedPositionKm),
        telemetry: cloneJson(runtime.booster.telemetry),
        contactHoldSec: Math.max(0, finiteNumber(runtime.booster.contactHoldSec, 0)),
      },
      refuel: cloneJson(
        runtime.refuel,
        refuelDefaults({
          targetPropellantKg: stage2PropellantCapacityKg(runtime.mission.selectedId),
        }),
      ),
      fleet: {
        nextShipSequence: Math.max(1, Math.floor(finiteNumber(runtime.fleet?.nextShipSequence, 1))),
        vehicles: fleetVehicles,
      },
      hotstage: cloneJson(runtime.hotstage, createHotstageState()),
      pendingPadTankerLaunch: cloneJson(runtime.pendingPadTankerLaunch),
    };
  }

  function applyActuatorSnapshot(currentState, snapshot, fallbackDirection = { x: 0, y: 0, z: 1 }) {
    const base = createActuatorState(fallbackDirection);
    const merged = {
      ...base,
      ...(currentState && typeof currentState === "object" ? currentState : {}),
      ...(snapshot && typeof snapshot === "object" ? snapshot : {}),
    };
    merged.throttleCommand = clamp(finiteNumber(merged.throttleCommand, 0), 0, 1);
    merged.throttleActual = clamp(finiteNumber(merged.throttleActual, 0), 0, 1);
    merged.directionCommand = normalize(merged.directionCommand || fallbackDirection, fallbackDirection);
    merged.directionActual = normalize(merged.directionActual || merged.directionCommand, merged.directionCommand);
    merged.gimbalErrorDeg = Math.max(0, finiteNumber(merged.gimbalErrorDeg, 0));
    return merged;
  }

  function applyMassModelSnapshot(currentState, snapshot) {
    const base = createMassModelState();
    const merged = {
      ...base,
      ...(currentState && typeof currentState === "object" ? currentState : {}),
      ...(snapshot && typeof snapshot === "object" ? snapshot : {}),
    };
    merged.comNormalized = clamp(finiteNumber(merged.comNormalized, 0.5), 0, 1);
    merged.inertiaNormalized = clamp(finiteNumber(merged.inertiaNormalized, 1), 0.1, 10);
    merged.controlAuthorityScale = clamp(finiteNumber(merged.controlAuthorityScale, 1), 0.1, 5);
    return merged;
  }

  function applyRuntimeSnapshot(snapshot = null) {
    if (!snapshot || typeof snapshot !== "object") {
      return false;
    }
    runtime.phase = String(snapshot.phase || runtime.phase || "idle");
    runtime.elapsedSeconds = Math.max(0, finiteNumber(snapshot.elapsedSeconds, runtime.elapsedSeconds));
    runtime.stageIndex = Math.max(0, Math.floor(finiteNumber(snapshot.stageIndex, runtime.stageIndex)));
    runtime.stagePropellantKg = Math.max(0, finiteNumber(snapshot.stagePropellantKg, runtime.stagePropellantKg));
    runtime.coastRemainingSec = Math.max(0, finiteNumber(snapshot.coastRemainingSec, runtime.coastRemainingSec));
    runtime.lastStep = cloneJson(snapshot.lastStep);
    runtime.lastTelemetry = cloneJson(snapshot.lastTelemetry);
    runtime.lastError = String(snapshot.lastError || "");
    runtime.autopilotEnabled = Boolean(snapshot.autopilotEnabled);
    runtime.autopilotMode = String(snapshot.autopilotMode || runtime.autopilotMode || "idle");
    runtime.targetOrbitAltitudeKm = Math.max(
      100,
      finiteNumber(snapshot.targetOrbitAltitudeKm, runtime.targetOrbitAltitudeKm),
    );
    runtime.launchPlaneNormal = cloneVectorOrNull(snapshot.launchPlaneNormal);
    runtime.boosterDistanceKm = Math.max(0, finiteNumber(snapshot.boosterDistanceKm, runtime.boosterDistanceKm));
    runtime.starshipDistanceKm = Math.max(0, finiteNumber(snapshot.starshipDistanceKm, runtime.starshipDistanceKm));
    runtime.earthDistanceKm = finiteOrNull(snapshot.earthDistanceKm);
    runtime.earthClosingSpeedKmS = finiteOrNull(snapshot.earthClosingSpeedKmS);
    runtime.moonDistanceKm = finiteOrNull(snapshot.moonDistanceKm);
    runtime.moonClosingSpeedKmS = finiteOrNull(snapshot.moonClosingSpeedKmS);
    runtime.moonRelativeSpeedKmS = finiteOrNull(snapshot.moonRelativeSpeedKmS);
    runtime.moonProjectedMissDistanceKm = finiteOrNull(snapshot.moonProjectedMissDistanceKm);
    runtime.moonProjectedPeriluneAltitudeKm = finiteOrNull(snapshot.moonProjectedPeriluneAltitudeKm);
    runtime.moonBPlaneErrorKm = finiteOrNull(snapshot.moonBPlaneErrorKm);
    runtime.moonDepartureWindowScore = finiteOrNull(snapshot.moonDepartureWindowScore);
    runtime.moonDepartureWindowWaitSec = finiteOrNull(snapshot.moonDepartureWindowWaitSec);
    runtime.moonDepartureWindowPhaseErrorDeg = finiteOrNull(snapshot.moonDepartureWindowPhaseErrorDeg);
    runtime.moonDepartureGeometryScore = finiteOrNull(snapshot.moonDepartureGeometryScore);
    runtime.moonDepartureAlignNow = finiteOrNull(snapshot.moonDepartureAlignNow);
    runtime.moonDepartureAlignProjected = finiteOrNull(snapshot.moonDepartureAlignProjected);
    runtime.moonEstimatedTliDeltaVKmS = finiteOrNull(snapshot.moonEstimatedTliDeltaVKmS);
    runtime.moonDepartureWindowReady = Boolean(snapshot.moonDepartureWindowReady);
    runtime.moonDepartureWindowLaunchTimeMs = Number.isFinite(Number(snapshot.moonDepartureWindowLaunchTimeMs))
      ? Number(snapshot.moonDepartureWindowLaunchTimeMs)
      : null;
    runtime.moonBurnAttitudeGateActive = Boolean(snapshot.moonBurnAttitudeGateActive);
    runtime.moonBurnAttitudeGateDirection = cloneVectorOrNull(snapshot.moonBurnAttitudeGateDirection);
    runtime.moonBurnAttitudeGateAlignSec = Math.max(0, finiteNumber(snapshot.moonBurnAttitudeGateAlignSec, 0));
    runtime.missionPhaseGateReason = String(snapshot.missionPhaseGateReason || "");
    runtime.lastTrackedPositionKm = cloneVectorOrNull(snapshot.lastTrackedPositionKm);
    runtime.lastSurfaceSample = cloneJson(snapshot.lastSurfaceSample);
    runtime.windSeed = Math.max(0, Math.floor(finiteNumber(snapshot.windSeed, runtime.windSeed)));
    runtime.stageActuator = applyActuatorSnapshot(
      runtime.stageActuator,
      snapshot.stageActuator,
      { x: 0, y: 0, z: 1 },
    );
    runtime.stageMassModel = applyMassModelSnapshot(runtime.stageMassModel, snapshot.stageMassModel);
    runtime.boosterActuator = applyActuatorSnapshot(
      runtime.boosterActuator,
      snapshot.boosterActuator,
      { x: 0, y: 0, z: 1 },
    );
    runtime.boosterMassModel = applyMassModelSnapshot(runtime.boosterMassModel, snapshot.boosterMassModel);
    runtime.stage2RefuelRecoveryApplied = Boolean(snapshot.stage2RefuelRecoveryApplied);

    const missionSnapshot = snapshot.mission && typeof snapshot.mission === "object"
      ? snapshot.mission
      : {};
    const missionId = normalizeMissionId(missionSnapshot.selectedId || runtime.mission.selectedId);
    runtime.mission.selectedId = missionId;
    runtime.mission.phase = String(
      missionSnapshot.phase || defaultMissionPhaseForProfileId(missionId),
    );
    runtime.mission.phaseStartedElapsedSec = Math.max(
      0,
      finiteNumber(missionSnapshot.phaseStartedElapsedSec, runtime.mission.phaseStartedElapsedSec),
    );
    runtime.mission.completed = Boolean(missionSnapshot.completed);

    const boosterSnapshot = snapshot.booster && typeof snapshot.booster === "object"
      ? snapshot.booster
      : {};
    runtime.booster.active = Boolean(boosterSnapshot.active);
    runtime.booster.phase = String(boosterSnapshot.phase || runtime.booster.phase || "idle");
    runtime.booster.guidanceMode = String(
      boosterSnapshot.guidanceMode || runtime.booster.guidanceMode || "booster-idle",
    );
    runtime.booster.propellantKg = Math.max(
      0,
      finiteNumber(boosterSnapshot.propellantKg, runtime.booster.propellantKg),
    );
    runtime.booster.initialPropellantKg = Math.max(
      0,
      finiteNumber(boosterSnapshot.initialPropellantKg, runtime.booster.initialPropellantKg),
    );
    runtime.booster.separationTimeSec = Math.max(
      0,
      finiteNumber(boosterSnapshot.separationTimeSec, runtime.booster.separationTimeSec),
    );
    runtime.booster.landed = Boolean(boosterSnapshot.landed);
    runtime.booster.lastStep = cloneJson(boosterSnapshot.lastStep);
    runtime.booster.lastSurfaceSample = cloneJson(boosterSnapshot.lastSurfaceSample);
    runtime.booster.lastTrackedPositionKm = cloneVectorOrNull(boosterSnapshot.lastTrackedPositionKm);
    runtime.booster.telemetry = cloneJson(boosterSnapshot.telemetry);
    runtime.booster.contactHoldSec = Math.max(
      0,
      finiteNumber(boosterSnapshot.contactHoldSec, runtime.booster.contactHoldSec),
    );

    const refuelDefaultsSnapshot = refuelDefaults({
      targetPropellantKg: stage2PropellantCapacityKg(runtime.mission.selectedId),
    });
    const incomingRefuel = snapshot.refuel && typeof snapshot.refuel === "object"
      ? cloneJson(snapshot.refuel, {})
      : {};
    runtime.refuel = {
      ...refuelDefaultsSnapshot,
      ...incomingRefuel,
    };
    runtime.refuel.flights = Array.isArray(incomingRefuel.flights)
      ? incomingRefuel.flights
        .map((flight) => ({
          ...flight,
          id: String(flight?.id || "").trim(),
          rcsJets: Array.isArray(flight?.rcsJets) ? [...flight.rcsJets] : [],
          shipRcsJets: Array.isArray(flight?.shipRcsJets) ? [...flight.shipRcsJets] : [],
        }))
        .filter((flight) => Boolean(flight.id))
      : [];
    runtime.refuel.consumedTankerIds = Array.from(
      new Set(
        (Array.isArray(incomingRefuel.consumedTankerIds) ? incomingRefuel.consumedTankerIds : [])
          .map((id) => String(id || "").trim())
          .filter(Boolean),
      ),
    );
    runtime.refuel.nextGeneratedId = Math.max(
      1,
      Math.floor(finiteNumber(runtime.refuel.nextGeneratedId, 1)),
    );
    runtime.refuel.nextSlot = Math.max(
      0,
      Math.floor(finiteNumber(runtime.refuel.nextSlot, 0)),
    );
    runtime.refuel.requiredFlights = Math.max(0, finiteNumber(runtime.refuel.requiredFlights, 0));
    runtime.refuel.completedFlights = Math.max(0, finiteNumber(runtime.refuel.completedFlights, 0));
    runtime.refuel.launchedFlights = Math.max(0, finiteNumber(runtime.refuel.launchedFlights, 0));
    refuelController.recalcRefuelFlightCounts?.();

    const fleetSnapshot = snapshot.fleet && typeof snapshot.fleet === "object"
      ? snapshot.fleet
      : {};
    runtime.fleet = runtime.fleet && typeof runtime.fleet === "object"
      ? runtime.fleet
      : { nextShipSequence: 1, vehicles: new Map() };
    runtime.fleet.nextShipSequence = Math.max(
      1,
      Math.floor(finiteNumber(fleetSnapshot.nextShipSequence, runtime.fleet.nextShipSequence)),
    );
    const fleetVehicles = Array.isArray(fleetSnapshot.vehicles)
      ? fleetSnapshot.vehicles
      : [];
    runtime.fleet.vehicles = new Map();
    for (let i = 0; i < fleetVehicles.length; i += 1) {
      const vehicle = cloneJson(fleetVehicles[i], {});
      const id = String(vehicle?.id || "").trim();
      if (!id || !isManagedLaunchBodyId(id)) {
        continue;
      }
      vehicle.id = id;
      vehicle.stageProfiles = Array.isArray(vehicle.stageProfiles) ? vehicle.stageProfiles : [];
      runtime.fleet.vehicles.set(id, vehicle);
    }

    runtime.hotstage = {
      ...createHotstageState(),
      ...(cloneJson(snapshot.hotstage, {}) || {}),
    };
    runtime.hotstage.active = Boolean(runtime.hotstage.active);
    runtime.hotstage.ignitionTimeSec = runtime.hotstage.active
      ? finiteOrNull(runtime.hotstage.ignitionTimeSec)
      : null;
    runtime.hotstage.overlapSeconds = Math.max(
      0,
      finiteNumber(runtime.hotstage.overlapSeconds, hotstageOverlapSeconds()),
    );
    runtime.hotstage.boosterReservePropellantKg = Math.max(
      0,
      finiteNumber(runtime.hotstage.boosterReservePropellantKg, 0),
    );
    runtime.hotstage.ignitionStableSec = Math.max(0, finiteNumber(runtime.hotstage.ignitionStableSec, 0));
    runtime.hotstage.virtualSeparationKm = Math.max(0, finiteNumber(runtime.hotstage.virtualSeparationKm, 0));
    runtime.hotstage.detachReason = String(runtime.hotstage.detachReason || "");

    runtime.pendingPadTankerLaunch = snapshot.pendingPadTankerLaunch
      && typeof snapshot.pendingPadTankerLaunch === "object"
      ? cloneJson(snapshot.pendingPadTankerLaunch, null)
      : null;
    if (runtime.pendingPadTankerLaunch && runtime.pendingPadTankerLaunch.tankerId) {
      runtime.pendingPadTankerLaunch.tankerId = String(runtime.pendingPadTankerLaunch.tankerId);
    }
    lastRuntimeLogState = captureRuntimeLogState();
    return true;
  }

  function exportPersistentSnapshot(state, nowMs = Date.now()) {
    if (!state?.dynamicBodies || typeof state.dynamicBodies.entries !== "function") {
      return null;
    }
    const earthState = earthStateFromNBody(state);
    const earthVectorReady = Boolean(
      earthState
      && finiteVector(earthState.position)
      && finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 }),
    );
    const managedBodies = [];
    const catalogBodies = [];
    for (const [bodyId, bodyState] of state.dynamicBodies.entries()) {
      const id = String(bodyId || "");
      if (!isManagedLaunchBodyId(id)) {
        continue;
      }
      if (
        !finiteVector(bodyState?.position)
        || !finiteVector(bodyState?.velocity || { x: 0, y: 0, z: 0 })
      ) {
        continue;
      }
      const absolutePosition = cloneVector(bodyState.position);
      const absoluteVelocity = cloneVector(bodyState.velocity || { x: 0, y: 0, z: 0 });
      const relativeToEarth = earthVectorReady
        ? {
          position: cloneVector(subtract(absolutePosition, earthState.position)),
          velocity: cloneVector(
            subtract(
              absoluteVelocity,
              earthState.velocity || { x: 0, y: 0, z: 0 },
            ),
          ),
        }
        : null;
      managedBodies.push({
        id,
        massKg: Math.max(MIN_ROCKET_MASS_KG, finiteNumber(bodyState.massKg, MIN_ROCKET_MASS_KG)),
        position: absolutePosition,
        velocity: absoluteVelocity,
        relativeToEarth,
      });
      const meta = managedCatalogMetaForBody(id, bodyState);
      if (meta) {
        catalogBodies.push(meta);
      }
    }
    if (managedBodies.length <= 0) {
      return null;
    }
    return {
      version: 1,
      savedAtMs: Math.max(0, finiteNumber(nowMs, Date.now())),
      runtime: serializeRuntimeForPersistence(),
      navigation: primaryNavigationSystem.snapshot?.() || null,
      managedBodies,
      catalogBodies,
    };
  }

  function importPersistentSnapshot(state, snapshot, nowMs = Date.now()) {
    if (!state?.dynamicBodies || typeof state.dynamicBodies.set !== "function") {
      return { applied: false, reason: "state_unavailable" };
    }
    const payload = snapshot && typeof snapshot === "object" ? snapshot : null;
    if (!payload) {
      return { applied: false, reason: "snapshot_unavailable" };
    }
    const runtimeRestored = applyRuntimeSnapshot(payload.runtime || null);
    if (!runtimeRestored) {
      return { applied: false, reason: "runtime_snapshot_unavailable" };
    }

    const earthState = earthStateFromNBody(state);
    const earthVectorReady = Boolean(
      earthState
      && finiteVector(earthState.position)
      && finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 }),
    );

    for (const bodyId of Array.from(state.dynamicBodies.keys())) {
      if (isManagedLaunchBodyId(bodyId)) {
        state.dynamicBodies.delete(bodyId);
      }
    }

    const restoredBodyIds = [];
    const managedBodies = Array.isArray(payload.managedBodies) ? payload.managedBodies : [];
    for (let i = 0; i < managedBodies.length; i += 1) {
      const body = managedBodies[i];
      const id = String(body?.id || "").trim();
      if (!id || !isManagedLaunchBodyId(id)) {
        continue;
      }
      let position = null;
      let velocity = null;
      if (
        earthVectorReady
        && finiteVector(body?.relativeToEarth?.position)
        && finiteVector(body?.relativeToEarth?.velocity)
      ) {
        position = add(earthState.position, cloneVector(body.relativeToEarth.position));
        velocity = add(
          earthState.velocity || { x: 0, y: 0, z: 0 },
          cloneVector(body.relativeToEarth.velocity),
        );
      } else if (
        finiteVector(body?.position)
        && finiteVector(body?.velocity)
      ) {
        position = cloneVector(body.position);
        velocity = cloneVector(body.velocity);
      }
      if (!position || !velocity) {
        continue;
      }
      state.dynamicBodies.set(id, {
        id,
        massKg: Math.max(MIN_ROCKET_MASS_KG, finiteNumber(body?.massKg, MIN_ROCKET_MASS_KG)),
        position,
        velocity,
      });
      restoredBodyIds.push(id);
    }

    if (!state.dynamicBodies.has(LAUNCH_BODY_ID)) {
      ensureRocketInNBody(state, nowMs);
      if (state.dynamicBodies.has(LAUNCH_BODY_ID)) {
        restoredBodyIds.push(LAUNCH_BODY_ID);
      }
    }
    if (!state.dynamicBodies.has(LAUNCH_BOOSTER_BODY_ID)) {
      clearBoosterFromState(state);
    }

    if (typeof primaryNavigationSystem.restore === "function") {
      primaryNavigationSystem.restore(payload.navigation || null, {
        missionIdFallback: runtime.mission.selectedId,
        modeFallback: NAVIGATION_SYSTEM_MODES.RULE_BASED_BASELINE,
        timestampSec: runtime.elapsedSeconds,
      });
    } else {
      primaryNavigationSystem.reset({
        missionIdOverride: runtime.mission.selectedId,
        modeOverride: NAVIGATION_SYSTEM_MODES.RULE_BASED_BASELINE,
        timestampSec: runtime.elapsedSeconds,
      });
    }

    lastRuntimeLogState = captureRuntimeLogState();
    emitLaunchEvent("launch_state_restored", {
      restoredBodyCount: restoredBodyIds.length,
      missionId: runtime.mission.selectedId,
      missionPhase: runtime.mission.phase,
      phase: runtime.phase,
      savedAtMs: finiteOrNull(payload.savedAtMs),
    });
    return {
      applied: true,
      restoredBodyIds,
      catalogBodies: Array.isArray(payload.catalogBodies) ? payload.catalogBodies : [],
      savedAtMs: finiteOrNull(payload.savedAtMs),
    };
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
    launchMissionShip,
    removeVehicleById,
    launchRefuelTanker,
    prepareStep,
    externalAccelerationKmS2,
    finalizeStep,
    statusSnapshot,
    statusSnapshotForBody,
    exportPersistentSnapshot,
    importPersistentSnapshot,
    setMissionProfile,
    getMissionProfile,
    getMissionProfiles,
    isActive() {
      return runtime.phase !== "idle"
        || runtime.booster.active
        || fleetController.hasActiveVehicles();
    },
  };
}
