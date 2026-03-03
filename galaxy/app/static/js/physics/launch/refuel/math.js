import { scale } from "../launchMath.js";

export function vectorMagnitude(v) {
  if (!v) {
    return 0;
  }
  const x = Number(v.x) || 0;
  const y = Number(v.y) || 0;
  const z = Number(v.z) || 0;
  return Math.sqrt((x * x) + (y * y) + (z * z));
}

export function vectorDot(a, b) {
  return ((Number(a?.x) || 0) * (Number(b?.x) || 0))
    + ((Number(a?.y) || 0) * (Number(b?.y) || 0))
    + ((Number(a?.z) || 0) * (Number(b?.z) || 0));
}

export function clampVectorMagnitude(v, maxMagnitude) {
  const limit = Math.max(0, Number(maxMagnitude) || 0);
  const magnitude = vectorMagnitude(v);
  if (!(limit > 1e-12) || magnitude <= limit || magnitude <= 1e-12) {
    return {
      x: Number(v?.x) || 0,
      y: Number(v?.y) || 0,
      z: Number(v?.z) || 0,
    };
  }
  return scale(v, limit / magnitude);
}
