const UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K = 8.314462618;
const AVOGADRO_CONSTANT_PER_MOL = 6.02214076e23;
const EARTH_MEAN_RADIUS_KM = 6_371.0084;
const EARTH_G0_MS2 = 9.80665;
const BASE_ALTITUDE_KM = 86;
const LOWER_THERMOSPHERE_REFERENCE_ALTITUDE_KM = 120;
const TURBOPAUSE_ALTITUDE_KM = 100;
const BASE_TEMPERATURE_K = 186.946;
const BASE_MEAN_MOLAR_MASS_KG_PER_MOL = 0.0289644;
const LOWER_THERMOSPHERE_REFERENCE_TEMPERATURE_K = 360;
const ANOMALOUS_OXYGEN_REFERENCE_NUMBER_DENSITY_M3 = 6e10;
const ANOMALOUS_OXYGEN_REFERENCE_ALTITUDE_KM = 550;
const ANOMALOUS_OXYGEN_SCALE_KM = 76;
const ANOMALOUS_OXYGEN_TEMPERATURE_K = 4000;

const SPECIES = Object.freeze([
  Object.freeze({
    id: "N2",
    molarMassKgPerMol: 0.0280134,
    heatCapacityRatio: 1.4,
    thermalDiffusionAlpha: 0.0,
    transitionTopKm: 170,
    activationAltitudeKm: BASE_ALTITUDE_KM,
  }),
  Object.freeze({
    id: "O2",
    molarMassKgPerMol: 0.0319988,
    heatCapacityRatio: 1.4,
    thermalDiffusionAlpha: 0.0,
    transitionTopKm: 150,
    activationAltitudeKm: BASE_ALTITUDE_KM,
  }),
  Object.freeze({
    id: "Ar",
    molarMassKgPerMol: 0.039948,
    heatCapacityRatio: 5 / 3,
    thermalDiffusionAlpha: 0.17,
    transitionTopKm: 145,
    activationAltitudeKm: BASE_ALTITUDE_KM,
  }),
  Object.freeze({
    id: "O",
    molarMassKgPerMol: 0.0159994,
    heatCapacityRatio: 5 / 3,
    thermalDiffusionAlpha: 0.0,
    transitionTopKm: 180,
    activationAltitudeKm: BASE_ALTITUDE_KM,
  }),
  Object.freeze({
    id: "He",
    molarMassKgPerMol: 0.004002602,
    heatCapacityRatio: 5 / 3,
    thermalDiffusionAlpha: -0.38,
    transitionTopKm: 320,
    activationAltitudeKm: BASE_ALTITUDE_KM,
  }),
  Object.freeze({
    id: "H",
    molarMassKgPerMol: 0.00100794,
    heatCapacityRatio: 5 / 3,
    thermalDiffusionAlpha: -0.38,
    transitionTopKm: 550,
    activationAltitudeKm: 150,
  }),
  Object.freeze({
    id: "N",
    molarMassKgPerMol: 0.0140067,
    heatCapacityRatio: 5 / 3,
    thermalDiffusionAlpha: 0.0,
    transitionTopKm: 240,
    activationAltitudeKm: 95,
  }),
]);

const O_MOLAR_MASS_KG_PER_MOL = SPECIES.find((species) => species.id === "O").molarMassKgPerMol;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function mix(a, b, t) {
  return a + ((b - a) * t);
}

function smoothStep(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(1e-9, edge1 - edge0), 0, 1);
  return t * t * (3 - (2 * t));
}

function gaussian(center, width, value) {
  const sigma = Math.max(1e-6, Number(width) || 1);
  const dz = (Number(value) || 0) - (Number(center) || 0);
  return Math.exp(-0.5 * (dz / sigma) * (dz / sigma));
}

function localSolarTimeHours(timestampMs, longitudeDeg) {
  const ts = finite(timestampMs, Date.now());
  const lon = finite(longitudeDeg, 0);
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
  const date = new Date(finite(timestampMs, Date.now()));
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return 1 + Math.floor((current - start) / 86_400_000);
}

