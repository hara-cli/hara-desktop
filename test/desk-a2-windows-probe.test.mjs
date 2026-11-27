import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { coreCommit, desktopCommit, identity, pack, requireInstalled, requirePrecheck, sanitizedMetrics,
  verifyArchive, verifyPayload } from "../scripts/desk-a2-windows-probe.mjs";

const ref = "refs/heads/probe/desk-130-windows-split-20261128";
const env = {
  GITHUB_REPOSITORY: "hara-cli/hara-desktop", GITHUB_EVENT_NAME: "push", GITHUB_REF: ref,
  GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "12345", GITHUB_SHA: "b".repeat(40), GITHUB_WORKFLOW_SHA: "b".repeat(40),
  GITHUB_WORKFLOW_REF: "hara-cli/hara-desktop/.github/workflows/desk-a2-windows-split-probe.yml@" + ref,
};
const binding = { schemaVersion: 1, protocolVersion: 2, coreCommit, target: "x86_64-pc-windows-msvc",
  expectedWorkerSHA256: "c".repeat(64), sidecarSHA256: "d".repeat(64) };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), "desk-a2-probe-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function staged(t, update = () => {}) {
  const root = scratch(t);
  const payload = {
    "bundle/msi/hara.msi": "test MSI",
    "bundle/nsis/hara-setup.exe": "test NSIS",
    "unbound/hara-credential-worker.exe": "different worker fixture",
    "windows-vault-binding.json": JSON.stringify(binding),
  };
  const files = Object.entries(payload).map(([path, bytes]) => {
    const realPath = join(root, path);
    mkdirSync(dirname(realPath), { recursive: true });
    writeFileSync(realPath, bytes);
    return { path, bytes: Buffer.byteLength(bytes), sha256: digest(bytes) };
  });
  const manifest = { schemaVersion: 1, ...identity(env), binding: { ...binding }, files,
    toolchain: { node: "22.23.1", bun: "1.3.9", rust: "1.97.0", workerRust: "1.92.0" } };
  update(manifest);
  const raw = JSON.stringify(manifest);
  writeFileSync(join(root, "manifest.json"), raw);
  return { root, manifest, consumer: { ...env, A2_MANIFEST_SHA256: digest(raw) } };
}

