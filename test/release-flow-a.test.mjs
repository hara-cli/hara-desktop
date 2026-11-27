// Release flow A (Jeff 2026-11-10): the protected signer materializes sources from a local SSH
// mirror, and prepackage.yml rehearses build.yml's native package matrix before the tag.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const build = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
const prepackage = readFileSync(join(root, ".github/workflows/prepackage.yml"), "utf8");

function job(workflow, name, next) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `missing job ${name}`);
  const end = next ? workflow.indexOf(`\n  ${next}:\n`, start + 1) : workflow.length;
  assert.ok(end > start, `missing job after ${name}`);
  return workflow.slice(start, end);
}

function steps(block) {
  const body = block.slice(block.indexOf("    steps:\n") + "    steps:\n".length);
  return body.split(/^(?=      - )/m).filter((step) => step.trim());
}

function stepName(step) {
  const match = step.match(/^      - (?:name: (.+)|uses: (.+))$/m);
  assert.ok(match, `unnamed step:\n${step}`);
  return (match[1] ?? match[2]).trim();
}

const releaseBuild = job(build, "build", "windows_install");
const releasePrepare = job(build, "prepare_release", "create_draft");
const signJob = job(build, "sign_and_promote", "verify_public_release");
const rehearsalPrepare = job(prepackage, "prepare_release", "build");
const rehearsalBuild = job(prepackage, "build", "windows_install");
const rehearsalSigner = job(prepackage, "signer_path", "merge_metadata_path");
const windowsInstaller = readFileSync(join(root, ".github/workflows/windows-install-smoke.yml"), "utf8");

test("prepackage copies build.yml's package matrix and differs only in the reviewed places", () => {
  const omitted = new Set([
    "Require updater signing key",
    "Collect canonical release assets after smoke",
    "Upload verified matrix assets for single-writer assembly",
  ]);
  const added = new Set(["Generate a throwaway updater key for this rehearsal",
    // HARA-FB-001698: The additional native Workspace startup test runs only in rehearsal.
    "Windows real-sidecar Workspace startup (prepackage only)"]);
  const expected = steps(releaseBuild).filter((step) => !omitted.has(stepName(step)));
  const actual = steps(rehearsalBuild).filter((step) => !added.has(stepName(step)));
  assert.deepEqual(actual.map(stepName), expected.map(stepName), "same steps in the same order");

  const allowed = new Map([
    ["Build and execute-smoke pinned hara sidecar", [
      'git -C "$CLI_DIR" fetch --quiet --depth 1 origin "refs/tags/v${CLI_VERSION}"',
      'git -C "$CLI_DIR" fetch --quiet --depth 1 origin "$CLI_SHA"',
    ]],
    ["Stage exact Windows install transfer after package smoke", [
      'WINDOWS_RELEASE_ONLY: "true"',
      'WINDOWS_RELEASE_ONLY: "false"',
    ]],
    ["Upload exact Windows install transfer for both installer jobs", [
      "          retention-days: 1\n",
      "          retention-days: 7\n",
    ]],
    ["Build local packages (no release API access)", [
      "TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.HARA_TAURI_SIGNING_PRIVATE_KEY }}",
      "TAURI_SIGNING_PRIVATE_KEY: ${{ env.REHEARSAL_UPDATER_KEY }}",
    ]],
  ]);
  for (const [index, step] of expected.entries()) {
    const name = stepName(step), substitution = allowed.get(name);
    if (!substitution) {
      assert.equal(actual[index], step, `${name} must be byte-identical to build.yml`);
      continue;
    }
    const [from, to] = substitution;
    assert.equal(step.split(from).length, 2, `${name}: build.yml must contain the reviewed line once`);
    assert.equal(actual[index], step.replace(from, to), `${name}: only the reviewed line may differ`);
  }
  // The key is generated after dependencies are installed and immediately before packaging.
  const names = steps(rehearsalBuild).map(stepName);
  assert.equal(names.indexOf("Generate a throwaway updater key for this rehearsal") + 1,
    names.indexOf("Build local packages (no release API access)"));

  const matrix = (block) => block.slice(block.indexOf("    strategy:\n"), block.indexOf("    steps:\n"));
  assert.equal(matrix(rehearsalBuild), matrix(releaseBuild), "same platforms, targets and timeout");
  for (const name of ["Validate tag and release metadata",
    "Install locked prepare-release Desktop dependencies with bounded registry retries",
    "Run release-pipeline regression tests"]) {
    const original = steps(releasePrepare).find((step) => stepName(step) === name);
    assert.ok(original, name);
    assert.ok(steps(rehearsalPrepare).includes(original), `${name} must be byte-identical to build.yml`);
  }
});

