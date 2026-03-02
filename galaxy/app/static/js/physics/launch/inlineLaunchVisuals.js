import {
  BOOSTER_THRUSTER_LAYOUT,
  STARSHIP_THRUSTER_LAYOUT,
} from "./thrusterLayout.js";

export const INLINE_STARSHIP_STACK_DIMENSIONS_KM = Object.freeze({
  diameterKm: 0.009,
  boosterHeightKm: 0.071,
  shipHeightKm: 0.050,
  shipNoseHeightKm: 0.015,
});

export const INLINE_STARSHIP_STACK_TOTAL_HEIGHT_KM =
  INLINE_STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm
  + INLINE_STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm;

const BOOSTER_MAIN_ENGINE_PLUME_COLOR_HEX = 0xffd9a8;
const BOOSTER_RCS_JET_COLOR_HEX = 0xb5d8ff;
const BOOSTER_MAIN_PLUME_SIZE_SCALE = 0.24;
const BOOSTER_MAIN_PLUME_BRIGHTNESS_SCALE = 0.30;
const BOOSTER_SEA_LEVEL_PRESSURE_PA = 101_325;
const BOOSTER_RCS_Q_HALF_EFFECT_PA = 45_000;
const BOOSTER_RCS_Q_MAX_EFFECT_PA = 130_000;
const BOOSTER_FUEL_COLOR_HEX = 0x6ec8ff;
const BOOSTER_FUEL_EMISSIVE_HEX = 0x1a74bb;

