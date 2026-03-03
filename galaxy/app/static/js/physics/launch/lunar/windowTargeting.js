import {
  clamp,
  cross,
  dot,
  length,
  normalize,
  rad,
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

export function normalizeAngleZeroToTau(angleRad) {
  if (!Number.isFinite(Number(angleRad))) {
    return 0;
  }
  const tau = Math.PI * 2;
  let value = Number(angleRad) % tau;
  if (value < 0) {
    value += tau;
  }
  return value;
}

export function moonWindowInjectPhaseAngleRad({
  earthState,
  moonState,
  inclinationDeg = 28.5,
} = {}) {
  if (
    !earthState
    || !moonState
    || !finiteVector(earthState.position)
    || !finiteVector(moonState.position)
  ) {
    return Number.NaN;
  }
  const moonRel = subtract(moonState.position, earthState.position);
  const moonRelMag = length(moonRel);
  if (!(moonRelMag > 1e-9)) {
    return Number.NaN;
  }
  const moonDir = normalize(moonRel, { x: 1, y: 0, z: 0 });
  const incRad = rad(clamp(Number(inclinationDeg) || 28.5, 0, 89.5));
  const e1 = { x: 1, y: 0, z: 0 };
  const e2 = normalize(
    { x: 0, y: Math.cos(incRad), z: Math.sin(incRad) },
    { x: 0, y: 1, z: 0 },
  );
  const planeNormal = normalize(cross(e1, e2), { x: 0, y: 0, z: 1 });
  const moonProj = subtract(moonDir, scale(planeNormal, dot(moonDir, planeNormal)));
  const moonProjMag = length(moonProj);
  if (!(moonProjMag > 1e-9)) {
    return Number.NaN;
  }
  const moonProjDir = normalize(moonProj, e1);
  const moonPhaseRad = Math.atan2(dot(moonProjDir, e2), dot(moonProjDir, e1));
  return normalizeAngleZeroToTau(moonPhaseRad - (Math.PI * 0.5));
}
