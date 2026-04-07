const DestinationStatus = Object.freeze({
  IDLE: "idle",
  CONNECTING: "connecting",
  LIVE: "live",
  RECONNECTING: "reconnecting",
  STOPPED: "stopped",
  ERROR: "error"
});

const transitions = Object.freeze({
  idle: new Set(["start", "stop", "error"]),
  connecting: new Set(["live", "stop", "error", "retry"]),
  live: new Set(["stop", "error", "retry"]),
  reconnecting: new Set(["live", "stop", "error", "retry"]),
  stopped: new Set(["start", "error"]),
  error: new Set(["start", "stop", "retry"])
});

function eventToStatus(event, currentStatus) {
  switch (event) {
    case "start":
      return DestinationStatus.CONNECTING;
    case "live":
      return DestinationStatus.LIVE;
    case "retry":
      return DestinationStatus.RECONNECTING;
    case "stop":
      return DestinationStatus.STOPPED;
    case "error":
      return DestinationStatus.ERROR;
    default:
      return currentStatus;
  }
}

function transitionStatus(currentStatus, event) {
  const normalized = currentStatus || DestinationStatus.IDLE;
  const allowed = transitions[normalized];
  if (!allowed || !allowed.has(event)) {
    return normalized;
  }

  return eventToStatus(event, normalized);
}

module.exports = {
  DestinationStatus,
  transitionStatus
};
