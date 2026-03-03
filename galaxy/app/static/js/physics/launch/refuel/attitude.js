import { add, clamp, cross, normalize, scale, subtract } from "../launchMath.js";
import { vectorDot, vectorMagnitude } from "./math.js";

const EPSILON = 1e-9;

function orthogonalUnit(axis) {
  const safeAxis = normalize(axis || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const seed = Math.abs(Number(safeAxis.z) || 0) < 0.92
    ? { x: 0, y: 0, z: 1 }
    : { x: 1, y: 0, z: 0 };
  const ortho = cross(safeAxis, seed);
  return normalize(ortho, { x: 1, y: 0, z: 0 });
}

function axisAngleRad(a, b) {
  const ua = normalize(a || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const ub = normalize(b || { x: 0, y: 0, z: 1 }, ua);
  return Math.acos(clamp(vectorDot(ua, ub), -1, 1));
}

function rotateTowardDirection(currentAxis, targetAxis, maxTurnRad) {
  const current = normalize(currentAxis || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const target = normalize(targetAxis || { x: 0, y: 0, z: 1 }, current);
  const turnLimit = Math.max(0, Number(maxTurnRad) || 0);
  if (!(turnLimit > EPSILON)) {
    return current;
  }
  const angle = axisAngleRad(current, target);
  if (!(angle > EPSILON)) {
    return target;
  }
  if (angle <= turnLimit) {
    return target;
  }
  const ratio = clamp(turnLimit / angle, 0, 1);
  return normalize(
    add(
      scale(current, 1 - ratio),
      scale(target, ratio),
    ),
    target,
  );
}

function coneLimitedDirection(axis, desiredAxis, coneRad) {
  const safeAxis = normalize(axis || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const safeDesired = normalize(desiredAxis || safeAxis, safeAxis);
  const safeConeRad = clamp(Number(coneRad) || 0, 0, Math.PI);
  const alignment = clamp(vectorDot(safeDesired, safeAxis), -1, 1);
  const desiredAngle = Math.acos(alignment);
  if (desiredAngle <= safeConeRad + 1e-6) {
    return safeDesired;
  }
  const tangent = subtract(safeDesired, scale(safeAxis, alignment));
  const tangentDir = normalize(tangent, orthogonalUnit(safeAxis));
  return normalize(
    add(
      scale(safeAxis, Math.cos(safeConeRad)),
      scale(tangentDir, Math.sin(safeConeRad)),
    ),
    safeAxis,
  );
}

export function applyAttitudeLimitedAcceleration({
  commandedAccelKmS2,
  currentAxisKm,
  fallbackAxisKm,
  dtSeconds = 0,
  maxTurnRateDegPerSec = 22,
  controlConeDeg = 28,
  freeAxisAccelKmS2 = 0.00008,
  freeConeDeg = 82,
} = {}) {
  const commanded = {
    x: Number(commandedAccelKmS2?.x) || 0,
    y: Number(commandedAccelKmS2?.y) || 0,
    z: Number(commandedAccelKmS2?.z) || 0,
  };
  const commandedMagKmS2 = vectorMagnitude(commanded);
  const fallbackAxis = normalize(fallbackAxisKm || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const baseAxis = normalize(currentAxisKm || fallbackAxis, fallbackAxis);
  if (!(commandedMagKmS2 > EPSILON)) {
    return {
      thrustAxisKm: baseAxis,
      desiredAxisKm: baseAxis,
      appliedAccelKmS2: { x: 0, y: 0, z: 0 },
      commandedAccelMagKmS2: 0,
      appliedAccelMagKmS2: 0,
      attitudeErrorDeg: 0,
      attitudeLimited: false,
      attitudeAuthority: 1,
      controlConeDeg: clamp(Number(controlConeDeg) || 0, 0, 180),
    };
  }

  const desiredAxisKm = scale(commanded, 1 / commandedMagKmS2);
  const dt = Math.max(0, Number(dtSeconds) || 0);
  const maxTurnRad = ((Math.PI / 180) * Math.max(0, Number(maxTurnRateDegPerSec) || 0)) * dt;
  const thrustAxisKm = rotateTowardDirection(baseAxis, desiredAxisKm, maxTurnRad);
  const freeAxisAccel = Math.max(0, Number(freeAxisAccelKmS2) || 0);
  const activeConeDeg = commandedMagKmS2 <= freeAxisAccel
    ? clamp(Number(freeConeDeg) || 0, 0, 180)
    : clamp(Number(controlConeDeg) || 0, 0, 180);
  const activeConeRad = (Math.PI / 180) * activeConeDeg;
  const limitedDirection = coneLimitedDirection(thrustAxisKm, desiredAxisKm, activeConeRad);
  const attitudeErrorDeg = (180 / Math.PI) * axisAngleRad(thrustAxisKm, desiredAxisKm);
  const authority = clamp(vectorDot(limitedDirection, desiredAxisKm), 0, 1);
  const appliedAccelMagKmS2 = commandedMagKmS2 * authority;
  const appliedAccelKmS2 = appliedAccelMagKmS2 > EPSILON
    ? scale(limitedDirection, appliedAccelMagKmS2)
    : { x: 0, y: 0, z: 0 };

  return {
    thrustAxisKm,
    desiredAxisKm,
    appliedAccelKmS2,
    commandedAccelMagKmS2: commandedMagKmS2,
    appliedAccelMagKmS2,
    attitudeErrorDeg,
    attitudeLimited: authority < 0.999,
    attitudeAuthority: authority,
    controlConeDeg: activeConeDeg,
  };
}
