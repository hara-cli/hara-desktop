#!/usr/bin/env bash
# Refresh the bundled hara sidecar from ../hara-cli (clean build + version stamp).
# Part of the two-repo workflow (see WORKFLOW.md). Warns if hara-cli has uncommitted changes.
set -euo pipefail
cd "$(dirname "$0")/.."
CLI="../hara-cli"
[ -d "$CLI" ] || { echo "hara-cli not found at $CLI"; exit 1; }

if [ -n "$(git -C "$CLI" status --porcelain)" ]; then
  echo "⚠️  hara-cli working tree is DIRTY — the sidecar will include uncommitted changes."
  echo "    (another session's WIP? stash it targeted: git stash push -- <files>)"
fi

echo "▸ building hara single-file binary…"
(cd "$CLI" && npm run build:binary >/dev/null)

TRIPLE="$(rustc -vV 2>/dev/null | awk '/^host/{print $2}')"
TRIPLE="${TRIPLE:-aarch64-apple-darwin}"
mkdir -p src-tauri/binaries
cp "$CLI/dist/bin/hara" "src-tauri/binaries/hara-$TRIPLE"

VER="$("src-tauri/binaries/hara-$TRIPLE" --version)"
echo "$VER" > src-tauri/binaries/SIDECAR_VERSION
echo "✓ sidecar refreshed: hara $VER → src-tauri/binaries/hara-$TRIPLE"
