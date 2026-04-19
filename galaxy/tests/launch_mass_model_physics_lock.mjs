import {
  createMassModelState,
  updateMassModelState,
} from "../app/static/js/physics/launch/launchActuators.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sampleStage1(propellantFraction) {
  return updateMassModelState(createMassModelState(), {
    bodyKind: "stage1",
    dtSeconds: 30,
    dryMassKg: 200_000,
    propellantMassKg: 3_400_000,
    propellantFraction,
    attachedMassKg: 1_420_000,
  });
}

const full = sampleStage1(1);
const mid = sampleStage1(0.5);
const nearEmpty = sampleStage1(0.05);

assert(full.inertiaNormalized > mid.inertiaNormalized, "mass-model-lock: expected stage1 inertia to fall by mid burn");
assert(mid.inertiaNormalized > nearEmpty.inertiaNormalized, "mass-model-lock: expected stage1 inertia to keep falling near depletion");
assert(full.controlAuthorityScale < mid.controlAuthorityScale, "mass-model-lock: expected stage1 control authority to improve by mid burn");
assert(mid.controlAuthorityScale <= nearEmpty.controlAuthorityScale, "mass-model-lock: expected stage1 control authority to stay strongest near depletion");
assert(nearEmpty.comNormalized > full.comNormalized, "mass-model-lock: expected stage1 CG to end farther from the engine plane than at liftoff");

console.log("launch-mass-model-physics-lock: ok");
