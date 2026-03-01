import {
  LAUNCH_BODY_ID,
  LAUNCH_EXHAUST_VISUAL_CONFIG,
  STARSHIP_STACK_DIMENSIONS_KM,
} from "./launchConfig.js";

const MAX_TRAIL_POINTS = 12000;
const TRAIL_CORE_COLOR = 0x59cbff;
const MIN_TRACK_POINT_SPACING_KM = 0.25;
const MAX_TELEPORT_STEP_KM = 600;
const EARTH_BODY_ID = "earth";
const VELOCITY_DIR_MIN_KM_S = 0.01;
const VECTOR_EPS = 1e-10;

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
  let lastPointKm = null;
  const trailPointsKm = [];
  let trailFrame = "inertial";

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
    return Math.max(
      LAUNCH_EXHAUST_VISUAL_CONFIG.trailPointSpacingKm,
      MIN_TRACK_POINT_SPACING_KM,
    );
  }

  function stageTailOffsetKm(stageIndex) {
    if (Number.isFinite(stageIndex) && stageIndex >= 1) {
      return STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm * 0.5;
    }
    return STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm * 0.5;
  }

  function subtract(a, b) {
    return {
      x: (Number(a?.x) || 0) - (Number(b?.x) || 0),
      y: (Number(a?.y) || 0) - (Number(b?.y) || 0),
      z: (Number(a?.z) || 0) - (Number(b?.z) || 0),
    };
  }

  function add(a, b) {
    return {
      x: (Number(a?.x) || 0) + (Number(b?.x) || 0),
      y: (Number(a?.y) || 0) + (Number(b?.y) || 0),
      z: (Number(a?.z) || 0) + (Number(b?.z) || 0),
    };
  }

  function scale(v, s) {
    return {
      x: (Number(v?.x) || 0) * s,
      y: (Number(v?.y) || 0) * s,
      z: (Number(v?.z) || 0) * s,
    };
  }

  function magnitude(v) {
    const x = Number(v?.x) || 0;
    const y = Number(v?.y) || 0;
    const z = Number(v?.z) || 0;
    return Math.sqrt((x * x) + (y * y) + (z * z));
  }

  function normalize(v) {
    const mag = magnitude(v);
    if (!(mag > VECTOR_EPS)) {
      return null;
    }
    return {
      x: (Number(v?.x) || 0) / mag,
      y: (Number(v?.y) || 0) / mag,
      z: (Number(v?.z) || 0) / mag,
    };
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

  function earthRootScenePosition() {
    const earthVisual = getBodyVisual?.(EARTH_BODY_ID);
    const pos = earthVisual?.root?.position;
    if (!pos) {
      return null;
    }
    return pos;
  }

  function updateTrailFrameAnchor(frame) {
    if (frame === "earth-relative") {
      const earthPos = earthRootScenePosition();
      if (earthPos) {
        group.position.copy(earthPos);
        return;
      }
      const earthCoordsKm = getCoordinatesKmById?.(EARTH_BODY_ID) || null;
      const earthScene = toSceneVector(earthCoordsKm);
      if (earthScene) {
        group.position.copy(earthScene);
        return;
      }
    }
    group.position.set(0, 0, 0);
  }

  function resolveTrackPoint(snapshot) {
    const launchCoordsKm = getCoordinatesKmById?.(launchBodyId) || null;
    if (!launchCoordsKm) {
      return null;
    }
    const launchVelKmS = getVelocityKmSById?.(launchBodyId) || null;
    const earthCoordsKm = getCoordinatesKmById?.(EARTH_BODY_ID) || null;
    const earthVelKmS = getVelocityKmSById?.(EARTH_BODY_ID) || null;
    const stageIndex = Number(snapshot?.stageIndex);
    const tailOffsetKm = stageTailOffsetKm(stageIndex);

    let direction = null;
    if (launchVelKmS) {
      const relativeVelKmS = earthVelKmS ? subtract(launchVelKmS, earthVelKmS) : launchVelKmS;
      if (magnitude(relativeVelKmS) >= VELOCITY_DIR_MIN_KM_S) {
        direction = normalize(relativeVelKmS);
      }
    }
    if (!direction && earthCoordsKm) {
      direction = normalize(subtract(launchCoordsKm, earthCoordsKm));
    }
    if (!direction) {
      direction = { x: 0, y: 0, z: 1 };
    }

    const tailPointAbsKm = add(launchCoordsKm, scale(direction, -tailOffsetKm));
    if (earthCoordsKm) {
      return {
        frame: "earth-relative",
        pointKm: subtract(tailPointAbsKm, earthCoordsKm),
      };
    }
    return {
      frame: "inertial",
      pointKm: tailPointAbsKm,
    };
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
    trailFrame = "inertial";
    updateTrailFrameAnchor(trailFrame);
    rebuildGeometry();
  }

  function appendPoint(pointKm, minDistanceKm) {
    if (!pointKm) {
      return;
    }
    const spacing = Math.max(minDistanceKm || 0, 1e-12);
    const distanceSq = lastPointKm ? kmDistanceSquared(lastPointKm, pointKm) : 0;
    if (lastPointKm && distanceSq > (MAX_TELEPORT_STEP_KM * MAX_TELEPORT_STEP_KM)) {
      clear();
    }
    if (!lastPointKm || distanceSq >= (spacing * spacing)) {
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

    const snapshot = getLaunchSnapshot?.() || null;
    const trackPoint = resolveTrackPoint(snapshot);
    if (!trackPoint?.pointKm) {
      updateTrailFrameAnchor(trailFrame);
      return;
    }
    if (trackPoint.frame !== trailFrame && trailPointsKm.length > 0) {
      clear();
    }
    trailFrame = trackPoint.frame;
    updateTrailFrameAnchor(trailFrame);

    const phase = snapshot?.phase || "idle";
    const active = phase === "powered" || phase === "coast";
    const justReset = phase === "idle" && wasActive;

    if (justReset) {
      clear();
    }

    const spacingKm = trailSpacingKm();

    if (active || phase === "complete") {
      appendPoint(trackPoint.pointKm, spacingKm);
    } else if (trailPointsKm.length === 0) {
      appendPoint(trackPoint.pointKm, spacingKm);
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
