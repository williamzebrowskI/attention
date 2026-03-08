import { resolveMissionLaunchAction } from "../app/static/js/ui/launchCommandRouting.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const moonPadRoute = resolveMissionLaunchAction({
    primaryLaunchActive: false,
    missionLaunchMode: "pad_launch",
  });
  assert(
    moonPadRoute === "primary_pad_launch",
    `expected moon pad mission to route to primary launch stack, got ${moonPadRoute}`,
  );

  const refuelPadRoute = resolveMissionLaunchAction({
    primaryLaunchActive: false,
    missionLaunchMode: "pad_launch",
  });
  assert(
    refuelPadRoute === "primary_pad_launch",
    `expected orbital refuel pad mission to route to primary launch stack, got ${refuelPadRoute}`,
  );

  const orbitInjectRoute = resolveMissionLaunchAction({
    primaryLaunchActive: false,
    missionLaunchMode: "orbit_inject",
  });
  assert(
    orbitInjectRoute === "mission_orbit_inject",
    `expected orbit inject mission to keep orbit inject routing, got ${orbitInjectRoute}`,
  );

  const activePadRoute = resolveMissionLaunchAction({
    primaryLaunchActive: true,
    missionLaunchMode: "pad_launch",
  });
  assert(
    activePadRoute === "mission_additional_fleet",
    `expected active primary launch stack to keep additional fleet routing, got ${activePadRoute}`,
  );

  console.log("PASS mission-launch-routing-lock");
}

main();
