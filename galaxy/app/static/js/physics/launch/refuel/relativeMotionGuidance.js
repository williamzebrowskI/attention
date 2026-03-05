import {
  clamp,
  cross,
  dot,
  length,
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

function safeNumber(value, fallback = Number.NaN) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildHillFrame({
  shipRelativePositionKm = null,
  shipRelativeVelocityKmS = null,
  fallbackPrograde = null,
} = {}) {
  const fallbackT = normalize(fallbackPrograde, { x: 0, y: 1, z: 0 });
  const radial = normalize(shipRelativePositionKm, { x: 0, y: 0, z: 1 });
  const angularMomentum = cross(
    shipRelativePositionKm || { x: 0, y: 0, z: 1 },
    shipRelativeVelocityKmS || fallbackT,
  );
  const normal = normalize(angularMomentum, { x: 0, y: 0, z: 1 });
  const tangential = normalize(cross(normal, radial), fallbackT);
  const correctedNormal = normalize(cross(radial, tangential), normal);
  return {
    radial,
    tangential,
    normal: correctedNormal,
  };
}

function toHillFrame(vector, frame) {
  return {
    x: dot(vector, frame.radial),
    y: dot(vector, frame.tangential),
    z: dot(vector, frame.normal),
  };
}

function fromHillFrame(vector, frame) {
  return {
    x: (frame.radial.x * vector.x) + (frame.tangential.x * vector.y) + (frame.normal.x * vector.z),
    y: (frame.radial.y * vector.x) + (frame.tangential.y * vector.y) + (frame.normal.y * vector.z),
    z: (frame.radial.z * vector.x) + (frame.tangential.z * vector.y) + (frame.normal.z * vector.z),
  };
}

function desiredClosingSpeedKmS(distanceKm) {
  const d = Math.max(0, Number(distanceKm) || 0);
  if (d > 160) {
    return clamp(d / 40_000, 0.002, 0.008);
  }
  if (d > 60) {
    return clamp(d / 32_000, 0.0015, 0.005);
  }
  if (d > 20) {
    return clamp(d / 24_000, 0.0008, 0.003);
  }
  if (d > 5) {
    return clamp(d / 16_000, 0.0003, 0.0012);
  }
  if (d > 1) {
    return clamp(d / 10_000, 0.00012, 0.0007);
  }
  return clamp(d / 5_000, 0.00004, 0.0003);
}

function controllerNaturalFrequency(distanceKm) {
  const d = Math.max(0, Number(distanceKm) || 0);
  if (d > 160) {
    return 0.0005;
  }
  if (d > 60) {
    return 0.0008;
  }
  if (d > 20) {
    return 0.0012;
  }
  if (d > 5) {
    return 0.0018;
  }
  if (d > 1) {
    return 0.0025;
  }
  return 0.0032;
}

function throttleCapForDistance(distanceKm) {
  const d = Math.max(0, Number(distanceKm) || 0);
  if (d > 160) {
    return 0.03;
  }
  if (d > 60) {
    return 0.02;
  }
  if (d > 20) {
    return 0.012;
  }
  if (d > 5) {
    return 0.008;
  }
  return 0.004;
}

function guidanceModeForDistance(distanceKm) {
  const d = Math.max(0, Number(distanceKm) || 0);
  if (d > 220) {
    return "navsys:orbital-refuel-coelliptic-phasing";
  }
  if (d > 12) {
    return "navsys:orbital-refuel-transfer-burn";
  }
  return "navsys:orbital-refuel-velocity-match";
}

export function computeHillRendezvousCommand({
  targetRelativePositionKm = null,
  targetRelativeVelocityKmS = null,
  shipRelativePositionKm = null,
  shipRelativeVelocityKmS = null,
  fallbackPrograde = null,
} = {}) {
  if (!finiteVector(targetRelativePositionKm) || !finiteVector(targetRelativeVelocityKmS)) {
    return null;
  }
  const rangeKm = Math.max(0, length(targetRelativePositionKm));
  if (!(rangeKm > 1e-9)) {
    return {
      requestedThrottle: 0,
      desiredDirection: normalize(fallbackPrograde, { x: 0, y: 1, z: 0 }),
      guidanceMode: "navsys:orbital-refuel-lock",
      diagnostics: {
        desiredClosingKmS: 0,
        closingSpeedKmS: 0,
        orbitalRateRadS: 0,
      },
    };
  }

  const frame = buildHillFrame({
    shipRelativePositionKm,
    shipRelativeVelocityKmS,
    fallbackPrograde,
  });

  const toTargetDirection = normalize(
    targetRelativePositionKm,
    normalize(fallbackPrograde, { x: 0, y: 1, z: 0 }),
  );
  const closingSpeedKmS = -dot(targetRelativeVelocityKmS, toTargetDirection);
  const desiredClosingKmS = desiredClosingSpeedKmS(rangeKm);

  const shipMinusTargetPositionKm = scale(targetRelativePositionKm, -1);
  const shipMinusTargetVelocityKmS = scale(targetRelativeVelocityKmS, -1);
  const relPosHill = toHillFrame(shipMinusTargetPositionKm, frame);
  const relVelHill = toHillFrame(shipMinusTargetVelocityKmS, frame);

  const angularMomentum = cross(
    shipRelativePositionKm || { x: 0, y: 0, z: 1 },
    shipRelativeVelocityKmS || { x: 0, y: 1, z: 0 },
  );
  const radiusKm = Math.max(1, length(shipRelativePositionKm || { x: 0, y: 0, z: 1 }));
  const orbitalRateRadS = clamp(
    length(angularMomentum) / Math.max(1e-6, radiusKm * radiusKm),
    0,
    0.01,
  );
  const wn = controllerNaturalFrequency(rangeKm);
  const zeta = 1.15;
  const kPos = wn * wn;
  const kVel = 2 * zeta * wn;
  const x = safeNumber(relPosHill.x, 0);
  const y = safeNumber(relPosHill.y, 0);
  const z = safeNumber(relPosHill.z, 0);
  const xDot = safeNumber(relVelHill.x, 0);
  const yDot = safeNumber(relVelHill.y, 0);
  const zDot = safeNumber(relVelHill.z, 0);

  // Clohessy-Wiltshire feedback linearization around LVLH frame.
  // relPos/relVel are ship-minus-target states in Hill axes.
  const accelHillKmS2 = {
    x: (-kPos * x) - (kVel * xDot) + (2 * orbitalRateRadS * yDot) + (3 * orbitalRateRadS * orbitalRateRadS * x),
    y: (-kPos * y) - (kVel * yDot) - (2 * orbitalRateRadS * xDot),
    z: (-kPos * z) - (kVel * zDot) - (orbitalRateRadS * orbitalRateRadS * z),
  };
  const accelCommandKmS2 = fromHillFrame(accelHillKmS2, frame);
  const accelMagnitudeKmS2 = Math.max(0, length(accelCommandKmS2));
  const accelDirection = normalize(accelCommandKmS2, toTargetDirection);

  const tooFastClosing = closingSpeedKmS > Math.max(
    desiredClosingKmS * 1.2,
    desiredClosingKmS + 0.00025,
  );
  if (rangeKm <= 2) {
    const rcsRequestedThrottle = clamp(accelMagnitudeKmS2 / 0.0022, 0, 0.0025);
    return {
      requestedThrottle: rcsRequestedThrottle,
      desiredDirection: accelDirection,
      guidanceMode: rcsRequestedThrottle > 1e-6
        ? "navsys:orbital-refuel-rcs-translate"
        : "navsys:orbital-refuel-velocity-match-coast",
      diagnostics: {
        desiredClosingKmS,
        closingSpeedKmS: safeNumber(closingSpeedKmS, 0),
        orbitalRateRadS: safeNumber(orbitalRateRadS, 0),
      },
    };
  }
  if (tooFastClosing) {
    const excessClosingKmS = Math.max(0, safeNumber(closingSpeedKmS, 0) - desiredClosingKmS);
    const brakeThrottleCap = rangeKm > 120
      ? 0.03
      : (rangeKm > 60 ? 0.02 : (rangeKm > 20 ? 0.015 : 0.01));
    const brakeDirection = normalize(
      scale(shipMinusTargetVelocityKmS, -1),
      scale(toTargetDirection, -1),
    );
    const blendedBrakeDirection = normalize(
      {
        x: (brakeDirection.x * 0.82) + (accelDirection.x * 0.18),
        y: (brakeDirection.y * 0.82) + (accelDirection.y * 0.18),
        z: (brakeDirection.z * 0.82) + (accelDirection.z * 0.18),
      },
      brakeDirection,
    );
    const brakeThrottle = rangeKm > 8
      ? clamp(0.0006 + (excessClosingKmS * 0.8), 0, brakeThrottleCap)
      : 0;
    return {
      requestedThrottle: brakeThrottle,
      desiredDirection: blendedBrakeDirection,
      guidanceMode: brakeThrottle > 1e-6
        ? "navsys:orbital-refuel-velocity-match-brake"
        : "navsys:orbital-refuel-velocity-match-coast",
      diagnostics: {
        desiredClosingKmS,
        closingSpeedKmS: safeNumber(closingSpeedKmS, 0),
        orbitalRateRadS: safeNumber(orbitalRateRadS, 0),
      },
    };
  }

  const throttleCap = throttleCapForDistance(rangeKm);
  const requestedThrottle = clamp(accelMagnitudeKmS2 / 0.0022, 0, throttleCap);
  return {
    requestedThrottle,
    desiredDirection: accelDirection,
    guidanceMode: guidanceModeForDistance(rangeKm),
    diagnostics: {
      desiredClosingKmS,
      closingSpeedKmS: safeNumber(closingSpeedKmS, 0),
      orbitalRateRadS: safeNumber(orbitalRateRadS, 0),
    },
  };
}
