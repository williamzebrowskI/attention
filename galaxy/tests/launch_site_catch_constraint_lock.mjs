import { computeBoosterCatchConstraintStep } from "../app/static/js/physics/launch/launchSiteCatchGeometry.js";
import { length } from "../app/static/js/physics/launch/launchMath.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  let boosterState = {
    position: { x: 0.012, y: -0.006, z: 0.010 },
    velocity: { x: -0.018, y: 0.010, z: -0.028 },
  };
  const catchFrame = {
    centerPosition: { x: 0, y: 0, z: 0 },
    centerVelocity: { x: 0, y: 0, z: 0 },
    surfaceNormal: { x: 0, y: 0, z: 1 },
    eastAxis: { x: 1, y: 0, z: 0 },
    northAxis: { x: 0, y: 1, z: 0 },
  };

  const initialErrorKm = length(boosterState.position);
  const firstStep = computeBoosterCatchConstraintStep({
    boosterState,
    catchFrame,
    dtSeconds: 0.1,
    contactProgress: 0.25,
    captureProgress: 0,
    targetOffsetUpKm: 0.0014,
  });
  assert(firstStep, "expected catch constraint step");
  assert(firstStep.totalErrorKm < initialErrorKm, `expected first catch step to reduce error, got ${firstStep.totalErrorKm} vs ${initialErrorKm}`);
  assert(firstStep.totalErrorKm > 0.001, `expected first catch step to avoid snap-to-zero, got ${firstStep.totalErrorKm}`);

  boosterState = {
    position: { ...firstStep.position },
    velocity: { ...firstStep.velocity },
  };
  let finalStep = firstStep;
  for (let i = 0; i < 24; i += 1) {
    finalStep = computeBoosterCatchConstraintStep({
      boosterState,
      catchFrame,
      dtSeconds: 0.1,
      contactProgress: 1,
      captureProgress: 1,
      targetOffsetUpKm: 0,
    });
    boosterState = {
      position: { ...finalStep.position },
      velocity: { ...finalStep.velocity },
    };
  }

  assert(finalStep.totalErrorKm < 0.0008, `expected catch constraint to settle near the catch frame, got ${finalStep.totalErrorKm}`);
  assert(finalStep.totalSpeedKmS < 0.003, `expected catch constraint to damp relative speed, got ${finalStep.totalSpeedKmS}`);
  console.log("PASS launch-site-catch-constraint-lock");
}

main();
