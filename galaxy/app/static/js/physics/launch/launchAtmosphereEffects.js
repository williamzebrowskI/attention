function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function orthogonalVector(THREE, up) {
  const fallback = new THREE.Vector3(1, 0, 0);
  if (Math.abs(up.x) < 0.85) {
    fallback.set(1, 0, 0);
  } else {
    fallback.set(0, 0, 1);
  }
  const lateral = new THREE.Vector3().crossVectors(up, fallback);
  if (lateral.lengthSq() <= 1e-12) {
    return new THREE.Vector3(0, 0, 1);
  }
  return lateral.normalize();
}

function makeParticlePool(THREE, group, {
  geometry,
  count,
  color,
  renderOrder,
}) {
  const particles = [];
  for (let index = 0; index < count; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.renderOrder = renderOrder;
    group.add(mesh);
    particles.push({
      mesh,
      material,
      velocity: new THREE.Vector3(),
      ageSec: 0,
      lifeSec: 0,
      startScale: 1,
      endScale: 1,
      active: false,
      drift: 1,
    });
  }
  return particles;
}

function acquireParticle(pool) {
  for (let index = 0; index < pool.length; index += 1) {
    if (!pool[index].active) {
      return pool[index];
    }
  }
  let oldest = pool[0] || null;
  for (let index = 1; index < pool.length; index += 1) {
    if ((pool[index]?.ageSec || 0) > (oldest?.ageSec || 0)) {
      oldest = pool[index];
    }
  }
  return oldest;
}

function easeOut(value) {
  const t = clamp(value, 0, 1);
  return 1 - ((1 - t) * (1 - t));
}

function spawnParticle(pool, {
  position,
  velocity,
  lifeSec,
  startScale,
  endScale,
  opacity,
  drift = 1,
}) {
  const particle = acquireParticle(pool);
  if (!particle?.mesh) {
    return;
  }
  particle.active = true;
  particle.ageSec = 0;
  particle.lifeSec = Math.max(0.1, Number(lifeSec) || 0.1);
  particle.startScale = Math.max(1e-9, Number(startScale) || 1e-9);
  particle.endScale = Math.max(particle.startScale, Number(endScale) || particle.startScale);
  particle.drift = clamp(Number(drift) || 1, 0.2, 2.5);
  particle.mesh.position.copy(position);
  particle.mesh.scale.setScalar(particle.startScale);
  particle.mesh.visible = true;
  particle.material.opacity = clamp(Number(opacity) || 0, 0, 1);
  particle.velocity.copy(velocity);
}

function updateParticlePool(pool, dtSec, nowSec, atmosphereMotion = null) {
  void nowSec;
  const earthWorldPosition = atmosphereMotion?.earthWorldPosition || null;
  const earthAngularVelocityScene = atmosphereMotion?.earthAngularVelocityScene || null;
  const coRotate = Boolean(
    earthWorldPosition
    && earthAngularVelocityScene
    && earthWorldPosition.isVector3
    && earthAngularVelocityScene.isVector3
    && earthAngularVelocityScene.lengthSq() > 1e-18
  );
  const relativePosition = coRotate ? earthWorldPosition.clone() : null;
  const atmosphereVelocity = coRotate ? earthAngularVelocityScene.clone() : null;
  let activeCount = 0;
  for (let index = 0; index < pool.length; index += 1) {
    const particle = pool[index];
    if (!particle?.active || !particle.mesh) {
      continue;
    }
    particle.ageSec += dtSec;
    const progress = particle.ageSec / Math.max(particle.lifeSec, 1e-6);
    if (!(progress < 1)) {
      particle.active = false;
      particle.mesh.visible = false;
      particle.material.opacity = 0;
      continue;
    }
    activeCount += 1;
    particle.mesh.position.addScaledVector(
      particle.velocity,
      dtSec * particle.drift,
    );
    if (coRotate && relativePosition && atmosphereVelocity) {
      relativePosition.copy(particle.mesh.position).sub(earthWorldPosition);
      atmosphereVelocity.crossVectors(earthAngularVelocityScene, relativePosition);
      particle.mesh.position.addScaledVector(atmosphereVelocity, dtSec);
    }
    const scale = particle.startScale + ((particle.endScale - particle.startScale) * easeOut(progress));
    particle.mesh.scale.setScalar(scale);
    particle.material.opacity = clamp(
      particle.material.opacity * (1 - (dtSec * 0.2)),
      0,
      1,
    ) * clamp(1 - Math.pow(progress, 1.35), 0, 1);
  }
  return activeCount;
}

