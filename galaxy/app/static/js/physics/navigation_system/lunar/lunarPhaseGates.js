import { NAVIGATION_DEFAULTS } from "../navigationSystemConfig.js";

function finiteOr(value, fallback = Number.NaN) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatKm(value, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }
  return `${numeric.toFixed(Math.max(0, Number(digits) || 0))} km`;
}

function formatSpeed(value, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }
  return `${numeric.toFixed(Math.max(0, Number(digits) || 0))} km/s`;
}

function formatMassKg(value, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }
  return `${numeric.toFixed(Math.max(0, Number(digits) || 0))} kg`;
}

function plannerThresholds(plannerConfig = NAVIGATION_DEFAULTS.planner) {
  return {
    minClosingKmS: Math.max(0.001, finiteOr(plannerConfig?.moonMidcourseMinClosingSpeedKmS, 0.02)),
    missGateKm: Math.max(1_000, finiteOr(plannerConfig?.moonMidcourseMissDistanceKm, 95_000)),
    captureGateKm: Math.max(1_000, finiteOr(plannerConfig?.moonCaptureGateDistanceKm, 55_000)),
    bPlaneToleranceKm: Math.max(100, finiteOr(plannerConfig?.moonBPlaneToleranceKm, 6_000)),
    targetPeriluneKm: Math.max(20, finiteOr(plannerConfig?.moonTargetPeriluneAltitudeKm, 120)),
    targetPeriluneTolKm: Math.max(10, finiteOr(plannerConfig?.moonTargetPeriluneToleranceKm, 80)),
    captureUpperAltitudeKm: Math.max(100, finiteOr(plannerConfig?.moonCaptureUpperAltitudeKm, 16_000)),
  };
}

function validOrPass(metricValue, predicate) {
  const numeric = Number(metricValue);
  if (!Number.isFinite(numeric)) {
    return true;
  }
  return predicate(numeric);
}

export function evaluateMoonTliExitGate({
  vehicle = null,
  orbital = null,
  moonMetrics = {},
  plannerConfig = NAVIGATION_DEFAULTS.planner,
  minPeriapsisKm = 130,
  fallbackDurationSec = 520,
} = {}) {
  const thresholds = plannerThresholds(plannerConfig);
  const tliDurationSec = Math.max(60, finiteOr(vehicle?.tliDurationSec, fallbackDurationSec));
  const tliTimeoutSec = Math.max(tliDurationSec + 360, tliDurationSec * 1.75);
  const phaseElapsedSec = Math.max(0, finiteOr(vehicle?.phaseElapsedSec, 0));
  const periapsisKm = finiteOr(orbital?.periapsisKm, Number.NaN);
  const propellantKg = Math.max(0, finiteOr(vehicle?.propellantKg, 0));

  const fuelBudget = vehicle?.fuelBudget && typeof vehicle.fuelBudget === "object"
    ? vehicle.fuelBudget
    : null;
  const fuelBudgetFeasible = fuelBudget ? Boolean(fuelBudget.feasible) : true;
  const fuelBudgetMarginKg = finiteOr(fuelBudget?.marginKg, Number.NaN);

  const projectedMissDistanceKm = finiteOr(moonMetrics?.projectedMissDistanceKm, Number.NaN);
  const projectedPeriluneAltitudeKm = finiteOr(moonMetrics?.projectedPeriluneAltitudeKm, Number.NaN);
  const bPlaneErrorKm = finiteOr(moonMetrics?.bPlaneErrorKm, Number.NaN);
  const closingSpeedKmS = finiteOr(moonMetrics?.closingSpeedKmS, Number.NaN);

  const durationReady = phaseElapsedSec >= tliDurationSec;
  const timeoutReady = phaseElapsedSec >= tliTimeoutSec;
  const periapsisReady = Number.isFinite(periapsisKm) ? periapsisKm >= Number(minPeriapsisKm) : false;
  const fuelReady = fuelBudgetFeasible;
  const propellantDepleted = propellantKg <= 1e-3;

  const bPlaneGateKm = Math.max(
    thresholds.bPlaneToleranceKm * 2.2,
    thresholds.captureGateKm * 0.75,
  );
  const periluneFloorKm = Math.max(
    20,
    thresholds.targetPeriluneKm - (thresholds.targetPeriluneTolKm * 8),
  );
  const periluneCeilingKm = Math.max(
    periluneFloorKm + 500,
    thresholds.captureUpperAltitudeKm + (thresholds.targetPeriluneTolKm * 5),
  );

  const closingReady = validOrPass(
    closingSpeedKmS,
    (value) => value >= (thresholds.minClosingKmS * 0.5),
  );
  const missReady = validOrPass(
    projectedMissDistanceKm,
    (value) => value <= thresholds.missGateKm,
  );
  const bPlaneReady = validOrPass(
    bPlaneErrorKm,
    (value) => value <= bPlaneGateKm,
  );
  const periluneReady = validOrPass(
    projectedPeriluneAltitudeKm,
    (value) => value >= periluneFloorKm && value <= periluneCeilingKm,
  );
  const trajectoryReady = closingReady && missReady && bPlaneReady && periluneReady;

  const ready =
    periapsisReady
    && fuelReady
    && (
      propellantDepleted
      || timeoutReady
      || (durationReady && trajectoryReady)
    );

  return {
    ready,
    tliDurationSec,
    tliTimeoutSec,
    phaseElapsedSec,
    periapsisKm,
    periapsisMinKm: Number(minPeriapsisKm),
    fuelBudgetFeasible,
    fuelBudgetMarginKg,
    projectedMissDistanceKm,
    projectedMissGateKm: thresholds.missGateKm,
    projectedPeriluneAltitudeKm,
    projectedPeriluneFloorKm: periluneFloorKm,
    projectedPeriluneCeilingKm: periluneCeilingKm,
    bPlaneErrorKm,
    bPlaneGateKm,
    closingSpeedKmS,
    closingMinKmS: thresholds.minClosingKmS * 0.5,
    durationReady,
    timeoutReady,
    periapsisReady,
    fuelReady,
    propellantDepleted,
    trajectoryReady,
  };
}

