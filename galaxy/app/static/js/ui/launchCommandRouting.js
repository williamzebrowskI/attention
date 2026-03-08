export function resolveMissionLaunchAction({
  primaryLaunchActive = false,
  missionLaunchMode = "pad_launch",
} = {}) {
  const normalizedMode = String(missionLaunchMode || "").trim().toLowerCase() === "orbit_inject"
    ? "orbit_inject"
    : "pad_launch";
  if (normalizedMode === "orbit_inject") {
    return "mission_orbit_inject";
  }
  return primaryLaunchActive ? "mission_additional_fleet" : "primary_pad_launch";
}
