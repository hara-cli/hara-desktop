#!/usr/bin/env bash
# Replace the hidden draft's unsigned CI Mac assets with BOTH controlled, signed/notarized builds,
# regenerate latest.json from their exact signatures, re-download and verify the complete draft,
# then (and only then) promote it to stable.
#
# Invoked only by build.yml's protected signing job after the same tag-triggered workflow assembles
# the verified draft and runs both signed builds. Direct local promotion is intentionally rejected.
set -euo pipefail
cd "$(dirname "$0")/.."

TAG="${1:?usage: release-mac-assets.sh <tag>}"
REPO="hara-cli/hara-desktop"
RELEASE_POLICY_TOKEN="${HARA_RELEASE_POLICY_TOKEN:-}"
unset HARA_RELEASE_POLICY_TOKEN
RELEASE_GH_TOKEN="${GH_TOKEN:-}"
unset GH_TOKEN
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "error: stable promotion requires a vX.Y.Z tag: $TAG" >&2
  exit 1
}
[ "${GITHUB_ACTIONS:-}" = "true" ] &&
  [ "${GITHUB_REPOSITORY:-}" = "$REPO" ] &&
  [ "${GITHUB_EVENT_NAME:-}" = "push" ] &&
  [ "${GITHUB_REF_PROTECTED:-}" = "true" ] &&
  [ -n "${GITHUB_RUN_ID:-}" ] &&
  [ "${HARA_PROTECTED_SIGNING_JOB:-}" = "$GITHUB_RUN_ID" ] &&
  [ "${HARA_PROMOTION_WORKFLOW_LOCK:-}" = "$GITHUB_RUN_ID" ] &&
  [ "${HARA_PROMOTION_TAG:-}" = "$TAG" ] || {
  echo "error: stable promotion must run inside build.yml's tag-scoped protected signing job" >&2
  exit 1
}
case "${GITHUB_WORKFLOW_REF:-}" in
  "$REPO/.github/workflows/build.yml@refs/tags/$TAG") ;;
  *)
    echo "error: unexpected promotion workflow identity: ${GITHUB_WORKFLOW_REF:-<missing>}" >&2
    exit 1
    ;;
esac
[ -n "$RELEASE_GH_TOKEN" ] || {
  echo "error: protected release contents token is missing" >&2
  exit 1
}
release_gh() {
  GH_TOKEN="$RELEASE_GH_TOKEN" command gh "$@"
}
require_immutable_releases() {
  [ -n "$RELEASE_POLICY_TOKEN" ] || {
    echo "error: protected HARA_RELEASE_POLICY_TOKEN is required to verify immutable releases" >&2
    return 1
  }
  local enabled
  enabled="$(
    GH_TOKEN="$RELEASE_POLICY_TOKEN" \
      command gh api "repos/$REPO/immutable-releases" --jq .enabled
  )" || {
    echo "error: could not verify the repository immutable-release policy" >&2
    return 1
  }
  [ "$enabled" = "true" ] || {
    echo "error: immutable releases must be enabled before publication" >&2
    return 1
  }
}
if [ ! -f "${GITHUB_EVENT_PATH:-}" ] ||
  ! jq -e '.created == true and .forced == false and .deleted == false' "$GITHUB_EVENT_PATH" >/dev/null; then
  echo "error: only the original stable tag creation event may promote a release" >&2
  exit 1
fi
VER="${TAG#v}"
ARM_BASE="src-tauri/target/release/bundle"
X64_BASE="src-tauri/target/x86_64-apple-darwin/release/bundle"
WORK="$(mktemp -d)"
ASSET_DIR="$WORK/assets"
REMOTE_DIR="$WORK/remote"
PUBLIC_DIR="$WORK/public"
trap 'rm -rf "$WORK"' EXIT

# shellcheck source=scripts/check-build-toolchain.sh
source scripts/check-build-toolchain.sh
hara_check_build_toolchain
release_gh release verify --help >/dev/null 2>&1 || {
  echo "error: the signing runner's GitHub CLI must support 'gh release verify'" >&2
  echo "       Upgrade gh before running stable promotion." >&2
  exit 1
}
npm run check:release
[ "$TAG" = "v$(node -p 'require("./package.json").version')" ] || {
  echo "error: tag $TAG does not match desktop package version" >&2
  exit 1
}

