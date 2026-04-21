import {
  add,
  clamp,
  dot,
  finiteVector,
  length,
  normalize,
  scale,
  subtract,
} from "../navigation_system/navigationMath.js";
import { orbitalStateFromRelative } from "../launch/launchGuidance.js";
import { computeOblateGravityPerturbationKmS2 } from "../dynamics/oblateGravityPerturbation.js";
import { computeLunarMasconAccelerationKmS2 } from "../dynamics/lunarMasconModel.js";
import {
  EARTH_SOLID_TIDE_ENABLED,
  EARTH_SOLID_TIDE_SOURCE_BODY_IDS,
  computeEarthSolidTidePerturbationKmS2,
} from "../dynamics/earthSolidTideModel.js";
import {
  computeSolarRadiationAccelerationKmS2,
  computeSolarShadowTransmittance,
} from "../dynamics/solarRadiationPressure.js";
import { createPhysicsForceModel } from "./forceModel.js";
import { createPhysicsIntegrator } from "./integrator.js";
import {
  createLunarSourceDescriptor,
  sampleMoonGuidanceSourceModelAtTimeSec,
} from "./lunarSourceModel.js";
import {
  createDynamicBodyRecord,
  createPhysicsWorldState,
  createStaticSourceRecord,
} from "./worldState.js";

const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const DEFAULT_EARTH_MASS_KG = 5.97237e24;
const DEFAULT_MOON_MASS_KG = 7.342e22;
const DEFAULT_EARTH_RADIUS_KM = 6371.0084;
const DEFAULT_MOON_RADIUS_KM = 1737.4;
const STANDARD_GRAVITY_M_S2 = 9.80665;
const DEFAULT_MOON_STEP_SEC = 90;
const DEFAULT_MOON_MU_KM3_S2 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * DEFAULT_MOON_MASS_KG;

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

function stateVector(positionKm, velocityKmS, massKg = Number.NaN, minMassKg = Number.NaN) {
  const resolvedMassKg = Number.isFinite(Number(massKg))
    ? Number(massKg)
    : Number.NaN;
  return {
    positionKm: finiteVector(positionKm) ? { ...positionKm } : { x: 0, y: 0, z: 0 },
    velocityKmS: finiteVector(velocityKmS) ? { ...velocityKmS } : { x: 0, y: 0, z: 0 },
    massKg: Number.isFinite(resolvedMassKg)
      ? Math.max(
        Number.isFinite(Number(minMassKg)) ? Number(minMassKg) : 0,
        resolvedMassKg,
      )
      : Number.NaN,
  };
}

function finiteVector3(value) {
  return Boolean(
    value
    && Number.isFinite(Number(value.x))
    && Number.isFinite(Number(value.y))
    && Number.isFinite(Number(value.z))
  );
}

function interpolateSeaToVac(vacuumValue, seaLevelValue, pressurePa = 0) {
  const vac = Math.max(0, finiteNumber(vacuumValue, 0));
  const sea = Math.max(0, finiteNumber(seaLevelValue, vac));
  const clampedPressurePa = clamp(finiteNumber(pressurePa, 0), 0, 101325);
  const blend = 1 - (clampedPressurePa / 101325);
  return sea + ((vac - sea) * blend);
}

function resolveSpacecraftDryMassKg(spacecraft = null) {
  if (!spacecraft || typeof spacecraft !== "object") {
    return Number.NaN;
  }
  const massKg = finiteNumber(spacecraft.massKg, Number.NaN);
  const propellantMassKg = Math.max(0, finiteNumber(spacecraft.propellantMassKg, Number.NaN));
  const dryMassKg = finiteNumber(spacecraft.dryMassKg, Number.NaN);
  if (Number.isFinite(dryMassKg) && dryMassKg > 0) {
    return dryMassKg;
  }
  if (Number.isFinite(massKg) && Number.isFinite(propellantMassKg)) {
    return Math.max(1, massKg - propellantMassKg);
  }
  return Number.NaN;
}

