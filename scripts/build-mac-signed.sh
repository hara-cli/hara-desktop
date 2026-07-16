#!/usr/bin/env bash
# Signed + notarized macOS release build — controlled Apple Silicon release machine only. The
# Developer ID certificate and private key live in the dedicated hara-ci-signing keychain; ordinary
# Hara startup never accesses it. CI mac builds stay unsigned until protected promotion replaces them.
#
# Chain: verify and rebuild the sidecar from the clean, exactly tagged CLI source → tauri build with
#   • APPLE_SIGNING_IDENTITY  — Developer ID signing (config stays identity-free so CI doesn't break)
#   • APPLE_API_*             — notarytool submits + staples the .app automatically
#   • TAURI_SIGNING_PRIVATE_KEY(+empty password) — updater .sig artifacts
# → then notarize + staple the DMG CONTAINER itself (tauri only notarizes the app inside).
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=scripts/release-shell-safety.sh
source scripts/release-shell-safety.sh

CODESIGN_KEYCHAIN="${HARA_CODESIGN_KEYCHAIN:-$HOME/Library/Keychains/hara-ci-signing.keychain-db}"
CODESIGN_PASSWORD_FILE="${HARA_CODESIGN_KEYCHAIN_PASSWORD_FILE:-$HOME/.tauri/hara-codesign-keychain.password}"
CODESIGN_KEYCHAIN_UNLOCKED=0
CODESIGN_PROBE_DIR=""
KEYCHAIN_LIST_CHANGED=0
ORIGINAL_KEYCHAINS=()
ORIGINAL_KEYCHAIN_COUNT=0
SIGNED_BUILD_COMPLETED=0
clear_signing_environment() {
  unset APPLE_SIGNING_IDENTITY APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH
  unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  unset HARA_CODESIGN_KEYCHAIN_PASSWORD
  if [ -n "$CODESIGN_PROBE_DIR" ]; then
    rm -rf "$CODESIGN_PROBE_DIR"
    CODESIGN_PROBE_DIR=""
  fi
  if [ "$KEYCHAIN_LIST_CHANGED" = "1" ] && [ "$ORIGINAL_KEYCHAIN_COUNT" -gt 0 ]; then
    security list-keychains -d user -s "${ORIGINAL_KEYCHAINS[@]}" >/dev/null 2>&1 || true
    KEYCHAIN_LIST_CHANGED=0
  fi
  if [ "$CODESIGN_KEYCHAIN_UNLOCKED" = "1" ]; then
    security lock-keychain "$CODESIGN_KEYCHAIN" >/dev/null 2>&1 || true
    CODESIGN_KEYCHAIN_UNLOCKED=0
  fi
}
trap 'hara_exit_with_cleanup "${SIGNED_BUILD_COMPLETED:-0}" clear_signing_environment' EXIT

# Fail before touching signing material when a login shell resolves an old Node, an unpinned Bun,
# or the Intel Rust toolchain on an Apple Silicon release machine.
# shellcheck source=scripts/check-build-toolchain.sh
source scripts/check-build-toolchain.sh
hara_check_build_toolchain
npm run check:release

DESKTOP_VERSION="$(node -p 'require("./package.json").version')"
DESKTOP_TAG="v$DESKTOP_VERSION"
[ -z "$(git status --porcelain)" ] || {
  echo "error: signed release builds require a clean hara-desktop worktree" >&2
  git status --short >&2
  exit 1
}
DESKTOP_TAG_COMMIT="$(git rev-parse -q --verify "refs/tags/$DESKTOP_TAG^{commit}" 2>/dev/null || true)"
[ -n "$DESKTOP_TAG_COMMIT" ] || {
  echo "error: signed release builds require the local desktop tag $DESKTOP_TAG" >&2
  exit 1
}
DESKTOP_COMMIT="$(git rev-parse HEAD)"
[ "$DESKTOP_COMMIT" = "$DESKTOP_TAG_COMMIT" ] || {
  echo "error: hara-desktop HEAD ($DESKTOP_COMMIT) does not match $DESKTOP_TAG ($DESKTOP_TAG_COMMIT)" >&2
  exit 1
}
REMOTE_DESKTOP_TAGS="$(git ls-remote --tags origin "refs/tags/$DESKTOP_TAG" "refs/tags/$DESKTOP_TAG^{}")" || {
  echo "error: could not read remote desktop tag $DESKTOP_TAG" >&2
  exit 1
}
REMOTE_DESKTOP_COMMIT="$(awk -v direct="refs/tags/$DESKTOP_TAG" -v peeled="refs/tags/$DESKTOP_TAG^{}" '
  $2 == peeled { peeled_commit = $1 }
  $2 == direct { direct_commit = $1 }
  END { print peeled_commit ? peeled_commit : direct_commit }
