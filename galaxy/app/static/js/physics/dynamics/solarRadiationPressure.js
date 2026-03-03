export const SOLAR_RADIATION_PRESSURE_ENABLED = true;

const AU_KM = 149_597_870.7;
const SRP_AT_1_AU_N_PER_M2 = 4.56e-6;
const DEFAULT_REFLECTIVITY_COEFF = 1.45;
const SPACECRAFT_MIN_MASS_KG = 1;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteVector(v) {
  return Boolean(
    v
    && Number.isFinite(Number(v.x))
    && Number.isFinite(Number(v.y))
    && Number.isFinite(Number(v.z)),
  );
}

function vectorLength(v) {
  return Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z));
}

function diskOverlapArea(r1, r2, d) {
  if (!(r1 > 0) || !(r2 > 0)) {
    return 0;
  }
  if (d >= r1 + r2) {
    return 0;
  }
  if (d <= Math.abs(r1 - r2)) {
    const rMin = Math.min(r1, r2);
    return Math.PI * rMin * rMin;
  }
  const r1Sq = r1 * r1;
  const r2Sq = r2 * r2;
  const dSq = d * d;
  const alpha = Math.acos(clamp((dSq + r1Sq - r2Sq) / Math.max(2 * d * r1, 1e-12), -1, 1));
  const beta = Math.acos(clamp((dSq + r2Sq - r1Sq) / Math.max(2 * d * r2, 1e-12), -1, 1));
  const term = Math.max((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2), 0);
  const lens = 0.5 * Math.sqrt(term);
  return (r1Sq * alpha) + (r2Sq * beta) - lens;
}

function visibleSunDiskFraction(sunAngularRadius, occluderAngularRadius, angularSeparation) {
  if (!(sunAngularRadius > 0) || !(occluderAngularRadius > 0)) {
    return 1;
  }
  const overlap = diskOverlapArea(sunAngularRadius, occluderAngularRadius, Math.max(angularSeparation, 0));
  const sunArea = Math.PI * sunAngularRadius * sunAngularRadius;
  if (!(sunArea > 0)) {
    return 1;
  }
  return clamp(1 - (overlap / sunArea), 0, 1);
}

function spacecraftEffectiveAreaM2(bodyId, bodyMeta = null) {
  const id = String(bodyId || "");
  if (id === "earth_launch_booster") {
    return 125;
  }
  if (id === "earth_launch_vehicle") {
    return 95;
  }
  if (id.startsWith("earth_mission_ship_") || id.startsWith("earth_refuel_tanker_")) {
    return 95;
  }
  const radiusKm = Number(bodyMeta?.radius_km);
  if (Number.isFinite(radiusKm) && radiusKm > 0) {
    const radiusM = radiusKm * 1000;
    return Math.PI * radiusM * radiusM;
  }
  return 70;
}

function spacecraftAreaToMassM2PerKg(bodyId, bodyMeta = null, bodyMassKg = 0) {
  const massKg = Math.max(SPACECRAFT_MIN_MASS_KG, Number(bodyMassKg) || SPACECRAFT_MIN_MASS_KG);
  const areaM2 = spacecraftEffectiveAreaM2(bodyId, bodyMeta);
  return clamp(areaM2 / massKg, 1e-7, 0.15);
}