function resolveBurnSample({
  spacecraftMassKg = Number.NaN,
  burnCommand = null,
  spacecraft = null,
  sampleTimeSec = 0,
} = {}) {
  const zero = {
    accelerationKmS2: { x: 0, y: 0, z: 0 },
    massFlowKgS: 0,
  };
  if (!burnCommand || sampleTimeSec >= Math.max(0, finiteNumber(burnCommand.burnDurationSec, 0))) {
    return zero;
  }
  const throttle = clamp(finiteNumber(burnCommand.throttle, 0), 0, 1);
  if (!(throttle > 1e-9)) {
    return zero;
  }
  const currentMassKg = Math.max(1, finiteNumber(spacecraftMassKg, spacecraft?.massKg));
  const dryMassKg = Math.max(1, finiteNumber(resolveSpacecraftDryMassKg(spacecraft), 1));
  if (!(currentMassKg > dryMassKg + 1e-9)) {
    return zero;
  }
  const pressurePa = Math.max(0, finiteNumber(spacecraft?.ambientPressurePa, 0));
  const thrustPerThrottleN = interpolateSeaToVac(
    finiteNumber(spacecraft?.thrustVacuumN, 0),
    finiteNumber(spacecraft?.thrustSeaLevelN, spacecraft?.thrustVacuumN),
    pressurePa,
  );
  const ispS = interpolateSeaToVac(
    finiteNumber(spacecraft?.ispVacuumS, 0),
    finiteNumber(spacecraft?.ispSeaLevelS, spacecraft?.ispVacuumS),
    pressurePa,
  );
  if (!(thrustPerThrottleN > 0) || !(ispS > 0)) {
    const accelAtThrottle1 = Math.max(0, finiteNumber(burnCommand.accelAtThrottle1KmS2, 0));
    const direction = normalize(burnCommand.direction, { x: 0, y: 1, z: 0 });
    return {
      accelerationKmS2: scale(direction, throttle * accelAtThrottle1),
      massFlowKgS: 0,
    };
  }
  const thrustN = thrustPerThrottleN * throttle;
  const direction = normalize(burnCommand.direction, { x: 0, y: 1, z: 0 });
  return {
    accelerationKmS2: scale(direction, (thrustN / currentMassKg) / 1000),
    massFlowKgS: Math.max(0, thrustN / (ispS * STANDARD_GRAVITY_M_S2)),
  };
}

function resolveSpacecraftInitialMassKg(initialState = null, spacecraft = null) {
  return Math.max(1, finiteNumber(initialState?.massKg, spacecraft?.massKg || 1));
}

function resolveSpacecraftMassKgAtTimeSec({
  initialMassKg = Number.NaN,
  burnCommand = null,
  spacecraft = null,
  sampleTimeSec = 0,
} = {}) {
  const resolvedInitialMassKg = Math.max(1, finiteNumber(initialMassKg, spacecraft?.massKg || 1));
  const activeBurnDurationSec = Math.max(
    0,
    Math.min(
      Math.max(0, finiteNumber(sampleTimeSec, 0)),
      Math.max(0, finiteNumber(burnCommand?.burnDurationSec, 0)),
    ),
  );
  const burnSample = resolveBurnSample({
    spacecraftMassKg: resolvedInitialMassKg,
    burnCommand,
    spacecraft,
    sampleTimeSec: 0,
  });
  const dryMassKg = Math.max(1, finiteNumber(resolveSpacecraftDryMassKg(spacecraft), 1));
  return Math.max(dryMassKg, resolvedInitialMassKg - (Math.max(0, burnSample.massFlowKgS) * activeBurnDurationSec));
}

function cloneGuidanceWorldBodySnapshot(bodyState = null) {
  if (!bodyState || typeof bodyState !== "object") {
    return null;
  }
  return {
    id: String(bodyState.id || ""),
    massKg: finiteNumber(bodyState.massKg, Number.NaN),
    position: finiteVector3(bodyState.position) ? { ...bodyState.position } : null,
    velocity: finiteVector3(bodyState.velocity) ? { ...bodyState.velocity } : null,
  };
}

function restoreGuidanceWorldBodyFromSnapshot(bodyState = null, snapshot = null) {
  if (!bodyState || !snapshot) {
    return;
  }
  bodyState.id = String(snapshot.id || bodyState.id || "");
  bodyState.massKg = finiteNumber(snapshot.massKg, bodyState.massKg);
  if (finiteVector3(snapshot.position)) {
    bodyState.position = { ...snapshot.position };
  }
  if (finiteVector3(snapshot.velocity)) {
    bodyState.velocity = { ...snapshot.velocity };
  }
}

function isFiniteGuidanceWorldBodyState(bodyState = null) {
  return Boolean(
    bodyState
    && Number.isFinite(Number(bodyState.massKg))
    && finiteVector3(bodyState.position)
    && finiteVector3(bodyState.velocity)
  );
}

