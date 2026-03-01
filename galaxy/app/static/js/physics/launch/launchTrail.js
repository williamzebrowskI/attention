import { LAUNCH_BODY_ID } from "./launchConfig.js";

const MAX_TRAIL_POINTS = 2200;
const APPEND_MIN_DISTANCE_SCENE = 0.00002;
const TRAIL_POINT_SIZE_PX = 22;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function vectorLength(v) {
  return Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z));
}

function toSceneVector(THREE, coordsKm, distanceScale) {
  return new THREE.Vector3(
    Number(coordsKm.x) * distanceScale,
    Number(coordsKm.z) * distanceScale,
    Number(coordsKm.y) * distanceScale,
  );
}

function createSmokeTexture(THREE) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.08, size * 0.5, size * 0.5, size * 0.5);
  gradient.addColorStop(0, "rgba(238, 242, 248, 0.96)");
  gradient.addColorStop(0.24, "rgba(214, 220, 230, 0.88)");
  gradient.addColorStop(0.62, "rgba(165, 174, 187, 0.46)");
  gradient.addColorStop(1, "rgba(122, 132, 144, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createPlumeMaterial(THREE) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffd8ad),
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

export function createLaunchTrailController(options) {
  const {
    THREE,
    scene,
    getLaunchSnapshot,
    getCoordinatesKmById,
    getVelocityKmSById,
    getBodyVisual,
    distanceScale = 1,
    launchBodyId = LAUNCH_BODY_ID,
  } = options || {};

  let enabled = true;
  let wasActive = false;
  let lastPoint = null;
  let cachedScenePos = null;
  const trailPoints = [];

  const group = new THREE.Group();
  group.renderOrder = 62;
  scene.add(group);

  const pathGeometry = new THREE.BufferGeometry();
  const pathMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(0x8d96a3),
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    toneMapped: false,
  });
  const pathLine = new THREE.Line(pathGeometry, pathMaterial);
  pathLine.frustumCulled = false;
  group.add(pathLine);

  const pointGeometry = new THREE.BufferGeometry();
  const pointMaterial = new THREE.PointsMaterial({
    map: createSmokeTexture(THREE),
    color: new THREE.Color(0xb9c2cc),
    size: TRAIL_POINT_SIZE_PX,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    blending: THREE.NormalBlending,
    alphaTest: 0.02,
    toneMapped: false,
  });
  const smokePoints = new THREE.Points(pointGeometry, pointMaterial);
  smokePoints.frustumCulled = false;
  group.add(smokePoints);

  const plumeGeometry = new THREE.ConeGeometry(1, 1, 16, 1, true);
  const plumeMaterial = createPlumeMaterial(THREE);
  const plumeMesh = new THREE.Mesh(plumeGeometry, plumeMaterial);
  plumeMesh.visible = false;
  plumeMesh.renderOrder = 68;
  group.add(plumeMesh);

  function rebuildGeometry() {
    if (trailPoints.length === 0) {
      pathGeometry.setFromPoints([]);
      pointGeometry.setFromPoints([]);
      return;
    }
    pathGeometry.setFromPoints(trailPoints);
    pointGeometry.setFromPoints(trailPoints);
    pathGeometry.computeBoundingSphere();
    pointGeometry.computeBoundingSphere();
  }

  function clear() {
    trailPoints.length = 0;
    lastPoint = null;
    cachedScenePos = null;
    plumeMesh.visible = false;
    rebuildGeometry();
  }

  function appendPoint(scenePos) {
    if (!scenePos) {
      return;
    }
    if (!lastPoint || lastPoint.distanceToSquared(scenePos) >= (APPEND_MIN_DISTANCE_SCENE * APPEND_MIN_DISTANCE_SCENE)) {
      trailPoints.push(scenePos.clone());
      if (trailPoints.length > MAX_TRAIL_POINTS) {
        trailPoints.shift();
      }
      lastPoint = scenePos.clone();
      rebuildGeometry();
    }
  }

  function updatePlume(snapshot, scenePos, velocityKmS) {
    const throttle = clamp(Number(snapshot?.throttle) || 0, 0, 1);
    const thrustN = Math.max(0, Number(snapshot?.thrustN) || 0);
    const altitudeKm = Number(snapshot?.altitudeKm) || 0;
    const powered = snapshot?.phase === "powered" && throttle > 0.01 && thrustN > 0;
    if (!powered || altitudeKm > 140 || !scenePos) {
      plumeMesh.visible = false;
      return;
    }

    const rocketRadius = Math.max(Number(getBodyVisual?.(launchBodyId)?.renderRadius) || 0.00002, 0.00002);
    const plumeLength = rocketRadius * (5.0 + (8.0 * throttle));
    const plumeRadius = rocketRadius * (0.7 + (0.3 * throttle));

    let dirScene = null;
    if (velocityKmS) {
      const speed = vectorLength(velocityKmS);
      if (speed > 1e-10) {
        dirScene = new THREE.Vector3(
          Number(velocityKmS.x) / speed,
          Number(velocityKmS.z) / speed,
          Number(velocityKmS.y) / speed,
        );
      }
    }
    if (!dirScene) {
      dirScene = cachedScenePos?.clone()?.normalize() || new THREE.Vector3(0, 1, 0);
    }
    const exhaustDirection = dirScene.clone().multiplyScalar(-1).normalize();
    plumeMesh.visible = true;
    plumeMesh.scale.set(plumeRadius, plumeLength, plumeRadius);
    plumeMesh.position.copy(scenePos).add(exhaustDirection.clone().multiplyScalar(rocketRadius + (plumeLength * 0.28)));
    plumeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), exhaustDirection);
    plumeMesh.material.opacity = 0.26 + (0.48 * throttle);
  }

  function update(deltaSeconds = 0) {
    if (!enabled) {
      group.visible = false;
      return;
    }
    group.visible = true;

    const snapshot = getLaunchSnapshot?.() || null;
    const coordsKm = getCoordinatesKmById?.(launchBodyId);
    if (!coordsKm) {
      plumeMesh.visible = false;
      return;
    }
    const velocityKmS = getVelocityKmSById?.(launchBodyId) || null;
    const scenePos = toSceneVector(THREE, coordsKm, distanceScale);
    cachedScenePos = scenePos.clone();

    const phase = snapshot?.phase || "idle";
    const active = phase === "powered" || phase === "coast";
    const justReset = phase === "idle" && wasActive;

    if (justReset) {
      clear();
    }

    const thrustN = Math.max(0, Number(snapshot?.thrustN) || 0);
    const throttle = clamp(Number(snapshot?.throttle) || 0, 0, 1);
    const altitudeKm = Number(snapshot?.altitudeKm) || 0;

    if (active || phase === "complete") {
      appendPoint(scenePos);
    } else if (trailPoints.length === 0) {
      appendPoint(scenePos);
    }

    const smokeActive = active && thrustN > 0.01 && altitudeKm <= 90;
    if (smokeActive) {
      const densityFade = clamp(1 - (altitudeKm / 90), 0.05, 1);
      pointMaterial.opacity = 0.2 + (0.38 * throttle * densityFade);
      pathMaterial.opacity = 0.2 + (0.34 * densityFade);
    } else {
      pointMaterial.opacity = 0.18;
      pathMaterial.opacity = 0.2;
    }

    updatePlume(snapshot, scenePos, velocityKmS);
    wasActive = active;
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    if (!enabled) {
      group.visible = false;
    }
  }

  function dispose() {
    clear();
    if (group.parent) {
      group.parent.remove(group);
    }
    pathGeometry.dispose();
    pointGeometry.dispose();
    plumeGeometry.dispose();
    pathMaterial.dispose();
    pointMaterial.map?.dispose?.();
    pointMaterial.dispose();
    plumeMaterial.dispose();
  }

  return {
    update,
    clear,
    setEnabled,
    dispose,
  };
}
