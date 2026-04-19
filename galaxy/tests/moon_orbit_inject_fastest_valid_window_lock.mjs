import {
  evaluateMoonOrbitInjectLocation,
  solveBestMoonOrbitInjectWindow,
} from "../app/static/js/physics/navigation_system/lunar/departureWindowSolver.js";
import {
  MOON_ORBIT_INJECT_ALTITUDE_KM,
  MOON_ORBIT_INJECT_DEPARTURE_NODE_SAMPLES,
  MOON_ORBIT_INJECT_DEPARTURE_SEARCH_PROFILE,
} from "../app/static/js/physics/launch/lunar/constants.js";
import { LAUNCH_VEHICLE_CONFIG } from "../app/static/js/physics/launch/launchConfig.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_MASS_KG = 7.342e22;
const INCLINATION_DEG = 28.5;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeAngleZeroToTau(angleRad) {
  const tau = Math.PI * 2;
  let value = Number(angleRad) % tau;
  if (value < 0) {
    value += tau;
  }
  return value;
}

function compareSamples(a, b) {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  if (Boolean(a.result?.ready) !== Boolean(b.result?.ready)) {
    return b.result?.ready ? b : a;
  }
  const aMissKm = Number(a.result?.predictedMissDistanceKm);
  const bMissKm = Number(b.result?.predictedMissDistanceKm);
  const aBPlaneKm = Number(a.result?.bPlaneErrorKm);
  const bBPlaneKm = Number(b.result?.bPlaneErrorKm);
  const aPeriluneErrorKm = Math.abs((Number(a.result?.predictedPeriluneAltitudeKm) || 120) - 120);
  const bPeriluneErrorKm = Math.abs((Number(b.result?.predictedPeriluneAltitudeKm) || 120) - 120);
  const bMateriallyBetterQuality = (
    (Number.isFinite(aMissKm) && Number.isFinite(bMissKm) && bMissKm < (aMissKm - 1_500))
    || (Number.isFinite(aBPlaneKm) && Number.isFinite(bBPlaneKm) && bBPlaneKm < (aBPlaneKm - 1_500))
    || (
      Number.isFinite(aPeriluneErrorKm)
      && Number.isFinite(bPeriluneErrorKm)
      && bPeriluneErrorKm < (aPeriluneErrorKm - 1_000)
    )
  );
  if (bMateriallyBetterQuality) {
    return b;
  }
  const aMateriallyBetterQuality = (
    (Number.isFinite(aMissKm) && Number.isFinite(bMissKm) && bMissKm > (aMissKm + 1_500))
    || (Number.isFinite(aBPlaneKm) && Number.isFinite(bBPlaneKm) && bBPlaneKm > (aBPlaneKm + 1_500))
    || (
      Number.isFinite(aPeriluneErrorKm)
      && Number.isFinite(bPeriluneErrorKm)
      && bPeriluneErrorKm > (aPeriluneErrorKm + 1_000)
    )
  );
  if (aMateriallyBetterQuality) {
    return a;
  }
  const comparableQuality = true;
  const aTotalSec = Number(a.totalSec);
  const bTotalSec = Number(b.totalSec);
  if (comparableQuality && Number.isFinite(aTotalSec) && Number.isFinite(bTotalSec)) {
    if (bTotalSec < (aTotalSec - 120)) {
      return b;
    }
    if (bTotalSec > (aTotalSec + 120)) {
      return a;
    }
  }
  const aBurnSec = Number(a.result?.optimizedBurnDurationSec);
  const bBurnSec = Number(b.result?.optimizedBurnDurationSec);
  if (Number.isFinite(aBurnSec) && Number.isFinite(bBurnSec)) {
    if (bBurnSec < (aBurnSec - 15)) {
      return b;
    }
    if (bBurnSec > (aBurnSec + 15)) {
      return a;
    }
  }
  if (Number.isFinite(aMissKm) && Number.isFinite(bMissKm)) {
    if (bMissKm < (aMissKm - 1e-6)) {
      return b;
    }
    if (bMissKm > (aMissKm + 1e-6)) {
      return a;
    }
  }
  return a;
}

function scenarioMoonState() {
  const phaseRad = Math.PI / 3;
  const cosPhase = Math.cos(phaseRad);
  const sinPhase = Math.sin(phaseRad);
  return {
    earthState: {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      massKg: EARTH_MASS_KG,
    },
    moonState: {
      position: {
        x: 384400 * cosPhase,
        y: 384400 * sinPhase,
        z: 0,
      },
      velocity: {
        x: -1.022 * sinPhase,
        y: 1.022 * cosPhase,
        z: 0,
      },
      massKg: MOON_MASS_KG,
    },
  };
}

