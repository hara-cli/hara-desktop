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
SOURCE_ARTIFACT_DIGEST="${HARA_RELEASE_SOURCE_ARTIFACT_DIGEST:-}"
unset HARA_RELEASE_SOURCE_ARTIFACT_DIGEST
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
release_gh_download() {
  GH_TOKEN="$RELEASE_GH_TOKEN" node scripts/github-release-download.mjs "$@"
}
release_gh_api_download() {
  GH_TOKEN="$RELEASE_GH_TOKEN" node scripts/github-release-api-download.mjs "$@"
}
release_download_with_api_fallback() {
  local metadata="$1"
  local stage="$2"
  local log="$3"
  if release_gh_download "$TAG" "$REPO" "$stage" --skip-existing >>"$log" 2>&1; then
    return 0
  fi
  if ! node scripts/github-release-transfer-retry.mjs "$log"; then
    return 1
  fi
  echo "warning: bulk release download hit a transient GitHub transport failure; trying digest-verified per-asset API downloads" >>"$log"
  release_gh_api_download "$REPO" "$metadata" "$stage" >>"$log" 2>&1
}
release_view_with_retry() {
  local attempt output log
  for ((attempt = 1; attempt <= RELEASE_TRANSFER_ATTEMPTS; attempt++)); do
    log="$(mktemp "$WORK/release-view-log.XXXXXX")"
    chmod 600 "$log"
    if output="$(release_gh release view "$TAG" -R "$REPO" "$@" 2>"$log")"; then
      [ ! -s "$log" ] || cat "$log" >&2
      rm -f "$log"
      printf '%s\n' "$output"
      return 0
    fi
    cat "$log" >&2
    if ! node scripts/github-release-transfer-retry.mjs "$log"; then
      rm -f "$log"
      echo "error: release state read failed without a retryable GitHub transport error" >&2
      return 1
    fi
    if [ "$attempt" -eq "$RELEASE_TRANSFER_ATTEMPTS" ]; then
      rm -f "$log"
      echo "error: release state read exhausted $RELEASE_TRANSFER_ATTEMPTS transient GitHub transport attempts" >&2
      return 1
    fi
    rm -f "$log"
    echo "warning: release state read hit a transient GitHub transport failure ($attempt/$RELEASE_TRANSFER_ATTEMPTS); retrying" >&2
    sleep $((attempt * 5))
  done
}
require_immutable_releases() {
  [ -n "$RELEASE_POLICY_TOKEN" ] || {
    echo "error: protected HARA_RELEASE_POLICY_TOKEN is required to verify immutable releases" >&2
    return 1
  }
  local enabled
  enabled="$(
    GH_TOKEN="$RELEASE_POLICY_TOKEN" \
      node scripts/github-api-read.mjs "repos/$REPO/immutable-releases" --jq .enabled
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
SOURCE_ARCHIVE_NAME="Hara_${VER}_source-packs.zip"
EXPECTED_SOURCE_ARTIFACT_SHA="${SOURCE_ARTIFACT_DIGEST#sha256:}"
[[ "$EXPECTED_SOURCE_ARTIFACT_SHA" =~ ^[0-9a-f]{64}$ ]] || {
  echo "error: the protected source artifact digest is missing or invalid" >&2
  exit 1
}
ARM_BASE="src-tauri/target/release/bundle"
X64_BASE="src-tauri/target/x86_64-apple-darwin/release/bundle"
PROVENANCE_RUN="${GITHUB_RUN_ID:-local}"
PROVENANCE_DIR="${HARA_RELEASE_PROVENANCE_DIR:-${RUNNER_TEMP:-$PWD/src-tauri/target}/hara-release-provenance/$PROVENANCE_RUN/$TAG}"
WORK="$(mktemp -d)"
ASSET_DIR="$WORK/assets"
REMOTE_DIR="$WORK/remote"
PUBLIC_DIR="$WORK/public"
trap 'rm -rf "$WORK"' EXIT
readonly RELEASE_TRANSFER_ATTEMPTS=3
readonly RELEASE_PUBLIC_CONNECT_TIMEOUT_SECONDS=20
readonly RELEASE_PUBLIC_MAX_TIME_SECONDS=600
readonly RELEASE_PUBLIC_LOW_SPEED_BYTES=1024
readonly RELEASE_PUBLIC_LOW_SPEED_SECONDS=60

# GitHub's release CDN occasionally leaves an HTTP/2 connection established without delivering any
# bytes. Keep public-edge verification bounded and force the HTTP/1.1 path that release-assets serves
# reliably on the protected signing host. A stalled edge must fail into the existing retry/re-run
# recovery path instead of occupying the signing runner until the job-level timeout.
release_public_curl() {
  curl --http1.1 --fail --location --retry 5 --retry-all-errors \
    --connect-timeout "$RELEASE_PUBLIC_CONNECT_TIMEOUT_SECONDS" \
    --max-time "$RELEASE_PUBLIC_MAX_TIME_SECONDS" \
    --speed-limit "$RELEASE_PUBLIC_LOW_SPEED_BYTES" \
    --speed-time "$RELEASE_PUBLIC_LOW_SPEED_SECONDS" \
    "$@"
}

release_download_all() {
  local target="$1"
  local label="$2"
  local attempt stage log metadata metadata_next
  stage="$(mktemp -d "$WORK/release-download.XXXXXX")"
  metadata="$(mktemp "$WORK/release-assets.XXXXXX")"
  metadata_next="$(mktemp "$WORK/release-assets-next.XXXXXX")"
  chmod 600 "$metadata" "$metadata_next"
  for ((attempt = 1; attempt <= RELEASE_TRANSFER_ATTEMPTS; attempt++)); do
    log="$(mktemp "$WORK/release-download-log.XXXXXX")"
    chmod 600 "$log"
    if release_gh release view "$TAG" -R "$REPO" --json assets >"$metadata_next" 2>"$log" &&
      chmod 600 "$metadata_next" &&
      mv "$metadata_next" "$metadata" &&
      metadata_next="$(mktemp "$WORK/release-assets-next.XXXXXX")" &&
      chmod 600 "$metadata_next" &&
      node scripts/release-download-cache.mjs "$metadata" "$stage" >>"$log" 2>&1 &&
      release_download_with_api_fallback "$metadata" "$stage" "$log" &&
      node scripts/release-download-cache.mjs "$metadata" "$stage" --complete >>"$log" 2>&1; then
      cat "$log"
      rm -rf "$target"
      mv "$stage" "$target"
      rm -f "$log" "$metadata" "$metadata_next"
      return 0
    fi
    if [ -s "$metadata" ]; then
      node scripts/release-download-cache.mjs "$metadata" "$stage" >>"$log" 2>&1 || true
    fi
    cat "$log" >&2
    if ! node scripts/github-release-transfer-retry.mjs "$log"; then
      rm -f "$log"
      echo "error: $label failed without a retryable GitHub transport error" >&2
      return 1
    fi
    if [ "$attempt" -eq "$RELEASE_TRANSFER_ATTEMPTS" ]; then
      rm -f "$log"
      echo "error: $label exhausted $RELEASE_TRANSFER_ATTEMPTS transient GitHub transport attempts" >&2
      return 1
    fi
    rm -f "$log"
    echo "warning: $label hit a transient GitHub transport failure ($attempt/$RELEASE_TRANSFER_ATTEMPTS); retrying with only digest-verified completed assets" >&2
    sleep $((attempt * 5))
  done
}

remove_verified_source_archive() {
  local directory="$1"
  local label="$2"
  local archive="$directory/$SOURCE_ARCHIVE_NAME"
  [ -s "$archive" ] || {
    echo "error: $label is missing the exact source archive: $SOURCE_ARCHIVE_NAME" >&2
    return 1
  }
  [ "$(shasum -a 256 "$archive" | awk '{print $1}')" = "$EXPECTED_SOURCE_ARTIFACT_SHA" ] || {
    echo "error: $label source archive does not match the trusted prepare-job digest" >&2
    return 1
  }
  rm -f "$archive"
}

verify_signed_dmg() {
  local scope="$1"
  local dmg_path="$2"
  local expected_target="$3"
  node scripts/stapler-validate.mjs "$dmg_path" "$scope $expected_target DMG notarization staple"
  /usr/sbin/spctl -a -t open --context context:primary-signature -v "$dmg_path"
  if [ "$expected_target" = "x86_64-apple-darwin" ]; then
    HARA_FOREIGN_MAC_STATIC_VALIDATION=1 node scripts/mac-dmg-smoke.mjs \
      "$dmg_path" "$expected_target" --require-signatures
  else
    node scripts/mac-dmg-smoke.mjs "$dmg_path" "$expected_target" --require-signatures
  fi
}

release_remote_asset_matches() {
  local source="$1"
  local asset_name attempt_idx stage probe_log metadata
  asset_name="$(basename "$source")"
  for ((attempt_idx = 1; attempt_idx <= RELEASE_TRANSFER_ATTEMPTS; attempt_idx++)); do
    stage="$(mktemp -d "$WORK/release-reconcile.XXXXXX")"
    probe_log="$(mktemp "$WORK/release-reconcile-log.XXXXXX")"
    metadata="$(mktemp "$WORK/release-reconcile-assets.XXXXXX")"
    chmod 600 "$probe_log" "$metadata"

    if release_gh release view "$TAG" -R "$REPO" --json assets >"$metadata" 2>"$probe_log" &&
      node scripts/release-asset-digest-match.mjs "$metadata" "$source" >>"$probe_log" 2>&1; then
      cat "$probe_log"
      rm -rf "$stage"
      rm -f "$probe_log" "$metadata"
      return 0
    fi
    if release_gh_download "$TAG" "$REPO" "$stage" \
      --pattern "$asset_name" >>"$probe_log" 2>&1 &&
      [ -f "$stage/$asset_name" ] &&
      cmp -s "$source" "$stage/$asset_name"; then
      cat "$probe_log"
      rm -rf "$stage"
      rm -f "$probe_log" "$metadata"
      return 0
    fi

    [ "$attempt_idx" -lt "$RELEASE_TRANSFER_ATTEMPTS" ] || cat "$probe_log" >&2
    rm -rf "$stage"
    rm -f "$probe_log" "$metadata"
    [ "$attempt_idx" -lt "$RELEASE_TRANSFER_ATTEMPTS" ] || break
    echo "warning: $asset_name is not yet reconciled in the hidden draft ($attempt_idx/$RELEASE_TRANSFER_ATTEMPTS); retrying metadata and download evidence" >&2
    sleep $((attempt_idx * 2))
  done
  return 1
}

release_upload_signed_asset() {
  local asset_path="$1"
  local asset_name attempt_idx upload_log
  asset_name="$(basename "$asset_path")"
  for ((attempt_idx = 1; attempt_idx <= RELEASE_TRANSFER_ATTEMPTS; attempt_idx++)); do
    upload_log="$(mktemp "$WORK/release-upload-log.XXXXXX")"
    chmod 600 "$upload_log"
    if release_gh release upload "$TAG" -R "$REPO" --clobber \
      "$asset_path" >"$upload_log" 2>&1; then
      cat "$upload_log"
      rm -f "$upload_log"
      return 0
    fi
    cat "$upload_log" >&2

    # GitHub can commit an asset before the client observes a transient transport failure. Reconcile
    # the exact remote bytes before retrying so a partial response never causes the whole asset set
    # to be replayed or a successfully uploaded asset to be replaced unnecessarily.
    if release_remote_asset_matches "$asset_path"; then
      rm -f "$upload_log"
      echo "warning: $asset_name upload response failed, but the remote draft already has identical bytes" >&2
      return 0
    fi
    if grep -Fq "ReleaseAsset.name already exists" "$upload_log"; then
      if [ "$attempt_idx" -eq "$RELEASE_TRANSFER_ATTEMPTS" ]; then
        rm -f "$upload_log"
        echo "error: signed draft upload for $asset_name kept returning a name conflict without matching remote bytes" >&2
        return 1
      fi
      rm -f "$upload_log"
      echo "warning: signed draft upload for $asset_name reached an eventually consistent name conflict ($attempt_idx/$RELEASE_TRANSFER_ATTEMPTS); retrying only this --clobber asset" >&2
      sleep $((attempt_idx * 5))
      continue
    fi
    if ! node scripts/github-release-transfer-retry.mjs "$upload_log"; then
      rm -f "$upload_log"
      echo "error: signed draft upload for $asset_name failed without a retryable GitHub transport error" >&2
      return 1
    fi
    if [ "$attempt_idx" -eq "$RELEASE_TRANSFER_ATTEMPTS" ]; then
      rm -f "$upload_log"
      echo "error: signed draft upload for $asset_name exhausted $RELEASE_TRANSFER_ATTEMPTS transient GitHub transport attempts" >&2
      return 1
    fi
    rm -f "$upload_log"
    echo "warning: signed draft upload for $asset_name hit a transient GitHub transport failure ($attempt_idx/$RELEASE_TRANSFER_ATTEMPTS); retrying only this asset" >&2
    sleep $((attempt_idx * 5))
  done
}

release_upload_signed_assets() {
  local asset_path
  local assets=(
    "$ASSET_DIR/Hara_${VER}_aarch64.dmg"
    "$ASSET_DIR/Hara_aarch64.app.tar.gz"
    "$ASSET_DIR/Hara_aarch64.app.tar.gz.sig"
    "$ASSET_DIR/Hara_${VER}_x64.dmg"
    "$ASSET_DIR/Hara_x64.app.tar.gz"
    "$ASSET_DIR/Hara_x64.app.tar.gz.sig"
    "$ASSET_DIR/latest.json"
  )
  for asset_path in "${assets[@]}"; do
    release_upload_signed_asset "$asset_path"
  done
}

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
REMOTE_DESKTOP_COMMIT="$(node scripts/resolve-remote-tag.mjs . origin "$TAG")" || {
  echo "error: could not read remote desktop tag $TAG" >&2
  exit 1
}
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
REMOTE_CLI_COMMIT="$(node scripts/resolve-remote-tag.mjs ../hara-cli origin "$CLI_TAG")" || {
  echo "error: could not read remote hara-cli tag $CLI_TAG" >&2
  exit 1
}
[ "$REMOTE_CLI_COMMIT" = "$CLI_TAG_COMMIT" ] || {
  echo "error: local hara-cli $CLI_TAG ($CLI_TAG_COMMIT) does not match origin ($REMOTE_CLI_COMMIT)" >&2
  exit 1
}

# If the original promotion crossed the public/immutable boundary and only a later CDN check failed,
# rerunning the failed signing job must verify the already-public release instead of trying to mutate
# it or reporting a false failure. Source/tag/policy checks above still run before this branch.
RELEASE_STATE="$(release_view_with_retry --json isDraft,isImmutable,isPrerelease --jq '[.isDraft, .isImmutable, .isPrerelease] | @tsv')" || {
  echo "error: release $TAG is missing" >&2
  exit 1
}
if [ "$RELEASE_STATE" = $'false\ttrue\tfalse' ]; then
  echo "Published immutable release detected; entering verification-only rerun for $TAG."
  require_immutable_releases
  if [ "${HARA_DEFER_PUBLIC_EDGE_VERIFY:-0}" = "1" ]; then
    echo "GitHub release attestation verification is delegated to the read-only hosted macOS job."
  else
    release_gh release verify "$TAG" -R "$REPO"
  fi
  release_download_all "$PUBLIC_DIR" "public immutable release download"
  remove_verified_source_archive "$PUBLIC_DIR" "public immutable release"
  node scripts/updater-manifest.mjs validate "$PUBLIC_DIR" "$TAG"
  node scripts/release-source-provenance.mjs validate \
    "$PUBLIC_DIR/release-source-provenance.json" "$TAG" "$TAG_COMMIT" "$CLI_TAG_COMMIT"
  node scripts/verify-release-updaters.mjs "$PUBLIC_DIR"
  node scripts/mac-updater-smoke.mjs \
    "$PUBLIC_DIR/Hara_aarch64.app.tar.gz" aarch64-apple-darwin --require-signatures
  HARA_FOREIGN_MAC_STATIC_VALIDATION=1 node scripts/mac-updater-smoke.mjs \
    "$PUBLIC_DIR/Hara_x64.app.tar.gz" x86_64-apple-darwin --require-signatures
  verify_signed_dmg public "$PUBLIC_DIR/Hara_${VER}_aarch64.dmg" aarch64-apple-darwin
  verify_signed_dmg public "$PUBLIC_DIR/Hara_${VER}_x64.dmg" x86_64-apple-darwin
  if [ "${HARA_DEFER_PUBLIC_EDGE_VERIFY:-0}" = "1" ]; then
    echo "Public edge verification is delegated to the read-only hosted macOS job."
  else
    release_public_curl \
      --output "$WORK/latest-public.json" \
      "https://github.com/$REPO/releases/latest/download/latest.json"
    cmp -s "$PUBLIC_DIR/latest.json" "$WORK/latest-public.json" || {
      echo "error: public latest.json does not match verified immutable $TAG" >&2
      exit 1
    }
  fi
  unset RELEASE_POLICY_TOKEN RELEASE_GH_TOKEN
  echo "✓ $TAG public immutable release reverified without mutation"
  exit 0
fi
[ "$RELEASE_STATE" = $'true\tfalse\tfalse' ] || {
  echo "error: release $TAG has an unexpected draft/immutable/prerelease state: $RELEASE_STATE" >&2
  exit 1
}

node scripts/release-provenance.mjs verify \
  "$ARM_BASE" "$PROVENANCE_DIR" aarch64-apple-darwin "$TAG" "$TAG_COMMIT" "$CLI_TAG_COMMIT"
node scripts/release-provenance.mjs verify \
  "$X64_BASE" "$PROVENANCE_DIR" x86_64-apple-darwin "$TAG" "$TAG_COMMIT" "$CLI_TAG_COMMIT"

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
  node scripts/stapler-validate.mjs "$dmg" "local $expected_arch DMG notarization staple"
  /usr/sbin/spctl -a -t open --context context:primary-signature -v "$dmg"
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

[ "$(release_view_with_retry --json isDraft --jq .isDraft)" = "true" ] || {
  echo "error: $TAG is not a hidden draft; refusing to overwrite a public release" >&2
  exit 1
}

mkdir -p "$ASSET_DIR" "$REMOTE_DIR" "$PUBLIC_DIR"
release_download_all "$ASSET_DIR" "hidden draft download"
remove_verified_source_archive "$ASSET_DIR" "hidden draft"
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

release_upload_signed_assets

# Validate the bytes retrieved from the remote draft, not merely the local upload inputs.
release_download_all "$REMOTE_DIR" "signed draft verification download"
remove_verified_source_archive "$REMOTE_DIR" "signed draft"
node scripts/updater-manifest.mjs validate "$REMOTE_DIR" "$TAG"
node scripts/release-source-provenance.mjs validate \
  "$REMOTE_DIR/release-source-provenance.json" "$TAG" "$TAG_COMMIT" "$CLI_TAG_COMMIT"
node scripts/verify-release-updaters.mjs "$REMOTE_DIR"
node scripts/mac-updater-smoke.mjs \
  "$REMOTE_DIR/Hara_aarch64.app.tar.gz" aarch64-apple-darwin --require-signatures
HARA_FOREIGN_MAC_STATIC_VALIDATION=1 node scripts/mac-updater-smoke.mjs \
  "$REMOTE_DIR/Hara_x64.app.tar.gz" x86_64-apple-darwin --require-signatures
verify_signed_dmg remote "$REMOTE_DIR/Hara_${VER}_aarch64.dmg" aarch64-apple-darwin
verify_signed_dmg remote "$REMOTE_DIR/Hara_${VER}_x64.dmg" x86_64-apple-darwin
[ "$(release_view_with_retry --json isDraft --jq .isDraft)" = "true" ] || {
  echo "error: draft state changed during signed-asset verification" >&2
  exit 1
}

# Use a protected, read-only administration token to fail closed before a mutable release could
# become public. GITHUB_TOKEN intentionally cannot read this repository policy endpoint.
require_immutable_releases
unset RELEASE_POLICY_TOKEN

# Close the last tag-mutation window immediately before publication. Earlier checks bind every
# local and draft artifact, while these reads prove both remote refs still name those same commits.
FINAL_REMOTE_DESKTOP_COMMIT="$(node scripts/resolve-remote-tag.mjs . origin "$TAG")" || {
  echo "error: could not re-read remote desktop tag $TAG before publication" >&2
  exit 1
}
[ "$FINAL_REMOTE_DESKTOP_COMMIT" = "$TAG_COMMIT" ] || {
  echo "error: remote desktop tag moved before publication: $FINAL_REMOTE_DESKTOP_COMMIT != $TAG_COMMIT" >&2
  exit 1
}
FINAL_REMOTE_CLI_COMMIT="$(node scripts/resolve-remote-tag.mjs ../hara-cli origin "$CLI_TAG")" || {
  echo "error: could not re-read remote hara-cli tag $CLI_TAG before publication" >&2
  exit 1
}
[ "$FINAL_REMOTE_CLI_COMMIT" = "$CLI_TAG_COMMIT" ] || {
  echo "error: remote hara-cli tag moved before publication: $FINAL_REMOTE_CLI_COMMIT != $CLI_TAG_COMMIT" >&2
  exit 1
}

release_gh release edit "$TAG" -R "$REPO" --draft=false --prerelease=false --latest

PUBLISHED_RELEASE_CONFIRMED=0
for publication_attempt in {1..12}; do
  if PUBLISHED_RELEASE_METADATA="$(
    release_view_with_retry \
      --json tagName,isDraft,isImmutable,isPrerelease,publishedAt
  )" && jq -e --arg tag "$TAG" '
    .tagName == $tag and
    .isDraft == false and
    .isImmutable == true and
    .isPrerelease == false and
    (.publishedAt | type == "string" and length > 0)
  ' >/dev/null <<<"$PUBLISHED_RELEASE_METADATA"; then
    PUBLISHED_RELEASE_CONFIRMED=1
    break
  fi
  [ "$publication_attempt" -lt 12 ] || break
  echo "immutable publication metadata has not converged yet (attempt $publication_attempt/12)"
  sleep 5
