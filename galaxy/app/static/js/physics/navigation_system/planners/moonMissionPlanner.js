import {
  clamp,
  length,
  normalize,
  scale,
  add,
} from "../navigationMath.js";
import { NAVIGATION_MISSION_PHASES } from "../navigationMissionProfiles.js";
import { NAVIGATION_DEFAULTS } from "../navigationSystemConfig.js";
import { planMoonLambertGncCommand } from "../gnc/moonLambertGncStack.js";
import { planRefuelRendezvousCommand } from "./refuelRendezvousPlanner.js";

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback);
}

export function planMoonMissionCommand({
  phase,
  targetVectors = {},
  metrics = {},
  plannerConfig = NAVIGATION_DEFAULTS.planner,
  plannerRuntime = null,
  timestampSec = Number.NaN,
} = {}) {
  const tangent = normalize(targetVectors.tangent, { x: 0, y: 1, z: 0 });
  const up = normalize(targetVectors.up, { x: 0, y: 0, z: 1 });
  const moonDirection = normalize(targetVectors.toMoon, tangent);
  const earthDirection = normalize(targetVectors.toEarth, scale(up, -1));
  const phaseName = String(phase || "").trim();

  if (phaseName === NAVIGATION_MISSION_PHASES.ORBITAL_REFUEL) {
    return planRefuelRendezvousCommand({
      targetVectors,
      metrics,
      tangent,
    });
  }

  if (
    phaseName === NAVIGATION_MISSION_PHASES.TLI_BURN
    || phaseName === NAVIGATION_MISSION_PHASES.COAST_TO_MOON
  ) {
    const lambertCommand = planMoonLambertGncCommand({
      phase: phaseName === NAVIGATION_MISSION_PHASES.TLI_BURN ? "tli_burn" : "coast_to_moon",
      targetVectors: {
        ...targetVectors,
        tangent,
        up,
        toMoon: moonDirection,
        toEarth: earthDirection,
      },
      metrics,
      plannerConfig,
      plannerRuntime,
      timestampSec,
    });
    if (lambertCommand) {
      return lambertCommand;
    }
  }

  if (phaseName === NAVIGATION_MISSION_PHASES.LUNAR_INSERTION) {
    const shipMinusMoonRelVel = targetVectors.shipMinusMoonRelativeVelocityKmS || null;
    const moonRetrograde = shipMinusMoonRelVel
      ? normalize(scale(shipMinusMoonRelVel, -1), moonDirection)
      : moonDirection;
    const moonUp = normalize(scale(moonDirection, -1), up);
    const moonRelativeSpeedKmS = finiteNumber(
      metrics.moonRelativeSpeedKmS,
      shipMinusMoonRelVel ? length(shipMinusMoonRelVel) : 0,
    );
    const moonCircularSpeedKmS = Number(metrics.moonCircularSpeedKmS);
    const moonSpeedTargetKmS = clamp(
      Number.isFinite(moonCircularSpeedKmS) ? (moonCircularSpeedKmS * 1.08) : 1.4,
      0.55,
      2.2,
    );
    const moonSpeedErrorKmS = moonRelativeSpeedKmS - moonSpeedTargetKmS;
    const moonAltitudeKm = Number(metrics.moonAltitudeKm);
    const altitudeFactor = Number.isFinite(moonAltitudeKm)
      ? clamp((6000 - moonAltitudeKm) / 6000, 0, 1)
      : 0;
    const insertionThrottle = Number.isFinite(moonAltitudeKm)
      && moonAltitudeKm < finiteNumber(plannerConfig.moonCaptureUpperAltitudeKm, 16_000)
      ? (0.14 + (moonSpeedErrorKmS * 0.38) + (altitudeFactor * 0.26))
      : 0.14;
    return {
      phase: "powered",
      throttle: clamp(
        insertionThrottle,
        Math.max(0.05, finiteNumber(plannerConfig.minThrottle, 0)),
        Math.min(1, finiteNumber(plannerConfig.maxThrottle, 1)),
      ),
      direction: normalize(add(scale(moonRetrograde, 1), scale(moonUp, 0.22)), moonRetrograde),
      mode: "navsys:gnc-lunar-capture-retrograde",
    };
  }

  if (phaseName === NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_HOLD) {
    return {
      phase: "coast",
      throttle: 0,
      direction: tangent,
      mode: "navsys:gnc-lunar-orbit-hold",
    };
  }

  if (phaseName === NAVIGATION_MISSION_PHASES.TEI_BURN) {
    return {
      phase: "powered",
      throttle: 0.48,
      direction: normalize(add(scale(earthDirection, 1), scale(tangent, 0.2)), earthDirection),
      mode: "navsys:gnc-tei-burn",
    };
  }

  if (phaseName === NAVIGATION_MISSION_PHASES.COAST_TO_EARTH) {
    return {
      phase: "coast",
      throttle: 0,
      direction: earthDirection,
      mode: "navsys:gnc-coast-to-earth",
    };
  }

  if (phaseName === NAVIGATION_MISSION_PHASES.EARTH_CAPTURE) {
    return {
      phase: "powered",
      throttle: 0.36,
      direction: normalize(add(scale(earthDirection, 1), scale(up, 0.1)), earthDirection),
      mode: "navsys:gnc-earth-capture",
    };
  }

  return {
    phase: "coast",
    throttle: 0,
    direction: tangent,
    mode: "navsys:gnc-standby",
  };
}
