const { spawn, spawnSync } = require("child_process");
const { inferProtocolFromUrl } = require("../domain/validators");

function computeRetryDelay(retry, baseMs, maxMs, jitterRatio) {
  const exponential = Math.min(baseMs * 2 ** retry, maxMs);
  const jitter = Math.round(exponential * jitterRatio * Math.random());
  return Math.min(exponential + jitter, maxMs);
}

class FFmpegService {
  constructor(options) {
    this.eventBus = options.eventBus;
    this.ffmpegBin = options.ffmpegBin;
    this.ffprobeBin = options.ffprobeBin || "ffprobe";
    this.spawnProcessFn = options.spawnProcessFn || spawn;
    this.maxRetries = options.maxRetries;
    this.retryBaseMs = options.retryBaseMs || 1000;
    this.retryMaxMs = options.retryMaxMs || 8000;
    this.retryJitterRatio =
      options.retryJitterRatio === undefined ? 0.25 : options.retryJitterRatio;
    this.connectTimeoutMs = options.connectTimeoutMs || 15000;
    this.stopGraceMs = options.stopGraceMs || 5000;
    this.liveConfirmMs = options.liveConfirmMs || 1200;
    this.stallTimeoutMs = options.stallTimeoutMs || 45000;
    this.stallMonitorIntervalMs = options.stallMonitorIntervalMs || 5000;
    this.onDestinationStatusChange = options.onDestinationStatusChange;
    this.probeEncodersFn = options.probeEncodersFn;
    this.platform = options.platform || process.platform;
    this.spawnSyncFn = options.spawnSyncFn || spawnSync;
    this.processes = new Map();
    this.monitorTimer = null;
    this.encoderCapabilities = null;
  }

  getTransmissionReadiness(destinations, sourceUrl) {
    const sourceAnalysis = this.probeSourceStreams(sourceUrl);
    const items = (destinations || []).map((destination) =>
      this.buildDestinationReadiness(destination, sourceUrl, sourceAnalysis)
    );

    return {
      sourceUrl,
      generatedAt: new Date().toISOString(),
      sourceAnalysis,
      summary: {
        ready: items.filter((item) => item.status === "ready").length,
        warning: items.filter((item) => item.status === "warning").length,
        blocked: items.filter((item) => item.status === "blocked").length,
        total: items.length
      },
      destinations: items
    };
  }

  isRunning(destinationId) {
    return this.processes.has(destinationId);
  }

  start(destination, sourceUrl, publishUrl) {
    if (this.processes.has(destination.id)) {
      return { started: false, reason: "already-running" };
    }

    const processState = {
      destinationId: destination.id,
      retries: 0,
      stopping: false,
      sourceUrl,
      publishUrl
    };

    try {
      this.eventBus.publish("destination.connecting", {
        destinationId: destination.id,
        name: destination.name
      });
      this.onDestinationStatusChange(destination.id, "connecting");

      this.spawnProcess(destination, processState);
      return { started: true };
    } catch (error) {
      this.eventBus.publish("destination.error", {
        destinationId: destination.id,
        message: error.message
      });
      this.onDestinationStatusChange(destination.id, "error", error.message);
      return {
        started: false,
        reason: "invalid-config",
        errorMessage: error.message,
        details: Array.isArray(error.details) ? error.details : [],
        guidance: Array.isArray(error.guidance) ? error.guidance : []
      };
    }
  }

  stop(destinationId) {
    const state = this.processes.get(destinationId);
    if (!state) {
      return { stopped: false, reason: "not-running" };
    }

    state.stopping = true;

    try {
      if (state.process.stdin) {
        state.process.stdin.write("q\n");
      } else {
        state.process.kill("SIGTERM");
      }
    } catch (_) {
      try {
        state.process.kill("SIGTERM");
      } catch (__) {
        // ignore
      }
    }
    this.scheduleForceStop(state);

    return { stopped: true };
  }

  stopAll() {
    const ids = [...this.processes.keys()];
    ids.forEach((id) => this.stop(id));
    return ids.length;
  }

  getRuntimeSnapshot() {
    return [...this.processes.values()].map((state) => ({
      destinationId: state.destinationId,
      pid: state.process.pid,
      retries: state.retries,
      stopping: Boolean(state.stopping),
      isLive: Boolean(state.isLive),
      sourceUrl: state.sourceUrl,
      publishUrl: state.publishUrl
    }));
  }

