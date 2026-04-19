import {
  resolveSnapshotTargetTelemetry,
  shouldShowTerrainRelativeAltitude,
} from "./launchTelemetryDisplay.js";
import { displayMissionPhase } from "../physics/navigation_system/navigationMissionProfiles.js";

function fallbackEscapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toLaunchTitle(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function humanizeMissionPhase(phase) {
  const key = String(phase || "").trim().toLowerCase();
  const map = {
    launch: "Launch",
    launch_to_parking: "Launch To Parking Orbit",
    parking_orbit: "Parking Orbit",
    departure_window_wait: "Departure Window Wait",
    orbital_refuel: "Orbital Refueling",
    tli_burn: "Trans-Lunar Injection Burn",
    midcourse: "Midcourse",
    coast_to_moon: "Midcourse",
    lunar_orbit_insertion: "Lunar Orbit Insertion",
    lunar_insertion: "Lunar Orbit Insertion",
    lunar_capture: "Lunar Orbit Insertion",
    lunar_orbit_trim: "Lunar Orbit Trim",
    lunar_loiter: "Lunar Loiter",
    lunar_orbit_hold: "Lunar Loiter",
    tei_burn: "Trans-Earth Injection Burn",
    earth_approach: "Earth Approach",
    coast_to_earth: "Earth Approach",
    earth_capture: "Earth Capture Burn",
    earth_orbit_hold: "Earth Orbit Hold",
  };
  return map[key] || toLaunchTitle(key || "unknown");
}

function humanizeLaunchEventName(name) {
  const key = String(name || "").trim().toLowerCase();
  const map = {
    launch_started: "Liftoff Command",
    launch_vehicle_reset_to_pad: "Vehicle Reset To Pad",
    starship_stage_changed: "Starship Stage Change",
    stage_separation_booster_detached: "Booster Separation",
    hotstage_ignition: "Hot-Stage Ignition",
    hotstage_detach: "Hot-Stage Detach",
    mission_phase_changed: "Mission Phase Change",
    mission_completed: "Mission Complete",
    booster_phase_changed: "Booster Phase Change",
    booster_landed: "Booster Landed",
    mission_profile_selected: "Mission Profile Selected",
    fleet_mission_ship_launched: "Fleet Mission Ship Launched",
    fleet_mission_phase_changed: "Fleet Mission Phase Change",
    refuel_tanker_launched: "Refuel Tanker Launched",
    refuel_tanker_pad_launch_started: "Refuel Tanker Pad Launch Started",
    refuel_tanker_pad_launch_completed: "Refuel Tanker Pad Launch Completed",
    refuel_transfer_completed: "Refuel Transfer Complete",
    refuel_transfer_skipped: "Refuel Transfer Skipped",
    guidance_decision_changed: "Guidance Decision Change",
    guidance_target_changed: "Guidance Target Change",
    guidance_burn_state_changed: "Guidance Burn State Change",
    fleet_guidance_decision_changed: "Fleet Guidance Decision Change",
    fleet_guidance_target_changed: "Fleet Guidance Target Change",
    fleet_guidance_burn_state_changed: "Fleet Guidance Burn State Change",
  };
  return map[key] || toLaunchTitle(key || "event");
}

function hasLaunchEvent(entries, eventName) {
  const target = String(eventName || "").trim().toLowerCase();
  if (!target) {
    return false;
  }
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const current = String(entries[i]?.name || "").trim().toLowerCase();
    if (current === target) {
      return true;
    }
  }
  return false;
}

function isPrimaryLaunchStackBodyId(bodyId) {
  const id = String(bodyId || "").trim();
  return id === "earth_launch_vehicle" || id === "earth_launch_booster";
}

function collectLaunchEventActorIds(entry) {
  const ids = new Set();
  if (!entry || typeof entry !== "object") {
    return ids;
  }
  const candidateKeys = [
    "bodyId",
    "shipId",
    "tankerId",
    "vehicleId",
    "boosterBodyId",
    "trackedBodyId",
    "transferTankerId",
  ];
  for (let i = 0; i < candidateKeys.length; i += 1) {
    const key = candidateKeys[i];
    const id = String(entry[key] || "").trim();
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

function eventRelevantToSnapshot(entry, snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return true;
  }
  const trackedBodyId = String(snapshot.bodyId || "").trim();
  const trackedMissionId = String(snapshot.missionId || "").trim();
  const actorIds = collectLaunchEventActorIds(entry);
  if (trackedBodyId) {
    if (actorIds.has(trackedBodyId)) {
      return true;
    }
    if (isPrimaryLaunchStackBodyId(trackedBodyId)) {
      if (actorIds.size <= 0) {
        return true;
      }
      if (actorIds.has("earth_launch_vehicle") || actorIds.has("earth_launch_booster")) {
        return true;
      }
    }
    return false;
  }
  if (trackedMissionId) {
    const eventMissionId = String(entry?.missionId || "").trim();
    return Boolean(eventMissionId && eventMissionId === trackedMissionId);
  }
  return true;
}

function filterMissionControlEvents(entries, snapshot) {
  const list = Array.isArray(entries) ? entries : [];
  if (!snapshot || typeof snapshot !== "object") {
    return list;
  }
  const filtered = [];
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    if (eventRelevantToSnapshot(entry, snapshot)) {
      filtered.push(entry);
    }
  }
  return filtered;
}

