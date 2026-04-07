# FFmpeg Infra (MVP v0.1)

This folder centralizes FFmpeg runtime assumptions for the standalone architecture.

## Runtime contract
- `FFMPEG_BIN` points to the executable used by `apps/core-service`.
- If not defined, resolver tries: `PATH` -> Winget install path -> common Chocolatey/Scoop paths.

## Healthcheck
```bash
npm run ffmpeg:healthcheck
```

## Profiles
- `profiles.json` documents baseline argument profiles:
  - `defaultInherit`: stream copy (inherits OBS master)
  - `bitrateOverride`: transcode with bitrate override per destination
