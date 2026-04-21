const EARTH_EQUATORIAL_RADIUS_KM = 6378.137;
const EARTH_POLAR_RADIUS_KM = 6356.752314245;
const EARTH_MEAN_RADIUS_KM = 6371.0084;
const EARTH_EQUATORIAL_RADIUS_SQ_KM2 = EARTH_EQUATORIAL_RADIUS_KM * EARTH_EQUATORIAL_RADIUS_KM;
const EARTH_POLAR_RADIUS_SQ_KM2 = EARTH_POLAR_RADIUS_KM * EARTH_POLAR_RADIUS_KM;
const EARTH_FIRST_ECCENTRICITY_SQ = 1 - (EARTH_POLAR_RADIUS_SQ_KM2 / EARTH_EQUATORIAL_RADIUS_SQ_KM2);
const EARTH_SECOND_ECCENTRICITY_SQ = (EARTH_EQUATORIAL_RADIUS_SQ_KM2 / EARTH_POLAR_RADIUS_SQ_KM2) - 1;

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
  const a2 = EARTH_EQUATORIAL_RADIUS_SQ_KM2;
  const b2 = EARTH_POLAR_RADIUS_SQ_KM2;
  const top = Math.pow(a2 * cosLat, 2) + Math.pow(b2 * sinLat, 2);
  const bottom = Math.pow(EARTH_EQUATORIAL_RADIUS_KM * cosLat, 2) + Math.pow(EARTH_POLAR_RADIUS_KM * sinLat, 2);
  if (!(bottom > 0)) {
    return EARTH_MEAN_RADIUS_KM;
  }
  return Math.sqrt(top / bottom);
}

function geodeticCoordinatesFromEarthFixed(xKm, yKm, zKm) {
  const pKm = Math.hypot(xKm, yKm);
  if (!(pKm > 1e-12) && !(Math.abs(zKm) > 1e-12)) {
    return null;
  }
  if (!(pKm > 1e-12)) {
    const signZ = zKm >= 0 ? 1 : -1;
    return {
      latitudeRad: signZ * (Math.PI * 0.5),
      longitudeRad: 0,
      ellipsoidHeightKm: Math.abs(zKm) - EARTH_POLAR_RADIUS_KM,
      surfacePointKm: {
        x: 0,
        y: 0,
        z: signZ * EARTH_POLAR_RADIUS_KM,
      },
      surfaceRadiusKm: EARTH_POLAR_RADIUS_KM,
      surfaceNormalBody: {
        x: 0,
        y: 0,
        z: signZ,
      },
    };
  }

  const theta = Math.atan2(
    zKm * EARTH_EQUATORIAL_RADIUS_KM,
    pKm * EARTH_POLAR_RADIUS_KM,
  );
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);
  const longitudeRad = Math.atan2(yKm, xKm);
  const latitudeRad = Math.atan2(
    zKm + (EARTH_SECOND_ECCENTRICITY_SQ * EARTH_POLAR_RADIUS_KM * sinTheta * sinTheta * sinTheta),
    pKm - (EARTH_FIRST_ECCENTRICITY_SQ * EARTH_EQUATORIAL_RADIUS_KM * cosTheta * cosTheta * cosTheta),
  );
  const sinLat = Math.sin(latitudeRad);
  const cosLat = Math.cos(latitudeRad);
  const primeVerticalRadiusKm = EARTH_EQUATORIAL_RADIUS_KM
    / Math.sqrt(1 - (EARTH_FIRST_ECCENTRICITY_SQ * sinLat * sinLat));
  const ellipsoidHeightKm = Math.abs(cosLat) > 1e-10
    ? (pKm / cosLat) - primeVerticalRadiusKm
    : (zKm / Math.max(sinLat, 1e-10)) - (primeVerticalRadiusKm * (1 - EARTH_FIRST_ECCENTRICITY_SQ));
  const surfacePointKm = {
    x: primeVerticalRadiusKm * cosLat * Math.cos(longitudeRad),
    y: primeVerticalRadiusKm * cosLat * Math.sin(longitudeRad),
    z: primeVerticalRadiusKm * (1 - EARTH_FIRST_ECCENTRICITY_SQ) * sinLat,
  };
  return {
    latitudeRad,
    longitudeRad,
    ellipsoidHeightKm,
    surfacePointKm,
    surfaceRadiusKm: length(surfacePointKm),
    surfaceNormalBody: normalize({
      x: cosLat * Math.cos(longitudeRad),
      y: cosLat * Math.sin(longitudeRad),
      z: sinLat,
    }),
  };
}

