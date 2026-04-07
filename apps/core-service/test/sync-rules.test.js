const test = require("node:test");
const assert = require("node:assert/strict");
const {
  shouldStartForObsEvent,
  shouldStopForObsEvent
} = require("../src/domain/sync-rules");

test("start sync rule starts when OBS is active and flag is enabled", () => {
  const destination = {
    syncWithObsStart: true,
    enabled: true
  };
  assert.equal(shouldStartForObsEvent(destination, true), true);
});

test("stop sync rule stops when OBS is inactive and flag is enabled", () => {
  const destination = {
    syncWithObsStop: true,
    enabled: true
  };
  assert.equal(shouldStopForObsEvent(destination, false), true);
});

test("sync rules respect disabled destinations", () => {
  const destination = {
    syncWithObsStart: true,
    syncWithObsStop: true,
    enabled: false
  };
  assert.equal(shouldStartForObsEvent(destination, true), false);
  assert.equal(shouldStopForObsEvent(destination, false), false);
});
