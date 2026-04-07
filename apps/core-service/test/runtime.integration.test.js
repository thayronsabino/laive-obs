const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRuntime } = require("../src/app-runtime");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "laive-core-test-"));
}

function randomPort(base = 5200) {
  return base + Math.floor(Math.random() * 1000);
}

async function bootstrapAndLogin(apiPort) {
  const bootstrapRes = await fetch(`http://127.0.0.1:${apiPort}/api/auth/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password: "strong-password-123"
    })
  });
  assert.equal(bootstrapRes.status, 201);

  const loginRes = await fetch(`http://127.0.0.1:${apiPort}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password: "strong-password-123"
    })
  });
  assert.equal(loginRes.status, 200);
  const cookie = loginRes.headers.get("set-cookie");
  assert.equal(Boolean(cookie), true);
  return cookie;
}

async function authedFetch(apiPort, cookie, input, init = {}) {
  const headers = {
    ...(init.headers || {}),
    cookie
  };
  return fetch(`http://127.0.0.1:${apiPort}${input}`, {
    ...init,
    headers
  });
}

class FakeObsClient extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
  }

  async connect() {
    this.emit("ConnectionOpened");
  }

  async disconnect() {
    this.emit("ConnectionClosed");
  }

  async call(name, data) {
    this.calls.push({ name, data });

    if (name === "GetStreamStatus") {
      return { outputActive: false };
    }
    if (name === "GetRecordStatus") {
      return { outputActive: false };
    }
    if (name === "GetCurrentProgramScene") {
      return { currentProgramSceneName: "Program" };
    }
    if (name === "GetMonitorList") {
      return {
        monitors: [{ monitorIndex: 0, monitorName: "Primary" }]
      };
    }

    return {};
  }
}

