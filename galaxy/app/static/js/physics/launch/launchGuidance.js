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
  let semiLatusRectumKm = Number.NaN;
  let apoapsisKm = Number.NaN;
  let periapsisKm = Number.NaN;
  let timeToApoapsisSec = Number.NaN;
  let timeToPeriapsisSec = Number.NaN;
  let orbitalPeriodSec = Number.NaN;

  if (muKm3S2 > 0 && radiusKm > 0 && h > 0) {
    eccentricity = Math.sqrt(
      Math.max(0, 1 + ((2 * specificEnergy * h * h) / (muKm3S2 * muKm3S2))),
    );
    semiLatusRectumKm = (h * h) / muKm3S2;
    if (Number.isFinite(eccentricity) && Number.isFinite(semiLatusRectumKm) && eccentricity >= 0) {
      periapsisKm = (semiLatusRectumKm / Math.max(1e-9, 1 + eccentricity)) - earthRadiusKm;
    }
    if (specificEnergy < 0) {
      semimajorKm = -muKm3S2 / (2 * specificEnergy);
      apoapsisKm = (semimajorKm * (1 + eccentricity)) - earthRadiusKm;
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
          const deltaMPeri = normalizeAngleRadians(-M);
          timeToPeriapsisSec = deltaMPeri / meanMotion;
          orbitalPeriodSec = (Math.PI * 2) / meanMotion;
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
    semiLatusRectumKm,
    apoapsisKm,
    periapsisKm,
    timeToApoapsisSec,
    timeToPeriapsisSec,
    orbitalPeriodSec,
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
}) {
  const guidance = LAUNCH_VEHICLE_CONFIG.guidance || {};
  const holdAltitudeKm = Math.max(0, Number(guidance.verticalHoldMaxAltitudeKm) || 0);
  const holdActive = holdAltitudeKm > 0 && altitudeKm < holdAltitudeKm;
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
      direction: normalize(baseDirection, up),
      active: false,
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
  void elapsedSeconds;
  const guidance = LAUNCH_VEHICLE_CONFIG.guidance || {};
  if (stageIndex !== 0) {
    return 1;
  }
  let throttle = 1;

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
  return clamp(throttle, 0, 1);
}

function smoothStep01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - (2 * t));
}

function projectOntoPlaneDirection(direction, planeNormal, fallback) {
  return normalize(
    subtract(direction, scale(planeNormal, dot(direction, planeNormal))),
    fallback,
  );
}

function limitDirectionAngle({
  desiredDirection,
  referenceDirection,
  maxAngleRad,
  fallback,
}) {
  const reference = normalize(referenceDirection, fallback);
  const desired = normalize(desiredDirection, reference);
  const safeMaxAngleRad = Math.max(0, Number(maxAngleRad) || 0);
  const angleRad = Math.acos(clamp(dot(desired, reference), -1, 1));
  if (!(safeMaxAngleRad > 0) || !(angleRad > safeMaxAngleRad)) {
    return {
      direction: desired,
      limited: false,
      angleRad,
    };
  }
  const blend = clamp(safeMaxAngleRad / Math.max(angleRad, 1e-6), 0, 1);
  return {
    direction: normalize(mixVectors(reference, desired, blend), reference),
    limited: true,
    angleRad,
  };
}