const BOOSTER_PHASE_VISUAL_PROFILE = Object.freeze({
  default: Object.freeze({
    mainScale: 1.0,
    rcsScale: 1.0,
    mainPulseHz: 34,
    rcsPulseHz: 20,
  }),
  separation: Object.freeze({
    mainScale: 0.0,
    rcsScale: 1.44,
    mainPulseHz: 24,
    rcsPulseHz: 30,
  }),
  boostback: Object.freeze({
    mainScale: 1.04,
    rcsScale: 0.75,
    mainPulseHz: 40,
    rcsPulseHz: 16,
  }),
  entry: Object.freeze({
    mainScale: 0.84,
    rcsScale: 0.52,
    mainPulseHz: 30,
    rcsPulseHz: 14,
  }),
  ballistic: Object.freeze({
    mainScale: 0.0,
    rcsScale: 0.94,
    mainPulseHz: 22,
    rcsPulseHz: 22,
  }),
  descent: Object.freeze({
    mainScale: 0.0,
    rcsScale: 0.88,
    mainPulseHz: 22,
    rcsPulseHz: 20,
  }),
  landing: Object.freeze({
    mainScale: 1.12,
    rcsScale: 0.62,
    mainPulseHz: 42,
    rcsPulseHz: 12,
  }),
  landed: Object.freeze({
    mainScale: 0.0,
    rcsScale: 0.0,
    mainPulseHz: 10,
    rcsPulseHz: 10,
  }),
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rad(degrees) {
  return (degrees * Math.PI) / 180;
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

function resolveThrusterDefinitions(THREE, layout, radius, bodyHeight) {
  if (!THREE || !layout || !(radius > 0) || !(bodyHeight > 0)) {
    return [];
  }
  return Object.entries(layout).map(([id, spec]) => {
    const xR = Number(spec?.anchor?.xR) || 0;
    const zR = Number(spec?.anchor?.zR) || 0;
    const rawYH = Number(spec?.anchor?.yH) || 0;
    const yNorm = rawYH >= 0 && rawYH <= 1 ? rawYH - 0.5 : rawYH;
    const direction = new THREE.Vector3(
      Number(spec?.direction?.x) || 0,
      Number(spec?.direction?.y) || 0,
      Number(spec?.direction?.z) || 0,
    );
    return {
      id,
      anchor: new THREE.Vector3(xR * radius, yNorm * bodyHeight, zR * radius),
      direction: direction.lengthSq() > 0 ? direction.normalize() : new THREE.Vector3(0, 1, 0),
    };
  });
}

function addInlineStaticThrusterNozzles(THREE, hostGroup, definitions, radius, material) {
  if (!THREE || !hostGroup || !Array.isArray(definitions) || definitions.length <= 0) {
    return [];
  }
  const yAxis = new THREE.Vector3(0, 1, 0);
  const portLength = clamp(radius * 0.11, radius * 0.04, radius * 0.15);
  const portRadius = clamp(radius * 0.032, radius * 0.012, radius * 0.047);
  const lipThickness = clamp(portLength * 0.17, radius * 0.0024, portLength * 0.24);
  const nozzles = [];
  for (const definition of definitions) {
    if (!definition?.anchor || !definition?.direction) {
      continue;
    }
    const port = new THREE.Mesh(
      new THREE.CylinderGeometry(portRadius * 0.9, portRadius, portLength, 12, 1, true),
      material.clone(),
    );
    port.position.copy(definition.anchor).addScaledVector(definition.direction, -(portLength * 0.46));
    port.quaternion.setFromUnitVectors(yAxis, definition.direction.clone());
    hostGroup.add(port);
    nozzles.push(port);

    const lip = new THREE.Mesh(
      new THREE.CylinderGeometry(portRadius * 1.06, portRadius * 1.06, lipThickness, 12, 1, false),
      material.clone(),
    );
    lip.position.copy(definition.anchor).addScaledVector(definition.direction, -(lipThickness * 0.52));
    lip.quaternion.setFromUnitVectors(yAxis, definition.direction.clone());
    hostGroup.add(lip);
    nozzles.push(lip);
  }
  return nozzles;
}

function makeExpandingCone(THREE, {
  radius,
  length,
  material,
  anchor,
  direction,
  radialSegments = 10,
  renderOrder = 24,
}) {
  const yAxis = new THREE.Vector3(0, 1, 0);
  const dir = direction.clone().normalize();
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(radius, length, radialSegments, 1, true),
    material,
  );
  mesh.quaternion.setFromUnitVectors(yAxis, dir.clone().negate());
  mesh.position.copy(anchor).addScaledVector(dir, length * 0.5);
  mesh.renderOrder = renderOrder;
  return mesh;
}

function createInlineCircularOffsets(count, radius, phaseRadians = 0) {
  const samples = Math.max(1, Number(count) || 1);
  const ringRadius = Math.max(0, Number(radius) || 0);
  const offsets = [];
  for (let i = 0; i < samples; i += 1) {
    const angle = ((i / samples) * Math.PI * 2) + phaseRadians;
    offsets.push({
      x: Math.cos(angle) * ringRadius,
      z: Math.sin(angle) * ringRadius,
    });
  }
  return offsets;
}

function createInlineSuperHeavyEngineOffsets(radius) {
  const safeRadius = Math.max(1e-9, Number(radius) || 1e-9);
  const outerRingRadius = clamp(safeRadius * 0.69, safeRadius * 0.42, safeRadius * 0.74);
  const middleRingRadius = clamp(outerRingRadius * 0.57, safeRadius * 0.22, outerRingRadius * 0.63);
  const innerRingRadius = clamp(outerRingRadius * 0.24, safeRadius * 0.08, outerRingRadius * 0.3);
  return [
    ...createInlineCircularOffsets(20, outerRingRadius, Math.PI / 20),
    ...createInlineCircularOffsets(10, middleRingRadius, Math.PI / 10),
    ...createInlineCircularOffsets(3, innerRingRadius, Math.PI / 6),
  ];
}

function addInlineSuperHeavyBooster(THREE, boosterGroup, stainless, darkSteel, radius, boosterHeight) {
  const boosterBody = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, boosterHeight, 48, 1, false),
    stainless,
  );
  boosterGroup.add(boosterBody);

  const engineSkirtHeight = clamp(boosterHeight * 0.16, radius * 0.8, boosterHeight * 0.22);
  const engineSkirt = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.01, radius * 1.01, engineSkirtHeight, 48, 1, false),
    darkSteel,
  );
  engineSkirt.position.y = (-0.5 * boosterHeight) + (0.5 * engineSkirtHeight);
  boosterGroup.add(engineSkirt);

  const topCap = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.5),
    stainless,
  );
  topCap.position.y = 0.5 * boosterHeight;
  boosterGroup.add(topCap);

  const hotStageBand = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.03, radius * 1.03, clamp(boosterHeight * 0.045, radius * 0.28, boosterHeight * 0.08), 48, 1, false),
    darkSteel,
  );
  hotStageBand.position.y = (0.5 * boosterHeight) + (hotStageBand.geometry.parameters.height * 0.42);
  boosterGroup.add(hotStageBand);

  const ventCount = 20;
  const ventWidth = clamp(radius * 0.052, radius * 0.024, radius * 0.074);
  const ventHeight = clamp(hotStageBand.geometry.parameters.height * 0.46, hotStageBand.geometry.parameters.height * 0.24, hotStageBand.geometry.parameters.height * 0.62);
  const ventDepth = clamp(radius * 0.022, radius * 0.01, radius * 0.034);
  for (let i = 0; i < ventCount; i += 1) {
    const angle = (i / ventCount) * Math.PI * 2;
    const vent = new THREE.Mesh(
      new THREE.BoxGeometry(ventWidth, ventHeight, ventDepth),
      darkSteel,
    );
    vent.position.set(
      Math.cos(angle) * (radius * 1.03),
      hotStageBand.position.y,
      Math.sin(angle) * (radius * 1.03),
    );
    vent.rotation.y = angle;
    boosterGroup.add(vent);
  }

  const seamFractions = [0.12, 0.24, 0.36, 0.5, 0.64, 0.78, 0.9];
  const seamTubeRadius = clamp(radius * 0.0056, radius * 0.0022, radius * 0.009);
  for (const fraction of seamFractions) {
    const seam = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.002, seamTubeRadius, 8, 42),
      darkSteel,
    );
    seam.rotation.x = Math.PI * 0.5;
    seam.position.y = (-0.5 * boosterHeight) + (fraction * boosterHeight);
    boosterGroup.add(seam);
  }

  const stringerCount = 18;
  const stringerHeight = boosterHeight * 0.68;
  const stringerWidth = clamp(radius * 0.018, radius * 0.0075, radius * 0.028);
  const stringerDepth = clamp(radius * 0.008, radius * 0.003, radius * 0.014);
  for (let i = 0; i < stringerCount; i += 1) {
    const angle = (i / stringerCount) * Math.PI * 2;
    const rib = new THREE.Mesh(
      new THREE.BoxGeometry(stringerWidth, stringerHeight, stringerDepth),
      darkSteel,
    );
    rib.position.set(
      Math.cos(angle) * (radius + (stringerDepth * 0.5)),
      (-0.5 * boosterHeight) + (stringerHeight * 0.54),
      Math.sin(angle) * (radius + (stringerDepth * 0.5)),
    );
    rib.rotation.y = angle;
    boosterGroup.add(rib);
  }

  const gridFinWidth = clamp(radius * 1.02, radius * 0.65, radius * 1.24);
  const gridFinHeight = clamp(radius * 0.78, radius * 0.34, radius * 1.02);
  const gridFinDepth = clamp(radius * 0.15, radius * 0.07, radius * 0.24);
  const gridFinY = (0.5 * boosterHeight) - (radius * 0.62);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(gridFinWidth, gridFinHeight, gridFinDepth),
      darkSteel,
    );
    fin.position.set(
      Math.cos(angle) * (radius + (gridFinDepth * 0.4)),
      gridFinY,
      Math.sin(angle) * (radius + (gridFinDepth * 0.4)),
    );
    fin.rotation.y = angle;
    boosterGroup.add(fin);
  }

  const engineOffsets = createInlineSuperHeavyEngineOffsets(radius);
  const bellRadius = clamp(radius * 0.102, radius * 0.054, radius * 0.13);
  const bellHeight = clamp(radius * 0.205, radius * 0.11, radius * 0.27);
  const engineExitY = (-0.5 * boosterHeight) + (bellHeight * 0.04);

  const bellGeom = new THREE.ConeGeometry(bellRadius, bellHeight, 12, 1, true);
  bellGeom.translate(0, bellHeight * 0.5, 0);

  const innerH = bellHeight * 0.28;
  const innerGeom = new THREE.CylinderGeometry(
    bellRadius * 0.42,
    bellRadius * 0.33,
    innerH,
    8,
    1,
    true,
  );
  innerGeom.translate(0, innerH * 0.5, 0);

  for (const offset of engineOffsets) {
    const bell = new THREE.Mesh(bellGeom, darkSteel);
    bell.material.side = THREE.DoubleSide;
    bell.position.set(offset.x, engineExitY, offset.z);
    boosterGroup.add(bell);

    const nozzleInterior = new THREE.Mesh(innerGeom, darkSteel);
    nozzleInterior.material.side = THREE.DoubleSide;
    nozzleInterior.position.set(offset.x, engineExitY + (bellHeight * 0.18), offset.z);
    boosterGroup.add(nozzleInterior);
  }

  return {
    engineOffsets,
    engineExitY,
    bellRadius,
    bellHeight,
  };
}