test("runtime exposes health and destination CRUD with obs/ingest disabled", async () => {
  const tempDir = makeTempDir();
  const apiPort = randomPort();
  const dataDir = path.join(tempDir, "data");
  const dataFile = path.join(dataDir, "state.json");
  const logDir = path.join(dataDir, "logs");

  const runtime = createRuntime({
    appName: "LAIVE OBS",
    version: "0.1.0-test",
    apiPort,
    wsPath: "/events",
    dataDir,
    dataFile,
    logDir,
    logLevel: "warn",
    dashboardPublicDir: path.resolve(__dirname, "..", "..", "dashboard", "public"),
    ffmpegBin: "ffmpeg",
    rtmpPort: randomPort(6500),
    rtmpApp: "live",
    rtmpStreamKey: "master",
    obsWsUrl: "ws://127.0.0.1:4455",
    obsWsPassword: "",
    obsReconnectMs: 500,
    ffmpegMaxRetries: 2,
    obsEnabled: false,
    ingestEnabled: false
  });

  await runtime.start();

  try {
    const cookie = await bootstrapAndLogin(apiPort);

    const healthRes = await fetch(`http://127.0.0.1:${apiPort}/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ok, true);
    assert.equal(health.services.obs.connected, false);

    const createRes = await authedFetch(
      apiPort,
      cookie,
      "/api/destinations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test destination",
          protocol: "srt",
          serverUrl: "srt://127.0.0.1:9998?mode=caller&latency=2000000",
          streamKey: "",
          bitrateKbps: 0,
          outputMode: "custom",
          videoProfile: {
            videoCodec: "libx264",
            bitrateKbps: 2500,
            fps: 30,
            width: 1280,
            height: 720,
            gopSec: 2,
            preset: "veryfast"
          },
          audioProfile: {
            audioCodec: "libopus",
            audioBitrateKbps: 96
          },
          syncWithObsStart: true,
          syncWithObsStop: true
        })
      }
    );
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.name, "Test destination");
    assert.equal(created.protocol, "srt");

    const listRes = await authedFetch(apiPort, cookie, "/api/destinations");
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    assert.equal(Array.isArray(list), true);
    assert.equal(list.length, 1);
    assert.equal(list[0].protocol, "srt");
    assert.equal(list[0].outputMode, "custom");

    const secondCreateRes = await authedFetch(
      apiPort,
      cookie,
      "/api/destinations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Second destination",
          protocol: "rtmp",
          serverUrl: "rtmp://example.com/live",
          streamKey: "abc123"
        })
      }
    );
    assert.equal(secondCreateRes.status, 201);
    const second = await secondCreateRes.json();

    const reorderRes = await authedFetch(
      apiPort,
      cookie,
      "/api/destinations/reorder",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [second.id, created.id]
        })
      }
    );
    assert.equal(reorderRes.status, 200);
    const reordered = await reorderRes.json();
    assert.deepEqual(
      reordered.map((item) => item.id),
      [second.id, created.id]
    );

    const metricsRes = await authedFetch(apiPort, cookie, "/api/metrics");
    assert.equal(metricsRes.status, 200);
    const metrics = await metricsRes.json();
    assert.equal(typeof metrics.uptimeSec, "number");
    assert.equal(typeof metrics.counters, "object");

    const diagRes = await authedFetch(apiPort, cookie, "/api/diagnostics");
    assert.equal(diagRes.status, 200);
    const diagnostics = await diagRes.json();
    assert.equal(Boolean(diagnostics.obs), true);
    assert.equal(Boolean(diagnostics.metrics), true);

    const diagExportRes = await authedFetch(
      apiPort,
      cookie,
      "/api/diagnostics/export"
    );
    assert.equal(diagExportRes.status, 200);
    assert.equal(
      String(diagExportRes.headers.get("content-disposition")).includes(
        "laive-diagnostics-"
      ),
      true
    );
    const diagExportPayload = await diagExportRes.json();
    assert.equal(Boolean(diagExportPayload.diagnostics), true);

    const logsRecentRes = await authedFetch(
      apiPort,
      cookie,
      "/api/logs/recent?limit=50"
    );
    assert.equal(logsRecentRes.status, 200);
    const logsRecent = await logsRecentRes.json();
    assert.equal(Array.isArray(logsRecent.entries), true);

    const logsExportRes = await authedFetch(
      apiPort,
      cookie,
      "/api/logs/export?limit=50"
    );
    assert.equal(logsExportRes.status, 200);
    assert.equal(
      String(logsExportRes.headers.get("content-disposition")).includes(
        "laive-logs-"
      ),
      true
    );
    const logsText = await logsExportRes.text();
    assert.equal(typeof logsText, "string");

    const bundleRes = await authedFetch(
      apiPort,
      cookie,
      "/api/support-bundle/export?limit=100"
    );
    assert.equal(bundleRes.status, 200);
    assert.equal(
      String(bundleRes.headers.get("content-type")).includes("application/zip"),
      true
    );
    assert.equal(
      String(bundleRes.headers.get("content-disposition")).includes(
        "laive-support-bundle-"
      ),
      true
    );
    const bundleChecksum = bundleRes.headers.get("x-laive-bundle-sha256") || "";
    assert.equal(/^[a-f0-9]{64}$/i.test(bundleChecksum), true);
    const bundleBuffer = await bundleRes.arrayBuffer();
    assert.equal(bundleBuffer.byteLength > 100, true);
  } finally {
    await runtime.stop();
  }
});

test("runtime exposes OBS projector helpers when OBS websocket is enabled", async () => {
  const tempDir = makeTempDir();
  const apiPort = randomPort(6200);
  const dataDir = path.join(tempDir, "data");
  const dataFile = path.join(dataDir, "state.json");
  const logDir = path.join(dataDir, "logs");
  const fakeObsClient = new FakeObsClient();

  const runtime = createRuntime(
    {
      appName: "LAIVE OBS",
      version: "0.1.0-test",
      apiPort,
      wsPath: "/events",
      dataDir,
      dataFile,
      logDir,
      logLevel: "warn",
      dashboardPublicDir: path.resolve(
        __dirname,
        "..",
        "..",
        "dashboard",
        "public"
      ),
      ffmpegBin: "ffmpeg",
      rtmpPort: randomPort(7600),
      rtmpApp: "live",
      rtmpStreamKey: "master",
      obsWsUrl: "ws://127.0.0.1:4455",
      obsWsPassword: "",
      obsReconnectMs: 500,
      ffmpegMaxRetries: 2,
      obsEnabled: true,
      ingestEnabled: false
    },
    {
      obsClient: fakeObsClient
    }
  );

  await runtime.start();

  try {
    const cookie = await bootstrapAndLogin(apiPort);

    const monitorsRes = await authedFetch(apiPort, cookie, "/api/obs/monitors");
    assert.equal(monitorsRes.status, 200);
    const monitorsPayload = await monitorsRes.json();
    assert.equal(monitorsPayload.ok, true);
    assert.equal(Array.isArray(monitorsPayload.monitors), true);
    assert.equal(monitorsPayload.monitors[0].monitorName, "Primary");

    const projectorRes = await authedFetch(
      apiPort,
      cookie,
      "/api/obs/projectors/source",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceName: "Program",
          monitorIndex: -1
        })
      }
    );
    assert.equal(projectorRes.status, 200);
    const projectorPayload = await projectorRes.json();
    assert.equal(projectorPayload.ok, true);
    assert.equal(projectorPayload.opened, true);
    assert.equal(projectorPayload.sourceName, "Program");

    assert.equal(
      fakeObsClient.calls.some(
        (call) =>
          call.name === "OpenSourceProjector" &&
          call.data.sourceName === "Program" &&
          call.data.monitorIndex === -1
      ),
      true
    );

    const createRes = await authedFetch(apiPort, cookie, "/api/destinations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Scene Capture",
        protocol: "rtmp",
        serverUrl: "rtmp://example.com/live",
        streamKey: "abc123",
        outputMode: "custom",
        videoSourceMode: "scene_projector_capture",
        sceneBinding: {
          sceneName: "Program",
          captureMethod: "windows_window_title",
          projectorWindowTitle: "OBS Projector - Program"
        },
        videoProfile: {
          videoCodec: "libx264",
          bitrateKbps: 2500,
          fps: 30,
          width: 1280,
          height: 720,
          gopSec: 2,
          preset: "veryfast"
        },
        audioProfile: {
          audioCodec: "aac",
          audioBitrateKbps: 128
        }
      })
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();

    const destinationProjectorRes = await authedFetch(
      apiPort,
      cookie,
      `/api/destinations/${created.id}/projector/open`,
      {
        method: "POST",
        headers: {}
      }
    );
    assert.equal(destinationProjectorRes.status, 200);
    const destinationProjectorPayload = await destinationProjectorRes.json();
    assert.equal(destinationProjectorPayload.ok, true);
    assert.equal(destinationProjectorPayload.sceneName, "Program");
  } finally {
    await runtime.stop();
  }
});

test("runtime detects and autobinds projector window title for destination", async () => {
  const tempDir = makeTempDir();
  const apiPort = randomPort(8200);
  const dataDir = path.join(tempDir, "data");
  const dataFile = path.join(dataDir, "state.json");
  const logDir = path.join(dataDir, "logs");
  const fakeObsClient = new FakeObsClient();

  const runtime = createRuntime(
    {
      appName: "LAIVE OBS",
      version: "0.1.0-test",
      apiPort,
      wsPath: "/events",
      dataDir,
      dataFile,
      logDir,
      logLevel: "warn",
      dashboardPublicDir: path.resolve(
        __dirname,
        "..",
        "..",
        "dashboard",
        "public"
      ),
      ffmpegBin: "ffmpeg",
      rtmpPort: randomPort(9200),
      rtmpApp: "live",
      rtmpStreamKey: "master",
      obsWsUrl: "ws://127.0.0.1:4455",
      obsWsPassword: "",
      obsReconnectMs: 500,
      ffmpegMaxRetries: 2,
      obsEnabled: true,
      ingestEnabled: false
    },
    {
      obsClient: fakeObsClient,
      obsPlatform: "win32",
      listWindowsFn: () => [
        { title: "Windowed Projector (Scene) - Program", processId: 10 }
      ]
    }
  );

  await runtime.start();

  try {
    const cookie = await bootstrapAndLogin(apiPort);
    const createRes = await authedFetch(apiPort, cookie, "/api/destinations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Scene Detect",
        protocol: "rtmp",
        serverUrl: "rtmp://example.com/live",
        streamKey: "abc123",
        outputMode: "custom",
        videoSourceMode: "scene_projector_capture",
        sceneBinding: {
          sceneName: "Program",
          captureMethod: "windows_window_title",
          projectorWindowTitle: ""
        },
        videoProfile: {
          videoCodec: "libx264",
          bitrateKbps: 2500,
          fps: 30,
          width: 1280,
          height: 720,
          gopSec: 2,
          preset: "veryfast"
        },
        audioProfile: {
          audioCodec: "aac",
          audioBitrateKbps: 128
        }
      })
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();

    const detectRes = await authedFetch(
      apiPort,
      cookie,
      `/api/destinations/${created.id}/projector/detect`,
      {
        method: "POST",
        headers: {}
      }
    );
    assert.equal(detectRes.status, 200);
    const detectPayload = await detectRes.json();
    assert.equal(detectPayload.ok, true);
    assert.equal(detectPayload.autoBound, true);
    assert.equal(detectPayload.destination.sceneBinding.projectorWindowTitle, "Windowed Projector (Scene) - Program");
  } finally {
    await runtime.stop();
  }
});

test("runtime detects and autobinds macOS projector crop binding for destination", async () => {
  const tempDir = makeTempDir();
  const apiPort = randomPort(8400);
  const dataDir = path.join(tempDir, "data");
  const dataFile = path.join(dataDir, "state.json");
  const logDir = path.join(dataDir, "logs");
  const fakeObsClient = new FakeObsClient();

  const runtime = createRuntime(
    {
      appName: "LAIVE OBS",
      version: "0.1.0-test",
      apiPort,
      wsPath: "/events",
      dataDir,
      dataFile,
      logDir,
      logLevel: "warn",
      dashboardPublicDir: path.resolve(
        __dirname,
        "..",
        "..",
        "dashboard",
        "public"
      ),
      ffmpegBin: "ffmpeg",
      rtmpPort: randomPort(9400),
      rtmpApp: "live",
      rtmpStreamKey: "master",
      obsWsUrl: "ws://127.0.0.1:4455",
      obsWsPassword: "",
      obsReconnectMs: 500,
      ffmpegMaxRetries: 2,
      obsEnabled: true,
      ingestEnabled: false
    },
    {
      obsClient: fakeObsClient,
      obsPlatform: "darwin",
      ffmpegPlatform: "darwin",
      listWindowsFn: () => [
        {
          title: "Windowed Projector (Scene) - Program",
          processId: 10,
          displayIndex: 0,
          displayId: "69733120",
          captureCropX: 120,
          captureCropY: 180,
          captureCropWidth: 1280,
          captureCropHeight: 720
        }
      ],
      ffmpegSpawnSyncFn: () => ({
        stdout: "",
        stderr:
          "[AVFoundation indev @ 0x0] [1] Capture screen 0 (ID: 69733120)\n"
      })
    }
  );

  await runtime.start();

  try {
    const cookie = await bootstrapAndLogin(apiPort);
    const createRes = await authedFetch(apiPort, cookie, "/api/destinations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "macOS Scene Detect",
        protocol: "rtmp",
        serverUrl: "rtmp://example.com/live",
        streamKey: "abc123",
        outputMode: "custom",
        videoSourceMode: "scene_projector_capture",
        sceneBinding: {
          sceneName: "Program",
          captureMethod: "darwin_display_crop"
        },
        videoProfile: {
          videoCodec: "libx264",
          bitrateKbps: 2500,
          fps: 30,
          width: 1280,
          height: 720,
          gopSec: 2,
          preset: "veryfast"
        },
        audioProfile: {
          audioCodec: "aac",
          audioBitrateKbps: 128
        }
      })
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();

    const detectRes = await authedFetch(
      apiPort,
      cookie,
      `/api/destinations/${created.id}/projector/detect`,
      {
        method: "POST",
        headers: {}
      }
    );
    assert.equal(detectRes.status, 200);
    const detectPayload = await detectRes.json();
    assert.equal(detectPayload.ok, true);
    assert.equal(detectPayload.autoBound, true);
    assert.equal(detectPayload.destination.sceneBinding.captureMethod, "darwin_display_crop");
    assert.equal(detectPayload.destination.sceneBinding.captureDisplayIndex, 1);
    assert.equal(detectPayload.destination.sceneBinding.captureCropWidth, 1280);
  } finally {
    await runtime.stop();
  }
});

test("runtime detects and autobinds Linux projector window binding for destination", async () => {
  const tempDir = makeTempDir();
  const apiPort = randomPort(8600);
  const dataDir = path.join(tempDir, "data");
  const dataFile = path.join(dataDir, "state.json");
  const logDir = path.join(dataDir, "logs");
  const fakeObsClient = new FakeObsClient();

  const runtime = createRuntime(
    {
      appName: "LAIVE OBS",
      version: "0.1.0-test",
      apiPort,
      wsPath: "/events",
      dataDir,
      dataFile,
      logDir,
      logLevel: "warn",
      dashboardPublicDir: path.resolve(
        __dirname,
        "..",
        "..",
        "dashboard",
        "public"
      ),
      ffmpegBin: "ffmpeg",
      rtmpPort: randomPort(9600),
      rtmpApp: "live",
      rtmpStreamKey: "master",
      obsWsUrl: "ws://127.0.0.1:4455",
      obsWsPassword: "",
      obsReconnectMs: 500,
      ffmpegMaxRetries: 2,
      obsEnabled: true,
      ingestEnabled: false
    },
    {
      obsClient: fakeObsClient,
      obsPlatform: "linux",
      ffmpegPlatform: "linux",
      listWindowsFn: () => [
        {
          title: "Windowed Projector (Scene) - Program",
          processId: 10,
          x11WindowId: "0x04600007",
          x11Display: ":0.0"
        }
      ]
    }
  );

  await runtime.start();

  try {
    const cookie = await bootstrapAndLogin(apiPort);
    const createRes = await authedFetch(apiPort, cookie, "/api/destinations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Linux Scene Detect",
        protocol: "rtmp",
        serverUrl: "rtmp://example.com/live",
        streamKey: "abc123",
        outputMode: "custom",
        videoSourceMode: "scene_projector_capture",
        sceneBinding: {
          sceneName: "Program",
          captureMethod: "linux_x11_window_id"
        },
        videoProfile: {
          videoCodec: "libx264",
          bitrateKbps: 2500,
          fps: 30,
          width: 1280,
          height: 720,
          gopSec: 2,
          preset: "veryfast"
        },
        audioProfile: {
          audioCodec: "aac",
          audioBitrateKbps: 128
        }
      })
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();

    const detectRes = await authedFetch(
      apiPort,
      cookie,
      `/api/destinations/${created.id}/projector/detect`,
      {
        method: "POST",
        headers: {}
      }
    );
    assert.equal(detectRes.status, 200);
    const detectPayload = await detectRes.json();
    assert.equal(detectPayload.ok, true);
    assert.equal(detectPayload.autoBound, true);
    assert.equal(detectPayload.destination.sceneBinding.captureMethod, "linux_x11_window_id");
    assert.equal(detectPayload.destination.sceneBinding.x11WindowId, "0x04600007");
  } finally {
    await runtime.stop();
  }
});

test("runtime exposes scene capture validation endpoint and blocks invalid projector start", async () => {
  const tempDir = makeTempDir();
  const apiPort = randomPort(8800);
  const dataDir = path.join(tempDir, "data");
  const dataFile = path.join(dataDir, "state.json");
  const logDir = path.join(dataDir, "logs");

  const runtime = createRuntime(
    {
      appName: "LAIVE OBS",
      version: "0.1.0-test",
      apiPort,
      wsPath: "/events",
      dataDir,
      dataFile,
      logDir,
      logLevel: "warn",
      dashboardPublicDir: path.resolve(
        __dirname,
        "..",
        "..",
        "dashboard",
        "public"
      ),
      ffmpegBin: "ffmpeg",
      rtmpPort: randomPort(9800),
      rtmpApp: "live",
      rtmpStreamKey: "master",
      obsWsUrl: "ws://127.0.0.1:4455",
      obsWsPassword: "",
      obsReconnectMs: 500,
      ffmpegMaxRetries: 2,
      obsEnabled: false,
      ingestEnabled: false
    },
    {
      ffmpegPlatform: "win32",
      ffmpegSpawnSyncFn: () => ({
        status: 1,
        stdout: "",
        stderr: "Error opening input"
      })
    }
  );

  await runtime.start();

  try {
    const cookie = await bootstrapAndLogin(apiPort);
    const createRes = await authedFetch(apiPort, cookie, "/api/destinations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Validation Target",
        protocol: "rtmp",
        serverUrl: "rtmp://example.com/live",
        streamKey: "abc123",
        outputMode: "custom",
        videoSourceMode: "scene_projector_capture",
        sceneBinding: {
          sceneName: "Program",
          captureMethod: "windows_window_title",
          projectorWindowTitle: "Windowed Projector (Scene) - Program"
        },
        videoProfile: {
          videoCodec: "libx264",
          bitrateKbps: 2500,
          fps: 30,
          width: 1280,
          height: 720,
          gopSec: 2,
          preset: "veryfast"
        },
        audioProfile: {
          audioCodec: "aac",
          audioBitrateKbps: 128
        }
      })
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();

    const validateRes = await authedFetch(
      apiPort,
      cookie,
      `/api/destinations/${created.id}/projector/validate`,
      {
        method: "POST",
        headers: {}
      }
    );
    assert.equal(validateRes.status, 409);
    const validatePayload = await validateRes.json();
    assert.equal(validatePayload.ok, false);
    assert.equal(validatePayload.code, "CAPTURE_VALIDATION_FAILED");

    const startRes = await authedFetch(
      apiPort,
      cookie,
      `/api/streams/${created.id}/start`,
      {
        method: "POST",
        headers: {}
      }
    );
    assert.equal(startRes.status, 503);
    const startPayload = await startRes.json();
    assert.equal(startPayload.ok, false);
    assert.equal(startPayload.code, "OBS_NOT_CONNECTED");
  } finally {
    await runtime.stop();
  }
});

test("runtime serves authenticated scene capture preview frame", async () => {
  const tempDir = makeTempDir();
  const apiPort = randomPort(8900);
  const dataDir = path.join(tempDir, "data");
  const dataFile = path.join(dataDir, "state.json");
  const logDir = path.join(dataDir, "logs");
  const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

  const runtime = createRuntime(
    {
      appName: "LAIVE OBS",
      version: "0.1.0-test",
      apiPort,
      wsPath: "/events",
      dataDir,
      dataFile,
      logDir,
      logLevel: "warn",
      dashboardPublicDir: path.resolve(
        __dirname,
        "..",
        "..",
        "dashboard",
        "public"
      ),
      ffmpegBin: "ffmpeg",
      rtmpPort: randomPort(9900),
      rtmpApp: "live",
      rtmpStreamKey: "master",
      obsWsUrl: "ws://127.0.0.1:4455",
      obsWsPassword: "",
      obsReconnectMs: 500,
      ffmpegMaxRetries: 2,
      obsEnabled: false,
      ingestEnabled: false
    },
    {
      ffmpegPlatform: "win32",
      ffmpegSpawnSyncFn: () => ({
        status: 0,
        stdout: jpegBuffer,
        stderr: ""
      })
    }
  );

  await runtime.start();

  try {
    const cookie = await bootstrapAndLogin(apiPort);
    const createRes = await authedFetch(apiPort, cookie, "/api/destinations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Preview Target",
        protocol: "rtmp",
        serverUrl: "rtmp://example.com/live",
        streamKey: "abc123",
        outputMode: "custom",
        videoSourceMode: "scene_projector_capture",
        sceneBinding: {
          sceneName: "Program",
          captureMethod: "windows_window_title",
          projectorWindowTitle: "Windowed Projector (Scene) - Program"
        },
        videoProfile: {
          videoCodec: "libx264",
          bitrateKbps: 2500,
          fps: 30,
          width: 1280,
          height: 720,
          gopSec: 2,
          preset: "veryfast"
        },
        audioProfile: {
          audioCodec: "aac",
          audioBitrateKbps: 128
        }
      })
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();

    const previewRes = await authedFetch(
      apiPort,
      cookie,
      `/api/destinations/${created.id}/projector/preview.jpg`
    );
    assert.equal(previewRes.status, 200);
    assert.equal(previewRes.headers.get("content-type"), "image/jpeg");
    const buffer = Buffer.from(await previewRes.arrayBuffer());
    assert.deepEqual(buffer, jpegBuffer);
  } finally {
    await runtime.stop();
  }
});

test("runtime manages projector registry entries for scene capture destinations", async () => {
  const tempDir = makeTempDir();
  const apiPort = randomPort(8950);
  const dataDir = path.join(tempDir, "data");
  const dataFile = path.join(dataDir, "state.json");
  const logDir = path.join(dataDir, "logs");
  const fakeObsClient = new FakeObsClient();

  const runtime = createRuntime(
    {
      appName: "LAIVE OBS",
      version: "0.1.0-test",
      apiPort,
      wsPath: "/events",
      dataDir,
      dataFile,
      logDir,
      logLevel: "warn",
      dashboardPublicDir: path.resolve(
        __dirname,
        "..",
        "..",
        "dashboard",
        "public"
      ),
      ffmpegBin: "ffmpeg",
      rtmpPort: randomPort(9950),
      rtmpApp: "live",
      rtmpStreamKey: "master",
      obsWsUrl: "ws://127.0.0.1:4455",
      obsWsPassword: "",
      obsReconnectMs: 500,
      ffmpegMaxRetries: 2,
      obsEnabled: true,
      ingestEnabled: false
    },
    {
      obsClient: fakeObsClient,
      obsPlatform: "win32",
      obsSpawnSyncFn: () => ({
        status: 0,
        stdout: "",
        stderr: ""
      })
    }
  );

  await runtime.start();

  try {
    const cookie = await bootstrapAndLogin(apiPort);
    const createRes = await authedFetch(apiPort, cookie, "/api/destinations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Managed Projector",
        protocol: "rtmp",
        serverUrl: "rtmp://example.com/live",
        streamKey: "abc123",
        outputMode: "custom",
        videoSourceMode: "scene_projector_capture",
        sceneBinding: {
          sceneName: "Program",
          captureMethod: "windows_window_title",
          projectorWindowTitle: "Windowed Projector (Scene) - Program"
        },
        videoProfile: {
          videoCodec: "libx264",
          bitrateKbps: 2500,
          fps: 30,
          width: 1280,
          height: 720,
          gopSec: 2,
          preset: "veryfast"
        },
        audioProfile: {
          audioCodec: "aac",
          audioBitrateKbps: 128
        }
      })
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();

    const openRes = await authedFetch(
      apiPort,
      cookie,
      `/api/destinations/${created.id}/projector/open`,
      {
        method: "POST",
        headers: {}
      }
    );
    assert.equal(openRes.status, 200);

    const listRes = await authedFetch(apiPort, cookie, "/api/projectors/managed");
    assert.equal(listRes.status, 200);
    const listPayload = await listRes.json();
    assert.equal(Array.isArray(listPayload.projectors), true);
    assert.equal(listPayload.projectors.length, 1);
    assert.equal(listPayload.projectors[0].destinationId, created.id);
    assert.equal(listPayload.projectors[0].closeSupported, true);

    const reopenRes = await authedFetch(
      apiPort,
      cookie,
      `/api/projectors/managed/${created.id}/reopen`,
      {
        method: "POST",
        headers: {}
      }
    );
    assert.equal(reopenRes.status, 200);

    const closeRes = await authedFetch(
      apiPort,
      cookie,
      `/api/projectors/managed/${created.id}/close`,
      {
        method: "POST",
        headers: {}
      }
    );
    assert.equal(closeRes.status, 200);
    const closePayload = await closeRes.json();
    assert.equal(closePayload.ok, true);
    assert.equal(closePayload.closed.closeResult.closed, true);

    const deleteRes = await authedFetch(
      apiPort,
      cookie,
      `/api/projectors/managed/${created.id}`,
      {
        method: "DELETE",
        headers: {}
      }
    );
    assert.equal(deleteRes.status, 200);

    const afterDeleteRes = await authedFetch(
      apiPort,
      cookie,
      "/api/projectors/managed"
    );
    assert.equal(afterDeleteRes.status, 200);
    const afterDeletePayload = await afterDeleteRes.json();
    assert.equal(afterDeletePayload.projectors.length, 0);

    assert.equal(
      fakeObsClient.calls.filter((call) => call.name === "OpenSourceProjector").length >=
        2,
      true
    );
  } finally {
    await runtime.stop();
  }
});

test("runtime exposes transmission readiness with blocked missing audio track", async () => {
  const tempDir = makeTempDir();
  const apiPort = randomPort(9050);
  const dataDir = path.join(tempDir, "data");
  const dataFile = path.join(dataDir, "state.json");
  const logDir = path.join(dataDir, "logs");

  const runtime = createRuntime(
    {
      appName: "LAIVE OBS",
      version: "0.1.0-test",
      apiPort,
      wsPath: "/events",
      dataDir,
      dataFile,
      logDir,
      logLevel: "warn",
      dashboardPublicDir: path.resolve(
        __dirname,
        "..",
        "..",
        "dashboard",
        "public"
      ),
      ffmpegBin: "ffmpeg",
      ffprobeBin: "ffprobe",
      rtmpPort: randomPort(10050),
      rtmpApp: "live",
      rtmpStreamKey: "master",
      obsWsUrl: "ws://127.0.0.1:4455",
      obsWsPassword: "",
      obsReconnectMs: 500,
      ffmpegMaxRetries: 2,
      obsEnabled: false,
      ingestEnabled: true
    },
    {
      ffmpegSpawnSyncFn: (_command, args) => {
        if (Array.isArray(args) && args.includes("-show_streams")) {
          return {
            status: 0,
            stdout: JSON.stringify({
              streams: [
                {
                  index: 0,
                  codec_type: "video",
                  codec_name: "h264",
                  width: 1280,
                  height: 720
                },
                {
                  index: 1,
                  codec_type: "audio",
                  codec_name: "aac",
                  channels: 2,
                  sample_rate: "44100"
                }
              ]
            }),
            stderr: ""
          };
        }

        return {
          status: 0,
          stdout: "",
          stderr: ""
        };
      }
    }
  );

  await runtime.start();

  try {
    const cookie = await bootstrapAndLogin(apiPort);
    const createRes = await authedFetch(apiPort, cookie, "/api/destinations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "SRT Multi-track",
        protocol: "srt",
        serverUrl: "srt://127.0.0.1:9998?mode=caller&latency=2000000",
        outputMode: "custom",
        videoProfile: {
          videoCodec: "libx264",
          bitrateKbps: 2500,
          preset: "veryfast"
        },
        audioProfile: {
          audioCodec: "aac",
          audioBitrateKbps: 128,
          inputTrackIndex: 0,
          vodTrackInputIndex: 2
        }
      })
    });
    assert.equal(createRes.status, 201);

    const readinessRes = await authedFetch(
      apiPort,
      cookie,
      "/api/transmission/readiness"
    );
    assert.equal(readinessRes.status, 200);
    const readiness = await readinessRes.json();
    assert.equal(readiness.summary.blocked, 1);
    assert.equal(Array.isArray(readiness.destinations), true);
    assert.equal(
      readiness.destinations[0].checks.some(
        (check) => check.code === "vod_audio_track_missing"
      ),
      true
    );
  } finally {
    await runtime.stop();
  }
});
