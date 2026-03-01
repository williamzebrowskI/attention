import {
  STARSHIP_STACK_DIMENSIONS_KM,
  STARSHIP_STACK_TOTAL_HEIGHT_KM,
} from "./launchConfig.js";

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

function createRcsJetVisuals(THREE, shipGroup, radius, shipHeight) {
  if (!THREE || !shipGroup || !(radius > 0) || !(shipHeight > 0)) {
    return null;
  }
  const plumeLength = clamp(shipHeight * 0.018, radius * 0.14, shipHeight * 0.038);
  const plumeRadius = clamp(radius * 0.024, radius * 0.01, radius * 0.04);
  const nozzleGlowRadius = clamp(radius * 0.016, radius * 0.007, radius * 0.03);
  const shellOffset = clamp(radius * 0.042, radius * 0.018, radius * 0.08);
  const longitudinalOffset = clamp(shipHeight * 0.24, radius * 1.4, shipHeight * 0.42);
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
  const definitions = [
    {
      id: "port",
      direction: new THREE.Vector3(-1, 0, 0),
      anchor: new THREE.Vector3(-(radius + shellOffset), 0, 0),
    },
    {
      id: "starboard",
      direction: new THREE.Vector3(1, 0, 0),
      anchor: new THREE.Vector3(radius + shellOffset, 0, 0),
    },
    {
      id: "dorsal",
      direction: new THREE.Vector3(0, 0, 1),
      anchor: new THREE.Vector3(0, 0, radius + shellOffset),
    },
    {
      id: "ventral",
      direction: new THREE.Vector3(0, 0, -1),
      anchor: new THREE.Vector3(0, 0, -(radius + shellOffset)),
    },
    {
      id: "forward",
      direction: new THREE.Vector3(0, 1, 0),
      anchor: new THREE.Vector3(0, longitudinalOffset, 0),
    },
    {
      id: "aft",
      direction: new THREE.Vector3(0, -1, 0),
      anchor: new THREE.Vector3(0, -longitudinalOffset, 0),
    },
  ];

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
    panel.material.opacity = 0.9;
    panel.material.transparent = true;
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
  const darkSteel = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xe6eef8),
    map: engine.map,
    roughnessMap: engine.roughnessMap,
    roughness: 0.52,
    metalness: 0.84,
    emissive: new THREE.Color(0x080a0f),
    emissiveIntensity: 0.03,
  });
  const tileBlack = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    map: tiles.map,
    roughnessMap: tiles.roughnessMap,
    roughness: 0.86,
    metalness: 0.06,
    emissive: new THREE.Color(0x05070c),
    emissiveIntensity: 0.04,
  });
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

  const shipBody = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 0.985, shipCylinderHeight, 56, 1, false),
    stainless,
  );
  shipBody.position.y = shipBodyBottomY + (0.5 * shipCylinderHeight);
  shipHullGroup.add(shipBody);

  const aftTaperHeight = clamp(shipCylinderHeight * 0.08, radius * 0.16, shipCylinderHeight * 0.12);
  const aftTaper = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.985, radius * 0.93, aftTaperHeight, 52, 1, false),
    stainless,
  );
  aftTaper.position.y = shipBodyBottomY + (0.5 * aftTaperHeight);
  shipHullGroup.add(aftTaper);

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

  const shipNose = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.98, radius * 0.12, shipNoseHeight, 56, 1, false),
    stainless,
  );
  shipNose.position.y = shipNoseCenterY;
  shipHullGroup.add(shipNose);

  const noseCap = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.126, 36, 20),
    stainless,
  );
  noseCap.position.y = shipBodyTopY + shipNoseHeight - (radius * 0.005);
  shipHullGroup.add(noseCap);

  const tileBand = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.002, radius * 0.994, shipCylinderHeight * 0.985, 52, 1, false),
    tileBlack,
  );
  tileBand.position.y = shipBody.position.y;
  tileBand.scale.set(1.003, 1, 0.545);
  tileBand.rotation.y = Math.PI * 0.5;
  shipHullGroup.add(tileBand);

  const noseTile = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.985, radius * 0.115, shipNoseHeight * 0.98, 44, 1, false),
    tileBlack,
  );
  noseTile.position.y = shipNose.position.y;
  noseTile.scale.set(1.004, 1, 0.53);
  noseTile.rotation.y = Math.PI * 0.5;
  shipHullGroup.add(noseTile);

  const noseTileCap = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.12, 28, 18),
    tileBlack,
  );
  noseTileCap.position.y = noseCap.position.y;
  noseTileCap.scale.set(1, 1, 0.52);
  noseTileCap.rotation.y = Math.PI * 0.5;
  shipHullGroup.add(noseTileCap);

  const chineWidth = clamp(radius * 0.2, radius * 0.1, radius * 0.27);
  const chineDepth = clamp(radius * 0.12, radius * 0.05, radius * 0.16);
  const chineLength = clamp(shipNoseHeight * 1.24, shipNoseHeight * 0.78, shipNoseHeight * 1.45);
  const chineY = shipBodyTopY - (shipNoseHeight * 0.18);
  for (let i = 0; i < 2; i += 1) {
    const side = i === 0 ? -1 : 1;
    const chine = new THREE.Mesh(
      new THREE.BoxGeometry(chineWidth, chineLength, chineDepth),
      stainless,
    );
    chine.position.set(side * (radius * 0.72), chineY, 0);
    chine.rotation.z = side * rad(13);
    shipHullGroup.add(chine);
  }

  const payloadDoorHeight = clamp(shipCylinderHeight * 0.34, radius * 1.5, shipCylinderHeight * 0.42);
  const payloadDoorY = shipBodyTopY - (payloadDoorHeight * 0.62);
  const payloadDoor = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 0.022, payloadDoorHeight, radius * 0.66),
    darkSteel,
  );
  payloadDoor.position.set(radius * 0.985, payloadDoorY, 0);
  payloadDoor.rotation.y = rad(5);
  shipHullGroup.add(payloadDoor);

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

  const flapLength = clamp(shipCylinderHeight * 0.27, radius * 0.9, shipCylinderHeight * 0.4);
  const flapThickness = clamp(radius * 0.075, radius * 0.038, radius * 0.115);
  const aftFlapWidth = clamp(radius * 1.04, radius * 0.63, radius * 1.2);
  const foreFlapWidth = clamp(radius * 0.76, radius * 0.48, radius * 0.96);
  const aftFlapY = shipBodyBottomY + (shipCylinderHeight * 0.19);
  const foreFlapY = shipBodyBottomY + (shipCylinderHeight * 0.77);
  for (let i = 0; i < 2; i += 1) {
    const side = i === 0 ? -1 : 1;

    const aft = new THREE.Mesh(
      new THREE.BoxGeometry(flapThickness, flapLength, aftFlapWidth),
      darkSteel,
    );
    aft.position.set(side * (radius + (flapThickness * 0.54)), aftFlapY, 0);
    aft.rotation.z = side * rad(8);
    aft.rotation.y = side * rad(2.8);
    shipGroup.add(aft);

    const aftHinge = new THREE.Mesh(
      new THREE.CylinderGeometry(flapThickness * 0.38, flapThickness * 0.38, aftFlapWidth * 0.88, 12, 1, false),
      darkSteel,
    );
    aftHinge.rotation.x = Math.PI * 0.5;
    aftHinge.position.set(side * radius * 0.995, aftFlapY, 0);
    shipGroup.add(aftHinge);

    const fore = new THREE.Mesh(
      new THREE.BoxGeometry(flapThickness * 0.92, flapLength * 0.82, foreFlapWidth),
      darkSteel,
    );
    fore.position.set(side * (radius + (flapThickness * 0.5)), foreFlapY, 0);
    fore.rotation.z = side * rad(15);
    fore.rotation.y = side * rad(3.2);
    shipGroup.add(fore);

    const foreHinge = new THREE.Mesh(
      new THREE.CylinderGeometry(flapThickness * 0.36, flapThickness * 0.36, foreFlapWidth * 0.9, 12, 1, false),
      darkSteel,
    );
    foreHinge.rotation.x = Math.PI * 0.5;
    foreHinge.position.set(side * radius * 0.995, foreFlapY, 0);
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
