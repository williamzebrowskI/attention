import {
  generateSimulatedSpaceWeatherSnapshot,
  normalizeEnvironmentScenario,
} from "../environment/internalEnvironmentModels.js";

const DEFAULT_SPACE_WEATHER = Object.freeze({
  f107: 150,
  f107a: 150,
  kp: 3,
  source: "default_quiet",
  refreshedAtUtc: "",
  kpTimeUtc: "",
  f107TimeUtc: "",
  kpHistory: [],
  stale: false,
  ageSeconds: 0,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeKpHistory(raw, fallback = []) {
  const source = Array.isArray(raw) ? raw : (Array.isArray(fallback) ? fallback : []);
  const normalized = [];
  for (let i = 0; i < source.length; i += 1) {
    const entry = source[i];
    const kp = clamp(finiteOr(entry?.kp, Number.NaN), 0, 9);
    if (!Number.isFinite(kp)) {
      continue;
    }
    normalized.push({
      kp,
      timeUtc: String(entry?.time_utc || entry?.timeUtc || "").trim(),
    });
    if (normalized.length >= 8) {
      break;
    }
  }
  return normalized;
}

function normalizeSnapshot(payload, fallback = DEFAULT_SPACE_WEATHER) {
  const base = fallback || DEFAULT_SPACE_WEATHER;
  const refreshedRaw = String(payload?.refreshed_at_utc || payload?.refreshedAtUtc || base.refreshedAtUtc || "").trim();
  const refreshedAtMs = refreshedRaw ? Date.parse(refreshedRaw) : Number.NaN;
  const ageSeconds = Number.isFinite(refreshedAtMs)
    ? Math.max(0, (Date.now() - refreshedAtMs) / 1000)
    : Number.POSITIVE_INFINITY;
  return {
    f107: clamp(finiteOr(payload?.f107_sfu ?? payload?.f107, base.f107), 60, 300),
    f107a: clamp(
      finiteOr(
        payload?.f107a_sfu
          ?? payload?.f107a
          ?? payload?.f107_average_sfu
          ?? payload?.f107AverageSfu,
        payload?.f107_sfu ?? payload?.f107 ?? base.f107a,
      ),
      60,
      300,
    ),
    kp: clamp(finiteOr(payload?.kp_index ?? payload?.kp, base.kp), 0, 9),
    source: String(payload?.source || base.source || "default_quiet").trim() || "default_quiet",
    refreshedAtUtc: refreshedRaw || "",
    kpTimeUtc: String(payload?.kp_time_utc || payload?.kpTimeUtc || "").trim(),
    f107TimeUtc: String(payload?.f107_time_utc || payload?.f107TimeUtc || "").trim(),
    kpHistory: normalizeKpHistory(payload?.kp_history ?? payload?.kpHistory, base.kpHistory),
    stale: !Number.isFinite(ageSeconds) || ageSeconds > (4 * 3600),
    ageSeconds: Number.isFinite(ageSeconds) ? ageSeconds : Number.POSITIVE_INFINITY,
  };
}

function setRefreshTimeout(callback, delayMs) {
  const timerApi = typeof globalThis?.setTimeout === "function" ? globalThis.setTimeout : null;
  return timerApi ? timerApi(callback, delayMs) : null;
}

function clearRefreshTimeout(handle) {
  const clearApi = typeof globalThis?.clearTimeout === "function" ? globalThis.clearTimeout : null;
  if (clearApi && handle !== null) {
    clearApi(handle);
  }
}

export function createSpaceWeatherProvider(options = {}) {
  const refreshIntervalMs = Math.max(20_000, Number(options.refreshIntervalMs) || (5 * 60 * 1000));
  const onUpdate = typeof options.onUpdate === "function" ? options.onUpdate : null;
  const seed = String(options.seed || "galaxy-space-weather-v1");
  let scenarioState = normalizeEnvironmentScenario(options.scenario || options.initialSnapshot?.scenario || "moderate");
  let snapshotState = normalizeSnapshot(
    options.initialSnapshot || generateSimulatedSpaceWeatherSnapshot({ scenario: scenarioState, seed }),
    DEFAULT_SPACE_WEATHER,
  );
  let refreshTimer = null;
  let refreshPromise = null;

  function snapshot() {
    return {
      ...snapshotState,
      kpHistory: Array.isArray(snapshotState.kpHistory) ? snapshotState.kpHistory.map((entry) => ({ ...entry })) : [],
    };
  }

  function scheduleNextRefresh() {
    if (refreshTimer !== null) {
      clearRefreshTimeout(refreshTimer);
      refreshTimer = null;
    }
    refreshTimer = setRefreshTimeout(() => {
      void refresh();
    }, refreshIntervalMs);
  }

  async function refresh() {
    if (refreshPromise) {
      return refreshPromise;
    }
    refreshPromise = (async () => {
      snapshotState = normalizeSnapshot(
        generateSimulatedSpaceWeatherSnapshot({
          nowMs: Date.now(),
          seed,
          scenario: scenarioState,
        }),
        snapshotState,
      );
      onUpdate?.(snapshot());
      scheduleNextRefresh();
      refreshPromise = null;
      return snapshot();
    })();
    return refreshPromise;
  }

  async function setScenario(scenario = "moderate") {
    scenarioState = normalizeEnvironmentScenario(scenario);
    return refresh();
  }

  function start() {
    if (refreshTimer !== null || refreshPromise) {
      return;
    }
    void refresh();
  }

  function stop() {
    if (refreshTimer !== null) {
      clearRefreshTimeout(refreshTimer);
      refreshTimer = null;
    }
  }

  function atmosphereOptions(optionsInput = {}) {
    const current = snapshotState;
    return {
      timestampMs: Number(optionsInput?.timestampMs) || Date.now(),
      latitudeDeg: Number(optionsInput?.latitudeDeg) || 0,
      longitudeDeg: Number(optionsInput?.longitudeDeg) || 0,
      f107: current.f107,
      f107a: current.f107a,
      kp: current.kp,
      kpHistory: Array.isArray(current.kpHistory) ? current.kpHistory.map((entry) => ({ ...entry })) : [],
      source: current.source,
    };
  }

  return {
    start,
    stop,
    refresh,
    setScenario,
    snapshot,
    atmosphereOptions,
  };
}

export const SPACE_WEATHER_DEFAULTS = DEFAULT_SPACE_WEATHER;
