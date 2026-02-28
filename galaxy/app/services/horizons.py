from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx


class HorizonsError(RuntimeError):
    pass


@dataclass(frozen=True)
class HorizonsVector:
    position_km: tuple[float, float, float]
    velocity_km_s: tuple[float, float, float]


class HorizonsClient:
    def __init__(
        self,
        base_url: str = "https://ssd.jpl.nasa.gov/api/horizons.api",
        timeout_seconds: float = 20.0,
        max_retries: int = 2,
        retry_backoff_seconds: float = 0.35,
        max_concurrency: int = 3,
    ) -> None:
        self._base_url = base_url
        self._timeout_seconds = timeout_seconds
        self._max_retries = max(0, int(max_retries))
        self._retry_backoff_seconds = max(0.05, float(retry_backoff_seconds))
        self._semaphore = asyncio.Semaphore(max(1, int(max_concurrency)))

    async def fetch_heliocentric_vector(self, command: str, at: datetime) -> HorizonsVector:
        return await self.fetch_vector(command=command, at=at, center="500@10")

    async def fetch_vector(
        self,
        command: str,
        at: datetime,
        center: str = "500@10",
    ) -> HorizonsVector:
        at_utc = at.astimezone(timezone.utc)
        stop_utc = at_utc + timedelta(seconds=1)
        start_time = at_utc.strftime("%Y-%m-%d %H:%M:%S")
        stop_time = stop_utc.strftime("%Y-%m-%d %H:%M:%S")
        params = {
            "format": "json",
            "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "VECTORS",
            "COMMAND": f"'{command}'",
            "CENTER": f"'{center}'",
            # Horizons expects calendar values with spaces to be quoted.
            "START_TIME": f"'{start_time}'",
            "STOP_TIME": f"'{stop_time}'",
            "STEP_SIZE": "'1 m'",
            "VEC_TABLE": "2",
            "OUT_UNITS": "KM-S",
            "CSV_FORMAT": "YES",
            "CAL_FORMAT": "CAL",
        }

        payload = await self._request_payload_with_retries(params)
        result_text = payload.get("result", "")
        if payload.get("error"):
            raise HorizonsError(str(payload["error"]))
        if not result_text:
            raise HorizonsError("Horizons response did not contain result text.")
        return self._extract_vector_from_result(result_text)

    async def _request_payload_with_retries(self, params: dict[str, str]) -> dict:
        retriable_status_codes = {429, 500, 502, 503, 504}
        attempt = 0
        last_error: Exception | None = None
        while attempt <= self._max_retries:
            try:
                async with self._semaphore:
                    async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
                        response = await client.get(
                            self._base_url,
                            params=params,
                            headers={"User-Agent": "galaxy-viewer/1.0"},
                        )
                    response.raise_for_status()
                    return response.json()
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code if exc.response is not None else None
                last_error = exc
                if status not in retriable_status_codes or attempt >= self._max_retries:
                    message = f"Horizons HTTP {status}" if status is not None else "Horizons HTTP error"
                    raise HorizonsError(message) from exc
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_error = exc
                if attempt >= self._max_retries:
                    raise HorizonsError("Horizons network timeout/transport error") from exc

            delay = self._retry_backoff_seconds * (2**attempt)
            await asyncio.sleep(delay)
            attempt += 1

        raise HorizonsError("Horizons request failed") from last_error

    @staticmethod
    def _extract_vector_from_result(result_text: str) -> HorizonsVector:
        soe_idx = result_text.find("$$SOE")
        eoe_idx = result_text.find("$$EOE")
        if soe_idx == -1 or eoe_idx == -1 or eoe_idx <= soe_idx:
            raise HorizonsError("Could not find ephemeris block in Horizons response.")

        block = result_text[soe_idx + len("$$SOE") : eoe_idx]
        rows = [line.strip() for line in block.splitlines() if line.strip()]
        if not rows:
            raise HorizonsError("Horizons response contained an empty ephemeris block.")

        parts = [segment.strip() for segment in rows[0].split(",")]
        if len(parts) < 5:
            raise HorizonsError("Unexpected Horizons vector row format.")

        numeric_values: list[float] = []
        for token in parts[2:]:
            try:
                numeric_values.append(float(token.replace("D", "E")))
            except ValueError:
                continue
            if len(numeric_values) == 6:
                break

        if len(numeric_values) < 3:
            raise HorizonsError("Failed to parse XYZ vector from Horizons row.")

        position_km = (numeric_values[0], numeric_values[1], numeric_values[2])
        if len(numeric_values) >= 6:
            velocity_km_s = (numeric_values[3], numeric_values[4], numeric_values[5])
        else:
            velocity_km_s = (0.0, 0.0, 0.0)
        return HorizonsVector(
            position_km=position_km,
            velocity_km_s=velocity_km_s,
        )