export function computeSolarShadowTransmittance({
  targetId = "",
  targetPosKm = null,
  sunPosKm = null,
  sunRadiusKm = 0,
  occluders = [],
} = {}) {
  if (!finiteVector(targetPosKm) || !finiteVector(sunPosKm)) {
    return 1;
  }
  const sunRadius = Number(sunRadiusKm);
  if (!(sunRadius > 0)) {
    return 1;
  }

  const sx = sunPosKm.x - targetPosKm.x;
  const sy = sunPosKm.y - targetPosKm.y;
  const sz = sunPosKm.z - targetPosKm.z;
  const sunDistanceKm = Math.sqrt((sx * sx) + (sy * sy) + (sz * sz));
  if (!(sunDistanceKm > 1e-8)) {
    return 1;
  }
  const sunAngularRadius = Math.asin(clamp(sunRadius / sunDistanceKm, -1, 1));
  if (!(sunAngularRadius > 0)) {
    return 1;
  }
  const dirX = sx / sunDistanceKm;
  const dirY = sy / sunDistanceKm;
  const dirZ = sz / sunDistanceKm;

  let transmittance = 1;
  const safeOccluders = Array.isArray(occluders) ? occluders : [];
  for (let i = 0; i < safeOccluders.length; i += 1) {
    const occluder = safeOccluders[i];
    const occluderId = String(occluder?.id || "");
    if (!occluderId || occluderId === "sun" || occluderId === targetId) {
      continue;
    }
    if (!finiteVector(occluder?.positionKm)) {
      continue;
    }
    const occluderRadiusKm = Number(occluder?.radiusKm);
    if (!(occluderRadiusKm > 0)) {
      continue;
    }

    const rx = occluder.positionKm.x - targetPosKm.x;
    const ry = occluder.positionKm.y - targetPosKm.y;
    const rz = occluder.positionKm.z - targetPosKm.z;
    const projectionKm = (rx * dirX) + (ry * dirY) + (rz * dirZ);
    if (!(projectionKm > 0) || !(projectionKm < sunDistanceKm)) {
      continue;
    }

    const radialSq = Math.max((rx * rx) + (ry * ry) + (rz * rz) - (projectionKm * projectionKm), 0);
    const radialDistanceKm = Math.sqrt(radialSq);
    const angularSeparation = Math.atan2(radialDistanceKm, projectionKm);
    const occluderAngularRadius = Math.asin(clamp(occluderRadiusKm / projectionKm, -1, 1));
    if (!(occluderAngularRadius > 0)) {
      continue;
    }

    const localTransmittance = visibleSunDiskFraction(
      sunAngularRadius,
      occluderAngularRadius,
      angularSeparation,
    );
    transmittance = Math.min(transmittance, localTransmittance);
    if (transmittance <= 1e-6) {
      return 0;
    }
  }
  return clamp(transmittance, 0, 1);
}

export function computeSolarRadiationAccelerationKmS2({
  bodyId = "",
  bodyMeta = null,
  bodyMassKg = 0,
  targetPosKm = null,
  sunPosKm = null,
  transmittance = 1,
  reflectivityCoeff = DEFAULT_REFLECTIVITY_COEFF,
} = {}) {
  if (!SOLAR_RADIATION_PRESSURE_ENABLED) {
    return { x: 0, y: 0, z: 0 };
  }
  if (!finiteVector(targetPosKm) || !finiteVector(sunPosKm)) {
    return { x: 0, y: 0, z: 0 };
  }
  if (String(bodyMeta?.body_type || "").trim().toLowerCase() !== "spacecraft") {
    return { x: 0, y: 0, z: 0 };
  }

  const tx = targetPosKm.x - sunPosKm.x;
  const ty = targetPosKm.y - sunPosKm.y;
  const tz = targetPosKm.z - sunPosKm.z;
  const distanceKm = Math.sqrt((tx * tx) + (ty * ty) + (tz * tz));
  if (!(distanceKm > 1e-8)) {
    return { x: 0, y: 0, z: 0 };
  }

  const areaToMassM2PerKg = spacecraftAreaToMassM2PerKg(bodyId, bodyMeta, bodyMassKg);
  if (!(areaToMassM2PerKg > 0)) {
    return { x: 0, y: 0, z: 0 };
  }

  const fluxScale = (AU_KM / distanceKm) ** 2;
  const attenuation = clamp(Number(transmittance) || 0, 0, 1);
  const reflectivity = clamp(Number(reflectivityCoeff) || DEFAULT_REFLECTIVITY_COEFF, 1, 2.2);
  const accelMS2 = SRP_AT_1_AU_N_PER_M2 * reflectivity * areaToMassM2PerKg * fluxScale * attenuation;
  const accelKmS2 = accelMS2 / 1000;
  return {
    x: accelKmS2 * (tx / distanceKm),
    y: accelKmS2 * (ty / distanceKm),
    z: accelKmS2 * (tz / distanceKm),
  };
}
