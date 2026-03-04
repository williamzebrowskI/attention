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

const EARTH_MU_KM3_S2 = 398600.4418;
const MOON_RADIUS_KM = 1737.4;
const TWO_PI = Math.PI * 2;

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback);
}

function ensureMoonGncRuntime(moonRuntime) {
  if (!moonRuntime || typeof moonRuntime !== "object") {
    return null;
  }
  if (!moonRuntime.gnc || typeof moonRuntime.gnc !== "object") {
    moonRuntime.gnc = {
      lastSolveSec: null,
      lastSolveReason: "",
      lastCommandMode: "",
      solution: null,
      predictedMissDistanceKm: null,
      predictedPeriluneAltitudeKm: null,
      bPlaneErrorKm: null,
      deltaVNeedKmS: null,
    };
  }
  return moonRuntime.gnc;
}

function clampVectorMagnitude(vector, maxMagnitude) {
  const cap = Math.max(0, Number(maxMagnitude) || 0);
  if (!(cap > 0) || !finiteVector(vector)) {
    return { x: 0, y: 0, z: 0 };
  }
  const magnitude = length(vector);
  if (!(magnitude > cap)) {
    return vector;
  }
  return scale(vector, cap / magnitude);
}

function stumpffC(z) {
  const value = Number(z) || 0;
  if (value > 1e-9) {
    const root = Math.sqrt(value);
    return (1 - Math.cos(root)) / value;
  }
  if (value < -1e-9) {
    const root = Math.sqrt(-value);
    return (Math.cosh(root) - 1) / (-value);
  }
  return 0.5;
}

function stumpffS(z) {
  const value = Number(z) || 0;
  if (value > 1e-9) {
    const root = Math.sqrt(value);
    return (root - Math.sin(root)) / (root * root * root);
  }
  if (value < -1e-9) {
    const root = Math.sqrt(-value);
    return (Math.sinh(root) - root) / (root * root * root);
  }
  return 1 / 6;
}

function propagateTwoBodyUniversal({
  r0Km = null,
  v0KmS = null,
  dtSec = 0,
  muKm3S2 = EARTH_MU_KM3_S2,
} = {}) {
  if (!finiteVector(r0Km) || !finiteVector(v0KmS)) {
    return null;
  }
  const dt = Number(dtSec) || 0;
  const mu = Math.max(1, Number(muKm3S2) || EARTH_MU_KM3_S2);
  if (Math.abs(dt) <= 1e-9) {
    return {
      positionKm: { ...r0Km },
      velocityKmS: { ...v0KmS },
    };
  }
  const r0 = { x: Number(r0Km.x) || 0, y: Number(r0Km.y) || 0, z: Number(r0Km.z) || 0 };
  const v0 = { x: Number(v0KmS.x) || 0, y: Number(v0KmS.y) || 0, z: Number(v0KmS.z) || 0 };
  const r0mag = Math.max(1e-9, length(r0));
  const v0mag2 = dot(v0, v0);
  const vr0 = dot(r0, v0) / r0mag;
  const alpha = (2 / r0mag) - (v0mag2 / mu);
  const sqrtMu = Math.sqrt(mu);

  let x = Math.abs(alpha) > 1e-9
    ? (Math.sign(dt) || 1) * Math.sqrt(mu) * Math.abs(alpha) * Math.abs(dt)
    : (Math.sign(dt) || 1) * Math.sqrt(mu) * Math.abs(dt) / r0mag;
  if (!Number.isFinite(x)) {
    x = 0;
  }

  for (let i = 0; i < 64; i += 1) {
    const z = alpha * x * x;
    const C = stumpffC(z);
    const S = stumpffS(z);
    const F = (
      ((r0mag * vr0) / sqrtMu) * x * x * C
      + (1 - (alpha * r0mag)) * x * x * x * S
      + (r0mag * x)
      - (sqrtMu * dt)
    );
    const dF = (
      ((r0mag * vr0) / sqrtMu) * x * (1 - (z * S))
      + (1 - (alpha * r0mag)) * x * x * C
      + r0mag
    );
    if (Math.abs(F) <= 1e-7) {
      break;
    }
    if (!(Math.abs(dF) > 1e-12)) {
      break;
    }
    x -= F / dF;
  }

  const z = alpha * x * x;
  const C = stumpffC(z);
  const S = stumpffS(z);
  const f = 1 - ((x * x * C) / r0mag);
  const g = dt - ((x * x * x * S) / sqrtMu);
  const positionKm = add(scale(r0, f), scale(v0, g));
  const rmag = Math.max(1e-9, length(positionKm));
  const fdot = (sqrtMu / (rmag * r0mag)) * ((alpha * x * x * x * S) - x);
  const gdot = 1 - ((x * x * C) / rmag);
  const velocityKmS = add(scale(r0, fdot), scale(v0, gdot));
  if (!finiteVector(positionKm) || !finiteVector(velocityKmS)) {
    return null;
  }
  return {
    positionKm,
    velocityKmS,
  };
}

