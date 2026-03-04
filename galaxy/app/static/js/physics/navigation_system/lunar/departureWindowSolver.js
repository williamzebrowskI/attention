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

const DEFAULT_MOON_ORBIT_PERIOD_SEC = 27.321661 * 86400;

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

function projectToPlane(vector, planeNormal) {
  if (!finiteVector(vector) || !finiteVector(planeNormal)) {
    return null;
  }
  return subtract(vector, scale(planeNormal, dot(vector, planeNormal)));
}

function launchPlaneBasis(inclinationDeg = 28.5) {
  const incRad = rad(clamp(Number(inclinationDeg) || 28.5, 0, 89.5));
  const e1 = { x: 1, y: 0, z: 0 };
  const e2 = normalize(
    { x: 0, y: Math.cos(incRad), z: Math.sin(incRad) },
    { x: 0, y: 1, z: 0 },
  );
  const planeNormal = normalize(
    { x: 0, y: -Math.sin(incRad), z: Math.cos(incRad) },
    { x: 0, y: 0, z: 1 },
  );
  return { e1, e2, planeNormal };
}

function launchPlanePhaseAngleRad({
  vector = null,
  inclinationDeg = 28.5,
} = {}) {
  if (!finiteVector(vector)) {
    return Number.NaN;
  }
  const basis = launchPlaneBasis(inclinationDeg);
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

function launchInjectStateForPhase({
  phaseRad = 0,
  basis = null,
  orbitRadiusKm = Number.NaN,
} = {}) {
  if (!basis || !(Number(orbitRadiusKm) > 1000)) {
    return null;
  }
  const cTheta = Math.cos(Number(phaseRad) || 0);
  const sTheta = Math.sin(Number(phaseRad) || 0);
  const relPositionKm = add(
    scale(basis.e1, orbitRadiusKm * cTheta),
    scale(basis.e2, orbitRadiusKm * sTheta),
  );
  const relVelocityDirection = normalize(
    add(
      scale(basis.e1, -sTheta),
      scale(basis.e2, cTheta),
    ),
    { x: 0, y: 1, z: 0 },
  );
  return {
    relPositionKm,
    relVelocityDirection,
  };
}

function launchPlaneUnitFromPhase({
  phaseRad = 0,
  basis = null,
} = {}) {
  if (!basis) {
    return null;
  }
  const cTheta = Math.cos(Number(phaseRad) || 0);
  const sTheta = Math.sin(Number(phaseRad) || 0);
  return normalize(
    add(
      scale(basis.e1, cTheta),
      scale(basis.e2, sTheta),
    ),
    basis.e1,
  );
}

function evaluateDepartureGeometryCandidate({
  targetPhaseRad = Number.NaN,
  basis = null,
  orbitRadiusKm = Number.NaN,
  moonRelPosKm = null,
  moonPhaseRad = Number.NaN,
  moonRateRadS = Number.NaN,
  transferTimeSec = Number.NaN,
} = {}) {
  if (!Number.isFinite(Number(targetPhaseRad)) || !finiteVector(moonRelPosKm) || !basis) {
    return null;
  }
  const injectState = launchInjectStateForPhase({
    phaseRad: Number(targetPhaseRad),
    basis,
    orbitRadiusKm,
  });
  if (!injectState?.relPositionKm || !injectState?.relVelocityDirection) {
    return null;
  }
  const moonFromShipNow = subtract(moonRelPosKm, injectState.relPositionKm);
  const moonRangeNowKm = length(moonFromShipNow);
  const moonFromShipNowDirection = normalize(moonFromShipNow, basis.e1);
  const toMoonNowAlignment = clamp(
    dot(injectState.relVelocityDirection, moonFromShipNowDirection),
    -1,
    1,
  );

  const projectedMoonPhaseRad = (
    Number.isFinite(Number(moonPhaseRad)) && Number.isFinite(Number(moonRateRadS)) && Number.isFinite(Number(transferTimeSec))
      ? normalizeAngleZeroToTau(Number(moonPhaseRad) + (Number(moonRateRadS) * Number(transferTimeSec)))
      : Number.NaN
  );
  const projectedMoonDirection = launchPlaneUnitFromPhase({
    phaseRad: projectedMoonPhaseRad,
    basis,
  });
  const projectedMoonAlignment = projectedMoonDirection
    ? clamp(dot(injectState.relVelocityDirection, projectedMoonDirection), -1, 1)
    : 0;
  const outOfPlaneFraction = clamp(
    Math.abs(dot(moonFromShipNowDirection, basis.planeNormal)),
    0,
    1,
  );
  const planeQuality = 1 - outOfPlaneFraction;
  const rangePenalty = clamp(
    (Math.max(0, moonRangeNowKm - 420_000) / 220_000),
    0,
    1,
  );
  const score = clamp(
    (((toMoonNowAlignment + 1) * 0.5) * 0.50)
    + (((projectedMoonAlignment + 1) * 0.5) * 0.35)
    + (planeQuality * 0.15)
    - (rangePenalty * 0.05),
    0,
    1,
  );
  return {
    targetPhaseRad: Number(targetPhaseRad),
    toMoonNowAlignment,
    projectedMoonAlignment,
    planeQuality,
    rangeNowKm: moonRangeNowKm,
    score,
  };
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

function halfTransferTimeSec({
  startRadiusKm = Number.NaN,
  targetRadiusKm = Number.NaN,
  earthMuKm3S2 = Number.NaN,
} = {}) {
  const r1Km = Number(startRadiusKm);
  const r2Km = Number(targetRadiusKm);
  const mu = Number(earthMuKm3S2);
  if (!(r1Km > 1000) || !(r2Km > r1Km) || !(mu > 0)) {
    return Number.NaN;
  }
  const semiMajorAxisKm = (r1Km + r2Km) * 0.5;
  if (!(semiMajorAxisKm > 0)) {
    return Number.NaN;
  }
  return Math.PI * Math.sqrt((semiMajorAxisKm ** 3) / mu);
}

function transferDeltaVEstimateKmS({
  orbitRadiusKm = Number.NaN,
  targetRadiusKm = Number.NaN,
  earthMuKm3S2 = Number.NaN,
} = {}) {
  const r1 = Number(orbitRadiusKm);
  const r2 = Number(targetRadiusKm);
  const mu = Number(earthMuKm3S2);
  if (!(r1 > 1000) || !(r2 > r1) || !(mu > 0)) {
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

export function solveMoonDepartureWindow({
  earthState = null,
  moonState = null,
  shipPositionKm = null,
  inclinationDeg = 28.5,
  orbitAltitudeKm = 150,
  earthRadiusKm = 6371,
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
      toleranceDeg: Math.max(0.1, Number(phaseToleranceDeg) || 3.5),
    };
  }

  const moonRelPosKm = subtract(moonState.position, earthState.position);
  const moonDistanceKm = Math.sqrt(dot(moonRelPosKm, moonRelPosKm));
  const moonRelVelKmS = finiteVector(moonState?.velocity) && finiteVector(earthState?.velocity)
    ? subtract(moonState.velocity, earthState.velocity)
    : null;
  const basis = launchPlaneBasis(inclinationDeg);
  const signedRateRadS = signedPlanarAngularRateRadS({
    positionKm: moonRelPosKm,
    velocityKmS: moonRelVelKmS,
    basis,
  });
  const moonRateRadS = Number.isFinite(signedRateRadS)
    ? signedRateRadS
    : ((Math.PI * 2) / DEFAULT_MOON_ORBIT_PERIOD_SEC);

  const orbitRadiusKm = Math.max(1000, Number(earthRadiusKm) || 6371) + Math.max(120, Number(orbitAltitudeKm) || 150);
  const transferTimeSec = halfTransferTimeSec({
    startRadiusKm: orbitRadiusKm,
    targetRadiusKm: moonDistanceKm,
    earthMuKm3S2,
  });
  const baselineLeadRad = Number.isFinite(transferTimeSec)
    ? (moonRateRadS * transferTimeSec)
    : rad(62);
  const leadSign = baselineLeadRad >= 0 ? 1 : -1;
  const leadMagnitude = clamp(Math.abs(baselineLeadRad), rad(25), rad(110));
  const leadRad = leadMagnitude * leadSign;

  const moonPhaseRad = launchPlanePhaseAngleRad({
    vector: moonRelPosKm,
    inclinationDeg,
  });
  const nominalPhaseAheadRad = Number.isFinite(moonPhaseRad)
    ? normalizeAngleZeroToTau(moonPhaseRad - (Math.PI * 0.5) + Math.abs(leadMagnitude))
    : Number.NaN;
  const nominalPhaseBehindRad = Number.isFinite(moonPhaseRad)
    ? normalizeAngleZeroToTau(moonPhaseRad - (Math.PI * 0.5) - Math.abs(leadMagnitude))
    : Number.NaN;
  const candidateGeometries = [
    evaluateDepartureGeometryCandidate({
      targetPhaseRad: nominalPhaseAheadRad,
      basis,
      orbitRadiusKm,
      moonRelPosKm,
      moonPhaseRad,
      moonRateRadS,
      transferTimeSec,
    }),
    evaluateDepartureGeometryCandidate({
      targetPhaseRad: nominalPhaseBehindRad,
      basis,
      orbitRadiusKm,
      moonRelPosKm,
      moonPhaseRad,
      moonRateRadS,
      transferTimeSec,
    }),
  ].filter(Boolean);
  const sortedCandidates = [...candidateGeometries]
    .sort((a, b) => Number(b.score) - Number(a.score));
  // For mission usability, prefer launch geometries where the Moon is in the
  // forward hemisphere of the injected prograde track "now" and at projection time.
  const selectedGeometry = (
    sortedCandidates.find(
      (candidate) => (
        Number(candidate.toMoonNowAlignment) >= 0.10
        && Number(candidate.projectedMoonAlignment) >= -0.05
      ),
    )
    || sortedCandidates.find((candidate) => Number(candidate.toMoonNowAlignment) >= 0)
    || sortedCandidates[0]
    || null
  );
  const targetPhaseRad = selectedGeometry
    ? Number(selectedGeometry.targetPhaseRad)
    : (
      Number.isFinite(moonPhaseRad)
        ? normalizeAngleZeroToTau(moonPhaseRad - (Math.PI * 0.5) + leadRad)
        : Number.NaN
    );
  const currentPhaseRad = launchPlanePhaseAngleRad({
    vector: finiteVector(shipPositionKm)
      ? subtract(shipPositionKm, earthState.position)
      : null,
    inclinationDeg,
  });
  const phaseErrorRad = (
    Number.isFinite(targetPhaseRad) && Number.isFinite(currentPhaseRad)
      ? normalizeSignedAnglePi(targetPhaseRad - currentPhaseRad)
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

  const estimatedTliDeltaVKmS = transferDeltaVEstimateKmS({
    orbitRadiusKm,
    targetRadiusKm: moonDistanceKm,
    earthMuKm3S2,
  });

  const scoreFromError = Number.isFinite(phaseErrorDeg)
    ? clamp(1 - (Math.abs(phaseErrorDeg) / Math.max(1e-9, toleranceDeg * 3.5)), 0, 1)
    : 0;
  const scoreFromWait = Number.isFinite(waitSec)
    ? clamp(1 - (waitSec / (4 * 3600)), 0, 1)
    : 0;
  const scoreFromGeometry = clamp(Number(selectedGeometry?.score) || 0, 0, 1);
  const windowScore = clamp(
    (scoreFromError * 0.55)
    + (scoreFromWait * 0.25)
    + (scoreFromGeometry * 0.2),
    0,
    1,
  );

  return {
    valid: Number.isFinite(targetPhaseRad),
    ready,
    reason: ready ? "window-ready" : "window-offset",
    targetPhaseRad,
    currentPhaseRad,
    phaseErrorRad,
    phaseErrorDeg,
    waitSec,
    transferTimeSec,
    leadAngleDeg: Number.isFinite(leadRad) ? deg(leadRad) : Number.NaN,
    estimatedTliDeltaVKmS,
    windowScore,
    geometryScore: scoreFromGeometry,
    selectedDepartureAlignment: selectedGeometry
      ? Number(selectedGeometry.toMoonNowAlignment)
      : Number.NaN,
    selectedProjectedAlignment: selectedGeometry
      ? Number(selectedGeometry.projectedMoonAlignment)
      : Number.NaN,
    selectedPlaneQuality: selectedGeometry
      ? Number(selectedGeometry.planeQuality)
      : Number.NaN,
    toleranceDeg,
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
  };
}
