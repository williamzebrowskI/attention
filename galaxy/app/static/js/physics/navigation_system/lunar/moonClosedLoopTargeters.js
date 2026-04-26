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
  burnDurationForDeltaVSec,
  propagateMoonGuidanceState,
} from "../../runtime/lunarPropagation.js";
import {
  buildMoonGuidanceSourceModel,
  restoreMoonGuidanceSourceModelFromCache,
} from "../../runtime/lunarSourceModel.js";
import { evaluateMoonDepartureCorridor } from "./moonDepartureCorridor.js";
import {
  evaluateBallisticTransferSync,
  getMoonClosedLoopSolveCadenceSec,
  nominalTliDeltaVEstimateKmS,
  nominalTransferTimeSec,
  solveBestClosedLoopTransferSync,
} from "./moonClosedLoopSolverCore.js";
import { prepareMoonMissionNavigationEstimate } from "../gnc/moonMissionNavigation.js";
import {
  canUseMoonClosedLoopSolveWorker,
  consumeMoonClosedLoopTransferSolveResult,
  requestMoonClosedLoopTransferSolve,
} from "./moonClosedLoopSolveWorkerClient.js";

const EARTH_MU_KM3_S2 = 398600.4418;
const DEFAULT_MOON_RADIUS_KM = 1737.4;
const DEFAULT_EARTH_RADIUS_KM = 6371.0084;

function cross(a, b) {
  return {
    x: ((a?.y || 0) * (b?.z || 0)) - ((a?.z || 0) * (b?.y || 0)),
    y: ((a?.z || 0) * (b?.x || 0)) - ((a?.x || 0) * (b?.z || 0)),
    z: ((a?.x || 0) * (b?.y || 0)) - ((a?.y || 0) * (b?.x || 0)),
  };
}

function combineBasis({
  primaryDir,
  radialDir,
  normalDir,
  primaryWeight = 1,
  radialWeight = 0,
  normalWeight = 0,
}) {
  return normalize(
    add(
      scale(primaryDir, primaryWeight),
      add(scale(radialDir, radialWeight), scale(normalDir, normalWeight)),
    ),
    primaryDir,
  );
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback);
}

export function evaluateMoonPassiveCoastEligibility({
  phaseName = "",
  predictedMissDistanceKm = Number.NaN,
  predictedPeriluneAltitudeKm = Number.NaN,
  bPlaneErrorKm = Number.NaN,
  deltaVNeedKmS = Number.NaN,
  moonClosingSpeedKmS = Number.NaN,
  missTrendKmS = Number.NaN,
  plannerConfig = null,
  missGateKm = Number.NaN,
} = {}) {
  const thresholdedDeltaVNeedKmS = finiteNumber(deltaVNeedKmS, Number.POSITIVE_INFINITY);
  if (phaseName !== "coast_to_moon") {
    return {
      corridorAccepted: true,
      allowPassiveCoast: thresholdedDeltaVNeedKmS <= 0.004,
      weakClosing: false,
      diverging: false,
      corridor: null,
    };
  }
  const corridor = evaluateMoonDepartureCorridor({
    predictedMissDistanceKm,
    predictedPeriluneAltitudeKm,
    bPlaneErrorKm,
    plannerConfig,
    missGateKm,
    targetPeriluneAltitudeKm: Math.max(20, finiteNumber(plannerConfig?.moonTargetPeriluneAltitudeKm, 120)),
    bPlaneToleranceKm: Math.max(100, finiteNumber(plannerConfig?.moonBPlaneToleranceKm, 6_000) * 11),
    periluneUpperAltitudeKm: Math.max(100, finiteNumber(plannerConfig?.moonCaptureUpperAltitudeKm, 16_000)),
  });
  const minClosingKmS = Math.max(0.001, finiteNumber(plannerConfig?.moonMidcourseMinClosingSpeedKmS, 0.02));
  const weakClosing = Number.isFinite(moonClosingSpeedKmS) && moonClosingSpeedKmS <= minClosingKmS;
  const diverging = Number.isFinite(missTrendKmS) && missTrendKmS > 0.05;
  return {
    corridorAccepted: Boolean(corridor?.accepted),
    allowPassiveCoast: Boolean(corridor?.accepted)
      && !weakClosing
      && !diverging
      && thresholdedDeltaVNeedKmS <= 0.004,
    weakClosing,
    diverging,
    corridor,
  };
}

export function shouldBridgeDeparturePlanIntoEarlyCoast({
  phaseName = "",
  missionPhaseElapsedSec = Number.NaN,
  moonClosingSpeedKmS = Number.NaN,
  predictedMissDistanceKm = Number.NaN,
  predictedPeriluneAltitudeKm = Number.NaN,
  bPlaneErrorKm = Number.NaN,
  departurePlanCorridorAcceptable = false,
  departurePlanDirection = null,
  departurePlanPredictedMissDistanceKm = Number.NaN,
  departurePlanPredictedPeriluneAltitudeKm = Number.NaN,
  departurePlanBPlaneErrorKm = Number.NaN,
  missGateKm = Number.NaN,
  plannerConfig = null,
} = {}) {
  if (phaseName !== "coast_to_moon") {
    return false;
  }
  if (!departurePlanCorridorAcceptable || !finiteVector(departurePlanDirection)) {
    return false;
  }
  const elapsedSec = finiteNumber(missionPhaseElapsedSec, Number.POSITIVE_INFINITY);
  const bridgeWindowSec = Math.max(
    240,
    Math.min(900, finiteNumber(plannerConfig?.moonCoastDepartureBridgeWindowSec, 720)),
  );
  if (!Number.isFinite(elapsedSec) || elapsedSec > bridgeWindowSec) {
    return false;
  }
  const minimumClosingKmS = Math.max(
    0.02,
    finiteNumber(plannerConfig?.moonMidcourseMinClosingSpeedKmS, 0.02),
  );
  if (!Number.isFinite(moonClosingSpeedKmS) || moonClosingSpeedKmS <= minimumClosingKmS) {
    return false;
  }
  const liveMissDistanceKm = finiteNumber(predictedMissDistanceKm, Number.POSITIVE_INFINITY);
  const livePeriluneAltitudeKm = finiteNumber(predictedPeriluneAltitudeKm, Number.POSITIVE_INFINITY);
  const liveBPlaneErrorKm = finiteNumber(bPlaneErrorKm, Number.POSITIVE_INFINITY);
  const departureMissDistanceKm = Math.max(0, finiteNumber(departurePlanPredictedMissDistanceKm, 0));
  const departurePeriluneAltitudeKm = Math.max(0, finiteNumber(departurePlanPredictedPeriluneAltitudeKm, 0));
  const departureBPlaneErrorKm = Math.max(0, finiteNumber(departurePlanBPlaneErrorKm, 0));
  const missRegressionKm = Math.max(15_000, departureMissDistanceKm * 2.5);
  const periluneRegressionKm = Math.max(8_000, departurePeriluneAltitudeKm + 8_000);
  const bPlaneRegressionKm = Math.max(10_000, departureBPlaneErrorKm * 2.5);
  const liveCorridorMuchWorse = (
    liveMissDistanceKm > (departureMissDistanceKm + missRegressionKm)
    || livePeriluneAltitudeKm > periluneRegressionKm
    || liveBPlaneErrorKm > bPlaneRegressionKm
  );
  return elapsedSec <= bridgeWindowSec && (
    liveCorridorMuchWorse
    || elapsedSec <= Math.min(240, bridgeWindowSec)
  );
}

