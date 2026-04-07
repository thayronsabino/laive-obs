const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_STATE = Object.freeze({
  destinations: [],
  settings: {
    syncAllWithObsStart: false,
    syncAllWithObsStop: false,
    network: {
      allowLan: false,
      bindAddress: "127.0.0.1",
      sessionTtlSec: 1800
    }
  },
  auth: {
    configured: false,
    username: null,
    passwordHash: null,
    passwordSalt: null,
    passwordChangedAt: null
  }
});

function deriveKey(seed) {
  return crypto.scryptSync(seed, "laive-obs-mvp", 32);
}

class PersistenceService {
  constructor(options) {
    this.dataDir = options.dataDir;
    this.dataFile = options.dataFile;
    this.seedFilePath = path.join(this.dataDir, ".secret-seed");

    const legacySeed = `${os.userInfo().username}@${os.hostname()}`;
    const configuredSeed = process.env.LAIVE_SECRET_SEED || null;
    const localSeed = this.readLocalSeed();
    const activeSeed = configuredSeed || localSeed || this.createLocalSeed();
    const candidateSeeds = [activeSeed];

    if (configuredSeed && localSeed && localSeed !== configuredSeed) {
      candidateSeeds.push(localSeed);
    }

    if (
      legacySeed !== activeSeed &&
      legacySeed !== configuredSeed &&
      legacySeed !== localSeed
    ) {
      candidateSeeds.push(legacySeed);
    }

    const seen = new Set();
    this.keys = [];
    candidateSeeds.forEach((seed) => {
      if (!seed) {
        return;
      }
      const key = deriveKey(seed);
      const marker = key.toString("hex");
      if (seen.has(marker)) {
        return;
      }
      seen.add(marker);
      this.keys.push(key);
    });
    this.key = this.keys[0];
  }

  ensureDataDir() {
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  readLocalSeed() {
    try {
      if (!fs.existsSync(this.seedFilePath)) {
        return null;
      }
      const raw = fs.readFileSync(this.seedFilePath, "utf8");
      const seed = String(raw || "").trim();
      return seed || null;
    } catch (_) {
      return null;
    }
  }

  createLocalSeed() {
    this.ensureDataDir();
    const generated = crypto.randomBytes(32).toString("hex");
    try {
      fs.writeFileSync(this.seedFilePath, `${generated}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx"
      });
      return generated;
    } catch (error) {
      if (error && error.code === "EEXIST") {
        const existing = this.readLocalSeed();
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  load() {
    this.ensureDataDir();

    if (!fs.existsSync(this.dataFile)) {
      this.save(DEFAULT_STATE);
      return structuredClone(DEFAULT_STATE);
    }

    const raw = fs.readFileSync(this.dataFile, "utf8");
    const parsed = JSON.parse(raw);

    return {
      destinations: Array.isArray(parsed.destinations)
        ? parsed.destinations
        : [],
      settings: {
        ...DEFAULT_STATE.settings,
        ...(parsed.settings || {}),
        network: {
          ...DEFAULT_STATE.settings.network,
          ...((parsed.settings && parsed.settings.network) || {})
        }
      },
      auth: {
        ...DEFAULT_STATE.auth,
        ...(parsed.auth || {})
      }
    };
  }

  save(state) {
    this.ensureDataDir();
    fs.writeFileSync(this.dataFile, JSON.stringify(state, null, 2), "utf8");
  }

  encryptSecret(plainText) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(String(plainText), "utf8"),
      cipher.final()
    ]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([iv, tag, encrypted]).toString("base64");
  }

  decryptSecret(cipherText) {
    const buffer = Buffer.from(cipherText, "base64");
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const encrypted = buffer.subarray(28);
    let lastError = null;

    for (const key of this.keys) {
      try {
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([
          decipher.update(encrypted),
          decipher.final()
        ]);
        return decrypted.toString("utf8");
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Failed to decrypt secret.");
  }

  maskSecret(secret) {
    const value = String(secret || "");
    if (value.length <= 4) {
      return "*".repeat(value.length || 4);
    }
    return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
  }
}

module.exports = {
  PersistenceService,
  DEFAULT_STATE
};
