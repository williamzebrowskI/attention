// starshipInlineVisual.js
import {
  BOOSTER_THRUSTER_LAYOUT,
  STARSHIP_THRUSTER_LAYOUT,
} from "./thrusterLayout.js";
import {
  applyLaunchAtmosphereEffects,
  createLaunchAtmosphereEffects,
} from "./launchAtmosphereEffects.js?v=20260421a";
import { addSharedSuperHeavyBoosterVisuals } from "./superHeavyBoosterVisual.js?v=20260421a";

/**
 * Inline dimensions (km) — your values kept as-is.
 * (9m dia, 71m booster, 50m ship => 121m stack)
 */
export const INLINE_STARSHIP_STACK_DIMENSIONS_KM = Object.freeze({
  diameterKm: 0.009,
  boosterHeightKm: 0.071,
  shipHeightKm: 0.050,
  shipNoseHeightKm: 0.015,
});

export const INLINE_STARSHIP_STACK_TOTAL_HEIGHT_KM =
  INLINE_STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm
  + INLINE_STARSHIP_STACK_DIMENSIONS_KM.shipHeightKm;

// -------------------- Visual constants --------------------
const BOOSTER_MAIN_ENGINE_PLUME_COLOR_HEX = 0xffd9a8;
const BOOSTER_RCS_JET_COLOR_HEX = 0xb5d8ff;

const STARSHIP_MAIN_ENGINE_PLUME_COLOR_HEX = 0xffe0b0;
const STARSHIP_RCS_JET_COLOR_HEX = 0xaed7ff;
const STARSHIP_NAV_BEACON_COLOR_HEX = 0xff3d2a;
const STARSHIP_NAV_BEACON_PERIOD_SEC = 2.4;
const STARSHIP_NAV_BEACON_MIN_ALPHA = 0.12;
const STARSHIP_NAV_BEACON_MAX_ALPHA = 0.98;

const BOOSTER_MAIN_PLUME_BRIGHTNESS_SCALE = 0.72;

const BOOSTER_SEA_LEVEL_PRESSURE_PA = 101_325;
const BOOSTER_RCS_Q_HALF_EFFECT_PA = 45_000;
const BOOSTER_RCS_Q_MAX_EFFECT_PA = 130_000;

const BOOSTER_FUEL_COLOR_HEX = 0x6ec8ff;
const BOOSTER_FUEL_EMISSIVE_HEX = 0x1a74bb;

const BOOSTER_PHASE_VISUAL_PROFILE = Object.freeze({
  default: Object.freeze({ mainScale: 1.0, rcsScale: 1.0, mainPulseHz: 34, rcsPulseHz: 20 }),
  separation: Object.freeze({ mainScale: 0.0, rcsScale: 1.44, mainPulseHz: 24, rcsPulseHz: 30 }),
  boostback: Object.freeze({ mainScale: 1.04, rcsScale: 0.75, mainPulseHz: 40, rcsPulseHz: 16 }),
  entry: Object.freeze({ mainScale: 0.84, rcsScale: 0.52, mainPulseHz: 30, rcsPulseHz: 14 }),
  ballistic: Object.freeze({ mainScale: 0.0, rcsScale: 0.94, mainPulseHz: 22, rcsPulseHz: 22 }),
  descent: Object.freeze({ mainScale: 0.0, rcsScale: 0.88, mainPulseHz: 22, rcsPulseHz: 20 }),
  landing: Object.freeze({ mainScale: 1.12, rcsScale: 0.62, mainPulseHz: 42, rcsPulseHz: 12 }),
  landed: Object.freeze({ mainScale: 0.0, rcsScale: 0.0, mainPulseHz: 10, rcsPulseHz: 10 }),
});

// -------------------- Helpers --------------------
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function enforceSolidOpaqueMaterial(THREE, material) {
  if (!THREE || !material) return material;
  material.transparent = false;
  material.opacity = 1;
  material.alphaTest = 0;
  material.depthWrite = true;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  material.needsUpdate = true;
  return material;
}

/**
 * yH accepts either 0..1 or -0.5..+0.5.
 * Your thruster layouts are 0..1 and/or centered already (you use -0.04, etc).
 */
function resolveThrusterDefinitions(THREE, layout, radius, bodyHeight) {
  if (!THREE || !layout || !(radius > 0) || !(bodyHeight > 0)) return [];
  return Object.entries(layout).map(([id, spec]) => {
    const xR = Number(spec?.anchor?.xR) || 0;
    const zR = Number(spec?.anchor?.zR) || 0;

    const rawYH = Number(spec?.anchor?.yH) || 0;
    const yNorm = (rawYH >= 0 && rawYH <= 1) ? (rawYH - 0.5) : rawYH;

    const dir = new THREE.Vector3(
      Number(spec?.direction?.x) || 0,
      Number(spec?.direction?.y) || 0,
      Number(spec?.direction?.z) || 0,
    );

    return {
      id,
      anchor: new THREE.Vector3(xR * radius, yNorm * bodyHeight, zR * radius),
      direction: dir.lengthSq() > 0 ? dir.normalize() : new THREE.Vector3(0, 1, 0),
    };
  });
}

/**
 * TIP-ANCHORED exhaust cone:
 * - ConeGeometry base at -Y, tip at +Y
 * - Translate so TIP is at local origin (0,0,0), base at -length
 * - Rotate so (-Y) aligns with exhaust direction
 * - Position at anchor => tip stays exactly at anchor (even when scaled)
 */
function makeTipAnchoredExhaustCone(THREE, {
  radius,
  length,
  material,
  anchor,
  direction,
  radialSegments = 28,
  renderOrder = 24,
}) {
  const L = Math.max(1e-9, Number(length) || 1e-9);
  const R = Math.max(1e-9, Number(radius) || 1e-9);

  const geom = new THREE.ConeGeometry(R, L, radialSegments, 1, true);
  geom.translate(0, -L * 0.5, 0); // tip at 0, base at -L

  const mesh = new THREE.Mesh(geom, material);
  const exhaustDir = direction.clone().normalize();

  const negY = new THREE.Vector3(0, -1, 0);
  mesh.quaternion.setFromUnitVectors(negY, exhaustDir);
  mesh.position.copy(anchor);
  mesh.renderOrder = renderOrder;

  return mesh;
}