function addInlineStarshipEngines(THREE, shipGroup, material, radius, shipHeight) {
  const outerRingRadius = clamp(radius * 0.44, radius * 0.16, radius * 0.5);
  const innerRingRadius = clamp(radius * 0.21, radius * 0.08, radius * 0.27);

  const vacR = clamp(radius * 0.165, radius * 0.078, radius * 0.2);
  const vacH = clamp(radius * 0.26, radius * 0.12, radius * 0.31);

  const seaR = clamp(vacR * 0.82, vacR * 0.7, vacR * 0.9);
  const seaH = clamp(vacH * 0.82, vacH * 0.72, vacH * 0.9);

  const engineBaseY = -0.5 * shipHeight;
  const vacExitY = engineBaseY + (vacH * 0.12);
  const seaExitY = engineBaseY + (seaH * 0.14);

  const vacGeom = new THREE.ConeGeometry(vacR, vacH, 14, 1, true);
  vacGeom.translate(0, vacH * 0.5, 0);

  const seaGeom = new THREE.ConeGeometry(seaR, seaH, 14, 1, true);
  seaGeom.translate(0, seaH * 0.5, 0);

  const vacOffsets = [];
  const seaOffsets = [];

  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const x = Math.cos(angle) * outerRingRadius;
    const z = Math.sin(angle) * outerRingRadius;
    const bell = new THREE.Mesh(vacGeom, material);
    bell.material.side = THREE.DoubleSide;
    bell.position.set(x, vacExitY, z);
    shipGroup.add(bell);
    vacOffsets.push({ x, z });
  }

  for (let i = 0; i < 3; i += 1) {
    const angle = ((i / 3) * Math.PI * 2) + (Math.PI / 3);
    const x = Math.cos(angle) * innerRingRadius;
    const z = Math.sin(angle) * innerRingRadius;
    const bell = new THREE.Mesh(seaGeom, material);
    bell.material.side = THREE.DoubleSide;
    bell.position.set(x, seaExitY, z);
    shipGroup.add(bell);
    seaOffsets.push({ x, z });
  }

  return { vacExitY, seaExitY, vacOffsets, seaOffsets };
}

