const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const NodeMediaServer = require("node-media-server");

const { createRuntime } = require("../src/app-runtime");
const { resolveFfmpegBin } = require("../../../shared/ffmpeg-resolver");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "laive-e2e-"));
}

function randomPort(base = 7000) {
  return base + Math.floor(Math.random() * 1000);
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
    }, 150);
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
    "testsrc=size=320x240:rate=15",
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
  await new Promise((resolve) => setTimeout(resolve, 1200));
  if (processRef.exitCode === null) {
    spawnSync("taskkill", ["/PID", String(processRef.pid), "/T", "/F"], {
      windowsHide: true
    });
  }
}

test(
  "E2E: destination reconnects after temporary RTMP sink outage",
  { skip: process.env.RUN_E2E !== "1", timeout: 120000 },
  async () => {
    const ffmpegBin = resolveFfmpegBin();
    if (!ffmpegBin) {
      throw new Error("FFmpeg not found for E2E test.");
    }

    const tempDir = makeTempDir();
    const apiPort = randomPort(7300);
    const ingestPort = randomPort(7600);
    const sinkPort = randomPort(7900);
    const dataDir = path.join(tempDir, "data");

    let sink = createSink(sinkPort);
    const runtime = createRuntime({
      appName: "LAIVE OBS",
      version: "0.1.0-e2e",
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
      ffmpegMaxRetries: 6,
      obsEnabled: false,
      ingestEnabled: true
    });

    const reconnectEvents = [];
    runtime.services.eventBus.on("destination.reconnecting", (evt) => {
      reconnectEvents.push(evt);
    });

    let producer = null;
    try {
      await runtime.start();

      const destination = runtime.services.destinationService.create({
        name: "Local Sink",
        serverUrl: `rtmp://127.0.0.1:${sinkPort}/live`,
        streamKey: "dest",
        bitrateKbps: 0,
        syncWithObsStart: false,
        syncWithObsStop: false
      });

      runtime.services.orchestratorService.startOne(destination.id, "test");

      producer = createProducer(
        ffmpegBin,
        `rtmp://127.0.0.1:${ingestPort}/live/master`
      );

      await waitForCondition(
        () => sink.getPublishCount() >= 1,
        20000,
        "Initial publish did not reach sink."
      );

      await sink.stop();
      await waitForCondition(
        () => reconnectEvents.length >= 1,
        20000,
        "No reconnect event detected after sink outage."
      );

      sink = createSink(sinkPort);

      await waitForCondition(
        () => sink.getPublishCount() >= 1,
        30000,
        "Publish did not recover after sink restart."
      );
    } finally {
      await stopProducer(producer);
      await withTimeout(runtime.stop(), 10000, "Runtime stop timed out.");
      if (sink) {
        await sink.stop();
      }
    }

    assert.ok(reconnectEvents.length >= 1);
  }
);