test("rejects another repo, event, branch, workflow commit or attempt", () => {
  assert.equal(identity(env).attempt, 1);
  for (const [key, value] of Object.entries({ GITHUB_REPOSITORY: "another/repo", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main", GITHUB_WORKFLOW_SHA: "a".repeat(40), GITHUB_RUN_ATTEMPT: "2" })) {
    assert.throws(() => identity({ ...env, [key]: value }), /probe_identity_mismatch/);
  }
});

test("two legs can verify one byte-identical allowlisted payload and D/Core identities", async t => {
  const { root, manifest, consumer } = staged(t);
  assert.deepEqual(await verifyPayload(root, { ...consumer, GITHUB_JOB: "install_msi" }), manifest);
  assert.deepEqual(await verifyPayload(root, { ...consumer, GITHUB_JOB: "install_nsis" }), manifest);
});

test("producer admits just the two installers and bound evidence, and blocks an alternate with matching bytes", async t => {
  const root = scratch(t);
  const target = binding.target;
  const release = join(root, "src-tauri", "target", target, "release", "bundle");
  const bin = join(root, "src-tauri", "binaries");
  const alternate = join(root, "hara-vault-unbound-worker", "hara-credential-worker.exe");
  const originalWorker = "bound worker";
  const sidecar = "Core bytes";
  const stagedBinding = { ...binding, expectedWorkerSHA256: digest(originalWorker), sidecarSHA256: digest(sidecar) };
  const fixture = {
    [join(release, "msi", "D.msi")]: "MSI",
    [join(release, "nsis", "D-setup.exe")]: "NSIS",
    [join(bin, `hara-${target}.exe`)]: sidecar,
    [join(bin, `hara-credential-worker-${target}.exe`)]: originalWorker,
    [join(bin, "windows-vault-binding.json")]: JSON.stringify(stagedBinding),
    [alternate]: originalWorker,
    [join(root, "throwaway.key")]: "private from job",
  };
  for (const [path, bytes] of Object.entries(fixture)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
  const output = join(root, "github-output");
  const builder = { ...env, GITHUB_JOB: "build_windows", RUNNER_TEMP: root, GITHUB_OUTPUT: output,
    A2_BUN_VERSION: "1.3.9", A2_RUST_VERSION: "rustc 1.97.0 (test)", A2_WORKER_RUST_VERSION: "rustc 1.92.0 (test)" };
  const payload = join(root, "upload");
  await assert.rejects(pack(payload, root, builder), /build_worker_binding_mismatch/);
  assert.equal(existsSync(output), false);
  assert.equal(existsSync(payload), false);
  writeFileSync(alternate, "unbound worker");
  await pack(payload, root, builder);
  const [, sha] = /^manifest_sha256=([0-9a-f]{64})\n$/u.exec(readFileSync(output, "utf8"));
  const proof = await verifyPayload(payload, { ...env, A2_MANIFEST_SHA256: sha });
  assert.equal(proof.files.length, 4);
  assert.equal(proof.binding.sidecarSHA256, digest(sidecar));
  assert.equal(existsSync(join(payload, "throwaway.key")), false);
});

test("rejects digest drift, even for a manifest whose alternate digest was supplied", async t => {
  const { root, consumer } = staged(t, manifest => { manifest.attempt = 2; });
  await assert.rejects(verifyPayload(root, { ...consumer, A2_MANIFEST_SHA256: "a".repeat(64) }), /artifact_manifest_digest_mismatch/);
  await assert.rejects(verifyPayload(root, consumer), /artifact_manifest_identity_mismatch/);
});

test("rejects toolchain drift even with a recomputed manifest digest", async t => {
  const { root, consumer } = staged(t, manifest => { manifest.toolchain.node = "22.23.5"; });
  await assert.rejects(verifyPayload(root, consumer), /artifact_toolchain_mismatch/);
});

test("rejects a changed installer and an out-of-scope payload entry", async t => {
  const { root, consumer } = staged(t);
  writeFileSync(join(root, "bundle/msi/hara.msi"), "other MS");
  await assert.rejects(verifyPayload(root, consumer), /artifact_file_digest_mismatch/);
  writeFileSync(join(root, "discovery.json"), "{}");
  await assert.rejects(verifyPayload(root, consumer), /unexpected_artifact_set/);
});

test("rejects a binding that disagrees with the payload's worker binding", async t => {
  const { root, consumer } = staged(t, manifest => { manifest.binding.expectedWorkerSHA256 = "a".repeat(64); });
  await assert.rejects(verifyPayload(root, consumer), /artifact_worker_binding_mismatch/);
});

test("requires the downloaded ZIP digest prior to extraction and exactly one download", async t => {
  const root = scratch(t);
  const file = join(root, "windows-installers.zip");
  writeFileSync(file, "compressed fixture bytes");
  assert.equal(await verifyArchive(root, digest("compressed fixture bytes")), file);
  await assert.rejects(verifyArchive(root, "e".repeat(64)), /artifact_archive_digest_mismatch/);
  writeFileSync(join(root, "duplicate.zip"), "other download");
  await assert.rejects(verifyArchive(root, digest("compressed fixture bytes")), /unexpected_download_set/);
});

test("metrics accept only byte counts and leave unknowns as null", () => {
  const fields = sanitizedMetrics({ status: 0, stdout: '{"freePhysicalBytes":99,"commitBytes":"99","workspaceDriveFreeBytes":0,"home":"private"}' });
  assert.equal(fields.freePhysicalBytes, 99);
  assert.equal(fields.commitBytes, null);
  assert.equal(fields.workspaceDriveFreeBytes, 0);
  assert.equal(fields.commitLimitBytes, null);
  assert.equal(fields.home, undefined);
  assert.ok(Object.values(sanitizedMetrics({ status: 1, stdout: "{}" })).every(value => value === null));
  assert.ok(Object.values(sanitizedMetrics({ status: 0, stdout: "invalid JSON" })).every(value => value === null));
});

test("missing or crossed preflight receipts cannot release installation", () => {
  const receipt = { schemaVersion: 1, desktopCommit, coreCommit, precheck: { kind: "msi", registrationClear: true } };
  requirePrecheck(receipt, "msi");
  assert.throws(() => requirePrecheck(receipt, "nsis"), /installer_precheck_receipt_invalid/);
  assert.throws(() => requirePrecheck({ ...receipt, precheck: undefined }, "msi"), /installer_precheck_receipt_invalid/);
});

function installFixture(kind, manifest) {
  const row = { kind, installerSHA256: manifest.files[kind === "msi" ? 0 : 1].sha256,
    workerSHA256: binding.expectedWorkerSHA256, expectedWorkerSHA256: binding.expectedWorkerSHA256, sidecarSHA256: binding.sidecarSHA256,
    keySaved: true, restartReadback: true, rotationReadback: true, addedRevision: 2, rotatedRevision: 3,
    loopbackCatalogRequests: 2, loopbackUnexpected: 0 };
  const layout = { kind, desktopPresent: true, corePresent: true, workerPresent: true };
  if (kind === "msi") {
    Object.assign(layout, { registrationClearBefore: true, directory: "requested", installExitCode: 0, uninstallExitCode: 0,
      registrationClearAfter: true, legacyMsiClearAfter: true, reason: null, cleanupReason: null });
  } else {
    layout.uninstalled = true;
  }
  const reasons = kind === "nsis" ? ["helper_invalid", "windows_desktop_required", "helper_missing"] : [];
  const refusals = reasons.map(reason => ({ reason, code: reason === "windows_desktop_required" ? "unsupported" : "unavailable",
    configured: false, writes: 0 }));
  return { schemaVersion: 1, desktopCommit, coreCommit, results: [row], installationChecks: [layout], refusals };
}

test("installer and sidecar digests, MSI dual-view cleanup and NSIS refuse/cleanup proof are required", t => {
  const { manifest } = staged(t);
  const msi = installFixture("msi", manifest), nsis = installFixture("nsis", manifest);
  requireInstalled(msi, "msi", manifest);
  requireInstalled(nsis, "nsis", manifest);
  const changes = [
    [msi, "msi", "results", "sidecarSHA256", "e".repeat(64), /install_result_mismatch/],
    [msi, "msi", "installationChecks", "legacyMsiClearAfter", null, /msi_uninstall_receipt_invalid/],
    [nsis, "nsis", "refusals", "code", "unsupported", /installer_refusal_receipt_invalid/],
    [nsis, "nsis", "installationChecks", "uninstalled", undefined, /nsis_uninstall_receipt_invalid/],
  ];
  for (const [receipt, leg, array, field, value, message] of changes) {
    const invalid = structuredClone(receipt);
    invalid[array][0][field] = value;
    assert.throws(() => requireInstalled(invalid, leg, manifest), message);
  }
});
