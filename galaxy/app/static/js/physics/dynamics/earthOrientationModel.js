import { estimateEarthPrecessionNutationArcsec } from "./earthPrecessionNutationModel.js";

const ARCSEC_TO_RAD = Math.PI / (180 * 3600);
const EARTH_SIDEREAL_ANGULAR_RATE_RAD_PER_SEC = 7.2921150e-5;
const J2000_UNIX_MS = Date.UTC(2000, 0, 1, 12, 0, 0, 0);
let runtimeEarthEopProvider = null;

function finite(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function cross(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function normalize(v, fallback = { x: 0, y: 0, z: 1 }) {
  const magSq = (v.x * v.x) + (v.y * v.y) + (v.z * v.z);
  if (!(magSq > 1e-24)) {
    return { ...fallback };
  }
  const inv = 1 / Math.sqrt(magSq);
  return { x: v.x * inv, y: v.y * inv, z: v.z * inv };
}

function rotateAroundAxis(v, axis, angleRad) {
  const k = normalize(axis);
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const kv = dot(k, v);
  const kxv = cross(k, v);
  return {
    x: (v.x * c) + (kxv.x * s) + (k.x * kv * (1 - c)),
    y: (v.y * c) + (kxv.y * s) + (k.y * kv * (1 - c)),
    z: (v.z * c) + (kxv.z * s) + (k.z * kv * (1 - c)),
  };
}

export function setEarthOrientationRuntimeProvider(provider = null) {
  runtimeEarthEopProvider = typeof provider === "function" ? provider : null;
}

export function estimateEarthOrientationParameters(timestampMs = Date.now()) {
  const ts = finite(timestampMs, Date.now());
  const daysSinceJ2000 = (ts - J2000_UNIX_MS) / 86_400_000;
  const annual = (2 * Math.PI * daysSinceJ2000) / 365.2422;
  const chandler = (2 * Math.PI * daysSinceJ2000) / 433.1;
  const fortnight = (2 * Math.PI * daysSinceJ2000) / 13.6608;
  const precessionNutation = estimateEarthPrecessionNutationArcsec(ts);
  const runtimeEop = runtimeEarthEopProvider?.(ts) || null;

  // Deterministic approximation of EOP behavior (UT1-UTC and polar motion).
  const dut1SecModel =
    (0.12 * Math.sin((0.85 * annual) + 0.7))
    + (0.045 * Math.sin(fortnight - 0.25))
    + (0.018 * Math.sin((0.27 * annual) + 1.9));

  const xpArcsecModel =
    (0.10 * Math.sin(chandler + 0.35))
    + (0.055 * Math.sin(annual - 1.1))
    + (0.018 * Math.sin((2 * annual) + 0.4));
  const ypArcsecModel =
    (0.10 * Math.cos(chandler + 0.2))
    + (0.048 * Math.cos(annual - 0.7))
    + (0.015 * Math.sin((2 * annual) - 0.3));
  const lodSec = finite(runtimeEop?.lodSec, 0);
  const dut1Sec = finite(runtimeEop?.ut1Sec, dut1SecModel);
  const xpArcsec = finite(runtimeEop?.xpArcsec, xpArcsecModel);
  const ypArcsec = finite(runtimeEop?.ypArcsec, ypArcsecModel);
  const angularRateRadS = EARTH_SIDEREAL_ANGULAR_RATE_RAD_PER_SEC * (1 - (lodSec / 86400));
  const sourceLabel = runtimeEop
    ? String(runtimeEop.source || "runtime-eop")
    : "analytic-eop-approx";

  return {
    dut1Sec,
    xpArcsec,
    ypArcsec,
    precessionLongitudeArcsec: finite(precessionNutation?.precessionLongitudeArcsec, 0),
    precessionObliquityArcsec: finite(precessionNutation?.precessionObliquityArcsec, 0),
    nutationLongitudeArcsec: finite(precessionNutation?.nutationLongitudeArcsec, 0),
    nutationObliquityArcsec: finite(precessionNutation?.nutationObliquityArcsec, 0),
    lodSec,
    dut1Rad: dut1Sec * angularRateRadS,
    source: `${sourceLabel}+${String(precessionNutation?.source || "truncated-iau-precession-nutation")}`,
  };
}

export function applyEarthOrientationToAxes({
  xAxis,
  yAxis,
  pole,
  orientation = null,
} = {}) {
  const xBase = normalize(xAxis || { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const yBase = normalize(yAxis || { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 });
  const pBase = normalize(pole || cross(xBase, yBase), { x: 0, y: 0, z: 1 });
  const eop = orientation || estimateEarthOrientationParameters(Date.now());
  const precessionLongitudeRad = finite(eop.precessionLongitudeArcsec, 0) * ARCSEC_TO_RAD;
  const precessionObliquityRad = finite(eop.precessionObliquityArcsec, 0) * ARCSEC_TO_RAD;
  const nutationLongitudeRad = finite(eop.nutationLongitudeArcsec, 0) * ARCSEC_TO_RAD;
  const nutationObliquityRad = finite(eop.nutationObliquityArcsec, 0) * ARCSEC_TO_RAD;
  const xpRad = finite(eop.xpArcsec, 0) * ARCSEC_TO_RAD;
  const ypRad = finite(eop.ypArcsec, 0) * ARCSEC_TO_RAD;

  const precessionSpinRad = precessionLongitudeRad + nutationLongitudeRad;
  const obliquityTiltRad = precessionObliquityRad + nutationObliquityRad;
  const eclipticNormal = { x: 0, y: 0, z: 1 };
  const eclipticX = { x: 1, y: 0, z: 0 };
  const pAfterPrecSpin = rotateAroundAxis(pBase, eclipticNormal, -precessionSpinRad);
  const pAfterPrec = rotateAroundAxis(pAfterPrecSpin, eclipticX, obliquityTiltRad);
  const xAfterPrecSpin = rotateAroundAxis(xBase, eclipticNormal, -precessionSpinRad);
  const xAfterPrec = rotateAroundAxis(xAfterPrecSpin, eclipticX, obliquityTiltRad);
  const yAfterPrecSpin = rotateAroundAxis(yBase, eclipticNormal, -precessionSpinRad);
  const yAfterPrec = rotateAroundAxis(yAfterPrecSpin, eclipticX, obliquityTiltRad);
  const yPrecAxis = normalize(yAfterPrec, yBase);
  const xPrecAxis = normalize(xAfterPrec, xBase);

  // Approximate terrestrial frame rotations: small tilts around local y/x axes.
  const pAfterY = rotateAroundAxis(pAfterPrec, yPrecAxis, -xpRad);
  const pAfterXY = rotateAroundAxis(pAfterY, xPrecAxis, ypRad);
  const xAfterY = rotateAroundAxis(xAfterPrec, yPrecAxis, -xpRad);
  const xAfterXY = rotateAroundAxis(xAfterY, xPrecAxis, ypRad);

  const poleUnit = normalize(pAfterXY, pAfterPrec);
  const xOrtho = normalize({
    x: xAfterXY.x - (dot(xAfterXY, poleUnit) * poleUnit.x),
    y: xAfterXY.y - (dot(xAfterXY, poleUnit) * poleUnit.y),
    z: xAfterXY.z - (dot(xAfterXY, poleUnit) * poleUnit.z),
  }, xBase);
  const yOrtho = normalize(cross(poleUnit, xOrtho), yBase);

  return {
    xAxis: xOrtho,
    yAxis: yOrtho,
    pole: poleUnit,
    orientationSource: String(eop.source || "analytic-eop-approx"),
    dut1Sec: finite(eop.dut1Sec, 0),
    xpArcsec: finite(eop.xpArcsec, 0),
    ypArcsec: finite(eop.ypArcsec, 0),
    precessionLongitudeArcsec: finite(eop.precessionLongitudeArcsec, 0),
    precessionObliquityArcsec: finite(eop.precessionObliquityArcsec, 0),
    nutationLongitudeArcsec: finite(eop.nutationLongitudeArcsec, 0),
    nutationObliquityArcsec: finite(eop.nutationObliquityArcsec, 0),
    lodSec: finite(eop.lodSec, 0),
  };
}
