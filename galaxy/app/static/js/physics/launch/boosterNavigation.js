import { createNavigationStateEstimator } from "../navigation_system/navigationStateEstimator.js";
import {
  add,
  clamp,
  scale,
  subtract,
} from "./launchMath.js";
import { computeBoosterCatchRelativeState } from "./launchSiteCatchGeometry.js?v=20260424b";

function waveNoise(seed = 0, timeSec = 0) {
  const phase = (Number(seed) || 0) * 1.61803398875;
  const time = Number(timeSec) || 0;
  const sample = (
    Math.sin((time * 0.19) + phase)
    + (0.65 * Math.cos((time * 0.47) + (phase * 0.61)))
    + (0.35 * Math.sin((time * 0.83) + (phase * 1.27)))
  );
  return sample / 2.0;
}

function vectorNoise(sigma = 0, timeSec = 0, seed = 0) {
  const magnitude = Math.max(0, Number(sigma) || 0);
  return {
    x: magnitude * waveNoise(seed + 0.3, timeSec),
    y: magnitude * waveNoise(seed + 1.1, timeSec),
    z: magnitude * waveNoise(seed + 2.7, timeSec),
  };
}

function basisNoise({
  sigma = 0,
  timeSec = 0,
  seed = 0,
  eastAxis = { x: 1, y: 0, z: 0 },
  northAxis = { x: 0, y: 1, z: 0 },
  upAxis = { x: 0, y: 0, z: 1 },
}) {
  const magnitude = Math.max(0, Number(sigma) || 0);
  return add(
    scale(eastAxis, magnitude * waveNoise(seed + 0.2, timeSec)),
    add(
      scale(northAxis, magnitude * waveNoise(seed + 1.4, timeSec)),
      scale(upAxis, magnitude * waveNoise(seed + 2.8, timeSec)),
    ),
  );
}

function estimateWorldState(snapshot = null, earthState = null, fallbackState = null) {
  if (snapshot?.position && snapshot?.velocity && earthState?.position) {
    return {
      position: add(earthState.position, snapshot.position),
      velocity: add(
        earthState.velocity || { x: 0, y: 0, z: 0 },
        snapshot.velocity,
      ),
    };
  }
  if (fallbackState?.position && fallbackState?.velocity) {
    return {
      position: { ...fallbackState.position },
      velocity: { ...fallbackState.velocity },
    };
  }
  return null;
}

function estimateRelativeCatchState(snapshot = null, catchFrame = null, fallbackState = null) {
  if (snapshot?.position && snapshot?.velocity && catchFrame?.centerPosition) {
    return computeBoosterCatchRelativeState({
      boosterState: {
        position: add(catchFrame.centerPosition, snapshot.position),
        velocity: add(
          catchFrame.centerVelocity || { x: 0, y: 0, z: 0 },
          snapshot.velocity,
        ),
      },
      catchFrame,
    });
  }
  return fallbackState || null;
}

export function createBoosterNavigationState() {
  return {
    globalEstimator: createNavigationStateEstimator({
      positionBlend: 0.26,
      velocityBlend: 0.34,
      measurementPositionSigmaKm: 0.030,
      measurementVelocitySigmaKmS: 0.00018,
      processPositionSigmaKmPerSec: 0.00014,
      processVelocitySigmaKmSPerSec: 0.000018,
    }),
    catchEstimator: createNavigationStateEstimator({
      positionBlend: 0.58,
      velocityBlend: 0.82,
      measurementPositionSigmaKm: 0.0025,
      measurementVelocitySigmaKmS: 0.00005,
      processPositionSigmaKmPerSec: 0.00005,
      processVelocitySigmaKmSPerSec: 0.00001,
    }),
    lastCatchRelativePositionKm: null,
    lastCatchTimestampSec: null,
    solution: null,
  };
}

export function resetBoosterNavigationState(state = null) {
  const nextState = state && typeof state === "object"
    ? state
    : createBoosterNavigationState();
  nextState.globalEstimator?.reset?.();
  nextState.catchEstimator?.reset?.();
  nextState.lastCatchRelativePositionKm = null;
  nextState.lastCatchTimestampSec = null;
  nextState.solution = null;
  return nextState;
}

