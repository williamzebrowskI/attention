#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL_UID="${1:-a7ca8c3c19894af789ac948c4d98b78c}"
TARGET_DIR="$ROOT_DIR/app/static/assets/models/starship/imported"
MANIFEST_PATH="$ROOT_DIR/app/static/assets/models/starship/model_manifest.json"

if [[ -z "${SKETCHFAB_TOKEN:-}" ]]; then
  echo "SKETCHFAB_TOKEN is required."
  echo "Create a Sketchfab API token and rerun:"
  echo "  SKETCHFAB_TOKEN=... ./scripts/import_starship_sketchfab.sh [model_uid]"
  exit 1
fi

echo "Fetching model metadata for uid: $MODEL_UID"
MODEL_JSON="$(curl -fsSL --max-time 30 "https://api.sketchfab.com/v3/models/${MODEL_UID}")"
VIEWER_URL="$(echo "$MODEL_JSON" | jq -r '.viewerUrl // empty')"

echo "Requesting downloadable archives..."
DOWNLOAD_JSON="$(curl -fsSL --max-time 30 \
  -H "Authorization: Token ${SKETCHFAB_TOKEN}" \
  "https://api.sketchfab.com/v3/models/${MODEL_UID}/download")"

GLB_URL="$(echo "$DOWNLOAD_JSON" | jq -r '.glb.url // empty')"
GLTF_URL="$(echo "$DOWNLOAD_JSON" | jq -r '.gltf.url // empty')"

ARCHIVE_URL=""
FORMAT=""
if [[ -n "$GLB_URL" ]]; then
  ARCHIVE_URL="$GLB_URL"
  FORMAT="glb"
elif [[ -n "$GLTF_URL" ]]; then
  ARCHIVE_URL="$GLTF_URL"
  FORMAT="gltf"
else
  echo "No downloadable GLB/GLTF archive found for this model."
  echo "Try another uid or verify your token has access."
  exit 1
fi

TMP_ARCHIVE="/tmp/starship_${MODEL_UID}_${FORMAT}.zip"
echo "Downloading ${FORMAT} archive..."
curl -fL --max-time 120 "$ARCHIVE_URL" -o "$TMP_ARCHIVE"

echo "Extracting to $TARGET_DIR"
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"
unzip -q -o "$TMP_ARCHIVE" -d "$TARGET_DIR"

MODEL_FILE=""
if [[ "$FORMAT" == "glb" ]]; then
  MODEL_FILE="$(find "$TARGET_DIR" -type f -name '*.glb' | head -n 1 || true)"
fi
if [[ -z "$MODEL_FILE" ]]; then
  MODEL_FILE="$(find "$TARGET_DIR" -type f -name '*.gltf' | head -n 1 || true)"
  FORMAT="gltf"
fi

if [[ -z "$MODEL_FILE" ]]; then
  echo "Could not find .glb or .gltf in extracted archive."
  exit 1
fi

MODEL_RELATIVE="${MODEL_FILE#"$ROOT_DIR/app/static"}"
MODEL_URL="/static${MODEL_RELATIVE}"
TEXTURE_MAX_RES="$(echo "$MODEL_JSON" | jq -r '.archives.glb.textureMaxResolution // .archives.gltf.textureMaxResolution // 0')"
if ! [[ "$TEXTURE_MAX_RES" =~ ^[0-9]+$ ]]; then
  TEXTURE_MAX_RES=0
fi

cat > "$MANIFEST_PATH" <<EOF
{
  "enabled": true,
  "url": "${MODEL_URL}",
  "format": "${FORMAT}",
  "source": "Sketchfab",
  "model_uid": "${MODEL_UID}",
  "texture_max_resolution": ${TEXTURE_MAX_RES}
}
EOF

echo
echo "Imported model:"
echo "  UID: $MODEL_UID"
echo "  URL: $MODEL_URL"
echo "  Manifest: $MANIFEST_PATH"
echo "  Viewer: $VIEWER_URL"
