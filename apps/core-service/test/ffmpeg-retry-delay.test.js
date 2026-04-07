const test = require("node:test");
const assert = require("node:assert/strict");
const { computeRetryDelay } = require("../src/services/ffmpeg-service");

test("computeRetryDelay stays within configured bounds", () => {
  const base = 1000;
  const max = 8000;
  const jitter = 0.25;

  for (let retry = 1; retry <= 8; retry += 1) {
    const value = computeRetryDelay(retry, base, max, jitter);
    assert.equal(value >= base, true);
    assert.equal(value <= max, true);
  }
});

test("computeRetryDelay reaches cap for large retries", () => {
  const value = computeRetryDelay(12, 1000, 8000, 0.25);
  assert.equal(value <= 8000, true);
});
