import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readGitHubApi } from "../scripts/github-api-read.mjs";
import {
  parseRemoteTagRefs,
  resolveRemoteTagCommit,
} from "../scripts/resolve-remote-tag.mjs";
import {
  isTransientNotaryFailure,
  notarizeArtifact,
  parseNotaryResponse,
} from "../scripts/notarize-artifact.mjs";
import { requireStableTag, requireStableVersion } from "../scripts/release-policy.mjs";
import { isTransientStaplerFailure } from "../scripts/stapler-validate.mjs";
import {
  assertReleaseSource,
  expectedReleaseSource,
} from "../scripts/release-source-provenance.mjs";
import { canUseRosettaSmoke } from "../scripts/sidecar-smoke.mjs";
import { useForeignMacStaticValidation } from "../scripts/foreign-mac-validation.mjs";
import { isTransientCodesignTimestampFailure } from "../scripts/codesign-timestamp-retry.mjs";
import { isTransientGitHubReleaseTransferFailure } from "../scripts/github-release-transfer-retry.mjs";
import {
  RELEASE_DOWNLOAD_TIMEOUT_MS,
  releaseDownloadArguments,
  runBoundedReleaseDownload,
} from "../scripts/github-release-download.mjs";
import {
  RELEASE_API_ASSET_TIMEOUT_MS,
  RELEASE_API_CURL_MAX_TIME_SECONDS,
  downloadReleaseAssetsViaApi,
  releaseApiAssets,
  releaseApiDownloadArguments,
} from "../scripts/github-release-api-download.mjs";
import { reconcileReleaseDownloadCache } from "../scripts/release-download-cache.mjs";
import { releaseAssetMatches } from "../scripts/release-asset-digest-match.mjs";
import {
  buildMirrorManifest,
  validateMirrorManifest,
} from "../scripts/updater-mirror-manifest.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const node = process.execPath;
const desktopCommit = "1".repeat(40);
const targets = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "x86_64-unknown-linux-gnu",
  "x86_64-pc-windows-msvc",
];
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const sidecarVersion = readFileSync(join(root, "src-tauri/binaries/SIDECAR_VERSION"), "utf8").trim();
const cliCommit = readFileSync(join(root, "src-tauri/binaries/SIDECAR_COMMIT"), "utf8").trim();
const nodeVersion = readFileSync(join(root, ".node-version"), "utf8").trim();
const bunVersion = readFileSync(join(root, ".bun-version"), "utf8").trim();
const rustVersion = readFileSync(join(root, ".rust-version"), "utf8").trim();

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    ...options,
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function writeReceiptFixture(directory, { mismatchedCliTarget } = {}) {
  for (const [index, target] of targets.entries()) {
    const asset = `fixture-${index}.bin`;
    const contents = `verified release bytes for ${target}\n`;
    writeFileSync(join(directory, asset), contents);
    writeFileSync(
      join(directory, `matrix-receipt-${target}.json`),
      `${JSON.stringify(
        {
          schema: 3,
          desktopVersion: version,
          desktopCommit,
          sidecarVersion,
          cliCommit: target === mismatchedCliTarget ? "3".repeat(40) : cliCommit,
          nodeVersion,
          bunVersion,
          rustVersion,
          target,
          updaterSignaturesVerified: true,
          files: { [asset]: sha256(contents) },
        },
        null,
        2,
      )}\n`,
    );
  }
}

function writeMacProvenanceFixture(bundle, target) {
  const architecture = target === "aarch64-apple-darwin" ? "aarch64" : "x64";
  mkdirSync(join(bundle, "dmg"), { recursive: true });
  mkdirSync(join(bundle, "macos"), { recursive: true });
  writeFileSync(join(bundle, "dmg", `Hara_${version}_${architecture}.dmg`), `${target} dmg\n`);
  writeFileSync(join(bundle, "macos", "Hara.app.tar.gz"), `${target} updater\n`);
  writeFileSync(join(bundle, "macos", "Hara.app.tar.gz.sig"), `${target} signature\n`);
}

test("stable policy rejects prerelease versions and tags", () => {
  assert.equal(requireStableVersion("1.2.3"), "1.2.3");
  assert.equal(requireStableTag("v1.2.3", "1.2.3"), "v1.2.3");
  assert.throws(() => requireStableVersion("1.2.3-rc.1"), /stable X\.Y\.Z/);
  assert.throws(() => requireStableTag("v1.2.3-rc.1", "1.2.3-rc.1"), /stable X\.Y\.Z/);
});

test("desktop updater uses the first-party signed channel before GitHub", () => {
  const tauri = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const endpoints = [
    "https://assets.nanhara.com/hara/desktop/stable/latest.json",
    "https://github.com/hara-cli/hara-desktop/releases/latest/download/latest.json",
  ];
  assert.deepEqual(tauri.plugins.updater.endpoints, endpoints);

  const native = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
  for (const endpoint of endpoints) assert.match(native, new RegExp(endpoint.replaceAll(".", "\\.")));
  const context = native.indexOf("let context = tauri::generate_context!()");
  const diagnostic = native.indexOf("release_updater_endpoints(context.config())", context);
  const build = native.indexOf(".build(context)", diagnostic);
  assert.ok(context >= 0 && diagnostic > context && build > diagnostic);
  assert.match(native, /--hara-release-updater-endpoint-smoke/);
});

test("first-party updater manifest preserves signatures and rewrites only exact release assets", () => {
  const tag = `v${version}`;
  const signature = "trusted updater signature ".repeat(4);
  const assets = {
    "darwin-aarch64": "Hara_aarch64.app.tar.gz",
    "darwin-aarch64-app": "Hara_aarch64.app.tar.gz",
    "darwin-x86_64": "Hara_x64.app.tar.gz",
    "darwin-x86_64-app": "Hara_x64.app.tar.gz",
    "linux-x86_64": `Hara_${version}_amd64.deb`,
    "linux-x86_64-deb": `Hara_${version}_amd64.deb`,
    "linux-x86_64-rpm": `Hara-${version}-1.x86_64.rpm`,
    "windows-x86_64": `Hara_${version}_x64_en-US.msi`,
    "windows-x86_64-msi": `Hara_${version}_x64_en-US.msi`,
    "windows-x86_64-nsis": `Hara_${version}_x64-setup.exe`,
  };
  const canonical = {
    version,
    notes: `Hara Desktop ${version}`,
    pub_date: "2026-07-31T03:30:00.000Z",
    platforms: Object.fromEntries(
      Object.entries(assets).map(([platform, asset]) => [
        platform,
        {
          signature,
          url: `https://github.com/hara-cli/hara-desktop/releases/download/${tag}/${encodeURIComponent(asset)}`,
        },
      ]),
    ),
  };

  const mirror = buildMirrorManifest(canonical, tag);
  validateMirrorManifest(mirror, tag);
  assert.deepEqual(
    {
      version: mirror.version,
      notes: mirror.notes,
      pub_date: mirror.pub_date,
    },
    {
      version: canonical.version,
      notes: canonical.notes,
      pub_date: canonical.pub_date,
    },
  );
  for (const [platform, asset] of Object.entries(assets)) {
    assert.equal(mirror.platforms[platform].signature, signature);
    assert.equal(
      mirror.platforms[platform].url,
      `https://assets.nanhara.com/hara/desktop/${tag}/${encodeURIComponent(asset)}`,
    );
  }

  const hostile = structuredClone(mirror);
  hostile.platforms["darwin-aarch64"].url =
    `https://assets.nanhara.com/hara/desktop/${tag}/Hara_aarch64.app.tar.gz?redirect=github`;
  assert.throws(() => validateMirrorManifest(hostile, tag), /URL mismatch/);
});

test("remote tag resolution prefers the peeled commit and retries within hard bounds", () => {
  const directCommit = "a".repeat(40);
  const peeledCommit = "b".repeat(40);
  const tag = "v1.2.3";
  const refs = `${directCommit}\trefs/tags/${tag}\n${peeledCommit}\trefs/tags/${tag}^{}\n`;
  assert.equal(parseRemoteTagRefs(refs, tag), peeledCommit);
  assert.throws(
    () => parseRemoteTagRefs(`${directCommit}\trefs/tags/v9.9.9\n`, tag),
    /unexpected tag ref/,
  );

  let calls = 0;
  const commit = resolveRemoteTagCommit(".", "origin", tag, {
    timeoutMs: 1_234,
    sleep: () => {},
    execute(command, args, options) {
      calls++;
      assert.equal(command, "git");
      assert.equal(options.timeout, 1_234);
      assert.equal(options.killSignal, "SIGKILL");
      assert.deepEqual(args.slice(0, 6), [
        "-c",
        "http.version=HTTP/1.1",
        "-c",
        "http.lowSpeedLimit=1024",
        "-c",
        "http.lowSpeedTime=20",
      ]);
      assert.equal(options.env.GIT_TERMINAL_PROMPT, "0");
      if (calls < 3) throw new Error("transient transport reset");
      return refs;
    },
  });
  assert.equal(commit, peeledCommit);
  assert.equal(calls, 3);
  let invalidCalls = 0;
  assert.throws(
    () =>
      resolveRemoteTagCommit(".", "origin", "--upload-pack=malicious", {
        execute() {
          invalidCalls++;
        },
      }),
    /stable vX\.Y\.Z/,
  );
  assert.equal(invalidCalls, 0);
});

test("release policy API reads retry without exposing mutation flags", () => {
  let calls = 0;
  const primaryProxy = "socks5h://127.0.0.1:1081";
  const fallbackProxy = "socks5h://127.0.0.1:1080";
  const result = readGitHubApi(
    "repos/hara-cli/hara-desktop/immutable-releases",
    ["--jq", ".enabled"],
    {
      timeoutMs: 2_345,
      sleep: () => {},
      environment: {
        HARA_GITHUB_RELEASE_PROXY: primaryProxy,
        HARA_GITHUB_RELEASE_FALLBACK_PROXY: fallbackProxy,
        NO_PROXY: ".github.com",
      },
      execute(command, args, options) {
        calls++;
        assert.equal(command, "gh");
        assert.deepEqual(args, [
          "api",
          "repos/hara-cli/hara-desktop/immutable-releases",
          "--jq",
          ".enabled",
        ]);
        assert.equal(options.timeout, 2_345);
        assert.equal(options.env.GH_HOST, "github.com");
        assert.equal(options.env.GH_PROMPT_DISABLED, "true");
        assert.equal(options.env.NO_PROXY, "");
        assert.equal(options.env.no_proxy, "");
        assert.equal(options.env.HTTPS_PROXY, calls === 1 ? primaryProxy : fallbackProxy);
        assert.equal(options.env.HTTP_PROXY, calls === 1 ? primaryProxy : fallbackProxy);
        assert.equal(options.env.HARA_GITHUB_RELEASE_PROXY, undefined);
        assert.equal(options.env.HARA_GITHUB_RELEASE_FALLBACK_PROXY, undefined);
        if (calls === 1) throw new Error("TLS handshake timeout");
        return "true\n";
      },
    },
  );
  assert.equal(result, "true");
  assert.equal(calls, 2);
  let directEnvironment;
  assert.equal(
    readGitHubApi("repos/hara-cli/hara-desktop/immutable-releases", [], {
      environment: { NO_PROXY: "api.github.com" },
      execute(_command, _args, options) {
        directEnvironment = options.env;
        return "true";
      },
    }),
    "true",
  );
  assert.equal(directEnvironment.NO_PROXY, "api.github.com");
  assert.equal(directEnvironment.HTTPS_PROXY, undefined);
  assert.throws(
    () =>
      readGitHubApi("repos/hara-cli/hara-desktop/immutable-releases", [], {
        environment: { HARA_GITHUB_RELEASE_PROXY: "https://proxy.example.com" },
        execute() {
          throw new Error("must not execute with an untrusted proxy");
        },
      }),
    /loopback/,
  );
  assert.throws(
    () => readGitHubApi("https://api.github.com/repos/hara-cli/hara-desktop", []),
    /repository-relative/,
  );
  assert.throws(
    () =>
      readGitHubApi("repos/hara-cli/hara-desktop/releases", [
        "--method",
        "DELETE",
      ]),
    /unsupported read-only/,
  );
});

