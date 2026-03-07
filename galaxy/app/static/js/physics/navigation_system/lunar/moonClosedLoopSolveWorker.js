import { solveBestClosedLoopTransferSync } from "./moonClosedLoopSolverCore.js";

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
    const solution = solveBestClosedLoopTransferSync(payload);
    postSolveResponse({
      requestId,
      solution,
      solveReason: solution ? "nbody-closed-loop-optimal" : "nbody-no-solution",
      solvedAtSec: Number(payload?.nowSec),
    });
  } catch (error) {
    postSolveResponse({
      requestId,
      error: error instanceof Error ? error.message : String(error || "worker-solve-error"),
    });
  }
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("message", (event) => {
    const data = event?.data || {};
    if (data?.type !== "solveBestClosedLoopTransfer") {
      return;
    }
    handleSolveRequest(data);
  });
}