function createInlineHotstageVentPlumes(THREE, shipGroup, radius, anchorY) {
  if (!THREE || !shipGroup || !(radius > 0) || !Number.isFinite(anchorY)) return null;
  const plumeCount = 10;
  const yAxis = new THREE.Vector3(0, 1, 0);
  const baseLength = clamp(radius * 0.9, radius * 0.4, radius * 1.35);
  const baseRadius = clamp(radius * 0.07, radius * 0.03, radius * 0.11);
  const group = new THREE.Group();
  const plumes = [];
  for (let i = 0; i < plumeCount; i += 1) {
    const angle = (i / plumeCount) * Math.PI * 2;
    const direction = new THREE.Vector3(
      Math.cos(angle) * 0.62,
      -0.78,
      Math.sin(angle) * 0.62,
    ).normalize();
    const anchor = new THREE.Vector3(
      Math.cos(angle) * (radius * 1.02),
      anchorY,
      Math.sin(angle) * (radius * 1.02),
    );
    const plume = new THREE.Mesh(
      new THREE.ConeGeometry(baseRadius, baseLength, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xffc88f),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    plume.quaternion.setFromUnitVectors(yAxis, direction.clone().negate());
    plume.position.copy(anchor).addScaledVector(direction, baseLength * 0.5);
    plume.renderOrder = 26;
    group.add(plume);
    plumes.push({ mesh: plume, direction, anchor });
  }
  group.visible = false;
  shipGroup.add(group);
  return { group, plumes, baseLength };
}

/**
 * BASE-ANCHORED nozzle bell:
 * - ConeGeometry base at -Y, tip at +Y
 * - Translate so BASE plane is at local origin (0,0,0), tip at +height
 * - Position at exit plane (base) and orient axis "up" into the vehicle
 */
function makeBaseAnchoredNozzleBell(THREE, {
  radius,
  height,
  material,
  exitAnchor,
  axisUp = new THREE.Vector3(0, 1, 0), // direction into vehicle
  radialSegments = 14,
  renderOrder = 10,
}) {
  const H = Math.max(1e-9, Number(height) || 1e-9);
  const R = Math.max(1e-9, Number(radius) || 1e-9);

  const geom = new THREE.ConeGeometry(R, H, radialSegments, 1, true);
  geom.translate(0, H * 0.5, 0); // base at 0, tip at +H

  const mesh = new THREE.Mesh(geom, material);
  const yAxis = new THREE.Vector3(0, 1, 0);
  mesh.quaternion.setFromUnitVectors(yAxis, axisUp.clone().normalize());
  mesh.position.copy(exitAnchor);
  mesh.renderOrder = renderOrder;

  return mesh;
}

/**
 * Thruster nozzle: exit plane anchored at definition.anchor.
 * Geometry extends inward (opposite exhaust) for a clean “hardpoint” look.
 */
function addStaticThrusterNozzlesTipAnchored(THREE, hostGroup, definitions, radius, material) {
  if (!THREE || !hostGroup || !Array.isArray(definitions) || definitions.length === 0) return [];

  const portLength = clamp(radius * 0.11, radius * 0.04, radius * 0.15);
  const portRadius = clamp(radius * 0.032, radius * 0.012, radius * 0.047);
  const lipThickness = clamp(portLength * 0.17, radius * 0.0024, portLength * 0.24);

  // Port tube: top (exit) at y=0, extends to y=-L
  const portGeom = new THREE.CylinderGeometry(portRadius * 0.9, portRadius, portLength, 12, 1, true);
  portGeom.translate(0, -portLength * 0.5, 0);

  // Lip ring: top at y=0, extends to y=-t
  const lipGeom = new THREE.CylinderGeometry(portRadius * 1.06, portRadius * 1.06, lipThickness, 12, 1, false);
  lipGeom.translate(0, -lipThickness * 0.5, 0);

  const yAxis = new THREE.Vector3(0, 1, 0);
  const nozzles = [];

  for (const def of definitions) {
    if (!def?.anchor || !def?.direction) continue;

    const dir = def.direction.clone().normalize();

    // We want the tube to extend inward opposite exhaust => geometry extends along -Y,
    // and we align +Y to exhaust direction (so -Y points inward).
    const q = new THREE.Quaternion().setFromUnitVectors(yAxis, dir);

    const port = new THREE.Mesh(portGeom, material.clone());
    port.quaternion.copy(q);
    port.position.copy(def.anchor);
    hostGroup.add(port);
    nozzles.push(port);

    const lip = new THREE.Mesh(lipGeom, material.clone());
    lip.quaternion.copy(q);
    lip.position.copy(def.anchor);
    hostGroup.add(lip);
    nozzles.push(lip);
  }

  return nozzles;
}

function createCircularOffsets(count, radius, phaseRadians = 0) {
  const samples = Math.max(1, Number(count) || 1);
  const ringRadius = Math.max(0, Number(radius) || 0);
  const offsets = [];
  for (let i = 0; i < samples; i += 1) {
    const angle = ((i / samples) * Math.PI * 2) + phaseRadians;
    offsets.push({ x: Math.cos(angle) * ringRadius, z: Math.sin(angle) * ringRadius });
  }
  return offsets;
}

// Ship: 3 outer + 3 inner
function createStarship6EngineOffsets(radius) {
  const outerRingRadius = clamp(radius * 0.44, radius * 0.16, radius * 0.5);
  const innerRingRadius = clamp(radius * 0.21, radius * 0.08, radius * 0.27);

  return [
    ...createCircularOffsets(3, outerRingRadius, 0),
    ...createCircularOffsets(3, innerRingRadius, Math.PI / 3),
  ];
}

// Booster: 20 + 10 + 3
function createSuperHeavyEngineOffsets(radius) {
  return createSuperHeavyEngineDescriptors(radius, 0).map((descriptor) => ({
    x: Number(descriptor?.x) || 0,
    z: Number(descriptor?.z) || 0,
  }));
}

// -------------------- Booster: geometry + engines (perfect exit plane returned) --------------------
function addInlineSuperHeavyBooster(THREE, boosterGroup, stainless, darkSteel, radius, boosterHeight) {
  return addSharedSuperHeavyBoosterVisuals(THREE, boosterGroup, {
    stainless,
    darkSteel,
    radius,
    boosterHeight,
  });

  // Body
  const boosterBody = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, boosterHeight, 48, 1, false),
    stainless,
  );
  boosterGroup.add(boosterBody);

  // Engine skirt
  const engineSkirtHeight = clamp(boosterHeight * 0.16, radius * 0.8, boosterHeight * 0.22);
  const engineSkirt = new THREE.Mesh(
    // Slightly exaggerated radius to avoid z-fighting at extreme true-scale camera ranges.
    new THREE.CylinderGeometry(radius * 1.045, radius * 1.045, engineSkirtHeight, 48, 1, false),
    darkSteel,
  );
  engineSkirt.position.y = (-0.5 * boosterHeight) + (0.5 * engineSkirtHeight);
  boosterGroup.add(engineSkirt);

  // V3/Raptor3-era cue: metallic thermal tiles around the aft section.
  const aftTileRows = 2;
  const aftTileCountPerRow = 30;
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
    const y = (-0.5 * boosterHeight)
      + (aftTileHeight * (0.7 + (row * 1.18)));
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

  // Top cap
  const topCap = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.5),
    stainless,
  );
  topCap.position.y = 0.5 * boosterHeight;
  boosterGroup.add(topCap);

  // V3-style integrated hot-stage section: open truss + dual rings.
  const hotstageH = clamp(boosterHeight * 0.066, radius * 0.36, boosterHeight * 0.11);
  const trussRingThickness = clamp(hotstageH * 0.15, radius * 0.035, hotstageH * 0.24);
  const trussOuterRadius = radius * 1.07;
  const trussInnerRadius = radius * 1.01;
  const hotStageLowerY = (0.5 * boosterHeight) + (hotstageH * 0.16);
  const hotStageUpperY = hotStageLowerY + (hotstageH * 0.84);

  const lowerRing = new THREE.Mesh(
    new THREE.CylinderGeometry(trussOuterRadius, trussOuterRadius, trussRingThickness, 48, 1, true),
    darkSteel,
  );
  lowerRing.position.y = hotStageLowerY;
  boosterGroup.add(lowerRing);

  const upperRing = new THREE.Mesh(
    new THREE.CylinderGeometry(trussOuterRadius * 1.01, trussOuterRadius * 1.01, trussRingThickness, 48, 1, true),
    darkSteel,
  );
  upperRing.position.y = hotStageUpperY;
  boosterGroup.add(upperRing);

  const blastDeck = new THREE.Mesh(
    new THREE.CylinderGeometry(trussInnerRadius, radius * 0.985, trussRingThickness * 1.3, 42, 1, false),
    darkSteel,
  );
  blastDeck.position.y = hotStageLowerY - (trussRingThickness * 0.8);
  boosterGroup.add(blastDeck);

  const trussCount = 24;
  const trussWidth = clamp(radius * 0.018, radius * 0.008, radius * 0.028);
  const trussDepth = clamp(radius * 0.016, radius * 0.007, radius * 0.024);
  const trussPhase = Math.PI / trussCount;
  const trussRadiusA = trussOuterRadius * 0.995;
  const trussRadiusB = trussOuterRadius * 1.015;

  function addTrussStrut(start, end) {
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (!(length > 1e-12)) return;
    const strut = new THREE.Mesh(
      new THREE.BoxGeometry(trussWidth, length, trussDepth),
      darkSteel,
    );
    strut.position.copy(start).add(end).multiplyScalar(0.5);
    strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    boosterGroup.add(strut);
  }

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
    addTrussStrut(startA, endB);

    if ((i % 2) === 0) {
      const endC = new THREE.Vector3(
        Math.cos(angleC) * trussRadiusB,
        hotStageUpperY - (trussRingThickness * 0.46),
        Math.sin(angleC) * trussRadiusB,
      );
      addTrussStrut(startA, endC);
    }
  }

  // Seams
  const seamFractions = [0.12, 0.24, 0.36, 0.5, 0.64, 0.78, 0.9];
  const seamTubeRadius = clamp(radius * 0.0056, radius * 0.0022, radius * 0.009);
  for (const fraction of seamFractions) {
    const seam = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.015, seamTubeRadius, 8, 42), darkSteel);
    seam.rotation.x = Math.PI * 0.5;
    seam.position.y = (-0.5 * boosterHeight) + (fraction * boosterHeight);
    boosterGroup.add(seam);
  }

  // Stringers
  const stringerCount = 18;
  const stringerHeight = boosterHeight * 0.68;
  const stringerWidth = clamp(radius * 0.018, radius * 0.0075, radius * 0.028);
  const stringerDepth = clamp(radius * 0.008, radius * 0.003, radius * 0.014);
  for (let i = 0; i < stringerCount; i += 1) {
    const angle = (i / stringerCount) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(stringerWidth, stringerHeight, stringerDepth), darkSteel);
    rib.position.set(
      Math.cos(angle) * (radius + stringerDepth),
      (-0.5 * boosterHeight) + (stringerHeight * 0.54),
      Math.sin(angle) * (radius + stringerDepth),
    );
    rib.rotation.y = angle;
    boosterGroup.add(rib);
  }

  // V3-style grid fins: 3 fins, larger and mounted lower.
  const gridFinWidth = clamp(radius * 1.24, radius * 0.76, radius * 1.5);
  const gridFinHeight = clamp(radius * 0.96, radius * 0.46, radius * 1.22);
  const gridFinDepth = clamp(radius * 0.19, radius * 0.09, radius * 0.28);
  const gridFinY = (0.5 * boosterHeight) - (radius * 1.04);
  const gridFinCount = 3;
  const gridFinPhase = Math.PI * 0.5;
  for (let i = 0; i < gridFinCount; i += 1) {
    const angle = ((i / gridFinCount) * Math.PI * 2) + gridFinPhase;
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
    finAssembly.add(panel);

    const latticeBarWidth = gridFinWidth * 0.03;
    const latticeBarHeight = gridFinHeight * 0.86;
    const latticeBarDepth = gridFinDepth * 0.68;
    for (let barIndex = -2; barIndex <= 2; barIndex += 1) {
      const verticalBar = new THREE.Mesh(
        new THREE.BoxGeometry(latticeBarWidth, latticeBarHeight, latticeBarDepth),
        darkSteel,
      );
      verticalBar.position.x = barIndex * (gridFinWidth * 0.13);
      finAssembly.add(verticalBar);
    }
    for (let barIndex = -1; barIndex <= 1; barIndex += 1) {
      const horizontalBar = new THREE.Mesh(
        new THREE.BoxGeometry(gridFinWidth * 0.84, gridFinHeight * 0.034, latticeBarDepth),
        darkSteel,
      );
      horizontalBar.position.y = barIndex * (gridFinHeight * 0.2);
      finAssembly.add(horizontalBar);
    }

    const finPod = new THREE.Mesh(
      new THREE.BoxGeometry(gridFinWidth * 0.34, gridFinHeight * 0.3, gridFinDepth * 1.55),
      darkSteel,
    );
    finPod.position.x = -(gridFinWidth * 0.4);
    finAssembly.add(finPod);

    finAssembly.position.set(
      Math.cos(angle) * (radius + (gridFinDepth * 0.42)),
      gridFinY,
      Math.sin(angle) * (radius + (gridFinDepth * 0.42)),
    );
    finAssembly.rotation.y = angle;
    boosterGroup.add(finAssembly);

    const catchPinRadius = clamp(radius * 0.026, radius * 0.013, radius * 0.039);
    const catchPinLength = clamp(radius * 0.25, radius * 0.12, radius * 0.34);
    const catchPin = new THREE.Mesh(
      new THREE.CylinderGeometry(catchPinRadius, catchPinRadius, catchPinLength, 12, 1, false),
      darkSteel,
    );
    catchPin.rotation.z = Math.PI * 0.5;
    catchPin.rotation.y = angle;
    catchPin.position.set(
      Math.cos(angle) * (radius + (catchPinLength * 0.34)),
      gridFinY + (gridFinHeight * 0.35),
      Math.sin(angle) * (radius + (catchPinLength * 0.34)),
    );
    boosterGroup.add(catchPin);
  }

  const chineCount = 3;
  const chineHeight = boosterHeight * 0.34;
  const chineWidth = clamp(radius * 0.12, radius * 0.06, radius * 0.18);
  const chineDepth = clamp(radius * 0.05, radius * 0.022, radius * 0.078);
  const chineY = (0.5 * boosterHeight) - (chineHeight * 0.62);
  for (let i = 0; i < chineCount; i += 1) {
    const angle = ((i / chineCount) * Math.PI * 2) + (gridFinPhase + (Math.PI / 3));
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

  // ---------------- PERFECT engine bells (exit plane shared with plumes) ----------------
  const engineOffsets = createSuperHeavyEngineOffsets(radius);

  const bellRadius = clamp(radius * 0.102, radius * 0.054, radius * 0.13);
  const bellHeight = clamp(radius * 0.205, radius * 0.11, radius * 0.27);

  // Place exit plane below the booster bottom by ~0.95 bell heights so the bell tip sits near the mount.
  const mountY = (-0.5 * boosterHeight) + (engineSkirtHeight * 0.06);
  const engineExitY = mountY - (bellHeight * 0.95);

  const engineVisualGroup = addRaptorReplicaCluster(THREE, boosterGroup, {
    offsets: engineOffsets,
    exitY: engineExitY,
    vehicleRadius: radius,
    darkSteel,
    stainless,
  });

  return {
    engineOffsets,
    engineVisualGroup,
    engineExitY,
    bellRadius,
    bellHeight,
  };
}

