const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { ObsService } = require("../src/services/obs-service");

class FakeObsClient extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.calls = [];
  }

  async connect() {
    this.connected = true;
    this.emit("ConnectionOpened");
  }

  async disconnect() {
    this.connected = false;
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
      return { currentProgramSceneName: "Intro" };
    }
    if (name === "GetSceneList") {
      return {
        currentProgramSceneName: "Intro",
        scenes: [{ sceneName: "Intro" }, { sceneName: "Main" }]
      };
    }
    if (name === "GetMonitorList") {
      return {
        monitors: [{ monitorIndex: 0, monitorName: "Primary" }]
      };
    }
    return {};
  }
}

test("ObsService updates status and emits start/stop stream events", async () => {
  const events = [];
  const eventBus = {
    publish: (type) => events.push(type)
  };
  const fake = new FakeObsClient();
  let callbackStates = [];

  const service = new ObsService({
    eventBus,
    url: "ws://mock",
    password: "",
    reconnectMs: 100,
    onStreamingStateChanged: (active) => callbackStates.push(active),
    obsClient: fake
  });

  service.start();
  fake.emit("StreamStateChanged", { outputActive: true, outputState: "OBS_WEBSOCKET_OUTPUT_STARTED" });
  fake.emit("StreamStateChanged", { outputActive: false, outputState: "OBS_WEBSOCKET_OUTPUT_STOPPED" });

  await service.stop();

  assert.equal(service.getStatus().connected, false);
  assert.equal(callbackStates.includes(true), true);
  assert.equal(callbackStates.filter((state) => state === false).length >= 1, true);
  assert.ok(events.includes("obs.connected"));
  assert.ok(events.includes("obs.streaming_started"));
  assert.ok(events.includes("obs.streaming_stopped"));
});

test("ObsService supports bidirectional command wrappers", async () => {
  const fake = new FakeObsClient();
  const service = new ObsService({
    eventBus: { publish: () => {} },
    url: "ws://mock",
    password: "",
    reconnectMs: 100,
    obsClient: fake
  });

  service.start();
  const scenes = await service.listScenes();
  await service.startStream();
  await service.stopStream();
  await service.startRecord();
  await service.stopRecord();
  await service.switchScene("Main");
  await service.stop();

  assert.equal(Array.isArray(scenes.scenes), true);
  assert.equal(scenes.currentSceneName, "Intro");
  assert.equal(fake.calls.some((call) => call.name === "StartStream"), true);
  assert.equal(fake.calls.some((call) => call.name === "StopStream"), true);
  assert.equal(fake.calls.some((call) => call.name === "StartRecord"), true);
  assert.equal(fake.calls.some((call) => call.name === "StopRecord"), true);
  assert.equal(
    fake.calls.some(
      (call) => call.name === "SetCurrentProgramScene" && call.data.sceneName === "Main"
    ),
    true
  );
});

test("ObsService exposes projector and monitor wrappers", async () => {
  const fake = new FakeObsClient();
  const service = new ObsService({
    eventBus: { publish: () => {} },
    url: "ws://mock",
    password: "",
    reconnectMs: 100,
    obsClient: fake
  });

  service.start();
  const monitors = await service.listMonitors();
  await service.openSourceProjector({
    sourceName: "Intro",
    monitorIndex: -1
  });
  await service.openVideoMixProjector({
    videoMixType: "OBS_WEBSOCKET_VIDEO_MIX_TYPE_PROGRAM",
    projectorGeometry: "encoded-geometry"
  });
  await service.stop();

  assert.equal(Array.isArray(monitors.monitors), true);
  assert.equal(monitors.monitors[0].monitorName, "Primary");
  assert.equal(
    fake.calls.some(
      (call) =>
        call.name === "OpenSourceProjector" &&
        call.data.sourceName === "Intro" &&
        call.data.monitorIndex === -1
    ),
    true
  );
  assert.equal(
    fake.calls.some(
      (call) =>
        call.name === "OpenVideoMixProjector" &&
        call.data.videoMixType === "OBS_WEBSOCKET_VIDEO_MIX_TYPE_PROGRAM" &&
        call.data.projectorGeometry === "encoded-geometry"
    ),
    true
  );
});

test("ObsService validates projector payloads before forwarding to OBS", async () => {
  const fake = new FakeObsClient();
  const service = new ObsService({
    eventBus: { publish: () => {} },
    url: "ws://mock",
    password: "",
    reconnectMs: 100,
    obsClient: fake
  });

  service.start();

  await assert.rejects(
    () =>
      service.openSourceProjector({
        monitorIndex: -1
      }),
    /sourceName or sourceUuid is required/
  );

  await assert.rejects(
    () =>
      service.openVideoMixProjector({
        videoMixType: "OBS_WEBSOCKET_VIDEO_MIX_TYPE_PROGRAM",
        monitorIndex: 0,
        projectorGeometry: "geometry"
      }),
    /mutually exclusive/
  );

  await service.stop();
});

test("ObsService discovers and ranks projector windows on Windows", async () => {
  const fake = new FakeObsClient();
  const service = new ObsService({
    eventBus: { publish: () => {} },
    url: "ws://mock",
    password: "",
    reconnectMs: 100,
    obsClient: fake,
    platform: "win32",
    listWindowsFn: () => [
      { title: "OBS 31.1.0 - Profile", processId: 10 },
      { title: "Windowed Projector (Scene) - Main Wide", processId: 10 },
      { title: "Windowed Projector (Source) - Main Wide", processId: 10 },
      { title: "Windowed Projector (Scene) - Youth", processId: 10 }
    ]
  });

  const windows = await service.listProjectorWindows({ sceneName: "Main Wide" });

  assert.equal(Array.isArray(windows.windows), true);
  assert.equal(windows.windows[0].title.includes("Main Wide"), true);
  assert.equal(windows.windows.some((item) => item.title.includes("Profile")), false);
});

test("ObsService closes managed projector windows on Windows via title", () => {
  const calls = [];
  const service = new ObsService({
    eventBus: { publish: () => {} },
    url: "ws://mock",
    password: "",
    reconnectMs: 100,
    platform: "win32",
    obsClient: new FakeObsClient(),
    spawnSyncFn: (command, args) => {
      calls.push({ command, args });
      return {
        status: 0,
        stdout: "",
        stderr: ""
      };
    }
  });

  const result = service.closeProjectorWindow({
    projectorWindowTitle: "Windowed Projector (Scene) - Program"
  });

  assert.equal(result.closed, true);
  assert.equal(calls[0].command, "powershell");
  assert.equal(
    calls[0].args.some((arg) => String(arg).includes("Windowed Projector (Scene) - Program")),
    true
  );
});

test("ObsService reports close unsupported on Linux when x11WindowId is missing", () => {
  const service = new ObsService({
    eventBus: { publish: () => {} },
    url: "ws://mock",
    password: "",
    reconnectMs: 100,
    platform: "linux",
    obsClient: new FakeObsClient()
  });

  assert.throws(
    () =>
      service.closeProjectorWindow({
        projectorWindowTitle: "Windowed Projector (Scene) - Program"
      }),
    (error) => {
      assert.equal(error.code, "OBS_UNSUPPORTED_REQUEST");
      assert.equal(Array.isArray(error.details), true);
      assert.equal(error.details.includes("x11_window_id_missing"), true);
      return true;
    }
  );
});
