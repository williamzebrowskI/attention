import {
  add,
  clamp,
  dot,
  finiteVector,
  length,
  normalize,
  scale,
  subtract,
} from "../navigationMath.js";
import {
  buildMoonGuidanceSourceModel,
  burnDurationForDeltaVSec,
  estimateBPlaneErrorKm,
  propagateMoonGuidanceState,
} from "./moonDynamicsModel.js";

const DEFAULT_MOON_ORBIT_PERIOD_SEC = 27.321661 * 86400;
const DEFAULT_EARTH_RADIUS_KM = 6371;
const DEFAULT_MOON_RADIUS_KM = 1737.4;
const DEFAULT_EARTH_MASS_KG = 5.97237e24;
const DEFAULT_MOON_MASS_KG = 7.342e22;
const GLOBAL_PHASE_SAMPLES = 36;
const GLOBAL_APOAPSIS_OFFSETS_KM = [0, 12, 24, 36, 52, 72];
const GLOBAL_FINALIST_COUNT = 4;
const GLOBAL_NODE_FINALIST_COUNT = 4;
const GLOBAL_PROPAGATION_STEP_SEC = 1800;
const GLOBAL_OPTIMIZER_CACHE_LIMIT = 96;
const GLOBAL_DV_OFFSETS_KM_S = [-0.24, 0, 0.22];
const GLOBAL_RADIAL_OFFSETS = [-0.08, 0, 0.08];
const GLOBAL_NORMAL_OFFSETS = [0];
const GLOBAL_THROTTLE_DV_SCALE_KM_S = 1.15;
const GLOBAL_THROTTLE_MIN = 0.16;
const GLOBAL_THROTTLE_MAX = 0.78;
const GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2 = 0.0055;
const GLOBAL_TARGET_PERILUNE_ALTITUDE_KM = 120;
const GLOBAL_EARTH_SAFETY_MIN_ALTITUDE_KM = 130;
const STATIC_WINDOW_CACHE = new Map();

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback);
}

function cloneVector(vector) {
  if (!finiteVector(vector)) {
    return null;
  }
  return {
    x: finiteNumber(vector.x, 0),
    y: finiteNumber(vector.y, 0),
    z: finiteNumber(vector.z, 0),
  };
}

function rad(valueDeg) {
  return (Number(valueDeg) || 0) * (Math.PI / 180);
}

function deg(valueRad) {
  return (Number(valueRad) || 0) * (180 / Math.PI);
}

export function normalizeAngleZeroToTau(angleRad) {
  if (!Number.isFinite(Number(angleRad))) {
    return 0;
  }
  const tau = Math.PI * 2;
  let value = Number(angleRad) % tau;
  if (value < 0) {
    value += tau;
  }
  return value;
}

function normalizeSignedAnglePi(angleRad) {
  const tau = Math.PI * 2;
  let value = Number(angleRad) || 0;
  while (value > Math.PI) {
    value -= tau;
  }
  while (value < -Math.PI) {
    value += tau;
  }
  return value;
}

function quantize(value, step) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "nan";
  }
  return String(Math.round(numeric / Math.max(1e-9, Number(step) || 1)));
}

function touchStaticCache(key, value) {
  if (STATIC_WINDOW_CACHE.has(key)) {
    STATIC_WINDOW_CACHE.delete(key);
  }
  STATIC_WINDOW_CACHE.set(key, value);
  if (STATIC_WINDOW_CACHE.size <= GLOBAL_OPTIMIZER_CACHE_LIMIT) {
    return;
  }
  const oldestKey = STATIC_WINDOW_CACHE.keys().next().value;
  STATIC_WINDOW_CACHE.delete(oldestKey);
}

function cross(a, b) {
  return {
    x: ((Number(a?.y) || 0) * (Number(b?.z) || 0)) - ((Number(a?.z) || 0) * (Number(b?.y) || 0)),
    y: ((Number(a?.z) || 0) * (Number(b?.x) || 0)) - ((Number(a?.x) || 0) * (Number(b?.z) || 0)),
    z: ((Number(a?.x) || 0) * (Number(b?.y) || 0)) - ((Number(a?.y) || 0) * (Number(b?.x) || 0)),
  };
}

function projectToPlane(vector, planeNormal) {
  if (!finiteVector(vector) || !finiteVector(planeNormal)) {
    return null;
  }
  return subtract(vector, scale(planeNormal, dot(vector, planeNormal)));
}

function launchPlaneBasis(inclinationDeg = 28.5, ascendingNodeRad = 0) {
  const incRad = rad(clamp(Number(inclinationDeg) || 28.5, 0, 89.5));
  const nodeRad = normalizeAngleZeroToTau(Number(ascendingNodeRad));
  const cNode = Math.cos(nodeRad);
  const sNode = Math.sin(nodeRad);
  const e1 = { x: cNode, y: sNode, z: 0 };
  const e2 = normalize(
    { x: -sNode * Math.cos(incRad), y: cNode * Math.cos(incRad), z: Math.sin(incRad) },
    { x: -sNode, y: cNode, z: 0 },
  );
  const planeNormal = normalize(
    { x: sNode * Math.sin(incRad), y: -cNode * Math.sin(incRad), z: Math.cos(incRad) },
    { x: 0, y: 0, z: 1 },
  );
  return { e1, e2, planeNormal };
}

