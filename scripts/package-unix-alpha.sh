#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
platform=""

usage() {
  cat <<'EOF'
Usage: package-unix-alpha.sh --platform <macos|linux>
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)
      platform="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[pack-unix] Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "$platform" != "macos" && "$platform" != "linux" ]]; then
  echo "[pack-unix] --platform must be macos or linux." >&2
  exit 1
fi

hash_file() {
  local path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  else
    shasum -a 256 "$path" | awk '{print $1}'
  fi
}

true_like() {
  local value="${1:-}"
  value="$(echo "$value" | tr '[:upper:]' '[:lower:]' | xargs)"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "on" ]]
}

append_checksum() {
  local path="$1"
  local checksums_out="$2"
  local file_name
  file_name="$(basename "$path")"
  local hash
  hash="$(hash_file "$path")"
  printf "%s *%s\n" "${hash,,}" "$file_name" >> "$checksums_out"
}

write_checksums() {
  local root_dir="$1"
  local out_file="$2"
  : > "$out_file"
  while IFS= read -r file; do
    local rel="${file#$root_dir/}"
    local hash
    hash="$(hash_file "$file")"
    printf "%s *%s\n" "${hash,,}" "$rel" >> "$out_file"
  done < <(find "$root_dir" -type f | LC_ALL=C sort)
}

out_root="$repo_root/dist/${platform}-alpha"
bundle_dir="$out_root/bundle"
checksums_path="$out_root/checksums.sha256"
bundle_checksums_path="$bundle_dir/checksums.bundle.sha256"
metadata_path="$out_root/build-metadata.json"

echo "[pack-unix] Cleaning output: $out_root"
rm -rf "$out_root"
mkdir -p "$bundle_dir"

echo "[pack-unix] Installing dependencies..."
cd "$repo_root"
npm ci
package_name="$(node -p "require('./package.json').name")"
package_version="$(node -p "require('./package.json').version")"

echo "[pack-unix] Copying runtime files..."
paths_to_copy=(
  "apps"
  "infra"
  "scripts/run-e2e-tests.ps1"
  "scripts/run-e2e-soak-tests.ps1"
  "scripts/run-quality-local.ps1"
  "scripts/verify-windows-alpha.ps1"
  "scripts/verify-unix-alpha.sh"
  "scripts/verify-authenticode-signature.ps1"
  "scripts/sign-windows-alpha-artifact.ps1"
  "scripts/build-windows-installer.ps1"
  "scripts/build-linux-appimage.sh"
  "scripts/notarize-macos-artifact.sh"
  "package.json"
  "package-lock.json"
  ".gitignore"
  "docs/MVP_IMPLEMENTATION.md"
  "docs/E2E_VALIDATION.md"
)

for entry in "${paths_to_copy[@]}"; do
  source_path="$repo_root/$entry"
  if [[ -e "$source_path" ]]; then
    cp -R "$source_path" "$bundle_dir/"
  fi
done

echo "[pack-unix] Writing startup and verify scripts..."
cat > "$bundle_dir/start-laive-obs.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
npm run dev:desktop
EOF
chmod +x "$bundle_dir/start-laive-obs.sh"

cat > "$bundle_dir/verify-bundle.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ -x "./scripts/verify-unix-alpha.sh" ]]; then
  verifier="./scripts/verify-unix-alpha.sh"
else
  verifier="./verify-unix-alpha.sh"
fi
"$verifier" --bundle-root "$(pwd)" --checksums-file "$(pwd)/checksums.bundle.sha256"
EOF
chmod +x "$bundle_dir/verify-bundle.sh"

echo "[pack-unix] Writing checksums..."
write_checksums "$bundle_dir" "$bundle_checksums_path"
write_checksums "$bundle_dir" "$checksums_path"

artifact_file=""
artifact_type=""
artifact_sha256=""
macos_notary_metadata=""
appimage_metadata=""
appimage_file=""
appimage_sha256=""
macos_notary_metadata_file=""
linux_appimage_metadata_file=""

