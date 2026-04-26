import {
  resolveBoosterGridFinPhaseState,
  resolveBoosterRecoveryHardwareState,
} from "../app/static/js/physics/launch/boosterRecovery.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertAllFinStates(state, expectedCommandState) {
  assert(Array.isArray(state.gridFinStates), "expected per-fin telemetry states");
  assert(state.gridFinStates.length === 4, `expected four grid-fin states, got ${state.gridFinStates.length}`);
  for (const finState of state.gridFinStates) {
    assert(
      finState.commandState === expectedCommandState,
      `expected ${expectedCommandState} for ${finState.name}, got ${finState.commandState}`,
    );
  }
}

function main() {
  const attached = resolveBoosterGridFinPhaseState({
    phase: "attached-stack",
    guidanceMode: "booster-attached-joint",
    boosterAttached: true,
    dynamicPressurePa: 0,
  });
  assert(attached.gridFinDeploymentState === "fixed-exposed-no-deploy", `unexpected attached deployment ${attached.gridFinDeploymentState}`);
  assert(attached.gridFinPhaseState === "attached-ascent-exposed", `unexpected attached phase ${attached.gridFinPhaseState}`);
  assert(attached.gridFinCommandState === "neutral", `unexpected attached command ${attached.gridFinCommandState}`);
  assertAllFinStates(attached, "neutral");

  const descent = resolveBoosterGridFinPhaseState({
    phase: "terminal-intercept",
    guidanceMode: "booster-grid-fin-terminal",
    gridFinAuthority: 0.42,
    dynamicPressurePa: 18_000,
    gridFinMaxDeflectionDeg: 32,
    gridFinStates: [
      { name: "starboard-forward", deflectionDeg: 9.5, dynamicPressurePa: 18_000, effectiveness: 0.7 },
      { name: "port-forward", deflectionDeg: -7.0, dynamicPressurePa: 17_500, effectiveness: 0.65 },
      { name: "port-aft", deflectionDeg: 4.5, dynamicPressurePa: 18_300, effectiveness: 0.62 },
      { name: "starboard-aft", deflectionDeg: -5.2, dynamicPressurePa: 18_100, effectiveness: 0.64 },
    ],
  });
  assert(descent.gridFinPhaseState === "descent-primary-guidance", `unexpected descent phase ${descent.gridFinPhaseState}`);
  assert(descent.gridFinCommandState === "actively-steering", `unexpected descent command ${descent.gridFinCommandState}`);
  assert(descent.gridFinControlActive === true, "expected descent grid fins to be active");
  assertAllFinStates(descent, "actively-steering");

  const saturated = resolveBoosterGridFinPhaseState({
    phase: "descent-coast",
    gridFinAuthority: 0.95,
    dynamicPressurePa: 22_000,
    gridFinMaxDeflectionDeg: 32,
    gridFinStates: [
      { name: "starboard-forward", deflectionDeg: 30.5, dynamicPressurePa: 22_000, effectiveness: 0.9 },
      { name: "port-forward", deflectionDeg: -4.0, dynamicPressurePa: 21_500, effectiveness: 0.75 },
      { name: "port-aft", deflectionDeg: 5.0, dynamicPressurePa: 22_300, effectiveness: 0.72 },
      { name: "starboard-aft", deflectionDeg: -6.0, dynamicPressurePa: 22_200, effectiveness: 0.73 },
    ],
  });
  assert(saturated.gridFinCommandState === "saturated", `unexpected saturated command ${saturated.gridFinCommandState}`);
  assert(saturated.gridFinSaturated === true, "expected saturated grid-fin aggregate");
  assert(saturated.gridFinStates[0].commandState === "saturated", "expected first fin to report saturation");

  const catchLocked = resolveBoosterRecoveryHardwareState({
    phase: "caught",
    guidanceMode: "booster-caught",
    catchCaptureActive: true,
    gridFinAuthority: 0.02,
    dynamicPressurePa: 50,
  });
  assert(catchLocked.gridFinDeploymentState === "exposed-support-locked", `unexpected catch deployment ${catchLocked.gridFinDeploymentState}`);
  assert(catchLocked.gridFinCommandState === "locked", `unexpected catch command ${catchLocked.gridFinCommandState}`);
  assertAllFinStates(catchLocked, "locked");

  console.log("PASS booster-grid-fin-phase-state-lock");
}

main();
