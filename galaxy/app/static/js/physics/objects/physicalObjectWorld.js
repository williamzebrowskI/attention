const EPSILON = 1e-12;

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function finitePositiveNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v, scalar) {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function cross(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function length(v) {
  return Math.sqrt(Math.max(0, dot(v, v)));
}

function normalize(v, fallback = { x: 0, y: 0, z: 1 }) {
  const mag = length(v);
  if (!(mag > EPSILON)) {
    return { ...fallback };
  }
  return scale(v, 1 / mag);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampVectorToAabb(localPoint, halfExtents) {
  return {
    x: clamp(localPoint.x, -halfExtents.x, halfExtents.x),
    y: clamp(localPoint.y, -halfExtents.y, halfExtents.y),
    z: clamp(localPoint.z, -halfExtents.z, halfExtents.z),
  };
}

function closestPointDistanceSqToAabb(localPoint, halfExtents) {
  const closest = clampVectorToAabb(localPoint, halfExtents);
  return dot(subtract(localPoint, closest), subtract(localPoint, closest));
}

function closestSegmentPointToAabbLocal(startLocal, endLocal, halfExtents) {
  const direction = subtract(endLocal, startLocal);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 48; i += 1) {
    const m1 = lo + ((hi - lo) / 3);
    const m2 = hi - ((hi - lo) / 3);
    const p1 = add(startLocal, scale(direction, m1));
    const p2 = add(startLocal, scale(direction, m2));
    const d1 = closestPointDistanceSqToAabb(p1, halfExtents);
    const d2 = closestPointDistanceSqToAabb(p2, halfExtents);
    if (d1 < d2) {
      hi = m2;
    } else {
      lo = m1;
    }
  }
  const t = clamp((lo + hi) * 0.5, 0, 1);
  const segmentPointLocal = add(startLocal, scale(direction, t));
  const boxPointLocal = clampVectorToAabb(segmentPointLocal, halfExtents);
  return {
    t,
    segmentPointLocal,
    boxPointLocal,
    distanceSq: closestPointDistanceSqToAabb(segmentPointLocal, halfExtents),
  };
}

function sanitizeAxes(rawAxes = {}) {
  const zAxis = normalize(rawAxes.z || rawAxes.up || { x: 0, y: 0, z: 1 });
  const xRaw = normalize(rawAxes.x || { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const yAxis = normalize(cross(zAxis, xRaw), { x: 0, y: 1, z: 0 });
  const xAxis = normalize(cross(yAxis, zAxis), { x: 1, y: 0, z: 0 });
  return { x: xAxis, y: yAxis, z: zAxis };
}

function worldPointToBoxLocal(pointKm, box) {
  const relative = subtract(pointKm, box.centerKm);
  return {
    x: dot(relative, box.axes.x),
    y: dot(relative, box.axes.y),
    z: dot(relative, box.axes.z),
  };
}

function boxLocalPointToWorld(localPoint, box) {
  return add(
    add(
      add(box.centerKm, scale(box.axes.x, localPoint.x)),
      scale(box.axes.y, localPoint.y),
    ),
    scale(box.axes.z, localPoint.z),
  );
}

function boxLocalDirectionToWorld(localDirection, box) {
  return normalize(add(
    add(scale(box.axes.x, localDirection.x), scale(box.axes.y, localDirection.y)),
    scale(box.axes.z, localDirection.z),
  ));
}

function nearestInsideFaceNormalLocal(localPoint, halfExtents) {
  const distances = [
    { axis: "x", sign: localPoint.x >= 0 ? 1 : -1, distance: halfExtents.x - Math.abs(localPoint.x) },
    { axis: "y", sign: localPoint.y >= 0 ? 1 : -1, distance: halfExtents.y - Math.abs(localPoint.y) },
    { axis: "z", sign: localPoint.z >= 0 ? 1 : -1, distance: halfExtents.z - Math.abs(localPoint.z) },
  ].sort((a, b) => a.distance - b.distance);
  const nearest = distances[0] || { axis: "z", sign: 1 };
  return {
    x: nearest.axis === "x" ? nearest.sign : 0,
    y: nearest.axis === "y" ? nearest.sign : 0,
    z: nearest.axis === "z" ? nearest.sign : 0,
  };
}

export function createStaticBoxCollider({
  id,
  centerKm,
  axes = null,
  halfExtentsKm,
  surfaceVelocityKmS = { x: 0, y: 0, z: 0 },
  material = null,
  metadata = null,
} = {}) {
  return {
    id: String(id || "static-box"),
    type: "oriented-box",
    static: true,
    centerKm: {
      x: finiteNumber(centerKm?.x),
      y: finiteNumber(centerKm?.y),
      z: finiteNumber(centerKm?.z),
    },
    axes: sanitizeAxes(axes),
    halfExtentsKm: {
      x: finitePositiveNumber(halfExtentsKm?.x, 0.001),
      y: finitePositiveNumber(halfExtentsKm?.y, 0.001),
      z: finitePositiveNumber(halfExtentsKm?.z, 0.001),
    },
    surfaceVelocityKmS: {
      x: finiteNumber(surfaceVelocityKmS?.x),
      y: finiteNumber(surfaceVelocityKmS?.y),
      z: finiteNumber(surfaceVelocityKmS?.z),
    },
    material: {
      restitution: clamp(finiteNumber(material?.restitution, 0.08), 0, 1),
      friction: clamp(finiteNumber(material?.friction, 0.62), 0, 1.8),
      ...((material && typeof material === "object") ? material : {}),
    },
    metadata: metadata && typeof metadata === "object" ? { ...metadata } : {},
  };
}

export function createCapsuleRigidBody({
  id,
  massKg,
  positionKm,
  velocityKmS,
  axisKm,
  halfLengthKm,
  radiusKm,
  material = null,
  metadata = null,
} = {}) {
  return {
    id: String(id || "dynamic-capsule"),
    type: "capsule-rigid-body",
    massKg: finitePositiveNumber(massKg, 1),
    positionKm: {
      x: finiteNumber(positionKm?.x),
      y: finiteNumber(positionKm?.y),
      z: finiteNumber(positionKm?.z),
    },
    velocityKmS: {
      x: finiteNumber(velocityKmS?.x),
      y: finiteNumber(velocityKmS?.y),
      z: finiteNumber(velocityKmS?.z),
    },
    axisKm: normalize(axisKm, { x: 0, y: 0, z: 1 }),
    halfLengthKm: finitePositiveNumber(halfLengthKm, 0.001),
    radiusKm: finitePositiveNumber(radiusKm, 0.001),
    material: {
      restitution: clamp(finiteNumber(material?.restitution, 0.04), 0, 1),
      friction: clamp(finiteNumber(material?.friction, 0.72), 0, 1.8),
      ...((material && typeof material === "object") ? material : {}),
    },
    metadata: metadata && typeof metadata === "object" ? { ...metadata } : {},
  };
}

export function capsuleSegmentEndpoints(body) {
  const axis = normalize(body?.axisKm, { x: 0, y: 0, z: 1 });
  const halfLengthKm = finitePositiveNumber(body?.halfLengthKm, 0);
  const center = body?.positionKm || { x: 0, y: 0, z: 0 };
  return {
    startKm: add(center, scale(axis, -halfLengthKm)),
    endKm: add(center, scale(axis, halfLengthKm)),
  };
}

export function queryCapsuleBoxContact(body, box) {
  if (!body || !box || box.type !== "oriented-box") {
    return null;
  }
  const { startKm, endKm } = capsuleSegmentEndpoints(body);
  const startLocal = worldPointToBoxLocal(startKm, box);
  const endLocal = worldPointToBoxLocal(endKm, box);
  const closest = closestSegmentPointToAabbLocal(startLocal, endLocal, box.halfExtentsKm);
  const distanceKm = Math.sqrt(Math.max(0, closest.distanceSq));
  const radiusKm = finitePositiveNumber(body.radiusKm, 0);
  if (distanceKm > radiusKm) {
    return null;
  }

  const segmentPointKm = boxLocalPointToWorld(closest.segmentPointLocal, box);
  const boxPointKm = boxLocalPointToWorld(closest.boxPointLocal, box);
  let normalKm = null;
  if (distanceKm > 1e-9) {
    normalKm = normalize(subtract(segmentPointKm, boxPointKm));
  } else {
    normalKm = boxLocalDirectionToWorld(
      nearestInsideFaceNormalLocal(closest.segmentPointLocal, box.halfExtentsKm),
      box,
    );
  }
  const penetrationKm = Math.max(0, radiusKm - distanceKm);
  const relativeVelocityKmS = subtract(
    body.velocityKmS || { x: 0, y: 0, z: 0 },
    box.surfaceVelocityKmS || { x: 0, y: 0, z: 0 },
  );
  const normalSpeedKmS = dot(relativeVelocityKmS, normalKm);
  const tangentVelocityKmS = subtract(relativeVelocityKmS, scale(normalKm, normalSpeedKmS));
  return {
    bodyId: body.id,
    colliderId: box.id,
    colliderType: box.type,
    contactPointKm: boxPointKm,
    bodyPointKm: segmentPointKm,
    normalKm,
    penetrationKm,
    distanceKm,
    segmentT: closest.t,
    relativeVelocityKmS,
    normalSpeedKmS,
    tangentVelocityKmS,
    tangentSpeedKmS: length(tangentVelocityKmS),
    surfaceVelocityKmS: { ...(box.surfaceVelocityKmS || { x: 0, y: 0, z: 0 }) },
    material: { ...(box.material || {}) },
    metadata: { ...(box.metadata || {}) },
  };
}

export function queryRigidBodyContacts(body, staticColliders = []) {
  if (!body || body.type !== "capsule-rigid-body" || !Array.isArray(staticColliders)) {
    return [];
  }
  return staticColliders
    .map((collider) => queryCapsuleBoxContact(body, collider))
    .filter(Boolean)
    .sort((a, b) => b.penetrationKm - a.penetrationKm);
}

export function resolveDynamicBodyContacts(body, staticColliders = [], options = {}) {
  const contacts = queryRigidBodyContacts(body, staticColliders);
  if (contacts.length === 0) {
    return { body, contacts, resolved: false };
  }
  const positionCorrectionScale = clamp(finiteNumber(options.positionCorrectionScale, 1), 0, 1.2);
  const velocityCorrectionScale = clamp(finiteNumber(options.velocityCorrectionScale, 1), 0, 1.2);
  let resolvedBody = {
    ...body,
    positionKm: { ...body.positionKm },
    velocityKmS: { ...body.velocityKmS },
  };
  const resolvedContacts = [];
  for (const contact of contacts) {
    if (contact.penetrationKm > 0) {
      resolvedBody.positionKm = add(
        resolvedBody.positionKm,
        scale(contact.normalKm, contact.penetrationKm * positionCorrectionScale),
      );
    }
    const relativeVelocityKmS = subtract(
      resolvedBody.velocityKmS,
      contact.surfaceVelocityKmS,
    );
    const normalSpeedKmS = dot(relativeVelocityKmS, contact.normalKm);
    let nextRelativeVelocityKmS = relativeVelocityKmS;
    if (normalSpeedKmS < 0) {
      const restitution = clamp(
        Math.min(
          finiteNumber(body.material?.restitution, 0.04),
          finiteNumber(contact.material?.restitution, Number.POSITIVE_INFINITY),
        ),
        0,
        1,
      );
      nextRelativeVelocityKmS = subtract(
        nextRelativeVelocityKmS,
        scale(contact.normalKm, normalSpeedKmS * (1 + restitution) * velocityCorrectionScale),
      );
    }
    const correctedNormalSpeedKmS = dot(nextRelativeVelocityKmS, contact.normalKm);
    const tangentKmS = subtract(nextRelativeVelocityKmS, scale(contact.normalKm, correctedNormalSpeedKmS));
    const friction = clamp(
      Math.max(
        finiteNumber(body.material?.friction, 0.72),
        finiteNumber(contact.material?.friction, 0),
      ) * velocityCorrectionScale,
      0,
      1,
    );
    nextRelativeVelocityKmS = subtract(nextRelativeVelocityKmS, scale(tangentKmS, friction));
    resolvedBody.velocityKmS = add(contact.surfaceVelocityKmS, nextRelativeVelocityKmS);
    resolvedContacts.push({
      ...contact,
      appliedNormalSpeedKmS: normalSpeedKmS,
      resolvedVelocityKmS: { ...resolvedBody.velocityKmS },
    });
  }
  return {
    body: resolvedBody,
    contacts: resolvedContacts,
    resolved: true,
    primaryContact: resolvedContacts[0] || null,
  };
}
