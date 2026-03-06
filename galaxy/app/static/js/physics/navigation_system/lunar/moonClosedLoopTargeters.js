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
import {
  buildMoonGuidanceSourceModel,
  burnDurationForDeltaVSec,
  estimateBPlaneErrorKm,
  propagateMoonGuidanceState,
} from "./moonDynamicsModel.js";
import {
  createMoonNavigationFilterState,
  updateMoonNavigationFilter,
} from "./moonStateFilter.js";

const EARTH_MU_KM3_S2 = 398600.4418;
const DEFAULT_MOON_RADIUS_KM = 1737.4;
const DEFAULT_EARTH_RADIUS_KM = 6371;

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback);
}

function cross(a, b) {
  return {
    x: ((Number(a?.y) || 0) * (Number(b?.z) || 0)) - ((Number(a?.z) || 0) * (Number(b?.y) || 0)),
    y: ((Number(a?.z) || 0) * (Number(b?.x) || 0)) - ((Number(a?.x) || 0) * (Number(b?.z) || 0)),
    z: ((Number(a?.x) || 0) * (Number(b?.y) || 0)) - ((Number(a?.y) || 0) * (Number(b?.x) || 0)),
  };
}

function ensureMoonGncRuntime(moonRuntime) {
  if (!moonRuntime || typeof moonRuntime !== "object") {
    return null;
  }
  if (!moonRuntime.gnc || typeof moonRuntime.gnc !== "object") {
    moonRuntime.gnc = {
      lastSolveSec: null,
      lastSolveReason: "",
      lastCommandMode: "",
      solution: null,
      predictedMissDistanceKm: null,
      predictedPeriluneAltitudeKm: null,
      bPlaneErrorKm: null,
      deltaVNeedKmS: null,
    };
  }
  return moonRuntime.gnc;
}

function basisFromPrimary(primary, up) {
  const primaryDir = normalize(primary, { x: 0, y: 1, z: 0 });
  const radialDir = normalize(up, { x: 0, y: 0, z: 1 });
  let normalDir = normalize(cross(primaryDir, radialDir), { x: 1, y: 0, z: 0 });
  if (length(normalDir) <= 1e-9) {
    normalDir = { x: 1, y: 0, z: 0 };
  }
  return { primaryDir, radialDir, normalDir };
}

function combineBasis({ primaryDir, radialDir, normalDir, primaryWeight, radialWeight, normalWeight }) {
  return normalize(
    add(
      scale(primaryDir, primaryWeight),
      add(scale(radialDir, radialWeight), scale(normalDir, normalWeight)),
    ),
    primaryDir,
  );
}

function nominalTliDeltaVEstimateKmS(shipEarthRadiusKm, moonEarthDistanceKm, earthMuKm3S2 = EARTH_MU_KM3_S2) {
  const r1 = Math.max(6500, finiteNumber(shipEarthRadiusKm, 0));
  const r2 = Math.max(r1 + 1, finiteNumber(moonEarthDistanceKm, 0));
  if (!(r2 > r1) || !(earthMuKm3S2 > 0)) {
    return 3.15;
  }
  const semiMajorKm = (r1 + r2) * 0.5;
  const circularSpeed = Math.sqrt(earthMuKm3S2 / r1);
  const transferSpeed = Math.sqrt(earthMuKm3S2 * ((2 / r1) - (1 / semiMajorKm)));
  return Math.max(0.25, transferSpeed - circularSpeed);
}

function nominalTransferTimeSec(shipEarthRadiusKm, moonEarthDistanceKm, earthMuKm3S2 = EARTH_MU_KM3_S2) {
  const r1 = Math.max(6500, finiteNumber(shipEarthRadiusKm, 0));
  const r2 = Math.max(r1 + 1, finiteNumber(moonEarthDistanceKm, 0));
  if (!(r2 > r1) || !(earthMuKm3S2 > 0)) {
    return 72 * 3600;
  }
  const semiMajorKm = (r1 + r2) * 0.5;
  return Math.PI * Math.sqrt((semiMajorKm ** 3) / earthMuKm3S2);
}

function closestTargetStateForBody(propagation, targetBodyId) {
  if (targetBodyId === "earth") {
    return propagation?.closestEarthState || null;
  }
  return propagation?.closestMoonState || null;
}

function minDistanceForBody(propagation, targetBodyId) {
  if (targetBodyId === "earth") {
    return propagation?.minEarthDistanceKm;
  }
  return propagation?.minMoonDistanceKm;
}

function minAltitudeForBody(propagation, targetBodyId) {
  if (targetBodyId === "earth") {
    return propagation?.minEarthAltitudeKm;
  }
  return propagation?.minMoonAltitudeKm;
}

