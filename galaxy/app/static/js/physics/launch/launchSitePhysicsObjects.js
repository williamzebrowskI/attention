import {
  BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM,
  EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
  LAUNCH_BOOSTER_BODY_ID,
  LAUNCH_SITE,
  STARSHIP_STACK_DIMENSIONS_KM,
} from "./launchConfig.js";
import {
  BOOSTER_CURRENT_GRID_FIN_ANGLES_DEG,
  BOOSTER_CURRENT_GRID_FIN_CENTER_RADIUS_M,
  BOOSTER_CURRENT_GRID_FIN_THICKNESS_M,
  BOOSTER_CURRENT_GRID_FIN_Y_M,
} from "./launchRealismConfig.js";
import { LAUNCH_STRUCTURE_PROFILE_KM } from "./launchSiteStructures.js?v=20260425h";
import {
  createCapsuleRigidBody,
  createStaticBoxCollider,
  queryRigidBodyContacts,
  resolveDynamicBodyContacts,
} from "../objects/physicalObjectWorld.js";
import { surfacePointRelativeKmAtLatLon } from "../surface/earthSurfacePhysics.js";
import {
  add,
  cross,
  dot,
  length,
  normalize,
  scale,
  subtract,
} from "./launchMath.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteVector(vector) {
  return (
    vector
    && Number.isFinite(Number(vector.x))
    && Number.isFinite(Number(vector.y))
    && Number.isFinite(Number(vector.z))
  );
}

function surfaceVelocityAtRelativePosition(earthState, relativePositionKm, earthAxes) {
  const angularVelocity = scale(
    normalize(earthAxes?.pole || { x: 0, y: 0, z: 1 }),
    EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
  );
  return add(
    earthState?.velocity || { x: 0, y: 0, z: 0 },
    cross(angularVelocity, relativePositionKm),
  );
}

function launchSiteSurfaceFrame({ earthState, earthAxes } = {}) {
  if (!finiteVector(earthState?.position) || !earthAxes) {
    return null;
  }
  const surface = surfacePointRelativeKmAtLatLon(
    LAUNCH_SITE.latitudeDeg,
    LAUNCH_SITE.longitudeDeg,
    earthAxes,
    { includeTerrain: true },
  );
  if (!surface?.pointRelativeKm || !surface?.surfaceNormal) {
    return null;
  }
  const up = normalize(surface.surfaceNormal, normalize(surface.pointRelativeKm));
  const east = normalize(
    cross(earthAxes.pole || { x: 0, y: 0, z: 1 }, up),
    { x: 1, y: 0, z: 0 },
  );
  const north = normalize(cross(up, east), earthAxes.pole || { x: 0, y: 0, z: 1 });
  const baseRelativeKm = add(
    surface.pointRelativeKm,
    scale(up, Math.max(0, Number(LAUNCH_SITE.altitudeKm) || 0)),
  );
  return {
    originKm: add(earthState.position, baseRelativeKm),
    originRelativeKm: baseRelativeKm,
    surfaceVelocityKmS: surfaceVelocityAtRelativePosition(earthState, baseRelativeKm, earthAxes),
    up,
    east,
    north,
    surface,
  };
}

function framePoint(frame, eastKm, northKm, upKm) {
  return add(
    add(
      add(frame.originKm, scale(frame.east, eastKm)),
      scale(frame.north, northKm),
    ),
    scale(frame.up, upKm),
  );
}

function frameSurfaceVelocity(frame, eastKm, northKm, upKm, earthState, earthAxes) {
  const rel = add(
    add(
      add(frame.originRelativeKm, scale(frame.east, eastKm)),
      scale(frame.north, northKm),
    ),
    scale(frame.up, upKm),
  );
  return surfaceVelocityAtRelativePosition(earthState, rel, earthAxes);
}

function worldPointToBoxLocal(pointKm, box) {
  const relative = subtract(pointKm, box.centerKm);
  return {
    x: dot(relative, box.axes.x),
    y: dot(relative, box.axes.y),
    z: dot(relative, box.axes.z),
  };
}

