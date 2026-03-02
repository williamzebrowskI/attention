import {
  LAUNCH_AUTOPILOT_CONFIG,
  LAUNCH_SITE,
  LAUNCH_VEHICLE_CONFIG,
} from "./launchConfig.js";
import { atmosphereRelativeVelocityKmS } from "./launchAeroModel.js";
import {
  add,
  clamp,
  cross,
  dot,
  length,
  mixVectors,
  normalize,
  normalizeAngleRadians,
  rad,
  scale,
  subtract,
} from "./launchMath.js";

function bodyDirectionFromLatLon(axes, latitudeDeg, longitudeDeg) {
  const lat = rad(latitudeDeg);
  const lon = rad(longitudeDeg);
  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const cosLon = Math.cos(lon);
  const sinLon = Math.sin(lon);

  const localX = cosLat * cosLon;
  const localY = cosLat * sinLon;
  const localZ = sinLat;
  const direction = {
    x: (axes.xAxis.x * localX) + (axes.yAxis.x * localY) + (axes.pole.x * localZ),
    y: (axes.xAxis.y * localX) + (axes.yAxis.y * localY) + (axes.pole.y * localZ),
    z: (axes.xAxis.z * localX) + (axes.yAxis.z * localY) + (axes.pole.z * localZ),
  };
  return normalize(direction);
}

export function guidanceDirection({
  rocketState,
  earthState,
  earthAxes,
  elapsedSeconds,
}) {
  const up = normalize(
    subtract(rocketState.position, earthState.position),
    earthAxes.pole,
  );
  if (LAUNCH_VEHICLE_CONFIG.guidance?.enforceVerticalAscent) {
    return {
      direction: up,
      mode: "vertical-ascent",
    };
  }
  const east = normalize(
    cross(earthAxes.pole, up),
    normalize(cross({ x: 0, y: 0, z: 1 }, up), { x: 1, y: 0, z: 0 }),
  );
  const north = normalize(cross(up, east), { x: 0, y: 1, z: 0 });
  const heading = rad(LAUNCH_VEHICLE_CONFIG.guidance.ascentHeadingDegFromEast);
  const headingDirection = normalize(
    add(scale(east, Math.cos(heading)), scale(north, Math.sin(heading))),
    east,
  );

  const pitchover = clamp(
    (elapsedSeconds - LAUNCH_VEHICLE_CONFIG.guidance.pitchoverStartSec)
      / Math.max(LAUNCH_VEHICLE_CONFIG.guidance.pitchoverDurationSec, 1),
    0,
    1,
  );
  let command = normalize(mixVectors(up, headingDirection, pitchover), headingDirection);

  const relVelocity = subtract(
    rocketState.velocity,
    earthState.velocity || { x: 0, y: 0, z: 0 },
  );
  const prograde = normalize(relVelocity, command);
  const progradeBlend = clamp(
    (elapsedSeconds - LAUNCH_VEHICLE_CONFIG.guidance.progradeBlendStartSec)
      / Math.max(LAUNCH_VEHICLE_CONFIG.guidance.progradeBlendDurationSec, 1),
    0,
    LAUNCH_VEHICLE_CONFIG.guidance.maxProgradeBlend,
  );
  command = normalize(mixVectors(command, prograde, progradeBlend), command);

  return {
    direction: command,
    mode: progradeBlend > 0.05 ? "gravity-turn-prograde" : "pitch-program",
  };
}

export function circularOrbitSpeedKmS(muKm3S2, radiusKm) {
  if (!(muKm3S2 > 0) || !(radiusKm > 0)) {
    return 0;
  }
  return Math.sqrt(muKm3S2 / radiusKm);
}

export function computeLaunchPlaneNormal(earthAxes) {
  const up = bodyDirectionFromLatLon(
    earthAxes,
    LAUNCH_SITE.latitudeDeg,
    LAUNCH_SITE.longitudeDeg,
  );
  const east = normalize(
    cross(earthAxes.pole, up),
    normalize(cross({ x: 0, y: 0, z: 1 }, up), { x: 1, y: 0, z: 0 }),
  );
  const north = normalize(cross(up, east), { x: 0, y: 1, z: 0 });
  const heading = rad(LAUNCH_VEHICLE_CONFIG.guidance.ascentHeadingDegFromEast);
  const headingDirection = normalize(
    add(scale(east, Math.cos(heading)), scale(north, Math.sin(heading))),
    east,
  );
  return normalize(cross(up, headingDirection), cross(up, east));
}