export function doesMoonCorridorCandidateImproveCommittedPlan({
  candidatePredictedMissDistanceKm = Number.NaN,
  candidatePredictedPeriluneAltitudeKm = Number.NaN,
  candidateBPlaneErrorKm = Number.NaN,
  departurePlanPredictedMissDistanceKm = Number.NaN,
  departurePlanPredictedPeriluneAltitudeKm = Number.NaN,
  departurePlanBPlaneErrorKm = Number.NaN,
  plannerConfig = null,
} = {}) {
  const departureMissKm = finiteNumber(departurePlanPredictedMissDistanceKm, Number.NaN);
  const departurePeriluneKm = finiteNumber(departurePlanPredictedPeriluneAltitudeKm, Number.NaN);
  const departureBPlaneKm = finiteNumber(departurePlanBPlaneErrorKm, Number.NaN);
  const candidateMissKm = finiteNumber(candidatePredictedMissDistanceKm, Number.NaN);
  const candidatePeriluneKm = finiteNumber(candidatePredictedPeriluneAltitudeKm, Number.NaN);
  const candidateBPlaneKm = finiteNumber(candidateBPlaneErrorKm, Number.NaN);
  if (
    !Number.isFinite(departureMissKm)
    || !Number.isFinite(departurePeriluneKm)
    || !Number.isFinite(departureBPlaneKm)
    || !Number.isFinite(candidateMissKm)
    || !Number.isFinite(candidatePeriluneKm)
    || !Number.isFinite(candidateBPlaneKm)
  ) {
    return false;
  }

  const targetPeriluneKm = Math.max(
    20,
    finiteNumber(plannerConfig?.moonTargetPeriluneAltitudeKm, 120),
  );
  const departureScore = departureCorridorCompositeScore({
    predictedMissDistanceKm: departureMissKm,
    predictedPeriluneAltitudeKm: departurePeriluneKm,
    bPlaneErrorKm: departureBPlaneKm,
    targetPeriluneAltitudeKm: targetPeriluneKm,
  });
  const candidateScore = departureCorridorCompositeScore({
    predictedMissDistanceKm: candidateMissKm,
    predictedPeriluneAltitudeKm: candidatePeriluneKm,
    bPlaneErrorKm: candidateBPlaneKm,
    targetPeriluneAltitudeKm: targetPeriluneKm,
  });
  if (!Number.isFinite(departureScore) || !Number.isFinite(candidateScore)) {
    return false;
  }

  const departurePeriluneResidualKm = Math.abs(departurePeriluneKm - targetPeriluneKm);
  const candidatePeriluneResidualKm = Math.abs(candidatePeriluneKm - targetPeriluneKm);
  const candidateNotWorse = (
    candidateMissKm <= Math.max(departureMissKm + 750, departureMissKm * 1.05)
    && candidateBPlaneKm <= Math.max(departureBPlaneKm + 750, departureBPlaneKm * 1.05)
    && candidatePeriluneResidualKm <= Math.max(
      departurePeriluneResidualKm + 750,
      Math.max(50, departurePeriluneResidualKm) * 1.08,
    )
  );
  const materiallyBetter = candidateScore <= (departureScore * 0.92);
  return candidateNotWorse && materiallyBetter;
}

function isMoonCorridorAcceptable({
  predictedMissDistanceKm = Number.NaN,
  predictedPeriluneAltitudeKm = Number.NaN,
  bPlaneErrorKm = Number.NaN,
  plannerConfig = null,
  missGateKm = Number.NaN,
} = {}) {
  const corridor = evaluateMoonDepartureCorridor({
    predictedMissDistanceKm,
    predictedPeriluneAltitudeKm,
    bPlaneErrorKm,
    plannerConfig,
    missGateKm,
  });
  return Boolean(corridor?.accepted);
}

function selectMoonCoastDirection({
  useBallisticCoastDiagnostics = false,
  ballisticCoastDirection = null,
  earlyCoastDepartureBridgeActive = false,
  committedDepartureCorridorPreferred = false,
  departurePlanDirection = null,
  toMoon = null,
  tangent = null,
} = {}) {
  if (useBallisticCoastDiagnostics && finiteVector(ballisticCoastDirection)) {
    return ballisticCoastDirection;
  }
  if (
    (earlyCoastDepartureBridgeActive || committedDepartureCorridorPreferred)
    && finiteVector(departurePlanDirection)
  ) {
    return normalize(
      add(
        scale(departurePlanDirection, 0.78),
        scale(toMoon, 0.22),
      ),
      departurePlanDirection,
    );
  }
  return normalize(add(scale(toMoon, 0.8), scale(tangent, 0.2)), toMoon);
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
      solutionStatePositionKm: null,
      solutionStateVelocityKmS: null,
      solutionStateTimestampSec: null,
      solutionStateDriftKm: null,
      solutionStateDriftKmS: null,
      solutionInvalidatedForStateDrift: false,
      predictedMissDistanceKm: null,
      predictedPeriluneAltitudeKm: null,
      bPlaneErrorKm: null,
      deltaVNeedKmS: null,
      sourceModelCache: null,
      sourceModelCacheTimestampSec: null,
      departureSeedTrackAccepted: null,
      departureSeedTrackPositionErrorKm: null,
      departureSeedTrackVelocityErrorKmS: null,
      departureSeedTrackLastEvalSec: null,
      workerPending: false,
      workerRequestId: null,
      workerRequestedAtSec: null,
      workerResult: null,
      workerResponseReady: false,
      workerError: "",
      workerSolveReason: "",
      workerSolvedAtSec: Number.NaN,
      workerErrorBackoffUntilSec: null,
      coastCorrectionMode: "",
      coastCorrectionModeSetAtSec: null,
      ballisticCoastCandidate: null,
      ballisticCoastEvalSec: null,
      ballisticCoastDirection: null,
    };
  }
  return moonRuntime.gnc;
}

function getBallisticCoastEvalCadenceSec(plannerConfig = null) {
  const closedLoopCadenceSec = getMoonClosedLoopSolveCadenceSec(plannerConfig);
  const baseCadenceSec = Math.max(10, Math.min(30, closedLoopCadenceSec * 0.25));
  if (typeof window !== "undefined") {
    return Math.max(10, baseCadenceSec);
  }
  return Math.max(120, Math.min(240, closedLoopCadenceSec * 0.8));
}

function storeBallisticCoastCandidate({
  runtime = null,
  candidate = null,
  direction = null,
  nowSec = Number.NaN,
} = {}) {
  if (!runtime || typeof runtime !== "object") {
    return;
  }
  runtime.ballisticCoastCandidate = candidate || null;
  runtime.ballisticCoastDirection = finiteVector(direction)
    ? {
      x: Number(direction.x) || 0,
      y: Number(direction.y) || 0,
      z: Number(direction.z) || 0,
    }
    : null;
  runtime.ballisticCoastEvalSec = Number.isFinite(nowSec)
    ? nowSec
    : runtime.ballisticCoastEvalSec;
}

function buildNavigationQualityDiagnostics(filterState = null) {
  const measurement = filterState?.lastMeasurement || null;
  return {
    navigationSource: String(measurement?.source || ""),
    navigationSensorSuite: String(measurement?.sensorSuite || ""),
    navigationFreshMeasurement: typeof measurement?.fresh === "boolean"
      ? Boolean(measurement.fresh)
      : null,
    navigationMeasurementAgeSec: Number.isFinite(Number(measurement?.measurementAgeSec))
      ? Number(measurement.measurementAgeSec)
      : null,
    navigationDsnCadenceSec: Number.isFinite(Number(measurement?.dsnCadenceSec))
      ? Number(measurement.dsnCadenceSec)
      : null,
    navigationDsnLightTimeSec: Number.isFinite(Number(measurement?.dsnLightTimeSec))
      ? Number(measurement.dsnLightTimeSec)
      : null,
    navigationPositionSigmaKm: Number.isFinite(Number(measurement?.positionSigmaKm))
      ? Number(measurement.positionSigmaKm)
      : null,
    navigationVelocitySigmaKmS: Number.isFinite(Number(measurement?.velocitySigmaKmS))
      ? Number(measurement.velocitySigmaKmS)
      : null,
    navigationOpticalMoonNavActive: typeof measurement?.opticalMoonNavActive === "boolean"
      ? Boolean(measurement.opticalMoonNavActive)
      : null,
    navigationOpticalEarthNavActive: typeof measurement?.opticalEarthNavActive === "boolean"
      ? Boolean(measurement.opticalEarthNavActive)
      : null,
  };
}

