import {
  EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
  LAUNCH_AUTOPILOT_CONFIG,
  LAUNCH_BODY_ID,
  LAUNCH_BODY_META,
  LAUNCH_INITIAL_MASS_KG,
  LAUNCH_RCS_CONFIG,
  LAUNCH_SITE,
  LAUNCH_VEHICLE_CONFIG,
  SEA_LEVEL_PRESSURE_PA,
  STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM,
  STANDARD_GRAVITY_M_S2,
} from "./launchConfig.js";

const MIN_ROCKET_MASS_KG = 500;
const EPS = 1e-12;
const TWO_PI = Math.PI * 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rad(degrees) {
  return (degrees * Math.PI) / 180;
}

function length(v) {
  return Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z));
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v, scalar) {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function cross(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function normalize(v, fallback = { x: 0, y: 0, z: 1 }) {
  const mag = length(v);
  if (!(mag > EPS)) {
    return { ...fallback };
  }
  return {
    x: v.x / mag,
    y: v.y / mag,
    z: v.z / mag,
  };
}

function mixVectors(a, b, t) {
  const tt = clamp(t, 0, 1);
  return {
    x: (a.x * (1 - tt)) + (b.x * tt),
    y: (a.y * (1 - tt)) + (b.y * tt),
    z: (a.z * (1 - tt)) + (b.z * tt),
  };
}

function fallbackAxes() {
  return {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    pole: { x: 0, y: 0, z: 1 },
  };
}

function sanitizeAxes(rawAxes) {
  if (!rawAxes) {
    return fallbackAxes();
  }
  const pole = normalize(rawAxes.pole || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const xAxisRaw = normalize(rawAxes.xAxis || { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const yAxisOrtho = normalize(cross(pole, xAxisRaw), { x: 0, y: 1, z: 0 });
  const xAxisOrtho = normalize(cross(yAxisOrtho, pole), { x: 1, y: 0, z: 0 });
  return { xAxis: xAxisOrtho, yAxis: yAxisOrtho, pole };
}

function stageAtIndex(stageIndex) {
  return LAUNCH_VEHICLE_CONFIG.stages[stageIndex] || null;
}

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

function computePadState({ earthState, earthRadiusKm, earthAxes }) {
  if (!earthState?.position) {
    return null;
  }
  const up = bodyDirectionFromLatLon(
    earthAxes,
    LAUNCH_SITE.latitudeDeg,
    LAUNCH_SITE.longitudeDeg,
  );
  const launchRadiusKm =
    earthRadiusKm
    + LAUNCH_SITE.altitudeKm
    + STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM;
  const relPositionKm = scale(up, launchRadiusKm);
  const angularVelocity = scale(earthAxes.pole, EARTH_SIDEREAL_ANGULAR_RATE_RAD_S);
  const localRotationalVelocityKmS = cross(angularVelocity, relPositionKm);
  return {
    position: add(earthState.position, relPositionKm),
    velocity: add(earthState.velocity || { x: 0, y: 0, z: 0 }, localRotationalVelocityKmS),
  };
}

function pressureRatio(pressurePa) {
  if (!Number.isFinite(pressurePa) || pressurePa <= 0) {
    return 0;
  }
  return clamp(pressurePa / SEA_LEVEL_PRESSURE_PA, 0, 1);
}

function interpolateSeaToVac(vacuumValue, seaLevelValue, pressurePa) {
  const sea = Number.isFinite(seaLevelValue) ? seaLevelValue : vacuumValue;
  return vacuumValue - ((vacuumValue - sea) * pressureRatio(pressurePa));
}

function guidanceDirection({
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

function normalizeAngleRadians(angle) {
  if (!Number.isFinite(angle)) {
    return 0;
  }
  let normalized = angle % TWO_PI;
  if (normalized < 0) {
    normalized += TWO_PI;
  }
  return normalized;
}

function unitOrNull(v) {
  const mag = length(v);
  if (!(mag > EPS)) {
    return null;
  }
  return { x: v.x / mag, y: v.y / mag, z: v.z / mag };
}

function angleBetweenRadians(a, b) {
  const ua = unitOrNull(a);
  const ub = unitOrNull(b);
  if (!ua || !ub) {
    return 0;
  }
  const cosTheta = clamp(dot(ua, ub), -1, 1);
  return Math.acos(cosTheta);
}

function degrees(valueRad) {
  return (valueRad * 180) / Math.PI;
}

function rcsJetSelection(correctionDir, referenceForward, referenceUp) {
  const jets = [];
  const forward = unitOrNull(referenceForward) || { x: 0, y: 1, z: 0 };
  const up = unitOrNull(referenceUp) || { x: 0, y: 0, z: 1 };
  const right = unitOrNull(cross(forward, up)) || { x: 1, y: 0, z: 0 };
  const vertical = unitOrNull(cross(right, forward)) || up;
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

function computeRcsAssist({
  stageIndex,
  desiredDirection,
  relVel,
  up,
}) {
  if (!LAUNCH_RCS_CONFIG.enabled || stageIndex < LAUNCH_RCS_CONFIG.minStageIndex) {
    return {
      accelerationKmS2: { x: 0, y: 0, z: 0 },
      active: false,
      errorDeg: 0,
      authority: 0,
      jets: [],
    };
  }

  const speedKmS = length(relVel);
  const forward = speedKmS > LAUNCH_RCS_CONFIG.minReferenceSpeedKmS
    ? normalize(relVel, desiredDirection || up || { x: 0, y: 1, z: 0 })
    : normalize(desiredDirection || up || { x: 0, y: 1, z: 0 });
  const desired = normalize(desiredDirection || forward, forward);
  const errorRad = angleBetweenRadians(forward, desired);
  const errorDeg = degrees(errorRad);
  const deadbandDeg = LAUNCH_RCS_CONFIG.deadbandDeg;
  const fullAuthorityDeg = Math.max(deadbandDeg + 0.1, LAUNCH_RCS_CONFIG.fullAuthorityDeg);
  const authority = clamp((errorDeg - deadbandDeg) / (fullAuthorityDeg - deadbandDeg), 0, 1);
  if (!(authority > 0)) {
    return {
      accelerationKmS2: { x: 0, y: 0, z: 0 },
      active: false,
      errorDeg,
      authority: 0,
      jets: [],
    };
  }

  const lateralCorrection = subtract(desired, scale(forward, dot(desired, forward)));
  const correctionDir = unitOrNull(lateralCorrection);
  if (!correctionDir) {
    return {
      accelerationKmS2: { x: 0, y: 0, z: 0 },
      active: false,
      errorDeg,
      authority: 0,
      jets: [],
    };
  }

  const accelerationMagnitude = LAUNCH_RCS_CONFIG.maxAccelerationKmS2 * authority;
  const accelerationKmS2 = scale(correctionDir, accelerationMagnitude);
  return {
    accelerationKmS2,
    active: true,
    errorDeg,
    authority,
    jets: rcsJetSelection(correctionDir, forward, up),
  };
}

function circularOrbitSpeedKmS(muKm3S2, radiusKm) {
  if (!(muKm3S2 > 0) || !(radiusKm > 0)) {
    return 0;
  }
  return Math.sqrt(muKm3S2 / radiusKm);
}

function computeLaunchPlaneNormal(earthAxes) {
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

function orbitalStateFromRelative(muKm3S2, earthRadiusKm, relPos, relVel) {
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

function autopilotDirectionInTargetPlane(relVel, up, planeNormal, earthPole) {
  let tangent = normalize(
    cross(planeNormal, up),
    normalize(cross(up, earthPole), normalize(relVel, up)),
  );
  if (dot(tangent, relVel) < 0) {
    tangent = scale(tangent, -1);
  }
  return tangent;
}

function computeAutopilotCommand({
  runtime,
  orbital,
  relVel,
  up,
  earthPole,
  muKm3S2,
  earthRadiusKm,
}) {
  const config = LAUNCH_AUTOPILOT_CONFIG;
  const targetAltitudeKm = config.targetOrbitAltitudeKm;
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

  const planeNormal = runtime.launchPlaneNormal || normalize(cross(up, relVel), earthPole);
  const tangent = autopilotDirectionInTargetPlane(relVel, up, planeNormal, earthPole);

  if (runtime.autopilotMode === "autopilot-orbital-hold") {
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
    const doneCircularizing =
      periErrorKm <= config.orbitalHoldMaxPeriapsisErrorKm
      && tangentialSpeedErrorKmS <= 0.02;
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
      runtime.autopilotMode = "autopilot-orbital-hold";
      return {
        phase: "orbit",
        throttle: 0,
        direction: tangent,
        mode: "autopilot-orbital-hold",
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
    runtime.autopilotMode = "autopilot-vertical-ascent";
    return {
      phase: "powered",
      throttle: throttleForState(runtime.stageIndex, runtime.elapsedSeconds),
      direction: up,
      mode: "autopilot-vertical-ascent",
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
  let throttle = throttleForState(runtime.stageIndex, runtime.elapsedSeconds);
  let mode = "autopilot-gravity-turn";
  if (gravityTurnBlend >= 1) {
    runtime.autopilotMode = "autopilot-apoapsis-raise";
    const apoDeficitKm = apoDefined ? targetAltitudeKm - apoapsisKm : targetAltitudeKm;
    const radialBias = clamp((apoDeficitKm / targetAltitudeSafe) * 0.42, -0.16, 0.22);
    direction = normalize(
      add(scale(tangent, 1), scale(up, radialBias)),
      tangent,
    );
    throttle = clamp(
      0.62 + clamp((apoDeficitKm / targetAltitudeSafe) * 0.45, -0.16, 0.22),
      0.34,
      config.ascentMaxThrottle,
    );
    mode = "autopilot-apoapsis-raise";
  } else {
    runtime.autopilotMode = "autopilot-gravity-turn";
  }

  const climbGuardAltitudeKm = Math.max(config.ascentClimbGuardAltitudeKm || 0, config.verticalAscentMaxAltitudeKm || 0);
  if (orbital.altitudeKm < climbGuardAltitudeKm) {
    const altitudeDeficit = clamp((climbGuardAltitudeKm - orbital.altitudeKm) / Math.max(climbGuardAltitudeKm, 1), 0, 1);
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

  const shouldCoastToApoapsis =
    (
      apoDefined
      && apoapsisKm >= (targetAltitudeKm + config.insertionCutoffApoapsisMarginKm)
      && radialSpeedKmS > -0.08
      && orbital.altitudeKm >= Math.max(config.ascentCoastMinAltitudeKm || 0, 0)
    )
    || (
      orbital.altitudeKm >= config.circularizationMinAltitudeKm
      && tangentialSpeedKmS >= (targetCircularSpeedKmS * 0.9)
      && radialSpeedKmS > -0.04
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

  return {
    phase: "powered",
    throttle,
    direction,
    mode,
  };
}

function throttleForState(stageIndex, elapsedSeconds) {
  if (stageIndex !== 0) {
    return 1;
  }
  if (elapsedSeconds < LAUNCH_VEHICLE_CONFIG.guidance.liftoffThrottleSec) {
    return LAUNCH_VEHICLE_CONFIG.guidance.liftoffThrottleValue;
  }
  if (
    elapsedSeconds >= LAUNCH_VEHICLE_CONFIG.guidance.maxQThrottleStartSec
    && elapsedSeconds <= LAUNCH_VEHICLE_CONFIG.guidance.maxQThrottleEndSec
  ) {
    return LAUNCH_VEHICLE_CONFIG.guidance.maxQThrottleValue;
  }
  return 1;
}

function telemetryFromState({
  gravitationalConstantKm3PerKgS2,
  earthMassKg,
  earthRadiusKm,
  earthState,
  rocketState,
  atmosphereSample,
  runtime,
}) {
  if (!rocketState || !earthState) {
    return null;
  }
  const relPos = subtract(rocketState.position, earthState.position);
  const relVel = subtract(
    rocketState.velocity,
    earthState.velocity || { x: 0, y: 0, z: 0 },
  );
  const mu = gravitationalConstantKm3PerKgS2 * earthMassKg;
  const orbital = orbitalStateFromRelative(mu, earthRadiusKm, relPos, relVel);
  const apoapsisKm = Number.isFinite(orbital.apoapsisKm) ? orbital.apoapsisKm : null;
  const periapsisKm = Number.isFinite(orbital.periapsisKm) ? orbital.periapsisKm : null;

  const densityKgM3 = Number(atmosphereSample?.densityKgM3) || 0;
  const dynamicPressurePa = 0.5 * densityKgM3 * Math.pow(orbital.speedKmS * 1000, 2);
  return {
    phase: runtime.phase,
    elapsedSeconds: runtime.elapsedSeconds,
    stageIndex: runtime.stageIndex,
    stageName: stageAtIndex(runtime.stageIndex)?.name || "Coast/Complete",
    massKg: rocketState.massKg,
    altitudeKm: orbital.altitudeKm,
    speedKmS: orbital.speedKmS,
    radialSpeedKmS: orbital.radialSpeedKmS,
    tangentialSpeedKmS: orbital.tangentialSpeedKmS,
    circularSpeedKmS: orbital.circularSpeedKmS,
    apoapsisKm,
    periapsisKm,
    timeToApoapsisSec: Number.isFinite(orbital.timeToApoapsisSec) ? orbital.timeToApoapsisSec : null,
    autopilotMode: runtime.autopilotMode || "manual",
    targetOrbitAltitudeKm: runtime.targetOrbitAltitudeKm || LAUNCH_AUTOPILOT_CONFIG.targetOrbitAltitudeKm,
    throttle: runtime.lastStep?.throttle || 0,
    thrustN: runtime.lastStep?.thrustN || 0,
    burnRateKgS: runtime.lastStep?.burnRateKgS || 0,
    dynamicPressurePa,
    guidanceMode: runtime.lastStep?.guidanceMode || "idle",
    rcsActive: Boolean(runtime.lastStep?.rcsActive),
    rcsErrorDeg: Number(runtime.lastStep?.rcsErrorDeg) || 0,
    rcsAuthority: Number(runtime.lastStep?.rcsAuthority) || 0,
    rcsJets: Array.isArray(runtime.lastStep?.rcsJets) ? [...runtime.lastStep.rcsJets] : [],
    boosterDistanceKm: runtime.boosterDistanceKm,
    starshipDistanceKm: runtime.starshipDistanceKm,
  };
}

function phaseLabel(phase) {
  if (phase === "powered") {
    return "Powered Ascent";
  }
  if (phase === "coast") {
    return "Coast";
  }
  if (phase === "orbit") {
    return "Orbit";
  }
  if (phase === "complete") {
    return "Mission Complete";
  }
  return "Idle";
}

export { LAUNCH_BODY_ID, LAUNCH_BODY_META };

export function createLaunchController(options) {
  const {
    getEarthRadiusKm,
    getEarthMassKg,
    getEarthFixedAxesEcliptic,
    sampleEarthAtmosphere,
    gravitationalConstantKm3PerKgS2,
  } = options || {};

  const runtime = {
    phase: "idle",
    elapsedSeconds: 0,
    stageIndex: 0,
    stagePropellantKg: stageAtIndex(0)?.propellantMassKg || 0,
    coastRemainingSec: 0,
    lastStep: null,
    lastTelemetry: null,
    lastError: "",
    autopilotEnabled: Boolean(LAUNCH_AUTOPILOT_CONFIG.enabled),
    autopilotMode: "idle",
    targetOrbitAltitudeKm: Number(LAUNCH_AUTOPILOT_CONFIG.targetOrbitAltitudeKm) || 250,
    launchPlaneNormal: null,
    boosterDistanceKm: 0,
    starshipDistanceKm: 0,
    lastTrackedPositionKm: null,
  };

  function earthAxes(timestampMs = Date.now()) {
    return sanitizeAxes(getEarthFixedAxesEcliptic?.(timestampMs) || fallbackAxes());
  }

  function earthStateFromNBody(state) {
    return state?.dynamicBodies?.get("earth") || state?.staticSources?.get("earth") || null;
  }

  function rocketStateFromNBody(state) {
    return state?.dynamicBodies?.get(LAUNCH_BODY_ID) || null;
  }

  function resetRuntime() {
    runtime.phase = "idle";
    runtime.elapsedSeconds = 0;
    runtime.stageIndex = 0;
    runtime.stagePropellantKg = stageAtIndex(0)?.propellantMassKg || 0;
    runtime.coastRemainingSec = 0;
    runtime.lastStep = null;
    runtime.lastError = "";
    runtime.autopilotMode = runtime.autopilotEnabled ? "autopilot-standby" : "manual-standby";
    runtime.launchPlaneNormal = null;
    runtime.boosterDistanceKm = 0;
    runtime.starshipDistanceKm = 0;
    runtime.lastTrackedPositionKm = null;
  }

  function earthFixedRelativePositionKm(rocketState, earthState, earthFrameAxes) {
    if (!rocketState?.position || !earthState?.position || !earthFrameAxes) {
      return null;
    }
    const rel = subtract(rocketState.position, earthState.position);
    return {
      x: dot(rel, earthFrameAxes.xAxis),
      y: dot(rel, earthFrameAxes.yAxis),
      z: dot(rel, earthFrameAxes.pole),
    };
  }

  function accumulateDistanceTravelled(
    rocketState,
    earthState,
    earthFrameAxes,
    stageIndexForDistance = runtime.stageIndex,
  ) {
    const relativePositionKm = earthFixedRelativePositionKm(
      rocketState,
      earthState,
      earthFrameAxes,
    );
    if (!relativePositionKm) {
      return;
    }
    const current = {
      x: Number(relativePositionKm.x) || 0,
      y: Number(relativePositionKm.y) || 0,
      z: Number(relativePositionKm.z) || 0,
    };
    if (!runtime.lastTrackedPositionKm) {
      runtime.lastTrackedPositionKm = current;
      return;
    }
    const dx = current.x - runtime.lastTrackedPositionKm.x;
    const dy = current.y - runtime.lastTrackedPositionKm.y;
    const dz = current.z - runtime.lastTrackedPositionKm.z;
    const stepDistanceKm = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
    runtime.lastTrackedPositionKm = current;
    if (!Number.isFinite(stepDistanceKm) || stepDistanceKm <= 0) {
      return;
    }
    if (stageIndexForDistance <= 0) {
      runtime.boosterDistanceKm += stepDistanceKm;
    } else {
      runtime.starshipDistanceKm += stepDistanceKm;
    }
  }

  function ensureCatalogBodies(catalogBodies) {
    const next = Array.isArray(catalogBodies) ? [...catalogBodies] : [];
    const index = next.findIndex((body) => body.id === LAUNCH_BODY_ID);
    if (index >= 0) {
      next[index] = {
        ...next[index],
        ...LAUNCH_BODY_META,
        mass_kg: Number(next[index].mass_kg) > 0 ? Number(next[index].mass_kg) : LAUNCH_BODY_META.mass_kg,
      };
      return next;
    }
    next.push({ ...LAUNCH_BODY_META });
    return next;
  }

  function injectStartupEntry(entriesById, timestampMs = Date.now()) {
    if (!entriesById || entriesById.has(LAUNCH_BODY_ID)) {
      return;
    }
    const earthEntry = entriesById.get("earth");
    const earthPosition = earthEntry?.coordinates_km;
    if (
      !Number.isFinite(Number(earthPosition?.x))
      || !Number.isFinite(Number(earthPosition?.y))
      || !Number.isFinite(Number(earthPosition?.z))
    ) {
      return;
    }
    const earthVelocity = earthEntry?.coordinates_velocity_km_s;
    const earthState = {
      position: {
        x: Number(earthPosition.x),
        y: Number(earthPosition.y),
        z: Number(earthPosition.z),
      },
      velocity: {
        x: Number(earthVelocity?.x) || 0,
        y: Number(earthVelocity?.y) || 0,
        z: Number(earthVelocity?.z) || 0,
      },
    };
    const pad = computePadState({
      earthState,
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
      earthAxes: earthAxes(timestampMs),
    });
    if (!pad) {
      return;
    }
    entriesById.set(LAUNCH_BODY_ID, {
      id: LAUNCH_BODY_ID,
      name: LAUNCH_BODY_META.name,
      source: "SIMULATED",
      coordinates_km: pad.position,
      coordinates_velocity_km_s: pad.velocity,
      source_error: null,
    });
  }

  function ensureRocketInNBody(state, nowMs = Date.now()) {
    if (!state?.dynamicBodies) {
      return null;
    }
    const existing = state.dynamicBodies.get(LAUNCH_BODY_ID);
    if (existing) {
      return existing;
    }
    const earthState = earthStateFromNBody(state);
    if (!earthState) {
      return null;
    }
    const pad = computePadState({
      earthState,
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
      earthAxes: earthAxes(nowMs),
    });
    if (!pad) {
      return null;
    }
    const rocketState = {
      id: LAUNCH_BODY_ID,
      massKg: LAUNCH_INITIAL_MASS_KG,
      position: { ...pad.position },
      velocity: { ...pad.velocity },
    };
    state.dynamicBodies.set(LAUNCH_BODY_ID, rocketState);
    return rocketState;
  }

  function resetToPad(state, nowMs = Date.now()) {
    const earthState = earthStateFromNBody(state);
    const rocketState = ensureRocketInNBody(state, nowMs);
    if (!earthState || !rocketState) {
      runtime.lastError = "Earth/rocket state unavailable";
      return false;
    }
    const pad = computePadState({
      earthState,
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
      earthAxes: earthAxes(nowMs),
    });
    if (!pad) {
      runtime.lastError = "Pad state unavailable";
      return false;
    }
    rocketState.position = { ...pad.position };
    rocketState.velocity = { ...pad.velocity };
    rocketState.massKg = LAUNCH_INITIAL_MASS_KG;
    resetRuntime();
    runtime.lastTrackedPositionKm = earthFixedRelativePositionKm(
      rocketState,
      earthState,
      earthAxes(nowMs),
    );
    runtime.launchPlaneNormal = computeLaunchPlaneNormal(earthAxes(nowMs));
    runtime.phase = "idle";
    runtime.lastTelemetry = telemetryFromState({
      gravitationalConstantKm3PerKgS2,
      earthMassKg: Number(getEarthMassKg?.()) || 0,
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
      earthState,
      rocketState,
      atmosphereSample: sampleEarthAtmosphere?.(LAUNCH_SITE.altitudeKm) || null,
      runtime,
    });
    return true;
  }

  function startLaunch(state, nowMs = Date.now()) {
    if (!resetToPad(state, nowMs)) {
      return false;
    }
    runtime.phase = "powered";
    runtime.autopilotMode = runtime.autopilotEnabled ? "autopilot-vertical-ascent" : "manual-ascent";
    return true;
  }

  function prepareStep(state, dtSeconds, nowMs = Date.now()) {
    runtime.lastStep = null;
    if (runtime.phase === "idle") {
      return;
    }
    if (runtime.phase === "complete") {
      runtime.phase = "coast";
    }

    const earthState = earthStateFromNBody(state);
    const rocketState = ensureRocketInNBody(state, nowMs);
    if (!earthState || !rocketState) {
      runtime.lastError = "Earth/rocket state unavailable";
      runtime.phase = "idle";
      return;
    }

    const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
    const relPos = subtract(rocketState.position, earthState.position);
    const relVel = subtract(
      rocketState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    const muKm3S2 = gravitationalConstantKm3PerKgS2 * (Number(getEarthMassKg?.()) || 0);
    const orbital = orbitalStateFromRelative(muKm3S2, earthRadiusKm, relPos, relVel);
    const altitudeKm = Math.max(0, length(relPos) - earthRadiusKm);
    const atmo = sampleEarthAtmosphere?.(altitudeKm) || null;
    const currentEarthAxes = earthAxes(nowMs);

    if (runtime.phase === "orbit") {
      runtime.lastStep = {
        accelerationKmS2: { x: 0, y: 0, z: 0 },
        throttle: 0,
        thrustN: 0,
        burnKg: 0,
        burnRateKgS: 0,
        guidanceMode: runtime.autopilotMode || "orbit-hold",
        rcsActive: false,
        rcsErrorDeg: 0,
        rcsAuthority: 0,
        rcsJets: [],
      };
      runtime.lastTelemetry = telemetryFromState({
        gravitationalConstantKm3PerKgS2,
        earthMassKg: Number(getEarthMassKg?.()) || 0,
        earthRadiusKm,
        earthState,
        rocketState,
        atmosphereSample: atmo,
        runtime,
      });
      return;
    }

    if (runtime.coastRemainingSec > 0) {
      runtime.coastRemainingSec = Math.max(0, runtime.coastRemainingSec - dtSeconds);
      runtime.phase = runtime.coastRemainingSec > 0 ? "coast" : "powered";
      const coastDirection = normalize(relVel, orbital.up);
      const rcs = computeRcsAssist({
        stageIndex: runtime.stageIndex,
        desiredDirection: coastDirection,
        relVel,
        up: orbital.up,
      });
      runtime.lastStep = {
        accelerationKmS2: rcs.accelerationKmS2,
        throttle: 0,
        thrustN: 0,
        burnKg: 0,
        burnRateKgS: 0,
        guidanceMode: "stage-separation-coast",
        rcsActive: rcs.active,
        rcsErrorDeg: rcs.errorDeg,
        rcsAuthority: rcs.authority,
        rcsJets: rcs.jets,
      };
      runtime.lastTelemetry = telemetryFromState({
        gravitationalConstantKm3PerKgS2,
        earthMassKg: Number(getEarthMassKg?.()) || 0,
        earthRadiusKm,
        earthState,
        rocketState,
        atmosphereSample: atmo,
        runtime,
      });
      return;
    }

    if (runtime.phase === "coast") {
      if (runtime.autopilotEnabled) {
        const autopilotCommand = computeAutopilotCommand({
          runtime,
          orbital,
          relVel,
          up: orbital.up,
          earthPole: currentEarthAxes.pole,
          muKm3S2,
          earthRadiusKm,
        });
        if (autopilotCommand.phase === "powered") {
          runtime.phase = "powered";
        } else if (autopilotCommand.phase === "orbit") {
          runtime.phase = "orbit";
          runtime.autopilotMode = autopilotCommand.mode || runtime.autopilotMode;
          const rcs = computeRcsAssist({
            stageIndex: runtime.stageIndex,
            desiredDirection: autopilotCommand.direction || normalize(relVel, orbital.up),
            relVel,
            up: orbital.up,
          });
          runtime.lastStep = {
            accelerationKmS2: rcs.accelerationKmS2,
            throttle: 0,
            thrustN: 0,
            burnKg: 0,
            burnRateKgS: 0,
            guidanceMode: autopilotCommand.mode || "autopilot-orbital-hold",
            rcsActive: rcs.active,
            rcsErrorDeg: rcs.errorDeg,
            rcsAuthority: rcs.authority,
            rcsJets: rcs.jets,
          };
          runtime.lastTelemetry = telemetryFromState({
            gravitationalConstantKm3PerKgS2,
            earthMassKg: Number(getEarthMassKg?.()) || 0,
            earthRadiusKm,
            earthState,
            rocketState,
            atmosphereSample: atmo,
            runtime,
          });
          return;
        } else {
          const rcs = computeRcsAssist({
            stageIndex: runtime.stageIndex,
            desiredDirection: autopilotCommand.direction || normalize(relVel, orbital.up),
            relVel,
            up: orbital.up,
          });
          runtime.lastStep = {
            accelerationKmS2: rcs.accelerationKmS2,
            throttle: 0,
            thrustN: 0,
            burnKg: 0,
            burnRateKgS: 0,
            guidanceMode: autopilotCommand.mode || "coast",
            rcsActive: rcs.active,
            rcsErrorDeg: rcs.errorDeg,
            rcsAuthority: rcs.authority,
            rcsJets: rcs.jets,
          };
          runtime.lastTelemetry = telemetryFromState({
            gravitationalConstantKm3PerKgS2,
            earthMassKg: Number(getEarthMassKg?.()) || 0,
            earthRadiusKm,
            earthState,
            rocketState,
            atmosphereSample: atmo,
            runtime,
          });
          return;
        }
      } else {
        const rcs = computeRcsAssist({
          stageIndex: runtime.stageIndex,
          desiredDirection: normalize(relVel, orbital.up),
          relVel,
          up: orbital.up,
        });
        runtime.lastStep = {
          accelerationKmS2: rcs.accelerationKmS2,
          throttle: 0,
          thrustN: 0,
          burnKg: 0,
          burnRateKgS: 0,
          guidanceMode: "coast",
          rcsActive: rcs.active,
          rcsErrorDeg: rcs.errorDeg,
          rcsAuthority: rcs.authority,
          rcsJets: rcs.jets,
        };
        runtime.lastTelemetry = telemetryFromState({
          gravitationalConstantKm3PerKgS2,
          earthMassKg: Number(getEarthMassKg?.()) || 0,
          earthRadiusKm,
          earthState,
          rocketState,
          atmosphereSample: atmo,
          runtime,
        });
        return;
      }
    }

    const stage = stageAtIndex(runtime.stageIndex);
    if (!stage) {
      const stableOrbit = orbital.specificEnergy < 0 && Number(orbital.periapsisKm) > 80;
      runtime.phase = stableOrbit ? "orbit" : "coast";
      runtime.autopilotMode = stableOrbit ? "autopilot-ballistic-hold" : "ballistic-coast";
      return;
    }

    const pressurePa = Number(atmo?.pressurePa) || 0;
    let throttle = throttleForState(runtime.stageIndex, runtime.elapsedSeconds);
    let guidance = guidanceDirection({
      rocketState,
      earthState,
      earthAxes: currentEarthAxes,
      elapsedSeconds: runtime.elapsedSeconds,
    });

    if (runtime.autopilotEnabled) {
      const autopilotCommand = computeAutopilotCommand({
        runtime,
        orbital,
        relVel,
        up: orbital.up,
        earthPole: currentEarthAxes.pole,
        muKm3S2,
        earthRadiusKm,
      });
      if (autopilotCommand.phase === "coast") {
        runtime.phase = "coast";
        const rcs = computeRcsAssist({
          stageIndex: runtime.stageIndex,
          desiredDirection: autopilotCommand.direction || guidance.direction,
          relVel,
          up: orbital.up,
        });
        runtime.lastStep = {
          accelerationKmS2: rcs.accelerationKmS2,
          throttle: 0,
          thrustN: 0,
          burnKg: 0,
          burnRateKgS: 0,
          guidanceMode: autopilotCommand.mode || "autopilot-coast",
          rcsActive: rcs.active,
          rcsErrorDeg: rcs.errorDeg,
          rcsAuthority: rcs.authority,
          rcsJets: rcs.jets,
        };
        runtime.lastTelemetry = telemetryFromState({
          gravitationalConstantKm3PerKgS2,
          earthMassKg: Number(getEarthMassKg?.()) || 0,
          earthRadiusKm,
          earthState,
          rocketState,
          atmosphereSample: atmo,
          runtime,
        });
        return;
      }
      if (autopilotCommand.phase === "orbit") {
        runtime.phase = "orbit";
        runtime.autopilotMode = autopilotCommand.mode || runtime.autopilotMode;
        const rcs = computeRcsAssist({
          stageIndex: runtime.stageIndex,
          desiredDirection: autopilotCommand.direction || guidance.direction,
          relVel,
          up: orbital.up,
        });
        runtime.lastStep = {
          accelerationKmS2: rcs.accelerationKmS2,
          throttle: 0,
          thrustN: 0,
          burnKg: 0,
          burnRateKgS: 0,
          guidanceMode: autopilotCommand.mode || "autopilot-orbital-hold",
          rcsActive: rcs.active,
          rcsErrorDeg: rcs.errorDeg,
          rcsAuthority: rcs.authority,
          rcsJets: rcs.jets,
        };
        runtime.lastTelemetry = telemetryFromState({
          gravitationalConstantKm3PerKgS2,
          earthMassKg: Number(getEarthMassKg?.()) || 0,
          earthRadiusKm,
          earthState,
          rocketState,
          atmosphereSample: atmo,
          runtime,
        });
        return;
      }
      throttle = clamp(Number(autopilotCommand.throttle), 0, 1);
      guidance = {
        direction: autopilotCommand.direction || guidance.direction,
        mode: autopilotCommand.mode || guidance.mode,
      };
    }

    const thrustN =
      interpolateSeaToVac(stage.thrustVacuumN, stage.thrustSeaLevelN, pressurePa)
      * throttle;
    const ispS = interpolateSeaToVac(stage.ispVacuumS, stage.ispSeaLevelS, pressurePa);
    const burnRateKgS = thrustN > 0 && ispS > 0
      ? thrustN / (ispS * STANDARD_GRAVITY_M_S2)
      : 0;
    const burnKg = Math.min(runtime.stagePropellantKg, burnRateKgS * dtSeconds);
    const effectiveMassKg = Math.max(
      MIN_ROCKET_MASS_KG,
      rocketState.massKg - (0.5 * burnKg),
    );
    const accelerationMagKmS2 = thrustN > 0
      ? (thrustN / effectiveMassKg) / 1000
      : 0;
    const mainAccelerationKmS2 = scale(guidance.direction, accelerationMagKmS2);
    const rcs = computeRcsAssist({
      stageIndex: runtime.stageIndex,
      desiredDirection: guidance.direction,
      relVel,
      up: orbital.up,
    });
    runtime.lastStep = {
      accelerationKmS2: add(mainAccelerationKmS2, rcs.accelerationKmS2),
      throttle,
      thrustN,
      burnKg,
      burnRateKgS,
      guidanceMode: guidance.mode,
      rcsActive: rcs.active,
      rcsErrorDeg: rcs.errorDeg,
      rcsAuthority: rcs.authority,
      rcsJets: rcs.jets,
    };
    runtime.lastTelemetry = telemetryFromState({
      gravitationalConstantKm3PerKgS2,
      earthMassKg: Number(getEarthMassKg?.()) || 0,
      earthRadiusKm,
      earthState,
      rocketState,
      atmosphereSample: atmo,
      runtime,
    });
  }

  function externalAccelerationKmS2(bodyId) {
    if (bodyId !== LAUNCH_BODY_ID) {
      return { x: 0, y: 0, z: 0 };
    }
    return runtime.lastStep?.accelerationKmS2 || { x: 0, y: 0, z: 0 };
  }

  function finalizeStep(state, dtSeconds, nowMs = Date.now()) {
    if (runtime.phase === "idle") {
      return;
    }
    if (runtime.phase === "complete") {
      runtime.phase = "coast";
    }
    const rocketState = rocketStateFromNBody(state);
    const earthState = earthStateFromNBody(state);
    if (!rocketState || !earthState) {
      runtime.phase = "idle";
      return;
    }
    const distanceStageIndex = runtime.stageIndex;
    accumulateDistanceTravelled(
      rocketState,
      earthState,
      earthAxes(nowMs),
      distanceStageIndex,
    );

    if (runtime.phase === "orbit") {
      const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
      const altitudeKm = Math.max(0, length(subtract(rocketState.position, earthState.position)) - earthRadiusKm);
      runtime.lastTelemetry = telemetryFromState({
        gravitationalConstantKm3PerKgS2,
        earthMassKg: Number(getEarthMassKg?.()) || 0,
        earthRadiusKm,
        earthState,
        rocketState,
        atmosphereSample: sampleEarthAtmosphere?.(altitudeKm) || null,
        runtime,
      });
      runtime.elapsedSeconds += dtSeconds;
      return;
    }

    runtime.elapsedSeconds += dtSeconds;

    const burnKg = Number(runtime.lastStep?.burnKg) || 0;
    if (burnKg > 0) {
      rocketState.massKg = Math.max(
        MIN_ROCKET_MASS_KG,
        rocketState.massKg - burnKg,
      );
      runtime.stagePropellantKg = Math.max(0, runtime.stagePropellantKg - burnKg);
    }

    const stage = stageAtIndex(runtime.stageIndex);
    if (stage && runtime.stagePropellantKg <= 1e-6) {
      rocketState.massKg = Math.max(
        MIN_ROCKET_MASS_KG,
        rocketState.massKg - stage.dryMassKg,
      );
      runtime.stageIndex += 1;
      const nextStage = stageAtIndex(runtime.stageIndex);
      if (nextStage) {
        runtime.stagePropellantKg = nextStage.propellantMassKg;
        runtime.coastRemainingSec = Math.max(0, Number(stage.coastAfterBurnSec) || 0);
        runtime.phase = runtime.coastRemainingSec > 0 ? "coast" : "powered";
      } else {
        runtime.stagePropellantKg = 0;
        const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
        const relPos = subtract(rocketState.position, earthState.position);
        const relVel = subtract(
          rocketState.velocity || { x: 0, y: 0, z: 0 },
          earthState.velocity || { x: 0, y: 0, z: 0 },
        );
        const muKm3S2 = gravitationalConstantKm3PerKgS2 * (Number(getEarthMassKg?.()) || 0);
        const orbital = orbitalStateFromRelative(muKm3S2, earthRadiusKm, relPos, relVel);
        const stableOrbit = orbital.specificEnergy < 0 && Number(orbital.periapsisKm) > 80;
        runtime.phase = stableOrbit ? "orbit" : "coast";
        runtime.autopilotMode = stableOrbit ? "autopilot-ballistic-hold" : "ballistic-coast";
      }
    }

    const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
    const altitudeKm = Math.max(0, length(subtract(rocketState.position, earthState.position)) - earthRadiusKm);
    runtime.lastTelemetry = telemetryFromState({
      gravitationalConstantKm3PerKgS2,
      earthMassKg: Number(getEarthMassKg?.()) || 0,
      earthRadiusKm,
      earthState,
      rocketState,
      atmosphereSample: sampleEarthAtmosphere?.(altitudeKm) || null,
      runtime,
    });
  }

  function statusSnapshot() {
    const telemetry = runtime.lastTelemetry;
    if (!telemetry) {
      return {
        bodyId: LAUNCH_BODY_ID,
        phase: runtime.phase,
        phaseLabel: phaseLabel(runtime.phase),
        stageIndex: runtime.stageIndex,
        autopilotMode: runtime.autopilotMode || "manual",
        targetOrbitAltitudeKm: runtime.targetOrbitAltitudeKm,
        rcsActive: false,
        rcsErrorDeg: 0,
        rcsAuthority: 0,
        rcsJets: [],
        boosterDistanceKm: runtime.boosterDistanceKm,
        starshipDistanceKm: runtime.starshipDistanceKm,
        launchSiteName: LAUNCH_SITE.name || "Launch Site",
        statusLine: `Launch vehicle initialized at ${LAUNCH_SITE.name || "launch site"}.`,
      };
    }
    return {
      bodyId: LAUNCH_BODY_ID,
      phase: runtime.phase,
      phaseLabel: phaseLabel(runtime.phase),
      stageName: telemetry.stageName,
      stageIndex: telemetry.stageIndex,
      launchSiteName: LAUNCH_SITE.name || "Launch Site",
      elapsedSeconds: telemetry.elapsedSeconds,
      massKg: telemetry.massKg,
      altitudeKm: telemetry.altitudeKm,
      speedKmS: telemetry.speedKmS,
      apoapsisKm: telemetry.apoapsisKm,
      periapsisKm: telemetry.periapsisKm,
      throttle: telemetry.throttle,
      thrustN: telemetry.thrustN,
      burnRateKgS: telemetry.burnRateKgS,
      dynamicPressurePa: telemetry.dynamicPressurePa,
      guidanceMode: telemetry.guidanceMode,
      autopilotMode: telemetry.autopilotMode,
      rcsActive: telemetry.rcsActive,
      rcsErrorDeg: telemetry.rcsErrorDeg,
      rcsAuthority: telemetry.rcsAuthority,
      rcsJets: telemetry.rcsJets,
      targetOrbitAltitudeKm: telemetry.targetOrbitAltitudeKm,
      radialSpeedKmS: telemetry.radialSpeedKmS,
      tangentialSpeedKmS: telemetry.tangentialSpeedKmS,
      circularSpeedKmS: telemetry.circularSpeedKmS,
      timeToApoapsisSec: telemetry.timeToApoapsisSec,
      boosterDistanceKm: telemetry.boosterDistanceKm,
      starshipDistanceKm: telemetry.starshipDistanceKm,
      statusLine: runtime.lastError || `${phaseLabel(runtime.phase)} | ${telemetry.stageName}`,
    };
  }

  return {
    ensureCatalogBodies,
    injectStartupEntry,
    ensureRocketInNBody,
    resetToPad,
    startLaunch,
    prepareStep,
    externalAccelerationKmS2,
    finalizeStep,
    statusSnapshot,
    isActive() {
      return runtime.phase !== "idle";
    },
  };
}
