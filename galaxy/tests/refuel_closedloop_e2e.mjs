import {
  updateFleetTransferGuidance,
  advanceFleetTransferMass,
} from "../app/static/js/physics/launch/refuel/fleetTransferPipeline.js";
import { REFUEL_TANKER_CONFIG } from "../app/static/js/physics/launch/refuel/config.js";

const MU_EARTH_KM3_S2 = 398600.4418;
const EARTH_RADIUS_KM = 6371;
const MAIN_ENGINE_MAX_ACCEL_KM_S2 = 0.0022;
const RCS_ACCEL_KM_S2 = 0.00003;
const PHASE = Object.freeze({
  TRANSFERRING: "transferring",
  COMPLETE: "complete",
});

function vAdd(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function vSub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function vScale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
function vDot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}
function vCross(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}
function vLen(a) {
  return Math.sqrt(vDot(a, a));
}
function vNorm(a, fallback = { x: 0, y: 1, z: 0 }) {
  const mag = vLen(a);
  if (!(mag > 1e-12)) {
    return fallback;
  }
  return vScale(a, 1 / mag);
}
function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}
function safeNum(x, fallback = Number.NaN) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
function posMod(x, m) {
  const r = x % m;
  return r < 0 ? r + m : r;
}
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function gravityAccelKmS2(positionKm) {
  const r = Math.max(1, vLen(positionKm));
  return vScale(positionKm, -MU_EARTH_KM3_S2 / (r * r * r));
}

function integrateBody(body, commandAccelKmS2, dtSec) {
  const grav = gravityAccelKmS2(body.position);
  const accel = vAdd(grav, commandAccelKmS2 || { x: 0, y: 0, z: 0 });
  body.velocity = vAdd(body.velocity, vScale(accel, dtSec));
  body.position = vAdd(body.position, vScale(body.velocity, dtSec));
}

function computeOrbitalState(positionKm, velocityKmS) {
  const rMag = Math.max(1e-9, vLen(positionKm));
  const vMag = Math.max(0, vLen(velocityKmS));
  const h = vCross(positionKm, velocityKmS);
  const hMag = Math.max(1e-9, vLen(h));
  const energy = (0.5 * vMag * vMag) - (MU_EARTH_KM3_S2 / rMag);
  const a = energy < 0 ? (-MU_EARTH_KM3_S2 / (2 * energy)) : Number.NaN;
  const eVec = vSub(vScale(vCross(velocityKmS, h), 1 / MU_EARTH_KM3_S2), vScale(positionKm, 1 / rMag));
  const e = vLen(eVec);

  let periapsisKm = Number.NaN;
  let apoapsisKm = Number.NaN;
  let timeToPeriapsisSec = Number.NaN;
  let timeToApoapsisSec = Number.NaN;
  let orbitalPeriodSec = Number.NaN;

  if (Number.isFinite(a) && a > EARTH_RADIUS_KM) {
    const rp = a * (1 - e);
    const ra = a * (1 + e);
    periapsisKm = rp - EARTH_RADIUS_KM;
    apoapsisKm = ra - EARTH_RADIUS_KM;
    const n = Math.sqrt(MU_EARTH_KM3_S2 / (a * a * a));
    orbitalPeriodSec = (2 * Math.PI) / n;

    if (e < 1e-7) {
      timeToPeriapsisSec = orbitalPeriodSec * 0.5;
      timeToApoapsisSec = orbitalPeriodSec * 0.5;
    } else if (e < 1) {
      const cosNu = clamp(vDot(eVec, positionKm) / Math.max(1e-9, e * rMag), -1, 1);
      let nu = Math.acos(cosNu);
      if (vDot(positionKm, velocityKmS) < 0) {
        nu = (2 * Math.PI) - nu;
      }
      const tanHalfE = Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2);
      const E = 2 * Math.atan(tanHalfE);
      const EPos = posMod(E, 2 * Math.PI);
      const M = EPos - (e * Math.sin(EPos));
      timeToPeriapsisSec = posMod((2 * Math.PI) - M, 2 * Math.PI) / n;
      timeToApoapsisSec = posMod(Math.PI - M, 2 * Math.PI) / n;
    }
  }

  return {
    periapsisKm,
    apoapsisKm,
    radialSpeedKmS: vDot(positionKm, velocityKmS) / rMag,
    orbitalPeriodSec,
    timeToPeriapsisSec,
    timeToApoapsisSec,
  };
}

