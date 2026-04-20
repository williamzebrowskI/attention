import {
  LAUNCH_SITE,
  STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM,
  STARSHIP_STACK_DIMENSIONS_KM,
} from "./launchConfig.js";
import { BOOSTER_CHOPSTICK_CATCH_HEIGHT_ABOVE_BASE_KM } from "./launchSiteCatchGeometry.js";
import { surfacePointRelativeKmAtLatLon } from "../surface/earthSurfacePhysics.js";

const LAUNCH_STRUCTURE_SURFACE_CLEARANCE_KM = 0.00012;

const LAUNCH_STRUCTURE_PROFILE_KM = Object.freeze({
  slabRadiusKm: 0.028,
  slabHeightKm: 0.0022,
  slabApronRadiusKm: 0.036,
  slabApronHeightKm: 0.001,
  mountDeckRadiusKm: 0.0185,
  mountDeckThicknessKm: 0.004,
  mountDeckHeightKm: 0.020,
  mountRingTubeKm: 0.0015,
  mountPedestalRadiusKm: 0.0108,
  mountPedestalHeightKm: 0.0105,
  mountSkirtRadiusKm: 0.0215,
  mountSkirtHeightKm: 0.0056,
  flamePlateRadiusKm: 0.013,
  flamePlateHeightKm: 0.0016,
  flameBucketWidthKm: 0.009,
  flameBucketDepthKm: 0.009,
  flameBucketHeightKm: 0.0056,
  holdClampHeightKm: 0.009,
  holdClampWidthKm: 0.003,
  holdClampDepthKm: 0.005,
  holdClampOffsetKm: 0.0095,
  mountLegCount: 6,
  mountLegThicknessKm: 0.0025,
  mountLegFootRadiusKm: 0.022,
  mountLegTopRadiusKm: 0.015,
  towerHeightKm: 0.146,
  towerWidthKm: 0.016,
  towerDepthKm: 0.016,
  towerOffsetKm: 0.024,
  towerColumnThicknessKm: 0.0018,
  towerBraceThicknessKm: 0.001,
  towerCrossLevelCount: 16,
  towerBaseWidthKm: 0.022,
  towerBaseDepthKm: 0.021,
  towerBaseHeightKm: 0.010,
  towerServiceSpineWidthKm: 0.005,
  towerServiceSpineDepthKm: 0.0062,
  towerTopCapWidthKm: 0.021,
  towerTopCapDepthKm: 0.020,
  towerTopCapHeightKm: 0.004,
  lightningMastHeightKm: 0.010,
  lightningMastRadiusKm: 0.0007,
  towerRailWidthKm: 0.0015,
  towerRailDepthKm: 0.0012,
  towerCableRadiusKm: 0.00035,
  towerPulleyRadiusKm: 0.0016,
  towerPulleyThicknessKm: 0.0015,
  towerWinchRadiusKm: 0.0018,
  towerWinchThicknessKm: 0.0042,
  carriageHeightKm: 0.022,
  carriageWidthKm: 0.021,
  carriageDepthKm: 0.017,
  carriageRailInsetKm: 0.0048,
  carriageBeamThicknessKm: 0.0018,
  carriageBackplateThicknessKm: 0.0024,
  carriageSidePlateThicknessKm: 0.0021,
  carriageCapThicknessKm: 0.0018,
  carriageRollerRadiusKm: 0.0011,
  chopstickCatchHeightKm: BOOSTER_CHOPSTICK_CATCH_HEIGHT_ABOVE_BASE_KM,
  chopstickArmMinLengthKm: 0.010,
  chopstickArmMaxLengthKm: 0.024,
  chopstickArmThicknessKm: 0.0019,
  chopstickArmDepthKm: 0.0038,
  chopstickArmSpacingKm: 0.010,
  chopstickBoxHeightKm: 0.0056,
  chopstickBoxDepthKm: 0.0044,
  chopstickChordThicknessKm: 0.00088,
  chopstickRailThicknessKm: 0.00072,
  chopstickRailDepthKm: 0.0012,
  chopstickTrussPanelCount: 5,
  chopstickForkLengthKm: 0.0048,
  chopstickForkSpreadKm: 0.0038,
  chopstickPivotInsetKm: 0.0012,
  chopstickPivotRadiusKm: 0.0016,
  chopstickBraceThicknessKm: 0.001,
  chopstickActuatorRadiusKm: 0.00062,
  quickDisconnectHeightKm:
    STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm
    + (STARSHIP_STACK_DIMENSIONS_KM.shipCylinderHeightKm * 0.74),
  quickDisconnectBoomMinLengthKm: 0.006,
  quickDisconnectBoomMaxLengthKm: 0.014,
  quickDisconnectThicknessKm: 0.0012,
  quickDisconnectTrussDepthKm: 0.0024,
  quickDisconnectHeadWidthKm: 0.0035,
  quickDisconnectHeadHeightKm: 0.0026,
  quickDisconnectHeadDepthKm: 0.0026,
  armRatePerSec: 1.4,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function enforceSolidOpaqueMaterial(THREE, material) {
  if (!THREE || !material) {
    return material;
  }
  material.transparent = false;
  material.opacity = 1;
  material.alphaTest = 0;
  material.depthWrite = true;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  material.needsUpdate = true;
  return material;
}

function rad(value) {
  return (Number(value) || 0) * (Math.PI / 180);
}

function bodyFixedUpUnitVector(latitudeDeg, longitudeDeg) {
  const latRad = rad(clamp(latitudeDeg, -90, 90));
  const lonRad = rad(longitudeDeg);
  const cosLat = Math.cos(latRad);
  return {
    x: cosLat * Math.cos(lonRad),
    y: cosLat * Math.sin(lonRad),
    z: Math.sin(latRad),
  };
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

function finiteNumber(value) {
  return Number.isFinite(Number(value));
}

function finiteVectorKm(vector) {
  return (
    vector
    && finiteNumber(vector.x)
    && finiteNumber(vector.y)
    && finiteNumber(vector.z)
  );
}

function scaleVectorKm(vector, scalar) {
  return {
    x: (Number(vector?.x) || 0) * scalar,
    y: (Number(vector?.y) || 0) * scalar,
    z: (Number(vector?.z) || 0) * scalar,
  };
}

function addVectorKm(a, b) {
  return {
    x: (Number(a?.x) || 0) + (Number(b?.x) || 0),
    y: (Number(a?.y) || 0) + (Number(b?.y) || 0),
    z: (Number(a?.z) || 0) + (Number(b?.z) || 0),
  };
}

function subtractVectorKm(a, b) {
  return {
    x: (Number(a?.x) || 0) - (Number(b?.x) || 0),
    y: (Number(a?.y) || 0) - (Number(b?.y) || 0),
    z: (Number(a?.z) || 0) - (Number(b?.z) || 0),
  };
}

function normalizeVectorKm(vector, fallback = { x: 0, y: 0, z: 1 }) {
  const x = Number(vector?.x) || 0;
  const y = Number(vector?.y) || 0;
  const z = Number(vector?.z) || 0;
  const magnitude = Math.sqrt((x * x) + (y * y) + (z * z));
  if (!(magnitude > 1e-12)) {
    return { ...fallback };
  }
  return {
    x: x / magnitude,
    y: y / magnitude,
    z: z / magnitude,
  };
}

export function resolveLaunchSiteAnchorWorldKm(options = {}) {
  const launchSite = options?.launchSite || LAUNCH_SITE;
  const latitudeDeg = Number(launchSite?.latitudeDeg) || 0;
  const longitudeDeg = Number(launchSite?.longitudeDeg) || 0;
  const altitudeKm = Math.max(0, Number(launchSite?.altitudeKm) || 0);
  const earthPositionKm = options?.earthPositionKm;
  const earthAxes = options?.earthAxes;

  if (!finiteVectorKm(earthPositionKm) || !earthAxes) {
    return null;
  }

  const up = bodyFixedUpUnitVector(latitudeDeg, longitudeDeg);
  const upWorld = {
    x: ((Number(earthAxes?.xAxis?.x) || 0) * (Number(up?.x) || 0))
      + ((Number(earthAxes?.yAxis?.x) || 0) * (Number(up?.y) || 0))
      + ((Number(earthAxes?.pole?.x) || 0) * (Number(up?.z) || 0)),
    y: ((Number(earthAxes?.xAxis?.y) || 0) * (Number(up?.x) || 0))
      + ((Number(earthAxes?.yAxis?.y) || 0) * (Number(up?.y) || 0))
      + ((Number(earthAxes?.pole?.y) || 0) * (Number(up?.z) || 0)),
    z: ((Number(earthAxes?.xAxis?.z) || 0) * (Number(up?.x) || 0))
      + ((Number(earthAxes?.yAxis?.z) || 0) * (Number(up?.y) || 0))
      + ((Number(earthAxes?.pole?.z) || 0) * (Number(up?.z) || 0)),
  };
  const padSurface = surfacePointRelativeKmAtLatLon(
    latitudeDeg,
    longitudeDeg,
    earthAxes,
    { includeTerrain: true },
  );
  const padRelativeKm = padSurface?.pointRelativeKm || upWorld;
  const padNormalKm = padSurface?.surfaceNormal || upWorld;
  const surfaceOffsetKm = altitudeKm + LAUNCH_STRUCTURE_SURFACE_CLEARANCE_KM;
  return {
    x: (Number(earthPositionKm.x) || 0) + (Number(padRelativeKm.x) || 0) + ((Number(padNormalKm.x) || 0) * surfaceOffsetKm),
    y: (Number(earthPositionKm.y) || 0) + (Number(padRelativeKm.y) || 0) + ((Number(padNormalKm.y) || 0) * surfaceOffsetKm),
    z: (Number(earthPositionKm.z) || 0) + (Number(padRelativeKm.z) || 0) + ((Number(padNormalKm.z) || 0) * surfaceOffsetKm),
  };
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

function addStrutBetweenPoints(THREE, parent, start, end, thickness, material) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  if (!(length > 1e-9)) {
    return null;
  }
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(thickness, length, thickness),
    material,
  );
  mesh.position.copy(start).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  parent.add(mesh);
  return mesh;
}

function createAdjustableCylinder(THREE, radius, material, radialSegments = 10) {
  return new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 1, radialSegments),
    material,
  );
}

