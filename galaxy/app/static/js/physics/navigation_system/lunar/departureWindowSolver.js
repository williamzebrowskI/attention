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
  burnDurationForDeltaVSec,
  estimateBPlaneErrorKm,
  propagateMoonGuidanceState,
} from "../../runtime/lunarPropagation.js";
import { buildMoonGuidanceSourceModel } from "../../runtime/lunarSourceModel.js";
import { evaluateMoonDepartureCorridor } from "./moonDepartureCorridor.js";
import { NAVIGATION_DEFAULTS } from "../navigationSystemConfig.js";

const DEFAULT_MOON_ORBIT_PERIOD_SEC = 27.321661 * 86400;
const DEFAULT_EARTH_RADIUS_KM = 6371.0084;
const DEFAULT_MOON_RADIUS_KM = 1737.4;
const DEFAULT_EARTH_MASS_KG = 5.97237e24;
const DEFAULT_MOON_MASS_KG = 7.342e22;
const GLOBAL_PHASE_SAMPLES = 48;
const GLOBAL_APOAPSIS_OFFSETS_KM = [0, 12, 24, 36, 52, 72, 96, 128, 168];
const GLOBAL_FINALIST_COUNT = 8;
const GLOBAL_NODE_FINALIST_COUNT = 8;
const GLOBAL_PROPAGATION_STEP_SEC = 1800;
const GLOBAL_OPTIMIZER_CACHE_LIMIT = 96;
const GLOBAL_DV_OFFSETS_KM_S = [-0.34, 0, 0.28];
const GLOBAL_RADIAL_OFFSETS = [-0.18, -0.08, 0, 0.08, 0.18];
const GLOBAL_NORMAL_OFFSETS = [-0.08, -0.04, 0, 0.04, 0.08];
const GLOBAL_AGGRESSIVE_DV_OFFSETS_KM_S = [-0.28, -0.14, 0, 0.14, 0.28];
const GLOBAL_AGGRESSIVE_RADIAL_OFFSETS = [-0.16, -0.08, -0.03, 0, 0.03, 0.08, 0.16];
const GLOBAL_AGGRESSIVE_NORMAL_OFFSETS = [-0.12, -0.06, 0, 0.06, 0.12];
const GLOBAL_AGGRESSIVE_PHASE_OFFSETS_SCALE = [-1, -0.5, -0.25, 0, 0.25, 0.5, 1];
const GLOBAL_AGGRESSIVE_APOAPSIS_OFFSETS_KM = [-48, -24, 0, 24, 48, 84];
const GLOBAL_PRIMARY_DIRECTION_BLEND_WEIGHTS = [0.92, 0.86, 0.8, 0.72, 0.64, 0.56];
const GLOBAL_THROTTLE_DV_SCALE_KM_S = 1.15;
const GLOBAL_THROTTLE_MIN = 0.16;
const GLOBAL_THROTTLE_MAX = 1.0;
const GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2 = 0.0055;
const GLOBAL_TARGET_PERILUNE_ALTITUDE_KM = 120;
const GLOBAL_EARTH_SAFETY_MIN_ALTITUDE_KM = 130;
const GLOBAL_MIN_LUNAR_LEAD_RESERVE_SEC = 4 * 3600;
const GLOBAL_CONSERVATIVE_LUNAR_LEAD_RESERVE_SEC = 6 * 3600;
const STATIC_WINDOW_CACHE = new Map();
const FAST_PHASE_SAMPLES = 18;
const FAST_APOAPSIS_OFFSETS_KM = [0, 24, 52, 88, 132];
const FAST_FINALIST_COUNT = 4;
const FAST_NODE_FINALIST_COUNT = 3;
const FAST_NODE_SAMPLE_COUNT = 18;
const FAST_DV_OFFSETS_KM_S = [-0.08, 0, 0.12];
const FAST_RADIAL_OFFSETS = [-0.04, 0, 0.05];
const FAST_NORMAL_OFFSETS = [-0.03, 0, 0.03];
const FAST_PRIMARY_DIRECTION_BLEND_WEIGHTS = [0.9, 0.82, 0.74];
const FAST_TRANSFER_RESERVE_OFFSETS_SEC = [0];
const HYBRID_TRANSFER_RESERVE_OFFSETS_SEC = [-2 * 3600, -1 * 3600, 0, 1 * 3600, 2 * 3600];

function departureSolverProfile(searchProfile = "fast") {
  const mode = String(searchProfile || "fast").trim().toLowerCase();
  if (mode === "browser") {
    return {
      mode: "browser",
      approximate: false,
      phaseSamples: 8,
      apoapsisOffsetsKm: [0, 32, 64],
      finalistCount: 2,
      nodeFinalistCount: 2,
      defaultNodeSamples: 8,
      minNodeSamples: 8,
      maxNodeSamples: 16,
      refinePasses: 1,
      initialApoRefineStepKm: 12,
      useAggressive: false,
      directionBlendWeights: FAST_PRIMARY_DIRECTION_BLEND_WEIGHTS,
      dvOffsetsKmS: FAST_DV_OFFSETS_KM_S,
      radialOffsets: FAST_RADIAL_OFFSETS,
      normalOffsets: FAST_NORMAL_OFFSETS,
      transferReserveOffsetsSec: FAST_TRANSFER_RESERVE_OFFSETS_SEC,
    };
  }
  if (mode === "hybrid" || mode === "inject") {
    return {
      mode: "hybrid",
      approximate: false,
      phaseSamples: FAST_PHASE_SAMPLES,
      apoapsisOffsetsKm: FAST_APOAPSIS_OFFSETS_KM,
      finalistCount: 4,
      nodeFinalistCount: 4,
      defaultNodeSamples: 24,
      minNodeSamples: 12,
      maxNodeSamples: 36,
      refinePasses: 2,
      initialApoRefineStepKm: 16,
      useAggressive: false,
      directionBlendWeights: FAST_PRIMARY_DIRECTION_BLEND_WEIGHTS,
      dvOffsetsKmS: FAST_DV_OFFSETS_KM_S,
      radialOffsets: FAST_RADIAL_OFFSETS,
      normalOffsets: FAST_NORMAL_OFFSETS,
      transferReserveOffsetsSec: HYBRID_TRANSFER_RESERVE_OFFSETS_SEC,
    };
  }
  if (mode === "normal" || mode === "full") {
    return {
      mode: "normal",
      approximate: false,
      phaseSamples: GLOBAL_PHASE_SAMPLES,
      apoapsisOffsetsKm: GLOBAL_APOAPSIS_OFFSETS_KM,
      finalistCount: GLOBAL_FINALIST_COUNT,
      nodeFinalistCount: GLOBAL_NODE_FINALIST_COUNT,
      defaultNodeSamples: 96,
      minNodeSamples: 24,
      maxNodeSamples: 720,
      refinePasses: 4,
      initialApoRefineStepKm: 12,
      useAggressive: false,
      directionBlendWeights: GLOBAL_PRIMARY_DIRECTION_BLEND_WEIGHTS,
      dvOffsetsKmS: GLOBAL_DV_OFFSETS_KM_S,
      radialOffsets: GLOBAL_RADIAL_OFFSETS,
      normalOffsets: GLOBAL_NORMAL_OFFSETS,
      transferReserveOffsetsSec: FAST_TRANSFER_RESERVE_OFFSETS_SEC,
    };
  }
  if (mode === "aggressive") {
    return {
      mode: "aggressive",
      approximate: false,
      phaseSamples: GLOBAL_PHASE_SAMPLES,
      apoapsisOffsetsKm: GLOBAL_APOAPSIS_OFFSETS_KM,
      finalistCount: GLOBAL_FINALIST_COUNT,
      nodeFinalistCount: GLOBAL_NODE_FINALIST_COUNT,
      defaultNodeSamples: 96,
      minNodeSamples: 24,
      maxNodeSamples: 720,
      refinePasses: 4,
      initialApoRefineStepKm: 12,
      useAggressive: true,
      directionBlendWeights: GLOBAL_PRIMARY_DIRECTION_BLEND_WEIGHTS,
      dvOffsetsKmS: GLOBAL_DV_OFFSETS_KM_S,
      radialOffsets: GLOBAL_RADIAL_OFFSETS,
      normalOffsets: GLOBAL_NORMAL_OFFSETS,
      transferReserveOffsetsSec: FAST_TRANSFER_RESERVE_OFFSETS_SEC,
    };
  }
  return {
    mode: "fast",
    approximate: true,
    phaseSamples: FAST_PHASE_SAMPLES,
    apoapsisOffsetsKm: FAST_APOAPSIS_OFFSETS_KM,
    finalistCount: FAST_FINALIST_COUNT,
    nodeFinalistCount: FAST_NODE_FINALIST_COUNT,
    defaultNodeSamples: FAST_NODE_SAMPLE_COUNT,
    minNodeSamples: 8,
    maxNodeSamples: 96,
    refinePasses: 2,
    initialApoRefineStepKm: 16,
    useAggressive: false,
    directionBlendWeights: FAST_PRIMARY_DIRECTION_BLEND_WEIGHTS,
    dvOffsetsKmS: FAST_DV_OFFSETS_KM_S,
    radialOffsets: FAST_RADIAL_OFFSETS,
    normalOffsets: FAST_NORMAL_OFFSETS,
    transferReserveOffsetsSec: FAST_TRANSFER_RESERVE_OFFSETS_SEC,
  };
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback);
}

