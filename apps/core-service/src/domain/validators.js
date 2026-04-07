function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const DESTINATION_PROTOCOLS = new Set(["rtmp", "rtmps", "srt", "rist", "whip"]);
const OUTPUT_MODES = new Set(["inherit", "custom"]);
const VIDEO_SOURCE_MODES = new Set(["master_ingest", "scene_projector_capture"]);
const SCENE_CAPTURE_METHODS = new Set([
  "windows_window_title",
  "darwin_display_crop",
  "linux_x11_window_id"
]);
const VIDEO_CODECS = new Set([
  "copy",
  "libx264",
  "h264_amf",
  "h264_nvenc",
  "h264_qsv",
  "h264_videotoolbox",
  "h264_vaapi"
]);
const AUDIO_CODECS = new Set(["copy", "aac", "libopus"]);

function parseUrl(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  try {
    return new URL(value);
  } catch (_) {
    return null;
  }
}

function inferProtocolFromUrl(value) {
  const parsed = parseUrl(value);
  if (!parsed) {
    return null;
  }

  switch (parsed.protocol) {
    case "rtmp:":
      return "rtmp";
    case "rtmps:":
      return "rtmps";
    case "srt:":
      return "srt";
    case "rist:":
      return "rist";
    case "http:":
    case "https:":
      return "whip";
    default:
      return null;
  }
}

function isSupportedDestinationProtocol(value) {
  return DESTINATION_PROTOCOLS.has(value);
}

function requiresStreamKey(protocol) {
  return protocol === "rtmp" || protocol === "rtmps";
}

function isDestinationUrl(value, protocol) {
  const parsed = parseUrl(value);
  if (!parsed || !isSupportedDestinationProtocol(protocol)) {
    return false;
  }

  switch (protocol) {
    case "rtmp":
      return parsed.protocol === "rtmp:";
    case "rtmps":
      return parsed.protocol === "rtmps:";
    case "srt":
      return parsed.protocol === "srt:";
    case "rist":
      return parsed.protocol === "rist:";
    case "whip":
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    default:
      return false;
  }
}

function isRtmpUrl(value) {
  const protocol = inferProtocolFromUrl(value);
  return protocol === "rtmp" || protocol === "rtmps";
}

function validateNumberRange(errors, value, field, min, max) {
  if (value === undefined || value === null) {
    return;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    errors.push(`\`${field}\` must be a number between ${min} and ${max}.`);
  }
}

function assertProfilePayload(payload, errors) {
  if (payload.outputMode !== "custom") {
    return;
  }

  if (!isObject(payload.videoProfile)) {
    errors.push("`videoProfile` must be an object when `outputMode` is `custom`.");
    return;
  }
  if (!isObject(payload.audioProfile)) {
    errors.push("`audioProfile` must be an object when `outputMode` is `custom`.");
    return;
  }

  if (!VIDEO_CODECS.has(payload.videoProfile.videoCodec)) {
    errors.push(
      "`videoProfile.videoCodec` must be one of: copy, libx264, h264_amf, h264_nvenc, h264_qsv, h264_videotoolbox, h264_vaapi."
    );
  }
  if (!AUDIO_CODECS.has(payload.audioProfile.audioCodec)) {
    errors.push("`audioProfile.audioCodec` must be one of: copy, aac, libopus.");
  }

  validateNumberRange(errors, payload.videoProfile.bitrateKbps, "videoProfile.bitrateKbps", 0, 50000);
  validateNumberRange(
    errors,
    payload.audioProfile.audioBitrateKbps,
    "audioProfile.audioBitrateKbps",
    0,
    1024
  );
  validateNumberRange(
    errors,
    payload.audioProfile.inputTrackIndex,
    "audioProfile.inputTrackIndex",
    0,
    7
  );
  validateNumberRange(
    errors,
    payload.audioProfile.vodTrackInputIndex,
    "audioProfile.vodTrackInputIndex",
    0,
    7
  );
  validateNumberRange(errors, payload.videoProfile.fps, "videoProfile.fps", 1, 240);
  validateNumberRange(
    errors,
    payload.videoProfile.fpsDenominator,
    "videoProfile.fpsDenominator",
    1,
    4
  );
  validateNumberRange(errors, payload.videoProfile.width, "videoProfile.width", 16, 7680);
  validateNumberRange(errors, payload.videoProfile.height, "videoProfile.height", 16, 4320);
  validateNumberRange(errors, payload.videoProfile.gopSec, "videoProfile.gopSec", 0, 10);
  validateNumberRange(errors, payload.videoProfile.bFrames, "videoProfile.bFrames", 0, 16);

  if (
    payload.videoProfile.preset !== undefined &&
    payload.videoProfile.preset !== null &&
    !isNonEmptyString(payload.videoProfile.preset)
  ) {
    errors.push("`videoProfile.preset` must be a non-empty string when provided.");
  }
}

