import {
  solveBestMoonOrbitInjectWindow,
  solveMoonDepartureWindow,
} from "../app/static/js/physics/navigation_system/lunar/departureWindowSolver.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const MOON_MASS_KG = 7.342e22;
const EARTH_RADIUS_KM = 6371.0084;
const MOON_ORBIT_RADIUS_KM = 384400;
const MOON_ORBIT_SPEED_KM_S = 1.022;
const CONSERVATIVE_MARGIN_FLOOR_SEC = 4 * 3600;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function nominalTransferTimeSec({ startRadiusKm, targetRadiusKm, earthMuKm3S2 }) {
  const semiMajorAxis = (startRadiusKm + targetRadiusKm) * 0.5;
  return Math.PI * Math.sqrt((semiMajorAxis ** 3) / earthMuKm3S2);
}

function moonStateAtPhase(phaseRad) {
  const cosPhase = Math.cos(phaseRad);
  const sinPhase = Math.sin(phaseRad);
  return {
    position: {
      x: MOON_ORBIT_RADIUS_KM * cosPhase,
      y: MOON_ORBIT_RADIUS_KM * sinPhase,
      z: 0,
    },
    velocity: {
      x: -MOON_ORBIT_SPEED_KM_S * sinPhase,
      y: MOON_ORBIT_SPEED_KM_S * cosPhase,
      z: 0,
    },
    massKg: MOON_MASS_KG,
  };
}

function earthSurfacePoint(latDeg, lonDeg, altitudeKm = 0) {
  const latRad = (latDeg * Math.PI) / 180;
  const lonRad = (lonDeg * Math.PI) / 180;
  const radiusKm = EARTH_RADIUS_KM + altitudeKm;
  const cosLat = Math.cos(latRad);
  return {
    x: radiusKm * cosLat * Math.cos(lonRad),
    y: radiusKm * cosLat * Math.sin(lonRad),
    z: radiusKm * Math.sin(latRad),
  };
}

function main() {
  const earthMuKm3S2 = G_KM3_KG_S2 * EARTH_MASS_KG;
  const earthState = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    massKg: EARTH_MASS_KG,
  };
  const moonState = moonStateAtPhase(Math.PI / 3);
  const orbitAltitudeKm = 500;
  const nominalTransferSec = nominalTransferTimeSec({
    startRadiusKm: EARTH_RADIUS_KM + orbitAltitudeKm,
    targetRadiusKm: MOON_ORBIT_RADIUS_KM,
    earthMuKm3S2,
  });

  const injectSolve = solveBestMoonOrbitInjectWindow({
    earthState,
    moonState,
    orbitAltitudeKm,
    earthRadiusKm: EARTH_RADIUS_KM,
    earthMuKm3S2,
    inclinationDeg: 28.5,
    nodeSamples: 48,
  });
  assert(injectSolve.valid, "moon_window_conservative_lead_lock: inject solve invalid");
  assert(
    Number.isFinite(Number(injectSolve.transferTimeSec))
      && Number(injectSolve.transferTimeSec) >= (nominalTransferSec + CONSERVATIVE_MARGIN_FLOOR_SEC),
    `moon_window_conservative_lead_lock: inject transfer time should include conservative lead margin, got ${injectSolve.transferTimeSec}, nominal ${nominalTransferSec}`,
  );
  assert(
    Number.isFinite(Number(injectSolve.selectedCoastEntryAlignment))
      && Number(injectSolve.selectedCoastEntryAlignment) >= 0.75,
    `moon_window_conservative_lead_lock: inject solve should preserve strong coast-entry alignment, got ${injectSolve.selectedCoastEntryAlignment}`,
  );

  const padSolve = solveMoonDepartureWindow({
    earthState,
    moonState,
    shipPositionKm: earthSurfacePoint(28.5, -80.6, 0),
    inclinationDeg: 28.5,
    ascendingNodeRad: 0,
    orbitAltitudeKm,
    earthRadiusKm: EARTH_RADIUS_KM,
    earthMuKm3S2,
    padAngularRateRadS: (Math.PI * 2) / 86164,
  });
  assert(padSolve.valid, "moon_window_conservative_lead_lock: pad solve invalid");
  assert(
    Number.isFinite(Number(padSolve.transferTimeSec))
      && Number(padSolve.transferTimeSec) >= (nominalTransferSec + CONSERVATIVE_MARGIN_FLOOR_SEC),
    `moon_window_conservative_lead_lock: pad transfer time should include conservative lead margin, got ${padSolve.transferTimeSec}, nominal ${nominalTransferSec}`,
  );
  assert(
    Number.isFinite(Number(padSolve.selectedCoastEntryAlignment))
      && Number(padSolve.selectedCoastEntryAlignment) >= 0.68,
    `moon_window_conservative_lead_lock: pad solve should preserve strong coast-entry alignment, got ${padSolve.selectedCoastEntryAlignment}`,
  );

  console.log("PASS moon-window-conservative-lead-lock");
}

main();
