const { randomUUID } = require("crypto");
const { DestinationStatus } = require("../domain/state-machine");
const {
  assertDestinationPayload,
  inferProtocolFromUrl,
  requiresStreamKey
} = require("../domain/validators");

function buildDefaultVideoProfile() {
  return {
    videoCodec: "libx264",
    bitrateKbps: 0,
    fps: null,
    fpsDenominator: 1,
    width: null,
    height: null,
    gopSec: null,
    bFrames: 0,
    preset: "veryfast"
  };
}

function buildDefaultAudioProfile() {
  return {
    audioCodec: "aac",
    audioBitrateKbps: 128,
    inputTrackIndex: 0,
    vodTrackInputIndex: null
  };
}

function buildDefaultSceneBinding() {
  return {
    sceneName: "",
    captureMethod: "windows_window_title",
    projectorWindowTitle: "",
    captureDisplayIndex: null,
    captureDisplayId: "",
    captureCropX: null,
    captureCropY: null,
    captureCropWidth: null,
    captureCropHeight: null,
    x11WindowId: "",
    x11Display: ""
  };
}

function normalizeProfileNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeProtocol(protocol, serverUrl) {
  return protocol || inferProtocolFromUrl(serverUrl) || "rtmp";
}

class DestinationService {
  constructor(persistenceService) {
    this.persistenceService = persistenceService;
    this.state = this.persistenceService.load();
    let changed = false;
    this.state.destinations = this.state.destinations.map((item) => {
      const next = { ...item };
      if (!next.protocol) {
        next.protocol = normalizeProtocol(next.protocol, next.serverUrl);
        changed = true;
      }
      if (!next.outputMode) {
        next.outputMode = "inherit";
        changed = true;
      }
      if (!next.videoProfile) {
        next.videoProfile = buildDefaultVideoProfile();
        changed = true;
      }
      if (!next.audioProfile) {
        next.audioProfile = buildDefaultAudioProfile();
        changed = true;
      }
      if (!next.videoSourceMode) {
        next.videoSourceMode = "master_ingest";
        changed = true;
      }
      if (!next.sceneBinding) {
        next.sceneBinding = buildDefaultSceneBinding();
        changed = true;
      }
      if (next.streamKeyMasked === undefined) {
        const streamKey = next.streamKeyEncrypted
          ? this.persistenceService.decryptSecret(next.streamKeyEncrypted)
          : "";
        next.streamKeyMasked = this.maskSecret(streamKey);
        changed = true;
      }
      return next;
    });
    if (changed) {
      this.flush();
    }
  }

  list() {
    return this.state.destinations.map((item) => this.toPublic(item));
  }

  get(id) {
    const destination = this.state.destinations.find((item) => item.id === id);
    return destination ? this.toPublic(destination) : null;
  }

  listInternal() {
    return this.state.destinations.map((item) => ({ ...item }));
  }

  getInternal(id) {
    const destination = this.state.destinations.find((item) => item.id === id);
    return destination ? { ...destination } : null;
  }