function main() {
  const { earthState, moonState } = scenarioMoonState();
  const stage2 = LAUNCH_VEHICLE_CONFIG.stages[1] || {};
  const spacecraftMassKg = Math.max(30_000, Number(stage2.dryMassKg) || 120_000)
    + Math.max(5_000_000, Number(stage2.propellantMassKg) || 1_200_000);
  const engineAccelAtThrottle1KmS2 = (
    Math.max(0, Number(stage2.thrustVacuumN) || Number(stage2.thrustSeaLevelN) || 0) / spacecraftMassKg
  ) / 1000;
  const earthMuKm3S2 = G_KM3_KG_S2 * EARTH_MASS_KG;

  const solved = solveBestMoonOrbitInjectWindow({
    earthState,
    moonState,
    inclinationDeg: INCLINATION_DEG,
    orbitAltitudeKm: MOON_ORBIT_INJECT_ALTITUDE_KM,
    earthRadiusKm: EARTH_RADIUS_KM,
    earthMuKm3S2,
    nodeSamples: MOON_ORBIT_INJECT_DEPARTURE_NODE_SAMPLES,
    searchProfile: MOON_ORBIT_INJECT_DEPARTURE_SEARCH_PROFILE,
    spacecraftMassKg,
    engineAccelAtThrottle1KmS2,
  });
  assert(solved.valid, "moon_orbit_inject_fastest_valid_window_lock: solve invalid");
  assert(solved.ready, "moon_orbit_inject_fastest_valid_window_lock: solve should be ready");

  const reserveOffsetsSec = [-3600, -1800, 0, 1800, 3600];
  const nodeOffsetsDeg = [-5, -2.5, 0, 2.5, 5];
  const phaseOffsetsDeg = [-10, -5, 0, 5, 10];
  let bestSample = null;

  for (let reserveIndex = 0; reserveIndex < reserveOffsetsSec.length; reserveIndex += 1) {
    for (let nodeIndex = 0; nodeIndex < nodeOffsetsDeg.length; nodeIndex += 1) {
      for (let phaseIndex = 0; phaseIndex < phaseOffsetsDeg.length; phaseIndex += 1) {
        const result = evaluateMoonOrbitInjectLocation({
          earthState,
          moonState,
          inclinationDeg: INCLINATION_DEG,
          ascendingNodeRad: normalizeAngleZeroToTau(
            Number(solved.ascendingNodeRad) + ((nodeOffsetsDeg[nodeIndex] * Math.PI) / 180),
          ),
          orbitAltitudeKm: MOON_ORBIT_INJECT_ALTITUDE_KM,
          apoapsisAltitudeKm: Number(solved.optimizedApoapsisAltitudeKm),
          phaseRad: normalizeAngleZeroToTau(
            Number(solved.targetPhaseRad) + ((phaseOffsetsDeg[phaseIndex] * Math.PI) / 180),
          ),
          earthRadiusKm: EARTH_RADIUS_KM,
          earthMuKm3S2,
          searchProfile: MOON_ORBIT_INJECT_DEPARTURE_SEARCH_PROFILE,
          spacecraftMassKg,
          engineAccelAtThrottle1KmS2,
          transferReserveSec: Number(solved.optimizedTransferReserveSec) + reserveOffsetsSec[reserveIndex],
        });
        const totalSec = Number(result?.transferTimeSec) + Number(result?.optimizedBurnDurationSec);
        bestSample = compareSamples(bestSample, {
          reserveOffsetSec: reserveOffsetsSec[reserveIndex],
          nodeOffsetDeg: nodeOffsetsDeg[nodeIndex],
          phaseOffsetDeg: phaseOffsetsDeg[phaseIndex],
          totalSec,
          result,
        });
      }
    }
  }

  assert(bestSample, "moon_orbit_inject_fastest_valid_window_lock: missing sampled best");
  assert(
    Number(bestSample.reserveOffsetSec) === 0
      && Number(bestSample.nodeOffsetDeg) === 0
      && Number(bestSample.phaseOffsetDeg) === 0,
    `moon_orbit_inject_fastest_valid_window_lock: chosen direct-inject spawn is not the fastest valid local departure (best reserve=${bestSample.reserveOffsetSec}s node=${bestSample.nodeOffsetDeg}deg phase=${bestSample.phaseOffsetDeg}deg)`,
  );

  console.log("PASS moon-orbit-inject-fastest-valid-window-lock");
}

main();
