const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DestinationStatus,
  transitionStatus
} = require("../src/domain/state-machine");

test("start transition from idle moves to connecting", () => {
  const next = transitionStatus(DestinationStatus.IDLE, "start");
  assert.equal(next, DestinationStatus.CONNECTING);
});

test("live transition from connecting moves to live", () => {
  const next = transitionStatus(DestinationStatus.CONNECTING, "live");
  assert.equal(next, DestinationStatus.LIVE);
});

test("invalid transition keeps current status", () => {
  const next = transitionStatus(DestinationStatus.IDLE, "live");
  assert.equal(next, DestinationStatus.IDLE);
});
