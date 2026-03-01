function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function computeBoosterRecoveryCommand(input = {}) {
  const altitudeKm = Math.max(0, Number(input.altitudeKm) || 0);
  const radialSpeedKmS = Number(input.radialSpeedKmS) || 0;
  const tangentialSpeedKmS = Math.max(0, Number(input.tangentialSpeedKmS) || 0);
  const elapsedSec = Math.max(0, Number(input.timeSinceSeparationSec) || 0);
  const propellantKg = Math.max(0, Number(input.remainingPropellantKg) || 0);
  const dynamicPressurePa = Math.max(0, Number(input.dynamicPressurePa) || 0);
  const reserveLandingKg = Math.max(0, Number(input.reserveLandingPropellantKg) || 0);

  const separationCoastSec = 8;
  const entryBurnUpperKm = 68;
  const entryBurnLowerKm = 24;
  const landingBurnStartKm = 16.0;
  const touchdownBandKm = 0.03;

  if (altitudeKm <= touchdownBandKm && Math.abs(radialSpeedKmS) < 0.025 && tangentialSpeedKmS < 0.02) {
    return {
      phase: "landed",
      guidanceMode: "booster-landed",
      throttle: 0,
      directionMix: { up: 1, retrograde: 0, antiTangent: 0 },
      touchdownReady: true,
    };
  }

  if (elapsedSec < separationCoastSec) {
    return {
      phase: "separation-coast",
      guidanceMode: "booster-separation-coast",
      throttle: 0,
      directionMix: { up: 0.2, retrograde: 0.2, antiTangent: 0.2 },
      touchdownReady: false,
    };
  }

  const hasBoostbackBudget = propellantKg > (reserveLandingKg * 1.12);
  if (
    altitudeKm > entryBurnUpperKm
    && hasBoostbackBudget
    && tangentialSpeedKmS > 1.1
  ) {
    const tangentialScale = clamp((tangentialSpeedKmS - 1.1) / 2.8, 0, 1);
    return {
      phase: "boostback",
      guidanceMode: "booster-boostback",
      throttle: clamp(0.36 + (0.28 * tangentialScale), 0.3, 0.66),
      directionMix: { up: 0.12, retrograde: 0.92, antiTangent: 0.58 },
      touchdownReady: false,
    };
  }

  if (altitudeKm <= entryBurnUpperKm && altitudeKm >= entryBurnLowerKm) {
    if (radialSpeedKmS < -0.08 || dynamicPressurePa > 9_500) {
      const descentFactor = clamp((-radialSpeedKmS - 0.08) / 0.32, 0, 1);
      return {
        phase: "entry-burn",
        guidanceMode: "booster-entry-burn",
        throttle: clamp(0.28 + (0.42 * descentFactor), 0.24, 0.8),
        directionMix: { up: 0.74, retrograde: 0.42, antiTangent: 0.74 },
        touchdownReady: false,
      };
    }
    return {
      phase: "ballistic-descent",
      guidanceMode: "booster-ballistic",
      throttle: 0,
      directionMix: { up: 0.2, retrograde: 0.24, antiTangent: 0.42 },
      touchdownReady: false,
    };
  }

  if (altitudeKm > landingBurnStartKm) {
    return {
      phase: "descent-coast",
      guidanceMode: "booster-descent-coast",
      throttle: 0,
      directionMix: { up: 0.18, retrograde: 0.22, antiTangent: 0.54 },
      touchdownReady: false,
    };
  }

  // Simple terminal guidance profile: reduce target descent as altitude decreases.
  const targetDescentRateKmS = clamp(
    0.002 + (altitudeKm * 0.0105),
    0.004,
    0.09,
  );
  const targetRadialSpeedKmS = -targetDescentRateKmS;
  const radialErrorKmS = targetRadialSpeedKmS - radialSpeedKmS;
  let throttle = clamp(
    0.24 + (radialErrorKmS * 4.1) + (tangentialSpeedKmS * 0.22),
    0.2,
    1.0,
  );
  if (altitudeKm < 2.0 && radialSpeedKmS < -0.04) {
    const flareScale = clamp((-radialSpeedKmS - 0.04) / 0.12, 0, 1);
    throttle = Math.max(throttle, clamp(0.52 + (0.32 * flareScale), 0.52, 0.92));
  }
  return {
    phase: "landing-burn",
    guidanceMode: "booster-landing-burn",
    throttle,
    directionMix: { up: 1.0, retrograde: 0.18, antiTangent: 0.95 },
    touchdownReady: altitudeKm <= touchdownBandKm && Math.abs(radialSpeedKmS) < 0.03,
  };
}