  create(payload) {
    const effectivePayload = {
      ...payload,
      protocol: normalizeProtocol(payload.protocol, payload.serverUrl),
      outputMode: payload.outputMode || "inherit",
      videoProfile: payload.videoProfile || buildDefaultVideoProfile(),
      audioProfile: payload.audioProfile || buildDefaultAudioProfile(),
      videoSourceMode: payload.videoSourceMode || "master_ingest",
      sceneBinding: payload.sceneBinding || buildDefaultSceneBinding()
    };

    const errors = assertDestinationPayload(effectivePayload);
    if (errors.length > 0) {
      const error = new Error("Validation failed");
      error.details = errors;
      throw error;
    }

    const streamKey = String(payload.streamKey || "");
    const encryptedKey = this.persistenceService.encryptSecret(streamKey);
    const now = new Date().toISOString();
    const created = {
      id: randomUUID(),
      name: payload.name.trim(),
      protocol: effectivePayload.protocol,
      serverUrl: payload.serverUrl.trim(),
      streamKeyEncrypted: encryptedKey,
      streamKeyMasked: this.maskSecret(streamKey),
      bitrateKbps:
        payload.bitrateKbps === undefined || payload.bitrateKbps === null
          ? 0
          : Number(payload.bitrateKbps),
      syncWithObsStart:
        payload.syncWithObsStart === undefined
          ? true
          : Boolean(payload.syncWithObsStart),
      syncWithObsStop:
        payload.syncWithObsStop === undefined
          ? true
          : Boolean(payload.syncWithObsStop),
      enabled: payload.enabled === undefined ? true : Boolean(payload.enabled),
      outputMode: effectivePayload.outputMode,
      videoProfile: this.normalizeVideoProfile(effectivePayload.videoProfile),
      audioProfile: this.normalizeAudioProfile(effectivePayload.audioProfile),
      videoSourceMode: effectivePayload.videoSourceMode,
      sceneBinding: this.normalizeSceneBinding(effectivePayload.sceneBinding),
      status: DestinationStatus.IDLE,
      lastError: null,
      createdAt: now,
      updatedAt: now
    };

    this.state.destinations.push(created);
    this.flush();
    return this.toPublic(created);
  }

  update(id, payload) {
    const index = this.state.destinations.findIndex((item) => item.id === id);
    if (index < 0) {
      return null;
    }

    const current = this.state.destinations[index];
    const nextOutputMode =
      payload.outputMode !== undefined ? payload.outputMode : current.outputMode;
    const nextVideoProfile =
      payload.videoProfile !== undefined ? payload.videoProfile : current.videoProfile;
    const nextAudioProfile =
      payload.audioProfile !== undefined ? payload.audioProfile : current.audioProfile;
    const nextVideoSourceMode =
      payload.videoSourceMode !== undefined
        ? payload.videoSourceMode
        : current.videoSourceMode || "master_ingest";
    const nextSceneBinding =
      payload.sceneBinding !== undefined ? payload.sceneBinding : current.sceneBinding;
    const currentStreamKey = this.decryptStreamKey(current);
    const currentProtocol = normalizeProtocol(current.protocol, current.serverUrl);

    const errors = assertDestinationPayload(payload, {
      isPatch: true,
      current: {
        protocol:
          payload.protocol !== undefined
            ? normalizeProtocol(payload.protocol, payload.serverUrl || current.serverUrl)
            : current.protocol || normalizeProtocol(undefined, current.serverUrl),
        streamKey: currentStreamKey,
        outputMode: nextOutputMode,
        videoProfile: nextVideoProfile,
        audioProfile: nextAudioProfile,
        videoSourceMode: nextVideoSourceMode,
        sceneBinding: nextSceneBinding
      }
    });
    if (errors.length > 0) {
      const error = new Error("Validation failed");
      error.details = errors;
      throw error;
    }

    const next = {
      ...current,
      updatedAt: new Date().toISOString()
    };

    if (payload.name !== undefined) next.name = payload.name.trim();
    if (payload.protocol !== undefined || payload.serverUrl !== undefined) {
      next.protocol = normalizeProtocol(
        payload.protocol !== undefined ? payload.protocol : next.protocol,
        payload.serverUrl !== undefined ? payload.serverUrl : next.serverUrl
      );
    }
    if (payload.serverUrl !== undefined) next.serverUrl = payload.serverUrl.trim();
    if (payload.streamKey !== undefined) {
      const streamKey = String(payload.streamKey || "");
      next.streamKeyEncrypted = this.persistenceService.encryptSecret(
        streamKey
      );
      next.streamKeyMasked = this.maskSecret(streamKey);
    } else if (requiresStreamKey(currentProtocol) && !requiresStreamKey(next.protocol)) {
      next.streamKeyEncrypted = this.persistenceService.encryptSecret("");
      next.streamKeyMasked = "";
    }
    if (payload.bitrateKbps !== undefined) {
      next.bitrateKbps = Number(payload.bitrateKbps);
    }
    if (payload.enabled !== undefined) next.enabled = Boolean(payload.enabled);
    if (payload.outputMode !== undefined) {
      next.outputMode = payload.outputMode;
    }
    if (payload.syncWithObsStart !== undefined) {
      next.syncWithObsStart = Boolean(payload.syncWithObsStart);
    }
    if (payload.syncWithObsStop !== undefined) {
      next.syncWithObsStop = Boolean(payload.syncWithObsStop);
    }
    if (payload.videoProfile !== undefined) {
      next.videoProfile = this.normalizeVideoProfile(payload.videoProfile);
    }
    if (payload.audioProfile !== undefined) {
      next.audioProfile = this.normalizeAudioProfile(payload.audioProfile);
    }
    if (payload.videoSourceMode !== undefined) {
      next.videoSourceMode = payload.videoSourceMode;
    }
    if (payload.sceneBinding !== undefined) {
      next.sceneBinding = this.normalizeSceneBinding(payload.sceneBinding);
    }

    this.state.destinations[index] = next;
    this.flush();
    return this.toPublic(next);
  }