  spawnProcess(destination, processState) {
    this.validateSceneCaptureBinding(destination);
    const args = this.buildArgs(destination, processState.sourceUrl, processState.publishUrl);
    const child = this.spawnProcessFn(this.ffmpegBin, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    processState.process = child;
    processState.lastStartAt = new Date().toISOString();
    processState.handledUnexpectedExit = false;
    processState.isLive = false;
    processState.connectingTimer = null;
    processState.stopTimer = null;
    processState.stallKillRequested = false;
    processState.lastProgressAt = Date.now();
    processState.stderrBuffer = "";
    this.processes.set(destination.id, processState);
    this.ensureMonitorLoop();

    this.eventBus.publish("engine.process_started", {
      destinationId: destination.id,
      pid: child.pid,
      args
    });

    const liveTimer = setTimeout(() => {
      processState.isLive = true;
      this.clearConnectingTimeout(processState);
      this.eventBus.publish("destination.live", {
        destinationId: destination.id,
        pid: child.pid
      });
      this.onDestinationStatusChange(destination.id, "live");
    }, this.liveConfirmMs);

    processState.connectingTimer = setTimeout(() => {
      if (processState.stopping || processState.isLive) {
        return;
      }
      this.eventBus.publish("engine.watchdog_timeout", {
        destinationId: destination.id,
        timeoutMs: this.connectTimeoutMs
      });
      try {
        child.kill("SIGTERM");
      } catch (_) {
        // ignore
      }
    }, this.connectTimeoutMs);

    child.stderr.on("data", (chunk) => {
      processState.stderrBuffer += String(chunk || "");
      this.consumeStderrBuffer(destination, processState);
    });

    child.on("error", (error) => {
      clearTimeout(liveTimer);
      this.clearConnectingTimeout(processState);
      this.clearStopTimer(processState);
      this.handleUnexpectedExitOnce(destination, processState, error);
    });

    child.on("exit", (code, signal) => {
      clearTimeout(liveTimer);
      this.clearConnectingTimeout(processState);
      this.clearStopTimer(processState);
      const wasStopped = processState.stopping;
      this.processes.delete(destination.id);
      if (this.processes.size === 0) {
        this.stopMonitorLoop();
      }

      this.eventBus.publish("engine.process_exited", {
        destinationId: destination.id,
        code,
        signal,
        stoppedByUser: wasStopped
      });

      if (wasStopped) {
        this.eventBus.publish("destination.stopped", {
          destinationId: destination.id
        });
        this.onDestinationStatusChange(destination.id, "stopped");
        return;
      }

      this.handleUnexpectedExitOnce(
        destination,
        processState,
        new Error(`ffmpeg exited with code ${code}`)
      );
    });
  }

  consumeStderrBuffer(destination, processState) {
    while (true) {
      const newlineIdx = processState.stderrBuffer.indexOf("\n");
      if (newlineIdx < 0) {
        return;
      }

      const line = processState.stderrBuffer.slice(0, newlineIdx).trim();
      processState.stderrBuffer = processState.stderrBuffer.slice(newlineIdx + 1);
      this.handleStderrLine(destination, processState, line);
    }
  }

  handleStderrLine(destination, processState, line) {
    if (!line) {
      return;
    }

    if (this.isProgressLine(line)) {
      processState.lastProgressAt = Date.now();
      return;
    }

    this.eventBus.publish("engine.log", {
      destinationId: destination.id,
      level: "stderr",
      message: line
    });
  }

  isProgressLine(line) {
    return (
      line.startsWith("progress=") ||
      line.startsWith("out_time_ms=") ||
      line.startsWith("out_time_us=") ||
      line.startsWith("total_size=") ||
      line.startsWith("frame=") ||
      line.startsWith("fps=")
    );
  }

  ensureMonitorLoop() {
    if (this.monitorTimer || this.stallTimeoutMs <= 0) {
      return;
    }

    const intervalMs = Math.max(250, this.stallMonitorIntervalMs);
    this.monitorTimer = setInterval(() => {
      this.checkStalledPipelines();
    }, intervalMs);
    if (typeof this.monitorTimer.unref === "function") {
      this.monitorTimer.unref();
    }
  }

  stopMonitorLoop() {
    if (!this.monitorTimer) {
      return;
    }
    clearInterval(this.monitorTimer);
    this.monitorTimer = null;
  }

  checkStalledPipelines() {
    if (this.stallTimeoutMs <= 0) {
      return;
    }

    const now = Date.now();
    this.processes.forEach((processState) => {
      if (!processState.isLive || processState.stopping || processState.stallKillRequested) {
        return;
      }

      const staleForMs = now - processState.lastProgressAt;
      if (staleForMs < this.stallTimeoutMs) {
        return;
      }

      processState.stallKillRequested = true;
      this.eventBus.publish("engine.pipeline_stalled", {
        destinationId: processState.destinationId,
        staleForMs,
        timeoutMs: this.stallTimeoutMs
      });

      try {
        processState.process.kill("SIGTERM");
      } catch (_) {
        try {
          processState.process.kill();
        } catch (__) {
          // ignore
        }
      }
      this.scheduleForceStop(processState);
    });
  }

  handleUnexpectedExitOnce(destination, processState, error) {
    if (processState.handledUnexpectedExit) {
      return;
    }
    processState.handledUnexpectedExit = true;
    this.handleUnexpectedExit(destination, processState, error);
  }

  handleUnexpectedExit(destination, processState, error) {
    if (processState.retries >= this.maxRetries) {
      this.eventBus.publish("destination.error", {
        destinationId: destination.id,
        message: error.message
      });
      this.onDestinationStatusChange(destination.id, "error", error.message);
      return;
    }

    processState.retries += 1;
    const delayMs = computeRetryDelay(
      processState.retries,
      this.retryBaseMs,
      this.retryMaxMs,
      this.retryJitterRatio
    );
    this.eventBus.publish("engine.retrying", {
      destinationId: destination.id,
      retry: processState.retries,
      delayMs,
      reason: error.message
    });
    this.eventBus.publish("destination.reconnecting", {
      destinationId: destination.id,
      retry: processState.retries
    });
    this.onDestinationStatusChange(destination.id, "reconnecting", error.message);

    setTimeout(() => {
      if (processState.stopping) {
        return;
      }
      this.spawnProcess(destination, processState);
    }, delayMs);
  }

  clearConnectingTimeout(processState) {
    if (processState.connectingTimer) {
      clearTimeout(processState.connectingTimer);
      processState.connectingTimer = null;
    }
  }

  clearStopTimer(processState) {
    if (processState.stopTimer) {
      clearTimeout(processState.stopTimer);
      processState.stopTimer = null;
    }
  }

  scheduleForceStop(processState) {
    this.clearStopTimer(processState);

    processState.stopTimer = setTimeout(() => {
      const child = processState.process;
      if (!child || child.exitCode !== null) {
        return;
      }

      this.eventBus.publish("engine.force_kill_requested", {
        destinationId: processState.destinationId,
        timeoutMs: this.stopGraceMs
      });

      try {
        child.kill("SIGKILL");
      } catch (_) {
        try {
          child.kill();
        } catch (__) {
          // ignore
        }
      }
    }, this.stopGraceMs);
  }

  buildArgs(destination, sourceUrl, publishUrl) {
    const inputContext = this.buildInputContext(destination, sourceUrl);
    const base = inputContext.baseArgs;
    const protocol = this.getDestinationProtocol(destination, publishUrl);
    const outputMode = destination.outputMode || "inherit";
    if (protocol === "whip") {
      return this.buildWhipArgs(
        destination,
        base,
        publishUrl,
        outputMode,
        inputContext
      );
    }
    if (outputMode === "custom") {
      return this.buildCustomArgs(
        destination,
        base,
        publishUrl,
        protocol,
        inputContext
      );
    }
    return this.buildInheritArgs(
      destination,
      base,
      publishUrl,
      protocol,
      inputContext
    );
  }

  buildInputContext(destination, sourceUrl) {
    const sourceMode = destination.videoSourceMode || "master_ingest";
    const commonPrefix = [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-nostats",
      "-stats_period",
      "2",
      "-progress",
      "pipe:2"
    ];

    if (sourceMode !== "scene_projector_capture") {
      return {
        sourceMode: "master_ingest",
        videoInputIndex: 0,
        audioInputIndex: 0,
        baseArgs: [...commonPrefix, "-i", sourceUrl]
      };
    }

    const sceneBinding = destination.sceneBinding || {};
    const captureFramerate =
      Number(destination.videoProfile && destination.videoProfile.fps) > 0
        ? Number(destination.videoProfile.fps)
        : 30;
    if (this.platform === "darwin") {
      if (sceneBinding.captureMethod !== "darwin_display_crop") {
        throw new Error(
          "scene_projector_capture on macOS requires `sceneBinding.captureMethod = darwin_display_crop`."
        );
      }
      if (!Number.isInteger(Number(sceneBinding.captureDisplayIndex))) {
        throw new Error(
          "scene_projector_capture on macOS requires `sceneBinding.captureDisplayIndex`."
        );
      }
      return {
        sourceMode: "scene_projector_capture",
        videoInputIndex: 0,
        audioInputIndex: 1,
        baseArgs: [
          ...commonPrefix,
          "-f",
          "avfoundation",
          "-capture_cursor",
          "0",
          "-capture_mouse_clicks",
          "0",
          "-framerate",
          String(captureFramerate),
          "-video_device_index",
          String(Number(sceneBinding.captureDisplayIndex)),
          "-i",
          ":none",
          "-thread_queue_size",
          "512",
          "-i",
          sourceUrl
        ]
      };
    }
    if (this.platform === "linux") {
      if (sceneBinding.captureMethod !== "linux_x11_window_id") {
        throw new Error(
          "scene_projector_capture on Linux requires `sceneBinding.captureMethod = linux_x11_window_id`."
        );
      }
      if (!sceneBinding.x11WindowId) {
        throw new Error(
          "scene_projector_capture on Linux requires `sceneBinding.x11WindowId`."
        );
      }
      const x11Display = sceneBinding.x11Display || process.env.DISPLAY || "";
      if (!x11Display) {
        throw new Error(
          "scene_projector_capture on Linux currently requires an X11 DISPLAY."
        );
      }
      return {
        sourceMode: "scene_projector_capture",
        videoInputIndex: 0,
        audioInputIndex: 1,
        baseArgs: [
          ...commonPrefix,
          "-f",
          "x11grab",
          "-framerate",
          String(captureFramerate),
          "-window_id",
          String(sceneBinding.x11WindowId),
          "-i",
          x11Display,
          "-thread_queue_size",
          "512",
          "-i",
          sourceUrl
        ]
      };
    }
    if (this.platform !== "win32") {
      throw new Error(
        "scene_projector_capture is currently supported only on Windows, macOS and Linux."
      );
    }
    if (!sceneBinding.projectorWindowTitle) {
      throw new Error(
        "scene_projector_capture requires `sceneBinding.projectorWindowTitle`."
      );
    }

    return {
      sourceMode: "scene_projector_capture",
      videoInputIndex: 0,
      audioInputIndex: 1,
      baseArgs: [
        ...commonPrefix,
        "-f",
        "gdigrab",
        "-framerate",
        String(captureFramerate),
        "-i",
        `title=${sceneBinding.projectorWindowTitle}`,
        "-thread_queue_size",
        "512",
        "-i",
        sourceUrl
      ]
    };
  }

  getSceneCapturePlatformStatus(destination) {
    if (!destination || destination.videoSourceMode !== "scene_projector_capture") {
      return {
        platform: this.platform,
        supported: true,
        ready: true,
        reason: null,
        guidance: []
      };
    }

    if (this.platform === "win32") {
      return {
        platform: "win32",
        supported: true,
        ready: true,
        reason: null,
        guidance: []
      };
    }

    if (this.platform === "darwin") {
      return {
        platform: "darwin",
        supported: true,
        ready: true,
        reason: null,
        guidance: [
          "macOS requires Screen Recording permission for FFmpeg capture.",
          "macOS may also require Accessibility permission to inspect OBS windows for projector detection."
        ]
      };
    }

    if (this.platform === "linux") {
      const display = String(process.env.DISPLAY || "").trim();
      const waylandDisplay = String(process.env.WAYLAND_DISPLAY || "").trim();
      if (!display) {
        return {
          platform: "linux",
          supported: false,
          ready: false,
          reason: waylandDisplay
            ? "wayland_not_supported_by_current_capture_path"
            : "x11_display_missing",
          guidance: waylandDisplay
            ? [
                "Current Linux scene capture path uses FFmpeg x11grab and requires an X11 DISPLAY.",
                "Run OBS under X11/XWayland or provide an X11 DISPLAY visible to the LAIVE OBS process."
              ]
            : [
                "Set DISPLAY for the desktop session that owns the OBS projector window.",
                "Projector discovery and capture on Linux currently require X11 plus wmctrl."
              ]
        };
      }

      return {
        platform: "linux",
        supported: true,
        ready: true,
        reason: null,
        guidance: [
          "Linux scene projector capture currently targets X11 and uses FFmpeg x11grab plus wmctrl for discovery."
        ]
      };
    }

    return {
      platform: this.platform,
      supported: false,
      ready: false,
      reason: "platform_not_supported",
      guidance: [
        "scene_projector_capture is currently supported only on Windows, macOS and Linux."
      ]
    };
  }

  validateSceneCaptureBinding(destination) {
    if (!destination || destination.videoSourceMode !== "scene_projector_capture") {
      return {
        ok: true,
        skipped: true,
        platform: this.platform,
        reason: "not_scene_projector_capture"
      };
    }

    const platformStatus = this.getSceneCapturePlatformStatus(destination);
    if (!platformStatus.supported || !platformStatus.ready) {
      throw this.createSceneCaptureValidationError(
        "Scene capture platform prerequisites are not satisfied.",
        {
          details: platformStatus.reason ? [platformStatus.reason] : [],
          guidance: platformStatus.guidance || []
        }
      );
    }

    const args = this.buildSceneCaptureProbeArgs(destination);
    let result;
    try {
      result = this.spawnSyncFn(this.ffmpegBin, args, {
        windowsHide: true,
        encoding: "utf8",
        timeout: 8000
      });
    } catch (error) {
      throw this.createSceneCaptureValidationError(
        `Failed to execute FFmpeg capture probe: ${error.message}`,
        {
          details: ["ffmpeg_probe_spawn_failed"]
        }
      );
    }

    if (result.error) {
      throw this.createSceneCaptureValidationError(
        `Failed to execute FFmpeg capture probe: ${result.error.message}`,
        {
          details: ["ffmpeg_probe_spawn_failed"]
        }
      );
    }

    if (Number(result.status || 0) !== 0) {
      const stderr = `${result.stderr || ""}\n${result.stdout || ""}`.trim();
      const analysis = this.analyzeSceneCaptureProbeFailure(stderr, destination);
      throw this.createSceneCaptureValidationError(
        analysis.message,
        {
          details: analysis.details,
          guidance: analysis.guidance
        }
      );
    }

    return {
      ok: true,
      platform: this.platform,
      captureMethod:
        destination.sceneBinding && destination.sceneBinding.captureMethod
          ? destination.sceneBinding.captureMethod
          : null,
      validatedAt: new Date().toISOString()
    };
  }

  captureSceneCapturePreview(destination) {
    if (!destination || destination.videoSourceMode !== "scene_projector_capture") {
      throw this.createSceneCaptureValidationError(
        "Destination is not configured for scene projector capture.",
        {
          details: ["not_scene_projector_capture"]
        }
      );
    }

    const platformStatus = this.getSceneCapturePlatformStatus(destination);
    if (!platformStatus.supported || !platformStatus.ready) {
      throw this.createSceneCaptureValidationError(
        "Scene capture platform prerequisites are not satisfied.",
        {
          details: platformStatus.reason ? [platformStatus.reason] : [],
          guidance: platformStatus.guidance || []
        }
      );
    }

    const args = this.buildSceneCapturePreviewArgs(destination);
    let result;
    try {
      result = this.spawnSyncFn(this.ffmpegBin, args, {
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 8 * 1024 * 1024
      });
    } catch (error) {
      throw this.createSceneCaptureValidationError(
        `Failed to execute FFmpeg capture preview: ${error.message}`,
        {
          details: ["ffmpeg_preview_spawn_failed"]
        }
      );
    }

    if (result.error) {
      throw this.createSceneCaptureValidationError(
        `Failed to execute FFmpeg capture preview: ${result.error.message}`,
        {
          details: ["ffmpeg_preview_spawn_failed"]
        }
      );
    }

    if (Number(result.status || 0) !== 0) {
      const stderr = `${result.stderr || ""}\n${result.stdout || ""}`.trim();
      const analysis = this.analyzeSceneCaptureProbeFailure(stderr, destination);
      throw this.createSceneCaptureValidationError(analysis.message, {
        details: analysis.details,
        guidance: analysis.guidance
      });
    }

    const buffer = Buffer.isBuffer(result.stdout)
      ? result.stdout
      : Buffer.from(result.stdout || "");
    if (!buffer.length) {
      throw this.createSceneCaptureValidationError(
        "FFmpeg returned an empty preview frame.",
        {
          details: ["empty_preview_frame"]
        }
      );
    }

    return {
      contentType: "image/jpeg",
      buffer,
      platform: this.platform,
      captureMethod:
        destination.sceneBinding && destination.sceneBinding.captureMethod
          ? destination.sceneBinding.captureMethod
          : null,
      generatedAt: new Date().toISOString()
    };
  }

  createSceneCaptureValidationError(message, options = {}) {
    const error = new Error(message);
    error.code = "CAPTURE_VALIDATION_FAILED";
    error.details = Array.isArray(options.details) ? options.details : [];
    error.guidance = Array.isArray(options.guidance) ? options.guidance : [];
    return error;
  }

  buildSceneCaptureProbeArgs(destination) {
    const sceneBinding = destination.sceneBinding || {};
    const captureFramerate =
      Number(destination.videoProfile && destination.videoProfile.fps) > 0
        ? Number(destination.videoProfile.fps)
        : 1;

    if (this.platform === "darwin") {
      return [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "avfoundation",
        "-capture_cursor",
        "0",
        "-capture_mouse_clicks",
        "0",
        "-framerate",
        String(Math.max(1, captureFramerate)),
        "-video_device_index",
        String(Number(sceneBinding.captureDisplayIndex)),
        "-i",
        ":none",
        "-frames:v",
        "1",
        "-vf",
        `crop=${Number(sceneBinding.captureCropWidth)}:${Number(
          sceneBinding.captureCropHeight
        )}:${Number(sceneBinding.captureCropX)}:${Number(
          sceneBinding.captureCropY
        )}`,
        "-f",
        "null",
        "-"
      ];
    }

    if (this.platform === "linux") {
      const x11Display = sceneBinding.x11Display || process.env.DISPLAY || "";
      return [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "x11grab",
        "-framerate",
        String(Math.max(1, captureFramerate)),
        "-window_id",
        String(sceneBinding.x11WindowId || ""),
        "-i",
        x11Display,
        "-frames:v",
        "1",
        "-f",
        "null",
        "-"
      ];
    }

    return [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "gdigrab",
      "-framerate",
      String(Math.max(1, captureFramerate)),
      "-i",
      `title=${sceneBinding.projectorWindowTitle || ""}`,
      "-frames:v",
      "1",
      "-f",
      "null",
      "-"
    ];
  }

  buildSceneCapturePreviewArgs(destination) {
    const sceneBinding = destination.sceneBinding || {};
    const captureFramerate =
      Number(destination.videoProfile && destination.videoProfile.fps) > 0
        ? Number(destination.videoProfile.fps)
        : 1;

    if (this.platform === "darwin") {
      return [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "avfoundation",
        "-capture_cursor",
        "0",
        "-capture_mouse_clicks",
        "0",
        "-framerate",
        String(Math.max(1, captureFramerate)),
        "-video_device_index",
        String(Number(sceneBinding.captureDisplayIndex)),
        "-i",
        ":none",
        "-frames:v",
        "1",
        "-vf",
        `crop=${Number(sceneBinding.captureCropWidth)}:${Number(
          sceneBinding.captureCropHeight
        )}:${Number(sceneBinding.captureCropX)}:${Number(
          sceneBinding.captureCropY
        )}`,
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1"
      ];
    }

    if (this.platform === "linux") {
      const x11Display = sceneBinding.x11Display || process.env.DISPLAY || "";
      return [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "x11grab",
        "-framerate",
        String(Math.max(1, captureFramerate)),
        "-window_id",
        String(sceneBinding.x11WindowId || ""),
        "-i",
        x11Display,
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1"
      ];
    }

    return [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "gdigrab",
      "-framerate",
      String(Math.max(1, captureFramerate)),
      "-i",
      `title=${sceneBinding.projectorWindowTitle || ""}`,
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1"
    ];
  }

  analyzeSceneCaptureProbeFailure(stderr, destination) {
    const text = String(stderr || "").trim();
    const normalized = text.toLowerCase();
    const sceneBinding = destination.sceneBinding || {};
    const details = [];
    const guidance = [];

    if (this.platform === "darwin") {
      if (
        normalized.includes("not authorized") ||
        normalized.includes("permission denied") ||
        normalized.includes("cannot open display")
      ) {
        details.push("macos_screen_recording_permission_missing");
        guidance.push(
          "Grant Screen Recording permission to the terminal/app that runs LAIVE OBS and FFmpeg."
        );
      }
      if (
        !Number.isFinite(Number(sceneBinding.captureCropWidth)) ||
        Number(sceneBinding.captureCropWidth) <= 0 ||
        !Number.isFinite(Number(sceneBinding.captureCropHeight)) ||
        Number(sceneBinding.captureCropHeight) <= 0
      ) {
        details.push("invalid_capture_crop_geometry");
        guidance.push(
          "Run projector detection again so LAIVE OBS can refresh the capture crop geometry."
        );
      }
    } else if (this.platform === "linux") {
      if (normalized.includes("cannot open display")) {
        details.push("x11_display_unavailable");
        guidance.push(
          "Expose the X11 DISPLAY of the active desktop session to the LAIVE OBS process."
        );
      }
      if (normalized.includes("window") && normalized.includes("not found")) {
        details.push("x11_window_not_found");
        guidance.push(
          "Re-open or re-detect the OBS projector so the stored X11 window id stays valid."
        );
      }
    } else {
      if (normalized.includes("error opening input")) {
        details.push("projector_window_not_found");
        guidance.push(
          "Open the OBS projector again or re-run projector detection to refresh the window title."
        );
      }
    }

    if (details.length === 0) {
      details.push("ffmpeg_capture_probe_failed");
    }

    return {
      message:
        text ||
        "FFmpeg could not validate the configured scene capture target.",
      details,
      guidance
    };
  }

  buildInheritArgs(destination, baseArgs, publishUrl, protocol, inputContext) {
    if (inputContext.sourceMode === "scene_projector_capture") {
      return this.buildProjectorInheritArgs(
        destination,
        baseArgs,
        publishUrl,
        protocol,
        inputContext
      );
    }

    const outputFormat = this.getOutputFormat(protocol);
    const bitrate = Number(destination.bitrateKbps || 0);
    if (bitrate > 0) {
      return [
        ...baseArgs,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        "-b:v",
        `${bitrate}k`,
        "-maxrate",
        `${bitrate}k`,
        "-bufsize",
        `${bitrate * 2}k`,
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-f",
        outputFormat,
        publishUrl
      ];
    }

    return [...baseArgs, "-c", "copy", "-f", outputFormat, publishUrl];
  }

  buildProjectorInheritArgs(
    destination,
    baseArgs,
    publishUrl,
    protocol,
    inputContext
  ) {
    const args = [...baseArgs];
    this.appendInputMaps(args, destination, destination.audioProfile || {}, protocol, inputContext);
    const selectedAudioCodec = this.selectAudioCodec(destination, "aac", protocol);
    const bitrate = Number(destination.bitrateKbps || 0);

    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-tune",
      "zerolatency"
    );
    if (bitrate > 0) {
      args.push(
        "-b:v",
        `${bitrate}k`,
        "-maxrate",
        `${bitrate}k`,
        "-bufsize",
        `${bitrate * 2}k`
      );
    }

    if (selectedAudioCodec === "copy") {
      args.push("-c:a:0", "copy");
    } else {
      args.push("-c:a:0", selectedAudioCodec, "-b:a:0", "128k");
    }

    args.push("-f", this.getOutputFormat(protocol), publishUrl);
    return args;
  }

