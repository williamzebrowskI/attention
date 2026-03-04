import {
  LAUNCH_BODY_ID,
  LAUNCH_BOOSTER_BODY_ID,
  LAUNCH_SITE,
  STARSHIP_STACK_DIMENSIONS_KM,
} from "./launchConfig.js";
import { clamp, dot, length, scale, subtract } from "./launchMath.js";

export function isRefuelTankerBodyId(bodyId) {
  return String(bodyId || "").startsWith("earth_refuel_tanker_");
}

export function tankerOrdinalFromBodyId(bodyId) {
  const match = String(bodyId || "").match(/_(\d+)$/);
  return match ? Math.max(1, Number(match[1]) || 1) : 1;
}

export function tankerMetaForId(tankerId, sequenceNumber = 1, massKg = null, templateMeta = null) {
  const template = templateMeta || {
    body_type: "spacecraft",
    parent: "earth",
    radius_km: STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 0.5,
    mass_kg: 340_000,
    semimajor_axis_km: null,
    orbital_period_days: null,
    phase: 0,
    description: "Reusable orbital tanker Starship used for in-space propellant transfer.",
  };
  const ordinal = Math.max(1, Number(sequenceNumber) || 1);
  const resolvedMassKg = Number.isFinite(Number(massKg)) && Number(massKg) > 0
    ? Number(massKg)
    : (Number(template.mass_kg) || 340_000);
  return {
    ...template,
    id: tankerId,
    name: `Starship Tanker ${ordinal}`,
    mass_kg: resolvedMassKg,
  };
}

