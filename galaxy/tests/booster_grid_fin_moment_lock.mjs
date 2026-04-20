import { computeGridFinControlState } from "../app/static/js/physics/launch/launchAeroModel.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const relPos = { x: 6400, y: 0, z: 0 };
  const relVel = { x: -0.12, y: 1.35, z: -0.02 };
  const desiredDirection = { x: -0.10, y: -0.995, z: 0.02 };
  const bodyAxisDirection = { x: 0.36, y: -0.93, z: 0.04 };

  const thinAir = computeGridFinControlState({
    bodyKind: "booster",
    atmosphereSample: {
      densityKgM3: 0.0002,
      dragEffectiveDensityKgM3: 0.0002,
    },
    relPos,
    relVel: { x: -0.08, y: 0.55, z: -0.01 },
    earthPole: { x: 0, y: 0, z: 1 },
    desiredDirection,
    bodyAxisDirection,
    massKg: 360_000,
    massModel: { inertiaNormalized: 1.0 },
  });
  assert(thinAir.momentNm < 1e5, `expected near-zero fin moment in thin air, got ${thinAir.momentNm}`);
  assert(thinAir.angularAccelerationRadS2 < 0.02, `expected near-zero fin angular accel in thin air, got ${thinAir.angularAccelerationRadS2}`);

  const denseAir = computeGridFinControlState({
    bodyKind: "booster",
    atmosphereSample: {
      densityKgM3: 0.024,
      dragEffectiveDensityKgM3: 0.024,
    },
    relPos,
    relVel,
    earthPole: { x: 0, y: 0, z: 1 },
    desiredDirection,
    bodyAxisDirection,
    massKg: 360_000,
    massModel: { inertiaNormalized: 1.0 },
  });
  assert(denseAir.active, "expected dense-air fin model to be active");
  assert(denseAir.momentNm > thinAir.momentNm * 20, `expected strong moment growth in dense air, got ${denseAir.momentNm} vs ${thinAir.momentNm}`);
  assert(denseAir.angularAccelerationRadS2 > thinAir.angularAccelerationRadS2 * 20, `expected strong angular accel growth in dense air, got ${denseAir.angularAccelerationRadS2} vs ${thinAir.angularAccelerationRadS2}`);

  const heavyBooster = computeGridFinControlState({
    bodyKind: "booster",
    atmosphereSample: {
      densityKgM3: 0.024,
      dragEffectiveDensityKgM3: 0.024,
    },
    relPos,
    relVel,
    earthPole: { x: 0, y: 0, z: 1 },
    desiredDirection,
    bodyAxisDirection,
    massKg: 520_000,
    massModel: { inertiaNormalized: 1.15 },
  });
  assert(heavyBooster.momentNm > 0, "expected nonzero fin moment for heavy booster");
  assert(heavyBooster.angularAccelerationRadS2 < denseAir.angularAccelerationRadS2, `expected heavier booster to turn slower, got ${heavyBooster.angularAccelerationRadS2} vs ${denseAir.angularAccelerationRadS2}`);

  const aligned = computeGridFinControlState({
    bodyKind: "booster",
    atmosphereSample: {
      densityKgM3: 0.024,
      dragEffectiveDensityKgM3: 0.024,
    },
    relPos,
    relVel,
    earthPole: { x: 0, y: 0, z: 1 },
    desiredDirection,
    bodyAxisDirection: desiredDirection,
    massKg: 360_000,
    massModel: { inertiaNormalized: 1.0 },
  });
  assert(aligned.momentNm === 0, `expected zero moment when aligned, got ${aligned.momentNm}`);
  assert(aligned.angularAccelerationRadS2 === 0, `expected zero angular accel when aligned, got ${aligned.angularAccelerationRadS2}`);

  console.log("PASS booster-grid-fin-moment-lock");
}

main();