function pointInsideBoxWithTolerance(localPoint, halfExtents, toleranceKm) {
  const tolerance = typeof toleranceKm === "object"
    ? toleranceKm
    : { x: toleranceKm, y: toleranceKm, z: toleranceKm };
  return (
    Math.abs(localPoint.x) <= (halfExtents.x + (Number(tolerance.x) || 0))
    && Math.abs(localPoint.y) <= (halfExtents.y + (Number(tolerance.y) || 0))
    && Math.abs(localPoint.z) <= (halfExtents.z + (Number(tolerance.z) || 0))
  );
}

function staticBoxForLaunchSite({
  id,
  role,
  frame,
  earthState,
  earthAxes,
  eastKm,
  northKm = 0,
  upKm,
  halfExtentsKm,
  material,
} = {}) {
  return createStaticBoxCollider({
    id,
    centerKm: framePoint(frame, eastKm, northKm, upKm),
    axes: {
      x: frame.east,
      y: frame.north,
      z: frame.up,
    },
    halfExtentsKm,
    surfaceVelocityKmS: frameSurfaceVelocity(frame, eastKm, northKm, upKm, earthState, earthAxes),
    material,
    metadata: {
      role,
      launchSite: LAUNCH_SITE.name,
    },
  });
}

export function createLaunchSiteStaticPhysicsObjects({
  earthState,
  earthAxes,
  includeChopsticks = true,
  includeTower = true,
} = {}) {
  const frame = launchSiteSurfaceFrame({ earthState, earthAxes });
  if (!frame) {
    return [];
  }
  const profile = LAUNCH_STRUCTURE_PROFILE_KM;
  const boosterRadiusKm = STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 0.5;
  const towerCenterEastKm = boosterRadiusKm + profile.towerOffsetKm + (0.5 * profile.towerWidthKm);
  const colliders = [];
  const towerMaterial = { restitution: 0.035, friction: 0.82 };
  const padHardwareMaterial = { restitution: 0.04, friction: 0.86 };
  const catchHardwareMaterial = { restitution: 0.02, friction: 0.95 };
  const slabBaseHeightKm = profile.slabHeightKm + profile.slabApronHeightKm;
  const mountBodyHeightKm = profile.mountDeckHeightKm - slabBaseHeightKm;

  colliders.push(staticBoxForLaunchSite({
    id: "orbital-launch-mount-pad2-cuboid-body",
    role: "orbital-launch-mount",
    frame,
    earthState,
    earthAxes,
    eastKm: 0,
    upKm: slabBaseHeightKm + (0.5 * mountBodyHeightKm),
    halfExtentsKm: {
      x: 0.5 * profile.mountBodyWidthKm,
      y: 0.5 * profile.mountBodyDepthKm,
      z: 0.5 * mountBodyHeightKm,
    },
    material: padHardwareMaterial,
  }));
  colliders.push(staticBoxForLaunchSite({
    id: "orbital-launch-mount-water-cooled-deck",
    role: "orbital-launch-mount",
    frame,
    earthState,
    earthAxes,
    eastKm: 0,
    upKm:
      profile.mountDeckHeightKm
      + (0.5 * profile.waterCooledDeckThicknessKm),
    halfExtentsKm: {
      x: 0.5 * profile.waterCooledDeckWidthKm,
      y: 0.5 * profile.waterCooledDeckDepthKm,
      z: 0.5 * profile.waterCooledDeckThicknessKm,
    },
    material: padHardwareMaterial,
  }));
  colliders.push(staticBoxForLaunchSite({
    id: "orbital-launch-mount-flame-trench",
    role: "flame-trench",
    frame,
    earthState,
    earthAxes,
    eastKm: 0,
    northKm: -0.5 * profile.flameBucketDepthKm,
    upKm: 0.5 * profile.flameTrenchMouthHeightKm,
    halfExtentsKm: {
      x: 0.5 * profile.flameTrenchMouthWidthKm,
      y: 0.5 * (profile.flameBucketDepthKm + profile.flameTrenchMouthDepthKm),
      z: 0.5 * profile.flameTrenchMouthHeightKm,
    },
    material: padHardwareMaterial,
  }));
  colliders.push(staticBoxForLaunchSite({
    id: "pad2-service-bunker",
    role: "launch-mount-service-bunker",
    frame,
    earthState,
    earthAxes,
    eastKm: profile.mountServiceBunkerEastKm,
    northKm: profile.mountServiceBunkerNorthKm,
    upKm: profile.slabHeightKm + (0.5 * profile.mountServiceBunkerHeightKm),
    halfExtentsKm: {
      x: 0.5 * profile.mountServiceBunkerWidthKm,
      y: 0.5 * profile.mountServiceBunkerDepthKm,
      z: 0.5 * profile.mountServiceBunkerHeightKm,
    },
    material: padHardwareMaterial,
  }));

  for (let i = 0; i < profile.boosterQuickDisconnectCount; i += 1) {
    colliders.push(staticBoxForLaunchSite({
      id: `pad2-booster-quick-disconnect-${i + 1}`,
      role: "booster-quick-disconnect",
      frame,
      earthState,
      earthAxes,
      eastKm: profile.boosterQuickDisconnectEastKm,
      northKm:
        profile.boosterQuickDisconnectNorthKm
        + ((i - ((profile.boosterQuickDisconnectCount - 1) * 0.5)) * profile.boosterQuickDisconnectSpacingKm),
      upKm: profile.mountDeckHeightKm + (0.5 * profile.boosterQuickDisconnectHoodHeightKm),
      halfExtentsKm: {
        x: 0.5 * profile.boosterQuickDisconnectHoodWidthKm,
        y: 0.5 * profile.boosterQuickDisconnectHoodDepthKm,
        z: 0.5 * profile.boosterQuickDisconnectHoodHeightKm,
      },
      material: padHardwareMaterial,
    }));
  }

  for (let i = 0; i < profile.delugeTankCount; i += 1) {
    colliders.push(staticBoxForLaunchSite({
      id: `deluge-tank-${i + 1}`,
      role: "deluge-tank-farm",
      frame,
      earthState,
      earthAxes,
      eastKm:
        profile.delugeTankOffsetEastKm
        + ((i - ((profile.delugeTankCount - 1) * 0.5)) * profile.delugeTankSpacingKm),
      northKm: profile.delugeTankOffsetNorthKm,
      upKm: 0.5 * profile.delugeTankHeightKm,
      halfExtentsKm: {
        x: profile.delugeTankRadiusKm,
        y: profile.delugeTankRadiusKm,
        z: 0.5 * profile.delugeTankHeightKm,
      },
      material: towerMaterial,
    }));
  }

  if (includeTower) {
    colliders.push(staticBoxForLaunchSite({
      id: "launch-tower-core",
      role: "tower",
      frame,
      earthState,
      earthAxes,
      eastKm: towerCenterEastKm,
      upKm: 0.5 * profile.towerHeightKm,
      halfExtentsKm: {
        x: 0.5 * profile.towerWidthKm,
        y: 0.5 * profile.towerDepthKm,
        z: 0.5 * profile.towerHeightKm,
      },
      material: towerMaterial,
    }));
    colliders.push(staticBoxForLaunchSite({
      id: "launch-tower-base",
      role: "tower-base",
      frame,
      earthState,
      earthAxes,
      eastKm: towerCenterEastKm,
      upKm: 0.5 * profile.towerBaseHeightKm,
      halfExtentsKm: {
        x: 0.5 * profile.towerBaseWidthKm,
        y: 0.5 * profile.towerBaseDepthKm,
        z: 0.5 * profile.towerBaseHeightKm,
      },
      material: towerMaterial,
    }));
  }

  if (includeChopsticks) {
    const armLengthKm = profile.chopstickArmMaxLengthKm;
    const armPivotEastKm = boosterRadiusKm + profile.towerOffsetKm + profile.chopstickPivotInsetKm;
    const armCenterEastKm = Math.max(
      0,
      armPivotEastKm - (0.5 * armLengthKm),
    );
    for (const northSign of [-1, 1]) {
      colliders.push(staticBoxForLaunchSite({
        id: northSign < 0 ? "chopstick-arm-south" : "chopstick-arm-north",
        role: "chopstick-arm",
        frame,
        earthState,
        earthAxes,
        eastKm: armCenterEastKm,
        northKm: northSign * (0.5 * profile.chopstickArmSpacingKm),
        upKm: profile.chopstickCatchHeightKm,
        halfExtentsKm: {
          x: 0.5 * armLengthKm,
          y: 0.5 * profile.chopstickArmDepthKm,
          z: 0.5 * profile.chopstickArmThicknessKm,
        },
        material: catchHardwareMaterial,
      }));
      colliders.push(staticBoxForLaunchSite({
        id: northSign < 0 ? "chopstick-fork-south" : "chopstick-fork-north",
        role: "chopstick-fork",
        frame,
        earthState,
        earthAxes,
        eastKm: armPivotEastKm - armLengthKm - (0.5 * profile.chopstickForkLengthKm),
        northKm: northSign * (0.5 * profile.chopstickArmSpacingKm),
        upKm: profile.chopstickCatchHeightKm,
        halfExtentsKm: {
          x: 0.5 * profile.chopstickForkLengthKm,
          y: 0.5 * profile.chopstickArmDepthKm,
          z: 0.5 * profile.chopstickArmThicknessKm,
        },
        material: catchHardwareMaterial,
      }));
    }
    colliders.push(staticBoxForLaunchSite({
      id: "chopstick-carriage",
      role: "chopstick-carriage",
      frame,
      earthState,
      earthAxes,
      eastKm: towerCenterEastKm,
      upKm: profile.chopstickCatchHeightKm,
      halfExtentsKm: {
        x: 0.5 * profile.carriageWidthKm,
        y: 0.5 * profile.carriageDepthKm,
        z: 0.5 * profile.carriageHeightKm,
      },
      material: catchHardwareMaterial,
    }));
  }

  return colliders;
}

