const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { LoggerService } = require("../src/services/logger-service");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "laive-logger-test-"));
}

test("logger rotates files and preserves recent entries across archives", async () => {
  const tempDir = makeTempDir();
  const logger = new LoggerService({
    logDir: tempDir,
    level: "info",
    maxBytes: 600,
    maxFiles: 3,
    silent: true
  });
  logger.init();

  for (let index = 0; index < 80; index += 1) {
    logger.info("rotation.test", {
      index,
      payload: "x".repeat(30)
    });
  }
  await logger.close();

  const logFiles = logger.getAllLogFilePaths();
  assert.equal(logFiles.length >= 2, true);
  assert.equal(logFiles.length <= 4, true);

  const recentEntries = logger.getRecentEntries(20);
  assert.equal(recentEntries.length > 0, true);
  assert.equal(
    recentEntries.some((entry) => entry.message === "rotation.test"),
    true
  );
});