function evaluateTransferCandidate({
  initialState,
  sources,
  spacecraft,
  burnDirection,
  deltaVNeedKmS,
  throttle,
  accelAtThrottle1KmS2,
  predictDurationSec,
  stepSec,
  targetPositionKm,
  targetVelocityKmS,
  targetBodyId,
  targetBodyRadiusKm,
  targetPeriluneAltitudeKm,
  safetyBodyId,
  safetyMinAltitudeKm,
}) {
  const burnDurationSec = burnDurationForDeltaVSec(deltaVNeedKmS, accelAtThrottle1KmS2, throttle);
  const propagation = propagateMoonGuidanceState({
    initialState,
    durationSec: predictDurationSec,
    stepSec,
    sources,
    spacecraft,
    burnCommand: {
      direction: burnDirection,
      throttle,
      accelAtThrottle1KmS2,
      burnDurationSec,
    },
  });
  if (!propagation) {
    return null;
  }
  const targetState = closestTargetStateForBody(propagation, targetBodyId);
  const predictedMissDistanceKm = Number.isFinite(minDistanceForBody(propagation, targetBodyId))
    ? minDistanceForBody(propagation, targetBodyId)
    : Number.POSITIVE_INFINITY;
  const predictedPeriluneAltitudeKm = Number.isFinite(minAltitudeForBody(propagation, targetBodyId))
    ? minAltitudeForBody(propagation, targetBodyId)
    : Number.POSITIVE_INFINITY;
  const closestTargetRelPos = targetState && finiteVector(targetPositionKm)
    ? subtract(targetState.positionKm, targetPositionKm)
    : null;
  const closestTargetRelVel = targetState && finiteVector(targetVelocityKmS)
    ? subtract(targetState.velocityKmS, targetVelocityKmS)
    : null;
  const bPlaneErrorKm = estimateBPlaneErrorKm({
    relativePositionKm: closestTargetRelPos,
    relativeVelocityKmS: closestTargetRelVel,
    targetPeriluneAltitudeKm,
    bodyRadiusKm: targetBodyRadiusKm,
  });
  const closestTargetRangeKm = finiteVector(closestTargetRelPos) ? length(closestTargetRelPos) : Number.NaN;
  const closestClosingSpeedKmS = (
    finiteVector(closestTargetRelPos)
    && finiteVector(closestTargetRelVel)
    && closestTargetRangeKm > 1e-9
  )
    ? -dot(closestTargetRelVel, scale(closestTargetRelPos, 1 / closestTargetRangeKm))
    : Number.NaN;
  const safetyAltitudeKm = Number.isFinite(minAltitudeForBody(propagation, safetyBodyId))
    ? minAltitudeForBody(propagation, safetyBodyId)
    : Number.NaN;
  const safetyRiskKm = Number.isFinite(safetyAltitudeKm)
    ? Math.max(0, safetyMinAltitudeKm - safetyAltitudeKm)
    : safetyMinAltitudeKm;
  const closingPenalty = Number.isFinite(closestClosingSpeedKmS)
    ? Math.max(0, -closestClosingSpeedKmS) * 10_000
    : 5_000;
  const cost = (
    predictedMissDistanceKm
    + (Math.abs(predictedPeriluneAltitudeKm - targetPeriluneAltitudeKm) * 0.8)
    + ((Number.isFinite(bPlaneErrorKm) ? bPlaneErrorKm : predictedMissDistanceKm) * 0.55)
    + (safetyRiskKm * 8_000)
    + closingPenalty
    + (deltaVNeedKmS * 600)
  );
  return {
    cost,
    throttle,
    deltaVNeedKmS,
    burnDurationSec,
    burnDirection,
    propagation,
    predictedMissDistanceKm,
    predictedPeriluneAltitudeKm,
    bPlaneErrorKm,
    closestClosingSpeedKmS,
  };
}

function enumerateTransferCandidates({
  initialState,
  sources,
  spacecraft,
  primaryDirection,
  up,
  nominalDeltaVKmS,
  accelAtThrottle1KmS2,
  predictDurationSec,
  plannerConfig,
  targetPositionKm,
  targetVelocityKmS,
  targetBodyId,
  targetBodyRadiusKm,
  targetPeriluneAltitudeKm,
  safetyBodyId,
  safetyMinAltitudeKm,
  phase,
}) {
  const { primaryDir, radialDir, normalDir } = basisFromPrimary(primaryDirection, up);
  const dvOffsets = phase === "tli_burn"
    ? [-0.45, -0.15, 0, 0.18, 0.42]
    : [-0.06, -0.02, 0, 0.02, 0.06];
  const radialOffsets = phase === "tli_burn" ? [-0.12, 0, 0.12] : [-0.05, 0, 0.05];
  const normalOffsets = phase === "tli_burn" ? [-0.05, 0, 0.05] : [-0.03, 0, 0.03];
  const stepSec = Math.max(30, finiteNumber(plannerConfig.moonClosedLoopPropagationStepSec, 600));
  let best = null;
  for (let dvIndex = 0; dvIndex < dvOffsets.length; dvIndex += 1) {
    const dvNeedKmS = Math.max(0.002, nominalDeltaVKmS + dvOffsets[dvIndex]);
    for (let radialIndex = 0; radialIndex < radialOffsets.length; radialIndex += 1) {
      for (let normalIndex = 0; normalIndex < normalOffsets.length; normalIndex += 1) {
        const burnDirection = combineBasis({
          primaryDir,
          radialDir,
          normalDir,
          primaryWeight: 1,
          radialWeight: radialOffsets[radialIndex],
          normalWeight: normalOffsets[normalIndex],
        });
        const throttle = clamp(
          dvNeedKmS / Math.max(0.02, finiteNumber(plannerConfig.moonClosedLoopThrottleDvScaleKmS, 1.15)),
          finiteNumber(plannerConfig.moonClosedLoopThrottleMin, 0.08),
          finiteNumber(plannerConfig.moonClosedLoopThrottleMax, 0.78),
        );
        const candidate = evaluateTransferCandidate({
          initialState,
          sources,
          spacecraft,
          burnDirection,
          deltaVNeedKmS: dvNeedKmS,
          throttle,
          accelAtThrottle1KmS2,
          predictDurationSec,
          stepSec,
          targetPositionKm,
          targetVelocityKmS,
          targetBodyId,
          targetBodyRadiusKm,
          targetPeriluneAltitudeKm,
          safetyBodyId,
          safetyMinAltitudeKm,
        });
        if (candidate && (!best || candidate.cost < best.cost)) {
          best = candidate;
        }
      }
    }
  }
  return best;
}

