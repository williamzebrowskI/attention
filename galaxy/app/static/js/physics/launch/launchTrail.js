import {
  LAUNCH_BODY_ID,
  LAUNCH_EXHAUST_VISUAL_CONFIG,
  STARSHIP_STACK_DIMENSIONS_KM,
  STARSHIP_STACK_TOTAL_HEIGHT_KM,
} from "./launchConfig.js";

const MAX_TRAIL_POINTS = 1600;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + ((b - a) * clamp(t, 0, 1));
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
    size: 1e-10,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.08,
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

  const fullStackHalfHeightScene = STARSHIP_STACK_TOTAL_HEIGHT_KM * 0.5 * distanceScale;
  const shipOnlyHalfHeightScene = STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm * 0.5 * distanceScale;

  function launchVisualScaleMetrics() {
    const visual = getBodyVisual?.(launchBodyId);
    const vehicleRadiusKm = Math.max(Number(visual?.body?.radius_km) || 0, 0.0045);
    const vehicleRadiusScene = Math.max(vehicleRadiusKm * distanceScale, 1e-12);
    const trailPointSpacingScene = Math.max(
      LAUNCH_EXHAUST_VISUAL_CONFIG.trailPointSpacingKm * distanceScale,
      vehicleRadiusScene * 1.2,
    );
    const smokePointSizeScene = Math.max(
      vehicleRadiusScene * LAUNCH_EXHAUST_VISUAL_CONFIG.smokePointRadiusScaleToVehicleRadius,
      1e-12,
    );
    return {
      vehicleRadiusKm,
      vehicleRadiusScene,
      trailPointSpacingScene,
      smokePointSizeScene,
    };
  }

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

  function appendPoint(scenePos, minDistanceScene) {
    if (!scenePos) {
      return;
    }
    const spacing = Math.max(minDistanceScene || 0, 1e-12);
    if (!lastPoint || lastPoint.distanceToSquared(scenePos) >= (spacing * spacing)) {
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

    const {
      vehicleRadiusScene,
    } = launchVisualScaleMetrics();
    const stageIndex = Number.isFinite(Number(snapshot?.stageIndex)) ? Number(snapshot.stageIndex) : 0;
    const vehicleHalfHeightScene = stageIndex >= 1 ? shipOnlyHalfHeightScene : fullStackHalfHeightScene;
    const vacuumBlend = clamp((altitudeKm - 5) / 80, 0, 1);
    const basePlumeLengthScene = lerp(
      LAUNCH_EXHAUST_VISUAL_CONFIG.plumeSeaLevelLengthKm * distanceScale,
      LAUNCH_EXHAUST_VISUAL_CONFIG.plumeVacuumLengthKm * distanceScale,
      vacuumBlend,
    );
    const plumeLength = basePlumeLengthScene * (0.35 + (0.65 * throttle));
    const plumeRadius = vehicleRadiusScene
      * lerp(
        LAUNCH_EXHAUST_VISUAL_CONFIG.plumeSeaLevelRadiusScaleToVehicleRadius,
        LAUNCH_EXHAUST_VISUAL_CONFIG.plumeVacuumRadiusScaleToVehicleRadius,
        vacuumBlend,
      )
      * (0.7 + (0.3 * throttle));

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
    plumeMesh.position
      .copy(scenePos)
      .add(exhaustDirection.clone().multiplyScalar(vehicleHalfHeightScene + (plumeLength * 0.5)));
    plumeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), exhaustDirection);
    plumeMesh.material.opacity = 0.18 + (0.22 * throttle);
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

    const {
      smokePointSizeScene,
      trailPointSpacingScene,
    } = launchVisualScaleMetrics();

    if (active || phase === "complete") {
      appendPoint(scenePos, trailPointSpacingScene);
    } else if (trailPoints.length === 0) {
      appendPoint(scenePos, trailPointSpacingScene);
    }

    const smokeActive = active && thrustN > 0.01 && altitudeKm <= LAUNCH_EXHAUST_VISUAL_CONFIG.smokeMaxAltitudeKm;
    if (smokeActive) {
      const densityFade = clamp(1 - (altitudeKm / LAUNCH_EXHAUST_VISUAL_CONFIG.smokeMaxAltitudeKm), 0.04, 1);
      pointMaterial.size = smokePointSizeScene * (0.9 + (0.35 * throttle));
      pointMaterial.opacity = 0.03 + (0.09 * throttle * densityFade);
      pathMaterial.opacity = 0.04 + (0.12 * densityFade);
    } else {
      pointMaterial.size = smokePointSizeScene;
      pointMaterial.opacity = 0.02;
      pathMaterial.opacity = 0.03;
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
