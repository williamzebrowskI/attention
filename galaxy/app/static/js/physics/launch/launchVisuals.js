import {
  STARSHIP_STACK_DIMENSIONS_KM,
  STARSHIP_STACK_TOTAL_HEIGHT_KM,
} from "./launchConfig.js";
import {
  BOOSTER_THRUSTER_LAYOUT,
  STARSHIP_THRUSTER_LAYOUT,
} from "./thrusterLayout.js";

const STARSHIP_RCS_JET_COLOR = 0xaed7ff;
const STARSHIP_MAIN_ENGINE_PLUME_COLOR = 0xffe0b0;
const MAIN_ENGINE_PLUME_SIZE_SCALE = 0.25;
const MAIN_ENGINE_PLUME_BRIGHTNESS_SCALE = 0.25;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function kmToScene(kmValue, distanceScale) {
  return kmValue * distanceScale;
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
  material.side = THREE.DoubleSide;
  material.needsUpdate = true;
  return material;
}

function resolveThrusterDefinitions(THREE, layout, radius, bodyHeight) {
  if (!THREE || !layout || !(radius > 0) || !(bodyHeight > 0)) {
    return [];
  }
  return Object.entries(layout).map(([id, spec]) => ({
    id,
    anchor: new THREE.Vector3(
      (Number(spec?.anchor?.xR) || 0) * radius,
      (Number(spec?.anchor?.yH) || 0) * bodyHeight,
      (Number(spec?.anchor?.zR) || 0) * radius,
    ),
    direction: new THREE.Vector3(
      Number(spec?.direction?.x) || 0,
      Number(spec?.direction?.y) || 0,
      Number(spec?.direction?.z) || 0,
    ).normalize(),
  }));
}

function addStaticThrusterNozzles(THREE, hostGroup, definitions, radius, material) {
  if (!THREE || !hostGroup || !Array.isArray(definitions) || definitions.length <= 0) {
    return [];
  }
  const yAxis = new THREE.Vector3(0, 1, 0);
  const portLength = clamp(radius * 0.1, radius * 0.04, radius * 0.14);
  const portRadius = clamp(radius * 0.03, radius * 0.012, radius * 0.045);
  const lipThickness = clamp(portLength * 0.16, radius * 0.0022, portLength * 0.24);
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

function createRcsJetVisuals(THREE, shipGroup, radius, shipHeight) {
  if (!THREE || !shipGroup || !(radius > 0) || !(shipHeight > 0)) {
    return null;
  }
  const plumeLength = clamp(shipHeight * 0.018, radius * 0.14, shipHeight * 0.038);
  const plumeRadius = clamp(radius * 0.024, radius * 0.01, radius * 0.04);
  const nozzleGlowRadius = clamp(radius * 0.016, radius * 0.007, radius * 0.03);
  const yAxis = new THREE.Vector3(0, 1, 0);

  const plumeMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(STARSHIP_RCS_JET_COLOR),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(STARSHIP_RCS_JET_COLOR),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

  const jets = {};
  const definitions = resolveThrusterDefinitions(
    THREE,
    STARSHIP_THRUSTER_LAYOUT,
    radius,
    shipHeight,
  );
  addStaticThrusterNozzles(
    THREE,
    shipGroup,
    definitions,
    radius,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x6e7786),
      roughness: 0.58,
      metalness: 0.56,
    }),
  );

  for (const definition of definitions) {
    const group = new THREE.Group();

    const plume = new THREE.Mesh(
      new THREE.ConeGeometry(plumeRadius, plumeLength, 10, 1, true),
      plumeMaterial.clone(),
    );
    plume.position.copy(definition.anchor).addScaledVector(definition.direction, plumeLength * 0.38);
    plume.quaternion.setFromUnitVectors(yAxis, definition.direction.clone().normalize());
    plume.renderOrder = 24;

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(nozzleGlowRadius, 8, 8),
      glowMaterial.clone(),
    );
    glow.position.copy(definition.anchor);
    glow.renderOrder = 25;

    group.visible = false;
    group.add(plume);
    group.add(glow);
    shipGroup.add(group);
    jets[definition.id] = {
      group,
      plume,
      glow,
      basePlumeLength: plumeLength,
      basePlumeRadius: plumeRadius,
      baseGlowRadius: nozzleGlowRadius,
    };
  }
  return jets;
}