// -------------------- Plume clusters (tip anchored) --------------------
function createEnginePlumeCluster(THREE, stageGroup, options = {}) {
  if (!THREE || !stageGroup) return null;

  const offsets = Array.isArray(options.offsets) && options.offsets.length > 0
    ? options.offsets
    : [{ x: 0, z: 0 }];

  const anchorY = Number(options.anchorY) || 0;
  const plumeLength = Math.max(1e-12, Number(options.plumeLength) || 1e-6);
  const plumeRadius = Math.max(1e-12, Number(options.plumeRadius) || 1e-6);
  const nozzleRadius = Math.max(1e-12, Number(options.nozzleRadius) || (plumeRadius * 0.84));
  const radialSegments = Math.max(20, Number(options.radialSegments) || 36);

  const outerColor = new THREE.Color(options.colorHex || BOOSTER_MAIN_ENGINE_PLUME_COLOR_HEX);
  const coreColor = new THREE.Color(0xfff4de);

  const cluster = new THREE.Group();
  cluster.visible = false;
  cluster.renderOrder = 24;

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

  const entries = [];
  const plumeOuterLength = plumeLength * 1.04;
  const plumeCoreLength = plumeLength * 0.88;
  const plumeOuterGeom = new THREE.CylinderGeometry(
    nozzleRadius * 0.98,
    Math.max(nozzleRadius * 1.08, plumeRadius * 1.02),
    plumeOuterLength,
    radialSegments,
    1,
    true,
  );
  plumeOuterGeom.translate(0, -(plumeOuterLength * 0.5), 0);
  const plumeCoreGeom = new THREE.CylinderGeometry(
    nozzleRadius * 0.48,
    Math.max(nozzleRadius * 0.56, plumeRadius * 0.34),
    plumeCoreLength,
    radialSegments,
    1,
    true,
  );
  plumeCoreGeom.translate(0, -(plumeCoreLength * 0.5), 0);

  for (const offset of offsets) {
    const anchor = new THREE.Vector3(Number(offset?.x) || 0, anchorY, Number(offset?.z) || 0);

    const plumeOuter = new THREE.Mesh(plumeOuterGeom, plumeTemplateMaterial.clone());
    plumeOuter.position.copy(anchor);
    plumeOuter.renderOrder = 24;
    const plumeCore = new THREE.Mesh(plumeCoreGeom, coreTemplateMaterial.clone());
    plumeCore.position.copy(anchor);
    plumeCore.renderOrder = 25;

    cluster.add(plumeOuter);
    cluster.add(plumeCore);
    entries.push({
      plume: plumeOuter,
      plumeOuter,
      plumeCore,
      outerBaseColor: outerColor.clone(),
      outerHotColor: new THREE.Color(0xfff7ea),
      coreBaseColor: coreColor.clone(),
      coreHotColor: new THREE.Color(0xffffff),
    });
  }

  stageGroup.add(cluster);
  return { cluster, entries };
}

