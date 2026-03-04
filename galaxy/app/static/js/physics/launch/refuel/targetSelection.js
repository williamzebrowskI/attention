function numeric(value, fallback = Number.NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function candidateScore(candidate) {
  const weighted = numeric(candidate?.candidateScore);
  if (Number.isFinite(weighted)) {
    return weighted;
  }
  const intercept = numeric(candidate?.interceptScore);
  if (Number.isFinite(intercept)) {
    return intercept;
  }
  const distance = numeric(candidate?.distanceKm);
  if (Number.isFinite(distance)) {
    return distance;
  }
  return Number.POSITIVE_INFINITY;
}

function sortCandidatesByScore(candidates = []) {
  const list = Array.isArray(candidates) ? [...candidates] : [];
  list.sort((a, b) => candidateScore(a) - candidateScore(b));
  return list;
}

function normalizeOptions(options = {}) {
  return {
    minHoldSec: Math.max(0, numeric(options.minHoldSec, 120)),
    switchGainFraction: Math.max(0, numeric(options.switchGainFraction, 0.2)),
    lockDistanceFactor: Math.max(1, numeric(options.lockDistanceFactor, 1.5)),
    lockDistanceMarginKm: Math.max(0, numeric(options.lockDistanceMarginKm, 800)),
    separatingClosingThresholdKmS: numeric(options.separatingClosingThresholdKmS, -0.008),
    separatingImprovementKmS: Math.max(0, numeric(options.separatingImprovementKmS, 0.006)),
    avoidBehindTargets: Boolean(options.avoidBehindTargets),
    allowRecoverableBehindTargets: options.allowRecoverableBehindTargets !== false,
    behindDotThreshold: numeric(options.behindDotThreshold, -0.05),
    behindRecoverableMinClosingKmS: Math.max(0, numeric(options.behindRecoverableMinClosingKmS, 0.0025)),
    behindRecoverableMaxRelativeSpeedKmS: Math.max(0, numeric(options.behindRecoverableMaxRelativeSpeedKmS, 0.12)),
    behindRecoverableMaxDistanceKm: Math.max(0, numeric(options.behindRecoverableMaxDistanceKm, 1400)),
    stickToLockUntilInvalid: Boolean(options.stickToLockUntilInvalid),
  };
}

function isBehindCandidate(candidate, cfg) {
  const aheadDot = numeric(candidate?.aheadDot, Number.NaN);
  return Number.isFinite(aheadDot) && aheadDot <= cfg.behindDotThreshold;
}

function isRecoverableBehindCandidate(candidate, cfg) {
  if (typeof candidate?.behindRecoverable === "boolean") {
    return candidate.behindRecoverable;
  }
  const closingKmS = numeric(candidate?.closingSpeedKmS, Number.NaN);
  const relativeSpeedKmS = numeric(candidate?.relativeSpeedKmS, Number.NaN);
  const distanceKm = numeric(candidate?.distanceKm, Number.NaN);
  const closingOk = Number.isFinite(closingKmS) && closingKmS >= cfg.behindRecoverableMinClosingKmS;
  const relativeSpeedOk = !Number.isFinite(relativeSpeedKmS)
    || relativeSpeedKmS <= cfg.behindRecoverableMaxRelativeSpeedKmS;
  const distanceOk = !Number.isFinite(distanceKm)
    || distanceKm <= cfg.behindRecoverableMaxDistanceKm;
  return closingOk && relativeSpeedOk && distanceOk;
}

export function selectStickyTarget({
  candidates = [],
  lockId = "",
  lockAcquiredSec = 0,
  nowSec = 0,
  options = {},
} = {}) {
  const cfg = normalizeOptions(options);
  const sorted = sortCandidatesByScore(candidates);
  const selectable = cfg.avoidBehindTargets
    ? (() => {
      const filtered = sorted.filter((candidate) => {
        if (!isBehindCandidate(candidate, cfg)) {
          return true;
        }
        return cfg.allowRecoverableBehindTargets
          && isRecoverableBehindCandidate(candidate, cfg);
      });
      return filtered.length > 0 ? filtered : sorted;
    })()
    : sorted;
  const best = selectable.length > 0 ? selectable[0] : null;
  if (!best) {
    return {
      selected: null,
      nextLockId: "",
      nextLockAcquiredSec: 0,
      switched: false,
      reason: "no-candidates",
    };
  }

  const normalizedLockId = String(lockId || "").trim();
  const safeNowSec = Math.max(0, numeric(nowSec, 0));
  if (!normalizedLockId) {
    return {
      selected: best,
      nextLockId: String(best?.tankerId || ""),
      nextLockAcquiredSec: safeNowSec,
      switched: false,
      reason: "acquire-initial-lock",
    };
  }

  const lockedInSorted = sorted.find((candidate) => String(candidate?.tankerId || "") === normalizedLockId) || null;
  if (cfg.stickToLockUntilInvalid && lockedInSorted) {
    const stableLockAcquiredSec = numeric(lockAcquiredSec, 0) > 0
      ? Math.max(0, numeric(lockAcquiredSec, 0))
      : safeNowSec;
    return {
      selected: lockedInSorted,
      nextLockId: normalizedLockId,
      nextLockAcquiredSec: stableLockAcquiredSec,
      switched: false,
      reason: "lock-pinned",
    };
  }

  const locked = selectable.find((candidate) => String(candidate?.tankerId || "") === normalizedLockId) || null;
  if (!locked) {
    const lockExistsInCandidates = Boolean(lockedInSorted);
    return {
      selected: best,
      nextLockId: String(best?.tankerId || ""),
      nextLockAcquiredSec: safeNowSec,
      switched: true,
      reason: lockExistsInCandidates ? "lock-target-filtered" : "lock-target-missing",
    };
  }

  if (String(locked?.tankerId || "") === String(best?.tankerId || "")) {
    const stableLockAcquiredSec = numeric(lockAcquiredSec, 0) > 0
      ? Math.max(0, numeric(lockAcquiredSec, 0))
      : safeNowSec;
    return {
      selected: locked,
      nextLockId: normalizedLockId,
      nextLockAcquiredSec: stableLockAcquiredSec,
      switched: false,
      reason: "lock-still-best",
    };
  }

  const heldForSec = Math.max(0, safeNowSec - Math.max(0, numeric(lockAcquiredSec, 0)));
  const lockScore = candidateScore(locked);
  const bestScore = candidateScore(best);
  const gain = Number.isFinite(lockScore) && Number.isFinite(bestScore)
    ? (lockScore - bestScore)
    : 0;
  const gainFraction = gain / Math.max(Math.abs(lockScore), 1e-6);
  const bestClearlyBetter = gainFraction > cfg.switchGainFraction;

  const lockDistanceKm = numeric(locked?.distanceKm, Number.POSITIVE_INFINITY);
  const bestDistanceKm = numeric(best?.distanceKm, Number.POSITIVE_INFINITY);
  const lockDriftingAway = Number.isFinite(lockDistanceKm) && Number.isFinite(bestDistanceKm)
    && lockDistanceKm > Math.max(
      bestDistanceKm * cfg.lockDistanceFactor,
      bestDistanceKm + cfg.lockDistanceMarginKm,
    );

  const lockClosingKmS = numeric(locked?.closingSpeedKmS, Number.NaN);
  const bestClosingKmS = numeric(best?.closingSpeedKmS, Number.NaN);
  const lockSeparating = Number.isFinite(lockClosingKmS)
    && Number.isFinite(bestClosingKmS)
    && lockClosingKmS < cfg.separatingClosingThresholdKmS
    && bestClosingKmS > (lockClosingKmS + cfg.separatingImprovementKmS);

  const forceSwitch = lockDriftingAway || lockSeparating;
  if (!forceSwitch && (heldForSec < cfg.minHoldSec || !bestClearlyBetter)) {
    return {
      selected: locked,
      nextLockId: normalizedLockId,
      nextLockAcquiredSec: Math.max(0, numeric(lockAcquiredSec, 0)),
      switched: false,
      reason: heldForSec < cfg.minHoldSec ? "hold-window-active" : "insufficient-gain",
    };
  }

  return {
    selected: best,
    nextLockId: String(best?.tankerId || ""),
    nextLockAcquiredSec: safeNowSec,
    switched: true,
    reason: forceSwitch ? "forced-switch" : "better-target",
  };
}