if [[ "$platform" == "macos" ]]; then
  if ! command -v hdiutil >/dev/null 2>&1; then
    echo "[pack-unix] hdiutil is required for macos packaging." >&2
    exit 1
  fi
  artifact_file="laive-obs-macos-alpha.dmg"
  artifact_type="dmg"
  artifact_path="$out_root/$artifact_file"
  echo "[pack-unix] Creating DMG..."
  hdiutil create -volname "LAIVE OBS Alpha" -srcfolder "$bundle_dir" -ov -format UDZO "$artifact_path" >/dev/null

  macos_notary_metadata="$out_root/macos-notarization-metadata.json"
  macos_notary_metadata_file="$(basename "$macos_notary_metadata")"
  echo "[pack-unix] Running optional macOS notarization flow..."
  bash "$repo_root/scripts/notarize-macos-artifact.sh" --artifact "$artifact_path" --metadata-path "$macos_notary_metadata"
else
  if ! command -v dpkg-deb >/dev/null 2>&1; then
    echo "[pack-unix] dpkg-deb is required for linux packaging." >&2
    exit 1
  fi
  artifact_file="laive-obs-linux-alpha.deb"
  artifact_type="deb"
  artifact_path="$out_root/$artifact_file"
  package_root="$out_root/deb-root"
  rm -rf "$package_root"
  mkdir -p "$package_root/DEBIAN" "$package_root/opt/laive-obs" "$package_root/usr/local/bin"
  cp -R "$bundle_dir/." "$package_root/opt/laive-obs/"
  cat > "$package_root/usr/local/bin/laive-obs" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/laive-obs
npm run dev:desktop
EOF
  chmod +x "$package_root/usr/local/bin/laive-obs"
  package_version="$(node -p "require('./package.json').version" | tr '-' '~')"
  cat > "$package_root/DEBIAN/control" <<EOF
Package: laive-obs
Version: $package_version
Section: video
Priority: optional
Architecture: amd64
Maintainer: LAIVE <contato@laive.app>
Description: LAIVE OBS Standalone Hybrid Alpha
EOF
  echo "[pack-unix] Creating DEB..."
  dpkg-deb --build "$package_root" "$artifact_path" >/dev/null
  rm -rf "$package_root"

  build_appimage="${LAIVE_BUILD_LINUX_APPIMAGE:-1}"
  if true_like "$build_appimage"; then
    echo "[pack-unix] Building AppImage..."
    appimage_metadata="$out_root/appimage-metadata.json"
    linux_appimage_metadata_file="$(basename "$appimage_metadata")"
    bash "$repo_root/scripts/build-linux-appimage.sh" \
      --bundle-dir "$bundle_dir" \
      --output-dir "$out_root" \
      --app-version "$package_version" \
      --metadata-path "$appimage_metadata"
    appimage_file="laive-obs-linux-alpha.AppImage"
  fi
fi

artifact_sha256="$(hash_file "$artifact_path")"
append_checksum "$artifact_path" "$checksums_path"
if [[ -n "$appimage_file" && -f "$out_root/$appimage_file" ]]; then
  appimage_sha256="$(hash_file "$out_root/$appimage_file")"
  append_checksum "$out_root/$appimage_file" "$checksums_path"
fi

echo "[pack-unix] Verifying bundle integrity..."
bash "$repo_root/scripts/verify-unix-alpha.sh" --bundle-root "$bundle_dir" --checksums-file "$bundle_checksums_path"

echo "[pack-unix] Verifying package integrity..."
bash "$repo_root/scripts/verify-unix-alpha.sh" --bundle-root "$bundle_dir" --checksums-file "$checksums_path" --include-external

node_version="$(node -v)"
npm_version="$(npm -v)"

cat > "$metadata_path" <<EOF
{
  "generatedAtUtc": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "packageName": "$package_name",
  "packageVersion": "$package_version",
  "platform": "${platform}-alpha",
  "nodeVersion": "$node_version",
  "npmVersion": "$npm_version",
  "artifactFile": "$artifact_file",
  "artifactType": "$artifact_type",
  "artifactSha256": "${artifact_sha256,,}",
  "appImageFile": "${appimage_file:-}",
  "appImageSha256": "${appimage_sha256:-}",
  "macosNotarizationMetadataFile": "${macos_notary_metadata_file:-}",
  "linuxAppImageMetadataFile": "${linux_appimage_metadata_file:-}",
  "bundleChecksumsFile": "$(basename "$bundle_checksums_path")",
  "checksumsFile": "$(basename "$checksums_path")"
}
EOF

echo "[pack-unix] Done."
echo "[pack-unix] Bundle: $bundle_dir"
echo "[pack-unix] Artifact: $artifact_path"
echo "[pack-unix] Checksums: $checksums_path"
echo "[pack-unix] Metadata: $metadata_path"