function normalizeInlineEngineIndexArray(values, limit = Infinity) {
  if (!Array.isArray(values)) {
    return [];
  }
  const maxLimit = Math.max(0, Number(limit) || 0);
  const seen = new Set();
  const normalized = [];
  for (const value of values) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    const index = Math.round(numeric);
    if (index < 0 || index >= maxLimit || seen.has(index)) {
      continue;
    }
    seen.add(index);
    normalized.push(index);
  }
  return normalized;
}

function sliceInlineLocalEngineIndexArray(values, startIndex, count) {
  if (!Array.isArray(values)) {
    return null;
  }
  const start = Math.max(0, Number(startIndex) || 0);
  const limit = start + Math.max(0, Number(count) || 0);
  const localized = [];
  for (const value of values) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    const index = Math.round(numeric);
    if (index >= start && index < limit) {
      localized.push(index - start);
    }
  }
  return localized;
}

function sliceInlineLocalEngineValueArray(values, startIndex, count) {
  if (!Array.isArray(values)) {
    return null;
  }
  const start = Math.max(0, Number(startIndex) || 0);
  const width = Math.max(0, Number(count) || 0);
  return values.slice(start, start + width).map((value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  });
}

// -------------------- RCS jets (tip anchored + nozzles tip-anchored) --------------------
function createRcsJetVisuals(THREE, stageGroup, radius, bodyHeight, layout, colorHex, nozzleMaterial) {
  if (!THREE || !stageGroup || !(radius > 0) || !(bodyHeight > 0) || !layout) return null;

  const plumeLength = clamp(bodyHeight * 0.028, radius * 0.18, bodyHeight * 0.062);
  const plumeRadius = clamp(radius * 0.03, radius * 0.012, radius * 0.048);
  const glowRadius = clamp(radius * 0.02, radius * 0.009, radius * 0.036);

  const plumeTemplateMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colorHex),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const glowTemplateMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colorHex),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

  const definitions = resolveThrusterDefinitions(THREE, layout, radius, bodyHeight);

  // Perfect nozzle placement: exit plane at anchor, tube extends inward.
  addStaticThrusterNozzlesTipAnchored(THREE, stageGroup, definitions, radius, nozzleMaterial);

  const jets = {};
  for (const def of definitions) {
    const group = new THREE.Group();
    group.visible = false;

    const plume = makeTipAnchoredExhaustCone(THREE, {
      radius: plumeRadius,
      length: plumeLength,
      material: plumeTemplateMaterial.clone(),
      anchor: def.anchor,
      direction: def.direction, // treat layout direction as exhaust direction (matches your authored data)
      radialSegments: 10,
      renderOrder: 24,
    });

    const glow = new THREE.Mesh(new THREE.SphereGeometry(glowRadius, 8, 8), glowTemplateMaterial.clone());
    glow.position.copy(def.anchor);
    glow.renderOrder = 25;

    group.add(plume);
    group.add(glow);
    stageGroup.add(group);

    jets[def.id] = { group, plume, glow };
  }

  return jets;
}

