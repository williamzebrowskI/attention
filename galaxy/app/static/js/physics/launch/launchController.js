import {
  LAUNCH_PAD_CONTACT_HEIGHT_ABOVE_TERRAIN_KM,
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
  resolveConfiguredThrustBoundsN,
} from "./launchConfig.js";
import { computeBoosterRecoveryCommand } from "./boosterRecovery.js?v=20260420am";
import { shouldFinalizeBoosterCatch } from "./boosterCatchGuidance.js";
import {
  computeBoosterCatchPinHeightErrorKm,
  computeBoosterCatchRelativeState,
  computeLaunchSiteCatchFrame,
} from "./launchSiteCatchGeometry.js";
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
  surfacePointRelativeKmAtLatLon,
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
  multiplyQuaternions,
  normalize,
  normalizeQuaternion,
  rad,
  quaternionFromUnitVectors,
  quaternionIdentity,
  rotateVectorByQuaternion,
  scale,
  subtract,
  unitOrNull,
} from "./launchMath.js";
import {
  augmentAttitudeCommand as augmentAttitudeCommandModel,
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
import { MOON_PARKING_ORBIT_GATE_TOLERANCE_KM } from "../navigation_system/lunar/moonParkingOrbitGate.js";
import {
  applyQAlphaSteeringLimit,
  atmosphereRelativeVelocityKmS,
  computeAerodynamicResponse,
  computeGridFinControlState,
  dynamicPressurePaFromAtmosphere,
  limitThrottleByQAlpha,
  sampleWindVectorKmS,
} from "./launchAeroModel.js";
import {
  createBoosterNavigationState,
  resetBoosterNavigationState,
  updateBoosterNavigationState,
} from "./boosterNavigation.js";
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
import { createLaunchFleetController } from "./launchFleetController.js?v=20260418a";
import {
  createNavigationSystem,
  DEFAULT_MOON_MISSION_PROFILE,
  NAVIGATION_DEFAULTS,
  NAVIGATION_SYSTEM_MODES,
} from "../navigation_system/index.js";
import {
  displayMissionPhase,
  NAVIGATION_MISSION_PHASES,
  normalizeMissionPhase,
} from "../navigation_system/navigationMissionProfiles.js";
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
  MOON_ORBIT_INJECT_ALTITUDE_KM,
  MOON_ORBIT_INJECT_BROWSER_LAUNCH_NODE_SAMPLES,
  MOON_ORBIT_INJECT_BROWSER_LAUNCH_SEARCH_PROFILE,
  MOON_ORBIT_INJECT_LAUNCH_NODE_SAMPLES,
  MOON_ORBIT_INJECT_LAUNCH_SEARCH_PROFILE,
  MOON_PARKING_ORBIT_APOAPSIS_KM,
} from "./lunar/constants.js";
import { evaluateMoonBurnAttitudeGate } from "./lunar/moonBurnAttitudeGate.js";
import {
  resolveMoonCoastTrimBurn,
  resolveMoonMissionAttitudeDirection,
} from "./lunar/moonAttitudePolicy.js?v=20260418a";
import {
  canUseMoonDepartureSolveWorker,
  requestMoonDepartureSolvePromise,
  requestMoonDepartureSolvePromiseFresh,
} from "../navigation_system/lunar/moonDepartureSolveWorkerClient.js";
import { solveMoonOrbitInjectWindowForLaunch } from "../navigation_system/lunar/departureWindowSolver.js";

const MOON_ORBIT_INJECT_WORKER_TIMEOUT_MS = 60000;

const MIN_ROCKET_MASS_KG = 500;
const PRIMARY_ORBITAL_REFUEL_DEMO_STAGE2_MIN_PROPELLANT_KG = 2_400_000;
const PRIMARY_MOON_MISSION_STAGE2_MIN_PROPELLANT_KG = 5_000_000;
const PAD_TANKER_DEPLOYMENT_MIN_PERIAPSIS_KM = 145;
const PAD_TANKER_DEPLOYMENT_MIN_APOAPSIS_KM = 150;
const PAD_TANKER_DEPLOYMENT_MAX_PERIAPSIS_KM = 165;
const PAD_TANKER_DEPLOYMENT_MAX_APOAPSIS_KM = 165;
const PRIMARY_QALPHA_ACTIVE_MAX_ALTITUDE_KM = 105;
const PRIMARY_QALPHA_ACTIVE_MIN_DYNAMIC_PRESSURE_PA = 120;
const ATTACHED_STACK_JOINT_NATURAL_FREQUENCY_RAD_S = 4.2;
const ATTACHED_STACK_JOINT_DAMPING_RATIO = 1.18;
const ATTACHED_STACK_JOINT_MAX_CORRECTION_KM_S2 = 0.085;
const ATTACHED_STACK_JOINT_MAX_LOAD_N = 2.4e8;
const MISSION_PHASE_ADVISORY_HOLD_SEC = 0.35;

function canonicalMoonMissionPhase(phase) {
  return normalizeMissionPhase(phase, LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN);
}

function displayMissionPhaseForMission(missionId, phase) {
  const id = normalizeMissionId(missionId);
  return id === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
    ? displayMissionPhase(phase, id)
    : String(phase || "").trim();
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

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const fallbackNumeric = Number(fallback);
  return Number.isFinite(fallbackNumeric) ? fallbackNumeric : 0;
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

function computeHotstageDisplayedGapKm(hotstage, elapsedSeconds = 0) {
  if (!hotstage?.active) {
    return 0;
  }
  const overlapSec = Math.max(0.001, Number(hotstage?.overlapSeconds) || hotstageOverlapSeconds());
  const timeSinceIgnitionSec = hotstageTimeSinceIgnitionSec(hotstage, elapsedSeconds);
  const ramp = clamp(
    Number.isFinite(timeSinceIgnitionSec) ? (timeSinceIgnitionSec / overlapSec) : 0,
    0,
    1,
  );
  const baseGapKm = separationGapKm() * ramp;
  const virtualGapKm = clamp(Number(hotstage?.virtualSeparationKm) || 0, 0, 0.004);
  return clamp(baseGapKm + virtualGapKm, 0, separationGapKm() + 0.004);
}

function computeHotstageRelativeOffsetsKm({
  hotstage = null,
  elapsedSeconds = 0,
  shipMassKg = 0,
  boosterMassKg = 0,
} = {}) {
  const displayedGapKm = computeHotstageDisplayedGapKm(hotstage, elapsedSeconds);
  if (!(displayedGapKm > 0)) {
    return {
      displayedGapKm: 0,
      shipOffsetKm: 0,
      boosterOffsetKm: 0,
    };
  }
  const safeShipMassKg = Math.max(1, Number(shipMassKg) || 0);
  const safeBoosterMassKg = Math.max(1, Number(boosterMassKg) || 0);
  const totalMassKg = safeShipMassKg + safeBoosterMassKg;
  return {
    displayedGapKm,
    shipOffsetKm: displayedGapKm * (safeBoosterMassKg / totalMassKg),
    boosterOffsetKm: displayedGapKm * (safeShipMassKg / totalMassKg),
  };
}

function createAttachedStackJointState() {
  return {
    active: false,
    targetOffsetWorldKm: null,
    targetPositionKm: null,
    targetVelocityKmS: null,
    positionErrorKm: { x: 0, y: 0, z: 0 },
    relativeVelocityKmS: { x: 0, y: 0, z: 0 },
    shipBaseAccelerationKmS2: { x: 0, y: 0, z: 0 },
    boosterBaseAccelerationKmS2: { x: 0, y: 0, z: 0 },
    shipJointAccelerationKmS2: { x: 0, y: 0, z: 0 },
    boosterJointAccelerationKmS2: { x: 0, y: 0, z: 0 },
    shipAccelerationKmS2: { x: 0, y: 0, z: 0 },
    boosterAccelerationKmS2: { x: 0, y: 0, z: 0 },
    reactionForceN: 0,
    shipMassKg: 0,
    boosterMassKg: 0,
  };
}

function createGuidanceAdvisoryState() {
  return {
    source: "",
    requestedPhase: "idle",
    resolvedPhase: "idle",
    requestedThrottle: 0,
    requestedMode: "",
    reason: "",
    updatedAtElapsedSec: 0,
  };
}

function resetGuidanceAdvisoryState(advisoryState) {
  const state = advisoryState && typeof advisoryState === "object"
    ? advisoryState
    : createGuidanceAdvisoryState();
  state.source = "";
  state.requestedPhase = "idle";
  state.resolvedPhase = "idle";
  state.requestedThrottle = 0;
  state.requestedMode = "";
  state.reason = "";
  state.updatedAtElapsedSec = 0;
  return state;
}

function createPendingMissionPhaseState() {
  return {
    active: false,
    requestedPhase: "",
    source: "",
    reason: "",
    requestedAtElapsedSec: 0,
    authorizationMode: "",
  };
}

function resetPendingMissionPhaseState(pendingState) {
  const state = pendingState && typeof pendingState === "object"
    ? pendingState
    : createPendingMissionPhaseState();
  state.active = false;
  state.requestedPhase = "";
  state.source = "";
  state.reason = "";
  state.requestedAtElapsedSec = 0;
  state.authorizationMode = "";
  return state;
}

function createPendingStageTransitionState() {
  return {
    active: false,
    kind: "",
    fromStageIndex: 0,
    toStageIndex: null,
    requestedAtElapsedSec: 0,
    requestReason: "",
    reservePropellantKg: 0,
    requestAltitudeKm: null,
    requestGroundRelativeSpeedKmS: null,
    requestDynamicPressurePa: null,
    waitReason: "",
    authorizationMode: "",
  };
}

function resetPendingStageTransition(transitionState) {
  const state = transitionState && typeof transitionState === "object"
    ? transitionState
    : createPendingStageTransitionState();
  state.active = false;
  state.kind = "";
  state.fromStageIndex = 0;
  state.toStageIndex = null;
  state.requestedAtElapsedSec = 0;
  state.requestReason = "";
  state.reservePropellantKg = 0;
  state.requestAltitudeKm = null;
  state.requestGroundRelativeSpeedKmS = null;
  state.requestDynamicPressurePa = null;
  state.waitReason = "";
  state.authorizationMode = "";
  return state;
}

function stage2HotStagingThrottleCap(timeSinceIgnitionSec) {
  const t = Math.max(0, Number(timeSinceIgnitionSec) || 0);
  const ramp = clamp(t / 4.5, 0, 1);
  return 0.20 + (0.70 * ramp);
}

function evaluateHotstageRealismEnvelope(runtime, rocketState, earthState, earthRadiusKmValue = 0) {
  const relPos = subtract(
    rocketState?.position || { x: 0, y: 0, z: 0 },
    earthState?.position || { x: 0, y: 0, z: 0 },
  );
  const relVel = subtract(
    rocketState?.velocity || { x: 0, y: 0, z: 0 },
    earthState?.velocity || { x: 0, y: 0, z: 0 },
  );
  const altitudeKm = Math.max(0, length(relPos) - Math.max(0, Number(earthRadiusKmValue) || 0));
  const speedKmS = length(relVel);
  const guidance = LAUNCH_VEHICLE_CONFIG.guidance || {};
  const elapsedSec = Math.max(0, Number(runtime?.elapsedSeconds) || 0);
  const minElapsedSec = Math.max(0, Number(guidance.hotstageMinElapsedSec) || 0);
  const maxElapsedSec = Math.max(minElapsedSec, Number(guidance.hotstageMaxElapsedSec) || minElapsedSec);
  const minAltitudeKm = Math.max(0, Number(guidance.hotstageMinAltitudeKm) || 0);
  const maxAltitudeKm = Math.max(minAltitudeKm, Number(guidance.hotstageMaxAltitudeKm) || minAltitudeKm);
  const minSpeedKmS = Math.max(0, Number(guidance.hotstageMinSpeedKmS) || 0);
  const maxSpeedKmS = Math.max(minSpeedKmS, Number(guidance.hotstageMaxSpeedKmS) || minSpeedKmS);
  return {
    elapsedSec,
    altitudeKm,
    speedKmS,
    nominalElapsedSec: Math.max(minElapsedSec, Number(guidance.hotstageNominalElapsedSec) || minElapsedSec),
    nominalAltitudeKm: Math.max(minAltitudeKm, Number(guidance.hotstageNominalAltitudeKm) || minAltitudeKm),
    nominalSpeedKmS: Math.max(minSpeedKmS, Number(guidance.hotstageNominalSpeedKmS) || minSpeedKmS),
    withinEnvelope: (
      elapsedSec >= minElapsedSec
      && elapsedSec <= maxElapsedSec
      && altitudeKm >= minAltitudeKm
      && altitudeKm <= maxAltitudeKm
      && speedKmS >= minSpeedKmS
      && speedKmS <= maxSpeedKmS
    ),
  };
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
  surfaceClearanceKm = 0,
}) {
  if (!earthState?.position) {
    return null;
  }
  const surfaceState = surfacePointRelativeKmAtLatLon(
    LAUNCH_SITE.latitudeDeg,
    LAUNCH_SITE.longitudeDeg,
    earthAxes,
    { includeTerrain: true },
  );
  if (!surfaceState?.pointRelativeKm || !surfaceState?.surfaceNormal) {
    return null;
  }
  const lodSec = Number(earthAxes?.earthOrientation?.lodSec);
  const angularRateRadS = EARTH_SIDEREAL_ANGULAR_RATE_RAD_S
    * (1 - ((Number.isFinite(lodSec) ? lodSec : 0) / 86400));
  const relPositionKm = add(
    surfaceState.pointRelativeKm,
    scale(
      surfaceState.surfaceNormal,
      LAUNCH_SITE.altitudeKm
      + Math.max(0, Number(surfaceClearanceKm) || 0)
      + Math.max(0, Number(referenceOffsetKm) || 0),
    ),
  );
  const angularVelocity = scale(earthAxes.pole, angularRateRadS);
  const localRotationalVelocityKmS = cross(angularVelocity, relPositionKm);
  return {
    position: add(earthState.position, relPositionKm),
    velocity: add(earthState.velocity || { x: 0, y: 0, z: 0 }, localRotationalVelocityKmS),
  };
}

