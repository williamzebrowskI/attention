function defaultVehicleDeleteRejectLabel(reason) {
  const key = String(reason || "").trim().toLowerCase();
  if (key === "primary_vehicle_protected") {
    return "Primary Starship/booster cannot be deleted with this action.";
  }
  if (key === "vehicle_not_found") {
    return "Selected vehicle is no longer active.";
  }
  if (key === "state_unavailable") {
    return "Simulation state is unavailable.";
  }
  return key || "delete_not_allowed";
}

function defaultIsDeletableVehicleId(bodyId) {
  const id = String(bodyId || "");
  return id.startsWith("earth_refuel_tanker_") || id.startsWith("earth_mission_ship_");
}

export function createLaunchVehicleDeleteController(options = {}) {
  const launchDeleteButton = options.launchDeleteButton || null;
  const getLaunchController = typeof options.getLaunchController === "function"
    ? options.getLaunchController
    : (() => null);
  const getNBodyState = typeof options.getNBodyState === "function"
    ? options.getNBodyState
    : (() => null);
  const getLaunchModuleLoadError = typeof options.getLaunchModuleLoadError === "function"
    ? options.getLaunchModuleLoadError
    : (() => "");
  const getSelectedId = typeof options.getSelectedId === "function"
    ? options.getSelectedId
    : (() => "");
  const getLaunchBodyId = typeof options.getLaunchBodyId === "function"
    ? options.getLaunchBodyId
    : (() => "earth_launch_vehicle");
  const getBodies = typeof options.getBodies === "function"
    ? options.getBodies
    : (() => []);
  const setBodies = typeof options.setBodies === "function"
    ? options.setBodies
    : (() => {});
  const getMetaById = typeof options.getMetaById === "function"
    ? options.getMetaById
    : (() => new Map());
  const getPositionsById = typeof options.getPositionsById === "function"
    ? options.getPositionsById
    : (() => new Map());
  const getRuntimeCoordsKmById = typeof options.getRuntimeCoordsKmById === "function"
    ? options.getRuntimeCoordsKmById
    : (() => new Map());
  const getBodyVisuals = typeof options.getBodyVisuals === "function"
    ? options.getBodyVisuals
    : (() => new Map());
  const getOrbitVisuals = typeof options.getOrbitVisuals === "function"
    ? options.getOrbitVisuals
    : (() => new Map());
  const getOrbitalStateById = typeof options.getOrbitalStateById === "function"
    ? options.getOrbitalStateById
    : (() => new Map());
  const getIlluminationById = typeof options.getIlluminationById === "function"
    ? options.getIlluminationById
    : (() => new Map());
  const getGravityById = typeof options.getGravityById === "function"
    ? options.getGravityById
    : (() => new Map());
  const getPrimeMeridianSpinOffsetRadById = typeof options.getPrimeMeridianSpinOffsetRadById === "function"
    ? options.getPrimeMeridianSpinOffsetRadById
    : (() => new Map());
  const getDetailBodyId = typeof options.getDetailBodyId === "function"
    ? options.getDetailBodyId
    : (() => null);
  const setDetailBodyId = typeof options.setDetailBodyId === "function"
    ? options.setDetailBodyId
    : (() => {});
  const setSelectedId = typeof options.setSelectedId === "function"
    ? options.setSelectedId
    : (() => {});
  const disposeBodyVisual = typeof options.disposeBodyVisual === "function"
    ? options.disposeBodyVisual
    : (() => {});
  const disposeOrbitVisual = typeof options.disposeOrbitVisual === "function"
    ? options.disposeOrbitVisual
    : (() => {});
  const rebuildBodyLegend = typeof options.rebuildBodyLegend === "function"
    ? options.rebuildBodyLegend
    : (() => {});
  const setSelected = typeof options.setSelected === "function"
    ? options.setSelected
    : (() => {});
  const updateLegendSelection = typeof options.updateLegendSelection === "function"
    ? options.updateLegendSelection
    : (() => {});
  const updateLegendGravityArrowIndicators = typeof options.updateLegendGravityArrowIndicators === "function"
    ? options.updateLegendGravityArrowIndicators
    : (() => {});
  const appendLaunchLogEntry = typeof options.appendLaunchLogEntry === "function"
    ? options.appendLaunchLogEntry
    : (() => {});
  const updateLaunchStatusPanel = typeof options.updateLaunchStatusPanel === "function"
    ? options.updateLaunchStatusPanel
    : (() => {});
  const updateLaunchControls = typeof options.updateLaunchControls === "function"
    ? options.updateLaunchControls
    : (() => {});
  const isDeletableVehicleId = typeof options.isDeletableVehicleId === "function"
    ? options.isDeletableVehicleId
    : defaultIsDeletableVehicleId;
  const vehicleDeleteRejectLabel = typeof options.vehicleDeleteRejectLabel === "function"
    ? options.vehicleDeleteRejectLabel
    : defaultVehicleDeleteRejectLabel;
  const nowMs = typeof options.nowMs === "function"
    ? options.nowMs
    : (() => Date.now());

  function removeRuntimeCatalogBody(bodyId) {
    const targetId = String(bodyId || "").trim();
    if (!targetId) {
      return false;
    }

    const metaById = getMetaById();
    const bodyVisuals = getBodyVisuals();
    const orbitVisuals = getOrbitVisuals();
    const hadMeta = metaById.has(targetId);
    const hadVisual = bodyVisuals.has(targetId);
    const hadOrbit = orbitVisuals.has(targetId);
    if (!hadMeta && !hadVisual && !hadOrbit) {
      return false;
    }

    const visual = bodyVisuals.get(targetId);
    if (visual) {
      disposeBodyVisual(visual);
      bodyVisuals.delete(targetId);
    }
    const orbitVisual = orbitVisuals.get(targetId);
    if (orbitVisual) {
      disposeOrbitVisual(orbitVisual);
      orbitVisuals.delete(targetId);
    }

    const bodies = getBodies();
    setBodies(
      Array.isArray(bodies)
        ? bodies.filter((body) => String(body?.id || "") !== targetId)
        : [],
    );
    metaById.delete(targetId);
    getPositionsById().delete(targetId);
    getRuntimeCoordsKmById().delete(targetId);
    getOrbitalStateById().delete(targetId);
    getIlluminationById().delete(targetId);
    getGravityById().delete(targetId);
    getPrimeMeridianSpinOffsetRadById().delete(targetId);

    if (getDetailBodyId() === targetId) {
      setDetailBodyId(null);
    }
    if (getSelectedId() === targetId) {
      setSelectedId(null);
    }

    rebuildBodyLegend();
    const launchBodyId = String(getLaunchBodyId() || "");
    const fallbackSelectionId = getSelectedId()
      || (metaById.has(launchBodyId) ? launchBodyId : null)
      || (metaById.has("earth") ? "earth" : null)
      || ((getBodies()[0] && getBodies()[0].id) ? getBodies()[0].id : null);
    if (!getSelectedId() && fallbackSelectionId) {
      setSelected(fallbackSelectionId, false);
    } else {
      updateLegendSelection();
      updateLegendGravityArrowIndicators();
    }
    return true;
  }

  function deleteSelectedVehicle() {
    const moduleLoadError = String(getLaunchModuleLoadError() || "");
    if (moduleLoadError) {
      appendLaunchLogEntry("error", {
        name: "vehicle_delete_rejected",
        reason: moduleLoadError,
      });
      updateLaunchStatusPanel(true, `Launch module load error: ${moduleLoadError}`);
      return;
    }
    const launchController = getLaunchController();
    const nBodyState = getNBodyState();
    if (!launchController || !nBodyState?.initialized) {
      appendLaunchLogEntry("error", {
        name: "vehicle_delete_rejected",
        reason: "startup_seed_not_ready",
      });
      updateLaunchStatusPanel(true, "Delete unavailable until startup seed is ready.");
      return;
    }
    const targetId = String(getSelectedId() || "").trim();
    if (!isDeletableVehicleId(targetId)) {
      appendLaunchLogEntry("error", {
        name: "vehicle_delete_rejected",
        reason: "selection_not_deletable",
        selectedId: targetId || null,
      });
      updateLaunchStatusPanel(true, "Select a tanker or fleet Starship to delete.");
      return;
    }
    const deleteResult = launchController.removeVehicleById?.(nBodyState, targetId, nowMs());
    if (!deleteResult?.accepted) {
      const rejectLabel = vehicleDeleteRejectLabel(deleteResult?.reason);
      appendLaunchLogEntry("error", {
        name: "vehicle_delete_rejected",
        reason: String(deleteResult?.reason || "delete_not_allowed"),
        bodyId: targetId,
      });
      updateLaunchStatusPanel(true, `Delete rejected: ${rejectLabel}`);
      return;
    }
    removeRuntimeCatalogBody(targetId);
    appendLaunchLogEntry("info", {
      name: "vehicle_delete_requested",
      bodyId: targetId,
      vehicleRole: deleteResult.vehicleRole || null,
      removedDynamicBody: Boolean(deleteResult.removedDynamicBody),
      removedFleetVehicle: Boolean(deleteResult.removedFleetVehicle),
      removedRefuelTracking: Boolean(deleteResult.removedRefuelTracking),
    });
    updateLaunchControls();
    updateLaunchStatusPanel(true, `Deleted ${deleteResult.vehicleName || targetId}.`);
  }

  function bindControls() {
    if (!launchDeleteButton || launchDeleteButton.dataset.bound === "true") {
      return;
    }
    launchDeleteButton.addEventListener("click", () => {
      deleteSelectedVehicle();
    });
    launchDeleteButton.dataset.bound = "true";
  }

  function syncButtonState({ initialized = Boolean(getLaunchController() && getNBodyState()?.initialized) } = {}) {
    if (!launchDeleteButton) {
      return;
    }
    const targetId = String(getSelectedId() || "").trim();
    const canDeleteSelected = Boolean(
      getLaunchController()
      && initialized
      && !getLaunchModuleLoadError()
      && isDeletableVehicleId(targetId),
    );
    launchDeleteButton.disabled = !canDeleteSelected;
    launchDeleteButton.classList.toggle("on", canDeleteSelected);
    launchDeleteButton.setAttribute("aria-pressed", canDeleteSelected ? "true" : "false");
  }

  return {
    bindControls,
    syncButtonState,
    deleteSelectedVehicle,
    removeRuntimeCatalogBody,
    isDeletableVehicleId,
    vehicleDeleteRejectLabel,
  };
}
