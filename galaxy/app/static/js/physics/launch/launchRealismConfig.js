import { STARSHIP_STACK_DIMENSIONS_KM } from "./launchConfig.js";

const BOOSTER_GRID_FIN_AREA_M2 = 8.0;
const BOOSTER_GRID_FIN_RADIUS_M = STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 1000 * 0.52;
const BOOSTER_GRID_FIN_Y_M = STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm * 1000 * 0.43;

function makeBoosterGridFin(name, angleDeg, rollMix) {
  const angleRad = angleDeg * Math.PI / 180;
  const radialX = Math.cos(angleRad);
  const radialZ = Math.sin(angleRad);
  return Object.freeze({
    name,
    areaM2: BOOSTER_GRID_FIN_AREA_M2,
    positionBodyM: Object.freeze({
      x: BOOSTER_GRID_FIN_RADIUS_M * radialX,
      y: BOOSTER_GRID_FIN_Y_M,
      z: BOOSTER_GRID_FIN_RADIUS_M * radialZ,
    }),
    forceAxisBody: Object.freeze({ x: radialX, y: 0, z: radialZ }),
    controlMix: Object.freeze({
      pitch: radialZ,
      yaw: -radialX,
      roll: rollMix,
    }),
  });
}

export const LAUNCH_REALISM_CONFIG = Object.freeze({
  wind: Object.freeze({
    layers: Object.freeze([
      Object.freeze({ altitudeKm: 0, eastMS: 4, northMS: 1 }),
      Object.freeze({ altitudeKm: 1, eastMS: 6, northMS: 2 }),
      Object.freeze({ altitudeKm: 3, eastMS: 10, northMS: 3 }),
      Object.freeze({ altitudeKm: 8, eastMS: 21, northMS: 5 }),
      Object.freeze({ altitudeKm: 12, eastMS: 31, northMS: 4 }),
      Object.freeze({ altitudeKm: 16, eastMS: 27, northMS: 2 }),
      Object.freeze({ altitudeKm: 22, eastMS: 14, northMS: -1 }),
      Object.freeze({ altitudeKm: 32, eastMS: 4, northMS: -3 }),
      Object.freeze({ altitudeKm: 50, eastMS: -6, northMS: -2 }),
      Object.freeze({ altitudeKm: 80, eastMS: -2, northMS: 0 }),
    ]),
    gustMaxMS: 8,
    gustMinMS: 0.2,
  }),
  aero: Object.freeze({
    qAlphaStartRatio: 0.72,
    maxAoADegLowQ: 9.0,
    maxAoADegHighQ: 2.1,
    qHighForAoALimitPa: 55_000,
    stage1: Object.freeze({
      mach: Object.freeze([0, 0.8, 1.0, 1.2, 2.0, 5.0, 8.0]),
      cd0: Object.freeze([0.24, 0.30, 0.55, 0.46, 0.33, 0.24, 0.22]),
      clAlphaPerRad: Object.freeze([2.8, 2.9, 2.2, 1.8, 1.2, 0.55, 0.30]),
      cpNormalized: Object.freeze([0.36, 0.35, 0.33, 0.31, 0.28, 0.25, 0.24]),
      cdAlpha2: 2.6,
      inducedDragFactor: 0.06,
      transonicWaveDragCd: 0.045,
      transonicWaveDragMach: 1.03,
      transonicWaveDragWidth: 0.16,
      powerOnBaseDragFactor: 0.028,
      stabilityGain: 1.45,
      qAlphaTargetPaRad: 1_350,
      qAlphaThrottleFloor: 0.62,
      qAlphaThrottleGain: 0.55,
    }),
    stage2: Object.freeze({
      mach: Object.freeze([0, 0.8, 1.0, 1.2, 2.0, 5.0, 10.0]),
      cd0: Object.freeze([0.20, 0.24, 0.38, 0.33, 0.25, 0.20, 0.18]),
      clAlphaPerRad: Object.freeze([2.2, 2.4, 1.9, 1.55, 1.05, 0.50, 0.24]),
      cpNormalized: Object.freeze([0.38, 0.37, 0.35, 0.33, 0.30, 0.28, 0.27]),
      cdAlpha2: 2.1,
      inducedDragFactor: 0.05,
      transonicWaveDragCd: 0.032,
      transonicWaveDragMach: 1.03,
      transonicWaveDragWidth: 0.17,
      powerOnBaseDragFactor: 0.020,
      stabilityGain: 1.35,
      qAlphaTargetPaRad: 1_050,
      qAlphaThrottleFloor: 0.38,
      qAlphaThrottleGain: 1.12,
    }),
    booster: Object.freeze({
      mach: Object.freeze([0, 0.8, 1.0, 1.2, 2.0, 5.0, 8.0]),
      cd0: Object.freeze([0.28, 0.34, 0.60, 0.50, 0.36, 0.28, 0.24]),
      clAlphaPerRad: Object.freeze([3.1, 3.2, 2.4, 2.0, 1.3, 0.62, 0.32]),
      cpNormalized: Object.freeze([0.35, 0.34, 0.32, 0.30, 0.27, 0.24, 0.23]),
      cdAlpha2: 2.8,
      inducedDragFactor: 0.07,
      transonicWaveDragCd: 0.055,
      transonicWaveDragMach: 1.04,
      transonicWaveDragWidth: 0.15,
      powerOnBaseDragFactor: 0.030,
      stabilityGain: 1.55,
      qAlphaTargetPaRad: 1_650,
      qAlphaThrottleFloor: 0.36,
      qAlphaThrottleGain: 1.18,
    }),
  }),
  gridFins: Object.freeze({
    booster: Object.freeze({
      totalAreaM2: 24.0,
      liftSlopePerRad: 2.55,
      maxDeflectionDeg: 32,
      leverArmM: BOOSTER_GRID_FIN_Y_M,
      bodyLengthM: STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm * 1000,
      baseDampingPerS: 1.02,
      qMinPa: 1_000,
      qPeakPa: 16_000,
      qFadePa: 76_000,
      fins: Object.freeze([
        makeBoosterGridFin("upper", 90, 0.34),
        makeBoosterGridFin("lower-port", 210, -0.34),
        makeBoosterGridFin("lower-starboard", 330, 0.34),
      ]),
    }),
  }),
  engineCluster: Object.freeze({
    booster: Object.freeze({
      engines: Object.freeze([
        Object.freeze({
          name: "center",
          positionBodyM: Object.freeze({ x: 0, y: -STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm * 1000 * 0.46, z: 0 }),
        }),
        Object.freeze({
          name: "port",
          positionBodyM: Object.freeze({
            x: -STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 1000 * 0.18,
            y: -STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm * 1000 * 0.46,
            z: STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 1000 * 0.11,
          }),
        }),
        Object.freeze({
          name: "starboard",
          positionBodyM: Object.freeze({
            x: STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 1000 * 0.18,
            y: -STARSHIP_STACK_DIMENSIONS_KM.boosterHeightKm * 1000 * 0.46,
            z: STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 1000 * 0.11,
          }),
        }),
      ]),
    }),
  }),
  actuator: Object.freeze({
    stage: Object.freeze({
      throttleRiseTauSec: 0.52,
      throttleFallTauSec: 0.34,
      gimbalRateDegS: 7.4,
    }),
    booster: Object.freeze({
      throttleRiseTauSec: 0.42,
      throttleFallTauSec: 0.30,
      gimbalRateDegS: 9.6,
      maxGimbalDeflectionDeg: 15.0,
    }),
  }),
  massModel: Object.freeze({
    lagTauSec: 0.9,
    stage1: Object.freeze({
      enginePlaneNorm: 0.04,
      dryComponents: Object.freeze([
        Object.freeze({ massFraction: 0.18, axialPositionNorm: 0.08, axialExtentNorm: 0.08, radiusNorm: 0.34 }),
        Object.freeze({ massFraction: 0.18, axialPositionNorm: 0.24, axialExtentNorm: 0.16, radiusNorm: 0.52 }),
        Object.freeze({ massFraction: 0.30, axialPositionNorm: 0.45, axialExtentNorm: 0.24, radiusNorm: 0.56 }),
        Object.freeze({ massFraction: 0.34, axialPositionNorm: 0.78, axialExtentNorm: 0.18, radiusNorm: 0.44 }),
      ]),
      propellantTanks: Object.freeze([
        Object.freeze({ propellantFraction: 0.78, bottomNorm: 0.10, topNorm: 0.56, radiusNorm: 0.55 }),
        Object.freeze({ propellantFraction: 0.22, bottomNorm: 0.58, topNorm: 0.84, radiusNorm: 0.52 }),
      ]),
      attachedComponents: Object.freeze([
        Object.freeze({ massFraction: 0.74, axialPositionNorm: 0.72, axialExtentNorm: 0.20, radiusNorm: 0.48 }),
        Object.freeze({ massFraction: 0.26, axialPositionNorm: 0.92, axialExtentNorm: 0.12, radiusNorm: 0.34 }),
      ]),
    }),
    stage2: Object.freeze({
      enginePlaneNorm: 0.06,
      dryComponents: Object.freeze([
        Object.freeze({ massFraction: 0.18, axialPositionNorm: 0.09, axialExtentNorm: 0.09, radiusNorm: 0.32 }),
        Object.freeze({ massFraction: 0.20, axialPositionNorm: 0.24, axialExtentNorm: 0.16, radiusNorm: 0.48 }),
        Object.freeze({ massFraction: 0.30, axialPositionNorm: 0.46, axialExtentNorm: 0.24, radiusNorm: 0.54 }),
        Object.freeze({ massFraction: 0.32, axialPositionNorm: 0.84, axialExtentNorm: 0.18, radiusNorm: 0.38 }),
      ]),
      propellantTanks: Object.freeze([
        Object.freeze({ propellantFraction: 0.78, bottomNorm: 0.12, topNorm: 0.55, radiusNorm: 0.52 }),
        Object.freeze({ propellantFraction: 0.22, bottomNorm: 0.57, topNorm: 0.82, radiusNorm: 0.48 }),
      ]),
      attachedComponents: Object.freeze([]),
    }),
    booster: Object.freeze({
      enginePlaneNorm: 0.04,
      dryComponents: Object.freeze([
        Object.freeze({ massFraction: 0.20, axialPositionNorm: 0.08, axialExtentNorm: 0.08, radiusNorm: 0.34 }),
        Object.freeze({ massFraction: 0.16, axialPositionNorm: 0.23, axialExtentNorm: 0.14, radiusNorm: 0.52 }),
        Object.freeze({ massFraction: 0.26, axialPositionNorm: 0.44, axialExtentNorm: 0.22, radiusNorm: 0.56 }),
        Object.freeze({ massFraction: 0.38, axialPositionNorm: 0.76, axialExtentNorm: 0.20, radiusNorm: 0.46 }),
      ]),
      propellantTanks: Object.freeze([
        Object.freeze({ propellantFraction: 0.78, bottomNorm: 0.10, topNorm: 0.54, radiusNorm: 0.55 }),
        Object.freeze({ propellantFraction: 0.22, bottomNorm: 0.56, topNorm: 0.82, radiusNorm: 0.52 }),
      ]),
      attachedComponents: Object.freeze([]),
    }),
  }),
});
