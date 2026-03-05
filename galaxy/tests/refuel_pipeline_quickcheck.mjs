import { updateFleetTransferGuidance } from "../app/static/js/physics/launch/refuel/fleetTransferPipeline.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function deepMerge(base, patch = {}) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && base[key]
      && typeof base[key] === "object"
      && !Array.isArray(base[key])
    ) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function makeFixture() {
  const vehicle = {
    id: "test_ship_1",
    missionId: "orbital_refuel_demo",
    stageIndex: 0,
    stageProfiles: [{ propellantMassKg: 1_450_000 }],
    stageActuator: { directionActual: { x: 0, y: 1, z: 0 } },
    stagePropellantKg: 420_000,
    propellantKg: 420_000,
  };
  const fixture = {
    vehicle,
    target: {
      tankerId: "earth_refuel_tanker_test_1",
      distanceKm: 100,
      relativeSpeedKmS: 0.03,
      closingSpeedKmS: 0.006,
      altitudeErrorKm: 0.4,
      radialSpeedErrorKmS: 0.0008,
      relativePositionKm: { x: 0, y: 100, z: 0 },
      relativeVelocityKmS: { x: 0, y: -0.006, z: 0 },
    },
    shipState: {
      position: { x: 6_521, y: 0, z: 0 },
      velocity: { x: 0, y: 7.82, z: 0 },
      massKg: 220_000,
    },
    tankerState: {
      position: { x: 6_521, y: 60, z: 0 },
      velocity: { x: 0, y: 7.81, z: 0 },
      massKg: 220_000,
    },
    earthState: {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    },
    orbitalState: {
      periapsisKm: 151,
      apoapsisKm: 154,
      radialSpeedKmS: 0.0004,
      timeToApoapsisSec: 120,
      timeToPeriapsisSec: 1320,
      orbitalPeriodSec: 5400,
    },
    prograde: { x: 0, y: 1, z: 0 },
    requestedThrottle: 0,
    desiredDirection: { x: 0, y: 1, z: 0 },
    guidanceMode: "navsys:orbital-refuel-await-target",
    safeDtSeconds: 1,
    nowSec: 0,
    targetFillFraction: 0.88,
    stagePropellantKg: vehicle.stagePropellantKg,
    stageCapacityKg: vehicle.stageProfiles[0].propellantMassKg,
    emitLaunchEvent: null,
  };
  return fixture;
}

function step(fixture, nowSec, patch = {}) {
  const input = deepMerge(fixture, patch);
  input.nowSec = nowSec;
  input.safeDtSeconds = Number(patch.safeDtSeconds ?? fixture.safeDtSeconds ?? 1);
  return updateFleetTransferGuidance(input);
}

