import {
  EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
  LAUNCH_VEHICLE_CONFIG,
  LAUNCH_SITE,
  SEA_LEVEL_PRESSURE_PA,
  STARSHIP_STACK_DIMENSIONS_KM,
  STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM,
  STANDARD_GRAVITY_M_S2,
} from "./launchConfig.js";
import {
  LAUNCH_MISSION_IDS,
  missionProfileById,
  normalizeMissionId,
} from "./launchMissions.js";
import {
  add,
  clamp,
  cross,
  dot,
  length,
  rad,
  normalize,
  scale,
  subtract,
} from "./launchMath.js";
import { LAUNCH_REALISM_CONFIG } from "./launchRealismConfig.js";
import {
  applyActuatorModel,
  createActuatorState,
  createMassModelState,
  updateMassModelState,
} from "./launchActuators.js";
import { orbitalStateFromRelative } from "./launchGuidance.js";
import {
  applyQAlphaSteeringLimit,
  atmosphereRelativeVelocityKmS,
  computeAerodynamicResponse,
  dynamicPressurePaFromAtmosphere,
  limitThrottleByQAlpha,
  sampleWindVectorKmS,
} from "./launchAeroModel.js";
import { enforceMoonEarthAvoidanceDirection } from "./lunar/guidanceSafety.js";
import { evaluateMoonTliGoNoGo } from "./lunar/moonGoNoGoGates.js";
import { computeMoonSurvivalRecoveryOverride } from "./lunar/moonSurvivalRecovery.js";
import {
  normalizeAngleZeroToTau,
  evaluateMoonPadLaunchWindow,
  solveBestMoonOrbitInjectWindow,
  solveMoonDepartureWindow,
} from "../navigation_system/lunar/departureWindowSolver.js";
import { evaluateMoonDepartureCorridor } from "../navigation_system/lunar/moonDepartureCorridor.js";
import {
  describeMoonCaptureEntryGate,
  describeMoonTliExitGate,
  evaluateMoonCaptureEntryGate,
  evaluateMoonTliExitGate,
} from "../navigation_system/lunar/lunarPhaseGates.js";
import { isFlightDockingEligible } from "./refuel/availability.js";
import { REFUEL_TANKER_CONFIG } from "./refuel/config.js";
import { selectStickyTarget } from "./refuel/targetSelection.js";
import {
  advanceFleetTransferMass,
  fleetTransferTelemetryState,
  resetFleetTransferState,
  updateFleetTransferGuidance,
} from "./refuel/fleetTransferPipeline.js";
import {
  estimateMoonRoundTripFuelBudget,
  estimateOrbitalRefuelDemoFuelBudget,
} from "./missionFuelBudget.js";
import {
  MOON_BURN_ATTITUDE_GATE_PHASES,
  MOON_BURN_ATTITUDE_GATE_ENTER_ERROR_DEG,
  MOON_BURN_ATTITUDE_GATE_EXIT_ERROR_DEG,
  MOON_ORBIT_INJECT_ALTITUDE_KM,
  MOON_ORBIT_INJECT_DEPARTURE_NODE_SAMPLES,
  MOON_ORBIT_INJECT_DEPARTURE_SEARCH_PROFILE,
  MOON_PARKING_ORBIT_APOAPSIS_KM,
  MOON_PARKING_ORBIT_PERIAPSIS_KM,
} from "./lunar/constants.js";
import { evaluateMoonBurnAttitudeGate } from "./lunar/moonBurnAttitudeGate.js";
import { NAVIGATION_DEFAULTS } from "../navigation_system/navigationSystemConfig.js";
import {
  NAVIGATION_MISSION_IDS,
  NAVIGATION_MISSION_PHASES,
} from "../navigation_system/navigationMissionProfiles.js";
import { planMoonMissionCommand } from "../navigation_system/planners/moonMissionPlanner.js";
import {
  createPlannerRuntime,
  syncPlannerRuntime,
} from "../navigation_system/planners/moonGuidanceState.js";
import {
  applyEarthSurfaceContactForVehicle,
  terrainHeightKmAtLatLon,
} from "../surface/earthSurfacePhysics.js";

const FLEET_MOON_MIDCOURSE_PREDICT_HORIZON_SEC = Math.max(
  1,
  Number(NAVIGATION_DEFAULTS?.planner?.moonMidcoursePredictHorizonSec) || (36 * 3600),
);
const FLEET_MISSION_SHIP_ID_PREFIX = "earth_mission_ship_";
const FLEET_TLI_PERIAPSIS_PROTECT_MIN_KM = 130;
const FLEET_TLI_GO_NOGO_MIN_ALTITUDE_KM = 120;
const FLEET_ORBITAL_REFUEL_DEMO_STAGE2_MIN_PROPELLANT_KG = 2_400_000;
const FLEET_ORBITAL_REFUEL_DEMO_ORBIT_INJECT_STAGE2_FILL_FRACTION = 0.52;
const FLEET_ORBITAL_REFUEL_DEMO_MARGIN_CONSERVE_KG = 90_000;
const FLEET_ORBITAL_REFUEL_DEMO_MARGIN_SOFT_DEFICIT_KG = -8_000;
const FLEET_ORBITAL_REFUEL_DEMO_MARGIN_HARD_HOLD_KG = -30_000;
const FLEET_MOON_MISSION_STAGE2_MIN_PROPELLANT_KG = 5_000_000;
const FLEET_MOON_MISSION_MARGIN_CONSERVE_KG = 220_000;
const FLEET_MOON_MISSION_MARGIN_CRITICAL_KG = 120_000;
const FLEET_MOON_PAD_WINDOW_PHASE_TOLERANCE_DEG = 4.0;
const FLEET_MOON_PAD_WINDOW_MAX_ALTITUDE_KM = 2.0;
const FLEET_MOON_PAD_WINDOW_MAX_WAIT_SEC = 180;
const FLEET_MOON_DEPARTURE_COMMIT_WINDOW_MIN_SEC = 75;
const FLEET_MOON_DEPARTURE_COMMIT_WINDOW_MAX_SEC = 180;
const FLEET_MOON_DEPARTURE_COMMIT_WINDOW_FRACTION = 0.12;
const FLEET_MOON_REFUEL_TARGET_FILL_FRACTION = 0.88;
const FLEET_QALPHA_ACTIVE_MAX_ALTITUDE_KM = 105;
const FLEET_QALPHA_ACTIVE_MIN_DYNAMIC_PRESSURE_PA = 120;
const FLEET_TEI_DEPARTURE_DISTANCE_KM = 140_000;
const FLEET_EARTH_CAPTURE_DISTANCE_KM = 180_000;
const FLEET_EARTH_CAPTURE_APOAPSIS_MAX_KM = 75_000;
const FLEET_EARTH_CAPTURE_PERIAPSIS_MIN_KM = 120;
const FLEET_MOON_BURN_ATTITUDE_GATE_PHASES = MOON_BURN_ATTITUDE_GATE_PHASES;
const FLEET_MOONWARD_TARGET_PHASES = new Set([
  "launch_to_parking",
  "orbital_refuel",
  "tli_burn",
  "coast_to_moon",
  "lunar_capture",
  "lunar_orbit_hold",
]);
const FLEET_TO_NAV_MOON_PHASE = Object.freeze({
  orbital_refuel: NAVIGATION_MISSION_PHASES.ORBITAL_REFUEL,
  tli_burn: NAVIGATION_MISSION_PHASES.TLI_BURN,
  coast_to_moon: NAVIGATION_MISSION_PHASES.COAST_TO_MOON,
  lunar_capture: NAVIGATION_MISSION_PHASES.LUNAR_INSERTION,
  lunar_orbit_hold: NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_HOLD,
  tei_burn: NAVIGATION_MISSION_PHASES.TEI_BURN,
  coast_to_earth: NAVIGATION_MISSION_PHASES.COAST_TO_EARTH,
  earth_capture: NAVIGATION_MISSION_PHASES.EARTH_CAPTURE,
  earth_orbit_hold: NAVIGATION_MISSION_PHASES.EARTH_ORBIT_HOLD,
});

function finiteVector(v) {
  return Boolean(
    v
    && Number.isFinite(Number(v.x))
    && Number.isFinite(Number(v.y))
    && Number.isFinite(Number(v.z)),
  );
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback);
}

function cloneFiniteVector(vector) {
  return finiteVector(vector)
    ? {
      x: finiteNumber(vector.x, 0),
      y: finiteNumber(vector.y, 0),
      z: finiteNumber(vector.z, 0),
    }
    : null;
}

function deriveMoonDepartureCommitWindowSec(burnDurationSec) {
  const derivedDurationSec = finiteNumber(burnDurationSec, Number.NaN);
  if (!Number.isFinite(derivedDurationSec) || !(derivedDurationSec > 0)) {
    return FLEET_MOON_DEPARTURE_COMMIT_WINDOW_MIN_SEC;
  }
  return clamp(
    derivedDurationSec * FLEET_MOON_DEPARTURE_COMMIT_WINDOW_FRACTION,
    FLEET_MOON_DEPARTURE_COMMIT_WINDOW_MIN_SEC,
    FLEET_MOON_DEPARTURE_COMMIT_WINDOW_MAX_SEC,
  );
}

function resolveMoonTliTimeoutSec(durationSec) {
  const resolvedDurationSec = finiteNumber(durationSec, Number.NaN);
  if (!Number.isFinite(resolvedDurationSec) || !(resolvedDurationSec > 0)) {
    return null;
  }
  return Math.max(
    resolvedDurationSec + 360,
    resolvedDurationSec * 1.75,
  );
}

function scoreMoonDeparturePlanCandidate(window = null) {
  if (!window || typeof window !== "object") {
    return Number.NEGATIVE_INFINITY;
  }
  const accepted = Boolean(window?.ready) && Boolean(window?.corridorAccepted);
  const corridorScore = clamp(Number(window?.corridorScore) || 0, 0, 1);
  const windowScore = clamp(Number(window?.windowScore) || 0, 0, 1);
  const predictedMissDistanceKm = Number.isFinite(Number(window?.predictedMissDistanceKm))
    ? Math.max(0, Number(window.predictedMissDistanceKm))
    : 1e12;
  const predictedPeriluneAltitudeKm = Number.isFinite(Number(window?.predictedPeriluneAltitudeKm))
    ? Math.max(0, Number(window.predictedPeriluneAltitudeKm))
    : 1e12;
  const bPlaneErrorKm = Number.isFinite(Number(window?.bPlaneErrorKm))
    ? Math.max(0, Number(window.bPlaneErrorKm))
    : 1e12;
  return (
    (accepted ? 1e12 : 0)
    + (corridorScore * 1e9)
    + (windowScore * 1e7)
    - predictedMissDistanceKm
    - (bPlaneErrorKm * 0.95)
    - (predictedPeriluneAltitudeKm * 0.2)
  );
}

export function chooseMoonDeparturePlanSource(seedWindow = null, liveWindow = null) {
  const seedAccepted = Boolean(seedWindow?.ready) && Boolean(seedWindow?.corridorAccepted);
  const liveAccepted = Boolean(liveWindow?.ready) && Boolean(liveWindow?.corridorAccepted);
  if (seedAccepted) {
    return seedWindow;
  }
  if (liveAccepted) {
    return liveWindow;
  }
  const seedScore = scoreMoonDeparturePlanCandidate(seedWindow);
  const liveScore = scoreMoonDeparturePlanCandidate(liveWindow);
  if (liveScore > seedScore) {
    return liveWindow;
  }
  return seedWindow || liveWindow;
}

function buildMoonDepartureDiagnosticsCandidate({
  ready = null,
  windowScore = null,
  corridorAccepted = null,
  corridorScore = null,
  predictedMissDistanceKm = Number.NaN,
  predictedPeriluneAltitudeKm = Number.NaN,
  bPlaneErrorKm = Number.NaN,
} = {}) {
  const missKm = finiteOrNull(predictedMissDistanceKm);
  const periluneKm = finiteOrNull(predictedPeriluneAltitudeKm);
  const bPlaneKm = finiteOrNull(bPlaneErrorKm);
  const hasMetrics = (
    Number.isFinite(missKm)
    || Number.isFinite(periluneKm)
    || Number.isFinite(bPlaneKm)
  );
  if (!hasMetrics && ready === null && corridorAccepted === null) {
    return null;
  }
  const corridor = evaluateMoonDepartureCorridor({
    predictedMissDistanceKm: missKm,
    predictedPeriluneAltitudeKm: periluneKm,
    bPlaneErrorKm: bPlaneKm,
    plannerConfig: NAVIGATION_DEFAULTS.planner,
  });
  return {
    ready: ready === null ? corridor.accepted : Boolean(ready),
    corridorAccepted: corridorAccepted === null ? corridor.accepted : Boolean(corridorAccepted),
    corridorScore: Number.isFinite(Number(corridorScore)) ? Number(corridorScore) : corridor.score,
    windowScore: Number.isFinite(Number(windowScore)) ? Number(windowScore) : 0,
    predictedMissDistanceKm: missKm,
    predictedPeriluneAltitudeKm: periluneKm,
    bPlaneErrorKm: bPlaneKm,
  };
}

function chooseMoonDepartureDiagnosticsSource(vehicle = null) {
  if (!vehicle || typeof vehicle !== "object") {
    return null;
  }
  const planned = buildMoonDepartureDiagnosticsCandidate({
    ready: vehicle.moonDeparturePlanReady,
    windowScore: vehicle.moonDepartureWindowScore,
    predictedMissDistanceKm: vehicle.moonDeparturePlanPredictedMissDistanceKm,
    predictedPeriluneAltitudeKm: vehicle.moonDeparturePlanPredictedPeriluneAltitudeKm,
    bPlaneErrorKm: vehicle.moonDeparturePlanBPlaneErrorKm,
  });
  const live = buildMoonDepartureDiagnosticsCandidate({
    ready: vehicle.moonDepartureWindowReady,
    windowScore: vehicle.moonDepartureWindowScore,
    corridorAccepted: vehicle.moonDepartureCorridorAccepted,
    corridorScore: vehicle.moonDepartureCorridorScore,
    predictedMissDistanceKm: vehicle.moonTliTargetMissKm,
    predictedPeriluneAltitudeKm: vehicle.moonTliTargetPeriluneKm,
    bPlaneErrorKm: vehicle.moonTliTargetBPlaneKm,
  });
  return chooseMoonDeparturePlanSource(planned, live) || planned || live;
}

function resolveMoonTliTelemetryMetrics(vehicle = null, fallback = {}, options = {}) {
  const fallbackMissKm = finiteOrNull(fallback?.predictedMissDistanceKm);
  const fallbackPeriluneKm = finiteOrNull(fallback?.predictedPeriluneAltitudeKm);
  const fallbackBPlaneKm = finiteOrNull(fallback?.bPlaneErrorKm);
  const preferDeparturePlan = Boolean(options?.preferDeparturePlan);
  if (!vehicle || typeof vehicle !== "object") {
    return {
      predictedMissDistanceKm: fallbackMissKm,
      predictedPeriluneAltitudeKm: fallbackPeriluneKm,
      bPlaneErrorKm: fallbackBPlaneKm,
      usingGuidanceDiagnostics: false,
    };
  }
  const liveMissKm = finiteOrNull(vehicle.moonTliTargetMissKm);
  const livePeriluneKm = finiteOrNull(vehicle.moonTliTargetPeriluneKm);
  const liveBPlaneKm = finiteOrNull(vehicle.moonTliTargetBPlaneKm);
  const hasLiveMetrics = (
    Number.isFinite(liveMissKm)
    || Number.isFinite(livePeriluneKm)
    || Number.isFinite(liveBPlaneKm)
  );
  const plannedOnlyDiagnostics = buildMoonDepartureDiagnosticsCandidate({
    ready: vehicle.moonDeparturePlanReady,
    windowScore: vehicle.moonDepartureWindowScore,
    predictedMissDistanceKm: vehicle.moonDeparturePlanPredictedMissDistanceKm,
    predictedPeriluneAltitudeKm: vehicle.moonDeparturePlanPredictedPeriluneAltitudeKm,
    bPlaneErrorKm: vehicle.moonDeparturePlanBPlaneErrorKm,
  });
  const departureDiagnostics = hasLiveMetrics
    ? null
    : chooseMoonDepartureDiagnosticsSource(vehicle);
  const preferredDiagnostics = preferDeparturePlan
    ? (plannedOnlyDiagnostics || departureDiagnostics)
    : null;
  const preferredMissKm = finiteOrNull(preferredDiagnostics?.predictedMissDistanceKm);
  const preferredPeriluneKm = finiteOrNull(preferredDiagnostics?.predictedPeriluneAltitudeKm);
  const preferredBPlaneKm = finiteOrNull(preferredDiagnostics?.bPlaneErrorKm);
  const plannedMissKm = finiteOrNull(departureDiagnostics?.predictedMissDistanceKm);
  const plannedPeriluneKm = finiteOrNull(departureDiagnostics?.predictedPeriluneAltitudeKm);
  const plannedBPlaneKm = finiteOrNull(departureDiagnostics?.bPlaneErrorKm);
  const resolvedMissKm = Number.isFinite(preferredMissKm)
    ? preferredMissKm
    : (Number.isFinite(liveMissKm)
      ? liveMissKm
      : (Number.isFinite(plannedMissKm) ? plannedMissKm : fallbackMissKm));
  const resolvedPeriluneKm = Number.isFinite(preferredPeriluneKm)
    ? preferredPeriluneKm
    : (Number.isFinite(livePeriluneKm)
      ? livePeriluneKm
      : (Number.isFinite(plannedPeriluneKm) ? plannedPeriluneKm : fallbackPeriluneKm));
  const resolvedBPlaneKm = Number.isFinite(preferredBPlaneKm)
    ? preferredBPlaneKm
    : (Number.isFinite(liveBPlaneKm)
      ? liveBPlaneKm
      : (Number.isFinite(plannedBPlaneKm) ? plannedBPlaneKm : fallbackBPlaneKm));
  return {
    predictedMissDistanceKm: resolvedMissKm,
    predictedPeriluneAltitudeKm: resolvedPeriluneKm,
    bPlaneErrorKm: resolvedBPlaneKm,
    usingGuidanceDiagnostics: Number.isFinite(preferredMissKm)
      || Number.isFinite(preferredPeriluneKm)
      || Number.isFinite(preferredBPlaneKm)
      || hasLiveMetrics
      || Number.isFinite(plannedMissKm)
      || Number.isFinite(plannedPeriluneKm)
      || Number.isFinite(plannedBPlaneKm),
  };
}

function moonDepartureHoldTelemetryActive(vehicle = null, guidanceMode = "") {
  if (!vehicle || typeof vehicle !== "object") {
    return false;
  }
  return (
    vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
    && String(vehicle.missionPhase || "").trim() === "coast_to_moon"
    && String(guidanceMode || "").includes("departure-hold")
  );
}

function resolveMoonDepartureTelemetryMetricsForSnapshot({
  vehicle = null,
  guidanceMode = "",
  rawPredictedMissDistanceKm = null,
  rawPredictedPeriluneAltitudeKm = null,
  rawBPlaneErrorKm = null,
} = {}) {
  const departureHoldActive = moonDepartureHoldTelemetryActive(vehicle, guidanceMode);
  const telemetry = resolveMoonTliTelemetryMetrics(vehicle, {
    predictedMissDistanceKm: rawPredictedMissDistanceKm,
    predictedPeriluneAltitudeKm: rawPredictedPeriluneAltitudeKm,
    bPlaneErrorKm: rawBPlaneErrorKm,
  }, {
    preferDeparturePlan: departureHoldActive,
  });
  return {
    ...telemetry,
    preserveDeparturePlan: departureHoldActive,
  };
}

function resolveTargetEtaTelemetryForSnapshot({
  vehicle = null,
  guidanceMode = "",
  targetDistanceKm = null,
  targetClosingSpeedKmS = null,
} = {}) {
  const departureHoldActive = moonDepartureHoldTelemetryActive(vehicle, guidanceMode);
  const plannedTransferTimeSec = finiteOrNull(vehicle?.moonDeparturePlanTransferTimeSec);
  const transitStartElapsedSec = finiteOrNull(vehicle?.moonDeparturePlanTransitStartElapsedSec);
  if (
    departureHoldActive
    && Number.isFinite(plannedTransferTimeSec)
    && Number.isFinite(transitStartElapsedSec)
  ) {
    const missionElapsedSec = Math.max(0, Number(vehicle?.elapsedSeconds) || 0);
    const elapsedSinceDepartureSec = Math.max(0, missionElapsedSec - transitStartElapsedSec);
    return {
      targetEtaSeconds: Math.max(0, plannedTransferTimeSec - elapsedSinceDepartureSec),
      targetEtaSource: "planned-transfer",
      targetRateLabel: "Approach",
      targetEtaLabel: "Plan ETA",
    };
  }
  const distanceKm = finiteOrNull(targetDistanceKm);
  const closingSpeedKmS = finiteOrNull(targetClosingSpeedKmS);
  return {
    targetEtaSeconds: (
      distanceKm !== null
      && closingSpeedKmS !== null
      && closingSpeedKmS > 1e-6
    )
      ? (distanceKm / closingSpeedKmS)
      : null,
    targetEtaSource: "instantaneous-closing",
    targetRateLabel: "Closing",
    targetEtaLabel: "ETA",
  };
}

function assignMoonDeparturePlan(vehicle, moonDepartureWindow = null) {
  if (!vehicle || typeof vehicle !== "object") {
    return;
  }
  const burnDirection = cloneFiniteVector(moonDepartureWindow?.optimizedBurnDirection);
  const throttle = finiteOrNull(moonDepartureWindow?.optimizedThrottle);
  const burnDurationSec = finiteOrNull(moonDepartureWindow?.optimizedBurnDurationSec);
  const transferTimeSec = finiteOrNull(moonDepartureWindow?.transferTimeSec);
  vehicle.moonDeparturePlanReady = Boolean(moonDepartureWindow?.ready);
  vehicle.moonDeparturePlanDirectionKm = burnDirection;
  vehicle.moonDeparturePlanThrottle = burnDirection && Number.isFinite(Number(throttle))
    ? Number(throttle)
    : null;
  vehicle.moonDeparturePlanBurnDurationSec = burnDirection && Number.isFinite(Number(burnDurationSec))
    ? Number(burnDurationSec)
    : null;
  vehicle.moonDeparturePlanCommitWindowSec = burnDirection
    ? deriveMoonDepartureCommitWindowSec(burnDurationSec)
    : null;
  vehicle.moonDeparturePlanPredictedMissDistanceKm = finiteOrNull(
    moonDepartureWindow?.predictedMissDistanceKm,
  );
  vehicle.moonDeparturePlanPredictedPeriluneAltitudeKm = finiteOrNull(
    moonDepartureWindow?.predictedPeriluneAltitudeKm,
  );
  vehicle.moonDeparturePlanBPlaneErrorKm = finiteOrNull(moonDepartureWindow?.bPlaneErrorKm);
  vehicle.moonDeparturePlanTransferTimeSec = burnDirection && Number.isFinite(Number(transferTimeSec))
    ? Number(transferTimeSec)
    : null;
  if (!burnDirection) {
    vehicle.moonDeparturePlanTransitStartElapsedSec = null;
  }
  if (Number.isFinite(Number(burnDurationSec)) && Number(burnDurationSec) > 0) {
    const resolvedTliDurationSec = Math.max(60, Number(burnDurationSec));
    vehicle.tliDurationSec = resolvedTliDurationSec;
    vehicle.tliTimeoutSec = resolveMoonTliTimeoutSec(resolvedTliDurationSec);
  } else if (!(Number(vehicle?.tliDurationSec) > 0)) {
    vehicle.tliDurationSec = null;
    vehicle.tliTimeoutSec = null;
  }
}

