import { earthAtmosphereSampleUS1976 } from "../atmosphere/atmosphereDynamics.js";
import { createEarthEopProvider } from "../dynamics/simulatedEarthEopProvider.js";
import {
  createInternalEnvironmentForcingSnapshot,
  normalizeEnvironmentScenario,
} from "../environment/internalEnvironmentModels.js";
import { createLaunchWeatherProvider } from "../launch/simulatedLaunchWeatherProvider.js";
import { createSpaceWeatherProvider } from "../space_weather/simulatedSpaceWeatherProvider.js";
import {
  sampleEarthSurfaceAtRelativePosition,
  surfacePointRelativeKmAtLatLon,
} from "../surface/earthSurfacePhysics.js";

const EARTH_MEAN_RADIUS_KM = 6371.0084;
const WGS84_EQUATORIAL_RADIUS_KM = 6378.137;
const WGS84_FIRST_ECCENTRICITY_SQ = 6.69437999014e-3;
const EARTH_STANDARD_MU_KM3_S2 = 398600.4418;
const EARTH_J2 = 1.08262668e-3;

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function finiteVector3(value) {
  const x = finiteNumber(value?.x);
  const y = finiteNumber(value?.y);
  const z = finiteNumber(value?.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  return { x, y, z };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rad(degrees) {
  return (degrees * Math.PI) / 180;
}

function lengthVector3(v) {
  return Math.sqrt((v.x * v.x) + (v.y * v.y) + (v.z * v.z));
}

function dotVector3(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function crossVector3(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function normalizeVector3(v, fallback = { x: 0, y: 0, z: 1 }) {
  const vector = finiteVector3(v);
  if (!vector) {
    return { ...fallback };
  }
  const mag = lengthVector3(vector);
  if (!(mag > 1e-12)) {
    return { ...fallback };
  }
  return {
    x: vector.x / mag,
    y: vector.y / mag,
    z: vector.z / mag,
  };
}

function sanitizeEarthAxes(rawAxes = {}) {
  const pole = normalizeVector3(rawAxes?.pole, { x: 0, y: 0, z: 1 });
  const xAxisRaw = normalizeVector3(rawAxes?.xAxis, { x: 1, y: 0, z: 0 });
  const yAxis = normalizeVector3(crossVector3(pole, xAxisRaw), { x: 0, y: 1, z: 0 });
  const xAxis = normalizeVector3(crossVector3(yAxis, pole), { x: 1, y: 0, z: 0 });
  return { xAxis, yAxis, pole };
}

function normalizeLongitudeDeg(longitudeDeg) {
  if (!Number.isFinite(longitudeDeg)) {
    return 0;
  }
  let lon = longitudeDeg % 360;
  if (lon > 180) {
    lon -= 360;
  } else if (lon < -180) {
    lon += 360;
  }
  return lon;
}

function bodyFixedVectorToWorld(vectorBody, earthAxes) {
  const axes = sanitizeEarthAxes(earthAxes);
  return {
    x: (axes.xAxis.x * vectorBody.x) + (axes.yAxis.x * vectorBody.y) + (axes.pole.x * vectorBody.z),
    y: (axes.xAxis.y * vectorBody.x) + (axes.yAxis.y * vectorBody.y) + (axes.pole.y * vectorBody.z),
    z: (axes.xAxis.z * vectorBody.x) + (axes.yAxis.z * vectorBody.y) + (axes.pole.z * vectorBody.z),
  };
}

function worldVectorToBodyFixed(vectorWorld, earthAxes) {
  const axes = sanitizeEarthAxes(earthAxes);
  return {
    x: dotVector3(vectorWorld, axes.xAxis),
    y: dotVector3(vectorWorld, axes.yAxis),
    z: dotVector3(vectorWorld, axes.pole),
  };
}

function localEnuBasisWorld(latitudeDeg, longitudeDeg, earthAxes) {
  const latRad = rad(clamp(Number(latitudeDeg) || 0, -90, 90));
  const lonRad = rad(normalizeLongitudeDeg(Number(longitudeDeg) || 0));
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLon = Math.sin(lonRad);
  const cosLon = Math.cos(lonRad);
  return {
    east: bodyFixedVectorToWorld({ x: -sinLon, y: cosLon, z: 0 }, earthAxes),
    north: bodyFixedVectorToWorld({
      x: -sinLat * cosLon,
      y: -sinLat * sinLon,
      z: cosLat,
    }, earthAxes),
    up: bodyFixedVectorToWorld({
      x: cosLat * cosLon,
      y: cosLat * sinLon,
      z: sinLat,
    }, earthAxes),
  };
}

function normalGravityMS2(latitudeDeg, altitudeKm = 0) {
  const latRad = rad(clamp(Number(latitudeDeg) || 0, -90, 90));
  const sinLat = Math.sin(latRad);
  const sin2 = sinLat * sinLat;
  const gamma0 = 9.7803253359
    * (1 + (0.00193185265241 * sin2))
    / Math.sqrt(1 - (WGS84_FIRST_ECCENTRICITY_SQ * sin2));
  const radiusRatio = WGS84_EQUATORIAL_RADIUS_KM
    / Math.max(1, WGS84_EQUATORIAL_RADIUS_KM + (Number(altitudeKm) || 0));
  return gamma0 * radiusRatio * radiusRatio;
}

function j2GravityAccelerationKmS2(relativePositionKm, earthAxes) {
  const rel = finiteVector3(relativePositionKm);
  if (!rel) {
    return null;
  }
  const body = worldVectorToBodyFixed(rel, earthAxes);
  const r2 = (body.x * body.x) + (body.y * body.y) + (body.z * body.z);
  const r = Math.sqrt(r2);
  if (!(r > 1e-9)) {
    return null;
  }
  const zRatio = body.z / r;
  const zRatio2 = zRatio * zRatio;
  const common = -EARTH_STANDARD_MU_KM3_S2 / (r * r * r);
  const j2Scale = 1.5 * EARTH_J2 * ((WGS84_EQUATORIAL_RADIUS_KM / r) ** 2);
  const xyFactor = 1 - (j2Scale * ((5 * zRatio2) - 1));
  const zFactor = 1 - (j2Scale * ((5 * zRatio2) - 3));
  return bodyFixedVectorToWorld({
    x: common * body.x * xyFactor,
    y: common * body.y * xyFactor,
    z: common * body.z * zFactor,
  }, earthAxes);
}

function windVectorFromEnuKmS(eastMS, northMS, upMS, latitudeDeg, longitudeDeg, earthAxes) {
  const basis = localEnuBasisWorld(latitudeDeg, longitudeDeg, earthAxes);
  const eastKmS = eastMS / 1000;
  const northKmS = northMS / 1000;
  const upKmS = upMS / 1000;
  return {
    x: (basis.east.x * eastKmS) + (basis.north.x * northKmS) + (basis.up.x * upKmS),
    y: (basis.east.y * eastKmS) + (basis.north.y * northKmS) + (basis.up.y * upKmS),
    z: (basis.east.z * eastKmS) + (basis.north.z * northKmS) + (basis.up.z * upKmS),
  };
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
    getEarthRadiusKm = () => EARTH_MEAN_RADIUS_KM,
    getLaunchSite = () => ({
      latitudeDeg: 25.9968983,
      longitudeDeg: -97.1547571,
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

  function launchSiteLatLon() {
    const launchSite = getLaunchSite() || {};
    const latitudeDeg = finiteNumber(launchSite.latitudeDeg);
    const longitudeDeg = finiteNumber(launchSite.longitudeDeg);
    if (!Number.isFinite(latitudeDeg) || !Number.isFinite(longitudeDeg)) {
      return null;
    }
    return {
      latitudeDeg,
      longitudeDeg: normalizeLongitudeDeg(longitudeDeg),
    };
  }

  function resolveEarthAxes(context = {}) {
    if (context?.earthAxes || context?.earthPole) {
      return sanitizeEarthAxes(context?.earthAxes || { pole: context?.earthPole });
    }
    return sanitizeEarthAxes();
  }

  function resolveEnvironmentLatLon(context = {}, surfaceSample = null) {
    const directLatLon = resolveLatLon(context);
    if (directLatLon) {
      return {
        latitudeDeg: directLatLon.latitudeDeg,
        longitudeDeg: normalizeLongitudeDeg(directLatLon.longitudeDeg),
      };
    }
    const surfaceLatitudeDeg = finiteNumber(surfaceSample?.latitudeDeg);
    const surfaceLongitudeDeg = finiteNumber(surfaceSample?.longitudeDeg);
    if (Number.isFinite(surfaceLatitudeDeg) && Number.isFinite(surfaceLongitudeDeg)) {
      return {
        latitudeDeg: surfaceLatitudeDeg,
        longitudeDeg: normalizeLongitudeDeg(surfaceLongitudeDeg),
      };
    }
    return launchSiteLatLon();
  }

  function sampleEarthSurface(context = {}) {
    const relativePositionKm = finiteVector3(context?.relativePositionKm);
    const earthAxes = resolveEarthAxes(context);
    const earthRadiusKm = finiteNumber(context?.earthRadiusKm)
      || finiteNumber(getEarthRadiusKm())
      || EARTH_MEAN_RADIUS_KM;
    if (relativePositionKm) {
      const sample = sampleEarthSurfaceAtRelativePosition(
        relativePositionKm,
        earthAxes,
        earthRadiusKm,
        { includeTerrain: true },
      );
      return sample
        ? {
          source: "wgs84-ellipsoid+procedural-terrain",
          ...sample,
        }
        : null;
    }

    const latLon = resolveEnvironmentLatLon(context);
    if (!latLon) {
      return null;
    }
    const surfacePoint = surfacePointRelativeKmAtLatLon(
      latLon.latitudeDeg,
      latLon.longitudeDeg,
      earthAxes,
      { includeTerrain: true },
    );
    return {
      source: "wgs84-ellipsoid+procedural-terrain",
      ...surfacePoint,
      surfacePointRelativeKm: surfacePoint.pointRelativeKm,
      altitudeAboveTerrainKm: 0,
    };
  }

  function sampleEnvironmentWind(context = {}, launchWeather = null, latLon = null) {
    const surfaceEastMS = finiteNumber(launchWeather?.windEastMS);
    const surfaceNorthMS = finiteNumber(launchWeather?.windNorthMS);
    if (!Number.isFinite(surfaceEastMS) || !Number.isFinite(surfaceNorthMS)) {
      return null;
    }
    const altitudeKm = Math.max(0, finiteNumber(context?.altitudeKm) || 0);
    const latitudeDeg = finiteNumber(latLon?.latitudeDeg) || 0;
    const longitudeDeg = finiteNumber(latLon?.longitudeDeg) || 0;
    const troposphereBlend = clamp(altitudeKm / 12, 0, 1);
    const stratosphereDecay = clamp((altitudeKm - 14) / 26, 0, 1);
    const boundaryLayerWeight = Math.exp(-altitudeKm / 1.6);
    const hemisphereSign = latitudeDeg >= 0 ? 1 : -1;
    const veerRad = rad(hemisphereSign * 22 * troposphereBlend);
    const speedScale = 1 + (0.55 * troposphereBlend) - (0.2 * stratosphereDecay);
    const freeEastMS = ((surfaceEastMS * Math.cos(veerRad)) - (surfaceNorthMS * Math.sin(veerRad))) * speedScale;
    const freeNorthMS = ((surfaceEastMS * Math.sin(veerRad)) + (surfaceNorthMS * Math.cos(veerRad))) * speedScale;
    const eastMS = (surfaceEastMS * boundaryLayerWeight) + (freeEastMS * (1 - boundaryLayerWeight));
    const northMS = (surfaceNorthMS * boundaryLayerWeight) + (freeNorthMS * (1 - boundaryLayerWeight));
    const upMS = 0;
    const vectorKmS = windVectorFromEnuKmS(
      eastMS,
      northMS,
      upMS,
      latitudeDeg,
      longitudeDeg,
      resolveEarthAxes(context),
    );
    return {
      source: launchWeather?.source || "launch-weather",
      model: "surface-weather+ekman-boundary-layer",
      altitudeKm,
      eastMS,
      northMS,
      upMS,
      speedMS: Math.hypot(eastMS, northMS, upMS),
      bearingToDeg: normalizeLongitudeDeg((Math.atan2(eastMS, northMS) * 180 / Math.PI) + 360),
      vectorKmS,
    };
  }

  function sampleEarthGravity(context = {}, latLon = null) {
    const latitudeDeg = finiteNumber(latLon?.latitudeDeg) || 0;
    const altitudeKm = finiteNumber(context?.altitudeKm) || 0;
    const normalMS2 = normalGravityMS2(latitudeDeg, altitudeKm);
    const accelerationKmS2 = j2GravityAccelerationKmS2(
      context?.relativePositionKm,
      resolveEarthAxes(context),
    );
    const magnitudeKmS2 = accelerationKmS2
      ? lengthVector3(accelerationKmS2)
      : normalMS2 / 1000;
    return {
      source: accelerationKmS2 ? "central-earth-gravity+j2" : "wgs84-normal-gravity",
      normalGravityMS2: normalMS2,
      normalGravityKmS2: normalMS2 / 1000,
      accelerationKmS2,
      magnitudeKmS2,
      magnitudeMS2: magnitudeKmS2 * 1000,
    };
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

  function sampleEnvironment(context = {}) {
    const timestampMs = finiteNumber(context?.timestampMs) || Date.now();
    const surface = sampleEarthSurface(context);
    const latLon = resolveEnvironmentLatLon(context, surface);
    const surfaceAltitudeKm = finiteNumber(surface?.altitudeAboveTerrainKm);
    const altitudeKm = finiteNumber(context?.altitudeKm)
      ?? (Number.isFinite(surfaceAltitudeKm) ? surfaceAltitudeKm : 0);
    const sampleContext = {
      ...context,
      ...(latLon || {}),
      altitudeKm,
      timestampMs,
    };
    const weather = sampleLaunchWeather(sampleContext);
    const atmosphere = sampleEarthAtmosphere(altitudeKm, sampleContext);
    const wind = sampleEnvironmentWind(sampleContext, weather, latLon);
    const gravity = sampleEarthGravity(sampleContext, latLon);
    const earthOrientation = sampleEarthOrientation(timestampMs);
    return {
      source: "physics-environment-runtime",
      fidelity: {
        atmosphere: "us1976+space-weather+surface-weather",
        launchWeather: weather?.source || "unavailable",
        wind: wind?.model || "unavailable",
        surface: surface?.source || "unavailable",
        gravity: gravity.source,
        earthOrientation: earthOrientation?.source || "unavailable",
      },
      timestampMs,
      latitudeDeg: finiteNumber(latLon?.latitudeDeg),
      longitudeDeg: finiteNumber(latLon?.longitudeDeg),
      altitudeKm,
      atmosphere,
      launchWeather: weather,
      wind,
      surface,
      gravity,
      earthOrientation,
    };
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
    sampleEarthSurface,
    sampleEnvironment,
  };
}