function surfacePointBodyFromGeodeticLatLon(latitudeDeg, longitudeDeg) {
  const latRad = rad(clamp(Number(latitudeDeg) || 0, -90, 90));
  const lonRad = rad(normalizeLongitudeDeg(Number(longitudeDeg) || 0));
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const cosLon = Math.cos(lonRad);
  const sinLon = Math.sin(lonRad);
  const primeVerticalRadiusKm = EARTH_EQUATORIAL_RADIUS_KM
    / Math.sqrt(1 - (EARTH_FIRST_ECCENTRICITY_SQ * sinLat * sinLat));
  return {
    surfacePointKm: {
      x: primeVerticalRadiusKm * cosLat * cosLon,
      y: primeVerticalRadiusKm * cosLat * sinLon,
      z: primeVerticalRadiusKm * (1 - EARTH_FIRST_ECCENTRICITY_SQ) * sinLat,
    },
    surfaceNormalBody: normalize({
      x: cosLat * cosLon,
      y: cosLat * sinLon,
      z: sinLat,
    }),
  };
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

export function surfaceRadiusKmAtLatLon(latitudeDeg, longitudeDeg, options = {}) {
  const latDeg = clamp(Number(latitudeDeg) || 0, -90, 90);
  const lonDeg = normalizeLongitudeDeg(Number(longitudeDeg) || 0);
  const ellipsoidRadiusKm = geocentricRadiusFromLatitudeRad(rad(latDeg));
  const terrainHeightKm = options?.includeTerrain === true
    ? terrainHeightKmAtLatLon(latDeg, lonDeg)
    : 0;
  return ellipsoidRadiusKm + terrainHeightKm;
}

export function surfacePointRelativeKmAtLatLon(latitudeDeg, longitudeDeg, earthAxes, options = {}) {
  const axes = sanitizeEarthAxes(earthAxes);
  const lonDeg = normalizeLongitudeDeg(Number(longitudeDeg) || 0);
  const latDeg = clamp(Number(latitudeDeg) || 0, -90, 90);
  const base = surfacePointBodyFromGeodeticLatLon(latDeg, lonDeg);
  const terrainHeightKm = options?.includeTerrain === true
    ? terrainHeightKmAtLatLon(latDeg, lonDeg)
    : 0;
  const surfacePointBodyKm = add(
    base.surfacePointKm,
    scale(base.surfaceNormalBody, terrainHeightKm),
  );
  const pointRelativeKm = {
    x: (axes.xAxis.x * surfacePointBodyKm.x)
      + (axes.yAxis.x * surfacePointBodyKm.y)
      + (axes.pole.x * surfacePointBodyKm.z),
    y: (axes.xAxis.y * surfacePointBodyKm.x)
      + (axes.yAxis.y * surfacePointBodyKm.y)
      + (axes.pole.y * surfacePointBodyKm.z),
    z: (axes.xAxis.z * surfacePointBodyKm.x)
      + (axes.yAxis.z * surfacePointBodyKm.y)
      + (axes.pole.z * surfacePointBodyKm.z),
  };
  const surfaceNormal = normalize({
    x: (axes.xAxis.x * base.surfaceNormalBody.x)
      + (axes.yAxis.x * base.surfaceNormalBody.y)
      + (axes.pole.x * base.surfaceNormalBody.z),
    y: (axes.xAxis.y * base.surfaceNormalBody.x)
      + (axes.yAxis.y * base.surfaceNormalBody.y)
      + (axes.pole.y * base.surfaceNormalBody.z),
    z: (axes.xAxis.z * base.surfaceNormalBody.x)
      + (axes.yAxis.z * base.surfaceNormalBody.y)
      + (axes.pole.z * base.surfaceNormalBody.z),
  });
  return {
    latitudeDeg: latDeg,
    longitudeDeg: lonDeg,
    terrainHeightKm,
    ellipsoidRadiusKm: length(base.surfacePointKm),
    localSurfaceRadiusKm: length(surfacePointBodyKm),
    surfaceNormal,
    pointRelativeKm,
  };
}

function sanitizeEarthAxes(rawAxes) {
  const pole = normalize(rawAxes?.pole || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const xAxisRaw = normalize(rawAxes?.xAxis || { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const yAxis = normalize(cross(pole, xAxisRaw), { x: 0, y: 1, z: 0 });
  const xAxis = normalize(cross(yAxis, pole), { x: 1, y: 0, z: 0 });
  return { xAxis, yAxis, pole };
}

export function sampleEarthSurfaceAtRelativePosition(
  relativePositionKm,
  earthAxes,
  earthMeanRadiusKm = EARTH_MEAN_RADIUS_KM,
  options = {},
) {
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

  const geodetic = geodeticCoordinatesFromEarthFixed(x, y, z);
  if (!geodetic) {
    const latitudeRad = Math.asin(clamp(z / centerDistanceKm, -1, 1));
    const longitudeRad = Math.atan2(y, x);
    const latitudeDeg = deg(latitudeRad);
    const longitudeDeg = normalizeLongitudeDeg(deg(longitudeRad));
    const terrainHeightKm = options?.includeTerrain === true
      ? terrainHeightKmAtLatLon(latitudeDeg, longitudeDeg)
      : 0;
    const ellipsoidRadiusKm = Number(earthMeanRadiusKm) || EARTH_MEAN_RADIUS_KM;
    const localSurfaceRadiusKm = ellipsoidRadiusKm + terrainHeightKm;
    const altitudeAboveTerrainKm = centerDistanceKm - localSurfaceRadiusKm;
    return {
      latitudeDeg,
      longitudeDeg,
      geodeticLatitudeDeg: latitudeDeg,
      geocentricLatitudeDeg: latitudeDeg,
      terrainHeightKm,
      ellipsoidRadiusKm,
      localSurfaceRadiusKm,
      centerDistanceKm,
      altitudeAboveTerrainKm,
      ellipsoidHeightKm: altitudeAboveTerrainKm + terrainHeightKm,
      surfaceNormal: normalize(relativePositionKm),
      surfacePointRelativeKm: scale(normalize(relativePositionKm), localSurfaceRadiusKm),
    };
  }

  const latitudeDeg = deg(geodetic.latitudeRad);
  const longitudeDeg = normalizeLongitudeDeg(deg(geodetic.longitudeRad));
  const terrainHeightKm = options?.includeTerrain === true
    ? terrainHeightKmAtLatLon(latitudeDeg, longitudeDeg)
    : 0;
  const surfacePointBodyKm = add(
    geodetic.surfacePointKm,
    scale(geodetic.surfaceNormalBody, terrainHeightKm),
  );
  const localSurfaceRadiusKm = length(surfacePointBodyKm);
  const altitudeAboveTerrainKm = geodetic.ellipsoidHeightKm - terrainHeightKm;
  const surfaceNormal = normalize({
    x: (axes.xAxis.x * geodetic.surfaceNormalBody.x)
      + (axes.yAxis.x * geodetic.surfaceNormalBody.y)
      + (axes.pole.x * geodetic.surfaceNormalBody.z),
    y: (axes.xAxis.y * geodetic.surfaceNormalBody.x)
      + (axes.yAxis.y * geodetic.surfaceNormalBody.y)
      + (axes.pole.y * geodetic.surfaceNormalBody.z),
    z: (axes.xAxis.z * geodetic.surfaceNormalBody.x)
      + (axes.yAxis.z * geodetic.surfaceNormalBody.y)
      + (axes.pole.z * geodetic.surfaceNormalBody.z),
  }, normalize(relativePositionKm));
  const surfacePointRelativeKm = {
    x: (axes.xAxis.x * surfacePointBodyKm.x)
      + (axes.yAxis.x * surfacePointBodyKm.y)
      + (axes.pole.x * surfacePointBodyKm.z),
    y: (axes.xAxis.y * surfacePointBodyKm.x)
      + (axes.yAxis.y * surfacePointBodyKm.y)
      + (axes.pole.y * surfacePointBodyKm.z),
    z: (axes.xAxis.z * surfacePointBodyKm.x)
      + (axes.yAxis.z * surfacePointBodyKm.y)
      + (axes.pole.z * surfacePointBodyKm.z),
  };

  return {
    latitudeDeg,
    longitudeDeg,
    geodeticLatitudeDeg: latitudeDeg,
    geocentricLatitudeDeg: deg(Math.asin(clamp(z / centerDistanceKm, -1, 1))),
    terrainHeightKm,
    ellipsoidRadiusKm: geodetic.surfaceRadiusKm,
    localSurfaceRadiusKm,
    centerDistanceKm,
    altitudeAboveTerrainKm,
    ellipsoidHeightKm: geodetic.ellipsoidHeightKm,
    surfaceNormal,
    surfacePointRelativeKm,
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
    surfaceClearanceKm = 0,
    dtSeconds,
    thrustN = 0,
    includeTerrain = false,
  } = options || {};

  if (!rocketState?.position || !rocketState?.velocity || !earthState?.position) {
    return { corrected: false, surfaceSample: null };
  }

  const relPosition = subtract(rocketState.position, earthState.position);
  const sample = sampleEarthSurfaceAtRelativePosition(
    relPosition,
    earthAxes,
    earthRadiusKm,
    { includeTerrain },
  );
  if (!sample) {
    return { corrected: false, surfaceSample: null };
  }

  const targetAltitudeKm = Math.max(0, Number(referenceOffsetKm) || 0)
    + Math.max(0, Number(surfaceClearanceKm) || 0);
  const penetrationKm = Math.max(
    0,
    targetAltitudeKm - (Number(sample.altitudeAboveTerrainKm) || 0),
  );
  if (!(penetrationKm > 0)) {
    return { corrected: false, surfaceSample: sample, penetrationKm: 0 };
  }

  const normal = normalize(sample.surfaceNormal || relPosition);
  const correctedRelPosition = sample.surfacePointRelativeKm
    ? add(
      sample.surfacePointRelativeKm,
      scale(normal, targetAltitudeKm),
    )
    : add(relPosition, scale(normal, penetrationKm));
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
  const correctedSample = sampleEarthSurfaceAtRelativePosition(
    correctedRelPosition,
    axes,
    earthRadiusKm,
    { includeTerrain },
  ) || sample;
  return {
    corrected: true,
    surfaceSample: correctedSample,
    penetrationKm,
  };
}