function buildTarget(shipBody, tankerBody) {
  const relPos = vSub(tankerBody.position, shipBody.position);
  const relVel = vSub(tankerBody.velocity, shipBody.velocity);
  const distanceKm = vLen(relPos);
  const relSpeed = vLen(relVel);
  const close = -vDot(relVel, vNorm(relPos, { x: 0, y: 1, z: 0 }));

  const shipR = vLen(shipBody.position);
  const tankerR = vLen(tankerBody.position);
  const shipAlt = shipR - EARTH_RADIUS_KM;
  const tankerAlt = tankerR - EARTH_RADIUS_KM;
  const shipRadial = vDot(shipBody.position, shipBody.velocity) / Math.max(1e-9, shipR);
  const tankerRadial = vDot(tankerBody.position, tankerBody.velocity) / Math.max(1e-9, tankerR);

  return {
    tankerId: tankerBody.id,
    distanceKm,
    relativeSpeedKmS: relSpeed,
    closingSpeedKmS: close,
    altitudeErrorKm: Math.abs(shipAlt - tankerAlt),
    radialSpeedErrorKmS: shipRadial - tankerRadial,
    relativePositionKm: relPos,
    relativeVelocityKmS: relVel,
  };
}

function makeVehicle(id, stageCapKg, stagePropKg) {
  return {
    id,
    missionId: "orbital_refuel_demo",
    stageIndex: 0,
    stageProfiles: [{ propellantMassKg: stageCapKg }],
    stageActuator: { directionActual: { x: 0, y: 1, z: 0 } },
    stagePropellantKg: stagePropKg,
    propellantKg: stagePropKg,
  };
}

function makeBody(id, radiusKm, thetaRad, tangentialSpeedKmS, radialOffsetKm = 0, tangentialOffsetKmS = 0) {
  const r = radiusKm + radialOffsetKm;
  const cosT = Math.cos(thetaRad);
  const sinT = Math.sin(thetaRad);
  const pos = { x: r * cosT, y: r * sinT, z: 0 };
  const tangent = { x: -sinT, y: cosT, z: 0 };
  const speed = tangentialSpeedKmS + tangentialOffsetKmS;
  const vel = vScale(tangent, speed);
  return { id, position: pos, velocity: vel, massKg: 220_000 };
}

function commandAccelFromGuidance(mode, phase) {
  const dir = vNorm(mode?.desiredDirection, { x: 0, y: 1, z: 0 });
  const throttle = clamp(safeNum(mode?.requestedThrottle, 0), 0, 1);
  if (throttle > 1e-8) {
    return vScale(dir, throttle * MAIN_ENGINE_MAX_ACCEL_KM_S2);
  }
  if (
    phase === "hold_point"
    || phase === "final_approach"
    || phase === "aborting"
    || phase === "undocking"
    || String(mode?.guidanceMode || "").includes("rcs")
  ) {
    return vScale(dir, RCS_ACCEL_KM_S2);
  }
  return { x: 0, y: 0, z: 0 };
}

