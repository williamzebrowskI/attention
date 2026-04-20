import {
  createBoosterNavigationState,
  resetBoosterNavigationState,
  updateBoosterNavigationState,
} from "../app/static/js/physics/launch/boosterNavigation.js";
import { computeBoosterCatchRelativeState } from "../app/static/js/physics/launch/launchSiteCatchGeometry.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const earthState = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  };
  const catchFrame = {
    centerPosition: { x: 0.000, y: 0.000, z: 6371.208 },
    centerVelocity: { x: 0, y: 0, z: 0 },
    surfaceNormal: { x: 0, y: 0, z: 1 },
    eastAxis: { x: 1, y: 0, z: 0 },
    northAxis: { x: 0, y: 1, z: 0 },
  };
  const boosterState = {
    position: { x: 0.018, y: -0.011, z: 6371.356 },
    velocity: { x: 0.0028, y: -0.0016, z: -0.032 },
  };

  const navigationState = createBoosterNavigationState();
  resetBoosterNavigationState(navigationState);

  const solution = updateBoosterNavigationState({
    navigationState,
    boosterState,
    earthState,
    catchFrame,
    elapsedSec: 182,
    altitudeKm: 0.148,
    dynamicPressurePa: 1900,
  });

  assert(solution, "expected booster navigation solution");
  assert(solution.source === "imu+gnss+tower-relative", `expected tower-relative nav source, got ${solution?.source}`);
  assert(solution.towerRelativeActive, "expected tower-relative nav to be active");
  assert(solution.positionSigmaKm > 0, `expected positive inertial sigma, got ${solution?.positionSigmaKm}`);
  assert(solution.catchPositionSigmaKm > 0, `expected positive tower-relative sigma, got ${solution?.catchPositionSigmaKm}`);
  assert(solution.estimatedBoosterState?.position, "expected estimated booster state");
  assert(solution.catchRelativeState, "expected estimated tower-relative state");

  const truthCatchRelativeState = computeBoosterCatchRelativeState({
    boosterState,
    catchFrame,
  });
  const estimatedCatchRelativeState = solution.catchRelativeState;
  const verticalErrorDeltaKm = Math.abs(
    Number(estimatedCatchRelativeState.verticalErrorKm) - Number(truthCatchRelativeState.verticalErrorKm),
  );
  const lateralErrorDeltaKm = Math.abs(
    Number(estimatedCatchRelativeState.lateralRangeKm) - Number(truthCatchRelativeState.lateralRangeKm),
  );

  assert(verticalErrorDeltaKm > 1e-6, "expected navigation estimate to differ slightly from truth");
  assert(verticalErrorDeltaKm < 0.02, `expected vertical estimate to stay close to truth, got delta ${verticalErrorDeltaKm} km`);
  assert(lateralErrorDeltaKm < 0.03, `expected lateral estimate to stay close to truth, got delta ${lateralErrorDeltaKm} km`);

  console.log("PASS booster-navigation-filter-lock");
}

main();
