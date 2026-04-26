import {
  STANDARD_GRAVITY_M_S2,
  LAUNCH_BOOSTER_CONFIG,
  resolveConfiguredThrustBoundsN,
} from "./launchConfig.js";
import { resolveBoosterCatchCommand } from "./boosterCatchGuidance.js?v=20260425c";
import { LAUNCH_REALISM_CONFIG } from "./launchRealismConfig.js";

export const BOOSTER_STAGE_ATTITUDE_POLICY = Object.freeze({
  "attached-stack": Object.freeze({
    positionIntent: "locked-under-starship",
    attitudeIntent: "coaxial-with-stack",
    targetPosture: "shared-stack-axis",
    terminalUprightCommit: false,
  }),
  "separation-flip": Object.freeze({
    positionIntent: "clear-stage-separation-corridor",
    attitudeIntent: "rotate-away-from-stack-toward-return-axis",
    targetPosture: "transition-to-retrograde-return",
    terminalUprightCommit: false,
    qAlphaSteeringEnabled: false,
    siteTargetingEnabled: false,
    minRetrogradeWeight: 0.9,
  }),
  "separation-coast": Object.freeze({
    positionIntent: "build-clean-separation-spacing",
    attitudeIntent: "continue-rotation-into-return-attitude",
    targetPosture: "retrograde-biased-return",
    terminalUprightCommit: false,
    qAlphaSteeringEnabled: false,
    siteTargetingEnabled: false,
    minRetrogradeWeight: 0.9,
  }),
  "hotstage-ring-jettison": Object.freeze({
    positionIntent: "shed-hotstage-hardware-after-boostback",
    attitudeIntent: "hold-return-attitude-while-ring-separates",
    targetPosture: "controlled-post-boostback-coast",
    terminalUprightCommit: false,
    qAlphaSteeringEnabled: false,
    siteTargetingEnabled: true,
    minRetrogradeWeight: 0.1,
  }),
  boostback: Object.freeze({
    positionIntent: "drive-return-corridor-back-to-launch-site",
    attitudeIntent: "controlled-return-burn-with-lateral-corridor-shaping",
    targetPosture: "anti-tangent-biased-boostback",
    terminalUprightCommit: false,
    qAlphaSteeringEnabled: false,
    siteTargetingEnabled: true,
    minRetrogradeWeight: 0.10,
  }),
  "entry-align": Object.freeze({
    positionIntent: "settle-onto-controlled-entry-corridor",
    attitudeIntent: "rotate-upright-before-atmospheric-braking",
    targetPosture: "upright-entry-alignment",
    terminalUprightCommit: true,
    minUpWeight: 0.95,
  }),
  "ballistic-descent": Object.freeze({
    positionIntent: "continue-return-corridor-during-thin-air-fall",
    attitudeIntent: "maintain-upright-entry-stability",
    targetPosture: "upright-ballistic-descent",
    terminalUprightCommit: true,
    minUpWeight: 0.95,
  }),
  "ballistic-settle": Object.freeze({
    positionIntent: "hold-stable-return-corridor-while-aero-builds",
    attitudeIntent: "stabilize-upright-body-before-next-burn",
    targetPosture: "upright-ballistic-settle",
    terminalUprightCommit: true,
    minUpWeight: 0.95,
  }),
  "entry-burn": Object.freeze({
    positionIntent: "kill-entry-energy-without-losing-return-corridor",
    attitudeIntent: "burn-engines-down-and-near-vertical",
    targetPosture: "near-vertical-entry-burn",
    terminalUprightCommit: true,
    minUpWeight: 0.95,
  }),
  "descent-coast": Object.freeze({
    positionIntent: "stay-inside-terminal-return-corridor",
    attitudeIntent: "upright-aero-descent-with-low-tilt",
    targetPosture: "upright-descent-coast",
    terminalUprightCommit: true,
    minUpWeight: 0.95,
  }),
  "terminal-intercept": Object.freeze({
    positionIntent: "solve-terminal-corridor-miss-before-catch",
    attitudeIntent: "upright-grid-fin-and-rcs-intercept",
    targetPosture: "upright-terminal-intercept",
    terminalUprightCommit: true,
    minUpWeight: 0.88,
  }),
  "catch-approach": Object.freeze({
    positionIntent: "align-with-tower-catch-frame",
    attitudeIntent: "upright-low-rate-catch-approach",
    targetPosture: "upright-catch-approach",
    terminalUprightCommit: true,
    minUpWeight: 0.85,
  }),
  "catch-burn": Object.freeze({
    positionIntent: "remove-final-vertical-energy-inside-catch-box",
    attitudeIntent: "upright-catch-burn",
    targetPosture: "upright-catch-burn",
    terminalUprightCommit: true,
    minUpWeight: 0.95,
  }),
  "landing-burn": Object.freeze({
    positionIntent: "remove-final-descent-energy-before-tower-catch",
    attitudeIntent: "upright-13-engine-braking-burn",
    targetPosture: "upright-landing-burn-before-precision-catch",
    terminalUprightCommit: true,
    minUpWeight: 0.84,
  }),
  "catch-contact": Object.freeze({
    positionIntent: "enter-mechanical-contact-with-chopsticks",
    attitudeIntent: "upright-contact-alignment",
    targetPosture: "upright-catch-contact",
    terminalUprightCommit: true,
  }),
  "catch-capture": Object.freeze({
    positionIntent: "damp-into-chopstick-capture-constraint",
    attitudeIntent: "upright-capture-stabilization",
    targetPosture: "upright-catch-capture",
    terminalUprightCommit: true,
  }),
  caught: Object.freeze({
    positionIntent: "settled-in-catch-frame",
    attitudeIntent: "upright-captured",
    targetPosture: "upright-caught",
    terminalUprightCommit: true,
  }),
  landed: Object.freeze({
    positionIntent: "settled-on-pad",
    attitudeIntent: "upright-landed",
    targetPosture: "upright-landed",
    terminalUprightCommit: true,
  }),
});

