import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { binarySHA, readWindowsVaultBinding, verifiedWindowsVaultManifest,
  verifyWindowsVaultSidecar, windowsVaultRequired } from "../scripts/windows-vault-bundle.mjs";

const target = "x86_64-pc-windows-msvc";
const worker = "hara-credential-worker.exe";
const commit = "a".repeat(40);
const writeJSON = (file, value) => writeFileSync(file, JSON.stringify(value));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "hara-win-vault-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("Windows credential bundle is required by either the Desk or pinned Core version", t => {
  const root = fixture(t), pins = join(root, "src-tauri", "binaries"), version = join(pins, "SIDECAR_VERSION");
  mkdirSync(pins, { recursive: true });
  for (const [desk, core, required] of [
    ["1.2.3", "1.2.3", false], ["1.2.3", "1.3.0", true], ["1.3.0", "1.2.3", true],
    ["1.3.1", "1.3.1", true], ["1.10.0", "1.9.0", true], ["2.0.0", "1.2.3", true],
  ]) {
    writeJSON(join(root, "package.json"), { version: desk });
    writeFileSync(version, core + "\n");
    assert.equal(windowsVaultRequired(root), required);
  }
  writeFileSync(version, "unknown");
  assert.throws(() => windowsVaultRequired(root), /release version/);
});

test("Windows worker manifest requires the exact worker, target and protocol v2", t => {
  const root = fixture(t), manifest = join(root, "manifest.json"), binary = join(root, worker);
  assert.throws(() => verifiedWindowsVaultManifest(root), { code: "ENOENT" });
  writeFileSync(binary, "fixture worker");
  const sha256 = binarySHA(binary);
  for (const [protocolVersion, name] of [[1, target], [2, "aarch64-pc-windows-msvc"]]) {
    writeJSON(manifest, { protocolVersion, target: name, sha256 });
    assert.throws(() => verifiedWindowsVaultManifest(root), /v2 for Windows x64 MSVC/);
  }
  writeJSON(manifest, { protocolVersion: 2, target, sha256 });
  assert.equal(verifiedWindowsVaultManifest(root), sha256);
  writeFileSync(binary, "different worker");
  assert.throws(() => verifiedWindowsVaultManifest(root), /SHA-256 mismatch/);
});

test("an extracted Windows package must carry the bound sidecar and adjacent worker bytes", t => {
  const root = fixture(t), release = join(root, "installer"), pins = join(root, "src-tauri", "binaries");
  mkdirSync(release);
  mkdirSync(pins, { recursive: true });
  const sidecar = join(release, "hara.exe"), executable = join(release, worker);
  writeFileSync(sidecar, "worker-bound hara");
  writeFileSync(join(root, worker), "worker bytes");
  const expectedWorkerSHA256 = binarySHA(join(root, worker));
  const value = { schemaVersion: 1, target, protocolVersion: 2, coreCommit: commit,
    expectedWorkerSHA256, sidecarSHA256: binarySHA(sidecar) };
  const binding = join(pins, "windows-vault-binding.json");
  writeJSON(binding, value);
  writeFileSync(join(pins, "SIDECAR_COMMIT"), "b".repeat(40) + "\n");
  assert.throws(() => readWindowsVaultBinding(root), /pinned Core/);
  writeFileSync(join(pins, "SIDECAR_COMMIT"), commit + "\n");
  const receipt = readWindowsVaultBinding(root);
  assert.throws(() => verifyWindowsVaultSidecar(sidecar, receipt), { code: "ENOENT" });
  writeFileSync(executable, "unbound worker");
  assert.throws(() => verifyWindowsVaultSidecar(sidecar, receipt), /worker SHA-256 mismatch/);
  writeFileSync(executable, "worker bytes");
  assert.doesNotThrow(() => verifyWindowsVaultSidecar(sidecar, receipt));
  writeFileSync(sidecar, "unbound hara");
  assert.throws(() => verifyWindowsVaultSidecar(sidecar, receipt), /sidecar differs/);
});

test("Windows Tauri overlay retains both required sidecars and includes the credential worker", () => {
  const read = file => JSON.parse(readFileSync(new URL(`../src-tauri/${file}`, import.meta.url), "utf8"));
  assert.deepEqual(read("tauri.windows-vault.conf.json").bundle.externalBin,
    [...read("tauri.conf.json").bundle.externalBin, "binaries/hara-credential-worker"]);
});
