function fallbackEscapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
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
  const missionControlViewStarshipButton = options.missionControlViewStarshipButton || null;
  const missionControlViewBoosterButton = options.missionControlViewBoosterButton || null;
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

  let visible = false;
  let escBound = false;
  let onScreenStateChanged = null;

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
    const parkingReady =
      Number.isFinite(Number(snapshot?.apoapsisKm))
      && Number.isFinite(Number(snapshot?.periapsisKm))
      && Number(snapshot?.apoapsisKm) >= 170
      && Number(snapshot?.periapsisKm) >= 110;
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
          : "Building stable insertion conditions.",
        status: !stageSeparated ? "pending" : (parkingReady ? "completed" : "active"),
      },
    ];

    if (missionId === "moon_orbit_return") {
      const phaseOrder = [
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
        const isComplete = currentRank > i || (i === moonStages.length - 1 && Boolean(snapshot?.missionCompleted));
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

  function setVisible(nextVisible) {
    visible = Boolean(nextVisible);
    if (missionControlScreenNode) {
      missionControlScreenNode.classList.toggle("visible", visible);
      missionControlScreenNode.setAttribute("aria-hidden", visible ? "false" : "true");
    }
    documentRef?.body?.classList?.toggle("mission-control-open", visible);
    syncButtonState();
  }

  function render(snapshot, launchActive, launchEventLogEntries = [], lastLaunchEventSummary = "", vehicleViewState = null) {
    if (!missionControlScreenNode || !missionControlOverviewNode || !missionControlSequenceNode || !missionControlEventsNode || !missionControlSubtitleNode) {
      return;
    }
    syncVehicleViewState(vehicleViewState);
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
