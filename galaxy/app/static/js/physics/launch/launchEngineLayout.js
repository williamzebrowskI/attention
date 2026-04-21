function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteNonNegativeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, Math.round(Number(fallback) || 0));
  }
  return Math.max(0, Math.round(numeric));
}

function createCircularEngineDescriptors({
  prefix,
  count,
  radius,
  phaseRadians = 0,
  y = 0,
  ring = "",
}) {
  const total = Math.max(1, finiteNonNegativeInteger(count, 1));
  const ringRadius = Math.max(0, Number(radius) || 0);
  const centerY = Number(y) || 0;
  const descriptors = [];
  for (let index = 0; index < total; index += 1) {
    const angle = ((index / total) * Math.PI * 2) + phaseRadians;
    descriptors.push({
      id: `${prefix}_${String(index + 1).padStart(2, "0")}`,
      ring,
      x: Math.cos(angle) * ringRadius,
      y: centerY,
      z: Math.sin(angle) * ringRadius,
      orderInRing: index,
    });
  }
  return descriptors;
}

function normalizeIndexSet(indices, maxIndexExclusive) {
  const limit = Math.max(0, finiteNonNegativeInteger(maxIndexExclusive, 0));
  const set = new Set();
  if (!Array.isArray(indices) || limit <= 0) {
    return set;
  }
  for (const value of indices) {
    const numeric = finiteNonNegativeInteger(value, -1);
    if (numeric >= 0 && numeric < limit) {
      set.add(numeric);
    }
  }
  return set;
}

export function createSuperHeavyEngineDescriptors(radius = 1, enginePlaneY = 0) {
  const safeRadius = Math.max(1e-9, Number(radius) || 1e-9);
  const outerRingRadius = clamp(safeRadius * 0.69, safeRadius * 0.42, safeRadius * 0.74);
  const midRingRadius = clamp(outerRingRadius * 0.57, safeRadius * 0.22, outerRingRadius * 0.63);
  const coreRingRadius = clamp(outerRingRadius * 0.24, safeRadius * 0.08, outerRingRadius * 0.3);
  return [
    ...createCircularEngineDescriptors({
      prefix: "outer",
      count: 20,
      radius: outerRingRadius,
      phaseRadians: Math.PI / 20,
      y: enginePlaneY,
      ring: "outer",
    }),
    ...createCircularEngineDescriptors({
      prefix: "mid",
      count: 10,
      radius: midRingRadius,
      phaseRadians: Math.PI / 10,
      y: enginePlaneY,
      ring: "mid",
    }),
    ...createCircularEngineDescriptors({
      prefix: "core",
      count: 3,
      radius: coreRingRadius,
      phaseRadians: Math.PI / 6,
      y: enginePlaneY,
      ring: "core",
    }),
  ].map((descriptor, index) => ({
    ...descriptor,
    index,
  }));
}

export function createStarshipStage2EngineDescriptors(radius = 1, enginePlaneY = 0) {
  const safeRadius = Math.max(1e-9, Number(radius) || 1e-9);
  const outerRingRadius = clamp(safeRadius * 0.44, safeRadius * 0.16, safeRadius * 0.5);
  const innerRingRadius = clamp(safeRadius * 0.21, safeRadius * 0.08, safeRadius * 0.27);
  return [
    ...createCircularEngineDescriptors({
      prefix: "vac",
      count: 3,
      radius: outerRingRadius,
      phaseRadians: 0,
      y: enginePlaneY,
      ring: "vac",
    }),
    ...createCircularEngineDescriptors({
      prefix: "sea",
      count: 3,
      radius: innerRingRadius,
      phaseRadians: Math.PI / 3,
      y: enginePlaneY,
      ring: "sea",
    }),
  ].map((descriptor, index) => ({
    ...descriptor,
    index,
  }));
}

export function superHeavyEngineActivationOrder(descriptors = []) {
  const core = [];
  const mid = [];
  const outer = [];
  descriptors.forEach((descriptor, index) => {
    const ring = String(descriptor?.ring || "").toLowerCase();
    if (ring === "core") {
      core.push(index);
      return;
    }
    if (ring === "mid") {
      mid.push(index);
      return;
    }
    outer.push(index);
  });
  return [...core, ...mid, ...outer];
}

export function starshipStage2EngineActivationOrder(descriptors = []) {
  const sea = [];
  const vac = [];
  descriptors.forEach((descriptor, index) => {
    const ring = String(descriptor?.ring || "").toLowerCase();
    if (ring === "sea") {
      sea.push(index);
      return;
    }
    vac.push(index);
  });
  return [...sea, ...vac];
}

export function resolveActiveEngineSelection({
  descriptors = [],
  activationOrder = null,
  desiredEngineCount = null,
  failedEngineIndices = null,
} = {}) {
  const totalDescriptors = Array.isArray(descriptors) ? descriptors.length : 0;
  const desiredCount = clamp(
    finiteNonNegativeInteger(
      desiredEngineCount,
      totalDescriptors,
    ),
    0,
    totalDescriptors,
  );
  const baseOrder = Array.isArray(activationOrder) && activationOrder.length > 0
    ? activationOrder
    : descriptors.map((_, index) => index);
  const normalizedOrder = baseOrder.filter((index, position, array) => (
    Number.isInteger(index)
    && index >= 0
    && index < totalDescriptors
    && array.indexOf(index) === position
  ));
  const desiredIndices = normalizedOrder.slice(0, desiredCount);
  const failedSet = normalizeIndexSet(failedEngineIndices, totalDescriptors);
  const activeIndices = desiredIndices.filter((index) => !failedSet.has(index));
  const activeSet = new Set(activeIndices);
  const inactiveIndices = [];
  for (let index = 0; index < totalDescriptors; index += 1) {
    if (!activeSet.has(index)) {
      inactiveIndices.push(index);
    }
  }
  return {
    desiredIndices,
    activeIndices,
    inactiveIndices,
    failedDesiredIndices: desiredIndices.filter((index) => failedSet.has(index)),
    desiredCount,
    activeCount: activeIndices.length,
  };
}
