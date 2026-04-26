import { NAVIGATION_DEFAULTS } from "../app/static/js/physics/navigation_system/navigationSystemConfig.js";
import { synthesizeMoonNavigationMeasurement } from "../app/static/js/physics/navigation_system/lunar/moonMeasurementModel.js";
import {
  createMoonNavigationFilterState,
  updateMoonNavigationFilter,
} from "../app/static/js/physics/navigation_system/lunar/moonStateFilter.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const targetVectors = {
  shipEarthPositionKm: { x: 200_000, y: 0, z: 0 },
  shipEarthVelocityKmS: { x: 0, y: 2.4, z: 0.02 },
  moonEarthPositionKm: { x: 384_400, y: 0, z: 0 },
  moonEarthVelocityKmS: { x: 0, y: 1.022, z: 0 },
  sunEarthPositionKm: { x: 149_597_870, y: 0, z: 0 },
  sunEarthVelocityKmS: { x: 0, y: 29.78, z: 0 },
};

const metrics = {
  bodyId: "starship-moon-sensor-test",
  stageMassKg: 900_000,
};

function testMeasurementCadenceAndSources() {
  const first = synthesizeMoonNavigationMeasurement({
    ...targetVectors,
    timestampSec: 0,
    estimatorConfig: NAVIGATION_DEFAULTS.estimator,
  });
  assert(first?.fresh === true, "sensor_fusion: first DSN measurement should be fresh");
  assert(
    String(first?.diagnostics?.source || "") === "starship_fused_imu_dsn_star_tracker_optnav",
    `sensor_fusion: unexpected source ${first?.diagnostics?.source}`,
  );
  assert(
    Number(first?.diagnostics?.dsnLightTimeSec) > 0.5,
    "sensor_fusion: expected Earth-range light-time in diagnostics",
  );

  const held = synthesizeMoonNavigationMeasurement({
    ...targetVectors,
    timestampSec: 60,
    estimatorConfig: NAVIGATION_DEFAULTS.estimator,
    previousMeasurementTimestampSec: first.diagnostics.measurementTimestampSec,
  });
  assert(held?.fresh === false, "sensor_fusion: coast measurement should be held between DSN cadences");
  assert(
    Number(held?.diagnostics?.nextMeasurementDueSec) >= 180,
    "sensor_fusion: expected coast DSN cadence to delay the next update",
  );
}

function testFilterPropagatesOnImuBetweenMeasurements() {
  const filterState = createMoonNavigationFilterState();
  updateMoonNavigationFilter({
    filterState,
    targetVectors,
    metrics,
    plannerConfig: NAVIGATION_DEFAULTS.planner,
    estimatorConfig: NAVIGATION_DEFAULTS.estimator,
    timestampSec: 0,
  });
  assert(filterState.estimate, "sensor_filter: missing initial estimate");
  assert(filterState.lastMeasurement?.fresh === true, "sensor_filter: expected initial fresh measurement");

  updateMoonNavigationFilter({
    filterState,
    targetVectors,
    metrics,
    plannerConfig: NAVIGATION_DEFAULTS.planner,
    estimatorConfig: NAVIGATION_DEFAULTS.estimator,
    timestampSec: 60,
  });
  assert(filterState.estimate, "sensor_filter: missing propagated estimate");
  assert(filterState.lastMeasurement?.fresh === false, "sensor_filter: expected IMU propagation between DSN fixes");
  assert(
    Number.isFinite(Number(filterState.lastMeasurement?.measurementAgeSec))
      && Number(filterState.lastMeasurement.measurementAgeSec) > 60,
    "sensor_filter: expected measurement age to include cadence/light-time",
  );

  updateMoonNavigationFilter({
    filterState,
    targetVectors,
    metrics,
    plannerConfig: NAVIGATION_DEFAULTS.planner,
    estimatorConfig: NAVIGATION_DEFAULTS.estimator,
    timestampSec: 180,
  });
  assert(filterState.lastMeasurement?.fresh === true, "sensor_filter: expected a fresh DSN/optnav correction at cadence");
  assert(
    Number.isFinite(Number(filterState.lastMeasurement?.positionResidualKm)),
    "sensor_filter: expected residual from fresh correction",
  );
}

function main() {
  testMeasurementCadenceAndSources();
  testFilterPropagatesOnImuBetweenMeasurements();
  console.log("PASS moon-starship-sensor-fusion-lock");
}

main();
