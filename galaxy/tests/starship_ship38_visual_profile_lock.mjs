import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertSourceContains(source, fileLabel, expectedTokens) {
  for (const token of expectedTokens) {
    assert(source.includes(token), `expected ${fileLabel} to include ${token}`);
  }
}

function main() {
  const proceduralSource = fs.readFileSync(
    new URL("../app/static/js/physics/launch/launchVisuals.js", import.meta.url),
    "utf8",
  );
  const inlineSource = fs.readFileSync(
    new URL("../app/static/js/physics/launch/starshipInlineVisual.js", import.meta.url),
    "utf8",
  );
  const appSource = fs.readFileSync(
    new URL("../app/static/js/app.js", import.meta.url),
    "utf8",
  );

  assertSourceContains(proceduralSource, "procedural Starship visual", [
    "accurate-starship-upper-stage-exterior",
    "createPartialLatheSurfaceGeometry",
    "createSweptPaddleGeometry",
    "shipHullProfile.push(new THREE.Vector2(radius, y))",
    "starship_dark_engine_skirt",
    "starship_vacuum_raptor_",
    "starship_sea_level_raptor_",
    "starship_aft_flap_port",
    "starship_forward_flap_starboard",
    "addPayloadDoorOutline",
    "starshipUpperStageHeatShieldPatchCount = 0",
    "SpaceX Starship upper-stage exterior",
  ]);

  assert(
    proceduralSource.includes("stagger = (row % 2) * (tileW * 0.5)")
      && proceduralSource.includes("chamfer"),
    "expected procedural heat-shield texture to use staggered chamfered tile cells",
  );
  assert(
    !proceduralSource.includes("ship38HeatShieldTestPatches")
      && !proceduralSource.includes("ship38Flight11AftFlapTileTestPatch")
      && !proceduralSource.includes("ship38Flight11MissingTilePatch")
      && !proceduralSource.includes("SHIP38_FLIGHT11")
      && !proceduralSource.includes("navigationBeacon")
      && !proceduralSource.includes("payloadDoorSeam"),
    "expected primary Starship renderer to remove random Flight 11 patch panels, nose beacon, and filled payload-door slab",
  );
  for (const removedFallbackToken of [
    "createInlineStarshipStackVisual",
    "applyInlineStarshipVisualStage",
    "applyInlineStarshipAtmosphereEffects",
    "inlineStarshipPhysicalRenderRadiusScene",
    "INLINE_SHIP38_FLIGHT11_VISUAL_PROFILE",
    "INLINE_SHIP38_FLIGHT11_MISSING_TILE_PATCHES",
    "inline_procedural_starship_stack",
    "fallback_spacecraft_geometry",
    "using inline fallback",
  ]) {
    assert(
      !inlineSource.includes(removedFallbackToken) && !appSource.includes(removedFallbackToken),
      `unexpected Starship fallback token remains: ${removedFallbackToken}`,
    );
  }
  assert(
    appSource.includes("throw new Error(\"launchVisuals primary Starship exports missing.\")"),
    "expected app startup to fail loudly when primary Starship visual exports are missing",
  );

  console.log("PASS starship-upper-stage-visual-profile-lock");
}

main();
