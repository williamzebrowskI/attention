import {
  solveMoonDepartureWindow,
  solveMoonOrbitInjectWindowForLaunch,
} from "./departureWindowSolver.js";

function postSolveResponse(message = {}) {
  if (typeof globalThis.postMessage === "function") {
    globalThis.postMessage(message);
  }
}

function handleSolveRequest(data = {}) {
  const requestId = Number(data?.requestId);
  if (!Number.isFinite(requestId)) {
    return;
  }
  try {
    const payload = data?.payload && typeof data.payload === "object" ? data.payload : {};
    let solution = null;
    if (data?.type === "solveMoonOrbitInjectWindowForLaunch") {
      solution = solveMoonOrbitInjectWindowForLaunch(payload);
    } else if (data?.type === "solveMoonDepartureWindow") {
      solution = solveMoonDepartureWindow(payload);
    } else {
      throw new Error(`unsupported-worker-solve:${String(data?.type || "")}`);
    }
    postSolveResponse({
      requestId,
      type: String(data?.type || ""),
      solution,
    });
  } catch (error) {
    postSolveResponse({
      requestId,
      type: String(data?.type || ""),
      error: error instanceof Error ? error.message : String(error || "worker-solve-error"),
    });
  }
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("message", (event) => {
    const data = event?.data || {};
    if (
      data?.type !== "solveMoonOrbitInjectWindowForLaunch"
      && data?.type !== "solveMoonDepartureWindow"
    ) {
      return;
    }
    handleSolveRequest(data);
  });
}