function createMainEnginePlumeCluster(THREE, stageGroup, options = {}) {
  if (!THREE || !stageGroup) {
    return null;
  }
  const explicitOffsets = Array.isArray(options.offsets)
    ? options.offsets
      .map((entry) => ({
        x: Number(entry?.x) || 0,
        z: Number(entry?.z) || 0,
      }))
      .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.z))
    : null;
  const engineCount = explicitOffsets?.length || Math.max(1, Number(options.engineCount) || 1);
  const anchorY = Number(options.anchorY) || 0;
  const ringRadius = Math.max(0, Number(options.ringRadius) || 0);
  const basePlumeLength = Math.max(1e-12, Number(options.plumeLength) || 1e-6);
  const basePlumeRadius = Math.max(1e-12, Number(options.plumeRadius) || 1e-6);
  const baseGlowRadius = Math.max(basePlumeRadius * 0.75, Number(options.glowRadius) || basePlumeRadius * 0.9);

  const cluster = new THREE.Group();
  cluster.visible = false;
  cluster.renderOrder = 24;

  const plumeTemplateMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(STARSHIP_MAIN_ENGINE_PLUME_COLOR),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const glowTemplateMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(STARSHIP_MAIN_ENGINE_PLUME_COLOR),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

  const entries = [];
  for (let i = 0; i < engineCount; i += 1) {
    let offsetX = 0;
    let offsetZ = 0;
    if (explicitOffsets?.length) {
      offsetX = explicitOffsets[i].x;
      offsetZ = explicitOffsets[i].z;
    } else {
      const angle = (i / engineCount) * Math.PI * 2;
      offsetX = engineCount > 1 ? Math.cos(angle) * ringRadius : 0;
      offsetZ = engineCount > 1 ? Math.sin(angle) * ringRadius : 0;
    }

    const plume = new THREE.Mesh(
      new THREE.ConeGeometry(basePlumeRadius, basePlumeLength, 10, 1, true),
      plumeTemplateMaterial.clone(),
    );
    plume.rotation.x = Math.PI;
    plume.position.set(offsetX, anchorY - (basePlumeLength * 0.38), offsetZ);
    plume.renderOrder = 24;

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(baseGlowRadius, 10, 10),
      glowTemplateMaterial.clone(),
    );
    glow.position.set(offsetX, anchorY, offsetZ);
    glow.renderOrder = 25;

    cluster.add(plume);
    cluster.add(glow);
    entries.push({ plume, glow });
  }
  stageGroup.add(cluster);
  return {
    cluster,
    entries,
    basePlumeLength,
    basePlumeRadius,
    baseGlowRadius,
  };
}

function addShipEngineCluster(THREE, shipGroup, material, radius, shipHeight) {
  if (!THREE || !shipGroup || !material || !(radius > 0) || !(shipHeight > 0)) {
    return [];
  }
  const outerBellRadius = clamp(radius * 0.165, radius * 0.078, radius * 0.2);
  const outerBellHeight = clamp(radius * 0.26, radius * 0.12, radius * 0.31);
  const innerBellRadius = clamp(outerBellRadius * 0.82, outerBellRadius * 0.7, outerBellRadius * 0.9);
  const innerBellHeight = clamp(outerBellHeight * 0.82, outerBellHeight * 0.72, outerBellHeight * 0.9);
  const outerRingRadius = clamp(radius * 0.44, radius * 0.16, radius * 0.5);
  const innerRingRadius = clamp(radius * 0.21, radius * 0.08, radius * 0.27);
  const engineY = -0.5 * shipHeight;
  const engineMeshes = [];

  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const bell = new THREE.Mesh(
      new THREE.ConeGeometry(outerBellRadius, outerBellHeight, 18, 1, true),
      material.clone(),
    );
    bell.position.set(
      Math.cos(angle) * outerRingRadius,
      engineY - (outerBellHeight * 0.38),
      Math.sin(angle) * outerRingRadius,
    );
    bell.rotation.x = Math.PI;
    shipGroup.add(bell);
    engineMeshes.push(bell);
  }

  for (let i = 0; i < 3; i += 1) {
    const angle = ((i / 3) * Math.PI * 2) + (Math.PI / 3);
    const bell = new THREE.Mesh(
      new THREE.ConeGeometry(innerBellRadius, innerBellHeight, 16, 1, true),
      material.clone(),
    );
    bell.position.set(
      Math.cos(angle) * innerRingRadius,
      engineY - (innerBellHeight * 0.36),
      Math.sin(angle) * innerRingRadius,
    );
    bell.rotation.x = Math.PI;
    shipGroup.add(bell);
    engineMeshes.push(bell);
  }

  const thrustPuckHeight = clamp(radius * 0.2, radius * 0.08, radius * 0.24);
  const thrustPuck = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.64, radius * 0.7, thrustPuckHeight, 24, 1, false),
    material.clone(),
  );
  thrustPuck.position.y = engineY + (thrustPuckHeight * 0.28);
  shipGroup.add(thrustPuck);
  engineMeshes.push(thrustPuck);
  return engineMeshes;
}

function createCircularOffsets(count, ringRadius, phaseRadians = 0) {
  const samples = Math.max(1, Number(count) || 1);
  const radius = Math.max(0, Number(ringRadius) || 0);
  const offsets = [];
  for (let i = 0; i < samples; i += 1) {
    const angle = ((i / samples) * Math.PI * 2) + phaseRadians;
    offsets.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
    });
  }
  return offsets;
}

function createSuperHeavyEngineOffsets(radius) {
  const safeRadius = Math.max(1e-9, Number(radius) || 1e-9);
  const outerRingRadius = clamp(safeRadius * 0.69, safeRadius * 0.42, safeRadius * 0.74);
  const midRingRadius = clamp(outerRingRadius * 0.57, safeRadius * 0.22, outerRingRadius * 0.63);
  const coreRingRadius = clamp(outerRingRadius * 0.24, safeRadius * 0.08, outerRingRadius * 0.3);
  return {
    outerRingRadius,
    offsets: [
      ...createCircularOffsets(20, outerRingRadius, Math.PI / 20),
      ...createCircularOffsets(10, midRingRadius, Math.PI / 10),
      ...createCircularOffsets(3, coreRingRadius, Math.PI / 6),
    ],
  };
}

