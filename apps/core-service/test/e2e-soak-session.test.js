const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const NodeMediaServer = require("node-media-server");
const NodeMediaContext = require("node-media-server/src/core/context.js");

const { createRuntime } = require("../src/app-runtime");
const { resolveFfmpegBin } = require("../../../shared/ffmpeg-resolver");

function parseIntEnv(name, defaultValue, minimum = 1) {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  return Math.max(minimum, parsed);
}

const SOAK_DURATION_SEC = parseIntEnv("E2E_SOAK_DURATION_SEC", 3600, 30);
const SOAK_DESTINATION_COUNT = parseIntEnv("E2E_SOAK_DESTINATION_COUNT", 3, 2);
const SOAK_OUTAGE_INTERVAL_SEC = parseIntEnv("E2E_SOAK_OUTAGE_INTERVAL_SEC", 90, 10);
const SOAK_OUTAGE_DURATION_SEC = parseIntEnv("E2E_SOAK_OUTAGE_DURATION_SEC", 12, 3);
const TEST_TIMEOUT_MS = (SOAK_DURATION_SEC + 180) * 1000;

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "laive-e2e-soak-"));
}

function randomPort(base = 8000) {
  return base + Math.floor(Math.random() * 1000);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForCondition(checkFn, timeoutMs, errorMessage) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (checkFn()) {
        clearInterval(interval);
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(interval);
        reject(new Error(errorMessage));
      }
    }, 200);
  });
}

async function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function createSink(port) {
  let publishCount = 0;
  const nms = new NodeMediaServer({
    rtmp: {
      port,
      chunk_size: 60000,
      gop_cache: false,
      ping: 10,
      ping_timeout: 20
    },
    logType: 0
  });

  nms.on("postPublish", () => {
    publishCount += 1;
  });

  nms.run();

  function closeIfPresent(server) {
    if (!server || typeof server.close !== "function") {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
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
    });
  }

  return {
    stop: async () => {
      NodeMediaContext.sessions.forEach((session) => {
        try {
          if (
            session &&
            session.socket &&
            session.socket.localPort === port &&
            typeof session.close === "function"
          ) {
            session.close();
          }
        } catch (_) {
          // ignore
        }
      });
      await Promise.allSettled([
        closeIfPresent(nms.rtmpServer && nms.rtmpServer.tcpServer),
        closeIfPresent(nms.httpServer),
        closeIfPresent(nms.recordServer)
      ]);
    },
    getPublishCount: () => publishCount
  };
}

function createProducer(ffmpegBin, ingestUrl) {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-re",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x360:rate=24",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-c:a",
    "aac",
    "-f",
    "flv",
    ingestUrl
  ];

  return spawn(ffmpegBin, args, {
    windowsHide: true,
    stdio: ["ignore", "ignore", "ignore"]
  });
}

async function stopProducer(processRef) {
  if (!processRef || processRef.exitCode !== null) {
    return;
  }

  processRef.kill("SIGTERM");
  await wait(1500);
  if (processRef.exitCode === null) {
    spawnSync("taskkill", ["/PID", String(processRef.pid), "/T", "/F"], {
      windowsHide: true
    });
  }
}

test(
  "E2E Soak: multi-destination session survives periodic sink outages",
  { skip: process.env.RUN_E2E_SOAK !== "1", timeout: TEST_TIMEOUT_MS },
  async () => {
    const ffmpegBin = resolveFfmpegBin();
    if (!ffmpegBin) {
      throw new Error("FFmpeg not found for E2E soak test.");
    }

    const tempDir = makeTempDir();
    const apiPort = randomPort(8800);
    const ingestPort = randomPort(9100);
    const sinkBasePort = randomPort(9400);
    const dataDir = path.join(tempDir, "data");
    const durationMs = SOAK_DURATION_SEC * 1000;
    const outageIntervalMs = SOAK_OUTAGE_INTERVAL_SEC * 1000;
    const outageDurationMs = SOAK_OUTAGE_DURATION_SEC * 1000;

    const sinks = Array.from({ length: SOAK_DESTINATION_COUNT }, (_, index) => ({
      index,
      port: sinkBasePort + index,
      sink: createSink(sinkBasePort + index)
    }));

    const runtime = createRuntime({
      appName: "LAIVE OBS",
      version: "0.1.0-e2e-soak",
      apiPort,
      wsPath: "/events",
      dataDir,
      dataFile: path.join(dataDir, "state.json"),
      logDir: path.join(dataDir, "logs"),
      logLevel: "warn",
      dashboardPublicDir: path.resolve(__dirname, "..", "..", "dashboard", "public"),
      ffmpegBin,
      rtmpPort: ingestPort,
      rtmpApp: "live",
      rtmpStreamKey: "master",
      obsWsUrl: "ws://127.0.0.1:4455",
      obsWsPassword: "",
      obsReconnectMs: 1000,
      ffmpegMaxRetries: 20,
      ffmpegRetryBaseMs: 500,
      ffmpegRetryMaxMs: 3000,
      ffmpegRetryJitterRatio: 0.2,
      ffmpegStallTimeoutMs: 15000,
      ffmpegStallMonitorIntervalMs: 2000,
      obsEnabled: false,
      ingestEnabled: true
    });

    const reconnectEvents = [];
    runtime.services.eventBus.on("destination.reconnecting", (event) => {
      reconnectEvents.push(event);
    });

    let producer = null;
    let outagesTriggered = 0;

    try {
      await runtime.start();

      const createdDestinations = sinks.map((sinkRef, index) =>
        runtime.services.destinationService.create({
          name: `Soak Sink ${index + 1}`,
          serverUrl: `rtmp://127.0.0.1:${sinkRef.port}/live`,
          streamKey: `dest-${index + 1}`,
          bitrateKbps: 0,
          syncWithObsStart: false,
          syncWithObsStop: false
        })
      );

      createdDestinations.forEach((destination) => {
        runtime.services.orchestratorService.startOne(destination.id, "soak-test");
      });

      producer = createProducer(
        ffmpegBin,
        `rtmp://127.0.0.1:${ingestPort}/live/master`
      );

      for (const sinkRef of sinks) {
        await waitForCondition(
          () => sinkRef.sink.getPublishCount() >= 1,
          40000,
          `Initial publish did not reach sink port ${sinkRef.port}.`
        );
      }

      const startedAt = Date.now();
      let outageIndex = 0;
      while (Date.now() - startedAt < durationMs) {
        await wait(outageIntervalMs);
        if (Date.now() - startedAt >= durationMs) {
          break;
        }

        const target = sinks[outageIndex % sinks.length];
        outageIndex += 1;
        outagesTriggered += 1;

        await target.sink.stop();
        await wait(outageDurationMs);
        target.sink = createSink(target.port);

        await waitForCondition(
          () => target.sink.getPublishCount() >= 1,
          90000,
          `Pipeline did not recover for sink port ${target.port}.`
        );
      }
    } finally {
      await stopProducer(producer);
      await withTimeout(runtime.stop(), 15000, "Runtime stop timed out.");
      await Promise.allSettled(
        sinks.map(async (sinkRef) => {
          if (sinkRef.sink) {
            await sinkRef.sink.stop();
          }
        })
      );
    }

    assert.ok(outagesTriggered >= 1);
    assert.ok(reconnectEvents.length >= 1);
  }
);