[ -z "$(git status --porcelain)" ] || {
  echo "error: desktop worktree must be clean before release promotion" >&2
  git status --short >&2
  exit 1
}
TAG_COMMIT="$(git rev-parse -q --verify "refs/tags/$TAG^{commit}" 2>/dev/null || true)"
[ -n "$TAG_COMMIT" ] || { echo "error: local tag $TAG is missing" >&2; exit 1; }
[ "$(git rev-parse HEAD)" = "$TAG_COMMIT" ] || {
  echo "error: desktop HEAD must exactly match $TAG before release promotion" >&2
  exit 1
}
REMOTE_DESKTOP_TAGS="$(git ls-remote --tags origin "refs/tags/$TAG" "refs/tags/$TAG^{}")" || {
  echo "error: could not read remote desktop tag $TAG" >&2
  exit 1
}
REMOTE_DESKTOP_COMMIT="$(awk -v direct="refs/tags/$TAG" -v peeled="refs/tags/$TAG^{}" '
  $2 == peeled { peeled_commit = $1 }
  $2 == direct { direct_commit = $1 }
  END { print peeled_commit ? peeled_commit : direct_commit }
' <<<"$REMOTE_DESKTOP_TAGS")"
[ "$REMOTE_DESKTOP_COMMIT" = "$TAG_COMMIT" ] || {
  echo "error: local desktop $TAG ($TAG_COMMIT) does not match origin ($REMOTE_DESKTOP_COMMIT)" >&2
  exit 1
}

SIDECAR_VERSION="$(tr -d '[:space:]' < src-tauri/binaries/SIDECAR_VERSION)"
SIDECAR_COMMIT="$(tr -d '[:space:]' < src-tauri/binaries/SIDECAR_COMMIT)"
CLI_TAG="v$SIDECAR_VERSION"
CLI_TAG_COMMIT="$(git -C ../hara-cli rev-parse -q --verify "refs/tags/$CLI_TAG^{commit}" 2>/dev/null || true)"
[ -n "$CLI_TAG_COMMIT" ] || {
  echo "error: local hara-cli tag $CLI_TAG is required to verify signed asset provenance" >&2
  exit 1
}
[ "$CLI_TAG_COMMIT" = "$SIDECAR_COMMIT" ] || {
  echo "error: local hara-cli $CLI_TAG ($CLI_TAG_COMMIT) does not match locked SIDECAR_COMMIT ($SIDECAR_COMMIT)" >&2
  exit 1
}
REMOTE_CLI_TAGS="$(git -C ../hara-cli ls-remote --tags origin "refs/tags/$CLI_TAG" "refs/tags/$CLI_TAG^{}")" || {
  echo "error: could not read remote hara-cli tag $CLI_TAG" >&2
  exit 1
}
REMOTE_CLI_COMMIT="$(awk -v direct="refs/tags/$CLI_TAG" -v peeled="refs/tags/$CLI_TAG^{}" '
  $2 == peeled { peeled_commit = $1 }
  $2 == direct { direct_commit = $1 }
  END { print peeled_commit ? peeled_commit : direct_commit }
' <<<"$REMOTE_CLI_TAGS")"
[ "$REMOTE_CLI_COMMIT" = "$CLI_TAG_COMMIT" ] || {
  echo "error: local hara-cli $CLI_TAG ($CLI_TAG_COMMIT) does not match origin ($REMOTE_CLI_COMMIT)" >&2
  exit 1
}