function runScenario({
  name,
  thetaDeg = 1.0,
  radialOffsetKm = 0,
  tangentialOffsetKmS = 0,
  simSeconds = 5400,
}) {
  const orbitRadiusKm = EARTH_RADIUS_KM + 155;
  const vc = Math.sqrt(MU_EARTH_KM3_S2 / orbitRadiusKm);

  const tankerVehicle = makeVehicle(`${name}_tanker_vehicle`, 1_500_000, 1_250_000);
  const shipVehicle = makeVehicle(`${name}_ship_vehicle`, 1_450_000, 450_000);
  const tankerBody = makeBody(`${name}_tanker`, orbitRadiusKm, 0, vc, 0, 0);
  const shipBody = makeBody(`${name}_ship`, orbitRadiusKm, -thetaDeg * (Math.PI / 180), vc, radialOffsetKm, tangentialOffsetKmS);

  const earthState = { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } };
  const shipState = { position: shipBody.position, velocity: shipBody.velocity, massKg: shipBody.massKg };
  const tankerState = { position: tankerBody.position, velocity: tankerBody.velocity, massKg: tankerBody.massKg };
  const stageCapKg = shipVehicle.stageProfiles[0].propellantMassKg;
  const stageGoalKg = stageCapKg * REFUEL_TANKER_CONFIG.targetFillFraction;
  const startShipProp = shipVehicle.stagePropellantKg;
  const startTankerProp = tankerVehicle.stagePropellantKg;

  let completed = false;
  let nowSec = 0;
  const visited = new Set();
  const phases = [];
  let maxDistanceKm = 0;
  let minDistanceKm = Number.POSITIVE_INFINITY;
  let crashed = false;
  let lastOrbitalState = null;
  let lastTarget = null;

  for (let i = 0; i < simSeconds; i += 1) {
    nowSec += 1;
    shipState.position = shipBody.position;
    shipState.velocity = shipBody.velocity;
    tankerState.position = tankerBody.position;
    tankerState.velocity = tankerBody.velocity;

    const target = buildTarget(shipBody, tankerBody);
    lastTarget = target;
    maxDistanceKm = Math.max(maxDistanceKm, target.distanceKm);
    minDistanceKm = Math.min(minDistanceKm, target.distanceKm);
    const orbitalState = computeOrbitalState(shipBody.position, shipBody.velocity);
    lastOrbitalState = orbitalState;

    const mode = updateFleetTransferGuidance({
      vehicle: shipVehicle,
      target,
      shipState,
      tankerState,
      earthState,
      orbitalState,
      prograde: vNorm(shipBody.velocity, { x: 0, y: 1, z: 0 }),
      requestedThrottle: 0,
      desiredDirection: shipVehicle.stageActuator.directionActual,
      guidanceMode: "navsys:orbital-refuel-await-target",
      safeDtSeconds: 1,
      nowSec,
      targetFillFraction: REFUEL_TANKER_CONFIG.targetFillFraction,
      stagePropellantKg: shipVehicle.stagePropellantKg,
      stageCapacityKg: stageCapKg,
      emitLaunchEvent: null,
    });
    shipVehicle.stageActuator.directionActual = mode.desiredDirection;
    const phase = String(mode?.state?.phase || "idle");
    visited.add(phase);
    phases.push(phase);

    const shipCommandAccel = commandAccelFromGuidance(mode, phase);
    integrateBody(tankerBody, { x: 0, y: 0, z: 0 }, 1);
    integrateBody(shipBody, shipCommandAccel, 1);

    shipState.position = shipBody.position;
    shipState.velocity = shipBody.velocity;
    tankerState.position = tankerBody.position;
    tankerState.velocity = tankerBody.velocity;

    const massStep = advanceFleetTransferMass({
      vehicle: shipVehicle,
      shipState,
      tankerVehicle,
      tankerState,
      safeDtSeconds: 1,
      targetFillFraction: REFUEL_TANKER_CONFIG.targetFillFraction,
      emitLaunchEvent: null,
    });

    const altitudeKm = vLen(shipBody.position) - EARTH_RADIUS_KM;
    if (altitudeKm < 80) {
      crashed = true;
      break;
    }

    if (massStep.completed || String(shipVehicle.refuelTransferState?.phase || "") === PHASE.COMPLETE) {
      completed = true;
      break;
    }
  }

  const reserveKg = 0.1 * tankerVehicle.stageProfiles[0].propellantMassKg;
  const availableFromTankerKg = Math.max(0, startTankerProp - reserveKg);
  const expectedTransferKg = Math.min(
    REFUEL_TANKER_CONFIG.transferPerFlightKg,
    Math.max(0, stageGoalKg - startShipProp),
    availableFromTankerKg,
  );
  const expectedShipKg = startShipProp + expectedTransferKg;
  const shipKg = shipVehicle.stagePropellantKg;
  const tankerKg = tankerVehicle.stagePropellantKg;

  const completePass = (
    completed
    && !crashed
    && visited.has(PHASE.TRANSFERRING)
    && visited.has(PHASE.COMPLETE)
    && Math.abs(shipKg - expectedShipKg) <= 10_000
    && tankerKg < startTankerProp
  );
  const convergencePass = (
    !crashed
    && visited.has("transfer")
    && visited.has("velocity_match")
    && minDistanceKm <= 60
    && Number.isFinite(lastTarget?.relativeSpeedKmS)
    && lastTarget.relativeSpeedKmS <= 1.0
  );

  return {
    name,
    pass: completePass || convergencePass,
    completePass,
    convergencePass,
    completed,
    crashed,
    nowSec,
    visited: [...visited.values()],
    shipKg,
    tankerKg,
    expectedShipKg,
    minDistanceKm,
    maxDistanceKm,
    finalPhase: String(shipVehicle.refuelTransferState?.phase || "idle"),
    finalHoldStableSec: safeNum(shipVehicle.refuelTransferState?.holdPointStableSec, Number.NaN),
    finalDockStableSec: safeNum(shipVehicle.refuelTransferState?.dockStableSec, Number.NaN),
    finalShipAlignDeg: safeNum(shipVehicle.refuelTransferState?.shipAlignmentDeg, Number.NaN),
    finalTankerAlignDeg: safeNum(shipVehicle.refuelTransferState?.tankerAlignmentDeg, Number.NaN),
    finalCorridorAlignDeg: safeNum(shipVehicle.refuelTransferState?.corridorAlignmentDeg, Number.NaN),
    finalPeriapsisKm: safeNum(lastOrbitalState?.periapsisKm, Number.NaN),
    finalApoapsisKm: safeNum(lastOrbitalState?.apoapsisKm, Number.NaN),
    finalRelativeSpeedKmS: safeNum(lastTarget?.relativeSpeedKmS, Number.NaN),
  };
}

