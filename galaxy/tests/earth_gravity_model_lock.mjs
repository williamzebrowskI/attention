import assert from "node:assert/strict";

import { earthConventionalGravityModel } from "../app/static/js/physics/dynamics/earthGravityModel.js";
import { computeOblateGravityPerturbationKmS2 } from "../app/static/js/physics/dynamics/oblateGravityPerturbation.js";

function assertApprox(actual, expected, tolerance, label) {
  const a = Number(actual);
  const e = Number(expected);
  const t = Number(tolerance);
  assert(
    Number.isFinite(a) && Number.isFinite(e) && Number.isFinite(t) && Math.abs(a - e) <= t,
    `${label}: expected ${e} +/- ${t}, got ${a}`,
  );
}

const j2000 = earthConventionalGravityModel(Date.UTC(2000, 0, 1, 12, 0, 0, 0));
assertApprox(j2000.j2, 1.0826358699107248e-3, 1e-15, "J2000 Earth J2");
assertApprox(j2000.j3, -2.532410499800157e-6, 1e-15, "J2000 Earth J3");
assertApprox(j2000.j4, -1.6198977e-6, 1e-15, "J2000 Earth J4");
assertApprox(j2000.j5, -2.2775359073083618e-7, 1e-18, "J2000 Earth J5");
assertApprox(j2000.j6, 5.406665762838132e-7, 1e-18, "J2000 Earth J6");
assertApprox(j2000.c21, -2.667394752374837e-10, 1e-21, "Earth static C21");
assertApprox(j2000.s21, 1.7872706485240434e-9, 1e-21, "Earth static S21");
assertApprox(j2000.c22, 1.574615325722917e-6, 1e-18, "Earth C22");
assertApprox(j2000.s22, -9.038727891965667e-7, 1e-18, "Earth S22");
assertApprox(j2000.equatorialRadiusKm, 6378.1363, 1e-9, "Earth gravity reference radius");
assert(Array.isArray(j2000.harmonics) && j2000.harmonics.length === 20, "expected degree-2..6 Earth harmonics");

const future = earthConventionalGravityModel(Date.UTC(2050, 0, 1, 12, 0, 0, 0));
assert(future.j2 < j2000.j2, `expected secular J2 decrease, got ${future.j2} vs ${j2000.j2}`);
assert(future.j3 < j2000.j3, `expected secular J3 more negative, got ${future.j3} vs ${j2000.j3}`);
assert(future.j4 < j2000.j4, `expected secular J4 more negative, got ${future.j4} vs ${j2000.j4}`);

const oriented = earthConventionalGravityModel(Date.UTC(2026, 3, 18, 16, 0, 0), {
  xpArcsec: 0.12,
  ypArcsec: 0.33,
});
assertApprox(oriented.c21, -9.013154295388545e-10, 1e-21, "Earth C21 with orientation input");
assertApprox(oriented.s21, 3.5153759023277804e-9, 1e-21, "Earth S21 with orientation input");
assert(Array.isArray(oriented.harmonics) && oriented.harmonics.length === 20, "expected low-degree Earth harmonics");

const relNorth = { x: 5250, y: 0, z: 4620 };
const relSouth = { x: 5250, y: 0, z: -4620 };
const radiusKm = Math.hypot(relNorth.x, relNorth.y, relNorth.z);
const muOverR3 = 398600.4418 / (radiusKm ** 3);
const baseAxes = {
  pole: { x: 0, y: 0, z: 1 },
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 1, z: 0 },
};

const northNoJ3 = computeOblateGravityPerturbationKmS2({
  relPosKm: relNorth,
  radiusKm,
  muOverR3,
  referenceRadiusKm: j2000.equatorialRadiusKm,
  ...baseAxes,
  j2: j2000.j2,
  j4: j2000.j4,
  j6: j2000.j6,
  c22: j2000.c22,
  s22: j2000.s22,
});
const northWithJ3 = computeOblateGravityPerturbationKmS2({
  relPosKm: relNorth,
  radiusKm,
  muOverR3,
  referenceRadiusKm: j2000.equatorialRadiusKm,
  ...baseAxes,
  j2: j2000.j2,
  j3: j2000.j3,
  j4: j2000.j4,
  j6: j2000.j6,
  c22: j2000.c22,
  s22: j2000.s22,
});
const southNoJ3 = computeOblateGravityPerturbationKmS2({
  relPosKm: relSouth,
  radiusKm,
  muOverR3,
  referenceRadiusKm: j2000.equatorialRadiusKm,
  ...baseAxes,
  j2: j2000.j2,
  j4: j2000.j4,
  j6: j2000.j6,
  c22: j2000.c22,
  s22: j2000.s22,
});
const southWithJ3 = computeOblateGravityPerturbationKmS2({
  relPosKm: relSouth,
  radiusKm,
  muOverR3,
  referenceRadiusKm: j2000.equatorialRadiusKm,
  ...baseAxes,
  j2: j2000.j2,
  j3: j2000.j3,
  j4: j2000.j4,
  j6: j2000.j6,
  c22: j2000.c22,
  s22: j2000.s22,
});

