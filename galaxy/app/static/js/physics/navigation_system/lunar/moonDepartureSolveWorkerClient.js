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
    try {
      sharedWorker = new Worker(
        new URL("./moonDepartureSolveWorker.js", import.meta.url),
        { type: "module" },
      );
      sharedWorker.addEventListener("message", handleWorkerMessage);
      sharedWorker.addEventListener("error", handleWorkerError);
    } catch (_error) {
      sharedWorker = null;
      return null;
    }
  }
  return sharedWorker;
}

export function canUseMoonDepartureSolveWorker() {
  return canUseWorkerRuntime();
}

export function requestMoonDepartureSolve({
  type = "",
  payload = null,
  onComplete = null,
} = {}) {
  if (typeof onComplete !== "function" || !payload || typeof payload !== "object") {
    return false;
  }
  const worker = getSharedWorker();
  if (!worker) {
    return false;
  }
  const requestId = nextRequestId;
  nextRequestId += 1;
  pendingCallbacks.set(requestId, onComplete);
  try {
    worker.postMessage({
      type: String(type || ""),
      requestId,
      payload,
    });
  } catch (_error) {
    pendingCallbacks.delete(requestId);
    return false;
  }
  return true;
}

export function requestMoonDepartureSolvePromise({
  type = "",
  payload = null,
} = {}) {
  return new Promise((resolve) => {
    const requested = requestMoonDepartureSolve({
      type,
      payload,
      onComplete: (message = {}) => {
        resolve(message || {});
      },
    });
    if (!requested) {
      resolve({
        error: "worker-unavailable",
        type: String(type || ""),
        solution: null,
      });
    }
  });
}