done
[ "$PUBLISHED_RELEASE_CONFIRMED" = "1" ] || {
  echo "error: publication did not produce the expected immutable stable release" >&2
  exit 1
}

if [ "${HARA_DEFER_PUBLIC_EDGE_VERIFY:-0}" = "1" ]; then
  # The independent GitHub-hosted job has only attestations:read + contents:read and verifies the
  # GitHub-signed immutable attestation plus exact public bytes. Keeping that read out of the
  # protected self-hosted job avoids an Actions-token visibility race without weakening the gate.
  echo "Immutable publication confirmed; GitHub release attestation verification is delegated to the read-only hosted macOS job."
else
  # Manual/non-workflow promotion keeps the complete local check. GitHub creates this attestation
  # asynchronously, so allow a bounded propagation window after the release becomes immutable.
  RELEASE_ATTESTED=0
  for attempt in {1..180}; do
    if release_gh release verify "$TAG" -R "$REPO" >/dev/null 2>&1; then
      RELEASE_ATTESTED=1
      break
    fi
    echo "immutable release attestation is not available yet (attempt $attempt/180)"
    sleep 10
  done
  [ "$RELEASE_ATTESTED" = "1" ] || {
    echo "error: GitHub's immutable release attestation for $TAG did not propagate within 30 minutes" >&2
    exit 1
  }
