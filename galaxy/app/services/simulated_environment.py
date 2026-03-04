from __future__ import annotations

import hashlib
import math
from datetime import datetime, timezone

from app.services.environment_forcing import normalize_environment_scenario


SECONDS_PER_DAY = 86_400.0
J2000_MJD = 51_544.5


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _datetime_to_mjd(value: datetime) -> float:
    unix_seconds = value.astimezone(timezone.utc).timestamp()
    return (unix_seconds / SECONDS_PER_DAY) + 40_587.0


def _mjd_to_datetime(mjd: float) -> datetime:
    unix_seconds = (float(mjd) - 40_587.0) * SECONDS_PER_DAY
    return datetime.fromtimestamp(unix_seconds, timezone.utc)


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _hash_unit(seed: str, index: int) -> float:
    key = f"{seed}:{index}".encode("utf-8")
    digest = hashlib.blake2b(key, digest_size=8).digest()
    unsigned = int.from_bytes(digest, "big")
    return unsigned / ((1 << 64) - 1)


def _hash_signed(seed: str, index: int) -> float:
    return (_hash_unit(seed, index) * 2.0) - 1.0


def _smoothstep(t: float) -> float:
    return t * t * (3.0 - (2.0 * t))


def _value_noise(x: float, scale: float, seed: str) -> float:
    s = max(1e-9, float(scale))
    coord = float(x) / s
    i0 = math.floor(coord)
    frac = coord - i0
    blend = _smoothstep(frac)
    n0 = _hash_signed(seed, int(i0))
    n1 = _hash_signed(seed, int(i0) + 1)
    return n0 + ((n1 - n0) * blend)


def _fractal_noise(x: float, seed: str, octaves: list[tuple[float, float]]) -> float:
    total = 0.0
    weight = 0.0
    for scale, amplitude in octaves:
        amp = float(amplitude)
        if not (amp > 0):
            continue
        total += amp * _value_noise(x, float(scale), f"{seed}:{scale}")
        weight += amp
    if weight <= 0:
        return 0.0
    return total / weight


def _simulated_space_weather_at_time(
    timestamp_utc: datetime,
    seed: str,
) -> tuple[float, float]:
    days = timestamp_utc.timestamp() / SECONDS_PER_DAY
    solar_cycle = math.sin((2 * math.pi * days / 4017.0) + 0.9)  # ~11-year cycle
    rotation_27d = math.sin((2 * math.pi * days / 27.2753) - 0.45)
    medium_noise = _fractal_noise(
        days,
        f"{seed}:kp-medium",
        [(20.0, 1.0), (7.5, 0.6), (2.5, 0.3)],
    )
    short_noise = _fractal_noise(
        days,
        f"{seed}:kp-short",
        [(4.0, 1.0), (1.5, 0.45)],
    )
    storm_driver = _value_noise(days, 5.0, f"{seed}:storm")
    storm = max(0.0, storm_driver - 0.36) ** 2 * 10.0

    kp = (
        2.2
        + (0.95 * solar_cycle)
        + (0.65 * rotation_27d)
        + (0.70 * medium_noise)
        + (0.35 * short_noise)
        + storm
    )
    kp = _clamp(kp, 0.0, 9.0)

    f107_noise = _fractal_noise(
        days,
        f"{seed}:f107",
        [(35.0, 1.0), (11.0, 0.5), (4.0, 0.2)],
    )
    f107 = (
        120.0
        + (42.0 * ((solar_cycle + 1.0) * 0.5))
        + (10.0 * rotation_27d)
        + (12.0 * f107_noise)
        + (20.0 * storm)
    )
    f107 = _clamp(f107, 60.0, 300.0)

    return (f107, kp)


