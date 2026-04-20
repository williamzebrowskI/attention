from __future__ import annotations

from types import SimpleNamespace
import unittest

from app.services.launch_weather import (
    LaunchWeatherService,
    _direction_deg_from_string,
    _wind_speed_m_s_from_string,
)


class LaunchWeatherServiceTests(unittest.IsolatedAsyncioTestCase):
    def test_parse_wind_helpers(self) -> None:
        self.assertAlmostEqual(_direction_deg_from_string("SW") or 0.0, 225.0)
        self.assertAlmostEqual(_direction_deg_from_string("270") or 0.0, 270.0)
        self.assertAlmostEqual(_wind_speed_m_s_from_string("10 mph") or 0.0, 4.4704, places=4)
        self.assertAlmostEqual(_wind_speed_m_s_from_string("10 to 15 mph") or 0.0, 5.588, places=3)
        self.assertAlmostEqual(_wind_speed_m_s_from_string("20 kt") or 0.0, 10.28888, places=4)

    def test_parse_weather_gov_period(self) -> None:
        service = LaunchWeatherService(mode="hybrid")
        record = service._record_from_weather_gov_period(
            {
                "startTime": "2026-04-19T18:00:00-04:00",
                "temperature": 81,
                "temperatureUnit": "F",
                "relativeHumidity": {"value": 68},
                "windSpeed": "10 to 15 mph",
                "windDirection": "SW",
                "shortForecast": "Partly Sunny",
            },
            28.5618571,
            -80.577366,
            "Cape Canaveral",
        )
        self.assertIsNotNone(record)
        assert record is not None
        self.assertEqual(record.source, "weather_gov_hourly")
        self.assertAlmostEqual(record.temperature_c or 0.0, 27.2222, places=3)
        self.assertAlmostEqual(record.relative_humidity or 0.0, 0.68, places=4)
        self.assertAlmostEqual(record.wind_speed_m_s or 0.0, 5.588, places=3)
        self.assertAlmostEqual(record.wind_direction_deg or 0.0, 225.0, places=3)

    async def test_hybrid_mode_uses_simulated_fallback_when_fetch_fails(self) -> None:
        site = SimpleNamespace(
            name="Cape Canaveral",
            latitude_deg=28.5618571,
            longitude_deg=-80.577366,
        )
        service = LaunchWeatherService(
            mode="hybrid",
            launch_site_provider=lambda: site,
            forcing_context_provider=lambda: {"scenario": "moderate"},
        )

        async def fake_fetch(_site: dict[str, object]):
            return None

        service._fetch_weather_gov_record = fake_fetch  # type: ignore[method-assign]

        snapshot = await service.get_snapshot(force_refresh=True)
        self.assertTrue(snapshot.source.startswith("simulated_launch_weather:"))
        self.assertAlmostEqual(snapshot.latitude_deg, site.latitude_deg)
        self.assertAlmostEqual(snapshot.longitude_deg, site.longitude_deg)
        self.assertIsNotNone(snapshot.wind_speed_m_s)


if __name__ == "__main__":
    unittest.main()