function gravityMs2AtAltitudeKm(altitudeKm) {
  const r = EARTH_MEAN_RADIUS_KM + Math.max(0, finite(altitudeKm, 0));
  const ratio = EARTH_MEAN_RADIUS_KM / Math.max(1, r);
  return EARTH_G0_MS2 * ratio * ratio;
}

function geopotentialAltitudeKm(altitudeKm) {
  const z = Math.max(0, finite(altitudeKm, 0));
  return (EARTH_MEAN_RADIUS_KM * z) / (EARTH_MEAN_RADIUS_KM + z);
}

function geopotentialHeightDifferenceKm(altitudeKm, referenceAltitudeKm) {
  return geopotentialAltitudeKm(altitudeKm) - geopotentialAltitudeKm(referenceAltitudeKm);
}

function scaleHeightKm(temperatureK, molarMassKgPerMol, gravityMs2) {
  const temp = Math.max(1, finite(temperatureK, BASE_TEMPERATURE_K));
  const mass = Math.max(1e-9, finite(molarMassKgPerMol, BASE_MEAN_MOLAR_MASS_KG_PER_MOL));
  const gravity = Math.max(1e-9, finite(gravityMs2, EARTH_G0_MS2));
  return (
    UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K
    * temp
  ) / (
    mass
    * gravity
    * 1000
  );
}

function normalizeFractions(fractions) {
  const entries = Object.entries(fractions || {});
  let total = 0;
  for (const [, value] of entries) {
    total += Math.max(0, finite(value, 0));
  }
  if (!(total > 0)) {
    return Object.fromEntries(entries.map(([key]) => [key, 0]));
  }
  return Object.fromEntries(
    entries.map(([key, value]) => [key, Math.max(0, finite(value, 0)) / total]),
  );
}

function kpToAp(kp) {
  const value = clamp(finite(kp, 3), 0, 9);
  const anchors = [
    [0, 0],
    [1, 4],
    [2, 7],
    [3, 15],
    [4, 27],
    [5, 48],
    [6, 80],
    [7, 140],
    [8, 240],
    [9, 400],
  ];
  for (let i = 1; i < anchors.length; i += 1) {
    const [leftKp, leftAp] = anchors[i - 1];
    const [rightKp, rightAp] = anchors[i];
    if (value <= rightKp) {
      const t = (value - leftKp) / Math.max(1e-9, rightKp - leftKp);
      return mix(leftAp, rightAp, t);
    }
  }
  return anchors[anchors.length - 1][1];
}

function geomagneticApSeries(kp, kpHistory) {
  const current = kpToAp(kp);
  const history = Array.isArray(kpHistory) ? kpHistory : [];
  const values = [current];
  for (let i = 0; i < 7; i += 1) {
    values.push(kpToAp(history[i]?.kp));
  }
  return values;
}

function effectiveGeomagneticAp(apSeries) {
  const values = Array.isArray(apSeries) ? apSeries : [];
  const weights = [0.30, 0.22, 0.16, 0.12, 0.08, 0.06, 0.04, 0.02];
  let total = 0;
  let totalWeight = 0;
  for (let i = 0; i < weights.length; i += 1) {
    const sample = finite(values[i], Number.NaN);
    if (!Number.isFinite(sample)) {
      continue;
    }
    total += sample * weights[i];
    totalWeight += weights[i];
  }
  return totalWeight > 0 ? total / totalWeight : kpToAp(3);
}

function solarFluxInputs({
  f107 = 150,
  f107a = null,
} = {}) {
  const previousDayFlux = clamp(finite(f107, 150), 60, 300);
  const averageFlux = clamp(
    Number.isFinite(Number(f107a)) ? Number(f107a) : previousDayFlux,
    60,
    300,
  );
  return {
    f107: previousDayFlux,
    f107a: averageFlux,
    deltaAverage: averageFlux - 150,
    deltaDaily: previousDayFlux - averageFlux,
  };
}

