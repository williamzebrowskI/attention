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
    launch_to_parking: "Launch To Parking Orbit",
    orbital_refuel: "Orbital Refueling",
    tli_burn: "Trans-Lunar Injection Burn",
    coast_to_moon: "Coast To Moon",
    lunar_insertion: "Lunar Insertion Burn",
    lunar_orbit_hold: "Lunar Orbit Hold",
    tei_burn: "Trans-Earth Injection Burn",
    coast_to_earth: "Coast To Earth",
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
  const missionControlOverviewNode = options.missionControlOverviewNode || null;
  const missionControlSequenceNode = options.missionControlSequenceNode || null;
  const missionControlEventsNode = options.missionControlEventsNode || null;
  const missionControlViewStatusNode = options.missionControlViewStatusNode || null;
  const missionControlLiveFeedCanvasNode = options.missionControlLiveFeedCanvasNode
    || missionControlScreenNode?.querySelector?.(".mission-control-live-feed-canvas")
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

  let visible = false;
  let escBound = false;
  let onScreenStateChanged = null;
  let selectedFleetBodyId = "";
  let cachedFleetEntries = [];
  let lastFleetMarkupSignature = "";
  let liveFeedDrawFailed = false;

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
    if (!visible || !missionControlLiveFeedCanvasNode || !liveFeedSourceCanvas || liveFeedDrawFailed) {
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
    let sx = 0;
    let sy = 0;
    let sw = sourceWidth;
    let sh = sourceHeight;
    if (sourceAspect > targetAspect) {
      sw = sourceHeight * targetAspect;
      sx = (sourceWidth - sw) * 0.5;
    } else {
      sh = sourceWidth / targetAspect;
      sy = (sourceHeight - sh) * 0.5;
    }
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(
        liveFeedSourceCanvas,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        targetWidth,
        targetHeight,
      );
    } catch (_error) {
      liveFeedDrawFailed = true;
      missionControlLiveFeedCanvasNode.style.display = "none";
    }
  }

  function missionControlCard(label, value) {
    return `<article class="mission-overview-card"><span class="mission-overview-label">${escapeHtml(label)}</span><span class="mission-overview-value">${escapeHtml(value)}</span></article>`;
  }

  function missionSequenceItem(step) {
    const status = step.status === "completed"
      ? "completed"
      : (step.status === "active" ? "active" : "pending");
    const note = step.note ? `<p class="mission-sequence-note">${escapeHtml(step.note)}</p>` : "";
    return `<li class="mission-sequence-item ${status}"><span class="mission-sequence-marker"></span><div class="mission-sequence-copy"><p class="mission-sequence-title">${escapeHtml(step.title)}</p>${note}</div></li>`;
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

  function buildMissionSequence(snapshot, launchEventLogEntries) {
    const missionId = String(snapshot?.missionId || "earth_orbit_hold");
    const missionPhase = String(snapshot?.missionPhase || "");
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
        "orbital_refuel",
        "tli_burn",
        "coast_to_moon",
        "lunar_insertion",
        "lunar_orbit_hold",
        "tei_burn",
        "coast_to_earth",
        "earth_capture",
        "earth_orbit_hold",
      ];
      const currentRank = phaseOrder.indexOf(missionPhase);
      const moonStages = [
        {
          key: "orbital_refuel",
          title: "Orbital Refueling Campaign",
          note: `Flights ${refuelCompletedFlights}/${refuelRequiredFlights} | Fill ${(refuelFillFraction * 100).toFixed(1)}%`,
        },
        { key: "tli_burn", title: "Trans-Lunar Injection Burn", note: "Raise Earth apogee to lunar transfer corridor." },
        { key: "coast_to_moon", title: "Coast To Moon", note: "Guided cruise and trajectory maintenance." },
        { key: "lunar_insertion", title: "Lunar Orbit Insertion", note: "Capture into lunar gravity well." },
        { key: "lunar_orbit_hold", title: "Lunar Orbit Hold", note: "Complete lunar orbital objective." },
        { key: "tei_burn", title: "Trans-Earth Injection Burn", note: "Depart lunar orbit onto Earth return trajectory." },
        { key: "coast_to_earth", title: "Coast To Earth", note: "Return cruise and Earth approach targeting." },
        { key: "earth_capture", title: "Earth Capture", note: "Recapture into Earth orbit." },
        { key: "earth_orbit_hold", title: "Earth Orbit Hold", note: "Mission return profile achieved." },
      ];
      for (let i = 0; i < moonStages.length; i += 1) {
        const stage = moonStages[i];
        const isCurrent = currentRank === i;
        const isComplete = (
          i === 0
            ? refuelReady
            : (currentRank > i || (i === moonStages.length - 1 && Boolean(snapshot?.missionCompleted)))
        );
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
        entry.guidanceMode || "",
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
        const classes = [
          "mission-control-fleet-card",
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
          `<p class="mission-control-fleet-card-title">${escapeHtml(entry.vehicleName)}</p>`,
          trackingBadge,
          "</div>",
          `<p class="mission-control-fleet-card-line">${escapeHtml(role)} | ${escapeHtml(entry.missionName || "Mission")}</p>`,
          `<p class="mission-control-fleet-card-line">${escapeHtml(phase)} | Stage ${escapeHtml(stage)}</p>`,
          `<p class="mission-control-fleet-card-line">Alt ${escapeHtml(altitudeLine)} | V ${escapeHtml(speedLine)}</p>`,
          `<p class="mission-control-fleet-card-line">Guidance ${escapeHtml(entry.guidanceMode || "n/a")}</p>`,
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

  function setVisible(nextVisible) {
    visible = Boolean(nextVisible);
    if (missionControlScreenNode) {
      missionControlScreenNode.classList.toggle("visible", visible);
      missionControlScreenNode.setAttribute("aria-hidden", visible ? "false" : "true");
    }
    documentRef?.body?.classList?.toggle("mission-control-open", visible);
    syncButtonState();
  }

  function render(snapshot, launchActive, launchEventLogEntries = [], lastLaunchEventSummary = "", vehicleViewState = null, fleetEntries = []) {
    if (!missionControlScreenNode || !missionControlOverviewNode || !missionControlSequenceNode || !missionControlEventsNode || !missionControlSubtitleNode) {
      return;
    }
    const safeVehicleViewState = syncVehicleViewState(vehicleViewState);
    renderFleetOperations(fleetEntries);
    syncLiveViewportFeed();
    syncVehicleOverlay(safeVehicleViewState, snapshot);
    const active = Boolean(launchActive && snapshot);
    if (!snapshot) {
      missionControlSubtitleNode.textContent = "Waiting for telemetry. You can launch when systems are ready.";
      missionControlOverviewNode.innerHTML = missionControlCard("Status", "Standby");
      missionControlSequenceNode.innerHTML = missionSequenceItem({
        title: "Preflight Go / No-Go",
        note: "No mission in progress.",
        status: "active",
      });
      missionControlEventsNode.textContent = "No launch events yet.";
      return;
    }

    const phaseLabel = snapshot.phaseLabel || phaseLabelForLaunch(snapshot.phase);
    const stageName = snapshot.stageName || "n/a";
    const missionName = snapshot.missionName || "Mission";
    const missionPhase = humanizeMissionPhase(snapshot.missionPhase);
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
    missionControlSubtitleNode.textContent = active
      ? `${missionName} | ${missionPhase} | ${phaseLabel} | ${stageName} | MET ${met}`
      : `${missionName} | Last known phase ${missionPhase} | MET ${met}`;

    const overviewCards = [
      ["Mission", missionName],
      ["Mission Phase", missionPhase],
      ["Vehicle Phase", phaseLabel],
      ["Stage", stageName],
      ["MET", met],
      ["Guidance", snapshot.autopilotMode || snapshot.guidanceMode || "n/a"],
      ["Guidance Burn Cmd", guidanceBurnRequested
        ? `Yes (${Number.isFinite(guidanceRequestedThrottlePct) ? `${formatNumber(guidanceRequestedThrottlePct, 1)}%` : "n/a"})`
        : "No"],
      ["Guidance Inert", guidanceInertNoPropellant ? "YES (No Propellant)" : "No"],
      ["Inert Reason", guidanceInertReason],
      ["Altitude", Number.isFinite(Number(snapshot.altitudeKm)) ? `${formatNumber(snapshot.altitudeKm, 3)} km` : "n/a"],
      ["Speed", Number.isFinite(Number(snapshot.speedKmS)) ? `${formatNumber(snapshot.speedKmS, 4)} km/s` : "n/a"],
      ["Apoapsis", Number.isFinite(Number(snapshot.apoapsisKm)) ? `${formatNumber(snapshot.apoapsisKm, 2)} km` : "n/a"],
      ["Periapsis", Number.isFinite(Number(snapshot.periapsisKm)) ? `${formatNumber(snapshot.periapsisKm, 2)} km` : "n/a"],
      ["Thrust", Number.isFinite(Number(snapshot.thrustN)) ? `${formatNumber(Number(snapshot.thrustN) / 1_000_000, 3)} MN` : "n/a"],
      ["Throttle", Number.isFinite(Number(snapshot.throttle)) ? `${formatNumber(Number(snapshot.throttle) * 100, 1)}%` : "n/a"],
      ["Throttle Cmd", Number.isFinite(throttleCommandPct) ? `${formatNumber(throttleCommandPct, 1)}%` : "n/a"],
      ["Dyn Pressure", Number.isFinite(Number(snapshot.dynamicPressurePa)) ? `${formatNumber(Number(snapshot.dynamicPressurePa) / 1000, 2)} kPa` : "n/a"],
      ["Target Body", snapshot.targetBodyName || "n/a"],
      ["Target Distance", Number.isFinite(Number(snapshot.targetDistanceKm)) ? `${formatNumber(snapshot.targetDistanceKm, 1)} km` : "n/a"],
      ["Moon Rel Speed", Number.isFinite(Number(snapshot.moonRelativeSpeedKmS)) ? `${formatNumber(snapshot.moonRelativeSpeedKmS, 4)} km/s` : "n/a"],
      ["Projected Miss", Number.isFinite(Number(snapshot.moonProjectedMissDistanceKm)) ? `${formatNumber(snapshot.moonProjectedMissDistanceKm, 1)} km` : "n/a"],
      ["Perilune Estimate", Number.isFinite(Number(snapshot.moonProjectedPeriluneAltitudeKm)) ? `${formatNumber(snapshot.moonProjectedPeriluneAltitudeKm, 1)} km` : "n/a"],
      ["B-Plane Error", Number.isFinite(Number(snapshot.moonBPlaneErrorKm)) ? `${formatNumber(snapshot.moonBPlaneErrorKm, 1)} km` : "n/a"],
      ["Phase Gate", String(snapshot.missionPhaseGateReason || "").trim() || "n/a"],
      ["Booster", snapshot.boosterPhase || "n/a"],
      ["Booster Fuel", Number.isFinite(Number(snapshot.boosterFuelFraction)) ? `${formatNumber(Number(snapshot.boosterFuelFraction) * 100, 1)}%` : "n/a"],
      ["Refuel Flights", `${Math.max(0, Number(snapshot.refuelCompletedFlights) || 0)} / ${Math.max(0, Number(snapshot.refuelRequiredFlights) || 0)}`],
      ["Refuel Fill", Number.isFinite(Number(snapshot.refuelFillFraction)) ? `${formatNumber(Number(snapshot.refuelFillFraction) * 100, 1)}%` : "n/a"],
      ["Refuel Goal", refuelGoalReady ? "FULL" : "LOW"],
      ["Fuel Budget", fuelBudgetFeasible === null ? "n/a" : (fuelBudgetFeasible ? "Feasible" : "Deficit")],
      ["DV Req / Avail", Number.isFinite(fuelBudgetRequiredDeltaVKmS) && Number.isFinite(fuelBudgetAvailableDeltaVKmS)
        ? `${formatNumber(fuelBudgetRequiredDeltaVKmS, 3)} / ${formatNumber(fuelBudgetAvailableDeltaVKmS, 3)} km/s`
        : "n/a"],
      ["Prop Req / Avail", Number.isFinite(fuelBudgetMinimumPropellantKg) && Number.isFinite(fuelBudgetAvailablePropellantKg)
        ? `${formatNumber(fuelBudgetMinimumPropellantKg, 0)} / ${formatNumber(fuelBudgetAvailablePropellantKg, 0)} kg`
        : "n/a"],
      ["Fuel Margin", Number.isFinite(fuelBudgetMarginKg) ? `${formatNumber(fuelBudgetMarginKg, 0)} kg` : "n/a"],
      ["Space Wx", Number.isFinite(Number(snapshot.spaceWeatherF107)) && Number.isFinite(Number(snapshot.spaceWeatherKp))
        ? `F10.7 ${formatNumber(snapshot.spaceWeatherF107, 1)} sfu | Kp ${formatNumber(snapshot.spaceWeatherKp, 2)}`
        : "n/a"],
      ["Space Wx Src", String(snapshot.spaceWeatherSource || "").trim() || "n/a"],
      ["Tanker Window", snapshot.refuelCanLaunchTanker ? "Open" : "Closed"],
      ["Hot-Stage", snapshot.hotstageActive ? "Active" : (snapshot.hotstageDetachReason ? `Detached (${snapshot.hotstageDetachReason})` : "Inactive")],
      ["RCS", snapshot.rcsActive ? `On (${Number.isFinite(rcsAuthorityPct) ? formatNumber(rcsAuthorityPct, 1) : "n/a"}%)` : "Off"],
      ["RCS Jets", rcsJetsLabel],
      ["RCS Thrust Axis", rcsThrustAxisLabel],
      ["RCS Corr Force", Number.isFinite(rcsCorrectionForceN) ? `${formatNumber(rcsCorrectionForceN / 1000, 2)} kN` : "n/a"],
      ["RCS Corr Accel", Number.isFinite(rcsCorrectionAccelKmS2) ? `${formatNumber(rcsCorrectionAccelKmS2 * 1000, 4)} m/s²` : "n/a"],
      ["Booster Throttle Cmd", Number.isFinite(boosterThrottleCommandPct) ? `${formatNumber(boosterThrottleCommandPct, 1)}%` : "n/a"],
      ["Booster RCS", snapshot.boosterRcsActive ? `On (${Number.isFinite(boosterRcsAuthorityPct) ? formatNumber(boosterRcsAuthorityPct, 1) : "n/a"}%)` : "Off"],
      ["Booster RCS Jets", boosterRcsJetsLabel],
      ["Last Event", missionLastEventSummary
        ? humanizeLaunchEventName(missionLastEventSummary)
        : (lastLaunchEventSummary ? humanizeLaunchEventName(lastLaunchEventSummary) : "n/a")],
    ];
    missionControlOverviewNode.innerHTML = overviewCards
      .map(([label, value]) => missionControlCard(label, value))
      .join("");

    const sequence = buildMissionSequence(snapshot, missionEvents);
    missionControlSequenceNode.innerHTML = sequence
      .map((step) => missionSequenceItem(step))
      .join("");

    const recentEvents = missionEvents.slice(-32).reverse();
    if (recentEvents.length <= 0) {
      missionControlEventsNode.textContent = "No launch events yet.";
    } else {
      missionControlEventsNode.textContent = recentEvents
        .map((entry) => {
          const parsed = Date.parse(entry.timestampUtc || "");
          const t = Number.isFinite(parsed)
            ? new Date(parsed).toLocaleTimeString()
            : "--:--:--";
          const level = entry.level === "error" ? "ERR" : "EVT";
          const name = humanizeLaunchEventName(entry.name);
          const detail = launchEventInlineDetail(entry);
          return `${level} ${t}  ${name}${detail}`;
        })
        .join("\n");
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