export function orbitalStateFromRelative(muKm3S2, earthRadiusKm, relPos, relVel) {
  const radiusKm = length(relPos);
  const speedKmS = length(relVel);
  const altitudeKm = radiusKm - earthRadiusKm;
  const up = normalize(relPos, { x: 0, y: 0, z: 1 });
  const radialSpeedKmS = dot(relVel, up);
  const tangentialVector = subtract(relVel, scale(up, radialSpeedKmS));
  const tangentialSpeedKmS = length(tangentialVector);
  const circularSpeedKmS = circularOrbitSpeedKmS(muKm3S2, radiusKm);
  const specificEnergy = (radiusKm > 0)
    ? (0.5 * speedKmS * speedKmS) - (muKm3S2 / radiusKm)
    : Number.NaN;
  const hVector = cross(relPos, relVel);
  const h = length(hVector);

  let semimajorKm = Number.NaN;
  let eccentricity = Number.NaN;
  let apoapsisKm = Number.NaN;
  let periapsisKm = Number.NaN;
  let timeToApoapsisSec = Number.NaN;

  if (muKm3S2 > 0 && radiusKm > 0 && h > 0) {
    if (specificEnergy < 0) {
      semimajorKm = -muKm3S2 / (2 * specificEnergy);
      eccentricity = Math.sqrt(
        Math.max(0, 1 + ((2 * specificEnergy * h * h) / (muKm3S2 * muKm3S2))),
      );
      apoapsisKm = (semimajorKm * (1 + eccentricity)) - earthRadiusKm;
      periapsisKm = (semimajorKm * (1 - eccentricity)) - earthRadiusKm;
      if (eccentricity > 1e-8 && eccentricity < 0.99999 && semimajorKm > 0) {
        const sqrtMuA = Math.sqrt(muKm3S2 * semimajorKm);
        const cosE = clamp((1 - (radiusKm / semimajorKm)) / eccentricity, -1, 1);
        const sinE = clamp(dot(relPos, relVel) / (eccentricity * sqrtMuA), -1, 1);
        const E = Math.atan2(sinE, cosE);
        const M = E - (eccentricity * Math.sin(E));
        const meanMotion = Math.sqrt(muKm3S2 / (semimajorKm * semimajorKm * semimajorKm));
        if (meanMotion > 0) {
          const targetM = Math.PI;
          const deltaM = normalizeAngleRadians(targetM - M);
          timeToApoapsisSec = deltaM / meanMotion;
        }
      }
    }
  }

  return {
    radiusKm,
    altitudeKm,
    speedKmS,
    radialSpeedKmS,
    tangentialSpeedKmS,
    tangentialVector,
    circularSpeedKmS,
    specificEnergy,
    semimajorKm,
    eccentricity,
    apoapsisKm,
    periapsisKm,
    timeToApoapsisSec,
    up,
    hVector,
  };
}

export function autopilotDirectionInTargetPlane(relVel, up, planeNormal, earthPole) {
  let tangent = normalize(
    cross(planeNormal, up),
    normalize(cross(up, earthPole), normalize(relVel, up)),
  );
  if (dot(tangent, relVel) < 0) {
    tangent = scale(tangent, -1);
  }
  return tangent;
}

export function orbitInsertionWithinTolerance(orbital, config, targetAltitudeKm) {
  if (!orbital || !config) {
    return false;
  }
  const periapsisKm = Number(orbital.periapsisKm);
  const apoapsisKm = Number(orbital.apoapsisKm);
  if (!Number.isFinite(periapsisKm) || !Number.isFinite(apoapsisKm)) {
    return false;
  }
  if (!(Number(orbital.specificEnergy) < 0)) {
    return false;
  }
  const periTolKm = Math.max(0, Number(config.orbitalHoldMaxPeriapsisErrorKm) || 0);
  const apoTolKm = Math.max(0, Number(config.orbitalHoldMaxApoapsisErrorKm) || 0);
  const periErrorKm = Math.abs(targetAltitudeKm - periapsisKm);
  const apoErrorKm = Math.abs(targetAltitudeKm - apoapsisKm);
  return periErrorKm <= periTolKm && apoErrorKm <= apoTolKm;
}

