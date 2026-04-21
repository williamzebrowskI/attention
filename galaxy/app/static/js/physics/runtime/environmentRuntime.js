import { earthAtmosphereSampleUS1976 } from "../atmosphere/atmosphereDynamics.js";
import { createEarthEopProvider } from "../dynamics/simulatedEarthEopProvider.js";
import {
  createInternalEnvironmentForcingSnapshot,
  normalizeEnvironmentScenario,
} from "../environment/internalEnvironmentModels.js";
import { createLaunchWeatherProvider } from "../launch/simulatedLaunchWeatherProvider.js";
import { createSpaceWeatherProvider } from "../space_weather/simulatedSpaceWeatherProvider.js";

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function cloneSnapshot(snapshot) {
  if (snapshot === undefined) {
    return undefined;
  }
  if (snapshot === null) {
    return null;
  }
  if (Array.isArray(snapshot)) {
    return snapshot.map((entry) => cloneSnapshot(entry));
  }
  if (typeof snapshot === "object") {
    const cloned = {};
    for (const [key, value] of Object.entries(snapshot)) {
      cloned[key] = cloneSnapshot(value);
    }
    return cloned;
  }
  return snapshot;
}

function longitudeDifferenceDeg(a, b) {
  const aDeg = finiteNumber(a);
  const bDeg = finiteNumber(b);
  if (!Number.isFinite(aDeg) || !Number.isFinite(bDeg)) {
    return Number.POSITIVE_INFINITY;
  }
  let delta = Math.abs(aDeg - bDeg) % 360;
  if (delta > 180) {
    delta = 360 - delta;
  }
  return delta;
}

