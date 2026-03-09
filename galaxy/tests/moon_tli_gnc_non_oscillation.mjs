import { planMoonMissionGncCommand } from "../app/static/js/physics/navigation_system/gnc/moonMissionGncStack.js";
import { NAVIGATION_DEFAULTS } from "../app/static/js/physics/navigation_system/navigationSystemConfig.js";
import { createPlannerRuntime } from "../app/static/js/physics/navigation_system/planners/moonGuidanceState.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function baseTargetVectors() {
  const shipEarthPositionKm = { x: 6521, y: 0, z: 0 };
  const shipEarthVelocityKmS = { x: 0, y: 7.82, z: 0 };
  const moonEarthPositionKm = { x: 384400, y: 0, z: 0 };
  const moonEarthVelocityKmS = { x: 0, y: 1.022, z: 0 };
  return {
    tangent: { x: 0, y: 1, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    toMoon: { x: 1, y: 0, z: 0 },
    shipEarthPositionKm,
    shipEarthVelocityKmS,
    moonEarthPositionKm,
    moonEarthVelocityKmS,
  };
}

function baseMetrics(overrides = {}) {
  return {
    moonDistanceKm: 385000,
    moonClosingSpeedKmS: 0.01,
    moonProjectedMissTrendKmS: 0.01,
    timeToPeriapsisSec: 1200,
    moonRadiusKm: 1737.4,
    ...overrides,
  };
}

function runCommand({
  phase,
  metrics = {},
  targetVectors = {},
  plannerRuntime = createPlannerRuntime(),
  timestampSec = 0,
}) {
  return planMoonMissionGncCommand({
    phase,
    targetVectors: {
      ...baseTargetVectors(),
      ...targetVectors,
    },
    metrics: baseMetrics(metrics),
    plannerConfig: NAVIGATION_DEFAULTS.planner,
    plannerRuntime,
    timestampSec,
  });
}

function modeFamily(mode = "") {
  const label = String(mode || "");
  if (label.includes("navsys:gnc-lambert-tli-hold")) {
    return "reacquire_hold";
  }
  if (label.includes("navsys:gnc-lambert-tli-burn")) {
    return "tli_burn";
  }
  if (label.includes("go-no-go-hold")) {
    return "go_no_go_hold";
  }
  return "other";
}

function collapseFamilies(sequence = []) {
  const collapsed = [];
  for (const entry of sequence) {
    if (collapsed.length === 0 || collapsed[collapsed.length - 1] !== entry) {
      collapsed.push(entry);
    }
  }
  return collapsed;
}

function main() {
  const runtime = createPlannerRuntime();
  const sequence = [];

  const holdA = runCommand({
    phase: "tli_burn",
    plannerRuntime: runtime,
    timestampSec: 0,
    metrics: {
      moonClosingSpeedKmS: -0.03,
      moonProjectedMissTrendKmS: 0.12,
      timeToPeriapsisSec: 1200,
    },
  });
  sequence.push(modeFamily(holdA?.mode));
  assert(
    sequence[0] === "reacquire_hold",
    `moon_tli_gnc_non_oscillation: expected initial reacquire hold, got ${holdA?.mode}`,
  );

  const holdB = runCommand({
    phase: "tli_burn",
    plannerRuntime: runtime,
    timestampSec: 10,
    metrics: {
      moonClosingSpeedKmS: -0.03,
      moonProjectedMissTrendKmS: 0.12,
      timeToPeriapsisSec: 1200,
    },
  });
  sequence.push(modeFamily(holdB?.mode));
  assert(
    sequence[1] === "reacquire_hold",
    `moon_tli_gnc_non_oscillation: expected reacquire hold to persist, got ${holdB?.mode}`,
  );

  const burnA = runCommand({
    phase: "tli_burn",
    plannerRuntime: runtime,
    timestampSec: 40,
    metrics: {
      moonClosingSpeedKmS: -0.03,
      moonProjectedMissTrendKmS: 0.12,
      timeToPeriapsisSec: 100,
    },
  });
  sequence.push(modeFamily(burnA?.mode));
  assert(
    sequence[2] === "tli_burn",
    `moon_tli_gnc_non_oscillation: expected periapsis-window burn takeover, got ${burnA?.mode}`,
  );
  assert(
    Number(burnA?.throttle) > 0,
    `moon_tli_gnc_non_oscillation: expected positive burn throttle after hold, got ${burnA?.throttle}`,
  );

  const burnB = runCommand({
    phase: "tli_burn",
    plannerRuntime: runtime,
    timestampSec: 50,
    metrics: {
      moonClosingSpeedKmS: -0.03,
      moonProjectedMissTrendKmS: 0.12,
      timeToPeriapsisSec: 100,
    },
  });
  sequence.push(modeFamily(burnB?.mode));
  assert(
    sequence[3] === "tli_burn",
    `moon_tli_gnc_non_oscillation: expected burn family to remain stable, got ${burnB?.mode}`,
  );
  assert(
    Number(burnB?.throttle) > 0,
    `moon_tli_gnc_non_oscillation: expected sustained burn throttle, got ${burnB?.throttle}`,
  );

  const collapsed = collapseFamilies(sequence);
  assert(
    collapsed.length === 2,
    `moon_tli_gnc_non_oscillation: expected single hold->burn transition, got ${collapsed.join(" -> ")}`,
  );
  assert(
    collapsed[0] === "reacquire_hold" && collapsed[1] === "tli_burn",
    `moon_tli_gnc_non_oscillation: unexpected family progression ${collapsed.join(" -> ")}`,
  );

  console.log("PASS moon-tli-gnc-non-oscillation");
}

main();