function setCylinderBetweenPoints(mesh, start, end) {
  if (!mesh || !start || !end) return;
  const direction = new mesh.position.constructor().subVectors(end, start);
  const length = direction.length();
  if (!(length > 1e-9)) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  mesh.position.copy(start).addScaledVector(direction, 0.5);
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(
    new mesh.position.constructor(0, 1, 0),
    direction.normalize(),
  );
}

function createTowerLattice(THREE, towerGroup, profile, darkSteel, stainless) {
  const halfW = profile.towerWidthKm * 0.5;
  const halfD = profile.towerDepthKm * 0.5;
  const columnOffsets = [
    [-halfW, -halfD],
    [halfW, -halfD],
    [-halfW, halfD],
    [halfW, halfD],
  ];

  for (const [x, z] of columnOffsets) {
    const column = new THREE.Mesh(
      new THREE.BoxGeometry(
        profile.towerColumnThicknessKm,
        profile.towerHeightKm,
        profile.towerColumnThicknessKm,
      ),
      darkSteel,
    );
    column.position.set(x, 0, z);
    towerGroup.add(column);
  }

  const levelCount = Math.max(2, Math.floor(profile.towerCrossLevelCount));
  const yMin = -0.5 * profile.towerHeightKm;
  const yMax = 0.5 * profile.towerHeightKm;
  for (let i = 0; i < levelCount; i += 1) {
    const t = i / (levelCount - 1);
    const y = yMin + ((yMax - yMin) * t);

    const frontBeam = new THREE.Mesh(
      new THREE.BoxGeometry(profile.towerWidthKm, profile.towerBraceThicknessKm, profile.towerBraceThicknessKm),
      stainless,
    );
    frontBeam.position.set(0, y, -halfD);
    towerGroup.add(frontBeam);

    const rearBeam = frontBeam.clone();
    rearBeam.position.z = halfD;
    towerGroup.add(rearBeam);

    const leftBeam = new THREE.Mesh(
      new THREE.BoxGeometry(profile.towerBraceThicknessKm, profile.towerBraceThicknessKm, profile.towerDepthKm),
      stainless,
    );
    leftBeam.position.set(-halfW, y, 0);
    towerGroup.add(leftBeam);

    const rightBeam = leftBeam.clone();
    rightBeam.position.x = halfW;
    towerGroup.add(rightBeam);

    if (i < levelCount - 1) {
      const yNext = yMin + ((yMax - yMin) * ((i + 1) / (levelCount - 1)));
      addStrutBetweenPoints(
        THREE,
        towerGroup,
        new THREE.Vector3(-halfW, y, -halfD),
        new THREE.Vector3(halfW, yNext, -halfD),
        profile.towerBraceThicknessKm,
        stainless,
      );
      addStrutBetweenPoints(
        THREE,
        towerGroup,
        new THREE.Vector3(halfW, y, -halfD),
        new THREE.Vector3(-halfW, yNext, -halfD),
        profile.towerBraceThicknessKm,
        stainless,
      );
      addStrutBetweenPoints(
        THREE,
        towerGroup,
        new THREE.Vector3(-halfW, y, halfD),
        new THREE.Vector3(halfW, yNext, halfD),
        profile.towerBraceThicknessKm,
        stainless,
      );
      addStrutBetweenPoints(
        THREE,
        towerGroup,
        new THREE.Vector3(halfW, y, halfD),
        new THREE.Vector3(-halfW, yNext, halfD),
        profile.towerBraceThicknessKm,
        stainless,
      );
    }
  }
}