function lambertTofForZ({
  z = 0,
  r1magKm = 0,
  r2magKm = 0,
  A = 0,
  muKm3S2 = EARTH_MU_KM3_S2,
} = {}) {
  const C = stumpffC(z);
  const S = stumpffS(z);
  if (!(C > 1e-12)) {
    return null;
  }
  const y = r1magKm + r2magKm + (A * (((z * S) - 1) / Math.sqrt(C)));
  if (!(y > 1e-9)) {
    return null;
  }
  const x = Math.sqrt(y / C);
  const tofSec = (
    ((x * x * x * S) + (A * Math.sqrt(y)))
    / Math.sqrt(Math.max(1, Number(muKm3S2) || EARTH_MU_KM3_S2))
  );
  if (!(tofSec > 0) || !Number.isFinite(tofSec)) {
    return null;
  }
  return {
    tofSec,
    y,
    C,
    S,
  };
}

function solveLambertUniversal({
  r1Km = null,
  r2Km = null,
  tofSec = 0,
  muKm3S2 = EARTH_MU_KM3_S2,
} = {}) {
  if (!finiteVector(r1Km) || !finiteVector(r2Km)) {
    return null;
  }
  const r1 = { x: Number(r1Km.x) || 0, y: Number(r1Km.y) || 0, z: Number(r1Km.z) || 0 };
  const r2 = { x: Number(r2Km.x) || 0, y: Number(r2Km.y) || 0, z: Number(r2Km.z) || 0 };
  const r1mag = Math.max(1e-9, length(r1));
  const r2mag = Math.max(1e-9, length(r2));
  const cosDeltaNu = clamp(dot(r1, r2) / (r1mag * r2mag), -1, 1);
  const sinDeltaNu = Math.sqrt(Math.max(0, 1 - (cosDeltaNu * cosDeltaNu)));
  if (!(sinDeltaNu > 1e-9)) {
    return null;
  }
  const denom = Math.max(1e-9, 1 - cosDeltaNu);
  const A = sinDeltaNu * Math.sqrt((r1mag * r2mag) / denom);
  if (!(Math.abs(A) > 1e-9)) {
    return null;
  }

  const tofTargetSec = Math.max(1, Number(tofSec) || 1);
  let bestZ = 0;
  let bestData = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let z = -24; z <= 24; z += 0.2) {
    const data = lambertTofForZ({
      z,
      r1magKm: r1mag,
      r2magKm: r2mag,
      A,
      muKm3S2,
    });
    if (!data) {
      continue;
    }
    const diff = Math.abs(data.tofSec - tofTargetSec);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestData = data;
      bestZ = z;
    }
  }
  if (!bestData) {
    return null;
  }
  let step = 0.1;
  for (let i = 0; i < 44; i += 1) {
    const plus = lambertTofForZ({
      z: bestZ + step,
      r1magKm: r1mag,
      r2magKm: r2mag,
      A,
      muKm3S2,
    });
    const minus = lambertTofForZ({
      z: bestZ - step,
      r1magKm: r1mag,
      r2magKm: r2mag,
      A,
      muKm3S2,
    });
    const diffPlus = plus ? Math.abs(plus.tofSec - tofTargetSec) : Number.POSITIVE_INFINITY;
    const diffMinus = minus ? Math.abs(minus.tofSec - tofTargetSec) : Number.POSITIVE_INFINITY;
    if (diffPlus < bestDiff || diffMinus < bestDiff) {
      if (diffPlus <= diffMinus) {
        bestZ += step;
        bestData = plus;
        bestDiff = diffPlus;
      } else {
        bestZ -= step;
        bestData = minus;
        bestDiff = diffMinus;
      }
      continue;
    }
    step *= 0.5;
    if (step < 1e-5) {
      break;
    }
  }

  const y = Number(bestData?.y);
  if (!(y > 1e-9)) {
    return null;
  }
  const f = 1 - (y / r1mag);
  const g = A * Math.sqrt(y / Math.max(1, Number(muKm3S2) || EARTH_MU_KM3_S2));
  const gdot = 1 - (y / r2mag);
  if (!(Math.abs(g) > 1e-12)) {
    return null;
  }
  const v1KmS = scale(subtract(r2, scale(r1, f)), 1 / g);
  const v2KmS = scale(subtract(scale(r2, gdot), r1), 1 / g);
  if (!finiteVector(v1KmS) || !finiteVector(v2KmS)) {
    return null;
  }
  return {
    departureVelocityKmS: v1KmS,
    arrivalVelocityKmS: v2KmS,
    tofSec: tofTargetSec,
    z: bestZ,
    fitErrorSec: bestDiff,
  };
}

