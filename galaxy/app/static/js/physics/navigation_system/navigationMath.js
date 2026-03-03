export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function add(a, b) {
  return {
    x: (Number(a?.x) || 0) + (Number(b?.x) || 0),
    y: (Number(a?.y) || 0) + (Number(b?.y) || 0),
    z: (Number(a?.z) || 0) + (Number(b?.z) || 0),
  };
}

export function subtract(a, b) {
  return {
    x: (Number(a?.x) || 0) - (Number(b?.x) || 0),
    y: (Number(a?.y) || 0) - (Number(b?.y) || 0),
    z: (Number(a?.z) || 0) - (Number(b?.z) || 0),
  };
}

export function scale(v, scalar) {
  const s = Number(scalar) || 0;
  return {
    x: (Number(v?.x) || 0) * s,
    y: (Number(v?.y) || 0) * s,
    z: (Number(v?.z) || 0) * s,
  };
}

export function dot(a, b) {
  return (
    ((Number(a?.x) || 0) * (Number(b?.x) || 0))
    + ((Number(a?.y) || 0) * (Number(b?.y) || 0))
    + ((Number(a?.z) || 0) * (Number(b?.z) || 0))
  );
}

export function length(v) {
  return Math.sqrt(dot(v, v));
}

export function normalize(v, fallback = { x: 0, y: 1, z: 0 }) {
  const magnitude = length(v);
  if (!(magnitude > 1e-12)) {
    return { ...fallback };
  }
  return scale(v, 1 / magnitude);
}

export function mixVectors(a, b, blend) {
  const t = clamp(Number(blend) || 0, 0, 1);
  return add(scale(a, 1 - t), scale(b, t));
}

export function finiteVector(v) {
  return Boolean(
    v
    && Number.isFinite(Number(v.x))
    && Number.isFinite(Number(v.y))
    && Number.isFinite(Number(v.z)),
  );
}
