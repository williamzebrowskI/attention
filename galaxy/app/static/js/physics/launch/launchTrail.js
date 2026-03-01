import {
  LAUNCH_BODY_ID,
  LAUNCH_EXHAUST_VISUAL_CONFIG,
} from "./launchConfig.js";

const MAX_TRAIL_POINTS = 8000;
const TRAIL_CORE_COLOR = 0x59cbff;
const TRAIL_REFERENCE_BODY_ID = "earth";
const MIN_TRACK_POINT_SPACING_KM = 0.5;

function toSceneVector(THREE, coordsKm, distanceScale) {
  return new THREE.Vector3(
    Number(coordsKm.x) * distanceScale,
    Number(coordsKm.z) * distanceScale,
    Number(coordsKm.y) * distanceScale,
  );
}

function subtractCoordsKm(a, b) {
  return {
    x: (Number(a?.x) || 0) - (Number(b?.x) || 0),
    y: (Number(a?.y) || 0) - (Number(b?.y) || 0),
    z: (Number(a?.z) || 0) - (Number(b?.z) || 0),
  };
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
    color: new THREE.Color(TRAIL_CORE_COLOR),
    transparent: false,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
  });
  const pathLine = new THREE.Line(pathGeometry, pathMaterial);
  pathLine.frustumCulled = false;
  group.add(pathLine);

  function launchVisualScaleMetrics() {
    const visual = getBodyVisual?.(launchBodyId);
    const vehicleRadiusKm = Math.max(Number(visual?.body?.radius_km) || 0, 0.0045);
    const vehicleRadiusScene = Math.max(vehicleRadiusKm * distanceScale, 1e-12);
    const trailPointSpacingScene = Math.max(
      LAUNCH_EXHAUST_VISUAL_CONFIG.trailPointSpacingKm * distanceScale,
      vehicleRadiusScene * 1.2,
      MIN_TRACK_POINT_SPACING_KM * distanceScale,
    );
    return {
      vehicleRadiusKm,
      vehicleRadiusScene,
      trailPointSpacingScene,
    };
  }

  function rebuildGeometry() {
    if (trailPoints.length === 0) {
      pathGeometry.setFromPoints([]);
      return;
    }
    pathGeometry.setFromPoints(trailPoints);
    pathGeometry.computeBoundingSphere();
  }

  function clear() {
    trailPoints.length = 0;
    lastPoint = null;
    cachedScenePos = null;
    group.position.set(0, 0, 0);
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

  function update(_deltaSeconds = 0) {
    group.visible = enabled;

    const snapshot = getLaunchSnapshot?.() || null;
    const coordsKm = getCoordinatesKmById?.(launchBodyId);
    if (!coordsKm) {
      return;
    }
    const referenceCoordsKm = getCoordinatesKmById?.(TRAIL_REFERENCE_BODY_ID) || null;
    const velocityKmS = getVelocityKmSById?.(launchBodyId) || null;
    let scenePos = null;
    if (
      Number.isFinite(Number(referenceCoordsKm?.x))
      && Number.isFinite(Number(referenceCoordsKm?.y))
      && Number.isFinite(Number(referenceCoordsKm?.z))
    ) {
      group.position.copy(toSceneVector(THREE, referenceCoordsKm, distanceScale));
      const relCoordsKm = subtractCoordsKm(coordsKm, referenceCoordsKm);
      scenePos = toSceneVector(THREE, relCoordsKm, distanceScale);
    } else {
      group.position.set(0, 0, 0);
      scenePos = toSceneVector(THREE, coordsKm, distanceScale);
    }

    const visual = getBodyVisual?.(launchBodyId);
    const visualPosition = visual?.root?.position;
    if (
      visualPosition
      && Number.isFinite(Number(visualPosition.x))
      && Number.isFinite(Number(visualPosition.y))
      && Number.isFinite(Number(visualPosition.z))
    ) {
      scenePos = visualPosition.clone().sub(group.position);
    }

    cachedScenePos = scenePos.clone();

    const phase = snapshot?.phase || "idle";
    const active = phase === "powered" || phase === "coast";
    const justReset = phase === "idle" && wasActive;

    if (justReset) {
      clear();
    }

    const { trailPointSpacingScene } = launchVisualScaleMetrics();

    if (active || phase === "complete") {
      appendPoint(scenePos, trailPointSpacingScene);
    } else if (trailPoints.length === 0) {
      appendPoint(scenePos, trailPointSpacingScene);
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
    pathMaterial.dispose();
  }

  return {
    update,
    clear,
    setEnabled,
    dispose,
  };
}
