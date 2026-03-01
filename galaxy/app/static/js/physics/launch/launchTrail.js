import {
  LAUNCH_BODY_ID,
  LAUNCH_EXHAUST_VISUAL_CONFIG,
  STARSHIP_STACK_DIMENSIONS_KM,
  STARSHIP_STACK_TOTAL_HEIGHT_KM,
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

function vectorLength(v) {
  return Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z));
}

function stageTailOffsetKm(snapshot) {
  const stageIndex = Number(snapshot?.stageIndex);
  const fullStackHalfKm = STARSHIP_STACK_TOTAL_HEIGHT_KM * 0.5;
  const shipHalfKm = STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm * 0.5;
  return (Number.isFinite(stageIndex) && stageIndex >= 1 ? shipHalfKm : fullStackHalfKm) * 0.96;
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
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
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
    const referenceVelocityKmS = getVelocityKmSById?.(TRAIL_REFERENCE_BODY_ID) || null;
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

    const relVelocityKmS = referenceVelocityKmS
      ? subtractCoordsKm(velocityKmS, referenceVelocityKmS)
      : {
          x: Number(velocityKmS?.x) || 0,
          y: Number(velocityKmS?.y) || 0,
          z: Number(velocityKmS?.z) || 0,
        };
    const relSpeedKmS = vectorLength(relVelocityKmS);
    const velocityScene = toSceneVector(THREE, relVelocityKmS, 1);
    let tailDirection = null;
    if (relSpeedKmS > 1e-9 && velocityScene.lengthSq() > 1e-12) {
      tailDirection = velocityScene.normalize().multiplyScalar(-1);
    } else if (scenePos.lengthSq() > 1e-12) {
      // Fallback near liftoff while speed is near zero: tail points toward the planet center.
      tailDirection = scenePos.clone().normalize().multiplyScalar(-1);
    }
    if (tailDirection) {
      const tailOffsetScene = stageTailOffsetKm(snapshot) * distanceScale;
      scenePos.addScaledVector(tailDirection, tailOffsetScene);
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