# If the original promotion crossed the public/immutable boundary and only a later CDN check failed,
# rerunning the failed signing job must verify the already-public release instead of trying to mutate
# it or reporting a false failure. Source/tag/policy checks above still run before this branch.
RELEASE_STATE="$(release_gh release view "$TAG" -R "$REPO" --json isDraft,isPrerelease --jq '[.isDraft, .isPrerelease] | @tsv')" || {
  echo "error: release $TAG is missing" >&2
  exit 1
}
if [ "$RELEASE_STATE" = $'false\tfalse' ]; then
  echo "Published immutable release detected; entering verification-only rerun for $TAG."
  require_immutable_releases
  release_gh release verify "$TAG" -R "$REPO"
  mkdir -p "$PUBLIC_DIR"
  release_gh release download "$TAG" -R "$REPO" --dir "$PUBLIC_DIR"
  node scripts/updater-manifest.mjs validate "$PUBLIC_DIR" "$TAG"
  node scripts/release-source-provenance.mjs validate \
    "$PUBLIC_DIR/release-source-provenance.json" "$TAG" "$TAG_COMMIT" "$CLI_TAG_COMMIT"
  node scripts/verify-release-updaters.mjs "$PUBLIC_DIR"
  node scripts/mac-updater-smoke.mjs \
    "$PUBLIC_DIR/Hara_aarch64.app.tar.gz" aarch64-apple-darwin --require-signatures
  HARA_ALLOW_ROSETTA_SMOKE=1 node scripts/mac-updater-smoke.mjs \
    "$PUBLIC_DIR/Hara_x64.app.tar.gz" x86_64-apple-darwin --require-signatures
  for arch in aarch64 x64; do
    public_dmg="$PUBLIC_DIR/Hara_${VER}_${arch}.dmg"
    if [ "$arch" = "aarch64" ]; then
      public_target="aarch64-apple-darwin"
    else
      public_target="x86_64-apple-darwin"
    fi
    xcrun stapler validate "$public_dmg"
    spctl -a -t open --context context:primary-signature -v "$public_dmg"
    HARA_ALLOW_ROSETTA_SMOKE=1 node scripts/mac-dmg-smoke.mjs \
      "$public_dmg" "$public_target" --require-signatures
  done
  curl --fail --location --retry 5 --retry-all-errors \
    --output "$WORK/latest-public.json" \
    "https://github.com/$REPO/releases/latest/download/latest.json"
  cmp -s "$PUBLIC_DIR/latest.json" "$WORK/latest-public.json" || {
    echo "error: public latest.json does not match verified immutable $TAG" >&2
    exit 1
  }
  unset RELEASE_POLICY_TOKEN RELEASE_GH_TOKEN
  echo "✓ $TAG public immutable release reverified without mutation"
  exit 0
fi
[ "$RELEASE_STATE" = $'true\tfalse' ] || {
  echo "error: release $TAG has an unexpected draft/prerelease state: $RELEASE_STATE" >&2
  exit 1
}

node scripts/release-provenance.mjs verify \
  "$ARM_BASE" aarch64-apple-darwin "$TAG" "$TAG_COMMIT" "$CLI_TAG_COMMIT"
node scripts/release-provenance.mjs verify \
  "$X64_BASE" x86_64-apple-darwin "$TAG" "$TAG_COMMIT" "$CLI_TAG_COMMIT"

ARM_DMG="$ARM_BASE/dmg/Hara_${VER}_aarch64.dmg"
X64_DMG="$X64_BASE/dmg/Hara_${VER}_x64.dmg"
for path in \
  "$ARM_DMG" \
  "$ARM_BASE/macos/Hara.app.tar.gz" \
  "$ARM_BASE/macos/Hara.app.tar.gz.sig" \
  "$X64_DMG" \
  "$X64_BASE/macos/Hara.app.tar.gz" \
  "$X64_BASE/macos/Hara.app.tar.gz.sig"; do
  [ -s "$path" ] || {
    echo "error: signed Mac release output missing: $path" >&2
    echo "       The protected signing job must complete both signed Mac builds first." >&2
    exit 1
  }
done

# A build interrupted after signing but before notarization leaves a plausible-looking DMG. Require
# both local architecture variants to be stapled, Gatekeeper-accepted, and to contain signed apps.
for spec in \
  "$ARM_DMG|$ARM_BASE/macos/Hara.app|arm64" \
  "$X64_DMG|$X64_BASE/macos/Hara.app|x86_64"; do
  IFS='|' read -r dmg app expected_arch <<<"$spec"
  xcrun stapler validate "$dmg" >/dev/null 2>&1 || {
    echo "error: DMG is not stapled/notarized: $dmg" >&2
    exit 1
  }
  spctl -a -t open --context context:primary-signature -v "$dmg"
  codesign --verify --deep --strict --verbose=2 "$app"
  app_archs="$(/usr/bin/lipo -archs "$app/Contents/MacOS/hara-desktop")"
  case " $app_archs " in
    *" $expected_arch "*) ;;
    *) echo "error: $app architecture mismatch; expected $expected_arch, got ${app_archs:-unknown}" >&2; exit 1 ;;
  esac
done

# The current tag workflow is the native-execution authority, sole draft writer, and sole promoter.
# Job dependencies guarantee assembly completed; these assertions prevent an out-of-DAG invocation.
[ "${HARA_DRAFT_ASSEMBLED_RUN_ID:-}" = "$GITHUB_RUN_ID" ] || {
  echo "error: promotion is not attached to this run's verified draft assembly" >&2
  exit 1
}
[ "${GITHUB_SHA:-}" = "$TAG_COMMIT" ] || {
  echo "error: tag event source does not match the verified Desktop commit" >&2
  exit 1
}