function predictRelativeStateAtTof({
  shipEarthPositionKm = null,
  shipEarthVelocityKmS = null,
  moonEarthPositionKm = null,
  moonEarthVelocityKmS = null,
  tofSec = 0,
  muKm3S2 = EARTH_MU_KM3_S2,
} = {}) {
  const shipFuture = propagateTwoBodyUniversal({
    r0Km: shipEarthPositionKm,
    v0KmS: shipEarthVelocityKmS,
    dtSec: tofSec,
    muKm3S2,
  });
  const moonFuture = propagateTwoBodyUniversal({
    r0Km: moonEarthPositionKm,
    v0KmS: moonEarthVelocityKmS,
    dtSec: tofSec,
    muKm3S2,
  });
  if (!shipFuture || !moonFuture) {
    return null;
  }
  const relativePositionKm = subtract(shipFuture.positionKm, moonFuture.positionKm);
  const relativeVelocityKmS = subtract(shipFuture.velocityKmS, moonFuture.velocityKmS);
  if (!finiteVector(relativePositionKm) || !finiteVector(relativeVelocityKmS)) {
    return null;
  }
  return {
    relativePositionKm,
    relativeVelocityKmS,
    shipFuture,
    moonFuture,
  };
}

function invert3x3(matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 3) {
    return null;
  }
  const a = matrix[0][0];
  const b = matrix[0][1];
  const c = matrix[0][2];
  const d = matrix[1][0];
  const e = matrix[1][1];
  const f = matrix[1][2];
  const g = matrix[2][0];
  const h = matrix[2][1];
  const i = matrix[2][2];
  const A = ((e * i) - (f * h));
  const B = -((d * i) - (f * g));
  const C = ((d * h) - (e * g));
  const D = -((b * i) - (c * h));
  const E = ((a * i) - (c * g));
  const F = -((a * h) - (b * g));
  const G = ((b * f) - (c * e));
  const H = -((a * f) - (c * d));
  const I = ((a * e) - (b * d));
  const det = (a * A) + (b * B) + (c * C);
  if (!(Math.abs(det) > 1e-10)) {
    return null;
  }
  const invDet = 1 / det;
  return [
    [A * invDet, D * invDet, G * invDet],
    [B * invDet, E * invDet, H * invDet],
    [C * invDet, F * invDet, I * invDet],
  ];
}

function multiplyMatrixVector(matrix, vector) {
  return {
    x: ((matrix[0][0] * vector.x) + (matrix[0][1] * vector.y) + (matrix[0][2] * vector.z)),
    y: ((matrix[1][0] * vector.x) + (matrix[1][1] * vector.y) + (matrix[1][2] * vector.z)),
    z: ((matrix[2][0] * vector.x) + (matrix[2][1] * vector.y) + (matrix[2][2] * vector.z)),
  };
}

