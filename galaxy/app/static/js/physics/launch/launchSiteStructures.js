import {
  LAUNCH_SITE,
  STARSHIP_STACK_DIMENSIONS_KM,
} from "./launchConfig.js";
import { surfacePointRelativeKmAtLatLon } from "../surface/earthSurfacePhysics.js";

const LAUNCH_STRUCTURE_PROFILE_KM = Object.freeze({
  mountRadiusKm: 0.016,
  mountHeightKm: 0.012,
  holdClampHeightKm: 0.008,
  holdClampOffsetKm: 0.0085,
  towerHeightKm: 0.146,
  towerWidthKm: 0.014,
  towerDepthKm: 0.014,
  towerOffsetKm: 0.018,
  chopstickCatchHeightKm:
    STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm
    - (STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 0.55),
  chopstickArmMinLengthKm: 0.009,
  chopstickArmMaxLengthKm: 0.021,
  chopstickArmThicknessKm: 0.0022,
  chopstickArmSpacingKm: 0.010,
  quickDisconnectHeightKm:
    STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm
    + (STARSHIP_STACK_DIMENSIONS_KM.shipCylinderHeightKm * 0.72),
  quickDisconnectMinLengthKm: 0.005,
  quickDisconnectMaxLengthKm: 0.013,
  quickDisconnectThicknessKm: 0.0013,
  armRatePerSec: 1.4,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rad(value) {
  return (Number(value) || 0) * (Math.PI / 180);
}

function approach(current, target, maxDelta) {
  if (!Number.isFinite(current)) return target;
  if (!Number.isFinite(target)) return current;
  if (!(maxDelta > 0)) return target;
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return current;
}

function latLonToBodyFixedUnitVector(THREE, latitudeDeg, longitudeDeg) {
  const latRad = rad(clamp(latitudeDeg, -90, 90));
  const lonRad = rad(longitudeDeg);
  const cosLat = Math.cos(latRad);
  return new THREE.Vector3(
    cosLat * Math.cos(lonRad),
    cosLat * Math.sin(lonRad),
    Math.sin(latRad),
  ).normalize();
}

function eastNorthUpBasisBodyFixed(THREE, latitudeDeg, longitudeDeg) {
  const latRad = rad(clamp(latitudeDeg, -90, 90));
  const lonRad = rad(longitudeDeg);
  const up = latLonToBodyFixedUnitVector(THREE, latitudeDeg, longitudeDeg);
  const east = new THREE.Vector3(
    -Math.sin(lonRad),
    Math.cos(lonRad),
    0,
  ).normalize();
  const north = new THREE.Vector3(
    -Math.sin(latRad) * Math.cos(lonRad),
    -Math.sin(latRad) * Math.sin(lonRad),
    Math.cos(latRad),
  ).normalize();
  return { east, north, up };
}

function sceneVectorFromKm(THREE, vectorKm) {
  return new THREE.Vector3(
    Number(vectorKm?.x) || 0,
    Number(vectorKm?.z) || 0,
    Number(vectorKm?.y) || 0,
  );
}

function transformBodyFixedVectorToWorld(THREE, bodyFixedVector, earthAxes) {
  return new THREE.Vector3(
    ((Number(earthAxes?.xAxis?.x) || 0) * (Number(bodyFixedVector?.x) || 0))
      + ((Number(earthAxes?.yAxis?.x) || 0) * (Number(bodyFixedVector?.y) || 0))
      + ((Number(earthAxes?.pole?.x) || 0) * (Number(bodyFixedVector?.z) || 0)),
    ((Number(earthAxes?.xAxis?.y) || 0) * (Number(bodyFixedVector?.x) || 0))
      + ((Number(earthAxes?.yAxis?.y) || 0) * (Number(bodyFixedVector?.y) || 0))
      + ((Number(earthAxes?.pole?.y) || 0) * (Number(bodyFixedVector?.z) || 0)),
    ((Number(earthAxes?.xAxis?.z) || 0) * (Number(bodyFixedVector?.x) || 0))
      + ((Number(earthAxes?.yAxis?.z) || 0) * (Number(bodyFixedVector?.y) || 0))
      + ((Number(earthAxes?.pole?.z) || 0) * (Number(bodyFixedVector?.z) || 0)),
  );
}

function makeAnchoredBeam(THREE, length, thickness, depth, material) {
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(1, thickness, depth),
    material,
  );
  beam.scale.x = Math.max(length, 1e-9);
  beam.position.x = -0.5 * Math.max(length, 1e-9);
  return beam;
}

function setAnchoredBeamLength(mesh, length) {
  if (!mesh) return;
  const clamped = Math.max(1e-9, Number(length) || 0);
  mesh.scale.x = clamped;
  mesh.position.x = -0.5 * clamped;
}

export function resolveLaunchStructureArmTarget(input = {}) {
  const stackPresent = Boolean(input.stackPresent);
  const launchPhase = String(input.launchPhase || "").trim().toLowerCase();
  const boosterPhase = String(input.boosterPhase || "").trim().toLowerCase();
  const altitudeKm = Number(input.altitudeKm);
  const boosterLanded = Boolean(input.boosterLanded);
  const lowAltitude = Number.isFinite(altitudeKm) && altitudeKm < 0.75;

  if (boosterLanded || boosterPhase.includes("caught")) {
    return 0.08;
  }
  if (boosterPhase.includes("catch")) {
    return 0.18;
  }
  if (boosterPhase.includes("landing")) {
    return 0.26;
  }
  if (stackPresent || launchPhase === "idle" || (launchPhase === "powered" && lowAltitude)) {
    return 0.24;
  }
  if (boosterPhase && boosterPhase !== "idle") {
    return 0.92;
  }
  if (launchPhase && launchPhase !== "idle" && !lowAltitude) {
    return 1.0;
  }
  return 0.72;
}

function resolveQuickDisconnectTarget(input = {}) {
  const stackPresent = Boolean(input.stackPresent);
  const launchPhase = String(input.launchPhase || "").trim().toLowerCase();
  const altitudeKm = Number(input.altitudeKm);
  const lowAltitude = Number.isFinite(altitudeKm) && altitudeKm < 0.35;
  if (stackPresent || launchPhase === "idle" || (launchPhase === "powered" && lowAltitude)) {
    return 0.12;
  }
  if (launchPhase && launchPhase !== "idle") {
    return 1.0;
  }
  return 0.6;
}

export function createLaunchSiteStructureVisual(THREE, distanceScale) {
  const ds = Math.max(Number(distanceScale) || 0, 1e-9);
  const radius = STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 0.5 * ds;
  const profile = Object.fromEntries(
    Object.entries(LAUNCH_STRUCTURE_PROFILE_KM).map(([key, value]) => (
      key === "armRatePerSec"
        ? [key, value]
        : [key, value * ds]
    )),
  );

  const root = new THREE.Group();
  const structureGroup = new THREE.Group();
  root.add(structureGroup);

  const stainless = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xaeb7c2),
    roughness: 0.52,
    metalness: 0.72,
  });
  const darkSteel = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x273140),
    roughness: 0.66,
    metalness: 0.52,
  });
  const orangeSteel = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xd8a05a),
    roughness: 0.58,
    metalness: 0.34,
  });

  const mountDeck = new THREE.Mesh(
    new THREE.CylinderGeometry(profile.mountRadiusKm, profile.mountRadiusKm, profile.mountHeightKm, 24, 1, false),
    darkSteel,
  );
  mountDeck.position.y = 0.5 * profile.mountHeightKm;
  structureGroup.add(mountDeck);

  const clampCount = 4;
  for (let i = 0; i < clampCount; i += 1) {
    const angle = (i / clampCount) * Math.PI * 2;
    const clampMesh = new THREE.Mesh(
      new THREE.BoxGeometry(profile.holdClampHeightKm, profile.holdClampHeightKm, profile.holdClampHeightKm * 1.8),
      stainless,
    );
    clampMesh.position.set(
      Math.cos(angle) * profile.holdClampOffsetKm,
      profile.mountHeightKm + (0.5 * profile.holdClampHeightKm),
      Math.sin(angle) * profile.holdClampOffsetKm,
    );
    clampMesh.rotation.y = angle;
    structureGroup.add(clampMesh);
  }

  const towerGroup = new THREE.Group();
  towerGroup.position.set(
    radius + profile.towerOffsetKm + (0.5 * profile.towerWidthKm),
    0.5 * profile.towerHeightKm,
    0,
  );
  structureGroup.add(towerGroup);

  const columnOffsets = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [-0.5, 0.5],
    [0.5, 0.5],
  ];
  for (const [xSign, zSign] of columnOffsets) {
    const column = new THREE.Mesh(
      new THREE.BoxGeometry(profile.towerWidthKm * 0.12, profile.towerHeightKm, profile.towerDepthKm * 0.12),
      darkSteel,
    );
    column.position.set(
      xSign * profile.towerWidthKm * 0.45,
      0,
      zSign * profile.towerDepthKm * 0.45,
    );
    towerGroup.add(column);
  }

  for (let i = 0; i < 8; i += 1) {
    const brace = new THREE.Mesh(
      new THREE.BoxGeometry(profile.towerWidthKm * 0.92, profile.towerHeightKm * 0.02, profile.towerDepthKm * 0.08),
      stainless,
    );
    brace.position.set(0, (-0.5 * profile.towerHeightKm) + (profile.towerHeightKm * (i / 7)), 0);
    towerGroup.add(brace);
  }

  const chopstickPivotX = towerGroup.position.x - (0.5 * profile.towerWidthKm);
  const chopstickY = profile.chopstickCatchHeightKm;
  const chopstickArmDepth = profile.chopstickArmThicknessKm * 2.6;
  const armZOffsets = [
    -0.5 * profile.chopstickArmSpacingKm,
    0.5 * profile.chopstickArmSpacingKm,
  ];
  const chopstickBeams = [];
  for (const zOffset of armZOffsets) {
    const armBeam = makeAnchoredBeam(
      THREE,
      profile.chopstickArmMaxLengthKm,
      profile.chopstickArmThicknessKm,
      chopstickArmDepth,
      orangeSteel,
    );
    armBeam.position.set(chopstickPivotX, chopstickY, zOffset);
    structureGroup.add(armBeam);
    chopstickBeams.push(armBeam);
  }

  const qdBeam = makeAnchoredBeam(
    THREE,
    profile.quickDisconnectMaxLengthKm,
    profile.quickDisconnectThicknessKm,
    profile.quickDisconnectThicknessKm * 1.8,
    stainless,
  );
  qdBeam.position.set(
    chopstickPivotX + (profile.towerWidthKm * 0.18),
    profile.quickDisconnectHeightKm,
    0,
  );
  structureGroup.add(qdBeam);

  root.userData.launchStructureSource = "inline_launch_tower_chopsticks";

  return {
    root,
    materials: [stainless, darkSteel, orangeSteel],
    state: {
      armOpen: 0.24,
      quickDisconnectOpen: 0.12,
      profile,
      chopstickBeams,
      quickDisconnectBeam: qdBeam,
    },
  };
}

