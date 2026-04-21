export function createPhysicsLaunchRuntime(options = {}) {
  const {
    getLaunchFeatureEnabled = () => false,
    getLaunchController = () => null,
    onWorldStateMutated = () => {},
  } = options;

  function activeLaunchController() {
    if (!getLaunchFeatureEnabled()) {
      return null;
    }
    return getLaunchController() || null;
  }

  function markWorldStateMutation(state) {
    if (state?.dynamicBodies instanceof Map) {
      onWorldStateMutated(state);
    }
  }

  function ensureCatalogBodies(catalogBodies) {
    const launchController = activeLaunchController();
    if (!launchController) {
      return catalogBodies;
    }
    return launchController.ensureCatalogBodies?.(catalogBodies) || catalogBodies;
  }

  function injectStartupEntry(entriesById, nowMs = Date.now()) {
    const launchController = activeLaunchController();
    if (!launchController) {
      return entriesById;
    }
    launchController.injectStartupEntry?.(entriesById, nowMs);
    return entriesById;
  }

  function synchronizeManagedBodies(state, nowMs = Date.now(), resetOptions = {}) {
    const launchController = activeLaunchController();
    const result = {
      controllerAvailable: Boolean(launchController),
      rocketState: null,
      resetApplied: false,
    };
    if (!launchController || !state?.initialized) {
      return result;
    }
    result.rocketState = launchController.ensureRocketInNBody?.(state, nowMs) || null;
    if (typeof launchController.resetToPad === "function") {
      result.resetApplied = Boolean(launchController.resetToPad(state, nowMs, resetOptions));
    }
    markWorldStateMutation(state);
    return result;
  }

  function startLaunch(state, nowMs = Date.now()) {
    const launchController = activeLaunchController();
    const started = Boolean(launchController?.startLaunch?.(state, nowMs));
    if (started) {
      markWorldStateMutation(state);
    }
    return started;
  }

  function resetToPad(state, nowMs = Date.now(), options = {}) {
    const launchController = activeLaunchController();
    const resetApplied = Boolean(launchController?.resetToPad?.(state, nowMs, options));
    if (resetApplied) {
      markWorldStateMutation(state);
    }
    return resetApplied;
  }

  function launchRefuelTanker(state, nowMs = Date.now(), options = {}) {
    const launchController = activeLaunchController();
    const result = launchController?.launchRefuelTanker?.(state, nowMs, options) || null;
    if (result?.accepted || result?.pending) {
      markWorldStateMutation(state);
    }
    return result;
  }

  function launchMissionShip(state, missionId, nowMs = Date.now(), options = {}) {
    const launchController = activeLaunchController();
    const result = launchController?.launchMissionShip?.(state, missionId, nowMs, options) || null;
    if (result?.accepted || result?.pending) {
      markWorldStateMutation(state);
    }
    return result;
  }

  async function launchMissionShipAsync(state, missionId, nowMs = Date.now(), options = {}) {
    const launchController = activeLaunchController();
    const result = await launchController?.launchMissionShipAsync?.(state, missionId, nowMs, options);
    if (result?.accepted || result?.pending) {
      markWorldStateMutation(state);
    }
    return result || null;
  }

  function removeVehicleById(state, bodyId, nowMs = Date.now()) {
    const launchController = activeLaunchController();
    const result = launchController?.removeVehicleById?.(state, bodyId, nowMs) || null;
    if (result?.accepted) {
      markWorldStateMutation(state);
    }
    return result;
  }

  return {
    ensureCatalogBodies,
    injectStartupEntry,
    synchronizeManagedBodies,
    startLaunch,
    resetToPad,
    launchRefuelTanker,
    launchMissionShip,
    launchMissionShipAsync,
    removeVehicleById,
  };
}