function seasonalVariation(latitudeDeg, dayOfYear) {
  const latRad = (Math.PI / 180) * finite(latitudeDeg, 0);
  const annualPhase = ((finite(dayOfYear, 172) - 172) / 365.25) * Math.PI * 2;
  return Math.sin(annualPhase) * Math.sin(latRad);
}

function diurnalVariation(latitudeDeg, localSolarTimeHoursValue) {
  const latRad = (Math.PI / 180) * finite(latitudeDeg, 0);
  const lst = finite(localSolarTimeHoursValue, 12);
  const phase = ((lst - 15) / 24) * Math.PI * 2;
  return Math.cos(phase) * (0.45 + (0.55 * Math.cos(latRad)));
}

function exosphericTemperatureK({
  altitudeKm,
  latitudeDeg = 0,
  longitudeDeg = 0,
  timestampMs = Date.now(),
  f107 = 150,
  f107a = null,
  kp = 3,
  kpHistory = [],
} = {}) {
  const z = Math.max(LOWER_THERMOSPHERE_REFERENCE_ALTITUDE_KM, finite(altitudeKm, LOWER_THERMOSPHERE_REFERENCE_ALTITUDE_KM));
  const lst = localSolarTimeHours(timestampMs, longitudeDeg);
  const day = dayOfYearUtc(timestampMs);
  const solar = solarFluxInputs({ f107, f107a });
  const apSeries = geomagneticApSeries(kp, kpHistory);
  const apEffective = effectiveGeomagneticAp(apSeries);
  const season = seasonalVariation(latitudeDeg, day);
  const diurnal = diurnalVariation(latitudeDeg, lst);
  const solarPolynomial =
    (2.35 * solar.deltaAverage)
    + (1.90 * solar.deltaDaily)
    + ((1 + (0.0016 * solar.deltaAverage)) * 0.0045 * solar.deltaDaily * solar.deltaDaily)
    + (0.0025 * solar.deltaAverage * solar.deltaAverage);
  const geomagnetic =
    (1.15 * apEffective)
    + (18 * (1 - Math.exp(-apEffective / 45)));
  const seasonal = 28 * season;
  const diurnalComponent = 82 * diurnal * smoothStep(120, 180, z);
  return clamp(900 + solarPolynomial + geomagnetic + seasonal + diurnalComponent, 500, 2200);
}

function lowerThermosphereReferenceTemperatureK({
  latitudeDeg = 0,
  longitudeDeg = 0,
  timestampMs = Date.now(),
  f107 = 150,
  f107a = null,
  kp = 3,
  kpHistory = [],
} = {}) {
  const solar = solarFluxInputs({ f107, f107a });
  const apSeries = geomagneticApSeries(kp, kpHistory);
  const apEffective = effectiveGeomagneticAp(apSeries);
  const day = dayOfYearUtc(timestampMs);
  const lst = localSolarTimeHours(timestampMs, longitudeDeg);
  const season = seasonalVariation(latitudeDeg, day);
  const diurnal = diurnalVariation(latitudeDeg, lst);
  return clamp(
    LOWER_THERMOSPHERE_REFERENCE_TEMPERATURE_K
      + (0.32 * solar.deltaAverage)
      + (0.10 * solar.deltaDaily)
      + (0.55 * apEffective)
      + (10 * season)
      + (14 * diurnal),
    260,
    520,
  );
}

function thermosphereGradientAt120KPerKm({
  f107 = 150,
  f107a = null,
  kp = 3,
  kpHistory = [],
} = {}) {
  const solar = solarFluxInputs({ f107, f107a });
  const apSeries = geomagneticApSeries(kp, kpHistory);
  const apEffective = effectiveGeomagneticAp(apSeries);
  return clamp(
    3.8
      + (0.018 * solar.deltaAverage)
      + (0.007 * solar.deltaDaily)
      + (0.018 * apEffective),
    1.5,
    8.5,
  );
}