// -------------------- Booster fuel visual (kept) --------------------
function createBoosterFuelVisual(THREE, boosterGroup, radius, boosterHeight) {
  if (!THREE || !boosterGroup || !(radius > 0) || !(boosterHeight > 0)) return null;

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

function applyBoosterFuelFill(fuelVisual, fuelFraction) {
  if (!fuelVisual?.fluid) return;
  const level = clamp(Number(fuelFraction), 0, 1);
  const fillScaleY = Math.max(fuelVisual.minFillScaleY || 0.01, level);
  fuelVisual.fluid.scale.set(1, fillScaleY, 1);
  fuelVisual.fluid.position.y = (fuelVisual.tankBottomY || 0) + ((fuelVisual.tankHeight || 0) * fillScaleY * 0.5);
  if (fuelVisual.fluid.material && !Array.isArray(fuelVisual.fluid.material)) {
    fuelVisual.fluid.material.opacity = 0.16 + (level * 0.3);
    fuelVisual.fluid.material.emissiveIntensity = 0.12 + (level * 0.28);
  }
}

// -------------------- Booster plume update logic (kept) --------------------
function boosterPhaseVisualProfile(phaseRaw) {
  const phase = String(phaseRaw || "").toLowerCase();
  if (!phase) return BOOSTER_PHASE_VISUAL_PROFILE.default;
  if (phase.includes("landed")) return BOOSTER_PHASE_VISUAL_PROFILE.landed;
  if (phase.includes("boostback")) return BOOSTER_PHASE_VISUAL_PROFILE.boostback;
  if (phase.includes("entry")) return BOOSTER_PHASE_VISUAL_PROFILE.entry;
  if (phase.includes("landing")) return BOOSTER_PHASE_VISUAL_PROFILE.landing;
  if (phase.includes("separation")) return BOOSTER_PHASE_VISUAL_PROFILE.separation;
  if (phase.includes("ballistic")) return BOOSTER_PHASE_VISUAL_PROFILE.ballistic;
  if (phase.includes("descent")) return BOOSTER_PHASE_VISUAL_PROFILE.descent;
  return BOOSTER_PHASE_VISUAL_PROFILE.default;
}

function setEnginePlumeVisual(plumeState, firing, throttle = 0, pulse = 1, options = {}) {
  if (!plumeState?.cluster || !Array.isArray(plumeState.entries)) return;

  const nowMs = Date.now();
  const targetFiring = Boolean(firing);
  const wasTargetFiring = Boolean(plumeState.targetFiring);
  if (!targetFiring && wasTargetFiring) {
    plumeState.shutdownHoldUntilMs = nowMs + 140;
  }
  plumeState.targetFiring = targetFiring;
  if (targetFiring) {
    plumeState.activeEntryIndexSet = Array.isArray(options.activeIndices) && options.activeIndices.length > 0
      ? new Set(normalizeInlineEngineIndexArray(options.activeIndices, plumeState.entries.length))
      : null;
    plumeState.faultedEntryIndexSet = Array.isArray(options.faultedIndices) && options.faultedIndices.length > 0
      ? new Set(normalizeInlineEngineIndexArray(options.faultedIndices, plumeState.entries.length))
      : null;
    plumeState.flameEntryIndexSet = Array.isArray(options.flamePresentIndices) && options.flamePresentIndices.length > 0
      ? new Set(normalizeInlineEngineIndexArray(options.flamePresentIndices, plumeState.entries.length))
      : null;
    plumeState.chamberPressurePaByIndex = Array.isArray(options.chamberPressurePaByIndex)
      ? [...options.chamberPressurePaByIndex]
      : null;
    plumeState.exhaustTemperatureKByIndex = Array.isArray(options.exhaustTemperatureKByIndex)
      ? [...options.exhaustTemperatureKByIndex]
      : null;
    plumeState.nominalChamberPressurePa = Number(options.nominalChamberPressurePa) || 0;
    plumeState.nominalExhaustTemperatureK = Number(options.nominalExhaustTemperatureK) || 0;
  }
  const fadeOutHold = Number(plumeState.shutdownHoldUntilMs) > nowMs;
  const visible = targetFiring || fadeOutHold;

  plumeState.cluster.visible = visible;
  if (!visible) {
    plumeState.smoothedThrottle = 0;
    plumeState.activeEntryIndexSet = null;
    plumeState.faultedEntryIndexSet = null;
    plumeState.flameEntryIndexSet = null;
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
  const stretch = (0.82 + (t * 2.1)) * expansionScale;
  const radiusScale = (0.98 + (t * 0.08)) * (0.96 + (vacuumExpansion * 0.16));
  const nowSec = Date.now() / 1000;
  const activeEntryIndexSet = plumeState.activeEntryIndexSet instanceof Set
    ? plumeState.activeEntryIndexSet
    : null;
  const faultedEntryIndexSet = plumeState.faultedEntryIndexSet instanceof Set
    ? plumeState.faultedEntryIndexSet
    : null;
  const flameEntryIndexSet = plumeState.flameEntryIndexSet instanceof Set
    ? plumeState.flameEntryIndexSet
    : null;
  const chamberPressurePaByIndex = Array.isArray(plumeState.chamberPressurePaByIndex)
    ? plumeState.chamberPressurePaByIndex
    : null;
  const exhaustTemperatureKByIndex = Array.isArray(plumeState.exhaustTemperatureKByIndex)
    ? plumeState.exhaustTemperatureKByIndex
    : null;
  const nominalChamberPressurePa = Math.max(
    1,
    Number(plumeState.nominalChamberPressurePa)
      || Number(options.nominalChamberPressurePa)
      || 1,
  );
  const nominalExhaustTemperatureK = Math.max(
    1000,
    Number(plumeState.nominalExhaustTemperatureK)
      || Number(options.nominalExhaustTemperatureK)
      || 3400,
  );
  const exhaustBaselineK = 900;
  for (let index = 0; index < plumeState.entries.length; index += 1) {
    const entry = plumeState.entries[index];
    if (!entry) continue;
    const selected = !activeEntryIndexSet || activeEntryIndexSet.has(index);
    const faulted = Boolean(faultedEntryIndexSet?.has(index));
    const flamePresent = !faulted && (
      flameEntryIndexSet instanceof Set
        ? flameEntryIndexSet.has(index)
        : selected
    );
    const chamberPressurePa = Number(chamberPressurePaByIndex?.[index]);
    const exhaustTemperatureK = Number(exhaustTemperatureKByIndex?.[index]);
    const chamberNorm = flamePresent
      ? (
        Number.isFinite(chamberPressurePa) && chamberPressurePa > 0
          ? clamp(chamberPressurePa / nominalChamberPressurePa, 0, 1.12)
          : 1
      )
      : 0;
    const thermalNorm = flamePresent
      ? (
        Number.isFinite(exhaustTemperatureK) && exhaustTemperatureK > 0
          ? clamp(
            (exhaustTemperatureK - exhaustBaselineK)
              / Math.max(nominalExhaustTemperatureK - exhaustBaselineK, 1),
            0,
            1.12,
          )
          : chamberNorm
      )
      : 0;
    const engineDrive = flamePresent
      ? clamp((0.34 + (0.66 * chamberNorm)) * (0.78 + (0.22 * t)), 0, 1.2)
      : 0;
    const turbulence = 0.975 + (0.045 * Math.sin((nowSec * 8.0) + (index * 1.53)));
    const flicker = 0.992 + (0.016 * Math.sin((nowSec * 3.4) + (index * 2.11)));
    const opacityScale = flamePresent ? engineDrive : 0;
    const heatBlend = clamp((thermalNorm * 0.82) + (chamberNorm * 0.18), 0, 1);

    // TIP-ANCHORED cones: scaling preserves the tip location perfectly.
    if (entry.plumeOuter?.scale) {
      entry.plumeOuter.scale.set(
        radiusScale * (0.96 + (0.08 * chamberNorm)),
        stretch * turbulence * (0.9 + (0.28 * chamberNorm)),
        radiusScale * (0.96 + (0.08 * chamberNorm)),
      );
    }
    if (entry.plumeOuter?.material && !Array.isArray(entry.plumeOuter.material)) {
      if (entry.outerBaseColor && entry.outerHotColor) {
        entry.plumeOuter.material.color.copy(entry.outerBaseColor).lerp(entry.outerHotColor, heatBlend);
      }
      entry.plumeOuter.material.opacity = clamp(
        plumeOpacity * BOOSTER_MAIN_PLUME_BRIGHTNESS_SCALE * 0.78 * flicker * opacityScale,
        0,
        1,
      );
    }
    if (entry.plumeCore?.scale) {
      entry.plumeCore.scale.set(
        radiusScale * 0.74 * (0.92 + (0.1 * chamberNorm)),
        stretch * turbulence * 0.86 * (0.92 + (0.24 * chamberNorm)),
        radiusScale * 0.74 * (0.92 + (0.1 * chamberNorm)),
      );
    }
    if (entry.plumeCore?.material && !Array.isArray(entry.plumeCore.material)) {
      if (entry.coreBaseColor && entry.coreHotColor) {
        entry.plumeCore.material.color.copy(entry.coreBaseColor).lerp(entry.coreHotColor, heatBlend);
      }
      entry.plumeCore.material.opacity = clamp(
        plumeOpacity * BOOSTER_MAIN_PLUME_BRIGHTNESS_SCALE * 1.05 * flicker * opacityScale,
        0,
        1,
      );
    }

  }
}

function updateRcsJetVisuals(jets, requestedJets, active, authority, pulseHz = 20) {
  if (!jets) return;

  const requestedJetSet = new Set((requestedJets || []).map((j) => String(j || "").toLowerCase()));
  const pulse = 0.86 + (0.14 * Math.sin((Date.now() / 1000) * Math.max(6, pulseHz)));

  const opacity = (0.16 + (authority * 0.48)) * pulse;
  const stretch = 0.7 + (authority * 0.92);
  const radiusScale = 0.8 + (authority * 0.6);
  const glowScale = 0.78 + (authority * 1.04);

  for (const [jetName, entry] of Object.entries(jets)) {
    const firing = Boolean(active) && requestedJetSet.has(jetName) && authority > 0.01;
    entry.group.visible = firing;
    if (!firing) continue;

    if (entry.plume?.scale) entry.plume.scale.set(radiusScale, stretch, radiusScale);
    if (entry.plume?.material && !Array.isArray(entry.plume.material)) entry.plume.material.opacity = opacity;

    if (entry.glow?.scale) entry.glow.scale.set(glowScale, glowScale, glowScale);
    if (entry.glow?.material && !Array.isArray(entry.glow.material)) entry.glow.material.opacity = opacity * 0.92;
  }
}

function createInlineNavigationBeaconVisual(THREE, hostGroup, radius, topY) {
  if (!THREE || !hostGroup || !(radius > 0) || !Number.isFinite(topY)) return null;
  const group = new THREE.Group();
  group.position.set(0, topY, 0);
  group.renderOrder = 34;
  group.visible = true;

  const coreRadius = clamp(radius * 0.09, radius * 0.04, radius * 0.14);
  const haloRadius = coreRadius * 2.8;
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(STARSHIP_NAV_BEACON_COLOR_HEX),
    transparent: true,
    opacity: STARSHIP_NAV_BEACON_MIN_ALPHA,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xff7a56),
    transparent: true,
    opacity: STARSHIP_NAV_BEACON_MIN_ALPHA * 0.6,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

  const core = new THREE.Mesh(new THREE.SphereGeometry(coreRadius, 12, 12), coreMaterial);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(haloRadius, 12, 12), haloMaterial);
  core.renderOrder = 35;
  halo.renderOrder = 34;
  halo.scale.set(1, 0.64, 1);
  group.add(core);
  group.add(halo);
  hostGroup.add(group);
  return {
    group,
    core,
    halo,
    coreMaterial,
    haloMaterial,
    periodSec: STARSHIP_NAV_BEACON_PERIOD_SEC,
    phaseOffsetSec: Math.random() * STARSHIP_NAV_BEACON_PERIOD_SEC,
  };
}