function geodeticLatLonDegFromRelativePosition(positionKm) {
  if (!finiteVector(positionKm)) {
    return {
      latitudeDeg: Number.NaN,
      longitudeDeg: Number.NaN,
    };
  }
  const radiusKm = length(positionKm);
  if (!(radiusKm > 1e-9)) {
    return {
      latitudeDeg: Number.NaN,
      longitudeDeg: Number.NaN,
    };
  }
  return {
    latitudeDeg: (Math.asin(clamp(positionKm.z / radiusKm, -1, 1)) * 180) / Math.PI,
    longitudeDeg: (Math.atan2(positionKm.y, positionKm.x) * 180) / Math.PI,
  };
}

function stageBodyKindFromStageIndex(stageIndex = 0) {
  return Number(stageIndex) <= 0 ? "stage1" : "stage2";
}

function bodyStateFromNBody(state, bodyId) {
  return state?.dynamicBodies?.get(bodyId)
    || state?.staticSources?.get(bodyId)
    || null;
}

function fleetMissionNameForId(missionId) {
  return missionProfileById(normalizeMissionId(missionId))?.name || "Earth Orbit Hold";
}

function moonNavPhaseForFleetPhase(phase = "") {
  const key = String(phase || "").trim().toLowerCase();
  return FLEET_TO_NAV_MOON_PHASE[key] || "";
}

function ensureVehiclePlannerRuntime(vehicle) {
  if (!vehicle || typeof vehicle !== "object") {
    return null;
  }
  if (!vehicle.navPlannerRuntime || typeof vehicle.navPlannerRuntime !== "object") {
    vehicle.navPlannerRuntime = createPlannerRuntime();
  }
  return vehicle.navPlannerRuntime;
}

function defaultPhaseLabel(phase) {
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

function formatFleetGateKm(value, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }
  return `${numeric.toFixed(Math.max(0, Number(digits) || 0))} km`;
}

function formatFleetGateSpeed(value, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }
  return `${numeric.toFixed(Math.max(0, Number(digits) || 0))} km/s`;
}

function formatFleetGatePercent(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }
  return `${(numeric * 100).toFixed(Math.max(0, Number(digits) || 0))}%`;
}

function formatFleetGateMassKg(value, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }
  return `${numeric.toFixed(Math.max(0, Number(digits) || 0))} kg`;
}

function fleetMissionPhaseGateReason({
  vehicle = null,
  orbital = null,
  moonDistanceKm = Number.POSITIVE_INFINITY,
  moonClosingSpeedKmS = 0,
  moonRelativeSpeedKmS = 0,
  moonProjectedMissDistanceKm = Number.POSITIVE_INFINITY,
  moonProjectedPeriluneAltitudeKm = Number.POSITIVE_INFINITY,
  moonBPlaneErrorKm = Number.POSITIVE_INFINITY,
  earthDistanceKm = Number.POSITIVE_INFINITY,
  earthRadialSpeedKmS = 0,
} = {}) {
  if (!vehicle) {
    return "";
  }
  if (vehicle.missionId === LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO) {
    const phase = String(vehicle.missionPhase || "").trim();
    if (phase === "orbital_refuel") {
      const transferPhase = String(vehicle?.refuelTransferState?.phase || "").trim();
      const transferProgress = clamp(Number(vehicle?.refuelTransferState?.transferProgress) || 0, 0, 1);
      const transferRateKgS = Math.max(0, Number(vehicle?.refuelTransferState?.transferRateKgS) || 0);
      const transferRemainingKg = Math.max(0, Number(vehicle?.refuelTransferState?.transferRemainingKg) || 0);
      if (transferPhase === "transferring") {
        return `Transfer active: ${formatFleetGatePercent(transferProgress)} complete @ ${formatFleetGateMassKg(transferRateKgS, 1).replace(" kg", " kg/s")}, ${formatFleetGateMassKg(transferRemainingKg)} remaining.`;
      }
      if (transferPhase === "docked_lock") {
        return "Dock lock achieved: initializing transfer line and pressure equalization.";
      }
      if (transferPhase === "stabilize_orbit") {
        return "Orbit stabilization gate: securing periapsis/apoapsis and radial-rate bounds before rendezvous.";
      }
      if (transferPhase === "phasing") {
        return "Phasing gate: adjusting orbital period to synchronize rendezvous timing with locked tanker.";
      }
      if (transferPhase === "transfer") {
        return "Transfer gate: reducing long-range separation while holding bounded orbital geometry.";
      }
      if (transferPhase === "velocity_match") {
        return "Velocity-match gate: bleeding relative speed before hold-point entry.";
      }
      if (transferPhase === "hold_point" || transferPhase === "final_approach") {
        return "Docking hold-point active: stabilizing relative position/attitude before hard-dock.";
      }
      if (transferPhase === "undocking") {
        return "Undock sequence active: controlled separation and return to orbit hold.";
      }
      if (transferPhase === "aborting") {
        return "Abort hold active: backing away and reacquiring a safe docking corridor.";
      }
      const fuelBudget = vehicle.fuelBudget && typeof vehicle.fuelBudget === "object"
        ? vehicle.fuelBudget
        : null;
      const feasible = fuelBudget ? Boolean(fuelBudget.feasible) : null;
      const marginKg = Number(fuelBudget?.marginKg);
      const status = feasible === null ? "pending" : (feasible ? "feasible" : "deficit");
      const marginLabel = Number.isFinite(marginKg) ? ` (${formatFleetGateMassKg(marginKg)})` : "";
      return `Awaiting tanker rendezvous gate: fuel budget ${status}${marginLabel}; match relative velocity and close to docking corridor.`;
    }
    if (phase === "earth_orbit_hold") {
      return "Refuel mission complete: Earth orbit hold.";
    }
    return "Awaiting next refuel mission gate.";
  }
  if (vehicle.missionId !== LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
    return "";
  }
  const phase = String(vehicle.missionPhase || "").trim();
  if (phase === "launch_to_parking") {
    const moonPadWindowStatus = vehicle?.moonPadWindowStatus;
    if (
      vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
      && vehicle.launchMode === "pad_launch"
      && moonPadWindowStatus
      && moonPadWindowStatus.valid
      && !moonPadWindowStatus.ready
    ) {
      const waitSec = Number(moonPadWindowStatus.waitSec);
      const shortWindowWait = Number.isFinite(waitSec) && waitSec <= FLEET_MOON_PAD_WINDOW_MAX_WAIT_SEC;
      if (!shortWindowWait) {
        return "Moon launch window offset is large; proceeding with immediate ascent and in-flight correction.";
      }
      const waitMin = Number.isFinite(waitSec) && waitSec >= 0
        ? Math.max(0, Math.round(waitSec / 60))
        : null;
      const phaseErrorDeg = Number(moonPadWindowStatus.phaseErrorDeg);
      const toleranceDeg = Number(moonPadWindowStatus.toleranceDeg);
      const waitLabel = waitMin === null ? "n/a" : `${waitMin} min`;
      const errorLabel = Number.isFinite(phaseErrorDeg)
        ? `${phaseErrorDeg.toFixed(2)} deg`
        : "n/a";
      const toleranceLabel = Number.isFinite(toleranceDeg)
        ? `${toleranceDeg.toFixed(2)} deg`
        : "n/a";
      const windowScore = Number(vehicle?.moonDepartureWindowScore);
      const scoreLabel = Number.isFinite(windowScore)
        ? `${(Math.max(0, Math.min(1, windowScore)) * 100).toFixed(1)}%`
        : "n/a";
      const estimatedTliDeltaV = Number(vehicle?.moonEstimatedTliDeltaVKmS);
      const deltaVLabel = Number.isFinite(estimatedTliDeltaV)
        ? `${estimatedTliDeltaV.toFixed(3)} km/s`
        : "n/a";
      return `Moon launch window hold: phase error ${errorLabel} (tol ${toleranceLabel}), wait ~${waitLabel}, window score ${scoreLabel}, TLI est ${deltaVLabel}.`;
    }
    const windowScore = Number(vehicle?.moonDepartureWindowScore);
    const scoreLabel = Number.isFinite(windowScore)
      ? `${(Math.max(0, Math.min(1, windowScore)) * 100).toFixed(1)}%`
      : "n/a";
    const targetApoapsisKm = Math.max(160, Number(vehicle?.targetOrbitApoapsisKm) || 240);
    const targetPeriapsisKm = Math.max(120, Number(vehicle?.targetOrbitPeriapsisKm) || 200);
    return `Awaiting parking orbit gate: apo/peri >= ${formatFleetGateKm(targetApoapsisKm)} / ${formatFleetGateKm(targetPeriapsisKm)}. Window score ${scoreLabel}.`;
  }
  if (phase === "orbital_refuel") {
    const transferPhase = String(vehicle?.refuelTransferState?.phase || "").trim();
    const transferProgress = clamp(Number(vehicle?.refuelTransferState?.transferProgress) || 0, 0, 1);
    if (transferPhase === "transferring") {
      return `Moon campaign refuel transfer active: ${formatFleetGatePercent(transferProgress)} complete.`;
    }
    if (transferPhase === "docked_lock") {
      return "Moon campaign dock lock achieved: preparing propellant transfer.";
    }
    if (transferPhase === "stabilize_orbit") {
      return "Moon campaign orbit stabilization gate: securing safe Earth parking geometry before rendezvous.";
    }
    if (transferPhase === "phasing") {
      return "Moon campaign phasing gate: synchronizing orbital period with tanker target.";
    }
    if (transferPhase === "transfer") {
      return "Moon campaign transfer gate: closing range with bounded orbital energy.";
    }
    if (transferPhase === "velocity_match") {
      return "Moon campaign velocity-match gate: damping closure before hold-point entry.";
    }
    if (transferPhase === "hold_point" || transferPhase === "final_approach") {
      return "Moon campaign docking hold-point: matching attitude and closure corridor.";
    }
    if (transferPhase === "undocking") {
      return "Moon campaign undocking: separating from tanker and preparing TLI transition.";
    }
    if (transferPhase === "aborting") {
      return "Moon campaign abort hold: retreating and reacquiring tanker geometry.";
    }
    const stageProfiles = Array.isArray(vehicle.stageProfiles) ? vehicle.stageProfiles : [];
    const stageIndex = Math.max(
      0,
      Math.min(stageProfiles.length - 1, Number(vehicle.stageIndex) || 0),
    );
    const stageCapacityKg = Math.max(0, Number(stageProfiles[stageIndex]?.propellantMassKg) || 0);
    const fillFraction = stageCapacityKg > 1e-6
      ? Math.max(0, Math.min(1, (Number(vehicle.stagePropellantKg) || 0) / stageCapacityKg))
      : 0;
    return `Awaiting refuel target: fill ${formatFleetGatePercent(fillFraction)} / ${formatFleetGatePercent(FLEET_MOON_REFUEL_TARGET_FILL_FRACTION)}.`;
  }
  if (phase === "tli_burn") {
    if (String(vehicle.moonGoNoGoStatus || "") === "NO-GO" && vehicle.moonGoNoGoReason) {
      return String(vehicle.moonGoNoGoReason);
    }
    const tliGate = evaluateMoonTliExitGate({
      vehicle,
      orbital,
      moonMetrics: {
        closingSpeedKmS: moonClosingSpeedKmS,
        projectedMissDistanceKm: moonProjectedMissDistanceKm,
        projectedPeriluneAltitudeKm: moonProjectedPeriluneAltitudeKm,
        bPlaneErrorKm: moonBPlaneErrorKm,
      },
      plannerConfig: NAVIGATION_DEFAULTS.planner,
      minPeriapsisKm: FLEET_TLI_PERIAPSIS_PROTECT_MIN_KM,
    });
    return describeMoonTliExitGate(tliGate);
  }
  if (phase === "coast_to_moon") {
    const captureGate = evaluateMoonCaptureEntryGate({
      moonMetrics: {
        distanceKm: moonDistanceKm,
        closingSpeedKmS: moonClosingSpeedKmS,
        projectedMissDistanceKm: moonProjectedMissDistanceKm,
        projectedPeriluneAltitudeKm: moonProjectedPeriluneAltitudeKm,
        bPlaneErrorKm: moonBPlaneErrorKm,
      },
      plannerConfig: NAVIGATION_DEFAULTS.planner,
    });
    return describeMoonCaptureEntryGate(captureGate);
  }
  if (phase === "lunar_capture") {
    return `Awaiting lunar capture orbit: rel speed ${formatFleetGateSpeed(moonRelativeSpeedKmS)} | miss ${formatFleetGateKm(moonProjectedMissDistanceKm)} | periapsis est ${formatFleetGateKm(moonProjectedPeriluneAltitudeKm)} | B-plane ${formatFleetGateKm(moonBPlaneErrorKm)}.`;
  }
  if (phase === "lunar_orbit_hold") {
    return "Holding lunar orbit objective.";
  }
  if (phase === "tei_burn") {
    return `Awaiting TEI departure: moon distance ${formatFleetGateKm(moonDistanceKm)} >= ${formatFleetGateKm(FLEET_TEI_DEPARTURE_DISTANCE_KM)} and Earth radial < 0 (${formatFleetGateSpeed(earthRadialSpeedKmS)}).`;
  }
  if (phase === "coast_to_earth") {
    return `Awaiting Earth capture approach: Earth distance ${formatFleetGateKm(earthDistanceKm)} <= ${formatFleetGateKm(FLEET_EARTH_CAPTURE_DISTANCE_KM)}.`;
  }
  if (phase === "earth_capture") {
    return `Awaiting Earth capture orbit: apo/peri <= ${formatFleetGateKm(FLEET_EARTH_CAPTURE_APOAPSIS_MAX_KM)} / >= ${formatFleetGateKm(FLEET_EARTH_CAPTURE_PERIAPSIS_MIN_KM)}.`;
  }
  if (phase === "earth_orbit_hold") {
    return "Mission phase gate complete: Earth orbit hold.";
  }
  if (Number(orbital?.specificEnergy) >= 0 && Number(orbital?.periapsisKm) < 0) {
    return "Awaiting bounded Earth orbit energy.";
  }
  return "Awaiting next mission gate.";
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
  return normalize({
    x: (axes.xAxis.x * localX) + (axes.yAxis.x * localY) + (axes.pole.x * localZ),
    y: (axes.xAxis.y * localX) + (axes.yAxis.y * localY) + (axes.pole.y * localZ),
    z: (axes.xAxis.z * localX) + (axes.yAxis.z * localY) + (axes.pole.z * localZ),
  }, { x: 0, y: 0, z: 1 });
}

function pressureRatio(pressurePa) {
  if (!Number.isFinite(pressurePa) || pressurePa <= 0) {
    return 0;
  }
  return clamp(pressurePa / SEA_LEVEL_PRESSURE_PA, 0, 1);
}

function interpolateSeaToVac(vacuumValue, seaLevelValue, pressurePa) {
  const vacuum = Number.isFinite(Number(vacuumValue)) ? Number(vacuumValue) : 0;
  const sea = Number.isFinite(Number(seaLevelValue)) ? Number(seaLevelValue) : vacuum;
  return vacuum - ((vacuum - sea) * pressureRatio(pressurePa));
}

function clampVectorMagnitude(vector, maxMagnitude) {
  const maxMag = Math.max(0, Number(maxMagnitude) || 0);
  if (!(maxMag > 0)) {
    return { x: 0, y: 0, z: 0 };
  }
  const mag = length(vector || { x: 0, y: 0, z: 0 });
  if (!(mag > maxMag) || !(mag > 1e-12)) {
    return {
      x: Number(vector?.x) || 0,
      y: Number(vector?.y) || 0,
      z: Number(vector?.z) || 0,
    };
  }
  const scaleFactor = maxMag / mag;
  return scale(vector, scaleFactor);
}

function rcsJetsFromAccel({
  accelKmS2 = null,
  prograde = null,
  up = null,
  thresholdKmS2 = 1e-8,
} = {}) {
  if (!accelKmS2 || !prograde || !up) {
    return [];
  }
  const thr = Math.max(1e-9, Number(thresholdKmS2) || 1e-8);
  const tangent = normalize(prograde, { x: 1, y: 0, z: 0 });
  const radial = normalize(up, { x: 0, y: 0, z: 1 });
  const lateral = normalize(cross(tangent, radial), { x: 0, y: 1, z: 0 });
  const forwardComp = dot(accelKmS2, tangent);
  const verticalComp = dot(accelKmS2, radial);
  const lateralComp = dot(accelKmS2, lateral);
  const jets = [];
  if (forwardComp > thr) {
    jets.push("forward");
  } else if (forwardComp < -thr) {
    jets.push("aft");
  }
  if (verticalComp > thr) {
    jets.push("dorsal");
  } else if (verticalComp < -thr) {
    jets.push("ventral");
  }
  if (lateralComp > thr) {
    jets.push("starboard");
  } else if (lateralComp < -thr) {
    jets.push("port");
  }
  return jets;
}

function projectedClosestApproachDistanceKm(relativePositionKm, relativeVelocityKmS) {
  if (!finiteVector(relativePositionKm) || !finiteVector(relativeVelocityKmS)) {
    return Number.POSITIVE_INFINITY;
  }
  const safeDistanceKm = length(relativePositionKm);
  const relativeSpeedSq = dot(relativeVelocityKmS, relativeVelocityKmS);
  if (!(relativeSpeedSq > 1e-12)) {
    return safeDistanceKm;
  }
  const horizonSec = Math.max(1, Number(FLEET_MOON_MIDCOURSE_PREDICT_HORIZON_SEC) || 1);
  const timeToClosestSec = clamp(
    -dot(relativePositionKm, relativeVelocityKmS) / relativeSpeedSq,
    0,
    horizonSec,
  );
  return length(add(
    relativePositionKm,
    scale(relativeVelocityKmS, timeToClosestSec),
  ));
}

function computeRefuelCloseRcsAssist({
  guidanceMode = "",
  distanceKm = Number.POSITIVE_INFINITY,
  relativePositionKm = null,
  relativeVelocityKmS = null,
  prograde = null,
  up = null,
} = {}) {
  if (!finiteVector(relativePositionKm) || !finiteVector(relativeVelocityKmS)) {
    return null;
  }
  const mode = String(guidanceMode || "");
  const closeMode = (
    mode.includes("orbital-refuel-hold-point")
    || mode.includes("orbital-refuel-final-approach")
    || mode.includes("orbital-refuel-rcs-translate")
    || mode.includes("orbital-refuel-lock")
    || mode.includes("orbital-refuel-transferring")
    || mode.includes("orbital-refuel-undocking")
    || mode.includes("orbital-refuel-abort")
  );
  const safeDistanceKm = Math.max(0, Number(distanceKm) || 0);
  if (!closeMode && safeDistanceKm > 2.5) {
    return null;
  }
  const directionToTarget = normalize(relativePositionKm, prograde || { x: 0, y: 1, z: 0 });
  const shipMinusTargetRelVel = scale(relativeVelocityKmS, -1);
  let desiredClosingKmS = 0;
  let responseSec = 120;
  let maxAccelKmS2 = 0.00002;
  if (mode.includes("orbital-refuel-lock") || mode.includes("orbital-refuel-transferring")) {
    desiredClosingKmS = 0;
    responseSec = 55;
    maxAccelKmS2 = 0.000012;
  } else if (mode.includes("orbital-refuel-undocking") || mode.includes("orbital-refuel-abort")) {
    desiredClosingKmS = -0.00018;
    responseSec = 45;
    maxAccelKmS2 = 0.000022;
  } else if (safeDistanceKm <= 0.5) {
    desiredClosingKmS = clamp(safeDistanceKm / 7000, 0.00001, 0.00008);
    responseSec = 70;
    maxAccelKmS2 = 0.000014;
  } else if (safeDistanceKm <= 2.0) {
    desiredClosingKmS = clamp(safeDistanceKm / 5000, 0.00005, 0.00022);
    responseSec = 95;
    maxAccelKmS2 = 0.00002;
  } else {
    desiredClosingKmS = clamp(safeDistanceKm / 2500, 0.0002, 0.0012);
    responseSec = 130;
    maxAccelKmS2 = 0.000028;
  }
  const desiredShipMinusTargetRelVel = scale(directionToTarget, desiredClosingKmS);
  const velocityErrorKmS = subtract(desiredShipMinusTargetRelVel, shipMinusTargetRelVel);
  const accelKmS2Raw = scale(velocityErrorKmS, 1 / Math.max(1, responseSec));
  const accelKmS2 = clampVectorMagnitude(accelKmS2Raw, maxAccelKmS2);
  const authority = clamp(length(accelKmS2) / Math.max(maxAccelKmS2, 1e-9), 0, 1);
  if (!(authority > 1e-4)) {
    return null;
  }
  const jets = rcsJetsFromAccel({
    accelKmS2,
    prograde: normalize(prograde, { x: 1, y: 0, z: 0 }),
    up: normalize(up, { x: 0, y: 0, z: 1 }),
    thresholdKmS2: Math.max(1e-8, maxAccelKmS2 * 0.12),
  });
  return {
    accelKmS2,
    authority,
    jets,
    mode: safeDistanceKm <= 0.6 ? "rcs-dock-assist-fine" : "rcs-dock-assist",
  };
}

