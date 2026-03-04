import { LAUNCH_MISSION_IDS } from "../launchMissions.js";
import { NAVIGATION_DEFAULTS } from "../../navigation_system/navigationSystemConfig.js";

function finiteNumber(value, fallback = Number.NaN) {
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

function formatMassKg(value, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }
  return `${numeric.toFixed(Math.max(0, Number(digits) || 0))} kg`;
}

function normalizePhaseText(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function evaluateMoonTliGoNoGo({
  missionId = "",
  missionPhase = "",
  commandPhase = "coast",
  requestedThrottle = 0,
  periapsisKm = Number.NaN,
  altitudeKm = Number.NaN,
  propellantKg = Number.NaN,
  fuelBudget = null,
  missionElapsedInPhaseSec = 0,
  moonDepartureWindowReady = null,
  moonDepartureWindowWaitSec = null,
  plannerConfig = NAVIGATION_DEFAULTS?.planner,
  minPeriapsisKm = 130,
  minAltitudeKm = 120,
  minPropellantKg = 1,
  maxWindowHoldSec = 300,
} = {}) {
  const normalizedMissionId = String(missionId || "").trim();
  const normalizedMissionPhase = normalizePhaseText(missionPhase);
  const normalizedCommandPhase = normalizePhaseText(commandPhase);
  const throttle = Math.max(0, Number(requestedThrottle) || 0);
  const applies = (
    normalizedMissionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
    && normalizedMissionPhase === "tli_burn"
    && normalizedCommandPhase === "powered"
    && throttle > 1e-4
  );
  if (!applies) {
    return {
      applies: false,
      go: true,
      status: "n/a",
      reason: "",
      failures: [],
    };
  }

  const checks = [];
  const addCheck = (name, pass, failMessage) => {
    checks.push({ name, pass: Boolean(pass), failMessage: String(failMessage || "") });
  };

  const periapsis = finiteNumber(periapsisKm);
  const altitude = finiteNumber(altitudeKm);
  const propellant = finiteNumber(propellantKg);
  const phaseElapsedSec = Math.max(0, finiteNumber(missionElapsedInPhaseSec, 0));
  const windowWaitSec = Math.max(0, finiteNumber(moonDepartureWindowWaitSec, Number.NaN));
  const windowReady = moonDepartureWindowReady === null
    ? null
    : Boolean(moonDepartureWindowReady);
  const planner = plannerConfig && typeof plannerConfig === "object"
    ? plannerConfig
    : NAVIGATION_DEFAULTS.planner;
  const periapsisFloorKm = Math.max(80, finiteNumber(minPeriapsisKm, 130));
  const altitudeFloorKm = Math.max(80, finiteNumber(minAltitudeKm, 120));
  const propellantFloorKg = Math.max(0.01, finiteNumber(minPropellantKg, 1));
  const windowHoldLimitSec = Math.max(10, finiteNumber(maxWindowHoldSec, 300));
  const shortWindowWait = Number.isFinite(windowWaitSec) && windowWaitSec > 1 && windowWaitSec <= windowHoldLimitSec;
  const shouldWindowHold = windowReady === false && shortWindowWait && phaseElapsedSec < windowWaitSec;

  addCheck(
    "periapsis-safe",
    Number.isFinite(periapsis) && periapsis >= periapsisFloorKm,
    `periapsis ${formatKm(periapsis)} is below ${formatKm(periapsisFloorKm)}`,
  );
  addCheck(
    "earth-clearance",
    Number.isFinite(altitude) && altitude >= altitudeFloorKm,
    `altitude ${formatKm(altitude)} is below ${formatKm(altitudeFloorKm)}`,
  );
  addCheck(
    "propellant-available",
    Number.isFinite(propellant) && propellant > propellantFloorKg,
    `propellant ${formatMassKg(propellant)} is below ${formatMassKg(propellantFloorKg)}`,
  );
  if (fuelBudget && typeof fuelBudget === "object") {
    const feasible = Boolean(fuelBudget.feasible);
    const marginKg = finiteNumber(fuelBudget.marginKg);
    addCheck(
      "fuel-budget",
      feasible,
      `fuel budget deficit (${formatMassKg(marginKg)})`,
    );
  }
  addCheck(
    "window-ready",
    !shouldWindowHold,
    `holding for launch window (${Math.max(0, Math.ceil(windowWaitSec - phaseElapsedSec))}s remaining)`,
  );

  const failures = checks.filter((entry) => !entry.pass);
  const go = failures.length === 0;
  const status = go ? "GO" : "NO-GO";
  const reason = go
    ? [
      "GO for TLI burn:",
      `periapsis ${formatKm(periapsis)} >= ${formatKm(periapsisFloorKm)}`,
      `altitude ${formatKm(altitude)} >= ${formatKm(altitudeFloorKm)}`,
      `propellant ${formatMassKg(propellant)}`,
    ].join(" ")
    : `NO-GO for TLI burn: ${failures.map((entry) => entry.failMessage).join("; ")}.`;

  return {
    applies: true,
    go,
    status,
    reason,
    failures: failures.map((entry) => entry.name),
    diagnostics: {
      periapsisKm: Number.isFinite(periapsis) ? periapsis : null,
      periapsisMinKm: periapsisFloorKm,
      altitudeKm: Number.isFinite(altitude) ? altitude : null,
      altitudeMinKm: altitudeFloorKm,
      propellantKg: Number.isFinite(propellant) ? propellant : null,
      propellantMinKg: propellantFloorKg,
      fuelBudgetFeasible: fuelBudget && typeof fuelBudget === "object"
        ? Boolean(fuelBudget.feasible)
        : null,
      fuelBudgetMarginKg: fuelBudget && typeof fuelBudget === "object"
        ? finiteNumber(fuelBudget.marginKg, null)
        : null,
      windowReady,
      windowWaitSec: Number.isFinite(windowWaitSec) ? windowWaitSec : null,
      windowHoldLimitSec,
      tliMissGateKm: finiteNumber(planner?.moonMidcourseMissDistanceKm, 95_000),
    },
  };
}