export function updateBoosterNavigationState({
  navigationState = null,
  boosterState = null,
  earthState = null,
  catchFrame = null,
  elapsedSec = 0,
  altitudeKm = 0,
  dynamicPressurePa = 0,
} = {}) {
  const state = navigationState && typeof navigationState === "object"
    ? navigationState
    : createBoosterNavigationState();
  if (!boosterState?.position || !boosterState?.velocity || !earthState?.position) {
    state.solution = null;
    return null;
  }

  const timestampSec = Math.max(0, Number(elapsedSec) || 0);
  const truthRelPositionKm = subtract(boosterState.position, earthState.position);
  const truthRelVelocityKmS = subtract(
    boosterState.velocity,
    earthState.velocity || { x: 0, y: 0, z: 0 },
  );
  const altitudeNorm = clamp((Number(altitudeKm) || 0) / 95, 0, 1);
  const qNorm = clamp((Number(dynamicPressurePa) || 0) / 28_000, 0, 1);

  const gnssPositionSigmaKm = 0.010 + (0.030 * altitudeNorm) + (0.004 * qNorm);
  const gnssVelocitySigmaKmS = 0.00003 + (0.00022 * altitudeNorm) + (0.00003 * qNorm);
  const measuredRelPositionKm = add(
    truthRelPositionKm,
    vectorNoise(gnssPositionSigmaKm, timestampSec, 9),
  );
  const measuredRelVelocityKmS = add(
    truthRelVelocityKmS,
    vectorNoise(gnssVelocitySigmaKmS, timestampSec, 19),
  );

  state.globalEstimator.update({
    position: measuredRelPositionKm,
    velocity: measuredRelVelocityKmS,
    nextTimestampSec: timestampSec,
  });

  const globalSnapshot = state.globalEstimator.snapshot();
  const estimatedBoosterState = estimateWorldState(globalSnapshot, earthState, boosterState);

  const truthCatchRelativeState = catchFrame
    ? computeBoosterCatchRelativeState({ boosterState, catchFrame })
    : null;
  let estimatedCatchRelativeState = catchFrame
    ? computeBoosterCatchRelativeState({
      boosterState: estimatedBoosterState || boosterState,
      catchFrame,
    })
    : null;
  let source = "imu+gnss";
  let towerRelativeActive = false;
  let catchSnapshot = null;

  if (catchFrame && truthCatchRelativeState) {
    const towerAvailable = (
      (
        truthCatchRelativeState.totalRangeKm <= 45
        && Math.max(0, Number(altitudeKm) || 0) <= 34
      )
      || (
        truthCatchRelativeState.lateralRangeKm <= 18
        && Math.abs(Number(truthCatchRelativeState.verticalErrorKm) || 0) <= 120
        && Math.max(0, Number(altitudeKm) || 0) <= 120
      )
    );
    if (towerAvailable) {
      const rangeNorm = clamp(truthCatchRelativeState.totalRangeKm / 45, 0, 1);
      const towerPositionSigmaKm = 0.0012 + (0.0042 * rangeNorm);
      const towerVelocitySigmaKmS = 0.000015 + (0.00007 * rangeNorm);
      const positionNoiseKm = basisNoise({
        sigma: towerPositionSigmaKm,
        timeSec: timestampSec,
        seed: 31,
        eastAxis: truthCatchRelativeState.eastAxisKm,
        northAxis: truthCatchRelativeState.northAxisKm,
        upAxis: truthCatchRelativeState.upAxisKm,
      });
      const velocityNoiseKmS = basisNoise({
        sigma: towerVelocitySigmaKmS,
        timeSec: timestampSec,
        seed: 43,
        eastAxis: truthCatchRelativeState.eastAxisKm,
        northAxis: truthCatchRelativeState.northAxisKm,
        upAxis: truthCatchRelativeState.upAxisKm,
      });
      let measuredCatchRelativeVelocityKmS = truthCatchRelativeState.relativeVelocityKmS;
      const previousCatchPosition = state.lastCatchRelativePositionKm;
      const previousCatchTimestampSec = Number(state.lastCatchTimestampSec);
      const catchDtSec = timestampSec - previousCatchTimestampSec;
      if (
        previousCatchPosition
        && Number.isFinite(catchDtSec)
        && catchDtSec > 1e-4
        && catchDtSec < 1.0
      ) {
        const positionRateVelocityKmS = scale(
          subtract(truthCatchRelativeState.relativePositionKm, previousCatchPosition),
          1 / catchDtSec,
        );
        measuredCatchRelativeVelocityKmS = add(
          scale(positionRateVelocityKmS, 0.90),
          scale(truthCatchRelativeState.relativeVelocityKmS, 0.10),
        );
      }
      state.lastCatchRelativePositionKm = { ...truthCatchRelativeState.relativePositionKm };
      state.lastCatchTimestampSec = timestampSec;
      state.catchEstimator.update({
        position: add(truthCatchRelativeState.relativePositionKm, positionNoiseKm),
        velocity: add(measuredCatchRelativeVelocityKmS, velocityNoiseKmS),
        nextTimestampSec: timestampSec,
      });
      catchSnapshot = state.catchEstimator.snapshot();
      estimatedCatchRelativeState = estimateRelativeCatchState(
        catchSnapshot,
        catchFrame,
        estimatedCatchRelativeState,
      );
      source = "imu+gnss+tower-relative";
      towerRelativeActive = true;
    } else {
      state.catchEstimator.predict(timestampSec);
      state.lastCatchRelativePositionKm = null;
      state.lastCatchTimestampSec = null;
    }
  }

  state.solution = {
    source,
    estimatedBoosterState,
    globalSnapshot,
    catchSnapshot,
    catchRelativeState: estimatedCatchRelativeState,
    towerRelativeActive,
    positionSigmaKm: Number(globalSnapshot?.positionSigmaKm) || null,
    velocitySigmaKmS: Number(globalSnapshot?.velocitySigmaKmS) || null,
    catchPositionSigmaKm: Number(catchSnapshot?.positionSigmaKm) || null,
    catchVelocitySigmaKmS: Number(catchSnapshot?.velocitySigmaKmS) || null,
  };
  return state.solution;
}
