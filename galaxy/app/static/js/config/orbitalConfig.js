export const AXIAL_TILT_DEG = {
  sun: 7.25,
  mercury: 0.034,
  venus: 177.36,
  earth: 23.44,
  // Relative to the ecliptic plane.
  moon: 1.54,
  mars: 25.19,
  jupiter: 3.13,
  saturn: 26.73,
  uranus: 97.77,
  neptune: 28.32,
};

// IAU/J2000 pole orientation in equatorial coordinates for bodies where
// we need a physically anchored axis in the ecliptic scene.
// Values use IAU/NAIF rotational-element constants (raDeg/decDeg) with
// optional linear rates in degrees per Julian century.
export const SPIN_AXIS_EQUATORIAL_DEG = {
  sun: { raDeg: 286.13, decDeg: 63.87 },
  mercury: { raDeg: 281.0103, decDeg: 61.4155, raRateDegPerCentury: -0.0328, decRateDegPerCentury: -0.0049 },
  venus: { raDeg: 272.76, decDeg: 67.16 },
  earth: { raDeg: 0.0, decDeg: 90.0, raRateDegPerCentury: -0.641, decRateDegPerCentury: -0.557 },
  moon: { raDeg: 269.9949, decDeg: 66.5392, raRateDegPerCentury: 0.0031, decRateDegPerCentury: 0.0130 },
  mars: {
    raDeg: 317.269202,
    decDeg: 54.432516,
    raRateDegPerCentury: -0.10927547,
    decRateDegPerCentury: -0.05827105,
  },
  phobos: {
    raDeg: 317.67071657,
    decDeg: 52.88627266,
    raRateDegPerCentury: -0.10844326,
    decRateDegPerCentury: -0.06134706,
  },
  deimos: {
    raDeg: 316.65705808,
    decDeg: 53.50992033,
    raRateDegPerCentury: -0.10518014,
    decRateDegPerCentury: -0.05979094,
  },
  jupiter: { raDeg: 268.056595, decDeg: 64.495303, raRateDegPerCentury: -0.006499, decRateDegPerCentury: 0.002413 },
  io: { raDeg: 268.05, decDeg: 64.5, raRateDegPerCentury: -0.009, decRateDegPerCentury: 0.003 },
  europa: { raDeg: 268.08, decDeg: 64.51, raRateDegPerCentury: -0.009, decRateDegPerCentury: 0.003 },
  ganymede: { raDeg: 268.2, decDeg: 64.57, raRateDegPerCentury: -0.009, decRateDegPerCentury: 0.003 },
  callisto: { raDeg: 268.72, decDeg: 64.83, raRateDegPerCentury: -0.009, decRateDegPerCentury: 0.003 },
  amalthea: { raDeg: 268.05, decDeg: 64.49, raRateDegPerCentury: -0.009, decRateDegPerCentury: 0.003 },
  saturn: { raDeg: 40.589, decDeg: 83.537, raRateDegPerCentury: -0.036, decRateDegPerCentury: -0.004 },
  mimas: { raDeg: 40.66, decDeg: 83.52, raRateDegPerCentury: -0.036, decRateDegPerCentury: -0.004 },
  enceladus: { raDeg: 40.66, decDeg: 83.52, raRateDegPerCentury: -0.036, decRateDegPerCentury: -0.004 },
  tethys: { raDeg: 40.66, decDeg: 83.52, raRateDegPerCentury: -0.036, decRateDegPerCentury: -0.004 },
  dione: { raDeg: 40.66, decDeg: 83.52, raRateDegPerCentury: -0.036, decRateDegPerCentury: -0.004 },
  rhea: { raDeg: 40.38, decDeg: 83.55, raRateDegPerCentury: -0.036, decRateDegPerCentury: -0.004 },
  titan: { raDeg: 39.4827, decDeg: 83.4279 },
  hyperion: { raDeg: 40.589, decDeg: 83.537, raRateDegPerCentury: -0.036, decRateDegPerCentury: -0.004 },
  iapetus: { raDeg: 318.16, decDeg: 75.03, raRateDegPerCentury: -3.949, decRateDegPerCentury: -1.143 },
  phoebe: { raDeg: 356.9, decDeg: 77.8 },
  uranus: { raDeg: 257.311, decDeg: -15.175 },
  puck: { raDeg: 257.31, decDeg: -15.18 },
  miranda: { raDeg: 257.43, decDeg: -15.08 },
  ariel: { raDeg: 257.43, decDeg: -15.1 },
  umbriel: { raDeg: 257.43, decDeg: -15.1 },
  titania: { raDeg: 257.43, decDeg: -15.1 },
  oberon: { raDeg: 257.43, decDeg: -15.1 },
  neptune: { raDeg: 299.36, decDeg: 43.46 },
  naiad: { raDeg: 299.36, decDeg: 43.36 },
  thalassa: { raDeg: 299.36, decDeg: 43.45 },
  despina: { raDeg: 299.36, decDeg: 43.45 },
  galatea: { raDeg: 299.36, decDeg: 43.43 },
  larissa: { raDeg: 299.36, decDeg: 43.41 },
  proteus: { raDeg: 299.27, decDeg: 42.91 },
  triton: { raDeg: 299.36, decDeg: 41.17 },
  nereid: { raDeg: 299.36, decDeg: 43.46 },
};

