const { spawnSync } = require("child_process");
const { resolveFfmpegBin } = require("../../shared/ffmpeg-resolver");

const bin = process.env.FFMPEG_BIN || resolveFfmpegBin() || "ffmpeg";
const result = spawnSync(bin, ["-version"], {
  encoding: "utf8"
});

if (result.error) {
  console.error(`[ffmpeg] not found: ${bin}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`[ffmpeg] command failed with status ${result.status}`);
  process.exit(result.status);
}

const firstLine = (result.stdout || "").split("\n")[0] || "ffmpeg detected";
console.log(`[ffmpeg] ${firstLine}`);
console.log(`[ffmpeg] binary: ${bin}`);