function createInlineEnginePlumeCluster(THREE, stageGroup, options = {}) {
  if (!THREE || !stageGroup) {
    return null;
  }
  const offsets = Array.isArray(options.offsets) && options.offsets.length > 0
    ? options.offsets
    : [{ x: 0, z: 0 }];
  const anchorY = Number(options.anchorY) || 0;
  const plumeLength = Math.max(1e-12, Number(options.plumeLength) || 1e-6);
  const plumeRadius = Math.max(1e-12, Number(options.plumeRadius) || 1e-6);
  const glowRadius = Math.max(plumeRadius * 0.75, Number(options.glowRadius) || plumeRadius * 0.9);
  const radialSegments = Math.max(20, Number(options.radialSegments) || 36);
  const outerColor = new THREE.Color(options.colorHex || BOOSTER_MAIN_ENGINE_PLUME_COLOR_HEX);
  const coreColor = new THREE.Color(0xfff4de);
  const direction = options.direction instanceof THREE.Vector3
    ? options.direction.clone().normalize()
    : new THREE.Vector3(0, -1, 0);

  const cluster = new THREE.Group();
  cluster.visible = false;
  cluster.renderOrder = 24;

  const plumeOuterGeom = new THREE.ConeGeometry(plumeRadius * 1.05, plumeLength * 1.04, radialSegments, 1, true);
  plumeOuterGeom.translate(0, -(plumeLength * 1.04) * 0.5, 0);
  const plumeCoreGeom = new THREE.ConeGeometry(plumeRadius * 0.62, plumeLength * 0.86, radialSegments, 1, true);
  plumeCoreGeom.translate(0, -(plumeLength * 0.86) * 0.5, 0);
  const glowGeom = new THREE.SphereGeometry(glowRadius, 12, 12);
  const negY = new THREE.Vector3(0, -1, 0);
  const plumeQuat = new THREE.Quaternion().setFromUnitVectors(negY, direction);

  const plumeTemplateMaterial = new THREE.MeshBasicMaterial({
    color: outerColor,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const coreTemplateMaterial = new THREE.MeshBasicMaterial({
    color: coreColor,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const glowTemplateMaterial = new THREE.MeshBasicMaterial({
    color: outerColor,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const entries = [];
  for (const offset of offsets) {
    const anchor = new THREE.Vector3(Number(offset?.x) || 0, anchorY, Number(offset?.z) || 0);
    const plumeOuter = new THREE.Mesh(plumeOuterGeom, plumeTemplateMaterial.clone());
    plumeOuter.quaternion.copy(plumeQuat);
    plumeOuter.position.copy(anchor);
    plumeOuter.renderOrder = 24;

    const plumeCore = new THREE.Mesh(plumeCoreGeom, coreTemplateMaterial.clone());
    plumeCore.quaternion.copy(plumeQuat);
    plumeCore.position.copy(anchor);
    plumeCore.renderOrder = 25;

    const glow = new THREE.Mesh(glowGeom, glowTemplateMaterial.clone());
    glow.position.copy(anchor);
    glow.renderOrder = 26;

    cluster.add(plumeOuter);
    cluster.add(plumeCore);
    cluster.add(glow);
    entries.push({
      plume: plumeOuter,
      plumeOuter,
      plumeCore,
      glow,
    });
  }
  stageGroup.add(cluster);
  return {
    cluster,
    entries,
  };
}

function createInlineBoosterRcsJetVisuals(THREE, boosterGroup, radius, boosterHeight) {
  if (!THREE || !boosterGroup || !(radius > 0) || !(boosterHeight > 0)) {
    return null;
  }
  const plumeLength = clamp(boosterHeight * 0.028, radius * 0.18, boosterHeight * 0.062);
  const plumeRadius = clamp(radius * 0.03, radius * 0.012, radius * 0.048);
  const glowRadius = clamp(radius * 0.02, radius * 0.009, radius * 0.036);

  const plumeTemplateMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(BOOSTER_RCS_JET_COLOR_HEX),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const glowTemplateMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(BOOSTER_RCS_JET_COLOR_HEX),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

  const definitions = resolveThrusterDefinitions(
    THREE,
    BOOSTER_THRUSTER_LAYOUT,
    radius,
    boosterHeight,
  );
  addInlineStaticThrusterNozzles(
    THREE,
    boosterGroup,
    definitions,
    radius,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x6a727f),
      roughness: 0.6,
      metalness: 0.52,
    }),
  );

  const jets = {};
  for (const definition of definitions) {
    const group = new THREE.Group();
    group.visible = false;

    const plume = makeExpandingCone(THREE, {
      radius: plumeRadius,
      length: plumeLength,
      material: plumeTemplateMaterial.clone(),
      anchor: definition.anchor,
      direction: definition.direction,
      radialSegments: 10,
      renderOrder: 24,
    });

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(glowRadius, 8, 8),
      glowTemplateMaterial.clone(),
    );
    glow.position.copy(definition.anchor);
    glow.renderOrder = 25;

    group.add(plume);
    group.add(glow);
    boosterGroup.add(group);
    jets[definition.id] = { group, plume, glow };
  }
  return jets;
}

function createInlineBoosterFuelVisual(THREE, boosterGroup, radius, boosterHeight) {
  if (!THREE || !boosterGroup || !(radius > 0) || !(boosterHeight > 0)) {
    return null;
  }
  const tankRadius = clamp(radius * 0.9, radius * 0.62, radius * 0.95);
  const tankHeight = clamp(boosterHeight * 0.86, boosterHeight * 0.68, boosterHeight * 0.9);
  const tankBottomY = (-0.5 * boosterHeight) + (boosterHeight * 0.03);
  const group = new THREE.Group();
  group.visible = false;

  const fluid = new THREE.Mesh(
    new THREE.CylinderGeometry(tankRadius, tankRadius, tankHeight, 32, 1, false),
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(BOOSTER_FUEL_COLOR_HEX),
      emissive: new THREE.Color(BOOSTER_FUEL_EMISSIVE_HEX),
      emissiveIntensity: 0.28,
      transparent: true,
      opacity: 0.34,
      roughness: 0.22,
      metalness: 0.03,
      transmission: 0.2,
      thickness: Math.max(1e-6, tankRadius * 0.3),
      depthWrite: false,
    }),
  );
  fluid.renderOrder = 9;
  group.add(fluid);
  boosterGroup.add(group);

  return {
    group,
    fluid,
    tankHeight,
    tankBottomY,
    minFillScaleY: 0.01,
  };
}