  buildCustomArgs(destination, baseArgs, publishUrl, protocol, inputContext) {
    const videoProfile = destination.videoProfile || {};
    const audioProfile = destination.audioProfile || {};
    const requestedVideoCodec = videoProfile.videoCodec || "libx264";
    const selectedVideoCodec = this.selectVideoCodec(
      destination,
      requestedVideoCodec,
      inputContext
    );
    const selectedAudioCodec = this.selectAudioCodec(
      destination,
      audioProfile.audioCodec || "aac",
      protocol
    );

    const args = [...baseArgs];
    this.appendInputMaps(args, destination, audioProfile, protocol, inputContext);
    const filters = [];
    const sceneBinding = destination.sceneBinding || {};
    if (
      inputContext.sourceMode === "scene_projector_capture" &&
      this.platform === "darwin"
    ) {
      filters.push(
        `crop=${Number(sceneBinding.captureCropWidth)}:${Number(sceneBinding.captureCropHeight)}:${Number(sceneBinding.captureCropX)}:${Number(sceneBinding.captureCropY)}`
      );
    }
    if (Number(videoProfile.width) > 0 && Number(videoProfile.height) > 0) {
      filters.push(
        `scale=${Number(videoProfile.width)}:${Number(videoProfile.height)}`
      );
    }
    if (Number(videoProfile.fps) > 0) {
      args.push("-r", String(Number(videoProfile.fps)));
    } else if (Number(videoProfile.fpsDenominator) > 1) {
      filters.push(`fps=fps=source_fps/${Number(videoProfile.fpsDenominator)}`);
    }
    if (filters.length > 0) {
      args.push("-vf", filters.join(","));
    }

    if (selectedVideoCodec === "copy") {
      args.push("-c:v", "copy");
    } else {
      args.push("-c:v", selectedVideoCodec);
      const preset = videoProfile.preset || "veryfast";
      if (selectedVideoCodec === "libx264" || selectedVideoCodec === "h264_nvenc") {
        args.push("-preset", String(preset));
      }
      if (selectedVideoCodec === "libx264") {
        args.push("-tune", "zerolatency");
      }
      const videoBitrate =
        Number(videoProfile.bitrateKbps || 0) || Number(destination.bitrateKbps || 0);
      if (videoBitrate > 0) {
        args.push(
          "-b:v",
          `${videoBitrate}k`,
          "-maxrate",
          `${videoBitrate}k`,
          "-bufsize",
          `${videoBitrate * 2}k`
        );
      }
      if (Number(videoProfile.gopSec) > 0) {
        const fps = Number(videoProfile.fps) > 0 ? Number(videoProfile.fps) : 30;
        const gop = Math.max(1, Math.round(fps * Number(videoProfile.gopSec)));
        args.push("-g", String(gop));
      }
      if (Number(videoProfile.bFrames) >= 0) {
        args.push("-bf", String(Number(videoProfile.bFrames)));
      }
    }

    if (selectedAudioCodec === "copy") {
      args.push("-c:a:0", "copy");
      if (this.shouldIncludeVodTrack(audioProfile, protocol)) {
        args.push("-c:a:1", "copy");
      }
    } else {
      const audioBitrate = Number(audioProfile.audioBitrateKbps || 128);
      args.push("-c:a:0", selectedAudioCodec, "-b:a:0", `${audioBitrate}k`);
      if (this.shouldIncludeVodTrack(audioProfile, protocol)) {
        args.push("-c:a:1", selectedAudioCodec, "-b:a:1", `${audioBitrate}k`);
      }
    }

    args.push("-f", this.getOutputFormat(protocol), publishUrl);
    return args;
  }