' <<<"$REMOTE_DESKTOP_TAGS")"
[ "$REMOTE_DESKTOP_COMMIT" = "$DESKTOP_COMMIT" ] || {
  echo "error: local desktop $DESKTOP_TAG ($DESKTOP_COMMIT) does not match origin ($REMOTE_DESKTOP_COMMIT)" >&2
  exit 1
}

HOST_TARGET="$(rustc -vV | awk '/^host:/{print $2}')"
if [ "$HOST_TARGET" != "aarch64-apple-darwin" ]; then
  echo "error: this controlled signing flow requires the stable arm64 Rust toolchain; detected $HOST_TARGET" >&2
  echo "       Select it with: rustup default stable-aarch64-apple-darwin" >&2
  exit 1
fi

TARGET="${HARA_MAC_TARGET:-aarch64-apple-darwin}"
unset TAURI_TARGET
case "$TARGET" in
  aarch64-apple-darwin)
    RELEASE_BASE="src-tauri/target/release"
    DMG_ARCH="aarch64"
    MACHO_ARCH="arm64"
    ;;
  x86_64-apple-darwin)
    [ "${HARA_ALLOW_ROSETTA_SMOKE:-}" = "1" ] || {
      echo "error: x86_64 signing on Apple Silicon requires HARA_ALLOW_ROSETTA_SMOKE=1" >&2
      echo "       CI release smoke remains native on macos-15-intel." >&2
      exit 1
    }
    /usr/bin/arch -x86_64 /usr/bin/true >/dev/null 2>&1 || {
      echo "error: Rosetta 2 is required to execute the x86_64 release sidecar on Apple Silicon" >&2
      exit 1
    }
    RELEASE_BASE="src-tauri/target/$TARGET/release"
    DMG_ARCH="x64"
    MACHO_ARCH="x86_64"
    export TAURI_TARGET="$TARGET"
    ;;
  *)
    echo "error: unsupported HARA_MAC_TARGET: $TARGET" >&2
    echo "       Allowed: aarch64-apple-darwin or x86_64-apple-darwin" >&2
    exit 1
    ;;
esac
PROVENANCE_RUN="${GITHUB_RUN_ID:-local}"
PROVENANCE_DIR="${HARA_RELEASE_PROVENANCE_DIR:-${RUNNER_TEMP:-$PWD/src-tauri/target}/hara-release-provenance/$PROVENANCE_RUN/$DESKTOP_TAG}"
# A failed architecture build must never leave a marker that lets promotion consume stale output
# from an earlier attempt on the persistent signing runner.
rm -f "$PROVENANCE_DIR/hara-release-provenance-$TARGET.json"

command -v rustup >/dev/null 2>&1 || {
  echo "error: rustup is required to verify the installed release target" >&2
  exit 1
}
INSTALLED_RUST_TARGETS="$(rustup target list --installed)"
grep -Fxq "$TARGET" <<<"$INSTALLED_RUST_TARGETS" || {
  echo "error: Rust target $TARGET is not installed" >&2
  echo "       Install it with: rustup target add $TARGET" >&2
  exit 1
}

if [ -n "${SKIP_SIDECAR:-}" ]; then
  echo "error: SKIP_SIDECAR is not allowed for a signed release build" >&2
  echo "       The sidecar must be rebuilt from the clean hara-cli tag matching SIDECAR_VERSION." >&2
  exit 1
fi

IDENTITY="Developer ID Application: Wuxi Nanhara Technologies Co., Ltd. (4GMBSXJ67T)"
P8="$HOME/.tauri/asc-key-LPV3VLR842.p8"
KEY_ID="LPV3VLR842"
ISSUER="69a6de87-a919-47e3-e053-5b8c7c11a4d1"

