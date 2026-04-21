function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cloneEngineMaterial(THREE, material, {
  colorHex = null,
  roughness = null,
  metalness = null,
  doubleSide = false,
  emissiveHex = null,
  emissiveIntensity = null,
} = {}) {
  const next = material?.clone ? material.clone() : new THREE.MeshStandardMaterial();
  if (colorHex !== null) {
    next.color = new THREE.Color(colorHex);
  }
  if (roughness !== null) {
    next.roughness = clamp(Number(roughness) || 0, 0, 1);
  }
  if (metalness !== null) {
    next.metalness = clamp(Number(metalness) || 0, 0, 1);
  }
  if (emissiveHex !== null) {
    next.emissive = new THREE.Color(emissiveHex);
  }
  if (emissiveIntensity !== null) {
    next.emissiveIntensity = Math.max(0, Number(emissiveIntensity) || 0);
  }
  next.transparent = false;
  next.opacity = 1;
  next.alphaTest = 0;
  next.depthWrite = true;
  next.depthTest = true;
  next.side = doubleSide ? THREE.DoubleSide : THREE.FrontSide;
  next.needsUpdate = true;
  return next;
}

function makeUpAnchoredCylinder(THREE, radiusTop, radiusBottom, height, material, radialSegments = 18, openEnded = true) {
  const H = Math.max(1e-9, Number(height) || 1e-9);
  const geometry = new THREE.CylinderGeometry(
    Math.max(1e-9, Number(radiusTop) || 1e-9),
    Math.max(1e-9, Number(radiusBottom) || 1e-9),
    H,
    radialSegments,
    1,
    openEnded,
  );
  geometry.translate(0, H * 0.5, 0);
  return new THREE.Mesh(geometry, material);
}

function makeCurvedShell(THREE, profile, material, radialSegments = 20) {
  const points = profile.map(([x, y]) => new THREE.Vector2(Math.max(1e-9, x), y));
  const geometry = new THREE.LatheGeometry(points, radialSegments);
  return new THREE.Mesh(geometry, material);
}

function addRadialRod(hostGroup, THREE, {
  angle,
  startRadius,
  startY,
  endRadius,
  endY,
  material,
  thickness,
} = {}) {
  const start = new THREE.Vector3(
    Math.cos(angle) * startRadius,
    startY,
    Math.sin(angle) * startRadius,
  );
  const end = new THREE.Vector3(
    Math.cos(angle) * endRadius,
    endY,
    Math.sin(angle) * endRadius,
  );
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (!(length > 1e-9)) {
    return null;
  }
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(thickness, thickness, length, 10, 1, false),
    material,
  );
  rod.position.copy(start).add(end).multiplyScalar(0.5);
  rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  hostGroup.add(rod);
  return rod;
}

