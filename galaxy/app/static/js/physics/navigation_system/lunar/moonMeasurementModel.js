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

export function synthesizeMoonNavigationMeasurement({
  shipEarthPositionKm = null,
  shipEarthVelocityKmS = null,
  moonEarthPositionKm = null,
  timestampSec = Number.NaN,
  estimatorConfig = {},
} = {}) {
  if (!finiteVector(shipEarthPositionKm) || !finiteVector(shipEarthVelocityKmS)) {
    return null;
  }
  const nowSec = finiteNumber(timestampSec, 0);
  const rangeKm = Math.max(1e-6, length(shipEarthPositionKm));
  const frame = buildShipMeasurementFrame(shipEarthPositionKm, shipEarthVelocityKmS);
  const moonLineOfSight = finiteVector(moonEarthPositionKm)
    ? normalize(subtract(moonEarthPositionKm, shipEarthPositionKm), frame.alongTrack)
    : frame.alongTrack;
  const rangeSigmaKm = Math.max(0.001, finiteNumber(estimatorConfig.measurementPositionSigmaKm, 0.2));
  const rateSigmaKmS = Math.max(1e-6, finiteNumber(estimatorConfig.measurementVelocitySigmaKmS, 0.0002));
  const losSigmaDeg = Math.max(0.001, finiteNumber(estimatorConfig.measurementLosSigmaDeg, 0.012));
  const losSigmaRad = losSigmaDeg * (Math.PI / 180);
  const crossTrackSigmaKm = Math.max(rangeSigmaKm * 0.25, rangeKm * losSigmaRad);
  const alongTrackSigmaKm = Math.max(rangeSigmaKm * 0.5, crossTrackSigmaKm * 0.45);
  const crossTrackVelSigmaKmS = Math.max(rateSigmaKmS, crossTrackSigmaKm / 50000);

  const baseSeed = nowSec * 0.01731;
  const positionNoise = add(
    add(
      scale(frame.radial, hashNoise(baseSeed + 11.7) * rangeSigmaKm),
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
      source: "simulated_dsn_star_tracker",
      rangeKm: measuredRangeKm,
      rangeRateKmS: measuredRangeRateKmS,
      moonLosErrorDeg,
      rangeSigmaKm,
      rangeRateSigmaKmS: rateSigmaKmS,
      lineOfSightSigmaDeg: losSigmaDeg,
    },
  };
}
