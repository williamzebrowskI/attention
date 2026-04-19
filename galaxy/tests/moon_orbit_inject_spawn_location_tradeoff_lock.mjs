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

function signedAngleDifferenceRad(a, b) {
  const tau = Math.PI * 2;
  let value = normalizeAngleZeroToTau(a) - normalizeAngleZeroToTau(b);
  while (value > Math.PI) {
    value -= tau;
  }
  while (value < -Math.PI) {
    value += tau;
  }
  return value;
}

function scoreResult(result) {
  if (!result || !result.valid) {
    return Number.NEGATIVE_INFINITY;
  }
  const missKm = Number.isFinite(Number(result.predictedMissDistanceKm))
    ? Math.max(0, Number(result.predictedMissDistanceKm))
    : 1e12;
  const periluneKm = Number.isFinite(Number(result.predictedPeriluneAltitudeKm))
    ? Math.max(0, Number(result.predictedPeriluneAltitudeKm))
    : 1e12;
  const bPlaneKm = Number.isFinite(Number(result.bPlaneErrorKm))
    ? Math.max(0, Number(result.bPlaneErrorKm))
    : 1e12;
  const corridorScore = Number.isFinite(Number(result.corridorScore))
    ? Math.max(0, Math.min(1, Number(result.corridorScore)))
    : 0;
  const windowScore = Number.isFinite(Number(result.windowScore))
    ? Math.max(0, Math.min(1, Number(result.windowScore)))
    : 0;
  return (
    (Boolean(result.ready) ? 1e12 : 0)
    + (corridorScore * 1e9)
    + (windowScore * 1e7)
    - missKm
    - (bPlaneKm * 0.95)
    - (periluneKm * 0.2)
  );
}

function scenarioMoonState(label, phaseRad, zOffsetKm = 0, zRateKmS = 0) {
  const cosPhase = Math.cos(phaseRad);
  const sinPhase = Math.sin(phaseRad);
  return {
    label,
    earthState: {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      massKg: EARTH_MASS_KG,
    },
    moonState: {
      position: {
        x: 384400 * cosPhase,
        y: 384400 * sinPhase,
        z: zOffsetKm,
      },
      velocity: {
        x: -1.022 * sinPhase,
        y: 1.022 * cosPhase,
        z: zRateKmS,
      },
      massKg: MOON_MASS_KG,
    },
  };
}

