export const OBLATE_GRAVITY_ENABLED = true;

export const OBLATE_GRAVITY_MODEL = Object.freeze({
  earth: Object.freeze({
    j2: 1.08262668e-3,
    j4: -1.61962159137e-6,
    // Degree-2 tesseral terms to model longitudinal gravity asymmetry.
    c22: 1.57446e-6,
    s22: -0.90376e-6,
    equatorialRadiusKm: 6378.137,
  }),
  // Axisymmetric first-pass for giant planets: include zonals (J2/J4),
  // keep tesseral terms at zero unless validated non-zero fields are added.
  jupiter: Object.freeze({
    j2: 1.469643e-2,
    j4: -5.87e-4,
    c22: 0,
    s22: 0,
    equatorialRadiusKm: 71492,
  }),
  saturn: Object.freeze({
    j2: 1.6298e-2,
    j4: -9.358e-4,
    c22: 0,
    s22: 0,
    equatorialRadiusKm: 60268,
  }),
  uranus: Object.freeze({
    j2: 3.34343e-3,
    j4: -2.9e-5,
    c22: 0,
    s22: 0,
    equatorialRadiusKm: 25559,
  }),
  neptune: Object.freeze({
    j2: 3.411e-3,
    j4: -3.3e-5,
    c22: 0,
    s22: 0,
    equatorialRadiusKm: 24764,
  }),
  // Major moons with measured quadrupole fields; J4 left at 0 when high-confidence
  // values are not consistently available in current reference set.
  moon: Object.freeze({
    j2: 2.0326e-4,
    j4: 0,
    c22: 2.24e-5,
    s22: 0,
    equatorialRadiusKm: 1738.1,
  }),
  io: Object.freeze({
    j2: 1.8459e-3,
    j4: 0,
    // Hydrostatic first-pass: C22 ~= (3/10) * J2; body-fixed frame assumes S22 ~= 0.
    c22: 5.5377e-4,
    s22: 0,
    equatorialRadiusKm: 1821.6,
  }),
  europa: Object.freeze({
    j2: 4.35e-4,
    j4: 0,
    c22: 1.305e-4,
    s22: 0,
    equatorialRadiusKm: 1560.8,
  }),
  ganymede: Object.freeze({
    j2: 1.27e-4,
    j4: 0,
    c22: 3.81e-5,
    s22: 0,
    equatorialRadiusKm: 2634.1,
  }),
  callisto: Object.freeze({
    j2: 3.27e-5,
    j4: 0,
    c22: 9.81e-6,
    s22: 0,
    equatorialRadiusKm: 2410.3,
  }),
  titan: Object.freeze({
    j2: 3.15e-5,
    j4: 0,
    c22: 9.45e-6,
    s22: 0,
    equatorialRadiusKm: 2574.7,
  }),
});
