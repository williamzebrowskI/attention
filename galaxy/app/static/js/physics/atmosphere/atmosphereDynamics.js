import { sampleUpperAtmosphereNRLMSISEApprox } from "./upperAtmosphereModel.js";
import { sampleEarthSurfaceAtRelativePosition } from "../surface/earthSurfacePhysics.js";

const EARTH_MEAN_RADIUS_KM = 6_371.0084;
const EARTH_GEOPOTENTIAL_RADIUS_KM = 6_356.766;
const EARTH_MU_M3_PER_S2 = 3.986004418e14;
const EARTH_SIDEREAL_ANGULAR_RATE_RAD_PER_SEC = 7.2921150e-5;
const STANDARD_GRAVITY_MS2 = 9.80665;
const AIR_GAS_CONSTANT_J_PER_KG_K = 287.05287;
const DRY_AIR_HEAT_CAPACITY_RATIO = 1.4;

const ATMOSPHERE_LAYER_BASE_ALT_KM = [0, 11, 20, 32, 47, 51, 71, 86];
const ATMOSPHERE_LAYER_BASE_TEMP_K = [288.15, 216.65, 216.65, 228.65, 270.65, 270.65, 214.65, 186.946];
const ATMOSPHERE_LAYER_LAPSE_K_PER_KM = [-6.5, 0, 1.0, 2.8, 0, -2.8, -2.0];
const ATMOSPHERE_LAYER_BASE_PRESSURE_PA = [101325, 22632.06, 5474.889, 868.0187, 110.9063, 66.93887, 3.956420];

const DRAG_CONFIG_BY_BODY_ID = Object.freeze({
  iss: Object.freeze({
    dragCoefficient: 2.2,
    areaM2: 420,
    massKg: 420_000,
  }),
  earth_launch_vehicle: Object.freeze({
    dragCoefficient: 0.32,
    areaM2: 63.62,
  }),
  earth_launch_booster: Object.freeze({
    dragCoefficient: 0.42,
    areaM2: 78,
  }),
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function vectorLength(v) {
  return Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z));
}

function normalizeOrNull(v) {
  const mag = vectorLength(v);
  if (!(mag > 1e-18)) {
    return null;
  }
  return { x: v.x / mag, y: v.y / mag, z: v.z / mag };
}

