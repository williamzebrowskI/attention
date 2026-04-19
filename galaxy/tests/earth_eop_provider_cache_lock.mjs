import assert from "node:assert/strict";

import { createEarthEopProvider } from "../app/static/js/physics/dynamics/earthEopProvider.js";

class MemoryStorage {
  constructor(entries = {}) {
    this.map = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }
}

function makeSnapshotPayload(source = "celestrak_eop_csv") {
  return {
    source,
    refreshedAtUtc: "2026-04-18T09:15:00Z",
    records: [
      {
        mjd: 61147,
        x_arcsec: 0.101,
        y_arcsec: 0.214,
        ut1_utc_sec: 0.043,
        lod_sec: 0.00012,
      },
      {
        mjd: 61148,
        x_arcsec: 0.108,
        y_arcsec: 0.221,
        ut1_utc_sec: 0.039,
        lod_sec: 0.00011,
      },
    ],
  };
}

async function main() {
  const storageKey = "earth-eop-test-cache";
  const cachedStorage = new MemoryStorage({
    [storageKey]: JSON.stringify(makeSnapshotPayload()),
  });

  const cachedProvider = createEarthEopProvider({
    storage: cachedStorage,
    storageKey,
    refreshIntervalMs: 60_000,
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });

  const hydrated = cachedProvider.sampleOrientation(Date.UTC(2026, 3, 18, 12, 0, 0));
  assert(hydrated, "expected provider to hydrate orientation from cached snapshot");
  assert(String(hydrated.source).includes("celestrak_eop_csv"), `unexpected hydrated source ${hydrated.source}`);

  await cachedProvider.refresh();
  const afterFailedRefresh = cachedProvider.sampleOrientation(Date.UTC(2026, 3, 18, 18, 0, 0));
  assert(afterFailedRefresh, "expected cached orientation to survive refresh failure");
  cachedProvider.stop();

  const freshStorage = new MemoryStorage();
  const persistedProvider = createEarthEopProvider({
    storage: freshStorage,
    storageKey,
    refreshIntervalMs: 60_000,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return makeSnapshotPayload("celestrak_eop_csv");
      },
    }),
  });
  await persistedProvider.refresh();
  persistedProvider.stop();

  const persistedRaw = freshStorage.getItem(storageKey);
  assert(persistedRaw, "expected real EOP refresh to persist browser cache");
  const persistedPayload = JSON.parse(persistedRaw);
  assert.equal(persistedPayload.source, "celestrak_eop_csv");
  assert(Array.isArray(persistedPayload.records) && persistedPayload.records.length === 2, "expected persisted records");

  const simulatedStorage = new MemoryStorage();
  const simulatedProvider = createEarthEopProvider({
    storage: simulatedStorage,
    storageKey,
    refreshIntervalMs: 60_000,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return makeSnapshotPayload("simulated_earth_eop:moderate");
      },
    }),
  });
  await simulatedProvider.refresh();
  simulatedProvider.stop();

  assert.equal(simulatedStorage.getItem(storageKey), null, "simulated EOP snapshot should not overwrite browser cache");
  console.log("earth-eop-provider-cache-lock: ok");
}

await main();
