import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  assertInstalled, assertPrecheck, payloadFiles, stageCollectorInputs, transferIdentity, verifyArchive, verifyPayload,
} from "../scripts/windows-install-transfer.mjs";

const desktop = "a".repeat(40), core = "b".repeat(40), version = "1.3.0";
const env = {
  WINDOWS_DESKTOP_SHA: desktop, WINDOWS_CORE_SHA: core, GITHUB_SHA: desktop, GITHUB_REPOSITORY: "hara-cli/hara-desktop",
  GITHUB_RUN_ID: "37", GITHUB_RUN_ATTEMPT: "1",
};
const release = { ...env, WINDOWS_RELEASE_ONLY: "true", GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v1.3.0" };
const rehearsal = { ...env, WINDOWS_RELEASE_ONLY: "false", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main" };
const sha = value => createHash("sha256").update(value).digest("hex");
const binding = { schemaVersion: 1, protocolVersion: 2, coreCommit: core, target: "x86_64-pc-windows-msvc",
  expectedWorkerSHA256: sha("worker"), sidecarSHA256: sha("sidecar") };

function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), "windows-install-transfer-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function fixture(t, base, change = () => {}) {
  const root = sandbox(t);
  const identity = transferIdentity(base, desktop, core, version);
  const files = payloadFiles(identity).map(path => {
    const content = path.endsWith("/hara-x86_64-pc-windows-msvc.exe") ? "sidecar"
      : path === "windows-vault-binding.json" ? JSON.stringify(binding) : path;
    const location = join(root, path);
    mkdirSync(dirname(location), { recursive: true });
    writeFileSync(location, content);
    return { path, bytes: Buffer.byteLength(content), sha256: sha(content) };
  });
  const manifest = { schema: 1, identity, files };
  change(manifest);
  const raw = JSON.stringify(manifest);
  writeFileSync(join(root, "manifest.json"), raw);
  return { root, identity, files, digest: sha(raw) };
}

test("formal and rehearsal transfer bind exact source, Core, event, repo and attempt", () => {
  const identity = transferIdentity(release, desktop, core, version);
  assert.equal(identity.production, true);
  assert.equal(identity.attempt, "1");
  assert.equal(transferIdentity(rehearsal, desktop, core, version).production, false);
  for (const [name, value] of Object.entries({ GITHUB_SHA: "c".repeat(40), WINDOWS_CORE_SHA: "d".repeat(40), GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "other/repo", GITHUB_RUN_ATTEMPT: "" })) {
    assert.throws(() => transferIdentity({ ...release, [name]: value }, desktop, core, version), /identity_mismatch|event_mismatch/);
  }
});

test("both modes preserve canonical installers and their two signatures", async t => {
  const formal = fixture(t, release), preview = fixture(t, rehearsal);
  for (const item of [formal, preview]) {
    const data = await verifyPayload(item.root, item.identity, item.digest);
    assert.deepEqual(data.files.slice(0, 4).map(row => row.path), [
      "bundle/msi/Hara_1.3.0_x64_en-US.msi", "bundle/nsis/Hara_1.3.0_x64-setup.exe",
      "bundle/msi/Hara_1.3.0_x64_en-US.msi.sig", "bundle/nsis/Hara_1.3.0_x64-setup.exe.sig",
    ]);
    assert.deepEqual(data.binding, binding);
  }
  assert.ok(formal.files.some(row => row.path.startsWith("collector/")));
  assert.ok(!formal.files.some(row => row.path.startsWith("unbound/")));
  assert.ok(preview.files.some(row => row.path.startsWith("unbound/")));
  assert.ok(!preview.files.some(row => row.path.startsWith("collector/")));
});

test("a clean prepackage cannot accept payload from another attempt or the formal mode", async t => {
  const item = fixture(t, rehearsal);
  for (const change of [{attempt: "2"}, {run: "38"}, {core: "c".repeat(40)}]) {
    await assert.rejects(verifyPayload(item.root, { ...item.identity, ...change }, item.digest), /manifest_identity_mismatch/);
  }
  await assert.rejects(verifyPayload(item.root, { ...item.identity, production: true }, item.digest), /unsupported_entry/);
});

test("changed signature, changed manifest and extra data all fail before use", async t => {
  const {root, identity, digest, files} = fixture(t, release);
  await assert.rejects(verifyPayload(root, identity, "f".repeat(64)), /manifest_digest_mismatch/);
  writeFileSync(join(root, files[2].path), "wrong sig");
  await assert.rejects(verifyPayload(root, identity, digest), /payload_digest_mismatch/);
  writeFileSync(join(root, "extra-key.json"), "{}");
  await assert.rejects(verifyPayload(root, identity, digest), /unexpected_files/);
});

test("missing signature and a changed collector sidecar cannot pass", async t => {
  const incomplete = fixture(t, release);
  rmSync(join(incomplete.root, incomplete.files[3].path));
  await assert.rejects(verifyPayload(incomplete.root, incomplete.identity, incomplete.digest), /unexpected_files/);
  const altered = fixture(t, release, manifest => {
    const row = manifest.files.find(file => file.path.startsWith("collector/hara-"));
    row.sha256 = sha("altered");
    row.bytes = 7;
  });
  writeFileSync(join(altered.root, "collector/hara-x86_64-pc-windows-msvc.exe"), "altered");
  await assert.rejects(verifyPayload(altered.root, altered.identity, altered.digest), /collector_sidecar_mismatch/);
});