function updateInlineNavigationBeaconVisual(stageState) {
  const beacon = stageState?.navigationBeacon;
  if (!beacon?.group || !beacon?.coreMaterial || !beacon?.haloMaterial) return;
  const periodSec = Math.max(0.2, Number(beacon.periodSec) || STARSHIP_NAV_BEACON_PERIOD_SEC);
  const phaseOffsetSec = Number.isFinite(Number(beacon.phaseOffsetSec))
    ? Number(beacon.phaseOffsetSec)
    : 0;
  const cycle = (((Date.now() / 1000) + phaseOffsetSec) % periodSec) / periodSec;
  const blink = Math.pow(Math.max(0, Math.sin(cycle * Math.PI)), 1.8);
  const alpha = STARSHIP_NAV_BEACON_MIN_ALPHA
    + ((STARSHIP_NAV_BEACON_MAX_ALPHA - STARSHIP_NAV_BEACON_MIN_ALPHA) * blink);
  const haloAlpha = clamp(alpha * 0.72, 0.05, 0.88);
  const haloScale = 0.84 + (blink * 0.5);
  beacon.group.visible = true;
  beacon.coreMaterial.opacity = alpha;
  beacon.haloMaterial.opacity = haloAlpha;
  if (beacon.core?.scale) {
    const coreScale = 0.92 + (blink * 0.22);
    beacon.core.scale.set(coreScale, coreScale, coreScale);
  }
  if (beacon.halo?.scale) {
    beacon.halo.scale.set(haloScale, haloScale * 0.64, haloScale);
  }
}

function updateInlineHotstageVentPlumes(stageState, snapshot) {
  const ventState = stageState?.hotstageVentPlumes;
  if (!ventState?.group || !Array.isArray(ventState.plumes)) return;
  const active = Boolean(snapshot?.hotstageActive) && !Boolean(snapshot?.boosterActive);
  const thrustNorm = clamp(Number(snapshot?.throttle) || 0, 0, 1);
  const overlapSec = Math.max(0.001, Number(snapshot?.hotstageOverlapSeconds) || 1);
  const timeSinceIgnitionSec = Math.max(0, Number(snapshot?.hotstageTimeSinceIgnitionSec) || 0);
  const progress = clamp(timeSinceIgnitionSec / overlapSec, 0, 1);
  const pulse = 0.88 + (0.12 * Math.sin((Date.now() / 1000) * 34));
  const intensity = active
    ? clamp(0.26 + (0.56 * thrustNorm) + (0.18 * progress), 0, 1)
    : 0;
  ventState.group.visible = intensity > 0.01;
  for (const entry of ventState.plumes) {
    const mesh = entry?.mesh;
    if (!mesh?.material || Array.isArray(mesh.material)) continue;
    const lengthScale = 0.7 + (0.95 * intensity);
    const radiusScale = 0.78 + (0.42 * intensity);
    mesh.scale.set(radiusScale, lengthScale, radiusScale);
    mesh.position.copy(entry.anchor).addScaledVector(entry.direction, ventState.baseLength * lengthScale * 0.5);
    mesh.material.opacity = clamp(0.06 + (0.24 * intensity * pulse), 0, 0.34);
  }
}

// -------------------- Public API: Booster visuals --------------------
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

  const boosterVisual = addInlineSuperHeavyBooster(THREE, boosterGroup, stainless, darkSteel, radius, boosterHeight);

  const mainEnginePlume = createEnginePlumeCluster(THREE, boosterGroup, {
    offsets: boosterVisual.engineOffsets,
    anchorY: boosterVisual.engineExitY, // PERFECT: exact nozzle exit plane
    plumeLength: clamp(boosterHeight * 0.052, radius * 0.18, boosterHeight * 0.1),
    plumeRadius: clamp(boosterVisual.bellRadius * 1.18, boosterVisual.bellRadius * 1.04, boosterVisual.bellRadius * 1.28),
    nozzleRadius: clamp(boosterVisual.bellRadius * 0.96, boosterVisual.bellRadius * 0.88, boosterVisual.bellRadius),
    colorHex: BOOSTER_MAIN_ENGINE_PLUME_COLOR_HEX,
  });

  const rcsJets = createRcsJetVisuals(
    THREE,
    boosterGroup,
    radius,
    boosterHeight,
    BOOSTER_THRUSTER_LAYOUT,
    BOOSTER_RCS_JET_COLOR_HEX,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0x6a727f), roughness: 0.6, metalness: 0.52 }),
  );

  const boosterFuelVisual = createBoosterFuelVisual(THREE, boosterGroup, radius, boosterHeight);

  return {
    root,
    materials: [stainless, darkSteel],
    state: {
      boosterGroup,
      mainEnginePlume,
      rcsJets,
      boosterFuelVisual,
      atmosphereEffects: createLaunchAtmosphereEffects(THREE, {
        stage0BodyHeightScene: boosterHeight,
        stage2BodyHeightScene: boosterHeight,
      }),
    },
    physical: {
      radiusScene: Math.max(radius, boosterHeight * 0.5),
    },
  };
}