function launchPlanePhaseAngleRad({
  vector = null,
  inclinationDeg = 28.5,
  ascendingNodeRad = 0,
} = {}) {
  if (!finiteVector(vector)) {
    return Number.NaN;
  }
  const basis = launchPlaneBasis(inclinationDeg, ascendingNodeRad);
  const planar = projectToPlane(vector, basis.planeNormal);
  if (!finiteVector(planar)) {
    return Number.NaN;
  }
  const x = dot(planar, basis.e1);
  const y = dot(planar, basis.e2);
  if (!Number.isFinite(x) || !Number.isFinite(y) || ((x * x) + (y * y)) <= 1e-9) {
    return Number.NaN;
  }
  return normalizeAngleZeroToTau(Math.atan2(y, x));
}

function signedPlanarAngularRateRadS({
  positionKm = null,
  velocityKmS = null,
  basis = null,
} = {}) {
  if (!finiteVector(positionKm) || !finiteVector(velocityKmS) || !basis) {
    return Number.NaN;
  }
  const posPlanar = projectToPlane(positionKm, basis.planeNormal);
  const velPlanar = projectToPlane(velocityKmS, basis.planeNormal);
  if (!finiteVector(posPlanar) || !finiteVector(velPlanar)) {
    return Number.NaN;
  }
  const x = dot(posPlanar, basis.e1);
  const y = dot(posPlanar, basis.e2);
  const vx = dot(velPlanar, basis.e1);
  const vy = dot(velPlanar, basis.e2);
  const radiusSq = (x * x) + (y * y);
  if (!(radiusSq > 1e-9)) {
    return Number.NaN;
  }
  return ((x * vy) - (y * vx)) / radiusSq;
}

function nominalTransferTimeSec({
  startRadiusKm = Number.NaN,
  targetRadiusKm = Number.NaN,
  earthMuKm3S2 = Number.NaN,
} = {}) {
  const r1 = Number(startRadiusKm);
  const r2 = Number(targetRadiusKm);
  const mu = Number(earthMuKm3S2);
  if (!(r1 > 1000) || !(r2 > (r1 + 1)) || !(mu > 0)) {
    return Number.NaN;
  }
  const semiMajorAxis = (r1 + r2) * 0.5;
  if (!(semiMajorAxis > 0)) {
    return Number.NaN;
  }
  return Math.PI * Math.sqrt((semiMajorAxis ** 3) / mu);
}

function nominalTliDeltaVEstimateKmS({
  orbitRadiusKm = Number.NaN,
  targetRadiusKm = Number.NaN,
  earthMuKm3S2 = Number.NaN,
} = {}) {
  const r1 = Number(orbitRadiusKm);
  const r2 = Number(targetRadiusKm);
  const mu = Number(earthMuKm3S2);
  if (!(r1 > 1000) || !(r2 > (r1 + 1)) || !(mu > 0)) {
    return Number.NaN;
  }
  const semiMajorAxis = (r1 + r2) * 0.5;
  if (!(semiMajorAxis > 0)) {
    return Number.NaN;
  }
  const vCircular = Math.sqrt(mu / r1);
  const vTransfer = Math.sqrt(mu * ((2 / r1) - (1 / semiMajorAxis)));
  return Math.max(0, vTransfer - vCircular);
}

function buildOrbitCandidateState({
  earthState = null,
  earthRadiusKm = DEFAULT_EARTH_RADIUS_KM,
  earthMuKm3S2 = Number.NaN,
  inclinationDeg = 28.5,
  ascendingNodeRad = 0,
  periapsisAltitudeKm = 185,
  apoapsisAltitudeKm = 220,
  phaseRad = 0,
} = {}) {
  if (!finiteVector(earthState?.position) || !(Number(earthMuKm3S2) > 0)) {
    return null;
  }
  const basis = launchPlaneBasis(inclinationDeg, ascendingNodeRad);
  const periAltitudeKm = Math.max(120, Number(periapsisAltitudeKm) || 185);
  const apoAltitudeKm = Math.max(periAltitudeKm, Number(apoapsisAltitudeKm) || periAltitudeKm);
  const periRadiusKm = Math.max(1000, Number(earthRadiusKm) || DEFAULT_EARTH_RADIUS_KM) + periAltitudeKm;
  const apoRadiusKm = Math.max(periRadiusKm, (Number(earthRadiusKm) || DEFAULT_EARTH_RADIUS_KM) + apoAltitudeKm);
  const semiMajorAxisKm = (periRadiusKm + apoRadiusKm) * 0.5;
  const truePhaseRad = normalizeAngleZeroToTau(Number(phaseRad) || 0);
  const trueAnomaly = truePhaseRad;
  const eccentricity = clamp((apoRadiusKm - periRadiusKm) / Math.max(1e-9, apoRadiusKm + periRadiusKm), 0, 0.85);
  const radiusKm = (semiMajorAxisKm * (1 - (eccentricity ** 2))) / Math.max(1e-9, 1 + (eccentricity * Math.cos(trueAnomaly)));
  if (!(radiusKm > 1000)) {
    return null;
  }
  const cTheta = Math.cos(trueAnomaly);
  const sTheta = Math.sin(trueAnomaly);
  const relPositionKm = add(
    scale(basis.e1, radiusKm * cTheta),
    scale(basis.e2, radiusKm * sTheta),
  );
  const p = semiMajorAxisKm * (1 - (eccentricity ** 2));
  const orbitalSpeedFactor = Math.sqrt(Number(earthMuKm3S2) / Math.max(1e-9, p));
  const perifocalVelocity = {
    x: -orbitalSpeedFactor * sTheta,
    y: orbitalSpeedFactor * (eccentricity + cTheta),
    z: 0,
  };
  const relVelocityKmS = add(
    scale(basis.e1, perifocalVelocity.x),
    scale(basis.e2, perifocalVelocity.y),
  );
  return {
    basis,
    phaseRad: truePhaseRad,
    periapsisAltitudeKm: periAltitudeKm,
    apoapsisAltitudeKm: apoAltitudeKm,
    positionKm: add(earthState.position, relPositionKm),
    velocityKmS: add(earthState.velocity || { x: 0, y: 0, z: 0 }, relVelocityKmS),
    relPositionKm,
    relVelocityKmS,
    velocityDirection: normalize(relVelocityKmS, basis.e2),
  };
}

