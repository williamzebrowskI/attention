import { add, clamp, cross, dot, normalize, scale, subtract } from "../launchMath.js";

function finiteVector(v) {
  return Boolean(
    v
    && Number.isFinite(Number(v.x))
    && Number.isFinite(Number(v.y))
    && Number.isFinite(Number(v.z)),
  );
}

function fallbackCross(along, radial) {
  const raw = cross(along, radial);
  const fallback = Math.abs(Number(radial.z) || 0) < 0.9
    ? { x: 0, y: 0, z: 1 }
    : { x: 1, y: 0, z: 0 };
  return normalize(raw, normalize(cross(along, fallback), { x: 0, y: 1, z: 0 }));
}

export function orbitalRelativeFrame({
  prograde = null,
  up = null,
} = {}) {
  const radial = normalize(up || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const alongSeed = normalize(prograde || { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const along = normalize(
    subtract(alongSeed, scale(radial, dot(alongSeed, radial))),
    alongSeed,
  );
  const crossTrack = fallbackCross(along, radial);
  return { along, radial, crossTrack };
}

export function computePhaseCatchupCommand({
  targetRelativePositionKm = null,
  targetRelativeVelocityKmS = null,
  refuelDistanceKm = 0,
  frame = null,
  altitudeErrorKm = 0,
  radialSpeedErrorKmS = 0,
  speedExcessKmS = 0,
} = {}) {
  if (!finiteVector(targetRelativePositionKm) || !finiteVector(targetRelativeVelocityKmS)) {
    return null;
  }
  const safeFrame = frame || orbitalRelativeFrame({});
  const along = safeFrame.along;
  const radial = safeFrame.radial;
  const crossTrack = safeFrame.crossTrack;

  const alongKm = dot(targetRelativePositionKm, along);
  const radialKm = dot(targetRelativePositionKm, radial);
  const crossKm = dot(targetRelativePositionKm, crossTrack);
  const alongRateKmS = dot(targetRelativeVelocityKmS, along);
  const radialRateKmS = dot(targetRelativeVelocityKmS, radial);
  const crossRateKmS = dot(targetRelativeVelocityKmS, crossTrack);

  const targetAhead = alongKm >= 0;
  const phaseDirection = targetAhead ? scale(along, -1) : along;
  const phaseMode = targetAhead ? "lower" : "raise";

  const posHorizontal = subtract(targetRelativePositionKm, scale(radial, dot(targetRelativePositionKm, radial)));
  const horizontalToTarget = normalize(posHorizontal, phaseDirection);
  const phaseWeight = clamp(0.66 + Math.min(Math.abs(alongKm) / 1400, 0.2), 0.62, 0.86);
  const interceptWeight = 1 - phaseWeight;
  const radialBias = clamp(
    (radialKm / 220) + (altitudeErrorKm / 260) + (radialSpeedErrorKmS / 0.08) - (radialRateKmS / 0.05),
    -0.22,
    0.22,
  );
  const crossBias = clamp((crossKm / 180) - (crossRateKmS / 0.03), -0.16, 0.16);

  const desiredDirection = normalize(
    add(
      scale(phaseDirection, phaseWeight),
      add(
        scale(horizontalToTarget, interceptWeight),
        add(
          scale(radial, radialBias),
          scale(crossTrack, crossBias),
        ),
      ),
    ),
    phaseDirection,
  );

  let throttle = clamp(
    0.06
      + (Math.max(0, Number(refuelDistanceKm) || 0) / 180_000)
      + Math.min(Math.abs(alongKm) / 30_000, 0.08),
    0.06,
    0.20,
  );
  if (speedExcessKmS > 0.03) {
    throttle *= clamp(1 - (speedExcessKmS / 0.24), 0.15, 1);
  }
  if (targetAhead) {
    throttle = Math.min(throttle, 0.16);
  }
  if (Math.abs(radialKm) > 40 || Math.abs(crossKm) > 40) {
    throttle = Math.max(throttle, 0.11);
  }

  return {
    desiredDirection,
    throttle: clamp(throttle, 0.06, 0.20),
    phaseMode,
    alongKm,
    radialKm,
    crossKm,
    alongRateKmS,
    radialRateKmS,
    crossRateKmS,
  };
}