export function resolveBoosterStageAttitudePolicy(phase = "") {
  return BOOSTER_STAGE_ATTITUDE_POLICY[String(phase || "").toLowerCase()] || null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export const BOOSTER_PUBLIC_RECOVERY_HARDWARE = Object.freeze({
  gridFinGeneration: "current-public-four-fin",
  separationControl: "hotstage-clearance-rcs-and-center-engine-gimbal",
  boostbackEngineSet: "inner-13",
  descentControl: "grid-fins-primary-with-rcs-trim",
  landingBurnEngineSet: "inner-13",
  precisionCatchEngineSet: "center-3",
  towerSensorMode: "tower-radar-relative",
  catchInterface: "upper-catch-points-under-grid-fins",
});

function boosterGridFinProfile() {
  return LAUNCH_REALISM_CONFIG.gridFins?.booster || null;
}

function baselineBoosterGridFinStates() {
  const profile = boosterGridFinProfile();
  const fins = Array.isArray(profile?.fins) ? profile.fins : [];
  return fins.map((fin, index) => ({
    name: String(fin?.name || `grid-fin-${index + 1}`),
    deflectionDeg: 0,
    dynamicPressurePa: 0,
    effectiveness: 0,
  }));
}

function normalizeFinTelemetryStates(finStates = []) {
  const profileStates = baselineBoosterGridFinStates();
  const incomingStates = Array.isArray(finStates) ? finStates : [];
  const incomingByName = new Map(
    incomingStates.map((state) => [String(state?.name || ""), state]),
  );
  return profileStates.map((profileState, index) => {
    const incoming = incomingByName.get(profileState.name) || incomingStates[index] || {};
    return {
      ...profileState,
      ...incoming,
      name: String(incoming?.name || profileState.name),
      deflectionDeg: finiteNumber(incoming?.deflectionDeg, profileState.deflectionDeg),
      dynamicPressurePa: Math.max(0, finiteNumber(incoming?.dynamicPressurePa, profileState.dynamicPressurePa)),
      effectiveness: clamp(finiteNumber(incoming?.effectiveness, profileState.effectiveness), 0, 1),
    };
  });
}

function gridFinPhaseStateForRecoveryPhase({
  phase = "",
  guidanceMode = "",
  boosterAttached = false,
  boosterCrashed = false,
  boosterLanded = false,
  catchCaptureActive = false,
}) {
  const normalizedPhase = String(phase || "").toLowerCase();
  const normalizedGuidance = String(guidanceMode || "").toLowerCase();
  if (
    boosterLanded
    || catchCaptureActive
    || normalizedPhase === "caught"
    || normalizedPhase === "landed"
    || normalizedGuidance.includes("caught")
  ) {
    return "catch-support-locked";
  }
  if (
    boosterCrashed
    || normalizedPhase === "crashed"
    || normalizedGuidance.includes("crashed")
  ) {
    return "safed-after-crash";
  }
  if (boosterAttached || normalizedPhase === "attached-stack" || normalizedGuidance.includes("attached")) {
    return "attached-ascent-exposed";
  }
  if (
    normalizedPhase === "separation-flip"
    || normalizedPhase === "separation-coast"
    || normalizedPhase === "hotstage-ring-jettison"
  ) {
    return "post-separation-exposed";
  }
  if (normalizedPhase === "boostback") {
    return "boostback-powered-trim";
  }
  if (
    normalizedPhase === "entry-align"
    || normalizedPhase === "ballistic-descent"
    || normalizedPhase === "ballistic-settle"
  ) {
    return "entry-aero-build";
  }
  if (normalizedPhase === "descent-coast" || normalizedPhase === "terminal-intercept") {
    return "descent-primary-guidance";
  }
  if (normalizedPhase === "landing-burn") {
    return "landing-burn-aero-trim";
  }
  if (normalizedPhase === "catch-approach" || normalizedPhase === "catch-burn") {
    return "catch-corridor-trim";
  }
  return "standby-exposed";
}

function gridFinCommandState({
  phaseState = "",
  finState = null,
  gridFinAuthority = 0,
  dynamicPressurePa = 0,
  maxDeflectionDeg = 0,
  throttle = 0,
}) {
  if (phaseState === "catch-support-locked") return "locked";
  if (phaseState === "safed-after-crash") return "safed";

  const finDeflectionDeg = Math.abs(finiteNumber(finState?.deflectionDeg, 0));
  const finQPa = Math.max(
    0,
    finiteNumber(finState?.dynamicPressurePa, 0),
    finiteNumber(dynamicPressurePa, 0),
  );
  const effectiveness = clamp(finiteNumber(finState?.effectiveness, 0), 0, 1);
  const saturated = maxDeflectionDeg > 0 && finDeflectionDeg >= maxDeflectionDeg * 0.92;
  const active = gridFinAuthority > 0.03 && effectiveness > 0.03 && finDeflectionDeg > 0.4;
  if (saturated) return "saturated";
  if (active) return throttle > 0.02 ? "powered-trim" : "actively-steering";
  if (finQPa > 500) return "aero-loaded";
  return "neutral";
}

export function resolveBoosterGridFinPhaseState(input = {}) {
  const phase = String(input.phase || "").toLowerCase();
  const guidanceMode = String(input.guidanceMode || "");
  const gridFinAuthority = clamp(finiteNumber(input.gridFinAuthority, 0), 0, 1);
  const dynamicPressurePa = Math.max(0, finiteNumber(input.dynamicPressurePa, 0));
  const throttle = clamp(
    Math.max(finiteNumber(input.throttle, 0), finiteNumber(input.requestedThrottle, 0)),
    0,
    1,
  );
  const profile = boosterGridFinProfile();
  const maxDeflectionDeg = Math.max(
    0,
    finiteNumber(input.gridFinMaxDeflectionDeg, finiteNumber(profile?.maxDeflectionDeg, 0)),
  );
  const phaseState = gridFinPhaseStateForRecoveryPhase({
    phase,
    guidanceMode,
    boosterAttached: Boolean(input.boosterAttached),
    boosterCrashed: Boolean(input.boosterCrashed),
    boosterLanded: Boolean(input.boosterLanded),
    catchCaptureActive: Boolean(input.catchCaptureActive),
  });
  const deploymentState = phaseState === "catch-support-locked"
    ? "exposed-support-locked"
    : phaseState === "safed-after-crash"
      ? "exposed-safed"
      : "fixed-exposed-no-deploy";
  const finStates = normalizeFinTelemetryStates(input.gridFinStates).map((finState) => {
    const commandState = gridFinCommandState({
      phaseState,
      finState,
      gridFinAuthority,
      dynamicPressurePa,
      maxDeflectionDeg,
      throttle,
    });
    return {
      ...finState,
      deploymentState,
      phaseState,
      commandState,
      saturated: commandState === "saturated",
      aeroLoaded: commandState === "aero-loaded"
        || commandState === "actively-steering"
        || commandState === "powered-trim"
        || commandState === "saturated",
      controlActive: commandState === "actively-steering"
        || commandState === "powered-trim"
        || commandState === "saturated",
    };
  });
  const anySaturated = finStates.some((state) => state.saturated);
  const anyActive = finStates.some((state) => state.controlActive);
  const anyLoaded = finStates.some((state) => state.aeroLoaded);
  const aggregateCommandState = phaseState === "catch-support-locked"
    ? "locked"
    : phaseState === "safed-after-crash"
      ? "safed"
      : anySaturated
        ? "saturated"
        : anyActive
          ? (throttle > 0.02 ? "powered-trim" : "actively-steering")
          : anyLoaded
            ? "aero-loaded"
            : "neutral";
  return {
    gridFinDeploymentState: deploymentState,
    gridFinPhaseState: phaseState,
    gridFinCommandState: aggregateCommandState,
    gridFinAeroLoaded: anyLoaded,
    gridFinControlActive: anyActive,
    gridFinSaturated: anySaturated,
    gridFinMaxDeflectionDeg: maxDeflectionDeg,
    gridFinStates: finStates,
  };
}

export function resolveBoosterRecoveryHardwareState(input = {}) {
  const phase = String(input.phase || "").toLowerCase();
  const guidanceMode = String(input.guidanceMode || "");
  const attitudeControlMode = String(input.attitudeControlMode || "").toLowerCase();
  const gridFinAuthority = clamp(finiteNumber(input.gridFinAuthority, 0), 0, 1);
  const dynamicPressurePa = Math.max(0, finiteNumber(input.dynamicPressurePa, 0));
  const throttle = clamp(
    Math.max(finiteNumber(input.throttle, 0), finiteNumber(input.requestedThrottle, 0)),
    0,
    1,
  );
  const desiredEngineCount = Math.max(0, Math.round(finiteNumber(input.desiredEngineCount, 0)));
  const activeEngineCount = Math.max(0, Math.round(finiteNumber(input.activeEngineCount, 0)));
  const towerRelativeActive = Boolean(input.towerRelativeActive);
  const catchPositionSigmaKm = finiteNumber(input.catchPositionSigmaKm, NaN);
  const catchVelocitySigmaKmS = finiteNumber(input.catchVelocitySigmaKmS, NaN);
  const catchPointContactEligible = Boolean(input.catchPointContactEligible);
  const catchCaptureActive = Boolean(input.catchCaptureActive);
  const catchCommitEligible = Boolean(input.catchCommitEligible);

  let engineRole = "off";
  let engineSet = "none";
  if (phase === "boostback") {
    engineRole = "boostback-return-impulse";
    engineSet = BOOSTER_PUBLIC_RECOVERY_HARDWARE.boostbackEngineSet;
  } else if (phase === "entry-burn") {
    engineRole = "entry-energy-management";
    engineSet = desiredEngineCount > 3 ? "inner-13" : "center-3";
  } else if (phase === "landing-burn") {
    engineRole = "terminal-vertical-braking";
    engineSet = BOOSTER_PUBLIC_RECOVERY_HARDWARE.landingBurnEngineSet;
  } else if (phase === "catch-burn") {
    engineRole = "precision-catch-translation";
    engineSet = BOOSTER_PUBLIC_RECOVERY_HARDWARE.precisionCatchEngineSet;
  } else if (throttle > 0.005 || activeEngineCount > 0) {
    engineRole = "powered-recovery";
    engineSet = desiredEngineCount > 3 ? "inner-13" : desiredEngineCount > 0 ? "center-3" : "none";
  }

  let gridFinRole = "inactive-thin-air-or-low-speed";
  if (gridFinAuthority > 0.03 && dynamicPressurePa > 500) {
    if (
      phase === "descent-coast"
      || phase === "terminal-intercept"
      || phase === "catch-approach"
    ) {
      gridFinRole = "primary-atmospheric-crossrange-guidance";
    } else if (
      phase === "entry-align"
      || phase === "ballistic-descent"
      || phase === "ballistic-settle"
    ) {
      gridFinRole = "aero-attitude-damping-and-trim";
    } else if (
      phase === "entry-burn"
      || phase === "landing-burn"
      || phase === "catch-burn"
    ) {
      gridFinRole = "secondary-aero-trim";
    } else {
      gridFinRole = "available-aero-control";
    }
  }
  const gridFinControlDominant = Boolean(
    gridFinAuthority > 0.12
    && throttle <= 0.02
    && attitudeControlMode.includes("grid-fins")
  );
  const gridFinPhaseState = resolveBoosterGridFinPhaseState({
    ...input,
    phase,
    guidanceMode,
    attitudeControlMode,
    gridFinAuthority,
    dynamicPressurePa,
    throttle,
  });

  const towerSensorHealthy = Boolean(
    towerRelativeActive
    && Number.isFinite(catchPositionSigmaKm)
    && Number.isFinite(catchVelocitySigmaKmS)
    && catchPositionSigmaKm <= 0.025
    && catchVelocitySigmaKmS <= 0.00015
  );
  let towerSensorMode = "inertial-gps-estimate";
  if (towerSensorHealthy) {
    towerSensorMode = BOOSTER_PUBLIC_RECOVERY_HARDWARE.towerSensorMode;
  } else if (towerRelativeActive) {
    towerSensorMode = "tower-relative-unhealthy";
  } else if (phase.includes("catch") || phase === "terminal-intercept" || guidanceMode.includes("catch")) {
    towerSensorMode = "tower-relative-not-acquired";
  }

  let catchCommitState = "not-committed";
  if (catchCaptureActive || catchPointContactEligible) {
    catchCommitState = "catch-contact-load-transfer";
  } else if (phase === "catch-burn") {
    catchCommitState = towerSensorHealthy ? "final-catch-commit" : "abort-catch-sensor-unhealthy";
  } else if (phase === "catch-approach" || phase === "terminal-intercept") {
    catchCommitState = towerSensorHealthy || catchCommitEligible
      ? "tower-relative-approach"
      : "divert-until-tower-relative";
  } else if (towerSensorHealthy) {
    catchCommitState = "tower-relative-acquired";
  }

  return {
    recoveryHardwareMode: "public-super-heavy-recovery",
    recoveryControlStack: [
      gridFinControlDominant ? "grid-fins-primary" : "grid-fins-trim",
      engineRole === "off" ? "engines-off" : engineSet,
      towerSensorMode,
    ],
    gridFinGeneration: BOOSTER_PUBLIC_RECOVERY_HARDWARE.gridFinGeneration,
    gridFinRole,
    gridFinControlDominant,
    ...gridFinPhaseState,
    engineRole,
    engineSet,
    towerSensorMode,
    towerSensorHealthy,
    catchCommitState,
    activeEngineCount,
    desiredEngineCount,
  };
}

function resolveGridFinAuthority({
  altitudeKm = 0,
  dynamicPressurePa = 0,
  tangentialSpeedKmS = 0,
  downwardSpeedKmS = 0,
}) {
  const qBuild = clamp((dynamicPressurePa - 1_200) / 12_000, 0, 1);
  const qSaturation = 1 - (0.35 * clamp((dynamicPressurePa - 42_000) / 38_000, 0, 1));
  const altitudeWindow = clamp((74 - altitudeKm) / 42, 0, 1) * clamp((altitudeKm - 1.4) / 8, 0, 1);
  const speedWindow = clamp((Math.max(tangentialSpeedKmS, downwardSpeedKmS) - 0.08) / 0.85, 0, 1);
  return clamp(qBuild * qSaturation * Math.max(altitudeWindow, speedWindow * 0.8), 0, 1);
}

function resolveBoostbackInterceptDemand({
  catchTotalRangeKm = 0,
  catchLateralRangeKm = 0,
  launchSiteLateralRangeKm = 0,
  launchSiteLateralClosingSpeedKmS = 0,
  tangentialSpeedKmS = 0,
  altitudeKm = 0,
  radialSpeedKmS = 0,
  timeToGroundSec = 0,
  towerRelativeActive = false,
}) {
  const boostbackInterceptTimeSec = radialSpeedKmS >= -0.04
    ? clamp(
      62 + (0.42 * altitudeKm),
      towerRelativeActive ? 90 : 70,
      towerRelativeActive ? 180 : 140,
    )
    : clamp(
      Math.max(0, timeToGroundSec) * (towerRelativeActive ? 0.42 : 0.28),
      towerRelativeActive ? 85 : 55,
      towerRelativeActive ? 180 : 140,
    );
  const desiredLateralClosingKmS = clamp(
    Math.max(catchLateralRangeKm, launchSiteLateralRangeKm) / Math.max(boostbackInterceptTimeSec, 1),
    towerRelativeActive ? 0.18 : 0.70,
    towerRelativeActive ? 0.88 : 2.40,
  );
  const passiveLateralRecoveryKm = Math.max(0, launchSiteLateralClosingSpeedKmS) * boostbackInterceptTimeSec;
  const unrecoveredCatchLateralKm = Math.max(0, catchLateralRangeKm - passiveLateralRecoveryKm);
  const unrecoveredSiteLateralKm = Math.max(0, launchSiteLateralRangeKm - passiveLateralRecoveryKm);
  const lateralMissNorm = clamp(
    Math.max(unrecoveredCatchLateralKm, unrecoveredSiteLateralKm) / 30,
    0,
    1,
  );
  const catchRangeNorm = clamp((catchTotalRangeKm - 24) / 90, 0, 1);
  const tangentialNorm = clamp((tangentialSpeedKmS - 0.9) / 2.1, 0, 1);
  const closingNeedNorm = clamp(
    (desiredLateralClosingKmS - launchSiteLateralClosingSpeedKmS) / Math.max(desiredLateralClosingKmS, 0.12),
    0,
    1,
  );
  const demandNorm = Math.max(
    lateralMissNorm,
    catchRangeNorm,
    tangentialNorm * 0.9,
    closingNeedNorm,
  );
  return {
    demandNorm,
    lateralMissNorm,
    catchRangeNorm,
    tangentialNorm,
    closingNeedNorm,
    desiredLateralClosingKmS,
    interceptTimeSec: boostbackInterceptTimeSec,
    ignitionAlignmentMin: clamp(
      0.34 + (0.14 * lateralMissNorm) + (0.08 * tangentialNorm),
      0.34,
      0.62,
    ),
  };
}

function resolveBoostbackPredictiveMetrics({
  altitudeKm = 0,
  catchEastErrorKm = 0,
  catchNorthErrorKm = 0,
  catchEastSpeedKmS = 0,
  catchNorthSpeedKmS = 0,
  catchVerticalErrorKm = 0,
  catchVerticalSpeedKmS = 0,
  catchLateralRangeKm = 0,
  catchApproachSpeedKmS = 0,
  timeToGroundSec = 0,
  towerRelativeActive = false,
}) {
  const lateralRangeKm = Math.hypot(catchEastErrorKm, catchNorthErrorKm);
  const absCatchVerticalErrorKm = Math.abs(catchVerticalErrorKm);
  const signedLateralClosingSpeedKmS = lateralRangeKm > 1e-6
    ? -(
      (catchEastErrorKm * catchEastSpeedKmS)
        + (catchNorthErrorKm * catchNorthSpeedKmS)
    ) / lateralRangeKm
    : 0;
  const lateralClosingTimeSec = signedLateralClosingSpeedKmS > 0.03
    ? lateralRangeKm / signedLateralClosingSpeedKmS
    : Number.POSITIVE_INFINITY;
  const predictedVerticalAtLateralInterceptKm = Number.isFinite(lateralClosingTimeSec)
    ? catchVerticalErrorKm + (catchVerticalSpeedKmS * lateralClosingTimeSec)
    : Number.POSITIVE_INFINITY;
  const lateralInterceptTooHighNorm = towerRelativeActive
    ? clamp((predictedVerticalAtLateralInterceptKm - 8.0) / 34.0, 0, 1)
    : 0;
  const towerCorridorHoldRadiusKm = towerRelativeActive
    ? clamp(
      0.36 * Math.max(0, absCatchVerticalErrorKm - 2.2),
      0,
      altitudeKm > 42 ? 6.0 : 2.8,
    )
    : 0;
  const lateralGuidanceScale = lateralRangeKm > 1e-6
    ? clamp((lateralRangeKm - towerCorridorHoldRadiusKm) / lateralRangeKm, 0, 1)
    : 0;
  const guidedEastErrorKm = catchEastErrorKm * lateralGuidanceScale;
  const guidedNorthErrorKm = catchNorthErrorKm * lateralGuidanceScale;
  const eastCrosslineDriftNorm = towerRelativeActive
    ? clamp((3.0 - Math.abs(guidedEastErrorKm)) / 3.0, 0, 1)
      * clamp(Math.abs(catchEastSpeedKmS) / 0.18, 0, 1)
    : 0;
  const northCrosslineDriftNorm = towerRelativeActive
    ? clamp((3.0 - Math.abs(guidedNorthErrorKm)) / 3.0, 0, 1)
      * clamp(Math.abs(catchNorthSpeedKmS) / 0.18, 0, 1)
    : 0;
  const crosslineDriftNorm = clamp(
    Math.max(eastCrosslineDriftNorm, northCrosslineDriftNorm),
    0,
    1,
  );
  const rangeDrivenInterceptSec = clamp(
    (0.26 * Math.max(0, timeToGroundSec))
      + (0.18 * altitudeKm)
      + (0.20 * catchApproachSpeedKmS)
      + 12,
    towerRelativeActive ? 96 : 55,
    towerRelativeActive ? 180 : 140,
  );
  const geometryDrivenInterceptSec = clamp(
    34 + (0.26 * altitudeKm) + (0.18 * lateralRangeKm),
    towerRelativeActive ? 92 : 50,
    towerRelativeActive ? 180 : 140,
  );
  const towerCorridorInterceptSec = clamp(
    48
      + (0.05 * altitudeKm)
      + (0.020 * lateralRangeKm)
      + (8 * lateralInterceptTooHighNorm),
    48,
    82,
  );
  const interceptTimeSec = towerRelativeActive
    ? towerCorridorInterceptSec
    : clamp(
      Math.min(rangeDrivenInterceptSec, geometryDrivenInterceptSec),
      50,
      140,
    );
  const desiredHorizontalSpeedLimitKmS = towerRelativeActive
    ? (
      altitudeKm > 70
        ? 1.55
        : altitudeKm > 42
          ? 1.30
          : altitudeKm > 24
            ? 0.95
            : 0.30
    )
    : 2.20;
  let desiredEastSpeedKmS = clamp(
    -guidedEastErrorKm / Math.max(interceptTimeSec, 1),
    -desiredHorizontalSpeedLimitKmS,
    desiredHorizontalSpeedLimitKmS,
  );
  let desiredNorthSpeedKmS = clamp(
    -guidedNorthErrorKm / Math.max(interceptTimeSec, 1),
    -desiredHorizontalSpeedLimitKmS,
    desiredHorizontalSpeedLimitKmS,
  );
  const guidedLateralRangeKm = Math.hypot(guidedEastErrorKm, guidedNorthErrorKm);
  const terminalTranslateSpeedFloorKmS = (
    towerRelativeActive
    && catchLateralRangeKm > towerCorridorHoldRadiusKm
    && altitudeKm <= 12
    && guidedLateralRangeKm > 0.08
  )
    ? Math.min(
      desiredHorizontalSpeedLimitKmS,
      clamp(
        guidedLateralRangeKm / (altitudeKm > 6 ? 8.0 : 10.0),
        altitudeKm > 6 ? 0.14 : 0.08,
        altitudeKm > 6 ? 0.32 : 0.18,
      ),
    )
    : 0;
  const desiredLateralSpeedKmS = Math.hypot(desiredEastSpeedKmS, desiredNorthSpeedKmS);
  if (terminalTranslateSpeedFloorKmS > desiredLateralSpeedKmS) {
    desiredEastSpeedKmS = -guidedEastErrorKm / guidedLateralRangeKm * terminalTranslateSpeedFloorKmS;
    desiredNorthSpeedKmS = -guidedNorthErrorKm / guidedLateralRangeKm * terminalTranslateSpeedFloorKmS;
  }
  const eastSpeedErrorKmS = desiredEastSpeedKmS - catchEastSpeedKmS;
  const northSpeedErrorKmS = desiredNorthSpeedKmS - catchNorthSpeedKmS;
  const predictedEastMissKm = catchEastErrorKm + (catchEastSpeedKmS * interceptTimeSec);
  const predictedNorthMissKm = catchNorthErrorKm + (catchNorthSpeedKmS * interceptTimeSec);
  const predictedLateralMissKm = Math.hypot(predictedEastMissKm, predictedNorthMissKm);
  const predictedCorridorMissKm = towerRelativeActive
    ? Math.abs(predictedLateralMissKm - towerCorridorHoldRadiusKm)
    : predictedLateralMissKm;
  const positionAuthorityScale = towerRelativeActive
    ? (1 - (0.78 * lateralInterceptTooHighNorm))
    : 1;
  const boostbackPositionDivisor = towerRelativeActive ? 42 : 18;
  const boostbackVelocityDivisor = towerRelativeActive ? 0.34 : 0.60;
  const localDirection = {
    east: clamp(
      (eastSpeedErrorKmS / boostbackVelocityDivisor)
        - ((guidedEastErrorKm / boostbackPositionDivisor) * positionAuthorityScale),
      -1.55,
      1.55,
    ),
    north: clamp(
      (northSpeedErrorKmS / boostbackVelocityDivisor)
        - ((guidedNorthErrorKm / boostbackPositionDivisor) * positionAuthorityScale),
      -1.55,
      1.55,
    ),
    up: clamp(
      -0.06 + clamp((-catchVerticalSpeedKmS - 0.10) / 0.42, 0, 1) * 0.12,
      -0.08,
      0.08,
    ),
  };
  return {
    interceptTimeSec,
    desiredEastSpeedKmS,
    desiredNorthSpeedKmS,
    eastSpeedErrorKmS,
    northSpeedErrorKmS,
    predictedEastMissKm,
    predictedNorthMissKm,
    predictedLateralMissKm,
    predictedCorridorMissKm,
    predictedVerticalAtLateralInterceptKm,
    lateralInterceptTooHighNorm,
    towerCorridorHoldRadiusKm,
    signedLateralClosingSpeedKmS,
    localDirection,
    lateralDemandNorm: clamp(lateralRangeKm / 75, 0, 1),
    speedDemandNorm: clamp(Math.hypot(eastSpeedErrorKmS, northSpeedErrorKmS) / 0.75, 0, 1),
    predictiveLateralMissNorm: clamp(predictedCorridorMissKm / 42, 0, 1),
  };
}

function resolveAeroCrossrangeDemand({
  altitudeKm = 0,
  dynamicPressurePa = 0,
  gridFinAuthority = 0,
  launchSiteLateralRangeKm = 0,
  launchSiteLateralClosingSpeedKmS = 0,
  catchLateralRangeKm = 0,
  catchLateralSpeedKmS = 0,
  desiredLateralClosingKmS = 0,
}) {
  const siteLateralNorm = clamp(launchSiteLateralRangeKm / 18, 0, 1);
  const catchLateralNorm = clamp(catchLateralRangeKm / 18, 0, 1);
  const desiredClosingKmS = Math.max(0.04, Number(desiredLateralClosingKmS) || 0);
  const closingNeedNorm = clamp(
    (desiredClosingKmS - launchSiteLateralClosingSpeedKmS) / Math.max(desiredClosingKmS, 0.08),
    0,
    1,
  );
  const overClosingNorm = clamp(
    (launchSiteLateralClosingSpeedKmS - ((desiredClosingKmS * 1.8) + 0.03)) / Math.max(desiredClosingKmS, 0.08),
    0,
    1,
  );
  const catchLateralSpeedNorm = clamp(catchLateralSpeedKmS / 0.18, 0, 1);
  const qNorm = clamp((dynamicPressurePa - 3_000) / 20_000, 0, 1);
  const altitudeNorm = clamp((74 - altitudeKm) / 56, 0, 1);
  const aeroCorrectionNorm = clamp(
    Math.max(
      Number(gridFinAuthority) || 0,
      (0.74 * qNorm) + (0.18 * altitudeNorm),
    ),
    0,
    1,
  );
  const crossrangeDemandNorm = Math.max(
    catchLateralNorm,
    siteLateralNorm * 0.85,
    closingNeedNorm,
    catchLateralSpeedNorm * 0.72,
    overClosingNorm * 0.42,
  );
  return {
    siteLateralNorm,
    catchLateralNorm,
    closingNeedNorm,
    overClosingNorm,
    catchLateralSpeedNorm,
    aeroCorrectionNorm,
    crossrangeDemandNorm,
    targetingActive: aeroCorrectionNorm > 0.06 && crossrangeDemandNorm > 0.04,
  };
}

function resolveTerminalInterceptMetrics({
  altitudeKm = 0,
  catchTotalRangeKm = 0,
  catchLateralRangeKm = 0,
  catchVerticalErrorKm = 0,
  catchApproachSpeedKmS = 0,
  catchEastErrorKm = 0,
  catchNorthErrorKm = 0,
  catchEastSpeedKmS = 0,
  catchNorthSpeedKmS = 0,
  catchVerticalSpeedKmS = 0,
  towerRelativeActive = false,
}) {
  const rangeTimeSec = catchTotalRangeKm / Math.max(catchApproachSpeedKmS, 0.12);
  const descentTimeSec = Math.abs(catchVerticalErrorKm) / Math.max(Math.abs(catchVerticalSpeedKmS), 0.05);
  const towerLateralUrgencyNorm = towerRelativeActive
    ? clamp((catchLateralRangeKm - 3.0) / 8.0, 0, 1)
    : 0;
  const descentTimeWeight = towerRelativeActive
    ? 0.14 - (0.10 * towerLateralUrgencyNorm)
    : 0.14;
  const terminalInterceptMaxSec = towerRelativeActive
    ? (
      catchLateralRangeKm > 8
        ? 16
        : catchLateralRangeKm > 3
          ? 12
          : 18
    )
    : 60;
  const interceptTimeSec = clamp(
    (0.34 * rangeTimeSec)
      + (descentTimeWeight * descentTimeSec)
      + (0.12 * altitudeKm)
      + (0.06 * catchLateralRangeKm)
      + 1.0,
    8,
    terminalInterceptMaxSec,
  );
  const desiredHorizontalSpeedLimitKmS = towerRelativeActive
    ? (
	      altitudeKm > 16
	        ? (
	          catchLateralRangeKm > 12
	            ? 0.95
	            : catchLateralRangeKm > 6
	              ? 0.82
	              : 0.58
	        )
	        : altitudeKm > 10
	          ? (
	            catchLateralRangeKm > 8
	              ? 0.88
	              : catchLateralRangeKm > 4
	                ? 0.72
	                : 0.48
	          )
	          : altitudeKm > 6
	            ? (
	              catchLateralRangeKm > 8
	                ? 0.82
	                : catchLateralRangeKm > 4.0
	                  ? 0.72
	                : catchLateralRangeKm > 2.0
	                  ? 0.54
	                  : 0.26
	            )
	            : altitudeKm > 2.6
	              ? (
	                catchLateralRangeKm > 4.0
	                  ? 0.62
	                  : catchLateralRangeKm > 3.0
	                    ? 0.54
	                  : catchLateralRangeKm > 2.0
	                    ? 0.44
	                    : catchLateralRangeKm > 1.2
	                      ? 0.26
                      : 0.10
              )
              : (
                catchLateralRangeKm > 4.0
                  ? 0.42
                  : catchLateralRangeKm > 2.0
                    ? 0.28
                    : 0.08
              )
    )
    : (
      altitudeKm > 16
        ? 0.80
        : altitudeKm > 8
          ? 0.62
          : 0.38
    );
  const absCatchVerticalErrorKm = Math.abs(catchVerticalErrorKm);
	  const towerCorridorLimitKm = altitudeKm > 42
	    ? 3.80
	    : altitudeKm > 28
	      ? 2.40
	      : altitudeKm > 18
	        ? 1.35
	        : altitudeKm > 10
	          ? 0.72
	          : altitudeKm > 6
	            ? 0.34
	            : altitudeKm > 3
	              ? 0.14
	              : 0.04;
	  const towerCorridorHoldRadiusKm = towerRelativeActive
	    ? clamp(
	      0.020 + (0.08 * Math.max(0, absCatchVerticalErrorKm - 0.4)),
	      0,
	      towerCorridorLimitKm,
	    )
    : 0;
  const lateralGuidanceScale = catchLateralRangeKm > 1e-6
    ? clamp(
      (catchLateralRangeKm - towerCorridorHoldRadiusKm) / catchLateralRangeKm,
      -1,
      1,
    )
    : 0;
  const guidedEastErrorKm = catchEastErrorKm * lateralGuidanceScale;
  const guidedNorthErrorKm = catchNorthErrorKm * lateralGuidanceScale;
  const eastCrosslineDriftNorm = towerRelativeActive
    ? clamp((3.0 - Math.abs(guidedEastErrorKm)) / 3.0, 0, 1)
      * clamp(Math.abs(catchEastSpeedKmS) / 0.18, 0, 1)
    : 0;
  const northCrosslineDriftNorm = towerRelativeActive
    ? clamp((3.0 - Math.abs(guidedNorthErrorKm)) / 3.0, 0, 1)
      * clamp(Math.abs(catchNorthSpeedKmS) / 0.18, 0, 1)
    : 0;
  const crosslineDriftNorm = clamp(
    Math.max(eastCrosslineDriftNorm, northCrosslineDriftNorm),
    0,
    1,
  );
  let desiredEastSpeedKmS = clamp(
    -guidedEastErrorKm / Math.max(interceptTimeSec, 1),
    -desiredHorizontalSpeedLimitKmS,
    desiredHorizontalSpeedLimitKmS,
  );
  let desiredNorthSpeedKmS = clamp(
    -guidedNorthErrorKm / Math.max(interceptTimeSec, 1),
    -desiredHorizontalSpeedLimitKmS,
    desiredHorizontalSpeedLimitKmS,
  );
  const guidedLateralRangeKm = Math.hypot(guidedEastErrorKm, guidedNorthErrorKm);
  const outsideTowerCorridorKm = Math.max(0, catchLateralRangeKm - towerCorridorHoldRadiusKm);
  const terminalTranslateSpeedFloorKmS = (
    towerRelativeActive
    && outsideTowerCorridorKm > 0.12
    && altitudeKm <= 70
    && guidedLateralRangeKm > 1e-6
  )
    ? Math.min(
      desiredHorizontalSpeedLimitKmS,
      clamp(
        outsideTowerCorridorKm / (
          altitudeKm > 42 ? 7.0 : altitudeKm > 34 ? 6.0 : altitudeKm > 24 ? 4.8 : altitudeKm > 18 ? 3.6 : altitudeKm > 8 ? 2.8 : altitudeKm > 5 ? 3.6 : 5.2
        ),
        altitudeKm > 42 ? 0.58 : altitudeKm > 34 ? 0.54 : altitudeKm > 24 ? 0.50 : altitudeKm > 18 ? 0.48 : altitudeKm > 8 ? 0.42 : altitudeKm > 5 ? 0.28 : 0.14,
        altitudeKm > 42 ? 0.95 : altitudeKm > 34 ? 0.88 : altitudeKm > 24 ? 0.84 : altitudeKm > 18 ? 0.78 : altitudeKm > 8 ? 0.70 : altitudeKm > 5 ? 0.50 : 0.26,
      ),
    )
    : 0;
  const desiredLateralSpeedKmS = Math.hypot(desiredEastSpeedKmS, desiredNorthSpeedKmS);
  if (terminalTranslateSpeedFloorKmS > desiredLateralSpeedKmS) {
    desiredEastSpeedKmS = -guidedEastErrorKm / guidedLateralRangeKm * terminalTranslateSpeedFloorKmS;
    desiredNorthSpeedKmS = -guidedNorthErrorKm / guidedLateralRangeKm * terminalTranslateSpeedFloorKmS;
  }
  const lateralRangeNorm = clamp(Math.max(0, catchLateralRangeKm - towerCorridorHoldRadiusKm) / 24, 0, 1);
  const currentLateralSpeedKmS = Math.hypot(catchEastSpeedKmS, catchNorthSpeedKmS);
  const signedLateralClosingSpeedKmS = catchLateralRangeKm > 1e-6
    ? -(
      (catchEastErrorKm * catchEastSpeedKmS)
        + (catchNorthErrorKm * catchNorthSpeedKmS)
    ) / catchLateralRangeKm
    : 0;
  const lateralClosingTimeSec = catchLateralRangeKm / Math.max(currentLateralSpeedKmS, 0.05);
  const predictedVerticalAtLateralInterceptKm = catchVerticalErrorKm
    + (catchVerticalSpeedKmS * lateralClosingTimeSec);
  const lateralInterceptTooHighNorm = towerRelativeActive
    ? clamp((predictedVerticalAtLateralInterceptKm - 2.2) / 5.8, 0, 1)
    : 0;
  const lateralBrakeNeedNorm = Math.max(
    lateralRangeNorm,
    clamp(currentLateralSpeedKmS / 0.42, 0, 1),
  );
  const desiredVerticalSpeedKmS = -clamp(
    0.12
      + (0.016 * altitudeKm)
      + (0.62 * lateralRangeNorm)
      + (0.16 * lateralBrakeNeedNorm)
      + (0.26 * lateralInterceptTooHighNorm)
      + (0.05 * clamp(catchApproachSpeedKmS / 0.9, 0, 1)),
    altitudeKm > 9 ? 0.22 : 0.095,
    altitudeKm > 12 ? 0.92 : altitudeKm > 6 ? 0.72 : 0.38,
  );
  const eastSpeedErrorKmS = desiredEastSpeedKmS - catchEastSpeedKmS;
  const northSpeedErrorKmS = desiredNorthSpeedKmS - catchNorthSpeedKmS;
  const verticalSpeedErrorKmS = desiredVerticalSpeedKmS - catchVerticalSpeedKmS;
  const predictedEastMissKm = catchEastErrorKm + (catchEastSpeedKmS * interceptTimeSec);
  const predictedNorthMissKm = catchNorthErrorKm + (catchNorthSpeedKmS * interceptTimeSec);
  const predictedVerticalMissKm = catchVerticalErrorKm + (catchVerticalSpeedKmS * interceptTimeSec);
  const predictedLateralMissKm = Math.hypot(predictedEastMissKm, predictedNorthMissKm);
  const predictedTotalMissKm = Math.hypot(predictedLateralMissKm, predictedVerticalMissKm);
  const predictedGuidedEastMissKm = guidedEastErrorKm + (catchEastSpeedKmS * interceptTimeSec);
  const predictedGuidedNorthMissKm = guidedNorthErrorKm + (catchNorthSpeedKmS * interceptTimeSec);
  const terminalPositionGainKm = towerRelativeActive ? 12.0 : 5.0;
  const terminalPredictedMissGainKm = towerRelativeActive
    ? (
      altitudeKm > 8
        ? 2.8
        : altitudeKm > 4
          ? 2.2
          : 1.35
    )
    : 4.0;
  const localDirection = {
	    east: clamp(
	      (eastSpeedErrorKmS / Math.max(desiredHorizontalSpeedLimitKmS * 0.55, 0.08))
	        - (predictedGuidedEastMissKm / terminalPredictedMissGainKm)
	        - (guidedEastErrorKm / terminalPositionGainKm)
        - ((catchEastSpeedKmS / 0.18) * eastCrosslineDriftNorm),
	      -2.40,
	      2.40,
	    ),
	    north: clamp(
	      (northSpeedErrorKmS / Math.max(desiredHorizontalSpeedLimitKmS * 0.55, 0.08))
	        - (predictedGuidedNorthMissKm / terminalPredictedMissGainKm)
	        - (guidedNorthErrorKm / terminalPositionGainKm)
        - ((catchNorthSpeedKmS / 0.18) * northCrosslineDriftNorm),
	      -2.40,
	      2.40,
	    ),
    up: clamp(
      0.26
        + (verticalSpeedErrorKmS / 0.08)
        - (Math.max(0, catchVerticalErrorKm - 0.5) / 10.0)
        + (Math.max(0, -catchVerticalErrorKm) / 6.5),
      0.02,
      0.60,
    ),
  };
  const lateralDemandNorm = clamp(
    Math.hypot(localDirection.east, localDirection.north) / 0.75,
    0,
    1,
  );
  const verticalDemandNorm = clamp(Math.abs(verticalSpeedErrorKmS) / 0.06, 0, 1);
  const predictiveLateralMissNorm = clamp(predictedLateralMissKm / 3.0, 0, 1);
  const predictiveVerticalMissNorm = clamp(Math.abs(predictedVerticalMissKm) / 14.0, 0, 1);
  return {
    interceptTimeSec,
    desiredEastSpeedKmS,
    desiredNorthSpeedKmS,
    desiredVerticalSpeedKmS,
    eastSpeedErrorKmS,
    northSpeedErrorKmS,
    verticalSpeedErrorKmS,
    predictedEastMissKm,
    predictedNorthMissKm,
    predictedVerticalMissKm,
    predictedLateralMissKm,
    predictedTotalMissKm,
    predictedVerticalAtLateralInterceptKm,
    signedLateralClosingSpeedKmS,
    crosslineDriftNorm,
    lateralInterceptTooHighNorm,
    towerCorridorHoldRadiusKm,
    localDirection,
    lateralDemandNorm,
    verticalDemandNorm,
    predictiveLateralMissNorm,
    predictiveVerticalMissNorm,
  };
}

function buildUnpoweredTowerTerminalInterceptCommand({
  altitudeKm = 0,
  catchLateralRangeKm = 0,
  catchLateralSpeedKmS = 0,
  catchVerticalErrorKm = 0,
  gridFinAuthority = 0,
  terminalUprightCommitNorm = 0,
  terminalIntercept = null,
  towerRelativeActive = false,
} = {}) {
  const lateralNorm = clamp(catchLateralRangeKm / 18, 0, 1);
  const verticalNorm = clamp(Math.abs(catchVerticalErrorKm) / 12, 0, 1);
  const towerCorridorCommitNorm = towerRelativeActive
    ? clamp(
      Math.max(
        (catchLateralRangeKm - 0.8) / 7.2,
        Number(terminalIntercept?.lateralDemandNorm) || 0,
        Number(terminalIntercept?.predictiveLateralMissNorm) || 0,
      ),
      0,
      1,
    )
    : 0;
  const guidanceBlend = clamp(
    0.48
      + (0.24 * (Number(terminalIntercept?.lateralDemandNorm) || 0))
      + (0.12 * (Number(terminalIntercept?.predictiveLateralMissNorm) || 0))
      + (towerRelativeActive ? 0.08 : 0)
      + (0.10 * towerCorridorCommitNorm),
    0.48,
    towerRelativeActive ? 0.94 : 0.88,
  );
  return {
    phase: "terminal-intercept",
    guidanceMode: "booster-terminal-intercept",
    attitudeControlMode: "grid-fins+rcs",
    qAlphaSteeringEnabled: false,
    aeroAuthority: clamp(gridFinAuthority, 0, 1),
    siteTargetingEnabled: !towerRelativeActive,
    throttle: 0,
    directionMix: {
      up: clamp(0.96 - (0.10 * lateralNorm) - (0.05 * towerCorridorCommitNorm), 0.82, 0.96),
      retrograde: clamp(0.08 + (0.08 * verticalNorm), 0.08, 0.16),
      antiTangent: clamp(0.04 + (0.08 * lateralNorm) + (0.06 * towerCorridorCommitNorm), 0.04, 0.18),
    },
    terminalUprightCommit: true,
    uprightTiltLimitDeg: clamp(
      8
        + (0.60 * Math.min(catchLateralRangeKm, 12))
        + (0.12 * Math.min(Math.abs(catchVerticalErrorKm), 12))
        + (8 * towerCorridorCommitNorm)
        + (18 * clamp((catchLateralSpeedKmS - 0.34) / 0.58, 0, 1) * clamp((altitudeKm - 12) / 28, 0, 1)),
      8,
      towerRelativeActive
        ? (altitudeKm > 20.0 ? 52 : (altitudeKm > 2.0 ? 34 : 16))
        : 30,
    ),
    siteVectorWeight: clamp(0.32 + (0.42 * lateralNorm) + (0.14 * towerCorridorCommitNorm), 0.24, 0.90),
    siteVelocityWeight: clamp(
      0.22
        + (0.40 * (Number(terminalIntercept?.lateralDemandNorm) || 0))
        + (0.12 * towerCorridorCommitNorm),
      0.16,
      0.90,
    ),
    padInterceptBlend: clamp(0.42 + (0.38 * guidanceBlend) + (0.10 * towerCorridorCommitNorm), 0.42, 0.92),
    padInterceptLateralWeight: clamp(
      0.58
        + (0.58 * (Number(terminalIntercept?.lateralDemandNorm) || 0))
        + (0.24 * towerCorridorCommitNorm),
      0.58,
      1.62,
    ),
    padDesiredLateralClosingSpeedKmS: clamp(
      Math.hypot(
        Number(terminalIntercept?.desiredEastSpeedKmS) || 0,
        Number(terminalIntercept?.desiredNorthSpeedKmS) || 0,
      ),
      0.06,
      catchLateralRangeKm > 8 ? 0.64 : catchLateralRangeKm > 3 ? 0.48 : 0.24,
    ),
    maxSiteSteeringAngleDeg: clamp(18 + (0.72 * Math.min(catchLateralRangeKm, 26)) + (10 * towerCorridorCommitNorm), 18, 48),
    attitudeResponseScale: 1.54 + (0.52 * terminalUprightCommitNorm),
    attitudeTargetBlend: clamp(0.90 + (0.06 * terminalUprightCommitNorm), 0.90, 0.975),
    angularDampingPerS: 1.08 + (0.20 * terminalUprightCommitNorm),
    maxBodyRateDegS: altitudeKm > 2.0 ? 18.0 : 10.5,
    predictiveCatchControl: terminalIntercept
      ? {
        enabled: true,
        blend: guidanceBlend,
        retrogradeBias: clamp(
          0.06 + (0.08 * (Number(terminalIntercept.lateralDemandNorm) || 0)),
          0.06,
          0.20,
        ),
        translationAuthority: clamp(
          0.38
            + (0.40 * (Number(terminalIntercept.lateralDemandNorm) || 0))
            + (0.16 * towerCorridorCommitNorm),
          0.34,
          0.96,
        ),
        interceptTimeSec: terminalIntercept.interceptTimeSec,
        localDirection: {
          ...(terminalIntercept.localDirection || {}),
          up: clamp(
            Number(terminalIntercept.localDirection?.up) || 0,
            towerRelativeActive ? (0.58 - (0.14 * towerCorridorCommitNorm)) : 0.72,
            1.0,
          ),
        },
        desiredEastSpeedKmS: terminalIntercept.desiredEastSpeedKmS,
        desiredNorthSpeedKmS: terminalIntercept.desiredNorthSpeedKmS,
        desiredVerticalSpeedKmS: terminalIntercept.desiredVerticalSpeedKmS,
        predictedEastMissKm: terminalIntercept.predictedEastMissKm,
        predictedNorthMissKm: terminalIntercept.predictedNorthMissKm,
        predictedVerticalMissKm: terminalIntercept.predictedVerticalMissKm,
        predictedLateralMissKm: terminalIntercept.predictedLateralMissKm,
        predictedTotalMissKm: terminalIntercept.predictedTotalMissKm,
        predictedVerticalAtLateralInterceptKm: terminalIntercept.predictedVerticalAtLateralInterceptKm,
      }
      : null,
  };
}

function buildSustainedTowerLandingBurnCommand({
  altitudeKm = 0,
  catchLateralRangeKm = 0,
  catchLateralSpeedKmS = 0,
  catchVerticalErrorKm = 0,
  catchVerticalSpeedKmS = 0,
  catchApproachSpeedKmS = 0,
  gridFinAuthority = 0,
  terminalUprightCommitNorm = 0,
  terminalIntercept = null,
} = {}) {
  const lateralRangeNorm = clamp(catchLateralRangeKm / 14, 0, 1);
  const lateralSpeedNorm = clamp(catchLateralSpeedKmS / 0.42, 0, 1);
  const verticalBrakeUrgencyNorm = clamp((-catchVerticalSpeedKmS - 0.22) / 0.42, 0, 1);
  const lateLateralCorrectionNorm = clamp(
    Math.max(
      (catchLateralRangeKm - 1.2) / 3.8,
      catchLateralSpeedKmS / 0.20,
    )
      * clamp((altitudeKm - 0.35) / 4.5, 0, 1)
      * (1 - (0.72 * verticalBrakeUrgencyNorm)),
    0,
    1,
  );
  const verticalBrakeNorm = clamp(
    (Math.abs(catchVerticalSpeedKmS) - 0.16) / 0.95,
    0,
    1,
  );
  const energyNorm = clamp(
    (catchApproachSpeedKmS - 0.35) / 1.25,
    0,
    1,
  );
  const rawThrottle = clamp(
    0.42
      + (0.28 * verticalBrakeNorm)
      + (0.18 * lateralSpeedNorm)
      + (0.10 * lateralRangeNorm)
      + (0.10 * energyNorm),
    0.42,
    0.92,
  );
  const desiredVerticalSpeedKmS = Number(terminalIntercept?.desiredVerticalSpeedKmS) || -0.38;
  const slowOrAscendingNorm = clamp(
    (catchVerticalSpeedKmS - desiredVerticalSpeedKmS + 0.02) / 0.24,
    0,
    1,
  );
  const lowVerticalEnergyThrottleCap = clamp(
    0.10
      + (0.18 * lateralSpeedNorm)
      + (0.12 * lateralRangeNorm)
      + (0.08 * clamp(Math.max(0, -catchVerticalErrorKm) / 4, 0, 1)),
    0.10,
    0.46,
  );
  const throttle = slowOrAscendingNorm > 0
    ? Math.min(
      rawThrottle,
      (rawThrottle * (1 - slowOrAscendingNorm)) + (lowVerticalEnergyThrottleCap * slowOrAscendingNorm),
    )
    : rawThrottle;
  const guidanceBlend = clamp(
    0.78
      + (0.10 * lateralRangeNorm)
      + (0.08 * lateralSpeedNorm),
    0.78,
    0.94,
  );
  return {
    phase: "landing-burn",
    guidanceMode: "booster-landing-burn",
    attitudeControlMode: "engines+rcs",
    qAlphaSteeringEnabled: false,
    aeroAuthority: clamp(gridFinAuthority * 0.25, 0, 0.2),
    siteTargetingEnabled: false,
    throttle,
    directionMix: {
      up: clamp(0.84 - (0.08 * lateLateralCorrectionNorm), 0.76, 0.84),
      retrograde: 0.12,
      antiTangent: clamp(0.06 + (0.05 * lateLateralCorrectionNorm), 0.06, 0.11),
    },
    terminalUprightCommit: true,
    uprightTiltLimitDeg: clamp(
      18
        + (0.55 * Math.min(Math.abs(catchVerticalErrorKm), 10))
        + (1.30 * Math.min(catchLateralRangeKm, 12))
        + (10 * lateralSpeedNorm),
      18,
      42 + (12 * lateLateralCorrectionNorm),
    ),
    attitudeResponseScale: 6.80,
    attitudeTargetBlend: 1.0,
    angularDampingPerS: 2.60,
    maxBodyRateDegS: 9.0,
    predictiveCatchControl: terminalIntercept
      ? {
        enabled: true,
        blend: guidanceBlend,
        retrogradeBias: clamp(0.16 + (0.16 * lateralSpeedNorm), 0.16, 0.34),
        translationAuthority: clamp(
          0.56 + (0.26 * lateralRangeNorm) + (0.14 * lateLateralCorrectionNorm),
          0.56,
          0.96,
        ),
        interceptTimeSec: terminalIntercept.interceptTimeSec,
        localDirection: {
          ...(terminalIntercept.localDirection || {}),
          up: clamp(
            Number(terminalIntercept.localDirection?.up) || 0,
            0.70 - (0.24 * lateLateralCorrectionNorm),
            1.08,
          ),
        },
        desiredEastSpeedKmS: terminalIntercept.desiredEastSpeedKmS,
        desiredNorthSpeedKmS: terminalIntercept.desiredNorthSpeedKmS,
        desiredVerticalSpeedKmS: terminalIntercept.desiredVerticalSpeedKmS,
        predictedEastMissKm: terminalIntercept.predictedEastMissKm,
        predictedNorthMissKm: terminalIntercept.predictedNorthMissKm,
        predictedVerticalMissKm: terminalIntercept.predictedVerticalMissKm,
        predictedLateralMissKm: terminalIntercept.predictedLateralMissKm,
        predictedTotalMissKm: terminalIntercept.predictedTotalMissKm,
      }
      : null,
  };
}

export function computeBoosterRecoveryCommand(input = {}) {
  const currentPhase = String(input.currentPhase || "").toLowerCase();
  const altitudeKm = Math.max(0, Number(input.altitudeKm) || 0);
  const radialSpeedKmS = Number(input.radialSpeedKmS) || 0;
  const tangentialSpeedKmS = Math.max(0, Number(input.tangentialSpeedKmS) || 0);
  const launchSiteRangeKm = Math.max(0, Number(input.launchSiteRangeKm) || 0);
  const launchSiteLateralRangeKm = Math.max(0, Number(input.launchSiteLateralRangeKm) || 0);
  const launchSiteLateralClosingSpeedKmS = Number(input.launchSiteLateralClosingSpeedKmS) || 0;
  const catchTotalRangeKm = Math.max(0, Number(input.catchTotalRangeKm) || launchSiteRangeKm);
  const catchLateralRangeKm = Math.max(0, Number(input.catchLateralRangeKm) || launchSiteLateralRangeKm);
  const catchVerticalErrorKm = Number(input.catchVerticalErrorKm) || 0;
  const catchLateralSpeedKmS = Math.max(0, Number(input.catchLateralSpeedKmS) || tangentialSpeedKmS);
  const catchVerticalSpeedKmS = Number(input.catchVerticalSpeedKmS) || radialSpeedKmS;
  const catchApproachSpeedKmS = Math.max(0, Number(input.catchApproachSpeedKmS) || Math.hypot(catchLateralSpeedKmS, catchVerticalSpeedKmS));
  const catchEastErrorKm = Number(input.catchEastErrorKm) || 0;
  const catchNorthErrorKm = Number(input.catchNorthErrorKm) || 0;
  const catchEastSpeedKmS = Number(input.catchEastSpeedKmS) || 0;
  const catchNorthSpeedKmS = Number(input.catchNorthSpeedKmS) || 0;
  const catchClosingSpeedKmS = Number(input.catchClosingSpeedKmS) || 0;
  const towerRelativeActive = Boolean(input.towerRelativeActive);
  const boostbackCatchCorridorActive = towerRelativeActive
    || (
      catchTotalRangeKm > 1
      && catchTotalRangeKm <= 240
      && catchLateralRangeKm <= 220
      && Math.abs(catchVerticalErrorKm) > 4
    );
  const catchPositionSigmaKm = Math.max(0, Number(input.catchPositionSigmaKm) || Number.POSITIVE_INFINITY);
  const catchVelocitySigmaKmS = Math.max(0, Number(input.catchVelocitySigmaKmS) || Number.POSITIVE_INFINITY);
  const elapsedSec = Math.max(0, Number(input.timeSinceSeparationSec) || 0);
  const propellantKg = Math.max(0, Number(input.remainingPropellantKg) || 0);
  const dynamicPressurePa = Math.max(0, Number(input.dynamicPressurePa) || 0);
  const reserveLandingKg = Math.max(0, Number(input.reserveLandingPropellantKg) || 0);
  const bodyRetrogradeAlignment = clamp(Number(input.bodyRetrogradeAlignment) || 0, -1, 1);
  const bodyAntiTangentAlignment = clamp(Number(input.bodyAntiTangentAlignment) || 0, -1, 1);
  const bodyUpAlignment = clamp(
    Number.isFinite(Number(input.bodyUpAlignment))
      ? Number(input.bodyUpAlignment)
      : 1,
    -1,
    1,
  );
  const downwardSpeedKmS = Math.max(0, -radialSpeedKmS);
  const dryMassKg = Math.max(1, Number(LAUNCH_BOOSTER_CONFIG.dryMassKg) || 1);
  const totalMassKg = Math.max(dryMassKg + propellantKg, dryMassKg + 1);
  const boosterThrustBounds = resolveConfiguredThrustBoundsN(LAUNCH_BOOSTER_CONFIG);
  const maxThrustN = Math.max(
    0,
    Number(boosterThrustBounds.thrustSeaLevelN)
      || Number(boosterThrustBounds.thrustVacuumN)
      || 0,
  );
  const gravityKmS2 = STANDARD_GRAVITY_M_S2 / 1000;
  const maxAccelerationKmS2 = maxThrustN > 0
    ? (maxThrustN / totalMassKg) / 1000
    : 0;
  const landingNetDecelKmS2 = Math.max(0.008, maxAccelerationKmS2 - (gravityKmS2 * 0.72));
  const timeToGroundSec = altitudeKm / Math.max(downwardSpeedKmS, 0.02);
  const desiredLateralClosingBaseKmS = clamp(
    launchSiteLateralRangeKm / Math.max(timeToGroundSec, 18),
    0,
    1.40,
  );
  const towerRelativeTerminalClosingCapKmS = towerRelativeActive
    ? (
      altitudeKm > 20
        ? 0.62
        : altitudeKm > 14
          ? 0.42
          : altitudeKm > 10
            ? 0.28
            : altitudeKm > 6
              ? 0.18
              : 0.12
    )
    : 1.40;
  const towerRelativeDesiredClosingKmS = towerRelativeActive
    ? clamp(
      catchLateralRangeKm / Math.max(timeToGroundSec * 1.8, altitudeKm > 12 ? 26 : altitudeKm > 8 ? 20 : 14),
      0.06,
      towerRelativeTerminalClosingCapKmS,
    )
    : desiredLateralClosingBaseKmS;
  const desiredLateralClosingKmS = towerRelativeActive
    ? Math.min(desiredLateralClosingBaseKmS, towerRelativeDesiredClosingKmS)
    : desiredLateralClosingBaseKmS;
  const maxResidualLateralSpeedKmS = clamp(
    0.16 + (0.0045 * altitudeKm),
    0.24,
    0.82,
  );
  const lateralClosingNeedNorm = clamp(
    (desiredLateralClosingKmS - launchSiteLateralClosingSpeedKmS) / Math.max(desiredLateralClosingKmS, 0.10),
    0,
    1,
  );
  const baseLandingBurnTriggerAltitudeKm = clamp(
    (
      (downwardSpeedKmS * downwardSpeedKmS) / Math.max(2 * landingNetDecelKmS2, 1e-6)
    )
      + (0.32 * downwardSpeedKmS)
      + (0.95 * tangentialSpeedKmS)
      + (0.08 * Math.min(launchSiteLateralRangeKm, 6))
      + 0.08,
    0.45,
    15.5,
  );
  const towerRelativeTerminalWindow =
    towerRelativeActive
    && (
      catchTotalRangeKm <= 18
      || catchLateralRangeKm <= 14
      || altitudeKm <= Math.max(14, baseLandingBurnTriggerAltitudeKm * 2.1)
    );
  const towerRelativeFinalWindow =
    towerRelativeActive
    && (
      catchTotalRangeKm <= 6
      || catchLateralRangeKm <= 4.5
      || altitudeKm <= Math.max(6, baseLandingBurnTriggerAltitudeKm * 1.25)
    );
  const terminalApproachWindow =
    towerRelativeTerminalWindow
    || catchTotalRangeKm <= 5.6
    || launchSiteLateralRangeKm <= 7.4
    || altitudeKm <= Math.max(14, baseLandingBurnTriggerAltitudeKm * 2.1);
  const strictTerminalUprightWindow =
    towerRelativeFinalWindow
    || catchTotalRangeKm <= 2.6
    || launchSiteLateralRangeKm <= 3.8
    || altitudeKm <= Math.max(8.5, baseLandingBurnTriggerAltitudeKm * 1.5);
  const committedTowerCatch =
    towerRelativeActive
    && propellantKg > (reserveLandingKg * 0.02)
    && (
      currentPhase === "terminal-intercept"
      || currentPhase === "catch-approach"
      || currentPhase === "catch-burn"
      || catchTotalRangeKm <= 18
    );
  const towerCatchAcquisitionWindow =
    towerRelativeActive
    && altitudeKm <= 31
    && catchTotalRangeKm <= 44
    && catchLateralRangeKm <= 44
    && Math.abs(catchVerticalErrorKm) <= 34
    && propellantKg > (reserveLandingKg * 0.02);
  const towerCatchReturnProfileActive =
    towerRelativeActive
    || boostbackCatchCorridorActive
    || towerCatchAcquisitionWindow
    || catchTotalRangeKm <= 160
    || currentPhase === "descent-coast"
    || currentPhase === "terminal-intercept"
    || currentPhase === "catch-approach"
    || currentPhase === "landing-burn"
    || currentPhase === "catch-burn";
  const targetUprightAlignment = strictTerminalUprightWindow
    ? 0.92
    : (terminalApproachWindow ? 0.82 : 0.68);
  const uprightAlignmentDeficitNorm = clamp(
    (targetUprightAlignment - bodyUpAlignment) / 0.38,
    0,
    1,
  );
  const landingBurnTriggerAltitudeKm = clamp(
    baseLandingBurnTriggerAltitudeKm
      + (uprightAlignmentDeficitNorm * (strictTerminalUprightWindow ? 2.8 : (terminalApproachWindow ? 1.6 : 0.6)))
      + (
        strictTerminalUprightWindow
          ? clamp((0.70 - bodyUpAlignment) / 0.32, 0, 1) * 1.4
          : 0
      ),
    0.45,
    towerCatchReturnProfileActive ? 1.35 : 18.5,
  );
  const towerReturnTerminalProfileActive =
    towerCatchReturnProfileActive
    || boostbackCatchCorridorActive
    || catchTotalRangeKm <= 110;
  const towerCrossingInterceptAltitudeKm = (
    towerReturnTerminalProfileActive
    && catchLateralRangeKm <= 18
    && catchLateralSpeedKmS > 0.55
  )
    ? clamp(
      58
        + (10 * clamp(catchLateralSpeedKmS / 1.05, 0, 1))
        + (8 * clamp((18 - catchLateralRangeKm) / 18, 0, 1)),
      58,
      76,
    )
    : 0;
  const lateTerminalInterceptAltitudeKm = clamp(
    Math.max(
      towerReturnTerminalProfileActive
        ? (
          24.0
            + (0.72 * Math.min(catchLateralRangeKm, 24))
            + (4.2 * clamp(catchLateralSpeedKmS / 0.45, 0, 1))
        )
        : 5.8,
      towerCrossingInterceptAltitudeKm,
      landingBurnTriggerAltitudeKm + 0.8,
    ),
    towerReturnTerminalProfileActive ? 10.5 : 5.8,
    towerReturnTerminalProfileActive ? 58.0 : 12.5,
  );

  const separationFlipMinSec = 1.4;
  const separationFlipSettleSec = 4.8;
  const boostbackMinimumIgnitionSec = 5.2;
  const boostbackAlignmentGraceSec = 8.4;
  const highAltitudeEntryFloorKm = Math.max(24, landingBurnTriggerAltitudeKm * 2.6);
  const lowAltitudeEntryFloorKm = Math.max(16, landingBurnTriggerAltitudeKm * 1.35);
  const boostbackContinuationFloorKm = Math.max(12, lowAltitudeEntryFloorKm * 0.80);
  const touchdownBandKm = 0.03;
  const rtlsLateralWindowKm = 130;
  const significantSiteErrorKm = 18;
  const landingSiteTightenKm = 3.0;
  const gridFinAuthority = resolveGridFinAuthority({
    altitudeKm,
    dynamicPressurePa,
    tangentialSpeedKmS,
    downwardSpeedKmS,
  });
  const separationPhaseActive = !currentPhase || currentPhase === "separation-flip" || currentPhase === "separation-coast";
  const lateralErrorNorm = clamp(launchSiteLateralRangeKm / rtlsLateralWindowKm, 0, 1);
  const closingDeficitNorm = clamp(
    (0.12 - launchSiteLateralClosingSpeedKmS) / 0.24,
    0,
    1,
  );
  const farFromLaunchSite =
    launchSiteLateralRangeKm > significantSiteErrorKm
    || launchSiteRangeKm > (rtlsLateralWindowKm * 1.1);
  const hasBoostbackBudget = propellantKg > (reserveLandingKg * 0.28);
  const returnEnergyNorm = Math.max(
    lateralErrorNorm,
    clamp((tangentialSpeedKmS - 0.95) / 2.6, 0, 1),
    lateralClosingNeedNorm,
  );
  const boostbackInterceptDemand = resolveBoostbackInterceptDemand({
    catchTotalRangeKm,
    catchLateralRangeKm,
    launchSiteLateralRangeKm,
    launchSiteLateralClosingSpeedKmS,
    tangentialSpeedKmS,
    altitudeKm,
    radialSpeedKmS,
    timeToGroundSec,
    towerRelativeActive: boostbackCatchCorridorActive,
  });
  const boostbackPredictiveMetrics = resolveBoostbackPredictiveMetrics({
    altitudeKm,
    catchEastErrorKm,
    catchNorthErrorKm,
    catchEastSpeedKmS,
    catchNorthSpeedKmS,
    catchVerticalErrorKm,
    catchVerticalSpeedKmS,
    catchLateralRangeKm,
    catchApproachSpeedKmS,
    timeToGroundSec,
    towerRelativeActive: boostbackCatchCorridorActive,
  });
  const aeroCrossrangeDemand = resolveAeroCrossrangeDemand({
    altitudeKm,
    dynamicPressurePa,
    gridFinAuthority,
    launchSiteLateralRangeKm,
    launchSiteLateralClosingSpeedKmS,
    catchLateralRangeKm,
    catchLateralSpeedKmS,
    desiredLateralClosingKmS,
  });
  const aeroPredictiveIntercept = resolveTerminalInterceptMetrics({
    altitudeKm,
    catchTotalRangeKm,
    catchLateralRangeKm,
    catchVerticalErrorKm,
    catchApproachSpeedKmS,
    catchEastErrorKm,
    catchNorthErrorKm,
    catchEastSpeedKmS,
    catchNorthSpeedKmS,
    catchVerticalSpeedKmS,
    towerRelativeActive,
  });
  const aeroPredictiveCatchControl = aeroCrossrangeDemand.targetingActive
    ? {
      enabled: true,
      blend: clamp(
        0.22
          + (0.20 * aeroCrossrangeDemand.crossrangeDemandNorm)
          + (0.14 * aeroPredictiveIntercept.predictiveLateralMissNorm)
          + (towerRelativeActive ? 0.08 : 0),
        0.22,
        0.72,
      ),
      retrogradeBias: clamp(
        0.08
          + (0.08 * aeroCrossrangeDemand.closingNeedNorm)
          + (towerRelativeActive ? 0.04 : 0),
        0.06,
        0.24,
      ),
      interceptTimeSec: aeroPredictiveIntercept.interceptTimeSec,
      localDirection: { ...aeroPredictiveIntercept.localDirection },
      desiredEastSpeedKmS: aeroPredictiveIntercept.desiredEastSpeedKmS,
      desiredNorthSpeedKmS: aeroPredictiveIntercept.desiredNorthSpeedKmS,
      desiredVerticalSpeedKmS: aeroPredictiveIntercept.desiredVerticalSpeedKmS,
      predictedEastMissKm: aeroPredictiveIntercept.predictedEastMissKm,
      predictedNorthMissKm: aeroPredictiveIntercept.predictedNorthMissKm,
      predictedVerticalMissKm: aeroPredictiveIntercept.predictedVerticalMissKm,
      predictedLateralMissKm: aeroPredictiveIntercept.predictedLateralMissKm,
      predictedTotalMissKm: aeroPredictiveIntercept.predictedTotalMissKm,
    }
    : null;
  if (altitudeKm <= touchdownBandKm && Math.abs(radialSpeedKmS) < 0.025 && tangentialSpeedKmS < 0.02) {
    return {
      phase: "landed",
      guidanceMode: "booster-landed",
      throttle: 0,
      directionMix: { up: 1, retrograde: 0, antiTangent: 0 },
      siteVectorWeight: 0,
      siteVelocityWeight: 0,
      touchdownReady: true,
    };
  }

  const flipAlignment = clamp((0.68 * bodyRetrogradeAlignment) + (0.32 * bodyAntiTangentAlignment), -1, 1);
  const flipComplete = flipAlignment >= 0.82;
  const attitudeStillMostlyUp = bodyUpAlignment > 0.35;
  const thinAirEntryWindow =
    radialSpeedKmS < -0.03
    && altitudeKm > highAltitudeEntryFloorKm
    && (
      dynamicPressurePa < 4_500
      || gridFinAuthority < 0.10
    );
  const forceThinAirEntryAlignment =
    thinAirEntryWindow
    && bodyUpAlignment < 0.35
    && gridFinAuthority < 0.10;
  const aeroEntryWindow =
    radialSpeedKmS < -0.05
    && altitudeKm > lowAltitudeEntryFloorKm
    && (
      dynamicPressurePa > 3_000
      || gridFinAuthority > 0.08
    );
  const terminalUprightCommitNorm = clamp(
    Math.max(
      terminalApproachWindow ? 0.35 : 0,
      strictTerminalUprightWindow ? 0.55 : 0,
      uprightAlignmentDeficitNorm,
    ),
    0,
    1,
  );
  const landingBurnCommitted =
    currentPhase === "landing-burn"
    || currentPhase === "catch-burn";
  const flipPhaseProgress = clamp(
    (elapsedSec - separationFlipMinSec) / Math.max(separationFlipSettleSec - separationFlipMinSec, 0.1),
    0,
    1,
  );
  const boostbackDemand =
    altitudeKm > 38
    && hasBoostbackBudget
    && (
      boostbackInterceptDemand.demandNorm > 0.18
      || farFromLaunchSite
      || returnEnergyNorm > 0.2
    );
  const boostbackBurnDurationSec = Math.max(0, elapsedSec - boostbackMinimumIgnitionSec);
	  const maxUsefulBoostbackBurnSec = boostbackCatchCorridorActive
	    ? clamp(
	      90
	        + (7 * clamp(catchTotalRangeKm / 180, 0, 1))
	        + (7 * clamp(catchLateralRangeKm / 140, 0, 1)),
	      90,
	      104,
	    )
    : clamp(
      62
        + (0.08 * catchTotalRangeKm)
        + (10 * clamp(catchLateralSpeedKmS / 0.55, 0, 1)),
      62,
      92,
    );
  const boostbackDivergenceNorm = clamp(
    (-launchSiteLateralClosingSpeedKmS) / Math.max(boostbackInterceptDemand.desiredLateralClosingKmS, 0.18),
    0,
    1,
  );
  const boostbackClosingDeficitNorm = clamp(
    (
      (boostbackInterceptDemand.desiredLateralClosingKmS * 0.72)
      - launchSiteLateralClosingSpeedKmS
    ) / Math.max(boostbackInterceptDemand.desiredLateralClosingKmS, 0.12),
    0,
    1,
  );
  const boostbackOverClosingNorm = clamp(
    (
      launchSiteLateralClosingSpeedKmS
      - (boostbackInterceptDemand.desiredLateralClosingKmS * 1.05)
    ) / Math.max(boostbackInterceptDemand.desiredLateralClosingKmS, 0.18),
    0,
    1,
  );
  const boostbackTowerCorridorHighNorm = boostbackCatchCorridorActive
    ? Math.max(
      boostbackPredictiveMetrics.lateralInterceptTooHighNorm,
      clamp(
        (boostbackPredictiveMetrics.signedLateralClosingSpeedKmS - 0.54) / 0.36,
        0,
        1,
      ) * clamp(
        (boostbackPredictiveMetrics.predictedVerticalAtLateralInterceptKm - 5.0) / 26.0,
        0,
        1,
      ),
    )
    : 0;
  const boostbackTargetLateralSpeedKmS = boostbackCatchCorridorActive
    ? (
      altitudeKm > 70
        ? 1.45
        : altitudeKm > 48
          ? 1.20
          : altitudeKm > 34
            ? 0.86
            : 0.52
    )
    : maxResidualLateralSpeedKmS;
  const boostbackTargetClosingSpeedKmS = boostbackCatchCorridorActive
    ? (
      altitudeKm > 70
        ? 1.45
        : altitudeKm > 48
          ? 1.20
          : altitudeKm > 34
            ? 0.86
            : 0.52
    )
    : boostbackInterceptDemand.desiredLateralClosingKmS;
  const boostbackCorridorOverClosingNorm = boostbackCatchCorridorActive
    ? clamp(
      (
        boostbackPredictiveMetrics.signedLateralClosingSpeedKmS
        - boostbackTargetClosingSpeedKmS
      ) / 0.34,
      0,
      1,
    )
    : 0;
  const boostbackReturnOverspeedNorm = Math.max(
    boostbackOverClosingNorm,
    boostbackCorridorOverClosingNorm,
    boostbackTowerCorridorHighNorm * 0.55,
  );
  const boostbackLateralEnergySolved = catchLateralSpeedKmS <= boostbackTargetLateralSpeedKmS
    && boostbackPredictiveMetrics.signedLateralClosingSpeedKmS <= boostbackTargetClosingSpeedKmS;
  const boostbackPredictedCorridorSolved = Boolean(
    (
      boostbackCatchCorridorActive
        ? (
	          boostbackPredictiveMetrics.predictedCorridorMissKm <= 1.8
          && boostbackTowerCorridorHighNorm <= 0.42
          && launchSiteLateralClosingSpeedKmS >= 0.28
          && boostbackLateralEnergySolved
        )
        : (
          boostbackPredictiveMetrics.predictedLateralMissKm <= 2.6
          && boostbackOverClosingNorm > 0.12
        )
    )
    && launchSiteLateralRangeKm <= 90
  );
  const boostbackNeedsPoweredCorrection = Boolean(
    boostbackDivergenceNorm > 0.10
    || boostbackClosingDeficitNorm > 0.10
    || (
	      boostbackPredictiveMetrics.predictedCorridorMissKm > 1.8
      && (
        boostbackCatchCorridorActive
          ? boostbackTowerCorridorHighNorm < 0.72
          : boostbackOverClosingNorm < 0.55
      )
    )
    || (
      catchLateralSpeedKmS > maxResidualLateralSpeedKmS
      && (
        boostbackCatchCorridorActive
          ? (
            boostbackTowerCorridorHighNorm > 0.18
            || catchLateralSpeedKmS > boostbackTargetLateralSpeedKmS
            || boostbackPredictiveMetrics.signedLateralClosingSpeedKmS > boostbackTargetClosingSpeedKmS
          )
          : boostbackOverClosingNorm < 0.72
      )
    )
    || (
      boostbackCatchCorridorActive
      && boostbackPredictiveMetrics.predictedLateralMissKm > 10
      && altitudeKm > 34
    )
    || (
      boostbackCatchCorridorActive
      && !boostbackLateralEnergySolved
      && altitudeKm > 32
    )
    || (
      catchLateralRangeKm <= 14
      && catchLateralSpeedKmS > 0.30
      && boostbackOverClosingNorm < 0.45
    )
    || (
      catchLateralRangeKm <= 6
      && catchLateralSpeedKmS > 0.16
      && boostbackOverClosingNorm < 0.35
    )
    || (
      (catchLateralRangeKm > 4 || launchSiteLateralRangeKm > 3.5)
      && boostbackOverClosingNorm < 0.22
	      && boostbackPredictiveMetrics.predictedLateralMissKm > 1.8
    )
  );
  const boostbackThinAirWindow =
    altitudeKm > Math.max(lowAltitudeEntryFloorKm, 32)
    && dynamicPressurePa < 42_000;
  const boostbackSettledIgnitionEligible = boostbackDemand
    && elapsedSec >= boostbackMinimumIgnitionSec
    && (
      flipAlignment >= boostbackInterceptDemand.ignitionAlignmentMin
      || bodyRetrogradeAlignment >= Math.max(0.28, boostbackInterceptDemand.ignitionAlignmentMin - 0.08)
    );
  const boostbackRollingIgnitionEligible = boostbackDemand
    && elapsedSec >= boostbackAlignmentGraceSec
    && (
      flipAlignment >= Math.max(0.18, boostbackInterceptDemand.ignitionAlignmentMin - 0.18)
      || bodyRetrogradeAlignment >= Math.max(0.14, boostbackInterceptDemand.ignitionAlignmentMin - 0.22)
    );
  const initialBoostbackIgnitionEligible =
    separationPhaseActive
    && (
      boostbackSettledIgnitionEligible
      || boostbackRollingIgnitionEligible
    );

  if (
    separationPhaseActive
    && (
    elapsedSec < separationFlipMinSec
    || (
      elapsedSec < separationFlipSettleSec
      && !initialBoostbackIgnitionEligible
      && (!flipComplete || attitudeStillMostlyUp)
    )
    )
  ) {
    const settleBlend = clamp((elapsedSec - 1.2) / Math.max(separationFlipSettleSec - 1.2, 0.1), 0, 1);
    return {
      phase: "separation-flip",
      guidanceMode: "booster-separation-flip",
      attitudeResponseScale: elapsedSec < 1.8
        ? 0.18
        : (0.74 + (1.08 * settleBlend)),
      attitudeTargetBlend: elapsedSec < 1.8
        ? 0.10
        : (0.28 + (0.42 * settleBlend)),
      angularDampingPerS: 0.08 + (0.08 * settleBlend),
      maxBodyRateDegS: 4.4 + (2.0 * settleBlend),
      siteTargetingEnabled: false,
      qAlphaSteeringEnabled: false,
      throttle: 0,
      directionMix: {
        up: 0.24 - (0.16 * flipPhaseProgress),
        retrograde: 1.0,
        antiTangent: 0.08 + (0.18 * flipPhaseProgress),
      },
    };
  }

  if (
    separationPhaseActive
    && !initialBoostbackIgnitionEligible
    && (
    altitudeKm > 48
    && (
      catchTotalRangeKm > 6
      || launchSiteLateralRangeKm > 4
      || downwardSpeedKmS < 0.32
      || radialSpeedKmS > -0.06
    )
    )
  ) {
    const coastPhaseProgress = clamp(
      (elapsedSec - separationFlipSettleSec) / 4.2,
      0,
      1,
    );
    return {
      phase: "separation-coast",
      guidanceMode: "booster-separation-coast",
      attitudeResponseScale: 1.28 + (0.32 * coastPhaseProgress),
      attitudeTargetBlend: 0.68 + (0.18 * coastPhaseProgress),
      angularDampingPerS: 0.14 + (0.08 * coastPhaseProgress),
      maxBodyRateDegS: 6.4 + (1.0 * coastPhaseProgress),
      siteTargetingEnabled: false,
      qAlphaSteeringEnabled: false,
      throttle: 0,
      directionMix: {
        up: 0.08 - (0.03 * coastPhaseProgress),
        retrograde: 1.0,
        antiTangent: 0.18 + (0.12 * coastPhaseProgress),
      },
      };
  }
  if (
    (
      initialBoostbackIgnitionEligible
      || (
        currentPhase === "boostback"
        && boostbackThinAirWindow
        && hasBoostbackBudget
        && boostbackBurnDurationSec <= maxUsefulBoostbackBurnSec
        && !boostbackPredictedCorridorSolved
        && boostbackNeedsPoweredCorrection
      )
    )
  ) {
    const tangentialScale = boostbackInterceptDemand.tangentialNorm;
    const rtlsDemand = Math.max(
      returnEnergyNorm,
      closingDeficitNorm,
      boostbackInterceptDemand.demandNorm,
    );
    const flipIgnitionBlend = clamp(
      (
        Math.max(flipAlignment, bodyRetrogradeAlignment)
        - (boostbackInterceptDemand.ignitionAlignmentMin - 0.12)
      ) / 0.30,
      0,
      1,
    );
    const ignitionBlend = clamp(
      Math.max(
        (elapsedSec - boostbackMinimumIgnitionSec) / Math.max(boostbackAlignmentGraceSec - boostbackMinimumIgnitionSec, 0.1),
        flipIgnitionBlend,
      ),
      0,
    1,
    );
      const boostbackBurnAlignment = Math.max(bodyRetrogradeAlignment, flipAlignment);
    const boostbackThrottleGateRaw = clamp(
        (boostbackBurnAlignment - 0.18) / 0.42,
        0,
        1,
      );
      const boostbackThrottleGate = boostbackCatchCorridorActive
        && boostbackPredictiveMetrics.predictedLateralMissKm > 10
        ? Math.max(boostbackThrottleGateRaw, 0.55)
        : boostbackThrottleGateRaw;
      const boostbackSiteTargetingActive = true;
      const boostbackOverClosingThrottleScale = clamp(
        1 - (0.42 * Math.max(boostbackOverClosingNorm, boostbackTowerCorridorHighNorm * 0.8)),
        boostbackCatchCorridorActive ? 0.76 : 0.44,
        1,
      );
      const towerRelativeBoostbackClosingCapKmS = boostbackCatchCorridorActive
        ? clamp(
          boostbackTargetClosingSpeedKmS + (0.12 * (1 - boostbackTowerCorridorHighNorm)),
          0.30,
          0.94,
        )
        : 2.80;
      const towerRelativeBoostbackClosingFloorKmS = boostbackCatchCorridorActive
        ? clamp(
          boostbackTargetClosingSpeedKmS * 0.58,
          0.12,
          0.34,
        )
        : 0.32;
      return {
        phase: "boostback",
        guidanceMode: "booster-boostback",
        attitudeControlMode: "engines+rcs",
        aeroAuthority: 0,
        attitudeResponseScale: 2.05 + (0.55 * ignitionBlend),
        attitudeTargetBlend: 0.92 + (0.06 * ignitionBlend),
        angularDampingPerS: 0.62 + (0.22 * ignitionBlend),
        maxBodyRateDegS: 12.5 + (5.5 * ignitionBlend),
        siteTargetingEnabled: boostbackSiteTargetingActive,
        maxSiteSteeringAngleDeg: boostbackSiteTargetingActive ? 58 : 0,
        qAlphaSteeringEnabled: false,
        throttle: clamp(
          Math.max(
            (
              0.78
                + (0.08 * tangentialScale)
                + (0.10 * rtlsDemand)
                + (0.12 * boostbackInterceptDemand.closingNeedNorm)
                + (0.10 * boostbackDivergenceNorm)
                + (0.14 * boostbackPredictiveMetrics.speedDemandNorm)
                + (0.10 * boostbackPredictiveMetrics.predictiveLateralMissNorm)
                + (0.08 * boostbackTowerCorridorHighNorm)
                + (0.06 * ignitionBlend)
            ) * boostbackThrottleGate * boostbackOverClosingThrottleScale,
            currentPhase === "boostback" && boostbackSiteTargetingActive
              ? (
                boostbackCatchCorridorActive
                  ? (0.72 + (0.18 * (1 - boostbackOverClosingNorm)))
                  : (0.36 + (0.22 * (1 - boostbackOverClosingNorm)))
              )
              : 0,
          ),
          0.22,
          0.98,
        ),
        directionMix: {
        up: 0.08,
        retrograde: clamp(
          0.10 + (0.30 * boostbackReturnOverspeedNorm),
          0.10,
          0.42,
        ),
        antiTangent: clamp(
          1.02
            - (0.44 * boostbackReturnOverspeedNorm)
            + (
              0.22
                * boostbackInterceptDemand.lateralMissNorm
                * boostbackThrottleGate
                * (boostbackSiteTargetingActive ? 1 : 0)
            ),
            boostbackSiteTargetingActive ? 0.58 : 0.78,
            1.30,
        ),
        },
        siteVectorWeight: boostbackSiteTargetingActive
          ? clamp(
            0.42
              + (0.32 * boostbackInterceptDemand.lateralMissNorm)
              + (0.18 * boostbackPredictiveMetrics.predictiveLateralMissNorm),
            0.34,
            0.90,
          )
          : 0,
        siteVelocityWeight: boostbackSiteTargetingActive
          ? clamp(
              0.30
                + (0.30 * boostbackInterceptDemand.closingNeedNorm)
                + (0.22 * boostbackPredictiveMetrics.speedDemandNorm)
                + (0.18 * boostbackPredictiveMetrics.speedDemandNorm),
            0.24,
            boostbackCatchCorridorActive ? 1.08 : 0.92,
          )
          : 0,
        padInterceptBlend: boostbackSiteTargetingActive
          ? clamp(
            0.72
              + (0.18 * boostbackDivergenceNorm)
              + (0.24 * boostbackInterceptDemand.closingNeedNorm)
              + (0.12 * boostbackPredictiveMetrics.speedDemandNorm)
              + (0.10 * boostbackPredictiveMetrics.predictiveLateralMissNorm),
            0.72,
            1.0,
          )
          : 0,
        padInterceptLateralWeight: boostbackSiteTargetingActive
          ? clamp(
            0.98
              + (0.62 * boostbackInterceptDemand.lateralMissNorm)
              + (0.30 * boostbackPredictiveMetrics.predictiveLateralMissNorm),
            0.86,
            2.20,
          )
          : 0,
        padDesiredLateralClosingSpeedKmS: boostbackSiteTargetingActive
          ? clamp(
            Math.max(
              boostbackInterceptDemand.desiredLateralClosingKmS,
              Math.hypot(
                boostbackPredictiveMetrics.desiredEastSpeedKmS,
                boostbackPredictiveMetrics.desiredNorthSpeedKmS,
              ),
            ),
            towerRelativeBoostbackClosingFloorKmS,
            towerRelativeBoostbackClosingCapKmS,
          )
          : 0,
        padInterceptTimeSec: boostbackSiteTargetingActive
          ? Math.min(
            boostbackInterceptDemand.interceptTimeSec,
            boostbackPredictiveMetrics.interceptTimeSec,
          )
          : 0,
        predictiveCatchControl: boostbackSiteTargetingActive
          ? {
            enabled: true,
            blend: clamp(
              0.46
                + (0.22 * boostbackPredictiveMetrics.lateralDemandNorm)
                + (0.12 * boostbackPredictiveMetrics.speedDemandNorm),
              0.46,
              boostbackCatchCorridorActive ? 0.92 : 0.84,
            ),
            retrogradeBias: clamp(
              0.10
                + (0.10 * boostbackPredictiveMetrics.speedDemandNorm)
                + (0.08 * boostbackTowerCorridorHighNorm),
              0.10,
              boostbackCatchCorridorActive ? 0.28 : 0.24,
            ),
            interceptTimeSec: boostbackPredictiveMetrics.interceptTimeSec,
            localDirection: { ...boostbackPredictiveMetrics.localDirection },
            desiredEastSpeedKmS: boostbackPredictiveMetrics.desiredEastSpeedKmS,
            desiredNorthSpeedKmS: boostbackPredictiveMetrics.desiredNorthSpeedKmS,
            desiredVerticalSpeedKmS: 0,
            predictedEastMissKm: boostbackPredictiveMetrics.predictedEastMissKm,
            predictedNorthMissKm: boostbackPredictiveMetrics.predictedNorthMissKm,
            predictedVerticalMissKm: 0,
            predictedLateralMissKm: boostbackPredictiveMetrics.predictedLateralMissKm,
            predictedTotalMissKm: boostbackPredictiveMetrics.predictedLateralMissKm,
          }
          : null,
      };
  }

  if (
    (currentPhase === "boostback" || currentPhase === "hotstage-ring-jettison")
    && boostbackBurnDurationSec <= (maxUsefulBoostbackBurnSec + 2.5)
  ) {
    return {
      phase: "hotstage-ring-jettison",
      guidanceMode: "booster-hotstage-ring-jettison",
      attitudeControlMode: "rcs",
      qAlphaSteeringEnabled: false,
      aeroAuthority: clamp(gridFinAuthority, 0, 0.18),
      siteTargetingEnabled: false,
      throttle: 0,
      terminalUprightCommit: true,
      uprightTiltLimitDeg: 24,
      directionMix: {
        up: 0.82,
        retrograde: 0.10,
        antiTangent: 0.08,
      },
      siteVectorWeight: 0.32,
      siteVelocityWeight: 0.28,
      padInterceptBlend: 0.28,
      padInterceptLateralWeight: 0.72,
      padDesiredLateralClosingSpeedKmS: clamp(
        boostbackTargetClosingSpeedKmS * 0.75,
        0.12,
        0.62,
      ),
      maxSiteSteeringAngleDeg: 34,
      attitudeResponseScale: 1.16,
      attitudeTargetBlend: 0.84,
      angularDampingPerS: 0.72,
      maxBodyRateDegS: 9.0,
      hotstageRingJettisoned: true,
    };
  }

  const entryBurnPriorityWindow = Boolean(
    aeroEntryWindow
    && altitudeKm <= 42
    && dynamicPressurePa >= 8_000
    && bodyUpAlignment >= 0.72
    && (
      downwardSpeedKmS > 0.12
      || tangentialSpeedKmS > 0.55
    )
  );
  const highAltitudeTowerCorridorHold =
    altitudeKm > 28
    && altitudeKm <= 120
    && catchLateralRangeKm <= 72
    && !entryBurnPriorityWindow
    && !(towerCrossingInterceptAltitudeKm > 0 && altitudeKm <= towerCrossingInterceptAltitudeKm)
    && bodyUpAlignment >= 0.72
    && propellantKg > (reserveLandingKg * 0.08);
  if (highAltitudeTowerCorridorHold) {
    const highAltitudeIntercept = resolveTerminalInterceptMetrics({
      altitudeKm,
      catchTotalRangeKm,
      catchLateralRangeKm,
      catchVerticalErrorKm,
      catchApproachSpeedKmS,
      catchEastErrorKm,
      catchNorthErrorKm,
      catchEastSpeedKmS,
      catchNorthSpeedKmS,
      catchVerticalSpeedKmS,
      towerRelativeActive: true,
    });
    const highAltitudeBrakeNorm = clamp(
      ((-catchVerticalSpeedKmS - 0.65) / 1.25) * ((70 - altitudeKm) / 42),
      0,
      1,
    );
    return {
      phase: "descent-coast",
      guidanceMode: "booster-descent-coast",
      attitudeControlMode: "grid-fins+rcs",
      qAlphaSteeringEnabled: false,
      aeroAuthority: clamp(gridFinAuthority, 0, 1),
      siteTargetingEnabled: true,
      throttle: 0,
      directionMix: {
        up: 0.96,
        retrograde: 0.14 + (0.08 * highAltitudeBrakeNorm),
        antiTangent: 0.08,
      },
      terminalUprightCommit: true,
      uprightTiltLimitDeg: clamp(24 + (0.58 * Math.min(catchLateralRangeKm, 36)), 24, 52),
      siteVectorWeight: 0.78,
      siteVelocityWeight: 0.86,
      padInterceptBlend: 1.0,
      padInterceptLateralWeight: 2.10,
      padDesiredLateralClosingSpeedKmS: clamp(
        Math.max(
          altitudeKm > 70 ? 0.62 : altitudeKm > 42 ? 0.52 : 0.42,
          Math.hypot(
            highAltitudeIntercept.desiredEastSpeedKmS,
            highAltitudeIntercept.desiredNorthSpeedKmS,
          ),
        ),
        altitudeKm > 70 ? 0.46 : altitudeKm > 42 ? 0.40 : 0.32,
        altitudeKm > 70 ? 1.08 : altitudeKm > 42 ? 0.96 : 0.68,
      ),
      maxSiteSteeringAngleDeg: 86,
      attitudeResponseScale: 1.46,
      attitudeTargetBlend: 0.94,
      angularDampingPerS: 1.04,
      maxBodyRateDegS: 16.0,
      predictiveCatchControl: {
        enabled: true,
        blend: 0.74,
        retrogradeBias: 0.10,
        translationAuthority: clamp(
          0.32 + (0.34 * highAltitudeIntercept.lateralDemandNorm),
          0.32,
          0.72,
        ),
        interceptTimeSec: highAltitudeIntercept.interceptTimeSec,
        localDirection: { ...highAltitudeIntercept.localDirection },
        desiredEastSpeedKmS: highAltitudeIntercept.desiredEastSpeedKmS,
        desiredNorthSpeedKmS: highAltitudeIntercept.desiredNorthSpeedKmS,
        desiredVerticalSpeedKmS: highAltitudeIntercept.desiredVerticalSpeedKmS,
        predictedEastMissKm: highAltitudeIntercept.predictedEastMissKm,
        predictedNorthMissKm: highAltitudeIntercept.predictedNorthMissKm,
        predictedVerticalMissKm: highAltitudeIntercept.predictedVerticalMissKm,
        predictedLateralMissKm: highAltitudeIntercept.predictedLateralMissKm,
        predictedTotalMissKm: highAltitudeIntercept.predictedTotalMissKm,
      },
    };
  }

  if (
    thinAirEntryWindow
    && altitudeKm <= 108
    && currentPhase !== "terminal-intercept"
    && (!towerCatchReturnProfileActive || forceThinAirEntryAlignment)
    && !towerCatchAcquisitionWindow
  ) {
    const entryAlignNeedNorm = clamp(
      Math.max(
        (0.84 - bodyUpAlignment) / 0.34,
        (0.90 - bodyRetrogradeAlignment) / 0.30,
        (0.10 + tangentialSpeedKmS) / 1.4,
      ),
      0,
      1,
    );
    if (entryAlignNeedNorm > 0.04) {
      return {
        phase: "entry-align",
        guidanceMode: "booster-entry-align",
        attitudeControlMode: dynamicPressurePa > 1_800 ? "grid-fins+rcs" : "rcs",
        aeroAuthority: clamp(gridFinAuthority, 0, 0.4),
        terminalUprightCommit: true,
        uprightTiltLimitDeg: clamp(
          (strictTerminalUprightWindow ? 7 : (terminalApproachWindow ? 10 : 13))
            + (0.08 * Math.min(launchSiteLateralRangeKm, 70)),
          strictTerminalUprightWindow ? 7 : (terminalApproachWindow ? 10 : 13),
          28,
        ),
        attitudeResponseScale: 1.18 + (0.42 * Math.max(entryAlignNeedNorm, terminalUprightCommitNorm)),
        attitudeTargetBlend: 0.88 + (0.08 * Math.max(entryAlignNeedNorm, terminalUprightCommitNorm)),
        angularDampingPerS: 0.94 + (0.18 * Math.max(entryAlignNeedNorm, terminalUprightCommitNorm)),
        maxBodyRateDegS: 14.0,
        siteTargetingEnabled: Boolean(
          terminalApproachWindow
          && aeroCrossrangeDemand.targetingActive
          && gridFinAuthority > 0.12
        ),
        throttle: 0,
        directionMix: {
          up: 0.98 + (0.10 * terminalUprightCommitNorm),
          retrograde: 0.34 - (0.08 * terminalUprightCommitNorm),
          antiTangent: clamp(
            0.05 + (0.06 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
            0.05,
            0.12,
          ),
        },
        siteVectorWeight: clamp(
          0.16 + (0.34 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.08,
          0.52,
        ),
        siteVelocityWeight: clamp(
          0.10 + (0.22 * aeroCrossrangeDemand.closingNeedNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.06,
          0.34,
        ),
        padInterceptBlend: clamp(
          0.18 + (0.22 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.10,
          0.42,
        ),
        padInterceptLateralWeight: clamp(
          0.22 + (0.30 * aeroCrossrangeDemand.crossrangeDemandNorm),
          0.14,
          0.56,
        ),
        padDesiredLateralClosingSpeedKmS: clamp(
          desiredLateralClosingKmS * (1.30 + (0.28 * aeroCrossrangeDemand.crossrangeDemandNorm)),
          0.08,
          0.92,
        ),
        maxSiteSteeringAngleDeg: 36,
        predictiveCatchControl: aeroPredictiveCatchControl,
      };
    }
  }

  if (
    aeroEntryWindow
    && altitudeKm <= 37.0
    && currentPhase !== "terminal-intercept"
    && (!towerCatchReturnProfileActive || entryBurnPriorityWindow)
    && !towerCatchAcquisitionWindow
  ) {
    const descendingIntoEntry = downwardSpeedKmS > 0.08 && radialSpeedKmS < -0.08;
    if (!descendingIntoEntry && altitudeKm <= 25.8) {
      return {
        phase: "ballistic-descent",
        guidanceMode: "booster-ballistic-settle",
        attitudeControlMode: "grid-fins+rcs",
        aeroAuthority: gridFinAuthority,
        terminalUprightCommit: true,
        uprightTiltLimitDeg: clamp(
          (strictTerminalUprightWindow ? 7 : 10) + (0.08 * Math.min(launchSiteLateralRangeKm, 70)),
          strictTerminalUprightWindow ? 7 : 10,
          28,
        ),
        attitudeResponseScale: 1.08 + (0.34 * terminalUprightCommitNorm),
        attitudeTargetBlend: 0.84 + (0.10 * terminalUprightCommitNorm),
        angularDampingPerS: 0.86 + (0.16 * terminalUprightCommitNorm),
        maxBodyRateDegS: 12.5,
        siteTargetingEnabled: aeroCrossrangeDemand.targetingActive,
        throttle: 0,
        directionMix: {
          up: 1.00 + (0.08 * terminalUprightCommitNorm),
          retrograde: 0.18 - (0.04 * terminalUprightCommitNorm),
          antiTangent: clamp(
            0.06 + (0.08 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
            0.06,
            0.14,
          ),
        },
        siteVectorWeight: clamp(
          0.24 + (0.50 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.14,
          0.82,
        ),
        siteVelocityWeight: clamp(
          0.14 + (0.36 * aeroCrossrangeDemand.closingNeedNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.08,
          0.56,
        ),
        padInterceptBlend: clamp(
          0.18 + (0.26 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.10,
          0.50,
        ),
        padInterceptLateralWeight: clamp(
          0.24 + (0.38 * aeroCrossrangeDemand.crossrangeDemandNorm),
          0.16,
          0.64,
        ),
        padDesiredLateralClosingSpeedKmS: clamp(
          desiredLateralClosingKmS * (1.34 + (0.30 * aeroCrossrangeDemand.crossrangeDemandNorm)),
          0.10,
          1.00,
        ),
        maxSiteSteeringAngleDeg: 38,
        predictiveCatchControl: aeroPredictiveCatchControl,
      };
    }
    const entryInterfaceNorm = Math.max(
      clamp((dynamicPressurePa - 8_000) / 18_000, 0, 1),
      clamp((downwardSpeedKmS - 0.12) / 0.42, 0, 1),
      clamp((launchSiteLateralRangeKm - 4) / 18, 0, 1),
    );
    if (entryInterfaceNorm > 0.08) {
      return {
        phase: "entry-burn",
        guidanceMode: "booster-entry-burn",
        attitudeControlMode: "grid-fins+engines",
        aeroAuthority: gridFinAuthority,
        terminalUprightCommit: true,
        uprightTiltLimitDeg: clamp(
          (strictTerminalUprightWindow ? 6 : 9)
            + (0.08 * Math.min(launchSiteLateralRangeKm, 70))
            + (
              towerRelativeActive
                ? 24 * clamp((catchLateralSpeedKmS - 0.55) / 0.55, 0, 1)
                  * clamp((catchLateralRangeKm - 8.0) / 18.0, 0, 1)
                : 0
            ),
          strictTerminalUprightWindow ? 6 : 9,
          towerRelativeActive ? 42 : 24,
        ),
        attitudeResponseScale: 1.20 + (0.30 * terminalUprightCommitNorm),
        attitudeTargetBlend: 0.86 + (0.08 * terminalUprightCommitNorm),
        angularDampingPerS: 0.92 + (0.12 * terminalUprightCommitNorm),
        maxBodyRateDegS: 11.5,
        throttle: clamp(
          0.34
            + (0.40 * entryInterfaceNorm)
            + (
              towerRelativeActive
                ? 0.12 * clamp((catchLateralSpeedKmS - 0.55) / 0.55, 0, 1)
                  * clamp((catchLateralRangeKm - 8.0) / 18.0, 0, 1)
                : 0
            ),
          0.34,
          0.86,
        ),
        directionMix: {
          up: clamp(
            0.98
              - (
                towerRelativeActive
                  ? 0.38 * clamp((catchLateralSpeedKmS - 0.55) / 0.55, 0, 1)
                    * clamp((catchLateralRangeKm - 8.0) / 18.0, 0, 1)
                  : 0
              ),
            0.56,
            0.98,
          ),
          retrograde: clamp(
            0.12
              + (
                towerRelativeActive
                  ? 0.42 * clamp((catchLateralSpeedKmS - 0.55) / 0.55, 0, 1)
                    * clamp((catchLateralRangeKm - 8.0) / 18.0, 0, 1)
                  : 0
              ),
            0.12,
            0.56,
          ),
          antiTangent: clamp(
            0.08 + (0.10 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
            0.08,
            0.16,
          ),
        },
        siteTargetingEnabled: aeroCrossrangeDemand.targetingActive,
        siteVectorWeight: clamp(
          0.18 + (0.28 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.10,
          0.48,
        ),
        siteVelocityWeight: clamp(
          0.12 + (0.24 * aeroCrossrangeDemand.closingNeedNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.08,
          0.38,
        ),
        padInterceptBlend: clamp(
          0.20 + (0.22 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.12,
          0.46,
        ),
        padInterceptLateralWeight: clamp(
          0.24 + (0.30 * aeroCrossrangeDemand.crossrangeDemandNorm),
          0.16,
          0.58,
        ),
        padDesiredLateralClosingSpeedKmS: clamp(
          desiredLateralClosingKmS * (1.34 + (0.26 * aeroCrossrangeDemand.crossrangeDemandNorm)),
          0.10,
          1.05,
        ),
        maxSiteSteeringAngleDeg: 34,
        predictiveCatchControl: aeroPredictiveCatchControl,
      };
    }
    return {
      phase: "ballistic-descent",
      guidanceMode: "booster-entry-guidance",
      attitudeControlMode: "grid-fins+rcs",
      aeroAuthority: gridFinAuthority,
      terminalUprightCommit: true,
      uprightTiltLimitDeg: clamp(
        (strictTerminalUprightWindow ? 6 : 9) + (0.08 * Math.min(launchSiteLateralRangeKm, 70)),
        strictTerminalUprightWindow ? 6 : 9,
        26,
      ),
      attitudeResponseScale: 1.10 + (0.34 * terminalUprightCommitNorm),
      attitudeTargetBlend: 0.84 + (0.08 * terminalUprightCommitNorm),
      angularDampingPerS: 0.86 + (0.14 * terminalUprightCommitNorm),
      maxBodyRateDegS: 11.5,
      throttle: 0,
      directionMix: {
        up: 1.00 + (0.08 * terminalUprightCommitNorm),
        retrograde: 0.12,
        antiTangent: clamp(
          0.08 + (0.10 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
          0.08,
          0.16,
        ),
      },
      siteTargetingEnabled: aeroCrossrangeDemand.targetingActive,
      siteVectorWeight: clamp(
        0.24 + (0.56 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
        0.14,
        0.90,
      ),
      siteVelocityWeight: clamp(
        0.16 + (0.40 * aeroCrossrangeDemand.closingNeedNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
        0.10,
        0.62,
      ),
      padInterceptBlend: clamp(
        0.22 + (0.26 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
        0.14,
        0.56,
      ),
      padInterceptLateralWeight: clamp(
        0.28 + (0.40 * aeroCrossrangeDemand.crossrangeDemandNorm),
        0.18,
        0.72,
      ),
      padDesiredLateralClosingSpeedKmS: clamp(
        desiredLateralClosingKmS * (1.42 + (0.30 * aeroCrossrangeDemand.crossrangeDemandNorm)),
        0.10,
        1.12,
      ),
      maxSiteSteeringAngleDeg: 38,
      predictiveCatchControl: aeroPredictiveCatchControl,
    };
  }

  const sustainingCatchApproach =
    currentPhase === "catch-approach"
    || currentPhase === "terminal-intercept"
    || currentPhase === "landing-burn"
    || currentPhase === "catch-burn";
  const sustainCatchCorridor =
    sustainingCatchApproach
    && towerRelativeActive
    && altitudeKm <= 30
    && catchTotalRangeKm <= 44
    && catchLateralRangeKm <= 44
    && Math.abs(catchVerticalErrorKm) <= 34
    && propellantKg > (reserveLandingKg * 0.02);

  if (
    currentPhase === "entry-burn"
    && towerRelativeActive
    && altitudeKm > 24
    && altitudeKm <= 25.8
    && catchTotalRangeKm <= 50
    && bodyUpAlignment >= 0.90
  ) {
    return {
      phase: "ballistic-descent",
      guidanceMode: "booster-ballistic-settle",
      attitudeControlMode: "grid-fins+rcs",
      qAlphaSteeringEnabled: false,
      aeroAuthority: clamp(gridFinAuthority, 0, 1),
      terminalUprightCommit: true,
      uprightTiltLimitDeg: 10,
      attitudeResponseScale: 1.24,
      attitudeTargetBlend: 0.92,
      angularDampingPerS: 0.98,
      maxBodyRateDegS: 11.5,
      throttle: 0,
      directionMix: {
        up: 1.0,
        retrograde: 0.10,
        antiTangent: 0.08,
      },
      siteTargetingEnabled: true,
      siteVectorWeight: 0.54,
      siteVelocityWeight: 0.42,
      padInterceptBlend: 0.72,
      padInterceptLateralWeight: 1.0,
      padDesiredLateralClosingSpeedKmS: 0.42,
      maxSiteSteeringAngleDeg: 38,
      predictiveCatchControl: aeroPredictiveCatchControl,
    };
  }

  let catchCommand = resolveBoosterCatchCommand({
    currentPhase,
    sustainOverride: sustainingCatchApproach,
    sustainRelaxed: sustainCatchCorridor,
    altitudeKm,
    radialSpeedKmS,
    tangentialSpeedKmS,
    launchSiteRangeKm,
    launchSiteLateralRangeKm,
    catchTotalRangeKm,
    catchLateralRangeKm,
    catchVerticalErrorKm,
    catchLateralSpeedKmS,
    catchVerticalSpeedKmS,
    catchApproachSpeedKmS,
    catchEastErrorKm,
    catchNorthErrorKm,
    catchEastSpeedKmS,
    catchNorthSpeedKmS,
    catchClosingSpeedKmS,
    towerRelativeActive,
    catchPositionSigmaKm,
    catchVelocitySigmaKmS,
    bodyUpAlignment,
  });
  const highAltitudeCatchApproachLatch =
    towerCatchAcquisitionWindow
    && currentPhase === "descent-coast"
    && altitudeKm >= 24
    && altitudeKm <= 31
    && bodyUpAlignment >= 0.90;
  const catchCorridorLatch =
    towerCatchAcquisitionWindow
    && (
      highAltitudeCatchApproachLatch
      || currentPhase === "catch-approach"
      || currentPhase === "landing-burn"
      || currentPhase === "catch-burn"
    );
  if (!catchCommand && catchCorridorLatch) {
    catchCommand = resolveBoosterCatchCommand({
      currentPhase: sustainingCatchApproach ? currentPhase : "catch-approach",
      sustainOverride: true,
      sustainRelaxed: true,
      altitudeKm,
      radialSpeedKmS,
      tangentialSpeedKmS,
      launchSiteRangeKm,
      launchSiteLateralRangeKm,
      catchTotalRangeKm,
      catchLateralRangeKm,
      catchVerticalErrorKm,
      catchLateralSpeedKmS,
      catchVerticalSpeedKmS,
      catchApproachSpeedKmS,
      catchEastErrorKm,
      catchNorthErrorKm,
      catchEastSpeedKmS,
      catchNorthSpeedKmS,
      catchClosingSpeedKmS,
      towerRelativeActive,
      catchPositionSigmaKm,
      catchVelocitySigmaKmS,
      bodyUpAlignment,
      allowFinalBurn: sustainingCatchApproach,
    });
  }
  if (catchCommand) {
    if (
      landingBurnCommitted
      && catchCommand.phase === "catch-approach"
      && towerRelativeActive
      && altitudeKm <= 30.5
      && altitudeKm > 0.02
      && catchVerticalSpeedKmS < -0.18
      && catchTotalRangeKm <= 58
      && catchLateralRangeKm <= 32
      && Math.abs(catchVerticalErrorKm) <= 34
      && catchApproachSpeedKmS <= 2.55
      && bodyUpAlignment >= 0.50
      && propellantKg > (reserveLandingKg * 0.02)
    ) {
      const landingBurnIntercept = resolveTerminalInterceptMetrics({
        altitudeKm,
        catchTotalRangeKm,
        catchLateralRangeKm,
        catchVerticalErrorKm,
        catchApproachSpeedKmS,
        catchEastErrorKm,
        catchNorthErrorKm,
        catchEastSpeedKmS,
        catchNorthSpeedKmS,
        catchVerticalSpeedKmS,
        towerRelativeActive,
      });
      return buildSustainedTowerLandingBurnCommand({
        altitudeKm,
        catchLateralRangeKm,
        catchLateralSpeedKmS,
        catchVerticalErrorKm,
        catchVerticalSpeedKmS,
        catchApproachSpeedKmS,
        gridFinAuthority,
        terminalUprightCommitNorm,
        terminalIntercept: landingBurnIntercept,
      });
    }
    return catchCommand;
  }
  const sustainedTowerLandingBurn = Boolean(
    landingBurnCommitted
	    && towerRelativeActive
	    && altitudeKm <= 34.0
	    && altitudeKm > 0.02
    && catchTotalRangeKm <= 58
    && catchLateralRangeKm <= 32
    && Math.abs(catchVerticalErrorKm) <= 34
    && catchApproachSpeedKmS <= 2.55
    && bodyUpAlignment >= (landingBurnCommitted ? 0.50 : 0.88)
    && propellantKg > (reserveLandingKg * 0.02)
  );
  if (sustainedTowerLandingBurn) {
    const landingBurnIntercept = resolveTerminalInterceptMetrics({
      altitudeKm,
      catchTotalRangeKm,
      catchLateralRangeKm,
      catchVerticalErrorKm,
      catchApproachSpeedKmS,
      catchEastErrorKm,
      catchNorthErrorKm,
      catchEastSpeedKmS,
      catchNorthSpeedKmS,
      catchVerticalSpeedKmS,
      towerRelativeActive,
    });
    return buildSustainedTowerLandingBurnCommand({
      altitudeKm,
      catchLateralRangeKm,
      catchLateralSpeedKmS,
      catchVerticalErrorKm,
      catchVerticalSpeedKmS,
      catchApproachSpeedKmS,
      gridFinAuthority,
      terminalUprightCommitNorm,
      terminalIntercept: landingBurnIntercept,
    });
  }

  const sustainingTerminalIntercept =
    currentPhase === "terminal-intercept"
    || (
      committedTowerCatch
      && altitudeKm <= lateTerminalInterceptAltitudeKm
    );
  const terminalInterceptWindow =
    altitudeKm > 0.8
    && altitudeKm <= lateTerminalInterceptAltitudeKm
    && catchTotalRangeKm <= (sustainingTerminalIntercept ? 96.0 : 90.0)
    && catchLateralRangeKm <= (sustainingTerminalIntercept ? 92.0 : 88.0)
    && Math.abs(catchVerticalErrorKm) <= (sustainingTerminalIntercept ? 74.0 : 68.0)
    && propellantKg > (reserveLandingKg * 0.05)
    && !sustainCatchCorridor;
  if (terminalInterceptWindow) {
    const terminalIntercept = resolveTerminalInterceptMetrics({
      altitudeKm,
      catchTotalRangeKm,
      catchLateralRangeKm,
      catchVerticalErrorKm,
      catchApproachSpeedKmS,
      catchEastErrorKm,
      catchNorthErrorKm,
      catchEastSpeedKmS,
      catchNorthSpeedKmS,
      catchVerticalSpeedKmS,
      towerRelativeActive,
    });
    return buildUnpoweredTowerTerminalInterceptCommand({
      altitudeKm,
      catchLateralRangeKm,
      catchLateralSpeedKmS,
      catchVerticalErrorKm,
      gridFinAuthority,
      terminalUprightCommitNorm,
      terminalIntercept,
      towerRelativeActive,
    });
  }
  if (
    altitudeKm > landingBurnTriggerAltitudeKm
    && currentPhase !== "terminal-intercept"
    && !(
      landingBurnCommitted
      && altitudeKm <= (landingBurnTriggerAltitudeKm + 2.4)
    )
  ) {
    const towerRelativeAeroInterceptNorm = towerRelativeActive
      ? clamp(
        Math.max(
          (18 - altitudeKm) / 10,
          (20 - catchLateralRangeKm) / 18,
        ),
        0,
        1,
      )
      : 0;
    const towerRelativeAeroCatchMetrics =
      towerRelativeActive && catchTotalRangeKm <= 20
        ? resolveTerminalInterceptMetrics({
          altitudeKm,
          catchTotalRangeKm,
          catchLateralRangeKm,
          catchVerticalErrorKm,
          catchApproachSpeedKmS,
          catchEastErrorKm,
          catchNorthErrorKm,
          catchEastSpeedKmS,
          catchNorthSpeedKmS,
          catchVerticalSpeedKmS,
          towerRelativeActive,
        })
        : null;
    return {
      phase: "descent-coast",
      guidanceMode: "booster-descent-coast",
      attitudeControlMode: "grid-fins+rcs",
      aeroAuthority: gridFinAuthority,
      terminalUprightCommit: true,
      uprightTiltLimitDeg: clamp(
        (towerRelativeActive ? 10 : (strictTerminalUprightWindow ? 6 : 8))
          + (0.36 * Math.min(catchLateralRangeKm, 18))
          + (altitudeKm > 10 ? 1.5 : 0),
        towerRelativeActive ? 10 : (strictTerminalUprightWindow ? 6 : 8),
        towerRelativeActive ? 20 : 16,
      ),
      attitudeResponseScale: 1.24 + (0.40 * terminalUprightCommitNorm),
      attitudeTargetBlend: 0.90 + (0.06 * terminalUprightCommitNorm),
      angularDampingPerS: 0.92 + (0.12 * terminalUprightCommitNorm),
      maxBodyRateDegS: 10.5,
      throttle: 0,
      directionMix: {
        up: 0.98,
        retrograde: 0.08,
        antiTangent: clamp(
          0.03
            + (0.06 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm)
            + (0.05 * towerRelativeAeroInterceptNorm),
          0.04,
          0.16,
        ),
      },
      siteTargetingEnabled: towerRelativeAeroCatchMetrics
        ? false
        : aeroCrossrangeDemand.targetingActive,
      siteVectorWeight: clamp(
        0.22
          + (0.62 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
        0.18,
        0.82 + (0.12 * towerRelativeAeroInterceptNorm),
      ),
      siteVelocityWeight: clamp(
        0.14
          + (0.46 * aeroCrossrangeDemand.closingNeedNorm * aeroCrossrangeDemand.aeroCorrectionNorm),
        0.12,
        0.62 + (0.12 * towerRelativeAeroInterceptNorm),
      ),
      padInterceptBlend: clamp(
        0.18
          + (0.26 * aeroCrossrangeDemand.crossrangeDemandNorm * aeroCrossrangeDemand.aeroCorrectionNorm)
          + (0.18 * towerRelativeAeroInterceptNorm),
        0.18,
        0.60,
      ),
      padInterceptLateralWeight: clamp(
        0.22
          + (0.44 * aeroCrossrangeDemand.crossrangeDemandNorm)
          + (0.22 * towerRelativeAeroInterceptNorm),
        0.22,
        0.84,
      ),
      padDesiredLateralClosingSpeedKmS: clamp(
        towerRelativeAeroCatchMetrics
          ? Math.max(
            0.08,
            Math.hypot(
              towerRelativeAeroCatchMetrics.desiredEastSpeedKmS,
              towerRelativeAeroCatchMetrics.desiredNorthSpeedKmS,
            ) * 0.88,
          )
          : (
            desiredLateralClosingKmS
              * (
                1.28
                + (0.30 * aeroCrossrangeDemand.crossrangeDemandNorm)
                + (0.26 * towerRelativeAeroInterceptNorm)
              )
          ),
        0.08,
        towerRelativeAeroCatchMetrics ? 0.46 : 1.02,
      ),
      maxSiteSteeringAngleDeg: clamp(26 + (14 * towerRelativeAeroInterceptNorm), 26, 40),
      predictiveCatchControl: towerRelativeAeroCatchMetrics
        ? {
          enabled: true,
          blend: clamp(
            0.52
              + (0.18 * towerRelativeAeroCatchMetrics.lateralDemandNorm)
              + (0.10 * towerRelativeAeroCatchMetrics.predictiveLateralMissNorm),
            0.52,
            0.88,
          ),
          retrogradeBias: clamp(
            0.08 + (0.06 * towerRelativeAeroCatchMetrics.lateralDemandNorm),
            0.08,
            0.24,
          ),
          translationAuthority: clamp(
            0.28 + (0.26 * towerRelativeAeroCatchMetrics.lateralDemandNorm),
            0.28,
            0.60,
          ),
          interceptTimeSec: towerRelativeAeroCatchMetrics.interceptTimeSec,
          localDirection: {
            ...towerRelativeAeroCatchMetrics.localDirection,
            up: clamp(
              Number(towerRelativeAeroCatchMetrics.localDirection?.up),
              0.02,
              0.32,
            ),
          },
          desiredEastSpeedKmS: towerRelativeAeroCatchMetrics.desiredEastSpeedKmS,
          desiredNorthSpeedKmS: towerRelativeAeroCatchMetrics.desiredNorthSpeedKmS,
          desiredVerticalSpeedKmS: towerRelativeAeroCatchMetrics.desiredVerticalSpeedKmS,
          predictedEastMissKm: towerRelativeAeroCatchMetrics.predictedEastMissKm,
          predictedNorthMissKm: towerRelativeAeroCatchMetrics.predictedNorthMissKm,
          predictedVerticalMissKm: towerRelativeAeroCatchMetrics.predictedVerticalMissKm,
          predictedLateralMissKm: towerRelativeAeroCatchMetrics.predictedLateralMissKm,
          predictedTotalMissKm: towerRelativeAeroCatchMetrics.predictedTotalMissKm,
        }
        : null,
    };
  }

  if (committedTowerCatch && altitudeKm <= lateTerminalInterceptAltitudeKm) {
    const terminalIntercept = resolveTerminalInterceptMetrics({
      altitudeKm,
      catchTotalRangeKm,
      catchLateralRangeKm,
      catchVerticalErrorKm,
      catchApproachSpeedKmS,
      catchEastErrorKm,
      catchNorthErrorKm,
      catchEastSpeedKmS,
      catchNorthSpeedKmS,
      catchVerticalSpeedKmS,
      towerRelativeActive,
    });
    return buildUnpoweredTowerTerminalInterceptCommand({
      altitudeKm,
      catchLateralRangeKm,
      catchLateralSpeedKmS,
      catchVerticalErrorKm,
      gridFinAuthority,
      terminalUprightCommitNorm,
      terminalIntercept,
      towerRelativeActive,
    });
  }

  const towerCatchFinalBurnCorridor =
    towerCatchReturnProfileActive
    && towerRelativeActive
    && catchTotalRangeKm <= 6.0
    && catchLateralRangeKm <= 5.0
    && Math.abs(catchVerticalErrorKm) <= 3.2
    && catchApproachSpeedKmS <= 0.90
    && catchLateralSpeedKmS <= 0.38
    && propellantKg > (reserveLandingKg * 0.02);
  if (towerCatchReturnProfileActive && !towerCatchFinalBurnCorridor) {
    const terminalIntercept = resolveTerminalInterceptMetrics({
      altitudeKm,
      catchTotalRangeKm,
      catchLateralRangeKm,
      catchVerticalErrorKm,
      catchApproachSpeedKmS,
      catchEastErrorKm,
      catchNorthErrorKm,
      catchEastSpeedKmS,
      catchNorthSpeedKmS,
      catchVerticalSpeedKmS,
      towerRelativeActive,
    });
    return buildUnpoweredTowerTerminalInterceptCommand({
      altitudeKm,
      catchLateralRangeKm,
      catchLateralSpeedKmS,
      catchVerticalErrorKm,
      gridFinAuthority,
      terminalUprightCommitNorm,
      terminalIntercept,
      towerRelativeActive,
    });
  }

  // Simple terminal guidance profile: reduce target descent as altitude decreases.
  const targetDescentRateKmS = clamp(
    0.002 + (altitudeKm * 0.0105),
    0.004,
    0.09,
  );
  const targetRadialSpeedKmS = -targetDescentRateKmS;
  const radialErrorKmS = targetRadialSpeedKmS - radialSpeedKmS;
  let throttle = clamp(
    0.28 + (radialErrorKmS * 4.6) + (tangentialSpeedKmS * 0.24) + (lateralClosingNeedNorm * 0.10),
    0.32,
    1.0,
  );
  if (altitudeKm < 2.0 && radialSpeedKmS < -0.04) {
    const flareScale = clamp((-radialSpeedKmS - 0.04) / 0.12, 0, 1);
    throttle = Math.max(throttle, clamp(0.52 + (0.32 * flareScale), 0.52, 0.92));
  }
  const terminalRangeNorm = clamp(
    Math.min(launchSiteLateralRangeKm, launchSiteRangeKm) / landingSiteTightenKm,
    0,
    1,
  );
  return {
    phase: "landing-burn",
    guidanceMode: "booster-landing-burn",
    attitudeControlMode: "engines+rcs",
    qAlphaSteeringEnabled: false,
    aeroAuthority: clamp(gridFinAuthority * 0.25, 0, 0.2),
    terminalUprightCommit: true,
    uprightTiltLimitDeg: 3.5,
    attitudeResponseScale: 1.48 + (0.40 * terminalUprightCommitNorm),
    attitudeTargetBlend: 0.90 + (0.06 * terminalUprightCommitNorm),
    angularDampingPerS: 1.02 + (0.18 * terminalUprightCommitNorm),
    maxBodyRateDegS: 6.2,
    throttle,
    directionMix: { up: 1.0, retrograde: 0.05, antiTangent: 0.02 },
    siteVectorWeight: clamp(
      0.10 + (0.26 * terminalRangeNorm),
      0.06,
      0.36,
    ),
    siteVelocityWeight: clamp(
      0.08 + (0.20 * terminalRangeNorm),
      0.05,
      0.30,
    ),
    padInterceptBlend: clamp(
      0.12 + (0.16 * terminalRangeNorm),
      0.12,
      0.28,
    ),
    padInterceptLateralWeight: clamp(
      0.16 + (0.24 * terminalRangeNorm),
      0.16,
      0.34,
    ),
    padDesiredLateralClosingSpeedKmS: clamp(
      desiredLateralClosingKmS * (1.06 + (0.18 * terminalRangeNorm)),
      0.08,
      0.48,
    ),
    maxSiteSteeringAngleDeg: 14,
    touchdownReady: altitudeKm <= touchdownBandKm && Math.abs(radialSpeedKmS) < 0.03,
  };
}