export function createBoosterCapsulePhysicsBody({
  boosterState,
  bodyAxisKm,
  id = LAUNCH_BOOSTER_BODY_ID,
} = {}) {
  if (!finiteVector(boosterState?.position)) {
    return null;
  }
  return createCapsuleRigidBody({
    id,
    massKg: Math.max(1, Number(boosterState.massKg) || 1),
    positionKm: boosterState.position,
    velocityKmS: boosterState.velocity || { x: 0, y: 0, z: 0 },
    axisKm: normalize(bodyAxisKm || { x: 0, y: 0, z: 1 }),
    halfLengthKm: Math.max(0.001, (0.5 * STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm) - BOOSTER_REFERENCE_OFFSET_FROM_BASE_KM * 0.02),
    radiusKm: STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 0.5,
    material: {
      restitution: 0.025,
      friction: 0.86,
    },
    metadata: {
      vehicle: "super-heavy-booster",
    },
  });
}

export function queryLaunchSiteObjectContacts({
  boosterState,
  bodyAxisKm,
  earthState,
  earthAxes,
  includeChopsticks = true,
  includeTower = true,
} = {}) {
  const body = createBoosterCapsulePhysicsBody({ boosterState, bodyAxisKm });
  if (!body) {
    return { body: null, colliders: [], contacts: [] };
  }
  const colliders = createLaunchSiteStaticPhysicsObjects({
    earthState,
    earthAxes,
    includeChopsticks,
    includeTower,
  });
  const contacts = queryRigidBodyContacts(body, colliders);
  return { body, colliders, contacts };
}

