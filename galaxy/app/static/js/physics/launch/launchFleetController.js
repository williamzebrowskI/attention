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
  angleBetweenRadians,
  clamp,
  cross,
  degrees,
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
} from "./lunar/windowTargeting.js";
import {
  evaluateMoonPadLaunchWindow,
  solveMoonDepartureWindow,
} from "../navigation_system/lunar/departureWindowSolver.js";
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
  estimateMoonRoundTripFuelBudget,
  estimateOrbitalRefuelDemoFuelBudget,
} from "./missionFuelBudget.js";
import {
  FLEET_MISSION_SHIP_ID_PREFIX,
  FLEET_MOON_TLI_DURATION_SEC,
} from "./launchFleetConfig.js";
import {
  MOON_BURN_ATTITUDE_GATE_ENTER_ERROR_DEG,
  MOON_BURN_ATTITUDE_GATE_EXIT_ERROR_DEG,
} from "./lunar/constants.js";
import { NAVIGATION_DEFAULTS } from "../navigation_system/navigationSystemConfig.js";
import {
  NAVIGATION_MISSION_IDS,
  NAVIGATION_MISSION_PHASES,
} from "../navigation_system/navigationMissionProfiles.js";
import { planMoonMissionCommand } from "../navigation_system/planners/moonMissionPlanner.js";
import { planRefuelRendezvousCommand } from "../navigation_system/planners/refuelRendezvousPlanner.js";
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
const FLEET_TLI_PERIAPSIS_PROTECT_MIN_KM = 130;
const FLEET_TLI_GO_NOGO_MIN_ALTITUDE_KM = 120;
const FLEET_ORBITAL_REFUEL_DEMO_STAGE2_MIN_PROPELLANT_KG = 2_400_000;
const FLEET_ORBITAL_REFUEL_DEMO_MARGIN_CONSERVE_KG = 90_000;
const FLEET_ORBITAL_REFUEL_DEMO_MARGIN_SOFT_DEFICIT_KG = -8_000;
const FLEET_ORBITAL_REFUEL_DEMO_MARGIN_HARD_HOLD_KG = -30_000;
const FLEET_MOON_MISSION_STAGE2_MIN_PROPELLANT_KG = 5_000_000;
const FLEET_MOON_MISSION_MARGIN_CONSERVE_KG = 220_000;
const FLEET_MOON_MISSION_MARGIN_CRITICAL_KG = 120_000;
const FLEET_MOON_PAD_WINDOW_PHASE_TOLERANCE_DEG = 4.0;
const FLEET_MOON_PAD_WINDOW_MAX_ALTITUDE_KM = 2.0;
const FLEET_MOON_PAD_WINDOW_MAX_WAIT_SEC = 180;
const FLEET_MOON_REFUEL_TARGET_FILL_FRACTION = 0.88;
// Keep orbit-recovery active in refuel demos to prevent periapsis collapse/reentry.
const FLEET_REFUEL_DEMO_BYPASS_ORBIT_RECOVERY = false;
const FLEET_REFUEL_SPEED_BRAKE_ENTER_EXCESS_KM_S = 0.22;
const FLEET_REFUEL_SPEED_BRAKE_EXIT_EXCESS_KM_S = 0.14;
const FLEET_REFUEL_SPEED_BRAKE_ENTER_APO_BUFFER_KM = 300;
const FLEET_REFUEL_SPEED_BRAKE_EXIT_APO_BUFFER_KM = 200;
const FLEET_REFUEL_SPEED_BRAKE_MIN_HOLD_SEC = 75;
const FLEET_REFUEL_SPEED_BRAKE_EXIT_STABLE_SEC = 18;
const FLEET_REFUEL_RECOVERY_BURN_WINDOW_SEC = 600;
const FLEET_REFUEL_RECOVERY_EXIT_PERIAPSIS_KM = 144;
const FLEET_REFUEL_RECOVERY_EXIT_RADIAL_MIN_KM_S = -0.0016;
const FLEET_REFUEL_RECOVERY_CLOSE_RANGE_DISTANCE_KM = 20;
const FLEET_REFUEL_RECOVERY_CLOSE_RANGE_REL_SPEED_KM_S = 0.03;
const FLEET_REFUEL_RECOVERY_CLOSE_RANGE_MIN_PERIAPSIS_KM = 138;
const FLEET_REFUEL_RECOVERY_IMMEDIATE_BURN_PERIAPSIS_KM = 138;
const FLEET_REFUEL_RECOVERY_IMMEDIATE_BURN_ALTITUDE_KM = 155;
const FLEET_REFUEL_RECOVERY_IMMEDIATE_BURN_THROTTLE_BASE = 0.24;
const FLEET_REFUEL_RECOVERY_IMMEDIATE_BURN_THROTTLE_MAX = 0.56;
const FLEET_REFUEL_RECOVERY_IMMEDIATE_BURN_UP_BIAS = 0.16;
const FLEET_TEI_DEPARTURE_DISTANCE_KM = 140_000;
const FLEET_EARTH_CAPTURE_DISTANCE_KM = 180_000;
const FLEET_EARTH_CAPTURE_APOAPSIS_MAX_KM = 75_000;
const FLEET_EARTH_CAPTURE_PERIAPSIS_MIN_KM = 120;
const FLEET_MOON_BURN_ATTITUDE_GATE_PHASES = new Set([
  "tli_burn",
  "coast_to_moon",
  "lunar_capture",
  "tei_burn",
  "earth_capture",
]);
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
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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
    return `Awaiting parking orbit gate: apo/peri >= 180 km / 150 km. Window score ${scoreLabel}.`;
  }
  if (phase === "orbital_refuel") {
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
      fallbackDurationSec: FLEET_MOON_TLI_DURATION_SEC,
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
    const phaseAngle = Number.isFinite(Number(phaseAngleRad))
      ? normalizeAngleZeroToTau(Number(phaseAngleRad))
      : (Math.random() * (Math.PI * 2));
    const cTheta = Math.cos(phaseAngle);
    const sTheta = Math.sin(phaseAngle);
    const cInc = Math.cos(incRad);
    const sInc = Math.sin(incRad);
    const relPositionKm = {
      x: orbitRadiusKm * cTheta,
      y: orbitRadiusKm * sTheta * cInc,
      z: orbitRadiusKm * sTheta * sInc,
    };
    const relVelocityDirection = normalize(
      {
        x: -sTheta,
        y: cTheta * cInc,
        z: cTheta * sInc,
      },
      { x: 0, y: 1, z: 0 },
    );
    const relVelocityKmS = scale(relVelocityDirection, speedAtSpawnKmS);
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
      ? 185
      : 150;
    const orbitInjectAltitudeKm = Number.isFinite(requestedOrbitInjectAltitudeKm)
      ? Math.max(120, requestedOrbitInjectAltitudeKm)
      : defaultOrbitInjectAltitudeKm;
    const moonState = bodyStateFromNBody(state, "moon");
    const earthMuKm3S2 = Number(gravitationalConstantKm3PerKgS2)
      * (
        Number(getEarthMassKg?.())
        || Number(earthState.massKg)
        || 0
      );
    const moonDepartureWindowSeed = isMoonOrbitInject
      ? solveMoonDepartureWindow({
        earthState,
        moonState,
        inclinationDeg: Number(LAUNCH_SITE.latitudeDeg) || 28.5,
        orbitAltitudeKm: orbitInjectAltitudeKm,
        earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
        earthMuKm3S2,
      })
      : null;
    const moonWindowInjectPhaseRad = moonDepartureWindowSeed
      ? Number(moonDepartureWindowSeed.targetPhaseRad)
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
      Number(options?.orbitInjectMoonApoapsisKm) || 220,
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
          orbitAltitudeKm: orbitInjectAltitudeKm,
          earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
          earthMuKm3S2,
          padAngularRateRadS: EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
          phaseToleranceDeg: FLEET_MOON_PAD_WINDOW_PHASE_TOLERANCE_DEG,
        })
        || moonDepartureWindowSeed
      )
      : null;

    const stage1Raw = typeof stageAtIndex === "function" ? stageAtIndex(0) : null;
    const stage2Raw = typeof stageAtIndex === "function" ? stageAtIndex(1) : null;
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
    const initialMassKg = launchMode === "orbit_inject"
      ? (
        Math.max(0, Number(injectedStage?.dryMassKg) || 0)
        + Math.max(0, Number(injectedStage?.propellantMassKg) || 0)
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
      : (normalizedMissionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN ? 220 : 240);
    const targetOrbitPeriapsisKm = vehicleRole === "tanker"
      ? 150
      : (normalizedMissionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN ? 170 : 200);
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
      moonDepartureWindowScore: moonDepartureWindow
        ? finiteOrNull(moonDepartureWindow.windowScore)
        : null,
      moonDepartureWindowWaitSec: moonDepartureWindow
        ? finiteOrNull(moonDepartureWindow.waitSec)
        : null,
      moonDepartureWindowPhaseErrorDeg: moonDepartureWindow
        ? finiteOrNull(moonDepartureWindow.phaseErrorDeg)
        : null,
      moonDepartureGeometryScore: moonDepartureWindow
        ? finiteOrNull(moonDepartureWindow.geometryScore)
        : null,
      moonDepartureAlignNow: moonDepartureWindow
        ? finiteOrNull(moonDepartureWindow.selectedDepartureAlignment)
        : null,
      moonDepartureAlignProjected: moonDepartureWindow
        ? finiteOrNull(moonDepartureWindow.selectedProjectedAlignment)
        : null,
      moonEstimatedTliDeltaVKmS: moonDepartureWindow
        ? finiteOrNull(moonDepartureWindow.estimatedTliDeltaVKmS)
        : null,
      stageIndex: launchMode === "orbit_inject" ? injectedStageIndex : 0,
      stagePropellantKg: launchMode === "orbit_inject"
        ? Math.max(0, Number(injectedStage?.propellantMassKg) || 0)
        : Math.max(0, Number(stageProfiles[0]?.propellantMassKg) || 0),
      dryMassKg: launchMode === "orbit_inject"
        ? Math.max(minRocketMassKg, Number(injectedStage?.dryMassKg) || minRocketMassKg)
        : stageProfiles.reduce((sum, stage) => sum + stage.dryMassKg, 0),
      propellantKg: launchMode === "orbit_inject"
        ? Math.max(0, Number(injectedStage?.propellantMassKg) || 0)
        : stageProfiles.reduce((sum, stage) => sum + stage.propellantMassKg, 0),
      tliDurationSec: FLEET_MOON_TLI_DURATION_SEC,
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
      refuelTargetLockId: "",
      refuelTargetLockAcquiredSec: 0,
      refuelSpeedBrakeState: {
        active: false,
        activeSec: 0,
        stableSec: 0,
      },
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
      vehicle.refuelSpeedBrakeState = {
        active: false,
        activeSec: 0,
        stableSec: 0,
      };
    }
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
    }
    if (phaseName === "tli_burn") {
      vehicle.moonProjectedMissTrendKmS = null;
      vehicle.moonPrevProjectedMissDistanceKm = null;
      vehicle.moonGoNoGoStatus = "n/a";
      vehicle.moonGoNoGoReason = "";
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
        orbitalRefuelTarget = target;
        if (!target || !target.relativePositionKm) {
          requestedThrottle = 0;
          desiredDirection = prograde;
          guidanceMode = "navsys:orbital-refuel-await-target";
        } else {
          decisionTargetBodyId = String(target.tankerId || "refuel_tanker");
          decisionTargetBodyName = "Refuel Tanker";
          const directionToTarget = normalize(target.relativePositionKm, prograde);
          const directionHorizontal = normalize(
            subtract(directionToTarget, scale(up, dot(directionToTarget, up))),
            prograde,
          );
          const targetMinusShipRelVel = target.relativeVelocityKmS || { x: 0, y: 0, z: 0 };
          const shipMinusTargetRelVel = scale(targetMinusShipRelVel, -1);
          const refuelDistanceKm = Number(target.distanceKm);
          const refuelRelativeSpeedKmS = Math.max(0, Number(target.relativeSpeedKmS) || 0);
          const refuelClosingSpeedKmS = Number(target.closingSpeedKmS);
          const targetAltitudeKm = Number(target.altitudeKm);
          const radialSpeedKmS = Number(orbital?.radialSpeedKmS) || 0;
          const periapsisNowKm = Number(orbital?.periapsisKm);
          const apoapsisNowKm = Number(orbital?.apoapsisKm);
          const nearApoapsisForRecoveryBurn = Number.isFinite(timeToApoapsisSec)
            && Math.abs(timeToApoapsisSec) < FLEET_REFUEL_RECOVERY_BURN_WINDOW_SEC;
          const speedNowKmS = Math.max(0, Number(orbital?.speedKmS) || length(relVel));
          const circularSpeedKmS = Math.max(0.001, Number(orbital?.circularSpeedKmS) || 7.8);
          const speedExcessKmS = speedNowKmS - circularSpeedKmS;
          const recoveryEnter = Number.isFinite(periapsisNowKm)
            && (periapsisNowKm < 120 || (periapsisNowKm < 142 && radialSpeedKmS < -0.0018));
          const recoveryExit = Number.isFinite(periapsisNowKm)
            && periapsisNowKm >= FLEET_REFUEL_RECOVERY_EXIT_PERIAPSIS_KM
            && radialSpeedKmS >= FLEET_REFUEL_RECOVERY_EXIT_RADIAL_MIN_KM_S;
          if (!vehicle.refuelOrbitRecovery || typeof vehicle.refuelOrbitRecovery !== "object") {
            vehicle.refuelOrbitRecovery = {
              active: false,
              stableSec: 0,
              activeSec: 0,
            };
          }
          if (!vehicle.refuelOrbitRecovery.active && recoveryEnter) {
            vehicle.refuelOrbitRecovery.active = true;
            vehicle.refuelOrbitRecovery.stableSec = 0;
            vehicle.refuelOrbitRecovery.activeSec = 0;
          }
          if (vehicle.refuelOrbitRecovery.active) {
            vehicle.refuelOrbitRecovery.activeSec = Math.max(
              0,
              Number(vehicle.refuelOrbitRecovery.activeSec) || 0,
            ) + safeDtSeconds;
            if (recoveryExit) {
              vehicle.refuelOrbitRecovery.stableSec = Math.max(
                0,
                Number(vehicle.refuelOrbitRecovery.stableSec) || 0,
              ) + safeDtSeconds;
            } else {
              vehicle.refuelOrbitRecovery.stableSec = 0;
            }
            if (
              (Number(vehicle.refuelOrbitRecovery.stableSec) || 0) >= 14
              || (Number(vehicle.refuelOrbitRecovery.activeSec) || 0) >= 600
            ) {
              vehicle.refuelOrbitRecovery.active = false;
              vehicle.refuelOrbitRecovery.stableSec = 0;
              vehicle.refuelOrbitRecovery.activeSec = 0;
            }
          }
          const recoveryActive = Boolean(vehicle.refuelOrbitRecovery.active);
          const closeRangeRecoveryBypass = recoveryActive
            && Number.isFinite(periapsisNowKm)
            && periapsisNowKm >= FLEET_REFUEL_RECOVERY_CLOSE_RANGE_MIN_PERIAPSIS_KM
            && Number.isFinite(refuelDistanceKm)
            && refuelDistanceKm > 0
            && refuelDistanceKm <= FLEET_REFUEL_RECOVERY_CLOSE_RANGE_DISTANCE_KM
            && refuelRelativeSpeedKmS <= FLEET_REFUEL_RECOVERY_CLOSE_RANGE_REL_SPEED_KM_S
            && (
              !Number.isFinite(refuelClosingSpeedKmS)
              || Math.abs(refuelClosingSpeedKmS) <= (FLEET_REFUEL_RECOVERY_CLOSE_RANGE_REL_SPEED_KM_S * 1.25)
            )
            && radialSpeedKmS >= -0.0035;
          if (!vehicle.refuelSpeedBrakeState || typeof vehicle.refuelSpeedBrakeState !== "object") {
            vehicle.refuelSpeedBrakeState = {
              active: false,
              activeSec: 0,
              stableSec: 0,
            };
          }
          const brakeEnterApoGateKm = Number.isFinite(targetAltitudeKm)
            ? Math.max(targetAltitudeKm + FLEET_REFUEL_SPEED_BRAKE_ENTER_APO_BUFFER_KM, 460)
            : 700;
          const brakeExitApoGateKm = Number.isFinite(targetAltitudeKm)
            ? Math.max(targetAltitudeKm + FLEET_REFUEL_SPEED_BRAKE_EXIT_APO_BUFFER_KM, 430)
            : 640;
          const highEnergyEnter = (
            speedExcessKmS > FLEET_REFUEL_SPEED_BRAKE_ENTER_EXCESS_KM_S
            || (
              Number.isFinite(apoapsisNowKm)
              && apoapsisNowKm > brakeEnterApoGateKm
            )
          );
          const highEnergyExitCandidate = (
            speedExcessKmS <= FLEET_REFUEL_SPEED_BRAKE_EXIT_EXCESS_KM_S
            && (
              !Number.isFinite(apoapsisNowKm)
              || apoapsisNowKm <= brakeExitApoGateKm
            )
          );
          if (!vehicle.refuelSpeedBrakeState.active && highEnergyEnter) {
            vehicle.refuelSpeedBrakeState.active = true;
            vehicle.refuelSpeedBrakeState.activeSec = 0;
            vehicle.refuelSpeedBrakeState.stableSec = 0;
          }
          if (vehicle.refuelSpeedBrakeState.active) {
            vehicle.refuelSpeedBrakeState.activeSec = Math.max(
              0,
              Number(vehicle.refuelSpeedBrakeState.activeSec) || 0,
            ) + safeDtSeconds;
            if (highEnergyExitCandidate) {
              vehicle.refuelSpeedBrakeState.stableSec = Math.max(
                0,
                Number(vehicle.refuelSpeedBrakeState.stableSec) || 0,
              ) + safeDtSeconds;
            } else {
              vehicle.refuelSpeedBrakeState.stableSec = 0;
            }
            if (
              (Number(vehicle.refuelSpeedBrakeState.activeSec) || 0) >= FLEET_REFUEL_SPEED_BRAKE_MIN_HOLD_SEC
              && (Number(vehicle.refuelSpeedBrakeState.stableSec) || 0) >= FLEET_REFUEL_SPEED_BRAKE_EXIT_STABLE_SEC
            ) {
              vehicle.refuelSpeedBrakeState.active = false;
              vehicle.refuelSpeedBrakeState.activeSec = 0;
              vehicle.refuelSpeedBrakeState.stableSec = 0;
            }
          }
          const highEnergyRisk = Boolean(vehicle.refuelSpeedBrakeState.active) || highEnergyEnter;
          let plannerRcsProfile = "";
          let plannerRcsTranslationHint = false;
          let plannerMainEngineHint = false;
          const rcsAssistEnabled = refuelDistanceKm <= Math.max(2, (Number(REFUEL_TANKER_CONFIG.dockDistanceKm) || 0.014) * 120);
          if (rcsAssistEnabled) {
            const closeRange = refuelDistanceKm <= 1.5;
            const midRange = refuelDistanceKm <= 15;
            const responseSec = closeRange ? 70 : (midRange ? 120 : 180);
            const maxApproachSpeedKmS = closeRange ? 0.00026 : (midRange ? 0.0018 : 0.006);
            const maxRcsAccelKmS2 = closeRange
              ? 0.000022
              : (midRange ? 0.000008 : 0.0000022);
            const desiredClosureSpeedKmS = refuelDistanceKm > 1e-9
              ? Math.min(maxApproachSpeedKmS, refuelDistanceKm / Math.max(1, responseSec))
              : 0;
            const desiredShipMinusTargetRelVel = refuelDistanceKm > 1e-9
              ? scale(directionToTarget, desiredClosureSpeedKmS)
              : { x: 0, y: 0, z: 0 };
            const velocityErrorKmS = subtract(desiredShipMinusTargetRelVel, shipMinusTargetRelVel);
            const commandedAccelKmS2Raw = scale(velocityErrorKmS, 1 / Math.max(1, responseSec));
            rcsAssistAccelKmS2 = clampVectorMagnitude(commandedAccelKmS2Raw, maxRcsAccelKmS2);
            const rcsAccelMagKmS2 = length(rcsAssistAccelKmS2);
            rcsAssistMode = closeRange ? "rcs-dock-assist-fine" : "rcs-dock-assist";
            rcsAssistAuthority = clamp(rcsAccelMagKmS2 / Math.max(maxRcsAccelKmS2, 1e-9), 0, 1);
            rcsAssistJets = rcsJetsFromAccel({
              accelKmS2: rcsAssistAccelKmS2,
              prograde,
              up,
              thresholdKmS2: Math.max(1e-8, maxRcsAccelKmS2 * 0.14),
            });
          }
          const dockDistanceKm = Number(REFUEL_TANKER_CONFIG.dockDistanceKm) || 0.014;
          const dockSpeedKmS = Number(REFUEL_TANKER_CONFIG.dockMaxRelativeSpeedKmS) || 0.000045;
          const refuelRcsOnlyDistanceKm = Math.max(
            dockDistanceKm * 8,
            Number(NAVIGATION_DEFAULTS?.planner?.refuelRcsOnlyDistanceKm)
              || Number(REFUEL_TANKER_CONFIG.refuelRcsOnlyDistanceKm)
              || 1.2,
          );
          if (
            refuelDistanceKm <= (dockDistanceKm * 1.25)
            && refuelRelativeSpeedKmS <= (dockSpeedKmS * 1.2)
          ) {
            requestedThrottle = 0;
            desiredDirection = prograde;
            guidanceMode = "navsys:orbital-refuel-lock";
          } else if (
            recoveryActive
            && !FLEET_REFUEL_DEMO_BYPASS_ORBIT_RECOVERY
            && !closeRangeRecoveryBypass
          ) {
            // Recovery is phase-aware: burn near apoapsis, but allow immediate guard burns
            // when periapsis/altitude are collapsing to prevent reentry while waiting.
            const periapsisDeficitKm = Number.isFinite(periapsisNowKm)
              ? Math.max(0, 150 - periapsisNowKm)
              : 0;
            const recoveryNeedsBurn = periapsisDeficitKm > 0.2;
            const immediateGuardBurn = recoveryNeedsBurn && (
              (
                Number.isFinite(periapsisNowKm)
                && periapsisNowKm <= FLEET_REFUEL_RECOVERY_IMMEDIATE_BURN_PERIAPSIS_KM
              )
              || (
                Number.isFinite(altitudeKm)
                && altitudeKm <= FLEET_REFUEL_RECOVERY_IMMEDIATE_BURN_ALTITUDE_KM
                && radialSpeedKmS < -0.0008
              )
            );
            const recoveryBurnNow = recoveryNeedsBurn && (nearApoapsisForRecoveryBurn || immediateGuardBurn);
            if (recoveryBurnNow) {
              const guardActive = immediateGuardBurn && !nearApoapsisForRecoveryBurn;
              const throttleBase = guardActive
                ? FLEET_REFUEL_RECOVERY_IMMEDIATE_BURN_THROTTLE_BASE
                : 0.18;
              const throttleMax = guardActive
                ? FLEET_REFUEL_RECOVERY_IMMEDIATE_BURN_THROTTLE_MAX
                : 0.42;
              requestedThrottle = clamp(
                throttleBase + (periapsisDeficitKm / 90),
                throttleBase,
                throttleMax,
              );
              if (guardActive) {
                const upBias = clamp(
                  FLEET_REFUEL_RECOVERY_IMMEDIATE_BURN_UP_BIAS
                  + (Math.max(0, -radialSpeedKmS) * 18),
                  0.12,
                  0.32,
                );
                desiredDirection = normalize(
                  add(
                    scale(prograde, 1 - upBias),
                    scale(up, upBias),
                  ),
                  prograde,
                );
                guidanceMode = "navsys:orbital-refuel-orbit-recovery-guard-burn";
              } else {
                desiredDirection = prograde;
                guidanceMode = "navsys:orbital-refuel-orbit-recovery-burn";
              }
            } else {
              requestedThrottle = 0;
              desiredDirection = prograde;
              guidanceMode = "navsys:orbital-refuel-orbit-recovery-coast";
            }
          } else if (highEnergyRisk && refuelDistanceKm > refuelRcsOnlyDistanceKm) {
            // Brake retrograde near periapsis to reduce apoapsis growth; coast otherwise.
            const nearPeriapsisForBrake = Number.isFinite(periapsisNowKm)
              && Number.isFinite(altitudeKm)
              && Math.abs(altitudeKm - periapsisNowKm) <= 35;
            if (nearPeriapsisForBrake) {
              requestedThrottle = clamp(0.14 + Math.max(0, speedExcessKmS * 0.48), 0.14, 0.44);
              desiredDirection = normalize(
                add(
                  scale(prograde, -0.9),
                  scale(directionHorizontal, 0.1),
                ),
                scale(prograde, -1),
              );
              guidanceMode = "navsys:orbital-refuel-speed-brake";
            } else {
              requestedThrottle = 0;
              desiredDirection = prograde;
              guidanceMode = "navsys:orbital-refuel-speed-brake-coast-to-peri";
            }
          } else {
            const plannerCommand = planRefuelRendezvousCommand({
              targetVectors: {
                tangent: prograde,
                toRefuelTarget: target.relativePositionKm,
                refuelTargetRelativeVelocityKmS: targetMinusShipRelVel,
              },
              metrics: {
                refuelTargetDistanceKm: refuelDistanceKm,
                refuelRelativeSpeedKmS,
                refuelClosingSpeedKmS,
              },
              tangent: prograde,
              plannerConfig: NAVIGATION_DEFAULTS.planner,
            });
            plannerRcsProfile = String(plannerCommand?.rcsAssistProfile || "").trim();
            plannerRcsTranslationHint = Boolean(plannerCommand?.actuators?.rcsTranslation);
            plannerMainEngineHint = Boolean(plannerCommand?.actuators?.mainEngine);
            requestedThrottle = plannerCommand?.phase === "powered"
              ? clamp(Number(plannerCommand?.throttle) || 0, 0, 1)
              : 0;
            desiredDirection = normalize(
              plannerCommand?.direction
                || (plannerCommand?.phase === "powered" ? directionToTarget : prograde),
              prograde,
            );
            guidanceMode = String(plannerCommand?.mode || "navsys:orbital-refuel-await-target");
            if (guidanceMode === "navsys:orbital-refuel-docked-hold") {
              requestedThrottle = 0;
              desiredDirection = prograde;
              guidanceMode = "navsys:orbital-refuel-lock";
            } else if (closeRangeRecoveryBypass) {
              guidanceMode = `${guidanceMode}:periapsis-guard-pass`;
            }
          }
          if (
            refuelDistanceKm <= refuelRcsOnlyDistanceKm
            && requestedThrottle > 1e-4
            && !guidanceMode.includes("orbit-recovery")
          ) {
            requestedThrottle = 0;
            guidanceMode = `${guidanceMode}:rcs-only-final`;
          }
          const closeProximityMode = guidanceMode.includes("orbital-refuel-final-approach")
            || guidanceMode.includes("orbital-refuel-rcs-translate")
            || guidanceMode.includes("orbital-refuel-lock")
            || guidanceMode.includes("orbital-refuel-docked");
          const preserveRcsAssist = (
            closeProximityMode
            || plannerRcsTranslationHint
            || refuelDistanceKm <= Math.max(2, dockDistanceKm * 140)
          ) && (
            requestedThrottle <= 0.08
            || !plannerMainEngineHint
          );
          if (!preserveRcsAssist) {
            rcsAssistAccelKmS2 = { x: 0, y: 0, z: 0 };
            rcsAssistAuthority = 0;
            rcsAssistJets = [];
            rcsAssistMode = "";
          } else if (rcsAssistAuthority > 1e-8) {
            if (plannerRcsProfile === "fine" || closeProximityMode) {
              const fineLimitKmS2 = 0.000018;
              rcsAssistAccelKmS2 = clampVectorMagnitude(rcsAssistAccelKmS2, fineLimitKmS2);
              rcsAssistMode = "rcs-dock-assist-fine";
              rcsAssistAuthority = clamp(length(rcsAssistAccelKmS2) / fineLimitKmS2, 0, 1);
              rcsAssistJets = rcsJetsFromAccel({
                accelKmS2: rcsAssistAccelKmS2,
                prograde,
                up,
                thresholdKmS2: Math.max(1e-8, fineLimitKmS2 * 0.14),
              });
            } else if (plannerRcsProfile === "coarse") {
              const coarseLimitKmS2 = 0.000011;
              rcsAssistAccelKmS2 = clampVectorMagnitude(rcsAssistAccelKmS2, coarseLimitKmS2);
              rcsAssistMode = "rcs-dock-assist-coarse";
              rcsAssistAuthority = clamp(length(rcsAssistAccelKmS2) / coarseLimitKmS2, 0, 1);
              rcsAssistJets = rcsJetsFromAccel({
                accelKmS2: rcsAssistAccelKmS2,
                prograde,
                up,
                thresholdKmS2: Math.max(1e-8, coarseLimitKmS2 * 0.14),
              });
            }
          }
        }
      } else if (vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN && !vehicle.missionCompleted) {
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
        const moonProjectedMissDistanceKm = finiteVector(toMoonVectorKm)
          && finiteVector(moonMinusShipRelativeVelocityKmS)
          ? projectedClosestApproachDistanceKm(toMoonVectorKm, moonMinusShipRelativeVelocityKmS)
          : Number.POSITIVE_INFINITY;
        const previousProjectedMissKm = Number(vehicle.moonPrevProjectedMissDistanceKm);
        const moonProjectedMissTrendKmS = (
          Number.isFinite(moonProjectedMissDistanceKm)
          && Number.isFinite(previousProjectedMissKm)
          && safeDtSeconds > 1e-6
        )
          ? ((moonProjectedMissDistanceKm - previousProjectedMissKm) / safeDtSeconds)
          : Number.NaN;
        vehicle.moonProjectedMissTrendKmS = finiteOrNull(moonProjectedMissTrendKmS);
        if (Number.isFinite(moonProjectedMissDistanceKm)) {
          vehicle.moonPrevProjectedMissDistanceKm = moonProjectedMissDistanceKm;
        } else {
          vehicle.moonPrevProjectedMissDistanceKm = null;
        }
        const earthDistanceKm = Math.max(0, length(relPos));
        const earthRadialSpeedKmS = earthDistanceKm > 1e-6
          ? dot(relPos, relVel) / earthDistanceKm
          : 0;
        const moonRefuelTarget = vehicle.missionPhase === "orbital_refuel"
          ? selectLockedTankerTargetForVehicle(vehicle, state, shipState, earthState)
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
              shipMinusMoonRelativeVelocityKmS: moonRelVel || null,
              moonMinusShipRelativeVelocityKmS,
              toRefuelTarget: moonRefuelTarget?.relativePositionKm || null,
              refuelTargetRelativeVelocityKmS: moonRefuelTarget?.relativeVelocityKmS || null,
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
              moonProjectedMissDistanceKm,
              moonProjectedMissTrendKmS,
              moonProjectedPeriluneAltitudeKm: vehicle.moonProjectedPeriluneAltitudeKm,
              moonBPlaneErrorKm: vehicle.moonBPlaneErrorKm,
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
            : null,
          moonDepartureWindowWaitSec: vehicle.moonDepartureWindowWaitSec,
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
                periapsisKm: Number(moonGoNoGo?.diagnostics?.periapsisKm),
                altitudeKm: Number(moonGoNoGo?.diagnostics?.altitudeKm),
                radialSpeedKmS: Number(orbital?.radialSpeedKmS),
                prograde,
                up,
                availablePropellantKg,
                reasonPrefix: moonGoNoGo.reason,
              })
              : null;
            if (survivalRecovery) {
              requestedThrottle = clamp(Number(survivalRecovery.throttle) || 0, 0, 1);
              desiredDirection = normalize(survivalRecovery.direction || prograde, prograde);
              guidanceMode = `${String(survivalRecovery.mode || "navsys:moon-survival-periapsis-recovery")}:go-no-go-survival-recovery`;
              vehicle.moonGoNoGoReason = String(survivalRecovery.gateReason || moonGoNoGo.reason);
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
      const qAlphaSteering = applyQAlphaSteeringLimit({
        desiredDirection,
        relAirVelocityKmS,
        dynamicPressurePa,
        bodyKind,
      });
      desiredDirection = qAlphaSteering.direction;
      requestedThrottle = limitThrottleByQAlpha({
        throttle: requestedThrottle,
        qAlphaPaRad: qAlphaSteering.qAlphaPaRad,
        bodyKind,
      });
      if (
        qAlphaSteering.limited
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
      let moonAttitudeGateApplied = false;
      const moonAttitudeGateEligible = (
        availablePropellantKg > 1e-6
        && requestedThrottleCommand > 1e-3
        && vehicle.vehicleRole !== "tanker"
        && vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
        && FLEET_MOON_BURN_ATTITUDE_GATE_PHASES.has(String(vehicle.missionPhase || ""))
      );
      if (moonAttitudeGateEligible || vehicle.moonBurnAttitudeGateActive) {
        const currentAxis = normalize(
          vehicle.stageActuator?.directionActual || desiredDirection,
          desiredDirection,
        );
        const attitudeErrorDeg = degrees(angleBetweenRadians(currentAxis, desiredDirection));
        const gateWasActive = Boolean(vehicle.moonBurnAttitudeGateActive);
        const shouldGate = gateWasActive
          ? attitudeErrorDeg > MOON_BURN_ATTITUDE_GATE_EXIT_ERROR_DEG
          : attitudeErrorDeg > MOON_BURN_ATTITUDE_GATE_ENTER_ERROR_DEG;
        if (shouldGate && availablePropellantKg > 1e-6) {
          throttleCommand = 0;
          moonAttitudeGateApplied = true;
        }
      }
      vehicle.moonBurnAttitudeGateActive = moonAttitudeGateApplied;
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
      if (moonAttitudeGateApplied && !guidanceMode.includes("attitude-align")) {
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
        const moonProjectedMissDistanceKm = finiteVector(toMoonVectorKm)
          && finiteVector(moonMinusShipRelativeVelocityKmS)
          ? projectedClosestApproachDistanceKm(toMoonVectorKm, moonMinusShipRelativeVelocityKmS)
          : Number.POSITIVE_INFINITY;
        const moonProjectedPeriluneAltitudeKm = Number.isFinite(Number(vehicle.moonProjectedPeriluneAltitudeKm))
          ? Number(vehicle.moonProjectedPeriluneAltitudeKm)
          : (
            Number.isFinite(moonProjectedMissDistanceKm)
              ? moonProjectedMissDistanceKm - moonRadiusKm
              : Number.POSITIVE_INFINITY
          );
        const moonBPlaneErrorKm = Number.isFinite(Number(vehicle.moonBPlaneErrorKm))
          ? Number(vehicle.moonBPlaneErrorKm)
          : moonProjectedMissDistanceKm;

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
            fallbackDurationSec: FLEET_MOON_TLI_DURATION_SEC,
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
        moonEstimatedTliDeltaVKmS: null,
        moonDepartureWindowReady: false,
        moonDepartureWindowLaunchTimeMs: null,
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
    const moonProjectedPeriluneAltitudeKm = finiteOrNull(vehicle.moonProjectedPeriluneAltitudeKm);
    const moonBPlaneErrorKm = finiteOrNull(vehicle.moonBPlaneErrorKm);
    const earthDistanceKm = length(relPos);
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
      moonProjectedMissDistanceKm = Number.isFinite(projectedMiss) ? projectedMiss : null;
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
    const transferActive = Boolean(runtime?.refuel?.transferActive);
    const transferTankerId = String(runtime?.refuel?.transferTankerId || "");
    const refuelTransferProgress = clamp(Number(runtime?.refuel?.transferProgress) || 0, 0, 1);
    const refuelTransferRemainingKg = Math.max(0, Number(runtime?.refuel?.transferRemainingKg) || 0);
    const refuelTransferRateKgS = Math.max(0, Number(runtime?.refuel?.transferRateKgS) || 0);
    const fuelingActiveForBody = vehicleKind === "tanker"
      && transferActive
      && transferTankerId === vehicle.id;
    const baseGuidanceMode = vehicle.guidanceMode || vehicle.lastStep?.guidanceMode || "autopilot-orbital-hold";
    const guidanceMode = flightRcsMode
      ? `${baseGuidanceMode}:${flightRcsMode}`
      : baseGuidanceMode;
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
      phaseLabel: phaseLabelFn(phase),
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
      refuelTransferLocked: transferActive,
      refuelUndockActive: Boolean(runtime?.refuel?.undockActive),
      refuelFuelingActive: fuelingActiveForBody,
      refuelLastAction: "",
      refuelLastActionTimeSec: 0,
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
      moonRelativeSpeedKmS,
      moonProjectedMissDistanceKm,
      moonProjectedMissTrendKmS: finiteOrNull(vehicle.moonProjectedMissTrendKmS),
      moonProjectedPeriluneAltitudeKm,
      moonBPlaneErrorKm,
      moonDepartureWindowScore: finiteOrNull(vehicle.moonDepartureWindowScore),
      moonDepartureWindowWaitSec: finiteOrNull(vehicle.moonDepartureWindowWaitSec),
      moonDepartureWindowPhaseErrorDeg: finiteOrNull(vehicle.moonDepartureWindowPhaseErrorDeg),
      moonDepartureGeometryScore: finiteOrNull(vehicle.moonDepartureGeometryScore),
      moonDepartureAlignNow: finiteOrNull(vehicle.moonDepartureAlignNow),
      moonDepartureAlignProjected: finiteOrNull(vehicle.moonDepartureAlignProjected),
      moonEstimatedTliDeltaVKmS: finiteOrNull(vehicle.moonEstimatedTliDeltaVKmS),
      moonDepartureWindowReady: Number.isFinite(Number(vehicle.moonDepartureWindowWaitSec))
        ? Number(vehicle.moonDepartureWindowWaitSec) <= 1
        : false,
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