function addSuperHeavyBoosterVisuals(THREE, boosterGroup, stainless, darkSteel, radius, boosterHeight) {
  const boosterBody = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, boosterHeight, 64, 1, false),
    stainless,
  );
  boosterGroup.add(boosterBody);

  const engineSkirtHeight = clamp(boosterHeight * 0.16, radius * 0.8, boosterHeight * 0.22);
  const engineSkirt = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.01, radius * 1.01, engineSkirtHeight, 64, 1, false),
    darkSteel,
  );
  engineSkirt.position.y = (-0.5 * boosterHeight) + (0.5 * engineSkirtHeight);
  boosterGroup.add(engineSkirt);

  const thrustPuckHeight = clamp(boosterHeight * 0.028, radius * 0.12, boosterHeight * 0.055);
  const thrustPuck = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.84, radius * 0.8, thrustPuckHeight, 48, 1, false),
    darkSteel,
  );
  thrustPuck.position.y = (-0.5 * boosterHeight) + (thrustPuckHeight * 0.5);
  boosterGroup.add(thrustPuck);

  const boosterTopCap = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.5),
    stainless,
  );
  boosterTopCap.position.y = 0.5 * boosterHeight;
  boosterGroup.add(boosterTopCap);

  const hotStageBandHeight = clamp(boosterHeight * 0.045, radius * 0.28, boosterHeight * 0.08);
  const hotStageBand = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.035, radius * 1.035, hotStageBandHeight, 64, 1, true),
    darkSteel,
  );
  hotStageBand.position.y = (0.5 * boosterHeight) + (hotStageBandHeight * 0.42);
  boosterGroup.add(hotStageBand);

  const ventCount = 24;
  const ventWidth = clamp(radius * 0.06, radius * 0.03, radius * 0.08);
  const ventHeight = clamp(hotStageBandHeight * 0.42, hotStageBandHeight * 0.25, hotStageBandHeight * 0.58);
  const ventDepth = clamp(radius * 0.025, radius * 0.012, radius * 0.035);
  for (let i = 0; i < ventCount; i += 1) {
    const angle = (i / ventCount) * Math.PI * 2;
    const vent = new THREE.Mesh(
      new THREE.BoxGeometry(ventWidth, ventHeight, ventDepth),
      darkSteel,
    );
    vent.position.set(
      Math.cos(angle) * (radius * 1.035),
      hotStageBand.position.y,
      Math.sin(angle) * (radius * 1.035),
    );
    vent.rotation.y = angle;
    boosterGroup.add(vent);
  }

  const seamFractions = [0.11, 0.24, 0.36, 0.49, 0.61, 0.74, 0.86];
  const seamTubeRadius = clamp(radius * 0.006, radius * 0.0025, radius * 0.01);
  for (const fraction of seamFractions) {
    const seam = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.003, seamTubeRadius, 10, 64),
      darkSteel,
    );
    seam.rotation.x = Math.PI * 0.5;
    seam.position.y = (-0.5 * boosterHeight) + (fraction * boosterHeight);
    boosterGroup.add(seam);
  }

  const stringerCount = 24;
  const stringerHeight = boosterHeight * 0.68;
  const stringerWidth = clamp(radius * 0.02, radius * 0.009, radius * 0.03);
  const stringerDepth = clamp(radius * 0.01, radius * 0.0045, radius * 0.017);
  for (let i = 0; i < stringerCount; i += 1) {
    const angle = (i / stringerCount) * Math.PI * 2;
    const rib = new THREE.Mesh(
      new THREE.BoxGeometry(stringerWidth, stringerHeight, stringerDepth),
      darkSteel,
    );
    rib.position.set(
      Math.cos(angle) * (radius + (stringerDepth * 0.5)),
      (-0.5 * boosterHeight) + (stringerHeight * 0.55),
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
    const finAssembly = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(gridFinWidth, gridFinHeight, gridFinDepth),
      darkSteel,
    );
    finAssembly.add(frame);

    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(gridFinWidth * 0.84, gridFinHeight * 0.82, gridFinDepth * 0.62),
      darkSteel,
    );
    panel.material = darkSteel.clone();
    enforceSolidOpaqueMaterial(THREE, panel.material);
    finAssembly.add(panel);

    const latticeBarWidth = gridFinWidth * 0.03;
    const latticeBarHeight = gridFinHeight * 0.86;
    const latticeBarDepth = gridFinDepth * 0.68;
    for (let barIndex = -2; barIndex <= 2; barIndex += 1) {
      const verticalBar = new THREE.Mesh(
        new THREE.BoxGeometry(latticeBarWidth, latticeBarHeight, latticeBarDepth),
        darkSteel,
      );
      verticalBar.position.x = barIndex * (gridFinWidth * 0.14);
      finAssembly.add(verticalBar);
    }
    const crossBarWidth = gridFinWidth * 0.84;
    const crossBarHeight = gridFinHeight * 0.03;
    for (let barIndex = -1; barIndex <= 1; barIndex += 1) {
      const horizontalBar = new THREE.Mesh(
        new THREE.BoxGeometry(crossBarWidth, crossBarHeight, latticeBarDepth),
        darkSteel,
      );
      horizontalBar.position.y = barIndex * (gridFinHeight * 0.2);
      finAssembly.add(horizontalBar);
    }

    finAssembly.position.set(
      Math.cos(angle) * (radius + (gridFinDepth * 0.45)),
      gridFinY,
      Math.sin(angle) * (radius + (gridFinDepth * 0.45)),
    );
    finAssembly.rotation.y = angle;
    boosterGroup.add(finAssembly);
  }

  const engineLayout = createSuperHeavyEngineOffsets(radius);
  const engineBellRadius = clamp(radius * 0.102, radius * 0.054, radius * 0.13);
  const engineBellHeight = clamp(radius * 0.205, radius * 0.11, radius * 0.27);
  const engineY = -0.5 * boosterHeight - (engineBellHeight * 0.46);

  for (const offset of engineLayout.offsets) {
    const bell = new THREE.Mesh(
      new THREE.ConeGeometry(engineBellRadius, engineBellHeight, 14, 1, true),
      darkSteel,
    );
    bell.position.set(offset.x, engineY, offset.z);
    bell.rotation.x = Math.PI;
    boosterGroup.add(bell);

    const nozzleInterior = new THREE.Mesh(
      new THREE.CylinderGeometry(
        engineBellRadius * 0.4,
        engineBellRadius * 0.33,
        engineBellHeight * 0.28,
        10,
        1,
        true,
      ),
      darkSteel,
    );
    nozzleInterior.rotation.x = Math.PI;
    nozzleInterior.position.set(offset.x, engineY - (engineBellHeight * 0.22), offset.z);
    boosterGroup.add(nozzleInterior);
  }

  const boosterThrusterDefinitions = resolveThrusterDefinitions(
    THREE,
    BOOSTER_THRUSTER_LAYOUT,
    radius,
    boosterHeight,
  );
  addStaticThrusterNozzles(
    THREE,
    boosterGroup,
    boosterThrusterDefinitions,
    radius,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x6a727f),
      roughness: 0.6,
      metalness: 0.52,
    }),
  );

  return {
    engineOffsets: engineLayout.offsets,
    plumeAnchorY: -0.5 * boosterHeight - (engineBellHeight * 0.5),
    plumeRingRadius: engineLayout.outerRingRadius,
  };
}