export function applyInlineBoosterManeuverVisuals(boosterState, snapshot = null) {
  if (!boosterState) return;

  if (!snapshot) {
    setEnginePlumeVisual(boosterState.mainEnginePlume, false, 0, 1);
    updateRcsJetVisuals(boosterState.rcsJets, [], false, 0, 10);
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

  setEnginePlumeVisual(
    boosterState.mainEnginePlume,
    firing,
    effectiveThrottle,
    pulse,
    {
      activeIndices: Array.isArray(snapshot?.boosterActiveEngineIndices)
        ? snapshot.boosterActiveEngineIndices
        : null,
      failedIndices: Array.isArray(snapshot?.boosterFailedEngineIndices)
        ? snapshot.boosterFailedEngineIndices
        : null,
      faultedIndices: Array.isArray(snapshot?.boosterFaultedEngineIndices)
        ? snapshot.boosterFaultedEngineIndices
        : null,
      flamePresentIndices: Array.isArray(snapshot?.boosterFlamePresentIndices)
        ? snapshot.boosterFlamePresentIndices
        : null,
      chamberPressurePaByIndex: Array.isArray(snapshot?.boosterChamberPressurePaByIndex)
        ? snapshot.boosterChamberPressurePaByIndex
        : null,
      exhaustTemperatureKByIndex: Array.isArray(snapshot?.boosterExhaustTemperatureKByIndex)
        ? snapshot.boosterExhaustTemperatureKByIndex
        : null,
      nominalChamberPressurePa: Number(snapshot?.boosterMaxChamberPressurePa)
        || Number(snapshot?.boosterAvgChamberPressurePa)
        || 0,
      nominalExhaustTemperatureK: Number(snapshot?.boosterMaxExhaustTemperatureK) || 0,
      pressurePa: Number(snapshot.boosterPressurePa) || 0,
      phaseScale: mainScale,
    },
  );

  // RCS
  const requestedJets = Array.isArray(snapshot?.boosterRcsJets) ? snapshot.boosterRcsJets : [];
  const active = Boolean(snapshot?.boosterRcsActive) && requestedJets.length > 0;

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

  updateRcsJetVisuals(
    boosterState.rcsJets,
    requestedJets,
    active,
    authority,
    Math.max(6, Number(phaseProfile?.rcsPulseHz) || 20),
  );
}

export function applyInlineBoosterFuelVisuals(boosterState, options = null) {
  const fuelVisual = boosterState?.boosterFuelVisual;
  if (!fuelVisual?.group) return;

  const enabled = Boolean(options?.enabled);
  fuelVisual.group.visible = enabled;
  if (!enabled) return;

  const level = Number.isFinite(Number(options?.fuelFraction)) ? Number(options.fuelFraction) : 1;
  applyBoosterFuelFill(fuelVisual, level);
}

// -------------------- Public API: Full stack visuals (perfect engines + plumes + RCS) --------------------
function addInlineStarshipEngines(THREE, shipGroup, material, radius, shipHeight) {
  // 3 outer (vac) + 3 inner (sea)
  const offsets = createStarship6EngineOffsets(radius);
  const outerRingRadius = clamp(radius * 0.44, radius * 0.16, radius * 0.5);
  const innerRingRadius = clamp(radius * 0.21, radius * 0.08, radius * 0.27);

  // Visual sizing (your style, but consistent)
  const vacR = clamp(radius * 0.165, radius * 0.078, radius * 0.2);
  const vacH = clamp(radius * 0.26, radius * 0.12, radius * 0.31);
  const seaR = clamp(vacR * 0.82, vacR * 0.7, vacR * 0.9);
  const seaH = clamp(vacH * 0.82, vacH * 0.72, vacH * 0.9);

  const mountY = -0.5 * shipHeight; // bottom of ship body
  const vacExitY = mountY - (vacH * 0.95);
  const seaExitY = mountY - (seaH * 0.95);

  const vacOffsets = [];
  const seaOffsets = [];

  // Outer 3 (phase 0)
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2;
    const x = Math.cos(a) * outerRingRadius;
    const z = Math.sin(a) * outerRingRadius;

    const bell = makeBaseAnchoredNozzleBell(THREE, {
      radius: vacR,
      height: vacH,
      material,
      exitAnchor: new THREE.Vector3(x, vacExitY, z),
      axisUp: new THREE.Vector3(0, 1, 0),
      radialSegments: 14,
      renderOrder: 8,
    });
    shipGroup.add(bell);
    vacOffsets.push({ x, z });
  }

  // Inner 3 (phase 60°)
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2 + (Math.PI / 3);
    const x = Math.cos(a) * innerRingRadius;
    const z = Math.sin(a) * innerRingRadius;

    const bell = makeBaseAnchoredNozzleBell(THREE, {
      radius: seaR,
      height: seaH,
      material,
      exitAnchor: new THREE.Vector3(x, seaExitY, z),
      axisUp: new THREE.Vector3(0, 1, 0),
      radialSegments: 14,
      renderOrder: 8,
    });
    shipGroup.add(bell);
    seaOffsets.push({ x, z });
  }

  // Keep “offsets” in case you want it elsewhere
  void offsets;

  return {
    vacExitY,
    seaExitY,
    vacOffsets,
    seaOffsets,
    vacBellRadius: vacR,
    seaBellRadius: seaR,
  };
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

  // Materials
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

  const nozzleMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x6f7888),
    roughness: 0.58,
    metalness: 0.54,
  });
  enforceSolidOpaqueMaterial(THREE, nozzleMat);
  const heatShieldMat = darkSteel.clone();
  heatShieldMat.color = new THREE.Color(0x151a22);
  heatShieldMat.roughness = 0.8;
  heatShieldMat.metalness = 0.16;
  heatShieldMat.polygonOffset = true;
  heatShieldMat.polygonOffsetFactor = -2;
  heatShieldMat.polygonOffsetUnits = -2;
  enforceSolidOpaqueMaterial(THREE, heatShieldMat);

  const root = new THREE.Group();

  // Groups
  const shipGroup = new THREE.Group();

  const fullShipCenterY = baseY + boosterHeight + (0.5 * shipHeight);
  const detachedShipCenterY = 0;
  const fullBoosterCenterY = baseY + (0.5 * boosterHeight);

  shipGroup.position.y = fullShipCenterY;

  root.add(shipGroup);

  // Ship hull (kept simple: cylinder + cone)
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
  const navigationBeacon = createInlineNavigationBeaconVisual(
    THREE,
    shipGroup,
    radius,
    shipNose.position.y + (noseHeight * 0.62),
  );

  // Simple “tile band”
  const heatShieldBody = new THREE.Mesh(
    new THREE.CylinderGeometry(
      radius * 1.008,
      radius * 1.002,
      shipBodyHeight * 0.95,
      28,
      1,
      true,
      -Math.PI * 0.5,
      Math.PI,
    ),
    heatShieldMat,
  );
  heatShieldBody.position.y = shipBody.position.y;
  heatShieldBody.rotation.y = Math.PI * 0.5;
  shipGroup.add(heatShieldBody);

  const heatShieldNose = new THREE.Mesh(
    new THREE.ConeGeometry(
      radius * 0.94,
      noseHeight * 1.02,
      28,
      1,
      true,
      -Math.PI * 0.5,
      Math.PI,
    ),
    heatShieldMat,
  );
  heatShieldNose.position.y = shipNose.position.y;
  heatShieldNose.rotation.y = Math.PI * 0.5;
  shipGroup.add(heatShieldNose);

  // Ship engines (returns exact exit planes + offsets)
  const shipEngines = addInlineStarshipEngines(THREE, shipGroup, darkSteel, radius, shipHeight);

  // Ship main engine plumes (two clusters: vac + sea) — PERFECT alignment to bells
  const shipMainEnginePlumes = [
    createEnginePlumeCluster(THREE, shipGroup, {
      offsets: shipEngines.vacOffsets,
      anchorY: shipEngines.vacExitY,
      plumeLength: clamp(shipHeight * 0.15, radius * 0.44, shipHeight * 0.24),
      plumeRadius: clamp(shipEngines.vacBellRadius * 1.22, radius * 0.06, radius * 0.18),
      nozzleRadius: clamp(shipEngines.vacBellRadius * 0.96, radius * 0.05, radius * 0.17),
      colorHex: STARSHIP_MAIN_ENGINE_PLUME_COLOR_HEX,
    }),
    createEnginePlumeCluster(THREE, shipGroup, {
      offsets: shipEngines.seaOffsets,
      anchorY: shipEngines.seaExitY,
      plumeLength: clamp(shipHeight * 0.115, radius * 0.34, shipHeight * 0.2),
      plumeRadius: clamp(shipEngines.seaBellRadius * 1.18, radius * 0.045, radius * 0.15),
      nozzleRadius: clamp(shipEngines.seaBellRadius * 0.96, radius * 0.04, radius * 0.13),
      colorHex: STARSHIP_MAIN_ENGINE_PLUME_COLOR_HEX,
    }),
  ];

  // Ship RCS nozzles + jets (perfect anchored)
  const shipRcsJets = createRcsJetVisuals(
    THREE,
    shipGroup,
    radius,
    shipHeight,
    STARSHIP_THRUSTER_LAYOUT,
    STARSHIP_RCS_JET_COLOR_HEX,
    nozzleMat,
  );

  root.userData.starshipAssetSource = "inline_procedural_starship_stack_perfect";
  root.userData.starshipTextureResolution = "procedural_inline";

  return {
    root,
    materials: [stainless, darkSteel, nozzleMat, heatShieldMat],
    state: {
      distanceScale,
      shipGroup,
      fullBoosterCenterY,
      fullShipCenterY,
      detachedShipCenterY,

      // ship visuals
      shipMainEnginePlumes,
      shipRcsJets,
      navigationBeacon,
      hotstageVentPlumes: createInlineHotstageVentPlumes(
        THREE,
        shipGroup,
        radius,
        (-0.5 * shipHeight) - (radius * 0.08),
      ),
      atmosphereEffects: createLaunchAtmosphereEffects(THREE, {
        stage0BodyHeightScene: totalHeight,
        stage2BodyHeightScene: shipHeight,
      }),
    },
    physical: {
      radiusScene: inlineStarshipPhysicalRenderRadiusScene(distanceScale),
    },
  };
}