test("release source provenance binds Desktop, CLI, build toolchains, and every native target", () => {
  const expected = expectedReleaseSource({ tag: `v${version}`, desktopCommit, cliCommit });
  assert.equal(expected.desktopCommit, desktopCommit);
  assert.equal(expected.cliCommit, cliCommit);
  assert.equal(expected.sidecarVersion, sidecarVersion);
  assert.equal(expected.nodeVersion, nodeVersion);
  assert.equal(expected.bunVersion, bunVersion);
  assert.equal(expected.rustVersion, rustVersion);
  assert.deepEqual(expected.targets, targets);
  assert.deepEqual(assertReleaseSource(structuredClone(expected), expected), expected);
  assert.throws(
    () => assertReleaseSource({ ...expected, cliCommit: "3".repeat(40) }, expected),
    /does not match/,
  );
});

test("signed Mac provenance is atomic, run-scoped, and independent from Tauri bundle cleanup", () => {
  const directory = mkdtempSync(join(tmpdir(), "hara-signed-provenance-"));
  const markerDirectory = join(directory, "markers", "run-123", `v${version}`);
  const armBundle = join(directory, "arm-bundle");
  const x64Bundle = join(directory, "x64-bundle");
  try {
    for (const [bundle, target] of [
      [armBundle, "aarch64-apple-darwin"],
      [x64Bundle, "x86_64-apple-darwin"],
    ]) {
      writeMacProvenanceFixture(bundle, target);
      const written = run(node, [
        "scripts/release-provenance.mjs",
        "write",
        bundle,
        markerDirectory,
        target,
        `v${version}`,
        desktopCommit,
        cliCommit,
      ]);
      assert.equal(written.status, 0, written.stderr);
      assert.equal(
        existsSync(join(markerDirectory, `hara-release-provenance-${target}.json`)),
        true,
      );
      assert.equal(
        existsSync(join(bundle, `hara-release-provenance-${target}.json`)),
        false,
        "Tauri-owned bundle directories must not own promotion markers",
      );
    }

    for (const [bundle, target] of [
      [armBundle, "aarch64-apple-darwin"],
      [x64Bundle, "x86_64-apple-darwin"],
    ]) {
      const verified = run(node, [
        "scripts/release-provenance.mjs",
        "verify",
        bundle,
        markerDirectory,
        target,
        `v${version}`,
        desktopCommit,
        cliCommit,
      ]);
      assert.equal(verified.status, 0, verified.stderr);
    }

    writeFileSync(join(armBundle, "macos", "Hara.app.tar.gz"), "tampered\n");
    const tampered = run(node, [
      "scripts/release-provenance.mjs",
      "verify",
      armBundle,
      markerDirectory,
      "aarch64-apple-darwin",
      `v${version}`,
      desktopCommit,
      cliCommit,
    ]);
    assert.notEqual(tampered.status, 0);
    assert.match(tampered.stderr, /do not match their tagged build provenance/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("signed build cleanup preserves the original failure on macOS Bash 3.2", () => {
  const signedBuild = readFileSync(join(root, "scripts/build-mac-signed.sh"), "utf8");
  const shellSafety = readFileSync(join(root, "scripts/release-shell-safety.sh"), "utf8");
  assert.match(signedBuild, /source scripts\/release-shell-safety\.sh/);
  assert.match(
    signedBuild,
    /trap 'hara_exit_with_cleanup "\$\{SIGNED_BUILD_COMPLETED:-0\}" clear_signing_environment' EXIT/,
  );
  assert.match(signedBuild, /SIGNED_BUILD_COMPLETED=1\s*$/);
  assert.match(signedBuild, /ORIGINAL_KEYCHAIN_COUNT=0/);
  assert.doesNotMatch(signedBuild, /for (?:existing|keychain) in "\$\{ORIGINAL_KEYCHAINS\[@\]\}"/);
  assert.match(
    shellSafety,
    /local status="\$\?"[\s\S]*completed[\s\S]*trap - EXIT[\s\S]*completed.*status[\s\S]*exit "\$status"/,
  );

  const preserved = run("/bin/bash", [
    "-c",
    [
      "set -euo pipefail",
      "source scripts/release-shell-safety.sh",
      'cleanup() { printf "cleanup-ran\\n"; }',
      "trap 'hara_exit_with_cleanup 0 cleanup' EXIT",
      "exit 37",
    ].join("\n"),
  ]);
  assert.equal(preserved.status, 37, preserved.stderr);
  assert.match(preserved.stdout, /cleanup-ran/);

  const bashMajor = run("/bin/bash", ["-c", 'printf "%s" "${BASH_VERSINFO[0]}"']);
  if (bashMajor.stdout === "3") {
    const nounsetFailure = run("/bin/bash", [
      "-c",
      [
        "set -euo pipefail",
        "source scripts/release-shell-safety.sh",
        'cleanup() { printf "cleanup-ran\\n"; }',
        "trap 'hara_exit_with_cleanup 0 cleanup' EXIT",
        "empty=()",
        'explode() { printf "%s" "${empty[@]}"; }',
        "explode",
      ].join("\n"),
    ]);
    assert.notEqual(nounsetFailure.status, 0, nounsetFailure.stderr);
    assert.match(nounsetFailure.stdout, /cleanup-ran/);
  }
});

test("matrix receipt aggregation accepts only one pinned source identity", () => {
  const successDirectory = mkdtempSync(join(tmpdir(), "hara-matrix-success-"));
  const failureDirectory = mkdtempSync(join(tmpdir(), "hara-matrix-failure-"));
  try {
    writeReceiptFixture(successDirectory);
    const success = run(node, [
      "scripts/verify-matrix-receipts.mjs",
      successDirectory,
      desktopCommit,
      cliCommit,
    ]);
    assert.equal(success.status, 0, success.stderr);

    writeReceiptFixture(failureDirectory, { mismatchedCliTarget: targets[2] });
    const failure = run(node, [
      "scripts/verify-matrix-receipts.mjs",
      failureDirectory,
      desktopCommit,
      cliCommit,
    ]);
    assert.notEqual(failure.status, 0);
    assert.match(failure.stderr, /invalid matrix verification receipt/);
  } finally {
    rmSync(successDirectory, { recursive: true, force: true });
    rmSync(failureDirectory, { recursive: true, force: true });
  }
});

test("Tauri performs the sole Developer ID signing pass after Bun signature removal", () => {
  const script = readFileSync(join(root, "scripts/build-mac-signed.sh"), "utf8");
  const refresh = script.indexOf("./scripts/refresh-sidecar.sh");
  const removeSignature = script.indexOf('codesign --remove-signature "$SIDECAR"');
  const cacheClean = script.indexOf(
    "cargo clean --manifest-path src-tauri/Cargo.toml --package hara-desktop",
    removeSignature,
  );
  const tauriBuild = script.indexOf("npm run tauri build", removeSignature);
  const packagedSmoke = script.indexOf("node scripts/package-smoke.mjs", tauriBuild);
  assert.ok(refresh >= 0 && refresh < removeSignature, "boundary smoke must precede signature removal");
  assert.ok(
    removeSignature < cacheClean && cacheClean < tauriBuild,
    "architecture-specific generated configuration must be invalidated before Tauri builds",
  );
  assert.ok(removeSignature < tauriBuild, "Tauri must receive the unsigned source sidecar");
  const unsignedGap = script.slice(removeSignature, tauriBuild);
  assert.doesNotMatch(unsignedGap, /codesign --force|sidecar-smoke\.mjs/);
  assert.match(unsignedGap, /if codesign --verify "\$SIDECAR"/);
  assert.ok(packagedSmoke > tauriBuild, "only the Tauri-packaged sidecar may execute after normalization");
  assert.match(script, /PACKAGED_SIDECAR_SIGNATURE=.*codesign -d --verbose=4/);
  assert.match(script, /Authority=\$IDENTITY/);
  assert.match(script, /\^Timestamp=/);
  assert.match(
    script,
    /cargo clean --manifest-path src-tauri\/Cargo\.toml --package hara-desktop --target "\$TARGET"/,
  );
});

test("signed Tauri bundling retries only bounded Apple signing-service transport failures", () => {
  assert.equal(
    isTransientCodesignTimestampFailure("codesign: A timestamp was expected but was not found."),
    true,
  );
  assert.equal(
    isTransientCodesignTimestampFailure(
      "codesign timestamp request failed: NSURLErrorDomain Code=-1001 request timed out",
    ),
    true,
  );
  assert.equal(
    isTransientCodesignTimestampFailure("codesign: The timestamp service is temporarily unavailable"),
    true,
  );
  assert.equal(
    isTransientCodesignTimestampFailure(
      "failed codesign application: failed to notarize app: Error: HTTPClientError.connectTimeout",
    ),
    true,
  );
  assert.equal(
    isTransientCodesignTimestampFailure(
      'failed codesign application: failed to notarize app: Error: HTTPError(statusCode: nil, error: Error Domain=NSURLErrorDomain Code=-1001 "The request timed out." UserInfo={NSErrorFailingURLStringKey=https://appstoreconnect.apple.com/notary/v2/submissions?})',
    ),
    true,
  );
  assert.equal(isTransientCodesignTimestampFailure("codesign: errSecInternalComponent"), false);
  assert.equal(isTransientCodesignTimestampFailure("Developer ID signing identity was not found"), false);
  assert.equal(
    isTransientCodesignTimestampFailure("failed to notarize app: Invalid bundle signature"),
    false,
  );
  assert.equal(
    isTransientCodesignTimestampFailure(
      "NSURLErrorDomain Code=-1001 request timed out\nfailed to notarize app: Invalid bundle signature",
    ),
    false,
  );

  const script = readFileSync(join(root, "scripts/build-mac-signed.sh"), "utf8");
  assert.match(script, /TAURI_BUILD_ATTEMPTS=3/);
  assert.match(script, /node scripts\/codesign-timestamp-retry\.mjs "\$TAURI_BUILD_LOG"/);
  assert.match(script, /rm -rf "\$RELEASE_BASE\/bundle"/);
  assert.match(script, /chmod 600 "\$TAURI_BUILD_LOG"/);
  assert.doesNotMatch(script, /--timestamp(?:=none|\s+none)|APPLE_SIGNING_IDENTITY=""/);
});

test("release asset transfers retry only bounded GitHub transport failures with a verified cache", () => {
  assert.equal(
    isTransientGitHubReleaseTransferFailure(
      "read tcp 198.18.15.206:57233->185.199.110.133:443: read: connection reset by peer",
    ),
    true,
  );
  assert.equal(
    isTransientGitHubReleaseTransferFailure("TLS handshake timeout while downloading release asset"),
    true,
  );
  assert.equal(
    isTransientGitHubReleaseTransferFailure("HTTP 503 Service Unavailable"),
    true,
  );
  assert.equal(
    isTransientGitHubReleaseTransferFailure("HTTP 403: Resource not accessible by integration"),
    false,
  );
  assert.equal(
    isTransientGitHubReleaseTransferFailure(
      "HTTP 403: Resource not accessible by integration; connection reset by peer",
    ),
    false,
  );
  assert.equal(
    isTransientGitHubReleaseTransferFailure("release not found"),
    false,
  );
  assert.equal(
    isTransientGitHubReleaseTransferFailure("updater signature digest mismatch"),
    false,
  );

  const script = readFileSync(join(root, "scripts/release-mac-assets.sh"), "utf8");
  assert.match(script, /readonly RELEASE_TRANSFER_ATTEMPTS=3/);
  assert.match(script, /attempt <= RELEASE_TRANSFER_ATTEMPTS/g);
  assert.match(script, /release_view_with_retry\(\)/);
  assert.match(script, /release state read hit a transient GitHub transport failure/);
  assert.match(script, /release_github_transport/);
  assert.match(script, /HARA_GITHUB_RELEASE_PROXY/);
  assert.match(script, /HARA_GITHUB_RELEASE_FALLBACK_PROXY/);
  assert.match(script, /release_github_proxy_works/);
  assert.match(script, /export NO_PROXY=/);
  assert.match(script, /export no_proxy=/);
  assert.match(script, /export HTTPS_PROXY="\$RELEASE_GITHUB_PROXY"/);
  assert.match(script, /RELEASE_STATE="\$\(release_view_with_retry --json isDraft,isImmutable,isPrerelease/);
  assert.match(script, /release_view_with_retry --json isDraft --jq \.isDraft/g);
  assert.match(script, /mktemp -d "\$WORK\/release-download\.XXXXXX"/);
  assert.match(script, /chmod 600 "\$log"/);
  assert.match(script, /github-release-transfer-retry\.mjs "\$log"/);
  assert.match(script, /release_download_with_api_fallback\(\)/);
  assert.match(script, /github-release-api-download\.mjs/);
  assert.match(script, /digest-verified per-asset API downloads/);
  assert.match(script, /release view "\$TAG" -R "\$REPO" --json assets/);
  assert.match(script, /release-download-cache\.mjs "\$metadata" "\$stage"/);
  assert.match(script, /--skip-existing/);
  assert.match(script, /--complete/);
  assert.match(script, /release_download_all "\$ASSET_DIR" "hidden draft download"/);
  assert.match(script, /release_download_all "\$REMOTE_DIR" "signed draft verification download"/);
  assert.match(script, /release_download_all "\$PUBLIC_DIR" "public immutable release download"/);
  assert.match(script, /release_upload_signed_assets/);
  assert.match(script, /release_upload_signed_asset "\$asset_path"/);
  assert.match(script, /release_remote_asset_matches "\$asset_path"/);
  assert.match(script, /release-asset-digest-match\.mjs "\$metadata" "\$source"/);
  assert.match(
    script,
    /release_gh_download "\$TAG" "\$REPO" "\$stage"[\s\S]*?--pattern "\$asset_name"/,
  );
  assert.match(script, /cmp -s "\$source" "\$stage\/\$asset_name"/);
  assert.match(script, /ReleaseAsset\.name already exists/);
  assert.match(script, /retrying only this --clobber asset/);
  assert.match(script, /for asset_path in "\$\{assets\[@\]\}"/);
  assert.match(script, /retrying only this asset/);
  assert.doesNotMatch(
    script,
    /retrying the complete clobber set/,
    "a partial upload must never replay all signed assets",
  );
  assert.match(script, /retrying with only digest-verified completed assets/);
  assert.doesNotMatch(script, /retrying from a fresh private staging directory/);
});

test("release API fallback accepts only repository-bound assets and exact downloaded bytes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hara-release-api-download-"));
  try {
    const alpha = Buffer.from("verified alpha release asset\n");
    const beta = Buffer.from("verified beta release asset\n");
    writeFileSync(join(directory, "alpha.bin"), alpha);
    const metadata = {
      assets: [
        {
          name: "alpha.bin",
          size: alpha.length,
          digest: `sha256:${sha256(alpha)}`,
          state: "uploaded",
          apiUrl: "https://api.github.com/repos/hara-cli/hara-desktop/releases/assets/101",
        },
        {
          name: "beta.bin",
          size: beta.length,
          digest: `sha256:${sha256(beta)}`,
          state: "uploaded",
          apiUrl: "https://api.github.com/repos/hara-cli/hara-desktop/releases/assets/102",
        },
      ],
    };
    const calls = [];
    const configs = [];
    const environments = [];
    let observedOutputPath;
    const result = await downloadReleaseAssetsViaApi(
      { metadata, repository: "hara-cli/hara-desktop", directory },
      {
        timeoutMs: 1_000,
        token: "test-token",
        execute(command, arguments_, options) {
          calls.push({ command, arguments_ });
          environments.push(options.env);
          if (
            arguments_.includes(
              "https://api.github.com/repos/hara-cli/hara-desktop/releases/assets/102",
            )
          ) {
            observedOutputPath = arguments_[arguments_.indexOf("--output") + 1];
            writeFileSync(observedOutputPath, beta);
          }
          const listeners = new Map();
          queueMicrotask(() => listeners.get("close")?.(0, null));
          return {
            stdin: {
              on() {},
              end(value) {
                configs.push(value);
              },
            },
            once(event, listener) {
              listeners.set(event, listener);
            },
            kill() {
              return true;
            },
          };
        },
      },
    );

    assert.deepEqual(result, { expected: 2, retained: 1, downloaded: 1 });
    assert.equal(readFileSync(join(directory, "beta.bin"), "utf8"), beta.toString());
    assert.deepEqual(calls, [
      {
        command: "/usr/bin/curl",
        arguments_: [
          "--disable",
          "--http1.1",
          "--proto",
          "=https",
          "--proto-redir",
          "=https",
          "--fail",
          "--location",
          "--silent",
          "--show-error",
          "--retry",
          "5",
          "--retry-all-errors",
          "--retry-delay",
          "2",
          "--connect-timeout",
          "20",
          "--max-time",
          "570",
          "--speed-limit",
          "1024",
          "--speed-time",
          "60",
          "--continue-at",
          "-",
          "--output",
          observedOutputPath,
          "--config",
          "-",
          "https://api.github.com/repos/hara-cli/hara-desktop/releases/assets/102",
        ],
      },
    ]);
    assert.deepEqual(configs, [
      'header = "Authorization: Bearer test-token"\nheader = "Accept: application/octet-stream"\n',
    ]);
    assert.equal(environments.length, 1);
    assert.equal(environments[0].GH_TOKEN, undefined);
    assert.equal(environments[0].GITHUB_TOKEN, undefined);
    assert.equal(environments[0].NO_PROXY, "");
    assert.equal(environments[0].no_proxy, "");
    assert.equal(RELEASE_API_ASSET_TIMEOUT_MS, 600_000);
    assert.equal(RELEASE_API_CURL_MAX_TIME_SECONDS, 570);
    assert.throws(
      () =>
        releaseApiAssets(
          {
            assets: [
              {
                ...metadata.assets[0],
                apiUrl: "https://api.github.com/repos/other/repository/releases/assets/101",
              },
            ],
          },
          "hara-cli/hara-desktop",
        ),
      /outside the expected repository/,
    );
    assert.throws(
      () =>
        releaseApiDownloadArguments(
          "https://api.github.com/repos/hara-cli/hara-desktop/releases/assets/101 --request DELETE",
          join(directory, "asset.part"),
        ),
      /endpoint is invalid/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("uncertain release uploads reconcile only against one exact GitHub SHA-256 asset", () => {
  const directory = mkdtempSync(join(tmpdir(), "hara-release-asset-digest-"));
  try {
    const assetPath = join(directory, "Hara_x64.app.tar.gz");
    const contents = Buffer.from("signed and notarized updater bytes\n");
    writeFileSync(assetPath, contents);
    const matching = {
      assets: [
        {
          name: "Hara_x64.app.tar.gz",
          size: contents.length,
          digest: `sha256:${sha256(contents)}`,
        },
      ],
    };

    assert.equal(releaseAssetMatches(assetPath, matching), true);
    assert.equal(
      releaseAssetMatches(assetPath, {
        assets: [{ ...matching.assets[0], digest: `sha256:${"0".repeat(64)}` }],
      }),
      false,
    );
    assert.equal(
      releaseAssetMatches(assetPath, {
        assets: [{ ...matching.assets[0], size: contents.length + 1 }],
      }),
      false,
    );
    assert.throws(
      () => releaseAssetMatches(assetPath, { assets: [...matching.assets, ...matching.assets] }),
      /exactly one remote release asset/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("release download cache retains only exact GitHub-declared bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "hara-release-download-cache-"));
  try {
    const alpha = Buffer.from("complete alpha asset\n");
    const beta = Buffer.from("complete beta asset\n");
    const metadata = {
      assets: [
        { name: "alpha.bin", size: alpha.length, digest: `sha256:${sha256(alpha)}` },
        { name: "beta.bin", size: beta.length, digest: `sha256:${sha256(beta)}` },
      ],
    };
    writeFileSync(join(directory, "alpha.bin"), alpha);
    writeFileSync(join(directory, "beta.bin"), "partial");
    writeFileSync(join(directory, "unexpected.tmp"), "partial response");

    assert.deepEqual(reconcileReleaseDownloadCache(directory, metadata), { expected: 2, retained: 1 });
    assert.equal(existsSync(join(directory, "alpha.bin")), true);
    assert.equal(existsSync(join(directory, "beta.bin")), false);
    assert.equal(existsSync(join(directory, "unexpected.tmp")), false);
    assert.throws(
      () => reconcileReleaseDownloadCache(directory, metadata, { complete: true }),
      /cache is incomplete: beta\.bin/,
    );

    writeFileSync(join(directory, "beta.bin"), beta);
    assert.deepEqual(
      reconcileReleaseDownloadCache(directory, metadata, { complete: true }),
      { expected: 2, retained: 2 },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("release downloads enforce a hard process deadline without accepting option injection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hara-bounded-release-download-"));
  let observedCommand;
  let observedArguments;
  let observedEnvironment;
  let observedSignal;
  try {
    const result = await runBoundedReleaseDownload(
      {
        tag: "v1.2.3",
        repository: "hara-cli/hara-desktop",
        directory,
        extraArguments: ["--skip-existing"],
      },
      {
        timeoutMs: 5,
        execute(command, arguments_, options) {
          observedCommand = command;
          observedArguments = arguments_;
          observedEnvironment = options.env;
          const listeners = new Map();
          return {
            once(event, listener) {
              listeners.set(event, listener);
            },
            kill(signal) {
              observedSignal = signal;
              queueMicrotask(() => listeners.get("close")?.(null, signal));
              return true;
            },
          };
        },
      },
    );
    assert.equal(result.timedOut, true);
    assert.equal(observedCommand, "gh");
    assert.equal(observedEnvironment.NO_PROXY, "");
    assert.equal(observedEnvironment.no_proxy, "");
    assert.equal(observedSignal, "SIGKILL");
    assert.deepEqual(observedArguments, [
      "release",
      "download",
      "v1.2.3",
      "-R",
      "hara-cli/hara-desktop",
      "--dir",
      directory,
      "--skip-existing",
    ]);
    assert.equal(RELEASE_DOWNLOAD_TIMEOUT_MS, 600_000);
    assert.throws(
      () =>
        releaseDownloadArguments("v1.2.3", "hara-cli/hara-desktop", directory, [
          "--pattern",
          "--delete-release",
        ]),
      /unsupported options/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Apple staple validation retries only bounded transient service failures", () => {
  assert.equal(
    isTransientStaplerFailure('Error Domain=NSURLErrorDomain Code=-1001 "The request timed out." CloudKit'),
    true,
  );
  assert.equal(isTransientStaplerFailure("TLS handshake timeout contacting Apple ticket service"), true);
  assert.equal(isTransientStaplerFailure("The validate action failed: no ticket stapled to this item"), false);

  const helper = readFileSync(join(root, "scripts/stapler-validate.mjs"), "utf8");
  const dmgSmoke = readFileSync(join(root, "scripts/mac-dmg-smoke.mjs"), "utf8");
  const updaterSmoke = readFileSync(join(root, "scripts/mac-updater-smoke.mjs"), "utf8");
  const promotion = readFileSync(join(root, "scripts/release-mac-assets.sh"), "utf8");
  assert.match(helper, /const STAPLER_ATTEMPTS = 3/);
  assert.match(helper, /attempt === STAPLER_ATTEMPTS/);
  assert.match(dmgSmoke, /validateStapledArtifact\(app, "DMG app notarization staple"\)/);
  assert.match(updaterSmoke, /validateStapledArtifact\(app, "updater archive notarization staple"\)/);
  assert.equal(
    (promotion.match(/node scripts\/stapler-validate\.mjs/g) || []).length,
    2,
    "promotion must validate local DMGs and reuse the architecture-aware verifier for remote/public DMGs",
  );
  assert.doesNotMatch(promotion, /xcrun stapler validate/);
});

test("DMG notarization separates submission from bounded status polling", () => {
  assert.equal(isTransientNotaryFailure({ signal: "SIGBUS" }), true);
  assert.equal(isTransientNotaryFailure({ status: 138, stderr: "Bus error: 10" }), true);
  assert.equal(isTransientNotaryFailure({ stderr: "NSURLErrorDomain Code=-1001 request timed out" }), true);
  assert.equal(isTransientNotaryFailure({ stderr: "HTTPClientError.connectTimeout" }), true);
  assert.equal(isTransientNotaryFailure({ stderr: "HTTPClientError.unauthorized" }), false);
  assert.equal(isTransientNotaryFailure({ stderr: "401 Unauthorized: invalid credentials" }), false);

  assert.deepEqual(
    parseNotaryResponse(
      '{"id":"f4eef6df-79c6-48c0-b2f1-0811dcce57eb","status":"In Progress"}',
      "fixture",
    ),
    {
      id: "f4eef6df-79c6-48c0-b2f1-0811dcce57eb",
      status: "In Progress",
    },
  );
  assert.throws(() => parseNotaryResponse('{"id":"not-a-uuid","status":"Accepted"}', "fixture"));
  assert.throws(() =>
    parseNotaryResponse(
      '{"id":"f4eef6df-79c6-48c0-b2f1-0811dcce57eb","status":"Unexpected"}',
      "fixture",
    ),
  );

  const helper = readFileSync(join(root, "scripts/notarize-artifact.mjs"), "utf8");
  const signedBuild = readFileSync(join(root, "scripts/build-mac-signed.sh"), "utf8");
  assert.match(helper, /"submit"[\s\S]*"--no-wait"/);
  assert.match(helper, /"info", submitted\.id/);
  assert.match(helper, /const SUBMIT_ATTEMPTS = 3/);
  assert.match(helper, /const INFO_ATTEMPTS = 3/);
  assert.match(helper, /const TOTAL_WAIT_MS = 60 \* 60_000/);
  assert.match(helper, /spawnSync\("\/usr\/bin\/xcrun"/);
  assert.match(signedBuild, /node scripts\/notarize-artifact\.mjs/);
  assert.doesNotMatch(signedBuild, /notarytool submit[\s\S]*--wait/);
});

test("DMG notarization survives a crashed status child without resubmitting", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hara-notary-state-"));
  const artifact = join(directory, "Hara.dmg");
  const key = join(directory, "AuthKey.p8");
  const submissionId = "f4eef6df-79c6-48c0-b2f1-0811dcce57eb";
  writeFileSync(artifact, "signed dmg fixture\n");
  writeFileSync(key, "private key fixture\n");
  const calls = [];
  let infoCall = 0;
  try {
    const result = await notarizeArtifact(
      artifact,
      { key, keyId: "KEY123", issuer: "issuer-fixture" },
      {
        pollIntervalMs: 0,
        totalWaitMs: 1_000,
        wait: async () => {},
        run(args) {
          calls.push(args);
          if (args[0] === "submit") return JSON.stringify({ id: submissionId });
          infoCall += 1;
          if (infoCall === 1) {
            const error = new Error("notarytool status child crashed");
            error.signal = "SIGBUS";
            throw error;
          }
          return JSON.stringify({
            id: submissionId,
            status: infoCall === 2 ? "In Progress" : "Accepted",
          });
        },
      },
    );
    assert.equal(result, submissionId);
    assert.equal(calls.filter((args) => args[0] === "submit").length, 1);
    assert.equal(calls.filter((args) => args[0] === "info").length, 3);
    assert.ok(calls[0].includes("--no-wait"));
    assert.equal(calls[0].includes("--wait"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("DMG notarization retries Apple's connect-timeout upload before polling", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hara-notary-submit-retry-"));
  const artifact = join(directory, "Hara.dmg");
  const key = join(directory, "AuthKey.p8");
  const submissionId = "bc426ba9-5387-4684-a67c-10ddf091f8e2";
  writeFileSync(artifact, "signed dmg fixture\n");
  writeFileSync(key, "private key fixture\n");
  const calls = [];
  let submitCall = 0;
  try {
    const result = await notarizeArtifact(
      artifact,
      { key, keyId: "KEY123", issuer: "issuer-fixture" },
      {
        pollIntervalMs: 0,
        totalWaitMs: 1_000,
        wait: async () => {},
        run(args) {
          calls.push(args);
          if (args[0] === "submit") {
            submitCall += 1;
            if (submitCall === 1) {
              const error = new Error("HTTPClientError.connectTimeout");
              error.stderr = "HTTPClientError.connectTimeout";
              throw error;
            }
            return JSON.stringify({ id: submissionId });
          }
          return JSON.stringify({ id: submissionId, status: "Accepted" });
        },
      },
    );
    assert.equal(result, submissionId);
    assert.equal(calls.filter((args) => args[0] === "submit").length, 2);
    assert.equal(calls.filter((args) => args[0] === "info").length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("protected Gatekeeper checks never depend on a login-shell PATH", () => {
  const signedBuild = readFileSync(join(root, "scripts/build-mac-signed.sh"), "utf8");
  const promotion = readFileSync(join(root, "scripts/release-mac-assets.sh"), "utf8");
  for (const script of [signedBuild, promotion]) {
    assert.match(script, /\/usr\/sbin\/spctl/);
    assert.doesNotMatch(script, /(?:^|\n)\s*spctl\b/);
  }
});

test("signed builds select pinned Rust and preflight a dedicated unlocked keychain", () => {
  const toolchain = readFileSync(join(root, "scripts/check-build-toolchain.sh"), "utf8");
  const script = readFileSync(join(root, "scripts/build-mac-signed.sh"), "utf8");
  const promotion = readFileSync(join(root, "scripts/release-mac-assets.sh"), "utf8");
  const workflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");

  assert.match(toolchain, /rustup which --toolchain "\$required" rustc/);
  assert.match(toolchain, /export PATH="\$toolchain_bin:\$PATH"/);
  assert.match(toolchain, /export RUSTC="\$rustc_command"/);
  assert.match(toolchain, /export CARGO="\$cargo_command"/);
  assert.match(toolchain, /\[ -n "\$\{BASH_VERSION:-\}" \]/);
  for (const check of ["hara_check_node", "hara_check_bun", "hara_check_rust"]) {
    assert.match(toolchain, new RegExp(`${check} \\|\\| return 1`));
  }

  const unlock = script.indexOf('security unlock-keychain -p "$CODESIGN_PASSWORD"');
  const forgetPassword = script.indexOf("unset CODESIGN_PASSWORD HARA_CODESIGN_KEYCHAIN_PASSWORD", unlock);
  const inspectIdentity = script.indexOf('security find-identity -v -p codesigning "$CODESIGN_KEYCHAIN"', unlock);
  const keyProbe = script.indexOf('cp /usr/bin/true "$CODESIGN_PROBE_DIR/probe"', unlock);
  const actualSign = script.indexOf('codesign --remove-signature "$SIDECAR"');
  assert.ok(
    unlock >= 0
      && forgetPassword > unlock
      && inspectIdentity > forgetPassword
      && keyProbe > inspectIdentity
      && actualSign > keyProbe,
  );
  assert.match(script, /codesign --verify --strict "\$CODESIGN_PROBE_DIR\/probe"/);
  assert.match(script, /CODESIGN_PROBE_MAX_ATTEMPTS=3/);
  assert.match(script, /node scripts\/codesign-timestamp-retry\.mjs "\$CODESIGN_PROBE_LOG"/);
  assert.match(script, /sleep \$\(\(CODESIGN_PROBE_ATTEMPT \* 5\)\)/);
  assert.match(script, /security lock-keychain "\$CODESIGN_KEYCHAIN"/);
  assert.match(script, /security list-keychains -d user -s "\$\{ORIGINAL_KEYCHAINS\[@\]\}"/);
  assert.match(script, /hara-codesign-keychain\.password/);
  assert.match(script, /append_original_keychain/);
  assert.match(script, /\[ -f "\$candidate" \] \|\| return 0/);
  assert.match(script, /stat -f '%Lp'.*CODESIGN_PASSWORD_FILE/);
  assert.doesNotMatch(script, /security show-keychain-info/);
  assert.doesNotMatch(workflow, /HARA_CODESIGN_KEYCHAIN_PASSWORD/);

  const signJob = workflow.slice(
    workflow.indexOf("\n  sign_and_promote:"),
    workflow.indexOf("\n  verify_public_release:"),
  );
  const publicJob = workflow.slice(workflow.indexOf("\n  verify_public_release:"));
  assert.doesNotMatch(signJob, /^\s+- uses:/mu);
  assert.match(workflow, /Build compact packs for the exact Desktop and CLI source snapshots/);
  assert.match(workflow, /rev-list --objects --no-object-names "\$commit_sha\^\{tree\}"/);
  assert.match(workflow, /id: source_pack_upload/);
  assert.match(workflow, /name: release-source-packs/);
  assert.match(workflow, /compression-level: 0/);
  const assembleJob = workflow.slice(
    workflow.indexOf("\n  assemble_draft:"),
    workflow.indexOf("\n  promotion_preflight:"),
  );
  assert.match(assembleJob, /timeout-minutes: 60/);
  assert.match(assembleJob, /Copy the exact source artifact into the hidden Release transport/);
  assert.match(assembleJob, /actions\/artifacts\/\$SOURCE_ARTIFACT_ID\/zip/);
  assert.match(assembleJob, /sha256sum "\$SOURCE_ARCHIVE_PARTIAL"/);
  assert.match(assembleJob, /Hara_\$\{RELEASE_TAG#v\}_source-packs\.zip/);
  assert.match(assembleJob, /unzip -tq "\$SOURCE_ARCHIVE"/);
  assert.match(assembleJob, /gh release upload[\s\S]*release-source-archive/);
  assert.match(assembleJob, /sha256sum -c source-packs\.sha256/);
  assert.match(assembleJob, /rm -f "\$SOURCE_ARCHIVE"/);
  assert.match(signJob, /Materialize exact release sources from the digest-bound Release archive/);
  assert.match(signJob, /source-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(signJob, /needs: \[prepare_release, create_draft, assemble_draft, promotion_preflight\]/);
  assert.match(signJob, /"\$@" <&0 &/);
  assert.doesNotMatch(signJob, /\bgit\b.*\bfetch\b/);
  assert.doesNotMatch(signJob, /SOURCE_ARTIFACT_ID:/);
  assert.match(signJob, /RELEASE_ID: \$\{\{ needs\.create_draft\.outputs\.release_id \}\}/);
  assert.match(signJob, /SOURCE_ARTIFACT_DIGEST: \$\{\{ needs\.prepare_release\.outputs\.source_artifact_digest \}\}/);
  assert.match(signJob, /releases\/\$RELEASE_ID/);
  assert.doesNotMatch(signJob, /releases\/tags\/\$RELEASE_TAG/);
  assert.match(signJob, /--argjson release_id "\$RELEASE_ID"/);
  assert.match(signJob, /\.tag_name == \$tag/);
  assert.match(signJob, /\.draft == true or/);
  assert.match(signJob, /\.draft == false and[\s\S]*?\.immutable == true/);
  assert.match(signJob, /RELEASE_IS_DRAFT="\$\(jq -r \.draft/);
  assert.match(signJob, /HARA_RELEASE_POLICY_TOKEN: \$\{\{ secrets\.HARA_RELEASE_POLICY_TOKEN \}\}/);
  assert.doesNotMatch(signJob, /GH_TOKEN="\$HARA_RELEASE_POLICY_TOKEN"/);
  assert.match(signJob, /Materialize exact release sources[\s\S]*?GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(signJob, /gh release verify "\$RELEASE_TAG"/);
  assert.match(signJob, /public attestation verification is delegated to the read-only hosted job/);
  assert.match(signJob, /\.digest == \$digest/);
  assert.match(signJob, /releases\/assets\/\$SOURCE_ASSET_ID/);
  assert.match(signJob, /header = "Authorization: Bearer %s"/);
  assert.match(signJob, /GH_TOKEN='' GITHUB_TOKEN='' \/usr\/bin\/curl/);
  assert.match(signJob, /--http1\.1/);
  assert.match(signJob, /--proto '=https'/);
  assert.match(signJob, /--config -/);
  assert.doesNotMatch(signJob, /gh run download/);
  assert.match(signJob, /run_with_deadline 120 \/usr\/bin\/env GH_TOKEN='' GITHUB_TOKEN='' \/usr\/bin\/curl/);
  assert.match(signJob, /--retry-max-time 90/);
  assert.match(signJob, /run_with_deadline 600 \/usr\/bin\/env GH_TOKEN='' GITHUB_TOKEN='' \/usr\/bin\/curl/);
  assert.match(signJob, /--retry-max-time 540/);
  assert.match(signJob, /--continue-at -/);
  assert.match(signJob, /--output "\$ARTIFACT_PARTIAL"/);
  assert.match(signJob, /shasum -a 256 "\$ARTIFACT_PARTIAL"/);
  assert.match(signJob, /shasum -a 256 -c source-packs\.sha256/);
  assert.match(signJob, /index-pack --stdin < "\$pack_file"/);
  assert.match(signJob, /printf '%s\\n' "\$commit_sha" > "\$target_dir\/\.git\/shallow"/);
  assert.match(signJob, /rev-parse "\$commit_sha\^\{tree\}"/);
  assert.match(signJob, /printf '%s\\n' "\$NODE_BIN" "\$BUN_BIN" "\$CARGO_BIN" >> "\$GITHUB_PATH"/);
  assert.match(signJob, /expected_root="\$GITHUB_WORKSPACE\/source-\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT"/);
  assert.match(signJob, /\[ "\$HARA_RELEASE_SOURCE_ROOT" = "\$expected_root" \]/);
  assert.match(promotion, /HARA_RELEASE_SOURCE_ARTIFACT_DIGEST/);
  assert.match(promotion, /remove_verified_source_archive/);
  assert.match(promotion, /trusted prepare-job digest/);
  assert.match(signJob, /HARA_DEFER_PUBLIC_EDGE_VERIFY: "1"/);
  assert.match(publicJob, /needs: \[prepare_release, sign_and_promote\]/);
  assert.match(publicJob, /permissions:\n      attestations: read\n      contents: read/);
  assert.match(publicJob, /if: always\(\) && needs\.prepare_release\.result == 'success'/);
  assert.match(publicJob, /runs-on: macos-15/);
  assert.match(publicJob, /timeout-minutes: 45/);
  assert.match(publicJob, /persist-credentials: false/);
  assert.match(publicJob, /node scripts\/resolve-remote-tag\.mjs \. origin "\$RELEASE_TAG"/);
  assert.match(publicJob, /bash scripts\/verify-public-release-edge\.sh "\$RELEASE_TAG"/);
  assert.doesNotMatch(publicJob, /contents: write/);
  assert.doesNotMatch(publicJob, /environment:/);
  assert.doesNotMatch(publicJob, /secrets\./);
  assert.doesNotMatch(publicJob, /continue-on-error/);
});

test("CI Rosetta smoke is limited to the protected tag signing job", () => {
  const sha = "a".repeat(40);
  const runId = "123456";
  const protectedSigningEnv = {
    CI: "true",
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "hara-cli/hara-desktop",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF_TYPE: "tag",
    GITHUB_REF_PROTECTED: "true",
    GITHUB_REF_NAME: `v${version}`,
    GITHUB_SHA: sha,
    GITHUB_WORKFLOW_SHA: sha,
    GITHUB_WORKFLOW_REF: `hara-cli/hara-desktop/.github/workflows/build.yml@refs/tags/v${version}`,
    GITHUB_RUN_ID: runId,
    HARA_ALLOW_ROSETTA_SMOKE: "1",
    HARA_PROTECTED_SIGNING_JOB: runId,
  };
  const request = {
    env: protectedSigningEnv,
    host: "aarch64-apple-darwin",
    expectedTarget: "x86_64-apple-darwin",
    ci: true,
  };

  assert.equal(canUseRosettaSmoke(request), true);
  for (const key of [
    "GITHUB_REF_PROTECTED",
    "GITHUB_WORKFLOW_REF",
    "GITHUB_WORKFLOW_SHA",
    "HARA_PROTECTED_SIGNING_JOB",
  ]) {
    const env = { ...protectedSigningEnv };
    delete env[key];
    assert.equal(canUseRosettaSmoke({ ...request, env }), false, `CI Rosetta allowed without ${key}`);
  }
  assert.equal(
    canUseRosettaSmoke({
      ...request,
      env: { ...protectedSigningEnv, HARA_PROTECTED_SIGNING_JOB: "different-run" },
    }),
    false,
  );
  assert.equal(
    canUseRosettaSmoke({
      env: { HARA_ALLOW_ROSETTA_SMOKE: "1" },
      host: "aarch64-apple-darwin",
      expectedTarget: "x86_64-apple-darwin",
      ci: false,
    }),
    true,
  );
});

test("foreign Intel static validation is limited to the exact protected tag signing job", () => {
  const sha = "b".repeat(40);
  const runId = "654321";
  const protectedSigningEnv = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "hara-cli/hara-desktop",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF_TYPE: "tag",
    GITHUB_REF_PROTECTED: "true",
    GITHUB_REF_NAME: `v${version}`,
    GITHUB_SHA: sha,
    GITHUB_WORKFLOW_SHA: sha,
    GITHUB_WORKFLOW_REF: `hara-cli/hara-desktop/.github/workflows/build.yml@refs/tags/v${version}`,
    GITHUB_RUN_ID: runId,
    HARA_FOREIGN_MAC_STATIC_VALIDATION: "1",
    HARA_PROTECTED_SIGNING_JOB: runId,
  };
  const request = {
    env: protectedSigningEnv,
    platform: "darwin",
    arch: "arm64",
    expectedTarget: "x86_64-apple-darwin",
  };

  assert.equal(useForeignMacStaticValidation(request), true);
  assert.equal(
    useForeignMacStaticValidation({ ...request, env: {} }),
    false,
    "static validation stays disabled unless explicitly selected",
  );
  for (const key of [
    "GITHUB_REF_PROTECTED",
    "GITHUB_WORKFLOW_REF",
    "GITHUB_WORKFLOW_SHA",
    "HARA_PROTECTED_SIGNING_JOB",
  ]) {
    const env = { ...protectedSigningEnv };
    delete env[key];
    assert.throws(
      () => useForeignMacStaticValidation({ ...request, env }),
      /protected tag signing job/,
      `foreign validation allowed without ${key}`,
    );
  }
  assert.throws(
    () => useForeignMacStaticValidation({ ...request, expectedTarget: "aarch64-apple-darwin" }),
    /allowed only for x86_64-apple-darwin/,
  );

  const signedBuild = readFileSync(join(root, "scripts/build-mac-signed.sh"), "utf8");
  const promotion = readFileSync(join(root, "scripts/release-mac-assets.sh"), "utf8");
  assert.match(signedBuild, /foreign-mac-validation\.mjs --preflight "\$TARGET"/);
  assert.match(promotion, /HARA_FOREIGN_MAC_STATIC_VALIDATION=1 node scripts\/mac-updater-smoke\.mjs/);
  assert.match(promotion, /HARA_FOREIGN_MAC_STATIC_VALIDATION=1 node scripts\/mac-dmg-smoke\.mjs/);
  assert.equal(
    (promotion.match(/HARA_FOREIGN_MAC_STATIC_VALIDATION=1 node scripts\/mac-dmg-smoke\.mjs/g) || []).length,
    1,
    "the reusable DMG verifier must select foreign validation only in its Intel branch",
  );
  assert.match(
    promotion,
    /if \[ "\$expected_target" = "x86_64-apple-darwin" \]; then[\s\S]*HARA_FOREIGN_MAC_STATIC_VALIDATION=1 node scripts\/mac-dmg-smoke\.mjs[\s\S]*else[\s\S]*node scripts\/mac-dmg-smoke\.mjs "\$dmg_path" "\$expected_target"/,
  );
  assert.match(promotion, /verify_signed_dmg public .*aarch64-apple-darwin/);
  assert.match(promotion, /verify_signed_dmg public .*x86_64-apple-darwin/);
  assert.match(promotion, /verify_signed_dmg remote .*aarch64-apple-darwin/);
  assert.match(promotion, /verify_signed_dmg remote .*x86_64-apple-darwin/);
  assert.doesNotMatch(promotion, /HARA_ALLOW_ROSETTA_SMOKE/);
});

test("Linux and Windows smoke inspect desktop shells and execute sidecars from real installers", () => {
  const packageSmoke = readFileSync(join(root, "scripts/package-smoke.mjs"), "utf8");
  assert.doesNotMatch(packageSmoke, /sidecar\(join\(releaseBase, "hara(?:\.exe)?"\), "staged sidecar"\)/);
  assert.match(
    packageSmoke,
    /smokeInstalledSidecars\(deb, "deb", "Debian package", "hara", "hara-desktop"\)/,
  );
  assert.match(
    packageSmoke,
    /smokeInstalledSidecars\(rpm, "rpm", "RPM package", "hara", "hara-desktop"\)/,
  );
  assert.match(
    packageSmoke,
    /smokeInstalledSidecars\(msi, "msi", "MSI installer", "hara\.exe", "hara-desktop\.exe"\)/,
  );
  assert.match(
    packageSmoke,
    /smokeInstalledSidecars\(nsis, "nsis", "NSIS installer", "hara\.exe", "hara-desktop\.exe"\)/,
  );
  assert.match(packageSmoke, /smokeUpdaterEndpoints\(\{ binary: path, label \}\)/);
});

test("every packaged desktop executable must report the ordered runtime updater endpoints", () => {
  const packageSmoke = readFileSync(join(root, "scripts/package-smoke.mjs"), "utf8");
  const dmgSmoke = readFileSync(join(root, "scripts/mac-dmg-smoke.mjs"), "utf8");
  const updaterSmoke = readFileSync(join(root, "scripts/mac-updater-smoke.mjs"), "utf8");
  for (const script of [packageSmoke, dmgSmoke, updaterSmoke]) {
    assert.match(script, /smokeUpdaterEndpoints/);
  }
  const endpointSmoke = readFileSync(join(root, "scripts/updater-endpoint-smoke.mjs"), "utf8");
  assert.match(endpointSmoke, /spawnSync\(binary, \[updaterEndpointSmokeArg\]/);
  assert.match(endpointSmoke, /JSON\.parse\(execute\(executable, label\)\)/);
  assert.doesNotMatch(endpointSmoke, /bytes\.indexOf|readFileSync\(executable\)/);
  assert.match(dmgSmoke, /binary: shell, label: "DMG desktop shell"/);
  assert.match(updaterSmoke, /binary: shell, label: "updater archive desktop shell"/);
});

test("Windows NSIS upgrades retire the detached sidecar before replacing it", () => {
  const config = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  const hooksPath = config.bundle?.windows?.nsis?.installerHooks;
  assert.equal(hooksPath, "./windows/installer-hooks.nsh");
  const hooks = readFileSync(join(root, "src-tauri", hooksPath), "utf8");
  assert.match(
    hooks,
    /!macro NSIS_HOOK_PREINSTALL[\s\S]*!insertmacro CheckIfAppIsRunning "hara\.exe" "Hara task engine"[\s\S]*!macroend/,
  );
  assert.match(
    hooks,
    /!macro NSIS_HOOK_PREUNINSTALL[\s\S]*!insertmacro CheckIfAppIsRunning "hara\.exe" "Hara task engine"[\s\S]*!macroend/,
  );
});

test("Tauri Cargo manifest is checked out as LF on Windows without weakening the clean-tree gate", () => {
  const attributes = readFileSync(join(root, ".gitattributes"), "utf8");
  const manifest = readFileSync(join(root, "src-tauri/Cargo.toml"));
  const configuredEol = run("git", ["check-attr", "eol", "--", "src-tauri/Cargo.toml"]);
  const collector = readFileSync(join(root, "scripts/collect-release-assets.mjs"), "utf8");

  assert.match(attributes, /^src-tauri\/Cargo\.toml text eol=lf$/m);
  assert.equal(configuredEol.status, 0, configuredEol.stderr);
  assert.match(configuredEol.stdout, /src-tauri\/Cargo\.toml: eol: lf/);
  assert.equal(manifest.includes(13), false, "tracked Cargo.toml must not contain CR bytes");
  assert.match(collector, /git", \["status", "--porcelain"\]/);
  assert.match(collector, /Desktop worktree changed during the matrix build/);
});

test("macOS package and promotion gates mount the real DMG before release", () => {
  const packageSmoke = readFileSync(join(root, "scripts/package-smoke.mjs"), "utf8");
  const signedBuild = readFileSync(join(root, "scripts/build-mac-signed.sh"), "utf8");
  const promotion = readFileSync(join(root, "scripts/release-mac-assets.sh"), "utf8");
  assert.match(packageSmoke, /smokeMacDmg/);
  assert.match(signedBuild, /mac-dmg-smoke\.mjs.*--require-signatures/);
  assert.match(promotion, /mac-dmg-smoke\.mjs/);
});

test("every release job and installer extraction has a finite timeout", () => {
  const workflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
  const packageSmoke = readFileSync(join(root, "scripts/package-smoke.mjs"), "utf8");
  const lines = workflow.split("\n");
  for (const job of [
    "prepare_release",
    "create_draft",
    "build",
    "assemble_draft",
    "promotion_preflight",
    "sign_and_promote",
    "verify_public_release",
  ]) {
    const start = lines.indexOf(`  ${job}:`);
    assert.ok(start >= 0, `missing release job ${job}`);
    const nextOffset = lines.slice(start + 1).findIndex((line) => /^  [A-Za-z0-9_]+:$/.test(line));
    const end = nextOffset >= 0 ? start + 1 + nextOffset : lines.length;
    const body = lines.slice(start, end).join("\n");
    assert.match(body, /timeout-minutes:\s+\d+/, `${job} must have a timeout`);
  }
  assert.match(packageSmoke, /timeout:\s*EXTRACTION_TIMEOUT_MS/);
});

test("signed build clears exported credentials before package validation", () => {
  const script = readFileSync(join(root, "scripts/build-mac-signed.sh"), "utf8");
  const build = script.indexOf("npm run tauri build");
  const clear = script.indexOf("clear_signing_environment", build);
  const packageSmoke = script.indexOf("node scripts/package-smoke.mjs", build);
  assert.ok(build >= 0 && clear > build && clear < packageSmoke);
});

test("tag workflow automatically enters the protected promotion job under one concurrency lock", () => {
  const buildWorkflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
  assert.match(
    buildWorkflow,
    /group: hara-desktop-release-\$\{\{ github\.ref_name \}\}/,
  );
  assert.doesNotMatch(buildWorkflow, /workflow_dispatch/);
  assert.match(buildWorkflow, /promotion_preflight:\n[\s\S]*?needs: prepare_release/);
  assert.match(buildWorkflow, /build\.yml@refs\/tags\/\$RELEASE_TAG/);
  assert.match(
    buildWorkflow,
    /sign_and_promote:\n[\s\S]*?needs: \[prepare_release, create_draft, assemble_draft, promotion_preflight\]/,
  );
  assert.match(
    buildWorkflow,
    /verify_public_release:\n[\s\S]*?needs: \[prepare_release, sign_and_promote\]/,
  );
  assert.match(
    buildWorkflow,
    /assemble_draft:\n[\s\S]*?needs: \[prepare_release, build, create_draft\]/,
  );
  assert.match(buildWorkflow, /environment:\s+name: hara-desktop-production/);
  assert.match(buildWorkflow, /runs-on: \[self-hosted, macOS, ARM64, hara-desktop-release\]/);
  assert.match(buildWorkflow, /custom_branch_policies/);
  assert.match(buildWorkflow, /remove the second manual environment approval/);
  assert.match(buildWorkflow, /exactly one deployment policy: tag v\*/);
  assert.match(buildWorkflow, /build:\n[\s\S]*?environment:\n      name: hara-desktop-production/);
  assert.match(
    buildWorkflow,
    /sign_and_promote:\n[\s\S]*?permissions:\n      actions: read\n      contents: write\n[\s\S]*?environment:/,
  );
  const signPermissions = buildWorkflow.slice(
    buildWorkflow.indexOf("\n  sign_and_promote:"),
    buildWorkflow.indexOf("\n  verify_public_release:"),
  );
  assert.doesNotMatch(signPermissions, /attestations: read/);
  assert.match(buildWorkflow, /secrets\.HARA_RELEASE_POLICY_TOKEN/);
  assert.match(buildWorkflow, /secrets\.HARA_TAURI_SIGNING_PRIVATE_KEY/);
  assert.doesNotMatch(buildWorkflow, /secrets\.TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(buildWorkflow, /index\("creation"\).*index\("update"\).*index\("deletion"\)/);
  assert.match(buildWorkflow, /HARA_RELEASE_ADMIN_ID: "23243740"/);
  assert.match(buildWorkflow, /\.bypass_actors \| length == 1/);
  assert.match(buildWorkflow, /\.bypass_actors\[0\]\.actor_type == "User"/);
  assert.match(buildWorkflow, /\.bypass_actors\[0\]\.actor_id == \$release_admin_id/);
  assert.match(buildWorkflow, /\.bypass_actors\[0\]\.bypass_mode == "always"/);
  assert.doesNotMatch(buildWorkflow, /\.bypass_actors \| length > 0/);
  assert.match(
    buildWorkflow,
    /github-api-read\.mjs[\s\S]*?rulesets\?targets=tag&per_page=100[\s\S]*?--paginate/,
  );
  assert.match(buildWorkflow, /\.sender\.id == \$release_admin_id/);
  assert.match(
    buildWorkflow,
    /Merge signed assets[\s\S]*?HARA_PROTECTED_SIGNING_JOB: \$\{\{ github\.run_id \}\}/,
  );
  assert.match(
    readFileSync(join(root, "scripts/release-mac-assets.sh"), "utf8"),
    /HARA_PROTECTED_SIGNING_JOB:-}" = "\$GITHUB_RUN_ID"/,
  );
  assert.match(
    buildWorkflow,
    /github\.event\.created == true[\s\S]*github\.event\.forced == false[\s\S]*github\.event\.deleted == false/,
  );

  const direct = run("bash", ["scripts/release-mac-assets.sh", `v${version}`], {
    env: {
      ...process.env,
      GITHUB_ACTIONS: "",
      GITHUB_REPOSITORY: "",
      GITHUB_RUN_ID: "",
      GITHUB_WORKFLOW_REF: "",
      HARA_PROMOTION_WORKFLOW_LOCK: "",
      HARA_PROMOTION_TAG: "",
    },
  });
  assert.notEqual(direct.status, 0);
  assert.match(direct.stderr, /must run inside build\.yml's tag-scoped protected signing job/);

  const wrongWorkflowRef = run("bash", ["scripts/release-mac-assets.sh", `v${version}`], {
    env: {
      ...process.env,
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "hara-cli/hara-desktop",
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF_PROTECTED: "true",
      GITHUB_RUN_ID: "12345",
      GITHUB_WORKFLOW_REF: "hara-cli/hara-desktop/.github/workflows/build.yml@refs/heads/main",
      HARA_PROTECTED_SIGNING_JOB: "12345",
      HARA_PROMOTION_WORKFLOW_LOCK: "12345",
      HARA_PROMOTION_TAG: `v${version}`,
    },
  });
  assert.notEqual(wrongWorkflowRef.status, 0);
  assert.match(wrongWorkflowRef.stderr, /unexpected promotion workflow identity/);
});

test("release source cannot resolve a branch before exact tag validation or inherit draft write access", () => {
  const workflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
  const prepareStart = workflow.indexOf("  prepare_release:");
  const createDraftStart = workflow.indexOf("  create_draft:");
  const buildStart = workflow.indexOf("  build:", createDraftStart);
  const prepare = workflow.slice(prepareStart, createDraftStart);
  const createDraft = workflow.slice(createDraftStart, buildStart);
  const guard = prepare.indexOf("Require an exact stable tag invocation before checkout");
  const checkout = prepare.indexOf("uses: actions/checkout@");
  const eventSourceGate = prepare.indexOf("Verify event source before executing repository code");
  const repositoryScript = prepare.indexOf("node scripts/check-release-metadata.mjs");
  assert.ok(guard >= 0 && guard < checkout);
  assert.ok(eventSourceGate > checkout && eventSourceGate < repositoryScript);
  assert.match(prepare, /only a pushed stable tag authorizes a release/);
  assert.match(prepare, /release tag must be protected by the active v\* tag ruleset/);
  assert.match(prepare, /\.created == true and \.forced == false and \.deleted == false/);
  assert.match(prepare, /build\.yml@refs\/tags\/\$RELEASE_TAG/);
  assert.match(prepare, /GITHUB_WORKFLOW_SHA.*GITHUB_SHA/);
  assert.match(prepare, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(prepare, /REMOTE_TAG_COMMIT.*GITHUB_SHA/);
  assert.doesNotMatch(prepare, /contents: write/);
  assert.match(createDraft, /permissions:\n      contents: write/);
  assert.match(createDraft, /GH_REPO: \$\{\{ github\.repository \}\}/);
  assert.doesNotMatch(createDraft, /actions\/checkout|npm |node scripts\//);
});

test("release workflows pin every external action and the exact Rust toolchain", () => {
  const releaseWorkflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
  const workflows = [
    releaseWorkflow,
    readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"),
  ];
  for (const workflow of workflows) {
    const actionRefs = [...workflow.matchAll(/uses:\s+[^\s@]+@([^\s#]+)/g)].map((match) => match[1]);
    assert.ok(actionRefs.length > 0, "expected external actions in release workflow");
    for (const ref of actionRefs) assert.match(ref, /^[0-9a-f]{40}$/, `floating action ref: ${ref}`);
    const checkoutCount = (workflow.match(/uses: actions\/checkout@/g) || []).length;
    const nonPersistentCheckoutCount = (workflow.match(/persist-credentials: false/g) || []).length;
    assert.equal(nonPersistentCheckoutCount, checkoutCount, "every checkout must remove its Git credential");
    assert.match(
      workflow,
      /NPM_CONFIG_REGISTRY:\s*https:\/\/registry\.npmjs\.org\//,
      "workflow must ignore machine-level npm mirrors",
    );
    assert.match(
      workflow,
      /NPM_CONFIG_REPLACE_REGISTRY_HOST:\s*always/,
      "workflow must replace registry hosts embedded in lockfiles",
    );
  }
  const lock = readFileSync(join(root, "package-lock.json"), "utf8");
  assert.doesNotMatch(lock, /registry\.npmmirror\.com|npmmirror/);
  assert.match(
    releaseWorkflow,
    new RegExp(`toolchain: ["']?${rustVersion.replaceAll(".", "\\.")}["']?`),
  );
});

test("main and pull requests run Desktop quality gates without release authority", () => {
  const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /push:\n\s+branches: \[main\]/);
  assert.match(workflow, /pull_request:\n\s+branches: \[main\]/);
  assert.match(workflow, /permissions:\n\s+contents: read/);
  assert.match(workflow, /timeout-minutes: 20/);
  for (const command of [
    "npm ci",
    "npm audit --omit=dev",
    "npm run check:release",
    "npm test",
    "npm run build",
  ]) {
    assert.match(workflow, new RegExp(command.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(workflow, /contents: write|environment:|GH_TOKEN|HARA_RELEASE/);
});

test("draft validation executes repository code without a release token", () => {
  const workflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
  const validationStart = workflow.indexOf("Revalidate downloaded draft and source archive without a release token");
  const stateCheckStart = workflow.indexOf("Confirm the remote release remains a hidden draft", validationStart);
  const validation = workflow.slice(validationStart, stateCheckStart);
  assert.match(validation, /node scripts\/updater-manifest\.mjs validate/);
  assert.match(validation, /node scripts\/release-source-provenance\.mjs validate/);
  assert.doesNotMatch(validation, /GH_TOKEN|github\.token/);
});

test("draft asset replacement resolves a hidden release through its database ID", () => {
  const workflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
  const createDraftStart = workflow.indexOf("  create_draft:");
  const buildStart = workflow.indexOf("  build:", createDraftStart);
  const createDraft = workflow.slice(createDraftStart, buildStart);
  const replaceStart = workflow.indexOf("Replace hidden draft assets after every native gate");
  const downloadStart = workflow.indexOf("Download the exact remote draft", replaceStart);
  const replacement = workflow.slice(replaceStart, downloadStart);

  assert.match(createDraft, /release_id: \$\{\{ steps\.hidden_draft\.outputs\.release_id \}\}/);
  assert.match(createDraft, /echo "release_id=\$RELEASE_ID" >> "\$GITHUB_OUTPUT"/);
  assert.match(replacement, /RELEASE_ID: \$\{\{ needs\.create_draft\.outputs\.release_id \}\}/);
  assert.match(replacement, /\[\[ "\$RELEASE_ID" =~ \^\[0-9\]\+\$ \]\]/);
  assert.match(replacement, /repos\/\$GITHUB_REPOSITORY\/releases\/\$RELEASE_ID/);
  assert.match(replacement, /gh release upload "\$RELEASE_TAG" -R "\$GITHUB_REPOSITORY"/);
  assert.doesNotMatch(replacement, /gh release view/);
  assert.doesNotMatch(replacement, /releases\/tags\/\$RELEASE_TAG/);
});

test("release installs and audits use finite official-registry retry helpers", () => {
  const workflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
  const retryHelper = readFileSync(join(root, "scripts/npm-ci-retry.sh"), "utf8");
  const auditHelper = readFileSync(join(root, "scripts/npm-audit-retry.sh"), "utf8");
  const refresh = readFileSync(join(root, "scripts/refresh-sidecar.sh"), "utf8");
  const lockedHydration = readFileSync(join(root, "scripts/hydrate-locked-sidecar-dependencies.mjs"), "utf8");

  assert.match(workflow, /Install locked Desktop dependencies with bounded registry retries[\s\S]*?shell:\s+bash[\s\S]*?\.\/scripts\/npm-ci-retry\.sh/);
  assert.match(workflow, /Audit production dependencies with transient-only retries[\s\S]*?shell:\s+bash[\s\S]*?\.\/scripts\/npm-audit-retry\.sh/);
  assert.match(workflow, /Install locked Desktop dependencies\n[\s\S]*?shell:\s+bash[\s\S]*?\.\/scripts\/npm-ci-retry\.sh/);
  assert.match(refresh, /DESKTOP_ROOT\/scripts\/npm-ci-retry\.sh/);
  assert.match(retryHelper, /MAX_ATTEMPTS="\$\{HARA_NPM_CI_ATTEMPTS:-4\}"/);
  assert.match(retryHelper, /MAX_ATTEMPTS" -le 6/);
  assert.match(retryHelper, /--fetch-retries=5/);
  assert.match(retryHelper, /--fetch-timeout=300000/);
  assert.doesNotMatch(retryHelper, /while true|registry\.npmmirror\.com|npmmirror/);
  assert.match(refresh, /HARA_NPM_CI_IGNORE_SCRIPTS=1/);
  assert.match(refresh, /hydrate-locked-sidecar-dependencies\.mjs/);
  assert.match(refresh, /npm rebuild --no-audit --fund=false/);
  assert.match(lockedHydration, /https:\/\/registry\.npmjs\.org/);
  assert.match(lockedHydration, /sha512-/);
  assert.match(lockedHydration, /--retry", "4"/);
  assert.match(lockedHydration, /--max-time", "600"/);
  assert.match(lockedHydration, /--noproxy", OFFICIAL_NPM_HOST/);
  assert.match(lockedHydration, /OFFICIAL_NPM_HOST = "registry\.npmjs\.org"/);
  assert.doesNotMatch(lockedHydration, /registry\.npmmirror\.com|npmmirror/);
  assert.match(auditHelper, /MAX_ATTEMPTS="\$\{HARA_NPM_AUDIT_ATTEMPTS:-4\}"/);
  assert.match(auditHelper, /metadata\?\.vulnerabilities/);
  assert.match(auditHelper, /audit endpoint returned an error/);
  assert.match(auditHelper, /--registry https:\/\/registry\.npmjs\.org\//);
  assert.match(auditHelper, /--fetch-timeout=180000/);
  assert.doesNotMatch(auditHelper, /while true|registry\.npmmirror\.com|npmmirror/);
});

test("every native release target hydrates the checksum-pinned Herdr runtime before Tauri builds", () => {
  const workflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
  const haraCopy = workflow.indexOf('"$GITHUB_WORKSPACE/src-tauri/binaries/hara-${{ matrix.target }}${EXT}"');
  const herdrHydration = workflow.indexOf(
    'node "$GITHUB_WORKSPACE/scripts/refresh-herdr-runtime.mjs" "${{ matrix.target }}"',
    haraCopy,
  );
  const tauriBuild = workflow.indexOf("- name: Build local packages", herdrHydration);

  assert.ok(haraCopy >= 0, "the release matrix must install the target-specific Hara sidecar");
  assert.ok(herdrHydration > haraCopy, "the matching Herdr runtime must be verified beside Hara");
  assert.ok(tauriBuild > herdrHydration, "Tauri must not resolve externalBin before Herdr exists");
});

test("sidecar-only npm installation defers lifecycle scripts without changing ordinary CI", () => {
  const directory = mkdtempSync(join(tmpdir(), "hara-npm-ci-retry-"));
  try {
    const fakeNpm = join(directory, "npm");
    const argumentsFile = join(directory, "arguments");
    writeFileSync(fakeNpm, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" >"$HARA_TEST_NPM_ARGUMENTS"
`);
    chmodSync(fakeNpm, 0o755);
    const baseEnvironment = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      HARA_TEST_NPM_ARGUMENTS: argumentsFile,
      HARA_NPM_CI_ATTEMPTS: "1",
    };

    const ordinary = run("bash", [join(root, "scripts/npm-ci-retry.sh")], { env: baseEnvironment });
    assert.equal(ordinary.status, 0, ordinary.stderr);
    assert.deepEqual(readFileSync(argumentsFile, "utf8").trim().split("\n").slice(0, 2), ["ci", "--fetch-retries=5"]);
    assert.doesNotMatch(readFileSync(argumentsFile, "utf8"), /--ignore-scripts|--no-audit|--fund=false/);

    const sidecar = run("bash", [join(root, "scripts/npm-ci-retry.sh")], {
      env: { ...baseEnvironment, HARA_NPM_CI_IGNORE_SCRIPTS: "1" },
    });
    assert.equal(sidecar.status, 0, sidecar.stderr);
    assert.deepEqual(readFileSync(argumentsFile, "utf8").trim().split("\n").slice(0, 4), [
      "ci",
      "--ignore-scripts",
      "--no-audit",
      "--fund=false",
    ]);

    const invalid = run("bash", [join(root, "scripts/npm-ci-retry.sh")], {
      env: { ...baseEnvironment, HARA_NPM_CI_IGNORE_SCRIPTS: "yes" },
    });
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /must be 0 or 1/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("npm audit helper retries a transient endpoint failure but never retries a real advisory", () => {
  const directory = mkdtempSync(join(tmpdir(), "hara-npm-audit-retry-"));
  try {
    const fakeNpm = join(directory, "npm");
    const counter = join(directory, "count");
    writeFileSync(fakeNpm, `#!/usr/bin/env bash
set -euo pipefail
count=0
[ ! -f "$HARA_TEST_AUDIT_COUNTER" ] || count="$(<"$HARA_TEST_AUDIT_COUNTER")"
echo $((count + 1)) >"$HARA_TEST_AUDIT_COUNTER"
if [ "$HARA_TEST_AUDIT_SCENARIO" = "transient" ] && [ "$count" -eq 0 ]; then
  echo "npm error audit endpoint returned an error" >&2
  exit 1
fi
if [ "$HARA_TEST_AUDIT_SCENARIO" = "vulnerability" ]; then
  echo '{"metadata":{"vulnerabilities":{"high":1,"total":1}}}'
  exit 1
fi
echo '{"metadata":{"vulnerabilities":{"total":0}}}'
`);
    chmodSync(fakeNpm, 0o755);

    const transient = run("bash", [join(root, "scripts/npm-audit-retry.sh")], {
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        HARA_TEST_AUDIT_COUNTER: counter,
        HARA_TEST_AUDIT_SCENARIO: "transient",
        HARA_NPM_AUDIT_ATTEMPTS: "2",
        HARA_NPM_AUDIT_RETRY_DELAY_SECONDS: "0",
      },
    });
    assert.equal(transient.status, 0, transient.stderr);
    assert.equal(readFileSync(counter, "utf8").trim(), "2");

    writeFileSync(counter, "0\n");
    const vulnerability = run("bash", [join(root, "scripts/npm-audit-retry.sh")], {
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        HARA_TEST_AUDIT_COUNTER: counter,
        HARA_TEST_AUDIT_SCENARIO: "vulnerability",
        HARA_NPM_AUDIT_ATTEMPTS: "4",
        HARA_NPM_AUDIT_RETRY_DELAY_SECONDS: "0",
      },
    });
    assert.equal(vulnerability.status, 1);
    assert.match(vulnerability.stderr, /found production dependency vulnerabilities/);
    assert.equal(readFileSync(counter, "utf8").trim(), "1", "a real advisory must fail on the first attempt");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("promotion rechecks both remote tags at the publication boundary and verifies immutability", () => {
  const releaseScript = readFileSync(join(root, "scripts/release-mac-assets.sh"), "utf8");
  const immutablePolicyCheck = releaseScript.indexOf(
    'github-api-read.mjs "repos/$REPO/immutable-releases"',
  );
  const finalDesktopTagCheck = releaseScript.indexOf("FINAL_REMOTE_DESKTOP_COMMIT");
  const finalCliTagCheck = releaseScript.indexOf("FINAL_REMOTE_CLI_COMMIT");
  const publish = releaseScript.indexOf('release_gh release edit "$TAG"');
  const publishedMetadata = releaseScript.indexOf("PUBLISHED_RELEASE_METADATA", publish);
  const delegatedAttestation = releaseScript.indexOf(
    'if [ "${HARA_DEFER_PUBLIC_EDGE_VERIFY:-0}" = "1" ]',
    publish,
  );
  const immutableAttestation = releaseScript.indexOf('release_gh release verify "$TAG"', publish);
  assert.ok(immutablePolicyCheck >= 0 && immutablePolicyCheck < publish);
  assert.ok(finalDesktopTagCheck >= 0 && finalDesktopTagCheck < publish);
  assert.ok(finalCliTagCheck >= 0 && finalCliTagCheck < publish);
  assert.ok(publishedMetadata > publish && publishedMetadata < delegatedAttestation);
  assert.ok(delegatedAttestation > publish && immutableAttestation > delegatedAttestation);
  assert.match(
    releaseScript.slice(publishedMetadata, delegatedAttestation),
    /\.isDraft == false[\s\S]*?\.isImmutable == true[\s\S]*?\.isPrerelease == false/,
  );
  assert.match(releaseScript, /RELEASE_GH_TOKEN="\$\{GH_TOKEN:-\}"\n(?:.*\n)?unset GH_TOKEN/);
});

test("release trust reads use bounded retries and hard timeouts", () => {
  const workflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
  const remoteHelper = readFileSync(join(root, "scripts/resolve-remote-tag.mjs"), "utf8");
  const apiHelper = readFileSync(join(root, "scripts/github-api-read.mjs"), "utf8");
  const releaseScripts = [
    "scripts/refresh-sidecar.sh",
    "scripts/build-mac-signed.sh",
    "scripts/release-mac-assets.sh",
  ].map((path) => readFileSync(join(root, path), "utf8"));

  assert.match(remoteHelper, /REMOTE_TAG_ATTEMPTS = 3/);
  assert.match(remoteHelper, /REMOTE_TAG_TIMEOUT_MS = 45_000/);
  assert.match(remoteHelper, /http\.version=HTTP\/1\.1/);
  assert.match(remoteHelper, /http\.lowSpeedTime=20/);
  assert.match(apiHelper, /API_ATTEMPTS = 3/);
  assert.match(apiHelper, /API_TIMEOUT_MS = 45_000/);
  for (const script of releaseScripts) {
    assert.match(script, /resolve-remote-tag\.mjs/);
    assert.doesNotMatch(script, /\bls-remote\b/);
  }
  assert.match(workflow, /timeout --signal=KILL 45s gh api/);
  assert.match(
    workflow,
    /Require immutable releases[\s\S]*?github-api-read\.mjs[\s\S]*?could not read the immutable-release policy after bounded retries/,
  );
});

test("release CDN reads force HTTP/1.1 and stop zero-byte stalls within bounded time", () => {
  const workflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
  const promotion = readFileSync(join(root, "scripts/release-mac-assets.sh"), "utf8");
  const publicEdge = readFileSync(join(root, "scripts/verify-public-release-edge.sh"), "utf8");

  assert.match(
    workflow,
    /Materialize exact release sources[\s\S]*?\/usr\/bin\/curl[\s\S]*?--http1\.1[\s\S]*?--connect-timeout 20[\s\S]*?--max-time 570[\s\S]*?--speed-limit 1024[\s\S]*?--speed-time 60/,
  );
  assert.match(promotion, /release_public_curl\(\)/);
  assert.match(
    promotion,
    /curl --http1\.1 --fail --location --retry 5 --retry-all-errors[\s\S]*?--connect-timeout "\$RELEASE_PUBLIC_CONNECT_TIMEOUT_SECONDS"[\s\S]*?--max-time "\$RELEASE_PUBLIC_MAX_TIME_SECONDS"[\s\S]*?--speed-limit "\$RELEASE_PUBLIC_LOW_SPEED_BYTES"[\s\S]*?--speed-time "\$RELEASE_PUBLIC_LOW_SPEED_SECONDS"/,
  );
  assert.equal(
    (promotion.match(/release_public_curl \\\n/g) || []).length,
    3,
    "verification-only latest, public DMGs, and final latest convergence must share the bounded edge reader",
  );
  assert.doesNotMatch(promotion, /curl --fail --location --retry/);
  assert.match(publicEdge, /gh release view "\$TAG"[\s\S]*?isImmutable[\s\S]*?assets/);
  assert.match(publicEdge, /\.isImmutable == true/);
  assert.match(publicEdge, /gh release verify "\$TAG"/);
  assert.match(publicEdge, /release_gh\(\)[\s\S]*?for attempt in 1 2 3/);
  assert.match(
    publicEdge,
    /\/usr\/bin\/curl[\s\S]*?--http1\.1[\s\S]*?--retry-max-time 540[\s\S]*?--max-time 570[\s\S]*?--speed-limit 1024[\s\S]*?--speed-time 60/,
  );
  assert.match(publicEdge, /actual_size[\s\S]*?expected_size[\s\S]*?actual_sha[\s\S]*?expected_sha/);
  assert.equal((publicEdge.match(/\/usr\/sbin\/spctl/g) || []).length, 2);
  assert.match(publicEdge, /for attempt in \{1\.\.12\}; do/);
  assert.match(publicEdge, /cmp -s "\$IMMUTABLE_LATEST" "\$STABLE_LATEST"/);
  assert.match(promotion, /for attempt in \{1\.\.180\}; do/);
  assert.match(promotion, /attempt \$attempt\/180[\s\S]*?sleep 10/);
  assert.match(promotion, /did not propagate within 30 minutes/);
});

test("a post-publication rerun switches to immutable verification without rewriting assets", () => {
  const workflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
  const script = readFileSync(join(root, "scripts/release-mac-assets.sh"), "utf8");
  const verificationOnly = script.indexOf("Published immutable release detected; entering verification-only rerun");
  const localSignedOutputGate = script.indexOf("node scripts/release-provenance.mjs verify");
  const publish = script.indexOf('release_gh release edit "$TAG"');
  assert.ok(verificationOnly >= 0 && verificationOnly < localSignedOutputGate && verificationOnly < publish);
  const branch = script.slice(verificationOnly, localSignedOutputGate);
  assert.match(branch, /HARA_DEFER_PUBLIC_EDGE_VERIFY/);
  assert.match(branch, /release_gh release verify/);
  assert.match(branch, /GitHub release attestation verification is delegated/);
  assert.match(branch, /release_download_all/);
  assert.match(branch, /updater-manifest\.mjs validate/);
  assert.match(branch, /verify_signed_dmg public .*aarch64-apple-darwin/);
  assert.match(branch, /verify_signed_dmg public .*x86_64-apple-darwin/);
  assert.match(branch, /exit 0/);
  const sourceGate = workflow.slice(
    workflow.indexOf("Materialize exact release sources from the digest-bound Release archive"),
    workflow.indexOf("- name: Install protected signing toolchain"),
  );
  assert.match(sourceGate, /\.draft == false and[\s\S]*?\.immutable == true/);
  assert.doesNotMatch(sourceGate, /gh release verify/);
  const digestGate = sourceGate.indexOf('.digest == $digest');
  const sourceDownload = sourceGate.indexOf('releases/assets/$SOURCE_ASSET_ID');
  assert.ok(digestGate >= 0 && sourceDownload > digestGate);
  assert.match(sourceGate, /public attestation verification is delegated to the read-only hosted job/);
});

test("native sidecar builds attest CLI HEAD and cleanliness after compilation", () => {
  const buildWorkflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
  const compile = buildWorkflow.indexOf("bun scripts/build-binary.ts");
  const headGate = buildWorkflow.indexOf('git -C "$CLI_DIR" rev-parse HEAD', compile);
  const cleanGate = buildWorkflow.indexOf('git -C "$CLI_DIR" status --porcelain', compile);
  const copy = buildWorkflow.indexOf('cp "dist/bin/hara-sidecar${EXT}"', compile);
  assert.ok(compile >= 0 && headGate > compile && headGate < copy);
  assert.ok(cleanGate > compile && cleanGate < copy);
});

test("target-runtime downloads and RPM extraction fail only after bounded portable retries", () => {
  const workflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
  const refresh = readFileSync(join(root, "scripts/refresh-sidecar.sh"), "utf8");
  const packageSmoke = readFileSync(join(root, "scripts/package-smoke.mjs"), "utf8");
  assert.match(workflow, /for attempt in 1 2 3; do[\s\S]*?bun scripts\/build-binary\.ts/);
  assert.match(refresh, /for attempt in 1 2 3; do[\s\S]*?bun scripts\/build-binary\.ts/);
  assert.match(workflow, /matrix\.target == 'x86_64-pc-windows-msvc'/);
  assert.match(workflow, /bun-v1\.3\.9\/bun-windows-x64-baseline\.zip/);
  assert.match(workflow, /BUN_WINDOWS_BASELINE_SHA256: "39f12024edc27d3706baa7b72a06156896b536af61472e0f9a6fe9c5e25b97cc"/);
  assert.match(workflow, /sha256sum "\$\(command -v bun\)"/);
  assert.match(workflow, /x86_64-pc-windows-msvc\)\s+BUN_TARGET=""/);
  assert.match(workflow, /BUILD_COMMAND=\(bun scripts\/build-binary\.ts dist\/bin\/hara-sidecar\)/);
  assert.match(workflow, /libarchive-tools/);
  assert.match(packageSmoke, /runExtractionTool\(\s*"bsdtar"/);
  assert.doesNotMatch(packageSmoke, /"rpm2cpio"/);
});

test("every x64 sidecar uses a baseline CPU target and executes the hostile-cwd boundary smoke", () => {
  const workflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
  const refresh = readFileSync(join(root, "scripts/refresh-sidecar.sh"), "utf8");
  const smoke = readFileSync(join(root, "scripts/sidecar-smoke.mjs"), "utf8");

  for (const target of ["bun-darwin-x64-baseline", "bun-linux-x64-baseline", "bun-windows-x64-baseline"]) {
    assert.match(workflow, new RegExp(target));
    assert.match(refresh, new RegExp(target));
  }
  assert.match(smoke, /bunfig\.toml/);
  assert.match(smoke, /HARA_DESKTOP_DOTENV_MUST_NOT_LOAD/);
  assert.match(smoke, /runSidecar\(\["doctor"\]/);
  assert.match(smoke, /runSidecar\(\["sessions"\]/);
  assert.match(smoke, /No sessions yet\./);
  assert.match(smoke, /AMBIENT_PRELOAD_EXECUTED/);
  assert.match(smoke, /--serve-capabilities/);
  for (const capability of [
    "desk.connections.list",
    "desk.snapshot",
    "desk.task.get",
    "collaboration.remote.v1",
  ]) {
    assert.match(smoke, new RegExp(capability.replaceAll(".", "\\.")));
  }
});

test("sidecar smoke bounds retries for transient Windows cleanup locks", () => {
  const smoke = readFileSync(join(root, "scripts/sidecar-smoke.mjs"), "utf8");
  assert.match(
    smoke,
    /rmSync\(smokeHome,\s*\{[\s\S]*?recursive:\s*true,[\s\S]*?force:\s*true,[\s\S]*?maxRetries:\s*10,[\s\S]*?retryDelay:\s*200,[\s\S]*?\}\)/,
  );
});

test("sidecar refresh accepts both normal repositories and linked Git worktrees", () => {
  const refresh = readFileSync(join(root, "scripts/refresh-sidecar.sh"), "utf8");
  assert.match(refresh, /git -C "\$CLI" rev-parse --is-inside-work-tree/);
  assert.doesNotMatch(refresh, /\[ -d "\$CLI\/\.git" \]/);
});

test("Hara Live bundles a checksum-pinned Herdr runtime and verifies it after packaging", () => {
  const lock = JSON.parse(readFileSync(join(root, "scripts/herdr-runtime-lock.json"), "utf8"));
  assert.equal(lock.version, "0.8.2");
  assert.equal(lock.repository, "https://github.com/herdrdev/herdr");
  assert.equal(lock.license, "Apache-2.0");
  assert.deepEqual(Object.keys(lock.targets).sort(), [
    "aarch64-apple-darwin",
    "aarch64-unknown-linux-gnu",
    "x86_64-apple-darwin",
    "x86_64-pc-windows-msvc",
    "x86_64-unknown-linux-gnu",
  ]);
  for (const target of Object.values(lock.targets)) {
    assert.match(target.asset, /^herdr-(?:macos|linux|windows)-/);
    assert.match(target.sha256, /^[a-f0-9]{64}$/);
  }

  const config = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
  assert.ok(config.bundle.externalBin.includes("binaries/herdr"));
  assert.ok(config.bundle.resources.includes("../THIRD_PARTY_NOTICES.md"));
  const notices = readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
  assert.match(notices, /Herdr[\s\S]*0\.8\.2[\s\S]*Apache License 2\.0/);

  const refresh = readFileSync(join(root, "scripts/refresh-herdr-runtime.mjs"), "utf8");
  assert.match(refresh, /if \(actual !== entry\.sha256\)/);
  assert.match(refresh, /stagedDestination = join\(dirname\(destination\)/);
  assert.ok(refresh.indexOf("if (actual !== entry.sha256)") < refresh.indexOf("writeFile(stagedDestination"));
  const packageSmoke = readFileSync(join(root, "scripts/package-smoke.mjs"), "utf8");
  assert.match(packageSmoke, /herdrRuntime\(bundledHerdr\)/);
  assert.match(packageSmoke, /herdrLock\.version/);
});

test("draft assembly and promotion both validate published source provenance", () => {
  const buildWorkflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
  const releaseScript = readFileSync(join(root, "scripts/release-mac-assets.sh"), "utf8");
  const updaterManifest = readFileSync(join(root, "scripts/updater-manifest.mjs"), "utf8");
  assert.match(buildWorkflow, /release-source-provenance\.mjs build/);
  assert.match(buildWorkflow, /release-source-provenance\.mjs validate/);
  assert.match(releaseScript, /release-source-provenance\.mjs validate/);
  assert.match(updaterManifest, /"release-source-provenance\.json"/);
});
