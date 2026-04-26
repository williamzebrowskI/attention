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
  resolveConfiguredEngineCounts,
  resolveConfiguredThrustBoundsN,
} from "./launchConfig.js?v=20260426a";
import {
  computeEngineClusterBodyTorqueNm,
  createSuperHeavyEngineDescriptors,
  createStarshipStage2EngineDescriptors,
  resolveActiveEngineSelection,
  starshipStage2EngineActivationOrder,
  superHeavyEngineActivationOrder,
} from "./launchEngineLayout.js";
import {
  BOOSTER_THRUSTER_LAYOUT,
  STARSHIP_THRUSTER_LAYOUT,
} from "./thrusterLayout.js";
import {
  createEngineCombustionClusterState,
  hydrateEngineCombustionClusterState,
  transferEngineCombustionClusterState,
  updateEngineCombustionClusterState,
} from "./launchCombustionModel.js";
import {
  computeBoosterRecoveryCommand,
  resolveBoosterRecoveryHardwareState,
} from "./boosterRecovery.js?v=20260425f";
import { shouldFinalizeBoosterCatch } from "./boosterCatchGuidance.js?v=20260425c";
import {
  BOOSTER_CATCH_BASE_CLEARANCE_KM,
  BOOSTER_CATCH_GEOMETRY_KM,
  computeBoosterCatchPinHeightErrorKm,
  computeBoosterCatchRelativeState,
  computeLaunchSiteCatchFrame,
} from "./launchSiteCatchGeometry.js?v=20260425c";
import {
  contactImpulseDirection,
  queryBoosterCatchPointContacts,
  queryLaunchSiteObjectContacts,
} from "./launchSitePhysicsObjects.js?v=20260425h";
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
} from "./launchGuidance.js?v=20260425c";
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
} from "./launchAeroModel.js?v=20260425a";
import {
  createBoosterNavigationState,
  resetBoosterNavigationState,
  updateBoosterNavigationState,
} from "./boosterNavigation.js?v=20260423f";
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
import { createLaunchFleetController } from "./launchFleetController.js?v=20260424f";
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
const UPPER_STAGE_QALPHA_ACTIVE_MIN_DYNAMIC_PRESSURE_PA = 1_500;
const ATTACHED_STACK_JOINT_AXIAL_NATURAL_FREQUENCY_RAD_S = 4.8;
const ATTACHED_STACK_JOINT_AXIAL_DAMPING_RATIO = 1.2;
const ATTACHED_STACK_JOINT_LATERAL_NATURAL_FREQUENCY_RAD_S = 3.5;
const ATTACHED_STACK_JOINT_LATERAL_DAMPING_RATIO = 1.08;
const ATTACHED_STACK_JOINT_ANGULAR_NATURAL_FREQUENCY_RAD_S = 4.4;
const ATTACHED_STACK_JOINT_ANGULAR_DAMPING_RATIO = 0.92;
const ATTACHED_STACK_JOINT_MAX_AXIAL_CORRECTION_KM_S2 = 0.085;
const ATTACHED_STACK_JOINT_MAX_LATERAL_CORRECTION_KM_S2 = 0.045;
const ATTACHED_STACK_JOINT_MAX_LOAD_N = 2.4e8;
const ATTACHED_STACK_JOINT_MAX_ANGULAR_MOMENT_NM = 9.0e8;
const HOTSTAGE_PLUME_IMPINGEMENT_FORCE_RATIO = 0.028;
const HOTSTAGE_INTERSTAGE_CONTACT_BAND_KM = 0.0012;
const HOTSTAGE_INTERSTAGE_CONTACT_RESTITUTION = 0.18;
const MISSION_PHASE_ADVISORY_HOLD_SEC = 0.35;
const STARSHIP_GNC_NAV_SOURCE = "starship-gnc-ekf-sim";
const STARSHIP_RCS_PROPELLANT_CAPACITY_KG = Math.max(
  0,
  Number(LAUNCH_RCS_CONFIG.starshipPropellantCapacityKg) || 18_000,
);

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

const STAGE_FULL_6DOF_ASCENT_ENABLED = true;

function composeCatchFramePosition(catchFrame, supportOffsetKm = null) {
  if (!catchFrame?.centerPosition) {
    return null;
  }
  const east = normalize(catchFrame.eastAxis || { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const north = normalize(catchFrame.northAxis || { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 });
  const up = normalize(catchFrame.surfaceNormal || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const offset = supportOffsetKm || {};
  return add(
    add(
      add(catchFrame.centerPosition, scale(east, Number(offset.eastKm) || 0)),
      scale(north, Number(offset.northKm) || 0),
    ),
    scale(up, Number(offset.upKm) || 0),
  );
}

function resolveTowerClearCorridorOffsetEastKm({
  altitudeKm = 0,
  bodyAboveTerrainKm = null,
  catchVerticalErrorKm = null,
  catchGuidanceActive = false,
  captureActive = false,
} = {}) {
  if (!catchGuidanceActive || captureActive) {
    return 0;
  }
  const structuralClearanceOffsetKm = Math.max(0.028, STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 3.10);
  const desiredCenterAltitudeKm =
    BOOSTER_CATCH_BASE_CLEARANCE_KM + BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM;
  const heightAboveCaptureKm = Math.max(
    0,
    Number.isFinite(Number(catchVerticalErrorKm))
      ? Number(catchVerticalErrorKm)
      : 0,
    Number.isFinite(Number(bodyAboveTerrainKm))
      ? Number(bodyAboveTerrainKm) - BOOSTER_CATCH_BASE_CLEARANCE_KM
      : 0,
    Number.isFinite(Number(altitudeKm))
      ? Number(altitudeKm) - desiredCenterAltitudeKm
      : 0,
  );
  const descentCorridorOffsetKm = clamp(
    structuralClearanceOffsetKm + (0.010 * Math.max(0, heightAboveCaptureKm - 0.4)),
    structuralClearanceOffsetKm,
    0.34,
  );
  const finalTranslateInBlend = clamp((7.2 - heightAboveCaptureKm) / 6.4, 0, 1);
  const contactCenterBlend = clamp((0.28 - heightAboveCaptureKm) / 0.20, 0, 1);
  const commandedOffsetKm = (
    (descentCorridorOffsetKm * (1 - finalTranslateInBlend))
    + (structuralClearanceOffsetKm * finalTranslateInBlend)
  );
  return -commandedOffsetKm * (1 - contactCenterBlend);
}

function stageReservePropellantKg(stageIndex) {
  if (stageIndex !== 0) {
    return 0;
  }
  const stage = stageAtIndex(0);
  const configuredReserve = Number(LAUNCH_VEHICLE_CONFIG.guidance?.boosterLandingReservePropellantKg) || 0;
  return clamp(configuredReserve, 0, Number(stage?.propellantMassKg) || configuredReserve);
}

function createAttachedStackJointState() {
  return {
    active: false,
    targetOffsetWorldKm: null,
    targetPositionKm: null,
    targetVelocityKmS: null,
    bodyAxisDirectionKm: { x: 0, y: 0, z: 1 },
    positionErrorKm: { x: 0, y: 0, z: 0 },
    relativeVelocityKmS: { x: 0, y: 0, z: 0 },
    shipBaseAccelerationKmS2: { x: 0, y: 0, z: 0 },
    boosterBaseAccelerationKmS2: { x: 0, y: 0, z: 0 },
    shipJointAccelerationKmS2: { x: 0, y: 0, z: 0 },
    boosterJointAccelerationKmS2: { x: 0, y: 0, z: 0 },
    shipAccelerationKmS2: { x: 0, y: 0, z: 0 },
    boosterAccelerationKmS2: { x: 0, y: 0, z: 0 },
    axialErrorKm: 0,
    lateralErrorKm: 0,
    axialRelativeSpeedKmS: 0,
    lateralRelativeSpeedKmS: 0,
    axialCompressionForceN: 0,
    lateralForceN: 0,
    correctionForceN: 0,
    bendingMomentNm: 0,
    angularMomentNm: 0,
    axialCompressionM: 0,
    lateralDeflectionM: 0,
    angularDeflectionDeg: 0,
    reactionForceN: 0,
    plumeImpingementForceN: 0,
    physicalSeparationKm: 0,
    physicalSeparationRateKmS: 0,
    physicalLateralOffsetKm: 0,
    releaseContactActive: false,
    shipReferenceActive: false,
    shipMassKg: 0,
    boosterMassKg: 0,
  };
}

function createStarshipStateGuardState() {
  return {
    cleanFreeFlightActive: false,
    cleanFreeFlightElapsedSec: null,
    cleanFreeFlightReason: "",
    directPositionCorrectionCount: 0,
    directVelocityCorrectionCount: 0,
    blockedPositionCorrectionCount: 0,
    blockedVelocityCorrectionCount: 0,
    postCleanFreeFlightPositionCorrectionCount: 0,
    postCleanFreeFlightVelocityCorrectionCount: 0,
    maxPostCleanFreeFlightPositionCorrectionKm: 0,
    maxPostCleanFreeFlightVelocityCorrectionKmS: 0,
    lastCorrectionReason: "",
    lastCorrectionKind: "",
    lastCorrectionElapsedSec: null,
    lastBlockedReason: "",
    lastBlockedKind: "",
    lastBlockedElapsedSec: null,
  };
}

function decomposeVectorAlongAxis(vector, axisUnit) {
  const axis = normalize(axisUnit, { x: 0, y: 0, z: 1 });
  const safeVector = (
    vector
    && Number.isFinite(Number(vector.x))
    && Number.isFinite(Number(vector.y))
    && Number.isFinite(Number(vector.z))
  )
    ? vector
    : { x: 0, y: 0, z: 0 };
  const axialScalar = dot(safeVector, axis);
  const axialVector = scale(axis, axialScalar);
  const lateralVector = subtract(safeVector, axialVector);
  return {
    axialScalar,
    axialVector,
    lateralVector,
    lateralMagnitude: length(lateralVector),
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
    holdMode: "",
    authorizationMode: "",
    anomalyActive: false,
    anomalyReason: "",
    anomalyElapsedSec: null,
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
  state.holdMode = "";
  state.authorizationMode = "";
  state.anomalyActive = false;
  state.anomalyReason = "";
  state.anomalyElapsedSec = null;
  return state;
}

function createLaunchSequenceState() {
  return {
    active: false,
    startElapsedSec: 0,
    launchCommitReady: false,
    launchCommitReason: "",
    launchCommitElapsedSec: null,
    padReleaseComplete: false,
    padReleaseElapsedSec: null,
    towerClearSatisfied: false,
    towerClearElapsedSec: null,
    pitchoverEnabled: false,
    pitchoverElapsedSec: null,
    hotstageDeferredCandidateActive: false,
    hotstageDeferredCandidateElapsedSec: null,
    hotstageDeferredCandidateAltitudeKm: null,
    hotstageDeferredCandidateReason: "",
    hotstageArmed: false,
    hotstageArmReason: "",
    hotstageArmedElapsedSec: null,
    hotstageIgnitionAuthorized: false,
    hotstageIgnitionElapsedSec: null,
    hotstageReleaseAuthorized: false,
    hotstageReleaseElapsedSec: null,
  };
}

function createBoosterCatchCaptureState() {
  return {
    active: false,
    phase: "",
    contactHoldSec: 0,
    settleHoldSec: 0,
    closureNorm: 0,
    targetOffsetUpKm: 0,
    lateralErrorKm: null,
    verticalErrorKm: null,
    totalErrorKm: null,
    totalSpeedKmS: null,
    loadN: 0,
    loadG: 0,
  };
}

function resetBoosterCatchCaptureState(captureState) {
  const state = captureState && typeof captureState === "object"
    ? captureState
    : createBoosterCatchCaptureState();
  state.active = false;
  state.phase = "";
  state.contactHoldSec = 0;
  state.settleHoldSec = 0;
  state.closureNorm = 0;
  state.targetOffsetUpKm = 0;
  state.lateralErrorKm = null;
  state.verticalErrorKm = null;
  state.totalErrorKm = null;
  state.totalSpeedKmS = null;
  state.loadN = 0;
  state.loadG = 0;
  return state;
}

function createBoosterCrashDynamicsState() {
  return {
    active: false,
    settled: false,
    mode: "",
    elapsedSec: 0,
    settleHoldSec: 0,
    lastSurfaceContact: false,
    clearanceKm: BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM,
    bodyAboveTerrainKm: null,
    tipAngleDeg: 0,
    angularSpeedRadS: 0,
    slideSpeedKmS: 0,
    normalSpeedKmS: 0,
    towerStrike: false,
  };
}

function resetBoosterCrashDynamicsState(crashState) {
  const state = crashState && typeof crashState === "object"
    ? crashState
    : createBoosterCrashDynamicsState();
  state.active = false;
  state.settled = false;
  state.mode = "";
  state.elapsedSec = 0;
  state.settleHoldSec = 0;
  state.lastSurfaceContact = false;
  state.clearanceKm = BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM;
  state.bodyAboveTerrainKm = null;
  state.tipAngleDeg = 0;
  state.angularSpeedRadS = 0;
  state.slideSpeedKmS = 0;
  state.normalSpeedKmS = 0;
  state.towerStrike = false;
  return state;
}

function hydrateBoosterCrashDynamicsState(snapshot = null) {
  const base = createBoosterCrashDynamicsState();
  const incoming = snapshot && typeof snapshot === "object" ? snapshot : {};
  return {
    active: Boolean(incoming.active),
    settled: Boolean(incoming.settled),
    mode: String(incoming.mode || ""),
    elapsedSec: Math.max(0, finiteNumber(incoming.elapsedSec, base.elapsedSec)),
    settleHoldSec: Math.max(0, finiteNumber(incoming.settleHoldSec, base.settleHoldSec)),
    lastSurfaceContact: Boolean(incoming.lastSurfaceContact),
    clearanceKm: Math.max(0, finiteNumber(incoming.clearanceKm, base.clearanceKm)),
    bodyAboveTerrainKm: Number.isFinite(Number(incoming.bodyAboveTerrainKm))
      ? Number(incoming.bodyAboveTerrainKm)
      : null,
    tipAngleDeg: Math.max(0, finiteNumber(incoming.tipAngleDeg, base.tipAngleDeg)),
    angularSpeedRadS: Math.max(0, finiteNumber(incoming.angularSpeedRadS, base.angularSpeedRadS)),
    slideSpeedKmS: Math.max(0, finiteNumber(incoming.slideSpeedKmS, base.slideSpeedKmS)),
    normalSpeedKmS: finiteNumber(incoming.normalSpeedKmS, base.normalSpeedKmS),
    towerStrike: Boolean(incoming.towerStrike),
  };
}

const BOOSTER_TOUCHDOWN_LIMITS = Object.freeze({
  holdSec: 0.55,
  contactBandKm: 0.0015,
  maxSpeedKmS: 0.012,
  maxDownwardSpeedKmS: 0.008,
  maxLateralSpeedKmS: 0.0045,
  minBodyUpAlignment: 0.965,
});

const BOOSTER_CATCH_CAPTURE_LIMITS = Object.freeze({
  maxContactCorrectionAccelKmS2: 0.050,
  maxCaptureCorrectionAccelKmS2: 0.056,
  maxLoadG: 6.0,
  maxTotalSpeedKmS: 0.080,
  maxLateralErrorKm: 0.090,
  maxVerticalErrorKm: 0.040,
});

const BOOSTER_CRASH_DYNAMICS_LIMITS = Object.freeze({
  contactBandKm: 0.002,
  normalRestitution: 0.035,
  slidingFrictionPerS: 2.25,
  settledFrictionPerS: 8.0,
  angularDampingFreePerS: 0.08,
  angularDampingContactPerS: 0.62,
  maxTipRateRadS: rad(96),
  minImpactTipRateRadS: rad(6),
  settledTipAngleDeg: 72,
  settledAngularRateRadS: rad(3.5),
  settledSlideSpeedKmS: 0.0018,
  settleHoldSec: 1.0,
  forcedSettleSec: 15.0,
});

function resetLaunchSequenceState(sequenceState) {
  const state = sequenceState && typeof sequenceState === "object"
    ? sequenceState
    : createLaunchSequenceState();
  state.active = false;
  state.startElapsedSec = 0;
  state.launchCommitReady = false;
  state.launchCommitReason = "";
  state.launchCommitElapsedSec = null;
  state.padReleaseComplete = false;
  state.padReleaseElapsedSec = null;
  state.towerClearSatisfied = false;
  state.towerClearElapsedSec = null;
  state.pitchoverEnabled = false;
  state.pitchoverElapsedSec = null;
  state.hotstageDeferredCandidateActive = false;
  state.hotstageDeferredCandidateElapsedSec = null;
  state.hotstageDeferredCandidateAltitudeKm = null;
  state.hotstageDeferredCandidateReason = "";
  state.hotstageArmed = false;
  state.hotstageArmReason = "";
  state.hotstageArmedElapsedSec = null;
  state.hotstageIgnitionAuthorized = false;
  state.hotstageIgnitionElapsedSec = null;
  state.hotstageReleaseAuthorized = false;
  state.hotstageReleaseElapsedSec = null;
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
  return {
    elapsedSec,
    altitudeKm,
    speedKmS,
    minElapsedSec,
    maxElapsedSec,
    minAltitudeKm,
    maxAltitudeKm,
    nominalElapsedSec: Math.max(minElapsedSec, Number(guidance.hotstageNominalElapsedSec) || minElapsedSec),
    nominalAltitudeKm: Math.max(minAltitudeKm, Number(guidance.hotstageNominalAltitudeKm) || minAltitudeKm),
    withinEnvelope: (
      elapsedSec >= minElapsedSec
      && elapsedSec <= maxElapsedSec
      && altitudeKm >= minAltitudeKm
      && altitudeKm <= maxAltitudeKm
    ),
  };
}

function hotstageDeferredCandidateUsable(sequence, hotstageEnvelope) {
  if (!sequence?.hotstageDeferredCandidateActive || !hotstageEnvelope) {
    return false;
  }
  const candidateElapsedSec = Number(sequence.hotstageDeferredCandidateElapsedSec);
  const candidateAltitudeKm = Number(sequence.hotstageDeferredCandidateAltitudeKm);
  const elapsedSec = Number(hotstageEnvelope.elapsedSec);
  const altitudeKm = Number(hotstageEnvelope.altitudeKm);
  if (
    !Number.isFinite(candidateElapsedSec)
    || !Number.isFinite(candidateAltitudeKm)
    || !Number.isFinite(elapsedSec)
    || !Number.isFinite(altitudeKm)
  ) {
    return false;
  }
  return (
    candidateElapsedSec <= (Number(hotstageEnvelope.minElapsedSec) || 0)
    && candidateAltitudeKm >= (Number(hotstageEnvelope.minAltitudeKm) || 0)
    && candidateAltitudeKm <= (Number(hotstageEnvelope.maxAltitudeKm) || 0)
    && elapsedSec >= (Number(hotstageEnvelope.minElapsedSec) || 0)
    && elapsedSec <= ((Number(hotstageEnvelope.maxElapsedSec) || 0) + 4)
    && altitudeKm >= Math.max(0, (Number(hotstageEnvelope.minAltitudeKm) || 0) - 8)
    && altitudeKm <= ((Number(hotstageEnvelope.maxAltitudeKm) || 0) + 35)
  );
}

function hotstageDeferredCandidateEarlyUsable(sequence, hotstageEnvelope) {
  if (!sequence?.hotstageDeferredCandidateActive || !hotstageEnvelope) {
    return false;
  }
  const candidateElapsedSec = Number(sequence.hotstageDeferredCandidateElapsedSec);
  const candidateAltitudeKm = Number(sequence.hotstageDeferredCandidateAltitudeKm);
  const elapsedSec = Number(hotstageEnvelope.elapsedSec);
  const altitudeKm = Number(hotstageEnvelope.altitudeKm);
  const minElapsedSec = Number(hotstageEnvelope.minElapsedSec) || 0;
  const minAltitudeKm = Number(hotstageEnvelope.minAltitudeKm) || 0;
  const maxAltitudeKm = Math.max(minAltitudeKm, Number(hotstageEnvelope.maxAltitudeKm) || minAltitudeKm);
  if (
    !Number.isFinite(candidateElapsedSec)
    || !Number.isFinite(candidateAltitudeKm)
    || !Number.isFinite(elapsedSec)
    || !Number.isFinite(altitudeKm)
  ) {
    return false;
  }
  return (
    candidateElapsedSec <= minElapsedSec
    && candidateAltitudeKm >= minAltitudeKm
    && candidateAltitudeKm <= maxAltitudeKm
    && elapsedSec >= minElapsedSec
    && altitudeKm >= Math.max(minAltitudeKm, maxAltitudeKm - 2)
    && altitudeKm <= (maxAltitudeKm + 12)
  );
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

function rawConfiguredThrustBoundsN(config) {
  const thrustVacuumN = Math.max(
    0,
    Number(config?.thrustVacuumN) || Number(config?.thrustSeaLevelN) || 0,
  );
  const thrustSeaLevelN = Math.max(
    0,
    Number(config?.thrustSeaLevelN) || thrustVacuumN,
  );
  return {
    thrustVacuumN,
    thrustSeaLevelN,
  };
}

function resolveSuperHeavyEngineState(config, pressurePa = 0, throttle = 0) {
  const descriptors = createSuperHeavyEngineDescriptors(
    boosterRadiusMeters(),
    -boosterBodyLengthMeters() * 0.46,
  );
  const { engineCount, nominalEngineCount } = resolveConfiguredEngineCounts(config, descriptors.length);
  const selection = resolveActiveEngineSelection({
    descriptors,
    activationOrder: superHeavyEngineActivationOrder(descriptors),
    desiredEngineCount: Math.min(engineCount, descriptors.length),
  });
  const rawThrustBounds = rawConfiguredThrustBoundsN(config);
  const perEngineThrustVacuumN = nominalEngineCount > 0
    ? rawThrustBounds.thrustVacuumN / nominalEngineCount
    : 0;
  const perEngineThrustSeaLevelN = nominalEngineCount > 0
    ? rawThrustBounds.thrustSeaLevelN / nominalEngineCount
    : 0;
  const fullPerEngineThrustN = interpolateSeaToVac(
    perEngineThrustVacuumN,
    perEngineThrustSeaLevelN,
    pressurePa,
  );
  const throttleClamped = clamp(Number(throttle) || 0, 0, 1);
  const activePerEngineThrustN = fullPerEngineThrustN * throttleClamped;
  return {
    descriptors,
    activeIndices: selection.activeIndices,
    activeDescriptors: selection.activeIndices.map((index) => descriptors[index]).filter(Boolean),
    desiredIndices: selection.desiredIndices,
    inactiveIndices: selection.inactiveIndices,
    activeCount: selection.activeCount,
    desiredCount: selection.desiredCount,
    nominalEngineCount,
    fullPerEngineThrustN,
    thrustN: activePerEngineThrustN * selection.activeCount,
  };
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

const BOOSTER_RCS_THRUSTER_IDS = Object.freeze(Object.keys(BOOSTER_THRUSTER_LAYOUT));
const BOOSTER_RCS_THRUSTER_INDEX_BY_ID = Object.freeze(
  BOOSTER_RCS_THRUSTER_IDS.reduce((map, id, index) => {
    map[id] = index;
    return map;
  }, {}),
);

function boosterRcsThrusterIndicesForJets(jets = []) {
  if (!Array.isArray(jets) || jets.length <= 0) {
    return [];
  }
  const indices = [];
  for (const jet of jets) {
    const index = BOOSTER_RCS_THRUSTER_INDEX_BY_ID[String(jet || "")];
    if (Number.isInteger(index) && !indices.includes(index)) {
      indices.push(index);
    }
  }
  return indices;
}

function rcsAngularJetSelection(controlDemandBody = { x: 0, y: 0, z: 0 }) {
  const jets = [];
  const threshold = 0.04;
  const pitchDemand = Number(controlDemandBody.x) || 0;
  const rollDemand = Number(controlDemandBody.y) || 0;
  const yawDemand = Number(controlDemandBody.z) || 0;
  if (pitchDemand > threshold) {
    jets.push("dorsal");
  } else if (pitchDemand < -threshold) {
    jets.push("ventral");
  }
  if (yawDemand > threshold) {
    jets.push("port");
  } else if (yawDemand < -threshold) {
    jets.push("starboard");
  }
  if (rollDemand > threshold) {
    jets.push("forward");
  } else if (rollDemand < -threshold) {
    jets.push("aft");
  }
  return jets;
}

function createStarshipNavigationState() {
  return {
    source: STARSHIP_GNC_NAV_SOURCE,
    sensorNoiseActive: true,
    positionSigmaKm: Math.max(0, Number(LAUNCH_RCS_CONFIG.starshipSensorPositionSigmaKm) || 0.012),
    velocitySigmaKmS: Math.max(0, Number(LAUNCH_RCS_CONFIG.starshipSensorVelocitySigmaKmS) || 0.000025),
    attitudeSigmaDeg: Math.max(0, Number(LAUNCH_RCS_CONFIG.starshipSensorAttitudeSigmaDeg) || 0.035),
    updateHz: Math.max(1, Number(LAUNCH_RCS_CONFIG.starshipSensorUpdateHz) || 8),
    positionErrorKm: { x: 0, y: 0, z: 0 },
    velocityErrorKmS: { x: 0, y: 0, z: 0 },
    attitudeErrorDeg: { x: 0, y: 0, z: 0 },
    estimatedRelativePositionKm: null,
    estimatedRelativeVelocityKmS: null,
    estimatedBodyAxisDirectionKm: null,
    lastUpdateSec: 0,
  };
}

function resetStarshipNavigationState(state = null) {
  return {
    ...createStarshipNavigationState(),
    ...(state && typeof state === "object" ? {
      source: STARSHIP_GNC_NAV_SOURCE,
      sensorNoiseActive: true,
      positionSigmaKm: Math.max(0, Number(state.positionSigmaKm) || Number(LAUNCH_RCS_CONFIG.starshipSensorPositionSigmaKm) || 0.012),
      velocitySigmaKmS: Math.max(0, Number(state.velocitySigmaKmS) || Number(LAUNCH_RCS_CONFIG.starshipSensorVelocitySigmaKmS) || 0.000025),
      attitudeSigmaDeg: Math.max(0, Number(state.attitudeSigmaDeg) || Number(LAUNCH_RCS_CONFIG.starshipSensorAttitudeSigmaDeg) || 0.035),
      updateHz: Math.max(1, Number(state.updateHz) || Number(LAUNCH_RCS_CONFIG.starshipSensorUpdateHz) || 8),
    } : {}),
  };
}

function deterministicNoiseUnit(seed = 1, index = 0, salt = 0) {
  const raw = Math.sin(
    ((Number(seed) || 1) * 12.9898)
    + ((Number(index) || 0) * 78.233)
    + ((Number(salt) || 0) * 37.719),
  ) * 43758.5453123;
  return ((raw - Math.floor(raw)) * 2) - 1;
}

function deterministicSmoothNoise(seed = 1, timeSec = 0, salt = 0, updateHz = 8) {
  const hz = Math.max(1, Number(updateHz) || 8);
  const sample = Math.max(0, Number(timeSec) || 0) * hz;
  const sampleIndex = Math.floor(sample);
  const t = sample - sampleIndex;
  const smoothT = t * t * (3 - (2 * t));
  const a = deterministicNoiseUnit(seed, sampleIndex, salt);
  const b = deterministicNoiseUnit(seed, sampleIndex + 1, salt);
  return a + ((b - a) * smoothT);
}

function updateStarshipNavigationState(state = null, {
  relPos,
  relVel,
  bodyAxisDirection,
  seed = 1,
  elapsedSeconds = 0,
} = {}) {
  const nav = state && typeof state === "object"
    ? state
    : createStarshipNavigationState();
  nav.source = STARSHIP_GNC_NAV_SOURCE;
  nav.sensorNoiseActive = true;
  nav.positionSigmaKm = Math.max(0, Number(nav.positionSigmaKm) || Number(LAUNCH_RCS_CONFIG.starshipSensorPositionSigmaKm) || 0.012);
  nav.velocitySigmaKmS = Math.max(0, Number(nav.velocitySigmaKmS) || Number(LAUNCH_RCS_CONFIG.starshipSensorVelocitySigmaKmS) || 0.000025);
  nav.attitudeSigmaDeg = Math.max(0, Number(nav.attitudeSigmaDeg) || Number(LAUNCH_RCS_CONFIG.starshipSensorAttitudeSigmaDeg) || 0.035);
  nav.updateHz = Math.max(1, Number(nav.updateHz) || Number(LAUNCH_RCS_CONFIG.starshipSensorUpdateHz) || 8);
  const timeSec = Math.max(0, Number(elapsedSeconds) || 0);
  nav.positionErrorKm = {
    x: deterministicSmoothNoise(seed, timeSec, 101, nav.updateHz) * nav.positionSigmaKm,
    y: deterministicSmoothNoise(seed, timeSec, 102, nav.updateHz) * nav.positionSigmaKm,
    z: deterministicSmoothNoise(seed, timeSec, 103, nav.updateHz) * nav.positionSigmaKm,
  };
  nav.velocityErrorKmS = {
    x: deterministicSmoothNoise(seed, timeSec, 201, nav.updateHz) * nav.velocitySigmaKmS,
    y: deterministicSmoothNoise(seed, timeSec, 202, nav.updateHz) * nav.velocitySigmaKmS,
    z: deterministicSmoothNoise(seed, timeSec, 203, nav.updateHz) * nav.velocitySigmaKmS,
  };
  nav.attitudeErrorDeg = {
    x: deterministicSmoothNoise(seed, timeSec, 301, nav.updateHz) * nav.attitudeSigmaDeg,
    y: deterministicSmoothNoise(seed, timeSec, 302, nav.updateHz) * nav.attitudeSigmaDeg,
    z: deterministicSmoothNoise(seed, timeSec, 303, nav.updateHz) * nav.attitudeSigmaDeg,
  };
  nav.estimatedRelativePositionKm = add(relPos || { x: 0, y: 0, z: 0 }, nav.positionErrorKm);
  nav.estimatedRelativeVelocityKmS = add(relVel || { x: 0, y: 0, z: 0 }, nav.velocityErrorKmS);
  const axisNoiseRad = rad(Math.max(
    Math.abs(nav.attitudeErrorDeg.x),
    Math.abs(nav.attitudeErrorDeg.y),
    Math.abs(nav.attitudeErrorDeg.z),
  ));
  const rawBodyAxis = normalize(bodyAxisDirection || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  nav.estimatedBodyAxisDirectionKm = normalize(
    add(rawBodyAxis, scale(normalize(nav.positionErrorKm, { x: 1, y: 0, z: 0 }), axisNoiseRad)),
    rawBodyAxis,
  );
  nav.lastUpdateSec = timeSec;
  return nav;
}

function ensureStarshipRcsRuntimeState(runtimeState = null) {
  if (!runtimeState || typeof runtimeState !== "object") {
    return;
  }
  if (!(Number(runtimeState.stageRcsInitialPropellantKg) > 0)) {
    runtimeState.stageRcsInitialPropellantKg = STARSHIP_RCS_PROPELLANT_CAPACITY_KG;
    runtimeState.stageRcsPropellantKg = STARSHIP_RCS_PROPELLANT_CAPACITY_KG;
  } else {
    runtimeState.stageRcsPropellantKg = clamp(
      Number(runtimeState.stageRcsPropellantKg) || 0,
      0,
      runtimeState.stageRcsInitialPropellantKg,
    );
  }
  runtimeState.stageNavigation = updateStarshipNavigationState(
    runtimeState.stageNavigation || createStarshipNavigationState(),
    {
      relPos: { x: 0, y: 0, z: 0 },
      relVel: { x: 0, y: 0, z: 0 },
      bodyAxisDirection: runtimeState.stageActuator?.directionActual || { x: 0, y: 0, z: 1 },
      seed: runtimeState.windSeed || 1,
      elapsedSeconds: runtimeState.elapsedSeconds || 0,
    },
  );
  runtimeState.stageRcsCombustion = runtimeState.stageRcsCombustion || createStage2RcsCombustionClusterState();
}

function resetStarshipRcsRuntimeState(runtimeState = null) {
  if (!runtimeState || typeof runtimeState !== "object") {
    return;
  }
  runtimeState.stageRcsPropellantKg = STARSHIP_RCS_PROPELLANT_CAPACITY_KG;
  runtimeState.stageRcsInitialPropellantKg = STARSHIP_RCS_PROPELLANT_CAPACITY_KG;
  runtimeState.stageNavigation = createStarshipNavigationState();
  runtimeState.stageRcsCombustion = createStage2RcsCombustionClusterState();
}

function zeroStarshipRcsControlState(extra = {}) {
  return {
    accelerationKmS2: { x: 0, y: 0, z: 0 },
    active: false,
    errorDeg: 0,
    authority: 0,
    linearAuthority: 0,
    angularAuthority: 0,
    jets: [],
    commandedThrusterIds: [],
    commandedThrusterIndices: [],
    activeThrusterIds: [],
    activeThrusterIndices: [],
    thrustN: 0,
    burnKg: 0,
    burnRateKgS: 0,
    propellantKg: 0,
    initialPropellantKg: 0,
    fuelFraction: null,
    bodyForceN: { x: 0, y: 0, z: 0 },
    bodyTorqueNm: { x: 0, y: 0, z: 0 },
    angularAccelerationRadS2: 0,
    dampingPerS: 0,
    thrusterThrustNByIndex: [],
    chamberPressurePaByIndex: [],
    exhaustTemperatureKByIndex: [],
    combustionEfficiencyByIndex: [],
    turbopumpNormByIndex: [],
    avgChamberPressurePa: 0,
    maxChamberPressurePa: 0,
    avgCombustionEfficiency: 0,
    avgTurbopumpNorm: 0,
    maxExhaustTemperatureK: 0,
    navSource: STARSHIP_GNC_NAV_SOURCE,
    navSensorNoiseActive: true,
    navPositionSigmaKm: Number(LAUNCH_RCS_CONFIG.starshipSensorPositionSigmaKm) || 0.012,
    navVelocitySigmaKmS: Number(LAUNCH_RCS_CONFIG.starshipSensorVelocitySigmaKmS) || 0.000025,
    navAttitudeSigmaDeg: Number(LAUNCH_RCS_CONFIG.starshipSensorAttitudeSigmaDeg) || 0.035,
    ...extra,
  };
}

function computeStarshipRcsControlState({
  runtimeState,
  stageIndex = 0,
  bodyKind = "stage1",
  desiredDirection,
  relPos,
  relVel,
  up,
  attitudeState = null,
  controlErrorsBody,
  omegaBodyRadS = null,
  controlAuthorityScale = 1,
  aeroAuthority = 0,
  massKg = 0,
  massModel = null,
  pressurePa = 0,
  dtSeconds = 0,
}) {
  if (
    !LAUNCH_RCS_CONFIG.enabled
    || stageIndex < LAUNCH_RCS_CONFIG.minStageIndex
    || bodyKind !== "stage2"
    || !runtimeState
  ) {
    return zeroStarshipRcsControlState();
  }
  ensureStarshipRcsRuntimeState(runtimeState);
  const safeMassKg = Math.max(MIN_ROCKET_MASS_KG, Number(massKg) || MIN_ROCKET_MASS_KG);
  const dt = Math.max(0, Number(dtSeconds) || 0);
  const bodyAxis = boosterBodyAxisWorld(attitudeState);
  runtimeState.stageNavigation = updateStarshipNavigationState(
    runtimeState.stageNavigation,
    {
      relPos,
      relVel,
      bodyAxisDirection: bodyAxis,
      seed: (Number(runtimeState.windSeed) || 1) + 701,
      elapsedSeconds: Number(runtimeState.elapsedSeconds) || 0,
    },
  );
  const nav = runtimeState.stageNavigation;
  const observedRelVel = nav.estimatedRelativeVelocityKmS || relVel || { x: 0, y: 0, z: 0 };
  const speedKmS = length(observedRelVel);
  const forward = speedKmS > LAUNCH_RCS_CONFIG.minReferenceSpeedKmS
    ? normalize(observedRelVel, bodyAxis)
    : normalize(nav.estimatedBodyAxisDirectionKm || bodyAxis, desiredDirection || up || bodyAxis);
  const desired = normalize(desiredDirection || forward, forward);
  const errorRad = angleBetweenRadians(forward, desired);
  const errorDeg = degrees(errorRad);
  const deadbandDeg = Number(LAUNCH_RCS_CONFIG.deadbandDeg) || 0.8;
  const fullAuthorityDeg = Math.max(deadbandDeg + 0.1, Number(LAUNCH_RCS_CONFIG.fullAuthorityDeg) || 10);
  const aeroSuppression = Math.max(0.22, 1 - (0.45 * clamp(Number(aeroAuthority) || 0, 0, 1)));
  const authorityScale = clamp(Number(controlAuthorityScale) || 1, 0.35, 1.4);
  const linearAuthority = clamp(
    ((errorDeg - deadbandDeg) / (fullAuthorityDeg - deadbandDeg)) * authorityScale * aeroSuppression,
    0,
    1,
  );
  const lateralCorrectionWorld = subtract(desired, scale(forward, dot(desired, forward)));
  const linearDemandBody = unitOrNull(lateralCorrectionWorld)
    ? rotateWorldVectorToBoosterBody(lateralCorrectionWorld, attitudeState)
    : { x: 0, y: 0, z: 0 };
  const linearDemandUnit = unitOrNull(linearDemandBody);

  const navErrorBodyRad = {
    x: rad(Number(nav.attitudeErrorDeg?.x) || 0),
    y: rad(Number(nav.attitudeErrorDeg?.y) || 0),
    z: rad(Number(nav.attitudeErrorDeg?.z) || 0),
  };
  const sensedErrorsBody = {
    pitchErrorRad: finiteNumber(controlErrorsBody?.pitchErrorRad, 0) + navErrorBodyRad.x,
    rollErrorRad: finiteNumber(controlErrorsBody?.rollErrorRad, 0) + navErrorBodyRad.y,
    yawErrorRad: finiteNumber(controlErrorsBody?.yawErrorRad, 0) + navErrorBodyRad.z,
  };
  const angularErrorRad = Math.hypot(
    sensedErrorsBody.pitchErrorRad,
    sensedErrorsBody.rollErrorRad,
    sensedErrorsBody.yawErrorRad,
  );
  const angularErrorDeg = degrees(angularErrorRad);
  const angularAuthority = clamp(
    ((angularErrorDeg - deadbandDeg) / (fullAuthorityDeg - deadbandDeg))
      * authorityScale
      * aeroSuppression,
    0,
    1,
  );
  const omegaBody = {
    x: finiteNumber(omegaBodyRadS?.x, 0),
    y: finiteNumber(omegaBodyRadS?.y, 0),
    z: finiteNumber(omegaBodyRadS?.z, 0),
  };
  const angularDemandBody = clampVectorMagnitude({
    x: (1.65 * sensedErrorsBody.pitchErrorRad) - (0.26 * omegaBody.x),
    y: (1.15 * sensedErrorsBody.rollErrorRad) - (0.22 * omegaBody.y),
    z: (1.65 * sensedErrorsBody.yawErrorRad) - (0.26 * omegaBody.z),
  }, Math.max(0.12, rad(22)));
  const angularDemandUnit = unitOrNull(angularDemandBody);
  const descriptors = starshipRcsThrusterDescriptors();
  const scoredThrusters = descriptors.map((descriptor, index) => {
    const directionBody = normalize(descriptor.directionBody, { x: 0, y: 1, z: 0 });
    const positionBodyM = descriptor.positionBodyM || descriptor;
    const torquePerNewton = cross(positionBodyM, directionBody);
    const torqueUnit = unitOrNull(torquePerNewton);
    const linearScore = linearDemandUnit ? dot(directionBody, linearDemandUnit) : 0;
    const angularScore = angularDemandUnit && torqueUnit ? dot(torqueUnit, angularDemandUnit) : 0;
    const score = (0.74 * linearAuthority * linearScore) + (1.0 * angularAuthority * angularScore);
    return {
      index,
      id: descriptor.id,
      score,
      throttle: clamp(score * 1.18, 0, 1),
    };
  }).filter((entry) => entry.score > 0.06 && entry.throttle > 0.02);
  const commandedThrusterIndices = scoredThrusters.map((entry) => entry.index);
  const commandedThrusterIds = scoredThrusters.map((entry) => entry.id);
  const maxCommandedThrottle = scoredThrusters.reduce(
    (maxThrottle, entry) => Math.max(maxThrottle, entry.throttle),
    0,
  );
  const propellantBeforeKg = Math.max(0, Number(runtimeState.stageRcsPropellantKg) || 0);
  const canFire = propellantBeforeKg > 1e-6 && (linearAuthority > 1e-4 || angularAuthority > 1e-4);
  runtimeState.stageRcsCombustion = updateEngineCombustionClusterState(
    runtimeState.stageRcsCombustion || createStage2RcsCombustionClusterState(),
    {
      config: starshipRcsCombustionConfig(),
      dtSeconds: dt,
      pressurePa,
      throttleCommand: canFire ? maxCommandedThrottle : 0,
      desiredEngineIndices: canFire ? commandedThrusterIndices : [],
    },
  ) || createStage2RcsCombustionClusterState();
  const rcsCombustion = runtimeState.stageRcsCombustion;
  const requestedBurnKg = Math.max(0, Number(rcsCombustion.burnRateKgS) || 0) * dt;
  const burnKg = Math.min(propellantBeforeKg, requestedBurnKg);
  const propellantScale = requestedBurnKg > 1e-9
    ? clamp(burnKg / requestedBurnKg, 0, 1)
    : (propellantBeforeKg > 0 ? 1 : 0);
  runtimeState.stageRcsPropellantKg = Math.max(0, propellantBeforeKg - burnKg);
  const activeThrusterIndices = Array.isArray(rcsCombustion.activeIndices)
    ? [...rcsCombustion.activeIndices]
    : [];
  let bodyForceN = { x: 0, y: 0, z: 0 };
  let bodyTorqueNm = { x: 0, y: 0, z: 0 };
  for (const index of activeThrusterIndices) {
    const descriptor = descriptors[index];
    if (!descriptor) {
      continue;
    }
    const thrustN = Math.max(0, Number(rcsCombustion.engineThrustNByIndex?.[index]) || 0) * propellantScale;
    if (!(thrustN > 0)) {
      continue;
    }
    const directionBody = normalize(descriptor.directionBody, { x: 0, y: 1, z: 0 });
    const forceBodyN = scale(directionBody, thrustN);
    bodyForceN = add(bodyForceN, forceBodyN);
    bodyTorqueNm = add(bodyTorqueNm, cross(descriptor.positionBodyM || descriptor, forceBodyN));
  }
  const accelerationKmS2 = scale(
    rotateVectorByQuaternion(bodyForceN, attitudeState?.orientation || quaternionIdentity()),
    (1 / safeMassKg) / 1000,
  );
  const inertia = stagePrincipalInertiaKgM2(bodyKind, safeMassKg, massModel?.inertiaNormalized);
  const angularAccelerationRadS2 = Math.hypot(
    bodyTorqueNm.x / Math.max(inertia.x, 1e-6),
    bodyTorqueNm.y / Math.max(inertia.y, 1e-6),
    bodyTorqueNm.z / Math.max(inertia.z, 1e-6),
  );
  const thrustN = length(bodyForceN);
  const activeThrusterIds = activeThrusterIndices
    .map((index) => descriptors[index]?.id)
    .filter(Boolean);
  const initialPropellantKg = Math.max(0, Number(runtimeState.stageRcsInitialPropellantKg) || 0);
  const fuelFraction = initialPropellantKg > 1e-6
    ? clamp((Number(runtimeState.stageRcsPropellantKg) || 0) / initialPropellantKg, 0, 1)
    : null;
  return {
    accelerationKmS2,
    active: activeThrusterIndices.length > 0 && (thrustN > 1 || angularAccelerationRadS2 > 1e-8),
    errorDeg: Math.max(errorDeg, angularErrorDeg),
    authority: clamp(Math.max(linearAuthority, angularAuthority), 0, 1),
    linearAuthority,
    angularAuthority,
    jets: activeThrusterIds,
    commandedThrusterIds,
    commandedThrusterIndices,
    activeThrusterIds,
    activeThrusterIndices,
    thrustN,
    burnKg,
    burnRateKgS: Math.max(0, Number(rcsCombustion.burnRateKgS) || 0),
    propellantKg: Math.max(0, Number(runtimeState.stageRcsPropellantKg) || 0),
    initialPropellantKg,
    fuelFraction,
    bodyForceN,
    bodyTorqueNm,
    angularAccelerationRadS2,
    dampingPerS: 0,
    thrusterThrustNByIndex: Array.isArray(rcsCombustion.engineThrustNByIndex)
      ? rcsCombustion.engineThrustNByIndex.map((value) => (Number(value) || 0) * propellantScale)
      : [],
    chamberPressurePaByIndex: Array.isArray(rcsCombustion.chamberPressurePaByIndex)
      ? [...rcsCombustion.chamberPressurePaByIndex]
      : [],
    exhaustTemperatureKByIndex: Array.isArray(rcsCombustion.exhaustTemperatureKByIndex)
      ? [...rcsCombustion.exhaustTemperatureKByIndex]
      : [],
    combustionEfficiencyByIndex: Array.isArray(rcsCombustion.combustionEfficiencyByIndex)
      ? [...rcsCombustion.combustionEfficiencyByIndex]
      : [],
    turbopumpNormByIndex: Array.isArray(rcsCombustion.turbopumpNormByIndex)
      ? [...rcsCombustion.turbopumpNormByIndex]
      : [],
    avgChamberPressurePa: Number(rcsCombustion.avgChamberPressurePa) || 0,
    maxChamberPressurePa: Number(rcsCombustion.maxChamberPressurePa) || 0,
    avgCombustionEfficiency: Number(rcsCombustion.avgCombustionEfficiency) || 0,
    avgTurbopumpNorm: Number(rcsCombustion.avgTurbopumpNorm) || 0,
    maxExhaustTemperatureK: Number(rcsCombustion.maxExhaustTemperatureK) || 0,
    navSource: String(nav.source || STARSHIP_GNC_NAV_SOURCE),
    navSensorNoiseActive: Boolean(nav.sensorNoiseActive),
    navPositionSigmaKm: Number(nav.positionSigmaKm) || 0,
    navVelocitySigmaKmS: Number(nav.velocitySigmaKmS) || 0,
    navAttitudeSigmaDeg: Number(nav.attitudeSigmaDeg) || 0,
    navPositionErrorKm: cloneLaunchVector(nav.positionErrorKm),
    navVelocityErrorKmS: cloneLaunchVector(nav.velocityErrorKmS),
    navAttitudeErrorDeg: cloneLaunchVector(nav.attitudeErrorDeg),
  };
}

function computeBoosterRcsAssist({
  desiredDirection,
  translationDirection = null,
  translationAuthority = 0,
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
  const modeText = `${String(phase || "")} ${String(guidanceMode || "")}`.toLowerCase();
  const terminalCatchMode = /catch/.test(modeText);
  const postSeparationTurnMode = /(separation-flip|separation-coast|boostback)/.test(modeText);
  const throttleBlend = terminalCatchMode
    ? clamp(Math.max(0.35, 1 - ((Number(throttle) || 0) / 0.95)), 0.35, 1)
    : clamp(1 - ((Number(throttle) || 0) / 0.45), 0, 1);
  const baseAeroSuppression = terminalCatchMode
    ? Math.max(0.4, 1 - clamp(Number(aeroAuthority) || 0, 0, 1))
    : (1 - clamp(Number(aeroAuthority) || 0, 0, 1));
  const aeroSuppression = postSeparationTurnMode
    ? Math.max(0.58, baseAeroSuppression)
    : baseAeroSuppression;
  const maneuveringMode = /(boostback|entry|landing|descent|separation|ballistic|coast)/.test(modeText);
  const phaseAuthorityFloor = maneuveringMode
    ? (0.08 + (0.24 * throttleBlend)) * Math.max(0.12, aeroSuppression)
    : 0;
  let authority = Math.max(errorAuthority, phaseAuthorityFloor)
    * clamp(Number(controlAuthorityScale) || 1, 0.35, 1.4);
  const aeroLedMode = throttleBlend > 0.75 && /(entry|descent|ballistic|coast)/.test(modeText);
  if (aeroLedMode && aeroAuthority > 0.2) {
    authority = Math.min(
      authority,
      terminalCatchMode ? 0.18 + (0.18 * aeroSuppression) : 0.04 + (0.12 * aeroSuppression),
    );
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

  const translationDir = translationDirection ? unitOrNull(translationDirection) : null;
  const lateralCorrection = subtract(desired, scale(forward, dot(desired, forward)));
  let correctionDir = translationDir || unitOrNull(lateralCorrection);
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
    Math.max(errorAuthority, phaseAuthorityFloor * 0.35, clamp(Number(translationAuthority) || 0, 0, 1))
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
    correctionDir,
    linearAuthority,
    errorDeg,
    authority,
    jets,
    jetIndices: boosterRcsThrusterIndicesForJets(jets),
  };
}

function boosterBodyLengthMeters() {
  return Math.max(1, Number(STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm) || 0) * 1000;
}

function boosterRadiusMeters() {
  return Math.max(1, Number(STARSHIP_STACK_DIMENSIONS_KM.diameterKm) || 0) * 500;
}

function stage2BodyLengthMeters() {
  return Math.max(1, Number(STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm) || 0) * 1000;
}

function stageRadiusMeters() {
  return Math.max(1, Number(STARSHIP_STACK_DIMENSIONS_KM.diameterKm) || 0) * 500;
}

function stageBodyLengthMeters(bodyKind = "stage1") {
  if (bodyKind === "stage2") {
    return stage2BodyLengthMeters();
  }
  return Math.max(
    1,
    (Number(STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm) || 0)
      + (Number(STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm) || 0),
  ) * 1000;
}

function stagePrincipalInertiaKgM2(bodyKind = "stage1", massKg = 0, inertiaNormalized = 1) {
  const safeMassKg = Math.max(1, Number(massKg) || 0);
  const radiusM = stageRadiusMeters();
  const lengthM = stageBodyLengthMeters(bodyKind);
  const inertiaScale = Math.max(0.25, Number(inertiaNormalized) || 1);
  const transverse = safeMassKg * ((3 * radiusM * radiusM) + (lengthM * lengthM)) / 12 * inertiaScale;
  const axial = 0.5 * safeMassKg * radiusM * radiusM * inertiaScale;
  return {
    x: transverse,
    y: axial,
    z: transverse,
  };
}

function defaultBoosterEngineCountSelection() {
  const stage1Config = stageAtIndex(0);
  const counts = resolveConfiguredEngineCounts(
    stage1Config,
    Math.max(1, Number(stage1Config?.engineCount) || 1),
  );
  return Math.max(1, Number(counts.engineCount) || Number(counts.nominalEngineCount) || 1);
}

function maxBoosterEngineCountSelection() {
  const stage1Config = stageAtIndex(0);
  const counts = resolveConfiguredEngineCounts(
    stage1Config,
    Math.max(1, Number(stage1Config?.engineCount) || 1),
  );
  return Math.max(1, Number(counts.nominalEngineCount) || Number(counts.engineCount) || 1);
}

function normalizeBoosterEngineCountSelection(value, fallback = null) {
  const defaultCount = defaultBoosterEngineCountSelection();
  const maximumCount = maxBoosterEngineCountSelection();
  const fallbackCount = Number.isFinite(Number(fallback))
    ? Math.round(Number(fallback))
    : defaultCount;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return clamp(fallbackCount, 1, maximumCount);
  }
  return clamp(Math.round(numeric), 1, maximumCount);
}

function stage1BoosterConfigWithEngineOverride(boosterEngineCountOverride = null) {
  const stage1Config = stageAtIndex(0);
  const overrideCount = normalizeBoosterEngineCountSelection(
    boosterEngineCountOverride,
    stage1Config?.engineCount,
  );
  return {
    ...stage1Config,
    engineCount: overrideCount,
  };
}

function boosterRecoveryConfigWithEngineOverride(boosterEngineCountOverride = null) {
  const baseCounts = resolveConfiguredEngineCounts(
    LAUNCH_BOOSTER_CONFIG,
    Math.max(1, Number(LAUNCH_BOOSTER_CONFIG.engineCount) || 1),
  );
  const overrideCount = normalizeBoosterEngineCountSelection(boosterEngineCountOverride);
  return {
    ...LAUNCH_BOOSTER_CONFIG,
    engineCount: Math.max(1, Math.min(overrideCount, baseCounts.nominalEngineCount)),
  };
}

export function boosterRecoveryEngineCountForPhase(commandPhase = "", boosterEngineCountOverride = null) {
  const phase = String(commandPhase || "").toLowerCase();
  const selectedCount = normalizeBoosterEngineCountSelection(boosterEngineCountOverride);
  if (phase === "boostback") {
    return Math.max(1, Math.min(selectedCount, 13));
  }
  if (phase === "entry-burn") {
    return Math.max(1, Math.min(selectedCount, 13));
  }
  if (phase === "terminal-intercept" || phase === "catch-approach") {
    return Math.max(1, Math.min(selectedCount, 3));
  }
  if (phase === "catch-burn") {
    return Math.max(1, Math.min(selectedCount, 3));
  }
  if (phase === "landing-burn") {
    return Math.max(1, Math.min(selectedCount, 13));
  }
  return Math.max(1, Math.min(selectedCount, 13));
}

function boosterRecoveryConfigForPhase(commandPhase = "", boosterEngineCountOverride = null) {
  const phaseEngineCount = boosterRecoveryEngineCountForPhase(commandPhase, boosterEngineCountOverride);
  const baseCounts = resolveConfiguredEngineCounts(
    LAUNCH_BOOSTER_CONFIG,
    Math.max(1, Number(LAUNCH_BOOSTER_CONFIG.engineCount) || 1),
  );
  const baseThrust = resolveConfiguredThrustBoundsN(
    LAUNCH_BOOSTER_CONFIG,
    Math.max(1, Number(baseCounts.nominalEngineCount) || 1),
  );
  const nominalBaseCount = Math.max(1, Number(baseCounts.nominalEngineCount) || 1);
  const perEngineSeaLevelN = Number(baseThrust.thrustSeaLevelN) / nominalBaseCount;
  const perEngineVacuumN = Number(baseThrust.thrustVacuumN) / nominalBaseCount;
  return {
    ...LAUNCH_BOOSTER_CONFIG,
    engineCount: phaseEngineCount,
    nominalEngineCount: phaseEngineCount,
    thrustSeaLevelN: perEngineSeaLevelN * phaseEngineCount,
    thrustVacuumN: perEngineVacuumN * phaseEngineCount,
  };
}

function stage1CombustionClusterOptions(boosterEngineCountOverride = null) {
  const descriptors = createSuperHeavyEngineDescriptors(
    stageRadiusMeters(),
    -boosterBodyLengthMeters() * 0.46,
  );
  return {
    descriptors,
    activationOrder: superHeavyEngineActivationOrder(descriptors),
    config: stage1BoosterConfigWithEngineOverride(boosterEngineCountOverride),
    fallbackEngineCount: descriptors.length,
  };
}

function stage2CombustionClusterOptions() {
  const descriptors = createStarshipStage2EngineDescriptors(
    stageRadiusMeters(),
    -stage2BodyLengthMeters() * 0.46,
  );
  return {
    descriptors,
    activationOrder: starshipStage2EngineActivationOrder(descriptors),
    config: stageAtIndex(1),
    fallbackEngineCount: descriptors.length,
  };
}

function boosterCombustionClusterOptions(boosterEngineCountOverride = null, commandPhase = "") {
  const descriptors = createSuperHeavyEngineDescriptors(
    stageRadiusMeters(),
    -boosterBodyLengthMeters() * 0.46,
  );
  return {
    descriptors,
    activationOrder: superHeavyEngineActivationOrder(descriptors),
    config: boosterRecoveryConfigForPhase(commandPhase, boosterEngineCountOverride),
    fallbackEngineCount: descriptors.length,
  };
}

function normalizedThrusterLayoutDescriptors(layout, radiusM, bodyLengthM) {
  return Object.entries(layout || {}).map(([id, spec], index) => {
    const xR = Number(spec?.anchor?.xR) || 0;
    const zR = Number(spec?.anchor?.zR) || 0;
    const rawYH = Number(spec?.anchor?.yH) || 0;
    const yNorm = rawYH >= 0 && rawYH <= 1 ? rawYH - 0.5 : rawYH;
    const positionBodyM = {
      x: xR * radiusM,
      y: yNorm * bodyLengthM,
      z: zR * radiusM,
    };
    const directionBody = normalize(
      spec?.direction || { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    );
    return {
      id,
      ring: "rcs",
      orderInRing: index,
      x: positionBodyM.x,
      y: positionBodyM.y,
      z: positionBodyM.z,
      positionBodyM,
      directionBody,
    };
  });
}

function starshipRcsThrusterDescriptors() {
  return normalizedThrusterLayoutDescriptors(
    STARSHIP_THRUSTER_LAYOUT,
    stageRadiusMeters(),
    stage2BodyLengthMeters(),
  );
}

function boosterRcsThrusterDescriptors() {
  return normalizedThrusterLayoutDescriptors(
    BOOSTER_THRUSTER_LAYOUT,
    boosterRadiusMeters(),
    boosterBodyLengthMeters(),
  );
}

function starshipRcsCombustionConfig() {
  const thrusterCount = Math.max(1, starshipRcsThrusterDescriptors().length);
  const vacuumThrusterN = Math.max(1, Number(LAUNCH_RCS_CONFIG.starshipThrusterVacuumN) || 48_000);
  const seaLevelThrusterN = Math.max(
    1,
    Number(LAUNCH_RCS_CONFIG.starshipThrusterSeaLevelN) || (vacuumThrusterN * 0.9),
  );
  return {
    engineCount: thrusterCount,
    nominalEngineCount: thrusterCount,
    thrustSeaLevelN: seaLevelThrusterN * thrusterCount,
    thrustVacuumN: vacuumThrusterN * thrusterCount,
    ispSeaLevelS: Math.max(1, Number(LAUNCH_RCS_CONFIG.starshipIspSeaLevelS) || 285),
    ispVacuumS: Math.max(1, Number(LAUNCH_RCS_CONFIG.starshipIspVacuumS) || 300),
    combustion: LAUNCH_RCS_CONFIG.starshipCombustion,
  };
}

function boosterRcsCombustionConfig() {
  return {
    engineCount: Math.max(0, Number(LAUNCH_BOOSTER_CONFIG.rcsThrusterCount) || 0),
    nominalEngineCount: Math.max(1, Number(LAUNCH_BOOSTER_CONFIG.rcsThrusterCount) || 1),
    thrustSeaLevelN: Math.max(0, Number(LAUNCH_BOOSTER_CONFIG.rcsThrustSeaLevelN) || 0),
    thrustVacuumN: Math.max(0, Number(LAUNCH_BOOSTER_CONFIG.rcsThrustVacuumN) || 0),
    ispSeaLevelS: Math.max(0, Number(LAUNCH_BOOSTER_CONFIG.rcsIspSeaLevelS) || 0),
    ispVacuumS: Math.max(0, Number(LAUNCH_BOOSTER_CONFIG.rcsIspVacuumS) || 0),
    combustion: LAUNCH_BOOSTER_CONFIG.rcsCombustion,
  };
}

function stage2RcsCombustionClusterOptions() {
  const descriptors = starshipRcsThrusterDescriptors();
  return {
    descriptors,
    activationOrder: descriptors.map((_, index) => index),
    config: starshipRcsCombustionConfig(),
    fallbackEngineCount: descriptors.length,
  };
}

function boosterRcsCombustionClusterOptions() {
  const descriptors = boosterRcsThrusterDescriptors();
  return {
    descriptors,
    activationOrder: descriptors.map((_, index) => index),
    config: boosterRcsCombustionConfig(),
    fallbackEngineCount: descriptors.length,
  };
}

function createStage1CombustionClusterState(boosterEngineCountOverride = null) {
  return createEngineCombustionClusterState(stage1CombustionClusterOptions(boosterEngineCountOverride));
}

function createStage2CombustionClusterState() {
  return createEngineCombustionClusterState(stage2CombustionClusterOptions());
}

function createStage2RcsCombustionClusterState() {
  return createEngineCombustionClusterState(stage2RcsCombustionClusterOptions());
}

function createBoosterCombustionClusterState(boosterEngineCountOverride = null) {
  return createEngineCombustionClusterState(boosterCombustionClusterOptions(boosterEngineCountOverride));
}

function createBoosterRcsCombustionClusterState() {
  return createEngineCombustionClusterState(boosterRcsCombustionClusterOptions());
}

function combustionSummaryFields(clusterState = null) {
  return {
    avgChamberPressurePa: Number(clusterState?.avgChamberPressurePa) || 0,
    maxChamberPressurePa: Number(clusterState?.maxChamberPressurePa) || 0,
    avgCombustionEfficiency: Number(clusterState?.avgCombustionEfficiency) || 0,
    avgTurbopumpNorm: Number(clusterState?.avgTurbopumpNorm) || 0,
    maxExhaustTemperatureK: Number(clusterState?.maxExhaustTemperatureK) || 0,
  };
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

function resetAttitudeStateToAxis(axisWorld = { x: 0, y: 0, z: 1 }) {
  return createBoosterAttitudeState(axisWorld);
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

function boosterCrashEnvelopeClearanceKm(attitudeState = null, upWorld = { x: 0, y: 0, z: 1 }) {
  const axis = boosterBodyAxisWorld(attitudeState);
  const up = normalize(upWorld, { x: 0, y: 0, z: 1 });
  const axialSupport = Math.abs(clamp(dot(axis, up), -1, 1));
  const radialSupport = Math.sqrt(Math.max(0, 1 - (axialSupport * axialSupport)));
  const halfLengthKm = Math.max(0, Number(STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm) || 0) * 0.5;
  const radiusKm = Math.max(0, Number(STARSHIP_STACK_DIMENSIONS_KM.diameterKm) || 0) * 0.5;
  return Math.max(radiusKm, (halfLengthKm * axialSupport) + (radiusKm * radialSupport));
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
  bodyKind = "booster",
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
  const inertia = bodyKind === "booster"
    ? boosterPrincipalInertiaKgM2(massKg, inertiaNormalized)
    : stagePrincipalInertiaKgM2(bodyKind, massKg, inertiaNormalized);
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

function updateStageThrottleState(actuatorState, {
  requestedThrottle = 0,
  dtSeconds = 0,
  massModel = null,
}) {
  const state = actuatorState || createActuatorState({ x: 0, y: 0, z: 1 });
  const cfg = LAUNCH_REALISM_CONFIG.actuator.stage;
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
  const riseTau = Math.max(0.06, (Number(cfg.throttleRiseTauSec) || 0.52) * inertiaScale);
  const fallTau = Math.max(0.05, (Number(cfg.throttleFallTauSec) || 0.34) * inertiaScale);
  const throttleTau = requestedThrottleClamped >= state.throttleActual ? riseTau : fallTau;
  const alpha = clamp(dt / throttleTau, 0, 1);
  state.throttleCommand = requestedThrottleClamped;
  state.throttleActual = state.throttleActual + ((requestedThrottleClamped - state.throttleActual) * alpha);
  return state;
}

function zeroAngularControlState(extra = {}) {
  return {
    authority: 0,
    momentNm: 0,
    bodyTorqueNm: { x: 0, y: 0, z: 0 },
    angularAccelerationRadS2: 0,
    dampingPerS: 0,
    ...extra,
  };
}

function computeStageEngineAngularControlState({
  bodyKind = "stage1",
  controlErrorsBody,
  omegaBodyRadS = null,
  throttle = 0,
  massKg = 0,
  massModel = null,
  engineState = null,
}) {
  const maxGimbalDeflectionRad = rad(
    Number(LAUNCH_REALISM_CONFIG.actuator?.stage?.maxGimbalDeflectionDeg) || 6,
  );
  if (!(throttle > 1e-6) || !(maxGimbalDeflectionRad > 1e-6)) {
    return zeroAngularControlState({ thrustDirectionBody: { x: 0, y: 1, z: 0 } });
  }
  const thrustN = Math.max(0, Number(engineState?.thrustN) || 0);
  const activeCount = Math.max(1, Number(engineState?.activeCount) || 0);
  const fullThrustN = Math.max(
    0,
    (Number(engineState?.fullPerEngineThrustN) || 0) * activeCount,
  );
  if (!(thrustN > 0)) {
    return zeroAngularControlState({ thrustDirectionBody: { x: 0, y: 1, z: 0 } });
  }
  const enginePlaneNorm = Number(
    bodyKind === "stage2"
      ? LAUNCH_REALISM_CONFIG.massModel?.stage2?.enginePlaneNorm
      : LAUNCH_REALISM_CONFIG.massModel?.stage1?.enginePlaneNorm,
  );
  const comNorm = clamp(Number(massModel?.comNormalized) || 0.5, 0, 1);
  const leverArmM = Math.max(
    0.1,
    Math.abs(comNorm - (Number.isFinite(enginePlaneNorm) ? enginePlaneNorm : 0.04))
      * stageBodyLengthMeters(bodyKind),
  );
  const omegaBody = {
    x: finiteNumber(omegaBodyRadS?.x, 0),
    y: finiteNumber(omegaBodyRadS?.y, 0),
    z: finiteNumber(omegaBodyRadS?.z, 0),
  };
  const proportionalGain = Math.max(
    0.1,
    Number(LAUNCH_REALISM_CONFIG.actuator?.stage?.attitudeProportionalGain) || 1,
  );
  const rateDampingGain = Math.max(
    0,
    Number(LAUNCH_REALISM_CONFIG.actuator?.stage?.attitudeRateDampingGain) || 0.24,
  );
  const axisCommand = clampVectorMagnitude({
    x: (proportionalGain * finiteNumber(controlErrorsBody?.pitchErrorRad, 0))
      - (rateDampingGain * omegaBody.x),
    y: 0,
    z: (proportionalGain * finiteNumber(controlErrorsBody?.yawErrorRad, 0))
      - (rateDampingGain * omegaBody.z),
  }, maxGimbalDeflectionRad);
  const deflectionMagRad = Math.hypot(axisCommand.x, axisCommand.z);
  if (!(deflectionMagRad > 1e-6)) {
    return zeroAngularControlState({ thrustDirectionBody: { x: 0, y: 1, z: 0 } });
  }
  const thrustDirectionBody = normalize({
    x: Math.sin(axisCommand.z),
    y: Math.cos(Math.hypot(axisCommand.x, axisCommand.z)),
    z: -Math.sin(axisCommand.x),
  }, { x: 0, y: 1, z: 0 });
  const controlForceDirectionBody = {
    x: thrustDirectionBody.x,
    y: thrustDirectionBody.y - 1,
    z: thrustDirectionBody.z,
  };
  const engines = Array.isArray(engineState?.activeDescriptors) && engineState.activeDescriptors.length > 0
    ? engineState.activeDescriptors
    : [{ positionBodyM: { x: 0, y: -leverArmM, z: 0 } }];
  const thrustPerEngineN = thrustN / Math.max(1, engines.length);
  const bodyTorqueNm = computeEngineClusterBodyTorqueNm({
    activeDescriptors: engines,
    engineThrustNByIndex: engineState?.engineThrustNByIndex,
    activeEngineThrustsN: Array.isArray(engineState?.activeEngineThrustsN)
      ? engineState.activeEngineThrustsN
      : null,
    fallbackPerEngineThrustN: thrustPerEngineN,
    forceDirectionBody: controlForceDirectionBody,
    fallbackY: -leverArmM,
  });
  const momentNm = Math.hypot(bodyTorqueNm.x, bodyTorqueNm.z);
  const inertia = stagePrincipalInertiaKgM2(bodyKind, massKg, massModel?.inertiaNormalized);
  const maxMomentNm = Math.max(fullThrustN, thrustN) * leverArmM * Math.sin(maxGimbalDeflectionRad);
  return {
    authority: clamp(momentNm / Math.max(maxMomentNm, 1e-6), 0, 1),
    momentNm,
    bodyTorqueNm,
    angularAccelerationRadS2: Math.hypot(
      bodyTorqueNm.x / Math.max(inertia.x, 1e-6),
      bodyTorqueNm.z / Math.max(inertia.z, 1e-6),
    ),
    dampingPerS: 0,
    thrustDirectionBody,
  };
}

function computeBoosterEngineAngularControlState({
  controlErrorsBody,
  omegaBodyRadS = null,
  pressurePa = 0,
  throttle = 0,
  massKg = 0,
  massModel = null,
  engineState = null,
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
  const resolvedEngineState = engineState || resolveSuperHeavyEngineState(
    LAUNCH_BOOSTER_CONFIG,
    pressurePa,
    throttle,
  );
  const thrustN = Math.max(0, Number(resolvedEngineState.thrustN) || 0);
  const fullThrustN = Math.max(
    0,
    (Number(resolvedEngineState.fullPerEngineThrustN) || 0)
      * Math.max(1, Number(resolvedEngineState.activeCount) || 0),
  );
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
  const controlForceDirectionBody = {
    x: commandedDirectionBody.x,
    y: commandedDirectionBody.y - 1,
    z: commandedDirectionBody.z,
  };
  const engines = Array.isArray(resolvedEngineState.activeDescriptors) && resolvedEngineState.activeDescriptors.length > 0
    ? resolvedEngineState.activeDescriptors
    : [{ positionBodyM: { x: 0, y: -leverArmM, z: 0 } }];
  const thrustPerEngineN = thrustN / Math.max(1, engines.length);
  const bodyTorqueNm = computeEngineClusterBodyTorqueNm({
    activeDescriptors: engines,
    engineThrustNByIndex: resolvedEngineState.engineThrustNByIndex,
    activeEngineThrustsN: Array.isArray(resolvedEngineState.activeEngineThrustsN)
      ? resolvedEngineState.activeEngineThrustsN
      : null,
    fallbackPerEngineThrustN: thrustPerEngineN,
    forceDirectionBody: controlForceDirectionBody,
    fallbackY: -leverArmM,
  });
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
  phase = "",
  guidanceMode = "",
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
  const modeText = `${String(phase || "")} ${String(guidanceMode || "")}`.toLowerCase();
  const terminalCatchMode = /catch/.test(modeText);
  const postSeparationTurnMode = /(separation-flip|separation-coast|boostback)/.test(modeText);
  const throttleBlend = terminalCatchMode
    ? clamp(Math.max(0.35, 1 - ((Number(throttle) || 0) / 0.95)), 0.35, 1)
    : (
      postSeparationTurnMode
        ? clamp(Math.max(0.32, 1 - ((Number(throttle) || 0) / 0.90)), 0.32, 1)
        : clamp(1 - ((Number(throttle) || 0) / 0.45), 0, 1)
    );
  const baseAngularAeroSuppression = terminalCatchMode
    ? Math.max(0.4, 1 - clamp(Number(aeroAuthority) || 0, 0, 1))
    : (1 - clamp(Number(aeroAuthority) || 0, 0, 1));
  const angularAeroSuppression = postSeparationTurnMode
    ? Math.max(0.58, baseAngularAeroSuppression)
    : baseAngularAeroSuppression;
  const effectiveAuthority = authority
    * throttleBlend
    * angularAeroSuppression
    * clamp(Number(controlAuthorityScale) || 1, 0.35, 1.4);
  if (!(effectiveAuthority > 1e-4)) {
    return {
      authority: 0,
      bodyTorqueNm: { x: 0, y: 0, z: 0 },
      angularAccelerationRadS2: 0,
      dampingPerS: 0,
      jets: [],
      jetIndices: [],
    };
  }
  const leverArmM = Math.max(1, boosterBodyLengthMeters() * 0.46);
  const maxLinearAccelMS2 = Math.max(0, Number(LAUNCH_RCS_CONFIG.maxAccelerationKmS2) || 0) * 1000;
  const terminalCatchAuthorityBoost = terminalCatchMode ? 2.6 : 1;
  const largeAngleBoost = clamp(errorDeg / 18, 1, postSeparationTurnMode ? 18 : 9);
  const postSeparationAuthorityBoost = postSeparationTurnMode ? 14.0 : 1;
  const maxAngularAccelerationRadS2 =
    ((maxLinearAccelMS2 * effectiveAuthority) / leverArmM)
    * 8.5
    * largeAngleBoost
    * postSeparationAuthorityBoost
    * terminalCatchAuthorityBoost;
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
  const angularJets = rcsAngularJetSelection(controlDemand);
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
    jets: angularJets,
    jetIndices: boosterRcsThrusterIndicesForJets(angularJets),
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

  const stageFullThrustN = stageIndex === 0
    ? resolveSuperHeavyEngineState(stage, pressurePa, 1).thrustN
    : interpolateConfiguredThrustN(stage, pressurePa);
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

function launchDirectionPitchFromVerticalDeg(direction, up) {
  if (!finiteLaunchVectorValue(direction) || !finiteLaunchVectorValue(up)) {
    return null;
  }
  const safeDirection = unitOrNull(direction);
  const safeUp = unitOrNull(up);
  if (!safeDirection || !safeUp) {
    return null;
  }
  return Math.acos(clamp(dot(safeDirection, safeUp), -1, 1)) * (180 / Math.PI);
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
    launchElapsedSeconds: finiteOrNull(
      Boolean(runtime.launchSequence?.active)
        ? Math.max(
          0,
          (Number(runtime.elapsedSeconds) || 0) - (Number(runtime.launchSequence?.startElapsedSec) || 0),
        )
        : null,
    ),
    launchSequenceActive: Boolean(runtime.launchSequence?.active),
    launchCommitReady: Boolean(runtime.launchSequence?.launchCommitReady),
    launchCommitReason: String(runtime.launchSequence?.launchCommitReason || ""),
    launchCommitElapsedSec: finiteOrNull(runtime.launchSequence?.launchCommitElapsedSec),
    padReleaseComplete: Boolean(runtime.launchSequence?.padReleaseComplete),
    padReleaseElapsedSec: finiteOrNull(runtime.launchSequence?.padReleaseElapsedSec),
    towerClearSatisfied: Boolean(runtime.launchSequence?.towerClearSatisfied),
    towerClearElapsedSec: finiteOrNull(runtime.launchSequence?.towerClearElapsedSec),
    pitchoverEnabled: Boolean(runtime.launchSequence?.pitchoverEnabled),
    pitchoverElapsedSec: finiteOrNull(runtime.launchSequence?.pitchoverElapsedSec),
    hotstageDeferredCandidateActive: Boolean(runtime.launchSequence?.hotstageDeferredCandidateActive),
    hotstageDeferredCandidateElapsedSec: finiteOrNull(runtime.launchSequence?.hotstageDeferredCandidateElapsedSec),
    hotstageDeferredCandidateAltitudeKm: finiteOrNull(runtime.launchSequence?.hotstageDeferredCandidateAltitudeKm),
    hotstageDeferredCandidateReason: String(runtime.launchSequence?.hotstageDeferredCandidateReason || ""),
    hotstageArmed: Boolean(runtime.launchSequence?.hotstageArmed),
    hotstageArmReason: String(runtime.launchSequence?.hotstageArmReason || ""),
    hotstageArmedElapsedSec: finiteOrNull(runtime.launchSequence?.hotstageArmedElapsedSec),
    hotstageIgnitionAuthorized: Boolean(runtime.launchSequence?.hotstageIgnitionAuthorized),
    hotstageIgnitionElapsedSec: finiteOrNull(runtime.launchSequence?.hotstageIgnitionElapsedSec),
    hotstageReleaseAuthorized: Boolean(runtime.launchSequence?.hotstageReleaseAuthorized),
    hotstageReleaseElapsedSec: finiteOrNull(runtime.launchSequence?.hotstageReleaseElapsedSec),
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
    activeEngineIndices: Array.isArray(runtime.lastStep?.activeEngineIndices)
      ? [...runtime.lastStep.activeEngineIndices]
      : [],
    activeEngineCount: Math.max(0, Number(runtime.lastStep?.activeEngineCount) || 0),
    desiredEngineCount: Math.max(0, Number(runtime.lastStep?.desiredEngineCount) || 0),
    failedEngineIndices: Array.isArray(runtime.lastStep?.failedEngineIndices)
      ? [...runtime.lastStep.failedEngineIndices]
      : [],
    faultedEngineIndices: Array.isArray(runtime.lastStep?.faultedEngineIndices)
      ? [...runtime.lastStep.faultedEngineIndices]
      : [],
    flamePresentIndices: Array.isArray(runtime.lastStep?.flamePresentIndices)
      ? [...runtime.lastStep.flamePresentIndices]
      : [],
    chamberPressurePaByIndex: Array.isArray(runtime.lastStep?.chamberPressurePaByIndex)
      ? [...runtime.lastStep.chamberPressurePaByIndex]
      : [],
    exhaustTemperatureKByIndex: Array.isArray(runtime.lastStep?.exhaustTemperatureKByIndex)
      ? [...runtime.lastStep.exhaustTemperatureKByIndex]
      : [],
    combustionEfficiencyByIndex: Array.isArray(runtime.lastStep?.combustionEfficiencyByIndex)
      ? [...runtime.lastStep.combustionEfficiencyByIndex]
      : [],
    turbopumpNormByIndex: Array.isArray(runtime.lastStep?.turbopumpNormByIndex)
      ? [...runtime.lastStep.turbopumpNormByIndex]
      : [],
    engineThrustNByIndex: Array.isArray(runtime.lastStep?.engineThrustNByIndex)
      ? [...runtime.lastStep.engineThrustNByIndex]
      : [],
    burnRateKgS: runtime.lastStep?.burnRateKgS || 0,
    avgChamberPressurePa: Number(runtime.lastStep?.avgChamberPressurePa) || 0,
    maxChamberPressurePa: Number(runtime.lastStep?.maxChamberPressurePa) || 0,
    avgCombustionEfficiency: Number(runtime.lastStep?.avgCombustionEfficiency) || 0,
    avgTurbopumpNorm: Number(runtime.lastStep?.avgTurbopumpNorm) || 0,
    maxExhaustTemperatureK: Number(runtime.lastStep?.maxExhaustTemperatureK) || 0,
    stagePropellantKg: Math.max(0, Number(runtime.stagePropellantKg) || 0),
    rcsPropellantKg: Math.max(0, Number(runtime.lastStep?.rcsPropellantKg ?? runtime.stageRcsPropellantKg) || 0),
    rcsInitialPropellantKg: Math.max(
      0,
      Number(runtime.lastStep?.rcsInitialPropellantKg ?? runtime.stageRcsInitialPropellantKg) || 0,
    ),
    rcsFuelFraction: Number.isFinite(Number(runtime.lastStep?.rcsFuelFraction))
      ? clamp(Number(runtime.lastStep.rcsFuelFraction), 0, 1)
      : (
        Number(runtime.stageRcsInitialPropellantKg) > 1e-6
          ? clamp((Number(runtime.stageRcsPropellantKg) || 0) / Number(runtime.stageRcsInitialPropellantKg), 0, 1)
          : null
      ),
    dynamicPressurePa,
    angleOfAttackDeg: Number(runtime.lastStep?.angleOfAttackDeg) || 0,
    qAlphaPaRad: Number(runtime.lastStep?.qAlphaPaRad) || 0,
    machNumber: Number(runtime.lastStep?.machNumber) || 0,
    dragCoefficient: Number(runtime.lastStep?.dragCoefficient) || 0,
    liftCoefficient: Number(runtime.lastStep?.liftCoefficient) || 0,
    gimbalErrorDeg: Number(runtime.lastStep?.gimbalErrorDeg) || 0,
    attitudeTorqueSources: Array.isArray(runtime.lastStep?.attitudeTorqueSources)
      ? [...runtime.lastStep.attitudeTorqueSources]
      : [],
    attitudeTorqueSourceText: String(runtime.lastStep?.attitudeTorqueSourceText || ""),
    bodyAngularRateRadS: cloneLaunchVectorOrNull(runtime.lastStep?.bodyAngularRateRadS),
    thrustVectorDirectionKm: cloneLaunchVectorOrNull(runtime.lastStep?.thrustVectorDirectionKm),
    engineGimbalAuthority: Number(runtime.lastStep?.engineGimbalAuthority) || 0,
    rcsAngularAuthority: Number(runtime.lastStep?.rcsAngularAuthority) || 0,
    aeroMomentActive: Boolean(runtime.lastStep?.aeroMomentActive),
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
    ascentCorridorName: String(LAUNCH_VEHICLE_CONFIG.guidance?.ascentCorridorName || ""),
    ascentHeadingDegFromEast: finiteOrNull(LAUNCH_VEHICLE_CONFIG.guidance?.ascentHeadingDegFromEast),
    commandedPitchFromVerticalDeg: launchDirectionPitchFromVerticalDeg(
      runtime.lastStep?.requestedDirectionKm,
      orbital.up,
    ),
    bodyPitchFromVerticalDeg: launchDirectionPitchFromVerticalDeg(
      runtime.lastStep?.bodyAxisDirectionKm,
      orbital.up,
    ),
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
    rcsLinearAuthority: Number(runtime.lastStep?.rcsLinearAuthority) || 0,
    rcsAngularAuthority: Number(runtime.lastStep?.rcsAngularAuthority) || 0,
    rcsAccelerationKmS2: cloneLaunchVectorOrNull(runtime.lastStep?.rcsAccelerationKmS2),
    rcsAccelerationMagKmS2: Number(runtime.lastStep?.rcsAccelerationMagKmS2) || 0,
    rcsThrustN: Number(runtime.lastStep?.rcsThrustN) || 0,
    rcsBurnKg: Number(runtime.lastStep?.rcsBurnKg) || 0,
    rcsBurnRateKgS: Number(runtime.lastStep?.rcsBurnRateKgS) || 0,
    rcsJets: Array.isArray(runtime.lastStep?.rcsJets) ? [...runtime.lastStep.rcsJets] : [],
    rcsCommandedThrusterIds: Array.isArray(runtime.lastStep?.rcsCommandedThrusterIds)
      ? [...runtime.lastStep.rcsCommandedThrusterIds]
      : [],
    rcsCommandedThrusterIndices: Array.isArray(runtime.lastStep?.rcsCommandedThrusterIndices)
      ? [...runtime.lastStep.rcsCommandedThrusterIndices]
      : [],
    rcsActiveThrusterIds: Array.isArray(runtime.lastStep?.rcsActiveThrusterIds)
      ? [...runtime.lastStep.rcsActiveThrusterIds]
      : [],
    rcsActiveThrusterIndices: Array.isArray(runtime.lastStep?.rcsActiveThrusterIndices)
      ? [...runtime.lastStep.rcsActiveThrusterIndices]
      : [],
    rcsBodyForceN: cloneLaunchVectorOrNull(runtime.lastStep?.rcsBodyForceN),
    rcsBodyTorqueNm: cloneLaunchVectorOrNull(runtime.lastStep?.rcsBodyTorqueNm),
    rcsThrusterThrustNByIndex: Array.isArray(runtime.lastStep?.rcsThrusterThrustNByIndex)
      ? [...runtime.lastStep.rcsThrusterThrustNByIndex]
      : [],
    rcsChamberPressurePaByIndex: Array.isArray(runtime.lastStep?.rcsChamberPressurePaByIndex)
      ? [...runtime.lastStep.rcsChamberPressurePaByIndex]
      : [],
    rcsExhaustTemperatureKByIndex: Array.isArray(runtime.lastStep?.rcsExhaustTemperatureKByIndex)
      ? [...runtime.lastStep.rcsExhaustTemperatureKByIndex]
      : [],
    rcsCombustionEfficiencyByIndex: Array.isArray(runtime.lastStep?.rcsCombustionEfficiencyByIndex)
      ? [...runtime.lastStep.rcsCombustionEfficiencyByIndex]
      : [],
    rcsTurbopumpNormByIndex: Array.isArray(runtime.lastStep?.rcsTurbopumpNormByIndex)
      ? [...runtime.lastStep.rcsTurbopumpNormByIndex]
      : [],
    rcsAvgChamberPressurePa: Number(runtime.lastStep?.rcsAvgChamberPressurePa) || 0,
    rcsMaxChamberPressurePa: Number(runtime.lastStep?.rcsMaxChamberPressurePa) || 0,
    rcsAvgCombustionEfficiency: Number(runtime.lastStep?.rcsAvgCombustionEfficiency) || 0,
    rcsAvgTurbopumpNorm: Number(runtime.lastStep?.rcsAvgTurbopumpNorm) || 0,
    rcsMaxExhaustTemperatureK: Number(runtime.lastStep?.rcsMaxExhaustTemperatureK) || 0,
    navSource: String(runtime.lastStep?.navSource || runtime.stageNavigation?.source || ""),
    navSensorNoiseActive: Boolean(runtime.lastStep?.navSensorNoiseActive ?? runtime.stageNavigation?.sensorNoiseActive),
    navPositionSigmaKm: Number(runtime.lastStep?.navPositionSigmaKm ?? runtime.stageNavigation?.positionSigmaKm) || 0,
    navVelocitySigmaKmS: Number(runtime.lastStep?.navVelocitySigmaKmS ?? runtime.stageNavigation?.velocitySigmaKmS) || 0,
    navAttitudeSigmaDeg: Number(runtime.lastStep?.navAttitudeSigmaDeg ?? runtime.stageNavigation?.attitudeSigmaDeg) || 0,
    navPositionErrorKm: cloneLaunchVectorOrNull(runtime.lastStep?.navPositionErrorKm || runtime.stageNavigation?.positionErrorKm),
    navVelocityErrorKmS: cloneLaunchVectorOrNull(runtime.lastStep?.navVelocityErrorKmS || runtime.stageNavigation?.velocityErrorKmS),
    navAttitudeErrorDeg: cloneLaunchVectorOrNull(runtime.lastStep?.navAttitudeErrorDeg || runtime.stageNavigation?.attitudeErrorDeg),
    boosterDistanceKm: runtime.boosterDistanceKm,
    starshipDistanceKm: runtime.starshipDistanceKm,
    hotstageActive: Boolean(runtime.hotstage.active),
    hotstageShipReferenceActive: Boolean(
      runtime.hotstage?.shipReferenceActive || runtime.attachedJoint?.shipReferenceActive,
    ),
    attachedJointShipReferenceActive: Boolean(runtime.attachedJoint?.shipReferenceActive),
    hotstageTimeSinceIgnitionSec: hotstageTimeSinceIgnitionSec(runtime.hotstage, runtime.elapsedSeconds),
    hotstageOverlapSeconds: Number(runtime.hotstage.overlapSeconds) || hotstageOverlapSeconds(),
    hotstageIgnitionStableSec: Number(runtime.hotstage.ignitionStableSec) || 0,
    hotstageVirtualSeparationKm: Number(runtime.hotstage.virtualSeparationKm) || 0,
    hotstagePhysicalSeparationKm: Number(runtime.hotstage.physicalSeparationKm) || Number(runtime.attachedJoint?.physicalSeparationKm) || 0,
    hotstagePhysicalSeparationRateKmS: Number(runtime.hotstage.physicalSeparationRateKmS) || Number(runtime.attachedJoint?.physicalSeparationRateKmS) || 0,
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
  const caughtSupportAxis = (
    runtime.booster.landed
    && String(runtime.booster.terminalOutcome || "") === "caught"
  )
    ? (
      unitOrNull(boosterBodyAxisWorld(runtime.booster.attitude))
      || unitOrNull(surfaceSample?.surfaceNormal)
      || unitOrNull(relPos)
    )
    : null;
  const bodyAxisDirection = (
    caughtSupportAxis
    || (runtime.booster.lastStep?.bodyAxisDirectionKm
      ? unitOrNull(runtime.booster.lastStep.bodyAxisDirectionKm)
      : null)
    || unitOrNull(boosterBodyAxisWorld(runtime.booster.attitude))
  );
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
  const boosterSurfaceClearanceKm = runtime.booster.crashed
    ? Math.max(
      0,
      Number(runtime.booster.crashDynamics?.clearanceKm)
        || boosterCrashEnvelopeClearanceKm(
          runtime.booster.attitude,
          surfaceSample?.surfaceNormal || orbital.up || relPos,
        ),
    )
    : BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM;
  const boosterAltitudeAboveTerrainKm = Number.isFinite(centerAltitudeAboveTerrainKm)
    ? centerAltitudeAboveTerrainKm - boosterSurfaceClearanceKm
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
	    mainThrustDirectionKm: cloneLaunchVectorOrNull(runtime.booster.lastStep?.mainThrustDirectionKm),
	    requestedThrustVerticalComponent: finiteOrNull(runtime.booster.lastStep?.requestedThrustVerticalComponent),
	    mainThrustVerticalComponent: finiteOrNull(runtime.booster.lastStep?.mainThrustVerticalComponent),
	    mainThrustMinUpComponent: Number(runtime.booster.lastStep?.mainThrustMinUpComponent) || 0,
	    mainThrustVerticalFloorActive: Boolean(runtime.booster.lastStep?.mainThrustVerticalFloorActive),
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
    activeEngineIndices: Array.isArray(runtime.booster.lastStep?.activeEngineIndices)
      ? [...runtime.booster.lastStep.activeEngineIndices]
      : [],
    activeEngineCount: Math.max(0, Number(runtime.booster.lastStep?.activeEngineCount) || 0),
    desiredEngineCount: Math.max(0, Number(runtime.booster.lastStep?.desiredEngineCount) || 0),
    failedEngineIndices: Array.isArray(runtime.booster.lastStep?.failedEngineIndices)
      ? [...runtime.booster.lastStep.failedEngineIndices]
      : [],
    faultedEngineIndices: Array.isArray(runtime.booster.lastStep?.faultedEngineIndices)
      ? [...runtime.booster.lastStep.faultedEngineIndices]
      : [],
    flamePresentIndices: Array.isArray(runtime.booster.lastStep?.flamePresentIndices)
      ? [...runtime.booster.lastStep.flamePresentIndices]
      : [],
    chamberPressurePaByIndex: Array.isArray(runtime.booster.lastStep?.chamberPressurePaByIndex)
      ? [...runtime.booster.lastStep.chamberPressurePaByIndex]
      : [],
    exhaustTemperatureKByIndex: Array.isArray(runtime.booster.lastStep?.exhaustTemperatureKByIndex)
      ? [...runtime.booster.lastStep.exhaustTemperatureKByIndex]
      : [],
    combustionEfficiencyByIndex: Array.isArray(runtime.booster.lastStep?.combustionEfficiencyByIndex)
      ? [...runtime.booster.lastStep.combustionEfficiencyByIndex]
      : [],
    turbopumpNormByIndex: Array.isArray(runtime.booster.lastStep?.turbopumpNormByIndex)
      ? [...runtime.booster.lastStep.turbopumpNormByIndex]
      : [],
    engineThrustNByIndex: Array.isArray(runtime.booster.lastStep?.engineThrustNByIndex)
      ? [...runtime.booster.lastStep.engineThrustNByIndex]
      : [],
    burnRateKgS: runtime.booster.lastStep?.burnRateKgS || 0,
    avgChamberPressurePa: Number(runtime.booster.lastStep?.avgChamberPressurePa) || 0,
    maxChamberPressurePa: Number(runtime.booster.lastStep?.maxChamberPressurePa) || 0,
    avgCombustionEfficiency: Number(runtime.booster.lastStep?.avgCombustionEfficiency) || 0,
    avgTurbopumpNorm: Number(runtime.booster.lastStep?.avgTurbopumpNorm) || 0,
    maxExhaustTemperatureK: Number(runtime.booster.lastStep?.maxExhaustTemperatureK) || 0,
    rcsBurnRateKgS: runtime.booster.lastStep?.rcsBurnRateKgS || 0,
    rcsActive: Boolean(runtime.booster.lastStep?.rcsActive),
    rcsErrorDeg: Number(runtime.booster.lastStep?.rcsErrorDeg) || 0,
    rcsAuthority: Number(runtime.booster.lastStep?.rcsAuthority) || 0,
    rcsAccelerationKmS2: cloneLaunchVector(runtime.booster.lastStep?.rcsAccelerationKmS2),
    rcsAccelerationMagKmS2: Number(runtime.booster.lastStep?.rcsAccelerationMagKmS2) || 0,
    rcsJets: Array.isArray(runtime.booster.lastStep?.rcsJets) ? [...runtime.booster.lastStep.rcsJets] : [],
    rcsActiveThrusterIndices: Array.isArray(runtime.booster.lastStep?.rcsActiveThrusterIndices)
      ? [...runtime.booster.lastStep.rcsActiveThrusterIndices]
      : [],
    rcsFailedThrusterIndices: Array.isArray(runtime.booster.lastStep?.rcsFailedThrusterIndices)
      ? [...runtime.booster.lastStep.rcsFailedThrusterIndices]
      : [],
    rcsFaultedThrusterIndices: Array.isArray(runtime.booster.lastStep?.rcsFaultedThrusterIndices)
      ? [...runtime.booster.lastStep.rcsFaultedThrusterIndices]
      : [],
    rcsFlamePresentThrusterIndices: Array.isArray(runtime.booster.lastStep?.rcsFlamePresentThrusterIndices)
      ? [...runtime.booster.lastStep.rcsFlamePresentThrusterIndices]
      : [],
    rcsChamberPressurePaByIndex: Array.isArray(runtime.booster.lastStep?.rcsChamberPressurePaByIndex)
      ? [...runtime.booster.lastStep.rcsChamberPressurePaByIndex]
      : [],
    rcsExhaustTemperatureKByIndex: Array.isArray(runtime.booster.lastStep?.rcsExhaustTemperatureKByIndex)
      ? [...runtime.booster.lastStep.rcsExhaustTemperatureKByIndex]
      : [],
    rcsCombustionEfficiencyByIndex: Array.isArray(runtime.booster.lastStep?.rcsCombustionEfficiencyByIndex)
      ? [...runtime.booster.lastStep.rcsCombustionEfficiencyByIndex]
      : [],
    rcsTurbopumpNormByIndex: Array.isArray(runtime.booster.lastStep?.rcsTurbopumpNormByIndex)
      ? [...runtime.booster.lastStep.rcsTurbopumpNormByIndex]
      : [],
    rcsThrusterThrustNByIndex: Array.isArray(runtime.booster.lastStep?.rcsThrusterThrustNByIndex)
      ? [...runtime.booster.lastStep.rcsThrusterThrustNByIndex]
      : [],
    rcsAvgChamberPressurePa: Number(runtime.booster.lastStep?.rcsAvgChamberPressurePa) || 0,
    rcsMaxChamberPressurePa: Number(runtime.booster.lastStep?.rcsMaxChamberPressurePa) || 0,
    rcsAvgCombustionEfficiency: Number(runtime.booster.lastStep?.rcsAvgCombustionEfficiency) || 0,
    rcsAvgTurbopumpNorm: Number(runtime.booster.lastStep?.rcsAvgTurbopumpNorm) || 0,
    rcsMaxExhaustTemperatureK: Number(runtime.booster.lastStep?.rcsMaxExhaustTemperatureK) || 0,
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
    recoveryHardwareMode: String(runtime.booster.lastStep?.recoveryHardwareMode || ""),
    recoveryControlStack: Array.isArray(runtime.booster.lastStep?.recoveryControlStack)
      ? [...runtime.booster.lastStep.recoveryControlStack]
      : [],
    gridFinGeneration: String(runtime.booster.lastStep?.gridFinGeneration || ""),
    gridFinRole: String(runtime.booster.lastStep?.gridFinRole || ""),
    gridFinControlDominant: Boolean(runtime.booster.lastStep?.gridFinControlDominant),
    gridFinDeploymentState: String(runtime.booster.lastStep?.gridFinDeploymentState || ""),
    gridFinPhaseState: String(runtime.booster.lastStep?.gridFinPhaseState || ""),
    gridFinCommandState: String(runtime.booster.lastStep?.gridFinCommandState || ""),
    gridFinAeroLoaded: Boolean(runtime.booster.lastStep?.gridFinAeroLoaded),
    gridFinControlActive: Boolean(runtime.booster.lastStep?.gridFinControlActive),
    gridFinSaturated: Boolean(runtime.booster.lastStep?.gridFinSaturated),
    gridFinMaxDeflectionDeg: Number(runtime.booster.lastStep?.gridFinMaxDeflectionDeg) || 0,
    engineRole: String(runtime.booster.lastStep?.engineRole || ""),
    engineSet: String(runtime.booster.lastStep?.engineSet || ""),
    towerSensorMode: String(runtime.booster.lastStep?.towerSensorMode || ""),
    towerSensorHealthy: Boolean(runtime.booster.lastStep?.towerSensorHealthy),
    catchCommitState: String(runtime.booster.lastStep?.catchCommitState || ""),
    gridFinAuthority: Number(runtime.booster.lastStep?.gridFinAuthority) || 0,
    gridFinDeflectionDeg: Number(runtime.booster.lastStep?.gridFinDeflectionDeg) || 0,
    gridFinStates: Array.isArray(runtime.booster.lastStep?.gridFinStates)
      ? runtime.booster.lastStep.gridFinStates.map((finState) => ({ ...finState }))
      : [],
    gridFinMomentNm: Number(runtime.booster.lastStep?.gridFinMomentNm) || 0,
    gridFinAngularAccelerationRadS2: Number(runtime.booster.lastStep?.gridFinAngularAccelerationRadS2) || 0,
    engineAsymmetryBodyTorqueNm: cloneLaunchVectorOrNull(runtime.booster.lastStep?.engineAsymmetryBodyTorqueNm),
    engineAsymmetryMomentNm: Number(runtime.booster.lastStep?.engineAsymmetryMomentNm) || 0,
    aeroMomentNm: Number(runtime.booster.lastStep?.aeroMomentNm) || 0,
    engineAngularAccelerationRadS2: Number(runtime.booster.lastStep?.engineAngularAccelerationRadS2) || 0,
    rcsAngularAccelerationRadS2: Number(runtime.booster.lastStep?.rcsAngularAccelerationRadS2) || 0,
    attitudeTorqueSources: Array.isArray(runtime.booster.lastStep?.attitudeTorqueSources)
      ? [...runtime.booster.lastStep.attitudeTorqueSources]
      : [],
    attitudeTorqueSourceText: String(runtime.booster.lastStep?.attitudeTorqueSourceText || ""),
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
    crashed: Boolean(runtime.booster.crashed),
    terminalOutcome: String(runtime.booster.terminalOutcome || ""),
    terminalReason: String(runtime.booster.terminalReason || ""),
    impactSpeedKmS: finiteOrNull(runtime.booster.impactSpeedKmS),
    impactVerticalSpeedKmS: finiteOrNull(runtime.booster.impactVerticalSpeedKmS),
    impactLateralSpeedKmS: finiteOrNull(runtime.booster.impactLateralSpeedKmS),
    impactBodyUpAlignment: finiteOrNull(runtime.booster.impactBodyUpAlignment),
    crashDynamicsActive: Boolean(runtime.booster.crashDynamics?.active),
    crashSettled: Boolean(runtime.booster.crashDynamics?.settled),
    crashMode: String(runtime.booster.crashDynamics?.mode || ""),
    crashTipAngleDeg: Number(runtime.booster.crashDynamics?.tipAngleDeg) || 0,
    crashAngularSpeedRadS: Number(runtime.booster.crashDynamics?.angularSpeedRadS) || 0,
    crashSlideSpeedKmS: Number(runtime.booster.crashDynamics?.slideSpeedKmS) || 0,
    crashNormalSpeedKmS: Number(runtime.booster.crashDynamics?.normalSpeedKmS) || 0,
    crashClearanceKm: Number(runtime.booster.crashDynamics?.clearanceKm) || boosterSurfaceClearanceKm,
    crashBodyAboveTerrainKm: finiteOrNull(runtime.booster.crashDynamics?.bodyAboveTerrainKm),
    crashSurfaceContact: Boolean(runtime.booster.crashDynamics?.lastSurfaceContact),
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

function enforceMinimumUpComponent(direction, upAxis, minUpComponent = 0) {
  const safeUp = normalize(upAxis || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const safeDirection = normalize(direction || safeUp, safeUp);
  const minDot = clamp(Number(minUpComponent) || 0, -1, 1);
  const currentDot = dot(safeDirection, safeUp);
  if (currentDot >= minDot) {
    return safeDirection;
  }
  const lateral = subtract(safeDirection, scale(safeUp, currentDot));
  const lateralDirection = unitOrNull(lateral);
  if (!lateralDirection) {
    return safeUp;
  }
  return normalize(
    add(
      scale(safeUp, minDot),
      scale(lateralDirection, Math.sqrt(Math.max(0, 1 - (minDot * minDot)))),
    ),
    safeUp,
  );
}

function composePredictiveCatchDirection(baseDirection, catchRelativeState, predictiveCatchControl = null) {
  if (!predictiveCatchControl?.enabled || !catchRelativeState) {
    return normalize(baseDirection || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  }
  const localDirection = predictiveCatchControl.localDirection || {};
  const fallbackDirection = normalize(baseDirection || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const up = normalize(catchRelativeState.upAxisKm || { x: 0, y: 0, z: 1 }, fallbackDirection);
  const east = normalize(catchRelativeState.eastAxisKm || { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const north = normalize(catchRelativeState.northAxisKm || cross(up, east), cross(up, east));
  const localCommand = add(
    scale(east, Number(localDirection.east) || 0),
    add(
      scale(north, Number(localDirection.north) || 0),
      scale(up, Number(localDirection.up) || 0),
    ),
  );
  let catchDirection = normalize(localCommand, up);
  const retrogradeBias = clamp(Number(predictiveCatchControl.retrogradeBias) || 0, 0, 0.35);
  if (retrogradeBias > 1e-6) {
    const catchRetrograde = normalize(
      scale(catchRelativeState.relativeVelocityKmS || { x: 0, y: 0, z: 0 }, -1),
      catchDirection,
    );
    catchDirection = normalize(
      mixVectors(catchDirection, catchRetrograde, retrogradeBias),
      catchDirection,
    );
  }
  const blend = clamp(Number(predictiveCatchControl.blend) || 0, 0, 1);
  if (blend <= 1e-6) {
    return fallbackDirection;
  }
  return normalize(mixVectors(fallbackDirection, catchDirection, blend), catchDirection);
}

function predictiveCatchTranslationDirection(catchRelativeState, predictiveCatchControl = null) {
  if (!predictiveCatchControl?.enabled || !catchRelativeState) {
    return null;
  }
  const localDirection = predictiveCatchControl.localDirection || {};
  const east = normalize(catchRelativeState.eastAxisKm || { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const north = normalize(
    catchRelativeState.northAxisKm || cross(catchRelativeState.upAxisKm || { x: 0, y: 0, z: 1 }, east),
    { x: 0, y: 1, z: 0 },
  );
  const lateralWorld = add(
    scale(east, Number(localDirection.east) || 0),
    scale(north, Number(localDirection.north) || 0),
  );
  return unitOrNull(lateralWorld);
}

function limitDirectionOffAxis(desiredDirection, referenceAxis, maxTiltRad) {
  const axis = normalize(referenceAxis || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const desired = normalize(desiredDirection || axis, axis);
  const angle = angleBetweenRadians(axis, desired);
  const limit = Math.max(0, Number(maxTiltRad) || 0);
  if (!(angle > limit) || !(limit > 1e-9)) {
    return desired;
  }
  const projected = subtract(desired, scale(axis, dot(desired, axis)));
  let lateralAxis = unitOrNull(projected);
  if (!lateralAxis) {
    lateralAxis = unitOrNull(cross(axis, { x: 1, y: 0, z: 0 }))
      || unitOrNull(cross(axis, { x: 0, y: 1, z: 0 }))
      || { x: 0, y: 0, z: 1 };
  }
  return normalize(
    add(
      scale(axis, Math.cos(limit)),
      scale(lateralAxis, Math.sin(limit)),
    ),
    axis,
  );
}

function interpolateDirectionAlongArc(fromDirection, toDirection, t, fallbackAxis = { x: 0, y: 0, z: 1 }) {
  const from = normalize(fromDirection || fallbackAxis, fallbackAxis);
  const to = normalize(toDirection || from, from);
  const blend = clamp(Number(t) || 0, 0, 1);
  const angle = angleBetweenRadians(from, to);
  if (!(angle > 1e-6)) {
    return to;
  }
  let axis = unitOrNull(cross(from, to));
  if (!axis) {
    axis = unitOrNull(cross(fallbackAxis, from))
      || unitOrNull(cross({ x: 1, y: 0, z: 0 }, from))
      || unitOrNull(cross({ x: 0, y: 1, z: 0 }, from))
      || { x: 0, y: 0, z: 1 };
  }
  const stepAngle = angle * blend;
  const cosStep = Math.cos(stepAngle);
  const sinStep = Math.sin(stepAngle);
  return normalize(
    add(
      add(
        scale(from, cosStep),
        scale(cross(axis, from), sinStep),
      ),
      scale(axis, dot(axis, from) * (1 - cosStep)),
    ),
    to,
  );
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
    activeEngineIndices: [],
    activeEngineCount: 0,
    desiredEngineCount: 0,
    failedEngineIndices: [],
    faultedEngineIndices: [],
    flamePresentIndices: [],
    chamberPressurePaByIndex: [],
    exhaustTemperatureKByIndex: [],
    combustionEfficiencyByIndex: [],
    turbopumpNormByIndex: [],
    engineThrustNByIndex: [],
    engineAsymmetryBodyTorqueNm: { x: 0, y: 0, z: 0 },
    engineAsymmetryMomentNm: 0,
    aeroMomentNm: 0,
    engineAngularAccelerationRadS2: 0,
    rcsAngularAccelerationRadS2: 0,
    attitudeTorqueSources: [],
    attitudeTorqueSourceText: "none",
    burnKg: 0,
    burnRateKgS: 0,
    avgChamberPressurePa: 0,
    maxChamberPressurePa: 0,
    avgCombustionEfficiency: 0,
    avgTurbopumpNorm: 0,
    maxExhaustTemperatureK: 0,
    bodyRetrogradeAlignment: 0,
    bodyAntiTangentAlignment: 0,
    bodyUpAlignment: 1,
    terminalUprightCommit: false,
    uprightTiltLimitDeg: 0,
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
    ...resolveBoosterRecoveryHardwareState({
      phase: "idle",
      guidanceMode,
      attitudeControlMode: "inactive",
    }),
  };
}

function caughtBoosterStep(upAxisWorld = { x: 0, y: 0, z: 1 }) {
  const upAxis = normalize(upAxisWorld, { x: 0, y: 0, z: 1 });
  return {
    ...zeroBoosterStep("booster-caught"),
    requestedDirectionKm: cloneLaunchVector(upAxis),
    bodyAxisDirectionKm: cloneLaunchVector(upAxis),
    bodyAngularRateRadS: { x: 0, y: 0, z: 0 },
    bodyUpAlignment: 1,
    terminalUprightCommit: true,
    uprightTiltLimitDeg: 0,
    attitudeControlMode: "support-lock",
    ...resolveBoosterRecoveryHardwareState({
      phase: "caught",
      guidanceMode: "booster-caught",
      attitudeControlMode: "support-lock",
      towerRelativeActive: true,
      catchPositionSigmaKm: 0,
      catchVelocitySigmaKmS: 0,
      catchPointContactEligible: true,
      catchCaptureActive: true,
    }),
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
  if (phase === "catch") {
    return "Catch";
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
  const guidanceText = String(source?.guidanceMode || telemetry?.guidanceMode || "").toLowerCase();
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
  if (guidanceText.includes("hotstage-anomaly-hold")) {
    return "coast";
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
  if (
    boosterRuntime?.crashed
    || guidanceText.includes("crash")
    || guidanceText.includes("impact")
  ) {
    return "crashed";
  }
  if (boosterRuntime?.landed || surfaceSettled) {
    return guidanceText.includes("caught") ? "caught" : "landed";
  }
  if (boosterRuntime?.capture?.active || guidanceText.includes("catch")) {
    return "catch";
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
    sampleEnvironment,
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
    boosterEngineCountOverride: defaultBoosterEngineCountSelection(),
    stageActuator: createActuatorState({ x: 0, y: 0, z: 1 }),
    stageAttitude: createBoosterAttitudeState({ x: 0, y: 0, z: 1 }),
    stageMassModel: createMassModelState(),
    stage1Combustion: createStage1CombustionClusterState(defaultBoosterEngineCountSelection()),
    stage2Combustion: createStage2CombustionClusterState(),
    stageRcsCombustion: createStage2RcsCombustionClusterState(),
    stageRcsPropellantKg: 0,
    stageRcsInitialPropellantKg: 0,
    stageNavigation: createStarshipNavigationState(),
    starshipStateGuard: createStarshipStateGuardState(),
    boosterActuator: createActuatorState({ x: 0, y: 0, z: 1 }),
    boosterMassModel: createMassModelState(),
    attachedJoint: createAttachedStackJointState(),
    launchSequence: createLaunchSequenceState(),
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
      separationAxisKm: null,
      landed: false,
      crashed: false,
      terminalOutcome: "",
      terminalReason: "",
      impactSpeedKmS: null,
      impactVerticalSpeedKmS: null,
      impactLateralSpeedKmS: null,
      impactBodyUpAlignment: null,
      crashDynamics: createBoosterCrashDynamicsState(),
      combustion: createBoosterCombustionClusterState(defaultBoosterEngineCountSelection()),
      rcsCombustion: createBoosterRcsCombustionClusterState(),
      lastStep: null,
      lastSurfaceSample: null,
      lastTrackedPositionKm: null,
      telemetry: null,
      contactHoldSec: 0,
      catchAlignHoldSec: 0,
      capture: createBoosterCatchCaptureState(),
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
    sampleEnvironment,
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
      boosterCrashed: Boolean(runtime.booster.crashed),
      boosterTerminalOutcome: String(runtime.booster.terminalOutcome || ""),
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
    if (!previous.boosterCrashed && current.boosterCrashed) {
      emitLaunchEvent("booster_crashed", {
        trigger,
        terminalOutcome: current.boosterTerminalOutcome,
        terminalReason: runtime.booster.terminalReason || "",
        impactSpeedKmS: finiteOrNull(runtime.booster.impactSpeedKmS),
        impactVerticalSpeedKmS: finiteOrNull(runtime.booster.impactVerticalSpeedKmS),
        impactLateralSpeedKmS: finiteOrNull(runtime.booster.impactLateralSpeedKmS),
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
    const runtimeEnvironmentSample = sampleEnvironment?.({
      timestampMs: nowMs,
      relativePositionKm: relPos,
      earthAxes: currentEarthAxes,
      earthPole: currentEarthAxes?.pole,
      earthRadiusKm,
    }) || null;
    const surfaceSample = runtimeEnvironmentSample?.surface || sampleEarthSurfaceAtRelativePosition(
      relPos,
      currentEarthAxes,
      earthRadiusKm,
      { includeTerrain: true },
    );
    const surfaceAltitudeKm = Number(surfaceSample?.altitudeAboveTerrainKm);
    const runtimeAltitudeKm = Number(runtimeEnvironmentSample?.altitudeKm);
    const altitudeKm = Number.isFinite(runtimeAltitudeKm)
      ? Math.max(0, runtimeAltitudeKm)
      : (
        Number.isFinite(surfaceAltitudeKm)
          ? Math.max(0, surfaceAltitudeKm)
          : Math.max(0, length(relPos) - earthRadiusKm)
      );
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
    const launchWeatherSample = runtimeEnvironmentSample?.launchWeather || sampleLaunchWeather?.({
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
      runtimeEnvironmentSample,
      atmosphereSample: runtimeEnvironmentSample?.atmosphere
        || sampleEarthAtmosphere?.(altitudeKm, atmosphereContext)
        || null,
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

  function surfaceVelocityAtRelativePosition(earthState, relativePositionKm, currentEarthAxes) {
    const angularVelocity = scale(
      currentEarthAxes?.pole || { x: 0, y: 0, z: 1 },
      EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
    );
    return add(
      earthState?.velocity || { x: 0, y: 0, z: 0 },
      cross(angularVelocity, relativePositionKm || { x: 0, y: 0, z: 0 }),
    );
  }

  function boosterCrashSurfaceContactState({
    boosterState,
    earthState,
    currentEarthAxes,
    earthRadiusKm,
  }) {
    if (!boosterState?.position || !earthState?.position) {
      return null;
    }
    const relativePositionKm = subtract(boosterState.position, earthState.position);
    const surfaceSample = sampleEarthSurfaceAtRelativePosition(
      relativePositionKm,
      currentEarthAxes,
      earthRadiusKm,
      { includeTerrain: true },
    );
    const normal = normalize(
      surfaceSample?.surfaceNormal || relativePositionKm,
      currentEarthAxes?.pole || { x: 0, y: 0, z: 1 },
    );
    const clearanceKm = boosterCrashEnvelopeClearanceKm(runtime.booster.attitude, normal);
    const altitudeAboveTerrainKm = Number(surfaceSample?.altitudeAboveTerrainKm);
    const surfacePointRelativeKm = surfaceSample?.surfacePointRelativeKm
      || (
        Number.isFinite(altitudeAboveTerrainKm)
          ? subtract(relativePositionKm, scale(normal, altitudeAboveTerrainKm))
          : null
      );
    return {
      relativePositionKm,
      surfaceSample,
      normal,
      clearanceKm,
      altitudeAboveTerrainKm,
      bodyAboveTerrainKm: Number.isFinite(altitudeAboveTerrainKm)
        ? altitudeAboveTerrainKm - clearanceKm
        : Number.POSITIVE_INFINITY,
      surfacePointRelativeKm,
    };
  }

  function placeBoosterOnCrashSurface({
    boosterState,
    earthState,
    currentEarthAxes,
    earthRadiusKm,
    contactState,
  }) {
    const contact = contactState || boosterCrashSurfaceContactState({
      boosterState,
      earthState,
      currentEarthAxes,
      earthRadiusKm,
    });
    if (!contact?.surfacePointRelativeKm || !contact?.normal) {
      return null;
    }
    const correctedRelativePositionKm = add(
      contact.surfacePointRelativeKm,
      scale(contact.normal, contact.clearanceKm),
    );
    boosterState.position = add(earthState.position, correctedRelativePositionKm);
    const correctedSample = sampleEarthSurfaceAtRelativePosition(
      correctedRelativePositionKm,
      currentEarthAxes,
      earthRadiusKm,
      { includeTerrain: true },
    ) || contact.surfaceSample;
    if (correctedSample) {
      runtime.booster.lastSurfaceSample = correctedSample;
    }
    return {
      correctedRelativePositionKm,
      correctedSample,
      clearanceKm: contact.clearanceKm,
      normal: contact.normal,
    };
  }

  function startBoosterCrashDynamics({
    boosterState,
    earthState,
    currentEarthAxes,
    earthRadiusKm,
    reason,
    impactSpeedKmS = null,
    impactVerticalSpeedKmS = null,
    impactLateralSpeedKmS = null,
    impactBodyUpAlignment = null,
    impactImpulseDirectionKm = null,
  } = {}) {
    const crash = resetBoosterCrashDynamicsState(runtime.booster.crashDynamics);
    const normalizedReason = String(reason || "surface-impact");
    const towerStrike = normalizedReason.includes("tower")
      || normalizedReason.includes("catch")
      || normalizedReason.includes("chopstick");
    crash.active = true;
    crash.mode = towerStrike ? "tower-strike" : "surface-impact";
    crash.towerStrike = towerStrike;
    runtime.booster.crashDynamics = crash;

    if (!boosterState?.position || !boosterState?.velocity || !earthState?.position) {
      return crash;
    }

    const contact = boosterCrashSurfaceContactState({
      boosterState,
      earthState,
      currentEarthAxes,
      earthRadiusKm,
    });
    const up = normalize(contact?.normal || subtract(boosterState.position, earthState.position), currentEarthAxes?.pole);
    const surfaceContact = Boolean(
      normalizedReason.includes("surface-impact")
      || (Number(contact?.bodyAboveTerrainKm) <= BOOSTER_CRASH_DYNAMICS_LIMITS.contactBandKm)
    );
    const relativePositionForSurfaceKm = (
      surfaceContact && contact?.surfacePointRelativeKm
        ? add(contact.surfacePointRelativeKm, scale(up, contact.clearanceKm))
        : subtract(boosterState.position, earthState.position)
    );
    const surfaceVelocityKmS = surfaceVelocityAtRelativePosition(
      earthState,
      relativePositionForSurfaceKm,
      currentEarthAxes,
    );
    let relativeVelocityKmS = subtract(boosterState.velocity, surfaceVelocityKmS);
    const normalSpeedKmS = dot(relativeVelocityKmS, up);
    const tangentialVelocityKmS = subtract(relativeVelocityKmS, scale(up, normalSpeedKmS));
    const tangentialDirection = unitOrNull(tangentialVelocityKmS)
      || unitOrNull(impactImpulseDirectionKm)
      || unitOrNull(cross(up, currentEarthAxes?.pole || { x: 0, y: 0, z: 1 }))
      || unitOrNull(cross(up, { x: 1, y: 0, z: 0 }))
      || { x: 1, y: 0, z: 0 };

    if (surfaceContact) {
      const placement = placeBoosterOnCrashSurface({
        boosterState,
        earthState,
        currentEarthAxes,
        earthRadiusKm,
        contactState: contact,
      });
      const correctedSurfaceVelocityKmS = surfaceVelocityAtRelativePosition(
        earthState,
        placement?.correctedRelativePositionKm || relativePositionForSurfaceKm,
        currentEarthAxes,
      );
      relativeVelocityKmS = subtract(boosterState.velocity, correctedSurfaceVelocityKmS);
      const inwardSpeedKmS = dot(relativeVelocityKmS, up);
      if (inwardSpeedKmS < 0) {
        relativeVelocityKmS = subtract(
          relativeVelocityKmS,
          scale(up, inwardSpeedKmS * (1 + BOOSTER_CRASH_DYNAMICS_LIMITS.normalRestitution)),
        );
      }
      const correctedNormalSpeedKmS = dot(relativeVelocityKmS, up);
      const correctedTangentKmS = subtract(relativeVelocityKmS, scale(up, correctedNormalSpeedKmS));
      relativeVelocityKmS = subtract(correctedTangentKmS, scale(correctedTangentKmS, 0.18));
      boosterState.velocity = add(correctedSurfaceVelocityKmS, relativeVelocityKmS);
      crash.lastSurfaceContact = true;
    } else if (towerStrike) {
      const impulseSpeedKmS = clamp(
        Math.max(
          0.004,
          (Number(impactSpeedKmS) || length(relativeVelocityKmS)) * 0.18,
          (Number(impactLateralSpeedKmS) || length(tangentialVelocityKmS)) * 0.35,
        ),
        0.004,
        0.022,
      );
      boosterState.velocity = add(boosterState.velocity, scale(tangentialDirection, impulseSpeedKmS));
      relativeVelocityKmS = add(relativeVelocityKmS, scale(tangentialDirection, impulseSpeedKmS));
    }

    const bodyAxis = boosterBodyAxisWorld(runtime.booster.attitude);
    const bodyUpAlignment = Number.isFinite(Number(impactBodyUpAlignment))
      ? Number(impactBodyUpAlignment)
      : dot(bodyAxis, up);
    const downwardSpeedMS = Math.max(
      0,
      -(Number(impactVerticalSpeedKmS) || normalSpeedKmS || 0) * 1000,
      -normalSpeedKmS * 1000,
    );
    const lateralSpeedMS = Math.max(
      0,
      (Number(impactLateralSpeedKmS) || 0) * 1000,
      length(tangentialVelocityKmS) * 1000,
      towerStrike ? 8 : 0,
    );
    const severityMS = Math.max(
      lateralSpeedMS,
      downwardSpeedMS * 0.32,
      (Number(impactSpeedKmS) || length(relativeVelocityKmS)) * 1000 * 0.24,
    );
    const tipAxisWorld = unitOrNull(cross(up, tangentialDirection))
      || unitOrNull(cross(up, bodyAxis))
      || unitOrNull(cross(up, currentEarthAxes?.xAxis || { x: 1, y: 0, z: 0 }))
      || { x: 1, y: 0, z: 0 };
    if (severityMS > 0.05) {
      const misalignmentScale = 1 + (1.8 * clamp(1 - Math.abs(bodyUpAlignment), 0, 1));
      const tipRateRadS = clamp(
        (severityMS / Math.max(8, boosterBodyLengthMeters() * 0.48)) * misalignmentScale,
        BOOSTER_CRASH_DYNAMICS_LIMITS.minImpactTipRateRadS,
        BOOSTER_CRASH_DYNAMICS_LIMITS.maxTipRateRadS,
      );
      const impulseOmegaBody = rotateWorldVectorToBoosterBody(
        scale(tipAxisWorld, tipRateRadS),
        runtime.booster.attitude,
      );
      runtime.booster.attitude.omegaBodyRadS = add(
        runtime.booster.attitude?.omegaBodyRadS || { x: 0, y: 0, z: 0 },
        impulseOmegaBody,
      );
    }

    crash.clearanceKm = Math.max(0, Number(contact?.clearanceKm) || BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM);
    crash.bodyAboveTerrainKm = Number.isFinite(Number(contact?.bodyAboveTerrainKm))
      ? Number(contact.bodyAboveTerrainKm)
      : null;
    crash.normalSpeedKmS = normalSpeedKmS;
    crash.slideSpeedKmS = length(tangentialVelocityKmS);
    crash.angularSpeedRadS = length(runtime.booster.attitude?.omegaBodyRadS || { x: 0, y: 0, z: 0 });
    crash.tipAngleDeg = degrees(Math.acos(clamp(Math.abs(dot(bodyAxis, up)), 0, 1)));
    return crash;
  }

  function resolveBoosterCrashDynamicsStep({
    boosterState,
    earthState,
    currentEarthAxes,
    earthRadiusKm,
    dtSeconds,
    nowMs,
  }) {
    if (!boosterState?.position || !boosterState?.velocity || !earthState?.position) {
      return;
    }
    const crash = runtime.booster.crashDynamics && typeof runtime.booster.crashDynamics === "object"
      ? runtime.booster.crashDynamics
      : createBoosterCrashDynamicsState();
    crash.active = !crash.settled;
    crash.elapsedSec = Math.max(0, Number(crash.elapsedSec) || 0) + Math.max(0, Number(dtSeconds) || 0);
    runtime.booster.crashDynamics = crash;

    const dt = Math.max(0, Number(dtSeconds) || 0);
    let contact = boosterCrashSurfaceContactState({
      boosterState,
      earthState,
      currentEarthAxes,
      earthRadiusKm,
    });
    let up = normalize(contact?.normal || subtract(boosterState.position, earthState.position), currentEarthAxes?.pole);
    let surfaceContact = Boolean(
      Number(contact?.bodyAboveTerrainKm) <= BOOSTER_CRASH_DYNAMICS_LIMITS.contactBandKm
      || crash.lastSurfaceContact
      || String(crash.mode || "").includes("surface")
    );
    let relativeVelocityKmS = subtract(
      boosterState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    let slideSpeedKmS = 0;
    let normalSpeedKmS = 0;

    if (surfaceContact && contact?.surfacePointRelativeKm) {
      const placement = placeBoosterOnCrashSurface({
        boosterState,
        earthState,
        currentEarthAxes,
        earthRadiusKm,
        contactState: contact,
      });
      const correctedRelativePositionKm = placement?.correctedRelativePositionKm
        || subtract(boosterState.position, earthState.position);
      const surfaceVelocityKmS = surfaceVelocityAtRelativePosition(
        earthState,
        correctedRelativePositionKm,
        currentEarthAxes,
      );
      relativeVelocityKmS = subtract(boosterState.velocity, surfaceVelocityKmS);
      normalSpeedKmS = dot(relativeVelocityKmS, up);
      if (normalSpeedKmS < 0 || Number(contact.bodyAboveTerrainKm) < 0) {
        relativeVelocityKmS = subtract(
          relativeVelocityKmS,
          scale(up, normalSpeedKmS * (1 + BOOSTER_CRASH_DYNAMICS_LIMITS.normalRestitution)),
        );
      }
      const correctedNormalSpeedKmS = dot(relativeVelocityKmS, up);
      const tangentKmS = subtract(relativeVelocityKmS, scale(up, correctedNormalSpeedKmS));
      slideSpeedKmS = length(tangentKmS);
      if (slideSpeedKmS > 1e-9) {
        const frictionPerS = crash.settled
          ? BOOSTER_CRASH_DYNAMICS_LIMITS.settledFrictionPerS
          : BOOSTER_CRASH_DYNAMICS_LIMITS.slidingFrictionPerS * (1 + clamp(slideSpeedKmS / 0.035, 0, 1));
        const friction = clamp(dt * frictionPerS, 0, 0.92);
        relativeVelocityKmS = subtract(relativeVelocityKmS, scale(tangentKmS, friction));
      }
      if (crash.settled) {
        relativeVelocityKmS = { x: 0, y: 0, z: 0 };
      }
      boosterState.velocity = add(surfaceVelocityKmS, relativeVelocityKmS);
      crash.lastSurfaceContact = true;
    } else {
      surfaceContact = false;
      crash.lastSurfaceContact = false;
      normalSpeedKmS = dot(relativeVelocityKmS, up);
      slideSpeedKmS = length(subtract(relativeVelocityKmS, scale(up, normalSpeedKmS)));
    }

    const massKg = Math.max(MIN_ROCKET_MASS_KG, Number(boosterState.massKg) || MIN_ROCKET_MASS_KG);
    if (!crash.settled && dt > 0) {
      const bodyAxis = boosterBodyAxisWorld(runtime.booster.attitude);
      let torqueWorldNm = { x: 0, y: 0, z: 0 };
      if (surfaceContact) {
        const axisSign = dot(bodyAxis, up) >= 0 ? 1 : -1;
        const contactToComWorldM = scale(bodyAxis, axisSign * boosterBodyLengthMeters() * 0.5);
        const gravityForceN = scale(up, -massKg * STANDARD_GRAVITY_M_S2);
        torqueWorldNm = cross(contactToComWorldM, gravityForceN);
        const tangentKmS = subtract(relativeVelocityKmS, scale(up, dot(relativeVelocityKmS, up)));
        const tangentDirection = unitOrNull(tangentKmS);
        if (tangentDirection) {
          const frictionForceN = massKg * STANDARD_GRAVITY_M_S2 * clamp(slideSpeedKmS / 0.018, 0.18, 0.95);
          const comToContactWorldM = scale(contactToComWorldM, -1);
          const frictionTorqueNm = cross(comToContactWorldM, scale(tangentDirection, -frictionForceN));
          torqueWorldNm = add(torqueWorldNm, frictionTorqueNm);
        }
      }
      runtime.booster.attitude = integrateBoosterAttitudeState(runtime.booster.attitude, {
        torqueWorldNm,
        massKg,
        inertiaNormalized: runtime.boosterMassModel?.inertiaNormalized,
        angularDampingPerS: surfaceContact
          ? BOOSTER_CRASH_DYNAMICS_LIMITS.angularDampingContactPerS
          : BOOSTER_CRASH_DYNAMICS_LIMITS.angularDampingFreePerS,
        maxBodyRateRadS: BOOSTER_CRASH_DYNAMICS_LIMITS.maxTipRateRadS,
        dtSeconds: dt,
      });
    }

    if (surfaceContact) {
      contact = boosterCrashSurfaceContactState({
        boosterState,
        earthState,
        currentEarthAxes,
        earthRadiusKm,
      });
      up = normalize(contact?.normal || up, up);
      placeBoosterOnCrashSurface({
        boosterState,
        earthState,
        currentEarthAxes,
        earthRadiusKm,
        contactState: contact,
      });
    }

    const axisNow = boosterBodyAxisWorld(runtime.booster.attitude);
    const bodyUpAlignment = clamp(dot(axisNow, up), -1, 1);
    const tipAngleDeg = degrees(Math.acos(clamp(Math.abs(bodyUpAlignment), 0, 1)));
    const angularSpeedRadS = length(runtime.booster.attitude?.omegaBodyRadS || { x: 0, y: 0, z: 0 });
    const currentRelativePositionKm = subtract(boosterState.position, earthState.position);
    const currentSurfaceVelocityKmS = surfaceVelocityAtRelativePosition(
      earthState,
      currentRelativePositionKm,
      currentEarthAxes,
    );
    const currentRelativeSurfaceVelocityKmS = subtract(boosterState.velocity, currentSurfaceVelocityKmS);
    const currentNormalSpeedKmS = dot(currentRelativeSurfaceVelocityKmS, up);
    const currentSlideKmS = subtract(currentRelativeSurfaceVelocityKmS, scale(up, currentNormalSpeedKmS));
    slideSpeedKmS = length(currentSlideKmS);
    normalSpeedKmS = currentNormalSpeedKmS;
    crash.clearanceKm = Math.max(0, Number(contact?.clearanceKm) || boosterCrashEnvelopeClearanceKm(runtime.booster.attitude, up));
    crash.bodyAboveTerrainKm = Number.isFinite(Number(contact?.bodyAboveTerrainKm))
      ? Number(contact.bodyAboveTerrainKm)
      : null;
    crash.tipAngleDeg = tipAngleDeg;
    crash.angularSpeedRadS = angularSpeedRadS;
    crash.slideSpeedKmS = slideSpeedKmS;
    crash.normalSpeedKmS = normalSpeedKmS;

    const naturallySettled = (
      surfaceContact
      && tipAngleDeg >= BOOSTER_CRASH_DYNAMICS_LIMITS.settledTipAngleDeg
      && angularSpeedRadS <= BOOSTER_CRASH_DYNAMICS_LIMITS.settledAngularRateRadS
      && slideSpeedKmS <= BOOSTER_CRASH_DYNAMICS_LIMITS.settledSlideSpeedKmS
    );
    const forcedSettled = surfaceContact
      && crash.elapsedSec >= BOOSTER_CRASH_DYNAMICS_LIMITS.forcedSettleSec
      && tipAngleDeg >= 45;
    crash.settleHoldSec = naturallySettled || forcedSettled
      ? crash.settleHoldSec + dt
      : 0;
    if (!crash.settled && (forcedSettled || crash.settleHoldSec >= BOOSTER_CRASH_DYNAMICS_LIMITS.settleHoldSec)) {
      crash.settled = true;
      crash.active = false;
      runtime.booster.guidanceMode = "booster-crashed-settled";
      setBoosterCommandPhase("crashed");
      runtime.booster.attitude.omegaBodyRadS = { x: 0, y: 0, z: 0 };
      const surfaceVelocityKmS = surfaceVelocityAtRelativePosition(
        earthState,
        subtract(boosterState.position, earthState.position),
        currentEarthAxes,
      );
      boosterState.velocity = surfaceVelocityKmS;
    }

    runtime.booster.lastStep = {
      ...zeroBoosterStep(runtime.booster.guidanceMode || "booster-crashed"),
      bodyAxisDirectionKm: cloneVectorOrNull(axisNow),
      bodyUpAlignment,
      bodyAngularRateRadS: cloneVectorOrNull(runtime.booster.attitude?.omegaBodyRadS),
      impactReason: runtime.booster.terminalReason,
      impactSpeedKmS: runtime.booster.impactSpeedKmS,
      impactVerticalSpeedKmS: runtime.booster.impactVerticalSpeedKmS,
      impactLateralSpeedKmS: runtime.booster.impactLateralSpeedKmS,
      impactBodyUpAlignment: runtime.booster.impactBodyUpAlignment,
      crashDynamicsActive: Boolean(crash.active),
      crashSettled: Boolean(crash.settled),
      crashMode: String(crash.mode || ""),
      crashTipAngleDeg: crash.tipAngleDeg,
      crashAngularSpeedRadS: crash.angularSpeedRadS,
      crashSlideSpeedKmS: crash.slideSpeedKmS,
      crashNormalSpeedKmS: crash.normalSpeedKmS,
      crashClearanceKm: crash.clearanceKm,
      crashBodyAboveTerrainKm: crash.bodyAboveTerrainKm,
      crashSurfaceContact: Boolean(surfaceContact),
    };
    updateBoosterTerminalTelemetry({
      boosterState,
      earthState,
      currentEarthAxes,
      earthRadiusKm,
      nowMs,
    });
  }

  function updateBoosterTerminalTelemetry({
    boosterState,
    earthState,
    currentEarthAxes,
    earthRadiusKm,
    nowMs,
  }) {
    if (!boosterState || !earthState) {
      runtime.booster.telemetry = null;
      return;
    }
    const relPos = subtract(boosterState.position, earthState.position);
    const environmentSample = launchEnvironmentSample(
      relPos,
      currentEarthAxes,
      earthRadiusKm,
      nowMs,
      (Number(runtime.windSeed) || 0) + 131_071,
    );
    if (environmentSample?.surfaceSample) {
      runtime.booster.lastSurfaceSample = environmentSample.surfaceSample;
    }
    const relVel = subtract(
      boosterState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
      environmentSample.atmosphereSample,
      relPos,
      relVel,
      currentEarthAxes.pole,
      environmentSample.windSample.vectorKmS,
    );
    runtime.booster.telemetry = boosterTelemetryFromState({
      gravitationalConstantKm3PerKgS2,
      earthMassKg: Number(getEarthMassKg?.()) || 0,
      earthRadiusKm,
      earthState,
      boosterState,
      atmosphereSample: environmentSample.atmosphereSample,
      earthPole: currentEarthAxes.pole,
      windVectorKmS: environmentSample.windSample.vectorKmS,
      dynamicPressurePaOverride: dynamicPressurePa,
      runtime,
    });
  }

  function markBoosterCrashed({
    boosterState,
    earthState,
    currentEarthAxes,
    earthRadiusKm,
    nowMs,
    reason = "surface-impact",
    impactSpeedKmS = null,
    impactVerticalSpeedKmS = null,
    impactLateralSpeedKmS = null,
    impactBodyUpAlignment = null,
    impactImpulseDirectionKm = null,
  } = {}) {
    const normalizedReason = String(reason || "surface-impact");
    runtime.booster.crashed = true;
    runtime.booster.landed = false;
    runtime.booster.active = false;
    runtime.booster.terminalOutcome = "crashed";
    runtime.booster.terminalReason = normalizedReason;
    runtime.booster.impactSpeedKmS = finiteOrNull(impactSpeedKmS);
    runtime.booster.impactVerticalSpeedKmS = finiteOrNull(impactVerticalSpeedKmS);
    runtime.booster.impactLateralSpeedKmS = finiteOrNull(impactLateralSpeedKmS);
    runtime.booster.impactBodyUpAlignment = finiteOrNull(impactBodyUpAlignment);
    runtime.booster.contactHoldSec = 0;
    runtime.booster.catchAlignHoldSec = 0;
    runtime.booster.capture = resetBoosterCatchCaptureState(runtime.booster.capture);
    setBoosterCommandPhase("crashed");
    runtime.booster.guidanceMode = `booster-crashed-${normalizedReason}`;
    if (boosterState && earthState) {
      startBoosterCrashDynamics({
        boosterState,
        earthState,
        currentEarthAxes,
        earthRadiusKm,
        reason: normalizedReason,
        impactSpeedKmS,
        impactVerticalSpeedKmS,
        impactLateralSpeedKmS,
        impactBodyUpAlignment,
        impactImpulseDirectionKm,
      });
    }
    runtime.booster.lastStep = {
      ...zeroBoosterStep(runtime.booster.guidanceMode),
      bodyAxisDirectionKm: cloneVectorOrNull(boosterBodyAxisWorld(runtime.booster.attitude)),
      bodyAngularRateRadS: cloneVectorOrNull(runtime.booster.attitude?.omegaBodyRadS),
      impactReason: normalizedReason,
      impactSpeedKmS: runtime.booster.impactSpeedKmS,
      impactVerticalSpeedKmS: runtime.booster.impactVerticalSpeedKmS,
      impactLateralSpeedKmS: runtime.booster.impactLateralSpeedKmS,
      impactBodyUpAlignment: runtime.booster.impactBodyUpAlignment,
      crashDynamicsActive: Boolean(runtime.booster.crashDynamics?.active),
      crashSettled: Boolean(runtime.booster.crashDynamics?.settled),
      crashMode: String(runtime.booster.crashDynamics?.mode || ""),
      crashTipAngleDeg: Number(runtime.booster.crashDynamics?.tipAngleDeg) || 0,
      crashAngularSpeedRadS: Number(runtime.booster.crashDynamics?.angularSpeedRadS) || 0,
      crashSlideSpeedKmS: Number(runtime.booster.crashDynamics?.slideSpeedKmS) || 0,
      crashNormalSpeedKmS: Number(runtime.booster.crashDynamics?.normalSpeedKmS) || 0,
      crashClearanceKm: Number(runtime.booster.crashDynamics?.clearanceKm) || BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM,
      crashBodyAboveTerrainKm: finiteOrNull(runtime.booster.crashDynamics?.bodyAboveTerrainKm),
    };
    updateBoosterTerminalTelemetry({
      boosterState,
      earthState,
      currentEarthAxes,
      earthRadiusKm,
      nowMs,
    });
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

  function earthSurfaceGuardManagedBodyId(bodyId) {
    const id = String(bodyId || "");
    return (
      id === LAUNCH_BODY_ID
      || id === LAUNCH_BOOSTER_BODY_ID
      || id.startsWith("earth_refuel_tanker_")
      || id.startsWith("earth_mission_ship_")
    );
  }

  function earthSurfaceGuardReferenceOffsetKm(bodyId) {
    const id = String(bodyId || "");
    const shipReferenceOffsetKm = Math.max(
      0,
      (Number(STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm) || 0) * 0.5,
    );
    if (id === LAUNCH_BOOSTER_BODY_ID) {
      if (runtime.booster.crashed) {
        return Math.max(
          0,
          Number(runtime.booster.crashDynamics?.clearanceKm)
            || BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM,
        );
      }
      return BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM;
    }
    const fleetVehicle = runtime.fleet?.vehicles instanceof Map
      ? runtime.fleet.vehicles.get(id)
      : null;
    const stageIndex = id === LAUNCH_BODY_ID
      ? Number(runtime.stageIndex)
      : Number(fleetVehicle?.stageIndex);
    return Number.isFinite(stageIndex) && stageIndex >= 1
      ? shipReferenceOffsetKm
      : STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM;
  }

  function earthSurfaceGuardThrustN(bodyId) {
    const id = String(bodyId || "");
    if (id === LAUNCH_BOOSTER_BODY_ID) {
      return Number(runtime.booster.lastStep?.thrustN) || 0;
    }
    if (id === LAUNCH_BODY_ID) {
      return Number(runtime.lastStep?.thrustN) || 0;
    }
    const fleetVehicle = runtime.fleet?.vehicles instanceof Map
      ? runtime.fleet.vehicles.get(id)
      : null;
    return Number(fleetVehicle?.lastStep?.thrustN) || 0;
  }

  function rememberEarthSurfaceGuardSample(bodyId, surfaceSample) {
    if (!surfaceSample) {
      return;
    }
    const id = String(bodyId || "");
    if (id === LAUNCH_BODY_ID) {
      runtime.lastSurfaceSample = surfaceSample;
    } else if (id === LAUNCH_BOOSTER_BODY_ID) {
      runtime.booster.lastSurfaceSample = surfaceSample;
    }
  }

  function applyEarthSolidSurfaceGuardToManagedBodies(state, dtSeconds, nowMs = Date.now()) {
    if (!state?.dynamicBodies) {
      return;
    }
    const earthState = earthStateFromNBody(state);
    if (
      !earthState
      || !finiteVector(earthState.position)
      || !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      return;
    }
    const currentEarthAxes = earthAxes(nowMs);
    const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371.0084;
    for (const [bodyId, bodyState] of state.dynamicBodies.entries()) {
      if (
        !earthSurfaceGuardManagedBodyId(bodyId)
        || !bodyState
        || !finiteVector(bodyState.position)
        || !finiteVector(bodyState.velocity || { x: 0, y: 0, z: 0 })
      ) {
        continue;
      }
      const contact = applyEarthSurfaceContactForVehicle({
        rocketState: bodyState,
        earthState,
        earthAxes: currentEarthAxes,
        earthRadiusKm,
        earthSiderealRateRadS: EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
        referenceOffsetKm: earthSurfaceGuardReferenceOffsetKm(bodyId),
        dtSeconds,
        thrustN: earthSurfaceGuardThrustN(bodyId),
        includeTerrain: true,
      });
      rememberEarthSurfaceGuardSample(bodyId, contact?.surfaceSample);
    }
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

  function currentLaunchElapsedSeconds() {
    const elapsedSec = Math.max(0, Number(runtime.elapsedSeconds) || 0);
    const startElapsedSec = Math.max(0, Number(runtime.launchSequence?.startElapsedSec) || 0);
    if (!Boolean(runtime.launchSequence?.active)) {
      return elapsedSec;
    }
    return Math.max(0, elapsedSec - startElapsedSec);
  }

  function updateLaunchSequenceState({
    earthState,
    rocketState,
    earthRadiusKm,
    dynamicPressurePa = null,
  } = {}) {
    const sequence = runtime.launchSequence && typeof runtime.launchSequence === "object"
      ? runtime.launchSequence
      : createLaunchSequenceState();
    runtime.launchSequence = sequence;
    if (!sequence.active) {
      return sequence;
    }
    if (
      !earthState
      || !rocketState
      || !finiteVector(earthState.position)
      || !finiteVector(rocketState.position)
    ) {
      return sequence;
    }

    const elapsedSec = Math.max(0, Number(runtime.elapsedSeconds) || 0);
    const sequenceElapsedSec = Math.max(
      0,
      elapsedSec - Math.max(0, Number(sequence.startElapsedSec) || 0),
    );
    const relPos = subtract(
      rocketState.position || { x: 0, y: 0, z: 0 },
      earthState.position || { x: 0, y: 0, z: 0 },
    );
    const relVel = subtract(
      rocketState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    const up = normalize(relPos, { x: 0, y: 0, z: 1 });
    const bodyAxis = normalize(
      runtime.lastStep?.bodyAxisDirectionKm
        || runtime.stageActuator?.directionActual
        || up,
      up,
    );
    const bodyOffVerticalDeg = alignmentAngleDeg(dot(bodyAxis, up));
    const velocityDir = normalize(relVel, bodyAxis);
    const bodyOffVelocityDeg = alignmentAngleDeg(dot(bodyAxis, velocityDir));
    const altitudeAboveTerrainKm = Number.isFinite(Number(runtime.lastTelemetry?.altitudeAboveTerrainKm))
      ? Number(runtime.lastTelemetry.altitudeAboveTerrainKm)
      : resolvedLaunchVehicleAltitudeAboveTerrainKm(
        Math.max(0, length(relPos) - Math.max(0, Number(earthRadiusKm) || 0)),
      );
    const groundRelativeSpeedKmS = Number.isFinite(Number(runtime.lastTelemetry?.groundRelativeSpeedKmS))
      ? Number(runtime.lastTelemetry.groundRelativeSpeedKmS)
      : 0;
    const thrustN = Math.max(0, Number(runtime.lastStep?.thrustN) || 0);
    const activeEngineCount = Math.max(0, Number(runtime.lastStep?.activeEngineCount) || 0);
    const totalMassKg = Math.max(MIN_ROCKET_MASS_KG, Number(rocketState.massKg) || MIN_ROCKET_MASS_KG);
    const earthMassKg = Number(getEarthMassKg?.()) || Number(earthState.massKg) || 0;
    const relRadiusKm = Math.max(1e-6, length(relPos));
    const localGravityMS2 = (
      gravitationalConstantKm3PerKgS2 > 0
      && earthMassKg > 0
    )
      ? ((gravitationalConstantKm3PerKgS2 * earthMassKg) / (relRadiusKm * relRadiusKm)) * 1000
      : 9.80665;
    const weightN = totalMassKg * localGravityMS2;
    const padReleaseDurationSec = Math.max(0, Number(LAUNCH_AUTOPILOT_CONFIG.padReleaseDurationSec) || 0);
    const towerClearAltitudeKm = Math.max(0, Number(LAUNCH_AUTOPILOT_CONFIG.towerClearAltitudeKm) || 0);
    const towerClearMaxDurationSec = Math.max(0, Number(LAUNCH_AUTOPILOT_CONFIG.towerClearMaxDurationSec) || 0);
    const pitchKickStartAltitudeKm = Math.max(
      towerClearAltitudeKm,
      Number(LAUNCH_AUTOPILOT_CONFIG.pitchKickStartAltitudeKm) || towerClearAltitudeKm,
    );
    const dynamicPressureMetricPa = Number.isFinite(Number(dynamicPressurePa))
      ? Number(dynamicPressurePa)
      : Number(runtime.lastTelemetry?.dynamicPressurePa);
    const attachedJointErrorM = length(runtime.attachedJoint?.positionErrorKm || { x: 0, y: 0, z: 0 }) * 1000;
    const attachedJointRelativeSpeedMS = length(runtime.attachedJoint?.relativeVelocityKmS || { x: 0, y: 0, z: 0 }) * 1000;

    const launchCommitReady = (
      runtime.stageIndex === 0
      && currentLaunchCommandPhase() === "powered"
      && activeEngineCount >= 3
      && thrustN >= (weightN * 1.01)
      && (Number(runtime.lastStep?.throttle) || 0) > 0.15
      && (bodyOffVerticalDeg === null || bodyOffVerticalDeg <= 8.5)
    );
    const launchCommitReason = launchCommitReady
      ? "thrust_margin_and_attitude_nominal"
      : (
        activeEngineCount < 3
          ? "insufficient_engines"
          : thrustN < (weightN * 1.01)
            ? "insufficient_thrust_margin"
            : ((Number(runtime.lastStep?.throttle) || 0) <= 0.15
              ? "throttle_below_commit"
              : "attitude_out_of_family")
      );
    if (launchCommitReady && !sequence.launchCommitReady) {
      sequence.launchCommitReady = true;
      sequence.launchCommitElapsedSec = sequenceElapsedSec;
      sequence.launchCommitReason = launchCommitReason;
      emitLaunchEvent("launch_commit_ready", {
        elapsedSec: sequenceElapsedSec,
        thrustN,
        weightN,
        activeEngineCount,
        bodyOffVerticalDeg,
      });
    } else if (!sequence.launchCommitReady) {
      sequence.launchCommitReason = launchCommitReason;
    }

    const padReleaseComplete = sequence.launchCommitReady && (
      sequenceElapsedSec >= padReleaseDurationSec
      || (Number.isFinite(altitudeAboveTerrainKm) && altitudeAboveTerrainKm > 0.01)
      || groundRelativeSpeedKmS > 0.015
    );
    if (padReleaseComplete && !sequence.padReleaseComplete) {
      sequence.padReleaseComplete = true;
      sequence.padReleaseElapsedSec = sequenceElapsedSec;
      emitLaunchEvent("pad_release_complete", {
        elapsedSec: sequenceElapsedSec,
        altitudeAboveTerrainKm,
        groundRelativeSpeedKmS,
      });
    }

    const towerClearSatisfied = sequence.padReleaseComplete && (
      (Number.isFinite(altitudeAboveTerrainKm) && altitudeAboveTerrainKm >= towerClearAltitudeKm)
      || (towerClearMaxDurationSec > 0 && sequenceElapsedSec >= towerClearMaxDurationSec)
    );
    if (towerClearSatisfied && !sequence.towerClearSatisfied) {
      sequence.towerClearSatisfied = true;
      sequence.towerClearElapsedSec = sequenceElapsedSec;
      emitLaunchEvent("tower_clear_satisfied", {
        elapsedSec: sequenceElapsedSec,
        altitudeAboveTerrainKm,
        groundRelativeSpeedKmS,
      });
    }

    const pitchoverEnabled = sequence.towerClearSatisfied && (
      (Number.isFinite(altitudeAboveTerrainKm) && altitudeAboveTerrainKm >= pitchKickStartAltitudeKm)
      || sequenceElapsedSec >= (padReleaseDurationSec + 0.75)
    );
    if (pitchoverEnabled && !sequence.pitchoverEnabled) {
      sequence.pitchoverEnabled = true;
      sequence.pitchoverElapsedSec = sequenceElapsedSec;
      emitLaunchEvent("pitchover_enabled", {
        elapsedSec: sequenceElapsedSec,
        altitudeAboveTerrainKm,
        pitchKickStartAltitudeKm,
      });
    }

    const hotstageEnvelope = evaluateHotstageRealismEnvelope(
      runtime,
      rocketState,
      earthState,
      earthRadiusKm,
    );
    const attachedJointLoadRatio = ATTACHED_STACK_JOINT_MAX_LOAD_N > 0
      ? clamp((Number(runtime.attachedJoint?.reactionForceN) || 0) / ATTACHED_STACK_JOINT_MAX_LOAD_N, 0, 10)
      : 0;
    const hotstageCommonReady = (
      runtime.stageIndex === 0
      && runtime.booster.attached
      && !runtime.booster.active
      && thrustN > 1_000_000
      && activeEngineCount >= 3
      && attachedJointLoadRatio <= 0.92
      && attachedJointErrorM <= 0.45
      && attachedJointRelativeSpeedMS <= 0.35
      && (bodyOffVelocityDeg === null || bodyOffVelocityDeg <= 18)
      && (
        !Number.isFinite(dynamicPressureMetricPa)
        || dynamicPressureMetricPa <= 160_000
      )
    );
    const hotstageAltitudeWindowReady =
      hotstageEnvelope.altitudeKm >= hotstageEnvelope.minAltitudeKm
      && hotstageEnvelope.altitudeKm <= hotstageEnvelope.maxAltitudeKm;
    const hotstageEarlyAltitudeCandidate =
      hotstageCommonReady
      && hotstageAltitudeWindowReady
      && hotstageEnvelope.elapsedSec < hotstageEnvelope.minElapsedSec;
    if (hotstageEarlyAltitudeCandidate && !sequence.hotstageDeferredCandidateActive) {
      sequence.hotstageDeferredCandidateActive = true;
      sequence.hotstageDeferredCandidateElapsedSec = sequenceElapsedSec;
      sequence.hotstageDeferredCandidateAltitudeKm = hotstageEnvelope.altitudeKm;
      sequence.hotstageDeferredCandidateReason = "altitude_window_before_time_gate";
      emitLaunchEvent("hotstage_deferred_candidate", {
        elapsedSec: sequenceElapsedSec,
        altitudeKm: hotstageEnvelope.altitudeKm,
        speedKmS: hotstageEnvelope.speedKmS,
        minElapsedSec: hotstageEnvelope.minElapsedSec,
        maxAltitudeKm: hotstageEnvelope.maxAltitudeKm,
        attachedJointLoadRatio,
        dynamicPressurePa: dynamicPressureMetricPa,
        bodyOffVelocityDeg,
      });
    }
    const deferredHotstageReady =
      runtime.stageIndex === 0
      && runtime.booster.attached
      && !runtime.booster.active
      && !runtime.hotstage.active
      && (
        !Number.isFinite(dynamicPressureMetricPa)
        || dynamicPressureMetricPa <= 160_000
      )
      && (
        hotstageDeferredCandidateUsable(sequence, hotstageEnvelope)
        || hotstageDeferredCandidateEarlyUsable(sequence, hotstageEnvelope)
      );
    const hotstageArmReady = (hotstageCommonReady && hotstageEnvelope.withinEnvelope)
      || deferredHotstageReady;
    const hotstageArmReason = hotstageArmReady
      ? (
        deferredHotstageReady && !hotstageEnvelope.withinEnvelope
          ? "deferred_altitude_window_loads_and_attitude_nominal"
          : "envelope_loads_and_attitude_nominal"
      )
      : (
        !hotstageEnvelope.withinEnvelope && !deferredHotstageReady
          ? "outside_hotstage_envelope"
          : thrustN <= 1_000_000
            ? "insufficient_stage0_thrust"
            : activeEngineCount < 3
              ? "insufficient_stage0_engines"
              : attachedJointLoadRatio > 0.92
                ? "attached_joint_load_high"
                : attachedJointErrorM > 0.45
                  ? "attached_joint_error_high"
                  : attachedJointRelativeSpeedMS > 0.35
                    ? "attached_joint_relative_rate_high"
                    : (bodyOffVelocityDeg !== null && bodyOffVelocityDeg > 18)
                      ? "attitude_out_of_hotstage_family"
                      : "dynamic_pressure_high"
      );
    if (hotstageArmReady && !sequence.hotstageArmed) {
      sequence.hotstageArmed = true;
      sequence.hotstageArmedElapsedSec = sequenceElapsedSec;
      sequence.hotstageArmReason = hotstageArmReason;
      emitLaunchEvent("hotstage_armed", {
        elapsedSec: sequenceElapsedSec,
        altitudeKm: hotstageEnvelope.altitudeKm,
        speedKmS: hotstageEnvelope.speedKmS,
        attachedJointLoadRatio,
        dynamicPressurePa: dynamicPressureMetricPa,
        bodyOffVelocityDeg,
      });
    } else if (!sequence.hotstageArmed) {
      sequence.hotstageArmReason = hotstageArmReason;
    }

    const hotstageIgnitionAuthorized = Boolean(runtime.hotstage.active)
      || (
        runtime.pendingStageTransition?.active
        && runtime.pendingStageTransition.kind === "hotstage_ignite"
        && Boolean(runtime.pendingStageTransition.authorizationMode)
      );
    if (hotstageIgnitionAuthorized && !sequence.hotstageIgnitionAuthorized) {
      sequence.hotstageIgnitionAuthorized = true;
      sequence.hotstageIgnitionElapsedSec = sequenceElapsedSec;
      emitLaunchEvent("hotstage_ignition_authorized", {
        elapsedSec: sequenceElapsedSec,
        authorizationMode: String(runtime.pendingStageTransition?.authorizationMode || ""),
      });
    }

    const stage2Bounds = configuredThrustBoundsN(stageAtIndex(1));
    const hotstageGate = runtime.hotstage.active
      ? updateHotstageGates(runtime.hotstage, {
        elapsedSeconds: runtime.elapsedSeconds,
        stageIndex: runtime.stageIndex,
        phase: currentLaunchCommandPhase(),
        stage2ThrustN: Number(runtime.lastStep?.thrustN) || 0,
        stage2PeakThrustN: Math.max(
          Number(stage2Bounds.thrustVacuumN) || 0,
          Number(stage2Bounds.thrustSeaLevelN) || 0,
        ),
        physicalSeparationKm: runtime.attachedJoint?.physicalSeparationKm,
        physicalSeparationRateKmS: runtime.attachedJoint?.physicalSeparationRateKmS,
        dtSeconds: 0,
      })
      : null;
    const hotstageReleaseAuthorized = Boolean(runtime.hotstage.active && hotstageGate?.detachReady);
    if (hotstageReleaseAuthorized && !sequence.hotstageReleaseAuthorized) {
      sequence.hotstageReleaseAuthorized = true;
      sequence.hotstageReleaseElapsedSec = sequenceElapsedSec;
      emitLaunchEvent("hotstage_release_authorized", {
        elapsedSec: sequenceElapsedSec,
        ignitionStableSec: hotstageGate?.ignitionStableSec,
        virtualSeparationKm: hotstageGate?.virtualSeparationKm,
      });
    }

    return sequence;
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
    transition.holdMode = "awaiting-authorization";
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
      pending.holdMode = "";
      pending.authorizationMode = "";
      pending.anomalyActive = false;
      pending.anomalyReason = "";
      pending.anomalyElapsedSec = null;
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
      pending.holdMode = "";
      pending.authorizationMode = "";
      pending.anomalyActive = false;
      pending.anomalyReason = "";
      pending.anomalyElapsedSec = null;
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
      const hotstageArmed = Boolean(runtime.launchSequence?.hotstageArmed);
      const lowDynamicPressure = (
        !Number.isFinite(dynamicPressureMetricPa)
        || dynamicPressureMetricPa <= 145_000
      );
      const deferredHotstageReady = hotstageDeferredCandidateUsable(
        runtime.launchSequence,
        hotstageEnvelope,
      );
      const deferredHotstageEarlyReady = hotstageDeferredCandidateEarlyUsable(
        runtime.launchSequence,
        hotstageEnvelope,
      );
      const hotstageEnvelopeAuthorized =
        hotstageEnvelope.withinEnvelope
        || deferredHotstageReady
        || deferredHotstageEarlyReady;
      const hotstageArmedForAuthorization = hotstageArmed || deferredHotstageEarlyReady;
      const nominalEnvelopeSatisfied = airborne
        && groundRelativeSpeedKmS > 0.10
        && hotstageArmedForAuthorization
        && lowDynamicPressure
        && hotstageEnvelopeAuthorized;
      const authorizationMode = nominalEnvelopeSatisfied
        ? (
          deferredHotstageEarlyReady && !hotstageEnvelope.withinEnvelope
            ? "deferred-envelope-early"
            : (deferredHotstageReady && !hotstageEnvelope.withinEnvelope ? "deferred-envelope" : "nominal-envelope")
        )
        : "";
      const waitReason = authorizationMode
        ? ""
        : (
          !airborne
            ? "vehicle_not_airborne"
            : (!hotstageArmedForAuthorization
              ? String(runtime.launchSequence?.hotstageArmReason || "hotstage_not_armed")
              : (!lowDynamicPressure
                ? "dynamic_pressure_high"
                : (
                  hotstageEnvelope.altitudeKm < hotstageEnvelope.minAltitudeKm
                    ? "hotstage_altitude_below_window"
                    : hotstageEnvelope.altitudeKm > hotstageEnvelope.maxAltitudeKm
                      ? (
                        (deferredHotstageReady || deferredHotstageEarlyReady)
                          ? "hotstage_deferred_window_wait"
                          : "hotstage_altitude_above_window"
                      )
                      : hotstageEnvelope.elapsedSec < hotstageEnvelope.minElapsedSec
                        ? "hotstage_time_before_window"
                        : "hotstage_time_after_window"
                )))
        );
      const holdMode = authorizationMode
        ? ""
        : (
          !airborne
            ? "preflight-hold"
            : (!hotstageArmed
              ? "hotstage-arm-hold"
              : (!lowDynamicPressure ? "hotstage-q-hold" : "hotstage-envelope-hold"))
        );
      const anomalyReason = authorizationMode
        ? ""
        : (
          (
            !deferredHotstageReady
            && !deferredHotstageEarlyReady
            && hotstageEnvelope.altitudeKm > (hotstageEnvelope.maxAltitudeKm + 5)
          )
            ? "hotstage_window_missed_high"
            : (
              (requestAgeSec >= 3 && hotstageEnvelope.elapsedSec > (hotstageEnvelope.maxElapsedSec + 6))
                ? "hotstage_window_missed_late"
                : (
                  (!hotstageArmedForAuthorization && requestAgeSec >= 4)
                    ? "hotstage_never_armed"
                    : (
                      (!lowDynamicPressure && requestAgeSec >= 2)
                        ? "hotstage_q_hold_exceeded"
                        : ""
                    )
                )
            )
        );
      pending.waitReason = waitReason;
      pending.holdMode = holdMode;
      pending.authorizationMode = authorizationMode;
      if (anomalyReason) {
        if (pending.anomalyReason !== anomalyReason) {
          emitLaunchEvent("stage_transition_anomaly", {
            transitionKind: pending.kind,
            fromStageIndex: pending.fromStageIndex,
            toStageIndex: pending.toStageIndex,
            requestReason: pending.requestReason,
            anomalyReason,
            waitReason,
            holdMode,
            requestAgeSec,
            altitudeAboveTerrainKm: altitudeMetricKm,
            groundRelativeSpeedKmS,
            dynamicPressurePa: dynamicPressureMetricPa,
          });
        }
        pending.anomalyActive = true;
        pending.anomalyReason = anomalyReason;
        pending.anomalyElapsedSec = Number(runtime.elapsedSeconds) || 0;
      } else {
        pending.anomalyActive = false;
        pending.anomalyReason = "";
        pending.anomalyElapsedSec = null;
      }
      return {
        authorized: Boolean(authorizationMode),
        authorizationMode,
        waitReason,
        holdMode,
        anomalyReason,
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
      pending.holdMode = authorizationMode ? "" : "stage-separation-hold";
      pending.authorizationMode = authorizationMode;
      pending.anomalyActive = false;
      pending.anomalyReason = "";
      pending.anomalyElapsedSec = null;
      return {
        authorized: Boolean(authorizationMode),
        authorizationMode,
        waitReason,
        holdMode: pending.holdMode,
        requestAgeSec,
        altitudeAboveTerrainKm: altitudeMetricKm,
        groundRelativeSpeedKmS,
        stableOrbit,
      };
    }

    pending.waitReason = "unknown_transition_kind";
    pending.holdMode = "";
    pending.authorizationMode = "";
    pending.anomalyActive = false;
    pending.anomalyReason = "";
    pending.anomalyElapsedSec = null;
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
      const hotstageAxis = normalize(
        runtime.lastStep?.bodyAxisDirectionKm
          || runtime.stageActuator?.directionActual
          || relPos,
        currentEarthAxes.pole,
      );
      const boosterStage = stageAtIndex(0);
      const boosterReservePropellantKg = Math.max(0, Number(pending.reservePropellantKg) || 0);
      const boosterMassKg = Math.max(
        MIN_ROCKET_MASS_KG,
        (Number(boosterStage?.dryMassKg) || Number(LAUNCH_BOOSTER_CONFIG.dryMassKg) || 0)
          + boosterReservePropellantKg,
      );
      const boosterState = ensureAttachedBoosterInNBody(
        state,
        rocketState,
        earthState,
        currentEarthAxes,
        { dtSeconds: 0, hardSync: false },
      );
      if (boosterState) {
        boosterState.massKg = boosterMassKg;
      }
      const preHotstageStackMassKg = Math.max(MIN_ROCKET_MASS_KG, Number(rocketState.massKg) || MIN_ROCKET_MASS_KG);
      const shipMassKg = Math.max(MIN_ROCKET_MASS_KG, preHotstageStackMassKg - boosterMassKg);
      const shipCenterShiftKm = Math.max(0, Number(STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm) || 0) * 0.5;
      applyStarshipPositionCorrection(
        rocketState,
        scale(hotstageAxis, shipCenterShiftKm),
        "hotstage_ship_reference_shift",
        { lifecycle: true },
      );
      rocketState.massKg = shipMassKg;
      runtime.hotstage.shipReferenceActive = true;
      runtime.hotstage.shipCenterShiftKm = shipCenterShiftKm;
      runtime.attachedJoint.shipReferenceActive = true;
      runtime.attachedJoint.targetOffsetWorldKm = scale(hotstageAxis, attachedBoosterCenterOffsetKm());
      runtime.lastTrackedPositionKm = earthFixedRelativePositionKm(
        rocketState,
        earthState,
        currentEarthAxes,
      );
      runtime.stageIndex = Math.max(1, Number(pending.toStageIndex) || 1);
      runtime.stagePropellantKg = surfaceLaunchStagePropellantCapacityKgForMissionStage(
        runtime.stageIndex,
        runtime.mission.selectedId,
      );
      runtime.coastRemainingSec = 0;
      setLaunchCommandPhase("powered");
      const nextStageAxis = normalize(
        runtime.lastStep?.bodyAxisDirectionKm
          || runtime.stageActuator?.directionActual
          || relPos,
        currentEarthAxes.pole,
      );
      runtime.stageActuator = createActuatorState(nextStageAxis);
      runtime.stageAttitude = resetAttitudeStateToAxis(nextStageAxis);
      runtime.stageMassModel = createMassModelState();
      resetStarshipRcsRuntimeState(runtime);
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
        shipMassKg,
        boosterMassKg,
        shipCenterShiftKm,
        elapsedSec: hotstageEnvelope.elapsedSec,
        altitudeKm: hotstageEnvelope.altitudeKm,
        speedKmS: hotstageEnvelope.speedKmS,
        nominalElapsedSec: hotstageEnvelope.nominalElapsedSec,
        nominalAltitudeKm: hotstageEnvelope.nominalAltitudeKm,
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
      const nextStageAxis = normalize(relPos, currentEarthAxes.pole);
      runtime.stageActuator = createActuatorState(nextStageAxis);
      runtime.stageAttitude = resetAttitudeStateToAxis(nextStageAxis);
      runtime.stageMassModel = createMassModelState();
      resetStarshipRcsRuntimeState(runtime);
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
    runtime.boosterEngineCountOverride = normalizeBoosterEngineCountSelection(
      runtime.boosterEngineCountOverride,
      defaultBoosterEngineCountSelection(),
    );
    runtime.stageActuator = createActuatorState({ x: 0, y: 0, z: 1 });
    runtime.stageAttitude = resetAttitudeStateToAxis({ x: 0, y: 0, z: 1 });
    runtime.stageMassModel = createMassModelState();
    runtime.stage1Combustion = createStage1CombustionClusterState(runtime.boosterEngineCountOverride);
    runtime.stage2Combustion = createStage2CombustionClusterState();
    runtime.stageRcsCombustion = createStage2RcsCombustionClusterState();
    runtime.stageRcsPropellantKg = 0;
    runtime.stageRcsInitialPropellantKg = 0;
    runtime.stageNavigation = createStarshipNavigationState();
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
    runtime.booster.separationAxisKm = null;
    runtime.booster.landed = false;
    runtime.booster.crashed = false;
    runtime.booster.terminalOutcome = "";
    runtime.booster.terminalReason = "";
    runtime.booster.impactSpeedKmS = null;
    runtime.booster.impactVerticalSpeedKmS = null;
    runtime.booster.impactLateralSpeedKmS = null;
    runtime.booster.impactBodyUpAlignment = null;
    runtime.booster.crashDynamics = resetBoosterCrashDynamicsState(runtime.booster.crashDynamics);
    runtime.booster.combustion = createBoosterCombustionClusterState(runtime.boosterEngineCountOverride);
    runtime.booster.rcsCombustion = createBoosterRcsCombustionClusterState();
    runtime.booster.lastStep = null;
    runtime.booster.lastSurfaceSample = null;
    runtime.booster.lastTrackedPositionKm = null;
    runtime.booster.telemetry = null;
    runtime.booster.contactHoldSec = 0;
    runtime.booster.catchAlignHoldSec = 0;
    runtime.booster.capture = resetBoosterCatchCaptureState(runtime.booster.capture);
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
    runtime.booster.separationAxisKm = null;
    runtime.booster.landed = false;
    runtime.booster.crashed = false;
    runtime.booster.terminalOutcome = "";
    runtime.booster.terminalReason = "";
    runtime.booster.impactSpeedKmS = null;
    runtime.booster.impactVerticalSpeedKmS = null;
    runtime.booster.impactLateralSpeedKmS = null;
    runtime.booster.impactBodyUpAlignment = null;
    runtime.booster.crashDynamics = resetBoosterCrashDynamicsState(runtime.booster.crashDynamics);
    runtime.booster.combustion = createBoosterCombustionClusterState(runtime.boosterEngineCountOverride);
    runtime.booster.rcsCombustion = createBoosterRcsCombustionClusterState();
    runtime.booster.lastStep = null;
    runtime.booster.lastSurfaceSample = null;
    runtime.booster.lastTrackedPositionKm = null;
    runtime.booster.telemetry = null;
    runtime.booster.contactHoldSec = 0;
    runtime.booster.catchAlignHoldSec = 0;
    runtime.booster.capture = resetBoosterCatchCaptureState(runtime.booster.capture);
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
      boosterEngineCount: options?.boosterEngineCount,
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

  function hotstageShipReferenceActive() {
    return Boolean(runtime.hotstage?.shipReferenceActive || runtime.attachedJoint?.shipReferenceActive);
  }

  function starshipStateGuard() {
    if (!runtime.starshipStateGuard || typeof runtime.starshipStateGuard !== "object") {
      runtime.starshipStateGuard = createStarshipStateGuardState();
    }
    return runtime.starshipStateGuard;
  }

  function markStarshipCleanFreeFlight(reason = "separation_clear") {
    const guard = starshipStateGuard();
    if (guard.cleanFreeFlightActive) {
      return;
    }
    guard.cleanFreeFlightActive = true;
    guard.cleanFreeFlightElapsedSec = Math.max(0, Number(runtime.elapsedSeconds) || 0);
    guard.cleanFreeFlightReason = String(reason || "separation_clear");
  }

  function updateStarshipCleanFreeFlightState({ metrics = null, contactActive = false, reason = "" } = {}) {
    if (
      runtime.stageIndex < 1
      || !runtime.booster.active
      || runtime.booster.attached
      || runtime.hotstage?.active
    ) {
      return;
    }
    if (contactActive) {
      return;
    }
    const timeSinceSeparationSec = Math.max(
      0,
      (Number(runtime.elapsedSeconds) || 0) - (Number(runtime.booster.separationTimeSec) || 0),
    );
    const separationKm = Number(metrics?.axialGapKm ?? runtime.attachedJoint?.physicalSeparationKm);
    const separationRateKmS = Number(metrics?.axialRateKmS ?? runtime.attachedJoint?.physicalSeparationRateKmS);
    const clearedInterstage = (
      Number.isFinite(separationKm)
      && separationKm > HOTSTAGE_INTERSTAGE_CONTACT_BAND_KM * 1.05
      && (!Number.isFinite(separationRateKmS) || separationRateKmS >= -1e-5)
      && timeSinceSeparationSec >= 0.25
    );
    if (clearedInterstage || timeSinceSeparationSec > 8) {
      markStarshipCleanFreeFlight(reason || (clearedInterstage ? "interstage_gap_clear" : "separation_contact_window_expired"));
    }
  }

  function directStarshipCorrectionAllowed(kind, reason, options = {}) {
    const guard = starshipStateGuard();
    if (
      !guard.cleanFreeFlightActive
      || options?.contact === true
      || options?.constraint === true
      || options?.allowAfterCleanFreeFlight === true
    ) {
      return true;
    }
    const correctionKind = String(kind || "state");
    if (correctionKind === "position") {
      guard.blockedPositionCorrectionCount += 1;
    } else if (correctionKind === "velocity") {
      guard.blockedVelocityCorrectionCount += 1;
    }
    guard.lastBlockedReason = String(reason || "direct_starship_state_correction_blocked");
    guard.lastBlockedKind = correctionKind;
    guard.lastBlockedElapsedSec = Math.max(0, Number(runtime.elapsedSeconds) || 0);
    emitLaunchEvent("starship_direct_state_correction_blocked", {
      kind: guard.lastBlockedKind,
      reason: guard.lastBlockedReason,
      cleanFreeFlightElapsedSec: guard.cleanFreeFlightElapsedSec,
      elapsedSec: guard.lastBlockedElapsedSec,
    });
    return false;
  }

  function recordDirectStarshipCorrection(kind, reason, magnitude, options = {}) {
    const guard = starshipStateGuard();
    const correctionKind = String(kind || "state");
    const correctionMagnitude = Math.max(0, Number(magnitude) || 0);
    if (correctionKind === "position") {
      guard.directPositionCorrectionCount += 1;
      if (guard.cleanFreeFlightActive) {
        guard.postCleanFreeFlightPositionCorrectionCount += 1;
        guard.maxPostCleanFreeFlightPositionCorrectionKm = Math.max(
          guard.maxPostCleanFreeFlightPositionCorrectionKm,
          correctionMagnitude,
        );
      }
    } else if (correctionKind === "velocity") {
      guard.directVelocityCorrectionCount += 1;
      if (guard.cleanFreeFlightActive) {
        guard.postCleanFreeFlightVelocityCorrectionCount += 1;
        guard.maxPostCleanFreeFlightVelocityCorrectionKmS = Math.max(
          guard.maxPostCleanFreeFlightVelocityCorrectionKmS,
          correctionMagnitude,
        );
      }
    }
    guard.lastCorrectionReason = String(reason || "direct_starship_state_correction");
    guard.lastCorrectionKind = correctionKind;
    guard.lastCorrectionElapsedSec = Math.max(0, Number(runtime.elapsedSeconds) || 0);
    if (guard.cleanFreeFlightActive && options?.contact !== true && options?.constraint !== true) {
      emitLaunchEvent("starship_direct_state_correction_after_clean_freeflight", {
        kind: correctionKind,
        reason: guard.lastCorrectionReason,
        magnitude: correctionMagnitude,
        elapsedSec: guard.lastCorrectionElapsedSec,
      });
    }
  }

  function applyStarshipPositionCorrection(rocketState, deltaKm, reason, options = {}) {
    if (!rocketState || !finiteVector(deltaKm) || length(deltaKm) <= 1e-12) {
      return false;
    }
    if (!directStarshipCorrectionAllowed("position", reason, options)) {
      return false;
    }
    rocketState.position = add(rocketState.position, deltaKm);
    recordDirectStarshipCorrection("position", reason, length(deltaKm), options);
    return true;
  }

  function applyStarshipVelocityCorrection(rocketState, deltaKmS, reason, options = {}) {
    if (!rocketState || !finiteVector(deltaKmS) || length(deltaKmS) <= 1e-12) {
      return false;
    }
    if (!directStarshipCorrectionAllowed("velocity", reason, options)) {
      return false;
    }
    rocketState.velocity = add(
      rocketState.velocity || { x: 0, y: 0, z: 0 },
      deltaKmS,
    );
    recordDirectStarshipCorrection("velocity", reason, length(deltaKmS), options);
    return true;
  }

  function attachedBoosterCenterOffsetKm() {
    const shipHeightKm = Math.max(0, Number(STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm) || 0);
    if (hotstageShipReferenceActive()) {
      const boosterHeightKm = Math.max(0, Number(STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm) || 0);
      const hotstageOpeningGapKm = runtime.hotstage?.active
        ? clamp(
          Number(runtime.hotstage.virtualSeparationKm) || 0,
          0,
          HOTSTAGE_INTERSTAGE_CONTACT_BAND_KM * 1.2,
        )
        : 0;
      return -(((shipHeightKm + boosterHeightKm) * 0.5) + hotstageOpeningGapKm);
    }
    return -(shipHeightKm * 0.5);
  }

  function computeInterstageSeparationMetrics({
    rocketState,
    boosterState,
    bodyAxis,
  } = {}) {
    if (!rocketState?.position || !boosterState?.position) {
      return null;
    }
    const axis = normalize(
      bodyAxis || runtime.booster.separationAxisKm || runtime.lastStep?.bodyAxisDirectionKm,
      { x: 0, y: 0, z: 1 },
    );
    const shipBasePositionKm = subtract(
      rocketState.position,
      scale(axis, Math.max(0, Number(STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm) || 0) * 0.5),
    );
    const boosterTopPositionKm = add(
      boosterState.position,
      scale(axis, Math.max(0, Number(STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm) || 0) * 0.5),
    );
    const shipBaseToBoosterTopKm = subtract(shipBasePositionKm, boosterTopPositionKm);
    const axialGapKm = dot(shipBaseToBoosterTopKm, axis);
    const lateralVectorKm = subtract(shipBaseToBoosterTopKm, scale(axis, axialGapKm));
    const relativeVelocityKmS = subtract(
      rocketState.velocity || { x: 0, y: 0, z: 0 },
      boosterState.velocity || { x: 0, y: 0, z: 0 },
    );
    const axialRateKmS = dot(relativeVelocityKmS, axis);
    const lateralVelocityKmS = subtract(relativeVelocityKmS, scale(axis, axialRateKmS));
    return {
      axis,
      axialGapKm,
      axialRateKmS,
      lateralOffsetKm: length(lateralVectorKm),
      lateralRateKmS: length(lateralVelocityKmS),
      shipBasePositionKm,
      boosterTopPositionKm,
    };
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
    const boosterCenterOffsetKm = attachedBoosterCenterOffsetKm();
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
    const syncAttachedAsStackBeforeHotstage = (
      !runtime.hotstage?.active
      && runtime.stageIndex === 0
      && !hotstageShipReferenceActive()
    );
    if (
      (hardSync || syncAttachedAsStackBeforeHotstage)
      && constraintTarget?.targetPositionKm
      && constraintTarget?.targetVelocityKmS
    ) {
      boosterState.position = { ...constraintTarget.targetPositionKm };
      boosterState.velocity = { ...constraintTarget.targetVelocityKmS };
    } else if (
      constraintTarget?.targetPositionKm
      && constraintTarget?.targetVelocityKmS
      && (
        !finiteVector(boosterState.position)
        || !finiteVector(boosterState.velocity || { x: 0, y: 0, z: 0 })
      )
    ) {
      boosterState.position = { ...constraintTarget.targetPositionKm };
      boosterState.velocity = { ...constraintTarget.targetVelocityKmS };
    } else if (
      !finiteVector(boosterState.position)
      || !finiteVector(boosterState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      boosterState.position = { ...(rocketState.position || { x: 0, y: 0, z: 0 }) };
      boosterState.velocity = { ...(rocketState.velocity || { x: 0, y: 0, z: 0 }) };
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
    const activeThrustN = Math.max(0, Number(runtime.lastStep?.thrustN) || 0);
    const thrustForceN = scale(bodyAxis, activeThrustN);
    const plumeImpingementForceN = (
      runtime.hotstage?.active
      && runtime.stageIndex >= 1
      && hotstageShipReferenceActive()
    )
      ? activeThrustN * HOTSTAGE_PLUME_IMPINGEMENT_FORCE_RATIO
      : 0;
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
    const boosterBaseForceN = add(
      runtime.stageIndex === 0
        ? add(thrustForceN, scale(nonThrustForceN, boosterForceShare))
        : scale(nonThrustForceN, boosterForceShare),
      scale(bodyAxis, -plumeImpingementForceN),
    );
    const shipBaseAccelerationKmS2 = scale(shipBaseForceN, 1 / (shipMassKg * 1000));
    const boosterBaseAccelerationKmS2 = scale(boosterBaseForceN, 1 / (boosterMassKg * 1000));

    const positionErrorKm = subtract(target.targetPositionKm, boosterState.position);
    const relativeVelocityKmS = subtract(
      target.targetVelocityKmS,
      boosterState.velocity || { x: 0, y: 0, z: 0 },
    );
    const baseRelativeAccelerationKmS2 = subtract(
      boosterBaseAccelerationKmS2,
      shipBaseAccelerationKmS2,
    );
    const axialError = decomposeVectorAlongAxis(positionErrorKm, bodyAxis);
    const axialVelocityError = decomposeVectorAlongAxis(relativeVelocityKmS, bodyAxis);
    const baseRelativeAcceleration = decomposeVectorAlongAxis(baseRelativeAccelerationKmS2, bodyAxis);

    let axialCorrectionAccelerationKmS2 = add(
      add(
        scale(
          axialError.axialVector,
          ATTACHED_STACK_JOINT_AXIAL_NATURAL_FREQUENCY_RAD_S
            * ATTACHED_STACK_JOINT_AXIAL_NATURAL_FREQUENCY_RAD_S,
        ),
        scale(
          axialVelocityError.axialVector,
          2 * ATTACHED_STACK_JOINT_AXIAL_DAMPING_RATIO * ATTACHED_STACK_JOINT_AXIAL_NATURAL_FREQUENCY_RAD_S,
        ),
      ),
      scale(baseRelativeAcceleration.axialVector, -1),
    );
    axialCorrectionAccelerationKmS2 = clampVectorMagnitude(
      axialCorrectionAccelerationKmS2,
      ATTACHED_STACK_JOINT_MAX_AXIAL_CORRECTION_KM_S2,
    );

    let lateralCorrectionAccelerationKmS2 = add(
      add(
        scale(
          axialError.lateralVector,
          ATTACHED_STACK_JOINT_LATERAL_NATURAL_FREQUENCY_RAD_S
            * ATTACHED_STACK_JOINT_LATERAL_NATURAL_FREQUENCY_RAD_S,
        ),
        scale(
          axialVelocityError.lateralVector,
          2 * ATTACHED_STACK_JOINT_LATERAL_DAMPING_RATIO * ATTACHED_STACK_JOINT_LATERAL_NATURAL_FREQUENCY_RAD_S,
        ),
      ),
      scale(baseRelativeAcceleration.lateralVector, -1),
    );
    lateralCorrectionAccelerationKmS2 = clampVectorMagnitude(
      lateralCorrectionAccelerationKmS2,
      ATTACHED_STACK_JOINT_MAX_LATERAL_CORRECTION_KM_S2,
    );

    const correctionAccelerationKmS2 = add(
      axialCorrectionAccelerationKmS2,
      lateralCorrectionAccelerationKmS2,
    );
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

    const reactionForce = decomposeVectorAlongAxis(reactionForceVectorN, bodyAxis);
    const shipAcceleration = decomposeVectorAlongAxis(shipAccelerationKmS2, bodyAxis);
    const shipRelativePositionKm = subtract(
      rocketState.position || { x: 0, y: 0, z: 0 },
      earthState.position || { x: 0, y: 0, z: 0 },
    );
    const shipRelativeRadiusKm = Math.max(1e-6, length(shipRelativePositionKm));
    const earthMassKg = Number(earthState.massKg) || Number(getEarthMassKg?.()) || 0;
    const earthMuKm3S2 = Math.max(0, Number(gravitationalConstantKm3PerKgS2) || 0)
      * Math.max(0, earthMassKg);
    const shipGravityAccelerationKmS2 = earthMuKm3S2 > 0
      ? scale(
        shipRelativePositionKm,
        -earthMuKm3S2 / (shipRelativeRadiusKm * shipRelativeRadiusKm * shipRelativeRadiusKm),
      )
      : { x: 0, y: 0, z: 0 };
    const gravitySupportMS2 = Math.max(0, -dot(shipGravityAccelerationKmS2, bodyAxis) * 1000);
    const upwardSupportMS2 = Math.max(0, shipAcceleration.axialScalar * 1000);
    const lateralSupportForceN = shipMassKg * shipAcceleration.lateralMagnitude * 1000;
    const axialCompressionForceN = Math.max(
      0,
      (shipMassKg * (gravitySupportMS2 + upwardSupportMS2)) + Math.max(0, -reactionForce.axialScalar),
    );
    const lateralForceN = Math.max(
      0,
      lateralSupportForceN + reactionForce.lateralMagnitude,
    );
    const interfaceLeverArmM = Math.max(8, stage2BodyLengthMeters() * 0.46);
    const bendingMomentNm = lateralForceN * interfaceLeverArmM;
    const angularErrorRad = Math.max(0, rad(Number(runtime.stageActuator?.gimbalErrorDeg) || 0));
    const angularRateRadS = Math.max(0, Number(runtime.stageActuator?.angularRateRadS) || 0);
    const angularReducedInertiaKgM2 = reducedMassKg * interfaceLeverArmM * interfaceLeverArmM;
    let angularMomentNm =
      angularReducedInertiaKgM2
      * (
        (ATTACHED_STACK_JOINT_ANGULAR_NATURAL_FREQUENCY_RAD_S
          * ATTACHED_STACK_JOINT_ANGULAR_NATURAL_FREQUENCY_RAD_S
          * angularErrorRad)
        + (
          2
          * ATTACHED_STACK_JOINT_ANGULAR_DAMPING_RATIO
          * ATTACHED_STACK_JOINT_ANGULAR_NATURAL_FREQUENCY_RAD_S
          * angularRateRadS
        )
      );
    angularMomentNm = clamp(angularMomentNm, 0, ATTACHED_STACK_JOINT_MAX_ANGULAR_MOMENT_NM);
    const angularEquivalentLoadN = angularMomentNm / Math.max(interfaceLeverArmM, 1);
    const totalStructuralLoadN = Math.min(
      ATTACHED_STACK_JOINT_MAX_LOAD_N,
      Math.hypot(axialCompressionForceN, lateralForceN, angularEquivalentLoadN),
    );
    const axialStiffnessNPerM = Math.max(
      1,
      reducedMassKg * ATTACHED_STACK_JOINT_AXIAL_NATURAL_FREQUENCY_RAD_S * ATTACHED_STACK_JOINT_AXIAL_NATURAL_FREQUENCY_RAD_S,
    );
    const lateralStiffnessNPerM = Math.max(
      1,
      reducedMassKg * ATTACHED_STACK_JOINT_LATERAL_NATURAL_FREQUENCY_RAD_S * ATTACHED_STACK_JOINT_LATERAL_NATURAL_FREQUENCY_RAD_S,
    );
    const angularStiffnessNmPerRad = Math.max(
      1,
      angularReducedInertiaKgM2
        * ATTACHED_STACK_JOINT_ANGULAR_NATURAL_FREQUENCY_RAD_S
        * ATTACHED_STACK_JOINT_ANGULAR_NATURAL_FREQUENCY_RAD_S,
    );
    const separationMetrics = hotstageShipReferenceActive()
      ? computeInterstageSeparationMetrics({
        rocketState,
        boosterState,
        bodyAxis,
      })
      : null;
    if (runtime.hotstage?.active && separationMetrics) {
      runtime.hotstage.physicalSeparationKm = Math.max(0, Number(separationMetrics.axialGapKm) || 0);
      runtime.hotstage.physicalSeparationRateKmS = Number(separationMetrics.axialRateKmS) || 0;
    }

    runtime.attachedJoint = {
      active: true,
      targetOffsetWorldKm: cloneVector(target.offsetWorldKm),
      targetPositionKm: cloneVector(target.targetPositionKm),
      targetVelocityKmS: cloneVector(target.targetVelocityKmS),
      bodyAxisDirectionKm: cloneVector(bodyAxis),
      positionErrorKm: cloneVector(positionErrorKm),
      relativeVelocityKmS: cloneVector(relativeVelocityKmS),
      shipBaseAccelerationKmS2: cloneVector(shipBaseAccelerationKmS2),
      boosterBaseAccelerationKmS2: cloneVector(boosterBaseAccelerationKmS2),
      shipJointAccelerationKmS2: cloneVector(shipJointAccelerationKmS2),
      boosterJointAccelerationKmS2: cloneVector(boosterJointAccelerationKmS2),
      shipAccelerationKmS2: cloneVector(shipAccelerationKmS2),
      boosterAccelerationKmS2: cloneVector(boosterAccelerationKmS2),
      axialErrorKm: Math.abs(axialError.axialScalar),
      lateralErrorKm: axialError.lateralMagnitude,
      axialRelativeSpeedKmS: Math.abs(axialVelocityError.axialScalar),
      lateralRelativeSpeedKmS: axialVelocityError.lateralMagnitude,
      axialCompressionForceN,
      lateralForceN,
      correctionForceN: reactionForceMagN,
      bendingMomentNm,
      angularMomentNm,
      axialCompressionM: axialCompressionForceN / axialStiffnessNPerM,
      lateralDeflectionM: lateralForceN / lateralStiffnessNPerM,
      angularDeflectionDeg: degrees(angularMomentNm / angularStiffnessNmPerRad),
      reactionForceN: totalStructuralLoadN,
      plumeImpingementForceN,
      physicalSeparationKm: separationMetrics ? separationMetrics.axialGapKm : 0,
      physicalSeparationRateKmS: separationMetrics ? separationMetrics.axialRateKmS : 0,
      physicalLateralOffsetKm: separationMetrics ? separationMetrics.lateralOffsetKm : 0,
      releaseContactActive: false,
      shipReferenceActive: hotstageShipReferenceActive(),
      shipMassKg,
      boosterMassKg,
    };

    runtime.booster.lastStep = {
      accelerationKmS2: cloneVector(boosterAccelerationKmS2),
      guidanceMode: "booster-attached-joint",
      requestedDirectionKm: cloneVectorOrNull(target.stackedBodyAxis),
      bodyAxisDirectionKm: cloneVectorOrNull(target.stackedBodyAxis),
      attachedJointLoadMN: runtime.attachedJoint.reactionForceN / 1e6,
      attachedJointAxialLoadMN: axialCompressionForceN / 1e6,
      attachedJointLateralLoadMN: lateralForceN / 1e6,
      attachedJointBendingMomentMNm: bendingMomentNm / 1e6,
      attachedJointAngularMomentMNm: angularMomentNm / 1e6,
      attachedJointErrorM: length(positionErrorKm) * 1000,
      attachedJointRelativeSpeedMS: length(relativeVelocityKmS) * 1000,
      attachedJointBaseAccelerationKmS2: cloneVector(boosterBaseAccelerationKmS2),
      attachedJointAccelerationKmS2: cloneVector(boosterJointAccelerationKmS2),
      attachedJointPlumeImpingementForceN: plumeImpingementForceN,
      hotstagePhysicalSeparationKm: separationMetrics ? separationMetrics.axialGapKm : 0,
      hotstagePhysicalSeparationRateKmS: separationMetrics ? separationMetrics.axialRateKmS : 0,
      ...resolveBoosterRecoveryHardwareState({
        phase: "attached-stack",
        guidanceMode: "booster-attached-joint",
        attitudeControlMode: "attached-stack",
        boosterAttached: true,
        dynamicPressurePa: Number(runtime.lastStep?.dynamicPressurePa) || 0,
      }),
    };
  }

  function stabilizeAttachedStackConstraint(state, rocketState, earthState, currentEarthAxes) {
    if (
      runtime.hotstage?.active
      || !runtime.booster.attached
      || runtime.booster.active
      || !rocketState
      || !earthState
    ) {
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
      const shipPositionCorrectionKm = scale(relativePositionErrorKm, boosterMassKg / totalMassKg);
      const boosterPositionCorrectionKm = scale(relativePositionErrorKm, -shipMassKg / totalMassKg);
      if (applyStarshipPositionCorrection(
        rocketState,
        shipPositionCorrectionKm,
        "attached_stack_constraint_position",
        { constraint: true },
      )) {
        boosterState.position = add(boosterState.position, boosterPositionCorrectionKm);
      }
    }
    if (length(relativeVelocityErrorKmS) > 1e-9) {
      const shipVelocityCorrectionKmS = scale(relativeVelocityErrorKmS, boosterMassKg / totalMassKg);
      const boosterVelocityCorrectionKmS = scale(relativeVelocityErrorKmS, -shipMassKg / totalMassKg);
      if (applyStarshipVelocityCorrection(
        rocketState,
        shipVelocityCorrectionKmS,
        "attached_stack_constraint_velocity",
        { constraint: true },
      )) {
        boosterState.velocity = add(
          boosterState.velocity || { x: 0, y: 0, z: 0 },
          boosterVelocityCorrectionKmS,
        );
      }
    }
    runtime.attachedJoint.targetOffsetWorldKm = cloneVector(target.offsetWorldKm);
    runtime.attachedJoint.targetPositionKm = cloneVector(target.targetPositionKm);
    runtime.attachedJoint.targetVelocityKmS = cloneVector(target.targetVelocityKmS);
    runtime.attachedJoint.bodyAxisDirectionKm = cloneVector(target.stackedBodyAxis);
    runtime.attachedJoint.positionErrorKm = { x: 0, y: 0, z: 0 };
    runtime.attachedJoint.relativeVelocityKmS = { x: 0, y: 0, z: 0 };
    runtime.attachedJoint.axialErrorKm = 0;
    runtime.attachedJoint.lateralErrorKm = 0;
    runtime.attachedJoint.axialRelativeSpeedKmS = 0;
    runtime.attachedJoint.lateralRelativeSpeedKmS = 0;
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
    let needsRepair = false;
    if (
      !existingRocketState
      || !finiteVector(existingRocketState.position)
      || !finiteVector(existingRocketState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      needsRepair = true;
    } else {
      const relPos = subtract(existingRocketState.position, earthState.position);
      const altitudeKm = length(relPos) - earthRadiusKm;
      needsRepair = !Number.isFinite(altitudeKm) || altitudeKm > 20 || altitudeKm < -1;
    }
    const currentVehiclePhase = launchVehiclePhaseFromKinematics({
      earthState,
      rocketState: existingRocketState,
      earthRadiusKm,
      earthPole: currentEarthAxes.pole,
    });
    if (currentLaunchCommandPhase() !== "idle") {
      return false;
    }
    if (!needsRepair && currentVehiclePhase !== "idle") {
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
    const padUpAxis = localPadUpDirection(rocketState, earthState, currentEarthAxes);
    runtime.stageActuator = createActuatorState(padUpAxis);
    runtime.stageAttitude = resetAttitudeStateToAxis(padUpAxis);
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
    resetLaunchSequenceState(runtime.launchSequence);
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
    const padUpAxis = localPadUpDirection(rocketState, earthState, currentEarthAxes);
    runtime.stageActuator = createActuatorState(padUpAxis);
    runtime.stageAttitude = resetAttitudeStateToAxis(padUpAxis);
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
    resetLaunchSequenceState(runtime.launchSequence);
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
    runtime.boosterEngineCountOverride = normalizeBoosterEngineCountSelection(
      options?.boosterEngineCount,
      runtime.boosterEngineCountOverride,
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
    resetLaunchSequenceState(runtime.launchSequence);
    runtime.launchSequence.active = true;
    runtime.launchSequence.startElapsedSec = Math.max(0, Number(runtime.elapsedSeconds) || 0);
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
    const stagePropellantCapacityKg = Math.max(
      0,
      Number(stage.propellantMassKg) || Number(runtime.stageInitialPropellantKg) || Number(runtime.stagePropellantKg) || 0,
    );
    const remainingStagePropellantKg = clamp(
      Number(runtime.stagePropellantKg) || 0,
      0,
      stagePropellantCapacityKg > 0 ? stagePropellantCapacityKg : Number.POSITIVE_INFINITY,
    );
    const boosterPropellantKg = Number.isFinite(reserveOverride)
      ? clamp(reserveOverride, 0, remainingStagePropellantKg)
      : remainingStagePropellantKg;
    const boosterDryMassKg = Number(stage.dryMassKg) || Number(LAUNCH_BOOSTER_CONFIG.dryMassKg) || 0;
    const boosterMassKg = boosterDryMassKg + boosterPropellantKg;
    if (!(boosterMassKg > 0)) {
      return null;
    }
    const preSeparationStackMassKg = Math.max(MIN_ROCKET_MASS_KG, Number(rocketState.massKg) || 0);
    const shipReferenceActiveAtRelease = hotstageShipReferenceActive();
    const shipMassKg = shipReferenceActiveAtRelease
      ? preSeparationStackMassKg
      : Math.max(MIN_ROCKET_MASS_KG, preSeparationStackMassKg - boosterMassKg);
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

    const shipReferenceActive = shipReferenceActiveAtRelease;
    const shipCenterShiftKm = shipReferenceActive
      ? 0
      : STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm * 0.5;
    if (shipCenterShiftKm > 0) {
      applyStarshipPositionCorrection(
        rocketState,
        scale(separationAxis, shipCenterShiftKm),
        "stage_separation_ship_reference_shift",
        { lifecycle: true },
      );
    }
    boosterState.massKg = boosterMassKg;
    rocketState.massKg = shipMassKg;
    const releaseMetrics = computeInterstageSeparationMetrics({
      rocketState,
      boosterState,
      bodyAxis: separationAxis,
    });
    const relativeVelocityAtReleaseKmS = subtract(
      rocketState.velocity || { x: 0, y: 0, z: 0 },
      boosterState.velocity || { x: 0, y: 0, z: 0 },
    );
    const physicalSeparationRateKmS = releaseMetrics
      ? Number(releaseMetrics.axialRateKmS) || 0
      : dot(relativeVelocityAtReleaseKmS, separationAxis);
    const physicalSeparationKm = releaseMetrics
      ? Number(releaseMetrics.axialGapKm) || 0
      : 0;

    runtime.booster.attached = false;
    runtime.attachedJoint = createAttachedStackJointState();
    runtime.booster.active = true;
    setBoosterCommandPhase("separation-flip");
    runtime.booster.guidanceMode = "booster-separation-flip";
    runtime.booster.propellantKg = boosterPropellantKg;
    runtime.booster.initialPropellantKg = boosterPropellantKg;
    runtime.booster.separationTimeSec = runtime.elapsedSeconds;
    runtime.booster.separationAxisKm = cloneVectorOrNull(separationAxis);
    runtime.booster.landed = false;
    runtime.booster.crashed = false;
    runtime.booster.terminalOutcome = "";
    runtime.booster.terminalReason = "";
    runtime.booster.impactSpeedKmS = null;
    runtime.booster.impactVerticalSpeedKmS = null;
    runtime.booster.impactLateralSpeedKmS = null;
    runtime.booster.impactBodyUpAlignment = null;
    runtime.booster.crashDynamics = resetBoosterCrashDynamicsState(runtime.booster.crashDynamics);
    runtime.booster.combustion = transferEngineCombustionClusterState(
      runtime.stage1Combustion,
      boosterCombustionClusterOptions(runtime.boosterEngineCountOverride, "separation-flip"),
    );
    runtime.booster.lastStep = zeroBoosterStep("booster-separation-flip");
    runtime.booster.attitude = createBoosterAttitudeState(stackedBodyAxis);
    runtime.boosterActuator = createActuatorState(stackedBodyAxis);
    runtime.boosterMassModel = createMassModelState();
    runtime.booster.lastSurfaceSample = null;
    runtime.booster.contactHoldSec = 0;
    runtime.booster.catchAlignHoldSec = 0;
    runtime.booster.capture = resetBoosterCatchCaptureState(runtime.booster.capture);
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
      boosterPropellantKg,
      reservePropellantKg: reserveLimitKg,
      shipCenterShiftKm,
      shipMassKg,
      shipImpulseKmS: { x: 0, y: 0, z: 0 },
      separationImpulseKmS: { x: 0, y: 0, z: 0 },
      physicsDrivenRelease: true,
      physicalSeparationKm,
      physicalSeparationRateKmS,
      separationAxisWorldKm: { ...separationAxis },
    });
    emitRuntimeTransitionEvents("stage_separation");
    return boosterState;
  }

  function applyBoosterShipSeparationContact({
    state,
    boosterState,
    dtSeconds = 0,
  } = {}) {
    if (
      !runtime.booster.active
      || runtime.booster.attached
      || runtime.stageIndex < 1
      || !state?.dynamicBodies
      || !boosterState?.position
    ) {
      return null;
    }
    const timeSinceSeparationSec = Math.max(
      0,
      (Number(runtime.elapsedSeconds) || 0) - (Number(runtime.booster.separationTimeSec) || 0),
    );
    if (timeSinceSeparationSec > 8) {
      updateStarshipCleanFreeFlightState({
        contactActive: false,
        reason: "separation_contact_window_expired",
      });
      return null;
    }
    const rocketState = rocketStateFromNBody(state);
    if (!rocketState?.position || !rocketState?.velocity || !boosterState?.velocity) {
      return null;
    }
    const axis = normalize(
      runtime.booster.separationAxisKm
        || runtime.booster.lastStep?.bodyAxisDirectionKm
        || runtime.lastStep?.bodyAxisDirectionKm,
      { x: 0, y: 0, z: 1 },
    );
    const metrics = computeInterstageSeparationMetrics({
      rocketState,
      boosterState,
      bodyAxis: axis,
    });
    if (!metrics) {
      return null;
    }
    const lateralContactRadiusKm = Math.max(
      0.002,
      (Number(STARSHIP_STACK_DIMENSIONS_KM.diameterKm) || 0.009) * 0.70,
    );
    const contactActive = (
      metrics.axialGapKm < HOTSTAGE_INTERSTAGE_CONTACT_BAND_KM
      && metrics.lateralOffsetKm <= lateralContactRadiusKm
    );
    if (contactActive) {
      const shipMassKg = Math.max(MIN_ROCKET_MASS_KG, Number(rocketState.massKg) || MIN_ROCKET_MASS_KG);
      const boosterMassKg = Math.max(MIN_ROCKET_MASS_KG, Number(boosterState.massKg) || MIN_ROCKET_MASS_KG);
      const totalMassKg = shipMassKg + boosterMassKg;
      const dt = Math.max(1e-6, Number(dtSeconds) || 0);
      const penetrationKm = Math.max(0, HOTSTAGE_INTERSTAGE_CONTACT_BAND_KM - metrics.axialGapKm);
      const closingRateKmS = Math.min(0, metrics.axialRateKmS);
      const targetDeltaV = clamp(
        (penetrationKm / dt * 0.22) - (closingRateKmS * (1 + HOTSTAGE_INTERSTAGE_CONTACT_RESTITUTION)),
        0,
        0.018,
      );
      if (targetDeltaV > 1e-9) {
        const shipContactDeltaVKmS = scale(axis, targetDeltaV * (boosterMassKg / totalMassKg));
        if (applyStarshipVelocityCorrection(
          rocketState,
          shipContactDeltaVKmS,
          "interstage_release_contact_impulse",
          { contact: true },
        )) {
          boosterState.velocity = add(
            boosterState.velocity,
            scale(axis, -targetDeltaV * (shipMassKg / totalMassKg)),
          );
        }
      }
      runtime.attachedJoint.releaseContactActive = true;
    } else {
      runtime.attachedJoint.releaseContactActive = false;
    }
    runtime.attachedJoint.physicalSeparationKm = metrics.axialGapKm;
    runtime.attachedJoint.physicalSeparationRateKmS = metrics.axialRateKmS;
    runtime.attachedJoint.physicalLateralOffsetKm = metrics.lateralOffsetKm;
    updateStarshipCleanFreeFlightState({
      metrics,
      contactActive,
      reason: "interstage_gap_clear",
    });
    return {
      ...metrics,
      contactActive,
    };
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
    if (runtime.booster.crashed) {
      runtime.booster.lastStep = runtime.booster.lastStep || zeroBoosterStep(
        runtime.booster.guidanceMode || "booster-crashed",
      );
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
    const useNavigationGuidanceState =
      Boolean(navigationSolution?.towerRelativeActive)
      || altitudeKm <= 8;
    const guidanceBoosterState = useNavigationGuidanceState
      ? (navigationSolution?.estimatedBoosterState || boosterState)
      : boosterState;
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
    const launchSiteLateralClosingSpeedKmS = dot(relVelocityToPad, launchSiteLateralDirection);
    const currentBoosterAxis = boosterBodyAxisWorld(runtime.booster.attitude);
    const bodyRetrogradeAlignment = dot(
      currentBoosterAxis,
      normalize(scale(guidanceRelVel, -1), guidanceOrbital.up),
    );
    const bodyAntiTangentAlignment = dot(
      currentBoosterAxis,
      normalize(
        scale(guidanceOrbital.tangentialVector, -1),
        normalize(scale(guidanceRelVel, -1), guidanceOrbital.up),
      ),
    );
    const bodyUpAlignment = dot(
      currentBoosterAxis,
      guidanceOrbital.up,
    );
    const timeSinceSeparationSec = Math.max(0, runtime.elapsedSeconds - runtime.booster.separationTimeSec);
    let command = computeBoosterRecoveryCommand({
      currentPhase: currentBoosterCommandPhase(),
      altitudeKm,
      radialSpeedKmS: guidanceOrbital.radialSpeedKmS,
      tangentialSpeedKmS: guidanceOrbital.tangentialSpeedKmS,
      dynamicPressurePa,
      remainingPropellantKg: runtime.booster.propellantKg,
      reserveLandingPropellantKg: stageReservePropellantKg(0),
      timeSinceSeparationSec,
      launchSiteRangeKm,
      launchSiteLateralRangeKm,
      launchSiteLateralClosingSpeedKmS,
      catchTotalRangeKm: catchRelativeState?.totalRangeKm,
      catchLateralRangeKm: catchRelativeState?.lateralRangeKm,
      catchVerticalErrorKm: catchRelativeState?.verticalErrorKm,
      catchLateralSpeedKmS: catchRelativeState?.lateralSpeedKmS,
      catchVerticalSpeedKmS: catchRelativeState?.verticalSpeedKmS,
      catchApproachSpeedKmS: catchRelativeState?.totalSpeedKmS,
      catchEastErrorKm: catchRelativeState?.eastErrorKm,
      catchNorthErrorKm: catchRelativeState?.northErrorKm,
      catchEastSpeedKmS: catchRelativeState?.eastSpeedKmS,
      catchNorthSpeedKmS: catchRelativeState?.northSpeedKmS,
      catchClosingSpeedKmS: catchRelativeState?.closingSpeedKmS,
      towerRelativeActive: navigationSolution?.towerRelativeActive,
      catchPositionSigmaKm: navigationSolution?.catchPositionSigmaKm,
      catchVelocitySigmaKmS: navigationSolution?.catchVelocitySigmaKmS,
      bodyRetrogradeAlignment,
      bodyAntiTangentAlignment,
      bodyUpAlignment,
    });
    if (runtime.booster.capture?.active) {
      const capturePhase = String(runtime.booster.capture.phase || "catch-contact");
      command = {
        phase: capturePhase,
        guidanceMode: `booster-${capturePhase}`,
        attitudeControlMode: "rcs",
        qAlphaSteeringEnabled: false,
        siteTargetingEnabled: false,
        throttle: 0,
        directionMix: { up: 1, retrograde: 0, antiTangent: 0 },
        terminalUprightCommit: true,
        uprightTiltLimitDeg: 2,
        attitudeResponseScale: 0.85,
        attitudeTargetBlend: 0.85,
        angularDampingPerS: 1.10,
        maxBodyRateDegS: 4.0,
      };
    }

    const up = guidanceOrbital.up;
    let direction = composeBoosterDirection(
      up,
      guidanceRelVel,
      guidanceOrbital.tangentialVector,
      command.directionMix,
    );
    if (command.predictiveCatchControl && catchRelativeState) {
      direction = composePredictiveCatchDirection(
        direction,
        catchRelativeState,
        command.predictiveCatchControl,
      );
    }
    const terminalUprightAxis = catchRelativeState?.upAxisKm || up;
    if (command.terminalUprightCommit) {
      direction = limitDirectionOffAxis(
        direction,
        terminalUprightAxis,
        rad(Number(command.uprightTiltLimitDeg) || 0),
      );
    }
    const towerClearCorridorActive = Boolean(
      catchFrame
      && catchRelativeState
      && !runtime.booster.capture?.active
      && (
        Boolean(navigationSolution?.towerRelativeActive)
        || String(command.guidanceMode || "").toLowerCase().includes("catch")
        || String(command.guidanceMode || "").toLowerCase().includes("terminal-intercept")
      )
    );
    const towerClearCorridorOffsetEastKm = resolveTowerClearCorridorOffsetEastKm({
      altitudeKm,
      catchVerticalErrorKm: catchRelativeState?.verticalErrorKm,
      catchGuidanceActive: towerClearCorridorActive,
      captureActive: Boolean(runtime.booster.capture?.active),
    });
    const towerClearTargetState = (
      catchFrame
      && Math.abs(towerClearCorridorOffsetEastKm) > 1e-6
    )
      ? {
        position: add(
          catchFrame.centerPosition,
          scale(catchFrame.eastAxis || { x: 1, y: 0, z: 0 }, towerClearCorridorOffsetEastKm),
        ),
        velocity: catchFrame.centerVelocity,
      }
      : null;
    const siteTargetingEnabled = command.siteTargetingEnabled !== false;
    const siteTargetState = siteTargetingEnabled
      ? (
        catchFrame
          ? (towerClearTargetState || {
            position: catchFrame.centerPosition,
            velocity: catchFrame.centerVelocity,
          })
          : padState
      )
      : null;
    if (siteTargetState) {
      const pureRetrogradeDirection = normalize(scale(guidanceRelVel, -1), direction);
      const targetVectorDirection = normalize(
        subtract(
          siteTargetState.position || { x: 0, y: 0, z: 0 },
          guidanceBoosterState.position || { x: 0, y: 0, z: 0 },
        ),
        direction,
      );
      const lateralToSiteDirection = lateralDirectionTowardTarget(
        guidanceBoosterState.position,
        siteTargetState.position,
        up,
        direction,
      );
      const targetVelocity = siteTargetState.velocity || padVelocity;
      const relVelocityToTarget = subtract(
        guidanceBoosterState.velocity || { x: 0, y: 0, z: 0 },
        targetVelocity,
      );
      const padRetrogradeDirection = normalize(scale(relVelocityToTarget, -1), direction);
      const lateralRelVelocityToTarget = subtract(
        relVelocityToTarget,
        scale(up, dot(relVelocityToTarget, up)),
      );
      const padInterceptBlend = clamp(
        Number(command.padInterceptBlend) || 0,
        0,
        altitudeKm > 30 ? 1.0 : altitudeKm > 10 ? 0.82 : 0.40,
      );
      if (padInterceptBlend > 1e-6) {
        const desiredLateralClosingSpeedKmS = clamp(
          Number(command.padDesiredLateralClosingSpeedKmS) || 0,
          0,
          2.0,
        );
        const desiredLateralVelocityToTarget = desiredLateralClosingSpeedKmS > 1e-6
          ? scale(launchSiteLateralDirection, desiredLateralClosingSpeedKmS)
          : { x: 0, y: 0, z: 0 };
        const lateralVelocityErrorDirection = desiredLateralClosingSpeedKmS > 1e-6
          ? normalize(
            subtract(desiredLateralVelocityToTarget, lateralRelVelocityToTarget),
            targetVectorDirection,
          )
          : targetVectorDirection;
        const padInterceptDirection = normalize(
          add(
            scale(lateralVelocityErrorDirection, 1),
            scale(
              targetVectorDirection,
              clamp(Number(command.padInterceptLateralWeight) || 0, 0, 2.0),
            ),
          ),
          lateralVelocityErrorDirection,
        );
        direction = normalize(
          mixVectors(direction, padInterceptDirection, padInterceptBlend),
          direction,
        );
      }
      const siteVectorWeight = clamp(
        Number(command.siteVectorWeight) || 0,
        0,
        altitudeKm > 40 ? 0.85 : altitudeKm > 10 ? 0.42 : 0.16,
      );
      if (siteVectorWeight > 1e-6 && padInterceptBlend <= 1e-6) {
        direction = normalize(mixVectors(direction, lateralToSiteDirection, siteVectorWeight), direction);
      }
      const siteVelocityWeight = clamp(
        Number(command.siteVelocityWeight) || 0,
        0,
        altitudeKm > 25 ? 0.62 : altitudeKm > 8 ? 0.34 : 0.18,
      );
      if (siteVelocityWeight > 1e-6 && padInterceptBlend <= 1e-6) {
        direction = normalize(mixVectors(direction, padRetrogradeDirection, siteVelocityWeight), direction);
      }
      const baseMaxSiteSteeringAngleDeg = Number(command.maxSiteSteeringAngleDeg);
      const predictiveSteeringExtraDeg =
        command.predictiveCatchControl?.enabled
          ? clamp(
            10 + (28 * clamp(Number(command.predictiveCatchControl?.blend) || 0, 0, 1)),
            10,
            38,
          )
          : 0;
      let maxSiteSteeringAngleDeg = Number.isFinite(baseMaxSiteSteeringAngleDeg)
        ? Math.min(88, baseMaxSiteSteeringAngleDeg + predictiveSteeringExtraDeg)
        : Number.NaN;
      if (String(command.phase || "").toLowerCase() === "boostback" && Number.isFinite(maxSiteSteeringAngleDeg)) {
        const boostbackRetrogradePriorityCapDeg = clamp(
          46
            + (1.25 * Math.max(0, timeSinceSeparationSec - 5))
            + (16 * clamp(Number(runtime.boosterActuator?.throttleActual) || 0, 0, 1)),
          46,
          92,
        );
        maxSiteSteeringAngleDeg = Math.min(maxSiteSteeringAngleDeg, boostbackRetrogradePriorityCapDeg);
      }
      if (Number.isFinite(maxSiteSteeringAngleDeg) && maxSiteSteeringAngleDeg > 0) {
        direction = limitDirectionOffAxis(
          direction,
          pureRetrogradeDirection,
          rad(maxSiteSteeringAngleDeg),
        );
      }
    }
    if (command.predictiveCatchControl && catchRelativeState) {
      direction = composePredictiveCatchDirection(
        direction,
        catchRelativeState,
        command.predictiveCatchControl,
      );
    }
    if (command.terminalUprightCommit) {
      direction = limitDirectionOffAxis(
        direction,
        terminalUprightAxis,
        rad(Number(command.uprightTiltLimitDeg) || 0),
      );
    }
    if (String(command.phase || "").toLowerCase() === "boostback") {
      const boostbackSlewElapsedSec = Math.max(0, timeSinceSeparationSec - 14);
      const boostbackTargetSlewLimitDeg = clamp(
        72
          + (3.2 * boostbackSlewElapsedSec)
          + (20 * clamp(Number(runtime.boosterActuator?.throttleActual) || 0, 0, 1)),
        72,
        128,
      );
      direction = limitDirectionOffAxis(
        direction,
        currentBoosterAxis,
        rad(boostbackTargetSlewLimitDeg),
      );
      const boostbackRetrogradePriorityCapDeg = clamp(
        46
          + (1.25 * Math.max(0, timeSinceSeparationSec - 5))
          + (16 * clamp(Number(runtime.boosterActuator?.throttleActual) || 0, 0, 1)),
        46,
        92,
      );
      direction = limitDirectionOffAxis(
        direction,
        normalize(scale(guidanceRelVel, -1), direction),
        rad(boostbackRetrogradePriorityCapDeg),
      );
    }
    const pressurePa = Number(atmosphereSample?.pressurePa) || 0;
    const landingPhase = command.phase === "landing-burn" || command.phase === "landed";
    const recoveryPhase = String(command.phase || "").toLowerCase();
    const terminalUprightCommitActive = Boolean(command.terminalUprightCommit);
    const strongTerminalUprightPhase = terminalUprightCommitActive && (
      recoveryPhase === "entry-align"
      || recoveryPhase === "entry-burn"
      || recoveryPhase === "descent-coast"
      || recoveryPhase === "landing-burn"
      || recoveryPhase === "terminal-intercept"
      || recoveryPhase === "catch-approach"
      || recoveryPhase === "catch-burn"
      || recoveryPhase === "catch-contact"
      || recoveryPhase === "catch-capture"
      || recoveryPhase === "caught"
    );
	    const terminalCatchHardUprightLockActive = Boolean(
	      terminalUprightCommitActive
	      && catchRelativeState
      && (
        !Number.isFinite(Number(catchRelativeState.lateralSpeedKmS))
        || Number(catchRelativeState.lateralSpeedKmS) <= 0.16
        || recoveryPhase === "catch-contact"
        || recoveryPhase === "catch-capture"
      )
	      && (
	        Number(catchRelativeState.totalRangeKm) <= 2.4
        || (
          Number(catchRelativeState.lateralRangeKm) <= 1.1
          && Math.abs(Number(catchRelativeState.verticalErrorKm) || 0) <= 3.2
        )
      )
      && (
        recoveryPhase === "descent-coast"
        || recoveryPhase === "terminal-intercept"
        || recoveryPhase === "catch-approach"
        || recoveryPhase === "catch-burn"
        || recoveryPhase === "catch-contact"
        || recoveryPhase === "catch-capture"
      )
    );
    const recoveryPropellantBudgetKg = stageReservePropellantKg(0);
    const reserveProtectionRatio = landingPhase
      ? 0
      : (
        recoveryPhase === "catch-burn"
          ? 0
          : recoveryPhase === "catch-approach"
            ? 0.02
            : recoveryPhase === "descent-coast"
              ? 0.04
              : recoveryPhase === "entry-burn"
                ? 0.08
                : recoveryPhase === "entry-align" || recoveryPhase === "ballistic-descent"
                  ? 0.10
                  : recoveryPhase === "boostback"
                    ? 0.14
                    : recoveryPhase === "separation-flip" || recoveryPhase === "separation-coast"
                      ? 0.18
                      : 0.12
      );
    const protectedReserveKg = recoveryPropellantBudgetKg * reserveProtectionRatio;
    const burnablePropellantKg = Math.max(0, runtime.booster.propellantKg - protectedReserveKg);
    const attitudeControlModeText = String(command.attitudeControlMode || "").toLowerCase();
    const mainEngineAuthorityActive = (
      !runtime.booster.crashed
      && !runtime.booster.landed
      && (
        attitudeControlModeText.includes("engine")
        || recoveryPhase === "boostback"
        || recoveryPhase === "entry-burn"
        || recoveryPhase === "catch-burn"
        || recoveryPhase === "landing-burn"
      )
      && recoveryPhase !== "catch-contact"
      && recoveryPhase !== "catch-capture"
      && recoveryPhase !== "caught"
      && recoveryPhase !== "landed"
    );
    const rcsAuthorityAllowed = (
      !runtime.booster.crashed
      && !runtime.booster.landed
      && (
        attitudeControlModeText.includes("rcs")
        || recoveryPhase === "separation-flip"
        || recoveryPhase === "separation-coast"
        || recoveryPhase === "hotstage-ring-jettison"
        || recoveryPhase === "boostback"
        || recoveryPhase === "entry-align"
        || recoveryPhase === "entry-burn"
        || recoveryPhase === "ballistic-descent"
        || recoveryPhase === "descent-coast"
        || recoveryPhase === "terminal-intercept"
        || recoveryPhase === "catch-approach"
        || recoveryPhase === "catch-burn"
      )
    );
    const canBurn = burnablePropellantKg > 1e-6 && mainEngineAuthorityActive;
    const relAirVelocityKmS = atmosphereRelativeVelocityKmS(
      relPos,
      relVel,
      currentEarthAxes.pole,
      windSample.vectorKmS,
    );
    const qAlphaSteeringEnabled = command.qAlphaSteeringEnabled !== false
      && !strongTerminalUprightPhase;
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
    if (terminalUprightCommitActive) {
      direction = limitDirectionOffAxis(
        direction,
        terminalUprightAxis,
        rad(Number(command.uprightTiltLimitDeg) || 0),
      );
    }
    if (terminalCatchHardUprightLockActive) {
      direction = limitDirectionOffAxis(
        direction,
        terminalUprightAxis,
        rad(Number(catchRelativeState?.totalRangeKm) <= 2 ? 2.5 : 3.5),
      );
    }
    const ignitionUprightAlignment = terminalUprightCommitActive
      ? clamp(dot(currentBoosterAxis, terminalUprightAxis), -1, 1)
      : bodyUpAlignment;
    let requestedThrottle = canBurn ? clamp(Number(command.throttle) || 0, 0, 1) : 0;
    if (requestedThrottle > 0 && recoveryPhase === "boostback") {
      const ignitionAttitudeErrorDeg = degrees(angleBetweenRadians(currentBoosterAxis, direction));
      const bodyRateDegS = degrees(length(runtime.booster.attitude?.omegaBodyRadS || { x: 0, y: 0, z: 0 }));
      const noseDownBoostbackPenalty = terminalUprightCommitActive
        ? 1
        : clamp((bodyUpAlignment + 0.35) / 0.35, 0.72, 1);
      const attitudeGate = clamp((98 - ignitionAttitudeErrorDeg) / 56, 0, 1)
        * noseDownBoostbackPenalty;
      const rateGate = clamp((42 - bodyRateDegS) / 30, 0, 1);
      requestedThrottle *= attitudeGate * rateGate;
    }
    if (
      requestedThrottle > 0
      && (
        recoveryPhase === "entry-burn"
        || recoveryPhase === "landing-burn"
        || recoveryPhase === "catch-burn"
      )
    ) {
      const catchCorridorStillTranslating = Boolean(
        recoveryPhase === "catch-burn"
        && catchRelativeState
        && (
          Number(catchRelativeState.totalRangeKm) > 0.55
          || Number(catchRelativeState.lateralSpeedKmS) > 0.035
        )
      );
      const landingCorridorTranslationActive = Boolean(
        recoveryPhase === "landing-burn"
        && catchRelativeState
        && altitudeKm > 1.4
        && Number(catchRelativeState.lateralRangeKm) > 1.2
      );
      const minIgnitionAlignment = recoveryPhase === "catch-burn"
        ? (catchCorridorStillTranslating ? 0.72 : 0.86)
        : recoveryPhase === "landing-burn"
          ? (landingCorridorTranslationActive ? 0.72 : 0.68)
          : 0.82;
      const fullAuthorityAlignment = recoveryPhase === "catch-burn"
        ? (catchCorridorStillTranslating ? 0.90 : 0.94)
        : recoveryPhase === "landing-burn"
          ? (landingCorridorTranslationActive ? 0.90 : 0.84)
          : 0.92;
      const bodyRateDegS = degrees(length(runtime.booster.attitude?.omegaBodyRadS || { x: 0, y: 0, z: 0 }));
      const attitudeGate = clamp(
        (ignitionUprightAlignment - minIgnitionAlignment)
          / Math.max(fullAuthorityAlignment - minIgnitionAlignment, 1e-6),
        0,
        1,
      );
      const rateGate = landingCorridorTranslationActive
        ? clamp((34 - bodyRateDegS) / 28, 0, 1)
        : clamp((18 - bodyRateDegS) / 14, 0, 1);
      requestedThrottle *= attitudeGate * rateGate;
    }
	    if (qAlphaActive) {
	      requestedThrottle = limitThrottleByQAlpha({
	        throttle: requestedThrottle,
	        qAlphaPaRad: qAlphaSteering.qAlphaPaRad,
	        bodyKind: "booster",
	      });
	    }
	    const poweredMainThrustPhase = (
	      recoveryPhase === "boostback"
	      || recoveryPhase === "entry-burn"
	      || recoveryPhase === "catch-burn"
	      || recoveryPhase === "landing-burn"
	    );
	    const poweredMainThrustFloorActive = poweredMainThrustPhase && (
	      recoveryPhase === "boostback"
	      || requestedThrottle > 0
	      || (canBurn && (Number(command.throttle) || 0) > 0)
	      || (Number(runtime.boosterActuator?.throttleActual) || 0) > 0.005
	    );
	    let mainThrustMinUpComponent = 0;
	    if (poweredMainThrustFloorActive) {
      if (recoveryPhase === "boostback") {
        mainThrustMinUpComponent = 0.08;
      } else if (recoveryPhase === "entry-burn") {
	        mainThrustMinUpComponent = 0.88;
	      } else if (recoveryPhase === "catch-burn") {
	        const catchLateralBrakeNeed = catchRelativeState
	          ? Math.max(
	            clamp((Number(catchRelativeState.lateralSpeedKmS) - 0.025) / 0.13, 0, 1),
	            clamp((Number(catchRelativeState.lateralRangeKm) - 0.12) / 1.0, 0, 1),
	          )
	          : 0;
	        const catchMissedCorridorNeed = catchRelativeState
	          ? clamp((Number(catchRelativeState.lateralRangeKm) - 1.0) / 4.0, 0, 1)
	          : 0;
	        mainThrustMinUpComponent = clamp(
	          0.88
	            - (0.10 * catchLateralBrakeNeed)
	            - (0.18 * catchMissedCorridorNeed),
	          0.86,
	          0.92,
	        );
      } else if (recoveryPhase === "landing-burn") {
        const landingLateralBrakeNeed = catchRelativeState
          ? Math.max(
            clamp((Number(catchRelativeState.lateralSpeedKmS) - 0.04) / 0.20, 0, 1),
            clamp((Number(catchRelativeState.lateralRangeKm) - 0.35) / 2.8, 0, 1),
          )
          : 0;
        const landingVerticalBrakeUrgency = catchRelativeState
          ? clamp((-Number(catchRelativeState.verticalSpeedKmS) - 0.18) / 0.42, 0, 1)
          : 1;
        const landingMissedCorridorNeed = catchRelativeState
          ? clamp((Number(catchRelativeState.lateralRangeKm) - 1.4) / 4.6, 0, 1)
          : 0;
        mainThrustMinUpComponent = clamp(
          0.92
            - (0.04 * landingLateralBrakeNeed)
            - (0.08 * landingMissedCorridorNeed * (1 - landingVerticalBrakeUrgency)),
          0.86,
          0.94,
        );
      }
	      direction = enforceMinimumUpComponent(
	        direction,
	        terminalUprightAxis,
	        mainThrustMinUpComponent,
	      );
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
    const terminalUprightAlignment = terminalUprightCommitActive
      ? clamp(dot(currentBoosterAxis, terminalUprightAxis), -1, 1)
      : 1;
    const terminalUprightErrorNorm = terminalUprightCommitActive
      ? clamp((1 - terminalUprightAlignment) / 0.5, 0, 1)
      : 0;
    const terminalUprightRateFloorDegS = strongTerminalUprightPhase
      ? (
        recoveryPhase === "landing-burn"
          || recoveryPhase.startsWith("catch-")
          || recoveryPhase === "caught"
          ? 5.5 + (8.5 * terminalUprightErrorNorm)
          : 7.5 + (10.5 * terminalUprightErrorNorm)
      )
      : 0;
    const effectiveAngularDampingPerS = terminalUprightCommitActive
      ? (Number(command.angularDampingPerS) || 0) + (0.20 * terminalUprightErrorNorm)
      : (Number(command.angularDampingPerS) || 0);
    const effectiveMaxBodyRateDegS = Number.isFinite(Number(command.maxBodyRateDegS))
      ? Math.max(Number(command.maxBodyRateDegS), terminalUprightRateFloorDegS)
      : terminalUprightRateFloorDegS;
    const effectiveMaxBodyRateRadS = effectiveMaxBodyRateDegS > 0
      ? rad(effectiveMaxBodyRateDegS)
      : null;
	    const effectiveAttitudeResponseScale = clamp(
	      (
	        Number(command.attitudeResponseScale) || 1
	      ) * (
        terminalUprightCommitActive
          ? 1 + (1.10 * terminalUprightErrorNorm)
          : 1
      ),
	      0.05,
	      7.2,
	    );
    const terminalLateralCommandSlewBoostActive = Boolean(
      terminalUprightCommitActive
      && catchRelativeState
      && altitudeKm > 3.0
      && Number(catchRelativeState.lateralRangeKm) > 0.45
      && Number(catchRelativeState.lateralSpeedKmS) > 0.12
      && (
        recoveryPhase === "terminal-intercept"
        || recoveryPhase === "catch-approach"
        || recoveryPhase === "landing-burn"
        || recoveryPhase === "catch-burn"
      )
    );
    const boosterActuatorConfig = terminalLateralCommandSlewBoostActive
      ? {
        ...LAUNCH_REALISM_CONFIG.actuator.booster,
        throttleRiseTauSec: recoveryPhase === "catch-burn"
          ? Math.min(Number(LAUNCH_REALISM_CONFIG.actuator.booster.throttleRiseTauSec) || 0.42, 0.18)
          : recoveryPhase === "landing-burn"
            ? Math.min(Number(LAUNCH_REALISM_CONFIG.actuator.booster.throttleRiseTauSec) || 0.42, 0.22)
          : LAUNCH_REALISM_CONFIG.actuator.booster.throttleRiseTauSec,
        throttleFallTauSec: recoveryPhase === "catch-approach"
          ? Math.min(Number(LAUNCH_REALISM_CONFIG.actuator.booster.throttleFallTauSec) || 0.30, 0.14)
          : LAUNCH_REALISM_CONFIG.actuator.booster.throttleFallTauSec,
        gimbalRateDegS: Math.max(
          Number(LAUNCH_REALISM_CONFIG.actuator.booster.gimbalRateDegS) || 0,
          recoveryPhase === "catch-burn" ? 38 : 34,
        ),
      }
      : LAUNCH_REALISM_CONFIG.actuator.booster;
	    runtime.boosterActuator = applyActuatorModel(runtime.boosterActuator, {
	      requestedThrottle: canBurn ? requestedThrottle : 0,
	      requestedDirection: direction,
	      dtSeconds,
	      config: boosterActuatorConfig,
	      massModel: runtime.boosterMassModel,
	      angularDampingPerS: effectiveAngularDampingPerS,
	      maxBodyRateRadS: effectiveMaxBodyRateRadS,
    });
    const throttleActual = clamp(Number(runtime.boosterActuator.throttleActual) || 0, 0, 1);
    const actuatedDirection = normalize(
      runtime.boosterActuator.directionActual,
      direction,
    );
    const poweredRecoveryAttitudeTracksGuidance = Boolean(
      recoveryPhase === "boostback"
      || recoveryPhase === "entry-burn"
    );
    const poweredTerminalAttitudeHoldsUpright = Boolean(
      catchRelativeState
      && (
        recoveryPhase === "landing-burn"
        || recoveryPhase === "catch-burn"
      )
      && terminalUprightCommitActive
    );
    const attitudeCommandDirection = (
      poweredTerminalAttitudeHoldsUpright
        ? terminalUprightAxis
        : (
          poweredRecoveryAttitudeTracksGuidance
          || throttleActual <= 0.005
          && (
            recoveryPhase === "separation-flip"
            || recoveryPhase === "separation-coast"
            || recoveryPhase === "hotstage-ring-jettison"
            || recoveryPhase === "boostback"
            || recoveryPhase === "descent-coast"
            || recoveryPhase === "terminal-intercept"
            || recoveryPhase === "catch-approach"
            || recoveryPhase === "landing-burn"
            || recoveryPhase === "catch-burn"
          )
        )
          ? direction
          : actuatedDirection
    );
    const physicalRecoveryTargetBlendFloor = (
      recoveryPhase === "separation-flip"
      || recoveryPhase === "separation-coast"
      || recoveryPhase === "hotstage-ring-jettison"
      || recoveryPhase === "boostback"
    )
      ? 0.985
      : 0;
    const attitudeTargetBlend = clamp(
      Math.max(
        terminalUprightCommitActive
          ? Math.max(
            Number(command.attitudeTargetBlend) || 1,
            strongTerminalUprightPhase
              ? 0.96 + (0.03 * terminalUprightErrorNorm)
              : 0.90 + (0.06 * terminalUprightErrorNorm),
          )
          : (Number(command.attitudeTargetBlend) || 1),
        physicalRecoveryTargetBlendFloor,
      ),
      0,
      1,
    );
    const desiredAttitudeDirection = attitudeTargetBlend < 0.999
      ? normalize(
        mixVectors(currentBoosterAxis, attitudeCommandDirection, attitudeTargetBlend),
        currentBoosterAxis,
      )
      : attitudeCommandDirection;
    const reportedRequestedDirection = (
      recoveryPhase === "separation-flip"
      || recoveryPhase === "separation-coast"
      || recoveryPhase === "hotstage-ring-jettison"
    )
      ? interpolateDirectionAlongArc(
        runtime.booster.separationAxisKm || currentBoosterAxis,
        direction,
        clamp((timeSinceSeparationSec - 0.75) / 18, 0, 1),
        up,
      )
      : desiredAttitudeDirection;
    const controlErrorsBody = computeBoosterAttitudeControlErrors({
      desiredDirection: desiredAttitudeDirection,
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
      desiredDirection: desiredAttitudeDirection,
      bodyAxisDirection: currentBoosterAxis,
      bodyAxesWorld,
      controlErrorsBody,
      omegaBodyRadS,
      massKg: Number(boosterState.massKg) || 0,
      massModel: runtime.boosterMassModel,
    });
    const boosterEngineConfig = boosterRecoveryConfigForPhase(
      command.phase || currentBoosterCommandPhase(),
      runtime.boosterEngineCountOverride,
    );
    const boosterEngineState = updateEngineCombustionClusterState(
      runtime.booster.combustion,
      {
        config: boosterEngineConfig,
        dtSeconds,
        pressurePa,
        throttleCommand: canBurn ? throttleActual : 0,
      },
    );
    const engineAngularControl = scaleAngularControlState(computeBoosterEngineAngularControlState({
      controlErrorsBody,
      omegaBodyRadS,
      pressurePa,
      throttle: throttleActual,
      massKg: Number(boosterState.massKg) || 0,
      massModel: runtime.boosterMassModel,
      engineState: boosterEngineState,
    }), effectiveAttitudeResponseScale);
    const rcsAngularControl = scaleAngularControlState(computeBoosterRcsAngularControlState({
      controlErrorsBody,
      omegaBodyRadS,
      controlAuthorityScale: runtime.boosterMassModel.controlAuthorityScale,
      aeroAuthority: gridFinControl.authority,
      throttle: requestedThrottle,
      massKg: Number(boosterState.massKg) || 0,
      massModel: runtime.boosterMassModel,
      phase: command.phase || currentBoosterCommandPhase(),
      guidanceMode: command.guidanceMode || runtime.booster.guidanceMode,
    }), effectiveAttitudeResponseScale);
    const thrustN = Math.max(0, Number(boosterEngineState.thrustN) || 0);
    const burnRateKgS = Math.max(0, Number(boosterEngineState.burnRateKgS) || 0);
    const burnKg = Math.min(burnablePropellantKg, burnRateKgS * dtSeconds);
    const burnKgAfterMain = Math.max(0, runtime.booster.propellantKg - burnKg);
    const effectiveMassKg = Math.max(
      MIN_ROCKET_MASS_KG,
      (Number(boosterState.massKg) || MIN_ROCKET_MASS_KG) - (0.5 * burnKg),
    );

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
    const predictiveTranslationAuthority = command.predictiveCatchControl?.enabled
      ? Number(command.predictiveCatchControl?.translationAuthority) || 0
      : 0;
	    const boosterRcs = computeBoosterRcsAssist({
	      desiredDirection: direction,
      translationDirection: predictiveTranslationAuthority > 0
        ? predictiveCatchTranslationDirection(catchRelativeState, command.predictiveCatchControl)
        : null,
      translationAuthority: predictiveTranslationAuthority,
      currentDirection: currentBoosterAxis,
      relVel,
      up,
      throttle: throttleActual,
      phase: command.phase || currentBoosterCommandPhase(),
      guidanceMode: command.guidanceMode || runtime.booster.guidanceMode,
      controlAuthorityScale: runtime.boosterMassModel.controlAuthorityScale,
	      aeroAuthority: Number(gridFinControl.authority) || 0,
	    });
	    const angularRcsThrusterIndices = Array.isArray(rcsAngularControl?.jetIndices)
	      ? rcsAngularControl.jetIndices
	      : [];
	    const desiredRcsThrusterIndices = Array.from(new Set([
	      ...(
	        Array.isArray(boosterRcs?.jetIndices)
	          ? boosterRcs.jetIndices
	          : []
	      ),
	      ...angularRcsThrusterIndices,
	    ]));
	    const rcsCommandAuthority = clamp(
	      Math.max(
	        Number(boosterRcs.linearAuthority) || 0,
	        Number(boosterRcs.authority) || 0,
	        Number(rcsAngularControl.authority) || 0,
	      ),
	      0,
	      1,
	    );
	    runtime.booster.rcsCombustion = updateEngineCombustionClusterState(
	      runtime.booster.rcsCombustion,
	      {
	        config: boosterRcsCombustionConfig(),
	        dtSeconds,
	        pressurePa,
	        throttleCommand: rcsAuthorityAllowed && burnKgAfterMain > 1e-9
	          ? rcsCommandAuthority
	          : 0,
	        desiredEngineIndices: rcsAuthorityAllowed && burnKgAfterMain > 1e-9
	          ? desiredRcsThrusterIndices
	          : [],
	      },
	    );
	    const boosterRcsAvailability = desiredRcsThrusterIndices.length > 0 && runtime.booster.rcsCombustion.desiredCount > 0
	      ? clamp(
        (Number(runtime.booster.rcsCombustion.thrustN) || 0)
          / Math.max(
            1e-6,
            (Number(runtime.booster.rcsCombustion.fullPerEngineThrustN) || 0)
              * Math.max(1, Number(runtime.booster.rcsCombustion.desiredCount) || 0),
          ),
        0,
        1,
      )
      : 0;
    const effectiveRcsAngularControl = scaleAngularControlState(
      rcsAngularControl,
      boosterRcsAvailability,
    );
    const relAirDirection = normalize(aeroPreview.relAirVelocityKmS || scale(relVel, -1), currentBoosterAxis);
    const aeroAxis = unitOrNull(cross(currentBoosterAxis, relAirDirection));
    const aeroTorqueSignedNm =
      (Number(aeroPreview.dynamicPressurePa) || 0)
      * Math.max(0, Number(LAUNCH_BOOSTER_CONFIG.referenceAreaM2) || 0)
      * boosterBodyLengthMeters()
      * (-(Number(aeroPreview.momentCoefficient) || 0));
    const engineAsymmetryBodyTorqueNm = computeEngineClusterBodyTorqueNm({
      descriptors: boosterEngineState.descriptors,
      activeDescriptors: boosterEngineState.activeDescriptors,
      activeIndices: boosterEngineState.activeIndices,
      engineThrustNByIndex: boosterEngineState.engineThrustNByIndex,
      activeEngineThrustsN: boosterEngineState.activeEngineThrustsN,
      fallbackPerEngineThrustN: (Number(boosterEngineState.thrustN) || 0)
        / Math.max(1, Number(boosterEngineState.activeCount) || 0),
      forceDirectionBody: { x: 0, y: 1, z: 0 },
      fallbackY: -boosterBodyLengthMeters() * 0.46,
    });
    const engineAsymmetryMomentNm = Math.hypot(
      Number(engineAsymmetryBodyTorqueNm.x) || 0,
      Number(engineAsymmetryBodyTorqueNm.z) || 0,
    );
    let totalBodyTorqueNm = add(
      add(
        gridFinControl.bodyTorqueNm || { x: 0, y: 0, z: 0 },
        engineAngularControl.bodyTorqueNm || { x: 0, y: 0, z: 0 },
      ),
      add(
        effectiveRcsAngularControl.bodyTorqueNm || { x: 0, y: 0, z: 0 },
        engineAsymmetryBodyTorqueNm,
      ),
    );
    const aeroTorqueActive = Boolean(aeroAxis && Math.abs(aeroTorqueSignedNm) > 1e-6);
    const attitudeTorqueSources = [
      length(gridFinControl.bodyTorqueNm || { x: 0, y: 0, z: 0 }) > 1e-6 ? "grid-fins" : null,
      length(engineAngularControl.bodyTorqueNm || { x: 0, y: 0, z: 0 }) > 1e-6 ? "engine-gimbal" : null,
      length(effectiveRcsAngularControl.bodyTorqueNm || { x: 0, y: 0, z: 0 }) > 1e-6 ? "rcs-thrusters" : null,
      engineAsymmetryMomentNm > 1e-6 ? "engine-asymmetry" : null,
      aeroTorqueActive ? "aero-moment" : null,
    ].filter(Boolean);
    const attitudeTorqueSourceText = attitudeTorqueSources.length > 0
      ? attitudeTorqueSources.join(" + ")
      : "none";
    let totalTorqueWorldNm = rotateVectorByQuaternion(
      totalBodyTorqueNm,
      runtime.booster.attitude?.orientation || quaternionIdentity(),
    );
    if (aeroTorqueActive) {
      totalTorqueWorldNm = add(totalTorqueWorldNm, scale(aeroAxis, aeroTorqueSignedNm));
    }
    runtime.booster.attitude = integrateBoosterAttitudeState(runtime.booster.attitude, {
      torqueWorldNm: totalTorqueWorldNm,
      massKg: Number(boosterState.massKg) || 0,
      inertiaNormalized: runtime.boosterMassModel?.inertiaNormalized,
      angularDampingPerS: effectiveAngularDampingPerS,
      maxBodyRateRadS: effectiveMaxBodyRateRadS,
      dtSeconds,
    });
    const directionActual = boosterBodyAxisWorld(runtime.booster.attitude);
    runtime.boosterActuator.directionCommand = normalize(direction, directionActual);
    runtime.boosterActuator.directionActual = directionActual;
    runtime.boosterActuator.gimbalErrorDeg = degrees(angleBetweenRadians(directionActual, direction));
    runtime.boosterActuator.angularRateRadS = length(runtime.booster.attitude?.omegaBodyRadS || { x: 0, y: 0, z: 0 });
    const accelerationMagKmS2 = thrustN > 0
      ? (thrustN / effectiveMassKg) / 1000
      : 0;
    const boosterEngineGimbalLimitDeg = Math.max(
      0,
      Number(LAUNCH_REALISM_CONFIG.actuator?.booster?.maxGimbalDeflectionDeg) || 0,
    );
    const terminalVectoringBoostDeg = (
      catchRelativeState
      && (
        recoveryPhase === "catch-burn"
        || recoveryPhase === "landing-burn"
      )
      && Number(catchRelativeState.lateralSpeedKmS) > 0.02
    )
      ? clamp(
        recoveryPhase === "landing-burn"
          ? (
            6.0
              + (4.5 * Math.min(Number(catchRelativeState.lateralRangeKm) || 0, 3.0))
              + (16.0 * clamp((Number(catchRelativeState.lateralSpeedKmS) || 0) / 0.22, 0, 1))
          )
	          : (
	            3.0
	              + (3.5 * Math.min(Number(catchRelativeState.lateralRangeKm) || 0, 2.4))
	              + (12.0 * clamp((Number(catchRelativeState.lateralSpeedKmS) || 0) / 0.18, 0, 1))
	          ),
	        recoveryPhase === "landing-burn" ? 6 : 2,
	        recoveryPhase === "landing-burn" ? 28 : 26,
      )
      : 0;
    const terminalEngineGimbalLimitDeg = (
      recoveryPhase === "catch-burn"
      || recoveryPhase === "landing-burn"
    )
	      ? Math.min(
	        boosterEngineGimbalLimitDeg + terminalVectoringBoostDeg,
	        recoveryPhase === "landing-burn" ? 34 : 34,
	      )
      : boosterEngineGimbalLimitDeg;
    const thrustVectorDirectionActual = accelerationMagKmS2 > 0
      ? limitDirectionOffAxis(
        direction,
        directionActual,
        rad(terminalEngineGimbalLimitDeg),
      )
      : directionActual;
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
    const activeRcsThrusterIndices = Array.isArray(runtime.booster.rcsCombustion?.activeIndices)
      ? [...runtime.booster.rcsCombustion.activeIndices]
      : [];
    const activeRcsJets = activeRcsThrusterIndices
      .map((index) => String(runtime.booster.rcsCombustion?.descriptors?.[index]?.id || BOOSTER_RCS_THRUSTER_IDS[index] || ""))
      .filter(Boolean);
    let rcsBurnRateKgS = burnKgAfterMain > 1e-9
      ? Math.max(0, Number(runtime.booster.rcsCombustion?.burnRateKgS) || 0)
      : 0;
    const rcsBurnKg = Math.min(burnKgAfterMain, rcsBurnRateKgS * dtSeconds);
    const boosterRcsDirection = unitOrNull(
      boosterRcs.correctionDir || boosterRcs.accelerationKmS2,
    );
    const boosterRcsActive = Boolean(
      rcsAuthorityAllowed
      && boosterRcsDirection
      && activeRcsThrusterIndices.length > 0
      && rcsBurnKg > 1e-12,
    );
    if (!boosterRcsActive) {
      rcsBurnRateKgS = 0;
    }
    const boosterRcsAccelerationKmS2 = boosterRcsActive
      ? scale(
        boosterRcsDirection,
        (Math.max(0, Number(runtime.booster.rcsCombustion?.thrustN) || 0) / effectiveMassKg) / 1000,
      )
      : { x: 0, y: 0, z: 0 };
    const recoveryHardwareState = resolveBoosterRecoveryHardwareState({
      phase: recoveryPhase,
      guidanceMode: command.guidanceMode || runtime.booster.guidanceMode,
      attitudeControlMode: command.attitudeControlMode,
      gridFinAuthority: Number(gridFinControl.authority) || 0,
      gridFinDeflectionDeg: Number(gridFinControl.deflectionDeg) || 0,
      gridFinMaxDeflectionDeg: Number(gridFinControl.maxDeflectionDeg) || 0,
      gridFinStates: Array.isArray(gridFinControl.finStates)
        ? gridFinControl.finStates.map((finState) => ({ ...finState }))
        : [],
      dynamicPressurePa: Number(aero.dynamicPressurePa) || dynamicPressurePa,
      throttle: throttleActual,
      requestedThrottle,
      desiredEngineCount: boosterEngineState.desiredCount,
      activeEngineCount: boosterEngineState.activeCount,
      towerRelativeActive: Boolean(navigationSolution?.towerRelativeActive),
      catchPositionSigmaKm: navigationSolution?.catchPositionSigmaKm,
      catchVelocitySigmaKmS: navigationSolution?.catchVelocitySigmaKmS,
      catchCommitEligible: Boolean(command.phase === "catch-burn" || command.phase === "catch-approach"),
      catchCaptureActive: Boolean(runtime.booster.capture?.active),
    });
    runtime.booster.lastStep = {
      accelerationKmS2: add(
        add(scale(thrustVectorDirectionActual, accelerationMagKmS2), aero.accelerationKmS2),
        boosterRcsAccelerationKmS2,
      ),
      throttle: throttleActual,
      throttleCommand: requestedThrottle,
      thrustN,
      activeEngineIndices: [...boosterEngineState.activeIndices],
      activeEngineCount: boosterEngineState.activeCount,
      desiredEngineCount: boosterEngineState.desiredCount,
      failedEngineIndices: Array.isArray(boosterEngineState.failedIndices)
        ? [...boosterEngineState.failedIndices]
        : [],
      faultedEngineIndices: Array.isArray(boosterEngineState.faultedIndices)
        ? [...boosterEngineState.faultedIndices]
        : [],
      flamePresentIndices: Array.isArray(boosterEngineState.flamePresentIndices)
        ? [...boosterEngineState.flamePresentIndices]
        : [],
      chamberPressurePaByIndex: Array.isArray(boosterEngineState.chamberPressurePaByIndex)
        ? [...boosterEngineState.chamberPressurePaByIndex]
        : [],
      exhaustTemperatureKByIndex: Array.isArray(boosterEngineState.exhaustTemperatureKByIndex)
        ? [...boosterEngineState.exhaustTemperatureKByIndex]
        : [],
      combustionEfficiencyByIndex: Array.isArray(boosterEngineState.combustionEfficiencyByIndex)
        ? [...boosterEngineState.combustionEfficiencyByIndex]
        : [],
      turbopumpNormByIndex: Array.isArray(boosterEngineState.turbopumpNormByIndex)
        ? [...boosterEngineState.turbopumpNormByIndex]
        : [],
      engineThrustNByIndex: Array.isArray(boosterEngineState.engineThrustNByIndex)
        ? [...boosterEngineState.engineThrustNByIndex]
        : [],
      burnKg,
      burnRateKgS,
      ...combustionSummaryFields(boosterEngineState),
      rcsBurnKg,
      rcsBurnRateKgS,
      dynamicPressurePa: aero.dynamicPressurePa,
      requestedDirectionKm: cloneVectorOrNull(reportedRequestedDirection),
      bodyAxisDirectionKm: cloneVectorOrNull(directionActual),
      mainThrustDirectionKm: accelerationMagKmS2 > 0
        ? cloneVectorOrNull(thrustVectorDirectionActual)
        : null,
      requestedThrustVerticalComponent: dot(direction, terminalUprightAxis),
      mainThrustVerticalComponent: accelerationMagKmS2 > 0
        ? dot(thrustVectorDirectionActual, terminalUprightAxis)
        : 0,
      mainThrustMinUpComponent,
      mainThrustVerticalFloorActive: poweredMainThrustFloorActive,
      bodyRetrogradeAlignment,
      bodyAntiTangentAlignment,
      bodyUpAlignment,
      predictiveCatchActive: Boolean(command.predictiveCatchControl?.enabled),
      catchInterceptTimeSec: Number(command.predictiveCatchControl?.interceptTimeSec) || 0,
      catchGuidanceBlend: Number(command.predictiveCatchControl?.blend) || 0,
      catchPredictedLateralMissKm: Number(command.predictiveCatchControl?.predictedLateralMissKm) || 0,
      catchPredictedVerticalMissKm: Number(command.predictiveCatchControl?.predictedVerticalMissKm) || 0,
      catchPredictedTotalMissKm: Number(command.predictiveCatchControl?.predictedTotalMissKm) || 0,
      catchDesiredEastSpeedKmS: Number(command.predictiveCatchControl?.desiredEastSpeedKmS) || 0,
      catchDesiredNorthSpeedKmS: Number(command.predictiveCatchControl?.desiredNorthSpeedKmS) || 0,
      catchDesiredVerticalSpeedKmS: Number(command.predictiveCatchControl?.desiredVerticalSpeedKmS) || 0,
      guidanceMode: throttleActual <= 0 && !landingPhase && stageReservePropellantKg(0) > 0
        ? `${runtime.booster.guidanceMode}+reserve-hold`
        : runtime.booster.guidanceMode,
      terminalUprightCommit: Boolean(command.terminalUprightCommit),
      uprightTiltLimitDeg: Number(command.uprightTiltLimitDeg) || 0,
      touchdownReady: Boolean(command.touchdownReady),
      rcsActive: boosterRcsActive,
      rcsErrorDeg: boosterRcs.errorDeg,
      rcsAuthority: boosterRcsAvailability * clamp(Number(boosterRcs.authority) || 0, 0, 1),
      rcsAccelerationKmS2: boosterRcsAccelerationKmS2,
      rcsAccelerationMagKmS2: length(boosterRcsAccelerationKmS2),
      mainEngineAuthorityActive,
      rcsAuthorityAllowed,
      rcsJets: boosterRcsActive ? activeRcsJets : [],
      rcsActiveThrusterIndices: boosterRcsActive ? activeRcsThrusterIndices : [],
      rcsFailedThrusterIndices: Array.isArray(runtime.booster.rcsCombustion?.failedIndices)
        ? [...runtime.booster.rcsCombustion.failedIndices]
        : [],
      rcsFaultedThrusterIndices: Array.isArray(runtime.booster.rcsCombustion?.faultedIndices)
        ? [...runtime.booster.rcsCombustion.faultedIndices]
        : [],
      rcsFlamePresentThrusterIndices: Array.isArray(runtime.booster.rcsCombustion?.flamePresentIndices)
        ? [...runtime.booster.rcsCombustion.flamePresentIndices]
        : [],
      rcsChamberPressurePaByIndex: Array.isArray(runtime.booster.rcsCombustion?.chamberPressurePaByIndex)
        ? [...runtime.booster.rcsCombustion.chamberPressurePaByIndex]
        : [],
      rcsExhaustTemperatureKByIndex: Array.isArray(runtime.booster.rcsCombustion?.exhaustTemperatureKByIndex)
        ? [...runtime.booster.rcsCombustion.exhaustTemperatureKByIndex]
        : [],
      rcsCombustionEfficiencyByIndex: Array.isArray(runtime.booster.rcsCombustion?.combustionEfficiencyByIndex)
        ? [...runtime.booster.rcsCombustion.combustionEfficiencyByIndex]
        : [],
      rcsTurbopumpNormByIndex: Array.isArray(runtime.booster.rcsCombustion?.turbopumpNormByIndex)
        ? [...runtime.booster.rcsCombustion.turbopumpNormByIndex]
        : [],
      rcsThrusterThrustNByIndex: Array.isArray(runtime.booster.rcsCombustion?.engineThrustNByIndex)
        ? [...runtime.booster.rcsCombustion.engineThrustNByIndex]
        : [],
      rcsAvgChamberPressurePa: Number(runtime.booster.rcsCombustion?.avgChamberPressurePa) || 0,
      rcsMaxChamberPressurePa: Number(runtime.booster.rcsCombustion?.maxChamberPressurePa) || 0,
      rcsAvgCombustionEfficiency: Number(runtime.booster.rcsCombustion?.avgCombustionEfficiency) || 0,
      rcsAvgTurbopumpNorm: Number(runtime.booster.rcsCombustion?.avgTurbopumpNorm) || 0,
      rcsMaxExhaustTemperatureK: Number(runtime.booster.rcsCombustion?.maxExhaustTemperatureK) || 0,
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
      gridFinStates: Array.isArray(gridFinControl.finStates)
        ? gridFinControl.finStates.map((finState) => ({
          name: String(finState?.name || ""),
          deflectionDeg: Number(finState?.deflectionDeg) || 0,
          dynamicPressurePa: Number(finState?.dynamicPressurePa) || 0,
          effectiveness: Number(finState?.effectiveness) || 0,
        }))
        : [],
      ...recoveryHardwareState,
      engineAsymmetryBodyTorqueNm: cloneVectorOrNull(engineAsymmetryBodyTorqueNm),
      engineAsymmetryMomentNm,
      aeroMomentNm: Math.abs(aeroTorqueSignedNm),
      engineAngularAccelerationRadS2: Number(engineAngularControl.angularAccelerationRadS2) || 0,
      rcsAngularAccelerationRadS2: Number(effectiveRcsAngularControl.angularAccelerationRadS2) || 0,
      attitudeTorqueSources,
      attitudeTorqueSourceText,
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
      runtime.booster.telemetry.catchLateralRangeKm = finiteOrNull(catchRelativeState?.lateralRangeKm);
      runtime.booster.telemetry.catchVerticalErrorKm = finiteOrNull(catchRelativeState?.verticalErrorKm);
      runtime.booster.telemetry.catchLateralSpeedKmS = finiteOrNull(catchRelativeState?.lateralSpeedKmS);
      runtime.booster.telemetry.catchVerticalSpeedKmS = finiteOrNull(catchRelativeState?.verticalSpeedKmS);
      runtime.booster.telemetry.catchTotalRangeKm = finiteOrNull(catchRelativeState?.totalRangeKm);
      runtime.booster.telemetry.catchEastErrorKm = finiteOrNull(catchRelativeState?.eastErrorKm);
      runtime.booster.telemetry.catchNorthErrorKm = finiteOrNull(catchRelativeState?.northErrorKm);
      runtime.booster.telemetry.catchEastSpeedKmS = finiteOrNull(catchRelativeState?.eastSpeedKmS);
      runtime.booster.telemetry.catchNorthSpeedKmS = finiteOrNull(catchRelativeState?.northSpeedKmS);
    }
  }

  function finalizeBoosterStep(state, dtSeconds, nowMs = Date.now()) {
    if (!runtime.booster.active && !runtime.booster.landed && !runtime.booster.crashed) {
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
    const separationContact = applyBoosterShipSeparationContact({
      state,
      boosterState,
      dtSeconds,
    });

    const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371.0084;
    const currentEarthAxes = earthAxes(nowMs);
    const caughtSupportLocked = Boolean(
      runtime.booster.landed
      && String(runtime.booster.terminalOutcome || "") === "caught",
    );
    if (caughtSupportLocked) {
      const supportedCatchFrame = computeLaunchSiteCatchFrame({
        earthState,
        earthRadiusKm,
        earthAxes: currentEarthAxes,
      });
      if (supportedCatchFrame?.centerPosition && supportedCatchFrame?.centerVelocity) {
        const supportedUpAxis = normalize(
          supportedCatchFrame.surfaceNormal || subtract(supportedCatchFrame.centerPosition, earthState.position),
          currentEarthAxes.pole,
        );
        boosterState.position = composeCatchFramePosition(
          supportedCatchFrame,
          runtime.booster.catchSupportOffsetKm,
        ) || { ...supportedCatchFrame.centerPosition };
        boosterState.velocity = { ...supportedCatchFrame.centerVelocity };
        const supportedBodyAxis = unitOrNull(boosterBodyAxisWorld(runtime.booster.attitude))
          || supportedUpAxis;
        setBoosterCommandPhase("caught");
        runtime.booster.guidanceMode = "booster-caught";
        runtime.booster.lastStep = caughtBoosterStep(supportedBodyAxis);
      }
    }
    const relPosBeforeContact = subtract(boosterState.position, earthState.position);
    const relVelBeforeContact = subtract(
      boosterState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    const preContactSurfaceSample = sampleEarthSurfaceAtRelativePosition(
      relPosBeforeContact,
      currentEarthAxes,
      earthRadiusKm,
      { includeTerrain: true },
    );
    const preContactUp = normalize(
      preContactSurfaceSample?.surfaceNormal || relPosBeforeContact,
      currentEarthAxes.pole,
    );
    const preContactGroundVelocityKmS = atmosphereRelativeVelocityKmS(
      relPosBeforeContact,
      relVelBeforeContact,
      currentEarthAxes.pole,
    );
    const preContactGroundSpeedKmS = length(preContactGroundVelocityKmS);
    const preContactVerticalSpeedKmS = dot(preContactGroundVelocityKmS, preContactUp);
    const preContactLateralSpeedKmS = Math.sqrt(Math.max(
      0,
      (preContactGroundSpeedKmS * preContactGroundSpeedKmS)
        - (preContactVerticalSpeedKmS * preContactVerticalSpeedKmS),
    ));
    const preContactAltitudeAboveTerrainKm = Number(preContactSurfaceSample?.altitudeAboveTerrainKm);
    const preContactBodyAboveTerrainKm = Number.isFinite(preContactAltitudeAboveTerrainKm)
      ? preContactAltitudeAboveTerrainKm - BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM
      : Number.POSITIVE_INFINITY;
    if (runtime.booster.crashed) {
      resolveBoosterCrashDynamicsStep({
        boosterState,
        earthState,
        currentEarthAxes,
        earthRadiusKm,
        dtSeconds,
        nowMs,
      });
      return;
    }
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
    const upNow = normalize(
      runtime.booster.lastSurfaceSample?.surfaceNormal || relPosNow,
      currentEarthAxes.pole,
    );
    const groundVelocityNowKmS = atmosphereRelativeVelocityKmS(
      relPosNow,
      relVelNow,
      currentEarthAxes.pole,
    );
    const groundSpeedKmS = length(groundVelocityNowKmS);
    const radialSpeedKmS = dot(groundVelocityNowKmS, upNow);
    const lateralSpeedKmS = Math.sqrt(Math.max(
      0,
      (groundSpeedKmS * groundSpeedKmS) - (radialSpeedKmS * radialSpeedKmS),
    ));
    const altitudeKm = Math.max(0, length(relPosNow) - earthRadiusKm);
    const terrainAltKm = Number(runtime.booster.lastSurfaceSample?.altitudeAboveTerrainKm);
    const centerAboveTerrainKm = Number.isFinite(terrainAltKm) ? terrainAltKm : altitudeKm;
    const bodyAboveTerrainKm = centerAboveTerrainKm - BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM;
    const boosterAxisNow = boosterBodyAxisWorld(runtime.booster.attitude);
    const bodyUpAlignmentNow = clamp(dot(boosterAxisNow, upNow), -1, 1);
    const boosterBodyRateRadS = length(runtime.booster.attitude?.omegaBodyRadS || { x: 0, y: 0, z: 0 });
    const surfaceContactDetected = Boolean(
      contact?.corrected
      || contact?.contact
      || preContactBodyAboveTerrainKm <= BOOSTER_TOUCHDOWN_LIMITS.contactBandKm
      || bodyAboveTerrainKm <= BOOSTER_TOUCHDOWN_LIMITS.contactBandKm,
    );
    const impactSpeedKmS = surfaceContactDetected
      ? Math.max(preContactGroundSpeedKmS, groundSpeedKmS)
      : groundSpeedKmS;
    const impactVerticalSpeedKmS = Math.abs(preContactVerticalSpeedKmS) >= Math.abs(radialSpeedKmS)
      ? preContactVerticalSpeedKmS
      : radialSpeedKmS;
    const impactDownwardSpeedKmS = Math.max(
      0,
      -Math.min(preContactVerticalSpeedKmS, radialSpeedKmS),
    );
    const impactLateralSpeedKmS = surfaceContactDetected
      ? Math.max(preContactLateralSpeedKmS, lateralSpeedKmS)
      : lateralSpeedKmS;
    const boosterGuidanceText = `${String(runtime.booster.guidanceMode || "")} ${String(currentBoosterCommandPhase())}`.toLowerCase();
    const touchdownPhaseReady = (
      !boosterGuidanceText.includes("catch")
      && (
        boosterGuidanceText.includes("landing-burn")
        || boosterGuidanceText.includes("landed")
      )
    );
    const safeSurfaceTouchdown = (
      surfaceContactDetected
      && touchdownPhaseReady
      && impactSpeedKmS <= BOOSTER_TOUCHDOWN_LIMITS.maxSpeedKmS
      && impactDownwardSpeedKmS <= BOOSTER_TOUCHDOWN_LIMITS.maxDownwardSpeedKmS
      && impactLateralSpeedKmS <= BOOSTER_TOUCHDOWN_LIMITS.maxLateralSpeedKmS
      && bodyUpAlignmentNow >= BOOSTER_TOUCHDOWN_LIMITS.minBodyUpAlignment
    );
    if (surfaceContactDetected && !runtime.booster.landed && !safeSurfaceTouchdown) {
      const impactReason = !touchdownPhaseReady
        ? "surface-impact-outside-landing-burn"
        : bodyUpAlignmentNow < BOOSTER_TOUCHDOWN_LIMITS.minBodyUpAlignment
          ? "surface-impact-attitude"
          : impactDownwardSpeedKmS > BOOSTER_TOUCHDOWN_LIMITS.maxDownwardSpeedKmS
            ? "surface-impact-vertical-speed"
            : impactLateralSpeedKmS > BOOSTER_TOUCHDOWN_LIMITS.maxLateralSpeedKmS
              ? "surface-impact-lateral-speed"
              : "surface-impact-speed";
      markBoosterCrashed({
        boosterState,
        earthState,
        currentEarthAxes,
        earthRadiusKm,
        nowMs,
        reason: impactReason,
        impactSpeedKmS,
        impactVerticalSpeedKmS,
        impactLateralSpeedKmS,
        impactBodyUpAlignment: bodyUpAlignmentNow,
      });
      return;
    }
    if (safeSurfaceTouchdown) {
      runtime.booster.contactHoldSec += Math.max(0, dtSeconds);
    } else {
      runtime.booster.contactHoldSec = 0;
    }
    if (runtime.booster.contactHoldSec >= BOOSTER_TOUCHDOWN_LIMITS.holdSec) {
      runtime.booster.landed = true;
      runtime.booster.crashed = false;
      runtime.booster.terminalOutcome = "landed";
      runtime.booster.terminalReason = "surface-touchdown";
      runtime.booster.impactSpeedKmS = impactSpeedKmS;
      runtime.booster.impactVerticalSpeedKmS = impactVerticalSpeedKmS;
      runtime.booster.impactLateralSpeedKmS = impactLateralSpeedKmS;
      runtime.booster.impactBodyUpAlignment = bodyUpAlignmentNow;
      runtime.booster.crashDynamics = resetBoosterCrashDynamicsState(runtime.booster.crashDynamics);
      runtime.booster.capture = resetBoosterCatchCaptureState(runtime.booster.capture);
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
    const launchSiteLateralClosingSpeedKmS = dot(relVelocityToPad, launchSiteLateralDirection);
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
    let catchRelativeState = navigationSolution?.catchRelativeState
      || (
        catchFrame
          ? computeBoosterCatchRelativeState({
            boosterState: guidanceBoosterState,
            catchFrame,
          })
          : null
      );
    let catchPinHeightErrorKm = Number.isFinite(Number(catchRelativeState?.verticalErrorKm))
      ? Number(catchRelativeState.verticalErrorKm)
      : computeBoosterCatchPinHeightErrorKm(bodyAboveTerrainKm);
    const catchGuidanceActive = !caughtSupportLocked
      && String(runtime.booster.guidanceMode || "").startsWith("booster-catch");
    const catchAlignmentEligible = shouldFinalizeBoosterCatch({
      guidanceMode: runtime.booster.guidanceMode,
      launchSiteLateralRangeKm: catchRelativeState?.lateralRangeKm ?? catchCenterLateralRangeKm,
      catchVerticalErrorKm: catchRelativeState?.verticalErrorKm,
      catchPinHeightErrorKm,
      speedKmS: catchRelativeState?.totalSpeedKmS ?? speedKmS,
      radialSpeedKmS: catchRelativeState?.verticalSpeedKmS ?? radialSpeedKmS,
      bodyUpAlignment: bodyUpAlignmentNow,
      bodyAngularRateRadS: boosterBodyRateRadS,
      catchHoldSec: Number.POSITIVE_INFINITY,
    });
    const catchMechanicalEnvelopeEligible = shouldFinalizeBoosterCatch({
      guidanceMode: runtime.booster.guidanceMode,
      launchSiteLateralRangeKm: catchRelativeState?.lateralRangeKm ?? catchCenterLateralRangeKm,
      catchVerticalErrorKm: catchRelativeState?.verticalErrorKm,
      catchPinHeightErrorKm,
      speedKmS: catchRelativeState?.totalSpeedKmS ?? speedKmS,
      radialSpeedKmS: catchRelativeState?.verticalSpeedKmS ?? radialSpeedKmS,
      bodyUpAlignment: 1,
      bodyAngularRateRadS: 0,
      catchHoldSec: Number.POSITIVE_INFINITY,
    });
    const catchCapture = runtime.booster.capture || createBoosterCatchCaptureState();
    runtime.booster.capture = catchCapture;
    const boosterAxesNow = boosterBodyAxesWorld(runtime.booster.attitude);
    const boosterOmegaWorldRadS = rotateVectorByQuaternion(
      runtime.booster.attitude?.omegaBodyRadS || { x: 0, y: 0, z: 0 },
      runtime.booster.attitude?.orientation || quaternionIdentity(),
    );
    const catchPointContactResult = (
      catchGuidanceActive
      && catchFrame
      && catchRelativeState
    )
      ? queryBoosterCatchPointContacts({
        boosterState,
        bodyAxesWorld: boosterAxesNow,
        omegaWorldRadS: boosterOmegaWorldRadS,
        earthState,
        earthAxes: currentEarthAxes,
      })
      : null;
    const catchPointContactEligible = Boolean(catchPointContactResult?.captureEligible);
    const launchSiteObjectContactResult = (
      catchGuidanceActive
      && !catchMechanicalEnvelopeEligible
      && !catchCapture.active
    )
      ? queryLaunchSiteObjectContacts({
        boosterState,
        bodyAxisKm: boosterAxisNow,
        earthState,
        earthAxes: currentEarthAxes,
        includeChopsticks: true,
        includeTower: true,
      })
      : null;
    const primaryLaunchSiteObjectContact =
      launchSiteObjectContactResult?.contacts?.[0] || null;
    const primaryLaunchSiteObjectContactRole = String(
      primaryLaunchSiteObjectContact?.metadata?.role || "",
    );
    const cleanChopstickContactCandidate = Boolean(
      primaryLaunchSiteObjectContactRole.includes("chopstick")
      && catchRelativeState
      && catchPointContactEligible
      && (Number(catchRelativeState.lateralRangeKm) || 0)
        <= BOOSTER_CATCH_GEOMETRY_KM.finalizeLateralToleranceKm
      && (Number(catchRelativeState.totalSpeedKmS) || 0) <= 0.045
    );
    const launchSiteObjectContactCandidate = Boolean(
      primaryLaunchSiteObjectContact
      && Number(primaryLaunchSiteObjectContact.normalSpeedKmS) < -0.0015
      && !cleanChopstickContactCandidate
    );
    const catchTowerGrazeCandidate = Boolean(
      catchGuidanceActive
      && !catchMechanicalEnvelopeEligible
      && !catchCapture.active
      && catchFrame
      && catchRelativeState
      && bodyAboveTerrainKm <= 0.20
      && Math.abs(Number(catchRelativeState.verticalErrorKm) || 0) <= BOOSTER_CATCH_GEOMETRY_KM.finalizePinHeightToleranceKm
      && (Number(catchRelativeState.lateralRangeKm) || 0) <= 0.075
      && (
        (Number(catchRelativeState.lateralRangeKm) || 0) > 0.026
        || (Number(catchRelativeState.totalSpeedKmS) || 0) > 0.020
      )
    );
    const catchAttitudeMissCandidate = Boolean(
      catchGuidanceActive
      && !catchCapture.active
      && catchFrame
      && catchRelativeState
      && bodyAboveTerrainKm <= 0.20
      && Math.abs(Number(catchRelativeState.verticalErrorKm) || 0) <= BOOSTER_CATCH_GEOMETRY_KM.finalizePinHeightToleranceKm
      && (Number(catchRelativeState.lateralRangeKm) || 0) <= 0.075
      && (
        bodyUpAlignmentNow < BOOSTER_CATCH_GEOMETRY_KM.missBodyUpAlignmentMin
        || boosterBodyRateRadS > BOOSTER_CATCH_GEOMETRY_KM.missBodyRateRadSMax
      )
    );
    if (launchSiteObjectContactCandidate || catchTowerGrazeCandidate || catchAttitudeMissCandidate) {
      const contactRole = primaryLaunchSiteObjectContactRole;
      const contactRelativeSpeedKmS = primaryLaunchSiteObjectContact
        ? length(primaryLaunchSiteObjectContact.relativeVelocityKmS || { x: 0, y: 0, z: 0 })
        : null;
      const objectImpactReason = contactRole.includes("chopstick")
        ? "chopstick-graze"
        : contactRole.includes("tower")
          ? "tower-strike"
          : "launch-site-object-contact";
      const impulseDirection = contactImpulseDirection(primaryLaunchSiteObjectContact)
        || unitOrNull(catchRelativeState?.lateralPositionKm)
        || unitOrNull(catchRelativeState?.lateralVelocityKmS)
        || unitOrNull(catchCenterLateralVector)
        || unitOrNull(cross(upNow, currentEarthAxes.pole))
        || { x: 1, y: 0, z: 0 };
      markBoosterCrashed({
        boosterState,
        earthState,
        currentEarthAxes,
        earthRadiusKm,
        nowMs,
        reason: launchSiteObjectContactCandidate
          ? objectImpactReason
          : catchAttitudeMissCandidate
            ? "catch-attitude-miss"
            : "tower-graze",
        impactSpeedKmS: launchSiteObjectContactCandidate
          ? contactRelativeSpeedKmS
          : catchRelativeState.totalSpeedKmS,
        impactVerticalSpeedKmS: catchRelativeState?.verticalSpeedKmS,
        impactLateralSpeedKmS: catchRelativeState?.lateralSpeedKmS
          ?? primaryLaunchSiteObjectContact?.tangentSpeedKmS,
        impactBodyUpAlignment: bodyUpAlignmentNow,
        impactImpulseDirectionKm: impulseDirection,
      });
      return;
    }
    if (catchGuidanceActive && catchAlignmentEligible && catchPointContactEligible && catchFrame) {
      if (!catchCapture.active) {
        catchCapture.active = true;
        catchCapture.phase = "catch-contact";
        catchCapture.contactHoldSec = 0;
        catchCapture.settleHoldSec = 0;
      }
    } else if (!catchCapture.active) {
      runtime.booster.catchAlignHoldSec = 0;
      resetBoosterCatchCaptureState(catchCapture);
    } else if (!catchFrame || !catchGuidanceActive) {
      runtime.booster.catchAlignHoldSec = 0;
      resetBoosterCatchCaptureState(catchCapture);
    }
    let catchFinalized = false;
    if (catchCapture.active && catchFrame) {
      if (!catchPointContactEligible) {
        markBoosterCrashed({
          boosterState,
          earthState,
          currentEarthAxes,
          earthRadiusKm,
          nowMs,
          reason: "catch-contact-lost",
          impactSpeedKmS: catchRelativeState?.totalSpeedKmS ?? speedKmS,
          impactVerticalSpeedKmS: catchRelativeState?.verticalSpeedKmS,
          impactLateralSpeedKmS: catchRelativeState?.lateralSpeedKmS,
          impactBodyUpAlignment: bodyUpAlignmentNow,
          impactImpulseDirectionKm: unitOrNull(catchRelativeState?.lateralPositionKm)
            || unitOrNull(catchRelativeState?.lateralVelocityKmS)
            || unitOrNull(catchCenterLateralVector)
            || null,
        });
        return;
      }
      catchCapture.contactHoldSec = clamp(
        catchCapture.contactHoldSec + Math.max(0, dtSeconds),
        0,
        0.45,
      );
      const contactProgress = clamp(0.58 + ((catchCapture.contactHoldSec / 0.45) * 0.42), 0, 1);
      catchCapture.phase = contactProgress < 0.999 ? "catch-contact" : "catch-capture";
      catchCapture.targetOffsetUpKm = Math.max(0, 0.0018 * (1 - contactProgress));
      catchRelativeState = computeBoosterCatchRelativeState({
        boosterState,
        catchFrame,
      });
      catchPinHeightErrorKm = Number.isFinite(Number(catchRelativeState?.verticalErrorKm))
        ? Number(catchRelativeState.verticalErrorKm)
        : computeBoosterCatchPinHeightErrorKm(bodyAboveTerrainKm);
      catchCapture.closureNorm = contactProgress;
      catchCapture.lateralErrorKm = Number.isFinite(Number(catchRelativeState?.lateralRangeKm))
        ? Number(catchRelativeState.lateralRangeKm)
        : null;
      catchCapture.verticalErrorKm = Number.isFinite(Number(catchRelativeState?.verticalErrorKm))
        ? Number(catchRelativeState.verticalErrorKm)
        : null;
      catchCapture.totalErrorKm = Number.isFinite(Number(catchRelativeState?.totalRangeKm))
        ? Number(catchRelativeState.totalRangeKm)
        : null;
      catchCapture.totalSpeedKmS = Number.isFinite(Number(catchRelativeState?.totalSpeedKmS))
        ? Number(catchRelativeState.totalSpeedKmS)
        : null;
      const contactClosingSpeedKmS = Number(catchPointContactResult?.maxClosingSpeedKmS) || 0;
      catchCapture.loadN = Math.max(
        0,
        (Number(boosterState.massKg) || 0)
          * ((contactClosingSpeedKmS * 1000) / Math.max(0.05, Number(dtSeconds) || 0.05)),
      );
      catchCapture.loadG = (Number(boosterState.massKg) || 0) > 1e-6
        ? catchCapture.loadN
          / ((Number(boosterState.massKg) || 1) * STANDARD_GRAVITY_M_S2)
        : 0;
      const captureLoadExceeded =
        catchCapture.loadG > BOOSTER_CATCH_CAPTURE_LIMITS.maxLoadG;
      const captureEnvelopeExceeded =
        (Number(catchCapture.totalSpeedKmS) || 0) > BOOSTER_CATCH_CAPTURE_LIMITS.maxTotalSpeedKmS
        || (Number(catchCapture.lateralErrorKm) || 0) > BOOSTER_CATCH_CAPTURE_LIMITS.maxLateralErrorKm
        || Math.abs(Number(catchCapture.verticalErrorKm) || 0) > BOOSTER_CATCH_CAPTURE_LIMITS.maxVerticalErrorKm;
      const captureAttitudeExceeded =
        bodyUpAlignmentNow < BOOSTER_CATCH_GEOMETRY_KM.finalizeBodyUpAlignmentMin
        || boosterBodyRateRadS > BOOSTER_CATCH_GEOMETRY_KM.finalizeBodyRateRadSMax;
      if (captureLoadExceeded || captureEnvelopeExceeded || captureAttitudeExceeded) {
        markBoosterCrashed({
          boosterState,
          earthState,
          currentEarthAxes,
          earthRadiusKm,
          nowMs,
          reason: captureLoadExceeded
            ? "catch-capture-load-exceeded"
            : captureEnvelopeExceeded
              ? "catch-capture-envelope-miss"
              : "catch-capture-attitude-miss",
          impactSpeedKmS: catchCapture.totalSpeedKmS,
          impactVerticalSpeedKmS: catchRelativeState?.verticalSpeedKmS,
          impactLateralSpeedKmS: catchRelativeState?.lateralSpeedKmS,
          impactBodyUpAlignment: bodyUpAlignmentNow,
          impactImpulseDirectionKm: unitOrNull(catchRelativeState?.lateralPositionKm)
            || unitOrNull(catchRelativeState?.lateralVelocityKmS)
            || unitOrNull(catchCenterLateralVector)
            || null,
        });
        return;
      }
      runtime.booster.catchAlignHoldSec = catchCapture.contactHoldSec;
      setBoosterCommandPhase(catchCapture.phase);
      runtime.booster.guidanceMode = `booster-${catchCapture.phase}`;
      if (runtime.booster.lastStep && typeof runtime.booster.lastStep === "object") {
        runtime.booster.lastStep.mode = runtime.booster.guidanceMode;
        runtime.booster.lastStep.guidanceMode = runtime.booster.guidanceMode;
      }
      const captureSettled = catchPointContactEligible && shouldFinalizeBoosterCatch({
        guidanceMode: runtime.booster.guidanceMode,
        launchSiteLateralRangeKm: catchRelativeState?.lateralRangeKm ?? catchCenterLateralRangeKm,
        catchVerticalErrorKm: catchRelativeState?.verticalErrorKm,
        catchPinHeightErrorKm,
        speedKmS: catchRelativeState?.totalSpeedKmS ?? speedKmS,
        radialSpeedKmS: catchRelativeState?.verticalSpeedKmS ?? radialSpeedKmS,
        bodyUpAlignment: bodyUpAlignmentNow,
        bodyAngularRateRadS: boosterBodyRateRadS,
        catchHoldSec: catchCapture.contactHoldSec,
      });
      if (captureSettled) {
        catchCapture.settleHoldSec += Math.max(0, dtSeconds);
      } else {
        catchCapture.settleHoldSec = 0;
      }
      catchFinalized = catchCapture.settleHoldSec >= 0.55 && catchCapture.contactHoldSec >= 0.35;
    }
    if (catchFinalized) {
      if (catchFrame && catchRelativeState) {
        runtime.booster.catchSupportOffsetKm = {
          eastKm: finiteNumber(catchRelativeState.eastErrorKm, 0),
          northKm: finiteNumber(catchRelativeState.northErrorKm, 0),
          upKm: finiteNumber(catchRelativeState.verticalErrorKm, 0),
        };
        boosterState.velocity = { ...catchFrame.centerVelocity };
      } else if (padState) {
        runtime.booster.catchSupportOffsetKm = null;
        boosterState.velocity = { ...padVelocity };
      }
      const caughtBodyAxis = boosterBodyAxisWorld(runtime.booster.attitude);
      runtime.booster.landed = true;
      runtime.booster.crashed = false;
      runtime.booster.terminalOutcome = "caught";
      runtime.booster.terminalReason = "chopstick-capture";
      runtime.booster.impactSpeedKmS = finiteOrNull(catchRelativeState?.totalSpeedKmS);
      runtime.booster.impactVerticalSpeedKmS = finiteOrNull(catchRelativeState?.verticalSpeedKmS);
      runtime.booster.impactLateralSpeedKmS = finiteOrNull(catchRelativeState?.lateralSpeedKmS);
      runtime.booster.impactBodyUpAlignment = clamp(dot(caughtBodyAxis, upNow), -1, 1);
      runtime.booster.crashDynamics = resetBoosterCrashDynamicsState(runtime.booster.crashDynamics);
      catchCapture.active = false;
      catchCapture.phase = "caught";
      catchCapture.closureNorm = 1;
      catchCapture.targetOffsetUpKm = 0;
      setBoosterCommandPhase("caught");
      runtime.booster.guidanceMode = "booster-caught";
      runtime.booster.lastStep = caughtBoosterStep(caughtBodyAxis);
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
      runtime.booster.telemetry.catchLateralRangeKm = Number.isFinite(Number(catchRelativeState?.lateralRangeKm))
        ? Number(catchRelativeState.lateralRangeKm)
        : null;
      runtime.booster.telemetry.catchVerticalErrorKm = Number.isFinite(Number(catchRelativeState?.verticalErrorKm))
        ? Number(catchRelativeState.verticalErrorKm)
        : null;
      runtime.booster.telemetry.catchLateralSpeedKmS = Number.isFinite(Number(catchRelativeState?.lateralSpeedKmS))
        ? Number(catchRelativeState.lateralSpeedKmS)
        : null;
      runtime.booster.telemetry.catchVerticalSpeedKmS = Number.isFinite(Number(catchRelativeState?.verticalSpeedKmS))
        ? Number(catchRelativeState.verticalSpeedKmS)
        : null;
      runtime.booster.telemetry.catchEastErrorKm = Number.isFinite(Number(catchRelativeState?.eastErrorKm))
        ? Number(catchRelativeState.eastErrorKm)
        : null;
      runtime.booster.telemetry.catchNorthErrorKm = Number.isFinite(Number(catchRelativeState?.northErrorKm))
        ? Number(catchRelativeState.northErrorKm)
        : null;
      runtime.booster.telemetry.catchEastSpeedKmS = Number.isFinite(Number(catchRelativeState?.eastSpeedKmS))
        ? Number(catchRelativeState.eastSpeedKmS)
        : null;
      runtime.booster.telemetry.catchNorthSpeedKmS = Number.isFinite(Number(catchRelativeState?.northSpeedKmS))
        ? Number(catchRelativeState.northSpeedKmS)
        : null;
      runtime.booster.telemetry.catchAlignHoldSec = Number(runtime.booster.catchAlignHoldSec) || 0;
      runtime.booster.telemetry.catchPinHeightErrorKm = Number.isFinite(catchPinHeightErrorKm)
        ? catchPinHeightErrorKm
        : null;
      runtime.booster.telemetry.catchCaptureActive = Boolean(runtime.booster.capture?.active);
      runtime.booster.telemetry.catchCapturePhase = String(runtime.booster.capture?.phase || "");
      runtime.booster.telemetry.catchCaptureClosureNorm = Number(runtime.booster.capture?.closureNorm) || 0;
      runtime.booster.telemetry.catchCaptureLoadN = Number(runtime.booster.capture?.loadN) || 0;
      runtime.booster.telemetry.catchCaptureLoadG = Number(runtime.booster.capture?.loadG) || 0;
      runtime.booster.telemetry.catchCaptureLateralErrorKm = finiteOrNull(runtime.booster.capture?.lateralErrorKm);
      runtime.booster.telemetry.catchCaptureVerticalErrorKm = finiteOrNull(runtime.booster.capture?.verticalErrorKm);
      runtime.booster.telemetry.catchCaptureTotalErrorKm = finiteOrNull(runtime.booster.capture?.totalErrorKm);
      runtime.booster.telemetry.catchCaptureTotalSpeedKmS = finiteOrNull(runtime.booster.capture?.totalSpeedKmS);
      runtime.booster.telemetry.catchCaptureSettleHoldSec = Number(runtime.booster.capture?.settleHoldSec) || 0;
      runtime.booster.telemetry.catchPointContactEligible = Boolean(catchPointContactResult?.captureEligible);
      runtime.booster.telemetry.catchPointSupportedPins = Number(catchPointContactResult?.supportedPinCount) || 0;
      runtime.booster.telemetry.catchPointSupportedArms = Number(catchPointContactResult?.supportedArmCount) || 0;
      runtime.booster.telemetry.catchPointMaxVerticalGapKm = finiteOrNull(catchPointContactResult?.maxAbsVerticalGapKm);
      runtime.booster.telemetry.catchPointMaxTangentialSpeedKmS = finiteOrNull(catchPointContactResult?.maxTangentialSpeedKmS);
      runtime.booster.telemetry.catchPointMaxClosingSpeedKmS = finiteOrNull(catchPointContactResult?.maxClosingSpeedKmS);
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
        const stageForStep = runtime.stageIndex === 0
          ? stage1BoosterConfigWithEngineOverride(runtime.boosterEngineCountOverride)
          : stageAtIndex(runtime.stageIndex);
        const padReleaseDurationSec = Math.max(
          0,
          Number(LAUNCH_AUTOPILOT_CONFIG.padReleaseDurationSec) || 0,
        );
        const towerClearAltitudeKm = Math.max(
          0,
          Number(LAUNCH_AUTOPILOT_CONFIG.towerClearAltitudeKm) || 0,
        );
        const towerClearMaxDurationSec = Math.max(
          0,
          Number(LAUNCH_AUTOPILOT_CONFIG.towerClearMaxDurationSec) || 0,
        );
        const launchElapsedSec = currentLaunchElapsedSeconds();
        const earlyPadLaunchActive =
          currentLaunchCommandPhase() === "powered"
          && runtime.stageIndex === 0
          && (Number(requestedThrottle) || 0) > 1e-3
          && Number.isFinite(launchClearanceAltitudeKm)
          && launchClearanceAltitudeKm < towerClearAltitudeKm
          && !Boolean(runtime.launchSequence?.towerClearSatisfied)
          && (
            towerClearMaxDurationSec <= 0
            || launchElapsedSec < towerClearMaxDurationSec
          );
        if (earlyPadLaunchActive) {
          const earlyLaunchMode = launchElapsedSec < padReleaseDurationSec
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
        const hotstageTransitionPending =
          runtime.stageIndex === 0
          && runtime.pendingStageTransition?.active
          && runtime.pendingStageTransition.kind === "hotstage_ignite";
        const hotstageTransitionAnomalyActive =
          hotstageTransitionPending
          && Boolean(runtime.pendingStageTransition.anomalyActive);
        if (hotstageTransitionAnomalyActive) {
          const anomalyTag = String(
            runtime.pendingStageTransition.anomalyReason
            || runtime.pendingStageTransition.waitReason
            || "window_missed",
          );
          requestedThrottle = 0;
          directionRequested = normalize(
            runtime.stageActuator?.directionActual || orbital.up,
            orbital.up,
          );
          effectiveGuidanceMode = `autopilot-hotstage-anomaly-hold+${anomalyTag}`;
          runtime.autopilotMode = "autopilot-hotstage-anomaly-hold";
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
        const qAlphaDynamicPressureThresholdPa = runtime.stageIndex >= 1
          ? UPPER_STAGE_QALPHA_ACTIVE_MIN_DYNAMIC_PRESSURE_PA
          : PRIMARY_QALPHA_ACTIVE_MIN_DYNAMIC_PRESSURE_PA;
        const qAlphaAtmosphereActive = (
          Number.isFinite(orbital.altitudeKm)
          && orbital.altitudeKm <= PRIMARY_QALPHA_ACTIVE_MAX_ALTITUDE_KM
          && Number(dynamicPressurePa) >= qAlphaDynamicPressureThresholdPa
        );
        const qAlphaReferenceAirVelocityKmS = (() => {
          const launchPlaneNormal = unitOrNull(runtime.launchPlaneNormal);
          if (
            runtime.stageIndex === 0
            && launchPlaneNormal
            && Number.isFinite(Number(launchClearanceAltitudeKm))
            && Number(launchClearanceAltitudeKm) < 35
          ) {
            const projectedRelAir = subtract(
              relAirVelocityKmS,
              scale(launchPlaneNormal, dot(relAirVelocityKmS, launchPlaneNormal)),
            );
            if (length(projectedRelAir) > 1e-9) {
              return projectedRelAir;
            }
          }
          return relAirVelocityKmS;
        })();
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
            relAirVelocityKmS: qAlphaReferenceAirVelocityKmS,
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
        let requestedPhase = String(
          advisoryPhase
          || ((Number(requestedThrottle) || 0) > 1e-3 ? "powered" : (passiveVehiclePhase === "orbit" ? "orbit" : "coast"))
          || "coast"
        );
        if (hotstageTransitionAnomalyActive) {
          requestedPhase = "coast";
        }
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

        runtime.stageActuator = updateStageThrottleState(runtime.stageActuator, {
          requestedThrottle: canThrust ? throttleCommand : 0,
          dtSeconds,
          massModel: runtime.stageMassModel,
        });
        const throttleActual = canThrust
          ? clamp(Number(runtime.stageActuator.throttleActual) || 0, 0, 1)
          : 0;
        runtime.stageAttitude = runtime.stageAttitude || resetAttitudeStateToAxis(
          runtime.stageActuator?.directionActual || steeringDirection,
        );
        const stageCombustionState = stageForStep
          ? updateEngineCombustionClusterState(
            runtime.stageIndex === 0 ? runtime.stage1Combustion : runtime.stage2Combustion,
            {
              config: stageForStep,
              dtSeconds,
              pressurePa,
              throttleCommand: canThrust ? throttleActual : 0,
            },
          )
          : null;
        let thrustN = 0;
        let burnRateKgS = 0;
        let burnKg = 0;
        if (stageForStep) {
          thrustN = Math.max(0, Number(stageCombustionState?.thrustN) || 0);
          burnRateKgS = Math.max(0, Number(stageCombustionState?.burnRateKgS) || 0);
          burnKg = Math.min(availablePropellantKg, burnRateKgS * dtSeconds);
        }

        const effectiveMassKg = Math.max(
          MIN_ROCKET_MASS_KG,
          (Number(rocketState.massKg) || MIN_ROCKET_MASS_KG) - (0.5 * burnKg),
        );
        const directionBeforeAttitudeStep = boosterBodyAxisWorld(runtime.stageAttitude);
        const stageOmegaBodyRadS = {
          x: finiteNumber(runtime.stageAttitude?.omegaBodyRadS?.x, 0),
          y: finiteNumber(runtime.stageAttitude?.omegaBodyRadS?.y, 0),
          z: finiteNumber(runtime.stageAttitude?.omegaBodyRadS?.z, 0),
        };
        const stageControlErrorsBody = computeBoosterAttitudeControlErrors({
          desiredDirection: steeringDirection,
          attitudeState: runtime.stageAttitude,
          referenceUpWorld: orbital.up,
          tangentialVectorWorld: orbital.tangentialVector,
        });
        const aeroForTorque = computeAerodynamicResponse({
          bodyKind,
          atmosphereSample: atmo,
          relPos,
          relVel,
          earthPole: currentEarthAxes.pole,
          windVectorKmS: windSample.vectorKmS,
          bodyAxisDirection: directionBeforeAttitudeStep,
          referenceAreaM2: Number(LAUNCH_VEHICLE_CONFIG.referenceAreaM2) || 0,
          massKg: effectiveMassKg,
          massModel: runtime.stageMassModel,
          throttle: throttleActual,
        });
        const stageEngineAngularControl = computeStageEngineAngularControlState({
          bodyKind,
          controlErrorsBody: stageControlErrorsBody,
          omegaBodyRadS: stageOmegaBodyRadS,
          throttle: throttleActual,
          massKg: effectiveMassKg,
          massModel: runtime.stageMassModel,
          engineState: stageCombustionState,
        });
        const starshipRcsControl = runtime.stageIndex >= 1
          ? computeStarshipRcsControlState({
            runtimeState: runtime,
            stageIndex: runtime.stageIndex,
            bodyKind,
            desiredDirection: steeringDirection,
            relPos,
            relVel,
            up: orbital.up,
            attitudeState: runtime.stageAttitude,
            controlErrorsBody: stageControlErrorsBody,
            omegaBodyRadS: stageOmegaBodyRadS,
            controlAuthorityScale: runtime.stageMassModel.controlAuthorityScale,
            aeroAuthority: Math.max(0, Number(aeroForTorque.authority) || 0),
            massKg: effectiveMassKg,
            massModel: runtime.stageMassModel,
            pressurePa,
            dtSeconds,
          })
          : zeroStarshipRcsControlState();
        const stageRcsAngularControl = runtime.stageIndex >= 1
          ? starshipRcsControl
          : zeroAngularControlState({ jets: [] });
        const relAirDirection = normalize(
          aeroForTorque.relAirVelocityKmS || scale(relVel, -1),
          directionBeforeAttitudeStep,
        );
        const aeroAxis = unitOrNull(cross(directionBeforeAttitudeStep, relAirDirection));
        const aeroTorqueSignedNm =
          (Number(aeroForTorque.dynamicPressurePa) || 0)
          * Math.max(0, Number(LAUNCH_VEHICLE_CONFIG.referenceAreaM2) || 0)
          * stageBodyLengthMeters(bodyKind)
          * (-(Number(aeroForTorque.momentCoefficient) || 0));
        const engineAsymmetryBodyTorqueNm = computeEngineClusterBodyTorqueNm({
          descriptors: stageCombustionState?.descriptors,
          activeDescriptors: stageCombustionState?.activeDescriptors,
          activeIndices: stageCombustionState?.activeIndices,
          engineThrustNByIndex: stageCombustionState?.engineThrustNByIndex,
          activeEngineThrustsN: stageCombustionState?.activeEngineThrustsN,
          fallbackPerEngineThrustN: (Number(stageCombustionState?.thrustN) || 0)
            / Math.max(1, Number(stageCombustionState?.activeCount) || 0),
          forceDirectionBody: { x: 0, y: 1, z: 0 },
          fallbackY: -stageBodyLengthMeters(bodyKind) * 0.46,
        });
        let totalStageBodyTorqueNm = add(
          add(
            stageEngineAngularControl.bodyTorqueNm || { x: 0, y: 0, z: 0 },
            stageRcsAngularControl.bodyTorqueNm || { x: 0, y: 0, z: 0 },
          ),
          engineAsymmetryBodyTorqueNm,
        );
        let totalStageTorqueWorldNm = rotateVectorByQuaternion(
          totalStageBodyTorqueNm,
          runtime.stageAttitude?.orientation || quaternionIdentity(),
        );
        const stageAeroTorqueActive = Boolean(aeroAxis && Math.abs(aeroTorqueSignedNm) > 1e-6);
        if (stageAeroTorqueActive) {
          totalStageTorqueWorldNm = add(totalStageTorqueWorldNm, scale(aeroAxis, aeroTorqueSignedNm));
        }
        const effectiveStageMaxBodyRateRadS = Number.isFinite(commandedMaxBodyRateDegS)
          ? rad(commandedMaxBodyRateDegS)
          : null;
        if (STAGE_FULL_6DOF_ASCENT_ENABLED) {
          runtime.stageAttitude = integrateBoosterAttitudeState(runtime.stageAttitude, {
            torqueWorldNm: totalStageTorqueWorldNm,
            bodyKind,
            massKg: effectiveMassKg,
            inertiaNormalized: runtime.stageMassModel?.inertiaNormalized,
            angularDampingPerS: Number.isFinite(commandedAngularDampingPerS)
              ? commandedAngularDampingPerS
              : 0,
            maxBodyRateRadS: effectiveStageMaxBodyRateRadS,
            dtSeconds,
          });
        }
        const directionActual = boosterBodyAxisWorld(runtime.stageAttitude);
        const thrustVectorDirectionActual = thrustN > 0
          ? normalize(
            rotateVectorByQuaternion(
              stageEngineAngularControl.thrustDirectionBody || { x: 0, y: 1, z: 0 },
              runtime.stageAttitude?.orientation || quaternionIdentity(),
            ),
            directionActual,
          )
          : directionActual;
        runtime.stageActuator.directionCommand = normalize(steeringDirection, directionActual);
        runtime.stageActuator.directionActual = directionActual;
        runtime.stageActuator.gimbalErrorDeg = degrees(angleBetweenRadians(directionActual, steeringDirection));
        runtime.stageActuator.angularRateRadS = length(runtime.stageAttitude?.omegaBodyRadS || { x: 0, y: 0, z: 0 });
        const thrustAccelerationKmS2 = thrustN > 0
          ? scale(thrustVectorDirectionActual, (thrustN / effectiveMassKg) / 1000)
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
        const rcs = runtime.stageIndex >= 1
          ? starshipRcsControl
          : zeroStarshipRcsControlState();
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
        const stageEngineAsymmetryMomentNm = Math.hypot(
          Number(engineAsymmetryBodyTorqueNm.x) || 0,
          Number(engineAsymmetryBodyTorqueNm.z) || 0,
        );
        const stageAttitudeTorqueSources = [
          length(stageEngineAngularControl.bodyTorqueNm || { x: 0, y: 0, z: 0 }) > 1e-6 ? "engine-gimbal" : null,
          length(stageRcsAngularControl.bodyTorqueNm || { x: 0, y: 0, z: 0 }) > 1e-6 ? "rcs-thrusters" : null,
          stageEngineAsymmetryMomentNm > 1e-6 ? "engine-asymmetry" : null,
          stageAeroTorqueActive ? "aero-moment" : null,
        ].filter(Boolean);
        const stageAttitudeTorqueSourceText = stageAttitudeTorqueSources.length > 0
          ? stageAttitudeTorqueSources.join(" + ")
          : "none";
        runtime.lastStep = {
          accelerationKmS2: add(add(thrustAccelerationKmS2, aero.accelerationKmS2), rcs.accelerationKmS2),
          effectiveMassKg,
          throttle: throttleActual,
          throttleCommand: canThrust ? throttleCommand : 0,
          thrustN,
          activeEngineIndices: Array.isArray(stageCombustionState?.activeIndices)
            ? [...stageCombustionState.activeIndices]
            : [],
          activeEngineCount: Math.max(0, Number(stageCombustionState?.activeCount) || 0),
          desiredEngineCount: Math.max(0, Number(stageCombustionState?.desiredCount) || 0),
          failedEngineIndices: Array.isArray(stageCombustionState?.failedIndices)
            ? [...stageCombustionState.failedIndices]
            : [],
          faultedEngineIndices: Array.isArray(stageCombustionState?.faultedIndices)
            ? [...stageCombustionState.faultedIndices]
            : [],
          flamePresentIndices: Array.isArray(stageCombustionState?.flamePresentIndices)
            ? [...stageCombustionState.flamePresentIndices]
            : [],
          chamberPressurePaByIndex: Array.isArray(stageCombustionState?.chamberPressurePaByIndex)
            ? [...stageCombustionState.chamberPressurePaByIndex]
            : [],
          exhaustTemperatureKByIndex: Array.isArray(stageCombustionState?.exhaustTemperatureKByIndex)
            ? [...stageCombustionState.exhaustTemperatureKByIndex]
            : [],
          combustionEfficiencyByIndex: Array.isArray(stageCombustionState?.combustionEfficiencyByIndex)
            ? [...stageCombustionState.combustionEfficiencyByIndex]
            : [],
          turbopumpNormByIndex: Array.isArray(stageCombustionState?.turbopumpNormByIndex)
            ? [...stageCombustionState.turbopumpNormByIndex]
            : [],
          engineThrustNByIndex: Array.isArray(stageCombustionState?.engineThrustNByIndex)
            ? [...stageCombustionState.engineThrustNByIndex]
            : [],
          burnKg,
          burnRateKgS,
          ...combustionSummaryFields(stageCombustionState),
          dynamicPressurePa: aero.dynamicPressurePa,
          guidanceMode: guidanceModeLabel,
          requestedDirectionKm: cloneVectorOrNull(steeringDirection),
          bodyAxisDirectionKm: cloneVectorOrNull(directionActual),
          thrustVectorDirectionKm: cloneVectorOrNull(thrustVectorDirectionActual),
          thrustAccelerationKmS2: cloneVectorOrNull(thrustAccelerationKmS2),
          aeroAccelerationKmS2: cloneVectorOrNull(aero.accelerationKmS2),
          rcsAccelerationKmS2: cloneVectorOrNull(rcs.accelerationKmS2),
          rcsAccelerationMagKmS2: length(rcs.accelerationKmS2 || { x: 0, y: 0, z: 0 }),
          rcsActive: rcs.active,
          rcsErrorDeg: rcs.errorDeg,
          rcsAuthority: rcs.authority,
          rcsLinearAuthority: Number(rcs.linearAuthority) || 0,
          rcsAngularAuthority: Number(rcs.angularAuthority) || 0,
          rcsJets: Array.isArray(rcs.jets) ? [...rcs.jets] : [],
          rcsCommandedThrusterIds: Array.isArray(rcs.commandedThrusterIds) ? [...rcs.commandedThrusterIds] : [],
          rcsCommandedThrusterIndices: Array.isArray(rcs.commandedThrusterIndices) ? [...rcs.commandedThrusterIndices] : [],
          rcsActiveThrusterIds: Array.isArray(rcs.activeThrusterIds) ? [...rcs.activeThrusterIds] : [],
          rcsActiveThrusterIndices: Array.isArray(rcs.activeThrusterIndices) ? [...rcs.activeThrusterIndices] : [],
          rcsThrustN: Number(rcs.thrustN) || 0,
          rcsBurnKg: Number(rcs.burnKg) || 0,
          rcsBurnRateKgS: Number(rcs.burnRateKgS) || 0,
          rcsPropellantKg: Number(rcs.propellantKg) || 0,
          rcsInitialPropellantKg: Number(rcs.initialPropellantKg) || 0,
          rcsFuelFraction: Number.isFinite(Number(rcs.fuelFraction)) ? Number(rcs.fuelFraction) : null,
          rcsBodyForceN: cloneVectorOrNull(rcs.bodyForceN),
          rcsBodyTorqueNm: cloneVectorOrNull(rcs.bodyTorqueNm),
          rcsThrusterThrustNByIndex: Array.isArray(rcs.thrusterThrustNByIndex) ? [...rcs.thrusterThrustNByIndex] : [],
          rcsChamberPressurePaByIndex: Array.isArray(rcs.chamberPressurePaByIndex) ? [...rcs.chamberPressurePaByIndex] : [],
          rcsExhaustTemperatureKByIndex: Array.isArray(rcs.exhaustTemperatureKByIndex) ? [...rcs.exhaustTemperatureKByIndex] : [],
          rcsCombustionEfficiencyByIndex: Array.isArray(rcs.combustionEfficiencyByIndex) ? [...rcs.combustionEfficiencyByIndex] : [],
          rcsTurbopumpNormByIndex: Array.isArray(rcs.turbopumpNormByIndex) ? [...rcs.turbopumpNormByIndex] : [],
          rcsAvgChamberPressurePa: Number(rcs.avgChamberPressurePa) || 0,
          rcsMaxChamberPressurePa: Number(rcs.maxChamberPressurePa) || 0,
          rcsAvgCombustionEfficiency: Number(rcs.avgCombustionEfficiency) || 0,
          rcsAvgTurbopumpNorm: Number(rcs.avgTurbopumpNorm) || 0,
          rcsMaxExhaustTemperatureK: Number(rcs.maxExhaustTemperatureK) || 0,
          navSource: String(rcs.navSource || ""),
          navSensorNoiseActive: Boolean(rcs.navSensorNoiseActive),
          navPositionSigmaKm: Number(rcs.navPositionSigmaKm) || 0,
          navVelocitySigmaKmS: Number(rcs.navVelocitySigmaKmS) || 0,
          navAttitudeSigmaDeg: Number(rcs.navAttitudeSigmaDeg) || 0,
          navPositionErrorKm: cloneVectorOrNull(rcs.navPositionErrorKm),
          navVelocityErrorKmS: cloneVectorOrNull(rcs.navVelocityErrorKmS),
          navAttitudeErrorDeg: cloneVectorOrNull(rcs.navAttitudeErrorDeg),
          angleOfAttackDeg: aero.angleOfAttackDeg,
          qAlphaPaRad: aero.qAlphaPaRad,
          machNumber: aero.machNumber,
          dragCoefficient: aero.dragCoefficient,
          liftCoefficient: aero.liftCoefficient,
          momentCoefficient: aero.momentCoefficient,
          gimbalErrorDeg: runtime.stageActuator.gimbalErrorDeg,
          attitudeTorqueSources: stageAttitudeTorqueSources,
          attitudeTorqueSourceText: stageAttitudeTorqueSourceText,
          engineGimbalAuthority: Number(stageEngineAngularControl.authority) || 0,
          rcsAngularAuthority: Number(stageRcsAngularControl.angularAuthority ?? stageRcsAngularControl.authority) || 0,
          aeroMomentActive: stageAeroTorqueActive,
          bodyAngularRateRadS: cloneVectorOrNull(runtime.stageAttitude?.omegaBodyRadS),
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

      const launchElapsedSec = currentLaunchElapsedSeconds();
      let throttle = throttleForState(runtime.stageIndex, launchElapsedSec, dynamicPressurePa);
      let guidance = guidanceDirection({
        rocketState,
        earthState,
        earthAxes: currentEarthAxes,
        elapsedSeconds: launchElapsedSec,
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
      const towerClearMaxDurationSec = Math.max(
        0,
        Number(LAUNCH_AUTOPILOT_CONFIG.towerClearMaxDurationSec) || 0,
      );
      if (
        runtime.stageIndex === 0
        && Number.isFinite(launchClearanceAltitudeKm)
        && launchClearanceAltitudeKm < towerClearAltitudeKm
        && !Boolean(runtime.launchSequence?.towerClearSatisfied)
        && (
          towerClearMaxDurationSec <= 0
          || launchElapsedSec < towerClearMaxDurationSec
        )
      ) {
        const earlyLaunchMode = launchElapsedSec < padReleaseDurationSec
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
      const boosterNeedsFinalizeAtStart = Boolean(
        runtime.booster.active || runtime.booster.landed || runtime.booster.crashed,
      );
      if (
        currentLaunchCommandPhase() === "idle"
        && reportedVehiclePhaseAtFinalizeStart === "idle"
        && !boosterNeedsFinalizeAtStart
        && !fleetActive
      ) {
        repairIdlePrimaryLaunchBodyToPadIfNeeded(state, nowMs);
        return;
      }
      if (
        currentLaunchCommandPhase() === "idle"
        && reportedVehiclePhaseAtFinalizeStart === "idle"
        && !boosterNeedsFinalizeAtStart
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
      const upperStageSurfaceImpact =
        Number(runtime.stageIndex) >= 1
        && passiveVehiclePhase === "idle"
        && currentLaunchCommandPhase() !== "idle";
      if (upperStageSurfaceImpact) {
        setLaunchCommandPhase("idle");
        runtime.autopilotMode = "autopilot-surface-impact-terminate";
        runtime.lastStep = {
          ...(runtime.lastStep || {}),
          accelerationKmS2: { x: 0, y: 0, z: 0 },
          throttle: 0,
          throttleCommand: 0,
          thrustN: 0,
          burnRateKgS: 0,
          burnKg: 0,
          guidanceMode: "autopilot-surface-impact-terminate",
        };
        updateRuntimeSurfaceSample(rocketState, earthState, currentEarthAxes, earthRadiusKm);
        const impactEnvironmentSample = launchEnvironmentSample(
          relPosAfterContact,
          currentEarthAxes,
          earthRadiusKm,
          nowMs,
        );
        runtime.lastTelemetry = telemetryFromState({
          gravitationalConstantKm3PerKgS2,
          earthMassKg: Number(getEarthMassKg?.()) || 0,
          earthRadiusKm,
          earthState,
          rocketState,
          atmosphereSample: impactEnvironmentSample.atmosphereSample,
          earthPole: currentEarthAxes.pole,
          windVectorKmS: impactEnvironmentSample.windSample.vectorKmS,
          dynamicPressurePaOverride: runtime.lastStep?.dynamicPressurePa
            ?? dynamicPressurePaFromAtmosphere(
              impactEnvironmentSample.atmosphereSample,
              relPosAfterContact,
              relVelAfterContact,
              currentEarthAxes.pole,
              impactEnvironmentSample.windSample.vectorKmS,
            ),
          runtime,
        });
        finalizeBoosterStep(state, dtSeconds, nowMs);
        fleetController.finalizeStep(state, dtSeconds, nowMs);
        runtime.elapsedSeconds += dtSeconds;
        return;
      }
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
        updateLaunchSequenceState({
          earthState,
          rocketState,
          earthRadiusKm,
          dynamicPressurePa,
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
    const rcsBurnKg = Number(runtime.lastStep?.rcsBurnKg) || 0;
    const sustainedOrbitReserveActive = missionUsesSustainedOrbitReserve(runtime);
    const appliedBurnKg = sustainedOrbitReserveActive ? 0 : burnKg;
    const appliedMassLossKg = Math.max(0, appliedBurnKg) + Math.max(0, rcsBurnKg);
    if (appliedMassLossKg > 0) {
      rocketState.massKg = Math.max(
        MIN_ROCKET_MASS_KG,
        rocketState.massKg - appliedMassLossKg,
      );
    }
    if (appliedBurnKg > 0) {
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
    const groundRelativeSpeedKmS = length(atmosphereRelativeVelocityKmS(
      relPosAfterContact,
      relVelAfterContact,
      currentEarthAxes.pole,
    ));
    const requestStageTransition = ({
      kind = "",
      fromStageIndex = runtime.stageIndex,
      toStageIndex = null,
      requestReason = "",
      reservePropellantKg = 0,
    } = {}) => {
      requestPendingStageTransition({
        kind,
        fromStageIndex,
        toStageIndex,
        requestReason,
        reservePropellantKg,
        altitudeKm: resolvedLaunchVehicleAltitudeAboveTerrainKm(orbitalAfterContact?.altitudeKm),
        groundRelativeSpeedKmS,
        dynamicPressurePa: runtime.lastStep?.dynamicPressurePa,
      });
      emitLaunchEvent("stage_transition_requested", {
        transitionKind: kind,
        fromStageIndex,
        toStageIndex,
        requestReason: runtime.pendingStageTransition.requestReason,
        reservePropellantKg,
        altitudeAboveTerrainKm: runtime.pendingStageTransition.requestAltitudeKm,
        groundRelativeSpeedKmS,
        dynamicPressurePa: runtime.pendingStageTransition.requestDynamicPressurePa,
      });
    };
    const hotstageRequestAlreadyPending =
      runtime.pendingStageTransition?.active
      && runtime.pendingStageTransition.kind === "hotstage_ignite";
    if (
      runtime.stageIndex === 0
      && runtime.booster.attached
      && !runtime.booster.active
      && !runtime.hotstage.active
      && !hotstageRequestAlreadyPending
    ) {
      const hotstageEnvelope = evaluateHotstageRealismEnvelope(
        runtime,
        rocketState,
        earthState,
        earthRadiusKm,
      );
      const hotstageNominalCommitWindowReached =
        hotstageEnvelope.altitudeKm >= (hotstageEnvelope.nominalAltitudeKm - 5);
      const deferredHotstageCommitReady = hotstageDeferredCandidateUsable(
        runtime.launchSequence,
        hotstageEnvelope,
      );
      const deferredHotstageEarlyCommitReady = hotstageDeferredCandidateEarlyUsable(
        runtime.launchSequence,
        hotstageEnvelope,
      );
      const hotstageNominalCommitReady =
        Boolean(runtime.launchSequence?.hotstageArmed)
        && (
          (hotstageEnvelope.withinEnvelope && hotstageNominalCommitWindowReached)
          || deferredHotstageCommitReady
          || deferredHotstageEarlyCommitReady
        );
      const hotstageWindowMissed =
        hotstageEnvelope.elapsedSec > hotstageEnvelope.maxElapsedSec
        || hotstageEnvelope.altitudeKm > (hotstageEnvelope.maxAltitudeKm + 2);
      if (hotstageNominalCommitReady || hotstageWindowMissed) {
        requestStageTransition({
          kind: "hotstage_ignite",
          fromStageIndex: 0,
          toStageIndex: 1,
          requestReason: hotstageNominalCommitReady
            ? (
              (deferredHotstageCommitReady || deferredHotstageEarlyCommitReady)
                && !hotstageEnvelope.withinEnvelope
                ? (
                  deferredHotstageEarlyCommitReady
                    ? "hotstage_deferred_envelope_early_commit"
                    : "hotstage_deferred_envelope_commit"
                )
                : "hotstage_nominal_envelope_commit"
            )
            : "hotstage_window_missed",
          reservePropellantKg: Math.max(0, Number(runtime.stagePropellantKg) || 0),
        });
      }
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
      if (runtime.stageIndex === 0) {
        const nextStage = stageAtIndex(1);
        if (nextStage) {
          const boosterReservePropellantKg = Math.max(0, Number(runtime.stagePropellantKg) || 0);
          if (!(runtime.pendingStageTransition?.active && runtime.pendingStageTransition.kind === "hotstage_ignite")) {
            requestStageTransition({
              kind: "hotstage_ignite",
              fromStageIndex: runtime.stageIndex,
              toStageIndex: 1,
              requestReason: "stage0_propellant_depleted",
              reservePropellantKg: boosterReservePropellantKg,
            });
          }
        } else {
          rocketState.massKg = Math.max(
            MIN_ROCKET_MASS_KG,
            rocketState.massKg - (Number(stage.dryMassKg) || 0),
          );
          runtime.stageIndex += 1;
          runtime.stagePropellantKg = 0;
          setLaunchCommandPhase("coast");
          runtime.autopilotMode = "ballistic-coast";
          const currentBodyAxis = normalize(
            boosterBodyAxisWorld(runtime.stageAttitude),
            normalize(subtract(rocketState.position, earthState.position), currentEarthAxes.pole),
          );
          const currentCommandAxis = normalize(
            runtime.stageActuator?.directionCommand || currentBodyAxis,
            currentBodyAxis,
          );
          // Dry-out is not an attitude event. Preserve the rigid-body state and let
          // later coast/RCS/aero steps move it through physics.
          runtime.stageActuator = {
            ...createActuatorState(currentBodyAxis),
            ...(runtime.stageActuator || {}),
            throttleCommand: 0,
            throttleActual: 0,
            directionCommand: currentCommandAxis,
            directionActual: currentBodyAxis,
            gimbalErrorDeg: degrees(angleBetweenRadians(currentBodyAxis, currentCommandAxis)),
            angularRateRadS: length(runtime.stageAttitude?.omegaBodyRadS || { x: 0, y: 0, z: 0 }),
          };
          runtime.stageAttitude = runtime.stageAttitude || createBoosterAttitudeState(currentBodyAxis);
          runtime.stageMassModel = createMassModelState();
        }
      } else {
        const nextStage = stageAtIndex(runtime.stageIndex + 1);
        if (nextStage) {
          requestStageTransition({
            kind: "next_stage_separation",
            fromStageIndex: runtime.stageIndex,
            toStageIndex: runtime.stageIndex + 1,
            requestReason: "stage_propellant_depleted",
            reservePropellantKg: 0,
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
          const currentBodyAxis = normalize(
            boosterBodyAxisWorld(runtime.stageAttitude),
            normalize(relPos, currentEarthAxes.pole),
          );
          const currentCommandAxis = normalize(
            runtime.stageActuator?.directionCommand || currentBodyAxis,
            currentBodyAxis,
          );
          // Terminal dry-out switches propulsion authority off; it must not snap the
          // Starship attitude to local vertical.
          runtime.stageActuator = {
            ...createActuatorState(currentBodyAxis),
            ...(runtime.stageActuator || {}),
            throttleCommand: 0,
            throttleActual: 0,
            directionCommand: currentCommandAxis,
            directionActual: currentBodyAxis,
            gimbalErrorDeg: degrees(angleBetweenRadians(currentBodyAxis, currentCommandAxis)),
            angularRateRadS: length(runtime.stageAttitude?.omegaBodyRadS || { x: 0, y: 0, z: 0 }),
          };
          runtime.stageAttitude = runtime.stageAttitude || createBoosterAttitudeState(currentBodyAxis);
          runtime.stageMassModel = updateMassModelState(runtime.stageMassModel, {
            propellantFraction: 0,
            bodyKind: stageBodyKindFromStageIndex(runtime.stageIndex),
            dtSeconds: 0,
            dryMassKg: Number(stage?.dryMassKg) || 0,
            propellantMassKg: Number(stage?.propellantMassKg) || 0,
            attachedMassKg: 0,
          });
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
        physicalSeparationKm: runtime.attachedJoint?.physicalSeparationKm,
        physicalSeparationRateKmS: runtime.attachedJoint?.physicalSeparationRateKmS,
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
        const shipReferenceActiveAtDetach = hotstageShipReferenceActive();
        const separatedBooster = createSeparatedBoosterState({
          state,
          rocketState,
          earthState,
          currentEarthAxes,
          stage: boosterStage,
          reservePropellantKgOverride: runtime.hotstage.boosterReservePropellantKg,
        });
        if (separatedBooster && !shipReferenceActiveAtDetach) {
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
          physicalSeparationKm: hotstageGate.physicalSeparationKm,
          physicalSeparationRateKmS: hotstageGate.physicalSeparationRateKmS,
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
      updateLaunchSequenceState({
        earthState,
        rocketState,
        earthRadiusKm,
        dynamicPressurePa,
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
      try {
        applyEarthSolidSurfaceGuardToManagedBodies(state, dtSeconds, nowMs);
      } catch (error) {
        runtime.lastError = "Earth solid-surface guard failed";
        emitLaunchError("earth_solid_surface_guard_failed", {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
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
        boosterEngineCountSelected: normalizeBoosterEngineCountSelection(runtime.boosterEngineCountOverride),
        boosterRecoveryEngineCountSelected: Number(
          boosterRecoveryConfigWithEngineOverride(runtime.boosterEngineCountOverride)?.engineCount,
        ) || 0,
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
        ascentCorridorName: String(LAUNCH_VEHICLE_CONFIG.guidance?.ascentCorridorName || ""),
        ascentHeadingDegFromEast: finiteOrNull(LAUNCH_VEHICLE_CONFIG.guidance?.ascentHeadingDegFromEast),
        commandedPitchFromVerticalDeg: null,
        bodyPitchFromVerticalDeg: null,
        guidanceRequestedDirectionKm: cloneLaunchVectorOrNull(runtime.lastStep?.requestedDirectionKm),
        bodyAxisDirectionKm: cloneLaunchVectorOrNull(runtime.lastStep?.bodyAxisDirectionKm),
        launchElapsedSeconds: finiteOrNull(
          Boolean(runtime.launchSequence?.active)
            ? Math.max(
              0,
              (Number(runtime.elapsedSeconds) || 0) - (Number(runtime.launchSequence?.startElapsedSec) || 0),
            )
            : null,
        ),
        launchSequenceActive: Boolean(runtime.launchSequence?.active),
        launchCommitReady: Boolean(runtime.launchSequence?.launchCommitReady),
        launchCommitReason: String(runtime.launchSequence?.launchCommitReason || ""),
        launchCommitElapsedSec: finiteOrNull(runtime.launchSequence?.launchCommitElapsedSec),
        padReleaseComplete: Boolean(runtime.launchSequence?.padReleaseComplete),
        padReleaseElapsedSec: finiteOrNull(runtime.launchSequence?.padReleaseElapsedSec),
        towerClearSatisfied: Boolean(runtime.launchSequence?.towerClearSatisfied),
        towerClearElapsedSec: finiteOrNull(runtime.launchSequence?.towerClearElapsedSec),
        pitchoverEnabled: Boolean(runtime.launchSequence?.pitchoverEnabled),
        pitchoverElapsedSec: finiteOrNull(runtime.launchSequence?.pitchoverElapsedSec),
        hotstageDeferredCandidateActive: Boolean(runtime.launchSequence?.hotstageDeferredCandidateActive),
        hotstageDeferredCandidateElapsedSec: finiteOrNull(runtime.launchSequence?.hotstageDeferredCandidateElapsedSec),
        hotstageDeferredCandidateAltitudeKm: finiteOrNull(runtime.launchSequence?.hotstageDeferredCandidateAltitudeKm),
        hotstageDeferredCandidateReason: String(runtime.launchSequence?.hotstageDeferredCandidateReason || ""),
        hotstageArmed: Boolean(runtime.launchSequence?.hotstageArmed),
        hotstageArmReason: String(runtime.launchSequence?.hotstageArmReason || ""),
        hotstageArmedElapsedSec: finiteOrNull(runtime.launchSequence?.hotstageArmedElapsedSec),
        hotstageIgnitionAuthorized: Boolean(runtime.launchSequence?.hotstageIgnitionAuthorized),
        hotstageIgnitionElapsedSec: finiteOrNull(runtime.launchSequence?.hotstageIgnitionElapsedSec),
        hotstageReleaseAuthorized: Boolean(runtime.launchSequence?.hotstageReleaseAuthorized),
        hotstageReleaseElapsedSec: finiteOrNull(runtime.launchSequence?.hotstageReleaseElapsedSec),
        stageTransitionPending: Boolean(runtime.pendingStageTransition?.active),
        stageTransitionKind: runtime.pendingStageTransition?.active ? String(runtime.pendingStageTransition.kind || "") : "",
        stageTransitionWaitReason: runtime.pendingStageTransition?.active ? String(runtime.pendingStageTransition.waitReason || "") : "",
        stageTransitionHoldMode: runtime.pendingStageTransition?.active ? String(runtime.pendingStageTransition.holdMode || "") : "",
        stageTransitionAuthorizationMode: runtime.pendingStageTransition?.active ? String(runtime.pendingStageTransition.authorizationMode || "") : "",
        stageTransitionAnomalyActive: Boolean(runtime.pendingStageTransition?.active && runtime.pendingStageTransition?.anomalyActive),
        stageTransitionAnomalyReason: runtime.pendingStageTransition?.active ? String(runtime.pendingStageTransition.anomalyReason || "") : "",
        stageTransitionAnomalyElapsedSec: runtime.pendingStageTransition?.active ? finiteOrNull(runtime.pendingStageTransition.anomalyElapsedSec) : null,
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
        attachedJointAxialLoadMN: Number(runtime.attachedJoint.axialCompressionForceN) / 1e6 || 0,
        attachedJointLateralLoadMN: Number(runtime.attachedJoint.lateralForceN) / 1e6 || 0,
        attachedJointBendingMomentMNm: Number(runtime.attachedJoint.bendingMomentNm) / 1e6 || 0,
        attachedJointAngularMomentMNm: Number(runtime.attachedJoint.angularMomentNm) / 1e6 || 0,
        attachedJointErrorM: length(runtime.attachedJoint.positionErrorKm || { x: 0, y: 0, z: 0 }) * 1000,
        attachedJointAxialErrorM: Math.abs(Number(runtime.attachedJoint.axialErrorKm) || 0) * 1000,
        attachedJointLateralErrorM: Math.abs(Number(runtime.attachedJoint.lateralErrorKm) || 0) * 1000,
        attachedJointRelativeSpeedMS: length(runtime.attachedJoint.relativeVelocityKmS || { x: 0, y: 0, z: 0 }) * 1000,
        attachedJointAxialCompressionM: Number(runtime.attachedJoint.axialCompressionM) || 0,
        attachedJointLateralDeflectionM: Number(runtime.attachedJoint.lateralDeflectionM) || 0,
        attachedJointAngularDeflectionDeg: Number(runtime.attachedJoint.angularDeflectionDeg) || 0,
        attachedJointPlumeImpingementMN: Number(runtime.attachedJoint.plumeImpingementForceN) / 1e6 || 0,
        hotstagePhysicalSeparationKm: Number(runtime.attachedJoint.physicalSeparationKm) || 0,
        hotstagePhysicalSeparationRateKmS: Number(runtime.attachedJoint.physicalSeparationRateKmS) || 0,
        hotstagePhysicalLateralOffsetKm: Number(runtime.attachedJoint.physicalLateralOffsetKm) || 0,
        hotstageReleaseContactActive: Boolean(runtime.attachedJoint.releaseContactActive),
        attachedJointShipMassKg: Number(runtime.attachedJoint.shipMassKg) || 0,
        attachedJointBoosterMassKg: Number(runtime.attachedJoint.boosterMassKg) || 0,
        boosterActive: runtime.booster.active,
        boosterLanded: runtime.booster.landed,
        boosterCrashed: runtime.booster.crashed,
        boosterTerminalOutcome: String(runtime.booster.terminalOutcome || ""),
        boosterTerminalReason: String(runtime.booster.terminalReason || ""),
        boosterImpactSpeedKmS: finiteOrNull(runtime.booster.impactSpeedKmS),
        boosterImpactVerticalSpeedKmS: finiteOrNull(runtime.booster.impactVerticalSpeedKmS),
        boosterImpactLateralSpeedKmS: finiteOrNull(runtime.booster.impactLateralSpeedKmS),
        boosterImpactBodyUpAlignment: finiteOrNull(runtime.booster.impactBodyUpAlignment),
        boosterCrashDynamicsActive: Boolean(runtime.booster.crashDynamics?.active),
        boosterCrashSettled: Boolean(runtime.booster.crashDynamics?.settled),
        boosterCrashMode: String(runtime.booster.crashDynamics?.mode || ""),
        boosterCrashTipAngleDeg: Number(runtime.booster.crashDynamics?.tipAngleDeg) || 0,
        boosterCrashAngularSpeedRadS: Number(runtime.booster.crashDynamics?.angularSpeedRadS) || 0,
        boosterCrashSlideSpeedKmS: Number(runtime.booster.crashDynamics?.slideSpeedKmS) || 0,
        boosterCrashNormalSpeedKmS: Number(runtime.booster.crashDynamics?.normalSpeedKmS) || 0,
        boosterCrashClearanceKm: Number(runtime.booster.crashDynamics?.clearanceKm) || BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM,
        boosterCrashBodyAboveTerrainKm: finiteOrNull(runtime.booster.crashDynamics?.bodyAboveTerrainKm),
        boosterCrashSurfaceContact: Boolean(runtime.booster.crashDynamics?.lastSurfaceContact),
        boosterThrottle: Number(runtime.booster.lastStep?.throttle) || 0,
        boosterThrustN: Number(runtime.booster.lastStep?.thrustN) || 0,
        activeEngineIndices: Array.isArray(runtime.lastStep?.activeEngineIndices)
          ? [...runtime.lastStep.activeEngineIndices]
          : [],
        activeEngineCount: Math.max(0, Number(runtime.lastStep?.activeEngineCount) || 0),
        desiredEngineCount: Math.max(0, Number(runtime.lastStep?.desiredEngineCount) || 0),
        failedEngineIndices: Array.isArray(runtime.lastStep?.failedEngineIndices)
          ? [...runtime.lastStep.failedEngineIndices]
          : [],
        faultedEngineIndices: Array.isArray(runtime.lastStep?.faultedEngineIndices)
          ? [...runtime.lastStep.faultedEngineIndices]
          : [],
        flamePresentIndices: Array.isArray(runtime.lastStep?.flamePresentIndices)
          ? [...runtime.lastStep.flamePresentIndices]
          : [],
        chamberPressurePaByIndex: Array.isArray(runtime.lastStep?.chamberPressurePaByIndex)
          ? [...runtime.lastStep.chamberPressurePaByIndex]
          : [],
        exhaustTemperatureKByIndex: Array.isArray(runtime.lastStep?.exhaustTemperatureKByIndex)
          ? [...runtime.lastStep.exhaustTemperatureKByIndex]
          : [],
        avgChamberPressurePa: Number(runtime.lastStep?.avgChamberPressurePa) || 0,
        maxChamberPressurePa: Number(runtime.lastStep?.maxChamberPressurePa) || 0,
        avgCombustionEfficiency: Number(runtime.lastStep?.avgCombustionEfficiency) || 0,
        avgTurbopumpNorm: Number(runtime.lastStep?.avgTurbopumpNorm) || 0,
        maxExhaustTemperatureK: Number(runtime.lastStep?.maxExhaustTemperatureK) || 0,
        boosterActiveEngineIndices: Array.isArray(runtime.booster.lastStep?.activeEngineIndices)
          ? [...runtime.booster.lastStep.activeEngineIndices]
          : [],
        boosterActiveEngineCount: Math.max(0, Number(runtime.booster.lastStep?.activeEngineCount) || 0),
        boosterDesiredEngineCount: Math.max(0, Number(runtime.booster.lastStep?.desiredEngineCount) || 0),
        boosterFailedEngineIndices: Array.isArray(runtime.booster.lastStep?.failedEngineIndices)
          ? [...runtime.booster.lastStep.failedEngineIndices]
          : [],
        boosterFaultedEngineIndices: Array.isArray(runtime.booster.lastStep?.faultedEngineIndices)
          ? [...runtime.booster.lastStep.faultedEngineIndices]
          : [],
        boosterFlamePresentIndices: Array.isArray(runtime.booster.lastStep?.flamePresentIndices)
          ? [...runtime.booster.lastStep.flamePresentIndices]
          : [],
        boosterChamberPressurePaByIndex: Array.isArray(runtime.booster.lastStep?.chamberPressurePaByIndex)
          ? [...runtime.booster.lastStep.chamberPressurePaByIndex]
          : [],
        boosterExhaustTemperatureKByIndex: Array.isArray(runtime.booster.lastStep?.exhaustTemperatureKByIndex)
          ? [...runtime.booster.lastStep.exhaustTemperatureKByIndex]
          : [],
        boosterCombustionEfficiencyByIndex: Array.isArray(runtime.booster.lastStep?.combustionEfficiencyByIndex)
          ? [...runtime.booster.lastStep.combustionEfficiencyByIndex]
          : [],
        boosterTurbopumpNormByIndex: Array.isArray(runtime.booster.lastStep?.turbopumpNormByIndex)
          ? [...runtime.booster.lastStep.turbopumpNormByIndex]
          : [],
        boosterEngineThrustNByIndex: Array.isArray(runtime.booster.lastStep?.engineThrustNByIndex)
          ? [...runtime.booster.lastStep.engineThrustNByIndex]
          : [],
        boosterAvgChamberPressurePa: Number(runtime.booster.lastStep?.avgChamberPressurePa) || 0,
        boosterMaxChamberPressurePa: Number(runtime.booster.lastStep?.maxChamberPressurePa) || 0,
	        boosterAvgCombustionEfficiency: Number(runtime.booster.lastStep?.avgCombustionEfficiency) || 0,
	        boosterAvgTurbopumpNorm: Number(runtime.booster.lastStep?.avgTurbopumpNorm) || 0,
	        boosterMaxExhaustTemperatureK: Number(runtime.booster.lastStep?.maxExhaustTemperatureK) || 0,
	        boosterMainThrustDirectionKm: cloneLaunchVectorOrNull(runtime.booster.lastStep?.mainThrustDirectionKm),
	        boosterRequestedThrustVerticalComponent: finiteOrNull(runtime.booster.lastStep?.requestedThrustVerticalComponent),
	        boosterMainThrustVerticalComponent: finiteOrNull(runtime.booster.lastStep?.mainThrustVerticalComponent),
	        boosterMainThrustMinUpComponent: Number(runtime.booster.lastStep?.mainThrustMinUpComponent) || 0,
	        boosterMainThrustVerticalFloorActive: Boolean(runtime.booster.lastStep?.mainThrustVerticalFloorActive),
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
        boosterBodyRetrogradeAlignment: Number(runtime.booster.lastStep?.bodyRetrogradeAlignment) || 0,
        boosterBodyAntiTangentAlignment: Number(runtime.booster.lastStep?.bodyAntiTangentAlignment) || 0,
        boosterBodyUpAlignment: Number(runtime.booster.lastStep?.bodyUpAlignment) || 0,
        boosterTerminalUprightCommit: Boolean(runtime.booster.lastStep?.terminalUprightCommit),
        boosterUprightTiltLimitDeg: Number(runtime.booster.lastStep?.uprightTiltLimitDeg) || 0,
        boosterPredictiveCatchActive: Boolean(runtime.booster.lastStep?.predictiveCatchActive),
        boosterCatchInterceptTimeSec: Number(runtime.booster.lastStep?.catchInterceptTimeSec) || 0,
        boosterCatchGuidanceBlend: Number(runtime.booster.lastStep?.catchGuidanceBlend) || 0,
        boosterCatchPredictedLateralMissKm: Number(runtime.booster.lastStep?.catchPredictedLateralMissKm) || 0,
        boosterCatchPredictedVerticalMissKm: Number(runtime.booster.lastStep?.catchPredictedVerticalMissKm) || 0,
        boosterCatchPredictedTotalMissKm: Number(runtime.booster.lastStep?.catchPredictedTotalMissKm) || 0,
        boosterCatchDesiredEastSpeedKmS: Number(runtime.booster.lastStep?.catchDesiredEastSpeedKmS) || 0,
        boosterCatchDesiredNorthSpeedKmS: Number(runtime.booster.lastStep?.catchDesiredNorthSpeedKmS) || 0,
        boosterCatchDesiredVerticalSpeedKmS: Number(runtime.booster.lastStep?.catchDesiredVerticalSpeedKmS) || 0,
        boosterCatchCaptureActive: Boolean(runtime.booster.telemetry?.catchCaptureActive),
        boosterCatchCapturePhase: String(runtime.booster.telemetry?.catchCapturePhase || ""),
        boosterCatchCaptureClosureNorm: Number(runtime.booster.telemetry?.catchCaptureClosureNorm) || 0,
        boosterCatchCaptureLoadN: Number(runtime.booster.telemetry?.catchCaptureLoadN) || 0,
        boosterCatchCaptureLoadG: Number(runtime.booster.telemetry?.catchCaptureLoadG) || 0,
        boosterCatchCaptureLateralErrorKm: finiteOrNull(runtime.booster.telemetry?.catchCaptureLateralErrorKm),
        boosterCatchCaptureVerticalErrorKm: finiteOrNull(runtime.booster.telemetry?.catchCaptureVerticalErrorKm),
        boosterCatchCaptureTotalErrorKm: finiteOrNull(runtime.booster.telemetry?.catchCaptureTotalErrorKm),
        boosterCatchCaptureTotalSpeedKmS: finiteOrNull(runtime.booster.telemetry?.catchCaptureTotalSpeedKmS),
        boosterCatchCaptureSettleHoldSec: Number(runtime.booster.telemetry?.catchCaptureSettleHoldSec) || 0,
        boosterRequestedOffRetrogradeDeg: Number.isFinite(Number(runtime.booster.telemetry?.requestedOffRetrogradeDeg))
          ? Number(runtime.booster.telemetry?.requestedOffRetrogradeDeg)
          : null,
        boosterBodyOffRetrogradeDeg: Number.isFinite(Number(runtime.booster.telemetry?.bodyOffRetrogradeDeg))
          ? Number(runtime.booster.telemetry?.bodyOffRetrogradeDeg)
          : null,
        boosterBodyAngularRateRadS: cloneLaunchVectorOrNull(runtime.booster.lastStep?.bodyAngularRateRadS),
        boosterRecoveryHardwareMode: String(runtime.booster.lastStep?.recoveryHardwareMode || ""),
        boosterRecoveryControlStack: Array.isArray(runtime.booster.lastStep?.recoveryControlStack)
          ? [...runtime.booster.lastStep.recoveryControlStack]
          : [],
        boosterGridFinGeneration: String(runtime.booster.lastStep?.gridFinGeneration || ""),
        boosterGridFinRole: String(runtime.booster.lastStep?.gridFinRole || ""),
        boosterGridFinControlDominant: Boolean(runtime.booster.lastStep?.gridFinControlDominant),
        boosterGridFinDeploymentState: String(runtime.booster.lastStep?.gridFinDeploymentState || ""),
        boosterGridFinPhaseState: String(runtime.booster.lastStep?.gridFinPhaseState || ""),
        boosterGridFinCommandState: String(runtime.booster.lastStep?.gridFinCommandState || ""),
        boosterGridFinAeroLoaded: Boolean(runtime.booster.lastStep?.gridFinAeroLoaded),
        boosterGridFinControlActive: Boolean(runtime.booster.lastStep?.gridFinControlActive),
        boosterGridFinSaturated: Boolean(runtime.booster.lastStep?.gridFinSaturated),
        boosterGridFinMaxDeflectionDeg: Number(runtime.booster.lastStep?.gridFinMaxDeflectionDeg) || 0,
        boosterEngineRole: String(runtime.booster.lastStep?.engineRole || ""),
        boosterEngineSet: String(runtime.booster.lastStep?.engineSet || ""),
        boosterTowerSensorMode: String(runtime.booster.lastStep?.towerSensorMode || ""),
        boosterTowerSensorHealthy: Boolean(runtime.booster.lastStep?.towerSensorHealthy),
        boosterCatchCommitState: String(runtime.booster.lastStep?.catchCommitState || ""),
        boosterGridFinAuthority: Number(runtime.booster.lastStep?.gridFinAuthority) || 0,
        boosterGridFinDeflectionDeg: Number(runtime.booster.lastStep?.gridFinDeflectionDeg) || 0,
        boosterGridFinStates: Array.isArray(runtime.booster.lastStep?.gridFinStates)
          ? runtime.booster.lastStep.gridFinStates.map((finState) => ({ ...finState }))
          : [],
        boosterGridFinMomentNm: Number(runtime.booster.lastStep?.gridFinMomentNm) || 0,
        boosterGridFinAngularAccelerationRadS2: Number(runtime.booster.lastStep?.gridFinAngularAccelerationRadS2) || 0,
        boosterEngineAsymmetryBodyTorqueNm: cloneLaunchVectorOrNull(runtime.booster.lastStep?.engineAsymmetryBodyTorqueNm),
        boosterEngineAsymmetryMomentNm: Number(runtime.booster.lastStep?.engineAsymmetryMomentNm) || 0,
        boosterAeroMomentNm: Number(runtime.booster.lastStep?.aeroMomentNm) || 0,
        boosterEngineAngularAccelerationRadS2: Number(runtime.booster.lastStep?.engineAngularAccelerationRadS2) || 0,
        boosterRcsAngularAccelerationRadS2: Number(runtime.booster.lastStep?.rcsAngularAccelerationRadS2) || 0,
        boosterAttitudeTorqueSources: Array.isArray(runtime.booster.lastStep?.attitudeTorqueSources)
          ? [...runtime.booster.lastStep.attitudeTorqueSources]
          : [],
        boosterAttitudeTorqueSourceText: String(runtime.booster.lastStep?.attitudeTorqueSourceText || ""),
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
        boosterCatchLateralRangeKm: Number(runtime.booster.telemetry?.catchLateralRangeKm) || null,
        boosterCatchVerticalErrorKm: Number.isFinite(Number(runtime.booster.telemetry?.catchVerticalErrorKm))
          ? Number(runtime.booster.telemetry?.catchVerticalErrorKm)
          : null,
        boosterCatchLateralSpeedKmS: Number(runtime.booster.telemetry?.catchLateralSpeedKmS) || null,
        boosterCatchVerticalSpeedKmS: Number(runtime.booster.telemetry?.catchVerticalSpeedKmS) || null,
        boosterCatchEastErrorKm: Number.isFinite(Number(runtime.booster.telemetry?.catchEastErrorKm))
          ? Number(runtime.booster.telemetry.catchEastErrorKm)
          : null,
        boosterCatchNorthErrorKm: Number.isFinite(Number(runtime.booster.telemetry?.catchNorthErrorKm))
          ? Number(runtime.booster.telemetry.catchNorthErrorKm)
          : null,
        boosterCatchEastSpeedKmS: Number.isFinite(Number(runtime.booster.telemetry?.catchEastSpeedKmS))
          ? Number(runtime.booster.telemetry.catchEastSpeedKmS)
          : null,
        boosterCatchNorthSpeedKmS: Number.isFinite(Number(runtime.booster.telemetry?.catchNorthSpeedKmS))
          ? Number(runtime.booster.telemetry.catchNorthSpeedKmS)
          : null,
        boosterCatchAlignHoldSec: Number(runtime.booster.telemetry?.catchAlignHoldSec) || Number(runtime.booster.catchAlignHoldSec) || 0,
        boosterCatchPointContactEligible: Boolean(runtime.booster.telemetry?.catchPointContactEligible),
        boosterCatchPointSupportedPins: Number(runtime.booster.telemetry?.catchPointSupportedPins) || 0,
        boosterCatchPointSupportedArms: Number(runtime.booster.telemetry?.catchPointSupportedArms) || 0,
        boosterCatchPointMaxVerticalGapKm: finiteOrNull(runtime.booster.telemetry?.catchPointMaxVerticalGapKm),
        boosterCatchPointMaxTangentialSpeedKmS: finiteOrNull(runtime.booster.telemetry?.catchPointMaxTangentialSpeedKmS),
        boosterCatchPointMaxClosingSpeedKmS: finiteOrNull(runtime.booster.telemetry?.catchPointMaxClosingSpeedKmS),
        boosterNavSource: String(runtime.booster.telemetry?.navSource || ""),
        boosterNavPositionSigmaKm: Number(runtime.booster.telemetry?.navPositionSigmaKm) || null,
        boosterNavVelocitySigmaKmS: Number(runtime.booster.telemetry?.navVelocitySigmaKmS) || null,
        boosterNavTowerRelativeActive: Boolean(runtime.booster.telemetry?.navTowerRelativeActive),
        hotstageActive: Boolean(runtime.hotstage.active),
        hotstageShipReferenceActive: Boolean(
          runtime.hotstage?.shipReferenceActive || runtime.attachedJoint?.shipReferenceActive,
        ),
        attachedJointShipReferenceActive: Boolean(runtime.attachedJoint?.shipReferenceActive),
        hotstageTimeSinceIgnitionSec: hotstageSinceIgnitionSec,
        hotstageOverlapSeconds: Number(runtime.hotstage.overlapSeconds) || hotstageOverlapSeconds(),
        hotstageIgnitionStableSec: Number(runtime.hotstage.ignitionStableSec) || 0,
        hotstageVirtualSeparationKm: Number(runtime.hotstage.virtualSeparationKm) || 0,
        hotstagePhysicalSeparationKm: Number(runtime.hotstage.physicalSeparationKm) || Number(runtime.attachedJoint.physicalSeparationKm) || 0,
        hotstagePhysicalSeparationRateKmS: Number(runtime.hotstage.physicalSeparationRateKmS) || Number(runtime.attachedJoint.physicalSeparationRateKmS) || 0,
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
      activeEngineIndices: Array.isArray(telemetry.activeEngineIndices)
        ? [...telemetry.activeEngineIndices]
        : [],
      activeEngineCount: Math.max(0, Number(telemetry.activeEngineCount) || 0),
      desiredEngineCount: Math.max(0, Number(telemetry.desiredEngineCount) || 0),
      failedEngineIndices: Array.isArray(telemetry.failedEngineIndices)
        ? [...telemetry.failedEngineIndices]
        : [],
      faultedEngineIndices: Array.isArray(telemetry.faultedEngineIndices)
        ? [...telemetry.faultedEngineIndices]
        : [],
      flamePresentIndices: Array.isArray(telemetry.flamePresentIndices)
        ? [...telemetry.flamePresentIndices]
        : [],
      chamberPressurePaByIndex: Array.isArray(telemetry.chamberPressurePaByIndex)
        ? [...telemetry.chamberPressurePaByIndex]
        : [],
      exhaustTemperatureKByIndex: Array.isArray(telemetry.exhaustTemperatureKByIndex)
        ? [...telemetry.exhaustTemperatureKByIndex]
        : [],
      avgChamberPressurePa: Number(telemetry.avgChamberPressurePa) || 0,
      maxChamberPressurePa: Number(telemetry.maxChamberPressurePa) || 0,
      avgCombustionEfficiency: Number(telemetry.avgCombustionEfficiency) || 0,
      avgTurbopumpNorm: Number(telemetry.avgTurbopumpNorm) || 0,
      maxExhaustTemperatureK: Number(telemetry.maxExhaustTemperatureK) || 0,
      burnRateKgS: telemetry.burnRateKgS,
      dynamicPressurePa: telemetry.dynamicPressurePa,
      throttleCommand: telemetry.throttleCommand,
      angleOfAttackDeg: telemetry.angleOfAttackDeg,
      qAlphaPaRad: telemetry.qAlphaPaRad,
      machNumber: telemetry.machNumber,
      dragCoefficient: telemetry.dragCoefficient,
      liftCoefficient: telemetry.liftCoefficient,
      gimbalErrorDeg: telemetry.gimbalErrorDeg,
      attitudeTorqueSources: Array.isArray(telemetry.attitudeTorqueSources)
        ? [...telemetry.attitudeTorqueSources]
        : [],
      attitudeTorqueSourceText: String(telemetry.attitudeTorqueSourceText || ""),
      bodyAngularRateRadS: cloneLaunchVectorOrNull(telemetry.bodyAngularRateRadS),
      thrustVectorDirectionKm: cloneLaunchVectorOrNull(telemetry.thrustVectorDirectionKm),
      engineGimbalAuthority: Number(telemetry.engineGimbalAuthority) || 0,
      rcsAngularAuthority: Number(telemetry.rcsAngularAuthority) || 0,
      aeroMomentActive: Boolean(telemetry.aeroMomentActive),
      windSpeedKmS: telemetry.windSpeedKmS,
      windEastMS: telemetry.windEastMS,
      windNorthMS: telemetry.windNorthMS,
      comNormalized: telemetry.comNormalized,
      inertiaNormalized: telemetry.inertiaNormalized,
      controlAuthorityScale: telemetry.controlAuthorityScale,
      guidanceMode: telemetryGuidanceMode,
      ascentCorridorName: String(telemetry.ascentCorridorName || ""),
      ascentHeadingDegFromEast: finiteOrNull(telemetry.ascentHeadingDegFromEast),
      commandedPitchFromVerticalDeg: finiteOrNull(telemetry.commandedPitchFromVerticalDeg),
      bodyPitchFromVerticalDeg: finiteOrNull(telemetry.bodyPitchFromVerticalDeg),
      guidanceRequestedDirectionKm: cloneLaunchVectorOrNull(telemetry.guidanceRequestedDirectionKm),
      bodyAxisDirectionKm: cloneLaunchVectorOrNull(telemetry.bodyAxisDirectionKm),
      missionId: telemetry.missionId,
      missionName: telemetry.missionName,
      missionPhase: telemetry.missionPhase,
      missionPhaseDisplay: displayMissionPhaseForMission(telemetry.missionId, telemetry.missionPhase),
      missionCompleted: telemetry.missionCompleted,
      boosterEngineCountSelected: normalizeBoosterEngineCountSelection(runtime.boosterEngineCountOverride),
      boosterRecoveryEngineCountSelected: Number(
        boosterRecoveryConfigWithEngineOverride(runtime.boosterEngineCountOverride)?.engineCount,
      ) || 0,
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
      launchElapsedSeconds: finiteOrNull(telemetry.launchElapsedSeconds),
      launchSequenceActive: Boolean(telemetry.launchSequenceActive),
      launchCommitReady: Boolean(telemetry.launchCommitReady),
      launchCommitReason: String(telemetry.launchCommitReason || ""),
      launchCommitElapsedSec: finiteOrNull(telemetry.launchCommitElapsedSec),
      padReleaseComplete: Boolean(telemetry.padReleaseComplete),
      padReleaseElapsedSec: finiteOrNull(telemetry.padReleaseElapsedSec),
      towerClearSatisfied: Boolean(telemetry.towerClearSatisfied),
      towerClearElapsedSec: finiteOrNull(telemetry.towerClearElapsedSec),
      pitchoverEnabled: Boolean(telemetry.pitchoverEnabled),
      pitchoverElapsedSec: finiteOrNull(telemetry.pitchoverElapsedSec),
      hotstageDeferredCandidateActive: Boolean(telemetry.hotstageDeferredCandidateActive),
      hotstageDeferredCandidateElapsedSec: finiteOrNull(telemetry.hotstageDeferredCandidateElapsedSec),
      hotstageDeferredCandidateAltitudeKm: finiteOrNull(telemetry.hotstageDeferredCandidateAltitudeKm),
      hotstageDeferredCandidateReason: String(telemetry.hotstageDeferredCandidateReason || ""),
      hotstageArmed: Boolean(telemetry.hotstageArmed),
      hotstageArmReason: String(telemetry.hotstageArmReason || ""),
      hotstageArmedElapsedSec: finiteOrNull(telemetry.hotstageArmedElapsedSec),
      hotstageIgnitionAuthorized: Boolean(telemetry.hotstageIgnitionAuthorized),
      hotstageIgnitionElapsedSec: finiteOrNull(telemetry.hotstageIgnitionElapsedSec),
      hotstageReleaseAuthorized: Boolean(telemetry.hotstageReleaseAuthorized),
      hotstageReleaseElapsedSec: finiteOrNull(telemetry.hotstageReleaseElapsedSec),
      stageTransitionPending: Boolean(runtime.pendingStageTransition?.active),
      stageTransitionKind: runtime.pendingStageTransition?.active ? String(runtime.pendingStageTransition.kind || "") : "",
      stageTransitionWaitReason: runtime.pendingStageTransition?.active ? String(runtime.pendingStageTransition.waitReason || "") : "",
      stageTransitionHoldMode: runtime.pendingStageTransition?.active ? String(runtime.pendingStageTransition.holdMode || "") : "",
      stageTransitionAuthorizationMode: runtime.pendingStageTransition?.active ? String(runtime.pendingStageTransition.authorizationMode || "") : "",
      stageTransitionAnomalyActive: Boolean(runtime.pendingStageTransition?.active && runtime.pendingStageTransition?.anomalyActive),
      stageTransitionAnomalyReason: runtime.pendingStageTransition?.active ? String(runtime.pendingStageTransition.anomalyReason || "") : "",
      stageTransitionAnomalyElapsedSec: runtime.pendingStageTransition?.active ? finiteOrNull(runtime.pendingStageTransition.anomalyElapsedSec) : null,
      targetBodyId: targetDescriptor.bodyId,
      targetBodyName: targetDescriptor.bodyName,
      targetDistanceKm: targetDescriptor.distanceKm,
      targetClosingSpeedKmS: targetDescriptor.closingSpeedKmS,
      ...directionTelemetry,
      autopilotMode: telemetry.autopilotMode,
      rcsActive: telemetryRcsActive,
      rcsErrorDeg: telemetry.rcsErrorDeg,
      rcsAuthority: telemetryRcsAuthority,
      rcsLinearAuthority: Number(telemetry.rcsLinearAuthority) || 0,
      rcsAngularAuthority: Number(telemetry.rcsAngularAuthority) || 0,
      rcsAccelerationKmS2: cloneLaunchVectorOrNull(telemetry.rcsAccelerationKmS2),
      rcsAccelerationMagKmS2: Number(telemetry.rcsAccelerationMagKmS2) || 0,
      rcsThrustN: Number(telemetry.rcsThrustN) || 0,
      rcsBurnKg: Number(telemetry.rcsBurnKg) || 0,
      rcsBurnRateKgS: Number(telemetry.rcsBurnRateKgS) || 0,
      rcsPropellantKg: Number(telemetry.rcsPropellantKg) || 0,
      rcsInitialPropellantKg: Number(telemetry.rcsInitialPropellantKg) || 0,
      rcsFuelFraction: Number.isFinite(Number(telemetry.rcsFuelFraction))
        ? clamp(Number(telemetry.rcsFuelFraction), 0, 1)
        : null,
      rcsJets: telemetryRcsJets,
      rcsCommandedThrusterIds: Array.isArray(telemetry.rcsCommandedThrusterIds)
        ? [...telemetry.rcsCommandedThrusterIds]
        : [],
      rcsCommandedThrusterIndices: Array.isArray(telemetry.rcsCommandedThrusterIndices)
        ? [...telemetry.rcsCommandedThrusterIndices]
        : [],
      rcsActiveThrusterIds: Array.isArray(telemetry.rcsActiveThrusterIds)
        ? [...telemetry.rcsActiveThrusterIds]
        : [],
      rcsActiveThrusterIndices: Array.isArray(telemetry.rcsActiveThrusterIndices)
        ? [...telemetry.rcsActiveThrusterIndices]
        : [],
      rcsBodyForceN: cloneLaunchVectorOrNull(telemetry.rcsBodyForceN),
      rcsBodyTorqueNm: cloneLaunchVectorOrNull(telemetry.rcsBodyTorqueNm),
      rcsThrusterThrustNByIndex: Array.isArray(telemetry.rcsThrusterThrustNByIndex)
        ? [...telemetry.rcsThrusterThrustNByIndex]
        : [],
      rcsChamberPressurePaByIndex: Array.isArray(telemetry.rcsChamberPressurePaByIndex)
        ? [...telemetry.rcsChamberPressurePaByIndex]
        : [],
      rcsExhaustTemperatureKByIndex: Array.isArray(telemetry.rcsExhaustTemperatureKByIndex)
        ? [...telemetry.rcsExhaustTemperatureKByIndex]
        : [],
      rcsCombustionEfficiencyByIndex: Array.isArray(telemetry.rcsCombustionEfficiencyByIndex)
        ? [...telemetry.rcsCombustionEfficiencyByIndex]
        : [],
      rcsTurbopumpNormByIndex: Array.isArray(telemetry.rcsTurbopumpNormByIndex)
        ? [...telemetry.rcsTurbopumpNormByIndex]
        : [],
      rcsAvgChamberPressurePa: Number(telemetry.rcsAvgChamberPressurePa) || 0,
      rcsMaxChamberPressurePa: Number(telemetry.rcsMaxChamberPressurePa) || 0,
      rcsAvgCombustionEfficiency: Number(telemetry.rcsAvgCombustionEfficiency) || 0,
      rcsAvgTurbopumpNorm: Number(telemetry.rcsAvgTurbopumpNorm) || 0,
      rcsMaxExhaustTemperatureK: Number(telemetry.rcsMaxExhaustTemperatureK) || 0,
      navSource: String(telemetry.navSource || ""),
      navSensorNoiseActive: Boolean(telemetry.navSensorNoiseActive),
      navPositionSigmaKm: Number(telemetry.navPositionSigmaKm) || 0,
      navVelocitySigmaKmS: Number(telemetry.navVelocitySigmaKmS) || 0,
      navAttitudeSigmaDeg: Number(telemetry.navAttitudeSigmaDeg) || 0,
      navPositionErrorKm: cloneLaunchVectorOrNull(telemetry.navPositionErrorKm),
      navVelocityErrorKmS: cloneLaunchVectorOrNull(telemetry.navVelocityErrorKmS),
      navAttitudeErrorDeg: cloneLaunchVectorOrNull(telemetry.navAttitudeErrorDeg),
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
      attachedJointAxialLoadMN: Number(runtime.attachedJoint.axialCompressionForceN) / 1e6 || 0,
      attachedJointLateralLoadMN: Number(runtime.attachedJoint.lateralForceN) / 1e6 || 0,
      attachedJointBendingMomentMNm: Number(runtime.attachedJoint.bendingMomentNm) / 1e6 || 0,
      attachedJointAngularMomentMNm: Number(runtime.attachedJoint.angularMomentNm) / 1e6 || 0,
      attachedJointErrorM: length(runtime.attachedJoint.positionErrorKm || { x: 0, y: 0, z: 0 }) * 1000,
      attachedJointAxialErrorM: Math.abs(Number(runtime.attachedJoint.axialErrorKm) || 0) * 1000,
      attachedJointLateralErrorM: Math.abs(Number(runtime.attachedJoint.lateralErrorKm) || 0) * 1000,
      attachedJointRelativeSpeedMS: length(runtime.attachedJoint.relativeVelocityKmS || { x: 0, y: 0, z: 0 }) * 1000,
      attachedJointAxialCompressionM: Number(runtime.attachedJoint.axialCompressionM) || 0,
      attachedJointLateralDeflectionM: Number(runtime.attachedJoint.lateralDeflectionM) || 0,
      attachedJointAngularDeflectionDeg: Number(runtime.attachedJoint.angularDeflectionDeg) || 0,
      attachedJointPlumeImpingementMN: Number(runtime.attachedJoint.plumeImpingementForceN) / 1e6 || 0,
      hotstagePhysicalSeparationKm: Number(runtime.attachedJoint.physicalSeparationKm) || 0,
      hotstagePhysicalSeparationRateKmS: Number(runtime.attachedJoint.physicalSeparationRateKmS) || 0,
      hotstagePhysicalLateralOffsetKm: Number(runtime.attachedJoint.physicalLateralOffsetKm) || 0,
      hotstageReleaseContactActive: Boolean(runtime.attachedJoint.releaseContactActive),
      attachedJointShipMassKg: Number(runtime.attachedJoint.shipMassKg) || 0,
      attachedJointBoosterMassKg: Number(runtime.attachedJoint.boosterMassKg) || 0,
      boosterAttached: runtime.booster.attached,
      boosterActive: runtime.booster.active,
      boosterLanded: runtime.booster.landed,
      boosterCrashed: runtime.booster.crashed,
      boosterTerminalOutcome: String(runtime.booster.terminalOutcome || ""),
      boosterTerminalReason: String(runtime.booster.terminalReason || ""),
      boosterImpactSpeedKmS: finiteOrNull(runtime.booster.impactSpeedKmS),
      boosterImpactVerticalSpeedKmS: finiteOrNull(runtime.booster.impactVerticalSpeedKmS),
      boosterImpactLateralSpeedKmS: finiteOrNull(runtime.booster.impactLateralSpeedKmS),
      boosterImpactBodyUpAlignment: finiteOrNull(runtime.booster.impactBodyUpAlignment),
      boosterCrashDynamicsActive: Boolean(runtime.booster.telemetry?.crashDynamicsActive)
        || Boolean(runtime.booster.crashDynamics?.active),
      boosterCrashSettled: Boolean(runtime.booster.telemetry?.crashSettled)
        || Boolean(runtime.booster.crashDynamics?.settled),
      boosterCrashMode: String(runtime.booster.telemetry?.crashMode || runtime.booster.crashDynamics?.mode || ""),
      boosterCrashTipAngleDeg: Number(runtime.booster.telemetry?.crashTipAngleDeg)
        || Number(runtime.booster.crashDynamics?.tipAngleDeg)
        || 0,
      boosterCrashAngularSpeedRadS: Number(runtime.booster.telemetry?.crashAngularSpeedRadS)
        || Number(runtime.booster.crashDynamics?.angularSpeedRadS)
        || 0,
      boosterCrashSlideSpeedKmS: Number(runtime.booster.telemetry?.crashSlideSpeedKmS)
        || Number(runtime.booster.crashDynamics?.slideSpeedKmS)
        || 0,
      boosterCrashNormalSpeedKmS: Number(runtime.booster.telemetry?.crashNormalSpeedKmS)
        || Number(runtime.booster.crashDynamics?.normalSpeedKmS)
        || 0,
      boosterCrashClearanceKm: Number(runtime.booster.telemetry?.crashClearanceKm)
        || Number(runtime.booster.crashDynamics?.clearanceKm)
        || BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM,
      boosterCrashBodyAboveTerrainKm: finiteOrNull(
        runtime.booster.telemetry?.crashBodyAboveTerrainKm ?? runtime.booster.crashDynamics?.bodyAboveTerrainKm,
      ),
      boosterCrashSurfaceContact: Boolean(runtime.booster.telemetry?.crashSurfaceContact)
        || Boolean(runtime.booster.crashDynamics?.lastSurfaceContact),
      boosterThrottle: Number(runtime.booster.telemetry?.throttle) || Number(runtime.booster.lastStep?.throttle) || 0,
      boosterThrustN: Number(runtime.booster.telemetry?.thrustN) || Number(runtime.booster.lastStep?.thrustN) || 0,
      boosterActiveEngineIndices: Array.isArray(runtime.booster.telemetry?.activeEngineIndices)
        ? [...runtime.booster.telemetry.activeEngineIndices]
        : (Array.isArray(runtime.booster.lastStep?.activeEngineIndices) ? [...runtime.booster.lastStep.activeEngineIndices] : []),
      boosterActiveEngineCount: Number(runtime.booster.telemetry?.activeEngineCount)
        || Number(runtime.booster.lastStep?.activeEngineCount)
        || 0,
      boosterDesiredEngineCount: Number(runtime.booster.telemetry?.desiredEngineCount)
        || Number(runtime.booster.lastStep?.desiredEngineCount)
        || 0,
      boosterFailedEngineIndices: Array.isArray(runtime.booster.telemetry?.failedEngineIndices)
        ? [...runtime.booster.telemetry.failedEngineIndices]
        : (Array.isArray(runtime.booster.lastStep?.failedEngineIndices) ? [...runtime.booster.lastStep.failedEngineIndices] : []),
      boosterFaultedEngineIndices: Array.isArray(runtime.booster.telemetry?.faultedEngineIndices)
        ? [...runtime.booster.telemetry.faultedEngineIndices]
        : (Array.isArray(runtime.booster.lastStep?.faultedEngineIndices) ? [...runtime.booster.lastStep.faultedEngineIndices] : []),
      boosterFlamePresentIndices: Array.isArray(runtime.booster.telemetry?.flamePresentIndices)
        ? [...runtime.booster.telemetry.flamePresentIndices]
        : (Array.isArray(runtime.booster.lastStep?.flamePresentIndices) ? [...runtime.booster.lastStep.flamePresentIndices] : []),
      boosterChamberPressurePaByIndex: Array.isArray(runtime.booster.telemetry?.chamberPressurePaByIndex)
        ? [...runtime.booster.telemetry.chamberPressurePaByIndex]
        : (Array.isArray(runtime.booster.lastStep?.chamberPressurePaByIndex) ? [...runtime.booster.lastStep.chamberPressurePaByIndex] : []),
      boosterExhaustTemperatureKByIndex: Array.isArray(runtime.booster.telemetry?.exhaustTemperatureKByIndex)
        ? [...runtime.booster.telemetry.exhaustTemperatureKByIndex]
        : (Array.isArray(runtime.booster.lastStep?.exhaustTemperatureKByIndex) ? [...runtime.booster.lastStep.exhaustTemperatureKByIndex] : []),
      boosterCombustionEfficiencyByIndex: Array.isArray(runtime.booster.telemetry?.combustionEfficiencyByIndex)
        ? [...runtime.booster.telemetry.combustionEfficiencyByIndex]
        : (Array.isArray(runtime.booster.lastStep?.combustionEfficiencyByIndex) ? [...runtime.booster.lastStep.combustionEfficiencyByIndex] : []),
      boosterTurbopumpNormByIndex: Array.isArray(runtime.booster.telemetry?.turbopumpNormByIndex)
        ? [...runtime.booster.telemetry.turbopumpNormByIndex]
        : (Array.isArray(runtime.booster.lastStep?.turbopumpNormByIndex) ? [...runtime.booster.lastStep.turbopumpNormByIndex] : []),
      boosterEngineThrustNByIndex: Array.isArray(runtime.booster.telemetry?.engineThrustNByIndex)
        ? [...runtime.booster.telemetry.engineThrustNByIndex]
        : (Array.isArray(runtime.booster.lastStep?.engineThrustNByIndex) ? [...runtime.booster.lastStep.engineThrustNByIndex] : []),
      boosterAvgChamberPressurePa: Number(runtime.booster.telemetry?.avgChamberPressurePa)
        || Number(runtime.booster.lastStep?.avgChamberPressurePa)
        || 0,
      boosterMaxChamberPressurePa: Number(runtime.booster.telemetry?.maxChamberPressurePa)
        || Number(runtime.booster.lastStep?.maxChamberPressurePa)
        || 0,
      boosterAvgCombustionEfficiency: Number(runtime.booster.telemetry?.avgCombustionEfficiency)
        || Number(runtime.booster.lastStep?.avgCombustionEfficiency)
        || 0,
	      boosterAvgTurbopumpNorm: Number(runtime.booster.telemetry?.avgTurbopumpNorm)
	        || Number(runtime.booster.lastStep?.avgTurbopumpNorm)
	        || 0,
	      boosterMaxExhaustTemperatureK: Number(runtime.booster.telemetry?.maxExhaustTemperatureK)
	        || Number(runtime.booster.lastStep?.maxExhaustTemperatureK)
	        || 0,
	      boosterMainThrustDirectionKm: cloneLaunchVectorOrNull(runtime.booster.telemetry?.mainThrustDirectionKm)
	        || cloneLaunchVectorOrNull(runtime.booster.lastStep?.mainThrustDirectionKm),
	      boosterRequestedThrustVerticalComponent: finiteOrNull(
	        runtime.booster.telemetry?.requestedThrustVerticalComponent
	          ?? runtime.booster.lastStep?.requestedThrustVerticalComponent,
	      ),
	      boosterMainThrustVerticalComponent: finiteOrNull(
	        runtime.booster.telemetry?.mainThrustVerticalComponent
	          ?? runtime.booster.lastStep?.mainThrustVerticalComponent,
	      ),
	      boosterMainThrustMinUpComponent: Number(runtime.booster.telemetry?.mainThrustMinUpComponent)
	        || Number(runtime.booster.lastStep?.mainThrustMinUpComponent)
	        || 0,
	      boosterMainThrustVerticalFloorActive: Boolean(
	        runtime.booster.telemetry?.mainThrustVerticalFloorActive
	          ?? runtime.booster.lastStep?.mainThrustVerticalFloorActive,
	      ),
	      boosterRcsActive: Boolean(runtime.booster.telemetry?.rcsActive ?? runtime.booster.lastStep?.rcsActive),
      boosterRcsBurnRateKgS: Number(runtime.booster.telemetry?.rcsBurnRateKgS)
        || Number(runtime.booster.lastStep?.rcsBurnRateKgS)
        || 0,
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
      boosterRcsActiveThrusterIndices: Array.isArray(runtime.booster.telemetry?.rcsActiveThrusterIndices)
        ? [...runtime.booster.telemetry.rcsActiveThrusterIndices]
        : (Array.isArray(runtime.booster.lastStep?.rcsActiveThrusterIndices) ? [...runtime.booster.lastStep.rcsActiveThrusterIndices] : []),
      boosterRcsFailedThrusterIndices: Array.isArray(runtime.booster.telemetry?.rcsFailedThrusterIndices)
        ? [...runtime.booster.telemetry.rcsFailedThrusterIndices]
        : (Array.isArray(runtime.booster.lastStep?.rcsFailedThrusterIndices) ? [...runtime.booster.lastStep.rcsFailedThrusterIndices] : []),
      boosterRcsFaultedThrusterIndices: Array.isArray(runtime.booster.telemetry?.rcsFaultedThrusterIndices)
        ? [...runtime.booster.telemetry.rcsFaultedThrusterIndices]
        : (Array.isArray(runtime.booster.lastStep?.rcsFaultedThrusterIndices) ? [...runtime.booster.lastStep.rcsFaultedThrusterIndices] : []),
      boosterRcsFlamePresentThrusterIndices: Array.isArray(runtime.booster.telemetry?.rcsFlamePresentThrusterIndices)
        ? [...runtime.booster.telemetry.rcsFlamePresentThrusterIndices]
        : (Array.isArray(runtime.booster.lastStep?.rcsFlamePresentThrusterIndices) ? [...runtime.booster.lastStep.rcsFlamePresentThrusterIndices] : []),
      boosterRcsChamberPressurePaByIndex: Array.isArray(runtime.booster.telemetry?.rcsChamberPressurePaByIndex)
        ? [...runtime.booster.telemetry.rcsChamberPressurePaByIndex]
        : (Array.isArray(runtime.booster.lastStep?.rcsChamberPressurePaByIndex) ? [...runtime.booster.lastStep.rcsChamberPressurePaByIndex] : []),
      boosterRcsExhaustTemperatureKByIndex: Array.isArray(runtime.booster.telemetry?.rcsExhaustTemperatureKByIndex)
        ? [...runtime.booster.telemetry.rcsExhaustTemperatureKByIndex]
        : (Array.isArray(runtime.booster.lastStep?.rcsExhaustTemperatureKByIndex) ? [...runtime.booster.lastStep.rcsExhaustTemperatureKByIndex] : []),
      boosterRcsCombustionEfficiencyByIndex: Array.isArray(runtime.booster.telemetry?.rcsCombustionEfficiencyByIndex)
        ? [...runtime.booster.telemetry.rcsCombustionEfficiencyByIndex]
        : (Array.isArray(runtime.booster.lastStep?.rcsCombustionEfficiencyByIndex) ? [...runtime.booster.lastStep.rcsCombustionEfficiencyByIndex] : []),
      boosterRcsTurbopumpNormByIndex: Array.isArray(runtime.booster.telemetry?.rcsTurbopumpNormByIndex)
        ? [...runtime.booster.telemetry.rcsTurbopumpNormByIndex]
        : (Array.isArray(runtime.booster.lastStep?.rcsTurbopumpNormByIndex) ? [...runtime.booster.lastStep.rcsTurbopumpNormByIndex] : []),
      boosterRcsThrusterThrustNByIndex: Array.isArray(runtime.booster.telemetry?.rcsThrusterThrustNByIndex)
        ? [...runtime.booster.telemetry.rcsThrusterThrustNByIndex]
        : (Array.isArray(runtime.booster.lastStep?.rcsThrusterThrustNByIndex) ? [...runtime.booster.lastStep.rcsThrusterThrustNByIndex] : []),
      boosterRcsAvgChamberPressurePa: Number(runtime.booster.telemetry?.rcsAvgChamberPressurePa)
        || Number(runtime.booster.lastStep?.rcsAvgChamberPressurePa)
        || 0,
      boosterRcsMaxChamberPressurePa: Number(runtime.booster.telemetry?.rcsMaxChamberPressurePa)
        || Number(runtime.booster.lastStep?.rcsMaxChamberPressurePa)
        || 0,
      boosterRcsAvgCombustionEfficiency: Number(runtime.booster.telemetry?.rcsAvgCombustionEfficiency)
        || Number(runtime.booster.lastStep?.rcsAvgCombustionEfficiency)
        || 0,
      boosterRcsAvgTurbopumpNorm: Number(runtime.booster.telemetry?.rcsAvgTurbopumpNorm)
        || Number(runtime.booster.lastStep?.rcsAvgTurbopumpNorm)
        || 0,
      boosterRcsMaxExhaustTemperatureK: Number(runtime.booster.telemetry?.rcsMaxExhaustTemperatureK)
        || Number(runtime.booster.lastStep?.rcsMaxExhaustTemperatureK)
        || 0,
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
      boosterRecoveryHardwareMode: String(runtime.booster.telemetry?.recoveryHardwareMode || runtime.booster.lastStep?.recoveryHardwareMode || ""),
      boosterRecoveryControlStack: Array.isArray(runtime.booster.telemetry?.recoveryControlStack)
        ? [...runtime.booster.telemetry.recoveryControlStack]
        : (Array.isArray(runtime.booster.lastStep?.recoveryControlStack) ? [...runtime.booster.lastStep.recoveryControlStack] : []),
      boosterGridFinGeneration: String(runtime.booster.telemetry?.gridFinGeneration || runtime.booster.lastStep?.gridFinGeneration || ""),
      boosterGridFinRole: String(runtime.booster.telemetry?.gridFinRole || runtime.booster.lastStep?.gridFinRole || ""),
      boosterGridFinControlDominant: Boolean(runtime.booster.telemetry?.gridFinControlDominant ?? runtime.booster.lastStep?.gridFinControlDominant),
      boosterGridFinDeploymentState: String(runtime.booster.telemetry?.gridFinDeploymentState || runtime.booster.lastStep?.gridFinDeploymentState || ""),
      boosterGridFinPhaseState: String(runtime.booster.telemetry?.gridFinPhaseState || runtime.booster.lastStep?.gridFinPhaseState || ""),
      boosterGridFinCommandState: String(runtime.booster.telemetry?.gridFinCommandState || runtime.booster.lastStep?.gridFinCommandState || ""),
      boosterGridFinAeroLoaded: Boolean(runtime.booster.telemetry?.gridFinAeroLoaded ?? runtime.booster.lastStep?.gridFinAeroLoaded),
      boosterGridFinControlActive: Boolean(runtime.booster.telemetry?.gridFinControlActive ?? runtime.booster.lastStep?.gridFinControlActive),
      boosterGridFinSaturated: Boolean(runtime.booster.telemetry?.gridFinSaturated ?? runtime.booster.lastStep?.gridFinSaturated),
      boosterGridFinMaxDeflectionDeg: Number(runtime.booster.telemetry?.gridFinMaxDeflectionDeg) || Number(runtime.booster.lastStep?.gridFinMaxDeflectionDeg) || 0,
      boosterEngineRole: String(runtime.booster.telemetry?.engineRole || runtime.booster.lastStep?.engineRole || ""),
      boosterEngineSet: String(runtime.booster.telemetry?.engineSet || runtime.booster.lastStep?.engineSet || ""),
      boosterTowerSensorMode: String(runtime.booster.telemetry?.towerSensorMode || runtime.booster.lastStep?.towerSensorMode || ""),
      boosterTowerSensorHealthy: Boolean(runtime.booster.telemetry?.towerSensorHealthy ?? runtime.booster.lastStep?.towerSensorHealthy),
      boosterCatchCommitState: String(runtime.booster.telemetry?.catchCommitState || runtime.booster.lastStep?.catchCommitState || ""),
      boosterGridFinAuthority: Number(runtime.booster.telemetry?.gridFinAuthority) || 0,
      boosterGridFinDeflectionDeg: Number(runtime.booster.telemetry?.gridFinDeflectionDeg) || 0,
      boosterGridFinStates: Array.isArray(runtime.booster.telemetry?.gridFinStates)
        ? runtime.booster.telemetry.gridFinStates.map((finState) => ({ ...finState }))
        : (Array.isArray(runtime.booster.lastStep?.gridFinStates) ? runtime.booster.lastStep.gridFinStates.map((finState) => ({ ...finState })) : []),
      boosterGridFinMomentNm: Number(runtime.booster.telemetry?.gridFinMomentNm) || 0,
      boosterGridFinAngularAccelerationRadS2: Number(runtime.booster.telemetry?.gridFinAngularAccelerationRadS2) || 0,
      boosterEngineAsymmetryBodyTorqueNm: cloneLaunchVectorOrNull(runtime.booster.telemetry?.engineAsymmetryBodyTorqueNm)
        || cloneLaunchVectorOrNull(runtime.booster.lastStep?.engineAsymmetryBodyTorqueNm),
      boosterEngineAsymmetryMomentNm: Number(runtime.booster.telemetry?.engineAsymmetryMomentNm)
        || Number(runtime.booster.lastStep?.engineAsymmetryMomentNm)
        || 0,
      boosterAeroMomentNm: Number(runtime.booster.telemetry?.aeroMomentNm)
        || Number(runtime.booster.lastStep?.aeroMomentNm)
        || 0,
      boosterEngineAngularAccelerationRadS2: Number(runtime.booster.telemetry?.engineAngularAccelerationRadS2)
        || Number(runtime.booster.lastStep?.engineAngularAccelerationRadS2)
        || 0,
      boosterRcsAngularAccelerationRadS2: Number(runtime.booster.telemetry?.rcsAngularAccelerationRadS2)
        || Number(runtime.booster.lastStep?.rcsAngularAccelerationRadS2)
        || 0,
      boosterAttitudeTorqueSources: Array.isArray(runtime.booster.telemetry?.attitudeTorqueSources)
        ? [...runtime.booster.telemetry.attitudeTorqueSources]
        : (
          Array.isArray(runtime.booster.lastStep?.attitudeTorqueSources)
            ? [...runtime.booster.lastStep.attitudeTorqueSources]
            : []
        ),
      boosterAttitudeTorqueSourceText: String(
        runtime.booster.telemetry?.attitudeTorqueSourceText
        || runtime.booster.lastStep?.attitudeTorqueSourceText
        || "",
      ),
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
      boosterCatchLateralRangeKm: Number(runtime.booster.telemetry?.catchLateralRangeKm) || null,
      boosterCatchVerticalErrorKm: Number.isFinite(Number(runtime.booster.telemetry?.catchVerticalErrorKm))
        ? Number(runtime.booster.telemetry?.catchVerticalErrorKm)
        : null,
      boosterCatchLateralSpeedKmS: Number(runtime.booster.telemetry?.catchLateralSpeedKmS) || null,
      boosterCatchVerticalSpeedKmS: Number(runtime.booster.telemetry?.catchVerticalSpeedKmS) || null,
      boosterCatchEastErrorKm: Number.isFinite(Number(runtime.booster.telemetry?.catchEastErrorKm))
        ? Number(runtime.booster.telemetry.catchEastErrorKm)
        : null,
      boosterCatchNorthErrorKm: Number.isFinite(Number(runtime.booster.telemetry?.catchNorthErrorKm))
        ? Number(runtime.booster.telemetry.catchNorthErrorKm)
        : null,
      boosterCatchEastSpeedKmS: Number.isFinite(Number(runtime.booster.telemetry?.catchEastSpeedKmS))
        ? Number(runtime.booster.telemetry.catchEastSpeedKmS)
        : null,
      boosterCatchNorthSpeedKmS: Number.isFinite(Number(runtime.booster.telemetry?.catchNorthSpeedKmS))
        ? Number(runtime.booster.telemetry.catchNorthSpeedKmS)
        : null,
      boosterCatchAlignHoldSec: Number(runtime.booster.telemetry?.catchAlignHoldSec) || Number(runtime.booster.catchAlignHoldSec) || 0,
      boosterNavSource: String(runtime.booster.telemetry?.navSource || ""),
      boosterNavPositionSigmaKm: Number(runtime.booster.telemetry?.navPositionSigmaKm) || null,
      boosterNavVelocitySigmaKmS: Number(runtime.booster.telemetry?.navVelocitySigmaKmS) || null,
      boosterNavTowerRelativeActive: Boolean(runtime.booster.telemetry?.navTowerRelativeActive),
      hotstageActive: Boolean(telemetry.hotstageActive),
      hotstageShipReferenceActive: Boolean(telemetry.hotstageShipReferenceActive)
        || Boolean(runtime.hotstage?.shipReferenceActive || runtime.attachedJoint?.shipReferenceActive),
      attachedJointShipReferenceActive: Boolean(telemetry.attachedJointShipReferenceActive)
        || Boolean(runtime.attachedJoint?.shipReferenceActive),
      hotstageTimeSinceIgnitionSec: telemetry.hotstageTimeSinceIgnitionSec,
      hotstageOverlapSeconds: telemetry.hotstageOverlapSeconds,
      hotstageIgnitionStableSec: telemetry.hotstageIgnitionStableSec,
      hotstageVirtualSeparationKm: telemetry.hotstageVirtualSeparationKm,
      hotstagePhysicalSeparationKm: Number(telemetry.hotstagePhysicalSeparationKm) || Number(runtime.hotstage.physicalSeparationKm) || Number(runtime.attachedJoint.physicalSeparationKm) || 0,
      hotstagePhysicalSeparationRateKmS: Number(telemetry.hotstagePhysicalSeparationRateKmS) || Number(runtime.hotstage.physicalSeparationRateKmS) || Number(runtime.attachedJoint.physicalSeparationRateKmS) || 0,
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

  function getBoosterEngineCountSelection() {
    return normalizeBoosterEngineCountSelection(runtime.boosterEngineCountOverride);
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
      boosterEngineCountOverride: normalizeBoosterEngineCountSelection(
        runtime.boosterEngineCountOverride,
        defaultBoosterEngineCountSelection(),
      ),
      stageActuator: cloneJson(runtime.stageActuator, createActuatorState({ x: 0, y: 0, z: 1 })),
      stageAttitude: cloneJson(runtime.stageAttitude, createBoosterAttitudeState({ x: 0, y: 0, z: 1 })),
      stageMassModel: cloneJson(runtime.stageMassModel, createMassModelState()),
      stage1Combustion: cloneJson(
        runtime.stage1Combustion,
        createStage1CombustionClusterState(runtime.boosterEngineCountOverride),
      ),
      stage2Combustion: cloneJson(runtime.stage2Combustion, createStage2CombustionClusterState()),
      stageRcsCombustion: cloneJson(runtime.stageRcsCombustion, createStage2RcsCombustionClusterState()),
      stageRcsPropellantKg: Math.max(0, finiteNumber(runtime.stageRcsPropellantKg, 0)),
      stageRcsInitialPropellantKg: Math.max(0, finiteNumber(runtime.stageRcsInitialPropellantKg, 0)),
      stageNavigation: cloneJson(runtime.stageNavigation, createStarshipNavigationState()),
      starshipStateGuard: cloneJson(runtime.starshipStateGuard, createStarshipStateGuardState()),
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
        crashed: Boolean(runtime.booster.crashed),
        terminalOutcome: String(runtime.booster.terminalOutcome || ""),
        terminalReason: String(runtime.booster.terminalReason || ""),
        impactSpeedKmS: finiteOrNull(runtime.booster.impactSpeedKmS),
        impactVerticalSpeedKmS: finiteOrNull(runtime.booster.impactVerticalSpeedKmS),
        impactLateralSpeedKmS: finiteOrNull(runtime.booster.impactLateralSpeedKmS),
        impactBodyUpAlignment: finiteOrNull(runtime.booster.impactBodyUpAlignment),
        crashDynamics: cloneJson(runtime.booster.crashDynamics, createBoosterCrashDynamicsState()),
        combustion: cloneJson(
          runtime.booster.combustion,
          createBoosterCombustionClusterState(runtime.boosterEngineCountOverride),
        ),
        rcsCombustion: cloneJson(runtime.booster.rcsCombustion, createBoosterRcsCombustionClusterState()),
        lastStep: cloneJson(runtime.booster.lastStep),
        lastSurfaceSample: cloneJson(runtime.booster.lastSurfaceSample),
        lastTrackedPositionKm: cloneVectorOrNull(runtime.booster.lastTrackedPositionKm),
        telemetry: cloneJson(runtime.booster.telemetry),
        contactHoldSec: Math.max(0, finiteNumber(runtime.booster.contactHoldSec, 0)),
        catchAlignHoldSec: Math.max(0, finiteNumber(runtime.booster.catchAlignHoldSec, 0)),
        capture: cloneJson(runtime.booster.capture, createBoosterCatchCaptureState()),
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
      launchSequence: cloneJson(runtime.launchSequence, createLaunchSequenceState()),
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
    runtime.boosterEngineCountOverride = normalizeBoosterEngineCountSelection(
      snapshot.boosterEngineCountOverride,
      runtime.boosterEngineCountOverride,
    );
    runtime.stageActuator = applyActuatorSnapshot(
      runtime.stageActuator,
      snapshot.stageActuator,
      { x: 0, y: 0, z: 1 },
    );
    runtime.stageAttitude = applyBoosterAttitudeSnapshot(
      snapshot.stageAttitude,
      normalize(
        snapshot.stageActuator?.directionActual
          || boosterBodyAxisWorld(runtime.stageAttitude || createBoosterAttitudeState({ x: 0, y: 0, z: 1 })),
        { x: 0, y: 0, z: 1 },
      ),
    );
    runtime.stageMassModel = applyMassModelSnapshot(runtime.stageMassModel, snapshot.stageMassModel);
    runtime.stage1Combustion = hydrateEngineCombustionClusterState(
      snapshot.stage1Combustion,
      stage1CombustionClusterOptions(runtime.boosterEngineCountOverride),
    );
    runtime.stage2Combustion = hydrateEngineCombustionClusterState(
      snapshot.stage2Combustion,
      stage2CombustionClusterOptions(),
    );
    runtime.stageRcsCombustion = hydrateEngineCombustionClusterState(
      snapshot.stageRcsCombustion,
      stage2RcsCombustionClusterOptions(),
    );
    runtime.stageRcsInitialPropellantKg = Math.max(
      0,
      finiteNumber(snapshot.stageRcsInitialPropellantKg, runtime.stageRcsInitialPropellantKg),
    );
    runtime.stageRcsPropellantKg = Math.max(
      0,
      finiteNumber(snapshot.stageRcsPropellantKg, runtime.stageRcsPropellantKg),
    );
    if (runtime.stageRcsInitialPropellantKg > 0) {
      runtime.stageRcsPropellantKg = Math.min(runtime.stageRcsPropellantKg, runtime.stageRcsInitialPropellantKg);
    }
    runtime.stageNavigation = resetStarshipNavigationState(snapshot.stageNavigation);
    runtime.starshipStateGuard = {
      ...createStarshipStateGuardState(),
      ...(cloneJson(snapshot.starshipStateGuard, {}) || {}),
    };
    runtime.starshipStateGuard.cleanFreeFlightActive = Boolean(runtime.starshipStateGuard.cleanFreeFlightActive);
    runtime.starshipStateGuard.cleanFreeFlightElapsedSec = finiteOrNull(runtime.starshipStateGuard.cleanFreeFlightElapsedSec);
    runtime.starshipStateGuard.cleanFreeFlightReason = String(runtime.starshipStateGuard.cleanFreeFlightReason || "");
    runtime.starshipStateGuard.directPositionCorrectionCount = Math.max(
      0,
      Math.floor(finiteNumber(runtime.starshipStateGuard.directPositionCorrectionCount, 0)),
    );
    runtime.starshipStateGuard.directVelocityCorrectionCount = Math.max(
      0,
      Math.floor(finiteNumber(runtime.starshipStateGuard.directVelocityCorrectionCount, 0)),
    );
    runtime.starshipStateGuard.blockedPositionCorrectionCount = Math.max(
      0,
      Math.floor(finiteNumber(runtime.starshipStateGuard.blockedPositionCorrectionCount, 0)),
    );
    runtime.starshipStateGuard.blockedVelocityCorrectionCount = Math.max(
      0,
      Math.floor(finiteNumber(runtime.starshipStateGuard.blockedVelocityCorrectionCount, 0)),
    );
    runtime.starshipStateGuard.postCleanFreeFlightPositionCorrectionCount = Math.max(
      0,
      Math.floor(finiteNumber(runtime.starshipStateGuard.postCleanFreeFlightPositionCorrectionCount, 0)),
    );
    runtime.starshipStateGuard.postCleanFreeFlightVelocityCorrectionCount = Math.max(
      0,
      Math.floor(finiteNumber(runtime.starshipStateGuard.postCleanFreeFlightVelocityCorrectionCount, 0)),
    );
    runtime.starshipStateGuard.maxPostCleanFreeFlightPositionCorrectionKm = Math.max(
      0,
      finiteNumber(runtime.starshipStateGuard.maxPostCleanFreeFlightPositionCorrectionKm, 0),
    );
    runtime.starshipStateGuard.maxPostCleanFreeFlightVelocityCorrectionKmS = Math.max(
      0,
      finiteNumber(runtime.starshipStateGuard.maxPostCleanFreeFlightVelocityCorrectionKmS, 0),
    );
    runtime.starshipStateGuard.lastCorrectionReason = String(runtime.starshipStateGuard.lastCorrectionReason || "");
    runtime.starshipStateGuard.lastCorrectionKind = String(runtime.starshipStateGuard.lastCorrectionKind || "");
    runtime.starshipStateGuard.lastCorrectionElapsedSec = finiteOrNull(runtime.starshipStateGuard.lastCorrectionElapsedSec);
    runtime.starshipStateGuard.lastBlockedReason = String(runtime.starshipStateGuard.lastBlockedReason || "");
    runtime.starshipStateGuard.lastBlockedKind = String(runtime.starshipStateGuard.lastBlockedKind || "");
    runtime.starshipStateGuard.lastBlockedElapsedSec = finiteOrNull(runtime.starshipStateGuard.lastBlockedElapsedSec);
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
    runtime.launchSequence = {
      ...createLaunchSequenceState(),
      ...(cloneJson(snapshot.launchSequence, {}) || {}),
    };
    runtime.launchSequence.active = Boolean(runtime.launchSequence.active);
    runtime.launchSequence.startElapsedSec = Math.max(0, finiteNumber(runtime.launchSequence.startElapsedSec, 0));
    runtime.launchSequence.launchCommitReady = Boolean(runtime.launchSequence.launchCommitReady);
    runtime.launchSequence.launchCommitReason = String(runtime.launchSequence.launchCommitReason || "");
    runtime.launchSequence.launchCommitElapsedSec = finiteOrNull(runtime.launchSequence.launchCommitElapsedSec);
    runtime.launchSequence.padReleaseComplete = Boolean(runtime.launchSequence.padReleaseComplete);
    runtime.launchSequence.padReleaseElapsedSec = finiteOrNull(runtime.launchSequence.padReleaseElapsedSec);
    runtime.launchSequence.towerClearSatisfied = Boolean(runtime.launchSequence.towerClearSatisfied);
    runtime.launchSequence.towerClearElapsedSec = finiteOrNull(runtime.launchSequence.towerClearElapsedSec);
    runtime.launchSequence.pitchoverEnabled = Boolean(runtime.launchSequence.pitchoverEnabled);
    runtime.launchSequence.pitchoverElapsedSec = finiteOrNull(runtime.launchSequence.pitchoverElapsedSec);
    runtime.launchSequence.hotstageDeferredCandidateActive = Boolean(runtime.launchSequence.hotstageDeferredCandidateActive);
    runtime.launchSequence.hotstageDeferredCandidateElapsedSec = finiteOrNull(runtime.launchSequence.hotstageDeferredCandidateElapsedSec);
    runtime.launchSequence.hotstageDeferredCandidateAltitudeKm = finiteOrNull(runtime.launchSequence.hotstageDeferredCandidateAltitudeKm);
    runtime.launchSequence.hotstageDeferredCandidateReason = String(runtime.launchSequence.hotstageDeferredCandidateReason || "");
    runtime.launchSequence.hotstageArmed = Boolean(runtime.launchSequence.hotstageArmed);
    runtime.launchSequence.hotstageArmReason = String(runtime.launchSequence.hotstageArmReason || "");
    runtime.launchSequence.hotstageArmedElapsedSec = finiteOrNull(runtime.launchSequence.hotstageArmedElapsedSec);
    runtime.launchSequence.hotstageIgnitionAuthorized = Boolean(runtime.launchSequence.hotstageIgnitionAuthorized);
    runtime.launchSequence.hotstageIgnitionElapsedSec = finiteOrNull(runtime.launchSequence.hotstageIgnitionElapsedSec);
    runtime.launchSequence.hotstageReleaseAuthorized = Boolean(runtime.launchSequence.hotstageReleaseAuthorized);
    runtime.launchSequence.hotstageReleaseElapsedSec = finiteOrNull(runtime.launchSequence.hotstageReleaseElapsedSec);
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
    runtime.booster.separationAxisKm = cloneVectorOrNull(boosterSnapshot.separationAxisKm);
    runtime.booster.landed = Boolean(boosterSnapshot.landed);
    runtime.booster.crashed = Boolean(boosterSnapshot.crashed);
    runtime.booster.terminalOutcome = String(boosterSnapshot.terminalOutcome || "");
    runtime.booster.terminalReason = String(boosterSnapshot.terminalReason || "");
    runtime.booster.impactSpeedKmS = finiteOrNull(boosterSnapshot.impactSpeedKmS);
    runtime.booster.impactVerticalSpeedKmS = finiteOrNull(boosterSnapshot.impactVerticalSpeedKmS);
    runtime.booster.impactLateralSpeedKmS = finiteOrNull(boosterSnapshot.impactLateralSpeedKmS);
    runtime.booster.impactBodyUpAlignment = finiteOrNull(boosterSnapshot.impactBodyUpAlignment);
    runtime.booster.crashDynamics = hydrateBoosterCrashDynamicsState(boosterSnapshot.crashDynamics);
    if (runtime.booster.crashed && !runtime.booster.crashDynamics.active && !runtime.booster.crashDynamics.settled) {
      runtime.booster.crashDynamics.active = true;
      runtime.booster.crashDynamics.mode = String(runtime.booster.terminalReason || "").includes("catch")
        ? "tower-strike"
        : "surface-impact";
    }
    runtime.booster.combustion = hydrateEngineCombustionClusterState(
      boosterSnapshot.combustion,
      boosterCombustionClusterOptions(
        runtime.boosterEngineCountOverride,
        currentBoosterCommandPhase(),
      ),
    );
    runtime.booster.rcsCombustion = hydrateEngineCombustionClusterState(
      boosterSnapshot.rcsCombustion,
      boosterRcsCombustionClusterOptions(),
    );
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
    runtime.booster.capture = {
      ...createBoosterCatchCaptureState(),
      ...(cloneJson(boosterSnapshot.capture, {}) || {}),
    };
    runtime.booster.capture.active = Boolean(runtime.booster.capture.active);
    runtime.booster.capture.phase = String(runtime.booster.capture.phase || "");
    runtime.booster.capture.contactHoldSec = Math.max(0, finiteNumber(runtime.booster.capture.contactHoldSec, 0));
    runtime.booster.capture.settleHoldSec = Math.max(0, finiteNumber(runtime.booster.capture.settleHoldSec, 0));
    runtime.booster.capture.closureNorm = clamp(finiteNumber(runtime.booster.capture.closureNorm, 0), 0, 1);
    runtime.booster.capture.targetOffsetUpKm = Math.max(0, finiteNumber(runtime.booster.capture.targetOffsetUpKm, 0));
    runtime.booster.capture.lateralErrorKm = finiteOrNull(runtime.booster.capture.lateralErrorKm);
    runtime.booster.capture.verticalErrorKm = finiteOrNull(runtime.booster.capture.verticalErrorKm);
    runtime.booster.capture.totalErrorKm = finiteOrNull(runtime.booster.capture.totalErrorKm);
    runtime.booster.capture.totalSpeedKmS = finiteOrNull(runtime.booster.capture.totalSpeedKmS);
    runtime.booster.capture.loadN = Math.max(0, finiteNumber(runtime.booster.capture.loadN, 0));
    runtime.booster.capture.loadG = Math.max(0, finiteNumber(runtime.booster.capture.loadG, 0));
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
    runtime.hotstage.physicalSeparationKm = Math.max(0, finiteNumber(runtime.hotstage.physicalSeparationKm, 0));
    runtime.hotstage.physicalSeparationRateKmS = finiteNumber(runtime.hotstage.physicalSeparationRateKmS, 0);
    runtime.hotstage.shipReferenceActive = Boolean(runtime.hotstage.shipReferenceActive);
    runtime.hotstage.shipCenterShiftKm = Math.max(0, finiteNumber(runtime.hotstage.shipCenterShiftKm, 0));
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
    runtime.pendingStageTransition.holdMode = String(runtime.pendingStageTransition.holdMode || "");
    runtime.pendingStageTransition.authorizationMode = String(runtime.pendingStageTransition.authorizationMode || "");
    runtime.pendingStageTransition.anomalyActive = Boolean(runtime.pendingStageTransition.anomalyActive);
    runtime.pendingStageTransition.anomalyReason = String(runtime.pendingStageTransition.anomalyReason || "");
    runtime.pendingStageTransition.anomalyElapsedSec = finiteOrNull(runtime.pendingStageTransition.anomalyElapsedSec);

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

  function primaryLaunchBlockedByTerminalHotstageAnomaly() {
    const pending = runtime.pendingStageTransition;
    if (
      !pending?.active
      || pending.kind !== "hotstage_ignite"
      || !pending.anomalyActive
      || runtime.stageIndex !== 0
      || runtime.hotstage.active
      || runtime.booster.active
    ) {
      return false;
    }
    const anomalyReason = String(pending.anomalyReason || "");
    const terminalHotstageAnomaly = anomalyReason.startsWith("hotstage_window_missed")
      || anomalyReason === "hotstage_never_armed"
      || anomalyReason === "hotstage_q_hold_exceeded";
    if (!terminalHotstageAnomaly) {
      return false;
    }
    return (
      (Number(runtime.lastStep?.throttle) || 0) <= 1e-3
      && (Number(runtime.lastStep?.thrustN) || 0) <= 1
    );
  }

  function primaryLaunchCountsAsActive() {
    if (primaryLaunchBlockedByTerminalHotstageAnomaly()) {
      return false;
    }
    return currentLaunchVehiclePhase() !== "idle"
      || runtime.booster.active
      || Boolean(runtime.pendingPadTankerLaunch?.active);
  }

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
    getBoosterEngineCountSelection,
    isPrimaryLaunchActive() {
      return primaryLaunchCountsAsActive();
    },
    isActive() {
      return currentLaunchVehiclePhase() !== "idle"
        || runtime.booster.active
        || fleetController.hasActiveVehicles();
    },
  };
}
