function defaultIsRefuelTankerBodyId(bodyId) {
  return String(bodyId || "").startsWith("earth_refuel_tanker_");
}

export function createLegendVehicleStatusController(options = {}) {
  const getLegendButtonsById = typeof options.getLegendButtonsById === "function"
    ? options.getLegendButtonsById
    : (() => null);
  const getNBodyAllBodiesMode = typeof options.getNBodyAllBodiesMode === "function"
    ? options.getNBodyAllBodiesMode
    : (() => false);
  const getNBodyStartupSnapshotLoaded = typeof options.getNBodyStartupSnapshotLoaded === "function"
    ? options.getNBodyStartupSnapshotLoaded
    : (() => false);
  const isNBodyDrivenBodyId = typeof options.isNBodyDrivenBodyId === "function"
    ? options.isNBodyDrivenBodyId
    : (() => false);
  const isRefuelTankerBodyIdFn = typeof options.isRefuelTankerBodyId === "function"
    ? options.isRefuelTankerBodyId
    : defaultIsRefuelTankerBodyId;
  const getLaunchFeatureEnabled = typeof options.getLaunchFeatureEnabled === "function"
    ? options.getLaunchFeatureEnabled
    : (() => false);
  const getLaunchController = typeof options.getLaunchController === "function"
    ? options.getLaunchController
    : (() => null);
  const getNBodyState = typeof options.getNBodyState === "function"
    ? options.getNBodyState
    : (() => null);
  const getLaunchBodyId = typeof options.getLaunchBodyId === "function"
    ? options.getLaunchBodyId
    : (() => "earth_launch_vehicle");

  function isBodyNBodyFallback(bodyId) {
    if (!getNBodyAllBodiesMode() || !getNBodyStartupSnapshotLoaded()) {
      return false;
    }
    return !isNBodyDrivenBodyId(bodyId);
  }

  function isRefuelTankerBodyId(bodyId) {
    return isRefuelTankerBodyIdFn(bodyId);
  }

  function snapshotForBody(bodyId, nowMs) {
    if (!getLaunchFeatureEnabled()) {
      return null;
    }
    const launchController = getLaunchController();
    const nBodyState = getNBodyState();
    if (
      typeof launchController?.statusSnapshotForBody !== "function"
      || !nBodyState?.initialized
    ) {
      return null;
    }
    return launchController.statusSnapshotForBody(nBodyState, bodyId, nowMs) || null;
  }

  function tankerLegendReadyState(bodyId, nowMs = Date.now()) {
    if (!isRefuelTankerBodyId(bodyId)) {
      return false;
    }
    const snapshot = snapshotForBody(bodyId, nowMs);
    if (!snapshot || String(snapshot.vehicleKind || "").toLowerCase() !== "tanker") {
      return false;
    }
    const phase = String(snapshot.phase || "").toLowerCase();
    const missionPhase = String(snapshot.missionPhase || "").toLowerCase();
    const guidanceMode = String(snapshot.guidanceMode || snapshot.autopilotMode || "").toLowerCase();
    const periapsisKm = Number(snapshot.periapsisKm);
    const altitudeKm = Number(snapshot.altitudeKm);
    const active = phase !== "idle";
    const orbitSettled = Number.isFinite(periapsisKm)
      ? periapsisKm > 80
      : (Number.isFinite(altitudeKm) && altitudeKm > 120);
    const holdLikeGuidance = guidanceMode.includes("hold")
      || guidanceMode.includes("orbital-refuel")
      || guidanceMode.includes("await-target")
      || guidanceMode.includes("orbital");
    const holdLikeMission = missionPhase.includes("hold")
      || missionPhase.includes("orbital_refuel")
      || missionPhase.includes("orbital_hold");
    return active && orbitSettled && (holdLikeGuidance || holdLikeMission);
  }

  function fuelingLegendState(bodyId, nowMs = Date.now()) {
    const targetId = String(bodyId || "");
    const launchBodyId = String(getLaunchBodyId() || "");
    if (targetId !== launchBodyId && !isRefuelTankerBodyId(targetId)) {
      return false;
    }
    const snapshot = snapshotForBody(bodyId, nowMs);
    if (!snapshot || !snapshot.refuelTransferActive) {
      return false;
    }
    const transferTankerId = String(snapshot.refuelTransferTankerId || "");
    return targetId === launchBodyId || (transferTankerId && targetId === transferTankerId);
  }

  function updateLegendFallbackIndicators(nowMs = Date.now()) {
    const legendButtonsById = getLegendButtonsById();
    if (!legendButtonsById || typeof legendButtonsById.entries !== "function") {
      return;
    }
    for (const [bodyId, button] of legendButtonsById.entries()) {
      if (!button?.classList) {
        continue;
      }
      const tankerReady = tankerLegendReadyState(bodyId, nowMs);
      const fuelingActive = fuelingLegendState(bodyId, nowMs);
      const fallback = isBodyNBodyFallback(bodyId) && !tankerReady && !fuelingActive;
      button.classList.toggle("fallback", fallback);
      button.classList.toggle("status-ready", tankerReady);
      button.classList.toggle("status-fueling", fuelingActive);
    }
  }

  return {
    isBodyNBodyFallback,
    isRefuelTankerBodyId,
    tankerLegendReadyState,
    fuelingLegendState,
    updateLegendFallbackIndicators,
  };
}
