import {
  angleBetweenRadians,
  degrees,
  normalize,
} from "../launchMath.js";
import { MOON_BURN_ATTITUDE_GATE_RELEASE_DWELL_SEC } from "./constants.js";

function finiteDirection(vector) {
  return Boolean(
    vector
    && Number.isFinite(Number(vector.x))
    && Number.isFinite(Number(vector.y))
    && Number.isFinite(Number(vector.z))
  );
}

export function evaluateMoonBurnAttitudeGate({
  gateEligible = false,
  gateWasActive = false,
  currentAxis = null,
  desiredDirection = null,
  latchedDirection = null,
  alignStableSec = 0,
  dtSeconds = 0,
  enterErrorDeg = 5,
  exitErrorDeg = 2,
  releaseDwellSec = MOON_BURN_ATTITUDE_GATE_RELEASE_DWELL_SEC,
} = {}) {
  const fallbackDirection = normalize(desiredDirection || currentAxis || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const desiredAxis = normalize(desiredDirection || fallbackDirection, fallbackDirection);
  const shipAxis = normalize(currentAxis || desiredAxis, desiredAxis);
  const enterThresholdDeg = Math.max(0, Number(enterErrorDeg) || 0);
  const exitThresholdDeg = Math.max(0, Number(exitErrorDeg) || 0);
  const releaseHoldSec = Math.max(0, Number(releaseDwellSec) || 0);
  const safeDt = Math.max(0, Number(dtSeconds) || 0);
  let gateActive = Boolean(gateWasActive);
  let latchedAxis = finiteDirection(latchedDirection)
    ? normalize(latchedDirection, desiredAxis)
    : null;
  let alignedTimeSec = Math.max(0, Number(alignStableSec) || 0);

  const desiredErrorDeg = degrees(angleBetweenRadians(shipAxis, desiredAxis));
  if (!gateActive && gateEligible && desiredErrorDeg > enterThresholdDeg) {
    gateActive = true;
    latchedAxis = desiredAxis;
    alignedTimeSec = 0;
  }
  if (!gateActive) {
    return {
      gateActive: false,
      throttleSuppressed: false,
      requestedDirection: desiredAxis,
      latchedDirection: null,
      alignStableSec: 0,
      attitudeErrorDeg: desiredErrorDeg,
    };
  }

  const gateTarget = normalize(latchedAxis || desiredAxis, desiredAxis);
  const gateErrorDeg = degrees(angleBetweenRadians(shipAxis, gateTarget));
  const aligned = gateErrorDeg <= exitThresholdDeg;
  alignedTimeSec = aligned
    ? Math.min(releaseHoldSec, alignedTimeSec + safeDt)
    : 0;
  const releaseReady = aligned && alignedTimeSec + 1e-6 >= releaseHoldSec;
  if (releaseReady) {
    return {
      gateActive: false,
      throttleSuppressed: false,
      requestedDirection: desiredAxis,
      latchedDirection: null,
      alignStableSec: 0,
      attitudeErrorDeg: gateErrorDeg,
    };
  }

  return {
    gateActive: true,
    throttleSuppressed: true,
    requestedDirection: gateTarget,
    latchedDirection: gateTarget,
    alignStableSec: alignedTimeSec,
    attitudeErrorDeg: gateErrorDeg,
  };
}
