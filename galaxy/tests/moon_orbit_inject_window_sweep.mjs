import { solveBestMoonOrbitInjectWindow } from "../app/static/js/physics/navigation_system/lunar/departureWindowSolver.js";

const G_KM3_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const MOON_MASS_KG = 7.342e22;
const EARTH_RADIUS_KM = 6371;
const MOON_ORBIT_RADIUS_KM = 384400;
const MOON_ORBIT_SPEED_KM_S = 1.022;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

function runScenario(label, phaseRad) {
  const earthState = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    massKg: EARTH_MASS_KG,
  };
  const moonState = moonStateAtPhase(phaseRad);
  const solved = solveBestMoonOrbitInjectWindow({
    earthState,
    moonState,
    orbitAltitudeKm: 185,
    earthRadiusKm: EARTH_RADIUS_KM,
    earthMuKm3S2: G_KM3_KG_S2 * EARTH_MASS_KG,
    inclinationDeg: 28.5,
    nodeSamples: 72,
  });
  return {
    label,
    phaseRad,
    solved,
  };
}

function main() {
  const scenarios = [
    runScenario("phase_0", 0),
    runScenario("phase_45deg", Math.PI / 4),
    runScenario("phase_90deg", Math.PI / 2),
    runScenario("phase_135deg", (3 * Math.PI) / 4),
    runScenario("phase_180deg", Math.PI),
    runScenario("phase_225deg", (5 * Math.PI) / 4),
    runScenario("phase_270deg", (3 * Math.PI) / 2),
    runScenario("phase_315deg", (7 * Math.PI) / 4),
  ];

  const failures = scenarios.filter((scenario) => !scenario.solved?.corridorAccepted);
  if (failures.length > 0) {
    const details = failures.map((scenario) => (
      `${scenario.label}: miss=${Number(scenario.solved?.predictedMissDistanceKm).toFixed(0)} `
      + `peri=${Number(scenario.solved?.predictedPeriluneAltitudeKm).toFixed(0)} `
      + `b=${Number(scenario.solved?.bPlaneErrorKm).toFixed(0)} `
      + `reason=${scenario.solved?.reason || "n/a"}`
    )).join(" | ");
    throw new Error(`moon orbit inject sweep failed ${failures.length}/${scenarios.length}: ${details}`);
  }

  assert(
    scenarios.every((scenario) => Boolean(scenario.solved?.ready)),
    "moon orbit inject sweep: every accepted corridor should be launch-window ready",
  );

  console.log("PASS moon-orbit-inject-window-sweep");
}

main();