export function evaluateMoonCaptureEntryGate({
  moonMetrics = {},
  plannerConfig = NAVIGATION_DEFAULTS.planner,
} = {}) {
  const thresholds = plannerThresholds(plannerConfig);
  const moonDistanceKm = finiteOr(moonMetrics?.distanceKm, Number.NaN);
  const closingSpeedKmS = finiteOr(moonMetrics?.closingSpeedKmS, Number.NaN);
  const projectedMissDistanceKm = finiteOr(moonMetrics?.projectedMissDistanceKm, Number.NaN);
  const projectedPeriluneAltitudeKm = finiteOr(moonMetrics?.projectedPeriluneAltitudeKm, Number.NaN);
  const bPlaneErrorKm = finiteOr(moonMetrics?.bPlaneErrorKm, Number.NaN);

  const bPlaneGateKm = Math.max(
    thresholds.bPlaneToleranceKm * 2.8,
    thresholds.captureGateKm * 1.2,
  );
  const periluneCeilingKm = Math.max(
    thresholds.captureUpperAltitudeKm + (thresholds.targetPeriluneTolKm * 6),
    8_000,
  );
  const closingGateKmS = thresholds.minClosingKmS * 0.18;

  const distanceReady = Number.isFinite(moonDistanceKm)
    ? moonDistanceKm <= thresholds.captureGateKm
    : false;
  const closingReady = validOrPass(closingSpeedKmS, (value) => value > closingGateKmS);
  const missReady = validOrPass(projectedMissDistanceKm, (value) => value <= thresholds.captureGateKm * 1.3);
  const bPlaneReady = validOrPass(bPlaneErrorKm, (value) => value <= bPlaneGateKm);
  const periluneReady = validOrPass(projectedPeriluneAltitudeKm, (value) => value <= periluneCeilingKm);
  const ready = distanceReady && closingReady && missReady && bPlaneReady && periluneReady;

  return {
    ready,
    moonDistanceKm,
    captureGateKm: thresholds.captureGateKm,
    closingSpeedKmS,
    closingGateKmS,
    projectedMissDistanceKm,
    projectedMissGateKm: thresholds.captureGateKm * 1.3,
    projectedPeriluneAltitudeKm,
    projectedPeriluneCeilingKm: periluneCeilingKm,
    bPlaneErrorKm,
    bPlaneGateKm,
    distanceReady,
    closingReady,
    missReady,
    bPlaneReady,
    periluneReady,
  };
}

export function describeMoonTliExitGate(gate = {}) {
  const fuelBudgetLabel = gate.fuelBudgetFeasible ? "feasible" : "deficit";
  const fuelMarginLabel = Number.isFinite(gate.fuelBudgetMarginKg)
    ? ` (${formatMassKg(gate.fuelBudgetMarginKg)})`
    : "";
  return [
    `Awaiting TLI gate: t=${Math.round(Math.max(0, finiteOr(gate.phaseElapsedSec, 0)))}s / ${Math.round(Math.max(0, finiteOr(gate.tliDurationSec, 0)))}s.`,
    `Periapsis ${formatKm(gate.periapsisKm)} >= ${formatKm(gate.periapsisMinKm)}.`,
    `Miss ${formatKm(gate.projectedMissDistanceKm)} <= ${formatKm(gate.projectedMissGateKm)}.`,
    `B-plane ${formatKm(gate.bPlaneErrorKm)} <= ${formatKm(gate.bPlaneGateKm)}.`,
    `Perilune est ${formatKm(gate.projectedPeriluneAltitudeKm)}.`,
    `Fuel budget ${fuelBudgetLabel}${fuelMarginLabel}.`,
  ].join(" ");
}

export function describeMoonCaptureEntryGate(gate = {}) {
  return [
    `Awaiting lunar approach: distance ${formatKm(gate.moonDistanceKm)} <= ${formatKm(gate.captureGateKm)}.`,
    `Closing ${formatSpeed(gate.closingSpeedKmS)} > ${formatSpeed(gate.closingGateKmS)}.`,
    `Miss ${formatKm(gate.projectedMissDistanceKm)} <= ${formatKm(gate.projectedMissGateKm)}.`,
    `B-plane ${formatKm(gate.bPlaneErrorKm)} <= ${formatKm(gate.bPlaneGateKm)}.`,
    `Perilune est ${formatKm(gate.projectedPeriluneAltitudeKm)} <= ${formatKm(gate.projectedPeriluneCeilingKm)}.`,
  ].join(" ");
}

