import {
  LAUNCH_SITE,
  STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM,
  STARSHIP_STACK_DIMENSIONS_KM,
} from "./launchConfig.js";
import { BOOSTER_CHOPSTICK_CATCH_HEIGHT_ABOVE_BASE_KM } from "./launchSiteCatchGeometry.js";
import { surfacePointRelativeKmAtLatLon } from "../surface/earthSurfacePhysics.js";

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
  carriageHeightKm: 0.022,
  carriageWidthKm: 0.021,
  carriageDepthKm: 0.017,
  carriageRailInsetKm: 0.0048,
  carriageBeamThicknessKm: 0.0018,
  carriageBackplateThicknessKm: 0.0024,
  carriageRollerRadiusKm: 0.0011,
  chopstickCatchHeightKm: BOOSTER_CHOPSTICK_CATCH_HEIGHT_ABOVE_BASE_KM,
  chopstickArmMinLengthKm: 0.010,
  chopstickArmMaxLengthKm: 0.024,
  chopstickArmThicknessKm: 0.0019,
  chopstickArmDepthKm: 0.0038,
  chopstickArmSpacingKm: 0.010,
  chopstickForkLengthKm: 0.0048,
  chopstickForkSpreadKm: 0.0038,
  chopstickPivotInsetKm: 0.0012,
  chopstickPivotRadiusKm: 0.0016,
  chopstickBraceThicknessKm: 0.001,
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

function subtractVectorKm(a, b) {
  return {
    x: (Number(a?.x) || 0) - (Number(b?.x) || 0),
    y: (Number(a?.y) || 0) - (Number(b?.y) || 0),
    z: (Number(a?.z) || 0) - (Number(b?.z) || 0),
  };
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
  const rocketPositionKm = options?.rocketPositionKm;
  const stackPresent = Boolean(options?.stackPresent);

  if (stackPresent && finiteVectorKm(rocketPositionKm) && finiteVectorKm(earthPositionKm)) {
    const upWorldKm = normalizeVectorKm(
      subtractVectorKm(rocketPositionKm, earthPositionKm),
    );
    return addVectorKm(
      rocketPositionKm,
      scaleVectorKm(upWorldKm, -STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM),
    );
  }

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
    { includeTerrain: false },
  );
  const padRelativeKm = padSurface?.pointRelativeKm || upWorld;
  const padNormalKm = padSurface?.surfaceNormal || upWorld;
  return {
    x: (Number(earthPositionKm.x) || 0) + (Number(padRelativeKm.x) || 0) + ((Number(padNormalKm.x) || 0) * altitudeKm),
    y: (Number(earthPositionKm.y) || 0) + (Number(padRelativeKm.y) || 0) + ((Number(padNormalKm.y) || 0) * altitudeKm),
    z: (Number(earthPositionKm.z) || 0) + (Number(padRelativeKm.z) || 0) + ((Number(padNormalKm.z) || 0) * altitudeKm),
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

  const mainBeam = makeAnchoredBeam(
    THREE,
    profile.chopstickArmMaxLengthKm,
    profile.chopstickArmThicknessKm,
    profile.chopstickArmDepthKm,
    material,
  );
  group.add(mainBeam);

  const forkUpper = makeAnchoredBeam(
    THREE,
    profile.chopstickForkLengthKm,
    profile.chopstickArmThicknessKm * 0.82,
    profile.chopstickArmDepthKm * 0.7,
    material,
  );
  group.add(forkUpper);

  const forkLower = makeAnchoredBeam(
    THREE,
    profile.chopstickForkLengthKm,
    profile.chopstickArmThicknessKm * 0.82,
    profile.chopstickArmDepthKm * 0.7,
    material,
  );
  group.add(forkLower);

  const upperBrace = new THREE.Mesh(
    new THREE.BoxGeometry(
      profile.chopstickBraceThicknessKm,
      profile.chopstickBraceThicknessKm,
      profile.chopstickArmDepthKm * 0.72,
    ),
    material,
  );
  group.add(upperBrace);

  const lowerBrace = upperBrace.clone();
  group.add(lowerBrace);

  return {
    group,
    hinge,
    mainBeam,
    forkUpper,
    forkLower,
    upperBrace,
    lowerBrace,
  };
}

