import fs from "node:fs";

import {
  LAUNCH_STRUCTURE_PROFILE_KM,
  STARBASE_2026_PUBLIC_LAUNCH_SITE_FEATURES,
} from "../app/static/js/physics/launch/launchSiteStructures.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  assert(
    STARBASE_2026_PUBLIC_LAUNCH_SITE_FEATURES.profileName === "starbase-2026-public-pad2-compatible",
    `unexpected public profile ${STARBASE_2026_PUBLIC_LAUNCH_SITE_FEATURES.profileName}`,
  );
  assert(
    STARBASE_2026_PUBLIC_LAUNCH_SITE_FEATURES.mount.includes("pad2-cuboid")
      && STARBASE_2026_PUBLIC_LAUNCH_SITE_FEATURES.mount.includes("water-cooled")
      && STARBASE_2026_PUBLIC_LAUNCH_SITE_FEATURES.mount.includes("flame-trench"),
    "expected public 2026 mount metadata to include Pad 2 cuboid mount, water-cooled deck, and flame trench",
  );
  assert(
    STARBASE_2026_PUBLIC_LAUNCH_SITE_FEATURES.groundSystems.includes("deluge-tank-farm"),
    "expected public 2026 ground-system metadata to include deluge tank farm",
  );

  assert(LAUNCH_STRUCTURE_PROFILE_KM.towerHeightKm >= 0.12, "expected full-height launch/catch tower scale");
  assert(LAUNCH_STRUCTURE_PROFILE_KM.towerCrossLevelCount >= 16, "expected dense open tower lattice levels");
  assert(LAUNCH_STRUCTURE_PROFILE_KM.waterOutletCount >= 20, "expected visible water-cooled deck outlet pattern");
  assert(LAUNCH_STRUCTURE_PROFILE_KM.mountBodyWidthKm > LAUNCH_STRUCTURE_PROFILE_KM.waterCooledDeckWidthKm, "expected cuboid launch mount body around water-cooled top deck");
  assert(LAUNCH_STRUCTURE_PROFILE_KM.boosterQuickDisconnectCount === 2, "expected two Pad 2-style booster quick disconnect cues");
  assert(LAUNCH_STRUCTURE_PROFILE_KM.flameBucketDepthKm > LAUNCH_STRUCTURE_PROFILE_KM.flameBucketWidthKm, "expected directional flame trench geometry");
  assert(LAUNCH_STRUCTURE_PROFILE_KM.delugeTankCount >= 4, "expected nearby deluge tank farm cues");
  assert(
    LAUNCH_STRUCTURE_PROFILE_KM.chopstickArmMaxLengthKm <= 0.022,
    "expected shorter 2026-style chopstick arms",
  );

  const structuresSource = fs.readFileSync(
    new URL("../app/static/js/physics/launch/launchSiteStructures.js", import.meta.url),
    "utf8",
  );
  assert(structuresSource.includes("createTowerLattice(THREE, towerGroup"), "expected open lattice tower construction");
  assert(!structuresSource.includes("const towerCore = new THREE.Mesh"), "unexpected solid tower-core block");
  for (const requiredVisualCue of [
    "waterCooledDeck",
    "engineOpening",
    "flameTrenchMouth",
    "flameBucketRidge",
    "serviceBunker",
    "boosterQuickDisconnectHoods",
    "towerBaseAccessOpening",
    "delugeTankGroup",
    "quickDisconnectBeam",
    "chopstickAssemblies",
    "publicProfile",
  ]) {
    assert(
      structuresSource.includes(requiredVisualCue),
      `expected launch-site visual cue ${requiredVisualCue}`,
    );
  }

  const physicsSource = fs.readFileSync(
    new URL("../app/static/js/physics/launch/launchSitePhysicsObjects.js", import.meta.url),
    "utf8",
  );
  for (const requiredCollider of [
    "orbital-launch-mount-water-cooled-deck",
    "orbital-launch-mount-pad2-cuboid-body",
    "orbital-launch-mount-flame-trench",
    "pad2-service-bunker",
    "pad2-booster-quick-disconnect-",
    "deluge-tank-",
    "chopstick-arm",
    "chopstick-carriage",
  ]) {
    assert(
      physicsSource.includes(requiredCollider),
      `expected launch-site physics collider ${requiredCollider}`,
    );
  }

  console.log("PASS launch-site-starbase-2026-profile-lock");
}

main();