[ "$(release_gh release view "$TAG" -R "$REPO" --json isDraft --jq .isDraft)" = "true" ] || {
  echo "error: $TAG is not a hidden draft; refusing to overwrite a public release" >&2
  exit 1
}

mkdir -p "$ASSET_DIR" "$REMOTE_DIR" "$PUBLIC_DIR"
release_gh release download "$TAG" -R "$REPO" --dir "$ASSET_DIR"
node scripts/updater-manifest.mjs validate "$ASSET_DIR" "$TAG"
node scripts/release-source-provenance.mjs validate \
  "$ASSET_DIR/release-source-provenance.json" "$TAG" "$TAG_COMMIT" "$CLI_TAG_COMMIT"
PUB_DATE="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).pub_date' "$ASSET_DIR/latest.json")"

# Canonical names are part of the updater contract; overwrite, never add architecture-ambiguous
# aliases. Rebuilding latest.json makes its signature values come directly from these exact files.
cp "$ARM_DMG" "$ASSET_DIR/Hara_${VER}_aarch64.dmg"
cp "$ARM_BASE/macos/Hara.app.tar.gz" "$ASSET_DIR/Hara_aarch64.app.tar.gz"
cp "$ARM_BASE/macos/Hara.app.tar.gz.sig" "$ASSET_DIR/Hara_aarch64.app.tar.gz.sig"
cp "$X64_DMG" "$ASSET_DIR/Hara_${VER}_x64.dmg"
cp "$X64_BASE/macos/Hara.app.tar.gz" "$ASSET_DIR/Hara_x64.app.tar.gz"
cp "$X64_BASE/macos/Hara.app.tar.gz.sig" "$ASSET_DIR/Hara_x64.app.tar.gz.sig"
node scripts/updater-manifest.mjs build "$ASSET_DIR" "$TAG" "$PUB_DATE"

release_gh release upload "$TAG" -R "$REPO" --clobber \
  "$ASSET_DIR/Hara_${VER}_aarch64.dmg" \
  "$ASSET_DIR/Hara_aarch64.app.tar.gz" \
  "$ASSET_DIR/Hara_aarch64.app.tar.gz.sig" \
  "$ASSET_DIR/Hara_${VER}_x64.dmg" \
  "$ASSET_DIR/Hara_x64.app.tar.gz" \
  "$ASSET_DIR/Hara_x64.app.tar.gz.sig" \
  "$ASSET_DIR/latest.json"

# Validate the bytes retrieved from the remote draft, not merely the local upload inputs.
release_gh release download "$TAG" -R "$REPO" --dir "$REMOTE_DIR"
node scripts/updater-manifest.mjs validate "$REMOTE_DIR" "$TAG"
node scripts/release-source-provenance.mjs validate \
  "$REMOTE_DIR/release-source-provenance.json" "$TAG" "$TAG_COMMIT" "$CLI_TAG_COMMIT"
node scripts/verify-release-updaters.mjs "$REMOTE_DIR"
node scripts/mac-updater-smoke.mjs \
  "$REMOTE_DIR/Hara_aarch64.app.tar.gz" aarch64-apple-darwin --require-signatures
HARA_ALLOW_ROSETTA_SMOKE=1 node scripts/mac-updater-smoke.mjs \
  "$REMOTE_DIR/Hara_x64.app.tar.gz" x86_64-apple-darwin --require-signatures
for arch in aarch64 x64; do
  remote_dmg="$REMOTE_DIR/Hara_${VER}_${arch}.dmg"
  xcrun stapler validate "$remote_dmg"
  spctl -a -t open --context context:primary-signature -v "$remote_dmg"
  if [ "$arch" = "aarch64" ]; then
    remote_target="aarch64-apple-darwin"
  else
    remote_target="x86_64-apple-darwin"
  fi
  HARA_ALLOW_ROSETTA_SMOKE=1 node scripts/mac-dmg-smoke.mjs \
    "$remote_dmg" "$remote_target" --require-signatures
done
[ "$(release_gh release view "$TAG" -R "$REPO" --json isDraft --jq .isDraft)" = "true" ] || {
  echo "error: draft state changed during signed-asset verification" >&2
  exit 1
}

# Use a protected, read-only administration token to fail closed before a mutable release could
# become public. GITHUB_TOKEN intentionally cannot read this repository policy endpoint.
require_immutable_releases
unset RELEASE_POLICY_TOKEN

