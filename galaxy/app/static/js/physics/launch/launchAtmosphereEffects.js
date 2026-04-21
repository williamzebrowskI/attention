import { computeBoosterEntryThermalState } from "./launchThermalModel.js?v=20260421a";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function setMaterialOpacity(material, opacity) {
  if (!material) {
    return;
  }
  material.opacity = clamp(Number(opacity) || 0, 0, 1);
  material.visible = material.opacity > 1e-4;
}

function hideAtmosphereEffects(state) {
  if (!state?.root) {
    return;
  }
  state.root.visible = false;
  setMaterialOpacity(state.glowMaterial, 0);
  setMaterialOpacity(state.shockMaterial, 0);
  setMaterialOpacity(state.wakeMaterial, 0);
  setMaterialOpacity(state.wakeGlowMaterial, 0);
}

function resolveWakeDirection(THREE, options = {}) {
  const atmosphereVelocity = options.bodyAtmosphereVelocityScene;
  if (atmosphereVelocity?.isVector3 && atmosphereVelocity.lengthSq() > 1e-18) {
    return atmosphereVelocity.clone().normalize().multiplyScalar(-1);
  }
  const upDirection = options.upDirectionScene;
  if (upDirection?.isVector3 && upDirection.lengthSq() > 1e-18) {
    return upDirection.clone().normalize();
  }
  return new THREE.Vector3(0, 1, 0);
}

function orientEffectRoot(THREE, root, wakeDirection) {
  if (!root || !wakeDirection) {
    return;
  }
  const yAxis = new THREE.Vector3(0, 1, 0);
  const direction = wakeDirection.clone().normalize();
  if (!(direction.lengthSq() > 1e-18)) {
    root.quaternion.identity();
    return;
  }
  root.quaternion.setFromUnitVectors(yAxis, direction);
}

function resolveBoosterThermalState(snapshot = null) {
  if (!snapshot) {
    return null;
  }
  const stageIndex = Number(snapshot.stageIndex);
  if (Number.isFinite(stageIndex) && stageIndex > 0) {
    return null;
  }
  return computeBoosterEntryThermalState({
    phase: snapshot.phase,
    altitudeKm: snapshot.altitudeKm,
    altitudeAboveTerrainKm: snapshot.altitudeAboveTerrainKm,
    dynamicPressurePa: snapshot.dynamicPressurePa,
    airRelativeSpeedKmS: snapshot.airRelativeSpeedKmS,
    earthRelativeSpeedKmS: snapshot.earthRelativeSpeedKmS ?? snapshot.speedKmS,
    radialSpeedKmS: snapshot.radialSpeedKmS,
    throttle: snapshot.throttle,
  });
}

export function createLaunchAtmosphereEffects(THREE, {
  stage0BodyHeightScene,
  stage2BodyHeightScene = null,
} = {}) {
  const root = new THREE.Group();
  root.visible = false;
  root.renderOrder = 21;

  const glowMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xff8a33),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), glowMaterial);
  glow.renderOrder = 21;
  root.add(glow);

  const shockMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xfff1cf),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
  const shock = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), shockMaterial);
  shock.renderOrder = 22;
  root.add(shock);

  const wakeMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xff8d43),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const wake = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 22, 1, true), wakeMaterial);
  wake.renderOrder = 20;
  root.add(wake);

  const wakeGlowMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffb16a),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
  const wakeGlow = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), wakeGlowMaterial);
  wakeGlow.renderOrder = 20;
  root.add(wakeGlow);

  return {
    THREE,
    root,
    disabled: false,
    stage0BodyHeightScene: Math.max(1e-9, Number(stage0BodyHeightScene) || 1e-9),
    stage2BodyHeightScene: Math.max(1e-9, Number(stage2BodyHeightScene) || Number(stage0BodyHeightScene) || 1e-9),
    glow,
    glowMaterial,
    shock,
    shockMaterial,
    wake,
    wakeMaterial,
    wakeGlow,
    wakeGlowMaterial,
    colors: {
      glowLow: new THREE.Color(0xff7d28),
      glowHigh: new THREE.Color(0xfff0c9),
      shockLow: new THREE.Color(0xffbb73),
      shockHigh: new THREE.Color(0xffffff),
      wakeLow: new THREE.Color(0xff7e34),
      wakeHigh: new THREE.Color(0xffd39a),
    },
    lastUpdateMs: null,
  };
}

