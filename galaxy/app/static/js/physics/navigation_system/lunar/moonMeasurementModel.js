import {
  add,
  clamp,
  dot,
  finiteVector,
  length,
  normalize,
  scale,
  subtract,
} from "../navigationMath.js";

const LIGHT_SPEED_KM_S = 299_792.458;

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback);
}

function cross(a, b) {
  return {
    x: ((Number(a?.y) || 0) * (Number(b?.z) || 0)) - ((Number(a?.z) || 0) * (Number(b?.y) || 0)),
    y: ((Number(a?.z) || 0) * (Number(b?.x) || 0)) - ((Number(a?.x) || 0) * (Number(b?.z) || 0)),
    z: ((Number(a?.x) || 0) * (Number(b?.y) || 0)) - ((Number(a?.y) || 0) * (Number(b?.x) || 0)),
  };
}

function hashNoise(seed) {
  const value = Math.sin(seed) * 43758.5453123;
  return (value - Math.floor(value)) * 2 - 1;
}

function buildShipMeasurementFrame(positionKm, velocityKmS) {
  const radial = normalize(positionKm, { x: 1, y: 0, z: 0 });
  const alongTrack = normalize(
    subtract(velocityKmS, scale(radial, dot(velocityKmS, radial))),
    { x: 0, y: 1, z: 0 },
  );
  const crossTrack = normalize(cross(radial, alongTrack), { x: 0, y: 0, z: 1 });
  return { radial, alongTrack, crossTrack };
}

function sensorCadenceSec({
  rangeKm,
  moonRangeKm,
  estimatorConfig = {},
} = {}) {
  const nearCadenceSec = Math.max(5, finiteNumber(estimatorConfig.dsnNearCadenceSec, 45));
  const coastCadenceSec = Math.max(nearCadenceSec, finiteNumber(estimatorConfig.dsnCoastCadenceSec, 180));
  const nearEarth = rangeKm <= Math.max(1, finiteNumber(estimatorConfig.opticalNavEarthRangeKm, 180_000));
  const nearMoon = moonRangeKm <= Math.max(1, finiteNumber(estimatorConfig.opticalNavMoonRangeKm, 120_000));
  return nearEarth || nearMoon ? nearCadenceSec : coastCadenceSec;
}

