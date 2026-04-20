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

const snapshot = {
  phase: "powered",
  thrustN: 1,
  throttle: 1,
  stageIndex: 0,
  altitudeAboveTerrainKm: 0.05,
};

applyLaunchAtmosphereEffects(effects, snapshot, {
  sceneParent,
  nowMs: 0,
  bodyVisible: true,
  bodyWorldPosition: new THREE.Vector3(0, 0, 0),
  bodyAtmosphereVelocityScene: new THREE.Vector3(2, 0, 0),
  upDirectionScene: new THREE.Vector3(0, 1, 0),
  renderRadiusScene: 0.5,
});

applyLaunchAtmosphereEffects(effects, snapshot, {
  sceneParent,
  nowMs: 200,
  bodyVisible: true,
  bodyWorldPosition: new THREE.Vector3(0, 0, 0),
  bodyAtmosphereVelocityScene: new THREE.Vector3(2, 0, 0),
  upDirectionScene: new THREE.Vector3(0, 1, 0),
  renderRadiusScene: 0.5,
});

assert(
  effects.root.visible === false,
  "launch-atmosphere-effects-liftoff-plume-lock: smoke trail root should remain hidden during liftoff",
);
assert(
  Array.isArray(effects.trailParticles) && effects.trailParticles.length === 0,
  "launch-atmosphere-effects-liftoff-plume-lock: trail particle pool should be empty",
);

console.log("launch-atmosphere-effects-liftoff-plume-lock: ok");
