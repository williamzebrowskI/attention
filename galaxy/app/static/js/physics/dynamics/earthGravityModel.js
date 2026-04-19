const J2000_UNIX_MS = Date.UTC(2000, 0, 1, 12, 0, 0, 0);
const JULIAN_YEAR_MS = 365.25 * 86_400_000;
const ARCSEC_TO_RAD = Math.PI / (180 * 3600);

function finite(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function yearsSinceJ2000(timestampMs = Date.now()) {
  const ts = finite(timestampMs, Date.now());
  return (ts - J2000_UNIX_MS) / JULIAN_YEAR_MS;
}

function normalizedZonalToJ(order, normalizedCoefficient) {
  const n = Math.max(0, Math.floor(Number(order) || 0));
  const cBar = finite(normalizedCoefficient, 0);
  return -Math.sqrt((2 * n) + 1) * cBar;
}

function normalizedCoefficientToUnnormalized(order, degree, normalizedCoefficient) {
  const n = Math.max(0, Math.floor(Number(order) || 0));
  const m = Math.max(0, Math.floor(Number(degree) || 0));
  const cBar = finite(normalizedCoefficient, 0);
  let numerator = (2 * n) + 1;
  if (m > 0) {
    numerator *= 2;
  }
  let factorialRatio = 1;
  for (let k = n - m + 1; k <= n + m; k += 1) {
    factorialRatio /= k;
  }
  return Math.sqrt(Math.max(0, numerator * factorialRatio)) * cBar;
}

function normalizedHarmonicTerm(order, degree, cNormalized, sNormalized) {
  const n = Math.max(0, Math.floor(Number(order) || 0));
  const m = Math.max(0, Math.floor(Number(degree) || 0));
  const cBar = finite(cNormalized, 0);
  const sBar = finite(sNormalized, 0);
  return Object.freeze({
    n,
    m,
    cNormalized: cBar,
    sNormalized: sBar,
    c: normalizedCoefficientToUnnormalized(n, m, cBar),
    s: normalizedCoefficientToUnnormalized(n, m, sBar),
  });
}

// IERS Conventions 2010, Chapter 6, Table 6.2:
// conventional low-degree normalized zonals with secular rates about J2000.0.
const IERS_LOW_DEGREE_ZONALS = Object.freeze({
  c20ZeroTideAtJ2000: -0.48416948e-3,
  c20RatePerYear: 11.6e-12,
  c30AtJ2000: 0.9571612e-6,
  c30RatePerYear: 4.9e-12,
  c40AtJ2000: 0.5399659e-6,
  c40RatePerYear: 4.7e-12,
});

// EGM2008 tide-free low-degree static harmonics. We keep IERS secular drift for
// the degree-2/3/4 zonals, then layer the static tesseral/sectorial terms from
// the official EGM2008 coefficient set on top.
const EGM2008_STATIC_LOW_DEGREE_HARMONICS = Object.freeze([
  normalizedHarmonicTerm(2, 1, -0.206615509074176e-09, 0.138441389137979e-08),
  normalizedHarmonicTerm(2, 2, 0.243938357328313e-05, -0.140027370385934e-05),
  normalizedHarmonicTerm(3, 1, 0.203046201047864e-05, 0.248200415856872e-06),
  normalizedHarmonicTerm(3, 2, 0.904787894809528e-06, -0.619005475177618e-06),
  normalizedHarmonicTerm(3, 3, 0.721321757121568e-06, 0.141434926192941e-05),
  normalizedHarmonicTerm(4, 1, -0.536157389388867e-06, -0.473567346518086e-06),
  normalizedHarmonicTerm(4, 2, 0.350501623962649e-06, 0.662480026275829e-06),
  normalizedHarmonicTerm(4, 3, 0.990856766672321e-06, -0.200956723567452e-06),
  normalizedHarmonicTerm(4, 4, -0.188519633023033e-06, 0.308803882149194e-06),
  normalizedHarmonicTerm(5, 1, -0.629211923042529e-07, -0.943698073395769e-07),
  normalizedHarmonicTerm(5, 2, 0.652078043176164e-06, -0.323353192540522e-06),
  normalizedHarmonicTerm(5, 3, -0.451847152328843e-06, -0.214955408306046e-06),
  normalizedHarmonicTerm(5, 4, -0.295328761175629e-06, 0.498070550102351e-07),
  normalizedHarmonicTerm(5, 5, 0.174811795496002e-06, -0.669379935180165e-06),
  normalizedHarmonicTerm(6, 1, -0.759210081892527e-07, 0.265122593213647e-07),
  normalizedHarmonicTerm(6, 2, 0.486488924604690e-07, -0.373789324523752e-06),
  normalizedHarmonicTerm(6, 3, 0.572451611175653e-07, 0.895201130010730e-08),
  normalizedHarmonicTerm(6, 4, -0.860237937191611e-07, -0.471425573429095e-06),
  normalizedHarmonicTerm(6, 5, -0.267166423703038e-06, -0.536493151500206e-06),
  normalizedHarmonicTerm(6, 6, 0.947068749756882e-08, -0.237382353351005e-06),
]);

const EGM2008_STATIC_DEGREE21 = EGM2008_STATIC_LOW_DEGREE_HARMONICS.find(
  (term) => term.n === 2 && term.m === 1,
);
const EGM2008_STATIC_DEGREE22 = EGM2008_STATIC_LOW_DEGREE_HARMONICS.find(
  (term) => term.n === 2 && term.m === 2,
);
const EGM2008_STATIC_HARMONICS_WITHOUT_DEGREE21 = Object.freeze(
  EGM2008_STATIC_LOW_DEGREE_HARMONICS.filter((term) => !(term.n === 2 && term.m === 1)),
);

const EARTH_STATIC_HIGHER_ORDER = Object.freeze({
  j5: normalizedZonalToJ(5, 0.686702913736681e-07),
  j6: normalizedZonalToJ(6, -0.149953927978527e-06),
  c22Normalized: EGM2008_STATIC_DEGREE22?.cNormalized || 0,
  s22Normalized: EGM2008_STATIC_DEGREE22?.sNormalized || 0,
  c22: EGM2008_STATIC_DEGREE22?.c || 0,
  s22: EGM2008_STATIC_DEGREE22?.s || 0,
  equatorialRadiusKm: 6378.1363,
});

function earthC21S21FromOrientation({
  c20Normalized = 0,
  c22Normalized = 0,
  s22Normalized = 0,
  earthOrientation = null,
} = {}) {
  const xpArcsec = finite(earthOrientation?.xpArcsec, 0);
  const ypArcsec = finite(earthOrientation?.ypArcsec, 0);
  const xpRad = xpArcsec * ARCSEC_TO_RAD;
  const ypRad = ypArcsec * ARCSEC_TO_RAD;
  const c20 = finite(c20Normalized, 0);
  const c22 = finite(c22Normalized, 0);
  const s22 = finite(s22Normalized, 0);
  const c21Normalized = (Math.sqrt(3) * xpRad * c20) - (xpRad * c22) + (ypRad * s22);
  const s21Normalized = (-Math.sqrt(3) * ypRad * c20) - (ypRad * c22) - (xpRad * s22);
  return {
    c21Normalized,
    s21Normalized,
    c21: normalizedCoefficientToUnnormalized(2, 1, c21Normalized),
    s21: normalizedCoefficientToUnnormalized(2, 1, s21Normalized),
  };
}

function earthLowDegreeHarmonics({
  c21Normalized = 0,
  s21Normalized = 0,
} = {}) {
  return Object.freeze([
    normalizedHarmonicTerm(2, 1, c21Normalized, s21Normalized),
    ...EGM2008_STATIC_HARMONICS_WITHOUT_DEGREE21,
  ]);
}

export function earthConventionalGravityModel(timestampMs = Date.now(), earthOrientation = null) {
  const years = yearsSinceJ2000(timestampMs);
  const c20 = IERS_LOW_DEGREE_ZONALS.c20ZeroTideAtJ2000 + (IERS_LOW_DEGREE_ZONALS.c20RatePerYear * years);
  const c30 = IERS_LOW_DEGREE_ZONALS.c30AtJ2000 + (IERS_LOW_DEGREE_ZONALS.c30RatePerYear * years);
  const c40 = IERS_LOW_DEGREE_ZONALS.c40AtJ2000 + (IERS_LOW_DEGREE_ZONALS.c40RatePerYear * years);
  const degree21Delta = earthC21S21FromOrientation({
    c20Normalized: c20,
    c22Normalized: EARTH_STATIC_HIGHER_ORDER.c22Normalized,
    s22Normalized: EARTH_STATIC_HIGHER_ORDER.s22Normalized,
    earthOrientation,
  });
  const c21Normalized = finite(EGM2008_STATIC_DEGREE21?.cNormalized, 0) + degree21Delta.c21Normalized;
  const s21Normalized = finite(EGM2008_STATIC_DEGREE21?.sNormalized, 0) + degree21Delta.s21Normalized;
  const degree21 = {
    c21Normalized,
    s21Normalized,
    c21: normalizedCoefficientToUnnormalized(2, 1, c21Normalized),
    s21: normalizedCoefficientToUnnormalized(2, 1, s21Normalized),
  };
  const harmonics = earthLowDegreeHarmonics({
    c21Normalized,
    s21Normalized,
  });

  return Object.freeze({
    source: "iers-secular-zonals+egm2008-low-degree-harmonics",
    timestampMs: finite(timestampMs, Date.now()),
    yearsSinceJ2000: years,
    c20Normalized: c20,
    c21Normalized: degree21.c21Normalized,
    s21Normalized: degree21.s21Normalized,
    c30Normalized: c30,
    c40Normalized: c40,
    j2: normalizedZonalToJ(2, c20),
    j3: normalizedZonalToJ(3, c30),
    j4: normalizedZonalToJ(4, c40),
    j5: EARTH_STATIC_HIGHER_ORDER.j5,
    j6: EARTH_STATIC_HIGHER_ORDER.j6,
    c21: degree21.c21,
    s21: degree21.s21,
    c22Normalized: EARTH_STATIC_HIGHER_ORDER.c22Normalized,
    s22Normalized: EARTH_STATIC_HIGHER_ORDER.s22Normalized,
    c22: EARTH_STATIC_HIGHER_ORDER.c22,
    s22: EARTH_STATIC_HIGHER_ORDER.s22,
    harmonics,
    equatorialRadiusKm: EARTH_STATIC_HIGHER_ORDER.equatorialRadiusKm,
  });
}
