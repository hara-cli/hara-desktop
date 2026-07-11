#!/usr/bin/env bash
# Post-CI asset merge: overwrite the release's UNSIGNED CI mac artifacts with the locally signed +
# notarized ones, and patch latest.json's darwin signatures to match. Run AFTER both:
#   1. scripts/build-mac-signed.sh succeeded locally
#   2. the tag's CI run fully completed (earlier: later CI jobs rewrite latest.json)
# Usage: scripts/release-mac-assets.sh v0.1.3
set -euo pipefail
cd "$(dirname "$0")/.."
TAG="${1:?usage: release-mac-assets.sh <tag>}"
REPO="hara-cli/hara-desktop"
B=src-tauri/target/release/bundle
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

VER="${TAG#v}"
[ -f "$B/dmg/Hara_${VER}_aarch64.dmg" ] || { echo "no local signed dmg for $VER — run build-mac-signed.sh first"; exit 1; }
# HARD GATE 2: the local dmg must be stapled (fully notarized). A build that died mid-way (e.g. the
# notary upload timed out) leaves a signed-but-unnotarized dmg — shipping it regresses Gatekeeper
# (caught live on v0.1.8, where a `| tail` pipe also masked the build's failure exit).
xcrun stapler validate "$B/dmg/Hara_${VER}_aarch64.dmg" >/dev/null 2>&1 || { echo "local dmg is NOT stapled — the signed build didn't finish (re-run build-mac-signed.sh)"; exit 1; }

# HARD GATE: the tag's CI must be fully done — a still-running mac job will re-upload its unsigned
# artifacts AFTER our clobber and silently undo the merge (caught live on v0.1.5).
CI_STATE=$(gh run list -R "$REPO" --branch "$TAG" --limit 1 --json status,conclusion -q '.[0].status+" "+.[0].conclusion' 2>/dev/null || echo "unknown")
case "$CI_STATE" in
  "completed success") ;;
  "completed "*) echo "CI for $TAG completed with: $CI_STATE — fix CI first"; exit 1 ;;
  *) echo "CI for $TAG is '$CI_STATE' — wait for it to finish, then re-run"; exit 1 ;;
esac

# gh upload's `file#label` only sets a display label — the ASSET NAME is the basename, so copy first
cp "$B/macos/Hara.app.tar.gz" "$WORK/Hara_aarch64.app.tar.gz"
cp "$B/macos/Hara.app.tar.gz.sig" "$WORK/Hara_aarch64.app.tar.gz.sig"

gh release upload "$TAG" "$B/dmg/Hara_${VER}_aarch64.dmg" "$WORK/Hara_aarch64.app.tar.gz" "$WORK/Hara_aarch64.app.tar.gz.sig" --clobber -R "$REPO"

cd "$WORK"
gh release download "$TAG" -p latest.json -R "$REPO" --clobber
python3 - << 'EOF'
import json
sig = open('Hara_aarch64.app.tar.gz.sig').read().strip()
d = json.load(open('latest.json'))
for k in ('darwin-aarch64', 'darwin-aarch64-app'):
    if k in d['platforms']:
        d['platforms'][k]['signature'] = sig
        print('patched', k)
json.dump(d, open('latest.json', 'w'), indent=2)
EOF
gh release upload "$TAG" latest.json --clobber -R "$REPO"

# public end-to-end check: the artifact users actually download must pass Gatekeeper
curl -sL -o pub-check.dmg "https://github.com/$REPO/releases/download/$TAG/Hara_${VER}_aarch64.dmg"
spctl -a -t open --context context:primary-signature -v pub-check.dmg
echo "✓ $TAG mac assets signed + merged + publicly verified"
