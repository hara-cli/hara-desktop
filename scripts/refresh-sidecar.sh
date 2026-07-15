#!/usr/bin/env bash
# Refresh the bundled hara sidecar from ../hara-cli. Development mode builds the working tree and
# warns when dirty. HARA_RELEASE_BUILD=1 builds a disposable detached worktree from the exact local
# + origin-matching v<SIDECAR_VERSION> tag, so unrelated developer files can never enter a release.
set -euo pipefail
cd "$(dirname "$0")/.."
CLI="../hara-cli"
[ "$(git -C "$CLI" rev-parse --is-inside-work-tree 2>/dev/null || true)" = "true" ] || {
  echo "hara-cli repository not found at $CLI" >&2
  exit 1
}

# shellcheck source=scripts/check-build-toolchain.sh
source scripts/check-build-toolchain.sh
hara_check_build_toolchain

TRIPLE="${HARA_SIDECAR_TARGET:-$(rustc -vV 2>/dev/null | awk '/^host:/{print $2}')}"
case "$TRIPLE" in
  aarch64-apple-darwin)      BUN_TARGET=bun-darwin-arm64 ;;
  x86_64-apple-darwin)       BUN_TARGET=bun-darwin-x64-baseline ;;
  aarch64-unknown-linux-gnu) BUN_TARGET=bun-linux-arm64 ;;
  x86_64-unknown-linux-gnu)  BUN_TARGET=bun-linux-x64-baseline ;;
  x86_64-pc-windows-msvc)    BUN_TARGET=bun-windows-x64-baseline ;;
  *) echo "unsupported sidecar target: $TRIPLE" >&2; exit 1 ;;
esac

VERSION_STAMP_FILE="src-tauri/binaries/SIDECAR_VERSION"
COMMIT_STAMP_FILE="src-tauri/binaries/SIDECAR_COMMIT"
BUILD_CLI="$CLI"
RELEASE_WORKTREE=""
RELEASE_WORKTREE_ROOT=""

cleanup_release_worktree() {
  if [ -n "$RELEASE_WORKTREE" ] && [ -d "$RELEASE_WORKTREE" ]; then
    git -C "$CLI" worktree remove --force "$RELEASE_WORKTREE" >/dev/null 2>&1 || true
  fi
  if [ -n "$RELEASE_WORKTREE_ROOT" ] && [ -d "$RELEASE_WORKTREE_ROOT" ]; then
    rm -rf "$RELEASE_WORKTREE_ROOT"
  fi
}
trap cleanup_release_worktree EXIT

