#!/usr/bin/env node

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

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function detectChannelFromTag(tag) {
  const normalized = String(tag || "").toLowerCase();
  if (normalized.includes("alpha")) {
    return "alpha";
  }
  if (normalized.includes("beta") || normalized.includes("rc")) {
    return "beta";
  }
  return "stable";
}

function countMatrixStates(content) {
  const lines = String(content || "").split(/\r?\n/);
  let partial = 0;
  let missing = 0;
  for (const line of lines) {
    if (!line.includes("|")) {
      continue;
    }
    if (/\|\s*Parcial\s*\|/i.test(line)) {
      partial += 1;
    }
    if (/\|\s*Faltando\s*\|/i.test(line)) {
      missing += 1;
    }
  }
  return {
    partial,
    missing
  };
}

const args = parseArgs(process.argv.slice(2));
const tag = args.tag;
const checklistPath = path.resolve(
  args["checklist-path"] || "docs/RELEASE_PARITY_CHECKLIST.json"
);
const matrixPath = path.resolve(
  args["matrix-path"] || "docs/PARIDADE_OBS_MULTI_RTMP.md"
);
const summaryPath = path.resolve(
  args["summary-path"] || "parity-release-gate-summary.json"
);

assertCondition(tag, "--tag is required.");
assertCondition(
  fs.existsSync(checklistPath),
  `Checklist file not found: ${checklistPath}`
);
assertCondition(
  fs.existsSync(matrixPath),
  `Parity matrix file not found: ${matrixPath}`
);

const channel = detectChannelFromTag(tag);
const checklistPayload = readJson(checklistPath);
const matrixContent = fs.readFileSync(matrixPath, "utf8");
const matrixStates = countMatrixStates(matrixContent);

assertCondition(
  checklistPayload.releaseTag === tag,
  `Release checklist tag mismatch. Expected '${tag}', found '${checklistPayload.releaseTag || ""}'.`
);
assertCondition(
  typeof checklistPayload.approvedBy === "string" &&
    checklistPayload.approvedBy.trim(),
  "Release checklist requires a non-empty approvedBy."
);
assertCondition(
  typeof checklistPayload.approvedAtUtc === "string" &&
    !Number.isNaN(Date.parse(checklistPayload.approvedAtUtc)),
  "Release checklist requires a valid approvedAtUtc timestamp."
);

const checklist = checklistPayload.checklist || {};
const requiredKeys = [
  "productApproval",
  "qaApproval",
  "packagingSmokeVerified",
  "securityReviewAcknowledged",
  "parityMatrixReviewed",
  "ciArtifactsReviewed",
  "knownGapsAcceptedForChannel"
];

for (const key of requiredKeys) {
  assertCondition(
    checklist[key] === true,
    `Release checklist item '${key}' must be true.`
  );
}

const parityMatrixStatus = String(
  checklistPayload.parityMatrixStatus || "in-progress"
).trim();
assertCondition(
  ["in-progress", "closed"].includes(parityMatrixStatus),
  "parityMatrixStatus must be 'in-progress' or 'closed'."
);

if (channel === "stable") {
  assertCondition(
    parityMatrixStatus === "closed",
    "Stable release requires parityMatrixStatus='closed'."
  );
  assertCondition(
    matrixStates.partial === 0 && matrixStates.missing === 0,
    `Stable release requires no 'Parcial' or 'Faltando' items in the parity matrix. Found parcial=${matrixStates.partial}, faltando=${matrixStates.missing}.`
  );
}

const summary = {
  generatedAtUtc: new Date().toISOString(),
  tag,
  channel,
  passed: true,
  checklistPath,
  matrixPath,
  approvedBy: checklistPayload.approvedBy,
  approvedAtUtc: checklistPayload.approvedAtUtc,
  parityMatrixStatus,
  matrixStates,
  checklist
};

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
console.log(`[parity-release-gate] OK. Summary: ${summaryPath}`);