function applyVerticalHoldSteering({
  baseDirection,
  relPos,
  relVel,
  earthPole,
  altitudeKm,
  elapsedSeconds,
}) {
  const guidance = LAUNCH_VEHICLE_CONFIG.guidance || {};
  const holdSeconds = Math.max(0, Number(guidance.verticalHoldSeconds) || 0);
  const holdAltitudeKm = Math.max(0, Number(guidance.verticalHoldMaxAltitudeKm) || 0);
  const holdActive =
    (holdSeconds > 0 && elapsedSeconds < holdSeconds)
    || (holdAltitudeKm > 0 && altitudeKm < holdAltitudeKm);
  if (!holdActive) {
    return {
      direction: normalize(baseDirection, normalize(relPos)),
      active: false,
    };
  }

  const up = normalize(relPos, normalize(baseDirection, { x: 0, y: 0, z: 1 }));
  const relAir = atmosphereRelativeVelocityKmS(relPos, relVel, earthPole);
  const radialAirKmS = dot(relAir, up);
  const lateralAir = subtract(relAir, scale(up, radialAirKmS));
  const lateralSpeedKmS = length(lateralAir);
  const maxLateralSpeedKmS = Math.max(0, Number(guidance.verticalHoldMaxLateralSpeedKmS) || 0);

  if (!(lateralSpeedKmS > maxLateralSpeedKmS + 1e-9)) {
    return {
      direction: up,
      active: true,
    };
  }

  const lateralDir = normalize(lateralAir, { x: 0, y: 0, z: 0 });
  const gain = clamp(Number(guidance.verticalHoldCorrectionGain) || 0.85, 0, 3);
  const maxTiltRad = rad(clamp(Number(guidance.verticalHoldMaxTiltDeg) || 7, 0, 20));
  const overSpeedRatio = clamp(
    (lateralSpeedKmS - maxLateralSpeedKmS) / Math.max(maxLateralSpeedKmS, 1e-6),
    0,
    3,
  );
  const correctionWeight = Math.min(Math.tan(maxTiltRad), overSpeedRatio * gain * 0.35);
  const corrected = normalize(
    add(up, scale(lateralDir, -correctionWeight)),
    up,
  );
  return {
    direction: corrected,
    active: true,
  };
}

export function throttleForState(stageIndex, elapsedSeconds, dynamicPressurePa = 0) {
  const guidance = LAUNCH_VEHICLE_CONFIG.guidance || {};
  if (stageIndex !== 0) {
    return 1;
  }
  let throttle = 1;
  if (elapsedSeconds < guidance.liftoffThrottleSec) {
    throttle = Math.min(throttle, clamp(guidance.liftoffThrottleValue, 0.3, 1));
  }

  const qTargetPa = Number(guidance.maxQTargetPa) || 0;
  const qControlStartRatio = clamp(Number(guidance.maxQControlStartRatio) || 0.78, 0.2, 1.2);
  if (qTargetPa > 0 && Number.isFinite(dynamicPressurePa) && dynamicPressurePa > 0) {
    const qRatio = dynamicPressurePa / qTargetPa;
    if (qRatio > qControlStartRatio) {
      const gain = Math.max(0.05, Number(guidance.maxQThrottleGain) || 0.92);
      const floor = clamp(
        Number(guidance.maxQThrottleFloor ?? guidance.maxQThrottleValue ?? 0.58),
        0.3,
        1,
      );
      const reduction = clamp((qRatio - qControlStartRatio) * gain, 0, 1);
      throttle = Math.min(throttle, clamp(1 - reduction, floor, 1));
    }
  }

  if (elapsedSeconds >= guidance.maxQThrottleStartSec && elapsedSeconds <= guidance.maxQThrottleEndSec) {
    throttle = Math.min(throttle, clamp(Number(guidance.maxQThrottleValue) || 0.72, 0.3, 1));
  }
  return clamp(throttle, 0, 1);
}

