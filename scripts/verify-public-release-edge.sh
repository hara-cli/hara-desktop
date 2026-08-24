#!/usr/bin/env bash
# Verify the exact bytes users receive from GitHub's public Release edge on an independently
# networked hosted macOS runner. This job is read-only and runs only after immutable publication.
set -euo pipefail

TAG="${1:-}"
REPO="${GITHUB_REPOSITORY:-}"
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "public release verification requires a vX.Y.Z tag" >&2
  exit 2
}
[ "$REPO" = "hara-cli/hara-desktop" ] || {
  echo "public release verification is restricted to hara-cli/hara-desktop" >&2
  exit 2
}
[ -n "${GH_TOKEN:-}" ] || {
  echo "GH_TOKEN is required for immutable release verification" >&2
  exit 2
}

VERSION="${TAG#v}"
WORK_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$WORK_ROOT"' EXIT
chmod 700 "$WORK_ROOT"
RELEASE_METADATA="$WORK_ROOT/release.json"
EXPECTED_NAMES="$WORK_ROOT/expected-names.txt"
ACTUAL_NAMES="$WORK_ROOT/actual-names.txt"

gh release view "$TAG" -R "$REPO" \
  --json tagName,isDraft,isImmutable,isPrerelease,publishedAt,assets > "$RELEASE_METADATA"
jq -e --arg tag "$TAG" '
  .tagName == $tag and
  .isDraft == false and
  .isImmutable == true and
  .isPrerelease == false and
  (.publishedAt | type == "string" and length > 0) and
  (.assets | length == 17) and
  ([.assets[].name] | unique | length == 17) and
  all(.assets[];
    .state == "uploaded" and
    (.size | type == "number" and . > 0) and
    (.digest | type == "string" and test("^sha256:[0-9a-f]{64}$"))
  )
' "$RELEASE_METADATA" >/dev/null

printf '%s\n' \
  "Hara-${VERSION}-1.x86_64.rpm" \
  "Hara-${VERSION}-1.x86_64.rpm.sig" \
  "Hara_${VERSION}_aarch64.dmg" \
  "Hara_${VERSION}_amd64.deb" \
  "Hara_${VERSION}_amd64.deb.sig" \
  "Hara_${VERSION}_source-packs.zip" \
  "Hara_${VERSION}_x64-setup.exe" \
  "Hara_${VERSION}_x64-setup.exe.sig" \
  "Hara_${VERSION}_x64.dmg" \
  "Hara_${VERSION}_x64_en-US.msi" \
  "Hara_${VERSION}_x64_en-US.msi.sig" \
  "Hara_aarch64.app.tar.gz" \
  "Hara_aarch64.app.tar.gz.sig" \
  "Hara_x64.app.tar.gz" \
  "Hara_x64.app.tar.gz.sig" \
  "latest.json" \
  "release-source-provenance.json" | LC_ALL=C sort > "$EXPECTED_NAMES"
jq -r '.assets[].name' "$RELEASE_METADATA" | LC_ALL=C sort > "$ACTUAL_NAMES"
cmp -s "$EXPECTED_NAMES" "$ACTUAL_NAMES" || {
  echo "public immutable release asset set is not canonical" >&2
  diff -u "$EXPECTED_NAMES" "$ACTUAL_NAMES" >&2 || true
  exit 1
}

gh release verify "$TAG" -R "$REPO" >/dev/null

public_curl() {
  /usr/bin/curl \
    --disable \
    --http1.1 \
    --proto '=https' \
    --proto-redir '=https' \
    --fail \
    --location \
    --silent \
    --show-error \
    --retry 5 \
    --retry-all-errors \
    --retry-delay 2 \
    --retry-max-time 540 \
    --connect-timeout 20 \
    --max-time 570 \
    --speed-limit 1024 \
    --speed-time 60 \
    "$@"
}

download_attested_asset() {
  local asset_name="$1"
  local target_file="$2"
  local asset_json expected_size expected_sha expected_url actual_size actual_sha partial_file
  asset_json="$(
    jq -ce --arg name "$asset_name" '
      [.assets[] | select(.name == $name)] |
      if length == 1 then .[0] else error("expected exactly one public asset") end
    ' "$RELEASE_METADATA"
  )"
  expected_size="$(jq -r .size <<<"$asset_json")"
  expected_sha="$(jq -r .digest <<<"$asset_json")"
  expected_sha="${expected_sha#sha256:}"
  expected_url="https://github.com/$REPO/releases/download/$TAG/$asset_name"
  [ "$(jq -r .url <<<"$asset_json")" = "$expected_url" ] || {
    echo "public asset URL is not bound to the exact tag: $asset_name" >&2
    exit 1
  }

  partial_file="${target_file}.partial"
  rm -f "$target_file" "$partial_file"
  public_curl --output "$partial_file" "$expected_url"
  actual_size="$(/usr/bin/stat -f '%z' "$partial_file")"
  actual_sha="$(/usr/bin/shasum -a 256 "$partial_file" | /usr/bin/awk '{print $1}')"
  [ "$actual_size" = "$expected_size" ] && [ "$actual_sha" = "$expected_sha" ] || {
    echo "public asset bytes do not match the immutable attestation: $asset_name" >&2
    exit 1
  }
  mv "$partial_file" "$target_file"
  echo "public-edge: verified $asset_name ($actual_size bytes)"
}

ARM_DMG="$WORK_ROOT/Hara_${VERSION}_aarch64.dmg"
X64_DMG="$WORK_ROOT/Hara_${VERSION}_x64.dmg"
IMMUTABLE_LATEST="$WORK_ROOT/latest-immutable.json"
STABLE_LATEST="$WORK_ROOT/latest-stable.json"

download_attested_asset "Hara_${VERSION}_aarch64.dmg" "$ARM_DMG"
download_attested_asset "Hara_${VERSION}_x64.dmg" "$X64_DMG"
download_attested_asset "latest.json" "$IMMUTABLE_LATEST"

/usr/sbin/spctl -a -t open --context context:primary-signature -v "$ARM_DMG"
/usr/sbin/spctl -a -t open --context context:primary-signature -v "$X64_DMG"

LATEST_MATCHED=0
for attempt in {1..12}; do
  if public_curl \
    --output "$STABLE_LATEST" \
    "https://github.com/$REPO/releases/latest/download/latest.json" && \
    cmp -s "$IMMUTABLE_LATEST" "$STABLE_LATEST"; then
    LATEST_MATCHED=1
    break
  fi
  echo "public latest.json has not converged to $TAG yet (attempt $attempt/12)"
  /bin/sleep 5
done
[ "$LATEST_MATCHED" = "1" ] || {
  echo "public latest.json has not converged to the immutable $TAG manifest" >&2
  exit 1
}
jq -e --arg version "$VERSION" '
  .version == $version and
  (.pub_date | type == "string" and length > 0) and
  (.platforms | type == "object" and length == 10) and
  all(.platforms[];
    (.signature | type == "string" and length > 50) and
    (.url | type == "string" and contains("/releases/download/v" + $version + "/"))
  )
' "$STABLE_LATEST" >/dev/null

echo "public-edge: $TAG immutable DMGs, Gatekeeper trust, and latest.json are verified"
