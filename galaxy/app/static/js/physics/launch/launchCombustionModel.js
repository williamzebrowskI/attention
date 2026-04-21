import {
  resolveConfiguredEngineCounts,
  STANDARD_GRAVITY_M_S2,
} from "./launchConfig.js";
import { resolveActiveEngineSelection } from "./launchEngineLayout.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function finiteNonNegativeInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Math.max(0, Math.round(Number(fallback) || 0));
  }
  return Math.max(0, Math.round(numeric));
}

function normalizedIndexSet(indices, maxIndexExclusive) {
  const limit = Math.max(0, finiteNonNegativeInteger(maxIndexExclusive, 0));
  const set = new Set();
  if (!Array.isArray(indices) || limit <= 0) {
    return set;
  }
  for (const value of indices) {
    const numeric = finiteNonNegativeInteger(value, -1);
    if (numeric >= 0 && numeric < limit) {
      set.add(numeric);
    }
  }
  return set;
}

function pressureRatio(pressurePa) {
  if (!Number.isFinite(pressurePa) || pressurePa <= 0) {
    return 0;
  }
  return clamp(pressurePa / 101_325, 0, 1);
}

function interpolateSeaToVac(vacuumValue, seaLevelValue, pressurePa) {
  const sea = Number.isFinite(seaLevelValue) ? seaLevelValue : vacuumValue;
  return vacuumValue - ((vacuumValue - sea) * pressureRatio(pressurePa));
}

function approachExp(current, target, dtSeconds, tauSeconds) {
  const tau = Math.max(1e-4, Number(tauSeconds) || 1e-4);
  const alpha = clamp((Number(dtSeconds) || 0) / tau, 0, 1);
  return current + ((target - current) * alpha);
}

function defaultCombustionConfig(config = null) {
  const source = config?.combustion && typeof config.combustion === "object"
    ? config.combustion
    : {};
  return {
    nominalChamberPressurePa: Math.max(1, finiteNumber(source.nominalChamberPressurePa, 27_500_000)),
    turbopumpIdleNorm: clamp(finiteNumber(source.turbopumpIdleNorm, 0.42), 0.08, 0.98),
    ignitionPumpThreshold: clamp(finiteNumber(source.ignitionPumpThreshold, 0.18), 0.04, 0.92),
    turbopumpRiseTauSec: Math.max(0.01, finiteNumber(source.turbopumpRiseTauSec, 0.08)),
    turbopumpFallTauSec: Math.max(0.01, finiteNumber(source.turbopumpFallTauSec, 0.14)),
    chamberRiseTauSec: Math.max(0.01, finiteNumber(source.chamberRiseTauSec, 0.12)),
    chamberFallTauSec: Math.max(0.01, finiteNumber(source.chamberFallTauSec, 0.2)),
    minStableThrottle: clamp(finiteNumber(source.minStableThrottle, 0.28), 0.02, 0.95),
    combustionEfficiencyFloor: clamp(finiteNumber(source.combustionEfficiencyFloor, 0.56), 0.1, 1),
    exhaustTemperatureIdleK: Math.max(200, finiteNumber(source.exhaustTemperatureIdleK, 840)),
    exhaustTemperatureNominalK: Math.max(1200, finiteNumber(source.exhaustTemperatureNominalK, 3420)),
    mixtureRatioNominal: Math.max(0.1, finiteNumber(source.mixtureRatioNominal, 3.55)),
    mixtureRatioTransientRange: Math.max(0, finiteNumber(source.mixtureRatioTransientRange, 0.16)),
    lowThrottleAmbientPressurePaMin: Math.max(0, finiteNumber(source.lowThrottleAmbientPressurePaMin, 4_000)),
    lowThrottleFlameoutSec: Math.max(0.05, finiteNumber(source.lowThrottleFlameoutSec, 0.42)),
    restartCooldownSec: Math.max(0.05, finiteNumber(source.restartCooldownSec, 0.32)),
    hotRelightDamageScale: Math.max(0, finiteNumber(source.hotRelightDamageScale, 0.16)),
    failureHealthFloor: clamp(finiteNumber(source.failureHealthFloor, 0.52), 0.05, 0.95),
  };
}

