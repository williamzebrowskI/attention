import { REFUEL_TANKER_CONFIG } from "./config.js";

function resolveBandConfig(config = REFUEL_TANKER_CONFIG) {
  const strict = config?.strictDockingBandEnforced !== false;
  const minKm = Math.max(
    80,
    Number(config?.dockingBandMinAltitudeKm ?? config?.orbitHoldAltitudeMinKm ?? 150),
  );
  const maxKm = Math.max(
    minKm + 1,
    Number(config?.dockingBandMaxAltitudeKm ?? config?.orbitHoldAltitudeMaxKm ?? 160),
  );
  const stableSeconds = Math.max(0, Number(config?.dockingBandStableSeconds) || 0);
  const maxRadialSpeedKmS = Math.max(0.00001, Number(config?.dockingBandMaxRadialSpeedKmS) || 0.006);
  return {
    strict,
    minKm,
    maxKm,
    stableSeconds,
    maxRadialSpeedKmS,
  };
}

export function computeDockingBandState({
  flight,
  safeDtSeconds = 0,
  config = REFUEL_TANKER_CONFIG,
} = {}) {
  const band = resolveBandConfig(config);
  const altitudeKmRaw = Number(flight?.sensorAltitudeKm);
  const radialSpeedKmSRaw = Number(flight?.sensorRadialSpeedKmS);
  const altitudeKnown = Number.isFinite(altitudeKmRaw);
  const radialKnown = Number.isFinite(radialSpeedKmSRaw);
  const altitudeKm = altitudeKnown ? altitudeKmRaw : Number.NaN;
  const radialSpeedKmS = radialKnown ? radialSpeedKmSRaw : Number.NaN;
  const inBand = altitudeKnown && altitudeKm >= band.minKm && altitudeKm <= band.maxKm;
  const radialStable = radialKnown && Math.abs(radialSpeedKmS) <= band.maxRadialSpeedKmS;
  const safeDt = Math.max(0, Number(safeDtSeconds) || 0);
  const previousStableSec = Math.max(0, Number(flight?.dockBandStableSec) || 0);
  const nextStableSec = (inBand && radialStable)
    ? Math.min(band.stableSeconds, previousStableSec + safeDt)
    : 0;
  const available = !band.strict || ((inBand && radialStable) && nextStableSec + 1e-6 >= band.stableSeconds);
  return {
    strict: band.strict,
    minKm: band.minKm,
    maxKm: band.maxKm,
    stableSecondsRequired: band.stableSeconds,
    maxRadialSpeedKmS: band.maxRadialSpeedKmS,
    altitudeKm,
    radialSpeedKmS,
    inBand,
    radialStable,
    stableSec: nextStableSec,
    available,
  };
}

export function applyDockingBandState(flight, bandState = null) {
  if (!flight || !bandState) {
    return null;
  }
  flight.dockBandMinKm = Number(bandState.minKm);
  flight.dockBandMaxKm = Number(bandState.maxKm);
  flight.dockBandInRange = Boolean(bandState.inBand);
  flight.dockBandRadialStable = Boolean(bandState.radialStable);
  flight.dockBandStableSec = Math.max(0, Number(bandState.stableSec) || 0);
  flight.dockBandStableRequiredSec = Math.max(0, Number(bandState.stableSecondsRequired) || 0);
  flight.availableForDocking = Boolean(bandState.available);
  return bandState;
}

export function isFlightDockingEligible(flight, config = REFUEL_TANKER_CONFIG) {
  if (!flight) {
    return false;
  }
  const active = Boolean(flight.active);
  const altitudeKm = Number(flight.sensorAltitudeKm);
  const orbitalAltitudeKnown = Number.isFinite(altitudeKm);
  const inUsableEarthOrbit = orbitalAltitudeKnown
    && altitudeKm >= 120
    && altitudeKm <= 2000;
  if (active && inUsableEarthOrbit) {
    // Guidance-agnostic rendezvous eligibility: any active tanker in a sane LEO band is selectable.
    return true;
  }
  const strict = config?.strictDockingBandEnforced !== false;
  if (!strict) {
    return active;
  }
  const statusName = String(flight.status || "");
  if (statusName === "transferring" || statusName === "undocking") {
    return true;
  }
  return Boolean(flight.availableForDocking);
}
