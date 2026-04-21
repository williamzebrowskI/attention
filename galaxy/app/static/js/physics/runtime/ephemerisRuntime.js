import {
  fromPerifocalFrame,
  getMoonOrbitalElements,
  normalizeAngle,
  solveKepler,
} from "../celestialPhysics.js";
import {
  ORBIT_ECCENTRICITY,
  MOON_ORBIT_DIRECTION,
  ORBIT_PERIHELION_DEG,
} from "../../config/orbitalConfig.js";

const J2000_EPOCH_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

function rad(value) {
  return (Number(value) || 0) * Math.PI / 180;
}

function finiteNumber(value, fallback = Number.NaN) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector3(value) {
  return {
    x: Number(value?.x) || 0,
    y: Number(value?.y) || 0,
    z: Number(value?.z) || 0,
  };
}

function addVector3(a, b) {
  return {
    x: (Number(a?.x) || 0) + (Number(b?.x) || 0),
    y: (Number(a?.y) || 0) + (Number(b?.y) || 0),
    z: (Number(a?.z) || 0) + (Number(b?.z) || 0),
  };
}

function orbitPeriodSec(body) {
  const days = finiteNumber(body?.orbital_period_days, Number.NaN);
  return days > 0 ? days * 86400 : Number.NaN;
}

function orbitDirection(body) {
  if (String(body?.body_type || "").trim().toLowerCase() === "moon") {
    return Number(MOON_ORBIT_DIRECTION?.[body?.id]) || 1;
  }
  return 1;
}

function phaseOffsetRad(body) {
  return normalizeAngle((finiteNumber(body?.phase, 0) || 0) * Math.PI * 2);
}

function orbitMeanMotionRadS(body) {
  const periodSec = orbitPeriodSec(body);
  if (!(periodSec > 0)) {
    return 0;
  }
  return orbitDirection(body) * ((Math.PI * 2) / periodSec);
}

function orbitalStateFromElements({
  aKm = 0,
  e = 0,
  inclinationRad = 0,
  ascendingNodeRad = 0,
  argPeriapsisRad = 0,
  meanAnomalyRad = 0,
  muKm3S2 = 0,
} = {}) {
  if (!(aKm > 0) || !(muKm3S2 > 0)) {
    return null;
  }
  const eccentricity = Math.max(0, Math.min(0.95, Number(e) || 0));
  const eccentricAnomaly = solveKepler(normalizeAngle(meanAnomalyRad), eccentricity);
  const radiusKm = aKm * (1 - (eccentricity * Math.cos(eccentricAnomaly)));
  if (!(radiusKm > 1e-9)) {
    return null;
  }
  const bKm = aKm * Math.sqrt(Math.max(1 - (eccentricity * eccentricity), 1e-9));
  const perifocalPosition = {
    x: aKm * (Math.cos(eccentricAnomaly) - eccentricity),
    y: bKm * Math.sin(eccentricAnomaly),
    z: 0,
  };
  const velocityScale = Math.sqrt(muKm3S2 * aKm) / radiusKm;
  const perifocalVelocity = {
    x: -velocityScale * Math.sin(eccentricAnomaly),
    y: velocityScale * Math.sqrt(Math.max(1 - (eccentricity * eccentricity), 1e-9)) * Math.cos(eccentricAnomaly),
    z: 0,
  };
  const elements = {
    inclinationRad,
    ascendingNodeRad,
    argPeriapsisRad,
  };
  return {
    position: fromPerifocalFrame(perifocalPosition, elements),
    velocity: fromPerifocalFrame(perifocalVelocity, elements),
  };
}

