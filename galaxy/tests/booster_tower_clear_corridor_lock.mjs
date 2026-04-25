import { computeBoosterCatchConstraintStep } from "../app/static/js/physics/launch/launchSiteCatchGeometry.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const catchFrame = {
  centerPosition: { x: 0, y: 0, z: 0 },
  centerVelocity: { x: 0, y: 0, z: 0 },
  eastAxis: { x: 1, y: 0, z: 0 },
  northAxis: { x: 0, y: 1, z: 0 },
  surfaceNormal: { x: 0, y: 0, z: 1 },
};

const centeredBooster = {
  position: { x: 0, y: 0, z: 0.06 },
  velocity: { x: 0, y: 0, z: -0.012 },
};

const towerClearStep = computeBoosterCatchConstraintStep({
  boosterState: centeredBooster,
  catchFrame,
  dtSeconds: 1 / 30,
  contactProgress: 0.25,
  targetOffsetEastKm: -0.024,
  targetOffsetUpKm: 0.04,
  maxCorrectionAccelKmS2: 0.08,
});

assert(towerClearStep, "booster_tower_clear_corridor_lock: expected tower-clear constraint step");
assert(
  towerClearStep.position.x < centeredBooster.position.x,
  `booster_tower_clear_corridor_lock: tower-clear target should move booster away from tower ${JSON.stringify(towerClearStep)}`,
);
assert(
  towerClearStep.eastErrorKm > 0,
  "booster_tower_clear_corridor_lock: booster should remain east of the temporary tower-clear target after one step",
);

const centeredStep = computeBoosterCatchConstraintStep({
  boosterState: centeredBooster,
  catchFrame,
  dtSeconds: 1 / 30,
  contactProgress: 0.25,
  targetOffsetEastKm: 0,
  targetOffsetUpKm: 0.04,
  maxCorrectionAccelKmS2: 0.08,
});

assert(centeredStep, "booster_tower_clear_corridor_lock: expected centered constraint step");
assert(
  Math.abs(centeredStep.position.x) < Math.abs(towerClearStep.position.x),
  "booster_tower_clear_corridor_lock: zero offset should not command tower-clear lateral displacement",
);

console.log("booster-tower-clear-corridor-lock: ok");
