import { normalize, scale } from "../navigationMath.js";
import {
  legacyMoonMissionPhase,
  NAVIGATION_MISSION_PHASES,
  normalizeMissionPhase,
} from "../navigationMissionProfiles.js";
import { NAVIGATION_DEFAULTS } from "../navigationSystemConfig.js";
import { planMoonMissionGncCommand } from "../gnc/moonMissionGncStack.js";
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
  const phaseName = normalizeMissionPhase(phase, "moon_orbit_return");
  const legacyPhaseName = legacyMoonMissionPhase(phaseName);

  if (legacyPhaseName === "orbital_refuel") {
    const hasRefuelTarget = targetVectors?.toRefuelTarget && metrics?.refuelTargetDistanceKm > 0;
    if (hasRefuelTarget) {
      return planRefuelRendezvousCommand({
        targetVectors,
        metrics,
        tangent,
      });
    }
  }

  const moonCommand = planMoonMissionGncCommand({
    phase: legacyPhaseName,
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
    direction: phaseName === NAVIGATION_MISSION_PHASES.EARTH_APPROACH ? earthDirection : tangent,
    mode: "navsys:gnc-standby",
  };
}
