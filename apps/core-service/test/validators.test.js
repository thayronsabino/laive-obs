const test = require("node:test");
const assert = require("node:assert/strict");
const {
  inferProtocolFromUrl,
  isDestinationUrl,
  isRtmpUrl,
  requiresStreamKey,
  assertDestinationPayload
} = require("../src/domain/validators");

test("isRtmpUrl accepts rtmp and rtmps protocols", () => {
  assert.equal(isRtmpUrl("rtmp://example.com/live"), true);
  assert.equal(isRtmpUrl("rtmps://example.com/live"), true);
});

test("isRtmpUrl rejects non-rtmp protocols", () => {
  assert.equal(isRtmpUrl("https://example.com/live"), false);
  assert.equal(isRtmpUrl(""), false);
});

test("inferProtocolFromUrl detects supported destination protocols", () => {
  assert.equal(inferProtocolFromUrl("rtmp://example.com/live"), "rtmp");
  assert.equal(inferProtocolFromUrl("rtmps://example.com/live"), "rtmps");
  assert.equal(inferProtocolFromUrl("srt://example.com:9998"), "srt");
  assert.equal(inferProtocolFromUrl("rist://example.com:8193"), "rist");
  assert.equal(inferProtocolFromUrl("https://example.com/whip"), "whip");
});

test("isDestinationUrl validates url against selected protocol", () => {
  assert.equal(isDestinationUrl("rtmp://example.com/live", "rtmp"), true);
  assert.equal(isDestinationUrl("rtmp://example.com/live", "rtmps"), false);
  assert.equal(isDestinationUrl("srt://example.com:9998", "srt"), true);
  assert.equal(isDestinationUrl("rist://example.com:8193", "rist"), true);
  assert.equal(isDestinationUrl("https://example.com/whip", "whip"), true);
});

test("requiresStreamKey only for rtmp-family protocols", () => {
  assert.equal(requiresStreamKey("rtmp"), true);
  assert.equal(requiresStreamKey("rtmps"), true);
  assert.equal(requiresStreamKey("srt"), false);
  assert.equal(requiresStreamKey("rist"), false);
  assert.equal(requiresStreamKey("whip"), false);
});

test("assertDestinationPayload validates required fields on create", () => {
  const errors = assertDestinationPayload({
    name: "",
    protocol: "rtmp",
    serverUrl: "https://bad.example.com",
    streamKey: ""
  });
  assert.equal(errors.length >= 3, true);
});

test("assertDestinationPayload accepts custom profile payload", () => {
  const errors = assertDestinationPayload({
    name: "YouTube",
    protocol: "rtmp",
    serverUrl: "rtmp://example.com/live",
    streamKey: "abc123",
    outputMode: "custom",
    videoProfile: {
      videoCodec: "h264_qsv",
      bitrateKbps: 3500,
      fps: 30,
      fpsDenominator: 1,
      width: 1920,
      height: 1080,
      gopSec: 2,
      bFrames: 2,
      preset: "veryfast"
    },
    audioProfile: {
      audioCodec: "aac",
      audioBitrateKbps: 160,
      inputTrackIndex: 0,
      vodTrackInputIndex: 1
    }
  });
  assert.deepEqual(errors, []);
});

test("assertDestinationPayload rejects invalid custom profile payload", () => {
  const errors = assertDestinationPayload({
    name: "YouTube",
    protocol: "rtmp",
    serverUrl: "rtmp://example.com/live",
    streamKey: "abc123",
    outputMode: "custom",
    videoProfile: {
      videoCodec: "unsupported_codec",
      bitrateKbps: -1
    },
    audioProfile: {
      audioCodec: "mp3"
    }
  });

  assert.equal(errors.length >= 2, true);
});

test("assertDestinationPayload accepts whip without stream key", () => {
  const errors = assertDestinationPayload({
    name: "WHIP endpoint",
    protocol: "whip",
    serverUrl: "https://whip.example.com/rtc/v1/whip",
    streamKey: "",
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
    }
  });

  assert.deepEqual(errors, []);
});

test("assertDestinationPayload accepts fps denominator and b-frames", () => {
  const errors = assertDestinationPayload({
    name: "Low fps mirror",
    protocol: "rtmp",
    serverUrl: "rtmp://example.com/live",
    streamKey: "abc123",
    outputMode: "custom",
    videoProfile: {
      videoCodec: "h264_amf",
      bitrateKbps: 2000,
      fpsDenominator: 2,
      width: 1280,
      height: 720,
      gopSec: 2,
      bFrames: 3,
      preset: "quality"
    },
    audioProfile: {
      audioCodec: "aac",
      audioBitrateKbps: 128,
      inputTrackIndex: 1,
      vodTrackInputIndex: 2
    }
  });

  assert.deepEqual(errors, []);
});

test("assertDestinationPayload accepts scene projector capture configuration", () => {
  const errors = assertDestinationPayload({
    name: "Instagram Scene B",
    protocol: "rtmp",
    serverUrl: "rtmp://example.com/live",
    streamKey: "abc123",
    outputMode: "custom",
    videoSourceMode: "scene_projector_capture",
    sceneBinding: {
      sceneName: "Scene B",
      captureMethod: "windows_window_title",
      projectorWindowTitle: "OBS Projector - Scene B"
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
      audioBitrateKbps: 128,
      inputTrackIndex: 0
    }
  });

  assert.deepEqual(errors, []);
});

test("assertDestinationPayload accepts macOS scene projector crop binding", () => {
  const errors = assertDestinationPayload({
    name: "macOS Scene Capture",
    protocol: "rtmp",
    serverUrl: "rtmp://example.com/live",
    streamKey: "abc123",
    outputMode: "custom",
    videoSourceMode: "scene_projector_capture",
    sceneBinding: {
      sceneName: "Program",
      captureMethod: "darwin_display_crop",
      projectorWindowTitle: "Windowed Projector - Program",
      captureDisplayIndex: 1,
      captureCropX: 100,
      captureCropY: 200,
      captureCropWidth: 1280,
      captureCropHeight: 720
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
  });

  assert.deepEqual(errors, []);
});

test("assertDestinationPayload accepts linux x11 window binding", () => {
  const errors = assertDestinationPayload({
    name: "Linux Scene Capture",
    protocol: "rtmp",
    serverUrl: "rtmp://example.com/live",
    streamKey: "abc123",
    outputMode: "custom",
    videoSourceMode: "scene_projector_capture",
    sceneBinding: {
      sceneName: "Program",
      captureMethod: "linux_x11_window_id",
      projectorWindowTitle: "Windowed Projector (Scene) - Program",
      x11WindowId: "0x04600007",
      x11Display: ":0.0"
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
  });

  assert.deepEqual(errors, []);
});

test("assertDestinationPayload requires scene binding when scene projector capture is enabled", () => {
  const errors = assertDestinationPayload({
    name: "Broken Scene Capture",
    protocol: "rtmp",
    serverUrl: "rtmp://example.com/live",
    streamKey: "abc123",
    outputMode: "custom",
    videoSourceMode: "scene_projector_capture",
    sceneBinding: {
      sceneName: "",
      captureMethod: "windows_window_title",
      projectorWindowTitle: ""
    },
    videoProfile: {
      videoCodec: "libx264",
      bitrateKbps: 2500,
      preset: "veryfast"
    },
    audioProfile: {
      audioCodec: "aac",
      audioBitrateKbps: 128
    }
  });

  assert.equal(
    errors.some((error) => error.includes("sceneBinding.sceneName")),
    true
  );
});
