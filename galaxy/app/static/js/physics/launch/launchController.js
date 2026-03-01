import {
  EARTH_SIDEREAL_ANGULAR_RATE_RAD_S,
  LAUNCH_BODY_ID,
  LAUNCH_BODY_META,
  LAUNCH_INITIAL_MASS_KG,
  LAUNCH_SITE,
  LAUNCH_VEHICLE_CONFIG,
  SEA_LEVEL_PRESSURE_PA,
  STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM,
  STANDARD_GRAVITY_M_S2,
} from "./launchConfig.js";

const MIN_ROCKET_MASS_KG = 500;
const EPS = 1e-12;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rad(degrees) {
  return (degrees * Math.PI) / 180;
}

function length(v) {
  return Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z));
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v, scalar) {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

function dot(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function cross(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function normalize(v, fallback = { x: 0, y: 0, z: 1 }) {
  const mag = length(v);
  if (!(mag > EPS)) {
    return { ...fallback };
  }
  return {
    x: v.x / mag,
    y: v.y / mag,
    z: v.z / mag,
  };
}

function mixVectors(a, b, t) {
  const tt = clamp(t, 0, 1);
  return {
    x: (a.x * (1 - tt)) + (b.x * tt),
    y: (a.y * (1 - tt)) + (b.y * tt),
    z: (a.z * (1 - tt)) + (b.z * tt),
  };
}

function fallbackAxes() {
  return {
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 1, z: 0 },
    pole: { x: 0, y: 0, z: 1 },
  };
}

function sanitizeAxes(rawAxes) {
  if (!rawAxes) {
    return fallbackAxes();
  }
  const pole = normalize(rawAxes.pole || { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 });
  const xAxisRaw = normalize(rawAxes.xAxis || { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const yAxisOrtho = normalize(cross(pole, xAxisRaw), { x: 0, y: 1, z: 0 });
  const xAxisOrtho = normalize(cross(yAxisOrtho, pole), { x: 1, y: 0, z: 0 });
  return { xAxis: xAxisOrtho, yAxis: yAxisOrtho, pole };
}

function stageAtIndex(stageIndex) {
  return LAUNCH_VEHICLE_CONFIG.stages[stageIndex] || null;
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
  const direction = {
    x: (axes.xAxis.x * localX) + (axes.yAxis.x * localY) + (axes.pole.x * localZ),
    y: (axes.xAxis.y * localX) + (axes.yAxis.y * localY) + (axes.pole.y * localZ),
    z: (axes.xAxis.z * localX) + (axes.yAxis.z * localY) + (axes.pole.z * localZ),
  };
  return normalize(direction);
}

function computePadState({ earthState, earthRadiusKm, earthAxes }) {
  if (!earthState?.position) {
    return null;
  }
  const up = bodyDirectionFromLatLon(
    earthAxes,
    LAUNCH_SITE.latitudeDeg,
    LAUNCH_SITE.longitudeDeg,
  );
  const launchRadiusKm =
    earthRadiusKm
    + LAUNCH_SITE.altitudeKm
    + STARSHIP_REFERENCE_OFFSET_FROM_BASE_KM;
  const relPositionKm = scale(up, launchRadiusKm);
  const angularVelocity = scale(earthAxes.pole, EARTH_SIDEREAL_ANGULAR_RATE_RAD_S);
  const localRotationalVelocityKmS = cross(angularVelocity, relPositionKm);
  return {
    position: add(earthState.position, relPositionKm),
    velocity: add(earthState.velocity || { x: 0, y: 0, z: 0 }, localRotationalVelocityKmS),
  };
}

function pressureRatio(pressurePa) {
  if (!Number.isFinite(pressurePa) || pressurePa <= 0) {
    return 0;
  }
  return clamp(pressurePa / SEA_LEVEL_PRESSURE_PA, 0, 1);
}

function interpolateSeaToVac(vacuumValue, seaLevelValue, pressurePa) {
  const sea = Number.isFinite(seaLevelValue) ? seaLevelValue : vacuumValue;
  return vacuumValue - ((vacuumValue - sea) * pressureRatio(pressurePa));
}

function guidanceDirection({
  rocketState,
  earthState,
  earthAxes,
  elapsedSeconds,
}) {
  const up = normalize(
    subtract(rocketState.position, earthState.position),
    earthAxes.pole,
  );
  if (LAUNCH_VEHICLE_CONFIG.guidance?.enforceVerticalAscent) {
    return {
      direction: up,
      mode: "vertical-ascent",
    };
  }
  const east = normalize(
    cross(earthAxes.pole, up),
    normalize(cross({ x: 0, y: 0, z: 1 }, up), { x: 1, y: 0, z: 0 }),
  );
  const north = normalize(cross(up, east), { x: 0, y: 1, z: 0 });
  const heading = rad(LAUNCH_VEHICLE_CONFIG.guidance.ascentHeadingDegFromEast);
  const headingDirection = normalize(
    add(scale(east, Math.cos(heading)), scale(north, Math.sin(heading))),
    east,
  );

  const pitchover = clamp(
    (elapsedSeconds - LAUNCH_VEHICLE_CONFIG.guidance.pitchoverStartSec)
      / Math.max(LAUNCH_VEHICLE_CONFIG.guidance.pitchoverDurationSec, 1),
    0,
    1,
  );
  let command = normalize(mixVectors(up, headingDirection, pitchover), headingDirection);

  const relVelocity = subtract(
    rocketState.velocity,
    earthState.velocity || { x: 0, y: 0, z: 0 },
  );
  const prograde = normalize(relVelocity, command);
  const progradeBlend = clamp(
    (elapsedSeconds - LAUNCH_VEHICLE_CONFIG.guidance.progradeBlendStartSec)
      / Math.max(LAUNCH_VEHICLE_CONFIG.guidance.progradeBlendDurationSec, 1),
    0,
    LAUNCH_VEHICLE_CONFIG.guidance.maxProgradeBlend,
  );
  command = normalize(mixVectors(command, prograde, progradeBlend), command);

  return {
    direction: command,
    mode: progradeBlend > 0.05 ? "gravity-turn-prograde" : "pitch-program",
  };
}

function throttleForState(stageIndex, elapsedSeconds) {
  if (stageIndex !== 0) {
    return 1;
  }
  if (elapsedSeconds < LAUNCH_VEHICLE_CONFIG.guidance.liftoffThrottleSec) {
    return LAUNCH_VEHICLE_CONFIG.guidance.liftoffThrottleValue;
  }
  if (
    elapsedSeconds >= LAUNCH_VEHICLE_CONFIG.guidance.maxQThrottleStartSec
    && elapsedSeconds <= LAUNCH_VEHICLE_CONFIG.guidance.maxQThrottleEndSec
  ) {
    return LAUNCH_VEHICLE_CONFIG.guidance.maxQThrottleValue;
  }
  return 1;
}

function telemetryFromState({
  gravitationalConstantKm3PerKgS2,
  earthMassKg,
  earthRadiusKm,
  earthState,
  rocketState,
  atmosphereSample,
  runtime,
}) {
  if (!rocketState || !earthState) {
    return null;
  }
  const relPos = subtract(rocketState.position, earthState.position);
  const relVel = subtract(
    rocketState.velocity,
    earthState.velocity || { x: 0, y: 0, z: 0 },
  );
  const radiusKm = length(relPos);
  const speedKmS = length(relVel);
  const altitudeKm = radiusKm - earthRadiusKm;
  const mu = gravitationalConstantKm3PerKgS2 * earthMassKg;

  let apoapsisKm = null;
  let periapsisKm = null;
  if (mu > 0 && radiusKm > 0) {
    const speedSq = speedKmS * speedKmS;
    const specificEnergy = (0.5 * speedSq) - (mu / radiusKm);
    const angularMomentum = length(cross(relPos, relVel));
    if (specificEnergy < 0 && angularMomentum > 0) {
      const semimajorKm = -mu / (2 * specificEnergy);
      const eccentricity = Math.sqrt(
        Math.max(0, 1 + ((2 * specificEnergy * angularMomentum * angularMomentum) / (mu * mu))),
      );
      apoapsisKm = (semimajorKm * (1 + eccentricity)) - earthRadiusKm;
      periapsisKm = (semimajorKm * (1 - eccentricity)) - earthRadiusKm;
    }
  }

  const densityKgM3 = Number(atmosphereSample?.densityKgM3) || 0;
  const dynamicPressurePa = 0.5 * densityKgM3 * Math.pow(speedKmS * 1000, 2);
  return {
    phase: runtime.phase,
    elapsedSeconds: runtime.elapsedSeconds,
    stageIndex: runtime.stageIndex,
    stageName: stageAtIndex(runtime.stageIndex)?.name || "Coast/Complete",
    massKg: rocketState.massKg,
    altitudeKm,
    speedKmS,
    apoapsisKm,
    periapsisKm,
    throttle: runtime.lastStep?.throttle || 0,
    thrustN: runtime.lastStep?.thrustN || 0,
    burnRateKgS: runtime.lastStep?.burnRateKgS || 0,
    dynamicPressurePa,
    guidanceMode: runtime.lastStep?.guidanceMode || "idle",
  };
}

function phaseLabel(phase) {
  if (phase === "powered") {
    return "Powered Ascent";
  }
  if (phase === "coast") {
    return "Coast";
  }
  if (phase === "complete") {
    return "Mission Complete";
  }
  return "Idle";
}

export { LAUNCH_BODY_ID, LAUNCH_BODY_META };

export function createLaunchController(options) {
  const {
    getEarthRadiusKm,
    getEarthMassKg,
    getEarthFixedAxesEcliptic,
    sampleEarthAtmosphere,
    gravitationalConstantKm3PerKgS2,
  } = options || {};

  const runtime = {
    phase: "idle",
    elapsedSeconds: 0,
    stageIndex: 0,
    stagePropellantKg: stageAtIndex(0)?.propellantMassKg || 0,
    coastRemainingSec: 0,
    lastStep: null,
    lastTelemetry: null,
    lastError: "",
  };

  function earthAxes(timestampMs = Date.now()) {
    return sanitizeAxes(getEarthFixedAxesEcliptic?.(timestampMs) || fallbackAxes());
  }

  function earthStateFromNBody(state) {
    return state?.dynamicBodies?.get("earth") || state?.staticSources?.get("earth") || null;
  }

  function rocketStateFromNBody(state) {
    return state?.dynamicBodies?.get(LAUNCH_BODY_ID) || null;
  }

  function resetRuntime() {
    runtime.phase = "idle";
    runtime.elapsedSeconds = 0;
    runtime.stageIndex = 0;
    runtime.stagePropellantKg = stageAtIndex(0)?.propellantMassKg || 0;
    runtime.coastRemainingSec = 0;
    runtime.lastStep = null;
    runtime.lastError = "";
  }

  function ensureCatalogBodies(catalogBodies) {
    const next = Array.isArray(catalogBodies) ? [...catalogBodies] : [];
    const index = next.findIndex((body) => body.id === LAUNCH_BODY_ID);
    if (index >= 0) {
      next[index] = {
        ...next[index],
        ...LAUNCH_BODY_META,
        mass_kg: Number(next[index].mass_kg) > 0 ? Number(next[index].mass_kg) : LAUNCH_BODY_META.mass_kg,
      };
      return next;
    }
    next.push({ ...LAUNCH_BODY_META });
    return next;
  }

  function injectStartupEntry(entriesById, timestampMs = Date.now()) {
    if (!entriesById || entriesById.has(LAUNCH_BODY_ID)) {
      return;
    }
    const earthEntry = entriesById.get("earth");
    const earthPosition = earthEntry?.coordinates_km;
    if (
      !Number.isFinite(Number(earthPosition?.x))
      || !Number.isFinite(Number(earthPosition?.y))
      || !Number.isFinite(Number(earthPosition?.z))
    ) {
      return;
    }
    const earthVelocity = earthEntry?.coordinates_velocity_km_s;
    const earthState = {
      position: {
        x: Number(earthPosition.x),
        y: Number(earthPosition.y),
        z: Number(earthPosition.z),
      },
      velocity: {
        x: Number(earthVelocity?.x) || 0,
        y: Number(earthVelocity?.y) || 0,
        z: Number(earthVelocity?.z) || 0,
      },
    };
    const pad = computePadState({
      earthState,
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
      earthAxes: earthAxes(timestampMs),
    });
    if (!pad) {
      return;
    }
    entriesById.set(LAUNCH_BODY_ID, {
      id: LAUNCH_BODY_ID,
      name: LAUNCH_BODY_META.name,
      source: "SIMULATED",
      coordinates_km: pad.position,
      coordinates_velocity_km_s: pad.velocity,
      source_error: null,
    });
  }

  function ensureRocketInNBody(state, nowMs = Date.now()) {
    if (!state?.dynamicBodies) {
      return null;
    }
    const existing = state.dynamicBodies.get(LAUNCH_BODY_ID);
    if (existing) {
      return existing;
    }
    const earthState = earthStateFromNBody(state);
    if (!earthState) {
      return null;
    }
    const pad = computePadState({
      earthState,
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
      earthAxes: earthAxes(nowMs),
    });
    if (!pad) {
      return null;
    }
    const rocketState = {
      id: LAUNCH_BODY_ID,
      massKg: LAUNCH_INITIAL_MASS_KG,
      position: { ...pad.position },
      velocity: { ...pad.velocity },
    };
    state.dynamicBodies.set(LAUNCH_BODY_ID, rocketState);
    return rocketState;
  }

  function resetToPad(state, nowMs = Date.now()) {
    const earthState = earthStateFromNBody(state);
    const rocketState = ensureRocketInNBody(state, nowMs);
    if (!earthState || !rocketState) {
      runtime.lastError = "Earth/rocket state unavailable";
      return false;
    }
    const pad = computePadState({
      earthState,
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
      earthAxes: earthAxes(nowMs),
    });
    if (!pad) {
      runtime.lastError = "Pad state unavailable";
      return false;
    }
    rocketState.position = { ...pad.position };
    rocketState.velocity = { ...pad.velocity };
    rocketState.massKg = LAUNCH_INITIAL_MASS_KG;
    resetRuntime();
    runtime.lastTelemetry = telemetryFromState({
      gravitationalConstantKm3PerKgS2,
      earthMassKg: Number(getEarthMassKg?.()) || 0,
      earthRadiusKm: Number(getEarthRadiusKm?.()) || 6371,
      earthState,
      rocketState,
      atmosphereSample: sampleEarthAtmosphere?.(LAUNCH_SITE.altitudeKm) || null,
      runtime,
    });
    return true;
  }

  function startLaunch(state, nowMs = Date.now()) {
    if (!resetToPad(state, nowMs)) {
      return false;
    }
    runtime.phase = "powered";
    return true;
  }

  function prepareStep(state, dtSeconds, nowMs = Date.now()) {
    runtime.lastStep = null;
    if (runtime.phase === "idle" || runtime.phase === "complete") {
      return;
    }

    const earthState = earthStateFromNBody(state);
    const rocketState = ensureRocketInNBody(state, nowMs);
    if (!earthState || !rocketState) {
      runtime.lastError = "Earth/rocket state unavailable";
      runtime.phase = "idle";
      return;
    }

    const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
    const relPos = subtract(rocketState.position, earthState.position);
    const altitudeKm = Math.max(0, length(relPos) - earthRadiusKm);
    const atmo = sampleEarthAtmosphere?.(altitudeKm) || null;

    if (runtime.coastRemainingSec > 0) {
      runtime.coastRemainingSec = Math.max(0, runtime.coastRemainingSec - dtSeconds);
      runtime.phase = runtime.coastRemainingSec > 0 ? "coast" : "powered";
      runtime.lastStep = {
        accelerationKmS2: { x: 0, y: 0, z: 0 },
        throttle: 0,
        thrustN: 0,
        burnKg: 0,
        burnRateKgS: 0,
        guidanceMode: "coast",
      };
      runtime.lastTelemetry = telemetryFromState({
        gravitationalConstantKm3PerKgS2,
        earthMassKg: Number(getEarthMassKg?.()) || 0,
        earthRadiusKm,
        earthState,
        rocketState,
        atmosphereSample: atmo,
        runtime,
      });
      return;
    }

    const stage = stageAtIndex(runtime.stageIndex);
    if (!stage) {
      runtime.phase = "complete";
      return;
    }

    const pressurePa = Number(atmo?.pressurePa) || 0;
    const throttle = throttleForState(runtime.stageIndex, runtime.elapsedSeconds);
    const thrustN =
      interpolateSeaToVac(stage.thrustVacuumN, stage.thrustSeaLevelN, pressurePa)
      * throttle;
    const ispS = interpolateSeaToVac(stage.ispVacuumS, stage.ispSeaLevelS, pressurePa);
    const burnRateKgS = thrustN > 0 && ispS > 0
      ? thrustN / (ispS * STANDARD_GRAVITY_M_S2)
      : 0;
    const burnKg = Math.min(runtime.stagePropellantKg, burnRateKgS * dtSeconds);
    const effectiveMassKg = Math.max(
      MIN_ROCKET_MASS_KG,
      rocketState.massKg - (0.5 * burnKg),
    );
    const guidance = guidanceDirection({
      rocketState,
      earthState,
      earthAxes: earthAxes(nowMs),
      elapsedSeconds: runtime.elapsedSeconds,
    });
    const accelerationMagKmS2 = thrustN > 0
      ? (thrustN / effectiveMassKg) / 1000
      : 0;
    runtime.lastStep = {
      accelerationKmS2: scale(guidance.direction, accelerationMagKmS2),
      throttle,
      thrustN,
      burnKg,
      burnRateKgS,
      guidanceMode: guidance.mode,
    };
    runtime.lastTelemetry = telemetryFromState({
      gravitationalConstantKm3PerKgS2,
      earthMassKg: Number(getEarthMassKg?.()) || 0,
      earthRadiusKm,
      earthState,
      rocketState,
      atmosphereSample: atmo,
      runtime,
    });
  }

  function externalAccelerationKmS2(bodyId) {
    if (bodyId !== LAUNCH_BODY_ID) {
      return { x: 0, y: 0, z: 0 };
    }
    return runtime.lastStep?.accelerationKmS2 || { x: 0, y: 0, z: 0 };
  }

  function finalizeStep(state, dtSeconds, nowMs = Date.now()) {
    if (runtime.phase === "idle" || runtime.phase === "complete") {
      return;
    }
    const rocketState = rocketStateFromNBody(state);
    const earthState = earthStateFromNBody(state);
    if (!rocketState || !earthState) {
      runtime.phase = "idle";
      return;
    }
    runtime.elapsedSeconds += dtSeconds;

    const burnKg = Number(runtime.lastStep?.burnKg) || 0;
    if (burnKg > 0) {
      rocketState.massKg = Math.max(
        MIN_ROCKET_MASS_KG,
        rocketState.massKg - burnKg,
      );
      runtime.stagePropellantKg = Math.max(0, runtime.stagePropellantKg - burnKg);
    }

    const stage = stageAtIndex(runtime.stageIndex);
    if (stage && runtime.stagePropellantKg <= 1e-6) {
      rocketState.massKg = Math.max(
        MIN_ROCKET_MASS_KG,
        rocketState.massKg - stage.dryMassKg,
      );
      runtime.stageIndex += 1;
      const nextStage = stageAtIndex(runtime.stageIndex);
      if (nextStage) {
        runtime.stagePropellantKg = nextStage.propellantMassKg;
        runtime.coastRemainingSec = Math.max(0, Number(stage.coastAfterBurnSec) || 0);
        runtime.phase = runtime.coastRemainingSec > 0 ? "coast" : "powered";
      } else {
        runtime.stagePropellantKg = 0;
        runtime.phase = "complete";
      }
    }

    const earthRadiusKm = Number(getEarthRadiusKm?.()) || 6371;
    const altitudeKm = Math.max(0, length(subtract(rocketState.position, earthState.position)) - earthRadiusKm);
    runtime.lastTelemetry = telemetryFromState({
      gravitationalConstantKm3PerKgS2,
      earthMassKg: Number(getEarthMassKg?.()) || 0,
      earthRadiusKm,
      earthState,
      rocketState,
      atmosphereSample: sampleEarthAtmosphere?.(altitudeKm) || null,
      runtime,
    });
  }

  function statusSnapshot() {
    const telemetry = runtime.lastTelemetry;
    if (!telemetry) {
      return {
        bodyId: LAUNCH_BODY_ID,
        phase: runtime.phase,
        phaseLabel: phaseLabel(runtime.phase),
        stageIndex: runtime.stageIndex,
        launchSiteName: LAUNCH_SITE.name || "Launch Site",
        statusLine: `Launch vehicle initialized at ${LAUNCH_SITE.name || "launch site"}.`,
      };
    }
    return {
      bodyId: LAUNCH_BODY_ID,
      phase: runtime.phase,
      phaseLabel: phaseLabel(runtime.phase),
      stageName: telemetry.stageName,
      stageIndex: telemetry.stageIndex,
      launchSiteName: LAUNCH_SITE.name || "Launch Site",
      elapsedSeconds: telemetry.elapsedSeconds,
      massKg: telemetry.massKg,
      altitudeKm: telemetry.altitudeKm,
      speedKmS: telemetry.speedKmS,
      apoapsisKm: telemetry.apoapsisKm,
      periapsisKm: telemetry.periapsisKm,
      throttle: telemetry.throttle,
      thrustN: telemetry.thrustN,
      burnRateKgS: telemetry.burnRateKgS,
      dynamicPressurePa: telemetry.dynamicPressurePa,
      guidanceMode: telemetry.guidanceMode,
      statusLine: runtime.lastError || `${phaseLabel(runtime.phase)} | ${telemetry.stageName}`,
    };
  }

  return {
    ensureCatalogBodies,
    injectStartupEntry,
    ensureRocketInNBody,
    resetToPad,
    startLaunch,
    prepareStep,
    externalAccelerationKmS2,
    finalizeStep,
    statusSnapshot,
    isActive() {
      return runtime.phase !== "idle" && runtime.phase !== "complete";
    },
  };
}
