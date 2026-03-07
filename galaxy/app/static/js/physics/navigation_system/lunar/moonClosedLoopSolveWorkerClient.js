let sharedWorker = null;
let nextRequestId = 1;
const pendingCallbacks = new Map();

function canUseWorkerRuntime() {
  return typeof window !== "undefined" && typeof Worker === "function";
}

function handleWorkerMessage(event) {
  const data = event?.data || {};
  const requestId = Number(data?.requestId);
  if (!Number.isFinite(requestId)) {
    return;
  }
  const callback = pendingCallbacks.get(requestId);
  pendingCallbacks.delete(requestId);
  if (typeof callback === "function") {
    callback(data);
  }
}

function handleWorkerError(error) {
  for (const [, callback] of pendingCallbacks) {
    if (typeof callback === "function") {
      callback({
        error: error instanceof Error ? error.message : String(error || "worker-error"),
      });
    }
  }
  pendingCallbacks.clear();
  sharedWorker = null;
}

function getSharedWorker() {
  if (!canUseWorkerRuntime()) {
    return null;
  }
  if (!sharedWorker) {
    sharedWorker = new Worker(
      new URL("./moonClosedLoopSolveWorker.js", import.meta.url),
      { type: "module" },
    );
    sharedWorker.addEventListener("message", handleWorkerMessage);
    sharedWorker.addEventListener("error", handleWorkerError);
  }
  return sharedWorker;
}

export function canUseMoonClosedLoopSolveWorker() {
  return canUseWorkerRuntime();
}

export function requestMoonClosedLoopTransferSolve({
  runtime = null,
  payload = null,
} = {}) {
  if (!runtime || typeof runtime !== "object" || !payload || typeof payload !== "object") {
    return false;
  }
  if (runtime.workerPending) {
    return false;
  }
  const worker = getSharedWorker();
  if (!worker) {
    return false;
  }
  const requestId = nextRequestId;
  nextRequestId += 1;
  runtime.workerPending = true;
  runtime.workerRequestId = requestId;
  runtime.workerRequestedAtSec = Number(payload?.nowSec);
  runtime.workerResult = null;
  runtime.workerResponseReady = false;
  runtime.workerError = "";
  runtime.workerSolveReason = "";
  runtime.workerSolvedAtSec = Number.NaN;
  pendingCallbacks.set(requestId, (message = {}) => {
    runtime.workerPending = false;
    runtime.workerRequestId = null;
    runtime.workerRequestedAtSec = null;
    runtime.workerResult = message?.solution || null;
    runtime.workerResponseReady = true;
    runtime.workerError = String(message?.error || "");
    runtime.workerSolveReason = String(message?.solveReason || "");
    runtime.workerSolvedAtSec = Number(message?.solvedAtSec);
  });
  worker.postMessage({
    type: "solveBestClosedLoopTransfer",
    requestId,
    payload,
  });
  return true;
}

export function consumeMoonClosedLoopTransferSolveResult(runtime = null) {
  if (!runtime || typeof runtime !== "object") {
    return null;
  }
  if (!runtime.workerResponseReady) {
    return null;
  }
  const response = {
    solution: runtime.workerResult || null,
    error: String(runtime.workerError || ""),
    solveReason: String(runtime.workerSolveReason || ""),
    solvedAtSec: Number(runtime.workerSolvedAtSec),
  };
  runtime.workerResult = null;
  runtime.workerResponseReady = false;
  runtime.workerError = "";
  runtime.workerSolveReason = "";
  runtime.workerSolvedAtSec = Number.NaN;
  return response;
}