test("prepackage rehearses the signer's release sidecar refresh and requires an unchanged tree", () => {
  // build-mac-signed.sh runs this refresh and then refuses a changed tree; v1.2.0 failed there.
  const signer = readFileSync(join(root, "scripts/build-mac-signed.sh"), "utf8");
  assert.match(signer, /HARA_RELEASE_BUILD=1 HARA_SIDECAR_TARGET="\$TARGET" \.\/scripts\/refresh-sidecar\.sh/);
  assert.match(signer, /source changed during the signed release build[\s\S]*?git status --porcelain --untracked-files=all >&2[\s\S]*?git diff --stat >&2[\s\S]*?exit 1/);
  assert.match(rehearsalSigner, /needs: \[prepare_release\]/);
  assert.match(rehearsalSigner, /runs-on: macos-15\n/);
  assert.match(rehearsalSigner, /path: hara-desktop/);
  assert.match(rehearsalSigner, /CLI_DIR="\$GITHUB_WORKSPACE\/hara-cli"/);
  assert.match(rehearsalSigner, /"refs\/tags\/v\$\{CLI_VERSION\}\^\{commit\}"\)" = "\$CLI_SHA"/);
  const refresh = rehearsalSigner.indexOf("HARA_RELEASE_BUILD=1 HARA_SIDECAR_TARGET=aarch64-apple-darwin ./scripts/refresh-sidecar.sh");
  const clean = rehearsalSigner.indexOf('[ -z "$(git status --porcelain)" ] && [ "$(git rev-parse HEAD)" = "$PINNED_DESKTOP_SHA" ]');
  assert.ok(refresh > 0 && clean > refresh, "the clean-tree check must follow the release refresh");
  assert.match(rehearsalSigner, /git status --porcelain --untracked-files=all >&2/);
});

