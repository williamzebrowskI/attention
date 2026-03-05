import { evaluateMoonBurnAttitudeGate } from "../app/static/js/physics/launch/lunar/moonBurnAttitudeGate.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function testGateLatchesTargetUntilAligned() {
  const xAxis = { x: 1, y: 0, z: 0 };
  const yAxis = { x: 0, y: 1, z: 0 };
  const zAxis = { x: 0, y: 0, z: 1 };

  let state = evaluateMoonBurnAttitudeGate({
    gateEligible: true,
    gateWasActive: false,
    currentAxis: xAxis,
    desiredDirection: yAxis,
    dtSeconds: 0.1,
    enterErrorDeg: 5,
    exitErrorDeg: 2,
    releaseDwellSec: 0.75,
  });
  assert(state.gateActive, "Gate should activate for large initial attitude error");
  assert(state.throttleSuppressed, "Gate should suppress throttle while aligning");
  assert(dot(state.requestedDirection, yAxis) > 0.999, "Gate should latch first target direction");

  // Desired target swings while gate is active; gate should keep latched direction.
  state = evaluateMoonBurnAttitudeGate({
    gateEligible: true,
    gateWasActive: state.gateActive,
    currentAxis: { x: 0.4, y: 0.9, z: 0 },
    desiredDirection: zAxis,
    latchedDirection: state.latchedDirection,
    alignStableSec: state.alignStableSec,
    dtSeconds: 0.2,
    enterErrorDeg: 5,
    exitErrorDeg: 2,
    releaseDwellSec: 0.75,
  });
  assert(state.gateActive, "Gate should remain active until aligned to latched axis");
  assert(dot(state.requestedDirection, yAxis) > 0.98, "Gate should keep steering to latched axis");
}

function testGateReleasesAfterAlignedDwell() {
  const yAxis = { x: 0, y: 1, z: 0 };
  const zAxis = { x: 0, y: 0, z: 1 };

  let state = {
    gateActive: true,
    latchedDirection: yAxis,
    alignStableSec: 0,
  };
  for (let i = 0; i < 5; i += 1) {
    state = evaluateMoonBurnAttitudeGate({
      gateEligible: true,
      gateWasActive: state.gateActive,
      currentAxis: yAxis,
      desiredDirection: yAxis,
      latchedDirection: state.latchedDirection,
      alignStableSec: state.alignStableSec,
      dtSeconds: 0.2,
      enterErrorDeg: 5,
      exitErrorDeg: 2,
      releaseDwellSec: 0.75,
    });
  }
  assert(!state.gateActive, "Gate should release after stable alignment dwell");
  assert(!state.throttleSuppressed, "Throttle should be restored after release");
  state = evaluateMoonBurnAttitudeGate({
    gateEligible: false,
    gateWasActive: state.gateActive,
    currentAxis: yAxis,
    desiredDirection: zAxis,
    latchedDirection: state.latchedDirection,
    alignStableSec: state.alignStableSec,
    dtSeconds: 0.2,
    enterErrorDeg: 5,
    exitErrorDeg: 2,
    releaseDwellSec: 0.75,
  });
  assert(dot(state.requestedDirection, zAxis) > 0.999, "After release, requested direction should follow latest desired");
}

function testNoGateForSmallError() {
  const nearlyAligned = { x: 0.9986, y: 0.0523, z: 0 };
  const desired = { x: 1, y: 0, z: 0 };
  const result = evaluateMoonBurnAttitudeGate({
    gateEligible: true,
    gateWasActive: false,
    currentAxis: nearlyAligned,
    desiredDirection: desired,
    dtSeconds: 0.1,
    enterErrorDeg: 5,
    exitErrorDeg: 2,
    releaseDwellSec: 0.75,
  });
  assert(!result.gateActive, "Gate should stay inactive for small error inside enter threshold");
  assert(!result.throttleSuppressed, "Throttle should not be suppressed when gate is inactive");
}

function run() {
  testGateLatchesTargetUntilAligned();
  testGateReleasesAfterAlignedDwell();
  testNoGateForSmallError();
  // eslint-disable-next-line no-console
  console.log("PASS moon-burn-attitude-gate conflict suite");
}

run();
