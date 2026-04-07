const fs = require("fs");
const path = require("path");

const LEVEL_PRIORITY = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
});

class LoggerService {
  constructor(options) {
    this.logDir = options.logDir;
    this.level = options.level || "info";
    this.maxBytes = Number(options.maxBytes || 5 * 1024 * 1024);
    this.maxFiles = Math.max(1, Number(options.maxFiles || 5));
    this.silent = Boolean(options.silent);
    this.filePath = null;
    this.currentBytes = 0;
  }

  init() {
    fs.mkdirSync(this.logDir, { recursive: true });
    this.filePath = path.join(this.logDir, "core.ndjson");
    this.currentBytes = this.getExistingFileSize();
    this.rotateIfNeeded(0);
  }

  close() {
    return new Promise((resolve) => {
      resolve();
    });
  }

  debug(message, context = {}) {
    this.write("debug", message, context);
  }

  info(message, context = {}) {
    this.write("info", message, context);
  }

  warn(message, context = {}) {
    this.write("warn", message, context);
  }

  error(message, context = {}) {
    this.write("error", message, context);
  }

  child(defaultContext) {
    return {
      debug: (message, context = {}) =>
        this.debug(message, { ...defaultContext, ...context }),
      info: (message, context = {}) =>
        this.info(message, { ...defaultContext, ...context }),
      warn: (message, context = {}) =>
        this.warn(message, { ...defaultContext, ...context }),
      error: (message, context = {}) =>
        this.error(message, { ...defaultContext, ...context })
    };
  }

  write(level, message, context) {
    if (!this.shouldLog(level)) {
      return;
    }

    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context
    });

    const entry = `${line}\n`;
    this.rotateIfNeeded(Buffer.byteLength(entry, "utf8"));

    fs.appendFileSync(this.filePath, entry, "utf8");
    this.currentBytes += Buffer.byteLength(entry, "utf8");

    if (!this.silent) {
      if (level === "error") {
        console.error(`[${level}] ${message}`);
        return;
      }
      console.log(`[${level}] ${message}`);
    }
  }

  shouldLog(level) {
    const selected = LEVEL_PRIORITY[this.level] || LEVEL_PRIORITY.info;
    const current = LEVEL_PRIORITY[level] || LEVEL_PRIORITY.info;
    return current >= selected;
  }

  getLogFilePath() {
    return this.filePath;
  }

  getAllLogFilePaths() {
    if (!this.filePath) {
      return [];
    }

    const extension = path.extname(this.filePath);
    const baseName = path.basename(this.filePath, extension);
    const dir = path.dirname(this.filePath);
    const names = [];

    for (let index = this.maxFiles; index >= 1; index -= 1) {
      names.push(path.join(dir, `${baseName}.${index}${extension}`));
    }
    names.push(this.filePath);

    return names.filter((candidate) => fs.existsSync(candidate));
  }

  getRecentRawLines(limit = 200) {
    const logFiles = this.getAllLogFilePaths();
    if (logFiles.length === 0) {
      return [];
    }

    const lines = [];
    logFiles.forEach((filePath) => {
      const content = fs.readFileSync(filePath, "utf8");
      if (!content) {
        return;
      }
      const fileLines = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      lines.push(...fileLines);
    });

    return lines.slice(-Math.max(1, limit));
  }

  getRecentEntries(limit = 200) {
    const lines = this.getRecentRawLines(limit);
    return lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
  }

  rotateIfNeeded(incomingBytes) {
    if (!this.filePath || this.maxBytes <= 0) {
      return;
    }

    if (this.currentBytes + incomingBytes < this.maxBytes) {
      return;
    }

    this.rotateFiles();
    this.currentBytes = 0;
  }

  rotateFiles() {
    if (!this.filePath) {
      return;
    }

    const extension = path.extname(this.filePath);
    const baseName = path.basename(this.filePath, extension);
    const dir = path.dirname(this.filePath);

    for (let index = this.maxFiles; index >= 1; index -= 1) {
      const destination = path.join(dir, `${baseName}.${index}${extension}`);
      if (index === this.maxFiles && fs.existsSync(destination)) {
        fs.unlinkSync(destination);
      }

      const source =
        index === 1
          ? this.filePath
          : path.join(dir, `${baseName}.${index - 1}${extension}`);

      if (fs.existsSync(source)) {
        fs.renameSync(source, destination);
      }
    }
  }

  getExistingFileSize() {
    if (!this.filePath || !fs.existsSync(this.filePath)) {
      return 0;
    }
    try {
      return fs.statSync(this.filePath).size;
    } catch (_) {
      return 0;
    }
  }
}

module.exports = {
  LoggerService
};
