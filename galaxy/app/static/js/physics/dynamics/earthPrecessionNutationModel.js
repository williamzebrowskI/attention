const J2000_UNIX_MS = Date.UTC(2000, 0, 1, 12, 0, 0, 0);

function finite(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function wrapDegrees(value) {
  let angle = finite(value, 0) % 360;
  if (angle < 0) {
    angle += 360;
  }
  return angle;
}

function degToRad(valueDeg) {
  return finite(valueDeg, 0) * (Math.PI / 180);
}

// Truncated IAU-style approximation:
// - nutation: dominant periodic terms (arcsec)
// - precession: polynomial in Julian centuries (arcsec)
export function estimateEarthPrecessionNutationArcsec(timestampMs = Date.now()) {
  const ts = finite(timestampMs, Date.now());
  const julianCenturiesT = (ts - J2000_UNIX_MS) / (86_400_000 * 36525);

  const meanElongationNodeDeg = wrapDegrees(
    125.04452
    - (1934.136261 * julianCenturiesT)
    + (0.0020708 * julianCenturiesT * julianCenturiesT)
    + ((julianCenturiesT * julianCenturiesT * julianCenturiesT) / 450000),
  );
  const meanSolarLongitudeDeg = wrapDegrees(
    280.4665 + (36000.7698 * julianCenturiesT),
  );
  const meanLunarLongitudeDeg = wrapDegrees(
    218.3165 + (481267.8813 * julianCenturiesT),
  );

  const omega = degToRad(meanElongationNodeDeg);
  const twoL = degToRad(2 * meanSolarLongitudeDeg);
  const twoLm = degToRad(2 * meanLunarLongitudeDeg);
  const twoOmega = degToRad(2 * meanElongationNodeDeg);

  const nutationLongitudeArcsec =
    (-17.20 * Math.sin(omega))
    - (1.32 * Math.sin(twoL))
    - (0.23 * Math.sin(twoLm))
    + (0.21 * Math.sin(twoOmega));

  const nutationObliquityArcsec =
    (9.20 * Math.cos(omega))
    + (0.57 * Math.cos(twoL))
    + (0.10 * Math.cos(twoLm))
    - (0.09 * Math.cos(twoOmega));

  const t = julianCenturiesT;
  const precessionLongitudeArcsec =
    (5038.481507 * t)
    - (1.0790069 * t * t)
    - (0.00114045 * t * t * t)
    + (0.000132851 * t * t * t * t)
    - (0.0000000951 * t * t * t * t * t);

  // Mean obliquity change from J2000 in arcsec (negative over long timescale).
  const meanObliquityArcsec =
    84381.406
    - (46.836769 * t)
    - (0.0001831 * t * t)
    + (0.00200340 * t * t * t)
    - (0.000000576 * t * t * t * t)
    - (0.0000000434 * t * t * t * t * t);
  const precessionObliquityArcsec = meanObliquityArcsec - 84381.406;

  return {
    julianCenturiesT,
    precessionLongitudeArcsec,
    precessionObliquityArcsec,
    nutationLongitudeArcsec,
    nutationObliquityArcsec,
    source: "truncated-iau-precession-nutation",
  };
}