test("prepackage is dispatch-only, hosted-only and cannot read secrets or write", () => {
  assert.match(prepackage, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(prepackage, /^\s+(?:push|pull_request|pull_request_target|schedule|workflow_run|release):/m);
  assert.match(prepackage, /^permissions:\n  contents: read\n\n/m);
  assert.doesNotMatch(prepackage, /secrets\./);
  assert.doesNotMatch(prepackage, /:\s*write\b/);
  assert.doesNotMatch(prepackage, /^\s+environment:/m);
  assert.doesNotMatch(prepackage, /self-hosted|hara-desktop-release/);
  assert.doesNotMatch(prepackage, /gh release |api\.github\.com\/repos\/[^\n]*\/releases/);
  const uploads = steps(rehearsalBuild).filter((step) => step.includes("actions/upload-artifact@"));
  assert.equal(uploads.length, 1);
  assert.equal(stepName(uploads[0]), "Upload exact Windows install transfer for both installer jobs");
  assert.match(uploads[0], /name: windows-install-transfer-/);
  assert.doesNotMatch(prepackage, /release-assets-|secrets:\s*inherit/);
  assert.match(rehearsalPrepare, /\[ "\$INPUT_SHA" = "\$GITHUB_SHA" \]/);
  assert.match(rehearsalPrepare, /ref: \$\{\{ inputs\.sha \}\}/);
  assert.match(rehearsalBuild, /signer generate --ci -p "" -w "\$KEY"/);
  assert.match(rehearsalBuild, /echo "::add-mask::\$VALUE"/);
});

test("Windows jobs receive one immutable transfer and production collection waits for both", () => {
  assert.match(windowsInstaller, /^on:\n  workflow_call:\n/m);
  assert.match(windowsInstaller, /^permissions:\n  contents: read\n/m);
  assert.match(windowsInstaller, /fail-fast: false\n\s+matrix:\n\s+installer: \[msi, nsis\]/);
  assert.match(windowsInstaller, /artifact-ids: \$\{\{ inputs\.transfer_id \}\}/);
  assert.match(windowsInstaller, /skip-decompress: true\n\s+digest-mismatch: error/);
  assert.doesNotMatch(windowsInstaller, /secrets\.|environment:|release-assets-/);
  assert.ok(windowsInstaller.indexOf("preflight and transfer proof") < windowsInstaller.indexOf("Verify installed credentials"));

  const formal = job(build, "windows_install", "collect_windows_assets");
  const rehearsal = job(prepackage, "windows_install", "signer_path");
  assert.equal(rehearsal, formal.replace("release_only: true", "release_only: false"));
  assert.match(formal, /needs: \[prepare_release, build\]/);
  assert.match(formal, /uses: \.\/\.github\/workflows\/windows-install-smoke\.yml/);
  for (const suffix of ["id", "sha256"]) {
    assert.ok(formal.includes(`transfer_${suffix}: \${{ needs.build.outputs.windows_transfer_${suffix} }}`));
  }
  assert.match(formal, /manifest_sha256: \$\{\{ needs.build.outputs.windows_manifest_sha256 \}\}/);

  const collect = job(build, "collect_windows_assets", "assemble_draft");
  const assemble = job(build, "assemble_draft", "promotion_preflight");
  assert.match(collect, /needs: \[prepare_release, build, windows_install\]/);
  assert.match(collect, /artifact-ids: \$\{\{ needs.build.outputs.windows_transfer_id \}\}/);
  assert.match(collect, /node scripts\/collect-release-assets\.mjs/);
  assert.doesNotMatch(collect, /continue-on-error|always\(\)|secrets\.|tauri build/);
  assert.match(assemble, /needs: \[prepare_release, build, collect_windows_assets, create_draft\]/);
  assert.match(signJob, /needs: \[prepare_release, create_draft, assemble_draft, promotion_preflight\]/);
});

test("a full rerun uses fresh artifact names and assembles only the current attempt", () => {
  const suffix = "-attempt-${{ github.run_attempt }}";
  const collect = job(build, "collect_windows_assets", "assemble_draft");
  const assemble = job(build, "assemble_draft", "promotion_preflight");
  assert.ok(releasePrepare.includes(`name: release-source-packs${suffix}\n`));
  assert.ok(releaseBuild.includes("name: release-assets-${{ matrix.target }}" + suffix + "\n"));
  assert.ok(collect.includes(`name: release-assets-x86_64-pc-windows-msvc${suffix}\n`));
  assert.ok(assemble.includes(`pattern: release-assets-*${suffix}\n`));
  for (const block of [releasePrepare, releaseBuild, collect]) assert.doesNotMatch(block, /overwrite:\s*true/);
});

test("only the formal Windows install transfer expires after one day", () => {
  const name = "Upload exact Windows install transfer for both installer jobs";
  const formal = steps(releaseBuild).find((step) => stepName(step) === name);
  const rehearsal = steps(rehearsalBuild).find((step) => stepName(step) === name);
  assert.match(formal, /^          retention-days: 1$/m);
  assert.match(rehearsal, /^          retention-days: 7$/m);
  const receipts = windowsInstaller.match(/^          retention-days: 7$/gm);
  assert.equal(receipts?.length, 2);
  assert.doesNotMatch(releaseBuild, /actions:\s+write|actions\/artifacts\/.*DELETE/);
});

test("the signer pins source trees from the prepare job and never downloads code over HTTPS", () => {
  assert.match(releasePrepare, /desktop_tree: \$\{\{ steps\.release_source\.outputs\.desktop_tree \}\}/);
  assert.match(releasePrepare, /cli_tree: \$\{\{ steps\.release_source\.outputs\.cli_tree \}\}/);
  assert.match(releasePrepare, /echo "desktop_tree=\$\(git rev-parse "\$DESKTOP_SHA\^\{tree\}"\)"/);
  assert.match(releasePrepare, /echo "cli_tree=\$\(git -C "\$CLI_DIR" rev-parse "\$CLI_SHA\^\{tree\}"\)"/);
  assert.match(signJob, /PINNED_DESKTOP_TREE: \$\{\{ needs\.prepare_release\.outputs\.desktop_tree \}\}/);
  assert.match(signJob, /PINNED_CLI_TREE: \$\{\{ needs\.prepare_release\.outputs\.cli_tree \}\}/);
  assert.match(signJob, /Materialize exact release sources from the local SSH mirror/);
  assert.match(signJob, /MIRROR_ROOT="\$HOME\/\.hara-runners\/mirrors"/);
  const commands = signJob.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
  const fetches = [...commands.matchAll(/^\s*(?:\/usr\/bin\/)?git\b[^\n]*\bfetch\b[^\n]*/gm)].map((match) => match[0]);
  assert.ok(fetches.length > 0);
  for (const line of fetches) assert.match(line, /"file:\/\/\$mirror"/, `only the local mirror may be fetched: ${line}`);
  // Only the source asset's Release *metadata* is read (binding the run to the hidden draft and
  // prepare-job digest); its bytes are never downloaded or unpacked on the signer.
  for (const forbidden of [/index-pack/, /ARTIFACT_PARTIAL/, /Accept: application\/octet-stream/, /ditto -x -k/, /--continue-at/, /^\s*(?:\/usr\/bin\/)?git clone/m]) {
    assert.doesNotMatch(commands, forbidden);
  }
});

function materializer() {
  const start = signJob.indexOf("          materialize_from_mirror() {");
  const end = signJob.indexOf("\n          }\n", start);
  assert.ok(start >= 0 && end > start, "materialize_from_mirror must be defined in the signing job");
  return signJob.slice(start, end + "\n          }\n".length).split("\n").map((line) => line.slice(10)).join("\n");
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" } });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

test("mirror materialization asserts commit and tree and fails closed without a fallback", { skip: process.platform === "win32" }, () => {
  const base = mkdtempSync(join(tmpdir(), "hara-mirror-")), source = join(base, "source");
  git(base, "init", "-q", source);
  writeFileSync(join(source, "file"), "one\n"); git(source, "add", "file"); git(source, "commit", "-qm", "one");
  const older = git(source, "rev-parse", "HEAD"), olderTree = git(source, "rev-parse", "HEAD^{tree}");
  writeFileSync(join(source, "file"), "two\n"); git(source, "commit", "-qam", "two");
  const mirror = join(base, "mirror.git");
  git(base, "clone", "-q", "--mirror", source, mirror);
  const script = join(base, "materialize.sh");
  writeFileSync(script, `set -euo pipefail\n${materializer()}materialize_from_mirror "$@"\n`);
  const run = (target, commit, tree, repository = mirror) => spawnSync("/bin/bash", [script, repository, join(base, target), commit, tree, "v9.9.9", "https://github.com/hara-cli/example.git"],
    { encoding: "utf8", timeout: 30_000, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });

  const ok = run("ok", older, olderTree);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(git(join(base, "ok"), "rev-parse", "HEAD"), older, "a non-tip pinned commit is materialized exactly");
  assert.equal(git(join(base, "ok"), "rev-parse", "refs/tags/v9.9.9"), older);
  assert.equal(readFileSync(join(base, "ok", "file"), "utf8"), "one\n");

  const missing = run("missing", "0".repeat(40), olderTree);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /lacks 0{40}; run git -C .* fetch --prune, then re-run this job/);
  const tree = run("tree", older, "f".repeat(40));
  assert.notEqual(tree.status, 0);
  assert.match(tree.stderr, /unexpected tree/);
  const absent = run("absent", older, olderTree, join(base, "absent.git"));
  assert.notEqual(absent.status, 0);
  assert.match(absent.stderr, /local release mirror is missing/);
});
