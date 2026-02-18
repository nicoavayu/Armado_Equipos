#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_DIR="$ROOT_DIR/.secrets"

ANDROID_SRC="$SECRETS_DIR/firebase/google-services.json"
ANDROID_DEST="$ROOT_DIR/android/app/google-services.json"

IOS_SRC="$SECRETS_DIR/firebase/GoogleService-Info.plist"
IOS_DEST="$ROOT_DIR/ios/App/App/GoogleService-Info.plist"

copied=0

if [[ -f "$ANDROID_SRC" ]]; then
  cp "$ANDROID_SRC" "$ANDROID_DEST"
  echo "[sync_mobile_secrets] Copied Android Firebase config -> $ANDROID_DEST"
  copied=$((copied + 1))
else
  echo "[sync_mobile_secrets] Missing: $ANDROID_SRC"
fi

if [[ -f "$IOS_SRC" ]]; then
  cp "$IOS_SRC" "$IOS_DEST"
  echo "[sync_mobile_secrets] Copied iOS Firebase config -> $IOS_DEST"
  copied=$((copied + 1))
else
  echo "[sync_mobile_secrets] Missing: $IOS_SRC"
fi

if [[ "$copied" -eq 0 ]]; then
  echo "[sync_mobile_secrets] No secrets copied."
else
  echo "[sync_mobile_secrets] Done. Files copied: $copied"
fi