function cheapCandidateGeometry({
  earthState = null,
  moonRelPosKm = null,
  moonRelVelKmS = null,
  earthMuKm3S2 = Number.NaN,
  earthRadiusKm = DEFAULT_EARTH_RADIUS_KM,
  inclinationDeg = 28.5,
  ascendingNodeRad = 0,
  periapsisAltitudeKm = 185,
  apoapsisAltitudeKm = 220,
  phaseRad = 0,
} = {}) {
  const candidateState = buildOrbitCandidateState({
    earthState,
    earthRadiusKm,
    earthMuKm3S2,
    inclinationDeg,
    ascendingNodeRad,
    periapsisAltitudeKm,
    apoapsisAltitudeKm,
    phaseRad,
  });
  if (!candidateState || !finiteVector(moonRelPosKm)) {
    return null;
  }
  const shipToMoonNow = subtract(add(earthState.position, moonRelPosKm), candidateState.positionKm);
  const shipToMoonDirection = normalize(shipToMoonNow, candidateState.velocityDirection);
  const basis = candidateState.basis;
  const signedRateRadS = signedPlanarAngularRateRadS({
    positionKm: moonRelPosKm,
    velocityKmS: moonRelVelKmS,
    basis,
  });
  const moonRateRadS = Number.isFinite(signedRateRadS)
    ? signedRateRadS
    : ((Math.PI * 2) / DEFAULT_MOON_ORBIT_PERIOD_SEC);
  const shipRadiusKm = length(candidateState.relPositionKm);
  const transferTimeSec = nominalTransferTimeSec({
    startRadiusKm: shipRadiusKm,
    targetRadiusKm: length(moonRelPosKm),
    earthMuKm3S2,
  });
  const projectedMoonRelPos = finiteVector(moonRelVelKmS) && Number.isFinite(transferTimeSec)
    ? add(moonRelPosKm, scale(moonRelVelKmS, transferTimeSec))
    : moonRelPosKm;
  const projectedMoonDirection = normalize(
    subtract(add(earthState.position, projectedMoonRelPos), candidateState.positionKm),
    shipToMoonDirection,
  );
  const alignNow = clamp(dot(candidateState.velocityDirection, shipToMoonDirection), -1, 1);
  const alignProjected = clamp(dot(candidateState.velocityDirection, projectedMoonDirection), -1, 1);
  const planeQuality = clamp(1 - Math.abs(dot(shipToMoonDirection, basis.planeNormal)), 0, 1);
  const energyBonus = clamp((Number(apoapsisAltitudeKm) - Number(periapsisAltitudeKm)) / 90, 0, 1);
  const score = clamp(
    (((alignNow + 1) * 0.5) * 0.38)
    + (((alignProjected + 1) * 0.5) * 0.42)
    + (planeQuality * 0.14)
    + (energyBonus * 0.06),
    0,
    1,
  );
  return {
    ...candidateState,
    transferTimeSec,
    alignNow,
    alignProjected,
    planeQuality,
    geometryScore: score,
  };
}

function combineBasis({ primaryDir, radialDir, normalDir, radialWeight = 0, normalWeight = 0 }) {
  return normalize(
    add(
      scale(primaryDir, 1),
      add(scale(radialDir, radialWeight), scale(normalDir, normalWeight)),
    ),
    primaryDir,
  );
}