fi
unset RELEASE_GH_TOKEN

if [ "${HARA_DEFER_PUBLIC_EDGE_VERIFY:-0}" = "1" ]; then
  echo "Public DMG and latest.json edge verification is delegated to the read-only hosted macOS job."
else
  # Last-mile CDN check after promotion. The same files already passed Gatekeeper before publication;
  # retries absorb normal GitHub edge propagation delay.
  for arch in aarch64 x64; do
    public_dmg="$PUBLIC_DIR/Hara_${VER}_${arch}.dmg"
    release_public_curl \
      --output "$public_dmg" \
      "https://github.com/$REPO/releases/download/$TAG/Hara_${VER}_${arch}.dmg"
    /usr/sbin/spctl -a -t open --context context:primary-signature -v "$public_dmg"
  done
  LATEST_MATCHED=0
  for attempt in {1..12}; do
    if release_public_curl \
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
fi

if [ "${HARA_DEFER_PUBLIC_EDGE_VERIFY:-0}" = "1" ]; then
  echo "✓ $TAG promoted stable after native CI, immutable publication, exact updater validation, and signed/notarized arm64+x64 Mac verification; hosted attestation/public-edge verification remains required"
else
  echo "✓ $TAG promoted stable after native CI, immutable-release attestation, exact updater validation, and signed/notarized arm64+x64 Mac verification"
fi
echo "! Send the required Feishu hara 反馈群 release notice and reply to each fixed bug report."
