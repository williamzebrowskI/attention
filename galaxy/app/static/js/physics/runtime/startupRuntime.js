export function createPhysicsStartupRuntime(options = {}) {
  const {
    getNBodyAllBodiesMode = () => true,
    parseTimestampMs = () => Date.now(),
    seedWorldStateFromSnapshot = () => null,
    launchRuntime = null,
    ephemerisRuntime = null,
    onWorldStateSeeded = () => {},
  } = options;

  function createCatalogEphemerisEntries(seedOptions = {}) {
    return ephemerisRuntime?.buildCatalogEntries?.(seedOptions) || new Map();
  }

  function mergeMissingEntries(entriesById, ephemerisEntriesById) {
    const target = entriesById instanceof Map ? entriesById : new Map();
    if (!(ephemerisEntriesById instanceof Map)) {
      return target;
    }
    for (const [bodyId, entry] of ephemerisEntriesById.entries()) {
      if (!target.has(bodyId)) {
        target.set(bodyId, entry);
      }
    }
    return target;
  }

  function normalizePayloadEntries(payload, fallbackNowMs = Date.now()) {
    const resolvedNowMs = Number.isFinite(Number(fallbackNowMs)) ? Number(fallbackNowMs) : Date.now();
    const parsedTimestampMs = parseTimestampMs(payload?.timestamp_utc);
    const timestampMs = Number.isFinite(Number(parsedTimestampMs))
      ? Number(parsedTimestampMs)
      : resolvedNowMs;
    const entries = Array.isArray(payload?.bodies) ? payload.bodies : [];
    const entriesById = new Map();
    for (const entry of entries) {
      const bodyId = String(entry?.id || "");
      if (!bodyId) {
        continue;
      }
      entriesById.set(bodyId, entry);
    }
    launchRuntime?.injectStartupEntry?.(entriesById, timestampMs);
    return {
      entriesById,
      timestampMs,
    };
  }

  function seedWorldFromEntries({
    bodies = [],
    entriesById = new Map(),
    bodyMassKgById = () => null,
    excludedIds = new Set(),
    staticSourceIds = new Set(),
    nowMs = Date.now(),
    momentumAnchorId = "sun",
    launchResetOptions = { clearFleetVehicles: true },
  } = {}) {
    if (!getNBodyAllBodiesMode()) {
      return null;
    }
    const worldState = seedWorldStateFromSnapshot({
      bodies,
      positionsById: entriesById,
      bodyMassKgById,
      excludedIds,
      staticSourceIds,
      nowMs,
      momentumAnchorId,
    });
    if (!worldState?.dynamicBodies?.size) {
      return null;
    }
    launchRuntime?.synchronizeManagedBodies?.(worldState, nowMs, launchResetOptions);
    onWorldStateSeeded(worldState);
    return worldState;
  }

  function applyStartupPayload(payload, optionsForSeed = {}) {
    const nowMs = Number.isFinite(Number(optionsForSeed?.nowMs))
      ? Number(optionsForSeed.nowMs)
      : Date.now();
    const normalized = normalizePayloadEntries(payload, nowMs);
    const ephemerisEntriesById = optionsForSeed?.ephemerisEntriesById instanceof Map
      ? optionsForSeed.ephemerisEntriesById
      : createCatalogEphemerisEntries(optionsForSeed);
    const entriesById = mergeMissingEntries(normalized.entriesById, ephemerisEntriesById);
    const worldState = seedWorldFromEntries({
      ...optionsForSeed,
      entriesById,
      nowMs,
    });
    return {
      entriesById,
      timestampMs: normalized.timestampMs,
      worldState,
    };
  }

  return {
    normalizePayloadEntries,
    createCatalogEphemerisEntries,
    seedWorldFromEntries,
    applyStartupPayload,
  };
}
