function finiteVector3(value) {
  return Boolean(
    value
    && Number.isFinite(Number(value.x))
    && Number.isFinite(Number(value.y))
    && Number.isFinite(Number(value.z))
  );
}

function finiteAccelerationKmS2(value) {
  if (!finiteVector3(value)) {
    return { x: 0, y: 0, z: 0 };
  }
  return {
    x: Number(value.x),
    y: Number(value.y),
    z: Number(value.z),
  };
}

export function createPhysicsIntegrator(options = {}) {
  const {
    computeTotalAccelerationForTarget = () => ({ x: 0, y: 0, z: 0 }),
    buildOblateSourceContextMapForNBody = () => new Map(),
    sanitizeDynamicBodyState = () => true,
    cloneDynamicBodySnapshot = (value) => value,
    restoreDynamicBodyFromSnapshot = () => {},
    isFiniteBodyState = () => true,
    onNumericWarning = () => {},
    onBacklogWarning = () => {},
    isLaunchFeatureEnabled = () => false,
    getLaunchController = () => null,
    resolveStepSeconds = () => 1,
    defaultStepSeconds = 1,
    maxSubstepsPerFrame = 24,
    backlogWarnIntervalMs = 4000,
  } = options;

  let lastBacklogWarnMs = 0;

  function integrateWorldStep(state, dtSeconds, stepNowMs = Date.now(), oblateSourceContextByIdInput = null) {
    const stepStartMs = Number.isFinite(Number(stepNowMs)) ? Number(stepNowMs) : Date.now();
    const stepEndMs = stepStartMs + (Math.max(0, Number(dtSeconds) || 0) * 1000);
    const oblateSourceContextById =
      oblateSourceContextByIdInput || buildOblateSourceContextMapForNBody(state, stepStartMs);
    if (isLaunchFeatureEnabled()) {
      getLaunchController()?.prepareStep(state, dtSeconds, stepStartMs);
    }
    const preStepSnapshotsById = new Map();
    for (const [bodyId, bodyState] of state.dynamicBodies.entries()) {
      const valid = sanitizeDynamicBodyState(bodyId, bodyState);
      preStepSnapshotsById.set(bodyId, cloneDynamicBodySnapshot(bodyState));
      if (!valid) {
        onNumericWarning(`sanitized non-finite pre-step state for ${bodyId} from runtime snapshot`);
      }
    }

    const accelerationStartById = new Map();
    for (const bodyId of state.dynamicBodies.keys()) {
      const accel = computeTotalAccelerationForTarget(state, bodyId, oblateSourceContextById, stepStartMs);
      accelerationStartById.set(bodyId, finiteAccelerationKmS2(accel));
    }

    for (const [bodyId, bodyState] of state.dynamicBodies.entries()) {
      const accel = finiteAccelerationKmS2(accelerationStartById.get(bodyId) || { x: 0, y: 0, z: 0 });
      bodyState.velocity.x += 0.5 * accel.x * dtSeconds;
      bodyState.velocity.y += 0.5 * accel.y * dtSeconds;
      bodyState.velocity.z += 0.5 * accel.z * dtSeconds;

      bodyState.position.x += bodyState.velocity.x * dtSeconds;
      bodyState.position.y += bodyState.velocity.y * dtSeconds;
      bodyState.position.z += bodyState.velocity.z * dtSeconds;
    }

    for (const [bodyId, bodyState] of state.dynamicBodies.entries()) {
      const accel = finiteAccelerationKmS2(
        computeTotalAccelerationForTarget(state, bodyId, oblateSourceContextById, stepEndMs),
      );
      bodyState.velocity.x += 0.5 * accel.x * dtSeconds;
      bodyState.velocity.y += 0.5 * accel.y * dtSeconds;
      bodyState.velocity.z += 0.5 * accel.z * dtSeconds;
    }

    for (const [bodyId, bodyState] of state.dynamicBodies.entries()) {
      if (!isFiniteBodyState(bodyState)) {
        const fallbackSnapshot = preStepSnapshotsById.get(bodyId);
        restoreDynamicBodyFromSnapshot(bodyState, fallbackSnapshot);
        onNumericWarning(`restored unstable integration state for ${bodyId}`);
      }
    }

    if (isLaunchFeatureEnabled()) {
      getLaunchController()?.finalizeStep(state, dtSeconds, stepEndMs);
    }
  }

  function stepWorldSimulation(state, nowMs = Date.now()) {
    if (!state?.initialized) {
      return;
    }

    if (!Number.isFinite(state.lastUpdateMs)) {
      state.lastUpdateMs = nowMs;
      state.simulationTimeMs = nowMs;
      state.integratorAccumulatorSec = 0;
      return;
    }

    const elapsedSecondsRaw = (nowMs - state.lastUpdateMs) / 1000;
    const elapsedSeconds = Number.isFinite(elapsedSecondsRaw)
      ? Math.max(0, elapsedSecondsRaw)
      : 0;
    state.lastUpdateMs = nowMs;
    if (!(elapsedSeconds > 0) && !((Number(state.integratorAccumulatorSec) || 0) > 1e-9)) {
      return;
    }

    if (!Number.isFinite(state.simulationTimeMs)) {
      state.simulationTimeMs = nowMs - (elapsedSeconds * 1000);
    }
    if (!Number.isFinite(state.integratorAccumulatorSec) || state.integratorAccumulatorSec < 0) {
      state.integratorAccumulatorSec = 0;
    }

    const pendingElapsedSeconds = Math.max(0, Number(state.integratorAccumulatorSec) || 0) + elapsedSeconds;
    if (!(pendingElapsedSeconds > 0)) {
      state.lastUpdateMs = nowMs;
      return;
    }

    const launchActive = isLaunchFeatureEnabled() && Boolean(getLaunchController()?.isActive?.());
    const launchSnapshot = launchActive ? (getLaunchController()?.statusSnapshot?.() || null) : null;
    const stepSeconds = launchSnapshot
      ? resolveStepSeconds(launchSnapshot)
      : defaultStepSeconds;
    if (!Number.isFinite(stepSeconds) || !(stepSeconds > 1e-9)) {
      onNumericWarning(`invalid integration step (${String(stepSeconds)}); skipping frame`);
      state.integratorAccumulatorSec = pendingElapsedSeconds;
      return;
    }

    const oblateSourceContextById = buildOblateSourceContextMapForNBody(state, nowMs);
    let substeps = 0;
    let stepNowMs = Number(state.simulationTimeMs) || nowMs;
    let remainingSeconds = pendingElapsedSeconds;
    while (
      remainingSeconds > 1e-9
      && substeps < maxSubstepsPerFrame
    ) {
      const dtSeconds = Math.min(stepSeconds, remainingSeconds);
      integrateWorldStep(state, dtSeconds, stepNowMs, oblateSourceContextById);
      remainingSeconds -= dtSeconds;
      stepNowMs += dtSeconds * 1000;
      substeps += 1;
    }

    state.simulationTimeMs = stepNowMs;
    state.integratorAccumulatorSec = Math.max(0, remainingSeconds);
    if (remainingSeconds > 1e-6) {
      const warnNowMs = Date.now();
      if (warnNowMs - lastBacklogWarnMs > backlogWarnIntervalMs) {
        lastBacklogWarnMs = warnNowMs;
        onBacklogWarning({
          remainingSeconds,
          substeps,
          stepSeconds,
        });
      }
    }
  }

  return {
    integrateWorldStep,
    stepWorldSimulation,
  };
}
