import {
  spacecraftEarthRelativeOrbitAngles,
  spacecraftMinOrbitDistanceScene,
  spacecraftOrbitOffsetFromAngles,
  spacecraftPreferredCameraDistanceScene,
  spacecraftSurfaceRelativeOrbitFrame,
} from "../app/static/js/ui/spacecraftCameraFraming.js";
import { STARSHIP_STACK_TOTAL_HEIGHT_KM, STARSHIP_STACK_DIMENSIONS_KM } from "../app/static/js/physics/launch/launchConfig.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function length(vector) {
  return Math.sqrt(
    (vector.x * vector.x)
    + (vector.y * vector.y)
    + (vector.z * vector.z),
  );
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function add(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function main() {
  const distanceScale = 1 / 700_000;
  const renderRadius = STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 0.5 * distanceScale;
  const minDistance = spacecraftMinOrbitDistanceScene({
    distanceScale,
    renderRadius,
    bodyRadiusKm: STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 0.5,
    stackHeightKm: STARSHIP_STACK_TOTAL_HEIGHT_KM,
  });
  const preferredDistance = spacecraftPreferredCameraDistanceScene({
    distanceScale,
    renderRadius,
    bodyRadiusKm: STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 0.5,
    stackHeightKm: STARSHIP_STACK_TOTAL_HEIGHT_KM,
    nearSurface: minDistance,
  });

  assert(minDistance >= 0.00000012, `expected practical spacecraft min distance, got ${minDistance}`);
  assert(minDistance < 0.0000003, `expected closer spacecraft zoom to remain possible, got ${minDistance}`);
  assert(preferredDistance >= 0.00000125, `expected practical spacecraft focus distance, got ${preferredDistance}`);
  assert(preferredDistance < 0.0000025, `expected spacecraft focus distance to remain reasonably close, got ${preferredDistance}`);
  assert(preferredDistance > minDistance, "preferred spacecraft camera distance should exceed min distance");

  const earthScene = { x: 0, y: 0, z: 0 };
  const padTargetScene = {
    x: (6371.0084 * distanceScale),
    y: 0,
    z: 0,
  };
  const padAngles = spacecraftEarthRelativeOrbitAngles({
    targetScene: padTargetScene,
    earthScene,
  });
  assert(padAngles, "expected Earth-relative orbit angles for pad vehicle");
  assert(padAngles.outwardAlignment > 0.75, `expected strong outward alignment, got ${padAngles.outwardAlignment}`);
  const padCameraOffset = spacecraftOrbitOffsetFromAngles({
    azimuth: padAngles.azimuth,
    polar: padAngles.polar,
    radius: preferredDistance,
  });
  const padCameraScene = add(padTargetScene, padCameraOffset);
  assert(
    length(subtract(padCameraScene, earthScene)) > length(subtract(padTargetScene, earthScene)),
    "expected pad-launch framing camera to stay outside Earth from the vehicle target",
  );

  const orbitTargetScene = {
    x: ((6371.0084 + 500) * distanceScale),
    y: 0,
    z: 0,
  };
  const orbitAngles = spacecraftEarthRelativeOrbitAngles({
    targetScene: orbitTargetScene,
    earthScene,
  });
  assert(orbitAngles, "expected Earth-relative orbit angles for orbit-inject vehicle");
  const orbitOutward = subtract(orbitTargetScene, earthScene);
  const orbitCameraOffset = spacecraftOrbitOffsetFromAngles({
    azimuth: orbitAngles.azimuth,
    polar: orbitAngles.polar,
    radius: preferredDistance,
  });
  assert(
    dot(orbitCameraOffset, orbitOutward) > 0,
    "expected orbit-inject framing camera to bias away from Earth rather than through it",
  );

  const localFrame = spacecraftSurfaceRelativeOrbitFrame({
    targetScene: padTargetScene,
    earthScene,
    earthPoleScene: { x: 0, y: 1, z: 0 },
    azimuth: Math.PI * 0.35,
    polar: Math.PI * 0.34,
    radius: preferredDistance,
  });
  assert(localFrame, "expected local surface orbit frame for low-altitude launch vehicle");
  const localUp = subtract(padTargetScene, earthScene);
  assert(
    dot(localFrame.up, localUp) / Math.max(length(localUp), 1e-12) > 0.99,
    "expected local surface frame up vector to align with Earth-local up",
  );
  assert(
    dot(localFrame.offset, localFrame.up) > 0,
    "expected launch surface framing to keep the camera above the local horizon",
  );

  console.log("PASS spacecraft-camera-framing-lock");
}

main();