function solveDifferentialCorrectionDv({
  shipEarthPositionKm = null,
  shipEarthVelocityKmS = null,
  moonEarthPositionKm = null,
  moonEarthVelocityKmS = null,
  tofSec = 0,
  muKm3S2 = EARTH_MU_KM3_S2,
  correctionGain = 0.45,
  correctionMaxDvKmS = 0.35,
  epsilonKmS = 0.001,
} = {}) {
  const basePrediction = predictRelativeStateAtTof({
    shipEarthPositionKm,
    shipEarthVelocityKmS,
    moonEarthPositionKm,
    moonEarthVelocityKmS,
    tofSec,
    muKm3S2,
  });
  if (!basePrediction) {
    return {
      correctionDvKmS: { x: 0, y: 0, z: 0 },
      baseMissDistanceKm: Number.POSITIVE_INFINITY,
    };
  }
  const baseMiss = basePrediction.relativePositionKm;
  const eps = Math.max(1e-5, Number(epsilonKmS) || 0.001);
  const jacobian = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const axes = [
    { x: eps, y: 0, z: 0 },
    { x: 0, y: eps, z: 0 },
    { x: 0, y: 0, z: eps },
  ];
  for (let axisIndex = 0; axisIndex < axes.length; axisIndex += 1) {
    const perturbedPrediction = predictRelativeStateAtTof({
      shipEarthPositionKm,
      shipEarthVelocityKmS: add(shipEarthVelocityKmS, axes[axisIndex]),
      moonEarthPositionKm,
      moonEarthVelocityKmS,
      tofSec,
      muKm3S2,
    });
    if (!perturbedPrediction) {
      return {
        correctionDvKmS: { x: 0, y: 0, z: 0 },
        baseMissDistanceKm: length(baseMiss),
      };
    }
    const dPos = scale(subtract(perturbedPrediction.relativePositionKm, baseMiss), 1 / eps);
    jacobian[0][axisIndex] = Number(dPos.x) || 0;
    jacobian[1][axisIndex] = Number(dPos.y) || 0;
    jacobian[2][axisIndex] = Number(dPos.z) || 0;
  }

  const inv = invert3x3(jacobian);
  if (!inv) {
    return {
      correctionDvKmS: { x: 0, y: 0, z: 0 },
      baseMissDistanceKm: length(baseMiss),
    };
  }
  const missNeg = scale(baseMiss, -1);
  let correctionDvKmS = multiplyMatrixVector(inv, missNeg);
  correctionDvKmS = scale(
    correctionDvKmS,
    clamp(Number(correctionGain) || 0, 0, 1),
  );
  correctionDvKmS = clampVectorMagnitude(
    correctionDvKmS,
    Math.max(0, Number(correctionMaxDvKmS) || 0.35),
  );
  return {
    correctionDvKmS,
    baseMissDistanceKm: length(baseMiss),
  };
}

