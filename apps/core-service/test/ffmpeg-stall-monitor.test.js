const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { EventBus } = require("../src/services/event-bus");
const { FFmpegService } = require("../src/services/ffmpeg-service");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEvent(eventBus, type, timeoutMs = 800) {
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

  child.pid = options.pid || 2345;
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

test("FFmpegService detects stalled live pipeline and requests restart", async () => {
  const eventBus = new EventBus();
  const destinationStatuses = [];
  const { child, killCalls } = createFakeChild({
    withStdin: false,
    onKill: (signal, proc) => {
      if (signal === "SIGTERM") {
        setTimeout(() => {
          proc.exitCode = 1;
          proc.emit("exit", 1, "SIGTERM");
        }, 0);
      }
    }
  });

  const service = new FFmpegService({
    eventBus,
    ffmpegBin: "ffmpeg",
    maxRetries: 0,
    connectTimeoutMs: 5000,
    stopGraceMs: 60,
    liveConfirmMs: 20,
    stallTimeoutMs: 40,
    stallMonitorIntervalMs: 10,
    spawnProcessFn: () => child,
    onDestinationStatusChange: (destinationId, status) => {
      destinationStatuses.push({ destinationId, status });
    }
  });

  const destination = {
    id: "dest-stall",
    name: "Stall",
    bitrateKbps: 0
  };

  service.start(
    destination,
    "rtmp://127.0.0.1:1935/live/master",
    "rtmp://example.com/live/key"
  );

  const stalledEvent = await waitForEvent(eventBus, "engine.pipeline_stalled");
  await waitForEvent(eventBus, "destination.error");

  assert.equal(stalledEvent.payload.destinationId, destination.id);
  assert.equal(killCalls.includes("SIGTERM"), true);
  assert.equal(
    destinationStatuses.some((entry) => entry.status === "error"),
    true
  );
});

test("FFmpegService keeps healthy pipeline running when progress is flowing", async () => {
  const eventBus = new EventBus();
  let stallEvents = 0;
  eventBus.on("engine.pipeline_stalled", () => {
    stallEvents += 1;
  });

  const { child, killCalls } = createFakeChild({
    withStdin: true,
    onStdinWrite: (proc) => {
      setTimeout(() => {
        proc.exitCode = 0;
        proc.emit("exit", 0, "SIGTERM");
      }, 0);
    }
  });

  const service = new FFmpegService({
    eventBus,
    ffmpegBin: "ffmpeg",
    maxRetries: 0,
    connectTimeoutMs: 5000,
    stopGraceMs: 60,
    liveConfirmMs: 20,
    stallTimeoutMs: 90,
    stallMonitorIntervalMs: 15,
    spawnProcessFn: () => child,
    onDestinationStatusChange: () => {}
  });

  const destination = {
    id: "dest-healthy",
    name: "Healthy",
    bitrateKbps: 0
  };

  service.start(
    destination,
    "rtmp://127.0.0.1:1935/live/master",
    "rtmp://example.com/live/key"
  );

  const producer = setInterval(() => {
    child.stderr.emit("data", "out_time_ms=2000000\nprogress=continue\n");
  }, 20);

  await wait(220);
  clearInterval(producer);

  assert.equal(stallEvents, 0);
  assert.equal(killCalls.includes("SIGTERM"), false);

  service.stop(destination.id);
  await waitForEvent(eventBus, "destination.stopped");
});
