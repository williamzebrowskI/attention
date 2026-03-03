import {
  add,
  clamp,
  dot,
  finiteVector,
  length,
  normalize,
  scale,
  subtract,
} from "../navigationMath.js";
import { NAVIGATION_MISSION_PHASES } from "../navigationMissionProfiles.js";
import { NAVIGATION_DEFAULTS } from "../navigationSystemConfig.js";
import {
  projectedClosestApproachDistanceKm,
  projectedClosestApproachStateKm,
} from "./interceptMath.js";
import {
  createMoonGuidanceRuntime,
  updateMoonSensorEstimate,
} from "./moonGuidanceState.js";
import { planRefuelRendezvousCommand } from "./refuelRendezvousPlanner.js";

const DEFAULT_MOON_RADIUS_KM = 1737.4;

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback);
}

function inferMoonRadiusKm(metrics = {}) {
  const distanceKm = Number(metrics.moonDistanceKm);
  const altitudeKm = Number(metrics.moonAltitudeKm);
  if (Number.isFinite(distanceKm) && Number.isFinite(altitudeKm)) {
    const inferred = distanceKm - altitudeKm;
    if (inferred > 500 && inferred < 4000) {
      return inferred;
    }
  }
  return DEFAULT_MOON_RADIUS_KM;
}

