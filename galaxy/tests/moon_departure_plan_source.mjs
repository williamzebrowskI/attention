import { chooseMoonDeparturePlanSource } from "../app/static/js/physics/launch/launchFleetController.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeWindow({
  ready = false,
  corridorAccepted = false,
  corridorScore = 0,
  windowScore = 0,
  predictedMissDistanceKm = Number.NaN,
  predictedPeriluneAltitudeKm = Number.NaN,
  bPlaneErrorKm = Number.NaN,
} = {}) {
  return {
    ready,
    corridorAccepted,
    corridorScore,
    windowScore,
    predictedMissDistanceKm,
    predictedPeriluneAltitudeKm,
    bPlaneErrorKm,
  };
}

{
  const seed = makeWindow({
    ready: false,
    corridorAccepted: false,
    corridorScore: 0.1,
    windowScore: 0.2,
    predictedMissDistanceKm: 148_084_830,
    predictedPeriluneAltitudeKm: 148_083_093,
    bPlaneErrorKm: 144_833_148,
  });
  const live = makeWindow({
    ready: false,
    corridorAccepted: false,
    corridorScore: 0.3,
    windowScore: 0.3,
    predictedMissDistanceKm: 366_790,
    predictedPeriluneAltitudeKm: 365_053,
    bPlaneErrorKm: 364_679,
  });
  const chosen = chooseMoonDeparturePlanSource(seed, live);
  assert(chosen === live, "expected live unaccepted corridor to replace much worse seed");
}

{
  const seed = makeWindow({
    ready: true,
    corridorAccepted: true,
    corridorScore: 1,
    windowScore: 0.5,
    predictedMissDistanceKm: 26_000,
    predictedPeriluneAltitudeKm: 24_000,
    bPlaneErrorKm: 22_000,
  });
  const live = makeWindow({
    ready: false,
    corridorAccepted: false,
    corridorScore: 0.8,
    windowScore: 0.4,
    predictedMissDistanceKm: 30_000,
    predictedPeriluneAltitudeKm: 28_000,
    bPlaneErrorKm: 26_000,
  });
  const chosen = chooseMoonDeparturePlanSource(seed, live);
  assert(chosen === seed, "expected accepted seed corridor to be retained");
}

{
  const seed = makeWindow({
    ready: false,
    corridorAccepted: false,
    corridorScore: 0.4,
    windowScore: 0.3,
    predictedMissDistanceKm: 120_000,
    predictedPeriluneAltitudeKm: 40_000,
    bPlaneErrorKm: 70_000,
  });
  const live = makeWindow({
    ready: true,
    corridorAccepted: true,
    corridorScore: 1,
    windowScore: 0.4,
    predictedMissDistanceKm: 18_000,
    predictedPeriluneAltitudeKm: 17_000,
    bPlaneErrorKm: 15_000,
  });
  const chosen = chooseMoonDeparturePlanSource(seed, live);
  assert(chosen === live, "expected accepted live corridor to replace bad seed");
}

console.log("PASS moon-departure-plan-source");
