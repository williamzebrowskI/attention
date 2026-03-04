import {
  add,
  clamp,
  normalize,
  scale,
} from "../navigationMath.js";

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback);
}

export function planTliFiniteBurnCommand({
  targetVectors = {},
  metrics = {},
  plannerConfig = {},
  missionElapsedInPhaseSec = 0,
  tliRuntime = null,
  timestampSec = Number.NaN,
} = {}) {
  const tangent = normalize(targetVectors.tangent, { x: 0, y: 1, z: 0 });
  const up = normalize(targetVectors.up, { x: 0, y: 0, z: 1 });
  const moonDirection = normalize(targetVectors.toMoon, tangent);

  const periapsisKm = finite(metrics.periapsisKm, Number.NaN);
  const periapsisProtectMinKm = Math.max(80, finite(plannerConfig.tliPeriapsisProtectMinKm, 130));
  const periapsisRecoverTargetKm = Math.max(
    periapsisProtectMinKm + 5,
    finite(plannerConfig.tliPeriapsisRecoverTargetKm, 155),
  );
  const periapsisDeadbandLowKm = Math.max(
    periapsisProtectMinKm + 1,
    finite(plannerConfig.tliPeriapsisDeadbandLowKm, 150),
  );
  const periapsisDeadbandHighKm = Math.max(
    periapsisDeadbandLowKm + 2,
    finite(plannerConfig.tliPeriapsisDeadbandHighKm, 170),
  );
  const periapsisEmergencyKm = Math.max(
    periapsisProtectMinKm - 10,
    finite(plannerConfig.tliPeriapsisEmergencyKm, periapsisProtectMinKm),
  );
  const periapsisWindowSec = Math.max(
    30,
    finite(plannerConfig.tliPeriapsisBurnWindowSec, 260),
  );
  const periapsisPulsePeriodSec = Math.max(
    6,
    finite(plannerConfig.tliPeriapsisPulsePeriodSec, 22),
  );
  const periapsisPulseOnSec = clamp(
    finite(plannerConfig.tliPeriapsisPulseOnSec, 7),
    1.5,
    Math.max(2.5, periapsisPulsePeriodSec - 1),
  );
  const missionElapsedSec = Math.max(0, finite(missionElapsedInPhaseSec, 0));
  const nowSec = Number(timestampSec);
  const prevSec = Number(tliRuntime?.lastTimestampSec);
  const dtSec = Number.isFinite(nowSec) && Number.isFinite(prevSec)
    ? Math.max(0, nowSec - prevSec)
    : 0;
  if (tliRuntime && typeof tliRuntime === "object") {
    tliRuntime.lastTimestampSec = Number.isFinite(nowSec) ? nowSec : tliRuntime.lastTimestampSec;
    tliRuntime.modeHoldSec = Math.max(0, finite(tliRuntime.modeHoldSec, 0) + dtSec);
    tliRuntime.protectCooldownSec = Math.max(0, finite(tliRuntime.protectCooldownSec, 0) - dtSec);
  }

  const missDistanceKm = finite(metrics.moonProjectedMissDistanceKm, Number.POSITIVE_INFINITY);
  const missGateKm = Math.max(50_000, finite(plannerConfig.moonMidcourseMissDistanceKm, 95_000));
  const missRisk = Number.isFinite(missDistanceKm)
    ? clamp((missDistanceKm - (missGateKm * 0.75)) / Math.max(1, missGateKm * 1.1), 0, 1)
    : 0.5;
  const missTrendKmS = finite(metrics.moonProjectedMissTrendKmS, 0);
  const missWorseningRisk = clamp(missTrendKmS / 250, 0, 1);

  const protectEnterKm = periapsisRecoverTargetKm;
  const protectExitKm = periapsisRecoverTargetKm + 8;
  const protectHoldMinSec = Math.max(6, finite(plannerConfig.tliProtectModeHoldMinSec, 14));
  const protectCooldownSec = Math.max(4, finite(plannerConfig.tliProtectCooldownSec, 10));
  const interceptEnterRisk = clamp(finite(plannerConfig.tliInterceptEnterRisk, 0.28), 0.05, 1);
  const interceptExitRisk = clamp(finite(plannerConfig.tliInterceptExitRisk, 0.12), 0.02, 0.95);
  const interceptHoldMinSec = Math.max(4, finite(plannerConfig.tliInterceptModeHoldMinSec, 10));
  const interceptWarmupSec = Math.max(0, finite(plannerConfig.tliInterceptWarmupSec, 140));
  const interceptWarmupActive = (
    missionElapsedSec < interceptWarmupSec
    && Number.isFinite(periapsisKm)
    && periapsisKm < (periapsisDeadbandHighKm + 12)
  );

  const rawProtect = Number.isFinite(periapsisKm) && periapsisKm < protectEnterKm;
  const rawProtectStay = Number.isFinite(periapsisKm) && periapsisKm < protectExitKm;
  const rawProtectBand = Number.isFinite(periapsisKm) && periapsisKm < periapsisDeadbandLowKm;
  const rawProtectBandStay = Number.isFinite(periapsisKm) && periapsisKm < periapsisDeadbandHighKm;
  const emergencyProtect = Number.isFinite(periapsisKm) && periapsisKm <= periapsisEmergencyKm;
  const timeToPeriapsisSec = finite(metrics.timeToPeriapsisSec, Number.NaN);
  const timeToApoapsisSec = finite(metrics.timeToApoapsisSec, Number.NaN);
  const nearPeriapsisWindow = Number.isFinite(timeToPeriapsisSec)
    ? Math.abs(timeToPeriapsisSec) <= periapsisWindowSec
    : (
      Number.isFinite(timeToApoapsisSec)
        ? Math.abs(timeToApoapsisSec) >= Math.max(0, (finite(metrics.orbitalPeriodSec, Number.NaN) * 0.5) - periapsisWindowSec)
        : false
    );
  const protectBurnWindowAllowed = emergencyProtect || nearPeriapsisWindow;
  const pulsePhaseSec = periapsisPulsePeriodSec > 1e-6
    ? ((missionElapsedSec % periapsisPulsePeriodSec) + periapsisPulsePeriodSec) % periapsisPulsePeriodSec
    : 0;
  const protectPulseActive = pulsePhaseSec <= periapsisPulseOnSec;
  const rawIntercept = !interceptWarmupActive && (missWorseningRisk >= interceptEnterRisk);
  const rawInterceptStay = !interceptWarmupActive && (missWorseningRisk >= interceptExitRisk);
  let appliedMode = "targeted";

  if (tliRuntime && typeof tliRuntime === "object") {
    const currentMode = String(tliRuntime.mode || "");
    const modeHoldSec = Math.max(0, finite(tliRuntime.modeHoldSec, 0));
    const cooldownSec = Math.max(0, finite(tliRuntime.protectCooldownSec, 0));
    if (currentMode === "periapsis-protect") {
      if ((rawProtectBandStay || rawProtectStay || emergencyProtect) || modeHoldSec < protectHoldMinSec) {
        appliedMode = "periapsis-protect";
      } else if (rawIntercept && cooldownSec <= 1e-6) {
        appliedMode = "intercept-correct";
      } else {
        appliedMode = "targeted";
      }
    } else if (currentMode === "intercept-correct") {
      if (rawProtectBand || rawProtect || emergencyProtect) {
        appliedMode = "periapsis-protect";
      } else if (rawInterceptStay || modeHoldSec < interceptHoldMinSec) {
        appliedMode = "intercept-correct";
      } else {
        appliedMode = "targeted";
      }
    } else {
      if (rawProtectBand || rawProtect || emergencyProtect) {
        appliedMode = "periapsis-protect";
      } else if (rawIntercept && cooldownSec <= 1e-6) {
        appliedMode = "intercept-correct";
      }
    }
    if (appliedMode !== currentMode) {
      if (currentMode === "periapsis-protect" && appliedMode !== "periapsis-protect") {
        tliRuntime.protectCooldownSec = protectCooldownSec;
      }
      tliRuntime.mode = appliedMode;
      tliRuntime.modeHoldSec = 0;
    } else {
      tliRuntime.mode = appliedMode;
    }
  } else {
    appliedMode = (rawProtectBand || rawProtect || emergencyProtect)
      ? "periapsis-protect"
      : (rawIntercept ? "intercept-correct" : "targeted");
  }

  if (appliedMode === "periapsis-protect") {
    if ((!protectBurnWindowAllowed || !protectPulseActive) && !emergencyProtect) {
      const fallbackInterceptActive = missWorseningRisk >= interceptExitRisk;
      const fallbackMode = fallbackInterceptActive
        ? "navsys:tli-periapsis-window-fallback-intercept"
        : "navsys:tli-periapsis-window-fallback-targeted";
      const fallbackMoonBlend = clamp(
        0.56 + (missRisk * 0.18) + (missWorseningRisk * 0.16),
        0.45,
        0.86,
      );
      const fallbackThrottle = clamp(
        0.24 + (missRisk * 0.11) + (missWorseningRisk * 0.12),
        0.22,
        0.48,
      );
      const fallbackDirection = normalize(
        add(
          scale(tangent, Math.max(0.08, 1 - fallbackMoonBlend)),
          add(
            scale(moonDirection, fallbackMoonBlend),
            scale(up, 0.04),
          ),
        ),
        tangent,
      );
      return {
        phase: "powered",
        throttle: fallbackThrottle,
        direction: fallbackDirection,
        mode: fallbackMode,
        diagnostics: {
          requestedMode: fallbackInterceptActive
            ? "periapsis-window-fallback-intercept"
            : "periapsis-window-fallback-targeted",
          appliedMode,
          periapsisKm,
          periapsisProtectMinKm,
          periapsisRecoverTargetKm,
          periapsisDeadbandLowKm,
          periapsisDeadbandHighKm,
          periapsisEmergencyKm,
          protectEnterKm,
          protectExitKm,
          protectBurnWindowAllowed,
          nearPeriapsisWindow,
          protectPulseActive,
          pulsePhaseSec,
          periapsisWindowSec,
          periapsisPulseOnSec,
          periapsisPulsePeriodSec,
          missDistanceKm: Number.isFinite(missDistanceKm) ? missDistanceKm : null,
          missGateKm,
          missTrendKmS,
          missWorseningRisk,
          interceptWarmupActive,
          interceptWarmupSec,
          fallbackMoonBlend,
          fallbackThrottle,
          timeToPeriapsisSec: Number.isFinite(timeToPeriapsisSec) ? timeToPeriapsisSec : null,
          elapsedSec: missionElapsedSec,
        },
      };
    }
    const safePeriapsisKm = Number.isFinite(periapsisKm)
      ? periapsisKm
      : periapsisProtectMinKm;
    const deficitNorm = clamp(
      (periapsisRecoverTargetKm - safePeriapsisKm)
        / Math.max(1, periapsisRecoverTargetKm - periapsisProtectMinKm),
      0,
      1,
    );
    const upBias = clamp(
      finite(plannerConfig.tliPeriapsisProtectUpBias, 0.24) * (0.65 + (0.35 * deficitNorm)),
      0.1,
      0.45,
    );
    const throttle = clamp(
      finite(plannerConfig.tliPeriapsisProtectThrottleMin, 0.16) + (deficitNorm * 0.26),
      finite(plannerConfig.tliPeriapsisProtectThrottleMin, 0.16),
      finite(plannerConfig.tliPeriapsisProtectThrottleMax, 0.6),
    );
    return {
      phase: "powered",
      throttle,
      direction: normalize(add(scale(tangent, 1), scale(up, upBias)), tangent),
      mode: "navsys:tli-periapsis-protect",
      diagnostics: {
        requestedMode: "periapsis-protect",
        appliedMode,
        periapsisKm,
        periapsisProtectMinKm,
        periapsisRecoverTargetKm,
        periapsisDeadbandLowKm,
        periapsisDeadbandHighKm,
        periapsisEmergencyKm,
        protectEnterKm,
        protectExitKm,
        protectBurnWindowAllowed,
        nearPeriapsisWindow,
        protectPulseActive,
        pulsePhaseSec,
        periapsisWindowSec,
        periapsisPulseOnSec,
        periapsisPulsePeriodSec,
        timeToPeriapsisSec: Number.isFinite(timeToPeriapsisSec) ? timeToPeriapsisSec : null,
        elapsedSec: missionElapsedSec,
      },
    };
  }

  const minClosingKmS = Math.max(0.001, finite(plannerConfig.moonMidcourseMinClosingSpeedKmS, 0.02));
  const closingWindowKmS = Math.max(0.03, finite(plannerConfig.moonMidcourseClosingWindowKmS, 0.18));
  const moonClosingSpeedKmS = finite(metrics.moonClosingSpeedKmS, minClosingKmS);
  const closingDeficit = clamp((minClosingKmS - moonClosingSpeedKmS) / closingWindowKmS, 0, 1);

  const bPlaneErrorKm = finite(metrics.moonBPlaneErrorKm, Number.NaN);
  const bPlaneToleranceKm = Math.max(500, finite(plannerConfig.moonBPlaneToleranceKm, 6_000));
  const bPlaneRisk = Number.isFinite(bPlaneErrorKm)
    ? clamp((bPlaneErrorKm - bPlaneToleranceKm) / Math.max(1, bPlaneToleranceKm * 4), 0, 1)
    : 0;

  const periluneEstimateKm = finite(metrics.moonProjectedPeriluneAltitudeKm, Number.NaN);
  const targetPeriluneKm = Math.max(20, finite(plannerConfig.moonTargetPeriluneAltitudeKm, 120));
  const periluneToleranceKm = Math.max(10, finite(plannerConfig.moonTargetPeriluneToleranceKm, 80));
  const periluneRisk = Number.isFinite(periluneEstimateKm)
    ? clamp(
      Math.abs(periluneEstimateKm - targetPeriluneKm) / Math.max(1, periluneToleranceKm * 7),
      0,
      1,
    )
    : 0;

  const earlyPhase = missionElapsedSec < 120;
  const throttleFloor = earlyPhase ? 0.55 : 0.34;
  const throttle = clamp(
    0.48
      + (closingDeficit * 0.18)
      + (missRisk * 0.04)
      + (bPlaneRisk * 0.06)
      + (periluneRisk * 0.05)
      - (missWorseningRisk * 0.16),
    throttleFloor,
    0.8,
  );

  const moonBlend = clamp(
    0.42
      + (missRisk * 0.26)
      + (bPlaneRisk * 0.1)
      + (periluneRisk * 0.08)
      + (missWorseningRisk * 0.12),
    0.35,
    0.82,
  );
  const tangentialBlend = Math.max(0.12, 1 - moonBlend);
  const retroTrim = clamp(missWorseningRisk * 0.18, 0, 0.12);
  const upBias = clamp(0.04 + (periluneRisk * 0.08), 0.02, 0.18);
  const direction = normalize(
    add(
      scale(tangent, tangentialBlend - retroTrim),
      add(
        scale(moonDirection, moonBlend),
        scale(up, upBias),
      ),
    ),
    tangent,
  );

  return {
    phase: "powered",
    throttle,
    direction,
    mode: appliedMode === "intercept-correct"
      ? "navsys:tli-finite-burn-targeted+intercept-correct"
      : "navsys:tli-finite-burn-targeted",
    diagnostics: {
      requestedMode: "tli-finite-burn-targeted",
      appliedMode,
      missDistanceKm: Number.isFinite(missDistanceKm) ? missDistanceKm : null,
      missGateKm,
      missTrendKmS,
      missWorseningRisk,
      interceptEnterRisk,
      interceptExitRisk,
      interceptWarmupActive,
      interceptWarmupSec,
      periapsisDeadbandLowKm,
      periapsisDeadbandHighKm,
      periapsisEmergencyKm,
      protectBurnWindowAllowed,
      nearPeriapsisWindow,
      bPlaneErrorKm: Number.isFinite(bPlaneErrorKm) ? bPlaneErrorKm : null,
      bPlaneToleranceKm,
      periluneEstimateKm: Number.isFinite(periluneEstimateKm) ? periluneEstimateKm : null,
      targetPeriluneKm,
      moonBlend,
      throttle,
      modeHoldSec: Number.isFinite(Number(tliRuntime?.modeHoldSec))
        ? Number(tliRuntime.modeHoldSec)
        : null,
      elapsedSec: missionElapsedSec,
    },
  };
}
