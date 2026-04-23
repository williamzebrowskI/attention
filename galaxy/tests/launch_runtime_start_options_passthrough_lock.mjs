import { createPhysicsLaunchRuntime } from "../app/static/js/physics/runtime/launchRuntime.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

let received = null;
const fakeController = {
  startLaunch(state, nowMs, options) {
    received = {
      state,
      nowMs,
      options,
    };
    return true;
  },
};

const runtime = createPhysicsLaunchRuntime({
  getLaunchFeatureEnabled: () => true,
  getLaunchController: () => fakeController,
  onWorldStateMutated: () => {},
});

const state = {
  initialized: true,
  dynamicBodies: new Map(),
  staticSources: new Map(),
};
const nowMs = Date.UTC(2026, 3, 22, 23, 0, 0);
const options = {
  boosterEngineCount: 17,
  missionIdOverride: "earth_orbit_hold",
  targetOrbitAltitudeKm: 220,
};

const started = runtime.startLaunch(state, nowMs, options);
assert(started, "launch_runtime_start_options_passthrough_lock: runtime rejected start");
assert(received, "launch_runtime_start_options_passthrough_lock: controller startLaunch was not called");
assert(received.state === state, "launch_runtime_start_options_passthrough_lock: state reference not forwarded");
assert(received.nowMs === nowMs, "launch_runtime_start_options_passthrough_lock: timestamp not forwarded");
assert(received.options === options, "launch_runtime_start_options_passthrough_lock: options object not forwarded");
assert(received.options.boosterEngineCount === 17, "launch_runtime_start_options_passthrough_lock: boosterEngineCount missing");
assert(received.options.missionIdOverride === "earth_orbit_hold", "launch_runtime_start_options_passthrough_lock: missionIdOverride missing");
assert(received.options.targetOrbitAltitudeKm === 220, "launch_runtime_start_options_passthrough_lock: targetOrbitAltitudeKm missing");

console.log("PASS launch-runtime-start-options-passthrough-lock");
