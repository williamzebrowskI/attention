import { normalize } from "../launchMath.js";

const DEFAULT_AXIS = { x: 0, y: 0, z: 1 };

export function defaultFlightAttitudeTelemetry() {
  return {
    attitudeAxisKm: null,
    attitudeDesiredAxisKm: null,
    attitudeErrorDeg: 0,
    attitudeAuthority: 1,
    attitudeLimited: false,
    attitudeControlConeDeg: 0,
  };
}

export function defaultRefuelFlightRuntimeState(overrides = {}) {
  return {
    transferPlannedKg: 0,
    transferRemainingKg: 0,
    transferTransferredKg: 0,
    transferRateKgS: 0,
    transferDurationSec: 0,
    transferStartedElapsedSec: 0,
    undockDurationSec: 0,
    undockRemainingSec: 0,
    dockBandStableSec: 0,
    dockBandInRange: false,
    dockBandRadialStable: false,
    availableForDocking: false,
    shipRcsActive: false,
    shipRcsMode: "",
    shipRcsAuthority: 0,
    shipRcsJets: [],
    ...defaultFlightAttitudeTelemetry(),
    ...overrides,
  };
}

export function normalizeFiniteAxis(axisCandidate, fallbackAxis = DEFAULT_AXIS) {
  const source = axisCandidate && typeof axisCandidate === "object"
    ? axisCandidate
    : fallbackAxis;
  const normalized = normalize(source, fallbackAxis);
  if (
    Number.isFinite(Number(normalized?.x))
    && Number.isFinite(Number(normalized?.y))
    && Number.isFinite(Number(normalized?.z))
  ) {
    return normalized;
  }
  return normalize(fallbackAxis, DEFAULT_AXIS);
}

export function resetFlightAttitudeTelemetry(flight, axisCandidate = null, fallbackAxis = DEFAULT_AXIS) {
  if (!flight || typeof flight !== "object") {
    return null;
  }
  const baseAxis = normalizeFiniteAxis(
    axisCandidate || flight.attitudeAxisKm || fallbackAxis,
    fallbackAxis,
  );
  flight.attitudeAxisKm = baseAxis;
  flight.attitudeDesiredAxisKm = baseAxis;
  flight.attitudeErrorDeg = 0;
  flight.attitudeAuthority = 1;
  flight.attitudeLimited = false;
  flight.attitudeControlConeDeg = 0;
  return baseAxis;
}