function seededNoise(x, y, seed) {
  const value = Math.sin((x * 12.9898) + (y * 78.233) + (seed * 37.719)) * 43758.5453123;
  return value - Math.floor(value);
}

function createCanvasTexture(THREE, width, height, drawFn, options = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  drawFn(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  if (options.srgb) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  texture.wrapS = options.wrapS || THREE.RepeatWrapping;
  texture.wrapT = options.wrapT || THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createStarshipMetalTextureSet(THREE) {
  const map = createCanvasTexture(
    THREE,
    2048,
    2048,
    (ctx, width, height) => {
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "#aeb8c6");
      gradient.addColorStop(0.16, "#d9e0ea");
      gradient.addColorStop(0.52, "#9eaab9");
      gradient.addColorStop(0.82, "#d5dde8");
      gradient.addColorStop(1, "#a7b3c2");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < 4200; i += 1) {
        const x = Math.floor(seededNoise(i, 1, 3) * width);
        const alpha = 0.02 + (seededNoise(i, 2, 7) * 0.1);
        const lineWidth = 1 + Math.floor(seededNoise(i, 3, 11) * 2);
        const brightness = 182 + Math.floor(seededNoise(i, 4, 13) * 55);
        ctx.strokeStyle = `rgba(${brightness}, ${brightness}, ${brightness}, ${alpha.toFixed(4)})`;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      const ringSpacing = Math.floor(height / 24);
      for (let y = ringSpacing; y < height; y += ringSpacing) {
        ctx.strokeStyle = "rgba(76, 84, 96, 0.36)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const panelSpacing = Math.floor(width / 14);
      for (let x = panelSpacing; x < width; x += panelSpacing) {
        ctx.strokeStyle = "rgba(86, 96, 112, 0.2)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    },
    { srgb: true },
  );

  const roughnessMap = createCanvasTexture(
    THREE,
    1024,
    1024,
    (ctx, width, height) => {
      ctx.fillStyle = "rgb(126, 126, 126)";
      ctx.fillRect(0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      const data = image.data;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const idx = (y * width * 4) + (x * 4);
          const streak = Math.floor(seededNoise(x * 0.09, y * 0.04, 17) * 24);
          const ring = Math.sin((y / height) * Math.PI * 52) * 10;
          const value = clamp(118 + streak + ring, 92, 168);
          data[idx] = value;
          data[idx + 1] = value;
          data[idx + 2] = value;
          data[idx + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    },
  );

  const metalnessMap = createCanvasTexture(
    THREE,
    1024,
    1024,
    (ctx, width, height) => {
      ctx.fillStyle = "rgb(238, 238, 238)";
      ctx.fillRect(0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      const data = image.data;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const idx = (y * width * 4) + (x * 4);
          const seam = Math.abs(Math.sin((y / height) * Math.PI * 38));
          const variation = seededNoise(x * 0.12, y * 0.2, 23);
          const value = clamp(220 + (variation * 22) - (seam * 10), 188, 248);
          data[idx] = value;
          data[idx + 1] = value;
          data[idx + 2] = value;
          data[idx + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    },
  );

  const normalMap = createCanvasTexture(
    THREE,
    1024,
    1024,
    (ctx, width, height) => {
      const image = ctx.createImageData(width, height);
      const data = image.data;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const idx = (y * width * 4) + (x * 4);
          const nx = (seededNoise(x * 0.17, y * 0.11, 31) - 0.5) * 0.22;
          const ny = (seededNoise(x * 0.13, y * 0.15, 37) - 0.5) * 0.22;
          data[idx] = clamp(Math.floor(128 + (nx * 127)), 0, 255);
          data[idx + 1] = clamp(Math.floor(128 + (ny * 127)), 0, 255);
          data[idx + 2] = 255;
          data[idx + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    },
  );

  return { map, roughnessMap, metalnessMap, normalMap };
}

function createStarshipTileTextureSet(THREE) {
  const map = createCanvasTexture(
    THREE,
    2048,
    1024,
    (ctx, width, height) => {
      ctx.fillStyle = "#0a0d13";
      ctx.fillRect(0, 0, width, height);
      const tileW = Math.max(8, Math.floor(width / 120));
      const tileH = Math.max(8, Math.floor(height / 62));
      for (let y = 0; y < height; y += tileH) {
        for (let x = 0; x < width; x += tileW) {
          const shade = Math.floor(20 + (seededNoise(x * 0.5, y * 0.8, 41) * 26));
          ctx.fillStyle = `rgb(${shade}, ${shade + 1}, ${shade + 4})`;
          ctx.fillRect(x, y, tileW - 1, tileH - 1);
        }
      }
      ctx.strokeStyle = "rgba(78, 88, 104, 0.28)";
      ctx.lineWidth = 1;
      for (let y = 0; y < height; y += tileH) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      for (let x = 0; x < width; x += tileW) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    },
    { srgb: true },
  );

  const roughnessMap = createCanvasTexture(
    THREE,
    1024,
    512,
    (ctx, width, height) => {
      ctx.fillStyle = "rgb(184, 184, 184)";
      ctx.fillRect(0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      const data = image.data;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const idx = (y * width * 4) + (x * 4);
          const n = seededNoise(x * 0.21, y * 0.23, 47);
          const value = clamp(172 + (n * 42), 140, 224);
          data[idx] = value;
          data[idx + 1] = value;
          data[idx + 2] = value;
          data[idx + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    },
  );

  return { map, roughnessMap };
}

function createEngineTextureSet(THREE) {
  const map = createCanvasTexture(
    THREE,
    1024,
    512,
    (ctx, width, height) => {
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "#1b2028");
      gradient.addColorStop(0.38, "#2d3440");
      gradient.addColorStop(0.72, "#4d4135");
      gradient.addColorStop(1, "#1a1f28");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      for (let i = 0; i < 1800; i += 1) {
        const x = Math.floor(seededNoise(i, 4, 53) * width);
        const y = Math.floor(seededNoise(i, 5, 59) * height);
        const alpha = 0.03 + (seededNoise(i, 6, 61) * 0.08);
        const brightness = 70 + Math.floor(seededNoise(i, 7, 67) * 70);
        ctx.fillStyle = `rgba(${brightness}, ${brightness * 0.94}, ${brightness * 0.8}, ${alpha.toFixed(4)})`;
        ctx.fillRect(x, y, 2, 2);
      }
    },
    { srgb: true },
  );

  const roughnessMap = createCanvasTexture(
    THREE,
    1024,
    512,
    (ctx, width, height) => {
      ctx.fillStyle = "rgb(112, 112, 112)";
      ctx.fillRect(0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      const data = image.data;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const idx = (y * width * 4) + (x * 4);
          const n = seededNoise(x * 0.18, y * 0.2, 71);
          const value = clamp(96 + (n * 54), 74, 170);
          data[idx] = value;
          data[idx + 1] = value;
          data[idx + 2] = value;
          data[idx + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    },
  );

  return { map, roughnessMap };
}

export function starshipPhysicalRenderRadiusScene(distanceScale) {
  return kmToScene(STARSHIP_STACK_TOTAL_HEIGHT_KM * 0.5, distanceScale);
}

function createProceduralStarshipStackVisual(THREE, distanceScale) {
  const dims = STARSHIP_STACK_DIMENSIONS_KM;
  const radius = kmToScene(dims.diameterKm * 0.5, distanceScale);
  const boosterHeight = kmToScene(dims.boosterHeightKm, distanceScale);
  const shipHeight = kmToScene(dims.shipHeightKm, distanceScale);
  const shipCylinderHeight = kmToScene(dims.shipCylinderHeightKm, distanceScale);
  const shipNoseHeight = kmToScene(dims.shipNoseHeightKm, distanceScale);
  const hotstageRingHeight = kmToScene(dims.hotstageRingHeightKm, distanceScale);
  const totalHeight = kmToScene(STARSHIP_STACK_TOTAL_HEIGHT_KM, distanceScale);

  const baseY = -0.5 * totalHeight;
  const fullBoosterCenterY = baseY + (0.5 * boosterHeight);
  const fullShipCenterY = baseY + boosterHeight + (0.5 * shipHeight);
  const detachedShipCenterY = 0;
  const shipHalfHeight = 0.5 * shipHeight;
  const shipBodyBottomY = -shipHalfHeight;
  const shipBodyTopY = shipBodyBottomY + shipCylinderHeight;
  const shipNoseCenterY = shipBodyTopY + (0.5 * shipNoseHeight);

  const metal = createStarshipMetalTextureSet(THREE);
  const tiles = createStarshipTileTextureSet(THREE);
  const engine = createEngineTextureSet(THREE);

  const stainless = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    map: metal.map,
    normalMap: metal.normalMap,
    roughnessMap: metal.roughnessMap,
    metalnessMap: metal.metalnessMap,
    roughness: 0.24,
    metalness: 0.94,
    emissive: new THREE.Color(0x12161d),
    emissiveIntensity: 0.05,
  });
  enforceSolidOpaqueMaterial(THREE, stainless);
  const darkSteel = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xe6eef8),
    map: engine.map,
    roughnessMap: engine.roughnessMap,
    roughness: 0.52,
    metalness: 0.84,
    emissive: new THREE.Color(0x080a0f),
    emissiveIntensity: 0.03,
  });
  enforceSolidOpaqueMaterial(THREE, darkSteel);
  const tileBlack = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    map: tiles.map,
    roughnessMap: tiles.roughnessMap,
    roughness: 0.86,
    metalness: 0.06,
    emissive: new THREE.Color(0x05070c),
    emissiveIntensity: 0.04,
  });
  enforceSolidOpaqueMaterial(THREE, tileBlack);
  const materials = [stainless, darkSteel, tileBlack];

  const stackRoot = new THREE.Group();

  const boosterGroup = new THREE.Group();
  boosterGroup.position.y = fullBoosterCenterY;
  stackRoot.add(boosterGroup);

  const boosterVisualState = addSuperHeavyBoosterVisuals(
    THREE,
    boosterGroup,
    stainless,
    darkSteel,
    radius,
    boosterHeight,
  );

  const shipGroup = new THREE.Group();
  shipGroup.position.y = fullShipCenterY;
  stackRoot.add(shipGroup);

  const shipHullGroup = new THREE.Group();
  shipGroup.add(shipHullGroup);

  const shipHullProfile = [];
  const cylindricalSteps = 24;
  for (let i = 0; i <= cylindricalSteps; i += 1) {
    const t = i / cylindricalSteps;
    const y = shipBodyBottomY + (shipCylinderHeight * t);
    const localRadius = radius * (1 - (0.012 * t));
    shipHullProfile.push(new THREE.Vector2(localRadius, y));
  }
  const noseSteps = 20;
  for (let i = 1; i <= noseSteps; i += 1) {
    const t = i / noseSteps;
    const theta = t * (Math.PI * 0.5);
    const y = shipBodyTopY + (Math.sin(theta) * shipNoseHeight);
    const radialFactor = Math.pow(Math.cos(theta), 1.5);
    const localRadius = radius * (0.95 * radialFactor);
    shipHullProfile.push(new THREE.Vector2(Math.max(localRadius, radius * 0.03), y));
  }

  const shipHull = new THREE.Mesh(
    new THREE.LatheGeometry(shipHullProfile, 96),
    stainless,
  );
  shipHullGroup.add(shipHull);

  const hotStageRing = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.01, radius * 1.01, hotstageRingHeight, 48, 1, false),
    darkSteel,
  );
  hotStageRing.position.y = shipBodyBottomY - (0.5 * hotstageRingHeight);
  shipGroup.add(hotStageRing);

  const hotStageVentCount = 18;
  const hotStageVentWidth = clamp(radius * 0.055, radius * 0.03, radius * 0.085);
  const hotStageVentHeight = clamp(hotstageRingHeight * 0.5, hotstageRingHeight * 0.22, hotstageRingHeight * 0.65);
  const hotStageVentDepth = clamp(radius * 0.026, radius * 0.012, radius * 0.04);
  for (let i = 0; i < hotStageVentCount; i += 1) {
    const angle = (i / hotStageVentCount) * Math.PI * 2;
    const vent = new THREE.Mesh(
      new THREE.BoxGeometry(hotStageVentWidth, hotStageVentHeight, hotStageVentDepth),
      darkSteel,
    );
    vent.position.set(
      Math.cos(angle) * (radius * 1.013),
      hotStageRing.position.y,
      Math.sin(angle) * (radius * 1.013),
    );
    vent.rotation.y = angle;
    shipGroup.add(vent);
  }

  const noseTip = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.034, 26, 18),
    stainless,
  );
  noseTip.position.y = shipBodyTopY + shipNoseHeight + (radius * 0.012);
  shipHullGroup.add(noseTip);

  const heatShieldShell = new THREE.Mesh(
    new THREE.LatheGeometry(shipHullProfile, 96),
    tileBlack,
  );
  heatShieldShell.scale.set(1.002, 1.002, 0.56);
  heatShieldShell.rotation.y = Math.PI * 0.5;
  shipHullGroup.add(heatShieldShell);

  const heatShieldTip = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.038, 24, 16),
    tileBlack,
  );
  heatShieldTip.position.copy(noseTip.position);
  heatShieldTip.scale.set(1, 1, 0.56);
  heatShieldTip.rotation.y = Math.PI * 0.5;
  shipHullGroup.add(heatShieldTip);

  const chines = new THREE.Group();
  const chineHeight = clamp(shipNoseHeight * 1.08, shipNoseHeight * 0.78, shipNoseHeight * 1.25);
  const chineThickness = clamp(radius * 0.038, radius * 0.02, radius * 0.06);
  const chineLength = clamp(radius * 0.58, radius * 0.42, radius * 0.74);
  for (let i = 0; i < 2; i += 1) {
    const side = i === 0 ? -1 : 1;
    const chine = new THREE.Mesh(
      new THREE.BoxGeometry(chineThickness, chineHeight, chineLength),
      stainless,
    );
    chine.position.set(
      side * (radius * 0.84),
      shipBodyTopY + (shipNoseHeight * 0.16),
      0,
    );
    chine.rotation.z = side * rad(17);
    chine.rotation.y = side * rad(6);
    chines.add(chine);
  }
  shipHullGroup.add(chines);

  const payloadDoorSeam = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 0.012, shipCylinderHeight * 0.42, radius * 0.72),
    darkSteel,
  );
  payloadDoorSeam.position.set(
    radius * 0.996,
    shipBodyBottomY + (shipCylinderHeight * 0.68),
    0,
  );
  payloadDoorSeam.rotation.y = rad(4);
  shipHullGroup.add(payloadDoorSeam);

  const weldSeamFractions = [0.08, 0.16, 0.24, 0.33, 0.42, 0.5, 0.58, 0.66, 0.74, 0.82, 0.9];
  const seamTubeRadius = clamp(radius * 0.0044, radius * 0.002, radius * 0.007);
  for (const fraction of weldSeamFractions) {
    const seam = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.001, seamTubeRadius, 10, 56),
      darkSteel,
    );
    seam.rotation.x = Math.PI * 0.5;
    seam.position.y = shipBodyBottomY + (fraction * shipCylinderHeight);
    shipHullGroup.add(seam);
  }

  const flapThickness = clamp(radius * 0.058, radius * 0.028, radius * 0.09);
  const aftFlapSpan = clamp(shipCylinderHeight * 0.2, radius * 0.86, shipCylinderHeight * 0.26);
  const foreFlapSpan = clamp(shipCylinderHeight * 0.16, radius * 0.62, shipCylinderHeight * 0.2);
  const aftFlapChord = clamp(radius * 1.12, radius * 0.8, radius * 1.34);
  const foreFlapChord = clamp(radius * 0.82, radius * 0.58, radius * 0.96);
  const aftFlapY = shipBodyBottomY + (shipCylinderHeight * 0.17);
  const foreFlapY = shipBodyBottomY + (shipCylinderHeight * 0.8);
  for (let i = 0; i < 2; i += 1) {
    const side = i === 0 ? -1 : 1;

    const aft = new THREE.Mesh(
      new THREE.BoxGeometry(flapThickness, aftFlapSpan, aftFlapChord),
      darkSteel,
    );
    aft.position.set(side * (radius + (flapThickness * 0.45)), aftFlapY, 0);
    aft.rotation.z = side * rad(12);
    aft.rotation.y = side * rad(4);
    shipGroup.add(aft);

    const aftHinge = new THREE.Mesh(
      new THREE.CylinderGeometry(flapThickness * 0.32, flapThickness * 0.32, aftFlapChord * 0.9, 12, 1, false),
      darkSteel,
    );
    aftHinge.rotation.x = Math.PI * 0.5;
    aftHinge.position.set(side * radius * 0.992, aftFlapY, 0);
    shipGroup.add(aftHinge);

    const fore = new THREE.Mesh(
      new THREE.BoxGeometry(flapThickness * 0.88, foreFlapSpan, foreFlapChord),
      darkSteel,
    );
    fore.position.set(side * (radius + (flapThickness * 0.4)), foreFlapY, 0);
    fore.rotation.z = side * rad(18);
    fore.rotation.y = side * rad(6);
    shipGroup.add(fore);

    const foreHinge = new THREE.Mesh(
      new THREE.CylinderGeometry(flapThickness * 0.3, flapThickness * 0.3, foreFlapChord * 0.9, 12, 1, false),
      darkSteel,
    );
    foreHinge.rotation.x = Math.PI * 0.5;
    foreHinge.position.set(side * radius * 0.992, foreFlapY, 0);
    shipGroup.add(foreHinge);
  }

  addShipEngineCluster(THREE, shipGroup, darkSteel, radius, shipHeight);

  const boosterMainEnginePlume = createMainEnginePlumeCluster(THREE, boosterGroup, {
    offsets: boosterVisualState.engineOffsets,
    anchorY: boosterVisualState.plumeAnchorY,
    ringRadius: boosterVisualState.plumeRingRadius,
    plumeLength: clamp(boosterHeight * 0.058, radius * 0.2, boosterHeight * 0.12),
    plumeRadius: clamp(radius * 0.058, radius * 0.024, radius * 0.09),
    glowRadius: clamp(radius * 0.046, radius * 0.02, radius * 0.07),
  });
  const shipMainEnginePlume = createMainEnginePlumeCluster(THREE, shipGroup, {
    engineCount: 6,
    anchorY: -0.5 * shipHeight - (shipHeight * 0.06),
    ringRadius: clamp(radius * 0.45, radius * 0.14, radius * 0.52),
    plumeLength: clamp(shipHeight * 0.14, radius * 0.42, shipHeight * 0.24),
    plumeRadius: clamp(radius * 0.11, radius * 0.05, radius * 0.16),
    glowRadius: clamp(radius * 0.09, radius * 0.04, radius * 0.13),
  });
  const rcsJets = createRcsJetVisuals(THREE, shipGroup, radius, shipHeight);

  stackRoot.userData.starshipAssetSource = "local_procedural_starship_stack";
  stackRoot.userData.starshipTextureResolution = "procedural_hd";

  return {
    root: stackRoot,
    materials,
    state: {
      boosterGroup,
      shipGroup,
      fullShipCenterY,
      detachedShipCenterY,
      rcsJets,
      mainEnginePlumes: {
        booster: boosterMainEnginePlume,
        ship: shipMainEnginePlume,
      },
    },
    physical: {
      radiusScene: starshipPhysicalRenderRadiusScene(distanceScale),
    },
  };
}