function evaluatePropagatedDepartureCandidate({
  sources = null,
  spacecraft = null,
  candidate = null,
  nominalDeltaVKmS = Number.NaN,
  targetPeriluneAltitudeKm = GLOBAL_TARGET_PERILUNE_ALTITUDE_KM,
  earthSafetyMinAltitudeKm = GLOBAL_EARTH_SAFETY_MIN_ALTITUDE_KM,
} = {}) {
  if (!sources || !candidate) {
    return null;
  }
  const toMoon = normalize(subtract(sources.moon.positionKm, candidate.positionKm), candidate.velocityDirection);
  const tangent = normalize(candidate.velocityKmS, candidate.velocityDirection);
  const radialOut = normalize(subtract(candidate.positionKm, sources.earth.positionKm), tangent);
  const planeNormal = normalize(cross(subtract(candidate.positionKm, sources.earth.positionKm), subtract(candidate.velocityKmS, sources.earth.velocityKmS || { x: 0, y: 0, z: 0 })), { x: 0, y: 0, z: 1 });
  const primaryDir = normalize(add(scale(tangent, 0.82), scale(toMoon, 0.18)), tangent);
  const transferTimeSec = Number.isFinite(Number(candidate.transferTimeSec))
    ? Math.max(72 * 3600, Number(candidate.transferTimeSec) * 1.2)
    : (96 * 3600);
  const nominalDv = Math.max(0.2, Number(nominalDeltaVKmS) || 3.15);
  let best = null;

  for (let dvIndex = 0; dvIndex < GLOBAL_DV_OFFSETS_KM_S.length; dvIndex += 1) {
    const deltaVNeedKmS = Math.max(0.2, nominalDv + GLOBAL_DV_OFFSETS_KM_S[dvIndex]);
    const throttle = clamp(
      deltaVNeedKmS / GLOBAL_THROTTLE_DV_SCALE_KM_S,
      GLOBAL_THROTTLE_MIN,
      GLOBAL_THROTTLE_MAX,
    );
    const burnDurationSec = burnDurationForDeltaVSec(
      deltaVNeedKmS,
      GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2,
      throttle,
    );
    for (let radialIndex = 0; radialIndex < GLOBAL_RADIAL_OFFSETS.length; radialIndex += 1) {
      for (let normalIndex = 0; normalIndex < GLOBAL_NORMAL_OFFSETS.length; normalIndex += 1) {
        const burnDirection = combineBasis({
          primaryDir,
          radialDir: radialOut,
          normalDir: planeNormal,
          radialWeight: GLOBAL_RADIAL_OFFSETS[radialIndex],
          normalWeight: GLOBAL_NORMAL_OFFSETS[normalIndex],
        });
        const propagation = propagateMoonGuidanceState({
          initialState: {
            positionKm: candidate.positionKm,
            velocityKmS: candidate.velocityKmS,
          },
          durationSec: transferTimeSec,
          stepSec: GLOBAL_PROPAGATION_STEP_SEC,
          sources,
          spacecraft,
          burnCommand: {
            direction: burnDirection,
            throttle,
            accelAtThrottle1KmS2: GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2,
            burnDurationSec,
          },
        });
        if (!propagation) {
          continue;
        }
        const closestMoonRelPos = finiteVector(propagation.closestMoonState?.positionKm)
          ? subtract(propagation.closestMoonState.positionKm, sources.moon.positionKm)
          : null;
        const closestMoonRelVel = finiteVector(propagation.closestMoonState?.velocityKmS)
          ? subtract(propagation.closestMoonState.velocityKmS, sources.moon.velocityKmS)
          : null;
        const predictedMissDistanceKm = Number.isFinite(propagation.minMoonDistanceKm)
          ? propagation.minMoonDistanceKm
          : Number.POSITIVE_INFINITY;
        const predictedPeriluneAltitudeKm = Number.isFinite(propagation.minMoonAltitudeKm)
          ? propagation.minMoonAltitudeKm
          : Number.POSITIVE_INFINITY;
        const bPlaneErrorKm = estimateBPlaneErrorKm({
          relativePositionKm: closestMoonRelPos,
          relativeVelocityKmS: closestMoonRelVel,
          targetPeriluneAltitudeKm,
          bodyRadiusKm: Number(sources.moon?.radiusKm) || DEFAULT_MOON_RADIUS_KM,
        });
        const safetyAltitudeKm = Number.isFinite(propagation.minEarthAltitudeKm)
          ? propagation.minEarthAltitudeKm
          : Number.NaN;
        const safetyRiskKm = Number.isFinite(safetyAltitudeKm)
          ? Math.max(0, earthSafetyMinAltitudeKm - safetyAltitudeKm)
          : earthSafetyMinAltitudeKm;
        const closingPenalty = Number.isFinite(propagation.closestMoonClosingSpeedKmS)
          ? Math.max(0, -Number(propagation.closestMoonClosingSpeedKmS)) * 10_000
          : 5_000;
        const escapePenalty = Number.isFinite(propagation.finalMoonDistanceKm)
          ? Math.max(0, propagation.finalMoonDistanceKm - predictedMissDistanceKm) * 0.08
          : 0;
        const cost = (
          predictedMissDistanceKm
          + (Math.abs(predictedPeriluneAltitudeKm - targetPeriluneAltitudeKm) * 0.85)
          + ((Number.isFinite(bPlaneErrorKm) ? bPlaneErrorKm : predictedMissDistanceKm) * 0.6)
          + (safetyRiskKm * 8_000)
          + closingPenalty
          + escapePenalty
          + (deltaVNeedKmS * 650)
        );
        const projectedAlignment = finiteVector(closestMoonRelPos)
          ? clamp(dot(burnDirection, normalize(closestMoonRelPos, burnDirection)), -1, 1)
          : candidate.alignProjected;
        const evaluated = {
          cost,
          throttle,
          burnDurationSec,
          deltaVNeedKmS,
          burnDirection,
          predictedMissDistanceKm,
          predictedPeriluneAltitudeKm,
          bPlaneErrorKm,
          safetyAltitudeKm,
          projectedAlignment,
          propagation,
        };
        if (!best || evaluated.cost < best.cost) {
          best = evaluated;
        }
      }
    }
  }
  return best;
}

