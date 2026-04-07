const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");
const {
  createSupportBundleZip
} = require("./services/support-bundle-service");

const SESSION_COOKIE_NAME = "laive_obs_session";

function parseLimit(value, fallback = 200, max = 5000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), max);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildDiagnosticsSnapshot(options) {
  const base = {
    obs: options.obsService.getStatus(),
    ingest: options.ingestService.getStatus(),
    orchestrator: options.orchestratorService.getStatusSnapshot(),
    managedProjectors: options.projectorRegistryService
      ? options.projectorRegistryService.list()
      : []
  };

  if (!options.metricsService) {
    return base;
  }

  return {
    ...base,
    metrics: options.metricsService.getSnapshot()
  };
}

function parseCookies(headerValue) {
  if (!headerValue) {
    return {};
  }
  return String(headerValue)
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce((acc, segment) => {
      const idx = segment.indexOf("=");
      if (idx <= 0) {
        return acc;
      }
      const key = decodeURIComponent(segment.slice(0, idx));
      const value = decodeURIComponent(segment.slice(idx + 1));
      acc[key] = value;
      return acc;
    }, {});
}

function shouldUseSecureCookie(req, config) {
  if (config && config.secureCookies) {
    return true;
  }
  if (!req) {
    return false;
  }
  if (req.secure) {
    return true;
  }

  const forwardedProtoRaw = req.headers
    ? req.headers["x-forwarded-proto"]
    : null;
  const forwardedProto = String(forwardedProtoRaw || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return forwardedProto === "https";
}

function writeSessionCookie(res, token, expiresAt, req, config) {
  const expiresDate = new Date(expiresAt);
  const cookie = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresDate.toUTCString()}`
  ];
  if (shouldUseSecureCookie(req, config)) {
    cookie.push("Secure");
  }
  res.setHeader("Set-Cookie", cookie.join("; "));
}

function clearSessionCookie(res, req, config) {
  const cookie = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT"
  ];
  if (shouldUseSecureCookie(req, config)) {
    cookie.push("Secure");
  }
  res.setHeader("Set-Cookie", cookie.join("; "));
}

function isAuthOpenRoute(req) {
  if (req.path === "/auth/status" && req.method === "GET") {
    return true;
  }
  if (req.path === "/auth/bootstrap" && req.method === "POST") {
    return true;
  }
  if (req.path === "/auth/login" && req.method === "POST") {
    return true;
  }
  return false;
}

function normalizeOrigin(origin) {
  if (!origin) {
    return null;
  }

  const raw = String(origin).trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch (_) {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
}

function buildAllowedOriginsSet(origins) {
  const set = new Set();
  const list = Array.isArray(origins) ? origins : [];
  list.forEach((origin) => {
    const normalized = normalizeOrigin(origin);
    if (normalized) {
      set.add(normalized);
    }
  });
  return set;
}

function isWebSocketOriginAllowed(req, allowedOriginsSet) {
  if (!allowedOriginsSet || allowedOriginsSet.size === 0) {
    return true;
  }

  const origin = req && req.headers ? req.headers.origin : null;
  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return false;
  }

  return allowedOriginsSet.has(normalized);
}

function getClientAddress(req) {
  const forwardedForRaw = req && req.headers ? req.headers["x-forwarded-for"] : null;
  const forwardedFor = String(forwardedForRaw || "")
    .split(",")[0]
    .trim();
  if (forwardedFor) {
    return forwardedFor;
  }

  if (req && req.ip) {
    return String(req.ip);
  }

  if (req && req.socket && req.socket.remoteAddress) {
    return String(req.socket.remoteAddress);
  }

  return "unknown";
}

function createFixedWindowRateLimiter(options = {}) {
  const windowMs = Math.max(1000, Number(options.windowMs || 60000));
  const max = Math.max(0, Number(options.max || 0));
  const buckets = new Map();

  function cleanup(now) {
    if (buckets.size < 2048) {
      return;
    }
    buckets.forEach((entry, key) => {
      if (entry.resetAt <= now) {
        buckets.delete(key);
      }
    });
  }

  return {
    consume(key) {
      if (max === 0) {
        return {
          allowed: true,
          remaining: Number.POSITIVE_INFINITY,
          resetAt: Date.now() + windowMs
        };
      }

      const now = Date.now();
      cleanup(now);
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        bucket = {
          count: 0,
          resetAt: now + windowMs
        };
      }

      if (bucket.count >= max) {
        buckets.set(key, bucket);
        return {
          allowed: false,
          remaining: 0,
          resetAt: bucket.resetAt
        };
      }

      bucket.count += 1;
      buckets.set(key, bucket);
      return {
        allowed: true,
        remaining: Math.max(0, max - bucket.count),
        resetAt: bucket.resetAt
      };
    }
  };
}

function enforceAuthRateLimit(req, res, action, limiter) {
  if (!limiter) {
    return true;
  }

  const clientAddress = getClientAddress(req);
  const result = limiter.consume(`${action}:${clientAddress}`);
  if (result.allowed) {
    return true;
  }

  const retryAfterSec = Math.max(
    1,
    Math.ceil((result.resetAt - Date.now()) / 1000)
  );
  res.setHeader("Retry-After", String(retryAfterSec));
  res.status(429).json({
    error: "Too many authentication attempts. Try again later.",
    code: "AUTH_RATE_LIMITED",
    retryAfterSec
  });
  return false;
}

function validateNetworkSettings(partial = {}) {
  const errors = [];
  if (
    partial.allowLan !== undefined &&
    typeof partial.allowLan !== "boolean"
  ) {
    errors.push("`allowLan` must be a boolean.");
  }
  if (
    partial.bindAddress !== undefined &&
    (typeof partial.bindAddress !== "string" || !partial.bindAddress.trim())
  ) {
    errors.push("`bindAddress` must be a non-empty string.");
  }
  if (partial.sessionTtlSec !== undefined) {
    const ttl = Number(partial.sessionTtlSec);
    if (!Number.isFinite(ttl) || ttl < 300 || ttl > 86400) {
      errors.push("`sessionTtlSec` must be between 300 and 86400.");
    }
  }
  return errors;
}

function createHttpServer(options) {
  const app = express();
  const authRateLimitMax = Number.isFinite(Number(options.config.authRateLimitMax))
    ? Math.max(0, Math.floor(Number(options.config.authRateLimitMax)))
    : 20;
  const authRateLimitWindowMs = Number.isFinite(
    Number(options.config.authRateLimitWindowMs)
  )
    ? Math.max(1000, Math.floor(Number(options.config.authRateLimitWindowMs)))
    : 60000;
  const authRateLimiter =
    authRateLimitMax > 0
      ? createFixedWindowRateLimiter({
          max: authRateLimitMax,
          windowMs: authRateLimitWindowMs
        })
      : null;
  const allowedWsOrigins = buildAllowedOriginsSet(options.config.wsAllowedOrigins);

  app.use(express.json());
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      if (!options.logger) {
        return;
      }
      options.logger.info("http.request", {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - start
      });
      if (options.metricsService) {
        options.metricsService.increment("http.requests.total");
        options.metricsService.increment(`http.requests.${res.statusCode}`);
      }
    });
    next();
  });

  app.use((req, res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    req.sessionToken = req.cookies[SESSION_COOKIE_NAME] || null;
    next();
  });

  app.use("/api", (req, res, next) => {
    if (isAuthOpenRoute(req)) {
      next();
      return;
    }

    const authStatus = options.authService.getStatus({
      sessionToken: req.sessionToken
    });
    if (!authStatus.configured) {
      res.status(401).json({
        error: "Authentication bootstrap required.",
        code: "AUTH_BOOTSTRAP_REQUIRED"
      });
      return;
    }

    if (!authStatus.authenticated) {
      clearSessionCookie(res, req, options.config);
      res.status(401).json({
        error: "Authentication required.",
        code: "AUTH_REQUIRED"
      });
      return;
    }

    const refreshed = options.authService.refreshSession(req.sessionToken);
    if (refreshed) {
      writeSessionCookie(
        res,
        req.sessionToken,
        refreshed.expiresAt,
        req,
        options.config
      );
      req.authSession = refreshed;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      uptimeSec: Math.round(process.uptime()),
      app: options.config.appName,
      version: options.config.version,
      services: {
        obs: options.obsService.getStatus(),
        ingest: options.ingestService.getStatus(),
        orchestrator: options.orchestratorService.getStatusSnapshot()
      }
    });
  });

  app.get("/api/auth/status", (req, res) => {
    res.json(
      options.authService.getStatus({
        sessionToken: req.sessionToken
      })
    );
  });

  app.post("/api/auth/bootstrap", (req, res) => {
    if (!enforceAuthRateLimit(req, res, "bootstrap", authRateLimiter)) {
      return;
    }

    const result = options.authService.bootstrap(req.body || {});
    if (!result.ok) {
      const status = result.reason === "already-configured" ? 409 : 400;
      res.status(status).json(result);
      return;
    }
    res.status(201).json(result);
  });

  app.post("/api/auth/login", (req, res) => {
    if (!enforceAuthRateLimit(req, res, "login", authRateLimiter)) {
      return;
    }

    const result = options.authService.login(req.body || {});
    if (!result.ok) {
      res.status(401).json(result);
      return;
    }
    writeSessionCookie(res, result.token, result.expiresAt, req, options.config);
    res.json({
      ok: true,
      expiresAt: result.expiresAt
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    options.authService.logout(req.sessionToken);
    clearSessionCookie(res, req, options.config);
    res.status(204).send();
  });

  app.get("/api/destinations", (_req, res) => {
    res.json(options.destinationService.list());
  });

  app.post("/api/destinations", (req, res) => {
    try {
      const created = options.destinationService.create(req.body || {});
      res.status(201).json(created);
    } catch (error) {
      res.status(400).json({
        error: error.message,
        details: error.details || []
      });
    }
  });

  app.post("/api/destinations/reorder", (req, res) => {
    const ids = req.body && req.body.ids;
    if (!Array.isArray(ids) || ids.some((item) => typeof item !== "string")) {
      res.status(400).json({
        error: "Validation failed.",
        details: ["`ids` must be an array of destination ids."]
      });
      return;
    }

    try {
      const reordered = options.destinationService.reorder(ids);
      res.json(reordered);
    } catch (error) {
      res.status(400).json({
        error: error.message,
        details: error.details || []
      });
    }
  });

  app.patch("/api/destinations/:id", (req, res) => {
    try {
      const updated = options.destinationService.update(req.params.id, req.body || {});
      if (!updated) {
        res.status(404).json({ error: "Destination not found." });
        return;
      }
      res.json(updated);
    } catch (error) {
      res.status(400).json({
        error: error.message,
        details: error.details || []
      });
    }
  });

  app.delete("/api/destinations/:id", (req, res) => {
    const removed = options.destinationService.remove(req.params.id);
    if (!removed) {
      res.status(404).json({ error: "Destination not found." });
      return;
    }
    res.status(204).send();
  });

  app.post("/api/destinations/:id/projector/open", async (req, res) => {
    const destination = options.destinationService.getInternal(req.params.id);
    if (!destination) {
      res.status(404).json({ error: "Destination not found." });
      return;
    }

    if (destination.videoSourceMode !== "scene_projector_capture") {
      res.status(409).json({
        error: "Destination is not configured for scene projector capture."
      });
      return;
    }

    const sceneBinding = destination.sceneBinding || {};
    if (!sceneBinding.sceneName) {
      res.status(400).json({
        error: "Destination scene binding is incomplete.",
        details: ["`sceneBinding.sceneName` is required."]
      });
      return;
    }

    await handleObsCommand(res, async () => {
      await options.obsService.openSourceProjector({
        sourceName: sceneBinding.sceneName,
        monitorIndex: -1
      });
      if (options.projectorRegistryService) {
        options.projectorRegistryService.registerDestinationProjector(destination, {
          closeCapability: options.obsService.getProjectorCloseCapability(
            sceneBinding
          )
        });
      }
      return {
        opened: true,
        destinationId: destination.id,
        sceneName: sceneBinding.sceneName,
        projectorWindowTitle: sceneBinding.projectorWindowTitle || ""
      };
      });
    });

  app.post("/api/destinations/:id/projector/detect", async (req, res) => {
    const destination = options.destinationService.getInternal(req.params.id);
    if (!destination) {
      res.status(404).json({ error: "Destination not found." });
      return;
    }

    if (destination.videoSourceMode !== "scene_projector_capture") {
      res.status(409).json({
        error: "Destination is not configured for scene projector capture."
      });
      return;
    }

    const sceneBinding = destination.sceneBinding || {};
    if (!sceneBinding.sceneName) {
      res.status(400).json({
        error: "Destination scene binding is incomplete.",
        details: ["`sceneBinding.sceneName` is required."]
      });
      return;
    }

    await handleObsCommand(res, async () => {
      await options.obsService.openSourceProjector({
        sourceName: sceneBinding.sceneName,
        monitorIndex: -1
      });
      if (options.projectorRegistryService) {
        options.projectorRegistryService.registerDestinationProjector(destination, {
          detected: true,
          closeCapability: options.obsService.getProjectorCloseCapability(
            sceneBinding
          )
        });
      }
      await wait(750);

      const discovery = await options.obsService.listProjectorWindows({
        sceneName: sceneBinding.sceneName
      });

      let updatedDestination = options.destinationService.get(destination.id);
      let autoBound = false;
      const candidates = discovery.windows.map((windowInfo) => {
        if (options.obsService.platform === "darwin" && options.ffmpegService) {
          return {
            ...windowInfo,
            suggestedSceneBinding:
              options.ffmpegService.buildMacSceneBindingSuggestion(windowInfo)
          };
        }
        if (options.obsService.platform === "linux") {
          return {
            ...windowInfo,
            suggestedSceneBinding: {
              captureMethod: "linux_x11_window_id",
              projectorWindowTitle: windowInfo.title || "",
              x11WindowId: windowInfo.x11WindowId || "",
              x11Display: windowInfo.x11Display || ":0.0"
            }
          };
        }
        return windowInfo;
      });

      if (candidates.length === 1) {
        const nextSceneBinding = {
          ...sceneBinding
        };
        if (options.obsService.platform === "darwin") {
          Object.assign(
            nextSceneBinding,
            candidates[0].suggestedSceneBinding || {}
          );
        } else if (options.obsService.platform === "linux") {
          Object.assign(
            nextSceneBinding,
            candidates[0].suggestedSceneBinding || {}
          );
        } else {
          nextSceneBinding.projectorWindowTitle = candidates[0].title;
        }
        updatedDestination = options.destinationService.update(destination.id, {
          sceneBinding: nextSceneBinding
        });
        if (options.projectorRegistryService) {
          options.projectorRegistryService.registerDestinationProjector(
            options.destinationService.getInternal(destination.id),
            {
              detected: true,
              closeCapability: options.obsService.getProjectorCloseCapability(
                nextSceneBinding
              )
            }
          );
        }
        autoBound = true;
      }

      return {
        opened: true,
        autoBound,
        destinationId: destination.id,
        sceneName: sceneBinding.sceneName,
        candidates,
        destination: updatedDestination
      };
    });
  });

  app.post("/api/destinations/:id/projector/validate", (req, res) => {
    const destination = options.destinationService.getInternal(req.params.id);
    if (!destination) {
      res.status(404).json({ error: "Destination not found." });
      return;
    }

    if (destination.videoSourceMode !== "scene_projector_capture") {
      res.status(409).json({
        error: "Destination is not configured for scene projector capture."
      });
      return;
    }

    try {
      const validation = options.ffmpegService.validateSceneCaptureBinding(destination);
      res.json({
        ok: true,
        destinationId: destination.id,
        validation
      });
    } catch (error) {
      res.status(409).json({
        ok: false,
        error: error.message,
        code: error.code || "CAPTURE_VALIDATION_FAILED",
        details: Array.isArray(error.details) ? error.details : [],
        guidance: Array.isArray(error.guidance) ? error.guidance : []
      });
    }
  });

  app.get("/api/projectors/managed", (_req, res) => {
    res.json({
      projectors: options.projectorRegistryService
        ? options.projectorRegistryService.list()
        : []
    });
  });

  app.post("/api/projectors/reopen-managed", async (_req, res) => {
    if (!options.projectorRegistryService) {
      res.status(503).json({ error: "Projector registry service not available." });
      return;
    }

    await handleObsCommand(res, async () => {
      const result = await options.projectorRegistryService.reopenAll(
        options.destinationService.listInternal(),
        options.obsService
      );
      return result;
    });
  });

  app.post("/api/projectors/managed/:destinationId/reopen", async (req, res) => {
    if (!options.projectorRegistryService) {
      res.status(503).json({ error: "Projector registry service not available." });
      return;
    }

    const destination = options.destinationService.getInternal(
      req.params.destinationId
    );
    if (!destination) {
      res.status(404).json({ error: "Destination not found." });
      return;
    }

    await handleObsCommand(res, async () => {
      const reopened =
        await options.projectorRegistryService.reopenDestinationProjector(
          destination,
          options.obsService
        );
      return {
        reopened
      };
    });
  });

  app.post("/api/projectors/managed/:destinationId/close", (req, res) => {
    if (!options.projectorRegistryService) {
      res.status(503).json({ error: "Projector registry service not available." });
      return;
    }

    try {
      const closed = options.projectorRegistryService.closeDestinationProjector(
        req.params.destinationId,
        options.obsService
      );
      if (!closed) {
        res.status(404).json({ error: "Managed projector not found." });
        return;
      }
      res.json({
        ok: true,
        closed
      });
    } catch (error) {
      res.status(
        error.code === "OBS_UNSUPPORTED_REQUEST"
          ? 409
          : error.code === "OBS_NOT_CONNECTED"
            ? 503
            : 500
      ).json({
        ok: false,
        error: error.message,
        code: error.code || "PROJECTOR_CLOSE_FAILED",
        details: Array.isArray(error.details) ? error.details : []
      });
    }
  });

  app.delete("/api/projectors/managed/:destinationId", (req, res) => {
    if (!options.projectorRegistryService) {
      res.status(503).json({ error: "Projector registry service not available." });
      return;
    }
    const removed = options.projectorRegistryService.forgetDestination(
      req.params.destinationId
    );
    if (!removed) {
      res.status(404).json({ error: "Managed projector not found." });
      return;
    }
    res.json({
      ok: true,
      removed
    });
  });

  app.get("/api/destinations/:id/projector/preview.jpg", (req, res) => {
    const destination = options.destinationService.getInternal(req.params.id);
    if (!destination) {
      res.status(404).json({ error: "Destination not found." });
      return;
    }

    if (destination.videoSourceMode !== "scene_projector_capture") {
      res.status(409).json({
        error: "Destination is not configured for scene projector capture."
      });
      return;
    }

    try {
      const preview = options.ffmpegService.captureSceneCapturePreview(destination);
      res.setHeader("Content-Type", preview.contentType || "image/jpeg");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-LAIVE-PREVIEW-PLATFORM", preview.platform || "");
      res.setHeader(
        "X-LAIVE-PREVIEW-CAPTURE-METHOD",
        preview.captureMethod || ""
      );
      res.send(preview.buffer);
    } catch (error) {
      res.status(409).json({
        ok: false,
        error: error.message,
        code: error.code || "CAPTURE_PREVIEW_FAILED",
        details: Array.isArray(error.details) ? error.details : [],
        guidance: Array.isArray(error.guidance) ? error.guidance : []
      });
    }
  });

  app.get("/api/transmission/readiness", (_req, res) => {
    const readiness = options.ffmpegService.getTransmissionReadiness(
      options.destinationService.listInternal(),
      options.ingestService.getMasterInputUrl()
    );
    res.json(readiness);
  });

  app.post("/api/streams/start-all", (_req, res) => {
    const result = options.orchestratorService.startAll("manual");
    res.json(result);
  });

  app.post("/api/streams/stop-all", (_req, res) => {
    const result = options.orchestratorService.stopAll("manual");
    res.json(result);
  });

  app.post("/api/streams/:id/start", async (req, res) => {
    const destination = options.destinationService.getInternal(req.params.id);
    if (
      destination &&
      destination.videoSourceMode === "scene_projector_capture" &&
      options.projectorRegistryService
    ) {
      try {
        await options.projectorRegistryService.ensureDestinationProjector(
          destination,
          options.obsService
        );
        const result = options.orchestratorService.startOne(
          req.params.id,
          "manual"
        );
        if (!result.started) {
          res.status(409).json(result);
          return;
        }
        res.json(result);
      } catch (error) {
        const code = error.code || "OBS_REQUEST_FAILED";
        const status =
          code === "OBS_NOT_CONNECTED"
            ? 503
            : code === "OBS_UNSUPPORTED_REQUEST"
              ? 501
              : code === "VALIDATION_ERROR"
                ? 400
                : 500;
        res.status(status).json({
          ok: false,
          code,
          error: error.message
        });
      }
      return;
    }

    const result = options.orchestratorService.startOne(req.params.id, "manual");
    if (!result.started) {
      res.status(409).json(result);
      return;
    }
    res.json(result);
  });

  app.post("/api/streams/:id/stop", (req, res) => {
    const result = options.orchestratorService.stopOne(req.params.id, "manual");
    if (!result.stopped) {
      res.status(409).json(result);
      return;
    }
    res.json(result);
  });

  app.get("/api/obs/status", (_req, res) => {
    res.json(options.obsService.getStatus());
  });

  app.get("/api/status", (_req, res) => {
    res.json({
      destinations: options.destinationService.list(),
      obs: options.obsService.getStatus(),
      ingest: options.ingestService.getStatus(),
      orchestrator: options.orchestratorService.getStatusSnapshot(),
      managedProjectors: options.projectorRegistryService
        ? options.projectorRegistryService.list()
        : []
    });
  });

  app.get("/api/settings", (_req, res) => {
    res.json(options.destinationService.getSettings());
  });

  app.patch("/api/settings", (req, res) => {
    const settings = options.destinationService.updateSettings(req.body || {});
    res.json(settings);
  });

  app.get("/api/settings/network", (_req, res) => {
    const settings = options.destinationService.getSettings();
    res.json(settings.network || {});
  });

  app.patch("/api/settings/network", (req, res) => {
    const payload = req.body || {};
    const errors = validateNetworkSettings(payload);
    if (errors.length > 0) {
      res.status(400).json({
        error: "Validation failed.",
        details: errors
      });
      return;
    }

    const current = options.destinationService.getSettings().network || {};
    const next = {
      ...current,
      ...payload
    };
    if (payload.allowLan === true && payload.bindAddress === undefined) {
      next.bindAddress = "0.0.0.0";
    }
    if (payload.allowLan === false && payload.bindAddress === undefined) {
      next.bindAddress = "127.0.0.1";
    }

    const updated = options.destinationService.updateSettings({
      network: next
    });

    res.json({
      network: updated.network,
      restartRequired: true
    });
  });

  async function handleObsCommand(res, handler) {
    try {
      const payload = await handler();
      res.json({ ok: true, ...payload });
    } catch (error) {
      const code = error.code || "OBS_REQUEST_FAILED";
      const status =
        code === "OBS_NOT_CONNECTED"
          ? 503
          : code === "OBS_UNSUPPORTED_REQUEST"
            ? 501
            : code === "VALIDATION_ERROR"
              ? 400
              : 500;
      res.status(status).json({
        ok: false,
        code,
        error: error.message
      });
    }
  }

  app.get("/api/obs/scenes", async (_req, res) => {
    await handleObsCommand(res, async () => options.obsService.listScenes());
  });

  app.get("/api/obs/monitors", async (_req, res) => {
    await handleObsCommand(res, async () => options.obsService.listMonitors());
  });

  app.get("/api/obs/projector-windows", async (req, res) => {
    const sceneName =
      req.query && typeof req.query.sceneName === "string"
        ? req.query.sceneName
        : undefined;
    await handleObsCommand(res, async () =>
      options.obsService.listProjectorWindows({ sceneName })
    );
  });

  app.post("/api/obs/scene/switch", async (req, res) => {
    const sceneName = req.body && req.body.sceneName;
    await handleObsCommand(res, async () => {
      await options.obsService.switchScene(sceneName);
      return { sceneName };
    });
  });

  app.post("/api/obs/projectors/source", async (req, res) => {
    const payload = req.body || {};
    await handleObsCommand(res, async () => {
      await options.obsService.openSourceProjector(payload);
      return {
        opened: true,
        ...payload
      };
    });
  });

  app.post("/api/obs/projectors/video-mix", async (req, res) => {
    const payload = req.body || {};
    await handleObsCommand(res, async () => {
      await options.obsService.openVideoMixProjector(payload);
      return {
        opened: true,
        ...payload
      };
    });
  });

  app.post("/api/obs/stream/start", async (_req, res) => {
    await handleObsCommand(res, async () => {
      await options.obsService.startStream();
      return {};
    });
  });

  app.post("/api/obs/stream/stop", async (_req, res) => {
    await handleObsCommand(res, async () => {
      await options.obsService.stopStream();
      return {};
    });
  });

  app.post("/api/obs/record/start", async (_req, res) => {
    await handleObsCommand(res, async () => {
      await options.obsService.startRecord();
      return {};
    });
  });

  app.post("/api/obs/record/stop", async (_req, res) => {
    await handleObsCommand(res, async () => {
      await options.obsService.stopRecord();
      return {};
    });
  });

  app.get("/api/metrics", (_req, res) => {
    if (!options.metricsService) {
      res.status(503).json({ error: "Metrics service not available." });
      return;
    }
    res.json(options.metricsService.getSnapshot());
  });

  app.get("/api/diagnostics", (_req, res) => {
    res.json(buildDiagnosticsSnapshot(options));
  });

  app.get("/api/diagnostics/export", (_req, res) => {
    const payload = {
      exportedAt: new Date().toISOString(),
      diagnostics: buildDiagnosticsSnapshot(options)
    };
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="laive-diagnostics-${Date.now()}.json"`
    );
    res.send(JSON.stringify(payload, null, 2));
  });

  app.get("/api/logs/recent", (req, res) => {
    if (!options.logger) {
      res.status(503).json({ error: "Logger service not available." });
      return;
    }

    const limit = parseLimit(req.query.limit, 200, 5000);
    res.json({
      filePath: options.logger.getLogFilePath(),
      limit,
      entries: options.logger.getRecentEntries(limit)
    });
  });

  app.get("/api/logs/export", (req, res) => {
    if (!options.logger) {
      res.status(503).json({ error: "Logger service not available." });
      return;
    }

    const limit = parseLimit(req.query.limit, 500, 10000);
    const lines = options.logger.getRecentRawLines(limit);
    const payload = lines.join("\n") + (lines.length ? "\n" : "");
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="laive-logs-${Date.now()}.ndjson"`
    );
    res.send(payload);
  });

  app.get("/api/support-bundle/export", (req, res) => {
    if (!options.logger) {
      res.status(503).json({ error: "Logger service not available." });
      return;
    }

    try {
      const diagnostics = buildDiagnosticsSnapshot(options);
      const limit = parseLimit(req.query.limit, 1000, 10000);
      const bundle = createSupportBundleZip({
        appName: options.config.appName,
        version: options.config.version,
        diagnostics,
        logLines: options.logger.getRecentRawLines(limit)
      });

      res.setHeader("Content-Type", bundle.contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${bundle.fileName}"`
      );
      res.setHeader("X-LAIVE-BUNDLE-SHA256", bundle.sha256);
      res.send(bundle.buffer);
    } catch (error) {
      if (options.logger) {
        options.logger.error("support.bundle.export_failed", {
          message: error.message
        });
      }
      res.status(500).json({
        error: "Failed to generate support bundle.",
        details: error.message
      });
    }
  });

  app.use(
    "/",
    express.static(options.config.dashboardPublicDir, {
      index: "index.html",
      maxAge: "1m"
    })
  );

  app.get("*", (_req, res) => {
    res.sendFile(path.join(options.config.dashboardPublicDir, "index.html"));
  });

  const server = http.createServer(app);
  const wsServer = new WebSocketServer({ server, path: options.config.wsPath });
  options.eventBus.attachWebSocketServer(wsServer);

  wsServer.on("connection", (socket, req) => {
    if (!isWebSocketOriginAllowed(req, allowedWsOrigins)) {
      socket.send(
        JSON.stringify({
          type: "system.origin_not_allowed",
          payload: {
            message: "WebSocket origin is not allowed."
          },
          timestamp: new Date().toISOString()
        })
      );
      socket.close();
      return;
    }

    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME] || null;
    const session = options.authService.validateSession(token);
    if (!session) {
      socket.send(
        JSON.stringify({
          type: "system.unauthorized",
          payload: {
            message: "Authentication required for event bus."
          },
          timestamp: new Date().toISOString()
        })
      );
      socket.close();
      return;
    }
    options.authService.refreshSession(token);

    socket.send(
      JSON.stringify({
        type: "system.hello",
        payload: {
          message: "Connected to LAIVE OBS event bus.",
          username: session.username
        },
        timestamp: new Date().toISOString()
      })
    );
  });

  return server;
}

module.exports = {
  createHttpServer
};