function resolveBallisticCoastCandidate({
  runtime = null,
  phaseName = "",
  nowSec = Number.NaN,
  initialState = null,
  sources = null,
  spacecraft = null,
  toMoon = null,
  tangent = null,
  periapsisMinKm = Number.NaN,
  moonDistanceKm = Number.NaN,
  plannerConfig = null,
} = {}) {
  const ballisticCoastDirection = normalize(add(scale(toMoon, 0.86), scale(tangent, 0.14)), toMoon);
  const shipEarthRadiusKm = length(initialState?.positionKm);
  const nominalTransferSec = nominalTransferTimeSec(
    Math.max(DEFAULT_EARTH_RADIUS_KM + 200, shipEarthRadiusKm),
    moonDistanceKm,
    EARTH_MU_KM3_S2,
  );
  if (phaseName !== "coast_to_moon") {
    return {
      candidate: null,
      direction: ballisticCoastDirection,
    };
  }
  const cachedCandidate = runtime?.ballisticCoastCandidate || null;
  const cachedDirection = finiteVector(runtime?.ballisticCoastDirection)
    ? runtime.ballisticCoastDirection
    : null;
  const lastEvalSec = finiteNumber(runtime?.ballisticCoastEvalSec, Number.NaN);
  const cadenceSec = getBallisticCoastEvalCadenceSec(plannerConfig);
  const evaluationDue = (
    !cachedCandidate
    || !Number.isFinite(lastEvalSec)
    || !Number.isFinite(nowSec)
    || ((nowSec - lastEvalSec) >= cadenceSec)
  );
  if (!evaluationDue) {
    return {
      candidate: cachedCandidate,
      direction: cachedDirection || ballisticCoastDirection,
    };
  }
  const candidate = evaluateBallisticTransferSync({
    initialState,
    sources,
    spacecraft,
    primaryDirection: ballisticCoastDirection,
    targetBodyId: "moon",
    targetBodyRadiusKm: Number(sources?.moon?.radiusKm) || DEFAULT_MOON_RADIUS_KM,
    targetPeriluneAltitudeKm: Math.max(20, finiteNumber(plannerConfig?.moonTargetPeriluneAltitudeKm, 120)),
    safetyBodyId: "earth",
    safetyMinAltitudeKm: periapsisMinKm,
    predictDurationSec: Math.max(18 * 3600, nominalTransferSec * 0.55),
    plannerConfig,
  });
  storeBallisticCoastCandidate({
    runtime,
    candidate,
    direction: ballisticCoastDirection,
    nowSec,
  });
  return {
    candidate,
    direction: ballisticCoastDirection,
  };
}

function storeClosedLoopSolveResult({
  runtime = null,
  solution = null,
  initialState = null,
  nowSec = Number.NaN,
  solveReason = "",
} = {}) {
  if (!runtime || typeof runtime !== "object") {
    return;
  }
  runtime.solution = solution;
  runtime.solutionStatePositionKm = finiteVector(initialState?.positionKm)
    ? { ...initialState.positionKm }
    : null;
  runtime.solutionStateVelocityKmS = finiteVector(initialState?.velocityKmS)
    ? { ...initialState.velocityKmS }
    : null;
  runtime.solutionStateTimestampSec = Number.isFinite(nowSec) ? nowSec : null;
  if (!runtime.solutionInvalidatedForStateDrift) {
    runtime.solutionStateDriftKm = 0;
    runtime.solutionStateDriftKmS = 0;
  }
  runtime.lastSolveSec = Number.isFinite(nowSec) ? nowSec : runtime.lastSolveSec;
  runtime.lastSolveReason = String(
    solveReason
    || (solution ? "nbody-closed-loop-optimal" : "nbody-no-solution"),
  );
}

function evaluateClosedLoopSolutionStateDrift({
  runtime = null,
  initialState = null,
  nowSec = Number.NaN,
  phase = "",
} = {}) {
  if (
    !runtime?.solution
    || !finiteVector(runtime.solutionStatePositionKm)
    || !finiteVector(runtime.solutionStateVelocityKmS)
    || !finiteVector(initialState?.positionKm)
    || !finiteVector(initialState?.velocityKmS)
  ) {
    return {
      stale: false,
      positionDriftKm: 0,
      velocityDriftKmS: 0,
      ageSec: 0,
    };
  }
  const positionDriftKm = length(subtract(initialState.positionKm, runtime.solutionStatePositionKm));
  const velocityDriftKmS = length(subtract(initialState.velocityKmS, runtime.solutionStateVelocityKmS));
  const ageSec = Number.isFinite(nowSec) && Number.isFinite(Number(runtime.solutionStateTimestampSec))
    ? Math.max(0, nowSec - Number(runtime.solutionStateTimestampSec))
    : 0;
  const phaseName = String(phase || "").trim();
  const nearBurn = (
    phaseName === "tli_burn"
    || phaseName === "lunar_insertion"
    || phaseName === "tei_burn"
    || phaseName === "earth_capture"
  );
  const positionLimitKm = nearBurn
    ? Math.max(25, 0.28 * Math.max(0, ageSec))
    : Math.max(250, 1.2 * Math.max(0, ageSec));
  const velocityLimitKmS = nearBurn
    ? 0.025
    : 0.08;
  return {
    stale: positionDriftKm > positionLimitKm || velocityDriftKmS > velocityLimitKmS,
    positionDriftKm,
    velocityDriftKmS,
    ageSec,
  };
}

function restoreClosedLoopSourceModelCache({
  runtime = null,
  sources = null,
  nowSec = Number.NaN,
} = {}) {
  if (!runtime || typeof runtime !== "object" || !sources || typeof sources !== "object") {
    return false;
  }
  return restoreMoonGuidanceSourceModelFromCache({
    sources,
    cachedSources: runtime.sourceModelCache,
    timestampSec: nowSec,
    cachedTimestampSec: runtime.sourceModelCacheTimestampSec,
  });
}

function storeClosedLoopSourceModelCache({
  runtime = null,
  sources = null,
  nowSec = Number.NaN,
} = {}) {
  if (!runtime || typeof runtime !== "object" || !sources || typeof sources !== "object") {
    return;
  }
  runtime.sourceModelCache = sources;
  runtime.sourceModelCacheTimestampSec = Number.isFinite(Number(nowSec))
    ? Number(nowSec)
    : runtime.sourceModelCacheTimestampSec;
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
  const cadenceSec = getMoonClosedLoopSolveCadenceSec(plannerConfig);
  let solvedThisStep = false;
  const workerResponse = runtime ? consumeMoonClosedLoopTransferSolveResult(runtime) : null;
  if (workerResponse) {
    if (!workerResponse.error) {
      storeClosedLoopSolveResult({
        runtime,
        solution: workerResponse.solution,
        initialState: {
          positionKm: finiteVector(workerResponse.initialStatePositionKm)
            ? workerResponse.initialStatePositionKm
            : initialState.positionKm,
          velocityKmS: finiteVector(workerResponse.initialStateVelocityKmS)
            ? workerResponse.initialStateVelocityKmS
            : initialState.velocityKmS,
        },
        nowSec: Number.isFinite(Number(workerResponse.solvedAtSec))
          ? Number(workerResponse.solvedAtSec)
          : nowSec,
        solveReason: workerResponse.solveReason,
      });
      runtime.workerErrorBackoffUntilSec = null;
      solvedThisStep = true;
    } else if (workerResponse.error) {
      runtime.lastSolveReason = `nbody-worker-error:${workerResponse.error}`;
      runtime.workerErrorBackoffUntilSec = Number.isFinite(nowSec)
        ? (nowSec + Math.max(60, cadenceSec))
        : runtime.workerErrorBackoffUntilSec;
    }
  }
  const lastSolveSec = finiteNumber(runtime?.lastSolveSec, Number.NaN);
  if (runtime && typeof runtime === "object") {
    runtime.solutionInvalidatedForStateDrift = false;
  }
  const solutionDrift = evaluateClosedLoopSolutionStateDrift({
    runtime,
    initialState,
    nowSec,
    phase,
  });
  if (runtime?.solution) {
    runtime.solutionStateDriftKm = solutionDrift.positionDriftKm;
    runtime.solutionStateDriftKmS = solutionDrift.velocityDriftKmS;
    runtime.solutionInvalidatedForStateDrift = Boolean(solutionDrift.stale);
    if (solutionDrift.stale) {
      runtime.solution = null;
      runtime.lastSolveReason = "nbody-solution-invalidated-estimate-drift";
    }
  }
  const solveDue = !runtime?.solution || !Number.isFinite(lastSolveSec) || !Number.isFinite(nowSec) || ((nowSec - lastSolveSec) >= cadenceSec);
  if (!solveDue && runtime?.solution) {
    return { solution: runtime.solution, solvedThisStep };
  }

  const workerBackoffActive = (
    Number.isFinite(Number(runtime?.workerErrorBackoffUntilSec))
    && Number.isFinite(nowSec)
    && nowSec < Number(runtime.workerErrorBackoffUntilSec)
  );
  if (runtime?.solution && runtime?.workerPending) {
    return { solution: runtime.solution, solvedThisStep };
  }
  if (
    runtime?.solution
    && !runtime?.workerPending
    && !workerBackoffActive
    && canUseMoonClosedLoopSolveWorker()
  ) {
    const workerRequested = requestMoonClosedLoopTransferSolve({
      runtime,
      payload: {
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
      },
    });
    if (workerRequested) {
      return { solution: runtime.solution, solvedThisStep };
    }
  }

  const best = solveBestClosedLoopTransferSync({
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
  });
  storeClosedLoopSolveResult({
    runtime,
    solution: best,
    initialState,
    nowSec,
    solveReason: best ? "nbody-closed-loop-optimal" : "nbody-no-solution",
  });
  return { solution: best, solvedThisStep: true };
}

