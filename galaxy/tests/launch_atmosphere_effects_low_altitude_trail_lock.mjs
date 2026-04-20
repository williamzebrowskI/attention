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

function captureTrailLifeAndScale(altitudeAboveTerrainKm) {
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
    altitudeAboveTerrainKm,
  };
  const randomValues = [0.25, 0.4, 0.6, 0.3, 0.2, 0.5, 0.7, 0.1];
  let randomIndex = 0;
  const originalRandom = Math.random;
  Math.random = () => {
    const value = randomValues[randomIndex % randomValues.length];
    randomIndex += 1;
    return value;
  };
  try {
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
  } finally {
    Math.random = originalRandom;
  }
  return {
    rootVisible: effects.root.visible,
    trailParticleCount: effects.trailParticles.length,
  };
}

const lowAltitude = captureTrailLifeAndScale(0.5);
const higherAltitude = captureTrailLifeAndScale(8.0);

assert(
  lowAltitude.rootVisible === false && higherAltitude.rootVisible === false,
  "launch-atmosphere-effects-low-altitude-trail-lock: smoke trail root should remain hidden at all altitudes",
);
assert(
  lowAltitude.trailParticleCount === 0 && higherAltitude.trailParticleCount === 0,
  "launch-atmosphere-effects-low-altitude-trail-lock: smoke trail particle pool should stay empty",
);

console.log("launch-atmosphere-effects-low-altitude-trail-lock: ok");
