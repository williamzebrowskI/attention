export const OBLATE_GRAVITY_ENABLED = true;

export const OBLATE_GRAVITY_MODEL = Object.freeze({
  earth: Object.freeze({
    // Earth low-degree harmonics are sourced dynamically at runtime from the
    // hybrid IERS + EGM2008 gravity model; keep these as static fallback values.
    j5: -2.2775359073083618e-7,
    j6: 5.406665762838132e-7,
    c21: -2.667394752374837e-10,
    s21: 1.7872706485240434e-9,
    c22: 1.574615325722917e-6,
    s22: -0.9038727891965667e-6,
    equatorialRadiusKm: 6378.1363,
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
