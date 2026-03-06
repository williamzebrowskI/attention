import { createLaunchController } from "../app/static/js/physics/launch/launchController.js";
import { LAUNCH_MISSION_IDS } from "../app/static/js/physics/launch/launchMissions.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const EARTH_MASS_KG = 5.97237e24;
const EARTH_RADIUS_KM = 6371;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const EARTH_MU_KM3_S2 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * EARTH_MASS_KG;
const NOW_MS = Date.UTC(2026, 2, 5, 15, 0, 0);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function add(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function scale(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function cross(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function length(vector) {
  return Math.sqrt(dot(vector, vector));
}

function normalize(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const magnitude = length(vector);
  if (!(magnitude > 1e-9)) {
    return fallback;
  }
  return scale(vector, 1 / magnitude);
}

function earthAxes() {
  return {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    pole: { x: 0, y: 0, z: 1 },
  };
}

function sampleEarthAtmosphere() {
  return {
    densityKgM3: 0,
    pressurePa: 0,
    temperatureK: 0,
  };
}

function makeState() {
  return {
    dynamicBodies: new Map(),
    staticSources: new Map([
      [
        "earth",
        {
          id: "earth",
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          massKg: EARTH_MASS_KG,
        },
      ],
      [
        "moon",
        {
          id: "moon",
          position: { x: 384400, y: 0, z: 0 },
          velocity: { x: 0, y: 1.022, z: 0 },
          massKg: MOON_MASS_KG,
        },
      ],
    ]),
  };
}

function createHarness() {
  return createLaunchController({
    getEarthRadiusKm: () => EARTH_RADIUS_KM,
    getEarthMassKg: () => EARTH_MASS_KG,
    getBodyRadiusKm: (id) => (String(id) === "moon" ? MOON_RADIUS_KM : EARTH_RADIUS_KM),
    getBodyMassKg: (id) => (String(id) === "moon" ? MOON_MASS_KG : EARTH_MASS_KG),
    getEarthFixedAxesEcliptic: earthAxes,
    sampleEarthAtmosphere,
    gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
  });
}

function makeEllipticOrbitState({
  periapsisKm = 150,
  apoapsisKm = 154,
  trueAnomalyRad = 0,
} = {}) {
  const periapsisRadiusKm = EARTH_RADIUS_KM + periapsisKm;
  const apoapsisRadiusKm = EARTH_RADIUS_KM + apoapsisKm;
  const semiMajorAxisKm = (periapsisRadiusKm + apoapsisRadiusKm) * 0.5;
  const eccentricity = (apoapsisRadiusKm - periapsisRadiusKm) / (apoapsisRadiusKm + periapsisRadiusKm);
  const semiLatusRectumKm = semiMajorAxisKm * (1 - (eccentricity * eccentricity));
  const radiusKm = semiLatusRectumKm / (1 + (eccentricity * Math.cos(trueAnomalyRad)));
  const specificAngularMomentumKm2S = Math.sqrt(EARTH_MU_KM3_S2 * semiLatusRectumKm);
  return {
    position: {
      x: radiusKm * Math.cos(trueAnomalyRad),
      y: radiusKm * Math.sin(trueAnomalyRad),
      z: 0,
    },
    velocity: {
      x: -(EARTH_MU_KM3_S2 / specificAngularMomentumKm2S) * Math.sin(trueAnomalyRad),
      y: (EARTH_MU_KM3_S2 / specificAngularMomentumKm2S) * (eccentricity + Math.cos(trueAnomalyRad)),
      z: 0,
    },
  };
}

function inferStage(snapshot) {
  const gate = String(snapshot?.missionPhaseGateReason || "");
  const mode = String(snapshot?.guidanceMode || "");
  if (snapshot?.refuelUndockActive || gate.includes("Undock sequence active")) {
    return "undocking";
  }
  if (snapshot?.refuelTransferActive || gate.includes("Transfer active")) {
    return "transferring";
  }
  if (snapshot?.refuelTransferLocked || gate.includes("Dock lock achieved") || mode.includes("orbital-refuel-lock")) {
    return "lock";
  }
  if (gate.includes("Docking hold-point") || mode.includes("orbital-refuel-final-approach")) {
    return "hold";
  }
  if (gate.includes("Velocity-match gate") || mode.includes("orbital-refuel-velocity-match")) {
    return "velocity";
  }
  if (gate.includes("Transfer gate") || mode.includes("orbital-refuel-transfer-burn")) {
    return "transfer";
  }
  if (gate.includes("Phasing gate") || mode.includes("orbital-refuel-phasing")) {
    return "phasing";
  }
  return "stabilize";
}

function stageProfile(stage, nowSec) {
  const orbitPhase = 0.22 + (nowSec * 0.0018);
  if (stage === "phasing") {
    return {
      orbit: { periapsisKm: 151, apoapsisKm: 156, trueAnomalyRad: orbitPhase },
      posKm: { x: 0.35, y: 40, z: 0 },
      velKmS: { x: 0.0007, y: -0.003, z: 0 },
    };
  }
  if (stage === "transfer") {
    return {
      orbit: { periapsisKm: 151, apoapsisKm: 155, trueAnomalyRad: orbitPhase },
      posKm: { x: 0.35, y: 14.5, z: 0 },
      velKmS: { x: 0.0007, y: -0.0018, z: 0 },
    };
  }
  if (stage === "velocity") {
    return {
      orbit: { periapsisKm: 151, apoapsisKm: 154, trueAnomalyRad: orbitPhase },
      posKm: { x: 0.12, y: 0.18, z: 0 },
      velKmS: { x: 0.00018, y: -0.00028, z: 0 },
    };
  }
  if (stage === "hold") {
    return {
      orbit: { periapsisKm: 151, apoapsisKm: 154, trueAnomalyRad: orbitPhase },
      posKm: { x: 0.03, y: 0.10, z: 0 },
      velKmS: { x: 0.00005, y: -0.00005, z: 0 },
    };
  }
  if (stage === "lock" || stage === "transferring") {
    return {
      orbit: { periapsisKm: 151, apoapsisKm: 154, trueAnomalyRad: orbitPhase },
      posKm: { x: 0, y: 0.012, z: 0 },
      velKmS: { x: 0, y: 0, z: 0 },
    };
  }
  if (stage === "undocking") {
    return {
      orbit: { periapsisKm: 151, apoapsisKm: 154, trueAnomalyRad: orbitPhase },
      posKm: { x: 0, y: 0.03, z: 0 },
      velKmS: { x: 0, y: 0.00002, z: 0 },
    };
  }
  return {
    orbit: { periapsisKm: 151, apoapsisKm: 154, trueAnomalyRad: orbitPhase },
    posKm: { x: 0.35, y: 120, z: 0 },
    velKmS: { x: 0.0007, y: -0.004, z: 0 },
  };
}

function placeBodies({
  shipBody,
  tankerBody,
  profile,
}) {
  const orbitState = makeEllipticOrbitState(profile.orbit);
  const up = normalize(orbitState.position, { x: 1, y: 0, z: 0 });
  const prograde = normalize(orbitState.velocity, { x: 0, y: 1, z: 0 });
  const normal = normalize(cross(up, prograde), { x: 0, y: 0, z: 1 });
  shipBody.position = orbitState.position;
  shipBody.velocity = orbitState.velocity;
  tankerBody.position = add(
    shipBody.position,
    add(
      add(
        scale(up, Number(profile.posKm?.x) || 0),
        scale(prograde, Number(profile.posKm?.y) || 0),
      ),
      scale(normal, Number(profile.posKm?.z) || 0),
    ),
  );
  tankerBody.velocity = add(
    shipBody.velocity,
    add(
      add(
        scale(up, Number(profile.velKmS?.x) || 0),
        scale(prograde, Number(profile.velKmS?.y) || 0),
      ),
      scale(normal, Number(profile.velKmS?.z) || 0),
    ),
  );
}

function recordProgress(snapshot, visited, tankerIds) {
  const gate = String(snapshot?.missionPhaseGateReason || "");
  if (gate.includes("Orbit stabilization gate")) {
    visited.add("stabilize");
  }
  if (gate.includes("Phasing gate")) {
    visited.add("phasing");
  }
  if (gate.includes("Transfer gate")) {
    visited.add("transfer");
  }
  if (gate.includes("Velocity-match gate")) {
    visited.add("velocity");
  }
  if (gate.includes("Docking hold-point")) {
    visited.add("hold");
  }
  if (gate.includes("Dock lock achieved")) {
    visited.add("lock");
  }
  if (gate.includes("Transfer active")) {
    visited.add("transferring");
  }
  if (gate.includes("Undock sequence active")) {
    visited.add("undocking");
  }
  if (snapshot?.refuelTransferLocked) {
    visited.add("lock");
  }
  if (snapshot?.refuelTransferActive) {
    visited.add("transferring");
  }
  if (snapshot?.refuelUndockActive) {
    visited.add("undocking");
  }
  const tankerId = String(
    snapshot?.refuelTransferTankerId
    || snapshot?.targetBodyId
    || "",
  ).trim();
  if (tankerId) {
    tankerIds.add(tankerId);
  }
}

function testPublicLaunchControllerRefuelSmoke() {
  const state = makeState();
  const controller = createHarness();
  const tankerLaunch = controller.launchRefuelTanker(state, NOW_MS, { mode: "orbit_inject" });
  assert(tankerLaunch?.accepted, `public refuel smoke: tanker launch rejected (${tankerLaunch?.reason || "unknown"})`);
  const tankerId = String(tankerLaunch?.tankerId || "");
  const shipLaunch = controller.launchMissionShip(
    state,
    LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO,
    NOW_MS,
    { mode: "orbit_inject" },
  );
  assert(shipLaunch?.accepted, `public refuel smoke: mission ship launch rejected (${shipLaunch?.reason || "unknown"})`);
  const shipId = String(shipLaunch?.shipId || "");
  const shipBody = state.dynamicBodies.get(shipId);
  const tankerBody = state.dynamicBodies.get(tankerId);
  assert(shipBody && tankerBody, "public refuel smoke: missing launched bodies");

  let snapshot = controller.statusSnapshotForBody(state, shipId, NOW_MS);
  const initialShipPropellantKg = Number(snapshot?.stagePropellantKg) || 0;
  const visited = new Set();
  const tankerIds = new Set();
  let maxTransferProgress = 0;
  let maxTransferRateKgS = 0;
  let peakShipPropellantKg = initialShipPropellantKg;

  for (let i = 1; i <= 1400; i += 1) {
    const stage = inferStage(snapshot);
    const profile = stageProfile(stage, i);
    placeBodies({ shipBody, tankerBody, profile });
    const nowMs = NOW_MS + (i * 1000);
    controller.prepareStep(state, 1, nowMs);
    controller.finalizeStep(state, 1, nowMs);
    snapshot = controller.statusSnapshotForBody(state, shipId, nowMs);
    recordProgress(snapshot, visited, tankerIds);
    maxTransferProgress = Math.max(maxTransferProgress, Number(snapshot?.refuelTransferProgress) || 0);
    maxTransferRateKgS = Math.max(maxTransferRateKgS, Number(snapshot?.refuelTransferRateKgS) || 0);
    peakShipPropellantKg = Math.max(peakShipPropellantKg, Number(snapshot?.stagePropellantKg) || 0);
    if (visited.has("undocking") && maxTransferProgress >= 0.999) {
      break;
    }
  }

  assert(visited.has("stabilize"), "public refuel smoke: missing orbit stabilization");
  assert(
    visited.has("transfer") || visited.has("velocity"),
    "public refuel smoke: missing transfer or velocity-match progression",
  );
  assert(visited.has("hold") || visited.has("lock"), "public refuel smoke: missing docking hold/lock progression");
  assert(visited.has("transferring"), "public refuel smoke: missing transfer-active progression");
  assert(visited.has("undocking"), "public refuel smoke: missing undocking progression");
  assert(
    tankerIds.has(tankerId),
    `public refuel smoke: expected public snapshot to track ${tankerId}, saw ${[...tankerIds].join(", ") || "none"}`,
  );
  assert(
    maxTransferProgress >= 0.999,
    `public refuel smoke: expected near-complete transfer progress, got ${maxTransferProgress}`,
  );
  assert(
    maxTransferRateKgS > 0,
    `public refuel smoke: expected positive transfer rate, got ${maxTransferRateKgS}`,
  );
  assert(
    peakShipPropellantKg > initialShipPropellantKg + 50_000,
    `public refuel smoke: expected ship propellant gain, initial ${initialShipPropellantKg}, peak ${peakShipPropellantKg}`,
  );
}

function testPublicLaunchControllerAllowsMultipleTankers() {
  const state = makeState();
  const controller = createHarness();

  const firstPadLaunch = controller.launchRefuelTanker(state, NOW_MS, { mode: "pad_launch" });
  assert(firstPadLaunch?.accepted, `public multi-tanker: first pad launch rejected (${firstPadLaunch?.reason || "unknown"})`);
  assert(firstPadLaunch?.pending === true, "public multi-tanker: first pad launch should remain pending");

  const secondLaunch = controller.launchRefuelTanker(state, NOW_MS + 1_000, { mode: "pad_launch" });
  assert(secondLaunch?.accepted, `public multi-tanker: second tanker launch rejected (${secondLaunch?.reason || "unknown"})`);
  assert(secondLaunch?.pending === false, "public multi-tanker: second tanker should route through additive fleet launch");
  assert(
    String(secondLaunch?.tankerId || "") !== String(firstPadLaunch?.tankerId || ""),
    "public multi-tanker: second tanker reused the first tanker identity",
  );

  const thirdLaunch = controller.launchRefuelTanker(state, NOW_MS + 2_000, { mode: "orbit_inject" });
  assert(thirdLaunch?.accepted, `public multi-tanker: third orbit-inject tanker rejected (${thirdLaunch?.reason || "unknown"})`);
  assert(
    String(thirdLaunch?.tankerId || "") !== String(firstPadLaunch?.tankerId || "")
    && String(thirdLaunch?.tankerId || "") !== String(secondLaunch?.tankerId || ""),
    "public multi-tanker: third tanker identity should be unique",
  );

  const launchedTankers = [
    String(firstPadLaunch?.tankerId || "").trim(),
    String(secondLaunch?.tankerId || "").trim(),
    String(thirdLaunch?.tankerId || "").trim(),
  ].filter(Boolean);
  const dynamicTankers = [...state.dynamicBodies.keys()].filter((id) => String(id || "").startsWith("earth_refuel_tanker_"));
  assert(
    dynamicTankers.length >= 2,
    `public multi-tanker: expected multiple tanker bodies in dynamics, got ${dynamicTankers.length}`,
  );
  assert(
    new Set(launchedTankers).size === launchedTankers.length,
    `public multi-tanker: tanker ids were not unique (${launchedTankers.join(", ")})`,
  );
}

function main() {
  testPublicLaunchControllerRefuelSmoke();
  testPublicLaunchControllerAllowsMultipleTankers();
  console.log("PASS refuel-launch-controller-smoke");
}

main();