export function computeAutopilotCommand({
  runtime,
  orbital,
  relPos,
  dynamicPressurePa,
  relVel,
  up,
  earthPole,
  muKm3S2,
  earthRadiusKm,
}) {
  const config = LAUNCH_AUTOPILOT_CONFIG;
  const targetAltitudeKm = Number(runtime?.targetOrbitAltitudeKm) || config.targetOrbitAltitudeKm;
  const targetAltitudeSafe = Math.max(targetAltitudeKm, 1);
  const apoapsisKm = Number(orbital.apoapsisKm);
  const periapsisKm = Number(orbital.periapsisKm);
  const apoDefined = Number.isFinite(apoapsisKm);
  const periDefined = Number.isFinite(periapsisKm);
  const radialSpeedKmS = Number(orbital.radialSpeedKmS) || 0;
  const circularSpeedKmS = Number(orbital.circularSpeedKmS) || 0;
  const tangentialSpeedKmS = Number(orbital.tangentialSpeedKmS) || 0;
  const targetRadiusKm = Math.max(1, earthRadiusKm + targetAltitudeKm);
  const targetCircularSpeedKmS = circularOrbitSpeedKmS(muKm3S2, targetRadiusKm);
  const stableTargetOrbit = orbitInsertionWithinTolerance(orbital, config, targetAltitudeKm);

  const planeNormal = runtime.launchPlaneNormal || normalize(cross(up, relVel), earthPole);
  const tangent = autopilotDirectionInTargetPlane(relVel, up, planeNormal, earthPole);

  if (runtime.autopilotMode === "autopilot-orbital-hold") {
    if (!stableTargetOrbit) {
      runtime.autopilotMode = "autopilot-coast-to-circularize";
      return {
        phase: "coast",
        throttle: 0,
        direction: tangent,
        mode: "autopilot-reacquire-orbit",
      };
    }
    return {
      phase: "orbit",
      throttle: 0,
      direction: tangent,
      mode: "autopilot-orbital-hold",
    };
  }

  if (runtime.autopilotMode === "autopilot-coast-to-circularize") {
    const coastMinAltitudeKm = Math.max(config.ascentCoastMinAltitudeKm || 0, 0);
    const belowSafeCoastAltitude = orbital.altitudeKm < coastMinAltitudeKm;
    const descendingTooFast = radialSpeedKmS < (config.ascentClimbRecoverRadialSpeedKmS ?? -0.01);
    if (belowSafeCoastAltitude && descendingTooFast) {
      runtime.autopilotMode = "autopilot-apoapsis-raise";
      const recoveryDirection = normalize(
        add(scale(tangent, 1), scale(up, 0.5)),
        up,
      );
      return {
        phase: "powered",
        throttle: clamp(config.ascentClimbThrottleFloor ?? 0.92, 0.3, 1),
        direction: recoveryDirection,
        mode: "autopilot-climb-recovery",
      };
    }
    const tta = Number(orbital.timeToApoapsisSec);
    const readyForCircularization =
      (Number.isFinite(tta) && tta <= config.circularizationIgnitionLeadSeconds)
      || (radialSpeedKmS <= 0 && orbital.altitudeKm >= config.circularizationMinAltitudeKm)
      || (!Number.isFinite(tta) && orbital.altitudeKm >= config.circularizationMinAltitudeKm);
    if (!readyForCircularization) {
      return {
        phase: "coast",
        throttle: 0,
        direction: tangent,
        mode: "autopilot-coast-to-apoapsis",
      };
    }
    runtime.autopilotMode = "autopilot-circularization";
  }

  if (runtime.autopilotMode === "autopilot-circularization") {
    const periErrorKm = periDefined ? targetAltitudeKm - periapsisKm : targetAltitudeKm;
    const tangentialSpeedErrorKmS = circularSpeedKmS - tangentialSpeedKmS;
    const aboveCircularSpeed = tangentialSpeedErrorKmS <= -0.02;
    const doneCircularizing = stableTargetOrbit && tangentialSpeedErrorKmS <= 0.02;
    if (doneCircularizing) {
      runtime.autopilotMode = "autopilot-orbital-hold";
      return {
        phase: "orbit",
        throttle: 0,
        direction: tangent,
        mode: "autopilot-orbital-hold",
      };
    }
    if (aboveCircularSpeed) {
      runtime.autopilotMode = "autopilot-coast-to-circularize";
      return {
        phase: "coast",
        throttle: 0,
        direction: tangent,
        mode: "autopilot-coast-for-recapture",
      };
    }
    const radialDamping = clamp(-radialSpeedKmS * 0.55, -0.22, 0.22);
    const direction = normalize(
      add(scale(tangent, 1), scale(up, radialDamping)),
      tangent,
    );
    const throttle = clamp(
      config.circularizationThrottle + clamp(periErrorKm / targetAltitudeSafe, -0.2, 0.35),
      0.18,
      1,
    );
    return {
      phase: "powered",
      throttle,
      direction,
      mode: "autopilot-circularization",
    };
  }

  if (
    runtime.elapsedSeconds < config.verticalAscentMinSeconds
    || orbital.altitudeKm < config.verticalAscentMaxAltitudeKm
  ) {
    const hold = applyVerticalHoldSteering({
      baseDirection: up,
      relPos,
      relVel,
      earthPole,
      altitudeKm: orbital.altitudeKm,
      elapsedSeconds: runtime.elapsedSeconds,
    });
    runtime.autopilotMode = "autopilot-vertical-ascent";
    return {
      phase: "powered",
      throttle: throttleForState(runtime.stageIndex, runtime.elapsedSeconds, dynamicPressurePa),
      direction: hold.direction,
      mode: hold.active ? "autopilot-vertical-hold" : "autopilot-vertical-ascent",
    };
  }

  const gravityTurnBlend = clamp(
    (orbital.altitudeKm - config.verticalAscentMaxAltitudeKm)
      / Math.max(config.gravityTurnEndAltitudeKm - config.verticalAscentMaxAltitudeKm, 1),
    0,
    1,
  );
  const turnDirection = normalize(
    mixVectors(up, tangent, Math.pow(gravityTurnBlend, 0.85)),
    tangent,
  );

  let direction = turnDirection;
  let throttle = throttleForState(runtime.stageIndex, runtime.elapsedSeconds, dynamicPressurePa);
  let mode = "autopilot-gravity-turn";
  if (gravityTurnBlend >= 1) {
    runtime.autopilotMode = "autopilot-apoapsis-raise";
    const apoDeficitKm = apoDefined ? targetAltitudeKm - apoapsisKm : targetAltitudeKm;
    const radialBias = clamp((apoDeficitKm / targetAltitudeSafe) * 0.30, -0.12, 0.18);
    direction = normalize(
      add(scale(tangent, 1), scale(up, radialBias)),
      tangent,
    );
    throttle = clamp(
      0.84 + clamp((apoDeficitKm / targetAltitudeSafe) * 0.28, -0.10, 0.14),
      0.72,
      config.ascentMaxThrottle,
    );
    mode = "autopilot-apoapsis-raise";
  } else {
    runtime.autopilotMode = "autopilot-gravity-turn";
  }

  const climbGuardAltitudeKm = Math.max(config.ascentClimbGuardAltitudeKm || 0, config.verticalAscentMaxAltitudeKm || 0);
  if (orbital.altitudeKm < climbGuardAltitudeKm) {
    const altitudeDeficit = clamp(
      (climbGuardAltitudeKm - orbital.altitudeKm) / Math.max(climbGuardAltitudeKm, 1),
      0,
      1,
    );
    const radialRecovery = clamp(
      ((config.ascentClimbRecoverRadialSpeedKmS ?? -0.01) - radialSpeedKmS) * 3.5,
      0,
      0.85,
    );
    const upWeight = clamp(
      (config.ascentClimbUpWeightMin ?? 0.2) + altitudeDeficit + radialRecovery,
      config.ascentClimbUpWeightMin ?? 0.2,
      config.ascentClimbUpWeightMax ?? 0.68,
    );
    direction = normalize(
      add(scale(direction, 1), scale(up, upWeight)),
      up,
    );
    if (radialSpeedKmS < (config.ascentClimbRecoverRadialSpeedKmS ?? -0.01)) {
      throttle = Math.max(throttle, clamp(config.ascentClimbThrottleFloor ?? 0.92, 0.3, 1));
      mode = "autopilot-climb-guard";
    }
  }

  const highAltitudeGuardKm = Math.max(config.circularizationMinAltitudeKm + 30, climbGuardAltitudeKm);
  if (orbital.altitudeKm < highAltitudeGuardKm && radialSpeedKmS < -0.002) {
    const descentSeverity = clamp((-radialSpeedKmS) / 0.12, 0, 1);
    const upWeight = clamp(0.30 + (descentSeverity * 0.44), 0.24, 0.76);
    direction = normalize(
      add(scale(direction, 1), scale(up, upWeight)),
      up,
    );
    throttle = Math.max(throttle, clamp(0.9 + (descentSeverity * 0.1), 0.9, 1));
    mode = "autopilot-climb-guard";
  }

  const shouldCoastToApoapsis =
    (
      apoDefined
      && apoapsisKm >= (targetAltitudeKm + config.insertionCutoffApoapsisMarginKm)
      && radialSpeedKmS > -0.005
      && orbital.altitudeKm >= Math.max(config.ascentCoastMinAltitudeKm || 0, 0)
    )
    || (
      orbital.altitudeKm >= config.circularizationMinAltitudeKm
      && tangentialSpeedKmS >= (targetCircularSpeedKmS * 0.9)
      && radialSpeedKmS > -0.01
    );
  if (shouldCoastToApoapsis) {
    runtime.autopilotMode = "autopilot-coast-to-circularize";
    return {
      phase: "coast",
      throttle: 0,
      direction,
      mode: "autopilot-meco-coast",
    };
  }

  const hold = applyVerticalHoldSteering({
    baseDirection: direction,
    relPos,
    relVel,
    earthPole,
    altitudeKm: orbital.altitudeKm,
    elapsedSeconds: runtime.elapsedSeconds,
  });
  if (hold.active) {
    direction = hold.direction;
    if (!mode.includes("vertical-hold")) {
      mode = `${mode}+vertical-hold`;
    }
  }

  return {
    phase: "powered",
    throttle,
    direction,
    mode,
  };
}
