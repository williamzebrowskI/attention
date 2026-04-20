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

export function quaternionIdentity() {
  return { x: 0, y: 0, z: 0, w: 1 };
}

export function normalizeQuaternion(q, fallback = quaternionIdentity()) {
  const qx = Number(q?.x) || 0;
  const qy = Number(q?.y) || 0;
  const qz = Number(q?.z) || 0;
  const qw = Number(q?.w) || 0;
  const mag = Math.sqrt((qx * qx) + (qy * qy) + (qz * qz) + (qw * qw));
  if (!(mag > EPSILON)) {
    return { ...fallback };
  }
  return {
    x: qx / mag,
    y: qy / mag,
    z: qz / mag,
    w: qw / mag,
  };
}

export function quaternionConjugate(q) {
  return {
    x: -(Number(q?.x) || 0),
    y: -(Number(q?.y) || 0),
    z: -(Number(q?.z) || 0),
    w: Number(q?.w) || 1,
  };
}

export function multiplyQuaternions(a, b) {
  const ax = Number(a?.x) || 0;
  const ay = Number(a?.y) || 0;
  const az = Number(a?.z) || 0;
  const aw = Number(a?.w) || 1;
  const bx = Number(b?.x) || 0;
  const by = Number(b?.y) || 0;
  const bz = Number(b?.z) || 0;
  const bw = Number(b?.w) || 1;
  return {
    x: (aw * bx) + (ax * bw) + (ay * bz) - (az * by),
    y: (aw * by) - (ax * bz) + (ay * bw) + (az * bx),
    z: (aw * bz) + (ax * by) - (ay * bx) + (az * bw),
    w: (aw * bw) - (ax * bx) - (ay * by) - (az * bz),
  };
}

export function quaternionFromAxisAngle(axis, angleRad) {
  const unitAxis = unitOrNull(axis);
  if (!unitAxis || !Number.isFinite(angleRad)) {
    return quaternionIdentity();
  }
  const half = angleRad * 0.5;
  const s = Math.sin(half);
  return normalizeQuaternion({
    x: unitAxis.x * s,
    y: unitAxis.y * s,
    z: unitAxis.z * s,
    w: Math.cos(half),
  });
}

export function quaternionFromUnitVectors(from, to) {
  const a = unitOrNull(from);
  const b = unitOrNull(to);
  if (!a || !b) {
    return quaternionIdentity();
  }
  const cosTheta = clamp(dot(a, b), -1, 1);
  if (cosTheta > 1 - 1e-9) {
    return quaternionIdentity();
  }
  if (cosTheta < -1 + 1e-9) {
    const fallbackAxis = unitOrNull(cross({ x: 1, y: 0, z: 0 }, a))
      || unitOrNull(cross({ x: 0, y: 1, z: 0 }, a))
      || { x: 0, y: 0, z: 1 };
    return quaternionFromAxisAngle(fallbackAxis, Math.PI);
  }
  const axis = cross(a, b);
  const s = Math.sqrt((1 + cosTheta) * 2);
  const invS = 1 / Math.max(s, EPSILON);
  return normalizeQuaternion({
    x: axis.x * invS,
    y: axis.y * invS,
    z: axis.z * invS,
    w: s * 0.5,
  });
}

export function rotateVectorByQuaternion(v, q) {
  const vectorQuat = {
    x: Number(v?.x) || 0,
    y: Number(v?.y) || 0,
    z: Number(v?.z) || 0,
    w: 0,
  };
  const rotation = normalizeQuaternion(q);
  const rotated = multiplyQuaternions(
    multiplyQuaternions(rotation, vectorQuat),
    quaternionConjugate(rotation),
  );
  return { x: rotated.x, y: rotated.y, z: rotated.z };
}
