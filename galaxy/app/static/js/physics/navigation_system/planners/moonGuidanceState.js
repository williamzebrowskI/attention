import {
  add,
  clamp,
  finiteVector,
  normalize,
  scale,
} from "../navigationMath.js";
import {
  NAVIGATION_MISSION_IDS,
  NAVIGATION_MISSION_PHASES,
} from "../navigationMissionProfiles.js";

export function createMoonGuidanceRuntime() {
  return {
    sensorEstimate: null,
    tli: {
      mode: "",
      modeHoldSec: 0,
      lastTimestampSec: null,
      protectCooldownSec: 0,
    },
    midcourse: {
      active: false,
      burnSec: 0,
      stableSec: 0,
      cooldownSec: 0,
      lastStartSec: null,
      lastStopSec: null,
    },
    retarget: {
      lastSolveSec: null,
      lastSolveReason: "",
    },
    approach: {
      projectedPeriluneAltitudeKm: null,
      corridorErrorKm: null,
      bPlaneErrorKm: null,
      timeToClosestSec: null,
      lastDecision: "",
    },
    lastTimestampSec: null,
  };
}

export function createPlannerRuntime() {
  return {
    missionId: "",
    missionPhase: "",
    moon: createMoonGuidanceRuntime(),
  };
}

export function normalizePlannerRuntimeSnapshot(nextSnapshot = null) {
  const normalized = createPlannerRuntime();
  if (!nextSnapshot || typeof nextSnapshot !== "object") {
    return normalized;
  }
  normalized.missionId = String(nextSnapshot.missionId || "");
  normalized.missionPhase = String(nextSnapshot.missionPhase || "");
  const moonSnapshot = nextSnapshot.moon;
  if (moonSnapshot && typeof moonSnapshot === "object") {
    const sensor = moonSnapshot.sensorEstimate;
    if (
      sensor
      && Number.isFinite(Number(sensor.distanceKm))
      && Number.isFinite(Number(sensor.closingSpeedKmS))
      && Number.isFinite(Number(sensor.projectedMissDistanceKm))
      && finiteVector(sensor.direction)
    ) {
      normalized.moon.sensorEstimate = {
        distanceKm: Number(sensor.distanceKm),
        closingSpeedKmS: Number(sensor.closingSpeedKmS),
        projectedMissDistanceKm: Number(sensor.projectedMissDistanceKm),
        direction: normalize(sensor.direction, { x: 0, y: 1, z: 0 }),
      };
    }
    const midcourse = moonSnapshot.midcourse;
    if (midcourse && typeof midcourse === "object") {
      normalized.moon.midcourse = {
        active: Boolean(midcourse.active),
        burnSec: Math.max(0, Number(midcourse.burnSec) || 0),
        stableSec: Math.max(0, Number(midcourse.stableSec) || 0),
        cooldownSec: Math.max(0, Number(midcourse.cooldownSec) || 0),
        lastStartSec: Number.isFinite(Number(midcourse.lastStartSec))
          ? Number(midcourse.lastStartSec)
          : null,
        lastStopSec: Number.isFinite(Number(midcourse.lastStopSec))
          ? Number(midcourse.lastStopSec)
          : null,
      };
    }
    const tli = moonSnapshot.tli;
    if (tli && typeof tli === "object") {
      normalized.moon.tli = {
        mode: String(tli.mode || ""),
        modeHoldSec: Math.max(0, Number(tli.modeHoldSec) || 0),
        lastTimestampSec: Number.isFinite(Number(tli.lastTimestampSec))
          ? Number(tli.lastTimestampSec)
          : null,
        protectCooldownSec: Math.max(0, Number(tli.protectCooldownSec) || 0),
      };
    }
    const retarget = moonSnapshot.retarget;
    if (retarget && typeof retarget === "object") {
      normalized.moon.retarget = {
        lastSolveSec: Number.isFinite(Number(retarget.lastSolveSec))
          ? Number(retarget.lastSolveSec)
          : null,
        lastSolveReason: String(retarget.lastSolveReason || ""),
      };
    }
    const approach = moonSnapshot.approach;
    if (approach && typeof approach === "object") {
      normalized.moon.approach = {
        projectedPeriluneAltitudeKm: Number.isFinite(Number(approach.projectedPeriluneAltitudeKm))
          ? Number(approach.projectedPeriluneAltitudeKm)
          : null,
        corridorErrorKm: Number.isFinite(Number(approach.corridorErrorKm))
          ? Number(approach.corridorErrorKm)
          : null,
        bPlaneErrorKm: Number.isFinite(Number(approach.bPlaneErrorKm))
          ? Number(approach.bPlaneErrorKm)
          : null,
        timeToClosestSec: Number.isFinite(Number(approach.timeToClosestSec))
          ? Number(approach.timeToClosestSec)
          : null,
        lastDecision: String(approach.lastDecision || ""),
      };
    }
    const lastTs = Number(moonSnapshot.lastTimestampSec);
    normalized.moon.lastTimestampSec = Number.isFinite(lastTs) ? lastTs : null;
  }
  return normalized;
}

