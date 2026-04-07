#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

function walkFiles(rootDir) {
  const files = [];
  const pending = [rootDir];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      files.push(fullPath);
    }
  }
  return files;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function parseChecksumManifest(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const map = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (!match) {
      throw new Error(`Invalid checksum line in '${filePath}': ${line}`);
    }
    map.set(match[2].trim(), match[1].toLowerCase());
  }
  return map;
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const args = parseArgs(process.argv.slice(2));
const assetsDir = args["assets-dir"];
const channel = args.channel;
const tag = args.tag || "unknown";
const summaryPath = args["summary-path"] || "promotion-gate-summary.json";

if (!assetsDir) {
  throw new Error("--assets-dir is required.");
}
if (!channel) {
  throw new Error("--channel is required.");
}
if (!["alpha", "beta", "stable"].includes(channel)) {
  throw new Error(`Invalid --channel '${channel}'. Use alpha|beta|stable.`);
}

const resolvedAssetsDir = path.resolve(assetsDir);
assertCondition(
  fs.existsSync(resolvedAssetsDir),
  `Assets directory not found: ${resolvedAssetsDir}`
);

const allFiles = walkFiles(resolvedAssetsDir);
const relativeFiles = allFiles.map((filePath) =>
  path.relative(resolvedAssetsDir, filePath).replaceAll("\\", "/")
);
const byRelative = new Map();
const byBasename = new Map();
for (let index = 0; index < allFiles.length; index += 1) {
  const abs = allFiles[index];
  const rel = relativeFiles[index];
  byRelative.set(rel, abs);
  const base = path.basename(abs);
  if (!byBasename.has(base)) {
    byBasename.set(base, []);
  }
  byBasename.get(base).push(abs);
}

function pickAsset(candidates, required = true) {
  for (const candidate of candidates) {
    if (byRelative.has(candidate)) {
      return byRelative.get(candidate);
    }
  }
  for (const candidate of candidates) {
    const base = path.basename(candidate);
    const matches = byBasename.get(base) || [];
    if (matches.length === 1) {
      return matches[0];
    }
  }
  if (!required) {
    return null;
  }
  throw new Error(
    `Required asset not found for candidates: ${candidates.join(", ")}`
  );
}

const windowsZip = pickAsset(["laive-obs-windows-alpha.zip"]);
const windowsExe = pickAsset(["laive-obs-windows-alpha-installer.exe"]);
const windowsMsi = pickAsset(["laive-obs-windows-alpha-installer.msi"]);
const windowsChecksums = pickAsset([
  "windows-alpha-checksums.sha256",
  "checksums.sha256"
]);
const windowsInstallerMetadata = pickAsset(
  ["windows-alpha-installer-metadata.json", "installer-metadata.json"],
  channel === "stable"
);
const windowsMsiMetadata = pickAsset(
  ["windows-alpha-msi-metadata.json", "msi-metadata.json"],
  channel === "stable"
);

const macosDmg = pickAsset(["laive-obs-macos-alpha.dmg"]);
const macosChecksums = pickAsset([
  "macos-alpha-checksums.sha256",
  "checksums.sha256"
]);
const macosNotaryMetadata = pickAsset(
  ["macos-alpha-notarization-metadata.json", "macos-notarization-metadata.json"],
  channel === "stable"
);

const linuxDeb = pickAsset(["laive-obs-linux-alpha.deb"]);
const linuxAppImage = pickAsset(["laive-obs-linux-alpha.AppImage"]);
const linuxChecksums = pickAsset([
  "linux-alpha-checksums.sha256",
  "checksums.sha256"
]);
const parityGateSummary = pickAsset(["parity-release-gate-summary.json"]);

const manifestChecks = [];
function verifyManifest(manifestPath, expectedFiles) {
  const manifest = parseChecksumManifest(manifestPath);
  const result = {
    manifest: path.basename(manifestPath),
    checkedFiles: []
  };
  for (const filePath of expectedFiles) {
    const base = path.basename(filePath);
    assertCondition(
      manifest.has(base),
      `Checksum manifest '${manifestPath}' does not include '${base}'.`
    );
    const expectedHash = manifest.get(base);
    const actualHash = sha256(filePath);
    assertCondition(
      expectedHash === actualHash,
      `Checksum mismatch for '${base}'. Expected '${expectedHash}', got '${actualHash}'.`
    );
    result.checkedFiles.push({
      file: base,
      sha256: actualHash
    });
  }
  manifestChecks.push(result);
}

verifyManifest(windowsChecksums, [windowsZip, windowsExe, windowsMsi]);
verifyManifest(macosChecksums, [macosDmg]);
verifyManifest(linuxChecksums, [linuxDeb, linuxAppImage]);

const metadataChecks = {
  windowsInstallerSignature: "not-evaluated",
  windowsMsiSignature: "not-evaluated",
  macosNotarization: "not-evaluated",
  parityReleaseGate: "not-evaluated"
};

if (parityGateSummary) {
  const summary = readJson(parityGateSummary);
  const passed = Boolean(summary?.passed);
  metadataChecks.parityReleaseGate = passed ? "passed" : "failed";
  assertCondition(
    passed,
    "Release promotion requires a successful parity-release-gate summary asset."
  );
  if (channel === "stable") {
    assertCondition(
      summary?.parityMatrixStatus === "closed",
      "Stable promotion requires parityMatrixStatus='closed' in parity-release-gate summary."
    );
    const matrixStates = summary?.matrixStates || {};
    assertCondition(
      Number(matrixStates.partial || 0) === 0 &&
        Number(matrixStates.missing || 0) === 0,
      "Stable promotion requires zero 'Parcial' and zero 'Faltando' parity matrix entries."
    );
  }
}

if (windowsInstallerMetadata) {
  const metadata = readJson(windowsInstallerMetadata);
  const status = metadata?.authenticode?.status || "unknown";
  metadataChecks.windowsInstallerSignature = status;
  if (channel === "stable") {
    assertCondition(
      status === "Valid",
      `Stable promotion requires signed Windows installer. Current status: '${status}'.`
    );
  }
}

if (windowsMsiMetadata) {
  const metadata = readJson(windowsMsiMetadata);
  const status = metadata?.authenticode?.status || "unknown";
  metadataChecks.windowsMsiSignature = status;
  if (channel === "stable") {
    assertCondition(
      status === "Valid",
      `Stable promotion requires signed Windows MSI. Current status: '${status}'.`
    );
  }
}

if (macosNotaryMetadata) {
  const metadata = readJson(macosNotaryMetadata);
  const notarized = Boolean(metadata?.notarized);
  const stapled = Boolean(metadata?.stapled);
  metadataChecks.macosNotarization = notarized && stapled ? "notarized" : "not-notarized";
  if (channel === "stable") {
    assertCondition(
      notarized && stapled,
      "Stable promotion requires notarized and stapled macOS artifact."
    );
  }
}

const summary = {
  generatedAtUtc: new Date().toISOString(),
  tag,
  channel,
  assetsDirectory: resolvedAssetsDir,
  assetCount: allFiles.length,
  manifests: manifestChecks,
  metadataChecks
};

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
console.log(`[promotion-gates] OK. Summary: ${path.resolve(summaryPath)}`);
