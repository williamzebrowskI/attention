import {
  STARSHIP_STACK_DIMENSIONS_KM,
  STARSHIP_STACK_TOTAL_HEIGHT_KM,
} from "./launchConfig.js";

const STARSHIP_MODEL_MANIFEST_URL = "/static/assets/models/starship/model_manifest.json";
const STARSHIP_LOADER_CDN_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js/+esm";

let cachedExternalManifest = null;
let cachedExternalManifestPromise = null;
let cachedExternalLoaderPromise = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function kmToScene(kmValue, distanceScale) {
  return kmValue * distanceScale;
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

  const boosterBody = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, boosterHeight, 40, 1, false),
    stainless,
  );
  boosterGroup.add(boosterBody);

  const boosterTopCap = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.5),
    stainless,
  );
  boosterTopCap.position.y = 0.5 * boosterHeight;
  boosterGroup.add(boosterTopCap);

  const gridFinWidth = clamp(radius * 0.95, radius * 0.45, radius * 1.1);
  const gridFinHeight = clamp(radius * 0.6, radius * 0.2, radius * 0.8);
  const gridFinDepth = clamp(radius * 0.12, radius * 0.06, radius * 0.2);
  const gridFinY = (0.5 * boosterHeight) - (radius * 0.55);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(gridFinWidth, gridFinHeight, gridFinDepth),
      darkSteel,
    );
    fin.position.set(
      Math.cos(angle) * (radius + (gridFinDepth * 0.35)),
      gridFinY,
      Math.sin(angle) * (radius + (gridFinDepth * 0.35)),
    );
    fin.rotation.y = angle;
    boosterGroup.add(fin);
  }

  const engineBellRadius = clamp(radius * 0.19, radius * 0.08, radius * 0.22);
  const engineBellHeight = clamp(radius * 0.28, radius * 0.12, radius * 0.32);
  const engineRingRadius = clamp(radius * 0.56, radius * 0.15, radius * 0.62);
  for (let i = 0; i < 9; i += 1) {
    const angle = (i / 9) * Math.PI * 2;
    const bell = new THREE.Mesh(
      new THREE.ConeGeometry(engineBellRadius, engineBellHeight, 16, 1, true),
      darkSteel,
    );
    bell.position.set(
      Math.cos(angle) * engineRingRadius,
      -0.5 * boosterHeight - (engineBellHeight * 0.45),
      Math.sin(angle) * engineRingRadius,
    );
    bell.rotation.x = Math.PI;
    boosterGroup.add(bell);
  }
  const centerBell = new THREE.Mesh(
    new THREE.ConeGeometry(engineBellRadius * 1.1, engineBellHeight * 1.08, 18, 1, true),
    darkSteel,
  );
  centerBell.position.y = -0.5 * boosterHeight - (engineBellHeight * 0.5);
  centerBell.rotation.x = Math.PI;
  boosterGroup.add(centerBell);

  const shipGroup = new THREE.Group();
  shipGroup.position.y = fullShipCenterY;
  stackRoot.add(shipGroup);

  const shipBody = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, shipCylinderHeight, 40, 1, false),
    stainless,
  );
  shipBody.position.y = (-0.5 * shipHeight) + (0.5 * shipCylinderHeight);
  shipGroup.add(shipBody);

  const hotStageRing = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.01, radius * 1.01, hotstageRingHeight, 40, 1, false),
    darkSteel,
  );
  hotStageRing.position.y = (-0.5 * shipHeight) - (0.5 * hotstageRingHeight);
  shipGroup.add(hotStageRing);

  const shipNose = new THREE.Mesh(
    new THREE.ConeGeometry(radius, shipNoseHeight, 40, 1, false),
    stainless,
  );
  shipNose.position.y = (-0.5 * shipHeight) + shipCylinderHeight + (0.5 * shipNoseHeight);
  shipGroup.add(shipNose);

  const tileBand = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.002, radius * 1.002, shipCylinderHeight * 0.98, 40, 1, false),
    tileBlack,
  );
  tileBand.position.y = shipBody.position.y;
  tileBand.scale.set(1.001, 1, 0.56);
  tileBand.rotation.y = Math.PI * 0.5;
  shipGroup.add(tileBand);

  const flapLength = clamp(shipCylinderHeight * 0.27, radius * 0.9, shipCylinderHeight * 0.4);
  const flapThickness = clamp(radius * 0.08, radius * 0.04, radius * 0.12);
  const aftFlapWidth = clamp(radius * 0.95, radius * 0.55, radius * 1.1);
  const foreFlapWidth = clamp(radius * 0.72, radius * 0.45, radius * 0.9);
  const aftFlapY = (-0.5 * shipHeight) + (shipCylinderHeight * 0.18);
  const foreFlapY = (-0.5 * shipHeight) + (shipCylinderHeight * 0.78);
  for (let i = 0; i < 2; i += 1) {
    const side = i === 0 ? -1 : 1;
    const aft = new THREE.Mesh(
      new THREE.BoxGeometry(aftFlapWidth, flapLength, flapThickness),
      darkSteel,
    );
    aft.position.set(side * (radius + (flapThickness * 0.5)), aftFlapY, 0);
    aft.rotation.z = side * rad(8);
    shipGroup.add(aft);

    const fore = new THREE.Mesh(
      new THREE.BoxGeometry(foreFlapWidth, flapLength * 0.82, flapThickness * 0.92),
      darkSteel,
    );
    fore.position.set(side * (radius + (flapThickness * 0.5)), foreFlapY, 0);
    fore.rotation.z = side * rad(14);
    shipGroup.add(fore);
  }

  return {
    root: stackRoot,
    materials,
    state: {
      boosterGroup,
      shipGroup,
      fullShipCenterY,
      detachedShipCenterY,
    },
    physical: {
      radiusScene: starshipPhysicalRenderRadiusScene(distanceScale),
    },
  };
}