function assertSceneBindingPayload(payload, errors) {
  const sourceMode = payload.videoSourceMode || "master_ingest";
  if (sourceMode !== "scene_projector_capture") {
    return;
  }

  const binding = payload.sceneBinding;
  if (!isObject(binding)) {
    errors.push(
      "`sceneBinding` must be an object when `videoSourceMode` is `scene_projector_capture`."
    );
    return;
  }

  if (!isNonEmptyString(binding.sceneName)) {
    errors.push(
      "`sceneBinding.sceneName` must be a non-empty string when `videoSourceMode` is `scene_projector_capture`."
    );
  }

  if (!SCENE_CAPTURE_METHODS.has(binding.captureMethod)) {
    errors.push(
      "`sceneBinding.captureMethod` must be one of: windows_window_title."
    );
  }

  if (binding.captureMethod === "windows_window_title") {
    if (
      binding.projectorWindowTitle !== undefined &&
      binding.projectorWindowTitle !== null &&
      typeof binding.projectorWindowTitle !== "string"
    ) {
      errors.push(
        "`sceneBinding.projectorWindowTitle` must be a string for `windows_window_title` capture."
      );
    }
  }

  if (binding.captureMethod === "darwin_display_crop") {
    validateNumberRange(
      errors,
      binding.captureDisplayIndex,
      "sceneBinding.captureDisplayIndex",
      0,
      64
    );
    validateNumberRange(
      errors,
      binding.captureCropX,
      "sceneBinding.captureCropX",
      0,
      16384
    );
    validateNumberRange(
      errors,
      binding.captureCropY,
      "sceneBinding.captureCropY",
      0,
      16384
    );
    validateNumberRange(
      errors,
      binding.captureCropWidth,
      "sceneBinding.captureCropWidth",
      1,
      16384
    );
    validateNumberRange(
      errors,
      binding.captureCropHeight,
      "sceneBinding.captureCropHeight",
      1,
      16384
    );
  }

  if (binding.captureMethod === "linux_x11_window_id") {
    if (
      binding.x11WindowId !== undefined &&
      binding.x11WindowId !== null &&
      typeof binding.x11WindowId !== "string"
    ) {
      errors.push(
        "`sceneBinding.x11WindowId` must be a string for `linux_x11_window_id` capture."
      );
    }
    if (
      binding.x11Display !== undefined &&
      binding.x11Display !== null &&
      typeof binding.x11Display !== "string"
    ) {
      errors.push(
        "`sceneBinding.x11Display` must be a string when provided for `linux_x11_window_id` capture."
      );
    }
  }
}

