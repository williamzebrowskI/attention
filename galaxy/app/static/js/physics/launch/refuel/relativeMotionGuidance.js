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
    return clamp(d / 55_000, 0.0018, 0.0042);
  }
  if (d > 60) {
    return clamp(d / 62_000, 0.001, 0.0022);
  }
  if (d > 20) {
    return clamp(d / 50_000, 0.00035, 0.0011);
  }
  if (d > 5) {
    return clamp(d / 42_000, 0.00008, 0.00035);
  }
  if (d > 1) {
    return clamp(d / 36_000, 0.00002, 0.00009);
  }
  return clamp(d / 40_000, 0.000005, 0.00003);
}

function controllerNaturalFrequency(distanceKm) {
  const d = Math.max(0, Number(distanceKm) || 0);
  if (d > 160) {
    return 0.00022;
  }
  if (d > 60) {
    return 0.00035;
  }
  if (d > 20) {
    return 0.00058;
  }
  if (d > 5) {
    return 0.0009;
  }
  if (d > 1) {
    return 0.0012;
  }
  return 0.0016;
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
    return 0.006;
  }
  return 0.0025;
}

function guidanceModeForDistance(distanceKm) {
  const d = Math.max(0, Number(distanceKm) || 0);
  if (d > 100) {
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
  const zeta = 1.05;
  const kPos = wn * wn;
  const kVel = 2 * zeta * wn;

  // Clohessy-Wiltshire compensated PD control in Hill/LVLH frame.
  const accelHillKmS2 = {
    x: (-kPos * relPosHill.x) - (kVel * relVelHill.x)
      + (2 * orbitalRateRadS * relVelHill.y)
      + (3 * orbitalRateRadS * orbitalRateRadS * relPosHill.x),
    y: (-kPos * relPosHill.y) - (kVel * relVelHill.y)
      - (2 * orbitalRateRadS * relVelHill.x),
    z: (-kPos * relPosHill.z) - (kVel * relVelHill.z)
      + (orbitalRateRadS * orbitalRateRadS * relPosHill.z),
  };
  const accelCommandKmS2 = fromHillFrame(accelHillKmS2, frame);
  const accelMagnitudeKmS2 = Math.max(0, length(accelCommandKmS2));
  const accelDirection = normalize(accelCommandKmS2, toTargetDirection);

  const tooFastClosing = closingSpeedKmS > Math.max(
    desiredClosingKmS * 1.2,
    desiredClosingKmS + 0.00025,
  );
  if (rangeKm <= 2) {
    return {
      requestedThrottle: 0,
      desiredDirection: accelDirection,
      guidanceMode: "navsys:orbital-refuel-rcs-translate",
      diagnostics: {
        desiredClosingKmS,
        closingSpeedKmS: safeNumber(closingSpeedKmS, 0),
        orbitalRateRadS: safeNumber(orbitalRateRadS, 0),
      },
    };
  }
  if (tooFastClosing) {
    const brakeDirection = normalize(
      scale(shipMinusTargetVelocityKmS, -1),
      scale(toTargetDirection, -1),
    );
    return {
      requestedThrottle: 0,
      desiredDirection: brakeDirection,
      guidanceMode: "navsys:orbital-refuel-velocity-match-coast",
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
