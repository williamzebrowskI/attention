import { normalize, scale } from "../navigationMath.js";
import { NAVIGATION_MISSION_PHASES } from "../navigationMissionProfiles.js";
import { NAVIGATION_DEFAULTS } from "../navigationSystemConfig.js";
import { planMoonClosedLoopMissionCommand } from "../lunar/moonClosedLoopTargeters.js";
import { planRefuelRendezvousCommand } from "./refuelRendezvousPlanner.js";

export function planMoonMissionCommand({
  phase,
  targetVectors = {},
  metrics = {},
  plannerConfig = NAVIGATION_DEFAULTS.planner,
  estimatorConfig = NAVIGATION_DEFAULTS.estimator,
  plannerRuntime = null,
  timestampSec = Number.NaN,
} = {}) {
  const tangent = normalize(targetVectors.tangent, { x: 0, y: 1, z: 0 });
  const up = normalize(targetVectors.up, { x: 0, y: 0, z: 1 });
  const moonDirection = normalize(targetVectors.toMoon, tangent);
  const earthDirection = normalize(targetVectors.toEarth, scale(up, -1));
  const phaseName = String(phase || "").trim();

  if (phaseName === NAVIGATION_MISSION_PHASES.ORBITAL_REFUEL) {
    return planRefuelRendezvousCommand({
      targetVectors,
      metrics,
      tangent,
    });
  }

  const moonCommand = planMoonClosedLoopMissionCommand({
    phase: phaseName,
    targetVectors: {
      ...targetVectors,
      tangent,
      up,
      toMoon: moonDirection,
      toEarth: earthDirection,
    },
    metrics,
    plannerConfig,
    estimatorConfig,
    plannerRuntime,
    timestampSec,
  });
  if (moonCommand) {
    return moonCommand;
  }

  return {
    phase: "coast",
    throttle: 0,
    direction: phaseName === NAVIGATION_MISSION_PHASES.COAST_TO_EARTH ? earthDirection : tangent,
    mode: "navsys:gnc-standby",
  };
}
