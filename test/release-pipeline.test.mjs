import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const result = readGitHubApi(
    "repos/hara-cli/hara-desktop/immutable-releases",
    ["--jq", ".enabled"],
    {
      timeoutMs: 2_345,
      sleep: () => {},
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
        if (calls === 1) throw new Error("TLS handshake timeout");
        return "true\n";
      },
    },
  );
  assert.equal(result, "true");
  assert.equal(calls, 2);
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
  const tauriBuild = script.indexOf("npm run tauri build", removeSignature);
  const packagedSmoke = script.indexOf("node scripts/package-smoke.mjs", tauriBuild);
  assert.ok(refresh >= 0 && refresh < removeSignature, "boundary smoke must precede signature removal");
  assert.ok(removeSignature < tauriBuild, "Tauri must receive the unsigned source sidecar");
  const unsignedGap = script.slice(removeSignature, tauriBuild);
  assert.doesNotMatch(unsignedGap, /codesign --force|sidecar-smoke\.mjs/);
  assert.match(unsignedGap, /if codesign --verify "\$SIDECAR"/);
  assert.ok(packagedSmoke > tauriBuild, "only the Tauri-packaged sidecar may execute after normalization");
  assert.match(script, /PACKAGED_SIDECAR_SIGNATURE=.*codesign -d --verbose=4/);
  assert.match(script, /Authority=\$IDENTITY/);
  assert.match(script, /\^Timestamp=/);
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
  assert.equal((promotion.match(/node scripts\/stapler-validate\.mjs/g) || []).length, 3);
  assert.doesNotMatch(promotion, /xcrun stapler validate/);
});

test("DMG notarization separates submission from bounded status polling", () => {
  assert.equal(isTransientNotaryFailure({ signal: "SIGBUS" }), true);
  assert.equal(isTransientNotaryFailure({ status: 138, stderr: "Bus error: 10" }), true);
  assert.equal(isTransientNotaryFailure({ stderr: "NSURLErrorDomain Code=-1001 request timed out" }), true);
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
  assert.match(script, /security lock-keychain "\$CODESIGN_KEYCHAIN"/);
  assert.match(script, /security list-keychains -d user -s "\$\{ORIGINAL_KEYCHAINS\[@\]\}"/);
  assert.match(script, /hara-codesign-keychain\.password/);
  assert.match(script, /append_original_keychain/);
  assert.match(script, /\[ -f "\$candidate" \] \|\| return 0/);
  assert.match(script, /stat -f '%Lp'.*CODESIGN_PASSWORD_FILE/);
  assert.doesNotMatch(script, /security show-keychain-info/);
  assert.doesNotMatch(workflow, /HARA_CODESIGN_KEYCHAIN_PASSWORD/);
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

test("Linux and Windows smoke execute sidecars extracted from real installers", () => {
  const packageSmoke = readFileSync(join(root, "scripts/package-smoke.mjs"), "utf8");
  assert.doesNotMatch(packageSmoke, /sidecar\(join\(releaseBase, "hara(?:\.exe)?"\), "staged sidecar"\)/);
  assert.match(packageSmoke, /smokeInstalledSidecars\(deb, "deb", "Debian package", "hara"\)/);
  assert.match(packageSmoke, /smokeInstalledSidecars\(rpm, "rpm", "RPM package", "hara"\)/);
  assert.match(packageSmoke, /smokeInstalledSidecars\(msi, "msi", "MSI installer", "hara\.exe"\)/);
  assert.match(packageSmoke, /smokeInstalledSidecars\(nsis, "nsis", "NSIS installer", "hara\.exe"\)/);
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
  for (const job of ["prepare_release", "create_draft", "build", "assemble_draft", "promotion_preflight", "sign_and_promote"]) {
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
    /sign_and_promote:\n[\s\S]*?needs: \[prepare_release, assemble_draft, promotion_preflight\]/,
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
  }
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
  const validationStart = workflow.indexOf("Revalidate downloaded draft without a release token");
  const stateCheckStart = workflow.indexOf("Confirm the remote release remains a hidden draft", validationStart);
  const validation = workflow.slice(validationStart, stateCheckStart);
  assert.match(validation, /node scripts\/updater-manifest\.mjs validate/);
  assert.match(validation, /node scripts\/release-source-provenance\.mjs validate/);
  assert.doesNotMatch(validation, /GH_TOKEN|github\.token/);
});

test("draft asset replacement resolves a hidden release through its database ID", () => {
  const workflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
  const replaceStart = workflow.indexOf("Replace hidden draft assets after every native gate");
  const downloadStart = workflow.indexOf("Download the exact remote draft", replaceStart);
  const replacement = workflow.slice(replaceStart, downloadStart);

  assert.match(replacement, /gh release view "\$RELEASE_TAG" --json databaseId --jq \.databaseId/);
  assert.match(replacement, /\[\[ "\$RELEASE_ID" =~ \^\[0-9\]\+\$ \]\]/);
  assert.doesNotMatch(replacement, /releases\/tags\/\$RELEASE_TAG/);
});

test("promotion rechecks both remote tags at the publication boundary and verifies immutability", () => {
  const releaseScript = readFileSync(join(root, "scripts/release-mac-assets.sh"), "utf8");
  const immutablePolicyCheck = releaseScript.indexOf(
    'github-api-read.mjs "repos/$REPO/immutable-releases"',
  );
  const finalDesktopTagCheck = releaseScript.indexOf("FINAL_REMOTE_DESKTOP_COMMIT");
  const finalCliTagCheck = releaseScript.indexOf("FINAL_REMOTE_CLI_COMMIT");
  const publish = releaseScript.indexOf('release_gh release edit "$TAG"');
  const immutableAttestation = releaseScript.indexOf('release_gh release verify "$TAG"', publish);
  assert.ok(immutablePolicyCheck >= 0 && immutablePolicyCheck < publish);
  assert.ok(finalDesktopTagCheck >= 0 && finalDesktopTagCheck < publish);
  assert.ok(finalCliTagCheck >= 0 && finalCliTagCheck < publish);
  assert.ok(immutableAttestation > publish);
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

test("a post-publication rerun switches to immutable verification without rewriting assets", () => {
  const script = readFileSync(join(root, "scripts/release-mac-assets.sh"), "utf8");
  const verificationOnly = script.indexOf("Published immutable release detected; entering verification-only rerun");
  const localSignedOutputGate = script.indexOf("node scripts/release-provenance.mjs verify");
  const publish = script.indexOf('release_gh release edit "$TAG"');
  assert.ok(verificationOnly >= 0 && verificationOnly < localSignedOutputGate && verificationOnly < publish);
  const branch = script.slice(verificationOnly, localSignedOutputGate);
  assert.match(branch, /release_gh release verify/);
  assert.match(branch, /release_gh release download/);
  assert.match(branch, /updater-manifest\.mjs validate/);
  assert.match(branch, /mac-dmg-smoke\.mjs/);
  assert.match(branch, /exit 0/);
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
  assert.match(smoke, /AMBIENT_PRELOAD_EXECUTED/);
});

test("sidecar refresh accepts both normal repositories and linked Git worktrees", () => {
  const refresh = readFileSync(join(root, "scripts/refresh-sidecar.sh"), "utf8");
  assert.match(refresh, /git -C "\$CLI" rev-parse --is-inside-work-tree/);
  assert.doesNotMatch(refresh, /\[ -d "\$CLI\/\.git" \]/);
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
