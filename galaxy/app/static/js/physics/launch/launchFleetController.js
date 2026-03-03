import {
  EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
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
import { orbitalStateFromRelative } from "./launchGuidance.js";
import { dynamicPressurePaFromAtmosphere } from "./launchAeroModel.js";
import { enforceMoonEarthAvoidanceDirection } from "./lunar/guidanceSafety.js";
import {
  moonWindowInjectPhaseAngleRad,
  normalizeAngleZeroToTau,
} from "./lunar/windowTargeting.js";
import { isFlightDockingEligible } from "./refuel/availability.js";
import { REFUEL_TANKER_CONFIG } from "./refuel/config.js";
import {
  computePhaseCatchupCommand,
  orbitalRelativeFrame,
} from "./refuel/missionShipRendezvous.js";
import {
  estimateMoonRoundTripFuelBudget,
  estimateOrbitalRefuelDemoFuelBudget,
} from "./missionFuelBudget.js";
import {
  FLEET_MISSION_SHIP_ID_PREFIX,
  FLEET_MOON_CAPTURE_GATE_DISTANCE_KM,
  FLEET_MOON_TLI_DURATION_SEC,
} from "./launchFleetConfig.js";

const FLEET_MOON_APPROACH_DISTANCE_KM = 120_000;
const FLEET_MOON_MIDCOURSE_MIN_CLOSING_SPEED_KM_S = 0.02;
const FLEET_MOON_MIDCOURSE_CLOSING_WINDOW_KM_S = 0.18;
const FLEET_MOON_MIDCOURSE_THROTTLE_BASE = 0.22;
const FLEET_MOON_MIDCOURSE_THROTTLE_MAX = 0.78;
const FLEET_MOON_MIDCOURSE_MISS_DISTANCE_KM = 95_000;
const FLEET_MOON_MIDCOURSE_PREDICT_HORIZON_SEC = 36 * 3600;
const FLEET_MOON_EARTH_FALLBACK_RADIAL_SPEED_KM_S = -0.01;
const FLEET_MOON_SENSOR_FILTER_TIME_CONSTANT_SEC = 24;
const FLEET_MOON_MIDCOURSE_MIN_BURN_SEC = 24;
const FLEET_MOON_MIDCOURSE_EXIT_STABLE_SEC = 28;
const FLEET_TLI_PERIAPSIS_PROTECT_MIN_KM = 130;
const FLEET_TLI_PERIAPSIS_RECOVER_TARGET_KM = 155;
const FLEET_ORBITAL_REFUEL_DEMO_STAGE2_MIN_PROPELLANT_KG = 1_650_000;
const FLEET_ORBITAL_REFUEL_DEMO_MARGIN_CONSERVE_KG = 90_000;
const FLEET_ORBITAL_REFUEL_DEMO_MARGIN_SOFT_DEFICIT_KG = -8_000;
const FLEET_ORBITAL_REFUEL_DEMO_MARGIN_HARD_HOLD_KG = -30_000;
const FLEET_MOON_MISSION_STAGE2_MIN_PROPELLANT_KG = 2_600_000;
const FLEET_MOON_MISSION_MARGIN_CONSERVE_KG = 220_000;
const FLEET_MOON_MISSION_MARGIN_CRITICAL_KG = 120_000;
const FLEET_MOON_REFUEL_TARGET_FILL_FRACTION = 0.88;
const FLEET_TLI_TARGET_APOAPSIS_KM = 382_000;
const FLEET_TLI_TARGET_APOAPSIS_MARGIN_KM = 3_000;
const FLEET_TEI_DEPARTURE_DISTANCE_KM = 140_000;
const FLEET_EARTH_CAPTURE_DISTANCE_KM = 180_000;
const FLEET_EARTH_CAPTURE_APOAPSIS_MAX_KM = 75_000;
const FLEET_EARTH_CAPTURE_PERIAPSIS_MIN_KM = 120;
const FLEET_MOONWARD_TARGET_PHASES = new Set([
  "launch_to_parking",
  "orbital_refuel",
  "tli_burn",
  "coast_to_moon",
  "lunar_capture",
  "lunar_orbit_hold",
]);

function finiteVector(v) {
  return Boolean(
    v
    && Number.isFinite(Number(v.x))
    && Number.isFinite(Number(v.y))
    && Number.isFinite(Number(v.z)),
  );
}

function bodyStateFromNBody(state, bodyId) {
  return state?.dynamicBodies?.get(bodyId)
    || state?.staticSources?.get(bodyId)
    || null;
}

function fleetMissionNameForId(missionId) {
  return missionProfileById(normalizeMissionId(missionId))?.name || "Earth Orbit Hold";
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
    return "Awaiting parking orbit gate: apo/peri >= 180 km / 150 km.";
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
    const tliDurationSec = Math.max(60, Number(vehicle.tliDurationSec) || FLEET_MOON_TLI_DURATION_SEC);
    const phaseElapsedSec = Math.max(0, Number(vehicle.phaseElapsedSec) || 0);
    const periapsisKm = Number(orbital?.periapsisKm);
    const fuelBudget = vehicle.fuelBudget && typeof vehicle.fuelBudget === "object"
      ? vehicle.fuelBudget
      : null;
    const fuelBudgetFeasible = fuelBudget ? Boolean(fuelBudget.feasible) : null;
    const fuelMarginKg = Number(fuelBudget?.marginKg);
    const fuelBudgetLabel = fuelBudgetFeasible === null
      ? "pending"
      : (fuelBudgetFeasible ? "feasible" : "deficit");
    const fuelMarginLabel = Number.isFinite(fuelMarginKg)
      ? ` (${formatFleetGateMassKg(fuelMarginKg)})`
      : "";
    return `Awaiting TLI gate: t=${Math.round(phaseElapsedSec)}s / ${Math.round(tliDurationSec)}s, periapsis >= ${formatFleetGateKm(FLEET_TLI_PERIAPSIS_PROTECT_MIN_KM)}, fuel budget ${fuelBudgetLabel}${fuelMarginLabel}.`;
  }
  if (phase === "coast_to_moon") {
    return `Awaiting lunar approach: distance ${formatFleetGateKm(moonDistanceKm)} <= ${formatFleetGateKm(FLEET_MOON_APPROACH_DISTANCE_KM)} (closing ${formatFleetGateSpeed(moonClosingSpeedKmS)}).`;
  }
  if (phase === "lunar_capture") {
    return `Awaiting lunar capture orbit: rel speed ${formatFleetGateSpeed(moonRelativeSpeedKmS)} | miss ${formatFleetGateKm(moonProjectedMissDistanceKm)}.`;
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

function updateMoonSensorEstimate(vehicle, measurement = {}, dtSeconds = 0, nowMs = Date.now()) {
  if (!vehicle || !measurement) {
    return null;
  }
  const rawDistanceKm = Number(measurement.distanceKm);
  const rawClosingSpeedKmS = Number(measurement.closingSpeedKmS);
  const rawProjectedMissKm = Number(measurement.projectedMissKm);
  const rawDirection = finiteVector(measurement.direction)
    ? normalize(measurement.direction, { x: 1, y: 0, z: 0 })
    : null;
  if (!Number.isFinite(rawDistanceKm) || !Number.isFinite(rawClosingSpeedKmS) || !rawDirection) {
    return null;
  }
  const safeProjectedMissKm = Number.isFinite(rawProjectedMissKm)
    ? rawProjectedMissKm
    : rawDistanceKm;
  const safeDtSeconds = Math.max(0, Number(dtSeconds) || 0);
  const tauSec = Math.max(1, Number(FLEET_MOON_SENSOR_FILTER_TIME_CONSTANT_SEC) || 24);
  const alpha = clamp(safeDtSeconds / (tauSec + safeDtSeconds), 0.04, 0.82);
  const previous = vehicle.moonSensorEstimate && typeof vehicle.moonSensorEstimate === "object"
    ? vehicle.moonSensorEstimate
    : null;
  if (!previous) {
    vehicle.moonSensorEstimate = {
      distanceKm: rawDistanceKm,
      closingSpeedKmS: rawClosingSpeedKmS,
      projectedMissKm: safeProjectedMissKm,
      direction: rawDirection,
      updatedAtMs: nowMs,
    };
    return vehicle.moonSensorEstimate;
  }
  const previousDirection = finiteVector(previous.direction)
    ? normalize(previous.direction, rawDirection)
    : rawDirection;
  const previousDistanceKm = Number.isFinite(Number(previous.distanceKm))
    ? Number(previous.distanceKm)
    : rawDistanceKm;
  const previousClosingSpeedKmS = Number.isFinite(Number(previous.closingSpeedKmS))
    ? Number(previous.closingSpeedKmS)
    : rawClosingSpeedKmS;
  const previousProjectedMissKm = Number.isFinite(Number(previous.projectedMissKm))
    ? Number(previous.projectedMissKm)
    : safeProjectedMissKm;
  const blendedDirection = normalize(
    add(
      scale(previousDirection, 1 - alpha),
      scale(rawDirection, alpha),
    ),
    rawDirection,
  );
  vehicle.moonSensorEstimate = {
    distanceKm: previousDistanceKm + ((rawDistanceKm - previousDistanceKm) * alpha),
    closingSpeedKmS: previousClosingSpeedKmS
      + ((rawClosingSpeedKmS - previousClosingSpeedKmS) * alpha),
    projectedMissKm: previousProjectedMissKm
      + ((safeProjectedMissKm - previousProjectedMissKm) * alpha),
    direction: blendedDirection,
    updatedAtMs: nowMs,
  };
  return vehicle.moonSensorEstimate;
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

  function nearestEligibleTankerTarget(state, shipState, earthState) {
    if (
      !state?.dynamicBodies
      || !shipState
      || !earthState
      || !finiteVector(shipState.position)
      || !finiteVector(shipState.velocity || { x: 0, y: 0, z: 0 })
      || !finiteVector(earthState.position)
      || !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      return null;
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
    let best = null;
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
        interceptScore,
      };
      if (!best || candidate.interceptScore < best.interceptScore) {
        best = candidate;
      }
    }
    return best;
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
    const launchRadiusKm =
      earthRadiusKm
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
  }) {
    const earthRadiusKm = Math.max(1000, Number(getEarthRadiusKm?.()) || 6371);
    const muKm3S2 = Number(gravitationalConstantKm3PerKgS2) * (Number(getEarthMassKg?.()) || 0);
    if (!(muKm3S2 > 0)) {
      return null;
    }
    const targetAltitudeKm = Math.max(120, Number(orbitAltitudeKm) || 150);
    const orbitRadiusKm = earthRadiusKm + targetAltitudeKm;
    const circularSpeedKmS = Math.sqrt(muKm3S2 / orbitRadiusKm);
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
    const relVelocityKmS = scale(relVelocityDirection, circularSpeedKmS);
    return {
      position: add(earthState.position, relPositionKm),
      velocity: add(earthState.velocity || { x: 0, y: 0, z: 0 }, relVelocityKmS),
      orbitAltitudeKm: targetAltitudeKm,
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
    const moonWindowInjectPhaseRad = (
      launchMode === "orbit_inject"
      && vehicleRole !== "tanker"
      && normalizedMissionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
    )
      ? moonWindowInjectPhaseAngleRad({
        earthState,
        moonState: bodyStateFromNBody(state, "moon"),
        inclinationDeg: Number(LAUNCH_SITE.latitudeDeg) || 28.5,
      })
      : Number.NaN;
    const orbitInjectPhaseAngleRad = (
      launchMode === "orbit_inject"
      && vehicleRole !== "tanker"
      && normalizedMissionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
    )
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
    const spawnState = launchMode === "orbit_inject"
      ? fleetOrbitInjectState({
        earthState,
        orbitAltitudeKm: Number(options?.orbitInjectAltitudeKm) || 150,
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
      moonEarthGuardActive: false,
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
    if (phaseName !== "coast_to_moon") {
      vehicle.moonMidcourseControl = null;
    }
    if (phaseName === "tli_burn") {
      vehicle.moonSensorEstimate = null;
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
      const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
        atmosphereSample,
        relPos,
        relVel,
        earthPole,
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
      const targetApoapsisKm = Math.max(160, Number(vehicle.targetOrbitApoapsisKm) || 240);
      const targetPeriapsisKm = Math.max(120, Number(vehicle.targetOrbitPeriapsisKm) || 200);
      const apoapsisKm = Number(orbital?.apoapsisKm);
      const periapsisKm = Number(orbital?.periapsisKm);
      const timeToApoapsisSec = Number(orbital?.timeToApoapsisSec);
      const parkingReady = Number(orbital?.specificEnergy) < 0
        && apoapsisKm >= targetApoapsisKm
        && periapsisKm >= targetPeriapsisKm;

      if (vehicle.missionPhase === "launch_to_parking") {
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
      } else if (vehicle.vehicleRole === "tanker" && vehicle.missionPhase === "orbital_hold") {
        requestedThrottle = 0;
        desiredDirection = prograde;
        guidanceMode = "autopilot-orbital-hold";
      } else if (vehicle.missionId === LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO && vehicle.missionPhase === "orbital_refuel") {
        const target = nearestEligibleTankerTarget(state, shipState, earthState);
        orbitalRefuelTarget = target;
        if (!target || !target.relativePositionKm) {
          requestedThrottle = 0;
          desiredDirection = prograde;
          guidanceMode = "navsys:orbital-refuel-await-target";
        } else {
          decisionTargetBodyId = String(target.tankerId || "refuel_tanker");
          decisionTargetBodyName = "Refuel Tanker";
          const rendezvousFrame = orbitalRelativeFrame({ prograde, up });
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
          const targetRadialSpeedKmS = Number(target.radialSpeedKmS);
          const radialSpeedKmS = Number(orbital?.radialSpeedKmS) || 0;
          const periapsisNowKm = Number(orbital?.periapsisKm);
          const apoapsisNowKm = Number(orbital?.apoapsisKm);
          const speedNowKmS = Math.max(0, Number(orbital?.speedKmS) || length(relVel));
          const circularSpeedKmS = Math.max(0.001, Number(orbital?.circularSpeedKmS) || 7.8);
          const speedExcessKmS = speedNowKmS - circularSpeedKmS;
          const shipAltitudeKm = Math.max(0, Number(orbital?.altitudeKm) || 0);
          const altitudeErrorKm = Number.isFinite(targetAltitudeKm)
            ? (targetAltitudeKm - shipAltitudeKm)
            : 0;
          const radialSpeedErrorKmS = Number.isFinite(targetRadialSpeedKmS)
            ? (targetRadialSpeedKmS - radialSpeedKmS)
            : 0;
          const recoveryEnter = Number.isFinite(periapsisNowKm)
            && (periapsisNowKm < 124 || (periapsisNowKm < 138 && radialSpeedKmS < -0.0016));
          const recoveryExit = Number.isFinite(periapsisNowKm)
            && periapsisNowKm >= 156
            && radialSpeedKmS >= -0.0007;
          if (!vehicle.refuelOrbitRecovery || typeof vehicle.refuelOrbitRecovery !== "object") {
            vehicle.refuelOrbitRecovery = {
              active: false,
              stableSec: 0,
            };
          }
          if (!vehicle.refuelOrbitRecovery.active && recoveryEnter) {
            vehicle.refuelOrbitRecovery.active = true;
            vehicle.refuelOrbitRecovery.stableSec = 0;
          }
          if (vehicle.refuelOrbitRecovery.active) {
            if (recoveryExit) {
              vehicle.refuelOrbitRecovery.stableSec = Math.max(
                0,
                Number(vehicle.refuelOrbitRecovery.stableSec) || 0,
              ) + safeDtSeconds;
            } else {
              vehicle.refuelOrbitRecovery.stableSec = 0;
            }
            if ((Number(vehicle.refuelOrbitRecovery.stableSec) || 0) >= 18) {
              vehicle.refuelOrbitRecovery.active = false;
              vehicle.refuelOrbitRecovery.stableSec = 0;
            }
          }
          const recoveryActive = Boolean(vehicle.refuelOrbitRecovery.active);
          const highEnergyRisk =
            speedExcessKmS > 0.22
            || (
              Number.isFinite(apoapsisNowKm)
              && apoapsisNowKm > (
                Number.isFinite(targetAltitudeKm)
                  ? Math.max(targetAltitudeKm + 300, 460)
                  : 700
              )
            );
          const rcsAssistEnabled = true;
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
          if (
            refuelDistanceKm <= ((Number(REFUEL_TANKER_CONFIG.dockDistanceKm) || 0.014) * 1.25)
            && refuelRelativeSpeedKmS <= ((Number(REFUEL_TANKER_CONFIG.dockMaxRelativeSpeedKmS) || 0.000045) * 1.2)
          ) {
            requestedThrottle = 0;
            desiredDirection = prograde;
            guidanceMode = "navsys:orbital-refuel-lock";
          } else if (recoveryActive) {
            // Safety gate: recover orbital energy before any aggressive line-of-sight chase.
            requestedThrottle = clamp(0.26 + (Math.max(0, 130 - (Number.isFinite(periapsisNowKm) ? periapsisNowKm : 130)) / 80), 0.26, 0.54);
            desiredDirection = prograde;
            guidanceMode = "navsys:orbital-refuel-orbit-recovery";
          } else if (highEnergyRisk) {
            // Do not keep adding orbital energy during catch-up; brake until back near stable orbit energy.
            requestedThrottle = clamp(0.14 + Math.max(0, speedExcessKmS * 0.48), 0.14, 0.44);
            desiredDirection = normalize(
              add(
                scale(prograde, -0.9),
                scale(directionHorizontal, 0.1),
              ),
              scale(prograde, -1),
            );
            guidanceMode = "navsys:orbital-refuel-speed-brake";
          } else if (refuelDistanceKm > 15) {
            const desiredFarClosingKmS = clamp(refuelDistanceKm / 80_000, 0.018, 0.22);
            const closureWeak = !Number.isFinite(refuelClosingSpeedKmS)
              || refuelClosingSpeedKmS < (desiredFarClosingKmS * 0.72);
            if (closureWeak) {
              const catchupCommand = computePhaseCatchupCommand({
                targetRelativePositionKm: target.relativePositionKm,
                targetRelativeVelocityKmS: targetMinusShipRelVel,
                refuelDistanceKm,
                frame: rendezvousFrame,
                altitudeErrorKm,
                radialSpeedErrorKmS,
                speedExcessKmS,
              });
              if (catchupCommand) {
                requestedThrottle = catchupCommand.throttle;
                desiredDirection = catchupCommand.desiredDirection;
                guidanceMode = catchupCommand.phaseMode === "lower"
                  ? "navsys:orbital-refuel-phase-catchup-lower"
                  : "navsys:orbital-refuel-phase-catchup-raise";
              } else {
                // Fallback should not happen under nominal telemetry, but keeps guidance robust.
                requestedThrottle = clamp(0.08 + (refuelDistanceKm / 140_000), 0.08, 0.20);
                desiredDirection = normalize(
                  add(
                    scale(prograde, 0.72),
                    scale(directionHorizontal, 0.20),
                  ),
                  prograde,
                );
                guidanceMode = "navsys:orbital-refuel-phase-catchup";
              }
            } else {
              requestedThrottle = clamp(0.12 + (refuelDistanceKm / 220), 0.12, 0.34);
              desiredDirection = normalize(
                add(
                  scale(directionHorizontal, 0.78),
                  scale(prograde, 0.22),
                ),
                prograde,
              );
              guidanceMode = "navsys:orbital-refuel-rendezvous-far";
            }
          } else if (refuelDistanceKm > 1.5) {
            const velocityDampingDirection = normalize(scale(shipMinusTargetRelVel, -1), directionToTarget);
            desiredDirection = normalize(
              add(
                scale(directionHorizontal, 0.58),
                scale(velocityDampingDirection, 0.28),
                scale(prograde, 0.14),
              ),
              prograde,
            );
            requestedThrottle = clamp(
              0.028 + (refuelDistanceKm / 120) + (refuelRelativeSpeedKmS * 28),
              0.02,
              0.12,
            );
            guidanceMode = "navsys:orbital-refuel-rendezvous-mid";
          } else {
            const desiredClosingSpeedKmS = clamp(refuelDistanceKm * 0.00009, 0.00001, 0.00008);
            if (
              Number.isFinite(refuelClosingSpeedKmS)
              && (refuelClosingSpeedKmS > (desiredClosingSpeedKmS * 1.35) || refuelRelativeSpeedKmS > 0.00028)
            ) {
              desiredDirection = normalize(
                scale(shipMinusTargetRelVel, -1),
                scale(directionToTarget, -1),
              );
              requestedThrottle = clamp(0.003 + (refuelRelativeSpeedKmS * 22), 0.003, 0.03);
              guidanceMode = "navsys:orbital-refuel-brake";
            } else {
              desiredDirection = normalize(
                add(
                  scale(directionHorizontal, 0.44),
                  scale(normalize(scale(shipMinusTargetRelVel, -1), directionToTarget), 0.42),
                  scale(prograde, 0.14),
                ),
                prograde,
              );
              requestedThrottle = clamp(0.002 + (refuelDistanceKm * 0.01), 0.002, 0.02);
              guidanceMode = "navsys:orbital-refuel-final-approach";
            }
          }
        }
      } else if (vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN && !vehicle.missionCompleted) {
        if (vehicle.missionPhase === "tli_burn") {
          const periapsisKm = Number(orbital?.periapsisKm);
          if (Number.isFinite(periapsisKm) && periapsisKm < FLEET_TLI_PERIAPSIS_RECOVER_TARGET_KM) {
            const deficitNorm = clamp(
              (FLEET_TLI_PERIAPSIS_RECOVER_TARGET_KM - periapsisKm)
                / Math.max(1, FLEET_TLI_PERIAPSIS_RECOVER_TARGET_KM - FLEET_TLI_PERIAPSIS_PROTECT_MIN_KM),
              0,
              1,
            );
            const upBias = clamp(0.2 + (deficitNorm * 0.08), 0.12, 0.36);
            desiredDirection = normalize(
              add(scale(prograde, 1), scale(up, upBias)),
              prograde,
            );
            requestedThrottle = clamp(0.16 + (deficitNorm * 0.28), 0.16, 0.62);
            guidanceMode = "autopilot-tli-periapsis-protect";
          } else {
            const toMoon = moonState?.position
              ? normalize(subtract(moonState.position, shipState.position), prograde)
              : prograde;
            desiredDirection = normalize(
              add(scale(prograde, 0.72), scale(toMoon, 0.28)),
              prograde,
            );
            const phaseProgress = clamp(
              (Number(vehicle.phaseElapsedSec) || 0) / Math.max(1, Number(vehicle.tliDurationSec) || FLEET_MOON_TLI_DURATION_SEC),
              0,
              1,
            );
            requestedThrottle = clamp(0.84 - (phaseProgress * 0.22), 0.56, 0.84);
            guidanceMode = "autopilot-tli-burn";
          }
        } else if (vehicle.missionPhase === "coast_to_moon") {
          const moonRelPos = moonState?.position
            ? subtract(shipState.position, moonState.position)
            : null;
          const moonRelVel = moonState?.velocity
            ? subtract(
              shipState.velocity || { x: 0, y: 0, z: 0 },
              moonState.velocity || { x: 0, y: 0, z: 0 },
            )
            : null;
          if (moonRelPos && moonRelVel) {
            const moonDistanceKm = Math.max(0, length(moonRelPos));
            const moonDirection = normalize(scale(moonRelPos, -1), prograde);
            const moonClosingSpeedKmS = moonDistanceKm > 1e-9
              ? -dot(moonRelVel, scale(moonRelPos, 1 / moonDistanceKm))
              : 0;
            const shipToMoonPos = scale(moonRelPos, -1);
            const moonMinusShipVel = scale(moonRelVel, -1);
            const projectedMissDistanceKm = projectedClosestApproachDistanceKm(
              shipToMoonPos,
              moonMinusShipVel,
            );
            const sensorEstimate = updateMoonSensorEstimate(
              vehicle,
              {
                distanceKm: moonDistanceKm,
                closingSpeedKmS: moonClosingSpeedKmS,
                projectedMissKm: projectedMissDistanceKm,
                direction: moonDirection,
              },
              safeDtSeconds,
              nowMs,
            );
            const estimatedDirection = finiteVector(sensorEstimate?.direction)
              ? normalize(sensorEstimate.direction, moonDirection)
              : moonDirection;
            const estimatedClosingSpeedKmS = Number.isFinite(Number(sensorEstimate?.closingSpeedKmS))
              ? Number(sensorEstimate.closingSpeedKmS)
              : moonClosingSpeedKmS;
            const estimatedMissDistanceKm = Number.isFinite(Number(sensorEstimate?.projectedMissKm))
              ? Number(sensorEstimate.projectedMissKm)
              : projectedMissDistanceKm;
            const earthDistanceKm = Math.max(0, length(relPos));
            const earthRadialSpeedKmS = earthDistanceKm > 1e-6
              ? dot(relPos, relVel) / earthDistanceKm
              : 0;
            const farFromMoon = moonDistanceKm > FLEET_MOON_APPROACH_DISTANCE_KM;
            const weakClosing = estimatedClosingSpeedKmS < FLEET_MOON_MIDCOURSE_MIN_CLOSING_SPEED_KM_S;
            const projectedMissRisk = estimatedMissDistanceKm > FLEET_MOON_MIDCOURSE_MISS_DISTANCE_KM;
            const earthFallbackRisk = earthRadialSpeedKmS < FLEET_MOON_EARTH_FALLBACK_RADIAL_SPEED_KM_S
              && earthDistanceKm < (FLEET_MOON_APPROACH_DISTANCE_KM * 3.5);
            const correctionNeeded = farFromMoon && (weakClosing || projectedMissRisk || earthFallbackRisk);
            if (!vehicle.moonMidcourseControl || typeof vehicle.moonMidcourseControl !== "object") {
              vehicle.moonMidcourseControl = {
                active: false,
                burnSec: 0,
                stableSec: 0,
              };
            }
            const controlState = vehicle.moonMidcourseControl;
            if (correctionNeeded) {
              controlState.active = true;
              controlState.stableSec = 0;
            } else if (controlState.active) {
              controlState.stableSec = Math.max(0, Number(controlState.stableSec) || 0) + safeDtSeconds;
            }
            if (controlState.active) {
              controlState.burnSec = Math.max(0, Number(controlState.burnSec) || 0) + safeDtSeconds;
              const canExitCorrection = !correctionNeeded
                && controlState.burnSec >= Math.max(0, Number(FLEET_MOON_MIDCOURSE_MIN_BURN_SEC) || 0)
                && controlState.stableSec >= Math.max(0, Number(FLEET_MOON_MIDCOURSE_EXIT_STABLE_SEC) || 0);
              if (canExitCorrection) {
                controlState.active = false;
                controlState.burnSec = 0;
                controlState.stableSec = 0;
              }
            }
            if (controlState.active) {
              const closingDeficit = clamp(
                (
                  FLEET_MOON_MIDCOURSE_MIN_CLOSING_SPEED_KM_S
                  - estimatedClosingSpeedKmS
                ) / Math.max(FLEET_MOON_MIDCOURSE_CLOSING_WINDOW_KM_S, 1e-6),
                0,
                1,
              );
              const missRisk = clamp(
                (
                  estimatedMissDistanceKm
                  - FLEET_MOON_CAPTURE_GATE_DISTANCE_KM
                ) / Math.max(
                  FLEET_MOON_MIDCOURSE_MISS_DISTANCE_KM - FLEET_MOON_CAPTURE_GATE_DISTANCE_KM,
                  1,
                ),
                0,
                1,
              );
              requestedThrottle = clamp(
                FLEET_MOON_MIDCOURSE_THROTTLE_BASE
                  + (closingDeficit * 0.34)
                  + (missRisk * 0.24)
                  + (earthFallbackRisk ? 0.16 : 0),
                FLEET_MOON_MIDCOURSE_THROTTLE_BASE,
                FLEET_MOON_MIDCOURSE_THROTTLE_MAX,
              );
              desiredDirection = normalize(
                add(
                  scale(estimatedDirection, 0.84),
                  add(scale(prograde, 0.12), scale(up, 0.04)),
                ),
                estimatedDirection,
              );
              guidanceMode = "autopilot-midcourse-correction";
            } else {
              requestedThrottle = 0;
              desiredDirection = estimatedDirection;
              guidanceMode = "autopilot-coast-to-moon";
            }
          } else {
            requestedThrottle = 0;
            desiredDirection = prograde;
            guidanceMode = "autopilot-coast-to-moon";
          }
        } else if (vehicle.missionPhase === "lunar_capture") {
          if (moonState?.velocity && moonState?.position) {
            const moonRelVel = subtract(
              shipState.velocity || { x: 0, y: 0, z: 0 },
              moonState.velocity || { x: 0, y: 0, z: 0 },
            );
            desiredDirection = normalize(scale(moonRelVel, -1), prograde);
            requestedThrottle = 0.36;
            guidanceMode = "autopilot-lunar-capture";
          } else {
            guidanceMode = "autopilot-coast-to-moon";
          }
        } else if (vehicle.missionPhase === "lunar_orbit_hold") {
          guidanceMode = "autopilot-lunar-orbit-hold";
        } else {
          guidanceMode = "autopilot-coast-to-moon";
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
          requestedThrottle = 0;
          desiredDirection = prograde;
          guidanceMode = "autopilot-moon-fuel-budget-hold";
        } else if (moonBurnPhase && Number.isFinite(budgetMarginKg) && budgetMarginKg < FLEET_MOON_MISSION_MARGIN_CONSERVE_KG) {
          const conserveCap = budgetMarginKg < FLEET_MOON_MISSION_MARGIN_CRITICAL_KG
            ? 0.16
            : 0.24;
          requestedThrottle = Math.min(requestedThrottle, conserveCap);
          if (requestedThrottle > 1e-3 && guidanceMode.startsWith("autopilot-")) {
            guidanceMode = `${guidanceMode}:fuel-conserve`;
          }
        }
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
      const requestedThrottleCommand = clamp(Number(requestedThrottle) || 0, 0, 1);
      const guidanceBurnRequested = requestedThrottleCommand > 1e-3;
      const guidanceInertNoPropellant = guidanceBurnRequested && availablePropellantKg <= 1e-6;
      vehicle.guidanceBurnRequested = guidanceBurnRequested;
      vehicle.guidanceRequestedThrottle = requestedThrottleCommand;
      vehicle.guidanceInertNoPropellant = guidanceInertNoPropellant;
      vehicle.guidanceInertReason = guidanceInertNoPropellant
        ? "no-propellant-for-guidance-burn"
        : "";
      const ambientPressurePa = Number(atmosphereSample?.pressurePa) || 0;
      const stageThrustVacuumN = Math.max(0, Number(activeStage?.thrustVacuumN) || 0);
      const stageThrustSeaLevelN = Math.max(0, Number(activeStage?.thrustSeaLevelN) || stageThrustVacuumN);
      const thrustPerThrottleN = interpolateSeaToVac(
        stageThrustVacuumN,
        stageThrustSeaLevelN,
        ambientPressurePa,
      );
      const thrustN = requestedThrottle > 1e-6
        ? thrustPerThrottleN * requestedThrottle
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
      const thrustAccelKmS2 = scale(desiredDirection, accelerationMagnitudeKmS2);
      const totalAccelKmS2 = add(thrustAccelKmS2, rcsAssistAccelKmS2);
      vehicle.pendingBurnKg = burnKg;
      vehicle.guidanceMode = guidanceMode;
      vehicle.decisionTargetBodyId = decisionTargetBodyId;
      vehicle.decisionTargetBodyName = decisionTargetBodyName;
      vehicle.lastStep = {
        accelerationKmS2: totalAccelKmS2,
        throttle: requestedThrottle,
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
        dynamicPressurePa,
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
          burnActive: requestedThrottle > 1e-3 && thrustN > 1,
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
        if (typeof emitLaunchEvent === "function") {
          emitLaunchEvent("fleet_mission_stage_changed", {
            shipId: vehicle.id,
            missionId: vehicle.missionId,
            stageIndex,
            stageName: nextStage?.name || `Stage ${stageIndex + 1}`,
          });
        }
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
        if (vehicle.missionPhase === "tli_burn") {
          const tliDurationSec = Math.max(60, Number(vehicle.tliDurationSec) || FLEET_MOON_TLI_DURATION_SEC);
          const periapsisKm = Number(earthOrbit?.periapsisKm);
          const periapsisSafe = Number.isFinite(periapsisKm)
            ? periapsisKm >= FLEET_TLI_PERIAPSIS_PROTECT_MIN_KM
            : false;
          const tliDurationComplete = vehicle.phaseElapsedSec >= tliDurationSec;
          const fuelBudget = vehicle.fuelBudget && typeof vehicle.fuelBudget === "object"
            ? vehicle.fuelBudget
            : null;
          const fuelBudgetFeasible = fuelBudget ? Boolean(fuelBudget.feasible) : true;
          const fuelBudgetMarginKg = Number(fuelBudget?.marginKg);
          const fuelBudgetGateSatisfied = fuelBudgetFeasible;
          if (
            (tliDurationComplete && periapsisSafe && fuelBudgetGateSatisfied)
            || (Number(vehicle.propellantKg) || 0) <= 1e-3
          ) {
            setFleetMissionPhase(vehicle, "coast_to_moon", {
              tliDurationSec,
              periapsisKm: Number.isFinite(periapsisKm) ? periapsisKm : null,
              fuelBudgetFeasible,
              fuelBudgetMarginKg: Number.isFinite(fuelBudgetMarginKg) ? fuelBudgetMarginKg : null,
            });
          }
        }

        const moonRelPos = moonState?.position
          ? subtract(shipState.position, moonState.position)
          : null;
        const moonRelVel = moonState?.velocity
          ? subtract(
            shipState.velocity || { x: 0, y: 0, z: 0 },
            moonState.velocity || { x: 0, y: 0, z: 0 },
          )
          : null;
        const moonDistanceKm = moonRelPos ? length(moonRelPos) : Number.POSITIVE_INFINITY;
        if (vehicle.missionPhase === "coast_to_moon" && moonDistanceKm <= FLEET_MOON_CAPTURE_GATE_DISTANCE_KM) {
          setFleetMissionPhase(vehicle, "lunar_capture", {
            moonDistanceKm,
          });
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
        const target = nearestEligibleTankerTarget(state, shipState, earthState);
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
      thrustN: Number(vehicle.lastStep?.thrustN) || 0,
      burnRateKgS: Number(vehicle.lastStep?.burnRateKgS) || 0,
      dynamicPressurePa: Number(vehicle.lastStep?.dynamicPressurePa) || dynamicPressurePa,
      throttleCommand: throttle,
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