const northJ3DeltaZ = Number(northWithJ3.z) - Number(northNoJ3.z);
const northJ3DeltaX = Number(northWithJ3.x) - Number(northNoJ3.x);
const southJ3DeltaZ = Number(southWithJ3.z) - Number(southNoJ3.z);
const southJ3DeltaX = Number(southWithJ3.x) - Number(southNoJ3.x);
assert(Math.abs(northJ3DeltaZ) > 1e-11, `expected non-trivial J3 vertical contribution, got ${northJ3DeltaZ}`);
assert(Math.abs(northJ3DeltaX) > 1e-11, `expected non-trivial J3 radial contribution, got ${northJ3DeltaX}`);
assert(
  Math.sign(northJ3DeltaX) === -Math.sign(southJ3DeltaX),
  "expected J3 odd-zonal radial asymmetry to flip sign across the equator",
);
assert(
  Math.sign(northJ3DeltaZ) === Math.sign(southJ3DeltaZ),
  "expected J3 vertical contribution to preserve sign across mirrored latitudes",
);

const relTesseral = { x: 5100, y: 1200, z: 4700 };
const radiusTesseralKm = Math.hypot(relTesseral.x, relTesseral.y, relTesseral.z);
const muOverR3Tesseral = 398600.4418 / (radiusTesseralKm ** 3);
const tesseralWithoutDegree21 = computeOblateGravityPerturbationKmS2({
  relPosKm: relTesseral,
  radiusKm: radiusTesseralKm,
  muOverR3: muOverR3Tesseral,
  referenceRadiusKm: oriented.equatorialRadiusKm,
  ...baseAxes,
  j2: oriented.j2,
  j3: oriented.j3,
  j4: oriented.j4,
  j5: oriented.j5,
  j6: oriented.j6,
  harmonicTerms: oriented.harmonics.filter((term) => !(term.n === 2 && term.m === 1)),
});
const tesseralFull = computeOblateGravityPerturbationKmS2({
  relPosKm: relTesseral,
  radiusKm: radiusTesseralKm,
  muOverR3: muOverR3Tesseral,
  referenceRadiusKm: oriented.equatorialRadiusKm,
  ...baseAxes,
  j2: oriented.j2,
  j3: oriented.j3,
  j4: oriented.j4,
  j5: oriented.j5,
  j6: oriented.j6,
  harmonicTerms: oriented.harmonics,
});
const tesseralDegree21DeltaY = Number(tesseralFull.y) - Number(tesseralWithoutDegree21.y);
assert(Math.abs(tesseralDegree21DeltaY) > 1e-12, `expected non-trivial degree-2 order-1 contribution, got ${tesseralDegree21DeltaY}`);

const tesseralDegree2Only = computeOblateGravityPerturbationKmS2({
  relPosKm: relTesseral,
  radiusKm: radiusTesseralKm,
  muOverR3: muOverR3Tesseral,
  referenceRadiusKm: oriented.equatorialRadiusKm,
  ...baseAxes,
  j2: oriented.j2,
  j3: oriented.j3,
  j4: oriented.j4,
  j5: oriented.j5,
  j6: oriented.j6,
  harmonicTerms: oriented.harmonics.filter((term) => term.n === 2),
});
const higherDegreeTesseralDeltaX = Number(tesseralFull.x) - Number(tesseralDegree2Only.x);
assert(Math.abs(higherDegreeTesseralDeltaX) > 1e-11, `expected non-trivial degree-3..6 tesseral/sectorial contribution, got ${higherDegreeTesseralDeltaX}`);

console.log("earth-gravity-model-lock: ok");