function boosterCatchPinDefinitionsKm() {
  const radiusKm = STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 0.5;
  const gridFinThicknessKm = BOOSTER_CURRENT_GRID_FIN_THICKNESS_M / 1000;
  const gridFinYFromCenterKm = BOOSTER_CURRENT_GRID_FIN_Y_M / 1000;
  const catchPinRadiusKm = clamp(radiusKm * 0.026, radiusKm * 0.013, radiusKm * 0.039);
  const catchPinLengthKm = clamp(radiusKm * 0.25, radiusKm * 0.12, radiusKm * 0.34);
  const radialCenterKm = Math.max(
    radiusKm + (catchPinLengthKm * 0.34),
    (BOOSTER_CURRENT_GRID_FIN_CENTER_RADIUS_M / 1000) - (catchPinLengthKm * 0.55),
  );
  return BOOSTER_CURRENT_GRID_FIN_ANGLES_DEG.map((angleDeg, index) => ({
    name: `grid-fin-${index + 1}-catch`,
    angleRad: angleDeg * Math.PI / 180,
  })).map((pin) => ({
    ...pin,
    yFromReferenceKm:
      gridFinYFromCenterKm
      - (gridFinThicknessKm * 1.55),
    radialCenterKm,
    radiusKm: catchPinRadiusKm,
    lengthKm: catchPinLengthKm,
  }));
}

