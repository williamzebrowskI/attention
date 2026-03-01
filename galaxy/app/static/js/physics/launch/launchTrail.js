import {
  LAUNCH_BODY_ID,
  LAUNCH_EXHAUST_VISUAL_CONFIG,
  STARSHIP_STACK_DIMENSIONS_KM,
} from "./launchConfig.js";

const MAX_TRAIL_POINTS = 12000;
const TRAIL_CORE_COLOR = 0x59cbff;
const MIN_TRACK_POINT_SPACING_KM = 0.1;
const AXIS_EPS = 1e-12;

export function createLaunchTrailController(options) {
  const {
    THREE,
    scene,
    getLaunchSnapshot,
    getCoordinatesKmById,
    getBodyVisual,
    distanceScale = 1,
    launchBodyId = LAUNCH_BODY_ID,
  } = options || {};

  let enabled = true;
  let wasActive = false;
  let lastPointKm = null;
  const trailPointsKm = [];

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

  function trailSpacingKm() {
    const visual = getBodyVisual?.(launchBodyId);
    const vehicleDiameterKm = Math.max((Number(visual?.body?.radius_km) || 0.0045) * 2, 0.009);
    return Math.max(
      LAUNCH_EXHAUST_VISUAL_CONFIG.trailPointSpacingKm,
      vehicleDiameterKm * 2.4,
      MIN_TRACK_POINT_SPACING_KM,
    );
  }

  function toSceneVector(coordsKm) {
    if (!coordsKm) {
      return null;
    }
    return new THREE.Vector3(
      Number(coordsKm.x || 0) * distanceScale,
      Number(coordsKm.z || 0) * distanceScale,
      Number(coordsKm.y || 0) * distanceScale,
    );
  }

  function toKmVector(sceneVec) {
    if (!sceneVec || !(distanceScale > 0)) {
      return null;
    }
    return {
      x: Number(sceneVec.x || 0) / distanceScale,
      y: Number(sceneVec.z || 0) / distanceScale,
      z: Number(sceneVec.y || 0) / distanceScale,
    };
  }

  function kmDistanceSquared(a, b) {
    const dx = (Number(a?.x) || 0) - (Number(b?.x) || 0);
    const dy = (Number(a?.y) || 0) - (Number(b?.y) || 0);
    const dz = (Number(a?.z) || 0) - (Number(b?.z) || 0);
    return (dx * dx) + (dy * dy) + (dz * dz);
  }

  function stageHalfHeightKm(stageIndex) {
    if (Number.isFinite(stageIndex) && stageIndex >= 1) {
      return STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm * 0.5;
    }
    return STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm * 0.5;
  }

  function resolveActiveAnchorScene(snapshot, visual) {
    const stageIndex = Number(snapshot?.stageIndex);
    const stageState = visual?.launchStackState || null;
    const stageAnchor =
      Number.isFinite(stageIndex) && stageIndex >= 1
        ? (stageState?.shipGroup || visual?.root)
        : (stageState?.boosterGroup || visual?.root);

    if (!stageAnchor) {
      return null;
    }
    const anchor = new THREE.Vector3();
    if (typeof stageAnchor.getWorldPosition === "function") {
      stageAnchor.getWorldPosition(anchor);
    } else if (stageAnchor.position) {
      anchor.copy(stageAnchor.position);
    } else {
      return null;
    }

    const tiltGroup = visual?.tiltGroup || null;
    if (tiltGroup && typeof tiltGroup.getWorldQuaternion === "function") {
      const orientation = new THREE.Quaternion();
      tiltGroup.getWorldQuaternion(orientation);
      const upAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);
      if (upAxis.lengthSq() > AXIS_EPS) {
        const tailOffsetScene = stageHalfHeightKm(stageIndex) * distanceScale;
        anchor.addScaledVector(upAxis.normalize(), -tailOffsetScene);
      }
    }
    return anchor;
  }

  function rebuildGeometry() {
    if (trailPointsKm.length === 0) {
      pathGeometry.setFromPoints([]);
      return;
    }
    const trailPointsScene = trailPointsKm
      .map((coordsKm) => toSceneVector(coordsKm))
      .filter(Boolean);
    pathGeometry.setFromPoints(trailPointsScene);
    pathGeometry.computeBoundingSphere();
  }

  function clear() {
    trailPointsKm.length = 0;
    lastPointKm = null;
    group.position.set(0, 0, 0);
    rebuildGeometry();
  }

  function appendPoint(pointKm, minDistanceKm) {
    if (!pointKm) {
      return;
    }
    const spacing = Math.max(minDistanceKm || 0, 1e-12);
    if (!lastPointKm || kmDistanceSquared(lastPointKm, pointKm) >= (spacing * spacing)) {
      trailPointsKm.push({
        x: Number(pointKm.x) || 0,
        y: Number(pointKm.y) || 0,
        z: Number(pointKm.z) || 0,
      });
      if (trailPointsKm.length > MAX_TRAIL_POINTS) {
        trailPointsKm.shift();
      }
      lastPointKm = {
        x: Number(pointKm.x) || 0,
        y: Number(pointKm.y) || 0,
        z: Number(pointKm.z) || 0,
      };
      rebuildGeometry();
    }
  }

  function update(_deltaSeconds = 0) {
    group.visible = enabled;
    group.position.set(0, 0, 0);

    const snapshot = getLaunchSnapshot?.() || null;
    const visual = getBodyVisual?.(launchBodyId);
    const launchCoordsKm = getCoordinatesKmById?.(launchBodyId) || null;
    const anchorScene = resolveActiveAnchorScene(snapshot, visual);
    const anchorKm = toKmVector(anchorScene);
    const coordsKm = anchorKm || launchCoordsKm || toKmVector(visual?.root?.position);
    if (!coordsKm) {
      return;
    }

    const phase = snapshot?.phase || "idle";
    const active = phase === "powered" || phase === "coast";
    const justReset = phase === "idle" && wasActive;

    if (justReset) {
      clear();
    }

    const spacingKm = trailSpacingKm();

    if (active || phase === "complete") {
      appendPoint(coordsKm, spacingKm);
    } else if (trailPointsKm.length === 0) {
      appendPoint(coordsKm, spacingKm);
    }

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
