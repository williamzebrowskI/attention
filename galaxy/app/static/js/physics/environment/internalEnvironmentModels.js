const SECONDS_PER_DAY = 86400;
const J2000_MJD = 51544.5;

export const ENVIRONMENT_SCENARIO_PROFILES = Object.freeze({
  quiet: Object.freeze({
    id: "quiet",
    label: "Quiet",
    description: "Calm geospace and low perturbation variance.",
    space_weather_kp_bias: -0.7,
    space_weather_kp_scale: 0.60,
    space_weather_storm_gain: 0.18,
    space_weather_f107_bias: -18.0,
    space_weather_f107_scale: 0.80,
    eop_polar_motion_scale: 0.80,
    eop_ut1_scale: 0.85,
    eop_lod_scale: 0.75,
  }),
  moderate: Object.freeze({
    id: "moderate",
    label: "Moderate",
    description: "Nominal day-to-day forcing around realistic averages.",
    space_weather_kp_bias: 0.0,
    space_weather_kp_scale: 1.0,
    space_weather_storm_gain: 1.0,
    space_weather_f107_bias: 0.0,
    space_weather_f107_scale: 1.0,
    eop_polar_motion_scale: 1.0,
    eop_ut1_scale: 1.0,
    eop_lod_scale: 1.0,
  }),
  storm: Object.freeze({
    id: "storm",
    label: "Storm",
    description: "Elevated geomagnetic activity with larger forcing swings.",
    space_weather_kp_bias: 1.2,
    space_weather_kp_scale: 1.35,
    space_weather_storm_gain: 2.1,
    space_weather_f107_bias: 18.0,
    space_weather_f107_scale: 1.22,
    eop_polar_motion_scale: 1.20,
    eop_ut1_scale: 1.10,
    eop_lod_scale: 1.18,
  }),
  extreme: Object.freeze({
    id: "extreme",
    label: "Extreme",
    description: "Stress-test forcing with high-variance space-weather and EOP dynamics.",
    space_weather_kp_bias: 2.4,
    space_weather_kp_scale: 1.80,
    space_weather_storm_gain: 3.5,
    space_weather_f107_bias: 40.0,
    space_weather_f107_scale: 1.55,
    eop_polar_motion_scale: 1.35,
    eop_ut1_scale: 1.28,
    eop_lod_scale: 1.32,
  }),
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number(fallback);
}

function utcIso(timestampMs = Date.now()) {
  return new Date(Number(timestampMs) || Date.now()).toISOString();
}

function timestampMsToMjd(timestampMs = Date.now()) {
  return ((Number(timestampMs) || Date.now()) / 1000 / SECONDS_PER_DAY) + 40587.0;
}

function mjdToTimestampMs(mjd = J2000_MJD) {
  return ((Number(mjd) - 40587.0) * SECONDS_PER_DAY) * 1000;
}

function dayOfYearUtc(date) {
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - yearStart) / (SECONDS_PER_DAY * 1000)) + 1;
}

