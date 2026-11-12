#!/usr/bin/env bash
# Replace the hidden draft's unsigned CI Mac assets with BOTH controlled, signed/notarized builds,
# regenerate latest.json from their exact signatures, prove the complete draft by GitHub's
# server-side SHA-256 digests, then (and only then) promote it to stable.
#
# 1.2.3 metadata-only merge: the hosted assembly job already downloaded and revalidated the exact
# draft and recorded every asset digest (HARA_DRAFT_ASSET_DIGESTS). This host never downloads the
# large non-Mac assets again; it reads release metadata plus the small signature/manifest files,
# uploads only the signed Mac assets and latest.json, and checks them by digest. The hosted
# verify_public_release job downloads the complete public release afterwards.
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
RELEASE_GITHUB_PRIMARY_PROXY="${HARA_GITHUB_RELEASE_PROXY:-}"
RELEASE_GITHUB_FALLBACK_PROXY="${HARA_GITHUB_RELEASE_FALLBACK_PROXY:-}"
RELEASE_GITHUB_PROXY_CANDIDATES="${HARA_GITHUB_RELEASE_PROXY_CANDIDATES:-}"
unset HARA_GITHUB_RELEASE_PROXY
unset HARA_GITHUB_RELEASE_FALLBACK_PROXY
unset HARA_GITHUB_RELEASE_PROXY_CANDIDATES
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
[ -n "${HARA_DRAFT_ASSET_DIGESTS:-}" ] || {
  echo "error: the assembly job's verified draft digest record (HARA_DRAFT_ASSET_DIGESTS) is missing" >&2
  exit 1
}
validate_release_github_proxy() {
  [[ "$1" =~ ^(http|socks5|socks5h)://127\.0\.0\.1:[0-9]{2,5}$ ]]
}
validate_release_github_proxy "$RELEASE_GITHUB_PRIMARY_PROXY" || {
  echo "error: HARA_GITHUB_RELEASE_PROXY must be a loopback HTTP/SOCKS proxy" >&2
  exit 1
}
if [ -n "$RELEASE_GITHUB_FALLBACK_PROXY" ]; then
  validate_release_github_proxy "$RELEASE_GITHUB_FALLBACK_PROXY" || {
    echo "error: HARA_GITHUB_RELEASE_FALLBACK_PROXY must be a loopback HTTP/SOCKS proxy" >&2
    exit 1
  }
fi
RELEASE_PROXY_CANDIDATES=("$RELEASE_GITHUB_PRIMARY_PROXY")
[ -z "$RELEASE_GITHUB_FALLBACK_PROXY" ] || RELEASE_PROXY_CANDIDATES+=("$RELEASE_GITHUB_FALLBACK_PROXY")
for candidate in $RELEASE_GITHUB_PROXY_CANDIDATES; do
  validate_release_github_proxy "$candidate" || {
    echo "error: HARA_GITHUB_RELEASE_PROXY_CANDIDATES entries must be loopback HTTP/SOCKS proxies" >&2
    exit 1
  }
  RELEASE_PROXY_CANDIDATES+=("$candidate")
done
# A small HTTPS 200 is not evidence of a usable route (v1.2.2: every route answered while moving
# 19-250 KB/s). Measure an 8 MiB public range through every candidate before any release transfer
# and stop here, with nothing uploaded, when none reaches the throughput floor.
RELEASE_GITHUB_PROXY="$(node scripts/release-proxy-select.mjs "${RELEASE_PROXY_CANDIDATES[@]}")" || {
  echo "error: no protected GitHub release route reached the throughput floor; nothing was transferred" >&2
  exit 1
}
echo "GitHub release route: $RELEASE_GITHUB_PROXY (fastest measured candidate)"
# After repeated transport failures, move to the next-fastest qualifying route (the 1081 tunnel
# dropped mid-transfer in v1.2.2 attempts 1-2). Stay on the current route when none qualifies.
release_failover_github_proxy() {
  local previous="$RELEASE_GITHUB_PROXY" chosen
  if chosen="$(node scripts/release-proxy-select.mjs --exclude "$previous" "${RELEASE_PROXY_CANDIDATES[@]}")"; then
    RELEASE_GITHUB_PROXY="$chosen"
    echo "warning: switching GitHub release route $previous -> $chosen after repeated transport failures" >&2
  else
    echo "warning: no other GitHub release route reaches the floor; staying on $previous" >&2
  fi
}
release_github_transport() {
  (
    # The runner itself must bypass the proxy for Actions Broker traffic, but that broad NO_PROXY
    # suffix also matches api.github.com. Clear it only inside release API/asset subprocesses.
    export NO_PROXY=
    export no_proxy=
    export HTTP_PROXY="$RELEASE_GITHUB_PROXY"
    export HTTPS_PROXY="$RELEASE_GITHUB_PROXY"
    export http_proxy="$RELEASE_GITHUB_PROXY"
    export https_proxy="$RELEASE_GITHUB_PROXY"
    command "$@"
  )
}
release_gh() {
  (
    export GH_TOKEN="$RELEASE_GH_TOKEN"
    release_github_transport gh "$@"
  )
}
release_gh_api_download() {
  (
    export GH_TOKEN="$RELEASE_GH_TOKEN"
    release_github_transport node scripts/github-release-api-download.mjs "$@"
  )
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
    export GH_TOKEN="$RELEASE_POLICY_TOKEN"
    release_github_transport \
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
mkdir -p "$ASSET_DIR" "$REMOTE_DIR" "$PUBLIC_DIR"
trap 'rm -rf "$WORK"' EXIT
readonly RELEASE_TRANSFER_ATTEMPTS=3
readonly RELEASE_DOWNLOAD_ATTEMPTS=6
readonly RELEASE_UPLOAD_ATTEMPTS=5
# Backoff between transfer attempts: 15, 30, 60, 120, then 240 seconds.
release_backoff_seconds() {
  local -a table=(15 30 60 120 240)
  local index=$(($1 - 1))
  [ "$index" -lt "${#table[@]}" ] || index=$((${#table[@]} - 1))
  echo "${table[$index]}"
}
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

# Download only the small files this host needs (updater signatures, latest.json and source
# provenance), each accepted only when its bytes match GitHub's size and SHA-256. Partials are kept
# between attempts so an interrupted file resumes instead of restarting.
release_download_small() {
  local target="$1"
  local label="$2"
  local attempt stage log metadata small delay
  stage="$(mktemp -d "$WORK/release-download.XXXXXX")"
  metadata="$(mktemp "$WORK/release-assets.XXXXXX")"
  small="$(mktemp "$WORK/release-small-assets.XXXXXX")"
  chmod 600 "$metadata" "$small"
  for ((attempt = 1; attempt <= RELEASE_DOWNLOAD_ATTEMPTS; attempt++)); do
    log="$(mktemp "$WORK/release-download-log.XXXXXX")"
    chmod 600 "$log"
    if release_view_with_retry --json assets >"$metadata" 2>>"$log" &&
      node scripts/release-asset-digests.mjs small "$metadata" >"$small" 2>>"$log" &&
      node scripts/release-download-cache.mjs "$small" "$stage" >>"$log" 2>&1 &&
      release_gh_api_download "$REPO" "$small" "$stage" >>"$log" 2>&1 &&
      node scripts/release-download-cache.mjs "$small" "$stage" --complete >>"$log" 2>&1; then
      cat "$log"
      cp -p "$stage"/* "$target"/
      rm -rf "$stage"
      rm -f "$log" "$metadata" "$small"
      return 0
    fi
    cat "$log" >&2
    if ! node scripts/github-release-transfer-retry.mjs "$log"; then
      rm -f "$log"
      echo "error: $label failed without a retryable GitHub transport error" >&2
      return 1
    fi
    rm -f "$log"
    if [ "$attempt" -eq "$RELEASE_DOWNLOAD_ATTEMPTS" ]; then
      echo "error: $label exhausted $RELEASE_DOWNLOAD_ATTEMPTS transient GitHub transport attempts" >&2
      return 1
    fi
    [ "$attempt" -lt 2 ] || release_failover_github_proxy
    delay="$(release_backoff_seconds "$attempt")"
    echo "warning: $label hit a transient GitHub transport failure ($attempt/$RELEASE_DOWNLOAD_ATTEMPTS); resuming verified/partial files after ${delay}s" >&2
    sleep "$delay"
  done
}

# Read release metadata (names, sizes, GitHub SHA-256 digests) without downloading asset bytes.
release_read_assets() {
  release_view_with_retry --json assets >"$1"
  chmod 600 "$1"
}

# The source archive is bound to the prepare job's digest by GitHub's server-side SHA-256.
require_source_archive_digest() {
  local metadata="$1"
  local label="$2"
  jq -e --arg name "$SOURCE_ARCHIVE_NAME" --arg digest "sha256:$EXPECTED_SOURCE_ARTIFACT_SHA" '
    [.assets[] | select(.name == $name)] | length == 1 and .[0].digest == $digest
  ' "$metadata" >/dev/null || {
    echo "error: $label source archive does not match the trusted prepare-job digest" >&2
    return 1
  }
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
  local asset_name attempt_idx probe_log metadata
  asset_name="$(basename "$source")"
  for ((attempt_idx = 1; attempt_idx <= RELEASE_TRANSFER_ATTEMPTS; attempt_idx++)); do
    probe_log="$(mktemp "$WORK/release-reconcile-log.XXXXXX")"
    metadata="$(mktemp "$WORK/release-reconcile-assets.XXXXXX")"
    chmod 600 "$probe_log" "$metadata"

    # GitHub's server-side SHA-256 is authoritative; the asset is never downloaded back.
    if release_gh release view "$TAG" -R "$REPO" --json assets >"$metadata" 2>"$probe_log" &&
      node scripts/release-asset-digest-match.mjs "$metadata" "$source" >>"$probe_log" 2>&1; then
      cat "$probe_log"
      rm -f "$probe_log" "$metadata"
      return 0
    fi

    [ "$attempt_idx" -lt "$RELEASE_TRANSFER_ATTEMPTS" ] || cat "$probe_log" >&2
    rm -f "$probe_log" "$metadata"
    [ "$attempt_idx" -lt "$RELEASE_TRANSFER_ATTEMPTS" ] || break
    echo "warning: $asset_name is not yet reconciled in the hidden draft ($attempt_idx/$RELEASE_TRANSFER_ATTEMPTS); retrying metadata digest evidence" >&2
    sleep $((attempt_idx * 2))
  done
  return 1
}

release_upload_signed_asset() {
  local asset_path="$1"
  local asset_name attempt_idx upload_log deadline delay
  asset_name="$(basename "$asset_path")"
  deadline="$(node -e 'import("./scripts/run-with-deadline.mjs").then((m) => console.log(m.transferDeadlineSeconds(Number(process.argv[1]))))' "$(stat -f %z "$asset_path")")"
  for ((attempt_idx = 1; attempt_idx <= RELEASE_UPLOAD_ATTEMPTS; attempt_idx++)); do
    upload_log="$(mktemp "$WORK/release-upload-log.XXXXXX")"
    chmod 600 "$upload_log"
    # gh has no upload timeout; a stalled route is killed at a size-aware deadline.
    if (
      export GH_TOKEN="$RELEASE_GH_TOKEN"
      release_github_transport node scripts/run-with-deadline.mjs "$deadline" \
        gh release upload "$TAG" -R "$REPO" --clobber "$asset_path"
    ) >"$upload_log" 2>&1; then
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
      if [ "$attempt_idx" -eq "$RELEASE_UPLOAD_ATTEMPTS" ]; then
        rm -f "$upload_log"
        echo "error: signed draft upload for $asset_name kept returning a name conflict without matching remote bytes" >&2
        return 1
      fi
      rm -f "$upload_log"
      echo "warning: signed draft upload for $asset_name reached an eventually consistent name conflict ($attempt_idx/$RELEASE_UPLOAD_ATTEMPTS); retrying only this --clobber asset" >&2
      sleep $((attempt_idx * 5))
      continue
    fi
    if ! node scripts/github-release-transfer-retry.mjs "$upload_log"; then
      rm -f "$upload_log"
      echo "error: signed draft upload for $asset_name failed without a retryable GitHub transport error" >&2
      return 1
    fi
    if [ "$attempt_idx" -eq "$RELEASE_UPLOAD_ATTEMPTS" ]; then
      rm -f "$upload_log"
      echo "error: signed draft upload for $asset_name exhausted $RELEASE_UPLOAD_ATTEMPTS transient GitHub transport attempts" >&2
      return 1
    fi
    rm -f "$upload_log"
    [ "$attempt_idx" -lt 2 ] || release_failover_github_proxy
    delay="$(release_backoff_seconds "$attempt_idx")"
    echo "warning: signed draft upload for $asset_name hit a transient GitHub transport failure ($attempt_idx/$RELEASE_UPLOAD_ATTEMPTS); retrying only this asset after ${delay}s" >&2
    sleep "$delay"
  done
}

# The only assets this host writes: both signed/notarized Mac builds and the rebuilt manifest.
REPLACED_ASSETS=(
  "Hara_${VER}_aarch64.dmg"
  "Hara_aarch64.app.tar.gz"
  "Hara_aarch64.app.tar.gz.sig"
  "Hara_${VER}_x64.dmg"
  "Hara_x64.app.tar.gz"
  "Hara_x64.app.tar.gz.sig"
  "latest.json"
)
release_upload_signed_assets() {
  local asset_name
  for asset_name in "${REPLACED_ASSETS[@]}"; do
    release_upload_signed_asset "$ASSET_DIR/$asset_name"
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
REMOTE_DESKTOP_COMMIT="$(release_github_transport node scripts/resolve-remote-tag.mjs . origin "$TAG")" || {
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
REMOTE_CLI_COMMIT="$(release_github_transport node scripts/resolve-remote-tag.mjs ../hara-cli origin "$CLI_TAG")" || {
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
  # Metadata-only reverification: the published asset set and every non-Mac digest must equal the
  # assembly record, the source archive its prepare-job digest; the small updater files are read and
  # latest.json validated. Public Mac bytes are verified by the hosted verify_public_release job.
  release_read_assets "$WORK/public-assets.json"
  node scripts/release-asset-digests.mjs check-draft "$WORK/public-assets.json" -env "${REPLACED_ASSETS[@]}"
  require_source_archive_digest "$WORK/public-assets.json" "public immutable release"
  release_download_small "$PUBLIC_DIR" "public immutable release signature download"
  node scripts/updater-manifest.mjs validate "$PUBLIC_DIR" "$TAG" --digest-bound -env
  node scripts/release-source-provenance.mjs validate \
    "$PUBLIC_DIR/release-source-provenance.json" "$TAG" "$TAG_COMMIT" "$CLI_TAG_COMMIT"
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

release_read_assets "$WORK/draft-assets.json"
node scripts/release-asset-digests.mjs check-draft "$WORK/draft-assets.json" -env "${REPLACED_ASSETS[@]}"
require_source_archive_digest "$WORK/draft-assets.json" "hidden draft"
release_download_small "$ASSET_DIR" "hidden draft signature download"
node scripts/updater-manifest.mjs validate "$ASSET_DIR" "$TAG" --digest-bound -env
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
rm -f "$ASSET_DIR/latest.json"
node scripts/updater-manifest.mjs build "$ASSET_DIR" "$TAG" "$PUB_DATE" --digest-bound -env
# Verify the exact bytes about to be uploaded: both Mac updater signatures cryptographically, the
# updater archives and the stapled, Gatekeeper-accepted DMGs.
node scripts/verify-release-updaters.mjs "$ASSET_DIR" Hara_aarch64.app.tar.gz Hara_x64.app.tar.gz
node scripts/mac-updater-smoke.mjs \
  "$ASSET_DIR/Hara_aarch64.app.tar.gz" aarch64-apple-darwin --require-signatures
HARA_FOREIGN_MAC_STATIC_VALIDATION=1 node scripts/mac-updater-smoke.mjs \
  "$ASSET_DIR/Hara_x64.app.tar.gz" x86_64-apple-darwin --require-signatures
verify_signed_dmg upload "$ASSET_DIR/Hara_${VER}_aarch64.dmg" aarch64-apple-darwin
verify_signed_dmg upload "$ASSET_DIR/Hara_${VER}_x64.dmg" x86_64-apple-darwin

release_upload_signed_assets

# Validate the remote draft by GitHub's server-side digests, not merely the local upload inputs:
# every replaced asset must equal the local bytes verified above and every other asset must still
# equal the assembly record. Only the small signature/manifest files are read back.
release_read_assets "$WORK/signed-assets.json"
node scripts/release-asset-digests.mjs check-final "$WORK/signed-assets.json" -env "$ASSET_DIR" "${REPLACED_ASSETS[@]}"
require_source_archive_digest "$WORK/signed-assets.json" "signed draft"
release_download_small "$REMOTE_DIR" "signed draft signature download"
cmp -s "$ASSET_DIR/latest.json" "$REMOTE_DIR/latest.json" || {
  echo "error: the draft's latest.json does not match the manifest built from the signed assets" >&2
  exit 1
}
node scripts/updater-manifest.mjs validate "$REMOTE_DIR" "$TAG" --digest-bound -env
node scripts/release-source-provenance.mjs validate \
  "$REMOTE_DIR/release-source-provenance.json" "$TAG" "$TAG_COMMIT" "$CLI_TAG_COMMIT"
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
FINAL_REMOTE_DESKTOP_COMMIT="$(release_github_transport node scripts/resolve-remote-tag.mjs . origin "$TAG")" || {
  echo "error: could not re-read remote desktop tag $TAG before publication" >&2
  exit 1
}
[ "$FINAL_REMOTE_DESKTOP_COMMIT" = "$TAG_COMMIT" ] || {
  echo "error: remote desktop tag moved before publication: $FINAL_REMOTE_DESKTOP_COMMIT != $TAG_COMMIT" >&2
  exit 1
}
FINAL_REMOTE_CLI_COMMIT="$(release_github_transport node scripts/resolve-remote-tag.mjs ../hara-cli origin "$CLI_TAG")" || {
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