export async function createStarshipStackVisual(THREE, distanceScale) {
  return createProceduralStarshipStackVisual(THREE, distanceScale);
}

function rad(degrees) {
  return (degrees * Math.PI) / 180;
}

function updateRcsJetVisuals(stageState, snapshot) {
  const jets = stageState?.rcsJets;
  if (!jets) {
    return;
  }
  const requestedJets = Array.isArray(snapshot?.rcsJets) ? snapshot.rcsJets : [];
  const requestedJetSet = new Set(requestedJets.map((jet) => String(jet || "").toLowerCase()));
  const active = Boolean(snapshot?.rcsActive) && requestedJetSet.size > 0;
  const authority = clamp(Number(snapshot?.rcsAuthority) || 0, 0, 1);
  const pulse = 0.82 + (0.18 * Math.sin((Date.now() / 1000) * 26));
  const opacity = (0.2 + (authority * 0.55)) * pulse;
  const stretch = 0.75 + (authority * 0.85);
  const radiusScale = 0.82 + (authority * 0.75);
  const glowScale = 0.78 + (authority * 1.16);

  for (const [jetName, entry] of Object.entries(jets)) {
    if (!entry) {
      continue;
    }
    const firing = active && requestedJetSet.has(jetName);
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
      entry.glow.material.opacity = opacity * 0.85;
    }
  }
}

