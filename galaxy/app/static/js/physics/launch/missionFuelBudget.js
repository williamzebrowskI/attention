import { clamp, length, subtract } from "./launchMath.js";

const G0_M_S2 = 9.80665;

function safePositive(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function hohmannDepartureDeltaVKmS(muKm3S2, rFromKm, rToKm) {
  const mu = safePositive(muKm3S2, 0);
  const rFrom = safePositive(rFromKm, 0);
  const rTo = safePositive(rToKm, 0);
  if (!(mu > 0) || !(rFrom > 1) || !(rTo > 1)) {
    return 0;
  }
  const semiMajorKm = (rFrom + rTo) * 0.5;
  if (!(semiMajorKm > 1)) {
    return 0;
  }
  const circularSpeed = Math.sqrt(mu / rFrom);
  const transferSpeed = Math.sqrt(mu * ((2 / rFrom) - (1 / semiMajorKm)));
  return Math.max(0, Math.abs(transferSpeed - circularSpeed));
}

function phaseWeightsForMoonRoundTrip(phaseRaw) {
  const phase = String(phaseRaw || "").trim().toLowerCase();
  if (phase === "launch_to_parking" || phase === "orbital_refuel") {
    return { outbound: 1, lunarCapture: 1, returnDepart: 1, earthCapture: 1, reserve: 1 };
  }
  if (phase === "tli_burn") {
    return { outbound: 0.7, lunarCapture: 1, returnDepart: 1, earthCapture: 1, reserve: 1 };
  }
  if (phase === "coast_to_moon") {
    return { outbound: 0.2, lunarCapture: 1, returnDepart: 1, earthCapture: 1, reserve: 1 };
  }
  if (phase === "lunar_capture") {
    return { outbound: 0, lunarCapture: 0.7, returnDepart: 1, earthCapture: 1, reserve: 0.8 };
  }
  if (phase === "lunar_orbit_hold") {
    return { outbound: 0, lunarCapture: 0, returnDepart: 1, earthCapture: 1, reserve: 0.8 };
  }
  if (phase === "tei_burn") {
    return { outbound: 0, lunarCapture: 0, returnDepart: 0.7, earthCapture: 1, reserve: 0.6 };
  }
  if (phase === "coast_to_earth") {
    return { outbound: 0, lunarCapture: 0, returnDepart: 0.15, earthCapture: 1, reserve: 0.4 };
  }
  if (phase === "earth_capture") {
    return { outbound: 0, lunarCapture: 0, returnDepart: 0, earthCapture: 0.8, reserve: 0.2 };
  }
  return { outbound: 0, lunarCapture: 0, returnDepart: 0, earthCapture: 0, reserve: 0 };
}

function deltaVCapacityKmS({
  initialMassKg = 0,
  propellantKg = 0,
  ispVacuumS = 0,
} = {}) {
  const m0 = safePositive(initialMassKg, 0);
  const propKg = Math.max(0, Number(propellantKg) || 0);
  const isp = safePositive(ispVacuumS, 0);
  if (!(m0 > 0) || !(propKg > 0) || !(isp > 0)) {
    return 0;
  }
  const mf = Math.max(1, m0 - propKg);
  if (!(m0 > mf)) {
    return 0;
  }
  const deltaVMs = isp * G0_M_S2 * Math.log(m0 / mf);
  return Math.max(0, deltaVMs / 1000);
}

function propellantRequiredKg({
  initialMassKg = 0,
  deltaVRequiredKmS = 0,
  ispVacuumS = 0,
} = {}) {
  const m0 = safePositive(initialMassKg, 0);
  const isp = safePositive(ispVacuumS, 0);
  const deltaVms = Math.max(0, Number(deltaVRequiredKmS) || 0) * 1000;
  if (!(m0 > 0) || !(isp > 0) || !(deltaVms > 0)) {
    return 0;
  }
  const massRatio = Math.exp(deltaVms / (isp * G0_M_S2));
  const mf = m0 / massRatio;
  return Math.max(0, m0 - mf);
}

function summarizeFuelBudget({
  initialMassKg = 0,
  stagePropellantKg = 0,
  stageIspVacuumS = 380,
  requiredDeltaVKmS = 0,
} = {}) {
  const currentMassKg = Math.max(1, Number(initialMassKg) || 1);
  const availablePropellantKg = Math.max(0, Number(stagePropellantKg) || 0);
  const availableDeltaVKmS = deltaVCapacityKmS({
    initialMassKg: currentMassKg,
    propellantKg: availablePropellantKg,
    ispVacuumS: stageIspVacuumS,
  });
  const minimumRequiredPropellantKg = propellantRequiredKg({
    initialMassKg: currentMassKg,
    deltaVRequiredKmS: requiredDeltaVKmS,
    ispVacuumS: stageIspVacuumS,
  });
  const marginKg = availablePropellantKg - minimumRequiredPropellantKg;
  return {
    requiredDeltaVKmS,
    availableDeltaVKmS,
    minimumRequiredPropellantKg,
    availablePropellantKg,
    marginKg,
    feasible: marginKg >= 0,
  };
}

export function estimateMoonRoundTripFuelBudget({
  missionPhase = "",
  shipState = null,
  earthState = null,
  moonState = null,
  earthRadiusKm = 6371.0084,
  moonRadiusKm = 1737.4,
  earthMuKm3S2 = 398600.4418,
  moonMuKm3S2 = 4902.800066,
  stageIspVacuumS = 380,
  stagePropellantKg = 0,
} = {}) {
  if (
    !shipState
    || !earthState
    || !moonState
    || !shipState.position
    || !shipState.velocity
    || !earthState.position
    || !earthState.velocity
    || !moonState.position
    || !moonState.velocity
  ) {
    return null;
  }
  const shipEarthRel = subtract(shipState.position, earthState.position);
  const moonEarthRel = subtract(moonState.position, earthState.position);
  const shipMoonRel = subtract(shipState.position, moonState.position);
  const shipMoonRelVel = subtract(
    shipState.velocity || { x: 0, y: 0, z: 0 },
    moonState.velocity || { x: 0, y: 0, z: 0 },
  );
  const shipEarthRadiusKm = Math.max(safePositive(earthRadiusKm, 6371.0084) + 80, length(shipEarthRel));
  const moonEarthRadiusKm = Math.max(shipEarthRadiusKm + 1, length(moonEarthRel));
  const shipMoonDistanceKm = Math.max(0, length(shipMoonRel));
  const shipMoonRelSpeedKmS = Math.max(0, length(shipMoonRelVel));

  const earthCaptureOrbitRadiusKm = Math.max(safePositive(earthRadiusKm, 6371.0084) + 180, shipEarthRadiusKm * 0.25);
  const moonParkingOrbitRadiusKm = Math.max(safePositive(moonRadiusKm, 1737.4) + 110, 1800);
  const lunarCircularSpeedKmS = Math.sqrt(
    safePositive(moonMuKm3S2, 4902.800066) / moonParkingOrbitRadiusKm,
  );

  const outboundDvKmS = hohmannDepartureDeltaVKmS(
    earthMuKm3S2,
    shipEarthRadiusKm,
    moonEarthRadiusKm,
  );
  const returnDepartDvKmS = hohmannDepartureDeltaVKmS(
    earthMuKm3S2,
    moonEarthRadiusKm,
    earthCaptureOrbitRadiusKm,
  );
  const nearMoonForCapture = shipMoonDistanceKm <= 120_000;
  const lunarCaptureDvKmS = nearMoonForCapture
    ? clamp(shipMoonRelSpeedKmS - lunarCircularSpeedKmS, 0.2, 2.6)
    : 0.85;
  const earthCaptureDvKmS = 0.65;
  const reserveDvKmS = clamp(
    0.22 + ((shipMoonDistanceKm / Math.max(moonEarthRadiusKm, 1)) * 0.2),
    0.22,
    0.46,
  );
  const weights = phaseWeightsForMoonRoundTrip(missionPhase);
  const requiredDeltaVKmS = Math.max(
    0,
    (outboundDvKmS * weights.outbound)
      + (lunarCaptureDvKmS * weights.lunarCapture)
      + (returnDepartDvKmS * weights.returnDepart)
      + (earthCaptureDvKmS * weights.earthCapture)
      + (reserveDvKmS * weights.reserve),
  );
  const summary = summarizeFuelBudget({
    initialMassKg: Number(shipState.massKg) || 1,
    stagePropellantKg,
    stageIspVacuumS,
    requiredDeltaVKmS,
  });
  return {
    ...summary,
    shipToMoonDistanceKm: shipMoonDistanceKm,
    earthToMoonDistanceKm: moonEarthRadiusKm,
  };
}

export function estimateOrbitalRefuelDemoFuelBudget({
  missionPhase = "",
  shipState = null,
  earthState = null,
  earthRadiusKm = 6371.0084,
  stageIspVacuumS = 380,
  stagePropellantKg = 0,
  target = null,
} = {}) {
  if (!shipState || !earthState || !shipState.position || !earthState.position) {
    return null;
  }

  const phase = String(missionPhase || "").trim().toLowerCase();
  const shipEarthRel = subtract(shipState.position, earthState.position);
  const shipAltitudeKm = Math.max(0, length(shipEarthRel) - safePositive(earthRadiusKm, 6371.0084));
  const targetDistanceKmRaw = Number(target?.distanceKm);
  const targetDistanceKnown = Number.isFinite(targetDistanceKmRaw);
  const targetDistanceKm = targetDistanceKnown ? Math.max(0, targetDistanceKmRaw) : Number.NaN;
  const targetRelativeSpeedKmS = Math.max(0, Number(target?.relativeSpeedKmS) || 0);
  const targetClosingSpeedRawKmS = Number(target?.closingSpeedKmS);
  const targetMovingAwaySpeedKmS = Number.isFinite(targetClosingSpeedRawKmS) && targetClosingSpeedRawKmS < 0
    ? Math.abs(targetClosingSpeedRawKmS)
    : 0;
  const targetAltitudeKm = Number(target?.altitudeKm);
  const altitudeErrorKm = Number.isFinite(targetAltitudeKm)
    ? Math.abs(targetAltitudeKm - shipAltitudeKm)
    : 0;

  let requiredDeltaVKmS = 0.16;
  if (phase === "orbital_refuel") {
    if (targetDistanceKnown) {
      const phaseCatchupDvKmS = clamp(
        0.018 + (targetDistanceKm / 70_000),
        0.018,
        0.30,
      );
      const relativeMatchDvKmS = clamp(
        targetRelativeSpeedKmS * 0.85,
        0.015,
        1.25,
      );
      const movingAwayPenaltyDvKmS = clamp(
        targetMovingAwaySpeedKmS * 0.6,
        0,
        0.9,
      );
      const altitudeTrimDvKmS = clamp(
        altitudeErrorKm / 2500,
        0,
        0.18,
      );
      const dockingTrimDvKmS = 0.03;
      const orbitReserveDvKmS = clamp(
        0.12 + (targetDistanceKm / 220_000),
        0.12,
        0.28,
      );
      requiredDeltaVKmS = phaseCatchupDvKmS
        + relativeMatchDvKmS
        + movingAwayPenaltyDvKmS
        + altitudeTrimDvKmS
        + dockingTrimDvKmS
        + orbitReserveDvKmS;
    } else {
      // No eligible tanker yet: preserve a modest station-keeping + intercept reserve.
      requiredDeltaVKmS = 0.26;
    }
  }

  const summary = summarizeFuelBudget({
    initialMassKg: Number(shipState.massKg) || 1,
    stagePropellantKg,
    stageIspVacuumS,
    requiredDeltaVKmS,
  });
  return {
    ...summary,
    shipAltitudeKm,
    targetDistanceKm: targetDistanceKnown ? targetDistanceKm : null,
    targetRelativeSpeedKmS,
    targetClosingSpeedKmS: Number.isFinite(targetClosingSpeedRawKmS)
      ? targetClosingSpeedRawKmS
      : null,
  };
}