function stateDrivenAscentProfile({
  orbital,
  relPos,
  relVel,
  up,
  tangent,
  planeNormal,
  earthPole,
  targetCircularSpeedKmS,
  dynamicPressurePa,
  verticalAscentMaxAltitudeKm,
  gravityTurnEndAltitudeKm,
  config,
}) {
  const altitudeKm = Math.max(0, Number(orbital?.altitudeKm) || 0);
  const tangentialSpeedKmS = Math.max(0, Number(orbital?.tangentialSpeedKmS) || 0);
  const radialSpeedKmS = Number(orbital?.radialSpeedKmS) || 0;
  const towerClearAltitudeKm = Math.max(
    0,
    Number(config.towerClearAltitudeKm) || 0,
  );
  const safeTurnStartKm = Math.max(0, verticalAscentMaxAltitudeKm * 0.15);
  const turnAltitudeProgress = clamp(
    (altitudeKm - safeTurnStartKm)
      / Math.max(gravityTurnEndAltitudeKm - safeTurnStartKm, 1),
    0,
    1,
  );
  const tangentialProgress = clamp(
    tangentialSpeedKmS / Math.max(targetCircularSpeedKmS, 0.1),
    0,
    1.2,
  );
  const qTargetPa = Math.max(1, Number(LAUNCH_VEHICLE_CONFIG.guidance?.maxQTargetPa) || 28_000);
  const qRatio = clamp((Number(dynamicPressurePa) || 0) / qTargetPa, 0, 2.5);
  const kickStartKm = Math.max(
    verticalAscentMaxAltitudeKm * 0.2,
    Number(config.pitchKickStartAltitudeKm) || 0.12,
  );
  const kickEndKm = Math.max(
    kickStartKm + 0.1,
    Number(config.pitchKickEndAltitudeKm) || 8.5,
  );
  const kickProgress = smoothStep01(
    (altitudeKm - kickStartKm) / Math.max(kickEndKm - kickStartKm, 0.1),
  );
  const kickAngleRad = rad(clamp(Number(config.pitchKickMaxDeg) || 10.5, 0, 20)) * kickProgress;
  const scheduledDirection = normalize(
    add(
      scale(up, Math.cos(kickAngleRad)),
      scale(tangent, Math.sin(kickAngleRad)),
    ),
    up,
  );
  const relAir = atmosphereRelativeVelocityKmS(relPos, relVel, earthPole);
  const airspeedKmS = length(relAir);
  const minTrackAirspeedKmS = Math.max(0.02, Number(config.progradeTrackMinAirSpeedKmS) || 0.12);
  const inertialPrograde = projectOntoPlaneDirection(relVel, planeNormal, tangent);
  const trackReference = airspeedKmS >= minTrackAirspeedKmS
    ? projectOntoPlaneDirection(relAir, planeNormal, inertialPrograde)
    : inertialPrograde;
  const radialTargetKmS = clamp(
    0.80
      - (0.62 * Math.pow(turnAltitudeProgress, 0.78))
      - (0.14 * tangentialProgress),
    0.06,
    0.80,
  );
  const radialDeficit = clamp(
    (radialTargetKmS - radialSpeedKmS) / Math.max(radialTargetKmS, 0.08),
    -1,
    1,
  );
  const progradeCapture = clamp(
    (0.14 * kickProgress)
      + (0.62 * Math.pow(turnAltitudeProgress, 0.82))
      + (0.38 * Math.pow(tangentialProgress, 0.92))
      + (0.24 * Math.max(0, qRatio - 0.60)),
    0,
    1,
  );
  let direction = normalize(
    mixVectors(scheduledDirection, trackReference, progradeCapture),
    scheduledDirection,
  );
  const climbAssistWeight = clamp(
    0.12
      + (Math.max(0, radialDeficit) * 0.16)
      + (Math.max(0, qRatio - 1) * 0.08)
      - (0.16 * turnAltitudeProgress)
      - (0.10 * tangentialProgress),
    0,
    0.28,
  );
  if (climbAssistWeight > 1e-6) {
    direction = normalize(
      add(scale(direction, 1), scale(up, climbAssistWeight)),
      direction,
    );
  }
  const aoaLimitStartRatio = clamp(Number(config.maxQAoALimitStartRatio) || 0.55, 0.2, 1.2);
  const aoaLimitDeg = qRatio >= aoaLimitStartRatio
    ? clamp(Number(config.maxQAoALimitDeg) || 4.5, 1, 15)
    : clamp(Number(config.ascentAoALimitDeg) || 7.5, 1, 20);
  const aoaLimited = airspeedKmS >= minTrackAirspeedKmS
    ? limitDirectionAngle({
      desiredDirection: direction,
      referenceDirection: trackReference,
      maxAngleRad: rad(aoaLimitDeg),
      fallback: trackReference,
    })
    : {
      direction: normalize(direction, scheduledDirection),
      limited: false,
      angleRad: 0,
    };
  direction = aoaLimited.direction;
  const towerClearActive = towerClearAltitudeKm > 0 && altitudeKm < towerClearAltitudeKm;
  let towerClearLimited = false;
  if (towerClearActive) {
    const trueVerticalAltitudeKm = Math.max(0.03, towerClearAltitudeKm * 0.4);
    if (altitudeKm <= trueVerticalAltitudeKm) {
      direction = up;
      towerClearLimited = true;
    } else {
    const towerClearProgress = smoothStep01(altitudeKm / Math.max(towerClearAltitudeKm, 1e-6));
    const towerClearMaxPitchDeg = clamp(
      Number(config.towerClearMaxPitchDeg) || 3.5,
      0.5,
      10,
    );
    const towerClearPitchDeg = 0.6 + (towerClearProgress * (towerClearMaxPitchDeg - 0.6));
    const towerClearLimitedDirection = limitDirectionAngle({
      desiredDirection: direction,
      referenceDirection: up,
      maxAngleRad: rad(towerClearPitchDeg),
      fallback: up,
    });
    direction = towerClearLimitedDirection.direction;
    towerClearLimited = towerClearLimitedDirection.limited;
    }
  }
  return {
    direction,
    climbWeight: dot(direction, up),
    turnAltitudeProgress,
    tangentialProgress,
    radialTargetKmS,
    kickProgress,
    progradeCapture,
    aoaLimited: aoaLimited.limited,
    towerClearActive,
    towerClearLimited,
  };
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
  const lowOrbitMissionStage1 = Number(runtime?.stageIndex) === 0 && targetAltitudeSafe <= 350;
  const ascentTargetAltitudeSafe = Number(runtime?.stageIndex) === 0
    ? Math.max(targetAltitudeSafe, 500)
    : targetAltitudeSafe;
  const verticalAscentMaxAltitudeKm = Math.max(0.05, Number(config.verticalAscentMaxAltitudeKm) || 0.05);
  const lowOrbitLaunchProfileActive = Number(runtime?.stageIndex) === 0 && ascentTargetAltitudeSafe <= 350;
  const apoapsisKm = Number(orbital.apoapsisKm);
  const periapsisKm = Number(orbital.periapsisKm);
  const apoDefined = Number.isFinite(apoapsisKm);
  const periDefined = Number.isFinite(periapsisKm);
  const radialSpeedKmS = Number(orbital.radialSpeedKmS) || 0;
  const circularSpeedKmS = Number(orbital.circularSpeedKmS) || 0;
  const tangentialSpeedKmS = Number(orbital.tangentialSpeedKmS) || 0;
  const targetRadiusKm = Math.max(1, earthRadiusKm + ascentTargetAltitudeSafe);
  const targetCircularSpeedKmS = circularOrbitSpeedKmS(muKm3S2, targetRadiusKm);
  const stableTargetOrbit = targetAltitudeSafe > 350
    ? (
      Number(orbital.specificEnergy) < 0
      && apoDefined
      && periDefined
      && apoapsisKm >= targetAltitudeKm
      && periapsisKm >= targetAltitudeKm
    )
    : orbitInsertionWithinTolerance(orbital, config, targetAltitudeKm);

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
    const circularizationLeadSeconds = targetAltitudeSafe > 350
      ? Math.min(config.circularizationIgnitionLeadSeconds, 8)
      : config.circularizationIgnitionLeadSeconds;
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
    const highOrbitEarlyCircularization =
      targetAltitudeSafe > 350
      && Number.isFinite(tta)
      && tta > 1200
      && apoDefined
      && periDefined
      && apoapsisKm >= targetAltitudeKm
      && periapsisKm < (targetAltitudeKm - Math.max(targetAltitudeSafe * 0.18, 60))
      && orbital.altitudeKm >= Math.max(coastMinAltitudeKm, targetAltitudeSafe * 0.18);
    const readyForCircularization =
      (Number.isFinite(tta) && tta <= circularizationLeadSeconds)
      || (radialSpeedKmS <= 0 && orbital.altitudeKm >= config.circularizationMinAltitudeKm)
      || (!Number.isFinite(tta) && orbital.altitudeKm >= config.circularizationMinAltitudeKm)
      || highOrbitEarlyCircularization;
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
    const timeToApoapsisSec = Number(orbital.timeToApoapsisSec);
    const periErrorKm = periDefined ? targetAltitudeKm - periapsisKm : targetAltitudeKm;
    const tangentialSpeedErrorKmS = circularSpeedKmS - tangentialSpeedKmS;
    const aboveCircularSpeed = tangentialSpeedErrorKmS <= -0.02;
    const periTrimWindowKm = Math.max(8, targetAltitudeSafe * 0.024);
    const gentleOverspeedWindowKmS = 0.18;
    const canFineTrimCircularization =
      periErrorKm > 0
      && periErrorKm <= periTrimWindowKm
      && tangentialSpeedErrorKmS > -gentleOverspeedWindowKmS;
    const highOrbitApoVicinityActive =
      targetAltitudeSafe > 350
      && apoDefined
      && orbital.altitudeKm >= (targetAltitudeKm * 0.95)
      && apoapsisKm <= (targetAltitudeKm + Math.max(targetAltitudeSafe * 0.32, 160));
    const highOrbitPeriRaiseActive =
      targetAltitudeSafe > 350
      && apoDefined
      && periDefined
      && apoapsisKm >= targetAltitudeKm
      && periErrorKm > periTrimWindowKm
      && (
        (Number.isFinite(timeToApoapsisSec) && timeToApoapsisSec <= 20)
        || Math.abs(radialSpeedKmS) <= 0.03
        || highOrbitApoVicinityActive
      )
      && orbital.altitudeKm >= Math.max(config.ascentCoastMinAltitudeKm || 0, targetAltitudeSafe * 0.18);
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
    if (aboveCircularSpeed && !canFineTrimCircularization && !highOrbitPeriRaiseActive) {
      runtime.autopilotMode = "autopilot-coast-to-circularize";
      return {
        phase: "coast",
        throttle: 0,
        direction: tangent,
        mode: "autopilot-coast-for-recapture",
      };
    }
    const radialDamping = clamp(-radialSpeedKmS * 0.55, -0.22, 0.22);
    let direction = normalize(
      add(scale(tangent, 1), scale(up, radialDamping)),
      tangent,
    );
    const positivePeriErrorKm = Math.max(0, periErrorKm);
    const closeInFactor = clamp(
      positivePeriErrorKm / Math.max(targetAltitudeSafe * 0.2, 50),
      0,
      1,
    );
    const apoWindowThrottleFactor = (
      targetAltitudeSafe > 350
      && Number.isFinite(timeToApoapsisSec)
      && timeToApoapsisSec > 0
    )
      ? clamp(1 - (timeToApoapsisSec / 18), 0.1, 1)
      : 1;
    if (highOrbitPeriRaiseActive) {
      const apoCenteringBias = clamp(
        -radialSpeedKmS * 8,
        -0.035,
        0.035,
      );
      direction = normalize(
        add(scale(tangent, 1), scale(up, apoCenteringBias)),
        tangent,
      );
      const periRaiseThrottleFactor = clamp(
        positivePeriErrorKm / Math.max(targetAltitudeSafe * 0.6, 200),
        0,
        1,
      );
      const throttle = clamp(
        0.08 + (periRaiseThrottleFactor * 0.12),
        0.08,
        0.20,
      );
      return {
        phase: "powered",
        throttle,
        direction,
        mode: "autopilot-high-orbit-periapsis-raise",
      };
    }
    const finalPeriTrimActive =
      targetAltitudeSafe > 350
      && positivePeriErrorKm > 0
      && positivePeriErrorKm <= periTrimWindowKm
      && apoDefined
      && apoapsisKm >= targetAltitudeKm;
    if (finalPeriTrimActive) {
      const trimInwardBias = clamp(
        0.08 + ((positivePeriErrorKm / Math.max(periTrimWindowKm, 1e-6)) * 0.16),
        0.08,
        0.24,
      );
      direction = normalize(
        add(scale(tangent, 1), scale(up, -trimInwardBias)),
        tangent,
      );
    }
    const effectiveApoWindowThrottleFactor = finalPeriTrimActive
      ? Math.max(apoWindowThrottleFactor, 0.9)
      : apoWindowThrottleFactor;
    const minimumCircularizationThrottle = finalPeriTrimActive
      ? 0.14
      : (targetAltitudeSafe > 350 ? 0.14 : 0.16);
    const throttle = clamp(
      (
        (config.circularizationThrottle * (0.35 + (0.65 * closeInFactor)))
        + clamp(positivePeriErrorKm / targetAltitudeSafe, 0, 0.16)
        + clamp(-periErrorKm / targetAltitudeSafe, -0.08, 0)
      ) * effectiveApoWindowThrottleFactor,
      minimumCircularizationThrottle,
      0.72,
    );
    return {
      phase: "powered",
      throttle,
      direction,
      mode: "autopilot-circularization",
    };
  }

  const ascentProfile = stateDrivenAscentProfile({
    orbital,
    relPos,
    relVel,
    up,
    tangent,
    planeNormal,
    earthPole,
    targetCircularSpeedKmS,
    dynamicPressurePa,
    verticalAscentMaxAltitudeKm,
    gravityTurnEndAltitudeKm: lowOrbitLaunchProfileActive
      ? Math.max(Number(config.gravityTurnEndAltitudeKm) || 0, 38)
      : config.gravityTurnEndAltitudeKm,
    config,
  });
  let direction = ascentProfile.direction;
  const lowOrbitStage1ClimbBias = lowOrbitLaunchProfileActive
    ? clamp(
      (72 - Math.max(0, Number(orbital?.altitudeKm) || 0)) / 72,
      0,
      1,
    ) * 0.34
    : 0;
  if (lowOrbitStage1ClimbBias > 1e-6) {
    direction = normalize(
      add(scale(direction, 1), scale(up, lowOrbitStage1ClimbBias)),
      direction,
    );
  }
  let throttle = throttleForState(runtime.stageIndex, runtime.elapsedSeconds, dynamicPressurePa);
  let mode = ascentProfile.progradeCapture < 0.58
    ? "autopilot-pitch-program"
    : "autopilot-gravity-turn";
  const padReleaseDurationSec = Math.max(
    0,
    Number(config.padReleaseDurationSec) || 0,
  );
  const towerClearAltitudeKm = Math.max(
    0,
    Number(config.towerClearAltitudeKm) || 0,
  );
  const inPadReleaseWindow = runtime.stageIndex === 0 && runtime.elapsedSeconds < padReleaseDurationSec;
  const towerClearActive = runtime.stageIndex === 0
    && ascentProfile.towerClearActive
    && orbital.altitudeKm < towerClearAltitudeKm;
  if (towerClearActive) {
    mode = inPadReleaseWindow ? "autopilot-pad-release" : "autopilot-tower-clear";
  }
  if (ascentProfile.turnAltitudeProgress >= 1) {
    runtime.autopilotMode = "autopilot-apoapsis-raise";
    const apoDeficitKm = apoDefined ? targetAltitudeKm - apoapsisKm : targetAltitudeKm;
    const highOrbitTargetActive = targetAltitudeSafe > 350 && Number(runtime.stageIndex) >= 1;
    const positivePeriapsisKm = periDefined ? Math.max(0, periapsisKm) : 0;
    const highOrbitApoGuideMarginKm = Math.max(targetAltitudeSafe * 0.05, 25);
    const highOrbitInsertionAltitudeKm = Math.max(
      config.circularizationMinAltitudeKm,
      targetAltitudeSafe * 0.55,
    );
    const highOrbitPeriGuideKm = targetAltitudeSafe * 0.52;
    const highOrbitDirectInsertionActive = highOrbitTargetActive
      && (
        !apoDefined
        || apoapsisKm < (targetAltitudeKm + highOrbitApoGuideMarginKm)
      )
      && (
        orbital.altitudeKm < highOrbitInsertionAltitudeKm
        || !periDefined
        || periapsisKm < highOrbitPeriGuideKm
      );
    const radialBias = highOrbitDirectInsertionActive
      ? (() => {
        const altitudeProgress = clamp(
          orbital.altitudeKm / Math.max(highOrbitInsertionAltitudeKm, 1),
          0,
          1,
        );
        const periProgress = clamp(
          positivePeriapsisKm / Math.max(highOrbitPeriGuideKm, 1),
          0,
          1,
        );
        const insertionProgress = Math.max(altitudeProgress, periProgress);
        const tangentialProgress = clamp(
          tangentialSpeedKmS / Math.max(targetCircularSpeedKmS, 0.1),
          0,
          1.2,
        );
        const horizontalOverspeedRatio = Math.max(0, tangentialProgress - altitudeProgress);
        const apoCloseProgress = 1 - clamp(
          Math.max(0, apoDeficitKm) / Math.max(targetAltitudeSafe * 0.5, 200),
          0,
          1,
        );
        const atmosphericClimbBias = clamp(
          (140 - Math.max(0, Number(orbital.altitudeKm) || 0)) / 140,
          0,
          1,
        ) * 0.32;
        return clamp(
          0.28
            - (insertionProgress * 0.08)
            + (Math.max(0, apoDeficitKm) / targetAltitudeSafe) * 0.03
            + (horizontalOverspeedRatio * 1.2)
            + (apoCloseProgress * 0.18)
            + atmosphericClimbBias,
          0.28,
          0.9,
        );
      })()
      : clamp((apoDeficitKm / targetAltitudeSafe) * 0.13, -0.05, 0.06);
    direction = normalize(
      add(scale(tangent, 1), scale(up, radialBias)),
      tangent,
    );
    throttle = clamp(
      0.84 + clamp((apoDeficitKm / targetAltitudeSafe) * 0.28, -0.10, 0.14),
      0.72,
      config.ascentMaxThrottle,
    );
    if (highOrbitDirectInsertionActive) {
      const highOrbitInsertionThrottle = clamp(
        0.36 + (
          clamp(
            Math.max(0, apoDeficitKm) / Math.max(targetAltitudeSafe * 0.5, 200),
            0,
            1,
          ) * 0.52
        ),
        0.36,
        0.88,
      );
      return {
        phase: "powered",
        throttle: highOrbitInsertionThrottle,
        direction,
        mode: "autopilot-high-orbit-insertion",
      };
    }
    mode = "autopilot-apoapsis-raise";
  } else {
    runtime.autopilotMode = "autopilot-gravity-turn";
  }

  if (towerClearActive) {
    const relAir = atmosphereRelativeVelocityKmS(relPos, relVel, earthPole);
    const airspeedKmS = length(relAir);
    const minTrackAirspeedKmS = Math.max(0.02, Number(config.progradeTrackMinAirSpeedKmS) || 0.12);
    if (airspeedKmS >= minTrackAirspeedKmS) {
      const towerClearAoALimited = limitDirectionAngle({
        desiredDirection: direction,
        referenceDirection: normalize(relAir, direction),
        maxAngleRad: rad(clamp(Number(config.towerClearAoALimitDeg) || 2.5, 0.5, 8)),
        fallback: direction,
      });
      direction = towerClearAoALimited.direction;
    }
  }

  if (lowOrbitMissionStage1 && Number(orbital.altitudeKm) >= 16 && Number(orbital.altitudeKm) < 80) {
    const lowOrbitApoRaiseBias = clamp(
      0.34
        - ((Math.max(0, Number(orbital.altitudeKm) || 0) / 80) * 0.14)
        + Math.min(0.08, Math.max(0, -radialSpeedKmS) * 4),
      0.2,
      0.4,
    );
    const lowOrbitApoRaiseDirection = normalize(
      add(scale(tangent, 1), scale(up, lowOrbitApoRaiseBias)),
      tangent,
    );
    direction = normalize(
      mixVectors(direction, lowOrbitApoRaiseDirection, 0.72),
      lowOrbitApoRaiseDirection,
    );
    mode = "autopilot-apoapsis-raise";
  }

  if (lowOrbitLaunchProfileActive && Number(orbital.altitudeKm) < 65) {
    const minClimbWeight = clamp(
      0.66 - ((Math.max(0, Number(orbital.altitudeKm) || 0) / 65) * 0.4),
      0.26,
      0.66,
    );
    if (dot(direction, up) < minClimbWeight) {
      direction = limitDirectionAngle({
        desiredDirection: direction,
        referenceDirection: up,
        maxAngleRad: Math.acos(clamp(minClimbWeight, -1, 1)),
        fallback: up,
      }).direction;
    }
  }

  const climbGuardAltitudeKm = Math.max(config.ascentClimbGuardAltitudeKm || 0, verticalAscentMaxAltitudeKm || 0);
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

  const coastApoapsisGateKm = Math.max(
    config.circularizationMinAltitudeKm,
    targetAltitudeSafe > 350
      ? targetAltitudeSafe
      : (targetAltitudeSafe * 0.75),
  );
  const highOrbitDirectInsertionIncomplete =
    targetAltitudeSafe > 350
    && (
      !apoDefined
      || apoapsisKm < (targetAltitudeKm + Math.max(targetAltitudeSafe * 0.05, 25))
    )
    && (
      orbital.altitudeKm < Math.max(config.circularizationMinAltitudeKm, targetAltitudeSafe * 0.55)
      || !periDefined
      || periapsisKm < (targetAltitudeKm * 0.52)
    );
  const shouldCoastToApoapsis =
    !highOrbitDirectInsertionIncomplete
    && (
      apoDefined
      && apoapsisKm >= (targetAltitudeKm + config.insertionCutoffApoapsisMarginKm)
      && radialSpeedKmS > -0.005
      && orbital.altitudeKm >= Math.max(config.ascentCoastMinAltitudeKm || 0, 0)
    )
    || (
      !highOrbitDirectInsertionIncomplete
      && (
      apoDefined
      && apoapsisKm >= coastApoapsisGateKm
      && orbital.altitudeKm >= config.circularizationMinAltitudeKm
      && tangentialSpeedKmS >= (targetCircularSpeedKmS * 0.9)
      && radialSpeedKmS > -0.01
      )
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