function setMainEnginePlumeVisual(plumeState, firing, throttle = 0, pulse = 1) {
  if (!plumeState?.cluster || !Array.isArray(plumeState.entries)) {
    return;
  }
  plumeState.cluster.visible = Boolean(firing);
  if (!firing) {
    return;
  }
  const t = clamp(Number(throttle) || 0, 0, 1);
  const plumeOpacity = (0.34 + (t * 0.58)) * pulse;
  const glowOpacity = (0.44 + (t * 0.5)) * pulse;
  const stretch = 0.82 + (t * 2.05);
  const radiusScale = 0.9 + (t * 0.52);
  const glowScale = 0.95 + (t * 0.72);
  for (const entry of plumeState.entries) {
    if (!entry) {
      continue;
    }
    if (entry.plume?.scale) {
      entry.plume.scale.set(
        radiusScale * MAIN_ENGINE_PLUME_SIZE_SCALE,
        stretch * MAIN_ENGINE_PLUME_SIZE_SCALE,
        radiusScale * MAIN_ENGINE_PLUME_SIZE_SCALE,
      );
    }
    if (entry.plume?.material && !Array.isArray(entry.plume.material)) {
      entry.plume.material.opacity = plumeOpacity * MAIN_ENGINE_PLUME_BRIGHTNESS_SCALE;
    }
    if (entry.glow?.scale) {
      entry.glow.scale.set(
        glowScale * MAIN_ENGINE_PLUME_SIZE_SCALE,
        glowScale * MAIN_ENGINE_PLUME_SIZE_SCALE,
        glowScale * MAIN_ENGINE_PLUME_SIZE_SCALE,
      );
    }
    if (entry.glow?.material && !Array.isArray(entry.glow.material)) {
      entry.glow.material.opacity = glowOpacity * MAIN_ENGINE_PLUME_BRIGHTNESS_SCALE;
    }
  }
}