function projectedBPlaneVectorKm({
  closestPositionKm = null,
  alongTrackDirection = null,
} = {}) {
  if (!finiteVector(closestPositionKm) || !finiteVector(alongTrackDirection)) {
    return null;
  }
  const alongMagnitudeKm = dot(closestPositionKm, alongTrackDirection);
  return subtract(
    closestPositionKm,
    scale(alongTrackDirection, alongMagnitudeKm),
  );
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
    const shipMinusMoonRelVel = finiteVector(targetVectors.shipMinusMoonRelativeVelocityKmS)
      ? targetVectors.shipMinusMoonRelativeVelocityKmS
      : (
        finiteVector(moonMinusShipRelVel)
          ? scale(moonMinusShipRelVel, -1)
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
    const closestApproach = projectedClosestApproachStateKm({
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
    const moonRadiusKm = inferMoonRadiusKm(metrics);
    const captureGateKm = Math.max(1_000, Number(plannerConfig.moonCaptureGateDistanceKm) || 55_000);
    const approachDistanceKm = Math.max(10_000, Number(plannerConfig.moonApproachDistanceKm) || 120_000);
    const minClosingKmS = Math.max(0.001, Number(plannerConfig.moonMidcourseMinClosingSpeedKmS) || 0.02);
    const closingWindowKmS = Math.max(0.001, Number(plannerConfig.moonMidcourseClosingWindowKmS) || 0.18);
    const missGateKm = Math.max(
      captureGateKm + 1_000,
      Number(plannerConfig.moonMidcourseMissDistanceKm) || 95_000,
    );
    const targetPeriluneAltitudeKm = Math.max(
      20,
      Number(plannerConfig.moonTargetPeriluneAltitudeKm) || 120,
    );
    const targetPeriluneToleranceKm = Math.max(
      10,
      Number(plannerConfig.moonTargetPeriluneToleranceKm) || 80,
    );
    const bPlaneToleranceKm = Math.max(
      1_000,
      Number(plannerConfig.moonBPlaneToleranceKm) || 6_000,
    );
    const minTimeToClosestSec = Math.max(
      120,
      Number(plannerConfig.moonRetargetMinTimeToClosestSec) || 1_200,
    );
    const projectedPeriluneAltitudeKm = Number.isFinite(Number(closestApproach?.distanceKm))
      ? Number(closestApproach.distanceKm) - moonRadiusKm
      : Number.POSITIVE_INFINITY;
    const corridorErrorKm = Number.isFinite(projectedPeriluneAltitudeKm)
      ? projectedPeriluneAltitudeKm - targetPeriluneAltitudeKm
      : Number.POSITIVE_INFINITY;
    const bPlaneVectorKm = projectedBPlaneVectorKm({
      closestPositionKm: closestApproach?.closestPositionKm || null,
      alongTrackDirection: closestApproach?.alongTrackDirection || null,
    });
    const bPlaneErrorKm = finiteVector(bPlaneVectorKm)
      ? length(bPlaneVectorKm)
      : estimatedMissDistanceKm;
    const timeToClosestSec = Number.isFinite(Number(closestApproach?.timeToClosestSec))
      ? Number(closestApproach.timeToClosestSec)
      : Number.POSITIVE_INFINITY;

    moonRuntime.approach.projectedPeriluneAltitudeKm = Number.isFinite(projectedPeriluneAltitudeKm)
      ? projectedPeriluneAltitudeKm
      : null;
    moonRuntime.approach.corridorErrorKm = Number.isFinite(corridorErrorKm) ? corridorErrorKm : null;
    moonRuntime.approach.bPlaneErrorKm = Number.isFinite(bPlaneErrorKm) ? bPlaneErrorKm : null;
    moonRuntime.approach.timeToClosestSec = Number.isFinite(timeToClosestSec) ? timeToClosestSec : null;

    const farFromMoon = estimatedDistanceKm > approachDistanceKm;
    const weakClosing = estimatedClosingSpeedKmS < minClosingKmS;
    const projectedMissRisk = estimatedMissDistanceKm > (Number(plannerConfig.moonMidcourseMissDistanceKm) || 95_000);
    const corridorRisk = Number.isFinite(corridorErrorKm) && Math.abs(corridorErrorKm) > targetPeriluneToleranceKm;
    const bPlaneRisk = Number.isFinite(bPlaneErrorKm) && bPlaneErrorKm > bPlaneToleranceKm;
    const earthDistanceKm = Number(metrics.earthDistanceKm);
    const earthRadialSpeedKmS = Number(metrics.earthRadialSpeedKmS);
    const earthFallbackRisk = Number.isFinite(earthDistanceKm)
      && Number.isFinite(earthRadialSpeedKmS)
      && earthRadialSpeedKmS < (Number(plannerConfig.earthFallbackRadialSpeedKmS) || -0.01)
      && earthDistanceKm < (approachDistanceKm * 3.5);
    const solutionAgeSec = Number.isFinite(nowSec) && Number.isFinite(Number(moonRuntime.retarget.lastSolveSec))
      ? Math.max(0, nowSec - Number(moonRuntime.retarget.lastSolveSec))
      : Number.POSITIVE_INFINITY;
    const retargetCadenceSec = Math.max(30, Number(plannerConfig.moonRetargetCadenceSec) || 180);
    const retargetForceCadenceSec = Math.max(retargetCadenceSec, Number(plannerConfig.moonRetargetForceCadenceSec) || 420);
    const staleRetarget = !(solutionAgeSec < retargetForceCadenceSec);
    const retargetNeeded = farFromMoon
      && (
        weakClosing
        || projectedMissRisk
        || corridorRisk
        || bPlaneRisk
        || earthFallbackRisk
        || staleRetarget
      );
    const shouldRetarget = retargetNeeded && (
      solutionAgeSec >= retargetCadenceSec
      || staleRetarget
      || !Number.isFinite(solutionAgeSec)
    );
    if (shouldRetarget && Number.isFinite(nowSec)) {
      moonRuntime.retarget.lastSolveSec = nowSec;
      moonRuntime.retarget.lastSolveReason = (
        projectedMissRisk ? "miss-risk"
          : (corridorRisk ? "corridor-error"
            : (bPlaneRisk ? "b-plane-error"
              : (weakClosing ? "closing-speed"
                : (earthFallbackRisk ? "earth-fallback" : "retarget-cadence"))))
      );
    }

    const correctionNeeded = farFromMoon
      && (timeToClosestSec >= minTimeToClosestSec)
      && (
        weakClosing
        || projectedMissRisk
        || corridorRisk
        || bPlaneRisk
        || earthFallbackRisk
      );

    const midcourse = moonRuntime.midcourse;
    if (!midcourse.active) {
      midcourse.cooldownSec = Math.max(0, finiteNumber(midcourse.cooldownSec, 0) - dtSec);
    }
    if (correctionNeeded && !midcourse.active && !(Number(midcourse.cooldownSec) > 0)) {
      midcourse.active = true;
      midcourse.burnSec = 0;
      midcourse.stableSec = 0;
      midcourse.lastStartSec = Number.isFinite(nowSec) ? nowSec : midcourse.lastStartSec;
    } else if (midcourse.active) {
      if (correctionNeeded) {
        midcourse.stableSec = 0;
      } else {
        midcourse.stableSec = Math.max(0, Number(midcourse.stableSec) || 0) + dtSec;
      }
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
        midcourse.cooldownSec = Math.max(0, Number(plannerConfig.moonMidcourseCooldownSec) || 12);
        midcourse.lastStopSec = Number.isFinite(nowSec) ? nowSec : midcourse.lastStopSec;
      }
    }
    if (midcourse.active) {
      const desiredClosingKmS = clamp(
        estimatedDistanceKm / Math.max(minTimeToClosestSec, timeToClosestSec || minTimeToClosestSec),
        minClosingKmS,
        1.6,
      );
      const closingDeficit = clamp(
        (desiredClosingKmS - estimatedClosingSpeedKmS) / closingWindowKmS,
        0,
        1,
      );
      const closingSurplus = clamp(
        (estimatedClosingSpeedKmS - desiredClosingKmS) / closingWindowKmS,
        0,
        1,
      );
      const missRisk = clamp(
        (estimatedMissDistanceKm - captureGateKm) / Math.max(1, missGateKm - captureGateKm),
        0,
        1,
      );
      const corridorRiskNorm = clamp(
        Math.abs(corridorErrorKm) / Math.max(1, targetPeriluneToleranceKm * 4),
        0,
        1,
      );
      const bPlaneRiskNorm = clamp(
        (bPlaneErrorKm - bPlaneToleranceKm) / Math.max(1, bPlaneToleranceKm * 3),
        0,
        1,
      );
      const moonRelativeSpeedKmS = Number.isFinite(Number(metrics.moonRelativeSpeedKmS))
        ? Number(metrics.moonRelativeSpeedKmS)
        : (finiteVector(shipMinusMoonRelVel) ? length(shipMinusMoonRelVel) : desiredClosingKmS);
      const moonCircularSpeedKmS = Number(metrics.moonCircularSpeedKmS);
      const speedBrakeRisk = Number.isFinite(moonCircularSpeedKmS)
        ? clamp((moonRelativeSpeedKmS - (moonCircularSpeedKmS * 2.2)) / Math.max(0.1, moonCircularSpeedKmS), 0, 1)
        : 0;
      const speedBrakeThresholdKmS = Math.max(
        0.05,
        Number(plannerConfig.moonMidcourseSpeedBrakeThresholdKmS) || 1.1,
      );
      const speedBrakeNeed = moonRelativeSpeedKmS > (desiredClosingKmS + speedBrakeThresholdKmS);
      const corridorDirection = corridorErrorKm >= 0
        ? estimatedDirection
        : scale(estimatedDirection, -1);
      const bPlaneCorrectionDirection = finiteVector(bPlaneVectorKm)
        ? normalize(scale(bPlaneVectorKm, -1), corridorDirection)
        : corridorDirection;
      const velocityDampingDirection = finiteVector(moonMinusShipRelVel)
        ? normalize(moonMinusShipRelVel, estimatedDirection)
        : estimatedDirection;
      const tangentialDirection = (closingDeficit - closingSurplus) >= 0
        ? tangent
        : scale(tangent, -1);
      const bPlaneVerticalSign = finiteVector(bPlaneVectorKm)
        ? Math.sign(dot(bPlaneVectorKm, up))
        : 0;
      const verticalDirection = bPlaneVerticalSign > 0
        ? scale(up, -1)
        : up;
      const lateralGain = Math.max(0.01, Number(plannerConfig.moonMidcourseLateralGain) || 0.35);
      const tangentialGain = Math.max(0.01, Number(plannerConfig.moonMidcourseTangentialGain) || 0.22);
      const verticalGain = Math.max(0.01, Number(plannerConfig.moonMidcourseVerticalGain) || 0.12);
      const pulsePeriodSec = Math.max(
        60,
        Number(plannerConfig.moonMidcoursePulsePeriodSec) || 240,
      );
      const pulseBurnSec = clamp(
        Number(plannerConfig.moonMidcoursePulseBurnSec) || 18,
        4,
        Math.max(8, pulsePeriodSec - 4),
      );
      const continuousRiskThreshold = clamp(
        Number(plannerConfig.moonMidcourseContinuousRiskThreshold) || 0.86,
        0.5,
        1,
      );
      const compositeRisk = Math.max(
        missRisk,
        corridorRiskNorm,
        bPlaneRiskNorm,
        closingDeficit,
        speedBrakeRisk,
        earthFallbackRisk ? 1 : 0,
      );
      const pulseCycleSec = Math.max(0, Number(midcourse.burnSec) || 0) % pulsePeriodSec;
      const pulseActive = compositeRisk >= continuousRiskThreshold || pulseCycleSec <= pulseBurnSec;
      if (!pulseActive) {
        const coastMode = shouldRetarget
          ? "navsys:moon-retarget-solve"
          : "navsys:moon-midcourse-coast-window";
        moonRuntime.approach.lastDecision = coastMode;
        return {
          phase: "coast",
          throttle: 0,
          direction: normalize(
            add(scale(estimatedDirection, 0.88), add(scale(tangentialDirection, 0.1), scale(up, 0.02))),
            estimatedDirection,
          ),
          mode: coastMode,
        };
      }
      const throttleBase = Number(plannerConfig.moonMidcourseThrottleBase) || 0.06;
      const throttleMax = Number(plannerConfig.moonMidcourseThrottleMax) || 0.3;
      let commandedThrottle = clamp(
        throttleBase
          + (closingDeficit * 0.08)
          + (missRisk * 0.07)
          + (corridorRiskNorm * 0.06)
          + (bPlaneRiskNorm * 0.06)
          + (speedBrakeRisk * 0.08)
          + (earthFallbackRisk ? 0.06 : 0),
        throttleBase,
        throttleMax,
      );
      const nominalDirection = normalize(
        add(
          scale(estimatedDirection, 0.52 + (missRisk * 0.18) + (closingDeficit * 0.1)),
          add(
            scale(corridorDirection, lateralGain * (0.22 + (corridorRiskNorm * 0.65))),
            add(
              scale(bPlaneCorrectionDirection, lateralGain * (0.2 + (bPlaneRiskNorm * 0.62))),
              add(
                scale(tangentialDirection, tangentialGain * (0.2 + Math.abs(closingDeficit - closingSurplus))),
                add(
                  scale(velocityDampingDirection, 0.12 + (speedBrakeRisk * 0.2)),
                  scale(verticalDirection, verticalGain * (0.16 + bPlaneRiskNorm)),
                ),
              ),
            ),
          ),
        ),
        estimatedDirection,
      );
      let commandedDirection = nominalDirection;
      let mode = shouldRetarget
        ? "navsys:moon-midcourse-correction+retarget"
        : "navsys:moon-midcourse-correction";
      if (speedBrakeNeed) {
        const speedBrakeThrottleMax = clamp(
          Number(plannerConfig.moonMidcourseSpeedBrakeThrottleMax) || 0.22,
          throttleBase,
          throttleMax,
        );
        commandedThrottle = clamp(commandedThrottle + (speedBrakeRisk * 0.05), throttleBase, speedBrakeThrottleMax);
        commandedDirection = normalize(
          add(
            scale(velocityDampingDirection, 0.72),
            add(scale(bPlaneCorrectionDirection, 0.18), scale(corridorDirection, 0.1)),
          ),
          velocityDampingDirection,
        );
        mode = shouldRetarget
          ? "navsys:moon-midcourse-correction+retarget+speed-brake"
          : "navsys:moon-midcourse-correction+speed-brake";
      }
      moonRuntime.approach.lastDecision = mode;
      return {
        phase: "powered",
        throttle: commandedThrottle,
        direction: commandedDirection,
        mode,
      };
    }
    if (shouldRetarget) {
      moonRuntime.approach.lastDecision = "navsys:moon-retarget-solve";
      return {
        phase: "coast",
        throttle: 0,
        direction: normalize(
          add(scale(estimatedDirection, 0.9), add(scale(tangent, 0.08), scale(up, 0.02))),
          estimatedDirection,
        ),
        mode: "navsys:moon-retarget-solve",
      };
    }
    moonRuntime.approach.lastDecision = "navsys:coast-to-moon";
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