def generate_simulated_space_weather_snapshot(
    *,
    now_utc: datetime | None = None,
    seed: str = "galaxy-space-weather-v1",
    scenario: str = "moderate",
) -> dict[str, object]:
    scenario_id = normalize_environment_scenario(scenario)
    if scenario_id == "quiet":
        kp_bias = -0.7
        kp_scale = 0.60
        storm_gain = 0.18
        f107_bias = -18.0
        f107_scale = 0.80
    elif scenario_id == "storm":
        kp_bias = 1.2
        kp_scale = 1.35
        storm_gain = 2.1
        f107_bias = 18.0
        f107_scale = 1.22
    elif scenario_id == "extreme":
        kp_bias = 2.4
        kp_scale = 1.80
        storm_gain = 3.5
        f107_bias = 40.0
        f107_scale = 1.55
    else:
        kp_bias = 0.0
        kp_scale = 1.0
        storm_gain = 1.0
        f107_bias = 0.0
        f107_scale = 1.0

    now = (now_utc or _utc_now()).astimezone(timezone.utc)
    cadence_hours = 3
    cadence_seconds = cadence_hours * 3600
    bucket_unix = int(now.timestamp() // cadence_seconds) * cadence_seconds
    bucket_time = datetime.fromtimestamp(bucket_unix, timezone.utc)
    f107_base, kp_base = _simulated_space_weather_at_time(bucket_time, seed)
    kp_storm_component = max(0.0, kp_base - 4.0) * max(0.0, storm_gain - 1.0)
    kp = _clamp((kp_base * kp_scale) + kp_bias + (0.55 * kp_storm_component), 0.0, 9.0)
    f107 = _clamp((f107_base * f107_scale) + f107_bias, 60.0, 300.0)

    history = []
    for idx in range(8):
        t = datetime.fromtimestamp(bucket_unix - (idx * cadence_seconds), timezone.utc)
        _, h_kp_base = _simulated_space_weather_at_time(t, seed)
        h_kp_storm_component = max(0.0, h_kp_base - 4.0) * max(0.0, storm_gain - 1.0)
        h_kp = _clamp((h_kp_base * kp_scale) + kp_bias + (0.55 * h_kp_storm_component), 0.0, 9.0)
        history.append(
            {
                "time_utc": _utc_iso(t),
                "kp": _clamp(h_kp, 0.0, 9.0),
            }
        )

    return {
        "f107_sfu": _clamp(f107, 60.0, 300.0),
        "kp_index": _clamp(kp, 0.0, 9.0),
        "source": f"simulated_space_weather:{scenario_id}",
        "refreshed_at_utc": _utc_iso(now),
        "kp_time_utc": _utc_iso(bucket_time),
        "f107_time_utc": _utc_iso(bucket_time),
        "kp_history": history,
        "scenario": scenario_id,
    }


def _simulated_eop_for_mjd(mjd: float, seed: str) -> dict[str, float | str]:
    days_from_j2000 = float(mjd) - J2000_MJD
    annual = (2 * math.pi * days_from_j2000) / 365.2422
    semiannual = (2 * math.pi * days_from_j2000) / 182.6211
    chandler = (2 * math.pi * days_from_j2000) / 433.1
    fortnight = (2 * math.pi * days_from_j2000) / 13.6608
    lunar_month = (2 * math.pi * days_from_j2000) / 27.3217

    x_noise = _fractal_noise(
        days_from_j2000,
        f"{seed}:xp",
        [(120.0, 1.0), (40.0, 0.55), (12.0, 0.2)],
    )
    y_noise = _fractal_noise(
        days_from_j2000,
        f"{seed}:yp",
        [(120.0, 1.0), (40.0, 0.55), (12.0, 0.2)],
    )
    ut1_noise = _fractal_noise(
        days_from_j2000,
        f"{seed}:ut1",
        [(220.0, 1.0), (70.0, 0.5), (24.0, 0.2)],
    )
    lod_noise = _fractal_noise(
        days_from_j2000,
        f"{seed}:lod",
        [(30.0, 1.0), (10.0, 0.6), (3.0, 0.25)],
    )

    x_arcsec = (
        (0.125 * math.sin(chandler + 0.38))
        + (0.052 * math.sin(annual - 1.15))
        + (0.018 * math.sin(semiannual + 0.71))
        + (0.012 * x_noise)
    )
    y_arcsec = (
        (0.123 * math.cos(chandler + 0.24))
        + (0.049 * math.cos(annual - 0.74))
        + (0.017 * math.sin(semiannual - 0.29))
        + (0.012 * y_noise)
    )
    x_arcsec = _clamp(x_arcsec, -0.55, 0.55)
    y_arcsec = _clamp(y_arcsec, -0.55, 0.55)

    lod_sec = (
        (0.00055 * math.sin(fortnight + 0.27))
        + (0.00022 * math.sin(annual - 0.42))
        + (0.00011 * math.sin(lunar_month + 0.93))
        + (0.00012 * lod_noise)
    )
    lod_sec = _clamp(lod_sec, -0.003, 0.003)

    ut1_utc_sec = (
        (0.19 * math.sin(annual + 0.61))
        + (0.09 * math.sin(lunar_month - 0.44))
        + (0.045 * ut1_noise)
        + (7.2 * lod_sec)
    )
    ut1_utc_sec = _clamp(ut1_utc_sec, -0.9, 0.9)

    return {
        "mjd": float(mjd),
        "x_arcsec": float(x_arcsec),
        "y_arcsec": float(y_arcsec),
        "ut1_utc_sec": float(ut1_utc_sec),
        "lod_sec": float(lod_sec),
        "data_type": "P",
        "time_utc": _utc_iso(_mjd_to_datetime(mjd)),
    }


def generate_simulated_earth_eop_snapshot(
    *,
    now_utc: datetime | None = None,
    seed: str = "galaxy-earth-eop-v1",
    max_records: int = 2200,
    scenario: str = "moderate",
) -> dict[str, object]:
    scenario_id = normalize_environment_scenario(scenario)
    if scenario_id == "quiet":
        polar_motion_scale = 0.80
        ut1_scale = 0.85
        lod_scale = 0.75
    elif scenario_id == "storm":
        polar_motion_scale = 1.20
        ut1_scale = 1.10
        lod_scale = 1.18
    elif scenario_id == "extreme":
        polar_motion_scale = 1.35
        ut1_scale = 1.28
        lod_scale = 1.32
    else:
        polar_motion_scale = 1.0
        ut1_scale = 1.0
        lod_scale = 1.0

    now = (now_utc or _utc_now()).astimezone(timezone.utc)
    now_mjd = _datetime_to_mjd(now)
    record_count = max(100, int(max_records))
    future_days = max(14, min(90, int(record_count * 0.03)))
    past_days = record_count - future_days
    start_mjd = math.floor(now_mjd) - past_days + 1

    records = []
    for i in range(record_count):
        mjd = start_mjd + i
        record = _simulated_eop_for_mjd(mjd, seed)
        record["x_arcsec"] = float(_clamp(float(record["x_arcsec"]) * polar_motion_scale, -0.9, 0.9))
        record["y_arcsec"] = float(_clamp(float(record["y_arcsec"]) * polar_motion_scale, -0.9, 0.9))
        record["ut1_utc_sec"] = float(_clamp(float(record["ut1_utc_sec"]) * ut1_scale, -0.9, 0.9))
        record["lod_sec"] = float(_clamp(float(record["lod_sec"]) * lod_scale, -0.006, 0.006))
        records.append(record)

    return {
        "source": f"simulated_earth_eop:{scenario_id}",
        "refreshed_at_utc": _utc_iso(now),
        "count": len(records),
        "records": records,
        "scenario": scenario_id,
    }
