import {
  augmentAttitudeCommand,
  guidanceDirection,
} from "../app/static/js/physics/launch/launchGuidance.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

const earthAxes = {
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 1, z: 0 },
  pole: { x: 0, y: 0, z: 1 },
};

const towerClear = augmentAttitudeCommand({
  phase: "powered",
  throttle: 1,
  direction: { x: 0, y: 1, z: 0 },
  mode: "autopilot-tower-clear",
}, {
  stageIndex: 0,
  altitudeKm: 0.18,
  dynamicPressurePa: 3_500,
});

const gravityTurn = augmentAttitudeCommand({
  phase: "powered",
  throttle: 1,
  direction: { x: 0.2, y: 0.98, z: 0 },
  mode: "autopilot-gravity-turn",
}, {
  stageIndex: 0,
  altitudeKm: 24,
  dynamicPressurePa: 12_000,
});

const limitedGravityTurn = augmentAttitudeCommand({
  phase: "powered",
  throttle: 0.88,
  direction: { x: 0.25, y: 0.97, z: 0 },
  mode: "autopilot-gravity-turn+qalpha-limit",
}, {
  stageIndex: 0,
  altitudeKm: 16,
  dynamicPressurePa: 28_000,
});

const stage2HotstageRamp = augmentAttitudeCommand({
  phase: "powered",
  throttle: 0.42,
  direction: { x: 0, y: 1, z: 0 },
  mode: "autopilot-high-orbit-insertion+hotstage-ramp",
}, {
  stageIndex: 1,
  altitudeKm: 86,
  dynamicPressurePa: 1_500,
});

const mecoCoast = augmentAttitudeCommand({
  phase: "coast",
  throttle: 0,
  direction: { x: 0, y: 1, z: 0 },
  mode: "autopilot-meco-coast",
}, {
  stageIndex: 1,
  altitudeKm: 120,
  dynamicPressurePa: 120,
});

const earlyGuidance = guidanceDirection({
  rocketState: {
    position: { x: 6371.2, y: 0, z: 0 },
    velocity: { x: 0, y: 0.25, z: 0 },
  },
  earthState: {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  },
  earthAxes,
  elapsedSeconds: 12,
  stageIndex: 0,
  altitudeKm: 0.2,
  dynamicPressurePa: 4_000,
});

assert(finitePositive(towerClear.angularAccelerationRadS2), "tower-clear should emit angular accel");
assert(finitePositive(towerClear.angularDampingPerS), "tower-clear should emit damping");
assert(finitePositive(towerClear.maxBodyRateDegS), "tower-clear should emit max body rate");

assert(
  gravityTurn.angularAccelerationRadS2 > towerClear.angularAccelerationRadS2,
  `gravity-turn should turn harder than tower-clear (${gravityTurn.angularAccelerationRadS2} vs ${towerClear.angularAccelerationRadS2})`,
);
assert(
  gravityTurn.maxBodyRateDegS > towerClear.maxBodyRateDegS,
  `gravity-turn should allow a higher body rate than tower-clear (${gravityTurn.maxBodyRateDegS} vs ${towerClear.maxBodyRateDegS})`,
);

assert(
  limitedGravityTurn.angularAccelerationRadS2 < gravityTurn.angularAccelerationRadS2,
  `q-alpha limit should reduce angular accel (${limitedGravityTurn.angularAccelerationRadS2} vs ${gravityTurn.angularAccelerationRadS2})`,
);
assert(
  limitedGravityTurn.maxBodyRateDegS < gravityTurn.maxBodyRateDegS,
  `q-alpha limit should reduce max body rate (${limitedGravityTurn.maxBodyRateDegS} vs ${gravityTurn.maxBodyRateDegS})`,
);
assert(
  limitedGravityTurn.angularDampingPerS > gravityTurn.angularDampingPerS,
  `q-alpha limit should increase damping (${limitedGravityTurn.angularDampingPerS} vs ${gravityTurn.angularDampingPerS})`,
);

assert(
  stage2HotstageRamp.maxBodyRateDegS < gravityTurn.maxBodyRateDegS,
  `hotstage ramp should be gentler than stage1 gravity-turn (${stage2HotstageRamp.maxBodyRateDegS} vs ${gravityTurn.maxBodyRateDegS})`,
);
assert(
  stage2HotstageRamp.angularDampingPerS > gravityTurn.angularDampingPerS,
  `hotstage ramp should be more damped than stage1 gravity-turn (${stage2HotstageRamp.angularDampingPerS} vs ${gravityTurn.angularDampingPerS})`,
);

assert(
  mecoCoast.maxBodyRateDegS < stage2HotstageRamp.maxBodyRateDegS,
  `coast should remain gentler than powered hotstage ramp (${mecoCoast.maxBodyRateDegS} vs ${stage2HotstageRamp.maxBodyRateDegS})`,
);

assert(
  finitePositive(earlyGuidance.angularAccelerationRadS2)
    && finitePositive(earlyGuidance.angularDampingPerS)
    && finitePositive(earlyGuidance.maxBodyRateDegS),
  "guidanceDirection should emit actuator envelope fields",
);

console.log("launch-attitude-control-envelope-lock: ok");
