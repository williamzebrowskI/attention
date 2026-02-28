from __future__ import annotations

from dataclasses import replace
import unittest

from app.services.catalog import BODY_DEFINITIONS
from app.services.physics_lock import PhysicsLockError, catalog_lock_hash, validate_catalog_lock


class PhysicsLockTests(unittest.TestCase):
    def test_catalog_lock_accepts_current_baseline(self) -> None:
        validate_catalog_lock()

    def test_catalog_lock_rejects_tampered_body_constant(self) -> None:
        tampered = list(BODY_DEFINITIONS)
        earth = next(body for body in tampered if body.id == "earth")
        tampered[tampered.index(earth)] = replace(earth, radius_km=earth.radius_km + 1.0)

        with self.assertRaises(PhysicsLockError):
            validate_catalog_lock(tampered)

    def test_catalog_hash_is_stable_for_same_input(self) -> None:
        first = catalog_lock_hash(BODY_DEFINITIONS)
        second = catalog_lock_hash(BODY_DEFINITIONS)
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()