function resetMoonGuidanceRuntime(moonRuntime, { clearEstimate = false } = {}) {
  if (!moonRuntime || typeof moonRuntime !== "object") {
    return;
  }
  moonRuntime.midcourse = {
    active: false,
    burnSec: 0,
    stableSec: 0,
    cooldownSec: 0,
    lastStartSec: null,
    lastStopSec: null,
  };
  moonRuntime.tli = {
    mode: "",
    modeHoldSec: 0,
    lastTimestampSec: null,
    protectCooldownSec: 0,
  };
  moonRuntime.retarget = {
    lastSolveSec: null,
    lastSolveReason: "",
  };
  moonRuntime.approach = {
    projectedPeriluneAltitudeKm: null,
    corridorErrorKm: null,
    bPlaneErrorKm: null,
    timeToClosestSec: null,
    lastDecision: "",
  };
  if (clearEstimate) {
    moonRuntime.sensorEstimate = null;
  }
}

export function syncPlannerRuntime({
  plannerRuntime,
  missionId,
  missionPhase,
} = {}) {
  if (!plannerRuntime || typeof plannerRuntime !== "object") {
    return;
  }
  const nextMissionId = String(missionId || NAVIGATION_MISSION_IDS.EARTH_ORBIT_HOLD);
  const nextMissionPhase = String(missionPhase || "").trim();
  const missionChanged = plannerRuntime.missionId !== nextMissionId;
  const phaseChanged = plannerRuntime.missionPhase !== nextMissionPhase;
  if (missionChanged) {
    plannerRuntime.moon = createMoonGuidanceRuntime();
  } else if (phaseChanged) {
    if (nextMissionPhase !== NAVIGATION_MISSION_PHASES.COAST_TO_MOON) {
      resetMoonGuidanceRuntime(plannerRuntime.moon, { clearEstimate: false });
    }
    if (nextMissionPhase === NAVIGATION_MISSION_PHASES.TLI_BURN) {
      resetMoonGuidanceRuntime(plannerRuntime.moon, { clearEstimate: true });
    }
    if (nextMissionPhase !== NAVIGATION_MISSION_PHASES.TLI_BURN) {
      plannerRuntime.moon.tli = {
        mode: "",
        modeHoldSec: 0,
        lastTimestampSec: null,
        protectCooldownSec: 0,
      };
    }
  }
  plannerRuntime.missionId = nextMissionId;
  plannerRuntime.missionPhase = nextMissionPhase;
}

export function updateMoonSensorEstimate({
  moonRuntime,
  rawMeasurement,
  timestampSec,
  plannerConfig,
} = {}) {
  if (!moonRuntime || !rawMeasurement || !Number.isFinite(Number(rawMeasurement.distanceKm))) {
    return null;
  }
  const rawDirection = finiteVector(rawMeasurement.direction)
    ? normalize(rawMeasurement.direction, { x: 0, y: 1, z: 0 })
    : null;
  if (!rawDirection || !Number.isFinite(Number(rawMeasurement.closingSpeedKmS))) {
    return null;
  }
  const raw = {
    distanceKm: Number(rawMeasurement.distanceKm),
    closingSpeedKmS: Number(rawMeasurement.closingSpeedKmS),
    projectedMissDistanceKm: Number.isFinite(Number(rawMeasurement.projectedMissDistanceKm))
      ? Number(rawMeasurement.projectedMissDistanceKm)
      : Number(rawMeasurement.distanceKm),
    direction: rawDirection,
  };
  const nowSec = Number(timestampSec);
  const prevSec = Number(moonRuntime.lastTimestampSec);
  const dtSec = Number.isFinite(nowSec) && Number.isFinite(prevSec)
    ? Math.max(0, nowSec - prevSec)
    : 0;
  moonRuntime.lastTimestampSec = Number.isFinite(nowSec) ? nowSec : moonRuntime.lastTimestampSec;
  if (!moonRuntime.sensorEstimate) {
    moonRuntime.sensorEstimate = {
      distanceKm: raw.distanceKm,
      closingSpeedKmS: raw.closingSpeedKmS,
      projectedMissDistanceKm: raw.projectedMissDistanceKm,
      direction: raw.direction,
    };
    return moonRuntime.sensorEstimate;
  }
  const tauSec = Math.max(1, Number(plannerConfig?.sensorTimeConstantSec) || 24);
  const alpha = clamp(dtSec / (tauSec + dtSec), 0.04, 0.82);
  const previous = moonRuntime.sensorEstimate;
  const previousDirection = finiteVector(previous.direction)
    ? normalize(previous.direction, raw.direction)
    : raw.direction;
  moonRuntime.sensorEstimate = {
    distanceKm: Number(previous.distanceKm) + ((raw.distanceKm - Number(previous.distanceKm)) * alpha),
    closingSpeedKmS: Number(previous.closingSpeedKmS) + ((raw.closingSpeedKmS - Number(previous.closingSpeedKmS)) * alpha),
    projectedMissDistanceKm:
      Number(previous.projectedMissDistanceKm)
      + ((raw.projectedMissDistanceKm - Number(previous.projectedMissDistanceKm)) * alpha),
    direction: normalize(
      add(
        scale(previousDirection, 1 - alpha),
        scale(raw.direction, alpha),
      ),
      raw.direction,
    ),
  };
  return moonRuntime.sensorEstimate;
}