export function createLaunchFleetController({
  runtime,
  stageAtIndex,
  minRocketMassKg = 500,
  getEarthRadiusKm,
  getEarthMassKg,
  getBodyRadiusKm,
  getBodyMassKg,
  sampleEarthAtmosphere,
  earthAxes,
  gravitationalConstantKm3PerKgS2,
  emitLaunchEvent,
} = {}) {
  const verticalAscentHoldSec = 22;
  const verticalAscentHoldMaxAltitudeKm = 14;

  function ensureFleetRuntimeState() {
    if (!runtime || typeof runtime !== "object") {
      return {
        nextShipSequence: 1,
        vehicles: new Map(),
      };
    }
    if (!runtime.fleet || typeof runtime.fleet !== "object") {
      runtime.fleet = {
        nextShipSequence: 1,
        vehicles: new Map(),
      };
      return runtime.fleet;
    }
    if (!(runtime.fleet.vehicles instanceof Map)) {
      runtime.fleet.vehicles = new Map();
    }
    runtime.fleet.nextShipSequence = Math.max(1, Number(runtime.fleet.nextShipSequence) || 1);
    return runtime.fleet;
  }

  function fleetVehicles() {
    return ensureFleetRuntimeState().vehicles;
  }

  function hasActiveVehicles() {
    return fleetVehicles().size > 0;
  }

  function removeVehicleById(state, bodyId, options = {}) {
    const id = String(bodyId || "").trim();
    if (!id) {
      return { removed: false, reason: "invalid_id" };
    }
    const vehicles = fleetVehicles();
    const vehicle = vehicles.get(id) || null;
    if (!vehicle) {
      return { removed: false, reason: "not_found" };
    }
    vehicles.delete(id);
    if (options?.preserveDynamicBody !== true) {
      state?.dynamicBodies?.delete?.(id);
    }
    if (typeof emitLaunchEvent === "function") {
      emitLaunchEvent("fleet_vehicle_removed", {
        shipId: id,
        vehicleRole: vehicle.vehicleRole || "mission",
        missionId: vehicle.missionId || LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD,
        missionPhase: vehicle.missionPhase || "unknown",
      });
    }
    return {
      removed: true,
      shipId: id,
      vehicleRole: vehicle.vehicleRole || "mission",
      vehicleName: vehicle.vehicleName || "Starship",
      missionId: vehicle.missionId || LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD,
      missionPhase: vehicle.missionPhase || "unknown",
    };
  }

  function refuelFlightById(bodyId) {
    const targetId = String(bodyId || "");
    if (!targetId) {
      return null;
    }
    const flights = Array.isArray(runtime?.refuel?.flights) ? runtime.refuel.flights : [];
    for (let i = 0; i < flights.length; i += 1) {
      const flight = flights[i];
      if (String(flight?.id || "") === targetId) {
        return flight;
      }
    }
    return null;
  }

  function listEligibleTankerTargets(state, shipState, earthState) {
    if (
      !state?.dynamicBodies
      || !shipState
      || !earthState
      || !finiteVector(shipState.position)
      || !finiteVector(shipState.velocity || { x: 0, y: 0, z: 0 })
      || !finiteVector(earthState.position)
      || !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      return [];
    }
    const flights = Array.isArray(runtime?.refuel?.flights) ? runtime.refuel.flights : [];
    const flightsById = new Map();
    for (let i = 0; i < flights.length; i += 1) {
      const flight = flights[i];
      const id = String(flight?.id || "").trim();
      if (id) {
        flightsById.set(id, flight);
      }
    }
    const earthRadiusKm = Math.max(1000, Number(getEarthRadiusKm?.()) || 6371);
    const earthVelocity = earthState.velocity || { x: 0, y: 0, z: 0 };
    const shipVelocity = shipState.velocity || { x: 0, y: 0, z: 0 };
    const shipRelPosEarth = subtract(shipState.position, earthState.position);
    const shipRelVelEarth = subtract(shipVelocity, earthVelocity);
    const shipAltitudeKm = length(shipRelPosEarth) - earthRadiusKm;
    const shipRadialSpeedKmS = dot(
      shipRelVelEarth,
      normalize(shipRelPosEarth, { x: 0, y: 0, z: 1 }),
    );
    const shipProgradeEarth = normalize(
      shipRelVelEarth,
      normalize(shipRelPosEarth, { x: 0, y: 0, z: 1 }),
    );
    const candidates = [];
    for (const [bodyId, tankerState] of state.dynamicBodies.entries()) {
      const tankerId = String(bodyId || "").trim();
      if (!tankerId.startsWith("earth_refuel_tanker_")) {
        continue;
      }
      if (
        !finiteVector(tankerState?.position)
        || !finiteVector(tankerState?.velocity || { x: 0, y: 0, z: 0 })
      ) {
        continue;
      }
      const relPosEarth = subtract(tankerState.position, earthState.position);
      const altitudeKm = length(relPosEarth) - earthRadiusKm;
      const flight = flightsById.get(tankerId) || null;
      if (!isFlightDockingEligible(
        flight
          ? {
            ...flight,
            active: true,
            sensorAltitudeKm: altitudeKm,
          }
          : {
            active: true,
            sensorAltitudeKm: altitudeKm,
            status: "external_orbit",
          },
        REFUEL_TANKER_CONFIG,
      )) {
        continue;
      }
      const relativePositionKm = subtract(tankerState.position, shipState.position);
      const relativeVelocityKmS = subtract(tankerState.velocity || { x: 0, y: 0, z: 0 }, shipVelocity);
      const distanceKm = length(relativePositionKm);
      if (!(distanceKm > 0)) {
        continue;
      }
      const unitToTarget = scale(relativePositionKm, 1 / distanceKm);
      const closingSpeedKmS = dot(scale(relativeVelocityKmS, -1), unitToTarget);
      const relativeSpeedKmS = length(relativeVelocityKmS);
      const tankerRelVelEarth = subtract(tankerState.velocity || { x: 0, y: 0, z: 0 }, earthVelocity);
      const radialSpeedKmS = dot(
        tankerRelVelEarth,
        normalize(relPosEarth, { x: 0, y: 0, z: 1 }),
      );
      const safeClosingSpeedKmS = Number.isFinite(closingSpeedKmS)
        ? closingSpeedKmS
        : -1;
      const altitudeErrorKm = Math.abs(altitudeKm - shipAltitudeKm);
      const radialSpeedErrorKmS = Math.abs(radialSpeedKmS - shipRadialSpeedKmS);
      const desiredClosingKmS = clamp(distanceKm / 80_000, 0.005, 0.12);
      const weakClosingPenaltyKmS = Math.max(0, desiredClosingKmS - safeClosingSpeedKmS);
      const separatingPenaltyKmS = Math.max(0, -safeClosingSpeedKmS);
      const aheadDot = dot(unitToTarget, shipProgradeEarth);
      const behindRecoverable = aheadDot <= -0.05
        && safeClosingSpeedKmS >= 0.004
        && relativeSpeedKmS <= 0.09
        && altitudeErrorKm <= 40
        && radialSpeedErrorKmS <= 0.02;
      const interceptScore = (
        (distanceKm / 6000)
        + (relativeSpeedKmS * 80)
        + (weakClosingPenaltyKmS * 700)
        + (separatingPenaltyKmS * 2500)
        + (altitudeErrorKm / 150)
        + (radialSpeedErrorKmS * 9000)
      );
      const candidate = {
        tankerId,
        distanceKm,
        relativeSpeedKmS,
        closingSpeedKmS,
        relativePositionKm,
        relativeVelocityKmS,
        altitudeKm,
        radialSpeedKmS,
        altitudeErrorKm,
        radialSpeedErrorKmS,
        aheadDot,
        behindRecoverable,
        interceptScore,
      };
      candidates.push(candidate);
    }
    candidates.sort((a, b) => Number(a.interceptScore) - Number(b.interceptScore));
    return candidates;
  }

  function selectLockedTankerTargetForVehicle(
    vehicle,
    state,
    shipState,
    earthState,
    { mutateLock = true } = {},
  ) {
    const candidates = listEligibleTankerTargets(state, shipState, earthState);
    const nowSec = Math.max(0, Number(vehicle?.elapsedSeconds) || 0);
    const selection = selectStickyTarget({
      candidates,
      lockId: String(vehicle?.refuelTargetLockId || ""),
      lockAcquiredSec: Number(vehicle?.refuelTargetLockAcquiredSec) || 0,
      nowSec,
      options: {
        minHoldSec: 140,
        switchGainFraction: 0.22,
        lockDistanceFactor: 1.55,
        lockDistanceMarginKm: 900,
        separatingClosingThresholdKmS: -0.01,
        separatingImprovementKmS: 0.01,
        avoidBehindTargets: true,
        allowRecoverableBehindTargets: true,
        behindDotThreshold: -0.05,
        behindRecoverableMinClosingKmS: 0.004,
        behindRecoverableMaxRelativeSpeedKmS: 0.09,
        behindRecoverableMaxDistanceKm: 1600,
        stickToLockUntilInvalid: true,
      },
    });
    if (vehicle && typeof vehicle === "object" && mutateLock) {
      vehicle.refuelTargetLockId = String(selection.nextLockId || "");
      vehicle.refuelTargetLockAcquiredSec = Math.max(0, Number(selection.nextLockAcquiredSec) || 0);
    }
    return selection.selected;
  }

  function reserveNextFleetMissionIdentity(state) {
    if (!state?.dynamicBodies) {
      return null;
    }
    const vehicles = fleetVehicles();
    const fleetState = ensureFleetRuntimeState();
    let sequenceNumber = Math.max(1, Number(fleetState.nextShipSequence) || 1);
    while (sequenceNumber < 1_000_000_000) {
      const id = `${FLEET_MISSION_SHIP_ID_PREFIX}${sequenceNumber}`;
      const existsInDynamics = state.dynamicBodies.has(id);
      const existsInFleet = vehicles.has(id);
      if (!existsInDynamics && !existsInFleet) {
        fleetState.nextShipSequence = sequenceNumber + 1;
        return { id, sequenceNumber };
      }
      sequenceNumber += 1;
    }
    return null;
  }

  function fleetPadSpawnState({
    earthState,
    sequenceNumber = 1,
    nowMs = Date.now(),
  }) {
    const earthRadiusKm = Math.max(1000, Number(getEarthRadiusKm?.()) || 6371);
    const axes = typeof earthAxes === "function"
      ? (earthAxes(nowMs) || { xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, pole: { x: 0, y: 0, z: 1 } })
      : { xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, pole: { x: 0, y: 0, z: 1 } };
    const slot = Math.max(0, Number(sequenceNumber) - 1);
    const row = Math.floor(slot / 3);
    const col = slot % 3;
    const latitudeOffsetDeg = (row * 0.032);
    const longitudeOffsetDeg = (col - 1) * 0.055;
    const latitudeDeg = clamp(Number(LAUNCH_SITE.latitudeDeg) + latitudeOffsetDeg, -85, 85);
    let longitudeDeg = Number(LAUNCH_SITE.longitudeDeg) + longitudeOffsetDeg;
    while (longitudeDeg > 180) {
      longitudeDeg -= 360;
    }
    while (longitudeDeg < -180) {
      longitudeDeg += 360;
    }
    const up = bodyDirectionFromLatLon(axes, latitudeDeg, longitudeDeg);
    const terrainElevationKm = terrainHeightKmAtLatLon(latitudeDeg, longitudeDeg);
    const launchRadiusKm =
      earthRadiusKm
      + (Number.isFinite(terrainElevationKm) ? terrainElevationKm : 0)
      + (Number(LAUNCH_SITE.altitudeKm) || 0)
      + Math.max(0, Number(STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM) || 0);
    const relPositionKm = scale(up, launchRadiusKm);
    const angularVelocity = scale(axes.pole || { x: 0, y: 0, z: 1 }, EARTH_SIDEREAL_ANGULAR_RATE_RAD_S);
    const rotationalVelocityKmS = cross(angularVelocity, relPositionKm);
    return {
      position: add(earthState.position, relPositionKm),
      velocity: add(earthState.velocity || { x: 0, y: 0, z: 0 }, rotationalVelocityKmS),
      latitudeDeg,
      longitudeDeg,
    };
  }

  function fleetOrbitInjectState({
    earthState,
    orbitAltitudeKm = 150,
    inclinationDeg = 28.5,
    ascendingNodeRad = 0,
    phaseAngleRad = Number.NaN,
    apoapsisAltitudeKm = Number.NaN,
    spawnAtPeriapsis = false,
  }) {
    const earthRadiusKm = Math.max(1000, Number(getEarthRadiusKm?.()) || 6371);
    const muKm3S2 = Number(gravitationalConstantKm3PerKgS2) * (Number(getEarthMassKg?.()) || 0);
    if (!(muKm3S2 > 0)) {
      return null;
    }
    const targetPeriapsisAltitudeKm = Math.max(120, Number(orbitAltitudeKm) || 150);
    const requestedApoapsisAltitudeKm = Number(apoapsisAltitudeKm);
    const usePeriapsisSpawn = Boolean(spawnAtPeriapsis)
      && Number.isFinite(requestedApoapsisAltitudeKm)
      && requestedApoapsisAltitudeKm > (targetPeriapsisAltitudeKm + 1);
    const orbitRadiusKm = earthRadiusKm + targetPeriapsisAltitudeKm;
    const orbitApoapsisRadiusKm = usePeriapsisSpawn
      ? earthRadiusKm + Math.max(targetPeriapsisAltitudeKm + 1, requestedApoapsisAltitudeKm)
      : orbitRadiusKm;
    const semiMajorAxisKm = usePeriapsisSpawn
      ? (orbitRadiusKm + orbitApoapsisRadiusKm) * 0.5
      : orbitRadiusKm;
    const speedAtSpawnKmS = usePeriapsisSpawn
      ? Math.sqrt(
        Math.max(
          0,
          muKm3S2 * ((2 / orbitRadiusKm) - (1 / semiMajorAxisKm)),
        ),
      )
      : Math.sqrt(muKm3S2 / orbitRadiusKm);
    const incRad = rad(clamp(Number(inclinationDeg) || 28.5, 0, 89.5));
    const nodeRad = normalizeAngleZeroToTau(Number(ascendingNodeRad) || 0);
    const phaseAngle = Number.isFinite(Number(phaseAngleRad))
      ? normalizeAngleZeroToTau(Number(phaseAngleRad))
      : (Math.random() * (Math.PI * 2));
    const cNode = Math.cos(nodeRad);
    const sNode = Math.sin(nodeRad);
    const cTheta = Math.cos(phaseAngle);
    const sTheta = Math.sin(phaseAngle);
    const cInc = Math.cos(incRad);
    const sInc = Math.sin(incRad);
    const e1 = { x: cNode, y: sNode, z: 0 };
    const e2 = normalize(
      { x: -sNode * cInc, y: cNode * cInc, z: sInc },
      { x: -sNode, y: cNode, z: 0 },
    );
    const relPositionKm = add(
      scale(e1, orbitRadiusKm * cTheta),
      scale(e2, orbitRadiusKm * sTheta),
    );
    const relVelocityDirection = normalize(
      add(
        scale(e1, -sTheta),
        scale(e2, cTheta),
      ),
      { x: 0, y: 1, z: 0 },
    );
    const relVelocityKmS = scale(relVelocityDirection, speedAtSpawnKmS);
    const surfaceCoordinates = geodeticLatLonDegFromRelativePosition(relPositionKm);
    return {
      position: add(earthState.position, relPositionKm),
      velocity: add(earthState.velocity || { x: 0, y: 0, z: 0 }, relVelocityKmS),
      orbitAltitudeKm: targetPeriapsisAltitudeKm,
      periapsisAltitudeKm: targetPeriapsisAltitudeKm,
      apoapsisAltitudeKm: usePeriapsisSpawn
        ? (orbitApoapsisRadiusKm - earthRadiusKm)
        : targetPeriapsisAltitudeKm,
      spawnAtPeriapsis: usePeriapsisSpawn,
      inclinationDeg: Number(inclinationDeg) || 28.5,
      ascendingNodeRad: nodeRad,
      latitudeDeg: surfaceCoordinates.latitudeDeg,
      longitudeDeg: surfaceCoordinates.longitudeDeg,
      injected: true,
    };
  }

  function launchMissionShip(
    state,
    missionId = runtime?.mission?.selectedId,
    nowMs = Date.now(),
    options = {},
  ) {
    if (!state?.dynamicBodies) {
      return { accepted: false, reason: "state_unavailable" };
    }
    const earthState = bodyStateFromNBody(state, "earth");
    if (
      !earthState
      || !finiteVector(earthState.position)
      || !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      return { accepted: false, reason: "earth_state_unavailable" };
    }
    const normalizedMissionId = normalizeMissionId(missionId);
    const vehicles = fleetVehicles();
    const vehicleRole = String(options?.vehicleRole || "mission").toLowerCase() === "tanker"
      ? "tanker"
      : "mission";
    const forcedId = String(options?.forcedId || "").trim();
    let identity = null;
    if (forcedId) {
      if (state.dynamicBodies.has(forcedId) || vehicles.has(forcedId)) {
        return { accepted: false, reason: "mission_ship_id_exhausted" };
      }
      const sequenceFromId = Number(String(forcedId).match(/_(\d+)$/)?.[1]);
      identity = {
        id: forcedId,
        sequenceNumber: Math.max(
          1,
          Number(options?.forcedSequenceNumber) || sequenceFromId || 1,
        ),
      };
    } else {
      identity = reserveNextFleetMissionIdentity(state);
      if (!identity) {
        return { accepted: false, reason: "mission_ship_id_exhausted" };
      }
    }
    const launchMode = String(options?.mode || "pad_launch").trim().toLowerCase() === "orbit_inject"
      ? "orbit_inject"
      : "pad_launch";
    const isMoonOrbitInject = (
      launchMode === "orbit_inject"
      && vehicleRole !== "tanker"
      && normalizedMissionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
    );
    const requestedOrbitInjectAltitudeKm = Number(options?.orbitInjectAltitudeKm);
    const defaultOrbitInjectAltitudeKm = (
      vehicleRole !== "tanker"
      && normalizedMissionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
    )
      ? MOON_ORBIT_INJECT_ALTITUDE_KM
      : 150;
    const orbitInjectAltitudeKm = Number.isFinite(requestedOrbitInjectAltitudeKm)
      ? Math.max(120, requestedOrbitInjectAltitudeKm)
      : defaultOrbitInjectAltitudeKm;
    const stage1Raw = typeof stageAtIndex === "function" ? stageAtIndex(0) : null;
    const stage2Raw = typeof stageAtIndex === "function" ? stageAtIndex(1) : null;
    const optimizerStage2DryMassKg = Math.max(30_000, Number(stage2Raw?.dryMassKg) || 120_000);
    let optimizerStage2PropellantMassKg = Math.max(
      100_000,
      Number(stage2Raw?.propellantMassKg) || 1_200_000,
    );
    if (
      vehicleRole !== "tanker"
      && normalizedMissionId === LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO
    ) {
      optimizerStage2PropellantMassKg = Math.max(
        optimizerStage2PropellantMassKg,
        FLEET_ORBITAL_REFUEL_DEMO_STAGE2_MIN_PROPELLANT_KG,
      );
    }
    if (
      vehicleRole !== "tanker"
      && normalizedMissionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
    ) {
      optimizerStage2PropellantMassKg = Math.max(
        optimizerStage2PropellantMassKg,
        FLEET_MOON_MISSION_STAGE2_MIN_PROPELLANT_KG,
      );
    }
    const optimizerRequestedInjectStagePropellantKg = Number(options?.orbitInjectStagePropellantKg);
    const optimizerInjectedStagePropellantKg = launchMode === "orbit_inject"
      ? (
        Number.isFinite(optimizerRequestedInjectStagePropellantKg)
          ? clamp(optimizerRequestedInjectStagePropellantKg, 0, optimizerStage2PropellantMassKg)
          : optimizerStage2PropellantMassKg
      )
      : optimizerStage2PropellantMassKg;
    const optimizerStage2ThrustVacuumN = Math.max(
      0,
      Number(stage2Raw?.thrustVacuumN) || Number(stage2Raw?.thrustSeaLevelN) || 0,
    );
    const moonDepartureSolverStageMassKg = optimizerStage2DryMassKg + optimizerInjectedStagePropellantKg;
    const moonDepartureSolverEngineAccelAtThrottle1KmS2 = (
      optimizerStage2ThrustVacuumN > 0
      && moonDepartureSolverStageMassKg > 0
    )
      ? ((optimizerStage2ThrustVacuumN / moonDepartureSolverStageMassKg) / 1000)
      : null;
    const moonState = bodyStateFromNBody(state, "moon");
    const earthMuKm3S2 = Number(gravitationalConstantKm3PerKgS2)
      * (
        Number(getEarthMassKg?.())
        || Number(earthState.massKg)
        || 0
      );
    const moonDepartureWindowSeed = isMoonOrbitInject
      ? solveBestMoonOrbitInjectWindow({
        earthState,
        moonState,
        inclinationDeg: Number(LAUNCH_SITE.latitudeDeg) || 28.5,
        orbitAltitudeKm: orbitInjectAltitudeKm,
        earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
        earthMuKm3S2,
        engineAccelAtThrottle1KmS2: moonDepartureSolverEngineAccelAtThrottle1KmS2,
        spacecraftMassKg: moonDepartureSolverStageMassKg,
        nodeSamples: MOON_ORBIT_INJECT_DEPARTURE_NODE_SAMPLES,
        searchProfile: MOON_ORBIT_INJECT_DEPARTURE_SEARCH_PROFILE,
      })
      : null;
    const moonOrbitInjectAscendingNodeRad = moonDepartureWindowSeed
      ? Number(moonDepartureWindowSeed.ascendingNodeRad)
      : 0;
    const moonWindowInjectPhaseRad = moonDepartureWindowSeed
      ? Number(moonDepartureWindowSeed.targetPhaseRad)
      : Number.NaN;
    const moonOptimizedInjectApoapsisAltitudeKm = moonDepartureWindowSeed
      ? Number(moonDepartureWindowSeed.optimizedApoapsisAltitudeKm)
      : Number.NaN;
    const orbitInjectPhaseAngleRad = isMoonOrbitInject
      ? (
        Number.isFinite(Number(moonWindowInjectPhaseRad))
          ? Number(moonWindowInjectPhaseRad)
          : 0
      )
      : Number.NaN;
    const moonPadLaunchWindowLocked =
      launchMode === "pad_launch"
      && vehicleRole !== "tanker"
      && normalizedMissionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN;
    const moonPeriapsisInjectApoapsisKm = Math.max(
      orbitInjectAltitudeKm + 20,
      Number.isFinite(moonOptimizedInjectApoapsisAltitudeKm)
        ? moonOptimizedInjectApoapsisAltitudeKm
        : (Number(options?.orbitInjectMoonApoapsisKm) || 220),
    );
    const spawnState = launchMode === "orbit_inject"
      ? fleetOrbitInjectState({
        earthState,
        orbitAltitudeKm: orbitInjectAltitudeKm,
        apoapsisAltitudeKm: isMoonOrbitInject
          ? moonPeriapsisInjectApoapsisKm
          : Number.NaN,
        spawnAtPeriapsis: isMoonOrbitInject,
        inclinationDeg: Number(LAUNCH_SITE.latitudeDeg) || 28.5,
        ascendingNodeRad: isMoonOrbitInject ? moonOrbitInjectAscendingNodeRad : 0,
        phaseAngleRad: orbitInjectPhaseAngleRad,
      })
      : fleetPadSpawnState({
        earthState,
        sequenceNumber: moonPadLaunchWindowLocked ? 1 : identity.sequenceNumber,
        nowMs,
      });
    if (!spawnState) {
      return {
        accepted: false,
        reason: launchMode === "orbit_inject" ? "orbit_inject_unavailable" : "spawn_pad_unavailable",
      };
    }
    const moonDepartureWindow = isMoonOrbitInject
      ? (
        solveMoonDepartureWindow({
          earthState,
          moonState,
          shipPositionKm: spawnState.position,
          inclinationDeg: Number(LAUNCH_SITE.latitudeDeg) || 28.5,
          ascendingNodeRad: isMoonOrbitInject
            ? moonOrbitInjectAscendingNodeRad
            : 0,
          orbitAltitudeKm: orbitInjectAltitudeKm,
          earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
          earthMuKm3S2,
          padAngularRateRadS: EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
          phaseToleranceDeg: FLEET_MOON_PAD_WINDOW_PHASE_TOLERANCE_DEG,
          engineAccelAtThrottle1KmS2: moonDepartureSolverEngineAccelAtThrottle1KmS2,
          spacecraftMassKg: moonDepartureSolverStageMassKg,
        })
        || moonDepartureWindowSeed
      )
      : null;
    const moonDeparturePlanSource = isMoonOrbitInject
      ? chooseMoonDeparturePlanSource(moonDepartureWindowSeed, moonDepartureWindow)
      : moonDepartureWindow;
    const moonDepartureTelemetrySource = isMoonOrbitInject
      ? moonDeparturePlanSource
      : moonDepartureWindow;

    const stageProfiles = [
      {
        name: String(stage1Raw?.name || "Stage 1"),
        dryMassKg: Math.max(50_000, Number(stage1Raw?.dryMassKg) || 200_000),
        propellantMassKg: Math.max(100_000, Number(stage1Raw?.propellantMassKg) || 3_400_000),
        thrustSeaLevelN: Math.max(0, Number(stage1Raw?.thrustSeaLevelN) || 0),
        thrustVacuumN: Math.max(0, Number(stage1Raw?.thrustVacuumN) || Number(stage1Raw?.thrustSeaLevelN) || 0),
        ispSeaLevelS: Math.max(1, Number(stage1Raw?.ispSeaLevelS) || 327),
        ispVacuumS: Math.max(1, Number(stage1Raw?.ispVacuumS) || Number(stage1Raw?.ispSeaLevelS) || 350),
      },
      {
        name: String(stage2Raw?.name || "Stage 2"),
        dryMassKg: Math.max(30_000, Number(stage2Raw?.dryMassKg) || 120_000),
        propellantMassKg: Math.max(100_000, Number(stage2Raw?.propellantMassKg) || 1_200_000),
        thrustSeaLevelN: Math.max(0, Number(stage2Raw?.thrustSeaLevelN) || 0),
        thrustVacuumN: Math.max(0, Number(stage2Raw?.thrustVacuumN) || Number(stage2Raw?.thrustSeaLevelN) || 0),
        ispSeaLevelS: Math.max(1, Number(stage2Raw?.ispSeaLevelS) || 353),
        ispVacuumS: Math.max(1, Number(stage2Raw?.ispVacuumS) || Number(stage2Raw?.ispSeaLevelS) || 380),
      },
    ];
    if (
      vehicleRole !== "tanker"
      && normalizedMissionId === LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO
      && stageProfiles[1]
    ) {
      stageProfiles[1].propellantMassKg = Math.max(
        Number(stageProfiles[1].propellantMassKg) || 0,
        FLEET_ORBITAL_REFUEL_DEMO_STAGE2_MIN_PROPELLANT_KG,
      );
    }
    if (
      vehicleRole !== "tanker"
      && normalizedMissionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
      && stageProfiles[1]
    ) {
      stageProfiles[1].propellantMassKg = Math.max(
        Number(stageProfiles[1].propellantMassKg) || 0,
        FLEET_MOON_MISSION_STAGE2_MIN_PROPELLANT_KG,
      );
    }
    const injectedStageIndex = 1;
    const injectedStage = stageProfiles[injectedStageIndex] || stageProfiles[stageProfiles.length - 1];
    const injectedStageNominalPropellantKg = Math.max(0, Number(injectedStage?.propellantMassKg) || 0);
    const requestedInjectStagePropellantKg = Number(options?.orbitInjectStagePropellantKg);
    const orbitInjectStagePropellantKg = launchMode === "orbit_inject"
      ? (
        Number.isFinite(requestedInjectStagePropellantKg)
          ? clamp(requestedInjectStagePropellantKg, 0, injectedStageNominalPropellantKg)
          : (
            vehicleRole !== "tanker"
            && normalizedMissionId === LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO
              ? (injectedStageNominalPropellantKg * FLEET_ORBITAL_REFUEL_DEMO_ORBIT_INJECT_STAGE2_FILL_FRACTION)
              : injectedStageNominalPropellantKg
          )
      )
      : injectedStageNominalPropellantKg;
    const initialMassKg = launchMode === "orbit_inject"
      ? (
        Math.max(0, Number(injectedStage?.dryMassKg) || 0)
        + orbitInjectStagePropellantKg
      )
      : stageProfiles.reduce(
        (sum, stage) => sum + stage.dryMassKg + stage.propellantMassKg,
        0,
      );
    const bodyState = {
      id: identity.id,
      massKg: initialMassKg,
      position: { ...spawnState.position },
      velocity: { ...spawnState.velocity },
    };
    state.dynamicBodies.set(identity.id, bodyState);

    const missionPhase = launchMode === "orbit_inject"
      ? (
        vehicleRole === "tanker"
          ? "orbital_hold"
          : (
            normalizedMissionId === LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO
              ? "orbital_refuel"
              : (
            normalizedMissionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
              ? "tli_burn"
              : "earth_orbit_hold"
              )
          )
      )
      : "launch_to_parking";
    const vehicleName = String(options?.vehicleName || "").trim()
      || (vehicleRole === "tanker"
        ? `Starship Tanker ${identity.sequenceNumber}`
        : `Starship ${identity.sequenceNumber}`);
    const targetOrbitApoapsisKm = vehicleRole === "tanker"
      ? 160
      : (
        normalizedMissionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
          ? MOON_PARKING_ORBIT_APOAPSIS_KM
          : 240
      );
    const targetOrbitPeriapsisKm = vehicleRole === "tanker"
      ? 150
      : (
        normalizedMissionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
          ? MOON_PARKING_ORBIT_PERIAPSIS_KM
          : 200
      );
    const spawnRelPos = subtract(spawnState.position, earthState.position);
    const spawnRelVel = subtract(
      spawnState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    const spawnUp = normalize(spawnRelPos, { x: 0, y: 0, z: 1 });
    const spawnPrograde = normalize(spawnRelVel, spawnUp);
    const initialBodyAxis = launchMode === "orbit_inject"
      ? spawnPrograde
      : spawnUp;
    vehicles.set(identity.id, {
      id: identity.id,
      sequenceNumber: identity.sequenceNumber,
      vehicleRole,
      vehicleName,
      missionId: normalizedMissionId,
      missionPhase,
      missionCompleted: false,
      elapsedSeconds: 0,
      phaseElapsedSec: 0,
      stageProfiles,
      launchMode,
      moonPadWindowEnabled: Boolean(moonPadLaunchWindowLocked),
      moonPadWindowPhaseToleranceDeg: FLEET_MOON_PAD_WINDOW_PHASE_TOLERANCE_DEG,
      moonPadWindowStatus: null,
      moonDepartureWindowScore: moonDepartureTelemetrySource
        ? finiteOrNull(moonDepartureTelemetrySource.windowScore)
        : null,
      moonDepartureWindowWaitSec: moonDepartureTelemetrySource
        ? finiteOrNull(moonDepartureTelemetrySource.waitSec)
        : null,
      moonDepartureWindowPhaseErrorDeg: moonDepartureTelemetrySource
        ? finiteOrNull(moonDepartureTelemetrySource.phaseErrorDeg)
        : null,
      moonDepartureGeometryScore: moonDepartureTelemetrySource
        ? finiteOrNull(moonDepartureTelemetrySource.geometryScore)
        : null,
      moonDepartureAlignNow: moonDepartureTelemetrySource
        ? finiteOrNull(moonDepartureTelemetrySource.selectedDepartureAlignment)
        : null,
      moonDepartureAlignProjected: moonDepartureTelemetrySource
        ? finiteOrNull(moonDepartureTelemetrySource.selectedProjectedAlignment)
        : null,
      moonDepartureWindowReady: Boolean(moonDepartureTelemetrySource?.ready),
      moonDepartureCorridorAccepted: Boolean(moonDepartureTelemetrySource?.corridorAccepted),
      moonDepartureCorridorScore: moonDepartureTelemetrySource
        ? finiteOrNull(moonDepartureTelemetrySource.corridorScore)
        : null,
      moonEstimatedTliDeltaVKmS: moonDepartureTelemetrySource
        ? finiteOrNull(moonDepartureTelemetrySource.estimatedTliDeltaVKmS)
        : null,
      moonDeparturePlanReady: Boolean(moonDeparturePlanSource?.ready),
      moonDeparturePlanDirectionKm: cloneFiniteVector(moonDeparturePlanSource?.optimizedBurnDirection),
      moonDeparturePlanThrottle: moonDeparturePlanSource
        ? finiteOrNull(moonDeparturePlanSource.optimizedThrottle)
        : null,
      moonDeparturePlanBurnDurationSec: moonDeparturePlanSource
        ? finiteOrNull(moonDeparturePlanSource.optimizedBurnDurationSec)
        : null,
      moonDeparturePlanCommitWindowSec: moonDeparturePlanSource
        ? deriveMoonDepartureCommitWindowSec(moonDeparturePlanSource.optimizedBurnDurationSec)
        : null,
      moonDeparturePlanPredictedMissDistanceKm: moonDeparturePlanSource
        ? finiteOrNull(moonDeparturePlanSource.predictedMissDistanceKm)
        : null,
      moonDeparturePlanPredictedPeriluneAltitudeKm: moonDeparturePlanSource
        ? finiteOrNull(moonDeparturePlanSource.predictedPeriluneAltitudeKm)
        : null,
      moonDeparturePlanBPlaneErrorKm: moonDeparturePlanSource
        ? finiteOrNull(moonDeparturePlanSource.bPlaneErrorKm)
        : null,
      moonDeparturePlanTransferTimeSec: moonDeparturePlanSource
        ? finiteOrNull(moonDeparturePlanSource.transferTimeSec)
        : null,
      moonDeparturePlanTransitStartElapsedSec: null,
      moonDepartureSeedPositionKm: isMoonOrbitInject ? cloneFiniteVector(spawnRelPos) : null,
      moonDepartureSeedVelocityKmS: isMoonOrbitInject ? cloneFiniteVector(spawnRelVel) : null,
      moonDepartureAscendingNodeRad: isMoonOrbitInject
        ? finiteOrNull(spawnState.ascendingNodeRad)
        : null,
      moonDepartureTargetPhaseRad: isMoonOrbitInject
        ? finiteOrNull(moonWindowInjectPhaseRad)
        : null,
      stageIndex: launchMode === "orbit_inject" ? injectedStageIndex : 0,
      stagePropellantKg: launchMode === "orbit_inject"
        ? orbitInjectStagePropellantKg
        : Math.max(0, Number(stageProfiles[0]?.propellantMassKg) || 0),
      dryMassKg: launchMode === "orbit_inject"
        ? Math.max(minRocketMassKg, Number(injectedStage?.dryMassKg) || minRocketMassKg)
        : stageProfiles.reduce((sum, stage) => sum + stage.dryMassKg, 0),
      propellantKg: launchMode === "orbit_inject"
        ? orbitInjectStagePropellantKg
        : stageProfiles.reduce((sum, stage) => sum + stage.propellantMassKg, 0),
      tliDurationSec: (
        Number.isFinite(Number(moonDeparturePlanSource?.optimizedBurnDurationSec))
          && Number(moonDeparturePlanSource.optimizedBurnDurationSec) > 0
          ? Math.max(60, Number(moonDeparturePlanSource.optimizedBurnDurationSec))
          : null
      ),
      tliTimeoutSec: resolveMoonTliTimeoutSec(
        Number.isFinite(Number(moonDeparturePlanSource?.optimizedBurnDurationSec))
          && Number(moonDeparturePlanSource.optimizedBurnDurationSec) > 0
          ? Math.max(60, Number(moonDeparturePlanSource.optimizedBurnDurationSec))
          : null,
      ),
      guidanceMode: launchMode === "orbit_inject" ? "autopilot-ballistic-hold" : "autopilot-vertical-ascent",
      targetOrbitApoapsisKm,
      targetOrbitPeriapsisKm,
      launchLatitudeDeg: Number(spawnState.latitudeDeg),
      launchLongitudeDeg: Number(spawnState.longitudeDeg),
      lastStep: {
        accelerationKmS2: { x: 0, y: 0, z: 0 },
        throttle: 0,
        thrustN: 0,
        burnRateKgS: 0,
        burnKg: 0,
        guidanceMode: launchMode === "orbit_inject" ? "autopilot-ballistic-hold" : "autopilot-vertical-ascent",
        dynamicPressurePa: 0,
        guidanceBurnRequested: false,
        guidanceRequestedThrottle: 0,
        guidanceInertNoPropellant: false,
        guidanceInertReason: "",
      },
      pendingBurnKg: 0,
      guidanceBurnRequested: false,
      guidanceRequestedThrottle: 0,
      guidanceInertNoPropellant: false,
      guidanceInertReason: "",
      stageActuator: createActuatorState(initialBodyAxis),
      stageMassModel: createMassModelState(),
      moonBurnAttitudeGateActive: false,
      moonBurnAttitudeGateDirection: null,
      moonBurnAttitudeGateAlignSec: 0,
      moonEarthGuardActive: false,
      moonProjectedPeriluneAltitudeKm: null,
      moonBPlaneErrorKm: null,
      moonProjectedMissTrendKmS: null,
      moonPrevProjectedMissDistanceKm: null,
      moonTliTargetMode: "",
      moonTliTargetMissKm: null,
      moonTliTargetMissGateKm: null,
      moonTliTargetBPlaneKm: null,
      moonTliTargetPeriluneKm: null,
      moonGoNoGoStatus: "n/a",
      moonGoNoGoReason: "",
      moonSurvivalRecoveryActive: false,
      refuelTargetLockId: "",
      refuelTargetLockAcquiredSec: 0,
      navPlannerRuntime: createPlannerRuntime(),
      fuelBudget: null,
      launchTimestampMs: nowMs,
    });

    const missionName = vehicleRole === "tanker"
      ? "Orbital Tanker Ops"
      : fleetMissionNameForId(normalizedMissionId);
    const shipMeta = {
      id: identity.id,
      name: vehicleRole === "tanker" ? vehicleName : `${vehicleName} (${missionName})`,
      body_type: "spacecraft",
      parent: "earth",
      radius_km: STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 0.5,
      mass_kg: initialMassKg,
      semimajor_axis_km: null,
      orbital_period_days: null,
      phase: 0,
      description: vehicleRole === "tanker"
        ? "Pad-launched orbital tanker Starship."
        : `Pad-launched autonomous Starship assigned to ${missionName}.`,
    };

    if (typeof emitLaunchEvent === "function") {
      if (vehicleRole === "tanker") {
        emitLaunchEvent("refuel_tanker_fleet_launch_started", {
          tankerId: identity.id,
          sequenceNumber: identity.sequenceNumber,
          missionId: normalizedMissionId,
          missionPhase,
          launchMode,
        });
      } else {
        emitLaunchEvent("fleet_mission_ship_launched", {
          shipId: identity.id,
          sequenceNumber: identity.sequenceNumber,
          missionId: normalizedMissionId,
          missionPhase,
          launchMode: launchMode === "orbit_inject" ? "orbit_inject_fleet" : "pad_fleet",
          orbitInjectAltitudeKm: launchMode === "orbit_inject"
            ? Number(spawnState.orbitAltitudeKm)
            : null,
          orbitInjectPeriapsisKm: launchMode === "orbit_inject"
            ? Number(spawnState.periapsisAltitudeKm)
            : null,
          orbitInjectApoapsisKm: launchMode === "orbit_inject"
            ? Number(spawnState.apoapsisAltitudeKm)
            : null,
          orbitInjectSpawnAtPeriapsis: launchMode === "orbit_inject"
            ? Boolean(spawnState.spawnAtPeriapsis)
            : false,
        });
      }
    }

    return {
      accepted: true,
      shipId: identity.id,
      shipMeta,
      missionId: normalizedMissionId,
      missionPhase,
      vehicleRole,
      launchMode,
      orbitInjectAltitudeKm: launchMode === "orbit_inject"
        ? Number(spawnState.orbitAltitudeKm)
        : null,
      orbitInjectPeriapsisKm: launchMode === "orbit_inject"
        ? Number(spawnState.periapsisAltitudeKm)
        : null,
      orbitInjectApoapsisKm: launchMode === "orbit_inject"
        ? Number(spawnState.apoapsisAltitudeKm)
        : null,
      orbitInjectSpawnAtPeriapsis: launchMode === "orbit_inject"
        ? Boolean(spawnState.spawnAtPeriapsis)
        : false,
    };
  }

  function setFleetMissionPhase(vehicle, nextPhase, details = {}) {
    const phaseName = String(nextPhase || "").trim();
    if (!vehicle || !phaseName || vehicle.missionPhase === phaseName) {
      return;
    }
    const previousPhase = vehicle.missionPhase;
    vehicle.missionPhase = phaseName;
    vehicle.phaseElapsedSec = 0;
    const navPhase = moonNavPhaseForFleetPhase(phaseName);
    if (vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN && navPhase) {
      const plannerRuntime = ensureVehiclePlannerRuntime(vehicle);
      syncPlannerRuntime({
        plannerRuntime,
        missionId: NAVIGATION_MISSION_IDS.MOON_ORBIT_RETURN,
        missionPhase: navPhase,
      });
    } else {
      vehicle.moonProjectedPeriluneAltitudeKm = null;
      vehicle.moonBPlaneErrorKm = null;
      vehicle.moonProjectedMissTrendKmS = null;
      vehicle.moonPrevProjectedMissDistanceKm = null;
      vehicle.moonTliTargetMode = "";
      vehicle.moonTliTargetMissKm = null;
      vehicle.moonTliTargetMissGateKm = null;
      vehicle.moonTliTargetBPlaneKm = null;
      vehicle.moonTliTargetPeriluneKm = null;
      vehicle.moonGoNoGoStatus = "n/a";
      vehicle.moonGoNoGoReason = "";
    }
    if (phaseName !== "orbital_refuel") {
      vehicle.refuelTargetLockId = "";
      vehicle.refuelTargetLockAcquiredSec = 0;
      resetFleetTransferState(vehicle);
    }
    const preserveMoonDeparturePlan = (
      vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
      && (phaseName === "tli_burn" || phaseName === "coast_to_moon")
    );
    if (phaseName !== "launch_to_parking") {
      vehicle.moonPadWindowStatus = null;
      vehicle.moonPadWindowEnabled = false;
      vehicle.moonDepartureWindowScore = null;
      vehicle.moonDepartureWindowWaitSec = null;
      vehicle.moonDepartureWindowPhaseErrorDeg = null;
      vehicle.moonDepartureGeometryScore = null;
      vehicle.moonDepartureAlignNow = null;
      vehicle.moonDepartureAlignProjected = null;
      vehicle.moonEstimatedTliDeltaVKmS = null;
      if (!preserveMoonDeparturePlan) {
        assignMoonDeparturePlan(vehicle, null);
      }
    }
    if (phaseName === "tli_burn") {
      vehicle.moonProjectedMissTrendKmS = null;
      vehicle.moonPrevProjectedMissDistanceKm = null;
      vehicle.moonGoNoGoStatus = "n/a";
      vehicle.moonGoNoGoReason = "";
      vehicle.moonSurvivalRecoveryActive = false;
      vehicle.moonDeparturePlanTransitStartElapsedSec = Number.isFinite(Number(vehicle.moonDeparturePlanTransferTimeSec))
        ? Math.max(0, Number(vehicle.elapsedSeconds) || 0)
        : null;
    } else if (!preserveMoonDeparturePlan) {
      vehicle.moonDeparturePlanTransitStartElapsedSec = null;
    }
    if (typeof emitLaunchEvent === "function") {
      emitLaunchEvent("fleet_mission_phase_changed", {
        shipId: vehicle.id,
        missionId: vehicle.missionId,
        fromMissionPhase: previousPhase,
        toMissionPhase: phaseName,
        ...details,
      });
    }
  }

  function emitFleetDecisionEvents(vehicle, previousDecision = {}, currentDecision = {}, trigger = "fleet_prepare_step") {
    if (!vehicle || typeof emitLaunchEvent !== "function") {
      return;
    }
    const prevGuidanceMode = String(previousDecision.guidanceMode || "");
    const nextGuidanceMode = String(currentDecision.guidanceMode || "");
    const prevTargetBodyId = String(previousDecision.targetBodyId || "");
    const nextTargetBodyId = String(currentDecision.targetBodyId || "");
    const nextTargetBodyName = String(currentDecision.targetBodyName || "");
    const prevBurnActive = Boolean(previousDecision.burnActive);
    const nextBurnActive = Boolean(currentDecision.burnActive);

    if (nextGuidanceMode !== prevGuidanceMode) {
      emitLaunchEvent("fleet_guidance_decision_changed", {
        trigger,
        shipId: vehicle.id,
        missionId: vehicle.missionId,
        fromGuidanceMode: prevGuidanceMode,
        toGuidanceMode: nextGuidanceMode,
        targetBodyId: nextTargetBodyId,
        targetBodyName: nextTargetBodyName,
        burnActive: nextBurnActive,
      });
    }
    if (nextTargetBodyId !== prevTargetBodyId) {
      emitLaunchEvent("fleet_guidance_target_changed", {
        trigger,
        shipId: vehicle.id,
        missionId: vehicle.missionId,
        fromTargetBodyId: prevTargetBodyId,
        toTargetBodyId: nextTargetBodyId,
        toTargetBodyName: nextTargetBodyName,
        guidanceMode: nextGuidanceMode,
      });
    }
    if (nextBurnActive !== prevBurnActive) {
      emitLaunchEvent("fleet_guidance_burn_state_changed", {
        trigger,
        shipId: vehicle.id,
        missionId: vehicle.missionId,
        burnActive: nextBurnActive,
        guidanceMode: nextGuidanceMode,
        targetBodyId: nextTargetBodyId,
      });
    }
  }

  function prepareStep(state, dtSeconds, nowMs = Date.now()) {
    if (!hasActiveVehicles()) {
      return;
    }
    const earthState = bodyStateFromNBody(state, "earth");
    if (
      !earthState
      || !finiteVector(earthState.position)
      || !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      return;
    }
    const currentEarthAxes = typeof earthAxes === "function"
      ? (earthAxes(nowMs) || { pole: { x: 0, y: 0, z: 1 } })
      : { pole: { x: 0, y: 0, z: 1 } };
    const earthPole = currentEarthAxes?.pole || { x: 0, y: 0, z: 1 };
    const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
    const earthMuKm3S2 = Number(gravitationalConstantKm3PerKgS2)
      * (Number(getEarthMassKg?.()) || Number(earthState.massKg) || 0);
    const moonState = bodyStateFromNBody(state, "moon");
    const moonMassKg = Number(getBodyMassKg?.("moon")) || Number(moonState?.massKg) || 7.342e22;
    const moonRadiusKm = Number(getBodyRadiusKm?.("moon")) || 1737.4;
    const moonMuKm3S2 = Number(gravitationalConstantKm3PerKgS2) * moonMassKg;
    const removeIds = [];
    const safeDtSeconds = Math.max(0, Number(dtSeconds) || 0);
    const vehicles = fleetVehicles();
    for (const [shipId, vehicle] of vehicles.entries()) {
      const shipState = state?.dynamicBodies?.get?.(shipId);
      if (
        !shipState
        || !finiteVector(shipState.position)
        || !finiteVector(shipState.velocity || { x: 0, y: 0, z: 0 })
      ) {
        removeIds.push(shipId);
        continue;
      }

      const relPos = subtract(shipState.position, earthState.position);
      const relVel = subtract(
        shipState.velocity || { x: 0, y: 0, z: 0 },
        earthState.velocity || { x: 0, y: 0, z: 0 },
      );
      const altitudeKm = Math.max(0, length(relPos) - earthRadiusKm);
      const atmosphereSample = sampleEarthAtmosphere?.(altitudeKm) || null;
      const windSample = sampleWindVectorKmS({
        altitudeKm,
        relPos,
        earthPole,
        elapsedSeconds: Math.max(0, Number(vehicle.elapsedSeconds) || 0),
        seed: (Number(runtime?.windSeed) || 0) + ((Number(vehicle.sequenceNumber) || 1) * 8191),
      });
      const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
        atmosphereSample,
        relPos,
        relVel,
        earthPole,
        windSample.vectorKmS,
      );
      const up = normalize(relPos, earthPole);
      const prograde = normalize(relVel, up);
      const orbital = earthMuKm3S2 > 0
        ? orbitalStateFromRelative(earthMuKm3S2, earthRadiusKm, relPos, relVel)
        : {
          altitudeKm,
          apoapsisKm: Number.NaN,
          periapsisKm: Number.NaN,
          timeToApoapsisSec: Number.NaN,
          specificEnergy: Number.NaN,
        };
      const stageProfiles = Array.isArray(vehicle.stageProfiles) && vehicle.stageProfiles.length >= 2
        ? vehicle.stageProfiles
        : [
          {
            name: "Stage 1",
            dryMassKg: 200_000,
            propellantMassKg: 3_400_000,
            thrustSeaLevelN: 74_000_000,
            thrustVacuumN: 77_000_000,
            ispSeaLevelS: 327,
            ispVacuumS: 350,
          },
          {
            name: "Stage 2",
            dryMassKg: 120_000,
            propellantMassKg: 1_200_000,
            thrustSeaLevelN: 6_900_000,
            thrustVacuumN: 15_600_000,
            ispSeaLevelS: 353,
            ispVacuumS: 380,
          },
        ];
      let activeStageIndex = Math.max(0, Math.min(1, Number(vehicle.stageIndex) || 0));
      vehicle.stageIndex = activeStageIndex;
      const activeStage = stageProfiles[activeStageIndex] || null;
      if (!Number.isFinite(Number(vehicle.stagePropellantKg))) {
        vehicle.stagePropellantKg = Math.max(
          0,
          Number(activeStage?.propellantMassKg) || Number(vehicle.propellantKg) || 0,
        );
      }
      const availablePropellantKg = Math.max(0, Number(vehicle.stagePropellantKg) || 0);
      const stageNominalPropellantKg = Math.max(1e-6, Number(activeStage?.propellantMassKg) || 0);
      const stagePropellantFraction = stageNominalPropellantKg > 1e-9
        ? clamp(availablePropellantKg / stageNominalPropellantKg, 0, 1)
        : 0;
      vehicle.stageMassModel = updateMassModelState(
        vehicle.stageMassModel,
        {
          propellantFraction: stagePropellantFraction,
          bodyKind: stageBodyKindFromStageIndex(activeStageIndex),
          dtSeconds: safeDtSeconds,
        },
      );
      if (!vehicle.stageActuator || typeof vehicle.stageActuator !== "object") {
        vehicle.stageActuator = createActuatorState(prograde);
      }
      const previousDecision = {
        guidanceMode: String(vehicle.guidanceMode || vehicle.lastStep?.guidanceMode || ""),
        targetBodyId: String(vehicle.decisionTargetBodyId || ""),
        targetBodyName: String(vehicle.decisionTargetBodyName || ""),
        burnActive: (
          (Number(vehicle.lastStep?.throttle) || 0) > 1e-3
          || (Number(vehicle.lastStep?.thrustN) || 0) > 1
        ),
      };
      let desiredDirection = prograde;
      let requestedThrottle = 0;
      let guidanceMode = "autopilot-orbital-hold";
      let rcsAssistAccelKmS2 = { x: 0, y: 0, z: 0 };
      let rcsAssistMode = "";
      let rcsAssistAuthority = 0;
      let rcsAssistJets = [];
      let decisionTargetBodyId = "earth";
      let decisionTargetBodyName = "Earth";
      let orbitalRefuelTarget = null;
      if (
        vehicle.vehicleRole !== "tanker"
        && vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
        && FLEET_MOONWARD_TARGET_PHASES.has(String(vehicle.missionPhase || ""))
      ) {
        decisionTargetBodyId = "moon";
        decisionTargetBodyName = "Moon";
      }
      if (vehicle.missionId !== LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
        vehicle.moonProjectedPeriluneAltitudeKm = null;
        vehicle.moonBPlaneErrorKm = null;
        vehicle.moonProjectedMissTrendKmS = null;
        vehicle.moonPrevProjectedMissDistanceKm = null;
        vehicle.moonDepartureWindowScore = null;
        vehicle.moonDepartureWindowWaitSec = null;
        vehicle.moonDepartureWindowPhaseErrorDeg = null;
        vehicle.moonDepartureGeometryScore = null;
        vehicle.moonDepartureAlignNow = null;
        vehicle.moonDepartureAlignProjected = null;
        vehicle.moonEstimatedTliDeltaVKmS = null;
        assignMoonDeparturePlan(vehicle, null);
        vehicle.moonTliTargetMode = "";
        vehicle.moonTliTargetMissKm = null;
        vehicle.moonTliTargetMissGateKm = null;
        vehicle.moonTliTargetBPlaneKm = null;
        vehicle.moonTliTargetPeriluneKm = null;
      }
      const targetApoapsisKm = Math.max(160, Number(vehicle.targetOrbitApoapsisKm) || 240);
      const targetPeriapsisKm = Math.max(120, Number(vehicle.targetOrbitPeriapsisKm) || 200);
      const apoapsisKm = Number(orbital?.apoapsisKm);
      const periapsisKm = Number(orbital?.periapsisKm);
      const timeToApoapsisSec = Number(orbital?.timeToApoapsisSec);
      const parkingReady = Number(orbital?.specificEnergy) < 0
        && apoapsisKm >= targetApoapsisKm
        && periapsisKm >= targetPeriapsisKm;

      if (vehicle.missionPhase === "launch_to_parking") {
        let moonPadWindowHold = false;
        const moonPadWindowEligible =
          vehicle.vehicleRole !== "tanker"
          && vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
          && vehicle.launchMode === "pad_launch"
          && Boolean(vehicle.moonPadWindowEnabled)
          && activeStageIndex === 0
          && altitudeKm <= FLEET_MOON_PAD_WINDOW_MAX_ALTITUDE_KM;
        if (moonPadWindowEligible && finiteVector(moonState?.position)) {
          const moonPadWindowStatus = evaluateMoonPadLaunchWindow({
            earthState,
            moonState,
            shipPositionKm: shipState.position,
            inclinationDeg: Number(LAUNCH_SITE.latitudeDeg) || 28.5,
            orbitAltitudeKm: Math.max(120, targetPeriapsisKm),
            earthRadiusKm,
            earthMuKm3S2,
            padAngularRateRadS: EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
            phaseToleranceDeg: Number(vehicle.moonPadWindowPhaseToleranceDeg) || FLEET_MOON_PAD_WINDOW_PHASE_TOLERANCE_DEG,
          });
          const moonPadWindowSolve = solveMoonDepartureWindow({
            earthState,
            moonState,
            shipPositionKm: shipState.position,
            inclinationDeg: Number(LAUNCH_SITE.latitudeDeg) || 28.5,
            orbitAltitudeKm: Math.max(120, targetPeriapsisKm),
            earthRadiusKm,
            earthMuKm3S2,
            padAngularRateRadS: EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
            phaseToleranceDeg: Number(vehicle.moonPadWindowPhaseToleranceDeg) || FLEET_MOON_PAD_WINDOW_PHASE_TOLERANCE_DEG,
          });
          vehicle.moonPadWindowStatus = moonPadWindowStatus;
          vehicle.moonDepartureWindowScore = finiteOrNull(
            moonPadWindowSolve?.windowScore ?? moonPadWindowStatus?.windowScore,
          );
          vehicle.moonDepartureWindowWaitSec = finiteOrNull(
            moonPadWindowSolve?.waitSec ?? moonPadWindowStatus?.waitSec,
          );
          vehicle.moonDepartureWindowPhaseErrorDeg = finiteOrNull(
            moonPadWindowSolve?.phaseErrorDeg ?? moonPadWindowStatus?.phaseErrorDeg,
          );
          vehicle.moonDepartureGeometryScore = finiteOrNull(
            moonPadWindowSolve?.geometryScore,
          );
          vehicle.moonDepartureAlignNow = finiteOrNull(
            moonPadWindowSolve?.selectedDepartureAlignment,
          );
          vehicle.moonDepartureAlignProjected = finiteOrNull(
            moonPadWindowSolve?.selectedProjectedAlignment,
          );
          vehicle.moonEstimatedTliDeltaVKmS = finiteOrNull(
            moonPadWindowSolve?.estimatedTliDeltaVKmS ?? moonPadWindowStatus?.estimatedTliDeltaVKmS,
          );
          vehicle.moonDepartureWindowReady = Boolean(moonPadWindowSolve?.ready ?? moonPadWindowStatus?.ready);
          vehicle.moonDepartureCorridorAccepted = Boolean(moonPadWindowSolve?.corridorAccepted ?? moonPadWindowStatus?.corridorAccepted);
          vehicle.moonDepartureCorridorScore = finiteOrNull(
            moonPadWindowSolve?.corridorScore ?? moonPadWindowStatus?.corridorScore,
          );
          assignMoonDeparturePlan(vehicle, moonPadWindowSolve);
          const waitSec = Number(moonPadWindowStatus?.waitSec);
          const shortWindowWait = Number.isFinite(waitSec) && waitSec <= FLEET_MOON_PAD_WINDOW_MAX_WAIT_SEC;
          moonPadWindowHold = Boolean(
            moonPadWindowStatus?.valid
            && !moonPadWindowStatus?.ready
            && shortWindowWait,
          );
          if (moonPadWindowHold) {
            desiredDirection = up;
            requestedThrottle = 0;
            guidanceMode = "autopilot-prelaunch-window-hold";
          }
        } else if (
          vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
          && vehicle.launchMode === "pad_launch"
        ) {
          vehicle.moonPadWindowStatus = null;
          vehicle.moonDepartureWindowScore = null;
          vehicle.moonDepartureWindowWaitSec = null;
          vehicle.moonDepartureWindowPhaseErrorDeg = null;
          vehicle.moonDepartureGeometryScore = null;
          vehicle.moonDepartureAlignNow = null;
          vehicle.moonDepartureAlignProjected = null;
          vehicle.moonEstimatedTliDeltaVKmS = null;
          vehicle.moonDepartureWindowReady = false;
          vehicle.moonDepartureCorridorAccepted = false;
          vehicle.moonDepartureCorridorScore = null;
          assignMoonDeparturePlan(vehicle, null);
        }
        if (!moonPadWindowHold) {
          const verticalHoldActive = (Number(vehicle.phaseElapsedSec) || 0) < verticalAscentHoldSec
            && altitudeKm < verticalAscentHoldMaxAltitudeKm;
          const climbBlend = clamp((altitudeKm - 2) / 46, 0, 1);
          const gravityTurnDirection = normalize(
            add(scale(up, 1 - climbBlend), scale(prograde, climbBlend)),
            up,
          );
          const needsApoapsisRaise = !Number.isFinite(apoapsisKm) || apoapsisKm < (targetApoapsisKm - 8);
          const nearApoapsis = Number.isFinite(timeToApoapsisSec) && Math.abs(timeToApoapsisSec) < 240;
          const needsPeriapsisRaise = !Number.isFinite(periapsisKm) || periapsisKm < (targetPeriapsisKm - 6);
          if (parkingReady) {
            requestedThrottle = 0;
            desiredDirection = prograde;
            guidanceMode = "autopilot-parking-orbit-hold";
          } else if (verticalHoldActive) {
            desiredDirection = up;
            requestedThrottle = 0.97;
            guidanceMode = "autopilot-vertical-ascent";
          } else if (activeStageIndex === 0) {
            desiredDirection = needsApoapsisRaise ? gravityTurnDirection : prograde;
            requestedThrottle = needsApoapsisRaise ? 0.96 : 0.62;
            guidanceMode = needsApoapsisRaise ? "autopilot-gravity-turn" : "autopilot-coast-to-apoapsis";
          } else if (needsPeriapsisRaise && nearApoapsis) {
            desiredDirection = prograde;
            requestedThrottle = 0.78;
            guidanceMode = "autopilot-circularization-burn";
          } else if (needsApoapsisRaise) {
            desiredDirection = gravityTurnDirection;
            requestedThrottle = 0.72;
            guidanceMode = "autopilot-apoapsis-raise";
          } else {
            requestedThrottle = 0;
            desiredDirection = prograde;
            guidanceMode = "autopilot-coast-to-apoapsis";
          }
          if (dynamicPressurePa > 48_000) {
            requestedThrottle = Math.min(requestedThrottle, 0.62);
            guidanceMode = "autopilot-max-q-limit";
          }
        }
      } else if (vehicle.vehicleRole === "tanker" && vehicle.missionPhase === "orbital_hold") {
        requestedThrottle = 0;
        desiredDirection = prograde;
        guidanceMode = "autopilot-orbital-hold";
      } else if (vehicle.missionId === LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO && vehicle.missionPhase === "orbital_refuel") {
        const target = selectLockedTankerTargetForVehicle(vehicle, state, shipState, earthState);
        const targetTankerId = String(target?.tankerId || "").trim();
        const tankerState = targetTankerId ? (state?.dynamicBodies?.get?.(targetTankerId) || null) : null;
        orbitalRefuelTarget = target;
        const directionToTarget = normalize(target?.relativePositionKm || prograde, prograde);
        if (target && target.relativePositionKm) {
          decisionTargetBodyId = String(target.tankerId || "refuel_tanker");
          decisionTargetBodyName = "Refuel Tanker";
        }
        const refuelTransferDecision = updateFleetTransferGuidance({
          vehicle,
          target,
          shipState,
          tankerState,
          earthState,
          orbitalState: orbital,
          prograde,
          requestedThrottle: 0,
          desiredDirection: directionToTarget,
          guidanceMode: "navsys:orbital-refuel-await-target",
          safeDtSeconds,
          nowSec: Number(vehicle.elapsedSeconds) || 0,
          targetFillFraction: Number(REFUEL_TANKER_CONFIG.targetFillFraction) || 0.88,
          stagePropellantKg: availablePropellantKg,
          stageCapacityKg: Math.max(0, Number(activeStage?.propellantMassKg) || 0),
          emitLaunchEvent,
        });
        requestedThrottle = clamp(Number(refuelTransferDecision?.requestedThrottle) || 0, 0, 1);
        desiredDirection = normalize(refuelTransferDecision?.desiredDirection || directionToTarget, prograde);
        guidanceMode = String(refuelTransferDecision?.guidanceMode || "navsys:orbital-refuel-await-target");
        if (refuelTransferDecision?.lockTarget && targetTankerId) {
          vehicle.refuelTargetLockId = targetTankerId;
          if (!(Number(vehicle.refuelTargetLockAcquiredSec) > 0)) {
            vehicle.refuelTargetLockAcquiredSec = Math.max(0, Number(vehicle.elapsedSeconds) || 0);
          }
        }
        const refuelPeriapsisKm = Number(orbital?.periapsisKm);
        const refuelRadialSpeedKmS = Number(orbital?.radialSpeedKmS) || 0;
        const refuelTransferPhase = String(refuelTransferDecision?.state?.phase || "");
        if (
          refuelTransferPhase === "stabilize_orbit"
          && Number.isFinite(refuelPeriapsisKm)
          && refuelPeriapsisKm < 128
          && refuelRadialSpeedKmS < -0.0015
        ) {
          requestedThrottle = Math.max(
            requestedThrottle,
            clamp(0.14 + ((128 - refuelPeriapsisKm) / 140), 0.14, 0.42),
          );
          desiredDirection = normalize(
            add(
              scale(prograde, 0.9),
              scale(up, 0.1),
            ),
            prograde,
          );
          guidanceMode = "navsys:orbital-refuel-orbit-safety-recovery";
        }
        const refuelRcsAssist = computeRefuelCloseRcsAssist({
          guidanceMode,
          distanceKm: Number(target?.distanceKm),
          relativePositionKm: target?.relativePositionKm || null,
          relativeVelocityKmS: target?.relativeVelocityKmS || null,
          prograde,
          up,
        });
        if (refuelRcsAssist) {
          rcsAssistAccelKmS2 = refuelRcsAssist.accelKmS2;
          rcsAssistAuthority = refuelRcsAssist.authority;
          rcsAssistJets = refuelRcsAssist.jets;
          rcsAssistMode = refuelRcsAssist.mode;
        }
      } else if (vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN && !vehicle.missionCompleted) {
        const sunState = bodyStateFromNBody(state, "sun");
        const moonRelPos = moonState?.position
          ? subtract(shipState.position, moonState.position)
          : null;
        const moonRelVel = moonState?.velocity
          ? subtract(
            shipState.velocity || { x: 0, y: 0, z: 0 },
            moonState.velocity || { x: 0, y: 0, z: 0 },
          )
          : null;
        const toMoonVectorKm = moonRelPos ? scale(moonRelPos, -1) : null;
        const moonMinusShipRelativeVelocityKmS = moonRelVel ? scale(moonRelVel, -1) : null;
        const moonDistanceKm = moonRelPos ? Math.max(0, length(moonRelPos)) : Number.POSITIVE_INFINITY;
        const moonAltitudeKm = Number.isFinite(moonDistanceKm)
          ? (moonDistanceKm - moonRadiusKm)
          : Number.POSITIVE_INFINITY;
        const moonClosingSpeedKmS = moonRelPos && moonRelVel && moonDistanceKm > 1e-9
          ? -dot(moonRelVel, scale(moonRelPos, 1 / moonDistanceKm))
          : 0;
        const moonRelativeSpeedKmS = moonRelVel ? length(moonRelVel) : 0;
        const moonCircularSpeedKmS = moonMuKm3S2 > 0 && moonDistanceKm > 1
          ? Math.sqrt(moonMuKm3S2 / moonDistanceKm)
          : Number.NaN;
        const rawMoonProjectedMissDistanceKm = finiteVector(toMoonVectorKm)
          && finiteVector(moonMinusShipRelativeVelocityKmS)
          ? projectedClosestApproachDistanceKm(toMoonVectorKm, moonMinusShipRelativeVelocityKmS)
          : Number.POSITIVE_INFINITY;
        const previousProjectedMissKm = Number(vehicle.moonPrevProjectedMissDistanceKm);
        const moonProjectedMissTrendKmS = (
          Number.isFinite(rawMoonProjectedMissDistanceKm)
          && Number.isFinite(previousProjectedMissKm)
          && safeDtSeconds > 1e-6
        )
          ? ((rawMoonProjectedMissDistanceKm - previousProjectedMissKm) / safeDtSeconds)
          : Number.NaN;
        vehicle.moonProjectedMissTrendKmS = finiteOrNull(moonProjectedMissTrendKmS);
        if (Number.isFinite(rawMoonProjectedMissDistanceKm)) {
          vehicle.moonPrevProjectedMissDistanceKm = rawMoonProjectedMissDistanceKm;
        } else {
          vehicle.moonPrevProjectedMissDistanceKm = null;
        }
        const earthDistanceKm = Math.max(0, length(relPos));
        const earthRadialSpeedKmS = earthDistanceKm > 1e-6
          ? dot(relPos, relVel) / earthDistanceKm
          : 0;
        const sunEarthPositionKm = sunState?.position
          ? subtract(sunState.position, earthState.position)
          : null;
        const sunEarthVelocityKmS = sunState?.velocity
          ? subtract(
            sunState.velocity || { x: 0, y: 0, z: 0 },
            earthState.velocity || { x: 0, y: 0, z: 0 },
          )
          : null;
        const stageMassKg = Math.max(
          1,
          Number(shipState?.massKg) || 1,
        );
        const engineAccelAtThrottle1KmS2 = (
          Number(activeStage?.thrustVacuumN) > 0
          && stageMassKg > 0
        )
          ? ((Number(activeStage.thrustVacuumN) / stageMassKg) / 1000)
          : null;
        const moonRefuelTarget = vehicle.missionPhase === "orbital_refuel"
          ? selectLockedTankerTargetForVehicle(vehicle, state, shipState, earthState)
          : null;
        const moonRefuelTargetId = String(moonRefuelTarget?.tankerId || "").trim();
        const moonRefuelTankerState = moonRefuelTargetId
          ? (state?.dynamicBodies?.get?.(moonRefuelTargetId) || null)
          : null;
        if (moonRefuelTarget && moonRefuelTarget.relativePositionKm) {
          decisionTargetBodyId = String(moonRefuelTarget.tankerId || "refuel_tanker");
          decisionTargetBodyName = "Refuel Tanker";
        }
        const navPhase = moonNavPhaseForFleetPhase(vehicle.missionPhase);
        if (navPhase) {
          const plannerRuntime = ensureVehiclePlannerRuntime(vehicle);
          syncPlannerRuntime({
            plannerRuntime,
            missionId: NAVIGATION_MISSION_IDS.MOON_ORBIT_RETURN,
            missionPhase: navPhase,
          });
          const plannerCommand = planMoonMissionCommand({
            phase: navPhase,
            targetVectors: {
              tangent: prograde,
              up,
              toMoon: toMoonVectorKm || prograde,
              toEarth: scale(relPos, -1),
              shipEarthPositionKm: relPos,
              shipEarthVelocityKmS: relVel,
              moonEarthPositionKm: finiteVector(moonState?.position)
                ? subtract(moonState.position, earthState.position)
                : null,
              moonEarthVelocityKmS: finiteVector(moonState?.velocity || { x: 0, y: 0, z: 0 })
                ? subtract(
                  moonState.velocity || { x: 0, y: 0, z: 0 },
                  earthState.velocity || { x: 0, y: 0, z: 0 },
                )
                : null,
              sunEarthPositionKm,
              sunEarthVelocityKmS,
              shipMinusMoonRelativeVelocityKmS: moonRelVel || null,
              moonMinusShipRelativeVelocityKmS,
              toRefuelTarget: moonRefuelTarget?.relativePositionKm || null,
              refuelTargetRelativeVelocityKmS: moonRefuelTarget?.relativeVelocityKmS || null,
              departurePlanBurnDirectionKm: vehicle.moonDeparturePlanDirectionKm || null,
              departureSeedPositionKm: vehicle.moonDepartureSeedPositionKm || null,
              departureSeedVelocityKmS: vehicle.moonDepartureSeedVelocityKmS || null,
            },
            metrics: {
              apoapsisKm: Number(orbital?.apoapsisKm),
              periapsisKm: Number(orbital?.periapsisKm),
              timeToApoapsisSec: Number(orbital?.timeToApoapsisSec),
              timeToPeriapsisSec: Number(orbital?.timeToPeriapsisSec),
              orbitalPeriodSec: Number(orbital?.orbitalPeriodSec),
              earthDistanceKm,
              earthRadialSpeedKmS,
              moonDistanceKm,
              moonAltitudeKm,
              moonClosingSpeedKmS,
              moonRelativeSpeedKmS,
              moonCircularSpeedKmS,
              moonProjectedMissDistanceKm: rawMoonProjectedMissDistanceKm,
              moonProjectedMissTrendKmS,
              moonProjectedPeriluneAltitudeKm: vehicle.moonProjectedPeriluneAltitudeKm,
              moonBPlaneErrorKm: vehicle.moonBPlaneErrorKm,
              departurePlanReady: Boolean(vehicle.moonDeparturePlanReady),
              departurePlanThrottle: Number(vehicle.moonDeparturePlanThrottle),
              departurePlanBurnDurationSec: Number(vehicle.moonDeparturePlanBurnDurationSec),
              departurePlanCommitWindowSec: Number(vehicle.moonDeparturePlanCommitWindowSec),
              departurePlanPredictedMissDistanceKm: Number(vehicle.moonDeparturePlanPredictedMissDistanceKm),
              departurePlanPredictedPeriluneAltitudeKm: Number(vehicle.moonDeparturePlanPredictedPeriluneAltitudeKm),
              departurePlanBPlaneErrorKm: Number(vehicle.moonDeparturePlanBPlaneErrorKm),
              departurePlanGeometryScore: Number(vehicle.moonDepartureGeometryScore),
              departurePlanAlignNow: Number(vehicle.moonDepartureAlignNow),
              stageMassKg,
              engineAccelAtThrottle1KmS2,
              bodyId: String(vehicle.id || "fleet_launch_vehicle"),
              missionPhaseElapsedSec: Number(vehicle.phaseElapsedSec) || 0,
              refuelFillFraction: 0,
              refuelTargetDistanceKm: Number(moonRefuelTarget?.distanceKm),
              refuelRelativeSpeedKmS: Number(moonRefuelTarget?.relativeSpeedKmS),
              refuelClosingSpeedKmS: Number(moonRefuelTarget?.closingSpeedKmS),
            },
            plannerConfig: NAVIGATION_DEFAULTS.planner,
            plannerRuntime,
            timestampSec: (Number(vehicle.elapsedSeconds) || 0) + safeDtSeconds,
          });
          requestedThrottle = plannerCommand?.phase === "powered"
            ? clamp(Number(plannerCommand?.throttle) || 0, 0, 1)
            : 0;
          desiredDirection = normalize(plannerCommand?.direction || toMoonVectorKm || prograde, prograde);
          guidanceMode = String(plannerCommand?.mode || "navsys:coast-to-moon");
          vehicle.moonProjectedPeriluneAltitudeKm = finiteOrNull(
            plannerRuntime?.moon?.approach?.projectedPeriluneAltitudeKm,
          );
          vehicle.moonBPlaneErrorKm = finiteOrNull(plannerRuntime?.moon?.approach?.bPlaneErrorKm);
          if (navPhase === NAVIGATION_MISSION_PHASES.TLI_BURN) {
            const tliDiag = plannerCommand?.diagnostics && typeof plannerCommand.diagnostics === "object"
              ? plannerCommand.diagnostics
              : null;
            vehicle.moonTliTargetMode = String(tliDiag?.requestedMode || "");
            vehicle.moonTliTargetMissKm = finiteOrNull(tliDiag?.missDistanceKm);
            vehicle.moonTliTargetMissGateKm = finiteOrNull(tliDiag?.missGateKm);
            vehicle.moonTliTargetBPlaneKm = finiteOrNull(tliDiag?.bPlaneErrorKm);
            vehicle.moonTliTargetPeriluneKm = finiteOrNull(tliDiag?.periluneEstimateKm);
          } else {
            vehicle.moonTliTargetMode = "";
            vehicle.moonTliTargetMissKm = null;
            vehicle.moonTliTargetMissGateKm = null;
            vehicle.moonTliTargetBPlaneKm = null;
            vehicle.moonTliTargetPeriluneKm = null;
          }
        } else {
          requestedThrottle = 0;
          desiredDirection = toMoonVectorKm ? normalize(toMoonVectorKm, prograde) : prograde;
          guidanceMode = "navsys:coast-to-moon";
          vehicle.moonProjectedPeriluneAltitudeKm = null;
          vehicle.moonBPlaneErrorKm = null;
          vehicle.moonProjectedMissTrendKmS = null;
          vehicle.moonPrevProjectedMissDistanceKm = null;
          vehicle.moonTliTargetMode = "";
          vehicle.moonTliTargetMissKm = null;
          vehicle.moonTliTargetMissGateKm = null;
          vehicle.moonTliTargetBPlaneKm = null;
          vehicle.moonTliTargetPeriluneKm = null;
        }
        if (vehicle.missionPhase === "orbital_refuel") {
          const moonRefuelDirection = normalize(
            moonRefuelTarget?.relativePositionKm || prograde,
            prograde,
          );
          const moonRefuelTransferDecision = updateFleetTransferGuidance({
            vehicle,
            target: moonRefuelTarget,
            shipState,
            tankerState: moonRefuelTankerState,
            earthState,
            orbitalState: orbital,
            prograde,
            requestedThrottle: 0,
            desiredDirection: moonRefuelDirection,
            guidanceMode: "navsys:orbital-refuel-await-target",
            safeDtSeconds,
            nowSec: Number(vehicle.elapsedSeconds) || 0,
            targetFillFraction: FLEET_MOON_REFUEL_TARGET_FILL_FRACTION,
            stagePropellantKg: availablePropellantKg,
            stageCapacityKg: Math.max(0, Number(activeStage?.propellantMassKg) || 0),
            emitLaunchEvent,
          });
          requestedThrottle = clamp(Number(moonRefuelTransferDecision?.requestedThrottle) || 0, 0, 1);
          desiredDirection = normalize(moonRefuelTransferDecision?.desiredDirection || desiredDirection, prograde);
          guidanceMode = String(moonRefuelTransferDecision?.guidanceMode || guidanceMode);
          if (moonRefuelTransferDecision?.lockTarget && moonRefuelTargetId) {
            vehicle.refuelTargetLockId = moonRefuelTargetId;
            if (!(Number(vehicle.refuelTargetLockAcquiredSec) > 0)) {
              vehicle.refuelTargetLockAcquiredSec = Math.max(0, Number(vehicle.elapsedSeconds) || 0);
            }
          }
          const moonRefuelRcsAssist = computeRefuelCloseRcsAssist({
            guidanceMode,
            distanceKm: Number(moonRefuelTarget?.distanceKm),
            relativePositionKm: moonRefuelTarget?.relativePositionKm || null,
            relativeVelocityKmS: moonRefuelTarget?.relativeVelocityKmS || null,
            prograde,
            up,
          });
          if (moonRefuelRcsAssist) {
            rcsAssistAccelKmS2 = moonRefuelRcsAssist.accelKmS2;
            rcsAssistAuthority = moonRefuelRcsAssist.authority;
            rcsAssistJets = moonRefuelRcsAssist.jets;
            rcsAssistMode = moonRefuelRcsAssist.mode;
          }
        }
      }
      let survivalRecoveryActiveThisStep = false;
      if (
        vehicle.vehicleRole !== "tanker"
        && vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
        && (
          vehicle.missionPhase !== "tli_burn"
          || Boolean(vehicle.moonSurvivalRecoveryActive)
        )
      ) {
        const survivalRecovery = computeMoonSurvivalRecoveryOverride({
          missionPhase: vehicle.missionPhase,
          periapsisKm: Number(orbital?.periapsisKm),
          altitudeKm: Number(orbital?.altitudeKm),
          radialSpeedKmS: Number(orbital?.radialSpeedKmS),
          prograde,
          up,
          availablePropellantKg,
          recoveryWasActive: Boolean(vehicle.moonSurvivalRecoveryActive),
        });
        if (survivalRecovery) {
          requestedThrottle = clamp(Number(survivalRecovery.throttle) || 0, 0, 1);
          desiredDirection = normalize(survivalRecovery.direction || prograde, prograde);
          guidanceMode = String(survivalRecovery.mode || "navsys:moon-survival-periapsis-recovery");
          vehicle.moonGoNoGoReason = String(survivalRecovery.gateReason || "");
          survivalRecoveryActiveThisStep = true;
        }
      }

      const stageIspVacuumEstimateS = Math.max(1, Number(activeStage?.ispVacuumS) || 360);
      let missionFuelBudget = null;
      if (vehicle.vehicleRole !== "tanker" && vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
        missionFuelBudget = estimateMoonRoundTripFuelBudget({
          missionPhase: vehicle.missionPhase,
          shipState,
          earthState,
          moonState,
          earthRadiusKm,
          moonRadiusKm,
          earthMuKm3S2,
          moonMuKm3S2,
          stageIspVacuumS: stageIspVacuumEstimateS,
          stagePropellantKg: availablePropellantKg,
        });
      } else if (
        vehicle.vehicleRole !== "tanker"
        && vehicle.missionId === LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO
      ) {
        missionFuelBudget = estimateOrbitalRefuelDemoFuelBudget({
          missionPhase: vehicle.missionPhase,
          shipState,
          earthState,
          earthRadiusKm,
          stageIspVacuumS: stageIspVacuumEstimateS,
          stagePropellantKg: availablePropellantKg,
          target: orbitalRefuelTarget,
        });
      }
      vehicle.fuelBudget = missionFuelBudget;

      if (
        vehicle.vehicleRole !== "tanker"
        && vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
        && missionFuelBudget
      ) {
        const budgetFeasible = Boolean(missionFuelBudget.feasible);
        const budgetMarginKg = Number(missionFuelBudget.marginKg);
        const moonBurnPhase = (
          vehicle.missionPhase === "tli_burn"
          || vehicle.missionPhase === "coast_to_moon"
          || vehicle.missionPhase === "lunar_capture"
        );
        if (moonBurnPhase && !budgetFeasible && availablePropellantKg > 1e-6) {
          const survivalRecovery = computeMoonSurvivalRecoveryOverride({
            missionPhase: vehicle.missionPhase,
            periapsisKm: Number(orbital?.periapsisKm),
            altitudeKm: Number(orbital?.altitudeKm),
            radialSpeedKmS: Number(orbital?.radialSpeedKmS),
            prograde,
            up,
            availablePropellantKg,
            reasonPrefix: "Fuel budget hold overridden by survival recovery.",
          });
          if (survivalRecovery) {
            requestedThrottle = clamp(Number(survivalRecovery.throttle) || 0, 0, 1);
            desiredDirection = normalize(survivalRecovery.direction || prograde, prograde);
            guidanceMode = String(survivalRecovery.mode || "navsys:moon-survival-periapsis-recovery");
            vehicle.moonGoNoGoReason = String(survivalRecovery.gateReason || "");
          } else {
            requestedThrottle = 0;
            desiredDirection = prograde;
            guidanceMode = "autopilot-moon-fuel-budget-hold";
          }
        } else if (moonBurnPhase && Number.isFinite(budgetMarginKg) && budgetMarginKg < FLEET_MOON_MISSION_MARGIN_CONSERVE_KG) {
          const conserveCap = budgetMarginKg < FLEET_MOON_MISSION_MARGIN_CRITICAL_KG
            ? 0.16
            : 0.24;
          requestedThrottle = Math.min(requestedThrottle, conserveCap);
          if (
            requestedThrottle > 1e-3
            && (guidanceMode.startsWith("autopilot-") || guidanceMode.startsWith("navsys:"))
          ) {
            guidanceMode = `${guidanceMode}:fuel-conserve`;
          }
        }
      }
      if (
        vehicle.vehicleRole !== "tanker"
        && vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
      ) {
        const moonDepartureGateSource = chooseMoonDepartureDiagnosticsSource(vehicle);
        const moonGoNoGo = evaluateMoonTliGoNoGo({
          missionId: vehicle.missionId,
          missionPhase: vehicle.missionPhase,
          commandPhase: requestedThrottle > 1e-4 ? "powered" : "coast",
          requestedThrottle,
          periapsisKm: Number(orbital?.periapsisKm),
          altitudeKm: Number(orbital?.altitudeKm),
          propellantKg: availablePropellantKg,
          fuelBudget: missionFuelBudget,
          missionElapsedInPhaseSec: Number(vehicle.phaseElapsedSec) || 0,
          moonDepartureWindowReady: vehicle.moonPadWindowStatus
            ? Boolean(vehicle.moonPadWindowStatus.ready)
            : Boolean(moonDepartureGateSource?.ready ?? vehicle.moonDepartureWindowReady),
          moonDepartureWindowWaitSec: vehicle.moonDepartureWindowWaitSec,
          departurePredictedMissDistanceKm: moonDepartureGateSource
            ? Number(moonDepartureGateSource.predictedMissDistanceKm)
            : Number(vehicle.moonTliTargetMissKm),
          departurePredictedPeriluneAltitudeKm: moonDepartureGateSource
            ? Number(moonDepartureGateSource.predictedPeriluneAltitudeKm)
            : Number(vehicle.moonTliTargetPeriluneKm),
          departureBPlaneErrorKm: moonDepartureGateSource
            ? Number(moonDepartureGateSource.bPlaneErrorKm)
            : Number(vehicle.moonTliTargetBPlaneKm),
          plannerConfig: NAVIGATION_DEFAULTS.planner,
          minPeriapsisKm: FLEET_TLI_PERIAPSIS_PROTECT_MIN_KM,
          minAltitudeKm: FLEET_TLI_GO_NOGO_MIN_ALTITUDE_KM,
          minPropellantKg: 1,
        });
        if (moonGoNoGo.applies) {
          vehicle.moonGoNoGoStatus = moonGoNoGo.status;
          vehicle.moonGoNoGoReason = moonGoNoGo.reason;
          if (!moonGoNoGo.go) {
            const failures = Array.isArray(moonGoNoGo.failures) ? moonGoNoGo.failures : [];
            const periapsisFailure = failures.includes("periapsis-safe");
          const survivalRecovery = periapsisFailure
              ? computeMoonSurvivalRecoveryOverride({
                missionPhase: vehicle.missionPhase,
                periapsisKm: moonGoNoGo?.diagnostics?.periapsisKm,
                altitudeKm: moonGoNoGo?.diagnostics?.altitudeKm,
                radialSpeedKmS: Number(orbital?.radialSpeedKmS),
                prograde,
                up,
                availablePropellantKg,
                recoveryWasActive: Boolean(vehicle.moonSurvivalRecoveryActive) || survivalRecoveryActiveThisStep,
                reasonPrefix: moonGoNoGo.reason,
              })
              : null;
            if (survivalRecovery) {
              requestedThrottle = clamp(Number(survivalRecovery.throttle) || 0, 0, 1);
              desiredDirection = normalize(survivalRecovery.direction || prograde, prograde);
              guidanceMode = String(survivalRecovery.mode || "navsys:moon-survival-periapsis-recovery");
              vehicle.moonGoNoGoReason = String(survivalRecovery.gateReason || moonGoNoGo.reason);
              survivalRecoveryActiveThisStep = true;
            } else {
              requestedThrottle = 0;
              guidanceMode = guidanceMode.includes("go-no-go-hold")
                ? guidanceMode
                : `${guidanceMode}:go-no-go-hold`;
            }
          }
        } else {
          vehicle.moonGoNoGoStatus = "n/a";
          vehicle.moonGoNoGoReason = "";
        }
      } else {
        vehicle.moonGoNoGoStatus = "n/a";
        vehicle.moonGoNoGoReason = "";
      }
      vehicle.moonSurvivalRecoveryActive = survivalRecoveryActiveThisStep;

      if (
        vehicle.vehicleRole !== "tanker"
        && vehicle.missionId === LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO
        && vehicle.missionPhase === "orbital_refuel"
        && missionFuelBudget
      ) {
        const budgetFeasible = Boolean(missionFuelBudget.feasible);
        const budgetMarginKg = Number(missionFuelBudget.marginKg);
        if (
          !budgetFeasible
          && availablePropellantKg > 1e-6
          && Number.isFinite(budgetMarginKg)
          && budgetMarginKg <= FLEET_ORBITAL_REFUEL_DEMO_MARGIN_HARD_HOLD_KG
        ) {
          requestedThrottle = 0;
          desiredDirection = prograde;
          guidanceMode = "navsys:orbital-refuel-budget-hold";
        } else if (Number.isFinite(budgetMarginKg) && budgetMarginKg < FLEET_ORBITAL_REFUEL_DEMO_MARGIN_CONSERVE_KG) {
          const preserveThrottleCap = budgetMarginKg < FLEET_ORBITAL_REFUEL_DEMO_MARGIN_SOFT_DEFICIT_KG
            ? 0.1
            : 0.18;
          requestedThrottle = Math.min(requestedThrottle, preserveThrottleCap);
          if (requestedThrottle > 1e-3 && guidanceMode.startsWith("navsys:orbital-refuel")) {
            guidanceMode = budgetMarginKg < 0
              ? `${guidanceMode}:budget-soft-deficit`
              : `${guidanceMode}:fuel-conserve`;
          }
        }
      }

      if (availablePropellantKg <= 1e-6) {
        requestedThrottle = 0;
      }
      if (
        requestedThrottle > 1e-6
        && vehicle.vehicleRole !== "tanker"
        && vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
      ) {
        const earthAvoidance = enforceMoonEarthAvoidanceDirection({
          missionPhase: String(vehicle.missionPhase || ""),
          commandPhase: "powered",
          direction: desiredDirection,
          tangent: prograde,
          up,
          previousApplied: Boolean(vehicle.moonEarthGuardActive),
          toMoonVectorKm: finiteVector(moonState?.position)
            ? subtract(moonState.position, shipState.position)
            : null,
          earthDistanceKm: length(relPos),
          earthRadiusKm,
          periapsisKm: Number(orbital?.periapsisKm),
        });
        vehicle.moonEarthGuardActive = earthAvoidance.applied;
        if (earthAvoidance.applied) {
          desiredDirection = earthAvoidance.direction;
          guidanceMode = guidanceMode.includes("earth-occlusion-guard")
            || guidanceMode.includes("periapsis-protect-guard")
            || guidanceMode.includes("low-earth-clearance-guard")
            ? guidanceMode
            : `${guidanceMode}:${earthAvoidance.reason}`;
        }
      }
      const bodyKind = stageBodyKindFromStageIndex(activeStageIndex);
      const relAirVelocityKmS = atmosphereRelativeVelocityKmS(
        relPos,
        relVel,
        earthPole,
        windSample.vectorKmS,
      );
      const qAlphaActive = (
        Number.isFinite(altitudeKm)
        && altitudeKm <= FLEET_QALPHA_ACTIVE_MAX_ALTITUDE_KM
        && Number(dynamicPressurePa) >= FLEET_QALPHA_ACTIVE_MIN_DYNAMIC_PRESSURE_PA
      );
      const qAlphaSteering = qAlphaActive
        ? applyQAlphaSteeringLimit({
          desiredDirection,
          relAirVelocityKmS,
          dynamicPressurePa,
          bodyKind,
        })
        : {
          direction: normalize(desiredDirection, { x: 0, y: 0, z: 1 }),
          limited: false,
          qAlphaPaRad: 0,
        };
      desiredDirection = qAlphaSteering.direction;
      if (qAlphaActive) {
        requestedThrottle = limitThrottleByQAlpha({
          throttle: requestedThrottle,
          qAlphaPaRad: qAlphaSteering.qAlphaPaRad,
          bodyKind,
        });
      }
      if (
        qAlphaActive
        && qAlphaSteering.limited
        && requestedThrottle > 1e-3
        && !guidanceMode.includes("qalpha-limit")
      ) {
        guidanceMode = `${guidanceMode}+qalpha-limit`;
      }
      const requestedThrottleCommand = clamp(Number(requestedThrottle) || 0, 0, 1);
      const guidanceBurnRequested = requestedThrottleCommand > 1e-3;
      const guidanceInertNoPropellant = guidanceBurnRequested && availablePropellantKg <= 1e-6;
      vehicle.guidanceBurnRequested = guidanceBurnRequested;
      vehicle.guidanceRequestedThrottle = requestedThrottleCommand;
      vehicle.guidanceInertNoPropellant = guidanceInertNoPropellant;
      vehicle.guidanceInertReason = guidanceInertNoPropellant
        ? "no-propellant-for-guidance-burn"
        : "";
      let throttleCommand = availablePropellantKg > 1e-6
        ? requestedThrottleCommand
        : 0;
      const moonAttitudeGateEligible = (
        availablePropellantKg > 1e-6
        && requestedThrottleCommand > 1e-3
        && vehicle.vehicleRole !== "tanker"
        && vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
        && FLEET_MOON_BURN_ATTITUDE_GATE_PHASES.has(String(vehicle.missionPhase || ""))
        && !survivalRecoveryActiveThisStep
      );
      const moonAttitudeGate = evaluateMoonBurnAttitudeGate({
        gateEligible: moonAttitudeGateEligible,
        gateWasActive: !survivalRecoveryActiveThisStep && Boolean(vehicle.moonBurnAttitudeGateActive),
        currentAxis: vehicle.stageActuator?.directionActual || desiredDirection,
        desiredDirection,
        latchedDirection: survivalRecoveryActiveThisStep ? null : vehicle.moonBurnAttitudeGateDirection,
        alignStableSec: survivalRecoveryActiveThisStep ? 0 : vehicle.moonBurnAttitudeGateAlignSec,
        dtSeconds: safeDtSeconds,
        enterErrorDeg: MOON_BURN_ATTITUDE_GATE_ENTER_ERROR_DEG,
        exitErrorDeg: MOON_BURN_ATTITUDE_GATE_EXIT_ERROR_DEG,
      });
      desiredDirection = moonAttitudeGate.requestedDirection;
      if (moonAttitudeGate.throttleSuppressed && availablePropellantKg > 1e-6) {
        throttleCommand = 0;
      }
      vehicle.moonBurnAttitudeGateActive = moonAttitudeGate.gateActive;
      vehicle.moonBurnAttitudeGateDirection = moonAttitudeGate.latchedDirection;
      vehicle.moonBurnAttitudeGateAlignSec = moonAttitudeGate.alignStableSec;
      vehicle.stageActuator = applyActuatorModel(
        vehicle.stageActuator,
        {
          requestedThrottle: throttleCommand,
          requestedDirection: desiredDirection,
          dtSeconds: safeDtSeconds,
          config: LAUNCH_REALISM_CONFIG.actuator.stage,
          massModel: vehicle.stageMassModel,
        },
      );
      const throttleActual = availablePropellantKg > 1e-6
        ? clamp(Number(vehicle.stageActuator?.throttleActual) || 0, 0, 1)
        : 0;
      const bodyAxisDirection = normalize(
        vehicle.stageActuator?.directionActual || desiredDirection,
        desiredDirection,
      );
      if (moonAttitudeGate.gateActive && !guidanceMode.includes("attitude-align")) {
        guidanceMode = `${guidanceMode}+attitude-align`;
      }
      const ambientPressurePa = Number(atmosphereSample?.pressurePa) || 0;
      const stageThrustVacuumN = Math.max(0, Number(activeStage?.thrustVacuumN) || 0);
      const stageThrustSeaLevelN = Math.max(0, Number(activeStage?.thrustSeaLevelN) || stageThrustVacuumN);
      const thrustPerThrottleN = interpolateSeaToVac(
        stageThrustVacuumN,
        stageThrustSeaLevelN,
        ambientPressurePa,
      );
      const thrustN = throttleActual > 1e-6
        ? thrustPerThrottleN * throttleActual
        : 0;
      const stageIspVacuumS = Math.max(1, Number(activeStage?.ispVacuumS) || 360);
      const stageIspSeaLevelS = Math.max(1, Number(activeStage?.ispSeaLevelS) || stageIspVacuumS);
      const ispS = Math.max(
        1,
        interpolateSeaToVac(stageIspVacuumS, stageIspSeaLevelS, ambientPressurePa),
      );
      const burnRateKgS = thrustN > 0
        ? thrustN / (ispS * STANDARD_GRAVITY_M_S2)
        : 0;
      const burnKg = Math.min(availablePropellantKg, burnRateKgS * safeDtSeconds);
      const effectiveMassKg = Math.max(
        minRocketMassKg,
        (Number(shipState.massKg) || minRocketMassKg) - (0.5 * burnKg),
      );
      const accelerationMagnitudeKmS2 = thrustN > 0
        ? (thrustN / effectiveMassKg) / 1000
        : 0;
      const thrustAccelKmS2 = scale(bodyAxisDirection, accelerationMagnitudeKmS2);
      const referenceAreaM2 = Math.max(
        1,
        Number(LAUNCH_VEHICLE_CONFIG?.referenceAreaM2)
          || (
            Math.PI
            * Math.pow(
              Math.max(1, Number(STARSHIP_STACK_DIMENSIONS_KM?.diameterKm) || 9) * 500,
              2,
            )
          ),
      );
      const aero = computeAerodynamicResponse({
        bodyKind,
        atmosphereSample,
        relPos,
        relVel,
        earthPole,
        windVectorKmS: windSample.vectorKmS,
        bodyAxisDirection,
        referenceAreaM2,
        massKg: effectiveMassKg,
        minMassKg: minRocketMassKg,
      });
      const totalAccelKmS2 = add(add(thrustAccelKmS2, aero.accelerationKmS2), rcsAssistAccelKmS2);
      vehicle.pendingBurnKg = burnKg;
      vehicle.guidanceMode = guidanceMode;
      vehicle.decisionTargetBodyId = decisionTargetBodyId;
      vehicle.decisionTargetBodyName = decisionTargetBodyName;
      vehicle.lastStep = {
        accelerationKmS2: totalAccelKmS2,
        throttle: throttleActual,
        throttleCommand: requestedThrottleCommand,
        thrustN,
        burnRateKgS,
        burnKg,
        guidanceMode,
        guidanceBurnRequested,
        guidanceRequestedThrottle: requestedThrottleCommand,
        guidanceInertNoPropellant,
        guidanceInertReason: vehicle.guidanceInertReason,
        rcsActive: rcsAssistAuthority > 1e-4,
        rcsMode: rcsAssistMode,
        rcsAuthority: rcsAssistAuthority,
        rcsJets: rcsAssistJets,
        rcsAccelKmS2: length(rcsAssistAccelKmS2),
        dynamicPressurePa: aero.dynamicPressurePa,
        angleOfAttackDeg: aero.angleOfAttackDeg,
        qAlphaPaRad: aero.qAlphaPaRad,
        machNumber: aero.machNumber,
        dragCoefficient: aero.dragCoefficient,
        liftCoefficient: aero.liftCoefficient,
        gimbalErrorDeg: Number(vehicle.stageActuator?.gimbalErrorDeg) || 0,
        comNormalized: Number(vehicle.stageMassModel?.comNormalized) || 0,
        inertiaNormalized: Number(vehicle.stageMassModel?.inertiaNormalized) || 1,
        controlAuthorityScale: Number(vehicle.stageMassModel?.controlAuthorityScale) || 1,
        windSpeedKmS: windSample.speedKmS,
        windEastMS: windSample.eastMS,
        windNorthMS: windSample.northMS,
        stageIndex: activeStageIndex,
        stageName: activeStage?.name || `Stage ${activeStageIndex + 1}`,
      };
      emitFleetDecisionEvents(
        vehicle,
        previousDecision,
        {
          guidanceMode,
          targetBodyId: decisionTargetBodyId,
          targetBodyName: decisionTargetBodyName,
          burnActive: throttleActual > 1e-3 && thrustN > 1,
        },
      );
    }
    for (let i = 0; i < removeIds.length; i += 1) {
      vehicles.delete(removeIds[i]);
    }
  }

  function finalizeStep(state, dtSeconds, nowMs = Date.now()) {
    if (!hasActiveVehicles()) {
      return;
    }
    const earthState = bodyStateFromNBody(state, "earth");
    if (
      !earthState
      || !finiteVector(earthState.position)
      || !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      return;
    }
    const moonState = bodyStateFromNBody(state, "moon");
    const moonMassKg = Number(getBodyMassKg?.("moon")) || Number(moonState?.massKg) || 7.342e22;
    const moonRadiusKm = Number(getBodyRadiusKm?.("moon")) || 1737.4;
    const moonMuKm3S2 = Number(gravitationalConstantKm3PerKgS2) * moonMassKg;
    const removeIds = [];
    const safeDtSeconds = Math.max(0, Number(dtSeconds) || 0);
    const vehicles = fleetVehicles();

    for (const [shipId, vehicle] of vehicles.entries()) {
      const shipState = state?.dynamicBodies?.get?.(shipId);
      if (
        !shipState
        || !finiteVector(shipState.position)
        || !finiteVector(shipState.velocity || { x: 0, y: 0, z: 0 })
      ) {
        removeIds.push(shipId);
        continue;
      }
      const stageProfiles = Array.isArray(vehicle.stageProfiles) && vehicle.stageProfiles.length >= 2
        ? vehicle.stageProfiles
        : [
          {
            name: "Stage 1",
            dryMassKg: 200_000,
            propellantMassKg: 3_400_000,
          },
          {
            name: "Stage 2",
            dryMassKg: 120_000,
            propellantMassKg: 1_200_000,
          },
        ];
      const stageCount = stageProfiles.length;
      let stageIndex = Math.max(0, Math.min(stageCount - 1, Number(vehicle.stageIndex) || 0));
      const activeStage = stageProfiles[stageIndex] || stageProfiles[stageCount - 1];
      if (!Number.isFinite(Number(vehicle.stagePropellantKg))) {
        vehicle.stagePropellantKg = Math.max(
          0,
          Number(activeStage?.propellantMassKg) || Number(vehicle.propellantKg) || 0,
        );
      }
      const burnKg = Math.max(0, Number(vehicle.pendingBurnKg) || Number(vehicle.lastStep?.burnKg) || 0);
      if (burnKg > 0) {
        shipState.massKg = Math.max(
          Math.max(minRocketMassKg, Number(vehicle.dryMassKg) || minRocketMassKg),
          (Number(shipState.massKg) || minRocketMassKg) - burnKg,
        );
        vehicle.propellantKg = Math.max(0, (Number(vehicle.propellantKg) || 0) - burnKg);
        vehicle.stagePropellantKg = Math.max(0, (Number(vehicle.stagePropellantKg) || 0) - burnKg);
      }
      vehicle.pendingBurnKg = 0;
      vehicle.elapsedSeconds = Math.max(0, Number(vehicle.elapsedSeconds) || 0) + safeDtSeconds;
      vehicle.phaseElapsedSec = Math.max(0, Number(vehicle.phaseElapsedSec) || 0) + safeDtSeconds;

      const stageDepleted = (Number(vehicle.stagePropellantKg) || 0) <= 1e-3;
      if (stageDepleted && stageIndex < (stageCount - 1)) {
        const droppedDryMassKg = Math.max(0, Number(activeStage?.dryMassKg) || 0);
        shipState.massKg = Math.max(minRocketMassKg, (Number(shipState.massKg) || minRocketMassKg) - droppedDryMassKg);
        vehicle.dryMassKg = Math.max(
          minRocketMassKg,
          (Number(vehicle.dryMassKg) || minRocketMassKg) - droppedDryMassKg,
        );
        stageIndex += 1;
        vehicle.stageIndex = stageIndex;
        const nextStage = stageProfiles[stageIndex] || stageProfiles[stageCount - 1];
        vehicle.stagePropellantKg = Math.max(0, Number(nextStage?.propellantMassKg) || 0);
        const relPosForActuator = subtract(shipState.position, earthState.position);
        const relVelForActuator = subtract(
          shipState.velocity || { x: 0, y: 0, z: 0 },
          earthState.velocity || { x: 0, y: 0, z: 0 },
        );
        const upForActuator = normalize(relPosForActuator, { x: 0, y: 0, z: 1 });
        vehicle.stageActuator = createActuatorState(normalize(relVelForActuator, upForActuator));
        vehicle.stageMassModel = createMassModelState();
        vehicle.moonBurnAttitudeGateActive = false;
        vehicle.moonBurnAttitudeGateDirection = null;
        vehicle.moonBurnAttitudeGateAlignSec = 0;
        if (typeof emitLaunchEvent === "function") {
          emitLaunchEvent("fleet_mission_stage_changed", {
            shipId: vehicle.id,
            missionId: vehicle.missionId,
            stageIndex,
            stageName: nextStage?.name || `Stage ${stageIndex + 1}`,
          });
        }
      }

      if (vehicle.missionPhase === "launch_to_parking" && stageIndex <= 0) {
        const contactAxes = typeof earthAxes === "function"
          ? (earthAxes(nowMs) || { xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, pole: { x: 0, y: 0, z: 1 } })
          : { xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, pole: { x: 0, y: 0, z: 1 } };
        applyEarthSurfaceContactForVehicle({
          rocketState: shipState,
          earthState,
          earthAxes: contactAxes,
          earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
          earthSiderealRateRadS: EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
          referenceOffsetKm: STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM,
          dtSeconds: safeDtSeconds,
          thrustN: Number(vehicle.lastStep?.thrustN) || 0,
        });
      }

      const earthRelPos = subtract(shipState.position, earthState.position);
      const earthRelVel = subtract(
        shipState.velocity || { x: 0, y: 0, z: 0 },
        earthState.velocity || { x: 0, y: 0, z: 0 },
      );
      const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
      const earthMuKm3S2 = Number(gravitationalConstantKm3PerKgS2)
        * (Number(getEarthMassKg?.()) || Number(earthState.massKg) || 0);
      const earthOrbit = earthMuKm3S2 > 0
        ? orbitalStateFromRelative(earthMuKm3S2, earthRadiusKm, earthRelPos, earthRelVel)
        : null;
      const targetApoapsisKm = Math.max(160, Number(vehicle.targetOrbitApoapsisKm) || 240);
      const targetPeriapsisKm = Math.max(120, Number(vehicle.targetOrbitPeriapsisKm) || 200);
      const parkingReady = Number(earthOrbit?.specificEnergy) < 0
        && Number(earthOrbit?.apoapsisKm) >= targetApoapsisKm
        && Number(earthOrbit?.periapsisKm) >= targetPeriapsisKm;
      if (vehicle.missionPhase === "launch_to_parking" && parkingReady) {
        if (vehicle.vehicleRole === "tanker") {
          setFleetMissionPhase(vehicle, "orbital_hold", {
            orbitApoapsisKm: Number(earthOrbit?.apoapsisKm),
            orbitPeriapsisKm: Number(earthOrbit?.periapsisKm),
          });
        } else if (vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
          vehicle.moonDepartureSeedPositionKm = cloneFiniteVector(earthRelPos);
          vehicle.moonDepartureSeedVelocityKmS = cloneFiniteVector(earthRelVel);
          setFleetMissionPhase(vehicle, "tli_burn", {
            orbitApoapsisKm: Number(earthOrbit?.apoapsisKm),
            orbitPeriapsisKm: Number(earthOrbit?.periapsisKm),
          });
        } else {
          setFleetMissionPhase(vehicle, "earth_orbit_hold", {
            orbitApoapsisKm: Number(earthOrbit?.apoapsisKm),
            orbitPeriapsisKm: Number(earthOrbit?.periapsisKm),
          });
        }
      }
      if (vehicle.vehicleRole !== "tanker" && vehicle.missionPhase === "orbital_refuel") {
        const transferTargetId = String(vehicle?.refuelTransferState?.targetTankerId || "").trim();
        const transferTankerVehicle = transferTargetId ? (vehicles.get(transferTargetId) || null) : null;
        const transferTankerState = transferTargetId
          ? (state?.dynamicBodies?.get?.(transferTargetId) || null)
          : null;
        const targetFillFraction = vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
          ? FLEET_MOON_REFUEL_TARGET_FILL_FRACTION
          : (Number(REFUEL_TANKER_CONFIG.targetFillFraction) || 0.88);
        const transferStep = advanceFleetTransferMass({
          vehicle,
          shipState,
          tankerVehicle: transferTankerVehicle,
          tankerState: transferTankerState,
          safeDtSeconds,
          targetFillFraction,
          emitLaunchEvent,
        });
        const stageCapacityKg = Math.max(0, Number(stageProfiles[stageIndex]?.propellantMassKg) || 0);
        const stageFillFraction = stageCapacityKg > 1e-6
          ? clamp((Number(vehicle.stagePropellantKg) || 0) / stageCapacityKg, 0, 1)
          : 0;
        const transferTransferredKg = Math.max(
          0,
          Number(vehicle?.refuelTransferState?.transferTransferredKg) || 0,
        );
        const completionTransferSatisfied = vehicle.missionId !== LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO
          || transferTransferredKg >= 250;
        const refuelReady = (
          stageFillFraction >= (targetFillFraction - 1e-3)
          && !Boolean(transferStep?.transferActive)
          && !Boolean(transferStep?.undockActive)
          && completionTransferSatisfied
        );
        if (refuelReady) {
          if (vehicle.missionId === LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO) {
            setFleetMissionPhase(vehicle, "earth_orbit_hold", {
              refuelFillFraction: stageFillFraction,
              refuelTargetFillFraction: targetFillFraction,
              transferredKg: transferTransferredKg,
            });
            vehicle.missionCompleted = true;
          } else if (vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
            vehicle.moonDepartureSeedPositionKm = cloneFiniteVector(earthRelPos);
            vehicle.moonDepartureSeedVelocityKmS = cloneFiniteVector(earthRelVel);
            setFleetMissionPhase(vehicle, "tli_burn", {
              refuelFillFraction: stageFillFraction,
              refuelTargetFillFraction: targetFillFraction,
              transferredKg: transferTransferredKg,
            });
          }
        }
      }

      if (vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN && !vehicle.missionCompleted) {
        const moonRelPos = moonState?.position
          ? subtract(shipState.position, moonState.position)
          : null;
        const moonRelVel = moonState?.velocity
          ? subtract(
            shipState.velocity || { x: 0, y: 0, z: 0 },
            moonState.velocity || { x: 0, y: 0, z: 0 },
          )
          : null;
        const toMoonVectorKm = moonRelPos ? scale(moonRelPos, -1) : null;
        const moonMinusShipRelativeVelocityKmS = moonRelVel ? scale(moonRelVel, -1) : null;
        const moonDistanceKm = moonRelPos ? length(moonRelPos) : Number.POSITIVE_INFINITY;
        const moonClosingSpeedKmS = moonRelPos && moonRelVel && moonDistanceKm > 1e-9
          ? -dot(moonRelVel, scale(moonRelPos, 1 / moonDistanceKm))
          : Number.NaN;
        const rawMoonProjectedMissDistanceKm = finiteVector(toMoonVectorKm)
          && finiteVector(moonMinusShipRelativeVelocityKmS)
          ? projectedClosestApproachDistanceKm(toMoonVectorKm, moonMinusShipRelativeVelocityKmS)
          : Number.POSITIVE_INFINITY;
        const rawMoonProjectedPeriluneAltitudeKm = Number.isFinite(Number(vehicle.moonProjectedPeriluneAltitudeKm))
          ? Number(vehicle.moonProjectedPeriluneAltitudeKm)
          : (
            Number.isFinite(rawMoonProjectedMissDistanceKm)
              ? rawMoonProjectedMissDistanceKm - moonRadiusKm
              : Number.POSITIVE_INFINITY
          );
        const rawMoonBPlaneErrorKm = Number.isFinite(Number(vehicle.moonBPlaneErrorKm))
          ? Number(vehicle.moonBPlaneErrorKm)
          : rawMoonProjectedMissDistanceKm;
        const tliTelemetry = vehicle.missionPhase === "tli_burn"
          ? resolveMoonTliTelemetryMetrics(vehicle, {
            predictedMissDistanceKm: rawMoonProjectedMissDistanceKm,
            predictedPeriluneAltitudeKm: rawMoonProjectedPeriluneAltitudeKm,
            bPlaneErrorKm: rawMoonBPlaneErrorKm,
          })
          : null;
        const moonProjectedMissDistanceKm = tliTelemetry
          ? Number(tliTelemetry.predictedMissDistanceKm)
          : rawMoonProjectedMissDistanceKm;
        const moonProjectedPeriluneAltitudeKm = tliTelemetry
          ? Number(tliTelemetry.predictedPeriluneAltitudeKm)
          : rawMoonProjectedPeriluneAltitudeKm;
        const moonBPlaneErrorKm = tliTelemetry
          ? Number(tliTelemetry.bPlaneErrorKm)
          : rawMoonBPlaneErrorKm;

        if (vehicle.missionPhase === "tli_burn") {
          const tliGate = evaluateMoonTliExitGate({
            vehicle,
            orbital: earthOrbit,
            moonMetrics: {
              closingSpeedKmS: moonClosingSpeedKmS,
              projectedMissDistanceKm: moonProjectedMissDistanceKm,
              projectedPeriluneAltitudeKm: moonProjectedPeriluneAltitudeKm,
              bPlaneErrorKm: moonBPlaneErrorKm,
            },
            plannerConfig: NAVIGATION_DEFAULTS.planner,
            minPeriapsisKm: FLEET_TLI_PERIAPSIS_PROTECT_MIN_KM,
          });
          if (tliGate.ready) {
            setFleetMissionPhase(vehicle, "coast_to_moon", {
              tliDurationSec: Number(tliGate.tliDurationSec),
              tliTimeoutSec: Number(tliGate.tliTimeoutSec),
              tliElapsedSec: Number(tliGate.phaseElapsedSec),
              periapsisKm: Number.isFinite(tliGate.periapsisKm) ? tliGate.periapsisKm : null,
              fuelBudgetFeasible: Boolean(tliGate.fuelBudgetFeasible),
              fuelBudgetMarginKg: Number.isFinite(tliGate.fuelBudgetMarginKg)
                ? tliGate.fuelBudgetMarginKg
                : null,
              moonProjectedMissDistanceKm: Number.isFinite(moonProjectedMissDistanceKm)
                ? moonProjectedMissDistanceKm
                : null,
              moonProjectedPeriluneAltitudeKm: Number.isFinite(moonProjectedPeriluneAltitudeKm)
                ? moonProjectedPeriluneAltitudeKm
                : null,
              moonBPlaneErrorKm: Number.isFinite(moonBPlaneErrorKm)
                ? moonBPlaneErrorKm
                : null,
            });
          }
        }

        if (vehicle.missionPhase === "coast_to_moon") {
          const captureGate = evaluateMoonCaptureEntryGate({
            moonMetrics: {
              distanceKm: moonDistanceKm,
              closingSpeedKmS: moonClosingSpeedKmS,
              projectedMissDistanceKm: moonProjectedMissDistanceKm,
              projectedPeriluneAltitudeKm: moonProjectedPeriluneAltitudeKm,
              bPlaneErrorKm: moonBPlaneErrorKm,
            },
            plannerConfig: NAVIGATION_DEFAULTS.planner,
          });
          if (captureGate.ready) {
            setFleetMissionPhase(vehicle, "lunar_capture", {
              moonDistanceKm,
              moonClosingSpeedKmS: Number.isFinite(moonClosingSpeedKmS) ? moonClosingSpeedKmS : null,
              moonProjectedMissDistanceKm: Number.isFinite(moonProjectedMissDistanceKm)
                ? moonProjectedMissDistanceKm
                : null,
              moonProjectedPeriluneAltitudeKm: Number.isFinite(moonProjectedPeriluneAltitudeKm)
                ? moonProjectedPeriluneAltitudeKm
                : null,
              moonBPlaneErrorKm: Number.isFinite(moonBPlaneErrorKm) ? moonBPlaneErrorKm : null,
            });
          }
        }
        if (
          vehicle.missionPhase === "lunar_capture"
          && moonRelPos
          && moonRelVel
          && moonMuKm3S2 > 0
        ) {
          const moonOrbit = orbitalStateFromRelative(moonMuKm3S2, moonRadiusKm, moonRelPos, moonRelVel);
          const captureReady =
            Number(moonOrbit.specificEnergy) < 0
            && Number(moonOrbit.periapsisKm) > 35
            && Number(moonOrbit.apoapsisKm) < 30_000;
          if (captureReady) {
            setFleetMissionPhase(vehicle, "lunar_orbit_hold", {
              moonApoapsisKm: Number(moonOrbit.apoapsisKm),
              moonPeriapsisKm: Number(moonOrbit.periapsisKm),
            });
            vehicle.missionCompleted = true;
          }
        }
      }
    }
    for (let i = 0; i < removeIds.length; i += 1) {
      vehicles.delete(removeIds[i]);
    }
  }

  function statusSnapshotForBody({
    state,
    bodyId = "",
    nowMs = Date.now(),
    baseSnapshot = {},
    phaseLabel = defaultPhaseLabel,
  } = {}) {
    const vehicle = fleetVehicles().get(String(bodyId || "")) || null;
    if (!vehicle) {
      return null;
    }
    const safeBaseSnapshot = (baseSnapshot && typeof baseSnapshot === "object")
      ? baseSnapshot
      : {};
    const phaseLabelFn = typeof phaseLabel === "function"
      ? phaseLabel
      : defaultPhaseLabel;
    const shipState = state?.dynamicBodies?.get?.(vehicle.id) || null;
    const earthState = bodyStateFromNBody(state, "earth");
    if (
      !shipState
      || !earthState
      || !finiteVector(shipState.position)
      || !finiteVector(shipState.velocity || { x: 0, y: 0, z: 0 })
      || !finiteVector(earthState.position)
      || !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      const vehicleKind = vehicle.vehicleRole === "tanker" ? "tanker" : "starship";
      return {
        ...safeBaseSnapshot,
        bodyId: vehicle.id,
        vehicleKind,
        vehicleName: vehicle.vehicleName || "Starship",
        launchMode: String(vehicle.launchMode || "pad_launch"),
        moonRelativeSpeedKmS: null,
        moonProjectedMissDistanceKm: null,
        moonProjectedMissTrendKmS: null,
        moonProjectedPeriluneAltitudeKm: null,
        moonBPlaneErrorKm: null,
        moonDepartureWindowScore: null,
        moonDepartureWindowWaitSec: null,
        moonDepartureWindowPhaseErrorDeg: null,
        moonDepartureGeometryScore: null,
        moonDepartureAlignNow: null,
        moonDepartureAlignProjected: null,
        moonDepartureCorridorAccepted: false,
        moonDepartureCorridorScore: null,
        moonEstimatedTliDeltaVKmS: null,
        moonDepartureWindowReady: false,
        moonDepartureWindowLaunchTimeMs: null,
        targetEtaSeconds: null,
        targetEtaSource: "",
        targetRateLabel: "Closing",
        targetEtaLabel: "ETA",
        moonTliTargetMode: "",
        moonTliTargetMissKm: null,
        moonTliTargetMissGateKm: null,
        moonTliTargetBPlaneKm: null,
        moonTliTargetPeriluneKm: null,
        moonGoNoGoStatus: "n/a",
        moonGoNoGoReason: "",
        missionPhaseGateReason: "",
        refuelTransferActive: false,
        refuelTransferTankerId: "",
        refuelTransferProgress: 0,
        refuelTransferRemainingKg: 0,
        refuelTransferRateKgS: 0,
        refuelTransferLocked: false,
        refuelUndockActive: false,
        refuelFuelingActive: false,
        guidanceBurnRequested: false,
        guidanceRequestedThrottle: 0,
        guidanceInertNoPropellant: false,
        guidanceInertReason: "",
        gimbalErrorDeg: null,
        comNormalized: null,
        inertiaNormalized: null,
        controlAuthorityScale: null,
        fuelBudgetRequiredDeltaVKmS: null,
        fuelBudgetAvailableDeltaVKmS: null,
        fuelBudgetMinimumPropellantKg: null,
        fuelBudgetAvailablePropellantKg: null,
        fuelBudgetMarginKg: null,
        fuelBudgetFeasible: null,
        fuelBudgetShipToMoonDistanceKm: null,
        fuelBudgetEarthToMoonDistanceKm: null,
        statusLine: `${vehicle.vehicleName || "Starship"} telemetry unavailable.`,
      };
    }

    const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
    const muKm3S2 = Number(gravitationalConstantKm3PerKgS2) * (Number(getEarthMassKg?.()) || 0);
    const relPos = subtract(shipState.position, earthState.position);
    const relVel = subtract(
      shipState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    const orbital = orbitalStateFromRelative(muKm3S2, earthRadiusKm, relPos, relVel);
    const currentEarthAxes = typeof earthAxes === "function"
      ? (earthAxes(nowMs) || { pole: { x: 0, y: 0, z: 1 } })
      : { pole: { x: 0, y: 0, z: 1 } };
    const earthPole = currentEarthAxes?.pole || { x: 0, y: 0, z: 1 };
    const atmosphereSample = sampleEarthAtmosphere?.(Math.max(0, Number(orbital.altitudeKm) || 0)) || null;
    const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
      atmosphereSample,
      relPos,
      relVel,
      earthPole,
    );

    let targetBodyId = "earth";
    let targetBodyName = "Earth";
    let targetDistanceKm = Math.max(0, length(relPos) - earthRadiusKm);
    let targetClosingSpeedKmS = null;
    let moonRelativeSpeedKmS = null;
    let moonProjectedMissDistanceKm = null;
    let moonProjectedPeriluneAltitudeKm = finiteOrNull(vehicle.moonProjectedPeriluneAltitudeKm);
    let moonBPlaneErrorKm = finiteOrNull(vehicle.moonBPlaneErrorKm);
    let moonProjectedMissTrendKmS = finiteOrNull(vehicle.moonProjectedMissTrendKmS);
    const earthDistanceKm = length(relPos);
    const moonRadiusKm = Number(getBodyRadiusKm?.("moon")) || 1737.4;
    const snapshotGuidanceMode = String(
      vehicle.guidanceMode || vehicle.lastStep?.guidanceMode || "",
    ).trim();
    const earthRadialSpeedKmS = earthDistanceKm > 1e-9
      ? dot(relPos, relVel) / earthDistanceKm
      : 0;
    const moonState = bodyStateFromNBody(state, "moon");
    if (
      vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
      && moonState
      && finiteVector(moonState.position)
      && finiteVector(moonState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      const moonRelPos = subtract(shipState.position, moonState.position);
      const moonRelVel = subtract(
        shipState.velocity || { x: 0, y: 0, z: 0 },
        moonState.velocity || { x: 0, y: 0, z: 0 },
      );
      const moonDistanceKm = length(moonRelPos);
      targetBodyId = "moon";
      targetBodyName = "Moon";
      targetDistanceKm = moonDistanceKm;
      targetClosingSpeedKmS = moonDistanceKm > 1e-9
        ? -dot(moonRelVel, scale(moonRelPos, 1 / moonDistanceKm))
        : null;
      const relativeSpeed = length(moonRelVel);
      moonRelativeSpeedKmS = Number.isFinite(relativeSpeed) ? relativeSpeed : null;
      const projectedMiss = projectedClosestApproachDistanceKm(moonRelPos, moonRelVel);
      const rawMoonProjectedMissDistanceKm = Number.isFinite(projectedMiss) ? projectedMiss : null;
      moonProjectedMissDistanceKm = rawMoonProjectedMissDistanceKm;
      moonProjectedPeriluneAltitudeKm = Number.isFinite(moonProjectedPeriluneAltitudeKm)
        ? moonProjectedPeriluneAltitudeKm
        : (
          Number.isFinite(rawMoonProjectedMissDistanceKm)
            ? rawMoonProjectedMissDistanceKm - moonRadiusKm
            : null
        );
      moonBPlaneErrorKm = Number.isFinite(moonBPlaneErrorKm)
        ? moonBPlaneErrorKm
        : rawMoonProjectedMissDistanceKm;
      if (
        vehicle.missionPhase === "tli_burn"
        || moonDepartureHoldTelemetryActive(vehicle, snapshotGuidanceMode)
      ) {
        const tliTelemetry = resolveMoonDepartureTelemetryMetricsForSnapshot({
          vehicle,
          guidanceMode: snapshotGuidanceMode,
          rawPredictedMissDistanceKm: rawMoonProjectedMissDistanceKm,
          rawPredictedPeriluneAltitudeKm: moonProjectedPeriluneAltitudeKm,
          rawBPlaneErrorKm: moonBPlaneErrorKm,
        });
        moonProjectedMissDistanceKm = finiteOrNull(tliTelemetry.predictedMissDistanceKm);
        moonProjectedPeriluneAltitudeKm = finiteOrNull(tliTelemetry.predictedPeriluneAltitudeKm);
        moonBPlaneErrorKm = finiteOrNull(tliTelemetry.bPlaneErrorKm);
        if (tliTelemetry.usingGuidanceDiagnostics || tliTelemetry.preserveDeparturePlan) {
          moonProjectedMissTrendKmS = null;
        }
      }
    } else {
      targetClosingSpeedKmS = earthDistanceKm > 1e-9
        ? -dot(relVel, scale(relPos, 1 / earthDistanceKm))
        : null;
      if (
        vehicle.missionPhase === "orbital_refuel"
        && vehicle.vehicleRole !== "tanker"
      ) {
        const target = selectLockedTankerTargetForVehicle(
          vehicle,
          state,
          shipState,
          earthState,
          { mutateLock: false },
        );
        if (target && Number.isFinite(Number(target.distanceKm))) {
          targetBodyId = String(target.tankerId || "refuel_tanker");
          targetBodyName = "Refuel Tanker";
          targetDistanceKm = Number(target.distanceKm);
          targetClosingSpeedKmS = Number.isFinite(Number(target.closingSpeedKmS))
            ? Number(target.closingSpeedKmS)
            : targetClosingSpeedKmS;
        }
      }
    }

    const stageProfiles = Array.isArray(vehicle.stageProfiles) && vehicle.stageProfiles.length >= 2
      ? vehicle.stageProfiles
      : [
        { name: "Stage 1", propellantMassKg: 3_400_000 },
        { name: "Stage 2", propellantMassKg: 1_200_000 },
      ];
    const stageIndex = Math.max(0, Math.min(stageProfiles.length - 1, Number(vehicle.stageIndex) || 0));
    const stageName = String(stageProfiles[stageIndex]?.name || `Stage ${stageIndex + 1}`);
    const throttle = Number(vehicle.lastStep?.throttle) || 0;
    const phase = throttle > 1e-3
      ? "powered"
      : (vehicle.missionPhase === "launch_to_parking" ? "coast" : "orbit");
    const missionName = vehicle.vehicleRole === "tanker"
      ? "Orbital Tanker Ops"
      : fleetMissionNameForId(vehicle.missionId);
    const vehicleKind = vehicle.vehicleRole === "tanker" ? "tanker" : "starship";
    const refuelFlight = refuelFlightById(vehicle.id);
    const stepRcsActive = Boolean(vehicle.lastStep?.rcsActive);
    const stepRcsMode = String(vehicle.lastStep?.rcsMode || "").trim();
    const stepRcsAuthority = clamp(Number(vehicle.lastStep?.rcsAuthority) || 0, 0, 1);
    const stepRcsAccelKmS2 = Math.max(0, Number(vehicle.lastStep?.rcsAccelKmS2) || 0);
    const stepRcsJets = Array.isArray(vehicle.lastStep?.rcsJets) ? vehicle.lastStep.rcsJets : [];
    const flightRcsActive = Boolean(refuelFlight?.rcsActive) || stepRcsActive;
    const flightRcsMode = String(refuelFlight?.rcsMode || "").trim();
    const transferTelemetry = fleetTransferTelemetryState(vehicle);
    const transferActive = Boolean(transferTelemetry.transferActive);
    const transferTankerId = String(transferTelemetry.transferTankerId || "");
    const refuelTransferProgress = clamp(Number(transferTelemetry.transferProgress) || 0, 0, 1);
    const refuelTransferRemainingKg = Math.max(0, Number(transferTelemetry.transferRemainingKg) || 0);
    const refuelTransferRateKgS = Math.max(0, Number(transferTelemetry.transferRateKgS) || 0);
    let fuelingActiveForBody = transferActive;
    if (vehicleKind === "tanker") {
      fuelingActiveForBody = false;
      const vehicles = fleetVehicles();
      for (const [, candidate] of vehicles.entries()) {
        if (!candidate || candidate.id === vehicle.id) {
          continue;
        }
        const candidateTransfer = fleetTransferTelemetryState(candidate);
        if (
          candidateTransfer.transferActive
          && String(candidateTransfer.transferTankerId || "") === vehicle.id
        ) {
          fuelingActiveForBody = true;
          break;
        }
      }
    }
    const baseGuidanceMode = snapshotGuidanceMode || "autopilot-orbital-hold";
    const guidanceMode = flightRcsMode
      ? `${baseGuidanceMode}:${flightRcsMode}`
      : baseGuidanceMode;
    const targetEtaTelemetry = resolveTargetEtaTelemetryForSnapshot({
      vehicle,
      guidanceMode,
      targetDistanceKm,
      targetClosingSpeedKmS,
    });
    let phaseLabelText = phaseLabelFn(phase);
    if (vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
      if (vehicle.missionPhase === "tli_burn") {
        phaseLabelText = String(guidanceMode).includes("reacquire-window")
          ? "TLI Reacquire Hold"
          : (phase === "powered" ? "TLI Burn" : "TLI Hold");
      } else if (vehicle.missionPhase === "coast_to_moon") {
        phaseLabelText = "Trans-Lunar Coast";
      } else if (vehicle.missionPhase === "lunar_capture") {
        phaseLabelText = "Lunar Capture";
      } else if (vehicle.missionPhase === "tei_burn") {
        phaseLabelText = phase === "powered" ? "TEI Burn" : "TEI Hold";
      }
    }
    const rcsAuthority = clamp(
      Number.isFinite(Number(refuelFlight?.rcsAuthority))
        ? Number(refuelFlight.rcsAuthority)
        : (
          stepRcsAuthority > 0
            ? stepRcsAuthority
            : ((Number(refuelFlight?.rcsAccelKmS2) || stepRcsAccelKmS2) / 0.00025)
        ),
      0,
      1,
    );
    const rcsJets = flightRcsActive
      ? (
        Array.isArray(refuelFlight?.rcsJets) && refuelFlight.rcsJets.length > 0
          ? refuelFlight.rcsJets
          : (
            stepRcsJets.length > 0
              ? stepRcsJets
              : ((flightRcsMode || stepRcsMode) ? [flightRcsMode || stepRcsMode] : [])
          )
      )
      : [];
    const rcsOrbitCorrectionAccelKmS2 = Math.max(0, Number(refuelFlight?.rcsAccelKmS2) || stepRcsAccelKmS2);
    const rcsOrbitCorrectionForceN = (vehicleKind === "tanker" || stepRcsActive)
      ? Math.max(0, (Number(shipState.massKg) || 0) * rcsOrbitCorrectionAccelKmS2 * 1000)
      : 0;
    const rcsErrorDeg = Math.max(0, Number(refuelFlight?.attitudeErrorDeg) || 0);
    const rcsAttitudeAuthority = clamp(
      Number.isFinite(Number(refuelFlight?.attitudeAuthority))
        ? Number(refuelFlight.attitudeAuthority)
        : 1,
      0,
      1,
    );
    const rcsAttitudeLimited = Boolean(refuelFlight?.attitudeLimited);
    const rcsThrustAxisKm = finiteVector(refuelFlight?.attitudeAxisKm)
      ? {
        x: Number(refuelFlight.attitudeAxisKm.x) || 0,
        y: Number(refuelFlight.attitudeAxisKm.y) || 0,
        z: Number(refuelFlight.attitudeAxisKm.z) || 0,
      }
      : null;
    const rcsDesiredAxisKm = finiteVector(refuelFlight?.attitudeDesiredAxisKm)
      ? {
        x: Number(refuelFlight.attitudeDesiredAxisKm.x) || 0,
        y: Number(refuelFlight.attitudeDesiredAxisKm.y) || 0,
        z: Number(refuelFlight.attitudeDesiredAxisKm.z) || 0,
      }
      : null;
    const guidanceBurnRequested = Boolean(
      vehicle.lastStep?.guidanceBurnRequested
      ?? vehicle.guidanceBurnRequested,
    );
    const guidanceRequestedThrottle = clamp(
      Number(vehicle.lastStep?.guidanceRequestedThrottle ?? vehicle.guidanceRequestedThrottle) || 0,
      0,
      1,
    );
    const guidanceInertNoPropellant = Boolean(
      vehicle.lastStep?.guidanceInertNoPropellant
      ?? vehicle.guidanceInertNoPropellant,
    );
    const guidanceInertReason = String(
      vehicle.lastStep?.guidanceInertReason
      || vehicle.guidanceInertReason
      || "",
    );
    const fuelBudget = vehicle.fuelBudget && typeof vehicle.fuelBudget === "object"
      ? vehicle.fuelBudget
      : null;
    const missionPhaseGateReason = fleetMissionPhaseGateReason({
      vehicle,
      orbital,
      moonDistanceKm: Number(targetBodyId === "moon" ? targetDistanceKm : Number.POSITIVE_INFINITY),
      moonClosingSpeedKmS: Number(targetBodyId === "moon" ? targetClosingSpeedKmS : 0),
      moonRelativeSpeedKmS,
      moonProjectedMissDistanceKm,
      moonProjectedPeriluneAltitudeKm,
      moonBPlaneErrorKm,
      earthDistanceKm,
      earthRadialSpeedKmS,
    });
    return {
      ...safeBaseSnapshot,
      bodyId: vehicle.id,
      vehicleKind,
      vehicleName: vehicle.vehicleName || "Starship",
      launchMode: String(vehicle.launchMode || "pad_launch"),
      phase,
      phaseLabel: phaseLabelText,
      stageName,
      stageIndex,
      elapsedSeconds: Number(vehicle.elapsedSeconds) || 0,
      massKg: Number(shipState.massKg) || 0,
      altitudeKm: Math.max(0, Number(orbital.altitudeKm) || 0),
      speedKmS: Number(orbital.speedKmS) || 0,
      radialSpeedKmS: Number(orbital.radialSpeedKmS) || 0,
      tangentialSpeedKmS: Number(orbital.tangentialSpeedKmS) || 0,
      circularSpeedKmS: Number(orbital.circularSpeedKmS) || 0,
      apoapsisKm: Number.isFinite(Number(orbital.apoapsisKm)) ? Number(orbital.apoapsisKm) : null,
      periapsisKm: Number.isFinite(Number(orbital.periapsisKm)) ? Number(orbital.periapsisKm) : null,
      timeToApoapsisSec: Number.isFinite(Number(orbital.timeToApoapsisSec))
        ? Number(orbital.timeToApoapsisSec)
        : null,
      throttle,
      throttleCommand: Number(vehicle.lastStep?.throttleCommand) || throttle,
      thrustN: Number(vehicle.lastStep?.thrustN) || 0,
      burnRateKgS: Number(vehicle.lastStep?.burnRateKgS) || 0,
      dynamicPressurePa: Number(vehicle.lastStep?.dynamicPressurePa) || dynamicPressurePa,
      gimbalErrorDeg: Number(vehicle.lastStep?.gimbalErrorDeg) || 0,
      comNormalized: Number.isFinite(Number(vehicle.lastStep?.comNormalized))
        ? Number(vehicle.lastStep.comNormalized)
        : null,
      inertiaNormalized: Number.isFinite(Number(vehicle.lastStep?.inertiaNormalized))
        ? Number(vehicle.lastStep.inertiaNormalized)
        : null,
      controlAuthorityScale: Number.isFinite(Number(vehicle.lastStep?.controlAuthorityScale))
        ? Number(vehicle.lastStep.controlAuthorityScale)
        : null,
      guidanceMode,
      autopilotMode: guidanceMode,
      missionId: vehicle.missionId,
      missionName,
      missionPhase: vehicle.missionPhase,
      missionCompleted: Boolean(vehicle.missionCompleted),
      stagePropellantKg: Math.max(0, Number(vehicle.stagePropellantKg) || 0),
      refuelRequiredFlights: 0,
      refuelCompletedFlights: 0,
      refuelActiveFlights: 0,
      refuelLaunchedFlights: 0,
      refuelTargetPropellantKg: 0,
      refuelFillFraction: 0,
      refuelCanLaunchTanker: false,
      refuelTransferActive: transferActive,
      refuelTransferTankerId: transferTankerId,
      refuelTransferProgress,
      refuelTransferRemainingKg,
      refuelTransferRateKgS,
      refuelApproachDesiredClosingKmS: Number.isFinite(Number(transferTelemetry.approachDesiredClosingKmS))
        ? Number(transferTelemetry.approachDesiredClosingKmS)
        : null,
      refuelApproachClosingKmS: Number.isFinite(Number(transferTelemetry.approachClosingKmS))
        ? Number(transferTelemetry.approachClosingKmS)
        : null,
      refuelApproachOrbitalRateRadS: Number.isFinite(Number(transferTelemetry.approachOrbitalRateRadS))
        ? Number(transferTelemetry.approachOrbitalRateRadS)
        : null,
      refuelTransferLocked: transferActive || String(transferTelemetry.phase || "") === "docked_lock",
      refuelUndockActive: Boolean(transferTelemetry.undockActive),
      refuelFuelingActive: fuelingActiveForBody,
      refuelLastAction: String(transferTelemetry.lastAction || ""),
      refuelLastActionTimeSec: Math.max(0, Number(transferTelemetry.lastActionTimeSec) || 0),
      boosterDistanceKm: null,
      starshipDistanceKm: null,
      boosterPhase: null,
      boosterGuidanceMode: null,
      boosterActive: false,
      boosterLanded: false,
      boosterThrottle: 0,
      boosterThrustN: 0,
      boosterRcsActive: false,
      boosterRcsErrorDeg: 0,
      boosterRcsAuthority: 0,
      boosterRcsJets: [],
      boosterPressurePa: null,
      boosterDensityKgM3: null,
      boosterDynamicPressurePa: null,
      boosterThrottleCommand: 0,
      boosterAngleOfAttackDeg: 0,
      boosterQAlphaPaRad: 0,
      boosterMachNumber: 0,
      boosterDragCoefficient: 0,
      boosterLiftCoefficient: 0,
      boosterGimbalErrorDeg: 0,
      boosterWindSpeedKmS: 0,
      boosterWindEastMS: 0,
      boosterWindNorthMS: 0,
      boosterComNormalized: 0,
      boosterInertiaNormalized: 0,
      boosterControlAuthorityScale: 0,
      boosterAltitudeKm: null,
      boosterSpeedKmS: null,
      boosterAltitudeAboveTerrainKm: null,
      boosterPropellantKg: 0,
      boosterInitialPropellantKg: 0,
      boosterFuelFraction: null,
      boosterLaunchSiteRangeKm: null,
      boosterLaunchSiteLateralRangeKm: null,
      boosterLaunchSiteLateralClosingSpeedKmS: null,
      hotstageActive: false,
      hotstageTimeSinceIgnitionSec: null,
      hotstageOverlapSeconds: null,
      hotstageIgnitionStableSec: null,
      hotstageVirtualSeparationKm: null,
      hotstageDetachReason: null,
      terrainElevationKm: null,
      altitudeAboveTerrainKm: null,
      latitudeDeg: null,
      longitudeDeg: null,
      targetBodyId,
      targetBodyName,
      targetDistanceKm,
      targetClosingSpeedKmS,
      targetEtaSeconds: finiteOrNull(targetEtaTelemetry.targetEtaSeconds),
      targetEtaSource: String(targetEtaTelemetry.targetEtaSource || ""),
      targetRateLabel: String(targetEtaTelemetry.targetRateLabel || "Closing"),
      targetEtaLabel: String(targetEtaTelemetry.targetEtaLabel || "ETA"),
      moonRelativeSpeedKmS,
      moonProjectedMissDistanceKm,
      moonProjectedMissTrendKmS,
      moonProjectedPeriluneAltitudeKm,
      moonBPlaneErrorKm,
      moonDepartureWindowScore: finiteOrNull(vehicle.moonDepartureWindowScore),
      moonDepartureWindowWaitSec: finiteOrNull(vehicle.moonDepartureWindowWaitSec),
      moonDepartureWindowPhaseErrorDeg: finiteOrNull(vehicle.moonDepartureWindowPhaseErrorDeg),
      moonDepartureGeometryScore: finiteOrNull(vehicle.moonDepartureGeometryScore),
      moonDepartureAlignNow: finiteOrNull(vehicle.moonDepartureAlignNow),
      moonDepartureAlignProjected: finiteOrNull(vehicle.moonDepartureAlignProjected),
      moonDepartureCorridorAccepted: Boolean(vehicle.moonDepartureCorridorAccepted),
      moonDepartureCorridorScore: finiteOrNull(vehicle.moonDepartureCorridorScore),
      moonEstimatedTliDeltaVKmS: finiteOrNull(vehicle.moonEstimatedTliDeltaVKmS),
      moonDepartureWindowReady: Boolean(vehicle.moonDepartureWindowReady),
      moonDepartureWindowLaunchTimeMs: Number.isFinite(Number(vehicle.moonDepartureWindowWaitSec))
        ? (
          Number(nowMs)
          + (Math.max(0, Number(vehicle.moonDepartureWindowWaitSec)) * 1000)
        )
        : null,
      moonTliTargetMode: String(vehicle.moonTliTargetMode || ""),
      moonTliTargetMissKm: finiteOrNull(vehicle.moonTliTargetMissKm),
      moonTliTargetMissGateKm: finiteOrNull(vehicle.moonTliTargetMissGateKm),
      moonTliTargetBPlaneKm: finiteOrNull(vehicle.moonTliTargetBPlaneKm),
      moonTliTargetPeriluneKm: finiteOrNull(vehicle.moonTliTargetPeriluneKm),
      moonGoNoGoStatus: String(vehicle.moonGoNoGoStatus || "n/a"),
      moonGoNoGoReason: String(vehicle.moonGoNoGoReason || ""),
      missionPhaseGateReason,
      guidanceBurnRequested,
      guidanceRequestedThrottle,
      guidanceInertNoPropellant,
      guidanceInertReason,
      rcsActive: flightRcsActive,
      rcsErrorDeg,
      rcsAuthority,
      rcsJets,
      rcsAttitudeAuthority,
      rcsAttitudeLimited,
      rcsThrustAxisKm,
      rcsDesiredAxisKm,
      rcsOrbitCorrectionAccelKmS2,
      rcsOrbitCorrectionForceN,
      fuelBudgetRequiredDeltaVKmS: Number.isFinite(Number(fuelBudget?.requiredDeltaVKmS))
        ? Number(fuelBudget.requiredDeltaVKmS)
        : null,
      fuelBudgetAvailableDeltaVKmS: Number.isFinite(Number(fuelBudget?.availableDeltaVKmS))
        ? Number(fuelBudget.availableDeltaVKmS)
        : null,
      fuelBudgetMinimumPropellantKg: Number.isFinite(Number(fuelBudget?.minimumRequiredPropellantKg))
        ? Number(fuelBudget.minimumRequiredPropellantKg)
        : null,
      fuelBudgetAvailablePropellantKg: Number.isFinite(Number(fuelBudget?.availablePropellantKg))
        ? Number(fuelBudget.availablePropellantKg)
        : null,
      fuelBudgetMarginKg: Number.isFinite(Number(fuelBudget?.marginKg))
        ? Number(fuelBudget.marginKg)
        : null,
      fuelBudgetFeasible: fuelBudget ? Boolean(fuelBudget.feasible) : null,
      fuelBudgetShipToMoonDistanceKm: Number.isFinite(Number(fuelBudget?.shipToMoonDistanceKm))
        ? Number(fuelBudget.shipToMoonDistanceKm)
        : null,
      fuelBudgetEarthToMoonDistanceKm: Number.isFinite(Number(fuelBudget?.earthToMoonDistanceKm))
        ? Number(fuelBudget.earthToMoonDistanceKm)
        : null,
      launchSiteName: LAUNCH_SITE.name || "Launch Site",
      statusLine: `${vehicle.vehicleName || "Starship"} | ${vehicle.missionPhase || "coast"}`,
    };
  }

  function externalAccelerationKmS2(bodyId) {
    const fleetStep = fleetVehicles().get(String(bodyId || ""))?.lastStep;
    if (fleetStep?.accelerationKmS2) {
      return fleetStep.accelerationKmS2;
    }
    return { x: 0, y: 0, z: 0 };
  }

  return {
    hasActiveVehicles,
    launchMissionShip,
    removeVehicleById,
    prepareStep,
    finalizeStep,
    statusSnapshotForBody,
    externalAccelerationKmS2,
  };
}