function solveBestLambertTransfer({
  shipEarthPositionKm = null,
  shipEarthVelocityKmS = null,
  moonEarthPositionKm = null,
  moonEarthVelocityKmS = null,
  plannerConfig = {},
} = {}) {
  if (
    !finiteVector(shipEarthPositionKm)
    || !finiteVector(shipEarthVelocityKmS)
    || !finiteVector(moonEarthPositionKm)
    || !finiteVector(moonEarthVelocityKmS)
  ) {
    return null;
  }
  const muKm3S2 = Math.max(1, Number(plannerConfig?.moonLambertCentralBodyMuKm3S2) || EARTH_MU_KM3_S2);
  const tofMinSec = Math.max(2 * 3600, Number(plannerConfig?.moonLambertMinTofSec) || (42 * 3600));
  const tofMaxSec = Math.max(tofMinSec + 3600, Number(plannerConfig?.moonLambertMaxTofSec) || (120 * 3600));
  const tofStepSec = Math.max(900, Number(plannerConfig?.moonLambertTofStepSec) || 3600);

  let best = null;
  for (let tofSec = tofMinSec; tofSec <= tofMaxSec; tofSec += tofStepSec) {
    const moonFuture = propagateTwoBodyUniversal({
      r0Km: moonEarthPositionKm,
      v0KmS: moonEarthVelocityKmS,
      dtSec: tofSec,
      muKm3S2,
    });
    if (!moonFuture) {
      continue;
    }
    const lambert = solveLambertUniversal({
      r1Km: shipEarthPositionKm,
      r2Km: moonFuture.positionKm,
      tofSec,
      muKm3S2,
    });
    if (!lambert) {
      continue;
    }
    const departureDvKmS = length(subtract(lambert.departureVelocityKmS, shipEarthVelocityKmS));
    const arrivalRelSpeedKmS = length(subtract(lambert.arrivalVelocityKmS, moonFuture.velocityKmS));
    const score = (
      departureDvKmS
      + (arrivalRelSpeedKmS * 0.22)
      + ((tofSec / Math.max(1, tofMaxSec)) * 0.08)
    );
    if (!best || score < best.score) {
      best = {
        tofSec,
        score,
        departureVelocityKmS: lambert.departureVelocityKmS,
        arrivalVelocityKmS: lambert.arrivalVelocityKmS,
        departureDvKmS,
        arrivalRelSpeedKmS,
        moonFuturePositionKm: moonFuture.positionKm,
        moonFutureVelocityKmS: moonFuture.velocityKmS,
        fitErrorSec: lambert.fitErrorSec,
      };
    }
  }
  return best;
}

function makeCoastDirection({ toMoonDirection = null, tangent = null, up = null } = {}) {
  const moonDir = normalize(toMoonDirection, tangent || { x: 0, y: 1, z: 0 });
  const tan = normalize(tangent, moonDir);
  const upDir = normalize(up, { x: 0, y: 0, z: 1 });
  return normalize(
    add(
      scale(moonDir, 0.84),
      add(scale(tan, 0.13), scale(upDir, 0.03)),
    ),
    moonDir,
  );
}

