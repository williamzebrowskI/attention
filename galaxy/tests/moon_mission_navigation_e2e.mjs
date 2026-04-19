import {
  createNavigationSystem,
  NAVIGATION_MISSION_IDS,
  NAVIGATION_MISSION_PHASES,
} from "../app/static/js/physics/navigation_system/index.js";
import {
  MOON_PARKING_ORBIT_APOAPSIS_KM,
  MOON_PARKING_ORBIT_PERIAPSIS_KM,
} from "../app/static/js/physics/launch/lunar/constants.js";

const MOON_READY_APOAPSIS_KM = MOON_PARKING_ORBIT_APOAPSIS_KM + 20;
const MOON_READY_PERIAPSIS_KM = MOON_PARKING_ORBIT_PERIAPSIS_KM;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeOrbital({
  periapsisKm = 150,
  apoapsisKm = 180,
  specificEnergy = -1,
  altitudeKm = 160,
  radialSpeedKmS = 0,
  tangentialSpeedKmS = 7.82,
  circularSpeedKmS = 7.82,
  timeToPeriapsisSec = 1200,
  timeToApoapsisSec = 1200,
} = {}) {
  return {
    periapsisKm,
    apoapsisKm,
    specificEnergy,
    altitudeKm,
    radialSpeedKmS,
    tangentialSpeedKmS,
    circularSpeedKmS,
    timeToPeriapsisSec,
    timeToApoapsisSec,
  };
}

function makeMoonOrbit({
  specificEnergy = -0.2,
  apoapsisKm = 8000,
  periapsisKm = 120,
  speedKmS = 1.2,
} = {}) {
  return {
    specificEnergy,
    apoapsisKm,
    periapsisKm,
    speedKmS,
  };
}

