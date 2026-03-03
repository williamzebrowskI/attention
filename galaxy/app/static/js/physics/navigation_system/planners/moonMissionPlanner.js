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
const DEFAULT_MOON_MU_KM3_S2 = 4_902.800066;

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

function inferMoonMuKm3S2(metrics = {}, moonDistanceKm = Number.NaN) {
  const circularSpeedKmS = Number(metrics.moonCircularSpeedKmS);
  const distanceKm = Number.isFinite(Number(moonDistanceKm))
    ? Number(moonDistanceKm)
    : Number(metrics.moonDistanceKm);
  if (Number.isFinite(circularSpeedKmS) && Number.isFinite(distanceKm) && distanceKm > 1) {
    const muKm3S2 = circularSpeedKmS * circularSpeedKmS * distanceKm;
    if (muKm3S2 > 1_000 && muKm3S2 < 20_000) {
      return muKm3S2;
    }
  }
  return DEFAULT_MOON_MU_KM3_S2;
}

function evaluatePredictiveMidcourseCandidate({
  direction = null,
  throttle = 0,
  shipMinusMoonPosKm = null,
  shipMinusMoonVelKmS = null,
  moonMuKm3S2 = DEFAULT_MOON_MU_KM3_S2,
  moonRadiusKm = DEFAULT_MOON_RADIUS_KM,
  targetPeriluneAltitudeKm = 120,
  captureGateKm = 55_000,
  desiredClosingKmS = 0.02,
  moonCircularSpeedKmS = Number.NaN,
  accelAtThrottle1KmS2 = 0.0065,
  burnDurationSec = 20,
  horizonSec = 1_800,
  steps = 32,
} = {}) {
  if (
    !finiteVector(direction)
    || !finiteVector(shipMinusMoonPosKm)
    || !finiteVector(shipMinusMoonVelKmS)
  ) {
    return null;
  }
  const throttleClamped = clamp(Number(throttle) || 0, 0, 1);
  const safeSteps = Math.max(8, Math.min(160, Math.round(Number(steps) || 32)));
  const safeHorizonSec = Math.max(120, Number(horizonSec) || 1_800);
  const dtSec = safeHorizonSec / safeSteps;
  const safeBurnSec = clamp(Number(burnDurationSec) || 0, 0, safeHorizonSec);
  const commandAccelKmS2 = scale(
    normalize(direction, { x: 0, y: 1, z: 0 }),
    Math.max(0, Number(accelAtThrottle1KmS2) || 0) * throttleClamped,
  );

  let relPos = {
    x: Number(shipMinusMoonPosKm.x) || 0,
    y: Number(shipMinusMoonPosKm.y) || 0,
    z: Number(shipMinusMoonPosKm.z) || 0,
  };
  let relVel = {
    x: Number(shipMinusMoonVelKmS.x) || 0,
    y: Number(shipMinusMoonVelKmS.y) || 0,
    z: Number(shipMinusMoonVelKmS.z) || 0,
  };

  let minRangeKm = length(relPos);
  let relSpeedAtMinRangeKmS = length(relVel);
  for (let stepIndex = 0; stepIndex < safeSteps; stepIndex += 1) {
    const tSec = stepIndex * dtSec;
    const radiusKm = Math.max(1, length(relPos));
    const moonGravityAccelKmS2 = scale(
      relPos,
      -(Number(moonMuKm3S2) || DEFAULT_MOON_MU_KM3_S2) / Math.max(radiusKm * radiusKm * radiusKm, 1),
    );
    const burnActive = tSec < safeBurnSec;
    const totalAccelKmS2 = burnActive
      ? add(moonGravityAccelKmS2, commandAccelKmS2)
      : moonGravityAccelKmS2;
    relVel = add(relVel, scale(totalAccelKmS2, dtSec));
    relPos = add(relPos, scale(relVel, dtSec));

    const rangeKm = length(relPos);
    if (rangeKm < minRangeKm) {
      minRangeKm = rangeKm;
      relSpeedAtMinRangeKmS = length(relVel);
    }
  }

  const finalRangeKm = length(relPos);
  const radialDirection = finalRangeKm > 1e-9
    ? scale(relPos, 1 / finalRangeKm)
    : { x: 1, y: 0, z: 0 };
  const closingKmS = -dot(relVel, radialDirection);
  const predictedPeriluneAltitudeKm = minRangeKm - moonRadiusKm;
  const predictedMissErrorKm = Math.max(0, minRangeKm - captureGateKm);
  const periluneErrorKm = Math.abs(predictedPeriluneAltitudeKm - targetPeriluneAltitudeKm);
  const closingErrorKmS = Math.abs(closingKmS - desiredClosingKmS);
  const circularRefKmS = Number.isFinite(Number(moonCircularSpeedKmS)) && Number(moonCircularSpeedKmS) > 0
    ? Number(moonCircularSpeedKmS)
    : 1.6;
  const overspeedPenaltyKmS = Math.max(0, relSpeedAtMinRangeKmS - (circularRefKmS * 2.4));
  const score = (
    (predictedMissErrorKm * 1.05)
    + (periluneErrorKm * 0.42)
    + (closingErrorKmS * 2_600)
    + (overspeedPenaltyKmS * 5_200)
    + (throttleClamped * 620)
  );
  return {
    score,
    predictedMissErrorKm,
    predictedPeriluneAltitudeKm,
    closingKmS,
    relSpeedAtMinRangeKmS,
    direction: normalize(direction, { x: 0, y: 1, z: 0 }),
  };
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
      const predictiveHorizonSec = Math.max(
        300,
        Number(plannerConfig.moonMidcoursePredictiveHorizonSec) || 1_800,
      );
      const predictiveBurnSec = clamp(
        Number(plannerConfig.moonMidcoursePredictiveBurnSec) || pulseBurnSec,
        4,
        Math.max(10, pulseBurnSec),
      );
      const predictiveSteps = Math.max(
        12,
        Math.min(128, Math.round(Number(plannerConfig.moonMidcoursePredictiveSteps) || 36)),
      );
      const accelAtThrottle1KmS2 = Math.max(
        0.0001,
        Number(plannerConfig.moonMidcourseAccelAtThrottle1KmS2) || 0.0065,
      );
      const moonMuKm3S2 = inferMoonMuKm3S2(metrics, estimatedDistanceKm);
      const shipMinusMoonPosKm = finiteVector(targetVectors.toMoon)
        ? scale(targetVectors.toMoon, -1)
        : null;
      const predictiveCandidateDirections = [
        commandedDirection,
        nominalDirection,
        normalize(add(scale(commandedDirection, 0.7), scale(velocityDampingDirection, 0.3)), commandedDirection),
        normalize(add(scale(commandedDirection, 0.7), scale(bPlaneCorrectionDirection, 0.3)), commandedDirection),
        normalize(add(scale(commandedDirection, 0.65), scale(corridorDirection, 0.35)), commandedDirection),
        velocityDampingDirection,
      ].filter((candidate) => finiteVector(candidate));
      if (
        finiteVector(shipMinusMoonPosKm)
        && finiteVector(shipMinusMoonRelVel)
        && predictiveCandidateDirections.length > 0
      ) {
        const baselineCandidate = evaluatePredictiveMidcourseCandidate({
          direction: commandedDirection,
          throttle: commandedThrottle,
          shipMinusMoonPosKm,
          shipMinusMoonVelKmS: shipMinusMoonRelVel,
          moonMuKm3S2,
          moonRadiusKm,
          targetPeriluneAltitudeKm,
          captureGateKm,
          desiredClosingKmS,
          moonCircularSpeedKmS,
          accelAtThrottle1KmS2,
          burnDurationSec: predictiveBurnSec,
          horizonSec: predictiveHorizonSec,
          steps: predictiveSteps,
        });
        let bestCandidate = baselineCandidate;
        for (let i = 0; i < predictiveCandidateDirections.length; i += 1) {
          const evaluated = evaluatePredictiveMidcourseCandidate({
            direction: predictiveCandidateDirections[i],
            throttle: commandedThrottle,
            shipMinusMoonPosKm,
            shipMinusMoonVelKmS: shipMinusMoonRelVel,
            moonMuKm3S2,
            moonRadiusKm,
            targetPeriluneAltitudeKm,
            captureGateKm,
            desiredClosingKmS,
            moonCircularSpeedKmS,
            accelAtThrottle1KmS2,
            burnDurationSec: predictiveBurnSec,
            horizonSec: predictiveHorizonSec,
            steps: predictiveSteps,
          });
          if (!evaluated) {
            continue;
          }
          if (!bestCandidate || evaluated.score < bestCandidate.score) {
            bestCandidate = evaluated;
          }
        }
        const baselineScore = Number(baselineCandidate?.score);
        const bestScore = Number(bestCandidate?.score);
        if (
          Number.isFinite(bestScore)
          && Number.isFinite(baselineScore)
          && bestCandidate?.direction
          && bestScore < (baselineScore * 0.985)
        ) {
          commandedDirection = normalize(bestCandidate.direction, commandedDirection);
          mode = `${mode}+predictive`;
        }
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