if [ "${HARA_RELEASE_BUILD:-0}" = "1" ]; then
  [ -f "$VERSION_STAMP_FILE" ] && [ -f "$COMMIT_STAMP_FILE" ] || {
    echo "error: release sidecar version/commit stamps are missing" >&2
    exit 1
  }
  EXPECTED="$(tr -d '[:space:]' < "$VERSION_STAMP_FILE")"
  EXPECTED_COMMIT="$(tr -d '[:space:]' < "$COMMIT_STAMP_FILE")"
  [[ "$EXPECTED" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || {
    echo "error: invalid release SIDECAR_VERSION: ${EXPECTED:-<empty>}" >&2
    exit 1
  }
  [[ "$EXPECTED_COMMIT" =~ ^[0-9a-f]{40}$ ]] || {
    echo "error: invalid release SIDECAR_COMMIT: ${EXPECTED_COMMIT:-<empty>}" >&2
    exit 1
  }
  TAG="v$EXPECTED"
  TAG_COMMIT="$(git -C "$CLI" rev-parse -q --verify "refs/tags/$TAG^{commit}" 2>/dev/null || true)"
  [ -n "$TAG_COMMIT" ] || {
    echo "error: release sidecar requires the local hara-cli tag $TAG" >&2
    exit 1
  }
  [ "$TAG_COMMIT" = "$EXPECTED_COMMIT" ] || {
    echo "error: local hara-cli $TAG resolves to $TAG_COMMIT, locked Desktop source is $EXPECTED_COMMIT" >&2
    exit 1
  }
  REMOTE_TAGS="$(git -C "$CLI" ls-remote --tags origin "refs/tags/$TAG" "refs/tags/$TAG^{}")" || {
    echo "error: could not read remote hara-cli tag $TAG" >&2
    exit 1
  }
  REMOTE_TAG_COMMIT="$(awk -v direct="refs/tags/$TAG" -v peeled="refs/tags/$TAG^{}" '
    $2 == peeled { peeled_commit = $1 }
    $2 == direct { direct_commit = $1 }
    END { print peeled_commit ? peeled_commit : direct_commit }
  ' <<<"$REMOTE_TAGS")"
  [ "$REMOTE_TAG_COMMIT" = "$TAG_COMMIT" ] || {
    echo "error: local hara-cli $TAG ($TAG_COMMIT) does not match origin ($REMOTE_TAG_COMMIT)" >&2
    exit 1
  }

  RELEASE_WORKTREE_ROOT="$(mktemp -d)"
  RELEASE_WORKTREE="$RELEASE_WORKTREE_ROOT/hara-cli"
  git -C "$CLI" worktree add --quiet --detach "$RELEASE_WORKTREE" "$TAG_COMMIT"
  BUILD_CLI="$RELEASE_WORKTREE"
  TAG_VERSION="$(node -p 'require(process.argv[1]).version' "$BUILD_CLI/package.json")"
  [ "$TAG_VERSION" = "$EXPECTED" ] || {
    echo "error: $TAG package version is $TAG_VERSION, expected $EXPECTED" >&2
    exit 1
  }
  [ -z "$(git -C "$BUILD_CLI" status --porcelain)" ] || {
    echo "error: disposable release worktree is unexpectedly dirty" >&2
    exit 1
  }
  echo "✓ release sidecar source verified: detached clean $TAG at $TAG_COMMIT (origin matches)"
  SOURCE_COMMIT="$TAG_COMMIT"
else
  EXPECTED="$(node -p 'require(process.argv[1]).version' "$CLI/package.json")"
  SOURCE_COMMIT="$(git -C "$CLI" rev-parse HEAD)"
  CLI_STATUS="$(git -C "$CLI" status --porcelain)"
  if [ -n "$CLI_STATUS" ]; then
    echo "⚠️  hara-cli working tree is DIRTY — this development sidecar will include working-tree code."
    echo "    Formal builds ignore it and use a disposable worktree from the stamped release tag."
    SOURCE_COMMIT="dirty-$SOURCE_COMMIT"
  fi
fi

OUT="$BUILD_CLI/dist/bin/hara-refresh"
EXT=""
[[ "$TRIPLE" == *windows* ]] && EXT=".exe"

build_sidecar_binary() {
  local attempt
  for attempt in 1 2 3; do
    rm -f "$OUT" "$OUT.exe"
    if (cd "$BUILD_CLI" && bun scripts/build-binary.ts "dist/bin/hara-refresh" "$BUN_TARGET" >/dev/null); then
      return 0
    fi
    [ "$attempt" -lt 3 ] || {
      echo "error: sidecar compilation failed after $attempt attempts" >&2
      return 1
    }
    echo "warning: sidecar compilation attempt $attempt failed; retrying a possibly incomplete Bun target download" >&2
    sleep $((attempt * 5))
  done
}

echo "▸ building hara $EXPECTED standalone sidecar ($TRIPLE, Bun $(bun --version))…"
if [ "${HARA_RELEASE_BUILD:-0}" = "1" ]; then
  (cd "$BUILD_CLI" && npm ci >/dev/null && npm run build >/dev/null)
else
  (cd "$BUILD_CLI" && npm run build >/dev/null)
fi
build_sidecar_binary

if [ "${HARA_RELEASE_BUILD:-0}" = "1" ]; then
  POST_STATUS="$(git -C "$BUILD_CLI" status --porcelain)"
  POST_VERSION="$(node -p 'require(process.argv[1]).version' "$BUILD_CLI/package.json")"
  POST_HEAD="$(git -C "$BUILD_CLI" rev-parse HEAD)"
  [ -z "$POST_STATUS" ] || {
    echo "error: detached hara-cli worktree became dirty while building" >&2
    git -C "$BUILD_CLI" status --short >&2
    exit 1
  }
  [ "$POST_VERSION" = "$EXPECTED" ] || {
    echo "error: tagged hara-cli package version changed while building: $EXPECTED -> $POST_VERSION" >&2
    exit 1
  }
  [ "$POST_HEAD" = "$TAG_COMMIT" ] || {
    echo "error: detached hara-cli HEAD changed while building: $TAG_COMMIT -> $POST_HEAD" >&2
    exit 1
  }
fi

mkdir -p src-tauri/binaries
cp "$OUT$EXT" "src-tauri/binaries/hara-$TRIPLE$EXT"
node scripts/sidecar-smoke.mjs "src-tauri/binaries/hara-$TRIPLE$EXT" "$EXPECTED" "$TRIPLE"
printf '%s\n' "$EXPECTED" > "$VERSION_STAMP_FILE"
printf '%s\n' "$SOURCE_COMMIT" > "$COMMIT_STAMP_FILE"
echo "✓ sidecar refreshed: hara $EXPECTED@$SOURCE_COMMIT → src-tauri/binaries/hara-$TRIPLE$EXT"
