const os = require("os");
const path = require("path");
const {
  resolveFfmpegBin,
  resolveFfprobeBin
} = require("../../../shared/ffmpeg-resolver");

const userDataBase =
  process.env.APPDATA || path.join(os.homedir(), ".config");

const rootDir = path.resolve(__dirname, "..", "..", "..");

const resolvedFfmpegBin = resolveFfmpegBin() || "ffmpeg";
const resolvedFfprobeBin = resolveFfprobeBin() || "ffprobe";
const trueLike = new Set(["1", "true", "yes", "on"]);

function parseNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parseCsvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  appName: "LAIVE OBS",
  version: "0.1.0-alpha",
  apiPort: Number(process.env.LAIVE_API_PORT || 4800),
  apiBindAddress: process.env.LAIVE_API_BIND_ADDRESS || "127.0.0.1",
  wsPath: process.env.LAIVE_WS_PATH || "/events",
  dataDir:
    process.env.LAIVE_DATA_DIR || path.join(userDataBase, "laive-obs", "data"),
  dataFile:
    process.env.LAIVE_DATA_FILE ||
    path.join(userDataBase, "laive-obs", "data", "state.json"),
  logDir:
    process.env.LAIVE_LOG_DIR ||
    path.join(userDataBase, "laive-obs", "data", "logs"),
  logLevel: process.env.LAIVE_LOG_LEVEL || "info",
  dashboardPublicDir: path.join(rootDir, "apps", "dashboard", "public"),
  ffmpegBin: process.env.FFMPEG_BIN || resolvedFfmpegBin,
  ffprobeBin: process.env.FFPROBE_BIN || resolvedFfprobeBin,
  rtmpPort: Number(process.env.LAIVE_RTMP_PORT || 1935),
  rtmpApp: process.env.LAIVE_RTMP_APP || "live",
  rtmpStreamKey: process.env.LAIVE_RTMP_STREAM_KEY || "master",
  obsWsUrl: process.env.OBS_WS_URL || "ws://127.0.0.1:4455",
  obsWsPassword: process.env.OBS_WS_PASSWORD || "",
  obsReconnectMs: Number(process.env.OBS_RECONNECT_MS || 5000),
  ffmpegMaxRetries: Number(process.env.LAIVE_FFMPEG_MAX_RETRIES || 3),
  ffmpegRetryBaseMs: Number(process.env.LAIVE_FFMPEG_RETRY_BASE_MS || 1000),
  ffmpegRetryMaxMs: Number(process.env.LAIVE_FFMPEG_RETRY_MAX_MS || 8000),
  ffmpegRetryJitterRatio: Number(
    process.env.LAIVE_FFMPEG_RETRY_JITTER_RATIO || 0.25
  ),
  ffmpegConnectTimeoutMs: Number(
    process.env.LAIVE_FFMPEG_CONNECT_TIMEOUT_MS || 15000
  ),
  ffmpegStopGraceMs: Number(process.env.LAIVE_FFMPEG_STOP_GRACE_MS || 5000),
  ffmpegStallTimeoutMs: Number(
    process.env.LAIVE_FFMPEG_STALL_TIMEOUT_MS || 45000
  ),
  ffmpegStallMonitorIntervalMs: Number(
    process.env.LAIVE_FFMPEG_STALL_MONITOR_INTERVAL_MS || 5000
  ),
  sessionTtlSec: Number(process.env.LAIVE_SESSION_TTL_SEC || 1800),
  logMaxBytes: Number(process.env.LAIVE_LOG_MAX_BYTES || 5 * 1024 * 1024),
  logMaxFiles: Number(process.env.LAIVE_LOG_MAX_FILES || 5),
  secureCookies: trueLike.has(
    String(process.env.LAIVE_SECURE_COOKIES || "")
      .trim()
      .toLowerCase()
  ),
  authRateLimitMax: parseNonNegativeInteger(
    process.env.LAIVE_AUTH_RATE_LIMIT_MAX,
    20
  ),
  authRateLimitWindowMs: parseNonNegativeInteger(
    process.env.LAIVE_AUTH_RATE_LIMIT_WINDOW_MS,
    60000
  ),
  wsAllowedOrigins: parseCsvList(process.env.LAIVE_WS_ALLOWED_ORIGINS),
  obsEnabled: process.env.LAIVE_OBS_ENABLED !== "0",
  ingestEnabled: process.env.LAIVE_INGEST_ENABLED !== "0"
};
