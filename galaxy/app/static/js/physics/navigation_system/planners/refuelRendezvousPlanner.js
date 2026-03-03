import {
  add,
  clamp,
  dot,
  length,
  normalize,
  scale,
} from "../navigationMath.js";
import { REFUEL_TANKER_CONFIG } from "../../launch/refuel/config.js";

export function planRefuelRendezvousCommand({
  targetVectors = {},
  metrics = {},
  tangent = null,
} = {}) {
  const tangentDirection = normalize(tangent || targetVectors.tangent, { x: 0, y: 1, z: 0 });
  const refuelDistanceKm = Number(metrics.refuelTargetDistanceKm);
  const refuelRelativeSpeedKmS = Number(metrics.refuelRelativeSpeedKmS);
  const refuelRelativeVelocityKmS = targetVectors.refuelTargetRelativeVelocityKmS;
  const toRefuelTarget = targetVectors.toRefuelTarget;

  if (!Number.isFinite(refuelDistanceKm) || !toRefuelTarget) {
    return {
      phase: "coast",
      throttle: 0,
      direction: tangentDirection,
      mode: "navsys:orbital-refuel-await-target",
    };
  }
  const dockDistanceKm = Number(REFUEL_TANKER_CONFIG.dockDistanceKm) || 0.014;
  const dockSpeedKmS = Number(REFUEL_TANKER_CONFIG.dockMaxRelativeSpeedKmS) || 0.000045;
  const directionToTarget = normalize(toRefuelTarget, tangentDirection);
  const targetMinusShipRelVel = refuelRelativeVelocityKmS || { x: 0, y: 0, z: 0 };
  const shipMinusTargetRelVel = scale(targetMinusShipRelVel, -1);
  const relativeSpeedKmS = Number.isFinite(refuelRelativeSpeedKmS)
    ? Math.max(0, refuelRelativeSpeedKmS)
    : length(targetMinusShipRelVel);
  const closingSpeedKmS = Number.isFinite(refuelDistanceKm) && refuelDistanceKm > 1e-9
    ? dot(shipMinusTargetRelVel, directionToTarget)
    : 0;
  if (refuelDistanceKm <= dockDistanceKm && relativeSpeedKmS <= dockSpeedKmS) {
    return {
      phase: "coast",
      throttle: 0,
      direction: tangentDirection,
      mode: "navsys:orbital-refuel-docked-hold",
    };
  }

  if (refuelDistanceKm > 15) {
    const throttle = clamp(0.12 + (refuelDistanceKm / 220), 0.12, 0.34);
    const direction = normalize(
      add(
        scale(directionToTarget, 0.92),
        scale(tangentDirection, 0.08),
      ),
      directionToTarget,
    );
    return {
      phase: "powered",
      throttle,
      direction,
      mode: "navsys:orbital-refuel-rendezvous-far",
    };
  }

  if (refuelDistanceKm > 1.5) {
    const velocityDampingDir = normalize(scale(shipMinusTargetRelVel, -1), directionToTarget);
    const direction = normalize(
      add(
        scale(directionToTarget, 0.72),
        scale(velocityDampingDir, 0.28),
      ),
      directionToTarget,
    );
    const throttle = clamp(
      0.028 + (refuelDistanceKm / 120) + (relativeSpeedKmS * 28),
      0.02,
      0.12,
    );
    return {
      phase: "powered",
      throttle,
      direction,
      mode: "navsys:orbital-refuel-rendezvous-mid",
    };
  }

  const desiredClosingKmS = clamp(refuelDistanceKm * 0.00009, 0.00001, 0.00008);
  if (closingSpeedKmS > (desiredClosingKmS * 1.35) || relativeSpeedKmS > 0.00028) {
    const brakeDirection = normalize(scale(shipMinusTargetRelVel, -1), scale(directionToTarget, -1));
    return {
      phase: "powered",
      throttle: clamp(0.003 + (relativeSpeedKmS * 22), 0.003, 0.03),
      direction: brakeDirection,
      mode: "navsys:orbital-refuel-brake",
    };
  }

  const closeApproachDirection = normalize(
    add(
      scale(directionToTarget, 0.58),
      scale(normalize(scale(shipMinusTargetRelVel, -1), directionToTarget), 0.42),
    ),
    directionToTarget,
  );
  return {
    phase: "powered",
    throttle: clamp(0.002 + (refuelDistanceKm * 0.01), 0.002, 0.02),
    direction: closeApproachDirection,
    mode: "navsys:orbital-refuel-final-approach",
  };
}