function applyInlineBoosterFuelFill(fuelVisual, fuelFraction) {
  if (!fuelVisual?.fluid) {
    return;
  }
  const level = clamp(Number(fuelFraction), 0, 1);
  const fillScaleY = Math.max(fuelVisual.minFillScaleY || 0.01, level);
  fuelVisual.fluid.scale.set(1, fillScaleY, 1);
  fuelVisual.fluid.position.y = (fuelVisual.tankBottomY || 0) + ((fuelVisual.tankHeight || 0) * fillScaleY * 0.5);
  if (fuelVisual.fluid.material && !Array.isArray(fuelVisual.fluid.material)) {
    fuelVisual.fluid.material.opacity = 0.16 + (level * 0.3);
    fuelVisual.fluid.material.emissiveIntensity = 0.12 + (level * 0.28);
  }
}

function boosterPhaseVisualProfile(phaseRaw) {
  const phase = String(phaseRaw || "").toLowerCase();
  if (!phase) {
    return BOOSTER_PHASE_VISUAL_PROFILE.default;
  }
  if (phase.includes("landed")) {
    return BOOSTER_PHASE_VISUAL_PROFILE.landed;
  }
  if (phase.includes("boostback")) {
    return BOOSTER_PHASE_VISUAL_PROFILE.boostback;
  }
  if (phase.includes("entry")) {
    return BOOSTER_PHASE_VISUAL_PROFILE.entry;
  }
  if (phase.includes("landing")) {
    return BOOSTER_PHASE_VISUAL_PROFILE.landing;
  }
  if (phase.includes("separation")) {
    return BOOSTER_PHASE_VISUAL_PROFILE.separation;
  }
  if (phase.includes("ballistic")) {
    return BOOSTER_PHASE_VISUAL_PROFILE.ballistic;
  }
  if (phase.includes("descent")) {
    return BOOSTER_PHASE_VISUAL_PROFILE.descent;
  }
  return BOOSTER_PHASE_VISUAL_PROFILE.default;
}

function setInlineEnginePlumeVisual(plumeState, firing, throttle = 0, pulse = 1, options = {}) {
  if (Array.isArray(plumeState)) {
    for (const state of plumeState) {
      setInlineEnginePlumeVisual(state, firing, throttle, pulse, options);
    }
    return;
  }
  if (!plumeState?.cluster || !Array.isArray(plumeState.entries)) {
    return;
  }
  const nowMs = Date.now();
  const targetFiring = Boolean(firing);
  const wasTargetFiring = Boolean(plumeState.targetFiring);
  if (!targetFiring && wasTargetFiring) {
    plumeState.shutdownHoldUntilMs = nowMs + 140;
  }
  plumeState.targetFiring = targetFiring;
  const fadeOutHold = Number(plumeState.shutdownHoldUntilMs) > nowMs;
  const visible = targetFiring || fadeOutHold;
  plumeState.cluster.visible = visible;
  if (!visible) {
    plumeState.smoothedThrottle = 0;
    return;
  }
  const targetThrottle = targetFiring ? clamp(Number(throttle) || 0, 0, 1) : 0;
  const previousThrottle = Number.isFinite(plumeState.smoothedThrottle)
    ? plumeState.smoothedThrottle
    : targetThrottle;
  const smoothing = targetFiring ? 0.22 : 0.1;
  const t = clamp(previousThrottle + ((targetThrottle - previousThrottle) * smoothing), 0, 1);
  plumeState.smoothedThrottle = t;
  const phaseScale = clamp(Number(options.phaseScale) || 1, 0, 1.5);
  const pressurePa = Math.max(0, Number(options.pressurePa) || 0);
  const pressureRatio = clamp(pressurePa / BOOSTER_SEA_LEVEL_PRESSURE_PA, 0, 1);
  const vacuumExpansion = clamp(1 - pressureRatio, 0, 1);
  const expansionScale = 0.82 + (vacuumExpansion * 0.68);
  const brightnessScale = (0.86 + (vacuumExpansion * 0.14)) * phaseScale;
  const plumeOpacity = (0.34 + (t * 0.56)) * pulse * brightnessScale;
  const glowOpacity = (0.42 + (t * 0.52)) * pulse * brightnessScale;
  const stretch = (0.82 + (t * 2.1)) * expansionScale;
  const radiusScale = (0.9 + (t * 0.5)) * (0.92 + (vacuumExpansion * 0.34));
  const glowScale = (0.94 + (t * 0.76)) * (0.92 + (vacuumExpansion * 0.25));
  const nowSec = Date.now() / 1000;
  for (let index = 0; index < plumeState.entries.length; index += 1) {
    const entry = plumeState.entries[index];
    if (!entry) {
      continue;
    }
    const turbulence = 0.975 + (0.045 * Math.sin((nowSec * 8.0) + (index * 1.53)));
    const flicker = 0.992 + (0.016 * Math.sin((nowSec * 3.4) + (index * 2.11)));
    if (entry.plumeOuter?.scale) {
      entry.plumeOuter.scale.set(
        radiusScale * BOOSTER_MAIN_PLUME_SIZE_SCALE,
        stretch * BOOSTER_MAIN_PLUME_SIZE_SCALE * turbulence,
        radiusScale * BOOSTER_MAIN_PLUME_SIZE_SCALE,
      );
    }
    if (entry.plumeOuter?.material && !Array.isArray(entry.plumeOuter.material)) {
      entry.plumeOuter.material.opacity = clamp(
        plumeOpacity * BOOSTER_MAIN_PLUME_BRIGHTNESS_SCALE * 0.78 * flicker,
        0,
        1,
      );
    }
    if (entry.plumeCore?.scale) {
      entry.plumeCore.scale.set(
        radiusScale * BOOSTER_MAIN_PLUME_SIZE_SCALE * 0.62,
        stretch * BOOSTER_MAIN_PLUME_SIZE_SCALE * turbulence * 0.9,
        radiusScale * BOOSTER_MAIN_PLUME_SIZE_SCALE * 0.62,
      );
    }
    if (entry.plumeCore?.material && !Array.isArray(entry.plumeCore.material)) {
      entry.plumeCore.material.opacity = clamp(
        plumeOpacity * BOOSTER_MAIN_PLUME_BRIGHTNESS_SCALE * 1.05 * flicker,
        0,
        1,
      );
    }
    if (entry.glow?.scale) {
      entry.glow.scale.set(
        glowScale * BOOSTER_MAIN_PLUME_SIZE_SCALE,
        glowScale * BOOSTER_MAIN_PLUME_SIZE_SCALE,
        glowScale * BOOSTER_MAIN_PLUME_SIZE_SCALE,
      );
    }
    if (entry.glow?.material && !Array.isArray(entry.glow.material)) {
      entry.glow.material.opacity = clamp(
        glowOpacity * BOOSTER_MAIN_PLUME_BRIGHTNESS_SCALE * 0.95 * flicker,
        0,
        1,
      );
    }
  }
}