function cross(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function geometricAltitudeToGeopotentialKm(geometricAltitudeKm) {
  const z = Math.max(geometricAltitudeKm, 0);
  return (EARTH_GEOPOTENTIAL_RADIUS_KM * z) / (EARTH_GEOPOTENTIAL_RADIUS_KM + z);
}

function pressureAndTemperatureBelow86Km(geometricAltitudeKm) {
  const geopotentialKm = geometricAltitudeToGeopotentialKm(geometricAltitudeKm);
  let layerIndex = ATMOSPHERE_LAYER_BASE_ALT_KM.length - 2;
  for (let i = 0; i < ATMOSPHERE_LAYER_BASE_ALT_KM.length - 1; i += 1) {
    if (geopotentialKm >= ATMOSPHERE_LAYER_BASE_ALT_KM[i] && geopotentialKm < ATMOSPHERE_LAYER_BASE_ALT_KM[i + 1]) {
      layerIndex = i;
      break;
    }
  }

  const baseAltKm = ATMOSPHERE_LAYER_BASE_ALT_KM[layerIndex];
  const lapseKPerKm = ATMOSPHERE_LAYER_LAPSE_K_PER_KM[layerIndex];
  const baseTempK = ATMOSPHERE_LAYER_BASE_TEMP_K[layerIndex];
  const basePressurePa = ATMOSPHERE_LAYER_BASE_PRESSURE_PA[layerIndex];
  const deltaHkm = geopotentialKm - baseAltKm;

  let temperatureK = baseTempK + (lapseKPerKm * deltaHkm);
  temperatureK = Math.max(temperatureK, 120);

  let pressurePa = 0;
  if (Math.abs(lapseKPerKm) < 1e-12) {
    pressurePa = basePressurePa * Math.exp(
      (-STANDARD_GRAVITY_MS2 * deltaHkm * 1000) / (AIR_GAS_CONSTANT_J_PER_KG_K * baseTempK),
    );
  } else {
    const lapseKPerM = lapseKPerKm / 1000;
    const exponent = STANDARD_GRAVITY_MS2 / (AIR_GAS_CONSTANT_J_PER_KG_K * lapseKPerM);
    pressurePa = basePressurePa * Math.pow(baseTempK / temperatureK, exponent);
  }

  return { pressurePa, temperatureK };
}

export function earthGravityMs2AtAltitudeKm(altitudeKm) {
  const rMeters = (EARTH_MEAN_RADIUS_KM + Math.max(altitudeKm, 0)) * 1000;
  return EARTH_MU_M3_PER_S2 / (rMeters * rMeters);
}

export function earthAtmosphereSampleUS1976(geometricAltitudeKm, options = {}) {
  const altitudeKm = Math.max(0, Number(geometricAltitudeKm) || 0);
  const geopotentialAltitudeKm = geometricAltitudeToGeopotentialKm(altitudeKm);
  if (altitudeKm > 1000) {
    return {
      altitudeKm,
      geopotentialAltitudeKm,
      gravityMs2: earthGravityMs2AtAltitudeKm(altitudeKm),
      temperatureK: 0,
      pressurePa: 0,
      densityKgM3: 0,
      gasConstantJPerKgK: AIR_GAS_CONSTANT_J_PER_KG_K,
      heatCapacityRatio: DRY_AIR_HEAT_CAPACITY_RATIO,
      speedOfSoundMs: 0,
    };
  }

  let temperatureK = 0;
  let pressurePa = 0;
  let densityKgM3 = 0;
  let exosphericTemperatureK = null;
  let meanMolarMassKgPerMol = null;
  let upperAtmosphereModel = null;
  let gasConstantJPerKgK = AIR_GAS_CONSTANT_J_PER_KG_K;
  let heatCapacityRatio = DRY_AIR_HEAT_CAPACITY_RATIO;

  if (altitudeKm <= 86) {
    const below = pressureAndTemperatureBelow86Km(altitudeKm);
    temperatureK = below.temperatureK;
    pressurePa = below.pressurePa;
    densityKgM3 = pressurePa / (AIR_GAS_CONSTANT_J_PER_KG_K * temperatureK);
    meanMolarMassKgPerMol = 0.0289644;
  } else {
    const base86 = pressureAndTemperatureBelow86Km(86);
    const baseDensityKgM3 = base86.pressurePa / (AIR_GAS_CONSTANT_J_PER_KG_K * base86.temperatureK);
    const upper = sampleUpperAtmosphereNRLMSISEApprox({
      altitudeKm,
      baseDensityKgM3,
      latitudeDeg: Number(options?.latitudeDeg) || 0,
      longitudeDeg: Number(options?.longitudeDeg) || 0,
      timestampMs: Number(options?.timestampMs) || Date.now(),
      f107: Number(options?.f107) || 150,
      kp: Number(options?.kp) || 3,
      kpHistory: Array.isArray(options?.kpHistory) ? options.kpHistory : [],
    });
    densityKgM3 = Math.max(0, Number(upper?.densityKgM3) || 0);
    pressurePa = Math.max(0, Number(upper?.pressurePa) || 0);
    temperatureK = Math.max(1, Number(upper?.temperatureK) || 186.946);
    exosphericTemperatureK = Number.isFinite(Number(upper?.exosphericTemperatureK))
      ? Number(upper.exosphericTemperatureK)
      : null;
    meanMolarMassKgPerMol = Number.isFinite(Number(upper?.meanMolarMassKgPerMol))
      ? Number(upper.meanMolarMassKgPerMol)
      : null;
    gasConstantJPerKgK = Number.isFinite(Number(upper?.gasConstantJPerKgK))
      ? Number(upper.gasConstantJPerKgK)
      : AIR_GAS_CONSTANT_J_PER_KG_K;
    heatCapacityRatio = Number.isFinite(Number(upper?.heatCapacityRatio))
      ? Number(upper.heatCapacityRatio)
      : DRY_AIR_HEAT_CAPACITY_RATIO;
    upperAtmosphereModel = String(upper?.model || "nrlmsise-approx");
  }

  const soundSpeedMs = speedOfSoundMs(temperatureK, gasConstantJPerKgK, heatCapacityRatio);

  return {
    altitudeKm,
    geopotentialAltitudeKm,
    gravityMs2: earthGravityMs2AtAltitudeKm(altitudeKm),
    temperatureK,
    pressurePa,
    densityKgM3,
    exosphericTemperatureK,
    meanMolarMassKgPerMol,
    gasConstantJPerKgK,
    heatCapacityRatio,
    speedOfSoundMs: soundSpeedMs,
    upperAtmosphereModel,
  };
}

function dragConfigForBody(bodyId, bodyRadiusKm, bodyMassKg) {
  const configured = DRAG_CONFIG_BY_BODY_ID[bodyId] || null;
  const dragCoefficient = Number(configured?.dragCoefficient) > 0 ? Number(configured.dragCoefficient) : 2.2;
  const massKg = Number(configured?.massKg) > 0 ? Number(configured.massKg) : bodyMassKg;
  let areaM2 = Number(configured?.areaM2);
  if (!(areaM2 > 0)) {
    const radiusM = Math.max((Number(bodyRadiusKm) || 0) * 1000, 0);
    areaM2 = Math.PI * radiusM * radiusM;
  }
  return {
    dragCoefficient,
    areaM2: areaM2 > 0 ? areaM2 : 0,
    massKg: massKg > 0 ? massKg : 0,
  };
}

function lerp(a, b, t) {
  return a + ((b - a) * t);
}

function speedOfSoundMs(temperatureK, gasConstantJPerKgK = AIR_GAS_CONSTANT_J_PER_KG_K, heatCapacityRatio = DRY_AIR_HEAT_CAPACITY_RATIO) {
  if (!(temperatureK > 0) || !(gasConstantJPerKgK > 0) || !(heatCapacityRatio > 1)) {
    return 0;
  }
  return Math.sqrt(heatCapacityRatio * gasConstantJPerKgK * temperatureK);
}

function launchVehicleDragCoefficientForMach(mach) {
  if (!(mach > 0)) {
    return 0.24;
  }
  if (mach < 0.8) {
    return lerp(0.24, 0.30, mach / 0.8);
  }
  if (mach < 1.1) {
    return lerp(0.30, 0.58, (mach - 0.8) / 0.3);
  }
  if (mach < 2.0) {
    return lerp(0.58, 0.36, (mach - 1.1) / 0.9);
  }
  if (mach < 5.0) {
    return lerp(0.36, 0.24, (mach - 2.0) / 3.0);
  }
  return 0.22;
}

function effectiveDragCoefficient(bodyId, baseDragCoefficient, speedMS, atmosphere) {
  if (bodyId !== "earth_launch_vehicle" && bodyId !== "earth_launch_booster") {
    return baseDragCoefficient;
  }
  const soundSpeedMs = Number(atmosphere?.speedOfSoundMs) > 0
    ? Number(atmosphere.speedOfSoundMs)
    : speedOfSoundMs(
      Number(atmosphere?.temperatureK) || 0,
      Number(atmosphere?.gasConstantJPerKgK) || AIR_GAS_CONSTANT_J_PER_KG_K,
      Number(atmosphere?.heatCapacityRatio) || DRY_AIR_HEAT_CAPACITY_RATIO,
    );
  const mach = soundSpeedMs > 0 ? (speedMS / soundSpeedMs) : 0;
  const machModelCd = launchVehicleDragCoefficientForMach(mach);
  // Blend user/base Cd with Mach model to preserve tunability while adding transonic realism.
  return clamp((0.35 * baseDragCoefficient) + (0.65 * machModelCd), 0.16, 0.9);
}

function earthAngularRateRadS(earthAxes = null) {
  const lodSec = Number(earthAxes?.earthOrientation?.lodSec);
  return EARTH_SIDEREAL_ANGULAR_RATE_RAD_PER_SEC * (1 - ((Number.isFinite(lodSec) ? lodSec : 0) / 86400));
}

function earthCoRotationVelocityKmS(relativePositionKm, earthAxes = null) {
  const axis = normalizeOrNull(earthAxes?.pole) || { x: 0, y: 0, z: 1 };
  const omega = {
    x: axis.x * earthAngularRateRadS(earthAxes),
    y: axis.y * earthAngularRateRadS(earthAxes),
    z: axis.z * earthAngularRateRadS(earthAxes),
  };
  return cross(omega, relativePositionKm);
}

function earthLatLonFromRelativePosition(relativePositionKm, axes) {
  const rel = relativePositionKm || null;
  if (!rel) {
    return null;
  }
  const radius = vectorLength(rel);
  if (!(radius > 1e-9)) {
    return null;
  }

  const pole = normalizeOrNull(axes?.pole || { x: 0, y: 0, z: 1 }) || { x: 0, y: 0, z: 1 };
  let xAxis = normalizeOrNull(axes?.xAxis || null);
  let yAxis = normalizeOrNull(axes?.yAxis || null);
  if (!xAxis || !yAxis) {
    const fallback = normalizeOrNull({
      x: 1 - (pole.x * pole.x),
      y: -(pole.x * pole.y),
      z: -(pole.x * pole.z),
    }) || { x: 1, y: 0, z: 0 };
    xAxis = fallback;
    yAxis = normalizeOrNull(cross(pole, xAxis)) || { x: 0, y: 1, z: 0 };
  }

  const unit = {
    x: rel.x / radius,
    y: rel.y / radius,
    z: rel.z / radius,
  };
  const localX = (unit.x * xAxis.x) + (unit.y * xAxis.y) + (unit.z * xAxis.z);
  const localY = (unit.x * yAxis.x) + (unit.y * yAxis.y) + (unit.z * yAxis.z);
  const localZ = clamp((unit.x * pole.x) + (unit.y * pole.y) + (unit.z * pole.z), -1, 1);
  return {
    latitudeDeg: (Math.asin(localZ) * 180) / Math.PI,
    longitudeDeg: (Math.atan2(localY, localX) * 180) / Math.PI,
  };
}

export function createAtmosphereDynamicsController(options) {
  const {
    getBodyMeta,
    getBodyRadiusKm,
    getBodyMassKg,
    getBodySpinAxisEcliptic,
    getEarthFixedAxesEcliptic,
    sampleEarthAtmosphere,
  } = options || {};

  function computeAtmosphericAccelerationKmS2(state, bodyId, nowMs = Date.now()) {
    const id = String(bodyId || "");
    const bodyState = state?.dynamicBodies?.get(bodyId);
    if (!bodyState?.position || !bodyState?.velocity) {
      return { x: 0, y: 0, z: 0 };
    }
    if (id === "earth") {
      return { x: 0, y: 0, z: 0 };
    }
    if (
      id === "earth_launch_vehicle"
      || id === "earth_launch_booster"
      || id.startsWith("earth_mission_ship_")
      || id.startsWith("earth_refuel_tanker_")
    ) {
      // Launch-stack and booster aero loads are modeled in launchController to include
      // wind shear, AoA effects, q-alpha limiting, and actuator lag.
      // Fleet mission/tanker vehicles are modeled in launchFleetController with the same aero path.
      return { x: 0, y: 0, z: 0 };
    }

    const earthState =
      state?.dynamicBodies?.get("earth")
      || state?.staticSources?.get("earth")
      || null;
    if (!earthState?.position) {
      return { x: 0, y: 0, z: 0 };
    }

    const earthRadiusKm = Number(getBodyRadiusKm?.("earth")) || EARTH_MEAN_RADIUS_KM;
    const relPos = {
      x: bodyState.position.x - earthState.position.x,
      y: bodyState.position.y - earthState.position.y,
      z: bodyState.position.z - earthState.position.z,
    };
    const relDistanceKm = vectorLength(relPos);
    if (!(relDistanceKm > 1e-9)) {
      return { x: 0, y: 0, z: 0 };
    }

    const earthAxes = typeof getEarthFixedAxesEcliptic === "function"
      ? (getEarthFixedAxesEcliptic(nowMs) || null)
      : null;
    const surfaceSample = sampleEarthSurfaceAtRelativePosition(
      relPos,
      earthAxes,
      earthRadiusKm,
      { includeTerrain: false },
    );
    const altitudeKm = Number(surfaceSample?.altitudeAboveTerrainKm);
    if (!(altitudeKm >= 0 && altitudeKm <= 1000)) {
      return { x: 0, y: 0, z: 0 };
    }
    const latLon = surfaceSample || earthLatLonFromRelativePosition(relPos, earthAxes);
    const atmosphereSampler = typeof sampleEarthAtmosphere === "function"
      ? sampleEarthAtmosphere
      : earthAtmosphereSampleUS1976;
    const atmosphere = atmosphereSampler(
      altitudeKm,
      {
        timestampMs: nowMs,
        latitudeDeg: Number(latLon?.latitudeDeg) || 0,
        longitudeDeg: Number(latLon?.longitudeDeg) || 0,
        relativePositionKm: relPos,
      },
    );
    if (!(atmosphere.densityKgM3 > 0)) {
      return { x: 0, y: 0, z: 0 };
    }

    const bodyRadiusKm = Number(getBodyRadiusKm?.(bodyId)) || Number(getBodyMeta?.(bodyId)?.radius_km) || 0;
    const bodyMassKg = Number(bodyState.massKg) || Number(getBodyMassKg?.(bodyId)) || 0;
    const dragConfig = dragConfigForBody(bodyId, bodyRadiusKm, bodyMassKg);
    if (!(dragConfig.areaM2 > 0) || !(dragConfig.massKg > 0)) {
      return { x: 0, y: 0, z: 0 };
    }

    const earthVelocity = earthState.velocity || { x: 0, y: 0, z: 0 };
    const atmoCorotationVelocity = earthCoRotationVelocityKmS(relPos, earthAxes);
    const relVelocityKmS = {
      x: bodyState.velocity.x - earthVelocity.x - atmoCorotationVelocity.x,
      y: bodyState.velocity.y - earthVelocity.y - atmoCorotationVelocity.y,
      z: bodyState.velocity.z - earthVelocity.z - atmoCorotationVelocity.z,
    };
    const speedKmS = vectorLength(relVelocityKmS);
    if (!(speedKmS > 1e-12)) {
      return { x: 0, y: 0, z: 0 };
    }

    const speedMS = speedKmS * 1000;
    const effectiveCd = effectiveDragCoefficient(
      bodyId,
      dragConfig.dragCoefficient,
      speedMS,
      atmosphere,
    );
    const dragMS2 =
      0.5
      * atmosphere.densityKgM3
      * effectiveCd
      * (dragConfig.areaM2 / dragConfig.massKg)
      * speedMS
      * speedMS;
    const dragKmS2 = dragMS2 / 1000;
    const speedInvKmS = 1 / speedKmS;
    return {
      x: -dragKmS2 * relVelocityKmS.x * speedInvKmS,
      y: -dragKmS2 * relVelocityKmS.y * speedInvKmS,
      z: -dragKmS2 * relVelocityKmS.z * speedInvKmS,
    };
  }

  return {
    computeAtmosphericAccelerationKmS2,
  };
}