function resolvePlannerSpacecraft({
  spacecraft = null,
  fallbackMassKg = 1_250_000,
  defaultBodyId = "moon_departure_optimizer_vehicle",
} = {}) {
  const input = spacecraft && typeof spacecraft === "object"
    ? spacecraft
    : {};
  const massKg = Math.max(1, finiteNumber(input.massKg, fallbackMassKg));
  const rawPropellantMassKg = finiteNumber(input.propellantMassKg, Number.NaN);
  const propellantMassKg = Number.isFinite(rawPropellantMassKg)
    ? Math.max(0, rawPropellantMassKg)
    : Number.NaN;
  const derivedDryMassKg = Number.isFinite(propellantMassKg)
    ? Math.max(1, massKg - propellantMassKg)
    : Number.NaN;
  const dryMassKg = Math.max(1, finiteNumber(input.dryMassKg, derivedDryMassKg));
  const boundedDryMassKg = Math.min(massKg, dryMassKg);
  return {
    bodyId: String(input.bodyId || defaultBodyId),
    massKg,
    dryMassKg: boundedDryMassKg,
    propellantMassKg: Number.isFinite(propellantMassKg)
      ? Math.min(propellantMassKg, Math.max(0, massKg - boundedDryMassKg))
      : Math.max(0, massKg - boundedDryMassKg),
    thrustVacuumN: Math.max(0, finiteNumber(input.thrustVacuumN, 0)),
    thrustSeaLevelN: Math.max(0, finiteNumber(input.thrustSeaLevelN, input.thrustVacuumN)),
    ispVacuumS: Math.max(0, finiteNumber(input.ispVacuumS, 0)),
    ispSeaLevelS: Math.max(0, finiteNumber(input.ispSeaLevelS, input.ispVacuumS)),
    ambientPressurePa: Math.max(0, finiteNumber(input.ambientPressurePa, 0)),
    radiusKm: Math.max(0, finiteNumber(input.radiusKm, 0.0045)),
    reflectivityCoeff: finiteNumber(input.reflectivityCoeff, 1.45),
  };
}