function updateInlineBoosterRcsJetVisuals(boosterState, snapshot, phaseProfile = BOOSTER_PHASE_VISUAL_PROFILE.default) {
  const jets = boosterState?.rcsJets;
  if (!jets) {
    return;
  }
  const requestedJets = Array.isArray(snapshot?.boosterRcsJets) ? snapshot.boosterRcsJets : [];
  const requestedJetSet = new Set(requestedJets.map((jet) => String(jet || "").toLowerCase()));
  const active = Boolean(snapshot?.boosterRcsActive) && requestedJetSet.size > 0;
  const authorityRaw = clamp(Number(snapshot?.boosterRcsAuthority) || 0, 0, 1);
  const dynamicPressurePa = Math.max(0, Number(snapshot?.boosterDynamicPressurePa) || 0);
  const qBlend = clamp(
    (dynamicPressurePa - BOOSTER_RCS_Q_HALF_EFFECT_PA)
      / Math.max(BOOSTER_RCS_Q_MAX_EFFECT_PA - BOOSTER_RCS_Q_HALF_EFFECT_PA, 1),
    0,
    1,
  );
  const dynamicSuppression = 1 - (0.62 * qBlend);
  const authority = clamp(authorityRaw * dynamicSuppression * (Number(phaseProfile?.rcsScale) || 1), 0, 1);
  const pulseHz = Math.max(6, Number(phaseProfile?.rcsPulseHz) || 20);
  const pulse = 0.86 + (0.14 * Math.sin((Date.now() / 1000) * pulseHz));
  const opacity = (0.16 + (authority * 0.48)) * pulse;
  const stretch = 0.7 + (authority * 0.92);
  const radiusScale = 0.8 + (authority * 0.6);
  const glowScale = 0.78 + (authority * 1.04);

  for (const [jetName, entry] of Object.entries(jets)) {
    if (!entry) {
      continue;
    }
    const firing = active && requestedJetSet.has(jetName) && authority > 0.01;
    entry.group.visible = firing;
    if (!firing) {
      continue;
    }
    if (entry.plume?.scale) {
      entry.plume.scale.set(radiusScale, stretch, radiusScale);
    }
    if (entry.plume?.material && !Array.isArray(entry.plume.material)) {
      entry.plume.material.opacity = opacity;
    }
    if (entry.glow?.scale) {
      entry.glow.scale.set(glowScale, glowScale, glowScale);
    }
    if (entry.glow?.material && !Array.isArray(entry.glow.material)) {
      entry.glow.material.opacity = opacity * 0.92;
    }
  }
}

export function applyInlineBoosterManeuverVisuals(boosterState, snapshot = null) {
  if (!boosterState) {
    return;
  }
  if (!snapshot) {
    setInlineEnginePlumeVisual(boosterState.mainEnginePlume, false, 0, 1);
    updateInlineBoosterRcsJetVisuals(boosterState, null);
    return;
  }
  const phase = String(snapshot.boosterPhase || "").toLowerCase();
  const phaseProfile = boosterPhaseVisualProfile(phase);
  const throttle = clamp(Number(snapshot.boosterThrottle) || 0, 0, 1);
  const thrustN = Math.max(0, Number(snapshot.boosterThrustN) || 0);
  const mainScale = clamp(Number(phaseProfile?.mainScale) || 0, 0, 1.5);
  const effectiveThrottle = clamp(throttle * mainScale, 0, 1);
  const firing = thrustN > 0.01 && effectiveThrottle > 0.01 && mainScale > 0.01;
  const pulse = 1;
  setInlineEnginePlumeVisual(
    boosterState.mainEnginePlume,
    firing,
    effectiveThrottle,
    pulse,
    {
      pressurePa: Number(snapshot.boosterPressurePa) || 0,
      phaseScale: mainScale,
    },
  );
  updateInlineBoosterRcsJetVisuals(boosterState, snapshot, phaseProfile);
}

