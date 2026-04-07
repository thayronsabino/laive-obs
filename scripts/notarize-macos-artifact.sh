#!/usr/bin/env bash
set -euo pipefail

artifact=""
metadata_path=""

usage() {
  cat <<'EOF'
Usage: notarize-macos-artifact.sh --artifact <path> [--metadata-path <path>]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact)
      artifact="$2"
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
      echo "[macos-notary] Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$artifact" ]]; then
  usage
  exit 1
fi

artifact="$(cd "$(dirname "$artifact")" && pwd)/$(basename "$artifact")"
if [[ ! -f "$artifact" ]]; then
  echo "[macos-notary] Artifact not found: $artifact" >&2
  exit 1
fi

if [[ -z "$metadata_path" ]]; then
  metadata_path="$(dirname "$artifact")/macos-notarization-metadata.json"
fi

true_like() {
  local value="${1:-}"
  value="$(echo "$value" | tr '[:upper:]' '[:lower:]' | xargs)"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "on" ]]
}

requested="false"
if true_like "${LAIVE_ENABLE_MACOS_NOTARIZATION:-0}" || true_like "${LAIVE_REQUIRE_NOTARIZED_MACOS:-0}" || [[ -n "${LAIVE_MACOS_SIGN_IDENTITY:-}" || -n "${LAIVE_MACOS_NOTARY_PROFILE:-}" ]]; then
  requested="true"
fi

require_notarized="false"
if true_like "${LAIVE_REQUIRE_NOTARIZED_MACOS:-0}"; then
  require_notarized="true"
fi

status="not-requested"
signed="false"
notarized="false"
stapled="false"
note="Notarization not requested."

if [[ "$requested" == "false" ]]; then
  cat > "$metadata_path" <<EOF
{
  "generatedAtUtc": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "artifact": "$artifact",
  "status": "$status",
  "requested": false,
  "signed": false,
  "notarized": false,
  "stapled": false,
  "note": "$note",
  "signIdentity": null,
  "notaryProfile": null
}
EOF
  echo "[macos-notary] $note"
  exit 0
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "[macos-notary] xcrun is required for macOS notarization." >&2
  exit 1
fi

if [[ -n "${LAIVE_MACOS_SIGN_IDENTITY:-}" ]]; then
  echo "[macos-notary] Signing artifact with codesign..."
  codesign --force --timestamp --sign "$LAIVE_MACOS_SIGN_IDENTITY" "$artifact"
  signed="true"
  status="signed"
  note="Artifact signed."
else
  note="No LAIVE_MACOS_SIGN_IDENTITY configured."
  if [[ "$require_notarized" == "true" ]]; then
    echo "[macos-notary] $note" >&2
    exit 1
  fi
fi

if [[ -n "${LAIVE_MACOS_NOTARY_PROFILE:-}" ]]; then
  echo "[macos-notary] Submitting artifact to Apple notary service..."
  xcrun notarytool submit "$artifact" --keychain-profile "$LAIVE_MACOS_NOTARY_PROFILE" --wait
  notarized="true"
  status="notarized"
  note="Artifact notarized."

  echo "[macos-notary] Stapling notarization ticket..."
  xcrun stapler staple "$artifact"
  stapled="true"

  echo "[macos-notary] Verifying stapled ticket..."
  xcrun stapler validate "$artifact"
else
  note="No LAIVE_MACOS_NOTARY_PROFILE configured."
  if [[ "$require_notarized" == "true" ]]; then
    echo "[macos-notary] $note" >&2
    exit 1
  fi
fi

if [[ "$require_notarized" == "true" && "$notarized" != "true" ]]; then
  echo "[macos-notary] LAIVE_REQUIRE_NOTARIZED_MACOS enabled but artifact was not notarized." >&2
  exit 1
fi

sign_identity_json="null"
if [[ -n "${LAIVE_MACOS_SIGN_IDENTITY:-}" ]]; then
  sign_identity_json="\"$LAIVE_MACOS_SIGN_IDENTITY\""
fi

notary_profile_json="null"
if [[ -n "${LAIVE_MACOS_NOTARY_PROFILE:-}" ]]; then
  notary_profile_json="\"$LAIVE_MACOS_NOTARY_PROFILE\""
fi

cat > "$metadata_path" <<EOF
{
  "generatedAtUtc": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "artifact": "$artifact",
  "status": "$status",
  "requested": true,
  "signed": $signed,
  "notarized": $notarized,
  "stapled": $stapled,
  "note": "$note",
  "signIdentity": $sign_identity_json,
  "notaryProfile": $notary_profile_json
}
EOF

echo "[macos-notary] Metadata: $metadata_path"
