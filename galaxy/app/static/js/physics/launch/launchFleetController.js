import {
  EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
  LAUNCH_SITE,
  SEA_LEVEL_PRESSURE_PA,
  STARSHIP_STACK_DIMENSIONS_KM,
  STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM,
  STANDARD_GRAVITY_M_S2,
} from "./launchConfig.js";
import {
  LAUNCH_MISSION_IDS,
  missionProfileById,
  normalizeMissionId,
} from "./launchMissions.js";
import {
  add,
  clamp,
  cross,
  dot,
  length,
  rad,
  normalize,
  scale,
  subtract,
} from "./launchMath.js";
import { orbitalStateFromRelative } from "./launchGuidance.js";
import { dynamicPressurePaFromAtmosphere } from "./launchAeroModel.js";
import {
  FLEET_MISSION_SHIP_ID_PREFIX,
  FLEET_MOON_CAPTURE_GATE_DISTANCE_KM,
  FLEET_MOON_TLI_DURATION_SEC,
} from "./launchFleetConfig.js";

function finiteVector(v) {
  return Boolean(
    v
    && Number.isFinite(Number(v.x))
    && Number.isFinite(Number(v.y))
    && Number.isFinite(Number(v.z)),
  );
}

function bodyStateFromNBody(state, bodyId) {
  return state?.dynamicBodies?.get(bodyId)
    || state?.staticSources?.get(bodyId)
    || null;
}

function fleetMissionNameForId(missionId) {
  return missionProfileById(normalizeMissionId(missionId))?.name || "Earth Orbit Hold";
}

function defaultPhaseLabel(phase) {
  if (phase === "powered") {
    return "Powered Ascent";
  }
  if (phase === "coast") {
    return "Coast";
  }
  if (phase === "orbit") {
    return "Orbit";
  }
  if (phase === "complete") {
    return "Mission Complete";
  }
  return "Idle";
}

function bodyDirectionFromLatLon(axes, latitudeDeg, longitudeDeg) {
  const lat = rad(latitudeDeg);
  const lon = rad(longitudeDeg);
  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const cosLon = Math.cos(lon);
  const sinLon = Math.sin(lon);
  const localX = cosLat * cosLon;
  const localY = cosLat * sinLon;
  const localZ = sinLat;
  return normalize({
    x: (axes.xAxis.x * localX) + (axes.yAxis.x * localY) + (axes.pole.x * localZ),
    y: (axes.xAxis.y * localX) + (axes.yAxis.y * localY) + (axes.pole.y * localZ),
    z: (axes.xAxis.z * localX) + (axes.yAxis.z * localY) + (axes.pole.z * localZ),
  }, { x: 0, y: 0, z: 1 });
}

function pressureRatio(pressurePa) {
  if (!Number.isFinite(pressurePa) || pressurePa <= 0) {
    return 0;
  }
  return clamp(pressurePa / SEA_LEVEL_PRESSURE_PA, 0, 1);
}

function interpolateSeaToVac(vacuumValue, seaLevelValue, pressurePa) {
  const vacuum = Number.isFinite(Number(vacuumValue)) ? Number(vacuumValue) : 0;
  const sea = Number.isFinite(Number(seaLevelValue)) ? Number(seaLevelValue) : vacuum;
  return vacuum - ((vacuum - sea) * pressureRatio(pressurePa));
}

