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
  const order = Math.max(0, Math.floor(Number(n) || 0));
  const x = Math.max(-1, Math.min(1, Number(u) || 0));
  if (order === 0) {
    return { p: 1, dp: 0 };
  }
  if (order === 1) {
    return { p: x, dp: 1 };
  }

  let pNm2 = 1;
  let pNm1 = x;
  let dpNm2 = 0;
  let dpNm1 = 1;
  let pN = pNm1;
  let dpN = dpNm1;
  for (let l = 2; l <= order; l += 1) {
    pN = (((2 * l) - 1) * x * pNm1 - ((l - 1) * pNm2)) / l;
    dpN = ((((2 * l) - 1) * (pNm1 + (x * dpNm1))) - ((l - 1) * dpNm2)) / l;
    pNm2 = pNm1;
    pNm1 = pN;
    dpNm2 = dpNm1;
    dpNm1 = dpN;
  }
  return { p: pN, dp: dpN };
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
  const order = Math.max(2, Math.floor(Number(n) || 0));
  if (!(order >= 2)) {
    return { x: 0, y: 0, z: 0 };
  }
  const term = finite(jn, 0);
  if (!(Math.abs(term) > 1e-20)) {
    return { x: 0, y: 0, z: 0 };
  }
  const refOverR = referenceRadiusKm * invRadius;
  const refOverRn = Math.pow(refOverR, order);
  const u = dot(poleUnit, relPosKm) * invRadius;
  const { p, dp } = legendreAndDerivative(order, u);

  // Vector acceleration from zonal harmonic Jn:
  // a_n = μ/r^3 * Jn*(Re/r)^n * [((n+1)Pn + u*Pn') r - (r*Pn') k]
  const coeff = muOverR3 * term * refOverRn;
  const radialFactor = ((order + 1) * p) + (u * dp);
  const polarFactor = dp * radiusKm;
  return {
    x: coeff * ((radialFactor * relPosKm.x) - (polarFactor * poleUnit.x)),
    y: coeff * ((radialFactor * relPosKm.y) - (polarFactor * poleUnit.y)),
    z: coeff * ((radialFactor * relPosKm.z) - (polarFactor * poleUnit.z)),
  };
}

function degree22TesseralAcceleration({
  c22 = 0,
  s22 = 0,
  relPosKm,
  radiusKm,
  invRadius,
  muOverR3,
  referenceRadiusKm,
  poleUnit,
  xAxis,
  yAxis,
}) {
  const c = finite(c22, 0);
  const s = finite(s22, 0);
  if (!(Math.abs(c) > 1e-20 || Math.abs(s) > 1e-20)) {
    return { x: 0, y: 0, z: 0 };
  }
  const xUnit = norm(xAxis);
  const yUnit = norm(yAxis);
  if (!xUnit || !yUnit || !poleUnit) {
    return { x: 0, y: 0, z: 0 };
  }

  const ux = dot(xUnit, relPosKm) * invRadius;
  const uy = dot(yUnit, relPosKm) * invRadius;
  const uz = dot(poleUnit, relPosKm) * invRadius;
  const q22 = (c * ((ux * ux) - (uy * uy))) + (2 * s * ux * uy);
  const termX = (2 * ((c * ux) + (s * uy))) - (5 * ux * q22);
  const termY = (2 * ((s * ux) - (c * uy))) - (5 * uy * q22);
  const termZ = -5 * uz * q22;
  const refOverR = referenceRadiusKm * invRadius;
  const coeff22 = 3 * muOverR3 * refOverR * refOverR * radiusKm;
  const bodyAccel = {
    x: coeff22 * termX,
    y: coeff22 * termY,
    z: coeff22 * termZ,
  };
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
  j4 = 0,
  j6 = 0,
  c22 = 0,
  s22 = 0,
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
    n: 6,
    jn: j6,
    relPosKm,
    radiusKm,
    invRadius,
    muOverR3,
    referenceRadiusKm,
    poleUnit,
  }));

  acc = add(acc, degree22TesseralAcceleration({
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
