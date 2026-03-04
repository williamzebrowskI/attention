export const EARTH_SOLID_TIDE_ENABLED = true;
export const EARTH_SOLID_TIDE_SOURCE_BODY_IDS = Object.freeze(["moon", "sun"]);
export const EARTH_SOLID_TIDE_LOVE_NUMBER_K2 = 0.299;

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function finiteVector(value) {
  if (!value) {
    return null;
  }
  if (
    Number.isFinite(Number(value.x))
    && Number.isFinite(Number(value.y))
    && Number.isFinite(Number(value.z))
  ) {
    return {
      x: Number(value.x),
      y: Number(value.y),
      z: Number(value.z),
    };
  }
  return null;
}

function length(v) {
  return Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z));
}

function scale(v, scalar) {
  return {
    x: v.x * scalar,
    y: v.y * scalar,
    z: v.z * scalar,
  };
}

function add(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

export function computeEarthSolidTidePerturbationKmS2({
  targetPosKm = null,
  earthPosKm = null,
  earthRadiusKm = Number.NaN,
  gravitationalConstantKm3PerKgS2 = Number.NaN,
  loveNumber2 = EARTH_SOLID_TIDE_LOVE_NUMBER_K2,
  tideRaisingBodies = [],
} = {}) {
  const target = finiteVector(targetPosKm);
  const earth = finiteVector(earthPosKm);
  const earthRadius = finiteNumber(earthRadiusKm);
  const gravitationalConstant = finiteNumber(gravitationalConstantKm3PerKgS2);
  const k2 = Math.max(0, finiteNumber(loveNumber2));
  if (
    !target
    || !earth
    || !(earthRadius > 0)
    || !(gravitationalConstant > 0)
    || !(k2 > 0)
    || !Array.isArray(tideRaisingBodies)
    || tideRaisingBodies.length === 0
  ) {
    return { x: 0, y: 0, z: 0 };
  }

  const relSat = subtract(target, earth);
  const satRadius = length(relSat);
  if (!(satRadius > 1e-9)) {
    return { x: 0, y: 0, z: 0 };
  }

  const satRadiusSq = satRadius * satRadius;
  const satRadius5 = satRadiusSq * satRadiusSq * satRadius;
  const satRadius7 = satRadius5 * satRadiusSq;
  const earthRadius5 = earthRadius ** 5;

  let total = { x: 0, y: 0, z: 0 };
  for (const body of tideRaisingBodies) {
    const bodyPos = finiteVector(body?.positionKm);
    const bodyMassKg = finiteNumber(body?.massKg);
    if (!bodyPos || !(bodyMassKg > 0)) {
      continue;
    }
    const relBody = subtract(bodyPos, earth);
    const bodyDistance = length(relBody);
    if (!(bodyDistance > 1e-9)) {
      continue;
    }
    const bodyDistance3 = bodyDistance * bodyDistance * bodyDistance;
    const muBody = gravitationalConstant * bodyMassKg;
    const tideScale = (k2 * muBody * earthRadius5) / bodyDistance3;
    if (!(Math.abs(tideScale) > 1e-24)) {
      continue;
    }

    const bodyUnit = scale(relBody, 1 / bodyDistance);
    const projection = dot(relSat, bodyUnit);
    const termAlongBody = scale(bodyUnit, (-3 * projection) / satRadius5);
    const termAlongRadius = scale(
      relSat,
      (-1.5 * (satRadiusSq - (5 * projection * projection))) / satRadius7,
    );
    total = add(total, scale(add(termAlongBody, termAlongRadius), tideScale));
  }

  if (
    !Number.isFinite(total.x)
    || !Number.isFinite(total.y)
    || !Number.isFinite(total.z)
  ) {
    return { x: 0, y: 0, z: 0 };
  }
  return total;
}
