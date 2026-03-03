import {
  add,
  clamp,
  dot,
  finiteVector,
  length,
  normalize,
  scale,
} from "../navigationMath.js";
import { NAVIGATION_MISSION_PHASES } from "../navigationMissionProfiles.js";
import { NAVIGATION_DEFAULTS } from "../navigationSystemConfig.js";
import { projectedClosestApproachDistanceKm } from "./interceptMath.js";
import {
  createMoonGuidanceRuntime,
  updateMoonSensorEstimate,
} from "./moonGuidanceState.js";
import { planRefuelRendezvousCommand } from "./refuelRendezvousPlanner.js";

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
  const moonAltitudeKm = Number(metrics.moonAltitudeKm);

  if (phase === NAVIGATION_MISSION_PHASES.ORBITAL_REFUEL) {
    return planRefuelRendezvousCommand({
      targetVectors,
      metrics,
      tangent,
    });
  }

  if (phase === NAVIGATION_MISSION_PHASES.TLI_BURN) {
    const periapsisKm = Number(metrics.periapsisKm);
    const periapsisProtectMinKm = Math.max(80, Number(plannerConfig.tliPeriapsisProtectMinKm) || 130);
    const periapsisRecoverTargetKm = Math.max(
      periapsisProtectMinKm + 5,
      Number(plannerConfig.tliPeriapsisRecoverTargetKm) || 155,
    );
    if (Number.isFinite(periapsisKm) && periapsisKm < periapsisRecoverTargetKm) {
      const deficitNorm = clamp(
        (periapsisRecoverTargetKm - periapsisKm)
          / Math.max(1, periapsisRecoverTargetKm - periapsisProtectMinKm),
        0,
        1,
      );
      const upBias = clamp(
        (Number(plannerConfig.tliPeriapsisProtectUpBias) || 0.24) * (0.65 + (0.35 * deficitNorm)),
        0.1,
        0.45,
      );
      return {
        phase: "powered",
        throttle: clamp(
          (Number(plannerConfig.tliPeriapsisProtectThrottleMin) || 0.16) + (deficitNorm * 0.26),
          Number(plannerConfig.tliPeriapsisProtectThrottleMin) || 0.16,
          Number(plannerConfig.tliPeriapsisProtectThrottleMax) || 0.6,
        ),
        direction: normalize(add(scale(tangent, 1), scale(up, upBias)), tangent),
        mode: "navsys:tli-periapsis-protect",
      };
    }
    const moonClosingSpeedKmS = Number(metrics.moonClosingSpeedKmS);
    const minClosingKmS = Math.max(0.001, Number(plannerConfig.moonMidcourseMinClosingSpeedKmS) || 0.02);
    const closingDeficit = Number.isFinite(moonClosingSpeedKmS)
      ? clamp((minClosingKmS - moonClosingSpeedKmS) / Math.max(0.01, minClosingKmS), 0, 1)
      : 0.5;
    return {
      phase: "powered",
      throttle: clamp(0.56 + (closingDeficit * 0.24), 0.52, 0.86),
      direction: normalize(add(scale(tangent, 0.7), scale(moonDirection, 0.3)), tangent),
      mode: "navsys:tli-burn",
    };
  }

  if (phase === NAVIGATION_MISSION_PHASES.COAST_TO_MOON) {
    const moonRuntime = plannerRuntime?.moon || createMoonGuidanceRuntime();
    const nowSec = Number(timestampSec);
    const prevTs = Number(moonRuntime.lastTimestampSec);
    const dtSec = Number.isFinite(nowSec) && Number.isFinite(prevTs)
      ? Math.max(0, nowSec - prevTs)
      : 0;
    const moonMinusShipRelVel = finiteVector(targetVectors.moonMinusShipRelativeVelocityKmS)
      ? targetVectors.moonMinusShipRelativeVelocityKmS
      : (
        finiteVector(targetVectors.shipMinusMoonRelativeVelocityKmS)
          ? scale(targetVectors.shipMinusMoonRelativeVelocityKmS, -1)
          : null
      );
    const rawMoonDistanceKm = Number.isFinite(Number(metrics.moonDistanceKm))
      ? Number(metrics.moonDistanceKm)
      : (finiteVector(targetVectors.toMoon) ? length(targetVectors.toMoon) : Number.POSITIVE_INFINITY);
    const rawMoonClosingSpeedKmS = Number.isFinite(Number(metrics.moonClosingSpeedKmS))
      ? Number(metrics.moonClosingSpeedKmS)
      : (
        finiteVector(moonMinusShipRelVel) && rawMoonDistanceKm > 1e-9
          ? dot(moonMinusShipRelVel, moonDirection)
          : 0
      );
    const rawProjectedMissDistanceKm = Number.isFinite(Number(metrics.moonProjectedMissDistanceKm))
      ? Number(metrics.moonProjectedMissDistanceKm)
      : projectedClosestApproachDistanceKm({
        relativePositionKm: targetVectors.toMoon,
        relativeVelocityKmS: moonMinusShipRelVel,
        horizonSec: Number(plannerConfig.moonMidcoursePredictHorizonSec),
      });
    const filteredEstimate = updateMoonSensorEstimate({
      moonRuntime,
      rawMeasurement: {
        distanceKm: rawMoonDistanceKm,
        closingSpeedKmS: rawMoonClosingSpeedKmS,
        projectedMissDistanceKm: rawProjectedMissDistanceKm,
        direction: moonDirection,
      },
      timestampSec,
      plannerConfig,
    });
    const estimatedDistanceKm = Number.isFinite(Number(filteredEstimate?.distanceKm))
      ? Number(filteredEstimate.distanceKm)
      : rawMoonDistanceKm;
    const estimatedClosingSpeedKmS = Number.isFinite(Number(filteredEstimate?.closingSpeedKmS))
      ? Number(filteredEstimate.closingSpeedKmS)
      : rawMoonClosingSpeedKmS;
    const estimatedMissDistanceKm = Number.isFinite(Number(filteredEstimate?.projectedMissDistanceKm))
      ? Number(filteredEstimate.projectedMissDistanceKm)
      : rawProjectedMissDistanceKm;
    const estimatedDirection = finiteVector(filteredEstimate?.direction)
      ? normalize(filteredEstimate.direction, moonDirection)
      : moonDirection;

    const approachDistanceKm = Math.max(10_000, Number(plannerConfig.moonApproachDistanceKm) || 120_000);
    const farFromMoon = estimatedDistanceKm > approachDistanceKm;
    const weakClosing = estimatedClosingSpeedKmS < (Number(plannerConfig.moonMidcourseMinClosingSpeedKmS) || 0.02);
    const projectedMissRisk = estimatedMissDistanceKm > (Number(plannerConfig.moonMidcourseMissDistanceKm) || 95_000);
    const earthDistanceKm = Number(metrics.earthDistanceKm);
    const earthRadialSpeedKmS = Number(metrics.earthRadialSpeedKmS);
    const earthFallbackRisk = Number.isFinite(earthDistanceKm)
      && Number.isFinite(earthRadialSpeedKmS)
      && earthRadialSpeedKmS < (Number(plannerConfig.earthFallbackRadialSpeedKmS) || -0.01)
      && earthDistanceKm < (approachDistanceKm * 3.5);
    const correctionNeeded = farFromMoon && (weakClosing || projectedMissRisk || earthFallbackRisk);

    const midcourse = moonRuntime.midcourse;
    if (correctionNeeded) {
      midcourse.active = true;
      midcourse.stableSec = 0;
    } else if (midcourse.active) {
      midcourse.stableSec = Math.max(0, Number(midcourse.stableSec) || 0) + dtSec;
    }
    if (midcourse.active) {
      midcourse.burnSec = Math.max(0, Number(midcourse.burnSec) || 0) + dtSec;
      const canExitCorrection = !correctionNeeded
        && midcourse.burnSec >= Math.max(0, Number(plannerConfig.moonMidcourseMinBurnSec) || 24)
        && midcourse.stableSec >= Math.max(0, Number(plannerConfig.moonMidcourseExitStableSec) || 28);
      if (canExitCorrection) {
        midcourse.active = false;
        midcourse.burnSec = 0;
        midcourse.stableSec = 0;
      }
    }
    if (midcourse.active) {
      const closingDeficit = clamp(
        ((Number(plannerConfig.moonMidcourseMinClosingSpeedKmS) || 0.02) - estimatedClosingSpeedKmS)
          / Math.max(0.001, Number(plannerConfig.moonMidcourseClosingWindowKmS) || 0.18),
        0,
        1,
      );
      const captureGateKm = Math.max(1_000, Number(plannerConfig.moonCaptureGateDistanceKm) || 55_000);
      const missGateKm = Math.max(captureGateKm + 1_000, Number(plannerConfig.moonMidcourseMissDistanceKm) || 95_000);
      const missRisk = clamp(
        (estimatedMissDistanceKm - captureGateKm) / Math.max(1, missGateKm - captureGateKm),
        0,
        1,
      );
      return {
        phase: "powered",
        throttle: clamp(
          (Number(plannerConfig.moonMidcourseThrottleBase) || 0.22)
            + (closingDeficit * 0.34)
            + (missRisk * 0.24)
            + (earthFallbackRisk ? 0.16 : 0),
          Number(plannerConfig.moonMidcourseThrottleBase) || 0.22,
          Number(plannerConfig.moonMidcourseThrottleMax) || 0.78,
        ),
        direction: normalize(
          add(
            scale(estimatedDirection, 0.84),
            add(scale(tangent, 0.12), scale(up, 0.04)),
          ),
          estimatedDirection,
        ),
        mode: "navsys:moon-midcourse-correction",
      };
    }
    return {
      phase: "coast",
      throttle: 0,
      direction: estimatedDirection,
      mode: "navsys:coast-to-moon",
    };
  }

  if (phase === NAVIGATION_MISSION_PHASES.LUNAR_INSERTION) {
    const shipMinusMoonRelVel = finiteVector(targetVectors.shipMinusMoonRelativeVelocityKmS)
      ? targetVectors.shipMinusMoonRelativeVelocityKmS
      : null;
    const moonRetrograde = shipMinusMoonRelVel
      ? normalize(scale(shipMinusMoonRelVel, -1), moonDirection)
      : moonDirection;
    const moonUp = normalize(scale(moonDirection, -1), up);
    const moonRelativeSpeedKmS = Number.isFinite(Number(metrics.moonRelativeSpeedKmS))
      ? Number(metrics.moonRelativeSpeedKmS)
      : (shipMinusMoonRelVel ? length(shipMinusMoonRelVel) : 0);
    const moonCircularSpeedKmS = Number(metrics.moonCircularSpeedKmS);
    const moonSpeedTargetKmS = clamp(
      Number.isFinite(moonCircularSpeedKmS) ? (moonCircularSpeedKmS * 1.08) : 1.4,
      0.55,
      2.2,
    );
    const moonSpeedErrorKmS = moonRelativeSpeedKmS - moonSpeedTargetKmS;
    const altitudeFactor = Number.isFinite(moonAltitudeKm)
      ? clamp((6000 - moonAltitudeKm) / 6000, 0, 1)
      : 0;
    const insertionThrottle = Number.isFinite(moonAltitudeKm) && moonAltitudeKm < plannerConfig.moonCaptureUpperAltitudeKm
      ? (0.14 + (moonSpeedErrorKmS * 0.38) + (altitudeFactor * 0.26))
      : 0.14;
    return {
      phase: "powered",
      throttle: clamp(
        insertionThrottle,
        Math.max(0.05, Number(plannerConfig.minThrottle) || 0),
        Math.min(1, Number(plannerConfig.maxThrottle) || 1),
      ),
      direction: normalize(add(scale(moonRetrograde, 1), scale(moonUp, 0.22)), moonRetrograde),
      mode: "navsys:lunar-capture-retrograde",
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
