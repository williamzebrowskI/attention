from __future__ import annotations

import hashlib
import json
from typing import Iterable

from app.services.catalog import BODY_DEFINITIONS, BodyDefinition

# Fail fast if critical physical constants drift from the locked baseline.
PHYSICS_LOCK_ENFORCED = True
LOCKED_CATALOG_BODY_COUNT = 40
LOCKED_CATALOG_SHA256 = "cbfe071da782433394d52d0279093609bc169b0088f09d17c46d29e8a9478a58"


class PhysicsLockError(RuntimeError):
    pass


def _catalog_record(body: BodyDefinition) -> dict[str, object]:
    return {
        "id": body.id,
        "name": body.name,
        "command": body.command,
        "body_type": body.body_type,
        "parent": body.parent,
        "radius_km": body.radius_km,
        "mass_kg": body.mass_kg,
        "orbital_period_days": body.orbital_period_days,
        "semimajor_axis_km": body.semimajor_axis_km,
        "color": body.color,
        "description": body.description,
        "phase": body.phase,
    }


def catalog_lock_hash(bodies: Iterable[BodyDefinition] | None = None) -> str:
    items = list(bodies) if bodies is not None else list(BODY_DEFINITIONS)
    records = [_catalog_record(body) for body in items]
    records.sort(key=lambda record: str(record["id"]))
    payload = json.dumps(records, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def validate_catalog_lock(bodies: Iterable[BodyDefinition] | None = None) -> None:
    if not PHYSICS_LOCK_ENFORCED:
        return

    items = list(bodies) if bodies is not None else list(BODY_DEFINITIONS)
    if len(items) != LOCKED_CATALOG_BODY_COUNT:
        raise PhysicsLockError(
            f"Catalog lock failed: expected {LOCKED_CATALOG_BODY_COUNT} bodies, got {len(items)}."
        )

    current_hash = catalog_lock_hash(items)
    if current_hash != LOCKED_CATALOG_SHA256:
        raise PhysicsLockError(
            "Catalog lock failed: physical body constants changed from locked baseline."
        )