function primaryLaunchPadSurfaceClearanceKm(runtimeState = null) {
  const runtime = runtimeState;
  const guidanceMode = String(runtime?.lastStep?.guidanceMode || runtime?.autopilotMode || "").toLowerCase();
  if (runtime?.phase === "idle") {
    return LAUNCH_PAD_CONTACT_HEIGHT_ABOVE_TERRAIN_KM;
  }
  if (
    guidanceMode.includes("pad-release")
    || guidanceMode.includes("tower-clear")
    || guidanceMode.includes("vertical-ascent")
  ) {
    return LAUNCH_PAD_CONTACT_HEIGHT_ABOVE_TERRAIN_KM;
  }
  const sampledAltitudeKm = Number(
    runtime.lastSurfaceSample?.altitudeAboveTerrainKm
      ?? runtime.lastTelemetry?.altitudeAboveTerrainKm,
  );
  if (
    Number.isFinite(sampledAltitudeKm)
    && sampledAltitudeKm <= (STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM + LAUNCH_PAD_CONTACT_HEIGHT_ABOVE_TERRAIN_KM + 0.05)
  ) {
    return LAUNCH_PAD_CONTACT_HEIGHT_ABOVE_TERRAIN_KM;
  }
  return 0;
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

function configuredThrustBoundsN(config, fallbackEngineCount = 1) {
  return resolveConfiguredThrustBoundsN(config, fallbackEngineCount);
}

function interpolateConfiguredThrustN(config, pressurePa, fallbackEngineCount = 1) {
  const thrustBounds = configuredThrustBoundsN(config, fallbackEngineCount);
  return interpolateSeaToVac(
    Number(thrustBounds.thrustVacuumN) || 0,
    Number(thrustBounds.thrustSeaLevelN) || 0,
    pressurePa,
  );
}

function stageBodyKindFromStageIndex(stageIndex) {
  return Number(stageIndex) >= 1 ? "stage2" : "stage1";
}

function guidanceDirection({
  rocketState,
  earthState,
  earthAxes,
  elapsedSeconds,
  stageIndex = 0,
  altitudeKm = 0,
  dynamicPressurePa = 0,
}) {
  return guidanceDirectionModel({
    rocketState,
    earthState,
    earthAxes,
    elapsedSeconds,
    stageIndex,
    altitudeKm,
    dynamicPressurePa,
  });
}

function augmentAttitudeCommand(command, {
  runtime,
  altitudeKm = 0,
  dynamicPressurePa = 0,
}) {
  return augmentAttitudeCommandModel(command, {
    stageIndex: Number(runtime?.stageIndex) || 0,
    altitudeKm,
    dynamicPressurePa,
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
  currentDirection,
  relVel,
  up,
  throttle = 0,
  phase = "",
  guidanceMode = "",
  controlAuthorityScale = 1,
  aeroAuthority = 0,
}) {
  const safeUp = normalize(up || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const desired = normalize(desiredDirection || safeUp, safeUp);
  const speedKmS = length(relVel);
  const forward = normalize(
    currentDirection || (speedKmS > 0.02 ? relVel : desired),
    desired,
  );
  const errorRad = angleBetweenRadians(forward, desired);
  const errorDeg = degrees(errorRad);
  const errorAuthority = clamp((errorDeg - 0.35) / 15, 0, 1);
  const throttleBlend = clamp(1 - ((Number(throttle) || 0) / 0.45), 0, 1);
  const aeroSuppression = 1 - clamp(Number(aeroAuthority) || 0, 0, 1);
  const modeText = `${String(phase || "")} ${String(guidanceMode || "")}`.toLowerCase();
  const maneuveringMode = /(boostback|entry|landing|descent|separation|ballistic|coast)/.test(modeText);
  const phaseAuthorityFloor = maneuveringMode
    ? (0.08 + (0.24 * throttleBlend)) * Math.max(0.12, aeroSuppression)
    : 0;
  let authority = Math.max(errorAuthority, phaseAuthorityFloor)
    * clamp(Number(controlAuthorityScale) || 1, 0.35, 1.4);
  const aeroLedMode = throttleBlend > 0.75 && /(entry|descent|ballistic|coast)/.test(modeText);
  if (aeroLedMode && aeroAuthority > 0.2) {
    authority = Math.min(authority, 0.04 + (0.12 * aeroSuppression));
  }
  if (!(authority > 0.01)) {
    return {
      accelerationKmS2: { x: 0, y: 0, z: 0 },
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
      accelerationKmS2: { x: 0, y: 0, z: 0 },
      active: false,
      errorDeg,
      authority: 0,
      jets: [],
    };
  }
  const jets = Array.from(
    new Set(rcsJetSelection(correctionDir, forward, safeUp)),
  );
  const linearAuthority = clamp(
    Math.max(errorAuthority, phaseAuthorityFloor * 0.35)
      * clamp(Number(controlAuthorityScale) || 1, 0.35, 1.4)
      * throttleBlend
      * Math.max(0.08, aeroSuppression),
    0,
    1,
  );
  const accelerationMagnitudeKmS2 = (LAUNCH_RCS_CONFIG.maxAccelerationKmS2 || 0) * linearAuthority;
  return {
    active: jets.length > 0 && authority > 0.02,
    accelerationKmS2: scale(correctionDir, accelerationMagnitudeKmS2),
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

function boosterBodyLengthMeters() {
  return Math.max(1, Number(STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm) || 0) * 1000;
}

function boosterRadiusMeters() {
  return Math.max(1, Number(STARSHIP_STACK_DIMENSIONS_KM.diameterKm) || 0) * 500;
}

function createBoosterAttitudeState(initialAxisWorld = { x: 0, y: 0, z: 1 }) {
  const axis = normalize(initialAxisWorld, { x: 0, y: 0, z: 1 });
  return {
    orientation: quaternionFromUnitVectors({ x: 0, y: 1, z: 0 }, axis),
    omegaBodyRadS: { x: 0, y: 0, z: 0 },
  };
}

function applyBoosterAttitudeSnapshot(snapshot = null, fallbackAxisWorld = { x: 0, y: 0, z: 1 }) {
  const base = createBoosterAttitudeState(fallbackAxisWorld);
  const merged = {
    ...base,
    ...(snapshot && typeof snapshot === "object" ? snapshot : {}),
  };
  merged.orientation = normalizeQuaternion(merged.orientation, base.orientation);
  merged.omegaBodyRadS = {
    x: finiteNumber(merged.omegaBodyRadS?.x, 0),
    y: finiteNumber(merged.omegaBodyRadS?.y, 0),
    z: finiteNumber(merged.omegaBodyRadS?.z, 0),
  };
  return merged;
}

function boosterPrincipalInertiaKgM2(massKg = 0, inertiaNormalized = 1) {
  const safeMassKg = Math.max(1, Number(massKg) || 0);
  const radiusM = boosterRadiusMeters();
  const lengthM = boosterBodyLengthMeters();
  const inertiaScale = Math.max(0.25, Number(inertiaNormalized) || 1);
  const transverse = safeMassKg * ((3 * radiusM * radiusM) + (lengthM * lengthM)) / 12 * inertiaScale;
  const axial = 0.5 * safeMassKg * radiusM * radiusM * inertiaScale;
  return {
    x: transverse,
    y: axial,
    z: transverse,
  };
}

function boosterBodyAxisWorld(attitudeState = null) {
  return normalize(
    rotateVectorByQuaternion({ x: 0, y: 1, z: 0 }, attitudeState?.orientation || quaternionIdentity()),
    { x: 0, y: 0, z: 1 },
  );
}

function boosterBodyAxesWorld(attitudeState = null) {
  const orientation = attitudeState?.orientation || quaternionIdentity();
  return {
    right: normalize(
      rotateVectorByQuaternion({ x: 1, y: 0, z: 0 }, orientation),
      { x: 1, y: 0, z: 0 },
    ),
    forward: normalize(
      rotateVectorByQuaternion({ x: 0, y: 1, z: 0 }, orientation),
      { x: 0, y: 0, z: 1 },
    ),
    top: normalize(
      rotateVectorByQuaternion({ x: 0, y: 0, z: 1 }, orientation),
      { x: 0, y: 0, z: 1 },
    ),
  };
}

function rotateWorldVectorToBoosterBody(worldVector, attitudeState = null) {
  return rotateVectorByQuaternion(
    worldVector || { x: 0, y: 0, z: 0 },
    {
      x: -(Number(attitudeState?.orientation?.x) || 0),
      y: -(Number(attitudeState?.orientation?.y) || 0),
      z: -(Number(attitudeState?.orientation?.z) || 0),
      w: Number(attitudeState?.orientation?.w) || 1,
    },
  );
}

function signedAngleAroundAxis(fromVector, toVector, axisVector) {
  const axis = unitOrNull(axisVector);
  const from = unitOrNull(fromVector);
  const to = unitOrNull(toVector);
  if (!axis || !from || !to) {
    return 0;
  }
  const crossTerm = cross(from, to);
  const sinTheta = dot(axis, crossTerm);
  const cosTheta = clamp(dot(from, to), -1, 1);
  return Math.atan2(sinTheta, cosTheta);
}

function clampVectorMagnitude(vector, maxMagnitude = 0) {
  const magnitude = length(vector || { x: 0, y: 0, z: 0 });
  const limit = Math.max(0, Number(maxMagnitude) || 0);
  if (!(magnitude > limit) || !(limit > 0)) {
    return {
      x: Number(vector?.x) || 0,
      y: Number(vector?.y) || 0,
      z: Number(vector?.z) || 0,
    };
  }
  return scale(vector, limit / magnitude);
}

function computeBoosterAttitudeControlErrors({
  desiredDirection,
  attitudeState = null,
  referenceUpWorld = null,
  tangentialVectorWorld = null,
}) {
  const desiredWorld = normalize(desiredDirection, { x: 0, y: 0, z: 1 });
  const bodyAxes = boosterBodyAxesWorld(attitudeState);
  const desiredBody = normalize(
    rotateWorldVectorToBoosterBody(desiredWorld, attitudeState),
    { x: 0, y: 1, z: 0 },
  );
  let alignAxisBody = cross({ x: 0, y: 1, z: 0 }, desiredBody);
  const alignAngleRad = angleBetweenRadians({ x: 0, y: 1, z: 0 }, desiredBody);
  if (!(length(alignAxisBody) > 1e-9) && dot({ x: 0, y: 1, z: 0 }, desiredBody) < 0) {
    const fallbackWorld = unitOrNull(referenceUpWorld)
      || unitOrNull(tangentialVectorWorld)
      || bodyAxes.top;
    const fallbackBody = normalize(
      rotateWorldVectorToBoosterBody(fallbackWorld, attitudeState),
      { x: 0, y: 0, z: 1 },
    );
    alignAxisBody = cross({ x: 0, y: 1, z: 0 }, fallbackBody);
    if (!(length(alignAxisBody) > 1e-9)) {
      alignAxisBody = { x: 1, y: 0, z: 0 };
    }
  }
  const alignAxisUnitBody = normalize(alignAxisBody, { x: 1, y: 0, z: 0 });

  const desiredTopWorldRaw = subtract(
    unitOrNull(referenceUpWorld) || bodyAxes.top,
    scale(desiredWorld, dot(unitOrNull(referenceUpWorld) || bodyAxes.top, desiredWorld)),
  );
  const desiredTopWorld = normalize(
    desiredTopWorldRaw,
    unitOrNull(cross(bodyAxes.forward, tangentialVectorWorld || bodyAxes.right))
      || bodyAxes.top,
  );
  const currentTopProjected = normalize(
    subtract(bodyAxes.top, scale(bodyAxes.forward, dot(bodyAxes.top, bodyAxes.forward))),
    bodyAxes.top,
  );
  const desiredTopProjected = normalize(
    subtract(desiredTopWorld, scale(bodyAxes.forward, dot(desiredTopWorld, bodyAxes.forward))),
    desiredTopWorld,
  );
  const rollAlignWeight = clamp((dot(bodyAxes.forward, desiredWorld) + 0.15) / 0.85, 0, 1);
  const rollErrorRad = signedAngleAroundAxis(
    currentTopProjected,
    desiredTopProjected,
    bodyAxes.forward,
  ) * rollAlignWeight;

  return {
    desiredBodyDirection: desiredBody,
    alignAngleRad,
    pitchErrorRad: alignAxisUnitBody.x * alignAngleRad,
    yawErrorRad: alignAxisUnitBody.z * alignAngleRad,
    rollErrorRad,
  };
}

function integrateBoosterAttitudeState(attitudeState, {
  torqueWorldNm = { x: 0, y: 0, z: 0 },
  massKg = 0,
  inertiaNormalized = 1,
  angularDampingPerS = 0,
  maxBodyRateRadS = null,
  dtSeconds = 0,
}) {
  const state = attitudeState || createBoosterAttitudeState({ x: 0, y: 0, z: 1 });
  const dt = Math.max(0, Number(dtSeconds) || 0);
  if (!(dt > 0)) {
    return state;
  }
  const inertia = boosterPrincipalInertiaKgM2(massKg, inertiaNormalized);
  const invInertia = {
    x: 1 / Math.max(inertia.x, 1e-6),
    y: 1 / Math.max(inertia.y, 1e-6),
    z: 1 / Math.max(inertia.z, 1e-6),
  };
  const torqueBody = rotateWorldVectorToBoosterBody(torqueWorldNm, state);
  const omega = {
    x: finiteNumber(state.omegaBodyRadS?.x, 0),
    y: finiteNumber(state.omegaBodyRadS?.y, 0),
    z: finiteNumber(state.omegaBodyRadS?.z, 0),
  };
  const iOmega = {
    x: inertia.x * omega.x,
    y: inertia.y * omega.y,
    z: inertia.z * omega.z,
  };
  const omegaCrossIomega = cross(omega, iOmega);
  const rhs = subtract(torqueBody, omegaCrossIomega);
  const alpha = {
    x: rhs.x * invInertia.x,
    y: rhs.y * invInertia.y,
    z: rhs.z * invInertia.z,
  };
  const damp = Math.exp(-Math.max(0, Number(angularDampingPerS) || 0) * dt);
  state.omegaBodyRadS = scale(add(omega, scale(alpha, dt)), damp);
  const omegaQuat = {
    x: state.omegaBodyRadS.x,
    y: state.omegaBodyRadS.y,
    z: state.omegaBodyRadS.z,
    w: 0,
  };
  const qDot = multiplyQuaternions(state.orientation, omegaQuat);
  state.orientation = normalizeQuaternion({
    x: state.orientation.x + (0.5 * qDot.x * dt),
    y: state.orientation.y + (0.5 * qDot.y * dt),
    z: state.orientation.z + (0.5 * qDot.z * dt),
    w: state.orientation.w + (0.5 * qDot.w * dt),
  }, state.orientation);
  const omegaLimitRadS = (
    Number.isFinite(Number(maxBodyRateRadS)) && Number(maxBodyRateRadS) > 0
      ? Number(maxBodyRateRadS)
      : rad(45)
  );
  const omegaMagnitude = length(state.omegaBodyRadS);
  if (omegaMagnitude > omegaLimitRadS) {
    state.omegaBodyRadS = scale(state.omegaBodyRadS, omegaLimitRadS / omegaMagnitude);
  }
  return state;
}

function scaleAngularControlState(controlState, scaleFactor = 1) {
  const scaleClamped = clamp(Number(scaleFactor) || 0, 0, 3.5);
  const base = controlState || {};
  return {
    ...base,
    authority: clamp((Number(base.authority) || 0) * scaleClamped, 0, 1),
    momentNm: (Number(base.momentNm) || 0) * scaleClamped,
    bodyTorqueNm: scale(base.bodyTorqueNm || { x: 0, y: 0, z: 0 }, scaleClamped),
    angularAccelerationRadS2: (Number(base.angularAccelerationRadS2) || 0) * scaleClamped,
  };
}

function updateBoosterThrottleState(actuatorState, {
  requestedThrottle = 0,
  dtSeconds = 0,
  massModel = null,
}) {
  const state = actuatorState || createActuatorState({ x: 0, y: 0, z: 1 });
  const cfg = LAUNCH_REALISM_CONFIG.actuator.booster;
  const massState = massModel || createMassModelState();
  const requestedThrottleClamped = clamp(Number(requestedThrottle) || 0, 0, 1);
  const dt = Math.max(0, Number(dtSeconds) || 0);
  const inertiaScale = clamp(
    (
      (0.72 + (0.58 * (Number(massState.inertiaNormalized) || 1)))
      / Math.max(Number(massState.controlAuthorityScale) || 1, 0.25)
    ),
    0.45,
    1.9,
  );
  const riseTau = Math.max(0.06, (Number(cfg.throttleRiseTauSec) || 0.42) * inertiaScale);
  const fallTau = Math.max(0.05, (Number(cfg.throttleFallTauSec) || 0.30) * inertiaScale);
  const throttleTau = requestedThrottleClamped >= state.throttleActual ? riseTau : fallTau;
  const alpha = clamp(dt / throttleTau, 0, 1);
  state.throttleCommand = requestedThrottleClamped;
  state.throttleActual = state.throttleActual + ((requestedThrottleClamped - state.throttleActual) * alpha);
  return state;
}

function computeBoosterEngineAngularControlState({
  controlErrorsBody,
  omegaBodyRadS = null,
  pressurePa = 0,
  throttle = 0,
  massKg = 0,
  massModel = null,
}) {
  const maxGimbalDeflectionRad = rad(
    Number(LAUNCH_REALISM_CONFIG.actuator?.booster?.maxGimbalDeflectionDeg) || 8,
  );
  if (!(throttle > 1e-6) || !(maxGimbalDeflectionRad > 1e-6)) {
    return {
      authority: 0,
      momentNm: 0,
      bodyTorqueNm: { x: 0, y: 0, z: 0 },
      angularAccelerationRadS2: 0,
      dampingPerS: 0,
    };
  }
  const fullThrustN = interpolateConfiguredThrustN(LAUNCH_BOOSTER_CONFIG, pressurePa);
  const thrustN = fullThrustN * clamp(Number(throttle) || 0, 0, 1);
  if (!(thrustN > 0)) {
    return {
      authority: 0,
      momentNm: 0,
      bodyTorqueNm: { x: 0, y: 0, z: 0 },
      angularAccelerationRadS2: 0,
      dampingPerS: 0,
    };
  }
  const enginePlaneNorm = Number(LAUNCH_REALISM_CONFIG.massModel?.booster?.enginePlaneNorm);
  const comNorm = clamp(Number(massModel?.comNormalized) || 0.5, 0, 1);
  const leverArmM = Math.max(
    0.1,
    Math.abs(comNorm - (Number.isFinite(enginePlaneNorm) ? enginePlaneNorm : 0.04)) * boosterBodyLengthMeters(),
  );
  const engineCluster = Array.isArray(LAUNCH_REALISM_CONFIG.engineCluster?.booster?.engines)
    ? LAUNCH_REALISM_CONFIG.engineCluster.booster.engines
    : [];
  const omegaBody = {
    x: finiteNumber(omegaBodyRadS?.x, 0),
    y: finiteNumber(omegaBodyRadS?.y, 0),
    z: finiteNumber(omegaBodyRadS?.z, 0),
  };
  const axisCommand = clampVectorMagnitude({
    x: finiteNumber(controlErrorsBody?.pitchErrorRad, 0) - (0.22 * omegaBody.x),
    y: 0,
    z: finiteNumber(controlErrorsBody?.yawErrorRad, 0) - (0.22 * omegaBody.z),
  }, maxGimbalDeflectionRad);
  const deflectionMagRad = Math.hypot(axisCommand.x, axisCommand.z);
  if (!(deflectionMagRad > 1e-6)) {
    return {
      authority: 0,
      momentNm: 0,
      bodyTorqueNm: { x: 0, y: 0, z: 0 },
      angularAccelerationRadS2: 0,
      dampingPerS: 0,
    };
  }
  const commandedDirectionBody = normalize({
    x: Math.sin(axisCommand.z),
    y: Math.cos(Math.hypot(axisCommand.x, axisCommand.z)),
    z: Math.sin(axisCommand.x),
  }, { x: 0, y: 1, z: 0 });
  const engines = engineCluster.length > 0
    ? engineCluster
    : [{ name: "aggregate", positionBodyM: { x: 0, y: -leverArmM, z: 0 } }];
  const thrustPerEngineN = thrustN / Math.max(1, engines.length);
  const bodyTorqueNm = engines.reduce((sum, engine) => {
    const positionBodyM = {
      x: finiteNumber(engine?.positionBodyM?.x, 0),
      y: finiteNumber(engine?.positionBodyM?.y, -leverArmM),
      z: finiteNumber(engine?.positionBodyM?.z, 0),
    };
    const forceBodyN = scale(commandedDirectionBody, thrustPerEngineN);
    return add(sum, cross(positionBodyM, forceBodyN));
  }, { x: 0, y: 0, z: 0 });
  const momentNm = Math.hypot(bodyTorqueNm.x, bodyTorqueNm.z);
  const inertia = boosterPrincipalInertiaKgM2(massKg, massModel?.inertiaNormalized);
  const maxMomentNm = fullThrustN * leverArmM * Math.sin(maxGimbalDeflectionRad);
  return {
    authority: clamp(momentNm / Math.max(maxMomentNm, 1e-6), 0, 1),
    momentNm,
    bodyTorqueNm,
    angularAccelerationRadS2: Math.hypot(
      bodyTorqueNm.x / Math.max(inertia.x, 1e-6),
      bodyTorqueNm.z / Math.max(inertia.z, 1e-6),
    ),
    dampingPerS: 0,
  };
}

function computeBoosterRcsAngularControlState({
  controlErrorsBody,
  omegaBodyRadS = null,
  controlAuthorityScale = 1,
  aeroAuthority = 0,
  throttle = 0,
  massKg = 0,
  massModel = null,
}) {
  const errorRad = Math.hypot(
    finiteNumber(controlErrorsBody?.pitchErrorRad, 0),
    finiteNumber(controlErrorsBody?.yawErrorRad, 0),
    finiteNumber(controlErrorsBody?.rollErrorRad, 0),
  );
  const errorDeg = degrees(errorRad);
  const deadbandDeg = LAUNCH_RCS_CONFIG.deadbandDeg;
  const fullAuthorityDeg = Math.max(deadbandDeg + 0.1, LAUNCH_RCS_CONFIG.fullAuthorityDeg);
  const authority = clamp((errorDeg - deadbandDeg) / (fullAuthorityDeg - deadbandDeg), 0, 1);
  const throttleBlend = clamp(1 - ((Number(throttle) || 0) / 0.45), 0, 1);
  const aeroSuppression = 1 - clamp(Number(aeroAuthority) || 0, 0, 1);
  const effectiveAuthority = authority
    * throttleBlend
    * aeroSuppression
    * clamp(Number(controlAuthorityScale) || 1, 0.35, 1.4);
  if (!(effectiveAuthority > 1e-4)) {
    return {
      authority: 0,
      bodyTorqueNm: { x: 0, y: 0, z: 0 },
      angularAccelerationRadS2: 0,
      dampingPerS: 0,
    };
  }
  const leverArmM = Math.max(1, boosterBodyLengthMeters() * 0.46);
  const maxLinearAccelMS2 = Math.max(0, Number(LAUNCH_RCS_CONFIG.maxAccelerationKmS2) || 0) * 1000;
  const largeAngleBoost = clamp(errorDeg / 18, 1, 9);
  const maxAngularAccelerationRadS2 = ((maxLinearAccelMS2 * effectiveAuthority) / leverArmM) * 8.5 * largeAngleBoost;
  const omegaBody = {
    x: finiteNumber(omegaBodyRadS?.x, 0),
    y: finiteNumber(omegaBodyRadS?.y, 0),
    z: finiteNumber(omegaBodyRadS?.z, 0),
  };
  const controlDemand = clampVectorMagnitude({
    x: (1.85 * finiteNumber(controlErrorsBody?.pitchErrorRad, 0)) - (0.28 * omegaBody.x),
    y: (1.35 * finiteNumber(controlErrorsBody?.rollErrorRad, 0)) - (0.24 * omegaBody.y),
    z: (1.85 * finiteNumber(controlErrorsBody?.yawErrorRad, 0)) - (0.28 * omegaBody.z),
  }, Math.max(0.18, rad(26)));
  const controlNorm = Math.max(1e-9, length(controlDemand));
  const commandedAngularAccel = scale(controlDemand, maxAngularAccelerationRadS2 / controlNorm);
  const inertia = boosterPrincipalInertiaKgM2(massKg, massModel?.inertiaNormalized);
  const bodyTorqueNm = {
    x: commandedAngularAccel.x * inertia.x,
    y: commandedAngularAccel.y * inertia.y,
    z: commandedAngularAccel.z * inertia.z,
  };
  return {
    authority: effectiveAuthority,
    bodyTorqueNm,
    angularAccelerationRadS2: length(commandedAngularAccel),
    dampingPerS: 0,
  };
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
  return augmentAttitudeCommand(computeAutopilotCommandModel({
    runtime,
    orbital,
    relPos,
    dynamicPressurePa,
    relVel,
    up,
    earthPole,
    muKm3S2,
    earthRadiusKm,
  }), {
    runtime,
    altitudeKm: Number(orbital?.altitudeKm) || 0,
    dynamicPressurePa,
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

  const stageFullThrustN = interpolateConfiguredThrustN(stage, pressurePa);
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

function finiteLaunchVectorValue(value) {
  return Boolean(
    value
    && Number.isFinite(Number(value.x))
    && Number.isFinite(Number(value.y))
    && Number.isFinite(Number(value.z)),
  );
}

function cloneLaunchVector(value, fallback = { x: 0, y: 0, z: 0 }) {
  if (!finiteLaunchVectorValue(value)) {
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

function cloneLaunchVectorOrNull(value) {
  return finiteLaunchVectorValue(value) ? cloneLaunchVector(value) : null;
}

function telemetryFromState({
  gravitationalConstantKm3PerKgS2,
  earthMassKg,
  earthRadiusKm,
  earthState,
  rocketState,
  atmosphereSample,
  earthPole,
  windVectorKmS,
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
  const inertialSpeedKmS = length(rocketState.velocity || { x: 0, y: 0, z: 0 });
  const groundRelativeVelocityKmS = atmosphereRelativeVelocityKmS(relPos, relVel, earthPole);
  const airRelativeVelocityKmS = atmosphereRelativeVelocityKmS(
    relPos,
    relVel,
    earthPole,
    windVectorKmS || null,
  );
  const groundRelativeSpeedKmS = length(groundRelativeVelocityKmS);
  const airRelativeSpeedKmS = length(airRelativeVelocityKmS);

  const dynamicPressurePa =
    Number.isFinite(Number(dynamicPressurePaOverride))
      ? Number(dynamicPressurePaOverride)
      : dynamicPressurePaFromAtmosphere(
        atmosphereSample,
        relPos,
        relVel,
        earthPole,
        windVectorKmS || null,
      );
  const surfaceSample = runtime.lastSurfaceSample || null;
  const centerAltitudeAboveTerrainKm = Number(surfaceSample?.altitudeAboveTerrainKm);
  const vehicleAltitudeAboveTerrainKm = Number.isFinite(centerAltitudeAboveTerrainKm)
    ? centerAltitudeAboveTerrainKm - STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM
    : null;
  const reportedAltitudeKm = Number.isFinite(vehicleAltitudeAboveTerrainKm) && Number(orbital.altitudeKm) < 25
    ? Math.max(0, vehicleAltitudeAboveTerrainKm)
    : orbital.altitudeKm;
  const refuelTargetPropellantKg = resolveRefuelTargetKg(
    runtime.refuel,
    stage2PropellantCapacityKg(runtime?.mission?.selectedId),
  );
  const refuelFillFraction = computeRefuelFillFraction(
    runtime.stagePropellantKg,
    refuelTargetPropellantKg,
  );
  const boosterHotstageMassKg = Math.max(
    1,
    (Number(LAUNCH_BOOSTER_CONFIG.dryMassKg) || 0) + Math.max(0, Number(runtime.hotstage?.boosterReservePropellantKg) || 0),
  );
  const hotstageOffsets = computeHotstageRelativeOffsetsKm({
    hotstage: runtime.hotstage,
    elapsedSeconds: runtime.elapsedSeconds,
    shipMassKg: rocketState.massKg,
    boosterMassKg: boosterHotstageMassKg,
  });
  const vehiclePhase = deriveStarshipVehiclePhase({
    telemetry: {
      altitudeKm: reportedAltitudeKm,
      altitudeAboveTerrainKm: vehicleAltitudeAboveTerrainKm,
      groundRelativeSpeedKmS,
      speedKmS: orbital.speedKmS,
      apoapsisKm,
      periapsisKm,
      targetOrbitAltitudeKm: runtime.targetOrbitAltitudeKm,
      throttle: runtime.lastStep?.throttle || 0,
      thrustN: runtime.lastStep?.thrustN || 0,
    },
    runtimePhase: runtime.commandPhase || runtime.phase,
    lastStep: runtime.lastStep,
    targetOrbitAltitudeKm: runtime.targetOrbitAltitudeKm,
  });
  return {
    phase: vehiclePhase,
    commandPhase: runtime.commandPhase || runtime.phase,
    elapsedSeconds: runtime.elapsedSeconds,
    stageIndex: runtime.stageIndex,
    stageName: stageAtIndex(runtime.stageIndex)?.name || "Coast/Complete",
    massKg: rocketState.massKg,
    altitudeKm: reportedAltitudeKm,
    speedKmS: orbital.speedKmS,
    earthRelativeSpeedKmS: orbital.speedKmS,
    groundRelativeSpeedKmS,
    airRelativeSpeedKmS,
    inertialSpeedKmS,
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
    guidanceRequestedDirectionKm: cloneLaunchVectorOrNull(runtime.lastStep?.requestedDirectionKm),
    bodyAxisDirectionKm: cloneLaunchVectorOrNull(runtime.lastStep?.bodyAxisDirectionKm),
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
    hotstageDisplayedGapKm: hotstageOffsets.displayedGapKm,
    hotstageShipOffsetKm: hotstageOffsets.shipOffsetKm,
    hotstageBoosterOffsetKm: hotstageOffsets.boosterOffsetKm,
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
  windVectorKmS,
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
  const inertialSpeedKmS = length(boosterState.velocity || { x: 0, y: 0, z: 0 });
  const groundRelativeVelocityKmS = atmosphereRelativeVelocityKmS(relPos, relVel, earthPole);
  const airRelativeVelocityKmS = atmosphereRelativeVelocityKmS(
    relPos,
    relVel,
    earthPole,
    windVectorKmS || null,
  );
  const groundRelativeSpeedKmS = length(groundRelativeVelocityKmS);
  const airRelativeSpeedKmS = length(airRelativeVelocityKmS);
  const dynamicPressurePa =
    Number.isFinite(Number(dynamicPressurePaOverride))
      ? Number(dynamicPressurePaOverride)
      : dynamicPressurePaFromAtmosphere(
        atmosphereSample,
        relPos,
        relVel,
        earthPole,
        windVectorKmS || null,
      );
  const pressurePa = Math.max(0, Number(atmosphereSample?.pressurePa) || 0);
  const densityKgM3 = Math.max(0, Number(atmosphereSample?.densityKgM3) || 0);
  const surfaceSample = runtime.booster.lastSurfaceSample || null;
  const navSolution = runtime.booster.navigation?.solution || null;
  const requestedDirection = runtime.booster.lastStep?.requestedDirectionKm
    ? unitOrNull(runtime.booster.lastStep.requestedDirectionKm)
    : null;
  const bodyAxisDirection = (
    runtime.booster.lastStep?.bodyAxisDirectionKm
      ? unitOrNull(runtime.booster.lastStep.bodyAxisDirectionKm)
      : null
  ) || unitOrNull(boosterBodyAxisWorld(runtime.booster.attitude));
  const retrogradeDirection = normalize(scale(relVel, -1), orbital.up);
  const angleFromAlignmentDeg = (alignment) => (
    Number.isFinite(Number(alignment))
      ? (Math.acos(clamp(Number(alignment), -1, 1)) * (180 / Math.PI))
      : null
  );
  const requestedOffRetrogradeDeg = requestedDirection
    ? angleFromAlignmentDeg(dot(requestedDirection, retrogradeDirection))
    : null;
  const bodyOffRetrogradeDeg = bodyAxisDirection
    ? angleFromAlignmentDeg(dot(bodyAxisDirection, retrogradeDirection))
    : null;
  const centerAltitudeAboveTerrainKm = Number(surfaceSample?.altitudeAboveTerrainKm);
  const boosterAltitudeAboveTerrainKm = Number.isFinite(centerAltitudeAboveTerrainKm)
    ? centerAltitudeAboveTerrainKm - BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM
    : null;
  const reportedAltitudeKm = Number.isFinite(boosterAltitudeAboveTerrainKm) && Number(orbital.altitudeKm) < 25
    ? Math.max(0, boosterAltitudeAboveTerrainKm)
    : orbital.altitudeKm;
  const boosterPhase = deriveBoosterVehiclePhase({
    telemetry: {
      altitudeKm: reportedAltitudeKm,
      altitudeAboveTerrainKm: boosterAltitudeAboveTerrainKm,
      groundRelativeSpeedKmS,
      speedKmS: orbital.speedKmS,
      throttle: runtime.booster.lastStep?.throttle || 0,
      thrustN: runtime.booster.lastStep?.thrustN || 0,
      guidanceMode: runtime.booster.guidanceMode,
      commandPhase: runtime.booster.commandPhase || runtime.booster.phase,
    },
    boosterRuntime: runtime.booster,
  });
  return {
    phase: boosterPhase,
    commandPhase: runtime.booster.commandPhase || runtime.booster.phase,
    guidanceMode: runtime.booster.guidanceMode,
    requestedDirectionKm: cloneLaunchVectorOrNull(requestedDirection),
    bodyAxisDirectionKm: cloneLaunchVectorOrNull(bodyAxisDirection),
    requestedOffRetrogradeDeg: requestedOffRetrogradeDeg !== null ? requestedOffRetrogradeDeg : null,
    bodyOffRetrogradeDeg: bodyOffRetrogradeDeg !== null ? bodyOffRetrogradeDeg : null,
    massKg: boosterState.massKg,
    propellantKg: runtime.booster.propellantKg,
    initialPropellantKg: runtime.booster.initialPropellantKg,
    fuelFraction: runtime.booster.initialPropellantKg > 1e-6
      ? clamp(runtime.booster.propellantKg / runtime.booster.initialPropellantKg, 0, 1)
      : null,
    altitudeKm: reportedAltitudeKm,
    speedKmS: orbital.speedKmS,
    earthRelativeSpeedKmS: orbital.speedKmS,
    groundRelativeSpeedKmS,
    airRelativeSpeedKmS,
    inertialSpeedKmS,
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
    rcsAccelerationKmS2: cloneLaunchVector(runtime.booster.lastStep?.rcsAccelerationKmS2),
    rcsAccelerationMagKmS2: Number(runtime.booster.lastStep?.rcsAccelerationMagKmS2) || 0,
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
    gridFinAuthority: Number(runtime.booster.lastStep?.gridFinAuthority) || 0,
    gridFinDeflectionDeg: Number(runtime.booster.lastStep?.gridFinDeflectionDeg) || 0,
    gridFinMomentNm: Number(runtime.booster.lastStep?.gridFinMomentNm) || 0,
    gridFinAngularAccelerationRadS2: Number(runtime.booster.lastStep?.gridFinAngularAccelerationRadS2) || 0,
    bodyAngularRateRadS: cloneLaunchVectorOrNull(runtime.booster.lastStep?.bodyAngularRateRadS),
    terrainElevationKm: Number.isFinite(Number(surfaceSample?.terrainHeightKm))
      ? Number(surfaceSample.terrainHeightKm)
      : null,
    altitudeAboveTerrainKm: Number.isFinite(boosterAltitudeAboveTerrainKm)
      ? boosterAltitudeAboveTerrainKm
      : null,
    navSource: String(navSolution?.source || ""),
    navPositionSigmaKm: Number.isFinite(Number(navSolution?.positionSigmaKm))
      ? Number(navSolution.positionSigmaKm)
      : null,
    navVelocitySigmaKmS: Number.isFinite(Number(navSolution?.velocitySigmaKmS))
      ? Number(navSolution.velocitySigmaKmS)
      : null,
    navCatchPositionSigmaKm: Number.isFinite(Number(navSolution?.catchPositionSigmaKm))
      ? Number(navSolution.catchPositionSigmaKm)
      : null,
    navCatchVelocitySigmaKmS: Number.isFinite(Number(navSolution?.catchVelocitySigmaKmS))
      ? Number(navSolution.catchVelocitySigmaKmS)
      : null,
    navTowerRelativeActive: Boolean(navSolution?.towerRelativeActive),
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
    rcsAccelerationKmS2: { x: 0, y: 0, z: 0 },
    rcsAccelerationMagKmS2: 0,
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
  if (phase === "landed") {
    return "Landed";
  }
  if (phase === "caught") {
    return "Caught";
  }
  if (phase === "complete") {
    return "Mission Complete";
  }
  return "Idle";
}

function telemetryIndicatesStableOrbit(telemetry = null, targetOrbitAltitudeKm = null) {
  const apoapsisKm = finiteOrNull(telemetry?.apoapsisKm);
  const periapsisKm = finiteOrNull(telemetry?.periapsisKm);
  if (!Number.isFinite(apoapsisKm) || !Number.isFinite(periapsisKm)) {
    return false;
  }
  const resolvedTargetAltitudeKm = Math.max(
    80,
    Number.isFinite(Number(targetOrbitAltitudeKm))
      ? Number(targetOrbitAltitudeKm)
      : (Number(LAUNCH_AUTOPILOT_CONFIG.targetOrbitAltitudeKm) || 250),
  );
  return orbitInsertionWithinTolerance(
    { apoapsisKm, periapsisKm },
    LAUNCH_AUTOPILOT_CONFIG,
    resolvedTargetAltitudeKm,
  );
}

function deriveStarshipVehiclePhase({
  telemetry = null,
  runtimePhase = "idle",
  lastStep = null,
  targetOrbitAltitudeKm = null,
} = {}) {
  const source = telemetry && typeof telemetry === "object"
    ? telemetry
    : (lastStep && typeof lastStep === "object" ? lastStep : null);
  const thrustN = Number(source?.thrustN) || 0;
  const throttle = Number(source?.throttle) || 0;
  const altitudeAboveTerrainKm = finiteOrNull(telemetry?.altitudeAboveTerrainKm);
  const groundRelativeSpeedKmS = Math.abs(
    Number.isFinite(Number(telemetry?.groundRelativeSpeedKmS))
      ? Number(telemetry.groundRelativeSpeedKmS)
      : (Number(source?.speedKmS) || 0),
  );
  if (thrustN > 1 || throttle > 1e-3) {
    return "powered";
  }
  if (telemetryIndicatesStableOrbit(telemetry, targetOrbitAltitudeKm || telemetry?.targetOrbitAltitudeKm)) {
    return "orbit";
  }
  if (Number.isFinite(altitudeAboveTerrainKm) && altitudeAboveTerrainKm <= 0.05 && groundRelativeSpeedKmS < 0.05) {
    return "idle";
  }
  return String(runtimePhase || "idle") === "idle" && groundRelativeSpeedKmS < 0.05
    ? "idle"
    : "coast";
}

function deriveBoosterVehiclePhase({
  telemetry = null,
  boosterRuntime = null,
} = {}) {
  const source = telemetry && typeof telemetry === "object"
    ? telemetry
    : (boosterRuntime?.lastStep && typeof boosterRuntime.lastStep === "object" ? boosterRuntime.lastStep : null);
  const guidanceText = `${String(telemetry?.guidanceMode || boosterRuntime?.guidanceMode || "")} ${String(telemetry?.commandPhase || boosterRuntime?.commandPhase || boosterRuntime?.phase || "")}`.toLowerCase();
  const thrustN = Number(source?.thrustN) || 0;
  const throttle = Number(source?.throttle) || 0;
  const altitudeAboveTerrainKm = finiteOrNull(telemetry?.altitudeAboveTerrainKm);
  const groundRelativeSpeedKmS = Math.abs(
    Number.isFinite(Number(telemetry?.groundRelativeSpeedKmS))
      ? Number(telemetry.groundRelativeSpeedKmS)
      : (Number(source?.speedKmS) || 0),
  );
  const surfaceSettled = (
    Number.isFinite(altitudeAboveTerrainKm)
    && altitudeAboveTerrainKm <= 0.02
    && groundRelativeSpeedKmS < 0.04
  );
  if (boosterRuntime?.landed || surfaceSettled) {
    return guidanceText.includes("caught") ? "caught" : "landed";
  }
  if (boosterRuntime?.attached && !boosterRuntime?.active) {
    return "idle";
  }
  if (thrustN > 1 || throttle > 1e-3) {
    return "powered";
  }
  return "coast";
}

function reportedLaunchPhase(runtimePhase, telemetry = null, fallbackStep = null, targetOrbitAltitudeKm = null) {
  return deriveStarshipVehiclePhase({
    telemetry,
    runtimePhase,
    lastStep: fallbackStep,
    targetOrbitAltitudeKm,
  });
}

function reportedBoosterPhase(telemetry = null, boosterRuntime = null) {
  return deriveBoosterVehiclePhase({
    telemetry,
    boosterRuntime,
  });
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
    sampleLaunchWeather,
    gravitationalConstantKm3PerKgS2,
    windSeed,
    onEvent,
    onError,
  } = options || {};
  const configuredWindSeed = Number(windSeed);
  const initialWindSeed = Math.max(
    0,
    Math.floor(Number.isFinite(configuredWindSeed) ? configuredWindSeed : (Date.now() % 1_000_000)),
  );

  const runtime = {
    commandPhase: "idle",
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
    moonCoastTrimPending: false,
    moonCoastTrimActiveUntilSec: null,
    moonCoastTrimLastBurnSec: null,
    missionPhaseGateReason: "",
    lastTrackedPositionKm: null,
    lastSurfaceSample: null,
    windSeed: initialWindSeed,
    stageActuator: createActuatorState({ x: 0, y: 0, z: 1 }),
    stageMassModel: createMassModelState(),
    boosterActuator: createActuatorState({ x: 0, y: 0, z: 1 }),
    boosterMassModel: createMassModelState(),
    attachedJoint: createAttachedStackJointState(),
    guidanceAdvisory: createGuidanceAdvisoryState(),
    stage2RefuelRecoveryApplied: false,
    mission: {
      selectedId: DEFAULT_LAUNCH_MISSION_ID,
      phase: defaultMissionPhaseForProfileId(DEFAULT_LAUNCH_MISSION_ID),
      phaseStartedElapsedSec: 0,
      completed: false,
    },
    pendingMissionPhase: createPendingMissionPhaseState(),
    booster: {
      attached: true,
      active: false,
      commandPhase: "idle",
      phase: "idle",
      guidanceMode: "booster-idle",
      attitude: createBoosterAttitudeState({ x: 0, y: 0, z: 1 }),
      propellantKg: 0,
      initialPropellantKg: 0,
      separationTimeSec: 0,
      landed: false,
      lastStep: null,
      lastSurfaceSample: null,
      lastTrackedPositionKm: null,
      telemetry: null,
      contactHoldSec: 0,
      catchAlignHoldSec: 0,
      navigation: createBoosterNavigationState(),
    },
    refuel: refuelDefaults({
      targetPropellantKg: stage2PropellantCapacityKg(DEFAULT_LAUNCH_MISSION_ID),
    }),
    fleet: {
      nextShipSequence: 1,
      vehicles: new Map(),
    },
    moonOrbitInjectSolve: {
      key: "",
      pending: null,
      solution: null,
      error: "",
      pendingStartedAtMs: 0,
      source: "",
      searchProfile: "",
      nodeSamples: 0,
    },
    hotstage: createHotstageState(),
    pendingStageTransition: createPendingStageTransitionState(),
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

  function unitVectorOrNull(value) {
    if (!finiteVector(value)) {
      return null;
    }
    const magnitude = length(value);
    if (!Number.isFinite(magnitude) || magnitude <= 1e-9) {
      return null;
    }
    return scale(value, 1 / magnitude);
  }

  function alignmentAngleDeg(alignment) {
    if (!Number.isFinite(Number(alignment))) {
      return null;
    }
    return Math.acos(clamp(Number(alignment), -1, 1)) * (180 / Math.PI);
  }

  function classifyDirectionalState(alignment, positiveLabel, negativeLabel, neutralLabel = "sideways") {
    if (!Number.isFinite(Number(alignment))) {
      return "n/a";
    }
    if (alignment >= 0.35) {
      return positiveLabel;
    }
    if (alignment <= -0.35) {
      return negativeLabel;
    }
    return neutralLabel;
  }

  function resolveRelativeDirectionTelemetry(state, bodyId = LAUNCH_BODY_ID) {
    const bodyState = state?.dynamicBodies?.get?.(bodyId) || null;
    const earthState = earthStateFromNBody?.(state);
    if (
      !bodyState
      || !earthState
      || !finiteVector(bodyState.position)
      || !finiteVector(bodyState.velocity || { x: 0, y: 0, z: 0 })
      || !finiteVector(earthState.position)
      || !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      return {
        earthDistanceKm: null,
        earthRelativeSpeedKmS: null,
        earthRadialSpeedKmS: null,
        earthDirectionState: "n/a",
        earthDirectionAlignment: null,
        earthDirectionAngleDeg: null,
        earthRelativePositionKm: null,
        moonDirectionState: "n/a",
        moonDirectionAlignment: null,
        moonDirectionAngleDeg: null,
        moonRelativePositionKm: null,
      };
    }

    const relPos = subtract(bodyState.position, earthState.position);
    const relVel = subtract(
      bodyState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    const earthDistanceKm = length(relPos);
    const earthRelativeSpeedKmS = length(relVel);
    const earthRadialSpeedKmS = earthDistanceKm > 1e-9
      ? dot(relPos, relVel) / earthDistanceKm
      : null;
    const earthOutwardUnit = unitVectorOrNull(relPos);
    const earthVelocityUnit = unitVectorOrNull(relVel);
    const earthDirectionAlignment = earthOutwardUnit && earthVelocityUnit
      ? clamp(dot(earthVelocityUnit, earthOutwardUnit), -1, 1)
      : null;
    const earthDirectionAngleDeg = alignmentAngleDeg(earthDirectionAlignment);
    const earthDirectionState = classifyDirectionalState(
      earthDirectionAlignment,
      "outbound",
      "inbound",
      "crossrange",
    );

    const moonState = bodyStateFromNBody(state, "moon");
    let moonDirectionState = "n/a";
    let moonDirectionAlignment = null;
    let moonDirectionAngleDeg = null;
    let moonRelativePositionKm = null;
    if (
      moonState
      && finiteVector(moonState.position)
      && finiteVector(moonState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      const moonRelPos = subtract(bodyState.position, moonState.position);
      const moonRelVel = subtract(
        bodyState.velocity || { x: 0, y: 0, z: 0 },
        moonState.velocity || { x: 0, y: 0, z: 0 },
      );
      moonRelativePositionKm = cloneVectorOrNull(scale(moonRelPos, -1));
      const towardMoonUnit = unitVectorOrNull(scale(moonRelPos, -1));
      const moonVelocityUnit = unitVectorOrNull(moonRelVel);
      moonDirectionAlignment = towardMoonUnit && moonVelocityUnit
        ? clamp(dot(moonVelocityUnit, towardMoonUnit), -1, 1)
        : null;
      moonDirectionAngleDeg = alignmentAngleDeg(moonDirectionAlignment);
      moonDirectionState = classifyDirectionalState(
        moonDirectionAlignment,
        "toward",
        "away",
        "sideways",
      );
    }

    return {
      earthDistanceKm: finiteOrNull(earthDistanceKm),
      earthRelativeSpeedKmS: finiteOrNull(earthRelativeSpeedKmS),
      earthRadialSpeedKmS: finiteOrNull(earthRadialSpeedKmS),
      earthDirectionState,
      earthDirectionAlignment: finiteOrNull(earthDirectionAlignment),
      earthDirectionAngleDeg: finiteOrNull(earthDirectionAngleDeg),
      earthRelativePositionKm: cloneVectorOrNull(scale(relPos, -1)),
      moonDirectionState,
      moonDirectionAlignment: finiteOrNull(moonDirectionAlignment),
      moonDirectionAngleDeg: finiteOrNull(moonDirectionAngleDeg),
      moonRelativePositionKm,
    };
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
      phase: telemetry.phase,
      commandPhase: telemetry.commandPhase,
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
    const vehiclePhase = reportedLaunchPhase(
      currentLaunchCommandPhase(),
      runtime.lastTelemetry,
      runtime.lastStep,
      runtime.targetOrbitAltitudeKm,
    );
    const boosterPhase = reportedBoosterPhase(runtime.booster.telemetry, runtime.booster);
    const detailPhase = Object.prototype.hasOwnProperty.call(details || {}, "phase")
      ? details.phase
      : undefined;
    const payloadDetails = detailPhase === undefined
      ? details
      : { ...details, detailPhase };
    const payload = {
      timestampUtc: new Date().toISOString(),
      name,
      elapsedSeconds: Number(runtime.elapsedSeconds) || 0,
      stageIndex: runtime.stageIndex,
      stageName: stageAtIndex(runtime.stageIndex)?.name || "Coast/Complete",
      missionId: runtime.mission.selectedId,
      missionPhase: runtime.mission.phase,
      ...payloadDetails,
      phase: vehiclePhase,
      commandPhase: currentLaunchCommandPhase(),
      boosterPhase,
      boosterCommandPhase: currentBoosterCommandPhase(),
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
    const vehiclePhase = reportedLaunchPhase(
      currentLaunchCommandPhase(),
      runtime.lastTelemetry,
      runtime.lastStep,
      runtime.targetOrbitAltitudeKm,
    );
    const boosterPhase = reportedBoosterPhase(runtime.booster.telemetry, runtime.booster);
    const detailPhase = Object.prototype.hasOwnProperty.call(details || {}, "phase")
      ? details.phase
      : undefined;
    const payloadDetails = detailPhase === undefined
      ? details
      : { ...details, detailPhase };
    const payload = {
      timestampUtc: new Date().toISOString(),
      name,
      severity: "error",
      elapsedSeconds: Number(runtime.elapsedSeconds) || 0,
      stageIndex: runtime.stageIndex,
      stageName: stageAtIndex(runtime.stageIndex)?.name || "Coast/Complete",
      missionId: runtime.mission.selectedId,
      missionPhase: runtime.mission.phase,
      ...payloadDetails,
      phase: vehiclePhase,
      commandPhase: currentLaunchCommandPhase(),
      boosterPhase,
      boosterCommandPhase: currentBoosterCommandPhase(),
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
    sampleLaunchWeather,
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
    const missionPhase = canonicalMoonMissionPhase(phase);
    if (missionPhase === NAVIGATION_MISSION_PHASES.LAUNCH) {
      return `Awaiting parking orbit gate: apo/peri near ${formatGateKm(profile.parkingOrbitApoapsisMinKm)} / ${formatGateKm(profile.parkingOrbitPeriapsisMinKm)} (tol ${formatGateKm(MOON_PARKING_ORBIT_GATE_TOLERANCE_KM.apoapsisKm)} / ${formatGateKm(MOON_PARKING_ORBIT_GATE_TOLERANCE_KM.periapsisKm)}).`;
    }
    if (missionPhase === NAVIGATION_MISSION_PHASES.PARKING_ORBIT) {
      return "Parking orbit established. Verifying stable departure setup.";
    }
    if (missionPhase === NAVIGATION_MISSION_PHASES.DEPARTURE_WINDOW_WAIT) {
      return `Awaiting departure window: parking coast ${Math.round(Math.max(0, Number(profile.parkingCoastMinDurationSec) - Math.max(0, Number(missionElapsedInPhaseSec) || 0)))}s minimum, fill ${formatGatePercent(refuelFillFraction)}.`;
    }
    if (missionPhase === NAVIGATION_MISSION_PHASES.TLI_BURN) {
      return `Awaiting TLI gate: apo >= ${formatGateKm(profile.tliTargetApoapsisKm - profile.tliApoapsisMarginKm)}, miss <= ${formatGateKm(profile.tliInterceptMissDistanceKm)}.`;
    }
    if (missionPhase === NAVIGATION_MISSION_PHASES.MIDCOURSE) {
      return `Awaiting lunar approach: distance ${formatGateKm(moonDistanceKm)} <= ${formatGateKm(profile.moonApproachDistanceKm)} (closing ${formatGateSpeed(moonClosingSpeedKmS)}, miss ${formatGateKm(moonProjectedMissDistanceKm)}).`;
    }
    if (missionPhase === NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_INSERTION) {
      return `Awaiting lunar capture: altitude ${formatGateKm(moonAltitudeKm)} | periapsis est ${formatGateKm(moonProjectedPeriluneAltitudeKm)} | B-plane ${formatGateKm(moonBPlaneErrorKm)}.`;
    }
    if (missionPhase === NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_TRIM) {
      return `Trimming lunar orbit: apo/peri settling toward ${formatGateKm(profile.lunarOrbitApoapsisMaxKm)} / ${formatGateKm(profile.lunarOrbitPeriapsisMinKm)}.`;
    }
    if (missionPhase === NAVIGATION_MISSION_PHASES.LUNAR_LOITER) {
      const remainingSec = Math.max(0, Number(profile.lunarHoldDurationSec) - Math.max(0, Number(missionElapsedInPhaseSec) || 0));
      return `Holding lunar orbit: TEI unlock in ${Math.round(remainingSec)}s.`;
    }
    if (missionPhase === NAVIGATION_MISSION_PHASES.TEI_BURN) {
      return `Awaiting TEI departure: moon distance ${formatGateKm(moonDistanceKm)} >= ${formatGateKm(profile.teiDepartureDistanceKm)} and Earth radial < 0 (${formatGateSpeed(earthRadialSpeedKmS)}).`;
    }
    if (missionPhase === NAVIGATION_MISSION_PHASES.EARTH_APPROACH) {
      return `Awaiting Earth capture approach: Earth distance ${formatGateKm(earthDistanceKm)} <= ${formatGateKm(profile.earthCaptureDistanceKm)}.`;
    }
    if (missionPhase === NAVIGATION_MISSION_PHASES.EARTH_CAPTURE) {
      return `Awaiting Earth capture orbit: apo/peri <= ${formatGateKm(profile.earthCaptureApoapsisMaxKm)} / >= ${formatGateKm(profile.earthCapturePeriapsisMinKm)}.`;
    }
    if (missionPhase === NAVIGATION_MISSION_PHASES.EARTH_ORBIT_HOLD) {
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
    const stagePropellantKg = Math.max(0, Number(runtime.stagePropellantKg) || 0);
    const stageDryMassKg = Math.max(
      1,
      Number(activeStage?.dryMassKg) || Math.max(1, stageMassKg - stagePropellantKg),
    );
    const activeStageThrustBounds = configuredThrustBoundsN(activeStage);
    const activeStageThrustVacuumN = Math.max(0, Number(activeStageThrustBounds.thrustVacuumN) || 0);
    const activeStageThrustSeaLevelN = Math.max(
      0,
      Number(activeStageThrustBounds.thrustSeaLevelN) || activeStageThrustVacuumN,
    );
    const engineAccelAtThrottle1KmS2 = (
      activeStageThrustVacuumN > 0
      && stageMassKg > 0
    )
      ? ((activeStageThrustVacuumN / stageMassKg) / 1000)
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
        stagePropellantKg,
        stageDryMassKg,
        stageThrustVacuumN: activeStageThrustVacuumN,
        stageThrustSeaLevelN: activeStageThrustSeaLevelN,
        stageIspVacuumS: Math.max(0, Number(activeStage?.ispVacuumS) || 0),
        stageIspSeaLevelS: Math.max(
          0,
          Number(activeStage?.ispSeaLevelS) || Number(activeStage?.ispVacuumS) || 0,
        ),
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
    reconcileMissionPhaseAdvisory({
      requestedPhase: navPhase,
      source: "navigation-system",
      reason: navPhaseDecisionReason || "planner-phase-update",
      missionCompleted: Boolean(navState?.missionCompleted),
    });
    const navDrivenMoonPhases = new Set([
      NAVIGATION_MISSION_PHASES.TLI_BURN,
      NAVIGATION_MISSION_PHASES.MIDCOURSE,
      NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_INSERTION,
      NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_TRIM,
      NAVIGATION_MISSION_PHASES.LUNAR_LOITER,
      NAVIGATION_MISSION_PHASES.TEI_BURN,
      NAVIGATION_MISSION_PHASES.EARTH_APPROACH,
      NAVIGATION_MISSION_PHASES.EARTH_CAPTURE,
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
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371.0084,
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
    const vehiclePhase = reportedLaunchPhase(
      currentLaunchCommandPhase(),
      runtime.lastTelemetry,
      runtime.lastStep,
      runtime.targetOrbitAltitudeKm,
    );
    const boosterPhase = reportedBoosterPhase(runtime.booster.telemetry, runtime.booster);
    return {
      phase: vehiclePhase,
      commandPhase: currentLaunchCommandPhase(),
      stageIndex: runtime.stageIndex,
      missionPhase: runtime.mission.phase,
      missionCompleted: Boolean(runtime.mission.completed),
      boosterActive: Boolean(runtime.booster.active),
      boosterPhase,
      boosterCommandPhase: currentBoosterCommandPhase(),
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

  function launchEnvironmentSample(relPos, currentEarthAxes, earthRadiusKm, nowMs, windSeed = runtime.windSeed) {
    const surfaceSample = sampleEarthSurfaceAtRelativePosition(
      relPos,
      currentEarthAxes,
      earthRadiusKm,
      { includeTerrain: true },
    );
    const surfaceAltitudeKm = Number(surfaceSample?.altitudeAboveTerrainKm);
    const altitudeKm = Number.isFinite(surfaceAltitudeKm)
      ? Math.max(0, surfaceAltitudeKm)
      : Math.max(0, length(relPos) - earthRadiusKm);
    const latitudeDeg = Number.isFinite(Number(surfaceSample?.geodeticLatitudeDeg))
      ? Number(surfaceSample.geodeticLatitudeDeg)
      : (Number(surfaceSample?.latitudeDeg) || 0);
    const longitudeDeg = Number.isFinite(Number(surfaceSample?.longitudeDeg))
      ? Number(surfaceSample.longitudeDeg)
      : 0;
    const atmosphereContext = {
      timestampMs: nowMs,
      latitudeDeg,
      longitudeDeg,
      relativePositionKm: relPos,
      earthAxes: currentEarthAxes,
      earthPole: currentEarthAxes?.pole,
    };
    const launchWeatherSample = sampleLaunchWeather?.({
      timestampMs: nowMs,
      altitudeKm,
      latitudeDeg,
      longitudeDeg,
      relativePositionKm: relPos,
      earthAxes: currentEarthAxes,
      earthPole: currentEarthAxes?.pole,
    }) || null;
    return {
      altitudeKm,
      surfaceSample,
      atmosphereSample: sampleEarthAtmosphere?.(altitudeKm, atmosphereContext) || null,
      windSample: sampleWindVectorKmS({
        altitudeKm,
        relPos,
        earthPole: currentEarthAxes?.pole,
        earthAxes: currentEarthAxes,
        timestampMs: nowMs,
        elapsedSeconds: runtime.elapsedSeconds,
        seed: windSeed,
        surfaceWindEastMS: launchWeatherSample?.windEastMS ?? null,
        surfaceWindNorthMS: launchWeatherSample?.windNorthMS ?? null,
      }),
    };
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

  function currentLaunchCommandPhase() {
    return String(runtime.commandPhase || runtime.phase || "idle");
  }

  function setLaunchCommandPhase(nextPhase = "idle") {
    const normalized = String(nextPhase || "idle");
    runtime.commandPhase = normalized;
    runtime.phase = normalized;
    return normalized;
  }

  function currentBoosterCommandPhase() {
    return String(runtime.booster?.commandPhase || runtime.booster?.phase || "idle");
  }

  function setBoosterCommandPhase(nextPhase = "idle") {
    const normalized = String(nextPhase || "idle");
    runtime.booster.commandPhase = normalized;
    runtime.booster.phase = normalized;
    return normalized;
  }

  function currentLaunchVehiclePhase() {
    return reportedLaunchPhase(
      currentLaunchCommandPhase(),
      runtime.lastTelemetry,
      runtime.lastStep,
      runtime.targetOrbitAltitudeKm,
    );
  }

  function resolvedLaunchVehicleAltitudeAboveTerrainKm(fallbackAltitudeKm = null) {
    const centerAltitudeAboveTerrainKm = Number(runtime.lastSurfaceSample?.altitudeAboveTerrainKm);
    if (Number.isFinite(centerAltitudeAboveTerrainKm)) {
      return Math.max(0, centerAltitudeAboveTerrainKm - STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM);
    }
    const numericFallback = Number(fallbackAltitudeKm);
    return Number.isFinite(numericFallback) ? Math.max(0, numericFallback) : null;
  }

  function launchVehiclePhaseFromKinematics({
    earthState,
    rocketState,
    earthRadiusKm,
    earthPole,
    orbital = null,
    altitudeAboveTerrainKm = null,
  } = {}) {
    if (
      !earthState
      || !rocketState
      || !finiteVector(earthState.position)
      || !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 })
      || !finiteVector(rocketState.position)
      || !finiteVector(rocketState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      return currentLaunchVehiclePhase();
    }
    const relPos = subtract(rocketState.position, earthState.position);
    const relVel = subtract(
      rocketState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    const muKm3S2 = gravitationalConstantKm3PerKgS2 * (Number(getEarthMassKg?.()) || 0);
    const resolvedOrbital = orbital || orbitalStateFromRelative(muKm3S2, earthRadiusKm, relPos, relVel);
    return deriveStarshipVehiclePhase({
      telemetry: {
        altitudeKm: finiteOrNull(resolvedOrbital?.altitudeKm),
        altitudeAboveTerrainKm: finiteOrNull(
          Number.isFinite(Number(altitudeAboveTerrainKm))
            ? Number(altitudeAboveTerrainKm)
            : resolvedLaunchVehicleAltitudeAboveTerrainKm(resolvedOrbital?.altitudeKm),
        ),
        groundRelativeSpeedKmS: length(atmosphereRelativeVelocityKmS(
          relPos,
          relVel,
          earthPole || { x: 0, y: 0, z: 1 },
        )),
        speedKmS: finiteOrNull(resolvedOrbital?.speedKmS),
        apoapsisKm: finiteOrNull(resolvedOrbital?.apoapsisKm),
        periapsisKm: finiteOrNull(resolvedOrbital?.periapsisKm),
        targetOrbitAltitudeKm: runtime.targetOrbitAltitudeKm,
        throttle: runtime.lastStep?.throttle || 0,
        thrustN: runtime.lastStep?.thrustN || 0,
      },
      runtimePhase: currentLaunchCommandPhase(),
      lastStep: runtime.lastStep,
      targetOrbitAltitudeKm: runtime.targetOrbitAltitudeKm,
    });
  }

  function requestPendingStageTransition({
    kind = "",
    fromStageIndex = 0,
    toStageIndex = null,
    requestReason = "",
    reservePropellantKg = 0,
    altitudeKm = null,
    groundRelativeSpeedKmS = null,
    dynamicPressurePa = null,
  } = {}) {
    const transition = resetPendingStageTransition(runtime.pendingStageTransition);
    transition.active = true;
    transition.kind = String(kind || "");
    transition.fromStageIndex = Math.max(0, Math.floor(Number(fromStageIndex) || 0));
    transition.toStageIndex = (toStageIndex !== null && toStageIndex !== undefined && Number.isFinite(Number(toStageIndex)))
      ? Math.max(0, Math.floor(Number(toStageIndex)))
      : null;
    transition.requestedAtElapsedSec = Math.max(0, Number(runtime.elapsedSeconds) || 0);
    transition.requestReason = String(requestReason || "");
    transition.reservePropellantKg = Math.max(0, Number(reservePropellantKg) || 0);
    transition.requestAltitudeKm = Number.isFinite(Number(altitudeKm)) ? Number(altitudeKm) : null;
    transition.requestGroundRelativeSpeedKmS = Number.isFinite(Number(groundRelativeSpeedKmS))
      ? Number(groundRelativeSpeedKmS)
      : null;
    transition.requestDynamicPressurePa = Number.isFinite(Number(dynamicPressurePa))
      ? Number(dynamicPressurePa)
      : null;
    return transition;
  }

  function evaluatePendingStageTransitionAuthorization({
    earthState,
    rocketState,
    earthRadiusKm,
    earthPole,
    orbital = null,
    dynamicPressurePa = null,
  } = {}) {
    const pending = runtime.pendingStageTransition;
    if (!pending?.active) {
      return { authorized: false, waitReason: "inactive" };
    }
    if (
      pending.fromStageIndex !== runtime.stageIndex
      || (runtime.hotstage.active && pending.kind !== "hotstage_ignite")
    ) {
      pending.waitReason = "stale_request";
      pending.authorizationMode = "";
      return { authorized: false, waitReason: pending.waitReason };
    }
    if (
      !earthState
      || !rocketState
      || !finiteVector(earthState.position)
      || !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 })
      || !finiteVector(rocketState.position)
      || !finiteVector(rocketState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      pending.waitReason = "state_unavailable";
      pending.authorizationMode = "";
      return { authorized: false, waitReason: pending.waitReason };
    }
    const relPos = subtract(rocketState.position, earthState.position);
    const relVel = subtract(
      rocketState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    const resolvedOrbital = orbital || orbitalStateFromRelative(
      gravitationalConstantKm3PerKgS2 * (Number(getEarthMassKg?.()) || 0),
      earthRadiusKm,
      relPos,
      relVel,
    );
    const groundRelativeSpeedKmS = length(atmosphereRelativeVelocityKmS(
      relPos,
      relVel,
      earthPole || { x: 0, y: 0, z: 1 },
    ));
    const altitudeAboveTerrainKm = resolvedLaunchVehicleAltitudeAboveTerrainKm(resolvedOrbital?.altitudeKm);
    const altitudeMetricKm = Number.isFinite(Number(altitudeAboveTerrainKm))
      ? Number(altitudeAboveTerrainKm)
      : Math.max(0, Number(resolvedOrbital?.altitudeKm) || 0);
    const stableOrbit = Number(resolvedOrbital?.specificEnergy) < 0 && Number(resolvedOrbital?.periapsisKm) > 80;
    const airborne = altitudeMetricKm > 0.25 || groundRelativeSpeedKmS > 0.05;
    const requestAgeSec = Math.max(
      0,
      (Number(runtime.elapsedSeconds) || 0) - (Number(pending.requestedAtElapsedSec) || 0),
    );
    const dynamicPressureMetricPa = Number.isFinite(Number(dynamicPressurePa))
      ? Number(dynamicPressurePa)
      : Number(pending.requestDynamicPressurePa);
    const burnInactive = (
      (Number(runtime.lastStep?.throttle) || 0) <= 1e-3
      && (Number(runtime.lastStep?.thrustN) || 0) <= 1
    );

    if (pending.kind === "hotstage_ignite") {
      const hotstageEnvelope = evaluateHotstageRealismEnvelope(
        runtime,
        rocketState,
        earthState,
        earthRadiusKm,
      );
      const lowDynamicPressure = (
        !Number.isFinite(dynamicPressureMetricPa)
        || dynamicPressureMetricPa <= 145_000
      );
      const nominalEnvelopeSatisfied = airborne
        && groundRelativeSpeedKmS > 0.10
        && hotstageEnvelope.withinEnvelope;
      const failsafeSatisfied = airborne
        && altitudeMetricKm > 20
        && lowDynamicPressure
        && requestAgeSec >= 2.5;
      const authorizationMode = nominalEnvelopeSatisfied
        ? "nominal-envelope"
        : (failsafeSatisfied ? "failsafe-low-q" : "");
      const waitReason = authorizationMode
        ? ""
        : (
          !airborne
            ? "vehicle_not_airborne"
            : (!hotstageEnvelope.withinEnvelope ? "outside_hotstage_envelope" : "dynamic_pressure_high")
        );
      pending.waitReason = waitReason;
      pending.authorizationMode = authorizationMode;
      return {
        authorized: Boolean(authorizationMode),
        authorizationMode,
        waitReason,
        requestAgeSec,
        altitudeAboveTerrainKm: altitudeMetricKm,
        groundRelativeSpeedKmS,
        hotstageEnvelope,
        stableOrbit,
      };
    }

    if (pending.kind === "next_stage_separation") {
      const lowDynamicPressure = (
        !Number.isFinite(dynamicPressureMetricPa)
        || dynamicPressureMetricPa <= 80_000
      );
      const nominalAuthorized = burnInactive
        && airborne
        && (stableOrbit || (altitudeMetricKm > 25 && lowDynamicPressure));
      const failsafeAuthorized = burnInactive
        && altitudeMetricKm > 10
        && requestAgeSec >= 0.75;
      const authorizationMode = nominalAuthorized
        ? "nominal-low-q"
        : (failsafeAuthorized ? "failsafe-burnout" : "");
      const waitReason = authorizationMode
        ? ""
        : (
          !burnInactive
            ? "burn_still_active"
            : (!airborne ? "vehicle_not_airborne" : "waiting_for_low_q_or_altitude")
        );
      pending.waitReason = waitReason;
      pending.authorizationMode = authorizationMode;
      return {
        authorized: Boolean(authorizationMode),
        authorizationMode,
        waitReason,
        requestAgeSec,
        altitudeAboveTerrainKm: altitudeMetricKm,
        groundRelativeSpeedKmS,
        stableOrbit,
      };
    }

    pending.waitReason = "unknown_transition_kind";
    pending.authorizationMode = "";
    return {
      authorized: false,
      waitReason: pending.waitReason,
      requestAgeSec,
      altitudeAboveTerrainKm: altitudeMetricKm,
      groundRelativeSpeedKmS,
      stableOrbit,
    };
  }

  function applyAuthorizedPendingStageTransition({
    state,
    rocketState,
    earthState,
    currentEarthAxes,
    earthRadiusKm,
    authorization = null,
  } = {}) {
    const pending = runtime.pendingStageTransition;
    if (!pending?.active || !rocketState || !earthState) {
      return false;
    }
    const currentStage = stageAtIndex(runtime.stageIndex);
    if (!currentStage || pending.fromStageIndex !== runtime.stageIndex) {
      resetPendingStageTransition(runtime.pendingStageTransition);
      return false;
    }
    const relPos = subtract(rocketState.position, earthState.position);
    const relVel = subtract(
      rocketState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );

    emitLaunchEvent("stage_transition_authorized", {
      transitionKind: pending.kind,
      fromStageIndex: pending.fromStageIndex,
      toStageIndex: pending.toStageIndex,
      requestReason: pending.requestReason,
      authorizationMode: authorization?.authorizationMode || "",
      requestAgeSec: Number(authorization?.requestAgeSec) || 0,
      altitudeAboveTerrainKm: Number.isFinite(Number(authorization?.altitudeAboveTerrainKm))
        ? Number(authorization.altitudeAboveTerrainKm)
        : pending.requestAltitudeKm,
      groundRelativeSpeedKmS: Number.isFinite(Number(authorization?.groundRelativeSpeedKmS))
        ? Number(authorization.groundRelativeSpeedKmS)
        : pending.requestGroundRelativeSpeedKmS,
    });

    if (pending.kind === "hotstage_ignite") {
      const hotstageEnvelope = authorization?.hotstageEnvelope || evaluateHotstageRealismEnvelope(
        runtime,
        rocketState,
        earthState,
        earthRadiusKm,
      );
      runtime.hotstage = startHotstageSequence(runtime.hotstage, {
        elapsedSeconds: runtime.elapsedSeconds,
        boosterReservePropellantKg: pending.reservePropellantKg,
        overlapSeconds: hotstageOverlapSeconds(),
      });
      runtime.stageIndex = Math.max(1, Number(pending.toStageIndex) || 1);
      runtime.stagePropellantKg = surfaceLaunchStagePropellantCapacityKgForMissionStage(
        runtime.stageIndex,
        runtime.mission.selectedId,
      );
      runtime.coastRemainingSec = 0;
      setLaunchCommandPhase("powered");
      runtime.stageActuator = createActuatorState(normalize(
        runtime.lastStep?.bodyAxisDirectionKm
          || runtime.stageActuator?.directionActual
          || relPos,
        currentEarthAxes.pole,
      ));
      runtime.stageMassModel = createMassModelState();
      runtime.lastStep = {
        ...(runtime.lastStep && typeof runtime.lastStep === "object" ? runtime.lastStep : {}),
        accelerationKmS2: { x: 0, y: 0, z: 0 },
        thrustAccelerationKmS2: { x: 0, y: 0, z: 0 },
        throttle: 0,
        throttleCommand: 0,
        thrustN: 0,
        burnKg: 0,
        burnRateKgS: 0,
        guidanceMode: "stage-transition:hotstage-authorized",
      };
      emitLaunchEvent("hotstage_ignition", {
        transitionAuthorizationMode: authorization?.authorizationMode || "",
        boosterReservePropellantKg: pending.reservePropellantKg,
        overlapSeconds: runtime.hotstage.overlapSeconds,
        elapsedSec: hotstageEnvelope.elapsedSec,
        altitudeKm: hotstageEnvelope.altitudeKm,
        speedKmS: hotstageEnvelope.speedKmS,
        nominalElapsedSec: hotstageEnvelope.nominalElapsedSec,
        nominalAltitudeKm: hotstageEnvelope.nominalAltitudeKm,
        nominalSpeedKmS: hotstageEnvelope.nominalSpeedKmS,
        realismEnvelopeSatisfied: hotstageEnvelope.withinEnvelope,
      });
      resetPendingStageTransition(runtime.pendingStageTransition);
      return true;
    }

    if (pending.kind === "next_stage_separation") {
      const nextStageIndex = Math.max(runtime.stageIndex + 1, Number(pending.toStageIndex) || (runtime.stageIndex + 1));
      const nextStage = stageAtIndex(nextStageIndex);
      if (!nextStage) {
        resetPendingStageTransition(runtime.pendingStageTransition);
        return false;
      }
      rocketState.massKg = Math.max(
        MIN_ROCKET_MASS_KG,
        rocketState.massKg - (Number(currentStage.dryMassKg) || 0),
      );
      runtime.stageIndex = nextStageIndex;
      runtime.stagePropellantKg = stagePropellantCapacityKgForMissionStage(
        runtime.stageIndex,
        runtime.mission.selectedId,
      );
      runtime.coastRemainingSec = Math.max(0, Number(currentStage.coastAfterBurnSec) || 0);
      setLaunchCommandPhase(runtime.coastRemainingSec > 0 ? "coast" : "powered");
      runtime.stageActuator = createActuatorState(
        normalize(relPos, currentEarthAxes.pole),
      );
      runtime.stageMassModel = createMassModelState();
      runtime.lastStep = {
        ...(runtime.lastStep && typeof runtime.lastStep === "object" ? runtime.lastStep : {}),
        accelerationKmS2: { x: 0, y: 0, z: 0 },
        thrustAccelerationKmS2: { x: 0, y: 0, z: 0 },
        throttle: 0,
        throttleCommand: 0,
        thrustN: 0,
        burnKg: 0,
        burnRateKgS: 0,
        guidanceMode: "stage-transition:stage-separated",
      };
      resetPendingStageTransition(runtime.pendingStageTransition);
      return true;
    }

    resetPendingStageTransition(runtime.pendingStageTransition);
    return false;
  }

  function setGuidanceAdvisory({
    source = "",
    requestedPhase = "idle",
    resolvedPhase = "idle",
    requestedThrottle = 0,
    requestedMode = "",
    reason = "",
  } = {}) {
    const advisory = runtime.guidanceAdvisory && typeof runtime.guidanceAdvisory === "object"
      ? runtime.guidanceAdvisory
      : createGuidanceAdvisoryState();
    advisory.source = String(source || "");
    advisory.requestedPhase = String(requestedPhase || "idle");
    advisory.resolvedPhase = String(resolvedPhase || advisory.requestedPhase || "idle");
    advisory.requestedThrottle = clamp(Number(requestedThrottle) || 0, 0, 1);
    advisory.requestedMode = String(requestedMode || "");
    advisory.reason = String(reason || "");
    advisory.updatedAtElapsedSec = Math.max(0, Number(runtime.elapsedSeconds) || 0);
    runtime.guidanceAdvisory = advisory;
    return advisory;
  }

  function resolveLaunchCommandPhaseFromGuidanceAdvisory({
    requestedPhase = "",
    requestedThrottle = 0,
    throttleActual = 0,
    canThrust = false,
    passiveVehiclePhase = "coast",
    moonTransferMissionActive = false,
  } = {}) {
    const normalizedRequestedPhase = String(requestedPhase || "").trim().toLowerCase();
    const requestedThrottleNumeric = clamp(Number(requestedThrottle) || 0, 0, 1);
    const throttleActualNumeric = clamp(Number(throttleActual) || 0, 0, 1);
    if (
      passiveVehiclePhase === "orbit"
      && normalizedRequestedPhase === "orbit"
      && !moonTransferMissionActive
    ) {
      return "orbit";
    }
    if (
      throttleActualNumeric > 1e-3
      || (canThrust && requestedThrottleNumeric > 1e-3)
      || normalizedRequestedPhase === "powered"
    ) {
      return "powered";
    }
    if (normalizedRequestedPhase === "idle" && passiveVehiclePhase === "idle") {
      return "idle";
    }
    if (passiveVehiclePhase === "orbit" && !moonTransferMissionActive) {
      return "orbit";
    }
    return "coast";
  }

  function requestPendingMissionPhaseAdvisory({
    nextPhase = "",
    source = "",
    reason = "",
  } = {}) {
    const normalizedPhase = String(nextPhase || "").trim();
    if (!normalizedPhase || normalizedPhase === runtime.mission.phase) {
      return resetPendingMissionPhaseState(runtime.pendingMissionPhase);
    }
    const pending = runtime.pendingMissionPhase && typeof runtime.pendingMissionPhase === "object"
      ? runtime.pendingMissionPhase
      : createPendingMissionPhaseState();
    if (!(pending.active && pending.requestedPhase === normalizedPhase)) {
      resetPendingMissionPhaseState(pending);
      pending.active = true;
      pending.requestedPhase = normalizedPhase;
      pending.requestedAtElapsedSec = Math.max(0, Number(runtime.elapsedSeconds) || 0);
    }
    pending.source = String(source || "");
    pending.reason = String(reason || "");
    runtime.pendingMissionPhase = pending;
    return pending;
  }

  function reconcileMissionPhaseAdvisory({
    requestedPhase = "",
    source = "",
    reason = "",
    missionCompleted = false,
  } = {}) {
    const normalizedRequestedPhase = String(requestedPhase || "").trim();
    if (!normalizedRequestedPhase) {
      resetPendingMissionPhaseState(runtime.pendingMissionPhase);
      return {
        phase: runtime.mission.phase,
        completed: runtime.mission.completed,
        pending: false,
        authorizationMode: "",
      };
    }
    if (normalizedRequestedPhase === runtime.mission.phase) {
      resetPendingMissionPhaseState(runtime.pendingMissionPhase);
      runtime.mission.completed = Boolean(missionCompleted);
      return {
        phase: runtime.mission.phase,
        completed: runtime.mission.completed,
        pending: false,
        authorizationMode: "phase-already-current",
      };
    }
    const pending = requestPendingMissionPhaseAdvisory({
      nextPhase: normalizedRequestedPhase,
      source,
      reason,
    });
    const requestAgeSec = Math.max(
      0,
      (Number(runtime.elapsedSeconds) || 0) - (Number(pending.requestedAtElapsedSec) || 0),
    );
    if (requestAgeSec >= MISSION_PHASE_ADVISORY_HOLD_SEC) {
      pending.authorizationMode = "nav-stable-hold";
      setMissionPhase(runtime, normalizedRequestedPhase);
      runtime.mission.completed = Boolean(missionCompleted);
      resetPendingMissionPhaseState(runtime.pendingMissionPhase);
      return {
        phase: runtime.mission.phase,
        completed: runtime.mission.completed,
        pending: false,
        authorizationMode: "nav-stable-hold",
      };
    }
    pending.authorizationMode = "awaiting-nav-stable-hold";
    runtime.mission.completed = false;
    return {
      phase: runtime.mission.phase,
      completed: runtime.mission.completed,
      pending: true,
      authorizationMode: pending.authorizationMode,
    };
  }

  function resetRuntime() {
    const missionId = normalizeMissionId(runtime.mission.selectedId);
    setLaunchCommandPhase("idle");
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
    runtime.windSeed = initialWindSeed;
    runtime.stageActuator = createActuatorState({ x: 0, y: 0, z: 1 });
    runtime.stageMassModel = createMassModelState();
    runtime.boosterActuator = createActuatorState({ x: 0, y: 0, z: 1 });
    runtime.boosterMassModel = createMassModelState();
    runtime.attachedJoint = createAttachedStackJointState();
    runtime.guidanceAdvisory = resetGuidanceAdvisoryState(runtime.guidanceAdvisory);
    runtime.stage2RefuelRecoveryApplied = false;
    runtime.mission.selectedId = missionId;
    runtime.mission.phase = defaultMissionPhaseForProfileId(missionId);
    runtime.mission.phaseStartedElapsedSec = 0;
    runtime.mission.completed = false;
    runtime.pendingMissionPhase = resetPendingMissionPhaseState(runtime.pendingMissionPhase);
    runtime.booster.active = false;
    runtime.booster.attached = true;
    setBoosterCommandPhase("idle");
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
    runtime.booster.catchAlignHoldSec = 0;
    runtime.booster.navigation = resetBoosterNavigationState(runtime.booster.navigation);
    refuelController.resetRefuelState();
    runtime.hotstage = resetHotstageState(runtime.hotstage);
    runtime.pendingStageTransition = resetPendingStageTransition(runtime.pendingStageTransition);
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
    runtime.booster.attached = true;
    setBoosterCommandPhase("idle");
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
    runtime.booster.catchAlignHoldSec = 0;
    runtime.booster.navigation = resetBoosterNavigationState(runtime.booster.navigation);
    runtime.boosterActuator = createActuatorState({ x: 0, y: 0, z: 1 });
    runtime.boosterMassModel = createMassModelState();
    runtime.attachedJoint = createAttachedStackJointState();
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
    const missionPhase = missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
      ? canonicalMoonMissionPhase(runtime.mission.phase)
      : (runtime.mission.phase || "");
    if (missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
      const moonwardPhases = new Set([
        NAVIGATION_MISSION_PHASES.LAUNCH,
        NAVIGATION_MISSION_PHASES.PARKING_ORBIT,
        NAVIGATION_MISSION_PHASES.DEPARTURE_WINDOW_WAIT,
        NAVIGATION_MISSION_PHASES.TLI_BURN,
        NAVIGATION_MISSION_PHASES.MIDCOURSE,
        NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_INSERTION,
        NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_TRIM,
        NAVIGATION_MISSION_PHASES.LUNAR_LOITER,
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
    const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371.0084;
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

  function buildMoonOrbitInjectLaunchSolvePayload(state, missionId, options = {}) {
    const safeOptions = options && typeof options === "object" ? options : {};
    const normalizedMissionId = normalizeMissionId(missionId);
    const launchMode = String(safeOptions.mode || "pad_launch").trim().toLowerCase() === "orbit_inject"
      ? "orbit_inject"
      : "pad_launch";
    if (
      launchMode !== "orbit_inject"
      || normalizedMissionId !== LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
      || String(safeOptions.vehicleRole || "mission").trim().toLowerCase() === "tanker"
    ) {
      return null;
    }
    const earthState = earthStateFromNBody(state);
    const moonState = bodyStateFromNBody(state, "moon");
    if (
      !earthState
      || !moonState
      || !finiteVector(earthState.position)
      || !finiteVector(moonState.position)
    ) {
      return null;
    }
    const requestedOrbitInjectAltitudeKm = Number(safeOptions.orbitInjectAltitudeKm);
    const orbitAltitudeKm = Number.isFinite(requestedOrbitInjectAltitudeKm)
      ? Math.max(120, requestedOrbitInjectAltitudeKm)
      : MOON_ORBIT_INJECT_ALTITUDE_KM;
    const stage2 = stageAtIndex(1);
    const stage2DryMassKg = Math.max(30_000, Number(stage2?.dryMassKg) || 120_000);
    const stage2PropellantMassKg = Math.max(
      PRIMARY_MOON_MISSION_STAGE2_MIN_PROPELLANT_KG,
      Number(stage2?.propellantMassKg) || 1_200_000,
    );
    const requestedInjectStagePropellantKg = Number(safeOptions.orbitInjectStagePropellantKg);
    const orbitInjectStagePropellantKg = Number.isFinite(requestedInjectStagePropellantKg)
      ? clamp(requestedInjectStagePropellantKg, 0, stage2PropellantMassKg)
      : stage2PropellantMassKg;
    const stage2ThrustBounds = configuredThrustBoundsN(stage2);
    const stage2ThrustVacuumN = Math.max(0, Number(stage2ThrustBounds.thrustVacuumN) || 0);
    const stage2ThrustSeaLevelN = Math.max(0, Number(stage2ThrustBounds.thrustSeaLevelN) || stage2ThrustVacuumN);
    const stage2IspVacuumS = Math.max(1, Number(stage2?.ispVacuumS) || 360);
    const stage2IspSeaLevelS = Math.max(1, Number(stage2?.ispSeaLevelS) || stage2IspVacuumS);
    const spacecraftMassKg = stage2DryMassKg + orbitInjectStagePropellantKg;
    const engineAccelAtThrottle1KmS2 = (
      stage2ThrustVacuumN > 0
      && spacecraftMassKg > 0
    )
      ? ((stage2ThrustVacuumN / spacecraftMassKg) / 1000)
      : null;
    const earthMuKm3S2 = Number(gravitationalConstantKm3PerKgS2)
      * (
        Number(getEarthMassKg?.())
        || Number(earthState.massKg)
        || 0
      );
    const browserRuntime = typeof window !== "undefined";
    const requestedNodeSamples = Number(safeOptions.orbitInjectNodeSamples);
    const requestedSearchProfile = String(safeOptions.orbitInjectSearchProfile || "").trim().toLowerCase();
    const nodeSamples = Number.isFinite(requestedNodeSamples) && requestedNodeSamples > 0
      ? Math.max(1, Math.round(requestedNodeSamples))
      : (
        browserRuntime
          ? MOON_ORBIT_INJECT_BROWSER_LAUNCH_NODE_SAMPLES
          : MOON_ORBIT_INJECT_LAUNCH_NODE_SAMPLES
      );
    const searchProfile = requestedSearchProfile
      || (
        browserRuntime
          ? MOON_ORBIT_INJECT_BROWSER_LAUNCH_SEARCH_PROFILE
          : MOON_ORBIT_INJECT_LAUNCH_SEARCH_PROFILE
      );
    return {
      earthState,
      moonState,
      inclinationDeg: Number(LAUNCH_SITE.latitudeDeg) || 28.5,
      orbitAltitudeKm,
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371.0084,
      earthMuKm3S2,
      engineAccelAtThrottle1KmS2,
      spacecraftMassKg,
      spacecraft: {
        bodyId: "moon_orbit_inject_launch_stage2",
        massKg: spacecraftMassKg,
        dryMassKg: stage2DryMassKg,
        propellantMassKg: orbitInjectStagePropellantKg,
        thrustVacuumN: stage2ThrustVacuumN,
        thrustSeaLevelN: stage2ThrustSeaLevelN,
        ispVacuumS: stage2IspVacuumS,
        ispSeaLevelS: stage2IspSeaLevelS,
        ambientPressurePa: 0,
        radiusKm: 0.0045,
        reflectivityCoeff: 1.45,
      },
      nodeSamples,
      searchProfile,
    };
  }

  function quantizeSolveValue(value, scale = 1) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return "nan";
    }
    return String(Math.round(numeric * scale));
  }

  function moonOrbitInjectLaunchSolveKey(payload = null) {
    if (!payload || typeof payload !== "object") {
      return "";
    }
    const earthState = payload.earthState || {};
    const moonState = payload.moonState || {};
    return [
      quantizeSolveValue(payload.inclinationDeg, 100),
      quantizeSolveValue(payload.orbitAltitudeKm, 10),
      quantizeSolveValue(payload.earthRadiusKm, 10),
      quantizeSolveValue(payload.earthMuKm3S2, 1e-6),
      quantizeSolveValue(payload.engineAccelAtThrottle1KmS2, 1e6),
      quantizeSolveValue(payload.spacecraftMassKg, 1e-2),
      quantizeSolveValue(payload.spacecraft?.dryMassKg, 1e-2),
      quantizeSolveValue(payload.spacecraft?.propellantMassKg, 1e-2),
      quantizeSolveValue(payload.spacecraft?.thrustVacuumN, 1e-4),
      quantizeSolveValue(payload.spacecraft?.thrustSeaLevelN, 1e-4),
      quantizeSolveValue(payload.spacecraft?.ispVacuumS, 1e2),
      quantizeSolveValue(payload.spacecraft?.ispSeaLevelS, 1e2),
      String(payload.searchProfile || ""),
      quantizeSolveValue(payload.nodeSamples, 1),
      quantizeSolveValue(earthState?.position?.x, 1e-3),
      quantizeSolveValue(earthState?.position?.y, 1e-3),
      quantizeSolveValue(earthState?.position?.z, 1e-3),
      quantizeSolveValue(earthState?.velocity?.x, 1e3),
      quantizeSolveValue(earthState?.velocity?.y, 1e3),
      quantizeSolveValue(earthState?.velocity?.z, 1e3),
      quantizeSolveValue(moonState?.position?.x, 1e-3),
      quantizeSolveValue(moonState?.position?.y, 1e-3),
      quantizeSolveValue(moonState?.position?.z, 1e-3),
      quantizeSolveValue(moonState?.velocity?.x, 1e3),
      quantizeSolveValue(moonState?.velocity?.y, 1e3),
      quantizeSolveValue(moonState?.velocity?.z, 1e3),
    ].join("|");
  }

function getCachedMoonOrbitInjectLaunchSolve(payload = null) {
  const key = moonOrbitInjectLaunchSolveKey(payload);
  if (!key || runtime.moonOrbitInjectSolve.key !== key) {
    return null;
  }
  const solution = runtime.moonOrbitInjectSolve.solution || null;
  return (
    solution?.valid
    && solution?.ready
    && solution?.corridorAccepted
  )
    ? solution
    : null;
}

function acceptedMoonOrbitInjectLaunchSolveResponse(response = null) {
  return Boolean(
    response?.solution?.valid
      && response.solution?.ready
      && response.solution?.corridorAccepted,
  );
}

function cacheMoonOrbitInjectLaunchSolveResponse(key, response = null) {
    if (runtime.moonOrbitInjectSolve.key === key) {
      const completedAtMs = Date.now();
      const startedAtMs = Number(runtime.moonOrbitInjectSolve.pendingStartedAtMs) || 0;
      runtime.moonOrbitInjectSolve.pending = null;
      runtime.moonOrbitInjectSolve.solution = response?.solution || null;
      runtime.moonOrbitInjectSolve.error = String(response?.error || "");
      runtime.moonOrbitInjectSolve.pendingStartedAtMs = 0;
      runtime.moonOrbitInjectSolve.lastDurationMs = startedAtMs > 0
        ? Math.max(0, completedAtMs - startedAtMs)
        : 0;
      runtime.moonOrbitInjectSolve.lastCompletedAtMs = completedAtMs;
      runtime.moonOrbitInjectSolve.source = "";
      runtime.moonOrbitInjectSolve.searchProfile = "";
      runtime.moonOrbitInjectSolve.nodeSamples = 0;
    }
    return response;
  }

function solveMoonOrbitInjectLaunchLocally(payload = null) {
  try {
    const solution = solveMoonOrbitInjectWindowForLaunch(payload || {});
    return {
      error: (
        solution?.valid
        && solution?.ready
        && solution?.corridorAccepted
      )
        ? ""
        : "orbit_inject_window_unavailable",
      type: "solveMoonOrbitInjectWindowForLaunch",
      solution: solution || null,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error || "local-solve-error"),
      type: "solveMoonOrbitInjectWindowForLaunch",
      solution: null,
    };
  }
}

function startDeferredLocalMoonOrbitInjectLaunchSolve(key, payload) {
  const pending = new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(solveMoonOrbitInjectLaunchLocally(payload));
    }, 0);
    if (typeof timer?.unref === "function") {
      timer.unref();
    }
  }).then((response) => cacheMoonOrbitInjectLaunchSolveResponse(key, response));
  runtime.moonOrbitInjectSolve.key = key;
  runtime.moonOrbitInjectSolve.pending = pending;
  runtime.moonOrbitInjectSolve.solution = null;
  runtime.moonOrbitInjectSolve.error = "";
  runtime.moonOrbitInjectSolve.pendingStartedAtMs = Date.now();
  runtime.moonOrbitInjectSolve.lastDurationMs = 0;
  runtime.moonOrbitInjectSolve.lastCompletedAtMs = 0;
  runtime.moonOrbitInjectSolve.source = "local-fallback";
  runtime.moonOrbitInjectSolve.searchProfile = String(payload?.searchProfile || "");
  runtime.moonOrbitInjectSolve.nodeSamples = Number(payload?.nodeSamples) || 0;
  return pending;
}

  async function warmMoonOrbitInjectLaunchSolve(state, missionId = runtime.mission.selectedId, options = {}) {
    const payload = buildMoonOrbitInjectLaunchSolvePayload(state, missionId, options);
    if (!payload) {
      return {
        error: "orbit_inject_payload_unavailable",
        type: "solveMoonOrbitInjectWindowForLaunch",
        solution: null,
      };
    }
    const browserRuntime = typeof window !== "undefined";
    const allowLocalFallback = options?.allowLocalFallback !== undefined
      ? options.allowLocalFallback !== false
      : !browserRuntime;
    const forceLocalFallback = options?.forceLocalFallback === true;
    const forceRestart = options?.forceRestart === true;
    const reuseAnyPending = options?.reuseAnyPending === true;
    const useFreshWorker = browserRuntime && forceRestart;
    const key = moonOrbitInjectLaunchSolveKey(payload);
    if (forceLocalFallback) {
      return startDeferredLocalMoonOrbitInjectLaunchSolve(key, payload);
    }
    if (!canUseMoonDepartureSolveWorker()) {
      return allowLocalFallback
        ? startDeferredLocalMoonOrbitInjectLaunchSolve(
          key,
          payload,
        )
        : {
          error: "worker-unavailable",
          type: "solveMoonOrbitInjectWindowForLaunch",
          solution: null,
        };
    }
    if (!forceRestart && runtime.moonOrbitInjectSolve.key === key) {
      if (runtime.moonOrbitInjectSolve.solution) {
        return {
          error: String(runtime.moonOrbitInjectSolve.error || ""),
          type: "solveMoonOrbitInjectWindowForLaunch",
          solution: runtime.moonOrbitInjectSolve.solution,
        };
      }
      if (runtime.moonOrbitInjectSolve.pending) {
        if (!allowLocalFallback) {
          return runtime.moonOrbitInjectSolve.pending;
        }
        return runtime.moonOrbitInjectSolve.pending.then((response) => {
          if (!response?.error || acceptedMoonOrbitInjectLaunchSolveResponse(response)) {
            return response;
          }
          return browserRuntime
            ? startDeferredLocalMoonOrbitInjectLaunchSolve(key, payload)
            : cacheMoonOrbitInjectLaunchSolveResponse(
              key,
              solveMoonOrbitInjectLaunchLocally(payload),
            );
        });
      }
    }
    if (
      !forceRestart
      && reuseAnyPending
      && runtime.moonOrbitInjectSolve.pending
      && String(runtime.moonOrbitInjectSolve.source || "") === "shared-worker"
    ) {
      return runtime.moonOrbitInjectSolve.pending;
    }
    const workerSolvePromise = (
      useFreshWorker
        ? requestMoonDepartureSolvePromiseFresh({
          type: "solveMoonOrbitInjectWindowForLaunch",
          payload,
          timeoutMs: MOON_ORBIT_INJECT_WORKER_TIMEOUT_MS,
        })
        : requestMoonDepartureSolvePromise({
          type: "solveMoonOrbitInjectWindowForLaunch",
          payload,
        })
    );
    const timedWorkerSolvePromise = useFreshWorker
      ? Promise.race([
        workerSolvePromise,
        new Promise((resolve) => {
          const timer = setTimeout(() => {
            resolve({
              error: "worker-timeout",
              type: "solveMoonOrbitInjectWindowForLaunch",
              solution: null,
            });
          }, MOON_ORBIT_INJECT_WORKER_TIMEOUT_MS);
          if (typeof timer?.unref === "function") {
            timer.unref();
          }
        }),
      ])
      : workerSolvePromise;
    const pending = timedWorkerSolvePromise.then((response) => {
      if (!response?.error || acceptedMoonOrbitInjectLaunchSolveResponse(response)) {
        return cacheMoonOrbitInjectLaunchSolveResponse(key, response);
      }
      if (!allowLocalFallback) {
        return cacheMoonOrbitInjectLaunchSolveResponse(key, response);
      }
      if (browserRuntime) {
        return startDeferredLocalMoonOrbitInjectLaunchSolve(key, payload);
      }
      return cacheMoonOrbitInjectLaunchSolveResponse(
        key,
        solveMoonOrbitInjectLaunchLocally(payload),
      );
    }).catch((error) => {
      const response = {
        error: error instanceof Error ? error.message : String(error || "worker-error"),
        type: "solveMoonOrbitInjectWindowForLaunch",
        solution: null,
      };
      if (!allowLocalFallback) {
        return cacheMoonOrbitInjectLaunchSolveResponse(key, response);
      }
      if (browserRuntime) {
        return startDeferredLocalMoonOrbitInjectLaunchSolve(key, payload);
      }
      return cacheMoonOrbitInjectLaunchSolveResponse(
        key,
        solveMoonOrbitInjectLaunchLocally(payload),
      );
    });
    runtime.moonOrbitInjectSolve.key = key;
    runtime.moonOrbitInjectSolve.pending = pending;
    runtime.moonOrbitInjectSolve.solution = null;
    runtime.moonOrbitInjectSolve.error = "";
    runtime.moonOrbitInjectSolve.pendingStartedAtMs = Date.now();
    runtime.moonOrbitInjectSolve.lastDurationMs = 0;
    runtime.moonOrbitInjectSolve.lastCompletedAtMs = 0;
    runtime.moonOrbitInjectSolve.source = useFreshWorker ? "fresh-worker" : "shared-worker";
    runtime.moonOrbitInjectSolve.searchProfile = String(payload?.searchProfile || "");
    runtime.moonOrbitInjectSolve.nodeSamples = Number(payload?.nodeSamples) || 0;
    return pending;
  }

  function launchMissionShip(state, missionId = runtime.mission.selectedId, nowMs = Date.now(), options = {}) {
    const safeOptions = {
      ...(options && typeof options === "object" ? options : {}),
      vehicleRole: "mission",
    };
    return fleetController.launchMissionShip(state, missionId, nowMs, safeOptions);
  }

  function getMoonOrbitInjectSolveState() {
    const solution = runtime.moonOrbitInjectSolve.solution || null;
    return {
      key: String(runtime.moonOrbitInjectSolve.key || ""),
      pending: Boolean(runtime.moonOrbitInjectSolve.pending),
      error: String(runtime.moonOrbitInjectSolve.error || ""),
      pendingStartedAtMs: Number(runtime.moonOrbitInjectSolve.pendingStartedAtMs) || 0,
      lastDurationMs: Number(runtime.moonOrbitInjectSolve.lastDurationMs) || 0,
      lastCompletedAtMs: Number(runtime.moonOrbitInjectSolve.lastCompletedAtMs) || 0,
      source: String(runtime.moonOrbitInjectSolve.source || ""),
      searchProfile: String(runtime.moonOrbitInjectSolve.searchProfile || ""),
      nodeSamples: Number(runtime.moonOrbitInjectSolve.nodeSamples) || 0,
      solutionReady: Boolean(solution?.ready),
      solutionValid: Boolean(solution?.valid),
      solutionCorridorAccepted: Boolean(solution?.corridorAccepted),
    };
  }

  async function launchMissionShipAsync(state, missionId = runtime.mission.selectedId, nowMs = Date.now(), options = {}) {
    const safeOptions = {
      ...(options && typeof options === "object" ? options : {}),
      vehicleRole: "mission",
    };
    if (
      safeOptions?.moonDepartureWindowSeed
      && safeOptions.moonDepartureWindowSeed?.valid
      && safeOptions.moonDepartureWindowSeed?.ready
      && safeOptions.moonDepartureWindowSeed?.corridorAccepted
    ) {
      return fleetController.launchMissionShip(state, missionId, nowMs, safeOptions);
    }
    const moonOrbitInjectPayload = buildMoonOrbitInjectLaunchSolvePayload(state, missionId, safeOptions);
    if (moonOrbitInjectPayload) {
      const cachedSeed = getCachedMoonOrbitInjectLaunchSolve(moonOrbitInjectPayload);
      if (cachedSeed) {
        safeOptions.moonDepartureWindowSeed = cachedSeed;
      } else {
        const browserRuntime = typeof window !== "undefined";
        if (browserRuntime) {
          return {
            accepted: false,
            reason: "orbit_inject_seed_required",
          };
        }
        const solveResponse = await warmMoonOrbitInjectLaunchSolve(
          state,
          missionId,
          { ...safeOptions, allowLocalFallback: true },
        );
        if (acceptedMoonOrbitInjectLaunchSolveResponse(solveResponse)) {
          safeOptions.moonDepartureWindowSeed = solveResponse.solution;
        } else {
          const reason = String(solveResponse?.error || "").trim().toLowerCase();
          return {
            accepted: false,
            reason: reason === "worker-timeout"
              ? "orbit_inject_solver_timeout"
              : (reason === "worker-unavailable"
                ? "orbit_inject_solver_unavailable"
                : (reason === "orbit_inject_window_unavailable"
                  ? "orbit_inject_window_unavailable"
                  : "orbit_inject_solver_error")),
          };
        }
      }
    }
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
    unregisterCatalogTankerId(id);

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

  function registerCatalogTankerId(tankerId) {
    const id = String(tankerId || "").trim();
    if (!id.startsWith("earth_refuel_tanker_")) {
      return;
    }
    const existing = Array.isArray(runtime.refuel?.catalogTankerIds)
      ? runtime.refuel.catalogTankerIds
      : [];
    if (existing.includes(id)) {
      runtime.refuel.catalogTankerIds = existing;
      return;
    }
    runtime.refuel.catalogTankerIds = [...existing, id];
  }

  function unregisterCatalogTankerId(tankerId) {
    const id = String(tankerId || "").trim();
    if (!id) {
      return;
    }
    const existing = Array.isArray(runtime.refuel?.catalogTankerIds)
      ? runtime.refuel.catalogTankerIds
      : [];
    runtime.refuel.catalogTankerIds = existing.filter((entry) => String(entry || "").trim() !== id);
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
    const launchStackIdle = currentLaunchCommandPhase() === "idle"
      && currentLaunchVehiclePhase() === "idle"
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
      registerCatalogTankerId(orbitInject.tankerId);
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
      registerCatalogTankerId(identity.id);
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
    registerCatalogTankerId(identity.id);
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

  function localPadUpDirection(rocketState, earthState, earthFrameAxes) {
    if (!rocketState?.position || !earthState?.position) {
      return normalize({ x: 0, y: 0, z: 1 });
    }
    const relPos = subtract(rocketState.position, earthState.position);
    const surfaceNormal = runtime.lastSurfaceSample?.surfaceNormal;
    return normalize(
      finiteVector(surfaceNormal) ? surfaceNormal : relPos,
      earthFrameAxes?.pole || { x: 0, y: 0, z: 1 },
    );
  }

  function attachedBoosterMassKgFromRuntime() {
    const stage0 = stageAtIndex(0);
    const dryMassKg = Math.max(
      0,
      Number(stage0?.dryMassKg) || Number(LAUNCH_BOOSTER_CONFIG.dryMassKg) || 0,
    );
    const reservePropellantKg = Math.max(
      0,
      Number(runtime.hotstage?.boosterReservePropellantKg) || 0,
    );
    const boosterPropellantKg = runtime.hotstage.active || runtime.stageIndex > 0
      ? reservePropellantKg
      : Math.max(0, Number(runtime.stagePropellantKg) || 0);
    return dryMassKg + boosterPropellantKg;
  }

  function attachedShipMassKgFromRocket(rocketState, boosterMassKg = attachedBoosterMassKgFromRuntime()) {
    return Math.max(
      MIN_ROCKET_MASS_KG,
      Math.max(MIN_ROCKET_MASS_KG, Number(rocketState?.massKg) || MIN_ROCKET_MASS_KG) - Math.max(0, Number(boosterMassKg) || 0),
    );
  }

  function computeAttachedBoosterConstraintTarget({
    rocketState,
    earthState,
    currentEarthAxes,
    dtSeconds = 0,
  }) {
    if (!rocketState || !earthState) {
      return null;
    }
    const relPos = subtract(rocketState.position, earthState.position);
    const up = normalize(relPos, currentEarthAxes?.pole || { x: 0, y: 0, z: 1 });
    const stackedBodyAxis = normalize(
      runtime.lastStep?.bodyAxisDirectionKm
        || runtime.stageActuator?.directionActual
        || up,
      up,
    );
    const boosterMassKg = attachedBoosterMassKgFromRuntime();
    const shipMassKg = attachedShipMassKgFromRocket(rocketState, boosterMassKg);
    const hotstageOffsets = computeHotstageRelativeOffsetsKm({
      hotstage: runtime.hotstage,
      elapsedSeconds: runtime.elapsedSeconds,
      shipMassKg,
      boosterMassKg,
    });
    const boosterCenterOffsetKm = -(
      (STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm * 0.5)
      + hotstageOffsets.boosterOffsetKm
    );
    const offsetWorldKm = scale(stackedBodyAxis, boosterCenterOffsetKm);
    const targetPositionKm = add(
      rocketState.position,
      offsetWorldKm,
    );
    let targetVelocityKmS = cloneVector(rocketState.velocity || { x: 0, y: 0, z: 0 });
    const previousOffsetWorldKm = runtime.attachedJoint?.targetOffsetWorldKm;
    if (dtSeconds > 1e-9 && finiteVector(previousOffsetWorldKm)) {
      const offsetRateWorldKmS = scale(
        subtract(offsetWorldKm, previousOffsetWorldKm),
        1 / dtSeconds,
      );
      targetVelocityKmS = add(targetVelocityKmS, offsetRateWorldKmS);
    }
    return {
      shipMassKg,
      boosterMassKg,
      stackedBodyAxis,
      hotstageOffsets,
      offsetWorldKm,
      targetPositionKm,
      targetVelocityKmS,
    };
  }

  function ensureAttachedBoosterInNBody(
    state,
    rocketState,
    earthState,
    currentEarthAxes,
    options = {},
  ) {
    if (!state?.dynamicBodies || !rocketState || !earthState) {
      return null;
    }
    const hardSync = options?.hardSync === true;
    const dtSeconds = Math.max(0, Number(options?.dtSeconds) || 0);
    let boosterState = state.dynamicBodies.get(LAUNCH_BOOSTER_BODY_ID) || null;
    const constraintTarget = runtime.booster.attached
      ? computeAttachedBoosterConstraintTarget({
        rocketState,
        earthState,
        currentEarthAxes,
        dtSeconds,
      })
      : null;
    if (!boosterState) {
      boosterState = {
        id: LAUNCH_BOOSTER_BODY_ID,
        massKg: constraintTarget?.boosterMassKg || attachedBoosterMassKgFromRuntime(),
        position: constraintTarget?.targetPositionKm
          ? { ...constraintTarget.targetPositionKm }
          : { ...(rocketState.position || { x: 0, y: 0, z: 0 }) },
        velocity: constraintTarget?.targetVelocityKmS
          ? { ...constraintTarget.targetVelocityKmS }
          : { ...(rocketState.velocity || { x: 0, y: 0, z: 0 }) },
      };
      state.dynamicBodies.set(LAUNCH_BOOSTER_BODY_ID, boosterState);
    }
    if (!runtime.booster.attached) {
      return boosterState;
    }
    boosterState.massKg = constraintTarget?.boosterMassKg || attachedBoosterMassKgFromRuntime();
    if (
      hardSync
      || !finiteVector(boosterState.position)
      || !finiteVector(boosterState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      boosterState.position = constraintTarget?.targetPositionKm
        ? { ...constraintTarget.targetPositionKm }
        : { ...(rocketState.position || { x: 0, y: 0, z: 0 }) };
      boosterState.velocity = constraintTarget?.targetVelocityKmS
        ? { ...constraintTarget.targetVelocityKmS }
        : { ...(rocketState.velocity || { x: 0, y: 0, z: 0 }) };
    }
    if (constraintTarget?.offsetWorldKm && !finiteVector(runtime.attachedJoint?.targetOffsetWorldKm)) {
      runtime.attachedJoint.targetOffsetWorldKm = cloneVector(constraintTarget.offsetWorldKm);
    }
    return boosterState;
  }

  function updateAttachedStackJointState(state, rocketState, earthState, currentEarthAxes, dtSeconds) {
    if (
      !runtime.booster.attached
      || runtime.booster.active
      || !state?.dynamicBodies
      || !rocketState
      || !earthState
      || !runtime.lastStep
    ) {
      runtime.attachedJoint = createAttachedStackJointState();
      return;
    }
    const boosterState = ensureAttachedBoosterInNBody(
      state,
      rocketState,
      earthState,
      currentEarthAxes,
      { dtSeconds, hardSync: false },
    );
    if (!boosterState) {
      runtime.attachedJoint = createAttachedStackJointState();
      return;
    }

    const target = computeAttachedBoosterConstraintTarget({
      rocketState,
      earthState,
      currentEarthAxes,
      dtSeconds,
    });
    if (!target) {
      runtime.attachedJoint = createAttachedStackJointState();
      return;
    }

    const shipMassKg = Math.max(MIN_ROCKET_MASS_KG, Number(target.shipMassKg) || MIN_ROCKET_MASS_KG);
    const boosterMassKg = Math.max(MIN_ROCKET_MASS_KG, Number(target.boosterMassKg) || MIN_ROCKET_MASS_KG);
    const effectiveMassKg = Math.max(
      MIN_ROCKET_MASS_KG,
      Number(runtime.lastStep?.effectiveMassKg) || Math.max(MIN_ROCKET_MASS_KG, Number(rocketState.massKg) || MIN_ROCKET_MASS_KG),
    );
    const bodyAxis = normalize(
      runtime.lastStep?.bodyAxisDirectionKm || target.stackedBodyAxis,
      target.stackedBodyAxis,
    );
    const thrustForceN = scale(bodyAxis, Math.max(0, Number(runtime.lastStep?.thrustN) || 0));
    const aeroForceN = scale(
      runtime.lastStep?.aeroAccelerationKmS2 || { x: 0, y: 0, z: 0 },
      effectiveMassKg * 1000,
    );
    const rcsForceN = scale(
      runtime.lastStep?.rcsAccelerationKmS2 || { x: 0, y: 0, z: 0 },
      effectiveMassKg * 1000,
    );
    const shipForceShare = clamp(
      (Number(STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm) || 0.05)
        / Math.max(1e-6, (Number(STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm) || 0.05) + (Number(STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm) || 0.07)),
      0.25,
      0.75,
    );
    const boosterForceShare = 1 - shipForceShare;
    const nonThrustForceN = add(aeroForceN, rcsForceN);
    const shipBaseForceN = runtime.stageIndex === 0
      ? scale(nonThrustForceN, shipForceShare)
      : add(thrustForceN, scale(nonThrustForceN, shipForceShare));
    const boosterBaseForceN = runtime.stageIndex === 0
      ? add(thrustForceN, scale(nonThrustForceN, boosterForceShare))
      : scale(nonThrustForceN, boosterForceShare);
    const shipBaseAccelerationKmS2 = scale(shipBaseForceN, 1 / (shipMassKg * 1000));
    const boosterBaseAccelerationKmS2 = scale(boosterBaseForceN, 1 / (boosterMassKg * 1000));

    const positionErrorKm = subtract(target.targetPositionKm, boosterState.position);
    const relativeVelocityKmS = subtract(
      target.targetVelocityKmS,
      boosterState.velocity || { x: 0, y: 0, z: 0 },
    );
    const springTermKmS2 = scale(
      positionErrorKm,
      ATTACHED_STACK_JOINT_NATURAL_FREQUENCY_RAD_S * ATTACHED_STACK_JOINT_NATURAL_FREQUENCY_RAD_S,
    );
    const dampingTermKmS2 = scale(
      relativeVelocityKmS,
      2 * ATTACHED_STACK_JOINT_DAMPING_RATIO * ATTACHED_STACK_JOINT_NATURAL_FREQUENCY_RAD_S,
    );
    const baseRelativeAccelerationKmS2 = subtract(
      boosterBaseAccelerationKmS2,
      shipBaseAccelerationKmS2,
    );
    let correctionAccelerationKmS2 = add(
      add(springTermKmS2, dampingTermKmS2),
      scale(baseRelativeAccelerationKmS2, -1),
    );
    const correctionMagKmS2 = length(correctionAccelerationKmS2);
    if (correctionMagKmS2 > ATTACHED_STACK_JOINT_MAX_CORRECTION_KM_S2) {
      correctionAccelerationKmS2 = scale(
        correctionAccelerationKmS2,
        ATTACHED_STACK_JOINT_MAX_CORRECTION_KM_S2 / correctionMagKmS2,
      );
    }
    const reducedMassKg = 1 / ((1 / shipMassKg) + (1 / boosterMassKg));
    let reactionForceVectorN = scale(correctionAccelerationKmS2, reducedMassKg * 1000);
    const reactionForceMagN = length(reactionForceVectorN);
    if (reactionForceMagN > ATTACHED_STACK_JOINT_MAX_LOAD_N) {
      reactionForceVectorN = scale(reactionForceVectorN, ATTACHED_STACK_JOINT_MAX_LOAD_N / reactionForceMagN);
    }
    const shipJointAccelerationKmS2 = scale(reactionForceVectorN, -1 / (shipMassKg * 1000));
    const boosterJointAccelerationKmS2 = scale(reactionForceVectorN, 1 / (boosterMassKg * 1000));
    const shipAccelerationKmS2 = add(shipBaseAccelerationKmS2, shipJointAccelerationKmS2);
    const boosterAccelerationKmS2 = add(boosterBaseAccelerationKmS2, boosterJointAccelerationKmS2);

    runtime.attachedJoint = {
      active: true,
      targetOffsetWorldKm: cloneVector(target.offsetWorldKm),
      targetPositionKm: cloneVector(target.targetPositionKm),
      targetVelocityKmS: cloneVector(target.targetVelocityKmS),
      positionErrorKm: cloneVector(positionErrorKm),
      relativeVelocityKmS: cloneVector(relativeVelocityKmS),
      shipBaseAccelerationKmS2: cloneVector(shipBaseAccelerationKmS2),
      boosterBaseAccelerationKmS2: cloneVector(boosterBaseAccelerationKmS2),
      shipJointAccelerationKmS2: cloneVector(shipJointAccelerationKmS2),
      boosterJointAccelerationKmS2: cloneVector(boosterJointAccelerationKmS2),
      shipAccelerationKmS2: cloneVector(shipAccelerationKmS2),
      boosterAccelerationKmS2: cloneVector(boosterAccelerationKmS2),
      reactionForceN: length(reactionForceVectorN),
      shipMassKg,
      boosterMassKg,
    };

    runtime.booster.lastStep = {
      accelerationKmS2: cloneVector(boosterAccelerationKmS2),
      guidanceMode: "booster-attached-joint",
      requestedDirectionKm: cloneVectorOrNull(target.stackedBodyAxis),
      bodyAxisDirectionKm: cloneVectorOrNull(target.stackedBodyAxis),
      attachedJointLoadMN: runtime.attachedJoint.reactionForceN / 1e6,
      attachedJointErrorM: length(positionErrorKm) * 1000,
      attachedJointRelativeSpeedMS: length(relativeVelocityKmS) * 1000,
      attachedJointBaseAccelerationKmS2: cloneVector(boosterBaseAccelerationKmS2),
      attachedJointAccelerationKmS2: cloneVector(boosterJointAccelerationKmS2),
    };
  }

  function stabilizeAttachedStackConstraint(state, rocketState, earthState, currentEarthAxes) {
    if (!runtime.booster.attached || runtime.booster.active || !rocketState || !earthState) {
      return;
    }
    const boosterState = boosterStateFromNBody(state);
    if (!boosterState) {
      return;
    }
    const target = computeAttachedBoosterConstraintTarget({
      rocketState,
      earthState,
      currentEarthAxes,
      dtSeconds: 0,
    });
    if (!target) {
      return;
    }
    const shipMassKg = Math.max(MIN_ROCKET_MASS_KG, Number(target.shipMassKg) || MIN_ROCKET_MASS_KG);
    const boosterMassKg = Math.max(MIN_ROCKET_MASS_KG, Number(target.boosterMassKg) || MIN_ROCKET_MASS_KG);
    const totalMassKg = shipMassKg + boosterMassKg;
    const relativePositionErrorKm = subtract(
      boosterState.position,
      target.targetPositionKm,
    );
    const relativeVelocityErrorKmS = subtract(
      boosterState.velocity || { x: 0, y: 0, z: 0 },
      target.targetVelocityKmS,
    );
    if (length(relativePositionErrorKm) > 1e-9) {
      rocketState.position = add(
        rocketState.position,
        scale(relativePositionErrorKm, boosterMassKg / totalMassKg),
      );
      boosterState.position = add(
        boosterState.position,
        scale(relativePositionErrorKm, -shipMassKg / totalMassKg),
      );
    }
    if (length(relativeVelocityErrorKmS) > 1e-9) {
      rocketState.velocity = add(
        rocketState.velocity || { x: 0, y: 0, z: 0 },
        scale(relativeVelocityErrorKmS, boosterMassKg / totalMassKg),
      );
      boosterState.velocity = add(
        boosterState.velocity || { x: 0, y: 0, z: 0 },
        scale(relativeVelocityErrorKmS, -shipMassKg / totalMassKg),
      );
    }
    runtime.attachedJoint.targetOffsetWorldKm = cloneVector(target.offsetWorldKm);
    runtime.attachedJoint.targetPositionKm = cloneVector(target.targetPositionKm);
    runtime.attachedJoint.targetVelocityKmS = cloneVector(target.targetVelocityKmS);
    runtime.attachedJoint.positionErrorKm = { x: 0, y: 0, z: 0 };
    runtime.attachedJoint.relativeVelocityKmS = { x: 0, y: 0, z: 0 };
    runtime.booster.lastTrackedPositionKm = earthFixedRelativePositionKm(
      boosterState,
      earthState,
      currentEarthAxes,
    );
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
      { includeTerrain: true },
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
      if (!meta?.id) {
        return;
      }
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
    const catalogTankerIds = Array.isArray(runtime.refuel?.catalogTankerIds)
      ? runtime.refuel.catalogTankerIds
      : [];
    for (let i = 0; i < catalogTankerIds.length; i += 1) {
      const tankerId = String(catalogTankerIds[i] || "").trim();
      if (!tankerId.startsWith("earth_refuel_tanker_")) {
        continue;
      }
      const sequenceNumber = Number(tankerId.match(/_(\d+)$/)?.[1]) || 1;
      mergeOrInsert(tankerMetaForId(
        tankerId,
        sequenceNumber,
        null,
        LAUNCH_REFUEL_TANKER_METAS[0] || null,
      ));
    }
    const fleetVehicles = runtime.fleet?.vehicles instanceof Map
      ? [...runtime.fleet.vehicles.entries()]
      : [];
    for (let i = 0; i < fleetVehicles.length; i += 1) {
      const [bodyId, vehicle] = fleetVehicles[i];
      const meta = managedCatalogMetaForBody(bodyId, {
        massKg: finiteNumber(vehicle?.massKg, vehicle?.dryMassKg),
      });
      mergeOrInsert(meta);
    }
    const refuelFlights = Array.isArray(runtime.refuel?.flights)
      ? runtime.refuel.flights
      : [];
    for (let i = 0; i < refuelFlights.length; i += 1) {
      const tankerId = String(refuelFlights[i]?.id || "").trim();
      if (!tankerId.startsWith("earth_refuel_tanker_")) {
        continue;
      }
      const sequenceNumber = Number(tankerId.match(/_(\d+)$/)?.[1]) || 1;
      mergeOrInsert(tankerMetaForId(
        tankerId,
        sequenceNumber,
        null,
        LAUNCH_REFUEL_TANKER_METAS[0] || null,
      ));
    }
    const pendingTankerId = String(runtime.pendingPadTankerLaunch?.tankerId || "").trim();
    if (pendingTankerId.startsWith("earth_refuel_tanker_")) {
      const sequenceNumber = Number(pendingTankerId.match(/_(\d+)$/)?.[1]) || 1;
      mergeOrInsert(tankerMetaForId(
        pendingTankerId,
        sequenceNumber,
        null,
        LAUNCH_REFUEL_TANKER_METAS[0] || null,
      ));
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
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371.0084,
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
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371.0084,
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

  function repairIdlePrimaryLaunchBodyToPadIfNeeded(state, nowMs = Date.now()) {
    if (
      !state?.dynamicBodies
      || runtime.booster.active
      || Boolean(runtime.pendingPadTankerLaunch?.active)
    ) {
      return false;
    }
    const earthState = earthStateFromNBody(state);
    if (
      !earthState
      || !finiteVector(earthState.position)
      || !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      return false;
    }
    const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371.0084;
    const currentEarthAxes = earthAxes(nowMs);
    const existingRocketState = state.dynamicBodies.get(LAUNCH_BODY_ID) || null;
    const currentVehiclePhase = launchVehiclePhaseFromKinematics({
      earthState,
      rocketState: existingRocketState,
      earthRadiusKm,
      earthPole: currentEarthAxes.pole,
    });
    if (currentLaunchCommandPhase() !== "idle" || currentVehiclePhase !== "idle") {
      return false;
    }
    const pad = computePadState({
      earthState,
      earthRadiusKm,
      earthAxes: currentEarthAxes,
      surfaceClearanceKm: LAUNCH_PAD_CONTACT_HEIGHT_ABOVE_TERRAIN_KM,
    });
    if (!pad) {
      return false;
    }
    let rocketState = state.dynamicBodies.get(LAUNCH_BODY_ID) || null;
    let needsRepair = false;
    if (
      !rocketState
      || !finiteVector(rocketState.position)
      || !finiteVector(rocketState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      needsRepair = true;
    } else {
      const relPos = subtract(rocketState.position, earthState.position);
      const altitudeKm = length(relPos) - earthRadiusKm;
      needsRepair = !Number.isFinite(altitudeKm) || altitudeKm > 20 || altitudeKm < -1;
    }
    if (!rocketState) {
      rocketState = {
        id: LAUNCH_BODY_ID,
        massKg: surfaceLaunchInitialMassKgForMission(runtime.mission.selectedId),
        position: { ...pad.position },
        velocity: { ...pad.velocity },
      };
      state.dynamicBodies.set(LAUNCH_BODY_ID, rocketState);
    }
    rocketState.massKg = surfaceLaunchInitialMassKgForMission(runtime.mission.selectedId);
    rocketState.position = { ...pad.position };
    rocketState.velocity = { ...pad.velocity };
    applyEarthSurfaceContactForVehicle({
      rocketState,
      earthState,
      earthAxes: currentEarthAxes,
      earthRadiusKm,
      earthSiderealRateRadS: EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
      referenceOffsetKm: STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM,
      surfaceClearanceKm: LAUNCH_PAD_CONTACT_HEIGHT_ABOVE_TERRAIN_KM,
      dtSeconds: 0,
      thrustN: 0,
      includeTerrain: true,
    });
    runtime.lastTrackedPositionKm = earthFixedRelativePositionKm(
      rocketState,
      earthState,
      currentEarthAxes,
    );
    updateRuntimeSurfaceSample(
      rocketState,
      earthState,
      currentEarthAxes,
      earthRadiusKm,
    );
    runtime.stageActuator = createActuatorState(
      localPadUpDirection(rocketState, earthState, currentEarthAxes),
    );
    ensureAttachedBoosterInNBody(
      state,
      rocketState,
      earthState,
      currentEarthAxes,
      { hardSync: true },
    );
    const relPos = subtract(rocketState.position, earthState.position);
    const relVel = subtract(
      rocketState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    updateRuntimeTargetMetrics(state, relPos, relVel, nowMs);
    const environmentSample = launchEnvironmentSample(relPos, currentEarthAxes, earthRadiusKm, nowMs);
    const atmosphereSample = environmentSample.atmosphereSample;
    const windSample = environmentSample.windSample;
    const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
      atmosphereSample,
      relPos,
      relVel,
      currentEarthAxes.pole,
      windSample?.vectorKmS || null,
    );
    runtime.lastTelemetry = telemetryFromState({
      gravitationalConstantKm3PerKgS2,
      earthMassKg: Number(getEarthMassKg?.()) || 0,
      earthRadiusKm,
      earthState,
      rocketState,
      atmosphereSample,
      earthPole: currentEarthAxes.pole,
      windVectorKmS: windSample?.vectorKmS || null,
      dynamicPressurePaOverride: dynamicPressurePa,
      runtime,
    });
    if (needsRepair) {
      emitLaunchEvent("launch_vehicle_idle_pad_repair", {
        launchSiteName: LAUNCH_SITE.name || "Launch Site",
        ...telemetryLogDetails(runtime.lastTelemetry),
      });
    }
    return true;
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
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371.0084,
      earthAxes: currentEarthAxes,
      surfaceClearanceKm: LAUNCH_PAD_CONTACT_HEIGHT_ABOVE_TERRAIN_KM,
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
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371.0084,
      earthSiderealRateRadS: EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
      referenceOffsetKm: STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM,
      surfaceClearanceKm: LAUNCH_PAD_CONTACT_HEIGHT_ABOVE_TERRAIN_KM,
      dtSeconds: 0,
      thrustN: 0,
      includeTerrain: true,
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
      Number(getEarthRadiusKm?.()) || 6371.0084,
    );
    runtime.stageActuator = createActuatorState(
      localPadUpDirection(rocketState, earthState, currentEarthAxes),
    );
    ensureAttachedBoosterInNBody(
      state,
      rocketState,
      earthState,
      currentEarthAxes,
      { hardSync: true },
    );
    runtime.launchPlaneNormal = computeLaunchPlaneNormal(currentEarthAxes);
    setLaunchCommandPhase("idle");
    const relPos = subtract(rocketState.position, earthState.position);
    const relVel = subtract(
      rocketState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    updateRuntimeTargetMetrics(state, relPos, relVel, nowMs);
    const environmentSample = launchEnvironmentSample(
      relPos,
      currentEarthAxes,
      Number(getEarthRadiusKm?.()) || 6371.0084,
      nowMs,
    );
    const atmosphereSample = environmentSample.atmosphereSample;
    const windSample = environmentSample.windSample;
    const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
      atmosphereSample,
      relPos,
      relVel,
      currentEarthAxes.pole,
      windSample?.vectorKmS || null,
    );
    runtime.lastTelemetry = telemetryFromState({
      gravitationalConstantKm3PerKgS2,
      earthMassKg: Number(getEarthMassKg?.()) || 0,
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371.0084,
      earthState,
      rocketState,
      atmosphereSample,
      earthPole: currentEarthAxes.pole,
      windVectorKmS: windSample?.vectorKmS || null,
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
    setLaunchCommandPhase("powered");
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
    const hotstageOffsets = computeHotstageRelativeOffsetsKm({
      hotstage: runtime.hotstage,
      elapsedSeconds: runtime.elapsedSeconds,
      shipMassKg,
      boosterMassKg,
    });

    const boosterState = ensureAttachedBoosterInNBody(
      state,
      rocketState,
      earthState,
      currentEarthAxes,
    );
    if (!boosterState) {
      return null;
    }
    const relPos = subtract(rocketState.position, earthState.position);
    const relVel = subtract(
      rocketState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    const up = normalize(relPos, currentEarthAxes.pole);
    const stackedBodyAxis = normalize(
      runtime.lastStep?.bodyAxisDirectionKm
        || runtime.stageActuator?.directionActual
        || up,
      up,
    );
    const separationAxis = stackedBodyAxis;

    // Align the dynamic reference from stacked center to Starship center at staging.
    const shipCenterShiftKm = STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm * 0.5;
    rocketState.position = add(
      rocketState.position,
      scale(separationAxis, shipCenterShiftKm + hotstageOffsets.shipOffsetKm),
    );

    // Place booster directly below Starship with only a small physical gap; add a tiny separation
    // impulse that conserves momentum and yields a gentle relative separation speed.
    const separationOffsetKm =
      (STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm * 0.5)
      + (STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm * 0.5)
      + hotstageOffsets.displayedGapKm;
    const separationRelativeSpeedKmS = Math.max(0, hotstageSeparationRelativeSpeedKmS());
    const totalMassKg = shipMassKg + boosterMassKg;
    const dvShipKmS = totalMassKg > 0
      ? separationRelativeSpeedKmS * (boosterMassKg / totalMassKg)
      : 0;
    const dvBoosterKmS = totalMassKg > 0
      ? separationRelativeSpeedKmS * (shipMassKg / totalMassKg)
      : 0;
    const baseVelocityKmS = rocketState.velocity || { x: 0, y: 0, z: 0 };
    const shipImpulseKmS = scale(separationAxis, dvShipKmS);
    const separationImpulseKmS = scale(separationAxis, -dvBoosterKmS);
    rocketState.velocity = add(baseVelocityKmS, shipImpulseKmS);
    boosterState.massKg = boosterMassKg;
    boosterState.velocity = add(baseVelocityKmS, separationImpulseKmS);

    runtime.booster.attached = false;
    runtime.attachedJoint = createAttachedStackJointState();
    runtime.booster.active = true;
    setBoosterCommandPhase("separation-flip");
    runtime.booster.guidanceMode = "booster-separation-flip";
    runtime.booster.propellantKg = reservePropellantKg;
    runtime.booster.initialPropellantKg = reservePropellantKg;
    runtime.booster.separationTimeSec = runtime.elapsedSeconds;
    runtime.booster.landed = false;
    runtime.booster.lastStep = zeroBoosterStep("booster-separation-flip");
    runtime.booster.attitude = createBoosterAttitudeState(stackedBodyAxis);
    runtime.boosterActuator = createActuatorState(stackedBodyAxis);
    runtime.boosterMassModel = createMassModelState();
    runtime.booster.lastSurfaceSample = null;
    runtime.booster.contactHoldSec = 0;
    runtime.booster.catchAlignHoldSec = 0;
    runtime.booster.lastTrackedPositionKm = earthFixedRelativePositionKm(
      boosterState,
      earthState,
      currentEarthAxes,
    );
    runtime.booster.navigation = resetBoosterNavigationState(runtime.booster.navigation);
    runtime.booster.telemetry = null;
    emitLaunchEvent("stage_separation_booster_detached", {
      stageIndex: runtime.stageIndex,
      boosterMassKg,
      reservePropellantKg,
      shipCenterShiftKm,
      separationOffsetKm,
      hotstageDisplayedGapKm: hotstageOffsets.displayedGapKm,
      hotstageShipOffsetKm: hotstageOffsets.shipOffsetKm,
      hotstageBoosterOffsetKm: hotstageOffsets.boosterOffsetKm,
      shipMassKg,
      shipImpulseKmS,
      separationImpulseKmS,
      separationAxisWorldKm: { ...separationAxis },
    });
    emitRuntimeTransitionEvents("stage_separation");
    return boosterState;
  }

  function prepareBoosterStep(state, dtSeconds, nowMs = Date.now()) {
    if (runtime.booster.attached && !runtime.booster.active) {
      const earthState = earthStateFromNBody(state);
      const rocketState = rocketStateFromNBody(state);
      if (earthState && rocketState) {
        ensureAttachedBoosterInNBody(
          state,
          rocketState,
          earthState,
          earthAxes(nowMs),
          { dtSeconds, hardSync: false },
        );
      }
      runtime.booster.lastStep = runtime.attachedJoint.active
        ? cloneJson(runtime.booster.lastStep, null)
        : null;
      return;
    }
    if (!runtime.booster.active) {
      runtime.booster.lastStep = null;
      return;
    }
    const earthState = earthStateFromNBody(state);
    const boosterState = boosterStateFromNBody(state);
    if (!earthState || !boosterState) {
      runtime.booster.lastStep = zeroBoosterStep("booster-inactive");
      runtime.booster.active = false;
      setBoosterCommandPhase("idle");
      runtime.booster.guidanceMode = "booster-inactive";
      runtime.booster.attitude = createBoosterAttitudeState({ x: 0, y: 0, z: 1 });
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
      runtime.booster.attitude = createBoosterAttitudeState({ x: 0, y: 0, z: 1 });
      return;
    }

    const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371.0084;
    const currentEarthAxes = earthAxes(nowMs);
    const relPos = subtract(boosterState.position, earthState.position);
    const relVel = subtract(
      boosterState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    const muKm3S2 = gravitationalConstantKm3PerKgS2 * (Number(getEarthMassKg?.()) || 0);
    const orbital = orbitalStateFromRelative(muKm3S2, earthRadiusKm, relPos, relVel);
    const environmentSample = launchEnvironmentSample(relPos, currentEarthAxes, earthRadiusKm, nowMs);
    const altitudeKm = environmentSample.altitudeKm;
    const atmosphereSample = environmentSample.atmosphereSample;
    const windSample = environmentSample.windSample;
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
    const catchFrame = computeLaunchSiteCatchFrame({
      earthState,
      earthRadiusKm,
      earthAxes: currentEarthAxes,
    });
    const navigationSolution = updateBoosterNavigationState({
      navigationState: runtime.booster.navigation,
      boosterState,
      earthState,
      catchFrame,
      elapsedSec: runtime.elapsedSeconds,
      altitudeKm,
      dynamicPressurePa,
    });
    const guidanceBoosterState = navigationSolution?.estimatedBoosterState || boosterState;
    const guidanceRelPos = subtract(guidanceBoosterState.position, earthState.position);
    const guidanceRelVel = subtract(
      guidanceBoosterState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    const guidanceOrbital = orbitalStateFromRelative(muKm3S2, earthRadiusKm, guidanceRelPos, guidanceRelVel);
    const catchRelativeState = navigationSolution?.catchRelativeState
      || (
        catchFrame
          ? computeBoosterCatchRelativeState({
            boosterState: guidanceBoosterState,
            catchFrame,
          })
          : null
      );
    const launchSiteVector = padState
      ? subtract(padState.position, guidanceBoosterState.position)
      : { x: 0, y: 0, z: 0 };
    const launchSiteRangeKm = padState ? length(launchSiteVector) : Number.POSITIVE_INFINITY;
    const launchSiteLateralVector = subtract(
      launchSiteVector,
      scale(guidanceOrbital.up, dot(launchSiteVector, guidanceOrbital.up)),
    );
    const launchSiteLateralRangeKm = padState ? length(launchSiteLateralVector) : Number.POSITIVE_INFINITY;
    const padVelocity = padState?.velocity || earthState.velocity || { x: 0, y: 0, z: 0 };
    const relVelocityToPad = subtract(
      guidanceBoosterState.velocity || { x: 0, y: 0, z: 0 },
      padVelocity,
    );
    const launchSiteLateralDirection = normalize(
      launchSiteLateralVector,
      normalize(scale(guidanceOrbital.tangentialVector, -1), guidanceOrbital.up),
    );
    const launchSiteLateralClosingSpeedKmS = dot(scale(relVelocityToPad, -1), launchSiteLateralDirection);
    const currentBoosterAxis = boosterBodyAxisWorld(runtime.booster.attitude);
    const command = computeBoosterRecoveryCommand({
      currentPhase: currentBoosterCommandPhase(),
      altitudeKm,
      radialSpeedKmS: guidanceOrbital.radialSpeedKmS,
      tangentialSpeedKmS: guidanceOrbital.tangentialSpeedKmS,
      dynamicPressurePa,
      remainingPropellantKg: runtime.booster.propellantKg,
      reserveLandingPropellantKg: stageReservePropellantKg(0),
      timeSinceSeparationSec: Math.max(0, runtime.elapsedSeconds - runtime.booster.separationTimeSec),
      launchSiteRangeKm,
      launchSiteLateralRangeKm,
      launchSiteLateralClosingSpeedKmS,
      catchTotalRangeKm: catchRelativeState?.totalRangeKm,
      catchLateralRangeKm: catchRelativeState?.lateralRangeKm,
      catchVerticalErrorKm: catchRelativeState?.verticalErrorKm,
      catchLateralSpeedKmS: catchRelativeState?.lateralSpeedKmS,
      catchVerticalSpeedKmS: catchRelativeState?.verticalSpeedKmS,
      catchApproachSpeedKmS: catchRelativeState?.totalSpeedKmS,
      bodyRetrogradeAlignment: dot(
        currentBoosterAxis,
        normalize(scale(guidanceRelVel, -1), guidanceOrbital.up),
      ),
      bodyAntiTangentAlignment: dot(
        currentBoosterAxis,
        normalize(
          scale(guidanceOrbital.tangentialVector, -1),
          normalize(scale(guidanceRelVel, -1), guidanceOrbital.up),
        ),
      ),
      bodyUpAlignment: dot(
        currentBoosterAxis,
        guidanceOrbital.up,
      ),
    });

    const up = guidanceOrbital.up;
    let direction = composeBoosterDirection(
      up,
      guidanceRelVel,
      guidanceOrbital.tangentialVector,
      command.directionMix,
    );
    const siteTargetingEnabled = command.siteTargetingEnabled !== false;
    const siteTargetState = siteTargetingEnabled
      ? (
        command.captureLike && catchFrame
          ? {
            position: catchFrame.centerPosition,
            velocity: catchFrame.centerVelocity,
          }
          : padState
      )
      : null;
    if (siteTargetState) {
      const lateralToSiteDirection = lateralDirectionTowardTarget(
        guidanceBoosterState.position,
        siteTargetState.position,
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
        const targetVelocity = siteTargetState.velocity || padVelocity;
        const relVelocityToTarget = subtract(
          guidanceBoosterState.velocity || { x: 0, y: 0, z: 0 },
          targetVelocity,
        );
        const padRetrogradeDirection = normalize(scale(relVelocityToTarget, -1), direction);
        direction = normalize(mixVectors(direction, padRetrogradeDirection, siteVelocityWeight), direction);
      }
    }
    const pressurePa = Number(atmosphereSample?.pressurePa) || 0;
    const landingPhase = command.phase === "landing-burn" || command.phase === "landed";
    const recoveryPropellantBudgetKg = stageReservePropellantKg(0);
    const reserveProtectionRatio = landingPhase
      ? 0
      : (
        command.phase === "descent-coast"
          ? 0.20
          : command.phase === "entry-burn"
            ? 0.30
            : command.phase === "entry-align" || command.phase === "ballistic-descent"
              ? 0.36
              : command.phase === "boostback"
                ? 0.54
                : 0.52
      );
    const protectedReserveKg = recoveryPropellantBudgetKg * reserveProtectionRatio;
    const burnablePropellantKg = Math.max(0, runtime.booster.propellantKg - protectedReserveKg);
    const canBurn = burnablePropellantKg > 1e-6 && !runtime.booster.landed;
    const relAirVelocityKmS = atmosphereRelativeVelocityKmS(
      relPos,
      relVel,
      currentEarthAxes.pole,
      windSample.vectorKmS,
    );
    const qAlphaSteeringEnabled = command.qAlphaSteeringEnabled !== false;
    const qAlphaActive = (
      qAlphaSteeringEnabled
      && (
      Number.isFinite(altitudeKm)
      && altitudeKm <= PRIMARY_QALPHA_ACTIVE_MAX_ALTITUDE_KM
      && Number(dynamicPressurePa) >= PRIMARY_QALPHA_ACTIVE_MIN_DYNAMIC_PRESSURE_PA
      )
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
    const attitudeTargetBlend = clamp(Number(command.attitudeTargetBlend) || 1, 0, 1);
    if (attitudeTargetBlend < 0.999) {
      direction = normalize(
        mixVectors(currentBoosterAxis, direction, attitudeTargetBlend),
        currentBoosterAxis,
      );
    }
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
      dryMassKg: Number(LAUNCH_BOOSTER_CONFIG.dryMassKg) || 0,
      propellantMassKg: Number(runtime.booster.initialPropellantKg) || 0,
      attachedMassKg: 0,
    });
    const controlErrorsBody = computeBoosterAttitudeControlErrors({
      desiredDirection: direction,
      attitudeState: runtime.booster.attitude,
      referenceUpWorld: up,
      tangentialVectorWorld: orbital.tangentialVector,
    });
    const bodyAxesWorld = boosterBodyAxesWorld(runtime.booster.attitude);
    const omegaBodyRadS = {
      x: finiteNumber(runtime.booster.attitude?.omegaBodyRadS?.x, 0),
      y: finiteNumber(runtime.booster.attitude?.omegaBodyRadS?.y, 0),
      z: finiteNumber(runtime.booster.attitude?.omegaBodyRadS?.z, 0),
    };
    const gridFinControl = computeGridFinControlState({
      bodyKind: "booster",
      atmosphereSample,
      relPos,
      relVel,
      earthPole: currentEarthAxes.pole,
      windVectorKmS: windSample.vectorKmS,
      desiredDirection: direction,
      bodyAxisDirection: currentBoosterAxis,
      bodyAxesWorld,
      controlErrorsBody,
      omegaBodyRadS,
      massKg: Number(boosterState.massKg) || 0,
      massModel: runtime.boosterMassModel,
    });
    const attitudeResponseScale = clamp(Number(command.attitudeResponseScale) || 1, 0.05, 2.8);
    const engineAngularControl = scaleAngularControlState(computeBoosterEngineAngularControlState({
      controlErrorsBody,
      omegaBodyRadS,
      pressurePa,
      throttle: requestedThrottle,
      massKg: Number(boosterState.massKg) || 0,
      massModel: runtime.boosterMassModel,
    }), attitudeResponseScale);
    const rcsAngularControl = scaleAngularControlState(computeBoosterRcsAngularControlState({
      controlErrorsBody,
      omegaBodyRadS,
      controlAuthorityScale: runtime.boosterMassModel.controlAuthorityScale,
      aeroAuthority: gridFinControl.authority,
      throttle: requestedThrottle,
      massKg: Number(boosterState.massKg) || 0,
      massModel: runtime.boosterMassModel,
    }), attitudeResponseScale);
    runtime.boosterActuator = updateBoosterThrottleState(runtime.boosterActuator, {
      requestedThrottle,
      dtSeconds,
      massModel: runtime.boosterMassModel,
    });
    const throttleActual = clamp(Number(runtime.boosterActuator.throttleActual) || 0, 0, 1);

    const aeroPreview = computeAerodynamicResponse({
      bodyKind: "booster",
      atmosphereSample,
      relPos,
      relVel,
      earthPole: currentEarthAxes.pole,
      windVectorKmS: windSample.vectorKmS,
      bodyAxisDirection: currentBoosterAxis,
      referenceAreaM2: Number(LAUNCH_BOOSTER_CONFIG.referenceAreaM2) || 0,
      massKg: Math.max(MIN_ROCKET_MASS_KG, Number(boosterState.massKg) || MIN_ROCKET_MASS_KG),
      massModel: runtime.boosterMassModel,
      throttle: throttleActual,
    });
    const relAirDirection = normalize(aeroPreview.relAirVelocityKmS || scale(relVel, -1), currentBoosterAxis);
    const aeroAxis = unitOrNull(cross(currentBoosterAxis, relAirDirection));
    const aeroTorqueSignedNm =
      (Number(aeroPreview.dynamicPressurePa) || 0)
      * Math.max(0, Number(LAUNCH_BOOSTER_CONFIG.referenceAreaM2) || 0)
      * boosterBodyLengthMeters()
      * (-(Number(aeroPreview.momentCoefficient) || 0));
    const totalBodyTorqueNm = add(
      add(
        gridFinControl.bodyTorqueNm || { x: 0, y: 0, z: 0 },
        engineAngularControl.bodyTorqueNm || { x: 0, y: 0, z: 0 },
      ),
      rcsAngularControl.bodyTorqueNm || { x: 0, y: 0, z: 0 },
    );
    let totalTorqueWorldNm = rotateVectorByQuaternion(
      totalBodyTorqueNm,
      runtime.booster.attitude?.orientation || quaternionIdentity(),
    );
    if (aeroAxis && Math.abs(aeroTorqueSignedNm) > 1e-6) {
      totalTorqueWorldNm = add(totalTorqueWorldNm, scale(aeroAxis, aeroTorqueSignedNm));
    }
    runtime.booster.attitude = integrateBoosterAttitudeState(runtime.booster.attitude, {
      torqueWorldNm: totalTorqueWorldNm,
      massKg: Number(boosterState.massKg) || 0,
      inertiaNormalized: runtime.boosterMassModel?.inertiaNormalized,
      angularDampingPerS: Number(command.angularDampingPerS) || 0,
      maxBodyRateRadS: Number.isFinite(Number(command.maxBodyRateDegS))
        ? rad(Number(command.maxBodyRateDegS))
        : null,
      dtSeconds,
    });
    const directionActual = boosterBodyAxisWorld(runtime.booster.attitude);
    runtime.boosterActuator.directionCommand = normalize(direction, directionActual);
    runtime.boosterActuator.directionActual = directionActual;
    runtime.boosterActuator.gimbalErrorDeg = degrees(angleBetweenRadians(directionActual, direction));
    runtime.boosterActuator.angularRateRadS = length(runtime.booster.attitude?.omegaBodyRadS || { x: 0, y: 0, z: 0 });

    const fullThrustN = interpolateConfiguredThrustN(LAUNCH_BOOSTER_CONFIG, pressurePa);
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
      massModel: runtime.boosterMassModel,
      throttle: throttleActual,
    });
    setBoosterCommandPhase(command.phase || "descent");
    runtime.booster.guidanceMode = command.guidanceMode || "booster-guidance";
    const boosterRcs = computeBoosterRcsAssist({
      desiredDirection: direction,
      currentDirection: directionActual,
      relVel,
      up,
      throttle: throttleActual,
      phase: command.phase || currentBoosterCommandPhase(),
      guidanceMode: command.guidanceMode || runtime.booster.guidanceMode,
      controlAuthorityScale: runtime.boosterMassModel.controlAuthorityScale,
      aeroAuthority: Number(gridFinControl.authority) || 0,
    });
    let rcsBurnRateKgS = runtime.booster.propellantKg > 1e-9
      ? boosterRcsPropellantBurnRateKgS(boosterRcs)
      : 0;
    const burnKgAfterMain = Math.max(0, runtime.booster.propellantKg - burnKg);
    const rcsBurnKg = Math.min(burnKgAfterMain, rcsBurnRateKgS * dtSeconds);
    if (!(rcsBurnKg > 1e-12)) {
      boosterRcs.active = false;
      boosterRcs.authority = 0;
      boosterRcs.accelerationKmS2 = { x: 0, y: 0, z: 0 };
      boosterRcs.jets = [];
      rcsBurnRateKgS = 0;
    }
    const boosterRcsAccelerationKmS2 = cloneVector(boosterRcs.accelerationKmS2 || { x: 0, y: 0, z: 0 });
    runtime.booster.lastStep = {
      accelerationKmS2: add(
        add(scale(directionActual, accelerationMagKmS2), aero.accelerationKmS2),
        boosterRcsAccelerationKmS2,
      ),
      throttle: throttleActual,
      throttleCommand: requestedThrottle,
      thrustN,
      burnKg,
      burnRateKgS,
      rcsBurnKg,
      rcsBurnRateKgS,
      dynamicPressurePa: aero.dynamicPressurePa,
      requestedDirectionKm: cloneVectorOrNull(direction),
      bodyAxisDirectionKm: cloneVectorOrNull(directionActual),
      guidanceMode: throttleActual <= 0 && !landingPhase && stageReservePropellantKg(0) > 0
        ? `${runtime.booster.guidanceMode}+reserve-hold`
        : runtime.booster.guidanceMode,
      touchdownReady: Boolean(command.touchdownReady),
      rcsActive: boosterRcs.active,
      rcsErrorDeg: boosterRcs.errorDeg,
      rcsAuthority: boosterRcs.authority,
      rcsAccelerationKmS2: boosterRcsAccelerationKmS2,
      rcsAccelerationMagKmS2: length(boosterRcsAccelerationKmS2),
      rcsJets: boosterRcs.jets,
      angleOfAttackDeg: aero.angleOfAttackDeg,
      qAlphaPaRad: aero.qAlphaPaRad,
      machNumber: aero.machNumber,
      dragCoefficient: aero.dragCoefficient,
      liftCoefficient: aero.liftCoefficient,
      momentCoefficient: aero.momentCoefficient,
      gimbalErrorDeg: runtime.boosterActuator.gimbalErrorDeg,
      windSpeedKmS: windSample.speedKmS,
      windEastMS: windSample.eastMS,
      windNorthMS: windSample.northMS,
      comNormalized: runtime.boosterMassModel.comNormalized,
      inertiaNormalized: runtime.boosterMassModel.inertiaNormalized,
      controlAuthorityScale: runtime.boosterMassModel.controlAuthorityScale,
      gridFinAuthority: Number(gridFinControl.authority) || 0,
      gridFinDeflectionDeg: Number(gridFinControl.deflectionDeg) || 0,
      gridFinMomentNm: Number(gridFinControl.momentNm) || 0,
      gridFinAngularAccelerationRadS2: Number(gridFinControl.angularAccelerationRadS2) || 0,
      engineAngularAccelerationRadS2: Number(engineAngularControl.angularAccelerationRadS2) || 0,
      rcsAngularAccelerationRadS2: Number(rcsAngularControl.angularAccelerationRadS2) || 0,
      bodyAngularRateRadS: cloneVectorOrNull(runtime.booster.attitude?.omegaBodyRadS),
      attitudeControlMode: String(command.attitudeControlMode || ""),
    };
    runtime.booster.telemetry = boosterTelemetryFromState({
      gravitationalConstantKm3PerKgS2,
      earthMassKg: Number(getEarthMassKg?.()) || 0,
      earthRadiusKm,
      earthState,
      boosterState,
      atmosphereSample,
      earthPole: currentEarthAxes.pole,
      windVectorKmS: windSample.vectorKmS,
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

    const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371.0084;
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
      includeTerrain: true,
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
    const upNow = normalize(relPosNow, currentEarthAxes.pole);
    const radialSpeedKmS = dot(relVelNow, upNow);
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
      setBoosterCommandPhase("landed");
      runtime.booster.guidanceMode = "booster-landed";
      runtime.booster.lastStep = zeroBoosterStep("booster-landed");
      runtime.booster.active = false;
    }

    const environmentSample = launchEnvironmentSample(
      relPosNow,
      currentEarthAxes,
      earthRadiusKm,
      nowMs,
      (Number(runtime.windSeed) || 0) + 131_071,
    );
    const atmosphereSample = environmentSample.atmosphereSample;
    const windSample = environmentSample.windSample;
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
    const catchFrame = computeLaunchSiteCatchFrame({
      earthState,
      earthRadiusKm,
      earthAxes: currentEarthAxes,
    });
    const navigationSolution = updateBoosterNavigationState({
      navigationState: runtime.booster.navigation,
      boosterState,
      earthState,
      catchFrame,
      elapsedSec: runtime.elapsedSeconds + Math.max(0, Number(dtSeconds) || 0),
      altitudeKm,
      dynamicPressurePa,
    });
    const guidanceBoosterState = navigationSolution?.estimatedBoosterState || boosterState;
    const launchSiteVector = padState
      ? subtract(padState.position, guidanceBoosterState.position)
      : { x: 0, y: 0, z: 0 };
    const launchSiteRangeKm = padState ? length(launchSiteVector) : Number.POSITIVE_INFINITY;
    const guidanceRelPosNow = subtract(guidanceBoosterState.position, earthState.position);
    const guidanceUpNow = normalize(guidanceRelPosNow, currentEarthAxes.pole);
    const launchSiteLateralVector = subtract(
      launchSiteVector,
      scale(guidanceUpNow, dot(launchSiteVector, guidanceUpNow)),
    );
    const launchSiteLateralRangeKm = padState ? length(launchSiteLateralVector) : Number.POSITIVE_INFINITY;
    const padVelocity = padState?.velocity || earthState.velocity || { x: 0, y: 0, z: 0 };
    const relVelocityToPad = subtract(
      guidanceBoosterState.velocity || { x: 0, y: 0, z: 0 },
      padVelocity,
    );
    const launchSiteLateralDirection = normalize(
      launchSiteLateralVector,
      normalize(scale(subtract(guidanceBoosterState.velocity || { x: 0, y: 0, z: 0 }, earthState.velocity || { x: 0, y: 0, z: 0 }), -1), currentEarthAxes.pole),
    );
    const launchSiteLateralClosingSpeedKmS = dot(scale(relVelocityToPad, -1), launchSiteLateralDirection);
    const catchCenterVector = catchFrame
      ? subtract(catchFrame.centerPosition, guidanceBoosterState.position)
      : launchSiteVector;
    const catchCenterLateralVector = subtract(
      catchCenterVector,
      scale(
        guidanceUpNow,
        dot(catchCenterVector, guidanceUpNow),
      ),
    );
    const catchCenterLateralRangeKm = catchFrame
      ? length(catchCenterLateralVector)
      : launchSiteLateralRangeKm;
    const catchRelativeState = navigationSolution?.catchRelativeState
      || (
        catchFrame
          ? computeBoosterCatchRelativeState({
            boosterState: guidanceBoosterState,
            catchFrame,
          })
          : null
      );
    const catchPinHeightErrorKm = Number.isFinite(Number(catchRelativeState?.verticalErrorKm))
      ? Number(catchRelativeState.verticalErrorKm)
      : computeBoosterCatchPinHeightErrorKm(bodyAboveTerrainKm);
    const catchAlignmentEligible = shouldFinalizeBoosterCatch({
      guidanceMode: runtime.booster.guidanceMode,
      launchSiteLateralRangeKm: catchRelativeState?.lateralRangeKm ?? catchCenterLateralRangeKm,
      catchVerticalErrorKm: catchRelativeState?.verticalErrorKm,
      catchPinHeightErrorKm,
      speedKmS: catchRelativeState?.totalSpeedKmS ?? speedKmS,
      radialSpeedKmS: catchRelativeState?.verticalSpeedKmS ?? radialSpeedKmS,
      catchHoldSec: Number.POSITIVE_INFINITY,
    });
    if (catchAlignmentEligible) {
      runtime.booster.catchAlignHoldSec += Math.max(0, dtSeconds);
    } else {
      runtime.booster.catchAlignHoldSec = 0;
    }
    const catchFinalized = shouldFinalizeBoosterCatch({
      guidanceMode: runtime.booster.guidanceMode,
      launchSiteLateralRangeKm: catchRelativeState?.lateralRangeKm ?? catchCenterLateralRangeKm,
      catchVerticalErrorKm: catchRelativeState?.verticalErrorKm,
      catchPinHeightErrorKm,
      speedKmS: catchRelativeState?.totalSpeedKmS ?? speedKmS,
      radialSpeedKmS: catchRelativeState?.verticalSpeedKmS ?? radialSpeedKmS,
      catchHoldSec: runtime.booster.catchAlignHoldSec,
    });
    if (catchFinalized) {
      if (catchFrame) {
        boosterState.position = { ...catchFrame.centerPosition };
        boosterState.velocity = { ...catchFrame.centerVelocity };
      } else if (padState) {
        boosterState.position = { ...padState.position };
        boosterState.velocity = { ...padVelocity };
      }
      runtime.booster.landed = true;
      setBoosterCommandPhase("caught");
      runtime.booster.guidanceMode = "booster-caught";
      runtime.booster.lastStep = zeroBoosterStep("booster-caught");
      runtime.booster.active = false;
    }
    runtime.booster.telemetry = boosterTelemetryFromState({
      gravitationalConstantKm3PerKgS2,
      earthMassKg: Number(getEarthMassKg?.()) || 0,
      earthRadiusKm,
      earthState,
      boosterState,
      atmosphereSample,
      earthPole: currentEarthAxes.pole,
      windVectorKmS: windSample.vectorKmS,
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
      runtime.booster.telemetry.catchCenterLateralRangeKm = Number.isFinite(catchCenterLateralRangeKm)
        ? catchCenterLateralRangeKm
        : null;
      runtime.booster.telemetry.catchTotalRangeKm = Number.isFinite(Number(catchRelativeState?.totalRangeKm))
        ? Number(catchRelativeState.totalRangeKm)
        : null;
      runtime.booster.telemetry.catchLateralSpeedKmS = Number.isFinite(Number(catchRelativeState?.lateralSpeedKmS))
        ? Number(catchRelativeState.lateralSpeedKmS)
        : null;
      runtime.booster.telemetry.catchVerticalSpeedKmS = Number.isFinite(Number(catchRelativeState?.verticalSpeedKmS))
        ? Number(catchRelativeState.verticalSpeedKmS)
        : null;
      runtime.booster.telemetry.catchAlignHoldSec = Number(runtime.booster.catchAlignHoldSec) || 0;
      runtime.booster.telemetry.catchPinHeightErrorKm = Number.isFinite(catchPinHeightErrorKm)
        ? catchPinHeightErrorKm
        : null;
    }
  }

  function prepareStep(state, dtSeconds, nowMs = Date.now()) {
    runtime.lastStep = null;
    try {
      prepareBoosterStep(state, dtSeconds, nowMs);
      fleetController.prepareStep(state, dtSeconds, nowMs);
      if (currentLaunchCommandPhase() === "idle") {
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
          const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371.0084;
          const currentEarthAxes = earthAxes(nowMs);
          updateRuntimeSurfaceSample(rocketState, earthState, currentEarthAxes, earthRadiusKm);
          const physicalIdlePhase = launchVehiclePhaseFromKinematics({
            earthState,
            rocketState,
            earthRadiusKm,
            earthPole: currentEarthAxes.pole,
          });
          if (physicalIdlePhase !== "idle") {
            setLaunchCommandPhase(physicalIdlePhase === "orbit" ? "orbit" : "coast");
          }
        }
        if (currentLaunchCommandPhase() === "idle") {
          return;
        }
      }
      if (currentLaunchCommandPhase() === "complete") {
        setLaunchCommandPhase("coast");
      }

      const earthState = earthStateFromNBody(state);
      const rocketState = ensureRocketInNBody(state, nowMs);
      if (!earthState || !rocketState) {
        runtime.lastError = "Earth/rocket state unavailable";
        setLaunchCommandPhase("idle");
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
        setLaunchCommandPhase("idle");
        return;
      }

      const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371.0084;
      const currentEarthAxes = earthAxes(nowMs);
      const relPos = subtract(rocketState.position, earthState.position);
      const relVel = subtract(
        rocketState.velocity || { x: 0, y: 0, z: 0 },
        earthState.velocity || { x: 0, y: 0, z: 0 },
      );
      const moonState = bodyStateFromNBody(state, "moon");
      const toMoonVectorKm = finiteVector(moonState?.position)
        ? subtract(moonState.position, rocketState.position)
        : null;
      const moonApproachVelocityKmS = finiteVector(moonState?.velocity)
        ? subtract(
          moonState.velocity,
          rocketState.velocity || { x: 0, y: 0, z: 0 },
        )
        : null;
      updateRuntimeTargetMetrics(state, relPos, relVel, nowMs);
      const muKm3S2 = gravitationalConstantKm3PerKgS2 * (Number(getEarthMassKg?.()) || 0);
      const orbital = orbitalStateFromRelative(muKm3S2, earthRadiusKm, relPos, relVel);
      const environmentSample = launchEnvironmentSample(relPos, currentEarthAxes, earthRadiusKm, nowMs);
      const altitudeKm = environmentSample.altitudeKm;
      const atmo = environmentSample.atmosphereSample;
      const windSample = environmentSample.windSample;
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
      let passiveVehiclePhase = launchVehiclePhaseFromKinematics({
        earthState,
        rocketState,
        earthRadiusKm,
        earthPole: currentEarthAxes.pole,
        orbital,
        altitudeAboveTerrainKm: resolvedLaunchVehicleAltitudeAboveTerrainKm(orbital?.altitudeKm),
      });

      const activeStage = stageAtIndex(runtime.stageIndex);
      const stageNominalPropellantKg = Number(activeStage?.propellantMassKg) || 0;
      const stagePropellantFraction = stageNominalPropellantKg > 1e-6
        ? clamp(runtime.stagePropellantKg / stageNominalPropellantKg, 0, 1)
        : 0;
      const stageDryMassKg = Number(activeStage?.dryMassKg) || 0;
      const stageAttachedMassKg = runtime.stageIndex === 0
        ? Math.max(0, (Number(rocketState.massKg) || 0) - stageDryMassKg - Math.max(0, Number(runtime.stagePropellantKg) || 0))
        : (
          runtime.booster.attached && !runtime.booster.active
            ? attachedBoosterMassKgFromRuntime()
            : 0
        );
      runtime.stageMassModel = updateMassModelState(runtime.stageMassModel, {
        propellantFraction: stagePropellantFraction,
        bodyKind: stageBodyKindFromStageIndex(runtime.stageIndex),
        dtSeconds,
        dryMassKg: stageDryMassKg,
        propellantMassKg: stageNominalPropellantKg,
        attachedMassKg: stageAttachedMassKg,
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
          windVectorKmS: windSample.vectorKmS,
          dynamicPressurePaOverride: runtime.lastStep?.dynamicPressurePa ?? dynamicPressurePa,
          runtime,
        });
      };

      const launchClearanceAltitudeKm = (() => {
        const centerAltitudeAboveTerrainKm = Number(runtime.lastSurfaceSample?.altitudeAboveTerrainKm);
        if (Number.isFinite(centerAltitudeAboveTerrainKm)) {
          return Math.max(0, centerAltitudeAboveTerrainKm - STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM);
        }
        const orbitalAltitudeKm = Number(orbital?.altitudeKm);
        return Number.isFinite(orbitalAltitudeKm) ? Math.max(0, orbitalAltitudeKm) : 0;
      })();

      const setFlightStep = ({
        desiredDirection,
        requestedThrottle = 0,
        guidanceMode = "coast",
        advisoryPhase = null,
        advisorySource = "flight-control",
        advisoryReason = "",
        angularAccelerationRadS2 = null,
        angularDampingPerS = null,
        maxBodyRateDegS = null,
      }) => {
        let effectiveGuidanceMode = String(guidanceMode || "coast");
        let directionRequested = normalize(
          desiredDirection || normalize(relVel, orbital.up),
          orbital.up,
        );
        const moonAttitudePolicy = resolveMoonMissionAttitudeDirection({
          missionId: runtime.mission.selectedId,
          missionPhase: runtime.mission.phase,
          requestedThrottle,
          desiredDirection: directionRequested,
          toMoonVectorKm,
          moonApproachVelocityKmS,
          fallbackDirection: orbital.up,
          currentDirection: runtime.stageActuator?.directionActual || directionRequested,
          dtSeconds,
        });
        directionRequested = moonAttitudePolicy.requestedDirection;
        const moonCoastTrimBurn = resolveMoonCoastTrimBurn({
          missionId: runtime.mission.selectedId,
          missionPhase: runtime.mission.phase,
          requestedThrottle,
          desiredDirection: directionRequested,
          passiveMoonCoastPointing: moonAttitudePolicy.passiveMoonCoastPointing,
          passiveMoonCoastAttitudeAssist: moonAttitudePolicy.passiveMoonCoastAttitudeAssist,
          moonDirectionKm: toMoonVectorKm,
          currentDirection: runtime.stageActuator?.directionActual || directionRequested,
          nowSec: nowMs / 1000,
          trimPending: runtime.moonCoastTrimPending,
          trimActiveUntilSec: runtime.moonCoastTrimActiveUntilSec,
          trimLastBurnSec: runtime.moonCoastTrimLastBurnSec,
        });
        runtime.moonCoastTrimPending = Boolean(moonCoastTrimBurn.pending);
        runtime.moonCoastTrimActiveUntilSec = moonCoastTrimBurn.activeUntilSec;
        runtime.moonCoastTrimLastBurnSec = moonCoastTrimBurn.lastBurnSec;
        if (moonCoastTrimBurn.active) {
          directionRequested = normalize(
            moonCoastTrimBurn.direction || directionRequested,
            directionRequested,
          );
          requestedThrottle = Math.max(
            Number(requestedThrottle) || 0,
            Number(moonCoastTrimBurn.throttle) || 0,
          );
        }
        const bodyKind = stageBodyKindFromStageIndex(runtime.stageIndex);
        const stageForStep = stageAtIndex(runtime.stageIndex);
        const padReleaseDurationSec = Math.max(
          0,
          Number(LAUNCH_AUTOPILOT_CONFIG.padReleaseDurationSec) || 0,
        );
        const towerClearAltitudeKm = Math.max(
          0,
          Number(LAUNCH_AUTOPILOT_CONFIG.towerClearAltitudeKm) || 0,
        );
        const earlyPadLaunchActive =
          currentLaunchCommandPhase() === "powered"
          && runtime.stageIndex === 0
          && (Number(requestedThrottle) || 0) > 1e-3
          && Number.isFinite(launchClearanceAltitudeKm)
          && launchClearanceAltitudeKm < towerClearAltitudeKm;
        if (earlyPadLaunchActive) {
          const earlyLaunchMode = runtime.elapsedSeconds < padReleaseDurationSec
            ? "autopilot-pad-release"
            : "autopilot-tower-clear";
          const modeSuffixes = [];
          if (effectiveGuidanceMode.includes("vertical-hold")) {
            modeSuffixes.push("vertical-hold");
          }
          effectiveGuidanceMode = modeSuffixes.length > 0
            ? `${earlyLaunchMode}+${modeSuffixes.join("+")}`
            : earlyLaunchMode;
          runtime.autopilotMode = earlyLaunchMode;
        }
        const controlCommand = augmentAttitudeCommand({
          phase: (Number(requestedThrottle) || 0) > 1e-3
            ? "powered"
            : (passiveVehiclePhase === "orbit" ? "orbit" : "coast"),
          throttle: requestedThrottle,
          direction: directionRequested,
          mode: effectiveGuidanceMode,
          angularAccelerationRadS2,
          angularDampingPerS,
          maxBodyRateDegS,
        }, {
          runtime,
          altitudeKm: launchClearanceAltitudeKm,
          dynamicPressurePa,
        });
        let commandedAngularAccelerationRadS2 = Number.isFinite(Number(controlCommand.angularAccelerationRadS2))
          ? Number(controlCommand.angularAccelerationRadS2)
          : null;
        let commandedAngularDampingPerS = Number.isFinite(Number(controlCommand.angularDampingPerS))
          ? Number(controlCommand.angularDampingPerS)
          : null;
        let commandedMaxBodyRateDegS = Number.isFinite(Number(controlCommand.maxBodyRateDegS))
          ? Number(controlCommand.maxBodyRateDegS)
          : null;
        const lowAltitudeQAlphaBypass =
          runtime.stageIndex === 0
          && (
            launchClearanceAltitudeKm <= ((Number(LAUNCH_AUTOPILOT_CONFIG.verticalAscentMaxAltitudeKm) || 0) + 2)
            || effectiveGuidanceMode.includes("vertical")
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
        if (qAlphaSteering.limited) {
          if (Number.isFinite(commandedAngularAccelerationRadS2)) {
            commandedAngularAccelerationRadS2 *= 0.82;
          }
          if (Number.isFinite(commandedAngularDampingPerS)) {
            commandedAngularDampingPerS = Math.max(commandedAngularDampingPerS, 0.82);
          }
          if (Number.isFinite(commandedMaxBodyRateDegS)) {
            commandedMaxBodyRateDegS *= 0.84;
          }
        }
        const pressurePa = Number(atmo?.pressurePa) || 0;
        let throttleCommand = clamp(Number(requestedThrottle) || 0, 0, 1);
        const requestedPhase = String(
          advisoryPhase
          || ((Number(requestedThrottle) || 0) > 1e-3 ? "powered" : (passiveVehiclePhase === "orbit" ? "orbit" : "coast"))
          || "coast"
        );
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
        if (moonAttitudeGate.gateActive) {
          if (Number.isFinite(commandedAngularDampingPerS)) {
            commandedAngularDampingPerS = Math.max(commandedAngularDampingPerS, 0.92);
          }
          if (Number.isFinite(commandedMaxBodyRateDegS)) {
            commandedMaxBodyRateDegS = Math.min(commandedMaxBodyRateDegS, 3.6);
          }
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
          angularAccelerationRadS2: commandedAngularAccelerationRadS2,
          angularDampingPerS: commandedAngularDampingPerS,
          maxBodyRateRadS: Number.isFinite(commandedMaxBodyRateDegS)
            ? rad(commandedMaxBodyRateDegS)
            : null,
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
          const fullThrustN = interpolateConfiguredThrustN(stageForStep, pressurePa);
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
          massModel: runtime.stageMassModel,
          throttle: throttleActual,
        });
        const moonCoastRcsAssist = (
          moonAttitudePolicy.passiveMoonCoastPointing
          && moonAttitudePolicy.passiveMoonCoastAttitudeAssist?.active
          && !(throttleActual > 1e-3)
        )
          ? {
            accelerationKmS2: { x: 0, y: 0, z: 0 },
            active: true,
            errorDeg: Number(moonAttitudePolicy.passiveMoonCoastAttitudeAssist.errorDeg) || 0,
            authority: Number(moonAttitudePolicy.passiveMoonCoastAttitudeAssist.authority) || 0,
            jets: Array.isArray(moonAttitudePolicy.passiveMoonCoastAttitudeAssist.jets)
              ? [...moonAttitudePolicy.passiveMoonCoastAttitudeAssist.jets]
              : [],
          }
          : null;
        const rcs = moonCoastRcsAssist || computeRcsAssist({
          stageIndex: runtime.stageIndex,
          desiredDirection: steeringDirection,
          relVel,
          up: orbital.up,
          controlAuthorityScale: runtime.stageMassModel.controlAuthorityScale,
        });
        let guidanceModeLabel = qAlphaSteering.limited
          ? `${effectiveGuidanceMode}+qalpha-limit`
          : effectiveGuidanceMode;
        if (runtime.moonBurnAttitudeGateActive && !guidanceModeLabel.includes("attitude-align")) {
          guidanceModeLabel = `${guidanceModeLabel}+attitude-align`;
        }
        const burnActive = throttleActual > 1e-3 || thrustN > 1;
        if (requestedPhase === "powered" && !burnActive && !guidanceModeLabel.includes("coast-fallback")) {
          guidanceModeLabel = `${guidanceModeLabel}+coast-fallback`;
        }
        runtime.lastStep = {
          accelerationKmS2: add(add(thrustAccelerationKmS2, aero.accelerationKmS2), rcs.accelerationKmS2),
          effectiveMassKg,
          throttle: throttleActual,
          throttleCommand: canThrust ? throttleCommand : 0,
          thrustN,
          burnKg,
          burnRateKgS,
          dynamicPressurePa: aero.dynamicPressurePa,
          guidanceMode: guidanceModeLabel,
          requestedDirectionKm: cloneVectorOrNull(steeringDirection),
          bodyAxisDirectionKm: cloneVectorOrNull(directionActual),
          thrustAccelerationKmS2: cloneVectorOrNull(thrustAccelerationKmS2),
          aeroAccelerationKmS2: cloneVectorOrNull(aero.accelerationKmS2),
          rcsAccelerationKmS2: cloneVectorOrNull(rcs.accelerationKmS2),
          rcsActive: rcs.active,
          rcsErrorDeg: rcs.errorDeg,
          rcsAuthority: rcs.authority,
          rcsJets: rcs.jets,
          angleOfAttackDeg: aero.angleOfAttackDeg,
          qAlphaPaRad: aero.qAlphaPaRad,
          machNumber: aero.machNumber,
          dragCoefficient: aero.dragCoefficient,
          liftCoefficient: aero.liftCoefficient,
          momentCoefficient: aero.momentCoefficient,
          gimbalErrorDeg: runtime.stageActuator.gimbalErrorDeg,
          windSpeedKmS: windSample.speedKmS,
          windEastMS: windSample.eastMS,
          windNorthMS: windSample.northMS,
          comNormalized: runtime.stageMassModel.comNormalized,
          inertiaNormalized: runtime.stageMassModel.inertiaNormalized,
          controlAuthorityScale: runtime.stageMassModel.controlAuthorityScale,
          maxAllowedAoADeg: qAlphaSteering.maxAllowedAoADeg,
          angularAccelerationCommandRadS2: commandedAngularAccelerationRadS2,
          angularDampingCommandPerS: commandedAngularDampingPerS,
          maxBodyRateCommandDegS: commandedMaxBodyRateDegS,
        };
        updateAttachedStackJointState(
          state,
          rocketState,
          earthState,
          currentEarthAxes,
          dtSeconds,
        );
        const resolvedCommandPhase = resolveLaunchCommandPhaseFromGuidanceAdvisory({
          requestedPhase,
          requestedThrottle: canThrust ? throttleCommand : 0,
          throttleActual,
          canThrust,
          passiveVehiclePhase,
          moonTransferMissionActive,
        });
        setLaunchCommandPhase(resolvedCommandPhase);
        setGuidanceAdvisory({
          source: advisorySource,
          requestedPhase,
          resolvedPhase: resolvedCommandPhase,
          requestedThrottle: canThrust ? throttleCommand : 0,
          requestedMode: effectiveGuidanceMode,
          reason: advisoryReason,
        });
        updateTelemetry();
      };

      const orbitalRefuelMissionActive =
        runtime.stageIndex >= 1
        && String(runtime?.mission?.phase || "") === "orbital_refuel";
      if (passiveVehiclePhase === "orbit" && orbitalRefuelMissionActive) {
        runtime.autopilotMode = "navsys:orbital-refuel-await-target";
        passiveVehiclePhase = "coast";
      }
      if (passiveVehiclePhase === "orbit" && moonTransferMissionActive) {
        passiveVehiclePhase = "coast";
      }
      if (passiveVehiclePhase === "orbit") {
        setFlightStep({
          desiredDirection: normalize(relVel, orbital.up),
          requestedThrottle: 0,
          guidanceMode: runtime.autopilotMode || "orbit-hold",
          advisoryPhase: "orbit",
          advisorySource: "physics-passive",
          advisoryReason: "passive-orbit-detected",
        });
        return;
      }
      if (currentLaunchCommandPhase() === "orbit") {
        runtime.autopilotMode = "autopilot-coast-to-circularize";
      }

      if (runtime.coastRemainingSec > 0) {
        runtime.coastRemainingSec = Math.max(0, runtime.coastRemainingSec - dtSeconds);
        setFlightStep({
          desiredDirection: normalize(relVel, orbital.up),
          requestedThrottle: 0,
          guidanceMode: "stage-post-burn-coast",
          advisoryPhase: runtime.coastRemainingSec > 0 ? "coast" : "powered",
          advisorySource: "stage-coast-timer",
          advisoryReason: "post-burn-coast-window",
        });
        return;
      }

      if (currentLaunchCommandPhase() === "coast") {
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
          if (autopilotCommand.phase === "orbit" && !moonTransferMissionActive) {
            runtime.autopilotMode = autopilotCommand.mode || runtime.autopilotMode;
            setFlightStep({
              desiredDirection: autopilotCommand.direction || normalize(relVel, orbital.up),
              requestedThrottle: 0,
              guidanceMode: autopilotCommand.mode || "autopilot-orbital-hold",
              advisoryPhase: "orbit",
              advisorySource: "autopilot",
              advisoryReason: "orbital-hold-request",
            });
            return;
          }
          if (autopilotCommand.phase !== "powered") {
            setFlightStep({
              desiredDirection: autopilotCommand.direction || normalize(relVel, orbital.up),
              requestedThrottle: 0,
              guidanceMode: autopilotCommand.mode || "coast",
              advisoryPhase: "coast",
              advisorySource: "autopilot",
              advisoryReason: "coast-guidance-request",
            });
            return;
          }
        } else {
          setFlightStep({
            desiredDirection: normalize(relVel, orbital.up),
            requestedThrottle: 0,
            guidanceMode: "coast",
            advisoryPhase: "coast",
            advisorySource: "manual",
            advisoryReason: "manual-coast",
          });
          return;
        }
      }

      const stage = stageAtIndex(runtime.stageIndex);
      if (!stage) {
        const stableOrbit = orbital.specificEnergy < 0 && Number(orbital.periapsisKm) > 80;
        runtime.autopilotMode = stableOrbit ? "autopilot-ballistic-hold" : "ballistic-coast";
        setFlightStep({
          desiredDirection: normalize(relVel, orbital.up),
          requestedThrottle: 0,
          guidanceMode: runtime.autopilotMode,
          advisoryPhase: stableOrbit ? "orbit" : "coast",
          advisorySource: "ballistic",
          advisoryReason: stableOrbit ? "stable-orbit-detected" : "ballistic-coast",
        });
        return;
      }

      let throttle = throttleForState(runtime.stageIndex, runtime.elapsedSeconds, dynamicPressurePa);
      let guidance = guidanceDirection({
        rocketState,
        earthState,
        earthAxes: currentEarthAxes,
        elapsedSeconds: runtime.elapsedSeconds,
        stageIndex: runtime.stageIndex,
        altitudeKm: launchClearanceAltitudeKm,
        dynamicPressurePa,
      });

      if (runtime.autopilotEnabled) {
        const activeRefuelTarget = refuelController.activeRendezvousTarget?.(state) || null;
        let autopilotCommand = computeAutopilotCommand({
          runtime,
          orbital: {
            ...orbital,
            altitudeKm: launchClearanceAltitudeKm,
          },
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
          autopilotCommand = augmentAttitudeCommand(missionCommand, {
            runtime,
            altitudeKm: launchClearanceAltitudeKm,
            dynamicPressurePa,
          });
        }
        if (autopilotCommand.phase === "coast") {
          setFlightStep({
            desiredDirection: autopilotCommand.direction || guidance.direction,
            requestedThrottle: 0,
            guidanceMode: autopilotCommand.mode || "autopilot-coast",
            advisoryPhase: "coast",
            advisorySource: "autopilot",
            advisoryReason: "coast-guidance-request",
          });
          return;
        }
        if (autopilotCommand.phase === "orbit") {
          runtime.autopilotMode = autopilotCommand.mode || runtime.autopilotMode;
          setFlightStep({
            desiredDirection: autopilotCommand.direction || guidance.direction,
            requestedThrottle: 0,
            guidanceMode: moonTransferMissionActive
              ? (autopilotCommand.mode || "mission-moon-orbit-return:coast")
              : (autopilotCommand.mode || "autopilot-orbital-hold"),
            advisoryPhase: moonTransferMissionActive ? "coast" : "orbit",
            advisorySource: "autopilot",
            advisoryReason: moonTransferMissionActive ? "mission-coast-request" : "orbital-hold-request",
          });
          return;
        }
        throttle = clamp(Number(autopilotCommand.throttle), 0, 1);
        guidance = {
          direction: autopilotCommand.direction || guidance.direction,
          mode: autopilotCommand.mode || guidance.mode,
          angularAccelerationRadS2: autopilotCommand.angularAccelerationRadS2 ?? guidance.angularAccelerationRadS2,
          angularDampingPerS: autopilotCommand.angularDampingPerS ?? guidance.angularDampingPerS,
          maxBodyRateDegS: autopilotCommand.maxBodyRateDegS ?? guidance.maxBodyRateDegS,
        };
      }

      const padReleaseDurationSec = Math.max(
        0,
        Number(LAUNCH_AUTOPILOT_CONFIG.padReleaseDurationSec) || 0,
      );
      const towerClearAltitudeKm = Math.max(
        0,
        Number(LAUNCH_AUTOPILOT_CONFIG.towerClearAltitudeKm) || 0,
      );
      if (
        runtime.stageIndex === 0
        && Number.isFinite(launchClearanceAltitudeKm)
        && launchClearanceAltitudeKm < towerClearAltitudeKm
      ) {
        const earlyLaunchMode = runtime.elapsedSeconds < padReleaseDurationSec
          ? "autopilot-pad-release"
          : "autopilot-tower-clear";
        runtime.autopilotMode = earlyLaunchMode;
        guidance = {
          ...guidance,
          direction: guidance.direction,
          mode: guidance.mode.includes("vertical-hold")
            ? `${earlyLaunchMode}+vertical-hold`
            : earlyLaunchMode,
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
            ...guidance,
            direction: normalize(
              add(scale(guidance.direction, 1), scale(orbital.up, upBias)),
              guidance.direction,
            ),
            mode: `${guidance.mode}+hotstage-ramp`,
          };
        } else {
          guidance = {
            ...guidance,
            direction: guidance.direction,
            mode: `${guidance.mode}+hotstage-ramp`,
          };
        }
      }

      setFlightStep({
        desiredDirection: guidance.direction,
        requestedThrottle: throttle,
        guidanceMode: guidance.mode,
        advisoryPhase: throttle > 1e-3 ? "powered" : (passiveVehiclePhase === "orbit" ? "orbit" : "coast"),
        advisorySource: runtime.autopilotEnabled ? "autopilot" : "open-loop-guidance",
        advisoryReason: runtime.autopilotEnabled ? "guided-flight-command" : "open-loop-profile",
        angularAccelerationRadS2: guidance.angularAccelerationRadS2,
        angularDampingPerS: guidance.angularDampingPerS,
        maxBodyRateDegS: guidance.maxBodyRateDegS,
      });
    } finally {
      emitRuntimeTransitionEvents("prepare_step");
    }
  }

  function externalAccelerationKmS2(bodyId) {
    if (bodyId === LAUNCH_BODY_ID) {
      if (runtime.attachedJoint.active) {
        return runtime.attachedJoint.shipAccelerationKmS2 || { x: 0, y: 0, z: 0 };
      }
      return runtime.lastStep?.accelerationKmS2 || { x: 0, y: 0, z: 0 };
    }
    if (bodyId === LAUNCH_BOOSTER_BODY_ID) {
      if (runtime.attachedJoint.active) {
        return runtime.attachedJoint.boosterAccelerationKmS2 || { x: 0, y: 0, z: 0 };
      }
      if (runtime.booster.attached && !runtime.booster.active) {
        return { x: 0, y: 0, z: 0 };
      }
      return runtime.booster.lastStep?.accelerationKmS2 || { x: 0, y: 0, z: 0 };
    }
    return fleetController.externalAccelerationKmS2(bodyId);
  }

  function finalizeStep(state, dtSeconds, nowMs = Date.now()) {
    try {
      const fleetActive = fleetController.hasActiveVehicles();
      const reportedVehiclePhaseAtFinalizeStart = currentLaunchVehiclePhase();
      if (
        currentLaunchCommandPhase() === "idle"
        && reportedVehiclePhaseAtFinalizeStart === "idle"
        && !runtime.booster.active
        && !fleetActive
      ) {
        repairIdlePrimaryLaunchBodyToPadIfNeeded(state, nowMs);
        return;
      }
      if (
        currentLaunchCommandPhase() === "idle"
        && reportedVehiclePhaseAtFinalizeStart === "idle"
        && !runtime.booster.active
      ) {
        repairIdlePrimaryLaunchBodyToPadIfNeeded(state, nowMs);
        fleetController.finalizeStep(state, dtSeconds, nowMs);
        return;
      }
      if (currentLaunchCommandPhase() === "complete") {
        setLaunchCommandPhase("coast");
      }
      const rocketState = rocketStateFromNBody(state);
      const earthState = earthStateFromNBody(state);
      if (!rocketState || !earthState) {
        setLaunchCommandPhase("idle");
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
        setLaunchCommandPhase("idle");
        fleetController.finalizeStep(state, dtSeconds, nowMs);
        return;
      }
      const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371.0084;
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
        setLaunchCommandPhase("coast");
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
        surfaceClearanceKm: primaryLaunchPadSurfaceClearanceKm(runtime),
        dtSeconds,
        thrustN: Number(runtime.lastStep?.thrustN) || 0,
        includeTerrain: true,
      });
      if (contact?.surfaceSample) {
        runtime.lastSurfaceSample = contact.surfaceSample;
      } else {
        updateRuntimeSurfaceSample(rocketState, earthState, currentEarthAxes, earthRadiusKm);
      }
      if (runtime.booster.attached && !runtime.booster.active) {
        stabilizeAttachedStackConstraint(
          state,
          rocketState,
          earthState,
          currentEarthAxes,
        );
        updateRuntimeSurfaceSample(rocketState, earthState, currentEarthAxes, earthRadiusKm);
      }

      const relPosAfterContact = subtract(rocketState.position, earthState.position);
      const relVelAfterContact = subtract(
        rocketState.velocity || { x: 0, y: 0, z: 0 },
        earthState.velocity || { x: 0, y: 0, z: 0 },
      );
      const muKm3S2AfterContact = gravitationalConstantKm3PerKgS2 * (Number(getEarthMassKg?.()) || 0);
      const orbitalAfterContact = orbitalStateFromRelative(
        muKm3S2AfterContact,
        earthRadiusKm,
        relPosAfterContact,
        relVelAfterContact,
      );
      const passiveVehiclePhase = launchVehiclePhaseFromKinematics({
        earthState,
        rocketState,
        earthRadiusKm,
        earthPole: currentEarthAxes.pole,
        orbital: orbitalAfterContact,
        altitudeAboveTerrainKm: resolvedLaunchVehicleAltitudeAboveTerrainKm(orbitalAfterContact?.altitudeKm),
      });
      if (passiveVehiclePhase === "orbit" && isMoonTransferMissionActive(runtime)) {
        setLaunchCommandPhase("coast");
      } else if (passiveVehiclePhase === "orbit") {
        setLaunchCommandPhase("orbit");
        const environmentSample = launchEnvironmentSample(relPosAfterContact, currentEarthAxes, earthRadiusKm, nowMs);
        const atmosphereSample = environmentSample.atmosphereSample;
        const windSample = environmentSample.windSample;
        const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
          atmosphereSample,
          relPosAfterContact,
          relVelAfterContact,
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
          windVectorKmS: windSample.vectorKmS,
          dynamicPressurePaOverride: dynamicPressurePa,
          runtime,
        });
        if (maybeFinalizePendingPadTankerLaunch(state, nowMs, {
          rocketState,
          orbital: orbitalAfterContact,
        })) {
          fleetController.finalizeStep(state, dtSeconds, nowMs);
          return;
        }
        finalizeBoosterStep(state, dtSeconds, nowMs);
        fleetController.finalizeStep(state, dtSeconds, nowMs);
        runtime.elapsedSeconds += dtSeconds;
        return;
      } else if (currentLaunchCommandPhase() === "orbit") {
        setLaunchCommandPhase("coast");
        runtime.autopilotMode = "autopilot-coast-to-circularize";
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
    if (runtime.booster.attached && !runtime.booster.active) {
      const attachedBoosterState = boosterStateFromNBody(state);
      if (attachedBoosterState) {
        attachedBoosterState.massKg = attachedBoosterMassKgFromRuntime();
        runtime.booster.lastTrackedPositionKm = earthFixedRelativePositionKm(
          attachedBoosterState,
          earthState,
          currentEarthAxes,
        );
      }
    }

    const stage = stageAtIndex(runtime.stageIndex);
    if (
      runtime.pendingStageTransition?.active
      && runtime.pendingStageTransition.fromStageIndex !== runtime.stageIndex
    ) {
      resetPendingStageTransition(runtime.pendingStageTransition);
    }
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
      const groundRelativeSpeedKmS = length(atmosphereRelativeVelocityKmS(
        relPosAfterContact,
        relVelAfterContact,
        currentEarthAxes.pole,
      ));
      if (runtime.stageIndex === 0) {
        const nextStage = stageAtIndex(1);
        if (nextStage) {
          const boosterReservePropellantKg = clamp(
            Math.max(0, Number(runtime.stagePropellantKg) || 0),
            0,
            stageReservePropellantKg(0),
          );
          requestPendingStageTransition({
            kind: "hotstage_ignite",
            fromStageIndex: runtime.stageIndex,
            toStageIndex: 1,
            requestReason: "stage0_propellant_depleted",
            reservePropellantKg: boosterReservePropellantKg,
            altitudeKm: resolvedLaunchVehicleAltitudeAboveTerrainKm(orbitalAfterContact?.altitudeKm),
            groundRelativeSpeedKmS,
            dynamicPressurePa: runtime.lastStep?.dynamicPressurePa,
          });
          emitLaunchEvent("stage_transition_requested", {
            transitionKind: "hotstage_ignite",
            fromStageIndex: 0,
            toStageIndex: 1,
            requestReason: runtime.pendingStageTransition.requestReason,
            reservePropellantKg: boosterReservePropellantKg,
            altitudeAboveTerrainKm: runtime.pendingStageTransition.requestAltitudeKm,
            groundRelativeSpeedKmS,
            dynamicPressurePa: runtime.pendingStageTransition.requestDynamicPressurePa,
          });
        } else {
          rocketState.massKg = Math.max(
            MIN_ROCKET_MASS_KG,
            rocketState.massKg - (Number(stage.dryMassKg) || 0),
          );
          runtime.stageIndex += 1;
          runtime.stagePropellantKg = 0;
          setLaunchCommandPhase("coast");
          runtime.autopilotMode = "ballistic-coast";
          runtime.stageActuator = createActuatorState(
            normalize(subtract(rocketState.position, earthState.position), currentEarthAxes.pole),
          );
          runtime.stageMassModel = createMassModelState();
        }
      } else {
        const nextStage = stageAtIndex(runtime.stageIndex + 1);
        if (nextStage) {
          requestPendingStageTransition({
            kind: "next_stage_separation",
            fromStageIndex: runtime.stageIndex,
            toStageIndex: runtime.stageIndex + 1,
            requestReason: "stage_propellant_depleted",
            reservePropellantKg: 0,
            altitudeKm: resolvedLaunchVehicleAltitudeAboveTerrainKm(orbitalAfterContact?.altitudeKm),
            groundRelativeSpeedKmS,
            dynamicPressurePa: runtime.lastStep?.dynamicPressurePa,
          });
          emitLaunchEvent("stage_transition_requested", {
            transitionKind: "next_stage_separation",
            fromStageIndex: runtime.stageIndex,
            toStageIndex: runtime.stageIndex + 1,
            requestReason: runtime.pendingStageTransition.requestReason,
            altitudeAboveTerrainKm: runtime.pendingStageTransition.requestAltitudeKm,
            groundRelativeSpeedKmS,
            dynamicPressurePa: runtime.pendingStageTransition.requestDynamicPressurePa,
          });
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
          setLaunchCommandPhase("coast");
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

    if (runtime.pendingStageTransition?.active) {
      const transitionAuthorization = evaluatePendingStageTransitionAuthorization({
        earthState,
        rocketState,
        earthRadiusKm,
        earthPole: currentEarthAxes.pole,
        orbital: orbitalAfterContact,
        dynamicPressurePa: runtime.lastStep?.dynamicPressurePa,
      });
      if (transitionAuthorization.authorized) {
        applyAuthorizedPendingStageTransition({
          state,
          rocketState,
          earthState,
          currentEarthAxes,
          earthRadiusKm,
          authorization: transitionAuthorization,
        });
      }
    }

    if (runtime.hotstage.active && runtime.booster.attached && !runtime.booster.active) {
      stabilizeAttachedStackConstraint(
        state,
        rocketState,
        earthState,
        currentEarthAxes,
      );
    }

    // Hot-staging overlap: detach booster when stage-2 ignition is stable and overlap gates are met.
    if (runtime.hotstage.active && !runtime.booster.active) {
      const stage2 = stageAtIndex(1);
      const stage2PeakThrustBounds = configuredThrustBoundsN(stage2);
      const stage2PeakThrustN = Math.max(
        Number(stage2PeakThrustBounds.thrustVacuumN) || 0,
        Number(stage2PeakThrustBounds.thrustSeaLevelN) || 0,
      );
      const hotstageGate = updateHotstageGates(runtime.hotstage, {
        elapsedSeconds: runtime.elapsedSeconds,
        stageIndex: runtime.stageIndex,
        phase: currentLaunchCommandPhase(),
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
        const hotstageEnvelope = evaluateHotstageRealismEnvelope(
          runtime,
          rocketState,
          earthState,
          earthRadiusKm,
        );
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
          altitudeKm: hotstageEnvelope.altitudeKm,
          speedKmS: hotstageEnvelope.speedKmS,
          realismEnvelopeSatisfied: hotstageEnvelope.withinEnvelope,
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
      const environmentSample = launchEnvironmentSample(relPosNow, currentEarthAxes, earthRadiusKm, nowMs);
      const atmosphereSample = environmentSample.atmosphereSample;
      const windSample = environmentSample.windSample;
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
        windVectorKmS: windSample.vectorKmS,
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
    repairIdlePrimaryLaunchBodyToPadIfNeeded(state, Date.now());
    const telemetry = runtime.lastTelemetry;
    const launchPhase = reportedLaunchPhase(
      currentLaunchCommandPhase(),
      telemetry,
      runtime.lastStep,
      runtime.targetOrbitAltitudeKm,
    );
    const boosterPhase = reportedBoosterPhase(runtime.booster.telemetry, runtime.booster);
    const targetDescriptor = missionTargetDescriptor();
    const directionTelemetry = resolveRelativeDirectionTelemetry(state, LAUNCH_BODY_ID);
    const hotstageSinceIgnitionSec = hotstageTimeSinceIgnitionSec(runtime.hotstage, runtime.elapsedSeconds);
    const hotstageSnapshotOffsets = computeHotstageRelativeOffsetsKm({
      hotstage: runtime.hotstage,
      elapsedSeconds: runtime.elapsedSeconds,
    });
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
        phase: launchPhase,
        commandPhase: currentLaunchCommandPhase(),
        phaseLabel: phaseLabel(launchPhase),
        stageIndex: runtime.stageIndex,
        autopilotMode: runtime.autopilotMode || "manual",
        targetOrbitAltitudeKm: runtime.targetOrbitAltitudeKm,
        missionId: runtime.mission.selectedId,
        missionName: safeMissionProfile(runtime.mission.selectedId)?.name || "Mission",
        missionPhase: runtime.mission.phase,
        missionPhaseDisplay: displayMissionPhaseForMission(runtime.mission.selectedId, runtime.mission.phase),
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
        missionPhasePending: Boolean(runtime.pendingMissionPhase?.active),
        missionPhaseRequested: runtime.pendingMissionPhase?.active ? String(runtime.pendingMissionPhase.requestedPhase || "") : "",
        missionPhaseAuthorizationMode: runtime.pendingMissionPhase?.active ? String(runtime.pendingMissionPhase.authorizationMode || "") : "",
        guidanceAdvisorySource: String(runtime.guidanceAdvisory?.source || ""),
        guidanceAdvisoryRequestedPhase: String(runtime.guidanceAdvisory?.requestedPhase || "idle"),
        guidanceAdvisoryResolvedPhase: String(runtime.guidanceAdvisory?.resolvedPhase || "idle"),
        guidanceAdvisoryRequestedThrottle: clamp(Number(runtime.guidanceAdvisory?.requestedThrottle) || 0, 0, 1),
        guidanceAdvisoryRequestedMode: String(runtime.guidanceAdvisory?.requestedMode || ""),
        stageTransitionPending: Boolean(runtime.pendingStageTransition?.active),
        stageTransitionKind: runtime.pendingStageTransition?.active ? String(runtime.pendingStageTransition.kind || "") : "",
        stageTransitionWaitReason: runtime.pendingStageTransition?.active ? String(runtime.pendingStageTransition.waitReason || "") : "",
        stageTransitionAuthorizationMode: runtime.pendingStageTransition?.active ? String(runtime.pendingStageTransition.authorizationMode || "") : "",
        targetBodyId: targetDescriptor.bodyId,
        targetBodyName: targetDescriptor.bodyName,
        targetDistanceKm: targetDescriptor.distanceKm,
        targetClosingSpeedKmS: targetDescriptor.closingSpeedKmS,
        ...directionTelemetry,
        rcsActive: refuelShipRcsActive,
        rcsErrorDeg: 0,
        rcsAuthority: refuelShipRcsActive ? refuelShipRcsAuthority : 0,
        rcsJets: refuelShipRcsActive ? refuelShipRcsJets : [],
        boosterDistanceKm: runtime.boosterDistanceKm,
        starshipDistanceKm: runtime.starshipDistanceKm,
        boosterPhase,
        boosterCommandPhase: currentBoosterCommandPhase(),
        boosterGuidanceMode: runtime.booster.guidanceMode,
        attachedJointActive: Boolean(runtime.attachedJoint.active),
        attachedJointLoadMN: Number(runtime.attachedJoint.reactionForceN) / 1e6 || 0,
        attachedJointErrorM: length(runtime.attachedJoint.positionErrorKm || { x: 0, y: 0, z: 0 }) * 1000,
        attachedJointRelativeSpeedMS: length(runtime.attachedJoint.relativeVelocityKmS || { x: 0, y: 0, z: 0 }) * 1000,
        attachedJointShipMassKg: Number(runtime.attachedJoint.shipMassKg) || 0,
        attachedJointBoosterMassKg: Number(runtime.attachedJoint.boosterMassKg) || 0,
        boosterActive: runtime.booster.active,
        boosterLanded: runtime.booster.landed,
        boosterThrottle: Number(runtime.booster.lastStep?.throttle) || 0,
        boosterThrustN: Number(runtime.booster.lastStep?.thrustN) || 0,
        boosterRcsActive: Boolean(runtime.booster.lastStep?.rcsActive),
        boosterRcsErrorDeg: Number(runtime.booster.lastStep?.rcsErrorDeg) || 0,
        boosterRcsAuthority: Number(runtime.booster.lastStep?.rcsAuthority) || 0,
        boosterRcsAccelerationKmS2: cloneLaunchVectorOrNull(runtime.booster.lastStep?.rcsAccelerationKmS2),
        boosterRcsAccelerationMagKmS2: Number(runtime.booster.lastStep?.rcsAccelerationMagKmS2) || 0,
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
        boosterRequestedDirectionKm: cloneLaunchVectorOrNull(runtime.booster.lastStep?.requestedDirectionKm),
        boosterBodyAxisDirectionKm: cloneLaunchVectorOrNull(runtime.booster.lastStep?.bodyAxisDirectionKm),
        boosterRequestedOffRetrogradeDeg: Number.isFinite(Number(runtime.booster.telemetry?.requestedOffRetrogradeDeg))
          ? Number(runtime.booster.telemetry?.requestedOffRetrogradeDeg)
          : null,
        boosterBodyOffRetrogradeDeg: Number.isFinite(Number(runtime.booster.telemetry?.bodyOffRetrogradeDeg))
          ? Number(runtime.booster.telemetry?.bodyOffRetrogradeDeg)
          : null,
        boosterBodyAngularRateRadS: cloneLaunchVectorOrNull(runtime.booster.lastStep?.bodyAngularRateRadS),
        boosterGridFinAuthority: Number(runtime.booster.lastStep?.gridFinAuthority) || 0,
        boosterGridFinDeflectionDeg: Number(runtime.booster.lastStep?.gridFinDeflectionDeg) || 0,
        boosterGridFinMomentNm: Number(runtime.booster.lastStep?.gridFinMomentNm) || 0,
        boosterGridFinAngularAccelerationRadS2: Number(runtime.booster.lastStep?.gridFinAngularAccelerationRadS2) || 0,
        boosterEarthRelativeSpeedKmS: Number(runtime.booster.telemetry?.earthRelativeSpeedKmS) || null,
        boosterGroundRelativeSpeedKmS: Number(runtime.booster.telemetry?.groundRelativeSpeedKmS) || null,
        boosterAirRelativeSpeedKmS: Number(runtime.booster.telemetry?.airRelativeSpeedKmS) || null,
        boosterInertialSpeedKmS: Number(runtime.booster.telemetry?.inertialSpeedKmS) || null,
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
        boosterCatchTotalRangeKm: Number(runtime.booster.telemetry?.catchTotalRangeKm) || null,
        boosterCatchLateralSpeedKmS: Number(runtime.booster.telemetry?.catchLateralSpeedKmS) || null,
        boosterCatchVerticalSpeedKmS: Number(runtime.booster.telemetry?.catchVerticalSpeedKmS) || null,
        boosterCatchAlignHoldSec: Number(runtime.booster.telemetry?.catchAlignHoldSec) || Number(runtime.booster.catchAlignHoldSec) || 0,
        boosterNavSource: String(runtime.booster.telemetry?.navSource || ""),
        boosterNavPositionSigmaKm: Number(runtime.booster.telemetry?.navPositionSigmaKm) || null,
        boosterNavVelocitySigmaKmS: Number(runtime.booster.telemetry?.navVelocitySigmaKmS) || null,
        boosterNavTowerRelativeActive: Boolean(runtime.booster.telemetry?.navTowerRelativeActive),
        hotstageActive: Boolean(runtime.hotstage.active),
        hotstageTimeSinceIgnitionSec: hotstageSinceIgnitionSec,
        hotstageOverlapSeconds: Number(runtime.hotstage.overlapSeconds) || hotstageOverlapSeconds(),
        hotstageIgnitionStableSec: Number(runtime.hotstage.ignitionStableSec) || 0,
        hotstageVirtualSeparationKm: Number(runtime.hotstage.virtualSeparationKm) || 0,
        hotstageDisplayedGapKm: hotstageSnapshotOffsets.displayedGapKm,
        hotstageShipOffsetKm: hotstageSnapshotOffsets.shipOffsetKm,
        hotstageBoosterOffsetKm: hotstageSnapshotOffsets.boosterOffsetKm,
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
      phase: launchPhase,
      commandPhase: telemetry.commandPhase || currentLaunchCommandPhase(),
      phaseLabel: phaseLabel(launchPhase),
      stageName: telemetry.stageName,
      stageIndex: telemetry.stageIndex,
      launchSiteName: LAUNCH_SITE.name || "Launch Site",
      elapsedSeconds: telemetry.elapsedSeconds,
      massKg: telemetry.massKg,
      altitudeKm: telemetry.altitudeKm,
      speedKmS: telemetry.speedKmS,
      earthRelativeSpeedKmS: telemetry.earthRelativeSpeedKmS,
      groundRelativeSpeedKmS: telemetry.groundRelativeSpeedKmS,
      airRelativeSpeedKmS: telemetry.airRelativeSpeedKmS,
      inertialSpeedKmS: telemetry.inertialSpeedKmS,
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
      missionPhaseDisplay: displayMissionPhaseForMission(telemetry.missionId, telemetry.missionPhase),
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
      missionPhasePending: Boolean(runtime.pendingMissionPhase?.active),
      missionPhaseRequested: runtime.pendingMissionPhase?.active ? String(runtime.pendingMissionPhase.requestedPhase || "") : "",
      missionPhaseAuthorizationMode: runtime.pendingMissionPhase?.active ? String(runtime.pendingMissionPhase.authorizationMode || "") : "",
      guidanceAdvisorySource: String(runtime.guidanceAdvisory?.source || ""),
      guidanceAdvisoryRequestedPhase: String(runtime.guidanceAdvisory?.requestedPhase || "idle"),
      guidanceAdvisoryResolvedPhase: String(runtime.guidanceAdvisory?.resolvedPhase || currentLaunchCommandPhase()),
      guidanceAdvisoryRequestedThrottle: clamp(Number(runtime.guidanceAdvisory?.requestedThrottle) || 0, 0, 1),
      guidanceAdvisoryRequestedMode: String(runtime.guidanceAdvisory?.requestedMode || ""),
      stageTransitionPending: Boolean(runtime.pendingStageTransition?.active),
      stageTransitionKind: runtime.pendingStageTransition?.active ? String(runtime.pendingStageTransition.kind || "") : "",
      stageTransitionWaitReason: runtime.pendingStageTransition?.active ? String(runtime.pendingStageTransition.waitReason || "") : "",
      stageTransitionAuthorizationMode: runtime.pendingStageTransition?.active ? String(runtime.pendingStageTransition.authorizationMode || "") : "",
      targetBodyId: targetDescriptor.bodyId,
      targetBodyName: targetDescriptor.bodyName,
      targetDistanceKm: targetDescriptor.distanceKm,
      targetClosingSpeedKmS: targetDescriptor.closingSpeedKmS,
      ...directionTelemetry,
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
      boosterPhase,
      boosterCommandPhase: runtime.booster.telemetry?.commandPhase || currentBoosterCommandPhase(),
      boosterGuidanceMode: runtime.booster.telemetry?.guidanceMode || runtime.booster.guidanceMode,
      attachedJointActive: Boolean(runtime.attachedJoint.active),
      attachedJointLoadMN: Number(runtime.attachedJoint.reactionForceN) / 1e6 || 0,
      attachedJointErrorM: length(runtime.attachedJoint.positionErrorKm || { x: 0, y: 0, z: 0 }) * 1000,
      attachedJointRelativeSpeedMS: length(runtime.attachedJoint.relativeVelocityKmS || { x: 0, y: 0, z: 0 }) * 1000,
      attachedJointShipMassKg: Number(runtime.attachedJoint.shipMassKg) || 0,
      attachedJointBoosterMassKg: Number(runtime.attachedJoint.boosterMassKg) || 0,
      boosterAttached: runtime.booster.attached,
      boosterActive: runtime.booster.active,
      boosterLanded: runtime.booster.landed,
      boosterThrottle: Number(runtime.booster.telemetry?.throttle) || Number(runtime.booster.lastStep?.throttle) || 0,
      boosterThrustN: Number(runtime.booster.telemetry?.thrustN) || Number(runtime.booster.lastStep?.thrustN) || 0,
      boosterRcsActive: Boolean(runtime.booster.telemetry?.rcsActive ?? runtime.booster.lastStep?.rcsActive),
      boosterRcsErrorDeg: Number(runtime.booster.telemetry?.rcsErrorDeg) || Number(runtime.booster.lastStep?.rcsErrorDeg) || 0,
      boosterRcsAuthority: Number(runtime.booster.telemetry?.rcsAuthority) || Number(runtime.booster.lastStep?.rcsAuthority) || 0,
      boosterRcsAccelerationKmS2: cloneLaunchVectorOrNull(runtime.booster.telemetry?.rcsAccelerationKmS2)
        || cloneLaunchVectorOrNull(runtime.booster.lastStep?.rcsAccelerationKmS2),
      boosterRcsAccelerationMagKmS2: Number(runtime.booster.telemetry?.rcsAccelerationMagKmS2)
        || Number(runtime.booster.lastStep?.rcsAccelerationMagKmS2)
        || 0,
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
      boosterRequestedDirectionKm: cloneLaunchVectorOrNull(runtime.booster.telemetry?.requestedDirectionKm)
        || cloneLaunchVectorOrNull(runtime.booster.lastStep?.requestedDirectionKm),
      boosterBodyAxisDirectionKm: cloneLaunchVectorOrNull(runtime.booster.telemetry?.bodyAxisDirectionKm)
        || cloneLaunchVectorOrNull(runtime.booster.lastStep?.bodyAxisDirectionKm),
      boosterRequestedOffRetrogradeDeg: Number.isFinite(Number(runtime.booster.telemetry?.requestedOffRetrogradeDeg))
        ? Number(runtime.booster.telemetry?.requestedOffRetrogradeDeg)
        : null,
      boosterBodyOffRetrogradeDeg: Number.isFinite(Number(runtime.booster.telemetry?.bodyOffRetrogradeDeg))
        ? Number(runtime.booster.telemetry?.bodyOffRetrogradeDeg)
        : null,
      boosterBodyAngularRateRadS: cloneLaunchVectorOrNull(runtime.booster.telemetry?.bodyAngularRateRadS)
        || cloneLaunchVectorOrNull(runtime.booster.lastStep?.bodyAngularRateRadS),
      boosterGridFinAuthority: Number(runtime.booster.telemetry?.gridFinAuthority) || 0,
      boosterGridFinDeflectionDeg: Number(runtime.booster.telemetry?.gridFinDeflectionDeg) || 0,
      boosterGridFinMomentNm: Number(runtime.booster.telemetry?.gridFinMomentNm) || 0,
      boosterGridFinAngularAccelerationRadS2: Number(runtime.booster.telemetry?.gridFinAngularAccelerationRadS2) || 0,
      boosterEarthRelativeSpeedKmS: Number(runtime.booster.telemetry?.earthRelativeSpeedKmS) || null,
      boosterGroundRelativeSpeedKmS: Number(runtime.booster.telemetry?.groundRelativeSpeedKmS) || null,
      boosterAirRelativeSpeedKmS: Number(runtime.booster.telemetry?.airRelativeSpeedKmS) || null,
      boosterInertialSpeedKmS: Number(runtime.booster.telemetry?.inertialSpeedKmS) || null,
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
      boosterCatchTotalRangeKm: Number(runtime.booster.telemetry?.catchTotalRangeKm) || null,
      boosterCatchLateralSpeedKmS: Number(runtime.booster.telemetry?.catchLateralSpeedKmS) || null,
      boosterCatchVerticalSpeedKmS: Number(runtime.booster.telemetry?.catchVerticalSpeedKmS) || null,
      boosterCatchAlignHoldSec: Number(runtime.booster.telemetry?.catchAlignHoldSec) || Number(runtime.booster.catchAlignHoldSec) || 0,
      boosterNavSource: String(runtime.booster.telemetry?.navSource || ""),
      boosterNavPositionSigmaKm: Number(runtime.booster.telemetry?.navPositionSigmaKm) || null,
      boosterNavVelocitySigmaKmS: Number(runtime.booster.telemetry?.navVelocitySigmaKmS) || null,
      boosterNavTowerRelativeActive: Boolean(runtime.booster.telemetry?.navTowerRelativeActive),
      hotstageActive: Boolean(telemetry.hotstageActive),
      hotstageTimeSinceIgnitionSec: telemetry.hotstageTimeSinceIgnitionSec,
      hotstageOverlapSeconds: telemetry.hotstageOverlapSeconds,
      hotstageIgnitionStableSec: telemetry.hotstageIgnitionStableSec,
      hotstageVirtualSeparationKm: telemetry.hotstageVirtualSeparationKm,
      hotstageDisplayedGapKm: Number.isFinite(Number(telemetry.hotstageDisplayedGapKm))
        ? Number(telemetry.hotstageDisplayedGapKm)
        : hotstageSnapshotOffsets.displayedGapKm,
      hotstageShipOffsetKm: Number.isFinite(Number(telemetry.hotstageShipOffsetKm))
        ? Number(telemetry.hotstageShipOffsetKm)
        : hotstageSnapshotOffsets.shipOffsetKm,
      hotstageBoosterOffsetKm: Number.isFinite(Number(telemetry.hotstageBoosterOffsetKm))
        ? Number(telemetry.hotstageBoosterOffsetKm)
        : hotstageSnapshotOffsets.boosterOffsetKm,
      hotstageDetachReason: telemetry.hotstageDetachReason,
      terrainElevationKm: telemetry.terrainElevationKm,
      altitudeAboveTerrainKm: telemetry.altitudeAboveTerrainKm,
      latitudeDeg: telemetry.latitudeDeg,
      longitudeDeg: telemetry.longitudeDeg,
      statusLine: runtime.lastError || `${phaseLabel(launchPhase)} | ${telemetry.stageName}`,
    };
  }

  function statusSnapshotForBody(state, bodyId = LAUNCH_BODY_ID, nowMs = Date.now()) {
    if (String(bodyId || "") === LAUNCH_BODY_ID) {
      repairIdlePrimaryLaunchBodyToPadIfNeeded(state, nowMs);
    }
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
    runtime.pendingMissionPhase = resetPendingMissionPhaseState(runtime.pendingMissionPhase);
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
      commandPhase: currentLaunchCommandPhase(),
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
      attachedJoint: cloneJson(runtime.attachedJoint, createAttachedStackJointState()),
      guidanceAdvisory: cloneJson(runtime.guidanceAdvisory, createGuidanceAdvisoryState()),
      stage2RefuelRecoveryApplied: Boolean(runtime.stage2RefuelRecoveryApplied),
      mission: {
        selectedId: normalizeMissionId(runtime.mission.selectedId),
        phase: String(runtime.mission.phase || ""),
        phaseStartedElapsedSec: Math.max(0, finiteNumber(runtime.mission.phaseStartedElapsedSec, 0)),
        completed: Boolean(runtime.mission.completed),
      },
      pendingMissionPhase: cloneJson(runtime.pendingMissionPhase, createPendingMissionPhaseState()),
      booster: {
        attached: Boolean(runtime.booster.attached),
        active: Boolean(runtime.booster.active),
        commandPhase: currentBoosterCommandPhase(),
        phase: String(runtime.booster.phase || "idle"),
        guidanceMode: String(runtime.booster.guidanceMode || "booster-idle"),
        attitude: cloneJson(runtime.booster.attitude, createBoosterAttitudeState({ x: 0, y: 0, z: 1 })),
        propellantKg: Math.max(0, finiteNumber(runtime.booster.propellantKg, 0)),
        initialPropellantKg: Math.max(0, finiteNumber(runtime.booster.initialPropellantKg, 0)),
        separationTimeSec: Math.max(0, finiteNumber(runtime.booster.separationTimeSec, 0)),
        landed: Boolean(runtime.booster.landed),
        lastStep: cloneJson(runtime.booster.lastStep),
        lastSurfaceSample: cloneJson(runtime.booster.lastSurfaceSample),
        lastTrackedPositionKm: cloneVectorOrNull(runtime.booster.lastTrackedPositionKm),
        telemetry: cloneJson(runtime.booster.telemetry),
        contactHoldSec: Math.max(0, finiteNumber(runtime.booster.contactHoldSec, 0)),
        catchAlignHoldSec: Math.max(0, finiteNumber(runtime.booster.catchAlignHoldSec, 0)),
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
      pendingStageTransition: cloneJson(
        runtime.pendingStageTransition,
        createPendingStageTransitionState(),
      ),
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
    merged.angularRateRadS = Math.max(0, finiteNumber(merged.angularRateRadS, 0));
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
    setLaunchCommandPhase(String(snapshot.commandPhase || currentLaunchCommandPhase() || "idle"));
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
    runtime.attachedJoint = {
      ...createAttachedStackJointState(),
      ...(cloneJson(snapshot.attachedJoint, createAttachedStackJointState()) || {}),
    };
    runtime.guidanceAdvisory = {
      ...createGuidanceAdvisoryState(),
      ...(cloneJson(snapshot.guidanceAdvisory, {}) || {}),
    };
    runtime.guidanceAdvisory.source = String(runtime.guidanceAdvisory.source || "");
    runtime.guidanceAdvisory.requestedPhase = String(runtime.guidanceAdvisory.requestedPhase || "idle");
    runtime.guidanceAdvisory.resolvedPhase = String(runtime.guidanceAdvisory.resolvedPhase || "idle");
    runtime.guidanceAdvisory.requestedThrottle = clamp(
      Number(runtime.guidanceAdvisory.requestedThrottle) || 0,
      0,
      1,
    );
    runtime.guidanceAdvisory.requestedMode = String(runtime.guidanceAdvisory.requestedMode || "");
    runtime.guidanceAdvisory.reason = String(runtime.guidanceAdvisory.reason || "");
    runtime.guidanceAdvisory.updatedAtElapsedSec = Math.max(
      0,
      finiteNumber(runtime.guidanceAdvisory.updatedAtElapsedSec, 0),
    );
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
    runtime.pendingMissionPhase = {
      ...createPendingMissionPhaseState(),
      ...(cloneJson(snapshot.pendingMissionPhase, {}) || {}),
    };
    runtime.pendingMissionPhase.active = Boolean(runtime.pendingMissionPhase.active);
    runtime.pendingMissionPhase.requestedPhase = String(runtime.pendingMissionPhase.requestedPhase || "");
    runtime.pendingMissionPhase.source = String(runtime.pendingMissionPhase.source || "");
    runtime.pendingMissionPhase.reason = String(runtime.pendingMissionPhase.reason || "");
    runtime.pendingMissionPhase.requestedAtElapsedSec = Math.max(
      0,
      finiteNumber(runtime.pendingMissionPhase.requestedAtElapsedSec, 0),
    );
    runtime.pendingMissionPhase.authorizationMode = String(runtime.pendingMissionPhase.authorizationMode || "");

    const boosterSnapshot = snapshot.booster && typeof snapshot.booster === "object"
      ? snapshot.booster
      : {};
    runtime.booster.active = Boolean(boosterSnapshot.active);
    runtime.booster.attached = Boolean(
      Object.prototype.hasOwnProperty.call(boosterSnapshot, "attached")
        ? boosterSnapshot.attached
        : runtime.booster.attached,
    );
    setBoosterCommandPhase(String(
      boosterSnapshot.commandPhase
      || boosterSnapshot.phase
      || currentBoosterCommandPhase()
      || "idle"
    ));
    runtime.booster.guidanceMode = String(
      boosterSnapshot.guidanceMode || runtime.booster.guidanceMode || "booster-idle",
    );
    runtime.booster.attitude = applyBoosterAttitudeSnapshot(
      boosterSnapshot.attitude,
      normalize(
        snapshot.boosterActuator?.directionActual
          || boosterBodyAxisWorld(runtime.booster.attitude || createBoosterAttitudeState({ x: 0, y: 0, z: 1 })),
        { x: 0, y: 0, z: 1 },
      ),
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
    runtime.booster.catchAlignHoldSec = Math.max(
      0,
      finiteNumber(boosterSnapshot.catchAlignHoldSec, runtime.booster.catchAlignHoldSec),
    );
    runtime.booster.navigation = resetBoosterNavigationState(runtime.booster.navigation);

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
    runtime.refuel.catalogTankerIds = Array.from(
      new Set(
        (Array.isArray(incomingRefuel.catalogTankerIds) ? incomingRefuel.catalogTankerIds : [])
          .map((id) => String(id || "").trim())
          .filter((id) => id.startsWith("earth_refuel_tanker_")),
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

    runtime.pendingStageTransition = {
      ...createPendingStageTransitionState(),
      ...(cloneJson(snapshot.pendingStageTransition, {}) || {}),
    };
    runtime.pendingStageTransition.active = Boolean(runtime.pendingStageTransition.active);
    runtime.pendingStageTransition.kind = String(runtime.pendingStageTransition.kind || "");
    runtime.pendingStageTransition.fromStageIndex = Math.max(
      0,
      Math.floor(finiteNumber(runtime.pendingStageTransition.fromStageIndex, 0)),
    );
    runtime.pendingStageTransition.toStageIndex = (
      runtime.pendingStageTransition.toStageIndex !== null
      && runtime.pendingStageTransition.toStageIndex !== undefined
      && Number.isFinite(Number(runtime.pendingStageTransition.toStageIndex))
    )
      ? Math.max(0, Math.floor(Number(runtime.pendingStageTransition.toStageIndex)))
      : null;
    runtime.pendingStageTransition.requestedAtElapsedSec = Math.max(
      0,
      finiteNumber(runtime.pendingStageTransition.requestedAtElapsedSec, 0),
    );
    runtime.pendingStageTransition.requestReason = String(runtime.pendingStageTransition.requestReason || "");
    runtime.pendingStageTransition.reservePropellantKg = Math.max(
      0,
      finiteNumber(runtime.pendingStageTransition.reservePropellantKg, 0),
    );
    runtime.pendingStageTransition.requestAltitudeKm = finiteOrNull(runtime.pendingStageTransition.requestAltitudeKm);
    runtime.pendingStageTransition.requestGroundRelativeSpeedKmS = finiteOrNull(
      runtime.pendingStageTransition.requestGroundRelativeSpeedKmS,
    );
    runtime.pendingStageTransition.requestDynamicPressurePa = finiteOrNull(
      runtime.pendingStageTransition.requestDynamicPressurePa,
    );
    runtime.pendingStageTransition.waitReason = String(runtime.pendingStageTransition.waitReason || "");
    runtime.pendingStageTransition.authorizationMode = String(runtime.pendingStageTransition.authorizationMode || "");

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
      commandPhase: currentLaunchCommandPhase(),
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
    launchMissionShipAsync,
    warmMoonOrbitInjectLaunchSolve,
    getMoonOrbitInjectSolveState,
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
    isPrimaryLaunchActive() {
      return currentLaunchVehiclePhase() !== "idle"
        || runtime.booster.active
        || Boolean(runtime.pendingPadTankerLaunch?.active);
    },
    isActive() {
      return currentLaunchVehiclePhase() !== "idle"
        || runtime.booster.active
        || fleetController.hasActiveVehicles();
    },
  };
}
