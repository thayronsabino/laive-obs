const crypto = require("crypto");

function derivePasswordHash(password, salt) {
  return crypto
    .scryptSync(password, salt, 64)
    .toString("base64");
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

class AuthService {
  constructor(options) {
    this.persistenceService = options.persistenceService;
    this.destinationService = options.destinationService;
    this.eventBus = options.eventBus;
    this.sessionTtlSec = Math.max(300, Number(options.sessionTtlSec || 1800));
    this.sessions = new Map();
  }

  getStatus({ sessionToken } = {}) {
    const authState = this.destinationService.state.auth || {};
    const session = sessionToken ? this.validateSession(sessionToken) : null;
    return {
      configured: Boolean(authState.configured),
      authenticated: Boolean(session),
      username: authState.username || null,
      sessionExpiresAt: session ? session.expiresAt : null
    };
  }

  bootstrap({ username, password }) {
    const authState = this.destinationService.state.auth || {};
    if (authState.configured) {
      return { ok: false, reason: "already-configured" };
    }

    if (
      typeof username !== "string" ||
      username.trim().length < 3 ||
      typeof password !== "string" ||
      password.length < 8
    ) {
      return { ok: false, reason: "invalid-credentials" };
    }

    const normalizedUsername = username.trim();
    const salt = crypto.randomBytes(16).toString("base64");
    const passwordHash = derivePasswordHash(password, salt);
    this.destinationService.state.auth = {
      configured: true,
      username: normalizedUsername,
      passwordHash,
      passwordSalt: salt,
      passwordChangedAt: new Date().toISOString()
    };
    this.destinationService.flush();

    return { ok: true };
  }

  login({ username, password }) {
    const authState = this.destinationService.state.auth || {};
    if (!authState.configured) {
      return { ok: false, reason: "not-configured" };
    }

    const usernameOk = timingSafeEqualString(
      authState.username || "",
      String(username || "").trim()
    );
    const providedHash = derivePasswordHash(
      String(password || ""),
      authState.passwordSalt
    );
    const passwordOk = timingSafeEqualString(
      authState.passwordHash || "",
      providedHash
    );
    if (!usernameOk || !passwordOk) {
      return { ok: false, reason: "invalid-credentials" };
    }

    const token = crypto.randomUUID();
    const expiresAt = Date.now() + this.sessionTtlSec * 1000;
    this.sessions.set(token, {
      token,
      username: authState.username,
      expiresAt
    });
    return {
      ok: true,
      token,
      expiresAt: new Date(expiresAt).toISOString()
    };
  }

  logout(token) {
    if (!token) {
      return false;
    }
    return this.sessions.delete(token);
  }

  validateSession(token) {
    if (!token) {
      return null;
    }
    const session = this.sessions.get(token);
    if (!session) {
      return null;
    }
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      this.eventBus.publish("auth.session_expired", {
        username: session.username
      });
      return null;
    }
    return {
      ...session,
      expiresAt: new Date(session.expiresAt).toISOString()
    };
  }

  refreshSession(token) {
    const session = this.sessions.get(token);
    if (!session) {
      return null;
    }
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    session.expiresAt = Date.now() + this.sessionTtlSec * 1000;
    return {
      ...session,
      expiresAt: new Date(session.expiresAt).toISOString()
    };
  }
}

module.exports = {
  AuthService
};