function rawConfiguredThrustBounds(config = null) {
  const thrustVacuumN = Math.max(
    0,
    finiteNumber(config?.thrustVacuumN, finiteNumber(config?.thrustSeaLevelN, 0)),
  );
  const thrustSeaLevelN = Math.max(
    0,
    finiteNumber(config?.thrustSeaLevelN, thrustVacuumN),
  );
  return {
    thrustVacuumN,
    thrustSeaLevelN,
  };
}

function createEngineCombustionState(descriptor = null, index = 0, combustion = null) {
  const responseBias = 0.94 + (((index * 17) % 11) * 0.008);
  const manufactureQuality = 0.965 + (((index * 31) % 17) / 16) * 0.035;
  return {
    id: String(descriptor?.id || `engine_${index + 1}`),
    index,
    ring: String(descriptor?.ring || ""),
    x: finiteNumber(descriptor?.x, 0),
    y: finiteNumber(descriptor?.y, 0),
    z: finiteNumber(descriptor?.z, 0),
    orderInRing: finiteNonNegativeInteger(descriptor?.orderInRing, index),
    responseBias,
    manufactureQuality,
    health: 1,
    failed: false,
    failureMode: "",
    commanded: false,
    lastCommanded: false,
    ignited: false,
    flamePresent: false,
    cooldownRemainingSec: 0,
    unstableCombustionSec: 0,
    ignitionCycles: 0,
    hotRelightEvents: 0,
    throttleCommand: 0,
    turbopumpNorm: 0,
    chamberPressureRatio: 0,
    chamberPressurePa: 0,
    combustionEfficiency: 0,
    exhaustTemperatureK: combustion?.exhaustTemperatureIdleK || 840,
    mixtureRatio: combustion?.mixtureRatioNominal || 3.55,
    thrustN: 0,
    burnRateKgS: 0,
  };
}

function summarizeCombustionClusterState(state) {
  const engines = Array.isArray(state?.engines) ? state.engines : [];
  let totalThrustN = 0;
  let totalBurnRateKgS = 0;
  let totalChamberPressurePa = 0;
  let totalCombustionEfficiency = 0;
  let totalTurbopumpNorm = 0;
  let activeChamberCount = 0;
  let maxChamberPressurePa = 0;
  let maxExhaustTemperatureK = 0;
  const activeIndices = [];
  const activeDescriptors = [];
  const activeEngineThrustsN = [];
  const failedIndices = [];
  const faultedIndices = [];
  const flamePresentIndices = [];
  const chamberPressurePaByIndex = [];
  const exhaustTemperatureKByIndex = [];
  const combustionEfficiencyByIndex = [];
  const turbopumpNormByIndex = [];
  const thrustNByIndex = [];
  const failureModesByIndex = [];
  for (let index = 0; index < engines.length; index += 1) {
    const engine = engines[index];
    const thrustN = Math.max(0, finiteNumber(engine?.thrustN, 0));
    const burnRateKgS = Math.max(0, finiteNumber(engine?.burnRateKgS, 0));
    const chamberPressurePa = Math.max(0, finiteNumber(engine?.chamberPressurePa, 0));
    const combustionEfficiency = clamp(finiteNumber(engine?.combustionEfficiency, 0), 0, 1);
    const turbopumpNorm = clamp(finiteNumber(engine?.turbopumpNorm, 0), 0, 1);
    const exhaustTemperatureK = Math.max(0, finiteNumber(engine?.exhaustTemperatureK, 0));
    chamberPressurePaByIndex.push(chamberPressurePa);
    exhaustTemperatureKByIndex.push(exhaustTemperatureK);
    combustionEfficiencyByIndex.push(combustionEfficiency);
    turbopumpNormByIndex.push(turbopumpNorm);
    thrustNByIndex.push(thrustN);
    failureModesByIndex.push(String(engine?.failureMode || ""));
    totalThrustN += thrustN;
    totalBurnRateKgS += burnRateKgS;
    totalCombustionEfficiency += combustionEfficiency;
    totalTurbopumpNorm += turbopumpNorm;
    maxChamberPressurePa = Math.max(maxChamberPressurePa, chamberPressurePa);
    maxExhaustTemperatureK = Math.max(maxExhaustTemperatureK, exhaustTemperatureK);
    if (chamberPressurePa > 0.1) {
      totalChamberPressurePa += chamberPressurePa;
      activeChamberCount += 1;
    }
    if (thrustN > 1) {
      activeIndices.push(index);
      activeDescriptors.push(engine);
      activeEngineThrustsN.push(thrustN);
    }
    if (engine?.failed) {
      failedIndices.push(index);
    }
    if (engine?.failed || (Number(engine?.cooldownRemainingSec) || 0) > 1e-4) {
      faultedIndices.push(index);
    }
    if (engine?.flamePresent) {
      flamePresentIndices.push(index);
    }
  }
  state.activeIndices = activeIndices;
  state.activeDescriptors = activeDescriptors;
  state.activeEngineThrustsN = activeEngineThrustsN;
  state.failedIndices = failedIndices;
  state.faultedIndices = faultedIndices;
  state.flamePresentIndices = flamePresentIndices;
  state.chamberPressurePaByIndex = chamberPressurePaByIndex;
  state.exhaustTemperatureKByIndex = exhaustTemperatureKByIndex;
  state.combustionEfficiencyByIndex = combustionEfficiencyByIndex;
  state.turbopumpNormByIndex = turbopumpNormByIndex;
  state.engineThrustNByIndex = thrustNByIndex;
  state.failureModesByIndex = failureModesByIndex;
  state.activeCount = activeIndices.length;
  state.thrustN = totalThrustN;
  state.burnRateKgS = totalBurnRateKgS;
  state.avgChamberPressurePa = activeChamberCount > 0 ? totalChamberPressurePa / activeChamberCount : 0;
  state.maxChamberPressurePa = maxChamberPressurePa;
  state.avgCombustionEfficiency = engines.length > 0 ? totalCombustionEfficiency / engines.length : 0;
  state.avgTurbopumpNorm = engines.length > 0 ? totalTurbopumpNorm / engines.length : 0;
  state.maxExhaustTemperatureK = maxExhaustTemperatureK;
  return state;
}

