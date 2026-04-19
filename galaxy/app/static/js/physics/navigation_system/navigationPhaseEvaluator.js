import {
  DEFAULT_MOON_MISSION_PROFILE,
  NAVIGATION_MISSION_IDS,
  NAVIGATION_MISSION_PHASES,
  normalizeMissionPhase,
  normalizeFillFraction,
} from "./navigationMissionProfiles.js";
import { NAVIGATION_DEFAULTS } from "./navigationSystemConfig.js";
import {
  evaluateMoonCaptureEntryGate,
  evaluateMoonTliExitGate,
} from "./lunar/lunarPhaseGates.js";
import { moonParkingOrbitReady } from "./lunar/moonParkingOrbitGate.js";

function finiteOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : Number(fallback);
}

function boundedOrbit(orbital) {
  return Number(orbital?.specificEnergy) < 0;
}

export function evaluateMoonMissionPhase({
  phase,
  orbital,
  moonOrbit,
  metrics = {},
  missionElapsedInPhaseSec = 0,
  profile = DEFAULT_MOON_MISSION_PROFILE,
} = {}) {
  const currentPhase = normalizeMissionPhase(
    phase || NAVIGATION_MISSION_PHASES.LAUNCH,
    NAVIGATION_MISSION_IDS.MOON_ORBIT_RETURN,
  );
  const periapsisKm = finiteOr(orbital?.periapsisKm, -1);
  const apoapsisKm = finiteOr(orbital?.apoapsisKm, -1);
  const specificEnergy = finiteOr(orbital?.specificEnergy, 1);
  const moonDistanceKm = finiteOr(metrics.moonDistanceKm, Number.POSITIVE_INFINITY);
  const moonAltitudeKm = finiteOr(metrics.moonAltitudeKm, Number.POSITIVE_INFINITY);
  const earthDistanceKm = finiteOr(metrics.earthDistanceKm, Number.POSITIVE_INFINITY);
  const earthRadialSpeedKmS = finiteOr(metrics.earthRadialSpeedKmS, 0);
  const refuelFillFraction = normalizeFillFraction(
    metrics.refuelFillFraction,
    profile.refuelTargetFillFraction,
  );

  if (currentPhase === NAVIGATION_MISSION_PHASES.LAUNCH) {
    const parkingReady = moonParkingOrbitReady(orbital, profile);
    if (parkingReady) {
      return {
        nextPhase: NAVIGATION_MISSION_PHASES.PARKING_ORBIT,
        reason: "parking_orbit_ready",
      };
    }
    return null;
  }

  if (currentPhase === NAVIGATION_MISSION_PHASES.PARKING_ORBIT) {
    return {
      nextPhase: NAVIGATION_MISSION_PHASES.DEPARTURE_WINDOW_WAIT,
      reason: "parking_orbit_stable",
    };
  }

  if (currentPhase === NAVIGATION_MISSION_PHASES.DEPARTURE_WINDOW_WAIT) {
    const departureWindowReady = Boolean(metrics.departureWindowReady);
    const departureWindowWaitSec = finiteOr(metrics.departureWindowWaitSec, Number.NaN);
    const departureWindowKnown = Boolean(
      metrics
      && (
        Object.prototype.hasOwnProperty.call(metrics, "departureWindowReady")
        || Object.prototype.hasOwnProperty.call(metrics, "departureWindowWaitSec")
      ),
    );
    const minimumCoastSatisfied =
      missionElapsedInPhaseSec >= Math.max(0, Number(profile.parkingCoastMinDurationSec) || 0);
    const departureReady = departureWindowKnown
      ? (departureWindowReady || (Number.isFinite(departureWindowWaitSec) && departureWindowWaitSec <= 0))
      : true;
    if (minimumCoastSatisfied && departureReady) {
      return {
        nextPhase: NAVIGATION_MISSION_PHASES.TLI_BURN,
        reason: departureWindowKnown ? "departure_window_open" : "parking_coast_complete",
      };
    }
    return null;
  }

  if (currentPhase === NAVIGATION_MISSION_PHASES.TLI_BURN) {
    const moonClosingSpeedKmS = finiteOr(metrics.moonClosingSpeedKmS, 0);
    const moonProjectedMissDistanceKm = finiteOr(
      metrics.moonProjectedMissDistanceKm,
      Number.POSITIVE_INFINITY,
    );
    const gate = evaluateMoonTliExitGate({
      vehicle: {
        phaseElapsedSec: missionElapsedInPhaseSec,
        tliDurationSec: Number(profile?.tliDurationSec) || 520,
        propellantKg: finiteOr(metrics?.propellantKg, 1),
        fuelBudget: metrics?.fuelBudget && typeof metrics.fuelBudget === "object"
          ? metrics.fuelBudget
          : null,
      },
      orbital,
      moonMetrics: {
        closingSpeedKmS: moonClosingSpeedKmS,
        projectedMissDistanceKm: moonProjectedMissDistanceKm,
        projectedPeriluneAltitudeKm: finiteOr(metrics.moonProjectedPeriluneAltitudeKm, Number.NaN),
        bPlaneErrorKm: finiteOr(metrics.moonBPlaneErrorKm, Number.NaN),
      },
      plannerConfig: NAVIGATION_DEFAULTS.planner,
      minPeriapsisKm: Math.max(80, Number(profile.tliPeriapsisMinKm) || 130),
    });
    const apoReached = apoapsisKm >= (profile.tliTargetApoapsisKm - profile.tliApoapsisMarginKm);
    const energyReady = specificEnergy >= profile.tliMinSpecificEnergyKm2S2;
    if (gate.ready || (apoReached && energyReady && gate.periapsisReady)) {
      return {
        nextPhase: NAVIGATION_MISSION_PHASES.MIDCOURSE,
        reason: gate.ready ? "tli_gate_ready" : "tli_escape_conditions_met",
      };
    }
    return null;
  }

  if (currentPhase === NAVIGATION_MISSION_PHASES.MIDCOURSE) {
    const moonClosingSpeedKmS = finiteOr(metrics.moonClosingSpeedKmS, 0);
    const moonProjectedMissDistanceKm = finiteOr(
      metrics.moonProjectedMissDistanceKm,
      Number.POSITIVE_INFINITY,
    );
    const gate = evaluateMoonCaptureEntryGate({
      moonMetrics: {
        distanceKm: moonDistanceKm,
        closingSpeedKmS: moonClosingSpeedKmS,
        projectedMissDistanceKm: moonProjectedMissDistanceKm,
        projectedPeriluneAltitudeKm: finiteOr(metrics.moonProjectedPeriluneAltitudeKm, Number.NaN),
        bPlaneErrorKm: finiteOr(metrics.moonBPlaneErrorKm, Number.NaN),
      },
      plannerConfig: NAVIGATION_DEFAULTS.planner,
    });
    const approachClosingValid =
      moonClosingSpeedKmS >= (profile.midcourseMinClosingSpeedKmS * 0.3)
      || moonProjectedMissDistanceKm <= (profile.tliInterceptMissDistanceKm * 0.8);
    if (gate.ready || (moonDistanceKm <= profile.moonApproachDistanceKm && approachClosingValid)) {
      return {
        nextPhase: NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_INSERTION,
        reason: gate.ready ? "moon_capture_gate_ready" : "moon_approach_gate",
      };
    }
    return null;
  }

  if (currentPhase === NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_INSERTION) {
    const moonBound = Number(moonOrbit?.specificEnergy) < 0;
    if (moonBound) {
      return {
        nextPhase: NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_TRIM,
        reason: "lunar_capture_achieved",
      };
    }
    return null;
  }

  if (currentPhase === NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_TRIM) {
    const moonBound = Number(moonOrbit?.specificEnergy) < 0;
    const moonApoapsisKm = finiteOr(moonOrbit?.apoapsisKm, Number.POSITIVE_INFINITY);
    const moonPeriapsisKm = finiteOr(moonOrbit?.periapsisKm, -1);
    if (
      moonBound
      && moonApoapsisKm <= profile.lunarOrbitApoapsisMaxKm
      && moonPeriapsisKm >= profile.lunarOrbitPeriapsisMinKm
    ) {
      return {
        nextPhase: NAVIGATION_MISSION_PHASES.LUNAR_LOITER,
        reason: "lunar_trim_complete",
      };
    }
    return null;
  }

  if (currentPhase === NAVIGATION_MISSION_PHASES.LUNAR_LOITER) {
    if (missionElapsedInPhaseSec >= profile.lunarHoldDurationSec) {
      return {
        nextPhase: NAVIGATION_MISSION_PHASES.TEI_BURN,
        reason: "lunar_hold_complete",
      };
    }
    return null;
  }

  if (currentPhase === NAVIGATION_MISSION_PHASES.TEI_BURN) {
    if (moonDistanceKm >= profile.teiDepartureDistanceKm && earthRadialSpeedKmS < 0) {
      return {
        nextPhase: NAVIGATION_MISSION_PHASES.EARTH_APPROACH,
        reason: "tei_departure_complete",
      };
    }
    return null;
  }

  if (currentPhase === NAVIGATION_MISSION_PHASES.EARTH_APPROACH) {
    if (earthDistanceKm <= profile.earthCaptureDistanceKm) {
      return {
        nextPhase: NAVIGATION_MISSION_PHASES.EARTH_CAPTURE,
        reason: "earth_capture_gate",
      };
    }
    return null;
  }

  if (currentPhase === NAVIGATION_MISSION_PHASES.EARTH_CAPTURE) {
    const captureReady =
      boundedOrbit(orbital)
      && apoapsisKm > 0
      && apoapsisKm <= profile.earthCaptureApoapsisMaxKm
      && periapsisKm >= profile.earthCapturePeriapsisMinKm;
    if (captureReady) {
      return {
        nextPhase: NAVIGATION_MISSION_PHASES.EARTH_ORBIT_HOLD,
        reason: "earth_capture_complete",
      };
    }
    return null;
  }

  return null;
}

export function evaluateMissionPhase({
  missionId,
  ...rest
} = {}) {
  if (missionId === NAVIGATION_MISSION_IDS.MOON_ORBIT_RETURN) {
    return evaluateMoonMissionPhase(rest);
  }
  return null;
}