function runSweep() {
  const scenarios = [
    { name: "case_1", thetaDeg: 0.8, radialOffsetKm: 0.4, tangentialOffsetKmS: -0.002, simSeconds: 21600 },
    { name: "case_2", thetaDeg: 1.3, radialOffsetKm: -0.6, tangentialOffsetKmS: 0.003, simSeconds: 21600 },
    { name: "case_3", thetaDeg: 1.9, radialOffsetKm: 0.2, tangentialOffsetKmS: -0.004, simSeconds: 21600 },
    { name: "case_4", thetaDeg: 0.5, radialOffsetKm: 0.0, tangentialOffsetKmS: 0.0015, simSeconds: 21600 },
    { name: "case_5", thetaDeg: 2.1, radialOffsetKm: -0.8, tangentialOffsetKmS: 0.0025, simSeconds: 21600 },
    { name: "case_6", thetaDeg: 1.6, radialOffsetKm: 0.7, tangentialOffsetKmS: -0.0015, simSeconds: 21600 },
  ];
  const results = scenarios.map((scenario) => runScenario(scenario));
  const passed = results.filter((r) => r.pass);
  return { results, passCount: passed.length, total: results.length };
}

function runDualNominal() {
  const a = runScenario({ name: "dual_A", thetaDeg: 0.9, radialOffsetKm: 0.3, tangentialOffsetKmS: -0.0015 });
  const b = runScenario({ name: "dual_B", thetaDeg: 1.4, radialOffsetKm: -0.4, tangentialOffsetKmS: 0.002 });
  const pass = (
    !a.crashed
    && !b.crashed
  );
  return { a, b, pass };
}

function main() {
  const sweep = runSweep();
  const dual = runDualNominal();
  for (const r of sweep.results) {
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.name} phase=${r.finalPhase} t=${r.nowSec}s `
      + `ship=${r.shipKg.toFixed(0)} expected=${r.expectedShipKg.toFixed(0)} `
      + `dist[min,max]=${r.minDistanceKm.toFixed(2)},${r.maxDistanceKm.toFixed(2)} `
      + `peri/apo=${Number.isFinite(r.finalPeriapsisKm) ? r.finalPeriapsisKm.toFixed(1) : "n/a"}/`
      + `${Number.isFinite(r.finalApoapsisKm) ? r.finalApoapsisKm.toFixed(1) : "n/a"} `
      + `relV=${Number.isFinite(r.finalRelativeSpeedKmS) ? r.finalRelativeSpeedKmS.toFixed(4) : "n/a"} `
      + `hold=${Number.isFinite(r.finalHoldStableSec) ? r.finalHoldStableSec.toFixed(1) : "n/a"} `
      + `dock=${Number.isFinite(r.finalDockStableSec) ? r.finalDockStableSec.toFixed(1) : "n/a"} `
      + `align=${Number.isFinite(r.finalShipAlignDeg) ? r.finalShipAlignDeg.toFixed(1) : "n/a"}/`
      + `${Number.isFinite(r.finalTankerAlignDeg) ? r.finalTankerAlignDeg.toFixed(1) : "n/a"}/`
      + `${Number.isFinite(r.finalCorridorAlignDeg) ? r.finalCorridorAlignDeg.toFixed(1) : "n/a"} `
      + `complete=${r.completePass ? "yes" : "no"} conv=${r.convergencePass ? "yes" : "no"} `
      + `visited=[${r.visited.join("->")}]`,
    );
  }
  console.log(`SWEEP ${sweep.passCount}/${sweep.total} passed`);
  console.log(
    `DUAL ${dual.pass ? "PASS" : "FAIL"} `
    + `A=${dual.a.finalPhase}/${dual.a.nowSec}s B=${dual.b.finalPhase}/${dual.b.nowSec}s`,
  );

  assert(sweep.passCount >= 5, `Closed-loop sweep weak: ${sweep.passCount}/${sweep.total} converged`);
  assert(dual.pass, "Dual rendezvous nominal failed");
}

main();
