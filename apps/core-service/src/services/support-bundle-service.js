const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const crypto = require("crypto");

const INCIDENT_TYPES = new Set([
  "destination.error",
  "destination.reconnecting",
  "engine.watchdog_timeout",
  "obs.connection_error",
  "engine.retrying"
]);

function extractIncidentEvents(recentEvents) {
  const list = Array.isArray(recentEvents) ? recentEvents : [];
  return list.filter((event) => event && INCIDENT_TYPES.has(event.type));
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function createSupportBundleZip(options) {
  const diagnostics = options.diagnostics || {};
  const recentEvents = diagnostics.metrics ? diagnostics.metrics.recentEvents : [];
  const incidents = extractIncidentEvents(recentEvents);
  const logLines = options.logLines || [];

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "laive-support-bundle-"));
  const payloadDir = path.join(tempRoot, "payload");
  const zipPath = path.join(
    tempRoot,
    `laive-support-bundle-${Date.now().toString()}.zip`
  );

  try {
    fs.mkdirSync(payloadDir, { recursive: true });

    const metadata = {
      exportedAt: new Date().toISOString(),
      app: options.appName,
      version: options.version,
      logLineCount: logLines.length,
      incidentCount: incidents.length
    };

    fs.writeFileSync(
      path.join(payloadDir, "metadata.json"),
      JSON.stringify(metadata, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(payloadDir, "diagnostics.json"),
      JSON.stringify(diagnostics, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(payloadDir, "incidents.json"),
      JSON.stringify({ incidents }, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(payloadDir, "logs.ndjson"),
      logLines.join("\n") + (logLines.length ? "\n" : ""),
      "utf8"
    );

    const payloadFiles = [
      "metadata.json",
      "diagnostics.json",
      "incidents.json",
      "logs.ndjson"
    ];
    const checksums = {};
    payloadFiles.forEach((fileName) => {
      checksums[fileName] = sha256File(path.join(payloadDir, fileName));
    });
    fs.writeFileSync(
      path.join(payloadDir, "checksums.json"),
      JSON.stringify({ checksums }, null, 2),
      "utf8"
    );

    const zipResult = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Compress-Archive -Path (Join-Path $env:LAIVE_SUPPORT_PAYLOAD_DIR '*') -DestinationPath $env:LAIVE_SUPPORT_ZIP_PATH -Force"
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          LAIVE_SUPPORT_PAYLOAD_DIR: payloadDir,
          LAIVE_SUPPORT_ZIP_PATH: zipPath
        }
      }
    );

    if (zipResult.status !== 0 || !fs.existsSync(zipPath)) {
      const stderr = zipResult.stderr || "failed to create support bundle zip";
      throw new Error(stderr.trim());
    }

    const bundleBuffer = fs.readFileSync(zipPath);
    const bundleSha256 = sha256Buffer(bundleBuffer);

    return {
      fileName: `laive-support-bundle-${Date.now().toString()}.zip`,
      contentType: "application/zip",
      sha256: bundleSha256,
      buffer: bundleBuffer
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

module.exports = {
  createSupportBundleZip,
  extractIncidentEvents,
  sha256Buffer
};
