function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback);
}

function finiteVector(vector) {
  return Boolean(
    vector
    && Number.isFinite(Number(vector.x))
    && Number.isFinite(Number(vector.y))
    && Number.isFinite(Number(vector.z))
  );
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function length(vector) {
  return Math.sqrt(dot(vector, vector));
}

function subtract(a, b) {
  return {
    x: Number(a.x) - Number(b.x),
    y: Number(a.y) - Number(b.y),
    z: Number(a.z) - Number(b.z),
  };
}

function scale(vector, scalar) {
  return {
    x: Number(vector.x) * scalar,
    y: Number(vector.y) * scalar,
    z: Number(vector.z) * scalar,
  };
}

function add(a, b) {
  return {
    x: Number(a.x) + Number(b.x),
    y: Number(a.y) + Number(b.y),
    z: Number(a.z) + Number(b.z),
  };
}

function cross(a, b) {
  return {
    x: (Number(a.y) * Number(b.z)) - (Number(a.z) * Number(b.y)),
    y: (Number(a.z) * Number(b.x)) - (Number(a.x) * Number(b.z)),
    z: (Number(a.x) * Number(b.y)) - (Number(a.y) * Number(b.x)),
  };
}

function normalize(vector, fallback = { x: 0, y: 1, z: 0 }) {
  if (!finiteVector(vector)) {
    return { ...fallback };
  }
  const magnitude = length(vector);
  if (!(magnitude > 1e-12)) {
    return { ...fallback };
  }
  return scale(vector, 1 / magnitude);
}

export function spacecraftOrbitOffsetFromAngles({
  azimuth = 0,
  polar = Math.PI * 0.5,
  radius = 1,
} = {}) {
  const safeRadius = Math.max(0, finiteNumber(radius, 0));
  const sinPolar = Math.sin(Number(polar) || 0);
  return {
    x: safeRadius * sinPolar * Math.sin(Number(azimuth) || 0),
    y: safeRadius * Math.cos(Number(polar) || 0),
    z: safeRadius * sinPolar * Math.cos(Number(azimuth) || 0),
  };
}

function spacecraftStructuralSpanScene({
  distanceScale = 0,
  renderRadius = 0,
  bodyRadiusKm = Number.NaN,
  stackHeightKm = 0,
} = {}) {
  const radiusScene = Number.isFinite(Number(bodyRadiusKm)) && Number(bodyRadiusKm) > 0
    ? Number(bodyRadiusKm) * finiteNumber(distanceScale, 0)
    : Math.max(finiteNumber(renderRadius, 0), 0);
  return Math.max(
    finiteNumber(stackHeightKm, 0) * finiteNumber(distanceScale, 0),
    radiusScene * 2,
    finiteNumber(renderRadius, 0) * 2,
  );
}

export function spacecraftMinOrbitDistanceScene({
  distanceScale = 0,
  renderRadius = 0,
  bodyRadiusKm = Number.NaN,
  stackHeightKm = 0,
} = {}) {
  const spanScene = spacecraftStructuralSpanScene({
    distanceScale,
    renderRadius,
    bodyRadiusKm,
    stackHeightKm,
  });
  const bodyRadiusScene = Number.isFinite(Number(bodyRadiusKm)) && Number(bodyRadiusKm) > 0
    ? Number(bodyRadiusKm) * finiteNumber(distanceScale, 0)
    : Math.max(finiteNumber(renderRadius, 0) * 0.5, 0);
  return Math.max(
    0.00000012,
    spanScene * 1.1,
    bodyRadiusScene * 3.25,
  );
}

export function spacecraftPreferredCameraDistanceScene({
  distanceScale = 0,
  renderRadius = 0,
  bodyRadiusKm = Number.NaN,
  stackHeightKm = 0,
  nearSurface = Number.NaN,
} = {}) {
  const minDistance = spacecraftMinOrbitDistanceScene({
    distanceScale,
    renderRadius,
    bodyRadiusKm,
    stackHeightKm,
  });
  const spanScene = spacecraftStructuralSpanScene({
    distanceScale,
    renderRadius,
    bodyRadiusKm,
    stackHeightKm,
  });
  const requestedNearSurface = finiteNumber(nearSurface, minDistance);
  return Math.max(
    minDistance,
    requestedNearSurface * 1.35,
    spanScene * 9.5,
    0.00000125,
  );
}

export function spacecraftEarthRelativeOrbitAngles({
  targetScene,
  earthScene,
} = {}) {
  if (!finiteVector(targetScene) || !finiteVector(earthScene)) {
    return null;
  }
  const outward = normalize(subtract(targetScene, earthScene), { x: 0, y: 1, z: 0 });
  let reference = { x: 0, y: 1, z: 0 };
  if (Math.abs(dot(outward, reference)) > 0.9) {
    reference = { x: 0, y: 0, z: 1 };
  }
  let lateral = normalize(cross(reference, outward), { x: 1, y: 0, z: 0 });
  if (length(lateral) <= 1e-12) {
    lateral = { x: 1, y: 0, z: 0 };
  }
  const elevated = normalize(
    add(scale(outward, 0.9), scale(lateral, 0.435)),
    outward,
  );
  return {
    azimuth: Math.atan2(elevated.x, elevated.z),
    polar: clamp(Math.acos(clamp(elevated.y, -1, 1)), 0.001, Math.PI - 0.001),
    outwardAlignment: dot(elevated, outward),
  };
}

export function spacecraftSurfaceRelativeOrbitFrame({
  targetScene,
  earthScene,
  earthPoleScene,
  azimuth = 0,
  polar = Math.PI * 0.5,
  radius = 1,
} = {}) {
  if (!finiteVector(targetScene) || !finiteVector(earthScene)) {
    return null;
  }
  const up = normalize(subtract(targetScene, earthScene), { x: 0, y: 1, z: 0 });
  let pole = finiteVector(earthPoleScene)
    ? normalize(earthPoleScene, { x: 0, y: 1, z: 0 })
    : { x: 0, y: 1, z: 0 };
  if (Math.abs(dot(up, pole)) > 0.985) {
    pole = { x: 0, y: 0, z: 1 };
  }
  let east = normalize(cross(pole, up), { x: 1, y: 0, z: 0 });
  if (length(east) <= 1e-12) {
    east = { x: 1, y: 0, z: 0 };
  }
  const north = normalize(cross(up, east), { x: 0, y: 0, z: 1 });
  const heading = normalize(
    add(
      scale(east, Math.sin(Number(azimuth) || 0)),
      scale(north, Math.cos(Number(azimuth) || 0)),
    ),
    east,
  );
  const safePolar = clamp(Number(polar) || 0, 0.001, Math.PI - 0.001);
  const safeRadius = Math.max(0, finiteNumber(radius, 0));
  const offset = add(
    scale(heading, safeRadius * Math.sin(safePolar)),
    scale(up, safeRadius * Math.cos(safePolar)),
  );
  return {
    up,
    east,
    north,
    offset,
  };
}
