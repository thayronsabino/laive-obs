const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function commandExists(command) {
  const result = spawnSync(command, ["-version"], {
    encoding: "utf8"
  });
  return !result.error && result.status === 0;
}

function findFirstFile(rootDir, fileName, maxDepth = 5) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return null;
  }

  const queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
        return fullPath;
      }
      if (entry.isDirectory() && current.depth < maxDepth) {
        queue.push({ dir: fullPath, depth: current.depth + 1 });
      }
    }
  }

  return null;
}

function resolveFfmpegBin() {
  if (process.env.FFMPEG_BIN && fs.existsSync(process.env.FFMPEG_BIN)) {
    return process.env.FFMPEG_BIN;
  }

  if (commandExists("ffmpeg")) {
    return "ffmpeg";
  }

  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const wingetPackages = path.join(localAppData, "Microsoft", "WinGet", "Packages");
  const wingetMatch = findFirstFile(wingetPackages, "ffmpeg.exe", 6);
  if (wingetMatch) {
    return wingetMatch;
  }

  const commonCandidates = [
    path.join("C:\\", "ProgramData", "chocolatey", "bin", "ffmpeg.exe"),
    path.join(os.homedir(), "scoop", "apps", "ffmpeg", "current", "bin", "ffmpeg.exe")
  ];

  for (const candidate of commonCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveSiblingBinary(binPath, binaryName) {
  if (!binPath || typeof binPath !== "string") {
    return null;
  }

  if (path.basename(binPath).toLowerCase() === "ffmpeg.exe") {
    const candidate = path.join(path.dirname(binPath), `${binaryName}.exe`);
    return fs.existsSync(candidate) ? candidate : null;
  }

  if (path.basename(binPath).toLowerCase() === "ffmpeg") {
    const candidate = path.join(path.dirname(binPath), binaryName);
    return fs.existsSync(candidate) ? candidate : null;
  }

  return null;
}

function resolveFfprobeBin() {
  if (process.env.FFPROBE_BIN && fs.existsSync(process.env.FFPROBE_BIN)) {
    return process.env.FFPROBE_BIN;
  }

  const ffmpegFromEnv = process.env.FFMPEG_BIN;
  const siblingFromEnv = resolveSiblingBinary(ffmpegFromEnv, "ffprobe");
  if (siblingFromEnv) {
    return siblingFromEnv;
  }

  if (commandExists("ffprobe")) {
    return "ffprobe";
  }

  const ffmpegBin = resolveFfmpegBin();
  const siblingProbe = resolveSiblingBinary(ffmpegBin, "ffprobe");
  if (siblingProbe) {
    return siblingProbe;
  }

  return null;
}

module.exports = {
  resolveFfmpegBin,
  resolveFfprobeBin
};