export function buildVehicleStatusSnapshot({
  baseSnapshot,
  trackedBodyId,
  state,
  nowMs = Date.now(),
  runtime,
  refuelStatus = null,
  getEarthRadiusKm,
  getEarthMassKg,
  gravitationalConstantKm3PerKgS2,
  sampleEarthAtmosphere,
  earthAxes,
  earthStateFromNBody,
  finiteVector,
  orbitalStateFromRelative,
  dynamicPressurePaFromAtmosphere,
  resolveMissionName,
  phaseLabel,
} = {}) {
  const launchBodyId = LAUNCH_BODY_ID;
  const launchBoosterBodyId = LAUNCH_BOOSTER_BODY_ID;
  const bodyId = String(trackedBodyId || launchBodyId);
  if (bodyId === launchBodyId) {
    return {
      ...baseSnapshot,
      vehicleKind: "starship",
      vehicleName: "Starship",
    };
  }

  const vehicleKind = bodyId === launchBoosterBodyId
    ? "booster"
    : (isRefuelTankerBodyId(bodyId) ? "tanker" : "spacecraft");
  const vehicleName = vehicleKind === "booster"
    ? "Super Heavy Booster"
    : (
      vehicleKind === "tanker"
        ? `Starship Tanker ${tankerOrdinalFromBodyId(bodyId)}`
        : "Spacecraft"
    );

  const bodyState = state?.dynamicBodies?.get?.(bodyId) || null;
  const earthState = earthStateFromNBody?.(state);
  if (
    !bodyState
    || !earthState
    || !finiteVector?.(bodyState.position)
    || !finiteVector?.(bodyState.velocity || { x: 0, y: 0, z: 0 })
    || !finiteVector?.(earthState.position)
    || !finiteVector?.(earthState.velocity || { x: 0, y: 0, z: 0 })
  ) {
    return {
      ...baseSnapshot,
      bodyId,
      vehicleKind,
      vehicleName,
      moonRelativeSpeedKmS: null,
      moonProjectedMissDistanceKm: null,
      missionPhaseGateReason: "",
      refuelTransferActive: false,
      refuelTransferTankerId: "",
      refuelTransferProgress: 0,
      refuelTransferRemainingKg: 0,
      refuelTransferRateKgS: 0,
      refuelTransferLocked: false,
      refuelUndockActive: false,
      refuelFuelingActive: false,
      statusLine: `${vehicleName} telemetry unavailable.`,
    };
  }

  const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
  const mu = Number(gravitationalConstantKm3PerKgS2) * (Number(getEarthMassKg?.()) || 0);
  const relPos = subtract(bodyState.position, earthState.position);
  const relVel = subtract(
    bodyState.velocity || { x: 0, y: 0, z: 0 },
    earthState.velocity || { x: 0, y: 0, z: 0 },
  );
  const orbital = orbitalStateFromRelative?.(mu, earthRadiusKm, relPos, relVel) || {
    altitudeKm: 0,
    speedKmS: 0,
    radialSpeedKmS: 0,
    tangentialSpeedKmS: 0,
    circularSpeedKmS: 0,
    apoapsisKm: null,
    periapsisKm: null,
    timeToApoapsisSec: null,
    specificEnergy: 0,
  };
  const radialDistanceKm = length(relPos);
  const radialClosingSpeedKmS = radialDistanceKm > 1e-9
    ? -dot(relVel, scale(relPos, 1 / radialDistanceKm))
    : null;
  const altitudeKm = Math.max(0, Number(orbital.altitudeKm) || 0);
  const currentEarthAxes = earthAxes?.(nowMs) || { pole: { x: 0, y: 0, z: 1 } };
  const atmosphereSample = sampleEarthAtmosphere?.(
    altitudeKm,
    {
      timestampMs: nowMs,
      relativePositionKm: relPos,
      earthAxes: currentEarthAxes,
    },
  ) || null;
  const dynamicPressurePa = dynamicPressurePaFromAtmosphere?.(
    atmosphereSample,
    relPos,
    relVel,
    currentEarthAxes.pole,
  ) || 0;
  const apoapsisKm = Number.isFinite(Number(orbital.apoapsisKm))
    ? Number(orbital.apoapsisKm)
    : null;
  const periapsisKm = Number.isFinite(Number(orbital.periapsisKm))
    ? Number(orbital.periapsisKm)
    : null;
  const inBoundOrbit = Number(orbital.specificEnergy) < 0 && Number(orbital.periapsisKm) > 80;

  const throttle = vehicleKind === "booster"
    ? (Number(runtime?.booster?.telemetry?.throttle) || Number(runtime?.booster?.lastStep?.throttle) || 0)
    : 0;
  const thrustN = vehicleKind === "booster"
    ? (Number(runtime?.booster?.telemetry?.thrustN) || Number(runtime?.booster?.lastStep?.thrustN) || 0)
    : 0;
  const burnRateKgS = vehicleKind === "booster"
    ? (Number(runtime?.booster?.lastStep?.burnRateKgS) || 0)
    : 0;
  const guidanceMode = vehicleKind === "booster"
    ? (runtime?.booster?.telemetry?.guidanceMode || runtime?.booster?.guidanceMode || "booster-guidance")
    : (inBoundOrbit ? "autopilot-ballistic-hold" : "autopilot-coast");
  const phase = throttle > 1e-3
    ? "powered"
    : (inBoundOrbit ? "orbit" : "coast");
  const tankerMissionId = "earth_orbit_hold";
  const missionName = vehicleKind === "tanker"
    ? "Orbital Tanker Ops"
    : (typeof resolveMissionName === "function" ? resolveMissionName() : "Mission");
  const refuel = refuelStatus || {
    requiredFlights: 0,
    completedFlights: 0,
    activeFlights: 0,
    launchedFlights: 0,
    targetPropellantKg: 0,
    fillFraction: 0,
    refuelCanLaunchTanker: false,
    transferActive: false,
    transferTankerId: "",
    transferProgress: 0,
    transferRemainingKg: 0,
    transferRateKgS: 0,
    transferLocked: false,
    undockActive: false,
  };
  const refuelFlights = Array.isArray(runtime?.refuel?.flights) ? runtime.refuel.flights : [];
  const tankerRefuelFlight = vehicleKind === "tanker"
    ? (refuelFlights.find((flight) => String(flight?.id || "") === bodyId) || null)
    : null;
  const tankerRcsActive = Boolean(tankerRefuelFlight?.rcsActive);
  const tankerRcsMode = String(tankerRefuelFlight?.rcsMode || "").trim();
  const tankerGuidanceMode = vehicleKind === "tanker" && tankerRcsMode
    ? `${guidanceMode}:${tankerRcsMode}`
    : guidanceMode;
  const tankerRcsAuthority = clamp(
    Number.isFinite(Number(tankerRefuelFlight?.rcsAuthority))
      ? Number(tankerRefuelFlight.rcsAuthority)
      : ((Number(tankerRefuelFlight?.rcsAccelKmS2) || 0) / 0.00025),
    0,
    1,
  );
  const tankerRcsJets = tankerRcsActive
    ? (
      Array.isArray(tankerRefuelFlight?.rcsJets) && tankerRefuelFlight.rcsJets.length > 0
        ? tankerRefuelFlight.rcsJets
        : (tankerRcsMode ? [tankerRcsMode] : [])
    )
    : [];
  const transferTankerId = String(refuel.transferTankerId || "");
  const transferActive = Boolean(refuel.transferActive);
  const fuelingActiveForBody = vehicleKind === "tanker"
    && transferActive
    && transferTankerId === bodyId;
  const tankerRcsOrbitCorrectionAccelKmS2 = Math.max(0, Number(tankerRefuelFlight?.rcsAccelKmS2) || 0);
  const tankerRcsOrbitCorrectionForceN = vehicleKind === "tanker"
    ? Math.max(0, (Number(bodyState.massKg) || 0) * tankerRcsOrbitCorrectionAccelKmS2 * 1000)
    : 0;
  const tankerAttitudeErrorDeg = Math.max(0, Number(tankerRefuelFlight?.attitudeErrorDeg) || 0);
  const tankerAttitudeAuthority = clamp(
    Number.isFinite(Number(tankerRefuelFlight?.attitudeAuthority))
      ? Number(tankerRefuelFlight.attitudeAuthority)
      : 1,
    0,
    1,
  );
  const tankerAttitudeLimited = Boolean(tankerRefuelFlight?.attitudeLimited);
  const tankerThrustAxisKm = finiteVector?.(tankerRefuelFlight?.attitudeAxisKm)
    ? {
      x: Number(tankerRefuelFlight.attitudeAxisKm.x) || 0,
      y: Number(tankerRefuelFlight.attitudeAxisKm.y) || 0,
      z: Number(tankerRefuelFlight.attitudeAxisKm.z) || 0,
    }
    : null;
  const tankerDesiredAxisKm = finiteVector?.(tankerRefuelFlight?.attitudeDesiredAxisKm)
    ? {
      x: Number(tankerRefuelFlight.attitudeDesiredAxisKm.x) || 0,
      y: Number(tankerRefuelFlight.attitudeDesiredAxisKm.y) || 0,
      z: Number(tankerRefuelFlight.attitudeDesiredAxisKm.z) || 0,
    }
    : null;

  return {
    ...baseSnapshot,
    bodyId,
    vehicleKind,
    vehicleName,
    phase,
    phaseLabel: typeof phaseLabel === "function" ? phaseLabel(phase) : phase,
    stageName: vehicleKind === "booster" ? "Booster" : "Tanker",
    stageIndex: vehicleKind === "booster" ? 0 : 1,
    elapsedSeconds: Number(runtime?.elapsedSeconds) || 0,
    massKg: Number(bodyState.massKg) || 0,
    altitudeKm,
    speedKmS: Number(orbital.speedKmS) || 0,
    radialSpeedKmS: Number(orbital.radialSpeedKmS) || 0,
    tangentialSpeedKmS: Number(orbital.tangentialSpeedKmS) || 0,
    circularSpeedKmS: Number(orbital.circularSpeedKmS) || 0,
    apoapsisKm,
    periapsisKm,
    timeToApoapsisSec: Number.isFinite(Number(orbital.timeToApoapsisSec))
      ? Number(orbital.timeToApoapsisSec)
      : null,
    throttle,
    thrustN,
    burnRateKgS,
    dynamicPressurePa,
    throttleCommand: throttle,
    guidanceMode: tankerGuidanceMode,
    autopilotMode: tankerGuidanceMode,
    missionId: vehicleKind === "tanker" ? tankerMissionId : runtime?.mission?.selectedId,
    missionName,
    missionPhase: vehicleKind === "tanker" ? "orbital_hold" : runtime?.mission?.phase,
    missionCompleted: false,
    stagePropellantKg: vehicleKind === "booster"
      ? (Number(runtime?.booster?.propellantKg) || 0)
      : 0,
    refuelRequiredFlights: Number(refuel.requiredFlights) || 0,
    refuelCompletedFlights: Number(refuel.completedFlights) || 0,
    refuelActiveFlights: Number(refuel.activeFlights) || 0,
    refuelLaunchedFlights: Number(refuel.launchedFlights) || 0,
    refuelTargetPropellantKg: Number(refuel.targetPropellantKg) || 0,
    refuelFillFraction: Number(refuel.fillFraction) || 0,
    refuelCanLaunchTanker: Boolean(refuel.refuelCanLaunchTanker),
    refuelTransferActive: transferActive,
    refuelTransferTankerId: transferTankerId,
    refuelTransferProgress: clamp(Number(refuel.transferProgress) || 0, 0, 1),
    refuelTransferRemainingKg: Math.max(0, Number(refuel.transferRemainingKg) || 0),
    refuelTransferRateKgS: Math.max(0, Number(refuel.transferRateKgS) || 0),
    refuelTransferLocked: Boolean(refuel.transferLocked),
    refuelUndockActive: Boolean(refuel.undockActive),
    refuelFuelingActive: fuelingActiveForBody,
    refuelLastAction: runtime?.refuel?.lastAction || "",
    refuelLastActionTimeSec: Number(runtime?.refuel?.lastActionTimeSec) || 0,
    moonRelativeSpeedKmS: null,
    moonProjectedMissDistanceKm: null,
    moonDepartureWindowScore: null,
    moonDepartureWindowWaitSec: null,
    moonDepartureWindowPhaseErrorDeg: null,
    moonDepartureGeometryScore: null,
    moonDepartureAlignNow: null,
    moonDepartureAlignProjected: null,
    moonEstimatedTliDeltaVKmS: null,
    moonDepartureWindowReady: false,
    moonDepartureWindowLaunchTimeMs: null,
    missionPhaseGateReason: "",
    targetBodyId: "earth",
    targetBodyName: "Earth",
    targetDistanceKm: Math.max(0, radialDistanceKm - earthRadiusKm),
    targetClosingSpeedKmS: radialClosingSpeedKmS,
    rcsActive: tankerRcsActive,
    rcsErrorDeg: vehicleKind === "tanker" ? tankerAttitudeErrorDeg : 0,
    rcsAuthority: tankerRcsAuthority,
    rcsJets: tankerRcsJets,
    rcsAttitudeAuthority: vehicleKind === "tanker" ? tankerAttitudeAuthority : 1,
    rcsAttitudeLimited: vehicleKind === "tanker" ? tankerAttitudeLimited : false,
    rcsThrustAxisKm: vehicleKind === "tanker" ? tankerThrustAxisKm : null,
    rcsDesiredAxisKm: vehicleKind === "tanker" ? tankerDesiredAxisKm : null,
    rcsOrbitCorrectionAccelKmS2: tankerRcsOrbitCorrectionAccelKmS2,
    rcsOrbitCorrectionForceN: tankerRcsOrbitCorrectionForceN,
    launchSiteName: LAUNCH_SITE.name || "Launch Site",
    statusLine: `${vehicleName} | ${inBoundOrbit ? "Orbital hold" : "Ballistic coast"}`,
  };
}