  buildWhipArgs(destination, baseArgs, publishUrl, outputMode, inputContext) {
    const videoProfile = destination.videoProfile || {};
    const audioProfile = destination.audioProfile || {};
    const sceneBinding = destination.sceneBinding || {};
    const args = [...baseArgs];
    this.appendInputMaps(args, destination, audioProfile, "whip", inputContext);
    const filters = [];

    if (
      inputContext.sourceMode === "scene_projector_capture" &&
      this.platform === "darwin"
    ) {
      filters.push(
        `crop=${Number(sceneBinding.captureCropWidth)}:${Number(sceneBinding.captureCropHeight)}:${Number(sceneBinding.captureCropX)}:${Number(sceneBinding.captureCropY)}`
      );
    }

    if (outputMode === "custom" && Number(videoProfile.width) > 0 && Number(videoProfile.height) > 0) {
      filters.push(`scale=${Number(videoProfile.width)}:${Number(videoProfile.height)}`);
    }
    if (outputMode === "custom" && Number(videoProfile.fps) > 0) {
      args.push("-r", String(Number(videoProfile.fps)));
    } else if (outputMode === "custom" && Number(videoProfile.fpsDenominator) > 1) {
      filters.push(`fps=fps=source_fps/${Number(videoProfile.fpsDenominator)}`);
    }
    if (filters.length > 0) {
      args.push("-vf", filters.join(","));
    }

    const videoBitrate =
      outputMode === "custom"
        ? Number(videoProfile.bitrateKbps || 0) || Number(destination.bitrateKbps || 0)
        : Number(destination.bitrateKbps || 0);
    const gopValue =
      outputMode === "custom" && Number(videoProfile.gopSec) > 0
        ? Math.max(
            1,
            Math.round(
              (Number(videoProfile.fps) > 0 ? Number(videoProfile.fps) : 30) *
                Number(videoProfile.gopSec)
            )
          )
        : 60;
    const audioBitrate =
      outputMode === "custom"
        ? Number(audioProfile.audioBitrateKbps || 96)
        : 96;

    args.push(
      "-c:v",
      "libx264",
      "-profile:v",
      "baseline",
      "-preset",
      "veryfast",
      "-tune",
      "zerolatency",
      "-pix_fmt",
      "yuv420p",
      "-bf",
      "0",
      "-g",
      String(gopValue)
    );
    if (videoBitrate > 0) {
      args.push(
        "-b:v",
        `${videoBitrate}k`,
        "-maxrate",
        `${videoBitrate}k`,
        "-bufsize",
        `${videoBitrate * 2}k`
      );
    }

    args.push(
      "-c:a",
      "libopus",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-b:a",
      `${audioBitrate}k`,
      "-f",
      "whip",
      publishUrl
    );
    return args;
  }

