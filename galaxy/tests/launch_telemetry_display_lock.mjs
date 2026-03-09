import {
  resolveSnapshotTargetTelemetry,
  shouldShowTerrainRelativeAltitude,
} from "../app/static/js/ui/launchTelemetryDisplay.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const launchSnapshot = {
    missionPhase: "launch_to_parking",
    altitudeKm: 12.4,
    altitudeAboveTerrainKm: 12.3,
    targetDistanceKm: 402_000,
    targetClosingSpeedKmS: 6.1,
  };
  assert(
    shouldShowTerrainRelativeAltitude(launchSnapshot),
    "expected terrain-relative altitude during launch_to_parking",
  );

  const coastSnapshot = {
    missionPhase: "coast_to_moon",
    guidanceMode: "navsys:gnc-lambert-midcourse-coast",
    altitudeKm: 3351.9,
    altitudeAboveTerrainKm: 0,
    targetDistanceKm: 388_600.6,
    targetClosingSpeedKmS: 0.2774,
  };
  assert(
    !shouldShowTerrainRelativeAltitude(coastSnapshot),
    "expected terrain-relative altitude to be suppressed during translunar coast",
  );
  const coastTargetTelemetry = resolveSnapshotTargetTelemetry(coastSnapshot);
  assert(coastTargetTelemetry.plannedCoastActive, "expected translunar coast state to be detected");
  assert(coastTargetTelemetry.targetRateLabel === "Approach", `expected Approach label, got ${coastTargetTelemetry.targetRateLabel}`);
  assert(coastTargetTelemetry.targetEtaLabel === "Plan ETA", `expected Plan ETA label, got ${coastTargetTelemetry.targetEtaLabel}`);
  assert(coastTargetTelemetry.targetEtaSeconds === null, "expected instantaneous ETA fallback to be suppressed during departure hold");

  const plannedCoastSnapshot = {
    ...coastSnapshot,
    targetEtaSeconds: 110_000,
    targetRateLabel: "Closing",
    targetEtaLabel: "ETA",
  };
  const plannedTargetTelemetry = resolveSnapshotTargetTelemetry(plannedCoastSnapshot);
  assert(plannedTargetTelemetry.targetEtaSeconds === 110_000, "expected planned departure ETA to be preserved");
  assert(plannedTargetTelemetry.targetRateLabel === "Approach", `expected translunar-coast label normalization, got ${plannedTargetTelemetry.targetRateLabel}`);
  assert(plannedTargetTelemetry.targetEtaLabel === "Plan ETA", `expected translunar-coast ETA label normalization, got ${plannedTargetTelemetry.targetEtaLabel}`);

  const normalTargetTelemetry = resolveSnapshotTargetTelemetry({
    missionPhase: "launch_to_parking",
    guidanceMode: "autopilot-coast-to-apoapsis",
    targetDistanceKm: 1200,
    targetClosingSpeedKmS: 2,
  });
  assert(normalTargetTelemetry.targetEtaSeconds === 600, `expected normal ETA fallback, got ${normalTargetTelemetry.targetEtaSeconds}`);
  assert(normalTargetTelemetry.targetRateLabel === "Closing", `expected Closing label, got ${normalTargetTelemetry.targetRateLabel}`);
  assert(normalTargetTelemetry.targetEtaLabel === "ETA", `expected ETA label, got ${normalTargetTelemetry.targetEtaLabel}`);

  console.log("PASS launch-telemetry-display-lock");
}

main();
