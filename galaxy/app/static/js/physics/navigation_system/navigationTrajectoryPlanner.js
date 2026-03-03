import {
  clamp,
  normalize,
  scale,
  add,
  dot,
  length,
} from "./navigationMath.js";
import {
  NAVIGATION_MISSION_IDS,
  NAVIGATION_MISSION_PHASES,
} from "./navigationMissionProfiles.js";
import {
  NAVIGATION_DEFAULTS,
  NAVIGATION_SYSTEM_MODES,
  normalizeNavigationMode,
} from "./navigationSystemConfig.js";
import { REFUEL_TANKER_CONFIG } from "../launch/refuel/config.js";

function moonMissionBaselineCommand({
  phase,
  targetVectors = {},
  metrics = {},
  plannerConfig = NAVIGATION_DEFAULTS.planner,
} = {}) {
  const tangent = normalize(targetVectors.tangent, { x: 0, y: 1, z: 0 });
  const up = normalize(targetVectors.up, { x: 0, y: 0, z: 1 });
  const moonDirection = normalize(targetVectors.toMoon, tangent);
  const earthDirection = normalize(targetVectors.toEarth, scale(up, -1));
  const moonAltitudeKm = Number(metrics.moonAltitudeKm);
  const refuelDistanceKm = Number(metrics.refuelTargetDistanceKm);
  const refuelRelativeSpeedKmS = Number(metrics.refuelRelativeSpeedKmS);
  const refuelRelativeVelocityKmS = targetVectors.refuelTargetRelativeVelocityKmS;
  const toRefuelTarget = targetVectors.toRefuelTarget;

  if (phase === NAVIGATION_MISSION_PHASES.ORBITAL_REFUEL) {
    if (!Number.isFinite(refuelDistanceKm) || !toRefuelTarget) {
      return {
        phase: "coast",
        throttle: 0,
        direction: tangent,
        mode: "navsys:orbital-refuel-await-target",
      };
    }
    const dockDistanceKm = Number(REFUEL_TANKER_CONFIG.dockDistanceKm) || 0.014;
    const dockSpeedKmS = Number(REFUEL_TANKER_CONFIG.dockMaxRelativeSpeedKmS) || 0.000045;
    const directionToTarget = normalize(toRefuelTarget, tangent);
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
        direction: tangent,
        mode: "navsys:orbital-refuel-docked-hold",
      };
    }

    if (refuelDistanceKm > 15) {
      const throttle = clamp(0.12 + (refuelDistanceKm / 220), 0.12, 0.34);
      const direction = normalize(
        add(
          scale(directionToTarget, 0.92),
          scale(tangent, 0.08),
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

  if (phase === NAVIGATION_MISSION_PHASES.TLI_BURN) {
    return {
      phase: "powered",
      throttle: 0.65,
      direction: normalize(add(scale(tangent, 0.7), scale(moonDirection, 0.3)), tangent),
      mode: "navsys:tli-burn",
    };
  }

  if (phase === NAVIGATION_MISSION_PHASES.COAST_TO_MOON) {
    return {
      phase: "coast",
      throttle: 0,
      direction: moonDirection,
      mode: "navsys:coast-to-moon",
    };
  }

  if (phase === NAVIGATION_MISSION_PHASES.LUNAR_INSERTION) {
    const insertionThrottle = Number.isFinite(moonAltitudeKm) && moonAltitudeKm < plannerConfig.moonCaptureUpperAltitudeKm
      ? 0.42
      : 0.14;
    return {
      phase: "powered",
      throttle: clamp(insertionThrottle, plannerConfig.minThrottle, plannerConfig.maxThrottle),
      direction: normalize(add(scale(moonDirection, 0.8), scale(up, 0.2)), moonDirection),
      mode: "navsys:lunar-insertion",
    };
  }

  if (phase === NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_HOLD) {
    return {
      phase: "coast",
      throttle: 0,
      direction: tangent,
      mode: "navsys:lunar-orbit-hold",
    };
  }

  if (phase === NAVIGATION_MISSION_PHASES.TEI_BURN) {
    return {
      phase: "powered",
      throttle: 0.5,
      direction: normalize(add(scale(earthDirection, 1), scale(tangent, 0.2)), earthDirection),
      mode: "navsys:tei-burn",
    };
  }

  if (phase === NAVIGATION_MISSION_PHASES.COAST_TO_EARTH) {
    return {
      phase: "coast",
      throttle: 0,
      direction: earthDirection,
      mode: "navsys:coast-to-earth",
    };
  }

  if (phase === NAVIGATION_MISSION_PHASES.EARTH_CAPTURE) {
    return {
      phase: "powered",
      throttle: 0.38,
      direction: normalize(add(scale(earthDirection, 1), scale(up, 0.1)), earthDirection),
      mode: "navsys:earth-capture",
    };
  }

  return {
    phase: "coast",
    throttle: 0,
    direction: tangent,
    mode: "navsys:standby",
  };
}

function earthOrbitHoldBaselineCommand({
  targetVectors = {},
} = {}) {
  return {
    phase: "coast",
    throttle: 0,
    direction: normalize(targetVectors.tangent, { x: 0, y: 1, z: 0 }),
    mode: "navsys:earth-orbit-hold",
  };
}

export function createNavigationTrajectoryPlanner({
  mode = NAVIGATION_DEFAULTS.mode,
  plannerConfig = NAVIGATION_DEFAULTS.planner,
} = {}) {
  let currentMode = normalizeNavigationMode(mode);

  function setMode(nextMode) {
    currentMode = normalizeNavigationMode(nextMode);
    return currentMode;
  }

  function planCommand({
    missionId,
    missionPhase,
    targetVectors = {},
    metrics = {},
  } = {}) {
    const normalizedMissionId = String(missionId || NAVIGATION_MISSION_IDS.EARTH_ORBIT_HOLD);
    let baselineCommand = null;
    if (normalizedMissionId === NAVIGATION_MISSION_IDS.MOON_ORBIT_RETURN) {
      baselineCommand = moonMissionBaselineCommand({
        phase: missionPhase,
        targetVectors,
        metrics,
        plannerConfig,
      });
    } else {
      baselineCommand = earthOrbitHoldBaselineCommand({ targetVectors });
    }

    if (currentMode === NAVIGATION_SYSTEM_MODES.PREDICTIVE_OPTIMIZER) {
      return {
        ...baselineCommand,
        mode: `${baselineCommand.mode}+predictive-fallback`,
        diagnostics: {
          optimizerReady: false,
          plannerMode: currentMode,
          note: "Predictive optimizer scaffold exists but is not yet active.",
        },
      };
    }
    return {
      ...baselineCommand,
      diagnostics: {
        optimizerReady: false,
        plannerMode: currentMode,
      },
    };
  }

  return {
    setMode,
    mode() {
      return currentMode;
    },
    planCommand,
  };
}