function createChopstickArmAssembly(THREE, profile, material) {
  const group = new THREE.Group();
  const hinge = new THREE.Mesh(
    new THREE.CylinderGeometry(
      profile.chopstickPivotRadiusKm,
      profile.chopstickPivotRadiusKm,
      profile.chopstickArmDepthKm * 1.1,
      14,
    ),
    material,
  );
  hinge.rotation.z = Math.PI * 0.5;
  group.add(hinge);

  const armCore = new THREE.Group();
  group.add(armCore);

  const chordHalfHeight = profile.chopstickBoxHeightKm * 0.5;
  const chordHalfDepth = profile.chopstickBoxDepthKm * 0.5;
  const chordOffsets = [
    [chordHalfHeight, -chordHalfDepth],
    [-chordHalfHeight, -chordHalfDepth],
    [chordHalfHeight, chordHalfDepth],
    [-chordHalfHeight, chordHalfDepth],
  ];
  for (const [y, z] of chordOffsets) {
    const chord = makeAnchoredBeam(
      THREE,
      profile.chopstickArmMaxLengthKm,
      profile.chopstickChordThicknessKm,
      profile.chopstickChordThicknessKm,
      material,
    );
    chord.position.set(0, y, z);
    armCore.add(chord);
  }

  const railOffsets = [-0.26 * profile.chopstickBoxDepthKm, 0.26 * profile.chopstickBoxDepthKm];
  for (const z of railOffsets) {
    const catchRail = makeAnchoredBeam(
      THREE,
      profile.chopstickArmMaxLengthKm,
      profile.chopstickRailThicknessKm,
      profile.chopstickRailDepthKm,
      material,
    );
    catchRail.position.set(0, chordHalfHeight + profile.chopstickRailThicknessKm, z);
    armCore.add(catchRail);
  }

  const panelLength = profile.chopstickArmMaxLengthKm / profile.chopstickTrussPanelCount;
  for (let i = 0; i <= profile.chopstickTrussPanelCount; i += 1) {
    const x = -panelLength * i;
    const verticalFront = new THREE.Mesh(
      new THREE.BoxGeometry(
        profile.chopstickChordThicknessKm,
        profile.chopstickBoxHeightKm,
        profile.chopstickChordThicknessKm,
      ),
      material,
    );
    verticalFront.position.set(x, 0, -chordHalfDepth);
    armCore.add(verticalFront);

    const verticalRear = verticalFront.clone();
    verticalRear.position.z = chordHalfDepth;
    armCore.add(verticalRear);

    const crossTop = new THREE.Mesh(
      new THREE.BoxGeometry(
        profile.chopstickChordThicknessKm,
        profile.chopstickChordThicknessKm,
        profile.chopstickBoxDepthKm,
      ),
      material,
    );
    crossTop.position.set(x, chordHalfHeight, 0);
    armCore.add(crossTop);

    const crossBottom = crossTop.clone();
    crossBottom.position.y = -chordHalfHeight;
    armCore.add(crossBottom);
  }

  for (let i = 0; i < profile.chopstickTrussPanelCount; i += 1) {
    const x0 = -panelLength * i;
    const x1 = -panelLength * (i + 1);
    const rising = (i % 2) === 0;
    const startFront = new THREE.Vector3(x0, rising ? chordHalfHeight : -chordHalfHeight, -chordHalfDepth);
    const endFront = new THREE.Vector3(x1, rising ? -chordHalfHeight : chordHalfHeight, -chordHalfDepth);
    const startRear = new THREE.Vector3(x0, rising ? chordHalfHeight : -chordHalfHeight, chordHalfDepth);
    const endRear = new THREE.Vector3(x1, rising ? -chordHalfHeight : chordHalfHeight, chordHalfDepth);
    addStrutBetweenPoints(
      THREE,
      armCore,
      startFront,
      endFront,
      profile.chopstickBraceThicknessKm,
      material,
    );
    addStrutBetweenPoints(
      THREE,
      armCore,
      startRear,
      endRear,
      profile.chopstickBraceThicknessKm,
      material,
    );
  }

  const tipGroup = new THREE.Group();
  tipGroup.position.x = -profile.chopstickArmMaxLengthKm;
  armCore.add(tipGroup);

  const forkUpper = new THREE.Mesh(
    new THREE.BoxGeometry(
      profile.chopstickForkLengthKm,
      profile.chopstickArmThicknessKm * 1.05,
      profile.chopstickRailDepthKm * 1.45,
    ),
    material,
  );
  forkUpper.position.set(
    -0.5 * profile.chopstickForkLengthKm,
    profile.chopstickForkSpreadKm,
    0,
  );
  tipGroup.add(forkUpper);

  const forkLower = forkUpper.clone();
  forkLower.position.y = -profile.chopstickForkSpreadKm;
  tipGroup.add(forkLower);

  const forkCap = new THREE.Mesh(
    new THREE.BoxGeometry(
      profile.chopstickChordThicknessKm * 2.4,
      profile.chopstickForkSpreadKm * 2.55,
      profile.chopstickBoxDepthKm,
    ),
    material,
  );
  tipGroup.add(forkCap);

  const actuatorOuter = createAdjustableCylinder(
    THREE,
    profile.chopstickActuatorRadiusKm,
    material,
    10,
  );
  group.add(actuatorOuter);

  const actuatorRod = createAdjustableCylinder(
    THREE,
    profile.chopstickActuatorRadiusKm * 0.55,
    material,
    10,
  );
  group.add(actuatorRod);

  return {
    group,
    hinge,
    armCore,
    tipGroup,
    forkUpper,
    forkLower,
    actuatorOuter,
    actuatorRod,
  };
}

