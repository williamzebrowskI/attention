import { LAUNCH_AUTOPILOT_CONFIG } from "./launchConfig.js";
import { LAUNCH_MISSION_IDS } from "./launchMissions.js";
import { REFUEL_TANKER_CONFIG } from "./refuel/config.js";
import {
  add,
  clamp,
  cross,
  dot,
  length,
  normalize,
  scale,
  subtract,
} from "./launchMath.js";
import {
  autopilotDirectionInTargetPlane,
  circularOrbitSpeedKmS,
  orbitalStateFromRelative,
} from "./launchGuidance.js";
import { planRefuelRendezvousCommand } from "../navigation_system/planners/refuelRendezvousPlanner.js";
import {
  MOON_PARKING_ORBIT_APOAPSIS_KM,
  MOON_PARKING_ORBIT_PERIAPSIS_KM,
} from "./lunar/constants.js";

const MOON_RETURN_MISSION_CONFIG = Object.freeze({
  parkingOrbitPeriapsisMinKm: MOON_PARKING_ORBIT_PERIAPSIS_KM,
  parkingOrbitApoapsisMinKm: MOON_PARKING_ORBIT_APOAPSIS_KM,
  orbitalRefuelTargetFraction: 0.88,
  orbitalRefuelMinFlights: 2,
  tliTargetApoapsisKm: 382_000,
  tliApoapsisMarginKm: 3_000,
  tliMinSpecificEnergyKm2S2: -0.28,
  tliReigniteEarthDistanceKm: 370_000,
  tliReigniteFallbackRadialKmS: -0.006,
  tliReigniteThrottleBase: 0.42,
  tliReigniteThrottleMax: 0.96,
  moonApproachDistanceKm: 120_000,
  midcourseMinClosingSpeedKmS: 0.02,
  midcourseClosingSpeedWindowKmS: 0.18,
  midcourseCorrectionThrottleBase: 0.22,
  midcourseCorrectionThrottleMax: 0.78,
  earthFallBackRadialSpeedKmS: -0.01,
  lunarInsertionAltitudeGateKm: 16_000,
  lunarOrbitApoapsisMaxKm: 14_000,
  lunarOrbitPeriapsisMinKm: 45,
  lunarHoldDurationSec: 2 * 3600,
  teiDepartureDistanceKm: 140_000,
  earthCaptureDistanceKm: 180_000,
  earthCaptureApoapsisMaxKm: 75_000,
  earthCapturePeriapsisMinKm: 120,
});

const EARTH_ORBIT_HOLD_MISSION_CONFIG = Object.freeze({
  insertionPeriapsisMinKm: 80,
  insertionApoapsisMinKm: 120,
  stablePeriapsisErrorKm: 3.5,
  stableApoapsisErrorKm: 3.5,
  stableRadialSpeedKmS: 0.0035,
  stableTangentialSpeedErrorKmS: 0.012,
  burnApoapsisErrorWeight: 0.65,
  burnPeriapsisErrorWeight: 0.95,
  burnRadialSpeedWeight: 4.2,
  burnDirectionRadialMixLimit: 0.38,
  throttleMin: 0.05,
  throttleMax: 0.74,
  throttleBase: 0.08,
  throttleAltitudeNormWindowKm: 18,
  throttleSpeedNormWindowKmS: 0.09,
  throttleRadialNormWindowKmS: 0.03,
  sustainedOrbitReserveKg: 20_000,
});

const ORBITAL_REFUEL_DEMO_CONFIG = Object.freeze({
  parkingOrbitPeriapsisMinKm: 150,
  parkingOrbitApoapsisMinKm: 180,
  refuelTargetFillFraction: 0.88,
  minimumCompletedFlights: 1,
  refuelFarDistanceKm: 15,
  refuelMidDistanceKm: 1.5,
  refuelDockDistanceKm: Number(REFUEL_TANKER_CONFIG.dockDistanceKm) || 0.014,
  refuelDockMaxRelativeSpeedKmS: Number(REFUEL_TANKER_CONFIG.dockMaxRelativeSpeedKmS) || 0.000045,
  recoveryPeriapsisHardMinKm: 130,
  recoveryPeriapsisSoftMinKm: 142,
  recoverySoftRadialDescendKmS: -0.0015,
  recoveryBurnWindowSec: 600,
  recoveryThrottleBase: 0.24,
  recoveryThrottleMax: 0.58,
  recoveryEmergencyAltitudeKm: 170,
  recoveryEmergencyThrottleBase: 0.38,
  recoveryEmergencyThrottleMax: 0.78,
  recoveryCloseRangeDistanceKm: 20,
  recoveryCloseRangeMaxRelativeSpeedKmS: 0.03,
  recoveryCloseRangeMinPeriapsisKm: 138,
  recoveryImmediatePeriapsisBurnKm: 138,
  recoveryImmediateAltitudeKm: 155,
  recoveryImmediateThrottleBase: 0.24,
  recoveryImmediateThrottleMax: 0.56,
  recoveryImmediateUpBias: 0.16,
});