function spawnTrailPuffs(state, {
  bodyWorldPosition,
  bodyAtmosphereVelocityScene = null,
  upDirectionScene,
  renderRadiusScene,
  throttle,
  altitudeKm,
  dtSec,
}) {
  const THREE = state.THREE;
  const up = upDirectionScene.clone().normalize();
  const lateralA = orthogonalVector(THREE, up);
  const lateralB = new THREE.Vector3().crossVectors(up, lateralA).normalize();
  const activeHeightScene = altitudeKm < 1e-6
    ? state.stage0BodyHeightScene
    : (
      Number(state.lastStageIndex) >= 1
        ? state.stage2BodyHeightScene
        : state.stage0BodyHeightScene
    );
  const engineOffset = activeHeightScene * 0.52;
  const anchor = bodyWorldPosition.clone().addScaledVector(up, -engineOffset);
  const vehicleAtmosphereVelocity = bodyAtmosphereVelocityScene?.isVector3
    ? bodyAtmosphereVelocityScene.clone()
    : new THREE.Vector3();
  const vehicleAtmosphereSpeed = vehicleAtmosphereVelocity.length();
  const wakeDirection = vehicleAtmosphereSpeed > 1e-12
    ? vehicleAtmosphereVelocity.normalize().multiplyScalar(-1)
    : up.clone().multiplyScalar(-1);
  const exhaustDirection = up.clone()
    .multiplyScalar(-0.84)
    .addScaledVector(wakeDirection, 0.16)
    .normalize();
  const densityFade = clamp(1 - (altitudeKm / 18), 0, 1);
  const emissionRate = (8 + (throttle * 16)) * densityFade;
  state.trailAccumulator += emissionRate * dtSec;
  const spawnCount = Math.min(6, Math.floor(state.trailAccumulator));
  state.trailAccumulator -= spawnCount;
  for (let index = 0; index < spawnCount; index += 1) {
    const jitterA = (Math.random() - 0.5) * activeHeightScene * 0.9;
    const jitterB = (Math.random() - 0.5) * activeHeightScene * 0.9;
    const jitterUp = Math.random() * activeHeightScene * 0.16;
    const spawnPos = anchor.clone()
      .addScaledVector(lateralA, jitterA)
      .addScaledVector(lateralB, jitterB)
      .addScaledVector(up, jitterUp);
    const exhaustSpeedScene = Math.max(
      activeHeightScene * (12 + (throttle * 16)),
      renderRadiusScene * (16 + (throttle * 14)),
      vehicleAtmosphereSpeed * 1.35,
    );
    const carrySpeedScene = vehicleAtmosphereSpeed * 0.18;
    const velocity = exhaustDirection.clone().multiplyScalar(exhaustSpeedScene)
      .addScaledVector(wakeDirection, carrySpeedScene)
      .addScaledVector(lateralA, activeHeightScene * (Math.random() - 0.5) * 1.2)
      .addScaledVector(lateralB, activeHeightScene * (Math.random() - 0.5) * 1.2);
    const startScale = Math.max(renderRadiusScene * 1.1, activeHeightScene * 0.9);
    const endScale = startScale * (3.2 + (Math.random() * 1.8));
    spawnParticle(state.trailParticles, {
      position: spawnPos,
      velocity,
      lifeSec: 3.8 + (densityFade * 2.8) + (Math.random() * 0.8),
      startScale,
      endScale,
      opacity: 0.18 + (throttle * 0.14),
      drift: 1 + (Math.random() * 0.4),
    });
  }
}

function spawnPadCloudPuffs(state, {
  bodyWorldPosition,
  upDirectionScene,
  renderRadiusScene,
  throttle,
  dtSec,
}) {
  const THREE = state.THREE;
  const up = upDirectionScene.clone().normalize();
  const lateralA = orthogonalVector(THREE, up);
  const lateralB = new THREE.Vector3().crossVectors(up, lateralA).normalize();
  const anchor = bodyWorldPosition.clone().addScaledVector(up, -(state.stage0BodyHeightScene * 0.58));
  const emissionRate = 18 + (throttle * 28);
  state.padAccumulator += emissionRate * dtSec;
  const spawnCount = Math.min(10, Math.floor(state.padAccumulator));
  state.padAccumulator -= spawnCount;
  for (let index = 0; index < spawnCount; index += 1) {
    const radialAngle = Math.random() * Math.PI * 2;
    const radialDistance = state.stage0BodyHeightScene * (0.4 + (Math.random() * 1.9));
    const spawnPos = anchor.clone()
      .addScaledVector(lateralA, Math.cos(radialAngle) * radialDistance)
      .addScaledVector(lateralB, Math.sin(radialAngle) * radialDistance)
      .addScaledVector(up, Math.random() * state.stage0BodyHeightScene * 0.16);
    const velocity = up.clone().multiplyScalar(state.stage0BodyHeightScene * (0.3 + (Math.random() * 0.5)))
      .addScaledVector(lateralA, Math.cos(radialAngle) * state.stage0BodyHeightScene * (1.2 + (Math.random() * 1.1)))
      .addScaledVector(lateralB, Math.sin(radialAngle) * state.stage0BodyHeightScene * (1.2 + (Math.random() * 1.1)));
    const startScale = Math.max(renderRadiusScene * 1.8, state.stage0BodyHeightScene * 1.2);
    const endScale = startScale * (5 + (Math.random() * 2.5));
    spawnParticle(state.padParticles, {
      position: spawnPos,
      velocity,
      lifeSec: 2.8 + (Math.random() * 1.1),
      startScale,
      endScale,
      opacity: 0.20 + (throttle * 0.16),
      drift: 0.85 + (Math.random() * 0.25),
    });
  }
}

