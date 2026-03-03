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
  const missionControlLiveViewportLabelNode = options.missionControlLiveViewportLabelNode
    || missionControlScreenNode?.querySelector?.(".mission-control-live-viewport-label")
    || null;
  const missionControlLiveFeedCanvasNode = options.missionControlLiveFeedCanvasNode
    || missionControlScreenNode?.querySelector?.(".mission-control-live-feed-canvas")
    || null;
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
  let fleetSelectInteracting = false;
  let fleetSelectInteractionUntilMs = 0;
  let lastFleetMarkupSignature = "";
  let liveFeedDrawFailed = false;

  function markFleetSelectInteracting(extraMs = 900) {
    fleetSelectInteracting = true;
    const holdMs = Math.max(120, Number(extraMs) || 0);
    fleetSelectInteractionUntilMs = Date.now() + holdMs;
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
  }

  function syncLiveViewportLabel(vehicleViewState, fleetEntries = []) {
    if (!missionControlLiveViewportLabelNode) {
      return;
    }
    const safeState = normalizeVehicleViewState(vehicleViewState);
    const entries = normalizeFleetEntries(fleetEntries);
    const trackedEntry = entries.find((entry) => entry.tracked) || null;
    const trackedName = trackedEntry?.vehicleName || "";
    const viewMode = safeState.activeView === "booster"
      ? "Booster"
      : (safeState.activeView === "starship" ? "Starship" : "Standby");
    const lockState = safeState.activeView === "none" ? "UNLOCKED" : "LOCKED";
    const trackedLabel = trackedName
      ? `${viewMode} | ${trackedName}`
      : (safeState.activeView === "none" ? "Scene Camera Feed" : viewMode);
    missionControlLiveViewportLabelNode.textContent = `${lockState} | ${trackedLabel}`;
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

  function fleetOptionLabel(entry) {
    const role = fleetRoleLabel(entry);
    const phase = fleetPhaseLabel(entry);
    return `${entry.vehicleName} | ${role} | ${phase}`;
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

    const hasSelected = entries.some((entry) => entry.bodyId === selectedFleetBodyId);
    if (!hasSelected) {
      const trackedEntry = entries.find((entry) => entry.tracked && entry.selectable);
      selectedFleetBodyId = trackedEntry?.bodyId || entries[0].bodyId;
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

    const optionRows = entries
      .map((entry) => {
        const selected = entry.bodyId === selectedFleetBodyId ? " selected" : "";
        return `<option value="${escapeHtml(entry.bodyId)}"${selected}>${escapeHtml(fleetOptionLabel(entry))}</option>`;
      })
      .join("");

    const altitudeLine = Number.isFinite(selectedEntry.altitudeKm)
      ? `${formatNumber(selectedEntry.altitudeKm, 2)} km`
      : "n/a";
    const speedLine = Number.isFinite(selectedEntry.speedKmS)
      ? `${formatNumber(selectedEntry.speedKmS, 4)} km/s`
      : "n/a";
    const stageLine = selectedEntry.stageName || "n/a";
    const phaseLine = fleetPhaseLabel(selectedEntry);
    const roleLine = fleetRoleLabel(selectedEntry);
    const trackLabel = selectedEntry.tracked ? "Tracking" : "Track In Main View";
    const trackClass = selectedEntry.tracked
      ? "mission-control-fleet-track on"
      : "mission-control-fleet-track";
    const trackDisabled = selectedEntry.selectable ? "" : " disabled";
    const markupSignature = entries
      .map((entry) => [
        entry.bodyId,
        entry.vehicleName,
        fleetRoleLabel(entry),
        fleetPhaseLabel(entry),
        entry.tracked ? "1" : "0",
        entry.selectable ? "1" : "0",
      ].join("|"))
      .join("||");
    const liveSignature = `${markupSignature}::selected=${selectedFleetBodyId}`;
    const activeElement = documentRef?.activeElement || null;
    const existingSelect = missionControlFleetNode.querySelector("[data-mc-fleet-select=\"true\"]");
    const selectFocused = Boolean(
      existingSelect
      && (
        activeElement === existingSelect
        || existingSelect.matches?.(":focus")
      ),
    );
    const interactionWindowActive = Date.now() < fleetSelectInteractionUntilMs;
    if ((fleetSelectInteracting || selectFocused || interactionWindowActive) && missionControlFleetNode.childElementCount > 0) {
      return;
    }
    if (liveSignature === lastFleetMarkupSignature && missionControlFleetNode.childElementCount > 0) {
      return;
    }

    missionControlFleetNode.innerHTML = [
      "<div class=\"mission-control-fleet-head\">",
      "<label class=\"mission-control-fleet-label\" for=\"mission-control-fleet-select\">Vehicle</label>",
      `<p class="mission-control-fleet-counts">Primary ${primaryCount} | Mission ${missionCount} | Tanker ${tankerCount}</p>`,
      "</div>",
      "<select id=\"mission-control-fleet-select\" class=\"mission-control-fleet-select\" data-mc-fleet-select=\"true\">",
      optionRows,
      "</select>",
      "<div class=\"mission-control-fleet-summary\">",
      `<p class="mission-control-fleet-summary-title">${escapeHtml(selectedEntry.vehicleName)}</p>`,
      `<p class="mission-control-fleet-summary-line">${escapeHtml(roleLine)} | ${escapeHtml(selectedEntry.missionName || "Mission")}</p>`,
      `<p class="mission-control-fleet-summary-line">${escapeHtml(phaseLine)} | Stage ${escapeHtml(stageLine)}</p>`,
      `<p class="mission-control-fleet-summary-line">Alt ${escapeHtml(altitudeLine)} | V ${escapeHtml(speedLine)}</p>`,
      `<p class="mission-control-fleet-summary-line">Guidance ${escapeHtml(selectedEntry.guidanceMode || "n/a")}</p>`,
      "</div>",
      "<div class=\"mission-control-fleet-actions\">",
      `<button class="${trackClass}" type="button" data-mc-track-id="${escapeHtml(selectedEntry.bodyId)}"${trackDisabled}>${escapeHtml(trackLabel)}</button>`,
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
    syncVehicleViewState(vehicleViewState);
    renderFleetOperations(fleetEntries);
    syncLiveViewportLabel(vehicleViewState, fleetEntries);
    syncLiveViewportFeed();
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
    const refuelFillFraction = clamp(Number(snapshot?.refuelFillFraction) || 0, 0, 1);
    const refuelGoalReady = refuelFillFraction >= 0.88;
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
      ["Altitude", Number.isFinite(Number(snapshot.altitudeKm)) ? `${formatNumber(snapshot.altitudeKm, 3)} km` : "n/a"],
      ["Speed", Number.isFinite(Number(snapshot.speedKmS)) ? `${formatNumber(snapshot.speedKmS, 4)} km/s` : "n/a"],
      ["Apoapsis", Number.isFinite(Number(snapshot.apoapsisKm)) ? `${formatNumber(snapshot.apoapsisKm, 2)} km` : "n/a"],
      ["Periapsis", Number.isFinite(Number(snapshot.periapsisKm)) ? `${formatNumber(snapshot.periapsisKm, 2)} km` : "n/a"],
      ["Thrust", Number.isFinite(Number(snapshot.thrustN)) ? `${formatNumber(Number(snapshot.thrustN) / 1_000_000, 3)} MN` : "n/a"],
      ["Throttle", Number.isFinite(Number(snapshot.throttle)) ? `${formatNumber(Number(snapshot.throttle) * 100, 1)}%` : "n/a"],
      ["Dyn Pressure", Number.isFinite(Number(snapshot.dynamicPressurePa)) ? `${formatNumber(Number(snapshot.dynamicPressurePa) / 1000, 2)} kPa` : "n/a"],
      ["Target Body", snapshot.targetBodyName || "n/a"],
      ["Target Distance", Number.isFinite(Number(snapshot.targetDistanceKm)) ? `${formatNumber(snapshot.targetDistanceKm, 1)} km` : "n/a"],
      ["Booster", snapshot.boosterPhase || "n/a"],
      ["Booster Fuel", Number.isFinite(Number(snapshot.boosterFuelFraction)) ? `${formatNumber(Number(snapshot.boosterFuelFraction) * 100, 1)}%` : "n/a"],
      ["Refuel Flights", `${Math.max(0, Number(snapshot.refuelCompletedFlights) || 0)} / ${Math.max(0, Number(snapshot.refuelRequiredFlights) || 0)}`],
      ["Refuel Fill", Number.isFinite(Number(snapshot.refuelFillFraction)) ? `${formatNumber(Number(snapshot.refuelFillFraction) * 100, 1)}%` : "n/a"],
      ["Refuel Goal", refuelGoalReady ? "FULL" : "LOW"],
      ["Tanker Window", snapshot.refuelCanLaunchTanker ? "Open" : "Closed"],
      ["Hot-Stage", snapshot.hotstageActive ? "Active" : (snapshot.hotstageDetachReason ? `Detached (${snapshot.hotstageDetachReason})` : "Inactive")],
      ["RCS", snapshot.rcsActive ? `On (${formatNumber((Number(snapshot.rcsAuthority) || 0) * 100, 1)}%)` : "Off"],
      ["Last Event", lastLaunchEventSummary ? humanizeLaunchEventName(lastLaunchEventSummary) : "n/a"],
    ];
    missionControlOverviewNode.innerHTML = overviewCards
      .map(([label, value]) => missionControlCard(label, value))
      .join("");

    const sequence = buildMissionSequence(snapshot, launchEventLogEntries);
    missionControlSequenceNode.innerHTML = sequence
      .map((step) => missionSequenceItem(step))
      .join("");

    const recentEvents = launchEventLogEntries.slice(-32).reverse();
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
      missionControlFleetNode.addEventListener("mousedown", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) {
          return;
        }
        if (target.getAttribute("data-mc-fleet-select") !== "true") {
          return;
        }
        markFleetSelectInteracting(1200);
      });
      missionControlFleetNode.addEventListener("keydown", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) {
          return;
        }
        if (target.getAttribute("data-mc-fleet-select") !== "true") {
          return;
        }
        markFleetSelectInteracting(1200);
      });
      missionControlFleetNode.addEventListener("focusin", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) {
          return;
        }
        if (target.getAttribute("data-mc-fleet-select") !== "true") {
          return;
        }
        markFleetSelectInteracting(1200);
      });
      missionControlFleetNode.addEventListener("focusout", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) {
          return;
        }
        if (target.getAttribute("data-mc-fleet-select") !== "true") {
          return;
        }
        fleetSelectInteracting = false;
        fleetSelectInteractionUntilMs = Date.now() + 180;
      });
      missionControlFleetNode.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        const button = target.closest("[data-mc-track-id]");
        if (!(button instanceof Element)) {
          return;
        }
        event.preventDefault();
        const bodyId = String(button.getAttribute("data-mc-track-id") || "").trim();
        if (!bodyId) {
          return;
        }
        selectedFleetBodyId = bodyId;
        onTrackBody?.(bodyId);
        onScreenStateChanged?.(visible);
      });
      missionControlFleetNode.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) {
          return;
        }
        if (target.getAttribute("data-mc-fleet-select") !== "true") {
          return;
        }
        fleetSelectInteracting = false;
        selectedFleetBodyId = String(target.value || "").trim();
        if (!selectedFleetBodyId) {
          return;
        }
        onTrackBody?.(selectedFleetBodyId);
        fleetSelectInteractionUntilMs = 0;
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
