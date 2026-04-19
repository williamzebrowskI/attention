import {
  AXIAL_TILT_DEG,
  ECLIPTIC_OBLIQUITY_DEG,
  ORBIT_VISUAL_PERIOD_HOURS,
  ORBIT_ECCENTRICITY,
  ORBIT_PERIHELION_DEG,
  ROTATION_PERIOD_HOURS,
  ROTATION_SOLAR_DAY_HOURS,
  SPIN_AXIS_EQUATORIAL_DEG,
  ROTATION_TIME_SCALE_OVERRIDE,
  PRIME_MERIDIAN_W_DEG,
  assertOrbitalConfigLock,
} from "./config/orbitalConfig.js";
import {
  fromPerifocalFrame,
  getMoonOrbitalElements,
  getOrbitalSpeedRadPerSecond,
  getRotationPeriodHours,
  inferMeanAnomalyFromRelativeVector,
  normalizeAngle,
  rotateXZ,
  solveKepler,
} from "./physics/celestialPhysics.js";
import { createRigidBodyAttitudeController } from "./physics/rigidBodyAttitude.js";
import { createTidalOverlayController } from "./physics/overlays/tidalOverlay.js";
import { createLagrangeOverlayController } from "./physics/overlays/lagrangeOverlay.js";
import { createEarthAtmosphereController } from "./physics/atmosphere/visualAtmosphere.js";
import {
  createAtmosphereDynamicsController,
  earthAtmosphereSampleUS1976,
} from "./physics/atmosphere/atmosphereDynamics.js";
import { createSpaceWeatherProvider } from "./physics/space_weather/spaceWeatherProvider.js";
import { createEarthEopProvider } from "./physics/dynamics/earthEopProvider.js";
import {
  LUNAR_MASCON_MODEL_ENABLED,
  computeLunarMasconAccelerationKmS2,
} from "./physics/dynamics/lunarMasconModel.js";
import {
  SOLAR_RADIATION_PRESSURE_ENABLED,
  computeSolarRadiationAccelerationKmS2,
  computeSolarShadowTransmittance,
} from "./physics/dynamics/solarRadiationPressure.js";
import {
  EARTH_SOLID_TIDE_ENABLED,
  EARTH_SOLID_TIDE_SOURCE_BODY_IDS,
  computeEarthSolidTidePerturbationKmS2,
} from "./physics/dynamics/earthSolidTideModel.js";
import { computeOblateGravityPerturbationKmS2 } from "./physics/dynamics/oblateGravityPerturbation.js";
import {
  applyEarthOrientationToAxes,
  estimateEarthOrientationParameters,
  setEarthOrientationRuntimeProvider,
} from "./physics/dynamics/earthOrientationModel.js";
import { earthConventionalGravityModel } from "./physics/dynamics/earthGravityModel.js";
import {
  OBLATE_GRAVITY_ENABLED,
  OBLATE_GRAVITY_MODEL,
} from "./physics/config/oblatenessConfig.js";
import { RIGID_BODY_PHYSICAL_CONSTANTS } from "./physics/config/rigidBodyConstants.js";
import {
  LAUNCH_SITE as RUNTIME_LAUNCH_SITE,
  setLaunchSite as setRuntimeLaunchSite,
} from "./physics/launch/launchConfig.js";
import {
  applyInlineBoosterFuelVisuals,
  INLINE_STARSHIP_STACK_TOTAL_HEIGHT_KM,
  applyInlineBoosterManeuverVisuals,
  applyInlineStarshipVisualStage,
  createInlineBoosterVisual,
  createInlineStarshipStackVisual,
  inlineStarshipPhysicalRenderRadiusScene,
} from "./physics/launch/starshipInlineVisual.js";
import {
  createLaunchSiteStructureVisual,
  updateLaunchSiteStructureVisual,
} from "./physics/launch/launchSiteStructures.js?v=20260419l";
import { createLaunchTrajectoryPathController } from "./physics/launch/trajectoryPath.js";
import {
  MOON_ORBIT_INJECT_ALTITUDE_KM,
  MOON_ORBIT_INJECT_BROWSER_LAUNCH_NODE_SAMPLES,
  MOON_ORBIT_INJECT_BROWSER_LAUNCH_SEARCH_PROFILE,
} from "./physics/launch/lunar/constants.js";
import { createMissionControlScreenController } from "./ui/missionControlScreen.js?v=20260419l";
import {
  activeLaunchTelemetryBodyId as activeLaunchTelemetryBodyIdView,
  isLaunchTelemetryVehicleId as isLaunchTelemetryVehicleIdView,
} from "./ui/launchVehicleTelemetryView.js";
import { ensureRuntimeCatalogBody as ensureRuntimeCatalogBodyView } from "./ui/runtimeVehicleRegistry.js";
import { computeLaunchVehicleViewState } from "./ui/launchVehicleViewState.js";
import { createLegendVehicleStatusController } from "./ui/legendVehicleStatus.js";
import { createRefuelTransferVisualController } from "./ui/refuelTransferVisual.js";
import { createLaunchVehicleDeleteController } from "./ui/launchVehicleDeleteController.js";
import { resolveMissionLaunchAction } from "./ui/launchCommandRouting.js";
import {
  spacecraftMinOrbitDistanceScene,
  spacecraftEarthRelativeOrbitAngles,
  spacecraftPreferredCameraDistanceScene,
} from "./ui/spacecraftCameraFraming.js";
import {
  resolveSnapshotControlTelemetry,
  resolveSnapshotTargetTelemetry,
  shouldShowTerrainRelativeAltitude,
} from "./ui/launchTelemetryDisplay.js";

const canvas = document.getElementById("scene");
const infoCard = document.getElementById("planet-info");
const bodyLegend = document.getElementById("body-legend");
const bodyLegendToggleButton = document.getElementById("body-legend-toggle");
const bodyLegendList = document.getElementById("body-legend-list");
const legendBodyHeaderNode = document.querySelector(".legend-body-header");
const legendBodyCountNode = document.getElementById("legend-body-count");
const observationModeSelect = document.getElementById("observation-mode");
const surfaceObserverRow = document.getElementById("surface-observer-row");
const surfaceObserverTargetSelect = document.getElementById("surface-observer-target");
const observationStatusNode = document.getElementById("observation-status");
const observationPanel = document.querySelector(".observation-panel");
const physicsPanel = document.getElementById("physics-panel");
const physicsPanelTitleNode = document.getElementById("physics-panel-title");
const physicsTidalToggleButton = document.getElementById("physics-toggle-tidal");
const physicsLagrangeToggleButton = document.getElementById("physics-toggle-lagrange");
const physicsAtmosphereToggleButton = document.getElementById("physics-toggle-atmosphere");
const physicsOverlayStatusNode = document.getElementById("physics-overlay-status");
const launchControlButton = document.getElementById("launch-control-button");
const launchReturnButton = document.getElementById("launch-return-button");
const launchResetButton = document.getElementById("launch-reset-button");
const launchDeleteButton = document.getElementById("launch-delete-button");
const launchTankerButton = document.getElementById("launch-tanker-button");
const launchMissionControlButton = document.getElementById("launch-mission-control-button");
const missionControlScreenNode = document.getElementById("mission-control-screen");
const missionControlBackButton = document.getElementById("mission-control-back-button");
const missionControlSubtitleNode = document.getElementById("mission-control-subtitle");
const missionControlOverviewNode = document.getElementById("mission-control-overview");
const missionControlSequenceNode = document.getElementById("mission-control-sequence");
const missionControlEventsNode = document.getElementById("mission-control-events");
const missionControlFleetNode = document.getElementById("mission-control-fleet");
const missionControlViewStatusNode = document.getElementById("mission-control-view-status");
const missionControlLiveFeedCanvasNode = document.getElementById("mission-control-live-feed-canvas");
const missionControlViewStarshipButton = document.getElementById("mission-control-view-starship");
const missionControlViewBoosterButton = document.getElementById("mission-control-view-booster");
let launchStatusNode = document.getElementById("launch-status");
let launchDebugNode = document.getElementById("launch-debug");
let launchEventLogNode = document.getElementById("launch-event-log");
let launchMissionControlPanelNode = document.getElementById("launch-mission-control");
let launchMissionControlStatusNode = document.getElementById("launch-mission-control-status");
let launchMissionControlMetricsNode = document.getElementById("launch-mission-metrics");
let launchMissionControlToggleButton = document.getElementById("launch-mission-toggle");
let launchMissionControlCollapsed = false;
let lastMoonOrbitInjectDebugLogSignature = "";
function createMoonOrbitInjectDebugState() {
  return {
    active: false,
    missionId: "",
    launchMode: "",
    phase: "idle",
    detail: "",
    reason: "",
    key: "",
    shipId: "",
    selectedBodyId: "",
    selectedMatches: false,
    dynamicPresent: false,
    visualMounted: false,
    visualVisible: false,
    updatedAtUtc: "",
  };
}

let moonOrbitInjectDebugState = createMoonOrbitInjectDebugState();
const INFO_PANEL_COLLAPSED_STORAGE_KEY = "galaxy_info_panel_collapsed";
const LEGEND_PANEL_COLLAPSED_STORAGE_KEY = "galaxy_legend_panel_collapsed";
const LEGEND_SECTION_COLLAPSED_STORAGE_KEY_PREFIX = "galaxy_legend_section_collapsed_";
const LEGEND_OBSERVATION_SECTION_ID = "observation";
const LEGEND_PHYSICS_SECTION_ID = "physics";
const LEGEND_BODY_LIST_SECTION_ID = "body_list";
const LEGEND_LAUNCH_PANEL_SECTION_ID = "launch_panel";
const LEGEND_LAUNCH_EVENT_LOG_SECTION_ID = "launch_event_log";
let infoPanelCollapsed = false;
let legendPanelCollapsed = false;
let legendBodyListCollapsed = false;
let legendBodyListToggleButton = null;

const missionControlScreenController = createMissionControlScreenController({
  documentRef: document,
  launchMissionControlButton,
  missionControlScreenNode,
  missionControlBackButton,
  missionControlSubtitleNode,
  missionControlOverviewNode,
  missionControlSequenceNode,
  missionControlEventsNode,
  missionControlFleetNode,
  missionControlViewStatusNode,
  missionControlLiveFeedCanvasNode,
  liveFeedSourceCanvas: canvas,
  missionControlViewStarshipButton,
  missionControlViewBoosterButton,
  formatDurationSeconds,
  formatNumber,
  escapeHtml,
  phaseLabelForLaunch,
  onSelectVehicleView: (mode) => {
    focusLegendVehicleView(mode);
  },
  onTrackBody: (bodyId) => {
    return focusManagedTelemetryVehicle(bodyId, true);
  },
  onSelectMission: (missionId) => {
    applyLaunchMissionSelection(missionId);
  },
  onSelectMissionLaunchMode: (mode) => {
    setMissionLaunchModeSelection(mode);
  },
  onSelectTankerLaunchMode: (mode) => {
    setTankerLaunchModeSelection(mode);
  },
});

const INCLUDE_MOONS = true;
const PHYSICS_LOCK_MODE = true;
const SCIENTIFIC_ACCURACY_MODE = true;
const TRUE_SCALE_MODE = true;
const TRUE_SCALE_KM_TO_SCENE = 1 / 700_000;
const DISTANCE_SCALE = TRUE_SCALE_KM_TO_SCENE;
const PLANET_RADIUS_SCALE = TRUE_SCALE_KM_TO_SCENE;
const MOON_RADIUS_SCALE = TRUE_SCALE_KM_TO_SCENE;
const SUN_RADIUS_SCALE = TRUE_SCALE_KM_TO_SCENE;
const ROTATION_SWEEP_DEGREES = 360;
const DETAIL_DISTANCE_MULTIPLIER = 22;
const DETAIL_MIN_DISTANCE = 0.02;
const WS_INTERVAL_SECONDS = SCIENTIFIC_ACCURACY_MODE ? 1 : 5;
// Keep rotational dynamics physically coupled to orbital motion.
const SPIN_TIME_SCALE = 1;
const MOON_SPIN_VISUAL_BOOST = 1;
const ORBIT_TIME_SCALE = 1;
const MIN_PICK_RADIUS = 0.03;
const MIN_PICK_PIXEL_RADIUS = 12;
const MAX_PICK_PIXEL_RADIUS = 96;
const LEGEND_SELECTION_GUARD_MS = 280;
const OVERVIEW_SWITCH_RADIUS = 600;
const SHOW_ORBIT_MARKERS = false;
const ENABLE_SURFACE_DISPLACEMENT = false;
const DETAIL_ANISOTROPY_CAP = 16;
const MIN_VISIBLE_MOON_RATIO = 0.035;
const MAX_VISIBLE_MOON_RATIO = 0.35;
const MIN_VISIBLE_MOON_RENDER_RADIUS = 0.00055;
const MOON_ORBIT_VISUAL_SCALE = SCIENTIFIC_ACCURACY_MODE ? 1 : 5.5;
const EARTH_MOON_VISUAL_DISTANCE_MULTIPLIER = SCIENTIFIC_ACCURACY_MODE ? 1 : 12.0;
const MIN_MOON_PARENT_CLEARANCE = 1.25;
const MIN_PLANET_SUN_CLEARANCE = 0.02;
const TEXTURE_LOAD_TIMEOUT_MS = 3500;
const EARTH_TEXTURE_LOAD_TIMEOUT_MS = 12000;
const SUN_TEXTURE_LOAD_TIMEOUT_MS = 9000;
const PHOTOREAL_BODY_TEXTURE_TIMEOUT_MS = 8000;
const PHOTOREAL_RETRY_LIMIT = 5;
const PHOTOREAL_RETRY_DELAY_MS = 3000;
const FRONTEND_MODULE_VERSION = "20260419l";
const SPACE_WEATHER_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const EARTH_EOP_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REQUIRED_LAUNCH_MISSION_PROFILES = Object.freeze([
  Object.freeze({
    id: "earth_orbit_hold",
    name: "Earth Orbit Hold",
    description: "Launch to Earth orbit and hold station continuously until reset.",
  }),
  Object.freeze({
    id: "orbital_refuel_demo",
    name: "Orbital Refuel Demo",
    description: "Launch to parking orbit, refuel in orbit, undock, then return to Earth orbit hold.",
  }),
  Object.freeze({
    id: "moon_orbit_return",
    name: "Moon Orbit + Return",
    description: "Launch, transfer to Moon, enter lunar orbit, then return to Earth orbit.",
  }),
]);
const LAUNCH_PERSISTENCE_STORAGE_KEY = "galaxy_launch_runtime_v1";
const LAUNCH_PERSISTENCE_SCHEMA_VERSION = 1;
const LAUNCH_PERSISTENCE_MAX_AGE_MS = 1000 * 60 * 60 * 72;
const LAUNCH_PERSISTENCE_SAVE_INTERVAL_MS = 1500;
const ORBIT_PROPAGATION_MAX_SECONDS = 60 * 60 * 24 * 60;
const LIVE_VELOCITY_PROPAGATION_MAX_SECONDS = 60 * 60 * 24 * 365;
const GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 = 6.67430e-20;
const GRAVITY_VECTORS_ENABLED = true;
const GRAVITY_VECTOR_COLOR = 0x63ffd8;
const GRAVITY_VECTOR_MIN_LENGTH = 0.02;
const GRAVITY_VECTOR_MAX_LENGTH = 1.6;
const GRAVITY_VECTOR_BASELINE_MS2 = 0.08;
const HORIZONS_STARTUP_FETCH_ONLY = true;
const N_BODY_ALL_BODIES_MODE = true;
const N_BODY_STATIC_SOURCE_IDS = new Set();
const N_BODY_EXCLUDED_IDS = new Set();
const N_BODY_MAX_FRAME_SECONDS = 20;
const N_BODY_STEP_SECONDS = 2;
const N_BODY_STEP_SECONDS_LAUNCH_ACTIVE = 0.25;
const N_BODY_STEP_SECONDS_LAUNCH_COAST = 0.75;
const N_BODY_STEP_SECONDS_LAUNCH_ORBIT = 1.25;
const N_BODY_MAX_SUBSTEPS_PER_FRAME = 24;
const N_BODY_MAX_INTEGRATION_BUDGET_MS = 8;
const REENTRY_HEAT_COLOR_HEX = 0xff7a1a;
const REENTRY_HEAT_ATMOSPHERE_MAX_KM = 160;
const REENTRY_HEAT_MIN_EFFECT_ALTITUDE_KM = 1.5;
const REENTRY_HEAT_MIN_AGL_KM = 0.6;
const REENTRY_HEAT_Q_START_PA = 1400;
const REENTRY_HEAT_Q_FULL_PA = 82000;
const REENTRY_HEAT_MIN_SPEED_KM_S = 0.55;
const REENTRY_HEAT_SPEED_FULL_KM_S = 7.5;
const REENTRY_HEAT_MIN_DESCENT_KM_S = 0.008;
const REENTRY_HEAT_DESCENT_FULL_KM_S = 1.0;
const REENTRY_HEAT_RISE_RESPONSE = 0.18;
const REENTRY_HEAT_FALL_RESPONSE = 0.09;
const REENTRY_HEAT_MAX_EMISSIVE_DELTA = 0.28;
const LAUNCH_TRAJECTORY_MAX_POINTS = 220_000;
const LAUNCH_TRAJECTORY_MIN_POINT_DISTANCE_KM = 4;
const reentryHeatMaterialBaseState = new WeakMap();
let reentryHeatColor = null;
const RIGID_BODY_ATTITUDE_ENABLED = true;
let LAUNCH_BODY_ID = "earth_launch_vehicle";
let LAUNCH_BOOSTER_BODY_ID = "earth_launch_booster";
let launchFeatureEnabled = true;
let createLaunchControllerFn = null;
let applyStarshipVisualStageFn = null;
let createStarshipStackVisualFn = null;
let starshipPhysicalRenderRadiusSceneFn = null;
let launchModuleLoadError = "";
let spaceWeatherProvider = null;
let earthEopProvider = null;
let environmentForcingSnapshot = null;
const RIGID_BODY_ATTITUDE_IDS = Object.freeze([
  "sun",
  "mercury",
  "venus",
  "earth",
  "moon",
  "mars",
  "phobos",
  "deimos",
  "jupiter",
  "io",
  "europa",
  "ganymede",
  "callisto",
  "amalthea",
  "thebe",
  "adrastea",
  "metis",
  "himalia",
  "elara",
  "pasiphae",
  "sinope",
  "carme",
  "ananke",
  "saturn",
  "mimas",
  "enceladus",
  "tethys",
  "dione",
  "rhea",
  "titan",
  "hyperion",
  "iapetus",
  "phoebe",
  "janus",
  "epimetheus",
  "atlas",
  "prometheus",
  "pandora",
  "pan",
  "uranus",
  "puck",
  "miranda",
  "ariel",
  "umbriel",
  "titania",
  "oberon",
  "cordelia",
  "ophelia",
  "bianca",
  "cressida",
  "juliet",
  "portia",
  "rosalind",
  "belinda",
  "perdita",
  "cupid",
  "mab",
  "neptune",
  "naiad",
  "thalassa",
  "despina",
  "galatea",
  "larissa",
  "proteus",
  "triton",
  "nereid",
  "hippocamp",
  "halimede",
  "sao",
  "laomedeia",
  "psamathe",
  "neso",
]);
const AU_KM = 149_597_870.7;
const EARTH_BOND_ALBEDO = 0.3;
const EARTHSHINE_LAMBERT_FACTOR = 2 / 3;
const LIGHT_MODEL_EXCLUDED_IDS = new Set(["sun"]);
const RINGED_PLANET_IDS = new Set(["jupiter", "saturn", "uranus", "neptune"]);
const PRIME_MERIDIAN_CALIBRATE_FROM_CURRENT_FOR_IDS = new Set(["earth", "moon"]);
const EARTH_TEXTURE_LONGITUDE_OFFSET_DEG = 0;
const MOON_TEXTURE_LONGITUDE_OFFSET_DEG = 0;
const EARTH_LOCATION_MARKER = {
  dotColor: 0x3bff6a,
  glowColor: 0x6cff8d,
};
const DEFAULT_EARTH_LOCATION_COORDS = Object.freeze({
  latitudeDeg: 39.9526,
  longitudeDeg: -75.1652,
});
const GEOLOCATION_OPTIONS = Object.freeze({
  enableHighAccuracy: false,
  maximumAge: 120_000,
  timeout: 12_000,
});
const EARTH_LOCATION_MARKER_HEIGHT_RATIO = 1.015;
const EARTH_LOCATION_MARKER_DOT_RADIUS_RATIO = 0.009;
const EARTH_LOCATION_MARKER_GLOW_SIZE_RATIO = 0.072;
const EARTH_LOCATION_MARKER_PULSE_PERIOD_SECONDS = 6.8;
const EARTH_LOCATION_MARKER_DOT_OPACITY_MIN = 0.46;
const EARTH_LOCATION_MARKER_DOT_OPACITY_MAX = 0.86;
const EARTH_LOCATION_MARKER_GLOW_OPACITY_MIN = 0.28;
const EARTH_LOCATION_MARKER_GLOW_OPACITY_MAX = 0.72;
const SPACECRAFT_WORLD_MARKER_ENABLED = true;
const SPACECRAFT_WORLD_MARKER_PULSE_PERIOD_SECONDS = 2.2;
const SPACECRAFT_WORLD_MARKER_DOT_OPACITY_MIN = 0.62;
const SPACECRAFT_WORLD_MARKER_DOT_OPACITY_MAX = 0.98;
const SPACECRAFT_WORLD_MARKER_GLOW_OPACITY_MIN = 0.02;
const SPACECRAFT_WORLD_MARKER_GLOW_OPACITY_MAX = 0.16;
const SPACECRAFT_WORLD_MARKER_SCALE_MIN = 0.00012;
const SPACECRAFT_WORLD_MARKER_SCALE_MAX = 0.0018;
const SPACECRAFT_WORLD_MARKER_DISTANCE_SCALE = 0.00003;
const SPACECRAFT_WORLD_MARKER_FAR_FADE_MIN = 0.78;
const SPACECRAFT_WORLD_MARKER_TRACKED_FADE = 0.12;
const SPACECRAFT_WORLD_MARKER_COLORS = Object.freeze({
  launchShipDot: 0x7dd8ff,
  launchShipGlow: 0x98ebff,
  boosterDot: 0xffb668,
  boosterGlow: 0xffd7a3,
  tankerDot: 0x58f09b,
  tankerGlow: 0x85ffc2,
  missionDot: 0x7ec8ff,
  missionGlow: 0x9ad8ff,
  defaultDot: 0xffffff,
  defaultGlow: 0xd8e6ff,
});
const OBSERVATION_MODES = Object.freeze({
  BODY_LOCK: "body_lock",
  FREE: "free",
  SURFACE: "surface",
});
const SURFACE_OBSERVER_PRESETS = Object.freeze({
  philadelphia: {
    id: "philadelphia",
    label: "Philadelphia, Earth",
    kind: "surface",
    bodyId: "earth",
    latitudeDeg: 39.9526,
    longitudeDeg: -75.1652,
    altitudeKm: 1.4,
  },
  my_location: {
    id: "my_location",
    label: "My Location (Live)",
    kind: "surface",
    bodyId: "earth",
    latitudeDeg: DEFAULT_EARTH_LOCATION_COORDS.latitudeDeg,
    longitudeDeg: DEFAULT_EARTH_LOCATION_COORDS.longitudeDeg,
    altitudeKm: 1.4,
  },
  iss: {
    id: "iss",
    label: "ISS",
    kind: "orbital",
    bodyId: "earth",
    altitudeKm: 420,
    inclinationDeg: 51.64,
    periodMinutes: 92.68,
    raanDeg: 23,
    phaseDeg: 91,
    epochIso: "2026-01-01T00:00:00Z",
  },
  moon_surface: {
    id: "moon_surface",
    label: "Moon Surface",
    kind: "surface",
    bodyId: "moon",
    latitudeDeg: 2.5,
    longitudeDeg: 23,
    altitudeKm: 1.2,
  },
});
const SURFACE_OBSERVER_PITCH_MIN = rad(-83);
const SURFACE_OBSERVER_PITCH_MAX = rad(83);
const SUN_LIGHT_INTENSITY_TRUE_SCALE = 320_000;
const SUN_LIGHT_INTENSITY_DEFAULT_SCALE = 0.62;
const SUN_LIGHT_SHADOW_FAR_TRUE_SCALE = 12_000;
const SUN_LIGHT_SHADOW_FAR_DEFAULT_SCALE = 500;
const AMBIENT_LIGHT_INTENSITY_TRUE_SCALE = 0.004;
const AMBIENT_LIGHT_INTENSITY_DEFAULT_SCALE = 0.022;
const HEMISPHERE_LIGHT_INTENSITY_TRUE_SCALE = 0.006;
const HEMISPHERE_LIGHT_INTENSITY_DEFAULT_SCALE = 0.03;
const BODY_ECLIPSE_MODEL_ENABLED = true;
const BODY_ECLIPSE_PENUMBRA_GAMMA = 1.0;
const BODY_ECLIPSE_MIN_TRANSMITTANCE = 0.0;
const BODY_ECLIPSE_MAX_OCCLUDERS = 32;
const ORBIT_MIN_DISTANCE_BASE = 0.000002;
const ORBIT_MIN_DISTANCE_ABSOLUTE = 0.00000025;
const ORBIT_MIN_DISTANCE_RADIUS_FACTOR = 1.012;
const SPACECRAFT_MIN_DISTANCE_ABSOLUTE = 0.000000003;
const SPACECRAFT_MIN_DISTANCE_RADIUS_FACTOR = 1.002;
const SPACECRAFT_DEFAULT_FOCUS_DISTANCE_FACTOR = 2.8;
const SPACECRAFT_WHEEL_ZOOM_MULTIPLIER = 1.9;
const MOON_SURFACE_CAMERA_CLEARANCE_KM = 4.0;
const EARTH_SURFACE_CAMERA_CLEARANCE_KM = 1.5;
const EARTH_SURFACE_CAMERA_CLEARANCE_WHEN_SPACECRAFT_SELECTED_KM = 0.005;
const TIDAL_TARGET_CONFIG = Object.freeze([
  Object.freeze({ bodyId: "earth", sourceIds: Object.freeze(["moon", "sun"]) }),
  Object.freeze({ bodyId: "moon", sourceIds: Object.freeze(["earth", "sun"]) }),
]);
const LAGRANGE_SYSTEM_CONFIG = Object.freeze([
  Object.freeze({ id: "sun-earth", primaryId: "sun", secondaryId: "earth", color: 0x6ad8ff }),
  Object.freeze({ id: "earth-moon", primaryId: "earth", secondaryId: "moon", color: 0xffd98b }),
]);

const LOCAL_IMAGE_ROOT = "/static/assets/images";
const LOCAL_PLANET_TEXTURE_ROOT = `${LOCAL_IMAGE_ROOT}/planets/`;
const LOCAL_MOON_TEXTURE_ROOT = `${LOCAL_IMAGE_ROOT}/moons/`;
const LOCAL_RING_TEXTURE_ROOT = `${LOCAL_IMAGE_ROOT}/rings/`;
const LOCAL_META_TEXTURE_ROOT = `${LOCAL_IMAGE_ROOT}/meta/`;
const LOCAL_TEXTURE_ASSET_VERSION = "20260228-local-pack-v2";

function localTexture(relativePath) {
  return `${LOCAL_IMAGE_ROOT}/${relativePath}?v=${LOCAL_TEXTURE_ASSET_VERSION}`;
}

function normalizeLongitudeDeg(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  let lon = value % 360;
  if (lon > 180) {
    lon -= 360;
  } else if (lon < -180) {
    lon += 360;
  }
  return lon;
}

function finiteVectorKm(v) {
  return Boolean(
    v
    && Number.isFinite(Number(v.x))
    && Number.isFinite(Number(v.y))
    && Number.isFinite(Number(v.z)),
  );
}

function vector3Finite(v) {
  return finiteVectorKm(v);
}

function finiteBodyState(state) {
  return Boolean(
    state
    && Number.isFinite(Number(state.massKg))
    && Number(state.massKg) > 0
    && finiteVectorKm(state.position)
    && finiteVectorKm(state.velocity),
  );
}

function finiteAccelerationKmS2(value) {
  if (!finiteVectorKm(value)) {
    return { x: 0, y: 0, z: 0 };
  }
  return {
    x: Number(value.x),
    y: Number(value.y),
    z: Number(value.z),
  };
}

function safeNormalizeSceneDirection(vector, fallback) {
  if (!THREE_NS) {
    return fallback;
  }
  const fallbackVec = (fallback && fallback.isVector3)
    ? fallback.clone()
    : new THREE_NS.Vector3(0, 1, 0);
  if (!vector || !vector.isVector3 || !vector3Finite(vector)) {
    return fallbackVec.normalize();
  }
  const lenSq = vector.lengthSq();
  if (!(lenSq > 1e-18) || !Number.isFinite(lenSq)) {
    return fallbackVec.normalize();
  }
  return vector.clone().multiplyScalar(1 / Math.sqrt(lenSq));
}

function safeQuaternionFromUpAxis(defaultAxis, targetDirection) {
  if (!THREE_NS) {
    return null;
  }
  const safeUp = safeNormalizeSceneDirection(defaultAxis, new THREE_NS.Vector3(0, 1, 0));
  const safeTarget = safeNormalizeSceneDirection(targetDirection, safeUp);
  const quaternion = new THREE_NS.Quaternion().setFromUnitVectors(safeUp, safeTarget);
  if (
    !Number.isFinite(quaternion.x)
    || !Number.isFinite(quaternion.y)
    || !Number.isFinite(quaternion.z)
    || !Number.isFinite(quaternion.w)
  ) {
    quaternion.identity();
  }
  return quaternion;
}

function refuelDockingVisualLockForBody(bodyId, snapshot = null) {
  if (!THREE_NS || !bodyId) {
    return null;
  }
  const guidanceMode = String(snapshot?.guidanceMode || snapshot?.autopilotMode || "").toLowerCase();
  const transferTankerId = String(snapshot?.refuelTransferTankerId || "").trim();
  const transferActive = Boolean(snapshot?.refuelTransferActive);
  const undockActive = Boolean(snapshot?.refuelUndockActive);
  const transferLocked = Boolean(snapshot?.refuelTransferLocked);
  const rcsDockingGuidance = guidanceMode.includes("rcs-dock")
    || guidanceMode.includes("rcs-fuel-lock")
    || guidanceMode.includes("rcs-docked-lock")
    || guidanceMode.includes("rcs-undock");
  if (!transferTankerId || !(transferActive || undockActive || transferLocked || rcsDockingGuidance)) {
    return null;
  }
  const targetBodyId = String(bodyId);
  if (targetBodyId !== LAUNCH_BODY_ID && targetBodyId !== transferTankerId) {
    return null;
  }
  const pairBodyId = targetBodyId === LAUNCH_BODY_ID
    ? transferTankerId
    : LAUNCH_BODY_ID;
  const bodyCoordsKm = runtimeCoordsOrLiveById(targetBodyId);
  const pairCoordsKm = runtimeCoordsOrLiveById(pairBodyId);
  const earthCoordsKm = runtimeCoordsOrLiveById("earth");
  if (!finiteVectorKm(bodyCoordsKm) || !finiteVectorKm(pairCoordsKm) || !finiteVectorKm(earthCoordsKm)) {
    return {
      pairBodyId,
      directionScene: null,
      hardLock: transferActive || transferLocked,
    };
  }
  const sharedUpScene = safeNormalizeSceneDirection(
    new THREE_NS.Vector3(
      (((Number(bodyCoordsKm.x) || 0) + (Number(pairCoordsKm.x) || 0)) * 0.5) - (Number(earthCoordsKm.x) || 0),
      (((Number(bodyCoordsKm.z) || 0) + (Number(pairCoordsKm.z) || 0)) * 0.5) - (Number(earthCoordsKm.z) || 0),
      (((Number(bodyCoordsKm.y) || 0) + (Number(pairCoordsKm.y) || 0)) * 0.5) - (Number(earthCoordsKm.y) || 0),
    ),
    new THREE_NS.Vector3(0, 1, 0),
  );
  return {
    pairBodyId,
    directionScene: sharedUpScene,
    hardLock: transferActive || transferLocked || guidanceMode.includes("rcs-fuel-lock"),
  };
}

function runFrameTaskSafely(taskKey, taskFn) {
  try {
    taskFn();
    return true;
  } catch (error) {
    const now = Date.now();
    const last = lastFrameTaskErrorMsByKey.get(taskKey) || 0;
    if (now - last > 1000) {
      lastFrameTaskErrorMsByKey.set(taskKey, now);
      console.error(`[solar-system] Frame task "${taskKey}" failed:`, error);
    }
    return false;
  }
}

function earthLocationMarkerConfig() {
  return {
    ...EARTH_LOCATION_MARKER,
    latitudeDeg: earthLocationState.latitudeDeg,
    longitudeDeg: earthLocationState.longitudeDeg,
  };
}

function spacecraftWorldMarkerConfig(bodyId = "") {
  const id = String(bodyId || "").trim();
  if (id === LAUNCH_BOOSTER_BODY_ID) {
    return {
      dotColor: SPACECRAFT_WORLD_MARKER_COLORS.boosterDot,
      glowColor: SPACECRAFT_WORLD_MARKER_COLORS.boosterGlow,
    };
  }
  if (id === LAUNCH_BODY_ID) {
    return {
      dotColor: SPACECRAFT_WORLD_MARKER_COLORS.launchShipDot,
      glowColor: SPACECRAFT_WORLD_MARKER_COLORS.launchShipGlow,
    };
  }
  if (id.startsWith("earth_refuel_tanker_")) {
    return {
      dotColor: SPACECRAFT_WORLD_MARKER_COLORS.tankerDot,
      glowColor: SPACECRAFT_WORLD_MARKER_COLORS.tankerGlow,
    };
  }
  if (id.startsWith("earth_mission_ship_")) {
    return {
      dotColor: SPACECRAFT_WORLD_MARKER_COLORS.missionDot,
      glowColor: SPACECRAFT_WORLD_MARKER_COLORS.missionGlow,
    };
  }
  return {
    dotColor: SPACECRAFT_WORLD_MARKER_COLORS.defaultDot,
    glowColor: SPACECRAFT_WORLD_MARKER_COLORS.defaultGlow,
  };
}

function getSurfaceObserverPreset(presetId = observation.surfacePresetId) {
  const base = SURFACE_OBSERVER_PRESETS[presetId];
  if (!base) {
    return null;
  }
  const override = surfaceObserverRuntimeOverrides.get(presetId);
  if (!override) {
    return base;
  }
  return {
    ...base,
    ...override,
  };
}

function updateSurfaceObserverTargetOptionLabel() {
  if (!surfaceObserverTargetSelect) {
    return;
  }
  const option = surfaceObserverTargetSelect.querySelector('option[value="my_location"]');
  if (!option) {
    return;
  }
  option.textContent = earthLocationState.source === "gps"
    ? "My Location (Live)"
    : "My Location (Live • Fallback)";
}

function updateEarthLocationMarkerPosition() {
  if (!THREE_NS) {
    return;
  }
  const earthVisual = bodyVisuals.get("earth");
  const markerGroup = earthVisual?.locationMarker;
  if (!earthVisual || !markerGroup || !(earthVisual.renderRadius > 0)) {
    return;
  }

  const position = latLonToEarthVector(
    earthLocationState.latitudeDeg,
    earthLocationState.longitudeDeg,
    earthVisual.renderRadius * EARTH_LOCATION_MARKER_HEIGHT_RATIO,
  );
  const dot = markerGroup.userData?.dot || null;
  const glow = markerGroup.userData?.glow || null;
  if (dot) {
    dot.position.copy(position);
  }
  if (glow) {
    glow.position.copy(position).multiplyScalar(1.0015);
  }
}

function updateEarthLocationMarkerPulse(nowMs = Date.now()) {
  const earthVisual = bodyVisuals.get("earth");
  const markerGroup = earthVisual?.locationMarker;
  if (!markerGroup) {
    return;
  }
  const dot = markerGroup.userData?.dot || null;
  const glow = markerGroup.userData?.glow || null;
  if (!dot && !glow) {
    return;
  }

  const seconds = nowMs / 1000;
  const phase = (seconds / Math.max(EARTH_LOCATION_MARKER_PULSE_PERIOD_SECONDS, 0.1)) * (Math.PI * 2);
  const wave = (Math.sin(phase) * 0.5) + 0.5;

  if (dot?.material) {
    const dotOpacity =
      EARTH_LOCATION_MARKER_DOT_OPACITY_MIN
      + ((EARTH_LOCATION_MARKER_DOT_OPACITY_MAX - EARTH_LOCATION_MARKER_DOT_OPACITY_MIN) * wave);
    dot.material.opacity = clamp(dotOpacity, 0, 1);
    dot.material.transparent = dot.material.opacity < 0.999;
    dot.material.needsUpdate = true;
  }

  if (glow?.material) {
    const glowOpacity =
      EARTH_LOCATION_MARKER_GLOW_OPACITY_MIN
      + ((EARTH_LOCATION_MARKER_GLOW_OPACITY_MAX - EARTH_LOCATION_MARKER_GLOW_OPACITY_MIN) * wave);
    glow.material.opacity = clamp(glowOpacity, 0, 1);
    const baseGlowSize = Number(markerGroup.userData?.baseGlowSize) || 0;
    if (baseGlowSize > 0) {
      const glowScale = baseGlowSize * (0.94 + (0.10 * wave));
      glow.scale.set(glowScale, glowScale, 1);
    }
  }
}

function updateSpacecraftWorldMarkers(nowMs = Date.now()) {
  if (!THREE_NS || !SPACECRAFT_WORLD_MARKER_ENABLED || !camera?.position) {
    return;
  }
  const seconds = nowMs / 1000;
  const pulsePeriod = Math.max(SPACECRAFT_WORLD_MARKER_PULSE_PERIOD_SECONDS, 0.2);

  for (const visual of bodyVisuals.values()) {
    if (String(visual?.body?.body_type || "").toLowerCase() !== "spacecraft") {
      continue;
    }
    const markerGroup = visual?.spacecraftWorldMarker;
    if (!markerGroup) {
      continue;
    }
    const dot = markerGroup.userData?.dot || null;
    const glow = markerGroup.userData?.glow || null;
    if (!dot || !glow) {
      continue;
    }

    markerGroup.visible = Boolean(visual?.root?.visible);
    if (!markerGroup.visible) {
      continue;
    }

    const rootPos = visual.root?.position;
    if (!rootPos || !vector3Finite(rootPos)) {
      markerGroup.visible = false;
      continue;
    }

    const distanceToCamera = Math.max(0, camera.position.distanceTo(rootPos));
    const scale = clamp(
      distanceToCamera * SPACECRAFT_WORLD_MARKER_DISTANCE_SCALE,
      SPACECRAFT_WORLD_MARKER_SCALE_MIN,
      SPACECRAFT_WORLD_MARKER_SCALE_MAX,
    );
    markerGroup.scale.set(scale, scale, scale);
    const scaleRange = Math.max(1e-6, SPACECRAFT_WORLD_MARKER_SCALE_MAX - SPACECRAFT_WORLD_MARKER_SCALE_MIN);
    const scaleT = clamp(
      (scale - SPACECRAFT_WORLD_MARKER_SCALE_MIN) / scaleRange,
      0,
      1,
    );
    const farFade = SPACECRAFT_WORLD_MARKER_FAR_FADE_MIN
      + ((1 - SPACECRAFT_WORLD_MARKER_FAR_FADE_MIN) * (1 - scaleT));
    const isTrackedSpacecraft = String(selectedId || "") === String(visual?.body?.id || "");
    const trackedFade = isTrackedSpacecraft ? SPACECRAFT_WORLD_MARKER_TRACKED_FADE : 1;
    const intensity = clamp(farFade * trackedFade, 0.08, 1);

    const phaseOffsetSec = Number(markerGroup.userData?.phaseOffsetSec) || 0;
    const cycle = (((seconds + phaseOffsetSec) % pulsePeriod) / pulsePeriod) * (Math.PI * 2);
    const wave = (Math.sin(cycle) * 0.5) + 0.5;

    if (dot.material) {
      const dotOpacity = SPACECRAFT_WORLD_MARKER_DOT_OPACITY_MIN
        + ((SPACECRAFT_WORLD_MARKER_DOT_OPACITY_MAX - SPACECRAFT_WORLD_MARKER_DOT_OPACITY_MIN) * wave);
      dot.material.opacity = clamp(dotOpacity * intensity, 0, 1);
    }
    if (glow.material) {
      const glowOpacity = SPACECRAFT_WORLD_MARKER_GLOW_OPACITY_MIN
        + ((SPACECRAFT_WORLD_MARKER_GLOW_OPACITY_MAX - SPACECRAFT_WORLD_MARKER_GLOW_OPACITY_MIN) * wave);
      glow.material.opacity = clamp(glowOpacity * intensity, 0, 1);
      const glowScale = (0.8 + (wave * 0.18)) * (isTrackedSpacecraft ? 0.8 : 1);
      glow.scale.set(glowScale, glowScale, 1);
    }
  }
}

function setLiveEarthLocation(latitudeDeg, longitudeDeg, source = "gps", accuracyM = null) {
  const lat = clamp(Number(latitudeDeg) || 0, -90, 90);
  const lon = normalizeLongitudeDeg(Number(longitudeDeg) || 0);
  const hasAccuracy = Number.isFinite(Number(accuracyM)) && Number(accuracyM) > 0;
  const safeAccuracyM = hasAccuracy ? Number(accuracyM) : null;
  earthLocationState.latitudeDeg = lat;
  earthLocationState.longitudeDeg = lon;
  earthLocationState.accuracyM = safeAccuracyM;
  earthLocationState.source = source === "gps" ? "gps" : "fallback";

  const label = earthLocationState.source === "gps"
    ? (safeAccuracyM !== null
      ? `My Location, Earth (±${formatNumber(safeAccuracyM, 0)} m)`
      : "My Location, Earth")
    : "My Location (Fallback: Philadelphia)";
  surfaceObserverRuntimeOverrides.set("my_location", {
    latitudeDeg: lat,
    longitudeDeg: lon,
    label,
    altitudeKm: 1.4,
  });
  updateSurfaceObserverTargetOptionLabel();
  updateEarthLocationMarkerPosition();
  updateObservationStatus();
}

function isLiveLocationRequested() {
  return (
    observation.mode === OBSERVATION_MODES.SURFACE
    && observation.surfacePresetId === "my_location"
  );
}

function stopLiveLocationTracking(resetToFallback = true) {
  if (geolocationWatchId !== null && typeof navigator !== "undefined" && navigator.geolocation) {
    navigator.geolocation.clearWatch(geolocationWatchId);
    geolocationWatchId = null;
  }
  geolocationTrackingActive = false;
  if (resetToFallback) {
    setLiveEarthLocation(
      DEFAULT_EARTH_LOCATION_COORDS.latitudeDeg,
      DEFAULT_EARTH_LOCATION_COORDS.longitudeDeg,
      "fallback",
      null,
    );
  }
}

function startLiveLocationTracking() {
  if (geolocationTrackingActive) {
    return;
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    setLiveEarthLocation(
      DEFAULT_EARTH_LOCATION_COORDS.latitudeDeg,
      DEFAULT_EARTH_LOCATION_COORDS.longitudeDeg,
      "fallback",
      null,
    );
    return;
  }

  const onSuccess = (position) => {
    const coords = position?.coords;
    if (!coords) {
      return;
    }
    setLiveEarthLocation(
      Number(coords.latitude),
      Number(coords.longitude),
      "gps",
      Number(coords.accuracy),
    );
  };

  const onError = (error) => {
    console.warn("[location] Browser geolocation unavailable, using fallback:", error);
    setLiveEarthLocation(
      DEFAULT_EARTH_LOCATION_COORDS.latitudeDeg,
      DEFAULT_EARTH_LOCATION_COORDS.longitudeDeg,
      "fallback",
      null,
    );
  };

  try {
    geolocationTrackingActive = true;
    navigator.geolocation.getCurrentPosition(onSuccess, onError, GEOLOCATION_OPTIONS);
    geolocationWatchId = navigator.geolocation.watchPosition(onSuccess, onError, GEOLOCATION_OPTIONS);
  } catch (error) {
    geolocationTrackingActive = false;
    console.warn("[location] Failed to start browser geolocation watch:", error);
    setLiveEarthLocation(
      DEFAULT_EARTH_LOCATION_COORDS.latitudeDeg,
      DEFAULT_EARTH_LOCATION_COORDS.longitudeDeg,
      "fallback",
      null,
    );
  }
}

function syncLiveLocationTrackingState() {
  if (isLiveLocationRequested()) {
    startLiveLocationTracking();
  } else {
    stopLiveLocationTracking(true);
  }
}

const MOON_TEXTURE_OVERRIDES = Object.freeze({
  moon: {
    map: [
      localTexture("moons/moon_8k.jpg"),
    ],
    bump: [localTexture("moons/moon_bump_1k.jpg")],
    bumpScale: 0.065,
  },
});
const EARTH_LOCAL_DAY_MAPS = [
  `${LOCAL_PLANET_TEXTURE_ROOT}earth_day_8k.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`,
];
const VENUS_LOCAL_SURFACE_MAPS = [
  `${LOCAL_PLANET_TEXTURE_ROOT}venus_surface_8k.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`,
];
const EARTH_LOCAL_NIGHT_MAPS = [`${LOCAL_PLANET_TEXTURE_ROOT}earth_night_8k.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`];
const EARTH_LOCAL_CLOUD_MAPS = [`${LOCAL_PLANET_TEXTURE_ROOT}earth_clouds_8k.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`];
const EARTH_LOCAL_NORMAL_MAPS = [`${LOCAL_PLANET_TEXTURE_ROOT}earth_normal_2048.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`];
const EARTH_LOCAL_SPECULAR_MAPS = [`${LOCAL_PLANET_TEXTURE_ROOT}earth_spec_1k.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`];
const SUN_LOCAL_MAPS = [`${LOCAL_PLANET_TEXTURE_ROOT}sun_8k.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`];

const BODY_TEXTURE_CONFIG = {
  sun: {
    map: [...SUN_LOCAL_MAPS],
    emissive: [...SUN_LOCAL_MAPS],
    isSun: true,
    atmosphereColor: 0xffad4d,
  },
  mercury: {
    map: [`${LOCAL_PLANET_TEXTURE_ROOT}mercury_8k.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`],
    bump: [`${LOCAL_PLANET_TEXTURE_ROOT}mercury_bump.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`],
    bumpScale: 0.06,
  },
  venus: {
    map: [...VENUS_LOCAL_SURFACE_MAPS],
    bump: [`${LOCAL_PLANET_TEXTURE_ROOT}venus_bump.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`],
    bumpScale: 0.03,
    clouds: [`${LOCAL_PLANET_TEXTURE_ROOT}venus_atmosphere_4k.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`],
    atmosphereColor: 0xd9ae76,
  },
  earth: {
    map: [...EARTH_LOCAL_DAY_MAPS],
    bump: [`${LOCAL_PLANET_TEXTURE_ROOT}earth_bump_1k.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`],
    specular: [...EARTH_LOCAL_SPECULAR_MAPS],
    normal: [...EARTH_LOCAL_NORMAL_MAPS],
    emissive: [
      ...EARTH_LOCAL_NIGHT_MAPS,
      `${LOCAL_PLANET_TEXTURE_ROOT}earth_lights_2048.png?v=${LOCAL_TEXTURE_ASSET_VERSION}`,
    ],
    clouds: [...EARTH_LOCAL_CLOUD_MAPS],
    bumpScale: 0.035,
    atmosphereColor: 0x4e8ee9,
  },
  mars: {
    map: [`${LOCAL_PLANET_TEXTURE_ROOT}mars_8k.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`],
    bump: [`${LOCAL_PLANET_TEXTURE_ROOT}mars_bump_1k.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`],
    bumpScale: 0.055,
  },
  jupiter: {
    map: [`${LOCAL_PLANET_TEXTURE_ROOT}jupiter_8k.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`],
    ringColor: [`${LOCAL_RING_TEXTURE_ROOT}jupiter_ring_color.png?v=${LOCAL_TEXTURE_ASSET_VERSION}`],
  },
  saturn: {
    map: [`${LOCAL_PLANET_TEXTURE_ROOT}saturn_8k.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`],
    ringColor: [`${LOCAL_RING_TEXTURE_ROOT}saturn_ring_color.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`],
    ringAlpha: [`${LOCAL_RING_TEXTURE_ROOT}saturn_ring_alpha_8k.png?v=${LOCAL_TEXTURE_ASSET_VERSION}`],
  },
  uranus: {
    map: [`${LOCAL_PLANET_TEXTURE_ROOT}uranus_2k.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`],
    ringColor: [`${LOCAL_RING_TEXTURE_ROOT}uranus_ring_color.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`],
  },
  neptune: {
    map: [`${LOCAL_PLANET_TEXTURE_ROOT}neptune_2k.jpg?v=${LOCAL_TEXTURE_ASSET_VERSION}`],
  },
};

const MOON_SURFACE_PROFILES = {
  moon: { low: "#5c5f65", mid: "#989ca4", high: "#d6d8de", contrast: 0.23, terrainStrength: 0.64 },
  phobos: { low: "#5d4a39", mid: "#8e7254", high: "#b49977", contrast: 0.18, terrainStrength: 0.55 },
  deimos: { low: "#6b5a49", mid: "#a48967", high: "#c7ac8b", contrast: 0.16, terrainStrength: 0.52 },
  io: { low: "#7a6224", mid: "#d8b65a", high: "#f4e192", contrast: 0.26, terrainStrength: 0.68 },
  europa: { low: "#7f7468", mid: "#b8ae9d", high: "#ede8dc", contrast: 0.22, terrainStrength: 0.58 },
  ganymede: { low: "#5a5248", mid: "#887b67", high: "#b4a68d", contrast: 0.2, terrainStrength: 0.6 },
  callisto: { low: "#413c37", mid: "#6a6157", high: "#91887b", contrast: 0.22, terrainStrength: 0.64 },
  amalthea: { low: "#5f4534", mid: "#946948", high: "#c9956f", contrast: 0.21, terrainStrength: 0.57 },
  metis: { low: "#5b5149", mid: "#86786a", high: "#c1ad97", contrast: 0.21, terrainStrength: 0.6 },
  adrastea: { low: "#4f4742", mid: "#766c63", high: "#aea092", contrast: 0.22, terrainStrength: 0.62 },
  thebe: { low: "#573f35", mid: "#865e4a", high: "#c08d6d", contrast: 0.24, terrainStrength: 0.64 },
  himalia: { low: "#4e4b47", mid: "#77726b", high: "#a8a095", contrast: 0.21, terrainStrength: 0.58 },
  elara: { low: "#494541", mid: "#6f6963", high: "#9f968d", contrast: 0.22, terrainStrength: 0.6 },
  pasiphae: { low: "#3f3a35", mid: "#62584d", high: "#8f7f6f", contrast: 0.24, terrainStrength: 0.64 },
  sinope: { low: "#4a372d", mid: "#6f5242", high: "#9d775f", contrast: 0.23, terrainStrength: 0.61 },
  carme: { low: "#4c352e", mid: "#735044", high: "#a87360", contrast: 0.23, terrainStrength: 0.62 },
  ananke: { low: "#47433e", mid: "#6d665e", high: "#9b9186", contrast: 0.22, terrainStrength: 0.59 },
  mimas: { low: "#6a6762", mid: "#9d9a94", high: "#d5d2cb", contrast: 0.23, terrainStrength: 0.62 },
  enceladus: { low: "#9da8b3", mid: "#ced8e2", high: "#f3f8ff", contrast: 0.18, terrainStrength: 0.5 },
  tethys: { low: "#8f9398", mid: "#bcc2c9", high: "#eef3fb", contrast: 0.2, terrainStrength: 0.56 },
  dione: { low: "#7e7e80", mid: "#b2b2b1", high: "#ddd8d0", contrast: 0.22, terrainStrength: 0.58 },
  rhea: { low: "#6d6d70", mid: "#9d9ea5", high: "#cbccd2", contrast: 0.19, terrainStrength: 0.57 },
  titan: { low: "#5f4b2e", mid: "#9a7442", high: "#c89a5d", contrast: 0.17, terrainStrength: 0.5 },
  hyperion: { low: "#584b3a", mid: "#8b7559", high: "#bca07f", contrast: 0.24, terrainStrength: 0.66 },
  iapetus: { low: "#2f2e2d", mid: "#7e776d", high: "#d2c9b5", contrast: 0.32, terrainStrength: 0.72 },
  phoebe: { low: "#474748", mid: "#6f7176", high: "#9ca0a8", contrast: 0.2, terrainStrength: 0.6 },
  janus: { low: "#5d5349", mid: "#8c7f70", high: "#baa891", contrast: 0.22, terrainStrength: 0.6 },
  epimetheus: { low: "#675c51", mid: "#968771", high: "#c4b29b", contrast: 0.21, terrainStrength: 0.58 },
  atlas: { low: "#6c5a49", mid: "#9d8368", high: "#d2b18d", contrast: 0.23, terrainStrength: 0.61 },
  prometheus: { low: "#5b4b3b", mid: "#8a7156", high: "#bf9a73", contrast: 0.23, terrainStrength: 0.62 },
  pandora: { low: "#685744", mid: "#977b60", high: "#c7a17a", contrast: 0.22, terrainStrength: 0.6 },
  pan: { low: "#6f5c43", mid: "#a38660", high: "#d1b286", contrast: 0.24, terrainStrength: 0.63 },
  puck: { low: "#62615f", mid: "#91908d", high: "#bfbcb4", contrast: 0.2, terrainStrength: 0.56 },
  miranda: { low: "#646463", mid: "#959690", high: "#c9c7bf", contrast: 0.24, terrainStrength: 0.62 },
  ariel: { low: "#8a8f98", mid: "#b8bec6", high: "#e8edf2", contrast: 0.2, terrainStrength: 0.54 },
  umbriel: { low: "#3e4148", mid: "#646871", high: "#8a8f98", contrast: 0.22, terrainStrength: 0.6 },
  titania: { low: "#6c665f", mid: "#9b9488", high: "#d3cab9", contrast: 0.19, terrainStrength: 0.55 },
  oberon: { low: "#5f5a52", mid: "#8a8378", high: "#beb4a4", contrast: 0.2, terrainStrength: 0.58 },
  cordelia: { low: "#646260", mid: "#96928d", high: "#cbc5bc", contrast: 0.2, terrainStrength: 0.57 },
  ophelia: { low: "#6b6966", mid: "#9b9792", high: "#cdc8be", contrast: 0.2, terrainStrength: 0.56 },
  bianca: { low: "#6f6b65", mid: "#9f9a90", high: "#d4ccc0", contrast: 0.21, terrainStrength: 0.58 },
  cressida: { low: "#5e5a56", mid: "#8c877f", high: "#beb8ad", contrast: 0.22, terrainStrength: 0.6 },
  juliet: { low: "#655f58", mid: "#93897e", high: "#c5b6a2", contrast: 0.22, terrainStrength: 0.61 },
  portia: { low: "#5f5951", mid: "#8b8377", high: "#bbb2a3", contrast: 0.21, terrainStrength: 0.59 },
  rosalind: { low: "#5a5652", mid: "#867f76", high: "#b7aea1", contrast: 0.22, terrainStrength: 0.6 },
  belinda: { low: "#625d56", mid: "#91887d", high: "#c1b39f", contrast: 0.22, terrainStrength: 0.6 },
  perdita: { low: "#706a61", mid: "#9f9689", high: "#cfc4b4", contrast: 0.21, terrainStrength: 0.58 },
  cupid: { low: "#7a7267", mid: "#a99f91", high: "#d7cab7", contrast: 0.21, terrainStrength: 0.57 },
  mab: { low: "#6f6a62", mid: "#9e978c", high: "#cdc4b5", contrast: 0.2, terrainStrength: 0.56 },
  naiad: { low: "#5b6370", mid: "#8993a4", high: "#c0c8d6", contrast: 0.18, terrainStrength: 0.52 },
  thalassa: { low: "#5f6675", mid: "#8e98aa", high: "#c6cfdd", contrast: 0.18, terrainStrength: 0.52 },
  despina: { low: "#626674", mid: "#9299ab", high: "#c6ccda", contrast: 0.18, terrainStrength: 0.53 },
  galatea: { low: "#5d6370", mid: "#8d94a4", high: "#c2cad7", contrast: 0.18, terrainStrength: 0.53 },
  larissa: { low: "#636a79", mid: "#949dad", high: "#c6d0de", contrast: 0.19, terrainStrength: 0.54 },
  proteus: { low: "#575e6d", mid: "#828c9f", high: "#afb9cb", contrast: 0.21, terrainStrength: 0.58 },
  triton: { low: "#8e8f9a", mid: "#bcbec8", high: "#e7e9f0", contrast: 0.21, terrainStrength: 0.59 },
  nereid: { low: "#5e6573", mid: "#8b92a1", high: "#bac1cf", contrast: 0.18, terrainStrength: 0.53 },
  hippocamp: { low: "#626a79", mid: "#9099aa", high: "#c1cad8", contrast: 0.19, terrainStrength: 0.55 },
  halimede: { low: "#4f5666", mid: "#778094", high: "#a4adc2", contrast: 0.22, terrainStrength: 0.6 },
  sao: { low: "#596274", mid: "#848fa4", high: "#b2bed1", contrast: 0.2, terrainStrength: 0.57 },
  laomedeia: { low: "#5c6578", mid: "#8893a8", high: "#b7c2d4", contrast: 0.2, terrainStrength: 0.57 },
  psamathe: { low: "#515a6e", mid: "#79849b", high: "#a8b3c8", contrast: 0.22, terrainStrength: 0.61 },
  neso: { low: "#4c5667", mid: "#737f94", high: "#a2aec1", contrast: 0.22, terrainStrength: 0.61 },
  default: { low: "#6d6e72", mid: "#9fa1a8", high: "#d2d5dd", contrast: 0.2, terrainStrength: 0.58 },
};

const PLANET_SURFACE_PROFILES = {
  sun: { type: "star", low: "#f6a945", mid: "#ffcc73", high: "#fff3cf", contrast: 0.26, terrainStrength: 0.62 },
  mercury: { type: "rocky", low: "#514843", mid: "#8a7f75", high: "#c4b8a8", contrast: 0.22, terrainStrength: 0.7 },
  venus: { type: "rocky", low: "#7c5e3a", mid: "#bd915a", high: "#e8c78c", contrast: 0.18, terrainStrength: 0.5 },
  earth: { type: "rocky", low: "#1f4d78", mid: "#447f54", high: "#d7d7c7", contrast: 0.25, terrainStrength: 0.66 },
  mars: { type: "rocky", low: "#6b3b2e", mid: "#a85f45", high: "#d79a73", contrast: 0.24, terrainStrength: 0.72 },
  jupiter: { type: "gas", low: "#7f5e3e", mid: "#c79666", high: "#e8d2a6", contrast: 0.2, terrainStrength: 0.22 },
  saturn: { type: "gas", low: "#8a754a", mid: "#c2aa6b", high: "#e9dca8", contrast: 0.16, terrainStrength: 0.18 },
  uranus: { type: "gas", low: "#4e8ea1", mid: "#7fc0cf", high: "#b9e7ed", contrast: 0.12, terrainStrength: 0.1 },
  neptune: { type: "gas", low: "#274f9b", mid: "#3d78d5", high: "#8bb5f3", contrast: 0.16, terrainStrength: 0.15 },
  default: { type: "rocky", low: "#5f6167", mid: "#9a9ea8", high: "#d6d9e2", contrast: 0.2, terrainStrength: 0.56 },
};

const atmosphereVertexShader = `
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const atmosphereFragmentShader = `
  uniform vec3 glowColor;
  uniform float coefficient;
  uniform float power;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float dotTerm = clamp(dot(vNormal, viewDirection), -1.0, 1.0);
    float intensity = pow(max(coefficient - dotTerm, 0.0), power);
    gl_FragColor = vec4(glowColor * intensity, intensity);
  }
`;

let THREE_NS = null;
let scene = null;
let camera = null;
let renderer = null;
let raycaster = null;
let pointer = null;
let textureLoader = null;
let sunLight = null;

let bodies = [];
let metaById = new Map();
let positionsById = new Map();
let bodyVisuals = new Map();
let orbitVisuals = new Map();
let legendButtonsById = new Map();
let legendGravityPanelsById = new Map();
let legendGravityToggleButtonsById = new Map();
let legendPlanetAccordionContentById = new Map();
let legendPlanetAccordionTriggerById = new Map();
let legendPlanetAccordionStateById = new Map();
let legendVehicleViewButtonsByKey = {
  starship: null,
  booster: null,
};
let legendLaunchMissionSelect = null;
let stagedLaunchMissionId = "";
let legendMissionLaunchModeSelect = null;
let legendTankerLaunchModeSelect = null;
let legendFleetVehicleSelect = null;
let legendFleetPreviousButton = null;
let legendFleetNextButton = null;
let legendFleetTrackButton = null;
let legendFleetStatusNode = null;
let legendBoosterFuelToggleButton = null;
let legendTrajectoryPathToggleButton = null;
let boosterFuelViewEnabled = false;
let trajectoryPathViewEnabled = false;
let launchVehicleViewPreference = "starship";
let selectedId = null;
let detailBodyId = null;
let textureCache = new Map();
let photorealRetryCount = new Map();
let orbitalStateById = new Map();
let runtimeCoordsKmById = new Map();
let launchSiteStructureVisual = null;
let illuminationById = new Map();
let gravityById = new Map();
let nBodyState = null;
let nBodyStartupSnapshotLoaded = false;
let gravityArrowFocusBodyId = null;
let gravityArrowsLegendActivated = false;
let tidalOverlayController = null;
let lagrangeOverlayController = null;
let earthAtmosphereController = null;
let atmosphereDynamicsController = null;
let launchController = null;
let launchTrajectoryPathController = null;
let lastTrajectorySnapshotElapsedSeconds = null;
let primeMeridianSpinOffsetRadById = new Map();
let rigidBodyAttitudeController = null;
let startupSeedLocked = false;
let suppressCanvasSelectionUntilMs = 0;
let pointerInsideLegend = false;
const bodyEclipseMaterialStates = new Set();
const physicsOverlayState = {
  tidal: false,
  lagrange: false,
  atmosphere: false,
};

let socket = null;
let reconnectTimer = null;
let lastFrameTimestampMs = 0;
let lastInfoRenderMs = 0;
let lastLaunchStatusRenderMs = 0;
let lastNBodyBacklogWarnMs = 0;
let lastNBodyNumericWarnMs = 0;
let lastAnimationLoopErrorMs = 0;
let latestSolarTimestampMs = Date.now();
let lastLaunchPersistenceSaveMs = 0;
let launchPersistenceRestoredFromStorage = false;
let launchPersistenceRestoreAttempted = false;
const lastFrameTaskErrorMsByKey = new Map();
const LAUNCH_EVENT_LOG_MAX_ENTRIES = 500;
const launchEventLogEntries = [];
let lastLaunchEventSummary = "";
let lastLaunchEventTimestampUtc = "";
const legendVehicleStatusController = createLegendVehicleStatusController({
  getLegendButtonsById: () => legendButtonsById,
  getNBodyAllBodiesMode: () => N_BODY_ALL_BODIES_MODE,
  getNBodyStartupSnapshotLoaded: () => nBodyStartupSnapshotLoaded,
  isNBodyDrivenBodyId,
  getLaunchFeatureEnabled: () => launchFeatureEnabled,
  getLaunchController: () => launchController,
  getNBodyState: () => nBodyState,
  getLaunchBodyId: () => LAUNCH_BODY_ID,
});
const refuelTransferVisualController = createRefuelTransferVisualController({
  getThree: () => THREE_NS,
  getScene: () => scene,
  getLaunchFeatureEnabled: () => launchFeatureEnabled,
  getLaunchController: () => launchController,
  getNBodyState: () => nBodyState,
  getBodyVisuals: () => bodyVisuals,
  getLaunchBodyId: () => LAUNCH_BODY_ID,
  clampValue: clamp,
});
const launchVehicleDeleteController = createLaunchVehicleDeleteController({
  launchDeleteButton,
  getLaunchController: () => launchController,
  getNBodyState: () => nBodyState,
  getLaunchModuleLoadError: () => launchModuleLoadError,
  getSelectedId: () => selectedId,
  getLaunchBodyId: () => LAUNCH_BODY_ID,
  getBodies: () => bodies,
  setBodies: (nextBodies) => {
    bodies = Array.isArray(nextBodies) ? nextBodies : [];
  },
  getMetaById: () => metaById,
  getPositionsById: () => positionsById,
  getRuntimeCoordsKmById: () => runtimeCoordsKmById,
  getBodyVisuals: () => bodyVisuals,
  getOrbitVisuals: () => orbitVisuals,
  getOrbitalStateById: () => orbitalStateById,
  getIlluminationById: () => illuminationById,
  getGravityById: () => gravityById,
  getPrimeMeridianSpinOffsetRadById: () => primeMeridianSpinOffsetRadById,
  getDetailBodyId: () => detailBodyId,
  setDetailBodyId: (nextId) => {
    detailBodyId = nextId;
  },
  setSelectedId: (nextId) => {
    selectedId = nextId;
  },
  disposeBodyVisual,
  disposeOrbitVisual,
  rebuildBodyLegend,
  setSelected,
  updateLegendSelection,
  updateLegendGravityArrowIndicators,
  appendLaunchLogEntry,
  updateLaunchStatusPanel,
  updateLaunchControls,
  isDeletableVehicleId: isFleetSpacecraftVisualId,
});

function updateLaunchEventFeed() {
  if (!launchEventLogNode) {
    return;
  }
  const recent = launchEventLogEntries.slice(-8);
  if (recent.length === 0) {
    launchEventLogNode.textContent = "No launch events yet.";
    return;
  }
  launchEventLogNode.textContent = recent
    .map((entry) => {
      const t = entry.timestampUtc ? new Date(entry.timestampUtc).toLocaleTimeString() : "--:--:--";
      return `${entry.level === "error" ? "ERR" : "EVT"} ${t} ${entry.name}`;
    })
    .join("\n");
}

function appendLaunchLogEntry(level, entry) {
  const safeLevel = level === "error" ? "error" : "info";
  const payload = (entry && typeof entry === "object") ? { ...entry } : { detail: String(entry) };
  const name = typeof payload.name === "string" ? payload.name : "launch_event";
  const logEntry = {
    timestampUtc: payload.timestampUtc || new Date().toISOString(),
    level: safeLevel,
    ...payload,
  };
  launchEventLogEntries.push(logEntry);
  if (launchEventLogEntries.length > LAUNCH_EVENT_LOG_MAX_ENTRIES) {
    launchEventLogEntries.splice(0, launchEventLogEntries.length - LAUNCH_EVENT_LOG_MAX_ENTRIES);
  }
  lastLaunchEventSummary = name;
  lastLaunchEventTimestampUtc = logEntry.timestampUtc;
  if (name === "launch_started") {
    setLaunchMissionControlCollapsed(false);
  }
  const highlightEvents = new Set([
    "launch_started",
    "starship_stage_changed",
    "stage_separation_booster_detached",
    "booster_phase_changed",
    "booster_landed",
    "launch_runtime_error",
  ]);
  if (safeLevel === "error") {
    console.error(`[launch:${name}]`, logEntry);
  } else if (highlightEvents.has(name)) {
    console.warn(`[launch:${name}]`, logEntry);
  } else {
    console.log(`[launch:${name}]`, logEntry);
  }
  updateLaunchEventFeed();
}

function isMoonOrbitInjectMissionSelection(missionId, launchMode) {
  return String(missionId || "").trim().toLowerCase() === "moon_orbit_return"
    && String(launchMode || "").trim().toLowerCase() === "orbit_inject";
}

function currentMoonOrbitInjectSolveDebugState() {
  const solve = launchController?.getMoonOrbitInjectSolveState?.();
  return {
    key: String(solve?.key || ""),
    pending: Boolean(solve?.pending),
    error: String(solve?.error || ""),
    source: String(solve?.source || ""),
    pendingStartedAtMs: Number(solve?.pendingStartedAtMs) || 0,
    solutionReady: Boolean(solve?.solutionReady),
    solutionValid: Boolean(solve?.solutionValid),
    corridorAccepted: Boolean(solve?.solutionCorridorAccepted),
  };
}

function currentMoonOrbitInjectDebugSnapshot() {
  const controllerState = currentMoonOrbitInjectSolveDebugState();
  const shipId = String(moonOrbitInjectDebugState.shipId || "").trim();
  const dynamicPresent = shipId ? Boolean(nBodyState?.dynamicBodies?.has?.(shipId)) : false;
  const visual = shipId ? bodyVisuals.get(shipId) : null;
  const visualMounted = Boolean(visual?.root);
  const visualVisible = Boolean(visual?.root?.visible);
  const selectedBodyId = String(selectedId || moonOrbitInjectDebugState.selectedBodyId || "").trim();
  return {
    ...moonOrbitInjectDebugState,
    key: String(moonOrbitInjectDebugState.key || controllerState.key || ""),
    selectedBodyId,
    selectedMatches: shipId ? selectedBodyId === shipId : false,
    dynamicPresent,
    visualMounted,
    visualVisible,
    controller: controllerState,
  };
}

function emitMoonOrbitInjectClientLog(entry) {
  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    return;
  }
  const payload = {
    channel: "moon_orbit_inject",
    timestampUtc: new Date().toISOString(),
    ...(entry && typeof entry === "object" ? entry : {}),
  };
  const signature = JSON.stringify([
    payload.phase || "",
    payload.detail || "",
    payload.reason || "",
    payload.key || "",
    payload.shipId || "",
    payload.controller?.pending ? 1 : 0,
    payload.controller?.source || "",
    payload.controller?.pendingStartedAtMs || 0,
    payload.controller?.solutionReady ? 1 : 0,
    payload.controller?.corridorAccepted ? 1 : 0,
    payload.controller?.error || "",
  ]);
  if (signature === lastMoonOrbitInjectDebugLogSignature) {
    return;
  }
  lastMoonOrbitInjectDebugLogSignature = signature;
  void window.fetch("/api/client-log", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch((error) => {
    console.warn("[launch] Failed to emit Moon orbit inject client log.", error);
  });
}

function renderMoonOrbitInjectDebugState() {
  if (!launchDebugNode) {
    return;
  }
  const debug = currentMoonOrbitInjectDebugSnapshot();
  const selectedMissionId = activeSelectedMissionId();
  const missionLaunchMode = selectedMissionLaunchMode();
  const shouldShow = isMoonOrbitInjectMissionSelection(selectedMissionId, missionLaunchMode)
    || debug.active
    || debug.controller.pending
    || debug.controller.solutionReady
    || Boolean(debug.controller.error);
  if (!shouldShow) {
    launchDebugNode.hidden = true;
    launchDebugNode.textContent = "";
    return;
  }
  const keyLabel = debug.key
    ? debug.key.split("|").slice(0, 3).join(" | ")
    : "n/a";
  const shipLabel = debug.shipId
    ? `${debug.shipId} | dynamic ${debug.dynamicPresent ? "yes" : "no"} | visual ${debug.visualMounted ? (debug.visualVisible ? "visible" : "hidden") : "missing"} | selected ${debug.selectedMatches ? "yes" : "no"}`
    : "none";
  const controllerLabel = `pending ${debug.controller.pending ? "yes" : "no"} | ready ${debug.controller.solutionReady ? "yes" : "no"} | corridor ${debug.controller.corridorAccepted ? "yes" : "no"}${debug.controller.error ? ` | error ${debug.controller.error}` : ""}`;
  const timingLabel = `Timing | source ${debug.controller.source || "n/a"} | profile ${debug.controller.searchProfile || "n/a"} | nodes ${debug.controller.nodeSamples || 0} | pending-start ${debug.controller.pendingStartedAtMs || 0} | last-ms ${debug.controller.lastDurationMs || 0}`;
  const detailParts = [
    debug.phase || "idle",
    debug.detail || "",
    debug.reason ? `reason ${debug.reason}` : "",
    debug.updatedAtUtc ? `updated ${new Date(debug.updatedAtUtc).toLocaleTimeString()}` : "",
  ].filter(Boolean);
  launchDebugNode.hidden = false;
  launchDebugNode.textContent = [
    `Moon Orbit Debug | ${detailParts.join(" | ")}`,
    `Solve | ${controllerLabel}`,
    timingLabel,
    `Key | ${keyLabel}`,
    `Ship | ${shipLabel}`,
  ].join("\n");
}

function updateMoonOrbitInjectDebugState(patch = {}, options = {}) {
  const previous = moonOrbitInjectDebugState;
  if (options.reset) {
    moonOrbitInjectDebugState = createMoonOrbitInjectDebugState();
  }
  const next = {
    ...moonOrbitInjectDebugState,
    ...(patch && typeof patch === "object" ? patch : {}),
  };
  const hasMeaningfulPatch = Boolean(
    next.phase && next.phase !== "idle"
    || next.detail
    || next.reason
    || next.shipId
    || next.key,
  );
  next.active = patch?.active !== undefined ? Boolean(patch.active) : (next.active || hasMeaningfulPatch);
  next.updatedAtUtc = new Date().toISOString();
  moonOrbitInjectDebugState = next;
  const debugSnapshot = currentMoonOrbitInjectDebugSnapshot();
  window.__moonOrbitInjectDebug = debugSnapshot;
  renderMoonOrbitInjectDebugState();
  if (
    previous.phase !== next.phase
    || previous.detail !== next.detail
    || previous.reason !== next.reason
    || previous.key !== next.key
    || previous.shipId !== next.shipId
  ) {
    console.warn("[moon-orbit-inject-debug]", debugSnapshot);
    emitMoonOrbitInjectClientLog(debugSnapshot);
  }
}

function registerLaunchLogDebugHandles() {
  window.__launchEventLog = launchEventLogEntries;
  window.getLaunchEventLog = () => launchEventLogEntries.map((entry) => ({ ...entry }));
  window.clearLaunchEventLog = () => {
    launchEventLogEntries.length = 0;
    lastLaunchEventSummary = "";
    lastLaunchEventTimestampUtc = "";
    updateLaunchEventFeed();
  };
  window.getEnvironmentForcing = () => currentEnvironmentForcingSnapshot();
  window.__moonOrbitInjectDebug = currentMoonOrbitInjectDebugSnapshot();
  window.getMoonOrbitInjectDebug = () => currentMoonOrbitInjectDebugSnapshot();
  window.setEnvironmentForcingScenario = async (scenario = "moderate", forceRefresh = true) => (
    setEnvironmentForcingScenario(scenario, forceRefresh)
  );
}

function launchPersistenceManagedBodyId(bodyId) {
  const id = String(bodyId || "");
  return id === String(LAUNCH_BODY_ID || "")
    || id === String(LAUNCH_BOOSTER_BODY_ID || "")
    || id.startsWith("earth_refuel_tanker_")
    || id.startsWith("earth_mission_ship_");
}

function sanitizeLaunchEventLogEntry(entry, fallbackLevel = "info") {
  const safeEntry = (entry && typeof entry === "object") ? { ...entry } : {};
  const level = String(safeEntry.level || fallbackLevel).toLowerCase() === "error" ? "error" : "info";
  const name = String(safeEntry.name || "launch_event");
  const timestampUtc = String(safeEntry.timestampUtc || new Date().toISOString());
  const payload = {
    ...safeEntry,
    level,
    name,
    timestampUtc,
  };
  return payload;
}

function restoreLaunchEventLogFromPersistence(entries, summary = "", summaryTimestampUtc = "") {
  launchEventLogEntries.length = 0;
  const list = Array.isArray(entries) ? entries : [];
  const maxEntries = Math.min(LAUNCH_EVENT_LOG_MAX_ENTRIES, 300);
  const tail = list.slice(-maxEntries);
  for (let i = 0; i < tail.length; i += 1) {
    launchEventLogEntries.push(sanitizeLaunchEventLogEntry(tail[i]));
  }
  lastLaunchEventSummary = String(summary || "");
  lastLaunchEventTimestampUtc = String(summaryTimestampUtc || "");
  if (!lastLaunchEventSummary && launchEventLogEntries.length > 0) {
    const last = launchEventLogEntries[launchEventLogEntries.length - 1];
    lastLaunchEventSummary = String(last?.name || "");
    lastLaunchEventTimestampUtc = String(last?.timestampUtc || "");
  }
  updateLaunchEventFeed();
}

function clearLaunchPersistenceSnapshot() {
  try {
    window.localStorage?.removeItem(LAUNCH_PERSISTENCE_STORAGE_KEY);
  } catch (_error) {
    // Ignore local storage removal failures.
  }
}

function readLaunchPersistenceSnapshot() {
  try {
    const raw = window.localStorage?.getItem(LAUNCH_PERSISTENCE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== "object") {
      clearLaunchPersistenceSnapshot();
      return null;
    }
    const schemaVersion = Number(payload.schemaVersion);
    if (schemaVersion !== LAUNCH_PERSISTENCE_SCHEMA_VERSION) {
      clearLaunchPersistenceSnapshot();
      return null;
    }
    const savedAtMs = Number(payload.savedAtMs);
    if (
      Number.isFinite(savedAtMs)
      && savedAtMs > 0
      && (Date.now() - savedAtMs) > LAUNCH_PERSISTENCE_MAX_AGE_MS
    ) {
      clearLaunchPersistenceSnapshot();
      return null;
    }
    return payload;
  } catch (_error) {
    clearLaunchPersistenceSnapshot();
    return null;
  }
}

function buildLaunchPersistencePayload(nowMs = Date.now()) {
  if (!launchFeatureEnabled || !launchController || !nBodyState?.initialized) {
    return null;
  }
  const controllerSnapshot = launchController.exportPersistentSnapshot?.(nBodyState, nowMs);
  if (!controllerSnapshot) {
    return null;
  }
  const safeSelectedBodyId = launchPersistenceManagedBodyId(selectedId) ? String(selectedId || "") : "";
  const eventLogTail = launchEventLogEntries.slice(-220).map((entry) => sanitizeLaunchEventLogEntry(entry));
  return {
    schemaVersion: LAUNCH_PERSISTENCE_SCHEMA_VERSION,
    savedAtMs: Math.max(0, Number(nowMs) || Date.now()),
    selectedBodyId: safeSelectedBodyId,
    launchVehicleViewPreference: launchVehicleViewPreference === "booster" ? "booster" : "starship",
    launchEventLogEntries: eventLogTail,
    lastLaunchEventSummary: String(lastLaunchEventSummary || ""),
    lastLaunchEventTimestampUtc: String(lastLaunchEventTimestampUtc || ""),
    controller: controllerSnapshot,
  };
}

function persistLaunchRuntimeState(nowMs = Date.now(), options = {}) {
  if (!launchFeatureEnabled || !launchController || !nBodyState?.initialized) {
    return false;
  }
  const force = options?.force === true;
  if (!force && (nowMs - lastLaunchPersistenceSaveMs) < LAUNCH_PERSISTENCE_SAVE_INTERVAL_MS) {
    return false;
  }
  const payload = buildLaunchPersistencePayload(nowMs);
  if (!payload) {
    return false;
  }
  try {
    window.localStorage?.setItem(LAUNCH_PERSISTENCE_STORAGE_KEY, JSON.stringify(payload));
    lastLaunchPersistenceSaveMs = nowMs;
    return true;
  } catch (error) {
    console.warn("[launch] Failed to persist launch runtime snapshot.", error);
    return false;
  }
}

async function restoreLaunchRuntimeState(nowMs = Date.now()) {
  if (launchPersistenceRestoreAttempted) {
    return launchPersistenceRestoredFromStorage;
  }
  launchPersistenceRestoreAttempted = true;
  if (!launchFeatureEnabled || !launchController || !nBodyState?.initialized) {
    return false;
  }

  const persisted = readLaunchPersistenceSnapshot();
  if (!persisted || !persisted.controller || typeof persisted.controller !== "object") {
    return false;
  }

  const persistedCatalog = Array.isArray(persisted.controller.catalogBodies)
    ? persisted.controller.catalogBodies
    : [];
  for (let i = 0; i < persistedCatalog.length; i += 1) {
    await ensureRuntimeCatalogBody(persistedCatalog[i]);
  }

  const restoreResult = launchController.importPersistentSnapshot?.(nBodyState, persisted.controller, nowMs);
  if (!restoreResult?.applied) {
    clearLaunchPersistenceSnapshot();
    return false;
  }

  const runtimeCatalog = Array.isArray(restoreResult.catalogBodies)
    ? restoreResult.catalogBodies
    : [];
  for (let i = 0; i < runtimeCatalog.length; i += 1) {
    await ensureRuntimeCatalogBody(runtimeCatalog[i]);
  }

  launchVehicleViewPreference = persisted.launchVehicleViewPreference === "booster"
    ? "booster"
    : "starship";
  restoreLaunchEventLogFromPersistence(
    persisted.launchEventLogEntries,
    persisted.lastLaunchEventSummary,
    persisted.lastLaunchEventTimestampUtc,
  );

  const restoredBodyId = String(persisted.selectedBodyId || "").trim();
  if (restoredBodyId && metaById.has(restoredBodyId)) {
    setSelected(restoredBodyId, true);
  } else if (!selectedId || !metaById.has(selectedId)) {
    setSelected(LAUNCH_BODY_ID, false);
  }

  launchPersistenceRestoredFromStorage = true;
  lastLaunchPersistenceSaveMs = nowMs;
  updateLaunchControls();
  updateLaunchStatusPanel(true);
  return true;
}

const orbit = {
  target: null,
  radius: 2200,
  minDistance: ORBIT_MIN_DISTANCE_BASE,
  maxDistance: 14000,
  azimuth: 0.0,
  polar: 1.1,
  minPolar: rad(5),
  maxPolar: rad(175),
  minAzimuth: Number.NEGATIVE_INFINITY,
  maxAzimuth: Number.POSITIVE_INFINITY,
  pointerDown: false,
  dragging: false,
  pointerStartX: 0,
  pointerStartY: 0,
  lastX: 0,
  lastY: 0,
  rotateSpeed: 0.0052,
  wheelSpeed: 0.0042,
};
const observation = {
  mode: OBSERVATION_MODES.BODY_LOCK,
  surfacePresetId: "philadelphia",
  surfaceYaw: 0,
  surfacePitch: rad(2),
  surfaceAltitudeScale: 1,
};
const surfaceObserverRuntimeOverrides = new Map();
const earthLocationState = {
  latitudeDeg: DEFAULT_EARTH_LOCATION_COORDS.latitudeDeg,
  longitudeDeg: DEFAULT_EARTH_LOCATION_COORDS.longitudeDeg,
  accuracyM: null,
  source: "fallback",
};
let geolocationWatchId = null;
let geolocationTrackingActive = false;

window.addEventListener("resize", onResize);
window.addEventListener("beforeunload", () => {
  spaceWeatherProvider?.stop?.();
  earthEopProvider?.stop?.();
  setEarthOrientationRuntimeProvider(null);
  persistLaunchRuntimeState(Date.now(), { force: true });
  stopLiveLocationTracking(false);
});

init().catch((error) => {
  console.error("[solar-system] Initialization failed:", error);
  const reason = String(error?.message || "").trim();
  const details = reason ? ` Details: ${reason}` : "";
  showFatalOverlay(
    `3D renderer failed to initialize.${details}`,
  );
});

async function init() {
  assertPhysicsLockInvariants();
  registerLaunchLogDebugHandles();
  await loadRuntimeConfig();
  setupSpaceWeatherProvider();
  await setupEarthEopProvider();
  if (launchFeatureEnabled) {
    try {
      await loadLaunchFeatureModules();
    } catch (error) {
      launchModuleLoadError = error instanceof Error ? error.message : String(error || "Unknown launch module load error");
      console.warn("[launch] Launch modules failed to load. Launch controls remain visible.", error);
    }
  }
  THREE_NS = await loadThreeModule();
  setupScene(THREE_NS);
  await loadBodyCatalog();
  setupObservationControls();
  syncLiveLocationTrackingState();
  setupPhysicsOverlayControls();
  setupLaunchControls();
  setupLegendInputGuards();
  await loadSnapshot();
  await restoreLaunchRuntimeState(Date.now());
  setupRigidBodyAttitudeModel();
  if (!HORIZONS_STARTUP_FETCH_ONLY) {
    connectWebSocket();
  }
  animate();
}

function setupSpaceWeatherProvider() {
  if (spaceWeatherProvider) {
    return;
  }
  spaceWeatherProvider = createSpaceWeatherProvider({
    refreshIntervalMs: SPACE_WEATHER_REFRESH_INTERVAL_MS,
    onError: (error) => {
      console.warn("[space-weather] Using cached/default values:", error);
    },
  });
  spaceWeatherProvider.start();
}

async function setupEarthEopProvider() {
  if (earthEopProvider) {
    return earthEopProvider;
  }
  earthEopProvider = createEarthEopProvider({
    refreshIntervalMs: EARTH_EOP_REFRESH_INTERVAL_MS,
    onError: (error) => {
      console.warn("[earth-eop] Refresh failed; using cached or analytic Earth orientation fallback:", error);
    },
  });
  setEarthOrientationRuntimeProvider((timestampMs) => (
    earthEopProvider?.sampleOrientation?.(timestampMs) || null
  ));
  await earthEopProvider.refresh();
  return earthEopProvider;
}

function currentSpaceWeatherSnapshot() {
  return spaceWeatherProvider?.snapshot?.() || null;
}

function currentEarthEopSnapshot() {
  return earthEopProvider?.snapshot?.() || null;
}

function earthLatLonFromRelativePositionKm(relativePositionKm, earthAxes) {
  if (!finiteVectorKm(relativePositionKm)) {
    return null;
  }
  const radius = Math.hypot(relativePositionKm.x, relativePositionKm.y, relativePositionKm.z);
  if (!(radius > 1e-9)) {
    return null;
  }
  const pole = finiteVectorKm(earthAxes?.pole)
    ? (normalizeVector3OrNull(earthAxes.pole) || { x: 0, y: 0, z: 1 })
    : { x: 0, y: 0, z: 1 };
  let xAxis = finiteVectorKm(earthAxes?.xAxis)
    ? normalizeVector3OrNull(earthAxes.xAxis)
    : null;
  let yAxis = finiteVectorKm(earthAxes?.yAxis)
    ? normalizeVector3OrNull(earthAxes.yAxis)
    : null;
  if (!xAxis || !yAxis) {
    xAxis = normalizeVector3OrNull({
      x: 1 - (pole.x * pole.x),
      y: -(pole.x * pole.y),
      z: -(pole.x * pole.z),
    }) || { x: 1, y: 0, z: 0 };
    yAxis = normalizeVector3OrNull(crossVector3(pole, xAxis)) || { x: 0, y: 1, z: 0 };
  }

  const unit = {
    x: relativePositionKm.x / radius,
    y: relativePositionKm.y / radius,
    z: relativePositionKm.z / radius,
  };
  const localX = (unit.x * xAxis.x) + (unit.y * xAxis.y) + (unit.z * xAxis.z);
  const localY = (unit.x * yAxis.x) + (unit.y * yAxis.y) + (unit.z * yAxis.z);
  const localZ = clamp((unit.x * pole.x) + (unit.y * pole.y) + (unit.z * pole.z), -1, 1);
  return {
    latitudeDeg: (Math.asin(localZ) * 180) / Math.PI,
    longitudeDeg: (Math.atan2(localY, localX) * 180) / Math.PI,
  };
}

function sampleEarthAtmosphereRuntime(altitudeKm, context = {}) {
  const snapshot = currentSpaceWeatherSnapshot();
  const timestampMs = Number(context?.timestampMs) || Date.now();
  let latitudeDeg = Number(context?.latitudeDeg);
  let longitudeDeg = Number(context?.longitudeDeg);
  if (!Number.isFinite(latitudeDeg) || !Number.isFinite(longitudeDeg)) {
    const relPositionKm = context?.relativePositionKm;
    if (finiteVectorKm(relPositionKm)) {
      const earthAxes = context?.earthAxes || (
        finiteVectorKm(context?.earthPole)
          ? { pole: context.earthPole }
          : null
      );
      const latLon = earthLatLonFromRelativePositionKm(relPositionKm, earthAxes);
      if (latLon) {
        latitudeDeg = latLon.latitudeDeg;
        longitudeDeg = latLon.longitudeDeg;
      }
    }
  }
  const atmosphereOptions = spaceWeatherProvider?.atmosphereOptions?.({
    timestampMs,
    latitudeDeg: Number.isFinite(latitudeDeg) ? latitudeDeg : 0,
    longitudeDeg: Number.isFinite(longitudeDeg) ? longitudeDeg : 0,
  }) || {
    timestampMs,
    latitudeDeg: Number.isFinite(latitudeDeg) ? latitudeDeg : 0,
    longitudeDeg: Number.isFinite(longitudeDeg) ? longitudeDeg : 0,
    f107: Number(snapshot?.f107) || 150,
    f107a: Number(snapshot?.f107a) || Number(snapshot?.f107) || 150,
    kp: Number(snapshot?.kp) || 3,
    kpHistory: Array.isArray(snapshot?.kpHistory) ? snapshot.kpHistory : [],
  };
  return earthAtmosphereSampleUS1976(altitudeKm, atmosphereOptions);
}

async function loadRuntimeConfig() {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Config request failed with ${response.status}`);
    }
    const payload = await response.json();
    const launchFlag = payload?.features?.starship_launch;
    if (typeof launchFlag === "boolean") {
      launchFeatureEnabled = launchFlag;
    }
    const launchSite = payload?.launch_site;
    if (launchSite && typeof launchSite === "object") {
      setRuntimeLaunchSite(launchSite);
    }
    const forcing = payload?.environment_forcing;
    if (forcing && typeof forcing === "object") {
      environmentForcingSnapshot = {
        mode: String(forcing.mode || "").trim(),
        scenario: String(forcing.scenario || "").trim(),
        updatedAtUtc: String(forcing.updated_at_utc || "").trim(),
        profile: forcing.profile && typeof forcing.profile === "object" ? { ...forcing.profile } : null,
      };
    }
  } catch (error) {
    console.warn("[solar-system] Using default runtime config:", error);
  }
  if (!launchFeatureEnabled) {
    launchControlButton?.remove();
    launchReturnButton?.remove();
    launchResetButton?.remove();
  }
}

function currentEnvironmentForcingSnapshot() {
  return environmentForcingSnapshot
    ? {
        ...environmentForcingSnapshot,
        profile: environmentForcingSnapshot.profile ? { ...environmentForcingSnapshot.profile } : null,
      }
    : null;
}

async function setEnvironmentForcingScenario(scenario = "moderate", forceRefresh = true) {
  const scenarioLabel = String(scenario || "").trim().toLowerCase();
  if (!scenarioLabel) {
    throw new Error("scenario is required");
  }
  const query = new URLSearchParams({
    scenario: scenarioLabel,
    force_refresh: forceRefresh ? "true" : "false",
  });
  const response = await fetch(`/api/environment-forcing?${query.toString()}`, {
    method: "POST",
    cache: "no-store",
  });
  if (!response.ok) {
    const message = `environment forcing update failed (${response.status})`;
    throw new Error(message);
  }
  const payload = await response.json();
  environmentForcingSnapshot = {
    mode: String(environmentForcingSnapshot?.mode || "simulated").trim() || "simulated",
    scenario: String(payload?.scenario || scenarioLabel).trim(),
    updatedAtUtc: String(payload?.updated_at_utc || "").trim(),
    profile: payload?.profile && typeof payload.profile === "object" ? { ...payload.profile } : null,
  };
  try {
    await Promise.all([
      spaceWeatherProvider?.refresh?.(),
      earthEopProvider?.refresh?.(),
    ]);
  } catch (error) {
    console.warn("[environment-forcing] refresh after scenario change failed:", error);
  }
  updateInfoOverlay();
  return currentEnvironmentForcingSnapshot();
}

async function loadLaunchFeatureModules() {
  launchModuleLoadError = "";
  let controllerModule = null;
  let visualsModule = null;

  try {
    controllerModule = await import(`./physics/launch/launchController.js?v=${FRONTEND_MODULE_VERSION}`);
  } catch (error) {
    throw new Error(`launchController import failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    visualsModule = await import(`./physics/launch/launchVisuals.js?v=${FRONTEND_MODULE_VERSION}`);
  } catch (error) {
    console.warn("[launch] launchVisuals module unavailable, using basic launch visuals.", error);
  }

  if (typeof controllerModule?.LAUNCH_BODY_ID === "string" && controllerModule.LAUNCH_BODY_ID) {
    LAUNCH_BODY_ID = controllerModule.LAUNCH_BODY_ID;
  }
  if (typeof controllerModule?.LAUNCH_BOOSTER_BODY_ID === "string" && controllerModule.LAUNCH_BOOSTER_BODY_ID) {
    LAUNCH_BOOSTER_BODY_ID = controllerModule.LAUNCH_BOOSTER_BODY_ID;
  }
  createLaunchControllerFn = controllerModule?.createLaunchController || null;
  applyStarshipVisualStageFn = visualsModule?.applyStarshipVisualStage || null;
  createStarshipStackVisualFn = visualsModule?.createStarshipStackVisual || null;
  starshipPhysicalRenderRadiusSceneFn = visualsModule?.starshipPhysicalRenderRadiusScene || null;
  if (!createStarshipStackVisualFn) {
    createStarshipStackVisualFn = async (THREE, distanceScale) => (
      createInlineStarshipStackVisual(THREE, distanceScale)
    );
  }
  if (!applyStarshipVisualStageFn) {
    applyStarshipVisualStageFn = applyInlineStarshipVisualStage;
  }
  if (!starshipPhysicalRenderRadiusSceneFn) {
    starshipPhysicalRenderRadiusSceneFn = inlineStarshipPhysicalRenderRadiusScene;
  }
  if (!createLaunchControllerFn) {
    throw new Error("launchController export missing.");
  }
}

function initializeLaunchController() {
  if (!launchFeatureEnabled || !createLaunchControllerFn) {
    launchController = null;
    return null;
  }
  launchController = createLaunchControllerFn({
    getEarthRadiusKm: () => bodyRadiusKmById("earth"),
    getEarthMassKg: () => bodyMassKgById("earth"),
    getBodyRadiusKm: (bodyId) => bodyRadiusKmById(bodyId),
    getBodyMassKg: (bodyId) => bodyMassKgById(bodyId),
    getEarthFixedAxesEcliptic: (timestampMs) => {
      const pole = sourcePoleUnitVectorEclipticForBody("earth", timestampMs);
      const fixedAxes = sourceBodyFixedAxesEclipticForBody("earth", pole, timestampMs);
      return {
        xAxis: fixedAxes?.xAxis || { x: 1, y: 0, z: 0 },
        yAxis: fixedAxes?.yAxis || { x: 0, y: 1, z: 0 },
        pole: fixedAxes?.pole || pole || { x: 0, y: 0, z: 1 },
        earthOrientation: fixedAxes?.earthOrientation || null,
      };
    },
    sampleEarthAtmosphere: (altitudeKm, sampleOptions = {}) => sampleEarthAtmosphereRuntime(altitudeKm, sampleOptions),
    gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
    onEvent: (event) => {
      appendLaunchLogEntry("info", event);
    },
    onError: (event) => {
      appendLaunchLogEntry("error", event);
    },
  });
  if (stagedLaunchMissionId) {
    const applied = launchController.setMissionProfile?.(stagedLaunchMissionId);
    stagedLaunchMissionId = String(applied?.id || stagedLaunchMissionId).trim();
  }
  return launchController;
}

async function synchronizeLaunchRuntimeArtifacts(nowMs = Date.now()) {
  if (!launchFeatureEnabled || !launchController) {
    return;
  }

  if (Array.isArray(bodies) && bodies.length > 0 && typeof launchController.ensureCatalogBodies === "function") {
    const mergedCatalog = launchController.ensureCatalogBodies(bodies) || bodies;
    for (const bodyId of [LAUNCH_BODY_ID, LAUNCH_BOOSTER_BODY_ID]) {
      const bodyMeta = mergedCatalog.find((body) => String(body?.id || "") === String(bodyId || ""));
      if (!bodyMeta) {
        continue;
      }
      await ensureRuntimeCatalogBody(bodyMeta);
    }
  }

  if (positionsById?.size > 0 && !positionsById.has(LAUNCH_BODY_ID)) {
    const entriesById = new Map(positionsById);
    launchController.injectStartupEntry?.(entriesById, nowMs);
    if (entriesById.has(LAUNCH_BODY_ID)) {
      positionsById = entriesById;
    }
  }

  if (nBodyState?.initialized) {
    launchController.ensureRocketInNBody?.(nBodyState, nowMs);
    launchController.resetToPad?.(nBodyState, nowMs, { clearFleetVehicles: true });
    runtimeCoordsKmById = computeRuntimeCoordinatesKm(nowMs);
    applyScenePositions(runtimeCoordsKmById);
  }
}

function launchAvailabilityReason() {
  if (!launchFeatureEnabled) {
    return "Launch feature disabled by runtime configuration.";
  }
  if (launchModuleLoadError) {
    return `Launch module load error: ${launchModuleLoadError}`;
  }
  if (!launchController) {
    return "Launch controller unavailable.";
  }
  if (!nBodyState?.initialized) {
    return "Launch unavailable until startup seed is ready.";
  }
  return "";
}

async function ensureLaunchRuntimeReady() {
  if (!launchFeatureEnabled) {
    return {
      ready: false,
      reason: launchAvailabilityReason(),
    };
  }

  if (!createLaunchControllerFn || launchModuleLoadError) {
    try {
      await loadLaunchFeatureModules();
      launchModuleLoadError = "";
    } catch (error) {
      launchModuleLoadError = error instanceof Error ? error.message : String(error || "Unknown launch module load error");
      return {
        ready: false,
        reason: launchAvailabilityReason(),
      };
    }
  }

  if (!launchController && createLaunchControllerFn) {
    initializeLaunchController();
  }

  if (!nBodyState?.initialized) {
    if (positionsById?.size > 0 && Array.isArray(bodies) && bodies.length > 0) {
      initializeNBodyFromSnapshot(Date.now());
    }
    if (!nBodyState?.initialized) {
      try {
        await loadSnapshot();
      } catch (error) {
        return {
          ready: false,
          reason: `Launch unavailable until startup seed is ready. ${error instanceof Error ? error.message : String(error || "Snapshot load failed.")}`,
        };
      }
    }
  }

  await synchronizeLaunchRuntimeArtifacts(Date.now());
  updateLaunchControls();
  return {
    ready: Boolean(launchController && nBodyState?.initialized),
    reason: launchAvailabilityReason(),
  };
}

function setupRigidBodyAttitudeModel() {
  if (!RIGID_BODY_ATTITUDE_ENABLED) {
    rigidBodyAttitudeController = null;
    return;
  }
  rigidBodyAttitudeController = createRigidBodyAttitudeController({
    THREE: THREE_NS,
    bodyIds: [...RIGID_BODY_ATTITUDE_IDS],
    getBodyVisual: (bodyId) => bodyVisuals.get(bodyId),
    getBodyMeta: (bodyId) => metaById.get(bodyId),
    getCoordinatesKm: (bodyId) => runtimeCoordsOrLiveById(bodyId),
    getVelocityKmS: (bodyId) => runtimeVelocityKmSOrLiveById(bodyId),
    getBodyMassKg: (bodyId) => bodyMassKgById(bodyId),
    applyBodyDeltaVelocityKmS: (bodyId, deltaVelocityKmS) => applyNBodyDeltaVelocityKmS(bodyId, deltaVelocityKmS),
    getInitialAxisVector: (bodyId) => spinAxisSceneVectorForBody(bodyId),
    getInitialSpinRadians: (bodyId, nowMs) => {
      const calibrated = calibratedReferenceSpinRadians(bodyId, nowMs);
      if (Number.isFinite(calibrated)) {
        return calibrated;
      }
      const body = metaById.get(bodyId);
      return body ? primeMeridianSpinRadians(body, nowMs) : null;
    },
    getInitialRotationPeriodHours: (bodyId) => getRotationPeriodHours(metaById.get(bodyId)),
    gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
    maxFrameSeconds: N_BODY_MAX_FRAME_SECONDS,
    stepSeconds: 0.1,
    timeScale: SPIN_TIME_SCALE,
  });
  rigidBodyAttitudeController.initialize(Date.now());
}

function assertPhysicsLockInvariants() {
  if (!PHYSICS_LOCK_MODE) {
    return;
  }
  assertOrbitalConfigLock();

  const invariantChecks = [
    { ok: SCIENTIFIC_ACCURACY_MODE === true, label: "SCIENTIFIC_ACCURACY_MODE must be true" },
    { ok: WS_INTERVAL_SECONDS === 1, label: "WS_INTERVAL_SECONDS must be 1 in lock mode" },
    { ok: HORIZONS_STARTUP_FETCH_ONLY === true, label: "HORIZONS_STARTUP_FETCH_ONLY must be true" },
    { ok: ORBIT_TIME_SCALE === 1, label: "ORBIT_TIME_SCALE must be 1" },
    { ok: SPIN_TIME_SCALE === 1, label: "SPIN_TIME_SCALE must be 1" },
    { ok: MOON_SPIN_VISUAL_BOOST === 1, label: "MOON_SPIN_VISUAL_BOOST must be 1" },
    { ok: MOON_ORBIT_VISUAL_SCALE === 1, label: "MOON_ORBIT_VISUAL_SCALE must be 1" },
    {
      ok: EARTH_MOON_VISUAL_DISTANCE_MULTIPLIER === 1,
      label: "EARTH_MOON_VISUAL_DISTANCE_MULTIPLIER must be 1",
    },
    {
      ok: Object.keys(ORBIT_VISUAL_PERIOD_HOURS || {}).length === 0,
      label: "ORBIT_VISUAL_PERIOD_HOURS must remain empty",
    },
    {
      ok: primeMeridianCoverageMissingIds().length === 0,
      label: `PRIME_MERIDIAN_W_DEG missing ids: ${primeMeridianCoverageMissingIds().join(", ")}`,
    },
  ];

  const failed = invariantChecks.find((check) => !check.ok);
  if (failed) {
    throw new Error(`Physics lock mismatch: ${failed.label}`);
  }
}

function primeMeridianCoverageMissingIds() {
  const rotationIds = Object.keys(ROTATION_PERIOD_HOURS || {});
  return rotationIds.filter((id) => {
    const model = PRIME_MERIDIAN_W_DEG?.[id];
    return !Number.isFinite(Number(model?.w0Deg)) || !Number.isFinite(Number(model?.wRateDegPerDay));
  });
}

async function loadThreeModule() {
  const urls = [
    "/static/vendor/three/three.module.js",
    "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
    "https://unpkg.com/three@0.160.0/build/three.module.js",
    "https://esm.sh/three@0.160.0",
    "https://cdn.skypack.dev/three@0.160.0",
    "https://threejs.org/build/three.module.js",
  ];
  const failures = [];
  for (const url of urls) {
    try {
      return await import(url);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${url} -> ${reason}`);
    }
  }
  throw new Error(`Unable to load Three.js module from local vendor or CDN. ${failures.join(" | ")}`);
}

function setupScene(THREE) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  camera = new THREE.PerspectiveCamera(66, 1, 0.00000001, 50000);
  orbit.target = new THREE.Vector3(0, 0, 0);

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
    logarithmicDepthBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ReinhardToneMapping;
  renderer.toneMappingExposure = TRUE_SCALE_MODE ? 0.82 : 0.7;
  renderer.physicallyCorrectLights = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  textureLoader = new THREE.TextureLoader();
  textureLoader.setCrossOrigin("anonymous");

  scene.add(new THREE.AmbientLight(
    0xffffff,
    TRUE_SCALE_MODE ? AMBIENT_LIGHT_INTENSITY_TRUE_SCALE : AMBIENT_LIGHT_INTENSITY_DEFAULT_SCALE,
  ));
  const hemisphere = new THREE.HemisphereLight(
    0x20334a,
    0x030508,
    TRUE_SCALE_MODE ? HEMISPHERE_LIGHT_INTENSITY_TRUE_SCALE : HEMISPHERE_LIGHT_INTENSITY_DEFAULT_SCALE,
  );
  scene.add(hemisphere);
  sunLight = new THREE.PointLight(
    0xfff2de,
    TRUE_SCALE_MODE ? SUN_LIGHT_INTENSITY_TRUE_SCALE : SUN_LIGHT_INTENSITY_DEFAULT_SCALE,
    0,
    2.0,
  );
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 0.01;
  sunLight.shadow.camera.far = TRUE_SCALE_MODE ? SUN_LIGHT_SHADOW_FAR_TRUE_SCALE : SUN_LIGHT_SHADOW_FAR_DEFAULT_SCALE;
  sunLight.shadow.bias = -0.00002;
  sunLight.shadow.normalBias = 0.002;
  scene.add(sunLight);

  addStarfield(THREE);

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  tidalOverlayController = createTidalOverlayController({
    THREE,
    scene,
    targets: TIDAL_TARGET_CONFIG,
    clamp,
    getBodyVisual: (bodyId) => bodyVisuals.get(bodyId),
    getBodyMassKg: (bodyId) => bodyMassKgById(bodyId),
    getBodyRadiusKm: (bodyId) => bodyRadiusKmById(bodyId),
    getCoordinatesKm: (bodyId) => runtimeCoordsOrLiveById(bodyId),
    gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
    minBodyRadiusScene: ORBIT_MIN_DISTANCE_ABSOLUTE * 2.5,
    vectorColor: 0xff5f8d,
    shellColor: 0xff8cae,
    baselineMS2: 1.0e-6,
    maxLength: 0.14,
  });
  lagrangeOverlayController = createLagrangeOverlayController({
    THREE,
    scene,
    systems: LAGRANGE_SYSTEM_CONFIG,
    clamp,
    getBodyVisual: (bodyId) => bodyVisuals.get(bodyId),
    getCoordinatesKm: (bodyId) => runtimeCoordsOrLiveById(bodyId),
    getBodyMassKg: (bodyId) => bodyMassKgById(bodyId),
    getLiveVelocityKmS: (bodyId) => liveVelocityForBody(bodyId),
    gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
    distanceScale: DISTANCE_SCALE,
    minBodyRadiusScene: ORBIT_MIN_DISTANCE_ABSOLUTE * 2.5,
    markerSizeMin: 0.0005,
    markerSizeMax: 0.012,
    defaultMarkerColor: 0x6ad8ff,
  });
  earthAtmosphereController = createEarthAtmosphereController({
    THREE,
    getBodyVisual: (bodyId) => bodyVisuals.get(bodyId),
    getCoordinatesKm: (bodyId) => runtimeCoordsOrLiveById(bodyId),
    distanceScale: DISTANCE_SCALE,
  });
  atmosphereDynamicsController = createAtmosphereDynamicsController({
    getBodyMeta: (bodyId) => metaById.get(bodyId),
    getBodyRadiusKm: (bodyId) => bodyRadiusKmById(bodyId),
    getBodyMassKg: (bodyId) => bodyMassKgById(bodyId),
    getBodySpinAxisEcliptic: (bodyId) => sourcePoleUnitVectorEclipticForBody(bodyId, Date.now()),
    getEarthFixedAxesEcliptic: (timestampMs) => {
      const pole = sourcePoleUnitVectorEclipticForBody("earth", timestampMs);
      const fixedAxes = sourceBodyFixedAxesEclipticForBody("earth", pole, timestampMs);
      return {
        xAxis: fixedAxes?.xAxis || { x: 1, y: 0, z: 0 },
        yAxis: fixedAxes?.yAxis || { x: 0, y: 1, z: 0 },
        pole: fixedAxes?.pole || pole || { x: 0, y: 0, z: 1 },
        earthOrientation: fixedAxes?.earthOrientation || null,
      };
    },
    sampleEarthAtmosphere: (altitudeKm, sampleOptions = {}) => sampleEarthAtmosphereRuntime(altitudeKm, sampleOptions),
  });
  initializeLaunchController();

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("pointercancel", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  onResize();
  updateCameraFromOrbit();
}

function addStarfield(THREE) {
  const sphereGeometry = new THREE.SphereGeometry(14000, 48, 48);
  const texture = new THREE.TextureLoader().load(
    `${LOCAL_META_TEXTURE_ROOT}galaxy_starfield.png?v=${LOCAL_TEXTURE_ASSET_VERSION}`,
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide,
    fog: false,
  });
  const sky = new THREE.Mesh(sphereGeometry, material);
  scene.add(sky);
}

async function loadBodyCatalog() {
  const response = await fetch(`/api/bodies?include_moons=${INCLUDE_MOONS}`);
  if (!response.ok) {
    throw new Error(`Body catalog request failed with ${response.status}`);
  }

  const payload = await response.json();
  const catalogBodies = payload.bodies || [];
  bodies = launchFeatureEnabled
    ? (launchController?.ensureCatalogBodies(catalogBodies) || catalogBodies)
    : catalogBodies;
  metaById = new Map(bodies.map((body) => [body.id, body]));
  gravityArrowFocusBodyId = null;
  gravityArrowsLegendActivated = false;
  await rebuildMeshes();
  rebuildOrbitVisuals();
  rebuildBodyLegend();

  if (!selectedId) {
    const earth = bodies.find((body) => body.id === "earth");
    const fallback = bodies[0];
    if (earth) {
      setSelected(earth.id, true);
    } else if (fallback) {
      setSelected(fallback.id, true);
    }
  }
}

async function loadSnapshot() {
  const response = await fetch(`/api/positions?include_moons=${INCLUDE_MOONS}`);
  if (!response.ok) {
    throw new Error(`Position request failed with ${response.status}`);
  }
  const payload = await response.json();
  updatePositions(payload, "startup_seed");
}

async function rebuildMeshes() {
  clearEarthAtmosphereVisuals();
  if (launchSiteStructureVisual?.root?.parent) {
    launchSiteStructureVisual.root.parent.remove(launchSiteStructureVisual.root);
  }
  launchSiteStructureVisual = null;
  for (const visual of bodyVisuals.values()) {
    disposeBodyVisual(visual);
  }
  clearTidalOverlayVisuals();
  clearLagrangeOverlayVisuals();
  bodyVisuals = new Map();
  primeMeridianSpinOffsetRadById = new Map();

  const visuals = await Promise.all(bodies.map((body) => createBodyVisual(body)));
  for (const visual of visuals) {
    if (!visual) {
      continue;
    }
    scene.add(visual.root);
    bodyVisuals.set(visual.id, visual);
  }
  if (RIGID_BODY_ATTITUDE_ENABLED && rigidBodyAttitudeController) {
    setupRigidBodyAttitudeModel();
  }
  rebuildPhysicsOverlays();
}

function rebuildOrbitVisuals() {
  for (const orbitVisual of orbitVisuals.values()) {
    disposeOrbitVisual(orbitVisual);
  }
  orbitVisuals = new Map();

  for (const body of bodies) {
    if (!isSunOrbitPlanet(body)) {
      continue;
    }
    const orbitVisual = createOrbitVisual(body);
    if (!orbitVisual) {
      continue;
    }
    scene.add(orbitVisual.group);
    orbitVisuals.set(body.id, orbitVisual);
  }
}

function normalizeLegendSectionId(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "section";
}

function readLegendSectionCollapsedPreference(sectionId, fallback = false) {
  try {
    const storageKey = `${LEGEND_SECTION_COLLAPSED_STORAGE_KEY_PREFIX}${normalizeLegendSectionId(sectionId)}`;
    const value = window.localStorage?.getItem(storageKey);
    if (value === "1") {
      return true;
    }
    if (value === "0") {
      return false;
    }
  } catch (_error) {
    // Ignore preference read failures.
  }
  return Boolean(fallback);
}

function persistLegendSectionCollapsedPreference(sectionId, collapsed) {
  try {
    const storageKey = `${LEGEND_SECTION_COLLAPSED_STORAGE_KEY_PREFIX}${normalizeLegendSectionId(sectionId)}`;
    window.localStorage?.setItem(storageKey, collapsed ? "1" : "0");
  } catch (_error) {
    // Ignore preference persistence failures.
  }
}

function applyLegendCollapsibleState(rootNode, collapsed, options = {}) {
  if (!rootNode) {
    return;
  }
  const isCollapsed = Boolean(collapsed);
  rootNode.classList.toggle("collapsed", isCollapsed);
  const toggleButton = rootNode.querySelector(":scope > .legend-collapsible-header > .legend-collapsible-toggle");
  if (!toggleButton) {
    return;
  }
  const title = options.title || rootNode.dataset.legendSectionTitle || "section";
  const collapseLabel = options.collapseLabel || `Collapse ${title}`;
  const expandLabel = options.expandLabel || `Expand ${title}`;
  toggleButton.textContent = isCollapsed ? "+" : "-";
  toggleButton.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
  toggleButton.setAttribute("aria-label", isCollapsed ? expandLabel : collapseLabel);
}

function wireLegendCollapsibleSection(rootNode, options = {}) {
  if (!rootNode) {
    return;
  }
  const titleSelector = options.titleSelector || ".body-legend-title";
  const titleNode = rootNode.querySelector(titleSelector);
  if (!titleNode) {
    return;
  }
  const sectionTitle = options.title || titleNode.textContent || "Section";
  const sectionId = normalizeLegendSectionId(options.sectionId || rootNode.id || sectionTitle);
  const rememberState = options.rememberState !== false;
  const defaultCollapsed = Boolean(options.defaultCollapsed);

  rootNode.classList.add("legend-collapsible");
  rootNode.dataset.legendSectionId = sectionId;
  rootNode.dataset.legendSectionTitle = sectionTitle;

  let headerNode = rootNode.querySelector(":scope > .legend-collapsible-header");
  if (!headerNode) {
    headerNode = document.createElement("div");
    headerNode.className = "legend-collapsible-header";
    rootNode.insertBefore(headerNode, rootNode.firstChild || null);
  }
  if (titleNode.parentElement !== headerNode) {
    titleNode.remove();
    headerNode.prepend(titleNode);
  }

  let bodyNode = rootNode.querySelector(":scope > .legend-collapsible-body");
  if (!bodyNode) {
    bodyNode = document.createElement("div");
    bodyNode.className = "legend-collapsible-body";
    while (headerNode.nextSibling) {
      bodyNode.appendChild(headerNode.nextSibling);
    }
    rootNode.appendChild(bodyNode);
  }

  let toggleButton = headerNode.querySelector(".legend-collapsible-toggle");
  if (!toggleButton) {
    toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "legend-collapsible-toggle";
    headerNode.appendChild(toggleButton);
  }

  if (toggleButton.dataset.bound !== "true") {
    toggleButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      markLegendInteractionGuard();
      const nextCollapsed = !rootNode.classList.contains("collapsed");
      applyLegendCollapsibleState(rootNode, nextCollapsed, options);
      if (rememberState) {
        persistLegendSectionCollapsedPreference(sectionId, nextCollapsed);
      }
      if (typeof options.onToggle === "function") {
        options.onToggle(nextCollapsed);
      }
      refreshLegendAccordionHeights();
    });
    toggleButton.dataset.bound = "true";
  }

  const initialCollapsed = rememberState
    ? readLegendSectionCollapsedPreference(sectionId, defaultCollapsed)
    : defaultCollapsed;
  applyLegendCollapsibleState(rootNode, initialCollapsed, options);
}

function applyLegendBodyListCollapsedState() {
  if (bodyLegendList) {
    bodyLegendList.classList.toggle("collapsed", legendBodyListCollapsed);
  }
  if (legendBodyListToggleButton) {
    legendBodyListToggleButton.textContent = legendBodyListCollapsed ? "+" : "-";
    legendBodyListToggleButton.setAttribute("aria-expanded", legendBodyListCollapsed ? "false" : "true");
    legendBodyListToggleButton.setAttribute(
      "aria-label",
      legendBodyListCollapsed ? "Expand bodies list" : "Collapse bodies list",
    );
  }
}

function toggleLegendBodyListCollapsed() {
  legendBodyListCollapsed = !legendBodyListCollapsed;
  persistLegendSectionCollapsedPreference(LEGEND_BODY_LIST_SECTION_ID, legendBodyListCollapsed);
  applyLegendBodyListCollapsedState();
  refreshLegendAccordionHeights();
}

function initializeLegendBodyListControls() {
  if (!legendBodyHeaderNode || !bodyLegendList) {
    return;
  }
  if (!legendBodyListToggleButton) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "legend-body-toggle";
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      markLegendInteractionGuard();
      toggleLegendBodyListCollapsed();
    });
    legendBodyHeaderNode.appendChild(toggle);
    legendBodyListToggleButton = toggle;
  }
  legendBodyListCollapsed = readLegendSectionCollapsedPreference(LEGEND_BODY_LIST_SECTION_ID, false);
  applyLegendBodyListCollapsedState();
}

function initializeLegendSectionControls() {
  wireLegendCollapsibleSection(observationPanel, {
    sectionId: LEGEND_OBSERVATION_SECTION_ID,
    titleSelector: ".body-legend-title",
    title: "Observation",
    defaultCollapsed: false,
    collapseLabel: "Collapse observation controls",
    expandLabel: "Expand observation controls",
  });
  wireLegendCollapsibleSection(physicsPanel, {
    sectionId: LEGEND_PHYSICS_SECTION_ID,
    titleSelector: ".body-legend-title",
    title: "Physics overlays",
    defaultCollapsed: false,
    collapseLabel: "Collapse physics overlays",
    expandLabel: "Expand physics overlays",
  });
  initializeLegendBodyListControls();
}

function rebuildBodyLegend() {
  if (!bodyLegendList) {
    return;
  }

  bodyLegendList.innerHTML = "";
  legendButtonsById = new Map();
  legendGravityPanelsById = new Map();
  legendGravityToggleButtonsById = new Map();
  legendPlanetAccordionContentById = new Map();
  legendPlanetAccordionTriggerById = new Map();
  legendVehicleViewButtonsByKey = {
    starship: null,
    booster: null,
  };
  legendLaunchMissionSelect = null;
  legendMissionLaunchModeSelect = null;
  legendTankerLaunchModeSelect = null;
  legendFleetVehicleSelect = null;
  legendFleetPreviousButton = null;
  legendFleetNextButton = null;
  legendFleetTrackButton = null;
  legendFleetStatusNode = null;
  const fragment = document.createDocumentFragment();
  if (legendBodyCountNode) {
    legendBodyCountNode.textContent = `${bodies.length} tracked`;
  }

  const sun = bodies.find((body) => body.id === "sun");
  if (sun) {
    const sunGroup = createLegendGroup("Sun", { sectionId: "sun" });
    sunGroup.content.appendChild(createLegendEntry(sun, false));
    fragment.appendChild(sunGroup.root);
  }

  const planetarySystemsSection = document.createElement("p");
  planetarySystemsSection.className = "legend-section-title";
  planetarySystemsSection.textContent = "Planetary Systems";
  fragment.appendChild(planetarySystemsSection);

  const planets = bodies
    .filter((body) => body.body_type === "planet" && body.id !== "sun")
    .sort((a, b) => sortBySemimajorAxisThenName(a, b));
  const planetaryGroup = createLegendGroup("Planets", { sectionId: "planets" });

  for (const planet of planets) {
    const moons = bodies
      .filter((body) => moonBelongsToPlanet(body, planet))
      .sort((a, b) => sortBySemimajorAxisThenName(a, b));

    if (moons.length > 0) {
      planetaryGroup.content.appendChild(createPlanetAccordionEntry(planet, moons));
      continue;
    }
    planetaryGroup.content.appendChild(createLegendEntry(planet, false));
  }
  fragment.appendChild(planetaryGroup.root);

  const orphanMoons = bodies
    .filter((body) => (
      body.body_type === "moon"
      && !planets.some((planet) => moonBelongsToPlanet(body, planet))
    ))
    .sort((a, b) => sortBySemimajorAxisThenName(a, b));
  if (orphanMoons.length > 0) {
    const orphanGroup = createLegendGroup("Unassigned Moons", { sectionId: "unassigned_moons" });
    for (const moon of orphanMoons) {
      orphanGroup.content.appendChild(createLegendEntry(moon, true));
    }
    fragment.appendChild(orphanGroup.root);
  }

  if (launchFeatureEnabled) {
    fragment.appendChild(createLegendVehicleViewPanel());
  }

  const spacecraftBodies = bodies
    .filter((body) => (
      body.body_type === "spacecraft"
      || isLaunchTelemetryVehicleId(body.id)
    ))
    .sort((a, b) => sortBySemimajorAxisThenName(a, b));
  if (spacecraftBodies.length > 0) {
    const section = document.createElement("p");
    section.className = "legend-section-title";
    section.textContent = "Spacecraft";
    fragment.appendChild(section);
    const spacecraftGroup = createLegendGroup("Active Vehicles", { sectionId: "active_vehicles" });
    for (const spacecraft of spacecraftBodies) {
      spacecraftGroup.content.appendChild(createLegendEntry(spacecraft, false));
    }
    fragment.appendChild(spacecraftGroup.root);
  }

  bodyLegendList.appendChild(fragment);
  applyLegendBodyListCollapsedState();
  updateLegendSelection();
  updateLegendFallbackIndicators();
  updateLegendGravityArrowIndicators();
  updateLegendVehicleViewButtons();
  updateLaunchControls();
}

function createLegendGroup(title, options = {}) {
  const group = document.createElement("div");
  group.className = "legend-group";
  const heading = document.createElement("p");
  heading.className = "legend-group-title";
  heading.textContent = title || "Group";
  group.appendChild(heading);

  const content = document.createElement("div");
  group.appendChild(content);

  wireLegendCollapsibleSection(group, {
    sectionId: options.sectionId || title || "group",
    titleSelector: ".legend-group-title",
    title: title || "Group",
    defaultCollapsed: Boolean(options.defaultCollapsed),
  });

  const collapsibleBody = group.querySelector(":scope > .legend-collapsible-body");
  return {
    root: group,
    content: collapsibleBody || content,
  };
}

function isLegendPlanetAccordionExpanded(planetId) {
  return Boolean(legendPlanetAccordionStateById.get(planetId));
}

function setLegendPlanetAccordionExpanded(planetId, expanded, persist = true) {
  const open = Boolean(expanded);
  if (persist) {
    legendPlanetAccordionStateById.set(planetId, open);
  }
  const content = legendPlanetAccordionContentById.get(planetId);
  if (content) {
    content.classList.toggle("open", open);
    if (open) {
      const targetHeight = Math.max(content.scrollHeight, 0);
      content.style.maxHeight = `${targetHeight}px`;
    } else {
      content.style.maxHeight = "0px";
    }
  }
  const trigger = legendPlanetAccordionTriggerById.get(planetId);
  if (trigger) {
    trigger.classList.toggle("open", open);
  }
  const planetButton = legendButtonsById.get(planetId);
  if (planetButton) {
    planetButton.setAttribute("aria-expanded", open ? "true" : "false");
  }
}

function refreshLegendAccordionHeights() {
  for (const [planetId, content] of legendPlanetAccordionContentById.entries()) {
    if (!content) {
      continue;
    }
    const open = isLegendPlanetAccordionExpanded(planetId);
    if (!open) {
      continue;
    }
    content.style.maxHeight = `${Math.max(content.scrollHeight, 0)}px`;
  }
}

function selectedBodyBelongsToPlanetSystem(planetId) {
  const selectedBody = selectedId ? metaById.get(selectedId) : null;
  if (!selectedBody) {
    return false;
  }
  if (selectedBody.id === planetId) {
    return true;
  }
  return selectedBody.body_type === "moon" && selectedBody.parent === planetId;
}

function syncLegendPlanetAccordionsWithSelection() {
  for (const planetId of legendPlanetAccordionContentById.keys()) {
    if (selectedBodyBelongsToPlanetSystem(planetId)) {
      setLegendPlanetAccordionExpanded(planetId, true, true);
    }
  }
}

function createPlanetAccordionEntry(planet, moons) {
  const accordion = document.createElement("div");
  accordion.className = "legend-planet-accordion";
  accordion.dataset.planetId = planet.id;

  const trigger = createLegendEntry(planet, false, {
    onClick: () => {
      const wasExpanded = isLegendPlanetAccordionExpanded(planet.id);
      setSelected(planet.id, true);
      const nextExpanded = !wasExpanded;
      setLegendPlanetAccordionExpanded(planet.id, nextExpanded, true);
    },
  });
  trigger.classList.add("legend-planet-accordion-trigger");
  accordion.appendChild(trigger);
  legendPlanetAccordionTriggerById.set(planet.id, trigger);

  const moonList = document.createElement("div");
  moonList.className = "legend-planet-accordion-content";
  for (const moon of moons) {
    moonList.appendChild(createLegendEntry(moon, true));
  }
  accordion.appendChild(moonList);
  legendPlanetAccordionContentById.set(planet.id, moonList);

  const persistedState = legendPlanetAccordionStateById.get(planet.id);
  const initialExpanded = typeof persistedState === "boolean"
    ? persistedState
    : selectedBodyBelongsToPlanetSystem(planet.id);
  setLegendPlanetAccordionExpanded(planet.id, initialExpanded, true);
  return accordion;
}

function supportsLegendGravityControlByBody(body) {
  return body?.body_type === "planet" || body?.body_type === "moon" || body?.body_type === "spacecraft";
}

function supportsLegendGravityControl(bodyId) {
  return supportsLegendGravityControlByBody(metaById.get(bodyId));
}

function createLegendEntry(body, isMoon, options = {}) {
  const entry = document.createElement("div");
  entry.className = isMoon ? "legend-entry moon" : "legend-entry";
  const button = createLegendButton(body, isMoon, options);
  entry.appendChild(button);

  if (supportsLegendGravityControlByBody(body)) {
    const panel = createLegendGravityPanel(body, isMoon);
    entry.appendChild(panel);
    legendGravityPanelsById.set(body.id, panel);
  }

  if (body.id === "earth" && physicsPanel) {
    if (physicsPanelTitleNode) {
      physicsPanelTitleNode.textContent = "Earth Physics Overlays";
    }
    physicsPanel.classList.add("legend-earth-physics-panel");
    entry.appendChild(physicsPanel);
  }

  return entry;
}

function createLegendButton(body, isMoon, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = isMoon ? "legend-button moon" : "legend-button";
  button.dataset.bodyId = body.id;

  const name = document.createElement("span");
  name.className = "legend-button-name";
  name.textContent = body.name;
  button.appendChild(name);

  const meta = document.createElement("span");
  meta.className = "legend-button-meta";
  const bodyType = String(body.body_type || "").trim();
  const parentLabel = bodyType === "moon" && body.parent
    ? (metaById.get(body.parent)?.name || body.parent)
    : "";
  const metaParts = [];
  if (bodyType) {
    metaParts.push(bodyType.charAt(0).toUpperCase() + bodyType.slice(1));
  }
  if (parentLabel) {
    metaParts.push(`Parent: ${parentLabel}`);
  }
  meta.textContent = metaParts.join(" • ");
  button.appendChild(meta);

  button.title = `${body.name} (${body.body_type})`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    markLegendInteractionGuard();
    if (typeof options.onClick === "function") {
      options.onClick();
      return;
    }
    setSelected(body.id, true);
  });
  legendButtonsById.set(body.id, button);
  return button;
}

function createLegendGravityPanel(body, isMoon) {
  const panel = document.createElement("div");
  panel.className = isMoon ? "legend-gravity-panel moon" : "legend-gravity-panel";

  const label = document.createElement("span");
  label.className = "legend-gravity-label";
  label.textContent = "Gravitational Pull";
  panel.appendChild(label);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "legend-gravity-toggle";
  toggle.textContent = "Off";
  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    markLegendInteractionGuard();

    if (selectedId !== body.id) {
      setSelected(body.id, true);
    }
    const isActiveForBody =
      gravityArrowsLegendActivated &&
      gravityArrowFocusBodyId === body.id;
    if (isActiveForBody) {
      gravityArrowsLegendActivated = false;
      gravityArrowFocusBodyId = null;
    } else {
      gravityArrowsLegendActivated = true;
      gravityArrowFocusBodyId = body.id;
    }
    updateLegendGravityArrowIndicators();
    updateGravityVectors();
  });
  panel.appendChild(toggle);
  legendGravityToggleButtonsById.set(body.id, toggle);

  return panel;
}

function hasVisibleBodyState(bodyId) {
  const visual = bodyVisuals.get(bodyId);
  const hasCoords = Boolean(runtimeCoordsOrLiveById(bodyId));
  return Boolean(metaById.has(bodyId) && visual?.root?.visible && hasCoords);
}

function launchVehicleViewState() {
  return computeLaunchVehicleViewState({
    inBodyLock: observation.mode === OBSERVATION_MODES.BODY_LOCK,
    selectedId,
    launchBodyId: LAUNCH_BODY_ID,
    launchBoosterBodyId: LAUNCH_BOOSTER_BODY_ID,
    launchVehicleViewPreference,
    starshipAvailable: hasVisibleBodyState(LAUNCH_BODY_ID),
    boosterDetachedAvailable: hasVisibleBodyState(LAUNCH_BOOSTER_BODY_ID),
  });
}

function focusLegendVehicleView(viewMode = "starship") {
  const wantsBooster = viewMode === "booster";
  launchVehicleViewPreference = wantsBooster ? "booster" : "starship";

  const starshipAvailable = hasVisibleBodyState(LAUNCH_BODY_ID);
  const boosterAvailable = hasVisibleBodyState(LAUNCH_BOOSTER_BODY_ID);
  let targetBodyId = null;

  if (wantsBooster) {
    targetBodyId = boosterAvailable ? LAUNCH_BOOSTER_BODY_ID : (starshipAvailable ? LAUNCH_BODY_ID : null);
  } else {
    targetBodyId = starshipAvailable ? LAUNCH_BODY_ID : (boosterAvailable ? LAUNCH_BOOSTER_BODY_ID : null);
  }

  if (!targetBodyId) {
    updateLaunchStatusPanel(true, "Launch vehicle is not available in the current scene.");
    updateLegendVehicleViewButtons();
    return;
  }
  if (observation.mode !== OBSERVATION_MODES.BODY_LOCK) {
    setObservationMode(OBSERVATION_MODES.BODY_LOCK);
  }
  if (wantsBooster && !boosterAvailable && starshipAvailable) {
    updateLaunchStatusPanel(true, "Booster View armed. Tracking stacked booster until separation.");
  }
  setSelected(targetBodyId, true);
  updateLaunchControls();
  updateLegendVehicleViewButtons();
}

function createLegendVehicleViewPanel() {
  const panel = document.createElement("div");
  panel.className = "legend-vehicle-panel";

  const label = document.createElement("span");
  label.className = "legend-vehicle-label";
  label.textContent = "Tracking Views";
  panel.appendChild(label);

  const row = document.createElement("div");
  row.className = "legend-vehicle-view-row";

  const starshipButton = document.createElement("button");
  starshipButton.type = "button";
  starshipButton.className = "legend-vehicle-view-button";
  starshipButton.textContent = "Starship View";
  starshipButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    markLegendInteractionGuard();
    focusLegendVehicleView("starship");
  });
  row.appendChild(starshipButton);
  legendVehicleViewButtonsByKey.starship = starshipButton;

  const boosterButton = document.createElement("button");
  boosterButton.type = "button";
  boosterButton.className = "legend-vehicle-view-button";
  boosterButton.textContent = "Booster View";
  boosterButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    markLegendInteractionGuard();
    focusLegendVehicleView("booster");
  });
  row.appendChild(boosterButton);
  legendVehicleViewButtonsByKey.booster = boosterButton;

  panel.appendChild(row);
  const missionLabel = document.createElement("label");
  missionLabel.className = "legend-vehicle-mission-label";
  missionLabel.textContent = "Mission";
  panel.appendChild(missionLabel);

  const missionSelect = document.createElement("select");
  missionSelect.id = "legend-vehicle-mission-select";
  missionSelect.className = "legend-vehicle-mission-select";
  missionSelect.title = "Select launch mission";
  missionLabel.htmlFor = missionSelect.id;
  panel.appendChild(missionSelect);
  legendLaunchMissionSelect = missionSelect;
  setupLaunchMissionPicker();

  const missionModeLabel = document.createElement("label");
  missionModeLabel.className = "legend-vehicle-mission-label";
  missionModeLabel.textContent = "Mission Launch Mode";
  panel.appendChild(missionModeLabel);

  const missionModeSelect = document.createElement("select");
  missionModeSelect.id = "legend-mission-launch-mode-select";
  missionModeSelect.className = "legend-vehicle-mission-select";
  missionModeSelect.title = "Select how additional mission ships are deployed";
  missionModeLabel.htmlFor = missionModeSelect.id;
  missionModeSelect.innerHTML = [
    '<option value="pad_launch">Earth Pad Launch (Booster)</option>',
    `<option value="orbit_inject">Direct Orbit Inject (Dynamic Moon TLI, ~${MOON_ORBIT_INJECT_ALTITUDE_KM} km)</option>`,
  ].join("");
  missionModeSelect.value = "pad_launch";
  missionModeSelect.addEventListener("change", (event) => {
    event.preventDefault();
    event.stopPropagation();
    markLegendInteractionGuard();
    setMissionLaunchModeSelection(event.currentTarget?.value);
  });
  panel.appendChild(missionModeSelect);
  legendMissionLaunchModeSelect = missionModeSelect;

  const tankerModeLabel = document.createElement("label");
  tankerModeLabel.className = "legend-vehicle-mission-label";
  tankerModeLabel.textContent = "Tanker Launch Mode";
  panel.appendChild(tankerModeLabel);

  const tankerModeSelect = document.createElement("select");
  tankerModeSelect.id = "legend-tanker-launch-mode-select";
  tankerModeSelect.className = "legend-vehicle-mission-select";
  tankerModeSelect.title = "Select how tankers are deployed";
  tankerModeLabel.htmlFor = tankerModeSelect.id;
  tankerModeSelect.innerHTML = [
    '<option value="pad_launch">Earth Pad Launch (Realistic)</option>',
    '<option value="orbit_inject">Direct Orbit Inject (Instant)</option>',
  ].join("");
  tankerModeSelect.value = "pad_launch";
  tankerModeSelect.addEventListener("change", (event) => {
    event.preventDefault();
    event.stopPropagation();
    markLegendInteractionGuard();
    setTankerLaunchModeSelection(event.currentTarget?.value);
  });
  panel.appendChild(tankerModeSelect);
  legendTankerLaunchModeSelect = tankerModeSelect;

  const fuelRow = document.createElement("div");
  fuelRow.className = "legend-vehicle-fuel-row";
  const fuelLabel = document.createElement("span");
  fuelLabel.className = "legend-vehicle-fuel-label";
  fuelLabel.textContent = "Booster Fuel View";
  fuelRow.appendChild(fuelLabel);
  const fuelToggle = document.createElement("button");
  fuelToggle.type = "button";
  fuelToggle.className = "legend-vehicle-fuel-toggle";
  fuelToggle.textContent = "Off";
  fuelToggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    markLegendInteractionGuard();
    boosterFuelViewEnabled = !boosterFuelViewEnabled;
    updateLegendBoosterFuelToggle();
  });
  fuelRow.appendChild(fuelToggle);
  panel.appendChild(fuelRow);
  legendBoosterFuelToggleButton = fuelToggle;

  const trajectoryRow = document.createElement("div");
  trajectoryRow.className = "legend-vehicle-trajectory-row";
  const trajectoryLabel = document.createElement("span");
  trajectoryLabel.className = "legend-vehicle-trajectory-label";
  trajectoryLabel.textContent = "Trajectory Path";
  trajectoryRow.appendChild(trajectoryLabel);
  const trajectoryToggle = document.createElement("button");
  trajectoryToggle.type = "button";
  trajectoryToggle.className = "legend-vehicle-trajectory-toggle";
  trajectoryToggle.textContent = "Off";
  trajectoryToggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    markLegendInteractionGuard();
    trajectoryPathViewEnabled = !trajectoryPathViewEnabled;
    updateLegendTrajectoryToggle();
    launchTrajectoryPathController?.setEnabled(trajectoryPathViewEnabled);
  });
  trajectoryRow.appendChild(trajectoryToggle);
  panel.appendChild(trajectoryRow);
  legendTrajectoryPathToggleButton = trajectoryToggle;

  const fleetLabel = document.createElement("label");
  fleetLabel.className = "legend-vehicle-mission-label";
  fleetLabel.textContent = "Fleet Manager";
  panel.appendChild(fleetLabel);

  const fleetSelect = document.createElement("select");
  fleetSelect.id = "legend-fleet-vehicle-select";
  fleetSelect.className = "legend-vehicle-mission-select";
  fleetSelect.title = "Select active spacecraft";
  fleetLabel.htmlFor = fleetSelect.id;
  fleetSelect.addEventListener("change", (event) => {
    event.preventDefault();
    event.stopPropagation();
    markLegendInteractionGuard();
    const targetId = String(fleetSelect.value || "");
    if (targetId) {
      focusManagedTelemetryVehicle(targetId, true);
    }
  });
  panel.appendChild(fleetSelect);
  legendFleetVehicleSelect = fleetSelect;

  const fleetNavRow = document.createElement("div");
  fleetNavRow.className = "legend-vehicle-fleet-nav-row";

  const fleetPrevButton = document.createElement("button");
  fleetPrevButton.type = "button";
  fleetPrevButton.className = "legend-vehicle-view-button";
  fleetPrevButton.textContent = "Prev";
  fleetPrevButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    markLegendInteractionGuard();
    cycleManagedTelemetryVehicle(-1);
  });
  fleetNavRow.appendChild(fleetPrevButton);
  legendFleetPreviousButton = fleetPrevButton;

  const fleetTrackButton = document.createElement("button");
  fleetTrackButton.type = "button";
  fleetTrackButton.className = "legend-vehicle-view-button";
  fleetTrackButton.textContent = "Track";
  fleetTrackButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    markLegendInteractionGuard();
    const targetId = String(legendFleetVehicleSelect?.value || "");
    if (targetId) {
      focusManagedTelemetryVehicle(targetId, true);
    }
  });
  fleetNavRow.appendChild(fleetTrackButton);
  legendFleetTrackButton = fleetTrackButton;

  const fleetNextButton = document.createElement("button");
  fleetNextButton.type = "button";
  fleetNextButton.className = "legend-vehicle-view-button";
  fleetNextButton.textContent = "Next";
  fleetNextButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    markLegendInteractionGuard();
    cycleManagedTelemetryVehicle(1);
  });
  fleetNavRow.appendChild(fleetNextButton);
  legendFleetNextButton = fleetNextButton;

  panel.appendChild(fleetNavRow);

  const fleetStatus = document.createElement("p");
  fleetStatus.className = "legend-launch-status legend-fleet-status";
  fleetStatus.textContent = "No active spacecraft in the scene.";
  panel.appendChild(fleetStatus);
  legendFleetStatusNode = fleetStatus;
  updateLegendFleetManager();

  const status = document.createElement("p");
  status.id = "launch-status";
  status.className = "legend-launch-status";
  status.textContent = "Launch status unavailable.";
  panel.appendChild(status);
  launchStatusNode = status;

  const debug = document.createElement("p");
  debug.id = "launch-debug";
  debug.className = "legend-launch-status legend-launch-debug";
  debug.hidden = true;
  panel.appendChild(debug);
  launchDebugNode = debug;
  renderMoonOrbitInjectDebugState();

  const missionControl = document.createElement("section");
  missionControl.id = "launch-mission-control";
  missionControl.className = "legend-mission-control";

  const missionHeader = document.createElement("div");
  missionHeader.className = "legend-mission-control-header";
  const missionControlLabel = document.createElement("span");
  missionControlLabel.className = "legend-mission-control-label";
  missionControlLabel.textContent = "Mission Control";
  missionHeader.appendChild(missionControlLabel);
  const missionToggle = document.createElement("button");
  missionToggle.type = "button";
  missionToggle.id = "launch-mission-toggle";
  missionToggle.className = "legend-mission-control-toggle";
  missionToggle.textContent = "-";
  missionToggle.setAttribute("aria-label", "Collapse mission control");
  missionToggle.setAttribute("aria-expanded", "true");
  missionToggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    markLegendInteractionGuard();
    setLaunchMissionControlCollapsed(!launchMissionControlCollapsed);
  });
  missionHeader.appendChild(missionToggle);
  missionControl.appendChild(missionHeader);

  const missionStatus = document.createElement("p");
  missionStatus.id = "launch-mission-control-status";
  missionStatus.className = "legend-mission-control-status";
  missionStatus.textContent = "Standby. Press Launch to open live mission control telemetry.";
  missionControl.appendChild(missionStatus);

  const missionMetrics = document.createElement("div");
  missionMetrics.id = "launch-mission-metrics";
  missionMetrics.className = "legend-mission-metrics";
  missionMetrics.innerHTML = "<p class=\"legend-mission-empty\">Awaiting mission data.</p>";
  missionControl.appendChild(missionMetrics);

  panel.appendChild(missionControl);
  launchMissionControlPanelNode = missionControl;
  launchMissionControlStatusNode = missionStatus;
  launchMissionControlMetricsNode = missionMetrics;
  launchMissionControlToggleButton = missionToggle;
  setLaunchMissionControlCollapsed(false);

  const eventLog = document.createElement("pre");
  eventLog.id = "launch-event-log";
  eventLog.className = "legend-launch-event-log";
  eventLog.textContent = "No launch events yet.";
  const eventLogSection = document.createElement("section");
  eventLogSection.className = "legend-inline-section";
  const eventLogLabel = document.createElement("p");
  eventLogLabel.className = "legend-inline-section-title";
  eventLogLabel.textContent = "Event Log";
  eventLogSection.appendChild(eventLogLabel);
  eventLogSection.appendChild(eventLog);
  panel.appendChild(eventLogSection);
  launchEventLogNode = eventLog;

  wireLegendCollapsibleSection(eventLogSection, {
    sectionId: LEGEND_LAUNCH_EVENT_LOG_SECTION_ID,
    titleSelector: ".legend-inline-section-title",
    title: "Event log",
    defaultCollapsed: true,
    collapseLabel: "Collapse event log",
    expandLabel: "Expand event log",
  });
  wireLegendCollapsibleSection(panel, {
    sectionId: LEGEND_LAUNCH_PANEL_SECTION_ID,
    titleSelector: ".legend-vehicle-label",
    title: "Tracking views",
    defaultCollapsed: false,
    collapseLabel: "Collapse launch controls",
    expandLabel: "Expand launch controls",
  });
  updateLaunchEventFeed();
  updateLegendBoosterFuelToggle();
  updateLegendTrajectoryToggle();

  return panel;
}

function setLaunchMissionControlCollapsed(collapsed) {
  launchMissionControlCollapsed = Boolean(collapsed);
  if (!launchMissionControlPanelNode) {
    return;
  }
  launchMissionControlPanelNode.classList.toggle("collapsed", launchMissionControlCollapsed);
  if (launchMissionControlToggleButton) {
    launchMissionControlToggleButton.textContent = launchMissionControlCollapsed ? "+" : "-";
    launchMissionControlToggleButton.setAttribute("aria-expanded", launchMissionControlCollapsed ? "false" : "true");
    launchMissionControlToggleButton.setAttribute(
      "aria-label",
      launchMissionControlCollapsed ? "Expand mission control" : "Collapse mission control",
    );
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function missionStatusBadge(label, tone = "neutral") {
  const safeTone = String(tone || "neutral").trim().toLowerCase();
  const allowedTone = (
    safeTone === "green"
    || safeTone === "red"
    || safeTone === "muted"
    || safeTone === "neutral"
  )
    ? safeTone
    : "neutral";
  return `<span class="legend-status-badge ${allowedTone}">${escapeHtml(label)}</span>`;
}

function missionMetricCell(label, value, options = {}) {
  const allowHtml = Boolean(options?.allowHtml);
  const renderedValue = allowHtml ? String(value ?? "") : escapeHtml(value);
  const valueClass = allowHtml ? "v html-value" : "v";
  return `<div class="legend-mission-metric"><span class="k">${escapeHtml(label)}</span><span class="${valueClass}">${renderedValue}</span></div>`;
}

function missionMetricGroup(title, metrics) {
  const cells = (Array.isArray(metrics) ? metrics : [])
    .map((metric) => missionMetricCell(metric.label, metric.value, metric))
    .join("");
  return `<section class="legend-mission-group"><p class="legend-mission-group-title">${escapeHtml(title)}</p><div class="legend-mission-grid">${cells}</div></section>`;
}

function launchTargetLabel(targetBodyName, targetBodyId) {
  const name = String(targetBodyName || "").trim();
  const id = String(targetBodyId || "").trim();
  if (id.startsWith("earth_refuel_tanker_")) {
    return id;
  }
  return name || "n/a";
}

function missionBar(label, percent, valueLabel) {
  const safePercent = Number.isFinite(Number(percent))
    ? Math.max(0, Math.min(100, Number(percent)))
    : 0;
  return `<div class="legend-mission-bar"><span class="label">${escapeHtml(label)}</span><div class="track"><span class="fill" style="width:${safePercent.toFixed(1)}%"></span></div><span class="value">${escapeHtml(valueLabel)}</span></div>`;
}

function updateLaunchMissionControlPanel(snapshot, launchActive) {
  if (!launchMissionControlPanelNode || !launchMissionControlMetricsNode || !launchMissionControlStatusNode) {
    return;
  }
  const active = Boolean(launchActive && snapshot);
  launchMissionControlPanelNode.classList.toggle("active", active);

  if (!snapshot) {
    launchMissionControlStatusNode.textContent = "Standby. Press Launch to open live mission control telemetry.";
    launchMissionControlMetricsNode.innerHTML = "<p class=\"legend-mission-empty\">Awaiting mission data.</p>";
    return;
  }

  const phaseLabel = snapshot.phaseLabel || phaseLabelForLaunch(snapshot.phase);
  const stageName = snapshot.stageName || "n/a";
  const missionElapsed = formatDurationSeconds(snapshot.elapsedSeconds);
  const guidance = snapshot.guidanceDisplayMode || snapshot.autopilotMode || snapshot.guidanceMode || "n/a";
  const throttlePct = Number.isFinite(Number(snapshot.throttle))
    ? Number(snapshot.throttle) * 100
    : Number.NaN;
  const thrustMN = Number.isFinite(Number(snapshot.thrustN))
    ? Number(snapshot.thrustN) / 1_000_000
    : Number.NaN;
  const dynamicPressureKPa = Number.isFinite(Number(snapshot.dynamicPressurePa))
    ? Number(snapshot.dynamicPressurePa) / 1000
    : Number.NaN;
  const targetTelemetry = resolveSnapshotTargetTelemetry(snapshot);
  const targetEtaSeconds = Number.isFinite(Number(targetTelemetry.targetEtaSeconds))
    ? Number(targetTelemetry.targetEtaSeconds)
    : Number.NaN;
  const targetRateLabel = String(targetTelemetry.targetRateLabel || "Closing").trim() || "Closing";
  const targetEtaLabel = String(targetTelemetry.targetEtaLabel || "ETA").trim() || "ETA";
  const moonRelativeSpeedKmS = Number(snapshot.moonRelativeSpeedKmS);
  const moonProjectedMissDistanceKm = Number(snapshot.moonProjectedMissDistanceKm);
  const moonWindowWaitSec = Number(snapshot.moonDepartureWindowWaitSec);
  const moonWindowWaitLabel = Number.isFinite(moonWindowWaitSec)
    ? formatDurationSeconds(Math.max(0, moonWindowWaitSec))
    : "n/a";
  const moonWindowReadyLabel = snapshot.moonDepartureWindowReady ? "ready" : "wait";
  const moonWindowLaunchClockLabel = Number.isFinite(Number(snapshot.moonDepartureWindowLaunchTimeMs))
    ? new Date(Number(snapshot.moonDepartureWindowLaunchTimeMs)).toLocaleTimeString()
    : "n/a";
  const missionPhaseGateReason = String(snapshot.missionPhaseGateReason || "").trim();
  const targetBodyLabel = launchTargetLabel(snapshot?.targetBodyName, snapshot?.targetBodyId);
  const boosterFuelPct = Number.isFinite(Number(snapshot.boosterFuelFraction))
    ? Number(snapshot.boosterFuelFraction) * 100
    : Number.NaN;
  const qAlphaPct = Number.isFinite(Number(snapshot.qAlphaPaRad))
    ? (Number(snapshot.qAlphaPaRad) / 1600) * 100
    : Number.NaN;
  const guidanceBurnRequested = Boolean(snapshot.guidanceBurnRequested);
  const guidanceRequestedThrottlePct = Number.isFinite(Number(snapshot.guidanceRequestedThrottle))
    ? Number(snapshot.guidanceRequestedThrottle) * 100
    : Number.NaN;
  const guidanceInertNoPropellant = Boolean(snapshot.guidanceInertNoPropellant);
  const guidanceInertReason = String(snapshot.guidanceInertReason || "").trim();
  const fuelBudgetRequiredDeltaVKmS = Number(snapshot.fuelBudgetRequiredDeltaVKmS);
  const fuelBudgetAvailableDeltaVKmS = Number(snapshot.fuelBudgetAvailableDeltaVKmS);
  const fuelBudgetMinimumPropellantKg = Number(snapshot.fuelBudgetMinimumPropellantKg);
  const fuelBudgetAvailablePropellantKg = Number(snapshot.fuelBudgetAvailablePropellantKg);
  const fuelBudgetMarginKg = Number(snapshot.fuelBudgetMarginKg);
  const fuelBudgetFeasible = snapshot.fuelBudgetFeasible === null || snapshot.fuelBudgetFeasible === undefined
    ? null
    : Boolean(snapshot.fuelBudgetFeasible);
  const guidanceStatusIndicator = guidanceInertNoPropellant
    ? missionStatusBadge("INERT (NO PROP)", "red")
    : (
      guidanceBurnRequested
        ? missionStatusBadge("BURN REQUESTED", "green")
        : missionStatusBadge("GUIDANCE HOLD", "muted")
    );
  const fuelBudgetStatusIndicator = fuelBudgetFeasible === null
    ? missionStatusBadge("n/a", "muted")
    : missionStatusBadge(
      fuelBudgetFeasible ? "FEASIBLE" : "DEFICIT",
      fuelBudgetFeasible ? "green" : "red",
    );
  const refuelOnlineTankers = Math.max(0, Number(snapshot.refuelOnlineTankers) || 0);
  const refuelAvailableTankers = Math.max(
    0,
    Number(snapshot.refuelAvailableTankers) || Number(snapshot.refuelActiveFlights) || Number(snapshot.refuelAtSlotTankers) || 0,
  );
  const tankerStatusIndicator = `<span class="legend-status-badges">${
    missionStatusBadge(
      `AVAILABLE ${refuelAvailableTankers}`,
      refuelAvailableTankers > 0 ? "green" : "muted",
    )
  }${
    missionStatusBadge(
      `ONLINE ${refuelOnlineTankers}`,
      refuelOnlineTankers > 0 ? "green" : "muted",
    )
  }</span>`;
  const hotstageProgressPct = Boolean(snapshot.hotstageActive)
    && Number.isFinite(Number(snapshot.hotstageTimeSinceIgnitionSec))
    && Number.isFinite(Number(snapshot.hotstageOverlapSeconds))
    && Number(snapshot.hotstageOverlapSeconds) > 0
    ? (Number(snapshot.hotstageTimeSinceIgnitionSec) / Number(snapshot.hotstageOverlapSeconds)) * 100
    : Number.NaN;

  launchMissionControlStatusNode.textContent = active
    ? `LIVE ${phaseLabel} | ${stageName} | MET ${missionElapsed}`
    : `Standby | ${phaseLabel} | Last MET ${missionElapsed}`;

  const vehicleMetrics = [
    { label: "Mission", value: snapshot.missionName || "n/a" },
    { label: "Phase", value: snapshot.missionPhaseDisplay || snapshot.missionPhase || "n/a" },
    { label: "Guidance", value: guidance },
    { label: "Target Orbit", value: Number.isFinite(Number(snapshot.targetOrbitAltitudeKm)) ? `${formatNumber(snapshot.targetOrbitAltitudeKm, 0)} km` : "n/a" },
    { label: "Altitude", value: Number.isFinite(Number(snapshot.altitudeKm)) ? `${formatNumber(snapshot.altitudeKm, 3)} km` : "n/a" },
    {
      label: "Altitude AGL",
      value: shouldShowTerrainRelativeAltitude(snapshot) && Number.isFinite(Number(snapshot.altitudeAboveTerrainKm))
        ? `${formatNumber(snapshot.altitudeAboveTerrainKm, 3)} km`
        : "n/a",
    },
    { label: "Earth-rel V", value: formatLaunchSpeedValue(snapshot.earthRelativeSpeedKmS ?? snapshot.speedKmS, 4) },
    { label: "Ground V", value: formatLaunchSpeedValue(snapshot.groundRelativeSpeedKmS, 4) },
    { label: "Air V", value: formatLaunchSpeedValue(snapshot.airRelativeSpeedKmS, 4) },
    { label: "Mass", value: Number.isFinite(Number(snapshot.massKg)) ? `${formatNumber(snapshot.massKg, 0)} kg` : "n/a" },
  ];

  const navigationMetrics = [
    { label: "Apo/Peri", value: `${Number.isFinite(Number(snapshot.apoapsisKm)) ? `${formatNumber(snapshot.apoapsisKm, 2)} km` : "n/a"} / ${Number.isFinite(Number(snapshot.periapsisKm)) ? `${formatNumber(snapshot.periapsisKm, 2)} km` : "n/a"}` },
    { label: "Radial", value: Number.isFinite(Number(snapshot.radialSpeedKmS)) ? `${formatNumber(snapshot.radialSpeedKmS, 4)} km/s` : "n/a" },
    { label: "Tangential", value: Number.isFinite(Number(snapshot.tangentialSpeedKmS)) ? `${formatNumber(snapshot.tangentialSpeedKmS, 4)} km/s` : "n/a" },
    { label: "Circular", value: Number.isFinite(Number(snapshot.circularSpeedKmS)) ? `${formatNumber(snapshot.circularSpeedKmS, 4)} km/s` : "n/a" },
    { label: "Target Body", value: targetBodyLabel },
    { label: "Target Dist", value: Number.isFinite(Number(snapshot.targetDistanceKm)) ? `${formatNumber(snapshot.targetDistanceKm, 1)} km` : "n/a" },
    { label: targetRateLabel, value: Number.isFinite(Number(snapshot.targetClosingSpeedKmS)) ? `${formatNumber(snapshot.targetClosingSpeedKmS, 4)} km/s` : "n/a" },
    { label: "Moon Rel V", value: Number.isFinite(moonRelativeSpeedKmS) ? `${formatNumber(moonRelativeSpeedKmS, 4)} km/s` : "n/a" },
    { label: "Proj Miss", value: Number.isFinite(moonProjectedMissDistanceKm) ? `${formatNumber(moonProjectedMissDistanceKm, 1)} km` : "n/a" },
    { label: "Miss Trend", value: Number.isFinite(Number(snapshot.moonProjectedMissTrendKmS)) ? `${formatNumber(snapshot.moonProjectedMissTrendKmS, 3)} km/s` : "n/a" },
    { label: "Perilune Est", value: Number.isFinite(Number(snapshot.moonProjectedPeriluneAltitudeKm)) ? `${formatNumber(snapshot.moonProjectedPeriluneAltitudeKm, 1)} km` : "n/a" },
    { label: "B-Plane Err", value: Number.isFinite(Number(snapshot.moonBPlaneErrorKm)) ? `${formatNumber(snapshot.moonBPlaneErrorKm, 1)} km` : "n/a" },
    { label: "Window Score", value: Number.isFinite(Number(snapshot.moonDepartureWindowScore)) ? `${formatNumber(Number(snapshot.moonDepartureWindowScore) * 100, 1)}%` : "n/a" },
    { label: "Window Geo", value: Number.isFinite(Number(snapshot.moonDepartureGeometryScore)) ? `${formatNumber(Number(snapshot.moonDepartureGeometryScore) * 100, 1)}%` : "n/a" },
    { label: "Align Now", value: Number.isFinite(Number(snapshot.moonDepartureAlignNow)) ? formatNumber(snapshot.moonDepartureAlignNow, 3) : "n/a" },
    { label: "Align Proj", value: Number.isFinite(Number(snapshot.moonDepartureAlignProjected)) ? formatNumber(snapshot.moonDepartureAlignProjected, 3) : "n/a" },
    { label: "Window In", value: moonWindowWaitLabel },
    { label: "Window Ready", value: moonWindowReadyLabel },
    { label: "Best Launch", value: moonWindowLaunchClockLabel },
    { label: "TLI Target", value: String(snapshot.moonTliTargetMode || "").trim() || "n/a" },
    { label: targetEtaLabel, value: Number.isFinite(targetEtaSeconds) ? formatDurationSeconds(targetEtaSeconds) : "n/a" },
    { label: "Phase Gate", value: missionPhaseGateReason || "n/a" },
  ];

  const aeroMetrics = [
    { label: "Thrust", value: Number.isFinite(thrustMN) ? `${formatNumber(thrustMN, 3)} MN` : "n/a" },
    { label: "Throttle", value: Number.isFinite(throttlePct) ? `${formatNumber(throttlePct, 1)}%` : "n/a" },
    { label: "Burn Rate", value: Number.isFinite(Number(snapshot.burnRateKgS)) ? `${formatNumber(snapshot.burnRateKgS, 1)} kg/s` : "n/a" },
    { label: "Dyn Pressure", value: Number.isFinite(dynamicPressureKPa) ? `${formatNumber(dynamicPressureKPa, 2)} kPa` : "n/a" },
    { label: "Mach", value: Number.isFinite(Number(snapshot.machNumber)) ? formatNumber(snapshot.machNumber, 3) : "n/a" },
    { label: "AoA", value: Number.isFinite(Number(snapshot.angleOfAttackDeg)) ? `${formatNumber(snapshot.angleOfAttackDeg, 2)}°` : "n/a" },
    { label: "q-alpha", value: Number.isFinite(Number(snapshot.qAlphaPaRad)) ? `${formatNumber(snapshot.qAlphaPaRad, 1)} Pa·rad` : "n/a" },
    { label: "Gimbal Err", value: Number.isFinite(Number(snapshot.gimbalErrorDeg)) ? `${formatNumber(snapshot.gimbalErrorDeg, 2)}°` : "n/a" },
    { label: "RCS Err", value: snapshot?.rcsActive && Number.isFinite(Number(snapshot.rcsErrorDeg)) ? `${formatNumber(snapshot.rcsErrorDeg, 2)}°` : "n/a" },
    { label: "RCS Attitude", value: snapshot?.rcsActive && Number.isFinite(Number(snapshot.rcsAttitudeAuthority)) ? `${formatNumber(clamp(Number(snapshot.rcsAttitudeAuthority), 0, 1) * 100, 1)}%` : "n/a" },
  ];

  const boosterMetrics = [
    { label: "Booster Phase", value: snapshot.boosterPhase || "n/a" },
    { label: "Booster Guidance", value: snapshot.boosterGuidanceMode || "n/a" },
    { label: "Booster Alt", value: Number.isFinite(Number(snapshot.boosterAltitudeKm)) ? `${formatNumber(snapshot.boosterAltitudeKm, 3)} km` : "n/a" },
    { label: "Booster Earth V", value: formatLaunchSpeedValue(snapshot.boosterEarthRelativeSpeedKmS ?? snapshot.boosterSpeedKmS, 4) },
    { label: "Booster Ground V", value: formatLaunchSpeedValue(snapshot.boosterGroundRelativeSpeedKmS, 4) },
    { label: "Booster Thrust", value: Number.isFinite(Number(snapshot.boosterThrustN)) ? `${formatNumber(Number(snapshot.boosterThrustN) / 1_000_000, 3)} MN` : "n/a" },
    { label: "Booster Throttle", value: Number.isFinite(Number(snapshot.boosterThrottle)) ? `${formatNumber(Number(snapshot.boosterThrottle) * 100, 1)}%` : "n/a" },
    { label: "Booster Fuel", value: Number.isFinite(Number(snapshot.boosterPropellantKg)) ? `${formatNumber(snapshot.boosterPropellantKg, 0)} kg` : "n/a" },
    { label: "Site Range", value: Number.isFinite(Number(snapshot.boosterLaunchSiteRangeKm)) ? `${formatNumber(snapshot.boosterLaunchSiteRangeKm, 3)} km` : "n/a" },
  ];

  const hotstageStatus = Boolean(snapshot.hotstageActive)
    ? `active${Number.isFinite(Number(snapshot.hotstageTimeSinceIgnitionSec)) ? ` (${formatNumber(snapshot.hotstageTimeSinceIgnitionSec, 2)}s)` : ""}`
    : (snapshot.hotstageDetachReason ? `detached: ${snapshot.hotstageDetachReason}` : "inactive");
  const spaceWeather = currentSpaceWeatherSnapshot();
  const spaceWeatherSummary = spaceWeather
    ? `F10.7 ${formatNumber(spaceWeather.f107, 1)} sfu | Kp ${formatNumber(spaceWeather.kp, 2)}`
    : "n/a";
  const spaceWeatherSourceLine = spaceWeather
    ? `${spaceWeather.source || "n/a"}${Number.isFinite(spaceWeather.ageSeconds) ? ` (${formatNumber(spaceWeather.ageSeconds, 0)}s age)` : ""}`
    : "n/a";
  const transferProgressPct = Number.isFinite(Number(snapshot.refuelTransferProgress))
    ? Number(snapshot.refuelTransferProgress) * 100
    : Number.NaN;
  const transferRateKgS = Number(snapshot.refuelTransferRateKgS);
  const transferRemainingKg = Number(snapshot.refuelTransferRemainingKg);
  const transferTankerId = String(snapshot.refuelTransferTankerId || "");
  const refuelFillFraction = clamp(Number(snapshot.refuelFillFraction) || 0, 0, 1);
  const refuelTargetReady = refuelFillFraction >= 0.88;
  const fuelStatusIndicator = `<span class="legend-status-badges">${
    missionStatusBadge(
      refuelTargetReady ? "FUEL FULL" : "FUEL LOW",
      refuelTargetReady ? "green" : "red",
    )
  }</span>`;
  const transferStateLabel = Boolean(snapshot.refuelTransferActive)
    ? `fueling${Number.isFinite(transferProgressPct) ? ` ${formatNumber(transferProgressPct, 1)}%` : ""}`
    : (snapshot.refuelUndockActive ? "undocking" : "idle");
  const hotstageMetrics = [
    { label: "Hot-Stage", value: hotstageStatus },
    { label: "Tanker Status", value: tankerStatusIndicator, allowHtml: true },
    { label: "Fuel Status", value: fuelStatusIndicator, allowHtml: true },
    { label: "Refuel Flights", value: `${Math.max(0, Number(snapshot.refuelCompletedFlights) || 0)} / ${Math.max(0, Number(snapshot.refuelRequiredFlights) || 0)}` },
    { label: "Refuel Fill", value: Number.isFinite(Number(snapshot.refuelFillFraction)) ? `${formatNumber(Number(snapshot.refuelFillFraction) * 100, 1)}%` : "n/a" },
    { label: "Refuel State", value: transferStateLabel },
    { label: "Transfer Tanker", value: transferTankerId || "n/a" },
    { label: "Transfer Rate", value: Number.isFinite(transferRateKgS) && transferRateKgS > 0 ? `${formatNumber(transferRateKgS, 1)} kg/s` : "n/a" },
    { label: "Transfer Rem", value: Number.isFinite(transferRemainingKg) && transferRemainingKg > 0 ? `${formatNumber(transferRemainingKg, 0)} kg` : "n/a" },
    { label: "Tanker Window", value: snapshot.refuelCanLaunchTanker ? "open" : "closed" },
    { label: "Space Wx", value: spaceWeatherSummary },
    { label: "Space Wx Src", value: spaceWeatherSourceLine },
    { label: "Overlap Gate", value: Number.isFinite(Number(snapshot.hotstageOverlapSeconds)) ? `${formatNumber(snapshot.hotstageOverlapSeconds, 2)} s` : "n/a" },
    { label: "Stable Ignition", value: Number.isFinite(Number(snapshot.hotstageIgnitionStableSec)) ? `${formatNumber(snapshot.hotstageIgnitionStableSec, 2)} s` : "n/a" },
    { label: "Virtual Sep", value: Number.isFinite(Number(snapshot.hotstageVirtualSeparationKm)) ? `${formatNumber(snapshot.hotstageVirtualSeparationKm, 4)} km` : "n/a" },
    { label: "Wind E/N", value: Number.isFinite(Number(snapshot.windEastMS)) && Number.isFinite(Number(snapshot.windNorthMS)) ? `${formatNumber(snapshot.windEastMS, 1)} / ${formatNumber(snapshot.windNorthMS, 1)} m/s` : "n/a" },
    { label: "RCS", value: snapshot.rcsActive ? `active (${formatNumber((Number(snapshot.rcsAuthority) || 0) * 100, 1)}%)` : "off" },
    { label: "Last Event", value: lastLaunchEventSummary || "n/a" },
    { label: "Event Age", value: lastLaunchEventTimestampUtc ? `${formatNumber(Math.max(0, (Date.now() - Date.parse(lastLaunchEventTimestampUtc)) / 1000), 1)} s` : "n/a" },
  ];
  const guidanceFuelMetrics = [
    { label: "Guidance Burn", value: guidanceStatusIndicator, allowHtml: true },
    { label: "Burn Requested", value: guidanceBurnRequested ? "yes" : "no" },
    { label: "Cmd Throttle", value: Number.isFinite(guidanceRequestedThrottlePct) ? `${formatNumber(guidanceRequestedThrottlePct, 1)}%` : "n/a" },
    { label: "Inert Reason", value: guidanceInertNoPropellant ? (guidanceInertReason || "no-propellant-for-guidance-burn") : "n/a" },
    { label: "Fuel Budget", value: fuelBudgetStatusIndicator, allowHtml: true },
    { label: "DV Req/Avail", value: Number.isFinite(fuelBudgetRequiredDeltaVKmS) && Number.isFinite(fuelBudgetAvailableDeltaVKmS) ? `${formatNumber(fuelBudgetRequiredDeltaVKmS, 3)} / ${formatNumber(fuelBudgetAvailableDeltaVKmS, 3)} km/s` : "n/a" },
    { label: "Prop Req", value: Number.isFinite(fuelBudgetMinimumPropellantKg) ? `${formatNumber(fuelBudgetMinimumPropellantKg, 0)} kg` : "n/a" },
    { label: "Prop Avail", value: Number.isFinite(fuelBudgetAvailablePropellantKg) ? `${formatNumber(fuelBudgetAvailablePropellantKg, 0)} kg` : "n/a" },
    { label: "Prop Margin", value: Number.isFinite(fuelBudgetMarginKg) ? `${formatNumber(fuelBudgetMarginKg, 0)} kg` : "n/a" },
    { label: "Ship->Moon", value: Number.isFinite(Number(snapshot.fuelBudgetShipToMoonDistanceKm)) ? `${formatNumber(snapshot.fuelBudgetShipToMoonDistanceKm, 1)} km` : "n/a" },
  ];

  const bars = [
    missionBar("Throttle", throttlePct, Number.isFinite(throttlePct) ? `${formatNumber(throttlePct, 1)}%` : "n/a"),
    missionBar("q-alpha Load", qAlphaPct, Number.isFinite(qAlphaPct) ? `${formatNumber(Math.max(0, Math.min(100, qAlphaPct)), 1)}%` : "n/a"),
    missionBar("Booster Fuel", boosterFuelPct, Number.isFinite(boosterFuelPct) ? `${formatNumber(boosterFuelPct, 1)}%` : "n/a"),
    missionBar("Fuel Transfer", transferProgressPct, Number.isFinite(transferProgressPct) ? `${formatNumber(Math.max(0, Math.min(100, transferProgressPct)), 1)}%` : "n/a"),
    missionBar("Hot-Stage Gate", hotstageProgressPct, Number.isFinite(hotstageProgressPct) ? `${formatNumber(Math.max(0, Math.min(100, hotstageProgressPct)), 1)}%` : "n/a"),
  ].join("");

  launchMissionControlMetricsNode.innerHTML = [
    missionMetricGroup("Vehicle", vehicleMetrics),
    missionMetricGroup("Navigation", navigationMetrics),
    missionMetricGroup("Aero / Propulsion", aeroMetrics),
    missionMetricGroup("Guidance / Fuel", guidanceFuelMetrics),
    missionMetricGroup("Booster", boosterMetrics),
    missionMetricGroup("Hot Stage / Ops", hotstageMetrics),
    `<section class="legend-mission-group"><p class="legend-mission-group-title">Loads</p><div class="legend-mission-bars">${bars}</div></section>`,
  ].join("");
}

function sortBySemimajorAxisThenName(a, b) {
  const aAxis = Number(a?.semimajor_axis_km);
  const bAxis = Number(b?.semimajor_axis_km);
  const safeA = Number.isFinite(aAxis) ? aAxis : Number.POSITIVE_INFINITY;
  const safeB = Number.isFinite(bAxis) ? bAxis : Number.POSITIVE_INFINITY;
  if (safeA !== safeB) {
    return safeA - safeB;
  }
  return (a?.name || "").localeCompare(b?.name || "");
}

function normalizeLegendParentKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_-]/g, "");
}

function moonBelongsToPlanet(moon, planet) {
  if (!moon || !planet || moon.body_type !== "moon") {
    return false;
  }
  const parentKey = normalizeLegendParentKey(moon.parent);
  if (!parentKey) {
    return false;
  }
  const planetIdKey = normalizeLegendParentKey(planet.id);
  const planetNameKey = normalizeLegendParentKey(planet.name);
  return parentKey === planetIdKey || parentKey === planetNameKey;
}

function updateLegendSelection() {
  for (const [bodyId, button] of legendButtonsById.entries()) {
    button.classList.toggle("selected", bodyId === selectedId);
  }
  syncLegendPlanetAccordionsWithSelection();
  refreshLegendAccordionHeights();
  updateLegendVehicleViewButtons();
}

function isBodyNBodyFallback(bodyId) {
  return legendVehicleStatusController.isBodyNBodyFallback(bodyId);
}

function isRefuelTankerBodyId(bodyId) {
  return legendVehicleStatusController.isRefuelTankerBodyId(bodyId);
}

function tankerLegendReadyState(bodyId, nowMs = Date.now()) {
  return legendVehicleStatusController.tankerLegendReadyState(bodyId, nowMs);
}

function fuelingLegendState(bodyId, nowMs = Date.now()) {
  return legendVehicleStatusController.fuelingLegendState(bodyId, nowMs);
}

function updateLegendFallbackIndicators() {
  legendVehicleStatusController.updateLegendFallbackIndicators(Date.now());
}

function updateLegendGravityArrowIndicators() {
  for (const [bodyId, button] of legendButtonsById.entries()) {
    const isArrowEnabled = Boolean(
      gravityArrowsLegendActivated &&
      gravityArrowFocusBodyId === bodyId,
    );
    const isAccordionPlanet = legendPlanetAccordionContentById.has(bodyId);
    const showGravityCaret = Boolean(
      selectedId === bodyId &&
      supportsLegendGravityControl(bodyId) &&
      !isAccordionPlanet,
    );
    button.classList.toggle("show-gravity-caret", showGravityCaret);
    button.classList.toggle("gravity-arrow-enabled", isArrowEnabled);
    if (showGravityCaret && !isAccordionPlanet) {
      button.setAttribute("aria-expanded", "true");
    } else if (!isAccordionPlanet) {
      button.removeAttribute("aria-expanded");
    }
  }

  for (const [bodyId, panel] of legendGravityPanelsById.entries()) {
    const open = Boolean(
      selectedId === bodyId &&
      supportsLegendGravityControl(bodyId),
    );
    panel.classList.toggle("open", open);
  }

  for (const [bodyId, toggle] of legendGravityToggleButtonsById.entries()) {
    const enabled = Boolean(
      gravityArrowsLegendActivated &&
      gravityArrowFocusBodyId === bodyId &&
      selectedId === bodyId,
    );
    toggle.textContent = enabled ? "On" : "Off";
    toggle.classList.toggle("on", enabled);
    toggle.setAttribute("aria-pressed", enabled ? "true" : "false");
  }
  refreshLegendAccordionHeights();
  updateLegendVehicleViewButtons();
}

function updateLegendVehicleViewButtons() {
  const viewState = launchVehicleViewState();

  const starshipButton = legendVehicleViewButtonsByKey.starship;
  if (starshipButton) {
    starshipButton.disabled = !viewState.starshipViewAvailable;
    starshipButton.classList.toggle("on", viewState.starshipActive);
    starshipButton.setAttribute("aria-pressed", viewState.starshipActive ? "true" : "false");
  }

  const boosterButton = legendVehicleViewButtonsByKey.booster;
  if (boosterButton) {
    boosterButton.disabled = !viewState.boosterViewAvailable;
    boosterButton.classList.toggle("on", viewState.boosterActive);
    boosterButton.setAttribute("aria-pressed", viewState.boosterActive ? "true" : "false");
  }
  updateLegendBoosterFuelToggle();
  updateLegendTrajectoryToggle();
  updateLegendFleetManager();
}

function missionControlVehicleViewState() {
  const viewState = launchVehicleViewState();
  return {
    activeView: viewState.activeView,
    boosterViewAvailable: viewState.boosterViewAvailable,
    starshipViewAvailable: viewState.starshipViewAvailable,
    statusLine: viewState.statusLine,
  };
}

function missionControlFleetEntries(nowMs = Date.now()) {
  const vehicleIds = listManageableTelemetryVehicleIds();
  const entries = [];
  for (let i = 0; i < vehicleIds.length; i += 1) {
    const bodyId = vehicleIds[i];
    const snapshot = launchFeatureEnabled
      && launchController
      && nBodyState?.initialized
      && typeof launchController?.statusSnapshotForBody === "function"
      ? (launchController.statusSnapshotForBody(nBodyState, bodyId, nowMs) || null)
      : null;
    const inferredKind = bodyId === LAUNCH_BOOSTER_BODY_ID
      ? "booster"
      : (
        bodyId.startsWith("earth_refuel_tanker_")
          ? "tanker"
          : "starship"
      );
    entries.push({
      bodyId,
      vehicleName: String(snapshot?.vehicleName || metaById.get(bodyId)?.name || bodyId),
      vehicleKind: String(snapshot?.vehicleKind || inferredKind),
      missionName: String(snapshot?.missionName || "Mission"),
      missionPhase: String(snapshot?.missionPhase || ""),
      phaseLabel: String(snapshot?.phaseLabel || phaseLabelForLaunch(snapshot?.phase)),
      stageName: String(snapshot?.stageName || ""),
      guidanceMode: String(snapshot?.guidanceMode || snapshot?.autopilotMode || "n/a"),
      guidanceDisplayMode: String(snapshot?.guidanceDisplayMode || snapshot?.guidanceMode || snapshot?.autopilotMode || "n/a"),
      altitudeKm: Number(snapshot?.altitudeKm),
      speedKmS: Number(snapshot?.speedKmS),
      tracked: String(selectedId || "") === bodyId,
      selectable: hasVisibleBodyState(bodyId),
    });
  }
  return entries;
}

function updateLegendBoosterFuelToggle() {
  if (!legendBoosterFuelToggleButton) {
    return;
  }
  const boosterViewAvailable = hasVisibleBodyState(LAUNCH_BODY_ID) || hasVisibleBodyState(LAUNCH_BOOSTER_BODY_ID);
  legendBoosterFuelToggleButton.disabled = !boosterViewAvailable;
  legendBoosterFuelToggleButton.textContent = boosterFuelViewEnabled ? "On" : "Off";
  legendBoosterFuelToggleButton.classList.toggle("on", boosterFuelViewEnabled);
  legendBoosterFuelToggleButton.setAttribute("aria-pressed", boosterFuelViewEnabled ? "true" : "false");
}

function updateLegendTrajectoryToggle() {
  if (!legendTrajectoryPathToggleButton) {
    return;
  }
  const launchViewAvailable = hasVisibleBodyState(LAUNCH_BODY_ID);
  legendTrajectoryPathToggleButton.disabled = !launchViewAvailable;
  legendTrajectoryPathToggleButton.textContent = trajectoryPathViewEnabled ? "On" : "Off";
  legendTrajectoryPathToggleButton.classList.toggle("on", trajectoryPathViewEnabled);
  legendTrajectoryPathToggleButton.setAttribute("aria-pressed", trajectoryPathViewEnabled ? "true" : "false");
}

function setupPhysicsOverlayControls() {
  if (physicsTidalToggleButton) {
    physicsTidalToggleButton.addEventListener("click", () => {
      setPhysicsOverlayToggle("tidal", !physicsOverlayState.tidal);
    });
  }
  if (physicsLagrangeToggleButton) {
    physicsLagrangeToggleButton.addEventListener("click", () => {
      setPhysicsOverlayToggle("lagrange", !physicsOverlayState.lagrange);
    });
  }
  if (physicsAtmosphereToggleButton) {
    physicsAtmosphereToggleButton.addEventListener("click", () => {
      setPhysicsOverlayToggle("atmosphere", !physicsOverlayState.atmosphere);
    });
  }
  updatePhysicsOverlayControls();
  syncPhysicsOverlayControllerStates();
}

function setPhysicsOverlayToggle(key, enabled) {
  if (!(key in physicsOverlayState)) {
    return;
  }
  physicsOverlayState[key] = Boolean(enabled);
  updatePhysicsOverlayControls();
  syncPhysicsOverlayControllerStates();
  updatePhysicsOverlays();
}

function syncPhysicsOverlayControllerStates() {
  tidalOverlayController?.setEnabled(physicsOverlayState.tidal);
  lagrangeOverlayController?.setEnabled(physicsOverlayState.lagrange);
  earthAtmosphereController?.setEnabled(physicsOverlayState.atmosphere);
}

function updatePhysicsOverlayControls() {
  if (physicsTidalToggleButton) {
    physicsTidalToggleButton.textContent = physicsOverlayState.tidal ? "On" : "Off";
    physicsTidalToggleButton.classList.toggle("on", physicsOverlayState.tidal);
    physicsTidalToggleButton.setAttribute("aria-pressed", physicsOverlayState.tidal ? "true" : "false");
  }
  if (physicsLagrangeToggleButton) {
    physicsLagrangeToggleButton.textContent = physicsOverlayState.lagrange ? "On" : "Off";
    physicsLagrangeToggleButton.classList.toggle("on", physicsOverlayState.lagrange);
    physicsLagrangeToggleButton.setAttribute("aria-pressed", physicsOverlayState.lagrange ? "true" : "false");
  }
  if (physicsAtmosphereToggleButton) {
    physicsAtmosphereToggleButton.textContent = physicsOverlayState.atmosphere ? "On" : "Off";
    physicsAtmosphereToggleButton.classList.toggle("on", physicsOverlayState.atmosphere);
    physicsAtmosphereToggleButton.setAttribute("aria-pressed", physicsOverlayState.atmosphere ? "true" : "false");
  }
  if (physicsOverlayStatusNode) {
    const tidalStatus = physicsOverlayState.tidal ? "On (Earth/Moon)" : "Off";
    const lagrangeStatus = physicsOverlayState.lagrange ? "On (Sun-Earth + Earth-Moon)" : "Off";
    const atmosphereStatus = physicsOverlayState.atmosphere ? "On (Earth layers + scattering)" : "Off";
    physicsOverlayStatusNode.textContent = `Tidal: ${tidalStatus} | Lagrange: ${lagrangeStatus} | Atmosphere: ${atmosphereStatus}`;
  }
}

function buildLaunchMissionProfileCatalog() {
  const controllerProfiles = launchController?.getMissionProfiles?.() || [];
  const mergedProfileById = new Map();
  for (const profile of controllerProfiles) {
    const id = String(profile?.id || "").trim();
    if (!id) {
      continue;
    }
    mergedProfileById.set(id, {
      id,
      name: String(profile?.name || id),
      description: String(profile?.description || profile?.name || id),
    });
  }
  for (const profile of REQUIRED_LAUNCH_MISSION_PROFILES) {
    if (!mergedProfileById.has(profile.id)) {
      mergedProfileById.set(profile.id, { ...profile });
    }
  }
  return Array.from(mergedProfileById.values());
}

function missionLaunchModeDisplayLabel(mode) {
  return String(mode || "").trim().toLowerCase() === "orbit_inject"
    ? "Direct Orbit Inject"
    : "Earth Pad Launch";
}

function tankerLaunchModeDisplayLabel(mode) {
  return String(mode || "").trim().toLowerCase() === "orbit_inject"
    ? "Direct Orbit Inject"
    : "Earth Pad Launch";
}

function activeSelectedMissionId() {
  const selected = String(legendLaunchMissionSelect?.value || "").trim();
  if (selected) {
    return selected;
  }
  const staged = String(stagedLaunchMissionId || "").trim();
  if (staged) {
    return staged;
  }
  return String(launchController?.getMissionProfile?.()?.id || "").trim();
}

function applyLaunchMissionSelection(selectedMissionId) {
  const selected = String(selectedMissionId || "").trim();
  if (!selected) {
    return null;
  }
  const active = Boolean(launchController?.isActive?.());
  const profiles = buildLaunchMissionProfileCatalog();
  const selectedProfile = profiles.find((profile) => profile.id === selected) || null;
  const selectedName = String(selectedProfile?.name || selected || "Mission").trim() || "Mission";
  stagedLaunchMissionId = selected;
  if (legendLaunchMissionSelect && legendLaunchMissionSelect.value !== selected) {
    legendLaunchMissionSelect.value = selected;
  }
  if (!launchController) {
    updateLaunchStatusPanel(
      true,
      `Mission staged: ${selectedName}. Launch controller is still initializing.`,
    );
    warmSelectedMissionLaunchSolve();
    return {
      accepted: true,
      staged: true,
      id: selected,
      name: selectedName,
    };
  }
  if (active) {
    appendLaunchLogEntry("info", {
      name: "mission_selection_staged",
      selectedMissionId: selected,
      selectedMissionName: selectedName,
    });
    updateLaunchStatusPanel(
      true,
      `Mission staged for next launch stack: ${selectedName}. Active mission remains unchanged.`,
    );
    return {
      accepted: true,
      staged: true,
      id: selected,
      name: selectedName,
    };
  }
  const applied = launchController?.setMissionProfile?.(selected) || null;
  if (!applied || String(applied.id || "") !== selected) {
    if (legendLaunchMissionSelect && applied?.id) {
      legendLaunchMissionSelect.value = String(applied.id);
    }
    stagedLaunchMissionId = String(applied?.id || stagedLaunchMissionId || selected).trim();
    appendLaunchLogEntry("error", {
      name: "mission_selection_rejected",
      selectedMissionId: selected,
      resolvedMissionId: String(applied?.id || ""),
    });
    return {
      accepted: false,
      staged: false,
      id: String(applied?.id || ""),
      name: String(applied?.name || ""),
    };
  }
  stagedLaunchMissionId = String(applied.id || selected).trim();
  appendLaunchLogEntry("info", {
    name: "mission_selection_changed",
    selectedMissionId: applied.id,
    selectedMissionName: applied.name,
  });
  updateLaunchStatusPanel(true, `Mission selected: ${applied.name}`);
  warmSelectedMissionLaunchSolve();
  return {
    accepted: true,
    staged: false,
    id: String(applied.id || ""),
    name: String(applied.name || ""),
  };
}

function setMissionLaunchModeSelection(mode, options = {}) {
  const resolved = String(mode || "").trim().toLowerCase() === "orbit_inject"
    ? "orbit_inject"
    : "pad_launch";
  const previous = selectedMissionLaunchMode();
  if (legendMissionLaunchModeSelect) {
    legendMissionLaunchModeSelect.value = resolved;
  }
  if (!options.silent && previous !== resolved) {
    appendLaunchLogEntry("info", {
      name: "mission_launch_mode_changed",
      mode: resolved,
    });
    updateLaunchStatusPanel(true, `Mission launch mode set: ${missionLaunchModeDisplayLabel(resolved)}.`);
  }
  warmSelectedMissionLaunchSolve();
  return resolved;
}

function setTankerLaunchModeSelection(mode, options = {}) {
  const resolved = String(mode || "").trim().toLowerCase() === "orbit_inject"
    ? "orbit_inject"
    : "pad_launch";
  const previous = selectedTankerLaunchMode();
  if (legendTankerLaunchModeSelect) {
    legendTankerLaunchModeSelect.value = resolved;
  }
  if (!options.silent && previous !== resolved) {
    appendLaunchLogEntry("info", {
      name: "tanker_launch_mode_changed",
      mode: resolved,
    });
    updateLaunchStatusPanel(true, `Tanker launch mode set: ${tankerLaunchModeDisplayLabel(resolved)}.`);
  }
  return resolved;
}

function missionControlMissionPickerState(snapshot = null) {
  const profiles = buildLaunchMissionProfileCatalog();
  const selectedMissionId = activeSelectedMissionId() || profiles[0]?.id || "";
  const activeMissionId = snapshot?.missionId
    ? String(snapshot.missionId)
    : (launchController?.isActive?.() ? String(launchController?.getMissionProfile?.()?.id || "") : "");
  return {
    profiles,
    selectedMissionId,
    activeMissionId,
    missionLaunchMode: selectedMissionLaunchMode(),
    tankerLaunchMode: selectedTankerLaunchMode(),
    launchActive: Boolean(launchController?.isActive?.()),
    controllerReady: Boolean(launchController),
  };
}

function setupLaunchMissionPicker() {
  if (!legendLaunchMissionSelect) {
    return;
  }
  const profiles = buildLaunchMissionProfileCatalog();
  const selectedProfile = launchController?.getMissionProfile?.() || null;
  const selectedId = String(
    stagedLaunchMissionId
      || legendLaunchMissionSelect.value
      || selectedProfile?.id
      || "",
  ).trim();

  legendLaunchMissionSelect.innerHTML = "";
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    option.title = profile.description || profile.name;
    legendLaunchMissionSelect.appendChild(option);
  }
  if (selectedId && profiles.some((profile) => profile.id === selectedId)) {
    legendLaunchMissionSelect.value = selectedId;
  } else if (profiles.length > 0) {
    legendLaunchMissionSelect.value = profiles[0].id;
  }
  stagedLaunchMissionId = String(legendLaunchMissionSelect.value || stagedLaunchMissionId || "").trim();
  legendLaunchMissionSelect.disabled = profiles.length <= 0;

  if (legendLaunchMissionSelect.dataset.bound !== "true") {
    legendLaunchMissionSelect.addEventListener("change", async () => {
      stagedLaunchMissionId = String(legendLaunchMissionSelect.value || stagedLaunchMissionId || "").trim();
      await ensureLaunchRuntimeReady();
      applyLaunchMissionSelection(legendLaunchMissionSelect.value);
    });
    legendLaunchMissionSelect.dataset.bound = "true";
  }
}

function isLaunchTelemetryVehicleId(bodyId) {
  return isLaunchTelemetryVehicleIdView(bodyId, {
    launchBodyId: LAUNCH_BODY_ID,
    launchBoosterBodyId: LAUNCH_BOOSTER_BODY_ID,
  });
}

function activeLaunchTelemetryBodyId() {
  return activeLaunchTelemetryBodyIdView({
    selectedId,
    launchVehicleViewPreference,
    hasVisibleBodyState,
    launchBodyId: LAUNCH_BODY_ID,
    launchBoosterBodyId: LAUNCH_BOOSTER_BODY_ID,
  });
}

function launchTelemetryVehicleSortKey(bodyId) {
  const id = String(bodyId || "");
  if (id === String(LAUNCH_BODY_ID)) {
    return { bucket: 0, sequence: 0, id };
  }
  if (id === String(LAUNCH_BOOSTER_BODY_ID)) {
    return { bucket: 1, sequence: 0, id };
  }
  if (id.startsWith("earth_mission_ship_")) {
    const sequence = Number(id.match(/_(\d+)$/)?.[1]);
    return {
      bucket: 2,
      sequence: Number.isFinite(sequence) ? sequence : Number.POSITIVE_INFINITY,
      id,
    };
  }
  if (id.startsWith("earth_refuel_tanker_")) {
    const sequence = Number(id.match(/_(\d+)$/)?.[1]);
    return {
      bucket: 3,
      sequence: Number.isFinite(sequence) ? sequence : Number.POSITIVE_INFINITY,
      id,
    };
  }
  return { bucket: 4, sequence: Number.POSITIVE_INFINITY, id };
}

function compareLaunchTelemetryVehicleIds(a, b) {
  const keyA = launchTelemetryVehicleSortKey(a);
  const keyB = launchTelemetryVehicleSortKey(b);
  if (keyA.bucket !== keyB.bucket) {
    return keyA.bucket - keyB.bucket;
  }
  if (keyA.sequence !== keyB.sequence) {
    return keyA.sequence - keyB.sequence;
  }
  const labelA = String(metaById.get(String(a || ""))?.name || keyA.id);
  const labelB = String(metaById.get(String(b || ""))?.name || keyB.id);
  return labelA.localeCompare(labelB);
}

function listManageableTelemetryVehicleIds() {
  const ids = [];
  for (let i = 0; i < bodies.length; i += 1) {
    const id = String(bodies[i]?.id || "");
    if (!id || !isLaunchTelemetryVehicleId(id)) {
      continue;
    }
    if (!hasVisibleBodyState(id)) {
      continue;
    }
    ids.push(id);
  }
  ids.sort(compareLaunchTelemetryVehicleIds);
  return ids;
}

function formatLaunchPhaseLabel(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function fleetVehicleOptionLabel(bodyId, nowMs = Date.now()) {
  const id = String(bodyId || "");
  const baseName = String(metaById.get(id)?.name || id);
  if (!launchFeatureEnabled || !launchController || !nBodyState?.initialized) {
    return baseName;
  }
  const snapshot = launchController.statusSnapshotForBody?.(nBodyState, id, nowMs) || null;
  if (!snapshot) {
    return baseName;
  }
  const phaseLabel = String(snapshot.missionPhase || snapshot.phase || "").trim();
  if (!phaseLabel) {
    return baseName;
  }
  return `${baseName} | ${formatLaunchPhaseLabel(phaseLabel)}`;
}

function focusManagedTelemetryVehicle(bodyId, moveCamera = true) {
  const targetId = String(bodyId || "").trim();
  if (!targetId || !metaById.has(targetId)) {
    return false;
  }
  if (observation.mode !== OBSERVATION_MODES.BODY_LOCK) {
    setObservationMode(OBSERVATION_MODES.BODY_LOCK);
  }
  setSelected(targetId, moveCamera);
  updateLaunchControls();
  updateLaunchStatusPanel(true);
  return true;
}

function cycleManagedTelemetryVehicle(direction = 1) {
  if (!legendFleetVehicleSelect || legendFleetVehicleSelect.disabled) {
    return;
  }
  const options = Array.from(legendFleetVehicleSelect.options);
  if (options.length <= 0) {
    return;
  }
  const currentValue = String(legendFleetVehicleSelect.value || "");
  let index = options.findIndex((option) => option.value === currentValue);
  if (index < 0) {
    index = 0;
  }
  const nextIndex = (index + (direction >= 0 ? 1 : -1) + options.length) % options.length;
  legendFleetVehicleSelect.value = options[nextIndex].value;
  focusManagedTelemetryVehicle(options[nextIndex].value, true);
}

function updateLegendFleetManager() {
  if (!legendFleetVehicleSelect) {
    return;
  }
  const vehicleIds = listManageableTelemetryVehicleIds();
  const selectedTelemetryId = isLaunchTelemetryVehicleId(selectedId) ? String(selectedId || "") : "";
  const previousValue = String(legendFleetVehicleSelect.value || "");
  let desiredValue = selectedTelemetryId || previousValue || (vehicleIds[0] || "");
  if (!vehicleIds.includes(desiredValue)) {
    desiredValue = vehicleIds[0] || "";
  }

  const existingValues = Array.from(legendFleetVehicleSelect.options).map((option) => option.value);
  const optionsChanged = existingValues.length !== vehicleIds.length
    || existingValues.some((value, index) => value !== vehicleIds[index]);
  if (optionsChanged) {
    legendFleetVehicleSelect.innerHTML = "";
    const nowMs = Date.now();
    for (let i = 0; i < vehicleIds.length; i += 1) {
      const id = vehicleIds[i];
      const option = document.createElement("option");
      option.value = id;
      option.textContent = fleetVehicleOptionLabel(id, nowMs);
      option.title = option.textContent;
      legendFleetVehicleSelect.appendChild(option);
    }
  }

  if (desiredValue && legendFleetVehicleSelect.value !== desiredValue) {
    legendFleetVehicleSelect.value = desiredValue;
  }

  const hasVehicles = vehicleIds.length > 0;
  legendFleetVehicleSelect.disabled = !hasVehicles;
  if (legendFleetPreviousButton) {
    legendFleetPreviousButton.disabled = !hasVehicles;
  }
  if (legendFleetNextButton) {
    legendFleetNextButton.disabled = !hasVehicles;
  }
  if (legendFleetTrackButton) {
    const currentValue = String(legendFleetVehicleSelect.value || "");
    const trackingSelected = hasVehicles && currentValue && currentValue === String(selectedId || "");
    legendFleetTrackButton.disabled = !hasVehicles;
    legendFleetTrackButton.classList.toggle("on", trackingSelected);
    legendFleetTrackButton.setAttribute("aria-pressed", trackingSelected ? "true" : "false");
  }
  if (legendFleetStatusNode) {
    if (!hasVehicles) {
      legendFleetStatusNode.textContent = "No active spacecraft in the scene.";
    } else {
      const activeId = String(legendFleetVehicleSelect.value || vehicleIds[0] || "");
      const activeName = String(metaById.get(activeId)?.name || activeId);
      legendFleetStatusNode.textContent = `${vehicleIds.length} active spacecraft | Selected: ${activeName}`;
    }
  }
}

async function ensureRuntimeCatalogBody(bodyMeta) {
  return ensureRuntimeCatalogBodyView({
    bodyMeta,
    hasBody: (id) => metaById.has(id) && bodyVisuals.has(id),
    registerBody: (normalized) => {
      const existingIndex = bodies.findIndex((body) => body?.id === normalized.id);
      if (existingIndex >= 0) {
        bodies = bodies.map((body, index) => (index === existingIndex ? normalized : body));
      } else {
        bodies = [...bodies, normalized];
      }
      metaById.set(normalized.id, normalized);
    },
    createBodyVisual,
    mountBodyVisual: (visual) => {
      scene.add(visual.root);
      bodyVisuals.set(visual.id, visual);
    },
    rebuildBodyLegend,
    onError: (error, id) => {
      console.warn(`[launch] Failed to create visual for runtime body ${id}.`, error);
    },
  });
}

function selectedTankerLaunchMode() {
  const mode = String(legendTankerLaunchModeSelect?.value || "pad_launch").trim().toLowerCase();
  return mode === "orbit_inject" ? "orbit_inject" : "pad_launch";
}

function selectedMissionLaunchMode() {
  const mode = String(legendMissionLaunchModeSelect?.value || "pad_launch").trim().toLowerCase();
  return mode === "orbit_inject" ? "orbit_inject" : "pad_launch";
}

function missionOrbitInjectAltitudeKm(missionId) {
  const normalized = String(missionId || "").trim().toLowerCase();
  return normalized === "moon_orbit_return" ? MOON_ORBIT_INJECT_ALTITUDE_KM : 150;
}

function tankerLaunchRejectLabel(reason) {
  const key = String(reason || "").trim().toLowerCase();
  if (key === "pad_launch_only") {
    return "Tankers must launch from Earth with a booster.";
  }
  if (key === "orbit_inject_unavailable") {
    return "Orbit inject is currently unavailable.";
  }
  if (key === "earth_state_unavailable") {
    return "Earth state unavailable for orbit inject.";
  }
  if (key === "earth_gravity_unavailable") {
    return "Earth gravity model unavailable for orbit inject.";
  }
  if (key === "pad_launch_requires_idle_stack") {
    return "Primary stack is in flight. Tankers launch from pad only.";
  }
  if (key === "tanker_pad_launch_already_active") {
    return "A tanker pad launch is already in progress.";
  }
  if (key === "tanker_id_exhausted") {
    return "No tanker IDs available.";
  }
  return key || "launch_not_allowed";
}

function missionLaunchRejectLabel(reason) {
  const key = String(reason || "").trim().toLowerCase();
  if (key === "orbit_inject_solver_warming") {
    return "Preparing Moon direct inject route. Launch again in a moment.";
  }
  if (key === "orbit_inject_solver_pending") {
    return "Moon direct inject route is still being computed. Launch again in a moment.";
  }
  if (key === "orbit_inject_solver_timeout") {
    return "Moon direct inject solve timed out before launch. Please retry.";
  }
  if (key === "orbit_inject_solver_unavailable") {
    return "Moon direct inject solver is unavailable in this browser runtime.";
  }
  if (key === "orbit_inject_solver_error") {
    return "Moon direct inject solver failed before launch.";
  }
  if (key === "orbit_inject_window_unavailable") {
    return "Moon direct inject is not in a valid immediate departure window right now.";
  }
  if (key === "orbit_inject_seed_incomplete") {
    return "Moon direct inject solution was incomplete, so the launch was cancelled.";
  }
  if (key === "orbit_inject_unavailable") {
    return "Orbit inject is currently unavailable.";
  }
  if (key === "spawn_pad_unavailable") {
    return "Earth pad launch is currently unavailable.";
  }
  if (key === "earth_state_unavailable") {
    return "Earth state unavailable for launch.";
  }
  if (key === "earth_gravity_unavailable") {
    return "Earth gravity model unavailable for launch.";
  }
  return key || "launch_not_allowed";
}

function isAsyncMoonOrbitInjectLaunch(missionId, launchMode) {
  return String(missionId || "").trim().toLowerCase() === "moon_orbit_return"
    && String(launchMode || "").trim().toLowerCase() === "orbit_inject"
    && typeof launchController?.launchMissionShipAsync === "function";
}

const MOON_ORBIT_INJECT_PENDING_LOG_INTERVAL_MS = 5000;

function isPendingOrbitInjectLaunchReason(reason) {
  const key = String(reason || "").trim().toLowerCase();
  return key === "orbit_inject_solver_warming" || key === "orbit_inject_solver_pending";
}

function missionShipLaunchOptions(missionId, launchMode, launchOptions = {}) {
  const normalizedMissionId = String(missionId || "").trim().toLowerCase();
  const normalizedLaunchMode = String(launchMode || "").trim().toLowerCase();
  const moonOrbitInjectBrowserLaunch = (
    typeof window !== "undefined"
    && normalizedMissionId === "moon_orbit_return"
    && normalizedLaunchMode === "orbit_inject"
  );
  return {
    ...(launchOptions && typeof launchOptions === "object" ? launchOptions : {}),
    mode: launchMode,
    orbitInjectAltitudeKm: missionOrbitInjectAltitudeKm(missionId),
    orbitInjectSearchProfile: moonOrbitInjectBrowserLaunch
      ? MOON_ORBIT_INJECT_BROWSER_LAUNCH_SEARCH_PROFILE
      : undefined,
    orbitInjectNodeSamples: moonOrbitInjectBrowserLaunch
      ? MOON_ORBIT_INJECT_BROWSER_LAUNCH_NODE_SAMPLES
      : undefined,
    vehicleRole: "mission",
  };
}

async function finalizeAcceptedMissionShipLaunch(launchResult, selectedMissionId, missionLaunchMode) {
  if (String(launchResult?.vehicleRole || "").toLowerCase() === "tanker") {
    appendLaunchLogEntry("error", {
      name: "fleet_mission_ship_launch_rejected",
      reason: "unexpected_tanker_route",
      missionId: selectedMissionId,
      mode: missionLaunchMode,
    });
    updateLaunchStatusPanel(true, "Mission launch routed to tanker path unexpectedly; launch cancelled.");
    if (isMoonOrbitInjectMissionSelection(selectedMissionId, missionLaunchMode)) {
      updateMoonOrbitInjectDebugState({
        active: true,
        missionId: selectedMissionId,
        launchMode: missionLaunchMode,
        phase: "launch-error",
        detail: "unexpected tanker route",
        reason: "unexpected_tanker_route",
      });
    }
    updateLaunchControls();
    return false;
  }
  appendLaunchLogEntry("info", {
    name: "fleet_mission_ship_launch_requested",
    shipId: launchResult.shipId,
    missionId: launchResult.missionId || selectedMissionId,
    missionPhase: launchResult.missionPhase || "",
    launchMode: launchResult.launchMode || missionLaunchMode,
    orbitInjectAltitudeKm: Number(launchResult.orbitInjectAltitudeKm) || null,
    orbitInjectPeriapsisKm: Number(launchResult.orbitInjectPeriapsisKm) || null,
    orbitInjectApoapsisKm: Number(launchResult.orbitInjectApoapsisKm) || null,
    orbitInjectSpawnAtPeriapsis: Boolean(launchResult.orbitInjectSpawnAtPeriapsis),
  });
  if (launchResult?.shipMeta) {
    try {
      await ensureRuntimeCatalogBody(launchResult.shipMeta);
    } catch (error) {
      console.warn("[launch] Runtime catalog registration failed for mission ship.", error);
      if (isMoonOrbitInjectMissionSelection(selectedMissionId, missionLaunchMode)) {
        updateMoonOrbitInjectDebugState({
          active: true,
          missionId: selectedMissionId,
          launchMode: missionLaunchMode,
          phase: "visual-error",
          detail: "runtime catalog registration failed",
          reason: error instanceof Error ? error.message : String(error || "runtime_catalog_error"),
          shipId: String(launchResult?.shipId || ""),
        });
      }
    }
  }
  if (launchResult?.shipId) {
    syncRuntimeScenePositionsNow(Date.now());
    if (observation.mode !== OBSERVATION_MODES.BODY_LOCK) {
      setObservationMode(OBSERVATION_MODES.BODY_LOCK);
    }
    setSelected(launchResult.shipId, true);
  }
  if (isMoonOrbitInjectMissionSelection(selectedMissionId, missionLaunchMode)) {
    const shipId = String(launchResult?.shipId || "").trim();
    updateMoonOrbitInjectDebugState({
      active: true,
      missionId: selectedMissionId,
      launchMode: missionLaunchMode,
      phase: "launch-accepted",
      detail: "ship created and selection updated",
      reason: "",
      key: "",
      shipId,
      selectedBodyId: String(selectedId || ""),
      selectedMatches: shipId ? String(selectedId || "") === shipId : false,
      dynamicPresent: shipId ? Boolean(nBodyState?.dynamicBodies?.has?.(shipId)) : false,
      visualMounted: shipId ? Boolean(bodyVisuals.get(shipId)?.root) : false,
      visualVisible: shipId ? Boolean(bodyVisuals.get(shipId)?.root?.visible) : false,
    });
  }
  updateLaunchControls();
  updateLaunchStatusPanel(true);
  return true;
}

function rejectMissionShipLaunch(launchResult, selectedMissionId, missionLaunchMode, prefix = "Mission launch rejected") {
  const rejectLabel = missionLaunchRejectLabel(launchResult?.reason);
  appendLaunchLogEntry("error", {
    name: "fleet_mission_ship_launch_rejected",
    reason: String(launchResult?.reason || "launch_not_allowed"),
    missionId: selectedMissionId,
    mode: missionLaunchMode,
  });
  if (isMoonOrbitInjectMissionSelection(selectedMissionId, missionLaunchMode)) {
    updateMoonOrbitInjectDebugState({
      active: true,
      missionId: selectedMissionId,
      launchMode: missionLaunchMode,
      phase: "launch-rejected",
      detail: prefix,
      reason: String(launchResult?.reason || "launch_not_allowed"),
      shipId: String(launchResult?.shipId || ""),
    });
  }
  updateLaunchStatusPanel(true, `${prefix}: ${rejectLabel}`);
  updateLaunchControls();
}

async function beginMoonOrbitInjectBrowserLaunch(state, missionId, launchMode, launchOptions = {}) {
  const options = missionShipLaunchOptions(missionId, launchMode, launchOptions);
  const key = `${String(missionId || "").trim().toLowerCase()}|${String(launchMode || "").trim().toLowerCase()}|${Number(options.orbitInjectAltitudeKm) || 0}`;
  updateMoonOrbitInjectDebugState({
    active: true,
    missionId,
    launchMode,
    phase: "launch-clicked",
    detail: "requesting Moon direct inject launch",
    reason: "",
    key,
    shipId: "",
  });
  updateLaunchStatusPanel(true, "Computing best Moon inject window...");
  try {
    if (typeof launchController?.warmMoonOrbitInjectLaunchSolve !== "function") {
      updateMoonOrbitInjectDebugState({
        active: true,
        missionId,
        launchMode,
        phase: "launch-rejected-immediate",
        detail: "launch controller does not expose Moon inject solve",
        reason: "orbit_inject_solver_unavailable",
        key,
      });
      return {
        accepted: false,
        reason: "orbit_inject_solver_unavailable",
      };
    }
    updateMoonOrbitInjectDebugState({
      active: true,
      missionId,
      launchMode,
      phase: "solve-started",
      detail: "starting bounded Moon inject solve for launch click",
      reason: "",
      key,
    });
    updateLaunchStatusPanel(
      true,
      "Computing Moon inject route for launch...",
    );
    let pendingProgressIntervalId = null;
    const stopPendingProgressLogs = () => {
      if (pendingProgressIntervalId !== null) {
        clearInterval(pendingProgressIntervalId);
        pendingProgressIntervalId = null;
      }
    };
    const emitPendingProgress = () => {
      const controllerState = currentMoonOrbitInjectSolveDebugState();
      const pendingStartedAtMs = Number(controllerState?.pendingStartedAtMs) || 0;
      const elapsedMs = pendingStartedAtMs > 0
        ? Math.max(0, Date.now() - pendingStartedAtMs)
        : 0;
      updateMoonOrbitInjectDebugState({
        active: true,
        missionId,
        launchMode,
        phase: "solve-still-pending",
        detail: `Moon inject solve still pending (${Math.round(elapsedMs / 1000)}s elapsed)`,
        reason: "",
        key,
      });
    };
    pendingProgressIntervalId = setInterval(
      emitPendingProgress,
      MOON_ORBIT_INJECT_PENDING_LOG_INTERVAL_MS,
    );
    emitPendingProgress();
    const solveResponse = await launchController.warmMoonOrbitInjectLaunchSolve(
      state,
      missionId,
      {
        ...options,
        allowLocalFallback: true,
        forceLocalFallback: true,
        forceRestart: false,
        reuseAnyPending: false,
      },
    );
    stopPendingProgressLogs();
    if (
      !solveResponse?.solution?.valid
      || !solveResponse?.solution?.ready
      || !solveResponse?.solution?.corridorAccepted
    ) {
      updateMoonOrbitInjectDebugState({
        active: true,
        missionId,
        launchMode,
        phase: "solve-rejected",
        detail: "solve completed without acceptable corridor",
        reason: String(solveResponse?.error || "orbit_inject_solver_error"),
        key,
      });
      return {
        accepted: false,
        reason: String(solveResponse?.error || "orbit_inject_solver_error"),
      };
    }
    updateMoonOrbitInjectDebugState({
      active: true,
      missionId,
      launchMode,
      phase: "seed-ready",
      detail: "accepted Moon inject seed ready; launching ship",
      reason: "",
      key,
    });
    updateLaunchStatusPanel(true, "Moon direct inject route ready. Launching...");
    return launchController.launchMissionShipAsync(
      state,
      missionId,
      Date.now(),
      {
        ...options,
        moonDepartureWindowSeed: solveResponse.solution,
      },
    );
  } catch (error) {
    console.warn("[launch] Async moon inject solve failed before launch.", error);
    updateMoonOrbitInjectDebugState({
      active: true,
      missionId,
      launchMode,
      phase: "solve-error",
      detail: "async Moon inject solve failed before launch",
      reason: error instanceof Error ? error.message : String(error || "orbit_inject_solver_error"),
      key,
    });
    updateLaunchStatusPanel(true, "Moon inject solve failed before launch.");
    return {
      accepted: false,
      reason: "orbit_inject_solver_error",
    };
  }
}

async function requestMissionShipLaunch(state, missionId, launchMode, launchOptions = {}) {
  const options = missionShipLaunchOptions(missionId, launchMode, launchOptions);
  if (isAsyncMoonOrbitInjectLaunch(missionId, launchMode)) {
    if (typeof window !== "undefined") {
      return beginMoonOrbitInjectBrowserLaunch(state, missionId, launchMode, launchOptions);
    }
    updateLaunchStatusPanel(true, "Computing best Moon inject window...");
    try {
      let launchResult = await launchController.launchMissionShipAsync(state, missionId, Date.now(), options);
      const launchReason = String(launchResult?.reason || "").trim().toLowerCase();
      if (
        !launchResult?.accepted
        && isPendingOrbitInjectLaunchReason(launchReason)
        && typeof launchController?.warmMoonOrbitInjectLaunchSolve === "function"
      ) {
        updateLaunchStatusPanel(
          true,
          launchReason === "orbit_inject_solver_pending"
            ? "Moon direct inject route is still computing. Launch will continue when ready..."
            : "Preparing Moon direct inject route. Launch will continue when ready...",
        );
        const solveResponse = await launchController.warmMoonOrbitInjectLaunchSolve(
          state,
          missionId,
          {
            ...options,
            allowLocalFallback: true,
          },
        );
        if (!solveResponse?.solution?.valid || !solveResponse?.solution?.ready || !solveResponse?.solution?.corridorAccepted) {
          return {
            accepted: false,
            reason: String(solveResponse?.error || launchReason || "orbit_inject_solver_error"),
          };
        }
        updateLaunchStatusPanel(true, "Moon direct inject route ready. Launching...");
        launchResult = await launchController.launchMissionShipAsync(
          state,
          missionId,
          Date.now(),
          {
            ...options,
            moonDepartureWindowSeed: solveResponse.solution,
          },
        );
      }
      return launchResult;
    } catch (error) {
      console.warn("[launch] Async moon inject solve failed before launch.", error);
      updateLaunchStatusPanel(true, "Moon inject solve failed before launch.");
      return {
        accepted: false,
        reason: "orbit_inject_solver_error",
      };
    }
  }
  return launchController.launchMissionShip?.(state, missionId, Date.now(), options);
}

function warmSelectedMissionLaunchSolve() {
  if (!launchController || !nBodyState?.initialized) {
    return;
  }
  const selectedMissionId = activeSelectedMissionId();
  const missionLaunchMode = selectedMissionLaunchMode();
  if (
    String(selectedMissionId || "").trim().toLowerCase() !== "moon_orbit_return"
    || String(missionLaunchMode || "").trim().toLowerCase() !== "orbit_inject"
    || typeof launchController?.warmMoonOrbitInjectLaunchSolve !== "function"
  ) {
    renderMoonOrbitInjectDebugState();
    return;
  }
  if (typeof window !== "undefined") {
    updateMoonOrbitInjectDebugState({
      active: true,
      missionId: selectedMissionId,
      launchMode: missionLaunchMode,
      phase: "warm-skipped",
      detail: "browser moon inject warm is disabled; route solve starts on launch click",
      reason: "",
      key: "",
    });
    renderMoonOrbitInjectDebugState();
    return;
  }
  updateMoonOrbitInjectDebugState({
    active: true,
    missionId: selectedMissionId,
    launchMode: missionLaunchMode,
    phase: "warm-requested",
    detail: "background route solve started",
    reason: "",
    key: "",
  });
  void launchController.warmMoonOrbitInjectLaunchSolve(
    nBodyState,
    selectedMissionId,
    {
      allowLocalFallback: false,
      mode: missionLaunchMode,
      orbitInjectAltitudeKm: missionOrbitInjectAltitudeKm(selectedMissionId),
      orbitInjectSearchProfile: MOON_ORBIT_INJECT_BROWSER_LAUNCH_SEARCH_PROFILE,
      orbitInjectNodeSamples: MOON_ORBIT_INJECT_BROWSER_LAUNCH_NODE_SAMPLES,
      vehicleRole: "mission",
    },
  ).catch((error) => {
    console.warn("[launch] Failed to warm Moon direct inject solve.", error);
    updateMoonOrbitInjectDebugState({
      active: true,
      missionId: selectedMissionId,
      launchMode: missionLaunchMode,
      phase: "warm-error",
      detail: "background route solve failed",
      reason: error instanceof Error ? error.message : String(error || "warm-error"),
    });
  });
}

function syncRuntimeScenePositionsNow(nowMs = Date.now()) {
  if (!nBodyState?.initialized) {
    return;
  }
  runtimeCoordsKmById = computeRuntimeCoordinatesKm(nowMs);
  applyScenePositions(runtimeCoordsKmById);
}

function primaryLaunchActive() {
  if (typeof launchController?.isPrimaryLaunchActive === "function") {
    return Boolean(launchController.isPrimaryLaunchActive());
  }
  if (typeof launchController?.statusSnapshot !== "function") {
    return false;
  }
  const snapshot = launchController.statusSnapshot(nBodyState);
  const phase = String(snapshot?.phase || "").trim().toLowerCase();
  return phase !== "idle" || Boolean(snapshot?.boosterActive);
}

function setupLaunchControls() {
  if (!launchFeatureEnabled) {
    launchControlButton?.remove();
    launchReturnButton?.remove();
    launchResetButton?.remove();
    launchDeleteButton?.remove();
    launchTankerButton?.remove();
    missionControlScreenController.disableAndRemove();
    return;
  }
  setupLaunchMissionPicker();
  warmSelectedMissionLaunchSolve();
  if (launchControlButton) {
    launchControlButton.addEventListener("click", async () => {
      const launchRuntimeReady = await ensureLaunchRuntimeReady();
      if (!launchRuntimeReady.ready) {
        appendLaunchLogEntry("error", {
          name: "launch_command_rejected",
          reason: String(launchRuntimeReady.reason || "launch_runtime_unavailable"),
        });
        updateLaunchStatusPanel(true, launchRuntimeReady.reason || "Launch unavailable.");
        return;
      }
      const selectedMissionId = legendLaunchMissionSelect?.value
        || launchController.getMissionProfile?.()?.id
        || "";
      const missionLaunchMode = selectedMissionLaunchMode();
      const missionLaunchAction = resolveMissionLaunchAction({
        primaryLaunchActive: primaryLaunchActive(),
        missionLaunchMode,
      });
      if (isMoonOrbitInjectMissionSelection(selectedMissionId, missionLaunchMode)) {
        updateMoonOrbitInjectDebugState({
          active: true,
          missionId: selectedMissionId,
          launchMode: missionLaunchMode,
          phase: "launch-action-resolved",
          detail: `resolved action ${missionLaunchAction}`,
          reason: "",
        });
      }
      if (missionLaunchAction === "mission_additional_fleet") {
        let launchResult = await requestMissionShipLaunch(
          nBodyState,
          selectedMissionId,
          missionLaunchMode,
        );
        if (
          launchResult?.accepted
          && String(launchResult?.vehicleRole || "").toLowerCase() === "tanker"
        ) {
          if (launchResult?.shipId) {
            launchController.removeVehicleById?.(nBodyState, launchResult.shipId, Date.now());
          }
          launchResult = await requestMissionShipLaunch(
            nBodyState,
            selectedMissionId,
            missionLaunchMode,
          );
        }
        if (!launchResult?.accepted) {
          rejectMissionShipLaunch(
            launchResult,
            selectedMissionId,
            missionLaunchMode,
            "Additional mission launch rejected",
          );
          return;
        }
        await finalizeAcceptedMissionShipLaunch(launchResult, selectedMissionId, missionLaunchMode);
        return;
      }
      if (missionLaunchAction === "mission_orbit_inject") {
        if (selectedMissionId) {
          launchController.setMissionProfile?.(selectedMissionId);
        }
        let launchResult = await requestMissionShipLaunch(
          nBodyState,
          selectedMissionId,
          missionLaunchMode,
        );
        if (
          launchResult?.accepted
          && String(launchResult?.vehicleRole || "").toLowerCase() === "tanker"
        ) {
          if (launchResult?.shipId) {
            launchController.removeVehicleById?.(nBodyState, launchResult.shipId, Date.now());
          }
          launchResult = await requestMissionShipLaunch(
            nBodyState,
            selectedMissionId,
            missionLaunchMode,
          );
        }
        if (launchResult?.pending && launchResult?.autoLaunchPromise) {
          updateLaunchControls();
          void launchResult.autoLaunchPromise.then(async (resolvedLaunchResult) => {
            if (!resolvedLaunchResult?.accepted) {
              rejectMissionShipLaunch(
                resolvedLaunchResult,
                selectedMissionId,
                missionLaunchMode,
                "Mission launch rejected",
              );
              return;
            }
            await finalizeAcceptedMissionShipLaunch(
              resolvedLaunchResult,
              selectedMissionId,
              missionLaunchMode,
            );
          }).catch((error) => {
            console.warn("[launch] Deferred Moon orbit inject launch failed.", error);
            rejectMissionShipLaunch(
              { accepted: false, reason: "orbit_inject_solver_error" },
              selectedMissionId,
              missionLaunchMode,
              "Mission launch rejected",
            );
          });
          return;
        }
        if (!launchResult?.accepted) {
          rejectMissionShipLaunch(
            launchResult,
            selectedMissionId,
            missionLaunchMode,
            "Mission launch rejected",
          );
          return;
        }
        await finalizeAcceptedMissionShipLaunch(launchResult, selectedMissionId, missionLaunchMode);
        return;
      }
      if (selectedMissionId) {
        launchController.setMissionProfile?.(selectedMissionId);
      }
      const started = launchController.startLaunch(nBodyState, Date.now());
      if (started) {
        resetLaunchTrajectoryPath();
        syncRuntimeScenePositionsNow(Date.now());
        setSelected(LAUNCH_BODY_ID, true);
      } else {
        appendLaunchLogEntry("error", {
          name: "launch_command_failed",
          reason: "controller_rejected_start",
        });
      }
      updateLaunchControls();
      updateLaunchStatusPanel(true);
    });
  }
  if (launchReturnButton) {
    launchReturnButton.addEventListener("click", () => {
      const launchVisual = bodyVisuals.get(LAUNCH_BODY_ID);
      if (!metaById.has(LAUNCH_BODY_ID) || !launchVisual?.root?.visible) {
        updateLaunchStatusPanel(true, "Launch vehicle is unavailable in the current scene.");
        return;
      }
      if (observation.mode !== OBSERVATION_MODES.BODY_LOCK) {
        setObservationMode(OBSERVATION_MODES.BODY_LOCK);
      }
      setSelected(LAUNCH_BODY_ID, true);
      updateLaunchControls();
    });
  }
  if (launchResetButton) {
    launchResetButton.addEventListener("click", async () => {
      const launchRuntimeReady = await ensureLaunchRuntimeReady();
      if (!launchRuntimeReady.ready) {
        appendLaunchLogEntry("error", {
          name: "launch_reset_rejected",
          reason: String(launchRuntimeReady.reason || "launch_runtime_unavailable"),
        });
        updateLaunchStatusPanel(true, launchRuntimeReady.reason || "Reset unavailable.");
        return;
      }
      launchController.resetToPad(nBodyState, Date.now(), { clearFleetVehicles: true });
      resetLaunchTrajectoryPath();
      if (observation.mode !== OBSERVATION_MODES.BODY_LOCK) {
        setObservationMode(OBSERVATION_MODES.BODY_LOCK);
      }
      setSelected(LAUNCH_BODY_ID, true);
      appendLaunchLogEntry("info", {
        name: "launch_reset_requested",
      });
      updateLaunchControls();
      updateLaunchStatusPanel(true);
    });
  }
  launchVehicleDeleteController.bindControls();
  if (launchTankerButton && launchTankerButton.dataset.bound !== "true") {
    launchTankerButton.addEventListener("click", async () => {
      const launchRuntimeReady = await ensureLaunchRuntimeReady();
      if (!launchRuntimeReady.ready) {
        appendLaunchLogEntry("error", {
          name: "refuel_tanker_launch_rejected",
          reason: String(launchRuntimeReady.reason || "launch_runtime_unavailable"),
        });
        updateLaunchStatusPanel(true, launchRuntimeReady.reason || "Tanker launch unavailable.");
        return;
      }
      const tankerLaunchMode = selectedTankerLaunchMode();
      const launchResult = launchController.launchRefuelTanker?.(
        nBodyState,
        Date.now(),
        { mode: tankerLaunchMode },
      );
      if (!launchResult?.accepted) {
        const rejectLabel = tankerLaunchRejectLabel(launchResult?.reason);
        appendLaunchLogEntry("error", {
          name: "refuel_tanker_launch_rejected",
          reason: String(launchResult?.reason || "launch_not_allowed"),
          mode: tankerLaunchMode,
        });
        updateLaunchStatusPanel(true, `Tanker launch rejected: ${rejectLabel}`);
        return;
      }
      if (launchResult?.tankerMeta) {
        await ensureRuntimeCatalogBody(launchResult.tankerMeta);
      }
      if (launchResult?.pending) {
        syncRuntimeScenePositionsNow(Date.now());
        setSelected(LAUNCH_BODY_ID, true);
      } else if (launchResult?.tankerId) {
        syncRuntimeScenePositionsNow(Date.now());
        setSelected(launchResult.tankerId, true);
      }
      appendLaunchLogEntry("info", {
        name: "refuel_tanker_launch_requested",
        tankerId: launchResult.tankerId,
        mode: launchResult.mode || "rendezvous",
        requestedMode: tankerLaunchMode,
        transferKg: launchResult.transferKg,
        completedFlights: launchResult.completedFlights,
        requiredFlights: launchResult.requiredFlights,
      });
      updateLaunchControls();
      updateLaunchStatusPanel(true);
    });
    launchTankerButton.dataset.bound = "true";
  }
  let missionControlLastVisible = false;
  missionControlScreenController.bindControls((isVisible) => {
    const becameVisible = Boolean(isVisible) && !missionControlLastVisible;
    missionControlLastVisible = Boolean(isVisible);
    if (becameVisible) {
      const viewState = missionControlVehicleViewState();
      if (viewState.starshipViewAvailable) {
        focusLegendVehicleView("starship");
      } else if (!isLaunchTelemetryVehicleId(selectedId)) {
        const preferredView = viewState.activeView === "booster"
          ? "booster"
          : (launchVehicleViewPreference === "booster" ? "booster" : "starship");
        focusLegendVehicleView(preferredView);
      }
    }
    updateLaunchStatusPanel(true);
  });
  updateLaunchControls();
  updateLaunchStatusPanel(true);
}

function updateLaunchControls() {
  if (!launchFeatureEnabled) {
    return;
  }
  if (!launchControlButton) {
    return;
  }
  const initialized = Boolean(launchController && nBodyState?.initialized);
  const availabilityReason = launchAvailabilityReason();
  const active = Boolean(launchController?.isActive());
  launchControlButton.textContent = active ? "Launch +1 Stack" : "Launch";
  launchControlButton.disabled = false;
  launchControlButton.classList.toggle("on", active);
  launchControlButton.setAttribute("aria-pressed", active ? "true" : "false");
  launchControlButton.title = availabilityReason || "Launch primary vehicle";
  if (launchReturnButton) {
    const launchVisible = Boolean(bodyVisuals.get(LAUNCH_BODY_ID)?.root?.visible);
    const launchSelectable = launchVisible && metaById.has(LAUNCH_BODY_ID);
    const isTracking =
      selectedId === LAUNCH_BODY_ID
      && observation.mode === OBSERVATION_MODES.BODY_LOCK;
    launchReturnButton.disabled = !launchSelectable;
    launchReturnButton.classList.toggle("on", isTracking);
    launchReturnButton.setAttribute("aria-pressed", isTracking ? "true" : "false");
  }
  if (launchResetButton) {
    launchResetButton.disabled = false;
    launchResetButton.classList.toggle("on", !active && initialized);
    launchResetButton.setAttribute("aria-pressed", !active && initialized ? "true" : "false");
    launchResetButton.title = availabilityReason || "Reset launch stack to pad";
  }
  launchVehicleDeleteController.syncButtonState({ initialized });
  if (launchTankerButton) {
    const canLaunchTanker = Boolean(launchController && initialized && !launchModuleLoadError);
    launchTankerButton.disabled = false;
    launchTankerButton.classList.toggle("on", canLaunchTanker);
    launchTankerButton.setAttribute("aria-pressed", canLaunchTanker ? "true" : "false");
    launchTankerButton.title = availabilityReason || "Launch refuel tanker";
    if (legendTankerLaunchModeSelect) {
      legendTankerLaunchModeSelect.disabled = false;
    }
  }
  missionControlScreenController.syncButtonState();
  if (legendLaunchMissionSelect) {
    const selectedMissionId = String(launchController?.getMissionProfile?.()?.id || "").trim();
    const desiredMissionId = String(stagedLaunchMissionId || selectedMissionId || "").trim();
    if (!active && desiredMissionId && legendLaunchMissionSelect.value !== desiredMissionId) {
      legendLaunchMissionSelect.value = desiredMissionId;
    }
    legendLaunchMissionSelect.disabled = legendLaunchMissionSelect.options.length <= 0;
    legendLaunchMissionSelect.title = availabilityReason || "Select launch mission";
  }
  updateLegendVehicleViewButtons();
}

function updateLaunchStatusPanel(force = false, fallbackLine = "") {
  if (!launchFeatureEnabled) {
    return;
  }
  if (!launchStatusNode) {
    return;
  }
  updateLaunchControls();
  renderMoonOrbitInjectDebugState();
  const nowMs = Date.now();
  const launchActive = Boolean(launchController?.isActive());
  const availabilityReason = launchAvailabilityReason();
  const viewState = missionControlVehicleViewState();
  const fleetEntries = missionControlFleetEntries(nowMs);
  const minIntervalMs = launchActive ? 120 : 1000;
  if (!force && nowMs - lastLaunchStatusRenderMs < minIntervalMs) {
    return;
  }
  lastLaunchStatusRenderMs = nowMs;
  if (!launchController) {
    launchStatusNode.textContent = fallbackLine || availabilityReason || "Launch controller unavailable.";
    updateLaunchMissionControlPanel(null, false);
    missionControlScreenController.render(
      null,
      false,
      launchEventLogEntries,
      lastLaunchEventSummary,
      viewState,
      fleetEntries,
      missionControlMissionPickerState(null),
    );
    return;
  }
  const telemetryBodyId = activeLaunchTelemetryBodyId();
  const snapshot = launchController.statusSnapshotForBody?.(nBodyState, telemetryBodyId, nowMs)
    || launchController.statusSnapshot();
  const runtimeSpaceWeather = currentSpaceWeatherSnapshot();
  if (snapshot && runtimeSpaceWeather) {
    snapshot.spaceWeatherF107 = runtimeSpaceWeather.f107;
    snapshot.spaceWeatherKp = runtimeSpaceWeather.kp;
    snapshot.spaceWeatherSource = runtimeSpaceWeather.source || "";
    snapshot.spaceWeatherAgeSeconds = runtimeSpaceWeather.ageSeconds;
  }
  updateLegendFallbackIndicators();
  if (!snapshot) {
    launchStatusNode.textContent = fallbackLine || "Launch status unavailable.";
    updateLaunchMissionControlPanel(null, launchActive);
    missionControlScreenController.render(
      null,
      launchActive,
      launchEventLogEntries,
      lastLaunchEventSummary,
      viewState,
      fleetEntries,
      missionControlMissionPickerState(null),
    );
    return;
  }
  const earthRelativeSpeedKmS = Number.isFinite(Number(snapshot.earthRelativeSpeedKmS))
    ? Number(snapshot.earthRelativeSpeedKmS)
    : Number(snapshot.speedKmS);
  if (!Number.isFinite(snapshot.altitudeKm) || !Number.isFinite(earthRelativeSpeedKmS)) {
    launchStatusNode.textContent = snapshot.statusLine || phaseLabelForLaunch(snapshot.phase);
    updateLaunchMissionControlPanel(snapshot, launchActive);
    missionControlScreenController.render(
      snapshot,
      launchActive,
      launchEventLogEntries,
      lastLaunchEventSummary,
      viewState,
      fleetEntries,
      missionControlMissionPickerState(snapshot),
    );
    return;
  }
  const thrustMN = Number.isFinite(snapshot.thrustN) ? snapshot.thrustN / 1_000_000 : 0;
  const throttlePct = Number.isFinite(snapshot.throttle) ? snapshot.throttle * 100 : 0;
  const guidanceLine = snapshot.guidanceDisplayMode || snapshot.autopilotMode || snapshot.guidanceMode || "guidance";
  const missionElapsed = formatDurationSeconds(snapshot.elapsedSeconds);
  const orbitTarget = Number.isFinite(Number(snapshot.targetOrbitAltitudeKm))
    ? ` | Target ${formatNumber(snapshot.targetOrbitAltitudeKm, 0)} km`
    : "";
  const altitudeAgl = shouldShowTerrainRelativeAltitude(snapshot) && Number.isFinite(Number(snapshot.altitudeAboveTerrainKm))
    ? Number(snapshot.altitudeAboveTerrainKm)
    : null;
  const altitudeLabel = altitudeAgl !== null
    ? `${formatNumber(altitudeAgl, 3)} km AGL`
    : `${formatNumber(snapshot.altitudeKm, 1)} km`;
  const rcsLine = snapshot.rcsActive
    ? ` | RCS ${formatNumber((Number(snapshot.rcsAuthority) || 0) * 100, 0)}% [${Array.isArray(snapshot.rcsJets) && snapshot.rcsJets.length > 0 ? snapshot.rcsJets.join(",") : "active"}]`
    : "";
  const boosterLine = snapshot.bodyId === LAUNCH_BODY_ID && snapshot.boosterPhase
    ? ` | Booster ${snapshot.boosterPhase}${Number.isFinite(snapshot.boosterAltitudeKm) ? ` ${formatNumber(snapshot.boosterAltitudeKm, 2)} km` : ""}`
    : "";
  const missionLine = snapshot.missionName
    ? ` | Mission ${snapshot.missionName}${(snapshot.missionPhaseDisplay || snapshot.missionPhase) ? ` (${snapshot.missionPhaseDisplay || snapshot.missionPhase})` : ""}${snapshot.missionCompleted ? " [complete]" : ""}`
    : "";
  const transferProgressPct = Number.isFinite(Number(snapshot.refuelTransferProgress))
    ? Number(snapshot.refuelTransferProgress) * 100
    : Number.NaN;
  const transferRateKgS = Number(snapshot.refuelTransferRateKgS);
  const transferRemainingKg = Number(snapshot.refuelTransferRemainingKg);
  const transferTankerId = String(snapshot.refuelTransferTankerId || "").trim();
  const transferLine = Boolean(snapshot.refuelTransferActive)
    ? ` | Fueling ${Number.isFinite(transferProgressPct) ? `${formatNumber(transferProgressPct, 1)}%` : "active"}${Number.isFinite(transferRateKgS) ? ` @ ${formatNumber(transferRateKgS, 1)} kg/s` : ""}${Number.isFinite(transferRemainingKg) ? ` rem ${formatNumber(transferRemainingKg, 0)} kg` : ""}${transferTankerId ? ` [${transferTankerId}]` : ""}`
    : (Boolean(snapshot.refuelUndockActive) ? " | Undocking sequence active" : "");
  const refuelMissionVisible = snapshot.missionId === "moon_orbit_return"
    || snapshot.missionId === "orbital_refuel_demo"
    || snapshot.missionPhase === "orbital_refuel";
  const refuelLine = refuelMissionVisible
    ? ` | Refuel ${Number(snapshot.refuelCompletedFlights) || 0}/${Number(snapshot.refuelRequiredFlights) || 0}${Number.isFinite(Number(snapshot.refuelFillFraction)) ? ` (${formatNumber(Number(snapshot.refuelFillFraction) * 100, 1)}%)` : ""}${snapshot.refuelCanLaunchTanker ? " [launch window]" : ""} | Tankers available ${Math.max(0, Number(snapshot.refuelAvailableTankers) || Number(snapshot.refuelActiveFlights) || Number(snapshot.refuelAtSlotTankers) || 0)} (online ${Math.max(0, Number(snapshot.refuelOnlineTankers) || 0)})${transferLine}`
    : "";
  const targetBodyName = String(snapshot.targetBodyName || "").trim();
  const targetBodyId = String(snapshot.targetBodyId || "").trim();
  const targetBodyLabel = launchTargetLabel(targetBodyName, targetBodyId);
  const targetTelemetry = resolveSnapshotTargetTelemetry(snapshot);
  const targetDistanceKm = targetTelemetry.targetDistanceKm;
  const targetClosingSpeedKmS = targetTelemetry.targetClosingSpeedKmS;
  const targetEtaSeconds = targetTelemetry.targetEtaSeconds;
  const targetRateLabel = String(targetTelemetry.targetRateLabel || "Closing").trim() || "Closing";
  const targetEtaLabel = String(targetTelemetry.targetEtaLabel || "ETA").trim() || "ETA";
  const targetLine = Number.isFinite(targetDistanceKm)
    ? ` | Target ${targetBodyLabel || "Body"} ${formatNumber(targetDistanceKm, 1)} km${Number.isFinite(targetClosingSpeedKmS) ? ` (${targetRateLabel} ${formatNumber(targetClosingSpeedKmS, 4)} km/s)` : ""}${Number.isFinite(targetEtaSeconds) ? ` ${targetEtaLabel} ${formatDurationSeconds(targetEtaSeconds)}` : ""}`
    : "";
  const eventAgeSeconds = lastLaunchEventTimestampUtc
    ? Math.max(0, (Date.now() - Date.parse(lastLaunchEventTimestampUtc)) / 1000)
    : null;
  const eventLine = lastLaunchEventSummary
    ? ` | Event ${lastLaunchEventSummary}${Number.isFinite(eventAgeSeconds) ? ` (${formatNumber(eventAgeSeconds, 1)}s ago)` : ""}`
    : "";
  const trackingLine = snapshot.vehicleName ? ` | Tracking ${snapshot.vehicleName}` : "";
  const groundSpeedLine = formatLaunchSpeedNumber(snapshot.groundRelativeSpeedKmS, 3);
  const airSpeedLine = formatLaunchSpeedNumber(snapshot.airRelativeSpeedKmS, 3);
  const earthSpeedLine = formatLaunchSpeedNumber(earthRelativeSpeedKmS, 3);
  launchStatusNode.textContent = `${snapshot.phaseLabel} | ${snapshot.stageName || "n/a"} | MET ${missionElapsed} | Alt ${altitudeLabel} | V ground/air/earth ${groundSpeedLine}/${airSpeedLine}/${earthSpeedLine} km/s | T ${formatNumber(thrustMN, 3)} MN @ ${formatNumber(throttlePct, 0)}%${trackingLine} | ${guidanceLine}${orbitTarget}${targetLine}${rcsLine}${boosterLine}${missionLine}${refuelLine}${eventLine} | ${snapshot.launchSiteName || "Launch Site"}`;
  updateLaunchMissionControlPanel(snapshot, launchActive);
  missionControlScreenController.render(
    snapshot,
    launchActive,
    launchEventLogEntries,
    lastLaunchEventSummary,
    viewState,
    fleetEntries,
    missionControlMissionPickerState(snapshot),
  );
}

function phaseLabelForLaunch(phase) {
  if (phase === "powered") {
    return "Powered Ascent";
  }
  if (phase === "coast") {
    return "Coast";
  }
  if (phase === "complete") {
    return "Mission Complete";
  }
  return "Idle";
}

function getReentryHeatColor() {
  if (!THREE_NS) {
    return null;
  }
  if (!reentryHeatColor) {
    reentryHeatColor = new THREE_NS.Color(REENTRY_HEAT_COLOR_HEX);
  }
  return reentryHeatColor;
}

function collectReentryHeatMaterials(visual) {
  if (!visual) {
    return [];
  }
  if (Array.isArray(visual.reentryHeatMaterials)) {
    return visual.reentryHeatMaterials;
  }
  const materials = [];
  const seen = new Set();
  const tryAdd = (material) => {
    if (!material || seen.has(material)) {
      return;
    }
    if (!material.emissive?.isColor || typeof material.emissiveIntensity !== "number") {
      return;
    }
    seen.add(material);
    materials.push(material);
  };

  for (const material of visual.extraMaterials || []) {
    if (Array.isArray(material)) {
      for (const nested of material) {
        tryAdd(nested);
      }
    } else {
      tryAdd(material);
    }
  }
  visual.root?.traverse?.((node) => {
    const material = node?.material;
    if (Array.isArray(material)) {
      for (const nested of material) {
        tryAdd(nested);
      }
      return;
    }
    tryAdd(material);
  });

  visual.reentryHeatMaterials = materials;
  return materials;
}

function ensureReentryHeatMaterialBase(material) {
  if (!material || reentryHeatMaterialBaseState.has(material)) {
    return;
  }
  reentryHeatMaterialBaseState.set(material, {
    emissive: material.emissive.clone(),
    emissiveIntensity: Number(material.emissiveIntensity) || 0,
  });
}

function earthRelativeKinematicsForBody(bodyId) {
  const bodyCoords = runtimeCoordsOrLiveById(bodyId);
  const earthCoords = runtimeCoordsOrLiveById("earth");
  const bodyVelocity = runtimeVelocityKmSOrLiveById(bodyId);
  const earthVelocity = runtimeVelocityKmSOrLiveById("earth");
  if (
    !finiteVectorKm(bodyCoords)
    || !finiteVectorKm(earthCoords)
    || !finiteVectorKm(bodyVelocity)
  ) {
    return null;
  }
  const relPos = {
    x: (Number(bodyCoords.x) || 0) - (Number(earthCoords.x) || 0),
    y: (Number(bodyCoords.y) || 0) - (Number(earthCoords.y) || 0),
    z: (Number(bodyCoords.z) || 0) - (Number(earthCoords.z) || 0),
  };
  const relVel = finiteVectorKm(earthVelocity)
    ? {
        x: (Number(bodyVelocity.x) || 0) - (Number(earthVelocity.x) || 0),
        y: (Number(bodyVelocity.y) || 0) - (Number(earthVelocity.y) || 0),
        z: (Number(bodyVelocity.z) || 0) - (Number(earthVelocity.z) || 0),
      }
    : {
        x: Number(bodyVelocity.x) || 0,
        y: Number(bodyVelocity.y) || 0,
        z: Number(bodyVelocity.z) || 0,
      };
  const radiusKm = Math.hypot(relPos.x, relPos.y, relPos.z);
  if (!(radiusKm > 1e-9)) {
    return null;
  }
  const earthRadiusKm = Number(metaById.get("earth")?.radius_km) || 6371.0084;
  const altitudeKm = Math.max(0, radiusKm - earthRadiusKm);
  const speedKmS = Math.hypot(relVel.x, relVel.y, relVel.z);
  const radialSpeedKmS =
    ((relPos.x * relVel.x) + (relPos.y * relVel.y) + (relPos.z * relVel.z)) / radiusKm;
  const atmosphere = sampleEarthAtmosphereRuntime(
    Math.max(0, altitudeKm),
    {
      relativePositionKm: relPos,
      timestampMs: Date.now(),
    },
  );
  const densityKgM3 = Number(atmosphere?.densityKgM3) || 0;
  const dynamicPressurePa = densityKgM3 > 0
    ? 0.5 * densityKgM3 * Math.pow(speedKmS * 1000, 2)
    : 0;
  return {
    altitudeKm,
    speedKmS,
    radialSpeedKmS,
    dynamicPressurePa,
  };
}

function reentryHeatEligibleForLaunchState(bodyId, launchSnapshot) {
  if (!launchFeatureEnabled || !launchController?.isActive?.()) {
    return false;
  }
  const snapshot = launchSnapshot || launchController?.statusSnapshot?.() || null;
  if (!snapshot) {
    return false;
  }

  if (bodyId === LAUNCH_BODY_ID) {
    const phase = String(snapshot.phase || "").toLowerCase();
    if (!phase || phase === "idle" || phase === "orbit") {
      return false;
    }
    const altitudeAglKm = Number(snapshot.altitudeAboveTerrainKm);
    if (Number.isFinite(altitudeAglKm) && altitudeAglKm <= REENTRY_HEAT_MIN_AGL_KM) {
      return false;
    }
    return true;
  }

  if (bodyId === LAUNCH_BOOSTER_BODY_ID) {
    const phase = String(snapshot.boosterPhase || "").toLowerCase();
    if (!phase || phase.includes("idle") || phase.includes("landed") || Boolean(snapshot.boosterLanded)) {
      return false;
    }
    const altitudeAglKm = Number(snapshot.boosterAltitudeAboveTerrainKm);
    if (Number.isFinite(altitudeAglKm) && altitudeAglKm <= REENTRY_HEAT_MIN_AGL_KM) {
      return false;
    }
    return true;
  }

  return false;
}

function computeReentryHeatTargetForBody(bodyId, launchSnapshot = null) {
  if (!reentryHeatEligibleForLaunchState(bodyId, launchSnapshot)) {
    return 0;
  }
  const kinematics = earthRelativeKinematicsForBody(bodyId);
  if (!kinematics) {
    return 0;
  }
  if (kinematics.altitudeKm <= REENTRY_HEAT_MIN_EFFECT_ALTITUDE_KM) {
    return 0;
  }
  if (kinematics.altitudeKm >= REENTRY_HEAT_ATMOSPHERE_MAX_KM) {
    return 0;
  }
  if (kinematics.radialSpeedKmS >= -REENTRY_HEAT_MIN_DESCENT_KM_S) {
    return 0;
  }
  if (kinematics.speedKmS <= REENTRY_HEAT_MIN_SPEED_KM_S) {
    return 0;
  }
  const qBlend = clamp(
    (kinematics.dynamicPressurePa - REENTRY_HEAT_Q_START_PA)
      / Math.max(REENTRY_HEAT_Q_FULL_PA - REENTRY_HEAT_Q_START_PA, 1),
    0,
    1,
  );
  const speedBlend = clamp(
    (kinematics.speedKmS - REENTRY_HEAT_MIN_SPEED_KM_S)
      / Math.max(REENTRY_HEAT_SPEED_FULL_KM_S - REENTRY_HEAT_MIN_SPEED_KM_S, 1e-6),
    0,
    1,
  );
  const descentBlend = clamp(
    ((-kinematics.radialSpeedKmS) - REENTRY_HEAT_MIN_DESCENT_KM_S)
      / Math.max(REENTRY_HEAT_DESCENT_FULL_KM_S - REENTRY_HEAT_MIN_DESCENT_KM_S, 1e-6),
    0,
    1,
  );
  const altitudeBlend = clamp(
    (REENTRY_HEAT_ATMOSPHERE_MAX_KM - kinematics.altitudeKm) / REENTRY_HEAT_ATMOSPHERE_MAX_KM,
    0,
    1,
  );
  return clamp(
    ((0.72 * qBlend) + (0.28 * speedBlend))
      * descentBlend
      * (0.55 + (0.45 * altitudeBlend)),
    0,
    1,
  );
}

function applyReentryHeatToVisual(visual, targetHeat = 0, instant = false) {
  if (!visual?.root || !THREE_NS) {
    return;
  }
  const heatColor = getReentryHeatColor();
  if (!heatColor) {
    return;
  }
  const materials = collectReentryHeatMaterials(visual);
  if (materials.length === 0) {
    return;
  }
  const target = clamp(Number(targetHeat) || 0, 0, 1);
  const current = clamp(Number(visual.reentryHeatLevel) || 0, 0, 1);
  const response = instant
    ? 1
    : (target > current ? REENTRY_HEAT_RISE_RESPONSE : REENTRY_HEAT_FALL_RESPONSE);
  const next = clamp(current + ((target - current) * response), 0, 1);
  visual.reentryHeatLevel = next;

  for (const material of materials) {
    ensureReentryHeatMaterialBase(material);
    const base = reentryHeatMaterialBaseState.get(material);
    if (!base) {
      continue;
    }
    if (next <= 1e-4) {
      material.emissive.copy(base.emissive);
      material.emissiveIntensity = base.emissiveIntensity;
      continue;
    }
    const emissive = base.emissive.clone().lerp(heatColor, next * 0.92);
    material.emissive.copy(emissive);
    material.emissiveIntensity = base.emissiveIntensity + (REENTRY_HEAT_MAX_EMISSIVE_DELTA * next);
  }
}

function boosterFuelFractionFromSnapshot(snapshot) {
  const explicitFraction = Number(snapshot?.boosterFuelFraction);
  if (Number.isFinite(explicitFraction)) {
    return clamp(explicitFraction, 0, 1);
  }
  const initialKg = Number(snapshot?.boosterInitialPropellantKg);
  const remainingKg = Number(snapshot?.boosterPropellantKg);
  if (initialKg > 1e-6 && Number.isFinite(remainingKg)) {
    return clamp(remainingKg / initialKg, 0, 1);
  }
  if (Number(snapshot?.stageIndex) === 0) {
    return 1;
  }
  if (Number.isFinite(remainingKg)) {
    return remainingKg > 0 ? 1 : 0;
  }
  return 0;
}

function ensureLaunchTrajectoryPath() {
  if (launchTrajectoryPathController) {
    return launchTrajectoryPathController;
  }
  if (!THREE_NS || !scene) {
    return null;
  }
  launchTrajectoryPathController = createLaunchTrajectoryPathController(THREE_NS, scene, {
    maxPoints: LAUNCH_TRAJECTORY_MAX_POINTS,
    minPointDistanceScene: LAUNCH_TRAJECTORY_MIN_POINT_DISTANCE_KM * DISTANCE_SCALE,
    colorHex: 0x3bc6ff,
    opacity: 0.92,
  });
  launchTrajectoryPathController?.setEnabled(trajectoryPathViewEnabled);
  return launchTrajectoryPathController;
}

function resetLaunchTrajectoryPath() {
  lastTrajectorySnapshotElapsedSeconds = null;
  launchTrajectoryPathController?.reset();
}

function updateLaunchTrajectoryPath(snapshot) {
  const controller = ensureLaunchTrajectoryPath();
  if (!controller) {
    return;
  }
  controller.setEnabled(trajectoryPathViewEnabled);
  if (!snapshot) {
    return;
  }
  const elapsedSeconds = Number(snapshot.elapsedSeconds);
  if (
    Number.isFinite(elapsedSeconds)
    && Number.isFinite(lastTrajectorySnapshotElapsedSeconds)
    && elapsedSeconds + 0.5 < lastTrajectorySnapshotElapsedSeconds
  ) {
    controller.reset();
  }
  if (Number.isFinite(elapsedSeconds)) {
    lastTrajectorySnapshotElapsedSeconds = elapsedSeconds;
  }
  const phase = String(snapshot.phase || "").toLowerCase();
  const shouldRecord = (Number.isFinite(elapsedSeconds) && elapsedSeconds > 0.01)
    || phase !== "idle"
    || Boolean(launchController?.isActive?.());
  if (!shouldRecord) {
    return;
  }
  const coordsKm = runtimeCoordsOrLiveById(LAUNCH_BODY_ID);
  if (!finiteVectorKm(coordsKm)) {
    return;
  }
  controller.appendPoint({
    x: (Number(coordsKm.x) || 0) * DISTANCE_SCALE,
    y: (Number(coordsKm.z) || 0) * DISTANCE_SCALE,
    z: (Number(coordsKm.y) || 0) * DISTANCE_SCALE,
  });
}

function ensureRefuelTransferVisual() {
  return refuelTransferVisualController.ensureRefuelTransferVisual();
}

function hideRefuelTransferVisual() {
  refuelTransferVisualController.hideRefuelTransferVisual();
}

function updateRefuelTransferVisual() {
  refuelTransferVisualController.updateRefuelTransferVisual();
}

function ensureLaunchSiteStructureVisual() {
  if (!launchFeatureEnabled || !THREE_NS) {
    return null;
  }
  if (!launchSiteStructureVisual?.root) {
    launchSiteStructureVisual = createLaunchSiteStructureVisual(THREE_NS, DISTANCE_SCALE);
  }
  if (launchSiteStructureVisual?.root?.parent !== scene) {
    scene.add(launchSiteStructureVisual.root);
  }
  return launchSiteStructureVisual;
}

function updateLaunchSiteStructureVisuals(deltaSeconds = 0) {
  if (!launchFeatureEnabled || !THREE_NS) {
    return;
  }
  const earthCoordsKm = runtimeCoordsOrLiveById("earth");
  if (!finiteVectorKm(earthCoordsKm)) {
    if (launchSiteStructureVisual?.root) {
      launchSiteStructureVisual.root.visible = false;
    }
    return;
  }
  const pole = sourcePoleUnitVectorEclipticForBody("earth", Date.now());
  const earthAxes = sourceBodyFixedAxesEclipticForBody("earth", pole, Date.now());
  if (!earthAxes?.xAxis || !earthAxes?.yAxis || !earthAxes?.pole) {
    if (launchSiteStructureVisual?.root) {
      launchSiteStructureVisual.root.visible = false;
    }
    return;
  }
  const structure = ensureLaunchSiteStructureVisual();
  if (!structure) {
    return;
  }
  const snapshot = launchController?.statusSnapshot?.() || null;
  const altitudeKm = Number(snapshot?.altitudeKm);
  const stageIndex = Number(snapshot?.stageIndex);
  const rocketPositionKm = runtimeCoordsOrLiveById(LAUNCH_BODY_ID);
  const stackPresent = (
    !snapshot
    || String(snapshot?.phase || "").trim().toLowerCase() === "idle"
    || (
      (!Number.isFinite(altitudeKm) || altitudeKm < 0.6)
      && (!Number.isFinite(stageIndex) || stageIndex <= 0)
    )
  );
  updateLaunchSiteStructureVisual(structure, {
    THREE: THREE_NS,
    scene,
    earthPositionKm: earthCoordsKm,
    earthAxes,
    rocketPositionKm,
    distanceScale: DISTANCE_SCALE,
    dtSeconds: deltaSeconds,
    launchSite: RUNTIME_LAUNCH_SITE,
    stackPresent,
    launchPhase: snapshot?.phase,
    guidanceMode: snapshot?.guidanceMode,
    elapsedSeconds: snapshot?.elapsedSeconds,
    altitudeKm,
    boosterPhase: snapshot?.boosterPhase,
    boosterLanded: snapshot?.boosterLanded,
  });
}

function updateLaunchVehicleVisuals() {
  if (!launchFeatureEnabled) {
    return;
  }
  if (!THREE_NS) {
    return;
  }
  const visual = bodyVisuals.get(LAUNCH_BODY_ID);
  if (!visual) {
    return;
  }
  if (!visual.root?.visible || !visual.launchStackState || !visual.tiltGroup?.quaternion) {
    applyReentryHeatToVisual(visual, 0, true);
    return;
  }
  const snapshot = launchController?.statusSnapshot() || null;
  updateLaunchTrajectoryPath(snapshot);
  applyStarshipVisualStageFn?.(visual.launchStackState, snapshot?.stageIndex, snapshot);
  const stackBoosterVisible = Number(snapshot?.stageIndex) <= 0;
  applyInlineBoosterFuelVisuals(visual.launchStackState, {
    enabled: boosterFuelViewEnabled && stackBoosterVisible,
    fuelFraction: stackBoosterVisible ? 1 : 0,
  });

  const velocityKmS = runtimeVelocityKmSOrLiveById(LAUNCH_BODY_ID);
  const earthVelocityKmS = runtimeVelocityKmSOrLiveById("earth");
  const rocketCoordsKm = runtimeCoordsOrLiveById(LAUNCH_BODY_ID);
  const earthCoordsKm = runtimeCoordsOrLiveById("earth");
  if (!finiteVectorKm(velocityKmS)) {
    applyReentryHeatToVisual(visual, 0);
    return;
  }
  const earthVelocityFinite = finiteVectorKm(earthVelocityKmS);

  const relVelocityKmS = earthVelocityFinite
    ? {
        x: (Number(velocityKmS.x) || 0) - (Number(earthVelocityKmS.x) || 0),
        y: (Number(velocityKmS.y) || 0) - (Number(earthVelocityKmS.y) || 0),
        z: (Number(velocityKmS.z) || 0) - (Number(earthVelocityKmS.z) || 0),
      }
    : velocityKmS;
  const velocityScene = new THREE_NS.Vector3(
    Number(relVelocityKmS.x) || 0,
    Number(relVelocityKmS.z) || 0,
    Number(relVelocityKmS.y) || 0,
  );
  if (!vector3Finite(velocityScene)) {
    applyReentryHeatToVisual(visual, 0);
    return;
  }
  const speed = velocityScene.length();
  const prograde = speed > 1e-12 ? velocityScene.clone().multiplyScalar(1 / speed) : null;
  const bodyAxisKm = finiteVectorKm(snapshot?.bodyAxisDirectionKm)
    ? snapshot.bodyAxisDirectionKm
    : null;
  const guidanceAxisKm = finiteVectorKm(snapshot?.guidanceRequestedDirectionKm)
    ? snapshot.guidanceRequestedDirectionKm
    : null;
  const bodyAxisScene = bodyAxisKm
    ? safeNormalizeSceneDirection(
      new THREE_NS.Vector3(
        Number(bodyAxisKm.x) || 0,
        Number(bodyAxisKm.z) || 0,
        Number(bodyAxisKm.y) || 0,
      ),
      null,
    )
    : null;
  const guidanceAxisScene = guidanceAxisKm
    ? safeNormalizeSceneDirection(
      new THREE_NS.Vector3(
        Number(guidanceAxisKm.x) || 0,
        Number(guidanceAxisKm.z) || 0,
        Number(guidanceAxisKm.y) || 0,
      ),
      bodyAxisScene || null,
    )
    : null;

  let upScene = null;
  if (finiteVectorKm(rocketCoordsKm) && finiteVectorKm(earthCoordsKm)) {
    const up = new THREE_NS.Vector3(
      (Number(rocketCoordsKm.x) || 0) - (Number(earthCoordsKm.x) || 0),
      (Number(rocketCoordsKm.z) || 0) - (Number(earthCoordsKm.z) || 0),
      (Number(rocketCoordsKm.y) || 0) - (Number(earthCoordsKm.y) || 0),
    );
    const upLen = up.length();
    if (upLen > 1e-12) {
      upScene = up.multiplyScalar(1 / upLen);
    }
  }

  const defaultAxis = new THREE_NS.Vector3(0, 1, 0);
  const launchActive = Boolean(launchController?.isActive());
  const guidanceMode = String(snapshot?.guidanceMode || "").toLowerCase();
  const refuelDockingVisual = Boolean(
    snapshot?.refuelTransferActive
    || snapshot?.refuelUndockActive
    || guidanceMode.includes("rcs-dock")
    || guidanceMode.includes("rcs-fuel-lock"),
  );
  const dockingLock = refuelDockingVisualLockForBody(LAUNCH_BODY_ID, snapshot);
  const forceVerticalVisual =
    !launchActive
    || guidanceMode.includes("vertical")
    || refuelDockingVisual
    || Boolean(dockingLock);
  let targetDirection = upScene || prograde || defaultAxis;
  if (dockingLock?.directionScene) {
    targetDirection = dockingLock.directionScene;
  } else if (bodyAxisScene && !forceVerticalVisual) {
    targetDirection = bodyAxisScene;
  } else if (guidanceAxisScene && !forceVerticalVisual) {
    targetDirection = guidanceAxisScene;
  } else if (!forceVerticalVisual && upScene && prograde) {
    const altitudeKm = Number(snapshot?.altitudeKm) || 0;
    const speedBlend = clamp((speed - 0.35) / 1.8, 0, 1);
    const altitudeBlend = clamp((altitudeKm - 1.2) / 12, 0, 1);
    const blend = speedBlend * altitudeBlend;
    targetDirection = safeNormalizeSceneDirection(
      upScene
        .clone()
        .multiplyScalar(1 - blend)
        .add(prograde.clone().multiplyScalar(blend)),
      upScene,
    );
  } else if (forceVerticalVisual && upScene) {
    targetDirection = upScene;
  }

  const targetQuaternion = safeQuaternionFromUpAxis(defaultAxis, targetDirection);
  if (targetQuaternion) {
    if (dockingLock?.hardLock) {
      visual.tiltGroup.quaternion.copy(targetQuaternion);
    } else {
      visual.tiltGroup.quaternion.slerp(targetQuaternion, 0.25);
    }
  }
  const heatEligible = reentryHeatEligibleForLaunchState(LAUNCH_BODY_ID, snapshot);
  if (!heatEligible) {
    applyReentryHeatToVisual(visual, 0, true);
  } else {
    const reentryHeatTarget = computeReentryHeatTargetForBody(LAUNCH_BODY_ID, snapshot);
    applyReentryHeatToVisual(visual, reentryHeatTarget);
  }
}

function updateBoosterVehicleVisuals() {
  if (!launchFeatureEnabled || !THREE_NS) {
    return;
  }
  const visual = bodyVisuals.get(LAUNCH_BOOSTER_BODY_ID);
  if (!visual) {
    return;
  }
  const snapshot = launchController?.statusSnapshot() || null;
  applyInlineBoosterManeuverVisuals(visual.boosterVisualState, snapshot);
  applyInlineBoosterFuelVisuals(visual.boosterVisualState, {
    enabled: boosterFuelViewEnabled,
    fuelFraction: boosterFuelFractionFromSnapshot(snapshot),
  });
  if (!visual.root?.visible || !visual.tiltGroup?.quaternion) {
    applyInlineBoosterManeuverVisuals(visual.boosterVisualState, null);
    applyInlineBoosterFuelVisuals(visual.boosterVisualState, {
      enabled: false,
      fuelFraction: 0,
    });
    applyReentryHeatToVisual(visual, 0, true);
    return;
  }
  const velocityKmS = runtimeVelocityKmSOrLiveById(LAUNCH_BOOSTER_BODY_ID);
  const earthVelocityKmS = runtimeVelocityKmSOrLiveById("earth");
  const boosterCoordsKm = runtimeCoordsOrLiveById(LAUNCH_BOOSTER_BODY_ID);
  const earthCoordsKm = runtimeCoordsOrLiveById("earth");
  if (!finiteVectorKm(velocityKmS)) {
    applyReentryHeatToVisual(visual, 0);
    return;
  }
  const earthVelocityFinite = finiteVectorKm(earthVelocityKmS);

  const relVelocityKmS = earthVelocityFinite
    ? {
        x: (Number(velocityKmS.x) || 0) - (Number(earthVelocityKmS.x) || 0),
        y: (Number(velocityKmS.y) || 0) - (Number(earthVelocityKmS.y) || 0),
        z: (Number(velocityKmS.z) || 0) - (Number(earthVelocityKmS.z) || 0),
      }
    : velocityKmS;
  const velocityScene = new THREE_NS.Vector3(
    Number(relVelocityKmS.x) || 0,
    Number(relVelocityKmS.z) || 0,
    Number(relVelocityKmS.y) || 0,
  );
  if (!vector3Finite(velocityScene)) {
    applyReentryHeatToVisual(visual, 0);
    return;
  }
  const speed = velocityScene.length();
  const prograde = speed > 1e-12 ? velocityScene.clone().multiplyScalar(1 / speed) : null;

  let upScene = null;
  if (finiteVectorKm(boosterCoordsKm) && finiteVectorKm(earthCoordsKm)) {
    const up = new THREE_NS.Vector3(
      (Number(boosterCoordsKm.x) || 0) - (Number(earthCoordsKm.x) || 0),
      (Number(boosterCoordsKm.z) || 0) - (Number(earthCoordsKm.z) || 0),
      (Number(boosterCoordsKm.y) || 0) - (Number(earthCoordsKm.y) || 0),
    );
    const upLen = up.length();
    if (upLen > 1e-12) {
      upScene = up.multiplyScalar(1 / upLen);
    }
  }

  const defaultAxis = new THREE_NS.Vector3(0, 1, 0);
  let targetDirection = upScene || prograde || defaultAxis;
  if (upScene && prograde) {
    const altitudeKm = Number(snapshot?.boosterAltitudeKm) || 0;
    const blend = clamp((altitudeKm - 3) / 80, 0, 1) * clamp((speed - 0.02) / 0.35, 0, 1);
    targetDirection = safeNormalizeSceneDirection(
      upScene
        .clone()
        .multiplyScalar(1 - blend)
        .add(prograde.clone().multiplyScalar(blend)),
      upScene,
    );
  }
  const targetQuaternion = safeQuaternionFromUpAxis(defaultAxis, targetDirection);
  if (targetQuaternion) {
    const boosterPhase = String(snapshot?.boosterPhase || "").toLowerCase();
    const separationLike = boosterPhase.includes("separation");
    const slerpAlpha = separationLike ? 0.09 : 0.2;
    visual.tiltGroup.quaternion.slerp(targetQuaternion, slerpAlpha);
  }
  const heatEligible = reentryHeatEligibleForLaunchState(LAUNCH_BOOSTER_BODY_ID, snapshot);
  if (!heatEligible) {
    applyReentryHeatToVisual(visual, 0, true);
  } else {
    const reentryHeatTarget = computeReentryHeatTargetForBody(LAUNCH_BOOSTER_BODY_ID, snapshot);
    applyReentryHeatToVisual(visual, reentryHeatTarget);
  }
}

function isFleetSpacecraftVisualId(bodyId) {
  const id = String(bodyId || "");
  return id.startsWith("earth_refuel_tanker_") || id.startsWith("earth_mission_ship_");
}

function resolveFleetVisualStageIndex(bodyId, snapshot) {
  const isTanker = String(bodyId || "").startsWith("earth_refuel_tanker_")
    || String(snapshot?.vehicleKind || "").toLowerCase() === "tanker";
  const isMissionShip = String(bodyId || "").startsWith("earth_mission_ship_")
    || String(snapshot?.vehicleKind || "").toLowerCase() === "starship";
  const launchMode = String(snapshot?.launchMode || "").trim().toLowerCase();
  const orbitInjectedMissionShip = isMissionShip && launchMode === "orbit_inject";
  const rawStageIndex = Number(snapshot?.stageIndex);
  const baseStageIndex = Number.isFinite(rawStageIndex)
    ? rawStageIndex
    : (isTanker ? 1 : 0);
  if (orbitInjectedMissionShip) {
    return 1;
  }
  if (!isTanker) {
    return baseStageIndex;
  }
  const missionPhase = String(snapshot?.missionPhaseDisplay || snapshot?.missionPhase || "").toLowerCase();
  const altitudeKm = Number(snapshot?.altitudeKm);
  const orbitalMissionPhase = (
    missionPhase === "orbital_hold"
    || missionPhase === "earth_orbit_hold"
    || missionPhase === "orbital_refuel"
    || missionPhase === "parking_orbit"
    || missionPhase === "departure_window_wait"
    || missionPhase === "tli_burn"
    || missionPhase === "midcourse"
    || missionPhase === "coast_to_moon"
    || missionPhase === "lunar_orbit_insertion"
    || missionPhase === "lunar_orbit_trim"
    || missionPhase === "lunar_loiter"
    || missionPhase === "lunar_capture"
    || missionPhase === "lunar_orbit_hold"
  );
  const clearlyOrbitalAltitude = Number.isFinite(altitudeKm) && altitudeKm >= 120;
  return (orbitalMissionPhase || clearlyOrbitalAltitude)
    ? 1
    : baseStageIndex;
}

function updateFleetSpacecraftVisuals() {
  if (!launchFeatureEnabled || !THREE_NS || typeof launchController?.statusSnapshotForBody !== "function") {
    return;
  }

  const nowMs = Date.now();
  const earthCoordsKm = runtimeCoordsOrLiveById("earth");
  const earthVelocityKmS = runtimeVelocityKmSOrLiveById("earth");
  const earthVelocityFinite = finiteVectorKm(earthVelocityKmS);
  const defaultAxis = new THREE_NS.Vector3(0, 1, 0);

  for (const [bodyId, visual] of bodyVisuals.entries()) {
    if (!isFleetSpacecraftVisualId(bodyId) || !visual?.launchStackState) {
      continue;
    }

    const snapshot = launchController.statusSnapshotForBody?.(nBodyState, bodyId, nowMs) || null;
    const stageIndex = resolveFleetVisualStageIndex(bodyId, snapshot);
    applyStarshipVisualStageFn?.(visual.launchStackState, stageIndex, snapshot);

    if (!visual.root?.visible || !visual.tiltGroup?.quaternion || !snapshot) {
      applyReentryHeatToVisual(visual, 0, true);
      continue;
    }

    const vehicleVelocityKmS = runtimeVelocityKmSOrLiveById(bodyId);
    if (!finiteVectorKm(vehicleVelocityKmS)) {
      applyReentryHeatToVisual(visual, 0);
      continue;
    }

    const relVelocityKmS = earthVelocityFinite
      ? {
          x: (Number(vehicleVelocityKmS.x) || 0) - (Number(earthVelocityKmS.x) || 0),
          y: (Number(vehicleVelocityKmS.y) || 0) - (Number(earthVelocityKmS.y) || 0),
          z: (Number(vehicleVelocityKmS.z) || 0) - (Number(earthVelocityKmS.z) || 0),
        }
      : vehicleVelocityKmS;
    const velocityScene = new THREE_NS.Vector3(
      Number(relVelocityKmS.x) || 0,
      Number(relVelocityKmS.z) || 0,
      Number(relVelocityKmS.y) || 0,
    );
    if (!vector3Finite(velocityScene)) {
      applyReentryHeatToVisual(visual, 0);
      continue;
    }

    const speed = velocityScene.length();
    const prograde = speed > 1e-12 ? velocityScene.clone().multiplyScalar(1 / speed) : null;
    const bodyAxisKm = finiteVectorKm(snapshot?.bodyAxisDirectionKm)
      ? snapshot.bodyAxisDirectionKm
      : null;
    const guidanceAxisKm = finiteVectorKm(snapshot?.guidanceRequestedDirectionKm)
      ? snapshot.guidanceRequestedDirectionKm
      : null;
    const bodyAxisScene = bodyAxisKm
      ? safeNormalizeSceneDirection(
        new THREE_NS.Vector3(
          Number(bodyAxisKm.x) || 0,
          Number(bodyAxisKm.z) || 0,
          Number(bodyAxisKm.y) || 0,
        ),
        null,
      )
      : null;
    const guidanceAxisScene = guidanceAxisKm
      ? safeNormalizeSceneDirection(
        new THREE_NS.Vector3(
          Number(guidanceAxisKm.x) || 0,
          Number(guidanceAxisKm.z) || 0,
          Number(guidanceAxisKm.y) || 0,
        ),
        bodyAxisScene || null,
      )
      : null;

    const vehicleCoordsKm = runtimeCoordsOrLiveById(bodyId);
    let upScene = null;
    if (finiteVectorKm(vehicleCoordsKm) && finiteVectorKm(earthCoordsKm)) {
      const up = new THREE_NS.Vector3(
        (Number(vehicleCoordsKm.x) || 0) - (Number(earthCoordsKm.x) || 0),
        (Number(vehicleCoordsKm.z) || 0) - (Number(earthCoordsKm.z) || 0),
        (Number(vehicleCoordsKm.y) || 0) - (Number(earthCoordsKm.y) || 0),
      );
      const upLength = up.length();
      if (upLength > 1e-12) {
        upScene = up.multiplyScalar(1 / upLength);
      }
    }

    const guidanceMode = String(snapshot?.guidanceMode || snapshot?.autopilotMode || "").toLowerCase();
    const missionPhase = String(snapshot?.missionPhaseDisplay || snapshot?.missionPhase || "").toLowerCase();
    const stageName = String(snapshot?.stageName || "").toLowerCase();
    const launchMode = String(snapshot?.launchMode || "").toLowerCase();
    const isTanker = String(snapshot?.vehicleKind || "").toLowerCase() === "tanker"
      || stageName.includes("tanker")
      || String(bodyId).startsWith("earth_refuel_tanker_");
    const isMissionShip = String(snapshot?.vehicleKind || "").toLowerCase() === "starship"
      || String(bodyId).startsWith("earth_mission_ship_");
    const forceHorizontalInjectVisual = isMissionShip
      && launchMode === "orbit_inject";
    const forceHorizontalRefuelVisual = isMissionShip
      && (missionPhase === "orbital_refuel" || missionPhase === "departure_window_wait");
    const forceHorizontalVisual = forceHorizontalInjectVisual || forceHorizontalRefuelVisual;
    const dockingLock = refuelDockingVisualLockForBody(bodyId, snapshot);
    const thrustAxisKm = snapshot?.rcsThrustAxisKm;
    const thrustAxisScene = (
      isTanker
      && snapshot?.rcsActive
      && finiteVectorKm(thrustAxisKm)
    )
      ? safeNormalizeSceneDirection(
        new THREE_NS.Vector3(
          Number(thrustAxisKm.x) || 0,
          Number(thrustAxisKm.z) || 0,
          Number(thrustAxisKm.y) || 0,
        ),
        null,
      )
      : null;
    const tankerDockingVerticalVisual = isTanker && (
      guidanceMode.includes("rcs-fuel-lock")
      || guidanceMode.includes("rcs-docked-lock")
      || guidanceMode.includes("rcs-undock")
      || guidanceMode.includes("rcs-dock")
    );
    const forceVerticalVisual = Boolean(
      dockingLock
      || guidanceMode.includes("vertical")
      || tankerDockingVerticalVisual
    );

    let targetDirection = upScene || prograde || defaultAxis;
    if (forceHorizontalVisual) {
      targetDirection = bodyAxisScene
        || guidanceAxisScene
        || prograde
        || safeNormalizeSceneDirection(
          defaultAxis.clone().applyQuaternion(visual.tiltGroup.quaternion),
          defaultAxis,
        );
    } else if (dockingLock?.directionScene) {
      targetDirection = dockingLock.directionScene;
    } else if (bodyAxisScene && !forceVerticalVisual) {
      targetDirection = bodyAxisScene;
    } else if (guidanceAxisScene && !forceVerticalVisual) {
      targetDirection = guidanceAxisScene;
    } else if (thrustAxisScene && !forceVerticalVisual) {
      targetDirection = thrustAxisScene;
    } else if (forceVerticalVisual && upScene) {
      targetDirection = upScene;
    } else if (upScene && prograde) {
      const altitudeKm = Number(snapshot?.altitudeKm) || 0;
      const blend = clamp((altitudeKm - 2) / 42, 0, 1) * clamp((speed - 0.03) / 0.6, 0, 1);
      targetDirection = safeNormalizeSceneDirection(
        upScene
          .clone()
          .multiplyScalar(1 - blend)
          .add(prograde.clone().multiplyScalar(blend)),
        upScene,
      );
    }

    const targetQuaternion = safeQuaternionFromUpAxis(defaultAxis, targetDirection);
    if (targetQuaternion) {
      if (dockingLock?.hardLock) {
        visual.tiltGroup.quaternion.copy(targetQuaternion);
      } else {
        const alignAlpha = forceHorizontalVisual
          ? 0.46
          : (forceVerticalVisual ? 0.3 : 0.18);
        visual.tiltGroup.quaternion.slerp(targetQuaternion, alignAlpha);
      }
    }

    const heatEligible = reentryHeatEligibleForLaunchState(bodyId, snapshot);
    if (!heatEligible) {
      applyReentryHeatToVisual(visual, 0, true);
    } else {
      const reentryHeatTarget = computeReentryHeatTargetForBody(bodyId, snapshot);
      applyReentryHeatToVisual(visual, reentryHeatTarget);
    }
  }
}

function setupObservationControls() {
  updateSurfaceObserverTargetOptionLabel();
  if (observationModeSelect) {
    observationModeSelect.value = observation.mode;
    observationModeSelect.addEventListener("change", () => {
      setObservationMode(observationModeSelect.value);
    });
  }
  if (surfaceObserverTargetSelect) {
    surfaceObserverTargetSelect.value = observation.surfacePresetId;
    surfaceObserverTargetSelect.addEventListener("change", () => {
      setSurfaceObserverPreset(surfaceObserverTargetSelect.value);
    });
  }
  updateObservationControlVisibility();
  syncLiveLocationTrackingState();
  updateObservationStatus();
}

function setObservationMode(mode) {
  const nextMode = Object.values(OBSERVATION_MODES).includes(mode)
    ? mode
    : OBSERVATION_MODES.BODY_LOCK;
  if (observation.mode === nextMode) {
    return;
  }
  const previousMode = observation.mode;
  observation.mode = nextMode;
  updateObservationControlVisibility();

  if (previousMode === OBSERVATION_MODES.SURFACE && nextMode !== OBSERVATION_MODES.SURFACE) {
    syncOrbitFromCurrentCamera();
  }
  if (nextMode === OBSERVATION_MODES.SURFACE) {
    const preset = getSurfaceObserverPreset(observation.surfacePresetId);
    if (preset?.bodyId && metaById.has(preset.bodyId)) {
      setSelected(preset.bodyId, false);
    }
  }
  if (nextMode === OBSERVATION_MODES.BODY_LOCK && selectedId) {
    const visual = bodyVisuals.get(selectedId);
    if (visual) {
      orbit.target.copy(visual.root.position);
      orbit.minDistance = minOrbitDistanceForVisual(visual);
      orbit.radius = clamp(orbit.radius, orbit.minDistance, orbit.maxDistance);
    }
  }
  syncLiveLocationTrackingState();
  updateObservationStatus();
}

function setSurfaceObserverPreset(presetId) {
  const preset = getSurfaceObserverPreset(presetId);
  if (!preset) {
    return;
  }
  observation.surfacePresetId = preset.id;
  observation.surfaceAltitudeScale = 1;
  observation.surfaceYaw = 0;
  observation.surfacePitch = rad(2);
  if (observation.mode === OBSERVATION_MODES.SURFACE && metaById.has(preset.bodyId)) {
    setSelected(preset.bodyId, false);
  }
  syncLiveLocationTrackingState();
  updateObservationStatus();
}

function updateObservationControlVisibility() {
  if (surfaceObserverRow) {
    surfaceObserverRow.classList.toggle("hidden", observation.mode !== OBSERVATION_MODES.SURFACE);
  }
  if (observationModeSelect && observationModeSelect.value !== observation.mode) {
    observationModeSelect.value = observation.mode;
  }
  if (surfaceObserverTargetSelect && surfaceObserverTargetSelect.value !== observation.surfacePresetId) {
    surfaceObserverTargetSelect.value = observation.surfacePresetId;
  }
}

function updateObservationStatus(anchor = null) {
  if (!observationStatusNode) {
    return;
  }
  if (observation.mode === OBSERVATION_MODES.FREE) {
    observationStatusNode.textContent = "Free camera. Drag rotates around current target.";
    return;
  }
  if (observation.mode === OBSERVATION_MODES.BODY_LOCK) {
    const bodyName = selectedId && metaById.has(selectedId) ? metaById.get(selectedId).name : "Sun";
    observationStatusNode.textContent = `Body lock: ${bodyName}`;
    return;
  }
  const preset = getSurfaceObserverPreset(observation.surfacePresetId);
  if (!preset) {
    observationStatusNode.textContent = "Surface observer: n/a";
    return;
  }
  const altitude = Number(anchor?.altitudeKm) || ((preset.altitudeKm || 1) * observation.surfaceAltitudeScale);
  const source = anchor?.label || preset.label;
  observationStatusNode.textContent = `Observer: ${source} (${formatNumber(altitude)} km alt)`;
}

function syncOrbitFromCurrentCamera() {
  if (!camera || !orbit.target) {
    return;
  }
  const offset = camera.position.clone().sub(orbit.target);
  const radius = offset.length();
  if (!(radius > 1e-12)) {
    return;
  }
  orbit.radius = clamp(radius, orbit.minDistance, orbit.maxDistance);
  const radialXZ = Math.hypot(offset.x, offset.z);
  orbit.polar = clamp(Math.atan2(radialXZ, offset.y), orbit.minPolar, orbit.maxPolar);
  orbit.azimuth = normalizeAngle(Math.atan2(offset.x, offset.z));
}

function isSunOrbitPlanet(body) {
  return (
    body.body_type === "planet" &&
    body.id !== "sun" &&
    body.parent === "sun" &&
    Number(body.semimajor_axis_km) > 0 &&
    Number(body.orbital_period_days) > 0
  );
}

function createOrbitVisual(body) {
  const a = Number(body.semimajor_axis_km) * DISTANCE_SCALE;
  if (!(a > 0)) {
    return null;
  }
  const e = clamp(ORBIT_ECCENTRICITY[body.id] ?? 0, 0, 0.9);
  const b = a * Math.sqrt(Math.max(1 - (e * e), 0.0000001));
  const omega = rad(ORBIT_PERIHELION_DEG[body.id] ?? 0);
  const periodSeconds = Number(body.orbital_period_days) * 86400;

  const points = [];
  const segments = 720;
  for (let i = 0; i < segments; i += 1) {
    const E = (i / segments) * Math.PI * 2;
    const xLocal = a * (Math.cos(E) - e);
    const zLocal = b * Math.sin(E);
    const rotated = rotateXZ(xLocal, zLocal, omega);
    points.push(new THREE_NS.Vector3(rotated.x, 0, rotated.z));
  }

  const orbitGeometry = new THREE_NS.BufferGeometry().setFromPoints(points);
  const orbitMaterial = new THREE_NS.LineBasicMaterial({
    color: new THREE_NS.Color(body.color || "#7f8ea8"),
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const orbitLine = new THREE_NS.LineLoop(orbitGeometry, orbitMaterial);

  const group = new THREE_NS.Object3D();
  group.add(orbitLine);
  let marker = null;
  if (SHOW_ORBIT_MARKERS) {
    const markerRadius = clamp(a * 0.0012, 0.05, 0.5);
    const markerGeometry = new THREE_NS.SphereGeometry(markerRadius, 12, 12);
    const markerMaterial = new THREE_NS.MeshBasicMaterial({
      color: new THREE_NS.Color(body.color || "#c9d6ea"),
    });
    marker = new THREE_NS.Mesh(markerGeometry, markerMaterial);
    group.add(marker);
  }

  return {
    id: body.id,
    body,
    group,
    orbitLine,
    marker,
    a,
    b,
    e,
    omega,
    periodSeconds,
    baseMeanAnomaly: 0,
    baseTimestampMs: latestSolarTimestampMs,
    initialized: false,
  };
}

async function createSpacecraftVisual(body) {
  const renderRadius = starshipPhysicalRenderRadiusSceneFn
    ? starshipPhysicalRenderRadiusSceneFn(DISTANCE_SCALE)
    : Math.max((Number(body?.radius_km) || 0.0045) * DISTANCE_SCALE, 1e-8);
  const isLaunchVehicle = body?.id === LAUNCH_BODY_ID;
  const isLaunchBooster = body?.id === LAUNCH_BOOSTER_BODY_ID;
  const isRefuelTanker = String(body?.id || "").startsWith("earth_refuel_tanker_");
  const isMissionShip = String(body?.id || "").startsWith("earth_mission_ship_");
  const isFleetSpacecraft = isRefuelTanker || isMissionShip;
  const root = new THREE_NS.Object3D();
  const tiltGroup = new THREE_NS.Object3D();
  const spinGroup = new THREE_NS.Object3D();
  root.add(tiltGroup);
  tiltGroup.add(spinGroup);

  let stack = null;
  if (isLaunchBooster) {
    stack = createInlineBoosterVisual(THREE_NS, DISTANCE_SCALE);
  } else {
    if (createStarshipStackVisualFn) {
      try {
        stack = await createStarshipStackVisualFn(THREE_NS, DISTANCE_SCALE);
      } catch (error) {
        console.warn("[launch] Starship visual stack creation failed, using inline fallback.", error);
        stack = null;
      }
    }
    if (!stack?.root) {
      stack = createInlineStarshipStackVisual(THREE_NS, DISTANCE_SCALE);
    }
  }
  if (stack?.root) {
    spinGroup.add(stack.root);
  } else {
    const fallbackMesh = new THREE_NS.Mesh(
      new THREE_NS.SphereGeometry(Math.max(renderRadius, 1e-8), 12, 12),
      new THREE_NS.MeshStandardMaterial({
        color: new THREE_NS.Color(0x9aa7ba),
        roughness: 0.55,
        metalness: 0.3,
      }),
    );
    spinGroup.add(fallbackMesh);
  }
  let spacecraftWorldMarker = null;
  if (SPACECRAFT_WORLD_MARKER_ENABLED) {
    spacecraftWorldMarker = createSpacecraftWorldMarker(body?.id);
    if (spacecraftWorldMarker) {
      root.add(spacecraftWorldMarker);
    }
  }
  if (stack?.state) {
    const initialSnapshot = typeof launchController?.statusSnapshotForBody === "function"
      ? (launchController.statusSnapshotForBody(nBodyState, body?.id, Date.now()) || null)
      : null;
    const initialStageIndex = resolveFleetVisualStageIndex(body?.id, initialSnapshot);
    applyStarshipVisualStageFn?.(stack.state, initialStageIndex, initialSnapshot);
  }

  const lod = {
    levels: [],
    update() {},
  };
  const stackSource = stack?.root?.userData?.starshipAssetSource || null;
  const stackResolution = stack?.root?.userData?.starshipTextureResolution || null;
  const isInlineStack = typeof stackSource === "string"
    && stackSource.startsWith("inline_procedural_starship");
  const isProceduralStack = isInlineStack || (
    typeof stackSource === "string" && stackSource.includes("procedural")
  );
  const isExternalStack = Boolean(stackSource) && !isProceduralStack;

  const visual = {
    id: body.id,
    body,
    root,
    tiltGroup,
    spinGroup,
    lod,
    renderRadius,
    rotationSpeedRadPerSecond: 0,
    cloudMesh: null,
    atmosphereMesh: null,
    ringMesh: null,
    pickMesh: null,
    gravityArrow: null,
    locationMarker: null,
    spacecraftWorldMarker,
    textureMode: isExternalStack ? "external_spacecraft" : "procedural_spacecraft",
    ringMode: "none",
    mapSource: isLaunchBooster
      ? "inline_super_heavy_booster_geometry"
        : (stackSource
          ? `${stackSource}${stackResolution ? ` (${stackResolution})` : ""}`
          : (isInlineStack
          ? (
            isRefuelTanker
              ? "inline_starship_tanker_geometry"
              : (isMissionShip ? "inline_starship_mission_geometry" : "inline_starship_booster_geometry")
          )
          : (stack ? "local_starship_geometry" : "fallback_spacecraft_geometry"))),
    launchStackState: (isLaunchVehicle || isFleetSpacecraft) ? (stack?.state || null) : null,
    boosterVisualState: isLaunchBooster ? (stack?.state || null) : null,
    extraMaterials: stack?.materials || [],
  };

  if (GRAVITY_VECTORS_ENABLED) {
    const gravityArrow = createGravityVectorHelper(renderRadius);
    if (gravityArrow) {
      root.add(gravityArrow);
      visual.gravityArrow = gravityArrow;
    }
  }

  const pickRadius = clamp(Math.max(renderRadius * 4000, 0.00008), 0.00008, 0.00032);
  const pickGeometry = new THREE_NS.SphereGeometry(pickRadius, 10, 10);
  const pickMaterial = new THREE_NS.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const pickMesh = new THREE_NS.Mesh(pickGeometry, pickMaterial);
  pickMesh.userData.bodyId = body.id;
  root.add(pickMesh);
  visual.pickMesh = pickMesh;

  return visual;
}

async function createBodyVisual(body) {
  if (body.body_type === "spacecraft") {
    return await createSpacecraftVisual(body);
  }
  const plan = getTexturePlan(body);
  photorealRetryCount.set(body.id, 0);
  let textures = null;
  if (body.id === "sun") {
    const remote = await loadTexturePlan(plan, { timeoutMs: SUN_TEXTURE_LOAD_TIMEOUT_MS });
    if (remote?.map) {
      textures = {
        ...remote,
        textureMode: "photoreal_hd",
      };
    } else {
      const procedural = await createProceduralPlanetTextures(body, plan);
      textures = { ...procedural, textureMode: "procedural_star" };
    }
  } else if (body.id === "earth") {
    const remote = await loadTexturePlan(plan, { timeoutMs: EARTH_TEXTURE_LOAD_TIMEOUT_MS });
    if (remote?.map) {
      textures = {
        ...remote,
        bumpScale: remote.bumpScale ?? plan.bumpScale ?? defaultPlanetBumpScale(body.id, "rocky"),
        textureMode: "photoreal_hd",
      };
    } else {
      const procedural = await createProceduralPlanetTextures(body, plan);
      textures = { ...procedural, textureMode: "procedural_planet_fallback" };
    }
  } else if (body.body_type === "planet") {
    const remote = await loadTexturePlan(plan, { timeoutMs: PHOTOREAL_BODY_TEXTURE_TIMEOUT_MS });
    if (remote?.map) {
      const profile = PLANET_SURFACE_PROFILES[body.id] || PLANET_SURFACE_PROFILES.default;
      textures = {
        ...remote,
        bumpScale: remote.bumpScale ?? plan.bumpScale ?? defaultPlanetBumpScale(body.id, profile.type),
        textureMode: "photoreal_hd",
      };
    } else {
      const procedural = await createProceduralPlanetTextures(body, plan);
      textures = { ...procedural, textureMode: "procedural_planet_fallback" };
    }
  } else if (body.body_type === "moon") {
    const remote = await loadTexturePlan(plan, { timeoutMs: PHOTOREAL_BODY_TEXTURE_TIMEOUT_MS });
    if (remote?.map) {
      textures = {
        ...remote,
        bumpScale: remote.bumpScale ?? plan.bumpScale ?? 0.07,
        textureMode: "photoreal_hd",
      };
    } else {
      const profile = MOON_SURFACE_PROFILES[body.id] || MOON_SURFACE_PROFILES.default;
      const proceduralMoon = await createProceduralMoonTextures(profile, plan.bumpScale ?? 0.07);
      textures = { ...proceduralMoon, textureMode: "procedural_moon" };
    }
  } else {
    const remote = await loadTexturePlan(plan);
    textures = { ...remote, textureMode: remote?.proceduralMoon ? "procedural_moon" : "remote" };
  }
  if (RINGED_PLANET_IDS.has(body.id) && !textures.ringColor) {
    const ringProcedural = await createProceduralRingTextures(body);
    textures = { ...textures, ...ringProcedural, ringMode: "procedural" };
  } else if (textures.ringColor) {
    textures = { ...textures, ringMode: "remote" };
  } else {
    textures = { ...textures, ringMode: "none" };
  }
  const renderRadius = renderRadiusForBody(body);

  const root = new THREE_NS.Object3D();
  const tiltGroup = new THREE_NS.Object3D();
  const spinGroup = new THREE_NS.Object3D();
  root.add(tiltGroup);
  tiltGroup.add(spinGroup);

  const axisScene = spinAxisSceneVectorForBody(body.id);
  if (axisScene) {
    tiltGroup.quaternion.setFromUnitVectors(new THREE_NS.Vector3(0, 1, 0), axisScene);
  } else {
    const tilt = AXIAL_TILT_DEG[body.id] ?? 0;
    tiltGroup.rotation.z = rad(tilt);
  }

  const material = createPlanetMaterial(body, plan, textures, renderRadius);
  const lod = createPlanetLOD(body, renderRadius, material);
  spinGroup.add(lod);

  const visual = {
    id: body.id,
    body,
    root,
    tiltGroup,
    spinGroup,
    lod,
    renderRadius,
    rotationSpeedRadPerSecond: getRotationSpeedRadPerSecond(body),
    cloudMesh: null,
    atmosphereMesh: null,
    ringMesh: null,
    pickMesh: null,
    gravityArrow: null,
    locationMarker: null,
    textureMode: textures.textureMode || "remote",
    ringMode: textures.ringMode || "none",
    mapSource: textures?.map?.userData?.sourceUrl || null,
  };

  if (textures.clouds) {
    const cloudMesh = buildCloudMesh(body.id, renderRadius, textures.clouds);
    spinGroup.add(cloudMesh);
    visual.cloudMesh = cloudMesh;
  }

  if (plan.atmosphereColor && body.id !== "earth") {
    const atmosphere = createAtmosphereMesh(renderRadius, plan.atmosphereColor);
    tiltGroup.add(atmosphere);
    visual.atmosphereMesh = atmosphere;
  }

  if (textures.ringColor) {
    const ring = createRingMesh(body, renderRadius, textures.ringColor, textures.ringAlpha);
    tiltGroup.add(ring);
    visual.ringMesh = ring;
  }

  if (body.id === "earth") {
    const locationMarker = createEarthLocationMarker(renderRadius, earthLocationMarkerConfig());
    if (locationMarker) {
      spinGroup.add(locationMarker);
      visual.locationMarker = locationMarker;
    }
  }

  if (GRAVITY_VECTORS_ENABLED) {
    const gravityArrow = createGravityVectorHelper(renderRadius);
    if (gravityArrow) {
      root.add(gravityArrow);
      visual.gravityArrow = gravityArrow;
    }
  }

  const pickRadius =
    body.id === "sun"
      ? clamp(renderRadius * 2.0, 0.24, 0.82)
      : body.body_type === "planet"
        ? clamp(renderRadius * 4.1, Math.max(MIN_PICK_RADIUS, 0.06), 0.42)
        : body.body_type === "spacecraft"
          ? clamp(renderRadius * 4000, 0.00008, 0.00032)
        : clamp(renderRadius * 6.2, Math.max(MIN_PICK_RADIUS * 1.2, 0.05), 0.26);
  const pickGeometry = new THREE_NS.SphereGeometry(pickRadius, 10, 10);
  const pickMaterial = new THREE_NS.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const pickMesh = new THREE_NS.Mesh(pickGeometry, pickMaterial);
  pickMesh.userData.bodyId = body.id;
  root.add(pickMesh);
  visual.pickMesh = pickMesh;

  if (body.id === "sun" || body.body_type === "planet" || body.body_type === "moon") {
    void upgradeVisualToPhotorealTextures(body, visual, plan, renderRadius);
  }

  return visual;
}

function getTexturePlan(body) {
  if (BODY_TEXTURE_CONFIG[body.id]) {
    return BODY_TEXTURE_CONFIG[body.id];
  }
  if (body.body_type === "moon") {
    return buildUniqueMoonTexturePlan(body.id);
  }
  return { map: null };
}

function buildUniqueMoonTexturePlan(moonId) {
  const override = MOON_TEXTURE_OVERRIDES[moonId];
  if (override) {
    return {
      ...override,
      map: uniqueTextureUrlList(override.map),
      bump: uniqueTextureUrlList(override.bump),
      normal: uniqueTextureUrlList(override.normal),
      specular: uniqueTextureUrlList(override.specular),
      emissive: uniqueTextureUrlList(override.emissive),
      clouds: uniqueTextureUrlList(override.clouds),
      ringColor: uniqueTextureUrlList(override.ringColor),
      ringAlpha: uniqueTextureUrlList(override.ringAlpha),
    };
  }
  return {
    map: [
      `${LOCAL_MOON_TEXTURE_ROOT}${moonId}_surface_local.png?v=${LOCAL_TEXTURE_ASSET_VERSION}`,
    ],
    bump: [
      `${LOCAL_MOON_TEXTURE_ROOT}${moonId}_bump_local.png?v=${LOCAL_TEXTURE_ASSET_VERSION}`,
    ],
    bumpScale: 0.07,
  };
}

function uniqueTextureUrlList(urlOrUrls) {
  if (!urlOrUrls) {
    return undefined;
  }
  const normalized = normalizeTextureUrls(urlOrUrls);
  if (normalized.length === 0) {
    return undefined;
  }
  return [...new Set(normalized)];
}

async function loadTexturePlan(plan, options = {}) {
  if (plan.proceduralMoon) {
    const profile = plan.moonProfile || MOON_SURFACE_PROFILES.default;
    return createProceduralMoonTextures(profile, plan.bumpScale ?? 0.07);
  }
  const timeoutMs = Number(options.timeoutMs);
  const [map, bump, normal, specular, emissive, clouds, ringColor, ringAlpha] = await Promise.all([
    loadTextureSafe(plan.map, { srgb: true, timeoutMs }),
    loadTextureSafe(plan.bump, { srgb: false, timeoutMs }),
    loadTextureSafe(plan.normal, { srgb: false, timeoutMs }),
    loadTextureSafe(plan.specular, { srgb: false, timeoutMs }),
    loadTextureSafe(plan.emissive, { srgb: true, timeoutMs }),
    loadTextureSafe(plan.clouds, { srgb: true, timeoutMs }),
    loadTextureSafe(plan.ringColor, { srgb: true, timeoutMs }),
    loadTextureSafe(plan.ringAlpha, { srgb: false, timeoutMs }),
  ]);
  return { map, bump, normal, specular, emissive, clouds, ringColor, ringAlpha };
}

async function loadTextureSafe(urlOrUrls, options) {
  const urls = normalizeTextureUrls(urlOrUrls);
  if (urls.length === 0) {
    return null;
  }

  const srgb = options?.srgb ?? true;
  const timeoutMs = Number(options?.timeoutMs) > 0 ? Number(options.timeoutMs) : TEXTURE_LOAD_TIMEOUT_MS;
  const cacheKey = `${urls.join("|")}::${srgb ? "srgb" : "linear"}`;
  if (textureCache.has(cacheKey)) {
    return textureCache.get(cacheKey);
  }

  const texturePromise = (async () => {
    for (const url of urls) {
      const texture = await loadTextureFromUrl(url, srgb, timeoutMs);
      if (texture) {
        return texture;
      }
    }
    return null;
  })();

  textureCache.set(cacheKey, texturePromise);
  return texturePromise;
}

function loadTextureFromUrl(url, srgb, timeoutMs = TEXTURE_LOAD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(null);
    }, timeoutMs);

    textureLoader.load(
      url,
      (texture) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (srgb) {
          texture.colorSpace = THREE_NS.SRGBColorSpace;
        } else if (THREE_NS.NoColorSpace) {
          texture.colorSpace = THREE_NS.NoColorSpace;
        }
        texture.anisotropy = maxTextureAnisotropy();
        texture.wrapS = THREE_NS.RepeatWrapping;
        texture.wrapT = THREE_NS.ClampToEdgeWrapping;
        if (!texture.userData) {
          texture.userData = {};
        }
        texture.userData.sourceUrl = url;
        resolve(texture);
      },
      undefined,
      () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(null);
      },
    );
  });
}

function normalizeTextureUrls(urlOrUrls) {
  if (!urlOrUrls) {
    return [];
  }
  if (!Array.isArray(urlOrUrls)) {
    return [urlOrUrls];
  }
  return urlOrUrls.filter((candidate) => typeof candidate === "string" && candidate.length > 0);
}

function buildCloudMesh(bodyId, renderRadius, cloudMap) {
  const cloudGeometry = new THREE_NS.SphereGeometry(renderRadius * 1.012, 72, 72);
  const cloudOpacity =
    bodyId === "venus"
      ? 0.88
      : bodyId === "earth"
        ? 0.42
        : 0.7;
  const cloudMaterial = new THREE_NS.MeshPhongMaterial({
    map: cloudMap,
    transparent: true,
    opacity: cloudOpacity,
    depthWrite: false,
    side: THREE_NS.DoubleSide,
    blending: THREE_NS.NormalBlending,
  });
  return new THREE_NS.Mesh(cloudGeometry, cloudMaterial);
}

async function upgradeVisualToPhotorealTextures(body, visual, plan, renderRadius) {
  const photorealPlan = BODY_TEXTURE_CONFIG[body.id] || (body.body_type === "moon" ? buildUniqueMoonTexturePlan(body.id) : null) || plan;
  if (!photorealPlan || photorealPlan.proceduralMoon) {
    return;
  }
  try {
    const activeVisual = bodyVisuals.get(body.id);
    if (activeVisual && activeVisual !== visual) {
      return;
    }

    const timeoutMs =
      body.id === "sun"
        ? SUN_TEXTURE_LOAD_TIMEOUT_MS
        : body.id === "earth"
          ? EARTH_TEXTURE_LOAD_TIMEOUT_MS
          : PHOTOREAL_BODY_TEXTURE_TIMEOUT_MS;
    const remote = await loadTexturePlan(photorealPlan, { timeoutMs });
    if (!remote || !remote.map) {
      schedulePhotorealRetry(body, visual, photorealPlan, renderRadius);
      return;
    }
    const latestVisual = bodyVisuals.get(body.id);
    if (latestVisual && latestVisual !== visual) {
      return;
    }
    const profile = PLANET_SURFACE_PROFILES[body.id] || PLANET_SURFACE_PROFILES.default;

    const textureSet = {
      ...remote,
      bumpScale: remote.bumpScale ?? photorealPlan.bumpScale ?? defaultPlanetBumpScale(body.id, profile.type),
    };
    const material = createPlanetMaterial(body, photorealPlan, textureSet, renderRadius);
    replaceLodMaterial(visual.lod, material);

    if (remote.clouds) {
      if (visual.cloudMesh) {
        visual.cloudMesh.material.map = remote.clouds;
        visual.cloudMesh.material.needsUpdate = true;
      } else {
        const cloudMesh = buildCloudMesh(body.id, renderRadius, remote.clouds);
        visual.spinGroup.add(cloudMesh);
        visual.cloudMesh = cloudMesh;
      }
    }

    if (remote.ringColor && RINGED_PLANET_IDS.has(body.id)) {
      if (visual.ringMesh) {
        visual.ringMesh.material.map = remote.ringColor;
        visual.ringMesh.material.alphaMap = remote.ringAlpha || remote.ringColor;
        visual.ringMesh.material.needsUpdate = true;
      } else {
        const ring = createRingMesh(body, renderRadius, remote.ringColor, remote.ringAlpha);
        visual.tiltGroup.add(ring);
        visual.ringMesh = ring;
      }
      visual.ringMode = "photoreal_hd";
    }

    visual.textureMode = "photoreal_hd";
    visual.mapSource = remote.map?.userData?.sourceUrl || visual.mapSource;
    photorealRetryCount.delete(body.id);
  } catch (error) {
    console.warn(`[solar-system] Could not upgrade ${body.id} to photoreal textures:`, error);
    schedulePhotorealRetry(body, visual, photorealPlan, renderRadius);
  }
}

function schedulePhotorealRetry(body, visual, plan, renderRadius) {
  const attempts = photorealRetryCount.get(body.id) ?? 0;
  if (attempts >= PHOTOREAL_RETRY_LIMIT) {
    return;
  }
  photorealRetryCount.set(body.id, attempts + 1);
  const delayMs = PHOTOREAL_RETRY_DELAY_MS * (attempts + 1);
  setTimeout(() => {
    const currentVisual = bodyVisuals.get(body.id);
    if (currentVisual && currentVisual !== visual) {
      return;
    }
    void upgradeVisualToPhotorealTextures(body, visual, plan, renderRadius);
  }, delayMs);
}

function replaceLodMaterial(lod, material) {
  if (!lod || !Array.isArray(lod.levels)) {
    return;
  }
  const oldMaterials = new Set();
  for (const level of lod.levels) {
    const mesh = level.object;
    if (!mesh || !mesh.isMesh) {
      continue;
    }
    if (mesh.material) {
      oldMaterials.add(mesh.material);
    }
    mesh.material = material;
  }
  for (const oldMaterial of oldMaterials) {
    if (oldMaterial !== material && oldMaterial?.dispose) {
      oldMaterial.dispose();
    }
  }
}

function surfaceRenderingLabel(textureMode) {
  if (textureMode === "photoreal_hd") {
    return "Photoreal HD maps";
  }
  if (textureMode === "remote") {
    return "Photoreal texture maps";
  }
  if (textureMode === "procedural_spacecraft") {
    return "Parametric Starship/Super Heavy geometry";
  }
  if (textureMode === "external_spacecraft") {
    return "External Starship/Super Heavy model";
  }
  return "Procedural high-detail fallback";
}

function createProceduralMoonTextures(profile, bumpScale) {
  const key = `moon-proc:${profile.low}:${profile.mid}:${profile.high}:${profile.contrast}:${profile.terrainStrength}:${bumpScale}`;
  if (textureCache.has(key)) {
    return textureCache.get(key);
  }

  const promise = Promise.resolve().then(() => {
    const width = 512;
    const height = 256;
    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = width;
    colorCanvas.height = height;
    const bumpCanvas = document.createElement("canvas");
    bumpCanvas.width = width;
    bumpCanvas.height = height;

    const colorCtx = colorCanvas.getContext("2d");
    const bumpCtx = bumpCanvas.getContext("2d");
    const colorImage = colorCtx.createImageData(width, height);
    const bumpImage = bumpCtx.createImageData(width, height);
    const colorData = colorImage.data;
    const bumpData = bumpImage.data;

    const low = hexToRgb(profile.low);
    const mid = hexToRgb(profile.mid);
    const high = hexToRgb(profile.high);
    const contrast = profile.contrast ?? 0.2;
    const terrain = profile.terrainStrength ?? 0.58;
    const seedA = hashStringToSeed(`${profile.low}:${profile.mid}`);
    const seedB = hashStringToSeed(`${profile.high}:${profile.low}`);

    for (let y = 0; y < height; y += 1) {
      const v = y / (height - 1);
      const lat = (v * 2) - 1;
      const latitudeFade = 1 - Math.pow(Math.abs(lat), 1.55);
      for (let x = 0; x < width; x += 1) {
        const u = x / (width - 1);
        const idx = (y * width + x) * 4;

        const n1 = fbm(u * 7.2, v * 3.9, seedA, 4);
        const n2 = ridgeFbm(u * 15.0, v * 8.4, seedB, 3);
        const band = 0.5 + 0.5 * Math.sin((u * 12.0) + (v * 4.5) + seedA * 0.00001);

        let h = (n1 * 0.55) + (n2 * 0.35) + (band * 0.1 * latitudeFade);
        h = clamp(h + contrast, 0, 1);

        let c = mixTriColor(low, mid, high, h);
        c = tuneMoonColor(profile, c, h, latitudeFade, n2);
        const rough = clamp(h * (0.75 + terrain * 0.45), 0, 1);
        colorData[idx] = Math.round(c.r * (0.9 + rough * 0.2));
        colorData[idx + 1] = Math.round(c.g * (0.9 + rough * 0.2));
        colorData[idx + 2] = Math.round(c.b * (0.9 + rough * 0.2));
        colorData[idx + 3] = 255;

        const bump = Math.round(rough * 255);
        bumpData[idx] = bump;
        bumpData[idx + 1] = bump;
        bumpData[idx + 2] = bump;
        bumpData[idx + 3] = 255;
      }
    }

    colorCtx.putImageData(colorImage, 0, 0);
    bumpCtx.putImageData(bumpImage, 0, 0);

    const map = new THREE_NS.CanvasTexture(colorCanvas);
    map.colorSpace = THREE_NS.SRGBColorSpace;
    map.anisotropy = maxTextureAnisotropy();

    const bump = new THREE_NS.CanvasTexture(bumpCanvas);
    if (THREE_NS.NoColorSpace) {
      bump.colorSpace = THREE_NS.NoColorSpace;
    }
    bump.anisotropy = maxTextureAnisotropy();

    return {
      map,
      bump,
      normal: null,
      specular: null,
      emissive: null,
      clouds: null,
      ringColor: null,
      ringAlpha: null,
      bumpScale: bumpScale ?? 0.07,
      proceduralMoon: true,
    };
  });

  textureCache.set(key, promise);
  return promise;
}

function createProceduralPlanetTextures(body, plan) {
  const profile = PLANET_SURFACE_PROFILES[body.id] || PLANET_SURFACE_PROFILES.default;
  const key = `planet-proc:${body.id}:${profile.type}:${profile.low}:${profile.mid}:${profile.high}:${profile.contrast}:${profile.terrainStrength}:${plan.bumpScale ?? "default"}`;
  if (textureCache.has(key)) {
    return textureCache.get(key);
  }

  const promise = Promise.resolve().then(() => {
    const width = profile.type === "gas" ? 1536 : 1024;
    const height = Math.floor(width / 2);
    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = width;
    colorCanvas.height = height;
    const bumpCanvas = document.createElement("canvas");
    bumpCanvas.width = width;
    bumpCanvas.height = height;

    const colorCtx = colorCanvas.getContext("2d");
    const bumpCtx = bumpCanvas.getContext("2d");
    const colorImage = colorCtx.createImageData(width, height);
    const bumpImage = bumpCtx.createImageData(width, height);
    const colorData = colorImage.data;
    const bumpData = bumpImage.data;

    const low = hexToRgb(profile.low);
    const mid = hexToRgb(profile.mid);
    const high = hexToRgb(profile.high);
    const contrast = profile.contrast ?? 0.2;
    const terrain = profile.terrainStrength ?? 0.58;
    const seedA = hashStringToSeed(`${body.id}:planet:A`);
    const seedB = hashStringToSeed(`${body.id}:planet:B`);
    const tau = Math.PI * 2;
    const earthWaterLow = hexToRgb("#0a2d64");
    const earthWaterMid = hexToRgb("#1f5f9a");
    const earthWaterHigh = hexToRgb("#6ebde8");
    const earthLandLow = hexToRgb("#2d6d43");
    const earthLandMid = hexToRgb("#7b8b4b");
    const earthLandHigh = hexToRgb("#ddd8c8");

    for (let y = 0; y < height; y += 1) {
      const v = y / (height - 1);
      const lat = (v * 2) - 1;
      for (let x = 0; x < width; x += 1) {
        const u = x / (width - 1);
        const idx = (y * width + x) * 4;

        const base = sphericalFbm(u, v, seedA, profile.type === "gas" ? 6.5 : 4.4, 5);
        const detail = sphericalRidgeFbm(u, v, seedB, profile.type === "gas" ? 14.0 : 11.5, 4);
        const swirl = 0.5 + (0.5 * Math.sin((u * tau * 2.5) + (v * tau * 1.3) + (seedA * 0.00001)));

        let h = 0.5;
        if (profile.type === "star") {
          const convection = sphericalFbm(u, v, seedA + 717, 9.0, 5);
          const granules = Math.pow(sphericalRidgeFbm(u, v, seedB + 151, 24.0, 4), 1.25);
          h = clamp((convection * 0.44) + (granules * 0.38) + (swirl * 0.18) + (contrast * 0.42), 0, 1);
        } else if (profile.type === "gas") {
          const bandFreq = body.id === "jupiter" ? 18.0 : body.id === "saturn" ? 14.0 : 8.0;
          const warp = (sphericalFbm(u, v, seedA + 221, 16.0, 3) - 0.5) * 0.16;
          const bands = 0.5 + (0.5 * Math.sin(((v + warp) * tau * bandFreq) + (u * tau * 0.34)));
          const storms = Math.pow(sphericalRidgeFbm(u + 0.12, v, seedB + 991, 30.0, 3), 1.6);
          h = clamp((bands * 0.54) + (base * 0.26) + (detail * 0.14) + (storms * 0.06) + (contrast * 0.3), 0, 1);
        } else {
          const continents = sphericalFbm(u, v, seedA, 4.8, 5);
          const mountains = Math.pow(sphericalRidgeFbm(u, v, seedB, 14.5, 4), 1.2);
          const craterLike = sphericalRidgeFbm(u + 0.2, v + 0.17, seedB + 440, 28.0, 3);
          h = clamp((continents * 0.5) + (mountains * 0.35) + (craterLike * 0.15) + (contrast * 0.28), 0, 1);
        }

        let c = mixTriColor(low, mid, high, h);
        if (body.id === "earth") {
          const moisture = sphericalFbm(u + 0.13, v + 0.08, seedB + 420, 7.5, 4);
          const polar = clamp((Math.abs(lat) - 0.58) / 0.42, 0, 1);
          if (h < 0.52) {
            const waterT = clamp((h - 0.18) / 0.34, 0, 1);
            c = mixTriColor(earthWaterLow, earthWaterMid, earthWaterHigh, waterT);
          } else {
            const landT = clamp((h - 0.5) / 0.5, 0, 1);
            c = mixTriColor(earthLandLow, earthLandMid, earthLandHigh, clamp((landT * 0.9) + (moisture * 0.1), 0, 1));
            c = blendRgb(c, { r: 244, g: 247, b: 250 }, Math.pow(polar, 1.8) * 0.92);
          }
        } else if (body.id === "venus") {
          const haze = 0.62 + (0.38 * sphericalFbm(u, v, seedA + 912, 10.0, 4));
          c = blendRgb(c, { r: 236, g: 206, b: 166 }, haze * 0.28);
        } else if (body.id === "mars") {
          const darkBasalt = Math.pow(sphericalRidgeFbm(u, v, seedB + 507, 21.0, 3), 1.7);
          c = blendRgb(c, { r: 78, g: 49, b: 38 }, darkBasalt * 0.2);
        } else if (profile.type === "star") {
          const flare = Math.pow(swirl, 1.8) * 0.36;
          c = blendRgb(c, { r: 255, g: 244, b: 215 }, flare);
        }
        c = tunePlanetColor(body.id, c, h, u, v, lat, seedA, seedB);

        const relief = clamp((h - 0.5) * ((profile.type === "gas" ? 0.35 : 0.55) + (terrain * 0.34)), -0.6, 0.6);
        const brightness = profile.type === "star" ? 1.03 + (relief * 0.22) : 0.93 + (relief * 0.24);
        colorData[idx] = toByte(c.r * brightness);
        colorData[idx + 1] = toByte(c.g * brightness);
        colorData[idx + 2] = toByte(c.b * brightness);
        colorData[idx + 3] = 255;

        let bumpValue = h;
        if (profile.type === "gas") {
          bumpValue = clamp((h * 0.4) + (detail * 0.35), 0, 1);
        } else if (profile.type === "star") {
          bumpValue = clamp((h * 0.32) + (detail * 0.16), 0, 1);
        } else if (body.id === "earth" && h < 0.52) {
          bumpValue *= 0.35;
        }
        const bumpByte = toByte(bumpValue * 255);
        bumpData[idx] = bumpByte;
        bumpData[idx + 1] = bumpByte;
        bumpData[idx + 2] = bumpByte;
        bumpData[idx + 3] = 255;
      }
    }

    colorCtx.putImageData(colorImage, 0, 0);
    bumpCtx.putImageData(bumpImage, 0, 0);

    const map = new THREE_NS.CanvasTexture(colorCanvas);
    map.colorSpace = THREE_NS.SRGBColorSpace;
    map.anisotropy = maxTextureAnisotropy();
    map.wrapS = THREE_NS.RepeatWrapping;
    map.wrapT = THREE_NS.ClampToEdgeWrapping;

    const bump = new THREE_NS.CanvasTexture(bumpCanvas);
    if (THREE_NS.NoColorSpace) {
      bump.colorSpace = THREE_NS.NoColorSpace;
    }
    bump.anisotropy = maxTextureAnisotropy();
    bump.wrapS = THREE_NS.RepeatWrapping;
    bump.wrapT = THREE_NS.ClampToEdgeWrapping;

    const response = {
      map,
      bump,
      normal: null,
      specular: null,
      emissive: null,
      clouds: null,
      ringColor: null,
      ringAlpha: null,
      bumpScale: plan.bumpScale ?? defaultPlanetBumpScale(body.id, profile.type),
      proceduralPlanet: true,
    };
    if (body.id === "earth" || body.id === "venus") {
      response.clouds = createProceduralCloudTexture(body.id, seedA ^ seedB);
    }
    return response;
  });

  textureCache.set(key, promise);
  return promise;
}

function ringTextureProfile(bodyId) {
  switch (bodyId) {
    case "saturn":
      return {
        low: "#8d7d5d",
        mid: "#c8b28a",
        high: "#e5d8ba",
        stripeFrequency: 140,
        alphaBase: 0.46,
        alphaRange: 0.42,
        alphaSpoke: 0.18,
        brightnessBase: 0.88,
        brightnessRange: 0.18,
        cassiniGaps: true,
        tintA: { r: 236, g: 228, b: 208 },
        tintAmount: 0.12,
        tintFineAmount: 0.1,
        saturation: 0.95,
      };
    case "uranus":
      return {
        low: "#8fa9b8",
        mid: "#b6d0dc",
        high: "#dceef4",
        stripeFrequency: 96,
        alphaBase: 0.28,
        alphaRange: 0.26,
        alphaSpoke: 0.13,
        brightnessBase: 0.9,
        brightnessRange: 0.16,
        cassiniGaps: false,
        tintA: { r: 188, g: 216, b: 224 },
        tintAmount: 0.09,
        tintFineAmount: 0.08,
        saturation: 1.06,
      };
    case "jupiter":
      return {
        low: "#8b7b66",
        mid: "#b8a78d",
        high: "#d5c7b2",
        stripeFrequency: 112,
        alphaBase: 0.12,
        alphaRange: 0.2,
        alphaSpoke: 0.1,
        brightnessBase: 0.78,
        brightnessRange: 0.12,
        cassiniGaps: false,
        tintA: { r: 171, g: 151, b: 124 },
        tintAmount: 0.07,
        tintFineAmount: 0.06,
        saturation: 0.92,
      };
    case "neptune":
      return {
        low: "#6f7f94",
        mid: "#97abc2",
        high: "#c1d2e4",
        stripeFrequency: 128,
        alphaBase: 0.16,
        alphaRange: 0.2,
        alphaSpoke: 0.12,
        brightnessBase: 0.8,
        brightnessRange: 0.13,
        cassiniGaps: false,
        tintA: { r: 144, g: 168, b: 204 },
        tintAmount: 0.08,
        tintFineAmount: 0.07,
        saturation: 1.0,
      };
    default:
      return {
        low: "#96b8c2",
        mid: "#b7d0d8",
        high: "#d6e5ea",
        stripeFrequency: 98,
        alphaBase: 0.3,
        alphaRange: 0.28,
        alphaSpoke: 0.12,
        brightnessBase: 0.88,
        brightnessRange: 0.16,
        cassiniGaps: false,
        tintA: { r: 188, g: 216, b: 224 },
        tintAmount: 0.09,
        tintFineAmount: 0.08,
        saturation: 1.06,
      };
  }
}

function createProceduralRingTextures(body) {
  const key = `ring-proc:${body.id}`;
  if (textureCache.has(key)) {
    return textureCache.get(key);
  }

  const promise = Promise.resolve().then(() => {
    const width = 4096;
    const height = 48;
    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = width;
    colorCanvas.height = height;
    const alphaCanvas = document.createElement("canvas");
    alphaCanvas.width = width;
    alphaCanvas.height = height;
    const colorCtx = colorCanvas.getContext("2d");
    const alphaCtx = alphaCanvas.getContext("2d");
    const colorImage = colorCtx.createImageData(width, height);
    const alphaImage = alphaCtx.createImageData(width, height);
    const colorData = colorImage.data;
    const alphaData = alphaImage.data;

    const seed = hashStringToSeed(`${body.id}:ring`);
    const profile = ringTextureProfile(body.id);
    const low = hexToRgb(profile.low);
    const mid = hexToRgb(profile.mid);
    const high = hexToRgb(profile.high);

    for (let x = 0; x < width; x += 1) {
      const r = x / (width - 1);
      const coarse = fbm(r * 150, seed * 0.0007, seed, 4);
      const fine = ridgeFbm(r * 520, seed * 0.0019, seed + 211, 3);
      const spoke = ridgeFbm(r * 920, seed * 0.0031, seed + 811, 2);
      const stripe = 0.5 + (0.5 * Math.sin((r * Math.PI * profile.stripeFrequency) + (coarse * 2.1)));
      const mix = clamp((stripe * 0.52) + (coarse * 0.27) + (fine * 0.14) + (spoke * 0.07), 0, 1);
      let c = mixTriColor(low, mid, high, mix);
      c = blendRgb(c, profile.tintA, profile.tintAmount + (fine * profile.tintFineAmount));
      c = saturateRgb(c, profile.saturation);

      const innerFade = smoothstep(clamp((r - 0.02) / 0.16, 0, 1));
      const outerFade = smoothstep(clamp((1 - r - 0.01) / 0.2, 0, 1));
      let alpha = innerFade * outerFade * (profile.alphaBase + (mix * profile.alphaRange));
      if (profile.cassiniGaps) {
        const cassini = Math.exp(-Math.pow((r - 0.58) * 115, 2));
        const encke = Math.exp(-Math.pow((r - 0.72) * 200, 2));
        const cGap = 1 - (cassini * 0.82) - (encke * 0.3);
        const radialDust = 0.82 + (0.18 * spoke);
        alpha *= cGap * radialDust;
      } else {
        alpha *= 0.62 + (spoke * profile.alphaSpoke);
      }
      alpha = clamp(alpha, 0, 1);

      for (let y = 0; y < height; y += 1) {
        const idx = (y * width + x) * 4;
        const brightnessScale = profile.brightnessBase + (fine * profile.brightnessRange);
        colorData[idx] = toByte(c.r * brightnessScale);
        colorData[idx + 1] = toByte(c.g * brightnessScale);
        colorData[idx + 2] = toByte(c.b * brightnessScale);
        colorData[idx + 3] = 255;

        const alphaByte = toByte(alpha * 255);
        alphaData[idx] = alphaByte;
        alphaData[idx + 1] = alphaByte;
        alphaData[idx + 2] = alphaByte;
        alphaData[idx + 3] = 255;
      }
    }

    colorCtx.putImageData(colorImage, 0, 0);
    alphaCtx.putImageData(alphaImage, 0, 0);

    const ringColor = new THREE_NS.CanvasTexture(colorCanvas);
    ringColor.colorSpace = THREE_NS.SRGBColorSpace;
    ringColor.anisotropy = maxTextureAnisotropy();

    const ringAlpha = new THREE_NS.CanvasTexture(alphaCanvas);
    if (THREE_NS.NoColorSpace) {
      ringAlpha.colorSpace = THREE_NS.NoColorSpace;
    }
    ringAlpha.anisotropy = maxTextureAnisotropy();

    return { ringColor, ringAlpha };
  });

  textureCache.set(key, promise);
  return promise;
}

function createProceduralCloudTexture(bodyId, seed) {
  const key = `cloud-proc:${bodyId}:${seed}`;
  if (textureCache.has(key)) {
    return textureCache.get(key);
  }

  const width = 1024;
  const height = 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(width, height);
  const data = image.data;
  const cloudColor = bodyId === "venus" ? hexToRgb("#d4bb95") : hexToRgb("#f2f6fb");
  const tau = Math.PI * 2;

  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = x / (width - 1);
      const idx = (y * width + x) * 4;
      const warp = (sphericalFbm(u, v, seed + 42, 12.0, 3) - 0.5) * 0.12;
      const base = sphericalFbm(u + warp, v, seed + 91, 11.0, 5);
      const wisps = sphericalRidgeFbm(u, v, seed + 313, 28.0, 4);
      const band = 0.5 + (0.5 * Math.sin((v * tau * 7.0) + (u * tau * 0.5)));
      let density =
        bodyId === "venus"
          ? (base * 0.62) + (wisps * 0.26) + (band * 0.12)
          : (base * 0.56) + (wisps * 0.36) + (band * 0.08);
      density = bodyId === "venus" ? clamp(density - 0.16, 0, 1) : clamp(density - 0.44, 0, 1);
      const alpha = bodyId === "venus" ? density * 0.95 : Math.pow(density, 1.28) * 0.95;

      data[idx] = cloudColor.r;
      data[idx + 1] = cloudColor.g;
      data[idx + 2] = cloudColor.b;
      data[idx + 3] = toByte(alpha * 255);
    }
  }

  ctx.putImageData(image, 0, 0);
  const clouds = new THREE_NS.CanvasTexture(canvas);
  clouds.colorSpace = THREE_NS.SRGBColorSpace;
  clouds.anisotropy = maxTextureAnisotropy();
  clouds.wrapS = THREE_NS.RepeatWrapping;
  clouds.wrapT = THREE_NS.ClampToEdgeWrapping;
  textureCache.set(key, clouds);
  return clouds;
}

function defaultPlanetBumpScale(bodyId, profileType) {
  if (bodyId === "earth") {
    return 0.035;
  }
  if (bodyId === "venus") {
    return 0.03;
  }
  if (bodyId === "mercury") {
    return 0.06;
  }
  if (bodyId === "mars") {
    return 0.055;
  }
  if (profileType === "gas" || profileType === "star") {
    return 0.018;
  }
  return 0.05;
}

function sphericalFbm(u, v, seed, scale, octaves) {
  const lon = u * Math.PI * 2;
  const lat = (v * 2) - 1;
  const nx = Math.cos(lon);
  const nz = Math.sin(lon);
  return fbm((nx * scale) + (lat * scale * 0.45), (nz * scale) - (lat * scale * 0.4), seed, octaves);
}

function sphericalRidgeFbm(u, v, seed, scale, octaves) {
  const lon = u * Math.PI * 2;
  const lat = (v * 2) - 1;
  const nx = Math.cos(lon);
  const nz = Math.sin(lon);
  return ridgeFbm((nx * scale) + (lat * scale * 0.42), (nz * scale) - (lat * scale * 0.38), seed, octaves);
}

function blendRgb(a, b, t) {
  return {
    r: lerp(a.r, b.r, clamp(t, 0, 1)),
    g: lerp(a.g, b.g, clamp(t, 0, 1)),
    b: lerp(a.b, b.b, clamp(t, 0, 1)),
  };
}

function saturateRgb(color, amount) {
  const gray = (color.r + color.g + color.b) / 3;
  return {
    r: clamp(lerp(gray, color.r, amount), 0, 255),
    g: clamp(lerp(gray, color.g, amount), 0, 255),
    b: clamp(lerp(gray, color.b, amount), 0, 255),
  };
}

function tuneMoonColor(profile, color, h, latitudeFade, ridgeNoise) {
  const contrast = profile?.contrast ?? 0.2;
  const terrain = profile?.terrainStrength ?? 0.58;
  const sat = clamp(0.94 + (contrast * 0.7) + (terrain * 0.12), 0.95, 1.22);
  let tuned = saturateRgb(color, sat);
  const craterDust = clamp(((1 - h) * 0.08) + (ridgeNoise * 0.05), 0, 0.16);
  tuned = blendRgb(tuned, { r: 228, g: 222, b: 212 }, craterDust);
  const poleIce = Math.pow(1 - latitudeFade, 1.65);
  tuned = blendRgb(tuned, { r: 236, g: 240, b: 246 }, poleIce * 0.06);
  return tuned;
}

function tunePlanetColor(bodyId, color, h, u, v, lat, seedA, seedB) {
  const base = { r: color.r, g: color.g, b: color.b };
  switch (bodyId) {
    case "mercury":
      return saturateRgb(blendRgb(base, { r: 150, g: 147, b: 142 }, 0.28), 0.82);
    case "venus":
      return saturateRgb(blendRgb(base, { r: 234, g: 203, b: 146 }, 0.34), 0.96);
    case "earth":
      return saturateRgb(base, 1.2);
    case "mars":
      return saturateRgb(blendRgb(base, { r: 194, g: 87, b: 59 }, 0.26), 1.24);
    case "jupiter": {
      const band = 0.5 + (0.5 * Math.sin((v * Math.PI * 2 * 13.0) + (u * Math.PI * 2 * 0.55) + (seedA * 0.000003)));
      return saturateRgb(blendRgb(base, { r: 203, g: 153, b: 112 }, 0.24 + (band * 0.08)), 1.08);
    }
    case "saturn": {
      const stripe = 0.5 + (0.5 * Math.sin((v * Math.PI * 2 * 9.0) + (u * Math.PI * 2 * 0.35) + (seedB * 0.000003)));
      return saturateRgb(blendRgb(base, { r: 220, g: 196, b: 136 }, 0.22 + (stripe * 0.06)), 0.94);
    }
    case "uranus":
      return saturateRgb(blendRgb(base, { r: 139, g: 223, b: 232 }, 0.4), 1.2);
    case "neptune":
      return saturateRgb(blendRgb(base, { r: 64, g: 112, b: 230 }, 0.36), 1.28);
    default:
      return base;
  }
}

function toByte(value) {
  return clamp(Math.round(value), 0, 255);
}

function maxTextureAnisotropy() {
  if (!renderer || !renderer.capabilities || !renderer.capabilities.getMaxAnisotropy) {
    return 1;
  }
  return Math.min(DETAIL_ANISOTROPY_CAP, renderer.capabilities.getMaxAnisotropy());
}

function eclipseOccluderIdsForBody(body) {
  if (!body || body.id === "sun") {
    return [];
  }
  if (body.body_type === "moon") {
    const parentId = body.parent || "";
    if (parentId && parentId !== "sun" && metaById.has(parentId)) {
      return [parentId];
    }
    return [];
  }
  if (body.body_type === "planet") {
    const occluders = [];
    for (const candidate of bodies) {
      if (candidate?.body_type === "moon" && candidate.parent === body.id) {
        occluders.push(candidate.id);
      }
    }
    return occluders;
  }
  return [];
}

function attachBodyEclipseShader(material, body) {
  if (!BODY_ECLIPSE_MODEL_ENABLED || !material || !THREE_NS || !body || body.id === "sun") {
    return;
  }
  const occluderIds = eclipseOccluderIdsForBody(body);
  if (occluderIds.length === 0) {
    return;
  }
  if (!material.userData) {
    material.userData = {};
  }
  if (material.userData.bodyEclipseShaderAttached) {
    return;
  }

  const state = {
    material,
    bodyId: body.id,
    occluderIds,
    uniforms: {
      uBodyEclipseEnabled: { value: 0.0 },
      uBodyEclipseSunWorld: { value: new THREE_NS.Vector3(0, 0, 0) },
      uBodyEclipseSunRadius: { value: 0.0 },
      uBodyEclipseOccluderCount: { value: 0 },
      uBodyEclipseOccluders: {
        value: Array.from({ length: BODY_ECLIPSE_MAX_OCCLUDERS }, () => new THREE_NS.Vector4(0, 0, 0, 0)),
      },
      uBodyEclipsePenumbraGamma: { value: BODY_ECLIPSE_PENUMBRA_GAMMA },
      uBodyEclipseMinTransmittance: { value: BODY_ECLIPSE_MIN_TRANSMITTANCE },
    },
  };
  bodyEclipseMaterialStates.add(state);
  material.userData.bodyEclipseShaderAttached = true;
  material.userData.bodyEclipseShaderState = state;

  const priorOnBeforeCompile = material.onBeforeCompile;
  const priorCacheKey = typeof material.customProgramCacheKey === "function"
    ? material.customProgramCacheKey.bind(material)
    : null;
  material.customProgramCacheKey = () => {
    const base = priorCacheKey ? priorCacheKey() : "default";
    return `${base}|body-eclipse-v2:${BODY_ECLIPSE_MAX_OCCLUDERS}`;
  };
  material.onBeforeCompile = (shader) => {
    if (typeof priorOnBeforeCompile === "function") {
      priorOnBeforeCompile(shader);
    }
    Object.assign(shader.uniforms, state.uniforms);

    if (!shader.vertexShader.includes("vBodyEclipseWorldPos")) {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec3 vBodyEclipseWorldPos;`,
        )
        .replace(
          "#include <worldpos_vertex>",
          `#include <worldpos_vertex>
vBodyEclipseWorldPos = worldPosition.xyz;`,
        );
    }

    if (!shader.fragmentShader.includes("bodyEclipseTransmittanceAtPoint")) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
#define BODY_ECLIPSE_MAX_OCCLUDERS ${BODY_ECLIPSE_MAX_OCCLUDERS}
varying vec3 vBodyEclipseWorldPos;
uniform float uBodyEclipseEnabled;
uniform vec3 uBodyEclipseSunWorld;
uniform float uBodyEclipseSunRadius;
uniform int uBodyEclipseOccluderCount;
uniform vec4 uBodyEclipseOccluders[BODY_ECLIPSE_MAX_OCCLUDERS];
uniform float uBodyEclipsePenumbraGamma;
uniform float uBodyEclipseMinTransmittance;

float bodyEclipseDiskOverlapArea(float r1, float r2, float d) {
  if (r1 <= 0.0 || r2 <= 0.0) {
    return 0.0;
  }
  if (d >= r1 + r2) {
    return 0.0;
  }
  if (d <= abs(r1 - r2)) {
    float rMin = min(r1, r2);
    return 3.141592653589793 * rMin * rMin;
  }
  float r1Sq = r1 * r1;
  float r2Sq = r2 * r2;
  float dSq = d * d;
  float alpha = acos(clamp((dSq + r1Sq - r2Sq) / max(2.0 * d * r1, 1e-12), -1.0, 1.0));
  float beta = acos(clamp((dSq + r2Sq - r1Sq) / max(2.0 * d * r2, 1e-12), -1.0, 1.0));
  float term = max((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2), 0.0);
  float lens = 0.5 * sqrt(term);
  return (r1Sq * alpha) + (r2Sq * beta) - lens;
}

float bodyEclipseVisibleSunFraction(float sunRadius, float occluderRadius, float angularSeparation) {
  if (sunRadius <= 0.0 || occluderRadius <= 0.0) {
    return 1.0;
  }
  float overlap = bodyEclipseDiskOverlapArea(sunRadius, occluderRadius, max(angularSeparation, 0.0));
  float sunArea = 3.141592653589793 * sunRadius * sunRadius;
  if (sunArea <= 0.0) {
    return 1.0;
  }
  return clamp(1.0 - (overlap / sunArea), 0.0, 1.0);
}

float bodyEclipseTransmittanceAtPoint(vec3 worldPos) {
  if (uBodyEclipseEnabled < 0.5) {
    return 1.0;
  }
  vec3 toSun = uBodyEclipseSunWorld - worldPos;
  float sunDistance = length(toSun);
  if (sunDistance <= 1e-8 || uBodyEclipseOccluderCount <= 0) {
    return 1.0;
  }
  float sunAngularRadius = asin(clamp(uBodyEclipseSunRadius / sunDistance, -1.0, 1.0));
  if (sunAngularRadius <= 0.0) {
    return 1.0;
  }
  vec3 sunDir = toSun / sunDistance;
  float transmittance = 1.0;
  for (int i = 0; i < BODY_ECLIPSE_MAX_OCCLUDERS; i += 1) {
    if (i >= uBodyEclipseOccluderCount) {
      break;
    }
    vec4 occluder = uBodyEclipseOccluders[i];
    float occluderRadius = occluder.w;
    if (occluderRadius <= 0.0) {
      continue;
    }
    vec3 toOccluder = occluder.xyz - worldPos;
    float occluderDistance = length(toOccluder);
    if (occluderDistance <= 1e-8 || occluderDistance >= sunDistance) {
      continue;
    }
    float occluderAngularRadius = asin(clamp(occluderRadius / occluderDistance, -1.0, 1.0));
    if (occluderAngularRadius <= 0.0) {
      continue;
    }
    vec3 occluderDir = toOccluder / occluderDistance;
    float angularSeparation = acos(clamp(dot(sunDir, occluderDir), -1.0, 1.0));
    float localTransmittance = bodyEclipseVisibleSunFraction(
      sunAngularRadius,
      occluderAngularRadius,
      angularSeparation
    );
    transmittance = min(transmittance, localTransmittance);
    if (transmittance <= 1e-6) {
      break;
    }
  }
  transmittance = pow(clamp(transmittance, 0.0, 1.0), max(uBodyEclipsePenumbraGamma, 1e-4));
  return max(uBodyEclipseMinTransmittance, transmittance);
}`,
        )
        .replace(
          "#include <lights_fragment_begin>",
          `#include <lights_fragment_begin>
float bodyEclipseTransmittance = bodyEclipseTransmittanceAtPoint(vBodyEclipseWorldPos);
reflectedLight.directDiffuse *= bodyEclipseTransmittance;
reflectedLight.directSpecular *= bodyEclipseTransmittance;`,
        );
    }
  };
  material.needsUpdate = true;
}

function updateBodyEclipseUniforms() {
  if (!BODY_ECLIPSE_MODEL_ENABLED || bodyEclipseMaterialStates.size === 0) {
    return;
  }
  const sunVisual = bodyVisuals.get("sun");
  if (!sunVisual || !sunVisual.root.visible || !(sunVisual.renderRadius > 0)) {
    for (const state of bodyEclipseMaterialStates) {
      state.uniforms.uBodyEclipseEnabled.value = 0.0;
      state.uniforms.uBodyEclipseOccluderCount.value = 0;
    }
    return;
  }

  for (const state of bodyEclipseMaterialStates) {
    if (!state?.uniforms) {
      continue;
    }
    const targetVisual = bodyVisuals.get(state.bodyId);
    const uniforms = state.uniforms;
    uniforms.uBodyEclipsePenumbraGamma.value = BODY_ECLIPSE_PENUMBRA_GAMMA;
    uniforms.uBodyEclipseMinTransmittance.value = BODY_ECLIPSE_MIN_TRANSMITTANCE;

    if (!targetVisual || !targetVisual.root.visible || !(targetVisual.renderRadius > 0)) {
      uniforms.uBodyEclipseEnabled.value = 0.0;
      uniforms.uBodyEclipseOccluderCount.value = 0;
      continue;
    }

    uniforms.uBodyEclipseSunWorld.value.copy(sunVisual.root.position);
    uniforms.uBodyEclipseSunRadius.value = sunVisual.renderRadius;
    const targetPos = targetVisual.root.position;
    const sunDistance = targetPos.distanceTo(sunVisual.root.position);
    if (!(sunDistance > 1e-8)) {
      uniforms.uBodyEclipseEnabled.value = 0.0;
      uniforms.uBodyEclipseOccluderCount.value = 0;
      continue;
    }

    const candidates = [];
    for (const occluderId of state.occluderIds) {
      const occluderVisual = bodyVisuals.get(occluderId);
      if (!occluderVisual || !occluderVisual.root.visible || !(occluderVisual.renderRadius > 0)) {
        continue;
      }
      const occluderDistance = targetPos.distanceTo(occluderVisual.root.position);
      if (!(occluderDistance > 1e-8) || !(occluderDistance < sunDistance)) {
        continue;
      }
      const angularRadius = Math.asin(clamp(occluderVisual.renderRadius / occluderDistance, -1, 1));
      if (!(angularRadius > 0)) {
        continue;
      }
      candidates.push({ visual: occluderVisual, angularRadius, occluderDistance });
    }
    candidates.sort((a, b) => (b.angularRadius - a.angularRadius) || (a.occluderDistance - b.occluderDistance));

    const occluderCount = Math.min(candidates.length, BODY_ECLIPSE_MAX_OCCLUDERS);
    uniforms.uBodyEclipseOccluderCount.value = occluderCount;
    uniforms.uBodyEclipseEnabled.value = occluderCount > 0 ? 1.0 : 0.0;

    const occluderUniforms = uniforms.uBodyEclipseOccluders.value;
    for (let i = 0; i < BODY_ECLIPSE_MAX_OCCLUDERS; i += 1) {
      if (i < occluderCount) {
        const visual = candidates[i].visual;
        occluderUniforms[i].set(
          visual.root.position.x,
          visual.root.position.y,
          visual.root.position.z,
          visual.renderRadius,
        );
      } else {
        occluderUniforms[i].set(0, 0, 0, 0);
      }
    }
  }
}

function createPlanetMaterial(body, plan, textures, renderRadius) {
  const profile = PLANET_SURFACE_PROFILES[body.id] || PLANET_SURFACE_PROFILES.default;
  const baseBump = textures.bumpScale ?? plan.bumpScale ?? defaultPlanetBumpScale(body.id, profile.type);

  if (plan.isSun) {
    return new THREE_NS.MeshBasicMaterial({
      map: textures.map || null,
      color: textures.map ? 0xffffff : new THREE_NS.Color(body.color || "#eeb04a"),
      toneMapped: false,
    });
  }

  if (body.body_type === "spacecraft") {
    const material = new THREE_NS.MeshStandardMaterial({
      color: new THREE_NS.Color(0xd2d9e6),
      roughness: 0.46,
      metalness: 0.62,
      emissive: new THREE_NS.Color(0x1c2431),
      emissiveIntensity: 0.18,
    });
    attachBodyEclipseShader(material, body);
    return material;
  }

  if (body.id === "earth") {
    const hasCityLights = Boolean(textures.emissive);
    const earthShadowLift = hasCityLights ? 0.14 : textures.map ? 0.02 : 0.0;
    const material = new THREE_NS.MeshPhongMaterial({
      map: textures.map || null,
      bumpMap: textures.bump || null,
      bumpScale: baseBump,
      normalMap: textures.normal || null,
      normalScale: new THREE_NS.Vector2(0.42, 0.42),
      specularMap: textures.specular || null,
      specular: new THREE_NS.Color(0x3f4f63),
      emissiveMap: textures.emissive || null,
      emissive: hasCityLights ? new THREE_NS.Color(0x2b2418) : new THREE_NS.Color(0x0f141c),
      emissiveIntensity: earthShadowLift,
      shininess: 24,
      color: textures.map ? 0xffffff : new THREE_NS.Color(body.color || "#6a8fd8"),
    });
    if (ENABLE_SURFACE_DISPLACEMENT && textures.bump) {
      material.displacementMap = textures.bump;
      material.displacementScale = renderRadius * 0.02;
    }
    attachBodyEclipseShader(material, body);
    return material;
  }

  const material = new THREE_NS.MeshStandardMaterial({
    map: textures.map || null,
    color: textures.map ? 0xffffff : new THREE_NS.Color(body.color || "#9f9f9f"),
    roughness: 0.9,
    metalness: 0.0,
  });

  if (textures.bump) {
    material.bumpMap = textures.bump;
    material.bumpScale = baseBump;
  }
  if (textures.normal) {
    material.normalMap = textures.normal;
    material.normalScale = new THREE_NS.Vector2(0.3, 0.3);
  }
  if (textures.specular) {
    material.roughnessMap = textures.specular;
    material.roughness = 0.9;
  }
  if (textures.emissive) {
    material.emissiveMap = textures.emissive;
    material.emissive = new THREE_NS.Color(0x162033);
    material.emissiveIntensity = 0.28;
  }

  if (body.id === "jupiter" || body.id === "saturn" || body.id === "uranus" || body.id === "neptune") {
    material.roughness = 0.82;
    material.metalness = 0.0;
  }
  if (body.id === "moon") {
    material.roughness = 0.98;
  }
  if (ENABLE_SURFACE_DISPLACEMENT && (body.id === "mercury" || body.id === "moon" || body.id === "mars")) {
    material.displacementMap = textures.bump || null;
    material.displacementScale = textures.bump ? renderRadius * 0.03 : 0.0;
  }
  if (ENABLE_SURFACE_DISPLACEMENT && body.body_type === "moon" && body.id !== "moon") {
    material.displacementMap = textures.bump || null;
    material.displacementScale = textures.bump ? renderRadius * 0.035 : 0.0;
    material.roughness = 0.94;
    material.metalness = 0.0;
  }
  if (ENABLE_SURFACE_DISPLACEMENT && body.id === "venus") {
    material.displacementMap = textures.bump || null;
    material.displacementScale = textures.bump ? renderRadius * 0.015 : 0.0;
  }
  if (body.body_type === "moon") {
    material.emissiveMap = null;
    material.emissive = new THREE_NS.Color(0x000000);
    material.emissiveIntensity = 0.0;
    material.roughness = 0.95;
    material.metalness = 0.0;
  }

  attachBodyEclipseShader(material, body);
  return material;
}

function createPlanetLOD(body, radius, material) {
  const lod = new THREE_NS.LOD();
  const seg = lodSegments(body, radius);
  const distances = lodDistances(radius);

  const high = new THREE_NS.Mesh(new THREE_NS.SphereGeometry(radius, seg.high, seg.high), material);
  const medium = new THREE_NS.Mesh(new THREE_NS.SphereGeometry(radius, seg.medium, seg.medium), material);
  const low = new THREE_NS.Mesh(new THREE_NS.SphereGeometry(radius, seg.low, seg.low), material);
  const canCastShadow = body.body_type === "moon";
  const canReceiveShadow = body.id !== "sun";
  high.userData.bodyId = body.id;
  medium.userData.bodyId = body.id;
  low.userData.bodyId = body.id;
  high.castShadow = canCastShadow;
  medium.castShadow = canCastShadow;
  low.castShadow = canCastShadow;
  high.receiveShadow = canReceiveShadow;
  medium.receiveShadow = canReceiveShadow;
  low.receiveShadow = canReceiveShadow;

  lod.addLevel(high, 0);
  lod.addLevel(medium, distances.medium);
  lod.addLevel(low, distances.low);
  lod.autoUpdate = false;

  return lod;
}

function lodSegments(body, radius) {
  if (body.id === "sun") {
    return { high: 128, medium: 80, low: 40 };
  }
  if (body.id === "earth" || body.id === "moon" || body.id === "mars" || body.id === "mercury" || body.id === "venus") {
    return { high: 240, medium: 156, low: 64 };
  }
  if (body.body_type === "planet" && body.radius_km > 20000) {
    return { high: 128, medium: 84, low: 36 };
  }
  if (body.body_type === "planet") {
    return { high: 96, medium: 64, low: 30 };
  }
  if (radius > 3) {
    return { high: 72, medium: 48, low: 22 };
  }
  return { high: 52, medium: 34, low: 16 };
}

function lodDistances(radius) {
  return {
    medium: radius * 72 + 48,
    low: radius * 240 + 190,
  };
}

function ringGeometryProfile(bodyId) {
  switch (bodyId) {
    case "saturn":
      return { innerScale: 1.42, outerScale: 2.65, opacity: 0.98, roughness: 0.82, alphaTest: 0.035 };
    case "uranus":
      return { innerScale: 1.5, outerScale: 2.14, opacity: 0.56, roughness: 0.88, alphaTest: 0.045 };
    case "jupiter":
      return { innerScale: 1.35, outerScale: 2.45, opacity: 0.22, roughness: 0.9, alphaTest: 0.05 };
    case "neptune":
      return { innerScale: 1.52, outerScale: 2.72, opacity: 0.28, roughness: 0.9, alphaTest: 0.05 };
    default:
      return { innerScale: 1.22, outerScale: 1.95, opacity: 0.84, roughness: 0.88, alphaTest: 0.04 };
  }
}

function createRingMesh(body, radius, ringColorTex, ringAlphaTex) {
  const profile = ringGeometryProfile(body.id);
  const inner = radius * profile.innerScale;
  const outer = radius * profile.outerScale;
  const geometry = new THREE_NS.RingGeometry(inner, outer, 220, 1);
  const material = new THREE_NS.MeshStandardMaterial({
    map: ringColorTex,
    alphaMap: ringAlphaTex || ringColorTex,
    color: 0xffffff,
    transparent: true,
    opacity: profile.opacity,
    side: THREE_NS.DoubleSide,
    roughness: profile.roughness,
    metalness: 0.0,
    depthWrite: false,
  });
  material.alphaTest = profile.alphaTest;

  const ring = new THREE_NS.Mesh(geometry, material);
  ring.rotation.x = Math.PI * 0.5;
  return ring;
}

function createAtmosphereMesh(radius, colorHex) {
  const geometry = new THREE_NS.SphereGeometry(radius * 1.06, 56, 56);
  const material = new THREE_NS.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE_NS.Color(colorHex) },
      coefficient: { value: 0.76 },
      power: { value: 2.3 },
    },
    vertexShader: atmosphereVertexShader,
    fragmentShader: atmosphereFragmentShader,
    side: THREE_NS.BackSide,
    transparent: true,
    blending: THREE_NS.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE_NS.Mesh(geometry, material);
}

function createEarthLocationMarker(renderRadius, markerConfig) {
  if (!(renderRadius > 0) || !markerConfig) {
    return null;
  }

  const position = latLonToEarthVector(
    markerConfig.latitudeDeg,
    markerConfig.longitudeDeg,
    renderRadius * EARTH_LOCATION_MARKER_HEIGHT_RATIO,
  );
  const dotRadius = Math.max(renderRadius * EARTH_LOCATION_MARKER_DOT_RADIUS_RATIO, 0.0002);
  const glowSize = Math.max(renderRadius * EARTH_LOCATION_MARKER_GLOW_SIZE_RATIO, dotRadius * 3.2);

  const markerGroup = new THREE_NS.Object3D();

  const dot = new THREE_NS.Mesh(
    new THREE_NS.SphereGeometry(dotRadius, 20, 20),
    new THREE_NS.MeshBasicMaterial({
      color: markerConfig.dotColor,
      transparent: true,
      opacity: EARTH_LOCATION_MARKER_DOT_OPACITY_MAX,
      toneMapped: false,
    }),
  );
  dot.position.copy(position);
  dot.renderOrder = 80;
  markerGroup.add(dot);

  const glowTexture = getCircularGlowTexture();
  const glow = new THREE_NS.Sprite(
    new THREE_NS.SpriteMaterial({
      map: glowTexture,
      color: markerConfig.glowColor,
      transparent: true,
      opacity: EARTH_LOCATION_MARKER_GLOW_OPACITY_MAX,
      blending: THREE_NS.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  glow.position.copy(position).multiplyScalar(1.0015);
  glow.scale.set(glowSize, glowSize, 1);
  glow.renderOrder = 79;
  markerGroup.add(glow);
  markerGroup.userData.dot = dot;
  markerGroup.userData.glow = glow;
  markerGroup.userData.baseGlowSize = glowSize;

  return markerGroup;
}

function createSpacecraftWorldMarker(bodyId = "") {
  if (!THREE_NS || !SPACECRAFT_WORLD_MARKER_ENABLED) {
    return null;
  }
  const config = spacecraftWorldMarkerConfig(bodyId);
  const markerGroup = new THREE_NS.Object3D();
  markerGroup.visible = true;
  markerGroup.renderOrder = 92;

  const dot = new THREE_NS.Mesh(
    new THREE_NS.SphereGeometry(1, 8, 8),
    new THREE_NS.MeshBasicMaterial({
      color: config.dotColor,
      transparent: true,
      opacity: SPACECRAFT_WORLD_MARKER_DOT_OPACITY_MAX,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  dot.scale.set(0.1, 0.1, 0.1);
  dot.renderOrder = 93;
  markerGroup.add(dot);

  const glowTexture = getCircularGlowTexture();
  const glow = new THREE_NS.Sprite(
    new THREE_NS.SpriteMaterial({
      map: glowTexture,
      color: config.glowColor,
      transparent: true,
      opacity: SPACECRAFT_WORLD_MARKER_GLOW_OPACITY_MAX,
      blending: THREE_NS.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    }),
  );
  glow.scale.set(0.55, 0.55, 1);
  glow.renderOrder = 92;
  markerGroup.add(glow);

  markerGroup.userData.dot = dot;
  markerGroup.userData.glow = glow;
  markerGroup.userData.phaseOffsetSec = Math.random() * SPACECRAFT_WORLD_MARKER_PULSE_PERIOD_SECONDS;
  markerGroup.userData.baseScale = 1;
  markerGroup.userData.bodyId = String(bodyId || "");
  return markerGroup;
}

function createGravityVectorHelper(renderRadius) {
  if (!GRAVITY_VECTORS_ENABLED || !THREE_NS) {
    return null;
  }
  const baseLength = Math.max(renderRadius * 1.2, GRAVITY_VECTOR_MIN_LENGTH);
  const headLength = clamp(baseLength * 0.3, 0.008, 0.24);
  const headWidth = clamp(baseLength * 0.16, 0.004, 0.12);
  const arrow = new THREE_NS.ArrowHelper(
    new THREE_NS.Vector3(1, 0, 0),
    new THREE_NS.Vector3(0, 0, 0),
    baseLength,
    GRAVITY_VECTOR_COLOR,
    headLength,
    headWidth,
  );
  arrow.visible = false;
  arrow.renderOrder = 75;
  arrow.userData.isGravityVector = true;
  return arrow;
}

function rebuildPhysicsOverlays() {
  tidalOverlayController?.rebuild();
  lagrangeOverlayController?.rebuild();
  earthAtmosphereController?.rebuild();
  syncPhysicsOverlayControllerStates();
  updatePhysicsOverlays();
}

function clearTidalOverlayVisuals() {
  tidalOverlayController?.clear();
}

function clearLagrangeOverlayVisuals() {
  lagrangeOverlayController?.clear();
}

function clearEarthAtmosphereVisuals() {
  earthAtmosphereController?.clear();
}

function updatePhysicsOverlays() {
  tidalOverlayController?.update();
  lagrangeOverlayController?.update();
  earthAtmosphereController?.update();
}

function getCircularGlowTexture() {
  const cacheKey = "earth-location-glow-texture";
  const cached = textureCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const size = 256;
  const canvasEl = document.createElement("canvas");
  canvasEl.width = size;
  canvasEl.height = size;
  const ctx = canvasEl.getContext("2d");

  const gradient = ctx.createRadialGradient(size * 0.5, size * 0.5, 0, size * 0.5, size * 0.5, size * 0.5);
  gradient.addColorStop(0.0, "rgba(175, 255, 196, 0.98)");
  gradient.addColorStop(0.22, "rgba(120, 255, 155, 0.88)");
  gradient.addColorStop(0.55, "rgba(66, 255, 116, 0.32)");
  gradient.addColorStop(1.0, "rgba(66, 255, 116, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE_NS.CanvasTexture(canvasEl);
  texture.colorSpace = THREE_NS.SRGBColorSpace;
  texture.anisotropy = maxTextureAnisotropy();
  texture.wrapS = THREE_NS.ClampToEdgeWrapping;
  texture.wrapT = THREE_NS.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  textureCache.set(cacheKey, texture);
  return texture;
}

function disposeBodyVisual(visual) {
  scene.remove(visual.root);
  visual.root.traverse((node) => {
    if (!node.isMesh && !node.isSprite && !node.isLine) {
      return;
    }
    if (node.geometry) {
      node.geometry.dispose();
    }
    if (Array.isArray(node.material)) {
      node.material.forEach((m) => {
        const eclipseState = m?.userData?.bodyEclipseShaderState;
        if (eclipseState) {
          bodyEclipseMaterialStates.delete(eclipseState);
        }
        m.dispose();
      });
    } else if (node.material) {
      const eclipseState = node.material?.userData?.bodyEclipseShaderState;
      if (eclipseState) {
        bodyEclipseMaterialStates.delete(eclipseState);
      }
      node.material.dispose();
    }
  });
}

function disposeOrbitVisual(orbitVisual) {
  scene.remove(orbitVisual.group);
  if (orbitVisual.orbitLine.geometry) {
    orbitVisual.orbitLine.geometry.dispose();
  }
  if (orbitVisual.orbitLine.material) {
    orbitVisual.orbitLine.material.dispose();
  }
  if (orbitVisual.marker?.geometry) {
    orbitVisual.marker.geometry.dispose();
  }
  if (orbitVisual.marker?.material) {
    orbitVisual.marker.material.dispose();
  }
}

function updatePositions(payload, source = "runtime") {
  if (HORIZONS_STARTUP_FETCH_ONLY && startupSeedLocked && source !== "startup_seed") {
    return;
  }
  const entries = payload.bodies || [];
  const entriesById = new Map(entries.map((body) => [body.id, body]));
  latestSolarTimestampMs = parseTimestampMs(payload.timestamp_utc);
  if (launchFeatureEnabled) {
    launchController?.injectStartupEntry(
      entriesById,
      Number.isFinite(latestSolarTimestampMs) ? latestSolarTimestampMs : Date.now(),
    );
  }
  positionsById = entriesById;
  if (!nBodyStartupSnapshotLoaded) {
    gravityArrowFocusBodyId = null;
    gravityArrowsLegendActivated = false;
  }
  nBodyStartupSnapshotLoaded = true;
  initializeNBodyFromSnapshot(Date.now());
  updateLegendFallbackIndicators();
  updateLegendGravityArrowIndicators();
  syncOrbitalStateFromSnapshot();
  runtimeCoordsKmById = computeRuntimeCoordinatesKm(Date.now());
  applyScenePositions(runtimeCoordsKmById);
  updateGravityVectors();
  updatePhysicsOverlays();
  updateSunlightModel();
  updateOrbitVisualAnchorsAndPhase();
  if (launchFeatureEnabled) {
    updateLaunchControls();
    updateLaunchStatusPanel(true);
    warmSelectedMissionLaunchSolve();
  }
  if (source === "startup_seed") {
    startupSeedLocked = true;
  }
}

function parseVectorFromPayload(entry, fieldName) {
  const value = entry?.[fieldName];
  const x = Number(value?.x);
  const y = Number(value?.y);
  const z = Number(value?.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  return { x, y, z };
}

function neutralizeTotalMomentum(dynamicBodies, anchorId = "sun") {
  const anchor = dynamicBodies.get(anchorId);
  if (!anchor || !(anchor.massKg > 0)) {
    return;
  }

  let px = 0;
  let py = 0;
  let pz = 0;
  for (const body of dynamicBodies.values()) {
    px += body.massKg * body.velocity.x;
    py += body.massKg * body.velocity.y;
    pz += body.massKg * body.velocity.z;
  }

  anchor.velocity.x -= px / anchor.massKg;
  anchor.velocity.y -= py / anchor.massKg;
  anchor.velocity.z -= pz / anchor.massKg;
}

function initializeNBodyFromSnapshot(nowMs) {
  if (!N_BODY_ALL_BODIES_MODE) {
    nBodyState = null;
    return;
  }

  const dynamicBodies = new Map();
  const staticSources = new Map();
  for (const body of bodies) {
    const bodyId = body.id;
    if (N_BODY_EXCLUDED_IDS.has(bodyId)) {
      continue;
    }
    const entry = positionsById.get(bodyId);
    const position = parseVectorFromPayload(entry, "coordinates_km");
    const massKg = bodyMassKgById(bodyId);
    if (!position || !(massKg > 0)) {
      continue;
    }
    if (N_BODY_STATIC_SOURCE_IDS.has(bodyId)) {
      staticSources.set(bodyId, {
        id: bodyId,
        massKg,
        position,
      });
      continue;
    }
    const velocity = parseVectorFromPayload(entry, "coordinates_velocity_km_s");
    if (!velocity) {
      continue;
    }
    dynamicBodies.set(bodyId, {
      id: bodyId,
      massKg,
      position,
      velocity,
    });
  }

  if (dynamicBodies.size === 0) {
    nBodyState = null;
    return;
  }

  neutralizeTotalMomentum(dynamicBodies, "sun");

  nBodyState = {
    initialized: true,
    lastUpdateMs: nowMs,
    simulationTimeMs: nowMs,
    integratorAccumulatorSec: 0,
    dynamicBodies,
    staticSources,
  };
  if (launchFeatureEnabled) {
    launchController?.ensureRocketInNBody(nBodyState, nowMs);
    launchController?.resetToPad(nBodyState, nowMs, { clearFleetVehicles: true });
  }
}

function isNBodyDrivenBodyId(bodyId) {
  const state = nBodyState;
  if (!N_BODY_ALL_BODIES_MODE || !state?.initialized) {
    return false;
  }
  return state.dynamicBodies.has(bodyId) || state.staticSources.has(bodyId);
}

function fallbackMassKgForBody(bodyId, currentMass) {
  if (Number.isFinite(Number(currentMass)) && Number(currentMass) > 0) {
    return Number(currentMass);
  }
  const catalogMass = Number(metaById.get(bodyId)?.mass_kg);
  if (Number.isFinite(catalogMass) && catalogMass > 0) {
    return catalogMass;
  }
  return 1;
}

function cloneDynamicBodySnapshot(bodyState) {
  return {
    massKg: fallbackMassKgForBody(bodyState?.id, bodyState?.massKg),
    position: finiteVectorKm(bodyState?.position)
      ? {
          x: Number(bodyState.position.x),
          y: Number(bodyState.position.y),
          z: Number(bodyState.position.z),
        }
      : { x: 0, y: 0, z: 0 },
    velocity: finiteVectorKm(bodyState?.velocity)
      ? {
          x: Number(bodyState.velocity.x),
          y: Number(bodyState.velocity.y),
          z: Number(bodyState.velocity.z),
        }
      : { x: 0, y: 0, z: 0 },
  };
}

function restoreDynamicBodyFromSnapshot(bodyState, snapshot) {
  if (!bodyState || !snapshot) {
    return;
  }
  bodyState.massKg = fallbackMassKgForBody(bodyState.id, snapshot.massKg);
  bodyState.position = {
    x: Number(snapshot.position?.x) || 0,
    y: Number(snapshot.position?.y) || 0,
    z: Number(snapshot.position?.z) || 0,
  };
  bodyState.velocity = {
    x: Number(snapshot.velocity?.x) || 0,
    y: Number(snapshot.velocity?.y) || 0,
    z: Number(snapshot.velocity?.z) || 0,
  };
}

function nBodyNumericWarn(message) {
  const now = Date.now();
  if (now - lastNBodyNumericWarnMs < 1200) {
    return;
  }
  lastNBodyNumericWarnMs = now;
  console.warn(`[n-body] ${message}`);
}

function sanitizeDynamicBodyState(bodyId, bodyState) {
  if (!bodyState) {
    return false;
  }
  bodyState.massKg = fallbackMassKgForBody(bodyId, bodyState.massKg);
  if (finiteVectorKm(bodyState.position) && finiteVectorKm(bodyState.velocity)) {
    return true;
  }
  const entry = positionsById.get(bodyId);
  const fallbackPosition = parseVectorFromPayload(entry, "coordinates_km");
  const fallbackVelocity = parseVectorFromPayload(entry, "coordinates_velocity_km_s");
  if (fallbackPosition && fallbackVelocity) {
    bodyState.position = {
      x: fallbackPosition.x,
      y: fallbackPosition.y,
      z: fallbackPosition.z,
    };
    bodyState.velocity = {
      x: fallbackVelocity.x,
      y: fallbackVelocity.y,
      z: fallbackVelocity.z,
    };
    return true;
  }
  bodyState.position = { x: 0, y: 0, z: 0 };
  bodyState.velocity = { x: 0, y: 0, z: 0 };
  return false;
}

function nBodyCoordinatesKmById(bodyId) {
  const state = nBodyState;
  if (!N_BODY_ALL_BODIES_MODE || !state?.initialized) {
    return null;
  }
  const dynamicBody = state.dynamicBodies.get(bodyId);
  if (finiteVectorKm(dynamicBody?.position)) {
    return {
      x: dynamicBody.position.x,
      y: dynamicBody.position.y,
      z: dynamicBody.position.z,
    };
  }
  const staticSource = state.staticSources.get(bodyId);
  if (finiteVectorKm(staticSource?.position)) {
    return {
      x: staticSource.position.x,
      y: staticSource.position.y,
      z: staticSource.position.z,
    };
  }
  return null;
}

function nBodyVelocityKmSById(bodyId) {
  const state = nBodyState;
  if (!N_BODY_ALL_BODIES_MODE || !state?.initialized) {
    return null;
  }
  const dynamicBody = state.dynamicBodies.get(bodyId);
  if (finiteVectorKm(dynamicBody?.velocity)) {
    return {
      x: dynamicBody.velocity.x,
      y: dynamicBody.velocity.y,
      z: dynamicBody.velocity.z,
    };
  }
  const staticSource = state.staticSources.get(bodyId);
  if (finiteVectorKm(staticSource?.velocity)) {
    return {
      x: staticSource.velocity.x,
      y: staticSource.velocity.y,
      z: staticSource.velocity.z,
    };
  }
  return null;
}

function applyNBodyDeltaVelocityKmS(bodyId, deltaVelocityKmS) {
  const state = nBodyState;
  if (!N_BODY_ALL_BODIES_MODE || !state?.initialized || !bodyId || !deltaVelocityKmS) {
    return;
  }
  const target = state.dynamicBodies.get(bodyId);
  if (!target?.velocity) {
    return;
  }
  const dvx = Number(deltaVelocityKmS.x);
  const dvy = Number(deltaVelocityKmS.y);
  const dvz = Number(deltaVelocityKmS.z);
  if (!Number.isFinite(dvx) || !Number.isFinite(dvy) || !Number.isFinite(dvz)) {
    return;
  }
  target.velocity.x += dvx;
  target.velocity.y += dvy;
  target.velocity.z += dvz;
}

function oblateModelForBody(bodyId, timestampMs = Date.now(), earthOrientation = null) {
  if (!OBLATE_GRAVITY_ENABLED) {
    return null;
  }
  const staticModel = OBLATE_GRAVITY_MODEL?.[bodyId] || null;
  const earthDynamicModel = bodyId === "earth"
    ? earthConventionalGravityModel(timestampMs, earthOrientation)
    : null;
  const model = earthDynamicModel || staticModel;
  const fallbackRadius = Number(metaById.get(bodyId)?.radius_km);
  const equatorialRadiusKm = Number(model?.equatorialRadiusKm);
  const referenceRadiusKm =
    Number.isFinite(equatorialRadiusKm) && equatorialRadiusKm > 0
      ? equatorialRadiusKm
      : (Number.isFinite(fallbackRadius) && fallbackRadius > 0 ? fallbackRadius : null);
  if (!(referenceRadiusKm > 0)) {
    return null;
  }

  const j2 = Number(model?.j2);
  const j3 = Number(model?.j3);
  const j4 = Number(model?.j4);
  const j5 = Number(model?.j5);
  const j6 = Number(model?.j6);
  const c21 = Number(model?.c21);
  const s21 = Number(model?.s21);
  const c22 = Number(model?.c22);
  const s22 = Number(model?.s22);
  const effectiveC21 = Number.isFinite(c21) ? c21 : 0;
  const effectiveS21 = Number.isFinite(s21) ? s21 : 0;
  let effectiveC22 = Number.isFinite(c22) ? c22 : 0;
  let effectiveS22 = Number.isFinite(s22) ? s22 : 0;

  if (!Number.isFinite(c22) || !Number.isFinite(s22)) {
    const rigidConstants = RIGID_BODY_PHYSICAL_CONSTANTS?.[bodyId];
    const principalMoments = rigidConstants?.principalMomentsKgKm2;
    const aMoment = Number(principalMoments?.A);
    const bMoment = Number(principalMoments?.B);
    const massKg = Number(metaById.get(bodyId)?.mass_kg);
    const mr2 = massKg * referenceRadiusKm * referenceRadiusKm;
    if (
      Number.isFinite(aMoment) &&
      Number.isFinite(bMoment) &&
      Number.isFinite(massKg) &&
      mr2 > 0
    ) {
      // Principal-axis approximation for unmodeled tesseral terms.
      const derivedC22 = (bMoment - aMoment) / (4 * mr2);
      if (!Number.isFinite(c22) && Number.isFinite(derivedC22)) {
        effectiveC22 = derivedC22;
      }
      if (!Number.isFinite(s22)) {
        effectiveS22 = 0;
      }
    }
  }

  const effectiveJ2 = Number.isFinite(j2) ? j2 : 0;
  const effectiveJ3 = Number.isFinite(j3) ? j3 : 0;
  const effectiveJ4 = Number.isFinite(j4) ? j4 : 0;
  const effectiveJ5 = Number.isFinite(j5) ? j5 : 0;
  const effectiveJ6 = Number.isFinite(j6) ? j6 : 0;
  const hasNonZeroHarmonic =
    Math.abs(effectiveJ2) > 1e-20 ||
    Math.abs(effectiveJ3) > 1e-20 ||
    Math.abs(effectiveJ4) > 1e-20 ||
    Math.abs(effectiveJ5) > 1e-20 ||
    Math.abs(effectiveJ6) > 1e-20 ||
    Math.abs(effectiveC21) > 1e-20 ||
    Math.abs(effectiveS21) > 1e-20 ||
    Math.abs(effectiveC22) > 1e-20 ||
    Math.abs(effectiveS22) > 1e-20;
  if (!hasNonZeroHarmonic) {
    return null;
  }

  return {
    source: String(model?.source || ""),
    j2: effectiveJ2,
    j3: effectiveJ3,
    j4: effectiveJ4,
    j5: effectiveJ5,
    j6: effectiveJ6,
    c21: effectiveC21,
    s21: effectiveS21,
    c22: effectiveC22,
    s22: effectiveS22,
    harmonics: Array.isArray(model?.harmonics)
      ? model.harmonics.map((term) => ({ ...term }))
      : null,
    referenceRadiusKm,
  };
}

function sourcePoleUnitVectorEclipticForBody(bodyId, timestampMs = Date.now()) {
  const pole = currentPoleEquatorialDegForBody(bodyId, timestampMs);
  if (!pole) {
    return null;
  }
  return equatorialPoleToEclipticVector(
    Number(pole.raDeg),
    Number(pole.decDeg),
    ECLIPTIC_OBLIQUITY_DEG,
  );
}

function dotVector3(a, b) {
  return (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
}

function crossVector3(a, b) {
  return {
    x: (a.y * b.z) - (a.z * b.y),
    y: (a.z * b.x) - (a.x * b.z),
    z: (a.x * b.y) - (a.y * b.x),
  };
}

function normalizeVector3OrNull(vector) {
  if (!vector) {
    return null;
  }
  const magSq = (vector.x * vector.x) + (vector.y * vector.y) + (vector.z * vector.z);
  if (!(magSq > 1e-18)) {
    return null;
  }
  const invMag = 1 / Math.sqrt(magSq);
  return {
    x: vector.x * invMag,
    y: vector.y * invMag,
    z: vector.z * invMag,
  };
}

function sourceBodyFixedAxesEclipticForBody(bodyId, pole, timestampMs = Date.now()) {
  const poleUnit = normalizeVector3OrNull(pole);
  if (!poleUnit) {
    return null;
  }

  const buildBaseAxis = (reference) => {
    const projection = dotVector3(reference, poleUnit);
    return normalizeVector3OrNull({
      x: reference.x - (projection * poleUnit.x),
      y: reference.y - (projection * poleUnit.y),
      z: reference.z - (projection * poleUnit.z),
    });
  };

  let xBase = buildBaseAxis({ x: 1, y: 0, z: 0 });
  if (!xBase) {
    xBase = buildBaseAxis({ x: 0, y: 1, z: 0 });
  }
  if (!xBase) {
    return null;
  }
  const yBase = normalizeVector3OrNull(crossVector3(poleUnit, xBase));
  if (!yBase) {
    return null;
  }

  const body = metaById.get(bodyId);
  const spinModel = primeMeridianModelForBody(body);
  let spinAngleRad = 0;
  let earthOrientation = null;
  if (spinModel) {
    const daysSinceJ2000 = julianDayFromUnixMs(modelTimestampMs(timestampMs)) - 2_451_545.0;
    spinAngleRad = rad(normalizeDegrees(
      spinModel.w0Deg + (spinModel.wRateDegPerDay * daysSinceJ2000),
    ));
  }
  if (bodyId === "earth") {
    earthOrientation = estimateEarthOrientationParameters(timestampMs);
    spinAngleRad += Number(earthOrientation?.dut1Rad) || 0;
  }

  const c = Math.cos(spinAngleRad);
  const s = Math.sin(spinAngleRad);
  const xAxis = normalizeVector3OrNull({
    x: (xBase.x * c) + (yBase.x * s),
    y: (xBase.y * c) + (yBase.y * s),
    z: (xBase.z * c) + (yBase.z * s),
  });
  const yAxis = normalizeVector3OrNull({
    x: (yBase.x * c) - (xBase.x * s),
    y: (yBase.y * c) - (xBase.y * s),
    z: (yBase.z * c) - (xBase.z * s),
  });
  if (!xAxis || !yAxis) {
    return null;
  }
  if (bodyId === "earth") {
    const adjusted = applyEarthOrientationToAxes({
      xAxis,
      yAxis,
      pole: poleUnit,
      orientation: earthOrientation,
    });
    return {
      xAxis: adjusted?.xAxis || xAxis,
      yAxis: adjusted?.yAxis || yAxis,
      pole: adjusted?.pole || poleUnit,
      earthOrientation: adjusted
        ? {
            source: adjusted.orientationSource,
            dut1Sec: adjusted.dut1Sec,
            xpArcsec: adjusted.xpArcsec,
            ypArcsec: adjusted.ypArcsec,
            precessionLongitudeArcsec: adjusted.precessionLongitudeArcsec,
            precessionObliquityArcsec: adjusted.precessionObliquityArcsec,
            nutationLongitudeArcsec: adjusted.nutationLongitudeArcsec,
            nutationObliquityArcsec: adjusted.nutationObliquityArcsec,
            lodSec: adjusted.lodSec,
          }
        : null,
    };
  }
  return { xAxis, yAxis, pole: poleUnit };
}

function buildOblateSourceContextMapFromIds(sourceIds, timestampMs = Date.now()) {
  const contextById = new Map();
  if (!OBLATE_GRAVITY_ENABLED && !LUNAR_MASCON_MODEL_ENABLED) {
    return contextById;
  }
  for (const sourceId of sourceIds || []) {
    if (!sourceId || contextById.has(sourceId)) {
      continue;
    }
    const useLunarMasconAxes = LUNAR_MASCON_MODEL_ENABLED && sourceId === "moon";
    const pole = sourcePoleUnitVectorEclipticForBody(sourceId, timestampMs);
    if (!pole) {
      continue;
    }
    const fixedAxes = sourceBodyFixedAxesEclipticForBody(sourceId, pole, timestampMs);
    const model = oblateModelForBody(sourceId, timestampMs, fixedAxes?.earthOrientation || null);
    if (!model && !useLunarMasconAxes) {
      continue;
    }
    const fallbackRadiusKm = Number(metaById.get(sourceId)?.radius_km) || 0;
    const effectivePole = fixedAxes?.pole || pole;
    contextById.set(sourceId, {
      j2: Number(model?.j2) || 0,
      j3: Number(model?.j3) || 0,
      j4: Number(model?.j4) || 0,
      j5: Number(model?.j5) || 0,
      j6: Number(model?.j6) || 0,
      c21: Number(model?.c21) || 0,
      s21: Number(model?.s21) || 0,
      c22: Number(model?.c22) || 0,
      s22: Number(model?.s22) || 0,
      harmonics: Array.isArray(model?.harmonics) ? model.harmonics.map((term) => ({ ...term })) : null,
      referenceRadiusKm: Number(model?.referenceRadiusKm) || fallbackRadiusKm || 1737.4,
      gravityModelSource: String(model?.source || ""),
      pole: effectivePole,
      xAxis: fixedAxes?.xAxis || null,
      yAxis: fixedAxes?.yAxis || null,
      earthOrientation: fixedAxes?.earthOrientation || null,
      lunarMasconEnabled: useLunarMasconAxes,
    });
  }
  return contextById;
}

function buildOblateSourceContextMapForNBody(state, timestampMs = Date.now()) {
  const sourceIds = [];
  for (const sourceId of state?.dynamicBodies?.keys?.() || []) {
    sourceIds.push(sourceId);
  }
  for (const sourceId of state?.staticSources?.keys?.() || []) {
    sourceIds.push(sourceId);
  }
  return buildOblateSourceContextMapFromIds(sourceIds, timestampMs);
}

function computeGravityAccelerationFromSource(
  targetPos,
  sourceId,
  sourceMassKg,
  sourcePos,
  oblateSourceContextById = null,
  sourceEnvironment = null,
) {
  if (!(sourceMassKg > 0) || !targetPos || !sourcePos) {
    return { x: 0, y: 0, z: 0 };
  }

  const rx = targetPos.x - sourcePos.x;
  const ry = targetPos.y - sourcePos.y;
  const rz = targetPos.z - sourcePos.z;
  const radiusSq = (rx * rx) + (ry * ry) + (rz * rz);
  if (!(radiusSq > 1e-10)) {
    return { x: 0, y: 0, z: 0 };
  }
  const radius = Math.sqrt(radiusSq);
  const invRadius = 1 / radius;
  const invRadiusCubed = invRadius / radiusSq;
  const muOverR3 = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * sourceMassKg * invRadiusCubed;

  let ax = -muOverR3 * rx;
  let ay = -muOverR3 * ry;
  let az = -muOverR3 * rz;

  const oblate = oblateSourceContextById?.get(sourceId);
  if (oblate) {
    const oblatePerturbation = computeOblateGravityPerturbationKmS2({
      relPosKm: { x: rx, y: ry, z: rz },
      radiusKm: radius,
      muOverR3,
      referenceRadiusKm: Number(oblate.referenceRadiusKm) || 0,
      pole: oblate.pole,
      xAxis: oblate.xAxis,
      yAxis: oblate.yAxis,
      j2: Number(oblate.j2) || 0,
      j3: Number(oblate.j3) || 0,
      j4: Number(oblate.j4) || 0,
      j5: Number(oblate.j5) || 0,
      j6: Number(oblate.j6) || 0,
      c21: Number(oblate.c21) || 0,
      s21: Number(oblate.s21) || 0,
      c22: Number(oblate.c22) || 0,
      s22: Number(oblate.s22) || 0,
      harmonicTerms: Array.isArray(oblate.harmonics) ? oblate.harmonics : null,
    });
    ax += Number(oblatePerturbation.x) || 0;
    ay += Number(oblatePerturbation.y) || 0;
    az += Number(oblatePerturbation.z) || 0;
  }

  if (EARTH_SOLID_TIDE_ENABLED && sourceId === "earth") {
    const sourceStateLookup = typeof sourceEnvironment?.getBodyState === "function"
      ? sourceEnvironment.getBodyState
      : null;
    const tideRaisingBodies = [];
    for (const bodyId of EARTH_SOLID_TIDE_SOURCE_BODY_IDS) {
      const bodyState = sourceStateLookup?.(bodyId);
      const positionKm = finiteVectorKm(bodyState?.position)
        ? bodyState.position
        : (
          finiteVectorKm(bodyState)
            ? bodyState
            : null
        );
      const bodyMassKg = Number(bodyState?.massKg) || bodyMassKgById(bodyId);
      if (!positionKm || !(bodyMassKg > 0)) {
        continue;
      }
      tideRaisingBodies.push({ positionKm, massKg: bodyMassKg });
    }
    if (tideRaisingBodies.length > 0) {
      const earthRadiusKm = Number(oblate?.referenceRadiusKm) || bodyRadiusKmById("earth") || 6378.137;
      const tidePerturbation = computeEarthSolidTidePerturbationKmS2({
        targetPosKm: targetPos,
        earthPosKm: sourcePos,
        earthRadiusKm,
        gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
        tideRaisingBodies,
      });
      ax += Number(tidePerturbation.x) || 0;
      ay += Number(tidePerturbation.y) || 0;
      az += Number(tidePerturbation.z) || 0;
    }
  }

  if (
    LUNAR_MASCON_MODEL_ENABLED
    && sourceId === "moon"
    && oblate?.xAxis
    && oblate?.yAxis
    && oblate?.pole
  ) {
    const masconAcceleration = computeLunarMasconAccelerationKmS2({
      targetPosKm: targetPos,
      moonCenterPosKm: sourcePos,
      moonMassKg: sourceMassKg,
      moonRadiusKm: Number(oblate.referenceRadiusKm) || bodyRadiusKmById("moon") || 1737.4,
      moonAxes: {
        xAxis: oblate.xAxis,
        yAxis: oblate.yAxis,
        pole: oblate.pole,
      },
      gravitationalConstantKm3PerKgS2: GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2,
    });
    if (
      Number.isFinite(masconAcceleration.x)
      && Number.isFinite(masconAcceleration.y)
      && Number.isFinite(masconAcceleration.z)
    ) {
      ax += masconAcceleration.x;
      ay += masconAcceleration.y;
      az += masconAcceleration.z;
    }
  }

  return { x: ax, y: ay, z: az };
}

function computeNBodyAccelerationForTarget(state, targetId, oblateSourceContextById = null) {
  const target = state?.dynamicBodies?.get(targetId);
  if (!target?.position) {
    return { x: 0, y: 0, z: 0 };
  }

  let ax = 0;
  let ay = 0;
  let az = 0;
  const targetPos = target.position;

  const sourceEnvironment = {
    getBodyState: (sourceId) => (
      state?.dynamicBodies?.get(sourceId)
      || state?.staticSources?.get(sourceId)
      || null
    ),
  };
  const addSourceAcceleration = (sourceId, sourceMassKg, sourcePos) => {
    const contribution = computeGravityAccelerationFromSource(
      targetPos,
      sourceId,
      sourceMassKg,
      sourcePos,
      oblateSourceContextById,
      sourceEnvironment,
    );
    ax += contribution.x;
    ay += contribution.y;
    az += contribution.z;
  };

  for (const [sourceId, source] of state.dynamicBodies.entries()) {
    if (sourceId === targetId) {
      continue;
    }
    addSourceAcceleration(sourceId, source.massKg, source.position);
  }
  for (const [sourceId, source] of state.staticSources.entries()) {
    addSourceAcceleration(sourceId, source.massKg, source.position);
  }

  return { x: ax, y: ay, z: az };
}

function computeNBodySolarRadiationAccelerationForTarget(state, targetId) {
  if (!SOLAR_RADIATION_PRESSURE_ENABLED) {
    return { x: 0, y: 0, z: 0 };
  }
  const targetBody = state?.dynamicBodies?.get(targetId);
  if (!targetBody?.position) {
    return { x: 0, y: 0, z: 0 };
  }
  const targetMeta = metaById.get(targetId) || null;
  if (String(targetMeta?.body_type || "").trim().toLowerCase() !== "spacecraft") {
    return { x: 0, y: 0, z: 0 };
  }
  const sunState =
    state?.dynamicBodies?.get("sun")
    || state?.staticSources?.get("sun")
    || null;
  if (!sunState?.position) {
    return { x: 0, y: 0, z: 0 };
  }
  const sunRadiusKm = bodyRadiusKmById("sun");
  if (!(sunRadiusKm > 0)) {
    return { x: 0, y: 0, z: 0 };
  }

  const occluders = [];
  for (const [occluderId, occluderState] of state?.dynamicBodies || []) {
    if (!occluderState?.position || occluderId === "sun" || occluderId === targetId) {
      continue;
    }
    const radiusKm = bodyRadiusKmById(occluderId);
    if (!(radiusKm > 0)) {
      continue;
    }
    occluders.push({
      id: occluderId,
      positionKm: occluderState.position,
      radiusKm,
    });
  }
  for (const [occluderId, occluderState] of state?.staticSources || []) {
    if (!occluderState?.position || occluderId === "sun" || occluderId === targetId) {
      continue;
    }
    const radiusKm = bodyRadiusKmById(occluderId);
    if (!(radiusKm > 0)) {
      continue;
    }
    occluders.push({
      id: occluderId,
      positionKm: occluderState.position,
      radiusKm,
    });
  }

  const shadowTransmittance = computeSolarShadowTransmittance({
    targetId,
    targetPosKm: targetBody.position,
    sunPosKm: sunState.position,
    sunRadiusKm,
    occluders,
  });
  return computeSolarRadiationAccelerationKmS2({
    bodyId: targetId,
    bodyMeta: targetMeta,
    bodyMassKg: Number(targetBody.massKg) || Number(targetMeta?.mass_kg) || 0,
    targetPosKm: targetBody.position,
    sunPosKm: sunState.position,
    transmittance: shadowTransmittance,
  });
}

function computeNBodyTotalAccelerationForTarget(state, targetId, oblateSourceContextById = null, stepNowMs = Date.now()) {
  const gravity = finiteAccelerationKmS2(
    computeNBodyAccelerationForTarget(state, targetId, oblateSourceContextById),
  );
  const atmospheric = finiteAccelerationKmS2(
    atmosphereDynamicsController?.computeAtmosphericAccelerationKmS2(state, targetId, stepNowMs) || { x: 0, y: 0, z: 0 },
  );
  const thrust = launchFeatureEnabled
    ? finiteAccelerationKmS2(launchController?.externalAccelerationKmS2(targetId) || { x: 0, y: 0, z: 0 })
    : { x: 0, y: 0, z: 0 };
  const solarRadiation = finiteAccelerationKmS2(
    computeNBodySolarRadiationAccelerationForTarget(state, targetId),
  );
  const totalX = gravity.x + atmospheric.x + thrust.x + solarRadiation.x;
  const totalY = gravity.y + atmospheric.y + thrust.y + solarRadiation.y;
  const totalZ = gravity.z + atmospheric.z + thrust.z + solarRadiation.z;
  if (!Number.isFinite(totalX) || !Number.isFinite(totalY) || !Number.isFinite(totalZ)) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: totalX, y: totalY, z: totalZ };
}

function integrateNBodyStep(state, dtSeconds, stepNowMs = Date.now(), oblateSourceContextByIdInput = null) {
  const oblateSourceContextById =
    oblateSourceContextByIdInput || buildOblateSourceContextMapForNBody(state, stepNowMs);
  if (launchFeatureEnabled) {
    launchController?.prepareStep(state, dtSeconds, stepNowMs);
  }
  const preStepSnapshotsById = new Map();
  for (const [bodyId, bodyState] of state.dynamicBodies.entries()) {
    const valid = sanitizeDynamicBodyState(bodyId, bodyState);
    preStepSnapshotsById.set(bodyId, cloneDynamicBodySnapshot(bodyState));
    if (!valid) {
      nBodyNumericWarn(`reset non-finite state for ${bodyId} from startup/live fallback`);
    }
  }

  const accelerationStartById = new Map();
  for (const bodyId of state.dynamicBodies.keys()) {
    const accel = computeNBodyTotalAccelerationForTarget(state, bodyId, oblateSourceContextById, stepNowMs);
    accelerationStartById.set(bodyId, finiteAccelerationKmS2(accel));
  }

  for (const [bodyId, bodyState] of state.dynamicBodies.entries()) {
    const accel = finiteAccelerationKmS2(accelerationStartById.get(bodyId) || { x: 0, y: 0, z: 0 });
    bodyState.velocity.x += 0.5 * accel.x * dtSeconds;
    bodyState.velocity.y += 0.5 * accel.y * dtSeconds;
    bodyState.velocity.z += 0.5 * accel.z * dtSeconds;

    bodyState.position.x += bodyState.velocity.x * dtSeconds;
    bodyState.position.y += bodyState.velocity.y * dtSeconds;
    bodyState.position.z += bodyState.velocity.z * dtSeconds;
  }

  for (const [bodyId, bodyState] of state.dynamicBodies.entries()) {
    const accel = finiteAccelerationKmS2(
      computeNBodyTotalAccelerationForTarget(state, bodyId, oblateSourceContextById, stepNowMs),
    );
    bodyState.velocity.x += 0.5 * accel.x * dtSeconds;
    bodyState.velocity.y += 0.5 * accel.y * dtSeconds;
    bodyState.velocity.z += 0.5 * accel.z * dtSeconds;
  }

  for (const [bodyId, bodyState] of state.dynamicBodies.entries()) {
    if (!finiteBodyState(bodyState)) {
      const fallbackSnapshot = preStepSnapshotsById.get(bodyId);
      restoreDynamicBodyFromSnapshot(bodyState, fallbackSnapshot);
      nBodyNumericWarn(`restored unstable integration state for ${bodyId}`);
    }
  }

  if (launchFeatureEnabled) {
    launchController?.finalizeStep(state, dtSeconds, stepNowMs);
  }
}

function launchStepSecondsFromSnapshot(snapshot) {
  const phase = String(snapshot?.phase || "").toLowerCase();
  const boosterPhase = String(snapshot?.boosterPhase || "").toLowerCase();
  const boosterBurning =
    boosterPhase.includes("burn") ||
    boosterPhase.includes("boostback");

  if (phase === "powered" || boosterBurning) {
    return N_BODY_STEP_SECONDS_LAUNCH_ACTIVE;
  }
  if (phase === "coast") {
    return N_BODY_STEP_SECONDS_LAUNCH_COAST;
  }
  if (phase === "orbit") {
    return N_BODY_STEP_SECONDS_LAUNCH_ORBIT;
  }
  return Math.max(N_BODY_STEP_SECONDS_LAUNCH_ACTIVE, N_BODY_STEP_SECONDS_LAUNCH_COAST);
}

function updateNBodySimulation(nowMs) {
  if (!N_BODY_ALL_BODIES_MODE || !nBodyState?.initialized) {
    return;
  }

  if (!Number.isFinite(nBodyState.lastUpdateMs)) {
    nBodyState.lastUpdateMs = nowMs;
    nBodyState.simulationTimeMs = nowMs;
    nBodyState.integratorAccumulatorSec = 0;
    return;
  }

  const elapsedSecondsRaw = (nowMs - nBodyState.lastUpdateMs) / 1000;
  const elapsedSeconds = Number.isFinite(elapsedSecondsRaw)
    ? Math.max(0, elapsedSecondsRaw)
    : 0;
  nBodyState.lastUpdateMs = nowMs;
  if (!(elapsedSeconds > 0) && !((Number(nBodyState.integratorAccumulatorSec) || 0) > 1e-9)) {
    return;
  }

  if (!Number.isFinite(nBodyState.simulationTimeMs)) {
    nBodyState.simulationTimeMs = nowMs - (elapsedSeconds * 1000);
  }
  if (!Number.isFinite(nBodyState.integratorAccumulatorSec) || nBodyState.integratorAccumulatorSec < 0) {
    nBodyState.integratorAccumulatorSec = 0;
  }

  const pendingElapsedSeconds = Math.max(0, Number(nBodyState.integratorAccumulatorSec) || 0) + elapsedSeconds;
  if (!(pendingElapsedSeconds > 0)) {
    nBodyState.lastUpdateMs = nowMs;
    return;
  }

  const launchActive = launchFeatureEnabled && Boolean(launchController?.isActive?.());
  const launchSnapshot = launchActive ? (launchController?.statusSnapshot?.() || null) : null;
  const stepSeconds = launchSnapshot
    ? launchStepSecondsFromSnapshot(launchSnapshot)
    : N_BODY_STEP_SECONDS;
  if (!Number.isFinite(stepSeconds) || !(stepSeconds > 1e-9)) {
    nBodyNumericWarn(`invalid integration step (${String(stepSeconds)}); skipping frame`);
    nBodyState.integratorAccumulatorSec = pendingElapsedSeconds;
    return;
  }
  const oblateSourceContextById = buildOblateSourceContextMapForNBody(nBodyState, nowMs);
  let substeps = 0;
  let stepNowMs = Number(nBodyState.simulationTimeMs) || nowMs;
  let remainingSeconds = pendingElapsedSeconds;
  while (
    remainingSeconds > 1e-9
    && substeps < N_BODY_MAX_SUBSTEPS_PER_FRAME
  ) {
    const dtSeconds = Math.min(stepSeconds, remainingSeconds);
    integrateNBodyStep(nBodyState, dtSeconds, stepNowMs, oblateSourceContextById);
    remainingSeconds -= dtSeconds;
    stepNowMs += dtSeconds * 1000;
    substeps += 1;
  }
  nBodyState.simulationTimeMs = stepNowMs;
  nBodyState.integratorAccumulatorSec = Math.max(0, remainingSeconds);
  if (remainingSeconds > 1e-6) {
    const now = Date.now();
    if (now - lastNBodyBacklogWarnMs > 4000) {
      lastNBodyBacklogWarnMs = now;
      console.warn(
        `[n-body] backlog queued: ${remainingSeconds.toFixed(3)}s remaining after ${substeps} substeps (step=${stepSeconds}s)`,
      );
    }
  }
}

function syncOrbitalStateFromSnapshot() {
  const previousState = orbitalStateById;
  const nextState = new Map();
  const nowMs = Date.now();
  for (const body of bodies) {
    if (body.id === "sun") {
      continue;
    }

    const parentId = body.parent || "sun";
    const previous = previousState.get(body.id);

    const useKeplerMoonModel = body.body_type === "moon" && Number(body.semimajor_axis_km) > 0;
    if (useKeplerMoonModel) {
      const orbitalSpeed = getOrbitalSpeedRadPerSecond(body, false, ORBIT_TIME_SCALE);
      const elements = getMoonOrbitalElements(body);
      if (
        previous &&
        previous.mode === "kepler" &&
        previous.parentId === parentId &&
        Number.isFinite(previous.aKm) &&
        previous.aKm > 0 &&
        Number.isFinite(previous.baseTimestampMs)
      ) {
        const elapsedModelSeconds = clamp(
          ((nowMs - previous.baseTimestampMs) / 1000) * ORBIT_TIME_SCALE,
          -ORBIT_PROPAGATION_MAX_SECONDS,
          ORBIT_PROPAGATION_MAX_SECONDS,
        );
        nextState.set(body.id, {
          mode: "kepler",
          parentId,
          aKm: elements.aKm,
          e: elements.e,
          inclinationRad: elements.inclinationRad,
          ascendingNodeRad: elements.ascendingNodeRad,
          argPeriapsisRad: elements.argPeriapsisRad,
          angularSpeedRadPerSecond: orbitalSpeed,
          baseMeanAnomalyRad: normalizeAngle(
            previous.baseMeanAnomalyRad + (previous.angularSpeedRadPerSecond * elapsedModelSeconds),
          ),
          baseTimestampMs: nowMs,
        });
        continue;
      }

      const relativeKm = getRelativeVectorKmForBody(body, parentId);
      let baseMeanAnomaly = normalizeAngle((Number(body.phase) || 0) * Math.PI * 2);
      const inferredMeanAnomaly = inferMeanAnomalyFromRelativeVector(relativeKm, elements);
      if (Number.isFinite(inferredMeanAnomaly)) {
        baseMeanAnomaly = inferredMeanAnomaly;
      }

      nextState.set(body.id, {
        mode: "kepler",
        parentId,
        aKm: elements.aKm,
        e: elements.e,
        inclinationRad: elements.inclinationRad,
        ascendingNodeRad: elements.ascendingNodeRad,
        argPeriapsisRad: elements.argPeriapsisRad,
        angularSpeedRadPerSecond: orbitalSpeed,
        baseMeanAnomalyRad: baseMeanAnomaly,
        baseTimestampMs: nowMs,
      });
      continue;
    }

    const orbitalSpeed = getOrbitalSpeedRadPerSecond(body, true, ORBIT_TIME_SCALE);
    if (
      previous &&
      previous.mode !== "kepler" &&
      previous.parentId === parentId &&
      Number.isFinite(previous.radiusKmXY) &&
      previous.radiusKmXY > 0 &&
      Number.isFinite(previous.baseTimestampMs)
    ) {
      const elapsedModelSeconds = clamp(
        ((nowMs - previous.baseTimestampMs) / 1000) * ORBIT_TIME_SCALE,
        -ORBIT_PROPAGATION_MAX_SECONDS,
        ORBIT_PROPAGATION_MAX_SECONDS,
      );
      nextState.set(body.id, {
        mode: "circular",
        parentId,
        baseAngleRad: previous.baseAngleRad + (previous.angularSpeedRadPerSecond * elapsedModelSeconds),
        radiusKmXY: previous.radiusKmXY,
        relZKm: previous.relZKm,
        angularSpeedRadPerSecond: orbitalSpeed,
        baseTimestampMs: nowMs,
      });
      continue;
    }

    const relativeKm = getRelativeVectorKmForBody(body, parentId);
    const radiusKmXY = Math.hypot(relativeKm.x, relativeKm.y);
    const fallbackRadius = Number(body.semimajor_axis_km) || Math.hypot(relativeKm.x, relativeKm.y, relativeKm.z);
    nextState.set(body.id, {
      mode: "circular",
      parentId,
      baseAngleRad: Math.atan2(relativeKm.y, relativeKm.x),
      radiusKmXY: radiusKmXY > 0 ? radiusKmXY : fallbackRadius,
      relZKm: relativeKm.z,
      angularSpeedRadPerSecond: orbitalSpeed,
      baseTimestampMs: nowMs,
    });
  }
  orbitalStateById = nextState;
}

function getRelativeVectorKmForBody(body, parentId) {
  const runtimeBody = runtimeCoordsKmById.get(body.id) || null;
  const runtimeParent = runtimeCoordsKmById.get(parentId) || null;
  const liveBody = positionsById.get(body.id)?.coordinates_km || null;
  const liveParent = positionsById.get(parentId)?.coordinates_km || null;

  if (runtimeBody && runtimeParent) {
    return {
      x: runtimeBody.x - runtimeParent.x,
      y: runtimeBody.y - runtimeParent.y,
      z: runtimeBody.z - runtimeParent.z,
    };
  }
  if (liveBody && liveParent) {
    return {
      x: liveBody.x - liveParent.x,
      y: liveBody.y - liveParent.y,
      z: liveBody.z - liveParent.z,
    };
  }
  if (liveBody && parentId === "sun") {
    return {
      x: liveBody.x,
      y: liveBody.y,
      z: liveBody.z,
    };
  }

  const fallbackRadius = Number(body.semimajor_axis_km) || 0;
  const fallbackPhase = (Number(body.phase) || 0) * Math.PI * 2;
  return {
    x: fallbackRadius * Math.cos(fallbackPhase),
    y: fallbackRadius * Math.sin(fallbackPhase),
    z: 0,
  };
}

function computeRuntimeCoordinatesKm(nowMs) {
  const runtimeCoords = new Map();
  const sunNBody = nBodyCoordinatesKmById("sun");
  const sunLive = positionsById.get("sun")?.coordinates_km;
  const sunSeed = finiteVectorKm(sunNBody)
    ? {
        x: Number(sunNBody.x),
        y: Number(sunNBody.y),
        z: Number(sunNBody.z),
      }
    : finiteVectorKm(sunLive)
    ? {
        x: Number(sunLive.x),
        y: Number(sunLive.y),
        z: Number(sunLive.z),
      }
    : { x: 0, y: 0, z: 0 };
  runtimeCoords.set(
    "sun",
    sunSeed,
  );

  const resolving = new Set();
  for (const body of bodies) {
    resolveRuntimeCoordinates(body.id, runtimeCoords, resolving, nowMs);
  }
  return runtimeCoords;
}

function resolveRuntimeCoordinates(bodyId, runtimeCoords, resolving, nowMs) {
  if (runtimeCoords.has(bodyId)) {
    return runtimeCoords.get(bodyId);
  }
  if (resolving.has(bodyId)) {
    return null;
  }
  resolving.add(bodyId);

  const state = orbitalStateById.get(bodyId);
  const meta = metaById.get(bodyId);
  const live = positionsById.get(bodyId)?.coordinates_km;
  const nBodyCoords = nBodyCoordinatesKmById(bodyId);
  if (finiteVectorKm(nBodyCoords)) {
    runtimeCoords.set(bodyId, nBodyCoords);
    resolving.delete(bodyId);
    return nBodyCoords;
  }
  if (SCIENTIFIC_ACCURACY_MODE) {
    if (finiteVectorKm(live)) {
      const propagatedLive = propagateLiveCoordinates(bodyId, runtimeCoords, resolving, nowMs);
      runtimeCoords.set(bodyId, propagatedLive);
      resolving.delete(bodyId);
      return propagatedLive;
    }
    resolving.delete(bodyId);
    return null;
  }
  if (!state || !meta) {
    const fallback = finiteVectorKm(live)
      ? {
          x: live.x,
          y: live.y,
          z: live.z,
        }
      : null;
    if (!fallback) {
      resolving.delete(bodyId);
      return null;
    }
    runtimeCoords.set(bodyId, fallback);
    resolving.delete(bodyId);
    return fallback;
  }

  const parentId = state.parentId || meta.parent || "sun";
  const parentCoords = resolveRuntimeCoordinates(parentId, runtimeCoords, resolving, nowMs);
  if (!parentCoords) {
    resolving.delete(bodyId);
    return null;
  }
  const dtSeconds = clamp(
    ((nowMs - state.baseTimestampMs) / 1000) * ORBIT_TIME_SCALE,
    -ORBIT_PROPAGATION_MAX_SECONDS,
    ORBIT_PROPAGATION_MAX_SECONDS,
  );
  let computed = null;
  if (state.mode === "kepler" && state.aKm > 0) {
    const meanAnomaly = normalizeAngle(state.baseMeanAnomalyRad + (state.angularSpeedRadPerSecond * dtSeconds));
    const eccentricAnomaly = solveKepler(meanAnomaly, state.e);
    const semiMinorKm = state.aKm * Math.sqrt(Math.max(1 - (state.e * state.e), 1e-8));
    const perifocal = {
      x: state.aKm * (Math.cos(eccentricAnomaly) - state.e),
      y: semiMinorKm * Math.sin(eccentricAnomaly),
      z: 0,
    };
    const rel = fromPerifocalFrame(perifocal, state);
    computed = {
      x: parentCoords.x + rel.x,
      y: parentCoords.y + rel.y,
      z: parentCoords.z + rel.z,
    };
  } else {
    const angle = state.baseAngleRad + (state.angularSpeedRadPerSecond * dtSeconds);
    const radiusKmXY = state.radiusKmXY > 0 ? state.radiusKmXY : Number(meta.semimajor_axis_km) || 0;
    computed = {
      x: parentCoords.x + (radiusKmXY * Math.cos(angle)),
      y: parentCoords.y + (radiusKmXY * Math.sin(angle)),
      z: parentCoords.z + (state.relZKm || 0),
    };
  }

  runtimeCoords.set(bodyId, computed);
  resolving.delete(bodyId);
  return computed;
}

function gravityCenterIdForBody(body) {
  if (!body || body.id === "sun") {
    return null;
  }
  if (body.body_type === "moon" && body.parent) {
    return body.parent;
  }
  if (body.parent) {
    return body.parent;
  }
  return "sun";
}

function bodyMassKgById(bodyId) {
  const dynamicMass = Number(nBodyState?.dynamicBodies?.get(bodyId)?.massKg);
  if (Number.isFinite(dynamicMass) && dynamicMass > 0) {
    return dynamicMass;
  }
  const mass = Number(metaById.get(bodyId)?.mass_kg);
  return Number.isFinite(mass) && mass > 0 ? mass : null;
}

function liveCoordinatesForBody(bodyId) {
  const coords = positionsById.get(bodyId)?.coordinates_km;
  if (!coords) {
    return null;
  }
  return {
    x: Number(coords.x) || 0,
    y: Number(coords.y) || 0,
    z: Number(coords.z) || 0,
  };
}

function liveVelocityForBody(bodyId) {
  const velocity = positionsById.get(bodyId)?.coordinates_velocity_km_s;
  if (
    Number.isFinite(Number(velocity?.x)) &&
    Number.isFinite(Number(velocity?.y)) &&
    Number.isFinite(Number(velocity?.z))
  ) {
    return {
      x: Number(velocity.x),
      y: Number(velocity.y),
      z: Number(velocity.z),
    };
  }
  return { x: 0, y: 0, z: 0 };
}

function propagateLiveCoordinates(bodyId, runtimeCoords, resolving, nowMs) {
  const liveEntry = positionsById.get(bodyId);
  const liveCoords = liveEntry?.coordinates_km;
  if (!liveCoords) {
    return { x: 0, y: 0, z: 0 };
  }
  const liveVelocity = liveEntry?.coordinates_velocity_km_s;
  const hasVelocity =
    Number.isFinite(Number(liveVelocity?.x)) &&
    Number.isFinite(Number(liveVelocity?.y)) &&
    Number.isFinite(Number(liveVelocity?.z));
  if (!hasVelocity) {
    return {
      x: liveCoords.x,
      y: liveCoords.y,
      z: liveCoords.z,
    };
  }

  const dtSeconds = clamp(
    (nowMs - latestSolarTimestampMs) / 1000,
    -LIVE_VELOCITY_PROPAGATION_MAX_SECONDS,
    LIVE_VELOCITY_PROPAGATION_MAX_SECONDS,
  );
  if (Math.abs(dtSeconds) < 1e-6) {
    return {
      x: liveCoords.x,
      y: liveCoords.y,
      z: liveCoords.z,
    };
  }

  const meta = metaById.get(bodyId);
  const centerId = gravityCenterIdForBody(meta);
  if (!centerId) {
    return {
      x: liveCoords.x + (liveVelocity.x * dtSeconds),
      y: liveCoords.y + (liveVelocity.y * dtSeconds),
      z: liveCoords.z + (liveVelocity.z * dtSeconds),
    };
  }

  const centerMassKg = bodyMassKgById(centerId);
  if (!centerMassKg) {
    return {
      x: liveCoords.x + (liveVelocity.x * dtSeconds),
      y: liveCoords.y + (liveVelocity.y * dtSeconds),
      z: liveCoords.z + (liveVelocity.z * dtSeconds),
    };
  }

  const centerLiveCoords = liveCoordinatesForBody(centerId) || { x: 0, y: 0, z: 0 };
  const centerLiveVelocity = liveVelocityForBody(centerId);
  const centerNowCoords = runtimeCoords.get(centerId)
    || resolveRuntimeCoordinates(centerId, runtimeCoords, resolving, nowMs)
    || centerLiveCoords;

  const relX = liveCoords.x - centerLiveCoords.x;
  const relY = liveCoords.y - centerLiveCoords.y;
  const relZ = liveCoords.z - centerLiveCoords.z;
  const relVX = liveVelocity.x - centerLiveVelocity.x;
  const relVY = liveVelocity.y - centerLiveVelocity.y;
  const relVZ = liveVelocity.z - centerLiveVelocity.z;
  const relDistanceSq = (relX * relX) + (relY * relY) + (relZ * relZ);
  if (!(relDistanceSq > 1e-8)) {
    return {
      x: liveCoords.x + (liveVelocity.x * dtSeconds),
      y: liveCoords.y + (liveVelocity.y * dtSeconds),
      z: liveCoords.z + (liveVelocity.z * dtSeconds),
    };
  }

  const mu = GRAVITATIONAL_CONSTANT_KM3_PER_KG_S2 * centerMassKg;
  const relDistance = Math.sqrt(relDistanceSq);
  const invR3 = 1 / Math.max(relDistance * relDistanceSq, 1e-12);
  const ax = -mu * relX * invR3;
  const ay = -mu * relY * invR3;
  const az = -mu * relZ * invR3;
  const dt2 = dtSeconds * dtSeconds;
  const nextRelX = relX + (relVX * dtSeconds) + (0.5 * ax * dt2);
  const nextRelY = relY + (relVY * dtSeconds) + (0.5 * ay * dt2);
  const nextRelZ = relZ + (relVZ * dtSeconds) + (0.5 * az * dt2);

  return {
    x: centerNowCoords.x + nextRelX,
    y: centerNowCoords.y + nextRelY,
    z: centerNowCoords.z + nextRelZ,
  };
}

function applyScenePositions(runtimeCoordsKm) {
  const deferredMoons = [];
  const sunCoords = runtimeCoordsKm.get("sun");
  const sunScenePos = finiteVectorKm(sunCoords)
    ? {
        x: sunCoords.x * DISTANCE_SCALE,
        y: sunCoords.z * DISTANCE_SCALE,
        z: sunCoords.y * DISTANCE_SCALE,
      }
    : null;
  const sunRenderRadius = bodyVisuals.get("sun")?.renderRadius ?? 0;

  for (const body of bodies) {
    const bodyId = body.id;
    const visual = bodyVisuals.get(bodyId);
    if (!visual) {
      continue;
    }
    const coordsKm = runtimeCoordsKm.get(bodyId) || positionsById.get(bodyId)?.coordinates_km;
    if (!finiteVectorKm(coordsKm)) {
      visual.root.visible = false;
      continue;
    }
    visual.root.visible = true;
    if (body.body_type === "moon" && body.parent) {
      deferredMoons.push([bodyId, body.parent, coordsKm]);
      continue;
    }

    let sceneX = coordsKm.x * DISTANCE_SCALE;
    let sceneY = coordsKm.z * DISTANCE_SCALE;
    let sceneZ = coordsKm.y * DISTANCE_SCALE;
    if (!Number.isFinite(sceneX) || !Number.isFinite(sceneY) || !Number.isFinite(sceneZ)) {
      visual.root.visible = false;
      continue;
    }

    if (!SCIENTIFIC_ACCURACY_MODE && body.body_type === "planet" && bodyId !== "sun" && sunScenePos) {
      const dx = sceneX - sunScenePos.x;
      const dy = sceneY - sunScenePos.y;
      const dz = sceneZ - sunScenePos.z;
      const distance = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
      const minDistance = sunRenderRadius + visual.renderRadius + MIN_PLANET_SUN_CLEARANCE;
      if (distance < minDistance) {
        if (distance < 1e-8) {
          sceneX = sunScenePos.x + minDistance;
          sceneY = sunScenePos.y;
          sceneZ = sunScenePos.z;
        } else {
          const boost = minDistance / distance;
          sceneX = sunScenePos.x + (dx * boost);
          sceneY = sunScenePos.y + (dy * boost);
          sceneZ = sunScenePos.z + (dz * boost);
        }
      }
    }

    visual.root.position.set(sceneX, sceneY, sceneZ);
  }

  const moonParentDistanceBoosts = computeMoonParentDistanceBoosts(deferredMoons, runtimeCoordsKm);

  for (const [bodyId, parentId, moonCoords] of deferredMoons) {
    const visual = bodyVisuals.get(bodyId);
    const parentVisual = bodyVisuals.get(parentId);
    const parentCoords = runtimeCoordsKm.get(parentId) || positionsById.get(parentId)?.coordinates_km;
    if (!visual) {
      continue;
    }
    if (!finiteVectorKm(moonCoords)) {
      visual.root.visible = false;
      continue;
    }
    visual.root.visible = true;
    if (parentVisual && finiteVectorKm(parentCoords) && vector3Finite(parentVisual.root?.position)) {
      const relX = moonCoords.x - parentCoords.x;
      const relY = moonCoords.y - parentCoords.y;
      const relZ = moonCoords.z - parentCoords.z;
      const moonDistanceScale = moonVisualDistanceScale(bodyId, parentId) * (moonParentDistanceBoosts.get(parentId) || 1);
      let relSceneX = relX * DISTANCE_SCALE * moonDistanceScale;
      let relSceneY = relZ * DISTANCE_SCALE * moonDistanceScale;
      let relSceneZ = relY * DISTANCE_SCALE * moonDistanceScale;
      if (!Number.isFinite(relSceneX) || !Number.isFinite(relSceneY) || !Number.isFinite(relSceneZ)) {
        visual.root.visible = false;
        continue;
      }
      const relDistance = Math.sqrt((relSceneX * relSceneX) + (relSceneY * relSceneY) + (relSceneZ * relSceneZ));
      const minClearance = (parentVisual.renderRadius + visual.renderRadius) * MIN_MOON_PARENT_CLEARANCE;
      if (relDistance < minClearance) {
        if (relDistance < 1e-8) {
          relSceneX = minClearance;
          relSceneY = 0;
          relSceneZ = 0;
        } else {
          const boost = minClearance / relDistance;
          relSceneX *= boost;
          relSceneY *= boost;
          relSceneZ *= boost;
        }
      }
      visual.root.position.set(
        parentVisual.root.position.x + relSceneX,
        parentVisual.root.position.y + relSceneY,
        parentVisual.root.position.z + relSceneZ,
      );
    } else {
      const moonSceneX = moonCoords.x * DISTANCE_SCALE;
      const moonSceneY = moonCoords.z * DISTANCE_SCALE;
      const moonSceneZ = moonCoords.y * DISTANCE_SCALE;
      if (!Number.isFinite(moonSceneX) || !Number.isFinite(moonSceneY) || !Number.isFinite(moonSceneZ)) {
        visual.root.visible = false;
        continue;
      }
      visual.root.position.set(
        moonSceneX,
        moonSceneY,
        moonSceneZ,
      );
    }
  }

  const sun = bodyVisuals.get("sun");
  if (sun && vector3Finite(sun.root?.position)) {
    sunLight.position.copy(sun.root.position);
  }

  if (observation.mode === OBSERVATION_MODES.BODY_LOCK && selectedId) {
    const selected = bodyVisuals.get(selectedId);
    if (selected) {
      const lockTarget = resolveBodyLockTargetPosition(selectedId);
      if (lockTarget) {
        orbit.target.copy(lockTarget);
      } else {
        orbit.target.copy(selected.root.position);
      }
    }
  }
}

function moonVisualDistanceScale(bodyId, parentId) {
  return bodyId === "moon" && parentId === "earth"
    ? MOON_ORBIT_VISUAL_SCALE * EARTH_MOON_VISUAL_DISTANCE_MULTIPLIER
    : MOON_ORBIT_VISUAL_SCALE;
}

function computeMoonParentDistanceBoosts(deferredMoons, runtimeCoordsKm) {
  const boosts = new Map();
  for (const [bodyId, parentId, moonCoords] of deferredMoons) {
    const visual = bodyVisuals.get(bodyId);
    const parentVisual = bodyVisuals.get(parentId);
    const parentCoords = runtimeCoordsKm.get(parentId) || positionsById.get(parentId)?.coordinates_km;
    if (!visual || !parentVisual || !finiteVectorKm(moonCoords) || !finiteVectorKm(parentCoords)) {
      continue;
    }

    const relX = moonCoords.x - parentCoords.x;
    const relY = moonCoords.y - parentCoords.y;
    const relZ = moonCoords.z - parentCoords.z;
    const baseScale = moonVisualDistanceScale(bodyId, parentId);
    const baseSceneX = relX * DISTANCE_SCALE * baseScale;
    const baseSceneY = relZ * DISTANCE_SCALE * baseScale;
    const baseSceneZ = relY * DISTANCE_SCALE * baseScale;
    const baseDistance = Math.sqrt((baseSceneX * baseSceneX) + (baseSceneY * baseSceneY) + (baseSceneZ * baseSceneZ));
    if (!(baseDistance > 1e-10)) {
      continue;
    }

    const minClearance = (parentVisual.renderRadius + visual.renderRadius) * MIN_MOON_PARENT_CLEARANCE;
    const neededBoost = minClearance / baseDistance;
    const currentBoost = boosts.get(parentId) || 1;
    if (neededBoost > currentBoost) {
      boosts.set(parentId, clamp(neededBoost, 1, 2000));
    }
  }
  return boosts;
}

function onPointerDown(event) {
  orbit.pointerDown = true;
  orbit.dragging = false;
  orbit.pointerStartX = event.clientX;
  orbit.pointerStartY = event.clientY;
  orbit.lastX = event.clientX;
  orbit.lastY = event.clientY;
}

function onPointerMove(event) {
  if (!orbit.pointerDown) {
    return;
  }

  const dx = event.clientX - orbit.lastX;
  const dy = event.clientY - orbit.lastY;
  orbit.lastX = event.clientX;
  orbit.lastY = event.clientY;

  const moved = Math.abs(event.clientX - orbit.pointerStartX) + Math.abs(event.clientY - orbit.pointerStartY);
  if (moved > 10) {
    orbit.dragging = true;
  }
  if (!orbit.dragging) {
    return;
  }

  if (observation.mode === OBSERVATION_MODES.SURFACE) {
    observation.surfaceYaw = normalizeAngle(observation.surfaceYaw - dx * orbit.rotateSpeed);
    observation.surfacePitch = clamp(
      observation.surfacePitch + (dy * orbit.rotateSpeed),
      SURFACE_OBSERVER_PITCH_MIN,
      SURFACE_OBSERVER_PITCH_MAX,
    );
    updateObservationStatus();
  } else {
    orbit.azimuth = normalizeAngle(orbit.azimuth - dx * orbit.rotateSpeed);
    orbit.polar = clamp(orbit.polar - dy * orbit.rotateSpeed, orbit.minPolar, orbit.maxPolar);
  }
  updateCameraFromOrbit();
}

function onPointerUp(event) {
  if (!orbit.pointerDown) {
    return;
  }

  const shouldSelect = !orbit.dragging;
  orbit.pointerDown = false;
  orbit.dragging = false;

  if (shouldSelect) {
    performRaycastSelection(event.clientX, event.clientY);
  }
}

function onPointerLeave() {
  orbit.pointerDown = false;
  orbit.dragging = false;
}

function markLegendInteractionGuard() {
  suppressCanvasSelectionUntilMs = Date.now() + LEGEND_SELECTION_GUARD_MS;
  orbit.pointerDown = false;
  orbit.dragging = false;
}

function setupLegendInputGuards() {
  if (!bodyLegend) {
    return;
  }
  bodyLegend.addEventListener("pointerenter", () => {
    pointerInsideLegend = true;
  });
  bodyLegend.addEventListener("pointerleave", () => {
    pointerInsideLegend = false;
  });
  bodyLegend.addEventListener("pointerdown", () => {
    pointerInsideLegend = true;
    markLegendInteractionGuard();
  });
}

function performRaycastSelection(clientX, clientY) {
  if (pointerInsideLegend) {
    return;
  }
  if (Date.now() < suppressCanvasSelectionUntilMs) {
    return;
  }
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return;
  }
  pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const pickMeshes = [];
  for (const visual of bodyVisuals.values()) {
    if (visual.pickMesh && visual.root?.visible) {
      pickMeshes.push(visual.pickMesh);
    }
  }
  const hits = raycaster.intersectObjects(pickMeshes, false);
  for (const hit of hits) {
    const hitId = findBodyIdFromHit(hit.object);
    if (hitId && metaById.has(hitId) && bodyVisuals.get(hitId)?.root?.visible) {
      setSelected(hitId, true);
      return;
    }
  }
}

function chooseBodyFromScreenProximity(clientX, clientY, bounds, candidateIds) {
  const localX = clientX - bounds.left;
  const localY = clientY - bounds.top;
  const viewportHeight = Math.max(bounds.height, 1);
  const viewportWidth = Math.max(bounds.width, 1);

  let bestId = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const [bodyId, visual] of bodyVisuals.entries()) {
    if (candidateIds && !candidateIds.has(bodyId)) {
      continue;
    }
    const centerNdc = visual.root.position.clone().project(camera);
    if (!Number.isFinite(centerNdc.x) || !Number.isFinite(centerNdc.y) || !Number.isFinite(centerNdc.z)) {
      continue;
    }
    if (centerNdc.z < -1 || centerNdc.z > 1) {
      continue;
    }

    const screenX = ((centerNdc.x + 1) * 0.5) * viewportWidth;
    const screenY = ((1 - centerNdc.y) * 0.5) * viewportHeight;
    const pixelDistance = Math.hypot(localX - screenX, localY - screenY);
    const projectedRadiusPx = projectedPickRadiusPx(visual, viewportHeight);
    const isSpacecraft = visual.body?.body_type === "spacecraft";
    const acceptancePx = isSpacecraft
      ? clamp(projectedRadiusPx * 0.95, 4, 28)
      : clamp(projectedRadiusPx * 1.08, MIN_PICK_PIXEL_RADIUS, MAX_PICK_PIXEL_RADIUS);
    if (pixelDistance > acceptancePx) {
      continue;
    }

    const score = pixelDistance / Math.max(acceptancePx, 1e-6);
    if (score < bestScore) {
      bestScore = score;
      bestId = bodyId;
    }
  }

  return bestId;
}

function projectedPickRadiusPx(visual, viewportHeight) {
  const pickRadiusWorld =
    visual.pickMesh?.geometry?.parameters?.radius ||
    Math.max(visual.renderRadius || 0, MIN_PICK_RADIUS);
  const distance = Math.max(camera.position.distanceTo(visual.root.position), 1e-4);
  const fovRad = rad(camera.fov);
  const pixelsPerWorldUnit = viewportHeight / Math.max(2 * Math.tan(fovRad * 0.5) * distance, 1e-6);
  return pickRadiusWorld * pixelsPerWorldUnit;
}

function findBodyIdFromHit(object) {
  let cursor = object;
  while (cursor) {
    if (cursor.userData && cursor.userData.bodyId) {
      return cursor.userData.bodyId;
    }
    cursor = cursor.parent;
  }
  return null;
}

function onWheel(event) {
  event.preventDefault();
  if (observation.mode === OBSERVATION_MODES.SURFACE) {
    const nextScale = observation.surfaceAltitudeScale * Math.exp(event.deltaY * 0.00135);
    observation.surfaceAltitudeScale = clamp(nextScale, 0.12, 120);
    updateObservationStatus();
    updateCameraFromOrbit();
    return;
  }
  const zoomFactor = clamp(1 + Math.log10(orbit.radius + 1), 0.55, 3.2);
  let adaptiveSpeed = orbit.wheelSpeed * zoomFactor;
  if (observation.mode === OBSERVATION_MODES.BODY_LOCK && selectedId) {
    const selectedVisual = bodyVisuals.get(selectedId);
    if (String(selectedVisual?.body?.body_type || "").toLowerCase() === "spacecraft") {
      adaptiveSpeed *= SPACECRAFT_WHEEL_ZOOM_MULTIPLIER;
    }
  }
  const next = orbit.radius * Math.exp(event.deltaY * adaptiveSpeed);
  orbit.radius = clamp(next, orbit.minDistance, orbit.maxDistance);
  if (observation.mode === OBSERVATION_MODES.BODY_LOCK && selectedId && orbit.radius >= OVERVIEW_SWITCH_RADIUS) {
    const sunVisual = bodyVisuals.get("sun");
    if (sunVisual) {
      selectedId = null;
      gravityArrowFocusBodyId = null;
      gravityArrowsLegendActivated = false;
      updateLegendSelection();
      updateLegendGravityArrowIndicators();
      updateGravityVectors();
      updateObservationStatus();
      orbit.minDistance = ORBIT_MIN_DISTANCE_BASE;
      orbit.target.copy(sunVisual.root.position);
    }
  }
  updateCameraFromOrbit();
}

function minOrbitDistanceForVisual(visual) {
  if (!visual || !(visual.renderRadius > 0)) {
    return ORBIT_MIN_DISTANCE_BASE;
  }
  if (visual.body?.id === "moon") {
    const moonClearanceScene = MOON_SURFACE_CAMERA_CLEARANCE_KM * DISTANCE_SCALE;
    return Math.max(
      ORBIT_MIN_DISTANCE_ABSOLUTE,
      visual.renderRadius + moonClearanceScene,
    );
  }
  if (visual.body?.id === "earth") {
    const earthClearanceScene = EARTH_SURFACE_CAMERA_CLEARANCE_KM * DISTANCE_SCALE;
    return Math.max(
      ORBIT_MIN_DISTANCE_ABSOLUTE,
      visual.renderRadius + earthClearanceScene,
    );
  }
  const bodyType = String(visual?.body?.body_type || "").toLowerCase();
  if (bodyType === "spacecraft") {
    return spacecraftMinOrbitDistanceScene({
      distanceScale: DISTANCE_SCALE,
      renderRadius: Number(visual.renderRadius) || 0,
      bodyRadiusKm: Number(visual?.body?.radius_km),
      stackHeightKm: INLINE_STARSHIP_STACK_TOTAL_HEIGHT_KM,
    });
  }
  const radiusFactor = ORBIT_MIN_DISTANCE_RADIUS_FACTOR;
  return Math.max(
    ORBIT_MIN_DISTANCE_ABSOLUTE,
    visual.renderRadius * radiusFactor,
  );
}

function minCameraDistanceFromBodyCenter(visual) {
  if (!visual || !(visual.renderRadius > 0)) {
    return ORBIT_MIN_DISTANCE_ABSOLUTE;
  }
  if (visual.body?.id === "moon") {
    return visual.renderRadius + (MOON_SURFACE_CAMERA_CLEARANCE_KM * DISTANCE_SCALE);
  }
  if (visual.body?.id === "earth") {
    const selectedVisual = selectedId ? bodyVisuals.get(selectedId) : null;
    const trackingSpacecraft = String(selectedVisual?.body?.body_type || "").toLowerCase() === "spacecraft";
    const earthClearanceKm = trackingSpacecraft
      ? EARTH_SURFACE_CAMERA_CLEARANCE_WHEN_SPACECRAFT_SELECTED_KM
      : EARTH_SURFACE_CAMERA_CLEARANCE_KM;
    return visual.renderRadius + (earthClearanceKm * DISTANCE_SCALE);
  }
  return Math.max(
    ORBIT_MIN_DISTANCE_ABSOLUTE,
    visual.renderRadius * ORBIT_MIN_DISTANCE_RADIUS_FACTOR,
  );
}

function shouldRelaxEarthCameraCollision() {
  if (!selectedId || !THREE_NS) {
    return false;
  }
  if (selectedId !== LAUNCH_BODY_ID && selectedId !== LAUNCH_BOOSTER_BODY_ID) {
    return false;
  }
  const earthVisual = bodyVisuals.get("earth");
  const selectedVisual = bodyVisuals.get(selectedId);
  if (!earthVisual?.root?.position || !(earthVisual.renderRadius > 0) || !selectedVisual?.root?.position) {
    return false;
  }
  const selectedAltitudeScene = selectedVisual.root.position.distanceTo(earthVisual.root.position) - earthVisual.renderRadius;
  return selectedAltitudeScene <= (2 * DISTANCE_SCALE);
}

function clampCameraOutsideBody(cameraPosition, bodyVisual) {
  if (!cameraPosition?.isVector3 || !bodyVisual?.root?.position || !(bodyVisual.renderRadius > 0) || !THREE_NS) {
    return;
  }
  if (bodyVisual.body?.id === "earth" && shouldRelaxEarthCameraCollision()) {
    return;
  }
  const minDistance = minCameraDistanceFromBodyCenter(bodyVisual);
  const center = bodyVisual.root.position;
  const offset = cameraPosition.clone().sub(center);
  const dist = offset.length();
  if (dist >= minDistance) {
    return;
  }
  if (dist <= 1e-12) {
    cameraPosition.copy(center).add(new THREE_NS.Vector3(0, minDistance, 0));
    return;
  }
  cameraPosition.copy(center).addScaledVector(offset, minDistance / dist);
}

function nearestSurfaceClearanceAtCamera(cameraPosition) {
  if (!cameraPosition?.isVector3) {
    return null;
  }
  let nearestClearance = Number.POSITIVE_INFINITY;
  for (const bodyId of ["earth", "moon"]) {
    const visual = bodyVisuals.get(bodyId);
    if (!visual?.root?.position || !(visual.renderRadius > 0)) {
      continue;
    }
    const clearance = cameraPosition.distanceTo(visual.root.position) - visual.renderRadius;
    if (!Number.isFinite(clearance)) {
      continue;
    }
    const safeClearance = Math.max(clearance, ORBIT_MIN_DISTANCE_ABSOLUTE);
    if (safeClearance < nearestClearance) {
      nearestClearance = safeClearance;
    }
  }
  return Number.isFinite(nearestClearance) ? nearestClearance : null;
}

function preferredCameraDistanceForSelection(visual) {
  if (!visual?.body) {
    return orbit.radius;
  }

  const body = visual.body;
  const nearSurface = minOrbitDistanceForVisual(visual);
  if (body.id === "sun") {
    return clamp(
      Math.max(visual.renderRadius * 2.3, 1.3),
      nearSurface,
      orbit.maxDistance,
    );
  }

  if (body.body_type === "planet") {
    return clamp(
      Math.max(visual.renderRadius * 2.55, 0.035),
      nearSurface,
      orbit.maxDistance,
    );
  }

  if (body.body_type === "spacecraft") {
    return clamp(
      spacecraftPreferredCameraDistanceScene({
        distanceScale: DISTANCE_SCALE,
        renderRadius: Number(visual.renderRadius) || 0,
        bodyRadiusKm: Number(visual?.body?.radius_km),
        stackHeightKm: INLINE_STARSHIP_STACK_TOTAL_HEIGHT_KM,
        nearSurface,
      }),
      nearSurface,
      orbit.maxDistance,
    );
  }

  return clamp(
    Math.max(visual.renderRadius * 3.0, 0.004),
    nearSurface,
    orbit.maxDistance,
  );
}

function resolveBodyLockTargetPosition(bodyId) {
  const visual = bodyVisuals.get(bodyId);
  if (!visual) {
    return null;
  }
  const target = visual.root.position.clone();
  if (bodyId !== LAUNCH_BODY_ID || !THREE_NS) {
    return target;
  }
  if (missionControlScreenController?.isVisible?.()) {
    return target;
  }
  const boosterDetachedAvailable = hasVisibleBodyState(LAUNCH_BOOSTER_BODY_ID);
  if (boosterDetachedAvailable) {
    return target;
  }
  const spinGroup = visual.spinGroup;
  if (!spinGroup) {
    return target;
  }
  const worldQuat = new THREE_NS.Quaternion();
  spinGroup.getWorldQuaternion(worldQuat);
  const stackAxis = new THREE_NS.Vector3(0, 1, 0).applyQuaternion(worldQuat).normalize();
  const stackHalfHeightScene = (INLINE_STARSHIP_STACK_TOTAL_HEIGHT_KM * DISTANCE_SCALE) * 0.5;
  const offsetMagnitude = Math.max(visual.renderRadius * 0.52, stackHalfHeightScene * 0.9);
  if (launchVehicleViewPreference === "booster") {
    target.addScaledVector(stackAxis, -offsetMagnitude);
  } else {
    target.addScaledVector(stackAxis, offsetMagnitude * 0.38);
  }
  return target;
}

function syncLaunchVehicleViewSelection() {
  if (observation.mode !== OBSERVATION_MODES.BODY_LOCK) {
    return;
  }
  if (launchVehicleViewPreference !== "booster") {
    return;
  }
  if (selectedId !== LAUNCH_BODY_ID) {
    return;
  }
  if (!hasVisibleBodyState(LAUNCH_BOOSTER_BODY_ID)) {
    return;
  }
  setSelected(LAUNCH_BOOSTER_BODY_ID, false);
}

function setSelected(bodyId, moveCamera) {
  const selectionChanged = selectedId !== bodyId;
  selectedId = bodyId;
  if (selectionChanged) {
    gravityArrowFocusBodyId = bodyId;
    gravityArrowsLegendActivated = false;
  }
  updateLegendSelection();
  updateLegendGravityArrowIndicators();
  updateGravityVectors();
  const visual = bodyVisuals.get(bodyId);
  if (!visual) {
    return;
  }

  const liveCoords = runtimeCoordsOrLiveById(bodyId);
  const canReframe = observation.mode === OBSERVATION_MODES.BODY_LOCK;
  if (canReframe) {
    orbit.minDistance = minOrbitDistanceForVisual(visual);
    orbit.radius = clamp(orbit.radius, orbit.minDistance, orbit.maxDistance);
    if (liveCoords) {
      const lockTarget = resolveBodyLockTargetPosition(bodyId);
      if (lockTarget) {
        orbit.target.copy(lockTarget);
      } else {
        orbit.target.copy(visual.root.position);
      }
    }
  }
  if (moveCamera && canReframe) {
    if (liveCoords) {
      orbit.radius = preferredCameraDistanceForSelection(visual);
      const bodyType = String(visual?.body?.body_type || "").toLowerCase();
      if (bodyType === "spacecraft") {
        const targetForView = resolveBodyLockTargetPosition(bodyId) || visual.root.position;
        const earthScene = bodyVisuals.get("earth")?.root?.position || null;
        const orbitAngles = spacecraftEarthRelativeOrbitAngles({
          targetScene: targetForView,
          earthScene,
        });
        if (orbitAngles) {
          orbit.azimuth = orbitAngles.azimuth;
          orbit.polar = clamp(orbitAngles.polar, orbit.minPolar, orbit.maxPolar);
        } else {
          orbit.polar = clamp(rad(84), orbit.minPolar, orbit.maxPolar);
        }
      } else {
        orbit.polar = clamp(rad(84), orbit.minPolar, orbit.maxPolar);
      }
    }
  }
  updateObservationStatus();
  updateCameraFromOrbit();
}

function resolveSurfaceObserverAnchor(nowMs = Date.now()) {
  const preset = getSurfaceObserverPreset(observation.surfacePresetId);
  if (!preset) {
    return null;
  }
  if (preset.kind === "orbital") {
    return resolveOrbitalObserverAnchor(preset, nowMs);
  }
  return resolveSurfaceObserverAnchorOnBody(preset);
}

function resolveSurfaceObserverAnchorOnBody(preset) {
  const visual = bodyVisuals.get(preset.bodyId);
  if (!visual || !visual.root.visible) {
    return null;
  }
  const altitudeKm = Math.max(0.02, Number(preset.altitudeKm) || 1) * observation.surfaceAltitudeScale;
  const altitudeScene = altitudeKm * DISTANCE_SCALE;
  const radius = Math.max(visual.renderRadius + altitudeScene, visual.renderRadius * 1.0015);
  const latitudeDeg = Number(preset.latitudeDeg) || 0;
  const longitudeDeg = Number(preset.longitudeDeg) || 0;
  const latRad = rad(clamp(latitudeDeg, -90, 90));
  const lonRad = rad(longitudeDeg);

  const upLocal = latLonToEarthVector(latitudeDeg, longitudeDeg, 1).normalize();
  const positionLocal = upLocal.clone().multiplyScalar(radius);
  const eastLocal = new THREE_NS.Vector3(
    -Math.sin(lonRad),
    0,
    -Math.cos(lonRad),
  ).normalize();
  const northLocal = new THREE_NS.Vector3(
    -Math.sin(latRad) * Math.cos(lonRad),
    Math.cos(latRad),
    Math.sin(latRad) * Math.sin(lonRad),
  ).normalize();

  const worldQuat = new THREE_NS.Quaternion();
  visual.spinGroup.getWorldQuaternion(worldQuat);
  const upWorld = upLocal.clone().applyQuaternion(worldQuat).normalize();
  const eastWorld = eastLocal.clone().applyQuaternion(worldQuat).normalize();
  const northWorld = northLocal.clone().applyQuaternion(worldQuat).normalize();

  const position = positionLocal.clone();
  visual.spinGroup.localToWorld(position);
  const cameraPosition = position.clone().addScaledVector(upWorld, Math.max(radius * 0.0024, 0.000005));

  let heading = eastWorld.clone().applyAxisAngle(upWorld, observation.surfaceYaw).normalize();
  if (heading.lengthSq() < 1e-10) {
    heading = northWorld.clone();
  }
  let right = new THREE_NS.Vector3().crossVectors(heading, upWorld).normalize();
  if (right.lengthSq() < 1e-10) {
    right = new THREE_NS.Vector3().crossVectors(northWorld, upWorld).normalize();
  }
  const forward = heading.clone().applyAxisAngle(right, observation.surfacePitch).normalize();
  const lookDistance = Math.max(visual.renderRadius * 9, altitudeScene * 12, 0.035);
  const target = cameraPosition.clone().addScaledVector(forward, lookDistance);

  return {
    label: preset.label,
    bodyId: preset.bodyId,
    altitudeKm,
    position: cameraPosition,
    target,
    up: upWorld,
  };
}

function resolveOrbitalObserverAnchor(preset, nowMs) {
  const earthVisual = bodyVisuals.get(preset.bodyId || "earth");
  if (!earthVisual || !earthVisual.root.visible) {
    return null;
  }
  const periodMs = Math.max(1, (Number(preset.periodMinutes) || 92.68) * 60 * 1000);
  const epochMs = Number.isFinite(Date.parse(preset.epochIso || "")) ? Date.parse(preset.epochIso) : 0;
  const phase = rad(Number(preset.phaseDeg) || 0);
  const theta = normalizeAngle((((nowMs - epochMs) / periodMs) * Math.PI * 2) + phase);
  const inclination = rad(Number(preset.inclinationDeg) || 51.64);
  const altitudeKm = Math.max(80, Number(preset.altitudeKm) || 420) * observation.surfaceAltitudeScale;
  const radius = Math.max(earthVisual.renderRadius + (altitudeKm * DISTANCE_SCALE), earthVisual.renderRadius * 1.01);
  const raan = rad(Number(preset.raanDeg) || 0);

  const positionLocal = new THREE_NS.Vector3(
    radius * Math.cos(theta),
    radius * Math.sin(theta) * Math.sin(inclination),
    -radius * Math.sin(theta) * Math.cos(inclination),
  ).applyAxisAngle(new THREE_NS.Vector3(0, 1, 0), raan);

  const tangentLocal = new THREE_NS.Vector3(
    -Math.sin(theta),
    Math.cos(theta) * Math.sin(inclination),
    -Math.cos(theta) * Math.cos(inclination),
  ).normalize().applyAxisAngle(new THREE_NS.Vector3(0, 1, 0), raan);

  const worldQuat = new THREE_NS.Quaternion();
  earthVisual.tiltGroup.getWorldQuaternion(worldQuat);

  const position = positionLocal.clone();
  earthVisual.tiltGroup.localToWorld(position);
  const upWorld = position.clone().sub(earthVisual.root.position).normalize();
  const cameraPosition = position.clone().addScaledVector(upWorld, Math.max(radius * 0.0011, 0.000004));

  let forward = tangentLocal.clone().applyQuaternion(worldQuat).normalize();
  forward.applyAxisAngle(upWorld, observation.surfaceYaw);
  let right = new THREE_NS.Vector3().crossVectors(forward, upWorld).normalize();
  if (right.lengthSq() < 1e-10) {
    right = new THREE_NS.Vector3(1, 0, 0).applyQuaternion(worldQuat).normalize();
  }
  forward = forward.applyAxisAngle(right, observation.surfacePitch).normalize();
  const lookDistance = Math.max(earthVisual.renderRadius * 16, radius * 0.12, 0.06);
  const target = cameraPosition.clone().addScaledVector(forward, lookDistance);

  return {
    label: preset.label,
    bodyId: preset.bodyId || "earth",
    altitudeKm,
    position: cameraPosition,
    target,
    up: upWorld,
  };
}

function updateCameraFromOrbit() {
  if (!camera || !orbit.target) {
    return;
  }

  if (observation.mode === OBSERVATION_MODES.SURFACE) {
    const anchor = resolveSurfaceObserverAnchor(Date.now());
    if (anchor) {
      const lookDistance = Math.max(anchor.position.distanceTo(anchor.target), 1e-6);
      const desiredNear = clamp(lookDistance * 0.015, 0.00000002, 0.008);
      if (Math.abs((camera.near || 0) - desiredNear) > desiredNear * 0.1) {
        camera.near = desiredNear;
        camera.updateProjectionMatrix();
      }
      camera.up.copy(anchor.up);
      camera.position.copy(anchor.position);
      camera.lookAt(anchor.target);
      updateObservationStatus(anchor);
      return;
    }
  }

  if (observation.mode === OBSERVATION_MODES.BODY_LOCK && selectedId) {
    const selectedVisual = bodyVisuals.get(selectedId);
    if (selectedVisual?.renderRadius > 0) {
      orbit.minDistance = minOrbitDistanceForVisual(selectedVisual);
      orbit.radius = clamp(orbit.radius, orbit.minDistance, orbit.maxDistance);
    }
  }

  const sinPolar = Math.sin(orbit.polar);
  camera.position.set(
    orbit.target.x + orbit.radius * sinPolar * Math.sin(orbit.azimuth),
    orbit.target.y + orbit.radius * Math.cos(orbit.polar),
    orbit.target.z + orbit.radius * sinPolar * Math.cos(orbit.azimuth),
  );
  clampCameraOutsideBody(camera.position, bodyVisuals.get("earth"));
  clampCameraOutsideBody(camera.position, bodyVisuals.get("moon"));

  let nearFactor = 0.008;
  if (selectedId) {
    const selectedVisual = bodyVisuals.get(selectedId);
    if (selectedVisual?.body?.body_type === "spacecraft") {
      nearFactor = 0.0012;
    } else if ((selectedVisual?.renderRadius > 0) && orbit.radius < selectedVisual.renderRadius * 8) {
      nearFactor = 0.0024;
    }
  }
  const desiredNearFromOrbit = orbit.radius * nearFactor;
  const nearestSurfaceClearance = nearestSurfaceClearanceAtCamera(camera.position);
  const desiredNear = clamp(
    nearestSurfaceClearance !== null
      ? Math.min(desiredNearFromOrbit, nearestSurfaceClearance * 0.42)
      : desiredNearFromOrbit,
    0.0000000005,
    0.05,
  );
  if (Math.abs((camera.near || 0) - desiredNear) > desiredNear * 0.1) {
    camera.near = desiredNear;
    camera.updateProjectionMatrix();
  }

  camera.up.set(0, 1, 0);
  camera.lookAt(orbit.target);
}

function connectWebSocket() {
  if (HORIZONS_STARTUP_FETCH_ONLY) {
    return;
  }
  if (socket) {
    socket.__manualClose = true;
    socket.close();
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(
    `${protocol}://${window.location.host}/ws/positions?include_moons=${INCLUDE_MOONS}&interval=${WS_INTERVAL_SECONDS}`,
  );
  socket = ws;

  ws.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      updatePositions(payload, "stream");
    } catch (error) {
      console.warn("[solar-system] Failed to parse live payload:", error);
    }
  });

  ws.addEventListener("close", () => {
    if (ws.__manualClose) {
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWebSocket, 2500);
  });

  ws.addEventListener("error", () => {
    if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });
}

function updateOrbitVisualAnchorsAndPhase() {
  if (orbitVisuals.size === 0) {
    return;
  }

  const sunScenePos = bodyVisuals.get("sun")?.root.position || new THREE_NS.Vector3(0, 0, 0);
  const sunLive = positionsById.get("sun")?.coordinates_km || { x: 0, y: 0, z: 0 };

  for (const [bodyId, orbitVisual] of orbitVisuals.entries()) {
    orbitVisual.group.position.copy(sunScenePos);

    const bodyLive = positionsById.get(bodyId)?.coordinates_km;
    if (!bodyLive) {
      continue;
    }
    const relX = (bodyLive.x - sunLive.x) * DISTANCE_SCALE;
    const relZ = (bodyLive.y - sunLive.y) * DISTANCE_SCALE;
    syncOrbitPhaseToLivePosition(orbitVisual, relX, relZ, latestSolarTimestampMs);
    updateOrbitMarkerFromTime(orbitVisual, latestSolarTimestampMs);
  }
}

function syncOrbitPhaseToLivePosition(orbitVisual, relX, relZ, timestampMs) {
  if (!(orbitVisual.a > 0) || !(orbitVisual.b > 0)) {
    return;
  }
  const invRot = rotateXZ(relX, relZ, -orbitVisual.omega);
  const cosE = clamp((invRot.x / orbitVisual.a) + orbitVisual.e, -1, 1);
  const sinE = clamp(invRot.z / orbitVisual.b, -1, 1);
  const E = Math.atan2(sinE, cosE);
  const meanAnomaly = normalizeAngle(E - (orbitVisual.e * Math.sin(E)));
  orbitVisual.baseMeanAnomaly = meanAnomaly;
  orbitVisual.baseTimestampMs = timestampMs;
  orbitVisual.initialized = true;
}

function currentMeanAnomaly(orbitVisual, nowMs) {
  if (!orbitVisual.initialized || !(orbitVisual.periodSeconds > 0)) {
    return 0;
  }
  const dtSeconds = (nowMs - orbitVisual.baseTimestampMs) / 1000;
  const n = (Math.PI * 2) / orbitVisual.periodSeconds;
  return normalizeAngle(orbitVisual.baseMeanAnomaly + (n * dtSeconds));
}

function updateOrbitMarkerFromTime(orbitVisual, nowMs) {
  if (!orbitVisual.initialized || !orbitVisual.marker) {
    return;
  }
  const M = currentMeanAnomaly(orbitVisual, nowMs);
  const E = solveKepler(M, orbitVisual.e);
  const xLocal = orbitVisual.a * (Math.cos(E) - orbitVisual.e);
  const zLocal = orbitVisual.b * Math.sin(E);
  const rotated = rotateXZ(xLocal, zLocal, orbitVisual.omega);
  orbitVisual.marker.position.set(rotated.x, 0, rotated.z);
}

function spinScaleForBody(body) {
  const overrideScale = Number(ROTATION_TIME_SCALE_OVERRIDE?.[body?.id]);
  if (overrideScale > 0) {
    return overrideScale;
  }
  if (body?.body_type === "moon") {
    return SPIN_TIME_SCALE * MOON_SPIN_VISUAL_BOOST;
  }
  return SPIN_TIME_SCALE;
}

function gatherVisualMaterials(visual) {
  const materials = new Set();
  if (!visual) {
    return materials;
  }
  if (visual.lod?.levels) {
    for (const level of visual.lod.levels) {
      const material = level?.object?.material;
      if (Array.isArray(material)) {
        for (const entry of material) {
          if (entry) {
            materials.add(entry);
          }
        }
      } else if (material) {
        materials.add(material);
      }
    }
  }
  if (visual.cloudMesh?.material) {
    materials.add(visual.cloudMesh.material);
  }
  if (visual.ringMesh?.material) {
    materials.add(visual.ringMesh.material);
  }
  if (Array.isArray(visual.extraMaterials)) {
    for (const material of visual.extraMaterials) {
      if (material) {
        materials.add(material);
      }
    }
  }
  return materials;
}

function ensureMaterialSunlightBaseline(material) {
  if (!material) {
    return;
  }
  if (!material.userData) {
    material.userData = {};
  }
  if (!material.userData.sunlightBaseColor && material.color?.isColor) {
    material.userData.sunlightBaseColor = material.color.clone();
  }
  if (
    material.userData.sunlightBaseEmissiveIntensity === undefined &&
    typeof material.emissiveIntensity === "number"
  ) {
    material.userData.sunlightBaseEmissiveIntensity = material.emissiveIntensity;
  }
}

function shouldApplyOcclusionPair(targetBody, occluderBody) {
  if (!targetBody || !occluderBody) {
    return false;
  }
  if (targetBody.id === occluderBody.id) {
    return false;
  }
  return true;
}

function runtimeCoordsOrLiveById(bodyId) {
  const coords = runtimeCoordsKmById.get(bodyId)
    || nBodyCoordinatesKmById(bodyId)
    || positionsById.get(bodyId)?.coordinates_km
    || null;
  return finiteVectorKm(coords) ? coords : null;
}

function runtimeVelocityKmSOrLiveById(bodyId) {
  const velocity = nBodyVelocityKmSById(bodyId) || positionsById.get(bodyId)?.coordinates_velocity_km_s || null;
  return finiteVectorKm(velocity) ? velocity : null;
}

function lightCoordsById(bodyId) {
  const coords = runtimeCoordsKmById.get(bodyId)
    || nBodyCoordinatesKmById(bodyId)
    || positionsById.get(bodyId)?.coordinates_km
    || null;
  return finiteVectorKm(coords) ? coords : null;
}

function bodyRadiusKmById(bodyId) {
  return Number(metaById.get(bodyId)?.radius_km) || 0;
}

function solarFluxScaleAtDistanceKm(distanceKm) {
  if (!(distanceKm > 0)) {
    return 0;
  }
  const ratio = AU_KM / distanceKm;
  return ratio * ratio;
}

function diskOverlapArea(r1, r2, d) {
  if (!(r1 > 0) || !(r2 > 0)) {
    return 0;
  }
  if (d >= r1 + r2) {
    return 0;
  }
  if (d <= Math.abs(r1 - r2)) {
    return Math.PI * Math.min(r1, r2) * Math.min(r1, r2);
  }
  const r1Sq = r1 * r1;
  const r2Sq = r2 * r2;
  const dSq = d * d;
  const alpha = Math.acos(clamp((dSq + r1Sq - r2Sq) / Math.max(2 * d * r1, 1e-12), -1, 1));
  const beta = Math.acos(clamp((dSq + r2Sq - r1Sq) / Math.max(2 * d * r2, 1e-12), -1, 1));
  const term = Math.max((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2), 0);
  const lens = 0.5 * Math.sqrt(term);
  return (r1Sq * alpha) + (r2Sq * beta) - lens;
}

function visibleSunDiskFraction(sunAngularRadius, occluderAngularRadius, angularSeparation) {
  if (!(sunAngularRadius > 0) || !(occluderAngularRadius > 0)) {
    return 1;
  }
  const overlap = diskOverlapArea(sunAngularRadius, occluderAngularRadius, Math.max(angularSeparation, 0));
  const sunArea = Math.PI * sunAngularRadius * sunAngularRadius;
  if (!(sunArea > 0)) {
    return 1;
  }
  return clamp(1 - (overlap / sunArea), 0, 1);
}

function computeSolarTransmittance(bodyId, targetCoordsKm, sunCoordsKm) {
  const targetMeta = metaById.get(bodyId);
  if (!targetMeta || !targetCoordsKm || !sunCoordsKm) {
    return 1;
  }
  const sunRadiusKm = bodyRadiusKmById("sun");
  if (!(sunRadiusKm > 0)) {
    return 1;
  }

  const sx = sunCoordsKm.x - targetCoordsKm.x;
  const sy = sunCoordsKm.y - targetCoordsKm.y;
  const sz = sunCoordsKm.z - targetCoordsKm.z;
  const sunDistance = Math.sqrt((sx * sx) + (sy * sy) + (sz * sz));
  if (!(sunDistance > 1e-8)) {
    return 1;
  }
  const sunAngularRadius = Math.asin(clamp(sunRadiusKm / sunDistance, -1, 1));
  if (!(sunAngularRadius > 0)) {
    return 1;
  }

  const dirX = sx / sunDistance;
  const dirY = sy / sunDistance;
  const dirZ = sz / sunDistance;
  let transmittance = 1;

  for (const [occluderId, occluderMeta] of metaById.entries()) {
    if (occluderId === "sun" || occluderId === bodyId || !shouldApplyOcclusionPair(targetMeta, occluderMeta)) {
      continue;
    }
    const occluderCoords = runtimeCoordsOrLiveById(occluderId);
    if (!occluderCoords) {
      continue;
    }
    const occluderRadiusKm = Number(occluderMeta.radius_km);
    if (!(occluderRadiusKm > 0)) {
      continue;
    }

    const rx = occluderCoords.x - targetCoordsKm.x;
    const ry = occluderCoords.y - targetCoordsKm.y;
    const rz = occluderCoords.z - targetCoordsKm.z;
    const projection = (rx * dirX) + (ry * dirY) + (rz * dirZ);
    if (!(projection > 0) || !(projection < sunDistance)) {
      continue;
    }

    const radialSq = Math.max((rx * rx) + (ry * ry) + (rz * rz) - (projection * projection), 0);
    const radialDistance = Math.sqrt(radialSq);
    const angularSeparation = Math.atan2(radialDistance, projection);
    const occluderAngularRadius = Math.asin(clamp(occluderRadiusKm / projection, -1, 1));
    if (!(occluderAngularRadius > 0)) {
      continue;
    }

    let localTransmittance = visibleSunDiskFraction(
      sunAngularRadius,
      occluderAngularRadius,
      angularSeparation,
    );
    transmittance = Math.min(transmittance, localTransmittance);
    if (transmittance <= 1e-6) {
      return 0;
    }
  }
  return clamp(transmittance, 0, 1);
}

function computeEarthshineScaleForMoon(moonCoordsKm, sunCoordsKm) {
  const earthCoordsKm = lightCoordsById("earth");
  if (!earthCoordsKm || !moonCoordsKm || !sunCoordsKm) {
    return 0;
  }
  const earthRadiusKm = bodyRadiusKmById("earth");
  if (!(earthRadiusKm > 0)) {
    return 0;
  }

  const emX = moonCoordsKm.x - earthCoordsKm.x;
  const emY = moonCoordsKm.y - earthCoordsKm.y;
  const emZ = moonCoordsKm.z - earthCoordsKm.z;
  const earthMoonDistance = Math.sqrt((emX * emX) + (emY * emY) + (emZ * emZ));
  if (!(earthMoonDistance > 0)) {
    return 0;
  }

  const esX = sunCoordsKm.x - earthCoordsKm.x;
  const esY = sunCoordsKm.y - earthCoordsKm.y;
  const esZ = sunCoordsKm.z - earthCoordsKm.z;
  const earthSunDistance = Math.sqrt((esX * esX) + (esY * esY) + (esZ * esZ));
  if (!(earthSunDistance > 0)) {
    return 0;
  }

  const invEs = 1 / earthSunDistance;
  const invEm = 1 / earthMoonDistance;
  const uxEs = esX * invEs;
  const uyEs = esY * invEs;
  const uzEs = esZ * invEs;
  const uxEm = emX * invEm;
  const uyEm = emY * invEm;
  const uzEm = emZ * invEm;
  const earthPhaseFromMoon = clamp((1 + ((uxEs * uxEm) + (uyEs * uyEm) + (uzEs * uzEm))) / 2, 0, 1);

  const solarAtEarth = solarFluxScaleAtDistanceKm(earthSunDistance);
  const geometricScale = (earthRadiusKm * earthRadiusKm) / (earthMoonDistance * earthMoonDistance);
  return EARTHSHINE_LAMBERT_FACTOR * EARTH_BOND_ALBEDO * solarAtEarth * geometricScale * earthPhaseFromMoon;
}

function computeGravityById() {
  const targetBodies = [];
  const sourceBodies = [];
  for (const body of bodies) {
    const coords = runtimeCoordsOrLiveById(body.id);
    if (!coords) {
      continue;
    }
    const x = Number(coords.x);
    const y = Number(coords.y);
    const z = Number(coords.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }
    targetBodies.push({
      id: body.id,
      x,
      y,
      z,
    });
    const massKg = bodyMassKgById(body.id);
    if (massKg > 0) {
      sourceBodies.push({
        id: body.id,
        massKg,
        x,
        y,
        z,
      });
    }
  }
  const oblateSourceContextById = buildOblateSourceContextMapFromIds(
    sourceBodies.map((source) => source.id),
    Date.now(),
  );
  const sourceBodiesById = new Map();
  for (const source of sourceBodies) {
    sourceBodiesById.set(source.id, source);
  }
  const sourceEnvironment = {
    getBodyState: (sourceId) => sourceBodiesById.get(sourceId) || null,
  };

  const nextGravity = new Map();
  for (const target of targetBodies) {
    let ax = 0;
    let ay = 0;
    let az = 0;
    let dominantBodyId = null;
    let dominantContributionKmS2 = 0;

    for (const source of sourceBodies) {
      if (source.id === target.id) {
        continue;
      }
      const contribution = computeGravityAccelerationFromSource(
        target,
        source.id,
        source.massKg,
        source,
        oblateSourceContextById,
        sourceEnvironment,
      );
      const cax = contribution.x;
      const cay = contribution.y;
      const caz = contribution.z;
      const contributionKmS2 = Math.sqrt((cax * cax) + (cay * cay) + (caz * caz));
      if (contributionKmS2 > dominantContributionKmS2) {
        dominantContributionKmS2 = contributionKmS2;
        dominantBodyId = source.id;
      }
      ax += cax;
      ay += cay;
      az += caz;
    }

    const magnitudeKmS2 = Math.sqrt((ax * ax) + (ay * ay) + (az * az));
    nextGravity.set(target.id, {
      axKmS2: ax,
      ayKmS2: ay,
      azKmS2: az,
      magnitudeKmS2,
      magnitudeMS2: magnitudeKmS2 * 1000,
      dominantBodyId,
      dominantContributionMS2: dominantContributionKmS2 * 1000,
    });
  }
  return nextGravity;
}

function gravityArrowLengthForAccelerationMs2(accelerationMS2, bodyRenderRadius = 0) {
  if (!(accelerationMS2 > 0)) {
    return Math.max(GRAVITY_VECTOR_MIN_LENGTH, bodyRenderRadius * 0.28);
  }
  const normalized = Math.sqrt(Math.max(accelerationMS2 / GRAVITY_VECTOR_BASELINE_MS2, 0));
  const scaled = normalized * 0.42;
  const bodyMin = Math.max(GRAVITY_VECTOR_MIN_LENGTH, bodyRenderRadius * 0.28);
  return clamp(Math.max(scaled, bodyMin), GRAVITY_VECTOR_MIN_LENGTH, GRAVITY_VECTOR_MAX_LENGTH);
}

function updateGravityVectors() {
  if (!GRAVITY_VECTORS_ENABLED || !THREE_NS) {
    gravityById = new Map();
    return;
  }

  const nextGravity = computeGravityById();
  gravityById = nextGravity;

  const direction = new THREE_NS.Vector3();
  const activeArrowBodyId =
    gravityArrowsLegendActivated &&
    selectedId &&
    gravityArrowFocusBodyId === selectedId
      ? selectedId
      : null;
  for (const [bodyId, visual] of bodyVisuals.entries()) {
    const arrow = visual.gravityArrow;
    if (!arrow) {
      continue;
    }

    const shouldShowThisBodyArrow = Boolean(activeArrowBodyId && bodyId === activeArrowBodyId);
    if (!shouldShowThisBodyArrow) {
      arrow.visible = false;
      continue;
    }

    const gravity = nextGravity.get(bodyId);
    if (!visual.root.visible || !gravity || !(gravity.magnitudeKmS2 > 0)) {
      arrow.visible = false;
      continue;
    }

    direction.set(gravity.axKmS2, gravity.azKmS2, gravity.ayKmS2);
    const magnitude = direction.length();
    if (!(magnitude > 1e-14)) {
      arrow.visible = false;
      continue;
    }

    arrow.visible = true;
    direction.divideScalar(magnitude);
    arrow.setDirection(direction);
    const bodyRadius = Math.max(visual.renderRadius || 0, 0);
    arrow.position.copy(direction).multiplyScalar(bodyRadius * 1.04);
    const length = gravityArrowLengthForAccelerationMs2(gravity.magnitudeMS2, bodyRadius);
    arrow.setLength(
      length,
      clamp(length * 0.3, 0.008, 0.24),
      clamp(length * 0.16, 0.004, 0.12),
    );
  }
}

function wrapRadiansPi(value) {
  const tau = Math.PI * 2;
  let wrapped = ((value + Math.PI) % tau + tau) % tau;
  wrapped -= Math.PI;
  return wrapped;
}

function modelTimestampMs(nowMs) {
  return nowMs;
}

function julianDayFromUnixMs(timestampMs) {
  return (timestampMs / 86_400_000) + 2_440_587.5;
}

function gmstRadiansFromUnixMs(timestampMs) {
  const jd = julianDayFromUnixMs(timestampMs);
  const t = (jd - 2_451_545.0) / 36_525.0;
  const gmstDeg =
    280.46061837 +
    (360.98564736629 * (jd - 2_451_545.0)) +
    (0.000387933 * t * t) -
    ((t * t * t) / 38_710_000.0);
  return normalizeAngle(rad(gmstDeg));
}

function eclipticVectorToEquatorial(vector) {
  const eps = rad(ECLIPTIC_OBLIQUITY_DEG);
  const x = vector.x;
  const y = (vector.y * Math.cos(eps)) - (vector.z * Math.sin(eps));
  const z = (vector.y * Math.sin(eps)) + (vector.z * Math.cos(eps));
  return { x, y, z };
}

function subsolarLongitudeEastRadians(sunFromEarthKm, timestampMs) {
  const sunEq = eclipticVectorToEquatorial(sunFromEarthKm);
  const rightAscension = Math.atan2(sunEq.y, sunEq.x);
  const gmst = gmstRadiansFromUnixMs(timestampMs);
  return wrapRadiansPi(rightAscension - gmst);
}

function sunLongitudeInEarthAxisFrameRadians(earthVisual, sunFromEarthKm) {
  return bodyLongitudeInAxisFrameRadians(earthVisual, sunFromEarthKm);
}

function bodyLongitudeInAxisFrameRadians(bodyVisual, directionFromBodyKm) {
  if (!bodyVisual || !directionFromBodyKm) {
    return null;
  }
  const toSunWorld = new THREE_NS.Vector3(
    directionFromBodyKm.x,
    directionFromBodyKm.z,
    directionFromBodyKm.y,
  );
  if (toSunWorld.lengthSq() < 1e-14) {
    return null;
  }
  const invTilt = bodyVisual.tiltGroup.quaternion.clone().invert();
  toSunWorld.applyQuaternion(invTilt);
  return Math.atan2(-toSunWorld.z, toSunWorld.x);
}

function computeEarthSunSyncedSpinRadians(nowMs) {
  const earthVisual = bodyVisuals.get("earth");
  const earthKm = lightCoordsById("earth");
  const sunKm = lightCoordsById("sun");
  if (!earthVisual || !earthKm || !sunKm) {
    return null;
  }
  const sunFromEarthKm = {
    x: sunKm.x - earthKm.x,
    y: sunKm.y - earthKm.y,
    z: sunKm.z - earthKm.z,
  };
  const sunLonAxis = sunLongitudeInEarthAxisFrameRadians(earthVisual, sunFromEarthKm);
  if (!Number.isFinite(sunLonAxis)) {
    return null;
  }
  const timestampMs = modelTimestampMs(nowMs);
  const subsolarLon = subsolarLongitudeEastRadians(sunFromEarthKm, timestampMs);
  return normalizeAngle(
    sunLonAxis - subsolarLon - rad(EARTH_TEXTURE_LONGITUDE_OFFSET_DEG),
  );
}

function computeMoonEarthLockedSpinRadians() {
  const moonVisual = bodyVisuals.get("moon");
  const moonKm = lightCoordsById("moon");
  const earthKm = lightCoordsById("earth");
  if (!moonVisual || !moonKm || !earthKm) {
    return null;
  }
  const earthFromMoonKm = {
    x: earthKm.x - moonKm.x,
    y: earthKm.y - moonKm.y,
    z: earthKm.z - moonKm.z,
  };
  const earthLonAxis = bodyLongitudeInAxisFrameRadians(moonVisual, earthFromMoonKm);
  if (!Number.isFinite(earthLonAxis)) {
    return null;
  }
  return normalizeAngle(earthLonAxis - rad(MOON_TEXTURE_LONGITUDE_OFFSET_DEG));
}

function primeMeridianModelForBody(body) {
  if (!body) {
    return null;
  }
  const explicit = PRIME_MERIDIAN_W_DEG?.[body.id];
  const explicitW0 = Number(explicit?.w0Deg);
  const explicitRate = Number(explicit?.wRateDegPerDay);
  if (Number.isFinite(explicitW0) && Number.isFinite(explicitRate)) {
    return {
      w0Deg: explicitW0,
      wRateDegPerDay: explicitRate,
    };
  }
  const rotationHours = getRotationPeriodHours(body);
  if (!Number.isFinite(rotationHours) || Math.abs(rotationHours) < 1e-9) {
    return null;
  }
  return {
    w0Deg: 0,
    wRateDegPerDay: (360 * 24) / rotationHours,
  };
}

function primeMeridianTextureOffsetDeg(bodyId) {
  if (bodyId === "earth") {
    return EARTH_TEXTURE_LONGITUDE_OFFSET_DEG;
  }
  if (bodyId === "moon") {
    return MOON_TEXTURE_LONGITUDE_OFFSET_DEG;
  }
  return 0;
}

function primeMeridianSpinRadians(body, nowMs) {
  const model = primeMeridianModelForBody(body);
  if (!model) {
    return null;
  }
  const daysSinceJ2000 = julianDayFromUnixMs(nowMs) - 2_451_545.0;
  const meridianDeg = normalizeDegrees(
    model.w0Deg +
      (model.wRateDegPerDay * daysSinceJ2000) +
      primeMeridianTextureOffsetDeg(body?.id),
  );
  return normalizeAngle(rad(meridianDeg));
}

function calibratedReferenceSpinRadians(bodyId, nowMs) {
  if (bodyId === "earth") {
    return computeEarthSunSyncedSpinRadians(nowMs);
  }
  if (bodyId === "moon") {
    return computeMoonEarthLockedSpinRadians();
  }
  return null;
}

function updatePrimeMeridianSpins(nowMs, deltaSeconds) {
  rigidBodyAttitudeController?.update(deltaSeconds);
  for (const visual of bodyVisuals.values()) {
    const bodyId = visual.body.id;
    if (rigidBodyAttitudeController?.isManagedBody(bodyId)) {
      primeMeridianSpinOffsetRadById.delete(bodyId);
      continue;
    }
    const spinScale = spinScaleForBody(visual.body);
    const deltaSpin = deltaSeconds * spinScale * visual.rotationSpeedRadPerSecond;
    const modelSpin = primeMeridianSpinRadians(visual.body, nowMs);

    if (Number.isFinite(modelSpin)) {
      let offset = primeMeridianSpinOffsetRadById.get(bodyId);
      if (offset === undefined) {
        let referenceSpin = null;
        if (PRIME_MERIDIAN_CALIBRATE_FROM_CURRENT_FOR_IDS.has(bodyId)) {
          referenceSpin = calibratedReferenceSpinRadians(bodyId, nowMs);
        }
        if (!Number.isFinite(referenceSpin)) {
          referenceSpin = Number(visual.spinGroup?.rotation?.y) || 0;
        }
        offset = normalizeAngle(referenceSpin - modelSpin);
        primeMeridianSpinOffsetRadById.set(bodyId, offset);
      }
      visual.spinGroup.rotation.y = normalizeAngle(modelSpin + offset);
    } else if (deltaSpin) {
      visual.spinGroup.rotation.y += deltaSpin;
    }

    if (deltaSpin && visual.cloudMesh) {
      visual.cloudMesh.rotation.y += visual.body.id === "earth" ? deltaSpin * 0.12 : deltaSpin * 1.15;
    }
    visual.lod.update(camera);
  }
}

function computeIlluminationForBody(bodyId) {
  if (LIGHT_MODEL_EXCLUDED_IDS.has(bodyId)) {
    return {
      directSolar: 1,
      transmittance: 1,
      earthshine: 0,
      total: 1,
      physicalModel: false,
    };
  }

  const targetCoordsKm = lightCoordsById(bodyId);
  const sunCoordsKm = lightCoordsById("sun");
  if (!targetCoordsKm || !sunCoordsKm) {
    return {
      directSolar: 1,
      transmittance: 1,
      earthshine: 0,
      total: 1,
      physicalModel: false,
    };
  }

  const dx = sunCoordsKm.x - targetCoordsKm.x;
  const dy = sunCoordsKm.y - targetCoordsKm.y;
  const dz = sunCoordsKm.z - targetCoordsKm.z;
  const sunDistanceKm = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
  const transmittance = computeSolarTransmittance(bodyId, targetCoordsKm, sunCoordsKm);
  const directSolar = solarFluxScaleAtDistanceKm(sunDistanceKm) * transmittance;
  const earthshine = bodyId === "moon" ? computeEarthshineScaleForMoon(targetCoordsKm, sunCoordsKm) : 0;
  return {
    directSolar,
    transmittance,
    earthshine,
    total: directSolar + earthshine,
    physicalModel: true,
  };
}

function applySunlightToVisual(visual, illumination) {
  const earthNightLightScale =
    visual.body?.id === "earth"
      ? Math.pow(clamp(1 - illumination.directSolar, 0, 1), 0.7)
      : 1;
  const emissiveScale =
    visual.body?.id === "earth"
      ? earthNightLightScale
      : visual.body?.id === "moon"
        ? 0
        : 1;

  for (const material of gatherVisualMaterials(visual)) {
    ensureMaterialSunlightBaseline(material);
    const baseColor = material.userData?.sunlightBaseColor;
    if (baseColor && material.color?.isColor) {
      material.color.copy(baseColor);
    }
    const baseEmissive = material.userData?.sunlightBaseEmissiveIntensity;
    if (typeof baseEmissive === "number" && typeof material.emissiveIntensity === "number") {
      material.emissiveIntensity = baseEmissive * emissiveScale;
    }
  }
}

function updateSunlightModel() {
  const nextIllumination = new Map();
  for (const [bodyId, visual] of bodyVisuals.entries()) {
    const illumination = computeIlluminationForBody(bodyId);
    nextIllumination.set(bodyId, illumination);
    applySunlightToVisual(visual, illumination);
  }
  illuminationById = nextIllumination;
}

function animate(timestampMs = 0) {
  try {
    const deltaSeconds = lastFrameTimestampMs ? (timestampMs - lastFrameTimestampMs) / 1000 : 0;
    lastFrameTimestampMs = timestampMs;
    const nowMs = Date.now();
    runFrameTaskSafely("n-body", () => {
      updateNBodySimulation(nowMs);
    });
    runFrameTaskSafely("scene-positions", () => {
      if (orbitalStateById.size > 0) {
        runtimeCoordsKmById = computeRuntimeCoordinatesKm(nowMs);
        applyScenePositions(runtimeCoordsKmById);
      }
    });
    if (launchFeatureEnabled) {
      runFrameTaskSafely("launch-view-sync", () => {
        syncLaunchVehicleViewSelection();
      });
    }
    runFrameTaskSafely("gravity-vectors", () => {
      updateGravityVectors();
    });
    runFrameTaskSafely("physics-overlays", () => {
      updatePhysicsOverlays();
    });
    if (launchFeatureEnabled) {
      runFrameTaskSafely("launch-status", () => {
        updateLaunchStatusPanel();
      });
      runFrameTaskSafely("launch-persistence", () => {
        persistLaunchRuntimeState(nowMs);
      });
    }
    runFrameTaskSafely("body-spins", () => {
      updatePrimeMeridianSpins(nowMs, deltaSeconds);
    });
    if (launchFeatureEnabled) {
      runFrameTaskSafely("launch-site-structure", () => {
        updateLaunchSiteStructureVisuals(deltaSeconds);
      });
      runFrameTaskSafely("launch-vehicle-visuals", () => {
        updateLaunchVehicleVisuals();
      });
      runFrameTaskSafely("booster-visuals", () => {
        updateBoosterVehicleVisuals();
      });
      runFrameTaskSafely("fleet-spacecraft-visuals", () => {
        updateFleetSpacecraftVisuals();
      });
      runFrameTaskSafely("refuel-transfer-visual", () => {
        updateRefuelTransferVisual();
      });
    }
    runFrameTaskSafely("eclipse-uniforms", () => {
      updateBodyEclipseUniforms();
    });
    runFrameTaskSafely("sunlight-model", () => {
      updateSunlightModel();
    });
    runFrameTaskSafely("earth-marker", () => {
      updateEarthLocationMarkerPulse(nowMs);
    });
    runFrameTaskSafely("spacecraft-markers", () => {
      updateSpacecraftWorldMarkers(nowMs);
    });

    runFrameTaskSafely("orbit-markers", () => {
      for (const orbitVisual of orbitVisuals.values()) {
        updateOrbitMarkerFromTime(orbitVisual, nowMs);
      }
    });

    runFrameTaskSafely("camera-update", () => {
      updateCameraFromOrbit();
    });
    runFrameTaskSafely("render", () => {
      renderer.render(scene, camera);
    });

    runFrameTaskSafely("info-overlay", () => {
      const focusBody = findFocusBodyForDetails();
      if (focusBody !== detailBodyId || timestampMs - lastInfoRenderMs > 160) {
        detailBodyId = focusBody;
        updateInfoOverlay();
        lastInfoRenderMs = timestampMs;
      }
    });
  } catch (error) {
    const now = Date.now();
    if (now - lastAnimationLoopErrorMs > 1000) {
      lastAnimationLoopErrorMs = now;
      console.error("[solar-system] Animation loop error:", error);
    }
  } finally {
    requestAnimationFrame(animate);
  }
}

function findFocusBodyForDetails() {
  if (selectedId) {
    const selectedLive = runtimeCoordsKmById.get(selectedId) || positionsById.get(selectedId)?.coordinates_km;
    if (selectedLive) {
      return selectedId;
    }
    return null;
  }

  let bestId = null;
  let bestRatio = Number.POSITIVE_INFINITY;
  for (const [bodyId, visual] of bodyVisuals.entries()) {
    if (!visual.root.visible) {
      continue;
    }
    const threshold = detailThreshold(visual.renderRadius);
    const distance = camera.position.distanceTo(visual.root.position);
    const ratio = distance / threshold;
    if (ratio < 1 && ratio < bestRatio) {
      bestRatio = ratio;
      bestId = bodyId;
    }
  }
  return bestId;
}

function isCloseEnoughForDetails(bodyId) {
  const visual = bodyVisuals.get(bodyId);
  if (!visual) {
    return false;
  }
  return camera.position.distanceTo(visual.root.position) <= detailThreshold(visual.renderRadius);
}

function detailThreshold(renderRadius) {
  return Math.max(DETAIL_MIN_DISTANCE, renderRadius * DETAIL_DISTANCE_MULTIPLIER);
}

function readLegendPanelCollapsedPreference() {
  try {
    return window.localStorage?.getItem(LEGEND_PANEL_COLLAPSED_STORAGE_KEY) === "1";
  } catch (_error) {
    return false;
  }
}

function persistLegendPanelCollapsedPreference(collapsed) {
  try {
    window.localStorage?.setItem(LEGEND_PANEL_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch (_error) {
    // Ignore preference persistence failures.
  }
}

function renderLegendPanelCollapsedState() {
  if (!bodyLegend) {
    return;
  }
  bodyLegend.classList.toggle("collapsed", legendPanelCollapsed);
  if (!bodyLegendToggleButton) {
    return;
  }
  const collapsed = legendPanelCollapsed;
  bodyLegendToggleButton.textContent = collapsed ? "+" : "-";
  bodyLegendToggleButton.setAttribute("aria-expanded", collapsed ? "false" : "true");
  bodyLegendToggleButton.setAttribute("aria-label", collapsed ? "Expand navigator" : "Collapse navigator");
}

function toggleLegendPanelCollapsed() {
  legendPanelCollapsed = !legendPanelCollapsed;
  persistLegendPanelCollapsedPreference(legendPanelCollapsed);
  renderLegendPanelCollapsedState();
}

function initializeLegendPanelControls() {
  if (!bodyLegend) {
    return;
  }
  legendPanelCollapsed = readLegendPanelCollapsedPreference();
  renderLegendPanelCollapsedState();
  bodyLegend.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (!target.closest("[data-legend-toggle='true']")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    toggleLegendPanelCollapsed();
  });
}

function readInfoPanelCollapsedPreference() {
  try {
    return window.localStorage?.getItem(INFO_PANEL_COLLAPSED_STORAGE_KEY) === "1";
  } catch (_error) {
    return false;
  }
}

function persistInfoPanelCollapsedPreference(collapsed) {
  try {
    window.localStorage?.setItem(INFO_PANEL_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch (_error) {
    // Ignore preference persistence failures.
  }
}

function renderInfoCardContent(title, contentHtml) {
  if (!infoCard) {
    return;
  }
  const toggleIcon = infoPanelCollapsed ? "+" : "-";
  const toggleLabel = infoPanelCollapsed ? "Expand info panel" : "Minimize info panel";
  const contentSection = infoPanelCollapsed
    ? ""
    : `<div class="planet-info-content">${contentHtml}</div>`;
  infoCard.innerHTML = `
    <div class="planet-info-header">
      <p class="title">${title}</p>
      <button type="button" class="planet-info-toggle" data-info-toggle="true" aria-label="${toggleLabel}" aria-expanded="${infoPanelCollapsed ? "false" : "true"}">${toggleIcon}</button>
    </div>
    ${contentSection}
  `;
  infoCard.classList.toggle("collapsed", infoPanelCollapsed);
  infoCard.classList.add("visible");
}

function toggleInfoPanelCollapsed() {
  infoPanelCollapsed = !infoPanelCollapsed;
  persistInfoPanelCollapsedPreference(infoPanelCollapsed);
  updateInfoOverlay();
}

function initializeInfoPanelControls() {
  if (!infoCard) {
    return;
  }
  infoPanelCollapsed = readInfoPanelCollapsedPreference();
  infoCard.classList.toggle("collapsed", infoPanelCollapsed);
  infoCard.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (!target.closest("[data-info-toggle='true']")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    toggleInfoPanelCollapsed();
  });
}

initializeLegendPanelControls();
initializeLegendSectionControls();
initializeInfoPanelControls();

function updateInfoOverlay() {
  if (!detailBodyId) {
    infoCard.classList.remove("visible");
    infoCard.innerHTML = "";
    return;
  }

  const meta = metaById.get(detailBodyId);
  const live = positionsById.get(detailBodyId);
  const visual = bodyVisuals.get(detailBodyId);
  const runtimeCoords = runtimeCoordsKmById.get(detailBodyId) || null;
  if (!meta || !visual || (!live && !runtimeCoords)) {
    infoCard.classList.remove("visible");
    infoCard.innerHTML = "";
    return;
  }

  const cameraDistance = camera.position.distanceTo(visual.root.position);
  const coords = runtimeCoords || live?.coordinates_km || null;
  const sunCoords = runtimeCoordsKmById.get("sun") || positionsById.get("sun")?.coordinates_km || null;
  const hasCoords =
    Boolean(coords) &&
    Number.isFinite(Number(coords?.x)) &&
    Number.isFinite(Number(coords?.y)) &&
    Number.isFinite(Number(coords?.z));
  const hasSunCoords =
    Boolean(sunCoords) &&
    Number.isFinite(Number(sunCoords?.x)) &&
    Number.isFinite(Number(sunCoords?.y)) &&
    Number.isFinite(Number(sunCoords?.z));
  const distanceFromSunKm =
    hasCoords && hasSunCoords
      ? Math.hypot(coords.x - sunCoords.x, coords.y - sunCoords.y, coords.z - sunCoords.z)
      : null;
  const tilt = axialTiltDegreesForBody(meta.id, Date.now());
  const rotationHours = getRotationPeriodHours(meta);
  const orbitalPeriod = meta.orbital_period_days;
  const semimajor = meta.semimajor_axis_km;
  const parent = meta.parent || "sun";
  const description = meta.description || "n/a";
  const sourceLabel = String(
    live?.source
    || (isLaunchTelemetryVehicleId(meta.id) ? "SIMULATED" : "n/a"),
  );
  const sourceError = live?.source_error ? ` (${live.source_error})` : "";
  const observationModeLabel =
    observation.mode === OBSERVATION_MODES.SURFACE
      ? "Surface Observer"
      : observation.mode === OBSERVATION_MODES.FREE
        ? "Free Camera"
        : "Body Lock";
  const observerLabel =
    observation.mode === OBSERVATION_MODES.SURFACE
      ? (getSurfaceObserverPreset(observation.surfacePresetId)?.label || "n/a")
      : "n/a";
  const earthCoordsForAtmosphere = runtimeCoordsKmById.get("earth") || positionsById.get("earth")?.coordinates_km || null;
  let atmospherePhysicsLine = "";
  if (physicsOverlayState.atmosphere) {
    if (meta.id === "earth") {
      const seaLevel = sampleEarthAtmosphereRuntime(0, { timestampMs: Date.now() });
      const spaceWeather = currentSpaceWeatherSnapshot();
      const earthEop = currentEarthEopSnapshot();
      const forcing = currentEnvironmentForcingSnapshot();
      const spaceWeatherLine = spaceWeather
        ? `Space Weather: F10.7 ${formatNumber(spaceWeather.f107, 1)} sfu | Kp ${formatNumber(spaceWeather.kp, 2)} (${spaceWeather.source || "n/a"})`
        : "Space Weather: n/a";
      const earthEopLine = earthEop
        ? `Earth EOP: ${earthEop.source || "n/a"} | Records ${Math.max(0, Number(earthEop.records?.length) || 0)} | Age ${Number.isFinite(Number(earthEop.ageSeconds)) ? `${formatNumber(earthEop.ageSeconds, 0)}s` : "n/a"}`
        : "Earth EOP: n/a";
      const forcingLine = forcing
        ? `Environment Forcing: ${forcing.scenario || "n/a"} (${forcing.mode || "n/a"})`
        : "Environment Forcing: n/a";
      atmospherePhysicsLine = `
        <p class="line">Atmosphere Model: Rayleigh/Mie/Ozone scattering + US1976 lower atmosphere + species upper atmosphere</p>
        <p class="line">Visual Overlay: scattering envelope to 100 km + boundary shells at 11, 47, 86, 120, 700, and 1000 km</p>
        <p class="line">Sea Level: ρ ${formatNumber(seaLevel.densityKgM3, 4)} kg/m³ | P ${formatNumber(seaLevel.pressurePa, 2)} Pa | g ${formatNumber(seaLevel.gravityMs2, 4)} m/s²</p>
        <p class="line">${spaceWeatherLine}</p>
        <p class="line">${earthEopLine}</p>
        <p class="line">${forcingLine}</p>
      `;
    } else if (hasCoords && earthCoordsForAtmosphere) {
      const relativePositionKm = {
        x: coords.x - earthCoordsForAtmosphere.x,
        y: coords.y - earthCoordsForAtmosphere.y,
        z: coords.z - earthCoordsForAtmosphere.z,
      };
      const altitudeKm = Math.hypot(
        coords.x - earthCoordsForAtmosphere.x,
        coords.y - earthCoordsForAtmosphere.y,
        coords.z - earthCoordsForAtmosphere.z,
      ) - (Number(metaById.get("earth")?.radius_km) || 6371.0084);
      if (altitudeKm >= 0 && altitudeKm <= 1000) {
        const sample = sampleEarthAtmosphereRuntime(altitudeKm, {
          relativePositionKm,
          timestampMs: Date.now(),
        });
        const upperModelLine = sample?.upperAtmosphereModel
          ? ` | Upper Model: ${sample.upperAtmosphereModel}${Number.isFinite(Number(sample?.exosphericTemperatureK)) ? ` | Tex ${formatNumber(sample.exosphericTemperatureK, 1)} K` : ""}`
          : "";
        const layerLine = sample?.layerName
          ? ` | Layer ${String(sample.layerName)}${sample?.atmosphericRegion ? ` (${String(sample.atmosphericRegion)})` : ""}`
          : "";
        const transportLine = Number.isFinite(Number(sample?.pressureScaleHeightKm))
          ? ` | H ${formatNumber(sample.pressureScaleHeightKm, 3)} km${Number.isFinite(Number(sample?.meanFreePathM)) ? ` | λ ${formatNumber(sample.meanFreePathM, 6)} m` : ""}`
          : "";
        atmospherePhysicsLine = `
          <p class="line">Earth Atmosphere @ ${formatNumber(altitudeKm, 2)} km: ρ ${formatNumber(sample.densityKgM3, 8)} kg/m³ | P ${formatNumber(sample.pressurePa, 4)} Pa | g ${formatNumber(sample.gravityMs2, 4)} m/s²${layerLine}${transportLine}${upperModelLine}</p>
        `;
      }
    }
  }
  const effectiveSpinScale = spinScaleForBody(meta);
  const visualSpinDegPerSec = Math.abs((visual.rotationSpeedRadPerSecond || 0) * effectiveSpinScale * (180 / Math.PI));
  const currentRotationAngleDeg = normalizeDegrees((visual.spinGroup?.rotation?.y || 0) * (180 / Math.PI));
  const currentSiderealCompletionPct = (currentRotationAngleDeg / ROTATION_SWEEP_DEGREES) * 100;
  const illumination = illuminationById.get(meta.id) || null;
  const hasPhysicalIllumination = Boolean(illumination?.physicalModel);
  const totalSolarPct =
    hasPhysicalIllumination && Number.isFinite(illumination.total)
      ? Math.max(0, illumination.total) * 100
      : null;
  const directSolarPct =
    hasPhysicalIllumination && Number.isFinite(illumination.directSolar)
      ? Math.max(0, illumination.directSolar) * 100
      : null;
  const occlusionPct =
    hasPhysicalIllumination && Number.isFinite(illumination.transmittance)
      ? clamp(1 - illumination.transmittance, 0, 1) * 100
      : null;
  const earthshinePct =
    hasPhysicalIllumination && meta.id === "moon" && Number.isFinite(illumination.earthshine)
      ? Math.max(0, illumination.earthshine) * 100
      : null;
  const gravity = gravityById.get(meta.id) || null;
  const gravityMagnitudeMS2 = Number.isFinite(gravity?.magnitudeMS2) ? gravity.magnitudeMS2 : null;
  const gravityVectorLine = gravity
    ? `${formatAcceleration(gravity.axKmS2 * 1000)}, ${formatAcceleration(gravity.ayKmS2 * 1000)}, ${formatAcceleration(gravity.azKmS2 * 1000)}`
    : "n/a";
  const dominantGravityBody = gravity?.dominantBodyId
    ? (metaById.get(gravity.dominantBodyId)?.name || gravity.dominantBodyId)
    : null;
  const dominantGravityMS2 = Number.isFinite(gravity?.dominantContributionMS2)
    ? gravity.dominantContributionMS2
    : null;
  const launchSnapshot = launchFeatureEnabled && isLaunchTelemetryVehicleId(meta.id)
    ? (
      launchController?.statusSnapshotForBody?.(nBodyState, meta.id, Date.now())
      || launchController?.statusSnapshot?.()
      || null
    )
    : null;
  const launchDurationLabel = launchSnapshot?.phase === "complete"
    ? "Full Mission Duration"
    : "Mission Elapsed";
  const runtimeMassKg = nBodyState?.dynamicBodies?.get(meta.id)?.massKg;
  const displayedMassKg = Number.isFinite(runtimeMassKg) ? runtimeMassKg : Number(meta.mass_kg);
  const isSpacecraftBody = String(meta?.body_type || "").toLowerCase() === "spacecraft";
  const earthEopSnapshot = currentEarthEopSnapshot();
  const dynamicsDetailParts = [];
  if (OBLATE_GRAVITY_ENABLED) {
    dynamicsDetailParts.push("IERS secular J2/J3/J4 + EGM2008 J5/J6 + degree-2..6 tesseral/sectorial");
    dynamicsDetailParts.push(
      (
        earthEopSnapshot
        && Array.isArray(earthEopSnapshot.records)
        && earthEopSnapshot.records.length > 0
      )
        ? "Earth orientation corrections (data EOP UT1/xp/yp + precession/nutation)"
        : "Earth orientation corrections (analytic UT1/xp/yp + precession/nutation)",
    );
  }
  if (EARTH_SOLID_TIDE_ENABLED) {
    dynamicsDetailParts.push("Earth solid-tide perturbations (Moon/Sun)");
  }
  if (LUNAR_MASCON_MODEL_ENABLED) {
    dynamicsDetailParts.push("lunar mascon field (for lunar-trajectory targets)");
  }
  if (SOLAR_RADIATION_PRESSURE_ENABLED) {
    dynamicsDetailParts.push(
      isSpacecraftBody
        ? "SRP + eclipse shadowing (active)"
        : "SRP model active for spacecraft only",
    );
  }
  const orbitDynamicsLine = isNBodyDrivenBodyId(meta.id)
    ? `N-body gravity (startup-seeded from Horizons${
      dynamicsDetailParts.length > 0 ? `, ${dynamicsDetailParts.join(", ")}` : ""
    })`
    : "Ephemeris / existing propagation";
  const configuredOrbitHours = Number(ORBIT_VISUAL_PERIOD_HOURS?.[meta.id]);
  const configuredSolarDayHours = Number(ROTATION_SOLAR_DAY_HOURS?.[meta.id]);
  let rotationModelLine = "";
  if (configuredOrbitHours > 0 && configuredSolarDayHours > 0 && rotationHours !== undefined) {
    rotationModelLine = `
      <p class="line">Rotation Model: ${formatNumber(rotationHours)} h sidereal (${formatNumber(configuredSolarDayHours)} h solar day)</p>
      <p class="line">Orbit Model: ${formatNumber(configuredOrbitHours)} h visual orbit period</p>
    `;
  }
  const orbitVisual = orbitVisuals.get(meta.id);
  let orbitProgressLine = "";
  if (orbitVisual && orbitVisual.initialized && orbitalPeriod) {
    const meanAnomaly = currentMeanAnomaly(orbitVisual, Date.now());
    const phaseFraction = normalizeAngle(meanAnomaly) / (Math.PI * 2);
    const remainingDays = orbitalPeriod * (1 - phaseFraction);
    orbitProgressLine = `
      <p class="line">Orbit Progress: ${(phaseFraction * 100).toFixed(4)}%</p>
      <p class="line">Days Remaining in Orbit: ${formatNumber(Math.max(remainingDays, 0))}</p>
    `;
  }

  if (isLaunchTelemetryVehicleId(meta.id)) {
    const isBoosterSelected = meta.id === LAUNCH_BOOSTER_BODY_ID;
    const isTankerSelected = String(meta.id || "").startsWith("earth_refuel_tanker_");
    const selectedVehicleLabel = isBoosterSelected
      ? "Booster"
      : (isTankerSelected ? "Tanker" : "Starship");
    const missionElapsedLine = launchSnapshot
      ? `${launchDurationLabel}: ${formatDurationSeconds(launchSnapshot.elapsedSeconds)}`
      : "Mission Elapsed: n/a";
    const launchGuidanceMode = launchSnapshot?.guidanceDisplayMode || launchSnapshot?.guidanceMode || launchSnapshot?.autopilotMode || "n/a";
    const boosterGuidanceMode = launchSnapshot?.boosterGuidanceMode || "n/a";
    const starshipAltitudeLine = Number.isFinite(launchSnapshot?.altitudeKm)
      ? `${formatNumber(launchSnapshot.altitudeKm)} km`
      : "n/a";
    const starshipSpeedLine = formatLaunchSpeedFrameSummary(launchSnapshot, { includeInertial: true, digits: 4 });
    const starshipDistanceLine = Number.isFinite(launchSnapshot?.starshipDistanceKm)
      ? `${formatNumber(launchSnapshot.starshipDistanceKm, 4)} km`
      : "n/a";
    const starshipThrustLine = Number.isFinite(launchSnapshot?.thrustN)
      ? `${formatNumber(launchSnapshot.thrustN / 1_000_000, 4)} MN @ ${Number.isFinite(launchSnapshot?.throttle) ? `${formatNumber(launchSnapshot.throttle * 100, 1)}%` : "n/a"}`
      : "n/a";
    const tankerRcsOrbitCorrectionLine = Number.isFinite(launchSnapshot?.rcsOrbitCorrectionForceN)
      ? `${formatNumber(Math.max(0, Number(launchSnapshot.rcsOrbitCorrectionForceN) || 0) / 1_000_000, 6)} MN`
      : "n/a";
    const tankerRcsOrbitAccelLine = Number.isFinite(launchSnapshot?.rcsOrbitCorrectionAccelKmS2)
      ? `${formatNumber(Math.max(0, Number(launchSnapshot.rcsOrbitCorrectionAccelKmS2) || 0) * 1000, 6)} m/s²`
      : "n/a";
    const tankerAttitudeErrorLine = launchSnapshot?.rcsActive && Number.isFinite(launchSnapshot?.rcsErrorDeg)
      ? `${formatNumber(Math.max(0, Number(launchSnapshot.rcsErrorDeg) || 0), 2)}°`
      : "n/a";
    const tankerAttitudeAuthorityLine = launchSnapshot?.rcsActive && Number.isFinite(launchSnapshot?.rcsAttitudeAuthority)
      ? `${formatNumber(clamp(Number(launchSnapshot.rcsAttitudeAuthority) || 0, 0, 1) * 100, 1)}%`
      : "n/a";
    const tankerAttitudeLimitedLine = launchSnapshot?.rcsActive
      ? (launchSnapshot?.rcsAttitudeLimited ? "yes" : "no")
      : "n/a";
    const starshipOrbitLine = `${Number.isFinite(launchSnapshot?.apoapsisKm) ? `${formatNumber(launchSnapshot.apoapsisKm)} km` : "n/a"} / ${Number.isFinite(launchSnapshot?.periapsisKm) ? `${formatNumber(launchSnapshot.periapsisKm)} km` : "n/a"}`;
    const targetBodyName = String(launchSnapshot?.targetBodyName || "").trim() || "n/a";
    const targetBodyId = String(launchSnapshot?.targetBodyId || "").trim();
    const targetBodyLabel = launchTargetLabel(targetBodyName, targetBodyId);
    const targetDistanceRawKm = Number(launchSnapshot?.targetDistanceKm);
    const targetClosingRawKmS = Number(launchSnapshot?.targetClosingSpeedKmS);
    const targetDistanceLine = Number.isFinite(targetDistanceRawKm)
      ? `${formatNumber(targetDistanceRawKm, 1)} km`
      : "n/a";
    const targetClosingLine = Number.isFinite(targetClosingRawKmS)
      ? `${formatNumber(targetClosingRawKmS, 4)} km/s`
      : "n/a";
    const targetTelemetry = resolveSnapshotTargetTelemetry(launchSnapshot);
    const targetEtaSeconds = targetTelemetry.targetEtaSeconds;
    const targetRateLabel = String(targetTelemetry.targetRateLabel || "Closing").trim() || "Closing";
    const targetEtaLabel = String(targetTelemetry.targetEtaLabel || "ETA").trim() || "ETA";
    const targetEtaLine = Number.isFinite(targetEtaSeconds)
      ? formatDurationSeconds(targetEtaSeconds)
      : "n/a";
    const earthDistanceLine = Number.isFinite(Number(launchSnapshot?.earthDistanceKm))
      ? `${formatNumber(launchSnapshot.earthDistanceKm, 1)} km`
      : "n/a";
    const earthRadialLine = Number.isFinite(Number(launchSnapshot?.earthRadialSpeedKmS))
      ? `${formatNumber(launchSnapshot.earthRadialSpeedKmS, 4)} km/s`
      : "n/a";
    const earthDirectionStateLine = String(launchSnapshot?.earthDirectionState || "").trim() || "n/a";
    const earthDirectionAngleLine = Number.isFinite(Number(launchSnapshot?.earthDirectionAngleDeg))
      ? `${formatNumber(launchSnapshot.earthDirectionAngleDeg, 1)}°`
      : "n/a";
    const guidanceVelocityStateLine = String(launchSnapshot?.guidanceVelocityState || "").trim() || "n/a";
    const guidanceVelocityAngleLine = Number.isFinite(Number(launchSnapshot?.guidanceVelocityAngleDeg))
      ? `${formatNumber(launchSnapshot.guidanceVelocityAngleDeg, 1)}°`
      : "n/a";
    const guidanceRadialStateLine = String(launchSnapshot?.guidanceRadialState || "").trim() || "n/a";
    const guidanceRadialAngleLine = Number.isFinite(Number(launchSnapshot?.guidanceRadialAngleDeg))
      ? `${formatNumber(launchSnapshot.guidanceRadialAngleDeg, 1)}°`
      : "n/a";
    const bodyVelocityStateLine = String(launchSnapshot?.bodyVelocityState || "").trim() || "n/a";
    const bodyVelocityAngleLine = Number.isFinite(Number(launchSnapshot?.bodyVelocityAngleDeg))
      ? `${formatNumber(launchSnapshot.bodyVelocityAngleDeg, 1)}°`
      : "n/a";
    const bodyRadialStateLine = String(launchSnapshot?.bodyRadialState || "").trim() || "n/a";
    const bodyRadialAngleLine = Number.isFinite(Number(launchSnapshot?.bodyRadialAngleDeg))
      ? `${formatNumber(launchSnapshot.bodyRadialAngleDeg, 1)}°`
      : "n/a";
    const guidanceMoonStateLine = String(launchSnapshot?.guidanceMoonState || "").trim() || "n/a";
    const guidanceMoonAngleLine = Number.isFinite(Number(launchSnapshot?.guidanceMoonAngleDeg))
      ? `${formatNumber(launchSnapshot.guidanceMoonAngleDeg, 1)}°`
      : "n/a";
    const bodyMoonStateLine = String(launchSnapshot?.bodyMoonState || "").trim() || "n/a";
    const bodyMoonAngleLine = Number.isFinite(Number(launchSnapshot?.bodyMoonAngleDeg))
      ? `${formatNumber(launchSnapshot.bodyMoonAngleDeg, 1)}°`
      : "n/a";
    const earthRelativeVectorLine = (
      launchSnapshot?.earthRelativePositionKm
      && Number.isFinite(Number(launchSnapshot.earthRelativePositionKm.x))
      && Number.isFinite(Number(launchSnapshot.earthRelativePositionKm.y))
      && Number.isFinite(Number(launchSnapshot.earthRelativePositionKm.z))
    )
      ? `${formatNumber(launchSnapshot.earthRelativePositionKm.x, 1)}, ${formatNumber(launchSnapshot.earthRelativePositionKm.y, 1)}, ${formatNumber(launchSnapshot.earthRelativePositionKm.z, 1)}`
      : "n/a";
    const moonDirectionStateLine = String(launchSnapshot?.moonDirectionState || "").trim() || "n/a";
    const moonDirectionAngleLine = Number.isFinite(Number(launchSnapshot?.moonDirectionAngleDeg))
      ? `${formatNumber(launchSnapshot.moonDirectionAngleDeg, 1)}°`
      : "n/a";
    const moonRelativeVectorLine = (
      launchSnapshot?.moonRelativePositionKm
      && Number.isFinite(Number(launchSnapshot.moonRelativePositionKm.x))
      && Number.isFinite(Number(launchSnapshot.moonRelativePositionKm.y))
      && Number.isFinite(Number(launchSnapshot.moonRelativePositionKm.z))
    )
      ? `${formatNumber(launchSnapshot.moonRelativePositionKm.x, 1)}, ${formatNumber(launchSnapshot.moonRelativePositionKm.y, 1)}, ${formatNumber(launchSnapshot.moonRelativePositionKm.z, 1)}`
      : "n/a";
    const moonRelativeSpeedLine = Number.isFinite(launchSnapshot?.moonRelativeSpeedKmS)
      ? `${formatNumber(launchSnapshot.moonRelativeSpeedKmS, 4)} km/s`
      : "n/a";
    const moonProjectedMissLine = Number.isFinite(launchSnapshot?.moonProjectedMissDistanceKm)
      ? `${formatNumber(launchSnapshot.moonProjectedMissDistanceKm, 1)} km`
      : "n/a";
    const moonProjectedMissTrendLine = Number.isFinite(Number(launchSnapshot?.moonProjectedMissTrendKmS))
      ? `${formatNumber(launchSnapshot.moonProjectedMissTrendKmS, 3)} km/s`
      : "n/a";
    const moonPeriluneEstimateLine = Number.isFinite(launchSnapshot?.moonProjectedPeriluneAltitudeKm)
      ? `${formatNumber(launchSnapshot.moonProjectedPeriluneAltitudeKm, 1)} km`
      : "n/a";
    const moonBPlaneErrorLine = Number.isFinite(launchSnapshot?.moonBPlaneErrorKm)
      ? `${formatNumber(launchSnapshot.moonBPlaneErrorKm, 1)} km`
      : "n/a";
    const moonWindowScoreLine = Number.isFinite(Number(launchSnapshot?.moonDepartureWindowScore))
      ? `${formatNumber(Number(launchSnapshot.moonDepartureWindowScore) * 100, 1)}%`
      : "n/a";
    const moonWindowGeometryLine = Number.isFinite(Number(launchSnapshot?.moonDepartureGeometryScore))
      ? `${formatNumber(Number(launchSnapshot.moonDepartureGeometryScore) * 100, 1)}%`
      : "n/a";
    const moonWindowAlignNowLine = Number.isFinite(Number(launchSnapshot?.moonDepartureAlignNow))
      ? formatNumber(launchSnapshot.moonDepartureAlignNow, 3)
      : "n/a";
    const moonWindowAlignProjectedLine = Number.isFinite(Number(launchSnapshot?.moonDepartureAlignProjected))
      ? formatNumber(launchSnapshot.moonDepartureAlignProjected, 3)
      : "n/a";
    const moonWindowWaitLine = Number.isFinite(Number(launchSnapshot?.moonDepartureWindowWaitSec))
      ? formatDurationSeconds(Math.max(0, Number(launchSnapshot.moonDepartureWindowWaitSec)))
      : "n/a";
    const moonWindowReadyLine = launchSnapshot?.moonDepartureWindowReady ? "ready" : "wait";
    const moonWindowLaunchClockLine = Number.isFinite(Number(launchSnapshot?.moonDepartureWindowLaunchTimeMs))
      ? new Date(Number(launchSnapshot.moonDepartureWindowLaunchTimeMs)).toLocaleTimeString()
      : "n/a";
    const moonTliTargetModeLine = String(launchSnapshot?.moonTliTargetMode || "").trim() || "n/a";
    const moonTliTargetMissLine = Number.isFinite(Number(launchSnapshot?.moonTliTargetMissKm))
      ? `${formatNumber(launchSnapshot.moonTliTargetMissKm, 1)} km`
      : "n/a";
    const moonTliTargetMissGateLine = Number.isFinite(Number(launchSnapshot?.moonTliTargetMissGateKm))
      ? `${formatNumber(launchSnapshot.moonTliTargetMissGateKm, 1)} km`
      : "n/a";
    const phaseGateReasonLine = String(launchSnapshot?.missionPhaseGateReason || "").trim() || "n/a";
    const guidanceBurnRequestedLine = Boolean(launchSnapshot?.guidanceBurnRequested) ? "yes" : "no";
    const guidanceRequestedThrottleLine = Number.isFinite(Number(launchSnapshot?.guidanceRequestedThrottle))
      ? `${formatNumber(Number(launchSnapshot.guidanceRequestedThrottle) * 100, 1)}%`
      : "n/a";
    const controlTelemetry = resolveSnapshotControlTelemetry(launchSnapshot);
    const attitudeControlLine = controlTelemetry.attitudeControlLabel;
    const trajectoryBurnLine = controlTelemetry.trajectoryBurnLabel;
    const guidanceInertNoPropellant = Boolean(launchSnapshot?.guidanceInertNoPropellant);
    const guidanceInertReasonLine = guidanceInertNoPropellant
      ? (String(launchSnapshot?.guidanceInertReason || "").trim() || "no-propellant-for-guidance-burn")
      : "n/a";
    const fuelBudgetRequiredDeltaVLine = Number.isFinite(Number(launchSnapshot?.fuelBudgetRequiredDeltaVKmS))
      ? `${formatNumber(launchSnapshot.fuelBudgetRequiredDeltaVKmS, 3)} km/s`
      : "n/a";
    const fuelBudgetAvailableDeltaVLine = Number.isFinite(Number(launchSnapshot?.fuelBudgetAvailableDeltaVKmS))
      ? `${formatNumber(launchSnapshot.fuelBudgetAvailableDeltaVKmS, 3)} km/s`
      : "n/a";
    const fuelBudgetRequiredPropLine = Number.isFinite(Number(launchSnapshot?.fuelBudgetMinimumPropellantKg))
      ? `${formatNumber(launchSnapshot.fuelBudgetMinimumPropellantKg, 0)} kg`
      : "n/a";
    const fuelBudgetAvailablePropLine = Number.isFinite(Number(launchSnapshot?.fuelBudgetAvailablePropellantKg))
      ? `${formatNumber(launchSnapshot.fuelBudgetAvailablePropellantKg, 0)} kg`
      : "n/a";
    const fuelBudgetMarginLine = Number.isFinite(Number(launchSnapshot?.fuelBudgetMarginKg))
      ? `${formatNumber(launchSnapshot.fuelBudgetMarginKg, 0)} kg`
      : "n/a";
    const fuelBudgetFeasibleLine = launchSnapshot?.fuelBudgetFeasible === null || launchSnapshot?.fuelBudgetFeasible === undefined
      ? "n/a"
      : (launchSnapshot.fuelBudgetFeasible ? "yes" : "no");
    const spaceWeatherSnapshot = currentSpaceWeatherSnapshot();
    const spaceWeatherTelemetryLine = spaceWeatherSnapshot
      ? `F10.7 ${formatNumber(spaceWeatherSnapshot.f107, 1)} sfu | Kp ${formatNumber(spaceWeatherSnapshot.kp, 2)} | Source ${spaceWeatherSnapshot.source || "n/a"}`
      : "n/a";
    const boosterAltitudeLine = Number.isFinite(launchSnapshot?.boosterAltitudeKm)
      ? `${formatNumber(launchSnapshot.boosterAltitudeKm, 4)} km`
      : "n/a";
    const boosterSpeedLine = formatLaunchSpeedFrameSummary({
      earthRelativeSpeedKmS: launchSnapshot?.boosterEarthRelativeSpeedKmS ?? launchSnapshot?.boosterSpeedKmS,
      groundRelativeSpeedKmS: launchSnapshot?.boosterGroundRelativeSpeedKmS,
      airRelativeSpeedKmS: launchSnapshot?.boosterAirRelativeSpeedKmS,
      inertialSpeedKmS: launchSnapshot?.boosterInertialSpeedKmS,
    }, { includeInertial: true, digits: 4 });
    const boosterPropellantLine = Number.isFinite(launchSnapshot?.boosterPropellantKg)
      ? `${formatNumber(launchSnapshot.boosterPropellantKg, 1)} kg`
      : "n/a";
    const boosterFuelFractionLine = Number.isFinite(launchSnapshot?.boosterFuelFraction)
      ? `${formatNumber(launchSnapshot.boosterFuelFraction * 100, 1)}%`
      : "n/a";
    const boosterThrustLine = Number.isFinite(launchSnapshot?.boosterThrustN)
      ? `${formatNumber(launchSnapshot.boosterThrustN / 1_000_000, 4)} MN @ ${Number.isFinite(launchSnapshot?.boosterThrottle) ? `${formatNumber(launchSnapshot.boosterThrottle * 100, 1)}%` : "n/a"}`
      : "n/a";
    const boosterRcsLine = launchSnapshot?.boosterRcsActive
      ? `active (${formatNumber((Number(launchSnapshot?.boosterRcsAuthority) || 0) * 100, 1)}%)`
      : "off";
    const boosterDistanceLine = Number.isFinite(launchSnapshot?.boosterDistanceKm)
      ? `${formatNumber(launchSnapshot.boosterDistanceKm, 4)} km`
      : "n/a";
    const boosterLaunchSiteRangeLine = Number.isFinite(launchSnapshot?.boosterLaunchSiteRangeKm)
      ? `${formatNumber(launchSnapshot.boosterLaunchSiteRangeKm, 4)} km`
      : "n/a";
    const boosterLaunchSiteLateralRangeLine = Number.isFinite(launchSnapshot?.boosterLaunchSiteLateralRangeKm)
      ? `${formatNumber(launchSnapshot.boosterLaunchSiteLateralRangeKm, 4)} km`
      : "n/a";
    const boosterLaunchSiteClosingLine = Number.isFinite(launchSnapshot?.boosterLaunchSiteLateralClosingSpeedKmS)
      ? `${formatNumber(launchSnapshot.boosterLaunchSiteLateralClosingSpeedKmS, 4)} km/s`
      : "n/a";
    const coordsLine = hasCoords ? `${formatNumber(coords.x)}, ${formatNumber(coords.y)}, ${formatNumber(coords.z)}` : "n/a";
    let selectedVehicleLines = "";
    if (isBoosterSelected) {
      selectedVehicleLines = `
        <p class="line launch-line">Phase: ${launchSnapshot?.boosterPhase || "n/a"}</p>
        <p class="line launch-line">Guidance: ${boosterGuidanceMode}</p>
        <p class="line launch-line">Altitude: ${boosterAltitudeLine}</p>
        <p class="line launch-line">Speed Frames: ${boosterSpeedLine}</p>
        <p class="line launch-line">Thrust: ${boosterThrustLine}</p>
        <p class="line launch-line">RCS: ${boosterRcsLine} | Jets: ${Array.isArray(launchSnapshot?.boosterRcsJets) && launchSnapshot.boosterRcsJets.length > 0 ? launchSnapshot.boosterRcsJets.join(", ") : "n/a"}</p>
        <p class="line launch-line">Propellant: ${boosterPropellantLine} (${boosterFuelFractionLine} remaining)</p>
        <p class="line launch-line">Distance Traveled: ${boosterDistanceLine}</p>
        <p class="line launch-line">Range to Launch Site: ${boosterLaunchSiteRangeLine}</p>
        <p class="line launch-line">Lateral Range to Site: ${boosterLaunchSiteLateralRangeLine}</p>
        <p class="line launch-line">Lateral Closing Speed: ${boosterLaunchSiteClosingLine}</p>
        <p class="line launch-line">Landed: ${launchSnapshot?.boosterLanded ? "yes" : "no"}</p>
      `;
    } else if (isTankerSelected) {
      selectedVehicleLines = `
        <p class="line launch-line">Phase/Stage: ${launchSnapshot?.phaseLabel || launchSnapshot?.phase || "n/a"} | ${launchSnapshot?.stageName || "n/a"}</p>
        <p class="line launch-line">Altitude: ${starshipAltitudeLine}</p>
        <p class="line launch-line">Speed Frames: ${starshipSpeedLine}</p>
        <p class="line launch-line">Guidance: ${launchGuidanceMode}</p>
        <p class="line launch-line">Thrust: ${starshipThrustLine}</p>
        <p class="line launch-line">RCS Orbit Correction: ${tankerRcsOrbitCorrectionLine} | Accel: ${tankerRcsOrbitAccelLine}</p>
        <p class="line launch-line">Attitude Error: ${tankerAttitudeErrorLine} | Authority: ${tankerAttitudeAuthorityLine} | Limited: ${tankerAttitudeLimitedLine}</p>
        <p class="line launch-line">Apoapsis/Periapsis: ${starshipOrbitLine}</p>
        <p class="line launch-line">Target: ${targetBodyLabel} | Distance: ${targetDistanceLine} | ${targetRateLabel}: ${targetClosingLine} | ${targetEtaLabel}: ${targetEtaLine}</p>
        <p class="line launch-line">Earth LOS: ${earthDirectionStateLine} | Off-Radial: ${earthDirectionAngleLine} | Radial: ${earthRadialLine}</p>
        <p class="line launch-line">Earth Vector (km): ${earthRelativeVectorLine}</p>
        <p class="line launch-line">Moon LOS: ${moonDirectionStateLine} | Off-Target: ${moonDirectionAngleLine} | Approach: ${targetBodyId === "moon" ? targetClosingLine : "n/a"}</p>
        <p class="line launch-line">Moon Vector (km): ${moonRelativeVectorLine}</p>
        <p class="line launch-line">Cmd Axis: ${guidanceVelocityStateLine} | Off-Vel: ${guidanceVelocityAngleLine} | Off-Up: ${guidanceRadialAngleLine} | Radial: ${guidanceRadialStateLine}</p>
        <p class="line launch-line">Nose Axis: ${bodyVelocityStateLine} | Off-Vel: ${bodyVelocityAngleLine} | Off-Up: ${bodyRadialAngleLine} | Radial: ${bodyRadialStateLine}</p>
        <p class="line launch-line">Cmd Moon Aim: ${guidanceMoonStateLine} | Off-Moon: ${guidanceMoonAngleLine}</p>
        <p class="line launch-line">Nose Moon Aim: ${bodyMoonStateLine} | Off-Moon: ${bodyMoonAngleLine}</p>
        <p class="line launch-line">Moon Rel Speed: ${moonRelativeSpeedLine} | Projected Miss: ${moonProjectedMissLine} | Miss Trend: ${moonProjectedMissTrendLine}</p>
        <p class="line launch-line">Perilune Estimate: ${moonPeriluneEstimateLine} | B-Plane Error: ${moonBPlaneErrorLine}</p>
        <p class="line launch-line">Window Score: ${moonWindowScoreLine} | TLI Target: ${moonTliTargetModeLine} | Miss/Gate: ${moonTliTargetMissLine} / ${moonTliTargetMissGateLine}</p>
        <p class="line launch-line">Window Geo: ${moonWindowGeometryLine} | Align Now/Proj: ${moonWindowAlignNowLine} / ${moonWindowAlignProjectedLine}</p>
        <p class="line launch-line">Launch Window: ${moonWindowReadyLine} | Best In: ${moonWindowWaitLine} | Best At: ${moonWindowLaunchClockLine}</p>
        <p class="line launch-line">Phase Gate: ${phaseGateReasonLine}</p>
        <p class="line launch-line">Guidance Burn Cmd: ${guidanceBurnRequestedLine} @ ${guidanceRequestedThrottleLine} | Inert: ${guidanceInertNoPropellant ? "yes" : "no"}</p>
        <p class="line launch-line">Attitude Control: ${attitudeControlLine} | Trajectory Burn: ${trajectoryBurnLine}</p>
        <p class="line launch-line">Inert Reason: ${guidanceInertReasonLine}</p>
        <p class="line launch-line">Fuel Budget DV Req/Avail: ${fuelBudgetRequiredDeltaVLine} / ${fuelBudgetAvailableDeltaVLine}</p>
        <p class="line launch-line">Fuel Budget Prop Req/Avail/Margin: ${fuelBudgetRequiredPropLine} / ${fuelBudgetAvailablePropLine} / ${fuelBudgetMarginLine} | Feasible: ${fuelBudgetFeasibleLine}</p>
        <p class="line launch-line">Space Weather: ${spaceWeatherTelemetryLine}</p>
      `;
    } else {
      selectedVehicleLines = `
        <p class="line launch-line">Phase/Stage: ${launchSnapshot?.phaseLabel || launchSnapshot?.phase || "n/a"} | ${launchSnapshot?.stageName || "n/a"}</p>
        <p class="line launch-line">Altitude: ${starshipAltitudeLine}</p>
        <p class="line launch-line">Speed Frames: ${starshipSpeedLine}</p>
        <p class="line launch-line">Guidance: ${launchGuidanceMode}</p>
        <p class="line launch-line">Thrust: ${starshipThrustLine}</p>
        <p class="line launch-line">Target: ${targetBodyLabel} | Distance: ${targetDistanceLine} | ${targetRateLabel}: ${targetClosingLine} | ${targetEtaLabel}: ${targetEtaLine}</p>
        <p class="line launch-line">Earth LOS: ${earthDirectionStateLine} | Off-Radial: ${earthDirectionAngleLine} | Radial: ${earthRadialLine}</p>
        <p class="line launch-line">Earth Vector (km): ${earthRelativeVectorLine}</p>
        <p class="line launch-line">Moon LOS: ${moonDirectionStateLine} | Off-Target: ${moonDirectionAngleLine} | Approach: ${targetBodyId === "moon" ? targetClosingLine : "n/a"}</p>
        <p class="line launch-line">Moon Vector (km): ${moonRelativeVectorLine}</p>
        <p class="line launch-line">Cmd Axis: ${guidanceVelocityStateLine} | Off-Vel: ${guidanceVelocityAngleLine} | Off-Up: ${guidanceRadialAngleLine} | Radial: ${guidanceRadialStateLine}</p>
        <p class="line launch-line">Nose Axis: ${bodyVelocityStateLine} | Off-Vel: ${bodyVelocityAngleLine} | Off-Up: ${bodyRadialAngleLine} | Radial: ${bodyRadialStateLine}</p>
        <p class="line launch-line">Cmd Moon Aim: ${guidanceMoonStateLine} | Off-Moon: ${guidanceMoonAngleLine}</p>
        <p class="line launch-line">Nose Moon Aim: ${bodyMoonStateLine} | Off-Moon: ${bodyMoonAngleLine}</p>
        <p class="line launch-line">Moon Rel Speed: ${moonRelativeSpeedLine} | Projected Miss: ${moonProjectedMissLine} | Miss Trend: ${moonProjectedMissTrendLine}</p>
        <p class="line launch-line">Perilune Estimate: ${moonPeriluneEstimateLine} | B-Plane Error: ${moonBPlaneErrorLine}</p>
        <p class="line launch-line">Window Score: ${moonWindowScoreLine} | TLI Target: ${moonTliTargetModeLine} | Miss/Gate: ${moonTliTargetMissLine} / ${moonTliTargetMissGateLine}</p>
        <p class="line launch-line">Window Geo: ${moonWindowGeometryLine} | Align Now/Proj: ${moonWindowAlignNowLine} / ${moonWindowAlignProjectedLine}</p>
        <p class="line launch-line">Launch Window: ${moonWindowReadyLine} | Best In: ${moonWindowWaitLine} | Best At: ${moonWindowLaunchClockLine}</p>
        <p class="line launch-line">Phase Gate: ${phaseGateReasonLine}</p>
        <p class="line launch-line">Guidance Burn Cmd: ${guidanceBurnRequestedLine} @ ${guidanceRequestedThrottleLine} | Inert: ${guidanceInertNoPropellant ? "yes" : "no"}</p>
        <p class="line launch-line">Attitude Control: ${attitudeControlLine} | Trajectory Burn: ${trajectoryBurnLine}</p>
        <p class="line launch-line">Inert Reason: ${guidanceInertReasonLine}</p>
        <p class="line launch-line">Fuel Budget DV Req/Avail: ${fuelBudgetRequiredDeltaVLine} / ${fuelBudgetAvailableDeltaVLine}</p>
        <p class="line launch-line">Fuel Budget Prop Req/Avail/Margin: ${fuelBudgetRequiredPropLine} / ${fuelBudgetAvailablePropLine} / ${fuelBudgetMarginLine} | Feasible: ${fuelBudgetFeasibleLine}</p>
        <p class="line launch-line">Space Weather: ${spaceWeatherTelemetryLine}</p>
        <p class="line launch-line">Distance Traveled: ${starshipDistanceLine}</p>
        <p class="line launch-line">Apoapsis/Periapsis: ${starshipOrbitLine}</p>
        <p class="line launch-line">RCS: ${launchSnapshot?.rcsActive ? `active (${formatNumber((Number(launchSnapshot?.rcsAuthority) || 0) * 100, 1)}%)` : "off"} | Jets: ${Array.isArray(launchSnapshot?.rcsJets) && launchSnapshot.rcsJets.length > 0 ? launchSnapshot.rcsJets.join(", ") : "n/a"}</p>
      `;
    }

    const launchTelemetryContent = `
      <p class="line">Observation Mode: ${observationModeLabel}</p>
      <p class="line">Data Source: ${sourceLabel}${sourceError}</p>
      <p class="line">Mission: ${launchSnapshot?.missionName || "n/a"} | Phase: ${launchSnapshot?.missionPhaseDisplay || launchSnapshot?.missionPhase || "n/a"} | Complete: ${launchSnapshot?.missionCompleted ? "yes" : "no"}</p>
      <p class="line launch-line">${missionElapsedLine}</p>
      <p class="line launch-line">Launch Site: ${launchSnapshot?.launchSiteName || "n/a"}</p>
      ${selectedVehicleLines}
      <p class="line">Map Texture Source: ${visual.mapSource || "n/a"}</p>
      <p class="line">Camera Distance: ${formatNumber(cameraDistance)} scene units</p>
      <p class="line">XYZ (km): ${coordsLine}</p>
    `;
    renderInfoCardContent(`${selectedVehicleLabel} Telemetry`, launchTelemetryContent);
    return;
  }

  const eclipseOccluderNames = eclipseOccluderIdsForBody(meta)
    .map((bodyId) => metaById.get(bodyId)?.name || bodyId);
  const eclipseCenterTransmittancePct =
    meta.id !== "sun" && hasCoords && hasSunCoords
      ? clamp(computeSolarTransmittance(meta.id, coords, sunCoords), 0, 1) * 100
      : null;
  const eclipseLine =
    meta.id !== "sun"
      ? `<p class="line">Eclipse Model: Multi-body umbra/penumbra (surface fragment pass)</p>
         <p class="line">Eclipse Occluders: ${eclipseOccluderNames.length > 0 ? eclipseOccluderNames.join(", ") : "none"}</p>
         <p class="line">Center Sun Visibility: ${eclipseCenterTransmittancePct !== null ? `${formatNumber(eclipseCenterTransmittancePct)}%` : "n/a"}</p>`
      : "";
  const launchPhysicsLine = launchSnapshot
    ? `<p class="line launch-line">Launch Phase: ${launchSnapshot.phaseLabel || launchSnapshot.phase || "n/a"}</p>
       <p class="line launch-line">Launch Stage: ${launchSnapshot.stageName || "n/a"}</p>
       <p class="line launch-line">Mission: ${launchSnapshot.missionName || "n/a"} | Phase: ${launchSnapshot.missionPhaseDisplay || launchSnapshot.missionPhase || "n/a"} | Complete: ${launchSnapshot.missionCompleted ? "yes" : "no"}</p>
       <p class="line launch-line">${launchDurationLabel}: ${formatDurationSeconds(launchSnapshot.elapsedSeconds)}</p>
       <p class="line launch-line">Launch Altitude: ${Number.isFinite(launchSnapshot.altitudeKm) ? `${formatNumber(launchSnapshot.altitudeKm)} km` : "n/a"}</p>
       <p class="line launch-line">Altitude Above Terrain: ${shouldShowTerrainRelativeAltitude(launchSnapshot) && Number.isFinite(launchSnapshot.altitudeAboveTerrainKm) ? `${formatNumber(launchSnapshot.altitudeAboveTerrainKm, 3)} km` : "n/a"}</p>
       <p class="line launch-line">Local Terrain Elevation: ${Number.isFinite(launchSnapshot.terrainElevationKm) ? `${formatNumber(launchSnapshot.terrainElevationKm, 3)} km` : "n/a"} | Lat/Lon: ${Number.isFinite(launchSnapshot.latitudeDeg) && Number.isFinite(launchSnapshot.longitudeDeg) ? `${formatNumber(launchSnapshot.latitudeDeg, 4)}°, ${formatNumber(launchSnapshot.longitudeDeg, 4)}°` : "n/a"}</p>
       <p class="line launch-line">Launch Speed Frames: ${formatLaunchSpeedFrameSummary(launchSnapshot, { includeInertial: true, digits: 4 })}</p>
       <p class="line launch-line">Target Body: ${launchTargetLabel(launchSnapshot.targetBodyName, launchSnapshot.targetBodyId)} | Distance: ${Number.isFinite(targetTelemetry.targetDistanceKm) ? `${formatNumber(targetTelemetry.targetDistanceKm, 1)} km` : "n/a"} | ${targetRateLabel}: ${Number.isFinite(targetTelemetry.targetClosingSpeedKmS) ? `${formatNumber(targetTelemetry.targetClosingSpeedKmS, 4)} km/s` : "n/a"}${Number.isFinite(targetEtaSeconds) ? ` | ${targetEtaLabel}: ${formatDurationSeconds(targetEtaSeconds)}` : ""}</p>
       <p class="line launch-line">Booster Phase: ${launchSnapshot.boosterPhase || "n/a"} | Guidance: ${launchSnapshot.boosterGuidanceMode || "n/a"} | Landed: ${launchSnapshot.boosterLanded ? "yes" : "no"}</p>
       <p class="line launch-line">Booster Altitude: ${Number.isFinite(launchSnapshot.boosterAltitudeKm) ? `${formatNumber(launchSnapshot.boosterAltitudeKm, 4)} km` : "n/a"} | Booster Speed Frames: ${formatLaunchSpeedFrameSummary({ earthRelativeSpeedKmS: launchSnapshot.boosterEarthRelativeSpeedKmS ?? launchSnapshot.boosterSpeedKmS, groundRelativeSpeedKmS: launchSnapshot.boosterGroundRelativeSpeedKmS, airRelativeSpeedKmS: launchSnapshot.boosterAirRelativeSpeedKmS, inertialSpeedKmS: launchSnapshot.boosterInertialSpeedKmS }, { includeInertial: true, digits: 4 })}</p>
       <p class="line launch-line">Booster Propellant: ${Number.isFinite(launchSnapshot.boosterPropellantKg) ? `${formatNumber(launchSnapshot.boosterPropellantKg, 1)} kg` : "n/a"}${Number.isFinite(launchSnapshot.boosterFuelFraction) ? ` (${formatNumber(launchSnapshot.boosterFuelFraction * 100, 1)}% remaining)` : ""}</p>
       <p class="line launch-line">Booster Thrust: ${Number.isFinite(launchSnapshot.boosterThrustN) ? `${formatNumber(launchSnapshot.boosterThrustN / 1_000_000, 4)} MN` : "n/a"} @ ${Number.isFinite(launchSnapshot.boosterThrottle) ? `${formatNumber(launchSnapshot.boosterThrottle * 100, 1)}%` : "n/a"}</p>
       <p class="line launch-line">Booster RCS: ${launchSnapshot.boosterRcsActive ? `active (${formatNumber((Number(launchSnapshot.boosterRcsAuthority) || 0) * 100, 1)}%)` : "off"} | Jets: ${Array.isArray(launchSnapshot.boosterRcsJets) && launchSnapshot.boosterRcsJets.length > 0 ? launchSnapshot.boosterRcsJets.join(", ") : "n/a"}</p>
       <p class="line launch-line">Booster Distance Traveled (Earth-relative): ${Number.isFinite(launchSnapshot.boosterDistanceKm) ? `${formatNumber(launchSnapshot.boosterDistanceKm, 4)} km` : "n/a"}</p>
       <p class="line launch-line">Starship Distance Traveled (Earth-relative): ${Number.isFinite(launchSnapshot.starshipDistanceKm) ? `${formatNumber(launchSnapshot.starshipDistanceKm, 4)} km` : "n/a"}</p>
       <p class="line launch-line">Thrust: ${Number.isFinite(launchSnapshot.thrustN) ? `${formatNumber(launchSnapshot.thrustN / 1_000_000, 4)} MN` : "n/a"} @ ${Number.isFinite(launchSnapshot.throttle) ? `${formatNumber(launchSnapshot.throttle * 100, 1)}%` : "n/a"}</p>
       <p class="line launch-line">RCS: ${launchSnapshot.rcsActive ? `active (${formatNumber((Number(launchSnapshot.rcsAuthority) || 0) * 100, 1)}%)` : "off"}</p>
       <p class="line launch-line">RCS Jets: ${Array.isArray(launchSnapshot.rcsJets) && launchSnapshot.rcsJets.length > 0 ? launchSnapshot.rcsJets.join(", ") : "n/a"}</p>
       <p class="line launch-line">Apoapsis/Periapsis: ${Number.isFinite(launchSnapshot.apoapsisKm) ? `${formatNumber(launchSnapshot.apoapsisKm)} km` : "n/a"} / ${Number.isFinite(launchSnapshot.periapsisKm) ? `${formatNumber(launchSnapshot.periapsisKm)} km` : "n/a"}</p>`
    : "";

  const bodyInfoContent = `
    <p class="line">Type: ${meta.body_type}</p>
    <p class="line">Parent Body: ${parent}</p>
    <p class="line">Data Source: ${sourceLabel}${sourceError}</p>
    ${atmospherePhysicsLine}
    <p class="line">Observation Mode: ${observationModeLabel}</p>
    <p class="line">Observer Preset: ${observerLabel}</p>
    <p class="line">Surface Rendering: ${surfaceRenderingLabel(visual.textureMode)}</p>
    <p class="line">Map Texture Source: ${visual.mapSource || "n/a"}</p>
    <p class="line">Distance from Sun: ${distanceFromSunKm !== null ? `${formatNumber(distanceFromSunKm)} km` : "n/a"}</p>
    <p class="line">Semi-Major Axis: ${semimajor ? `${formatNumber(semimajor)} km` : "n/a"}</p>
    <p class="line">Orbital Period: ${orbitalPeriod ? `${formatNumber(orbitalPeriod)} days` : "n/a"}</p>
    <p class="line">Radius: ${formatNumber(meta.radius_km)} km</p>
    <p class="line">Mass: ${formatMass(displayedMassKg)}</p>
    <p class="line">Axial Tilt: ${tilt !== undefined ? `${formatNumber(tilt)}°` : "n/a"}</p>
    <p class="line">Rotation Period: ${rotationHours !== undefined ? `${formatNumber(rotationHours)} h` : "n/a"}</p>
    <p class="line">Orbit Dynamics: ${orbitDynamicsLine}</p>
    ${launchPhysicsLine}
    ${rotationModelLine}
    <p class="line">Sunlight Exposure: ${totalSolarPct !== null ? `${formatNumber(totalSolarPct)}% of 1AU baseline` : "n/a"}</p>
    <p class="line">Direct Solar Flux: ${directSolarPct !== null ? `${formatNumber(directSolarPct)}% of 1AU baseline` : "n/a"}</p>
    <p class="line">Sun Occlusion: ${occlusionPct !== null ? `${formatNumber(occlusionPct)}%` : "n/a"}</p>
    <p class="line">Net Gravity Acceleration: ${gravityMagnitudeMS2 !== null ? `${formatAcceleration(gravityMagnitudeMS2)} m/s²` : "n/a"}</p>
    <p class="line">Gravity Vector (m/s²): ${gravityVectorLine}</p>
    <p class="line">Dominant Gravity Source: ${dominantGravityBody ? `${dominantGravityBody}${dominantGravityMS2 !== null ? ` (${formatAcceleration(dominantGravityMS2)} m/s²)` : ""}` : "n/a"}</p>
    ${eclipseLine}
    <p class="line">Earthshine (Moon): ${earthshinePct !== null ? `${formatNumber(earthshinePct)}% of 1AU baseline` : "n/a"}</p>
    <p class="line">Visual Spin Rate: ${formatAngularRateDegPerSec(visualSpinDegPerSec)} °/s</p>
    <p class="line">Current Rotation: ${formatNumber(currentRotationAngleDeg)}° (${formatNumber(currentSiderealCompletionPct)}% of sidereal cycle)</p>
    <p class="line">Camera Distance: ${formatNumber(cameraDistance)} scene units</p>
    ${orbitProgressLine}
    <p class="line">XYZ (km): ${hasCoords ? `${formatNumber(coords.x)}, ${formatNumber(coords.y)}, ${formatNumber(coords.z)}` : "n/a"}</p>
    <p class="line">${description}</p>
  `;
  renderInfoCardContent(meta.name, bodyInfoContent);
}

function onResize() {
  if (!renderer || !camera) {
    return;
  }
  const width = Math.max(canvas.clientWidth || 0, 1);
  const height = Math.max(canvas.clientHeight || 0, 1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function showFatalOverlay(message) {
  renderInfoCardContent("3D Renderer Error", `<p class="line">${message}</p>`);
}

function renderScaleForBody(body) {
  if (body?.id === "sun") {
    return SUN_RADIUS_SCALE;
  }
  if (body?.body_type === "moon") {
    return MOON_RADIUS_SCALE;
  }
  return PLANET_RADIUS_SCALE;
}

function renderRadiusForBody(body) {
  const normalizedKm = normalizedRadiusKm(body);
  if (!(normalizedKm > 0)) {
    return 0;
  }
  let renderRadius = normalizedKm * renderScaleForBody(body);

  if (body?.body_type === "spacecraft") {
    return renderRadius;
  }

  if (TRUE_SCALE_MODE) {
    return renderRadius;
  }

  if (body?.body_type === "moon") {
    const parent = metaById.get(body.parent || "");
    const parentRadiusKm = Number(parent?.radius_km);
    if (parentRadiusKm > 0) {
      const parentRenderRadius = parentRadiusKm * renderScaleForBody(parent);
      const minMoonRenderRadius = Math.max(parentRenderRadius * MIN_VISIBLE_MOON_RATIO, MIN_VISIBLE_MOON_RENDER_RADIUS);
      const maxMoonRenderRadius = parentRenderRadius * MAX_VISIBLE_MOON_RATIO;
      renderRadius = clamp(renderRadius, minMoonRenderRadius, maxMoonRenderRadius);
    } else {
      renderRadius = Math.max(renderRadius, MIN_VISIBLE_MOON_RENDER_RADIUS);
    }
  }

  return renderRadius;
}

function normalizedRadiusKm(body) {
  const radiusKm = Number(body?.radius_km);
  if (!(radiusKm > 0)) {
    return 0;
  }
  if (SCIENTIFIC_ACCURACY_MODE || body?.body_type !== "moon" || !body?.parent) {
    return radiusKm;
  }

  const parent = metaById.get(body.parent);
  const parentRadiusKm = Number(parent?.radius_km);
  if (!(parentRadiusKm > 0)) {
    return radiusKm;
  }

  const ratio = radiusKm / parentRadiusKm;
  const clampedRatio = clamp(ratio, MIN_VISIBLE_MOON_RATIO, MAX_VISIBLE_MOON_RATIO);
  return parentRadiusKm * clampedRatio;
}

function getRotationSpeedRadPerSecond(body) {
  let hours = getRotationPeriodHours(body);
  if (hours === undefined) {
    hours = 24;
  }
  if (hours === 0) {
    return 0;
  }
  return (2 * Math.PI) / (hours * 3600);
}

function currentPoleEquatorialDegForBody(bodyId, timestampMs = Date.now(), visited = new Set()) {
  if (!bodyId || visited.has(bodyId)) {
    return null;
  }
  visited.add(bodyId);

  const model = SPIN_AXIS_EQUATORIAL_DEG?.[bodyId];
  if (model && Number.isFinite(Number(model.raDeg)) && Number.isFinite(Number(model.decDeg))) {
    const julianCenturies = (julianDayFromUnixMs(timestampMs) - 2_451_545.0) / 36_525.0;
    const raRate = Number(model.raRateDegPerCentury) || 0;
    const decRate = Number(model.decRateDegPerCentury) || 0;
    const raDeg = normalizeDegrees(Number(model.raDeg) + (raRate * julianCenturies));
    const decDeg = clamp(Number(model.decDeg) + (decRate * julianCenturies), -90, 90);
    return { raDeg, decDeg };
  }

  const meta = metaById.get(bodyId);
  if (meta?.body_type === "moon" && meta.parent) {
    return currentPoleEquatorialDegForBody(meta.parent, timestampMs, visited);
  }
  return null;
}

function spinAxisSceneVectorForBody(bodyId) {
  const pole = currentPoleEquatorialDegForBody(bodyId);
  if (!pole) {
    return null;
  }
  const axisEcliptic = equatorialPoleToEclipticVector(
    Number(pole.raDeg),
    Number(pole.decDeg),
    ECLIPTIC_OBLIQUITY_DEG,
  );
  if (!axisEcliptic) {
    return null;
  }
  const axisScene = new THREE_NS.Vector3(
    axisEcliptic.x,
    axisEcliptic.z,
    axisEcliptic.y,
  );
  if (axisScene.lengthSq() < 1e-12) {
    return null;
  }
  return axisScene.normalize();
}

function axialTiltDegreesForBody(bodyId, timestampMs = Date.now()) {
  const explicitTilt = AXIAL_TILT_DEG[bodyId];
  if (Number.isFinite(Number(explicitTilt))) {
    return Number(explicitTilt);
  }
  const pole = currentPoleEquatorialDegForBody(bodyId, timestampMs);
  if (!pole) {
    return undefined;
  }
  const axisEcliptic = equatorialPoleToEclipticVector(pole.raDeg, pole.decDeg, ECLIPTIC_OBLIQUITY_DEG);
  if (!axisEcliptic) {
    return undefined;
  }
  return Math.acos(clamp(axisEcliptic.z, -1, 1)) * (180 / Math.PI);
}

function equatorialPoleToEclipticVector(raDeg, decDeg, obliquityDeg) {
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg) || !Number.isFinite(obliquityDeg)) {
    return null;
  }
  const ra = rad(raDeg);
  const dec = rad(decDeg);
  const eps = rad(obliquityDeg);
  const cosDec = Math.cos(dec);
  const xEq = cosDec * Math.cos(ra);
  const yEq = cosDec * Math.sin(ra);
  const zEq = Math.sin(dec);
  const xEcl = xEq;
  const yEcl = (yEq * Math.cos(eps)) + (zEq * Math.sin(eps));
  const zEcl = (-yEq * Math.sin(eps)) + (zEq * Math.cos(eps));
  const length = Math.sqrt((xEcl * xEcl) + (yEcl * yEcl) + (zEcl * zEcl));
  if (!(length > 1e-12)) {
    return null;
  }
  return {
    x: xEcl / length,
    y: yEcl / length,
    z: zEcl / length,
  };
}

function latLonToEarthVector(latitudeDeg, longitudeDeg, radius) {
  const latRad = rad(clamp(Number(latitudeDeg) || 0, -90, 90));
  const lonRad = rad(Number(longitudeDeg) || 0);
  const cosLat = Math.cos(latRad);
  return new THREE_NS.Vector3(
    radius * cosLat * Math.cos(lonRad),
    radius * Math.sin(latRad),
    -radius * cosLat * Math.sin(lonRad),
  );
}

function parseTimestampMs(timestamp) {
  const parsed = Date.parse(timestamp || "");
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return Date.now();
}

function fbm(x, y, seed, octaves) {
  let total = 0;
  let amplitude = 0.5;
  let frequency = 1.0;
  let normalizer = 0;
  for (let i = 0; i < octaves; i += 1) {
    total += amplitude * valueNoise2D(x * frequency, y * frequency, seed + i * 9127);
    normalizer += amplitude;
    amplitude *= 0.5;
    frequency *= 2.02;
  }
  return normalizer > 0 ? total / normalizer : 0;
}

function ridgeFbm(x, y, seed, octaves) {
  let total = 0;
  let amplitude = 0.5;
  let frequency = 1.0;
  let normalizer = 0;
  for (let i = 0; i < octaves; i += 1) {
    const v = valueNoise2D(x * frequency, y * frequency, seed + i * 17111);
    const ridge = 1 - Math.abs((v * 2) - 1);
    total += ridge * amplitude;
    normalizer += amplitude;
    amplitude *= 0.52;
    frequency *= 2.1;
  }
  return normalizer > 0 ? total / normalizer : 0;
}

function valueNoise2D(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = x - x0;
  const yf = y - y0;

  const h00 = hash2D(x0, y0, seed);
  const h10 = hash2D(x0 + 1, y0, seed);
  const h01 = hash2D(x0, y0 + 1, seed);
  const h11 = hash2D(x0 + 1, y0 + 1, seed);

  const ux = smoothstep(xf);
  const uy = smoothstep(yf);
  const nx0 = lerp(h00, h10, ux);
  const nx1 = lerp(h01, h11, ux);
  return lerp(nx0, nx1, uy);
}

function hash2D(x, y, seed) {
  const v = Math.sin((x * 127.1) + (y * 311.7) + (seed * 0.0013)) * 43758.5453123;
  return v - Math.floor(v);
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + ((b - a) * t);
}

function hashStringToSeed(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const bigint = parseInt(normalized, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function mixTriColor(low, mid, high, t) {
  if (t <= 0.5) {
    const tt = t / 0.5;
    return {
      r: lerp(low.r, mid.r, tt),
      g: lerp(low.g, mid.g, tt),
      b: lerp(low.b, mid.b, tt),
    };
  }
  const tt = (t - 0.5) / 0.5;
  return {
    r: lerp(mid.r, high.r, tt),
    g: lerp(mid.g, high.g, tt),
    b: lerp(mid.b, high.b, tt),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeDegrees(value) {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function rad(degrees) {
  return (degrees * Math.PI) / 180;
}

function formatNumber(value, maxFractionDigits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: maxFractionDigits,
  });
}

function formatLaunchSpeedNumber(value, digits = 4) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? formatNumber(numeric, digits) : "n/a";
}

function formatLaunchSpeedValue(value, digits = 4) {
  const speedNumber = formatLaunchSpeedNumber(value, digits);
  return speedNumber === "n/a" ? "n/a" : `${speedNumber} km/s`;
}

function formatLaunchSpeedFrameSummary(snapshot, { includeInertial = true, digits = 4 } = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    return "n/a";
  }
  const earthRelativeSpeedKmS = Number.isFinite(Number(snapshot.earthRelativeSpeedKmS))
    ? Number(snapshot.earthRelativeSpeedKmS)
    : (Number.isFinite(Number(snapshot.speedKmS)) ? Number(snapshot.speedKmS) : Number.NaN);
  const groundRelativeSpeedKmS = Number(snapshot.groundRelativeSpeedKmS);
  const airRelativeSpeedKmS = Number(snapshot.airRelativeSpeedKmS);
  const inertialSpeedKmS = Number(snapshot.inertialSpeedKmS);
  const parts = [];
  if (includeInertial && Number.isFinite(inertialSpeedKmS)) {
    parts.push(`Inertial ${formatLaunchSpeedValue(inertialSpeedKmS, digits)}`);
  }
  if (Number.isFinite(earthRelativeSpeedKmS)) {
    parts.push(`Earth ${formatLaunchSpeedValue(earthRelativeSpeedKmS, digits)}`);
  }
  if (Number.isFinite(groundRelativeSpeedKmS)) {
    parts.push(`Ground ${formatLaunchSpeedValue(groundRelativeSpeedKmS, digits)}`);
  }
  if (Number.isFinite(airRelativeSpeedKmS)) {
    parts.push(`Air ${formatLaunchSpeedValue(airRelativeSpeedKmS, digits)}`);
  }
  return parts.length > 0 ? parts.join(" | ") : "n/a";
}

function formatAcceleration(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }
  const abs = Math.abs(numeric);
  if (abs === 0) {
    return "0";
  }
  if (abs >= 1) {
    return numeric.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  if (abs >= 0.001) {
    return numeric.toLocaleString(undefined, { maximumFractionDigits: 7 });
  }
  return numeric.toExponential(3);
}

function formatAngularRateDegPerSec(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }
  const abs = Math.abs(numeric);
  if (abs === 0) {
    return "0";
  }
  if (abs >= 1) {
    return numeric.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  if (abs >= 0.001) {
    return numeric.toLocaleString(undefined, { maximumFractionDigits: 7 });
  }
  return numeric.toExponential(3);
}

function formatMass(value) {
  if (!value) {
    return "unknown";
  }
  return `${Number(value).toExponential(4)} kg`;
}

function formatDurationSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return "n/a";
  }
  const totalSeconds = Math.floor(numeric);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