function solveScenario(scenario) {
  const stage2 = LAUNCH_VEHICLE_CONFIG.stages[1] || {};
  const spacecraftMassKg = Math.max(30_000, Number(stage2.dryMassKg) || 120_000)
    + Math.max(5_000_000, Number(stage2.propellantMassKg) || 1_200_000);
  const engineAccelAtThrottle1KmS2 = (
    Math.max(0, Number(stage2.thrustVacuumN) || Number(stage2.thrustSeaLevelN) || 0) / spacecraftMassKg
  ) / 1000;
  const earthMuKm3S2 = G_KM3_KG_S2 * EARTH_MASS_KG;
  const optimized = solveBestMoonOrbitInjectWindow({
    earthState: scenario.earthState,
    moonState: scenario.moonState,
    inclinationDeg: INCLINATION_DEG,
    orbitAltitudeKm: MOON_ORBIT_INJECT_ALTITUDE_KM,
    earthRadiusKm: EARTH_RADIUS_KM,
    earthMuKm3S2,
    nodeSamples: MOON_ORBIT_INJECT_DEPARTURE_NODE_SAMPLES,
    searchProfile: MOON_ORBIT_INJECT_DEPARTURE_SEARCH_PROFILE,
    spacecraftMassKg,
    engineAccelAtThrottle1KmS2,
  });
  assert(optimized.valid, `${scenario.label}: optimized solve invalid`);
  assert(optimized.ready, `${scenario.label}: optimized solve should produce a ready direct-inject plan`);
  const chosen = evaluateMoonOrbitInjectLocation({
    earthState: scenario.earthState,
    moonState: scenario.moonState,
    inclinationDeg: INCLINATION_DEG,
    ascendingNodeRad: Number(optimized.ascendingNodeRad),
    orbitAltitudeKm: MOON_ORBIT_INJECT_ALTITUDE_KM,
    apoapsisAltitudeKm: Number(optimized.optimizedApoapsisAltitudeKm),
    phaseRad: Number(optimized.targetPhaseRad),
    earthRadiusKm: EARTH_RADIUS_KM,
    earthMuKm3S2,
    searchProfile: MOON_ORBIT_INJECT_DEPARTURE_SEARCH_PROFILE,
    spacecraftMassKg,
    engineAccelAtThrottle1KmS2,
    transferReserveSec: Number(optimized.optimizedTransferReserveSec),
  });
  assert(chosen.valid, `${scenario.label}: chosen location evaluation invalid`);
  assert(chosen.ready, `${scenario.label}: chosen location should allow immediate lunar departure`);

  const phaseOffsetsDeg = [0, -15, -10, -5, 5, 10, 15, 30, -30, 60, -60, 180];
  const samples = [];
  for (let index = 0; index < phaseOffsetsDeg.length; index += 1) {
    const samplePhaseRad = normalizeAngleZeroToTau(
      Number(optimized.targetPhaseRad) + ((phaseOffsetsDeg[index] * Math.PI) / 180),
    );
    const evaluated = evaluateMoonOrbitInjectLocation({
      earthState: scenario.earthState,
      moonState: scenario.moonState,
      inclinationDeg: INCLINATION_DEG,
      ascendingNodeRad: Number(optimized.ascendingNodeRad),
      orbitAltitudeKm: MOON_ORBIT_INJECT_ALTITUDE_KM,
      apoapsisAltitudeKm: Number(optimized.optimizedApoapsisAltitudeKm),
      phaseRad: samplePhaseRad,
      earthRadiusKm: EARTH_RADIUS_KM,
      earthMuKm3S2,
      searchProfile: MOON_ORBIT_INJECT_DEPARTURE_SEARCH_PROFILE,
      spacecraftMassKg,
      engineAccelAtThrottle1KmS2,
      transferReserveSec: Number(optimized.optimizedTransferReserveSec),
    });
    samples.push({
      phaseOffsetDeg: phaseOffsetsDeg[index],
      phaseRad: samplePhaseRad,
      evaluated,
      score: scoreResult(evaluated),
    });
  }

  const bestSample = samples.reduce((best, current) => (
    !best || current.score > best.score ? current : best
  ), null);
  const worstFarSample = samples
    .filter((entry) => Math.abs(Number(entry.phaseOffsetDeg)) >= 30)
    .reduce((worst, current) => (!worst || current.score < worst.score ? current : worst), null);
  const chosenScore = scoreResult(chosen);

  assert(bestSample, `${scenario.label}: missing sampled best location`);
  assert(worstFarSample, `${scenario.label}: missing distant sampled location`);
  assert(
    Number(bestSample.phaseOffsetDeg) === 0,
    `${scenario.label}: chosen direct-inject phase should be the best immediate offset in the local trade study (best offset ${bestSample.phaseOffsetDeg} deg)`,
  );
  assert(
    chosenScore >= (Number(bestSample.score) - 1e-6),
    `${scenario.label}: chosen direct-inject location should match the best local sampled score (chosen=${chosenScore}, sample=${bestSample.score})`,
  );
  assert(
    !Boolean(worstFarSample.evaluated?.ready)
      || Number(worstFarSample.evaluated?.predictedMissDistanceKm) > (Number(chosen.predictedMissDistanceKm) + 40_000)
      || Number(worstFarSample.evaluated?.bPlaneErrorKm) > (Number(chosen.bPlaneErrorKm) + 20_000),
    `${scenario.label}: offset direct-inject phases should include clearly worse immediate departure locations`,
  );
}

function main() {
  const scenarios = [
    scenarioMoonState("moon_phase_a", 0, 28_000, 0.02),
    scenarioMoonState("moon_phase_b", Math.PI / 2, -28_000, -0.02),
  ];
  for (let index = 0; index < scenarios.length; index += 1) {
    solveScenario(scenarios[index]);
  }
  console.log("PASS moon-orbit-inject-spawn-location-tradeoff-lock");
}

main();
