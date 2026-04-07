# LAIVE Core Service (MVP v0.1-alpha)

Local service responsible for:
- REST API + WebSocket event stream
- OBS websocket integration
- RTMP ingest endpoint (local)
- FFmpeg orchestration for fan-out destinations (`rtmp`, `rtmps`, `srt`, `rist`, `whip`)
- Encrypted local persistence for stream keys

## Local run
```bash
npm install
npm run dev:core
```

Service defaults:
- API: `http://127.0.0.1:4800`
- Event stream: `ws://127.0.0.1:4800/events`
- RTMP ingest: `rtmp://127.0.0.1:1935/live/master`

## Main endpoints
- `GET /health`
- `GET /api/auth/status`
- `POST /api/auth/bootstrap`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET|POST|PATCH|DELETE /api/destinations`
- `POST /api/destinations/reorder`
- `POST /api/destinations/:id/projector/open`
- `POST /api/destinations/:id/projector/detect`
- `POST /api/destinations/:id/projector/validate`
- `GET /api/destinations/:id/projector/preview.jpg`
- `GET /api/projectors/managed`
- `POST /api/projectors/reopen-managed`
- `POST /api/projectors/managed/:destinationId/reopen`
- `POST /api/projectors/managed/:destinationId/close`
- `DELETE /api/projectors/managed/:destinationId`
- `GET /api/transmission/readiness`
- `POST /api/streams/start-all`
- `POST /api/streams/stop-all`
- `POST /api/streams/:id/start`
- `POST /api/streams/:id/stop`
- `GET /api/obs/status`
- `GET /api/obs/scenes`
- `GET /api/obs/monitors`
- `GET /api/obs/projector-windows`
- `POST /api/obs/scene/switch`
- `POST /api/obs/projectors/source`
- `POST /api/obs/projectors/video-mix`
- `POST /api/obs/stream/start|stop`
- `POST /api/obs/record/start|stop`
- `GET /api/status`
- `GET /api/metrics`
- `GET /api/diagnostics`
- `GET /api/diagnostics/export`
- `GET /api/logs/recent?limit=200`
- `GET /api/logs/export?limit=1000`
- `GET /api/support-bundle/export?limit=2000`
- `GET /api/settings/network`
- `PATCH /api/settings/network`

## Destination payload
`POST /api/destinations` and `PATCH /api/destinations/:id` accept:

- `name`
- `protocol`: `rtmp | rtmps | srt | rist | whip`
- `serverUrl`
- `streamKey`
  - required for `rtmp` and `rtmps`
  - optional for `srt`, `rist` and `whip`
- `outputMode`: `inherit | custom`
- `videoSourceMode`: `master_ingest | scene_projector_capture`
- `sceneBinding`
- `bitrateKbps`
- `videoProfile`
- `audioProfile`
- `syncWithObsStart`
- `syncWithObsStop`

Protocol notes:
- `rtmp` and `rtmps` publish as `flv` and append `streamKey` to `serverUrl`
- `srt` and `rist` publish as `mpegts`
- `whip` publishes through FFmpeg's experimental `whip` muxer with low-latency H.264 + Opus defaults

OBS projector notes:
- `GET /api/obs/monitors` returns the monitor list reported by OBS
- `GET /api/obs/projector-windows?sceneName=...` discovers visible OBS projector windows on Windows and ranks likely matches
- `POST /api/obs/projectors/source` forwards to OBS `OpenSourceProjector`
- `POST /api/obs/projectors/video-mix` forwards to OBS `OpenVideoMixProjector`
- `POST /api/destinations/:id/projector/open` opens the configured scene projector for a destination
- `POST /api/destinations/:id/projector/detect` opens the destination projector, scans visible OBS windows on Windows and autobinds the title when there is a single match
- `POST /api/destinations/:id/projector/validate` runs a short FFmpeg probe against the configured scene capture target and returns platform-aware guidance when capture is not ready
- `GET /api/destinations/:id/projector/preview.jpg` returns a one-frame JPEG preview of the configured scene capture target
- `GET /api/projectors/managed` lists projectors currently tracked by LAIVE OBS in the running process
- `POST /api/projectors/reopen-managed` reopens all tracked projectors
- `POST /api/projectors/managed/:destinationId/reopen` reopens a single tracked projector
- `POST /api/projectors/managed/:destinationId/close` attempts a best-effort close of a managed projector window using the local platform windowing path
- `DELETE /api/projectors/managed/:destinationId` forgets a tracked projector from LAIVE OBS runtime state
- managed projector entries now expose whether `close` is supported for the current platform/binding
- this is the base automation path for future standalone `cena fixa por destino`; in OBS, scenes are projectable as sources

Custom video profile notes:
- `videoCodec` accepts `copy`, `libx264`, `h264_amf`, `h264_nvenc`, `h264_qsv`, `h264_videotoolbox`, `h264_vaapi`
- `fps` keeps the current absolute override behavior
- `fpsDenominator` supports the plugin-style reduced framerate mode (`1` to `4`) when `fps` is not set
- `bFrames` accepts values from `0` to `16`
- when `videoSourceMode = scene_projector_capture`, the current implementation supports:
  - Windows: `windows_window_title` via `gdigrab`
  - macOS: `darwin_display_crop` via `avfoundation` + crop
  - Linux X11: `linux_x11_window_id` via `x11grab`
- in all three cases, audio continues coming from the master ingest
- scene projector starts are now prevalidated with a short FFmpeg capture probe before the destination pipeline is spawned
- macOS requires Screen Recording / Accessibility permission so the projector window can be discovered and captured
- Linux currently targets X11 (`DISPLAY`) and projector discovery uses `wmctrl`; pure Wayland sessions are now detected explicitly and reported with guidance instead of failing silently

Custom audio profile notes:
- `inputTrackIndex` selects the primary audio track from the ingest source
- `vodTrackInputIndex` optionally maps an extra audio track for protocols that can carry multiple tracks (`srt`/`rist`)
- with the current RTMP master ingest, most OBS workflows still expose a single incoming audio track
- `GET /api/transmission/readiness` runs an on-demand readiness report for all destinations, including source probe via FFprobe, projector validation and audio track availability checks

## Environment variables
- `LAIVE_API_PORT` (default `4800`)
- `LAIVE_API_BIND_ADDRESS` (default `127.0.0.1`)
- `LAIVE_RTMP_PORT` (default `1935`)
- `LAIVE_RTMP_APP` (default `live`)
- `LAIVE_RTMP_STREAM_KEY` (default `master`)
- `OBS_WS_URL` (default `ws://127.0.0.1:4455`)
- `OBS_WS_PASSWORD` (default empty)
- `FFMPEG_BIN` (optional override; auto-detected from PATH/Winget/common Windows locations)
- `FFPROBE_BIN` (optional override; auto-detected from PATH or from the FFmpeg sibling binary)
- `LAIVE_SECRET_SEED` (optional encryption seed override)
- `LAIVE_SECURE_COOKIES` (`1|true|yes|on` forces `Secure` on auth cookies)
- `LAIVE_AUTH_RATE_LIMIT_MAX` (max auth attempts per client/window for `/api/auth/bootstrap` and `/api/auth/login`, default `20`; `0` disables)
- `LAIVE_AUTH_RATE_LIMIT_WINDOW_MS` (auth rate-limit window in milliseconds, default `60000`)
- `LAIVE_WS_ALLOWED_ORIGINS` (comma-separated websocket origins allowed for `/events`; empty = no origin filtering)
- `LAIVE_OBS_ENABLED` (`0` disables OBS websocket integration)
- `LAIVE_INGEST_ENABLED` (`0` disables RTMP ingest service)
- `LAIVE_LOG_DIR` (structured logs directory)
- `LAIVE_LOG_LEVEL` (`debug|info|warn|error`)
- `LAIVE_LOG_MAX_BYTES` (max bytes before rotating `core.ndjson`)
- `LAIVE_LOG_MAX_FILES` (max rotated archive files, default `5`)
- `LAIVE_FFMPEG_RETRY_BASE_MS` (retry base delay)
- `LAIVE_FFMPEG_RETRY_MAX_MS` (retry max delay)
- `LAIVE_FFMPEG_RETRY_JITTER_RATIO` (retry jitter ratio, default `0.25`)
- `LAIVE_FFMPEG_CONNECT_TIMEOUT_MS` (watchdog timeout while connecting)
- `LAIVE_FFMPEG_STOP_GRACE_MS` (grace period before force-kill during stop, default `5000`)
- `LAIVE_FFMPEG_STALL_TIMEOUT_MS` (timeout sem progresso para considerar pipeline estagnado, default `45000`)
- `LAIVE_FFMPEG_STALL_MONITOR_INTERVAL_MS` (intervalo de varredura do watchdog de estagnacao, default `5000`)
- `LAIVE_SESSION_TTL_SEC` (TTL da sessao autenticada em segundos, default `1800`)

## Security notes
- If `LAIVE_SECRET_SEED` is not defined, the service generates and persists a local random seed in `<dataDir>/.secret-seed`.
- Existing encrypted data remains readable through backward-compatible legacy key fallback during migration.
