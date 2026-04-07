const { spawnSync } = require("child_process");
const OBSWebSocket = require("obs-websocket-js").default;

class ObsService {
  constructor(options) {
    this.eventBus = options.eventBus;
    this.url = options.url;
    this.password = options.password;
    this.reconnectMs = options.reconnectMs;
    this.onStreamingStateChanged = options.onStreamingStateChanged;
    this.obs = options.obsClient || new OBSWebSocket();
    this.platform = options.platform || process.platform;
    this.listWindowsFn = options.listWindowsFn;
    this.spawnSyncFn = options.spawnSyncFn || spawnSync;
    this.reconnectTimer = null;
    this.shutdownRequested = false;
    this.status = {
      connected: false,
      streaming: false,
      recording: false,
      currentSceneName: null,
      lastError: null,
      lastConnectedAt: null,
      url: this.url
    };
  }

  start() {
    this.bindEvents();
    this.connect();
  }

  async stop() {
    this.shutdownRequested = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      if (typeof this.obs.disconnect === "function") {
        await this.obs.disconnect();
      }
    } catch (_) {
      // noop
    }
  }

  getStatus() {
    return { ...this.status };
  }

  bindEvents() {
    this.obs.on("ConnectionOpened", () => {
      this.status.connected = true;
      this.status.lastConnectedAt = new Date().toISOString();
      this.status.lastError = null;
      this.eventBus.publish("obs.connected", this.getStatus());
      this.probeStreamStatus();
    });

    this.obs.on("ConnectionClosed", () => {
      this.status.connected = false;
      this.eventBus.publish("obs.disconnected", this.getStatus());
      this.scheduleReconnect();
    });

    this.obs.on("ConnectionError", (error) => {
      this.status.lastError = error.message;
      this.eventBus.publish("obs.connection_error", {
        message: error.message
      });
      this.scheduleReconnect();
    });

    this.obs.on("StreamStateChanged", (event) => {
      const active = Boolean(event.outputActive);
      this.status.streaming = active;
      this.eventBus.publish(
        active ? "obs.streaming_started" : "obs.streaming_stopped",
        {
          outputState: event.outputState
        }
      );
      if (this.onStreamingStateChanged) {
        this.onStreamingStateChanged(active);
      }
    });

    this.obs.on("RecordStateChanged", (event) => {
      const active = Boolean(event.outputActive);
      this.status.recording = active;
      this.eventBus.publish(
        active ? "obs.recording_started" : "obs.recording_stopped",
        {
          outputState: event.outputState
        }
      );
    });

    this.obs.on("CurrentProgramSceneChanged", (event) => {
      this.status.currentSceneName = event.sceneName || null;
      this.eventBus.publish("obs.scene_changed", {
        sceneName: this.status.currentSceneName
      });
    });
  }

  async connect() {
    if (this.shutdownRequested) {
      return;
    }

    try {
      await this.obs.connect(this.url, this.password);
    } catch (error) {
      this.status.connected = false;
      this.status.lastError = error.message;
      this.eventBus.publish("obs.connection_error", {
        message: error.message
      });
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.shutdownRequested || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectMs);
  }

  async probeStreamStatus() {
    try {
      const response = await this.obs.call("GetStreamStatus");
      this.status.streaming = Boolean(response.outputActive || response.active);
      if (this.onStreamingStateChanged) {
        this.onStreamingStateChanged(this.status.streaming);
      }
    } catch (_) {
      // GetStreamStatus is not available in all versions and can be ignored.
    }

    try {
      const response = await this.obs.call("GetRecordStatus");
      this.status.recording = Boolean(response.outputActive || response.active);
    } catch (_) {
      // optional capability
    }

    try {
      const scene = await this.obs.call("GetCurrentProgramScene");
      this.status.currentSceneName = scene.currentProgramSceneName || null;
    } catch (_) {
      // optional capability
    }
  }

  async startStream() {
    return this.callWithCapability("StartStream");
  }

  async stopStream() {
    return this.callWithCapability("StopStream");
  }

  async startRecord() {
    return this.callWithCapability("StartRecord");
  }

  async stopRecord() {
    return this.callWithCapability("StopRecord");
  }

  async listScenes() {
    const response = await this.callWithCapability("GetSceneList");
    return {
      scenes: (response.scenes || []).map((scene) => ({
        sceneName: scene.sceneName
      })),
      currentSceneName:
        response.currentProgramSceneName || this.status.currentSceneName
    };
  }

  async listMonitors() {
    const response = await this.callWithCapability("GetMonitorList");
    return {
      monitors: response.monitors || []
    };
  }

  async listProjectorWindows(filters = {}) {
    if (
      this.platform !== "win32" &&
      this.platform !== "darwin" &&
      this.platform !== "linux"
    ) {
      const error = new Error(
        "Projector window discovery is currently supported only on Windows, macOS and Linux."
      );
      error.code = "OBS_UNSUPPORTED_REQUEST";
      throw error;
    }

    const rawWindows = await Promise.resolve(
      this.listWindowsFn
        ? this.listWindowsFn()
        : this.platform === "darwin"
          ? this.listObsWindowsOnMac()
          : this.platform === "linux"
            ? this.listObsWindowsOnLinux()
          : this.listObsWindowsOnWindows()
    );
    const sceneName = typeof filters.sceneName === "string" ? filters.sceneName.trim() : "";

    const candidates = (Array.isArray(rawWindows) ? rawWindows : [])
      .map((windowInfo) => {
        const title =
          windowInfo && typeof windowInfo.title === "string"
            ? windowInfo.title.trim()
            : "";
        if (!title) {
          return null;
        }

        return {
          title,
          processId: Number(windowInfo.processId || 0) || null,
          displayIndex:
            windowInfo.displayIndex !== undefined &&
            windowInfo.displayIndex !== null
              ? Number(windowInfo.displayIndex)
              : null,
          displayId:
            windowInfo.displayId !== undefined && windowInfo.displayId !== null
              ? String(windowInfo.displayId)
              : "",
          captureCropX:
            windowInfo.captureCropX !== undefined && windowInfo.captureCropX !== null
              ? Number(windowInfo.captureCropX)
              : null,
          captureCropY:
            windowInfo.captureCropY !== undefined && windowInfo.captureCropY !== null
              ? Number(windowInfo.captureCropY)
              : null,
          captureCropWidth:
            windowInfo.captureCropWidth !== undefined &&
            windowInfo.captureCropWidth !== null
              ? Number(windowInfo.captureCropWidth)
              : null,
          captureCropHeight:
            windowInfo.captureCropHeight !== undefined &&
            windowInfo.captureCropHeight !== null
              ? Number(windowInfo.captureCropHeight)
              : null,
          x11WindowId:
            windowInfo.x11WindowId !== undefined && windowInfo.x11WindowId !== null
              ? String(windowInfo.x11WindowId)
              : "",
          x11Display:
            windowInfo.x11Display !== undefined && windowInfo.x11Display !== null
              ? String(windowInfo.x11Display)
              : "",
          score: this.scoreProjectorWindowTitle(title, sceneName)
        };
      })
      .filter((item) => item && item.score > 0)
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));

    return {
      sceneName: sceneName || null,
      windows: candidates
    };
  }

  async switchScene(sceneName) {
    if (!sceneName || typeof sceneName !== "string") {
      const error = new Error("sceneName is required.");
      error.code = "VALIDATION_ERROR";
      throw error;
    }
    return this.callWithCapability("SetCurrentProgramScene", {
      sceneName
    });
  }

  async openSourceProjector(request = {}) {
    const payload = this.normalizeProjectorRequest(request);
    if (!payload.sourceName && !payload.sourceUuid) {
      const error = new Error("sourceName or sourceUuid is required.");
      error.code = "VALIDATION_ERROR";
      throw error;
    }
    return this.callWithCapability("OpenSourceProjector", payload);
  }

  async openVideoMixProjector(request = {}) {
    const payload = this.normalizeProjectorRequest(request);
    if (!payload.videoMixType || typeof payload.videoMixType !== "string") {
      const error = new Error("videoMixType is required.");
      error.code = "VALIDATION_ERROR";
      throw error;
    }
    return this.callWithCapability("OpenVideoMixProjector", payload);
  }

  normalizeProjectorRequest(request = {}) {
    const payload = {};
    const {
      canvasUuid,
      monitorIndex,
      projectorGeometry,
      sourceName,
      sourceUuid,
      videoMixType
    } = request;

    if (canvasUuid !== undefined) {
      if (typeof canvasUuid !== "string" || !canvasUuid.trim()) {
        const error = new Error("canvasUuid must be a non-empty string.");
        error.code = "VALIDATION_ERROR";
        throw error;
      }
      payload.canvasUuid = canvasUuid.trim();
    }

    if (sourceName !== undefined) {
      if (typeof sourceName !== "string" || !sourceName.trim()) {
        const error = new Error("sourceName must be a non-empty string.");
        error.code = "VALIDATION_ERROR";
        throw error;
      }
      payload.sourceName = sourceName.trim();
    }

    if (sourceUuid !== undefined) {
      if (typeof sourceUuid !== "string" || !sourceUuid.trim()) {
        const error = new Error("sourceUuid must be a non-empty string.");
        error.code = "VALIDATION_ERROR";
        throw error;
      }
      payload.sourceUuid = sourceUuid.trim();
    }

    if (videoMixType !== undefined) {
      if (typeof videoMixType !== "string" || !videoMixType.trim()) {
        const error = new Error("videoMixType must be a non-empty string.");
        error.code = "VALIDATION_ERROR";
        throw error;
      }
      payload.videoMixType = videoMixType.trim();
    }

    if (monitorIndex !== undefined && projectorGeometry !== undefined) {
      const error = new Error(
        "monitorIndex and projectorGeometry are mutually exclusive."
      );
      error.code = "VALIDATION_ERROR";
      throw error;
    }

    if (monitorIndex !== undefined) {
      const parsedMonitorIndex = Number(monitorIndex);
      if (!Number.isInteger(parsedMonitorIndex) || parsedMonitorIndex < -1) {
        const error = new Error("monitorIndex must be an integer >= -1.");
        error.code = "VALIDATION_ERROR";
        throw error;
      }
      payload.monitorIndex = parsedMonitorIndex;
    }

    if (projectorGeometry !== undefined) {
      if (
        typeof projectorGeometry !== "string" ||
        !projectorGeometry.trim()
      ) {
        const error = new Error(
          "projectorGeometry must be a non-empty string."
        );
        error.code = "VALIDATION_ERROR";
        throw error;
      }
      payload.projectorGeometry = projectorGeometry.trim();
    }

    return payload;
  }

  scoreProjectorWindowTitle(title, sceneName) {
    const normalizedTitle = String(title || "").toLowerCase();
    const normalizedScene = String(sceneName || "").toLowerCase();
    let score = 0;

    if (normalizedTitle.includes("projector")) {
      score += 50;
    }
    if (normalizedTitle.includes("windowed")) {
      score += 10;
    }
    if (normalizedTitle.includes("scene")) {
      score += 5;
    }
    if (normalizedScene && normalizedTitle.includes(normalizedScene)) {
      score += 100;
    }

    return score;
  }

  listObsWindowsOnWindows() {
    const script = `
$obsPids = @(Get-Process obs64, obs -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
if (-not $obsPids -or $obsPids.Count -eq 0) {
  '[]'
  exit 0
}

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win32Enum {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

$results = New-Object System.Collections.Generic.List[object]
[Win32Enum]::EnumWindows({
  param($hWnd, $lParam)
  if (-not [Win32Enum]::IsWindowVisible($hWnd)) { return $true }
  $length = [Win32Enum]::GetWindowTextLength($hWnd)
  if ($length -le 0) { return $true }
  $pid = 0
  [void][Win32Enum]::GetWindowThreadProcessId($hWnd, [ref]$pid)
  if (-not ($obsPids -contains [int]$pid)) { return $true }
  $builder = New-Object System.Text.StringBuilder ($length + 1)
  [void][Win32Enum]::GetWindowText($hWnd, $builder, $builder.Capacity)
  $title = $builder.ToString()
  if (-not [string]::IsNullOrWhiteSpace($title)) {
    $results.Add([pscustomobject]@{
      title = $title
      processId = [int]$pid
    })
  }
  return $true
}, [IntPtr]::Zero) | Out-Null

$results | ConvertTo-Json -Compress
`.trim();

    const result = this.spawnSyncFn(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        windowsHide: true,
        encoding: "utf8",
        timeout: 5000
      }
    );

    if (result.error) {
      throw result.error;
    }

    const raw = String(result.stdout || "[]").trim() || "[]";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = [];
    }
    if (!Array.isArray(parsed)) {
      return parsed ? [parsed] : [];
    }
    return parsed;
  }

  listObsWindowsOnMac() {
    const script = `
ObjC.import('AppKit');
ObjC.import('CoreGraphics');

function unwrap(value) {
  return ObjC.deepUnwrap(value);
}

const windows = unwrap($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID));
const screens = unwrap($.NSScreen.screens).map((screen, index) => {
  const frame = unwrap(screen.frame);
  const description = unwrap(screen.deviceDescription);
  return {
    displayIndex: index,
    displayId: String(description.NSScreenNumber),
    x: Number(frame.origin.x),
    y: Number(frame.origin.y),
    width: Number(frame.size.width),
    height: Number(frame.size.height)
  };
});

function overlapArea(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

const result = windows
  .filter((entry) => entry.kCGWindowOwnerName === 'OBS' && entry.kCGWindowName)
  .map((entry) => {
    const bounds = entry.kCGWindowBounds || {};
    const windowRect = {
      x: Number(bounds.X || 0),
      y: Number(bounds.Y || 0),
      width: Number(bounds.Width || 0),
      height: Number(bounds.Height || 0)
    };
    const screen = screens
      .map((candidate) => ({
        candidate,
        overlap: overlapArea(windowRect, candidate)
      }))
      .sort((left, right) => right.overlap - left.overlap)[0];
    return {
      title: String(entry.kCGWindowName),
      processId: Number(entry.kCGWindowOwnerPID || 0),
      displayIndex: screen ? screen.candidate.displayIndex : null,
      displayId: screen ? screen.candidate.displayId : '',
      captureCropX: screen ? Math.max(0, windowRect.x - screen.candidate.x) : 0,
      captureCropY: screen ? Math.max(0, windowRect.y - screen.candidate.y) : 0,
      captureCropWidth: windowRect.width,
      captureCropHeight: windowRect.height
    };
  });

JSON.stringify(result);
`.trim();

    const result = this.spawnSyncFn(
      "osascript",
      ["-l", "JavaScript", "-e", script],
      {
        encoding: "utf8",
        timeout: 5000
      }
    );

    if (result.error) {
      throw result.error;
    }

    const raw = String(result.stdout || "[]").trim() || "[]";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = [];
    }
    if (!Array.isArray(parsed)) {
      return parsed ? [parsed] : [];
    }
    return parsed;
  }

  listObsWindowsOnLinux() {
    if (!process.env.DISPLAY) {
      const error = new Error(
        "Linux projector window discovery currently requires an X11 DISPLAY."
      );
      error.code = "OBS_UNSUPPORTED_REQUEST";
      throw error;
    }

    const result = this.spawnSyncFn(
      "bash",
      [
        "-lc",
        "if command -v wmctrl >/dev/null 2>&1; then wmctrl -lpG; else exit 0; fi"
      ],
      {
        encoding: "utf8",
        timeout: 5000
      }
    );

    if (result.error) {
      throw result.error;
    }

    const displayName = process.env.DISPLAY || ":0.0";
    return String(result.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(
          /^(0x[0-9a-fA-F]+)\s+\S+\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+\S+\s+(.+)$/
        );
        if (!match) {
          return null;
        }
        return {
          x11WindowId: match[1],
          processId: Number(match[2]),
          captureCropX: Number(match[3]),
          captureCropY: Number(match[4]),
          captureCropWidth: Number(match[5]),
          captureCropHeight: Number(match[6]),
          title: match[7],
          x11Display: displayName
        };
      })
      .filter(Boolean);
  }

  getProjectorCloseCapability(projectorRef = {}) {
    if (this.platform === "win32") {
      return projectorRef.projectorWindowTitle
        ? { supported: true, reason: null }
        : {
            supported: false,
            reason: "projector_window_title_missing"
          };
    }

    if (this.platform === "darwin") {
      return projectorRef.projectorWindowTitle
        ? { supported: true, reason: null }
        : {
            supported: false,
            reason: "projector_window_title_missing"
          };
    }

    if (this.platform === "linux") {
      if (!projectorRef.x11WindowId) {
        return {
          supported: false,
          reason: "x11_window_id_missing"
        };
      }
      if (!String(projectorRef.x11Display || process.env.DISPLAY || "").trim()) {
        return {
          supported: false,
          reason: "x11_display_missing"
        };
      }
      return { supported: true, reason: null };
    }

    return {
      supported: false,
      reason: "platform_not_supported"
    };
  }

  closeProjectorWindow(projectorRef = {}) {
    const capability = this.getProjectorCloseCapability(projectorRef);
    if (!capability.supported) {
      const error = new Error("Projector close is not supported for this target.");
      error.code = "OBS_UNSUPPORTED_REQUEST";
      error.details = [capability.reason].filter(Boolean);
      throw error;
    }

    if (this.platform === "darwin") {
      return this.closeProjectorWindowOnMac(projectorRef);
    }
    if (this.platform === "linux") {
      return this.closeProjectorWindowOnLinux(projectorRef);
    }
    return this.closeProjectorWindowOnWindows(projectorRef);
  }

  closeProjectorWindowOnWindows(projectorRef) {
    const script = `
$targetTitle = [string]$args[0]
if ([string]::IsNullOrWhiteSpace($targetTitle)) { exit 2 }

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win32Close {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
"@

$closed = $false
[Win32Close]::EnumWindows({
  param($hWnd, $lParam)
  if (-not [Win32Close]::IsWindowVisible($hWnd)) { return $true }
  $length = [Win32Close]::GetWindowTextLength($hWnd)
  if ($length -le 0) { return $true }
  $builder = New-Object System.Text.StringBuilder ($length + 1)
  [void][Win32Close]::GetWindowText($hWnd, $builder, $builder.Capacity)
  if ($builder.ToString() -eq $targetTitle) {
    [void][Win32Close]::PostMessage($hWnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    $script:closed = $true
    return $false
  }
  return $true
}, [IntPtr]::Zero) | Out-Null

if ($closed) { exit 0 }
exit 3
`.trim();

    const result = this.spawnSyncFn(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
        String(projectorRef.projectorWindowTitle || "")
      ],
      {
        windowsHide: true,
        encoding: "utf8",
        timeout: 5000
      }
    );

    return this.normalizeProjectorCloseResult(result, projectorRef);
  }

  closeProjectorWindowOnMac(projectorRef) {
    const script = `
on run argv
  set targetTitle to item 1 of argv
  tell application "System Events"
    tell application process "OBS"
      if exists window targetTitle then
        perform action "AXClose" of window targetTitle
        return "closed"
      end if
    end tell
  end tell
  return "not_found"
end run
`.trim();

    const result = this.spawnSyncFn(
      "osascript",
      ["-e", script, String(projectorRef.projectorWindowTitle || "")],
      {
        encoding: "utf8",
        timeout: 5000
      }
    );

    return this.normalizeProjectorCloseResult(result, projectorRef);
  }

  closeProjectorWindowOnLinux(projectorRef) {
    const env = {
      ...process.env,
      DISPLAY: projectorRef.x11Display || process.env.DISPLAY || ""
    };
    const result = this.spawnSyncFn(
      "wmctrl",
      ["-ic", String(projectorRef.x11WindowId || "")],
      {
        encoding: "utf8",
        timeout: 5000,
        env
      }
    );

    return this.normalizeProjectorCloseResult(result, projectorRef);
  }

  normalizeProjectorCloseResult(result, projectorRef) {
    if (result && result.error) {
      const error = new Error(result.error.message || "Projector close failed.");
      error.code =
        result.error.code === "ENOENT"
          ? "OBS_UNSUPPORTED_REQUEST"
          : "OBS_REQUEST_FAILED";
      error.details =
        result.error.code === "ENOENT" ? ["close_tool_not_available"] : [];
      throw error;
    }

    const status = Number(result && result.status);
    const stdout = String((result && result.stdout) || "").trim().toLowerCase();
    if (stdout === "not_found") {
      return {
        ok: true,
        closed: false,
        reason: "projector_window_not_found",
        projectorWindowTitle: projectorRef.projectorWindowTitle || "",
        x11WindowId: projectorRef.x11WindowId || ""
      };
    }
    if (status === 0) {
      return {
        ok: true,
        closed: true,
        projectorWindowTitle: projectorRef.projectorWindowTitle || "",
        x11WindowId: projectorRef.x11WindowId || ""
      };
    }

    if (status === 3) {
      return {
        ok: true,
        closed: false,
        reason: "projector_window_not_found",
        projectorWindowTitle: projectorRef.projectorWindowTitle || "",
        x11WindowId: projectorRef.x11WindowId || ""
      };
    }

    const message = String((result && result.stderr) || (result && result.stdout) || "")
      .trim() || "Projector close failed.";
    const error = new Error(message);
    error.code = "OBS_REQUEST_FAILED";
    throw error;
  }

  async callWithCapability(requestType, requestData = undefined) {
    if (!this.status.connected) {
      const error = new Error("OBS is not connected.");
      error.code = "OBS_NOT_CONNECTED";
      throw error;
    }

    try {
      return await this.obs.call(requestType, requestData);
    } catch (error) {
      const normalized = new Error(error.message || "OBS request failed.");
      normalized.cause = error;
      normalized.code = this.isUnsupportedError(error)
        ? "OBS_UNSUPPORTED_REQUEST"
        : "OBS_REQUEST_FAILED";
      throw normalized;
    }
  }

  isUnsupportedError(error) {
    const text = String(error && (error.message || error.code || "")).toLowerCase();
    return (
      text.includes("not found") ||
      text.includes("unknown request") ||
      text.includes("invalid request type") ||
      text.includes("unsupported")
    );
  }
}

module.exports = {
  ObsService
};
