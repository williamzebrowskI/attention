import { createSuperHeavyEngineDescriptors } from "./launchEngineLayout.js";
import {
  BOOSTER_CURRENT_GRID_FIN_CHORD_M,
  BOOSTER_CURRENT_GRID_FIN_RADIAL_SPAN_M,
  BOOSTER_CURRENT_GRID_FIN_THICKNESS_M,
  BOOSTER_CURRENT_GRID_FIN_Y_M,
  LAUNCH_REALISM_CONFIG,
} from "./launchRealismConfig.js";
import { addRaptorReplicaCluster } from "./raptorEngineReplica.js?v=20260421a";

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

function createSuperHeavyEngineOffsets(radius) {
  const descriptors = createSuperHeavyEngineDescriptors(radius, 0);
  return descriptors.map((descriptor) => ({
    x: Number(descriptor?.x) || 0,
    z: Number(descriptor?.z) || 0,
  }));
}

function addTrussStrut(THREE, hostGroup, material, start, end, width, depth) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (!(length > 1e-12)) {
    return;
  }
  const strut = new THREE.Mesh(
    new THREE.BoxGeometry(width, length, depth),
    material,
  );
  strut.position.copy(start).add(end).multiplyScalar(0.5);
  strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  hostGroup.add(strut);
}

function createCurrentGridFinAssembly(THREE, {
  darkSteel,
  radialSpan,
  chordSpan,
  thickness,
  angle,
  name,
  deflectionSign,
  catchPinRadius,
  catchPinLength,
} = {}) {
  const finAssembly = new THREE.Group();
  const finActuator = new THREE.Group();
  const frameBar = clamp(chordSpan * 0.06, thickness * 0.72, chordSpan * 0.10);
  const ribHeight = thickness * 0.92;
  const rootOffset = radialSpan * 0.04;
  const outerX = radialSpan;
  const midX = radialSpan * 0.52;

  const hinge = new THREE.Mesh(
    new THREE.CylinderGeometry(thickness * 0.62, thickness * 0.62, chordSpan * 1.08, 16, 1, false),
    darkSteel,
  );
  hinge.rotation.x = Math.PI * 0.5;
  hinge.position.x = rootOffset;
  finActuator.add(hinge);

  const makeBar = (width, barHeight, depth, x, y = 0, z = 0) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(width, barHeight, depth), darkSteel);
    bar.position.set(x, y, z);
    finActuator.add(bar);
    return bar;
  };

  makeBar(frameBar, ribHeight, chordSpan, rootOffset);
  makeBar(frameBar, ribHeight, chordSpan * 0.94, outerX);
  makeBar(radialSpan, ribHeight, frameBar, midX, 0, chordSpan * 0.5);
  makeBar(radialSpan, ribHeight, frameBar, midX, 0, -chordSpan * 0.5);

  for (let ribIndex = 1; ribIndex <= 5; ribIndex += 1) {
    const ribX = rootOffset + ((outerX - rootOffset) * (ribIndex / 6));
    makeBar(frameBar * 0.58, ribHeight * 0.82, chordSpan * 0.86, ribX);
  }

  for (let barIndex = -2; barIndex <= 2; barIndex += 1) {
    makeBar(radialSpan * 0.86, ribHeight * 0.76, frameBar * 0.56, midX, 0, barIndex * (chordSpan * 0.16));
  }

  const pod = new THREE.Mesh(
    new THREE.BoxGeometry(radialSpan * 0.36, thickness * 1.9, chordSpan * 0.28),
    darkSteel,
  );
  pod.position.x = -(radialSpan * 0.08);
  finAssembly.add(pod);

  const actuatorCover = new THREE.Mesh(
    new THREE.BoxGeometry(radialSpan * 0.18, thickness * 1.45, chordSpan * 0.64),
    darkSteel,
  );
  actuatorCover.position.x = radialSpan * 0.08;
  finAssembly.add(actuatorCover);

  const catchPin = new THREE.Mesh(
    new THREE.CylinderGeometry(catchPinRadius, catchPinRadius, catchPinLength, 14, 1, false),
    darkSteel,
  );
  catchPin.rotation.x = Math.PI * 0.5;
  catchPin.position.set(radialSpan * 0.28, -thickness * 1.55, 0);
  finAssembly.add(catchPin);

  finAssembly.add(finActuator);
  finAssembly.rotation.y = -angle;
  finAssembly.userData.baseRotationY = -angle;
  finAssembly.userData.baseRotationZ = 0;
  finAssembly.userData.deflectionSign = deflectionSign;
  finAssembly.userData.gridFinName = name;
  finAssembly.userData.gridFinOrientation = "horizontal-radial-grid";
  finAssembly.userData.actuator = finActuator;
  finActuator.userData.baseRotationZ = 0;

  return finAssembly;
}