function buildStaticWindowSolve({
  earthState = null,
  moonState = null,
  inclinationDeg = 28.5,
  ascendingNodeRad = 0,
  orbitAltitudeKm = 185,
  earthRadiusKm = DEFAULT_EARTH_RADIUS_KM,
  earthMuKm3S2 = Number.NaN,
} = {}) {
  if (!finiteVector(earthState?.position) || !finiteVector(moonState?.position)) {
    return null;
  }
  const moonRelPosKm = subtract(moonState.position, earthState.position);
  const moonRelVelKmS = finiteVector(moonState?.velocity) && finiteVector(earthState?.velocity)
    ? subtract(moonState.velocity, earthState.velocity)
    : { x: 0, y: 0, z: 0 };
  const sources = buildMoonGuidanceSourceModel({
    targetVectors: {
      moonEarthPositionKm: moonRelPosKm,
      moonEarthVelocityKmS: moonRelVelKmS,
    },
    metrics: {
      earthMassKg: Number(earthMuKm3S2) > 0
        ? (Number(earthMuKm3S2) / 6.67430e-20)
        : DEFAULT_EARTH_MASS_KG,
      earthRadiusKm,
      moonMassKg: Number(moonState?.massKg) || DEFAULT_MOON_MASS_KG,
      moonRadiusKm: DEFAULT_MOON_RADIUS_KM,
    },
    plannerConfig: {
      moonClosedLoopPropagationStepSec: GLOBAL_PROPAGATION_STEP_SEC,
    },
  });
  const spacecraft = {
    bodyId: "moon_departure_optimizer_vehicle",
    massKg: 1_250_000,
    radiusKm: 0.0045,
    reflectivityCoeff: 1.45,
  };
  const orbitRadiusKm = Math.max(1000, Number(earthRadiusKm) || DEFAULT_EARTH_RADIUS_KM) + Math.max(120, Number(orbitAltitudeKm) || 185);
  const nominalTransferSec = nominalTransferTimeSec({
    startRadiusKm: orbitRadiusKm,
    targetRadiusKm: length(moonRelPosKm),
    earthMuKm3S2,
  });
  const nominalDeltaVKmS = nominalTliDeltaVEstimateKmS({
    orbitRadiusKm,
    targetRadiusKm: length(moonRelPosKm),
    earthMuKm3S2,
  });

  const cheapCandidates = [];
  for (let phaseIndex = 0; phaseIndex < GLOBAL_PHASE_SAMPLES; phaseIndex += 1) {
    const phaseRad = (phaseIndex / GLOBAL_PHASE_SAMPLES) * (Math.PI * 2);
    for (let apoIndex = 0; apoIndex < GLOBAL_APOAPSIS_OFFSETS_KM.length; apoIndex += 1) {
      const apoapsisAltitudeKm = Math.max(
        Number(orbitAltitudeKm) || 185,
        (Number(orbitAltitudeKm) || 185) + GLOBAL_APOAPSIS_OFFSETS_KM[apoIndex],
      );
      const cheap = cheapCandidateGeometry({
        earthState,
        moonRelPosKm,
        moonRelVelKmS,
        earthMuKm3S2,
        earthRadiusKm,
        inclinationDeg,
        ascendingNodeRad,
        periapsisAltitudeKm: orbitAltitudeKm,
        apoapsisAltitudeKm,
        phaseRad,
      });
      if (cheap) {
        cheapCandidates.push(cheap);
      }
    }
  }
  cheapCandidates.sort((a, b) => Number(b.geometryScore) - Number(a.geometryScore));
  const finalists = cheapCandidates.slice(0, GLOBAL_FINALIST_COUNT);

  let best = null;
  for (let index = 0; index < finalists.length; index += 1) {
    const evaluated = evaluatePropagatedDepartureCandidate({
      sources,
      spacecraft,
      candidate: finalists[index],
      nominalDeltaVKmS,
    });
    if (evaluated && (!best || evaluated.cost < best.cost)) {
      best = {
        cheap: finalists[index],
        evaluated,
      };
    }
  }

  if (best?.cheap) {
    const phaseStepRad = (Math.PI * 2) / GLOBAL_PHASE_SAMPLES;
    let phaseRefineStepRad = phaseStepRad / 4;
    let apoRefineStepKm = 12;
    for (let pass = 0; pass < 4; pass += 1) {
      const localPhaseOffsets = [-phaseRefineStepRad, 0, phaseRefineStepRad];
      const localApoOffsetsKm = [-apoRefineStepKm, 0, apoRefineStepKm];
      for (let phaseIndex = 0; phaseIndex < localPhaseOffsets.length; phaseIndex += 1) {
        for (let apoIndex = 0; apoIndex < localApoOffsetsKm.length; apoIndex += 1) {
          const localCheap = cheapCandidateGeometry({
            earthState,
            moonRelPosKm,
            moonRelVelKmS,
            earthMuKm3S2,
            earthRadiusKm,
            inclinationDeg,
            ascendingNodeRad,
            periapsisAltitudeKm: orbitAltitudeKm,
            apoapsisAltitudeKm: Math.max(
              Number(orbitAltitudeKm) || 185,
              Number(best.cheap.apoapsisAltitudeKm) + localApoOffsetsKm[apoIndex],
            ),
            phaseRad: normalizeAngleZeroToTau(Number(best.cheap.phaseRad) + localPhaseOffsets[phaseIndex]),
          });
          if (!localCheap) {
            continue;
          }
          const evaluated = evaluatePropagatedDepartureCandidate({
            sources,
            spacecraft,
            candidate: localCheap,
            nominalDeltaVKmS,
          });
          if (evaluated && (!best || evaluated.cost < best.evaluated.cost)) {
            best = {
              cheap: localCheap,
              evaluated,
            };
          }
        }
      }
      phaseRefineStepRad /= 4;
      apoRefineStepKm = Math.max(1, apoRefineStepKm / 2);
    }
  }

  const selected = best?.cheap || cheapCandidates[0] || null;
  const evaluated = best?.evaluated || null;
  if (!selected) {
    return {
      valid: false,
      optimizerMode: "global-nbody-optimal-departure",
    };
  }

  const targetPhaseRad = Number(selected.phaseRad);
  const moonPhaseRad = launchPlanePhaseAngleRad({
    vector: moonRelPosKm,
    inclinationDeg,
    ascendingNodeRad,
  });
  const leadAngleDeg = Number.isFinite(moonPhaseRad)
    ? deg(normalizeSignedAnglePi(targetPhaseRad - (moonPhaseRad - (Math.PI * 0.5))))
    : Number.NaN;
  const baseCost = Number(evaluated?.cost);
  const optimalityScore = Number.isFinite(baseCost)
    ? clamp(1 / (1 + (baseCost / 220_000)), 0, 1)
    : clamp(Number(selected.geometryScore) || 0, 0, 1);
  return {
    valid: true,
    optimizerMode: "global-nbody-optimal-departure",
    targetPhaseRad,
    transferTimeSec: Number.isFinite(Number(selected.transferTimeSec))
      ? Number(selected.transferTimeSec)
      : nominalTransferSec,
    leadAngleDeg,
    estimatedTliDeltaVKmS: Number.isFinite(Number(evaluated?.deltaVNeedKmS))
      ? Number(evaluated.deltaVNeedKmS)
      : nominalDeltaVKmS,
    windowScore: optimalityScore,
    optimalityScore,
    geometryScore: clamp(Number(selected.geometryScore) || 0, 0, 1),
    selectedDepartureAlignment: Number(selected.alignNow),
    selectedProjectedAlignment: Number.isFinite(Number(evaluated?.projectedAlignment))
      ? Number(evaluated.projectedAlignment)
      : Number(selected.alignProjected),
    selectedPlaneQuality: Number(selected.planeQuality),
    optimizedApoapsisAltitudeKm: Number(selected.apoapsisAltitudeKm),
    predictedMissDistanceKm: Number.isFinite(Number(evaluated?.predictedMissDistanceKm))
      ? Number(evaluated.predictedMissDistanceKm)
      : Number.NaN,
    predictedPeriluneAltitudeKm: Number.isFinite(Number(evaluated?.predictedPeriluneAltitudeKm))
      ? Number(evaluated.predictedPeriluneAltitudeKm)
      : Number.NaN,
    bPlaneErrorKm: Number.isFinite(Number(evaluated?.bPlaneErrorKm))
      ? Number(evaluated.bPlaneErrorKm)
      : Number.NaN,
    optimizedThrottle: Number.isFinite(Number(evaluated?.throttle))
      ? Number(evaluated.throttle)
      : Number.NaN,
    optimizedBurnDurationSec: Number.isFinite(Number(evaluated?.burnDurationSec))
      ? Number(evaluated.burnDurationSec)
      : Number.NaN,
    optimizedBurnDirection: cloneVector(evaluated?.burnDirection),
    departureCost: Number.isFinite(baseCost) ? baseCost : Number.NaN,
    staticMoonPhaseRad: Number.isFinite(moonPhaseRad) ? moonPhaseRad : Number.NaN,
  };
}