[ -f "$P8" ] || { echo "missing notary key $P8"; exit 1; }
[ -f "$CODESIGN_KEYCHAIN" ] || {
  echo "dedicated codesigning keychain is missing: $CODESIGN_KEYCHAIN" >&2
  exit 1
}
[ -f "$CODESIGN_PASSWORD_FILE" ] || {
  echo "local codesigning keychain password is missing: $CODESIGN_PASSWORD_FILE" >&2
  exit 1
}
[ "$(stat -f '%Lp' "$CODESIGN_PASSWORD_FILE")" = "600" ] || {
  echo "local codesigning keychain password must have mode 600: $CODESIGN_PASSWORD_FILE" >&2
  exit 1
}
CODESIGN_PASSWORD="$(tr -d '\r\n' < "$CODESIGN_PASSWORD_FILE")"
[ -n "$CODESIGN_PASSWORD" ] || {
  echo "local codesigning keychain password is empty: $CODESIGN_PASSWORD_FILE" >&2
  exit 1
}
security unlock-keychain -p "$CODESIGN_PASSWORD" "$CODESIGN_KEYCHAIN"
unset CODESIGN_PASSWORD HARA_CODESIGN_KEYCHAIN_PASSWORD
CODESIGN_KEYCHAIN_UNLOCKED=1
security set-keychain-settings -lut 21600 "$CODESIGN_KEYCHAIN"

append_original_keychain() {
  local candidate="$1"
  [ -f "$candidate" ] || return 0
  local existing index
  for ((index = 0; index < ORIGINAL_KEYCHAIN_COUNT; index += 1)); do
    existing="${ORIGINAL_KEYCHAINS[$index]}"
    [ "$existing" = "$candidate" ] && return 0
  done
  ORIGINAL_KEYCHAINS[$ORIGINAL_KEYCHAIN_COUNT]="$candidate"
  ORIGINAL_KEYCHAIN_COUNT=$((ORIGINAL_KEYCHAIN_COUNT + 1))
}

while IFS= read -r keychain; do
  keychain="${keychain#*\"}"
  keychain="${keychain%\"*}"
  [ -n "$keychain" ] && append_original_keychain "$keychain"
done < <(security list-keychains -d user)

# Ignore malformed stale search-list entries and retain the normal local keychains when present.
# This also repairs lists polluted by an earlier incorrectly quoted `security list-keychains -s` call.
append_original_keychain "$HOME/Library/Keychains/login.keychain-db"
append_original_keychain "$HOME/Library/Keychains/VIP.UserKeychain.1.0.0-503-db"
SEARCH_KEYCHAINS=("$CODESIGN_KEYCHAIN")
for ((index = 0; index < ORIGINAL_KEYCHAIN_COUNT; index += 1)); do
  keychain="${ORIGINAL_KEYCHAINS[$index]}"
  [ "$keychain" = "$CODESIGN_KEYCHAIN" ] || SEARCH_KEYCHAINS+=("$keychain")
done
security list-keychains -d user -s "${SEARCH_KEYCHAINS[@]}"
KEYCHAIN_LIST_CHANGED=1
if ! IDENTITIES="$(security find-identity -v -p codesigning "$CODESIGN_KEYCHAIN" 2>&1)"; then
  echo "unable to inspect codesigning identities" >&2
  echo "$IDENTITIES" >&2
  exit 1
fi
case "$IDENTITIES" in
  *"$IDENTITY"*) ;;
  *) echo "Developer ID cert not in keychain: $IDENTITY" >&2; exit 1 ;;
esac
# Enumeration alone does not prove that a non-interactive Actions worker may use the private key.
# Sign an ephemeral executable before spending time on either build; dry-run against a sealed system
# binary can itself fail inside Apple's signing subsystem and is therefore not a reliable probe.
CODESIGN_PROBE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hara-codesign-probe.XXXXXX")"
cp /usr/bin/true "$CODESIGN_PROBE_DIR/probe"
codesign --force --options runtime --timestamp --keychain "$CODESIGN_KEYCHAIN" \
  --sign "$IDENTITY" "$CODESIGN_PROBE_DIR/probe" >/dev/null
codesign --verify --strict "$CODESIGN_PROBE_DIR/probe"
rm -rf "$CODESIGN_PROBE_DIR"
CODESIGN_PROBE_DIR=""

EXPECTED_SIDECAR_VERSION="$(tr -d '[:space:]' < src-tauri/binaries/SIDECAR_VERSION)"
HARA_RELEASE_BUILD=1 HARA_SIDECAR_TARGET="$TARGET" ./scripts/refresh-sidecar.sh
CLI_COMMIT="$(git -C ../hara-cli rev-parse "refs/tags/v$EXPECTED_SIDECAR_VERSION^{commit}")"

