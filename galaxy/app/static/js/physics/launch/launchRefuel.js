import { add, clamp, normalize, scale, subtract } from "./launchMath.js";
import { STARSHIP_STACK_DIMENSIONS_KM } from "./launchConfig.js";
import { LAUNCH_MISSION_IDS } from "./launchMissions.js";
import {
  REFUEL_TANKER_CONFIG,
  REFUEL_TANKER_ID_PREFIX,
  REFUEL_WINDOW_PHASES,
} from "./refuel/config.js";
import {
  applyDockingBandState,
  computeDockingBandState,
  isFlightDockingEligible,
} from "./refuel/availability.js";
import {
  refuelFlightOffsetKm,
  rendezvousMetrics,
  tankerOrbitHoldCommand,
  tankerRcsJetsFromCommand,
} from "./refuel/guidance.js";
import {
  clampVectorMagnitude,
  vectorDot,
  vectorMagnitude,
} from "./refuel/math.js";
import { applyAttitudeLimitedAcceleration } from "./refuel/attitude.js";
import {
  defaultFlightAttitudeTelemetry,
  defaultRefuelFlightRuntimeState,
  normalizeFiniteAxis,
  resetFlightAttitudeTelemetry,
} from "./refuel/flightState.js";
import {
  finiteNonNegative,
  normalizedTargetFillFraction,
} from "./refuel/status.js";

export { REFUEL_TANKER_CONFIG };

function defaultTankerMeta({ id, sequenceNumber, massKg }) {
  const ordinal = Math.max(1, Number(sequenceNumber) || 1);
  return {
    id,
    name: `Starship Tanker ${ordinal}`,
    body_type: "spacecraft",
    parent: "earth",
    radius_km: 0.0045,
    mass_kg: Math.max(1, Number(massKg) || 340_000),
    semimajor_axis_km: null,
    orbital_period_days: null,
    phase: 0,
    description: "Reusable orbital tanker Starship used for in-space propellant transfer.",
  };
}

function buildTankerIdentity(state, runtime) {
  let sequenceNumber = Math.max(1, Number(runtime?.refuel?.nextGeneratedId) || 1);
  const flights = Array.isArray(runtime?.refuel?.flights) ? runtime.refuel.flights : [];
  while (sequenceNumber < 1_000_000_000) {
    const id = `${REFUEL_TANKER_ID_PREFIX}${sequenceNumber}`;
    const inDynamics = Boolean(state?.dynamicBodies?.has?.(id));
    const inActiveFlight = flights.some((flight) => flight?.active && String(flight?.id || "") === id);
    if (!inDynamics && !inActiveFlight) {
      runtime.refuel.nextGeneratedId = sequenceNumber + 1;
      return { id, sequenceNumber };
    }
    sequenceNumber += 1;
  }
  return null;
}

export function refuelDefaults({
  targetPropellantKg = 0,
  config = REFUEL_TANKER_CONFIG,
} = {}) {
  return {
    requiredFlights: finiteNonNegative(config.requiredFlights),
    transferPerFlightKg: finiteNonNegative(config.transferPerFlightKg),
    rendezvousSeconds: Math.max(60, Number(config.rendezvousSeconds) || (12 * 60)),
    targetFillFraction: normalizedTargetFillFraction(config.targetFillFraction),
    launchedFlights: 0,
    completedFlights: 0,
    activeFlights: 0,
    targetPropellantKg: finiteNonNegative(targetPropellantKg),
    nextSlot: 0,
    nextGeneratedId: 1,
    flights: [],
    consumedTankerIds: [],
    transferActive: false,
    transferTankerId: "",
    transferProgress: 0,
    transferRemainingKg: 0,
    transferRateKgS: 0,
    transferStartedElapsedSec: 0,
    undockActive: false,
    undockTankerId: "",
    lastAction: "",
    lastActionTimeSec: 0,
  };
}

export function resolveRefuelTargetKg(refuelState, stage2CapacityKg = 0) {
  const capacityKg = finiteNonNegative(stage2CapacityKg);
  if (!(capacityKg > 0)) {
    return 0;
  }
  const configuredTarget = Number(refuelState?.targetPropellantKg);
  if (Number.isFinite(configuredTarget) && configuredTarget > 0) {
    return Math.min(configuredTarget, capacityKg);
  }
  if (refuelState && typeof refuelState === "object") {
    refuelState.targetPropellantKg = capacityKg;
  }
  return capacityKg;
}

export function computeRefuelFillFraction(stagePropellantKg, targetPropellantKg) {
  const targetKg = finiteNonNegative(targetPropellantKg);
  if (!(targetKg > 1e-6)) {
    return 0;
  }
  return clamp(finiteNonNegative(stagePropellantKg) / targetKg, 0, 1);
}

export function computeRefuelStatus({
  runtime,
  missionIdMoonOrbitReturn,
  missionIdsRefuelEligible = null,
  stage2CapacityKg,
  config = REFUEL_TANKER_CONFIG,
} = {}) {
  const missionIdSet = new Set(
    (Array.isArray(missionIdsRefuelEligible) && missionIdsRefuelEligible.length > 0
      ? missionIdsRefuelEligible
      : [missionIdMoonOrbitReturn]
    )
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  );
  const selectedMissionId = String(runtime?.mission?.selectedId || "").trim();
  const targetPropellantKg = resolveRefuelTargetKg(runtime?.refuel, stage2CapacityKg);
  const fillFraction = computeRefuelFillFraction(runtime?.stagePropellantKg, targetPropellantKg);
  const requiredFlights = finiteNonNegative(runtime?.refuel?.requiredFlights);
  const completedFlights = finiteNonNegative(runtime?.refuel?.completedFlights);
  const activeFlights = finiteNonNegative(runtime?.refuel?.activeFlights);
  const launchedFlights = finiteNonNegative(runtime?.refuel?.launchedFlights);
  const missionPhase = String(runtime?.mission?.phase || "");
  const refuelWindowOpen =
    missionIdSet.has(selectedMissionId)
    && String(runtime?.phase || "") !== "idle"
    && Number(runtime?.stageIndex) === 1
    && REFUEL_WINDOW_PHASES.has(missionPhase);
  const targetFillFraction = normalizedTargetFillFraction(
    runtime?.refuel?.targetFillFraction,
    config.targetFillFraction,
  );
  const refuelComplete = fillFraction >= targetFillFraction;
  const flights = Array.isArray(runtime?.refuel?.flights) ? runtime.refuel.flights : [];
  let activeFlight = null;
  let transferFlight = null;
  for (let i = 0; i < flights.length; i += 1) {
    const flight = flights[i];
    if (!flight?.active || !flight.id) {
      continue;
    }
    if (String(flight.status || "") === "transferring") {
      transferFlight = flight;
      break;
    }
    if (!activeFlight) {
      activeFlight = flight;
    }
  }
  const selectedFlight = transferFlight || activeFlight || null;
  const transferPlannedKg = Math.max(0, Number(selectedFlight?.transferPlannedKg) || Number(selectedFlight?.transferKg) || 0);
  const transferRemainingKg = Math.max(0, Number(selectedFlight?.transferRemainingKg) || 0);
  const transferTransferredKg = Math.max(0, Number(selectedFlight?.transferTransferredKg) || 0);
  const transferProgressRaw = transferPlannedKg > 1e-6
    ? transferTransferredKg / transferPlannedKg
    : 0;
  const transferProgress = clamp(
    Number.isFinite(Number(runtime?.refuel?.transferProgress))
      ? Number(runtime.refuel.transferProgress)
      : transferProgressRaw,
    0,
    1,
  );
  const transferActive = Boolean(
    runtime?.refuel?.transferActive
    || String(selectedFlight?.status || "") === "transferring",
  );
  const undockActive = Boolean(
    runtime?.refuel?.undockActive
    || String(selectedFlight?.status || "") === "undocking",
  );
  const transferTankerId = String(
    runtime?.refuel?.transferTankerId
    || runtime?.refuel?.undockTankerId
    || selectedFlight?.id
    || "",
  );
  return {
    targetPropellantKg,
    fillFraction,
    requiredFlights,
    completedFlights,
    activeFlights,
    launchedFlights,
    refuelWindowOpen,
    refuelComplete,
    refuelCanLaunchTanker: refuelWindowOpen && !refuelComplete,
    activeFlightId: String(selectedFlight?.id || ""),
    activeFlightStatus: String(selectedFlight?.status || ""),
    activeFlightDistanceKm: Number(selectedFlight?.lastDistanceKm),
    activeFlightRelativeSpeedKmS: Number(selectedFlight?.lastRelativeSpeedKmS),
    transferActive,
    transferTankerId,
    transferProgress,
    transferRemainingKg: Math.max(
      0,
      Number.isFinite(Number(runtime?.refuel?.transferRemainingKg))
        ? Number(runtime.refuel.transferRemainingKg)
        : transferRemainingKg,
    ),
    transferRateKgS: Math.max(
      0,
      Number.isFinite(Number(runtime?.refuel?.transferRateKgS))
        ? Number(runtime.refuel.transferRateKgS)
        : (Number(selectedFlight?.transferRateKgS) || 0),
    ),
    transferLocked: transferActive || String(selectedFlight?.status || "") === "docked_locked",
    undockActive,
    shipRcsActive: Boolean(selectedFlight?.shipRcsActive),
    shipRcsAuthority: clamp(Number(selectedFlight?.shipRcsAuthority) || 0, 0, 1),
    shipRcsJets: Array.isArray(selectedFlight?.shipRcsJets) ? selectedFlight.shipRcsJets : [],
    shipRcsMode: String(selectedFlight?.shipRcsMode || ""),
  };
}