export function applyInlineBoosterFuelVisuals(boosterState, options = null) {
  const fuelVisual = boosterState?.boosterFuelVisual;
  if (!fuelVisual?.group) {
    return;
  }
  const enabled = Boolean(options?.enabled);
  fuelVisual.group.visible = enabled;
  if (!enabled) {
    return;
  }
  const level = Number.isFinite(Number(options?.fuelFraction))
    ? Number(options.fuelFraction)
    : 1;
  applyInlineBoosterFuelFill(fuelVisual, level);
}

export function createInlineStarshipStackVisual(THREE, distanceScale) {
  const dims = INLINE_STARSHIP_STACK_DIMENSIONS_KM;
  const radius = dims.diameterKm * 0.5 * distanceScale;
  const boosterHeight = dims.boosterHeightKm * distanceScale;
  const shipHeight = dims.shipHeightKm * distanceScale;
  const noseHeight = Math.min(dims.shipNoseHeightKm * distanceScale, shipHeight * 0.65);
  const shipBodyHeight = Math.max(shipHeight - noseHeight, shipHeight * 0.2);
  const totalHeight = INLINE_STARSHIP_STACK_TOTAL_HEIGHT_KM * distanceScale;
  const baseY = -0.5 * totalHeight;

  const stainless = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xcfd8e5),
    roughness: 0.38,
    metalness: 0.82,
  });
  enforceSolidOpaqueMaterial(THREE, stainless);
  const darkSteel = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x1b212b),
    roughness: 0.56,
    metalness: 0.62,
  });
  enforceSolidOpaqueMaterial(THREE, darkSteel);

  const root = new THREE.Group();
  const boosterGroup = new THREE.Group();
  const shipGroup = new THREE.Group();
  const fullShipCenterY = baseY + boosterHeight + (0.5 * shipHeight);
  const detachedShipCenterY = 0;
  boosterGroup.position.y = baseY + (0.5 * boosterHeight);
  shipGroup.position.y = fullShipCenterY;
  root.add(boosterGroup);
  root.add(shipGroup);

  const boosterVisual = addInlineSuperHeavyBooster(
    THREE,
    boosterGroup,
    stainless,
    darkSteel,
    radius,
    boosterHeight,
  );
  const boosterFuelVisual = createInlineBoosterFuelVisual(THREE, boosterGroup, radius, boosterHeight);

  const shipBody = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, shipBodyHeight, 32, 1, false),
    stainless,
  );
  shipBody.position.y = (-0.5 * shipHeight) + (0.5 * shipBodyHeight);
  shipGroup.add(shipBody);

  const shipNose = new THREE.Mesh(
    new THREE.ConeGeometry(radius, noseHeight, 28, 1, false),
    stainless,
  );
  shipNose.position.y = (-0.5 * shipHeight) + shipBodyHeight + (0.5 * noseHeight);
  shipGroup.add(shipNose);

  const tileBand = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.003, radius * 1.003, shipBodyHeight * 0.95, 28, 1, false),
    darkSteel,
  );
  tileBand.position.y = shipBody.position.y;
  tileBand.scale.set(1.001, 1, 0.56);
  tileBand.rotation.y = Math.PI * 0.5;
  shipGroup.add(tileBand);

  const starshipThrusterDefinitions = resolveThrusterDefinitions(
    THREE,
    STARSHIP_THRUSTER_LAYOUT,
    radius,
    shipHeight,
  );
  addInlineStaticThrusterNozzles(
    THREE,
    shipGroup,
    starshipThrusterDefinitions,
    radius,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x6f7888),
      roughness: 0.58,
      metalness: 0.54,
    }),
  );

  const shipEngines = addInlineStarshipEngines(THREE, shipGroup, darkSteel, radius, shipHeight);

  const boosterMainEnginePlume = createInlineEnginePlumeCluster(THREE, boosterGroup, {
    offsets: boosterVisual?.engineOffsets || [],
    anchorY: Number(boosterVisual?.engineExitY) || (-0.5 * boosterHeight),
    plumeLength: clamp(boosterHeight * 0.058, radius * 0.2, boosterHeight * 0.12),
    plumeRadius: clamp(radius * 0.056, radius * 0.022, radius * 0.088),
    glowRadius: clamp(radius * 0.042, radius * 0.018, radius * 0.064),
    colorHex: BOOSTER_MAIN_ENGINE_PLUME_COLOR_HEX,
  });

  const shipMainEnginePlume = [
    createInlineEnginePlumeCluster(THREE, shipGroup, {
      offsets: shipEngines.vacOffsets,
      anchorY: shipEngines.vacExitY,
      plumeLength: clamp(shipHeight * 0.16, radius * 0.5, shipHeight * 0.28),
      plumeRadius: clamp(radius * 0.13, radius * 0.06, radius * 0.18),
      glowRadius: clamp(radius * 0.1, radius * 0.05, radius * 0.14),
      colorHex: BOOSTER_MAIN_ENGINE_PLUME_COLOR_HEX,
    }),
    createInlineEnginePlumeCluster(THREE, shipGroup, {
      offsets: shipEngines.seaOffsets,
      anchorY: shipEngines.seaExitY,
      plumeLength: clamp(shipHeight * 0.12, radius * 0.38, shipHeight * 0.22),
      plumeRadius: clamp(radius * 0.1, radius * 0.045, radius * 0.15),
      glowRadius: clamp(radius * 0.085, radius * 0.04, radius * 0.12),
      colorHex: BOOSTER_MAIN_ENGINE_PLUME_COLOR_HEX,
    }),
  ];

  root.userData.starshipAssetSource = "inline_procedural_starship_stack";
  root.userData.starshipTextureResolution = "procedural";

  return {
    root,
    materials: [stainless, darkSteel],
    state: {
      boosterGroup,
      shipGroup,
      fullShipCenterY,
      detachedShipCenterY,
      boosterFuelVisual,
      rcsJets: null,
      mainEnginePlumes: {
        booster: boosterMainEnginePlume,
        ship: shipMainEnginePlume,
      },
    },
    physical: {
      radiusScene: inlineStarshipPhysicalRenderRadiusScene(distanceScale),
    },
  };
}