function lowerThermosphereTemperatureK(altitudeKm, inputs, t120K) {
  const z = Math.max(BASE_ALTITUDE_KM, finite(altitudeKm, BASE_ALTITUDE_KM));
  const solar = solarFluxInputs(inputs);
  const lat = finite(inputs?.latitudeDeg, 0);
  const lon = finite(inputs?.longitudeDeg, 0);
  const time = finite(inputs?.timestampMs, Date.now());
  const milAmplitude =
    8
    * gaussian(98, 7.5, z)
    * Math.pow(Math.cos((Math.PI / 180) * lat), 2)
    * (0.45 + (0.55 * Math.cos(((localSolarTimeHours(time, lon) - 2) / 24) * Math.PI * 2)));
  const t100 = 195 + (0.04 * solar.deltaAverage) + milAmplitude;
  if (z <= 100) {
    return mix(BASE_TEMPERATURE_K, t100, smoothStep(BASE_ALTITUDE_KM, 100, z));
  }
  return mix(t100, t120K, smoothStep(100, LOWER_THERMOSPHERE_REFERENCE_ALTITUDE_KM, z));
}

function batesThermosphereTemperatureK(altitudeKm, texK, t120K, gradientAt120KPerKm) {
  const z = Math.max(LOWER_THERMOSPHERE_REFERENCE_ALTITUDE_KM, finite(altitudeKm, LOWER_THERMOSPHERE_REFERENCE_ALTITUDE_KM));
  const tex = Math.max(t120K + 1e-6, finite(texK, t120K + 1));
  const xKm = Math.max(0, geopotentialHeightDifferenceKm(z, LOWER_THERMOSPHERE_REFERENCE_ALTITUDE_KM));
  const sigma = Math.max(1e-6, finite(gradientAt120KPerKm, 4) / Math.max(1e-6, tex - t120K));
  return tex - ((tex - t120K) * Math.exp(-sigma * xKm));
}

function upperAtmosphereTemperatureK(altitudeKm, inputs, texK, t120K, gradientAt120KPerKm) {
  const z = Math.max(BASE_ALTITUDE_KM, finite(altitudeKm, BASE_ALTITUDE_KM));
  if (z <= LOWER_THERMOSPHERE_REFERENCE_ALTITUDE_KM) {
    return lowerThermosphereTemperatureK(z, inputs, t120K);
  }
  return batesThermosphereTemperatureK(z, texK, t120K, gradientAt120KPerKm);
}

function referenceMixedComposition120({
  latitudeDeg = 0,
  longitudeDeg = 0,
  timestampMs = Date.now(),
  f107 = 150,
  f107a = null,
  kp = 3,
  kpHistory = [],
} = {}) {
  const solar = solarFluxInputs({ f107, f107a });
  const apSeries = geomagneticApSeries(kp, kpHistory);
  const apEffective = effectiveGeomagneticAp(apSeries);
  const lst = localSolarTimeHours(timestampMs, longitudeDeg);
  const day = dayOfYearUtc(timestampMs);
  const season = seasonalVariation(latitudeDeg, day);
  const solarNorm = clamp((solar.f107a - 70) / 230, 0, 1);
  const daySide = clamp(0.5 + (0.5 * Math.cos(((lst - 14) / 24) * Math.PI * 2)), 0, 1);
  const apNorm = clamp(apEffective / 160, 0, 1);
  const atomicO = clamp(
    0.045
      + (0.035 * solarNorm)
      + (0.015 * daySide)
      + (0.010 * apNorm)
      + (0.004 * season),
    0.02,
    0.14,
  );
  const atomicN = clamp(
    0.0006 + (0.0012 * solarNorm) + (0.0008 * apNorm),
    0.0002,
    0.004,
  );
  const molecularO2 = clamp(
    0.205 * (1 - (0.22 * solarNorm) - (0.10 * apNorm)),
    0.08,
    0.22,
  );
  const argon = 0.00934;
  const helium = clamp(0.000005 * (1 + (0.18 * (1 - daySide))), 0.000004, 0.000008);
  const hydrogen = 1e-10;
  const molecularN2 = Math.max(
    1e-8,
    1 - (atomicO + atomicN + molecularO2 + argon + helium + hydrogen),
  );
  return normalizeFractions({
    N2: molecularN2,
    O2: molecularO2,
    Ar: argon,
    O: atomicO,
    He: helium,
    H: hydrogen,
    N: atomicN,
  });
}

