import { clamp, normalize } from "../../launch/launchMath.js";
import { LAUNCH_MISSION_IDS } from "../../launch/launchMissions.js";
import { computeMoonSurvivalRecoveryOverride } from "../../launch/lunar/moonSurvivalRecovery.js";
import { evaluateMoonTliGoNoGo } from "../../launch/lunar/moonGoNoGoGates.js";

const MOON_BURN_PHASES = new Set([
  "tli_burn",
  "coast_to_moon",
  "lunar_capture",
]);

function finiteNumber(value, fallback = Number.NaN) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizePhase(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isEarthEscapeTrajectory(orbital = null) {
  const specificEnergy = finiteNumber(orbital?.specificEnergy);
  return Number.isFinite(specificEnergy) && specificEnergy >= 0;
}

function allowsEarthPeriapsisRecovery({
  missionPhase = "",
  orbital = null,
} = {}) {
  const phase = normalizePhase(missionPhase);
  if (phase === "tli_burn") {
    return true;
  }
  if (phase === "coast_to_moon" || phase === "lunar_capture") {
    return !isEarthEscapeTrajectory(orbital);
  }
  return phase === "coast_to_earth" || phase === "earth_capture";
}

function applySurvivalRecovery({
  survivalRecovery,
  requestedThrottle,
  desiredDirection,
  guidanceMode,
  prograde,
} = {}) {
  if (!survivalRecovery) {
    return {
      requestedThrottle,
      desiredDirection,
      guidanceMode,
      survivalRecoveryActive: false,
      moonGoNoGoReason: "",
    };
  }
  return {
    requestedThrottle: clamp(Number(survivalRecovery.throttle) || 0, 0, 1),
    desiredDirection: normalize(survivalRecovery.direction || prograde, prograde),
    guidanceMode: String(survivalRecovery.mode || "navsys:moon-survival-recovery"),
    survivalRecoveryActive: true,
    moonGoNoGoReason: String(survivalRecovery.gateReason || ""),
  };
}

export function resolveMoonMissionGuidanceArbitration({
  vehicleRole = "",
  missionId = "",
  missionPhase = "",
  requestedThrottle = 0,
  desiredDirection = null,
  guidanceMode = "",
  orbital = null,
  missionFuelBudget = null,
  availablePropellantKg = Number.NaN,
  prograde = null,
  up = null,
  recoveryWasActive = false,
  missionElapsedInPhaseSec = 0,
  moonDepartureWindowReady = null,
  moonDepartureWindowWaitSec = null,
  departurePredictedMissDistanceKm = Number.NaN,
  departurePredictedPeriluneAltitudeKm = Number.NaN,
  departureBPlaneErrorKm = Number.NaN,
  plannerConfig = null,
  minPeriapsisKm = 130,
  minAltitudeKm = 120,
  minPropellantKg = 1,
  ignoreWindowReady = false,
  conserveMarginKg = 220_000,
  criticalMarginKg = 120_000,
} = {}) {
  const passthrough = {
    requestedThrottle: clamp(Number(requestedThrottle) || 0, 0, 1),
    desiredDirection: normalize(desiredDirection || prograde, prograde),
    guidanceMode: String(guidanceMode || ""),
    survivalRecoveryActive: false,
    moonGoNoGoStatus: "n/a",
    moonGoNoGoReason: "",
    moonGoNoGo: {
      applies: false,
      go: true,
      status: "n/a",
      reason: "",
      failures: [],
    },
    diagnostics: {
      survivalRecoveryAllowed: false,
      earthEscapeTrajectory: isEarthEscapeTrajectory(orbital),
      selectedOverride: "none",
    },
  };

  if (vehicleRole === "tanker" || missionId !== LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
    return passthrough;
  }

  const phase = normalizePhase(missionPhase);
  const baseThrottle = passthrough.requestedThrottle;
  const baseDirection = passthrough.desiredDirection;
  const burnPhase = MOON_BURN_PHASES.has(phase);
  const survivalRecoveryAllowed = allowsEarthPeriapsisRecovery({
    missionPhase: phase,
    orbital,
  });
  const earthEscapeTrajectory = isEarthEscapeTrajectory(orbital);

  let nextThrottle = baseThrottle;
  let nextDirection = baseDirection;
  let nextMode = passthrough.guidanceMode;
  let moonGoNoGoStatus = "n/a";
  let moonGoNoGoReason = "";
  let survivalRecoveryActive = false;
  let selectedOverride = "none";

  const baseSurvivalRecovery = (
    survivalRecoveryAllowed
    && (phase !== "tli_burn" || Boolean(recoveryWasActive))
  )
    ? computeMoonSurvivalRecoveryOverride({
      missionPhase: phase,
      periapsisKm: finiteNumber(orbital?.periapsisKm),
      altitudeKm: finiteNumber(orbital?.altitudeKm),
      radialSpeedKmS: finiteNumber(orbital?.radialSpeedKmS),
      prograde,
      up,
      availablePropellantKg,
      recoveryWasActive,
    })
    : null;

  const moonGoNoGo = evaluateMoonTliGoNoGo({
    missionId,
    missionPhase: phase,
    commandPhase: baseThrottle > 1e-4 ? "powered" : "coast",
    requestedThrottle: baseThrottle,
    periapsisKm: finiteNumber(orbital?.periapsisKm),
    altitudeKm: finiteNumber(orbital?.altitudeKm),
    propellantKg: availablePropellantKg,
    fuelBudget: missionFuelBudget,
    missionElapsedInPhaseSec,
    moonDepartureWindowReady,
    moonDepartureWindowWaitSec,
    departurePredictedMissDistanceKm,
    departurePredictedPeriluneAltitudeKm,
    departureBPlaneErrorKm,
    plannerConfig,
    minPeriapsisKm,
    minAltitudeKm,
    minPropellantKg,
    ignoreWindowReady,
  });
  if (moonGoNoGo.applies) {
    moonGoNoGoStatus = moonGoNoGo.status;
    moonGoNoGoReason = moonGoNoGo.reason;
  }

  const goNoGoPeriapsisFailure = Array.isArray(moonGoNoGo.failures)
    && moonGoNoGo.failures.includes("periapsis-safe");
  const goNoGoSurvivalRecovery = (
    moonGoNoGo.applies
    && !moonGoNoGo.go
    && goNoGoPeriapsisFailure
    && survivalRecoveryAllowed
  )
    ? computeMoonSurvivalRecoveryOverride({
      missionPhase: phase,
      periapsisKm: finiteNumber(moonGoNoGo?.diagnostics?.periapsisKm),
      altitudeKm: finiteNumber(moonGoNoGo?.diagnostics?.altitudeKm),
      radialSpeedKmS: finiteNumber(orbital?.radialSpeedKmS),
      prograde,
      up,
      availablePropellantKg,
      recoveryWasActive: Boolean(recoveryWasActive) || Boolean(baseSurvivalRecovery),
      reasonPrefix: moonGoNoGo.reason,
    })
    : null;

  const budgetFeasible = Boolean(missionFuelBudget?.feasible);
  const budgetMarginKg = finiteNumber(missionFuelBudget?.marginKg);
  const budgetHardHoldApplies = (
    burnPhase
    && !budgetFeasible
    && Math.max(0, finiteNumber(availablePropellantKg, 0)) > 1e-6
  );
  const budgetSurvivalRecovery = (
    budgetHardHoldApplies
    && survivalRecoveryAllowed
  )
    ? computeMoonSurvivalRecoveryOverride({
      missionPhase: phase,
      periapsisKm: finiteNumber(orbital?.periapsisKm),
      altitudeKm: finiteNumber(orbital?.altitudeKm),
      radialSpeedKmS: finiteNumber(orbital?.radialSpeedKmS),
      prograde,
      up,
      availablePropellantKg,
      recoveryWasActive: Boolean(recoveryWasActive) || Boolean(baseSurvivalRecovery),
      reasonPrefix: "Fuel budget hold overridden by survival recovery.",
    })
    : null;

  const selectedSurvivalRecovery = (
    goNoGoSurvivalRecovery
    || baseSurvivalRecovery
    || budgetSurvivalRecovery
  );

  if (selectedSurvivalRecovery) {
    const applied = applySurvivalRecovery({
      survivalRecovery: selectedSurvivalRecovery,
      requestedThrottle: nextThrottle,
      desiredDirection: nextDirection,
      guidanceMode: nextMode,
      prograde,
    });
    nextThrottle = applied.requestedThrottle;
    nextDirection = applied.desiredDirection;
    nextMode = applied.guidanceMode;
    survivalRecoveryActive = applied.survivalRecoveryActive;
    moonGoNoGoReason = applied.moonGoNoGoReason || moonGoNoGoReason;
    selectedOverride = goNoGoSurvivalRecovery
      ? "go-no-go-survival-recovery"
      : (baseSurvivalRecovery ? "survival-recovery" : "fuel-budget-survival-recovery");
  } else if (moonGoNoGo.applies && !moonGoNoGo.go) {
    nextThrottle = 0;
    nextMode = nextMode.includes("go-no-go-hold")
      ? nextMode
      : `${nextMode}:go-no-go-hold`;
    selectedOverride = "go-no-go-hold";
  } else if (budgetHardHoldApplies) {
    nextThrottle = 0;
    nextDirection = normalize(prograde, baseDirection);
    nextMode = "autopilot-moon-fuel-budget-hold";
    selectedOverride = "fuel-budget-hold";
  } else if (
    burnPhase
    && Number.isFinite(budgetMarginKg)
    && budgetMarginKg < conserveMarginKg
  ) {
    const conserveCap = budgetMarginKg < criticalMarginKg ? 0.16 : 0.24;
    nextThrottle = Math.min(nextThrottle, conserveCap);
    if (
      nextThrottle > 1e-3
      && (nextMode.startsWith("autopilot-") || nextMode.startsWith("navsys:"))
      && !nextMode.includes("fuel-conserve")
    ) {
      nextMode = `${nextMode}:fuel-conserve`;
    }
    selectedOverride = "fuel-conserve";
  }

  return {
    requestedThrottle: nextThrottle,
    desiredDirection: nextDirection,
    guidanceMode: nextMode,
    survivalRecoveryActive,
    moonGoNoGoStatus,
    moonGoNoGoReason,
    moonGoNoGo,
    diagnostics: {
      survivalRecoveryAllowed,
      earthEscapeTrajectory,
      selectedOverride,
      budgetHardHoldApplies,
      budgetMarginKg: Number.isFinite(budgetMarginKg) ? budgetMarginKg : null,
      baseSurvivalRecoveryActive: Boolean(baseSurvivalRecovery),
      goNoGoSurvivalRecoveryActive: Boolean(goNoGoSurvivalRecovery),
      budgetSurvivalRecoveryActive: Boolean(budgetSurvivalRecovery),
    },
  };
}