export const ECLIPTIC_OBLIQUITY_DEG = 23.43928;

export const ROTATION_PERIOD_HOURS = {
  sun: 609.12,
  mercury: 1407.6,
  venus: -5832.5,
  earth: 23.934,
  moon: 655.72,
  mars: 24.623,
  jupiter: 9.925,
  saturn: 10.7,
  uranus: -17.2,
  neptune: 16.11,
  phobos: 7.653,
  deimos: 30.35,
  io: 42.46,
  europa: 85.23,
  ganymede: 171.71,
  callisto: 400.54,
  amalthea: 11.95,
  mimas: 22.61,
  enceladus: 32.88,
  tethys: 45.31,
  dione: 65.69,
  rhea: 108.43,
  titan: 382.68,
  hyperion: 317.4,
  iapetus: 1903.7,
  phoebe: 9.27,
  puck: 18.29,
  miranda: 33.91,
  ariel: 60.49,
  umbriel: 99.46,
  titania: 209.02,
  oberon: 323.11,
  naiad: 7.06,
  thalassa: 7.46,
  despina: 8.04,
  galatea: 10.29,
  larissa: 13.31,
  proteus: 26.95,
  triton: -141.04,
  nereid: 11.52,
};

// IAU/NAIF prime-meridian rotation model: W(t) = W0 + Wdot * d
// where d is days since J2000 (JD 2451545.0). Bodies not listed here
// fall back to sidereal-period-derived rates in runtime code.
export const PRIME_MERIDIAN_W_DEG = {
  sun: { w0Deg: 84.176, wRateDegPerDay: 14.1844 },
  mercury: { w0Deg: 329.5988, wRateDegPerDay: 6.1385108 },
  venus: { w0Deg: 160.2, wRateDegPerDay: -1.4813688 },
  earth: { w0Deg: 190.147, wRateDegPerDay: 360.9856235 },
  moon: { w0Deg: 38.3213, wRateDegPerDay: 13.17635815 },
  mars: { w0Deg: 176.63, wRateDegPerDay: 350.89198226 },
  jupiter: { w0Deg: 284.95, wRateDegPerDay: 870.536 },
  saturn: { w0Deg: 38.9, wRateDegPerDay: 810.7939024 },
  uranus: { w0Deg: 203.81, wRateDegPerDay: -501.1600928 },
  neptune: { w0Deg: 253.18, wRateDegPerDay: 536.3128492 },
};

export const MOON_ORBIT_DIRECTION = {
  triton: -1,
  phoebe: -1,
};

