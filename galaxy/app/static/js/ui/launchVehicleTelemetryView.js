export function isLaunchTelemetryVehicleId(bodyId, {
  launchBodyId,
  launchBoosterBodyId,
} = {}) {
  const id = String(bodyId || "");
  return id === String(launchBodyId || "")
    || id === String(launchBoosterBodyId || "")
    || id.startsWith("earth_refuel_tanker_")
    || id.startsWith("earth_mission_ship_");
}

export function activeLaunchTelemetryBodyId({
  selectedId,
  launchVehicleViewPreference,
  hasVisibleBodyState,
  launchBodyId,
  launchBoosterBodyId,
} = {}) {
  if (isLaunchTelemetryVehicleId(selectedId, { launchBodyId, launchBoosterBodyId })) {
    return selectedId;
  }
  if (
    launchVehicleViewPreference === "booster"
    && typeof hasVisibleBodyState === "function"
    && hasVisibleBodyState(launchBoosterBodyId)
  ) {
    return launchBoosterBodyId;
  }
  return launchBodyId;
}
