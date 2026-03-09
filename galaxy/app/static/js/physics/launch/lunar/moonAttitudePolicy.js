import { LAUNCH_MISSION_IDS } from "../launchMissions.js";
import { LAUNCH_RCS_CONFIG } from "../launchConfig.js";
import {
  clamp,
  cross,
  dot,
  length,
  mixVectors,
  normalize,
  rad,
  scale,
  subtract,
} from "../launchMath.js";

function finiteVectorValue(value) {
  return Boolean(
    value
    && Number.isFinite(Number(value.x))
    && Number.isFinite(Number(value.y))
    && Number.isFinite(Number(value.z))
  );
}

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function unitVectorOrNull(value) {
  if (!finiteVectorValue(value)) {
    return null;
  }
  const magnitude = length(value);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-9) {
    return null;
  }
  return scale(value, 1 / magnitude);
}

function alignmentAngleDeg(alignment) {
  if (!Number.isFinite(Number(alignment))) {
    return null;
  }
  return Math.acos(clamp(Number(alignment), -1, 1)) * (180 / Math.PI);
}

function classifyMoonAimState(alignment) {
  if (!Number.isFinite(Number(alignment))) {
    return "n/a";
  }
  if (alignment >= 0.35) {
    return "toward";
  }
  if (alignment <= -0.35) {
    return "away";
  }
  return "sideways";
}