function isRefuelFlowMissionId(missionId) {
  const id = String(missionId || "");
  return id === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
    || id === LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO;
}

export function defaultMissionPhaseForProfileId(missionId) {
  if (isRefuelFlowMissionId(missionId)) {
    return "launch_to_parking";
  }
  return "earth_orbit_hold";
}

export function setMissionPhase(runtime, nextPhase) {
  const phaseName = String(nextPhase || "").trim();
  if (!phaseName || runtime.mission.phase === phaseName) {
    return;
  }
  runtime.mission.phase = phaseName;
  runtime.mission.phaseStartedElapsedSec = runtime.elapsedSeconds;
}

function missionElapsedInPhaseSeconds(runtime) {
  return Math.max(0, runtime.elapsedSeconds - (Number(runtime.mission.phaseStartedElapsedSec) || 0));
}

export function isMoonTransferMissionActive(runtime) {
  if (!runtime?.mission) {
    return false;
  }
  if (!isRefuelFlowMissionId(runtime.mission.selectedId)) {
    return false;
  }
  return runtime.mission.phase !== "earth_orbit_hold";
}

function bodyStateFromNBody(state, bodyId) {
  return state?.dynamicBodies?.get(bodyId)
    || state?.staticSources?.get(bodyId)
    || null;
}

function missionOrbitTangent(relVel, up, planeNormal, pole) {
  return autopilotDirectionInTargetPlane(
    relVel,
    up,
    planeNormal || normalize(cross(up, relVel), pole),
    pole,
  );
}

function missionOrbitalRefuelModeFromPlanner(mode, fallback = "orbital-refuel-hold") {
  const modeText = String(mode || "").trim();
  if (!modeText) {
    return `mission-orbital-refuel-demo:${fallback}`;
  }
  if (modeText.startsWith("mission-orbital-refuel-demo:")) {
    return modeText;
  }
  if (modeText.startsWith("navsys:")) {
    const navSuffix = modeText.slice("navsys:".length);
    if (navSuffix === "orbital-refuel-docked-hold") {
      return "mission-orbital-refuel-demo:orbital-refuel-lock";
    }
    return `mission-orbital-refuel-demo:${navSuffix}`;
  }
  return `mission-orbital-refuel-demo:${modeText}`;
}

export function missionUsesSustainedOrbitReserve(runtime) {
  if (
    runtime?.mission?.selectedId !== LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD
    || Number(runtime?.stageIndex) < 1
  ) {
    return false;
  }
  const guidanceMode = String(runtime?.lastStep?.guidanceMode || runtime?.autopilotMode || "");
  const stationKeepingActive = guidanceMode.startsWith("mission-earth-orbit-hold:station-keeping");
  return runtime?.phase === "orbit" || stationKeepingActive;
}