async function loadStarshipModelManifest() {
  if (cachedExternalManifest) {
    return cachedExternalManifest;
  }
  if (!cachedExternalManifestPromise) {
    cachedExternalManifestPromise = (async () => {
      try {
        const response = await fetch(STARSHIP_MODEL_MANIFEST_URL, { cache: "no-store" });
        if (!response.ok) {
          return null;
        }
        const payload = await response.json();
        const enabled = Boolean(payload?.enabled);
        const modelUrl = String(payload?.url || "").trim();
        if (!enabled || !modelUrl) {
          return null;
        }
        const format = String(payload?.format || "").trim().toLowerCase();
        return {
          enabled,
          format,
          url: modelUrl,
          source: String(payload?.source || "").trim(),
          modelUid: String(payload?.model_uid || payload?.modelUid || "").trim(),
          textureMaxResolution: Number(payload?.texture_max_resolution || payload?.textureMaxResolution || 0) || 0,
        };
      } catch (error) {
        console.warn("[launch] Could not load external Starship model manifest:", error);
        return null;
      }
    })();
  }
  cachedExternalManifest = await cachedExternalManifestPromise;
  return cachedExternalManifest;
}

async function loadGltfLoaderClass() {
  if (!cachedExternalLoaderPromise) {
    cachedExternalLoaderPromise = import(STARSHIP_LOADER_CDN_URL)
      .then((mod) => mod?.GLTFLoader || null)
      .catch((error) => {
        console.warn("[launch] Could not import GLTFLoader for external Starship model:", error);
        return null;
      });
  }
  return cachedExternalLoaderPromise;
}

function findNodeByName(root, keywords) {
  if (!root) {
    return null;
  }
  const normalizedKeywords = (keywords || [])
    .map((keyword) => String(keyword || "").toLowerCase())
    .filter((keyword) => keyword.length > 0);
  let best = null;
  root.traverse((node) => {
    if (!node?.name) {
      return;
    }
    const normalizedName = String(node.name).toLowerCase();
    const score = normalizedKeywords.reduce((total, keyword) => (
      normalizedName.includes(keyword) ? total + 1 : total
    ), 0);
    if (!(score > 0)) {
      return;
    }
    if (!best || score > best.score) {
      best = { node, score };
    }
  });
  return best?.node || null;
}

function orientRocketUpright(root, THREE) {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) {
    return;
  }
  const size = box.getSize(new THREE.Vector3());
  const axisLengths = [
    { axis: "x", value: size.x },
    { axis: "y", value: size.y },
    { axis: "z", value: size.z },
  ].sort((a, b) => b.value - a.value);
  const tallestAxis = axisLengths[0]?.axis || "y";
  if (tallestAxis === "z") {
    root.rotation.x = -Math.PI * 0.5;
  } else if (tallestAxis === "x") {
    root.rotation.z = Math.PI * 0.5;
  }
}

function normalizeRocketTransform(root, THREE, targetHeightScene) {
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) {
    return false;
  }
  const size = box.getSize(new THREE.Vector3());
  const height = Math.max(size.y, 1e-12);
  if (!(height > 0)) {
    return false;
  }
  const scale = targetHeightScene / height;
  root.scale.multiplyScalar(scale);

  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) {
    return false;
  }
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  return true;
}

