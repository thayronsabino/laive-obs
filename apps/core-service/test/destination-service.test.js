const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PersistenceService } = require("../src/services/persistence-service");
const { DestinationService } = require("../src/services/destination-service");

function createDestinationServiceFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "laive-destination-test-"));
  const dataDir = path.join(tempDir, "data");
  const dataFile = path.join(dataDir, "state.json");
  const persistenceService = new PersistenceService({ dataDir, dataFile });
  return new DestinationService(persistenceService);
}

test("DestinationService.update applies output mode/profile patch without crashing", () => {
  const service = createDestinationServiceFixture();
  const created = service.create({
    name: "YouTube",
    protocol: "rtmps",
    serverUrl: "rtmps://a.rtmp.youtube.com/live2",
    streamKey: "test-key",
    bitrateKbps: 4000
  });

  const updated = service.update(created.id, {
    outputMode: "custom",
    videoProfile: {
      videoCodec: "libx264",
      bitrateKbps: 3500,
      fps: 30,
      width: 1920,
      height: 1080,
      gopSec: 2,
      preset: "veryfast"
    },
    audioProfile: {
      audioCodec: "aac",
      audioBitrateKbps: 160
    }
  });

  assert.equal(updated.outputMode, "custom");
  assert.equal(updated.protocol, "rtmps");
  assert.equal(updated.videoProfile.videoCodec, "libx264");
  assert.equal(updated.videoProfile.width, 1920);
  assert.equal(updated.audioProfile.audioBitrateKbps, 160);
});

test("DestinationService.update keeps current profile fields when patch omits them", () => {
  const service = createDestinationServiceFixture();
  const created = service.create({
    name: "Kick",
    protocol: "rtmps",
    serverUrl: "rtmps://fa.kick.com/live",
    streamKey: "secret-key",
    outputMode: "custom",
    videoProfile: {
      videoCodec: "libx264",
      bitrateKbps: 2500,
      fps: 30,
      fpsDenominator: 1,
      width: 1280,
      height: 720,
      gopSec: 2,
      bFrames: 2,
      preset: "veryfast"
    },
    audioProfile: {
      audioCodec: "aac",
      audioBitrateKbps: 128,
      inputTrackIndex: 2,
      vodTrackInputIndex: 4
    }
  });

  const updated = service.update(created.id, {
    name: "Kick Main"
  });

  assert.equal(updated.name, "Kick Main");
  assert.equal(updated.outputMode, "custom");
  assert.equal(updated.videoProfile.width, 1280);
  assert.equal(updated.videoProfile.fpsDenominator, 1);
  assert.equal(updated.videoProfile.bFrames, 2);
  assert.equal(updated.audioProfile.audioBitrateKbps, 128);
  assert.equal(updated.audioProfile.inputTrackIndex, 2);
  assert.equal(updated.audioProfile.vodTrackInputIndex, 4);
});

test("DestinationService infers protocol for legacy records and keeps non-rtmp publish urls", () => {
  const service = createDestinationServiceFixture();
  const legacy = service.create({
    name: "Legacy RTMP",
    serverUrl: "rtmp://example.com/live",
    streamKey: "legacy-key"
  });
  assert.equal(legacy.protocol, "rtmp");

  const srt = service.create({
    name: "SRT Gateway",
    protocol: "srt",
    serverUrl: "srt://127.0.0.1:9998?mode=caller&latency=2000000",
    streamKey: ""
  });

  const internal = service.getInternal(srt.id);
  assert.equal(internal.protocol, "srt");
  assert.equal(srt.streamKeyMasked, "");
  assert.equal(
    service.getPublishUrl(internal),
    "srt://127.0.0.1:9998?mode=caller&latency=2000000"
  );
});

test("DestinationService.reorder persists destination order", () => {
  const service = createDestinationServiceFixture();
  const first = service.create({
    name: "First",
    serverUrl: "rtmp://example.com/live",
    streamKey: "first-key"
  });
  const second = service.create({
    name: "Second",
    serverUrl: "rtmp://example.com/live",
    streamKey: "second-key"
  });
  const third = service.create({
    name: "Third",
    serverUrl: "rtmp://example.com/live",
    streamKey: "third-key"
  });

  const reordered = service.reorder([third.id, first.id, second.id]);

  assert.deepEqual(
    reordered.map((item) => item.id),
    [third.id, first.id, second.id]
  );
  assert.deepEqual(
    service.list().map((item) => item.id),
    [third.id, first.id, second.id]
  );
});

test("DestinationService keeps optional non-rtmp token unless protocol transition should clear it", () => {
  const service = createDestinationServiceFixture();
  const srt = service.create({
    name: "SRT tokenized",
    protocol: "srt",
    serverUrl: "srt://127.0.0.1:9998?mode=caller&latency=2000000",
    streamKey: "session-token"
  });

  const srtUpdated = service.update(srt.id, {
    name: "SRT tokenized 2"
  });
  assert.equal(Boolean(srtUpdated.streamKeyMasked), true);

  const rtmp = service.create({
    name: "RTMP key",
    protocol: "rtmp",
    serverUrl: "rtmp://example.com/live",
    streamKey: "keep-me"
  });

  const migrated = service.update(rtmp.id, {
    protocol: "srt",
    serverUrl: "srt://127.0.0.1:9998?mode=caller&latency=2000000"
  });
  assert.equal(migrated.streamKeyMasked, "");
});

test("DestinationService persists standalone scene projector configuration", () => {
  const service = createDestinationServiceFixture();
  const created = service.create({
    name: "Scene Capture",
    protocol: "rtmp",
    serverUrl: "rtmp://example.com/live",
    streamKey: "scene-key",
    outputMode: "custom",
    videoSourceMode: "scene_projector_capture",
    sceneBinding: {
      sceneName: "Main Wide",
      captureMethod: "windows_window_title",
      projectorWindowTitle: "OBS Projector - Main Wide"
    },
    videoProfile: {
      videoCodec: "libx264",
      bitrateKbps: 3500,
      fps: 30,
      width: 1920,
      height: 1080,
      gopSec: 2,
      preset: "veryfast"
    },
    audioProfile: {
      audioCodec: "aac",
      audioBitrateKbps: 160
    }
  });

  assert.equal(created.videoSourceMode, "scene_projector_capture");
  assert.equal(created.sceneBinding.sceneName, "Main Wide");
  assert.equal(
    created.sceneBinding.projectorWindowTitle,
    "OBS Projector - Main Wide"
  );
});