function staticWindowCacheKey({
  earthState = null,
  moonState = null,
  inclinationDeg = 28.5,
  ascendingNodeRad = 0,
  orbitAltitudeKm = 185,
  earthRadiusKm = DEFAULT_EARTH_RADIUS_KM,
  earthMuKm3S2 = Number.NaN,
} = {}) {
  const moonRelPosKm = finiteVector(earthState?.position) && finiteVector(moonState?.position)
    ? subtract(moonState.position, earthState.position)
    : null;
  const moonRelVelKmS = finiteVector(moonState?.velocity) && finiteVector(earthState?.velocity)
    ? subtract(moonState.velocity, earthState.velocity)
    : null;
  return [
    quantize(inclinationDeg, 0.01),
    quantize(ascendingNodeRad, 0.0005),
    quantize(orbitAltitudeKm, 0.25),
    quantize(earthRadiusKm, 0.1),
    quantize(earthMuKm3S2, 0.25),
    quantize(moonRelPosKm?.x, 250),
    quantize(moonRelPosKm?.y, 250),
    quantize(moonRelPosKm?.z, 250),
    quantize(moonRelVelKmS?.x, 0.0025),
    quantize(moonRelVelKmS?.y, 0.0025),
    quantize(moonRelVelKmS?.z, 0.0025),
  ].join("|");
}

function solveStaticMoonDepartureWindow(options = {}) {
  const cacheKey = staticWindowCacheKey(options);
  if (STATIC_WINDOW_CACHE.has(cacheKey)) {
    return STATIC_WINDOW_CACHE.get(cacheKey);
  }
  const solved = buildStaticWindowSolve(options);
  touchStaticCache(cacheKey, solved);
  return solved;
}

function bestCheapNodeCandidate({
  earthState = null,
  moonState = null,
  inclinationDeg = 28.5,
  orbitAltitudeKm = 185,
  earthRadiusKm = DEFAULT_EARTH_RADIUS_KM,
  earthMuKm3S2 = Number.NaN,
  ascendingNodeRad = 0,
} = {}) {
  if (!finiteVector(earthState?.position) || !finiteVector(moonState?.position)) {
    return null;
  }
  const moonRelPosKm = subtract(moonState.position, earthState.position);
  const moonRelVelKmS = finiteVector(moonState?.velocity) && finiteVector(earthState?.velocity)
    ? subtract(moonState.velocity, earthState.velocity)
    : { x: 0, y: 0, z: 0 };
  let best = null;
  for (let phaseIndex = 0; phaseIndex < GLOBAL_PHASE_SAMPLES; phaseIndex += 1) {
    const phaseRad = (phaseIndex / GLOBAL_PHASE_SAMPLES) * (Math.PI * 2);
    for (let apoIndex = 0; apoIndex < GLOBAL_APOAPSIS_OFFSETS_KM.length; apoIndex += 1) {
      const apoapsisAltitudeKm = Math.max(
        Number(orbitAltitudeKm) || 185,
        (Number(orbitAltitudeKm) || 185) + GLOBAL_APOAPSIS_OFFSETS_KM[apoIndex],
      );
      const candidate = cheapCandidateGeometry({
        earthState,
        moonRelPosKm,
        moonRelVelKmS,
        earthMuKm3S2,
        earthRadiusKm,
        inclinationDeg,
        ascendingNodeRad,
        periapsisAltitudeKm: orbitAltitudeKm,
        apoapsisAltitudeKm,
        phaseRad,
      });
      if (candidate && (!best || candidate.geometryScore > best.geometryScore)) {
        best = candidate;
      }
    }
  }
  return best;
}