function updateChopstickArmAssembly(assembly, profile, armLength) {
  if (!assembly) return;
  const extensionRatio = Math.max(
    profile.chopstickArmMinLengthKm / Math.max(profile.chopstickArmMaxLengthKm, 1e-9),
    Math.min(1, armLength / Math.max(profile.chopstickArmMaxLengthKm, 1e-9)),
  );
  assembly.armCore.scale.x = extensionRatio;

  const actuatorBase = new THREE.Vector3(
    profile.chopstickPivotRadiusKm * 1.8,
    -profile.chopstickBoxHeightKm * 0.44,
    0,
  );
  const actuatorMid = new THREE.Vector3(
    -Math.max(armLength * 0.36, profile.chopstickPivotRadiusKm * 6),
    -profile.chopstickBoxHeightKm * 0.1,
    0,
  );
  const actuatorTip = new THREE.Vector3(
    -Math.max(armLength * 0.52, profile.chopstickPivotRadiusKm * 8),
    0,
    0,
  );
  setCylinderBetweenPoints(assembly.actuatorOuter, actuatorBase, actuatorMid);
  setCylinderBetweenPoints(assembly.actuatorRod, actuatorMid, actuatorTip);
}

export function resolveLaunchStructureArmTarget(input = {}) {
  const stackPresent = Boolean(input.stackPresent);
  const launchPhase = String(input.launchPhase || "").trim().toLowerCase();
  const boosterPhase = String(input.boosterPhase || "").trim().toLowerCase();
  const guidanceMode = String(input.guidanceMode || "").trim().toLowerCase();
  const elapsedSeconds = Number(input.elapsedSeconds);
  const altitudeKm = Number(input.altitudeKm);
  const boosterLanded = Boolean(input.boosterLanded);
  const lowAltitude = Number.isFinite(altitudeKm) && altitudeKm < 0.75;
  const launchCommitActive = launchPhase === "powered"
    && (
      guidanceMode.includes("pad-release")
      || guidanceMode.includes("tower-clear")
      || (Number.isFinite(elapsedSeconds) && elapsedSeconds >= 0.35)
    );

  if (boosterLanded || boosterPhase.includes("caught")) {
    return 0.08;
  }
  if (boosterPhase.includes("catch")) {
    return 0.18;
  }
  if (boosterPhase.includes("landing")) {
    return 0.26;
  }
  if (launchCommitActive && lowAltitude) {
    return 0.82;
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

export function resolveQuickDisconnectTarget(input = {}) {
  const stackPresent = Boolean(input.stackPresent);
  const launchPhase = String(input.launchPhase || "").trim().toLowerCase();
  const guidanceMode = String(input.guidanceMode || "").trim().toLowerCase();
  const elapsedSeconds = Number(input.elapsedSeconds);
  const altitudeKm = Number(input.altitudeKm);
  const lowAltitude = Number.isFinite(altitudeKm) && altitudeKm < 0.35;
  const launchCommitActive = launchPhase === "powered"
    && (
      guidanceMode.includes("pad-release")
      || guidanceMode.includes("tower-clear")
      || (Number.isFinite(elapsedSeconds) && elapsedSeconds >= 0.15)
    );
  if (launchCommitActive) {
    return 1.0;
  }
  if (stackPresent || launchPhase === "idle" || (launchPhase === "powered" && lowAltitude)) {
    return 0.1;
  }
  if (launchPhase && launchPhase !== "idle") {
    return 1.0;
  }
  return 0.55;
}

export function createLaunchSiteStructureVisual(THREE, distanceScale) {
  const ds = Math.max(Number(distanceScale) || 0, 1e-9);
  const radius = STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 0.5 * ds;
  const profile = Object.fromEntries(
    Object.entries(LAUNCH_STRUCTURE_PROFILE_KM).map(([key, value]) => (
      key === "mountLegCount"
        || key === "towerCrossLevelCount"
        || key === "armRatePerSec"
        || key === "chopstickTrussPanelCount"
        ? [key, value]
        : [key, value * ds]
    )),
  );

  const root = new THREE.Group();
  const structureGroup = new THREE.Group();
  root.add(structureGroup);

  const concrete = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x686b70),
    roughness: 0.92,
    metalness: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  enforceSolidOpaqueMaterial(THREE, concrete);
  const darkSteel = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x2b3239),
    roughness: 0.72,
    metalness: 0.42,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  enforceSolidOpaqueMaterial(THREE, darkSteel);
  const towerSteel = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x8e949c),
    roughness: 0.58,
    metalness: 0.64,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  enforceSolidOpaqueMaterial(THREE, towerSteel);
  const carriageSteel = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xb8bfc8),
    roughness: 0.5,
    metalness: 0.68,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  enforceSolidOpaqueMaterial(THREE, carriageSteel);
  const darkPaint = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x171b20),
    roughness: 0.78,
    metalness: 0.18,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  enforceSolidOpaqueMaterial(THREE, darkPaint);

  // Keep the launch table as a few solid masses instead of stacked thin plates.
  const slabBaseHeightKm = profile.slabHeightKm + profile.slabApronHeightKm;
  const slab = new THREE.Mesh(
    new THREE.CylinderGeometry(
      profile.slabApronRadiusKm,
      profile.slabApronRadiusKm * 0.985,
      slabBaseHeightKm,
      40,
    ),
    concrete,
  );
  slab.position.y = 0.5 * slabBaseHeightKm;
  structureGroup.add(slab);

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(
      profile.mountSkirtRadiusKm,
      profile.mountSkirtRadiusKm * 1.06,
      profile.mountDeckHeightKm - slabBaseHeightKm,
      28,
    ),
    darkSteel,
  );
  pedestal.position.y = slabBaseHeightKm + (0.5 * (profile.mountDeckHeightKm - slabBaseHeightKm));
  structureGroup.add(pedestal);

  const mountDeckBaseY = profile.mountDeckHeightKm - profile.mountDeckThicknessKm;
  const mountTable = new THREE.Mesh(
    new THREE.CylinderGeometry(
      profile.mountDeckRadiusKm,
      profile.mountDeckRadiusKm,
      profile.mountDeckThicknessKm,
      28,
    ),
    carriageSteel,
  );
  mountTable.position.y = mountDeckBaseY + (0.5 * profile.mountDeckThicknessKm);
  structureGroup.add(mountTable);

  const flameTrench = new THREE.Mesh(
    new THREE.BoxGeometry(
      profile.flameBucketWidthKm * 1.25,
      profile.flameBucketHeightKm * 1.15,
      profile.flameBucketDepthKm * 1.25,
    ),
    darkPaint,
  );
  flameTrench.position.y = slabBaseHeightKm + (0.42 * profile.flameBucketHeightKm);
  structureGroup.add(flameTrench);

  for (let i = 0; i < profile.mountLegCount; i += 1) {
    const angle = (i / profile.mountLegCount) * Math.PI * 2;
    const top = new THREE.Vector3(
      Math.cos(angle) * profile.mountLegTopRadiusKm,
      mountDeckBaseY,
      Math.sin(angle) * profile.mountLegTopRadiusKm,
    );
    const bottom = new THREE.Vector3(
      Math.cos(angle) * profile.mountLegFootRadiusKm,
      profile.slabHeightKm,
      Math.sin(angle) * profile.mountLegFootRadiusKm,
    );
    addStrutBetweenPoints(
      THREE,
      structureGroup,
      top,
      bottom,
      profile.mountLegThicknessKm,
      darkSteel,
    );
  }

  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const clampMesh = new THREE.Mesh(
      new THREE.BoxGeometry(
        profile.holdClampWidthKm,
        profile.holdClampHeightKm,
        profile.holdClampDepthKm,
      ),
      carriageSteel,
    );
    clampMesh.position.set(
      Math.cos(angle) * profile.holdClampOffsetKm,
      mountDeckBaseY + profile.mountDeckThicknessKm + (0.5 * profile.holdClampHeightKm),
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
  const towerBase = new THREE.Mesh(
    new THREE.BoxGeometry(
      profile.towerBaseWidthKm,
      profile.towerBaseHeightKm,
      profile.towerBaseDepthKm,
    ),
    darkSteel,
  );
  towerBase.position.set(
    0,
    -0.5 * profile.towerHeightKm + (0.5 * profile.towerBaseHeightKm),
    0,
  );
  towerGroup.add(towerBase);

  const towerCore = new THREE.Mesh(
    new THREE.BoxGeometry(
      profile.towerWidthKm,
      profile.towerHeightKm - profile.towerBaseHeightKm,
      profile.towerDepthKm,
    ),
    towerSteel,
  );
  towerCore.position.set(
    0,
    0.5 * profile.towerBaseHeightKm,
    0,
  );
  towerGroup.add(towerCore);

  const serviceSpine = new THREE.Mesh(
    new THREE.BoxGeometry(
      profile.towerServiceSpineWidthKm,
      profile.towerHeightKm * 0.9,
      profile.towerServiceSpineDepthKm,
    ),
    darkPaint,
  );
  serviceSpine.position.set(
    (0.5 * profile.towerWidthKm) + (0.45 * profile.towerServiceSpineWidthKm),
    0.02 * profile.towerHeightKm,
    0,
  );
  towerGroup.add(serviceSpine);

  const towerRailX = -0.5 * profile.towerWidthKm + (0.75 * profile.towerRailWidthKm);
  for (const zSign of [-1, 1]) {
    const towerRail = new THREE.Mesh(
      new THREE.BoxGeometry(
        profile.towerRailWidthKm,
        profile.towerHeightKm * 0.96,
        profile.towerRailDepthKm,
      ),
      carriageSteel,
    );
    towerRail.position.set(
      towerRailX,
      0,
      zSign * (0.28 * profile.carriageDepthKm),
    );
    towerGroup.add(towerRail);
  }

  const towerTopCap = new THREE.Mesh(
    new THREE.BoxGeometry(
      profile.towerTopCapWidthKm,
      profile.towerTopCapHeightKm,
      profile.towerTopCapDepthKm,
    ),
    darkSteel,
  );
  towerTopCap.position.set(
    0,
    (0.5 * profile.towerHeightKm) + (0.5 * profile.towerTopCapHeightKm),
    0,
  );
  towerGroup.add(towerTopCap);

  const lightningMast = new THREE.Mesh(
    new THREE.CylinderGeometry(
      profile.lightningMastRadiusKm,
      profile.lightningMastRadiusKm,
      profile.lightningMastHeightKm,
      12,
    ),
    carriageSteel,
  );
  lightningMast.position.set(
    0,
    (0.5 * profile.towerHeightKm)
      + profile.towerTopCapHeightKm
      + (0.5 * profile.lightningMastHeightKm),
    0,
  );
  towerGroup.add(lightningMast);

  const carriageGroup = new THREE.Group();
  carriageGroup.position.set(
    0,
    profile.chopstickCatchHeightKm - (0.5 * profile.towerHeightKm),
    0,
  );
  towerGroup.add(carriageGroup);

  const carriageBlock = new THREE.Mesh(
    new THREE.BoxGeometry(
      profile.carriageWidthKm * 0.9,
      profile.carriageHeightKm,
      profile.carriageDepthKm * 0.92,
    ),
    carriageSteel,
  );
  carriageBlock.position.set(-0.06 * profile.carriageWidthKm, 0, 0);
  carriageGroup.add(carriageBlock);

  const carriageBackplate = new THREE.Mesh(
    new THREE.BoxGeometry(
      profile.carriageBackplateThicknessKm * 1.6,
      profile.carriageHeightKm * 0.95,
      profile.carriageDepthKm * 1.04,
    ),
    darkSteel,
  );
  carriageBackplate.position.set(
    0.38 * profile.carriageWidthKm,
    0,
    0,
  );
  carriageGroup.add(carriageBackplate);

  for (const zSign of [-1, 1]) {
    for (const ySign of [-1, 1]) {
      const roller = new THREE.Mesh(
        new THREE.CylinderGeometry(
          profile.carriageRollerRadiusKm,
          profile.carriageRollerRadiusKm,
          profile.carriageBeamThicknessKm * 1.3,
          10,
        ),
        carriageSteel,
      );
      roller.rotation.z = Math.PI * 0.5;
      roller.position.set(
        -0.5 * profile.carriageWidthKm,
        ySign * (0.38 * profile.carriageHeightKm),
        zSign * (0.38 * profile.carriageDepthKm),
      );
      carriageGroup.add(roller);
    }
  }

  const chopstickPivotX =
    towerGroup.position.x
    - (0.5 * profile.towerWidthKm)
    + profile.chopstickPivotInsetKm;
  const armZOffsets = [
    -0.5 * profile.chopstickArmSpacingKm,
    0.5 * profile.chopstickArmSpacingKm,
  ];
  const chopstickAssemblies = [];
  for (const zOffset of armZOffsets) {
    const assembly = createChopstickArmAssembly(THREE, profile, carriageSteel);
    assembly.group.position.set(chopstickPivotX - towerGroup.position.x, 0, zOffset);
    carriageGroup.add(assembly.group);
    chopstickAssemblies.push(assembly);
  }

  const topPulley = new THREE.Mesh(
    new THREE.CylinderGeometry(
      profile.towerPulleyRadiusKm,
      profile.towerPulleyRadiusKm,
      profile.towerPulleyThicknessKm,
      16,
    ),
    carriageSteel,
  );
  topPulley.rotation.x = Math.PI * 0.5;
  topPulley.position.set(
    towerRailX,
    (0.5 * profile.towerHeightKm) - (profile.towerPulleyRadiusKm * 1.8),
    0,
  );
  towerGroup.add(topPulley);

  const winchDrum = new THREE.Mesh(
    new THREE.CylinderGeometry(
      profile.towerWinchRadiusKm,
      profile.towerWinchRadiusKm,
      profile.towerWinchThicknessKm,
      16,
    ),
    darkSteel,
  );
  winchDrum.rotation.x = Math.PI * 0.5;
  winchDrum.position.set(
    (0.5 * profile.towerWidthKm) + (0.5 * profile.towerServiceSpineWidthKm),
    -0.5 * profile.towerHeightKm + profile.towerBaseHeightKm + (profile.towerWinchRadiusKm * 1.6),
    0,
  );
  towerGroup.add(winchDrum);

  const carriageCable = createAdjustableCylinder(
    THREE,
    profile.towerCableRadiusKm,
    carriageSteel,
    8,
  );
  towerGroup.add(carriageCable);

  const qdSupport = new THREE.Mesh(
    new THREE.BoxGeometry(
      profile.quickDisconnectThicknessKm * 1.5,
      profile.quickDisconnectHeadHeightKm * 3.4,
      profile.quickDisconnectThicknessKm * 1.5,
    ),
    carriageSteel,
  );
  qdSupport.position.set(
    towerGroup.position.x - (0.18 * profile.towerWidthKm),
    profile.quickDisconnectHeightKm,
    0,
  );
  structureGroup.add(qdSupport);

  const qdTruss = new THREE.Mesh(
    new THREE.BoxGeometry(
      profile.quickDisconnectThicknessKm * 1.1,
      profile.quickDisconnectHeadHeightKm * 2.3,
      profile.quickDisconnectTrussDepthKm,
    ),
    darkSteel,
  );
  qdTruss.position.set(
    towerGroup.position.x - (0.26 * profile.towerWidthKm),
    profile.quickDisconnectHeightKm - (profile.quickDisconnectHeadHeightKm * 0.2),
    0,
  );
  qdTruss.rotation.z = 0.42;
  structureGroup.add(qdTruss);

  const quickDisconnectBeam = makeAnchoredBeam(
    THREE,
    profile.quickDisconnectBoomMaxLengthKm,
    profile.quickDisconnectThicknessKm,
    profile.quickDisconnectThicknessKm * 1.8,
    carriageSteel,
  );
  quickDisconnectBeam.position.set(
    towerGroup.position.x - (0.08 * profile.towerWidthKm),
    profile.quickDisconnectHeightKm,
    0,
  );
  structureGroup.add(quickDisconnectBeam);

  const quickDisconnectHead = new THREE.Mesh(
    new THREE.BoxGeometry(
      profile.quickDisconnectHeadWidthKm,
      profile.quickDisconnectHeadHeightKm,
      profile.quickDisconnectHeadDepthKm,
    ),
    darkSteel,
  );
  structureGroup.add(quickDisconnectHead);

  const quickDisconnectUmbilical = new THREE.Mesh(
    new THREE.BoxGeometry(
      profile.quickDisconnectHeadWidthKm * 0.42,
      profile.quickDisconnectHeadHeightKm * 1.55,
      profile.quickDisconnectHeadDepthKm * 0.42,
    ),
    carriageSteel,
  );
  structureGroup.add(quickDisconnectUmbilical);

  root.userData.launchStructureSource = "spacex_style_launch_tower_chopsticks";
  root.traverse((node) => {
    if (node?.isMesh) {
      node.frustumCulled = false;
    }
  });

  return {
    root,
    materials: [concrete, darkSteel, towerSteel, carriageSteel, darkPaint],
    state: {
      armOpen: 0.24,
      quickDisconnectOpen: 0.1,
      profile,
      chopstickAssemblies,
      carriageGroup,
      towerGroup,
      carriageCable,
      topPulley,
      quickDisconnectBeam,
      quickDisconnectHead,
      quickDisconnectUmbilical,
    },
  };
}

