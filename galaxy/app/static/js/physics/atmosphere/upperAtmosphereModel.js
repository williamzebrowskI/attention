const UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K = 8.314462618;
const EARTH_MEAN_RADIUS_KM = 6_371.0084;
const EARTH_G0_MS2 = 9.80665;
const BASE_ALTITUDE_KM = 86;
const BASE_TEMPERATURE_K = 186.946;
const BASE_MEAN_MOLAR_MASS_KG_PER_MOL = 0.0289644;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function localSolarTimeHours(timestampMs, longitudeDeg) {
  const ts = Number(timestampMs);
  const lon = Number(longitudeDeg);
  if (!Number.isFinite(ts) || !Number.isFinite(lon)) {
    return 12;
  }
  const date = new Date(ts);
  const utcHours = date.getUTCHours() + (date.getUTCMinutes() / 60) + (date.getUTCSeconds() / 3600);
  let localHours = utcHours + (lon / 15);
  while (localHours < 0) {
    localHours += 24;
  }
  while (localHours >= 24) {
    localHours -= 24;
  }
  return localHours;
}

function dayOfYearUtc(timestampMs) {
  const date = new Date(Number(timestampMs) || Date.now());
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return 1 + Math.floor((current - start) / 86_400_000);
}

function gravityMs2AtAltitudeKm(altitudeKm) {
  const r = EARTH_MEAN_RADIUS_KM + Math.max(0, Number(altitudeKm) || 0);
  const ratio = EARTH_MEAN_RADIUS_KM / Math.max(1, r);
  return EARTH_G0_MS2 * ratio * ratio;
}

function smoothStep(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(1e-9, edge1 - edge0), 0, 1);
  return t * t * (3 - (2 * t));
}

function blend(a, b, t) {
  return a + ((b - a) * t);
}

function meanMolarMassKgPerMol(altitudeKm) {
  const z = Math.max(BASE_ALTITUDE_KM, Number(altitudeKm) || BASE_ALTITUDE_KM);
  const t1 = smoothStep(90, 130, z);
  const t2 = smoothStep(120, 220, z);
  const t3 = smoothStep(220, 520, z);
  const t4 = smoothStep(520, 900, z);
  const m120 = blend(BASE_MEAN_MOLAR_MASS_KG_PER_MOL, 0.020, t1);
  const m220 = blend(m120, 0.012, t2);
  const m520 = blend(m220, 0.006, t3);
  return blend(m520, 0.0043, t4);
}

function effectiveGeomagneticIndex(kp, kpHistory) {
  const base = clamp(Number(kp) || 3, 0, 9);
  const history = Array.isArray(kpHistory) ? kpHistory : [];
  if (history.length <= 0) {
    return base;
  }
  const weights = [0.34, 0.23, 0.16, 0.11, 0.07, 0.05, 0.03, 0.01];
  let weighted = 0;
  let totalWeight = 0;
  for (let i = 0; i < weights.length; i += 1) {
    const w = weights[i];
    const sample = i === 0
      ? base
      : clamp(Number(history[i - 1]?.kp), 0, 9);
    if (!Number.isFinite(sample)) {
      continue;
    }
    weighted += sample * w;
    totalWeight += w;
  }
  if (!(totalWeight > 0)) {
    return base;
  }
  return weighted / totalWeight;
}

function exosphericTemperatureK({
  altitudeKm,
  latitudeDeg = 0,
  longitudeDeg = 0,
  timestampMs = Date.now(),
  f107 = 150,
  kp = 3,
  kpHistory = [],
} = {}) {
  const z = Math.max(BASE_ALTITUDE_KM, Number(altitudeKm) || BASE_ALTITUDE_KM);
  const latRad = (Math.PI / 180) * (Number(latitudeDeg) || 0);
  const lst = localSolarTimeHours(timestampMs, longitudeDeg);
  const doy = dayOfYearUtc(timestampMs);
  const f107Clamped = clamp(Number(f107) || 150, 60, 300);
  const kpClamped = clamp(Number(kp) || 3, 0, 9);
  const kpEffective = effectiveGeomagneticIndex(kpClamped, kpHistory);

  const solarComponent = 680 + (3.1 * (f107Clamped - 70));
  const geomagneticComponent = 32 * kpEffective;
  const stormMemoryComponent = 14 * Math.max(0, kpEffective - kpClamped);
  const diurnalComponent = 90 * Math.cos(((lst - 14) / 24) * Math.PI * 2) * (0.55 + (0.45 * Math.cos(latRad)));
  const seasonalComponent = 28 * Math.sin(((doy - 30) / 365.25) * Math.PI * 2) * Math.cos(latRad);
  const altitudeBlend = smoothStep(90, 180, z);
  const tex = solarComponent
    + geomagneticComponent
    + stormMemoryComponent
    + (altitudeBlend * (diurnalComponent + seasonalComponent));
  return clamp(tex, 500, 2200);
}

function thermosphereTemperatureK(altitudeKm, exosphereTempK) {
  const z = Math.max(BASE_ALTITUDE_KM, Number(altitudeKm) || BASE_ALTITUDE_KM);
  const dz = z - BASE_ALTITUDE_KM;
  const eFoldKm = 42;
  return exosphereTempK - ((exosphereTempK - BASE_TEMPERATURE_K) * Math.exp(-dz / eFoldKm));
}

export function sampleUpperAtmosphereNRLMSISEApprox({
  altitudeKm,
  baseDensityKgM3,
  latitudeDeg = 0,
  longitudeDeg = 0,
  timestampMs = Date.now(),
  f107 = 150,
  kp = 3,
  kpHistory = [],
} = {}) {
  const z = Math.max(BASE_ALTITUDE_KM, Number(altitudeKm) || BASE_ALTITUDE_KM);
  const rho0 = Math.max(0, Number(baseDensityKgM3) || 0);
  if (!(rho0 > 0)) {
    return {
      densityKgM3: 0,
      pressurePa: 0,
      temperatureK: 0,
      exosphericTemperatureK: 0,
      meanMolarMassKgPerMol: 0,
      model: "nrlmsise-approx",
    };
  }

  const tex = exosphericTemperatureK({
    altitudeKm: z,
    latitudeDeg,
    longitudeDeg,
    timestampMs,
    f107,
    kp,
    kpHistory,
  });

  let lnRho = Math.log(rho0);
  const dzStepKm = 2;
  for (let sampleZ = BASE_ALTITUDE_KM; sampleZ < z; sampleZ += dzStepKm) {
    const midZ = Math.min(z, sampleZ + (0.5 * dzStepKm));
    const tempK = thermosphereTemperatureK(midZ, tex);
    const molarMass = meanMolarMassKgPerMol(midZ);
    const gravityMs2 = gravityMs2AtAltitudeKm(midZ);
    const scaleHeightKm =
      (UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K * tempK)
      / Math.max(1e-9, molarMass * gravityMs2 * 1000);
    const dz = Math.min(dzStepKm, z - sampleZ);
    lnRho -= dz / Math.max(1e-6, scaleHeightKm);
  }

  const densityKgM3 = Math.max(0, Math.exp(lnRho));
  const temperatureK = thermosphereTemperatureK(z, tex);
  const meanMolarMass = meanMolarMassKgPerMol(z);
  const specificGasConstant = UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K / Math.max(1e-12, meanMolarMass);
  const pressurePa = densityKgM3 * specificGasConstant * temperatureK;

  return {
    densityKgM3,
    pressurePa,
    temperatureK,
    exosphericTemperatureK: tex,
    meanMolarMassKgPerMol: meanMolarMass,
    model: "nrlmsise-approx",
  };
}