function fallbackOrbitalElementsForBody(body) {
  if (String(body?.body_type || "").trim().toLowerCase() === "moon") {
    const elements = getMoonOrbitalElements(body);
    return {
      e: finiteNumber(elements.e, 0),
      inclinationRad: finiteNumber(elements.inclinationRad, 0),
      ascendingNodeRad: finiteNumber(elements.ascendingNodeRad, 0),
      argPeriapsisRad: finiteNumber(elements.argPeriapsisRad, 0),
    };
  }
  if (String(body?.body_type || "").trim().toLowerCase() === "planet") {
    return {
      e: finiteNumber(ORBIT_ECCENTRICITY?.[body?.id], 0),
      inclinationRad: 0,
      ascendingNodeRad: 0,
      argPeriapsisRad: rad(ORBIT_PERIHELION_DEG?.[body?.id] || 0),
    };
  }
  return {
    e: 0,
    inclinationRad: 0,
    ascendingNodeRad: 0,
    argPeriapsisRad: 0,
  };
}

function createEphemerisEntry(bodyId, position, velocity, source, timestampMs, sourceError) {
  return {
    id: String(bodyId || ""),
    coordinates_km: cloneVector3(position),
    coordinates_velocity_km_s: cloneVector3(velocity),
    source: String(source || "local_ephemeris"),
    source_error: String(sourceError || ""),
    timestamp_utc: new Date(Number(timestampMs) || Date.now()).toISOString(),
  };
}

export function createPhysicsEphemerisRuntime(options = {}) {
  const {
    sourceTag = "local_ephemeris",
    sourceErrorTag = "startup_snapshot_unavailable",
  } = options;

  function buildCatalogEntries({
    bodies = [],
    bodyMassKgById = () => null,
    nowMs = Date.now(),
  } = {}) {
    const bodyById = new Map();
    for (const body of Array.isArray(bodies) ? bodies : []) {
      const bodyId = String(body?.id || "");
      if (bodyId) {
        bodyById.set(bodyId, body);
      }
    }

    const entriesById = new Map();
    const visiting = new Set();
    const elapsedSec = (Number(nowMs) - J2000_EPOCH_MS) / 1000;

    function resolveBodyEntry(bodyId) {
      const resolvedId = String(bodyId || "");
      if (!resolvedId) {
        return null;
      }
      if (entriesById.has(resolvedId)) {
        return entriesById.get(resolvedId) || null;
      }
      if (visiting.has(resolvedId)) {
        return null;
      }
      visiting.add(resolvedId);

      const body = bodyById.get(resolvedId) || null;
      let entry = null;

      if (body && resolvedId === "sun") {
        entry = createEphemerisEntry(
          "sun",
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
          `${sourceTag}:sun_anchor`,
          nowMs,
          sourceErrorTag,
        );
      } else if (body) {
        const parentId = String(body.parent || "sun").trim() || "sun";
        const parentEntry = resolveBodyEntry(parentId);
        const parentMassKg = finiteNumber(bodyMassKgById(parentId), Number.NaN);
        const elements = fallbackOrbitalElementsForBody(body);
        const orbit = parentEntry && Number.isFinite(parentMassKg) && parentMassKg > 0
          ? orbitalStateFromElements({
              aKm: finiteNumber(body.semimajor_axis_km, 0),
              e: elements.e,
              inclinationRad: elements.inclinationRad,
              ascendingNodeRad: elements.ascendingNodeRad,
              argPeriapsisRad: elements.argPeriapsisRad,
              meanAnomalyRad: phaseOffsetRad(body) + (orbitMeanMotionRadS(body) * elapsedSec),
              muKm3S2: 6.67430e-20 * parentMassKg,
            })
          : null;
        if (parentEntry && orbit) {
          entry = createEphemerisEntry(
            resolvedId,
            addVector3(parentEntry?.coordinates_km, orbit.position),
            addVector3(parentEntry?.coordinates_velocity_km_s, orbit.velocity),
            `${sourceTag}:${String(body.body_type || "body").trim().toLowerCase()}_orbit`,
            nowMs,
            sourceErrorTag,
          );
        }
      }

      visiting.delete(resolvedId);
      if (entry) {
        entriesById.set(resolvedId, entry);
      }
      return entry;
    }

    for (const body of bodies) {
      resolveBodyEntry(body?.id);
    }
    return entriesById;
  }

  return {
    buildCatalogEntries,
  };
}