export function solveMoonDepartureWindow({
  earthState = null,
  moonState = null,
  shipPositionKm = null,
  inclinationDeg = 28.5,
  ascendingNodeRad = 0,
  orbitAltitudeKm = 150,
  earthRadiusKm = DEFAULT_EARTH_RADIUS_KM,
  earthMuKm3S2 = Number.NaN,
  padAngularRateRadS = Number.NaN,
  phaseToleranceDeg = 3.5,
} = {}) {
  if (!finiteVector(earthState?.position) || !finiteVector(moonState?.position)) {
    return {
      valid: false,
      ready: true,
      reason: "missing-state",
      targetPhaseRad: Number.NaN,
      currentPhaseRad: Number.NaN,
      phaseErrorRad: Number.NaN,
      phaseErrorDeg: Number.NaN,
      waitSec: Number.NaN,
      transferTimeSec: Number.NaN,
      leadAngleDeg: Number.NaN,
      estimatedTliDeltaVKmS: Number.NaN,
      windowScore: Number.NaN,
      geometryScore: Number.NaN,
      selectedDepartureAlignment: Number.NaN,
      selectedProjectedAlignment: Number.NaN,
      selectedPlaneQuality: Number.NaN,
      toleranceDeg: Math.max(0.1, Number(phaseToleranceDeg) || 3.5),
      optimizerMode: "global-nbody-optimal-departure",
    };
  }

  const staticWindow = solveStaticMoonDepartureWindow({
    earthState,
    moonState,
    inclinationDeg,
    ascendingNodeRad,
    orbitAltitudeKm,
    earthRadiusKm,
    earthMuKm3S2,
  });

  const moonRelPosKm = subtract(moonState.position, earthState.position);
  const moonRelVelKmS = finiteVector(moonState?.velocity) && finiteVector(earthState?.velocity)
    ? subtract(moonState.velocity, earthState.velocity)
    : null;
  const basis = launchPlaneBasis(inclinationDeg, ascendingNodeRad);
  const signedRateRadS = signedPlanarAngularRateRadS({
    positionKm: moonRelPosKm,
    velocityKmS: moonRelVelKmS,
    basis,
  });
  const moonRateRadS = Number.isFinite(signedRateRadS)
    ? signedRateRadS
    : ((Math.PI * 2) / DEFAULT_MOON_ORBIT_PERIOD_SEC);
  const currentPhaseRad = launchPlanePhaseAngleRad({
    vector: finiteVector(shipPositionKm)
      ? subtract(shipPositionKm, earthState.position)
      : null,
    inclinationDeg,
    ascendingNodeRad,
  });
  const phaseErrorRad = (
    Number.isFinite(Number(staticWindow?.targetPhaseRad)) && Number.isFinite(currentPhaseRad)
      ? normalizeSignedAnglePi(Number(staticWindow.targetPhaseRad) - currentPhaseRad)
      : Number.NaN
  );
  const phaseRateErrRadS = (
    Number.isFinite(Number(padAngularRateRadS)) && Number.isFinite(moonRateRadS)
      ? (Number(padAngularRateRadS) - moonRateRadS)
      : Number.NaN
  );
  const waitSec = (
    Number.isFinite(phaseErrorRad) && Number.isFinite(phaseRateErrRadS)
      ? (
        Math.abs(phaseRateErrRadS) > 1e-10
          ? Math.min(
            Math.abs(phaseErrorRad),
            (Math.PI * 2) - Math.abs(phaseErrorRad),
          ) / Math.abs(phaseRateErrRadS)
          : Number.POSITIVE_INFINITY
      )
      : Number.NaN
  );
  const toleranceDeg = Math.max(0.1, Number(phaseToleranceDeg) || 3.5);
  const phaseErrorDeg = Number.isFinite(phaseErrorRad)
    ? deg(phaseErrorRad)
    : Number.NaN;
  const ready = !Number.isFinite(phaseErrorDeg)
    || Math.abs(phaseErrorDeg) <= toleranceDeg;
  const scoreFromError = Number.isFinite(phaseErrorDeg)
    ? clamp(1 - (Math.abs(phaseErrorDeg) / Math.max(1e-9, toleranceDeg * 3.5)), 0, 1)
    : 0;
  const scoreFromWait = Number.isFinite(waitSec)
    ? clamp(1 - (waitSec / (4 * 3600)), 0, 1)
    : 0;
  const staticScore = clamp(Number(staticWindow?.windowScore) || 0, 0, 1);
  const windowScore = clamp(
    (staticScore * 0.6)
    + (scoreFromError * 0.25)
    + (scoreFromWait * 0.15),
    0,
    1,
  );

  return {
    valid: Boolean(staticWindow?.valid),
    ready,
    reason: ready ? "window-ready" : "window-offset",
    targetPhaseRad: Number(staticWindow?.targetPhaseRad),
    currentPhaseRad,
    phaseErrorRad,
    phaseErrorDeg,
    waitSec,
    transferTimeSec: Number(staticWindow?.transferTimeSec),
    leadAngleDeg: Number(staticWindow?.leadAngleDeg),
    estimatedTliDeltaVKmS: Number(staticWindow?.estimatedTliDeltaVKmS),
    windowScore,
    optimalityScore: finiteNumber(staticWindow?.optimalityScore, Number.NaN),
    geometryScore: Number(staticWindow?.geometryScore),
    selectedDepartureAlignment: Number(staticWindow?.selectedDepartureAlignment),
    selectedProjectedAlignment: Number(staticWindow?.selectedProjectedAlignment),
    selectedPlaneQuality: Number(staticWindow?.selectedPlaneQuality),
    optimizedApoapsisAltitudeKm: Number(staticWindow?.optimizedApoapsisAltitudeKm),
    predictedMissDistanceKm: finiteNumber(staticWindow?.predictedMissDistanceKm, Number.NaN),
    predictedPeriluneAltitudeKm: finiteNumber(staticWindow?.predictedPeriluneAltitudeKm, Number.NaN),
    bPlaneErrorKm: finiteNumber(staticWindow?.bPlaneErrorKm, Number.NaN),
    optimizedThrottle: finiteNumber(staticWindow?.optimizedThrottle, Number.NaN),
    optimizedBurnDurationSec: finiteNumber(staticWindow?.optimizedBurnDurationSec, Number.NaN),
    optimizedBurnDirection: cloneVector(staticWindow?.optimizedBurnDirection),
    departureCost: finiteNumber(staticWindow?.departureCost, Number.NaN),
    toleranceDeg,
    optimizerMode: String(staticWindow?.optimizerMode || "global-nbody-optimal-departure"),
  };
}