export function createInlineBoosterVisual(THREE, distanceScale) {
  const dims = INLINE_STARSHIP_STACK_DIMENSIONS_KM;
  const radius = dims.diameterKm * 0.5 * distanceScale;
  const boosterHeight = dims.boosterHeightKm * distanceScale;

  const stainless = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xc7d0dd),
    roughness: 0.4,
    metalness: 0.82,
  });
  enforceSolidOpaqueMaterial(THREE, stainless);
  const darkSteel = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x1d222d),
    roughness: 0.58,
    metalness: 0.6,
  });
  enforceSolidOpaqueMaterial(THREE, darkSteel);

  const root = new THREE.Group();
  const boosterGroup = new THREE.Group();
  root.add(boosterGroup);

  const boosterVisual = addInlineSuperHeavyBooster(
    THREE,
    boosterGroup,
    stainless,
    darkSteel,
    radius,
    boosterHeight,
  );
  const mainEnginePlume = createInlineEnginePlumeCluster(THREE, boosterGroup, {
    offsets: boosterVisual?.engineOffsets || [],
    anchorY: Number(boosterVisual?.engineExitY) || (-0.5 * boosterHeight),
    plumeLength: clamp(boosterHeight * 0.058, radius * 0.2, boosterHeight * 0.12),
    plumeRadius: clamp(radius * 0.056, radius * 0.022, radius * 0.088),
    glowRadius: clamp(radius * 0.042, radius * 0.018, radius * 0.064),
    colorHex: BOOSTER_MAIN_ENGINE_PLUME_COLOR_HEX,
  });
  const rcsJets = createInlineBoosterRcsJetVisuals(THREE, boosterGroup, radius, boosterHeight);
  const boosterFuelVisual = createInlineBoosterFuelVisual(THREE, boosterGroup, radius, boosterHeight);

  return {
    root,
    materials: [stainless, darkSteel],
    state: {
      boosterGroup,
      mainEnginePlume,
      rcsJets,
      boosterFuelVisual,
    },
    physical: {
      radiusScene: Math.max(radius, boosterHeight * 0.5),
    },
  };
}

export function applyInlineStarshipVisualStage(stageState, stageIndex, snapshot = null) {
  if (!stageState?.shipGroup) {
    return;
  }
  const stageTwoActive = Number.isFinite(stageIndex) && stageIndex >= 1;
  const detached = snapshot && Object.prototype.hasOwnProperty.call(snapshot, "boosterActive")
    ? Boolean(snapshot.boosterActive)
    : stageTwoActive;
  if (stageState.boosterGroup) {
    stageState.boosterGroup.visible = !detached;
  }
  if (
    Number.isFinite(stageState.detachedShipCenterY)
    && Number.isFinite(stageState.fullShipCenterY)
  ) {
    stageState.shipGroup.position.y = detached
      ? stageState.detachedShipCenterY
      : stageState.fullShipCenterY;
  }

  const plumes = stageState?.mainEnginePlumes;
  if (!plumes) {
    return;
  }

  if (!snapshot) {
    setInlineEnginePlumeVisual(plumes.booster, false, 0, 1);
    setInlineEnginePlumeVisual(plumes.ship, false, 0, 1);
    return;
  }

  const phase = String(snapshot?.phase || "").toLowerCase();
  const thrustN = Math.max(0, Number(snapshot?.thrustN) || 0);
  const throttle = clamp(Number(snapshot?.throttle) || 0, 0, 1);
  const powered = phase === "powered" && thrustN > 0.01;
  const pulse = 1;

  setInlineEnginePlumeVisual(plumes.booster, powered && !stageTwoActive, throttle, pulse);
  setInlineEnginePlumeVisual(plumes.ship, powered && stageTwoActive, throttle, pulse);
}

export function inlineStarshipPhysicalRenderRadiusScene(distanceScale) {
  return INLINE_STARSHIP_STACK_TOTAL_HEIGHT_KM * 0.5 * distanceScale;
}