function solveBestClosedLoopTransfer({
  initialState,
  sources,
  spacecraft,
  tangent,
  up,
  primaryDirection,
  targetPositionKm,
  targetVelocityKmS,
  targetBodyId,
  targetBodyRadiusKm,
  targetDistanceKm,
  targetPeriluneAltitudeKm,
  safetyBodyId,
  safetyMinAltitudeKm,
  nominalDeltaVKmS,
  predictDurationsSec,
  plannerConfig,
  phase,
  nowSec,
  runtime,
}) {
  const cadenceSec = Math.max(20, finiteNumber(plannerConfig.moonClosedLoopSolveCadenceSec, 120));
  const lastSolveSec = finiteNumber(runtime?.lastSolveSec, Number.NaN);
  const solveDue = !runtime?.solution || !Number.isFinite(lastSolveSec) || !Number.isFinite(nowSec) || ((nowSec - lastSolveSec) >= cadenceSec);
  if (!solveDue && runtime?.solution) {
    return { solution: runtime.solution, solvedThisStep: false };
  }

  const shipEarthRadiusKm = length(initialState.positionKm);
  const accelAtThrottle1KmS2 = Math.max(0.0002, finiteNumber(plannerConfig.engineAccelAtThrottle1KmS2, 0.0055));
  let best = null;
  const normalizedPrimaryDirection = normalize(primaryDirection, tangent);
  const normalizedNominalDeltaV = Math.max(0.002, finiteNumber(nominalDeltaVKmS, 0.15));
  const durations = Array.isArray(predictDurationsSec) && predictDurationsSec.length > 0
    ? predictDurationsSec
    : [nominalTransferTimeSec(shipEarthRadiusKm, targetDistanceKm, EARTH_MU_KM3_S2)];
  for (let i = 0; i < durations.length; i += 1) {
    const predictDurationSec = Math.max(3 * 3600, finiteNumber(durations[i], durations[0]));
    const candidate = enumerateTransferCandidates({
      initialState,
      sources,
      spacecraft,
      primaryDirection: normalizedPrimaryDirection,
      up,
      nominalDeltaVKmS: normalizedNominalDeltaV,
      accelAtThrottle1KmS2,
      predictDurationSec,
      plannerConfig,
      targetPositionKm,
      targetVelocityKmS,
      targetBodyId,
      targetBodyRadiusKm,
      targetPeriluneAltitudeKm,
      safetyBodyId,
      safetyMinAltitudeKm,
      phase,
    });
    if (candidate && (!best || candidate.cost < best.cost)) {
      best = candidate;
    }
  }
  if (runtime) {
    runtime.solution = best;
    runtime.lastSolveSec = Number.isFinite(nowSec) ? nowSec : runtime.lastSolveSec;
    runtime.lastSolveReason = best ? "nbody-closed-loop-optimal" : "nbody-no-solution";
  }
  return { solution: best, solvedThisStep: true };
}

function solveOrbitInsertionBurn({
  initialState,
  sources,
  spacecraft,
  relativePositionKm,
  relativeVelocityKmS,
  targetBodyId,
  targetBodyRadiusKm,
  targetPeriapsisKm,
  targetApoapsisKm,
  accelAtThrottle1KmS2,
  plannerConfig,
}) {
  const retrograde = normalize(scale(relativeVelocityKmS, -1), scale(relativePositionKm, -1));
  const radialOut = normalize(relativePositionKm, retrograde);
  const normal = normalize(cross(relativePositionKm, relativeVelocityKmS), { x: 0, y: 0, z: 1 });
  const dvMagnitudes = [0.12, 0.28, 0.45, 0.7, 0.95, 1.25, 1.55];
  const radialOffsets = [-0.18, 0, 0.18];
  const normalOffsets = [-0.08, 0, 0.08];
  const predictDurationSec = Math.max(2 * 3600, finiteNumber(plannerConfig.moonClosedLoopCapturePredictSec, 6 * 3600));
  const stepSec = Math.max(20, finiteNumber(plannerConfig.moonClosedLoopCaptureStepSec, 90));
  let best = null;
  for (let dvIndex = 0; dvIndex < dvMagnitudes.length; dvIndex += 1) {
    const deltaVNeedKmS = dvMagnitudes[dvIndex];
    for (let radialIndex = 0; radialIndex < radialOffsets.length; radialIndex += 1) {
      for (let normalIndex = 0; normalIndex < normalOffsets.length; normalIndex += 1) {
        const direction = combineBasis({
          primaryDir: retrograde,
          radialDir: radialOut,
          normalDir: normal,
          primaryWeight: 1,
          radialWeight: radialOffsets[radialIndex],
          normalWeight: normalOffsets[normalIndex],
        });
        const throttle = clamp(
          deltaVNeedKmS / Math.max(0.02, finiteNumber(plannerConfig.moonClosedLoopThrottleDvScaleKmS, 1.15)),
          finiteNumber(plannerConfig.moonClosedLoopThrottleMin, 0.08),
          finiteNumber(plannerConfig.moonClosedLoopThrottleMax, 0.78),
        );
        const burnDurationSec = burnDurationForDeltaVSec(deltaVNeedKmS, accelAtThrottle1KmS2, throttle);
        const propagation = propagateMoonGuidanceState({
          initialState,
          durationSec: predictDurationSec,
          stepSec,
          sources,
          spacecraft,
          burnCommand: {
            direction,
            throttle,
            accelAtThrottle1KmS2,
            burnDurationSec,
          },
        });
        if (!propagation) {
          continue;
        }
        const orbit = targetBodyId === "moon" ? propagation.moonOrbit : propagation.earthOrbit;
        const periapsisKm = Number(orbit?.periapsisKm);
        const apoapsisKm = Number(orbit?.apoapsisKm);
        const specificEnergy = Number(orbit?.specificEnergy);
        const minAltitudeKm = targetBodyId === "moon"
          ? propagation.minMoonAltitudeKm
          : propagation.minEarthAltitudeKm;
        const unboundPenalty = Number.isFinite(specificEnergy) && specificEnergy < 0 ? 0 : 1_000_000;
        const periPenalty = Number.isFinite(periapsisKm)
          ? Math.abs(periapsisKm - targetPeriapsisKm) * 500
          : 400_000;
        const apoPenalty = Number.isFinite(apoapsisKm)
          ? Math.abs(apoapsisKm - targetApoapsisKm) * 25
          : 150_000;
        const impactPenalty = Number.isFinite(minAltitudeKm) && minAltitudeKm < 10
          ? (10 - minAltitudeKm) * 200_000
          : 0;
        const cost = unboundPenalty + periPenalty + apoPenalty + impactPenalty + (deltaVNeedKmS * 500);
        const candidate = {
          cost,
          throttle,
          deltaVNeedKmS,
          burnDurationSec,
          burnDirection: direction,
          propagation,
          periapsisKm,
          apoapsisKm,
          specificEnergy,
        };
        if (!best || candidate.cost < best.cost) {
          best = candidate;
        }
      }
    }
  }
  return best;
}