function syncGuidanceStaticSourcesAtTimeSec(worldState = null, sources = null, elapsedSec = 0, sourceCache = null) {
  if (!worldState?.staticSources) {
    return null;
  }
  const sampledSources = sampleMoonGuidanceSourceModelAtTimeSec(sources, elapsedSec, sourceCache);
  for (const sourceId of ["earth", "moon", "sun"]) {
    const source = sampledSources?.[sourceId];
    if (!source) {
      worldState.staticSources.delete(sourceId);
      continue;
    }
    const record = createStaticSourceRecord({
      id: sourceId,
      massKg: source.massKg,
      position: source.positionKm,
      velocity: source.velocityKmS,
    });
    if (record) {
      worldState.staticSources.set(sourceId, record);
    }
  }
  return sampledSources;
}

function computeGuidanceElapsedSec(sampleNowMs = 0, runtimeStartMs = 0) {
  return Math.max(0, (finiteNumber(sampleNowMs, runtimeStartMs) - finiteNumber(runtimeStartMs, 0)) / 1000);
}

function pointMassAccelerationKmS2(targetPosKm, sourcePosKm, sourceMassKg) {
  if (!finiteVector(targetPosKm) || !finiteVector(sourcePosKm)) {
    return { x: 0, y: 0, z: 0 };
  }
  const massKg = Math.max(0, finiteNumber(sourceMassKg, 0));
  if (!(massKg > 0)) {
    return { x: 0, y: 0, z: 0 };
  }
  const rel = subtract(targetPosKm, sourcePosKm);
  const radiusKm = Math.max(1e-6, length(rel));
  const muKm3S2 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * massKg;
  const scaleFactor = -muKm3S2 / (radiusKm * radiusKm * radiusKm);
  return scale(rel, scaleFactor);
}

function resolveMoonGuidanceSources(sources = null) {
  return {
    earth: sources?.earth || createLunarSourceDescriptor({
      id: "earth",
      positionKm: { x: 0, y: 0, z: 0 },
      velocityKmS: { x: 0, y: 0, z: 0 },
      massKg: DEFAULT_EARTH_MASS_KG,
      radiusKm: DEFAULT_EARTH_RADIUS_KM,
      referenceRadiusKm: DEFAULT_EARTH_RADIUS_KM,
    }),
    moon: sources?.moon || null,
    sun: sources?.sun || null,
  };
}

function buildOblateSourceContextMapFromSources({ earth = null, moon = null, sun = null } = {}) {
  const contextById = new Map();
  for (const source of [earth, moon, sun]) {
    if (!source || typeof source !== "object") {
      continue;
    }
    contextById.set(String(source.id || ""), {
      j2: Number(source.j2) || 0,
      j3: Number(source.j3) || 0,
      j4: Number(source.j4) || 0,
      j5: Number(source.j5) || 0,
      j6: Number(source.j6) || 0,
      c21: Number(source.c21) || 0,
      s21: Number(source.s21) || 0,
      c22: Number(source.c22) || 0,
      s22: Number(source.s22) || 0,
      harmonics: Array.isArray(source.harmonicTerms)
        ? source.harmonicTerms.map((term) => ({ ...term }))
        : null,
      referenceRadiusKm: Math.max(1, finiteNumber(source.referenceRadiusKm, source.radiusKm)),
      pole: source.axes?.pole || null,
      xAxis: source.axes?.xAxis || null,
      yAxis: source.axes?.yAxis || null,
    });
  }
  return contextById;
}