function departureCorridorCompositeScore({
  predictedMissDistanceKm,
  predictedPeriluneAltitudeKm,
  bPlaneErrorKm,
  targetPeriluneAltitudeKm,
}) {
  const missKm = Number.isFinite(Number(predictedMissDistanceKm))
    ? Math.max(0, Number(predictedMissDistanceKm))
    : 1e12;
  const periluneKm = Number.isFinite(Number(predictedPeriluneAltitudeKm))
    ? Math.max(0, Number(predictedPeriluneAltitudeKm))
    : 1e12;
  const bPlaneKm = Number.isFinite(Number(bPlaneErrorKm))
    ? Math.max(0, Number(bPlaneErrorKm))
    : missKm;
  const targetPeriluneKm = Math.max(20, finiteNumber(targetPeriluneAltitudeKm, 120));
  return (
    missKm
    + (Math.abs(periluneKm - targetPeriluneKm) * 0.8)
    + (bPlaneKm * 0.55)
  );
}

function evaluateDepartureSeedTrack({
  seedPositionKm = null,
  seedVelocityKmS = null,
  currentPositionKm = null,
  currentVelocityKmS = null,
  sources = null,
  spacecraft = null,
  plannerConfig = {},
  departurePlanDirection = null,
  departurePlanThrottle = Number.NaN,
  departurePlanBurnDurationSec = Number.NaN,
  engineAccelAtThrottle1KmS2 = Number.NaN,
  missionPhaseElapsedSec = Number.NaN,
}) {
  if (
    !finiteVector(seedPositionKm)
    || !finiteVector(seedVelocityKmS)
    || !finiteVector(currentPositionKm)
    || !finiteVector(currentVelocityKmS)
    || !finiteVector(departurePlanDirection)
    || !Number.isFinite(departurePlanThrottle)
    || !Number.isFinite(departurePlanBurnDurationSec)
    || !Number.isFinite(engineAccelAtThrottle1KmS2)
    || !Number.isFinite(missionPhaseElapsedSec)
    || !(missionPhaseElapsedSec >= 0)
  ) {
    return {
      accepted: false,
      positionErrorKm: Number.NaN,
      velocityErrorKmS: Number.NaN,
    };
  }
  const trackingPropagation = propagateMoonGuidanceState({
    initialState: {
      positionKm: seedPositionKm,
      velocityKmS: seedVelocityKmS,
    },
    durationSec: missionPhaseElapsedSec,
    stepSec: Math.max(10, Math.min(60, finiteNumber(plannerConfig.moonClosedLoopPropagationStepSec, 30))),
    sources,
    spacecraft,
    burnCommand: {
      direction: departurePlanDirection,
      throttle: departurePlanThrottle,
      accelAtThrottle1KmS2: engineAccelAtThrottle1KmS2,
      burnDurationSec: departurePlanBurnDurationSec,
    },
  });
  const trackedState = trackingPropagation?.finalState || null;
  const positionErrorKm = trackedState?.positionKm
    ? length(subtract(currentPositionKm, trackedState.positionKm))
    : Number.NaN;
  const velocityErrorKmS = trackedState?.velocityKmS
    ? length(subtract(currentVelocityKmS, trackedState.velocityKmS))
    : Number.NaN;
  const positionToleranceKm = Math.max(
    40,
    Math.min(250, missionPhaseElapsedSec * 0.45),
  );
  const velocityToleranceKmS = Math.max(
    0.18,
    Math.min(0.45, 0.12 + (missionPhaseElapsedSec * 0.0008)),
  );
  return {
    accepted: (
      Number.isFinite(positionErrorKm)
      && Number.isFinite(velocityErrorKmS)
      && positionErrorKm <= positionToleranceKm
      && velocityErrorKmS <= velocityToleranceKmS
    ),
    positionErrorKm,
    velocityErrorKmS,
  };
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
        const burnDurationSec = burnDurationForDeltaVSec(deltaVNeedKmS, accelAtThrottle1KmS2, throttle, spacecraft);
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
  const {
    moonRuntime,
    estimatedPositionKm,
    estimatedVelocityKmS,
  } = prepareMoonMissionNavigationEstimate({
    plannerRuntime,
    targetVectors,
    metrics,
    plannerConfig,
    estimatorConfig,
    timestampSec,
  });
  const gncRuntime = ensureMoonGncRuntime(moonRuntime);
  if (!gncRuntime || !finiteVector(estimatedPositionKm) || !finiteVector(estimatedVelocityKmS)) {
    return null;
  }
  const navigationDiagnostics = buildNavigationQualityDiagnostics(moonRuntime?.filter);
  const nowSec = Number(timestampSec);
  const sources = buildMoonGuidanceSourceModel({ targetVectors, metrics, plannerConfig });
  restoreClosedLoopSourceModelCache({
    runtime: gncRuntime,
    sources,
    nowSec,
  });
  try {
    const stageMassKg = Math.max(1, finiteNumber(metrics.stageMassKg, metrics.massKg || 1));
    const rawStagePropellantKg = finiteNumber(metrics.stagePropellantKg, Number.NaN);
    const stagePropellantKg = Number.isFinite(rawStagePropellantKg)
      ? Math.max(0, rawStagePropellantKg)
      : Number.NaN;
    const fallbackDryMassKg = Number.isFinite(stagePropellantKg)
      ? Math.max(1, stageMassKg - stagePropellantKg)
      : Number.NaN;
    const stageDryMassKg = Math.max(
      1,
      finiteNumber(
        metrics.stageDryMassKg,
        finiteNumber(metrics.dryMassKg, fallbackDryMassKg),
      ),
    );
    const boundedDryMassKg = Math.min(stageMassKg, stageDryMassKg);
    const boundedPropellantMassKg = Number.isFinite(stagePropellantKg)
      ? Math.min(stagePropellantKg, Math.max(0, stageMassKg - boundedDryMassKg))
      : Math.max(0, stageMassKg - boundedDryMassKg);
    const spacecraft = {
      bodyId: String(metrics.bodyId || "earth_launch_vehicle"),
      massKg: stageMassKg,
      dryMassKg: boundedDryMassKg,
      propellantMassKg: boundedPropellantMassKg,
      thrustVacuumN: Math.max(0, finiteNumber(metrics.stageThrustVacuumN, 0)),
      thrustSeaLevelN: Math.max(
        0,
        finiteNumber(metrics.stageThrustSeaLevelN, metrics.stageThrustVacuumN),
      ),
      ispVacuumS: Math.max(0, finiteNumber(metrics.stageIspVacuumS, 0)),
      ispSeaLevelS: Math.max(
        0,
        finiteNumber(metrics.stageIspSeaLevelS, metrics.stageIspVacuumS),
      ),
      ambientPressurePa: Math.max(0, finiteNumber(metrics.ambientPressurePa, 0)),
      radiusKm: 0.0045,
      reflectivityCoeff: finiteNumber(metrics.reflectivityCoeff, 1.45),
    };
    const initialState = {
      positionKm: estimatedPositionKm,
      velocityKmS: estimatedVelocityKmS,
      massKg: spacecraft.massKg,
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
    const departureSeedPositionKm = finiteVector(targetVectors.departureSeedPositionKm)
    ? targetVectors.departureSeedPositionKm
    : null;
    const departureSeedVelocityKmS = finiteVector(targetVectors.departureSeedVelocityKmS)
    ? targetVectors.departureSeedVelocityKmS
    : null;
    const departurePlanPredictedMissDistanceKm = Number(metrics.departurePlanPredictedMissDistanceKm);
    const departurePlanPredictedPeriluneAltitudeKm = Number(metrics.departurePlanPredictedPeriluneAltitudeKm);
    const departurePlanBPlaneErrorKm = Number(metrics.departurePlanBPlaneErrorKm);
    const departurePlanGeometryScore = Number(metrics.departurePlanGeometryScore);
    const departurePlanAlignNow = Number(metrics.departurePlanAlignNow);
    const departurePlanCorridor = evaluateMoonDepartureCorridor({
    predictedMissDistanceKm: departurePlanPredictedMissDistanceKm,
    predictedPeriluneAltitudeKm: departurePlanPredictedPeriluneAltitudeKm,
    bPlaneErrorKm: departurePlanBPlaneErrorKm,
    plannerConfig,
    });
    const departurePlanGeometryAcceptable = !Number.isFinite(departurePlanGeometryScore)
    || departurePlanGeometryScore >= 0.55;
    const departurePlanAlignmentAcceptable = !Number.isFinite(departurePlanAlignNow)
    || departurePlanAlignNow >= 0.7;
    const departurePlanCorridorAcceptable = departurePlanCorridor.accepted;
    const departureCommitActive = (
    phaseName === "tli_burn"
    && Boolean(metrics.departurePlanReady)
    && finiteVector(departurePlanDirection)
    && Number.isFinite(departurePlanThrottle)
    && Number.isFinite(missionPhaseElapsedSec)
    && missionPhaseElapsedSec <= departurePlanCommitWindowSec
    && departurePlanGeometryAcceptable
    && departurePlanAlignmentAcceptable
    && departurePlanCorridorAcceptable
    );
    const departurePlanParityWindowSec = Math.max(
    Number.isFinite(departurePlanBurnDurationSec)
      ? departurePlanBurnDurationSec + 60
      : (departurePlanCommitWindowSec + 40),
    120,
  );
  let departureSeedTrack = {
    accepted: true,
    positionErrorKm: 0,
    velocityErrorKmS: 0,
  };
  if (phaseName === "tli_burn" && missionPhaseElapsedSec > departurePlanCommitWindowSec) {
    const trackCadenceSec = Math.max(
      10,
      Math.min(30, finiteNumber(plannerConfig.moonClosedLoopSolveCadenceSec, 20)),
    );
    const canReuseSeedTrack = (
      Number.isFinite(nowSec)
      && Number.isFinite(gncRuntime?.departureSeedTrackLastEvalSec)
      && ((nowSec - gncRuntime.departureSeedTrackLastEvalSec) < trackCadenceSec)
      && typeof gncRuntime?.departureSeedTrackAccepted === "boolean"
    );
    if (canReuseSeedTrack) {
      departureSeedTrack = {
        accepted: gncRuntime.departureSeedTrackAccepted,
        positionErrorKm: gncRuntime.departureSeedTrackPositionErrorKm,
        velocityErrorKmS: gncRuntime.departureSeedTrackVelocityErrorKmS,
      };
    } else {
      departureSeedTrack = evaluateDepartureSeedTrack({
        seedPositionKm: departureSeedPositionKm,
        seedVelocityKmS: departureSeedVelocityKmS,
        currentPositionKm: initialState.positionKm,
        currentVelocityKmS: initialState.velocityKmS,
        sources,
        spacecraft,
        plannerConfig,
        departurePlanDirection,
        departurePlanThrottle,
        departurePlanBurnDurationSec,
        engineAccelAtThrottle1KmS2,
        missionPhaseElapsedSec,
      });
      gncRuntime.departureSeedTrackAccepted = departureSeedTrack.accepted;
      gncRuntime.departureSeedTrackPositionErrorKm = departureSeedTrack.positionErrorKm;
      gncRuntime.departureSeedTrackVelocityErrorKmS = departureSeedTrack.velocityErrorKmS;
      gncRuntime.departureSeedTrackLastEvalSec = Number.isFinite(nowSec) ? nowSec : null;
    }
  }
  const departurePlanParityWindowActive = (
    phaseName === "tli_burn"
    && departurePlanCorridorAcceptable
    && finiteVector(departurePlanDirection)
    && Number.isFinite(missionPhaseElapsedSec)
    && missionPhaseElapsedSec <= departurePlanParityWindowSec
    && departureSeedTrack.accepted
  );
  const departureSeedTrackHardPositionToleranceKm = Math.max(
    1_500,
    Math.min(4_500, finiteNumber(missionPhaseElapsedSec, 0) * 6),
  );
  const departureSeedTrackHardVelocityToleranceKmS = Math.max(
    1.0,
    Math.min(2.2, 0.55 + (finiteNumber(missionPhaseElapsedSec, 0) * 0.002)),
  );
  const departureSeedTrackCatastrophic = (
    Number.isFinite(departureSeedTrack.positionErrorKm)
    && Number.isFinite(departureSeedTrack.velocityErrorKmS)
    && (
      departureSeedTrack.positionErrorKm > departureSeedTrackHardPositionToleranceKm
      || departureSeedTrack.velocityErrorKmS > departureSeedTrackHardVelocityToleranceKmS
    )
  );
  const departurePlanBurnLockActive = (
    phaseName === "tli_burn"
    && departurePlanCorridorAcceptable
    && finiteVector(departurePlanDirection)
    && Number.isFinite(missionPhaseElapsedSec)
    && Number.isFinite(departurePlanBurnDurationSec)
    && missionPhaseElapsedSec <= departurePlanBurnDurationSec
  );
  const ballisticCoastWeakClosingKmS = Math.max(
    0.2,
    finiteNumber(plannerConfig.moonMidcourseMinClosingSpeedKmS, 0.02) * 12,
  );
  const ballisticCoastMovingAway = Number.isFinite(moonClosingSpeedKmS)
    && moonClosingSpeedKmS < -0.02;
  const solvePlannerConfig = departurePlanParityWindowActive
    ? {
      ...plannerConfig,
      moonClosedLoopSolveCadenceSec: Math.min(
        20,
        Math.max(20, finiteNumber(plannerConfig.moonClosedLoopSolveCadenceSec, 120)),
      ),
      engineAccelAtThrottle1KmS2,
    }
    : {
      ...plannerConfig,
      engineAccelAtThrottle1KmS2,
    };
  if (phaseName === "coast_to_moon" && typeof window === "undefined") {
    solvePlannerConfig.moonClosedLoopSolveCadenceSec = Math.max(
      300,
      finiteNumber(solvePlannerConfig.moonClosedLoopSolveCadenceSec, 120),
    );
    solvePlannerConfig.moonClosedLoopPropagationStepSec = Math.min(
      300,
      Math.max(180, finiteNumber(solvePlannerConfig.moonClosedLoopPropagationStepSec, 90)),
    );
  }

  if (phaseName === "tli_burn" || phaseName === "coast_to_moon") {
    const shipEarthRadiusKm = length(initialState.positionKm);
    const nominalTransferSec = nominalTransferTimeSec(shipEarthRadiusKm, moonDistanceKm, EARTH_MU_KM3_S2);
    const nominalDeltaVKmS = nominalTliDeltaVEstimateKmS(shipEarthRadiusKm, moonDistanceKm, EARTH_MU_KM3_S2);
    const nominalPrimaryDirection = phaseName === "tli_burn"
      ? normalize(add(scale(tangent, 0.8), scale(toMoon, 0.2)), tangent)
      : normalize(add(scale(toMoon, 0.6), scale(tangent, 0.4)), toMoon);
    const solvePrimaryDirection = (
      phaseName === "tli_burn"
      && finiteVector(departurePlanDirection)
    )
      ? normalize(
        add(
          scale(
            departurePlanDirection,
            departureCommitActive ? 0.92 : 0.72,
          ),
          scale(
            nominalPrimaryDirection,
            departureCommitActive ? 0.08 : 0.28,
          ),
        ),
        departurePlanDirection,
      )
      : nominalPrimaryDirection;
    const solve = solveBestClosedLoopTransfer({
      initialState,
      sources,
      spacecraft,
      tangent,
      up,
      primaryDirection: solvePrimaryDirection,
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
      plannerConfig: solvePlannerConfig,
      phase: phaseName,
      nowSec,
      runtime: gncRuntime,
    });
    let best = solve.solution;
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
          ...navigationDiagnostics,
          requestedMode: "nbody-closed-loop-gnc",
          solveReady: false,
        },
      };
    }
    const {
      candidate: ballisticCoastCandidate,
      direction: ballisticCoastDirection,
    } = resolveBallisticCoastCandidate({
      runtime: gncRuntime,
      phaseName,
      nowSec,
      initialState,
      sources,
      spacecraft,
      toMoon,
      tangent,
      periapsisMinKm,
      moonDistanceKm,
      plannerConfig: solvePlannerConfig,
    });
    const ballisticCoastCorridorAcceptable = (
      ballisticCoastCandidate
      && ballisticCoastCandidate.predictedMissDistanceKm <= Math.max(
        missGateKm,
        Math.max(16_000, finiteNumber(departurePlanPredictedMissDistanceKm, 8_000) * 2.2),
      )
      && ballisticCoastCandidate.predictedPeriluneAltitudeKm <= Math.max(
        Math.max(20_000, finiteNumber(plannerConfig.moonCaptureUpperAltitudeKm, 16_000) * 1.1),
        finiteNumber(departurePlanPredictedPeriluneAltitudeKm, 280) + 14_000,
      )
      && ballisticCoastCandidate.bPlaneErrorKm <= Math.max(
        Math.max(100, finiteNumber(plannerConfig.moonBPlaneToleranceKm, 6_000)) * 1.25,
        Math.max(8_000, finiteNumber(departurePlanBPlaneErrorKm, 2_500) * 2.5),
      )
      && (
        !Number.isFinite(ballisticCoastCandidate.closestClosingSpeedKmS)
        || ballisticCoastCandidate.closestClosingSpeedKmS >= ballisticCoastWeakClosingKmS
      )
    );
    let aggressiveCoastRescueUsed = false;
    const browserCoastRuntime = typeof window !== "undefined" && canUseMoonClosedLoopSolveWorker();
    if (phaseName === "coast_to_moon") {
      const coastRescueNeeded = (
        !ballisticCoastCorridorAcceptable
        && (
          ballisticCoastMovingAway
          || best.predictedMissDistanceKm > Math.max(
            missGateKm * 1.35,
            Math.max(75_000, finiteNumber(departurePlanPredictedMissDistanceKm, 8_000) * 4),
          )
          || best.predictedPeriluneAltitudeKm > Math.max(
            24_000,
            finiteNumber(departurePlanPredictedPeriluneAltitudeKm, 280) + 20_000,
          )
          || best.bPlaneErrorKm > Math.max(
            Math.max(100, finiteNumber(plannerConfig.moonBPlaneToleranceKm, 6_000)) * 1.6,
            Math.max(12_000, finiteNumber(departurePlanBPlaneErrorKm, 2_500) * 4),
          )
          || (
            Number.isFinite(best.closestClosingSpeedKmS)
            && best.closestClosingSpeedKmS < ballisticCoastWeakClosingKmS
          )
        )
      );
      if (coastRescueNeeded && !browserCoastRuntime) {
        const aggressiveCoastPlannerConfig = {
          ...solvePlannerConfig,
          moonClosedLoopDvOffsetsKmS: [-0.22, -0.08, 0, 0.18, 0.4, 0.72, 1.0],
          moonClosedLoopRadialOffsets: [-0.18, -0.08, 0, 0.08, 0.18],
          moonClosedLoopNormalOffsets: [-0.1, -0.04, 0, 0.04, 0.1],
          moonClosedLoopPropagationStepSec: Math.min(
            300,
            Math.max(60, finiteNumber(solvePlannerConfig.moonClosedLoopPropagationStepSec, 180)),
          ),
        };
        const aggressiveNominalDeltaVKmS = Math.max(
          0.24,
          Math.min(
            1.4,
            Math.max(
              finiteNumber(best.deltaVNeedKmS, 0) * 1.8,
              nominalDeltaVKmS * 1.4,
              0.55,
            ),
          ),
        );
        const aggressivePredictDurationsSec = [
          Math.max(6 * 3600, nominalTransferSec * 0.3),
          Math.max(12 * 3600, nominalTransferSec * 0.45),
          Math.max(18 * 3600, nominalTransferSec * 0.65),
        ];
        const aggressivePrimaryDirection = normalize(
          add(scale(toMoon, 0.88), scale(tangent, 0.12)),
          toMoon,
        );
        const aggressiveBest = solveBestClosedLoopTransferSync({
          initialState,
          sources,
          spacecraft,
          tangent,
          up,
          primaryDirection: aggressivePrimaryDirection,
          targetBodyId: "moon",
          targetBodyRadiusKm: Number(sources?.moon?.radiusKm) || DEFAULT_MOON_RADIUS_KM,
          targetDistanceKm: moonDistanceKm,
          targetPeriluneAltitudeKm: Math.max(20, finiteNumber(plannerConfig.moonTargetPeriluneAltitudeKm, 120)),
          safetyBodyId: "earth",
          safetyMinAltitudeKm: periapsisMinKm,
          nominalDeltaVKmS: aggressiveNominalDeltaVKmS,
          predictDurationsSec: aggressivePredictDurationsSec,
          plannerConfig: aggressiveCoastPlannerConfig,
          phase: phaseName,
        });
        if (
          aggressiveBest
          && (
            !best
            || aggressiveBest.cost < (best.cost * 0.92)
            || best.predictedMissDistanceKm > Math.max(150_000, aggressiveBest.predictedMissDistanceKm * 1.8)
            || best.bPlaneErrorKm > Math.max(40_000, aggressiveBest.bPlaneErrorKm * 1.8)
          )
        ) {
          best = aggressiveBest;
          aggressiveCoastRescueUsed = true;
        }
      }
    }
    const bestDiagnosticsScore = departureCorridorCompositeScore({
      predictedMissDistanceKm: best.predictedMissDistanceKm,
      predictedPeriluneAltitudeKm: best.predictedPeriluneAltitudeKm,
      bPlaneErrorKm: best.bPlaneErrorKm,
      targetPeriluneAltitudeKm: Math.max(20, finiteNumber(plannerConfig.moonTargetPeriluneAltitudeKm, 120)),
    });
    const departurePlanDiagnosticsScore = departureCorridorCompositeScore({
      predictedMissDistanceKm: departurePlanPredictedMissDistanceKm,
      predictedPeriluneAltitudeKm: departurePlanPredictedPeriluneAltitudeKm,
      bPlaneErrorKm: departurePlanBPlaneErrorKm,
      targetPeriluneAltitudeKm: Math.max(20, finiteNumber(plannerConfig.moonTargetPeriluneAltitudeKm, 120)),
    });
    const departurePlanRescueActive = (
      phaseName === "tli_burn"
      && departurePlanCorridorAcceptable
      && finiteVector(departurePlanDirection)
      && Number.isFinite(missionPhaseElapsedSec)
      && Number.isFinite(departurePlanBurnDurationSec)
      && missionPhaseElapsedSec <= (departurePlanBurnDurationSec + 30)
      && !departureSeedTrackCatastrophic
      && best.predictedMissDistanceKm > Math.max(
        missGateKm * 2.1,
        Math.max(40_000, departurePlanPredictedMissDistanceKm * 8),
      )
      && best.predictedPeriluneAltitudeKm > Math.max(
        20_000,
        departurePlanPredictedPeriluneAltitudeKm + 50_000,
      )
      && best.bPlaneErrorKm > Math.max(
        Math.max(100, finiteNumber(plannerConfig.moonBPlaneToleranceKm, 6_000)) * 4,
        Math.max(20_000, departurePlanBPlaneErrorKm * 8),
      )
    );
    const departurePlanDominates = (
      departurePlanBurnLockActive
      || (
        departurePlanParityWindowActive
        && departurePlanDiagnosticsScore <= (bestDiagnosticsScore * 0.55)
      )
      || departurePlanRescueActive
    );
    const earlyCoastDepartureBridgeActive = shouldBridgeDeparturePlanIntoEarlyCoast({
      phaseName,
      missionPhaseElapsedSec,
      moonClosingSpeedKmS,
      predictedMissDistanceKm: best.predictedMissDistanceKm,
      predictedPeriluneAltitudeKm: best.predictedPeriluneAltitudeKm,
      bPlaneErrorKm: best.bPlaneErrorKm,
      departurePlanCorridorAcceptable,
      departurePlanDirection,
      departurePlanPredictedMissDistanceKm,
      departurePlanPredictedPeriluneAltitudeKm,
      departurePlanBPlaneErrorKm,
      missGateKm,
      plannerConfig,
    });
    const bestCorridorAcceptable = (
      phaseName === "coast_to_moon"
      && isMoonCorridorAcceptable({
        predictedMissDistanceKm: best.predictedMissDistanceKm,
        predictedPeriluneAltitudeKm: best.predictedPeriluneAltitudeKm,
        bPlaneErrorKm: best.bPlaneErrorKm,
        plannerConfig,
        missGateKm,
      })
    );
    const bestImprovesCommittedDeparturePlan = (
      phaseName === "coast_to_moon"
      && departurePlanCorridorAcceptable
      && bestCorridorAcceptable
      && doesMoonCorridorCandidateImproveCommittedPlan({
        candidatePredictedMissDistanceKm: best.predictedMissDistanceKm,
        candidatePredictedPeriluneAltitudeKm: best.predictedPeriluneAltitudeKm,
        candidateBPlaneErrorKm: best.bPlaneErrorKm,
        departurePlanPredictedMissDistanceKm,
        departurePlanPredictedPeriluneAltitudeKm,
        departurePlanBPlaneErrorKm,
        plannerConfig,
      })
    );
    const ballisticCoastImprovesCommittedDeparturePlan = (
      phaseName === "coast_to_moon"
      && departurePlanCorridorAcceptable
      && ballisticCoastCandidate
      && ballisticCoastCorridorAcceptable
      && doesMoonCorridorCandidateImproveCommittedPlan({
        candidatePredictedMissDistanceKm: ballisticCoastCandidate.predictedMissDistanceKm,
        candidatePredictedPeriluneAltitudeKm: ballisticCoastCandidate.predictedPeriluneAltitudeKm,
        candidateBPlaneErrorKm: ballisticCoastCandidate.bPlaneErrorKm,
        departurePlanPredictedMissDistanceKm,
        departurePlanPredictedPeriluneAltitudeKm,
        departurePlanBPlaneErrorKm,
        plannerConfig,
      })
    );
    const committedDepartureCorridorPreferred = (
      phaseName === "coast_to_moon"
      && departurePlanCorridorAcceptable
      && finiteVector(departurePlanDirection)
      && Number.isFinite(moonClosingSpeedKmS)
      && moonClosingSpeedKmS > Math.max(
        0.02,
        finiteNumber(plannerConfig?.moonMidcourseMinClosingSpeedKmS, 0.02),
      )
      && !ballisticCoastMovingAway
      && !bestImprovesCommittedDeparturePlan
      && !ballisticCoastImprovesCommittedDeparturePlan
    );
    const missFarFromGate = best.predictedMissDistanceKm > (missGateKm * 2.1);
    const movingAwayFromMoon = moonClosingSpeedKmS < -0.02;
    const missDiverging = missTrendKmS > 0.08;
    const tliReacquireHold = phaseName === "tli_burn"
      && missFarFromGate
      && (movingAwayFromMoon || missDiverging)
      && !nearPeriapsisBurnWindow
      && !departureCommitActive
      && !departurePlanDominates;
    const useDeparturePlanDiagnostics = (
      (
        phaseName === "tli_burn"
        && (departureCommitActive || departurePlanDominates)
        && departurePlanCorridorAcceptable
        && departurePlanDiagnosticsScore <= bestDiagnosticsScore
      )
      || earlyCoastDepartureBridgeActive
      || committedDepartureCorridorPreferred
    );
    const useBallisticCoastDiagnostics = (
      phaseName === "coast_to_moon"
      && ballisticCoastCandidate
      && !ballisticCoastMovingAway
      && ballisticCoastCorridorAcceptable
      && (
        !best
        || best.deltaVNeedKmS <= 0.05
        || ballisticCoastCandidate.cost <= (best.cost * 1.18)
      )
    );

    const effectivePredictedMissDistanceKm = useBallisticCoastDiagnostics
      ? ballisticCoastCandidate.predictedMissDistanceKm
      : (useDeparturePlanDiagnostics
        ? departurePlanPredictedMissDistanceKm
        : best.predictedMissDistanceKm);
    const effectivePredictedPeriluneAltitudeKm = useBallisticCoastDiagnostics
      ? ballisticCoastCandidate.predictedPeriluneAltitudeKm
      : (useDeparturePlanDiagnostics
        ? departurePlanPredictedPeriluneAltitudeKm
        : best.predictedPeriluneAltitudeKm);
    const effectiveBPlaneErrorKm = useBallisticCoastDiagnostics
      ? ballisticCoastCandidate.bPlaneErrorKm
      : (useDeparturePlanDiagnostics
        ? departurePlanBPlaneErrorKm
        : best.bPlaneErrorKm);
    const effectiveBurnDurationSec = (
      departureCommitActive && Number.isFinite(departurePlanBurnDurationSec)
        ? departurePlanBurnDurationSec
        : best.burnDurationSec
    );
    const passiveCoastEligibility = evaluateMoonPassiveCoastEligibility({
      phaseName,
      predictedMissDistanceKm: effectivePredictedMissDistanceKm,
      predictedPeriluneAltitudeKm: effectivePredictedPeriluneAltitudeKm,
      bPlaneErrorKm: effectiveBPlaneErrorKm,
      deltaVNeedKmS: best.deltaVNeedKmS,
      moonClosingSpeedKmS,
      missTrendKmS,
      plannerConfig,
      missGateKm,
    });

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
    if (departureCommitActive || departurePlanDominates) {
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
        mode: departureCommitActive
          ? "navsys:gnc-lambert-tli-burn+departure-commit+diffcorr"
          : "navsys:gnc-lambert-tli-burn+seed-lock+diffcorr",
      };
    } else if (tliReacquireHold) {
      command = {
        phase: "coast",
        throttle: 0,
        direction: normalize(add(scale(toMoon, 0.74), scale(tangent, 0.26)), toMoon),
        mode: "navsys:gnc-lambert-tli-hold",
      };
    } else if (earlyCoastDepartureBridgeActive) {
      command = {
        phase: "coast",
        throttle: 0,
        direction: normalize(
          add(
            scale(departurePlanDirection, 0.82),
            scale(toMoon, 0.18),
          ),
          departurePlanDirection,
        ),
        mode: "navsys:gnc-lambert-midcourse-coast",
      };
    } else if (committedDepartureCorridorPreferred) {
      command = {
        phase: "coast",
        throttle: 0,
        direction: normalize(
          add(
            scale(departurePlanDirection, 0.78),
            scale(toMoon, 0.22),
          ),
          departurePlanDirection,
        ),
        mode: "navsys:gnc-lambert-midcourse-coast",
      };
    } else if (useBallisticCoastDiagnostics) {
      command = {
        phase: "coast",
        throttle: 0,
        direction: ballisticCoastDirection,
        mode: "navsys:gnc-lambert-midcourse-coast",
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
        mode: "navsys:gnc-lambert-midcourse-coast",
      };
    } else if (passiveCoastEligibility.allowPassiveCoast) {
      command = {
        phase: "coast",
        throttle: 0,
        direction: normalize(add(scale(toMoon, 0.8), scale(tangent, 0.2)), toMoon),
        mode: phaseName === "tli_burn"
          ? "navsys:gnc-lambert-tli-hold"
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
    if (phaseName === "coast_to_moon") {
      const lockWindowSec = Math.max(
        90,
        Math.min(360, finiteNumber(plannerConfig.moonCoastCorrectionLockSec, 180)),
      );
      const lastLockedMode = String(gncRuntime.coastCorrectionMode || "").trim();
      const lastLockSetAtSec = finiteNumber(gncRuntime.coastCorrectionModeSetAtSec, Number.NaN);
      const lockElapsedSec = (
        Number.isFinite(nowSec) && Number.isFinite(lastLockSetAtSec)
      )
        ? Math.max(0, nowSec - lastLockSetAtSec)
        : Number.POSITIVE_INFINITY;
      const desiredMode = command.phase === "coast" ? "coast" : "correction";
      const effectiveCorridorAcceptable = isMoonCorridorAcceptable({
        predictedMissDistanceKm: effectivePredictedMissDistanceKm,
        predictedPeriluneAltitudeKm: effectivePredictedPeriluneAltitudeKm,
        bPlaneErrorKm: effectiveBPlaneErrorKm,
        plannerConfig,
        missGateKm,
      });
      const lockedCoastCorridorAcceptable = isMoonCorridorAcceptable({
        predictedMissDistanceKm: gncRuntime.predictedMissDistanceKm,
        predictedPeriluneAltitudeKm: gncRuntime.predictedPeriluneAltitudeKm,
        bPlaneErrorKm: gncRuntime.bPlaneErrorKm,
        plannerConfig,
        missGateKm,
      });
      const correctionCandidateCorridorAcceptable = isMoonCorridorAcceptable({
        predictedMissDistanceKm: best.predictedMissDistanceKm,
        predictedPeriluneAltitudeKm: best.predictedPeriluneAltitudeKm,
        bPlaneErrorKm: best.bPlaneErrorKm,
        plannerConfig,
        missGateKm,
      });
      const correctionImprovesLockedCoast = (
        lastLockedMode === "coast"
        && lockedCoastCorridorAcceptable
        && correctionCandidateCorridorAcceptable
        && doesMoonCorridorCandidateImproveCommittedPlan({
          candidatePredictedMissDistanceKm: best.predictedMissDistanceKm,
          candidatePredictedPeriluneAltitudeKm: best.predictedPeriluneAltitudeKm,
          candidateBPlaneErrorKm: best.bPlaneErrorKm,
          departurePlanPredictedMissDistanceKm: gncRuntime.predictedMissDistanceKm,
          departurePlanPredictedPeriluneAltitudeKm: gncRuntime.predictedPeriluneAltitudeKm,
          departurePlanBPlaneErrorKm: gncRuntime.bPlaneErrorKm,
          plannerConfig,
        })
      );
      const catastrophicCorrectionBreak = (
        ballisticCoastMovingAway
        || (
          !effectiveCorridorAcceptable
          && (
            (
              Number.isFinite(best.closestClosingSpeedKmS)
              && best.closestClosingSpeedKmS < 0.001
            )
            || (
              Number.isFinite(moonClosingSpeedKmS)
              && moonClosingSpeedKmS < 0.005
            )
          )
        )
      );
      const lateCoastRescueRequired = (
        Number.isFinite(missionPhaseElapsedSec)
        && missionPhaseElapsedSec >= Math.max(
          1800,
          finiteNumber(plannerConfig?.moonCoastCorrectionReleaseSec, 1800),
        )
        && (
          ballisticCoastMovingAway
          || passiveCoastEligibility.diverging
          || passiveCoastEligibility.weakClosing
        )
      );
      const stableCoastRelease = (
        command.phase === "coast"
        && effectiveCorridorAcceptable
        && !ballisticCoastMovingAway
        && !passiveCoastEligibility.diverging
        && !passiveCoastEligibility.weakClosing
        && Number.isFinite(moonClosingSpeedKmS)
        && moonClosingSpeedKmS > Math.max(
          0.05,
          finiteNumber(plannerConfig?.moonMidcourseMinClosingSpeedKmS, 0.02) * 2.0,
        )
      );
      if (
        lastLockedMode === "coast"
        && desiredMode === "correction"
        && !catastrophicCorrectionBreak
        && !lateCoastRescueRequired
        && !correctionImprovesLockedCoast
      ) {
        command = {
          phase: "coast",
          throttle: 0,
          direction: selectMoonCoastDirection({
            useBallisticCoastDiagnostics,
            ballisticCoastDirection,
            earlyCoastDepartureBridgeActive,
            committedDepartureCorridorPreferred,
            departurePlanDirection,
            toMoon,
            tangent,
          }),
          mode: "navsys:gnc-lambert-midcourse-coast",
        };
      } else if (
        lastLockedMode === "correction"
        && desiredMode === "coast"
        && lockElapsedSec < lockWindowSec
        && !stableCoastRelease
      ) {
        command = {
          phase: "powered",
          throttle: clamp(
            finiteNumber(best.throttle, 0),
            finiteNumber(plannerConfig.moonClosedLoopThrottleMin, 0.08),
            finiteNumber(plannerConfig.moonClosedLoopThrottleMax, 0.78),
          ),
          direction: normalize(best.burnDirection, toMoon),
          mode: "navsys:gnc-lambert-midcourse-correction",
        };
      }
      const finalMode = command.phase === "coast" ? "coast" : "correction";
      if (finalMode !== lastLockedMode || !lastLockedMode) {
        gncRuntime.coastCorrectionMode = finalMode;
        gncRuntime.coastCorrectionModeSetAtSec = Number.isFinite(nowSec) ? nowSec : null;
      }
    } else {
      gncRuntime.coastCorrectionMode = "";
      gncRuntime.coastCorrectionModeSetAtSec = null;
    }
    if (aggressiveCoastRescueUsed && phaseName === "coast_to_moon" && command.phase === "powered") {
      command.mode = `${command.mode}+rescue`;
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
        ...navigationDiagnostics,
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
        departureSeedTrackAccepted: departureSeedTrack.accepted,
        departureSeedTrackPositionErrorKm: Number.isFinite(departureSeedTrack.positionErrorKm)
          ? departureSeedTrack.positionErrorKm
          : null,
        departureSeedTrackVelocityErrorKmS: Number.isFinite(departureSeedTrack.velocityErrorKmS)
          ? departureSeedTrack.velocityErrorKmS
          : null,
        departureSeedTrackCatastrophic,
        departurePlanCorridorAccepted: departurePlanCorridorAcceptable,
        departurePlanRescueActive,
        earlyCoastDepartureBridgeActive,
        committedDepartureCorridorPreferred,
        bestImprovesCommittedDeparturePlan,
        ballisticCoastImprovesCommittedDeparturePlan,
        ballisticCoastTrackActive: useBallisticCoastDiagnostics,
        coastCorridorAccepted: passiveCoastEligibility.corridorAccepted,
        coastCorridorWeakClosing: passiveCoastEligibility.weakClosing,
        coastCorridorDiverging: passiveCoastEligibility.diverging,
        solutionStateDriftKm: Number.isFinite(Number(gncRuntime.solutionStateDriftKm))
          ? Number(gncRuntime.solutionStateDriftKm)
          : null,
        solutionStateDriftKmS: Number.isFinite(Number(gncRuntime.solutionStateDriftKmS))
          ? Number(gncRuntime.solutionStateDriftKmS)
          : null,
        solutionInvalidatedForStateDrift: Boolean(gncRuntime.solutionInvalidatedForStateDrift),
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
        ...navigationDiagnostics,
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
        solutionStateDriftKm: Number.isFinite(Number(gncRuntime.solutionStateDriftKm))
          ? Number(gncRuntime.solutionStateDriftKm)
          : null,
        solutionStateDriftKmS: Number.isFinite(Number(gncRuntime.solutionStateDriftKmS))
          ? Number(gncRuntime.solutionStateDriftKmS)
          : null,
        solutionInvalidatedForStateDrift: Boolean(gncRuntime.solutionInvalidatedForStateDrift),
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
        ...navigationDiagnostics,
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
      diagnostics: {
        ...navigationDiagnostics,
        requestedMode: "nbody-lunar-orbit-hold",
      },
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
        ...navigationDiagnostics,
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
  } finally {
    storeClosedLoopSourceModelCache({
      runtime: gncRuntime,
      sources,
      nowSec,
    });
  }
}
