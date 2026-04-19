import {
  add,
  clamp,
  dot,
  normalize,
  scale,
  subtract,
} from "../launchMath.js";

function finiteVector(v) {
  return Boolean(
    v
    && Number.isFinite(Number(v.x))
    && Number.isFinite(Number(v.y))
    && Number.isFinite(Number(v.z)),
  );
}

export function enforceMoonEarthAvoidanceDirection({
  missionPhase = "",
  commandPhase = "",
  direction,
  tangent,
  up,
  previousApplied = false,
  toMoonVectorKm = null,
  earthDistanceKm = Number.POSITIVE_INFINITY,
  earthRadiusKm = 6371.0084,
  periapsisKm = Number.NaN,
} = {}) {
  const baseDirection = normalize(direction, tangent);
  const phase = String(commandPhase || "").toLowerCase();
  if (phase !== "powered") {
    return {
      direction: baseDirection,
      applied: false,
      reason: "",
    };
  }

  const moonTransferBurn = missionPhase === "tli_burn" || missionPhase === "coast_to_moon";
  if (!moonTransferBurn) {
    return {
      direction: baseDirection,
      applied: false,
      reason: "",
    };
  }

  const safeEarthRadiusKm = Math.max(1000, Number(earthRadiusKm) || 6371.0084);
  const altitudeKm = Number(earthDistanceKm) - safeEarthRadiusKm;
  const guardWasApplied = Boolean(previousApplied);
  const lowEarthRisk = Number.isFinite(altitudeKm) && altitudeKm < (guardWasApplied ? 125 : 120);
  const periapsisRisk = Number.isFinite(Number(periapsisKm))
    && Number(periapsisKm) < (guardWasApplied ? 165 : 152);
  const moonDirection = finiteVector(toMoonVectorKm) ? normalize(toMoonVectorKm, tangent) : null;
  const moonOccludedByEarth = Boolean(moonDirection && dot(moonDirection, up) < 0);
  const radialComponent = dot(baseDirection, up);
  const inwardBurn = radialComponent < (guardWasApplied ? 0.03 : -0.005);
  if (!(lowEarthRisk && (inwardBurn || moonOccludedByEarth || periapsisRisk))) {
    return {
      direction: baseDirection,
      applied: false,
      reason: "",
    };
  }

  const altitudeRisk = lowEarthRisk
    ? clamp((120 - Math.max(0, altitudeKm)) / 120, 0, 1)
    : 0;
  const periRisk = periapsisRisk
    ? clamp((150 - Number(periapsisKm)) / 150, 0, 1)
    : 0;
  const occlusionRisk = moonOccludedByEarth ? 0.75 : 0;
  const risk = clamp(Math.max(altitudeRisk, periRisk, occlusionRisk), 0, 1);
  const minOutwardRadial = clamp(0.06 + (0.28 * risk), 0.06, 0.42);
  const tangentialVector = subtract(baseDirection, scale(up, radialComponent));
  const tangentialDirection = normalize(tangentialVector, tangent);
  const tangentialWeight = Math.sqrt(Math.max(0, 1 - (minOutwardRadial * minOutwardRadial)));
  return {
    direction: normalize(
      add(scale(tangentialDirection, tangentialWeight), scale(up, minOutwardRadial)),
      tangentialDirection,
    ),
    applied: true,
    reason: moonOccludedByEarth
      ? "earth-occlusion-guard"
      : (periapsisRisk ? "periapsis-protect-guard" : "low-earth-clearance-guard"),
  };
}
