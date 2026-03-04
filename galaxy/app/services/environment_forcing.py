from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_environment_scenario(value: str | None) -> str:
    scenario = str(value or "").strip().lower()
    if scenario in {"quiet", "moderate", "storm", "extreme"}:
        return scenario
    return "moderate"


@dataclass(frozen=True)
class EnvironmentScenarioProfile:
    id: str
    label: str
    description: str
    space_weather_kp_bias: float
    space_weather_kp_scale: float
    space_weather_storm_gain: float
    space_weather_f107_bias: float
    space_weather_f107_scale: float
    eop_polar_motion_scale: float
    eop_ut1_scale: float
    eop_lod_scale: float

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "label": self.label,
            "description": self.description,
            "space_weather_kp_bias": self.space_weather_kp_bias,
            "space_weather_kp_scale": self.space_weather_kp_scale,
            "space_weather_storm_gain": self.space_weather_storm_gain,
            "space_weather_f107_bias": self.space_weather_f107_bias,
            "space_weather_f107_scale": self.space_weather_f107_scale,
            "eop_polar_motion_scale": self.eop_polar_motion_scale,
            "eop_ut1_scale": self.eop_ut1_scale,
            "eop_lod_scale": self.eop_lod_scale,
        }


SCENARIO_PROFILES: dict[str, EnvironmentScenarioProfile] = {
    "quiet": EnvironmentScenarioProfile(
        id="quiet",
        label="Quiet",
        description="Calm geospace and low perturbation variance.",
        space_weather_kp_bias=-0.7,
        space_weather_kp_scale=0.60,
        space_weather_storm_gain=0.18,
        space_weather_f107_bias=-18.0,
        space_weather_f107_scale=0.80,
        eop_polar_motion_scale=0.80,
        eop_ut1_scale=0.85,
        eop_lod_scale=0.75,
    ),
    "moderate": EnvironmentScenarioProfile(
        id="moderate",
        label="Moderate",
        description="Nominal day-to-day forcing around realistic averages.",
        space_weather_kp_bias=0.0,
        space_weather_kp_scale=1.0,
        space_weather_storm_gain=1.0,
        space_weather_f107_bias=0.0,
        space_weather_f107_scale=1.0,
        eop_polar_motion_scale=1.0,
        eop_ut1_scale=1.0,
        eop_lod_scale=1.0,
    ),
    "storm": EnvironmentScenarioProfile(
        id="storm",
        label="Storm",
        description="Elevated geomagnetic activity with larger forcing swings.",
        space_weather_kp_bias=1.2,
        space_weather_kp_scale=1.35,
        space_weather_storm_gain=2.1,
        space_weather_f107_bias=18.0,
        space_weather_f107_scale=1.22,
        eop_polar_motion_scale=1.20,
        eop_ut1_scale=1.10,
        eop_lod_scale=1.18,
    ),
    "extreme": EnvironmentScenarioProfile(
        id="extreme",
        label="Extreme",
        description="Stress-test forcing with high-variance space-weather and EOP dynamics.",
        space_weather_kp_bias=2.4,
        space_weather_kp_scale=1.80,
        space_weather_storm_gain=3.5,
        space_weather_f107_bias=40.0,
        space_weather_f107_scale=1.55,
        eop_polar_motion_scale=1.35,
        eop_ut1_scale=1.28,
        eop_lod_scale=1.32,
    ),
}


class EnvironmentForcingService:
    def __init__(self, default_scenario: str | None = None) -> None:
        env_default = os.getenv("ENVIRONMENT_SCENARIO")
        scenario = normalize_environment_scenario(default_scenario or env_default or "moderate")
        self._scenario = scenario
        self._updated_at_utc = _utc_now_iso()

    def get_scenario(self) -> str:
        return self._scenario

    def get_profile(self, scenario: str | None = None) -> EnvironmentScenarioProfile:
        key = normalize_environment_scenario(scenario or self._scenario)
        return SCENARIO_PROFILES[key]

    def current_context(self) -> dict[str, object]:
        profile = self.get_profile()
        return {
            "scenario": self._scenario,
            "updated_at_utc": self._updated_at_utc,
            "profile": profile.to_dict(),
        }

    def set_scenario(self, scenario: str) -> dict[str, object]:
        key = normalize_environment_scenario(scenario)
        self._scenario = key
        self._updated_at_utc = _utc_now_iso()
        return self.current_context()

    def snapshot(self) -> dict[str, object]:
        current = self.current_context()
        return {
            "scenario": current["scenario"],
            "updated_at_utc": current["updated_at_utc"],
            "profile": current["profile"],
            "available_scenarios": [profile.to_dict() for profile in SCENARIO_PROFILES.values()],
        }