export function createEngineCombustionClusterState({
  descriptors = [],
  activationOrder = null,
  config = null,
  fallbackEngineCount = 1,
} = {}) {
  const descriptorList = Array.isArray(descriptors) ? descriptors : [];
  const combustion = defaultCombustionConfig(config);
  const counts = resolveConfiguredEngineCounts(config, fallbackEngineCount || descriptorList.length || 1);
  const normalizedOrder = Array.isArray(activationOrder) && activationOrder.length > 0
    ? activationOrder.filter((index, position, array) => (
      Number.isInteger(index)
      && index >= 0
      && index < descriptorList.length
      && array.indexOf(index) === position
    ))
    : descriptorList.map((_, index) => index);
  return summarizeCombustionClusterState({
    engineCount: counts.engineCount,
    nominalEngineCount: counts.nominalEngineCount,
    descriptors: descriptorList.map((descriptor, index) => ({
      ...descriptor,
      index,
    })),
    activationOrder: normalizedOrder,
    combustion,
    engines: descriptorList.map((descriptor, index) => createEngineCombustionState(descriptor, index, combustion)),
    desiredIndices: [],
    inactiveIndices: descriptorList.map((_, index) => index),
    desiredCount: 0,
    activeIndices: [],
    activeDescriptors: [],
    activeEngineThrustsN: [],
    failedIndices: [],
    faultedIndices: [],
    flamePresentIndices: [],
    chamberPressurePaByIndex: [],
    exhaustTemperatureKByIndex: [],
    combustionEfficiencyByIndex: [],
    turbopumpNormByIndex: [],
    engineThrustNByIndex: [],
    failureModesByIndex: [],
    activeCount: 0,
    fullPerEngineThrustN: 0,
    thrustN: 0,
    burnRateKgS: 0,
    avgChamberPressurePa: 0,
    maxChamberPressurePa: 0,
    avgCombustionEfficiency: 0,
    avgTurbopumpNorm: 0,
    maxExhaustTemperatureK: combustion.exhaustTemperatureIdleK,
    pressurePa: 0,
    throttleCommand: 0,
    ispS: 0,
  });
}

