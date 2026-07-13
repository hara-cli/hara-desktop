#!/usr/bin/env bash
# Signed + notarized macOS release build — Jeff's machine only (Developer ID cert lives in the login
# keychain; CI mac builds stay unsigned until the cert goes to GH secrets, if ever).
#
# Chain: refresh sidecar (optional SKIP_SIDECAR=1) → tauri build with
#   • APPLE_SIGNING_IDENTITY  — Developer ID signing (config stays identity-free so CI doesn't break)
#   • APPLE_API_*             — notarytool submits + staples the .app automatically
#   • TAURI_SIGNING_PRIVATE_KEY(+empty password) — updater .sig artifacts
# → then notarize + staple the DMG CONTAINER itself (tauri only notarizes the app inside).
set -euo pipefail
cd "$(dirname "$0")/.."

IDENTITY="Developer ID Application: Wuxi Nanhara Technologies Co., Ltd. (4GMBSXJ67T)"
P8="$HOME/.tauri/asc-key-LPV3VLR842.p8"
KEY_ID="LPV3VLR842"
ISSUER="69a6de87-a919-47e3-e053-5b8c7c11a4d1"

[ -f "$P8" ] || { echo "missing notary key $P8"; exit 1; }
security find-identity -v -p codesigning | grep -q "Developer ID Application" || { echo "Developer ID cert not in keychain"; exit 1; }

[ "${SKIP_SIDECAR:-}" = "1" ] || ./scripts/refresh-sidecar.sh

# Bun standalone binaries carry a linker-generated ad-hoc signature. Tauri's nested-binary signer
# cannot reliably replace that signature with a timestamped Developer ID signature in one pass
# (codesign reports "A timestamp was expected but was not found"). Normalize the sidecar first.
SIDECAR="src-tauri/binaries/hara-$(rustc -vV | awk '/^host:/{print $2}')"
[ -f "$SIDECAR" ] || { echo "missing sidecar $SIDECAR"; exit 1; }
codesign --remove-signature "$SIDECAR"
codesign --force --options runtime --timestamp --sign "$IDENTITY" "$SIDECAR"
"$SIDECAR" --version

# dmg-bundling traps: a mounted Hara volume or stale rw image makes bundle_dmg.sh flake
for v in /Volumes/Hara*; do [ -d "$v" ] && hdiutil detach "$v" -force 2>/dev/null || true; done
rm -f src-tauri/target/release/bundle/dmg/rw.*.dmg

export APPLE_SIGNING_IDENTITY="$IDENTITY"
export APPLE_API_KEY="$KEY_ID" APPLE_API_ISSUER="$ISSUER" APPLE_API_KEY_PATH="$P8"
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/hara-desktop.key")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

npm run tauri build

DMG=$(ls src-tauri/target/release/bundle/dmg/Hara_*_aarch64.dmg | tail -1)
echo "▸ notarizing dmg container: $DMG"
xcrun notarytool submit "$DMG" --key "$P8" --key-id "$KEY_ID" --issuer "$ISSUER" --wait
xcrun stapler staple "$DMG"
spctl -a -t open --context context:primary-signature -v "$DMG"
spctl -a -vv src-tauri/target/release/bundle/macos/Hara.app
echo "✓ signed + notarized: $DMG"