  appendInputMaps(args, destination, audioProfile, protocol, inputContext = {}) {
    const videoInputIndex =
      Number.isInteger(inputContext.videoInputIndex) ? inputContext.videoInputIndex : 0;
    const audioInputIndex =
      Number.isInteger(inputContext.audioInputIndex) ? inputContext.audioInputIndex : 0;

    args.push("-map", `${videoInputIndex}:v:0?`);

    const mainTrackIndex = this.getAudioTrackIndex(audioProfile.inputTrackIndex, 0);
    args.push("-map", `${audioInputIndex}:a:${mainTrackIndex}?`);

    const vodTrackIndex = this.getAudioTrackIndex(audioProfile.vodTrackInputIndex, null);
    if (vodTrackIndex === null) {
      return;
    }

    if (vodTrackIndex === mainTrackIndex) {
      this.eventBus.publish("destination.profile_warning", {
        destinationId: destination.id,
        inputTrackIndex: mainTrackIndex,
        vodTrackInputIndex: vodTrackIndex,
        reason: "vod_track_matches_primary_audio"
      });
      return;
    }

    if (!this.protocolSupportsVodTrack(protocol)) {
      this.eventBus.publish("destination.profile_warning", {
        destinationId: destination.id,
        protocol,
        vodTrackInputIndex: vodTrackIndex,
        reason: "vod_track_not_supported_by_protocol"
      });
      return;
    }

    args.push("-map", `${audioInputIndex}:a:${vodTrackIndex}?`);
  }

