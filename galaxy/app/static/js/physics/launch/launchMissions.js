export const LAUNCH_MISSION_IDS = Object.freeze({
  EARTH_ORBIT_HOLD: "earth_orbit_hold",
  ORBITAL_REFUEL_DEMO: "orbital_refuel_demo",
  MOON_ORBIT_RETURN: "moon_orbit_return",
});

export const DEFAULT_LAUNCH_MISSION_ID = LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD;

export const LAUNCH_MISSION_PROFILES = Object.freeze([
  Object.freeze({
    id: LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD,
    name: "Earth Orbit Hold",
    description: "Launch to Earth orbit and hold station continuously until reset.",
  }),
  Object.freeze({
    id: LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO,
    name: "Orbital Refuel Demo",
    description: "Launch to parking orbit, refuel in orbit, undock, then return to Earth orbit hold.",
  }),
  Object.freeze({
    id: LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN,
    name: "Moon Orbit + Return",
    description: "Launch, transfer to Moon, enter lunar orbit, then return to Earth orbit.",
  }),
]);

const PROFILE_BY_ID = new Map(LAUNCH_MISSION_PROFILES.map((profile) => [profile.id, profile]));

export function normalizeMissionId(missionId) {
  const key = String(missionId || "").trim();
  if (PROFILE_BY_ID.has(key)) {
    return key;
  }
  return DEFAULT_LAUNCH_MISSION_ID;
}

export function missionProfileById(missionId) {
  return PROFILE_BY_ID.get(normalizeMissionId(missionId)) || PROFILE_BY_ID.get(DEFAULT_LAUNCH_MISSION_ID);
}