# Bun standalone binaries carry a linker-generated ad-hoc signature. Tauri's nested-binary signer
# cannot reliably replace that signature with a timestamped Developer ID signature in one pass
# (codesign reports "A timestamp was expected but was not found"). Normalize the sidecar first.
SIDECAR="src-tauri/binaries/hara-$TARGET"
[ -f "$SIDECAR" ] || { echo "missing sidecar $SIDECAR"; exit 1; }

# refresh-sidecar already executed the compiler output while Bun's valid linker-generated ad-hoc
# signature was still attached. Apple Silicon refuses to execute an entirely unsigned arm64 Mach-O,
# so never run the sidecar in the gap between removing that signature and applying Developer ID.
echo "▸ replacing Bun ad-hoc signature with Developer ID"
codesign --remove-signature "$SIDECAR"
codesign --force --options runtime --timestamp --keychain "$CODESIGN_KEYCHAIN" \
  --sign "$IDENTITY" "$SIDECAR"
codesign --verify --strict --verbose=2 "$SIDECAR"
echo "▸ validating Developer ID signed sidecar"
node scripts/sidecar-smoke.mjs "$SIDECAR" "$EXPECTED_SIDECAR_VERSION" "$TARGET"

# dmg-bundling traps: failed Tauri builds can leave either /Volumes/Hara* or a random /Volumes/dmg.*
# mounted, with the writable image in bundle/macos (older Tauri) or bundle/dmg (newer Tauri).
for v in /Volumes/Hara* /Volumes/dmg.*; do
  [ -d "$v" ] || continue
  # Only detach random dmg.* volumes that are clearly prior Hara bundles.
  case "$v" in
    /Volumes/Hara*) ;;
    /Volumes/dmg.*) [ -d "$v/Hara.app" ] || continue ;;
  esac
  hdiutil detach "$v" -force >/dev/null 2>&1 || {
    echo "error: could not detach stale Hara build volume: $v" >&2
    exit 1
  }
done
rm -f "$RELEASE_BASE"/bundle/dmg/rw.*.dmg \
  "$RELEASE_BASE"/bundle/macos/rw.*.dmg

export APPLE_SIGNING_IDENTITY="$IDENTITY"
export APPLE_API_KEY="$KEY_ID" APPLE_API_ISSUER="$ISSUER" APPLE_API_KEY_PATH="$P8"
TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/hara-desktop.key")"
export TAURI_SIGNING_PRIVATE_KEY
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

if [ "$TARGET" = "x86_64-apple-darwin" ]; then
  npm run tauri build -- --target "$TARGET"
else
  npm run tauri build
fi
clear_signing_environment

echo "▸ validating packaged application and bundled sidecar"
HARA_REQUIRE_MAC_SIGNATURES=1 node scripts/package-smoke.mjs
APP="$RELEASE_BASE/bundle/macos/Hara.app"
APP_SHELL="$APP/Contents/MacOS/hara-desktop"
APP_ARCHS="$(/usr/bin/lipo -archs "$APP_SHELL")"
case " $APP_ARCHS " in
  *" $MACHO_ARCH "*) ;;
  *) echo "error: packaged app architecture mismatch: expected $MACHO_ARCH, found ${APP_ARCHS:-unknown}" >&2; exit 1 ;;
esac
codesign --verify --deep --strict --verbose=2 "$APP"

DMG="$RELEASE_BASE/bundle/dmg/Hara_${DESKTOP_VERSION}_${DMG_ARCH}.dmg"
[ -f "$DMG" ] || { echo "expected $DMG_ARCH dmg missing: $DMG" >&2; exit 1; }
echo "▸ notarizing dmg container: $DMG"
xcrun notarytool submit "$DMG" --key "$P8" --key-id "$KEY_ID" --issuer "$ISSUER" --wait
xcrun stapler staple "$DMG"
spctl -a -t open --context context:primary-signature -v "$DMG"
spctl -a -vv "$APP"
node scripts/mac-dmg-smoke.mjs "$DMG" "$TARGET" --require-signatures
[ -z "$(git status --porcelain)" ] && [ "$(git rev-parse HEAD)" = "$DESKTOP_COMMIT" ] || {
  echo "error: hara-desktop source changed during the signed release build" >&2
  exit 1
}
node scripts/release-provenance.mjs write \
  "$RELEASE_BASE/bundle" "$PROVENANCE_DIR" "$TARGET" "$DESKTOP_TAG" "$DESKTOP_COMMIT" "$CLI_COMMIT"
echo "✓ signed + notarized: $DMG"
SIGNED_BUILD_COMPLETED=1