export function updateLaunchSiteStructureVisual(launchStructureVisual, options = {}) {
  const root = launchStructureVisual?.root;
  const state = launchStructureVisual?.state;
  const THREE = options?.THREE;
  const scene = options?.scene;
  const earthPositionKm = options?.earthPositionKm;
  const earthAxes = options?.earthAxes;
  if (!root || !state || !THREE || !scene || !earthPositionKm || !earthAxes) {
    if (root) {
      root.visible = false;
    }
    return;
  }

  if (root.parent !== scene) {
    scene.add(root);
  }

  const launchSite = options?.launchSite || LAUNCH_SITE;
  const latitudeDeg = Number(launchSite?.latitudeDeg) || 0;
  const longitudeDeg = Number(launchSite?.longitudeDeg) || 0;
  const altitudeKm = Math.max(0, Number(launchSite?.altitudeKm) || 0);
  const dtSeconds = Math.max(0, Number(options?.dtSeconds) || 0);

  const { east, north, up } = eastNorthUpBasisBodyFixed(THREE, latitudeDeg, longitudeDeg);
  const eastWorld = transformBodyFixedVectorToWorld(THREE, east, earthAxes);
  const northWorld = transformBodyFixedVectorToWorld(THREE, north, earthAxes);
  const upWorld = transformBodyFixedVectorToWorld(THREE, up, earthAxes);
  const padSurface = surfacePointRelativeKmAtLatLon(latitudeDeg, longitudeDeg, earthAxes, { includeTerrain: false });
  const padRelativeKm = padSurface?.pointRelativeKm || {
    x: Number(upWorld.x) || 0,
    y: Number(upWorld.y) || 0,
    z: Number(upWorld.z) || 0,
  };
  const padNormalKm = padSurface?.surfaceNormal || {
    x: Number(upWorld.x) || 0,
    y: Number(upWorld.y) || 0,
    z: Number(upWorld.z) || 0,
  };
  const rootWorldKm = {
    x: (Number(earthPositionKm.x) || 0) + (Number(padRelativeKm.x) || 0) + ((Number(padNormalKm.x) || 0) * altitudeKm),
    y: (Number(earthPositionKm.y) || 0) + (Number(padRelativeKm.y) || 0) + ((Number(padNormalKm.y) || 0) * altitudeKm),
    z: (Number(earthPositionKm.z) || 0) + (Number(padRelativeKm.z) || 0) + ((Number(padNormalKm.z) || 0) * altitudeKm),
  };
  const distanceScale = Number(options?.distanceScale) || 1;
  root.position.copy(sceneVectorFromKm(THREE, rootWorldKm).multiplyScalar(distanceScale));

  const eastScene = sceneVectorFromKm(THREE, eastWorld).normalize();
  const northScene = sceneVectorFromKm(THREE, northWorld).normalize();
  const upScene = sceneVectorFromKm(THREE, upWorld).normalize();
  const basis = new THREE.Matrix4();
  basis.makeBasis(eastScene, upScene, northScene);
  root.quaternion.setFromRotationMatrix(basis);
  root.visible = true;

  const armTarget = resolveLaunchStructureArmTarget(options);
  const qdTarget = resolveQuickDisconnectTarget(options);
  const armStep = LAUNCH_STRUCTURE_PROFILE_KM.armRatePerSec * dtSeconds;
  state.armOpen = approach(state.armOpen, armTarget, armStep);
  state.quickDisconnectOpen = approach(state.quickDisconnectOpen, qdTarget, armStep * 1.2);

  const armLength = (
    state.profile.chopstickArmMinLengthKm
    + ((state.profile.chopstickArmMaxLengthKm - state.profile.chopstickArmMinLengthKm) * (1 - state.armOpen))
  );
  for (const beam of state.chopstickBeams) {
    setAnchoredBeamLength(beam, armLength);
  }

  const qdLength = (
    state.profile.quickDisconnectMinLengthKm
    + ((state.profile.quickDisconnectMaxLengthKm - state.profile.quickDisconnectMinLengthKm) * (1 - state.quickDisconnectOpen))
  );
  setAnchoredBeamLength(state.quickDisconnectBeam, qdLength);
}
