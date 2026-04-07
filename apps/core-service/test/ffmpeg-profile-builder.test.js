const test = require("node:test");
const assert = require("node:assert/strict");
const { FFmpegService } = require("../src/services/ffmpeg-service");

function buildService({ encoders = [], platform, spawnSyncFn } = {}) {
  const events = [];
  const service = new FFmpegService({
    eventBus: {
      publish: (type, payload) => events.push({ type, payload })
    },
    ffmpegBin: "ffmpeg",
    maxRetries: 3,
    onDestinationStatusChange: () => {},
    probeEncodersFn: () => encoders,
    platform,
    spawnSyncFn
  });
  return { service, events };
}

test("FFmpegService builds inherit args when outputMode is inherit", () => {
  const { service } = buildService();
  const args = service.buildArgs(
    {
      id: "d1",
      protocol: "rtmp",
      outputMode: "inherit",
      bitrateKbps: 0
    },
    "rtmp://127.0.0.1/live/master",
    "rtmp://example.com/live/key"
  );
  assert.equal(args.includes("-c"), true);
  assert.equal(args.includes("copy"), true);
  assert.equal(args.includes("flv"), true);
});

test("FFmpegService builds custom args and keeps supported hardware encoder", () => {
  const { service, events } = buildService({
    encoders: [
      " V....D h264_nvenc NVENC H.264 encoder ",
      " V....D h264_qsv Intel Quick Sync Video H.264 encoder "
    ]
  });
  const args = service.buildArgs(
    {
      id: "d2",
      protocol: "rtmp",
      outputMode: "custom",
      videoProfile: {
        videoCodec: "h264_qsv",
        bitrateKbps: 3000,
        fps: 0,
        fpsDenominator: 2,
        width: 1280,
        height: 720,
        gopSec: 2,
        bFrames: 2,
        preset: "p4"
      },
      audioProfile: {
        audioCodec: "aac",
        audioBitrateKbps: 160
      }
    },
    "rtmp://127.0.0.1/live/master",
    "rtmp://example.com/live/key"
  );

  assert.equal(args.includes("h264_qsv"), true);
  assert.equal(args.includes("scale=1280:720,fps=fps=source_fps/2"), true);
  assert.equal(args.includes("-bf"), true);
  assert.equal(args[args.indexOf("-bf") + 1], "2");
  assert.equal(args.includes("160k"), true);
  assert.equal(events.some((event) => event.type === "destination.profile_warning"), false);
});

test("FFmpegService falls back to libx264 when hardware encoder is unavailable", () => {
  const { service, events } = buildService({
    encoders: []
  });
  const args = service.buildArgs(
    {
      id: "d3",
      protocol: "rtmp",
      outputMode: "custom",
      videoProfile: {
        videoCodec: "h264_videotoolbox",
        bitrateKbps: 2500,
        preset: "veryfast"
      },
      audioProfile: {
        audioCodec: "aac",
        audioBitrateKbps: 128
      }
    },
    "rtmp://127.0.0.1/live/master",
    "rtmp://example.com/live/key"
  );

  assert.equal(args.includes("libx264"), true);
  assert.equal(
    events.some((event) => event.type === "destination.profile_warning"),
    true
  );
});

test("FFmpegService detects AMF encoder when available", () => {
  const { service } = buildService({
    encoders: [" V....D h264_amf AMD AMF H.264 Encoder "]
  });

  const args = service.buildArgs(
    {
      id: "d3a",
      protocol: "rtmp",
      outputMode: "custom",
      videoProfile: {
        videoCodec: "h264_amf",
        bitrateKbps: 2500,
        preset: "quality"
      },
      audioProfile: {
        audioCodec: "aac",
        audioBitrateKbps: 128
      }
    },
    "rtmp://127.0.0.1/live/master",
    "rtmp://example.com/live/key"
  );

  assert.equal(args.includes("h264_amf"), true);
});

test("FFmpegService falls back from libopus to aac for rtmp outputs", () => {
  const { service, events } = buildService();
  const args = service.buildArgs(
    {
      id: "d3b",
      protocol: "rtmp",
      outputMode: "custom",
      videoProfile: {
        videoCodec: "libx264",
        bitrateKbps: 2500,
        preset: "veryfast"
      },
      audioProfile: {
        audioCodec: "libopus",
        audioBitrateKbps: 96
      }
    },
    "rtmp://127.0.0.1/live/master",
    "rtmp://example.com/live/key"
  );

  assert.equal(args.includes("aac"), true);
  assert.equal(args.includes("libopus"), false);
  assert.equal(
    events.some((event) => event.payload && event.payload.fallbackAudioCodec === "aac"),
    true
  );
});

test("FFmpegService uses mpegts output for srt destinations", () => {
  const { service } = buildService();
  const args = service.buildArgs(
    {
      id: "d4",
      protocol: "srt",
      outputMode: "inherit",
      bitrateKbps: 0
    },
    "rtmp://127.0.0.1/live/master",
    "srt://127.0.0.1:9998?mode=caller&latency=2000000"
  );

  assert.equal(args.includes("mpegts"), true);
  assert.equal(args.includes("flv"), false);
});

