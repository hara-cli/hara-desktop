#!/bin/bash
# Private material exists only in this build subprocess and its child. Never source this file.
set +x
set -eu
UPDATER_KEYCHAIN_SERVICE=com.nanhara.hara.updater-signing
UPDATER_KEYCHAIN_ACCOUNT=desktop-updater
if [ "$#" -eq 0 ]; then echo "error: missing updater build command" >&2; exit 2; fi
unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD TAURI_SIGNING_PRIVATE_KEY_PATH
trap 'unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD TAURI_SIGNING_PRIVATE_KEY_PATH' EXIT HUP INT TERM
if ! TAURI_SIGNING_PRIVATE_KEY="$(/usr/bin/security find-generic-password -s "$UPDATER_KEYCHAIN_SERVICE" -a "$UPDATER_KEYCHAIN_ACCOUNT" -w 2>/dev/null)" || [ -z "$TAURI_SIGNING_PRIVATE_KEY" ]; then
  echo "error: updater signing credential unavailable in Keychain; no plaintext fallback" >&2
  exit 1
fi
export TAURI_SIGNING_PRIVATE_KEY
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
"$@"
