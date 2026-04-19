function finite(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function norm(v) {
  const magSq = (v.x * v.x) + (v.y * v.y) + (v.z * v.z);
  if (!(magSq > 1e-24)) {
    return null;
  }
  const inv = 1 / Math.sqrt(magSq);
  return { x: v.x * inv, y: v.y * inv, z: v.z * inv };
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function scale(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function legendreAndDerivative(n, u) {
  return associatedLegendreAndDerivative(n, 0, u);
}

function associatedLegendreValue(n, m, x) {
  const degree = Math.max(0, Math.floor(Number(n) || 0));
  const order = Math.max(0, Math.floor(Number(m) || 0));
  const u = Math.max(-1, Math.min(1, Number(x) || 0));
  if (order > degree) {
    return 0;
  }
  if (order === 0 && degree === 0) {
    return 1;
  }
  if (degree === 0) {
    return 1;
  }
  let pmm = 1;
  if (order > 0) {
    const root = Math.sqrt(Math.max(0, 1 - (u * u)));
    let odd = 1;
    for (let i = 1; i <= order; i += 1) {
      pmm *= -(odd * root);
      odd += 2;
    }
  }
  if (degree === order) {
    return pmm;
  }
  let pnm1m = u * ((2 * order) + 1) * pmm;
  if (degree === order + 1) {
    return pnm1m;
  }
  let pnm2m = pmm;
  let pnm = pnm1m;
  for (let l = order + 2; l <= degree; l += 1) {
    pnm = ((((2 * l) - 1) * u * pnm1m) - ((l + order - 1) * pnm2m)) / (l - order);
    pnm2m = pnm1m;
    pnm1m = pnm;
  }
  return pnm;
}

function associatedLegendreAndDerivative(n, m, u) {
  const degree = Math.max(0, Math.floor(Number(n) || 0));
  const order = Math.max(0, Math.floor(Number(m) || 0));
  const x = Math.max(-1, Math.min(1, Number(u) || 0));
  const p = associatedLegendreValue(degree, order, x);
  if (!(degree >= order)) {
    return { p: 0, dp: 0 };
  }
  if (degree === 0) {
    return { p, dp: 0 };
  }
  const denom = (x * x) - 1;
  if (Math.abs(denom) <= 1e-10) {
    const h = 1e-6;
    const lo = Math.max(-1, Math.min(1, x - h));
    const hi = Math.max(-1, Math.min(1, x + h));
    const plo = associatedLegendreValue(degree, order, lo);
    const phi = associatedLegendreValue(degree, order, hi);
    const span = Math.max(1e-12, hi - lo);
    return { p, dp: (phi - plo) / span };
  }
  const prev = associatedLegendreValue(degree - 1, order, x);
  const dp = ((degree * x * p) - ((degree + order) * prev)) / denom;
  return { p, dp };
}

function zonalTermAcceleration({
  n,
  jn,
  relPosKm,
  radiusKm,
  invRadius,
  muOverR3,
  referenceRadiusKm,
  poleUnit,
}) {
  const degree = Math.max(2, Math.floor(Number(n) || 0));
  if (!(degree >= 2)) {
    return { x: 0, y: 0, z: 0 };
  }
  const term = finite(jn, 0);
  if (!(Math.abs(term) > 1e-20)) {
    return { x: 0, y: 0, z: 0 };
  }
  const refOverR = referenceRadiusKm * invRadius;
  const refOverRn = Math.pow(refOverR, degree);
  const u = dot(poleUnit, relPosKm) * invRadius;
  const { p, dp } = associatedLegendreAndDerivative(degree, 0, u);
  const coeff = muOverR3 * term * refOverRn;
  const radialFactor = ((degree + 1) * p) + (u * dp);
  const polarFactor = dp * radiusKm;
  return {
    x: coeff * ((radialFactor * relPosKm.x) - (polarFactor * poleUnit.x)),
    y: coeff * ((radialFactor * relPosKm.y) - (polarFactor * poleUnit.y)),
    z: coeff * ((radialFactor * relPosKm.z) - (polarFactor * poleUnit.z)),
  };
}

function genericTesseralHarmonicAcceleration({
  harmonicTerms = null,
  c21 = 0,
  s21 = 0,
  c22 = 0,
  s22 = 0,
  relPosKm,
  radiusKm,
  invRadius = 0,
  muOverR3 = 0,
  referenceRadiusKm,
  poleUnit,
  xAxis,
  yAxis,
}) {
  const xUnit = norm(xAxis);
  const yUnit = norm(yAxis);
  if (!xUnit || !yUnit || !poleUnit) {
    return { x: 0, y: 0, z: 0 };
  }
  const terms = Array.isArray(harmonicTerms) && harmonicTerms.length > 0
    ? harmonicTerms
    : [
      { n: 2, m: 1, c: finite(c21, 0), s: finite(s21, 0) },
      { n: 2, m: 2, c: finite(c22, 0), s: finite(s22, 0) },
    ].filter((term) => Math.abs(term.c) > 1e-20 || Math.abs(term.s) > 1e-20);
  if (terms.length <= 0) {
    return { x: 0, y: 0, z: 0 };
  }

  const bodyX = dot(xUnit, relPosKm);
  const bodyY = dot(yUnit, relPosKm);
  const bodyZ = dot(poleUnit, relPosKm);
  const rhoSq = (bodyX * bodyX) + (bodyY * bodyY);
  const rho = Math.sqrt(Math.max(0, rhoSq));
  const cosPhi = rho * invRadius;
  const sinPhi = bodyZ * invRadius;
  const lambda = Math.atan2(bodyY, bodyX);
  const muOverR2 = muOverR3 * radiusKm;

  let radial = 0;
  let latitudinal = 0;
  let longitudinal = 0;
  for (const rawTerm of terms) {
    const n = Math.max(2, Math.floor(Number(rawTerm?.n) || 0));
    const m = Math.max(1, Math.floor(Number(rawTerm?.m) || 0));
    const c = finite(rawTerm?.c, 0);
    const s = finite(rawTerm?.s, 0);
    if (!(n >= m) || !(Math.abs(c) > 1e-20 || Math.abs(s) > 1e-20)) {
      continue;
    }
    const refOverRn = Math.pow(referenceRadiusKm * invRadius, n);
    const { p, dp } = associatedLegendreAndDerivative(n, m, sinPhi);
    const trigAngle = m * lambda;
    const cosMLambda = Math.cos(trigAngle);
    const sinMLambda = Math.sin(trigAngle);
    const aCoeff = (c * cosMLambda) + (s * sinMLambda);
    const bCoeff = (-c * sinMLambda) + (s * cosMLambda);
    radial += -((n + 1) * refOverRn * p * aCoeff);
    latitudinal += refOverRn * dp * cosPhi * aCoeff;
    if (cosPhi > 1e-12) {
      longitudinal += refOverRn * m * p * bCoeff / cosPhi;
    }
  }
  const eR = {
    x: bodyX * invRadius,
    y: bodyY * invRadius,
    z: bodyZ * invRadius,
  };
  const ePhi = rho > 1e-12
    ? {
      x: -(sinPhi * bodyX) / rho,
      y: -(sinPhi * bodyY) / rho,
      z: cosPhi,
    }
    : { x: 0, y: 0, z: 1 };
  const eLambda = rho > 1e-12
    ? {
      x: -bodyY / rho,
      y: bodyX / rho,
      z: 0,
    }
    : { x: 0, y: 1, z: 0 };
  const bodyAccel = add(
    add(scale(eR, muOverR2 * radial), scale(ePhi, muOverR2 * latitudinal)),
    scale(eLambda, muOverR2 * longitudinal),
  );
  return add(
    add(scale(xUnit, bodyAccel.x), scale(yUnit, bodyAccel.y)),
    scale(poleUnit, bodyAccel.z),
  );
}

export function computeOblateGravityPerturbationKmS2({
  relPosKm,
  radiusKm,
  muOverR3,
  referenceRadiusKm,
  pole,
  xAxis,
  yAxis,
  j2 = 0,
  j3 = 0,
  j4 = 0,
  j5 = 0,
  j6 = 0,
  c21 = 0,
  s21 = 0,
  c22 = 0,
  s22 = 0,
  harmonicTerms = null,
} = {}) {
  if (!relPosKm || !(radiusKm > 1e-12) || !(referenceRadiusKm > 0) || !(muOverR3 > 0)) {
    return { x: 0, y: 0, z: 0 };
  }
  const poleUnit = norm(pole);
  if (!poleUnit) {
    return { x: 0, y: 0, z: 0 };
  }
  const invRadius = 1 / radiusKm;
  let acc = { x: 0, y: 0, z: 0 };

  acc = add(acc, zonalTermAcceleration({
    n: 2,
    jn: j2,
    relPosKm,
    radiusKm,
    invRadius,
    muOverR3,
    referenceRadiusKm,
    poleUnit,
  }));
  acc = add(acc, zonalTermAcceleration({
    n: 3,
    jn: j3,
    relPosKm,
    radiusKm,
    invRadius,
    muOverR3,
    referenceRadiusKm,
    poleUnit,
  }));
  acc = add(acc, zonalTermAcceleration({
    n: 4,
    jn: j4,
    relPosKm,
    radiusKm,
    invRadius,
    muOverR3,
    referenceRadiusKm,
    poleUnit,
  }));
  acc = add(acc, zonalTermAcceleration({
    n: 5,
    jn: j5,
    relPosKm,
    radiusKm,
    invRadius,
    muOverR3,
    referenceRadiusKm,
    poleUnit,
  }));
  acc = add(acc, zonalTermAcceleration({
    n: 6,
    jn: j6,
    relPosKm,
    radiusKm,
    invRadius,
    muOverR3,
    referenceRadiusKm,
    poleUnit,
  }));

  acc = add(acc, genericTesseralHarmonicAcceleration({
    harmonicTerms,
    c21,
    s21,
    c22,
    s22,
    relPosKm,
    radiusKm,
    invRadius,
    muOverR3,
    referenceRadiusKm,
    poleUnit,
    xAxis,
    yAxis,
  }));

  return acc;
}