test("FFmpegService maps primary and vod audio tracks for srt custom outputs", () => {
  const { service } = buildService();
  const args = service.buildArgs(
    {
      id: "d4a",
      protocol: "srt",
      outputMode: "custom",
      videoProfile: {
        videoCodec: "libx264",
        bitrateKbps: 2500,
        preset: "veryfast"
      },
      audioProfile: {
        audioCodec: "aac",
        audioBitrateKbps: 128,
        inputTrackIndex: 1,
        vodTrackInputIndex: 3
      }
    },
    "rtmp://127.0.0.1/live/master",
    "srt://127.0.0.1:9998?mode=caller&latency=2000000"
  );

  assert.equal(args.includes("0:a:1?"), true);
  assert.equal(args.includes("0:a:3?"), true);
  assert.equal(args.includes("-c:a:1"), true);
});

test("FFmpegService warns when vod track is requested for unsupported protocol", () => {
  const { service, events } = buildService();
  const args = service.buildArgs(
    {
      id: "d4b",
      protocol: "rtmp",
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
    },
    "rtmp://127.0.0.1/live/master",
    "rtmp://example.com/live/key"
  );

  assert.equal(args.includes("0:a:2?"), false);
  assert.equal(
    events.some((event) => event.payload && event.payload.reason === "vod_track_not_supported_by_protocol"),
    true
  );
});

test("FFmpegService builds low-latency whip args", () => {
  const { service } = buildService();
  const args = service.buildArgs(
    {
      id: "d5",
      protocol: "whip",
      outputMode: "custom",
      bitrateKbps: 2200,
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
    },
    "rtmp://127.0.0.1/live/master",
    "https://whip.example.com/rtc/v1/whip/?app=live&stream=main"
  );

  assert.equal(args.includes("libx264"), true);
  assert.equal(args.includes("libopus"), true);
  assert.equal(args.includes("baseline"), true);
  assert.equal(args.indexOf("-bf") >= 0, true);
  assert.equal(args[args.indexOf("-bf") + 1], "0");
  assert.equal(args.includes("whip"), true);
});