function updateChopstickArmAssembly(assembly, profile, armLength) {
  if (!assembly) return;
  setAnchoredBeamLength(assembly.mainBeam, armLength);
  const forkLength = profile.chopstickForkLengthKm;
  const tipX = -Math.max(armLength, 1e-9);
  setAnchoredBeamLength(assembly.forkUpper, forkLength);
  setAnchoredBeamLength(assembly.forkLower, forkLength);
  assembly.forkUpper.position.set(
    tipX,
    profile.chopstickForkSpreadKm,
    0,
  );
  assembly.forkLower.position.set(
    tipX,
    -profile.chopstickForkSpreadKm,
    0,
  );
  const braceX = -Math.max(armLength * 0.62, profile.chopstickPivotRadiusKm * 4);
  assembly.upperBrace.position.set(
    braceX,
    profile.chopstickForkSpreadKm * 0.62,
    0,
  );
  assembly.upperBrace.rotation.z = -0.62;
  assembly.lowerBrace.position.set(
    braceX,
    -profile.chopstickForkSpreadKm * 0.62,
    0,
  );
  assembly.lowerBrace.rotation.z = 0.62;
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
      key === "mountLegCount" || key === "towerCrossLevelCount" || key === "armRatePerSec"
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
  });
  const darkSteel = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x2b3239),
    roughness: 0.72,
    metalness: 0.42,
  });
  const towerSteel = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x8e949c),
    roughness: 0.58,
    metalness: 0.64,
  });
  const carriageSteel = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xb8bfc8),
    roughness: 0.5,
    metalness: 0.68,
  });
  const darkPaint = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x171b20),
    roughness: 0.78,
    metalness: 0.18,
  });

  const slab = new THREE.Mesh(
    new THREE.CylinderGeometry(profile.slabRadiusKm, profile.slabRadiusKm, profile.slabHeightKm, 36),
    concrete,
  );
  slab.position.y = 0.5 * profile.slabHeightKm;
  structureGroup.add(slab);

  const apron = new THREE.Mesh(
    new THREE.CylinderGeometry(profile.slabApronRadiusKm, profile.slabApronRadiusKm, profile.slabApronHeightKm, 44),
    concrete,
  );
  apron.position.y = 0.5 * profile.slabApronHeightKm;
  structureGroup.add(apron);

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(
      profile.mountPedestalRadiusKm,
      profile.mountPedestalRadiusKm * 1.08,
      profile.mountPedestalHeightKm,
      24,
    ),
    darkSteel,
  );
  pedestal.position.y = profile.slabHeightKm + (0.5 * profile.mountPedestalHeightKm);
  structureGroup.add(pedestal);

  const mountSkirt = new THREE.Mesh(
    new THREE.CylinderGeometry(
      profile.mountSkirtRadiusKm,
      profile.mountSkirtRadiusKm * 0.96,
      profile.mountSkirtHeightKm,
      28,
      1,
      true,
    ),
    darkSteel,
  );
  mountSkirt.position.y = profile.mountDeckHeightKm - (0.5 * profile.mountSkirtHeightKm);
  structureGroup.add(mountSkirt);

  const waterPlate = new THREE.Mesh(
    new THREE.CylinderGeometry(profile.flamePlateRadiusKm, profile.flamePlateRadiusKm, profile.flamePlateHeightKm, 28),
    darkPaint,
  );
  waterPlate.position.y = profile.slabHeightKm + (0.5 * profile.flamePlateHeightKm);
  structureGroup.add(waterPlate);

  const flameBucket = new THREE.Mesh(
    new THREE.BoxGeometry(
      profile.flameBucketWidthKm,
      profile.flameBucketHeightKm,
      profile.flameBucketDepthKm,
    ),
    darkPaint,
  );
  flameBucket.position.y =
    profile.slabHeightKm
    + profile.flamePlateHeightKm
    + (0.5 * profile.flameBucketHeightKm);
  structureGroup.add(flameBucket);

  const mountDeckBaseY = profile.mountDeckHeightKm - profile.mountDeckThicknessKm;
  const mountRing = new THREE.Mesh(
    new THREE.TorusGeometry(profile.mountDeckRadiusKm, profile.mountRingTubeKm, 10, 48),
    darkSteel,
  );
  mountRing.rotation.x = Math.PI * 0.5;
  mountRing.position.y = mountDeckBaseY + (0.5 * profile.mountDeckThicknessKm);
  structureGroup.add(mountRing);

  const mountPlate = new THREE.Mesh(
    new THREE.CylinderGeometry(
      profile.mountDeckRadiusKm * 0.98,
      profile.mountDeckRadiusKm * 0.98,
      profile.mountDeckThicknessKm,
      28,
    ),
    darkSteel,
  );
  mountPlate.position.y = mountDeckBaseY + (0.5 * profile.mountDeckThicknessKm);
  structureGroup.add(mountPlate);

  const tableLip = new THREE.Mesh(
    new THREE.CylinderGeometry(
      profile.mountDeckRadiusKm * 1.02,
      profile.mountDeckRadiusKm * 1.02,
      profile.mountRingTubeKm * 1.4,
      28,
      1,
      true,
    ),
    carriageSteel,
  );
  tableLip.position.y = mountDeckBaseY + profile.mountDeckThicknessKm;
  structureGroup.add(tableLip);

  for (let i = 0; i < profile.mountLegCount; i += 1) {
    const angle = (i / profile.mountLegCount) * Math.PI * 2;
    const girder = new THREE.Mesh(
      new THREE.BoxGeometry(
        profile.mountLegFootRadiusKm - profile.mountPedestalRadiusKm,
        profile.mountLegThicknessKm * 1.1,
        profile.mountLegThicknessKm * 1.8,
      ),
      darkSteel,
    );
    girder.position.set(
      Math.cos(angle) * ((profile.mountLegFootRadiusKm + profile.mountPedestalRadiusKm) * 0.5),
      mountDeckBaseY - (profile.mountLegThicknessKm * 0.4),
      Math.sin(angle) * ((profile.mountLegFootRadiusKm + profile.mountPedestalRadiusKm) * 0.5),
    );
    girder.rotation.y = -angle;
    structureGroup.add(girder);
  }

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

  const serviceSpine = new THREE.Mesh(
    new THREE.BoxGeometry(
      profile.towerServiceSpineWidthKm,
      profile.towerHeightKm * 0.95,
      profile.towerServiceSpineDepthKm,
    ),
    darkPaint,
  );
  serviceSpine.position.set(
    (0.5 * profile.towerWidthKm) + (0.5 * profile.towerServiceSpineWidthKm),
    0,
    0,
  );
  towerGroup.add(serviceSpine);
  createTowerLattice(THREE, towerGroup, profile, darkSteel, towerSteel);

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

  const carriagePosts = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [-0.5, 0.5],
    [0.5, 0.5],
  ];
  for (const [xSign, zSign] of carriagePosts) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(
        profile.carriageBeamThicknessKm,
        profile.carriageHeightKm,
        profile.carriageBeamThicknessKm,
      ),
      carriageSteel,
    );
    post.position.set(
      xSign * (0.5 * profile.carriageWidthKm),
      0,
      zSign * (0.5 * profile.carriageDepthKm),
    );
    carriageGroup.add(post);
  }

  const carriageBackplate = new THREE.Mesh(
    new THREE.BoxGeometry(
      profile.carriageBackplateThicknessKm,
      profile.carriageHeightKm * 0.92,
      profile.carriageDepthKm * 1.08,
    ),
    darkSteel,
  );
  carriageBackplate.position.set(
    0.5 * profile.carriageWidthKm,
    0,
    0,
  );
  carriageGroup.add(carriageBackplate);

  const carriageRails = [
    [0, 0.5 * profile.carriageHeightKm, -0.5 * profile.carriageDepthKm],
    [0, -0.5 * profile.carriageHeightKm, -0.5 * profile.carriageDepthKm],
    [0, 0.5 * profile.carriageHeightKm, 0.5 * profile.carriageDepthKm],
    [0, -0.5 * profile.carriageHeightKm, 0.5 * profile.carriageDepthKm],
  ];
  for (const [x, y, z] of carriageRails) {
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(
        profile.carriageWidthKm,
        profile.carriageBeamThicknessKm,
        profile.carriageBeamThicknessKm,
      ),
      carriageSteel,
    );
    beam.position.set(x, y, z);
    carriageGroup.add(beam);
  }

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
    assembly.group.position.set(chopstickPivotX, profile.chopstickCatchHeightKm, zOffset);
    structureGroup.add(assembly.group);
    chopstickAssemblies.push(assembly);
  }

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
  const earthPositionKm = options?.earthPositionKm;
  const earthAxes = options?.earthAxes;
  const rocketPositionKm = options?.rocketPositionKm;
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
  const { east, north, up } = eastNorthUpBasisBodyFixed(THREE, latitudeDeg, longitudeDeg);
  const eastWorld = transformBodyFixedVectorToWorld(THREE, east, earthAxes);
  const northWorld = transformBodyFixedVectorToWorld(THREE, north, earthAxes);
  const upWorld = transformBodyFixedVectorToWorld(THREE, up, earthAxes);
  const rootWorldKm = resolveLaunchSiteAnchorWorldKm({
    launchSite,
    earthPositionKm,
    earthAxes,
    rocketPositionKm,
    stackPresent: options?.stackPresent,
  });
  if (!finiteVectorKm(rootWorldKm)) {
    root.visible = false;
    return;
  }
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
  for (const assembly of state.chopstickAssemblies) {
    updateChopstickArmAssembly(assembly, state.profile, armLength);
  }

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