function lowerThermosphereChemistryMultiplier(speciesId, altitudeKm, f107a) {
  const z = Math.max(BASE_ALTITUDE_KM, finite(altitudeKm, BASE_ALTITUDE_KM));
  const deltaAverage = solarFluxInputs({ f107a }).deltaAverage;
  const zc = 126.5;
  const solarScale = 1 + (0.031 * deltaAverage);
  if (speciesId === "O") {
    const term1 = Math.exp(-(z - zc) / 34.5);
    const term2 = Math.exp(-(z - zc) / 12.9);
    const logistic = 1 + (0.5 * (term1 + term2));
    return Math.exp((0.076 * solarScale) / logistic);
  }
  if (speciesId === "O2") {
    const term1 = Math.exp((z - zc) / 34.5);
    const term2 = Math.exp((z - zc) / 12.9);
    const logistic = 1 + (0.5 * (term1 + term2));
    return Math.exp((-0.75 * solarScale) / logistic);
  }
  return 1;
}

function thermalDiffusionFactor(species, temperatureK, referenceTemperatureK) {
  const alpha = finite(species?.thermalDiffusionAlpha, 0);
  if (Math.abs(alpha) <= 1e-12) {
    return 1;
  }
  const tempRatio = Math.max(1e-9, referenceTemperatureK / Math.max(1, finite(temperatureK, referenceTemperatureK)));
  return Math.pow(tempRatio, alpha);
}

function speciesMoleFractions({
  altitudeKm,
  temperatureK,
  referenceTemperatureK,
  latitudeDeg = 0,
  longitudeDeg = 0,
  timestampMs = Date.now(),
  f107 = 150,
  f107a = null,
  kp = 3,
  kpHistory = [],
} = {}) {
  const z = Math.max(BASE_ALTITUDE_KM, finite(altitudeKm, BASE_ALTITUDE_KM));
  const refFractions = referenceMixedComposition120({
    latitudeDeg,
    longitudeDeg,
    timestampMs,
    f107,
    f107a,
    kp,
    kpHistory,
  });
  const refMeanMolarMass = meanMolarMassKgPerMol(refFractions);
  const xMeters = Math.max(0, geopotentialHeightDifferenceKm(z, LOWER_THERMOSPHERE_REFERENCE_ALTITUDE_KM) * 1000);
  const gravity = gravityMs2AtAltitudeKm(Math.max(LOWER_THERMOSPHERE_REFERENCE_ALTITUDE_KM, z));
  const characteristicTemperatureK = Math.max(150, (temperatureK + referenceTemperatureK) * 0.5);

  const weights = {};
  for (const species of SPECIES) {
    const referenceFraction = Math.max(0, finite(refFractions[species.id], 0));
    const activation = smoothStep(
      Math.max(BASE_ALTITUDE_KM, finite(species.activationAltitudeKm, BASE_ALTITUDE_KM) - 15),
      Math.max(BASE_ALTITUDE_KM + 1, finite(species.activationAltitudeKm, BASE_ALTITUDE_KM) + 10),
      z,
    );
    const diffusiveTransition = smoothStep(TURBOPAUSE_ALTITUDE_KM, finite(species.transitionTopKm, 180), z);
    const deltaMass = species.molarMassKgPerMol - refMeanMolarMass;
    const separation = Math.exp(
      -(
        deltaMass
        * gravity
        * xMeters
      ) / Math.max(1e-9, UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K * characteristicTemperatureK),
    );
    const chemistry = lowerThermosphereChemistryMultiplier(species.id, z, f107a);
    const thermal = thermalDiffusionFactor(species, temperatureK, referenceTemperatureK);
    const diffusiveWeight = referenceFraction * separation * chemistry * thermal;
    weights[species.id] = activation * mix(referenceFraction, diffusiveWeight, diffusiveTransition);
  }
  return normalizeFractions(weights);
}

