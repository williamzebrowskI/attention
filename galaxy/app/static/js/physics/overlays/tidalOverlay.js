export function createTidalOverlayController(options) {
  const {
    THREE,
    scene,
    targets = [],
    clamp = defaultClamp,
    getBodyVisual,
    getBodyMassKg,
    getBodyRadiusKm,
    getCoordinatesKm,
    gravitationalConstantKm3PerKgS2,
    minBodyRadiusScene = 0.000001,
    vectorColor = 0xff5f8d,
    shellColor = 0xff8cae,
    baselineMS2 = 1.0e-6,
    maxLength = 0.14,
  } = options || {};

  let enabled = false;
  let visualsByBodyId = new Map();

  function rebuild() {
    if (!THREE || !scene) {
      return;
    }
    clear();
    for (const config of targets) {
      const bodyId = config?.bodyId;
      if (!bodyId) {
        continue;
      }
      const visual = createTidalOverlayVisual(bodyId);
      if (!visual) {
        continue;
      }
      visualsByBodyId.set(bodyId, visual);
      scene.add(visual.group);
    }
    update();
  }

  function clear() {
    for (const visual of visualsByBodyId.values()) {
      scene?.remove?.(visual.group);
      disposeObject3DResources(visual.group);
    }
    visualsByBodyId = new Map();
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    if (!enabled) {
      for (const visual of visualsByBodyId.values()) {
        visual.group.visible = false;
      }
    }
  }

  function update() {
    if (!THREE) {
      return;
    }
    for (const config of targets) {
      const bodyId = config?.bodyId;
      if (!bodyId) {
        continue;
      }
      const overlay = visualsByBodyId.get(bodyId);
      if (!overlay) {
        continue;
      }
      if (!enabled) {
        overlay.group.visible = false;
        continue;
      }

      const bodyVisual = getBodyVisual?.(bodyId);
      if (!bodyVisual || !bodyVisual.root?.visible) {
        overlay.group.visible = false;
        continue;
      }

      const tidal = computeTidalAxisForBody(bodyId, config.sourceIds || []);
      if (!tidal || !(tidal.magnitudeMS2 > 0)) {
        overlay.group.visible = false;
        continue;
      }

      const bodyRadius = Math.max(Number(bodyVisual.renderRadius) || 0, minBodyRadiusScene);
      const direction = new THREE.Vector3(tidal.axisKmS2.x, tidal.axisKmS2.z, tidal.axisKmS2.y);
      const axisMagnitude = direction.length();
      if (!(axisMagnitude > 1e-18)) {
        overlay.group.visible = false;
        continue;
      }

      direction.divideScalar(axisMagnitude);
      overlay.group.visible = true;
      overlay.group.position.copy(bodyVisual.root.position);

      const opposite = direction.clone().multiplyScalar(-1);
      const arrowLength = tidalArrowLengthForAccelerationMS2(tidal.magnitudeMS2, bodyRadius);
      const arrowHeadLength = clamp(arrowLength * 0.3, 0.004, 0.032);
      const arrowHeadWidth = clamp(arrowLength * 0.16, 0.003, 0.024);

      overlay.nearArrow.position.copy(direction).multiplyScalar(bodyRadius * 1.07);
      overlay.nearArrow.setDirection(direction);
      overlay.nearArrow.setLength(arrowLength, arrowHeadLength, arrowHeadWidth);
      overlay.nearArrow.visible = true;

      overlay.farArrow.position.copy(opposite).multiplyScalar(bodyRadius * 1.07);
      overlay.farArrow.setDirection(opposite);
      overlay.farArrow.setLength(arrowLength, arrowHeadLength, arrowHeadWidth);
      overlay.farArrow.visible = true;

      overlay.shell.scale.setScalar(bodyRadius * 1.22);
      const shellHeat = clamp(Math.sqrt(tidal.magnitudeMS2 / baselineMS2), 0, 1);
      if (overlay.shell.material) {
        overlay.shell.material.opacity = 0.04 + (0.22 * shellHeat);
      }
      overlay.shell.visible = true;
    }
  }

  function createTidalOverlayVisual(bodyId) {
    const bodyVisual = getBodyVisual?.(bodyId);
    if (!bodyVisual) {
      return null;
    }

    const baseRadius = Math.max(Number(bodyVisual.renderRadius) || 0, minBodyRadiusScene);
    const nearArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 0),
      Math.max(baseRadius * 3.2, 0.01),
      vectorColor,
      0.01,
      0.005,
    );
    const farArrow = new THREE.ArrowHelper(
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 0),
      Math.max(baseRadius * 3.2, 0.01),
      vectorColor,
      0.01,
      0.005,
    );
    nearArrow.renderOrder = 82;
    farArrow.renderOrder = 82;

    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 40),
      new THREE.MeshBasicMaterial({
        color: shellColor,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    shell.renderOrder = 81;

    const group = new THREE.Group();
    group.visible = false;
    group.add(shell);
    group.add(nearArrow);
    group.add(farArrow);

    return {
      bodyId,
      group,
      nearArrow,
      farArrow,
      shell,
    };
  }

  function computeTidalAxisForBody(targetBodyId, sourceIds) {
    const targetCoords = getCoordinatesKm?.(targetBodyId);
    const targetRadiusKm = Number(getBodyRadiusKm?.(targetBodyId)) || 0;
    if (!targetCoords || !(targetRadiusKm > 0)) {
      return null;
    }

    let axisX = 0;
    let axisY = 0;
    let axisZ = 0;
    for (const sourceId of sourceIds || []) {
      if (!sourceId || sourceId === targetBodyId) {
        continue;
      }
      const sourceMassKg = Number(getBodyMassKg?.(sourceId));
      const sourceCoords = getCoordinatesKm?.(sourceId);
      if (!(sourceMassKg > 0) || !sourceCoords) {
        continue;
      }

      const dx = sourceCoords.x - targetCoords.x;
      const dy = sourceCoords.y - targetCoords.y;
      const dz = sourceCoords.z - targetCoords.z;
      const distanceKm = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
      if (!(distanceKm > targetRadiusKm * 1.001)) {
        continue;
      }

      const ux = dx / distanceKm;
      const uy = dy / distanceKm;
      const uz = dz / distanceKm;
      const nearDistanceKm = Math.max(distanceKm - targetRadiusKm, 1e-7);
      const farDistanceKm = distanceKm + targetRadiusKm;
      const nearAccelKmS2 = (gravitationalConstantKm3PerKgS2 * sourceMassKg) / (nearDistanceKm * nearDistanceKm);
      const farAccelKmS2 = (gravitationalConstantKm3PerKgS2 * sourceMassKg) / (farDistanceKm * farDistanceKm);
      const differentialKmS2 = Math.max(nearAccelKmS2 - farAccelKmS2, 0) * 0.5;

      axisX += ux * differentialKmS2;
      axisY += uy * differentialKmS2;
      axisZ += uz * differentialKmS2;
    }

    const magnitudeKmS2 = Math.sqrt((axisX * axisX) + (axisY * axisY) + (axisZ * axisZ));
    return {
      axisKmS2: { x: axisX, y: axisY, z: axisZ },
      magnitudeKmS2,
      magnitudeMS2: magnitudeKmS2 * 1000,
    };
  }

  function tidalArrowLengthForAccelerationMS2(accelerationMS2, bodyRadius) {
    const safeRadius = Math.max(bodyRadius, minBodyRadiusScene);
    if (!(accelerationMS2 > 0)) {
      return clamp(safeRadius * 2.4, safeRadius * 1.2, maxLength);
    }
    const normalized = Math.sqrt(Math.max(accelerationMS2 / baselineMS2, 0));
    const scaled = safeRadius * (2.1 + (normalized * 3.8));
    return clamp(scaled, safeRadius * 1.3, maxLength);
  }

  return {
    rebuild,
    clear,
    update,
    setEnabled,
  };
}

function disposeObject3DResources(root) {
  if (!root) {
    return;
  }
  root.traverse((node) => {
    if (node.geometry) {
      node.geometry.dispose();
    }
    if (Array.isArray(node.material)) {
      node.material.forEach((material) => material?.dispose?.());
    } else if (node.material) {
      node.material.dispose();
    }
  });
}

function defaultClamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
