class ProjectorRegistryService {
  constructor(options = {}) {
    this.entries = new Map();
    this.platform = options.platform || process.platform;
  }

  list() {
    return [...this.entries.values()]
      .map((entry) => ({ ...entry }))
      .sort((left, right) =>
        String(left.destinationName || "").localeCompare(
          String(right.destinationName || "")
        )
      );
  }

  get(destinationId) {
    const entry = this.entries.get(destinationId);
    return entry ? { ...entry } : null;
  }

  registerDestinationProjector(destination, options = {}) {
    const sceneBinding = destination && destination.sceneBinding ? destination.sceneBinding : {};
    const now = new Date().toISOString();
    const previous = this.entries.get(destination.id);
    const closeCapability = options.closeCapability || {
      supported: false,
      reason: "obs_websocket_has_no_close_projector_request"
    };
    const next = {
      destinationId: destination.id,
      destinationName: destination.name,
      sceneName: sceneBinding.sceneName || "",
      projectorWindowTitle: sceneBinding.projectorWindowTitle || "",
      captureMethod: sceneBinding.captureMethod || "",
      x11WindowId: sceneBinding.x11WindowId || "",
      x11Display: sceneBinding.x11Display || "",
      captureDisplayIndex:
        sceneBinding.captureDisplayIndex !== undefined &&
        sceneBinding.captureDisplayIndex !== null
          ? Number(sceneBinding.captureDisplayIndex)
          : null,
      platform: this.platform,
      managedByLaive: true,
      closeSupported: Boolean(closeCapability.supported),
      closeReason: closeCapability.reason || null,
      openCount: previous ? previous.openCount + 1 : 1,
      createdAt: previous ? previous.createdAt : now,
      lastOpenedAt: now,
      lastEnsuredAt: options.ensured ? now : previous ? previous.lastEnsuredAt : null,
      lastDetectedAt: options.detected ? now : previous ? previous.lastDetectedAt : null,
      lastClosedAt: previous ? previous.lastClosedAt : null,
      lastCloseAttemptAt: previous ? previous.lastCloseAttemptAt : null
    };

    this.entries.set(destination.id, next);
    return { ...next };
  }

  forgetDestination(destinationId) {
    const current = this.entries.get(destinationId);
    if (!current) {
      return null;
    }
    this.entries.delete(destinationId);
    return { ...current };
  }

  async ensureDestinationProjector(destination, obsService) {
    if (!destination || destination.videoSourceMode !== "scene_projector_capture") {
      return null;
    }
    const sceneBinding = destination.sceneBinding || {};
    if (!sceneBinding.sceneName) {
      return null;
    }

    await obsService.openSourceProjector({
      sourceName: sceneBinding.sceneName,
      monitorIndex: -1
    });

    return this.registerDestinationProjector(destination, {
      ensured: true,
      closeCapability: obsService.getProjectorCloseCapability(sceneBinding)
    });
  }

  async reopenDestinationProjector(destination, obsService) {
    if (!destination) {
      return null;
    }
    return this.ensureDestinationProjector(destination, obsService);
  }

  async reopenAll(destinations, obsService) {
    const reopened = [];
    const skipped = [];

    for (const destination of destinations || []) {
      if (!destination || destination.videoSourceMode !== "scene_projector_capture") {
        continue;
      }
      const sceneBinding = destination.sceneBinding || {};
      if (!sceneBinding.sceneName) {
        skipped.push({
          destinationId: destination.id,
          reason: "missing-scene-binding"
        });
        continue;
      }
      await this.ensureDestinationProjector(destination, obsService);
      reopened.push(destination.id);
    }

    return {
      reopened,
      skipped
    };
  }

  closeDestinationProjector(destinationId, obsService) {
    const current = this.entries.get(destinationId);
    if (!current) {
      return null;
    }

    const now = new Date().toISOString();
    current.lastCloseAttemptAt = now;
    const result = obsService.closeProjectorWindow(current);
    if (result && result.closed) {
      current.lastClosedAt = now;
    }
    this.entries.set(destinationId, current);
    return {
      ...current,
      closeResult: result
    };
  }
}

module.exports = {
  ProjectorRegistryService
};
