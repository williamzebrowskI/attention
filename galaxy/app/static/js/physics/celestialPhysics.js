import {
  MOON_ORBIT_DIRECTION,
  MOON_ORBITAL_ELEMENTS,
  ORBIT_VISUAL_PERIOD_HOURS,
  ROTATION_PERIOD_HOURS,
  ROTATION_SOLAR_DAY_HOURS,
} from "../config/orbitalConfig.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rad(degrees) {
  return (degrees * Math.PI) / 180;
}

function rotateVectorAroundX(vector, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: vector.x,
    y: (vector.y * c) - (vector.z * s),
    z: (vector.y * s) + (vector.z * c),
  };
}

function rotateVectorAroundZ(vector, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: (vector.x * c) - (vector.y * s),
    y: (vector.x * s) + (vector.y * c),
    z: vector.z,
  };
}

function toPerifocalFrame(vectorKm, elements) {
  const nodeAligned = rotateVectorAroundZ(vectorKm, -elements.ascendingNodeRad);
  const planeAligned = rotateVectorAroundX(nodeAligned, -elements.inclinationRad);
  return rotateVectorAroundZ(planeAligned, -elements.argPeriapsisRad);
}

function getOrbitDirection(body) {
  if (!body) {
    return 1;
  }
  if (body.body_type === "moon") {
    return MOON_ORBIT_DIRECTION[body.id] ?? 1;
  }
  return 1;
}

function getBodyOrbitPeriodHours(body) {
  const visualPeriodHours = Number(ORBIT_VISUAL_PERIOD_HOURS?.[body?.id]);
  if (visualPeriodHours > 0) {
    return visualPeriodHours;
  }
  const periodDays = Number(body?.orbital_period_days);
  if (periodDays > 0) {
    return periodDays * 24;
  }
  return undefined;
}

export function normalizeAngle(value) {
  const tau = Math.PI * 2;
  let wrapped = value % tau;
  if (wrapped < 0) {
    wrapped += tau;
  }
  return wrapped;
}

export function solveKepler(meanAnomaly, eccentricity) {
  let E = meanAnomaly;
  for (let i = 0; i < 7; i += 1) {
    const f = E - (eccentricity * Math.sin(E)) - meanAnomaly;
    const fp = 1 - (eccentricity * Math.cos(E));
    E -= f / Math.max(fp, 1e-6);
  }
  return E;
}

export function rotateXZ(x, z, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: (x * c) - (z * s),
    z: (x * s) + (z * c),
  };
}

export function getMoonOrbitalElements(body) {
  const raw = MOON_ORBITAL_ELEMENTS[body.id] || {};
  return {
    aKm: Number(body?.semimajor_axis_km) || 0,
    e: clamp(Number(raw.e ?? 0), 0, 0.95),
    inclinationRad: rad(Number(raw.inclinationDeg ?? 0)),
    ascendingNodeRad: rad(Number(raw.ascendingNodeDeg ?? 0)),
    argPeriapsisRad: rad(Number(raw.argPeriapsisDeg ?? 0)),
  };
}

export function inferMeanAnomalyFromRelativeVector(relativeKm, elements) {
  const aKm = Number(elements?.aKm);
  const e = Number(elements?.e);
  if (!(aKm > 0) || !(e >= 0) || !(e < 1)) {
    return NaN;
  }
  const bKm = aKm * Math.sqrt(Math.max(1 - (e * e), 1e-8));
  if (!(bKm > 0)) {
    return NaN;
  }

  const perifocal = toPerifocalFrame(relativeKm, elements);
  const cosE = clamp((perifocal.x / aKm) + e, -1, 1);
  const sinE = clamp(perifocal.y / bKm, -1, 1);
  const E = Math.atan2(sinE, cosE);
  return normalizeAngle(E - (e * Math.sin(E)));
}

export function fromPerifocalFrame(vectorKm, elements) {
  const periAligned = rotateVectorAroundZ(vectorKm, elements.argPeriapsisRad);
  const planeAligned = rotateVectorAroundX(periAligned, elements.inclinationRad);
  return rotateVectorAroundZ(planeAligned, elements.ascendingNodeRad);
}

export function getOrbitalSpeedRadPerSecond(body, useDirection = true, orbitTimeScale = 1) {
  const direction = useDirection ? getOrbitDirection(body) : 1;
  const orbitPeriodHours = getBodyOrbitPeriodHours(body);
  if (orbitPeriodHours > 0) {
    const scaledSeconds = orbitPeriodHours * 3600 * Math.max(orbitTimeScale, 1e-6);
    return direction * (Math.PI * 2) / scaledSeconds;
  }
  return 0;
}

export function getRotationPeriodHours(body) {
  if (!body) {
    return undefined;
  }
  const solarDayHours = Number(ROTATION_SOLAR_DAY_HOURS?.[body.id]);
  const orbitPeriodHours = getBodyOrbitPeriodHours(body);
  if (solarDayHours > 0 && orbitPeriodHours > 0) {
    const siderealCyclesPerHour = (1 / solarDayHours) + (getOrbitDirection(body) / orbitPeriodHours);
    if (Math.abs(siderealCyclesPerHour) > 1e-9) {
      return 1 / siderealCyclesPerHour;
    }
  }

  let hours = ROTATION_PERIOD_HOURS[body.id];
  if (hours === undefined && body.body_type === "moon" && body.orbital_period_days) {
    hours = body.orbital_period_days * 24;
  }
  return hours;
}
