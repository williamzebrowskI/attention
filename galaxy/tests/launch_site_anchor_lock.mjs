import {
  resolveLaunchSiteAnchorWorldKm,
} from "../app/static/js/physics/launch/launchSiteStructures.js";
import {
  LAUNCH_SITE,
  STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM,
} from "../app/static/js/physics/launch/launchConfig.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const earthPositionKm = { x: 1000, y: 2000, z: 3000 };
  const earthAxes = {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    pole: { x: 0, y: 0, z: 1 },
  };
  const rocketPositionKm = {
    x: earthPositionKm.x + 6371.0084 + STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM,
    y: earthPositionKm.y,
    z: earthPositionKm.z,
  };

  const anchored = resolveLaunchSiteAnchorWorldKm({
    launchSite: LAUNCH_SITE,
    earthPositionKm,
    earthAxes,
    rocketPositionKm,
    stackPresent: true,
  });
  assert(anchored, "expected anchored launch site position");
  assert(
    Math.abs(anchored.x - (rocketPositionKm.x - STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM)) < 1e-9,
    `expected anchored X to derive from rocket position, got ${anchored.x}`,
  );
  assert(
    Math.abs(anchored.y - rocketPositionKm.y) < 1e-9,
    `expected anchored Y to stay aligned with rocket, got ${anchored.y}`,
  );
  assert(
    Math.abs(anchored.z - rocketPositionKm.z) < 1e-9,
    `expected anchored Z to stay aligned with rocket, got ${anchored.z}`,
  );

  const fallback = resolveLaunchSiteAnchorWorldKm({
    launchSite: LAUNCH_SITE,
    earthPositionKm,
    earthAxes,
    rocketPositionKm: null,
    stackPresent: false,
  });
  assert(fallback, "expected fallback launch site position");
  assert(
    Math.abs(fallback.x - anchored.x) > 1e-6
      || Math.abs(fallback.y - anchored.y) > 1e-6
      || Math.abs(fallback.z - anchored.z) > 1e-6,
    "expected fallback site solve to differ from rocket-anchored solution in test geometry",
  );

  console.log("PASS launch-site-anchor-lock");
}

main();
