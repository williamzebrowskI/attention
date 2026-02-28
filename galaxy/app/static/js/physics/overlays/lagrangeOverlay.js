export function createLagrangeOverlayController(options) {
  const {
    THREE,
    scene,
    systems = [],
    clamp = defaultClamp,
    getBodyVisual,
    getCoordinatesKm,
    getBodyMassKg,
    getLiveVelocityKmS,
    gravitationalConstantKm3PerKgS2,
    distanceScale,
    minBodyRadiusScene = 0.000001,
    markerSizeMin = 0.0005,
    markerSizeMax = 0.012,
    defaultMarkerColor = 0x6ad8ff,
  } = options || {};

  let enabled = false;
  let visualsBySystemId = new Map();

  function rebuild() {
    if (!THREE || !scene) {
      return;
    }
    clear();
    for (const system of systems) {
      const visual = createLagrangeSystemVisual(system);
      if (!visual) {
        continue;
      }
      visualsBySystemId.set(system.id, visual);
      scene.add(visual.group);
    }
    update();
  }

  function clear() {
    for (const visual of visualsBySystemId.values()) {
      scene?.remove?.(visual.group);
      disposeObject3DResources(visual.group);
    }
    visualsBySystemId = new Map();
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    if (!enabled) {
      for (const visual of visualsBySystemId.values()) {
        visual.group.visible = false;
      }
    }
  }

  function update() {
    for (const system of systems) {
      const overlay = visualsBySystemId.get(system.id);
      if (!overlay) {
        continue;
      }
      if (!enabled) {
        overlay.group.visible = false;
        continue;
      }

      const points = computeLagrangePointsForSystem(system.primaryId, system.secondaryId);
      if (!points) {
        overlay.group.visible = false;
        continue;
      }

      const secondaryVisual = getBodyVisual?.(system.secondaryId);
      const markerRadius = clamp(
        Math.max(secondaryVisual?.renderRadius || 0, minBodyRadiusScene * 1.6) * 0.9,
        markerSizeMin,
        markerSizeMax,
      );

      overlay.group.visible = true;
      for (const [label, marker] of overlay.markersByLabel.entries()) {
        const point = points[label];
        if (!point) {
          marker.visible = false;
          continue;
        }
        marker.visible = true;
        marker.position.set(
          point.x * distanceScale,
          point.z * distanceScale,
          point.y * distanceScale,
        );
        marker.scale.setScalar(markerRadius);
      }
    }
  }

  function createLagrangeSystemVisual(system) {
    if (!system?.id) {
      return null;
    }
    const group = new THREE.Group();
    group.visible = false;
    const markersByLabel = new Map();
    const labels = ["L1", "L2", "L3", "L4", "L5"];
    for (const label of labels) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(1, 18, 18),
        new THREE.MeshBasicMaterial({
          color: system.color || defaultMarkerColor,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      marker.userData.label = label;
      marker.renderOrder = 83;
      markersByLabel.set(label, marker);
      group.add(marker);
    }
    return {
      id: system.id,
      primaryId: system.primaryId,
      secondaryId: system.secondaryId,
      group,
      markersByLabel,
    };
  }

  function computeLagrangePointsForSystem(primaryId, secondaryId) {
    const p1 = getCoordinatesKm?.(primaryId);
    const p2 = getCoordinatesKm?.(secondaryId);
    const m1 = Number(getBodyMassKg?.(primaryId));
    const m2 = Number(getBodyMassKg?.(secondaryId));
    if (!p1 || !p2 || !(m1 > 0) || !(m2 > 0)) {
      return null;
    }

    const rx = p2.x - p1.x;
    const ry = p2.y - p1.y;
    const rz = p2.z - p1.z;
    const radiusKm = Math.sqrt((rx * rx) + (ry * ry) + (rz * rz));
    if (!(radiusKm > 0)) {
      return null;
    }
    const ux = rx / radiusKm;
    const uy = ry / radiusKm;
    const uz = rz / radiusKm;

    const normal = lagrangePlaneNormalKm(primaryId, secondaryId, { x: rx, y: ry, z: rz });
    const tangent = normalizeVectorKm(crossKm(normal, { x: ux, y: uy, z: uz }));
    if (!tangent) {
      return null;
    }

    const l1X = solveCollinearLagrangeX(m1, m2, radiusKm, "L1");
    const l2X = solveCollinearLagrangeX(m1, m2, radiusKm, "L2");
    const l3X = solveCollinearLagrangeX(m1, m2, radiusKm, "L3");
    const midpoint = {
      x: 0.5 * (p1.x + p2.x),
      y: 0.5 * (p1.y + p2.y),
      z: 0.5 * (p1.z + p2.z),
    };
    const triangleOffset = (Math.sqrt(3) * 0.5) * radiusKm;

    return {
      L1: Number.isFinite(l1X) ? pointAlongKm(p1, { x: ux, y: uy, z: uz }, l1X) : null,
      L2: Number.isFinite(l2X) ? pointAlongKm(p1, { x: ux, y: uy, z: uz }, l2X) : null,
      L3: Number.isFinite(l3X) ? pointAlongKm(p1, { x: ux, y: uy, z: uz }, l3X) : null,
      L4: {
        x: midpoint.x + (tangent.x * triangleOffset),
        y: midpoint.y + (tangent.y * triangleOffset),
        z: midpoint.z + (tangent.z * triangleOffset),
      },
      L5: {
        x: midpoint.x - (tangent.x * triangleOffset),
        y: midpoint.y - (tangent.y * triangleOffset),
        z: midpoint.z - (tangent.z * triangleOffset),
      },
    };
  }

  function solveCollinearLagrangeX(m1, m2, radiusKm, label) {
    if (!(m1 > 0) || !(m2 > 0) || !(radiusKm > 0)) {
      return null;
    }

    const q = m2 / m1;
    const hillApprox = radiusKm * Math.cbrt(Math.max(q / 3, 1e-14));
    const epsilon = Math.max(radiusKm * 1e-9, 1e-6);
    let x = 0;
    let minBound = -radiusKm * 40;
    let maxBound = radiusKm * 40;

    if (label === "L1") {
      x = radiusKm - hillApprox;
      minBound = epsilon;
      maxBound = radiusKm - epsilon;
    } else if (label === "L2") {
      x = radiusKm + hillApprox;
      minBound = radiusKm + epsilon;
    } else {
      x = -radiusKm * (1 + ((5 * q) / 12));
      maxBound = -epsilon;
    }

    let estimate = clamp(x, minBound, maxBound);
    for (let i = 0; i < 48; i += 1) {
      const f = collinearLagrangeEquation(estimate, m1, m2, radiusKm);
      if (!Number.isFinite(f)) {
        return null;
      }
      if (Math.abs(f) < 1e-15) {
        return estimate;
      }
      const step = Math.max(radiusKm * 1e-7, 1e-4);
      const fPlus = collinearLagrangeEquation(estimate + step, m1, m2, radiusKm);
      const fMinus = collinearLagrangeEquation(estimate - step, m1, m2, radiusKm);
      const derivative = (fPlus - fMinus) / (2 * step);
      if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-20) {
        break;
      }
      const next = clamp(estimate - (f / derivative), minBound, maxBound);
      if (Math.abs(next - estimate) < Math.max(radiusKm * 1e-12, 1e-7)) {
        estimate = next;
        break;
      }
      estimate = next;
    }
    return Number.isFinite(estimate) ? estimate : null;
  }

  function collinearLagrangeEquation(x, m1, m2, radiusKm) {
    const epsilon = Math.max(radiusKm * 1e-9, 1e-8);
    const r1 = Math.max(Math.abs(x), epsilon);
    const r2 = Math.max(Math.abs(x - radiusKm), epsilon);
    const omega2 = (gravitationalConstantKm3PerKgS2 * (m1 + m2)) / (radiusKm * radiusKm * radiusKm);
    const barycenterFromPrimaryKm = radiusKm * (m2 / (m1 + m2));
    const termPrimary = -gravitationalConstantKm3PerKgS2 * m1 * x / (r1 * r1 * r1);
    const termSecondary = -gravitationalConstantKm3PerKgS2 * m2 * (x - radiusKm) / (r2 * r2 * r2);
    const termRotating = omega2 * (x - barycenterFromPrimaryKm);
    return termPrimary + termSecondary + termRotating;
  }

  function lagrangePlaneNormalKm(primaryId, secondaryId, relativeVectorKm) {
    const primaryVelocity = getLiveVelocityKmS?.(primaryId) || { x: 0, y: 0, z: 0 };
    const secondaryVelocity = getLiveVelocityKmS?.(secondaryId) || { x: 0, y: 0, z: 0 };
    const relativeVelocity = {
      x: secondaryVelocity.x - primaryVelocity.x,
      y: secondaryVelocity.y - primaryVelocity.y,
      z: secondaryVelocity.z - primaryVelocity.z,
    };
    const dynamicNormal = normalizeVectorKm(crossKm(relativeVectorKm, relativeVelocity));
    if (dynamicNormal) {
      return dynamicNormal;
    }

    const fallbackA = normalizeVectorKm(crossKm(relativeVectorKm, { x: 0, y: 0, z: 1 }));
    if (fallbackA) {
      return fallbackA;
    }
    const fallbackB = normalizeVectorKm(crossKm(relativeVectorKm, { x: 0, y: 1, z: 0 }));
    if (fallbackB) {
      return fallbackB;
    }
    return { x: 0, y: 0, z: 1 };
  }

  return {
    rebuild,
    clear,
    update,
    setEnabled,
  };
}

function pointAlongKm(origin, direction, distanceKm) {
  return {
    x: origin.x + (direction.x * distanceKm),
    y: origin.y + (direction.y * distanceKm),
    z: origin.z + (direction.z * distanceKm),
  };
}

function crossKm(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function normalizeVectorKm(vector) {
  if (!vector) {
    return null;
  }
  const magnitude = Math.sqrt((vector.x * vector.x) + (vector.y * vector.y) + (vector.z * vector.z));
  if (!(magnitude > 1e-12)) {
    return null;
  }
  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude,
    z: vector.z / magnitude,
  };
}

function disposeObject3DResources(root) {
  if (!root) {
    return;
  }
  root.traverse((node) => {
    if (node.geometry) {
      node.geometry.dispose();
    }
    if (Array.isArray(node.material)) {
      node.material.forEach((material) => material?.dispose?.());
    } else if (node.material) {
      node.material.dispose();
    }
  });
}

function defaultClamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