  getDestinationProtocol(destination, publishUrl) {
    return destination.protocol || inferProtocolFromUrl(publishUrl) || "rtmp";
  }

  getOutputFormat(protocol) {
    if (protocol === "srt" || protocol === "rist") {
      return "mpegts";
    }
    if (protocol === "whip") {
      return "whip";
    }
    return "flv";
  }

  getAudioTrackIndex(value, fallback) {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(0, Math.min(7, Math.floor(parsed)));
  }

  shouldIncludeVodTrack(audioProfile, protocol) {
    const mainTrackIndex = this.getAudioTrackIndex(audioProfile.inputTrackIndex, 0);
    const vodTrackIndex = this.getAudioTrackIndex(audioProfile.vodTrackInputIndex, null);
    return (
      vodTrackIndex !== null &&
      vodTrackIndex !== mainTrackIndex &&
      this.protocolSupportsVodTrack(protocol)
    );
  }

  protocolSupportsVodTrack(protocol) {
    return protocol === "srt" || protocol === "rist";
  }

  probeSourceStreams(sourceUrl) {
    if (!sourceUrl) {
      return {
        ok: false,
        sourceUrl: null,
        reason: "source_url_missing",
        audioTracks: [],
        videoStreams: [],
        guidance: ["Provide a valid ingest source URL before running readiness checks."]
      };
    }

    let result;
    try {
      result = this.spawnSyncFn(
        this.ffprobeBin,
        [
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-print_format",
          "json",
          "-rw_timeout",
          "5000000",
          "-analyzeduration",
          "1000000",
          "-probesize",
          "1000000",
          sourceUrl
        ],
        {
          windowsHide: true,
          encoding: "utf8",
          timeout: 8000,
          maxBuffer: 8 * 1024 * 1024
        }
      );
    } catch (error) {
      return {
        ok: false,
        sourceUrl,
        reason: "ffprobe_spawn_failed",
        audioTracks: [],
        videoStreams: [],
        details: [error.message],
        guidance: [
          "Confirm that FFprobe is installed alongside FFmpeg and available to the LAIVE OBS process."
        ]
      };
    }

    if (result.error) {
      return {
        ok: false,
        sourceUrl,
        reason:
          result.error.code === "ENOENT"
            ? "ffprobe_not_available"
            : "ffprobe_spawn_failed",
        audioTracks: [],
        videoStreams: [],
        details: [String(result.error.message || "")],
        guidance: [
          "Confirm that FFprobe is installed alongside FFmpeg and available to the LAIVE OBS process."
        ]
      };
    }

    if (Number(result.status || 0) !== 0) {
      const stderr = `${result.stderr || ""}`.trim().toLowerCase();
      const reason = stderr.includes("timed out")
        ? "source_probe_timeout"
        : stderr.includes("connection refused") ||
            stderr.includes("cannot open") ||
            stderr.includes("input/output error") ||
            stderr.includes("server returned 404")
          ? "source_not_available"
          : "source_probe_failed";

      return {
        ok: false,
        sourceUrl,
        reason,
        audioTracks: [],
        videoStreams: [],
        details: [String(result.stderr || "").trim()].filter(Boolean),
        guidance: [
          "Start the OBS master ingest and run readiness again.",
          "Confirm that the ingest URL is reachable from this machine."
        ]
      };
    }

    let payload = {};
    try {
      payload = JSON.parse(String(result.stdout || "{}"));
    } catch (_) {
      payload = {};
    }

    const streams = Array.isArray(payload.streams) ? payload.streams : [];
    const audioTracks = streams
      .filter((stream) => stream && stream.codec_type === "audio")
      .map((stream, index) => ({
        inputIndex:
          Number.isInteger(stream.index) && stream.index >= 0 ? stream.index : index,
        codecName: stream.codec_name || null,
        channels:
          Number.isFinite(Number(stream.channels)) && Number(stream.channels) > 0
            ? Number(stream.channels)
            : null,
        sampleRate:
          Number.isFinite(Number(stream.sample_rate)) && Number(stream.sample_rate) > 0
            ? Number(stream.sample_rate)
            : null
      }));
    const videoStreams = streams
      .filter((stream) => stream && stream.codec_type === "video")
      .map((stream, index) => ({
        inputIndex:
          Number.isInteger(stream.index) && stream.index >= 0 ? stream.index : index,
        codecName: stream.codec_name || null,
        width:
          Number.isFinite(Number(stream.width)) && Number(stream.width) > 0
            ? Number(stream.width)
            : null,
        height:
          Number.isFinite(Number(stream.height)) && Number(stream.height) > 0
            ? Number(stream.height)
            : null,
        avgFrameRate: stream.avg_frame_rate || null
      }));

    return {
      ok: true,
      sourceUrl,
      audioTracks,
      videoStreams,
      audioTrackCount: audioTracks.length,
      videoStreamCount: videoStreams.length
    };
  }

