#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle_root="$script_dir/../dist/linux-alpha/bundle"
checksums_file=""
include_external="0"

usage() {
  cat <<'EOF'
Usage: verify-unix-alpha.sh [--bundle-root <path>] [--checksums-file <path>] [--include-external]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle-root)
      bundle_root="$2"
      shift 2
      ;;
    --checksums-file)
      checksums_file="$2"
      shift 2
      ;;
    --include-external)
      include_external="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[verify] Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

bundle_root="$(cd "$bundle_root" && pwd)"
if [[ -z "$checksums_file" ]]; then
  if [[ -f "$bundle_root/checksums.bundle.sha256" ]]; then
    checksums_file="$bundle_root/checksums.bundle.sha256"
  elif [[ -f "$(dirname "$bundle_root")/checksums.sha256" ]]; then
    checksums_file="$(dirname "$bundle_root")/checksums.sha256"
  else
    echo "[verify] No checksum manifest found." >&2
    exit 1
  fi
fi

checksums_file="$(cd "$(dirname "$checksums_file")" && pwd)/$(basename "$checksums_file")"
if [[ ! -f "$checksums_file" ]]; then
  echo "[verify] Checksum manifest not found: $checksums_file" >&2
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

manifest_dir="$(dirname "$checksums_file")"
checked_count=0

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  if [[ ! "$line" =~ ^[0-9A-Fa-f]{64}\ \*.+$ ]]; then
    echo "[verify] Invalid manifest line: $line" >&2
    exit 1
  fi

  expected_hash="${line%% *}"
  relative_path="${line#* *}"
  relative_path="${relative_path#\*}"

  bundle_candidate="$bundle_root/$relative_path"
  external_candidate="$manifest_dir/$relative_path"

  if [[ -f "$bundle_candidate" ]]; then
    target="$bundle_candidate"
  elif [[ -f "$external_candidate" ]]; then
    if [[ "$include_external" != "1" ]]; then
      continue
    fi
    target="$external_candidate"
  else
    echo "[verify] Missing file: $bundle_candidate" >&2
    exit 1
  fi

  actual_hash="$(hash_file "$target")"
  if [[ "${actual_hash,,}" != "${expected_hash,,}" ]]; then
    echo "[verify] Hash mismatch: $target" >&2
    echo "[verify] expected=${expected_hash,,}" >&2
    echo "[verify] actual=${actual_hash,,}" >&2
    exit 1
  fi

  checked_count=$((checked_count + 1))
done < "$checksums_file"

echo "[verify] Manifest: $(basename "$checksums_file")"
echo "[verify] Bundle root: $bundle_root"
echo "[verify] Checked files: $checked_count"
echo "[verify] Status: OK"
