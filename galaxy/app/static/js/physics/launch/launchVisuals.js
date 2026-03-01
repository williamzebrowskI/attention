import {
  STARSHIP_STACK_DIMENSIONS_KM,
  STARSHIP_STACK_TOTAL_HEIGHT_KM,
} from "./launchConfig.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function kmToScene(kmValue, distanceScale) {
  return kmValue * distanceScale;
}

export function starshipPhysicalRenderRadiusScene(distanceScale) {
  return kmToScene(STARSHIP_STACK_TOTAL_HEIGHT_KM * 0.5, distanceScale);
}

export function createStarshipStackVisual(THREE, distanceScale) {
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

  const stainless = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xcfd6df),
    roughness: 0.35,
    metalness: 0.78,
    emissive: new THREE.Color(0x12161d),
    emissiveIntensity: 0.08,
  });
  const darkSteel = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x222833),
    roughness: 0.46,
    metalness: 0.68,
    emissive: new THREE.Color(0x080a0f),
    emissiveIntensity: 0.04,
  });
  const tileBlack = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x0f1219),
    roughness: 0.76,
    metalness: 0.09,
    emissive: new THREE.Color(0x05070c),
    emissiveIntensity: 0.05,
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

function rad(degrees) {
  return (degrees * Math.PI) / 180;
}

export function applyStarshipVisualStage(stageState, stageIndex) {
  if (!stageState) {
    return;
  }
  const separated = Number.isFinite(stageIndex) && stageIndex >= 1;
  stageState.boosterGroup.visible = !separated;
  stageState.shipGroup.position.y = separated
    ? stageState.detachedShipCenterY
    : stageState.fullShipCenterY;
}