  buildDestinationReadiness(destination, sourceUrl, sourceAnalysis) {
    const checks = [];
    const protocol = this.getDestinationProtocol(destination, sourceUrl);
    const audioProfile = destination.audioProfile || {};
    const videoProfile = destination.videoProfile || {};
    const inputTrackIndex = this.getAudioTrackIndex(audioProfile.inputTrackIndex, 0);
    const vodTrackIndex = this.getAudioTrackIndex(audioProfile.vodTrackInputIndex, null);

    try {
      this.buildArgs(destination, sourceUrl, this.buildPublishUrlPreview(destination));
      checks.push({
        code: "ffmpeg_args_valid",
        level: "ok",
        message: "FFmpeg arguments built successfully."
      });
    } catch (error) {
      checks.push({
        code: "ffmpeg_args_invalid",
        level: "blocked",
        message: error.message
      });
    }

    if (destination.videoSourceMode === "scene_projector_capture") {
      try {
        const validation = this.validateSceneCaptureBinding(destination);
        checks.push({
          code: "scene_capture_validated",
          level: "ok",
          message: `Scene projector capture validated on ${validation.platform}.`
        });
      } catch (error) {
        checks.push({
          code: "scene_capture_invalid",
          level: "blocked",
          message: error.message,
          guidance: Array.isArray(error.guidance) ? error.guidance : []
        });
      }
    }

    if (sourceAnalysis && sourceAnalysis.ok) {
      const audioTrackCount = Number(sourceAnalysis.audioTrackCount || 0);
      checks.push({
        code: "source_probe_ok",
        level: "ok",
        message: `Source probe found ${audioTrackCount} audio track(s) and ${Number(
          sourceAnalysis.videoStreamCount || 0
        )} video stream(s).`
      });

      if (audioTrackCount <= inputTrackIndex) {
        checks.push({
          code: "primary_audio_track_missing",
          level: "blocked",
          message: `Primary audio track ${inputTrackIndex} is not available in the current ingest source.`
        });
      } else {
        checks.push({
          code: "primary_audio_track_available",
          level: "ok",
          message: `Primary audio track ${inputTrackIndex} is available in the ingest source.`
        });
      }

      if (vodTrackIndex !== null) {
        if (!this.protocolSupportsVodTrack(protocol)) {
          checks.push({
            code: "vod_track_protocol_unsupported",
            level: "warning",
            message: `Protocol ${protocol} does not carry the configured VOD track as a separate output stream.`
          });
        } else if (audioTrackCount <= vodTrackIndex) {
          checks.push({
            code: "vod_audio_track_missing",
            level: "blocked",
            message: `VOD audio track ${vodTrackIndex} is not available in the current ingest source.`
          });
        } else {
          checks.push({
            code: "vod_audio_track_available",
            level: "ok",
            message: `VOD audio track ${vodTrackIndex} is available in the ingest source.`
          });
        }
      }
    } else if (sourceAnalysis) {
      checks.push({
        code: sourceAnalysis.reason || "source_probe_unavailable",
        level: "warning",
        message: "Source probe is not available right now. Start the ingest source and run readiness again.",
        guidance: Array.isArray(sourceAnalysis.guidance) ? sourceAnalysis.guidance : []
      });
    }

    if (destination.outputMode === "custom") {
      const requestedVideoCodec = videoProfile.videoCodec || "libx264";
      const selectedVideoCodec = this.selectVideoCodec(
        destination,
        requestedVideoCodec,
        {
          sourceMode: destination.videoSourceMode || "master_ingest"
        },
        { emitWarnings: false }
      );
      if (selectedVideoCodec !== requestedVideoCodec) {
        checks.push({
          code: "video_codec_fallback",
          level: "warning",
          message: `Requested video codec ${requestedVideoCodec} is not fully available. Runtime fallback is ${selectedVideoCodec}.`
        });
      }

      const requestedAudioCodec = audioProfile.audioCodec || "aac";
      const selectedAudioCodec = this.selectAudioCodec(
        destination,
        requestedAudioCodec,
        protocol,
        { emitWarnings: false }
      );
      if (selectedAudioCodec !== requestedAudioCodec) {
        checks.push({
          code: "audio_codec_fallback",
          level: "warning",
          message: `Requested audio codec ${requestedAudioCodec} is not fully available for ${protocol}. Runtime fallback is ${selectedAudioCodec}.`
        });
      }
    }

    const blocked = checks.some((check) => check.level === "blocked");
    const warning = !blocked && checks.some((check) => check.level === "warning");

    return {
      destinationId: destination.id,
      destinationName: destination.name,
      protocol,
      sourceUrl,
      status: blocked ? "blocked" : warning ? "warning" : "ready",
      ready: !blocked,
      checks
    };
  }