export function createPhysicsEnvironmentRuntime(options = {}) {
  const {
    spaceWeatherRefreshIntervalMs = 5 * 60 * 1000,
    earthEopRefreshIntervalMs = 6 * 60 * 60 * 1000,
    launchWeatherRefreshIntervalMs = 5 * 60 * 1000,
    getLaunchSite = () => ({
      latitudeDeg: 28.5618571,
      longitudeDeg: -80.577366,
      siteName: "Launch Site",
    }),
    resolveEarthLatLon = () => null,
    sampleAtmosphere = earthAtmosphereSampleUS1976,
  } = options;

  let spaceWeatherProvider = null;
  let earthEopProvider = null;
  let launchWeatherProvider = null;
  let forcingSnapshot = createInternalEnvironmentForcingSnapshot("moderate", Date.now());

  function currentScenario() {
    return normalizeEnvironmentScenario(forcingSnapshot?.scenario || "moderate");
  }

  function ensureSpaceWeatherProvider() {
    if (spaceWeatherProvider) {
      return spaceWeatherProvider;
    }
    spaceWeatherProvider = createSpaceWeatherProvider({
      refreshIntervalMs: spaceWeatherRefreshIntervalMs,
      scenario: currentScenario(),
    });
    return spaceWeatherProvider;
  }

  function ensureEarthEopProvider() {
    if (earthEopProvider) {
      return earthEopProvider;
    }
    earthEopProvider = createEarthEopProvider({
      refreshIntervalMs: earthEopRefreshIntervalMs,
      scenario: currentScenario(),
    });
    return earthEopProvider;
  }

  function ensureLaunchWeatherProvider() {
    if (launchWeatherProvider) {
      return launchWeatherProvider;
    }
    launchWeatherProvider = createLaunchWeatherProvider({
      refreshIntervalMs: launchWeatherRefreshIntervalMs,
      scenario: currentScenario(),
      locationProvider: () => {
        const launchSite = getLaunchSite() || {};
        return {
          latitudeDeg: Number(launchSite.latitudeDeg),
          longitudeDeg: Number(launchSite.longitudeDeg),
          siteName: String(launchSite.siteName || launchSite.name || "").trim(),
        };
      },
    });
    return launchWeatherProvider;
  }

  async function start() {
    ensureSpaceWeatherProvider().start();
    ensureLaunchWeatherProvider().start();
    await ensureEarthEopProvider().refresh();
  }

  function stop() {
    spaceWeatherProvider?.stop?.();
    earthEopProvider?.stop?.();
    launchWeatherProvider?.stop?.();
  }

  function applyConfigForcing(forcingPayload = null) {
    const updatedAtMs = Date.parse(String(forcingPayload?.updated_at_utc || forcingPayload?.updatedAtUtc || "").trim());
    forcingSnapshot = createInternalEnvironmentForcingSnapshot(
      normalizeEnvironmentScenario(forcingPayload?.scenario || forcingSnapshot?.scenario || "moderate"),
      Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now(),
    );
    return currentEnvironmentForcingSnapshot();
  }

  function currentEnvironmentForcingSnapshot() {
    return cloneSnapshot(forcingSnapshot);
  }

  function currentSpaceWeatherSnapshot() {
    return cloneSnapshot(spaceWeatherProvider?.snapshot?.() || null);
  }

  function currentEarthEopSnapshot() {
    return cloneSnapshot(earthEopProvider?.snapshot?.() || null);
  }

  function currentLaunchWeatherSnapshot() {
    return cloneSnapshot(launchWeatherProvider?.snapshot?.() || null);
  }

  async function setScenario(scenario = "moderate", forceRefresh = true) {
    const scenarioLabel = normalizeEnvironmentScenario(scenario);
    const previousScenario = currentScenario();
    forcingSnapshot = createInternalEnvironmentForcingSnapshot(scenarioLabel, Date.now());
    if (forceRefresh || scenarioLabel !== previousScenario) {
      const refreshTasks = [];
      if (spaceWeatherProvider) {
        refreshTasks.push(spaceWeatherProvider.setScenario?.(scenarioLabel) || spaceWeatherProvider.refresh?.());
      }
      if (earthEopProvider) {
        refreshTasks.push(earthEopProvider.setScenario?.(scenarioLabel) || earthEopProvider.refresh?.());
      }
      if (launchWeatherProvider) {
        refreshTasks.push(launchWeatherProvider.setScenario?.(scenarioLabel) || launchWeatherProvider.refresh?.());
      }
      await Promise.all(refreshTasks);
    }
    return currentEnvironmentForcingSnapshot();
  }

  function resolveLatLon(context = {}) {
    const latitudeDeg = finiteNumber(context?.latitudeDeg);
    const longitudeDeg = finiteNumber(context?.longitudeDeg);
    if (Number.isFinite(latitudeDeg) && Number.isFinite(longitudeDeg)) {
      return { latitudeDeg, longitudeDeg };
    }
    return resolveEarthLatLon(context);
  }

  function sampleLaunchWeather(context = {}) {
    const snapshot = launchWeatherProvider?.snapshot?.() || null;
    if (!snapshot) {
      return null;
    }
    const latLon = resolveLatLon(context);
    if (!latLon) {
      return null;
    }
    const siteLatitudeDeg = finiteNumber(snapshot.latitudeDeg);
    const siteLongitudeDeg = finiteNumber(snapshot.longitudeDeg);
    if (
      !Number.isFinite(siteLatitudeDeg)
      || !Number.isFinite(siteLongitudeDeg)
      || Math.abs(latLon.latitudeDeg - siteLatitudeDeg) > 2.5
      || longitudeDifferenceDeg(latLon.longitudeDeg, siteLongitudeDeg) > 2.5
    ) {
      return null;
    }
    const surfaceWind = launchWeatherProvider?.surfaceWindComponentsMS?.() || null;
    return {
      source: snapshot.source,
      temperatureC: finiteNumber(snapshot.temperatureC),
      relativeHumidity: finiteNumber(snapshot.relativeHumidity),
      windSpeedMS: finiteNumber(snapshot.windSpeedMS),
      windDirectionDeg: finiteNumber(snapshot.windDirectionDeg),
      windEastMS: finiteNumber(surfaceWind?.eastMS),
      windNorthMS: finiteNumber(surfaceWind?.northMS),
    };
  }

  function sampleEarthAtmosphere(altitudeKm, context = {}) {
    const spaceWeatherSnapshot = spaceWeatherProvider?.snapshot?.() || null;
    const launchWeather = sampleLaunchWeather({
      ...context,
      altitudeKm,
    });
    const timestampMs = finiteNumber(context?.timestampMs) || Date.now();
    const latLon = resolveLatLon(context) || { latitudeDeg: 0, longitudeDeg: 0 };
    const atmosphereOptions = spaceWeatherProvider?.atmosphereOptions?.({
      timestampMs,
      latitudeDeg: latLon.latitudeDeg,
      longitudeDeg: latLon.longitudeDeg,
    }) || {
      timestampMs,
      latitudeDeg: latLon.latitudeDeg,
      longitudeDeg: latLon.longitudeDeg,
      f107: finiteNumber(spaceWeatherSnapshot?.f107) || 150,
      f107a: finiteNumber(spaceWeatherSnapshot?.f107a) || finiteNumber(spaceWeatherSnapshot?.f107) || 150,
      kp: finiteNumber(spaceWeatherSnapshot?.kp) || 3,
      kpHistory: Array.isArray(spaceWeatherSnapshot?.kpHistory) ? spaceWeatherSnapshot.kpHistory : [],
    };
    if (Number(altitudeKm) <= 20 && Number.isFinite(finiteNumber(launchWeather?.relativeHumidity))) {
      atmosphereOptions.relativeHumidity = Number(launchWeather.relativeHumidity);
    }
    return sampleAtmosphere(altitudeKm, atmosphereOptions);
  }

  function sampleEarthOrientation(timestampMs = Date.now()) {
    return earthEopProvider?.sampleOrientation?.(timestampMs) || null;
  }

  return {
    start,
    stop,
    applyConfigForcing,
    setScenario,
    currentEnvironmentForcingSnapshot,
    currentSpaceWeatherSnapshot,
    currentEarthEopSnapshot,
    currentLaunchWeatherSnapshot,
    sampleLaunchWeather,
    sampleEarthAtmosphere,
    sampleEarthOrientation,
  };
}
