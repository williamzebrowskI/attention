function finiteNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

const TERRAIN_RELEVANT_MISSION_PHASES = new Set([
  "launch_to_parking",
  "earth_capture",
  "earth_descent",
]);

const SPACE_TRANSFER_MISSION_PHASES = new Set([
  "orbital_refuel",
  "earth_orbit_hold",
  "tli_burn",
  "coast_to_moon",
  "lunar_capture",
  "lunar_orbit_hold",
  "tei_burn",
  "coast_to_earth",
]);

export function shouldShowTerrainRelativeAltitude(snapshot = null, options = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    return false;
  }
  const altitudeAglKm = finiteNumberOrNull(snapshot.altitudeAboveTerrainKm);
  if (altitudeAglKm === null) {
    return false;
  }
  const missionPhase = String(snapshot.missionPhase || "").trim().toLowerCase();
  if (SPACE_TRANSFER_MISSION_PHASES.has(missionPhase)) {
    return false;
  }
  if (TERRAIN_RELEVANT_MISSION_PHASES.has(missionPhase)) {
    return true;
  }
  const altitudeKm = finiteNumberOrNull(snapshot.altitudeKm);
  const maxTerrainDisplayAltitudeKm = Number.isFinite(Number(options.maxTerrainDisplayAltitudeKm))
    ? Number(options.maxTerrainDisplayAltitudeKm)
    : 150;
  return altitudeKm !== null && altitudeKm <= maxTerrainDisplayAltitudeKm;
}

export function resolveSnapshotTargetTelemetry(snapshot = null) {
  const targetDistanceKm = finiteNumberOrNull(snapshot?.targetDistanceKm);
  const targetClosingSpeedKmS = finiteNumberOrNull(snapshot?.targetClosingSpeedKmS);
  const targetEtaSecondsRaw = finiteNumberOrNull(snapshot?.targetEtaSeconds);
  const targetEtaSource = String(snapshot?.targetEtaSource || "").trim().toLowerCase();
  const guidanceText = `${String(snapshot?.autopilotMode || "").trim()} ${String(snapshot?.guidanceMode || "").trim()}`
    .toLowerCase();
  const ballisticCoastActive = guidanceText.includes("ballistic-track");
  const plannedCoastActive = ballisticCoastActive;

  const rawTargetRateLabel = String(snapshot?.targetRateLabel || "").trim();
  const rawTargetEtaLabel = String(snapshot?.targetEtaLabel || "").trim();
  let targetRateLabel = rawTargetRateLabel || (plannedCoastActive ? "Approach" : "Closing");
  let targetEtaLabel = rawTargetEtaLabel || (plannedCoastActive ? "Plan ETA" : "ETA");
  if (plannedCoastActive) {
    if (!rawTargetRateLabel || rawTargetRateLabel.toLowerCase() === "closing") {
      targetRateLabel = "Approach";
    }
    if (!rawTargetEtaLabel || rawTargetEtaLabel.toLowerCase() === "eta") {
      targetEtaLabel = "Plan ETA";
    }
  }

  const targetEtaSeconds = targetEtaSecondsRaw !== null
    ? targetEtaSecondsRaw
    : (
      !plannedCoastActive
      && targetDistanceKm !== null
      && targetClosingSpeedKmS !== null
      && targetClosingSpeedKmS > 1e-6
    )
      ? (targetDistanceKm / targetClosingSpeedKmS)
      : null;

  return {
    plannedCoastActive,
    ballisticCoastActive,
    targetDistanceKm,
    targetClosingSpeedKmS,
    targetEtaSeconds,
    targetEtaSource: targetEtaSecondsRaw !== null
      ? (targetEtaSource || (plannedCoastActive ? "planned-transfer" : "snapshot"))
      : (
        !plannedCoastActive
        && targetDistanceKm !== null
        && targetClosingSpeedKmS !== null
        && targetClosingSpeedKmS > 1e-6
      )
        ? "instantaneous-closing"
        : null,
    targetRateLabel,
    targetEtaLabel,
  };
}
