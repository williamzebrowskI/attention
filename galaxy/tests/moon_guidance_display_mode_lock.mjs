import { canonicalizeMoonGuidanceDisplayMode } from "../app/static/js/physics/launch/launchFleetController.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const missionId = "moon_orbit_return";

  assert(
    canonicalizeMoonGuidanceDisplayMode(
      "navsys:gnc-lambert-tli-burn+seed-lock+diffcorr",
      missionId,
    ) === "navsys:gnc-lambert-tli-burn",
    "expected TLI burn variants to collapse to navsys:gnc-lambert-tli-burn",
  );

  assert(
    canonicalizeMoonGuidanceDisplayMode(
      "navsys:gnc-lambert-tli-hold",
      missionId,
    ) === "navsys:gnc-lambert-tli-hold",
    "expected TLI hold to remain navsys:gnc-lambert-tli-hold",
  );

  assert(
    canonicalizeMoonGuidanceDisplayMode(
      "navsys:gnc-lambert-midcourse-coast",
      missionId,
    ) === "navsys:gnc-lambert-midcourse-coast",
    "expected midcourse coast to remain navsys:gnc-lambert-midcourse-coast",
  );

  assert(
    canonicalizeMoonGuidanceDisplayMode(
      "navsys:gnc-lambert-midcourse-correction+diffcorr",
      missionId,
    ) === "navsys:gnc-lambert-midcourse-correction",
    "expected midcourse correction variants to collapse to navsys:gnc-lambert-midcourse-correction",
  );

  assert(
    canonicalizeMoonGuidanceDisplayMode(
      "navsys:moon-survival-recovery:attitude-align",
      missionId,
    ) === "navsys:moon-survival-recovery:attitude-align",
    "expected survival recovery overlays to retain overlay suffix on collapsed mode",
  );

  assert(
    canonicalizeMoonGuidanceDisplayMode(
      "navsys:orbital-refuel-await-target",
      missionId,
    ) === "navsys:orbital-refuel-await-target",
    "expected non-moon-refuel guidance to remain unchanged",
  );

  assert(
    canonicalizeMoonGuidanceDisplayMode(
      "navsys:gnc-lambert-tli-burn+seed-lock+diffcorr",
      "orbital_refuel_demo",
    ) === "navsys:gnc-lambert-tli-burn+seed-lock+diffcorr",
    "expected non-moon missions to keep raw guidance names",
  );

  console.log("PASS moon-guidance-display-mode-lock");
}

main();
