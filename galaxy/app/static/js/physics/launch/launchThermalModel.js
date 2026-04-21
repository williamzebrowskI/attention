function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveBoosterReturnPhaseScale(phaseRaw) {
  const phase = String(phaseRaw || "").trim().toLowerCase();
  if (!phase) {
    return 0;
  }
  if (phase.includes("entry")) {
    return 1;
  }
  if (phase.includes("ballistic")) {
    return 0.82;
  }
  if (phase.includes("descent")) {
    return 0.58;
  }
  if (phase.includes("landing")) {
    return 0.28;
  }
  return 0;
}

export function computeBoosterEntryThermalState({
  phase = "",
  altitudeKm = null,
  altitudeAboveTerrainKm = null,
  dynamicPressurePa = null,
  airRelativeSpeedKmS = null,
  earthRelativeSpeedKmS = null,
  radialSpeedKmS = null,
  throttle = null,
} = {}) {
  const phaseScale = resolveBoosterReturnPhaseScale(phase);
  const altitudeAglKm = finiteNumberOrNull(altitudeAboveTerrainKm);
  const altitudeAbsKm = finiteNumberOrNull(altitudeKm);
  const qPa = Math.max(0, finiteNumberOrNull(dynamicPressurePa) || 0);
  const airSpeedKmS = Math.max(
    0,
    finiteNumberOrNull(airRelativeSpeedKmS)
    || finiteNumberOrNull(earthRelativeSpeedKmS)
    || 0,
  );
  const radialKmS = finiteNumberOrNull(radialSpeedKmS);
  const throttleNorm = clamp(finiteNumberOrNull(throttle) || 0, 0, 1);

  if (phaseScale <= 0) {
    return {
      active: false,
      heatLevel: 0,
      plasmaLevel: 0,
      wakeLevel: 0,
      glowLevel: 0,
      phaseScale: 0,
      qBlend: 0,
      speedBlend: 0,
      descentBlend: 0,
      altitudeBlend: 0,
    };
  }

  if (altitudeAglKm !== null && altitudeAglKm <= 0.6) {
    return {
      active: false,
      heatLevel: 0,
      plasmaLevel: 0,
      wakeLevel: 0,
      glowLevel: 0,
      phaseScale,
      qBlend: 0,
      speedBlend: 0,
      descentBlend: 0,
      altitudeBlend: 0,
    };
  }

  if (altitudeAbsKm !== null && (altitudeAbsKm <= 1 || altitudeAbsKm >= 125)) {
    return {
      active: false,
      heatLevel: 0,
      plasmaLevel: 0,
      wakeLevel: 0,
      glowLevel: 0,
      phaseScale,
      qBlend: 0,
      speedBlend: 0,
      descentBlend: 0,
      altitudeBlend: 0,
    };
  }

  if (airSpeedKmS <= 0.3) {
    return {
      active: false,
      heatLevel: 0,
      plasmaLevel: 0,
      wakeLevel: 0,
      glowLevel: 0,
      phaseScale,
      qBlend: 0,
      speedBlend: 0,
      descentBlend: 0,
      altitudeBlend: 0,
    };
  }

  const qBlend = clamp((qPa - 1_600) / (46_000 - 1_600), 0, 1);
  const speedBlend = clamp((airSpeedKmS - 0.35) / (3.2 - 0.35), 0, 1);
  const descentBlend = radialKmS === null
    ? 1
    : clamp(((-radialKmS) - 0.012) / (0.62 - 0.012), 0, 1);
  const altitudeBlend = altitudeAbsKm === null
    ? 1
    : clamp((125 - altitudeAbsKm) / 125, 0, 1);
  const throttleCooling = 1 - (throttleNorm * 0.14);

  const heatLevel = clamp(
    ((0.78 * qBlend) + (0.22 * speedBlend))
      * descentBlend
      * (0.44 + (0.56 * altitudeBlend))
      * phaseScale
      * throttleCooling,
    0,
    1,
  );

  const plasmaLevel = clamp(
    Math.pow(heatLevel, 0.86) * (0.7 + (0.3 * qBlend)),
    0,
    1,
  );
  const wakeLevel = clamp(
    plasmaLevel * (0.62 + (0.38 * speedBlend)),
    0,
    1,
  );
  const glowLevel = clamp(
    (0.52 * plasmaLevel) + (0.48 * qBlend),
    0,
    1,
  );

  return {
    active: heatLevel > 0.01,
    heatLevel,
    plasmaLevel,
    wakeLevel,
    glowLevel,
    phaseScale,
    qBlend,
    speedBlend,
    descentBlend,
    altitudeBlend,
  };
}