function createMoonGuidanceForceContext({
  sources = null,
  spacecraft = null,
  spacecraftMassKg = Number.NaN,
} = {}) {
  const resolvedSources = resolveMoonGuidanceSources(sources);
  const descriptorById = {
    earth: resolvedSources.earth,
    moon: resolvedSources.moon,
    sun: resolvedSources.sun,
  };
  const targetBodyId = String(spacecraft?.bodyId || "earth_launch_vehicle");
  const targetBodyMeta = {
    body_type: "spacecraft",
    radius_km: Math.max(0, finiteNumber(spacecraft?.radiusKm, 0)),
  };
  const getDescriptor = (bodyId = "") => {
    if (bodyId === targetBodyId) {
      return {
        id: targetBodyId,
        massKg: Math.max(1, finiteNumber(spacecraftMassKg, spacecraft?.massKg)),
        radiusKm: Math.max(0, finiteNumber(spacecraft?.radiusKm, 0)),
      };
    }
    return descriptorById[bodyId] || null;
  };
  const forceModel = createPhysicsForceModel({
    gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
    getMetaById: (bodyId) => {
      const descriptor = getDescriptor(bodyId);
      if (!descriptor) {
        return null;
      }
      return {
        radius_km: Math.max(0, finiteNumber(descriptor.radiusKm, 0)),
        mass_kg: Math.max(0, finiteNumber(descriptor.massKg, 0)),
        body_type: bodyId === targetBodyId ? "spacecraft" : "planet",
      };
    },
    getBodyRadiusKm: (bodyId) => Math.max(0, finiteNumber(getDescriptor(bodyId)?.radiusKm, 0)),
    getBodyMassKg: (bodyId) => Math.max(0, finiteNumber(getDescriptor(bodyId)?.massKg, 0)),
    getOblateGravityEnabled: () => true,
    getLunarMasconModelEnabled: () => Boolean(descriptorById.moon?.axes?.xAxis && descriptorById.moon?.axes?.yAxis && descriptorById.moon?.axes?.pole),
    getEarthSolidTideEnabled: () => EARTH_SOLID_TIDE_ENABLED && EARTH_SOLID_TIDE_SOURCE_BODY_IDS.some((bodyId) => descriptorById[bodyId]),
    getEarthSolidTideSourceBodyIds: () => EARTH_SOLID_TIDE_SOURCE_BODY_IDS.filter((bodyId) => descriptorById[bodyId]),
    getSolarRadiationPressureEnabled: () => false,
    computeOblateGravityPerturbationKmS2,
    computeEarthSolidTidePerturbationKmS2,
    computeLunarMasconAccelerationKmS2,
  });
  return {
    sources: resolvedSources,
    targetBodyId,
    targetBodyMeta,
    oblateSourceContextById: buildOblateSourceContextMapFromSources(resolvedSources),
    sourceEnvironment: {
      getBodyState: (bodyId) => {
        const source = descriptorById[bodyId];
        return source
          ? {
              position: source.positionKm,
              velocity: source.velocityKmS,
              massKg: source.massKg,
            }
          : null;
      },
    },
    forceModel,
  };
}

function computeGuidanceSolarRadiationAccelerationKmS2({
  positionKm = null,
  sources = null,
  spacecraft = null,
  spacecraftMassKg = Number.NaN,
  targetBodyId = "earth_launch_vehicle",
  targetBodyMeta = null,
} = {}) {
  const sun = sources?.sun || null;
  if (!sun || !finiteVector(positionKm) || !finiteVector(sun.positionKm)) {
    return { x: 0, y: 0, z: 0 };
  }
  const transmittance = computeSolarShadowTransmittance({
    targetId: targetBodyId,
    targetPosKm: positionKm,
    sunPosKm: sun.positionKm,
    sunRadiusKm: finiteNumber(sun.radiusKm, 0),
    occluders: [sources?.earth, sources?.moon]
      .filter(Boolean)
      .map((source) => ({
        id: source.id,
        positionKm: source.positionKm,
        radiusKm: source.radiusKm,
      })),
  });
  return computeSolarRadiationAccelerationKmS2({
    bodyId: targetBodyId,
    bodyMeta: targetBodyMeta,
    bodyMassKg: Math.max(1, finiteNumber(spacecraftMassKg, spacecraft?.massKg)),
    targetPosKm: positionKm,
    sunPosKm: sun.positionKm,
    transmittance,
    reflectivityCoeff: finiteNumber(spacecraft?.reflectivityCoeff, 1.45),
  });
}