function testSequentialProgression() {
  const fixture = makeFixture();
  let now = 0;
  let result = null;

  for (let i = 0; i < 35; i += 1) {
    now += 1;
    result = step(fixture, now);
  }
  assert(result?.state?.phase === "phasing", `Expected phase=phasing, got ${result?.state?.phase}`);

  for (let i = 0; i < 24; i += 1) {
    now += 1;
    result = step(fixture, now, {
      target: {
        distanceKm: 42,
        relativeSpeedKmS: 0.06,
        closingSpeedKmS: 0.003,
        relativePositionKm: { x: 0, y: 42, z: 0 },
        relativeVelocityKmS: { x: 0, y: -0.003, z: 0 },
      },
    });
  }
  assert(result?.state?.phase === "transfer", `Expected phase=transfer, got ${result?.state?.phase}`);

  for (let i = 0; i < 20; i += 1) {
    now += 1;
    result = step(fixture, now, {
      target: {
        distanceKm: 14,
        relativeSpeedKmS: 0.02,
        closingSpeedKmS: 0.0018,
        relativePositionKm: { x: 0, y: 14, z: 0 },
        relativeVelocityKmS: { x: 0, y: -0.0018, z: 0 },
      },
    });
  }
  assert(result?.state?.phase === "velocity_match", `Expected phase=velocity_match, got ${result?.state?.phase}`);

  for (let i = 0; i < 15; i += 1) {
    now += 1;
    result = step(fixture, now, {
      target: {
        distanceKm: 0.1,
        relativeSpeedKmS: 0.00008,
        closingSpeedKmS: 0.00005,
        relativePositionKm: { x: 0, y: 0.1, z: 0 },
        relativeVelocityKmS: { x: 0, y: -0.00005, z: 0 },
      },
    });
  }
  assert(
    result?.state?.phase === "hold_point" || result?.state?.phase === "final_approach",
    `Expected hold_point/final_approach, got ${result?.state?.phase}`,
  );

  for (let i = 0; i < 14; i += 1) {
    now += 1;
    result = step(fixture, now, {
      target: {
        distanceKm: 0.012,
        relativeSpeedKmS: 0.00003,
        closingSpeedKmS: 0.00002,
        relativePositionKm: { x: 0, y: 0.012, z: 0 },
        relativeVelocityKmS: { x: 0, y: -0.00002, z: 0 },
      },
    });
  }
  const phase = result?.state?.phase;
  assert(
    phase === "docked_lock" || phase === "transferring" || phase === "undocking" || phase === "complete",
    `Expected docking/transfer phase, got ${phase}`,
  );
}

function testNoPhasingToVelocitySkip() {
  const fixture = makeFixture();
  const transfer = fixture.vehicle.refuelTransferState || {};
  transfer.phase = "phasing";
  transfer.phaseEnterSec = 1;
  fixture.vehicle.refuelTransferState = transfer;

  const result = step(fixture, 40, {
    target: {
      distanceKm: 10,
      relativeSpeedKmS: 0.006,
      closingSpeedKmS: 0.002,
      relativePositionKm: { x: 0, y: 10, z: 0 },
      relativeVelocityKmS: { x: 0, y: -0.002, z: 0 },
    },
  });
  assert(result?.state?.phase === "transfer", `Expected phasing->transfer, got ${result?.state?.phase}`);
}

function testRadialDampHysteresis() {
  const fixture = makeFixture();
  fixture.target.distanceKm = 26;
  fixture.target.relativeSpeedKmS = 0.018;
  fixture.target.closingSpeedKmS = 0.004;
  fixture.target.relativePositionKm = { x: 0, y: 26, z: 0 };
  fixture.target.relativeVelocityKmS = { x: 0, y: -0.004, z: 0 };

  const transfer = fixture.vehicle.refuelTransferState || {};
  transfer.phase = "stabilize_orbit";
  transfer.phaseEnterSec = 1;
  fixture.vehicle.refuelTransferState = transfer;

  const radialSeries = [0.0070, 0.0055, 0.0048, 0.0045, 0.0043, 0.0041, 0.0040, 0.0039];
  const modes = [];
  for (let i = 0; i < radialSeries.length; i += 1) {
    const now = i + 1;
    const result = step(fixture, now, {
      orbitalState: {
        radialSpeedKmS: radialSeries[i],
      },
    });
    modes.push(String(result?.guidanceMode || ""));
  }

  const firstFive = modes.slice(0, 5).every((mode) => mode.includes("radial-rate-damp"));
  assert(firstFive, `Expected damp held for first 5s, modes=${modes.join(" | ")}`);
  const eventuallyCoast = modes.slice(6).some((mode) => mode.includes(":coast"));
  assert(eventuallyCoast, `Expected coast after hysteresis hold, modes=${modes.join(" | ")}`);
}

function main() {
  const checks = [
    ["sequential-progression", testSequentialProgression],
    ["no-phasing-skip", testNoPhasingToVelocitySkip],
    ["radial-hysteresis", testRadialDampHysteresis],
  ];
  for (const [name, fn] of checks) {
    fn();
    console.log(`PASS ${name}`);
  }
  console.log("PASS refuel_pipeline_quickcheck");
}

main();