export function createMissionControlScreenController(options = {}) {
  const documentRef = options.documentRef || document;
  const launchMissionControlButton = options.launchMissionControlButton || null;
  const missionControlScreenNode = options.missionControlScreenNode || null;
  const missionControlBackButton = options.missionControlBackButton || null;
  const missionControlSubtitleNode = options.missionControlSubtitleNode || null;
  const missionControlHeaderStatusNode = options.missionControlHeaderStatusNode
    || missionControlScreenNode?.querySelector?.("#mission-control-header-status")
    || null;
  const missionControlCommandStripNode = options.missionControlCommandStripNode
    || missionControlScreenNode?.querySelector?.("#mission-control-command-strip")
    || null;
  const missionControlOpsAlertsNode = options.missionControlOpsAlertsNode
    || missionControlScreenNode?.querySelector?.("#mission-control-ops-alerts")
    || null;
  const missionControlMissionPickerNode = options.missionControlMissionPickerNode
    || missionControlScreenNode?.querySelector?.("#mission-control-mission-picker")
    || null;
  const missionControlOverviewNode = options.missionControlOverviewNode || null;
  const missionControlSequenceNode = options.missionControlSequenceNode || null;
  const missionControlEventsNode = options.missionControlEventsNode || null;
  const missionControlViewStatusNode = options.missionControlViewStatusNode || null;
  const missionControlSubsystemsNode = options.missionControlSubsystemsNode
    || missionControlScreenNode?.querySelector?.("#mission-control-subsystems")
    || null;
  const missionControlLiveMetricsNode = options.missionControlLiveMetricsNode
    || missionControlScreenNode?.querySelector?.("#mission-control-live-metrics")
    || null;
  const missionControlLiveFeedVideoNode = options.missionControlLiveFeedVideoNode
    || missionControlScreenNode?.querySelector?.("#mission-control-live-feed-video")
    || null;
  const missionControlLiveFeedCanvasNode = options.missionControlLiveFeedCanvasNode
    || missionControlScreenNode?.querySelector?.(".mission-control-live-feed-canvas")
    || null;
  const missionControlLiveTagTopLeftNode = options.missionControlLiveTagTopLeftNode
    || missionControlScreenNode?.querySelector?.("#mission-control-live-tag-top-left")
    || null;
  const missionControlLiveTagTopRightNode = options.missionControlLiveTagTopRightNode
    || missionControlScreenNode?.querySelector?.("#mission-control-live-tag-top-right")
    || null;
  const missionControlLiveTagBottomLeftNode = options.missionControlLiveTagBottomLeftNode
    || missionControlScreenNode?.querySelector?.("#mission-control-live-tag-bottom-left")
    || null;
  const missionControlLiveTagBottomRightNode = options.missionControlLiveTagBottomRightNode
    || missionControlScreenNode?.querySelector?.("#mission-control-live-tag-bottom-right")
    || null;
  const missionControlVehicleOverlayNode = options.missionControlVehicleOverlayNode
    || missionControlScreenNode?.querySelector?.("#mission-control-vehicle-overlay")
    || null;
  const staleViewportLabelNode = missionControlScreenNode?.querySelector?.(".mission-control-live-viewport-label") || null;
  if (staleViewportLabelNode && typeof staleViewportLabelNode.remove === "function") {
    staleViewportLabelNode.remove();
  }
  const missionControlVehiclePartMap = new Map();
  if (missionControlVehicleOverlayNode) {
    const partNodes = missionControlVehicleOverlayNode.querySelectorAll("[data-part]");
    for (let i = 0; i < partNodes.length; i += 1) {
      const node = partNodes[i];
      const part = String(node?.getAttribute?.("data-part") || "").trim().toLowerCase();
      if (!part) {
        continue;
      }
      if (!missionControlVehiclePartMap.has(part)) {
        missionControlVehiclePartMap.set(part, []);
      }
      missionControlVehiclePartMap.get(part).push(node);
    }
  }
  const liveFeedSourceCanvas = options.liveFeedSourceCanvas || null;
  const missionControlViewStarshipButton = options.missionControlViewStarshipButton || null;
  const missionControlViewBoosterButton = options.missionControlViewBoosterButton || null;
  const missionControlFleetNode = options.missionControlFleetNode || null;
  const formatDurationSeconds = typeof options.formatDurationSeconds === "function"
    ? options.formatDurationSeconds
    : ((value) => String(value ?? "n/a"));
  const formatNumber = typeof options.formatNumber === "function"
    ? options.formatNumber
    : ((value) => String(value ?? "n/a"));
  const escapeHtml = typeof options.escapeHtml === "function" ? options.escapeHtml : fallbackEscapeHtml;
  const phaseLabelForLaunch = typeof options.phaseLabelForLaunch === "function"
    ? options.phaseLabelForLaunch
    : ((phase) => String(phase || "Idle"));
  const onSelectVehicleView = typeof options.onSelectVehicleView === "function"
    ? options.onSelectVehicleView
    : null;
  const onTrackBody = typeof options.onTrackBody === "function"
    ? options.onTrackBody
    : null;
  const onSelectMission = typeof options.onSelectMission === "function"
    ? options.onSelectMission
    : null;
  const onSelectMissionLaunchMode = typeof options.onSelectMissionLaunchMode === "function"
    ? options.onSelectMissionLaunchMode
    : null;
  const onSelectTankerLaunchMode = typeof options.onSelectTankerLaunchMode === "function"
    ? options.onSelectTankerLaunchMode
    : null;

  let visible = false;
  let escBound = false;
  let onScreenStateChanged = null;
  let selectedFleetBodyId = "";
  let cachedFleetEntries = [];
  let lastFleetMarkupSignature = "";
  let liveFeedDrawFailed = false;
  let liveFeedStreamInitialized = false;
  let liveFeedStreamFailed = false;

  function setVehiclePartActivity(part, active, strength = 0.6) {
    const nodes = missionControlVehiclePartMap.get(String(part || "").trim().toLowerCase());
    if (!nodes || nodes.length <= 0) {
      return;
    }
    const activity = clamp(Number(strength) || 0, 0, 1);
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!(node instanceof Element)) {
        continue;
      }
      if (active) {
        node.classList.add("active");
        node.style.setProperty("--activity", activity.toFixed(3));
      } else {
        node.classList.remove("active");
        node.style.removeProperty("--activity");
      }
    }
  }

  function clearVehicleOverlayActivity() {
    const keys = missionControlVehiclePartMap.keys();
    for (const part of keys) {
      setVehiclePartActivity(part, false, 0);
    }
  }

  function normalizeRcsJetPart(rawToken) {
    const token = String(rawToken || "")
      .trim()
      .toLowerCase()
      .replace(/[_\s]+/g, "-");
    if (!token) {
      return "";
    }
    const map = {
      nose: "forward",
      fore: "forward",
      forward: "forward",
      tail: "aft",
      rear: "aft",
      aft: "aft",
      top: "dorsal",
      dorsal: "dorsal",
      bottom: "ventral",
      ventral: "ventral",
      left: "port",
      port: "port",
      right: "starboard",
      starboard: "starboard",
    };
    if (map[token]) {
      return map[token];
    }
    const candidates = token.split(/[^a-z0-9-]+/g).filter(Boolean);
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      if (map[candidate]) {
        return map[candidate];
      }
    }
    if (token.includes("forward") || token.includes("fore") || token.includes("nose")) {
      return "forward";
    }
    if (token.includes("aft") || token.includes("rear") || token.includes("tail")) {
      return "aft";
    }
    if (token.includes("dorsal") || token.includes("top")) {
      return "dorsal";
    }
    if (token.includes("ventral") || token.includes("bottom")) {
      return "ventral";
    }
    if (token.includes("port") || token.includes("left")) {
      return "port";
    }
    if (token.includes("starboard") || token.includes("right")) {
      return "starboard";
    }
    return "";
  }

  function collectRcsJetParts(jets) {
    const parts = new Set();
    if (!Array.isArray(jets)) {
      return parts;
    }
    for (let i = 0; i < jets.length; i += 1) {
      const raw = String(jets[i] || "").trim();
      if (!raw) {
        continue;
      }
      const tokens = raw
        .split(/[,+/|]/g)
        .map((value) => value.trim())
        .filter(Boolean);
      if (tokens.length <= 0) {
        const normalizedSingle = normalizeRcsJetPart(raw);
        if (normalizedSingle) {
          parts.add(normalizedSingle);
        }
        continue;
      }
      for (let j = 0; j < tokens.length; j += 1) {
        const normalized = normalizeRcsJetPart(tokens[j]);
        if (normalized) {
          parts.add(normalized);
        }
      }
    }
    return parts;
  }

  function preferredOverlayMode(vehicleViewState) {
    const activeView = String(vehicleViewState?.activeView || "").trim().toLowerCase();
    if (activeView === "booster") {
      return "booster";
    }
    if (activeView === "starship") {
      return "starship";
    }
    if (vehicleViewState?.starshipViewAvailable) {
      return "starship";
    }
    if (vehicleViewState?.boosterViewAvailable) {
      return "booster";
    }
    return "starship";
  }

  function syncVehicleOverlay(vehicleViewState, snapshot) {
    if (!missionControlVehicleOverlayNode) {
      return;
    }
    const mode = preferredOverlayMode(vehicleViewState);
    missionControlVehicleOverlayNode.classList.toggle("booster-mode", mode === "booster");
    missionControlVehicleOverlayNode.classList.toggle("starship-mode", mode !== "booster");

    clearVehicleOverlayActivity();
    if (!snapshot || typeof snapshot !== "object") {
      return;
    }

    const isBoosterMode = mode === "booster";
    const mainThrottle = isBoosterMode
      ? Number(snapshot?.boosterThrottleCommand ?? snapshot?.boosterThrottle)
      : Number(snapshot?.throttleCommand ?? snapshot?.throttle);
    const mainThrustN = isBoosterMode
      ? Number(snapshot?.boosterThrustN)
      : Number(snapshot?.thrustN);
    const mainEngineOn = (Number.isFinite(mainThrustN) && mainThrustN > 1)
      || (Number.isFinite(mainThrottle) && mainThrottle > 0.01);
    const mainEngineActivity = clamp(
      Number.isFinite(mainThrottle)
        ? mainThrottle
        : (mainEngineOn ? 0.45 : 0),
      0,
      1,
    );
    setVehiclePartActivity("main-engine", mainEngineOn, mainEngineActivity);

    const rcsActive = isBoosterMode
      ? Boolean(snapshot?.boosterRcsActive)
      : Boolean(snapshot?.rcsActive);
    const rcsAuthority = isBoosterMode
      ? Number(snapshot?.boosterRcsAuthority)
      : Number(snapshot?.rcsAuthority);
    const rcsJets = isBoosterMode
      ? snapshot?.boosterRcsJets
      : snapshot?.rcsJets;
    const activeParts = rcsActive ? collectRcsJetParts(rcsJets) : new Set();
    const thrusterActivity = clamp(
      Number.isFinite(rcsAuthority)
        ? Math.max(0.3, rcsAuthority)
        : (rcsActive ? 0.55 : 0),
      0,
      1,
    );
    const thrusterParts = ["forward", "aft", "dorsal", "ventral", "port", "starboard"];
    for (let i = 0; i < thrusterParts.length; i += 1) {
      const part = thrusterParts[i];
      setVehiclePartActivity(part, activeParts.has(part), thrusterActivity);
    }
  }

  function syncLiveViewportFeed() {
    if (!visible || !liveFeedSourceCanvas) {
      return;
    }
    if (!liveFeedStreamInitialized && !liveFeedStreamFailed && missionControlLiveFeedVideoNode) {
      try {
        const stream = typeof liveFeedSourceCanvas.captureStream === "function"
          ? liveFeedSourceCanvas.captureStream(30)
          : null;
        if (stream) {
          missionControlLiveFeedVideoNode.srcObject = stream;
          const playResult = missionControlLiveFeedVideoNode.play?.();
          if (playResult && typeof playResult.catch === "function") {
            playResult.catch(() => {
              liveFeedStreamFailed = true;
            });
          }
          missionControlLiveFeedVideoNode.style.display = "block";
          liveFeedStreamInitialized = true;
        }
      } catch (_error) {
        liveFeedStreamFailed = true;
      }
    }
    if (!missionControlLiveFeedCanvasNode || liveFeedDrawFailed) {
      return;
    }
    const sourceWidth = Math.max(0, Number(liveFeedSourceCanvas.width) || 0);
    const sourceHeight = Math.max(0, Number(liveFeedSourceCanvas.height) || 0);
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      return;
    }
    const viewportRect = missionControlLiveFeedCanvasNode.getBoundingClientRect();
    const cssWidth = Math.max(
      1,
      Math.floor(
        Number(viewportRect.width)
        || Number(missionControlLiveFeedCanvasNode.clientWidth)
        || 1,
      ),
    );
    const cssHeight = Math.max(
      1,
      Math.floor(
        Number(viewportRect.height)
        || Number(missionControlLiveFeedCanvasNode.clientHeight)
        || 1,
      ),
    );
    const dpr = Math.max(1, Math.min(2, Number(window?.devicePixelRatio) || 1));
    const targetWidth = Math.max(1, Math.floor(cssWidth * dpr));
    const targetHeight = Math.max(1, Math.floor(cssHeight * dpr));
    if (
      missionControlLiveFeedCanvasNode.width !== targetWidth
      || missionControlLiveFeedCanvasNode.height !== targetHeight
    ) {
      missionControlLiveFeedCanvasNode.width = targetWidth;
      missionControlLiveFeedCanvasNode.height = targetHeight;
    }
    const ctx = missionControlLiveFeedCanvasNode.getContext("2d");
    if (!ctx) {
      return;
    }
    const sourceAspect = sourceWidth / sourceHeight;
    const targetAspect = targetWidth / targetHeight;
    let dx = 0;
    let dy = 0;
    let dw = targetWidth;
    let dh = targetHeight;
    if (sourceAspect > targetAspect) {
      dh = targetWidth / sourceAspect;
      dy = (targetHeight - dh) * 0.5;
    } else {
      dw = targetHeight * sourceAspect;
      dx = (targetWidth - dw) * 0.5;
    }
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, targetWidth, targetHeight);
      ctx.fillStyle = "rgba(4, 10, 16, 0.96)";
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(
        liveFeedSourceCanvas,
        0,
        0,
        sourceWidth,
        sourceHeight,
        dx,
        dy,
        dw,
        dh,
      );
    } catch (_error) {
      liveFeedDrawFailed = true;
      missionControlLiveFeedCanvasNode.classList.add("fallback");
    }
  }

  function finiteNumberOrNull(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function percentString(value, digits = 1) {
    const numeric = finiteNumberOrNull(value);
    return numeric === null ? "n/a" : `${formatNumber(numeric * 100, digits)}%`;
  }

  function shortModeLabel(value) {
    const text = String(value || "").trim();
    if (!text) {
      return "n/a";
    }
    return text
      .replace(/^mission-/, "")
      .replace(/^navsys:/, "")
      .replace(/^autopilot-/, "")
      .replace(/[_:]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toneClass(value, fallback = "info") {
    const tone = String(value || "").trim().toLowerCase();
    if (tone === "nominal" || tone === "caution" || tone === "critical" || tone === "info") {
      return tone;
    }
    return fallback;
  }

  function statusChip({ label, value, meta = "", tone = "info" } = {}) {
    return [
      `<article class="mission-control-status-pill tone-${toneClass(tone)}">`,
      `<span class="mission-control-status-label">${escapeHtml(label || "")}</span>`,
      `<strong class="mission-control-status-value">${escapeHtml(value || "n/a")}</strong>`,
      meta ? `<span class="mission-control-status-meta">${escapeHtml(meta)}</span>` : "",
      "</article>",
    ].join("");
  }

  function commandCard({ label, value, meta = "", tone = "info" } = {}) {
    return [
      `<article class="mission-control-command-card tone-${toneClass(tone)}">`,
      `<span class="mission-control-command-label">${escapeHtml(label || "")}</span>`,
      `<strong class="mission-control-command-value">${escapeHtml(value || "n/a")}</strong>`,
      meta ? `<span class="mission-control-command-meta">${escapeHtml(meta)}</span>` : "",
      "</article>",
    ].join("");
  }

  function heroMetric({ label, value, detail = "", tone = "info", progress = null } = {}) {
    const progressNumber = finiteNumberOrNull(progress);
    const showBar = progressNumber !== null;
    const safeProgress = showBar ? clamp(progressNumber, 0, 1) : 0;
    return [
      `<article class="mission-control-hero-card tone-${toneClass(tone)}">`,
      `<span class="mission-control-hero-label">${escapeHtml(label || "")}</span>`,
      `<strong class="mission-control-hero-value">${escapeHtml(value || "n/a")}</strong>`,
      detail ? `<span class="mission-control-hero-detail">${escapeHtml(detail)}</span>` : "",
      showBar
        ? `<span class="mission-control-hero-bar"><span class="mission-control-hero-bar-fill" style="width:${safeProgress * 100}%"></span></span>`
        : "",
      "</article>",
    ].join("");
  }

  function subsystemCard({ title, status, detail = "", meta = "", tone = "info", progress = null } = {}) {
    const progressNumber = finiteNumberOrNull(progress);
    const showBar = progressNumber !== null;
    const safeProgress = showBar ? clamp(progressNumber, 0, 1) : 0;
    return [
      `<article class="mission-control-subsystem-card tone-${toneClass(tone)}">`,
      `<span class="mission-control-subsystem-title">${escapeHtml(title || "")}</span>`,
      `<strong class="mission-control-subsystem-status">${escapeHtml(status || "n/a")}</strong>`,
      detail ? `<p class="mission-control-subsystem-detail">${escapeHtml(detail)}</p>` : "",
      meta ? `<p class="mission-control-subsystem-meta">${escapeHtml(meta)}</p>` : "",
      showBar
        ? `<span class="mission-control-subsystem-bar"><span class="mission-control-subsystem-bar-fill" style="width:${safeProgress * 100}%"></span></span>`
        : "",
      "</article>",
    ].join("");
  }

  function alertCard({ kicker = "", title = "", detail = "", meta = "", tone = "info" } = {}) {
    return [
      `<article class="mission-control-alert-card tone-${toneClass(tone)}">`,
      kicker ? `<span class="mission-control-alert-kicker">${escapeHtml(kicker)}</span>` : "",
      `<strong class="mission-control-alert-title">${escapeHtml(title || "n/a")}</strong>`,
      detail ? `<p class="mission-control-alert-detail">${escapeHtml(detail)}</p>` : "",
      meta ? `<p class="mission-control-alert-meta">${escapeHtml(meta)}</p>` : "",
      "</article>",
    ].join("");
  }

  function normalizeMissionPickerState(state, snapshot) {
    const raw = state && typeof state === "object" ? state : {};
    const rawProfiles = Array.isArray(raw.profiles) ? raw.profiles : [];
    const profiles = rawProfiles
      .map((profile) => {
        const id = String(profile?.id || "").trim();
        if (!id) {
          return null;
        }
        return {
          id,
          name: String(profile?.name || toLaunchTitle(id)),
          description: String(profile?.description || profile?.name || id),
        };
      })
      .filter(Boolean);
    const fallbackMissionId = profiles[0]?.id || "";
    const selectedMissionId = String(raw.selectedMissionId || snapshot?.missionId || fallbackMissionId).trim() || fallbackMissionId;
    const activeMissionId = String(raw.activeMissionId || snapshot?.missionId || "").trim();
    const missionLaunchMode = String(raw.missionLaunchMode || "pad_launch").trim().toLowerCase() === "orbit_inject"
      ? "orbit_inject"
      : "pad_launch";
    const tankerLaunchMode = String(raw.tankerLaunchMode || "pad_launch").trim().toLowerCase() === "orbit_inject"
      ? "orbit_inject"
      : "pad_launch";
    return {
      profiles,
      selectedMissionId,
      activeMissionId,
      missionLaunchMode,
      tankerLaunchMode,
      launchActive: Boolean(raw.launchActive),
      controllerReady: raw.controllerReady !== false,
    };
  }

  function missionLaunchModeDisplay(mode) {
    return String(mode || "").trim().toLowerCase() === "orbit_inject"
      ? "Direct Orbit Inject"
      : "Earth Pad Launch";
  }

  function tankerLaunchModeDisplay(mode) {
    return String(mode || "").trim().toLowerCase() === "orbit_inject"
      ? "Direct Orbit Inject"
      : "Earth Pad Launch";
  }

  function missionPickerCard({
    id = "",
    name = "Mission",
    description = "",
    meta = "",
    badges = [],
    selected = false,
    active = false,
    disabled = false,
  } = {}) {
    const classes = [
      "mission-control-mission-card",
      selected ? "selected" : "",
      active ? "active" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const badgeMarkup = badges
      .map((badge) => {
        const badgeTone = String(badge?.tone || "ready").trim().toLowerCase();
        const badgeClass = badgeTone === "live" || badgeTone === "next" || badgeTone === "ready"
          ? badgeTone
          : "ready";
        return `<span class="mission-control-mission-badge ${badgeClass}">${escapeHtml(badge?.label || "")}</span>`;
      })
      .join("");
    return [
      `<button type="button" class="${classes}" data-mc-mission-id="${escapeHtml(id)}" aria-pressed="${selected ? "true" : "false"}"${disabled ? " disabled" : ""}>`,
      "<div class=\"mission-control-mission-card-head\">",
      `<p class="mission-control-mission-card-title">${escapeHtml(name)}</p>`,
      badgeMarkup ? `<div class="mission-control-mission-badges">${badgeMarkup}</div>` : "",
      "</div>",
      `<p class="mission-control-mission-card-description">${escapeHtml(description || "No mission description.")}</p>`,
      meta ? `<p class="mission-control-mission-card-meta">${escapeHtml(meta)}</p>` : "",
      "</button>",
    ].join("");
  }

  function missionModeButton({
    group = "mission",
    value = "pad_launch",
    label = "",
    meta = "",
    active = false,
    disabled = false,
  } = {}) {
    return [
      `<button type="button" class="mission-control-mode-button${active ? " active" : ""}" data-mc-mode-group="${escapeHtml(group)}" data-mc-mode-value="${escapeHtml(value)}" aria-pressed="${active ? "true" : "false"}"${disabled ? " disabled" : ""}>`,
      `<span class="mission-control-mode-label">${escapeHtml(label || "n/a")}</span>`,
      meta ? `<span class="mission-control-mode-meta">${escapeHtml(meta)}</span>` : "",
      "</button>",
    ].join("");
  }

  function overviewCluster({ title, kicker = "", rows = [], tone = "info" } = {}) {
    return [
      `<article class="mission-control-data-cluster tone-${toneClass(tone)}">`,
      "<header class=\"mission-control-data-cluster-header\">",
      kicker ? `<span class="mission-control-data-cluster-kicker">${escapeHtml(kicker)}</span>` : "",
      `<h4 class="mission-control-data-cluster-title">${escapeHtml(title || "")}</h4>`,
      "</header>",
      "<dl class=\"mission-control-data-cluster-grid\">",
      rows.join(""),
      "</dl>",
      "</article>",
    ].join("");
  }

  function overviewRow(label, value, emphasis = false) {
    return [
      `<div class="mission-control-data-row${emphasis ? " emphasis" : ""}">`,
      `<dt>${escapeHtml(label || "")}</dt>`,
      `<dd>${escapeHtml(value || "n/a")}</dd>`,
      "</div>",
    ].join("");
  }

  function eventRow({ timestamp = "--:--:--", level = "EVT", name = "Event", detail = "", tone = "info" } = {}) {
    return [
      `<article class="mission-control-event-row tone-${toneClass(tone)}">`,
      `<span class="mission-control-event-time">${escapeHtml(timestamp)}</span>`,
      `<span class="mission-control-event-level">${escapeHtml(level)}</span>`,
      "<div class=\"mission-control-event-copy\">",
      `<p class="mission-control-event-name">${escapeHtml(name)}</p>`,
      detail ? `<p class="mission-control-event-detail">${escapeHtml(detail)}</p>` : "",
      "</div>",
      "</article>",
    ].join("");
  }

  function fleetMetric(label, value) {
    return [
      "<div class=\"mission-control-fleet-metric\">",
      `<span class="mission-control-fleet-metric-label">${escapeHtml(label || "")}</span>`,
      `<strong class="mission-control-fleet-metric-value">${escapeHtml(value || "n/a")}</strong>`,
      "</div>",
    ].join("");
  }

  function missionSequenceItem(step) {
    const status = step.status === "completed"
      ? "completed"
      : (step.status === "active" ? "active" : "pending");
    const note = step.note ? `<p class="mission-sequence-note">${escapeHtml(step.note)}</p>` : "";
    return [
      `<li class="mission-sequence-item ${status}">`,
      "<span class=\"mission-sequence-marker\"></span>",
      "<div class=\"mission-sequence-copy\">",
      `<p class="mission-sequence-title">${escapeHtml(step.title)}</p>`,
      note,
      "</div>",
      "</li>",
    ].join("");
  }

  function focusedMissionSequence(steps) {
    const list = Array.isArray(steps) ? steps : [];
    if (list.length <= 5) {
      return list;
    }
    let focusIndex = list.findIndex((step) => step?.status === "active");
    if (focusIndex < 0) {
      focusIndex = list.findIndex((step) => step?.status === "pending");
    }
    if (focusIndex < 0) {
      focusIndex = list.length - 1;
    }
    const start = Math.max(0, Math.min(focusIndex - 1, list.length - 5));
    return list.slice(start, start + 5);
  }

  function launchEventInlineDetail(entry) {
    if (!entry || typeof entry !== "object") {
      return "";
    }
    const parts = [];
    if (typeof entry.toMissionPhase === "string" && entry.toMissionPhase) {
      parts.push(humanizeMissionPhase(entry.toMissionPhase));
    }
    if (typeof entry.toStageName === "string" && entry.toStageName) {
      parts.push(entry.toStageName);
    }
    if (typeof entry.reason === "string" && entry.reason) {
      parts.push(entry.reason);
    }
    if (typeof entry.boosterPhase === "string" && entry.boosterPhase) {
      parts.push(toLaunchTitle(entry.boosterPhase));
    }
    if (typeof entry.fromGuidanceMode === "string" && typeof entry.toGuidanceMode === "string" && entry.toGuidanceMode) {
      parts.push(`Guidance ${entry.fromGuidanceMode || "n/a"} -> ${entry.toGuidanceMode}`);
    } else if (typeof entry.guidanceDisplayMode === "string" && entry.guidanceDisplayMode) {
      parts.push(`Guidance ${entry.guidanceDisplayMode}`);
    } else if (typeof entry.guidanceMode === "string" && entry.guidanceMode) {
      parts.push(`Guidance ${entry.guidanceMode}`);
    }
    const toTargetBodyId = String(entry.toTargetBodyId || entry.targetBodyId || "").trim();
    const toTargetBodyName = String(entry.toTargetBodyName || entry.targetBodyName || "").trim();
    if (toTargetBodyId || toTargetBodyName) {
      parts.push(`Target ${toTargetBodyName || toTargetBodyId}`);
    }
    if (typeof entry.burnActive === "boolean") {
      parts.push(entry.burnActive ? "Burn start" : "Burn stop");
    }
    return parts.length > 0 ? ` | ${parts.join(" | ")}` : "";
  }

  function flightRuleState({
    snapshot,
    guidanceInertNoPropellant = false,
    guidanceInertReason = "",
    fuelBudgetFeasible = null,
  } = {}) {
    if (!snapshot) {
      return {
        value: "Standby",
        tone: "info",
        detail: "Awaiting active telemetry.",
      };
    }
    if (guidanceInertNoPropellant) {
      return {
        value: "No-Go",
        tone: "critical",
        detail: guidanceInertReason || "Guidance burn disabled by propellant state.",
      };
    }
    if (fuelBudgetFeasible === false) {
      return {
        value: "No-Go",
        tone: "critical",
        detail: "Fuel budget deficit against mission requirement.",
      };
    }
    const gateReason = String(snapshot?.missionPhaseGateReason || "").trim();
    if (gateReason) {
      return {
        value: "Hold",
        tone: "caution",
        detail: gateReason,
      };
    }
    if (snapshot?.missionCompleted) {
      return {
        value: "Complete",
        tone: "nominal",
        detail: "Mission objectives achieved.",
      };
    }
    return {
      value: "Go",
      tone: "nominal",
      detail: "Flight rules nominal.",
    };
  }

  function spaceWeatherTone(kpIndex) {
    const kp = finiteNumberOrNull(kpIndex);
    if (kp === null) {
      return "info";
    }
    if (kp >= 6) {
      return "critical";
    }
    if (kp >= 4) {
      return "caution";
    }
    return "nominal";
  }

  function launchTargetValue(snapshot) {
    const bodyName = String(snapshot?.targetBodyName || snapshot?.targetBodyId || "").trim();
    if (!bodyName) {
      return "n/a";
    }
    const distanceKm = finiteNumberOrNull(snapshot?.targetDistanceKm);
    if (distanceKm === null) {
      return bodyName;
    }
    return `${bodyName} • ${formatNumber(distanceKm, 1)} km`;
  }

  function buildMissionSequence(snapshot, launchEventLogEntries) {
    const missionId = String(snapshot?.missionId || "earth_orbit_hold");
    const missionPhase = missionId === "moon_orbit_return"
      ? displayMissionPhase(snapshot?.missionPhase, missionId)
      : String(snapshot?.missionPhase || "");
    const elapsedSec = Number(snapshot?.elapsedSeconds) || 0;
    const stageIndex = Number(snapshot?.stageIndex) || 0;
    const dynamicPressurePa = Number(snapshot?.dynamicPressurePa) || 0;
    const launchStarted = elapsedSec > 1 || hasLaunchEvent(launchEventLogEntries, "launch_started");
    const stageSeparated = stageIndex >= 1
      || hasLaunchEvent(launchEventLogEntries, "hotstage_ignition")
      || hasLaunchEvent(launchEventLogEntries, "stage_separation_booster_detached");
    const hotstageDone =
      hasLaunchEvent(launchEventLogEntries, "hotstage_detach")
      || hasLaunchEvent(launchEventLogEntries, "stage_separation_booster_detached")
      || Boolean(snapshot?.hotstageDetachReason)
      || Boolean(snapshot?.boosterActive);
    const refuelRequiredFlights = Math.max(0, Number(snapshot?.refuelRequiredFlights) || 0);
    const refuelCompletedFlights = Math.max(0, Number(snapshot?.refuelCompletedFlights) || 0);
    const refuelFillFraction = clamp(Number(snapshot?.refuelFillFraction) || 0, 0, 1);
    const refuelReady = refuelFillFraction >= 0.88;
    const parkingThresholds = (
      missionId === "moon_orbit_return" || missionId === "orbital_refuel_demo"
    )
      ? { apoapsisKm: 180, periapsisKm: 150 }
      : { apoapsisKm: 120, periapsisKm: 80 };
    const parkingReady =
      Number.isFinite(Number(snapshot?.apoapsisKm))
      && Number.isFinite(Number(snapshot?.periapsisKm))
      && Number(snapshot?.apoapsisKm) >= parkingThresholds.apoapsisKm
      && Number(snapshot?.periapsisKm) >= parkingThresholds.periapsisKm;
    const maxQComplete =
      stageSeparated
      || hotstageDone
      || (launchStarted && elapsedSec > 85 && dynamicPressurePa < 18000);
    const steps = [
      {
        title: "Preflight Go / No-Go",
        note: launchStarted ? "Vehicle committed to launch profile." : "Final checks and launch readiness.",
        status: launchStarted ? "completed" : "active",
      },
      {
        title: "Liftoff And Tower Clear",
        note: Number.isFinite(Number(snapshot?.altitudeKm)) ? `Altitude ${formatNumber(snapshot.altitudeKm, 3)} km` : "Awaiting liftoff.",
        status: !launchStarted ? "pending" : (elapsedSec < 24 ? "active" : "completed"),
      },
      {
        title: "Max-Q Region",
        note: Number.isFinite(dynamicPressurePa) ? `Dynamic pressure ${formatNumber(dynamicPressurePa / 1000, 2)} kPa` : "Awaiting aerodynamic load-up.",
        status: !launchStarted ? "pending" : (maxQComplete ? "completed" : "active"),
      },
      {
        title: "Hot-Stage And Booster Separation",
        note: hotstageDone
          ? "Booster detached and recovery profile active."
          : (snapshot?.hotstageActive ? "Ignition overlap gate in progress." : "Awaiting stage transition."),
        status: !launchStarted ? "pending" : (hotstageDone ? "completed" : (stageSeparated || snapshot?.hotstageActive ? "active" : "pending")),
      },
      {
        title: "Earth Parking Orbit",
        note: parkingReady
          ? `Apo/Peri ${formatNumber(snapshot?.apoapsisKm, 1)} / ${formatNumber(snapshot?.periapsisKm, 1)} km`
          : `Building stable insertion conditions (target: ${formatNumber(parkingThresholds.apoapsisKm, 0)} / ${formatNumber(parkingThresholds.periapsisKm, 0)} km).`,
        status: !stageSeparated ? "pending" : (parkingReady ? "completed" : "active"),
      },
    ];

    if (missionId === "moon_orbit_return") {
      const phaseOrder = [
        "parking_orbit",
        "departure_window_wait",
        "tli_burn",
        "midcourse",
        "lunar_orbit_insertion",
        "lunar_orbit_trim",
        "lunar_loiter",
        "tei_burn",
        "earth_approach",
        "earth_capture",
        "earth_orbit_hold",
      ];
      const currentRank = phaseOrder.indexOf(missionPhase);
      const moonStages = [
        {
          key: "parking_orbit",
          title: "Parking Orbit Checkout",
          note: "Confirm bounded parking orbit and mission geometry before departure.",
        },
        {
          key: "departure_window_wait",
          title: "Departure Window Wait",
          note: Number.isFinite(snapshot?.moonDepartureWindowWaitSec)
            ? `Best TLI slot in ${formatDurationSeconds(Number(snapshot.moonDepartureWindowWaitSec))}.`
            : "Awaiting the departure geometry window.",
        },
        { key: "tli_burn", title: "Trans-Lunar Injection Burn", note: "Raise Earth apogee to the lunar transfer corridor." },
        { key: "midcourse", title: "Midcourse", note: "Guided cruise and transfer maintenance toward the Moon." },
        { key: "lunar_orbit_insertion", title: "Lunar Orbit Insertion", note: "Capture into lunar gravity." },
        { key: "lunar_orbit_trim", title: "Lunar Orbit Trim", note: "Settle lunar apoapsis and periapsis into the target orbit." },
        { key: "lunar_loiter", title: "Lunar Loiter", note: "Hold lunar orbit before departure." },
        { key: "tei_burn", title: "Trans-Earth Injection Burn", note: "Depart lunar orbit onto Earth return trajectory." },
        { key: "earth_approach", title: "Earth Approach", note: "Return cruise and Earth capture targeting." },
        { key: "earth_capture", title: "Earth Capture", note: "Recapture into Earth orbit." },
        { key: "earth_orbit_hold", title: "Earth Orbit Hold", note: "Mission return profile achieved." },
      ];
      for (let i = 0; i < moonStages.length; i += 1) {
        const stage = moonStages[i];
        const isCurrent = currentRank === i;
        const isComplete = currentRank > i || (i === moonStages.length - 1 && Boolean(snapshot?.missionCompleted));
        const isActive = isCurrent || (i === 0 && parkingReady && currentRank < 0);
        steps.push({
          title: stage.title,
          note: isCurrent ? `Current phase: ${humanizeMissionPhase(missionPhase)}` : stage.note,
          status: !parkingReady ? "pending" : (isComplete ? "completed" : (isActive ? "active" : "pending")),
        });
      }
    } else if (missionId === "orbital_refuel_demo") {
      const phaseOrder = [
        "orbital_refuel",
        "earth_orbit_hold",
      ];
      const currentRank = phaseOrder.indexOf(missionPhase);
      const demoStages = [
        {
          key: "orbital_refuel",
          title: "Orbital Refuel Operation",
          note: `Flights ${refuelCompletedFlights}/${refuelRequiredFlights} | Fill ${(refuelFillFraction * 100).toFixed(1)}%`,
        },
        {
          key: "earth_orbit_hold",
          title: "Undock And Earth Orbit Hold",
          note: "Transfer complete, separation confirmed, and orbit stabilized.",
        },
      ];
      for (let i = 0; i < demoStages.length; i += 1) {
        const stage = demoStages[i];
        const isCurrent = currentRank === i;
        const isComplete = i === 0
          ? refuelReady
          : (currentRank > i || Boolean(snapshot?.missionCompleted));
        const isActive = isCurrent || (i === 0 && parkingReady && currentRank < 0);
        steps.push({
          title: stage.title,
          note: isCurrent ? `Current phase: ${humanizeMissionPhase(missionPhase)}` : stage.note,
          status: !parkingReady ? "pending" : (isComplete ? "completed" : (isActive ? "active" : "pending")),
        });
      }
    } else {
      const inOrbitHold = missionPhase === "earth_orbit_hold" && parkingReady && stageSeparated;
      steps.push({
        title: "Orbit Stabilization Burns",
        note: inOrbitHold ? "Insertion burn complete." : "Circularizing and trimming orbital energy.",
        status: !parkingReady ? "pending" : (inOrbitHold ? "completed" : "active"),
      });
      steps.push({
        title: "Sustained Earth Orbit Hold",
        note: inOrbitHold
          ? `Apo/Peri ${Number.isFinite(Number(snapshot?.apoapsisKm)) ? formatNumber(snapshot.apoapsisKm, 1) : "n/a"} / ${Number.isFinite(Number(snapshot?.periapsisKm)) ? formatNumber(snapshot.periapsisKm, 1) : "n/a"} km`
          : "Awaiting stable station-keeping regime.",
        status: !inOrbitHold ? "pending" : (snapshot?.missionCompleted ? "completed" : "active"),
      });
    }
    return steps;
  }

  function syncButtonState() {
    if (!launchMissionControlButton) {
      return;
    }
    launchMissionControlButton.disabled = false;
    launchMissionControlButton.classList.toggle("on", visible);
    launchMissionControlButton.setAttribute("aria-pressed", visible ? "true" : "false");
  }

  function normalizeVehicleViewState(vehicleViewState) {
    const state = vehicleViewState && typeof vehicleViewState === "object" ? vehicleViewState : {};
    const starshipViewAvailable = Boolean(state.starshipViewAvailable);
    const boosterViewAvailable = Boolean(state.boosterViewAvailable);
    const activeRaw = String(state.activeView || "").trim().toLowerCase();
    const activeView = activeRaw === "booster"
      ? "booster"
      : (activeRaw === "starship" ? "starship" : "none");
    const statusLine = typeof state.statusLine === "string" && state.statusLine
      ? state.statusLine
      : (
        activeView === "booster"
          ? "Booster tracking view active."
          : (
            activeView === "starship"
              ? "Starship tracking view active."
              : ((starshipViewAvailable || boosterViewAvailable)
                ? "Select Starship or Booster to lock view."
                : "Vehicle views unavailable in current scene.")
          )
      );
    return {
      starshipViewAvailable,
      boosterViewAvailable,
      activeView,
      statusLine,
    };
  }

  function syncVehicleViewState(vehicleViewState) {
    const safeState = normalizeVehicleViewState(vehicleViewState);
    if (missionControlViewStatusNode) {
      missionControlViewStatusNode.textContent = safeState.statusLine;
    }
    if (missionControlViewStarshipButton) {
      missionControlViewStarshipButton.disabled = !safeState.starshipViewAvailable;
      const active = safeState.activeView === "starship";
      missionControlViewStarshipButton.classList.toggle("on", active);
      missionControlViewStarshipButton.setAttribute("aria-pressed", active ? "true" : "false");
    }
    if (missionControlViewBoosterButton) {
      missionControlViewBoosterButton.disabled = !safeState.boosterViewAvailable;
      const active = safeState.activeView === "booster";
      missionControlViewBoosterButton.classList.toggle("on", active);
      missionControlViewBoosterButton.setAttribute("aria-pressed", active ? "true" : "false");
    }
    return safeState;
  }

  function normalizeFleetEntries(fleetEntries) {
    const entries = Array.isArray(fleetEntries) ? fleetEntries : [];
    const normalized = [];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const bodyId = String(entry.bodyId || "").trim();
      if (!bodyId) {
        continue;
      }
      normalized.push({
        bodyId,
        vehicleName: String(entry.vehicleName || bodyId),
        vehicleKind: String(entry.vehicleKind || "starship"),
        missionName: String(entry.missionName || "Mission"),
        missionPhase: String(entry.missionPhase || ""),
        phaseLabel: String(entry.phaseLabel || ""),
        stageName: String(entry.stageName || ""),
        guidanceMode: String(entry.guidanceMode || entry.autopilotMode || "n/a"),
        guidanceDisplayMode: String(entry.guidanceDisplayMode || entry.guidanceMode || entry.autopilotMode || "n/a"),
        altitudeKm: Number(entry.altitudeKm),
        speedKmS: Number(entry.speedKmS),
        tracked: Boolean(entry.tracked),
        selectable: entry.selectable !== false,
      });
    }
    return normalized;
  }

  function fleetRoleLabel(entry) {
    const kind = String(entry?.vehicleKind || "").toLowerCase();
    const bodyId = String(entry?.bodyId || "");
    if (kind === "booster" || bodyId === "earth_launch_booster") {
      return "Booster";
    }
    if (kind === "tanker" || bodyId.startsWith("earth_refuel_tanker_")) {
      return "Tanker";
    }
    if (bodyId === "earth_launch_vehicle") {
      return "Primary Starship";
    }
    return "Mission Starship";
  }

  function fleetPhaseLabel(entry) {
    if (entry?.missionPhase) {
      return humanizeMissionPhase(entry.missionPhase);
    }
    return entry?.phaseLabel || "n/a";
  }

  function renderFleetOperations(fleetEntries = []) {
    if (!missionControlFleetNode) {
      return;
    }
    const entries = normalizeFleetEntries(fleetEntries);
    cachedFleetEntries = entries;
    if (entries.length <= 0) {
      selectedFleetBodyId = "";
      lastFleetMarkupSignature = "";
      missionControlFleetNode.innerHTML = "<p class=\"mission-control-fleet-empty\">No active spacecraft in simulation.</p>";
      return;
    }

    const trackedEntry = entries.find((entry) => entry.tracked && entry.selectable);
    const hasSelected = entries.some((entry) => entry.bodyId === selectedFleetBodyId);
    if (trackedEntry?.bodyId) {
      // Keep card selection aligned with actual tracked body to avoid visual desync.
      selectedFleetBodyId = trackedEntry.bodyId;
    } else if (!hasSelected) {
      selectedFleetBodyId = entries[0].bodyId;
    }
    const selectedEntry = entries.find((entry) => entry.bodyId === selectedFleetBodyId) || entries[0];
    selectedFleetBodyId = selectedEntry.bodyId;

    let primaryCount = 0;
    let missionCount = 0;
    let tankerCount = 0;
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const role = fleetRoleLabel(entry);
      if (role === "Booster" || role === "Primary Starship") {
        primaryCount += 1;
      } else if (role === "Tanker") {
        tankerCount += 1;
      } else {
        missionCount += 1;
      }
    }
    const markupSignature = entries
      .map((entry) => [
        entry.bodyId,
        entry.vehicleName,
        fleetRoleLabel(entry),
        entry.missionName,
        fleetPhaseLabel(entry),
        entry.stageName || "",
        entry.guidanceDisplayMode || entry.guidanceMode || "",
        Number.isFinite(entry.altitudeKm) ? Math.round(entry.altitudeKm * 10) : "na",
        Number.isFinite(entry.speedKmS) ? Math.round(entry.speedKmS * 1000) : "na",
        entry.tracked ? "1" : "0",
        entry.selectable ? "1" : "0",
      ].join("|"))
      .join("||");
    const liveSignature = `${markupSignature}::selected=${selectedFleetBodyId}`;
    if (liveSignature === lastFleetMarkupSignature && missionControlFleetNode.childElementCount > 0) {
      return;
    }

    const cardRows = entries
      .map((entry) => {
        const isSelected = entry.bodyId === selectedFleetBodyId;
        const isTracked = Boolean(entry.tracked);
        const role = fleetRoleLabel(entry);
        const phase = fleetPhaseLabel(entry);
        const stage = entry.stageName || "n/a";
        const altitudeLine = Number.isFinite(entry.altitudeKm)
          ? `${formatNumber(entry.altitudeKm, 2)} km`
          : "n/a";
        const speedLine = Number.isFinite(entry.speedKmS)
          ? `${formatNumber(entry.speedKmS, 4)} km/s`
          : "n/a";
        const roleClass = role.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const classes = [
          "mission-control-fleet-card",
          `role-${roleClass}`,
          isSelected ? "selected" : "",
          isTracked ? "tracked" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const disabledAttr = entry.selectable ? "" : " disabled";
        const selectedAttr = isSelected ? " aria-pressed=\"true\"" : " aria-pressed=\"false\"";
        const trackingBadge = isTracked
          ? "<span class=\"mission-control-fleet-chip tracking\">Tracking</span>"
          : "<span class=\"mission-control-fleet-chip\">Select</span>";
        return [
          `<button type="button" class="${classes}" data-mc-card-id="${escapeHtml(entry.bodyId)}"${selectedAttr}${disabledAttr}>`,
          "<div class=\"mission-control-fleet-card-top\">",
          "<div class=\"mission-control-fleet-card-title-wrap\">",
          `<p class="mission-control-fleet-card-title">${escapeHtml(entry.vehicleName)}</p>`,
          `<p class="mission-control-fleet-card-line">${escapeHtml(entry.missionName || "Mission")}</p>`,
          "</div>",
          `<span class="mission-control-fleet-chip role">${escapeHtml(role)}</span>`,
          trackingBadge,
          "</div>",
          `<p class="mission-control-fleet-card-line">${escapeHtml(phase)} | Stage ${escapeHtml(stage)}</p>`,
          `<div class="mission-control-fleet-card-metrics">`,
          fleetMetric("ALT", altitudeLine),
          fleetMetric("VEL", speedLine),
          fleetMetric("GUID", shortModeLabel(entry.guidanceDisplayMode || entry.guidanceMode || "n/a")),
          fleetMetric("BODY", entry.bodyId),
          "</div>",
          "</button>",
        ].join("");
      })
      .join("");

    missionControlFleetNode.innerHTML = [
      "<div class=\"mission-control-fleet-head\">",
      "<p class=\"mission-control-fleet-label\">Missions</p>",
      `<p class="mission-control-fleet-counts">Primary ${primaryCount} | Mission ${missionCount} | Tanker ${tankerCount}</p>`,
      "</div>",
      "<div class=\"mission-control-fleet-cards\">",
      cardRows,
      "</div>",
    ].join("");
    lastFleetMarkupSignature = liveSignature;
  }

  function renderMissionPicker(missionPickerState, snapshot) {
    if (!missionControlMissionPickerNode) {
      return;
    }
    const safeState = normalizeMissionPickerState(missionPickerState, snapshot);
    if (safeState.profiles.length <= 0) {
      missionControlMissionPickerNode.innerHTML = "<p class=\"mission-control-mission-note\">Mission catalog unavailable.</p>";
      return;
    }
    const selectedProfile = safeState.profiles.find((profile) => profile.id === safeState.selectedMissionId)
      || safeState.profiles[0];
    const activeProfile = safeState.profiles.find((profile) => profile.id === safeState.activeMissionId)
      || null;
    const liveMissionValue = activeProfile
      ? activeProfile.name
      : (safeState.launchActive ? "Live telemetry unavailable" : "No active mission");
    const nextMissionValue = selectedProfile?.name || "No mission selected";
    const deploymentValue = missionLaunchModeDisplay(safeState.missionLaunchMode);
    const missionCards = safeState.profiles
      .map((profile) => {
        const isSelected = profile.id === safeState.selectedMissionId;
        const isActive = profile.id === safeState.activeMissionId;
        const badges = [];
        if (isActive) {
          badges.push({ label: "Live", tone: "live" });
        }
        if (isSelected) {
          badges.push({
            label: safeState.launchActive && !isActive ? "Next" : "Ready",
            tone: safeState.launchActive && !isActive ? "next" : "ready",
          });
        }
        const meta = isActive
          ? `Current phase ${humanizeMissionPhase(snapshot?.missionPhase || "")}`
          : (isSelected
            ? (safeState.launchActive ? "Staged for next stack." : "Selected for next launch.")
            : "Available mission profile.");
        return missionPickerCard({
          id: profile.id,
          name: profile.name,
          description: profile.description,
          meta,
          badges,
          selected: isSelected,
          active: isActive,
          disabled: !safeState.controllerReady,
        });
      })
      .join("");
    const missionNote = (() => {
      if (safeState.selectedMissionId === "moon_orbit_return") {
        if (safeState.missionLaunchMode === "orbit_inject") {
          return "Direct inject uses a dynamic LEO spawn point solved from the Moon's current geometry, then commits the stack from the best current transfer slot.";
        }
        return "Pad launch holds ascent at the lunar departure gate and commits when the Moon window lines up.";
      }
      if (safeState.selectedMissionId === "orbital_refuel_demo") {
        return "Refuel demo stages parking orbit, tanker rendezvous, transfer, undock, and Earth orbit hold in one closed loop.";
      }
      return "Earth Orbit Hold keeps the stack in a stable Earth-orbit mission profile for sustained observation and systems checkout.";
    })();
    missionControlMissionPickerNode.innerHTML = [
      "<div class=\"mission-control-mission-summary-row\">",
      statusChip({
        label: "Live Mission",
        value: liveMissionValue,
        meta: activeProfile ? "Current tracked mission." : "No active mission profile in flight.",
        tone: activeProfile ? "nominal" : "info",
      }),
      statusChip({
        label: safeState.launchActive ? "Next Stack" : "Selected Mission",
        value: nextMissionValue,
        meta: safeState.launchActive && selectedProfile?.id !== activeProfile?.id
          ? "Staged for the next launch stack."
          : "Mission profile armed.",
        tone: safeState.launchActive && selectedProfile?.id !== activeProfile?.id ? "caution" : "nominal",
      }),
      statusChip({
        label: "Deployment",
        value: deploymentValue,
        meta: `Tankers ${tankerLaunchModeDisplay(safeState.tankerLaunchMode)}`,
        tone: safeState.missionLaunchMode === "orbit_inject" ? "info" : "nominal",
      }),
      "</div>",
      `<div class="mission-control-mission-card-grid">${missionCards}</div>`,
      "<div class=\"mission-control-mode-groups\">",
      [
        "<section class=\"mission-control-mode-group\">",
        "<p class=\"mission-control-mode-group-title\">Mission Launch Mode</p>",
        "<div class=\"mission-control-mode-row\">",
        missionModeButton({
          group: "mission",
          value: "pad_launch",
          label: "Pad Launch",
          meta: "Booster + full ascent",
          active: safeState.missionLaunchMode === "pad_launch",
          disabled: !safeState.controllerReady,
        }),
        missionModeButton({
          group: "mission",
          value: "orbit_inject",
          label: "Orbit Inject",
          meta: "Direct LEO insertion",
          active: safeState.missionLaunchMode === "orbit_inject",
          disabled: !safeState.controllerReady,
        }),
        "</div>",
        "</section>",
      ].join(""),
      [
        "<section class=\"mission-control-mode-group\">",
        "<p class=\"mission-control-mode-group-title\">Tanker Launch Mode</p>",
        "<div class=\"mission-control-mode-row\">",
        missionModeButton({
          group: "tanker",
          value: "pad_launch",
          label: "Pad Launch",
          meta: "Reusable launch cadence",
          active: safeState.tankerLaunchMode === "pad_launch",
          disabled: !safeState.controllerReady,
        }),
        missionModeButton({
          group: "tanker",
          value: "orbit_inject",
          label: "Orbit Inject",
          meta: "Instant tanker placement",
          active: safeState.tankerLaunchMode === "orbit_inject",
          disabled: !safeState.controllerReady,
        }),
        "</div>",
        "</section>",
      ].join(""),
      "</div>",
      `<p class="mission-control-mission-note">${escapeHtml(missionNote)}</p>`,
    ].join("");
  }

  function setVisible(nextVisible) {
    visible = Boolean(nextVisible);
    if (missionControlScreenNode) {
      missionControlScreenNode.classList.toggle("visible", visible);
      missionControlScreenNode.setAttribute("aria-hidden", visible ? "false" : "true");
    }
    documentRef?.body?.classList?.toggle("mission-control-open", visible);
    syncButtonState();
  }

  function render(snapshot, launchActive, launchEventLogEntries = [], lastLaunchEventSummary = "", vehicleViewState = null, fleetEntries = [], missionPickerState = null) {
    if (!missionControlScreenNode || !missionControlSequenceNode || !missionControlEventsNode || !missionControlSubtitleNode) {
      return;
    }
    const safeVehicleViewState = syncVehicleViewState(vehicleViewState);
    const safeMissionPickerState = normalizeMissionPickerState(missionPickerState, snapshot);
    renderFleetOperations(fleetEntries);
    renderMissionPicker(safeMissionPickerState, snapshot);
    syncLiveViewportFeed();
    syncVehicleOverlay(safeVehicleViewState, snapshot);
    const active = Boolean(launchActive && snapshot);
    if (!snapshot) {
      missionControlSubtitleNode.textContent = "Waiting for telemetry. You can launch when systems are ready.";
      if (missionControlHeaderStatusNode) {
        missionControlHeaderStatusNode.innerHTML = [
          statusChip({ label: "Console", value: "Standby", meta: "Mission Control idle.", tone: "info" }),
          statusChip({ label: "Tracking", value: "Await Telemetry", meta: "Vehicle lock unavailable.", tone: "info" }),
          statusChip({ label: "Flight Rules", value: "Standby", meta: "No active mission.", tone: "info" }),
        ].join("");
      }
      if (missionControlCommandStripNode) {
        missionControlCommandStripNode.innerHTML = [
          commandCard({ label: "Mission", value: "Ready Room", meta: "Awaiting launch profile selection.", tone: "info" }),
          commandCard({ label: "Vehicle", value: "No Active Vehicle", meta: "Console will populate at first telemetry lock.", tone: "info" }),
          commandCard({ label: "Network", value: "Scene Feed Ready", meta: "Tracking video becomes active after selection.", tone: "info" }),
          commandCard({ label: "CAPCOM", value: "No Events", meta: "Terminal timeline will stream launch events here.", tone: "info" }),
        ].join("");
      }
      if (missionControlLiveMetricsNode) {
        missionControlLiveMetricsNode.innerHTML = [
          heroMetric({ label: "Altitude", value: "Standby", detail: "Vehicle not yet committed.", tone: "info" }),
          heroMetric({ label: "Velocity", value: "Standby", detail: "Awaiting live orbital state.", tone: "info" }),
          heroMetric({ label: "Propellant", value: "n/a", detail: "Stage loadout unavailable.", tone: "info" }),
          heroMetric({ label: "Guidance", value: "Standby", detail: "Flight rules will appear here once telemetry is live.", tone: "info" }),
        ].join("");
      }
      if (missionControlSubsystemsNode) {
        missionControlSubsystemsNode.innerHTML = [
          alertCard({
            kicker: "Current Call",
            title: "Standby",
            detail: "Arm a mission profile and launch when the stack is clear.",
            meta: "No active telemetry.",
            tone: "info",
          }),
          alertCard({
            kicker: "Immediate Action",
            title: "Choose Mission",
            detail: "Assignments are armed from the left rail.",
            meta: `Mission launch ${missionLaunchModeDisplay(safeMissionPickerState.missionLaunchMode)} | Tankers ${tankerLaunchModeDisplay(safeMissionPickerState.tankerLaunchMode)}`,
            tone: "nominal",
          }),
          alertCard({
            kicker: "Tracking Watch",
            title: "Scene Feed Ready",
            detail: "The primary view will lock as soon as a tracked vehicle is active.",
            meta: "Starship and booster views arm automatically when available.",
            tone: "info",
          }),
          alertCard({
            kicker: "Latest Event",
            title: "No Recent Event",
            detail: "CAPCOM log is quiet.",
            meta: "Awaiting first mission event.",
            tone: "info",
          }),
        ].join("");
      }
      if (missionControlOverviewNode) {
        missionControlOverviewNode.innerHTML = "";
      }
      missionControlSequenceNode.innerHTML = missionSequenceItem({
        title: "Preflight Go / No-Go",
        note: "No mission in progress.",
        status: "active",
      });
      missionControlEventsNode.innerHTML = "<p class=\"mission-control-events-empty\">No launch events yet.</p>";
      if (missionControlLiveTagTopLeftNode) {
        missionControlLiveTagTopLeftNode.textContent = safeMissionPickerState.selectedMissionId
          ? (safeMissionPickerState.profiles.find((profile) => profile.id === safeMissionPickerState.selectedMissionId)?.name || "MISSION READY")
          : "STANDBY";
      }
      if (missionControlLiveTagTopRightNode) {
        missionControlLiveTagTopRightNode.textContent = missionLaunchModeDisplay(safeMissionPickerState.missionLaunchMode).toUpperCase();
      }
      if (missionControlLiveTagBottomLeftNode) {
        missionControlLiveTagBottomLeftNode.textContent = "NO TRACK";
      }
      if (missionControlLiveTagBottomRightNode) {
        missionControlLiveTagBottomRightNode.textContent = "SELECT MISSION";
      }
      return;
    }

    const phaseLabel = snapshot.phaseLabel || phaseLabelForLaunch(snapshot.phase);
    const stageName = snapshot.stageName || "n/a";
    const missionName = snapshot.missionName || "Mission";
    const missionPhaseKey = String(
      snapshot.missionPhaseDisplay
      || displayMissionPhase(snapshot.missionPhase, snapshot.missionId || "")
      || snapshot.missionPhase
      || "",
    ).trim();
    const missionPhase = humanizeMissionPhase(missionPhaseKey);
    const met = formatDurationSeconds(snapshot.elapsedSeconds);
    const missionEvents = filterMissionControlEvents(launchEventLogEntries, snapshot);
    const missionLastEventSummary = String(
      missionEvents.length > 0
        ? (missionEvents[missionEvents.length - 1]?.name || "")
        : "",
    );
    const refuelFillFraction = clamp(Number(snapshot?.refuelFillFraction) || 0, 0, 1);
    const refuelGoalReady = refuelFillFraction >= 0.88;
    const guidanceBurnRequested = Boolean(snapshot?.guidanceBurnRequested);
    const guidanceRequestedThrottlePct = Number.isFinite(Number(snapshot?.guidanceRequestedThrottle))
      ? Number(snapshot.guidanceRequestedThrottle) * 100
      : Number.NaN;
    const guidanceInertNoPropellant = Boolean(snapshot?.guidanceInertNoPropellant);
    const guidanceInertReason = guidanceInertNoPropellant
      ? (String(snapshot?.guidanceInertReason || "").trim() || "no-propellant-for-guidance-burn")
      : "n/a";
    const fuelBudgetRequiredDeltaVKmS = Number(snapshot?.fuelBudgetRequiredDeltaVKmS);
    const fuelBudgetAvailableDeltaVKmS = Number(snapshot?.fuelBudgetAvailableDeltaVKmS);
    const fuelBudgetMinimumPropellantKg = Number(snapshot?.fuelBudgetMinimumPropellantKg);
    const fuelBudgetAvailablePropellantKg = Number(snapshot?.fuelBudgetAvailablePropellantKg);
    const fuelBudgetMarginKg = Number(snapshot?.fuelBudgetMarginKg);
    const fuelBudgetFeasible = snapshot?.fuelBudgetFeasible === null || snapshot?.fuelBudgetFeasible === undefined
      ? null
      : Boolean(snapshot.fuelBudgetFeasible);
    const throttleCommandPct = Number.isFinite(Number(snapshot?.throttleCommand))
      ? Number(snapshot.throttleCommand) * 100
      : Number.NaN;
    const boosterThrottleCommandPct = Number.isFinite(Number(snapshot?.boosterThrottleCommand))
      ? Number(snapshot.boosterThrottleCommand) * 100
      : Number.NaN;
    const rcsAuthorityPct = Number.isFinite(Number(snapshot?.rcsAuthority))
      ? clamp(Number(snapshot.rcsAuthority), 0, 1) * 100
      : Number.NaN;
    const boosterRcsAuthorityPct = Number.isFinite(Number(snapshot?.boosterRcsAuthority))
      ? clamp(Number(snapshot.boosterRcsAuthority), 0, 1) * 100
      : Number.NaN;
    const rcsJetsLabel = Array.isArray(snapshot?.rcsJets) && snapshot.rcsJets.length > 0
      ? snapshot.rcsJets.join(", ")
      : (snapshot?.rcsActive ? "active (unspecified)" : "n/a");
    const boosterRcsJetsLabel = Array.isArray(snapshot?.boosterRcsJets) && snapshot.boosterRcsJets.length > 0
      ? snapshot.boosterRcsJets.join(", ")
      : (snapshot?.boosterRcsActive ? "active (unspecified)" : "n/a");
    const rcsThrustAxis = snapshot?.rcsThrustAxisKm;
    const rcsThrustAxisLabel = (
      rcsThrustAxis
      && Number.isFinite(Number(rcsThrustAxis.x))
      && Number.isFinite(Number(rcsThrustAxis.y))
      && Number.isFinite(Number(rcsThrustAxis.z))
    )
      ? `${formatNumber(Number(rcsThrustAxis.x), 3)}, ${formatNumber(Number(rcsThrustAxis.y), 3)}, ${formatNumber(Number(rcsThrustAxis.z), 3)}`
      : "n/a";
    const rcsCorrectionForceN = Number(snapshot?.rcsOrbitCorrectionForceN);
    const rcsCorrectionAccelKmS2 = Number(snapshot?.rcsOrbitCorrectionAccelKmS2);
    const transferRateKgS = Number(snapshot?.refuelTransferRateKgS);
    const transferRemainingKg = Number(snapshot?.refuelTransferRemainingKg);
    const vehicleName = String(snapshot.vehicleName || snapshot.bodyId || "Vehicle").trim() || "Vehicle";
    const trackingStatus = safeVehicleViewState.activeView === "booster"
      ? "Booster tracking lock"
      : (safeVehicleViewState.activeView === "starship" ? "Starship tracking lock" : "Observation free-look");
    const targetBodyLabel = String(snapshot.targetBodyName || snapshot.targetBodyId || "").trim() || "n/a";
    const targetTelemetry = resolveSnapshotTargetTelemetry(snapshot);
    const targetDistanceKm = finiteNumberOrNull(targetTelemetry.targetDistanceKm);
    const targetClosingSpeedKmS = finiteNumberOrNull(targetTelemetry.targetClosingSpeedKmS);
    const targetEtaSeconds = finiteNumberOrNull(targetTelemetry.targetEtaSeconds);
    const targetRateLabel = String(targetTelemetry.targetRateLabel || "Closing").trim() || "Closing";
    const targetEtaLabel = String(targetTelemetry.targetEtaLabel || "ETA").trim() || "ETA";
    const flightRules = flightRuleState({
      snapshot,
      guidanceInertNoPropellant,
      guidanceInertReason,
      fuelBudgetFeasible,
    });
    const stagePropellantKg = finiteNumberOrNull(snapshot.stagePropellantKg);
    const thrustMN = finiteNumberOrNull(snapshot.thrustN);
    const throttlePct = finiteNumberOrNull(snapshot.throttle);
    const dynamicPressureKPa = finiteNumberOrNull(snapshot.dynamicPressurePa);
    const spaceWeatherToneValue = spaceWeatherTone(snapshot.spaceWeatherKp);
    const moonWindowWaitSec = finiteNumberOrNull(snapshot.moonDepartureWindowWaitSec);
    const refuelTransferProgress = finiteNumberOrNull(snapshot.refuelTransferProgress);
    const missionSpecificHero = (() => {
      if (
        snapshot.vehicleKind === "tanker"
        || snapshot.refuelTransferActive
        || snapshot.refuelRequiredFlights > 0
        || snapshot.missionPhase === "orbital_refuel"
      ) {
        const transferLabel = snapshot.refuelTransferActive
          ? `Fueling ${Number.isFinite(refuelTransferProgress) ? `${formatNumber(refuelTransferProgress * 100, 1)}%` : ""}`.trim()
          : (snapshot.refuelUndockActive ? "Undocking" : percentString(snapshot.refuelFillFraction));
        const transferDetail = snapshot.refuelTransferActive
          ? `Rate ${Number.isFinite(transferRateKgS) ? `${formatNumber(transferRateKgS, 1)} kg/s` : "n/a"} | Remaining ${Number.isFinite(transferRemainingKg) ? `${formatNumber(transferRemainingKg, 0)} kg` : "n/a"}`
          : `Flights ${Math.max(0, Number(snapshot.refuelCompletedFlights) || 0)}/${Math.max(0, Number(snapshot.refuelRequiredFlights) || 0)} | Window ${snapshot.refuelCanLaunchTanker ? "Open" : "Closed"}`;
        return heroMetric({
          label: "Refuel Ops",
          value: transferLabel || "Standby",
          detail: transferDetail,
          progress: snapshot.refuelTransferActive
            ? refuelTransferProgress
            : clamp(Number(snapshot.refuelFillFraction) || 0, 0, 1),
          tone: snapshot.refuelTransferActive ? "nominal" : (snapshot.refuelCanLaunchTanker ? "caution" : "info"),
        });
      }
      if (snapshot.missionId === "moon_orbit_return") {
        const lunarLabel = snapshot.moonDepartureWindowReady
          ? "Window Ready"
          : (missionPhaseKey === "midcourse" || missionPhaseKey === "lunar_orbit_insertion"
            ? "Lunar Corridor"
            : "Window Pending");
        const lunarDetail = snapshot.moonDepartureWindowReady
          ? `Launch ${Number.isFinite(Number(snapshot.moonDepartureWindowLaunchTimeMs)) ? new Date(Number(snapshot.moonDepartureWindowLaunchTimeMs)).toLocaleTimeString() : "ready now"}`
          : `${Number.isFinite(moonWindowWaitSec) ? `Wait ${formatDurationSeconds(moonWindowWaitSec)}` : "Monitoring"} | Miss ${Number.isFinite(Number(snapshot.moonProjectedMissDistanceKm)) ? `${formatNumber(snapshot.moonProjectedMissDistanceKm, 1)} km` : "n/a"}`;
        return heroMetric({
          label: "Lunar Window",
          value: lunarLabel,
          detail: lunarDetail,
          tone: snapshot.moonDepartureWindowReady ? "nominal" : (flightRules.tone === "critical" ? "critical" : "caution"),
        });
      }
      return heroMetric({
        label: "Fuel Budget",
        value: fuelBudgetFeasible === null ? "n/a" : (fuelBudgetFeasible ? "Feasible" : "Deficit"),
        detail: Number.isFinite(fuelBudgetMarginKg)
          ? `Margin ${formatNumber(fuelBudgetMarginKg, 0)} kg`
          : "No computed budget margin.",
        tone: fuelBudgetFeasible === null ? "info" : (fuelBudgetFeasible ? "nominal" : "critical"),
      });
    })();
    const latestMissionEventEntry = missionEvents.length > 0
      ? missionEvents[missionEvents.length - 1]
      : null;
    const latestEventTimeValue = Date.parse(String(latestMissionEventEntry?.timestampUtc || ""));
    const latestEventTimeLabel = Number.isFinite(latestEventTimeValue)
      ? new Date(latestEventTimeValue).toLocaleTimeString()
      : "--:--:--";
    const immediateActionState = (() => {
      const gateReason = String(snapshot?.missionPhaseGateReason || "").trim();
      if (guidanceInertNoPropellant) {
        return {
          title: "Recover Propellant Margin",
          detail: guidanceInertReason,
          meta: Number.isFinite(fuelBudgetMarginKg) ? `Fuel margin ${formatNumber(fuelBudgetMarginKg, 0)} kg` : "Guidance burn inhibited.",
          tone: "critical",
        };
      }
      if (snapshot.refuelTransferActive) {
        return {
          title: "Maintain Dock Lock",
          detail: `Transfer ${Number.isFinite(refuelTransferProgress) ? `${formatNumber(refuelTransferProgress * 100, 1)}%` : "n/a"} | Rate ${Number.isFinite(transferRateKgS) ? `${formatNumber(transferRateKgS, 1)} kg/s` : "n/a"}`,
          meta: Number.isFinite(transferRemainingKg) ? `${formatNumber(transferRemainingKg, 0)} kg remaining` : "Transfer quantity unavailable.",
          tone: "nominal",
        };
      }
      if (
        snapshot.missionId === "moon_orbit_return"
        && Number.isFinite(moonWindowWaitSec)
        && moonWindowWaitSec > 1
        && (
          missionPhaseKey === "launch"
          || missionPhaseKey === "parking_orbit"
          || missionPhaseKey === "departure_window_wait"
          || missionPhaseKey === "tli_burn"
        )
      ) {
        return {
          title: "Wait For Lunar Window",
          detail: `Best TLI slot in ${formatDurationSeconds(moonWindowWaitSec)}.`,
          meta: Number.isFinite(Number(snapshot.moonDepartureWindowPhaseErrorDeg))
            ? `Phase error ${formatNumber(snapshot.moonDepartureWindowPhaseErrorDeg, 2)} deg`
            : "Window phase error unavailable.",
          tone: flightRules.tone === "critical" ? "critical" : "caution",
        };
      }
      if (gateReason) {
        return {
          title: "Hold Current Phase",
          detail: gateReason,
          meta: `${missionPhase} | ${phaseLabel}`,
          tone: "caution",
        };
      }
      if (guidanceBurnRequested || (throttlePct !== null && throttlePct > 0.01)) {
        return {
          title: "Monitor Active Burn",
          detail: `Throttle ${Number.isFinite(throttlePct) ? `${formatNumber(throttlePct * 100, 1)}%` : "n/a"} | Thrust ${thrustMN !== null ? `${formatNumber(thrustMN / 1_000_000, 3)} MN` : "n/a"}`,
          meta: shortModeLabel(snapshot.guidanceDisplayMode || snapshot.autopilotMode || snapshot.guidanceMode || "n/a"),
          tone: guidanceInertNoPropellant ? "critical" : "nominal",
        };
      }
      if (snapshot.boosterActive && !snapshot.boosterLanded) {
        return {
          title: "Track Booster Recovery",
          detail: String(snapshot.boosterPhase || "Recovery").trim() || "Recovery",
          meta: Number.isFinite(Number(snapshot.boosterAltitudeKm))
            ? `Booster alt ${formatNumber(snapshot.boosterAltitudeKm, 2)} km`
            : "Booster telemetry live.",
          tone: "caution",
        };
      }
      if (snapshot.missionCompleted) {
        return {
          title: "Maintain Orbit Hold",
          detail: "Mission objectives complete. Continue tracking or reset for the next stack.",
          meta: `${missionPhase} | MET ${met}`,
          tone: "nominal",
        };
      }
      return {
        title: "Advance Nominal Timeline",
        detail: `${missionPhase} is stable. Monitor target geometry and sequence progression.`,
        meta: targetBodyLabel !== "n/a"
          ? `Target ${targetBodyLabel}${targetDistanceKm !== null ? ` | ${formatNumber(targetDistanceKm, 1)} km` : ""}`
          : `${phaseLabel} | ${stageName}`,
        tone: "nominal",
      };
    })();
    const trackingWatchState = (() => {
      if (snapshot.missionId === "moon_orbit_return") {
        return {
          title: snapshot.moonDepartureWindowReady ? "Lunar Window Ready" : "Lunar Corridor Watch",
          detail: Number.isFinite(Number(snapshot.moonProjectedMissDistanceKm))
            ? `Miss ${formatNumber(snapshot.moonProjectedMissDistanceKm, 1)} km | Perilune ${Number.isFinite(Number(snapshot.moonProjectedPeriluneAltitudeKm)) ? `${formatNumber(snapshot.moonProjectedPeriluneAltitudeKm, 1)} km` : "n/a"}`
            : "Monitoring Moon transfer geometry.",
          meta: Number.isFinite(Number(snapshot.moonBPlaneErrorKm))
            ? `B-plane ${formatNumber(snapshot.moonBPlaneErrorKm, 1)} km`
            : (Number.isFinite(moonWindowWaitSec) ? `Window wait ${formatDurationSeconds(moonWindowWaitSec)}` : "No lunar watch metric."),
          tone: snapshot.moonDepartureWindowReady ? "nominal" : (flightRules.tone === "critical" ? "critical" : "caution"),
        };
      }
      if (snapshot.refuelTransferActive || snapshot.refuelRequiredFlights > 0 || snapshot.missionPhase === "orbital_refuel") {
        return {
          title: "Refuel Campaign Watch",
          detail: `Flights ${Math.max(0, Number(snapshot.refuelCompletedFlights) || 0)}/${Math.max(0, Number(snapshot.refuelRequiredFlights) || 0)} | Fill ${percentString(snapshot.refuelFillFraction)}`,
          meta: snapshot.refuelCanLaunchTanker ? "Tanker window open." : "Awaiting tanker cadence.",
          tone: snapshot.refuelTransferActive ? "nominal" : "info",
        };
      }
      if (targetBodyLabel !== "n/a") {
        return {
          title: "Target Watch",
          detail: `${targetBodyLabel}${targetDistanceKm !== null ? ` | ${formatNumber(targetDistanceKm, 1)} km` : ""}`,
          meta: targetClosingSpeedKmS !== null
            ? `${targetRateLabel} ${formatNumber(targetClosingSpeedKmS, 4)} km/s${targetEtaSeconds !== null ? ` | ${targetEtaLabel} ${formatDurationSeconds(targetEtaSeconds)}` : ""}`
            : "No closing solution.",
          tone: targetDistanceKm !== null && targetDistanceKm < 5 ? "nominal" : "info",
        };
      }
      return {
        title: "Orbit Watch",
        detail: Number.isFinite(Number(snapshot.apoapsisKm)) || Number.isFinite(Number(snapshot.periapsisKm))
          ? `A ${Number.isFinite(Number(snapshot.apoapsisKm)) ? formatNumber(snapshot.apoapsisKm, 1) : "n/a"} / P ${Number.isFinite(Number(snapshot.periapsisKm)) ? formatNumber(snapshot.periapsisKm, 1) : "n/a"} km`
          : "Orbital solution unavailable.",
        meta: Number.isFinite(Number(snapshot.speedKmS))
          ? `Speed ${formatNumber(snapshot.speedKmS, 4)} km/s`
          : "Speed unavailable.",
        tone: "info",
      };
    })();
    missionControlSubtitleNode.textContent = active
      ? `${missionName} | ${vehicleName} | ${missionPhase} | ${phaseLabel} | MET ${met}`
      : `${missionName} | Last known state ${missionPhase} | MET ${met}`;
    if (missionControlOpsAlertsNode) {
      missionControlOpsAlertsNode.innerHTML = [
        alertCard({
          kicker: "Flight Call",
          title: flightRules.value,
          detail: flightRules.detail,
          meta: `${missionPhase} | ${phaseLabel} | ${stageName}`,
          tone: flightRules.tone,
        }),
        alertCard({
          kicker: "Immediate Action",
          title: immediateActionState.title,
          detail: immediateActionState.detail,
          meta: immediateActionState.meta,
          tone: immediateActionState.tone,
        }),
        alertCard({
          kicker: "Tracking Watch",
          title: trackingWatchState.title,
          detail: trackingWatchState.detail,
          meta: trackingWatchState.meta,
          tone: trackingWatchState.tone,
        }),
        alertCard({
          kicker: "Latest Event",
          title: latestMissionEventEntry
            ? humanizeLaunchEventName(latestMissionEventEntry.name)
            : (lastLaunchEventSummary ? humanizeLaunchEventName(lastLaunchEventSummary) : "No Recent Event"),
          detail: latestMissionEventEntry
            ? (launchEventInlineDetail(latestMissionEventEntry).replace(/^\s*\|\s*/, "") || "Telemetry event captured.")
            : "CAPCOM log is quiet.",
          meta: latestMissionEventEntry ? latestEventTimeLabel : "Awaiting next mission event.",
          tone: latestMissionEventEntry?.level === "error" ? "critical" : (latestMissionEventEntry ? "nominal" : "info"),
        }),
      ].join("");
    }
    if (missionControlLiveTagTopLeftNode) {
      missionControlLiveTagTopLeftNode.textContent = vehicleName.toUpperCase();
    }
    if (missionControlLiveTagTopRightNode) {
      missionControlLiveTagTopRightNode.textContent = `${safeVehicleViewState.activeView === "booster" ? "BOOSTER LOCK" : (safeVehicleViewState.activeView === "starship" ? "STARSHIP LOCK" : "FREE LOOK")} | ${String(flightRules.value || "GO").toUpperCase()}`;
    }
    if (missionControlLiveTagBottomLeftNode) {
      missionControlLiveTagBottomLeftNode.textContent = `MET ${met} | ${stageName.toUpperCase()}`;
    }
    if (missionControlLiveTagBottomRightNode) {
      missionControlLiveTagBottomRightNode.textContent = latestMissionEventEntry
        ? humanizeLaunchEventName(latestMissionEventEntry.name).toUpperCase()
        : (targetBodyLabel !== "n/a" ? `${targetBodyLabel.toUpperCase()} TRACK` : "HUD ACTIVE");
    }

    if (missionControlHeaderStatusNode) {
      missionControlHeaderStatusNode.innerHTML = [
        statusChip({
          label: "Flight Rules",
          value: flightRules.value,
          meta: flightRules.detail,
          tone: flightRules.tone,
        }),
        statusChip({
          label: "Tracking",
          value: vehicleName,
          meta: trackingStatus,
          tone: active ? "nominal" : "info",
        }),
        statusChip({
          label: "Target",
          value: targetBodyLabel,
          meta: targetDistanceKm !== null
            ? `${formatNumber(targetDistanceKm, 1)} km${targetEtaSeconds !== null ? ` | ${targetEtaLabel} ${formatDurationSeconds(targetEtaSeconds)}` : ""}`
            : "No target distance solution.",
          tone: targetDistanceKm !== null && targetDistanceKm < 1 ? "nominal" : "info",
        }),
        statusChip({
          label: "Environment",
          value: Number.isFinite(Number(snapshot.spaceWeatherKp))
            ? `Kp ${formatNumber(snapshot.spaceWeatherKp, 2)}`
            : "No Space Wx",
          meta: dynamicPressureKPa !== null
            ? `Q ${formatNumber(dynamicPressureKPa / 1000, 2)} kPa | ${String(snapshot.spaceWeatherSource || "sim").trim() || "sim"}`
            : "Dynamic pressure unavailable.",
          tone: spaceWeatherToneValue,
        }),
      ].join("");
    }

    if (missionControlCommandStripNode) {
      missionControlCommandStripNode.innerHTML = [
        commandCard({
          label: "Flight Rules",
          value: flightRules.value,
          meta: missionPhase,
          tone: flightRules.tone,
        }),
        commandCard({
          label: "Tracked Vehicle",
          value: vehicleName,
          meta: `${phaseLabel} | ${stageName}`,
          tone: active ? "nominal" : "info",
        }),
        commandCard({
          label: "Mission Clock",
          value: met,
          meta: snapshot.launchSiteName || "Launch Site",
          tone: "info",
        }),
        commandCard({
          label: "Target",
          value: targetBodyLabel,
          meta: targetDistanceKm !== null
            ? `${formatNumber(targetDistanceKm, 1)} km${targetEtaSeconds !== null ? ` | ${targetEtaLabel} ${formatDurationSeconds(targetEtaSeconds)}` : ""}`
            : "No range solution.",
          tone: targetBodyLabel === "n/a" ? "info" : "nominal",
        }),
      ].join("");
    }

    if (missionControlLiveMetricsNode) {
      const propellantValue = stagePropellantKg !== null
        ? `${formatNumber(stagePropellantKg, 0)} kg`
        : percentString(snapshot.refuelFillFraction);
      const propellantDetail = stagePropellantKg !== null
        ? (fuelBudgetMarginKg !== null ? `Fuel margin ${formatNumber(fuelBudgetMarginKg, 0)} kg` : "Stage propellant remaining.")
        : `Refuel fill ${percentString(snapshot.refuelFillFraction)}`;
      missionControlLiveMetricsNode.innerHTML = [
        heroMetric({
          label: "Altitude",
          value: Number.isFinite(Number(snapshot.altitudeKm))
            ? `${formatNumber(snapshot.altitudeKm, 3)} km`
            : "n/a",
          detail: shouldShowTerrainRelativeAltitude(snapshot) && Number.isFinite(Number(snapshot.altitudeAboveTerrainKm))
            ? `AGL ${formatNumber(snapshot.altitudeAboveTerrainKm, 3)} km`
            : "Earth-relative altitude.",
          tone: active ? "nominal" : "info",
        }),
        heroMetric({
          label: "Velocity",
          value: Number.isFinite(Number(snapshot.speedKmS))
            ? `${formatNumber(snapshot.speedKmS, 4)} km/s`
            : "n/a",
          detail: Number.isFinite(Number(snapshot.radialSpeedKmS)) && Number.isFinite(Number(snapshot.tangentialSpeedKmS))
            ? `Rad ${formatNumber(snapshot.radialSpeedKmS, 4)} | Tan ${formatNumber(snapshot.tangentialSpeedKmS, 4)} km/s`
            : "Awaiting orbital velocity split.",
          tone: "info",
        }),
        heroMetric({
          label: "Propellant",
          value: propellantValue,
          detail: propellantDetail,
          tone: fuelBudgetFeasible === false ? "critical" : "info",
          progress: stagePropellantKg !== null && fuelBudgetAvailablePropellantKg > 0
            ? clamp(stagePropellantKg / Math.max(1, fuelBudgetAvailablePropellantKg), 0, 1)
            : clamp(Number(snapshot.refuelFillFraction) || 0, 0, 1),
        }),
        missionSpecificHero,
      ].join("");
    }

    if (missionControlSubsystemsNode) {
      missionControlSubsystemsNode.innerHTML = [
        alertCard({
          kicker: "Current Call",
          title: flightRules.value,
          detail: flightRules.detail,
          meta: `${missionPhase} | ${phaseLabel} | ${stageName}`,
          tone: flightRules.tone,
        }),
        alertCard({
          kicker: "Immediate Action",
          title: immediateActionState.title,
          detail: immediateActionState.detail,
          meta: immediateActionState.meta,
          tone: immediateActionState.tone,
        }),
        alertCard({
          kicker: "Tracking Watch",
          title: trackingWatchState.title,
          detail: trackingWatchState.detail,
          meta: trackingWatchState.meta,
          tone: trackingWatchState.tone,
        }),
        alertCard({
          kicker: "Latest Event",
          title: latestMissionEventEntry
            ? humanizeLaunchEventName(latestMissionEventEntry.name)
            : (lastLaunchEventSummary ? humanizeLaunchEventName(lastLaunchEventSummary) : "No Recent Event"),
          detail: latestMissionEventEntry
            ? (launchEventInlineDetail(latestMissionEventEntry).replace(/^\s*\|\s*/, "") || "Telemetry event captured.")
            : "CAPCOM log is quiet.",
          meta: latestMissionEventEntry ? latestEventTimeLabel : "Awaiting next mission event.",
          tone: latestMissionEventEntry?.level === "error" ? "critical" : (latestMissionEventEntry ? "nominal" : "info"),
        }),
      ].join("");
    }
    if (missionControlOverviewNode) {
      missionControlOverviewNode.innerHTML = "";
    }

    const sequence = focusedMissionSequence(buildMissionSequence(snapshot, missionEvents));
    missionControlSequenceNode.innerHTML = sequence
      .map((step) => missionSequenceItem(step))
      .join("");

    const recentEvents = missionEvents.slice(-6).reverse();
    if (recentEvents.length <= 0) {
      missionControlEventsNode.innerHTML = "<p class=\"mission-control-events-empty\">No launch events yet.</p>";
    } else {
      missionControlEventsNode.innerHTML = recentEvents
        .map((entry) => {
          const parsed = Date.parse(entry.timestampUtc || "");
          const t = Number.isFinite(parsed)
            ? new Date(parsed).toLocaleTimeString()
            : "--:--:--";
          const level = entry.level === "error" ? "ERR" : "EVT";
          const name = humanizeLaunchEventName(entry.name);
          const detail = launchEventInlineDetail(entry).replace(/^\s*\|\s*/, "");
          return eventRow({
            timestamp: t,
            level,
            name,
            detail,
            tone: entry.level === "error" ? "critical" : "nominal",
          });
        })
        .join("");
    }
  }

  function bindControls(onVisibilityChanged) {
    onScreenStateChanged = typeof onVisibilityChanged === "function" ? onVisibilityChanged : null;
    if (launchMissionControlButton && launchMissionControlButton.dataset.bound !== "true") {
      launchMissionControlButton.addEventListener("click", () => {
        setVisible(!visible);
        onScreenStateChanged?.(visible);
      });
      launchMissionControlButton.dataset.bound = "true";
    }
    if (missionControlBackButton && missionControlBackButton.dataset.bound !== "true") {
      missionControlBackButton.addEventListener("click", (event) => {
        event.preventDefault();
        setVisible(false);
        onScreenStateChanged?.(visible);
      });
      missionControlBackButton.dataset.bound = "true";
    }
    if (missionControlViewStarshipButton && missionControlViewStarshipButton.dataset.bound !== "true") {
      missionControlViewStarshipButton.addEventListener("click", (event) => {
        event.preventDefault();
        onSelectVehicleView?.("starship");
        onScreenStateChanged?.(visible);
      });
      missionControlViewStarshipButton.dataset.bound = "true";
    }
    if (missionControlViewBoosterButton && missionControlViewBoosterButton.dataset.bound !== "true") {
      missionControlViewBoosterButton.addEventListener("click", (event) => {
        event.preventDefault();
        onSelectVehicleView?.("booster");
        onScreenStateChanged?.(visible);
      });
      missionControlViewBoosterButton.dataset.bound = "true";
    }
    if (missionControlFleetNode && missionControlFleetNode.dataset.bound !== "true") {
      missionControlFleetNode.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        const button = target.closest("[data-mc-card-id]");
        if (!(button instanceof Element)) {
          return;
        }
        event.preventDefault();
        const bodyId = String(button.getAttribute("data-mc-card-id") || "").trim();
        if (!bodyId) {
          return;
        }
        const selectedEntry = cachedFleetEntries.find((entry) => entry.bodyId === bodyId) || null;
        if (selectedEntry && selectedEntry.selectable === false) {
          return;
        }
        const previousBodyId = selectedFleetBodyId;
        const trackResult = onTrackBody?.(bodyId);
        const accepted = trackResult !== false;
        selectedFleetBodyId = accepted ? bodyId : previousBodyId;
        lastFleetMarkupSignature = "";
        renderFleetOperations(cachedFleetEntries);
        onScreenStateChanged?.(visible);
      });
      missionControlFleetNode.dataset.bound = "true";
    }
    if (missionControlMissionPickerNode && missionControlMissionPickerNode.dataset.bound !== "true") {
      missionControlMissionPickerNode.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        const missionButton = target.closest("[data-mc-mission-id]");
        if (missionButton instanceof Element) {
          event.preventDefault();
          const missionId = String(missionButton.getAttribute("data-mc-mission-id") || "").trim();
          if (missionId) {
            onSelectMission?.(missionId);
            onScreenStateChanged?.(visible);
          }
          return;
        }
        const modeButton = target.closest("[data-mc-mode-group][data-mc-mode-value]");
        if (!(modeButton instanceof Element)) {
          return;
        }
        event.preventDefault();
        const group = String(modeButton.getAttribute("data-mc-mode-group") || "").trim().toLowerCase();
        const modeValue = String(modeButton.getAttribute("data-mc-mode-value") || "").trim().toLowerCase();
        if (group === "tanker") {
          onSelectTankerLaunchMode?.(modeValue);
        } else {
          onSelectMissionLaunchMode?.(modeValue);
        }
        onScreenStateChanged?.(visible);
      });
      missionControlMissionPickerNode.dataset.bound = "true";
    }
    if (!escBound && documentRef?.addEventListener) {
      documentRef.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && visible) {
          event.preventDefault();
          setVisible(false);
          onScreenStateChanged?.(visible);
        }
      });
      escBound = true;
    }
    syncButtonState();
  }

  function disableAndRemove() {
    setVisible(false);
    launchMissionControlButton?.remove();
    missionControlScreenNode?.remove();
  }

  return {
    bindControls,
    disableAndRemove,
    isVisible: () => visible,
    render,
    setVisible,
    syncButtonState,
  };
}