export function computeMoonGuidanceAccelerationKmS2({
  positionKm = null,
  velocityKmS = null,
  sources = null,
  spacecraft = null,
  spacecraftMassKg = Number.NaN,
  controlAccelerationKmS2 = null,
} = {}) {
  const statePos = finiteVector(positionKm) ? positionKm : { x: 0, y: 0, z: 0 };
  const stateVel = finiteVector(velocityKmS) ? velocityKmS : { x: 0, y: 0, z: 0 };
  const forceContext = createMoonGuidanceForceContext({
    sources,
    spacecraft,
    spacecraftMassKg,
  });
  const { forceModel, oblateSourceContextById, sourceEnvironment, targetBodyId, targetBodyMeta } = forceContext;
  const earth = forceContext.sources.earth;
  const moon = forceContext.sources.moon;
  const sun = forceContext.sources.sun;
  const earthPositionKm = earth?.positionKm || { x: 0, y: 0, z: 0 };

  let total = forceModel.computeGravityAccelerationFromSource(
    statePos,
    "earth",
    earth?.massKg,
    earthPositionKm,
    oblateSourceContextById,
    sourceEnvironment,
  );

  for (const sourceId of ["moon", "sun"]) {
    const source = sourceId === "moon" ? moon : sun;
    if (!source) {
      continue;
    }
    total = add(total, forceModel.computeGravityAccelerationFromSource(
      statePos,
      sourceId,
      source.massKg,
      source.positionKm,
      oblateSourceContextById,
      sourceEnvironment,
    ));
    total = subtract(total, forceModel.computeGravityAccelerationFromSource(
      earthPositionKm,
      sourceId,
      source.massKg,
      source.positionKm,
      null,
      null,
    ));
  }

  total = add(total, computeGuidanceSolarRadiationAccelerationKmS2({
    positionKm: statePos,
    sources: forceContext.sources,
    spacecraft,
    spacecraftMassKg,
    targetBodyId,
    targetBodyMeta,
  }));

  if (finiteVector(controlAccelerationKmS2)) {
    total = add(total, controlAccelerationKmS2);
  }

  if (!Number.isFinite(total.x) || !Number.isFinite(total.y) || !Number.isFinite(total.z)) {
    return { x: 0, y: 0, z: 0 };
  }
  return total;
}