function buildExternalStageState(root, distanceScale) {
  const boosterGroup = findNodeByName(root, ["booster", "superheavy", "super_heavy", "super heavy"]);
  const shipGroup = findNodeByName(root, ["starship", "upperstage", "upper_stage", "ship"]);
  if (!shipGroup) {
    return null;
  }
  const detachedShift = kmToScene(STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm * 0.68, distanceScale);
  return {
    boosterGroup,
    shipGroup,
    fullShipCenterY: shipGroup.position.y,
    detachedShipCenterY: shipGroup.position.y + detachedShift,
  };
}

function gatherUniqueMaterials(root) {
  const materialSet = new Set();
  root.traverse((node) => {
    const material = node?.material;
    if (Array.isArray(material)) {
      for (const entry of material) {
        if (entry) {
          materialSet.add(entry);
        }
      }
      return;
    }
    if (material) {
      materialSet.add(material);
    }
  });
  return [...materialSet];
}

function applyShadowFlags(root) {
  root.traverse((node) => {
    if (!node || node.isLight) {
      return;
    }
    node.castShadow = true;
    node.receiveShadow = true;
  });
}

function clearGroupChildren(group) {
  if (!group) {
    return;
  }
  while (group.children.length > 0) {
    group.remove(group.children[group.children.length - 1]);
  }
}

async function createExternalStarshipStackVisual(THREE, distanceScale) {
  const manifest = await loadStarshipModelManifest();
  if (!manifest?.url) {
    return null;
  }
  const GLTFLoader = await loadGltfLoaderClass();
  if (!GLTFLoader) {
    return null;
  }

  const loader = new GLTFLoader();
  const gltf = await new Promise((resolve, reject) => {
    loader.load(
      manifest.url,
      (result) => resolve(result),
      undefined,
      (error) => reject(error),
    );
  });
  const externalRoot = gltf?.scene || gltf?.scenes?.[0];
  if (!externalRoot) {
    return null;
  }

  const textureLabel = manifest.textureMaxResolution > 0
    ? `${manifest.textureMaxResolution}px`
    : "external";

  const orientedRoot = new THREE.Group();
  orientedRoot.add(externalRoot);
  orientRocketUpright(orientedRoot, THREE);

  const externalStageState = buildExternalStageState(orientedRoot, distanceScale);
  if (externalStageState?.boosterGroup && externalStageState?.shipGroup) {
    const targetHeight = kmToScene(STARSHIP_STACK_TOTAL_HEIGHT_KM, distanceScale);
    const normalized = normalizeRocketTransform(orientedRoot, THREE, targetHeight);
    if (!normalized) {
      return null;
    }
    applyShadowFlags(orientedRoot);
    orientedRoot.userData.starshipAssetSource = manifest.source || "external_starship_model";
    orientedRoot.userData.starshipTextureResolution = textureLabel;
    return {
      root: orientedRoot,
      materials: gatherUniqueMaterials(orientedRoot),
      state: externalStageState,
      physical: {
        radiusScene: starshipPhysicalRenderRadiusScene(distanceScale),
      },
    };
  }

  // Starship-only external assets are mounted onto a separate procedural booster.
  const targetShipHeight = kmToScene(STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm, distanceScale);
  const normalizedShip = normalizeRocketTransform(orientedRoot, THREE, targetShipHeight);
  if (!normalizedShip) {
    return null;
  }
  applyShadowFlags(orientedRoot);

  const hybridStack = createProceduralStarshipStackVisual(THREE, distanceScale);
  const shipGroup = hybridStack?.state?.shipGroup;
  if (!hybridStack?.root || !shipGroup) {
    return null;
  }
  clearGroupChildren(shipGroup);
  shipGroup.add(orientedRoot);

  const sourceLabel = manifest.source || "external_starship_model";
  hybridStack.root.userData.starshipAssetSource = `${sourceLabel} + procedural_booster`;
  hybridStack.root.userData.starshipTextureResolution = textureLabel;

  return {
    root: hybridStack.root,
    materials: gatherUniqueMaterials(hybridStack.root),
    state: hybridStack.state,
    physical: {
      radiusScene: starshipPhysicalRenderRadiusScene(distanceScale),
    },
  };
}

export async function createStarshipStackVisual(THREE, distanceScale) {
  try {
    const external = await createExternalStarshipStackVisual(THREE, distanceScale);
    if (external?.root) {
      return external;
    }
  } catch (error) {
    console.warn("[launch] Could not load external Starship stack model. Using procedural fallback.", error);
  }
  return createProceduralStarshipStackVisual(THREE, distanceScale);
}

function rad(degrees) {
  return (degrees * Math.PI) / 180;
}

export function applyStarshipVisualStage(stageState, stageIndex) {
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
}