export function hydrateEngineCombustionClusterState(snapshot = null, options = {}) {
  const base = createEngineCombustionClusterState(options);
  if (!snapshot || typeof snapshot !== "object") {
    return base;
  }
  base.engineCount = finiteNonNegativeInteger(snapshot.engineCount, base.engineCount);
  base.nominalEngineCount = Math.max(1, finiteNonNegativeInteger(snapshot.nominalEngineCount, base.nominalEngineCount));
  base.desiredCount = finiteNonNegativeInteger(snapshot.desiredCount, 0);
  base.pressurePa = Math.max(0, finiteNumber(snapshot.pressurePa, 0));
  base.throttleCommand = clamp(finiteNumber(snapshot.throttleCommand, 0), 0, 1);
  base.ispS = Math.max(0, finiteNumber(snapshot.ispS, 0));
  const incomingCombustion = snapshot.combustion && typeof snapshot.combustion === "object"
    ? snapshot.combustion
    : {};
  base.combustion = {
    ...base.combustion,
    ...incomingCombustion,
  };
  const incomingEngines = Array.isArray(snapshot.engines) ? snapshot.engines : [];
  for (let index = 0; index < base.engines.length; index += 1) {
    const engine = base.engines[index];
    const incoming = incomingEngines[index];
    if (!incoming || typeof incoming !== "object") {
      continue;
    }
    engine.health = clamp(finiteNumber(incoming.health, engine.health), 0, 1);
    engine.failed = Boolean(incoming.failed);
    engine.failureMode = String(incoming.failureMode || "");
    engine.commanded = Boolean(incoming.commanded);
    engine.lastCommanded = Boolean(incoming.lastCommanded);
    engine.ignited = Boolean(incoming.ignited);
    engine.flamePresent = Boolean(incoming.flamePresent);
    engine.cooldownRemainingSec = Math.max(0, finiteNumber(incoming.cooldownRemainingSec, 0));
    engine.unstableCombustionSec = Math.max(0, finiteNumber(incoming.unstableCombustionSec, 0));
    engine.ignitionCycles = finiteNonNegativeInteger(incoming.ignitionCycles, 0);
    engine.hotRelightEvents = finiteNonNegativeInteger(incoming.hotRelightEvents, 0);
    engine.throttleCommand = clamp(finiteNumber(incoming.throttleCommand, 0), 0, 1);
    engine.turbopumpNorm = clamp(finiteNumber(incoming.turbopumpNorm, 0), 0, 1);
    engine.chamberPressureRatio = clamp(finiteNumber(incoming.chamberPressureRatio, 0), 0, 1.2);
    engine.chamberPressurePa = Math.max(0, finiteNumber(incoming.chamberPressurePa, 0));
    engine.combustionEfficiency = clamp(finiteNumber(incoming.combustionEfficiency, 0), 0, 1);
    engine.exhaustTemperatureK = Math.max(0, finiteNumber(incoming.exhaustTemperatureK, base.combustion.exhaustTemperatureIdleK));
    engine.mixtureRatio = Math.max(0.1, finiteNumber(incoming.mixtureRatio, base.combustion.mixtureRatioNominal));
    engine.thrustN = Math.max(0, finiteNumber(incoming.thrustN, 0));
    engine.burnRateKgS = Math.max(0, finiteNumber(incoming.burnRateKgS, 0));
  }
  return summarizeCombustionClusterState(base);
}

export function transferEngineCombustionClusterState(sourceState = null, options = {}) {
  return hydrateEngineCombustionClusterState(sourceState, options);
}