function hashUnit(seed, index) {
  const key = `${String(seed || "")}:${Number(index) || 0}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash += hash << 13;
  hash ^= hash >>> 7;
  hash += hash << 3;
  hash ^= hash >>> 17;
  hash += hash << 5;
  return (hash >>> 0) / 4294967295;
}

function hashSigned(seed, index) {
  return (hashUnit(seed, index) * 2) - 1;
}

function smoothstep(t) {
  return t * t * (3 - (2 * t));
}

function valueNoise(x, scale, seed) {
  const safeScale = Math.max(1e-9, Number(scale) || 1);
  const coord = Number(x) / safeScale;
  const i0 = Math.floor(coord);
  const frac = coord - i0;
  const blend = smoothstep(frac);
  const n0 = hashSigned(seed, i0);
  const n1 = hashSigned(seed, i0 + 1);
  return n0 + ((n1 - n0) * blend);
}

function fractalNoise(x, seed, octaves) {
  let total = 0;
  let weight = 0;
  for (let i = 0; i < octaves.length; i += 1) {
    const [scale, amplitude] = octaves[i];
    const amp = Number(amplitude) || 0;
    if (!(amp > 0)) {
      continue;
    }
    total += amp * valueNoise(x, Number(scale) || 1, `${seed}:${scale}`);
    weight += amp;
  }
  return weight > 0 ? total / weight : 0;
}

function simulatedSpaceWeatherAtTimestampMs(timestampMs, seed) {
  const days = (Number(timestampMs) || Date.now()) / 1000 / SECONDS_PER_DAY;
  const solarCycle = Math.sin(((2 * Math.PI) * days / 4017.0) + 0.9);
  const rotation27d = Math.sin(((2 * Math.PI) * days / 27.2753) - 0.45);
  const mediumNoise = fractalNoise(days, `${seed}:kp-medium`, [
    [20.0, 1.0],
    [7.5, 0.6],
    [2.5, 0.3],
  ]);
  const shortNoise = fractalNoise(days, `${seed}:kp-short`, [
    [4.0, 1.0],
    [1.5, 0.45],
  ]);
  const stormDriver = valueNoise(days, 5.0, `${seed}:storm`);
  const storm = Math.max(0, stormDriver - 0.36) ** 2 * 10.0;
  let kp = 2.2
    + (0.95 * solarCycle)
    + (0.65 * rotation27d)
    + (0.70 * mediumNoise)
    + (0.35 * shortNoise)
    + storm;
  kp = clamp(kp, 0, 9);

  const f107Noise = fractalNoise(days, `${seed}:f107`, [
    [35.0, 1.0],
    [11.0, 0.5],
    [4.0, 0.2],
  ]);
  let f107 = 120.0
    + (42.0 * ((solarCycle + 1.0) * 0.5))
    + (10.0 * rotation27d)
    + (12.0 * f107Noise)
    + (20.0 * storm);
  f107 = clamp(f107, 60, 300);
  return { f107, kp };
}

function simulatedEarthEopForMjd(mjd, seed) {
  const daysFromJ2000 = Number(mjd) - J2000_MJD;
  const annual = (2 * Math.PI * daysFromJ2000) / 365.2422;
  const semiannual = (2 * Math.PI * daysFromJ2000) / 182.6211;
  const chandler = (2 * Math.PI * daysFromJ2000) / 433.1;
  const fortnight = (2 * Math.PI * daysFromJ2000) / 13.6608;
  const lunarMonth = (2 * Math.PI * daysFromJ2000) / 27.3217;

  const xNoise = fractalNoise(daysFromJ2000, `${seed}:xp`, [
    [120.0, 1.0],
    [40.0, 0.55],
    [12.0, 0.2],
  ]);
  const yNoise = fractalNoise(daysFromJ2000, `${seed}:yp`, [
    [120.0, 1.0],
    [40.0, 0.55],
    [12.0, 0.2],
  ]);
  const ut1Noise = fractalNoise(daysFromJ2000, `${seed}:ut1`, [
    [220.0, 1.0],
    [70.0, 0.5],
    [24.0, 0.2],
  ]);
  const lodNoise = fractalNoise(daysFromJ2000, `${seed}:lod`, [
    [30.0, 1.0],
    [10.0, 0.6],
    [3.0, 0.25],
  ]);

  let xArcsec = (
    (0.125 * Math.sin(chandler + 0.38))
    + (0.052 * Math.sin(annual - 1.15))
    + (0.018 * Math.sin(semiannual + 0.71))
    + (0.012 * xNoise)
  );
  let yArcsec = (
    (0.123 * Math.cos(chandler + 0.24))
    + (0.049 * Math.cos(annual - 0.74))
    + (0.017 * Math.sin(semiannual - 0.29))
    + (0.012 * yNoise)
  );
  xArcsec = clamp(xArcsec, -0.55, 0.55);
  yArcsec = clamp(yArcsec, -0.55, 0.55);

  let lodSec = (
    (0.00055 * Math.sin(fortnight + 0.27))
    + (0.00022 * Math.sin(annual - 0.42))
    + (0.00011 * Math.sin(lunarMonth + 0.93))
    + (0.00012 * lodNoise)
  );
  lodSec = clamp(lodSec, -0.003, 0.003);

  let ut1UtcSec = (
    (0.19 * Math.sin(annual + 0.61))
    + (0.09 * Math.sin(lunarMonth - 0.44))
    + (0.045 * ut1Noise)
    + (7.2 * lodSec)
  );
  ut1UtcSec = clamp(ut1UtcSec, -0.9, 0.9);

  return {
    mjd: Number(mjd),
    x_arcsec: xArcsec,
    y_arcsec: yArcsec,
    ut1_utc_sec: ut1UtcSec,
    lod_sec: lodSec,
    data_type: "P",
    time_utc: utcIso(mjdToTimestampMs(mjd)),
  };
}

export function normalizeEnvironmentScenario(value) {
  const scenario = String(value || "").trim().toLowerCase();
  if (scenario === "quiet" || scenario === "moderate" || scenario === "storm" || scenario === "extreme") {
    return scenario;
  }
  return "moderate";
}

export function environmentScenarioProfileForId(value) {
  const scenario = normalizeEnvironmentScenario(value);
  return { ...ENVIRONMENT_SCENARIO_PROFILES[scenario] };
}

export function createInternalEnvironmentForcingSnapshot(scenario = "moderate", nowMs = Date.now()) {
  const scenarioId = normalizeEnvironmentScenario(scenario);
  return {
    mode: "internal",
    scenario: scenarioId,
    updatedAtUtc: utcIso(nowMs),
    profile: environmentScenarioProfileForId(scenarioId),
  };
}

export function generateSimulatedSpaceWeatherSnapshot({
  nowMs = Date.now(),
  seed = "galaxy-space-weather-v1",
  scenario = "moderate",
} = {}) {
  const scenarioId = normalizeEnvironmentScenario(scenario);
  const profile = ENVIRONMENT_SCENARIO_PROFILES[scenarioId];
  const cadenceMs = 3 * 3600 * 1000;
  const bucketMs = Math.floor((Number(nowMs) || Date.now()) / cadenceMs) * cadenceMs;
  const bucketDate = new Date(bucketMs);
  const { f107: f107Base, kp: kpBase } = simulatedSpaceWeatherAtTimestampMs(bucketMs, seed);
  const kpStormComponent = Math.max(0, kpBase - 4.0) * Math.max(0, profile.space_weather_storm_gain - 1.0);
  const kp = clamp(
    (kpBase * profile.space_weather_kp_scale)
      + profile.space_weather_kp_bias
      + (0.55 * kpStormComponent),
    0,
    9,
  );
  const f107 = clamp(
    (f107Base * profile.space_weather_f107_scale) + profile.space_weather_f107_bias,
    60,
    300,
  );
  const kpHistory = [];
  for (let index = 0; index < 8; index += 1) {
    const historyMs = bucketMs - (index * cadenceMs);
    const historyDate = new Date(historyMs);
    const { kp: historyBase } = simulatedSpaceWeatherAtTimestampMs(historyMs, seed);
    const historyStormComponent = Math.max(0, historyBase - 4.0) * Math.max(0, profile.space_weather_storm_gain - 1.0);
    const historyKp = clamp(
      (historyBase * profile.space_weather_kp_scale)
        + profile.space_weather_kp_bias
        + (0.55 * historyStormComponent),
      0,
      9,
    );
    kpHistory.push({
      time_utc: historyDate.toISOString(),
      kp: historyKp,
    });
  }
  return {
    f107_sfu: f107,
    kp_index: kp,
    source: `simulated_space_weather:${scenarioId}`,
    refreshed_at_utc: utcIso(nowMs),
    kp_time_utc: bucketDate.toISOString(),
    f107_time_utc: bucketDate.toISOString(),
    kp_history: kpHistory,
    scenario: scenarioId,
  };
}

export function generateSimulatedLaunchWeatherSnapshot({
  nowMs = Date.now(),
  scenario = "moderate",
  siteName = "Launch Site",
  latitudeDeg = 25.9968983,
  longitudeDeg = -97.1547571,
} = {}) {
  const scenarioId = normalizeEnvironmentScenario(scenario);
  const now = new Date(Number(nowMs) || Date.now());
  const doyPhase = (2 * Math.PI * dayOfYearUtc(now)) / 365.25;
  const timePhase = (2 * Math.PI * (now.getUTCHours() + (now.getUTCMinutes() / 60))) / 24.0;
  const latitude = clamp(finiteOr(latitudeDeg, 25.9968983), -90, 90);
  const longitude = ((((finiteOr(longitudeDeg, -97.1547571) + 180) % 360) + 360) % 360) - 180;
  const coastalBias = Math.cos((Math.PI / 180) * latitude);
  const scenarioWindGain = { quiet: 0.70, moderate: 1.0, storm: 1.45, extreme: 2.0 }[scenarioId] || 1.0;
  const scenarioTempBias = { quiet: -1.0, moderate: 0.0, storm: 1.8, extreme: 3.5 }[scenarioId] || 0.0;
  const scenarioRhBias = { quiet: -0.05, moderate: 0.0, storm: 0.08, extreme: 0.12 }[scenarioId] || 0.0;
  const temperatureC = clamp(
    26.0
      + (4.5 * coastalBias)
      + (3.0 * Math.sin(timePhase - 1.2))
      + (1.8 * Math.sin(doyPhase))
      + scenarioTempBias,
    -40,
    45,
  );
  const relativeHumidity = clamp(
    0.70
      + (0.08 * Math.cos(timePhase + 0.4))
      - (0.04 * Math.sin(doyPhase))
      + scenarioRhBias,
    0.15,
    0.99,
  );
  const windSpeedMS = clamp(
    (4.8 + (2.0 * coastalBias) + (1.4 * Math.sin(timePhase + 0.8))) * scenarioWindGain,
    0,
    45,
  );
  const windDirectionDeg = (
    105.0
    + (28.0 * Math.sin(doyPhase + 0.5))
    + (12.0 * Math.sin(timePhase - 0.6))
  ) % 360;
  return {
    site_name: String(siteName || "Launch Site").trim() || "Launch Site",
    latitude_deg: latitude,
    longitude_deg: longitude,
    temperature_c: temperatureC,
    relative_humidity: relativeHumidity,
    wind_speed_m_s: windSpeedMS,
    wind_direction_deg: windDirectionDeg < 0 ? windDirectionDeg + 360 : windDirectionDeg,
    wind_gust_m_s: null,
    source: `simulated_launch_weather:${scenarioId}`,
    refreshed_at_utc: utcIso(nowMs),
    valid_time_utc: utcIso(nowMs),
    short_forecast: "Simulated launch-site weather",
    scenario: scenarioId,
  };
}

export function generateSimulatedEarthEopSnapshot({
  nowMs = Date.now(),
  seed = "galaxy-earth-eop-v1",
  maxRecords = 2200,
  scenario = "moderate",
} = {}) {
  const scenarioId = normalizeEnvironmentScenario(scenario);
  const profile = ENVIRONMENT_SCENARIO_PROFILES[scenarioId];
  const nowMjd = timestampMsToMjd(nowMs);
  const recordCount = Math.max(100, Math.floor(Number(maxRecords) || 2200));
  const futureDays = Math.max(14, Math.min(90, Math.floor(recordCount * 0.03)));
  const pastDays = recordCount - futureDays;
  const startMjd = Math.floor(nowMjd) - pastDays + 1;
  const records = [];
  for (let i = 0; i < recordCount; i += 1) {
    const mjd = startMjd + i;
    const record = simulatedEarthEopForMjd(mjd, seed);
    record.x_arcsec = clamp(record.x_arcsec * profile.eop_polar_motion_scale, -0.9, 0.9);
    record.y_arcsec = clamp(record.y_arcsec * profile.eop_polar_motion_scale, -0.9, 0.9);
    record.ut1_utc_sec = clamp(record.ut1_utc_sec * profile.eop_ut1_scale, -0.9, 0.9);
    record.lod_sec = clamp(record.lod_sec * profile.eop_lod_scale, -0.006, 0.006);
    records.push(record);
  }
  return {
    source: `simulated_earth_eop:${scenarioId}`,
    refreshed_at_utc: utcIso(nowMs),
    count: records.length,
    records,
    scenario: scenarioId,
  };
}
