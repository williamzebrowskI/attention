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

const particle = effects.trailParticles[0];
particle.active = true;
particle.mesh.visible = true;
particle.mesh.position.set(10, 0, 0);
particle.velocity.set(0, 0, 0);
particle.ageSec = 0;
particle.lifeSec = 10;
particle.startScale = 1;
particle.endScale = 1;
particle.material.opacity = 0.5;
effects.lastUpdateMs = 0;

applyLaunchAtmosphereEffects(effects, null, {
  sceneParent,
  nowMs: 1000,
  bodyVisible: false,
  earthWorldPosition: new THREE.Vector3(0, 0, 0),
  earthAngularVelocityScene: new THREE.Vector3(0, 1, 0),
});

assert(
  particle.mesh.position.z < -1.5,
  `launch-atmosphere-effects-earth-rotation-lock: expected particle to corotate, got z=${particle.mesh.position.z}`,
);

console.log("launch-atmosphere-effects-earth-rotation-lock: ok");