export function updateEngineCombustionClusterState(state, {
  config = null,
  dtSeconds = 0,
  pressurePa = 0,
  throttleCommand = 0,
  desiredEngineCount = null,
  failedEngineIndices = null,
} = {}) {
  if (!state || typeof state !== "object") {
    return null;
  }
  const descriptorCount = Array.isArray(state.descriptors) ? state.descriptors.length : 0;
  const counts = resolveConfiguredEngineCounts(
    config,
    state.nominalEngineCount || descriptorCount || 1,
  );
  const combustion = {
    ...state.combustion,
    ...defaultCombustionConfig(config),
  };
  state.combustion = combustion;
  state.engineCount = counts.engineCount;
  state.nominalEngineCount = counts.nominalEngineCount;
  state.pressurePa = Math.max(0, finiteNumber(pressurePa, 0));
  state.throttleCommand = clamp(finiteNumber(throttleCommand, 0), 0, 1);
  const internalFailedSet = new Set(
    state.engines
      .map((engine, index) => (engine?.failed ? index : null))
      .filter((value) => Number.isInteger(value)),
  );
  const externalFailedSet = normalizedIndexSet(failedEngineIndices, descriptorCount);
  const effectiveFailedIndices = Array.from(new Set([
    ...internalFailedSet,
    ...externalFailedSet,
  ]));
  const resolvedDesiredCount = desiredEngineCount === null || desiredEngineCount === undefined
    ? counts.engineCount
    : finiteNonNegativeInteger(desiredEngineCount, counts.engineCount);
  const selection = resolveActiveEngineSelection({
    descriptors: state.descriptors,
    activationOrder: state.activationOrder,
    desiredEngineCount: resolvedDesiredCount,
    failedEngineIndices: effectiveFailedIndices,
  });
  state.desiredIndices = [...selection.desiredIndices];
  state.inactiveIndices = [...selection.inactiveIndices];
  state.desiredCount = selection.desiredCount;

  const rawThrust = rawConfiguredThrustBounds(config);
  const perEngineThrustVacuumN = counts.nominalEngineCount > 0
    ? rawThrust.thrustVacuumN / counts.nominalEngineCount
    : 0;
  const perEngineThrustSeaLevelN = counts.nominalEngineCount > 0
    ? rawThrust.thrustSeaLevelN / counts.nominalEngineCount
    : 0;
  const fullPerEngineThrustN = interpolateSeaToVac(
    perEngineThrustVacuumN,
    perEngineThrustSeaLevelN,
    state.pressurePa,
  );
  state.fullPerEngineThrustN = Math.max(0, fullPerEngineThrustN);
  const ispS = interpolateSeaToVac(
    finiteNumber(config?.ispVacuumS, finiteNumber(config?.ispSeaLevelS, 0)),
    finiteNumber(config?.ispSeaLevelS, finiteNumber(config?.ispVacuumS, 0)),
    state.pressurePa,
  );
  state.ispS = Math.max(0, ispS);

  const desiredSet = new Set(selection.desiredIndices);
  const failedSet = new Set(effectiveFailedIndices);
  const dt = Math.max(0, finiteNumber(dtSeconds, 0));
  const stableThrottleBlend = clamp(
    (state.throttleCommand - combustion.minStableThrottle)
      / Math.max(1 - combustion.minStableThrottle, 1e-6),
    0,
    1,
  );
  for (let index = 0; index < state.engines.length; index += 1) {
    const engine = state.engines[index];
    const wasCommanded = Boolean(engine.lastCommanded);
    const preUpdateChamberRatio = clamp(finiteNumber(engine.chamberPressureRatio, 0), 0, 1.2);
    engine.failed = failedSet.has(index);
    engine.cooldownRemainingSec = Math.max(0, finiteNumber(engine.cooldownRemainingSec, 0) - dt);
    const commanded = desiredSet.has(index) && !engine.failed && state.throttleCommand > 1e-5;
    engine.commanded = commanded;
    engine.throttleCommand = commanded ? state.throttleCommand : 0;
    if (commanded && !wasCommanded) {
      engine.ignitionCycles += 1;
      const hotRelightSeverity = clamp((preUpdateChamberRatio - 0.08) / 0.32, 0, 1);
      if (hotRelightSeverity > 1e-4) {
        engine.hotRelightEvents += 1;
        engine.health = clamp(
          engine.health - (hotRelightSeverity * combustion.hotRelightDamageScale * (1.02 - engine.manufactureQuality)),
          0,
          1,
        );
        if (engine.health < combustion.failureHealthFloor && hotRelightSeverity > 0.55) {
          engine.failed = true;
          engine.failureMode = engine.failureMode || "hot_relight_failure";
        }
      }
    }
    engine.lastCommanded = commanded;
    const effectiveCommanded = commanded && !engine.failed && engine.cooldownRemainingSec <= 1e-6;
    const targetPumpNorm = commanded
      ? (combustion.turbopumpIdleNorm + ((1 - combustion.turbopumpIdleNorm) * state.throttleCommand))
      : 0;
    const pumpTau = targetPumpNorm >= engine.turbopumpNorm
      ? combustion.turbopumpRiseTauSec * engine.responseBias
      : combustion.turbopumpFallTauSec * engine.responseBias;
    engine.turbopumpNorm = clamp(
      approachExp(engine.turbopumpNorm, targetPumpNorm, dt, pumpTau),
      0,
      1,
    );
    const pumpReadyBlend = clamp(
      (engine.turbopumpNorm - combustion.ignitionPumpThreshold)
        / Math.max(1 - combustion.ignitionPumpThreshold, 1e-6),
      0,
      1,
    );
    if (effectiveCommanded && pumpReadyBlend > 0.04) {
      engine.ignited = true;
    } else if (!effectiveCommanded && engine.chamberPressureRatio <= 0.015) {
      engine.ignited = false;
    }
    const lowThrottleInstability = (
      effectiveCommanded
      && state.pressurePa >= combustion.lowThrottleAmbientPressurePaMin
      && state.throttleCommand < (combustion.minStableThrottle * 0.92)
      && pumpReadyBlend > 0.55
    );
    if (lowThrottleInstability) {
      const instabilitySeverity = clamp(
        (combustion.minStableThrottle - state.throttleCommand)
          / Math.max(combustion.minStableThrottle, 1e-6),
        0,
        1,
      );
      engine.unstableCombustionSec += dt * (0.72 + (0.6 * instabilitySeverity)) * (1.018 - engine.manufactureQuality);
      if (engine.unstableCombustionSec >= combustion.lowThrottleFlameoutSec && !engine.failed) {
        engine.cooldownRemainingSec = combustion.restartCooldownSec * (1.03 - engine.manufactureQuality);
        engine.unstableCombustionSec = 0;
        engine.ignited = false;
        engine.flamePresent = false;
        engine.health = clamp(engine.health - (0.045 * (1.02 - engine.manufactureQuality)), 0, 1);
        if (engine.health < combustion.failureHealthFloor) {
          engine.failed = true;
          engine.failureMode = "combustion_instability";
        } else {
          engine.failureMode = "flameout";
        }
      }
    } else {
      engine.unstableCombustionSec = Math.max(0, engine.unstableCombustionSec - (dt * 1.8));
    }
    const targetChamberRatio = (effectiveCommanded && engine.ignited)
      ? clamp(state.throttleCommand * pumpReadyBlend, 0, 1)
      : 0;
    const chamberTau = targetChamberRatio >= engine.chamberPressureRatio
      ? combustion.chamberRiseTauSec * engine.responseBias
      : combustion.chamberFallTauSec * engine.responseBias;
    engine.chamberPressureRatio = clamp(
      approachExp(engine.chamberPressureRatio, targetChamberRatio, dt, chamberTau),
      0,
      1.1,
    );
    engine.combustionEfficiency = effectiveCommanded
      ? clamp(
        (
          combustion.combustionEfficiencyFloor
          + ((1 - combustion.combustionEfficiencyFloor) * ((0.42 * pumpReadyBlend) + (0.58 * stableThrottleBlend)))
        )
          * clamp(engine.health, 0.35, 1),
        0,
        1,
      )
      : 0;
    const mixtureOffset = combustion.mixtureRatioTransientRange * (0.5 - state.throttleCommand) * 0.35;
    const targetMixtureRatio = combustion.mixtureRatioNominal + (effectiveCommanded ? mixtureOffset : 0);
    engine.mixtureRatio = approachExp(
      engine.mixtureRatio,
      targetMixtureRatio,
      dt,
      effectiveCommanded ? 0.24 * engine.responseBias : 0.18 * engine.responseBias,
    );
    engine.chamberPressurePa = combustion.nominalChamberPressurePa * engine.chamberPressureRatio;
    const thermalBlend = Math.pow(
      clamp(engine.chamberPressureRatio * Math.max(engine.combustionEfficiency, 0), 0, 1),
      0.72,
    );
    engine.exhaustTemperatureK = combustion.exhaustTemperatureIdleK
      + ((combustion.exhaustTemperatureNominalK - combustion.exhaustTemperatureIdleK) * thermalBlend);
    engine.thrustN = state.fullPerEngineThrustN
      * engine.chamberPressureRatio
      * (0.84 + (0.16 * engine.combustionEfficiency))
      * clamp(engine.health, 0, 1);
    engine.burnRateKgS = engine.thrustN > 0 && state.ispS > 0
      ? engine.thrustN / (state.ispS * STANDARD_GRAVITY_M_S2)
      : 0;
    engine.flamePresent = engine.ignited && engine.thrustN > (state.fullPerEngineThrustN * 0.04);
    if (!engine.failed && engine.failureMode === "flameout" && engine.cooldownRemainingSec <= 1e-4) {
      engine.failureMode = "";
    }
  }

  return summarizeCombustionClusterState(state);
}
