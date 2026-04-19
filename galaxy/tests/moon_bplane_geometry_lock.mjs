import { estimateBPlaneErrorKm } from "../app/static/js/physics/navigation_system/lunar/moonDynamicsModel.js";

const G_KM3_KG_S2 = 6.67430e-20;
const MOON_MASS_KG = 7.342e22;
const MOON_RADIUS_KM = 1737.4;
const TARGET_PERILUNE_ALTITUDE_KM = 120;
const VINF_KM_S = 0.9;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertApprox(actual, expected, tolerance, message) {
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  assert(
    Number.isFinite(actualNumber)
      && Number.isFinite(expectedNumber)
      && Math.abs(actualNumber - expectedNumber) <= tolerance,
    `${message}: expected ${expectedNumber} +/- ${tolerance}, got ${actualNumber}`,
  );
}

function targetImpactParameterKm({ periapsisRadiusKm, muKm3S2, hyperbolicExcessSpeedKmS }) {
  return periapsisRadiusKm * Math.sqrt(
    1 + ((2 * muKm3S2) / (periapsisRadiusKm * hyperbolicExcessSpeedKmS * hyperbolicExcessSpeedKmS)),
  );
}

function main() {
  const moonMuKm3S2 = G_KM3_KG_S2 * MOON_MASS_KG;
  const targetPeriapsisRadiusKm = MOON_RADIUS_KM + TARGET_PERILUNE_ALTITUDE_KM;
  const periapsisSpeedKmS = Math.sqrt(
    (VINF_KM_S * VINF_KM_S) + ((2 * moonMuKm3S2) / targetPeriapsisRadiusKm),
  );
  const matchingErrorKm = estimateBPlaneErrorKm({
    relativePositionKm: { x: targetPeriapsisRadiusKm, y: 0, z: 0 },
    relativeVelocityKmS: { x: 0, y: periapsisSpeedKmS, z: 0 },
    targetPeriluneAltitudeKm: TARGET_PERILUNE_ALTITUDE_KM,
    bodyRadiusKm: MOON_RADIUS_KM,
    bodyMuKm3S2: moonMuKm3S2,
  });
  assertApprox(
    matchingErrorKm,
    0,
    1e-6,
    "moon_bplane_geometry_lock: matching hyperbolic periapsis should yield near-zero B-plane error",
  );

  const raisedTargetPeriluneAltitudeKm = 500;
  const raisedTargetPeriapsisRadiusKm = MOON_RADIUS_KM + raisedTargetPeriluneAltitudeKm;
  const expectedRaisedErrorKm = Math.abs(
    targetImpactParameterKm({
      periapsisRadiusKm: targetPeriapsisRadiusKm,
      muKm3S2: moonMuKm3S2,
      hyperbolicExcessSpeedKmS: VINF_KM_S,
    })
      - targetImpactParameterKm({
        periapsisRadiusKm: raisedTargetPeriapsisRadiusKm,
        muKm3S2: moonMuKm3S2,
        hyperbolicExcessSpeedKmS: VINF_KM_S,
      }),
  );
  const raisedTargetErrorKm = estimateBPlaneErrorKm({
    relativePositionKm: { x: targetPeriapsisRadiusKm, y: 0, z: 0 },
    relativeVelocityKmS: { x: 0, y: periapsisSpeedKmS, z: 0 },
    targetPeriluneAltitudeKm: raisedTargetPeriluneAltitudeKm,
    bodyRadiusKm: MOON_RADIUS_KM,
    bodyMuKm3S2: moonMuKm3S2,
  });
  assert(
    raisedTargetErrorKm > 100,
    `moon_bplane_geometry_lock: raised-target error should be materially non-zero, got ${raisedTargetErrorKm}`,
  );
  assertApprox(
    raisedTargetErrorKm,
    expectedRaisedErrorKm,
    1e-6,
    "moon_bplane_geometry_lock: hyperbolic B-plane residual should follow target impact-parameter geometry",
  );

  console.log("moon-bplane-geometry-lock: ok");
}

main();
