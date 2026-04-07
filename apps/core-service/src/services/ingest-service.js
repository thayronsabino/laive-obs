const NodeMediaServer = require("node-media-server");

class IngestService {
  constructor(options) {
    this.eventBus = options.eventBus;
    this.port = options.port;
    this.app = options.app;
    this.streamKey = options.streamKey;
    this.status = {
      running: false,
      activePublishers: 0,
      lastPublisherPath: null
    };

    this.nms = new NodeMediaServer({
      rtmp: {
        port: this.port,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60
      },
      logType: 1
    });
  }

  start() {
    this.nms.on("postPublish", (_id, streamPath) => {
      this.status.activePublishers += 1;
      this.status.lastPublisherPath = streamPath;
      this.eventBus.publish("ingest.publisher_connected", {
        streamPath
      });
    });

    this.nms.on("donePublish", (_id, streamPath) => {
      this.status.activePublishers = Math.max(this.status.activePublishers - 1, 0);
      this.eventBus.publish("ingest.publisher_disconnected", {
        streamPath
      });
    });

    this.nms.run();
    this.status.running = true;
    this.eventBus.publish("ingest.started", {
      url: this.getMasterInputUrl()
    });
  }

  stop() {
    if (!this.status.running) {
      return Promise.resolve();
    }

    const closers = [];
    const candidates = [
      this.nms.rtmpServer && this.nms.rtmpServer.tcpServer,
      this.nms.httpServer,
      this.nms.recordServer
    ];

    candidates.forEach((server) => {
      if (server && typeof server.close === "function") {
        closers.push(
          new Promise((resolve) => {
            const timer = setTimeout(() => resolve(), 2000);
            try {
              server.close(() => {
                clearTimeout(timer);
                resolve();
              });
            } catch (_) {
              clearTimeout(timer);
              resolve();
            }
          })
        );
      }
    });

    return Promise.allSettled(closers).then(() => {
      this.status.running = false;
      this.eventBus.publish("ingest.stopped");
    });
  }

  getMasterInputUrl() {
    return `rtmp://127.0.0.1:${this.port}/${this.app}/${this.streamKey}`;
  }

  getStatus() {
    return {
      ...this.status,
      masterInputUrl: this.getMasterInputUrl()
    };
  }
}

module.exports = {
  IngestService
};
