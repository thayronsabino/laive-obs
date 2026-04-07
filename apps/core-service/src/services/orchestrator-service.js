const {
  shouldStartForObsEvent,
  shouldStopForObsEvent
} = require("../domain/sync-rules");

class OrchestratorService {
  constructor(options) {
    this.eventBus = options.eventBus;
    this.destinationService = options.destinationService;
    this.ffmpegService = options.ffmpegService;
    this.ingestService = options.ingestService;
  }

  startAll(source = "manual") {
    const destinations = this.destinationService.listInternal();
    const started = [];
    const skipped = [];

    destinations.forEach((destination) => {
      if (destination.enabled === false) {
        skipped.push({ id: destination.id, reason: "disabled" });
        return;
      }
      const result = this.startOne(destination.id, source);
      if (result.started) {
        started.push(destination.id);
      } else {
        skipped.push({ id: destination.id, reason: result.reason });
      }
    });

    return { started, skipped };
  }

  stopAll(source = "manual") {
    const destinations = this.destinationService.listInternal();
    const stopped = [];
    const skipped = [];

    destinations.forEach((destination) => {
      const result = this.stopOne(destination.id, source);
      if (result.stopped) {
        stopped.push(destination.id);
      } else {
        skipped.push({ id: destination.id, reason: result.reason });
      }
    });

    return { stopped, skipped };
  }

  startOne(destinationId, source = "manual") {
    const destination = this.destinationService.getInternal(destinationId);
    if (!destination) {
      return { started: false, reason: "not-found" };
    }
    if (destination.enabled === false) {
      return { started: false, reason: "disabled" };
    }

    const publishUrl = this.destinationService.getPublishUrl(destination);
    const inputUrl = this.ingestService.getMasterInputUrl();
    const result = this.ffmpegService.start(destination, inputUrl, publishUrl);

    if (result.started) {
      this.eventBus.publish("orchestrator.start_one", {
        destinationId,
        source
      });
    }

    return result;
  }

  stopOne(destinationId, source = "manual") {
    const result = this.ffmpegService.stop(destinationId);
    if (result.stopped) {
      this.eventBus.publish("orchestrator.stop_one", {
        destinationId,
        source
      });
    }
    return result;
  }

  onObsStreamingStateChanged(active) {
    const destinations = this.destinationService.listInternal();
    destinations.forEach((destination) => {
      if (shouldStartForObsEvent(destination, active)) {
        this.startOne(destination.id, "obs");
      }
      if (shouldStopForObsEvent(destination, active)) {
        this.stopOne(destination.id, "obs");
      }
    });
  }

  getStatusSnapshot() {
    return {
      activePipelines: this.ffmpegService.getRuntimeSnapshot()
    };
  }
}

module.exports = {
  OrchestratorService
};