function computeEarthOrbitHoldAutopilotCommand({
  runtime,
  orbital,
  relVel,
  up,
  earthPole,
  muKm3S2,
  earthRadiusKm,
}) {
  if (Number(runtime.stageIndex) < 1) {
    setMissionPhase(runtime, "earth_orbit_hold");
    return null;
  }

  const config = EARTH_ORBIT_HOLD_MISSION_CONFIG;
  const periapsisKm = Number(orbital.periapsisKm);
  const apoapsisKm = Number(orbital.apoapsisKm);
  const hasBoundOrbit = Number(orbital.specificEnergy) < 0;
  const insertionReady = hasBoundOrbit
    && Number.isFinite(periapsisKm)
    && Number.isFinite(apoapsisKm)
    && periapsisKm >= config.insertionPeriapsisMinKm
    && apoapsisKm >= config.insertionApoapsisMinKm;
  if (!insertionReady) {
    return null;
  }

  setMissionPhase(runtime, "earth_orbit_hold");
  runtime.mission.completed = false;

  const tangent = missionOrbitTangent(relVel, up, runtime.launchPlaneNormal, earthPole);
  const targetAltitudeKm = Number(runtime.targetOrbitAltitudeKm) || Number(LAUNCH_AUTOPILOT_CONFIG.targetOrbitAltitudeKm) || 250;
  const targetRadiusKm = Math.max(1, earthRadiusKm + targetAltitudeKm);
  const targetTangentialSpeedKmS = circularOrbitSpeedKmS(muKm3S2, targetRadiusKm);
  const radialSpeedKmS = Number(orbital.radialSpeedKmS) || 0;
  const tangentialSpeedKmS = Number(orbital.tangentialSpeedKmS) || 0;

  const apoErrorKm = Number.isFinite(apoapsisKm) ? (targetAltitudeKm - apoapsisKm) : targetAltitudeKm;
  const periErrorKm = Number.isFinite(periapsisKm) ? (targetAltitudeKm - periapsisKm) : targetAltitudeKm;
  const tangentialSpeedErrorKmS = targetTangentialSpeedKmS - tangentialSpeedKmS;

  const stable = Math.abs(apoErrorKm) <= config.stableApoapsisErrorKm
    && Math.abs(periErrorKm) <= config.stablePeriapsisErrorKm
    && Math.abs(radialSpeedKmS) <= config.stableRadialSpeedKmS
    && Math.abs(tangentialSpeedErrorKmS) <= config.stableTangentialSpeedErrorKmS;

  if (stable) {
    return {
      phase: "orbit",
      throttle: 0,
      direction: tangent,
      mode: "mission-earth-orbit-hold:station-keeping",
    };
  }

  const tangentialSign = tangentialSpeedErrorKmS >= 0 ? 1 : -1;
  const tangentialDirection = scale(tangent, tangentialSign);
  const radialMixRaw = (
    (periErrorKm * config.burnPeriapsisErrorWeight)
    + (apoErrorKm * config.burnApoapsisErrorWeight)
  ) / Math.max(targetAltitudeKm, 1) - (radialSpeedKmS * config.burnRadialSpeedWeight);
  const radialMix = clamp(
    radialMixRaw,
    -config.burnDirectionRadialMixLimit,
    config.burnDirectionRadialMixLimit,
  );
  const direction = normalize(
    add(scale(tangentialDirection, 1), scale(up, radialMix)),
    tangentialDirection,
  );

  const altitudeErrorNorm = clamp(
    Math.max(Math.abs(apoErrorKm), Math.abs(periErrorKm)) / Math.max(config.throttleAltitudeNormWindowKm, 1),
    0,
    1,
  );
  const speedErrorNorm = clamp(
    Math.abs(tangentialSpeedErrorKmS) / Math.max(config.throttleSpeedNormWindowKmS, 1e-6),
    0,
    1,
  );
  const radialErrorNorm = clamp(
    Math.abs(radialSpeedKmS) / Math.max(config.throttleRadialNormWindowKmS, 1e-6),
    0,
    1,
  );
  const throttle = clamp(
    config.throttleBase
      + (altitudeErrorNorm * 0.44)
      + (speedErrorNorm * 0.4)
      + (radialErrorNorm * 0.24),
    config.throttleMin,
    config.throttleMax,
  );

  return {
    phase: "powered",
    throttle,
    direction,
    mode: "mission-earth-orbit-hold:station-keeping-burn",
  };
}

