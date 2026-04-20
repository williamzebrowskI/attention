export function createLaunchAtmosphereEffects(THREE, {
  stage0BodyHeightScene,
  stage2BodyHeightScene = null,
} = {}) {
  const root = new THREE.Group();
  root.visible = false;
  root.renderOrder = 21;
  return {
    THREE,
    root,
    disabled: true,
    stage0BodyHeightScene: Math.max(1e-9, Number(stage0BodyHeightScene) || 1e-9),
    stage2BodyHeightScene: Math.max(1e-9, Number(stage2BodyHeightScene) || Number(stage0BodyHeightScene) || 1e-9),
    trailParticles: [],
    padParticles: [],
    trailGroup: null,
    padGroup: null,
    lastUpdateMs: null,
  };
}

export function applyLaunchAtmosphereEffects(state, snapshot = null, options = {}) {
  void snapshot;
  if (!state?.root) {
    return;
  }
  const sceneParent = options.sceneParent || null;
  if (sceneParent && state.root.parent !== sceneParent) {
    sceneParent.add(state.root);
  }
  state.lastUpdateMs = Number(options.nowMs) || Date.now();
  state.root.visible = false;
}