export function applyInlineStarshipVisualStage(stageState, stageIndex, snapshot = null) {
  if (!stageState?.shipGroup) return;

  const stageTwoActive = Number.isFinite(stageIndex) && stageIndex >= 1;
  const snapshotBodyId = String(snapshot?.bodyId || "");
  const fleetVehicle = snapshotBodyId.startsWith("earth_mission_ship_")
    || snapshotBodyId.startsWith("earth_refuel_tanker_");
  const detached = fleetVehicle
    ? stageTwoActive
    : (
      snapshot && Object.prototype.hasOwnProperty.call(snapshot, "boosterActive")
        ? Boolean(snapshot.boosterActive)
        : stageTwoActive
    );
  const distanceScale = Number(stageState?.distanceScale) || 1;
  if (Number.isFinite(stageState.detachedShipCenterY) && Number.isFinite(stageState.fullShipCenterY)) {
    stageState.shipGroup.position.y = detached
      ? stageState.detachedShipCenterY
      : Number(stageState.fullShipCenterY);
  }

  // Ship main engines (used by mission ships/tankers during powered phases).
  const shipPlumes = stageState.shipMainEnginePlumes;
  if (shipPlumes) {
    const phase = String(snapshot?.phase || "").toLowerCase();
    const thrustN = Math.max(0, Number(snapshot?.thrustN) || 0);
    const throttle = clamp(Number(snapshot?.throttle) || 0, 0, 1);
    const shipPowered = thrustN > 0.01 && (throttle > 0.001 || phase === "powered") && detached;
    const activeEngineIndices = Array.isArray(snapshot?.activeEngineIndices)
      ? snapshot.activeEngineIndices
      : null;
    const failedEngineIndices = Array.isArray(snapshot?.failedEngineIndices)
      ? snapshot.failedEngineIndices
      : null;
    const faultedEngineIndices = Array.isArray(snapshot?.faultedEngineIndices)
      ? snapshot.faultedEngineIndices
      : null;
    const flamePresentIndices = Array.isArray(snapshot?.flamePresentIndices)
      ? snapshot.flamePresentIndices
      : null;
    const chamberPressurePaByIndex = Array.isArray(snapshot?.chamberPressurePaByIndex)
      ? snapshot.chamberPressurePaByIndex
      : null;
    const exhaustTemperatureKByIndex = Array.isArray(snapshot?.exhaustTemperatureKByIndex)
      ? snapshot.exhaustTemperatureKByIndex
      : null;
    const nominalChamberPressurePa = Math.max(
      0,
      Number(snapshot?.maxChamberPressurePa) || Number(snapshot?.avgChamberPressurePa) || 0,
    );
    const nominalExhaustTemperatureK = Math.max(0, Number(snapshot?.maxExhaustTemperatureK) || 0);
    if (Array.isArray(shipPlumes) && shipPlumes.length >= 2) {
      setEnginePlumeVisual(shipPlumes[0], shipPowered, throttle, 1, {
        activeIndices: sliceInlineLocalEngineIndexArray(activeEngineIndices, 0, 3),
        failedIndices: sliceInlineLocalEngineIndexArray(failedEngineIndices, 0, 3),
        faultedIndices: sliceInlineLocalEngineIndexArray(faultedEngineIndices, 0, 3),
        flamePresentIndices: sliceInlineLocalEngineIndexArray(flamePresentIndices, 0, 3),
        chamberPressurePaByIndex: sliceInlineLocalEngineValueArray(chamberPressurePaByIndex, 0, 3),
        exhaustTemperatureKByIndex: sliceInlineLocalEngineValueArray(exhaustTemperatureKByIndex, 0, 3),
        nominalChamberPressurePa,
        nominalExhaustTemperatureK,
        pressurePa: Number(snapshot?.pressurePa) || 0,
        phaseScale: 1,
      });
      setEnginePlumeVisual(shipPlumes[1], shipPowered, throttle, 1, {
        activeIndices: sliceInlineLocalEngineIndexArray(activeEngineIndices, 3, 3),
        failedIndices: sliceInlineLocalEngineIndexArray(failedEngineIndices, 3, 3),
        faultedIndices: sliceInlineLocalEngineIndexArray(faultedEngineIndices, 3, 3),
        flamePresentIndices: sliceInlineLocalEngineIndexArray(flamePresentIndices, 3, 3),
        chamberPressurePaByIndex: sliceInlineLocalEngineValueArray(chamberPressurePaByIndex, 3, 3),
        exhaustTemperatureKByIndex: sliceInlineLocalEngineValueArray(exhaustTemperatureKByIndex, 3, 3),
        nominalChamberPressurePa,
        nominalExhaustTemperatureK,
        pressurePa: Number(snapshot?.pressurePa) || 0,
        phaseScale: 1,
      });
    } else {
      setEnginePlumeVisual(shipPlumes, shipPowered, throttle, 1, {
        activeIndices: activeEngineIndices,
        failedIndices: failedEngineIndices,
        faultedIndices: faultedEngineIndices,
        flamePresentIndices: flamePresentIndices,
        chamberPressurePaByIndex: chamberPressurePaByIndex,
        exhaustTemperatureKByIndex: exhaustTemperatureKByIndex,
        nominalChamberPressurePa,
        nominalExhaustTemperatureK,
        pressurePa: Number(snapshot?.pressurePa) || 0,
        phaseScale: 1,
      });
    }
  }

  // Ship RCS jets (critical for tanker orbit-hold and docking visuals).
  const shipRcsJets = stageState.shipRcsJets;
  if (shipRcsJets) {
    const requestedJets = Array.isArray(snapshot?.rcsJets) ? snapshot.rcsJets : [];
    const rcsActive = Boolean(snapshot?.rcsActive) && requestedJets.length > 0;
    const authority = clamp(Number(snapshot?.rcsAuthority) || 0, 0, 1);
    updateRcsJetVisuals(
      shipRcsJets,
      requestedJets,
      rcsActive,
      authority,
      20,
    );
  }

  updateInlineHotstageVentPlumes(stageState, snapshot);
  updateInlineNavigationBeaconVisual(stageState);
}

export function applyInlineStarshipAtmosphereEffects(stageState, snapshot = null, options = {}) {
  applyLaunchAtmosphereEffects(stageState?.atmosphereEffects, snapshot, options);
}

/**
 * Physical render radius for culling/camera heuristics
 */
export function inlineStarshipPhysicalRenderRadiusScene(distanceScale) {
  return INLINE_STARSHIP_STACK_TOTAL_HEIGHT_KM * 0.5 * distanceScale;
}
