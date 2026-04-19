import { resolveLaunchStructureArmTarget } from "../app/static/js/physics/launch/launchSiteStructures.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const idleTarget = resolveLaunchStructureArmTarget({
    stackPresent: true,
    launchPhase: "idle",
  });
  assert(idleTarget < 0.3, `expected chopsticks to stay near the stack on pad, got ${idleTarget}`);

  const ascentTarget = resolveLaunchStructureArmTarget({
    stackPresent: false,
    launchPhase: "powered",
    altitudeKm: 2.5,
  });
  assert(ascentTarget > 0.9, `expected chopsticks to retract for ascent, got ${ascentTarget}`);

  const catchTarget = resolveLaunchStructureArmTarget({
    stackPresent: false,
    launchPhase: "coast",
    boosterPhase: "catch-burn",
    boosterLanded: false,
  });
  assert(catchTarget < ascentTarget, `expected catch mode to close chopsticks, got ${catchTarget} vs ${ascentTarget}`);

  const caughtTarget = resolveLaunchStructureArmTarget({
    boosterPhase: "caught",
    boosterLanded: true,
  });
  assert(caughtTarget < catchTarget, `expected caught booster to hold chopsticks tighter, got ${caughtTarget} vs ${catchTarget}`);

  console.log("PASS launch-site-structure-visual-lock");
}

main();
