import {
  createSuperHeavyEngineDescriptors,
  resolveActiveEngineSelection,
  superHeavyEngineActivationOrder,
} from "../app/static/js/physics/launch/launchEngineLayout.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const descriptors = createSuperHeavyEngineDescriptors(1, 0);
  assert(descriptors.length === 33, `expected 33 booster engine descriptors, got ${descriptors.length}`);

  const activationOrder = superHeavyEngineActivationOrder(descriptors);
  const recoverySelection = resolveActiveEngineSelection({
    descriptors,
    activationOrder,
    desiredEngineCount: 13,
  });
  assert(recoverySelection.activeCount === 13, `expected 13 active recovery engines, got ${recoverySelection.activeCount}`);
  const recoveryRings = recoverySelection.activeIndices.map((index) => descriptors[index]?.ring);
  assert(recoveryRings.filter((ring) => ring === "core").length === 3, `expected 3 core engines in recovery set, got ${JSON.stringify(recoveryRings)}`);
  assert(recoveryRings.filter((ring) => ring === "mid").length === 10, `expected 10 mid engines in recovery set, got ${JSON.stringify(recoveryRings)}`);
  assert(!recoveryRings.includes("outer"), `did not expect outer-ring engines in nominal 13-engine recovery set, got ${JSON.stringify(recoveryRings)}`);

  const asymmetricSelection = resolveActiveEngineSelection({
    descriptors,
    activationOrder,
    desiredEngineCount: 2,
  });
  assert(asymmetricSelection.activeCount === 2, `expected 2 active engines, got ${asymmetricSelection.activeCount}`);
  const centroid = asymmetricSelection.activeIndices.reduce((sum, index) => ({
    x: sum.x + (Number(descriptors[index]?.x) || 0),
    z: sum.z + (Number(descriptors[index]?.z) || 0),
  }), { x: 0, z: 0 });
  assert(
    Math.hypot(centroid.x, centroid.z) > 1e-6,
    `expected asymmetric 2-engine centroid offset, got ${JSON.stringify(centroid)}`,
  );

  console.log("PASS launch-per-engine-activation-lock");
}

main();