function meanMolarMassKgPerMol(fractions) {
  let total = 0;
  for (const species of SPECIES) {
    total += Math.max(0, finite(fractions?.[species.id], 0)) * species.molarMassKgPerMol;
  }
  return total > 0 ? total : BASE_MEAN_MOLAR_MASS_KG_PER_MOL;
}

function heatCapacityRatio(fractions) {
  let cpMolar = 0;
  let totalMoleFraction = 0;
  for (const species of SPECIES) {
    const moleFraction = Math.max(0, finite(fractions?.[species.id], 0));
    const gamma = species.heatCapacityRatio;
    const cpSpecies = (gamma / Math.max(1e-9, gamma - 1)) * UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K;
    cpMolar += moleFraction * cpSpecies;
    totalMoleFraction += moleFraction;
  }
  if (!(totalMoleFraction > 0) || !(cpMolar > UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K)) {
    return 1.4;
  }
  const cvMolar = cpMolar - UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K;
  return cpMolar / Math.max(1e-9, cvMolar);
}

function integratePressurePa({
  altitudeKm,
  basePressurePa,
  latitudeDeg = 0,
  longitudeDeg = 0,
  timestampMs = Date.now(),
  f107 = 150,
  f107a = null,
  kp = 3,
  kpHistory = [],
} = {}) {
  const z = Math.max(BASE_ALTITUDE_KM, finite(altitudeKm, BASE_ALTITUDE_KM));
  if (!(z > BASE_ALTITUDE_KM)) {
    return Math.max(0, finite(basePressurePa, 0));
  }

  const texK = exosphericTemperatureK({
    altitudeKm: z,
    latitudeDeg,
    longitudeDeg,
    timestampMs,
    f107,
    f107a,
    kp,
    kpHistory,
  });
  const t120K = lowerThermosphereReferenceTemperatureK({
    latitudeDeg,
    longitudeDeg,
    timestampMs,
    f107,
    f107a,
    kp,
    kpHistory,
  });
  const gradient120KPerKm = thermosphereGradientAt120KPerKm({
    f107,
    f107a,
    kp,
    kpHistory,
  });

  let lnPressure = Math.log(Math.max(1e-30, finite(basePressurePa, 0)));
  let sampleAltitudeKm = BASE_ALTITUDE_KM;
  while (sampleAltitudeKm < z) {
    const dzKm = sampleAltitudeKm < 150
      ? 0.5
      : (sampleAltitudeKm < 300 ? 1 : 2);
    const nextAltitudeKm = Math.min(z, sampleAltitudeKm + dzKm);
    const midAltitudeKm = sampleAltitudeKm + ((nextAltitudeKm - sampleAltitudeKm) * 0.5);
    const temperatureK = upperAtmosphereTemperatureK(
      midAltitudeKm,
      { latitudeDeg, longitudeDeg, timestampMs, f107, f107a, kp, kpHistory },
      texK,
      t120K,
      gradient120KPerKm,
    );
    const fractions = speciesMoleFractions({
      altitudeKm: midAltitudeKm,
      temperatureK,
      referenceTemperatureK: t120K,
      latitudeDeg,
      longitudeDeg,
      timestampMs,
      f107,
      f107a,
      kp,
      kpHistory,
    });
    const meanMolarMass = meanMolarMassKgPerMol(fractions);
    const gravityMs2 = gravityMs2AtAltitudeKm(midAltitudeKm);
    const scaleHeight = scaleHeightKm(temperatureK, meanMolarMass, gravityMs2);
    lnPressure -= (nextAltitudeKm - sampleAltitudeKm) / Math.max(1e-6, scaleHeight);
    sampleAltitudeKm = nextAltitudeKm;
  }
  return Math.max(0, Math.exp(lnPressure));
}