export function updateLaunchSiteStructureVisual(launchStructureVisual, options = {}) {
  const root = launchStructureVisual?.root;
  const state = launchStructureVisual?.state;
  const THREE = options?.THREE;
  const scene = options?.scene;
  const sceneOriginKm = options?.sceneOriginKm;
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
  const distanceScale = Number(options?.distanceScale) || 1;
  const { east, up } = eastNorthUpBasisBodyFixed(THREE, latitudeDeg, longitudeDeg);
  const eastWorld = transformBodyFixedVectorToWorld(THREE, east, earthAxes);
  const upWorld = transformBodyFixedVectorToWorld(THREE, up, earthAxes);
  const rootWorldKm = resolveLaunchSiteAnchorWorldKm({
    launchSite,
    earthPositionKm,
    earthAxes,
    rocketPositionKm: options?.rocketPositionKm,
    stackPresent: options?.stackPresent,
  });
  if (!finiteVectorKm(rootWorldKm)) {
    root.visible = false;
    return;
  }
  const originKm = finiteVectorKm(sceneOriginKm)
    ? sceneOriginKm
    : { x: 0, y: 0, z: 0 };
  root.position.copy(sceneVectorFromKm(THREE, {
    x: (Number(rootWorldKm.x) || 0) - (Number(originKm.x) || 0),
    y: (Number(rootWorldKm.y) || 0) - (Number(originKm.y) || 0),
    z: (Number(rootWorldKm.z) || 0) - (Number(originKm.z) || 0),
  }).multiplyScalar(distanceScale));

  const eastScene = sceneVectorFromKm(THREE, eastWorld).normalize();
  const upScene = sceneVectorFromKm(THREE, upWorld).normalize();
  // Build a right-handed local frame. `east, up, north` is left-handed and
  // can make front-face culling look like transparency/flicker.
  const forwardScene = new THREE.Vector3().crossVectors(eastScene, upScene).normalize();
  if (!(forwardScene.lengthSq() > 1e-12)) {
    root.visible = false;
    return;
  }
  const basis = new THREE.Matrix4();
  basis.makeBasis(eastScene, upScene, forwardScene);
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
  for (const assembly of state.chopstickAssemblies) {
    updateChopstickArmAssembly(assembly, state.profile, armLength);
  }

  const cableStart = new THREE.Vector3().copy(state.topPulley.position);
  const cableEnd = new THREE.Vector3(
    state.topPulley.position.x,
    state.carriageGroup.position.y + (0.5 * state.profile.carriageHeightKm),
    0,
  );
  setCylinderBetweenPoints(state.carriageCable, cableStart, cableEnd);

  const qdLength = (
    state.profile.quickDisconnectBoomMinLengthKm
    + ((state.profile.quickDisconnectBoomMaxLengthKm - state.profile.quickDisconnectBoomMinLengthKm) * (1 - state.quickDisconnectOpen))
  );
  setAnchoredBeamLength(state.quickDisconnectBeam, qdLength);
  state.quickDisconnectHead.position.set(
    state.quickDisconnectBeam.position.x - qdLength,
    state.quickDisconnectBeam.position.y,
    state.quickDisconnectBeam.position.z,
  );
  state.quickDisconnectUmbilical.position.set(
    state.quickDisconnectHead.position.x + (0.35 * state.profile.quickDisconnectHeadWidthKm),
    state.quickDisconnectHead.position.y - (0.75 * state.profile.quickDisconnectHeadHeightKm),
    state.quickDisconnectHead.position.z,
  );
}