export function planMoonLambertGncCommand({
  phase = "",
  targetVectors = {},
  metrics = {},
  plannerConfig = {},
  plannerRuntime = null,
  timestampSec = Number.NaN,
} = {}) {
  const moonRuntime = plannerRuntime?.moon || null;
  const gncRuntime = ensureMoonGncRuntime(moonRuntime);
  const shipEarthPositionKm = targetVectors.shipEarthPositionKm;
  const shipEarthVelocityKmS = targetVectors.shipEarthVelocityKmS;
  const moonEarthPositionKm = targetVectors.moonEarthPositionKm;
  const moonEarthVelocityKmS = targetVectors.moonEarthVelocityKmS;
  const tangent = normalize(targetVectors.tangent, { x: 0, y: 1, z: 0 });
  const up = normalize(targetVectors.up, { x: 0, y: 0, z: 1 });
  const toMoon = normalize(targetVectors.toMoon, tangent);
  if (
    !gncRuntime
    || !finiteVector(shipEarthPositionKm)
    || !finiteVector(shipEarthVelocityKmS)
    || !finiteVector(moonEarthPositionKm)
    || !finiteVector(moonEarthVelocityKmS)
  ) {
    return null;
  }

  const phaseName = String(phase || "").trim();
  const isTli = phaseName === "tli_burn";
  const nowSec = Number(timestampSec);
  const cadenceSec = Math.max(20, Number(plannerConfig?.moonLambertCadenceSec) || 45);
  const lastSolveSec = Number(gncRuntime.lastSolveSec);
  const solveDue = !Number.isFinite(lastSolveSec) || !Number.isFinite(nowSec)
    || ((nowSec - lastSolveSec) >= cadenceSec);

  let solvedThisStep = false;
  if (solveDue || !gncRuntime.solution) {
    const solution = solveBestLambertTransfer({
      shipEarthPositionKm,
      shipEarthVelocityKmS,
      moonEarthPositionKm,
      moonEarthVelocityKmS,
      plannerConfig,
    });
    gncRuntime.solution = solution;
    gncRuntime.lastSolveSec = Number.isFinite(nowSec) ? nowSec : gncRuntime.lastSolveSec;
    gncRuntime.lastSolveReason = solution ? "lambert-global-optimal" : "lambert-no-solution";
    solvedThisStep = Boolean(solution);
  }
  const solution = gncRuntime.solution;
  if (!solution) {
    const fallbackDirection = makeCoastDirection({
      toMoonDirection: toMoon,
      tangent,
      up,
    });
    gncRuntime.lastCommandMode = "navsys:gnc-lambert-unavailable";
    return {
      phase: "coast",
      throttle: 0,
      direction: fallbackDirection,
      mode: "navsys:gnc-lambert-unavailable",
      diagnostics: {
        requestedMode: "global-optimal-lambert-differential-gnc",
        solveReady: false,
      },
    };
  }

  const muKm3S2 = Math.max(1, Number(plannerConfig?.moonLambertCentralBodyMuKm3S2) || EARTH_MU_KM3_S2);
  const moonRadiusKm = Math.max(100, Number(metrics.moonRadiusKm) || MOON_RADIUS_KM);
  const diffCorr = solveDifferentialCorrectionDv({
    shipEarthPositionKm,
    shipEarthVelocityKmS,
    moonEarthPositionKm,
    moonEarthVelocityKmS,
    tofSec: solution.tofSec,
    muKm3S2,
    correctionGain: clamp(Number(plannerConfig?.moonLambertDiffCorrGain) || 0.45, 0, 1),
    correctionMaxDvKmS: Math.max(0, Number(plannerConfig?.moonLambertDiffCorrMaxDvKmS) || 0.35),
    epsilonKmS: Math.max(1e-5, Number(plannerConfig?.moonLambertDiffCorrEpsKmS) || 0.001),
  });
  const lambertDvKmS = subtract(solution.departureVelocityKmS, shipEarthVelocityKmS);
  const maxBurnDvKmS = Math.max(0.02, Number(plannerConfig?.moonLambertBurnMaxDvKmS) || 1.8);
  const commandedDvKmS = clampVectorMagnitude(
    add(lambertDvKmS, diffCorr.correctionDvKmS),
    maxBurnDvKmS,
  );
  const deltaVNeedKmS = length(commandedDvKmS);
  const commandedDepartureVelocityKmS = add(shipEarthVelocityKmS, commandedDvKmS);

  const predictedState = predictRelativeStateAtTof({
    shipEarthPositionKm,
    shipEarthVelocityKmS: commandedDepartureVelocityKmS,
    moonEarthPositionKm,
    moonEarthVelocityKmS,
    tofSec: solution.tofSec,
    muKm3S2,
  });
  const predictedMissDistanceKm = predictedState
    ? Math.max(0, length(predictedState.relativePositionKm))
    : Number.POSITIVE_INFINITY;
  const predictedPeriluneAltitudeKm = Number.isFinite(predictedMissDistanceKm)
    ? Math.max(0, predictedMissDistanceKm - moonRadiusKm)
    : Number.POSITIVE_INFINITY;
  const predictedBPlaneErrorKm = predictedMissDistanceKm;
  const predictedClosingSpeedKmS = (
    predictedState
    && finiteVector(predictedState.relativePositionKm)
    && finiteVector(predictedState.relativeVelocityKmS)
    && predictedMissDistanceKm > 1e-9
  )
    ? -dot(
      predictedState.relativeVelocityKmS,
      scale(predictedState.relativePositionKm, 1 / predictedMissDistanceKm),
    )
    : Number.NaN;

  moonRuntime.approach.projectedPeriluneAltitudeKm = Number.isFinite(predictedPeriluneAltitudeKm)
    ? predictedPeriluneAltitudeKm
    : null;
  moonRuntime.approach.corridorErrorKm = Number.isFinite(predictedPeriluneAltitudeKm)
    ? (predictedPeriluneAltitudeKm - Math.max(20, Number(plannerConfig?.moonTargetPeriluneAltitudeKm) || 120))
    : null;
  moonRuntime.approach.bPlaneErrorKm = Number.isFinite(predictedBPlaneErrorKm)
    ? predictedBPlaneErrorKm
    : null;
  moonRuntime.approach.timeToClosestSec = Number.isFinite(solution.tofSec) ? solution.tofSec : null;

  const approachDistanceKm = Math.max(10_000, Number(plannerConfig?.moonCaptureGateDistanceKm) || 55_000);
  const moonDistanceKm = Number(metrics.moonDistanceKm);
  const nearApproach = Number.isFinite(moonDistanceKm) && moonDistanceKm <= (approachDistanceKm * 1.7);
  const deadbandKmS = Math.max(
    0.0005,
    isTli
      ? (Number(plannerConfig?.moonLambertTliBurnDvDeadbandKmS) || 0.01)
      : (Number(plannerConfig?.moonLambertMidcourseDvDeadbandKmS) || 0.004),
  );
  const throttleScaleKmS = Math.max(0.02, Number(plannerConfig?.moonLambertThrottleDvScaleKmS) || 1.2);
  const throttleMin = clamp(Number(plannerConfig?.moonLambertThrottleMin) || 0.08, 0.01, 1);
  const throttleMax = clamp(Number(plannerConfig?.moonLambertThrottleMax) || 0.78, throttleMin, 1);

  let phaseOut = "coast";
  let throttleOut = 0;
  let directionOut = makeCoastDirection({
    toMoonDirection: toMoon,
    tangent,
    up,
  });
  let mode = isTli
    ? "navsys:gnc-lambert-tli-coast"
    : "navsys:gnc-lambert-midcourse-coast";

  if (!nearApproach && deltaVNeedKmS > deadbandKmS) {
    phaseOut = "powered";
    throttleOut = clamp(deltaVNeedKmS / throttleScaleKmS, throttleMin, throttleMax);
    directionOut = normalize(commandedDvKmS, directionOut);
    mode = isTli
      ? "navsys:gnc-lambert-tli-burn"
      : "navsys:gnc-lambert-midcourse-correction";
    if (length(diffCorr.correctionDvKmS) > 1e-4) {
      mode = `${mode}+diffcorr`;
    }
  } else if (nearApproach && !isTli) {
    mode = "navsys:gnc-lambert-approach-coast";
  }
  if (solvedThisStep) {
    mode = `${mode}+retarget`;
  }
  gncRuntime.lastCommandMode = mode;
  gncRuntime.predictedMissDistanceKm = Number.isFinite(predictedMissDistanceKm)
    ? predictedMissDistanceKm
    : null;
  gncRuntime.predictedPeriluneAltitudeKm = Number.isFinite(predictedPeriluneAltitudeKm)
    ? predictedPeriluneAltitudeKm
    : null;
  gncRuntime.bPlaneErrorKm = Number.isFinite(predictedBPlaneErrorKm)
    ? predictedBPlaneErrorKm
    : null;
  gncRuntime.deltaVNeedKmS = Number.isFinite(deltaVNeedKmS) ? deltaVNeedKmS : null;

  moonRuntime.approach.lastDecision = mode;
  return {
    phase: phaseOut,
    throttle: throttleOut,
    direction: directionOut,
    mode,
    diagnostics: {
      requestedMode: "global-optimal-lambert-differential-gnc",
      tofSec: Number(solution.tofSec),
      missDistanceKm: Number.isFinite(predictedMissDistanceKm) ? predictedMissDistanceKm : null,
      missGateKm: Math.max(
        Number(plannerConfig?.moonMidcourseMissDistanceKm) || 95_000,
        Number(plannerConfig?.moonCaptureGateDistanceKm) || 55_000,
      ),
      bPlaneErrorKm: Number.isFinite(predictedBPlaneErrorKm) ? predictedBPlaneErrorKm : null,
      periluneEstimateKm: Number.isFinite(predictedPeriluneAltitudeKm) ? predictedPeriluneAltitudeKm : null,
      deltaVNeedKmS: Number.isFinite(deltaVNeedKmS) ? deltaVNeedKmS : null,
      correctionDvKmS: Number.isFinite(length(diffCorr.correctionDvKmS))
        ? length(diffCorr.correctionDvKmS)
        : null,
      fitErrorSec: Number.isFinite(solution.fitErrorSec) ? solution.fitErrorSec : null,
      predictedClosingSpeedKmS: Number.isFinite(predictedClosingSpeedKmS)
        ? predictedClosingSpeedKmS
        : null,
      solveReady: true,
    },
  };
}