export function propagateMoonGuidanceState({
  initialState = null,
  durationSec = 0,
  stepSec = DEFAULT_MOON_STEP_SEC,
  sources = null,
  spacecraft = null,
  burnCommand = null,
} = {}) {
  if (!initialState || !finiteVector(initialState.positionKm) || !finiteVector(initialState.velocityKmS)) {
    return null;
  }
  const duration = Math.max(0, Number(durationSec) || 0);
  const step = Math.max(5, Number(stepSec) || DEFAULT_MOON_STEP_SEC);
  const sourceCache = new Map();
  const runtimeStartMs = 0;
  const shipBodyId = String(spacecraft?.bodyId || "earth_launch_vehicle");
  const initialMassKg = resolveSpacecraftInitialMassKg(initialState, spacecraft);
  const shipRecord = createDynamicBodyRecord({
    id: shipBodyId,
    massKg: initialMassKg,
    position: initialState.positionKm,
    velocity: initialState.velocityKmS,
  });
  if (!shipRecord) {
    return null;
  }
  const guidanceState = createPhysicsWorldState({
    dynamicBodies: new Map([[shipBodyId, shipRecord]]),
    staticSources: new Map(),
    nowMs: runtimeStartMs,
  });
  const stableSnapshotsById = new Map([[shipBodyId, cloneGuidanceWorldBodySnapshot(shipRecord)]]);
  syncGuidanceStaticSourcesAtTimeSec(guidanceState, sources, 0, sourceCache);
  const guidanceIntegrator = createPhysicsIntegrator({
    computeTotalAccelerationForTarget: (state, targetId, _oblateSourceContextById, sampleNowMs) => {
      const bodyState = state?.dynamicBodies?.get(targetId);
      if (!bodyState) {
        return { x: 0, y: 0, z: 0 };
      }
      const elapsedSampleSec = computeGuidanceElapsedSec(sampleNowMs, runtimeStartMs);
      const dynamicSources = sampleMoonGuidanceSourceModelAtTimeSec(sources, elapsedSampleSec, sourceCache);
      const spacecraftMassKg = resolveSpacecraftMassKgAtTimeSec({
        initialMassKg,
        burnCommand,
        spacecraft,
        sampleTimeSec: elapsedSampleSec,
      });
      const burnSample = resolveBurnSample({
        spacecraftMassKg,
        burnCommand,
        spacecraft,
        sampleTimeSec: elapsedSampleSec,
      });
      return computeMoonGuidanceAccelerationKmS2({
        positionKm: bodyState.position,
        velocityKmS: bodyState.velocity,
        sources: dynamicSources,
        spacecraft,
        spacecraftMassKg,
        controlAccelerationKmS2: burnSample.accelerationKmS2,
      });
    },
    buildOblateSourceContextMapForNBody: () => new Map(),
    sanitizeDynamicBodyState: (bodyId, bodyState) => {
      if (isFiniteGuidanceWorldBodyState(bodyState)) {
        stableSnapshotsById.set(bodyId, cloneGuidanceWorldBodySnapshot(bodyState));
        return true;
      }
      const snapshot = stableSnapshotsById.get(bodyId);
      restoreGuidanceWorldBodyFromSnapshot(bodyState, snapshot);
      return false;
    },
    cloneDynamicBodySnapshot: cloneGuidanceWorldBodySnapshot,
    restoreDynamicBodyFromSnapshot: restoreGuidanceWorldBodyFromSnapshot,
    isFiniteBodyState: isFiniteGuidanceWorldBodyState,
  });
  let elapsedSec = 0;
  const earthRadiusKm = Math.max(1, finiteNumber(sources?.earth?.radiusKm, DEFAULT_EARTH_RADIUS_KM));
  const moonRadiusKm = Math.max(1, finiteNumber(sources?.moon?.radiusKm, DEFAULT_MOON_RADIUS_KM));
  const earthMuKm3S2 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * Math.max(1, finiteNumber(sources?.earth?.massKg, DEFAULT_EARTH_MASS_KG));
  const moonMuKm3S2 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * Math.max(1, finiteNumber(sources?.moon?.massKg, DEFAULT_MOON_MASS_KG));

  let minMoonDistanceKm = Number.POSITIVE_INFINITY;
  let minEarthDistanceKm = Number.POSITIVE_INFINITY;
  let closestMoonState = null;
  let closestEarthState = null;
  let closestMoonSourceState = null;
  let closestEarthSourceState = null;
  let closestMoonTimeSec = Number.NaN;
  let closestEarthTimeSec = Number.NaN;

  while (elapsedSec < duration - 1e-9) {
    const dt = Math.min(step, duration - elapsedSec);
    guidanceIntegrator.integrateWorldStep(
      guidanceState,
      dt,
      runtimeStartMs + (elapsedSec * 1000),
      null,
    );
    elapsedSec += dt;
    const bodyState = guidanceState.dynamicBodies.get(shipBodyId);
    if (!bodyState) {
      return null;
    }
    bodyState.massKg = resolveSpacecraftMassKgAtTimeSec({
      initialMassKg,
      burnCommand,
      spacecraft,
      sampleTimeSec: elapsedSec,
    });
    stableSnapshotsById.set(shipBodyId, cloneGuidanceWorldBodySnapshot(bodyState));
    guidanceState.simulationTimeMs = runtimeStartMs + (elapsedSec * 1000);

    const sampleSources = syncGuidanceStaticSourcesAtTimeSec(guidanceState, sources, elapsedSec, sourceCache);
    const sampleMoon = sampleSources?.moon || null;
    const sampleEarth = sampleSources?.earth || null;
    const moonDistanceKm = sampleMoon
      ? length(subtract(bodyState.position, sampleMoon.positionKm))
      : Number.POSITIVE_INFINITY;
    const earthDistanceKm = length(subtract(bodyState.position, sampleEarth?.positionKm || { x: 0, y: 0, z: 0 }));
    if (moonDistanceKm < minMoonDistanceKm) {
      minMoonDistanceKm = moonDistanceKm;
      closestMoonState = stateVector(bodyState.position, bodyState.velocity, bodyState.massKg, resolveSpacecraftDryMassKg(spacecraft));
      closestMoonSourceState = sampleMoon
        ? stateVector(sampleMoon.positionKm, sampleMoon.velocityKmS)
        : null;
      closestMoonTimeSec = elapsedSec;
    }
    if (earthDistanceKm < minEarthDistanceKm) {
      minEarthDistanceKm = earthDistanceKm;
      closestEarthState = stateVector(bodyState.position, bodyState.velocity, bodyState.massKg, resolveSpacecraftDryMassKg(spacecraft));
      closestEarthSourceState = sampleEarth
        ? stateVector(sampleEarth.positionKm, sampleEarth.velocityKmS)
        : null;
      closestEarthTimeSec = elapsedSec;
    }
  }

  const bodyState = guidanceState.dynamicBodies.get(shipBodyId);
  if (!bodyState) {
    return null;
  }
  bodyState.massKg = resolveSpacecraftMassKgAtTimeSec({
    initialMassKg,
    burnCommand,
    spacecraft,
    sampleTimeSec: elapsedSec,
  });
  const finalSources = syncGuidanceStaticSourcesAtTimeSec(guidanceState, sources, elapsedSec, sourceCache);
  const finalMoonSourceState = finalSources?.moon
    ? stateVector(finalSources.moon.positionKm, finalSources.moon.velocityKmS)
    : null;
  const finalEarthSourceState = finalSources?.earth
    ? stateVector(finalSources.earth.positionKm, finalSources.earth.velocityKmS)
    : stateVector({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  const finalMoonRelPos = finalMoonSourceState ? subtract(bodyState.position, finalMoonSourceState.positionKm) : null;
  const finalMoonRelVel = finalMoonSourceState ? subtract(bodyState.velocity, finalMoonSourceState.velocityKmS) : null;
  const finalEarthRelPos = subtract(bodyState.position, finalEarthSourceState.positionKm);
  const finalEarthRelVel = subtract(bodyState.velocity, finalEarthSourceState.velocityKmS);
  const moonOrbit = finalMoonRelPos && finalMoonRelVel
    ? orbitalStateFromRelative(moonMuKm3S2, moonRadiusKm, finalMoonRelPos, finalMoonRelVel)
    : null;
  const earthOrbit = orbitalStateFromRelative(earthMuKm3S2, earthRadiusKm, finalEarthRelPos, finalEarthRelVel);

  const closestMoonRelPos = closestMoonState && closestMoonSourceState
    ? subtract(closestMoonState.positionKm, closestMoonSourceState.positionKm)
    : null;
  const closestMoonRelVel = closestMoonState && closestMoonSourceState
    ? subtract(closestMoonState.velocityKmS, closestMoonSourceState.velocityKmS)
    : null;
  const closestEarthRelPos = closestEarthState && closestEarthSourceState
    ? subtract(closestEarthState.positionKm, closestEarthSourceState.positionKm)
    : null;
  const closestEarthRelVel = closestEarthState && closestEarthSourceState
    ? subtract(closestEarthState.velocityKmS, closestEarthSourceState.velocityKmS)
    : null;
  const closestMoonRangeKm = closestMoonRelPos ? length(closestMoonRelPos) : Number.POSITIVE_INFINITY;
  const closestMoonClosingSpeedKmS = (
    closestMoonRelPos
    && closestMoonRelVel
    && closestMoonRangeKm > 1e-9
  )
    ? -dot(closestMoonRelVel, scale(closestMoonRelPos, 1 / closestMoonRangeKm))
    : Number.NaN;

  return {
    finalState: stateVector(bodyState.position, bodyState.velocity, bodyState.massKg, resolveSpacecraftDryMassKg(spacecraft)),
    durationSec: duration,
    minMoonDistanceKm,
    minMoonAltitudeKm: Number.isFinite(minMoonDistanceKm) ? (minMoonDistanceKm - moonRadiusKm) : Number.NaN,
    minEarthDistanceKm,
    minEarthAltitudeKm: Number.isFinite(minEarthDistanceKm) ? (minEarthDistanceKm - earthRadiusKm) : Number.NaN,
    closestMoonState,
    closestEarthState,
    closestMoonSourceState,
    closestEarthSourceState,
    closestMoonTimeSec,
    closestEarthTimeSec,
    closestMoonRelativePositionKm: closestMoonRelPos,
    closestMoonRelativeVelocityKmS: closestMoonRelVel,
    closestEarthRelativePositionKm: closestEarthRelPos,
    closestEarthRelativeVelocityKmS: closestEarthRelVel,
    closestMoonClosingSpeedKmS,
    earthOrbit,
    moonOrbit,
    finalMoonSourceState,
    finalEarthSourceState,
    finalMoonRelativePositionKm: finalMoonRelPos,
    finalMoonRelativeVelocityKmS: finalMoonRelVel,
    finalEarthRelativePositionKm: finalEarthRelPos,
    finalEarthRelativeVelocityKmS: finalEarthRelVel,
    finalMoonDistanceKm: finalMoonRelPos ? length(finalMoonRelPos) : Number.POSITIVE_INFINITY,
    finalMoonRelativeSpeedKmS: finalMoonRelVel ? length(finalMoonRelVel) : Number.POSITIVE_INFINITY,
  };
}

export function estimateBPlaneErrorKm({
  relativePositionKm = null,
  relativeVelocityKmS = null,
  targetPeriluneAltitudeKm = 120,
  bodyRadiusKm = DEFAULT_MOON_RADIUS_KM,
  bodyMuKm3S2 = DEFAULT_MOON_MU_KM3_S2,
} = {}) {
  if (!finiteVector(relativePositionKm) || !finiteVector(relativeVelocityKmS)) {
    return Number.NaN;
  }
  const muKm3S2 = Math.max(1e-9, finiteNumber(bodyMuKm3S2, DEFAULT_MOON_MU_KM3_S2));
  const radiusKm = Math.max(1e-9, length(relativePositionKm));
  const speedKmS = Math.max(1e-9, length(relativeVelocityKmS));
  const specificEnergyKm2S2 = (0.5 * speedKmS * speedKmS) - (muKm3S2 / radiusKm);
  const angularMomentumVec = cross(relativePositionKm, relativeVelocityKmS);
  const angularMomentumKm2S = length(angularMomentumVec);
  const targetPeriapsisRadiusKm = Math.max(
    1,
    finiteNumber(bodyRadiusKm, DEFAULT_MOON_RADIUS_KM) + Math.max(20, finiteNumber(targetPeriluneAltitudeKm, 120)),
  );
  if (specificEnergyKm2S2 > 1e-9 && angularMomentumKm2S > 1e-9) {
    const eccentricityVec = subtract(
      scale(cross(relativeVelocityKmS, angularMomentumVec), 1 / muKm3S2),
      scale(relativePositionKm, 1 / radiusKm),
    );
    const eccentricity = length(eccentricityVec);
    if (eccentricity > 1 + 1e-9) {
      const hyperbolicExcessSpeedKmS = Math.sqrt(2 * specificEnergyKm2S2);
      const actualImpactParameterKm = angularMomentumKm2S / hyperbolicExcessSpeedKmS;
      const targetImpactParameterKm = targetPeriapsisRadiusKm * Math.sqrt(
        1 + ((2 * muKm3S2) / (targetPeriapsisRadiusKm * hyperbolicExcessSpeedKmS * hyperbolicExcessSpeedKmS)),
      );
      return Math.abs(actualImpactParameterKm - targetImpactParameterKm);
    }
  }
  const approachAxis = scale(relativeVelocityKmS, 1 / speedKmS);
  const lateral = subtract(relativePositionKm, scale(approachAxis, dot(relativePositionKm, approachAxis)));
  const impactParameterKm = length(lateral);
  return Math.abs(impactParameterKm - targetPeriapsisRadiusKm);
}

export function burnDurationForDeltaVSec(deltaVNeedKmS, accelAtThrottle1KmS2, throttle = 1, spacecraft = null) {
  const accel = Math.max(1e-8, finiteNumber(accelAtThrottle1KmS2, 0) * clamp(Number(throttle) || 0, 0, 1));
  const dv = Math.max(0, finiteNumber(deltaVNeedKmS, 0));
  const pressurePa = Math.max(0, finiteNumber(spacecraft?.ambientPressurePa, 0));
  const thrustPerThrottleN = interpolateSeaToVac(
    finiteNumber(spacecraft?.thrustVacuumN, 0),
    finiteNumber(spacecraft?.thrustSeaLevelN, spacecraft?.thrustVacuumN),
    pressurePa,
  );
  const ispS = interpolateSeaToVac(
    finiteNumber(spacecraft?.ispVacuumS, 0),
    finiteNumber(spacecraft?.ispSeaLevelS, spacecraft?.ispVacuumS),
    pressurePa,
  );
  const throttleClamped = clamp(Number(throttle) || 0, 0, 1);
  const thrustN = thrustPerThrottleN * throttleClamped;
  const initialMassKg = Math.max(1, finiteNumber(spacecraft?.massKg, Number.NaN));
  const dryMassKg = Math.max(1, finiteNumber(resolveSpacecraftDryMassKg(spacecraft), Number.NaN));
  if (
    Number.isFinite(initialMassKg)
    && Number.isFinite(dryMassKg)
    && initialMassKg > dryMassKg
    && thrustN > 0
    && ispS > 0
  ) {
    const exhaustVelocityMS = ispS * STANDARD_GRAVITY_M_S2;
    const dvMS = dv * 1000;
    const targetFinalMassKg = initialMassKg / Math.exp(dvMS / exhaustVelocityMS);
    const boundedFinalMassKg = Math.max(dryMassKg, targetFinalMassKg);
    const propellantUseKg = Math.max(0, initialMassKg - boundedFinalMassKg);
    const massFlowKgS = thrustN / exhaustVelocityMS;
    if (massFlowKgS > 0) {
      return propellantUseKg / massFlowKgS;
    }
  }
  return dv / accel;
}