  buildPublishUrlPreview(destination) {
    const protocol = destination.protocol || "rtmp";
    const serverUrl = destination.serverUrl || "";
    const streamKey = destination.streamKey || "preview";

    if (protocol === "rtmp" || protocol === "rtmps") {
      return `${String(serverUrl).replace(/\/+$/, "")}/${streamKey}`;
    }
    return serverUrl;
  }

  selectVideoCodec(destination, requestedCodec, inputContext = {}, options = {}) {
    const emitWarnings = options.emitWarnings !== false;
    if (
      inputContext.sourceMode === "scene_projector_capture" &&
      requestedCodec === "copy"
    ) {
      if (emitWarnings) {
        this.eventBus.publish("destination.profile_warning", {
          destinationId: destination.id,
          requestedVideoCodec: requestedCodec,
          fallbackVideoCodec: "libx264",
          reason: "video_copy_not_supported_for_projector_capture"
        });
      }
      return "libx264";
    }

    if (requestedCodec === "copy" || requestedCodec === "libx264") {
      return requestedCodec;
    }

    const capabilities = this.getEncoderCapabilities();
    if (capabilities.has(requestedCodec)) {
      return requestedCodec;
    }

    if (emitWarnings) {
      this.eventBus.publish("destination.profile_warning", {
        destinationId: destination.id,
        requestedVideoCodec: requestedCodec,
        fallbackVideoCodec: "libx264",
        reason: "encoder_not_available"
      });
    }
    return "libx264";
  }

  selectAudioCodec(destination, requestedCodec, protocol, options = {}) {
    const emitWarnings = options.emitWarnings !== false;
    if (requestedCodec === "copy" || requestedCodec === "aac") {
      return requestedCodec;
    }

    if (requestedCodec === "libopus") {
      if (protocol === "srt" || protocol === "rist" || protocol === "whip") {
        return "libopus";
      }

      if (emitWarnings) {
        this.eventBus.publish("destination.profile_warning", {
          destinationId: destination.id,
          requestedAudioCodec: requestedCodec,
          fallbackAudioCodec: "aac",
          reason: "audio_codec_not_supported_by_protocol"
        });
      }
      return "aac";
    }

    return "aac";
  }

  getEncoderCapabilities() {
    if (this.encoderCapabilities) {
      return this.encoderCapabilities;
    }

    const lines =
      typeof this.probeEncodersFn === "function"
        ? this.probeEncodersFn()
        : this.probeEncodersFromFfmpeg();
    const detected = new Set();
    for (const rawLine of lines || []) {
      const line = String(rawLine || "");
      if (line.includes("h264_nvenc")) {
        detected.add("h264_nvenc");
      }
      if (line.includes("h264_amf")) {
        detected.add("h264_amf");
      }
      if (line.includes("h264_qsv")) {
        detected.add("h264_qsv");
      }
      if (line.includes("h264_videotoolbox")) {
        detected.add("h264_videotoolbox");
      }
      if (line.includes("h264_vaapi")) {
        detected.add("h264_vaapi");
      }
    }

    this.encoderCapabilities = detected;
    return detected;
  }

  probeEncodersFromFfmpeg() {
    try {
      const result = this.spawnSyncFn(this.ffmpegBin, ["-hide_banner", "-encoders"], {
        windowsHide: true,
        encoding: "utf8",
        timeout: 5000
      });
      const content = `${result.stdout || ""}\n${result.stderr || ""}`;
      return content.split(/\r?\n/).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  listMacScreenCaptureDevices() {
    if (this.platform !== "darwin") {
      const error = new Error(
        "AVFoundation screen capture discovery is currently supported only on macOS."
      );
      error.code = "OBS_UNSUPPORTED_REQUEST";
      throw error;
    }

    const result = this.spawnSyncFn(
      this.ffmpegBin,
      ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
      {
        windowsHide: true,
        encoding: "utf8",
        timeout: 5000
      }
    );

    if (result.error) {
      throw result.error;
    }

    const content = `${result.stdout || ""}\n${result.stderr || ""}`;
    return this.parseMacScreenCaptureDevices(content);
  }

  parseMacScreenCaptureDevices(content) {
    const devices = [];
    const lines = String(content || "").split(/\r?\n/);
    lines.forEach((line) => {
      const match = line.match(
        /\[(\d+)\]\s+Capture screen\s+(\d+)(?:\s+\(ID:\s*([^)]+)\))?/i
      );
      if (!match) {
        return;
      }
      devices.push({
        videoDeviceIndex: Number(match[1]),
        screenIndex: Number(match[2]),
        captureId: match[3] ? String(match[3]).trim() : ""
      });
    });
    return devices;
  }

  buildMacSceneBindingSuggestion(windowInfo) {
    const devices = this.listMacScreenCaptureDevices();
    const suggestedDevice = this.resolveMacCaptureDeviceForWindow(windowInfo, devices);
    if (!suggestedDevice) {
      return null;
    }

    return {
      captureMethod: "darwin_display_crop",
      projectorWindowTitle: windowInfo.title || "",
      captureDisplayIndex: suggestedDevice.videoDeviceIndex,
      captureDisplayId: suggestedDevice.captureId || "",
      captureCropX: Number(windowInfo.captureCropX || 0),
      captureCropY: Number(windowInfo.captureCropY || 0),
      captureCropWidth: Number(windowInfo.captureCropWidth || 0),
      captureCropHeight: Number(windowInfo.captureCropHeight || 0)
    };
  }

  resolveMacCaptureDeviceForWindow(windowInfo, devices = []) {
    if (!windowInfo) {
      return null;
    }

    const normalizedDisplayId =
      windowInfo.displayId !== undefined && windowInfo.displayId !== null
        ? String(windowInfo.displayId)
        : "";
    if (normalizedDisplayId) {
      const byId = devices.find((device) => {
        const captureId = String(device.captureId || "");
        return captureId === normalizedDisplayId || captureId.endsWith(normalizedDisplayId);
      });
      if (byId) {
        return byId;
      }
    }

    if (Number.isInteger(Number(windowInfo.displayIndex))) {
      return (
        devices.find(
          (device) => device.screenIndex === Number(windowInfo.displayIndex)
        ) || null
      );
    }

    return null;
  }
}

module.exports = {
  FFmpegService,
  computeRetryDelay
};
