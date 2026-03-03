import { STARSHIP_STACK_DIMENSIONS_KM } from "../launchConfig.js";

export const REFUEL_WINDOW_PHASES = new Set(["launch_to_parking", "orbital_refuel", "tli_burn"]);
export const REFUEL_TANKER_ID_PREFIX = "earth_refuel_tanker_";

export const REFUEL_TANKER_CONFIG = Object.freeze({
  requiredFlights: 2,
  transferPerFlightKg: 360_000,
  rendezvousSeconds: 16 * 60,
  targetFillFraction: 0.88,
  depotOrbitAltitudeKm: 155,
  depotOrbitInclinationDeg: 28.5,
  dockDistanceKm: 0.014,
  dockMaxRelativeSpeedKmS: 0.000045,
  dockStableSeconds: 8,
  transferDurationSec: 150,
  undockDurationSec: 40,
  undockSeparationSpeedKmS: 0.00042,
  dockLockedOffsetKm: Math.max(0.01, (Number(STARSHIP_STACK_DIMENSIONS_KM.diameterKm) || 0.009) * 1.15),
  shipDockAssistAccelKmS2: 0.00002,
  slotMaxDriftKm: 45,
  slotRecoveryApproachSpeedKmS: 0.012,
  slotRecoveryAccelKmS2: 0.00012,
  slotRecoveryResponseSec: 120,
  orbitHoldAltitudeMinKm: 150,
  orbitHoldAltitudeMaxKm: 160,
  orbitHoldTargetAltitudeKm: 155,
  orbitHoldResponseSec: 55,
  orbitHoldMaxAccelKmS2: 0.0012,
  orbitHoldMaxRadialSpeedKmS: 0.05,
  strictDockingBandEnforced: true,
  dockingBandMinAltitudeKm: 150,
  dockingBandMaxAltitudeKm: 160,
  dockingBandStableSeconds: 0,
  dockingBandMaxRadialSpeedKmS: 0.006,
});