function speciesNumberDensitiesM3(pressurePa, temperatureK, moleFractions) {
  const totalNumberDensityM3 = pressurePa / Math.max(1e-12, 1.380649e-23 * Math.max(1, temperatureK));
  const densities = {};
  for (const species of SPECIES) {
    densities[species.id] = Math.max(0, finite(moleFractions?.[species.id], 0)) * totalNumberDensityM3;
  }
  return densities;
}

function speciesMassFractions(numberDensitiesM3) {
  let totalMassDensity = 0;
  const massDensities = {};
  for (const species of SPECIES) {
    const massDensity =
      Math.max(0, finite(numberDensitiesM3?.[species.id], 0))
      * species.molarMassKgPerMol
      / AVOGADRO_CONSTANT_PER_MOL;
    massDensities[species.id] = massDensity;
    totalMassDensity += massDensity;
  }
  if (!(totalMassDensity > 0)) {
    return Object.fromEntries(SPECIES.map((species) => [species.id, 0]));
  }
  return Object.fromEntries(
    SPECIES.map((species) => [species.id, massDensities[species.id] / totalMassDensity]),
  );
}

function anomalousOxygenNumberDensityM3({
  altitudeKm,
  latitudeDeg = 0,
  timestampMs = Date.now(),
  f107 = 150,
  f107a = null,
  kp = 3,
  kpHistory = [],
} = {}) {
  const z = Math.max(BASE_ALTITUDE_KM, finite(altitudeKm, BASE_ALTITUDE_KM));
  if (z < 350) {
    return 0;
  }
  const solar = solarFluxInputs({ f107, f107a });
  const apSeries = geomagneticApSeries(kp, kpHistory);
  const apEffective = effectiveGeomagneticAp(apSeries);
  const day = dayOfYearUtc(timestampMs);
  const season = seasonalVariation(latitudeDeg, day);
  const onset = smoothStep(350, 500, z);
  const peakShape = Math.exp(-0.5 * Math.pow((z - ANOMALOUS_OXYGEN_REFERENCE_ALTITUDE_KM) / 170, 2));
  const thermalScale = scaleHeightKm(
    ANOMALOUS_OXYGEN_TEMPERATURE_K,
    O_MOLAR_MASS_KG_PER_MOL,
    gravityMs2AtAltitudeKm(Math.max(z, ANOMALOUS_OXYGEN_REFERENCE_ALTITUDE_KM)),
  );
  const backgroundDecay = Math.exp(
    -Math.max(0, geopotentialHeightDifferenceKm(z, LOWER_THERMOSPHERE_REFERENCE_ALTITUDE_KM)) / Math.max(1, thermalScale),
  );
  const forcingScale =
    0.75
    + (0.45 * clamp((solar.f107a - 90) / 180, 0, 1))
    + (0.35 * clamp(apEffective / 160, 0, 1))
    + (0.25 * Math.max(0, season));
  return (
    ANOMALOUS_OXYGEN_REFERENCE_NUMBER_DENSITY_M3
    * onset
    * forcingScale
    * (0.2 + (0.8 * peakShape))
    * backgroundDecay
  );
}

