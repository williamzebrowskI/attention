import { add, clamp, cross, normalize, scale, subtract } from "../launchMath.js";
import { REFUEL_TANKER_CONFIG } from "./config.js";
import { clampVectorMagnitude, vectorDot, vectorMagnitude } from "./math.js";

export function tankerRcsJetsFromCommand({
  commandedAccelKmS2,
  localUp,
  tankerRelVel,
  relVelToRocket,
  verticalErrorKm = 0,
  thresholdKmS2 = 0,
} = {}) {
  const upAxis = normalize(localUp || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const tankerVelocity = tankerRelVel || { x: 0, y: 0, z: 0 };
  const rocketRelativeVelocity = relVelToRocket || { x: 0, y: 0, z: 0 };
  const tangentialSeed = subtract(
    tankerVelocity,
    scale(upAxis, vectorDot(tankerVelocity, upAxis)),
  );
  const fallbackTangentialSeed = subtract(
    rocketRelativeVelocity,
    scale(upAxis, vectorDot(rocketRelativeVelocity, upAxis)),
  );
  const globalReference = Math.abs(Number(upAxis.z) || 0) < 0.9
    ? { x: 0, y: 0, z: 1 }
    : { x: 1, y: 0, z: 0 };
  const provisionalRight = normalize(cross(upAxis, globalReference), { x: 1, y: 0, z: 0 });
  let forwardAxis = normalize(
    tangentialSeed,
    normalize(
      fallbackTangentialSeed,
      normalize(cross(provisionalRight, upAxis), { x: 0, y: 1, z: 0 }),
    ),
  );
  let rightAxis = normalize(cross(forwardAxis, upAxis), provisionalRight);
  forwardAxis = normalize(cross(rightAxis, upAxis), forwardAxis);
  rightAxis = normalize(cross(forwardAxis, upAxis), rightAxis);

  const accel = commandedAccelKmS2 || { x: 0, y: 0, z: 0 };
  const accelUp = vectorDot(accel, upAxis);
  const accelRight = vectorDot(accel, rightAxis);
  const accelForward = vectorDot(accel, forwardAxis);
  const threshold = Math.max(1e-8, Number(thresholdKmS2) || 0);
  const jets = [];

  if (accelRight > threshold) {
    jets.push("port");
  } else if (accelRight < -threshold) {
    jets.push("starboard");
  }

  if (accelForward > threshold) {
    jets.push("ventral");
  } else if (accelForward < -threshold) {
    jets.push("dorsal");
  }

  if (accelUp > threshold) {
    jets.push("aft");
  } else if (accelUp < -threshold) {
    jets.push("forward");
  }

  if (jets.length <= 0) {
    if (Math.abs(Number(verticalErrorKm) || 0) > 0.002) {
      jets.push((Number(verticalErrorKm) || 0) > 0 ? "aft" : "forward");
    } else {
      jets.push("aft");
    }
  }
  return jets;
}

export function tankerOrbitHoldCommand({
  tankerState,
  earthState,
  earthRadiusKm = 6371,
  earthMuKm3S2 = 0,
  config = REFUEL_TANKER_CONFIG,
} = {}) {
  if (
    !tankerState
    || !earthState
    || !tankerState.position
    || !tankerState.velocity
    || !earthState.position
    || !earthState.velocity
  ) {
    return null;
  }
  const relPos = subtract(tankerState.position, earthState.position);
  const relVel = subtract(
    tankerState.velocity || { x: 0, y: 0, z: 0 },
    earthState.velocity || { x: 0, y: 0, z: 0 },
  );
  const radiusKm = vectorMagnitude(relPos);
  if (!(radiusKm > 1e-9)) {
    return null;
  }
  const localUp = normalize(relPos, { x: 0, y: 0, z: 1 });
  const radialSpeedKmS = vectorDot(relVel, localUp);
  const tangentialVelocityKmS = subtract(relVel, scale(localUp, radialSpeedKmS));
  const tangentialSpeedKmS = vectorMagnitude(tangentialVelocityKmS);
  const altitudeKm = Math.max(0, radiusKm - Math.max(1, Number(earthRadiusKm) || 6371));
  const altitudeMinKm = Math.max(80, Number(config?.orbitHoldAltitudeMinKm) || 150);
  const altitudeMaxKm = Math.max(altitudeMinKm + 1, Number(config?.orbitHoldAltitudeMaxKm) || 160);
  const targetAltitudeKm = clamp(
    Number(config?.orbitHoldTargetAltitudeKm) || ((altitudeMinKm + altitudeMaxKm) * 0.5),
    altitudeMinKm,
    altitudeMaxKm,
  );
  const responseSec = Math.max(20, Number(config?.orbitHoldResponseSec) || 120);
  const maxAccelKmS2 = Math.max(0.00002, Number(config?.orbitHoldMaxAccelKmS2) || 0.00014);
  const maxRadialSpeedKmS = Math.max(0.0004, Number(config?.orbitHoldMaxRadialSpeedKmS) || 0.018);
  const targetRadiusKm = Math.max(1, (Number(earthRadiusKm) || 6371) + targetAltitudeKm);
  const circularSpeedKmS = earthMuKm3S2 > 0
    ? Math.sqrt(earthMuKm3S2 / targetRadiusKm)
    : tangentialSpeedKmS;
  const tangentFallback = Math.abs(Number(localUp.z) || 0) < 0.9
    ? normalize(cross(localUp, { x: 0, y: 0, z: 1 }), { x: 1, y: 0, z: 0 })
    : normalize(cross(localUp, { x: 1, y: 0, z: 0 }), { x: 0, y: 1, z: 0 });
  const tangentDirection = normalize(tangentialVelocityKmS, tangentFallback);
  const altitudeErrorKm = targetAltitudeKm - altitudeKm;
  const desiredRadialSpeedKmS = clamp(
    altitudeErrorKm / Math.max(responseSec * 0.75, 1),
    -maxRadialSpeedKmS,
    maxRadialSpeedKmS,
  );
  const radialAccelKmS2 = (desiredRadialSpeedKmS - radialSpeedKmS) / Math.max(responseSec, 1);
  const tangentialSpeedErrorKmS = circularSpeedKmS - tangentialSpeedKmS;
  const tangentialAccelKmS2 = tangentialSpeedErrorKmS / Math.max(responseSec * 1.15, 1);
  let commandedAccelKmS2 = add(
    scale(localUp, radialAccelKmS2),
    scale(tangentDirection, tangentialAccelKmS2),
  );
  let estimatedPeriapsisKm = altitudeKm;
  let estimatedApoapsisKm = altitudeKm;
  if (earthMuKm3S2 > 1e-9) {
    const speedSqKmS2 = vectorDot(relVel, relVel);
    const specificEnergyKm2S2 = (speedSqKmS2 * 0.5) - (earthMuKm3S2 / Math.max(radiusKm, 1e-6));
    const hVec = cross(relPos, relVel);
    const hSq = vectorDot(hVec, hVec);
    const eccentricitySq = Math.max(
      0,
      1 + ((2 * specificEnergyKm2S2 * hSq) / Math.max(earthMuKm3S2 * earthMuKm3S2, 1e-12)),
    );
    const eccentricity = Math.sqrt(eccentricitySq);
    if (specificEnergyKm2S2 < -1e-9) {
      const semiMajorKm = -earthMuKm3S2 / (2 * specificEnergyKm2S2);
      if (semiMajorKm > 1) {
        const periRadiusKm = semiMajorKm * Math.max(0, 1 - eccentricity);
        const apoRadiusKm = semiMajorKm * (1 + eccentricity);
        estimatedPeriapsisKm = Math.max(0, periRadiusKm - (Number(earthRadiusKm) || 6371));
        estimatedApoapsisKm = Math.max(0, apoRadiusKm - (Number(earthRadiusKm) || 6371));
      }
    }
  }
  const periapsisDeficitKm = Math.max(0, altitudeMinKm - estimatedPeriapsisKm);
  if (periapsisDeficitKm > 0.1) {
    const periapsisGain = clamp(periapsisDeficitKm / Math.max(responseSec * 0.45, 1), 0, maxAccelKmS2 * 0.85);
    commandedAccelKmS2 = add(commandedAccelKmS2, scale(tangentDirection, periapsisGain));
  }
  if (altitudeKm < altitudeMinKm) {
    const floorErrorKm = altitudeMinKm - altitudeKm;
    commandedAccelKmS2 = add(
      commandedAccelKmS2,
      scale(localUp, clamp(floorErrorKm * 0.00002, 0, maxAccelKmS2 * 0.7)),
    );
  } else if (altitudeKm > altitudeMaxKm) {
    const ceilingErrorKm = altitudeKm - altitudeMaxKm;
    commandedAccelKmS2 = add(
      commandedAccelKmS2,
      scale(localUp, -clamp(ceilingErrorKm * 0.00002, 0, maxAccelKmS2 * 0.7)),
    );
  }
  commandedAccelKmS2 = clampVectorMagnitude(commandedAccelKmS2, maxAccelKmS2);
  let mode = "rcs-orbit-hold";
  if (periapsisDeficitKm > 0.1) {
    mode = "rcs-orbit-raise-periapsis";
  } else if (altitudeKm < (altitudeMinKm - 0.2)) {
    mode = "rcs-orbit-raise";
  } else if (altitudeKm > (altitudeMaxKm + 0.2)) {
    mode = "rcs-orbit-lower";
  }
  return {
    mode,
    localUp,
    altitudeKm,
    altitudeMinKm,
    altitudeMaxKm,
    targetAltitudeKm,
    radialSpeedKmS,
    tangentialSpeedKmS,
    circularSpeedKmS,
    estimatedPeriapsisKm,
    estimatedApoapsisKm,
    commandedAccelKmS2,
    maxAccelKmS2,
  };
}

export function refuelFlightOffsetKm(relPos, relVel, slotIndex = 0, approachProgress = 0) {
  const up = normalize(relPos, { x: 0, y: 1, z: 0 });
  const forward = normalize(relVel, { x: 1, y: 0, z: 0 });
  const right = normalize(cross(up, forward), { x: 1, y: 0, z: 0 });
  const forwardOrtho = normalize(cross(right, up), forward);
  const angle = ((slotIndex % 6) / 6) * (Math.PI * 2);
  const outerRadiusKm = 24 + (slotIndex * 2.5);
  const innerRadiusKm = 0.42 + (slotIndex * 0.04);
  const ringRadiusKm = (outerRadiusKm * (1 - approachProgress)) + (innerRadiusKm * approachProgress);
  const alongForward = Math.cos(angle) * ringRadiusKm;
  const alongRight = Math.sin(angle) * ringRadiusKm;
  const alongUp = (2.5 * (1 - approachProgress)) + (0.06 * approachProgress);
  return add(
    add(scale(forwardOrtho, alongForward), scale(right, alongRight)),
    scale(up, alongUp),
  );
}

export function rendezvousMetrics(rocketState, tankerState) {
  if (
    !rocketState
    || !tankerState
    || !rocketState.position
    || !tankerState.position
    || !rocketState.velocity
    || !tankerState.velocity
  ) {
    return null;
  }
  const relativePositionKm = subtract(
    tankerState.position,
    rocketState.position,
  );
  const relativeVelocityKmS = subtract(
    tankerState.velocity,
    rocketState.velocity,
  );
  const distanceKm = Math.max(0, Math.sqrt(
    ((Number(relativePositionKm.x) || 0) ** 2)
    + ((Number(relativePositionKm.y) || 0) ** 2)
    + ((Number(relativePositionKm.z) || 0) ** 2)
  ));
  const relativeSpeedKmS = Math.max(0, Math.sqrt(
    ((Number(relativeVelocityKmS.x) || 0) ** 2)
    + ((Number(relativeVelocityKmS.y) || 0) ** 2)
    + ((Number(relativeVelocityKmS.z) || 0) ** 2)
  ));
  const closingSpeedKmS = distanceKm > 1e-9
    ? -(
      (((Number(relativeVelocityKmS.x) || 0) * (Number(relativePositionKm.x) || 0))
      + ((Number(relativeVelocityKmS.y) || 0) * (Number(relativePositionKm.y) || 0))
      + ((Number(relativeVelocityKmS.z) || 0) * (Number(relativePositionKm.z) || 0)))
      / distanceKm
    )
    : 0;
  return {
    relativePositionKm,
    relativeVelocityKmS,
    distanceKm,
    relativeSpeedKmS,
    closingSpeedKmS,
  };
}
