import {
  LAUNCH_BODY_ID,
  LAUNCH_EXHAUST_VISUAL_CONFIG,
} from "./launchConfig.js";

const MAX_TRAIL_POINTS = 520;
const TRAIL_CORE_COLOR = 0x59cbff;
const TRAIL_GLOW_COLOR = 0x2e8cff;
const TRAIL_SMOKE_COLOR = 0xb4d4ff;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
  const trailPointAgesSec = [];

  const group = new THREE.Group();
  group.renderOrder = 62;
  scene.add(group);

  const pathGeometry = new THREE.BufferGeometry();
  const pathMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(TRAIL_CORE_COLOR),
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const pathLine = new THREE.Line(pathGeometry, pathMaterial);
  pathLine.frustumCulled = false;
  group.add(pathLine);

  const glowGeometry = new THREE.BufferGeometry();
  const glowMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(TRAIL_GLOW_COLOR),
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const glowLine = new THREE.Line(glowGeometry, glowMaterial);
  glowLine.frustumCulled = false;
  group.add(glowLine);

  const pointGeometry = new THREE.BufferGeometry();
  const pointMaterial = new THREE.PointsMaterial({
    map: createSmokeTexture(THREE),
    color: new THREE.Color(TRAIL_SMOKE_COLOR),
    size: 1e-10,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    alphaTest: 0.02,
    toneMapped: false,
  });
  const smokePoints = new THREE.Points(pointGeometry, pointMaterial);
  smokePoints.frustumCulled = false;
  group.add(smokePoints);

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
      glowGeometry.setFromPoints([]);
      pointGeometry.setFromPoints([]);
      return;
    }
    pathGeometry.setFromPoints(trailPoints);
    glowGeometry.setFromPoints(trailPoints);
    pointGeometry.setFromPoints(trailPoints);
    pathGeometry.computeBoundingSphere();
    glowGeometry.computeBoundingSphere();
    pointGeometry.computeBoundingSphere();
  }

  function clear() {
    trailPoints.length = 0;
    trailPointAgesSec.length = 0;
    lastPoint = null;
    cachedScenePos = null;
    rebuildGeometry();
  }

  function appendPoint(scenePos, minDistanceScene) {
    if (!scenePos) {
      return;
    }
    const spacing = Math.max(minDistanceScene || 0, 1e-12);
    if (!lastPoint || lastPoint.distanceToSquared(scenePos) >= (spacing * spacing)) {
      trailPoints.push(scenePos.clone());
      trailPointAgesSec.push(0);
      if (trailPoints.length > MAX_TRAIL_POINTS) {
        trailPoints.shift();
        trailPointAgesSec.shift();
      }
      lastPoint = scenePos.clone();
      rebuildGeometry();
    }
  }

  function ageAndCullTrail(deltaSeconds) {
    if (!(deltaSeconds > 0) || trailPointAgesSec.length === 0) {
      return;
    }
    const maxAgeSec = Math.max(8, Number(LAUNCH_EXHAUST_VISUAL_CONFIG.smokeTrailPersistSeconds) || 42);
    for (let i = 0; i < trailPointAgesSec.length; i += 1) {
      trailPointAgesSec[i] += deltaSeconds;
    }
    let removeCount = 0;
    while (removeCount < trailPointAgesSec.length && trailPointAgesSec[removeCount] > maxAgeSec) {
      removeCount += 1;
    }
    if (removeCount > 0) {
      trailPoints.splice(0, removeCount);
      trailPointAgesSec.splice(0, removeCount);
      lastPoint = trailPoints.length > 0 ? trailPoints[trailPoints.length - 1].clone() : null;
      rebuildGeometry();
    }
  }

  function update(deltaSeconds = 0) {
    group.visible = enabled;
    ageAndCullTrail(Math.max(0, Number(deltaSeconds) || 0));

    const snapshot = getLaunchSnapshot?.() || null;
    const coordsKm = getCoordinatesKmById?.(launchBodyId);
    if (!coordsKm) {
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

    if (!enabled) {
      void velocityKmS;
      wasActive = active;
      return;
    }

    const smokeActive = active && thrustN > 0.01 && altitudeKm <= LAUNCH_EXHAUST_VISUAL_CONFIG.smokeMaxAltitudeKm;
    if (smokeActive) {
      const densityFade = clamp(1 - (altitudeKm / LAUNCH_EXHAUST_VISUAL_CONFIG.smokeMaxAltitudeKm), 0.04, 1);
      pointMaterial.size = smokePointSizeScene * (0.95 + (0.38 * throttle));
      pointMaterial.opacity = 0.022 + (0.054 * throttle * densityFade);
      pathMaterial.opacity = 0.22 + (0.28 * densityFade);
      glowMaterial.opacity = 0.16 + (0.22 * densityFade);
    } else {
      pointMaterial.size = smokePointSizeScene;
      pointMaterial.opacity = trailPoints.length > 0 ? 0.016 : 0;
      pathMaterial.opacity = trailPoints.length > 0 ? 0.18 : 0;
      glowMaterial.opacity = trailPoints.length > 0 ? 0.14 : 0;
    }

    void velocityKmS;
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
    glowGeometry.dispose();
    pointGeometry.dispose();
    pathMaterial.dispose();
    glowMaterial.dispose();
    pointMaterial.map?.dispose?.();
    pointMaterial.dispose();
  }

  return {
    update,
    clear,
    setEnabled,
    dispose,
  };
}