# Close the last tag-mutation window immediately before publication. Earlier checks bind every
# local and draft artifact, while these reads prove both remote refs still name those same commits.
FINAL_REMOTE_DESKTOP_TAGS="$(git ls-remote --tags origin "refs/tags/$TAG" "refs/tags/$TAG^{}")" || {
  echo "error: could not re-read remote desktop tag $TAG before publication" >&2
  exit 1
}
FINAL_REMOTE_DESKTOP_COMMIT="$(awk -v direct="refs/tags/$TAG" -v peeled="refs/tags/$TAG^{}" '
  $2 == peeled { peeled_commit = $1 }
  $2 == direct { direct_commit = $1 }
  END { print peeled_commit ? peeled_commit : direct_commit }
' <<<"$FINAL_REMOTE_DESKTOP_TAGS")"
[ "$FINAL_REMOTE_DESKTOP_COMMIT" = "$TAG_COMMIT" ] || {
  echo "error: remote desktop tag moved before publication: $FINAL_REMOTE_DESKTOP_COMMIT != $TAG_COMMIT" >&2
  exit 1
}
FINAL_REMOTE_CLI_TAGS="$(git -C ../hara-cli ls-remote --tags origin "refs/tags/$CLI_TAG" "refs/tags/$CLI_TAG^{}")" || {
  echo "error: could not re-read remote hara-cli tag $CLI_TAG before publication" >&2
  exit 1
}
FINAL_REMOTE_CLI_COMMIT="$(awk -v direct="refs/tags/$CLI_TAG" -v peeled="refs/tags/$CLI_TAG^{}" '
  $2 == peeled { peeled_commit = $1 }
  $2 == direct { direct_commit = $1 }
  END { print peeled_commit ? peeled_commit : direct_commit }
' <<<"$FINAL_REMOTE_CLI_TAGS")"
[ "$FINAL_REMOTE_CLI_COMMIT" = "$CLI_TAG_COMMIT" ] || {
  echo "error: remote hara-cli tag moved before publication: $FINAL_REMOTE_CLI_COMMIT != $CLI_TAG_COMMIT" >&2
  exit 1
}

release_gh release edit "$TAG" -R "$REPO" --draft=false --prerelease=false --latest

# Repositories with immutable releases produce a GitHub-signed release attestation on publish.
# Allow normal propagation, then fail loudly if the public release cannot be verified.
RELEASE_ATTESTED=0
for attempt in {1..12}; do
  if release_gh release verify "$TAG" -R "$REPO" >/dev/null 2>&1; then
    RELEASE_ATTESTED=1
    break
  fi
  echo "immutable release attestation is not available yet (attempt $attempt/12)"
  sleep 5
done
[ "$RELEASE_ATTESTED" = "1" ] || {
  echo "error: GitHub could not verify the immutable release attestation for $TAG" >&2
  echo "       Enable immutable releases in repository settings before promotion." >&2
  exit 1
}
unset RELEASE_GH_TOKEN

# Last-mile CDN check after promotion. The same files already passed Gatekeeper before publication;
# retries absorb normal GitHub edge propagation delay.
for arch in aarch64 x64; do
  public_dmg="$PUBLIC_DIR/Hara_${VER}_${arch}.dmg"
  curl --fail --location --retry 5 --retry-all-errors \
    --output "$public_dmg" \
    "https://github.com/$REPO/releases/download/$TAG/Hara_${VER}_${arch}.dmg"
  spctl -a -t open --context context:primary-signature -v "$public_dmg"
done
LATEST_MATCHED=0
for attempt in {1..12}; do
  if curl --fail --location --retry 2 --retry-all-errors \
    --output "$PUBLIC_DIR/latest.json" \
    "https://github.com/$REPO/releases/latest/download/latest.json" && \
    cmp -s "$REMOTE_DIR/latest.json" "$PUBLIC_DIR/latest.json"; then
    LATEST_MATCHED=1
    break
  fi
  echo "public latest.json has not converged to $TAG yet (attempt $attempt/12)"
  sleep 5
done
[ "$LATEST_MATCHED" = "1" ] || {
  echo "error: public latest.json does not match the verified $TAG manifest" >&2
  exit 1
}

echo "✓ $TAG promoted stable after native CI, immutable-release attestation, exact updater validation, and signed/notarized arm64+x64 Mac verification"
echo "! Send the required Feishu hara 反馈群 release notice and reply to each fixed bug report."
