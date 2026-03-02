const HOTSTAGE_OVERLAP_SECONDS = 1.8;
const HOTSTAGE_IGNITION_STABLE_DURATION_SEC = 0.45;
const HOTSTAGE_VIRTUAL_SEPARATION_MIN_KM = 0.003;
const HOTSTAGE_DETACH_TIMEOUT_MIN_SEC = 3.2;
const HOTSTAGE_DETACH_TIMEOUT_EXTRA_SEC = 1.4;
const HOTSTAGE_SEPARATION_RELATIVE_SPEED_KM_S = 0.002;
const HOTSTAGE_IGNITION_STABLE_THRUST_MIN_N = 1_200_000;
const HOTSTAGE_IGNITION_STABLE_THRUST_RATIO = 0.18;

function clampNonNegative(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, Number(fallback) || 0);
  }
  return Math.max(0, numeric);
}

export function hotstageOverlapSeconds() {
  return HOTSTAGE_OVERLAP_SECONDS;
}

export function hotstageIgnitionStableDurationSec() {
  return HOTSTAGE_IGNITION_STABLE_DURATION_SEC;
}

export function hotstageVirtualSeparationMinKm() {
  return HOTSTAGE_VIRTUAL_SEPARATION_MIN_KM;
}

export function hotstageSeparationRelativeSpeedKmS() {
  // 2 m/s relative separation is enough to avoid overlapping without a cartoon kick.
  return HOTSTAGE_SEPARATION_RELATIVE_SPEED_KM_S;
}

export function hotstageDetachTimeoutSec(overlapSeconds = hotstageOverlapSeconds()) {
  return Math.max(
    HOTSTAGE_DETACH_TIMEOUT_MIN_SEC,
    clampNonNegative(overlapSeconds, hotstageOverlapSeconds()) + HOTSTAGE_DETACH_TIMEOUT_EXTRA_SEC,
  );
}

export function hotstageIgnitionStableThrustN(stage2PeakThrustN = 0) {
  return Math.max(
    HOTSTAGE_IGNITION_STABLE_THRUST_MIN_N,
    clampNonNegative(stage2PeakThrustN) * HOTSTAGE_IGNITION_STABLE_THRUST_RATIO,
  );
}

export function createHotstageState() {
  return {
    active: false,
    ignitionTimeSec: null,
    overlapSeconds: hotstageOverlapSeconds(),
    boosterReservePropellantKg: 0,
    ignitionStableSec: 0,
    virtualSeparationKm: 0,
    detachReason: "",
  };
}

export function resetHotstageState(hotstage) {
  const state = hotstage && typeof hotstage === "object" ? hotstage : {};
  state.active = false;
  state.ignitionTimeSec = null;
  state.overlapSeconds = hotstageOverlapSeconds();
  state.boosterReservePropellantKg = 0;
  state.ignitionStableSec = 0;
  state.virtualSeparationKm = 0;
  state.detachReason = "";
  return state;
}

export function startHotstageSequence(hotstage, {
  elapsedSeconds = 0,
  boosterReservePropellantKg = 0,
  overlapSeconds = hotstageOverlapSeconds(),
} = {}) {
  const state = resetHotstageState(hotstage && typeof hotstage === "object" ? hotstage : {});
  state.active = true;
  state.ignitionTimeSec = Number.isFinite(Number(elapsedSeconds))
    ? Number(elapsedSeconds)
    : 0;
  state.overlapSeconds = clampNonNegative(overlapSeconds, hotstageOverlapSeconds());
  state.boosterReservePropellantKg = clampNonNegative(boosterReservePropellantKg);
  return state;
}

export function hotstageTimeSinceIgnitionSec(hotstage, elapsedSeconds) {
  if (!hotstage?.active) {
    return null;
  }
  const ignitionTimeSec = Number(hotstage.ignitionTimeSec);
  if (!Number.isFinite(ignitionTimeSec)) {
    return null;
  }
  return Math.max(0, (Number(elapsedSeconds) || 0) - ignitionTimeSec);
}

export function updateHotstageGates(hotstage, {
  elapsedSeconds = 0,
  stageIndex = 0,
  phase = "idle",
  stage2ThrustN = 0,
  stage2PeakThrustN = 0,
  dtSeconds = 0,
} = {}) {
  const state = hotstage && typeof hotstage === "object" ? hotstage : createHotstageState();
  const overlapSeconds = clampNonNegative(state.overlapSeconds, hotstageOverlapSeconds());
  const timeSinceIgnitionSec = hotstageTimeSinceIgnitionSec(state, elapsedSeconds);
  const finiteTimeSinceIgnitionSec = Number.isFinite(timeSinceIgnitionSec)
    ? timeSinceIgnitionSec
    : Number.POSITIVE_INFINITY;
  const ignitionStableThrustN = hotstageIgnitionStableThrustN(stage2PeakThrustN);
  const safeStage2ThrustN = clampNonNegative(stage2ThrustN);
  const ignitionStableThisStep =
    Number(stageIndex) === 1
    && phase === "powered"
    && safeStage2ThrustN >= ignitionStableThrustN;

  if (ignitionStableThisStep) {
    state.ignitionStableSec = Math.min(
      30,
      clampNonNegative(state.ignitionStableSec) + clampNonNegative(dtSeconds),
    );
  } else {
    state.ignitionStableSec = 0;
  }

  const virtualSeparationKm = Number.isFinite(finiteTimeSinceIgnitionSec)
    ? Math.max(0, hotstageSeparationRelativeSpeedKmS() * finiteTimeSinceIgnitionSec)
    : 0;
  state.virtualSeparationKm = virtualSeparationKm;

  const requiredStableSec = hotstageIgnitionStableDurationSec();
  const requiredSeparationKm = hotstageVirtualSeparationMinKm();
  const minOverlapSatisfied =
    Number.isFinite(finiteTimeSinceIgnitionSec)
    && finiteTimeSinceIgnitionSec >= overlapSeconds;
  const ignitionStableSatisfied = state.ignitionStableSec >= requiredStableSec;
  const separationSatisfied = virtualSeparationKm >= requiredSeparationKm;
  const timeoutSec = hotstageDetachTimeoutSec(overlapSeconds);
  const timeoutExceeded =
    Number.isFinite(finiteTimeSinceIgnitionSec)
    && finiteTimeSinceIgnitionSec >= timeoutSec;
  const detachReady =
    (minOverlapSatisfied && ignitionStableSatisfied && separationSatisfied)
    || timeoutExceeded;

  return {
    overlapSeconds,
    timeSinceIgnitionSec: finiteTimeSinceIgnitionSec,
    stage2ThrustN: safeStage2ThrustN,
    ignitionStableThrustN,
    ignitionStableSec: state.ignitionStableSec,
    virtualSeparationKm,
    requiredStableSec,
    requiredSeparationKm,
    timeoutSec,
    minOverlapSatisfied,
    ignitionStableSatisfied,
    separationSatisfied,
    timeoutExceeded,
    detachReady,
  };
}

export function finishHotstageDetach(hotstage, reason = "") {
  const state = hotstage && typeof hotstage === "object" ? hotstage : createHotstageState();
  state.active = false;
  state.boosterReservePropellantKg = 0;
  state.ignitionStableSec = 0;
  state.virtualSeparationKm = 0;
  state.detachReason = String(reason || "");
  return state;
}
