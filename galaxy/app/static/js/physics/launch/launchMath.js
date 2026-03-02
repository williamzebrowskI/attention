const EPSILON = 1e-12;
const TWO_PI = Math.PI * 2;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function rad(degrees) {
  return (degrees * Math.PI) / 180;
}

export function degrees(valueRad) {
  return (valueRad * 180) / Math.PI;
}

export function length(v) {
  return Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z));
}

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(v, scalar) {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

export function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

export function cross(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

export function normalize(v, fallback = { x: 0, y: 0, z: 1 }) {
  const mag = length(v);
  if (!(mag > EPSILON)) {
    return { ...fallback };
  }
  return {
    x: v.x / mag,
    y: v.y / mag,
    z: v.z / mag,
  };
}

export function mixVectors(a, b, t) {
  const tt = clamp(t, 0, 1);
  return {
    x: (a.x * (1 - tt)) + (b.x * tt),
    y: (a.y * (1 - tt)) + (b.y * tt),
    z: (a.z * (1 - tt)) + (b.z * tt),
  };
}

export function unitOrNull(v) {
  const mag = length(v);
  if (!(mag > EPSILON)) {
    return null;
  }
  return { x: v.x / mag, y: v.y / mag, z: v.z / mag };
}

export function angleBetweenRadians(a, b) {
  const ua = unitOrNull(a);
  const ub = unitOrNull(b);
  if (!ua || !ub) {
    return 0;
  }
  const cosTheta = clamp(dot(ua, ub), -1, 1);
  return Math.acos(cosTheta);
}

export function normalizeAngleRadians(angle) {
  if (!Number.isFinite(angle)) {
    return 0;
  }
  let normalized = angle % TWO_PI;
  if (normalized < 0) {
    normalized += TWO_PI;
  }
  return normalized;
}
