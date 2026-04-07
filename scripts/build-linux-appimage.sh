#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
bundle_dir=""
output_dir=""
app_version=""
metadata_path=""

usage() {
  cat <<'EOF'
Usage: build-linux-appimage.sh --bundle-dir <path> --output-dir <path> --app-version <version> [--metadata-path <path>]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle-dir)
      bundle_dir="$2"
      shift 2
      ;;
    --output-dir)
      output_dir="$2"
      shift 2
      ;;
    --app-version)
      app_version="$2"
      shift 2
      ;;
    --metadata-path)
      metadata_path="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[appimage] Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$bundle_dir" || -z "$output_dir" || -z "$app_version" ]]; then
  usage
  exit 1
fi

bundle_dir="$(cd "$bundle_dir" && pwd)"
output_dir="$(mkdir -p "$output_dir" && cd "$output_dir" && pwd)"
if [[ -z "$metadata_path" ]]; then
  metadata_path="$output_dir/appimage-metadata.json"
fi

artifact_file="laive-obs-linux-alpha.AppImage"
artifact_path="$output_dir/$artifact_file"
appdir="$output_dir/appimage-root/AppDir"

resolve_appimagetool() {
  if [[ -n "${LAIVE_APPIMAGETOOL_PATH:-}" && -f "$LAIVE_APPIMAGETOOL_PATH" ]]; then
    echo "$LAIVE_APPIMAGETOOL_PATH"
    return
  fi

  if command -v appimagetool >/dev/null 2>&1; then
    command -v appimagetool
    return
  fi

  local downloaded="$output_dir/appimagetool-x86_64.AppImage"
  local url="https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
  echo "[appimage] Downloading appimagetool..." >&2
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$downloaded"
  else
    wget -q "$url" -O "$downloaded"
  fi
  chmod +x "$downloaded"
  echo "$downloaded"
}

hash_file() {
  local path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  else
    shasum -a 256 "$path" | awk '{print $1}'
  fi
}

rm -rf "$output_dir/appimage-root"
mkdir -p "$appdir/usr/share/laive-obs" "$appdir/usr/bin"

cp -R "$bundle_dir/." "$appdir/usr/share/laive-obs/"

cat > "$appdir/usr/bin/laive-obs" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir/../share/laive-obs"
npm run dev:desktop
EOF
chmod +x "$appdir/usr/bin/laive-obs"

cat > "$appdir/AppRun" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec "$APPDIR/usr/bin/laive-obs" "$@"
EOF
chmod +x "$appdir/AppRun"

cat > "$appdir/laive-obs.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=LAIVE OBS
Exec=laive-obs
Icon=laive-obs
Categories=AudioVideo;Video;
Comment=LAIVE OBS Standalone Hybrid
Terminal=true
EOF

cat > "$appdir/laive-obs.png.base64" <<'EOF'
iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAQAAAAAYLlVAAAArElEQVR4Ae3VMQ6CMBAF0H2i3q6X6qY8g0y0g0F0g0x3WfV8QxZQjzvJrWc4Y9f4YQAAAAAAAAAA4GfV5v6b7w6n0r8i0mU6sYwQv8x8p3YJr7iF3o7S7qv+Xw7m4lHcQ0u8m5i5L4x9m8WJQn2b8x8f4Lx0s4y6Zp+f0V8d6b8Qm0Xg1JQ2s4S7n2dYj6m0qWz8m2oXr4j2b4Y6XnQe9n6c6l2c+0V4j5N7E7m8J7H8eKk9n1l7wAAAAAAAAAA4M8B2n6f4S8nqN0AAAAASUVORK5CYII=
EOF
base64 -d "$appdir/laive-obs.png.base64" > "$appdir/laive-obs.png"
rm -f "$appdir/laive-obs.png.base64"
cp "$appdir/laive-obs.png" "$appdir/.DirIcon"

appimagetool_bin="$(resolve_appimagetool)"
echo "[appimage] Building AppImage with: $appimagetool_bin"
ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 "$appimagetool_bin" "$appdir" "$artifact_path" >/dev/null

if [[ ! -f "$artifact_path" ]]; then
  echo "[appimage] AppImage output not found: $artifact_path" >&2
  exit 1
fi

artifact_sha256="$(hash_file "$artifact_path")"
cat > "$metadata_path" <<EOF
{
  "generatedAtUtc": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "artifactFile": "$artifact_file",
  "artifactPath": "$artifact_path",
  "artifactSha256": "${artifact_sha256,,}",
  "appVersion": "$app_version",
  "engine": {
    "type": "appimagetool",
    "binary": "$appimagetool_bin"
  }
}
EOF

echo "[appimage] Built: $artifact_path"
echo "[appimage] Metadata: $metadata_path"