  remove(id) {
    const before = this.state.destinations.length;
    this.state.destinations = this.state.destinations.filter(
      (item) => item.id !== id
    );

    if (this.state.destinations.length === before) {
      return false;
    }

    this.flush();
    return true;
  }

  reorder(ids = []) {
    const requestedIds = Array.isArray(ids) ? ids.filter((item) => typeof item === "string") : [];
    const lookup = new Map(
      this.state.destinations.map((item) => [item.id, item])
    );
    const reordered = [];

    requestedIds.forEach((id) => {
      const destination = lookup.get(id);
      if (!destination) {
        return;
      }
      reordered.push(destination);
      lookup.delete(id);
    });

    this.state.destinations.forEach((item) => {
      if (lookup.has(item.id)) {
        reordered.push(item);
      }
    });

    if (reordered.length !== this.state.destinations.length) {
      const error = new Error("Validation failed");
      error.details = ["`ids` must only reference existing destinations."];
      throw error;
    }

    this.state.destinations = reordered.map((item) => ({
      ...item,
      updatedAt: new Date().toISOString()
    }));
    this.flush();
    return this.list();
  }

  setStatus(id, status, errorMessage = null) {
    const index = this.state.destinations.findIndex((item) => item.id === id);
    if (index < 0) {
      return;
    }

    this.state.destinations[index] = {
      ...this.state.destinations[index],
      status,
      lastError: errorMessage || null,
      updatedAt: new Date().toISOString()
    };
    this.flush();
  }

  getSettings() {
    return { ...this.state.settings };
  }

  updateSettings(partial) {
    this.state.settings = {
      ...this.state.settings,
      ...partial
    };
    this.flush();
    return this.getSettings();
  }

  getPublishUrl(destination) {
    const key = this.decryptStreamKey(destination);
    const protocol = normalizeProtocol(destination.protocol, destination.serverUrl);
    const baseUrl = destination.serverUrl.replace(/\/+$/, "");
    if (!requiresStreamKey(protocol)) {
      return baseUrl;
    }
    return `${baseUrl}/${key}`;
  }

  normalizeVideoProfile(profile) {
    const fallback = buildDefaultVideoProfile();
    const source = profile && typeof profile === "object" ? profile : {};
    return {
      videoCodec: source.videoCodec || fallback.videoCodec,
      bitrateKbps: Number(source.bitrateKbps || 0),
      fps: normalizeProfileNumber(source.fps),
      fpsDenominator: Math.max(
        1,
        Math.min(4, normalizeProfileNumber(source.fpsDenominator) || fallback.fpsDenominator)
      ),
      width: normalizeProfileNumber(source.width),
      height: normalizeProfileNumber(source.height),
      gopSec: normalizeProfileNumber(source.gopSec),
      bFrames: Math.max(
        0,
        Math.min(16, normalizeProfileNumber(source.bFrames) || fallback.bFrames)
      ),
      preset: source.preset || fallback.preset
    };
  }

