function defaultClamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createRefuelTransferVisualController(options = {}) {
  const getThree = typeof options.getThree === "function" ? options.getThree : (() => null);
  const getScene = typeof options.getScene === "function" ? options.getScene : (() => null);
  const getLaunchFeatureEnabled = typeof options.getLaunchFeatureEnabled === "function"
    ? options.getLaunchFeatureEnabled
    : (() => false);
  const getLaunchController = typeof options.getLaunchController === "function"
    ? options.getLaunchController
    : (() => null);
  const getNBodyState = typeof options.getNBodyState === "function"
    ? options.getNBodyState
    : (() => null);
  const getBodyVisuals = typeof options.getBodyVisuals === "function"
    ? options.getBodyVisuals
    : (() => null);
  const getLaunchBodyId = typeof options.getLaunchBodyId === "function"
    ? options.getLaunchBodyId
    : (() => "earth_launch_vehicle");
  const clampValue = typeof options.clampValue === "function"
    ? options.clampValue
    : defaultClamp;

  let refuelTransferVisual = null;

  function ensureRefuelTransferVisual() {
    const THREE_NS = getThree();
    const scene = getScene();
    if (!THREE_NS || !scene) {
      return null;
    }
    if (refuelTransferVisual?.group) {
      return refuelTransferVisual;
    }

    const group = new THREE_NS.Group();
    group.visible = false;
    group.renderOrder = 70;

    const beamGeometry = new THREE_NS.BufferGeometry();
    beamGeometry.setAttribute(
      "position",
      new THREE_NS.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
    );
    const beamMaterial = new THREE_NS.LineBasicMaterial({
      color: 0x4acbff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE_NS.AdditiveBlending,
    });
    const beam = new THREE_NS.Line(beamGeometry, beamMaterial);
    beam.renderOrder = 70;
    group.add(beam);

    const beaconGeometry = new THREE_NS.SphereGeometry(0.00016, 12, 12);
    const beaconMaterialA = new THREE_NS.MeshBasicMaterial({
      color: 0x5ed6ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE_NS.AdditiveBlending,
    });
    const beaconMaterialB = beaconMaterialA.clone();
    const beaconA = new THREE_NS.Mesh(beaconGeometry, beaconMaterialA);
    const beaconB = new THREE_NS.Mesh(beaconGeometry.clone(), beaconMaterialB);
    beaconA.renderOrder = 71;
    beaconB.renderOrder = 71;
    group.add(beaconA);
    group.add(beaconB);

    scene.add(group);
    refuelTransferVisual = {
      group,
      beam,
      beamMaterial,
      beaconA,
      beaconB,
    };
    return refuelTransferVisual;
  }

  function hideRefuelTransferVisual() {
    if (!refuelTransferVisual?.group) {
      return;
    }
    refuelTransferVisual.group.visible = false;
  }

  function updateRefuelTransferVisual() {
    const launchFeatureEnabled = getLaunchFeatureEnabled();
    const launchController = getLaunchController();
    const nBodyState = getNBodyState();
    if (!launchFeatureEnabled || !launchController || !nBodyState?.initialized) {
      hideRefuelTransferVisual();
      return;
    }
    const visual = ensureRefuelTransferVisual();
    if (!visual) {
      return;
    }
    const snapshot = launchController.statusSnapshot?.(nBodyState) || null;
    if (!snapshot) {
      hideRefuelTransferVisual();
      return;
    }
    const transferActive = Boolean(snapshot.refuelTransferActive);
    const tankerId = String(snapshot.refuelTransferTankerId || "").trim();
    if (!transferActive || !tankerId) {
      hideRefuelTransferVisual();
      return;
    }

    const bodyVisuals = getBodyVisuals();
    const launchBodyId = String(getLaunchBodyId() || "");
    const shipVisual = bodyVisuals?.get?.(launchBodyId);
    const tankerVisual = bodyVisuals?.get?.(tankerId);
    if (!shipVisual?.root || !tankerVisual?.root || !shipVisual.root.visible || !tankerVisual.root.visible) {
      hideRefuelTransferVisual();
      return;
    }

    const a = shipVisual.root.position;
    const b = tankerVisual.root.position;
    const distanceScene = a.distanceTo(b);
    const pulse = 0.74 + (0.26 * Math.sin((Date.now() / 1000) * 8.2));
    const progress = clampValue(Number(snapshot.refuelTransferProgress) || 0, 0, 1);
    const opacity = clampValue((0.24 + (0.34 * pulse)) * (0.76 + (0.24 * (1 - progress))), 0.12, 0.88);

    const beamPositions = visual.beam.geometry.getAttribute("position");
    beamPositions.setXYZ(0, a.x, a.y, a.z);
    beamPositions.setXYZ(1, b.x, b.y, b.z);
    beamPositions.needsUpdate = true;
    visual.beamMaterial.opacity = opacity;

    const beaconScale = clampValue(1 + (0.42 * pulse), 1, 1.5);
    visual.beaconA.position.copy(a);
    visual.beaconB.position.copy(b);
    visual.beaconA.scale.setScalar(beaconScale);
    visual.beaconB.scale.setScalar(beaconScale);
    if (visual.beaconA.material && !Array.isArray(visual.beaconA.material)) {
      visual.beaconA.material.opacity = clampValue(0.28 + (0.42 * pulse), 0.2, 0.86);
    }
    if (visual.beaconB.material && !Array.isArray(visual.beaconB.material)) {
      visual.beaconB.material.opacity = clampValue(0.28 + (0.42 * pulse), 0.2, 0.86);
    }

    visual.group.visible = distanceScene > 1e-12;
  }

  return {
    ensureRefuelTransferVisual,
    hideRefuelTransferVisual,
    updateRefuelTransferVisual,
  };
}
