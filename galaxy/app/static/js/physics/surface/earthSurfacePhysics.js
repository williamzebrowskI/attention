const EARTH_EQUATORIAL_RADIUS_KM = 6378.137;
const EARTH_POLAR_RADIUS_KM = 6356.752314245;
const EARTH_MEAN_RADIUS_KM = 6371.0;

const EARTH_MAX_ELEVATION_KM = 8.849;
const EARTH_MIN_ELEVATION_KM = -10.994;

const CAPE_CANAVERAL_LAT_DEG = 28.5618571;
const CAPE_CANAVERAL_LON_DEG = -80.577366;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rad(degrees) {
  return (degrees * Math.PI) / 180;
}

function deg(radians) {
  return (radians * 180) / Math.PI;
}

function length(v) {
  return Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z));
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
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

function cross(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function normalize(v, fallback = { x: 0, y: 0, z: 1 }) {
  const mag = length(v);
  if (!(mag > 1e-12)) {
    return { ...fallback };
  }
  return { x: v.x / mag, y: v.y / mag, z: v.z / mag };
}

function normalizeLongitudeDeg(longitudeDeg) {
  if (!Number.isFinite(longitudeDeg)) {
    return 0;
  }
  let lon = longitudeDeg % 360;
  if (lon > 180) {
    lon -= 360;
  } else if (lon < -180) {
    lon += 360;
  }
  return lon;
}

function geocentricRadiusFromLatitudeRad(latitudeRad) {
  const cosLat = Math.cos(latitudeRad);
  const sinLat = Math.sin(latitudeRad);
  const a2 = EARTH_EQUATORIAL_RADIUS_KM * EARTH_EQUATORIAL_RADIUS_KM;
  const b2 = EARTH_POLAR_RADIUS_KM * EARTH_POLAR_RADIUS_KM;
  const top = Math.pow(a2 * cosLat, 2) + Math.pow(b2 * sinLat, 2);
  const bottom = Math.pow(EARTH_EQUATORIAL_RADIUS_KM * cosLat, 2) + Math.pow(EARTH_POLAR_RADIUS_KM * sinLat, 2);
  if (!(bottom > 0)) {
    return EARTH_MEAN_RADIUS_KM;
  }
  return Math.sqrt(top / bottom);
}

function terrainRaw(latRad, lonRad) {
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);
  const cos2Lat = Math.cos(latRad * 2);

  const continental =
    (0.52 * Math.sin((2.35 * lonRad) + 0.4) * cosLat * cosLat)
    + (0.31 * Math.sin((3.9 * lonRad) - 1.1) * Math.sin(2.1 * latRad))
    + (0.24 * Math.cos((1.7 * lonRad) + 0.6) * Math.cos(3.2 * latRad));

  const mountainBelts =
    (0.14 * Math.sin((8.4 * lonRad) + 2.3) * Math.sin((5.1 * latRad) - 0.45) * cosLat)
    + (0.11 * Math.sin((14.2 * lonRad) - 0.7) * Math.cos(6.0 * latRad))
    + (0.08 * Math.cos((9.7 * lonRad) + 1.4) * cos2Lat);

  return continental + mountainBelts;
}

const TERRAIN_CAPE_REFERENCE = terrainRaw(
  rad(CAPE_CANAVERAL_LAT_DEG),
  rad(CAPE_CANAVERAL_LON_DEG),
);

export function terrainHeightKmAtLatLon(latitudeDeg, longitudeDeg) {
  const latDeg = clamp(Number(latitudeDeg) || 0, -90, 90);
  const lonDeg = normalizeLongitudeDeg(Number(longitudeDeg) || 0);
  const latRad = rad(latDeg);
  const lonRad = rad(lonDeg);

  const normalized = terrainRaw(latRad, lonRad) - TERRAIN_CAPE_REFERENCE;
  let terrainKm = normalized * 5.4;
  if (terrainKm < 0) {
    terrainKm *= 1.35;
  } else {
    terrainKm *= 0.72;
  }
  return clamp(terrainKm, EARTH_MIN_ELEVATION_KM, EARTH_MAX_ELEVATION_KM);
}

