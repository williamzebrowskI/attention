import { normalize } from "../navigationMath.js";

export function planEarthOrbitHoldCommand({
  targetVectors = {},
} = {}) {
  return {
    phase: "coast",
    throttle: 0,
    direction: normalize(targetVectors.tangent, { x: 0, y: 1, z: 0 }),
    mode: "navsys:earth-orbit-hold",
  };
}
