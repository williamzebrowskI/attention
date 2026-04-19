function finiteNumber(value, fallback = Number.NaN) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback);
}

export const MOON_PARKING_ORBIT_GATE_TOLERANCE_KM = Object.freeze({
  apoapsisKm: 5,
  periapsisKm: 40,
});

export function moonParkingOrbitReady(
  orbital,
  {
    parkingOrbitPeriapsisMinKm = 500,
    parkingOrbitApoapsisMinKm = 500,
    parkingOrbitToleranceKm = MOON_PARKING_ORBIT_GATE_TOLERANCE_KM,
  } = {},
) {
  const periapsisKm = finiteNumber(orbital?.periapsisKm, Number.NaN);
  const apoapsisKm = finiteNumber(orbital?.apoapsisKm, Number.NaN);
  const specificEnergy = finiteNumber(orbital?.specificEnergy, Number.POSITIVE_INFINITY);
  const periToleranceKm = Math.max(0, finiteNumber(parkingOrbitToleranceKm?.periapsisKm, 0));
  const apoToleranceKm = Math.max(0, finiteNumber(parkingOrbitToleranceKm?.apoapsisKm, 0));
  return specificEnergy < 0
    && apoapsisKm >= (Number(parkingOrbitApoapsisMinKm) - apoToleranceKm)
    && periapsisKm >= (Number(parkingOrbitPeriapsisMinKm) - periToleranceKm);
}