export function createLaunchAtmosphereEffects(THREE, {
  stage0BodyHeightScene,
  stage2BodyHeightScene = null,
}) {
  const root = new THREE.Group();
  root.visible = false;
  root.renderOrder = 21;

  const trailGroup = new THREE.Group();
  const padGroup = new THREE.Group();
  root.add(trailGroup);
  root.add(padGroup);

  const trailGeometry = new THREE.IcosahedronGeometry(1, 1);
  const padGeometry = new THREE.IcosahedronGeometry(1, 1);

  return {
    THREE,
    root,
    trailGroup,
    padGroup,
    stage0BodyHeightScene: Math.max(1e-9, Number(stage0BodyHeightScene) || 1e-9),
    stage2BodyHeightScene: Math.max(1e-9, Number(stage2BodyHeightScene) || Number(stage0BodyHeightScene) || 1e-9),
    trailParticles: makeParticlePool(THREE, trailGroup, {
      geometry: trailGeometry,
      count: 36,
      color: 0xd8d3cd,
      renderOrder: 22,
    }),
    padParticles: makeParticlePool(THREE, padGroup, {
      geometry: padGeometry,
      count: 28,
      color: 0xded7ce,
      renderOrder: 21,
    }),
    lastUpdateMs: null,
    trailAccumulator: 0,
    padAccumulator: 0,
    lastStageIndex: 0,
  };
}

export function applyLaunchAtmosphereEffects(state, snapshot = null, options = {}) {
  if (!state?.root || !state.THREE) {
    return;
  }
  const nowMs = Number(options.nowMs) || Date.now();
  const sceneParent = options.sceneParent || null;
  if (sceneParent && state.root.parent !== sceneParent) {
    sceneParent.add(state.root);
  }
  const previousUpdateMs = Number(state.lastUpdateMs);
  const dtSec = Number.isFinite(previousUpdateMs)
    ? clamp((nowMs - previousUpdateMs) / 1000, 0, 0.2)
    : (1 / 60);
  state.lastUpdateMs = nowMs;

  const atmosphereMotion = {
    earthWorldPosition: options.earthWorldPosition || null,
    earthAngularVelocityScene: options.earthAngularVelocityScene || null,
  };
  const trailActiveCount = updateParticlePool(state.trailParticles, dtSec, nowMs / 1000, atmosphereMotion);
  const padActiveCount = updateParticlePool(state.padParticles, dtSec, nowMs / 1000, atmosphereMotion);

  const visible = options.bodyVisible !== false;
  const bodyWorldPosition = options.bodyWorldPosition;
  const upDirectionScene = options.upDirectionScene;
  const renderRadiusScene = Math.max(1e-9, Number(options.renderRadiusScene) || 1e-9);
  if (
    !visible
    || !snapshot
    || !sceneParent
    || !bodyWorldPosition
    || !upDirectionScene
    || upDirectionScene.lengthSq() <= 1e-12
  ) {
    state.root.visible = (trailActiveCount + padActiveCount) > 0;
    return;
  }

  state.lastStageIndex = Number(snapshot?.stageIndex) || 0;
  const phase = String(snapshot?.phase || "").toLowerCase();
  const thrustN = Math.max(0, Number(snapshot?.thrustN) || 0);
  const throttle = clamp(Number(snapshot?.throttle) || 0, 0, 1);
  const powered = phase === "powered" && thrustN > 0.01 && throttle > 0.01;
  const altitudeKmRaw = Number.isFinite(Number(snapshot?.altitudeAboveTerrainKm))
    ? Number(snapshot.altitudeAboveTerrainKm)
    : Number(snapshot?.altitudeKm);
  const altitudeKm = Math.max(0, Number.isFinite(altitudeKmRaw) ? altitudeKmRaw : 0);
  const denseAtmosphereTrail = powered && altitudeKm <= 20;
  const nearPadCloud = powered && Number(snapshot?.stageIndex) <= 0 && altitudeKm <= 3.2;

  if (denseAtmosphereTrail) {
    spawnTrailPuffs(state, {
      bodyWorldPosition,
      bodyAtmosphereVelocityScene: options.bodyAtmosphereVelocityScene || null,
      upDirectionScene,
      renderRadiusScene,
      throttle,
      altitudeKm,
      dtSec,
    });
  }
  if (nearPadCloud) {
    spawnPadCloudPuffs(state, {
      bodyWorldPosition,
      upDirectionScene,
      renderRadiusScene,
      throttle,
      dtSec,
    });
  }

  state.root.visible = true;
}