export function synthesizeMoonNavigationMeasurement({
  shipEarthPositionKm = null,
  shipEarthVelocityKmS = null,
  moonEarthPositionKm = null,
  timestampSec = Number.NaN,
  estimatorConfig = {},
  previousMeasurementTimestampSec = Number.NaN,
} = {}) {
  if (!finiteVector(shipEarthPositionKm) || !finiteVector(shipEarthVelocityKmS)) {
    return null;
  }
  const nowSec = finiteNumber(timestampSec, 0);
  const rangeKm = Math.max(1e-6, length(shipEarthPositionKm));
  const moonRangeKm = finiteVector(moonEarthPositionKm)
    ? length(subtract(moonEarthPositionKm, shipEarthPositionKm))
    : Number.POSITIVE_INFINITY;
  const cadenceSec = sensorCadenceSec({ rangeKm, moonRangeKm, estimatorConfig });
  const previousTimestampSec = finiteNumber(previousMeasurementTimestampSec, Number.NaN);
  const dsnLightTimeSec = rangeKm / LIGHT_SPEED_KM_S;
  const opticalMoonNavActive = moonRangeKm <= Math.max(1, finiteNumber(estimatorConfig.opticalNavMoonRangeKm, 120_000));
  const opticalEarthNavActive = rangeKm <= Math.max(1, finiteNumber(estimatorConfig.opticalNavEarthRangeKm, 180_000));
  const measurementDue = (
    !Number.isFinite(previousTimestampSec)
    || nowSec < previousTimestampSec
    || (nowSec - previousTimestampSec) >= cadenceSec
  );
  if (!measurementDue) {
    const measurementAgeSec = Math.max(0, nowSec - previousTimestampSec) + dsnLightTimeSec;
    return {
      fresh: false,
      positionKm: null,
      velocityKmS: null,
      diagnostics: {
        source: "starship_fused_imu_dsn_star_tracker_optnav",
        sensorSuite: "imu-propagation+dsn-cadence+star-tracker+optical-nav",
        fresh: false,
        dsnCadenceSec: cadenceSec,
        dsnLightTimeSec,
        measurementAgeSec,
        measurementTimestampSec: previousTimestampSec,
        nextMeasurementDueSec: previousTimestampSec + cadenceSec,
        opticalMoonNavActive,
        opticalEarthNavActive,
      },
    };
  }
  const frame = buildShipMeasurementFrame(shipEarthPositionKm, shipEarthVelocityKmS);
  const moonLineOfSight = finiteVector(moonEarthPositionKm)
    ? normalize(subtract(moonEarthPositionKm, shipEarthPositionKm), frame.alongTrack)
    : frame.alongTrack;
  const rangeSigmaKm = Math.max(0.001, finiteNumber(estimatorConfig.measurementPositionSigmaKm, 0.2));
  const rateSigmaKmS = Math.max(1e-6, finiteNumber(estimatorConfig.measurementVelocitySigmaKmS, 0.0002));
  const starTrackerLosSigmaDeg = Math.max(
    0.001,
    finiteNumber(estimatorConfig.starTrackerLosSigmaDeg, finiteNumber(estimatorConfig.measurementLosSigmaDeg, 0.012)),
  );
  const opticalLosSigmaDeg = Math.max(0.001, finiteNumber(estimatorConfig.opticalNavLosSigmaDeg, 0.004));
  const losSigmaDeg = Math.min(
    Math.max(0.001, finiteNumber(estimatorConfig.measurementLosSigmaDeg, 0.012)),
    opticalMoonNavActive || opticalEarthNavActive ? opticalLosSigmaDeg : starTrackerLosSigmaDeg,
  );
  const losSigmaRad = losSigmaDeg * (Math.PI / 180);
  const lightTimeSigmaKm = Math.max(0, dsnLightTimeSec * finiteNumber(estimatorConfig.dsnLightTimeUncertaintyScale, 0.0015));
  const effectiveRangeSigmaKm = Math.max(rangeSigmaKm, rangeSigmaKm + lightTimeSigmaKm);
  const angularRangeKm = opticalMoonNavActive ? Math.max(1, moonRangeKm) : rangeKm;
  const crossTrackSigmaKm = Math.max(effectiveRangeSigmaKm * 0.25, angularRangeKm * losSigmaRad);
  const alongTrackSigmaKm = Math.max(effectiveRangeSigmaKm * 0.5, crossTrackSigmaKm * 0.45);
  const crossTrackVelSigmaKmS = Math.max(rateSigmaKmS, crossTrackSigmaKm / 50000);

  const baseSeed = nowSec * 0.01731;
  const positionNoise = add(
    add(
      scale(frame.radial, hashNoise(baseSeed + 11.7) * effectiveRangeSigmaKm),
      scale(frame.alongTrack, hashNoise(baseSeed + 27.9) * alongTrackSigmaKm),
    ),
    scale(frame.crossTrack, hashNoise(baseSeed + 43.1) * crossTrackSigmaKm),
  );
  const velocityNoise = add(
    add(
      scale(frame.radial, hashNoise(baseSeed + 59.3) * rateSigmaKmS),
      scale(frame.alongTrack, hashNoise(baseSeed + 71.5) * crossTrackVelSigmaKmS),
    ),
    scale(frame.crossTrack, hashNoise(baseSeed + 83.7) * crossTrackVelSigmaKmS),
  );

  const measuredPositionKm = add(shipEarthPositionKm, positionNoise);
  const measuredVelocityKmS = add(shipEarthVelocityKmS, velocityNoise);
  const measuredRangeKm = Math.max(0, length(measuredPositionKm));
  const measuredRangeRateKmS = measuredRangeKm > 1e-9
    ? dot(measuredVelocityKmS, scale(measuredPositionKm, 1 / measuredRangeKm))
    : 0;
  const moonLosErrorDeg = finiteVector(moonEarthPositionKm)
    ? Math.acos(
      clamp(
        dot(
          moonLineOfSight,
          normalize(subtract(moonEarthPositionKm, measuredPositionKm), moonLineOfSight),
        ),
        -1,
        1,
      ),
    ) * (180 / Math.PI)
    : 0;

  return {
    fresh: true,
    positionKm: measuredPositionKm,
    velocityKmS: measuredVelocityKmS,
    positionSigmaKm: {
      radial: rangeSigmaKm,
      alongTrack: alongTrackSigmaKm,
      crossTrack: crossTrackSigmaKm,
    },
    velocitySigmaKmS: {
      radial: rateSigmaKmS,
      alongTrack: crossTrackVelSigmaKmS,
      crossTrack: crossTrackVelSigmaKmS,
    },
    diagnostics: {
      source: "starship_fused_imu_dsn_star_tracker_optnav",
      sensorSuite: "imu-propagation+dsn-cadence+star-tracker+optical-nav",
      fresh: true,
      rangeKm: measuredRangeKm,
      rangeRateKmS: measuredRangeRateKmS,
      moonLosErrorDeg,
      rangeSigmaKm: effectiveRangeSigmaKm,
      rangeRateSigmaKmS: rateSigmaKmS,
      lineOfSightSigmaDeg: losSigmaDeg,
      starTrackerLineOfSightSigmaDeg: starTrackerLosSigmaDeg,
      opticalLineOfSightSigmaDeg: opticalLosSigmaDeg,
      opticalMoonNavActive,
      opticalEarthNavActive,
      dsnCadenceSec: cadenceSec,
      dsnLightTimeSec,
      measurementAgeSec: dsnLightTimeSec,
      measurementTimestampSec: nowSec,
      nextMeasurementDueSec: nowSec + cadenceSec,
    },
  };
}
