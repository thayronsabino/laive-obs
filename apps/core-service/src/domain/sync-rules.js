function shouldStartForObsEvent(destination, obsStreamingActive) {
  return Boolean(
    destination &&
      destination.syncWithObsStart &&
      obsStreamingActive &&
      destination.enabled !== false
  );
}

function shouldStopForObsEvent(destination, obsStreamingActive) {
  return Boolean(
    destination &&
      destination.syncWithObsStop &&
      !obsStreamingActive &&
      destination.enabled !== false
  );
}

module.exports = {
  shouldStartForObsEvent,
  shouldStopForObsEvent
};