export function planMoonClosedLoopMissionCommand({
  phase = "",
  targetVectors = {},
  metrics = {},
  plannerConfig = {},
  estimatorConfig = {},
  plannerRuntime = null,
  timestampSec = Number.NaN,
} = {}) {
  const phaseName = String(phase || "").trim();
  const tangent = normalize(targetVectors.tangent, { x: 0, y: 1, z: 0 });
  const up = normalize(targetVectors.up, { x: 0, y: 0, z: 1 });
  const toMoon = normalize(targetVectors.toMoon, tangent);
  const toEarth = normalize(targetVectors.toEarth, scale(up, -1));
  const moonRuntime = plannerRuntime?.moon || null;
  const gncRuntime = ensureMoonGncRuntime(moonRuntime);
  if (moonRuntime && (!moonRuntime.filter || typeof moonRuntime.filter !== "object")) {
    moonRuntime.filter = createMoonNavigationFilterState();
  }
  if (moonRuntime) {
    updateMoonNavigationFilter({
      filterState: moonRuntime.filter,
      targetVectors,
      metrics,
      plannerConfig,
      estimatorConfig,
      timestampSec,
    });
    moonRuntime.lastTimestampSec = Number.isFinite(Number(timestampSec))
      ? Number(timestampSec)
      : moonRuntime.lastTimestampSec;
  }
  const estimatedPositionKm = finiteVector(moonRuntime?.filter?.estimate?.positionKm)
    ? moonRuntime.filter.estimate.positionKm
    : targetVectors.shipEarthPositionKm;
  const estimatedVelocityKmS = finiteVector(moonRuntime?.filter?.estimate?.velocityKmS)
    ? moonRuntime.filter.estimate.velocityKmS
    : targetVectors.shipEarthVelocityKmS;
  if (!gncRuntime || !finiteVector(estimatedPositionKm) || !finiteVector(estimatedVelocityKmS)) {
    return null;
  }
  const sources = buildMoonGuidanceSourceModel({ targetVectors, metrics, plannerConfig });
  const spacecraft = {
    bodyId: String(metrics.bodyId || "earth_launch_vehicle"),
    massKg: Math.max(1, finiteNumber(metrics.stageMassKg, metrics.massKg || 1)),
    radiusKm: 0.0045,
    reflectivityCoeff: finiteNumber(metrics.reflectivityCoeff, 1.45),
  };
  const initialState = {
    positionKm: estimatedPositionKm,
    velocityKmS: estimatedVelocityKmS,
  };
  const engineAccelAtThrottle1KmS2 = Math.max(
    0.0002,
    finiteNumber(metrics.engineAccelAtThrottle1KmS2, plannerConfig.engineAccelAtThrottle1KmS2 || 0.0055),
  );
  const moonDistanceKm = Math.max(0, finiteNumber(metrics.moonDistanceKm, length(subtract(estimatedPositionKm, sources.moon.positionKm))));
  const moonClosingSpeedKmS = finiteNumber(metrics.moonClosingSpeedKmS, 0);
  const earthDistanceKm = Math.max(0, finiteNumber(metrics.earthDistanceKm, length(estimatedPositionKm)));
  const earthClosingSpeedKmS = -finiteNumber(metrics.earthRadialSpeedKmS, 0);
  const missTrendKmS = finiteNumber(metrics.moonProjectedMissTrendKmS, 0);
  const missGateKm = Math.max(1_000, finiteNumber(plannerConfig.moonMidcourseMissDistanceKm, 95_000));
  const periapsisMinKm = Math.max(80, finiteNumber(plannerConfig.tliPeriapsisProtectMinKm, 130));
  const timeToPeriapsisSec = finiteNumber(metrics.timeToPeriapsisSec, Number.NaN);
  const nearPeriapsisBurnWindow = Number.isFinite(timeToPeriapsisSec)
    ? Math.abs(timeToPeriapsisSec) <= Math.max(30, finiteNumber(plannerConfig.tliPeriapsisBurnWindowSec, 260))
    : false;
  const missionPhaseElapsedSec = finiteNumber(metrics.missionPhaseElapsedSec, Number.NaN);
  const departurePlanDirection = finiteVector(targetVectors.departurePlanBurnDirectionKm)
    ? normalize(targetVectors.departurePlanBurnDirectionKm, tangent)
    : null;
  const departurePlanThrottle = Number(metrics.departurePlanThrottle);
  const departurePlanBurnDurationSec = Number(metrics.departurePlanBurnDurationSec);
  const departurePlanCommitWindowSec = Math.max(1, finiteNumber(metrics.departurePlanCommitWindowSec, 0));
  const departurePlanPredictedMissDistanceKm = Number(metrics.departurePlanPredictedMissDistanceKm);
  const departurePlanPredictedPeriluneAltitudeKm = Number(metrics.departurePlanPredictedPeriluneAltitudeKm);
  const departurePlanBPlaneErrorKm = Number(metrics.departurePlanBPlaneErrorKm);
  const departurePlanGeometryScore = Number(metrics.departurePlanGeometryScore);
  const departurePlanAlignNow = Number(metrics.departurePlanAlignNow);
  const departurePlanGeometryAcceptable = !Number.isFinite(departurePlanGeometryScore)
    || departurePlanGeometryScore >= 0.55;
  const departurePlanAlignmentAcceptable = !Number.isFinite(departurePlanAlignNow)
    || departurePlanAlignNow >= 0.7;
  const departureCommitActive = (
    phaseName === "tli_burn"
    && Boolean(metrics.departurePlanReady)
    && finiteVector(departurePlanDirection)
    && Number.isFinite(departurePlanThrottle)
    && Number.isFinite(missionPhaseElapsedSec)
    && missionPhaseElapsedSec <= departurePlanCommitWindowSec
    && departurePlanGeometryAcceptable
    && departurePlanAlignmentAcceptable
  );
  const nowSec = Number(timestampSec);

  if (phaseName === "tli_burn" || phaseName === "coast_to_moon") {
    const shipEarthRadiusKm = length(initialState.positionKm);
    const nominalTransferSec = nominalTransferTimeSec(shipEarthRadiusKm, moonDistanceKm, EARTH_MU_KM3_S2);
    const nominalDeltaVKmS = nominalTliDeltaVEstimateKmS(shipEarthRadiusKm, moonDistanceKm, EARTH_MU_KM3_S2);
    const solve = solveBestClosedLoopTransfer({
      initialState,
      sources,
      spacecraft,
      tangent,
      up,
      primaryDirection: phaseName === "tli_burn"
        ? normalize(add(scale(tangent, 0.8), scale(toMoon, 0.2)), tangent)
        : normalize(add(scale(toMoon, 0.6), scale(tangent, 0.4)), toMoon),
      targetPositionKm: sources.moon.positionKm,
      targetVelocityKmS: sources.moon.velocityKmS,
      targetBodyId: "moon",
      targetBodyRadiusKm: Number(sources.moon.radiusKm) || DEFAULT_MOON_RADIUS_KM,
      targetDistanceKm: moonDistanceKm,
      targetPeriluneAltitudeKm: Math.max(20, finiteNumber(plannerConfig.moonTargetPeriluneAltitudeKm, 120)),
      safetyBodyId: "earth",
      safetyMinAltitudeKm: periapsisMinKm,
      nominalDeltaVKmS: phaseName === "tli_burn"
        ? nominalDeltaVKmS
        : Math.min(0.22, Math.max(0.01, nominalDeltaVKmS * 0.04)),
      predictDurationsSec: phaseName === "tli_burn"
        ? [nominalTransferSec * 0.85, nominalTransferSec, nominalTransferSec * 1.15]
        : [Math.max(6 * 3600, nominalTransferSec * 0.25), Math.max(10 * 3600, nominalTransferSec * 0.4)],
      plannerConfig: {
        ...plannerConfig,
        engineAccelAtThrottle1KmS2,
      },
      phase: phaseName,
      nowSec,
      runtime: gncRuntime,
    });
    const best = solve.solution;
    if (!best) {
      const fallbackMode = phaseName === "tli_burn"
        ? "navsys:gnc-lambert-unavailable"
        : "navsys:gnc-lambert-midcourse-coast";
      gncRuntime.lastCommandMode = fallbackMode;
      if (moonRuntime?.filter) {
        moonRuntime.filter.lastControlAccelKmS2 = { x: 0, y: 0, z: 0 };
      }
      return {
        phase: "coast",
        throttle: 0,
        direction: normalize(add(scale(toMoon, 0.7), scale(tangent, 0.3)), toMoon),
        mode: fallbackMode,
        diagnostics: {
          requestedMode: "nbody-closed-loop-gnc",
          solveReady: false,
        },
      };
    }
    const missFarFromGate = best.predictedMissDistanceKm > (missGateKm * 2.1);
    const movingAwayFromMoon = moonClosingSpeedKmS < -0.02;
    const missDiverging = missTrendKmS > 0.08;
    const tliReacquireHold = phaseName === "tli_burn"
      && missFarFromGate
      && (movingAwayFromMoon || missDiverging)
      && !nearPeriapsisBurnWindow
      && !departureCommitActive;

    const effectivePredictedMissDistanceKm = (
      departureCommitActive && Number.isFinite(departurePlanPredictedMissDistanceKm)
        ? departurePlanPredictedMissDistanceKm
        : best.predictedMissDistanceKm
    );
    const effectivePredictedPeriluneAltitudeKm = (
      departureCommitActive && Number.isFinite(departurePlanPredictedPeriluneAltitudeKm)
        ? departurePlanPredictedPeriluneAltitudeKm
        : best.predictedPeriluneAltitudeKm
    );
    const effectiveBPlaneErrorKm = (
      departureCommitActive && Number.isFinite(departurePlanBPlaneErrorKm)
        ? departurePlanBPlaneErrorKm
        : best.bPlaneErrorKm
    );
    const effectiveBurnDurationSec = (
      departureCommitActive && Number.isFinite(departurePlanBurnDurationSec)
        ? departurePlanBurnDurationSec
        : best.burnDurationSec
    );

    moonRuntime.approach.projectedPeriluneAltitudeKm = Number.isFinite(effectivePredictedPeriluneAltitudeKm)
      ? effectivePredictedPeriluneAltitudeKm
      : null;
    moonRuntime.approach.corridorErrorKm = Number.isFinite(effectivePredictedPeriluneAltitudeKm)
      ? (effectivePredictedPeriluneAltitudeKm - Math.max(20, finiteNumber(plannerConfig.moonTargetPeriluneAltitudeKm, 120)))
      : null;
    moonRuntime.approach.bPlaneErrorKm = Number.isFinite(effectiveBPlaneErrorKm) ? effectiveBPlaneErrorKm : null;
    moonRuntime.approach.timeToClosestSec = Number.isFinite(best.propagation?.durationSec) ? best.propagation.durationSec : null;

    let command = {
      phase: "powered",
      throttle: best.throttle,
      direction: best.burnDirection,
      mode: phaseName === "tli_burn"
        ? "navsys:gnc-lambert-tli-burn"
        : "navsys:gnc-lambert-midcourse-correction",
    };
    if (departureCommitActive) {
      const blendedDepartureDirection = finiteVector(best?.burnDirection)
        ? normalize(
          add(
            scale(departurePlanDirection, 0.88),
            scale(best.burnDirection, 0.12),
          ),
          departurePlanDirection,
        )
        : departurePlanDirection;
      command = {
        phase: "powered",
        throttle: clamp(
          departurePlanThrottle,
          finiteNumber(plannerConfig.moonClosedLoopThrottleMin, 0.08),
          finiteNumber(plannerConfig.moonClosedLoopThrottleMax, 0.78),
        ),
        direction: blendedDepartureDirection,
        mode: "navsys:gnc-lambert-tli-burn+departure-commit+diffcorr",
      };
    } else if (tliReacquireHold) {
      command = {
        phase: "coast",
        throttle: 0,
        direction: normalize(add(scale(toMoon, 0.74), scale(tangent, 0.26)), toMoon),
        mode: "navsys:gnc-lambert-tli-reacquire-window",
      };
    } else if (
      phaseName === "coast_to_moon"
      && (
        (
          best.predictedMissDistanceKm <= Math.max(10_000, finiteNumber(plannerConfig.moonCaptureGateDistanceKm, 55_000) * 1.25)
          && best.predictedPeriluneAltitudeKm <= Math.max(20_000, finiteNumber(plannerConfig.moonCaptureUpperAltitudeKm, 16_000) * 1.2)
        )
        || (
          moonDistanceKm <= Math.max(10_000, finiteNumber(plannerConfig.moonCaptureGateDistanceKm, 55_000))
          && moonClosingSpeedKmS > Math.max(0.001, finiteNumber(plannerConfig.moonMidcourseMinClosingSpeedKmS, 0.02))
        )
      )
    ) {
      command = {
        phase: "coast",
        throttle: 0,
        direction: normalize(add(scale(toMoon, 0.84), scale(tangent, 0.16)), toMoon),
        mode: "navsys:gnc-lambert-approach-coast",
      };
    } else if (best.deltaVNeedKmS <= (phaseName === "tli_burn" ? 0.01 : 0.004)) {
      command = {
        phase: "coast",
        throttle: 0,
        direction: normalize(add(scale(toMoon, 0.8), scale(tangent, 0.2)), toMoon),
        mode: phaseName === "tli_burn"
          ? "navsys:gnc-lambert-tli-coast"
          : "navsys:gnc-lambert-midcourse-coast",
      };
    } else {
      if (phaseName === "tli_burn" && missFarFromGate) {
        command.throttle = Math.min(
          command.throttle,
          Math.max(0.08, finiteNumber(plannerConfig.moonClosedLoopReacquireThrottleCap, 0.56)),
        );
        command.mode = `${command.mode}+reacquire`;
      }
      command.mode = `${command.mode}+diffcorr`;
    }
    if (solve.solvedThisStep) {
      command.mode = `${command.mode}+retarget`;
    }
    gncRuntime.lastCommandMode = command.mode;
    gncRuntime.predictedMissDistanceKm = Number.isFinite(effectivePredictedMissDistanceKm)
      ? effectivePredictedMissDistanceKm
      : null;
    gncRuntime.predictedPeriluneAltitudeKm = Number.isFinite(effectivePredictedPeriluneAltitudeKm)
      ? effectivePredictedPeriluneAltitudeKm
      : null;
    gncRuntime.bPlaneErrorKm = Number.isFinite(effectiveBPlaneErrorKm) ? effectiveBPlaneErrorKm : null;
    gncRuntime.deltaVNeedKmS = Number.isFinite(best.deltaVNeedKmS) ? best.deltaVNeedKmS : null;
    moonRuntime.approach.lastDecision = command.mode;
    if (moonRuntime?.filter) {
      moonRuntime.filter.lastControlAccelKmS2 = command.phase === "powered"
        ? scale(command.direction, clamp(command.throttle, 0, 1) * engineAccelAtThrottle1KmS2)
        : { x: 0, y: 0, z: 0 };
    }
    return {
      ...command,
      diagnostics: {
        requestedMode: "nbody-closed-loop-differential-gnc",
        missDistanceKm: gncRuntime.predictedMissDistanceKm,
        missGateKm,
        bPlaneErrorKm: gncRuntime.bPlaneErrorKm,
        periluneEstimateKm: gncRuntime.predictedPeriluneAltitudeKm,
        deltaVNeedKmS: gncRuntime.deltaVNeedKmS,
        predictedClosingSpeedKmS: Number.isFinite(best.closestClosingSpeedKmS)
          ? best.closestClosingSpeedKmS
          : null,
        burnDurationSec: Number.isFinite(effectiveBurnDurationSec) ? effectiveBurnDurationSec : null,
        tliReacquireHold,
        nearPeriapsisBurnWindow,
        departureCommitActive,
        solveReady: true,
      },
    };
  }

  if (phaseName === "tei_burn" || phaseName === "coast_to_earth") {
    const nominalDeltaVKmS = phaseName === "tei_burn" ? 0.92 : 0.08;
    const solve = solveBestClosedLoopTransfer({
      initialState,
      sources,
      spacecraft,
      tangent,
      up,
      primaryDirection: phaseName === "tei_burn"
        ? normalize(add(scale(toEarth, 0.82), scale(tangent, 0.18)), toEarth)
        : normalize(add(scale(toEarth, 0.68), scale(tangent, 0.32)), toEarth),
      targetPositionKm: sources.earth.positionKm,
      targetVelocityKmS: sources.earth.velocityKmS,
      targetBodyId: "earth",
      targetBodyRadiusKm: Number(sources.earth.radiusKm) || DEFAULT_EARTH_RADIUS_KM,
      targetDistanceKm: earthDistanceKm,
      targetPeriluneAltitudeKm: Math.max(120, finiteNumber(plannerConfig.earthCapturePeriapsisTargetKm, 180)),
      safetyBodyId: "moon",
      safetyMinAltitudeKm: Math.max(20, finiteNumber(plannerConfig.moonTargetPeriluneAltitudeKm, 120) * 0.5),
      nominalDeltaVKmS,
      predictDurationsSec: phaseName === "tei_burn"
        ? [48 * 3600, 72 * 3600, 96 * 3600]
        : [24 * 3600, 48 * 3600, 72 * 3600],
      plannerConfig: {
        ...plannerConfig,
        engineAccelAtThrottle1KmS2,
      },
      phase: phaseName,
      nowSec,
      runtime: gncRuntime,
    });
    const best = solve.solution;
    if (!best) {
      return null;
    }
    const nearEarthCaptureGate = (
      phaseName === "coast_to_earth"
      && best.predictedMissDistanceKm <= Math.max(10_000, finiteNumber(plannerConfig.earthCaptureDistanceKm, 45_000) * 1.25)
    );
    let command = {
      phase: "powered",
      throttle: clamp(best.throttle, 0.08, 0.72),
      direction: normalize(add(scale(best.burnDirection, 0.84), scale(toEarth, 0.16)), toEarth),
      mode: phaseName === "tei_burn"
        ? "navsys:gnc-tei-burn"
        : "navsys:gnc-earth-midcourse-correction",
    };
    if (nearEarthCaptureGate || best.deltaVNeedKmS <= (phaseName === "tei_burn" ? 0.01 : 0.004)) {
      command = {
        phase: "coast",
        throttle: 0,
        direction: toEarth,
        mode: phaseName === "tei_burn"
          ? "navsys:gnc-tei-coast"
          : "navsys:gnc-coast-to-earth",
      };
    } else {
      command.mode = `${command.mode}+diffcorr`;
    }
    if (solve.solvedThisStep) {
      command.mode = `${command.mode}+retarget`;
    }
    gncRuntime.lastCommandMode = command.mode;
    gncRuntime.predictedMissDistanceKm = Number.isFinite(best.predictedMissDistanceKm) ? best.predictedMissDistanceKm : null;
    gncRuntime.predictedPeriluneAltitudeKm = Number.isFinite(best.predictedPeriluneAltitudeKm) ? best.predictedPeriluneAltitudeKm : null;
    gncRuntime.bPlaneErrorKm = Number.isFinite(best.bPlaneErrorKm) ? best.bPlaneErrorKm : null;
    gncRuntime.deltaVNeedKmS = Number.isFinite(best.deltaVNeedKmS) ? best.deltaVNeedKmS : null;
    moonRuntime.approach.projectedPeriluneAltitudeKm = gncRuntime.predictedPeriluneAltitudeKm;
    moonRuntime.approach.corridorErrorKm = Number.isFinite(gncRuntime.predictedPeriluneAltitudeKm)
      ? (gncRuntime.predictedPeriluneAltitudeKm - Math.max(120, finiteNumber(plannerConfig.earthCapturePeriapsisTargetKm, 180)))
      : null;
    moonRuntime.approach.bPlaneErrorKm = gncRuntime.bPlaneErrorKm;
    moonRuntime.approach.timeToClosestSec = Number.isFinite(best.propagation?.durationSec) ? best.propagation.durationSec : null;
    moonRuntime.approach.lastDecision = command.mode;
    if (moonRuntime?.filter) {
      moonRuntime.filter.lastControlAccelKmS2 = command.phase === "powered"
        ? scale(command.direction, clamp(command.throttle, 0, 1) * engineAccelAtThrottle1KmS2)
        : { x: 0, y: 0, z: 0 };
    }
    return {
      ...command,
      diagnostics: {
        requestedMode: phaseName === "tei_burn"
          ? "nbody-tei-targeter"
          : "nbody-earth-return-differential-gnc",
        missDistanceKm: gncRuntime.predictedMissDistanceKm,
        bPlaneErrorKm: gncRuntime.bPlaneErrorKm,
        periluneEstimateKm: gncRuntime.predictedPeriluneAltitudeKm,
        deltaVNeedKmS: gncRuntime.deltaVNeedKmS,
        predictedClosingSpeedKmS: Number.isFinite(best.closestClosingSpeedKmS)
          ? best.closestClosingSpeedKmS
          : earthClosingSpeedKmS,
        burnDurationSec: Number.isFinite(best.burnDurationSec) ? best.burnDurationSec : null,
        solveReady: true,
      },
    };
  }

  if (phaseName === "lunar_insertion") {
    const relativePositionKm = subtract(estimatedPositionKm, sources.moon.positionKm);
    const relativeVelocityKmS = subtract(estimatedVelocityKmS, sources.moon.velocityKmS);
    const best = solveOrbitInsertionBurn({
      initialState,
      sources,
      spacecraft,
      relativePositionKm,
      relativeVelocityKmS,
      targetBodyId: "moon",
      targetBodyRadiusKm: Number(sources.moon.radiusKm) || DEFAULT_MOON_RADIUS_KM,
      targetPeriapsisKm: Math.max(20, finiteNumber(plannerConfig.moonTargetPeriluneAltitudeKm, 120)),
      targetApoapsisKm: Math.max(600, finiteNumber(plannerConfig.moonCaptureUpperAltitudeKm, 16_000) * 0.45),
      accelAtThrottle1KmS2: engineAccelAtThrottle1KmS2,
      plannerConfig,
    });
    if (!best) {
      return null;
    }
    gncRuntime.lastCommandMode = "navsys:gnc-lunar-capture-retrograde";
    gncRuntime.predictedPeriluneAltitudeKm = Number.isFinite(best.periapsisKm) ? best.periapsisKm : null;
    gncRuntime.bPlaneErrorKm = Number.isFinite(best.apoapsisKm) ? Math.abs(best.apoapsisKm - Math.max(600, finiteNumber(plannerConfig.moonCaptureUpperAltitudeKm, 16_000) * 0.45)) : null;
    gncRuntime.deltaVNeedKmS = Number.isFinite(best.deltaVNeedKmS) ? best.deltaVNeedKmS : null;
    moonRuntime.approach.lastDecision = gncRuntime.lastCommandMode;
    if (moonRuntime?.filter) {
      moonRuntime.filter.lastControlAccelKmS2 = scale(best.burnDirection, best.throttle * engineAccelAtThrottle1KmS2);
    }
    return {
      phase: "powered",
      throttle: best.throttle,
      direction: best.burnDirection,
      mode: "navsys:gnc-lunar-capture-retrograde",
      diagnostics: {
        requestedMode: "nbody-loi-targeter",
        deltaVNeedKmS: best.deltaVNeedKmS,
        burnDurationSec: best.burnDurationSec,
        targetPeriapsisKm: Math.max(20, finiteNumber(plannerConfig.moonTargetPeriluneAltitudeKm, 120)),
        predictedPeriapsisKm: Number.isFinite(best.periapsisKm) ? best.periapsisKm : null,
        predictedApoapsisKm: Number.isFinite(best.apoapsisKm) ? best.apoapsisKm : null,
        specificEnergy: Number.isFinite(best.specificEnergy) ? best.specificEnergy : null,
      },
    };
  }

  if (phaseName === "lunar_orbit_hold") {
    if (moonRuntime?.filter) {
      moonRuntime.filter.lastControlAccelKmS2 = { x: 0, y: 0, z: 0 };
    }
    return {
      phase: "coast",
      throttle: 0,
      direction: tangent,
      mode: "navsys:gnc-lunar-orbit-hold",
    };
  }

  if (phaseName === "earth_capture") {
    const relativePositionKm = estimatedPositionKm;
    const relativeVelocityKmS = estimatedVelocityKmS;
    const best = solveOrbitInsertionBurn({
      initialState,
      sources,
      spacecraft,
      relativePositionKm,
      relativeVelocityKmS,
      targetBodyId: "earth",
      targetBodyRadiusKm: Number(sources.earth.radiusKm) || DEFAULT_EARTH_RADIUS_KM,
      targetPeriapsisKm: 180,
      targetApoapsisKm: 1200,
      accelAtThrottle1KmS2: engineAccelAtThrottle1KmS2,
      plannerConfig,
    });
    if (!best) {
      return null;
    }
    gncRuntime.lastCommandMode = "navsys:gnc-earth-capture";
    moonRuntime.approach.lastDecision = gncRuntime.lastCommandMode;
    if (moonRuntime?.filter) {
      moonRuntime.filter.lastControlAccelKmS2 = scale(best.burnDirection, best.throttle * engineAccelAtThrottle1KmS2);
    }
    return {
      phase: "powered",
      throttle: best.throttle,
      direction: best.burnDirection,
      mode: "navsys:gnc-earth-capture",
      diagnostics: {
        requestedMode: "nbody-earth-capture-targeter",
        deltaVNeedKmS: best.deltaVNeedKmS,
        burnDurationSec: best.burnDurationSec,
        predictedPeriapsisKm: Number.isFinite(best.periapsisKm) ? best.periapsisKm : null,
        predictedApoapsisKm: Number.isFinite(best.apoapsisKm) ? best.apoapsisKm : null,
        specificEnergy: Number.isFinite(best.specificEnergy) ? best.specificEnergy : null,
      },
    };
  }

  return null;
}
