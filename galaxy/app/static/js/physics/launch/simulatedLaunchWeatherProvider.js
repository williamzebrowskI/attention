import {
  generateSimulatedLaunchWeatherSnapshot,
  normalizeEnvironmentScenario,
} from "../environment/internalEnvironmentModels.js";

const DEFAULT_LAUNCH_WEATHER_SNAPSHOT = Object.freeze({
  siteName: "Launch Site",
  latitudeDeg: Number.NaN,
  longitudeDeg: Number.NaN,
  temperatureC: null,
  relativeHumidity: null,
  windSpeedMS: null,
  windDirectionDeg: null,
  windGustMS: null,
  source: "default_static",
  refreshedAtUtc: "",
  validTimeUtc: "",
  shortForecast: "",
  stale: true,
  ageSeconds: Number.POSITIVE_INFINITY,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value, fallback = Number.NaN) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeLongitudeDeg(longitudeDeg) {
  if (!Number.isFinite(Number(longitudeDeg))) {
    return Number.NaN;
  }
  let lon = Number(longitudeDeg) % 360;
  if (lon > 180) {
    lon -= 360;
  } else if (lon < -180) {
    lon += 360;
  }
  return lon;
}

function normalizeSnapshot(payload, fallback = DEFAULT_LAUNCH_WEATHER_SNAPSHOT) {
  const base = fallback || DEFAULT_LAUNCH_WEATHER_SNAPSHOT;
  const refreshedRaw = String(payload?.refreshed_at_utc || payload?.refreshedAtUtc || base.refreshedAtUtc || "").trim();
  const refreshedAtMs = refreshedRaw ? Date.parse(refreshedRaw) : Number.NaN;
  const ageSeconds = Number.isFinite(refreshedAtMs)
    ? Math.max(0, (Date.now() - refreshedAtMs) / 1000)
    : Number.POSITIVE_INFINITY;
  const rhPercent = finiteOr(payload?.relative_humidity ?? payload?.relativeHumidity, Number.NaN);
  const rhValue = Number.isFinite(rhPercent)
    ? (rhPercent > 1 ? rhPercent / 100 : rhPercent)
    : Number(base.relativeHumidity);
  return {
    siteName: String(payload?.site_name || payload?.siteName || base.siteName || "Launch Site").trim() || "Launch Site",
    latitudeDeg: finiteOr(payload?.latitude_deg ?? payload?.latitudeDeg, base.latitudeDeg),
    longitudeDeg: normalizeLongitudeDeg(payload?.longitude_deg ?? payload?.longitudeDeg ?? base.longitudeDeg),
    temperatureC: finiteOr(payload?.temperature_c ?? payload?.temperatureC, Number(base.temperatureC)),
    relativeHumidity: Number.isFinite(rhValue) ? clamp(rhValue, 0, 1) : null,
    windSpeedMS: finiteOr(payload?.wind_speed_m_s ?? payload?.windSpeedMS, Number(base.windSpeedMS)),
    windDirectionDeg: Number.isFinite(finiteOr(payload?.wind_direction_deg ?? payload?.windDirectionDeg, Number.NaN))
      ? (finiteOr(payload?.wind_direction_deg ?? payload?.windDirectionDeg, Number.NaN) % 360)
      : null,
    windGustMS: finiteOr(payload?.wind_gust_m_s ?? payload?.windGustMS, Number(base.windGustMS)),
    source: String(payload?.source || base.source || "default_static").trim() || "default_static",
    refreshedAtUtc: refreshedRaw,
    validTimeUtc: String(payload?.valid_time_utc || payload?.validTimeUtc || "").trim(),
    shortForecast: String(payload?.short_forecast || payload?.shortForecast || "").trim(),
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

function surfaceWindComponentsFromSnapshot(snapshotState) {
  const speedMS = Number(snapshotState?.windSpeedMS);
  const directionDeg = Number(snapshotState?.windDirectionDeg);
  if (!(speedMS >= 0) || !Number.isFinite(directionDeg)) {
    return null;
  }
  const directionRad = (Math.PI / 180) * directionDeg;
  return {
    eastMS: -(speedMS * Math.sin(directionRad)),
    northMS: -(speedMS * Math.cos(directionRad)),
    speedMS,
    directionDeg,
  };
}

export function createLaunchWeatherProvider(options = {}) {
  const refreshIntervalMs = Math.max(60_000, Number(options.refreshIntervalMs) || (5 * 60 * 1000));
  const onUpdate = typeof options.onUpdate === "function" ? options.onUpdate : null;
  const locationProvider = typeof options.locationProvider === "function"
    ? options.locationProvider
    : (() => null);
  let scenarioState = normalizeEnvironmentScenario(options.scenario || options.initialSnapshot?.scenario || "moderate");
  let snapshotState = normalizeSnapshot(options.initialSnapshot || null, DEFAULT_LAUNCH_WEATHER_SNAPSHOT);
  let refreshTimer = null;
  let refreshPromise = null;

  function resolvedSite() {
    const location = locationProvider() || {};
    return {
      latitudeDeg: finiteOr(location?.latitudeDeg, 28.5618571),
      longitudeDeg: normalizeLongitudeDeg(location?.longitudeDeg ?? -80.577366),
      siteName: String(location?.siteName || location?.name || snapshotState.siteName || "Launch Site").trim() || "Launch Site",
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

  function snapshot() {
    return { ...snapshotState };
  }

  async function refresh() {
    if (refreshPromise) {
      return refreshPromise;
    }
    refreshPromise = (async () => {
      const site = resolvedSite();
      snapshotState = normalizeSnapshot(
        generateSimulatedLaunchWeatherSnapshot({
          nowMs: Date.now(),
          scenario: scenarioState,
          siteName: site.siteName,
          latitudeDeg: site.latitudeDeg,
          longitudeDeg: site.longitudeDeg,
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

  function surfaceWindComponentsMS() {
    return surfaceWindComponentsFromSnapshot(snapshotState);
  }

  return {
    start,
    stop,
    refresh,
    setScenario,
    snapshot,
    surfaceWindComponentsMS,
  };
}
