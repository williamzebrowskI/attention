import {
  add,
  clamp,
  normalize,
  scale,
} from "../launchMath.js";

const MOON_REFUEL_RECOVERY_PERIAPSIS_HARD_MIN_KM = 130;
const MOON_REFUEL_RECOVERY_PERIAPSIS_SOFT_MIN_KM = 145;
const MOON_REFUEL_RECOVERY_SOFT_RADIAL_DESCEND_KM_S = -0.0015;
const MOON_REFUEL_RECOVERY_BURN_WINDOW_SEC = 260;
const MOON_REFUEL_RECOVERY_THROTTLE_BASE = 0.24;
const MOON_REFUEL_RECOVERY_THROTTLE_MAX = 0.58;
const MOON_REFUEL_RECOVERY_EMERGENCY_ALTITUDE_KM = 170;
const MOON_REFUEL_RECOVERY_EMERGENCY_THROTTLE_BASE = 0.38;
const MOON_REFUEL_RECOVERY_EMERGENCY_THROTTLE_MAX = 0.78;

export function computeMoonRefuelRecoveryOverride({
  missionPhase,
  orbital,
  tangent,
  up,
} = {}) {
  if (String(missionPhase || "") !== "orbital_refuel") {
    return null;
  }
  const periapsisKm = Number(orbital?.periapsisKm);
  const altitudeKm = Number(orbital?.altitudeKm);
  const radialSpeedKmS = Number(orbital?.radialSpeedKmS) || 0;
  const timeToApoapsisSec = Number(orbital?.timeToApoapsisSec);
  const nearApoapsisForRecovery = Number.isFinite(timeToApoapsisSec)
    && Math.abs(timeToApoapsisSec) <= MOON_REFUEL_RECOVERY_BURN_WINDOW_SEC;
  const emergencyRecoveryNeeded = Number.isFinite(periapsisKm)
    && periapsisKm < 0
    && Number.isFinite(altitudeKm)
    && altitudeKm < MOON_REFUEL_RECOVERY_EMERGENCY_ALTITUDE_KM;
  if (emergencyRecoveryNeeded) {
    const periapsisDeficitKm = Math.max(0, Math.abs(periapsisKm));
    const throttle = clamp(
      MOON_REFUEL_RECOVERY_EMERGENCY_THROTTLE_BASE + (periapsisDeficitKm / 1800),
      MOON_REFUEL_RECOVERY_EMERGENCY_THROTTLE_BASE,
      MOON_REFUEL_RECOVERY_EMERGENCY_THROTTLE_MAX,
    );
    return {
      phase: "powered",
      throttle,
      direction: normalize(
        add(scale(tangent, 0.93), scale(up, 0.07)),
        tangent,
      ),
      mode: "navsys:orbital-refuel-orbit-recovery-emergency-burn",
      gateReason: "Periapsis emergency recovery active before rendezvous guidance.",
    };
  }
  const recoveryNeeded = Number.isFinite(periapsisKm)
    && (
      periapsisKm < MOON_REFUEL_RECOVERY_PERIAPSIS_HARD_MIN_KM
      || (
        periapsisKm < MOON_REFUEL_RECOVERY_PERIAPSIS_SOFT_MIN_KM
        && radialSpeedKmS < MOON_REFUEL_RECOVERY_SOFT_RADIAL_DESCEND_KM_S
      )
    );
  if (!recoveryNeeded) {
    return null;
  }
  if (nearApoapsisForRecovery) {
    const periapsisDeficitKm = Math.max(
      0,
      MOON_REFUEL_RECOVERY_PERIAPSIS_SOFT_MIN_KM - periapsisKm,
    );
    const throttle = clamp(
      MOON_REFUEL_RECOVERY_THROTTLE_BASE + (periapsisDeficitKm / 220),
      MOON_REFUEL_RECOVERY_THROTTLE_BASE,
      MOON_REFUEL_RECOVERY_THROTTLE_MAX,
    );
    return {
      phase: "powered",
      throttle,
      direction: tangent,
      mode: "navsys:orbital-refuel-orbit-recovery-burn",
      gateReason: "Periapsis recovery burn active before rendezvous guidance.",
    };
  }
  return {
    phase: "coast",
    throttle: 0,
    direction: tangent,
    mode: "navsys:orbital-refuel-orbit-recovery-coast",
    gateReason: "Coasting to apoapsis for safe periapsis recovery burn window.",
  };
}