export function sampleUpperAtmosphereNRLMSISE00Class({
  altitudeKm,
  baseDensityKgM3,
  latitudeDeg = 0,
  longitudeDeg = 0,
  timestampMs = Date.now(),
  f107 = 150,
  f107a = null,
  kp = 3,
  kpHistory = [],
} = {}) {
  const z = Math.max(BASE_ALTITUDE_KM, finite(altitudeKm, BASE_ALTITUDE_KM));
  const rho0 = Math.max(0, finite(baseDensityKgM3, 0));
  if (!(rho0 > 0)) {
    return {
      densityKgM3: 0,
      dragEffectiveDensityKgM3: 0,
      pressurePa: 0,
      temperatureK: 0,
      exosphericTemperatureK: 0,
      meanMolarMassKgPerMol: 0,
      gasConstantJPerKgK: 0,
      heatCapacityRatio: 0,
      speciesMoleFractions: {},
      speciesMassFractions: {},
      speciesNumberDensityM3: {},
      anomalousONumberDensityM3: 0,
      model: "nrlmsise-00-class",
    };
  }

  const solar = solarFluxInputs({ f107, f107a });
  const texK = exosphericTemperatureK({
    altitudeKm: z,
    latitudeDeg,
    longitudeDeg,
    timestampMs,
    f107: solar.f107,
    f107a: solar.f107a,
    kp,
    kpHistory,
  });
  const t120K = lowerThermosphereReferenceTemperatureK({
    latitudeDeg,
    longitudeDeg,
    timestampMs,
    f107: solar.f107,
    f107a: solar.f107a,
    kp,
    kpHistory,
  });
  const gradient120KPerKm = thermosphereGradientAt120KPerKm({
    f107: solar.f107,
    f107a: solar.f107a,
    kp,
    kpHistory,
  });
  const basePressurePa =
    rho0
    * (UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K / BASE_MEAN_MOLAR_MASS_KG_PER_MOL)
    * BASE_TEMPERATURE_K;
  const pressurePa = integratePressurePa({
    altitudeKm: z,
    basePressurePa,
    latitudeDeg,
    longitudeDeg,
    timestampMs,
    f107: solar.f107,
    f107a: solar.f107a,
    kp,
    kpHistory,
  });
  const temperatureK = upperAtmosphereTemperatureK(
    z,
    {
      latitudeDeg,
      longitudeDeg,
      timestampMs,
      f107: solar.f107,
      f107a: solar.f107a,
      kp,
      kpHistory,
    },
    texK,
    t120K,
    gradient120KPerKm,
  );
  const moleFractions = speciesMoleFractions({
    altitudeKm: z,
    temperatureK,
    referenceTemperatureK: t120K,
    latitudeDeg,
    longitudeDeg,
    timestampMs,
    f107: solar.f107,
    f107a: solar.f107a,
    kp,
    kpHistory,
  });
  const meanMolarMass = meanMolarMassKgPerMol(moleFractions);
  const molarDensityMolPerM3 = pressurePa / Math.max(1e-12, UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K * temperatureK);
  const densityKgM3 = Math.max(0, molarDensityMolPerM3 * meanMolarMass);
  const specificGasConstant = UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K / Math.max(1e-12, meanMolarMass);
  const effectiveHeatCapacityRatio = heatCapacityRatio(moleFractions);
  const numberDensities = speciesNumberDensitiesM3(pressurePa, temperatureK, moleFractions);
  const anomalousOxygenM3 = anomalousOxygenNumberDensityM3({
    altitudeKm: z,
    latitudeDeg,
    timestampMs,
    f107: solar.f107,
    f107a: solar.f107a,
    kp,
    kpHistory,
  });
  const anomalousMassDensityKgM3 =
    anomalousOxygenM3
    * O_MOLAR_MASS_KG_PER_MOL
    / AVOGADRO_CONSTANT_PER_MOL;

  return {
    densityKgM3,
    dragEffectiveDensityKgM3: densityKgM3 + anomalousMassDensityKgM3,
    pressurePa,
    temperatureK,
    exosphericTemperatureK: texK,
    meanMolarMassKgPerMol: meanMolarMass,
    gasConstantJPerKgK: specificGasConstant,
    heatCapacityRatio: effectiveHeatCapacityRatio,
    speciesMoleFractions: moleFractions,
    speciesMassFractions: speciesMassFractions(numberDensities),
    speciesNumberDensityM3: {
      ...numberDensities,
      O_anomalous: anomalousOxygenM3,
    },
    anomalousONumberDensityM3: anomalousOxygenM3,
    model: "nrlmsise-00-class",
  };
}

export function sampleUpperAtmosphereNRLMSISEApprox(args = {}) {
  return sampleUpperAtmosphereNRLMSISE00Class(args);
}