test("FFmpegService builds projector capture input args on Windows", () => {
  const { service } = buildService({ platform: "win32" });
  const args = service.buildArgs(
    {
      id: "d6",
      protocol: "rtmp",
      outputMode: "custom",
      videoSourceMode: "scene_projector_capture",
      sceneBinding: {
        sceneName: "Stage Left",
        captureMethod: "windows_window_title",
        projectorWindowTitle: "OBS Projector - Stage Left"
      },
      videoProfile: {
        videoCodec: "libx264",
        bitrateKbps: 2200,
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
    },
    "rtmp://127.0.0.1/live/master",
    "rtmp://example.com/live/key"
  );

  assert.equal(args.includes("gdigrab"), true);
  assert.equal(args.includes("title=OBS Projector - Stage Left"), true);
  assert.equal(args.includes("0:v:0?"), true);
  assert.equal(args.includes("1:a:0?"), true);
});

test("FFmpegService falls back from copy codec for projector capture", () => {
  const { service, events } = buildService({ platform: "win32" });
  const args = service.buildArgs(
    {
      id: "d7",
      protocol: "rtmp",
      outputMode: "custom",
      videoSourceMode: "scene_projector_capture",
      sceneBinding: {
        sceneName: "Stage Right",
        captureMethod: "windows_window_title",
        projectorWindowTitle: "OBS Projector - Stage Right"
      },
      videoProfile: {
        videoCodec: "copy",
        bitrateKbps: 2200,
        preset: "veryfast"
      },
      audioProfile: {
        audioCodec: "aac",
        audioBitrateKbps: 128
      }
    },
    "rtmp://127.0.0.1/live/master",
    "rtmp://example.com/live/key"
  );

  assert.equal(args.includes("libx264"), true);
  assert.equal(
    events.some(
      (event) =>
        event.payload &&
        event.payload.reason === "video_copy_not_supported_for_projector_capture"
    ),
    true
  );
});

test("FFmpegService parses avfoundation screen capture devices", () => {
  const { service } = buildService({ platform: "darwin" });
  const devices = service.parseMacScreenCaptureDevices(`
[AVFoundation indev @ 0x0] AVFoundation video devices:
[AVFoundation indev @ 0x0] [0] FaceTime HD Camera
[AVFoundation indev @ 0x0] [1] Capture screen 0 (ID: 69733120)
[AVFoundation indev @ 0x0] [2] Capture screen 1 (ID: 69733376)
  `);

  assert.equal(devices.length, 2);
  assert.equal(devices[0].videoDeviceIndex, 1);
  assert.equal(devices[0].screenIndex, 0);
  assert.equal(devices[0].captureId, "69733120");
});

test("FFmpegService builds macOS projector crop args", () => {
  const { service } = buildService({ platform: "darwin" });
  const args = service.buildArgs(
    {
      id: "d8",
      protocol: "rtmp",
      outputMode: "custom",
      videoSourceMode: "scene_projector_capture",
      sceneBinding: {
        sceneName: "Mac Scene",
        captureMethod: "darwin_display_crop",
        projectorWindowTitle: "Windowed Projector - Mac Scene",
        captureDisplayIndex: 1,
        captureCropX: 100,
        captureCropY: 200,
        captureCropWidth: 1280,
        captureCropHeight: 720
      },
      videoProfile: {
        videoCodec: "libx264",
        bitrateKbps: 2400,
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
    },
    "rtmp://127.0.0.1/live/master",
    "rtmp://example.com/live/key"
  );

  assert.equal(args.includes("avfoundation"), true);
  assert.equal(args.includes("-video_device_index"), true);
  assert.equal(args[args.indexOf("-video_device_index") + 1], "1");
  assert.equal(args.includes("crop=1280:720:100:200,scale=1280:720"), true);
  assert.equal(args.includes("1:a:0?"), true);
});

test("FFmpegService builds Linux projector x11grab args", () => {
  const { service } = buildService({ platform: "linux" });
  const args = service.buildArgs(
    {
      id: "d9",
      protocol: "rtmp",
      outputMode: "custom",
      videoSourceMode: "scene_projector_capture",
      sceneBinding: {
        sceneName: "Linux Scene",
        captureMethod: "linux_x11_window_id",
        projectorWindowTitle: "Windowed Projector (Scene) - Linux Scene",
        x11WindowId: "0x04600007",
        x11Display: ":0.0"
      },
      videoProfile: {
        videoCodec: "libx264",
        bitrateKbps: 2200,
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
    },
    "rtmp://127.0.0.1/live/master",
    "rtmp://example.com/live/key"
  );

  assert.equal(args.includes("x11grab"), true);
  assert.equal(args.includes("-window_id"), true);
  assert.equal(args[args.indexOf("-window_id") + 1], "0x04600007");
  assert.equal(args.includes(":0.0"), true);
  assert.equal(args.includes("1:a:0?"), true);
});

test("FFmpegService validates Windows projector capture target", () => {
  const { service } = buildService({
    platform: "win32",
    spawnSyncFn: () => ({
      status: 0,
      stdout: "",
      stderr: ""
    })
  });

  const result = service.validateSceneCaptureBinding({
    id: "d10",
    videoSourceMode: "scene_projector_capture",
    sceneBinding: {
      sceneName: "Program",
      captureMethod: "windows_window_title",
      projectorWindowTitle: "Windowed Projector (Scene) - Program"
    },
    videoProfile: {
      fps: 30
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.captureMethod, "windows_window_title");
});

test("FFmpegService reports macOS permission failures during scene capture validation", () => {
  const { service } = buildService({
    platform: "darwin",
    spawnSyncFn: () => ({
      status: 1,
      stdout: "",
      stderr: "avfoundation: permission denied"
    })
  });

  assert.throws(
    () =>
      service.validateSceneCaptureBinding({
        id: "d11",
        videoSourceMode: "scene_projector_capture",
        sceneBinding: {
          sceneName: "Program",
          captureMethod: "darwin_display_crop",
          captureDisplayIndex: 1,
          captureCropX: 0,
          captureCropY: 0,
          captureCropWidth: 1280,
          captureCropHeight: 720
        },
        videoProfile: {
          fps: 30
        }
      }),
    (error) => {
      assert.equal(error.code, "CAPTURE_VALIDATION_FAILED");
      assert.equal(
        error.details.includes("macos_screen_recording_permission_missing"),
        true
      );
      return true;
    }
  );
});

test("FFmpegService reports Wayland-only Linux sessions as unsupported for current projector capture path", () => {
  const previousDisplay = process.env.DISPLAY;
  const previousWaylandDisplay = process.env.WAYLAND_DISPLAY;
  delete process.env.DISPLAY;
  process.env.WAYLAND_DISPLAY = "wayland-0";

  try {
    const { service } = buildService({ platform: "linux" });
    const status = service.getSceneCapturePlatformStatus({
      videoSourceMode: "scene_projector_capture"
    });

    assert.equal(status.supported, false);
    assert.equal(
      status.reason,
      "wayland_not_supported_by_current_capture_path"
    );
  } finally {
    if (previousDisplay === undefined) {
      delete process.env.DISPLAY;
    } else {
      process.env.DISPLAY = previousDisplay;
    }
    if (previousWaylandDisplay === undefined) {
      delete process.env.WAYLAND_DISPLAY;
    } else {
      process.env.WAYLAND_DISPLAY = previousWaylandDisplay;
    }
  }
});

test("FFmpegService captures JPEG preview for Windows scene projector target", () => {
  const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const { service } = buildService({
    platform: "win32",
    spawnSyncFn: () => ({
      status: 0,
      stdout: jpegBuffer,
      stderr: ""
    })
  });

  const preview = service.captureSceneCapturePreview({
    id: "d12",
    videoSourceMode: "scene_projector_capture",
    sceneBinding: {
      sceneName: "Program",
      captureMethod: "windows_window_title",
      projectorWindowTitle: "Windowed Projector (Scene) - Program"
    },
    videoProfile: {
      fps: 30
    }
  });

  assert.equal(preview.contentType, "image/jpeg");
  assert.deepEqual(preview.buffer, jpegBuffer);
});
