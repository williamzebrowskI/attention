import {
  LAUNCH_BOOSTER_CONFIG,
  LAUNCH_VEHICLE_CONFIG,
  resolveConfiguredThrustBoundsN,
} from "../app/static/js/physics/launch/launchConfig.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function approxEqual(actual, expected, tolerance, label) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function main() {
  const stage1 = LAUNCH_VEHICLE_CONFIG.stages[0];
  const nominalStage1 = resolveConfiguredThrustBoundsN(stage1);
  approxEqual(
    nominalStage1.thrustSeaLevelN,
    Number(stage1.thrustSeaLevelN) || 0,
    1e-6,
    "stage1 nominal sea-level thrust",
  );
  approxEqual(
    nominalStage1.thrustVacuumN,
    Number(stage1.thrustVacuumN) || 0,
    1e-6,
    "stage1 nominal vacuum thrust",
  );

  const singleStage1 = resolveConfiguredThrustBoundsN({
    ...stage1,
    engineCount: 1,
  });
  approxEqual(
    singleStage1.thrustSeaLevelN,
    (Number(stage1.thrustSeaLevelN) || 0) / 33,
    1e-6,
    "stage1 single-engine sea-level thrust",
  );
  approxEqual(
    singleStage1.thrustVacuumN,
    (Number(stage1.thrustVacuumN) || 0) / 33,
    1e-6,
    "stage1 single-engine vacuum thrust",
  );

  const boosterNominal = resolveConfiguredThrustBoundsN(LAUNCH_BOOSTER_CONFIG);
  approxEqual(
    boosterNominal.thrustSeaLevelN,
    Number(LAUNCH_BOOSTER_CONFIG.thrustSeaLevelN) || 0,
    1e-6,
    "booster nominal sea-level thrust",
  );
  approxEqual(
    boosterNominal.thrustVacuumN,
    Number(LAUNCH_BOOSTER_CONFIG.thrustVacuumN) || 0,
    1e-6,
    "booster nominal vacuum thrust",
  );

  const singleBooster = resolveConfiguredThrustBoundsN({
    ...LAUNCH_BOOSTER_CONFIG,
    engineCount: 1,
  });
  approxEqual(
    singleBooster.thrustSeaLevelN,
    (Number(LAUNCH_BOOSTER_CONFIG.thrustSeaLevelN) || 0) / 13,
    1e-6,
    "booster single-engine sea-level thrust",
  );
  approxEqual(
    singleBooster.thrustVacuumN,
    (Number(LAUNCH_BOOSTER_CONFIG.thrustVacuumN) || 0) / 13,
    1e-6,
    "booster single-engine vacuum thrust",
  );

  const zeroEngineBooster = resolveConfiguredThrustBoundsN({
    ...LAUNCH_BOOSTER_CONFIG,
    engineCount: 0,
  });
  assert(zeroEngineBooster.thrustSeaLevelN === 0, "expected zero booster sea-level thrust with zero engines");
  assert(zeroEngineBooster.thrustVacuumN === 0, "expected zero booster vacuum thrust with zero engines");

  console.log("PASS launch-engine-count-scaling-lock");
}

main();