export function solveBestMoonOrbitInjectWindow({
  nodeSamples = 180,
  ...options
} = {}) {
  const sampleCount = clamp(Math.round(Number(nodeSamples) || 180), 24, 720);
  const cheapNodes = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const ascendingNodeRad = (index / sampleCount) * (Math.PI * 2);
    const cheap = bestCheapNodeCandidate({
      ...options,
      ascendingNodeRad,
    });
    if (cheap) {
      cheapNodes.push({
        ascendingNodeRad,
        geometryScore: Number(cheap.geometryScore) || 0,
        planeQuality: Number(cheap.planeQuality) || 0,
      });
    }
  }
  cheapNodes.sort((a, b) => ((b.geometryScore * 0.75) + (b.planeQuality * 0.25)) - ((a.geometryScore * 0.75) + (a.planeQuality * 0.25)));
  const finalists = cheapNodes.slice(0, Math.min(GLOBAL_NODE_FINALIST_COUNT, cheapNodes.length));
  const zeroNodeCandidate = cheapNodes.find(
    (entry) => Math.abs(normalizeSignedAnglePi(Number(entry.ascendingNodeRad) || 0)) <= 1e-9,
  );
  if (
    zeroNodeCandidate
    && !finalists.some(
      (entry) => Math.abs(normalizeSignedAnglePi(Number(entry.ascendingNodeRad) - Number(zeroNodeCandidate.ascendingNodeRad))) <= 1e-9,
    )
  ) {
    finalists.push(zeroNodeCandidate);
  }

  let bestWindow = null;
  let bestCompositeScore = -1;
  const scoreWindow = (window) => (
    (clamp(Number(window?.optimalityScore) || 0, 0, 1) * 0.7)
    + (clamp(Number(window?.geometryScore) || 0, 0, 1) * 0.2)
    + (clamp(Number(window?.selectedPlaneQuality) || 0, 0, 1) * 0.1)
  );

  for (let index = 0; index < finalists.length; index += 1) {
    const ascendingNodeRad = finalists[index].ascendingNodeRad;
    const solved = solveMoonDepartureWindow({
      ...options,
      ascendingNodeRad,
    });
    const compositeScore = scoreWindow(solved);
    if (compositeScore <= bestCompositeScore) {
      continue;
    }
    bestCompositeScore = compositeScore;
    bestWindow = {
      ...solved,
      ascendingNodeRad,
      planeCompositeScore: compositeScore,
      nodeSamples: sampleCount,
    };
  }

  if (bestWindow) {
    const nodeStepRad = (Math.PI * 2) / sampleCount;
    const refineOffsets = [-nodeStepRad / 3, -nodeStepRad / 6, nodeStepRad / 6, nodeStepRad / 3];
    for (let index = 0; index < refineOffsets.length; index += 1) {
      const solved = solveMoonDepartureWindow({
        ...options,
        ascendingNodeRad: normalizeAngleZeroToTau(Number(bestWindow.ascendingNodeRad) + refineOffsets[index]),
      });
      const compositeScore = scoreWindow(solved);
      if (compositeScore <= bestCompositeScore) {
        continue;
      }
      bestCompositeScore = compositeScore;
      bestWindow = {
        ...solved,
        ascendingNodeRad: normalizeAngleZeroToTau(Number(bestWindow.ascendingNodeRad) + refineOffsets[index]),
        planeCompositeScore: compositeScore,
        nodeSamples: sampleCount,
      };
    }
    return bestWindow;
  }
  return {
    ...solveMoonDepartureWindow(options),
    ascendingNodeRad: 0,
    planeCompositeScore: Number.NaN,
    nodeSamples: sampleCount,
  };
}

export function computeMoonOrbitInjectPhaseAngleRad(options = {}) {
  const solved = solveMoonDepartureWindow(options);
  if (!Number.isFinite(Number(solved.targetPhaseRad))) {
    return 0;
  }
  return Number(solved.targetPhaseRad);
}

export function evaluateMoonPadLaunchWindow(options = {}) {
  const solved = solveMoonDepartureWindow(options);
  return {
    ready: Boolean(solved.ready),
    valid: Boolean(solved.valid),
    reason: String(solved.reason || ""),
    targetPhaseRad: solved.targetPhaseRad,
    currentPhaseRad: solved.currentPhaseRad,
    phaseErrorRad: solved.phaseErrorRad,
    phaseErrorDeg: solved.phaseErrorDeg,
    toleranceDeg: solved.toleranceDeg,
    waitSec: solved.waitSec,
    transferTimeSec: solved.transferTimeSec,
    leadAngleDeg: solved.leadAngleDeg,
    estimatedTliDeltaVKmS: solved.estimatedTliDeltaVKmS,
    windowScore: solved.windowScore,
    optimalityScore: solved.optimalityScore,
    optimizedApoapsisAltitudeKm: solved.optimizedApoapsisAltitudeKm,
    optimizerMode: solved.optimizerMode,
  };
}
