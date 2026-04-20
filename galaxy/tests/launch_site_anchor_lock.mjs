import {
  resolveLaunchSiteAnchorWorldKm,
} from "../app/static/js/physics/launch/launchSiteStructures.js";
import {
  LAUNCH_SITE,
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
    x: earthPositionKm.x + 9999,
    y: earthPositionKm.y - 7777,
    z: earthPositionKm.z + 5555,
  };

  const anchored = resolveLaunchSiteAnchorWorldKm({
    launchSite: LAUNCH_SITE,
    earthPositionKm,
    earthAxes,
    rocketPositionKm,
    stackPresent: true,
  });
  const fallback = resolveLaunchSiteAnchorWorldKm({
    launchSite: LAUNCH_SITE,
    earthPositionKm,
    earthAxes,
    rocketPositionKm: null,
    stackPresent: false,
  });
  assert(anchored, "expected anchored launch site position");
  assert(fallback, "expected fallback launch site position");
  assert(
    Math.abs(fallback.x - anchored.x) <= 1e-9
      && Math.abs(fallback.y - anchored.y) <= 1e-9
      && Math.abs(fallback.z - anchored.z) <= 1e-9,
    "expected anchor solve to ignore rocket-position input and remain Earth-fixed",
  );

  console.log("PASS launch-site-anchor-lock");
}

main();