export const MOON_ORBITAL_ELEMENTS = {
  moon: { e: 0.0549, inclinationDeg: 5.145, ascendingNodeDeg: 125.08, argPeriapsisDeg: 318.15 },
  phobos: { e: 0.0151, inclinationDeg: 24.7, ascendingNodeDeg: 49.2, argPeriapsisDeg: 150.0 },
  deimos: { e: 0.0002, inclinationDeg: 24.0, ascendingNodeDeg: 79.4, argPeriapsisDeg: 260.0 },
  io: { e: 0.0041, inclinationDeg: 3.1, ascendingNodeDeg: 43.9, argPeriapsisDeg: 84.1 },
  europa: { e: 0.0094, inclinationDeg: 3.5, ascendingNodeDeg: 219.1, argPeriapsisDeg: 88.9 },
  ganymede: { e: 0.0013, inclinationDeg: 2.9, ascendingNodeDeg: 63.6, argPeriapsisDeg: 192.4 },
  callisto: { e: 0.0074, inclinationDeg: 2.0, ascendingNodeDeg: 298.8, argPeriapsisDeg: 52.6 },
  amalthea: { e: 0.0032, inclinationDeg: 3.8, ascendingNodeDeg: 152.7, argPeriapsisDeg: 241.5 },
  mimas: { e: 0.0196, inclinationDeg: 28.3, ascendingNodeDeg: 173.0, argPeriapsisDeg: 334.0 },
  enceladus: { e: 0.0047, inclinationDeg: 27.1, ascendingNodeDeg: 169.0, argPeriapsisDeg: 70.0 },
  tethys: { e: 0.0001, inclinationDeg: 26.8, ascendingNodeDeg: 168.0, argPeriapsisDeg: 45.0 },
  dione: { e: 0.0022, inclinationDeg: 28.0, ascendingNodeDeg: 168.8, argPeriapsisDeg: 330.0 },
  rhea: { e: 0.0010, inclinationDeg: 27.6, ascendingNodeDeg: 168.3, argPeriapsisDeg: 215.0 },
  titan: { e: 0.0288, inclinationDeg: 27.7, ascendingNodeDeg: 168.0, argPeriapsisDeg: 186.0 },
  hyperion: { e: 0.1230, inclinationDeg: 28.0, ascendingNodeDeg: 168.2, argPeriapsisDeg: 258.0 },
  iapetus: { e: 0.0283, inclinationDeg: 41.5, ascendingNodeDeg: 139.7, argPeriapsisDeg: 86.7 },
  phoebe: { e: 0.1634, inclinationDeg: 175.2, ascendingNodeDeg: 245.2, argPeriapsisDeg: 354.0 },
  puck: { e: 0.0001, inclinationDeg: 97.9, ascendingNodeDeg: 74.0, argPeriapsisDeg: 30.0 },
  miranda: { e: 0.0013, inclinationDeg: 97.6, ascendingNodeDeg: 326.4, argPeriapsisDeg: 68.3 },
  ariel: { e: 0.0012, inclinationDeg: 97.8, ascendingNodeDeg: 101.0, argPeriapsisDeg: 115.0 },
  umbriel: { e: 0.0039, inclinationDeg: 97.9, ascendingNodeDeg: 33.5, argPeriapsisDeg: 84.0 },
  titania: { e: 0.0011, inclinationDeg: 98.0, ascendingNodeDeg: 99.8, argPeriapsisDeg: 285.0 },
  oberon: { e: 0.0014, inclinationDeg: 98.1, ascendingNodeDeg: 279.8, argPeriapsisDeg: 105.0 },
  naiad: { e: 0.0003, inclinationDeg: 28.5, ascendingNodeDeg: 55.0, argPeriapsisDeg: 140.0 },
  thalassa: { e: 0.0002, inclinationDeg: 28.4, ascendingNodeDeg: 61.0, argPeriapsisDeg: 210.0 },
  despina: { e: 0.0001, inclinationDeg: 28.3, ascendingNodeDeg: 72.0, argPeriapsisDeg: 300.0 },
  galatea: { e: 0.0002, inclinationDeg: 28.4, ascendingNodeDeg: 80.0, argPeriapsisDeg: 340.0 },
  larissa: { e: 0.0014, inclinationDeg: 28.5, ascendingNodeDeg: 52.0, argPeriapsisDeg: 265.0 },
  proteus: { e: 0.0005, inclinationDeg: 28.6, ascendingNodeDeg: 43.0, argPeriapsisDeg: 41.0 },
  triton: { e: 0.00002, inclinationDeg: 130.9, ascendingNodeDeg: 213.2, argPeriapsisDeg: 30.0 },
  nereid: { e: 0.7507, inclinationDeg: 35.0, ascendingNodeDeg: 295.8, argPeriapsisDeg: 280.0 },
};

export const ORBIT_ECCENTRICITY = {
  mercury: 0.2056,
  venus: 0.0068,
  earth: 0.0167,
  mars: 0.0934,
  jupiter: 0.0489,
  saturn: 0.0565,
  uranus: 0.0457,
  neptune: 0.0113,
};

export const ORBIT_PERIHELION_DEG = {
  mercury: 77.46,
  venus: 131.53,
  earth: 102.94,
  mars: 336.04,
  jupiter: 14.75,
  saturn: 92.43,
  uranus: 170.96,
  neptune: 44.97,
};

// Empty by default: real-time orbital periods come from each body's
// physical orbital_period_days values in the catalog.
export const ORBIT_VISUAL_PERIOD_HOURS = {};

// Desired solar-day duration relative to the Sun for visual simulation.
export const ROTATION_SOLAR_DAY_HOURS = {
  earth: 24,
};

// Per-body spin scale override to keep certain bodies in true-time rotation.
export const ROTATION_TIME_SCALE_OVERRIDE = {
  earth: 1,
};

export const ORBITAL_CONFIG_LOCK_ENFORCED = true;
export const ORBITAL_CONFIG_LOCK_HASH = "a6845a36";

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fnv1aHex(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function computeOrbitalConfigLockHash() {
  const payload = {
    AXIAL_TILT_DEG,
    SPIN_AXIS_EQUATORIAL_DEG,
    ECLIPTIC_OBLIQUITY_DEG,
    ROTATION_PERIOD_HOURS,
    PRIME_MERIDIAN_W_DEG,
    MOON_ORBIT_DIRECTION,
    MOON_ORBITAL_ELEMENTS,
    ORBIT_ECCENTRICITY,
    ORBIT_PERIHELION_DEG,
    ORBIT_VISUAL_PERIOD_HOURS,
    ROTATION_SOLAR_DAY_HOURS,
    ROTATION_TIME_SCALE_OVERRIDE,
  };
  return fnv1aHex(stableStringify(payload));
}

export function assertOrbitalConfigLock() {
  if (!ORBITAL_CONFIG_LOCK_ENFORCED) {
    return;
  }
  const currentHash = computeOrbitalConfigLockHash();
  if (currentHash !== ORBITAL_CONFIG_LOCK_HASH) {
    throw new Error(
      `Orbital config lock mismatch (expected ${ORBITAL_CONFIG_LOCK_HASH}, got ${currentHash}).`,
    );
  }
}
