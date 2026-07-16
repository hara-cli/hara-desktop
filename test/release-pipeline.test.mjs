import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { requireStableTag, requireStableVersion } from "../scripts/release-policy.mjs";
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

test("stable policy rejects prerelease versions and tags", () => {
  assert.equal(requireStableVersion("1.2.3"), "1.2.3");
  assert.equal(requireStableTag("v1.2.3", "1.2.3"), "v1.2.3");
  assert.throws(() => requireStableVersion("1.2.3-rc.1"), /stable X\.Y\.Z/);
  assert.throws(() => requireStableTag("v1.2.3-rc.1", "1.2.3-rc.1"), /stable X\.Y\.Z/);
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

test("Apple Silicon sidecar is re-signed before post-normalization smoke", () => {
  const script = readFileSync(join(root, "scripts/build-mac-signed.sh"), "utf8");
  const removeSignature = script.indexOf('codesign --remove-signature "$SIDECAR"');
  const developerIdSign = script.indexOf(
    'codesign --force --options runtime --timestamp --keychain "$CODESIGN_KEYCHAIN"',
    removeSignature,
  );
  const signedSmoke = script.indexOf(
    'node scripts/sidecar-smoke.mjs "$SIDECAR" "$EXPECTED_SIDECAR_VERSION" "$TARGET"',
    removeSignature,
  );
  assert.ok(removeSignature >= 0, "remove-signature step missing");
  assert.ok(developerIdSign > removeSignature, "Developer ID signing must follow signature removal");
  assert.ok(signedSmoke > developerIdSign, "sidecar must not execute while its arm64 Mach-O is unsigned");
});

test("signed builds select pinned Rust and preflight a dedicated unlocked keychain", () => {
  const toolchain = readFileSync(join(root, "scripts/check-build-toolchain.sh"), "utf8");
  const script = readFileSync(join(root, "scripts/build-mac-signed.sh"), "utf8");
  const workflow = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");

  assert.match(toolchain, /rustup which --toolchain "\$required" rustc/);
  assert.match(toolchain, /export PATH="\$toolchain_bin:\$PATH"/);
  assert.match(toolchain, /export RUSTC="\$rustc_command"/);
  assert.match(toolchain, /export CARGO="\$cargo_command"/);

  const unlock = script.indexOf('security unlock-keychain -p "$CODESIGN_PASSWORD"');
  const forgetPassword = script.indexOf("unset CODESIGN_PASSWORD HARA_CODESIGN_KEYCHAIN_PASSWORD", unlock);
  const keyProbe = script.indexOf('cp /usr/bin/true "$CODESIGN_PROBE_DIR/probe"', unlock);
  const actualSign = script.indexOf('codesign --remove-signature "$SIDECAR"');
  assert.ok(unlock >= 0 && forgetPassword > unlock && keyProbe > forgetPassword && actualSign > keyProbe);
  assert.match(script, /codesign --verify --strict "\$CODESIGN_PROBE_DIR\/probe"/);
  assert.match(script, /security lock-keychain "\$CODESIGN_KEYCHAIN"/);
  assert.match(script, /security list-keychains -d user -s "\$\{ORIGINAL_KEYCHAINS\[@\]\}"/);
  assert.match(script, /hara-codesign-keychain\.password/);
  assert.match(script, /stat -f '%Lp'.*CODESIGN_PASSWORD_FILE/);
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
  assert.match(buildWorkflow, /gh api --paginate[\s\S]*?rulesets\?targets=tag&per_page=100/);
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
  const workflows = [readFileSync(join(root, ".github/workflows/build.yml"), "utf8")];
  for (const workflow of workflows) {
    const actionRefs = [...workflow.matchAll(/uses:\s+[^\s@]+@([^\s#]+)/g)].map((match) => match[1]);
    assert.ok(actionRefs.length > 0, "expected external actions in release workflow");
    for (const ref of actionRefs) assert.match(ref, /^[0-9a-f]{40}$/, `floating action ref: ${ref}`);
    const checkoutCount = (workflow.match(/uses: actions\/checkout@/g) || []).length;
    const nonPersistentCheckoutCount = (workflow.match(/persist-credentials: false/g) || []).length;
    assert.equal(nonPersistentCheckoutCount, checkoutCount, "every checkout must remove its Git credential");
    assert.match(workflow, new RegExp(`toolchain: ["']?${rustVersion.replaceAll(".", "\\.")}["']?`));
  }
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
  const immutablePolicyCheck = releaseScript.indexOf('gh api "repos/$REPO/immutable-releases"');
  const finalDesktopTagCheck = releaseScript.indexOf("FINAL_REMOTE_DESKTOP_TAGS");
  const finalCliTagCheck = releaseScript.indexOf("FINAL_REMOTE_CLI_TAGS");
  const publish = releaseScript.indexOf('release_gh release edit "$TAG"');
  const immutableAttestation = releaseScript.indexOf('release_gh release verify "$TAG"', publish);
  assert.ok(immutablePolicyCheck >= 0 && immutablePolicyCheck < publish);
  assert.ok(finalDesktopTagCheck >= 0 && finalDesktopTagCheck < publish);
  assert.ok(finalCliTagCheck >= 0 && finalCliTagCheck < publish);
  assert.ok(immutableAttestation > publish);
  assert.match(releaseScript, /RELEASE_GH_TOKEN="\$\{GH_TOKEN:-\}"\n(?:.*\n)?unset GH_TOKEN/);
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