export function createRaptorSeaLevelReplica(THREE, {
  vehicleRadius = 1,
  darkSteel = null,
  stainless = null,
} = {}) {
  if (!THREE) {
    return new THREE.Group();
  }

  const bellRadius = clamp(vehicleRadius * 0.102, vehicleRadius * 0.054, vehicleRadius * 0.13);
  const bellHeight = clamp(vehicleRadius * 0.215, vehicleRadius * 0.115, vehicleRadius * 0.285);
  const bellShoulderRadius = bellRadius * 0.52;
  const throatRadius = bellRadius * 0.18;
  const powerheadHeight = bellHeight * 0.94;
  const chamberHeight = powerheadHeight * 0.48;
  const chamberRadius = bellShoulderRadius * 0.48;
  const gimbalRingRadius = bellShoulderRadius * 1.05;
  const gimbalRingTube = bellHeight * 0.022;
  const manifoldRingRadius = chamberRadius * 1.22;
  const manifoldRingTube = bellHeight * 0.018;
  const actuatorThickness = bellHeight * 0.04;
  const tubeThickness = bellHeight * 0.03;
  const pumpRadius = chamberRadius * 0.38;
  const pumpLength = chamberRadius * 0.96;
  const serviceBoxW = chamberRadius * 0.66;
  const serviceBoxH = chamberHeight * 0.26;
  const serviceBoxD = chamberRadius * 0.52;
  const coolingJacketHeight = bellHeight * 0.2;
  const coolingJacketRadius = bellShoulderRadius * 1.03;

  const bellMaterial = cloneEngineMaterial(THREE, darkSteel, {
    roughness: 0.5,
    metalness: 0.92,
    doubleSide: true,
    emissiveHex: 0x080a10,
    emissiveIntensity: 0.05,
  });
  const hardwareMaterial = cloneEngineMaterial(THREE, darkSteel, {
    colorHex: 0xc7d2df,
    roughness: 0.42,
    metalness: 0.9,
    emissiveHex: 0x0a0d12,
    emissiveIntensity: 0.03,
  });
  const accentMaterial = cloneEngineMaterial(THREE, stainless || darkSteel, {
    colorHex: 0xe8edf4,
    roughness: 0.3,
    metalness: 0.88,
    emissiveHex: 0x10161e,
    emissiveIntensity: 0.025,
  });
  const plumbingMaterial = cloneEngineMaterial(THREE, darkSteel, {
    colorHex: 0x95a2b2,
    roughness: 0.56,
    metalness: 0.82,
  });

  const engineGroup = new THREE.Group();
  engineGroup.name = "raptor_sea_level_replica";

  const bellProfile = [
    [bellRadius * 0.98, 0],
    [bellRadius * 1.02, bellHeight * 0.05],
    [bellRadius * 0.92, bellHeight * 0.16],
    [bellRadius * 0.73, bellHeight * 0.38],
    [bellRadius * 0.52, bellHeight * 0.68],
    [bellRadius * 0.35, bellHeight * 0.88],
    [bellRadius * 0.24, bellHeight],
  ];
  const bellShell = makeCurvedShell(THREE, bellProfile, bellMaterial, 24);
  engineGroup.add(bellShell);

  const exitLip = new THREE.Mesh(
    new THREE.TorusGeometry(bellRadius * 0.97, bellHeight * 0.022, 10, 28),
    accentMaterial,
  );
  exitLip.rotation.x = Math.PI * 0.5;
  engineGroup.add(exitLip);

  const throat = makeUpAnchoredCylinder(
    THREE,
    throatRadius * 1.06,
    throatRadius * 0.94,
    bellHeight * 0.22,
    hardwareMaterial,
    18,
    true,
  );
  throat.position.y = bellHeight * 0.7;
  engineGroup.add(throat);

  const coolingJacket = makeUpAnchoredCylinder(
    THREE,
    coolingJacketRadius * 0.92,
    coolingJacketRadius,
    coolingJacketHeight,
    accentMaterial,
    20,
    true,
  );
  coolingJacket.position.y = bellHeight * 0.78;
  engineGroup.add(coolingJacket);

  const chamber = makeUpAnchoredCylinder(
    THREE,
    chamberRadius * 0.9,
    chamberRadius,
    chamberHeight,
    hardwareMaterial,
    16,
    false,
  );
  chamber.position.y = bellHeight;
  engineGroup.add(chamber);

  const preburnerCap = makeUpAnchoredCylinder(
    THREE,
    chamberRadius * 0.84,
    chamberRadius * 0.78,
    chamberHeight * 0.22,
    accentMaterial,
    14,
    false,
  );
  preburnerCap.position.y = bellHeight + chamberHeight;
  engineGroup.add(preburnerCap);

  const gimbalRing = new THREE.Mesh(
    new THREE.TorusGeometry(gimbalRingRadius, gimbalRingTube, 10, 28),
    accentMaterial,
  );
  gimbalRing.rotation.x = Math.PI * 0.5;
  gimbalRing.position.y = bellHeight + (powerheadHeight * 0.66);
  engineGroup.add(gimbalRing);

  const manifoldRing = new THREE.Mesh(
    new THREE.TorusGeometry(manifoldRingRadius, manifoldRingTube, 8, 24),
    hardwareMaterial,
  );
  manifoldRing.rotation.x = Math.PI * 0.5;
  manifoldRing.position.y = bellHeight + (chamberHeight * 0.74);
  engineGroup.add(manifoldRing);

  const actuatorAngles = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
  for (const angle of actuatorAngles) {
    addRadialRod(engineGroup, THREE, {
      angle,
      startRadius: gimbalRingRadius * 0.96,
      startY: gimbalRing.position.y,
      endRadius: bellShoulderRadius * 0.72,
      endY: bellHeight * 0.74,
      material: plumbingMaterial,
      thickness: actuatorThickness,
    });
  }

  const pumpAngles = [Math.PI / 2, -Math.PI / 2];
  for (const angle of pumpAngles) {
    const pump = new THREE.Mesh(
      new THREE.CylinderGeometry(pumpRadius, pumpRadius * 0.92, pumpLength, 14, 1, false),
      hardwareMaterial,
    );
    pump.rotation.z = Math.PI * 0.5;
    pump.rotation.y = angle;
    pump.position.set(
      Math.cos(angle) * (chamberRadius + (pumpLength * 0.3)),
      bellHeight + (chamberHeight * 0.6),
      Math.sin(angle) * (chamberRadius + (pumpLength * 0.3)),
    );
    engineGroup.add(pump);

    addRadialRod(engineGroup, THREE, {
      angle,
      startRadius: chamberRadius * 0.66,
      startY: bellHeight + (chamberHeight * 0.52),
      endRadius: chamberRadius + (pumpLength * 0.12),
      endY: bellHeight + (chamberHeight * 0.62),
      material: plumbingMaterial,
      thickness: tubeThickness,
    });

    addRadialRod(engineGroup, THREE, {
      angle,
      startRadius: chamberRadius * 0.4,
      startY: bellHeight + chamberHeight,
      endRadius: chamberRadius + (pumpLength * 0.02),
      endY: bellHeight + (chamberHeight * 0.78),
      material: plumbingMaterial,
      thickness: tubeThickness * 0.9,
    });
  }

  const serviceBox = new THREE.Mesh(
    new THREE.BoxGeometry(serviceBoxW, serviceBoxH, serviceBoxD),
    accentMaterial,
  );
  serviceBox.position.set(0, bellHeight + (chamberHeight * 1.08), chamberRadius * 0.9);
  engineGroup.add(serviceBox);

  const serviceSpine = new THREE.Mesh(
    new THREE.BoxGeometry(chamberRadius * 0.42, powerheadHeight * 0.22, chamberRadius * 0.28),
    hardwareMaterial,
  );
  serviceSpine.position.set(0, bellHeight + (chamberHeight * 0.88), chamberRadius * 0.18);
  engineGroup.add(serviceSpine);

  addRadialRod(engineGroup, THREE, {
    angle: Math.PI,
    startRadius: chamberRadius * 0.35,
    startY: bellHeight + (chamberHeight * 0.9),
    endRadius: chamberRadius * 0.02,
    endY: gimbalRing.position.y + (chamberHeight * 0.06),
    material: plumbingMaterial,
    thickness: tubeThickness * 0.85,
  });

  engineGroup.userData.raptorReplica = true;
  engineGroup.userData.source = "local_raptor_replica";
  return engineGroup;
}

export function addRaptorReplicaCluster(THREE, hostGroup, {
  offsets = [],
  exitY = 0,
  vehicleRadius = 1,
  darkSteel = null,
  stainless = null,
  xzScale = 0.7,
  yScale = 0.94,
} = {}) {
  const engineVisualGroup = new THREE.Group();
  engineVisualGroup.name = "raptor_replica_engine_cluster";
  const resolvedXzScale = clamp(Number(xzScale) || 0.7, 0.45, 1.1);
  const resolvedYScale = clamp(Number(yScale) || 0.94, 0.6, 1.2);
  for (const offset of offsets) {
    const engine = createRaptorSeaLevelReplica(THREE, {
      vehicleRadius,
      darkSteel,
      stainless,
    });
    engine.position.set(
      Number(offset?.x) || 0,
      Number(exitY) || 0,
      Number(offset?.z) || 0,
    );
    engine.scale.set(resolvedXzScale, resolvedYScale, resolvedXzScale);
    engineVisualGroup.add(engine);
  }
  hostGroup.add(engineVisualGroup);
  engineVisualGroup.userData.source = "local_raptor_replica";
  return engineVisualGroup;
}