function catchPinWorldPoint({
  boosterState,
  bodyAxesWorld,
  definition,
} = {}) {
  if (!finiteVector(boosterState?.position) || !definition) {
    return null;
  }
  const forward = normalize(bodyAxesWorld?.forward || { x: 0, y: 0, z: 1 });
  const right = normalize(bodyAxesWorld?.right || { x: 1, y: 0, z: 0 });
  const top = normalize(bodyAxesWorld?.top || { x: 0, y: 1, z: 0 });
  const radialOffsetKm = add(
    scale(right, Math.cos(definition.angleRad) * definition.radialCenterKm),
    scale(top, Math.sin(definition.angleRad) * definition.radialCenterKm),
  );
  return add(
    add(boosterState.position, scale(forward, definition.yFromReferenceKm)),
    radialOffsetKm,
  );
}

export function queryBoosterCatchPointContacts({
  boosterState,
  bodyAxesWorld,
  omegaWorldRadS = { x: 0, y: 0, z: 0 },
  earthState,
  earthAxes,
} = {}) {
  const colliders = createLaunchSiteStaticPhysicsObjects({
    earthState,
    earthAxes,
    includeChopsticks: true,
    includeTower: false,
  }).filter((collider) => String(collider?.metadata?.role || "").includes("chopstick"));
  if (!finiteVector(boosterState?.position) || colliders.length === 0) {
    return {
      contacts: [],
      supportedPinCount: 0,
      supportedArmCount: 0,
      captureEligible: false,
      maxAbsVerticalGapKm: Number.POSITIVE_INFINITY,
      maxTangentialSpeedKmS: Number.POSITIVE_INFINITY,
      maxClosingSpeedKmS: Number.POSITIVE_INFINITY,
    };
  }
  const pins = boosterCatchPinDefinitionsKm();
  const contacts = [];
  for (const definition of pins) {
    const pointKm = catchPinWorldPoint({
      boosterState,
      bodyAxesWorld,
      definition,
    });
    if (!pointKm) {
      continue;
    }
    const pinOffsetKm = subtract(pointKm, boosterState.position);
    const pointVelocityKmS = add(
      boosterState.velocity || { x: 0, y: 0, z: 0 },
      cross(omegaWorldRadS || { x: 0, y: 0, z: 0 }, pinOffsetKm),
    );
    for (const arm of colliders) {
      const localPoint = worldPointToBoxLocal(pointKm, arm);
      const toleranceKm = {
        x: Math.max(0.00105, definition.radiusKm + 0.00022),
        y: Math.max(0.00085, definition.radiusKm + 0.00022),
        z: Math.max(0.00035, definition.radiusKm + 0.00022),
      };
      if (!pointInsideBoxWithTolerance(localPoint, arm.halfExtentsKm, toleranceKm)) {
        continue;
      }
      const relativeVelocityKmS = subtract(
        pointVelocityKmS,
        arm.surfaceVelocityKmS || { x: 0, y: 0, z: 0 },
      );
      const verticalSpeedKmS = dot(relativeVelocityKmS, arm.axes.z);
      const tangentVelocityKmS = subtract(relativeVelocityKmS, scale(arm.axes.z, verticalSpeedKmS));
      const armId = String(arm.id || "");
      const northSign = armId.includes("south") ? -1 : 1;
      contacts.push({
        pinName: definition.name,
        colliderId: arm.id,
        colliderRole: String(arm.metadata?.role || ""),
        armSide: northSign,
        pointKm,
        localPoint,
        verticalGapKm: Math.max(
          0,
          Math.abs(localPoint.z) - arm.halfExtentsKm.z,
        ),
        lateralGapKm: Math.max(
          0,
          Math.max(
            Math.abs(localPoint.x) - arm.halfExtentsKm.x,
            Math.abs(localPoint.y) - arm.halfExtentsKm.y,
          ),
        ),
        relativeVelocityKmS,
        closingSpeedKmS: Math.max(0, -verticalSpeedKmS),
        tangentSpeedKmS: length(tangentVelocityKmS),
      });
    }
  }
  const supportedPins = new Set(contacts.map((contact) => contact.pinName));
  const supportedArms = new Set(contacts.map((contact) => contact.armSide));
  const maxAbsVerticalGapKm = contacts.reduce(
    (maxGap, contact) => Math.max(maxGap, Math.abs(Number(contact.verticalGapKm) || 0)),
    0,
  );
  const maxTangentialSpeedKmS = contacts.reduce(
    (maxSpeed, contact) => Math.max(maxSpeed, Number(contact.tangentSpeedKmS) || 0),
    0,
  );
  const maxClosingSpeedKmS = contacts.reduce(
    (maxSpeed, contact) => Math.max(maxSpeed, Number(contact.closingSpeedKmS) || 0),
    0,
  );
  return {
    contacts,
    supportedPinCount: supportedPins.size,
    supportedArmCount: supportedArms.size,
    captureEligible:
      supportedPins.size >= 2
      && supportedArms.size >= 2
      && maxAbsVerticalGapKm <= 0.00095
      && maxTangentialSpeedKmS <= 0.012
      && maxClosingSpeedKmS <= 0.022,
    maxAbsVerticalGapKm: contacts.length > 0 ? maxAbsVerticalGapKm : Number.POSITIVE_INFINITY,
    maxTangentialSpeedKmS: contacts.length > 0 ? maxTangentialSpeedKmS : Number.POSITIVE_INFINITY,
    maxClosingSpeedKmS: contacts.length > 0 ? maxClosingSpeedKmS : Number.POSITIVE_INFINITY,
  };
}

export function resolveLaunchSiteObjectContacts({
  boosterState,
  bodyAxisKm,
  earthState,
  earthAxes,
  includeChopsticks = true,
  includeTower = true,
} = {}) {
  const body = createBoosterCapsulePhysicsBody({ boosterState, bodyAxisKm });
  if (!body) {
    return { body: null, contacts: [], resolved: false };
  }
  const colliders = createLaunchSiteStaticPhysicsObjects({
    earthState,
    earthAxes,
    includeChopsticks,
    includeTower,
  });
  return resolveDynamicBodyContacts(body, colliders);
}

export function contactImpulseDirection(contact = null) {
  if (!contact) {
    return null;
  }
  if (finiteVector(contact.normalKm) && length(contact.normalKm) > 1e-12) {
    return normalize(contact.normalKm);
  }
  if (finiteVector(contact.tangentVelocityKmS) && length(contact.tangentVelocityKmS) > 1e-12) {
    return normalize(contact.tangentVelocityKmS);
  }
  return null;
}