function assertDestinationPayload(payload, options = {}) {
  const errors = [];
  const isPatch = Boolean(options.isPatch);
  const current = options.current || {};
  const effectiveProtocol =
    payload.protocol !== undefined
      ? payload.protocol
      : current.protocol || inferProtocolFromUrl(payload.serverUrl || current.serverUrl);
  const effectiveStreamKey =
    payload.streamKey !== undefined ? payload.streamKey : current.streamKey;
  const effectiveOutputMode =
    payload.outputMode !== undefined ? payload.outputMode : current.outputMode;
  const effectiveVideoProfile =
    payload.videoProfile !== undefined ? payload.videoProfile : current.videoProfile;
  const effectiveAudioProfile =
    payload.audioProfile !== undefined ? payload.audioProfile : current.audioProfile;
  const effectiveVideoSourceMode =
    payload.videoSourceMode !== undefined
      ? payload.videoSourceMode
      : current.videoSourceMode || "master_ingest";
  const effectiveSceneBinding =
    payload.sceneBinding !== undefined ? payload.sceneBinding : current.sceneBinding;

  if (!isPatch || payload.name !== undefined) {
    if (!isNonEmptyString(payload.name)) {
      errors.push("`name` must be a non-empty string.");
    }
  }

  if (!isPatch || payload.protocol !== undefined || current.protocol === undefined) {
    if (!isSupportedDestinationProtocol(effectiveProtocol)) {
      errors.push("`protocol` must be one of: rtmp, rtmps, srt, rist, whip.");
    }
  }

  if (!isPatch || payload.serverUrl !== undefined) {
    if (!isDestinationUrl(payload.serverUrl, effectiveProtocol)) {
      errors.push(
        "`serverUrl` must match the selected protocol: rtmp://, rtmps://, srt://, rist:// or http(s):// for whip."
      );
    }
  }

  if (requiresStreamKey(effectiveProtocol)) {
    if (!isNonEmptyString(effectiveStreamKey)) {
      errors.push("`streamKey` must be a non-empty string for RTMP/RTMPS destinations.");
    }
  } else if (
    payload.streamKey !== undefined &&
    payload.streamKey !== null &&
    typeof payload.streamKey !== "string"
  ) {
    errors.push("`streamKey` must be a string when provided.");
  }

  if (payload.bitrateKbps !== undefined) {
    const number = Number(payload.bitrateKbps);
    if (!Number.isFinite(number) || number < 0 || number > 50000) {
      errors.push("`bitrateKbps` must be a number between 0 and 50000.");
    }
  }

  if (
    payload.syncWithObsStart !== undefined &&
    typeof payload.syncWithObsStart !== "boolean"
  ) {
    errors.push("`syncWithObsStart` must be a boolean.");
  }

  if (
    payload.syncWithObsStop !== undefined &&
    typeof payload.syncWithObsStop !== "boolean"
  ) {
    errors.push("`syncWithObsStop` must be a boolean.");
  }

  if (!isPatch || payload.outputMode !== undefined) {
    if (!OUTPUT_MODES.has(payload.outputMode)) {
      errors.push("`outputMode` must be `inherit` or `custom`.");
    }
  }

  if (!isPatch || payload.videoSourceMode !== undefined || current.videoSourceMode === undefined) {
    if (!VIDEO_SOURCE_MODES.has(effectiveVideoSourceMode)) {
      errors.push(
        "`videoSourceMode` must be `master_ingest` or `scene_projector_capture`."
      );
    }
  }

  assertProfilePayload(
    {
      outputMode: effectiveOutputMode,
      videoProfile: effectiveVideoProfile,
      audioProfile: effectiveAudioProfile
    },
    errors
  );
  assertSceneBindingPayload(
    {
      videoSourceMode: effectiveVideoSourceMode,
      sceneBinding: effectiveSceneBinding
    },
    errors
  );

  return errors;
}

module.exports = {
  DESTINATION_PROTOCOLS,
  isDestinationUrl,
  isRtmpUrl,
  inferProtocolFromUrl,
  isSupportedDestinationProtocol,
  requiresStreamKey,
  assertDestinationPayload,
  OUTPUT_MODES,
  VIDEO_SOURCE_MODES,
  SCENE_CAPTURE_METHODS,
  VIDEO_CODECS,
  AUDIO_CODECS
};
