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
  const particle = effects.trailParticles.find((entry) => entry?.active);
  assert(particle, `launch-atmosphere-effects-low-altitude-trail-lock: expected active particle at altitude ${altitudeAboveTerrainKm}`);
  return {
    lifeSec: particle.lifeSec,
    endScale: particle.endScale,
  };
}

const lowAltitude = captureTrailLifeAndScale(0.5);
const higherAltitude = captureTrailLifeAndScale(8.0);

assert(
  lowAltitude.lifeSec < higherAltitude.lifeSec,
  `launch-atmosphere-effects-low-altitude-trail-lock: expected shorter low-alt trail life, got ${lowAltitude.lifeSec} vs ${higherAltitude.lifeSec}`,
);
assert(
  lowAltitude.endScale < higherAltitude.endScale,
  `launch-atmosphere-effects-low-altitude-trail-lock: expected tighter low-alt trail scale, got ${lowAltitude.endScale} vs ${higherAltitude.endScale}`,
);

console.log("launch-atmosphere-effects-low-altitude-trail-lock: ok");