function orthogonalUnit(axis) {
  const safeAxis = normalize(axis || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const seed = Math.abs(Number(safeAxis.z) || 0) < 0.92
    ? { x: 0, y: 0, z: 1 }
    : { x: 1, y: 0, z: 0 };
  return normalize(cross(safeAxis, seed), { x: 1, y: 0, z: 0 });
}

function angleBetweenRad(a, b) {
  const ua = unitVectorOrNull(a);
  const ub = unitVectorOrNull(b);
  if (!ua || !ub) {
    return 0;
  }
  return Math.acos(clamp(dot(ua, ub), -1, 1));
}

function rotateTowardDirection(currentAxis, targetAxis, maxTurnRad) {
  const current = normalize(currentAxis || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const target = normalize(targetAxis || current, current);
  const turnLimit = Math.max(0, Number(maxTurnRad) || 0);
  if (!(turnLimit > 1e-9)) {
    return current;
  }
  const angle = angleBetweenRad(current, target);
  if (!(angle > 1e-9)) {
    return target;
  }
  if (angle <= turnLimit) {
    return target;
  }
  const blend = clamp(turnLimit / angle, 0, 1);
  return normalize(mixVectors(current, target, blend), target);
}

function rcsJetSelection(correctionDir, referenceForward, referenceUp) {
  const jets = [];
  const forward = unitVectorOrNull(referenceForward) || { x: 0, y: 1, z: 0 };
  const upSeed = unitVectorOrNull(referenceUp) || orthogonalUnit(forward);
  const right = unitVectorOrNull(cross(forward, upSeed)) || orthogonalUnit(forward);
  const vertical = unitVectorOrNull(cross(right, forward)) || upSeed;
  const threshold = 0.2;
  const side = dot(correctionDir, right);
  const verticalComp = dot(correctionDir, vertical);
  const forwardComp = dot(correctionDir, forward);

  if (side > threshold) {
    jets.push("starboard");
  } else if (side < -threshold) {
    jets.push("port");
  }

  if (verticalComp > threshold) {
    jets.push("dorsal");
  } else if (verticalComp < -threshold) {
    jets.push("ventral");
  }

  if (forwardComp > threshold) {
    jets.push("aft");
  } else if (forwardComp < -threshold) {
    jets.push("forward");
  }
  return jets;
}

function resolveMoonCoastAttitudeAssist({
  currentDirection,
  moonDirection,
  fallbackDirection,
  dtSeconds = 0,
} = {}) {
  const currentAxis = normalize(
    currentDirection || fallbackDirection || moonDirection || { x: 0, y: 0, z: 1 },
    fallbackDirection || moonDirection || { x: 0, y: 0, z: 1 },
  );
  const targetAxis = normalize(moonDirection || currentAxis, currentAxis);
  const maxTurnRateDegS = Math.max(0.1, Number(LAUNCH_RCS_CONFIG?.moonCoastTurnRateDegS) || 3.0);
  const maxTurnRad = rad(maxTurnRateDegS) * Math.max(0, Number(dtSeconds) || 0);
  const requestedDirection = rotateTowardDirection(currentAxis, targetAxis, maxTurnRad);
  const errorRad = angleBetweenRad(currentAxis, targetAxis);
  const errorDeg = errorRad * (180 / Math.PI);
  const authority = clamp(
    (errorDeg - Number(LAUNCH_RCS_CONFIG?.deadbandDeg || 0.8))
      / Math.max((Number(LAUNCH_RCS_CONFIG?.moonCoastFullAuthorityDeg) || 18) - Number(LAUNCH_RCS_CONFIG?.deadbandDeg || 0.8), 0.1),
    0,
    1,
  );
  const lateralCorrection = subtract(targetAxis, scale(currentAxis, dot(targetAxis, currentAxis)));
  const correctionDir = unitVectorOrNull(lateralCorrection);
  return {
    requestedDirection,
    active: Boolean(correctionDir) && authority > 1e-4,
    errorDeg,
    authority,
    jets: correctionDir ? rcsJetSelection(correctionDir, currentAxis, fallbackDirection || orthogonalUnit(currentAxis)) : [],
  };
}

export function resolveMoonMissionAttitudeDirection({
  missionId,
  missionPhase,
  requestedThrottle,
  desiredDirection,
  toMoonVectorKm,
  fallbackDirection,
  currentDirection,
  dtSeconds = 0,
} = {}) {
  const fallback = normalize(
    fallbackDirection || currentDirection || desiredDirection || toMoonVectorKm || { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: 1 },
  );
  const desired = normalize(desiredDirection || fallback, fallback);
  const moonDirection = finiteVectorValue(toMoonVectorKm)
    ? normalize(toMoonVectorKm, desired)
    : desired;
  const passiveMoonCoastPointing = (
    String(missionId || "") === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
    && String(missionPhase || "") === "coast_to_moon"
    && !(Number(requestedThrottle) > 1e-3)
    && finiteVectorValue(toMoonVectorKm)
  );
  const passiveMoonCoastAttitudeAssist = passiveMoonCoastPointing
    ? resolveMoonCoastAttitudeAssist({
      currentDirection: currentDirection || desired,
      moonDirection,
      fallbackDirection: fallback,
      dtSeconds,
    })
    : {
      requestedDirection: desired,
      active: false,
      errorDeg: 0,
      authority: 0,
      jets: [],
    };
  return {
    requestedDirection: passiveMoonCoastPointing
      ? passiveMoonCoastAttitudeAssist.requestedDirection
      : desired,
    passiveMoonCoastPointing,
    passiveMoonCoastAttitudeAssist,
  };
}

export function computeMoonAimTelemetry({
  requestedDirectionKm,
  bodyAxisDirectionKm,
  moonRelativePositionKm,
} = {}) {
  const moonDirectionUnit = unitVectorOrNull(moonRelativePositionKm);
  const requestedDirectionUnit = unitVectorOrNull(requestedDirectionKm);
  const bodyAxisDirectionUnit = unitVectorOrNull(bodyAxisDirectionKm);
  const guidanceMoonAlignment = requestedDirectionUnit && moonDirectionUnit
    ? clamp(dot(requestedDirectionUnit, moonDirectionUnit), -1, 1)
    : null;
  const bodyMoonAlignment = bodyAxisDirectionUnit && moonDirectionUnit
    ? clamp(dot(bodyAxisDirectionUnit, moonDirectionUnit), -1, 1)
    : null;
  return {
    guidanceMoonState: classifyMoonAimState(guidanceMoonAlignment),
    guidanceMoonAlignment: finiteOrNull(guidanceMoonAlignment),
    guidanceMoonAngleDeg: finiteOrNull(alignmentAngleDeg(guidanceMoonAlignment)),
    bodyMoonState: classifyMoonAimState(bodyMoonAlignment),
    bodyMoonAlignment: finiteOrNull(bodyMoonAlignment),
    bodyMoonAngleDeg: finiteOrNull(alignmentAngleDeg(bodyMoonAlignment)),
  };
}