export function createLaunchRefuelController({
  runtime,
  missionIdMoonOrbitReturn,
  missionIdsRefuelEligible = null,
  stage2CapacityKg,
  stage2DryMassKg,
  getEarthRadiusKm,
  getEarthMassKg,
  gravitationalConstantKm3PerKgS2,
  minRocketMassKg,
  rocketStateFromNBody,
  earthStateFromNBody,
  finiteVector,
  emitLaunchEvent,
  buildTankerMeta,
  config = REFUEL_TANKER_CONFIG,
} = {}) {
  const refuelEligibleMissionIds = new Set(
    (Array.isArray(missionIdsRefuelEligible) && missionIdsRefuelEligible.length > 0
      ? missionIdsRefuelEligible
      : [missionIdMoonOrbitReturn]
    )
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  );

  function missionIdSupportsRefuel(missionId) {
    return refuelEligibleMissionIds.has(String(missionId || "").trim());
  }

  function consumedTankerIdsSet() {
    const ids = Array.isArray(runtime?.refuel?.consumedTankerIds)
      ? runtime.refuel.consumedTankerIds
      : [];
    const set = new Set();
    for (let i = 0; i < ids.length; i += 1) {
      const id = String(ids[i] || "").trim();
      if (id) {
        set.add(id);
      }
    }
    return set;
  }

  function markTankerConsumed(tankerId) {
    const id = String(tankerId || "").trim();
    if (!id) {
      return;
    }
    const existing = consumedTankerIdsSet();
    if (existing.has(id)) {
      return;
    }
    existing.add(id);
    runtime.refuel.consumedTankerIds = Array.from(existing);
  }

  function recalcRefuelFlightCounts() {
    const flights = Array.isArray(runtime?.refuel?.flights) ? runtime.refuel.flights : [];
    runtime.refuel.activeFlights = flights.reduce((count, flight) => (
      flight?.active ? count + 1 : count
    ), 0);
    return runtime.refuel.activeFlights;
  }

  function makeTankerMeta(identity, massKg) {
    if (typeof buildTankerMeta === "function") {
      const customMeta = buildTankerMeta({
        id: identity.id,
        sequenceNumber: identity.sequenceNumber,
        massKg,
      });
      if (customMeta && typeof customMeta === "object" && String(customMeta.id || "") === identity.id) {
        return customMeta;
      }
    }
    return defaultTankerMeta({
      id: identity.id,
      sequenceNumber: identity.sequenceNumber,
      massKg,
    });
  }

  function resetRefuelState() {
    runtime.refuel = {
      ...runtime.refuel,
      ...refuelDefaults({
        targetPropellantKg: stage2CapacityKg?.() || 0,
        config,
      }),
    };
    recalcRefuelFlightCounts();
    return runtime.refuel;
  }

  function applyMissionProfile(missionId) {
    const normalizedMissionId = String(missionId || "");
    const refuelMissionRequiredFlights = missionIdSupportsRefuel(normalizedMissionId)
      ? (
        normalizedMissionId === LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO
          ? 1
          : Math.max(1, finiteNonNegative(config.requiredFlights))
      )
      : 0;
    runtime.refuel = {
      ...runtime.refuel,
      ...refuelDefaults({
        targetPropellantKg: stage2CapacityKg?.() || 0,
        config,
      }),
      requiredFlights: refuelMissionRequiredFlights,
      targetPropellantKg: finiteNonNegative(stage2CapacityKg?.() || 0),
    };
    recalcRefuelFlightCounts();
    return runtime.refuel;
  }

  function clearRefuelTankersFromState(state) {
    const trackedFlights = Array.isArray(runtime.refuel.flights) ? runtime.refuel.flights : [];
    for (let i = 0; i < trackedFlights.length; i += 1) {
      const flightId = String(trackedFlights[i]?.id || "");
      if (!flightId) {
        continue;
      }
      state?.dynamicBodies?.delete?.(flightId);
    }
    resetRefuelState();
  }

  function removeTankerById(state, tankerId, options = {}) {
    const id = String(tankerId || "").trim();
    if (!id) {
      return false;
    }
    const preserveDynamicBody = options?.preserveDynamicBody === true;
    if (!preserveDynamicBody) {
      state?.dynamicBodies?.delete?.(id);
    }

    const flights = Array.isArray(runtime?.refuel?.flights) ? runtime.refuel.flights : [];
    const nextFlights = flights.filter((flight) => String(flight?.id || "") !== id);
    const removedFlight = nextFlights.length !== flights.length;
    if (removedFlight) {
      runtime.refuel.flights = nextFlights;
    }

    const transferMatch = String(runtime?.refuel?.transferTankerId || "") === id;
    const undockMatch = String(runtime?.refuel?.undockTankerId || "") === id;
    if (transferMatch) {
      runtime.refuel.transferActive = false;
      runtime.refuel.transferTankerId = "";
      runtime.refuel.transferProgress = 0;
      runtime.refuel.transferRemainingKg = 0;
      runtime.refuel.transferRateKgS = 0;
    }
    if (undockMatch) {
      runtime.refuel.undockActive = false;
      runtime.refuel.undockTankerId = "";
    }
    if (removedFlight || transferMatch || undockMatch) {
      runtime.refuel.lastAction = "tanker_removed";
      runtime.refuel.lastActionTimeSec = Number(runtime.elapsedSeconds) || 0;
    }
    if (removedFlight) {
      markTankerConsumed(id);
    }
    recalcRefuelFlightCounts();
    return removedFlight || transferMatch || undockMatch;
  }

  function isMoonMissionRefuelActive() {
    return missionIdSupportsRefuel(runtime?.mission?.selectedId);
  }

  function syncExternalOrbitTankers(state, nowMs = Date.now()) {
    if (!isMoonMissionRefuelActive() || !state?.dynamicBodies) {
      return 0;
    }
    runtime.refuel.flights = Array.isArray(runtime.refuel.flights) ? runtime.refuel.flights : [];
    const existingFlightsById = new Map();
    for (let i = 0; i < runtime.refuel.flights.length; i += 1) {
      const flight = runtime.refuel.flights[i];
      const flightId = String(flight?.id || "").trim();
      if (!flightId) {
        continue;
      }
      existingFlightsById.set(flightId, flight);
    }
    const consumedIds = consumedTankerIdsSet();
    const targetPropellantKg = resolveRefuelTargetKg(runtime.refuel, stage2CapacityKg?.() || 0);
    const stagePropellantKg = Math.max(0, Number(runtime.stagePropellantKg) || 0);
    const transferBaseKg = Math.max(0, Number(runtime.refuel.transferPerFlightKg) || 0);
    const propellantDeficitKg = Math.max(0, targetPropellantKg - stagePropellantKg);
    let slot = Math.max(0, Number(runtime.refuel.nextSlot) || 0);
    let addedCount = 0;
    let reactivatedCount = 0;

    for (const [bodyId, tankerState] of state.dynamicBodies.entries()) {
      const tankerId = String(bodyId || "").trim();
      if (!tankerId.startsWith(REFUEL_TANKER_ID_PREFIX)) {
        continue;
      }
      if (consumedIds.has(tankerId)) {
        continue;
      }
      if (
        !finiteVector?.(tankerState?.position)
        || !finiteVector?.(tankerState?.velocity || { x: 0, y: 0, z: 0 })
      ) {
        continue;
      }
      const transferKg = transferBaseKg > 1e-6
        ? transferBaseKg
        : Math.max(0, propellantDeficitKg);
      const existingFlight = existingFlightsById.get(tankerId) || null;
      if (existingFlight) {
        if (!existingFlight.active) {
          existingFlight.active = true;
          if (
            !existingFlight.status
            || existingFlight.status === "completed"
            || existingFlight.status === "invalid"
          ) {
            existingFlight.status = "external_orbit";
          }
          existingFlight.completedElapsedSec = 0;
          Object.assign(existingFlight, defaultRefuelFlightRuntimeState({
            attitudeAxisKm: existingFlight.attitudeAxisKm || null,
          }));
          reactivatedCount += 1;
        }
        if (!(Number(existingFlight.transferKg) > 1e-6)) {
          existingFlight.transferKg = transferKg;
        }
        if (!Number.isFinite(Number(existingFlight.launchTimestampMs))) {
          existingFlight.launchTimestampMs = nowMs;
        }
        if (!Number.isFinite(Number(existingFlight.launchedElapsedSec))) {
          existingFlight.launchedElapsedSec = runtime.elapsedSeconds;
        }
        if (!Number.isFinite(Number(existingFlight.slot))) {
          existingFlight.slot = slot;
          slot += 1;
        }
        continue;
      }
      runtime.refuel.flights.push({
        id: tankerId,
        slot,
        active: true,
        status: "external_orbit",
        launchedElapsedSec: runtime.elapsedSeconds,
        launchTimestampMs: nowMs,
        transferKg,
        ...defaultRefuelFlightRuntimeState(),
      });
      existingFlightsById.set(tankerId, runtime.refuel.flights[runtime.refuel.flights.length - 1]);
      slot += 1;
      addedCount += 1;
      emitLaunchEvent?.("refuel_tanker_registered", {
        tankerId,
        mode: "external_orbit",
        transferKg,
      });
    }

    if (addedCount > 0 || reactivatedCount > 0) {
      runtime.refuel.nextSlot = slot;
      runtime.refuel.lastAction = reactivatedCount > 0
        ? "external_tanker_reactivated"
        : "external_tanker_registered";
      runtime.refuel.lastActionTimeSec = runtime.elapsedSeconds;
      recalcRefuelFlightCounts();
    }
    return addedCount + reactivatedCount;
  }

  function refuelLaunchEligibility(state) {
    if (!isMoonMissionRefuelActive()) {
      return { ok: false, reason: "moon_mission_required" };
    }
    if (runtime.phase === "idle") {
      return { ok: false, reason: "launch_not_active" };
    }
    if (runtime.stageIndex < 1) {
      return { ok: false, reason: "stage2_not_ready" };
    }
    if (runtime.stageIndex > 1) {
      return { ok: false, reason: "stage2_expended" };
    }
    const refuelStatus = computeRefuelStatus({
      runtime,
      missionIdMoonOrbitReturn,
      missionIdsRefuelEligible: Array.from(refuelEligibleMissionIds),
      stage2CapacityKg: stage2CapacityKg?.() || 0,
      config,
    });
    if (!refuelStatus.refuelWindowOpen) {
      return { ok: false, reason: "mission_phase_not_refuel_window" };
    }
    const rocketState = rocketStateFromNBody?.(state);
    const earthState = earthStateFromNBody?.(state);
    if (!rocketState || !earthState) {
      return { ok: false, reason: "state_unavailable" };
    }
    if (refuelStatus.refuelComplete) {
      return { ok: false, reason: "refuel_already_complete" };
    }
    return { ok: true, rocketState, earthState, refuelStatus };
  }

  function launchDepotTanker(state, nowMs = Date.now()) {
    if (!state?.dynamicBodies) {
      return { accepted: false, reason: "state_unavailable" };
    }
    const earthState = earthStateFromNBody?.(state);
    if (
      !earthState
      || !finiteVector?.(earthState.position)
      || !finiteVector?.(earthState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      return { accepted: false, reason: "earth_state_unavailable" };
    }
    const identity = buildTankerIdentity(state, runtime);
    if (!identity) {
      return { accepted: false, reason: "tanker_id_exhausted" };
    }
    const earthRadiusKm = Math.max(1000, Number(getEarthRadiusKm?.()) || 6371);
    const orbitMinAltitudeKm = Math.max(120, Number(config.orbitHoldAltitudeMinKm) || 150);
    const orbitMaxAltitudeKm = Math.max(
      orbitMinAltitudeKm + 0.1,
      Number(config.orbitHoldAltitudeMaxKm) || Math.max(160, Number(config.depotOrbitAltitudeKm) || 160),
    );
    const orbitAltitudeKm = orbitMinAltitudeKm
      + (Math.random() * Math.max(0, orbitMaxAltitudeKm - orbitMinAltitudeKm));
    const orbitRadiusKm = earthRadiusKm + orbitAltitudeKm;
    const muKm3S2 = Number(gravitationalConstantKm3PerKgS2) * (Number(getEarthMassKg?.()) || 0);
    if (!(muKm3S2 > 0)) {
      return { accepted: false, reason: "earth_gravity_unavailable" };
    }
    const circularSpeedKmS = Math.sqrt(muKm3S2 / orbitRadiusKm);
    const incRad = (Math.PI / 180) * (Number(config.depotOrbitInclinationDeg) || 28.5);
    const slot = Math.max(0, Number(runtime.refuel.nextSlot) || 0);
    const phaseAngle = Math.random() * (Math.PI * 2);
    const cTheta = Math.cos(phaseAngle);
    const sTheta = Math.sin(phaseAngle);
    const cInc = Math.cos(incRad);
    const sInc = Math.sin(incRad);
    const relPos = {
      x: orbitRadiusKm * cTheta,
      y: orbitRadiusKm * sTheta * cInc,
      z: orbitRadiusKm * sTheta * sInc,
    };
    const relVelDir = normalize(
      {
        x: -sTheta,
        y: cTheta * cInc,
        z: cTheta * sInc,
      },
      { x: 0, y: 1, z: 0 },
    );
    const relVel = scale(relVelDir, circularSpeedKmS);
    const dryMassKg = Math.max(10_000, Number(stage2DryMassKg?.()) || 120_000);
    const transferKg = Math.max(0, Number(runtime.refuel.transferPerFlightKg) || 0);
    const tankerMassKg = dryMassKg + transferKg;
    const tankerMeta = makeTankerMeta(identity, tankerMassKg);
    const tankerState = {
      id: identity.id,
      massKg: tankerMassKg,
      position: add(earthState.position, relPos),
      velocity: add(earthState.velocity || { x: 0, y: 0, z: 0 }, relVel),
    };
    state.dynamicBodies.set(identity.id, tankerState);
    runtime.refuel.nextSlot = slot + 1;
    runtime.refuel.lastAction = "tanker_depot_launched";
    runtime.refuel.lastActionTimeSec = runtime.elapsedSeconds;
    emitLaunchEvent?.("refuel_tanker_launched", {
      tankerId: identity.id,
      mode: "depot_orbit",
      launchTimestampMs: nowMs,
      orbitAltitudeKm,
      inclinationDeg: Number(config.depotOrbitInclinationDeg) || 28.5,
      dockReadyInject: false,
      dockReadyDistanceKm: null,
    });
    return {
      accepted: true,
      tankerId: identity.id,
      tankerMeta,
      mode: "depot_orbit",
      orbitAltitudeKm,
      dockReadyInject: false,
      dockReadyDistanceKm: null,
    };
  }

  function updateRefuelFlights(state, earthState, dtSeconds = 0) {
    if (!state?.dynamicBodies || !earthState || !isMoonMissionRefuelActive()) {
      runtime.refuel.transferActive = false;
      runtime.refuel.transferTankerId = "";
      runtime.refuel.transferProgress = 0;
      runtime.refuel.transferRemainingKg = 0;
      runtime.refuel.transferRateKgS = 0;
      runtime.refuel.undockActive = false;
      runtime.refuel.undockTankerId = "";
      return;
    }
    syncExternalOrbitTankers(state);
    if (!Array.isArray(runtime.refuel.flights) || runtime.refuel.flights.length <= 0) {
      runtime.refuel.activeFlights = 0;
      runtime.refuel.transferActive = false;
      runtime.refuel.transferTankerId = "";
      runtime.refuel.transferProgress = 0;
      runtime.refuel.transferRemainingKg = 0;
      runtime.refuel.transferRateKgS = 0;
      runtime.refuel.undockActive = false;
      runtime.refuel.undockTankerId = "";
      return;
    }
    const rocketState = rocketStateFromNBody?.(state);
    if (
      !rocketState
      || !finiteVector?.(rocketState.position)
      || !finiteVector?.(rocketState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      recalcRefuelFlightCounts();
      runtime.refuel.transferActive = false;
      runtime.refuel.transferTankerId = "";
      runtime.refuel.transferProgress = 0;
      runtime.refuel.transferRemainingKg = 0;
      runtime.refuel.transferRateKgS = 0;
      runtime.refuel.undockActive = false;
      runtime.refuel.undockTankerId = "";
      return;
    }
    const transferTargetKg = resolveRefuelTargetKg(runtime.refuel, stage2CapacityKg?.() || 0);
    const dryMassKg = Math.max(10_000, Number(stage2DryMassKg?.()) || 120_000);
    const dockDistanceKm = Math.max(0.005, Number(config.dockDistanceKm) || 0.014);
    const dockMaxRelativeSpeedKmS = Math.max(0.00002, Number(config.dockMaxRelativeSpeedKmS) || 0.000045);
    const dockStableSeconds = Math.max(2, Number(config.dockStableSeconds) || 8);
    const maxDockLockOffsetKm = Math.max(
      0.02,
      (Number(STARSHIP_STACK_DIMENSIONS_KM.diameterKm) || 0.009) * 2.5,
    );
    const earthRadiusKm = Math.max(1000, Number(getEarthRadiusKm?.()) || 6371);
    const earthMuKm3S2 = Number(gravitationalConstantKm3PerKgS2)
      * (Number(getEarthMassKg?.()) || Number(earthState.massKg) || 0);
    const safeDtSeconds = Math.max(0, Number(dtSeconds) || 0);
    // Let orbital hold corrections scale with sim timestep; capping at 1s under-corrects heavily at time acceleration.
    const rcsDtSeconds = Math.min(safeDtSeconds, 8);
    const earthVelocity = earthState.velocity || { x: 0, y: 0, z: 0 };
    const rocketRelPos = subtract(rocketState.position, earthState.position);
    const rocketRelVel = subtract(rocketState.velocity || { x: 0, y: 0, z: 0 }, earthVelocity);
    const zeroVector = { x: 0, y: 0, z: 0 };
    const transferOrUndockTankerId = String(
      runtime.refuel.transferTankerId || runtime.refuel.undockTankerId || "",
    ).trim();
    let activeRendezvousTankerId = transferOrUndockTankerId;
    if (!activeRendezvousTankerId) {
      const rendezvousTarget = activeRendezvousTarget(state);
      activeRendezvousTankerId = String(rendezvousTarget?.tankerId || "").trim();
    }
    runtime.refuel.activeRendezvousTankerId = activeRendezvousTankerId;

    runtime.refuel.transferActive = false;
    runtime.refuel.transferTankerId = "";
    runtime.refuel.transferProgress = 0;
    runtime.refuel.transferRemainingKg = 0;
    runtime.refuel.transferRateKgS = 0;
    runtime.refuel.undockActive = false;
    runtime.refuel.undockTankerId = "";

    for (let i = 0; i < runtime.refuel.flights.length; i += 1) {
      const flight = runtime.refuel.flights[i];
      if (!flight || !flight.id) {
        continue;
      }
      const tankerState = state.dynamicBodies.get(flight.id);
      if (!tankerState) {
        flight.active = false;
        continue;
      }
      if (!flight.active) {
        continue;
      }
      if (!flight.status) {
        flight.status = "rendezvous";
      }
      tankerState.massKg = dryMassKg + (Number(flight.transferKg) || 0);
      flight.shipRcsActive = false;
      flight.shipRcsMode = "";
      flight.shipRcsAuthority = 0;
      flight.shipRcsJets = [];

      const metrics = rendezvousMetrics(rocketState, tankerState);
      if (!metrics) {
        flight.rcsActive = false;
        flight.rcsMode = "invalid";
        flight.rcsAuthority = 0;
        flight.rcsAccelKmS2 = 0;
        flight.rcsDeltaVKmS = 0;
        flight.verticalErrorKm = 0;
        flight.verticalRateKmS = 0;
        flight.rcsJets = [];
        flight.dockBandStableSec = 0;
        flight.dockBandInRange = false;
        flight.dockBandRadialStable = false;
        flight.availableForDocking = false;
        Object.assign(flight, defaultFlightAttitudeTelemetry());
        continue;
      }
      const sensedDistanceKm = Number.isFinite(Number(metrics.distanceKm))
        ? Math.max(0, Number(metrics.distanceKm))
        : Math.max(0, Number(flight.lastDistanceKm) || 0);
      const sensedRelativeSpeedKmS = Number.isFinite(Number(metrics.relativeSpeedKmS))
        ? Math.max(0, Number(metrics.relativeSpeedKmS))
        : Math.max(0, Number(flight.lastRelativeSpeedKmS) || 0);
      const sensedClosingSpeedKmS = Number.isFinite(Number(metrics.closingSpeedKmS))
        ? Number(metrics.closingSpeedKmS)
        : Number(flight.lastClosingSpeedKmS) || 0;
      flight.sensorDistanceKm = sensedDistanceKm;
      flight.sensorRelativeSpeedKmS = sensedRelativeSpeedKmS;
      flight.sensorClosingSpeedKmS = sensedClosingSpeedKmS;

      const tankerRelPos = subtract(tankerState.position, earthState.position);
      const localUp = normalize(tankerRelPos, { x: 0, y: 0, z: 1 });
      const rocketRelPosForLock = subtract(rocketState.position, earthState.position);
      const dockLockUp = normalize(rocketRelPosForLock, localUp);
      const rocketVelocityNow = rocketState.velocity || zeroVector;
      const tankerRelVel = subtract(tankerState.velocity || zeroVector, earthVelocity);
      const relVelToRocket = subtract(tankerState.velocity || zeroVector, rocketVelocityNow);
      const tankerTangentialVel = subtract(tankerRelVel, scale(localUp, vectorDot(tankerRelVel, localUp)));
      const fallbackAttitudeAxisKm = normalizeFiniteAxis(
        vectorMagnitude(tankerTangentialVel) > 1e-9 ? tankerTangentialVel : localUp,
        localUp,
      );
      resetFlightAttitudeTelemetry(
        flight,
        normalizeFiniteAxis(flight.attitudeAxisKm, fallbackAttitudeAxisKm),
        fallbackAttitudeAxisKm,
      );

      function resolveTankerAttitudeCommand(commandedAccelKmS2) {
        const constrained = applyAttitudeLimitedAcceleration({
          commandedAccelKmS2,
          currentAxisKm: flight.attitudeAxisKm,
          fallbackAxisKm: fallbackAttitudeAxisKm,
          dtSeconds: rcsDtSeconds,
          maxTurnRateDegPerSec: Number(config.attitudeSlewRateDegPerSec) || 22,
          controlConeDeg: Number(config.attitudeControlConeDeg) || 28,
          freeAxisAccelKmS2: Number(config.attitudeFreeAxisAccelKmS2) || 0.00008,
          freeConeDeg: Number(config.attitudeFreeConeDeg) || 82,
        });
        flight.attitudeAxisKm = normalizeFiniteAxis(constrained.thrustAxisKm, fallbackAttitudeAxisKm);
        flight.attitudeDesiredAxisKm = normalizeFiniteAxis(constrained.desiredAxisKm, flight.attitudeAxisKm);
        flight.attitudeErrorDeg = Math.max(0, Number(constrained.attitudeErrorDeg) || 0);
        flight.attitudeAuthority = clamp(Number(constrained.attitudeAuthority) || 0, 0, 1);
        flight.attitudeLimited = Boolean(constrained.attitudeLimited);
        flight.attitudeControlConeDeg = Math.max(0, Number(constrained.controlConeDeg) || 0);
        return constrained.appliedAccelKmS2;
      }
      const orbitHold = tankerOrbitHoldCommand({
        tankerState,
        earthState,
        earthRadiusKm,
        earthMuKm3S2,
        config,
      });
      if (orbitHold) {
        flight.sensorAltitudeKm = orbitHold.altitudeKm;
        flight.sensorRadialSpeedKmS = orbitHold.radialSpeedKmS;
        flight.sensorTangentialSpeedKmS = orbitHold.tangentialSpeedKmS;
      } else {
        const tankerRadiusKm = vectorMagnitude(tankerRelPos);
        const tankerRadialSpeedKmS = vectorDot(tankerRelVel, localUp);
        const tankerTangentialSpeedKmS = vectorMagnitude(
          subtract(tankerRelVel, scale(localUp, tankerRadialSpeedKmS)),
        );
        flight.sensorAltitudeKm = Math.max(0, tankerRadiusKm - earthRadiusKm);
        flight.sensorRadialSpeedKmS = tankerRadialSpeedKmS;
        flight.sensorTangentialSpeedKmS = tankerTangentialSpeedKmS;
      }
      applyDockingBandState(
        flight,
        computeDockingBandState({
          flight,
          safeDtSeconds,
          config,
        }),
      );
      const statusName = String(flight.status || "");
      const isTransferingOrUndocking = statusName === "transferring" || statusName === "undocking";
      const dockingEligible = isFlightDockingEligible(flight, config);
      const shouldCommandTanker = isTransferingOrUndocking
        || (String(flight.id) === activeRendezvousTankerId && dockingEligible);
      if (!shouldCommandTanker) {
        flight.status = "external_orbit";
        if (orbitHold) {
          const holdAppliedAccelKmS2 = resolveTankerAttitudeCommand(orbitHold.commandedAccelKmS2);
          const holdDeltaV = scale(holdAppliedAccelKmS2, rcsDtSeconds);
          if (rcsDtSeconds > 0 && vectorMagnitude(holdDeltaV) > 0) {
            tankerState.velocity = add(tankerState.velocity || zeroVector, holdDeltaV);
          }
          const holdAccelMagKmS2 = vectorMagnitude(holdAppliedAccelKmS2);
          const holdDeltaVMagKmS = vectorMagnitude(holdDeltaV);
          flight.rcsActive = holdAccelMagKmS2 > 1e-10;
          flight.rcsMode = flight.attitudeLimited
            ? `${orbitHold.mode}-attitude-limit`
            : orbitHold.mode;
          flight.rcsAuthority = clamp(
            holdAccelMagKmS2 / Math.max(orbitHold.maxAccelKmS2, 1e-9),
            0,
            1,
          );
          flight.rcsAccelKmS2 = holdAccelMagKmS2;
          flight.rcsDeltaVKmS = holdDeltaVMagKmS;
          flight.verticalErrorKm = Number.isFinite(Number(orbitHold.targetAltitudeKm))
            ? (Number(orbitHold.targetAltitudeKm) - Number(orbitHold.altitudeKm))
            : 0;
          flight.verticalRateKmS = Number(orbitHold.radialSpeedKmS) || 0;
          flight.rcsJets = flight.rcsActive
            ? tankerRcsJetsFromCommand({
              commandedAccelKmS2: holdAppliedAccelKmS2,
              localUp: orbitHold.localUp,
              tankerRelVel,
              relVelToRocket,
              verticalErrorKm: flight.verticalErrorKm,
              thresholdKmS2: Math.max(1e-8, orbitHold.maxAccelKmS2 * 0.12),
            })
            : [];
        } else {
          flight.rcsActive = false;
          flight.rcsMode = "orbital-hold";
          flight.rcsAuthority = 0;
          flight.rcsAccelKmS2 = 0;
          flight.rcsDeltaVKmS = 0;
          flight.verticalErrorKm = 0;
          flight.verticalRateKmS = 0;
          flight.rcsJets = [];
          resetFlightAttitudeTelemetry(flight, flight.attitudeAxisKm, fallbackAttitudeAxisKm);
        }
        flight.shipRcsActive = false;
        flight.shipRcsMode = "";
        flight.shipRcsAuthority = 0;
        flight.shipRcsJets = [];
        flight.lastDistanceKm = sensedDistanceKm;
        flight.lastRelativeSpeedKmS = sensedRelativeSpeedKmS;
        flight.lastClosingSpeedKmS = sensedClosingSpeedKmS;
        continue;
      }

      if (flight.status === "transferring") {
        const lockOffsetKm = clamp(
          Number(flight.lockedOffsetKm) || Number(config.dockLockedOffsetKm) || 0,
          0,
          maxDockLockOffsetKm,
        );
        const lockTargetPosition = add(rocketState.position, scale(dockLockUp, lockOffsetKm));
        tankerState.position = {
          x: Number(lockTargetPosition.x) || 0,
          y: Number(lockTargetPosition.y) || 0,
          z: Number(lockTargetPosition.z) || 0,
        };
        tankerState.velocity = { ...(rocketState.velocity || zeroVector) };
        resetFlightAttitudeTelemetry(flight, dockLockUp, localUp);

        const plannedTransferKg = Math.max(0, Number(flight.transferPlannedKg) || Number(flight.transferKg) || 0);
        const remainingKg = Math.max(0, Number(flight.transferRemainingKg) || plannedTransferKg);
        const transferRateKgS = Math.max(
          0.1,
          Number(flight.transferRateKgS)
            || (plannedTransferKg / Math.max(1, Number(flight.transferDurationSec) || Number(config.transferDurationSec) || 1)),
        );
        const propellantDeficitKg = Math.max(0, transferTargetKg - Math.max(0, Number(runtime.stagePropellantKg) || 0));
        const transferStepKg = safeDtSeconds > 0
          ? Math.min(remainingKg, propellantDeficitKg, transferRateKgS * safeDtSeconds)
          : 0;
        if (transferStepKg > 0) {
          runtime.stagePropellantKg = Math.max(0, Number(runtime.stagePropellantKg) || 0) + transferStepKg;
          rocketState.massKg = Math.max(
            Number(minRocketMassKg) || 500,
            (Number(rocketState.massKg) || Number(minRocketMassKg) || 500) + transferStepKg,
          );
          flight.transferRemainingKg = remainingKg - transferStepKg;
          flight.transferTransferredKg = Math.max(0, Number(flight.transferTransferredKg) || 0) + transferStepKg;
        } else {
          flight.transferRemainingKg = remainingKg;
          flight.transferTransferredKg = Math.max(0, Number(flight.transferTransferredKg) || 0);
        }

        const transferProgress = plannedTransferKg > 1e-6
          ? clamp((Number(flight.transferTransferredKg) || 0) / plannedTransferKg, 0, 1)
          : 1;
        runtime.refuel.transferActive = true;
        runtime.refuel.transferTankerId = flight.id;
        runtime.refuel.transferProgress = transferProgress;
        runtime.refuel.transferRemainingKg = Math.max(0, Number(flight.transferRemainingKg) || 0);
        runtime.refuel.transferRateKgS = transferRateKgS;
        runtime.refuel.transferStartedElapsedSec = Number(flight.transferStartedElapsedSec) || runtime.elapsedSeconds;

        flight.rcsActive = true;
        flight.rcsMode = "rcs-fuel-lock";
        flight.rcsAuthority = 0.18;
        flight.rcsAccelKmS2 = 0;
        flight.rcsDeltaVKmS = 0;
        flight.rcsJets = ["aft", "forward"];
        flight.shipRcsActive = true;
        flight.shipRcsMode = "rcs-fuel-lock";
        flight.shipRcsAuthority = 0.2;
        flight.shipRcsJets = ["aft", "forward"];
        flight.lastDistanceKm = Math.max(0, lockOffsetKm);
        flight.lastRelativeSpeedKmS = 0;
        flight.lastClosingSpeedKmS = 0;

        const transferDone = flight.transferRemainingKg <= 1e-3 || propellantDeficitKg <= 1e-3;
        if (!transferDone) {
          continue;
        }

        const transferredKg = Math.max(0, Number(flight.transferTransferredKg) || 0);
        runtime.refuel.completedFlights = Math.max(0, Number(runtime.refuel.completedFlights) || 0) + 1;
        runtime.refuel.lastAction = "transfer_completed";
        runtime.refuel.lastActionTimeSec = runtime.elapsedSeconds;
        emitLaunchEvent?.("refuel_transfer_completed", {
          tankerId: flight.id,
          transferredKg,
          completedFlights: runtime.refuel.completedFlights,
          requiredFlights: runtime.refuel.requiredFlights,
          stagePropellantKg: runtime.stagePropellantKg,
          targetPropellantKg: transferTargetKg,
          dockDistanceKm: lockOffsetKm,
          dockRelativeSpeedKmS: 0,
        });

        flight.transferredKg = transferredKg;
        flight.status = "undocking";
        flight.undockDurationSec = Math.max(10, Number(config.undockDurationSec) || 40);
        flight.undockRemainingSec = Number(flight.undockDurationSec);
        runtime.refuel.transferActive = false;
        runtime.refuel.transferTankerId = "";
        runtime.refuel.transferProgress = 1;
        runtime.refuel.transferRemainingKg = 0;
        runtime.refuel.transferRateKgS = 0;
        continue;
      }

      if (flight.status === "undocking") {
        const undockDurationSec = Math.max(10, Number(flight.undockDurationSec) || Number(config.undockDurationSec) || 40);
        let undockRemainingSec = Number(flight.undockRemainingSec);
        if (!(undockRemainingSec > 0)) {
          undockRemainingSec = undockDurationSec;
        }
        const separationSpeedKmS = Math.max(0.00006, Number(config.undockSeparationSpeedKmS) || 0.00042);
        const separationAccelKmS2 = separationSpeedKmS / Math.max(undockDurationSec, 1);
        const tankerDeltaV = scale(dockLockUp, separationAccelKmS2 * rcsDtSeconds);
        const shipDeltaV = scale(dockLockUp, -separationAccelKmS2 * rcsDtSeconds * 0.35);
        tankerState.velocity = add(tankerState.velocity || zeroVector, tankerDeltaV);
        rocketState.velocity = add(rocketState.velocity || zeroVector, shipDeltaV);
        resetFlightAttitudeTelemetry(flight, dockLockUp, localUp);

        undockRemainingSec = Math.max(0, undockRemainingSec - safeDtSeconds);
        flight.undockRemainingSec = undockRemainingSec;
        flight.lastDistanceKm = Number(flight.lastDistanceKm) || 0;
        flight.lastRelativeSpeedKmS = vectorMagnitude(subtract(tankerState.velocity || zeroVector, rocketState.velocity || zeroVector));
        flight.lastClosingSpeedKmS = 0;
        flight.rcsActive = true;
        flight.rcsMode = "rcs-undock-separation";
        flight.rcsAuthority = clamp(undockRemainingSec / Math.max(undockDurationSec, 1), 0.2, 1);
        flight.rcsAccelKmS2 = separationAccelKmS2;
        flight.rcsDeltaVKmS = vectorMagnitude(tankerDeltaV);
        flight.rcsJets = ["aft"];
        flight.shipRcsActive = true;
        flight.shipRcsMode = "rcs-undock-backaway";
        flight.shipRcsAuthority = clamp(undockRemainingSec / Math.max(undockDurationSec, 1), 0.2, 1);
        flight.shipRcsJets = ["forward"];

        runtime.refuel.undockActive = undockRemainingSec > 0;
        runtime.refuel.undockTankerId = flight.id;
        if (undockRemainingSec > 0) {
          continue;
        }

        flight.active = false;
        flight.status = "completed";
        flight.completedElapsedSec = runtime.elapsedSeconds;
        flight.rcsActive = false;
        flight.rcsMode = "undocked";
        flight.rcsAuthority = 0;
        flight.rcsAccelKmS2 = 0;
        flight.rcsDeltaVKmS = 0;
        flight.rcsJets = [];
        flight.shipRcsActive = false;
        flight.shipRcsMode = "undocked";
        flight.shipRcsAuthority = 0;
        flight.shipRcsJets = [];
        resetFlightAttitudeTelemetry(flight, flight.attitudeAxisKm, localUp);
        tankerState.massKg = dryMassKg;
        markTankerConsumed(flight.id);
        runtime.refuel.lastAction = "undock_completed";
        runtime.refuel.lastActionTimeSec = runtime.elapsedSeconds;
        emitLaunchEvent?.("refuel_undock_completed", {
          tankerId: flight.id,
          transferredKg: Number(flight.transferredKg) || 0,
          stagePropellantKg: runtime.stagePropellantKg,
        });
        runtime.refuel.undockActive = false;
        runtime.refuel.undockTankerId = "";
        continue;
      }

      // Tanker RCS guidance: maintain a slot around the target ship and progressively tighten to docking.
      const slotCaptureDistanceKm = Math.max(0.25, dockDistanceKm * 4.5);
      const slotApproachDistanceKm = Math.max(3, dockDistanceKm * 38);
      const approachProgress = sensedDistanceKm <= slotCaptureDistanceKm
        ? 1
        : clamp(
          (slotApproachDistanceKm - sensedDistanceKm)
            / Math.max(slotApproachDistanceKm - slotCaptureDistanceKm, 1e-6),
          0,
          0.96,
        );
      const slotOffset = sensedDistanceKm <= slotCaptureDistanceKm
        ? zeroVector
        : refuelFlightOffsetKm(rocketRelPos, rocketRelVel, Number(flight.slot) || 0, approachProgress);
      const slotNominalRadiusKm = Math.max(0, vectorMagnitude(slotOffset));
      const slotRecoveryDistanceKm = Math.max(
        Math.max(8, Number(config.slotMaxDriftKm) || 45),
        slotNominalRadiusKm + Math.max(10, slotCaptureDistanceKm * 8),
      );
      const targetPosition = add(rocketState.position, slotOffset);
      const positionError = subtract(targetPosition, tankerState.position);
      const errorDistanceKm = vectorMagnitude(positionError);

      let mode = "rcs-slot-acquire";
      let maxApproachSpeedKmS = 0.012;
      let responseSeconds = 190;
      let maxAccelKmS2 = 0.00016;
      if (sensedDistanceKm > slotRecoveryDistanceKm) {
        mode = "rcs-slot-recovery";
        maxApproachSpeedKmS = Math.max(0.006, Number(config.slotRecoveryApproachSpeedKmS) || 0.012);
        responseSeconds = Math.max(80, Number(config.slotRecoveryResponseSec) || 120);
        maxAccelKmS2 = Math.max(0.00006, Number(config.slotRecoveryAccelKmS2) || 0.00012);
      }
      if (errorDistanceKm <= 8) {
        mode = "rcs-slot-tighten";
        maxApproachSpeedKmS = 0.0022;
        responseSeconds = 135;
        maxAccelKmS2 = 0.000072;
      }
      if (errorDistanceKm <= 0.8) {
        mode = "rcs-dock-approach";
        maxApproachSpeedKmS = 0.00022;
        responseSeconds = 88;
        maxAccelKmS2 = 0.000024;
      }
      if (errorDistanceKm <= (dockDistanceKm * 2.2)) {
        mode = "rcs-dock-fine";
        maxApproachSpeedKmS = Math.min(dockMaxRelativeSpeedKmS * 0.56, 0.000032);
        responseSeconds = 54;
        maxAccelKmS2 = 0.000009;
      }

      const desiredClosureSpeedKmS = errorDistanceKm > 1e-9
        ? Math.min(maxApproachSpeedKmS, errorDistanceKm / Math.max(responseSeconds, 1))
        : 0;
      const desiredRelVel = errorDistanceKm > 1e-9
        ? scale(positionError, desiredClosureSpeedKmS / errorDistanceKm)
        : zeroVector;
      const velocityError = subtract(desiredRelVel, relVelToRocket);
      let commandedAccelKmS2 = scale(velocityError, 1 / Math.max(responseSeconds, 1));

      const verticalErrorKm = vectorDot(positionError, localUp);
      const verticalRateKmS = vectorDot(relVelToRocket, localUp);
      const maxVerticalSpeedKmS = Math.max(0.00004, maxApproachSpeedKmS * 0.42);
      const desiredVerticalSpeedKmS = clamp(verticalErrorKm / 220, -maxVerticalSpeedKmS, maxVerticalSpeedKmS);
      const verticalAccelKmS2 = (desiredVerticalSpeedKmS - verticalRateKmS) / Math.max(responseSeconds, 1);
      commandedAccelKmS2 = add(commandedAccelKmS2, scale(localUp, verticalAccelKmS2 * 0.68));
      if (orbitHold && Number.isFinite(Number(orbitHold.altitudeKm))) {
        const belowBandKm = Math.max(0, Number(orbitHold.altitudeMinKm) - Number(orbitHold.altitudeKm));
        const aboveBandKm = Math.max(0, Number(orbitHold.altitudeKm) - Number(orbitHold.altitudeMaxKm));
        const outOfBandKm = Math.max(belowBandKm, aboveBandKm);
        if (outOfBandKm > 0) {
          const bandBlend = clamp(outOfBandKm / 6, 0.25, 0.82);
          commandedAccelKmS2 = add(
            scale(commandedAccelKmS2, 1 - bandBlend),
            scale(orbitHold.commandedAccelKmS2, bandBlend),
          );
          mode = `${mode}-band`;
        }
      }
      commandedAccelKmS2 = clampVectorMagnitude(commandedAccelKmS2, maxAccelKmS2);
      const appliedAccelKmS2 = resolveTankerAttitudeCommand(commandedAccelKmS2);
      const commandedDeltaVKmS = scale(appliedAccelKmS2, rcsDtSeconds);
      if (rcsDtSeconds > 0 && vectorMagnitude(commandedDeltaVKmS) > 0) {
        tankerState.velocity = add(tankerState.velocity || zeroVector, commandedDeltaVKmS);
      }

      const shipToTankerKm = subtract(tankerState.position, rocketState.position);
      const shipDistanceKm = vectorMagnitude(shipToTankerKm);
      const shipRelVelToTanker = subtract(rocketVelocityNow, tankerState.velocity || zeroVector);
      let shipRcsMode = "";
      let shipAssistAccelKmS2 = zeroVector;
      let shipAssistMaxAccelKmS2 = Math.max(0.000006, Number(config.shipDockAssistAccelKmS2) || 0.00002);
      if (shipDistanceKm <= Math.max(1.4, dockDistanceKm * 10)) {
        shipRcsMode = shipDistanceKm <= (dockDistanceKm * 3.5) ? "rcs-dock-align-fine" : "rcs-dock-align";
        let shipResponseSec = shipDistanceKm <= (dockDistanceKm * 3.5) ? 54 : 108;
        let maxShipApproachSpeedKmS = shipDistanceKm <= (dockDistanceKm * 3.5) ? 0.00007 : 0.00028;
        if (shipDistanceKm <= (dockDistanceKm * 1.4)) {
          shipResponseSec = 40;
          maxShipApproachSpeedKmS = 0.000028;
          shipAssistMaxAccelKmS2 = Math.max(shipAssistMaxAccelKmS2, 0.000011);
        }
        const desiredShipClosureKmS = shipDistanceKm > 1e-9
          ? Math.min(maxShipApproachSpeedKmS, shipDistanceKm / Math.max(shipResponseSec, 1))
          : 0;
        const desiredShipRelVel = shipDistanceKm > 1e-9
          ? scale(shipToTankerKm, desiredShipClosureKmS / shipDistanceKm)
          : zeroVector;
        const shipVelErrorKmS = subtract(desiredShipRelVel, shipRelVelToTanker);
        shipAssistAccelKmS2 = scale(shipVelErrorKmS, 1 / Math.max(shipResponseSec, 1));
        const shipVerticalErrorKm = vectorDot(shipToTankerKm, localUp);
        const shipVerticalRateKmS = vectorDot(shipRelVelToTanker, localUp);
        const desiredShipVerticalSpeedKmS = clamp(
          shipVerticalErrorKm / 180,
          -maxShipApproachSpeedKmS * 0.7,
          maxShipApproachSpeedKmS * 0.7,
        );
        const shipVerticalAccelKmS2 = (desiredShipVerticalSpeedKmS - shipVerticalRateKmS) / Math.max(shipResponseSec, 1);
        shipAssistAccelKmS2 = add(shipAssistAccelKmS2, scale(localUp, shipVerticalAccelKmS2 * 0.82));
        shipAssistAccelKmS2 = clampVectorMagnitude(shipAssistAccelKmS2, shipAssistMaxAccelKmS2);
        const shipDeltaV = scale(shipAssistAccelKmS2, rcsDtSeconds);
        if (rcsDtSeconds > 0 && vectorMagnitude(shipDeltaV) > 0) {
          rocketState.velocity = add(rocketState.velocity || zeroVector, shipDeltaV);
        }
      }

      const rcsAccelMagKmS2 = vectorMagnitude(appliedAccelKmS2);
      const rcsDeltaVMagKmS = vectorMagnitude(commandedDeltaVKmS);
      const rcsJets = tankerRcsJetsFromCommand({
        commandedAccelKmS2: appliedAccelKmS2,
        localUp,
        tankerRelVel,
        relVelToRocket,
        verticalErrorKm,
        thresholdKmS2: Math.max(1e-8, maxAccelKmS2 * 0.16),
      });
      const shipAccelMagKmS2 = vectorMagnitude(shipAssistAccelKmS2);
      const rocketRelVelNow = subtract(rocketState.velocity || zeroVector, earthVelocity);
      const shipRcsJets = shipAccelMagKmS2 > 1e-10
        ? tankerRcsJetsFromCommand({
          commandedAccelKmS2: shipAssistAccelKmS2,
          localUp,
          tankerRelVel: rocketRelVelNow,
          relVelToRocket: subtract(rocketState.velocity || zeroVector, tankerState.velocity || zeroVector),
          verticalErrorKm: vectorDot(shipToTankerKm, localUp),
          thresholdKmS2: Math.max(1e-8, shipAssistMaxAccelKmS2 * 0.14),
        })
        : [];
      flight.rcsActive = rcsAccelMagKmS2 > 1e-10;
      flight.rcsMode = flight.attitudeLimited
        ? `${mode}-attitude-limit`
        : mode;
      flight.rcsAuthority = clamp(
        rcsAccelMagKmS2 / Math.max(maxAccelKmS2, 1e-9),
        0,
        1,
      );
      flight.rcsAccelKmS2 = rcsAccelMagKmS2;
      flight.rcsDeltaVKmS = rcsDeltaVMagKmS;
      flight.verticalErrorKm = verticalErrorKm;
      flight.verticalRateKmS = verticalRateKmS;
      flight.rcsJets = flight.rcsActive ? rcsJets : [];
      flight.shipRcsActive = shipAccelMagKmS2 > 1e-10;
      flight.shipRcsMode = flight.shipRcsActive ? shipRcsMode : "";
      flight.shipRcsAuthority = clamp(
        shipAccelMagKmS2 / Math.max(shipAssistMaxAccelKmS2, 1e-9),
        0,
        1,
      );
      flight.shipRcsJets = flight.shipRcsActive ? shipRcsJets : [];

      const refreshedMetrics = rendezvousMetrics(rocketState, tankerState) || metrics;
      const activeMetrics = refreshedMetrics;
      flight.lastDistanceKm = activeMetrics.distanceKm;
      flight.lastRelativeSpeedKmS = activeMetrics.relativeSpeedKmS;
      flight.lastClosingSpeedKmS = activeMetrics.closingSpeedKmS;
      const dockReady = activeMetrics.distanceKm <= dockDistanceKm
        && activeMetrics.relativeSpeedKmS <= dockMaxRelativeSpeedKmS;
      if (!dockReady) {
        flight.dockStableSec = 0;
        continue;
      }
      const closingSpeedAbsKmS = Math.abs(Number(activeMetrics.closingSpeedKmS) || 0);
      const closingSpeedLimitKmS = Math.max(0.00001, dockMaxRelativeSpeedKmS * 0.65);
      if (closingSpeedAbsKmS > closingSpeedLimitKmS) {
        flight.dockStableSec = 0;
        flight.rcsMode = "rcs-dock-hold-verify";
        flight.shipRcsMode = flight.shipRcsActive ? "rcs-dock-hold-verify" : flight.shipRcsMode;
        continue;
      }
      flight.dockStableSec = Math.min(
        dockStableSeconds,
        Math.max(0, Number(flight.dockStableSec) || 0) + safeDtSeconds,
      );
      if ((Number(flight.dockStableSec) || 0) + 1e-6 < dockStableSeconds) {
        flight.rcsMode = "rcs-dock-hold-verify";
        flight.shipRcsMode = flight.shipRcsActive ? "rcs-dock-hold-verify" : flight.shipRcsMode;
        continue;
      }
      flight.dockStableSec = 0;

      const requestedTransferKg = Math.max(0, Number(flight.transferKg) || 0);
      const propellantDeficitKg = Math.max(
        0,
        transferTargetKg - Math.max(0, Number(runtime.stagePropellantKg) || 0),
      );
      const plannedTransferKg = Math.min(requestedTransferKg, propellantDeficitKg);
      if (plannedTransferKg <= 1e-6) {
        runtime.refuel.lastAction = "transfer_skipped";
        runtime.refuel.lastActionTimeSec = runtime.elapsedSeconds;
        emitLaunchEvent?.("refuel_transfer_skipped", {
          tankerId: flight.id,
          reason: "target_propellant_already_met",
          stagePropellantKg: runtime.stagePropellantKg,
          targetPropellantKg: transferTargetKg,
          dockDistanceKm: activeMetrics.distanceKm,
          dockRelativeSpeedKmS: activeMetrics.relativeSpeedKmS,
        });
        flight.active = false;
        flight.status = "completed";
        flight.completedElapsedSec = runtime.elapsedSeconds;
        flight.transferredKg = 0;
        flight.rcsActive = false;
        flight.rcsMode = "docked";
        flight.rcsAuthority = 0;
        flight.rcsAccelKmS2 = 0;
        flight.rcsDeltaVKmS = 0;
        flight.rcsJets = [];
        flight.shipRcsActive = false;
        flight.shipRcsMode = "";
        flight.shipRcsAuthority = 0;
        flight.shipRcsJets = [];
        resetFlightAttitudeTelemetry(flight, flight.attitudeAxisKm, localUp);
        tankerState.massKg = dryMassKg;
        markTankerConsumed(flight.id);
        continue;
      }

      flight.status = "transferring";
      flight.transferPlannedKg = plannedTransferKg;
      flight.transferRemainingKg = plannedTransferKg;
      flight.transferTransferredKg = 0;
      flight.transferDurationSec = Math.max(30, Number(config.transferDurationSec) || 150);
      flight.transferRateKgS = plannedTransferKg / Math.max(flight.transferDurationSec, 1);
      flight.transferStartedElapsedSec = runtime.elapsedSeconds;
      flight.lockedOffsetKm = clamp(
        Number(config.dockLockedOffsetKm) || 0,
        0,
        maxDockLockOffsetKm,
      );
      flight.rcsMode = "rcs-docked-lock";
      flight.shipRcsMode = "rcs-docked-lock";
      runtime.refuel.lastAction = "transfer_started";
      runtime.refuel.lastActionTimeSec = runtime.elapsedSeconds;
      emitLaunchEvent?.("refuel_transfer_started", {
        tankerId: flight.id,
        plannedTransferKg,
        transferDurationSec: flight.transferDurationSec,
        transferRateKgS: flight.transferRateKgS,
        dockDistanceKm: activeMetrics.distanceKm,
        dockRelativeSpeedKmS: activeMetrics.relativeSpeedKmS,
      });
    }
    recalcRefuelFlightCounts();
  }

  function activeRendezvousTarget(state) {
    syncExternalOrbitTankers(state);
    const flights = Array.isArray(runtime.refuel.flights) ? runtime.refuel.flights : [];
    if (!state?.dynamicBodies || flights.length <= 0) {
      return null;
    }
    const rocketState = rocketStateFromNBody?.(state);
    if (
      !rocketState
      || !finiteVector?.(rocketState.position)
      || !finiteVector?.(rocketState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      return null;
    }
    const earthState = earthStateFromNBody?.(state);
    const earthVelocity = earthState?.velocity || { x: 0, y: 0, z: 0 };
    const earthRadiusKm = Math.max(1000, Number(getEarthRadiusKm?.()) || 6371);
    const consumedIds = consumedTankerIdsSet();
    let best = null;
    for (let i = 0; i < flights.length; i += 1) {
      const flight = flights[i];
      if (!flight?.id) {
        continue;
      }
      if (consumedIds.has(String(flight.id))) {
        continue;
      }
      const tankerState = state.dynamicBodies.get(flight.id);
      if (
        !tankerState
        || !finiteVector?.(tankerState.position)
        || !finiteVector?.(tankerState.velocity || { x: 0, y: 0, z: 0 })
      ) {
        continue;
      }
      if (!flight.active) {
        flight.active = true;
        if (
          !flight.status
          || flight.status === "completed"
          || flight.status === "invalid"
        ) {
          flight.status = "external_orbit";
        }
      }
      if (
        earthState
        && finiteVector?.(earthState.position)
        && finiteVector?.(earthState.velocity || { x: 0, y: 0, z: 0 })
      ) {
        const tankerRelPos = subtract(tankerState.position, earthState.position);
        const tankerRelVel = subtract(tankerState.velocity || { x: 0, y: 0, z: 0 }, earthVelocity);
        const localUp = normalize(tankerRelPos, { x: 0, y: 0, z: 1 });
        const radiusKm = vectorMagnitude(tankerRelPos);
        const radialSpeedKmS = vectorDot(tankerRelVel, localUp);
        const tangentialSpeedKmS = vectorMagnitude(
          subtract(tankerRelVel, scale(localUp, radialSpeedKmS)),
        );
        flight.sensorAltitudeKm = Math.max(0, radiusKm - earthRadiusKm);
        flight.sensorRadialSpeedKmS = radialSpeedKmS;
        flight.sensorTangentialSpeedKmS = tangentialSpeedKmS;
      }
      applyDockingBandState(
        flight,
        computeDockingBandState({
          flight,
          safeDtSeconds: 0,
          config,
        }),
      );
      if (!isFlightDockingEligible(flight, config)) {
        continue;
      }
      const metrics = rendezvousMetrics(rocketState, tankerState);
      if (!metrics) {
        continue;
      }
      if (!best || metrics.distanceKm < best.distanceKm) {
        best = {
          tankerId: flight.id,
          slot: Number(flight.slot) || 0,
          transferKg: Math.max(0, Number(flight.transferKg) || 0),
          distanceKm: metrics.distanceKm,
          relativeSpeedKmS: metrics.relativeSpeedKmS,
          closingSpeedKmS: metrics.closingSpeedKmS,
          relativePositionKm: metrics.relativePositionKm,
          relativeVelocityKmS: metrics.relativeVelocityKmS,
        };
      }
    }
    return best;
  }

  function launchMissionRefuelTanker(state, eligibility, nowMs = Date.now()) {
    const slot = Math.max(0, Number(runtime.refuel.nextSlot) || 0);
    const identity = buildTankerIdentity(state, runtime);
    if (!identity) {
      return { accepted: false, reason: "tanker_id_exhausted" };
    }
    const relPos = subtract(eligibility.rocketState.position, eligibility.earthState.position);
    const relVel = subtract(
      eligibility.rocketState.velocity || { x: 0, y: 0, z: 0 },
      eligibility.earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    const offset = refuelFlightOffsetKm(relPos, relVel, slot, 0);
    const targetPropellantKg = resolveRefuelTargetKg(runtime.refuel, stage2CapacityKg?.() || 0);
    const stagePropellantKg = Math.max(0, Number(runtime.stagePropellantKg) || 0);
    const requestedTransferKg = Math.max(0, Number(runtime.refuel.transferPerFlightKg) || 0);
    const transferKg = Math.min(requestedTransferKg, Math.max(0, targetPropellantKg - stagePropellantKg));
    if (!(transferKg > 1e-3)) {
      return {
        accepted: false,
        reason: "target_propellant_already_met",
      };
    }
    const dryMassKg = Math.max(10_000, Number(stage2DryMassKg?.()) || 120_000);
    const tankerMassKg = dryMassKg + transferKg;
    const tankerMeta = makeTankerMeta(identity, tankerMassKg);
    const tankerState = {
      id: identity.id,
      massKg: tankerMassKg,
      position: add(eligibility.rocketState.position, offset),
      velocity: { ...(eligibility.rocketState.velocity || { x: 0, y: 0, z: 0 }) },
    };
    state.dynamicBodies.set(identity.id, tankerState);
    runtime.refuel.flights = (Array.isArray(runtime.refuel.flights) ? runtime.refuel.flights : [])
      .filter((flight) => String(flight?.id || "") !== identity.id);
    runtime.refuel.flights.push({
      id: identity.id,
      slot,
      active: true,
      status: "rendezvous",
      launchedElapsedSec: runtime.elapsedSeconds,
      launchTimestampMs: nowMs,
      transferKg,
      ...defaultRefuelFlightRuntimeState({
        attitudeAxisKm: normalizeFiniteAxis(eligibility.rocketState.velocity, normalize(offset, { x: 0, y: 0, z: 1 })),
      }),
    });
    runtime.refuel.launchedFlights = Math.max(0, Number(runtime.refuel.launchedFlights) || 0) + 1;
    runtime.refuel.nextSlot = slot + 1;
    runtime.refuel.lastAction = "tanker_launched";
    runtime.refuel.lastActionTimeSec = runtime.elapsedSeconds;
    recalcRefuelFlightCounts();
    emitLaunchEvent?.("refuel_tanker_launched", {
      tankerId: identity.id,
      mode: "rendezvous",
      slot,
      launchedFlights: runtime.refuel.launchedFlights,
      activeFlights: runtime.refuel.activeFlights,
      requiredFlights: runtime.refuel.requiredFlights,
      transferKg,
      stagePropellantKg: runtime.stagePropellantKg,
      targetPropellantKg,
    });
    return {
      accepted: true,
      tankerId: identity.id,
      tankerMeta,
      mode: "rendezvous",
      transferKg,
      launchedFlights: runtime.refuel.launchedFlights,
      completedFlights: runtime.refuel.completedFlights,
      requiredFlights: runtime.refuel.requiredFlights,
    };
  }

  function launchRefuelTanker(state, nowMs = Date.now()) {
    // Realism guard: tanker vehicles must be physically launched from Earth with a booster.
    // Any direct in-orbit tanker spawn path is intentionally disabled.
    const eligibility = refuelLaunchEligibility(state);
    return {
      accepted: false,
      reason: "pad_launch_only",
      detail: eligibility?.reason || "pad_launch_required",
    };
  }

  function status() {
    return computeRefuelStatus({
      runtime,
      missionIdMoonOrbitReturn,
      missionIdsRefuelEligible: Array.from(refuelEligibleMissionIds),
      stage2CapacityKg: stage2CapacityKg?.() || 0,
      config,
    });
  }

  return {
    resetRefuelState,
    applyMissionProfile,
    clearRefuelTankersFromState,
    removeTankerById,
    isMoonMissionRefuelActive,
    recalcRefuelFlightCounts,
    updateRefuelFlights,
    activeRendezvousTarget,
    launchDirectOrbitTanker: launchDepotTanker,
    launchRefuelTanker,
    status,
  };
}
