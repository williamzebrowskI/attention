import { LAUNCH_REALISM_CONFIG } from "./launchRealismConfig.js";
import {
  angleBetweenRadians,
  clamp,
  degrees,
  mixVectors,
  normalize,
  rad,
} from "./launchMath.js";

function linearInterpolate(a, b, t) {
  const tt = clamp(Number(t) || 0, 0, 1);
  return a + ((b - a) * tt);
}

export function createActuatorState(initialDirection = { x: 0, y: 0, z: 1 }) {
  const direction = normalize(initialDirection, { x: 0, y: 0, z: 1 });
  return {
    throttleCommand: 0,
    throttleActual: 0,
    directionCommand: direction,
    directionActual: direction,
    gimbalErrorDeg: 0,
  };
}

export function createMassModelState() {
  return {
    comNormalized: 0.5,
    inertiaNormalized: 1,
    controlAuthorityScale: 1,
  };
}

export function updateMassModelState(model, {
  propellantFraction = 1,
  bodyKind = "stage1",
  dtSeconds = 0,
}) {
  const state = model || createMassModelState();
  const propFrac = clamp(Number(propellantFraction) || 0, 0, 1);
  const burnFrac = 1 - propFrac;
  let comStart = LAUNCH_REALISM_CONFIG.massModel.stage1ComStart;
  let comEnd = LAUNCH_REALISM_CONFIG.massModel.stage1ComEnd;
  if (bodyKind === "stage2") {
    comStart = LAUNCH_REALISM_CONFIG.massModel.stage2ComStart;
    comEnd = LAUNCH_REALISM_CONFIG.massModel.stage2ComEnd;
  } else if (bodyKind === "booster") {
    comStart = LAUNCH_REALISM_CONFIG.massModel.boosterComStart;
    comEnd = LAUNCH_REALISM_CONFIG.massModel.boosterComEnd;
  }
  const targetCom = linearInterpolate(comStart, comEnd, burnFrac);
  const targetInertia = linearInterpolate(
    LAUNCH_REALISM_CONFIG.massModel.inertiaStart,
    LAUNCH_REALISM_CONFIG.massModel.inertiaEnd,
    burnFrac,
  );
  const lagTauSec = Math.max(0.08, Number(LAUNCH_REALISM_CONFIG.massModel.lagTauSec) || 0.9);
  const alpha = clamp((Number(dtSeconds) || 0) / lagTauSec, 0, 1);
  state.comNormalized = linearInterpolate(state.comNormalized, targetCom, alpha);
  state.inertiaNormalized = linearInterpolate(state.inertiaNormalized, targetInertia, alpha);
  const centeredness = 1 - Math.abs((state.comNormalized - 0.5) * 2);
  state.controlAuthorityScale = clamp(
    (1.15 - (0.45 * state.inertiaNormalized)) + (0.3 * centeredness),
    0.55,
    1.25,
  );
  return state;
}

export function applyActuatorModel(actuatorState, {
  requestedThrottle = 0,
  requestedDirection = { x: 0, y: 0, z: 1 },
  dtSeconds = 0,
  config,
  massModel,
}) {
  const state = actuatorState || createActuatorState(requestedDirection);
  const cfg = config || LAUNCH_REALISM_CONFIG.actuator.stage;
  const massState = massModel || createMassModelState();
  const requestedThrottleClamped = clamp(Number(requestedThrottle) || 0, 0, 1);
  const requestedDirNorm = normalize(
    requestedDirection,
    state.directionActual || { x: 0, y: 0, z: 1 },
  );
  const dt = Math.max(0, Number(dtSeconds) || 0);

  const inertiaScale = clamp(
    (
      (0.72 + (0.58 * (Number(massState.inertiaNormalized) || 1)))
      / Math.max(Number(massState.controlAuthorityScale) || 1, 0.25)
    ),
    0.45,
    1.9,
  );
  const riseTau = Math.max(0.06, (Number(cfg.throttleRiseTauSec) || 0.5) * inertiaScale);
  const fallTau = Math.max(0.05, (Number(cfg.throttleFallTauSec) || 0.34) * inertiaScale);
  const throttleTau = requestedThrottleClamped >= state.throttleActual ? riseTau : fallTau;
  const throttleAlpha = clamp(dt / throttleTau, 0, 1);

  state.throttleCommand = requestedThrottleClamped;
  state.directionCommand = requestedDirNorm;
  state.throttleActual = linearInterpolate(state.throttleActual, requestedThrottleClamped, throttleAlpha);

  const gimbalRateDegSBase = Math.max(0.1, Number(cfg.gimbalRateDegS) || 8);
  const gimbalRateDegS = gimbalRateDegSBase * clamp(
    (Number(massState.controlAuthorityScale) || 1)
      / Math.max(Number(massState.inertiaNormalized) || 1, 0.25),
    0.45,
    1.9,
  );
  const maxStepRad = rad(gimbalRateDegS) * dt;
  const currentDir = normalize(state.directionActual, requestedDirNorm);
  const errorRad = angleBetweenRadians(currentDir, requestedDirNorm);
  const blend = errorRad > 1e-12 ? clamp(maxStepRad / errorRad, 0, 1) : 1;
  state.directionActual = normalize(mixVectors(currentDir, requestedDirNorm, blend), requestedDirNorm);
  state.gimbalErrorDeg = degrees(angleBetweenRadians(state.directionActual, requestedDirNorm));
  return state;
}
