import {
  generateSimulatedEarthEopSnapshot,
  normalizeEnvironmentScenario,
} from "../environment/internalEnvironmentModels.js";

const DEFAULT_EOP_SNAPSHOT = Object.freeze({
  source: "default_empty",
  refreshedAtUtc: "",
  records: [],
  stale: true,
  ageSeconds: Number.POSITIVE_INFINITY,
});

function finiteOr(value, fallback = Number.NaN) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function unixSecondsToMjd(unixSeconds) {
  return (Number(unixSeconds) / 86400) + 40587;
}

function timestampMsToMjd(timestampMs) {
  return unixSecondsToMjd((Number(timestampMs) || Date.now()) / 1000);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeRecord(raw) {
  const mjd = finiteOr(raw?.mjd, Number.NaN);
  const xArcsec = finiteOr(raw?.x_arcsec ?? raw?.xArcsec, Number.NaN);
  const yArcsec = finiteOr(raw?.y_arcsec ?? raw?.yArcsec, Number.NaN);
  const ut1UtcSec = finiteOr(raw?.ut1_utc_sec ?? raw?.ut1UtcSec, Number.NaN);
  const lodSec = finiteOr(raw?.lod_sec ?? raw?.lodSec, Number.NaN);
  if (!Number.isFinite(mjd) || !Number.isFinite(xArcsec) || !Number.isFinite(yArcsec) || !Number.isFinite(ut1UtcSec)) {
    return null;
  }
  return {
    mjd,
    xArcsec,
    yArcsec,
    ut1UtcSec,
    lodSec: Number.isFinite(lodSec) ? lodSec : null,
    dataType: String(raw?.data_type ?? raw?.dataType ?? "").trim(),
    timeUtc: String(raw?.time_utc ?? raw?.timeUtc ?? "").trim(),
  };
}

function normalizeSnapshot(payload, fallback = DEFAULT_EOP_SNAPSHOT) {
  const refreshedRaw = String(payload?.refreshed_at_utc || payload?.refreshedAtUtc || fallback?.refreshedAtUtc || "").trim();
  const refreshedAtMs = refreshedRaw ? Date.parse(refreshedRaw) : Number.NaN;
  const ageSeconds = Number.isFinite(refreshedAtMs)
    ? Math.max(0, (Date.now() - refreshedAtMs) / 1000)
    : Number.POSITIVE_INFINITY;
  const rawRecords = Array.isArray(payload?.records) ? payload.records : (Array.isArray(fallback?.records) ? fallback.records : []);
  const records = rawRecords
    .map(normalizeRecord)
    .filter((entry) => Boolean(entry))
    .sort((a, b) => a.mjd - b.mjd);
  return {
    source: String(payload?.source || fallback?.source || "default_empty").trim() || "default_empty",
    refreshedAtUtc: refreshedRaw,
    records,
    stale: !Number.isFinite(ageSeconds) || ageSeconds > (7 * 24 * 3600),
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

function interpolate(a, b, t) {
  return a + ((b - a) * t);
}

function interpolateOptional(a, b, t) {
  const aFinite = Number.isFinite(Number(a));
  const bFinite = Number.isFinite(Number(b));
  if (aFinite && bFinite) {
    return interpolate(Number(a), Number(b), t);
  }
  if (aFinite) {
    return Number(a);
  }
  if (bFinite) {
    return Number(b);
  }
  return null;
}

function upperBoundByMjd(records, targetMjd) {
  let lo = 0;
  let hi = records.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (records[mid].mjd <= targetMjd) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

export function createEarthEopProvider(options = {}) {
  const refreshIntervalMs = Math.max(60_000, Number(options.refreshIntervalMs) || (6 * 3600 * 1000));
  const onUpdate = typeof options.onUpdate === "function" ? options.onUpdate : null;
  const seed = String(options.seed || "galaxy-earth-eop-v1");
  const maxRecords = Math.max(100, Number(options.maxRecords) || 2200);
  let scenarioState = normalizeEnvironmentScenario(options.scenario || options.initialSnapshot?.scenario || "moderate");
  let snapshotState = normalizeSnapshot(
    options.initialSnapshot || generateSimulatedEarthEopSnapshot({ scenario: scenarioState, seed, maxRecords }),
    DEFAULT_EOP_SNAPSHOT,
  );
  let refreshTimer = null;
  let refreshPromise = null;

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
    return {
      ...snapshotState,
      records: Array.isArray(snapshotState.records)
        ? snapshotState.records.map((record) => ({ ...record }))
        : [],
    };
  }

  async function refresh() {
    if (refreshPromise) {
      return refreshPromise;
    }
    refreshPromise = (async () => {
      snapshotState = normalizeSnapshot(
        generateSimulatedEarthEopSnapshot({
          nowMs: Date.now(),
          seed,
          maxRecords,
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

  function sampleOrientation(timestampMs = Date.now()) {
    const records = Array.isArray(snapshotState.records) ? snapshotState.records : [];
    if (records.length === 0) {
      return null;
    }
    const targetMjd = timestampMsToMjd(timestampMs);
    if (!Number.isFinite(targetMjd)) {
      return null;
    }
    const upper = upperBoundByMjd(records, targetMjd);
    if (upper <= 0) {
      const record = records[0];
      return {
        ut1Sec: record.ut1UtcSec,
        xpArcsec: record.xArcsec,
        ypArcsec: record.yArcsec,
        lodSec: record.lodSec,
        source: `${snapshotState.source}:nearest`,
      };
    }
    if (upper >= records.length) {
      const record = records[records.length - 1];
      return {
        ut1Sec: record.ut1UtcSec,
        xpArcsec: record.xArcsec,
        ypArcsec: record.yArcsec,
        lodSec: record.lodSec,
        source: `${snapshotState.source}:nearest`,
      };
    }
    const lo = records[upper - 1];
    const hi = records[upper];
    const span = Math.max(1e-12, hi.mjd - lo.mjd);
    const t = clamp((targetMjd - lo.mjd) / span, 0, 1);
    return {
      ut1Sec: interpolate(lo.ut1UtcSec, hi.ut1UtcSec, t),
      xpArcsec: interpolate(lo.xArcsec, hi.xArcsec, t),
      ypArcsec: interpolate(lo.yArcsec, hi.yArcsec, t),
      lodSec: interpolateOptional(lo.lodSec, hi.lodSec, t),
      source: `${snapshotState.source}:interp`,
    };
  }

  return {
    start,
    stop,
    refresh,
    setScenario,
    snapshot,
    sampleOrientation,
  };
}

export const EARTH_EOP_DEFAULTS = DEFAULT_EOP_SNAPSHOT;
