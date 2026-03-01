function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finitePoint(point) {
  return Boolean(
    point
    && Number.isFinite(Number(point.x))
    && Number.isFinite(Number(point.y))
    && Number.isFinite(Number(point.z))
  );
}

export function createLaunchTrajectoryPathController(THREE, scene, options = {}) {
  if (!THREE || !scene) {
    return null;
  }
  const maxPoints = clamp(Math.floor(Number(options.maxPoints) || 120_000), 256, 400_000);
  const minPointDistanceScene = Math.max(1e-12, Number(options.minPointDistanceScene) || 1e-6);
  const colorHex = Number(options.colorHex) || 0x36c9ff;
  const opacity = clamp(Number(options.opacity) || 0.9, 0.05, 1);

  const positions = new Float32Array(maxPoints * 3);
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3);
  geometry.setAttribute("position", attribute);
  geometry.setDrawRange(0, 0);

  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color(colorHex),
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const line = new THREE.Line(geometry, material);
  line.name = "launch_trajectory_path";
  line.frustumCulled = false;
  line.visible = false;
  line.renderOrder = 18;
  scene.add(line);

  let pointCount = 0;
  let lastPoint = null;

  function setEnabled(enabled) {
    line.visible = Boolean(enabled);
  }

  function reset() {
    pointCount = 0;
    lastPoint = null;
    geometry.setDrawRange(0, 0);
    attribute.needsUpdate = true;
  }

  function appendPoint(point) {
    if (!finitePoint(point)) {
      return false;
    }
    const next = {
      x: Number(point.x) || 0,
      y: Number(point.y) || 0,
      z: Number(point.z) || 0,
    };
    if (lastPoint) {
      const dx = next.x - lastPoint.x;
      const dy = next.y - lastPoint.y;
      const dz = next.z - lastPoint.z;
      const dist = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
      if (!(dist >= minPointDistanceScene)) {
        return false;
      }
    }
    if (pointCount >= maxPoints) {
      // Keep the newest segment if the path exceeds capacity.
      positions.copyWithin(0, 3, pointCount * 3);
      pointCount = maxPoints - 1;
    }
    const base = pointCount * 3;
    positions[base] = next.x;
    positions[base + 1] = next.y;
    positions[base + 2] = next.z;
    pointCount += 1;
    lastPoint = next;
    geometry.setDrawRange(0, pointCount);
    attribute.needsUpdate = true;
    if ((pointCount % 64) === 0) {
      geometry.computeBoundingSphere();
    }
    return true;
  }

  function dispose() {
    try {
      scene.remove(line);
    } catch (error) {
      // no-op
    }
    geometry.dispose();
    material.dispose();
  }

  return {
    line,
    setEnabled,
    reset,
    appendPoint,
    dispose,
    pointCount: () => pointCount,
  };
}
