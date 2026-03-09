import { NAVIGATION_DEFAULTS } from "../navigationSystemConfig.js";
import { planMoonClosedLoopMissionCommand } from "../lunar/moonClosedLoopTargeters.js";

export function planMoonMissionGncCommand({
  phase,
  targetVectors = {},
  metrics = {},
  plannerConfig = NAVIGATION_DEFAULTS.planner,
  estimatorConfig = NAVIGATION_DEFAULTS.estimator,
  plannerRuntime = null,
  timestampSec = Number.NaN,
} = {}) {
  return planMoonClosedLoopMissionCommand({
    phase,
    targetVectors,
    metrics,
    plannerConfig,
    estimatorConfig,
    plannerRuntime,
    timestampSec,
  });
}
