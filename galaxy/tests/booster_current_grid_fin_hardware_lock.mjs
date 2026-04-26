import fs from "node:fs";

import { STARSHIP_STACK_DIMENSIONS_KM } from "../app/static/js/physics/launch/launchConfig.js";
import { LAUNCH_REALISM_CONFIG } from "../app/static/js/physics/launch/launchRealismConfig.js";
import { resolveBoosterRecoveryHardwareState } from "../app/static/js/physics/launch/boosterRecovery.js";
import { boosterRecoveryEngineCountForPhase } from "../app/static/js/physics/launch/launchController.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function angleDegFromFin(fin) {
  const x = Number(fin?.positionBodyM?.x) || 0;
  const z = Number(fin?.positionBodyM?.z) || 0;
  const deg = Math.atan2(z, x) * 180 / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

function main() {
  const profile = LAUNCH_REALISM_CONFIG.gridFins.booster;
  const fins = Array.isArray(profile.fins) ? profile.fins : [];
  const boosterHeightM = STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm * 1000;
  const finHeightRatio = Math.max(...fins.map((fin) => Number(fin?.positionBodyM?.y) || 0)) / boosterHeightM;
  const angles = fins.map(angleDegFromFin).sort((a, b) => a - b);

  assert(profile.generation === "current-public-four-fin", `unexpected grid-fin generation ${profile.generation}`);
  assert(fins.length === 4, `expected four current Super Heavy grid fins, got ${fins.length}`);
  assert(profile.totalAreaM2 >= 44, `expected four public grid fins with meaningful area, got ${profile.totalAreaM2}`);
  assert(finHeightRatio > 0.36 && finHeightRatio < 0.43, `expected upper-mounted current fins, y/H=${finHeightRatio}`);
  assert(
    Math.abs(angles[0] - 60) < 0.1
      && Math.abs(angles[1] - 120) < 0.1
      && Math.abs(angles[2] - 240) < 0.1
      && Math.abs(angles[3] - 300) < 0.1,
    `expected four paired current grid fins, got ${angles.join(", ")}`,
  );
  assert(
    fins.every((fin) => fin.orientation === "horizontal-radial-grid"),
    "expected grid fins to be modeled as horizontal radial grid fins",
  );

  const visualSource = fs.readFileSync(
    new URL("../app/static/js/physics/launch/superHeavyBoosterVisual.js", import.meta.url),
    "utf8",
  );
  const inlineVisualSource = fs.readFileSync(
    new URL("../app/static/js/physics/launch/starshipInlineVisual.js", import.meta.url),
    "utf8",
  );
  assert(visualSource.includes("createCurrentGridFinAssembly"), "expected current four-fin visual assembly");
  assert(!visualSource.includes("createNextGenGridFinAssembly"), "unexpected old next-gen three-fin visual assembly");
  assert(
    visualSource.includes("gridFinOrientation = \"horizontal-radial-grid\"")
      && inlineVisualSource.includes("horizontal radial grid fins"),
    "expected horizontal radial grid-fin visual orientation to be locked",
  );
  assert(
    !inlineVisualSource.includes("three larger lower-mounted grid fins"),
    "unexpected stale three-fin inline booster visual",
  );

  const descentHardware = resolveBoosterRecoveryHardwareState({
    phase: "terminal-intercept",
    attitudeControlMode: "grid-fins+rcs",
    gridFinAuthority: 0.64,
    dynamicPressurePa: 18_000,
    throttle: 0,
  });
  assert(
    descentHardware.gridFinGeneration === "current-public-four-fin",
    `expected four-fin hardware telemetry, got ${descentHardware.gridFinGeneration}`,
  );
  assert(
    descentHardware.gridFinDeploymentState === "fixed-exposed-no-deploy",
    `expected fixed exposed no-deploy grid fins, got ${descentHardware.gridFinDeploymentState}`,
  );
  assert(
    descentHardware.gridFinRole === "primary-atmospheric-crossrange-guidance",
    `expected grid fins to own atmospheric crossrange guidance, got ${descentHardware.gridFinRole}`,
  );
  assert(descentHardware.gridFinControlDominant === true, "expected grid fins to be dominant with engines off in terminal intercept");
  assert(descentHardware.engineRole === "off", `expected engines off during terminal intercept, got ${descentHardware.engineRole}`);

  const landingHardware = resolveBoosterRecoveryHardwareState({
    phase: "landing-burn",
    attitudeControlMode: "engines+rcs",
    gridFinAuthority: 0.08,
    dynamicPressurePa: 1_400,
    throttle: 0.74,
    desiredEngineCount: 13,
    activeEngineCount: 13,
  });
  assert(landingHardware.engineSet === "inner-13", `expected landing burn inner-13 engine set, got ${landingHardware.engineSet}`);
  assert(landingHardware.engineRole === "terminal-vertical-braking", `expected landing brake role, got ${landingHardware.engineRole}`);

  const catchHardware = resolveBoosterRecoveryHardwareState({
    phase: "catch-burn",
    attitudeControlMode: "engines+rcs",
    gridFinAuthority: 0.04,
    dynamicPressurePa: 900,
    throttle: 0.32,
    desiredEngineCount: 3,
    activeEngineCount: 3,
    towerRelativeActive: true,
    catchPositionSigmaKm: 0.004,
    catchVelocitySigmaKmS: 0.00004,
  });
  assert(catchHardware.engineSet === "center-3", `expected final catch burn center-3 engine set, got ${catchHardware.engineSet}`);
  assert(catchHardware.engineRole === "precision-catch-translation", `expected precision catch engine role, got ${catchHardware.engineRole}`);
  assert(catchHardware.towerSensorMode === "tower-radar-relative", `expected tower-relative sensor mode, got ${catchHardware.towerSensorMode}`);
  assert(catchHardware.towerSensorHealthy === true, "expected healthy tower-relative catch sensor state");
  assert(catchHardware.catchCommitState === "final-catch-commit", `expected final catch commit, got ${catchHardware.catchCommitState}`);

  assert(boosterRecoveryEngineCountForPhase("boostback", 33) === 13, "expected boostback to cap at the public inner-13 engines");
  assert(boosterRecoveryEngineCountForPhase("landing-burn", 33) === 13, "expected landing burn to start on inner-13 engines");
  assert(boosterRecoveryEngineCountForPhase("catch-burn", 33) === 3, "expected precision catch burn to use the center-3 engines");

  console.log("PASS booster-current-grid-fin-hardware-lock");
}

main();
