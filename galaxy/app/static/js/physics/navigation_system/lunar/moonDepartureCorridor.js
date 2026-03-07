function finiteNumber(value, fallback = Number.NaN) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(Math.max(numeric, min), max);
}

export function resolveMoonDepartureCorridorLimits({
  plannerConfig = null,
  missGateKm = Number.NaN,
  targetPeriluneAltitudeKm = Number.NaN,
  bPlaneToleranceKm = Number.NaN,
  periluneUpperAltitudeKm = Number.NaN,
} = {}) {
  const planner = plannerConfig && typeof plannerConfig === "object"
    ? plannerConfig
    : {};
  const missLimitKm = Math.max(
    25_000,
    finiteNumber(
      missGateKm,
      finiteNumber(planner.moonDepartureCommitMissGateKm, finiteNumber(planner.moonMidcourseMissDistanceKm, 95_000) * 0.9),
    ),
  );
  const targetPeriluneKm = Math.max(
    20,
    finiteNumber(
      targetPeriluneAltitudeKm,
      finiteNumber(planner.moonTargetPeriluneAltitudeKm, 120),
    ),
  );
  const bPlaneLimitKm = Math.max(
    12_000,
    finiteNumber(
      bPlaneToleranceKm,
      finiteNumber(planner.moonDepartureCommitBPlaneGateKm, finiteNumber(planner.moonBPlaneToleranceKm, 6_000) * 8),
    ),
  );
  const periluneMaxKm = Math.max(
    targetPeriluneKm + 500,
    finiteNumber(
      periluneUpperAltitudeKm,
      finiteNumber(planner.moonDepartureCommitPeriluneMaxKm, finiteNumber(planner.moonCaptureUpperAltitudeKm, 16_000) * 1.5),
    ),
  );
  return {
    missLimitKm,
    targetPeriluneKm,
    bPlaneLimitKm,
    periluneMaxKm,
  };
}

export function evaluateMoonDepartureCorridor({
  predictedMissDistanceKm = Number.NaN,
  predictedPeriluneAltitudeKm = Number.NaN,
  bPlaneErrorKm = Number.NaN,
  plannerConfig = null,
  missGateKm = Number.NaN,
  targetPeriluneAltitudeKm = Number.NaN,
  bPlaneToleranceKm = Number.NaN,
  periluneUpperAltitudeKm = Number.NaN,
} = {}) {
  const limits = resolveMoonDepartureCorridorLimits({
    plannerConfig,
    missGateKm,
    targetPeriluneAltitudeKm,
    bPlaneToleranceKm,
    periluneUpperAltitudeKm,
  });
  const missKm = finiteNumber(predictedMissDistanceKm);
  const periluneKm = finiteNumber(predictedPeriluneAltitudeKm);
  const bPlaneKm = finiteNumber(bPlaneErrorKm);

  const missResidualKm = Number.isFinite(missKm)
    ? Math.max(0, missKm - limits.missLimitKm)
    : limits.missLimitKm * 2;
  const bPlaneResidualKm = Number.isFinite(bPlaneKm)
    ? Math.max(0, bPlaneKm - limits.bPlaneLimitKm)
    : limits.bPlaneLimitKm * 2;
  const periluneResidualKm = Number.isFinite(periluneKm)
    ? (
      periluneKm < 0
        ? Math.abs(periluneKm) + limits.targetPeriluneKm
        : Math.max(0, periluneKm - limits.periluneMaxKm)
    )
    : limits.periluneMaxKm;

  const missAccepted = missResidualKm <= 1e-6;
  const bPlaneAccepted = bPlaneResidualKm <= 1e-6;
  const periluneAccepted = periluneResidualKm <= 1e-6;
  const accepted = missAccepted && bPlaneAccepted && periluneAccepted;

  const missScore = Number.isFinite(missKm)
    ? clamp(1 - (missResidualKm / Math.max(limits.missLimitKm, 1)), 0, 1)
    : 0;
  const bPlaneScore = Number.isFinite(bPlaneKm)
    ? clamp(1 - (bPlaneResidualKm / Math.max(limits.bPlaneLimitKm, 1)), 0, 1)
    : 0;
  const periluneScore = Number.isFinite(periluneKm)
    ? clamp(1 - (periluneResidualKm / Math.max(limits.periluneMaxKm, 1)), 0, 1)
    : 0;
  const score = clamp(
    (missScore * 0.42)
    + (bPlaneScore * 0.36)
    + (periluneScore * 0.22),
    0,
    1,
  );

  const failures = [];
  if (!missAccepted) {
    failures.push(`miss ${Number.isFinite(missKm) ? missKm.toFixed(0) : "n/a"} km > ${limits.missLimitKm.toFixed(0)} km`);
  }
  if (!bPlaneAccepted) {
    failures.push(`B-plane ${Number.isFinite(bPlaneKm) ? bPlaneKm.toFixed(0) : "n/a"} km > ${limits.bPlaneLimitKm.toFixed(0)} km`);
  }
  if (!periluneAccepted) {
    failures.push(`perilune ${Number.isFinite(periluneKm) ? periluneKm.toFixed(0) : "n/a"} km > ${limits.periluneMaxKm.toFixed(0)} km`);
  }

  return {
    accepted,
    score,
    reason: accepted ? "corridor-ready" : failures.join("; "),
    missAccepted,
    bPlaneAccepted,
    periluneAccepted,
    missResidualKm,
    bPlaneResidualKm,
    periluneResidualKm,
    limits,
  };
}
