import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { basename, join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repo = "hara-cli/hara-desktop";
const ref = "refs/heads/probe/desk-130-cold-collector-20261128-r2";
const purpose = "cold-collector-rehearsal";
const target = "x86_64-pc-windows-msvc";
const version = "1.3.0";
const configPath = "src-tauri/tauri.conf.json";
const fixtureEnv = {
  GIT_AUTHOR_NAME: "Cold collector fixture", GIT_AUTHOR_EMAIL: "cold-collector@users.noreply.github.com",
  GIT_COMMITTER_NAME: "Cold collector fixture", GIT_COMMITTER_EMAIL: "cold-collector@users.noreply.github.com",
  GIT_AUTHOR_DATE: "2026-11-28T00:00:00Z", GIT_COMMITTER_DATE: "2026-11-28T00:00:00Z",
};
const headPattern = /^[0-9a-f]{40}$/u;
const shaPattern = /^[0-9a-f]{64}$/u;
const idPattern = /^[1-9][0-9]*$/u;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const fileSHA = path => digest(readFileSync(path));
const json = file => JSON.parse(readFileSync(file, "utf8"));
const putJson = (file, value) => writeFileSync(file, JSON.stringify(value) + "\n", { flag: "wx" });
const git = (cwd, args, settings = {}) => execFileSync("git", ["-C", cwd, ...args], {
  encoding: "utf8", timeout: 30_000, ...settings,
}).trim();
const assertClean = (cwd, expected) => {
  assert.equal(git(cwd, ["rev-parse", "HEAD"]), expected);
  assert.equal(git(cwd, ["status", "--porcelain", "--untracked-files=all"]), "");
};

export function assertCreation(env, event) {
  assert.equal(env.GITHUB_REPOSITORY, repo);
  assert.equal(env.GITHUB_EVENT_NAME, "push");
  assert.equal(env.GITHUB_REF, ref);
  assert.equal(env.GITHUB_RUN_ATTEMPT, "1");
  assert.match(env.GITHUB_RUN_ID, idPattern);
  assert.match(env.GITHUB_SHA, headPattern);
  assert.equal(event.before, "0".repeat(40));
  assert.equal(event.after, env.GITHUB_SHA);
  assert.equal(event.ref, ref);
  assert.equal(event.created, true);
  assert.equal(event.deleted, false);
  assert.equal(event.forced, false);
}

function keyId(wrapped) {
  assert.match(wrapped, /^[A-Za-z0-9+/]+={0,2}$/u);
  assert.ok(wrapped.length <= 512);
  const text = Buffer.from(wrapped, "base64").toString("utf8");
  const packet = Buffer.from(text.split(/\r?\n/u).find(line => line && !line.startsWith("untrusted comment:")) ?? "", "base64");
  assert.equal(packet.length, 42);
  assert.equal(packet.subarray(0, 2).toString("ascii"), "Ed");
  return packet.subarray(2, 10).toString("hex");
}

export function createFixture(source, desktop, publicKey, working, index) {
  assertClean(source, desktop);
  const publicKeyId = keyId(publicKey);
  const original = JSON.parse(git(source, ["show", `${desktop}:${configPath}`]));
  assert.notEqual(publicKeyId, keyId(original.plugins.updater.pubkey));
  const changed = structuredClone(original);
  changed.plugins.updater.pubkey = publicKey;
  const raw = JSON.stringify(changed, null, 2) + "\n";
  assert.ok(!existsSync(index) && !existsSync(working));
  const settings = { env: { ...process.env, ...fixtureEnv, GIT_INDEX_FILE: index } };
  git(source, ["read-tree", desktop], settings);
  const blob = git(source, ["hash-object", "-w", "--stdin"], { ...settings, input: raw });
  const mode = git(source, ["ls-tree", desktop, "--", configPath]).split(" ")[0];
  assert.equal(mode, "100644");
  git(source, ["update-index", "--cacheinfo", mode, blob, configPath], settings);
  const tree = git(source, ["write-tree"], settings);
  const fixture = git(source, ["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", desktop, "-m", "Cold Windows collector one-use public key"], settings);
  assert.equal(git(source, ["diff-tree", "--no-commit-id", "--name-only", "-r", fixture]), configPath);
  assert.equal(git(source, ["show", "-s", "--format=%P", fixture]), desktop);
  git(source, ["worktree", "add", "--detach", "--quiet", working, fixture]);
  assertClean(working, fixture);
  assertClean(source, desktop);
  return { fixture, tree, publicKey, publicKeyId, publicKeySHA256: digest(publicKey) };
}

function assertProof(proof, expected) {
  assert.deepEqual(Object.keys(proof).sort(), [
    "attempt", "core", "desktop", "desktopTree", "fixture", "probe", "publicKey",
    "publicKeyId", "publicKeySHA256", "purpose", "repository", "run", "schema", "tree",
  ].sort());
  for (const [name, value] of Object.entries(expected)) assert.equal(proof[name], value);
  assert.match(proof.fixture, headPattern);
  assert.match(proof.tree, headPattern);
  assert.equal(proof.publicKeyId, keyId(proof.publicKey));
  assert.equal(proof.publicKeySHA256, digest(proof.publicKey));
}

function extract(zip, destination, paths) {
  const allow = paths.map(path => `'${path}'`).join(",");
  const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$allowed = @(${allow})
$seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$zip = [IO.Compression.ZipFile]::OpenRead($env:COLD_ZIP)
try {
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName.Replace('\', '/')
    if (!$seen.Add($name)) { throw 'duplicate_archive_entry' }
    if ($entry.Length -eq 0 -and $name.EndsWith('/')) {
      if (!($allowed | Where-Object { $_.StartsWith($name, [StringComparison]::Ordinal) })) { throw 'unexpected_folder' }
    } elseif (!($allowed -ccontains $name) -or $entry.Length -le 0) { throw 'unexpected_archive_entry' }
  }
  foreach ($name in $allowed) {
    if (!$seen.Contains($name)) { throw 'missing_archive_entry' }
  }
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName.Replace('\', '/')
    if ($allowed -ccontains $name) {
      $output = Join-Path $env:COLD_EXTRACT $name
      [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($output))
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $output, $false)
    }
  }
} finally { $zip.Dispose() }
`;
  mkdirSync(destination);
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    env: { ...process.env, COLD_ZIP: zip, COLD_EXTRACT: destination },
    stdio: "pipe", timeout: 120_000, windowsHide: true,
  });
}

function run(command, args, cwd, env, timeout) {
  return spawnSync(command, args, { cwd, env, timeout, windowsHide: true, encoding: "utf8", maxBuffer: 2 ** 20 });
}

function requireSuccess(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
}

function requireRejectedProcess(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1);
}

function signatureMismatchLine(artifact) {
  // The locked Rust verifier formats the error from minisign-verify 0.2.5's finalize().
  return "Error: " + JSON.stringify(`${artifact} failed updater signature verification: The signature verification failed`);
}

export function requireVerifierMismatch(result, artifactName) {
  requireRejectedProcess(result);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.replace(/\r?\n$/u, ""), signatureMismatchLine(artifactName));
}

export function requireCollectorMismatch(result, artifact) {
  requireRejectedProcess(result);
  const detail = signatureMismatchLine(artifact).replaceAll(/\s+/gu, " ");
  assert.ok(result.stderr.includes(`collected ${basename(artifact)} cryptographic signature verification failed: ${detail}`));
}

async function main() {
  assert.equal(process.platform, "win32");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  assertCreation(process.env, json(process.env.GITHUB_EVENT_PATH));
  const [mode, deskArgument] = process.argv.slice(2);
  const source = resolve(deskArgument);
  const probe = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { DESKTOP_SHA: desktop, DESKTOP_TREE: desktopTree, CORE_SHA: core, CORE_TREE: coreTree,
    GITHUB_RUN_ID: buildRun, GITHUB_RUN_ATTEMPT: attempt, GITHUB_SHA: probeHead, GITHUB_OUTPUT: output,
    RUNNER_TEMP: temp } = process.env;
  assert.ok([desktop, desktopTree, core, coreTree].every(value => typeof value === "string" && headPattern.test(value)));
  assertClean(probe, probeHead);
  assert.equal(git(probe, ["rev-list", "--parents", "-n", "1", "HEAD"]), `${probeHead} ${desktop}`);
  assertClean(source, desktop);
  assert.equal(git(source, ["rev-parse", "HEAD^{tree}"]), desktopTree);
  assert.equal(readFileSync(join(source, "src-tauri", "binaries", "SIDECAR_COMMIT"), "utf8").trim(), core);
  assert.equal(json(join(source, "package.json")).version, version);
  assert.deepEqual(json(join(source, "candidate-inputs.json")).core, { commit: core, tree: coreTree, version });

  const expectedProof = { schema: 1, purpose, repository: repo, run: buildRun, attempt, probe: probeHead, desktop, desktopTree, core };
  const { payloadFiles, verifyArchive, verifyPayload, stageCollectorInputs } =
    await import(pathToFileURL(join(source, "scripts", "windows-install-transfer.mjs")));
  const identityFor = fixture => ({ desktop: fixture, core, version, run: buildRun, attempt, target, production: true });
  const working = join(temp, "cold-collector-fixture");
  const proofFile = join(temp, "cold-collector-proof.json");
  const release = join("src-tauri", "target", target, "release");

  if (mode === "fixture") {
    const publicKey = readFileSync(join(temp, "cold-collector-key.pub"), "utf8").trim();
    const fixtureInfo = createFixture(source, desktop, publicKey, working, join(temp, "cold-index"));
    putJson(proofFile, { ...expectedProof, ...fixtureInfo });
    console.log("cold_collector_fixture_ready");
    return;
  }

  if (mode === "pack") {
    const proof = json(proofFile);
    assertProof(proof, expectedProof);
    assertClean(working, proof.fixture);
    const transfer = join(temp, "cold-collector-transfer");
    const payload = join(transfer, "payload");
    mkdirSync(transfer);
    mkdirSync(payload);
    copyFileSync(proofFile, join(transfer, "proof.json"));
    const identity = identityFor(proof.fixture);
    const files = payloadFiles(identity).map(path => {
      const input = path.startsWith("bundle/") ? join(working, release, path)
        : join(working, "src-tauri", "binaries", path.replace(/^collector\//u, ""));
      const record = lstatSync(input);
      assert.ok(record.isFile() && record.nlink === 1 && record.size > 0);
      const destination = join(payload, path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(input, destination);
      return { path, bytes: record.size, sha256: fileSHA(destination) };
    });
    const manifest = join(payload, "manifest.json");
    putJson(manifest, { schema: 1, identity, files });
    const manifestSHA256 = fileSHA(manifest);
    await verifyPayload(payload, identity, manifestSHA256);
    appendFileSync(output, `manifest_sha256=${manifestSHA256}\nproof_sha256=${fileSHA(proofFile)}\n`);
    console.log("cold_collector_transfer_ready");
    return;
  }

  assert.equal(mode, "collect");
  const { COLD_ARTIFACT_ID: artifactId, COLD_ARCHIVE_SHA256: archiveSHA256, COLD_MANIFEST_SHA256: manifestSHA256,
    COLD_PROOF_SHA256: proofSHA256 } = process.env;
  assert.match(artifactId, idPattern);
  assert.match(manifestSHA256, shaPattern);
  assert.match(proofSHA256, shaPattern);
  const zip = await verifyArchive(join(temp, "cold-collector-download"), archiveSHA256);
  const staging = join(temp, "cold-collector-extracted");
  extract(zip, staging, ["proof.json", "payload/manifest.json", ...payloadFiles(identityFor(desktop)).map(path => "payload/" + path)]);
  const receivedProof = join(staging, "proof.json");
  assert.equal(fileSHA(receivedProof), proofSHA256);
  const proof = json(receivedProof);
  assertProof(proof, expectedProof);
  const identity = identityFor(proof.fixture);
  const env = { ...process.env, CARGO_TARGET_DIR: join(temp, "cold-cargo-target") };
  assert.ok(!existsSync(env.CARGO_TARGET_DIR));
  for (const key of Object.keys(env)) assert.doesNotMatch(key, /^TAURI_SIGNING_PRIVATE_KEY/iu);

  function newFixture(label, path) {
    const recreated = createFixture(source, desktop, proof.publicKey, path, join(temp, "cold-index-" + label));
    assert.equal(recreated.fixture, proof.fixture);
    assert.equal(recreated.tree, proof.tree);
  }

  const payload = join(staging, "payload");
  newFixture("clean", working);
  const staged = await stageCollectorInputs(payload, working, identity, manifestSHA256);
  assertClean(working, proof.fixture);
  const compile = run("cargo", ["build", "--quiet", "--locked", "--manifest-path", "src-tauri/Cargo.toml", "--example", "verify_updater_signature"], working, env, 25 * 60_000);
  requireSuccess(compile);
  console.log("cold_collector_verifier_built");
  const receiptName = `matrix-receipt-${target}.json`;
  const collected = join(temp, "cold-collected");
  const collect = (cwd, dest) => run(process.execPath, ["scripts/collect-release-assets.mjs", target, dest, proof.fixture, core], cwd, env, 15 * 60_000);
  requireSuccess(collect(working, collected));
  assertClean(working, proof.fixture);
  const foundFiles = Object.fromEntries(staged.files.slice(0, 4).map(({ path, sha256 }) => [path.split("/").at(-1), sha256]));
  for (const [name, digest] of Object.entries(foundFiles)) assert.equal(fileSHA(join(collected, name)), digest);
  assert.deepEqual(readdirSync(collected).sort(), [...Object.keys(foundFiles), receiptName].sort());
  const receiptPath = join(collected, receiptName);
  const receipt = json(receiptPath);
  assert.equal(receipt.schema, 3);
  assert.equal(receipt.desktopCommit, proof.fixture);
  assert.equal(receipt.cliCommit, core);
  assert.equal(receipt.target, target);
  assert.equal(receipt.desktopVersion, version);
  assert.equal(receipt.sidecarVersion, version);
  assert.equal(receipt.nodeVersion, "22.23.1");
  assert.equal(receipt.bunVersion, "1.3.9");
  assert.equal(receipt.rustVersion, "1.97.0");
  assert.equal(receipt.updaterSignaturesVerified, true);
  assert.deepEqual(receipt.files, foundFiles);

  const msi = staged.files[0].path;
  const verifier = join(env.CARGO_TARGET_DIR, "debug", "examples", "verify_updater_signature.exe");
  let changedBytesVerifierExit;
  for (const label of ["wrong_key", "mutated_installer"]) {
    const cwd = join(temp, "cold-fixture-" + label);
    const dest = join(temp, "cold-rejected-" + label);
    newFixture(label, cwd);
    await stageCollectorInputs(payload, cwd, identity, manifestSHA256);
    const installer = join(cwd, release, msi);
    if (label === "wrong_key") {
      const canary = join(temp, "cold-signature-canary");
      const signature = canary + ".sig";
      copyFileSync(installer, canary);
      const signer = join(source, "node_modules", "@tauri-apps", "cli", "tauri.js");
      const otherKey = join(temp, "cold-negative-key");
      assert.ok(!existsSync(otherKey));
      let otherPublic;
      try {
        requireSuccess(run(process.execPath, [signer, "signer", "generate", "--ci", "-p", "", "-w", otherKey], source, env, 30_000));
        otherPublic = readFileSync(otherKey + ".pub", "utf8").trim();
        assert.notEqual(keyId(otherPublic), proof.publicKeyId);
        requireSuccess(run(process.execPath, [signer, "signer", "sign", "--private-key-path", otherKey, "-p", "", canary], source, env, 30_000));
      } finally {
        rmSync(otherKey, { force: true });
      }
      requireSuccess(run(verifier, [canary, signature, otherPublic], cwd, env, 120_000));
      copyFileSync(signature, installer + ".sig");
    } else {
      const name = basename(installer);
      const verifyInstaller = () => run(verifier, [name, name + ".sig", proof.publicKey], dirname(installer), env, 120_000);
      requireSuccess(verifyInstaller());
      const bytes = readFileSync(installer);
      bytes[bytes.length - 1] ^= 1;
      writeFileSync(installer, bytes);
      const result = verifyInstaller();
      requireVerifierMismatch(result, name);
      changedBytesVerifierExit = result.status;
    }
    assertClean(cwd, proof.fixture);
    const rejected = collect(cwd, dest);
    if (label === "wrong_key") {
      requireRejectedProcess(rejected);
      assert.match(rejected.stderr, /key id [a-f0-9]{16} does not match configured updater public key [a-f0-9]{16}/u);
    } else {
      requireCollectorMismatch(rejected, join(dest, basename(installer)));
    }
    assert.ok(!existsSync(join(dest, receiptName)));
    assertClean(cwd, proof.fixture);
    console.log(`cold_collector_rejected_${label}`);
  }

  const evidence = join(temp, "cold-collector-evidence");
  mkdirSync(evidence);
  const originalReceiptSHA256 = fileSHA(receiptPath);
  copyFileSync(receiptPath, join(evidence, receiptName));
  putJson(join(evidence, "cold-collector-readback.json"), {
    ...proof, artifactId, archiveSHA256, manifestSHA256, proofSHA256, originalReceiptSHA256,
    cleanBeforeAndAfter: true, coldVerifierBuilt: true, wrongKeyRejected: true, changedBytesRejected: true,
    changedBytesVerifierExit, changedBytesReason: "signature_mismatch",
  });
  console.log("cold_collector_valid");
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await main().catch(() => {
    console.error("cold_collector_probe_failed");
    process.exitCode = 1;
  });
}
