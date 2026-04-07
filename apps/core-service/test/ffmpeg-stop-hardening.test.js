const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { EventBus } = require("../src/services/event-bus");
const { FFmpegService } = require("../src/services/ffmpeg-service");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEvent(eventBus, type, timeoutMs = 600) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      eventBus.off(type, onEvent);
      reject(new Error(`Timed out waiting for event '${type}'.`));
    }, timeoutMs);

    function onEvent(event) {
      clearTimeout(timer);
      eventBus.off(type, onEvent);
      resolve(event);
    }

    eventBus.on(type, onEvent);
  });
}

function createFakeChild(options = {}) {
  const child = new EventEmitter();
  const killCalls = [];

  child.pid = options.pid || 9876;
  child.exitCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = options.withStdin
    ? {
        write: () => {
          if (typeof options.onStdinWrite === "function") {
            options.onStdinWrite(child);
          }
        }
      }
    : null;

  child.kill = (signal = "SIGTERM") => {
    killCalls.push(signal);
    if (typeof options.onKill === "function") {
      options.onKill(signal, child);
    }
    return true;
  };

  return { child, killCalls };
}

test("FFmpegService escalates to force-kill when graceful stop times out", async () => {
  const eventBus = new EventBus();
  const statusUpdates = [];
  const { child, killCalls } = createFakeChild({
    withStdin: false,
    onKill: (signal, proc) => {
      if (signal === "SIGKILL") {
        setTimeout(() => {
          proc.exitCode = 0;
          proc.emit("exit", 0, "SIGKILL");
        }, 0);
      }
    }
  });

  const service = new FFmpegService({
    eventBus,
    ffmpegBin: "ffmpeg",
    maxRetries: 0,
    connectTimeoutMs: 2000,
    stopGraceMs: 40,
    spawnProcessFn: () => child,
    onDestinationStatusChange: (destinationId, status, errorMessage = null) => {
      statusUpdates.push({ destinationId, status, errorMessage });
    }
  });

  const destination = {
    id: "dest-force-kill",
    name: "Force Kill",
    bitrateKbps: 0
  };

  service.start(
    destination,
    "rtmp://127.0.0.1:1935/live/master",
    "rtmp://example.com/live/key"
  );
  service.stop(destination.id);

  await waitForEvent(eventBus, "engine.force_kill_requested");
  await waitForEvent(eventBus, "destination.stopped");

  assert.deepEqual(killCalls.slice(0, 2), ["SIGTERM", "SIGKILL"]);
  assert.equal(service.isRunning(destination.id), false);
  assert.equal(statusUpdates.some((entry) => entry.status === "stopped"), true);
});

test("FFmpegService does not force-kill when graceful stop succeeds", async () => {
  const eventBus = new EventBus();
  let forceKillRequested = 0;
  eventBus.on("engine.force_kill_requested", () => {
    forceKillRequested += 1;
  });

  const { child, killCalls } = createFakeChild({
    withStdin: true,
    onStdinWrite: (proc) => {
      setTimeout(() => {
        proc.exitCode = 0;
        proc.emit("exit", 0, "SIGTERM");
      }, 10);
    }
  });

  const service = new FFmpegService({
    eventBus,
    ffmpegBin: "ffmpeg",
    maxRetries: 0,
    connectTimeoutMs: 2000,
    stopGraceMs: 60,
    spawnProcessFn: () => child,
    onDestinationStatusChange: () => {}
  });

  const destination = {
    id: "dest-graceful-stop",
    name: "Graceful Stop",
    bitrateKbps: 0
  };

  service.start(
    destination,
    "rtmp://127.0.0.1:1935/live/master",
    "rtmp://example.com/live/key"
  );
  service.stop(destination.id);

  await waitForEvent(eventBus, "destination.stopped");
  await wait(120);

  assert.equal(forceKillRequested, 0);
  assert.equal(killCalls.includes("SIGKILL"), false);
});
