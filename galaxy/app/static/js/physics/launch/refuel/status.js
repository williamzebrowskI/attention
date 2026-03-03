import { clamp } from "../launchMath.js";
import { REFUEL_TANKER_CONFIG } from "./config.js";

export function finiteNonNegative(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, Number(fallback) || 0);
  }
  return Math.max(0, numeric);
}

export function normalizedTargetFillFraction(value, fallback = REFUEL_TANKER_CONFIG.targetFillFraction) {
  return clamp(
    Number.isFinite(Number(value)) ? Number(value) : Number(fallback),
    0.25,
    1,
  );
}
