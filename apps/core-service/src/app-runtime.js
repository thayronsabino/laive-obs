const { EventBus } = require("./services/event-bus");
const { PersistenceService } = require("./services/persistence-service");
const { DestinationService } = require("./services/destination-service");
const { FFmpegService } = require("./services/ffmpeg-service");
const { IngestService } = require("./services/ingest-service");
const { ObsService } = require("./services/obs-service");
const { OrchestratorService } = require("./services/orchestrator-service");
const { LoggerService } = require("./services/logger-service");
const { MetricsService } = require("./services/metrics-service");
const { AuthService } = require("./services/auth-service");
const { ProjectorRegistryService } = require("./services/projector-registry-service");
const { createHttpServer } = require("./server");

function createRuntime(config, options = {}) {
  const logger = new LoggerService({
    logDir: config.logDir,
    level: config.logLevel,
    maxBytes: config.logMaxBytes,
    maxFiles: config.logMaxFiles
  });
  logger.init();
  const metricsService = new MetricsService();
  const projectorRegistryService = new ProjectorRegistryService({
    platform: options.obsPlatform
  });

  const eventBus = new EventBus();
  const persistenceService = new PersistenceService({
    dataDir: config.dataDir,
    dataFile: config.dataFile
  });
  const destinationService = new DestinationService(persistenceService);
  const authService = new AuthService({
    persistenceService,
    destinationService,
    eventBus,
    sessionTtlSec:
      destinationService.getSettings().network.sessionTtlSec ||
      config.sessionTtlSec
  });

  const ingestService = new IngestService({
    eventBus,
    port: config.rtmpPort,
    app: config.rtmpApp,
    streamKey: config.rtmpStreamKey
  });

  const ffmpegService = new FFmpegService({
    eventBus,
    ffmpegBin: config.ffmpegBin,
    ffprobeBin: config.ffprobeBin,
    maxRetries: config.ffmpegMaxRetries,
    retryBaseMs: config.ffmpegRetryBaseMs,
    retryMaxMs: config.ffmpegRetryMaxMs,
    retryJitterRatio: config.ffmpegRetryJitterRatio,
    connectTimeoutMs: config.ffmpegConnectTimeoutMs,
    stopGraceMs: config.ffmpegStopGraceMs,
    stallTimeoutMs: config.ffmpegStallTimeoutMs,
    stallMonitorIntervalMs: config.ffmpegStallMonitorIntervalMs,
    platform: options.ffmpegPlatform,
    spawnSyncFn: options.ffmpegSpawnSyncFn,
    onDestinationStatusChange: (destinationId, status, errorMessage = null) => {
      destinationService.setStatus(destinationId, status, errorMessage);
    }
  });

  let orchestratorService = null;
  const obsService = new ObsService({
    eventBus,
    url: config.obsWsUrl,
    password: config.obsWsPassword,
    reconnectMs: config.obsReconnectMs,
    onStreamingStateChanged: (active) => {
      if (orchestratorService) {
        orchestratorService.onObsStreamingStateChanged(active);
      }
    },
    obsClient: options.obsClient,
    platform: options.obsPlatform,
    listWindowsFn: options.listWindowsFn,
    spawnSyncFn: options.obsSpawnSyncFn
  });

  orchestratorService = new OrchestratorService({
    eventBus,
    destinationService,
    ffmpegService,
    ingestService,
    obsService,
    projectorRegistryService
  });

  const server = createHttpServer({
    config,
    eventBus,
    destinationService,
    orchestratorService,
    obsService,
    ingestService,
    logger,
    metricsService,
    authService,
    ffmpegService,
    projectorRegistryService
  });

  eventBus.on("*", (event) => {
    metricsService.recordEvent(event.type, event.payload || {});
    metricsService.increment(`event.${event.type}`);

    if (event.type.endsWith(".log")) {
      logger.debug("event.received", {
        type: event.type
      });
      return;
    }
    logger.info("event.received", {
      type: event.type
    });
  });

  async function start() {
    if (config.ingestEnabled) {
      ingestService.start();
    } else {
      logger.warn("ingest.disabled");
      metricsService.increment("service.ingest.disabled");
    }

    if (config.obsEnabled) {
      obsService.start();
    } else {
      logger.warn("obs.disabled");
      metricsService.increment("service.obs.disabled");
    }

    await new Promise((resolve) => {
      const networkSettings = destinationService.getSettings().network || {};
      const bindAddress =
        networkSettings.bindAddress ||
        (networkSettings.allowLan ? "0.0.0.0" : config.apiBindAddress);
      server.listen(config.apiPort, bindAddress, () => resolve());
    });

    logger.info("runtime.started", {
      apiUrl: `http://127.0.0.1:${config.apiPort}`,
      ingestUrl: ingestService.getMasterInputUrl(),
      obsUrl: config.obsWsUrl,
      dashboardDir: config.dashboardPublicDir,
      bindAddress: server.address() && server.address().address
    });
    metricsService.increment("runtime.start");
  }

  async function stop() {
    ffmpegService.stopAll();
    await obsService.stop();
    await ingestService.stop();
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
    logger.info("runtime.stopped");
    metricsService.increment("runtime.stop");
    await logger.close();
  }

  return {
    start,
    stop,
    services: {
      logger,
      eventBus,
      destinationService,
      ingestService,
      ffmpegService,
      obsService,
      orchestratorService,
      metricsService,
      authService,
      projectorRegistryService
    }
  };
}

module.exports = {
  createRuntime
};