function baseVectors() {
  const shipEarthPositionKm = { x: 6521, y: 0, z: 0 };
  const shipEarthVelocityKmS = { x: 0, y: 7.82, z: 0 };
  const moonEarthPositionKm = { x: 384400, y: 0, z: 0 };
  const moonEarthVelocityKmS = { x: 0, y: 1.022, z: 0 };
  return {
    tangent: { x: 0, y: 1, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    toMoon: { x: 1, y: 0, z: 0 },
    toEarth: { x: -1, y: 0, z: 0 },
    shipEarthPositionKm,
    shipEarthVelocityKmS,
    moonEarthPositionKm,
    moonEarthVelocityKmS,
    shipMinusMoonRelativeVelocityKmS: {
      x: shipEarthVelocityKmS.x - moonEarthVelocityKmS.x,
      y: shipEarthVelocityKmS.y - moonEarthVelocityKmS.y,
      z: shipEarthVelocityKmS.z - moonEarthVelocityKmS.z,
    },
    moonMinusShipRelativeVelocityKmS: {
      x: moonEarthVelocityKmS.x - shipEarthVelocityKmS.x,
      y: moonEarthVelocityKmS.y - shipEarthVelocityKmS.y,
      z: moonEarthVelocityKmS.z - shipEarthVelocityKmS.z,
    },
    toRefuelTarget: { x: 0, y: 20, z: 0 },
    refuelTargetRelativeVelocityKmS: { x: 0, y: -0.001, z: 0 },
  };
}

function baseMetrics(overrides = {}) {
  return {
    moonDistanceKm: 385000,
    moonAltitudeKm: 383200,
    moonClosingSpeedKmS: 0.01,
    moonRelativeSpeedKmS: 7.6,
    moonProjectedMissDistanceKm: 200000,
    moonProjectedPeriluneAltitudeKm: 120000,
    moonBPlaneErrorKm: 200000,
    earthDistanceKm: 7000,
    earthRadialSpeedKmS: 0.001,
    refuelFillFraction: 0.2,
    propellantKg: 900000,
    fuelBudget: {
      feasible: true,
    },
    ...overrides,
  };
}

function runNominalMoonMissionE2E() {
  const nav = createNavigationSystem({
    missionId: NAVIGATION_MISSION_IDS.MOON_ORBIT_RETURN,
  });
  const vectors = baseVectors();
  let timestampSec = 0;

  function step({
    label,
    expectedPhase,
    orbital,
    moonOrbit = null,
    metrics,
    dtSec = 60,
  }) {
    timestampSec += dtSec;
    const result = nav.update({
      measurement: {
        position: vectors.shipEarthPositionKm,
        velocity: vectors.shipEarthVelocityKmS,
      },
      orbital,
      moonOrbit,
      metrics,
      targetVectors: vectors,
      timestampSec,
    });
    const phaseNow = String(result?.state?.missionPhase || "");
    assert(
      phaseNow === expectedPhase,
      `${label}: expected phase=${expectedPhase}, got ${phaseNow}. reason=${result?.phaseDecision?.reason || "n/a"}`,
    );
    assert(result?.command && typeof result.command === "object", `${label}: missing command`);
    assert(
      Number.isFinite(Number(result.command.throttle)),
      `${label}: invalid throttle`,
    );
    return result;
  }

  // launch hold
  step({
    label: "pre-parking-hold",
    expectedPhase: NAVIGATION_MISSION_PHASES.LAUNCH,
    orbital: makeOrbital({ periapsisKm: 80, apoapsisKm: 100, specificEnergy: 0.1, altitudeKm: 90 }),
    metrics: baseMetrics({ refuelFillFraction: 0.2 }),
  });

  // launch -> parking_orbit
  step({
    label: "parking-ready-transition",
    expectedPhase: NAVIGATION_MISSION_PHASES.PARKING_ORBIT,
    orbital: makeOrbital({
      periapsisKm: MOON_READY_PERIAPSIS_KM,
      apoapsisKm: MOON_READY_APOAPSIS_KM,
      specificEnergy: -1.2,
      altitudeKm: MOON_PARKING_ORBIT_PERIAPSIS_KM + 10,
    }),
    metrics: baseMetrics({ refuelFillFraction: 0.2 }),
  });

  // parking_orbit -> departure_window_wait
  step({
    label: "departure-window-hold",
    expectedPhase: NAVIGATION_MISSION_PHASES.DEPARTURE_WINDOW_WAIT,
    orbital: makeOrbital({
      periapsisKm: MOON_READY_PERIAPSIS_KM,
      apoapsisKm: MOON_READY_APOAPSIS_KM,
      specificEnergy: -1.1,
      altitudeKm: MOON_PARKING_ORBIT_PERIAPSIS_KM + 15,
    }),
    metrics: baseMetrics({ refuelFillFraction: 0.45 }),
  });

  // departure_window_wait -> tli_burn
  step({
    label: "departure-window-open-transition",
    expectedPhase: NAVIGATION_MISSION_PHASES.TLI_BURN,
    orbital: makeOrbital({
      periapsisKm: MOON_READY_PERIAPSIS_KM,
      apoapsisKm: MOON_READY_APOAPSIS_KM,
      specificEnergy: -1.1,
      altitudeKm: MOON_PARKING_ORBIT_PERIAPSIS_KM + 15,
    }),
    metrics: baseMetrics({ refuelFillFraction: 0.9 }),
    dtSec: 180,
  });

  // tli_burn hold
  step({
    label: "tli-hold",
    expectedPhase: NAVIGATION_MISSION_PHASES.TLI_BURN,
    orbital: makeOrbital({ periapsisKm: 150, apoapsisKm: 20000, specificEnergy: -2.0, altitudeKm: 250 }),
    metrics: baseMetrics({
      refuelFillFraction: 0.9,
      moonClosingSpeedKmS: 0.002,
      moonProjectedMissDistanceKm: 220000,
      moonBPlaneErrorKm: 150000,
      moonProjectedPeriluneAltitudeKm: 120000,
    }),
  });

  // tli_burn -> midcourse
  step({
    label: "tli-ready-transition",
    expectedPhase: NAVIGATION_MISSION_PHASES.MIDCOURSE,
    orbital: makeOrbital({ periapsisKm: 155, apoapsisKm: 381000, specificEnergy: -0.1, altitudeKm: 350 }),
    metrics: baseMetrics({
      refuelFillFraction: 0.9,
      moonClosingSpeedKmS: 0.06,
      moonProjectedMissDistanceKm: 50000,
      moonBPlaneErrorKm: 30000,
      moonProjectedPeriluneAltitudeKm: 120,
      propellantKg: 2_000_000,
    }),
  });

  // midcourse hold
  step({
    label: "coast-hold",
    expectedPhase: NAVIGATION_MISSION_PHASES.MIDCOURSE,
    orbital: makeOrbital({ periapsisKm: 160, apoapsisKm: 390000, specificEnergy: 0.2, altitudeKm: 1000 }),
    metrics: baseMetrics({
      moonDistanceKm: 250000,
      moonClosingSpeedKmS: 0.002,
      moonProjectedMissDistanceKm: 190000,
      moonBPlaneErrorKm: 130000,
      moonProjectedPeriluneAltitudeKm: 80000,
      earthDistanceKm: 50000,
    }),
    dtSec: 180,
  });

  // midcourse -> lunar_orbit_insertion
  step({
    label: "lunar-approach-transition",
    expectedPhase: NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_INSERTION,
    orbital: makeOrbital({ periapsisKm: 170, apoapsisKm: 392000, specificEnergy: 0.35, altitudeKm: 3000 }),
    metrics: baseMetrics({
      moonDistanceKm: 50000,
      moonAltitudeKm: 48200,
      moonClosingSpeedKmS: 0.55,
      moonProjectedMissDistanceKm: 12000,
      moonBPlaneErrorKm: 4500,
      moonProjectedPeriluneAltitudeKm: 150,
      earthDistanceKm: 130000,
    }),
    dtSec: 240,
  });

  // lunar_orbit_insertion hold
  step({
    label: "lunar-insertion-hold",
    expectedPhase: NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_INSERTION,
    orbital: makeOrbital({ periapsisKm: 200, apoapsisKm: 395000, specificEnergy: 0.4, altitudeKm: 3200 }),
    moonOrbit: makeMoonOrbit({ specificEnergy: 0.1, apoapsisKm: 50000, periapsisKm: 20, speedKmS: 2.4 }),
    metrics: baseMetrics({
      moonDistanceKm: 12000,
      moonAltitudeKm: 10200,
      moonClosingSpeedKmS: 0.18,
      moonProjectedMissDistanceKm: 9000,
      moonBPlaneErrorKm: 6000,
      moonProjectedPeriluneAltitudeKm: 1200,
    }),
    dtSec: 240,
  });

  // lunar_orbit_insertion -> lunar_orbit_trim
  step({
    label: "lunar-capture-transition",
    expectedPhase: NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_TRIM,
    orbital: makeOrbital({ periapsisKm: 200, apoapsisKm: 395000, specificEnergy: 0.4, altitudeKm: 3200 }),
    moonOrbit: makeMoonOrbit({ specificEnergy: -0.15, apoapsisKm: 9000, periapsisKm: 120, speedKmS: 1.2 }),
    metrics: baseMetrics({
      moonDistanceKm: 7000,
      moonAltitudeKm: 5260,
      moonClosingSpeedKmS: 0.04,
      moonProjectedMissDistanceKm: 2500,
      moonBPlaneErrorKm: 1200,
      moonProjectedPeriluneAltitudeKm: 140,
    }),
    dtSec: 180,
  });

  // lunar_orbit_trim -> lunar_loiter
  step({
    label: "lunar-trim-complete-transition",
    expectedPhase: NAVIGATION_MISSION_PHASES.LUNAR_LOITER,
    orbital: makeOrbital({ periapsisKm: 205, apoapsisKm: 392000, specificEnergy: 0.35, altitudeKm: 3200 }),
    moonOrbit: makeMoonOrbit({ specificEnergy: -0.11, apoapsisKm: 9500, periapsisKm: 130, speedKmS: 1.16 }),
    metrics: baseMetrics({ moonDistanceKm: 7400, moonAltitudeKm: 5660 }),
    dtSec: 120,
  });

  // lunar_loiter hold
  step({
    label: "lunar-hold",
    expectedPhase: NAVIGATION_MISSION_PHASES.LUNAR_LOITER,
    orbital: makeOrbital({ periapsisKm: 210, apoapsisKm: 390000, specificEnergy: 0.3, altitudeKm: 3200 }),
    moonOrbit: makeMoonOrbit({ specificEnergy: -0.1, apoapsisKm: 9500, periapsisKm: 130, speedKmS: 1.15 }),
    metrics: baseMetrics({ moonDistanceKm: 7500, moonAltitudeKm: 5750 }),
    dtSec: 3600,
  });

  // lunar_loiter -> tei_burn
  step({
    label: "lunar-hold-complete-transition",
    expectedPhase: NAVIGATION_MISSION_PHASES.TEI_BURN,
    orbital: makeOrbital({ periapsisKm: 210, apoapsisKm: 390000, specificEnergy: 0.3, altitudeKm: 3200 }),
    moonOrbit: makeMoonOrbit({ specificEnergy: -0.1, apoapsisKm: 9500, periapsisKm: 130, speedKmS: 1.15 }),
    metrics: baseMetrics({ moonDistanceKm: 7600, moonAltitudeKm: 5860 }),
    dtSec: 3700,
  });

  // tei_burn hold
  step({
    label: "tei-hold",
    expectedPhase: NAVIGATION_MISSION_PHASES.TEI_BURN,
    orbital: makeOrbital({ periapsisKm: 220, apoapsisKm: 380000, specificEnergy: 0.15, altitudeKm: 6000 }),
    moonOrbit: makeMoonOrbit({ specificEnergy: -0.08, apoapsisKm: 10000, periapsisKm: 140, speedKmS: 1.1 }),
    metrics: baseMetrics({
      moonDistanceKm: 90000,
      earthDistanceKm: 260000,
      earthRadialSpeedKmS: 0.12,
    }),
    dtSec: 180,
  });

  // tei_burn -> earth_approach
  step({
    label: "tei-departure-transition",
    expectedPhase: NAVIGATION_MISSION_PHASES.EARTH_APPROACH,
    orbital: makeOrbital({ periapsisKm: 220, apoapsisKm: 380000, specificEnergy: 0.1, altitudeKm: 8000 }),
    moonOrbit: makeMoonOrbit({ specificEnergy: -0.06, apoapsisKm: 12000, periapsisKm: 160, speedKmS: 1.0 }),
    metrics: baseMetrics({
      moonDistanceKm: 170000,
      earthDistanceKm: 300000,
      earthRadialSpeedKmS: -0.08,
    }),
    dtSec: 180,
  });

  // earth_approach hold
  step({
    label: "earth-coast-hold",
    expectedPhase: NAVIGATION_MISSION_PHASES.EARTH_APPROACH,
    orbital: makeOrbital({ periapsisKm: 180, apoapsisKm: 350000, specificEnergy: -0.4, altitudeKm: 40000 }),
    metrics: baseMetrics({
      earthDistanceKm: 260000,
      moonDistanceKm: 250000,
      earthRadialSpeedKmS: -0.12,
    }),
    dtSec: 240,
  });

  // earth_approach -> earth_capture
  step({
    label: "earth-capture-transition",
    expectedPhase: NAVIGATION_MISSION_PHASES.EARTH_CAPTURE,
    orbital: makeOrbital({ periapsisKm: 150, apoapsisKm: 200000, specificEnergy: -0.3, altitudeKm: 15000 }),
    metrics: baseMetrics({
      earthDistanceKm: 170000,
      moonDistanceKm: 310000,
      earthRadialSpeedKmS: -0.2,
    }),
    dtSec: 240,
  });

  // earth_capture hold
  step({
    label: "earth-capture-hold",
    expectedPhase: NAVIGATION_MISSION_PHASES.EARTH_CAPTURE,
    orbital: makeOrbital({ periapsisKm: 90, apoapsisKm: 90000, specificEnergy: 0.05, altitudeKm: 900 }),
    metrics: baseMetrics({
      earthDistanceKm: 65000,
      earthRadialSpeedKmS: -0.18,
    }),
    dtSec: 120,
  });

  // earth_capture -> earth_orbit_hold
  const final = step({
    label: "earth-capture-complete-transition",
    expectedPhase: NAVIGATION_MISSION_PHASES.EARTH_ORBIT_HOLD,
    orbital: makeOrbital({ periapsisKm: 180, apoapsisKm: 50000, specificEnergy: -0.6, altitudeKm: 300 }),
    metrics: baseMetrics({
      earthDistanceKm: 50000,
      earthRadialSpeedKmS: -0.05,
    }),
    dtSec: 180,
  });
  assert(Boolean(final?.state?.missionCompleted), "final: mission should be completed");

  const history = Array.isArray(final?.state?.phaseHistory) ? final.state.phaseHistory : [];
  const visited = history.map((entry) => String(entry?.to || "")).filter(Boolean);
  console.log(`PASS moon-nav-e2e nominal phases: ${visited.join(" -> ")}`);
}

function runGateHoldFailureMatrix() {
  const nav = createNavigationSystem({
    missionId: NAVIGATION_MISSION_IDS.MOON_ORBIT_RETURN,
  });
  const vectors = baseVectors();
  let timestampSec = 0;
  function updateOnce({ orbital, moonOrbit = null, metrics, dtSec = 60 }) {
    timestampSec += dtSec;
    return nav.update({
      measurement: {
        position: vectors.shipEarthPositionKm,
        velocity: vectors.shipEarthVelocityKmS,
      },
      orbital,
      moonOrbit,
      metrics,
      targetVectors: vectors,
      timestampSec,
    });
  }

  // Move into tli_burn quickly.
  updateOnce({
    orbital: makeOrbital({
      periapsisKm: MOON_READY_PERIAPSIS_KM,
      apoapsisKm: MOON_READY_APOAPSIS_KM,
      specificEnergy: -1.1,
    }),
    metrics: baseMetrics({ refuelFillFraction: 0.2 }),
  });
  updateOnce({
    orbital: makeOrbital({
      periapsisKm: MOON_READY_PERIAPSIS_KM,
      apoapsisKm: MOON_READY_APOAPSIS_KM,
      specificEnergy: -1.1,
    }),
    metrics: baseMetrics({ refuelFillFraction: 0.95 }),
  });
  updateOnce({
    orbital: makeOrbital({
      periapsisKm: MOON_READY_PERIAPSIS_KM,
      apoapsisKm: MOON_READY_APOAPSIS_KM,
      specificEnergy: -1.1,
    }),
    metrics: baseMetrics({ refuelFillFraction: 0.95 }),
    dtSec: 180,
  });
  assert(nav.snapshot().missionPhase === NAVIGATION_MISSION_PHASES.TLI_BURN, "matrix setup: expected tli_burn");

  // Failure 1: TLI no-go (low periapsis + poor miss/B-plane).
  const tliBlocked = updateOnce({
    orbital: makeOrbital({ periapsisKm: 90, apoapsisKm: 220000, specificEnergy: -0.9 }),
    metrics: baseMetrics({
      refuelFillFraction: 0.95,
      moonClosingSpeedKmS: -0.02,
      moonProjectedMissDistanceKm: 380000,
      moonBPlaneErrorKm: 320000,
      moonProjectedPeriluneAltitudeKm: 200000,
    }),
  });
  assert(
    tliBlocked.state.missionPhase === NAVIGATION_MISSION_PHASES.TLI_BURN,
    "matrix failure-1: should remain in tli_burn",
  );

  // Recover to midcourse.
  updateOnce({
    orbital: makeOrbital({ periapsisKm: 160, apoapsisKm: 382500, specificEnergy: -0.05 }),
    metrics: baseMetrics({
      refuelFillFraction: 0.95,
      moonClosingSpeedKmS: 0.06,
      moonProjectedMissDistanceKm: 45000,
      moonBPlaneErrorKm: 22000,
      moonProjectedPeriluneAltitudeKm: 130,
    }),
  });
  assert(nav.snapshot().missionPhase === NAVIGATION_MISSION_PHASES.MIDCOURSE, "matrix setup: expected midcourse");

  // Failure 2: Midcourse no capture gate.
  const coastBlocked = updateOnce({
    orbital: makeOrbital({ periapsisKm: 170, apoapsisKm: 390000, specificEnergy: 0.2 }),
    metrics: baseMetrics({
      moonDistanceKm: 260000,
      moonClosingSpeedKmS: -0.01,
      moonProjectedMissDistanceKm: 390000,
      moonBPlaneErrorKm: 330000,
      moonProjectedPeriluneAltitudeKm: 280000,
      earthDistanceKm: 90000,
    }),
    dtSec: 180,
  });
  assert(
    coastBlocked.state.missionPhase === NAVIGATION_MISSION_PHASES.MIDCOURSE,
    "matrix failure-2: should remain in midcourse",
  );

  console.log("PASS moon-nav-e2e gate-hold matrix (expected failures held at gates)");
}

function runRepeatedHoldPersistenceMatrix() {
  function createUpdater() {
    const nav = createNavigationSystem({
      missionId: NAVIGATION_MISSION_IDS.MOON_ORBIT_RETURN,
    });
    const vectors = baseVectors();
    let timestampSec = 0;
    function updateOnce({ orbital, moonOrbit = null, metrics, dtSec = 60 }) {
      timestampSec += dtSec;
      return nav.update({
        measurement: {
          position: vectors.shipEarthPositionKm,
          velocity: vectors.shipEarthVelocityKmS,
        },
        orbital,
        moonOrbit,
        metrics,
        targetVectors: vectors,
        timestampSec,
      });
    }
    return { nav, updateOnce };
  }

  {
    const { nav, updateOnce } = createUpdater();
    updateOnce({
      orbital: makeOrbital({
        periapsisKm: MOON_READY_PERIAPSIS_KM,
        apoapsisKm: MOON_READY_APOAPSIS_KM,
        specificEnergy: -1.1,
      }),
      metrics: baseMetrics({ refuelFillFraction: 0.2 }),
    });
    updateOnce({
      orbital: makeOrbital({
        periapsisKm: MOON_READY_PERIAPSIS_KM,
        apoapsisKm: MOON_READY_APOAPSIS_KM,
        specificEnergy: -1.1,
      }),
      metrics: baseMetrics({ refuelFillFraction: 0.95 }),
    });
    updateOnce({
      orbital: makeOrbital({
        periapsisKm: MOON_READY_PERIAPSIS_KM,
        apoapsisKm: MOON_READY_APOAPSIS_KM,
        specificEnergy: -1.1,
      }),
      metrics: baseMetrics({ refuelFillFraction: 0.95 }),
      dtSec: 180,
    });
    assert(nav.snapshot().missionPhase === NAVIGATION_MISSION_PHASES.TLI_BURN, "repeat-hold setup A: expected tli_burn");

    for (let i = 0; i < 5; i += 1) {
      const blocked = updateOnce({
        orbital: makeOrbital({ periapsisKm: 118, apoapsisKm: 240000, specificEnergy: -0.85 }),
        metrics: baseMetrics({
          refuelFillFraction: 0.95,
          moonClosingSpeedKmS: -0.015,
          moonProjectedMissDistanceKm: 365000,
          moonBPlaneErrorKm: 310000,
          moonProjectedPeriluneAltitudeKm: 210000,
        }),
        dtSec: 90,
      });
      assert(
        blocked.state.missionPhase === NAVIGATION_MISSION_PHASES.TLI_BURN,
        `repeat-hold A.${i}: should remain in tli_burn`,
      );
    }

    const recovered = updateOnce({
      orbital: makeOrbital({ periapsisKm: 165, apoapsisKm: 382000, specificEnergy: -0.05 }),
      metrics: baseMetrics({
        refuelFillFraction: 0.95,
        moonClosingSpeedKmS: 0.055,
        moonProjectedMissDistanceKm: 42000,
        moonBPlaneErrorKm: 21000,
        moonProjectedPeriluneAltitudeKm: 125,
      }),
      dtSec: 120,
    });
    assert(
      recovered.state.missionPhase === NAVIGATION_MISSION_PHASES.MIDCOURSE,
      "repeat-hold A recover: expected transition to midcourse",
    );
  }

  {
    const { nav, updateOnce } = createUpdater();
    updateOnce({
      orbital: makeOrbital({
        periapsisKm: MOON_READY_PERIAPSIS_KM,
        apoapsisKm: MOON_READY_APOAPSIS_KM,
        specificEnergy: -1.1,
      }),
      metrics: baseMetrics({ refuelFillFraction: 0.2 }),
    });
    updateOnce({
      orbital: makeOrbital({
        periapsisKm: MOON_READY_PERIAPSIS_KM,
        apoapsisKm: MOON_READY_APOAPSIS_KM,
        specificEnergy: -1.1,
      }),
      metrics: baseMetrics({ refuelFillFraction: 0.95 }),
    });
    updateOnce({
      orbital: makeOrbital({
        periapsisKm: MOON_READY_PERIAPSIS_KM,
        apoapsisKm: MOON_READY_APOAPSIS_KM,
        specificEnergy: -1.1,
      }),
      metrics: baseMetrics({ refuelFillFraction: 0.95 }),
      dtSec: 180,
    });
    updateOnce({
      orbital: makeOrbital({ periapsisKm: 160, apoapsisKm: 382000, specificEnergy: -0.05 }),
      metrics: baseMetrics({
        refuelFillFraction: 0.95,
        moonClosingSpeedKmS: 0.06,
        moonProjectedMissDistanceKm: 45000,
        moonBPlaneErrorKm: 22000,
        moonProjectedPeriluneAltitudeKm: 130,
      }),
    });
    updateOnce({
      orbital: makeOrbital({ periapsisKm: 170, apoapsisKm: 392000, specificEnergy: 0.35, altitudeKm: 3000 }),
      metrics: baseMetrics({
        moonDistanceKm: 50000,
        moonAltitudeKm: 48200,
        moonClosingSpeedKmS: 0.55,
        moonProjectedMissDistanceKm: 12000,
        moonBPlaneErrorKm: 4500,
        moonProjectedPeriluneAltitudeKm: 150,
        earthDistanceKm: 130000,
      }),
      dtSec: 240,
    });
    assert(nav.snapshot().missionPhase === NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_INSERTION, "repeat-hold setup B: expected lunar_orbit_insertion");

    for (let i = 0; i < 4; i += 1) {
      const held = updateOnce({
        orbital: makeOrbital({ periapsisKm: 200, apoapsisKm: 395000, specificEnergy: 0.4, altitudeKm: 3200 }),
        moonOrbit: makeMoonOrbit({ specificEnergy: 0.08, apoapsisKm: 52000, periapsisKm: 18, speedKmS: 2.5 }),
        metrics: baseMetrics({
          moonDistanceKm: 11000,
          moonAltitudeKm: 9800,
          moonClosingSpeedKmS: 0.16,
          moonProjectedMissDistanceKm: 8500,
          moonBPlaneErrorKm: 5200,
          moonProjectedPeriluneAltitudeKm: 1500,
        }),
        dtSec: 180,
      });
      assert(
        held.state.missionPhase === NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_INSERTION,
        `repeat-hold B.${i}: should remain in lunar_orbit_insertion`,
      );
    }

    const captureRecovered = updateOnce({
      orbital: makeOrbital({ periapsisKm: 200, apoapsisKm: 395000, specificEnergy: 0.4, altitudeKm: 3200 }),
      moonOrbit: makeMoonOrbit({ specificEnergy: -0.12, apoapsisKm: 8800, periapsisKm: 125, speedKmS: 1.18 }),
      metrics: baseMetrics({
        moonDistanceKm: 6800,
        moonAltitudeKm: 5050,
        moonClosingSpeedKmS: 0.035,
        moonProjectedMissDistanceKm: 2200,
        moonBPlaneErrorKm: 900,
        moonProjectedPeriluneAltitudeKm: 135,
      }),
      dtSec: 180,
    });
    assert(
      captureRecovered.state.missionPhase === NAVIGATION_MISSION_PHASES.LUNAR_ORBIT_TRIM,
      "repeat-hold B recover: expected transition to lunar_orbit_trim",
    );
  }

  console.log("PASS moon-nav-e2e repeated hold persistence matrix");
}

function main() {
  runNominalMoonMissionE2E();
  runGateHoldFailureMatrix();
  runRepeatedHoldPersistenceMatrix();
}

main();