function totalPlanTimeSec({
  burnDurationSec = Number.NaN,
  transferTimeSec = Number.NaN,
} = {}) {
  const burnSec = Math.max(0, finiteNumber(burnDurationSec, Number.NaN));
  const transferSec = Math.max(0, finiteNumber(transferTimeSec, Number.NaN));
  if (!Number.isFinite(burnSec) || !Number.isFinite(transferSec)) {
    return Number.NaN;
  }
  return burnSec + transferSec;
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
  const periapsisPhaseRad = normalizeAngleZeroToTau(Number(phaseRad) || 0);
  const radiusKm = periRadiusKm;
  const cTheta = Math.cos(periapsisPhaseRad);
  const sTheta = Math.sin(periapsisPhaseRad);
  const relPositionKm = add(
    scale(basis.e1, radiusKm * cTheta),
    scale(basis.e2, radiusKm * sTheta),
  );
  const speedAtPeriapsisKmS = Math.sqrt(
    Math.max(
      0,
      Number(earthMuKm3S2) * ((2 / periRadiusKm) - (1 / Math.max(1e-9, semiMajorAxisKm))),
    ),
  );
  const relVelocityKmS = add(
    scale(basis.e1, -speedAtPeriapsisKmS * sTheta),
    scale(basis.e2, speedAtPeriapsisKmS * cTheta),
  );
  return {
    basis,
    phaseRad: periapsisPhaseRad,
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
  transferReserveSec = GLOBAL_CONSERVATIVE_LUNAR_LEAD_RESERVE_SEC,
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
  const nominalTransferSec = nominalTransferTimeSec({
    startRadiusKm: shipRadiusKm,
    targetRadiusKm: length(moonRelPosKm),
    earthMuKm3S2,
  });
  const resolvedTransferReserveSec = Math.max(
    GLOBAL_MIN_LUNAR_LEAD_RESERVE_SEC,
    finiteNumber(transferReserveSec, GLOBAL_CONSERVATIVE_LUNAR_LEAD_RESERVE_SEC),
  );
  const transferTimeSec = Number.isFinite(nominalTransferSec)
    ? (nominalTransferSec + resolvedTransferReserveSec)
    : Number.NaN;
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
    transferReserveSec: resolvedTransferReserveSec,
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

function estimateCoastEntryAlignment({
  candidate = null,
  burnDirection = null,
  throttle = Number.NaN,
  burnDurationSec = Number.NaN,
  engineAccelAtThrottle1KmS2 = GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2,
  earthState = null,
  moonRelPosKm = null,
  moonRelVelKmS = null,
} = {}) {
  if (
    !candidate
    || !finiteVector(candidate.positionKm)
    || !finiteVector(candidate.velocityKmS)
    || !finiteVector(burnDirection)
    || !finiteVector(earthState?.position)
    || !finiteVector(moonRelPosKm)
  ) {
    return Number.NaN;
  }
  const durationSec = Math.max(0, finiteNumber(burnDurationSec, Number.NaN));
  if (!Number.isFinite(durationSec)) {
    return Number.NaN;
  }
  const accelKmS2 = Math.max(0, finiteNumber(throttle, 0))
    * Math.max(0, finiteNumber(engineAccelAtThrottle1KmS2, GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2));
  const estimatedShipPositionKm = add(
    add(
      candidate.positionKm,
      scale(candidate.velocityKmS, durationSec),
    ),
    scale(burnDirection, 0.5 * accelKmS2 * durationSec * durationSec),
  );
  const estimatedShipVelocityKmS = add(
    candidate.velocityKmS,
    scale(burnDirection, accelKmS2 * durationSec),
  );
  const projectedMoonRelPosKm = finiteVector(moonRelVelKmS)
    ? add(moonRelPosKm, scale(moonRelVelKmS, durationSec))
    : moonRelPosKm;
  const projectedMoonPositionKm = add(earthState.position, projectedMoonRelPosKm);
  const directionToMoonAtCoastEntry = normalize(
    subtract(projectedMoonPositionKm, estimatedShipPositionKm),
    burnDirection,
  );
  const coastVelocityDirection = normalize(estimatedShipVelocityKmS, burnDirection);
  return clamp(dot(coastVelocityDirection, directionToMoonAtCoastEntry), -1, 1);
}

function chooseBetterEvaluatedCandidate(currentBest, candidateBest) {
  if (!candidateBest?.evaluated) {
    return currentBest;
  }
  if (!currentBest?.evaluated) {
    return candidateBest;
  }
  const currentEvaluated = currentBest.evaluated;
  const candidateEvaluated = candidateBest.evaluated;
  if (Boolean(candidateEvaluated.corridorAccepted) !== Boolean(currentEvaluated.corridorAccepted)) {
    return candidateEvaluated.corridorAccepted ? candidateBest : currentBest;
  }
  const currentResidual = Number(currentEvaluated.corridorResidualTotalKm);
  const candidateResidual = Number(candidateEvaluated.corridorResidualTotalKm);
  if (Number.isFinite(candidateResidual) && Number.isFinite(currentResidual)) {
    if (candidateResidual < (currentResidual - 1e-6)) {
      return candidateBest;
    }
    if (candidateResidual > (currentResidual + 1e-6)) {
      return currentBest;
    }
  }
  const currentCorridorScore = Number(currentEvaluated.corridorScore);
  const candidateCorridorScore = Number(candidateEvaluated.corridorScore);
  if (
    Boolean(currentEvaluated.corridorAccepted)
    && Boolean(candidateEvaluated.corridorAccepted)
  ) {
    const corridorScoreGap = (
      Number.isFinite(candidateCorridorScore) && Number.isFinite(currentCorridorScore)
        ? Math.abs(candidateCorridorScore - currentCorridorScore)
        : Number.POSITIVE_INFINITY
    );
    const currentMissKm = Number(currentEvaluated.predictedMissDistanceKm);
    const candidateMissKm = Number(candidateEvaluated.predictedMissDistanceKm);
    const currentBPlaneKm = Number(currentEvaluated.bPlaneErrorKm);
    const candidateBPlaneKm = Number(candidateEvaluated.bPlaneErrorKm);
    const currentPeriluneErrorKm = Math.abs(
      (Number(currentEvaluated.predictedPeriluneAltitudeKm) || GLOBAL_TARGET_PERILUNE_ALTITUDE_KM)
      - GLOBAL_TARGET_PERILUNE_ALTITUDE_KM,
    );
    const candidatePeriluneErrorKm = Math.abs(
      (Number(candidateEvaluated.predictedPeriluneAltitudeKm) || GLOBAL_TARGET_PERILUNE_ALTITUDE_KM)
      - GLOBAL_TARGET_PERILUNE_ALTITUDE_KM,
    );
    const candidateMateriallyBetterQuality = (
      (Number.isFinite(candidateMissKm) && Number.isFinite(currentMissKm) && candidateMissKm < (currentMissKm - 1_500))
      || (Number.isFinite(candidateBPlaneKm) && Number.isFinite(currentBPlaneKm) && candidateBPlaneKm < (currentBPlaneKm - 1_500))
      || (
        Number.isFinite(candidatePeriluneErrorKm)
        && Number.isFinite(currentPeriluneErrorKm)
        && candidatePeriluneErrorKm < (currentPeriluneErrorKm - 1_000)
      )
    );
    if (candidateMateriallyBetterQuality) {
      return candidateBest;
    }
    const currentMateriallyBetterQuality = (
      (Number.isFinite(candidateMissKm) && Number.isFinite(currentMissKm) && candidateMissKm > (currentMissKm + 1_500))
      || (Number.isFinite(candidateBPlaneKm) && Number.isFinite(currentBPlaneKm) && candidateBPlaneKm > (currentBPlaneKm + 1_500))
      || (
        Number.isFinite(candidatePeriluneErrorKm)
        && Number.isFinite(currentPeriluneErrorKm)
        && candidatePeriluneErrorKm > (currentPeriluneErrorKm + 1_000)
      )
    );
    if (currentMateriallyBetterQuality) {
      return currentBest;
    }
    const comparableQuality = corridorScoreGap <= 0.035;
    if (comparableQuality) {
      const currentTimeToCoastSec = Number(currentEvaluated.planTimeToCoastSec);
      const candidateTimeToCoastSec = Number(candidateEvaluated.planTimeToCoastSec);
      if (
        Number.isFinite(candidateTimeToCoastSec)
        && Number.isFinite(currentTimeToCoastSec)
      ) {
        if (candidateTimeToCoastSec < (currentTimeToCoastSec - 15)) {
          return candidateBest;
        }
        if (candidateTimeToCoastSec > (currentTimeToCoastSec + 15)) {
          return currentBest;
        }
      }
      const currentPlanTotalSec = Number(currentEvaluated.planTotalTimeSec);
      const candidatePlanTotalSec = Number(candidateEvaluated.planTotalTimeSec);
      if (
        Number.isFinite(candidatePlanTotalSec)
        && Number.isFinite(currentPlanTotalSec)
      ) {
        if (candidatePlanTotalSec < (currentPlanTotalSec - 120)) {
          return candidateBest;
        }
        if (candidatePlanTotalSec > (currentPlanTotalSec + 120)) {
          return currentBest;
        }
      }
    }
  }
  if (Number.isFinite(candidateCorridorScore) && Number.isFinite(currentCorridorScore)) {
    if (candidateCorridorScore > (currentCorridorScore + 1e-6)) {
      return candidateBest;
    }
    if (candidateCorridorScore < (currentCorridorScore - 1e-6)) {
      return currentBest;
    }
  }
  const currentCost = Number(currentEvaluated.cost);
  const candidateCost = Number(candidateEvaluated.cost);
  if (!Number.isFinite(currentCost)) {
    return candidateBest;
  }
  if (!Number.isFinite(candidateCost)) {
    return currentBest;
  }
  if (candidateCost < (currentCost - 1e-6)) {
    return candidateBest;
  }
  if (candidateCost > (currentCost + 1e-6)) {
    return currentBest;
  }
  const currentAlignment = Number(currentEvaluated.projectedAlignment);
  const candidateAlignment = Number(candidateEvaluated.projectedAlignment);
  if (Number.isFinite(candidateAlignment) && Number.isFinite(currentAlignment) && candidateAlignment > currentAlignment) {
    return candidateBest;
  }
  const currentCoastEntryAlignment = Number(currentEvaluated.coastEntryAlignment);
  const candidateCoastEntryAlignment = Number(candidateEvaluated.coastEntryAlignment);
  if (
    Number.isFinite(candidateCoastEntryAlignment)
    && Number.isFinite(currentCoastEntryAlignment)
    && candidateCoastEntryAlignment > currentCoastEntryAlignment
  ) {
    return candidateBest;
  }
  return currentBest;
}

function evaluateApproximateDepartureCandidate({
  earthState = null,
  moonRelPosKm = null,
  moonRelVelKmS = null,
  candidate = null,
  nominalDeltaVKmS = Number.NaN,
  targetPeriluneAltitudeKm = GLOBAL_TARGET_PERILUNE_ALTITUDE_KM,
  engineAccelAtThrottle1KmS2 = GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2,
  spacecraft = null,
} = {}) {
  if (
    !finiteVector(earthState?.position)
    || !finiteVector(moonRelPosKm)
    || !candidate
  ) {
    return null;
  }
  const tangent = normalize(candidate.relVelocityKmS, candidate.velocityDirection);
  const projectedMoonRelPosKm = finiteVector(moonRelVelKmS) && Number.isFinite(Number(candidate.transferTimeSec))
    ? add(moonRelPosKm, scale(moonRelVelKmS, Number(candidate.transferTimeSec)))
    : moonRelPosKm;
  const toMoonProjected = normalize(
    subtract(add(earthState.position, projectedMoonRelPosKm), candidate.positionKm),
    tangent,
  );
  const toMoonNow = normalize(
    subtract(add(earthState.position, moonRelPosKm), candidate.positionKm),
    toMoonProjected,
  );
  const radialOut = normalize(candidate.relPositionKm, tangent);
  const planeNormal = normalize(candidate.basis?.planeNormal, { x: 0, y: 0, z: 1 });
  const alignProjected01 = clamp((((Number(candidate.alignProjected) || 0) + 1) * 0.5), 0, 1);
  const alignNow01 = clamp((((Number(candidate.alignNow) || 0) + 1) * 0.5), 0, 1);
  const planeQuality = clamp(Number(candidate.planeQuality) || 0, 0, 1);
  const energyBonus = clamp(
    (
      (Number(candidate.apoapsisAltitudeKm) - Number(candidate.periapsisAltitudeKm))
      / 160
    ),
    0,
    1,
  );
  const tangentWeight = clamp(
    0.72 + (alignProjected01 * 0.18) + (energyBonus * 0.06),
    0.62,
    0.94,
  );
  const primaryDir = normalize(
    add(
      scale(tangent, tangentWeight),
      scale(toMoonProjected, 1 - tangentWeight),
    ),
    tangent,
  );
  const radialWeight = clamp(
    ((1 - alignProjected01) * 0.08) + ((0.62 - energyBonus) * 0.05),
    -0.06,
    0.12,
  );
  const normalWeight = clamp(dot(toMoonProjected, planeNormal) * -0.1, -0.08, 0.08);
  const burnDirection = combineBasis({
    primaryDir,
    radialDir: radialOut,
    normalDir: planeNormal,
    radialWeight,
    normalWeight,
  });

  const predictedMissDistanceKm = clamp(
    5_000
      + ((1 - alignProjected01) * 52_000)
      + ((1 - planeQuality) * 30_000)
      + ((1 - alignNow01) * 12_000)
      + (Math.abs(0.82 - energyBonus) * 12_000),
    2_500,
    2_000_000,
  );
  const predictedPeriluneAltitudeKm = clamp(
    targetPeriluneAltitudeKm
      + ((1 - alignProjected01) * 3_500)
      + ((1 - planeQuality) * 6_500)
      + (Math.max(0, 0.6 - energyBonus) * 4_500)
      + (Math.max(0, energyBonus - 0.96) * 2_500),
    15,
    2_000_000,
  );
  const bPlaneErrorKm = clamp(
    2_000
      + ((1 - planeQuality) * 26_000)
      + ((1 - alignProjected01) * 15_000)
      + (Math.max(0, 0.55 - alignNow01) * 4_000),
    500,
    2_000_000,
  );
  const corridor = evaluateMoonDepartureCorridor({
    predictedMissDistanceKm,
    predictedPeriluneAltitudeKm,
    bPlaneErrorKm,
    plannerConfig: NAVIGATION_DEFAULTS.planner,
    targetPeriluneAltitudeKm,
  });
  const deltaVNeedKmS = Math.max(
    0.2,
    ((Number(nominalDeltaVKmS) || 3.15) * (0.82 + ((1 - energyBonus) * 0.05)))
      + ((1 - alignProjected01) * 0.03),
  );
  const throttle = clamp(
    deltaVNeedKmS / GLOBAL_THROTTLE_DV_SCALE_KM_S,
    GLOBAL_THROTTLE_MIN,
    GLOBAL_THROTTLE_MAX,
  );
  const burnDurationSec = burnDurationForDeltaVSec(
    deltaVNeedKmS,
    Math.max(0.0002, finiteNumber(engineAccelAtThrottle1KmS2, GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2)),
    throttle,
    spacecraft,
  );
  const coastEntryAlignment = estimateCoastEntryAlignment({
    candidate,
    burnDirection,
    throttle,
    burnDurationSec,
    engineAccelAtThrottle1KmS2,
    earthState,
    moonRelPosKm,
    moonRelVelKmS,
  });
  const coastEntryAlignment01 = clamp((((Number(coastEntryAlignment) || 0) + 1) * 0.5), 0, 1);
  const planTimeToCoastSec = Math.max(0, Number(burnDurationSec) || 0);
  const planTransferTimeSec = Number(candidate.transferTimeSec);
  const planTotalTimeSec = totalPlanTimeSec({
    burnDurationSec: planTimeToCoastSec,
    transferTimeSec: planTransferTimeSec,
  });
  const timePenalty = (
    ((planTimeToCoastSec / 3600) * 4_500)
    + ((planTransferTimeSec / 3600) * 325)
  );
  const corridorPenalty = corridor.accepted
    ? 0
    : (
      (corridor.missResidualKm * 1.15)
      + (corridor.bPlaneResidualKm * 1.0)
      + (corridor.periluneResidualKm * 0.35)
      + 30_000
    );
  const projectedAlignment = clamp(dot(burnDirection, toMoonProjected), -1, 1);
  return {
    cost: (
      predictedMissDistanceKm
      + (Math.abs(predictedPeriluneAltitudeKm - targetPeriluneAltitudeKm) * 0.65)
      + (bPlaneErrorKm * 0.55)
      + corridorPenalty
      + (deltaVNeedKmS * 450)
      + ((1 - alignProjected01) * 5_000)
      + ((1 - coastEntryAlignment01) * 16_000)
      + timePenalty
    ),
    throttle,
    burnDurationSec,
    deltaVNeedKmS,
    burnDirection,
    predictedMissDistanceKm,
    predictedPeriluneAltitudeKm,
    bPlaneErrorKm,
    corridorAccepted: corridor.accepted,
    corridorScore: corridor.score,
    corridorReason: corridor.reason,
    corridorResidualTotalKm: (
      (Number(corridor.missResidualKm) || 0)
      + (Number(corridor.bPlaneResidualKm) || 0)
      + (Number(corridor.periluneResidualKm) || 0)
    ),
    planTimeToCoastSec,
    planTransferTimeSec,
    planTotalTimeSec,
    safetyAltitudeKm: Number(candidate.periapsisAltitudeKm),
    projectedAlignment,
    coastEntryAlignment,
  };
}

function evaluatePropagatedDepartureCandidate({
  sources = null,
  spacecraft = null,
  candidate = null,
  nominalDeltaVKmS = Number.NaN,
  targetPeriluneAltitudeKm = GLOBAL_TARGET_PERILUNE_ALTITUDE_KM,
  earthSafetyMinAltitudeKm = GLOBAL_EARTH_SAFETY_MIN_ALTITUDE_KM,
  dvOffsetsKmS = GLOBAL_DV_OFFSETS_KM_S,
  radialOffsets = GLOBAL_RADIAL_OFFSETS,
  normalOffsets = GLOBAL_NORMAL_OFFSETS,
  engineAccelAtThrottle1KmS2 = GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2,
} = {}) {
  if (!sources || !candidate) {
    return null;
  }
  const toMoon = normalize(subtract(sources.moon.positionKm, candidate.positionKm), candidate.velocityDirection);
  const tangent = normalize(candidate.velocityKmS, candidate.velocityDirection);
  const radialOut = normalize(subtract(candidate.positionKm, sources.earth.positionKm), tangent);
  const planeNormal = normalize(cross(subtract(candidate.positionKm, sources.earth.positionKm), subtract(candidate.velocityKmS, sources.earth.velocityKmS || { x: 0, y: 0, z: 0 })), { x: 0, y: 0, z: 1 });
  const transferTimeSec = Number.isFinite(Number(candidate.transferTimeSec))
    ? Math.max(72 * 3600, Number(candidate.transferTimeSec) * 1.2)
    : (96 * 3600);
  const nominalDv = Math.max(0.2, Number(nominalDeltaVKmS) || 3.15);
  let best = null;

  for (let dvIndex = 0; dvIndex < dvOffsetsKmS.length; dvIndex += 1) {
    const deltaVNeedKmS = Math.max(0.2, nominalDv + dvOffsetsKmS[dvIndex]);
    const throttle = clamp(
      deltaVNeedKmS / GLOBAL_THROTTLE_DV_SCALE_KM_S,
      GLOBAL_THROTTLE_MIN,
      GLOBAL_THROTTLE_MAX,
    );
    const burnDurationSec = burnDurationForDeltaVSec(
      deltaVNeedKmS,
      Math.max(0.0002, finiteNumber(engineAccelAtThrottle1KmS2, GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2)),
      throttle,
      spacecraft,
    );
    for (let radialIndex = 0; radialIndex < radialOffsets.length; radialIndex += 1) {
      for (let normalIndex = 0; normalIndex < normalOffsets.length; normalIndex += 1) {
        for (let blendIndex = 0; blendIndex < GLOBAL_PRIMARY_DIRECTION_BLEND_WEIGHTS.length; blendIndex += 1) {
          const tangentWeight = GLOBAL_PRIMARY_DIRECTION_BLEND_WEIGHTS[blendIndex];
          const primaryDir = normalize(
            add(
              scale(tangent, tangentWeight),
              scale(toMoon, 1 - tangentWeight),
            ),
            tangent,
          );
          const burnDirection = combineBasis({
            primaryDir,
            radialDir: radialOut,
            normalDir: planeNormal,
            radialWeight: radialOffsets[radialIndex],
            normalWeight: normalOffsets[normalIndex],
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
              accelAtThrottle1KmS2: Math.max(
                0.0002,
                finiteNumber(engineAccelAtThrottle1KmS2, GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2),
              ),
              burnDurationSec,
            },
          });
          if (!propagation) {
            continue;
          }
          const closestMoonRelPos = finiteVector(propagation.closestMoonRelativePositionKm)
            ? propagation.closestMoonRelativePositionKm
            : null;
          const closestMoonRelVel = finiteVector(propagation.closestMoonRelativeVelocityKmS)
            ? propagation.closestMoonRelativeVelocityKmS
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
            bodyMuKm3S2: 6.67430e-20 * Math.max(1, Number(sources.moon?.massKg) || DEFAULT_MOON_MASS_KG),
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
          const corridor = evaluateMoonDepartureCorridor({
            predictedMissDistanceKm,
            predictedPeriluneAltitudeKm,
            bPlaneErrorKm,
            plannerConfig: NAVIGATION_DEFAULTS.planner,
            targetPeriluneAltitudeKm,
          });
          const corridorPenalty = corridor.accepted
            ? 0
            : (
              (corridor.missResidualKm * 1.3)
              + (corridor.bPlaneResidualKm * 1.15)
              + (corridor.periluneResidualKm * 0.45)
              + 90_000
            );
          const corridorResidualTotalKm = (
            Number(corridor.missResidualKm) || 0
          ) + (
            Number(corridor.bPlaneResidualKm) || 0
          ) + (
            Number(corridor.periluneResidualKm) || 0
          );
          const projectedAlignment = finiteVector(closestMoonRelPos)
            ? clamp(dot(burnDirection, normalize(closestMoonRelPos, burnDirection)), -1, 1)
            : candidate.alignProjected;
          const coastEntryAlignment = estimateCoastEntryAlignment({
            candidate,
            burnDirection,
            throttle,
            burnDurationSec,
            engineAccelAtThrottle1KmS2,
            earthState: sources?.earth,
            moonRelPosKm: subtract(sources?.moon?.positionKm || { x: 0, y: 0, z: 0 }, sources?.earth?.positionKm || { x: 0, y: 0, z: 0 }),
            moonRelVelKmS: (
              finiteVector(sources?.moon?.velocityKmS) && finiteVector(sources?.earth?.velocityKmS)
                ? subtract(sources.moon.velocityKmS, sources.earth.velocityKmS)
                : { x: 0, y: 0, z: 0 }
            ),
          });
          const coastEntryAlignment01 = clamp((((Number(coastEntryAlignment) || 0) + 1) * 0.5), 0, 1);
          const planTimeToCoastSec = Math.max(0, Number(burnDurationSec) || 0);
          const planTransferTimeSec = Number(candidate.transferTimeSec);
          const planTotalTimeSec = totalPlanTimeSec({
            burnDurationSec: planTimeToCoastSec,
            transferTimeSec: planTransferTimeSec,
          });
          const timePenalty = (
            ((planTimeToCoastSec / 3600) * 5_000)
            + ((planTransferTimeSec / 3600) * 350)
          );
          const cost = (
            predictedMissDistanceKm
            + (Math.abs(predictedPeriluneAltitudeKm - targetPeriluneAltitudeKm) * 0.85)
            + ((Number.isFinite(bPlaneErrorKm) ? bPlaneErrorKm : predictedMissDistanceKm) * 0.6)
            + (safetyRiskKm * 8_000)
            + closingPenalty
            + escapePenalty
            + corridorPenalty
            + (deltaVNeedKmS * 650)
            + (Math.abs(1 - tangentWeight) * 1_500)
            + ((1 - coastEntryAlignment01) * 18_000)
            + timePenalty
          );
          const evaluated = {
            cost,
            throttle,
            burnDurationSec,
            deltaVNeedKmS,
            burnDirection,
            predictedMissDistanceKm,
            predictedPeriluneAltitudeKm,
            bPlaneErrorKm,
            corridorAccepted: corridor.accepted,
            corridorScore: corridor.score,
            corridorReason: corridor.reason,
            corridorResidualTotalKm,
            planTimeToCoastSec,
            planTransferTimeSec,
            planTotalTimeSec,
            safetyAltitudeKm,
            projectedAlignment,
            coastEntryAlignment,
            propagation,
          };
          const preferred = chooseBetterEvaluatedCandidate(
            best ? { evaluated: best } : null,
            { evaluated },
          );
          if (preferred?.evaluated === evaluated) {
            best = evaluated;
          }
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
  searchProfile = "fast",
  engineAccelAtThrottle1KmS2 = GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2,
  spacecraftMassKg = 1_250_000,
  spacecraft = null,
} = {}) {
  if (!finiteVector(earthState?.position) || !finiteVector(moonState?.position)) {
    return null;
  }
  const profile = departureSolverProfile(searchProfile);
  const moonRelPosKm = subtract(moonState.position, earthState.position);
  const moonRelVelKmS = finiteVector(moonState?.velocity) && finiteVector(earthState?.velocity)
    ? subtract(moonState.velocity, earthState.velocity)
    : { x: 0, y: 0, z: 0 };
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
  const sources = profile.approximate
    ? null
    : buildMoonGuidanceSourceModel({
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
  const propagationSpacecraft = profile.approximate
    ? null
    : resolvePlannerSpacecraft({
      spacecraft,
      fallbackMassKg: spacecraftMassKg,
      defaultBodyId: "moon_departure_optimizer_vehicle",
    });

  const cheapCandidates = [];
  for (let phaseIndex = 0; phaseIndex < profile.phaseSamples; phaseIndex += 1) {
    const phaseRad = (phaseIndex / profile.phaseSamples) * (Math.PI * 2);
    for (let apoIndex = 0; apoIndex < profile.apoapsisOffsetsKm.length; apoIndex += 1) {
      const apoapsisAltitudeKm = Math.max(
        Number(orbitAltitudeKm) || 185,
        (Number(orbitAltitudeKm) || 185) + profile.apoapsisOffsetsKm[apoIndex],
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
  const finalists = cheapCandidates.slice(0, profile.finalistCount);

  let best = null;
  for (let index = 0; index < finalists.length; index += 1) {
    const evaluated = profile.approximate
      ? evaluateApproximateDepartureCandidate({
        earthState,
        moonRelPosKm,
        moonRelVelKmS,
        candidate: finalists[index],
        nominalDeltaVKmS,
        engineAccelAtThrottle1KmS2,
        spacecraft: propagationSpacecraft,
      })
      : evaluatePropagatedDepartureCandidate({
        sources,
        spacecraft,
        candidate: finalists[index],
        nominalDeltaVKmS,
        dvOffsetsKmS: profile.dvOffsetsKmS,
        radialOffsets: profile.radialOffsets,
        normalOffsets: profile.normalOffsets,
        engineAccelAtThrottle1KmS2,
      });
    best = chooseBetterEvaluatedCandidate(best, evaluated ? {
      cheap: finalists[index],
      evaluated,
    } : null);
  }

  if (best?.cheap) {
    const phaseStepRad = (Math.PI * 2) / profile.phaseSamples;
    let phaseRefineStepRad = phaseStepRad / 4;
    let apoRefineStepKm = profile.initialApoRefineStepKm;
    for (let pass = 0; pass < profile.refinePasses; pass += 1) {
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
          const evaluated = profile.approximate
            ? evaluateApproximateDepartureCandidate({
              earthState,
              moonRelPosKm,
              moonRelVelKmS,
              candidate: localCheap,
              nominalDeltaVKmS,
              engineAccelAtThrottle1KmS2,
              spacecraft: propagationSpacecraft,
            })
            : evaluatePropagatedDepartureCandidate({
              sources,
              spacecraft,
              candidate: localCheap,
              nominalDeltaVKmS,
              dvOffsetsKmS: profile.dvOffsetsKmS,
              radialOffsets: profile.radialOffsets,
              normalOffsets: profile.normalOffsets,
              engineAccelAtThrottle1KmS2,
            });
          best = chooseBetterEvaluatedCandidate(best, evaluated ? {
            cheap: localCheap,
            evaluated,
          } : null);
        }
      }
      phaseRefineStepRad /= 4;
      apoRefineStepKm = Math.max(1, apoRefineStepKm / 2);
    }
  }

  if (profile.useAggressive && best?.cheap && !best?.evaluated?.corridorAccepted) {
    const phaseStepRad = (Math.PI * 2) / profile.phaseSamples;
    const seedPhaseRad = Number(best.cheap.phaseRad);
    const seedApoapsisAltitudeKm = Number(best.cheap.apoapsisAltitudeKm);
    for (let phaseIndex = 0; phaseIndex < GLOBAL_AGGRESSIVE_PHASE_OFFSETS_SCALE.length; phaseIndex += 1) {
      for (let apoIndex = 0; apoIndex < GLOBAL_AGGRESSIVE_APOAPSIS_OFFSETS_KM.length; apoIndex += 1) {
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
            seedApoapsisAltitudeKm + GLOBAL_AGGRESSIVE_APOAPSIS_OFFSETS_KM[apoIndex],
          ),
          phaseRad: normalizeAngleZeroToTau(
            seedPhaseRad + (GLOBAL_AGGRESSIVE_PHASE_OFFSETS_SCALE[phaseIndex] * phaseStepRad),
          ),
        });
        if (!localCheap) {
          continue;
        }
        const evaluated = evaluatePropagatedDepartureCandidate({
          sources,
          spacecraft,
          candidate: localCheap,
          nominalDeltaVKmS,
          dvOffsetsKmS: GLOBAL_AGGRESSIVE_DV_OFFSETS_KM_S,
          radialOffsets: GLOBAL_AGGRESSIVE_RADIAL_OFFSETS,
          normalOffsets: GLOBAL_AGGRESSIVE_NORMAL_OFFSETS,
          engineAccelAtThrottle1KmS2,
        });
        best = chooseBetterEvaluatedCandidate(best, evaluated ? {
          cheap: localCheap,
          evaluated,
        } : null);
      }
    }
  }

  return buildSolvedDepartureWindowResult({
    selected: best?.cheap || cheapCandidates[0] || null,
    evaluated: best?.evaluated || null,
    moonRelPosKm,
    inclinationDeg,
    ascendingNodeRad,
    nominalTransferSec,
    nominalDeltaVKmS,
  });
}

function buildSolvedDepartureWindowResult({
  selected = null,
  evaluated = null,
  moonRelPosKm = null,
  inclinationDeg = 28.5,
  ascendingNodeRad = 0,
  nominalTransferSec = Number.NaN,
  nominalDeltaVKmS = Number.NaN,
} = {}) {
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
  const corridorAccepted = Boolean(evaluated?.corridorAccepted);
  const corridorScore = corridorAccepted
    ? clamp(Number(evaluated?.corridorScore) || 1, 0, 1)
    : clamp(Number(evaluated?.corridorScore) || 0, 0, 1);
  const optimalityScore = Number.isFinite(baseCost)
    ? clamp(1 / (1 + (baseCost / 220_000)), 0, 1)
    : clamp(Number(selected.geometryScore) || 0, 0, 1);
  return {
    valid: true,
    optimizerMode: "global-nbody-optimal-departure",
    ready: corridorAccepted,
    phaseReady: true,
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
    selectedCoastEntryAlignment: Number.isFinite(Number(evaluated?.coastEntryAlignment))
      ? Number(evaluated.coastEntryAlignment)
      : Number.NaN,
    selectedPlaneQuality: Number(selected.planeQuality),
    optimizedApoapsisAltitudeKm: Number(selected.apoapsisAltitudeKm),
    optimizedTransferReserveSec: Number.isFinite(Number(selected.transferReserveSec))
      ? Number(selected.transferReserveSec)
      : Number.NaN,
    predictedMissDistanceKm: Number.isFinite(Number(evaluated?.predictedMissDistanceKm))
      ? Number(evaluated.predictedMissDistanceKm)
      : Number.NaN,
    predictedPeriluneAltitudeKm: Number.isFinite(Number(evaluated?.predictedPeriluneAltitudeKm))
      ? Number(evaluated.predictedPeriluneAltitudeKm)
      : Number.NaN,
    bPlaneErrorKm: Number.isFinite(Number(evaluated?.bPlaneErrorKm))
      ? Number(evaluated.bPlaneErrorKm)
      : Number.NaN,
    corridorAccepted,
    corridorScore,
    corridorReason: corridorAccepted ? "corridor-ready" : String(evaluated?.corridorReason || "corridor-reject"),
    reason: corridorAccepted ? "window-ready" : String(evaluated?.corridorReason || "corridor-reject"),
    optimizedThrottle: Number.isFinite(Number(evaluated?.throttle))
      ? Number(evaluated.throttle)
      : Number.NaN,
    optimizedBurnDurationSec: Number.isFinite(Number(evaluated?.burnDurationSec))
      ? Number(evaluated.burnDurationSec)
      : Number.NaN,
    optimizedTimeToCoastSec: Number.isFinite(Number(evaluated?.planTimeToCoastSec))
      ? Number(evaluated.planTimeToCoastSec)
      : Number.NaN,
    optimizedPlanTotalTimeSec: Number.isFinite(Number(evaluated?.planTotalTimeSec))
      ? Number(evaluated.planTotalTimeSec)
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
  searchProfile = "fast",
  engineAccelAtThrottle1KmS2 = GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2,
  spacecraftMassKg = 1_250_000,
  spacecraft = null,
} = {}) {
  const moonRelPosKm = finiteVector(earthState?.position) && finiteVector(moonState?.position)
    ? subtract(moonState.position, earthState.position)
    : null;
  const moonRelVelKmS = finiteVector(moonState?.velocity) && finiteVector(earthState?.velocity)
    ? subtract(moonState.velocity, earthState.velocity)
    : null;
  const resolvedSpacecraft = resolvePlannerSpacecraft({
    spacecraft,
    fallbackMassKg: spacecraftMassKg,
  });
  return [
    String(searchProfile || "normal"),
    quantize(inclinationDeg, 0.01),
    quantize(ascendingNodeRad, 0.0005),
    quantize(orbitAltitudeKm, 0.25),
    quantize(earthRadiusKm, 0.1),
    quantize(earthMuKm3S2, 0.25),
    quantize(engineAccelAtThrottle1KmS2, 0.00001),
    quantize(spacecraftMassKg, 10),
    quantize(resolvedSpacecraft.dryMassKg, 10),
    quantize(resolvedSpacecraft.propellantMassKg, 10),
    quantize(resolvedSpacecraft.thrustVacuumN, 10_000),
    quantize(resolvedSpacecraft.thrustSeaLevelN, 10_000),
    quantize(resolvedSpacecraft.ispVacuumS, 0.5),
    quantize(resolvedSpacecraft.ispSeaLevelS, 0.5),
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

function scoreEvaluatedDepartureCandidate(evaluated = null) {
  if (!evaluated || typeof evaluated !== "object") {
    return Number.NEGATIVE_INFINITY;
  }
  return (
    (Boolean(evaluated.corridorAccepted) ? 1e12 : 0)
    + (clamp(Number(evaluated.corridorScore) || 0, 0, 1) * 1e9)
    - (Number.isFinite(Number(evaluated.cost)) ? Number(evaluated.cost) : 1e12)
  );
}

function insertTopScoredCandidate(candidates = [], nextCandidate = null, limit = 4) {
  if (!nextCandidate?.evaluated) {
    return candidates;
  }
  const nextScore = Number(nextCandidate.coarseScore);
  const merged = candidates.concat({
    ...nextCandidate,
    coarseScore: Number.isFinite(nextScore)
      ? nextScore
      : scoreEvaluatedDepartureCandidate(nextCandidate.evaluated),
  });
  merged.sort((a, b) => Number(b.coarseScore) - Number(a.coarseScore));
  return merged.slice(0, Math.max(1, limit));
}

function evaluateSinglePropagatedDepartureCandidate({
  sources = null,
  spacecraft = null,
  earthState = null,
  moonRelPosKm = null,
  moonRelVelKmS = null,
  candidate = null,
  nominalDeltaVKmS = Number.NaN,
  targetPeriluneAltitudeKm = GLOBAL_TARGET_PERILUNE_ALTITUDE_KM,
  earthSafetyMinAltitudeKm = GLOBAL_EARTH_SAFETY_MIN_ALTITUDE_KM,
  engineAccelAtThrottle1KmS2 = GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2,
} = {}) {
  if (!sources || !spacecraft || !candidate || !finiteVector(earthState?.position) || !finiteVector(moonRelPosKm)) {
    return null;
  }
  const approx = evaluateApproximateDepartureCandidate({
    earthState,
    moonRelPosKm,
    moonRelVelKmS,
    candidate,
    nominalDeltaVKmS,
    targetPeriluneAltitudeKm,
    engineAccelAtThrottle1KmS2,
    spacecraft,
  });
  if (!approx || !finiteVector(approx.burnDirection)) {
    return null;
  }
  const propagation = propagateMoonGuidanceState({
    initialState: {
      positionKm: candidate.positionKm,
      velocityKmS: candidate.velocityKmS,
    },
    durationSec: Number.isFinite(Number(candidate.transferTimeSec))
      ? Math.max(72 * 3600, Number(candidate.transferTimeSec) * 1.2)
      : (96 * 3600),
    stepSec: GLOBAL_PROPAGATION_STEP_SEC,
    sources,
    spacecraft,
    burnCommand: {
      direction: approx.burnDirection,
      throttle: Number(approx.throttle),
      accelAtThrottle1KmS2: Math.max(
        0.0002,
        finiteNumber(engineAccelAtThrottle1KmS2, GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2),
      ),
      burnDurationSec: Number(approx.burnDurationSec),
    },
  });
  if (!propagation) {
    return null;
  }
  const closestMoonRelPos = finiteVector(propagation.closestMoonRelativePositionKm)
    ? propagation.closestMoonRelativePositionKm
    : null;
  const closestMoonRelVel = finiteVector(propagation.closestMoonRelativeVelocityKmS)
    ? propagation.closestMoonRelativeVelocityKmS
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
    bodyMuKm3S2: 6.67430e-20 * Math.max(1, Number(sources.moon?.massKg) || DEFAULT_MOON_MASS_KG),
  });
  const safetyAltitudeKm = Number.isFinite(propagation.minEarthAltitudeKm)
    ? propagation.minEarthAltitudeKm
    : Number.NaN;
  const safetyRiskKm = Number.isFinite(safetyAltitudeKm)
    ? Math.max(0, earthSafetyMinAltitudeKm - safetyAltitudeKm)
    : earthSafetyMinAltitudeKm;
  const safetyAccepted = safetyRiskKm <= 0;
  const closingPenalty = Number.isFinite(propagation.closestMoonClosingSpeedKmS)
    ? Math.max(0, -Number(propagation.closestMoonClosingSpeedKmS)) * 10_000
    : 5_000;
  const escapePenalty = Number.isFinite(propagation.finalMoonDistanceKm)
    ? Math.max(0, propagation.finalMoonDistanceKm - predictedMissDistanceKm) * 0.08
    : 0;
  const corridor = evaluateMoonDepartureCorridor({
    predictedMissDistanceKm,
    predictedPeriluneAltitudeKm,
    bPlaneErrorKm,
    plannerConfig: NAVIGATION_DEFAULTS.planner,
    targetPeriluneAltitudeKm,
  });
  const corridorPenalty = corridor.accepted
    ? 0
    : (
      (corridor.missResidualKm * 1.3)
      + (corridor.bPlaneResidualKm * 1.15)
      + (corridor.periluneResidualKm * 0.45)
      + 90_000
    );
  const safetyPenalty = safetyAccepted
    ? 0
    : (2_500_000 + (safetyRiskKm * 25_000));
  const planTimeToCoastSec = Math.max(0, Number(approx.burnDurationSec) || 0);
  const planTransferTimeSec = Number(candidate.transferTimeSec);
  const planTotalTimeSec = totalPlanTimeSec({
    burnDurationSec: planTimeToCoastSec,
    transferTimeSec: planTransferTimeSec,
  });
  const timePenalty = (
    ((planTimeToCoastSec / 3600) * 5_000)
    + ((planTransferTimeSec / 3600) * 350)
  );
  return {
    ...approx,
    cost: (
      predictedMissDistanceKm
      + (Math.abs(predictedPeriluneAltitudeKm - targetPeriluneAltitudeKm) * 0.65)
      + (bPlaneErrorKm * 0.55)
      + corridorPenalty
      + (Number(approx.deltaVNeedKmS) * 450)
      + closingPenalty
      + escapePenalty
      + safetyPenalty
      + timePenalty
    ),
    predictedMissDistanceKm,
    predictedPeriluneAltitudeKm,
    bPlaneErrorKm,
    corridorAccepted: corridor.accepted && safetyAccepted,
    corridorScore: corridor.score,
    corridorReason: safetyAccepted ? corridor.reason : "earth-safety-violation",
    corridorResidualTotalKm: (
      (Number(corridor.missResidualKm) || 0)
      + (Number(corridor.bPlaneResidualKm) || 0)
      + (Number(corridor.periluneResidualKm) || 0)
      + safetyRiskKm
    ),
    planTimeToCoastSec,
    planTransferTimeSec,
    planTotalTimeSec,
    safetyAltitudeKm,
  };
}

function solveHybridMoonOrbitInjectWindow({
  earthState = null,
  moonState = null,
  inclinationDeg = 28.5,
  orbitAltitudeKm = 185,
  earthRadiusKm = DEFAULT_EARTH_RADIUS_KM,
  earthMuKm3S2 = Number.NaN,
  searchProfile = "hybrid",
  nodeSamples = null,
  engineAccelAtThrottle1KmS2 = GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2,
  spacecraftMassKg = 1_250_000,
  spacecraft = null,
} = {}) {
  if (!finiteVector(earthState?.position) || !finiteVector(moonState?.position)) {
    return {
      valid: false,
      optimizerMode: "global-nbody-optimal-departure",
      ascendingNodeRad: 0,
      planeCompositeScore: Number.NaN,
      nodeSamples: 0,
    };
  }
  const profile = departureSolverProfile(searchProfile);
  const sampleCount = clamp(
    Math.round(Number(nodeSamples) || profile.defaultNodeSamples),
    profile.minNodeSamples,
    profile.maxNodeSamples,
  );
  const moonRelPosKm = subtract(moonState.position, earthState.position);
  const moonRelVelKmS = finiteVector(moonState?.velocity) && finiteVector(earthState?.velocity)
    ? subtract(moonState.velocity, earthState.velocity)
    : { x: 0, y: 0, z: 0 };
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
  const propagationSpacecraft = resolvePlannerSpacecraft({
    spacecraft,
    fallbackMassKg: spacecraftMassKg,
    defaultBodyId: "moon_departure_hybrid_optimizer_vehicle",
  });
  const hybridEarthSafetyMinAltitudeKm = GLOBAL_EARTH_SAFETY_MIN_ALTITUDE_KM;
  const phaseSamples = Math.max(8, Math.round(Number(profile.phaseSamples) || FAST_PHASE_SAMPLES));
  const nodeStepRad = (Math.PI * 2) / sampleCount;
  const phaseStepRad = (Math.PI * 2) / phaseSamples;
  const transferReserveOffsetsSec = Array.isArray(profile.transferReserveOffsetsSec) && profile.transferReserveOffsetsSec.length
    ? profile.transferReserveOffsetsSec
    : FAST_TRANSFER_RESERVE_OFFSETS_SEC;
  let best = null;
  let finalists = [];
  for (let nodeIndex = 0; nodeIndex < sampleCount; nodeIndex += 1) {
    const ascendingNodeRad = (nodeIndex / sampleCount) * (Math.PI * 2);
    for (let phaseIndex = 0; phaseIndex < phaseSamples; phaseIndex += 1) {
      const phaseRad = (phaseIndex / phaseSamples) * (Math.PI * 2);
      for (let apoIndex = 0; apoIndex < profile.apoapsisOffsetsKm.length; apoIndex += 1) {
        const apoapsisAltitudeKm = Math.max(
          Number(orbitAltitudeKm) || 185,
          (Number(orbitAltitudeKm) || 185) + profile.apoapsisOffsetsKm[apoIndex],
        );
        for (let reserveIndex = 0; reserveIndex < transferReserveOffsetsSec.length; reserveIndex += 1) {
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
            transferReserveSec: GLOBAL_CONSERVATIVE_LUNAR_LEAD_RESERVE_SEC + transferReserveOffsetsSec[reserveIndex],
          });
          if (!cheap) {
            continue;
          }
          const evaluated = evaluateSinglePropagatedDepartureCandidate({
            sources,
            spacecraft: propagationSpacecraft,
            earthState,
            moonRelPosKm,
            moonRelVelKmS,
            candidate: cheap,
            nominalDeltaVKmS,
            earthSafetyMinAltitudeKm: hybridEarthSafetyMinAltitudeKm,
            engineAccelAtThrottle1KmS2,
          });
          if (!evaluated) {
            continue;
          }
          const candidateBest = {
            ascendingNodeRad,
            cheap,
            evaluated,
            coarseScore: scoreEvaluatedDepartureCandidate(evaluated),
          };
          best = chooseBetterEvaluatedCandidate(best, candidateBest);
          finalists = insertTopScoredCandidate(finalists, candidateBest, profile.nodeFinalistCount);
        }
      }
    }
  }

  for (let finalistIndex = 0; finalistIndex < finalists.length; finalistIndex += 1) {
    const finalist = finalists[finalistIndex];
    const baseNodeRad = Number(finalist?.ascendingNodeRad);
    const basePhaseRad = Number(finalist?.cheap?.phaseRad);
    const baseApoapsisAltitudeKm = Number(finalist?.cheap?.apoapsisAltitudeKm);
    if (
      !Number.isFinite(baseNodeRad)
      || !Number.isFinite(basePhaseRad)
      || !Number.isFinite(baseApoapsisAltitudeKm)
    ) {
      continue;
    }
    const refineNodeOffsets = [-nodeStepRad / 4, -nodeStepRad / 8, 0, nodeStepRad / 8, nodeStepRad / 4];
    const refinePhaseOffsets = [-phaseStepRad / 4, -phaseStepRad / 8, 0, phaseStepRad / 8, phaseStepRad / 4];
    const refineApoOffsetsKm = [-24, -12, 0, 12, 24];
    const refineReserveOffsetsSec = [-3600, -1800, 0, 1800, 3600];
    for (let nodeOffsetIndex = 0; nodeOffsetIndex < refineNodeOffsets.length; nodeOffsetIndex += 1) {
      for (let phaseOffsetIndex = 0; phaseOffsetIndex < refinePhaseOffsets.length; phaseOffsetIndex += 1) {
        for (let apoOffsetIndex = 0; apoOffsetIndex < refineApoOffsetsKm.length; apoOffsetIndex += 1) {
          for (let reserveOffsetIndex = 0; reserveOffsetIndex < refineReserveOffsetsSec.length; reserveOffsetIndex += 1) {
            const ascendingNodeRad = normalizeAngleZeroToTau(baseNodeRad + refineNodeOffsets[nodeOffsetIndex]);
            const cheap = cheapCandidateGeometry({
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
                baseApoapsisAltitudeKm + refineApoOffsetsKm[apoOffsetIndex],
              ),
              phaseRad: normalizeAngleZeroToTau(basePhaseRad + refinePhaseOffsets[phaseOffsetIndex]),
              transferReserveSec: finiteNumber(
                Number(finalist?.cheap?.transferReserveSec) + refineReserveOffsetsSec[reserveOffsetIndex],
                GLOBAL_CONSERVATIVE_LUNAR_LEAD_RESERVE_SEC,
              ),
            });
            if (!cheap) {
              continue;
            }
            const evaluated = evaluateSinglePropagatedDepartureCandidate({
              sources,
            spacecraft: propagationSpacecraft,
              earthState,
              moonRelPosKm,
              moonRelVelKmS,
              candidate: cheap,
              nominalDeltaVKmS,
              earthSafetyMinAltitudeKm: hybridEarthSafetyMinAltitudeKm,
              engineAccelAtThrottle1KmS2,
            });
            best = chooseBetterEvaluatedCandidate(best, evaluated ? {
              ascendingNodeRad,
              cheap,
              evaluated,
            } : null);
          }
        }
      }
    }
  }

  if (best?.cheap) {
    const finalNodeOffsetsRad = [
      rad(-5),
      rad(-2.5),
      0,
      rad(2.5),
      rad(5),
    ];
    const finalPhaseOffsetsRad = [
      rad(-10),
      rad(-5),
      0,
      rad(5),
      rad(10),
    ];
    const finalReserveOffsetsSec = [-3600, -1800, 0, 1800, 3600];
    for (let pass = 0; pass < 2; pass += 1) {
      const centerNodeRad = Number(best?.ascendingNodeRad);
      const centerPhaseRad = Number(best?.cheap?.phaseRad);
      const centerApoapsisAltitudeKm = Number(best?.cheap?.apoapsisAltitudeKm);
      const centerTransferReserveSec = Number(best?.cheap?.transferReserveSec);
      if (
        !Number.isFinite(centerNodeRad)
        || !Number.isFinite(centerPhaseRad)
        || !Number.isFinite(centerApoapsisAltitudeKm)
        || !Number.isFinite(centerTransferReserveSec)
      ) {
        break;
      }
      let improved = false;
      for (let nodeOffsetIndex = 0; nodeOffsetIndex < finalNodeOffsetsRad.length; nodeOffsetIndex += 1) {
        for (let phaseOffsetIndex = 0; phaseOffsetIndex < finalPhaseOffsetsRad.length; phaseOffsetIndex += 1) {
          for (let reserveOffsetIndex = 0; reserveOffsetIndex < finalReserveOffsetsSec.length; reserveOffsetIndex += 1) {
            const ascendingNodeRad = normalizeAngleZeroToTau(centerNodeRad + finalNodeOffsetsRad[nodeOffsetIndex]);
            const cheap = cheapCandidateGeometry({
              earthState,
              moonRelPosKm,
              moonRelVelKmS,
              earthMuKm3S2,
              earthRadiusKm,
              inclinationDeg,
              ascendingNodeRad,
              periapsisAltitudeKm: orbitAltitudeKm,
              apoapsisAltitudeKm: centerApoapsisAltitudeKm,
              phaseRad: normalizeAngleZeroToTau(centerPhaseRad + finalPhaseOffsetsRad[phaseOffsetIndex]),
              transferReserveSec: centerTransferReserveSec + finalReserveOffsetsSec[reserveOffsetIndex],
            });
            if (!cheap) {
              continue;
            }
            const evaluated = evaluateSinglePropagatedDepartureCandidate({
              sources,
              spacecraft,
              earthState,
              moonRelPosKm,
              moonRelVelKmS,
              candidate: cheap,
              nominalDeltaVKmS,
              earthSafetyMinAltitudeKm: hybridEarthSafetyMinAltitudeKm,
              engineAccelAtThrottle1KmS2,
            });
            const candidateBest = evaluated ? {
              ascendingNodeRad,
              cheap,
              evaluated,
            } : null;
            const preferred = chooseBetterEvaluatedCandidate(best, candidateBest);
            if (preferred === candidateBest) {
              best = candidateBest;
              improved = true;
            }
          }
        }
      }
      if (!improved) {
        break;
      }
    }
  }

  const solved = buildSolvedDepartureWindowResult({
    selected: best?.cheap || finalists[0]?.cheap || null,
    evaluated: best?.evaluated || null,
    moonRelPosKm,
    inclinationDeg,
    ascendingNodeRad: Number(best?.ascendingNodeRad) || 0,
    nominalTransferSec,
    nominalDeltaVKmS,
  });
  return {
    ...solved,
    ascendingNodeRad: Number(best?.ascendingNodeRad) || 0,
    planeCompositeScore: (
      (Boolean(solved?.corridorAccepted) ? 10 : 0)
      + (clamp(Number(solved?.corridorScore) || 0, 0, 1) * 0.45)
      + (clamp(Number(solved?.optimalityScore) || 0, 0, 1) * 0.3)
      + (clamp(Number(solved?.geometryScore) || 0, 0, 1) * 0.15)
      + (clamp(Number(solved?.selectedPlaneQuality) || 0, 0, 1) * 0.1)
    ),
    nodeSamples: sampleCount,
  };
}

function bestCheapNodeCandidate({
  earthState = null,
  moonState = null,
  inclinationDeg = 28.5,
  orbitAltitudeKm = 185,
  earthRadiusKm = DEFAULT_EARTH_RADIUS_KM,
  earthMuKm3S2 = Number.NaN,
  ascendingNodeRad = 0,
  searchProfile = "fast",
} = {}) {
  if (!finiteVector(earthState?.position) || !finiteVector(moonState?.position)) {
    return null;
  }
  const profile = departureSolverProfile(searchProfile);
  const moonRelPosKm = subtract(moonState.position, earthState.position);
  const moonRelVelKmS = finiteVector(moonState?.velocity) && finiteVector(earthState?.velocity)
    ? subtract(moonState.velocity, earthState.velocity)
    : { x: 0, y: 0, z: 0 };
  let best = null;
  for (let phaseIndex = 0; phaseIndex < profile.phaseSamples; phaseIndex += 1) {
    const phaseRad = (phaseIndex / profile.phaseSamples) * (Math.PI * 2);
    for (let apoIndex = 0; apoIndex < profile.apoapsisOffsetsKm.length; apoIndex += 1) {
      const apoapsisAltitudeKm = Math.max(
        Number(orbitAltitudeKm) || 185,
        (Number(orbitAltitudeKm) || 185) + profile.apoapsisOffsetsKm[apoIndex],
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
  searchProfile = "fast",
  engineAccelAtThrottle1KmS2 = GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2,
  spacecraftMassKg = 1_250_000,
  spacecraft = null,
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
      selectedCoastEntryAlignment: Number.NaN,
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
    searchProfile,
    engineAccelAtThrottle1KmS2,
    spacecraftMassKg,
    spacecraft,
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
  const phaseReady = !Number.isFinite(phaseErrorDeg)
    || Math.abs(phaseErrorDeg) <= toleranceDeg;
  const corridorAccepted = Boolean(staticWindow?.corridorAccepted);
  const corridorScore = clamp(Number(staticWindow?.corridorScore) || 0, 0, 1);
  const scoreFromError = Number.isFinite(phaseErrorDeg)
    ? clamp(1 - (Math.abs(phaseErrorDeg) / Math.max(1e-9, toleranceDeg * 3.5)), 0, 1)
    : 0;
  const scoreFromWait = Number.isFinite(waitSec)
    ? clamp(1 - (waitSec / (4 * 3600)), 0, 1)
    : 0;
  const staticScore = clamp(Number(staticWindow?.windowScore) || 0, 0, 1);
  const ready = phaseReady && corridorAccepted;
  const windowScore = clamp(
    (staticScore * 0.45)
    + (scoreFromError * 0.2)
    + (scoreFromWait * 0.1)
    + (corridorScore * 0.25),
    0,
    1,
  );

  return {
    valid: Boolean(staticWindow?.valid),
    ready,
    phaseReady,
    corridorAccepted,
    corridorScore,
    reason: !phaseReady
      ? "window-offset"
      : (corridorAccepted ? "window-ready" : String(staticWindow?.corridorReason || "corridor-reject")),
    targetPhaseRad: Number(staticWindow?.targetPhaseRad),
    currentPhaseRad,
    phaseErrorRad,
    phaseErrorDeg,
    waitSec: phaseReady && !corridorAccepted ? Number.NaN : waitSec,
    transferTimeSec: Number(staticWindow?.transferTimeSec),
    leadAngleDeg: Number(staticWindow?.leadAngleDeg),
    estimatedTliDeltaVKmS: Number(staticWindow?.estimatedTliDeltaVKmS),
    windowScore,
    optimalityScore: finiteNumber(staticWindow?.optimalityScore, Number.NaN),
    geometryScore: Number(staticWindow?.geometryScore),
    selectedDepartureAlignment: Number(staticWindow?.selectedDepartureAlignment),
    selectedProjectedAlignment: Number(staticWindow?.selectedProjectedAlignment),
    selectedCoastEntryAlignment: Number(staticWindow?.selectedCoastEntryAlignment),
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

export function evaluateMoonOrbitInjectLocation({
  earthState = null,
  moonState = null,
  inclinationDeg = 28.5,
  ascendingNodeRad = 0,
  orbitAltitudeKm = 185,
  apoapsisAltitudeKm = Number.NaN,
  phaseRad = 0,
  earthRadiusKm = DEFAULT_EARTH_RADIUS_KM,
  earthMuKm3S2 = Number.NaN,
  searchProfile = "fast",
  transferReserveSec = GLOBAL_CONSERVATIVE_LUNAR_LEAD_RESERVE_SEC,
  engineAccelAtThrottle1KmS2 = GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2,
  spacecraftMassKg = 1_250_000,
  spacecraft = null,
} = {}) {
  if (!finiteVector(earthState?.position) || !finiteVector(moonState?.position)) {
    return {
      valid: false,
      ready: false,
      reason: "missing-state",
    };
  }

  const periapsisAltitudeKm = Math.max(120, Number(orbitAltitudeKm) || 185);
  const evaluatedApoapsisAltitudeKm = Number.isFinite(Number(apoapsisAltitudeKm))
    ? Math.max(periapsisAltitudeKm, Number(apoapsisAltitudeKm))
    : periapsisAltitudeKm;
  const normalizedNodeRad = normalizeAngleZeroToTau(Number(ascendingNodeRad) || 0);
  const normalizedPhaseRad = normalizeAngleZeroToTau(Number(phaseRad) || 0);
  const profile = departureSolverProfile(searchProfile);
  const moonRelPosKm = subtract(moonState.position, earthState.position);
  const moonRelVelKmS = finiteVector(moonState?.velocity) && finiteVector(earthState?.velocity)
    ? subtract(moonState.velocity, earthState.velocity)
    : { x: 0, y: 0, z: 0 };
  const candidate = cheapCandidateGeometry({
    earthState,
    moonRelPosKm,
    moonRelVelKmS,
    earthMuKm3S2,
    earthRadiusKm,
    inclinationDeg,
    ascendingNodeRad: normalizedNodeRad,
    periapsisAltitudeKm,
    apoapsisAltitudeKm: evaluatedApoapsisAltitudeKm,
    phaseRad: normalizedPhaseRad,
    transferReserveSec,
  });
  if (!candidate) {
    return {
      valid: false,
      ready: false,
      reason: "candidate-unavailable",
      ascendingNodeRad: normalizedNodeRad,
      phaseRad: normalizedPhaseRad,
      periapsisAltitudeKm,
      apoapsisAltitudeKm: evaluatedApoapsisAltitudeKm,
    };
  }

  const orbitRadiusKm = Math.max(1000, Number(earthRadiusKm) || DEFAULT_EARTH_RADIUS_KM) + periapsisAltitudeKm;
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
  const sources = profile.approximate
    ? null
    : buildMoonGuidanceSourceModel({
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
  const propagationSpacecraft = profile.approximate
    ? null
    : resolvePlannerSpacecraft({
      spacecraft,
      fallbackMassKg: spacecraftMassKg,
      defaultBodyId: "moon_inject_location_probe",
    });
  const evaluated = profile.mode === "hybrid"
    ? evaluateSinglePropagatedDepartureCandidate({
      sources,
      spacecraft: propagationSpacecraft,
      earthState,
      moonRelPosKm,
      moonRelVelKmS,
      candidate,
      nominalDeltaVKmS,
      engineAccelAtThrottle1KmS2,
    })
    : profile.approximate
    ? evaluateApproximateDepartureCandidate({
      earthState,
      moonRelPosKm,
      moonRelVelKmS,
      candidate,
      nominalDeltaVKmS,
      engineAccelAtThrottle1KmS2,
      spacecraft: propagationSpacecraft,
    })
    : evaluatePropagatedDepartureCandidate({
      sources,
      spacecraft,
      candidate,
      nominalDeltaVKmS,
      dvOffsetsKmS: profile.dvOffsetsKmS,
      radialOffsets: profile.radialOffsets,
      normalOffsets: profile.normalOffsets,
      engineAccelAtThrottle1KmS2,
    });
  const solved = buildSolvedDepartureWindowResult({
    selected: candidate,
    evaluated,
    moonRelPosKm,
    inclinationDeg,
    ascendingNodeRad: normalizedNodeRad,
    nominalTransferSec,
    nominalDeltaVKmS,
  });
  return {
    ...solved,
    ascendingNodeRad: normalizedNodeRad,
    phaseRad: normalizedPhaseRad,
    periapsisAltitudeKm,
    apoapsisAltitudeKm: evaluatedApoapsisAltitudeKm,
    spawnPositionKm: cloneVector(candidate.positionKm),
    spawnVelocityKmS: cloneVector(candidate.velocityKmS),
    transferReserveSec: Number(candidate.transferReserveSec),
    evaluationMode: profile.approximate ? "approximate" : "propagated",
  };
}

export function solveBestMoonOrbitInjectWindow({
  nodeSamples = null,
  searchProfile = "fast",
  ...options
} = {}) {
  const profile = departureSolverProfile(searchProfile);
  if (profile.mode === "hybrid") {
    return solveHybridMoonOrbitInjectWindow({
      ...options,
      nodeSamples,
      searchProfile,
    });
  }
  const sampleCount = clamp(
    Math.round(Number(nodeSamples) || profile.defaultNodeSamples),
    profile.minNodeSamples,
    profile.maxNodeSamples,
  );
  const cheapNodes = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const ascendingNodeRad = (index / sampleCount) * (Math.PI * 2);
    const cheap = bestCheapNodeCandidate({
      ...options,
      ascendingNodeRad,
      searchProfile,
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
  const finalists = cheapNodes.slice(0, Math.min(profile.nodeFinalistCount, cheapNodes.length));
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
    (Boolean(window?.corridorAccepted) ? 10 : 0)
    + (clamp(Number(window?.corridorScore) || 0, 0, 1) * 0.45)
    + (clamp(Number(window?.optimalityScore) || 0, 0, 1) * 0.3)
    + (clamp(Number(window?.geometryScore) || 0, 0, 1) * 0.15)
    + (clamp(Number(window?.selectedPlaneQuality) || 0, 0, 1) * 0.1)
  );

  for (let index = 0; index < finalists.length; index += 1) {
    const ascendingNodeRad = finalists[index].ascendingNodeRad;
    const solved = solveMoonDepartureWindow({
      ...options,
      ascendingNodeRad,
      searchProfile,
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
    const refineOffsets = profile.approximate
      ? [
        -nodeStepRad / 3,
        -nodeStepRad / 6,
        nodeStepRad / 6,
        nodeStepRad / 3,
      ]
      : [
        -nodeStepRad / 2,
        -nodeStepRad / 3,
        -nodeStepRad / 6,
        nodeStepRad / 6,
        nodeStepRad / 3,
        nodeStepRad / 2,
      ];
    for (let finalistIndex = 0; finalistIndex < finalists.length; finalistIndex += 1) {
      const baseNodeRad = Number(finalists[finalistIndex]?.ascendingNodeRad);
      if (!Number.isFinite(baseNodeRad)) {
        continue;
      }
      for (let index = 0; index < refineOffsets.length; index += 1) {
        const refinedNodeRad = normalizeAngleZeroToTau(baseNodeRad + refineOffsets[index]);
        const solved = solveMoonDepartureWindow({
          ...options,
          ascendingNodeRad: refinedNodeRad,
          searchProfile,
        });
        const compositeScore = scoreWindow(solved);
        if (compositeScore <= bestCompositeScore) {
          continue;
        }
        bestCompositeScore = compositeScore;
        bestWindow = {
          ...solved,
          ascendingNodeRad: refinedNodeRad,
          planeCompositeScore: compositeScore,
          nodeSamples: sampleCount,
        };
      }
    }
    if (!bestWindow?.ready && profile.useAggressive) {
      const aggressiveBases = finalists
        .map((entry) => Number(entry?.ascendingNodeRad))
        .filter((value, index, values) => Number.isFinite(value) && values.findIndex((candidate) => Math.abs(normalizeSignedAnglePi(candidate - value)) <= 1e-9) === index);
      const aggressiveOffsets = [
        -nodeStepRad / 6,
        -nodeStepRad / 12,
        0,
        nodeStepRad / 12,
        nodeStepRad / 6,
      ];
      for (let baseIndex = 0; baseIndex < aggressiveBases.length; baseIndex += 1) {
        const baseNodeRad = aggressiveBases[baseIndex];
        for (let offsetIndex = 0; offsetIndex < aggressiveOffsets.length; offsetIndex += 1) {
          const refinedNodeRad = normalizeAngleZeroToTau(baseNodeRad + aggressiveOffsets[offsetIndex]);
          const solved = solveMoonDepartureWindow({
            ...options,
            ascendingNodeRad: refinedNodeRad,
            searchProfile: "aggressive",
          });
          const compositeScore = scoreWindow(solved);
          if (compositeScore <= bestCompositeScore) {
            continue;
          }
          bestCompositeScore = compositeScore;
          bestWindow = {
            ...solved,
            ascendingNodeRad: refinedNodeRad,
            planeCompositeScore: compositeScore,
            nodeSamples: sampleCount,
          };
        }
      }

      const focusedOffsets = [-nodeStepRad / 12, -nodeStepRad / 24, nodeStepRad / 24, nodeStepRad / 12];
      const focusBaseNodeRad = Number(bestWindow.ascendingNodeRad);
      for (let index = 0; index < focusedOffsets.length; index += 1) {
        const refinedNodeRad = normalizeAngleZeroToTau(focusBaseNodeRad + focusedOffsets[index]);
        const solved = solveMoonDepartureWindow({
          ...options,
          ascendingNodeRad: refinedNodeRad,
          searchProfile,
        });
        const compositeScore = scoreWindow(solved);
        if (compositeScore <= bestCompositeScore) {
          continue;
        }
        bestCompositeScore = compositeScore;
        bestWindow = {
          ...solved,
          ascendingNodeRad: refinedNodeRad,
          planeCompositeScore: compositeScore,
          nodeSamples: sampleCount,
        };
      }
    }
    return bestWindow;
  }
  return {
    ...solveMoonDepartureWindow({
      ...options,
      searchProfile,
    }),
    ascendingNodeRad: 0,
    planeCompositeScore: Number.NaN,
    nodeSamples: sampleCount,
  };
}

export function evaluateMoonPadLaunchWindow(options = {}) {
  const solved = solveMoonDepartureWindow(options);
  return {
    ready: Boolean(solved.ready),
    valid: Boolean(solved.valid),
    reason: String(solved.reason || ""),
    corridorAccepted: Boolean(solved.corridorAccepted),
    corridorScore: Number(solved.corridorScore),
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

function moonOrbitInjectWindowLaunchScore(window = null) {
  if (!window || typeof window !== "object") {
    return Number.NEGATIVE_INFINITY;
  }
  return (
    (Boolean(window.valid) ? 1_000_000 : 0)
    + (Boolean(window.corridorAccepted) ? 100_000 : 0)
    + (Boolean(window.ready) ? 10_000 : 0)
    + (clamp(Number(window.corridorScore) || 0, 0, 1) * 1_000)
    + (clamp(Number(window.windowScore) || 0, 0, 1) * 500)
    + (clamp(Number(window.optimalityScore) || 0, 0, 1) * 250)
    + (clamp(Number(window.geometryScore) || 0, 0, 1) * 100)
  );
}

export function solveMoonOrbitInjectWindowForLaunch({
  earthState = null,
  moonState = null,
  inclinationDeg = 28.5,
  orbitAltitudeKm = 500,
  earthRadiusKm = DEFAULT_EARTH_RADIUS_KM,
  earthMuKm3S2 = Number.NaN,
  engineAccelAtThrottle1KmS2 = GLOBAL_ENGINE_ACCEL_AT_THROTTLE1_KM_S2,
  spacecraftMassKg = 1_250_000,
  spacecraft = null,
  nodeSamples = 24,
  searchProfile = "hybrid",
} = {}) {
  const normalizedSearchProfile = String(searchProfile || "hybrid").trim().toLowerCase();
  const attempts = normalizedSearchProfile === "browser"
    ? [
      {
        nodeSamples,
        searchProfile: "browser",
      },
    ]
    : [
      {
        nodeSamples,
        searchProfile,
      },
      {
        nodeSamples: Math.max(Number(nodeSamples) || 0, 36),
        searchProfile: "hybrid",
      },
      {
        nodeSamples: Math.max(72, (Number(nodeSamples) || 0) * 3),
        searchProfile: "full",
      },
      {
        nodeSamples: Math.max(96, (Number(nodeSamples) || 0) * 4),
        searchProfile: "aggressive",
      },
    ];
  let bestWindow = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestAcceptedWindow = null;
  let bestAcceptedScore = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    const solved = solveBestMoonOrbitInjectWindow({
      earthState,
      moonState,
      inclinationDeg,
      orbitAltitudeKm,
      earthRadiusKm,
      earthMuKm3S2,
      engineAccelAtThrottle1KmS2,
      spacecraftMassKg,
      spacecraft,
      nodeSamples: attempt.nodeSamples,
      searchProfile: attempt.searchProfile,
    });
    const score = moonOrbitInjectWindowLaunchScore(solved);
    if (score > bestScore) {
      bestScore = score;
      bestWindow = solved;
    }
    if (solved?.valid && solved?.ready && solved?.corridorAccepted && score > bestAcceptedScore) {
      bestAcceptedScore = score;
      bestAcceptedWindow = solved;
    }
    if (bestAcceptedWindow) {
      break;
    }
  }
  return bestAcceptedWindow || bestWindow;
}
