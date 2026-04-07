const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { WebSocket } = require("ws");
const { createRuntime } = require("../src/app-runtime");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "laive-core-security-test-"));
}

function randomPort(base = 6200) {
  return base + Math.floor(Math.random() * 1000);
}

function buildRuntimeConfig(tempDir, apiPort, overrides = {}) {
  const dataDir = path.join(tempDir, "data");
  return {
    appName: "LAIVE OBS",
    version: "0.1.0-test",
    apiPort,
    apiBindAddress: "127.0.0.1",
    wsPath: "/events",
    dataDir,
    dataFile: path.join(dataDir, "state.json"),
    logDir: path.join(dataDir, "logs"),
    logLevel: "warn",
    dashboardPublicDir: path.resolve(__dirname, "..", "..", "dashboard", "public"),
    ffmpegBin: "ffmpeg",
    rtmpPort: randomPort(7600),
    rtmpApp: "live",
    rtmpStreamKey: "master",
    obsWsUrl: "ws://127.0.0.1:4455",
    obsWsPassword: "",
    obsReconnectMs: 500,
    ffmpegMaxRetries: 1,
    authRateLimitMax: 20,
    authRateLimitWindowMs: 60000,
    wsAllowedOrigins: [],
    obsEnabled: false,
    ingestEnabled: false,
    ...overrides
  };
}

async function bootstrapAuth(apiPort) {
  return fetch(`http://127.0.0.1:${apiPort}/api/auth/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password: "strong-password-123"
    })
  });
}

async function login(apiPort, password = "strong-password-123") {
  return fetch(`http://127.0.0.1:${apiPort}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password
    })
  });
}

async function connectWsAndCollectClose(url, headers, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const socket = new WebSocket(url, { headers });
    const timer = setTimeout(() => {
      try {
        socket.terminate();
      } catch (_) {
        // ignore
      }
      reject(new Error("Timed out waiting for websocket close."));
    }, timeoutMs);

    socket.on("message", (value) => {
      messages.push(String(value));
    });

    socket.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, messages });
    });

    socket.on("error", () => {
      // Ignore error and wait for close to collect any server payload.
    });
  });
}

test("rate limit blocks repeated auth login attempts", async () => {
  const tempDir = makeTempDir();
  const apiPort = randomPort();
  const runtime = createRuntime(
    buildRuntimeConfig(tempDir, apiPort, {
      authRateLimitMax: 2,
      authRateLimitWindowMs: 60000
    })
  );

  await runtime.start();

  try {
    const bootstrapRes = await bootstrapAuth(apiPort);
    assert.equal(bootstrapRes.status, 201);

    const first = await login(apiPort, "wrong-password");
    const second = await login(apiPort, "wrong-password");
    const third = await login(apiPort, "wrong-password");

    assert.equal(first.status, 401);
    assert.equal(second.status, 401);
    assert.equal(third.status, 429);
    assert.equal(Boolean(third.headers.get("retry-after")), true);

    const payload = await third.json();
    assert.equal(payload.code, "AUTH_RATE_LIMITED");
  } finally {
    await runtime.stop();
  }
});

test("websocket blocks non-whitelisted origin when whitelist is configured", async () => {
  const tempDir = makeTempDir();
  const apiPort = randomPort(7000);
  const runtime = createRuntime(
    buildRuntimeConfig(tempDir, apiPort, {
      wsAllowedOrigins: ["http://allowed.local"]
    })
  );

  await runtime.start();

  try {
    const bootstrapRes = await bootstrapAuth(apiPort);
    assert.equal(bootstrapRes.status, 201);

    const loginRes = await login(apiPort);
    assert.equal(loginRes.status, 200);
    const cookie = loginRes.headers.get("set-cookie");
    assert.equal(Boolean(cookie), true);

    const blocked = await connectWsAndCollectClose(
      `ws://127.0.0.1:${apiPort}/events`,
      {
        Cookie: cookie,
        Origin: "http://blocked.local"
      }
    );

    assert.equal(blocked.messages.length > 0, true);
    const parsedMessages = blocked.messages.map((line) => JSON.parse(line));
    assert.equal(
      parsedMessages.some((event) => event.type === "system.origin_not_allowed"),
      true
    );
  } finally {
    await runtime.stop();
  }
});
