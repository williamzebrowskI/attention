export function computeLaunchVehicleViewState({
  inBodyLock = false,
  selectedId = "",
  launchBodyId = "",
  launchBoosterBodyId = "",
  launchVehicleViewPreference = "starship",
  starshipAvailable = false,
  boosterDetachedAvailable = false,
} = {}) {
  const starshipViewAvailable = Boolean(starshipAvailable);
  const boosterViewAvailable = Boolean(boosterDetachedAvailable || starshipAvailable);
  const starshipActive = Boolean(
    inBodyLock
    && selectedId === launchBodyId
    && launchVehicleViewPreference !== "booster",
  );
  const boosterActive = Boolean(
    inBodyLock
    && (
      selectedId === launchBoosterBodyId
      || (selectedId === launchBodyId && launchVehicleViewPreference === "booster")
    ),
  );
  const activeView = boosterActive ? "booster" : (starshipActive ? "starship" : "none");

  let statusLine = "View standby. Select a vehicle to track.";
  if (!starshipViewAvailable && !boosterViewAvailable) {
    statusLine = "Vehicle views unavailable in current scene.";
  } else if (!inBodyLock) {
    statusLine = "View unlocked. Select Starship or Booster to lock camera tracking.";
  } else if (activeView === "booster") {
    statusLine = boosterDetachedAvailable
      ? "Booster tracking active. Scene camera locked to detached booster."
      : "Booster view armed. Tracking stacked booster until separation.";
  } else if (activeView === "starship") {
    statusLine = "Starship tracking active. Scene camera locked to launch vehicle.";
  } else {
    statusLine = "Select Starship or Booster to lock camera tracking.";
  }

  return {
    activeView,
    starshipViewAvailable,
    boosterViewAvailable,
    starshipActive,
    boosterActive,
    statusLine,
  };
}