export function createLaunchFleetController({
  runtime,
  stageAtIndex,
  minRocketMassKg = 500,
  getEarthRadiusKm,
  getEarthMassKg,
  getBodyRadiusKm,
  getBodyMassKg,
  sampleEarthAtmosphere,
  earthAxes,
  gravitationalConstantKm3PerKgS2,
  emitLaunchEvent,
} = {}) {
  const verticalAscentHoldSec = 22;
  const verticalAscentHoldMaxAltitudeKm = 14;

  function ensureFleetRuntimeState() {
    if (!runtime || typeof runtime !== "object") {
      return {
        nextShipSequence: 1,
        vehicles: new Map(),
      };
    }
    if (!runtime.fleet || typeof runtime.fleet !== "object") {
      runtime.fleet = {
        nextShipSequence: 1,
        vehicles: new Map(),
      };
      return runtime.fleet;
    }
    if (!(runtime.fleet.vehicles instanceof Map)) {
      runtime.fleet.vehicles = new Map();
    }
    runtime.fleet.nextShipSequence = Math.max(1, Number(runtime.fleet.nextShipSequence) || 1);
    return runtime.fleet;
  }

  function fleetVehicles() {
    return ensureFleetRuntimeState().vehicles;
  }

  function hasActiveVehicles() {
    return fleetVehicles().size > 0;
  }

  function removeVehicleById(state, bodyId, options = {}) {
    const id = String(bodyId || "").trim();
    if (!id) {
      return { removed: false, reason: "invalid_id" };
    }
    const vehicles = fleetVehicles();
    const vehicle = vehicles.get(id) || null;
    if (!vehicle) {
      return { removed: false, reason: "not_found" };
    }
    vehicles.delete(id);
    if (options?.preserveDynamicBody !== true) {
      state?.dynamicBodies?.delete?.(id);
    }
    if (typeof emitLaunchEvent === "function") {
      emitLaunchEvent("fleet_vehicle_removed", {
        shipId: id,
        vehicleRole: vehicle.vehicleRole || "mission",
        missionId: vehicle.missionId || LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD,
        missionPhase: vehicle.missionPhase || "unknown",
      });
    }
    return {
      removed: true,
      shipId: id,
      vehicleRole: vehicle.vehicleRole || "mission",
      vehicleName: vehicle.vehicleName || "Starship",
      missionId: vehicle.missionId || LAUNCH_MISSION_IDS.EARTH_ORBIT_HOLD,
      missionPhase: vehicle.missionPhase || "unknown",
    };
  }

  function refuelFlightById(bodyId) {
    const targetId = String(bodyId || "");
    if (!targetId) {
      return null;
    }
    const flights = Array.isArray(runtime?.refuel?.flights) ? runtime.refuel.flights : [];
    for (let i = 0; i < flights.length; i += 1) {
      const flight = flights[i];
      if (String(flight?.id || "") === targetId) {
        return flight;
      }
    }
    return null;
  }

  function reserveNextFleetMissionIdentity(state) {
    if (!state?.dynamicBodies) {
      return null;
    }
    const vehicles = fleetVehicles();
    const fleetState = ensureFleetRuntimeState();
    let sequenceNumber = Math.max(1, Number(fleetState.nextShipSequence) || 1);
    while (sequenceNumber < 1_000_000_000) {
      const id = `${FLEET_MISSION_SHIP_ID_PREFIX}${sequenceNumber}`;
      const existsInDynamics = state.dynamicBodies.has(id);
      const existsInFleet = vehicles.has(id);
      if (!existsInDynamics && !existsInFleet) {
        fleetState.nextShipSequence = sequenceNumber + 1;
        return { id, sequenceNumber };
      }
      sequenceNumber += 1;
    }
    return null;
  }

  function fleetPadSpawnState({
    earthState,
    sequenceNumber = 1,
    nowMs = Date.now(),
  }) {
    const earthRadiusKm = Math.max(1000, Number(getEarthRadiusKm?.()) || 6371);
    const axes = typeof earthAxes === "function"
      ? (earthAxes(nowMs) || { xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, pole: { x: 0, y: 0, z: 1 } })
      : { xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, pole: { x: 0, y: 0, z: 1 } };
    const slot = Math.max(0, Number(sequenceNumber) - 1);
    const row = Math.floor(slot / 3);
    const col = slot % 3;
    const latitudeOffsetDeg = (row * 0.032);
    const longitudeOffsetDeg = (col - 1) * 0.055;
    const latitudeDeg = clamp(Number(LAUNCH_SITE.latitudeDeg) + latitudeOffsetDeg, -85, 85);
    let longitudeDeg = Number(LAUNCH_SITE.longitudeDeg) + longitudeOffsetDeg;
    while (longitudeDeg > 180) {
      longitudeDeg -= 360;
    }
    while (longitudeDeg < -180) {
      longitudeDeg += 360;
    }
    const up = bodyDirectionFromLatLon(axes, latitudeDeg, longitudeDeg);
    const launchRadiusKm =
      earthRadiusKm
      + (Number(LAUNCH_SITE.altitudeKm) || 0)
      + Math.max(0, Number(STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM) || 0);
    const relPositionKm = scale(up, launchRadiusKm);
    const angularVelocity = scale(axes.pole || { x: 0, y: 0, z: 1 }, EARTH_SIDEREAL_ANGULAR_RATE_RAD_S);
    const rotationalVelocityKmS = cross(angularVelocity, relPositionKm);
    return {
      position: add(earthState.position, relPositionKm),
      velocity: add(earthState.velocity || { x: 0, y: 0, z: 0 }, rotationalVelocityKmS),
      latitudeDeg,
      longitudeDeg,
    };
  }

  function fleetOrbitInjectState({
    earthState,
    orbitAltitudeKm = 150,
    inclinationDeg = 28.5,
  }) {
    const earthRadiusKm = Math.max(1000, Number(getEarthRadiusKm?.()) || 6371);
    const muKm3S2 = Number(gravitationalConstantKm3PerKgS2) * (Number(getEarthMassKg?.()) || 0);
    if (!(muKm3S2 > 0)) {
      return null;
    }
    const targetAltitudeKm = Math.max(120, Number(orbitAltitudeKm) || 150);
    const orbitRadiusKm = earthRadiusKm + targetAltitudeKm;
    const circularSpeedKmS = Math.sqrt(muKm3S2 / orbitRadiusKm);
    const incRad = rad(clamp(Number(inclinationDeg) || 28.5, 0, 89.5));
    const phaseAngle = Math.random() * (Math.PI * 2);
    const cTheta = Math.cos(phaseAngle);
    const sTheta = Math.sin(phaseAngle);
    const cInc = Math.cos(incRad);
    const sInc = Math.sin(incRad);
    const relPositionKm = {
      x: orbitRadiusKm * cTheta,
      y: orbitRadiusKm * sTheta * cInc,
      z: orbitRadiusKm * sTheta * sInc,
    };
    const relVelocityDirection = normalize(
      {
        x: -sTheta,
        y: cTheta * cInc,
        z: cTheta * sInc,
      },
      { x: 0, y: 1, z: 0 },
    );
    const relVelocityKmS = scale(relVelocityDirection, circularSpeedKmS);
    return {
      position: add(earthState.position, relPositionKm),
      velocity: add(earthState.velocity || { x: 0, y: 0, z: 0 }, relVelocityKmS),
      orbitAltitudeKm: targetAltitudeKm,
      inclinationDeg: Number(inclinationDeg) || 28.5,
      injected: true,
    };
  }

  function launchMissionShip(
    state,
    missionId = runtime?.mission?.selectedId,
    nowMs = Date.now(),
    options = {},
  ) {
    if (!state?.dynamicBodies) {
      return { accepted: false, reason: "state_unavailable" };
    }
    const earthState = bodyStateFromNBody(state, "earth");
    if (
      !earthState
      || !finiteVector(earthState.position)
      || !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      return { accepted: false, reason: "earth_state_unavailable" };
    }
    const normalizedMissionId = normalizeMissionId(missionId);
    const vehicles = fleetVehicles();
    const vehicleRole = String(options?.vehicleRole || "mission").toLowerCase() === "tanker"
      ? "tanker"
      : "mission";
    const forcedId = String(options?.forcedId || "").trim();
    let identity = null;
    if (forcedId) {
      if (state.dynamicBodies.has(forcedId) || vehicles.has(forcedId)) {
        return { accepted: false, reason: "mission_ship_id_exhausted" };
      }
      const sequenceFromId = Number(String(forcedId).match(/_(\d+)$/)?.[1]);
      identity = {
        id: forcedId,
        sequenceNumber: Math.max(
          1,
          Number(options?.forcedSequenceNumber) || sequenceFromId || 1,
        ),
      };
    } else {
      identity = reserveNextFleetMissionIdentity(state);
      if (!identity) {
        return { accepted: false, reason: "mission_ship_id_exhausted" };
      }
    }
    const launchMode = String(options?.mode || "pad_launch").trim().toLowerCase() === "orbit_inject"
      ? "orbit_inject"
      : "pad_launch";
    const spawnState = launchMode === "orbit_inject"
      ? fleetOrbitInjectState({
        earthState,
        orbitAltitudeKm: Number(options?.orbitInjectAltitudeKm) || 150,
        inclinationDeg: Number(LAUNCH_SITE.latitudeDeg) || 28.5,
      })
      : fleetPadSpawnState({
        earthState,
        sequenceNumber: identity.sequenceNumber,
        nowMs,
      });
    if (!spawnState) {
      return {
        accepted: false,
        reason: launchMode === "orbit_inject" ? "orbit_inject_unavailable" : "spawn_pad_unavailable",
      };
    }

    const stage1Raw = typeof stageAtIndex === "function" ? stageAtIndex(0) : null;
    const stage2Raw = typeof stageAtIndex === "function" ? stageAtIndex(1) : null;
    const stageProfiles = [
      {
        name: String(stage1Raw?.name || "Stage 1"),
        dryMassKg: Math.max(50_000, Number(stage1Raw?.dryMassKg) || 200_000),
        propellantMassKg: Math.max(100_000, Number(stage1Raw?.propellantMassKg) || 3_400_000),
        thrustSeaLevelN: Math.max(0, Number(stage1Raw?.thrustSeaLevelN) || 0),
        thrustVacuumN: Math.max(0, Number(stage1Raw?.thrustVacuumN) || Number(stage1Raw?.thrustSeaLevelN) || 0),
        ispSeaLevelS: Math.max(1, Number(stage1Raw?.ispSeaLevelS) || 327),
        ispVacuumS: Math.max(1, Number(stage1Raw?.ispVacuumS) || Number(stage1Raw?.ispSeaLevelS) || 350),
      },
      {
        name: String(stage2Raw?.name || "Stage 2"),
        dryMassKg: Math.max(30_000, Number(stage2Raw?.dryMassKg) || 120_000),
        propellantMassKg: Math.max(100_000, Number(stage2Raw?.propellantMassKg) || 1_200_000),
        thrustSeaLevelN: Math.max(0, Number(stage2Raw?.thrustSeaLevelN) || 0),
        thrustVacuumN: Math.max(0, Number(stage2Raw?.thrustVacuumN) || Number(stage2Raw?.thrustSeaLevelN) || 0),
        ispSeaLevelS: Math.max(1, Number(stage2Raw?.ispSeaLevelS) || 353),
        ispVacuumS: Math.max(1, Number(stage2Raw?.ispVacuumS) || Number(stage2Raw?.ispSeaLevelS) || 380),
      },
    ];
    const injectedStageIndex = 1;
    const injectedStage = stageProfiles[injectedStageIndex] || stageProfiles[stageProfiles.length - 1];
    const initialMassKg = launchMode === "orbit_inject"
      ? (
        Math.max(0, Number(injectedStage?.dryMassKg) || 0)
        + Math.max(0, Number(injectedStage?.propellantMassKg) || 0)
      )
      : stageProfiles.reduce(
        (sum, stage) => sum + stage.dryMassKg + stage.propellantMassKg,
        0,
      );
    const bodyState = {
      id: identity.id,
      massKg: initialMassKg,
      position: { ...spawnState.position },
      velocity: { ...spawnState.velocity },
    };
    state.dynamicBodies.set(identity.id, bodyState);

    const missionPhase = launchMode === "orbit_inject"
      ? (
        vehicleRole === "tanker"
          ? "orbital_hold"
          : (
            normalizedMissionId === LAUNCH_MISSION_IDS.ORBITAL_REFUEL_DEMO
              ? "orbital_refuel"
              : (
            normalizedMissionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
              ? "tli_burn"
              : "earth_orbit_hold"
              )
          )
      )
      : "launch_to_parking";
    const vehicleName = String(options?.vehicleName || "").trim()
      || (vehicleRole === "tanker"
        ? `Starship Tanker ${identity.sequenceNumber}`
        : `Starship ${identity.sequenceNumber}`);
    const targetOrbitApoapsisKm = vehicleRole === "tanker"
      ? 160
      : (normalizedMissionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN ? 220 : 240);
    const targetOrbitPeriapsisKm = vehicleRole === "tanker"
      ? 150
      : (normalizedMissionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN ? 170 : 200);
    vehicles.set(identity.id, {
      id: identity.id,
      sequenceNumber: identity.sequenceNumber,
      vehicleRole,
      vehicleName,
      missionId: normalizedMissionId,
      missionPhase,
      missionCompleted: false,
      elapsedSeconds: 0,
      phaseElapsedSec: 0,
      stageProfiles,
      launchMode,
      stageIndex: launchMode === "orbit_inject" ? injectedStageIndex : 0,
      stagePropellantKg: launchMode === "orbit_inject"
        ? Math.max(0, Number(injectedStage?.propellantMassKg) || 0)
        : Math.max(0, Number(stageProfiles[0]?.propellantMassKg) || 0),
      dryMassKg: launchMode === "orbit_inject"
        ? Math.max(minRocketMassKg, Number(injectedStage?.dryMassKg) || minRocketMassKg)
        : stageProfiles.reduce((sum, stage) => sum + stage.dryMassKg, 0),
      propellantKg: launchMode === "orbit_inject"
        ? Math.max(0, Number(injectedStage?.propellantMassKg) || 0)
        : stageProfiles.reduce((sum, stage) => sum + stage.propellantMassKg, 0),
      tliDurationSec: FLEET_MOON_TLI_DURATION_SEC,
      guidanceMode: launchMode === "orbit_inject" ? "autopilot-ballistic-hold" : "autopilot-vertical-ascent",
      targetOrbitApoapsisKm,
      targetOrbitPeriapsisKm,
      launchLatitudeDeg: Number(spawnState.latitudeDeg),
      launchLongitudeDeg: Number(spawnState.longitudeDeg),
      lastStep: {
        accelerationKmS2: { x: 0, y: 0, z: 0 },
        throttle: 0,
        thrustN: 0,
        burnRateKgS: 0,
        burnKg: 0,
        guidanceMode: launchMode === "orbit_inject" ? "autopilot-ballistic-hold" : "autopilot-vertical-ascent",
        dynamicPressurePa: 0,
      },
      pendingBurnKg: 0,
      launchTimestampMs: nowMs,
    });

    const missionName = vehicleRole === "tanker"
      ? "Orbital Tanker Ops"
      : fleetMissionNameForId(normalizedMissionId);
    const shipMeta = {
      id: identity.id,
      name: vehicleRole === "tanker" ? vehicleName : `${vehicleName} (${missionName})`,
      body_type: "spacecraft",
      parent: "earth",
      radius_km: STARSHIP_STACK_DIMENSIONS_KM.diameterKm * 0.5,
      mass_kg: initialMassKg,
      semimajor_axis_km: null,
      orbital_period_days: null,
      phase: 0,
      description: vehicleRole === "tanker"
        ? "Pad-launched orbital tanker Starship."
        : `Pad-launched autonomous Starship assigned to ${missionName}.`,
    };

    if (typeof emitLaunchEvent === "function") {
      if (vehicleRole === "tanker") {
        emitLaunchEvent("refuel_tanker_fleet_launch_started", {
          tankerId: identity.id,
          sequenceNumber: identity.sequenceNumber,
          missionId: normalizedMissionId,
          missionPhase,
          launchMode,
        });
      } else {
        emitLaunchEvent("fleet_mission_ship_launched", {
          shipId: identity.id,
          sequenceNumber: identity.sequenceNumber,
          missionId: normalizedMissionId,
          missionPhase,
          launchMode: launchMode === "orbit_inject" ? "orbit_inject_fleet" : "pad_fleet",
          orbitInjectAltitudeKm: launchMode === "orbit_inject"
            ? Number(spawnState.orbitAltitudeKm)
            : null,
        });
      }
    }

    return {
      accepted: true,
      shipId: identity.id,
      shipMeta,
      missionId: normalizedMissionId,
      missionPhase,
      vehicleRole,
      launchMode,
      orbitInjectAltitudeKm: launchMode === "orbit_inject"
        ? Number(spawnState.orbitAltitudeKm)
        : null,
    };
  }

  function setFleetMissionPhase(vehicle, nextPhase, details = {}) {
    const phaseName = String(nextPhase || "").trim();
    if (!vehicle || !phaseName || vehicle.missionPhase === phaseName) {
      return;
    }
    const previousPhase = vehicle.missionPhase;
    vehicle.missionPhase = phaseName;
    vehicle.phaseElapsedSec = 0;
    if (typeof emitLaunchEvent === "function") {
      emitLaunchEvent("fleet_mission_phase_changed", {
        shipId: vehicle.id,
        missionId: vehicle.missionId,
        fromMissionPhase: previousPhase,
        toMissionPhase: phaseName,
        ...details,
      });
    }
  }

  function prepareStep(state, dtSeconds, nowMs = Date.now()) {
    if (!hasActiveVehicles()) {
      return;
    }
    const earthState = bodyStateFromNBody(state, "earth");
    if (
      !earthState
      || !finiteVector(earthState.position)
      || !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      return;
    }
    const currentEarthAxes = typeof earthAxes === "function"
      ? (earthAxes(nowMs) || { pole: { x: 0, y: 0, z: 1 } })
      : { pole: { x: 0, y: 0, z: 1 } };
    const earthPole = currentEarthAxes?.pole || { x: 0, y: 0, z: 1 };
    const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
    const earthMuKm3S2 = Number(gravitationalConstantKm3PerKgS2)
      * (Number(getEarthMassKg?.()) || Number(earthState.massKg) || 0);
    const moonState = bodyStateFromNBody(state, "moon");
    const removeIds = [];
    const safeDtSeconds = Math.max(0, Number(dtSeconds) || 0);
    const vehicles = fleetVehicles();
    for (const [shipId, vehicle] of vehicles.entries()) {
      const shipState = state?.dynamicBodies?.get?.(shipId);
      if (
        !shipState
        || !finiteVector(shipState.position)
        || !finiteVector(shipState.velocity || { x: 0, y: 0, z: 0 })
      ) {
        removeIds.push(shipId);
        continue;
      }

      const relPos = subtract(shipState.position, earthState.position);
      const relVel = subtract(
        shipState.velocity || { x: 0, y: 0, z: 0 },
        earthState.velocity || { x: 0, y: 0, z: 0 },
      );
      const altitudeKm = Math.max(0, length(relPos) - earthRadiusKm);
      const atmosphereSample = sampleEarthAtmosphere?.(altitudeKm) || null;
      const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
        atmosphereSample,
        relPos,
        relVel,
        earthPole,
      );
      const up = normalize(relPos, earthPole);
      const prograde = normalize(relVel, up);
      const orbital = earthMuKm3S2 > 0
        ? orbitalStateFromRelative(earthMuKm3S2, earthRadiusKm, relPos, relVel)
        : {
          altitudeKm,
          apoapsisKm: Number.NaN,
          periapsisKm: Number.NaN,
          timeToApoapsisSec: Number.NaN,
          specificEnergy: Number.NaN,
        };
      const stageProfiles = Array.isArray(vehicle.stageProfiles) && vehicle.stageProfiles.length >= 2
        ? vehicle.stageProfiles
        : [
          {
            name: "Stage 1",
            dryMassKg: 200_000,
            propellantMassKg: 3_400_000,
            thrustSeaLevelN: 74_000_000,
            thrustVacuumN: 77_000_000,
            ispSeaLevelS: 327,
            ispVacuumS: 350,
          },
          {
            name: "Stage 2",
            dryMassKg: 120_000,
            propellantMassKg: 1_200_000,
            thrustSeaLevelN: 6_900_000,
            thrustVacuumN: 15_600_000,
            ispSeaLevelS: 353,
            ispVacuumS: 380,
          },
        ];
      let activeStageIndex = Math.max(0, Math.min(1, Number(vehicle.stageIndex) || 0));
      vehicle.stageIndex = activeStageIndex;
      const activeStage = stageProfiles[activeStageIndex] || null;
      if (!Number.isFinite(Number(vehicle.stagePropellantKg))) {
        vehicle.stagePropellantKg = Math.max(
          0,
          Number(activeStage?.propellantMassKg) || Number(vehicle.propellantKg) || 0,
        );
      }
      const availablePropellantKg = Math.max(0, Number(vehicle.stagePropellantKg) || 0);
      let desiredDirection = prograde;
      let requestedThrottle = 0;
      let guidanceMode = "autopilot-orbital-hold";
      const targetApoapsisKm = Math.max(160, Number(vehicle.targetOrbitApoapsisKm) || 240);
      const targetPeriapsisKm = Math.max(120, Number(vehicle.targetOrbitPeriapsisKm) || 200);
      const apoapsisKm = Number(orbital?.apoapsisKm);
      const periapsisKm = Number(orbital?.periapsisKm);
      const timeToApoapsisSec = Number(orbital?.timeToApoapsisSec);
      const parkingReady = Number(orbital?.specificEnergy) < 0
        && apoapsisKm >= targetApoapsisKm
        && periapsisKm >= targetPeriapsisKm;

      if (vehicle.missionPhase === "launch_to_parking") {
        const verticalHoldActive = (Number(vehicle.phaseElapsedSec) || 0) < verticalAscentHoldSec
          && altitudeKm < verticalAscentHoldMaxAltitudeKm;
        const climbBlend = clamp((altitudeKm - 2) / 46, 0, 1);
        const gravityTurnDirection = normalize(
          add(scale(up, 1 - climbBlend), scale(prograde, climbBlend)),
          up,
        );
        const needsApoapsisRaise = !Number.isFinite(apoapsisKm) || apoapsisKm < (targetApoapsisKm - 8);
        const nearApoapsis = Number.isFinite(timeToApoapsisSec) && Math.abs(timeToApoapsisSec) < 240;
        const needsPeriapsisRaise = !Number.isFinite(periapsisKm) || periapsisKm < (targetPeriapsisKm - 6);
        if (parkingReady) {
          requestedThrottle = 0;
          desiredDirection = prograde;
          guidanceMode = "autopilot-parking-orbit-hold";
        } else if (verticalHoldActive) {
          desiredDirection = up;
          requestedThrottle = 0.97;
          guidanceMode = "autopilot-vertical-ascent";
        } else if (activeStageIndex === 0) {
          desiredDirection = needsApoapsisRaise ? gravityTurnDirection : prograde;
          requestedThrottle = needsApoapsisRaise ? 0.96 : 0.62;
          guidanceMode = needsApoapsisRaise ? "autopilot-gravity-turn" : "autopilot-coast-to-apoapsis";
        } else if (needsPeriapsisRaise && nearApoapsis) {
          desiredDirection = prograde;
          requestedThrottle = 0.78;
          guidanceMode = "autopilot-circularization-burn";
        } else if (needsApoapsisRaise) {
          desiredDirection = gravityTurnDirection;
          requestedThrottle = 0.72;
          guidanceMode = "autopilot-apoapsis-raise";
        } else {
          requestedThrottle = 0;
          desiredDirection = prograde;
          guidanceMode = "autopilot-coast-to-apoapsis";
        }
        if (dynamicPressurePa > 48_000) {
          requestedThrottle = Math.min(requestedThrottle, 0.62);
          guidanceMode = "autopilot-max-q-limit";
        }
      } else if (vehicle.vehicleRole === "tanker" && vehicle.missionPhase === "orbital_hold") {
        requestedThrottle = 0;
        desiredDirection = prograde;
        guidanceMode = "autopilot-orbital-hold";
      } else if (vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN && !vehicle.missionCompleted) {
        if (vehicle.missionPhase === "tli_burn") {
          const toMoon = moonState?.position
            ? normalize(subtract(moonState.position, shipState.position), prograde)
            : prograde;
          desiredDirection = normalize(
            add(scale(prograde, 0.72), scale(toMoon, 0.28)),
            prograde,
          );
          const phaseProgress = clamp(
            (Number(vehicle.phaseElapsedSec) || 0) / Math.max(1, Number(vehicle.tliDurationSec) || FLEET_MOON_TLI_DURATION_SEC),
            0,
            1,
          );
          requestedThrottle = clamp(0.84 - (phaseProgress * 0.22), 0.56, 0.84);
          guidanceMode = "autopilot-tli-burn";
        } else if (vehicle.missionPhase === "lunar_capture") {
          if (moonState?.velocity && moonState?.position) {
            const moonRelVel = subtract(
              shipState.velocity || { x: 0, y: 0, z: 0 },
              moonState.velocity || { x: 0, y: 0, z: 0 },
            );
            desiredDirection = normalize(scale(moonRelVel, -1), prograde);
            requestedThrottle = 0.36;
            guidanceMode = "autopilot-lunar-capture";
          } else {
            guidanceMode = "autopilot-coast-to-moon";
          }
        } else if (vehicle.missionPhase === "lunar_orbit_hold") {
          guidanceMode = "autopilot-lunar-orbit-hold";
        } else {
          guidanceMode = "autopilot-coast-to-moon";
        }
      }

      if (availablePropellantKg <= 1e-6) {
        requestedThrottle = 0;
      }
      const ambientPressurePa = Number(atmosphereSample?.pressurePa) || 0;
      const stageThrustVacuumN = Math.max(0, Number(activeStage?.thrustVacuumN) || 0);
      const stageThrustSeaLevelN = Math.max(0, Number(activeStage?.thrustSeaLevelN) || stageThrustVacuumN);
      const thrustPerThrottleN = interpolateSeaToVac(
        stageThrustVacuumN,
        stageThrustSeaLevelN,
        ambientPressurePa,
      );
      const thrustN = requestedThrottle > 1e-6
        ? thrustPerThrottleN * requestedThrottle
        : 0;
      const stageIspVacuumS = Math.max(1, Number(activeStage?.ispVacuumS) || 360);
      const stageIspSeaLevelS = Math.max(1, Number(activeStage?.ispSeaLevelS) || stageIspVacuumS);
      const ispS = Math.max(
        1,
        interpolateSeaToVac(stageIspVacuumS, stageIspSeaLevelS, ambientPressurePa),
      );
      const burnRateKgS = thrustN > 0
        ? thrustN / (ispS * STANDARD_GRAVITY_M_S2)
        : 0;
      const burnKg = Math.min(availablePropellantKg, burnRateKgS * safeDtSeconds);
      const effectiveMassKg = Math.max(
        minRocketMassKg,
        (Number(shipState.massKg) || minRocketMassKg) - (0.5 * burnKg),
      );
      const accelerationMagnitudeKmS2 = thrustN > 0
        ? (thrustN / effectiveMassKg) / 1000
        : 0;
      vehicle.pendingBurnKg = burnKg;
      vehicle.guidanceMode = guidanceMode;
      vehicle.lastStep = {
        accelerationKmS2: scale(desiredDirection, accelerationMagnitudeKmS2),
        throttle: requestedThrottle,
        thrustN,
        burnRateKgS,
        burnKg,
        guidanceMode,
        dynamicPressurePa,
        stageIndex: activeStageIndex,
        stageName: activeStage?.name || `Stage ${activeStageIndex + 1}`,
      };
    }
    for (let i = 0; i < removeIds.length; i += 1) {
      vehicles.delete(removeIds[i]);
    }
  }

  function finalizeStep(state, dtSeconds, nowMs = Date.now()) {
    if (!hasActiveVehicles()) {
      return;
    }
    const earthState = bodyStateFromNBody(state, "earth");
    if (
      !earthState
      || !finiteVector(earthState.position)
      || !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      return;
    }
    const moonState = bodyStateFromNBody(state, "moon");
    const moonMassKg = Number(getBodyMassKg?.("moon")) || Number(moonState?.massKg) || 7.342e22;
    const moonRadiusKm = Number(getBodyRadiusKm?.("moon")) || 1737.4;
    const moonMuKm3S2 = Number(gravitationalConstantKm3PerKgS2) * moonMassKg;
    const removeIds = [];
    const safeDtSeconds = Math.max(0, Number(dtSeconds) || 0);
    const vehicles = fleetVehicles();

    for (const [shipId, vehicle] of vehicles.entries()) {
      const shipState = state?.dynamicBodies?.get?.(shipId);
      if (
        !shipState
        || !finiteVector(shipState.position)
        || !finiteVector(shipState.velocity || { x: 0, y: 0, z: 0 })
      ) {
        removeIds.push(shipId);
        continue;
      }
      const stageProfiles = Array.isArray(vehicle.stageProfiles) && vehicle.stageProfiles.length >= 2
        ? vehicle.stageProfiles
        : [
          {
            name: "Stage 1",
            dryMassKg: 200_000,
            propellantMassKg: 3_400_000,
          },
          {
            name: "Stage 2",
            dryMassKg: 120_000,
            propellantMassKg: 1_200_000,
          },
        ];
      const stageCount = stageProfiles.length;
      let stageIndex = Math.max(0, Math.min(stageCount - 1, Number(vehicle.stageIndex) || 0));
      const activeStage = stageProfiles[stageIndex] || stageProfiles[stageCount - 1];
      if (!Number.isFinite(Number(vehicle.stagePropellantKg))) {
        vehicle.stagePropellantKg = Math.max(
          0,
          Number(activeStage?.propellantMassKg) || Number(vehicle.propellantKg) || 0,
        );
      }
      const burnKg = Math.max(0, Number(vehicle.pendingBurnKg) || Number(vehicle.lastStep?.burnKg) || 0);
      if (burnKg > 0) {
        shipState.massKg = Math.max(
          Math.max(minRocketMassKg, Number(vehicle.dryMassKg) || minRocketMassKg),
          (Number(shipState.massKg) || minRocketMassKg) - burnKg,
        );
        vehicle.propellantKg = Math.max(0, (Number(vehicle.propellantKg) || 0) - burnKg);
        vehicle.stagePropellantKg = Math.max(0, (Number(vehicle.stagePropellantKg) || 0) - burnKg);
      }
      vehicle.pendingBurnKg = 0;
      vehicle.elapsedSeconds = Math.max(0, Number(vehicle.elapsedSeconds) || 0) + safeDtSeconds;
      vehicle.phaseElapsedSec = Math.max(0, Number(vehicle.phaseElapsedSec) || 0) + safeDtSeconds;

      const stageDepleted = (Number(vehicle.stagePropellantKg) || 0) <= 1e-3;
      if (stageDepleted && stageIndex < (stageCount - 1)) {
        const droppedDryMassKg = Math.max(0, Number(activeStage?.dryMassKg) || 0);
        shipState.massKg = Math.max(minRocketMassKg, (Number(shipState.massKg) || minRocketMassKg) - droppedDryMassKg);
        vehicle.dryMassKg = Math.max(
          minRocketMassKg,
          (Number(vehicle.dryMassKg) || minRocketMassKg) - droppedDryMassKg,
        );
        stageIndex += 1;
        vehicle.stageIndex = stageIndex;
        const nextStage = stageProfiles[stageIndex] || stageProfiles[stageCount - 1];
        vehicle.stagePropellantKg = Math.max(0, Number(nextStage?.propellantMassKg) || 0);
        if (typeof emitLaunchEvent === "function") {
          emitLaunchEvent("fleet_mission_stage_changed", {
            shipId: vehicle.id,
            missionId: vehicle.missionId,
            stageIndex,
            stageName: nextStage?.name || `Stage ${stageIndex + 1}`,
          });
        }
      }

      const earthRelPos = subtract(shipState.position, earthState.position);
      const earthRelVel = subtract(
        shipState.velocity || { x: 0, y: 0, z: 0 },
        earthState.velocity || { x: 0, y: 0, z: 0 },
      );
      const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
      const earthMuKm3S2 = Number(gravitationalConstantKm3PerKgS2)
        * (Number(getEarthMassKg?.()) || Number(earthState.massKg) || 0);
      const earthOrbit = earthMuKm3S2 > 0
        ? orbitalStateFromRelative(earthMuKm3S2, earthRadiusKm, earthRelPos, earthRelVel)
        : null;
      const targetApoapsisKm = Math.max(160, Number(vehicle.targetOrbitApoapsisKm) || 240);
      const targetPeriapsisKm = Math.max(120, Number(vehicle.targetOrbitPeriapsisKm) || 200);
      const parkingReady = Number(earthOrbit?.specificEnergy) < 0
        && Number(earthOrbit?.apoapsisKm) >= targetApoapsisKm
        && Number(earthOrbit?.periapsisKm) >= targetPeriapsisKm;
      if (vehicle.missionPhase === "launch_to_parking" && parkingReady) {
        if (vehicle.vehicleRole === "tanker") {
          setFleetMissionPhase(vehicle, "orbital_hold", {
            orbitApoapsisKm: Number(earthOrbit?.apoapsisKm),
            orbitPeriapsisKm: Number(earthOrbit?.periapsisKm),
          });
        } else if (vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN) {
          setFleetMissionPhase(vehicle, "tli_burn", {
            orbitApoapsisKm: Number(earthOrbit?.apoapsisKm),
            orbitPeriapsisKm: Number(earthOrbit?.periapsisKm),
          });
        } else {
          setFleetMissionPhase(vehicle, "earth_orbit_hold", {
            orbitApoapsisKm: Number(earthOrbit?.apoapsisKm),
            orbitPeriapsisKm: Number(earthOrbit?.periapsisKm),
          });
        }
      }

      if (vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN && !vehicle.missionCompleted) {
        if (vehicle.missionPhase === "tli_burn") {
          const tliDurationSec = Math.max(60, Number(vehicle.tliDurationSec) || FLEET_MOON_TLI_DURATION_SEC);
          if (vehicle.phaseElapsedSec >= tliDurationSec || (Number(vehicle.propellantKg) || 0) <= 1e-3) {
            setFleetMissionPhase(vehicle, "coast_to_moon");
          }
        }

        const moonRelPos = moonState?.position
          ? subtract(shipState.position, moonState.position)
          : null;
        const moonRelVel = moonState?.velocity
          ? subtract(
            shipState.velocity || { x: 0, y: 0, z: 0 },
            moonState.velocity || { x: 0, y: 0, z: 0 },
          )
          : null;
        const moonDistanceKm = moonRelPos ? length(moonRelPos) : Number.POSITIVE_INFINITY;
        if (vehicle.missionPhase === "coast_to_moon" && moonDistanceKm <= FLEET_MOON_CAPTURE_GATE_DISTANCE_KM) {
          setFleetMissionPhase(vehicle, "lunar_capture", {
            moonDistanceKm,
          });
        }
        if (
          vehicle.missionPhase === "lunar_capture"
          && moonRelPos
          && moonRelVel
          && moonMuKm3S2 > 0
        ) {
          const moonOrbit = orbitalStateFromRelative(moonMuKm3S2, moonRadiusKm, moonRelPos, moonRelVel);
          const captureReady =
            Number(moonOrbit.specificEnergy) < 0
            && Number(moonOrbit.periapsisKm) > 35
            && Number(moonOrbit.apoapsisKm) < 30_000;
          if (captureReady) {
            setFleetMissionPhase(vehicle, "lunar_orbit_hold", {
              moonApoapsisKm: Number(moonOrbit.apoapsisKm),
              moonPeriapsisKm: Number(moonOrbit.periapsisKm),
            });
            vehicle.missionCompleted = true;
          }
        }
      }
    }
    for (let i = 0; i < removeIds.length; i += 1) {
      vehicles.delete(removeIds[i]);
    }
  }

  function statusSnapshotForBody({
    state,
    bodyId = "",
    nowMs = Date.now(),
    baseSnapshot = {},
    phaseLabel = defaultPhaseLabel,
  } = {}) {
    const vehicle = fleetVehicles().get(String(bodyId || "")) || null;
    if (!vehicle) {
      return null;
    }
    const safeBaseSnapshot = (baseSnapshot && typeof baseSnapshot === "object")
      ? baseSnapshot
      : {};
    const phaseLabelFn = typeof phaseLabel === "function"
      ? phaseLabel
      : defaultPhaseLabel;
    const shipState = state?.dynamicBodies?.get?.(vehicle.id) || null;
    const earthState = bodyStateFromNBody(state, "earth");
    if (
      !shipState
      || !earthState
      || !finiteVector(shipState.position)
      || !finiteVector(shipState.velocity || { x: 0, y: 0, z: 0 })
      || !finiteVector(earthState.position)
      || !finiteVector(earthState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      const vehicleKind = vehicle.vehicleRole === "tanker" ? "tanker" : "starship";
      return {
        ...safeBaseSnapshot,
        bodyId: vehicle.id,
        vehicleKind,
        vehicleName: vehicle.vehicleName || "Starship",
        launchMode: String(vehicle.launchMode || "pad_launch"),
        refuelTransferActive: false,
        refuelTransferTankerId: "",
        refuelTransferProgress: 0,
        refuelTransferRemainingKg: 0,
        refuelTransferRateKgS: 0,
        refuelTransferLocked: false,
        refuelUndockActive: false,
        refuelFuelingActive: false,
        statusLine: `${vehicle.vehicleName || "Starship"} telemetry unavailable.`,
      };
    }

    const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
    const muKm3S2 = Number(gravitationalConstantKm3PerKgS2) * (Number(getEarthMassKg?.()) || 0);
    const relPos = subtract(shipState.position, earthState.position);
    const relVel = subtract(
      shipState.velocity || { x: 0, y: 0, z: 0 },
      earthState.velocity || { x: 0, y: 0, z: 0 },
    );
    const orbital = orbitalStateFromRelative(muKm3S2, earthRadiusKm, relPos, relVel);
    const currentEarthAxes = typeof earthAxes === "function"
      ? (earthAxes(nowMs) || { pole: { x: 0, y: 0, z: 1 } })
      : { pole: { x: 0, y: 0, z: 1 } };
    const earthPole = currentEarthAxes?.pole || { x: 0, y: 0, z: 1 };
    const atmosphereSample = sampleEarthAtmosphere?.(Math.max(0, Number(orbital.altitudeKm) || 0)) || null;
    const dynamicPressurePa = dynamicPressurePaFromAtmosphere(
      atmosphereSample,
      relPos,
      relVel,
      earthPole,
    );

    let targetBodyId = "earth";
    let targetBodyName = "Earth";
    let targetDistanceKm = Math.max(0, length(relPos) - earthRadiusKm);
    let targetClosingSpeedKmS = null;
    const moonState = bodyStateFromNBody(state, "moon");
    if (
      vehicle.missionId === LAUNCH_MISSION_IDS.MOON_ORBIT_RETURN
      && moonState
      && finiteVector(moonState.position)
      && finiteVector(moonState.velocity || { x: 0, y: 0, z: 0 })
    ) {
      const moonRelPos = subtract(shipState.position, moonState.position);
      const moonRelVel = subtract(
        shipState.velocity || { x: 0, y: 0, z: 0 },
        moonState.velocity || { x: 0, y: 0, z: 0 },
      );
      const moonDistanceKm = length(moonRelPos);
      targetBodyId = "moon";
      targetBodyName = "Moon";
      targetDistanceKm = moonDistanceKm;
      targetClosingSpeedKmS = moonDistanceKm > 1e-9
        ? -dot(moonRelVel, scale(moonRelPos, 1 / moonDistanceKm))
        : null;
    } else {
      const earthDistanceKm = length(relPos);
      targetClosingSpeedKmS = earthDistanceKm > 1e-9
        ? -dot(relVel, scale(relPos, 1 / earthDistanceKm))
        : null;
    }

    const stageProfiles = Array.isArray(vehicle.stageProfiles) && vehicle.stageProfiles.length >= 2
      ? vehicle.stageProfiles
      : [
        { name: "Stage 1", propellantMassKg: 3_400_000 },
        { name: "Stage 2", propellantMassKg: 1_200_000 },
      ];
    const stageIndex = Math.max(0, Math.min(stageProfiles.length - 1, Number(vehicle.stageIndex) || 0));
    const stageName = String(stageProfiles[stageIndex]?.name || `Stage ${stageIndex + 1}`);
    const throttle = Number(vehicle.lastStep?.throttle) || 0;
    const phase = throttle > 1e-3
      ? "powered"
      : (vehicle.missionPhase === "launch_to_parking" ? "coast" : "orbit");
    const missionName = vehicle.vehicleRole === "tanker"
      ? "Orbital Tanker Ops"
      : fleetMissionNameForId(vehicle.missionId);
    const vehicleKind = vehicle.vehicleRole === "tanker" ? "tanker" : "starship";
    const refuelFlight = refuelFlightById(vehicle.id);
    const flightRcsActive = Boolean(refuelFlight?.rcsActive);
    const flightRcsMode = String(refuelFlight?.rcsMode || "").trim();
    const transferActive = Boolean(runtime?.refuel?.transferActive);
    const transferTankerId = String(runtime?.refuel?.transferTankerId || "");
    const refuelTransferProgress = clamp(Number(runtime?.refuel?.transferProgress) || 0, 0, 1);
    const refuelTransferRemainingKg = Math.max(0, Number(runtime?.refuel?.transferRemainingKg) || 0);
    const refuelTransferRateKgS = Math.max(0, Number(runtime?.refuel?.transferRateKgS) || 0);
    const fuelingActiveForBody = vehicleKind === "tanker"
      && transferActive
      && transferTankerId === vehicle.id;
    const baseGuidanceMode = vehicle.guidanceMode || vehicle.lastStep?.guidanceMode || "autopilot-orbital-hold";
    const guidanceMode = flightRcsMode
      ? `${baseGuidanceMode}:${flightRcsMode}`
      : baseGuidanceMode;
    const rcsAuthority = clamp(
      Number.isFinite(Number(refuelFlight?.rcsAuthority))
        ? Number(refuelFlight.rcsAuthority)
        : ((Number(refuelFlight?.rcsAccelKmS2) || 0) / 0.00025),
      0,
      1,
    );
    const rcsJets = flightRcsActive
      ? (
        Array.isArray(refuelFlight?.rcsJets) && refuelFlight.rcsJets.length > 0
          ? refuelFlight.rcsJets
          : (flightRcsMode ? [flightRcsMode] : [])
      )
      : [];
    const rcsOrbitCorrectionAccelKmS2 = Math.max(0, Number(refuelFlight?.rcsAccelKmS2) || 0);
    const rcsOrbitCorrectionForceN = vehicleKind === "tanker"
      ? Math.max(0, (Number(shipState.massKg) || 0) * rcsOrbitCorrectionAccelKmS2 * 1000)
      : 0;
    return {
      ...safeBaseSnapshot,
      bodyId: vehicle.id,
      vehicleKind,
      vehicleName: vehicle.vehicleName || "Starship",
      launchMode: String(vehicle.launchMode || "pad_launch"),
      phase,
      phaseLabel: phaseLabelFn(phase),
      stageName,
      stageIndex,
      elapsedSeconds: Number(vehicle.elapsedSeconds) || 0,
      massKg: Number(shipState.massKg) || 0,
      altitudeKm: Math.max(0, Number(orbital.altitudeKm) || 0),
      speedKmS: Number(orbital.speedKmS) || 0,
      radialSpeedKmS: Number(orbital.radialSpeedKmS) || 0,
      tangentialSpeedKmS: Number(orbital.tangentialSpeedKmS) || 0,
      circularSpeedKmS: Number(orbital.circularSpeedKmS) || 0,
      apoapsisKm: Number.isFinite(Number(orbital.apoapsisKm)) ? Number(orbital.apoapsisKm) : null,
      periapsisKm: Number.isFinite(Number(orbital.periapsisKm)) ? Number(orbital.periapsisKm) : null,
      timeToApoapsisSec: Number.isFinite(Number(orbital.timeToApoapsisSec))
        ? Number(orbital.timeToApoapsisSec)
        : null,
      throttle,
      thrustN: Number(vehicle.lastStep?.thrustN) || 0,
      burnRateKgS: Number(vehicle.lastStep?.burnRateKgS) || 0,
      dynamicPressurePa: Number(vehicle.lastStep?.dynamicPressurePa) || dynamicPressurePa,
      throttleCommand: throttle,
      guidanceMode,
      autopilotMode: guidanceMode,
      missionId: vehicle.missionId,
      missionName,
      missionPhase: vehicle.missionPhase,
      missionCompleted: Boolean(vehicle.missionCompleted),
      stagePropellantKg: Math.max(0, Number(vehicle.stagePropellantKg) || 0),
      refuelRequiredFlights: 0,
      refuelCompletedFlights: 0,
      refuelActiveFlights: 0,
      refuelLaunchedFlights: 0,
      refuelTargetPropellantKg: 0,
      refuelFillFraction: 0,
      refuelCanLaunchTanker: false,
      refuelTransferActive: transferActive,
      refuelTransferTankerId: transferTankerId,
      refuelTransferProgress,
      refuelTransferRemainingKg,
      refuelTransferRateKgS,
      refuelTransferLocked: transferActive,
      refuelUndockActive: Boolean(runtime?.refuel?.undockActive),
      refuelFuelingActive: fuelingActiveForBody,
      refuelLastAction: "",
      refuelLastActionTimeSec: 0,
      boosterDistanceKm: null,
      starshipDistanceKm: null,
      boosterPhase: null,
      boosterGuidanceMode: null,
      boosterActive: false,
      boosterLanded: false,
      boosterThrottle: 0,
      boosterThrustN: 0,
      boosterRcsActive: false,
      boosterRcsErrorDeg: 0,
      boosterRcsAuthority: 0,
      boosterRcsJets: [],
      boosterPressurePa: null,
      boosterDensityKgM3: null,
      boosterDynamicPressurePa: null,
      boosterThrottleCommand: 0,
      boosterAngleOfAttackDeg: 0,
      boosterQAlphaPaRad: 0,
      boosterMachNumber: 0,
      boosterDragCoefficient: 0,
      boosterLiftCoefficient: 0,
      boosterGimbalErrorDeg: 0,
      boosterWindSpeedKmS: 0,
      boosterWindEastMS: 0,
      boosterWindNorthMS: 0,
      boosterComNormalized: 0,
      boosterInertiaNormalized: 0,
      boosterControlAuthorityScale: 0,
      boosterAltitudeKm: null,
      boosterSpeedKmS: null,
      boosterAltitudeAboveTerrainKm: null,
      boosterPropellantKg: 0,
      boosterInitialPropellantKg: 0,
      boosterFuelFraction: null,
      boosterLaunchSiteRangeKm: null,
      boosterLaunchSiteLateralRangeKm: null,
      boosterLaunchSiteLateralClosingSpeedKmS: null,
      hotstageActive: false,
      hotstageTimeSinceIgnitionSec: null,
      hotstageOverlapSeconds: null,
      hotstageIgnitionStableSec: null,
      hotstageVirtualSeparationKm: null,
      hotstageDetachReason: null,
      terrainElevationKm: null,
      altitudeAboveTerrainKm: null,
      latitudeDeg: null,
      longitudeDeg: null,
      targetBodyId,
      targetBodyName,
      targetDistanceKm,
      targetClosingSpeedKmS,
      rcsActive: flightRcsActive,
      rcsErrorDeg: 0,
      rcsAuthority,
      rcsJets,
      rcsOrbitCorrectionAccelKmS2,
      rcsOrbitCorrectionForceN,
      launchSiteName: LAUNCH_SITE.name || "Launch Site",
      statusLine: `${vehicle.vehicleName || "Starship"} | ${vehicle.missionPhase || "coast"}`,
    };
  }

  function externalAccelerationKmS2(bodyId) {
    const fleetStep = fleetVehicles().get(String(bodyId || ""))?.lastStep;
    if (fleetStep?.accelerationKmS2) {
      return fleetStep.accelerationKmS2;
    }
    return { x: 0, y: 0, z: 0 };
  }

  return {
    hasActiveVehicles,
    launchMissionShip,
    removeVehicleById,
    prepareStep,
    finalizeStep,
    statusSnapshotForBody,
    externalAccelerationKmS2,
  };
}
