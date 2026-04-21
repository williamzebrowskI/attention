function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function finiteVector3(value) {
  return Boolean(
    value
    && Number.isFinite(Number(value.x))
    && Number.isFinite(Number(value.y))
    && Number.isFinite(Number(value.z))
  );
}

export function cloneVector3(value, fallback = { x: 0, y: 0, z: 0 }) {
  if (!finiteVector3(value)) {
    return {
      x: Number(fallback?.x) || 0,
      y: Number(fallback?.y) || 0,
      z: Number(fallback?.z) || 0,
    };
  }
  return {
    x: Number(value.x),
    y: Number(value.y),
    z: Number(value.z),
  };
}

export function parseVector3FromPayload(entry, fieldName) {
  const value = entry?.[fieldName];
  if (!finiteVector3(value)) {
    return null;
  }
  return cloneVector3(value);
}

export function createDynamicBodyRecord({
  id = "",
  massKg = 0,
  position = null,
  velocity = null,
} = {}) {
  const resolvedMassKg = finiteNumber(massKg);
  if (!(resolvedMassKg > 0) || !finiteVector3(position) || !finiteVector3(velocity)) {
    return null;
  }
  return {
    id: String(id || ""),
    massKg: resolvedMassKg,
    position: cloneVector3(position),
    velocity: cloneVector3(velocity),
  };
}

export function createStaticSourceRecord({
  id = "",
  massKg = 0,
  position = null,
  velocity = null,
} = {}) {
  const resolvedMassKg = finiteNumber(massKg);
  if (!(resolvedMassKg > 0) || !finiteVector3(position)) {
    return null;
  }
  return {
    id: String(id || ""),
    massKg: resolvedMassKg,
    position: cloneVector3(position),
    velocity: finiteVector3(velocity) ? cloneVector3(velocity) : null,
  };
}

export function createPhysicsWorldState({
  dynamicBodies = new Map(),
  staticSources = new Map(),
  nowMs = Date.now(),
} = {}) {
  const timestampMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  return {
    initialized: dynamicBodies.size > 0 || staticSources.size > 0,
    lastUpdateMs: timestampMs,
    simulationTimeMs: timestampMs,
    integratorAccumulatorSec: 0,
    dynamicBodies,
    staticSources,
  };
}

export function neutralizeTotalMomentum(worldStateOrDynamicBodies, anchorId = "sun") {
  const dynamicBodies = worldStateOrDynamicBodies?.dynamicBodies instanceof Map
    ? worldStateOrDynamicBodies.dynamicBodies
    : worldStateOrDynamicBodies;
  if (!(dynamicBodies instanceof Map)) {
    return;
  }

  const anchor = dynamicBodies.get(anchorId);
  if (!anchor || !(Number(anchor.massKg) > 0) || !finiteVector3(anchor.velocity)) {
    return;
  }

  let px = 0;
  let py = 0;
  let pz = 0;
  for (const body of dynamicBodies.values()) {
    if (!(Number(body?.massKg) > 0) || !finiteVector3(body?.velocity)) {
      continue;
    }
    px += Number(body.massKg) * Number(body.velocity.x);
    py += Number(body.massKg) * Number(body.velocity.y);
    pz += Number(body.massKg) * Number(body.velocity.z);
  }

  anchor.velocity.x -= px / Number(anchor.massKg);
  anchor.velocity.y -= py / Number(anchor.massKg);
  anchor.velocity.z -= pz / Number(anchor.massKg);
}

export function seedPhysicsWorldStateFromSnapshot({
  bodies = [],
  positionsById = new Map(),
  bodyMassKgById = () => null,
  excludedIds = new Set(),
  staticSourceIds = new Set(),
  nowMs = Date.now(),
  momentumAnchorId = "sun",
} = {}) {
  const dynamicBodies = new Map();
  const staticSources = new Map();

  for (const body of Array.isArray(bodies) ? bodies : []) {
    const bodyId = String(body?.id || "");
    if (!bodyId || excludedIds.has(bodyId)) {
      continue;
    }

    const entry = positionsById instanceof Map ? positionsById.get(bodyId) : null;
    const position = parseVector3FromPayload(entry, "coordinates_km");
    const velocity = parseVector3FromPayload(entry, "coordinates_velocity_km_s");
    const massKg = bodyMassKgById(bodyId);

    if (!position || !(Number(massKg) > 0)) {
      continue;
    }

    if (staticSourceIds.has(bodyId)) {
      const staticSource = createStaticSourceRecord({
        id: bodyId,
        massKg,
        position,
        velocity,
      });
      if (staticSource) {
        staticSources.set(bodyId, staticSource);
      }
      continue;
    }

    const dynamicBody = createDynamicBodyRecord({
      id: bodyId,
      massKg,
      position,
      velocity,
    });
    if (dynamicBody) {
      dynamicBodies.set(bodyId, dynamicBody);
    }
  }

  if (dynamicBodies.size === 0 && staticSources.size === 0) {
    return null;
  }

  const worldState = createPhysicsWorldState({
    dynamicBodies,
    staticSources,
    nowMs,
  });
  neutralizeTotalMomentum(worldState, momentumAnchorId);
  return worldState;
}

export function isPhysicsDrivenBodyId(worldState, bodyId) {
  if (!worldState?.initialized || !bodyId) {
    return false;
  }
  return Boolean(
    worldState.dynamicBodies?.has?.(bodyId)
    || worldState.staticSources?.has?.(bodyId)
  );
}
