import {
  DEFAULT_MOON_MISSION_PROFILE,
  NAVIGATION_MISSION_IDS,
  NAVIGATION_MISSION_PHASES,
  normalizeFillFraction,
} from "./navigationMissionProfiles.js";

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
  const currentPhase = String(phase || NAVIGATION_MISSION_PHASES.LAUNCH_TO_PARKING);
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

  if (currentPhase === NAVIGATION_MISSION_PHASES.LAUNCH_TO_PARKING) {
    const parkingReady =
      boundedOrbit(orbital)
      && periapsisKm >= profile.parkingOrbitPeriapsisMinKm
      && apoapsisKm >= profile.parkingOrbitApoapsisMinKm;
    if (parkingReady) {
      return {
        nextPhase: NAVIGATION_MISSION_PHASES.ORBITAL_REFUEL,
        reason: "parking_orbit_ready",
      };
    }
    return null;
  }

  if (currentPhase === NAVIGATION_MISSION_PHASES.ORBITAL_REFUEL) {
    if (refuelFillFraction >= profile.refuelTargetFillFraction) {
      return {
        nextPhase: NAVIGATION_MISSION_PHASES.TLI_BURN,
        reason: "refuel_target_met",
      };
    }
    return null;
  }

  if (currentPhase === NAVIGATION_MISSION_PHASES.TLI_BURN) {
    const apoReached = apoapsisKm >= (profile.tliTargetApoapsisKm - profile.tliApoapsisMarginKm);
    const energyReady = specificEnergy >= profile.tliMinSpecificEnergyKm2S2;
    const periapsisSafe = periapsisKm >= Math.max(80, Number(profile.tliPeriapsisMinKm) || 130);
    const moonClosingSpeedKmS = finiteOr(metrics.moonClosingSpeedKmS, 0);
    const moonProjectedMissDistanceKm = finiteOr(
      metrics.moonProjectedMissDistanceKm,
      Number.POSITIVE_INFINITY,
    );
    const interceptTrending =
      moonClosingSpeedKmS >= (profile.midcourseMinClosingSpeedKmS * 0.65)
      || moonProjectedMissDistanceKm <= profile.tliInterceptMissDistanceKm;
    if (apoReached && energyReady && interceptTrending && periapsisSafe) {
      return {
        nextPhase: NAVIGATION_MISSION_PHASES.COAST_TO_MOON,
        reason: "tli_escape_conditions_met",
      };
    }
    return null;
  }

  if (currentPhase === NAVIGATION_MISSION_PHASES.COAST_TO_MOON) {
    const moonClosingSpeedKmS = finiteOr(metrics.moonClosingSpeedKmS, 0);
    const moonProjectedMissDistanceKm = finiteOr(
      metrics.moonProjectedMissDistanceKm,
      Number.POSITIVE_INFINITY,
    );
    const approachClosingValid =
      moonClosingSpeedKmS >= (profile.midcourseMinClosingSpeedKmS * 0.3)
      || moonProjectedMissDistanceKm <= (profile.tliInterceptMissDistanceKm * 0.8);
    if (moonDistanceKm <= profile.moonApproachDistanceKm && approachClosingValid) {
      return {
        nextPhase: NAVIGATION_MISSION_PHASES.LUNAR_INSERTION,
        reason: "moon_approach_gate",
      };
    }
    return null;
  }

  if (currentPhase === NAVIGATION_MISSION_PHASES.LUNAR_INSERTION) {
    const moonBound = Number(moonOrbit?.specificEnergy) < 0;
    const moonApoapsisKm = finiteOr(moonOrbit?.apoapsisKm, Number.POSITIVE_INFINITY);
    const moonPeriapsisKm = finiteOr(moonOrbit?.periapsisKm, -1);
    if (
      moonBound
      && moonApoapsisKm <= profile.lunarOrbitApoapsisMaxKm
      && moonPeriapsisKm >= profile.lunarOrbitPeriapsisMinKm
    ) {
      return {
        nextPhase: NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_HOLD,
        reason: "lunar_capture_achieved",
      };
    }
    return null;
  }

  if (currentPhase === NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_HOLD) {
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
        nextPhase: NAVIGATION_MISSION_PHASES.COAST_TO_EARTH,
        reason: "tei_departure_complete",
      };
    }
    return null;
  }

  if (currentPhase === NAVIGATION_MISSION_PHASES.COAST_TO_EARTH) {
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