export function applyLaunchAtmosphereEffects(state, snapshot = null, options = {}) {
  if (!state?.root) {
    return;
  }
  const sceneParent = options.sceneParent || null;
  if (sceneParent && state.root.parent !== sceneParent) {
    sceneParent.add(state.root);
  }
  state.lastUpdateMs = Number(options.nowMs) || Date.now();

  if (!options.bodyVisible || !options.bodyWorldPosition || state.disabled) {
    hideAtmosphereEffects(state);
    return;
  }

  const thermalState = resolveBoosterThermalState(snapshot);
  if (!thermalState?.active) {
    hideAtmosphereEffects(state);
    return;
  }

  state.root.visible = true;
  state.root.position.copy(options.bodyWorldPosition);
  orientEffectRoot(state.THREE, state.root, resolveWakeDirection(state.THREE, options));

  const stageIndex = Number(snapshot?.stageIndex);
  const bodyHeightScene = Number.isFinite(stageIndex) && stageIndex >= 1
    ? state.stage2BodyHeightScene
    : state.stage0BodyHeightScene;
  const renderRadiusScene = Math.max(
    finiteNumberOrNull(options.renderRadiusScene) || 0,
    bodyHeightScene * 0.16,
  );
  const glowRadius = renderRadiusScene * (0.92 + (thermalState.glowLevel * 1.85));
  const shockRadius = renderRadiusScene * (0.9 + (thermalState.plasmaLevel * 1.35));
  const wakeLength = bodyHeightScene * (1.2 + (thermalState.wakeLevel * 7.4));
  const wakeRadius = renderRadiusScene * (0.52 + (thermalState.wakeLevel * 1.15));
  const wakeGlowRadius = renderRadiusScene * (0.86 + (thermalState.wakeLevel * 1.4));

  state.glow.scale.set(glowRadius * 1.08, glowRadius * 1.04, glowRadius * 1.08);
  state.shock.scale.set(
    shockRadius * 1.02,
    shockRadius * (0.66 + (0.16 * thermalState.speedBlend)),
    shockRadius * 1.02,
  );
  state.shock.position.set(0, -(bodyHeightScene * 0.12), 0);

  state.wake.scale.set(wakeRadius, wakeLength, wakeRadius);
  state.wake.position.set(0, (wakeLength * 0.5) + (bodyHeightScene * 0.1), 0);
  state.wakeGlow.scale.set(wakeGlowRadius, wakeGlowRadius * 0.72, wakeGlowRadius);
  state.wakeGlow.position.set(0, bodyHeightScene * (0.38 + (thermalState.wakeLevel * 0.9)), 0);

  state.glowMaterial.color.lerpColors(state.colors.glowLow, state.colors.glowHigh, thermalState.glowLevel);
  state.shockMaterial.color.lerpColors(state.colors.shockLow, state.colors.shockHigh, thermalState.plasmaLevel);
  state.wakeMaterial.color.lerpColors(state.colors.wakeLow, state.colors.wakeHigh, thermalState.wakeLevel);
  state.wakeGlowMaterial.color.lerpColors(state.colors.wakeLow, state.colors.glowHigh, thermalState.wakeLevel);

  setMaterialOpacity(
    state.glowMaterial,
    clamp((0.12 + (thermalState.glowLevel * 0.48)) * (0.7 + (0.3 * thermalState.qBlend)), 0, 0.7),
  );
  setMaterialOpacity(
    state.shockMaterial,
    clamp((0.08 + (thermalState.plasmaLevel * 0.62)) * (0.68 + (0.32 * thermalState.speedBlend)), 0, 0.82),
  );
  setMaterialOpacity(
    state.wakeMaterial,
    clamp((0.05 + (thermalState.wakeLevel * 0.34)) * (0.74 + (0.26 * thermalState.descentBlend)), 0, 0.48),
  );
  setMaterialOpacity(
    state.wakeGlowMaterial,
    clamp((0.04 + (thermalState.wakeLevel * 0.22)) * (0.7 + (0.3 * thermalState.qBlend)), 0, 0.34),
  );
}
