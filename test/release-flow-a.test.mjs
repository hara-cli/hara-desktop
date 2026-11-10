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

const releaseBuild = job(build, "build", "assemble_draft");
const releasePrepare = job(build, "prepare_release", "create_draft");
const signJob = job(build, "sign_and_promote", "verify_public_release");
const rehearsalPrepare = job(prepackage, "prepare_release", "build");
const rehearsalBuild = job(prepackage, "build");

test("prepackage copies build.yml's package matrix and differs only in the reviewed places", () => {
  const omitted = new Set([
    "Require updater signing key",
    "Collect canonical release assets after smoke",
    "Upload verified matrix assets for single-writer assembly",
  ]);
  const added = new Set(["Generate a throwaway updater key for this rehearsal"]);
  const expected = steps(releaseBuild).filter((step) => !omitted.has(stepName(step)));
  const actual = steps(rehearsalBuild).filter((step) => !added.has(stepName(step)));
  assert.deepEqual(actual.map(stepName), expected.map(stepName), "same steps in the same order");

  const allowed = new Map([
    ["Build and execute-smoke pinned hara sidecar", [
      'git -C "$CLI_DIR" fetch --quiet --depth 1 origin "refs/tags/v${CLI_VERSION}"',
      'git -C "$CLI_DIR" fetch --quiet --depth 1 origin "$CLI_SHA"',
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

test("prepackage is dispatch-only, hosted-only and cannot read secrets or write", () => {
  assert.match(prepackage, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(prepackage, /^\s+(?:push|pull_request|pull_request_target|schedule|workflow_run|release):/m);
  assert.match(prepackage, /^permissions:\n  contents: read\n\n/m);
  assert.doesNotMatch(prepackage, /secrets\./);
  assert.doesNotMatch(prepackage, /:\s*write\b/);
  assert.doesNotMatch(prepackage, /^\s+environment:/m);
  assert.doesNotMatch(prepackage, /self-hosted|hara-desktop-release/);
  assert.doesNotMatch(prepackage, /gh release |upload-artifact|api\.github\.com\/repos\/[^\n]*\/releases/);
  assert.match(rehearsalPrepare, /\[ "\$INPUT_SHA" = "\$GITHUB_SHA" \]/);
  assert.match(rehearsalPrepare, /ref: \$\{\{ inputs\.sha \}\}/);
  assert.match(rehearsalBuild, /signer generate --ci -p "" -w "\$KEY"/);
  assert.match(rehearsalBuild, /echo "::add-mask::\$VALUE"/);
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
