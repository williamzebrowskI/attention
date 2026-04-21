export function createPhysicsStartupRuntime(options = {}) {
  const {
    getNBodyAllBodiesMode = () => true,
    parseTimestampMs = () => Date.now(),
    seedWorldStateFromSnapshot = () => null,
    launchRuntime = null,
    onWorldStateSeeded = () => {},
  } = options;

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
    const worldState = seedWorldFromEntries({
      ...optionsForSeed,
      entriesById: normalized.entriesById,
      nowMs,
    });
    return {
      entriesById: normalized.entriesById,
      timestampMs: normalized.timestampMs,
      worldState,
    };
  }

  return {
    normalizePayloadEntries,
    seedWorldFromEntries,
    applyStartupPayload,
  };
}