function computeMoonOrbitReturnAutopilotCommand({
  runtime,
  state,
  rocketState,
  orbital,
  relPos,
  relVel,
  up,
  earthPole,
  gravitationalConstantKm3PerKgS2,
  getBodyRadiusKm,
  getBodyMassKg,
}) {
  if (runtime.stageIndex < 1) {
    setMissionPhase(runtime, "launch_to_parking");
    return null;
  }
  const tangent = missionOrbitTangent(relVel, up, runtime.launchPlaneNormal, earthPole);
  const moonState = bodyStateFromNBody(state, "moon");
  const moonMassKg = Number(getBodyMassKg?.("moon")) || Number(moonState?.massKg) || 7.342e22;
  const moonRadiusKm = Number(getBodyRadiusKm?.("moon")) || 1737.4;
  const moonMuKm3S2 = gravitationalConstantKm3PerKgS2 * moonMassKg;

  const moonRelPos = moonState?.position ? subtract(rocketState.position, moonState.position) : null;
  const moonRelVel = moonState?.velocity
    ? subtract(rocketState.velocity, moonState.velocity)
    : null;
  const moonDistanceKm = moonRelPos ? length(moonRelPos) : Number.POSITIVE_INFINITY;
  const moonAltitudeKm = moonDistanceKm - moonRadiusKm;
  const moonOrbit = moonRelPos && moonRelVel
    ? orbitalStateFromRelative(moonMuKm3S2, moonRadiusKm, moonRelPos, moonRelVel)
    : null;
  const earthDistanceKm = length(relPos);
  const earthDirection = normalize(scale(relPos, -1), scale(up, -1));
  const moonDirection = moonRelPos
    ? normalize(scale(moonRelPos, -1), tangent)
    : tangent;
  const moonClosingSpeedKmS = moonRelPos && moonRelVel
    ? -dot(moonRelVel, normalize(moonRelPos, tangent))
    : 0;
  const earthRadialSpeedKmS = earthDistanceKm > 1e-6
    ? dot(relPos, relVel) / earthDistanceKm
    : 0;

  const phase = runtime.mission.phase || "launch_to_parking";
  const config = MOON_RETURN_MISSION_CONFIG;

  if (phase === "launch_to_parking") {
    const parkingReady = Number(orbital.periapsisKm) >= config.parkingOrbitPeriapsisMinKm
      && Number(orbital.apoapsisKm) >= config.parkingOrbitApoapsisMinKm
      && orbital.specificEnergy < 0;
    if (parkingReady) {
      setMissionPhase(runtime, "orbital_refuel");
      return {
        phase: "coast",
        throttle: 0,
        direction: tangent,
        mode: "mission-moon-orbit-return:orbital-refuel-setup",
      };
    }
    return null;
  }

  if (phase === "orbital_refuel") {
    const targetPropellantKg = Math.max(
      0,
      Number(runtime?.refuel?.targetPropellantKg) || 0,
    );
    const stagePropellantKg = Math.max(0, Number(runtime?.stagePropellantKg) || 0);
    const targetFraction = clamp(
      Number(config.orbitalRefuelTargetFraction) || 0.88,
      0.25,
      1,
    );
    const enoughPropellant = targetPropellantKg > 0
      ? stagePropellantKg >= (targetPropellantKg * targetFraction)
      : false;
    const transferBusy = Boolean(
      runtime?.refuel?.transferActive
      || runtime?.refuel?.undockActive,
    );
    if (enoughPropellant && !transferBusy) {
      setMissionPhase(runtime, "tli_burn");
      return {
        phase: "coast",
        throttle: 0,
        direction: tangent,
        mode: "mission-moon-orbit-return:tli-setup",
      };
    }
    return {
      phase: "coast",
      throttle: 0,
      direction: tangent,
      mode: transferBusy
        ? "mission-moon-orbit-return:orbital-refuel-transfer"
        : "mission-moon-orbit-return:orbital-refuel-hold",
    };
  }

  if (phase === "tli_burn") {
    const apo = Number(orbital.apoapsisKm);
    const apoReached = Number.isFinite(apo) && apo >= (config.tliTargetApoapsisKm - config.tliApoapsisMarginKm);
    const lunarInterceptTrending =
      moonDistanceKm <= config.tliTargetApoapsisKm
      || moonClosingSpeedKmS >= config.midcourseMinClosingSpeedKmS;
    const escapeReady = Number(orbital.specificEnergy) >= config.tliMinSpecificEnergyKm2S2;
    if (apoReached && lunarInterceptTrending && escapeReady) {
      setMissionPhase(runtime, "coast_to_moon");
      return {
        phase: "coast",
        throttle: 0,
        direction: tangent,
        mode: "mission-moon-orbit-return:coast-to-moon",
      };
    }
    const apoDeficitKm = Number.isFinite(apo) ? (config.tliTargetApoapsisKm - apo) : config.tliTargetApoapsisKm;
    const energyDeficit = clamp(
      (config.tliMinSpecificEnergyKm2S2 - Number(orbital.specificEnergy))
        / Math.max(Math.abs(config.tliMinSpecificEnergyKm2S2), 1e-6),
      0,
      1,
    );
    const closingDeficit = clamp(
      (config.midcourseMinClosingSpeedKmS - moonClosingSpeedKmS) / Math.max(config.midcourseClosingSpeedWindowKmS, 1e-6),
      0,
      1,
    );
    const throttle = clamp(
      0.24
        + (clamp(apoDeficitKm / config.tliTargetApoapsisKm, 0, 1) * 0.42)
        + (closingDeficit * 0.18)
        + (energyDeficit * 0.24),
      0.18,
      0.96,
    );
    const direction = normalize(
      add(
        scale(tangent, 0.68),
        add(
          scale(moonDirection, 0.26),
          scale(up, 0.08),
        ),
      ),
      tangent,
    );
    return {
      phase: "powered",
      throttle,
      direction,
      mode: "mission-moon-orbit-return:tli-burn",
    };
  }

  if (phase === "coast_to_moon") {
    if (moonDistanceKm <= config.moonApproachDistanceKm) {
      setMissionPhase(runtime, "lunar_insertion");
      return {
        phase: "coast",
        throttle: 0,
        direction: tangent,
        mode: "mission-moon-orbit-return:lunar-insertion-setup",
      };
    }
    const needsEscapeReignite =
      Number(orbital.specificEnergy) < config.tliMinSpecificEnergyKm2S2
      && earthDistanceKm < config.tliReigniteEarthDistanceKm
      && earthRadialSpeedKmS < config.tliReigniteFallbackRadialKmS;
    if (needsEscapeReignite) {
      const radialFallbackFactor = clamp(
        (config.tliReigniteFallbackRadialKmS - earthRadialSpeedKmS)
          / Math.max(Math.abs(config.tliReigniteFallbackRadialKmS), 1e-6),
        0,
        1,
      );
      const reigniteDirection = normalize(
        add(
          scale(tangent, 0.66),
          add(
            scale(moonDirection, 0.28),
            scale(up, 0.06),
          ),
        ),
        tangent,
      );
      const reigniteThrottle = clamp(
        config.tliReigniteThrottleBase + (radialFallbackFactor * 0.34),
        config.tliReigniteThrottleBase,
        config.tliReigniteThrottleMax,
      );
      return {
        phase: "powered",
        throttle: reigniteThrottle,
        direction: reigniteDirection,
        mode: "mission-moon-orbit-return:tli-reignite",
      };
    }
    const fallingBackToEarth =
      earthRadialSpeedKmS < config.earthFallBackRadialSpeedKmS
      && earthDistanceKm < config.tliTargetApoapsisKm;
    const needsMidcourseCorrection =
      moonDistanceKm > config.moonApproachDistanceKm
      && (
        moonClosingSpeedKmS < config.midcourseMinClosingSpeedKmS
        || fallingBackToEarth
      );
    if (needsMidcourseCorrection) {
      const closingDeficit = clamp(
        (config.midcourseMinClosingSpeedKmS - moonClosingSpeedKmS) / Math.max(config.midcourseClosingSpeedWindowKmS, 1e-6),
        0,
        1,
      );
      const correctionDirection = normalize(
        add(scale(moonDirection, 0.86), scale(tangent, 0.14)),
        moonDirection,
      );
      const throttle = clamp(
        config.midcourseCorrectionThrottleBase
          + (closingDeficit * 0.34)
          + (fallingBackToEarth ? 0.16 : 0),
        config.midcourseCorrectionThrottleBase,
        config.midcourseCorrectionThrottleMax,
      );
      return {
        phase: "powered",
        throttle,
        direction: correctionDirection,
        mode: "mission-moon-orbit-return:midcourse-correction",
      };
    }
    return {
      phase: "coast",
      throttle: 0,
      direction: moonDirection,
      mode: "mission-moon-orbit-return:coast-to-moon",
    };
  }

  if (phase === "lunar_insertion") {
    if (
      moonOrbit && moonOrbit.specificEnergy < 0
      && Number(moonOrbit.apoapsisKm) > 0
      && Number(moonOrbit.apoapsisKm) <= config.lunarOrbitApoapsisMaxKm
      && Number(moonOrbit.periapsisKm) >= config.lunarOrbitPeriapsisMinKm
    ) {
      setMissionPhase(runtime, "lunar_orbit_hold");
      return {
        phase: "coast",
        throttle: 0,
        direction: normalize(scale(moonRelVel || tangent, 1), tangent),
        mode: "mission-moon-orbit-return:lunar-orbit-hold",
      };
    }
    if (moonRelVel && moonRelPos && moonAltitudeKm <= config.lunarInsertionAltitudeGateKm) {
      const moonRetrograde = normalize(scale(moonRelVel, -1), earthDirection);
      const moonUp = normalize(moonRelPos, up);
      const direction = normalize(add(scale(moonRetrograde, 1), scale(moonUp, 0.22)), moonRetrograde);
      const moonSpeedTargetKmS = clamp(
        (moonMuKm3S2 > 0 && moonDistanceKm > 1)
          ? (Math.sqrt(moonMuKm3S2 / moonDistanceKm) * 1.08)
          : 1.4,
        0.55,
        2.2,
      );
      const moonSpeedErrorKmS = (Number(moonOrbit?.speedKmS) || 0) - moonSpeedTargetKmS;
      const throttle = clamp(
        0.14 + (moonSpeedErrorKmS * 0.38) + clamp((6000 - moonAltitudeKm) / 6000, 0, 1) * 0.26,
        0.08,
        0.96,
      );
      return {
        phase: "powered",
        throttle,
        direction,
        mode: "mission-moon-orbit-return:lunar-insertion",
      };
    }
    return {
      phase: "coast",
      throttle: 0,
      direction: tangent,
      mode: "mission-moon-orbit-return:coast-near-moon",
    };
  }

  if (phase === "lunar_orbit_hold") {
    if (missionElapsedInPhaseSeconds(runtime) >= config.lunarHoldDurationSec) {
      setMissionPhase(runtime, "tei_burn");
    }
    return {
      phase: "coast",
      throttle: 0,
      direction: moonRelVel ? normalize(moonRelVel, tangent) : tangent,
      mode: "mission-moon-orbit-return:lunar-orbit-hold",
    };
  }

  if (phase === "tei_burn") {
    const moonRetrograde = moonRelVel ? normalize(scale(moonRelVel, -1), earthDirection) : earthDirection;
    const teiDirection = normalize(
      add(scale(earthDirection, 1), scale(moonRetrograde, 0.36)),
      earthDirection,
    );
    const throttle = clamp(
      moonAltitudeKm < 25_000 ? 0.55 : 0.34,
      0.22,
      0.86,
    );
    if (moonDistanceKm >= config.teiDepartureDistanceKm && dot(relPos, relVel) < 0) {
      setMissionPhase(runtime, "coast_to_earth");
      return {
        phase: "coast",
        throttle: 0,
        direction: teiDirection,
        mode: "mission-moon-orbit-return:coast-to-earth",
      };
    }
    return {
      phase: "powered",
      throttle,
      direction: teiDirection,
      mode: "mission-moon-orbit-return:tei-burn",
    };
  }

  if (phase === "coast_to_earth") {
    if (earthDistanceKm <= config.earthCaptureDistanceKm) {
      setMissionPhase(runtime, "earth_capture");
    }
    return {
      phase: "coast",
      throttle: 0,
      direction: tangent,
      mode: "mission-moon-orbit-return:coast-to-earth",
    };
  }

  if (phase === "earth_capture") {
    const captureReady = orbital.specificEnergy < 0
      && Number(orbital.apoapsisKm) > 0
      && Number(orbital.apoapsisKm) <= config.earthCaptureApoapsisMaxKm
      && Number(orbital.periapsisKm) >= config.earthCapturePeriapsisMinKm;
    if (captureReady) {
      setMissionPhase(runtime, "earth_orbit_hold");
      runtime.mission.completed = true;
      return {
        phase: "orbit",
        throttle: 0,
        direction: tangent,
        mode: "mission-moon-orbit-return:earth-orbit-hold",
      };
    }
    const retrograde = normalize(scale(relVel, -1), earthDirection);
    const direction = normalize(add(scale(retrograde, 1), scale(up, 0.08)), retrograde);
    const altitudeDeficit = clamp((config.earthCaptureDistanceKm - orbital.altitudeKm) / config.earthCaptureDistanceKm, 0, 1);
    const throttle = clamp(0.18 + (altitudeDeficit * 0.48), 0.12, 0.9);
    return {
      phase: "powered",
      throttle,
      direction,
      mode: "mission-moon-orbit-return:earth-capture",
    };
  }

  return {
    phase: "orbit",
    throttle: 0,
    direction: tangent,
    mode: "mission-moon-orbit-return:earth-orbit-hold",
  };
}