test("the downloaded archive digest is checked before extraction", async t => {
  const root = sandbox(t);
  const zip = join(root, "payload.zip");
  writeFileSync(zip, "bytes");
  assert.equal(await verifyArchive(root, sha("bytes")), zip);
  await assert.rejects(verifyArchive(root, "d".repeat(64)), /archive_digest_mismatch/);
  writeFileSync(join(root, "second.zip"), "bytes");
  await assert.rejects(verifyArchive(root, sha("bytes")), /unexpected_archive/);
});

test("collector stages the exact builder installers, signatures, Core and Herdr", async t => {
  const item = fixture(t, release);
  const checkout = sandbox(t);
  await stageCollectorInputs(item.root, checkout, item.identity, item.digest);
  for (const file of item.files.slice(0, 4)) {
    const output = join(checkout, "src-tauri", "target", item.identity.target, "release", file.path);
    assert.equal(sha(readFileSync(output)), file.sha256);
  }
  for (const file of item.files.filter(row => row.path.startsWith("collector/"))) {
    const output = join(checkout, "src-tauri", "binaries", file.path.slice("collector/".length));
    assert.equal(sha(readFileSync(output)), file.sha256);
  }
});

test("collector rejects a same-length Herdr byte change and a stale attempt before staging", async t => {
  const {root, identity, digest} = fixture(t, release);
  const checkout = sandbox(t);
  await assert.rejects(stageCollectorInputs(root, checkout, {...identity, attempt: "2"}, digest),
    /manifest_identity_mismatch/);
  const herdr = join(root, "collector", `herdr-${identity.target}.exe`);
  const bytes = readFileSync(herdr);
  bytes[0] ^= 1;
  writeFileSync(herdr, bytes);
  await assert.rejects(stageCollectorInputs(root, checkout, identity, digest), /payload_digest_mismatch/);
  assert.deepEqual(readdirSync(checkout), []);
});

function receipt(leg, payload) {
  return { schemaVersion: 1, desktopCommit: desktop, coreCommit: core, refusals: [],
    results: [{ kind: leg, installerSHA256: payload.files[leg === "msi" ? 0 : 1].sha256, workerSHA256: binding.expectedWorkerSHA256,
      expectedWorkerSHA256: binding.expectedWorkerSHA256, sidecarSHA256: binding.sidecarSHA256, keySaved: true, restartReadback: true,
      rotationReadback: true, addedRevision: 1, rotatedRevision: 3, loopbackCatalogRequests: 2, loopbackUnexpected: 0 }],
    installationChecks: [{ kind: leg, desktopPresent: true, corePresent: true, workerPresent: true,
      ...(leg === "msi" ? { registrationClearBefore: true, directory: "requested", installExitCode: 0, uninstallExitCode: 0,
        registrationClearAfter: true, legacyMsiClearAfter: true, reason: null, cleanupReason: null } : { uninstalled: true }) }],
  };
}

test("both installer receipts require cleanup and same installer, worker and sidecar bytes", async t => {
  const item = fixture(t, release);
  const payload = await verifyPayload(item.root, item.identity, item.digest);
  for (const leg of ["msi", "nsis"]) {
    const row = receipt(leg, payload);
    const precheck = { ...row, precheck: {kind: leg, registrationClear: true} };
    assertPrecheck(precheck, leg, item.identity);
    assert.throws(() => assertPrecheck({...precheck, precheck: {...precheck.precheck, registrationClear: false}}, leg, item.identity),
      /precheck_receipt_invalid/);
    assertInstalled(row, leg, item.identity, payload);
    const changed = structuredClone(row);
    changed.results[0].installerSHA256 = "e".repeat(64);
    assert.throws(() => assertInstalled(changed, leg, item.identity, payload), /install_result_mismatch/);
    const layout = row.installationChecks[0];
    layout[leg === "msi" ? "legacyMsiClearAfter" : "uninstalled"] = false;
    assert.throws(() => assertInstalled(row, leg, item.identity, payload), /uninstall_invalid/);
  }
});

test("release-only skips only the existing negative fixtures, rehearsal requires all three", async t => {
  const item = fixture(t, rehearsal);
  const payload = await verifyPayload(item.root, item.identity, item.digest);
  const row = receipt("nsis", payload);
  assert.throws(() => assertInstalled(row, "nsis", item.identity, payload), /refusal_receipt_invalid/);
  row.refusals = ["helper_invalid", "windows_desktop_required", "helper_missing"].map(reason => ({
    reason, code: reason === "windows_desktop_required" ? "unsupported" : "unavailable", configured: false, writes: 0,
  }));
  assertInstalled(row, "nsis", item.identity, payload);
  row.refusals[2].writes = 1;
  assert.throws(() => assertInstalled(row, "nsis", item.identity, payload), /refusal_receipt_invalid/);
});