function updateMainEnginePlumes(stageState, stageIndex, snapshot) {
  const plumes = stageState?.mainEnginePlumes;
  if (!plumes) {
    return;
  }
  const separated = Number.isFinite(stageIndex) && stageIndex >= 1;
  const phase = String(snapshot?.phase || "").toLowerCase();
  const thrustN = Math.max(0, Number(snapshot?.thrustN) || 0);
  const throttle = clamp(Number(snapshot?.throttle) || 0, 0, 1);
  const powered = phase === "powered" && thrustN > 0.01;
  const pulse = 0.92 + (0.08 * Math.sin((Date.now() / 1000) * 44));

  setMainEnginePlumeVisual(plumes.booster, powered && !separated, throttle, pulse);
  setMainEnginePlumeVisual(plumes.ship, powered && separated, throttle, pulse);
}

export function applyStarshipVisualStage(stageState, stageIndex, snapshot = null) {
  if (!stageState || !stageState.shipGroup) {
    return;
  }
  const separated = Number.isFinite(stageIndex) && stageIndex >= 1;
  if (stageState.boosterGroup) {
    stageState.boosterGroup.visible = !separated;
  }
  if (
    Number.isFinite(stageState.detachedShipCenterY)
    && Number.isFinite(stageState.fullShipCenterY)
  ) {
    stageState.shipGroup.position.y = separated
      ? stageState.detachedShipCenterY
      : stageState.fullShipCenterY;
  }
  updateMainEnginePlumes(stageState, stageIndex, snapshot);
  updateRcsJetVisuals(stageState, snapshot);
}