  normalizeAudioProfile(profile) {
    const fallback = buildDefaultAudioProfile();
    const source = profile && typeof profile === "object" ? profile : {};
    return {
      audioCodec: source.audioCodec || fallback.audioCodec,
      audioBitrateKbps: Number(source.audioBitrateKbps || fallback.audioBitrateKbps),
      inputTrackIndex: Math.max(
        0,
        Math.min(7, normalizeProfileNumber(source.inputTrackIndex) ?? fallback.inputTrackIndex)
      ),
      vodTrackInputIndex: (() => {
        const value = normalizeProfileNumber(source.vodTrackInputIndex);
        if (value === null) {
          return fallback.vodTrackInputIndex;
        }
        return Math.max(0, Math.min(7, value));
      })()
    };
  }

  normalizeSceneBinding(binding) {
    const fallback = buildDefaultSceneBinding();
    const source = binding && typeof binding === "object" ? binding : {};
    return {
      sceneName:
        typeof source.sceneName === "string" ? source.sceneName.trim() : fallback.sceneName,
      captureMethod:
        typeof source.captureMethod === "string" && source.captureMethod.trim()
          ? source.captureMethod.trim()
          : fallback.captureMethod,
      projectorWindowTitle:
        typeof source.projectorWindowTitle === "string"
          ? source.projectorWindowTitle.trim()
          : fallback.projectorWindowTitle,
      captureDisplayIndex: normalizeProfileNumber(source.captureDisplayIndex),
      captureDisplayId:
        typeof source.captureDisplayId === "string"
          ? source.captureDisplayId.trim()
          : fallback.captureDisplayId,
      captureCropX: normalizeProfileNumber(source.captureCropX),
      captureCropY: normalizeProfileNumber(source.captureCropY),
      captureCropWidth: normalizeProfileNumber(source.captureCropWidth),
      captureCropHeight: normalizeProfileNumber(source.captureCropHeight),
      x11WindowId:
        typeof source.x11WindowId === "string"
          ? source.x11WindowId.trim()
          : fallback.x11WindowId,
      x11Display:
        typeof source.x11Display === "string"
          ? source.x11Display.trim()
          : fallback.x11Display
    };
  }

  flush() {
    this.persistenceService.save(this.state);
  }

  decryptStreamKey(destination) {
    if (!destination || !destination.streamKeyEncrypted) {
      return "";
    }
    return this.persistenceService.decryptSecret(destination.streamKeyEncrypted);
  }

  maskSecret(secret) {
    const value = String(secret || "");
    if (!value) {
      return "";
    }
    return this.persistenceService.maskSecret(value);
  }

  toPublic(destination) {
    return {
      id: destination.id,
      name: destination.name,
      protocol: normalizeProtocol(destination.protocol, destination.serverUrl),
      serverUrl: destination.serverUrl,
      streamKeyMasked: destination.streamKeyMasked,
      bitrateKbps: destination.bitrateKbps,
      syncWithObsStart: destination.syncWithObsStart,
      syncWithObsStop: destination.syncWithObsStop,
      enabled: destination.enabled,
      outputMode: destination.outputMode || "inherit",
      videoProfile: destination.videoProfile || buildDefaultVideoProfile(),
      audioProfile: destination.audioProfile || buildDefaultAudioProfile(),
      videoSourceMode: destination.videoSourceMode || "master_ingest",
      sceneBinding: destination.sceneBinding || buildDefaultSceneBinding(),
      status: destination.status,
      lastError: destination.lastError,
      createdAt: destination.createdAt,
      updatedAt: destination.updatedAt
    };
  }
}

module.exports = {
  DestinationService
};