function computeOrbitalRefuelDemoAutopilotCommand({
  runtime,
  orbital,
  relVel,
  up,
  earthPole,
  activeRefuelTarget,
}) {
  if (Number(runtime.stageIndex) < 1) {
    setMissionPhase(runtime, "launch_to_parking");
    runtime.mission.completed = false;
    return null;
  }

  const tangent = missionOrbitTangent(relVel, up, runtime.launchPlaneNormal, earthPole);
  const phase = runtime.mission.phase || "launch_to_parking";
  const config = ORBITAL_REFUEL_DEMO_CONFIG;

  if (phase === "launch_to_parking") {
    const parkingReady = Number(orbital.periapsisKm) >= config.parkingOrbitPeriapsisMinKm
      && Number(orbital.apoapsisKm) >= config.parkingOrbitApoapsisMinKm
      && orbital.specificEnergy < 0;
    if (parkingReady) {
      setMissionPhase(runtime, "orbital_refuel");
      return {
        phase: "coast",
        throttle: 0,
        direction: tangent,
        mode: "mission-orbital-refuel-demo:orbital-refuel-setup",
      };
    }
    runtime.mission.completed = false;
    return null;
  }

  if (phase === "orbital_refuel") {
    const targetPropellantKg = Math.max(0, Number(runtime?.refuel?.targetPropellantKg) || 0);
    const stagePropellantKg = Math.max(0, Number(runtime?.stagePropellantKg) || 0);
    const targetFraction = clamp(
      Number(config.refuelTargetFillFraction) || 0.88,
      0.25,
      1,
    );
    const completedFlights = Math.max(0, Number(runtime?.refuel?.completedFlights) || 0);
    const enoughPropellant = targetPropellantKg > 0
      ? stagePropellantKg >= (targetPropellantKg * targetFraction)
      : completedFlights >= Math.max(1, Number(config.minimumCompletedFlights) || 1);
    const transferBusy = Boolean(
      runtime?.refuel?.transferActive
      || runtime?.refuel?.undockActive,
    );
    if (enoughPropellant && !transferBusy) {
      setMissionPhase(runtime, "earth_orbit_hold");
      runtime.mission.completed = true;
      return {
        phase: "orbit",
        throttle: 0,
        direction: tangent,
        mode: "mission-orbital-refuel-demo:earth-orbit-hold",
      };
    }
    const periapsisKm = Number(orbital?.periapsisKm);
    const altitudeKm = Number(orbital?.altitudeKm);
    const radialSpeedKmS = Number(orbital?.radialSpeedKmS) || 0;
    const timeToApoapsisSec = Number(orbital?.timeToApoapsisSec);
    const refuelDistanceKm = Number(activeRefuelTarget?.distanceKm);
    const refuelRelativeSpeedKmS = Math.max(0, Number(activeRefuelTarget?.relativeSpeedKmS) || 0);
    const refuelClosingSpeedKmS = Number(activeRefuelTarget?.closingSpeedKmS);
    const toRefuelTarget = activeRefuelTarget?.relativePositionKm || null;
    const nearApoapsisForRecovery = Number.isFinite(timeToApoapsisSec)
      && Math.abs(timeToApoapsisSec) <= Math.max(80, Number(config.recoveryBurnWindowSec) || 260);
    const emergencyRecoveryNeeded = Number.isFinite(periapsisKm)
      && periapsisKm < 0
      && Number.isFinite(altitudeKm)
      && altitudeKm < Math.max(120, Number(config.recoveryEmergencyAltitudeKm) || 170);
    if (emergencyRecoveryNeeded) {
      const periapsisDeficitKm = Math.max(0, Math.abs(periapsisKm));
      const throttle = clamp(
        (Number(config.recoveryEmergencyThrottleBase) || 0.38) + (periapsisDeficitKm / 1800),
        Number(config.recoveryEmergencyThrottleBase) || 0.38,
        Number(config.recoveryEmergencyThrottleMax) || 0.78,
      );
      const direction = normalize(
        add(scale(tangent, 0.93), scale(up, 0.07)),
        tangent,
      );
      return {
        phase: "powered",
        throttle,
        direction,
        mode: "mission-orbital-refuel-demo:orbit-recovery-emergency-burn",
      };
    }
    const recoveryNeeded = Number.isFinite(periapsisKm)
      && (
        periapsisKm < (Number(config.recoveryPeriapsisHardMinKm) || 130)
        || (
          periapsisKm < (Number(config.recoveryPeriapsisSoftMinKm) || 145)
          && radialSpeedKmS < (Number(config.recoverySoftRadialDescendKmS) || -0.0015)
        )
      );
    const closeRangeRecoveryBypass = recoveryNeeded
      && Number.isFinite(periapsisKm)
      && periapsisKm >= (Number(config.recoveryCloseRangeMinPeriapsisKm) || 138)
      && Number.isFinite(refuelDistanceKm)
      && refuelDistanceKm > 0
      && refuelDistanceKm <= (Number(config.recoveryCloseRangeDistanceKm) || 20)
      && refuelRelativeSpeedKmS <= (Number(config.recoveryCloseRangeMaxRelativeSpeedKmS) || 0.03)
      && (
        !Number.isFinite(refuelClosingSpeedKmS)
        || Math.abs(refuelClosingSpeedKmS) <= ((Number(config.recoveryCloseRangeMaxRelativeSpeedKmS) || 0.03) * 1.25)
      )
      && radialSpeedKmS >= -0.0035;
    if (recoveryNeeded && !closeRangeRecoveryBypass) {
      const immediateGuardBurn = (
        (
          Number.isFinite(periapsisKm)
          && periapsisKm <= (Number(config.recoveryImmediatePeriapsisBurnKm) || 138)
        )
        || (
          Number.isFinite(altitudeKm)
          && altitudeKm <= (Number(config.recoveryImmediateAltitudeKm) || 155)
          && radialSpeedKmS < -0.0008
        )
      );
      const recoveryBurnNow = nearApoapsisForRecovery || immediateGuardBurn;
      if (recoveryBurnNow) {
        const periapsisDeficitKm = Math.max(
          0,
          (Number(config.recoveryPeriapsisSoftMinKm) || 145) - periapsisKm,
        );
        const guardActive = immediateGuardBurn && !nearApoapsisForRecovery;
        const throttleBase = guardActive
          ? (Number(config.recoveryImmediateThrottleBase) || 0.24)
          : (Number(config.recoveryThrottleBase) || 0.24);
        const throttleMax = guardActive
          ? (Number(config.recoveryImmediateThrottleMax) || 0.56)
          : (Number(config.recoveryThrottleMax) || 0.58);
        const throttle = clamp(
          throttleBase + (periapsisDeficitKm / 220),
          throttleBase,
          throttleMax,
        );
        const guardUpBias = clamp(
          (Number(config.recoveryImmediateUpBias) || 0.16) + (Math.max(0, -radialSpeedKmS) * 18),
          0.12,
          0.32,
        );
        const direction = guardActive
          ? normalize(
            add(
              scale(tangent, 1 - guardUpBias),
              scale(up, guardUpBias),
            ),
            tangent,
          )
          : tangent;
        return {
          phase: "powered",
          throttle,
          direction,
          mode: guardActive
            ? "mission-orbital-refuel-demo:orbit-recovery-guard-burn"
            : "mission-orbital-refuel-demo:orbit-recovery-burn",
        };
      }
      return {
        phase: "coast",
        throttle: 0,
        direction: tangent,
        mode: "mission-orbital-refuel-demo:orbit-recovery-coast",
      };
    }
    if (
      !transferBusy
      && Number.isFinite(refuelDistanceKm)
      && refuelDistanceKm > 0
      && toRefuelTarget
    ) {
      const plannerCommand = planRefuelRendezvousCommand({
        targetVectors: {
          tangent,
          toRefuelTarget,
          refuelTargetRelativeVelocityKmS: activeRefuelTarget?.relativeVelocityKmS || { x: 0, y: 0, z: 0 },
        },
        metrics: {
          refuelTargetDistanceKm: refuelDistanceKm,
          refuelRelativeSpeedKmS,
          refuelClosingSpeedKmS,
        },
        tangent,
      });
      const rcsOnlyDistanceKm = Math.max(
        Number(config.refuelMidDistanceKm) || 1.5,
        Number(REFUEL_TANKER_CONFIG.refuelRcsOnlyDistanceKm) || 1.2,
      );
      const closeRangeRcsOnly = refuelDistanceKm <= rcsOnlyDistanceKm;
      const plannerPhaseRaw = String(plannerCommand?.phase || "").trim() === "powered"
        ? "powered"
        : "coast";
      const plannerPhase = closeRangeRcsOnly ? "coast" : plannerPhaseRaw;
      const plannerMode = missionOrbitalRefuelModeFromPlanner(
        plannerCommand?.mode,
        "orbital-refuel-hold",
      );
      const guidanceMode = closeRangeRcsOnly && plannerPhaseRaw === "powered"
        ? `${plannerMode}:rcs-only-final`
        : (closeRangeRecoveryBypass ? `${plannerMode}:periapsis-guard-pass` : plannerMode);
      return {
        phase: plannerPhase,
        throttle: plannerPhase === "powered"
          ? clamp(Number(plannerCommand?.throttle) || 0, 0, 1)
          : 0,
        direction: normalize(plannerCommand?.direction || tangent, tangent),
        mode: guidanceMode,
      };
    }
    runtime.mission.completed = false;
    return {
      phase: "coast",
      throttle: 0,
      direction: tangent,
      mode: transferBusy
        ? "mission-orbital-refuel-demo:orbital-refuel-transfer"
        : "mission-orbital-refuel-demo:orbital-refuel-hold",
    };
  }

  setMissionPhase(runtime, "earth_orbit_hold");
  runtime.mission.completed = true;
  return {
    phase: "orbit",
    throttle: 0,
    direction: tangent,
    mode: "mission-orbital-refuel-demo:earth-orbit-hold",
  };
}

export function computeMissionAutopilotCommand({
  runtime,
  state,
  rocketState,
  orbital,
  relPos,
  relVel,
  up,
  earthPole,
  muKm3S2,
  gravitationalConstantKm3PerKgS2,
  earthRadiusKm,
  getBodyRadiusKm,
  getBodyMassKg,
  activeRefuelTarget,
}) {
  if (runtime?.mission?.selectedId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
    return computeMoonOrbitReturnAutopilotCommand({
      runtime,
      state,
      rocketState,
      orbital,
      relPos,
      relVel,
      up,
      earthPole,
      muKm3S2,
      gravitationalConstantKm3PerKgS2,
      earthRadiusKm,
      getBodyRadiusKm,
      getBodyMassKg,
    });
  }
  if (runtime?.mission?.selectedId === LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO) {
    return computeOrbitalRefuelDemoAutopilotCommand({
      runtime,
      orbital,
      relVel,
      up,
      earthPole,
      activeRefuelTarget,
    });
  }
  if (runtime?.mission?.selectedId === LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD) {
    return computeEarthOrbitHoldAutopilotCommand({
      runtime,
      orbital,
      relVel,
      up,
      earthPole,
      muKm3S2,
      earthRadiusKm,
    });
  }
  return null;
}
