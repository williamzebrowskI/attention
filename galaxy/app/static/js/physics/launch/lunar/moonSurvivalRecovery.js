import {
  add,
  clamp,
  normalize,
  scale,
} from "../launchMath.js";

const MOON_SURVIVAL_PHASES = new Set([
  "tli_burn",
  "coast_to_moon",
  "lunar_capture",
  "coast_to_earth",
  "earth_capture",
]);

const MOON_SURVIVAL_HARD_MIN_PERIAPSIS_KM = 130;
const MOON_SURVIVAL_SOFT_MIN_PERIAPSIS_KM = 136;
const MOON_SURVIVAL_RELEASE_PERIAPSIS_KM = 152;
const MOON_SURVIVAL_RELEASE_ALTITUDE_KM = 138;
const MOON_SURVIVAL_RELEASE_DESCENT_KM_S = -0.0002;
const MOON_SURVIVAL_SOFT_DESCENT_KM_S = -0.0014;
const MOON_SURVIVAL_EMERGENCY_ALTITUDE_KM = 125;
const MOON_SURVIVAL_THROTTLE_BASE = 0.24;
const MOON_SURVIVAL_THROTTLE_MAX = 0.82;
const MOON_SURVIVAL_UP_BIAS_BASE = 0.14;
const MOON_SURVIVAL_UP_BIAS_MAX = 0.45;

function finite(value, fallback = Number.NaN) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function computeMoonSurvivalRecoveryOverride({
  missionPhase,
  periapsisKm,
  altitudeKm,
  radialSpeedKmS,
  prograde,
  up,
  availablePropellantKg,
  recoveryWasActive = false,
  reasonPrefix = "",
} = {}) {
  if (!MOON_SURVIVAL_PHASES.has(String(missionPhase || "").trim().toLowerCase())) {
    return null;
  }
  const propellantKg = Math.max(0, finite(availablePropellantKg, 0));
  if (!(propellantKg > 1e-6)) {
    return null;
  }

  const periapsis = finite(periapsisKm);
  const altitude = finite(altitudeKm);
  const radial = finite(radialSpeedKmS, 0);

  const emergencyRecoveryNeeded = (
    (Number.isFinite(periapsis) && periapsis < 0)
    || (Number.isFinite(altitude) && altitude < MOON_SURVIVAL_EMERGENCY_ALTITUDE_KM)
  );
  const hardRecoveryNeeded = Number.isFinite(periapsis) && periapsis < MOON_SURVIVAL_HARD_MIN_PERIAPSIS_KM;
  const softRecoveryNeeded = (
    Number.isFinite(periapsis)
    && periapsis < MOON_SURVIVAL_SOFT_MIN_PERIAPSIS_KM
    && radial < MOON_SURVIVAL_SOFT_DESCENT_KM_S
  );
  const releaseReady = (
    Number.isFinite(periapsis)
    && periapsis >= MOON_SURVIVAL_RELEASE_PERIAPSIS_KM
    && Number.isFinite(altitude)
    && altitude >= MOON_SURVIVAL_RELEASE_ALTITUDE_KM
    && radial >= MOON_SURVIVAL_RELEASE_DESCENT_KM_S
  );
  const latchedRecoveryNeeded = Boolean(recoveryWasActive) && !releaseReady;

  if (!emergencyRecoveryNeeded && !hardRecoveryNeeded && !softRecoveryNeeded && !latchedRecoveryNeeded) {
    return null;
  }

  const periapsisDeficitKm = Number.isFinite(periapsis)
    ? Math.max(0, MOON_SURVIVAL_SOFT_MIN_PERIAPSIS_KM - periapsis)
    : (MOON_SURVIVAL_SOFT_MIN_PERIAPSIS_KM - MOON_SURVIVAL_HARD_MIN_PERIAPSIS_KM);

  const emergencyBoost = emergencyRecoveryNeeded ? 0.16 : 0;
  const throttle = clamp(
    MOON_SURVIVAL_THROTTLE_BASE + (periapsisDeficitKm / 180) + emergencyBoost,
    MOON_SURVIVAL_THROTTLE_BASE,
    MOON_SURVIVAL_THROTTLE_MAX,
  );
  const upBias = clamp(
    MOON_SURVIVAL_UP_BIAS_BASE + (periapsisDeficitKm / 220) + (emergencyRecoveryNeeded ? 0.1 : 0),
    MOON_SURVIVAL_UP_BIAS_BASE,
    MOON_SURVIVAL_UP_BIAS_MAX,
  );

  const gateDetails = [
    reasonPrefix ? String(reasonPrefix).trim() : "",
    `Survival periapsis recovery active (periapsis ${Number.isFinite(periapsis) ? `${periapsis.toFixed(1)} km` : "n/a"}, altitude ${Number.isFinite(altitude) ? `${altitude.toFixed(1)} km` : "n/a"}).`,
  ].filter(Boolean).join(" ");

  return {
    phase: "powered",
    throttle,
    direction: normalize(
      add(scale(prograde, 1), scale(up, upBias)),
      prograde,
    ),
    mode: emergencyRecoveryNeeded
      ? "navsys:moon-survival-emergency-recovery"
      : "navsys:moon-survival-periapsis-recovery",
    gateReason: gateDetails,
    diagnostics: {
      emergencyRecoveryNeeded,
      hardRecoveryNeeded,
      softRecoveryNeeded,
      latchedRecoveryNeeded,
      periapsisKm: Number.isFinite(periapsis) ? periapsis : null,
      altitudeKm: Number.isFinite(altitude) ? altitude : null,
      radialSpeedKmS: Number.isFinite(radial) ? radial : null,
      periapsisDeficitKm,
      throttle,
      upBias,
    },
  };
}
