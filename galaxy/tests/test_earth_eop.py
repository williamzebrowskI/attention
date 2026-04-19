from __future__ import annotations

import json
import tempfile
import time
import unittest
from pathlib import Path

from app.services.earth_eop import EarthEopService, _unix_to_mjd


def build_sample_csv() -> str:
    mjd_today = int(_unix_to_mjd(time.time()))
    return (
        "DATE,MJD,X,Y,UT1-UTC,LOD,DATA_TYPE\n"
        f"2026-04-17,{mjd_today - 1},0.123456,0.234567,-0.0171234,0.0001234,O\n"
        f"2026-04-18,{mjd_today},0.123556,0.234667,-0.0172234,0.0002234,P\n"
    )


class EarthEopServiceTests(unittest.IsolatedAsyncioTestCase):
    def test_parse_celestrak_csv_extracts_records(self) -> None:
        service = EarthEopService(mode="hybrid", cache_path="")
        snapshot = service._parse_celestrak_csv(build_sample_csv())

        self.assertIsNotNone(snapshot)
        assert snapshot is not None
        self.assertEqual(snapshot.source, "celestrak_eop_csv")
        self.assertEqual(len(snapshot.records), 2)
        self.assertAlmostEqual(snapshot.records[0].x_arcsec, 0.123456)
        self.assertAlmostEqual(snapshot.records[1].ut1_utc_sec, -0.0172234)
        self.assertAlmostEqual(snapshot.records[1].lod_sec or 0.0, 0.0002234)
        self.assertEqual(snapshot.records[1].data_type, "P")

    async def test_hybrid_mode_prefers_cached_real_snapshot_when_fetch_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            cache_path = Path(tmpdir) / "earth_eop_snapshot.json"
            cached_payload = {
                "source": "celestrak_eop_csv",
                "refreshed_at_utc": "2026-04-18T00:00:00+00:00",
                "records": [
                    {
                        "mjd": 61146,
                        "x_arcsec": 0.222,
                        "y_arcsec": 0.333,
                        "ut1_utc_sec": -0.011,
                        "lod_sec": 0.00012,
                        "data_type": "O",
                        "time_utc": "2026-04-18T00:00:00+00:00",
                    }
                ],
            }
            cache_path.write_text(json.dumps(cached_payload), encoding="utf-8")

            service = EarthEopService(mode="hybrid", cache_path=cache_path)
            self.assertEqual(service.current_snapshot().source, "celestrak_eop_csv")

            async def fake_fetch() -> None:
                return None

            service._fetch_celestrak_snapshot = fake_fetch  # type: ignore[method-assign]

            snapshot = await service.get_snapshot(force_refresh=True)
            self.assertEqual(snapshot.source, "celestrak_eop_csv")
            self.assertEqual(len(snapshot.records), 1)
            self.assertAlmostEqual(snapshot.records[0].x_arcsec, 0.222)

    async def test_successful_fetch_persists_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            cache_path = Path(tmpdir) / "earth_eop_snapshot.json"
            service = EarthEopService(mode="live", cache_path=cache_path)
            fetched = service._parse_celestrak_csv(build_sample_csv())
            self.assertIsNotNone(fetched)
            assert fetched is not None

            async def fake_fetch():
                return fetched

            service._fetch_celestrak_snapshot = fake_fetch  # type: ignore[method-assign]

            snapshot = await service.get_snapshot(force_refresh=True)
            self.assertEqual(snapshot.source, "celestrak_eop_csv")
            self.assertTrue(cache_path.exists())

            cached_payload = json.loads(cache_path.read_text(encoding="utf-8"))
            self.assertEqual(cached_payload["source"], "celestrak_eop_csv")
            self.assertEqual(len(cached_payload["records"]), 2)


if __name__ == "__main__":
    unittest.main()