export function addSharedSuperHeavyBoosterVisuals(THREE, boosterGroup, {
  stainless,
  darkSteel,
  radius,
  boosterHeight,
} = {}) {
  if (!THREE || !boosterGroup || !stainless || !darkSteel || !(radius > 0) || !(boosterHeight > 0)) {
    return {
      engineOffsets: [],
      engineVisualGroup: null,
      plumeAnchorY: 0,
      engineExitY: 0,
      bellRadius: 0,
      bellHeight: 0,
    };
  }

  const boosterBody = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, boosterHeight, 64, 1, false),
    stainless,
  );
  boosterGroup.add(boosterBody);

  const engineSkirtHeight = clamp(boosterHeight * 0.16, radius * 0.8, boosterHeight * 0.22);
  const engineSkirt = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.045, radius * 1.045, engineSkirtHeight, 64, 1, false),
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

  const aftTileRows = 2;
  const aftTileCountPerRow = 42;
  const aftTileRadius = radius * 1.028;
  const aftTileArcWidth = ((Math.PI * 2 * aftTileRadius) / aftTileCountPerRow) * 0.72;
  const aftTileHeight = clamp(engineSkirtHeight * 0.2, radius * 0.05, engineSkirtHeight * 0.3);
  const aftTileDepth = clamp(radius * 0.014, radius * 0.006, radius * 0.022);
  const aftTileMaterial = darkSteel.clone();
  aftTileMaterial.color.multiplyScalar(0.9);
  aftTileMaterial.roughness = clamp((aftTileMaterial.roughness || 0.5) + 0.14, 0, 1);
  aftTileMaterial.metalness = clamp((aftTileMaterial.metalness || 0.5) + 0.18, 0, 1);
  enforceSolidOpaqueMaterial(THREE, aftTileMaterial);
  for (let row = 0; row < aftTileRows; row += 1) {
    const y = (-0.5 * boosterHeight) + (aftTileHeight * (0.7 + (row * 1.18)));
    const phase = row === 0 ? 0 : Math.PI / aftTileCountPerRow;
    for (let i = 0; i < aftTileCountPerRow; i += 1) {
      const angle = ((i / aftTileCountPerRow) * Math.PI * 2) + phase;
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(aftTileArcWidth, aftTileHeight, aftTileDepth),
        aftTileMaterial,
      );
      tile.position.set(
        Math.cos(angle) * aftTileRadius,
        y,
        Math.sin(angle) * aftTileRadius,
      );
      tile.rotation.y = angle;
      boosterGroup.add(tile);
    }
  }

  const boosterTopCap = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.5),
    stainless,
  );
  boosterTopCap.position.y = 0.5 * boosterHeight;
  boosterGroup.add(boosterTopCap);

  const hotStageBandHeight = clamp(boosterHeight * 0.066, radius * 0.36, boosterHeight * 0.11);
  const trussRingThickness = clamp(hotStageBandHeight * 0.15, radius * 0.035, hotStageBandHeight * 0.24);
  const trussOuterRadius = radius * 1.07;
  const trussInnerRadius = radius * 1.01;
  const hotStageLowerY = (0.5 * boosterHeight) + (hotStageBandHeight * 0.16);
  const hotStageUpperY = hotStageLowerY + (hotStageBandHeight * 0.84);

  const lowerRing = new THREE.Mesh(
    new THREE.CylinderGeometry(trussOuterRadius, trussOuterRadius, trussRingThickness, 72, 1, true),
    darkSteel,
  );
  lowerRing.position.y = hotStageLowerY;
  boosterGroup.add(lowerRing);

  const upperRing = new THREE.Mesh(
    new THREE.CylinderGeometry(trussOuterRadius * 1.01, trussOuterRadius * 1.01, trussRingThickness, 72, 1, true),
    darkSteel,
  );
  upperRing.position.y = hotStageUpperY;
  boosterGroup.add(upperRing);

  const blastDeck = new THREE.Mesh(
    new THREE.CylinderGeometry(trussInnerRadius, radius * 0.985, trussRingThickness * 1.3, 64, 1, false),
    darkSteel,
  );
  blastDeck.position.y = hotStageLowerY - (trussRingThickness * 0.8);
  boosterGroup.add(blastDeck);

  const trussCount = 36;
  const trussWidth = clamp(radius * 0.018, radius * 0.008, radius * 0.028);
  const trussDepth = clamp(radius * 0.016, radius * 0.007, radius * 0.024);
  const trussPhase = Math.PI / trussCount;
  const trussRadiusA = trussOuterRadius * 0.995;
  const trussRadiusB = trussOuterRadius * 1.015;
  for (let i = 0; i < trussCount; i += 1) {
    const angleA = (i / trussCount) * Math.PI * 2;
    const angleB = angleA + trussPhase;
    const angleC = angleA - trussPhase;
    const startA = new THREE.Vector3(
      Math.cos(angleA) * trussRadiusA,
      hotStageLowerY + (trussRingThickness * 0.46),
      Math.sin(angleA) * trussRadiusA,
    );
    const endB = new THREE.Vector3(
      Math.cos(angleB) * trussRadiusB,
      hotStageUpperY - (trussRingThickness * 0.46),
      Math.sin(angleB) * trussRadiusB,
    );
    addTrussStrut(THREE, boosterGroup, darkSteel, startA, endB, trussWidth, trussDepth);

    if ((i % 2) === 0) {
      const endC = new THREE.Vector3(
        Math.cos(angleC) * trussRadiusB,
        hotStageUpperY - (trussRingThickness * 0.46),
        Math.sin(angleC) * trussRadiusB,
      );
      addTrussStrut(THREE, boosterGroup, darkSteel, startA, endC, trussWidth, trussDepth);
    }
  }

  const seamFractions = [0.11, 0.24, 0.36, 0.49, 0.61, 0.74, 0.86];
  const seamTubeRadius = clamp(radius * 0.006, radius * 0.0025, radius * 0.01);
  for (const fraction of seamFractions) {
    const seam = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.015, seamTubeRadius, 10, 64),
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
      Math.cos(angle) * (radius + stringerDepth),
      (-0.5 * boosterHeight) + (stringerHeight * 0.55),
      Math.sin(angle) * (radius + stringerDepth),
    );
    rib.rotation.y = angle;
    boosterGroup.add(rib);
  }

  const scenePerMeter = boosterHeight / Math.max(1, (Number(LAUNCH_REALISM_CONFIG.gridFins?.booster?.bodyLengthM) || 71));
  const gridFinRadialSpan = BOOSTER_CURRENT_GRID_FIN_RADIAL_SPAN_M * scenePerMeter;
  const gridFinChordSpan = BOOSTER_CURRENT_GRID_FIN_CHORD_M * scenePerMeter;
  const gridFinThickness = BOOSTER_CURRENT_GRID_FIN_THICKNESS_M * scenePerMeter;
  const gridFinY = BOOSTER_CURRENT_GRID_FIN_Y_M * scenePerMeter;
  const gridFinProfile = LAUNCH_REALISM_CONFIG.gridFins?.booster || {};
  const gridFinLayout = Array.isArray(gridFinProfile.fins)
    ? gridFinProfile.fins.map((fin, index) => {
      const x = Number(fin?.positionBodyM?.x) || 0;
      const z = Number(fin?.positionBodyM?.z) || 0;
      const angle = Math.atan2(z, x);
      return {
        angle,
        name: String(fin?.name || `grid-fin-${index}`),
        deflectionSign: (Number(fin?.controlMix?.roll) || 0) >= 0 ? 1 : -1,
      };
    })
    : [];
  const gridFinAssemblies = [];
  for (let i = 0; i < gridFinLayout.length; i += 1) {
    const { angle, deflectionSign, name } = gridFinLayout[i];
    const catchPinRadius = clamp(radius * 0.026, radius * 0.013, radius * 0.039);
    const catchPinLength = clamp(radius * 0.25, radius * 0.12, radius * 0.34);
    const finAssembly = createCurrentGridFinAssembly(THREE, {
      darkSteel,
      radialSpan: gridFinRadialSpan,
      chordSpan: gridFinChordSpan,
      thickness: gridFinThickness,
      angle,
      name,
      deflectionSign,
      catchPinRadius,
      catchPinLength,
    });

    finAssembly.position.set(
      Math.cos(angle) * (radius + (radius * 0.03)),
      gridFinY,
      Math.sin(angle) * (radius + (radius * 0.03)),
    );
    finAssembly.userData.gridFinIndex = i;
    boosterGroup.add(finAssembly);
    gridFinAssemblies.push(finAssembly);
  }

  const chineCount = 3;
  const chineHeight = boosterHeight * 0.34;
  const chineWidth = clamp(radius * 0.12, radius * 0.06, radius * 0.18);
  const chineDepth = clamp(radius * 0.05, radius * 0.022, radius * 0.078);
  const chineY = (0.5 * boosterHeight) - (chineHeight * 0.62);
  for (let i = 0; i < chineCount; i += 1) {
    const angle = ((i / chineCount) * Math.PI * 2) + ((Math.PI * 0.5) + (Math.PI / 3));
    const chine = new THREE.Mesh(
      new THREE.BoxGeometry(chineWidth, chineHeight, chineDepth),
      darkSteel,
    );
    chine.position.set(
      Math.cos(angle) * (radius + (chineDepth * 0.66)),
      chineY,
      Math.sin(angle) * (radius + (chineDepth * 0.66)),
    );
    chine.rotation.y = angle;
    boosterGroup.add(chine);
  }

  const engineOffsets = createSuperHeavyEngineOffsets(radius);
  const bellRadius = clamp(radius * 0.102, radius * 0.054, radius * 0.13);
  const bellHeight = clamp(radius * 0.205, radius * 0.11, radius * 0.27);
  const mountY = (-0.5 * boosterHeight) + (engineSkirtHeight * 0.06);
  const engineExitY = mountY - (bellHeight * 0.95);
  const engineVisualGroup = addRaptorReplicaCluster(THREE, boosterGroup, {
    offsets: engineOffsets,
    exitY: engineExitY,
    vehicleRadius: radius,
    darkSteel,
    stainless,
  });

  boosterGroup.userData.sharedBoosterVisual = true;

  return {
    engineOffsets,
    engineVisualGroup,
    plumeAnchorY: engineExitY,
    engineExitY,
    bellRadius,
    bellHeight,
    gridFinAssemblies,
  };
}
