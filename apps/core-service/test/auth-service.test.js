const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PersistenceService } = require("../src/services/persistence-service");
const { DestinationService } = require("../src/services/destination-service");
const { AuthService } = require("../src/services/auth-service");

function createAuthFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "laive-auth-test-"));
  const dataDir = path.join(tempDir, "data");
  const dataFile = path.join(dataDir, "state.json");
  const persistenceService = new PersistenceService({ dataDir, dataFile });
  const destinationService = new DestinationService(persistenceService);
  const events = [];
  const authService = new AuthService({
    persistenceService,
    destinationService,
    eventBus: {
      publish: (type, payload) => events.push({ type, payload })
    },
    sessionTtlSec: 300
  });

  return { authService, destinationService, events };
}

test("AuthService bootstraps user and supports login/session lifecycle", () => {
  const { authService } = createAuthFixture();
  const statusBefore = authService.getStatus();
  assert.equal(statusBefore.configured, false);

  const bootstrap = authService.bootstrap({
    username: "admin",
    password: "strong-password-123"
  });
  assert.equal(bootstrap.ok, true);

  const login = authService.login({
    username: "admin",
    password: "strong-password-123"
  });
  assert.equal(login.ok, true);
  assert.equal(typeof login.token, "string");

  const statusAfter = authService.getStatus({ sessionToken: login.token });
  assert.equal(statusAfter.configured, true);
  assert.equal(statusAfter.authenticated, true);

  const refreshed = authService.refreshSession(login.token);
  assert.equal(Boolean(refreshed), true);

  const loggedOut = authService.logout(login.token);
  assert.equal(loggedOut, true);
  const statusAfterLogout = authService.getStatus({ sessionToken: login.token });
  assert.equal(statusAfterLogout.authenticated, false);
});

test("AuthService rejects bootstrap when already configured", () => {
  const { authService } = createAuthFixture();
  const first = authService.bootstrap({
    username: "admin",
    password: "strong-password-123"
  });
  const second = authService.bootstrap({
    username: "admin2",
    password: "strong-password-123"
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "already-configured");
});