function sanitizeEarthAxes(rawAxes) {
  const pole = normalize(rawAxes?.pole || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const xAxisRaw = normalize(rawAxes?.xAxis || { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const yAxis = normalize(cross(pole, xAxisRaw), { x: 0, y: 1, z: 0 });
  const xAxis = normalize(cross(yAxis, pole), { x: 1, y: 0, z: 0 });
  return { xAxis, yAxis, pole };
}

export function sampleEarthSurfaceAtRelativePosition(relativePositionKm, earthAxes, earthMeanRadiusKm = EARTH_MEAN_RADIUS_KM) {
  if (!relativePositionKm) {
    return null;
  }
  const axes = sanitizeEarthAxes(earthAxes);
  const x = dot(relativePositionKm, axes.xAxis);
  const y = dot(relativePositionKm, axes.yAxis);
  const z = dot(relativePositionKm, axes.pole);
  const centerDistanceKm = Math.sqrt((x * x) + (y * y) + (z * z));
  if (!(centerDistanceKm > 1e-12)) {
    return null;
  }

  const latitudeRad = Math.asin(clamp(z / centerDistanceKm, -1, 1));
  const longitudeRad = Math.atan2(y, x);
  const latitudeDeg = deg(latitudeRad);
  const longitudeDeg = normalizeLongitudeDeg(deg(longitudeRad));

  const ellipsoidRadiusKm = geocentricRadiusFromLatitudeRad(latitudeRad);
  const referenceRadiusKm = earthMeanRadiusKm;
  const terrainHeightKm = terrainHeightKmAtLatLon(latitudeDeg, longitudeDeg);
  const localSurfaceRadiusKm = referenceRadiusKm + terrainHeightKm;
  const altitudeAboveTerrainKm = centerDistanceKm - localSurfaceRadiusKm;

  return {
    latitudeDeg,
    longitudeDeg,
    terrainHeightKm,
    ellipsoidRadiusKm,
    localSurfaceRadiusKm,
    centerDistanceKm,
    altitudeAboveTerrainKm,
  };
}

export function applyEarthSurfaceContactForVehicle(options) {
  const {
    rocketState,
    earthState,
    earthAxes,
    earthRadiusKm,
    earthSiderealRateRadS,
    referenceOffsetKm,
    dtSeconds,
    thrustN = 0,
  } = options || {};

  if (!rocketState?.position || !rocketState?.velocity || !earthState?.position) {
    return { corrected: false, surfaceSample: null };
  }

  const relPosition = subtract(rocketState.position, earthState.position);
  const sample = sampleEarthSurfaceAtRelativePosition(relPosition, earthAxes, earthRadiusKm);
  if (!sample) {
    return { corrected: false, surfaceSample: null };
  }

  const contactRadiusKm = sample.localSurfaceRadiusKm + Math.max(0, Number(referenceOffsetKm) || 0);
  const penetrationKm = contactRadiusKm - sample.centerDistanceKm;
  if (!(penetrationKm > 0)) {
    return { corrected: false, surfaceSample: sample, penetrationKm: 0 };
  }

  const normal = normalize(relPosition);
  const correctedRelPosition = scale(normal, contactRadiusKm);
  rocketState.position = add(earthState.position, correctedRelPosition);

  const earthVelocity = earthState.velocity || { x: 0, y: 0, z: 0 };
  const axes = sanitizeEarthAxes(earthAxes);
  const omega = scale(axes.pole, Number(earthSiderealRateRadS) || 0);
  const surfaceVelocity = add(earthVelocity, cross(omega, correctedRelPosition));
  const relativeVelocity = subtract(rocketState.velocity, surfaceVelocity);

  const inwardSpeedKmS = dot(relativeVelocity, normal);
  let correctedRelativeVelocity = { ...relativeVelocity };
  if (inwardSpeedKmS < 0) {
    const restitution = 0.015;
    correctedRelativeVelocity = subtract(
      correctedRelativeVelocity,
      scale(normal, inwardSpeedKmS * (1 + restitution)),
    );
  }

  const normalSpeedKmS = dot(correctedRelativeVelocity, normal);
  const tangentialVelocity = subtract(correctedRelativeVelocity, scale(normal, normalSpeedKmS));
  const tangentialSpeedKmS = length(tangentialVelocity);

  if (tangentialSpeedKmS > 1e-10) {
    const baseFriction = clamp((Number(dtSeconds) || 0) * 1.8, 0, 0.95);
    const thrustRatio = clamp((Number(thrustN) || 0) / 20_000_000, 0, 1);
    const friction = baseFriction * (1 - (0.82 * thrustRatio));
    correctedRelativeVelocity = subtract(correctedRelativeVelocity, scale(tangentialVelocity, friction));
  }

  if ((Number(thrustN) || 0) < 1_000_000) {
    const correctedNormalSpeed = dot(correctedRelativeVelocity, normal);
    if (correctedNormalSpeed < 0) {
      correctedRelativeVelocity = subtract(correctedRelativeVelocity, scale(normal, correctedNormalSpeed));
    }
  }

  rocketState.velocity = add(surfaceVelocity, correctedRelativeVelocity);
  const correctedSample = sampleEarthSurfaceAtRelativePosition(correctedRelPosition, axes, earthRadiusKm) || sample;
  return {
    corrected: true,
    surfaceSample: correctedSample,
    penetrationKm,
  };
}
