import * as THREE from "../app/static/vendor/three/three.module.js";
import {
  applyLaunchAtmosphereEffects,
  createLaunchAtmosphereEffects,
} from "../app/static/js/physics/launch/launchAtmosphereEffects.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const effects = createLaunchAtmosphereEffects(THREE, {
  stage0BodyHeightScene: 1,
  stage2BodyHeightScene: 0.5,
});
const sceneParent = new THREE.Group();
sceneParent.add(effects.root);

applyLaunchAtmosphereEffects(effects, null, {
  sceneParent,
  nowMs: 1000,
  bodyVisible: false,
  earthWorldPosition: new THREE.Vector3(0, 0, 0),
  earthAngularVelocityScene: new THREE.Vector3(0, 1, 0),
});

assert(
  effects.root.visible === false,
  "launch-atmosphere-effects-earth-rotation-lock: smoke trail root should stay hidden",
);
assert(
  Array.isArray(effects.trailParticles) && effects.trailParticles.length === 0,
  "launch-atmosphere-effects-earth-rotation-lock: trail particle pool should be empty",
);

console.log("launch-atmosphere-effects-earth-rotation-lock: ok");
