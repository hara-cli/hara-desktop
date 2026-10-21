import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSyntheticTestVault, requirePackagedSyntheticCredentialAdapter } from "../scripts/workspace-native-vault.mjs";
import { finishOwnedFixtureCleanup } from "../scripts/workspace-native-cleanup.mjs";

test("synthetic credential adapter accepts only fixed fake values and clears without an OS vault", () => {
  const one = createSyntheticTestVault(), two = createSyntheticTestVault();
  one.adapter.set("scope:one", "workspace-local-fake-key");
  one.adapter.setMany([{ ref: "scope:two", key: "hara-synthetic-local-only" }]);
  assert.equal(one.adapter.get("scope:one"), "workspace-local-fake-key");
  assert.equal(two.adapter.get("scope:one"), undefined, "independent hosts have independent adapters");
  assert.throws(() => one.adapter.setMany([{ ref: "scope:new", key: "workspace-local-fake-key" }, { ref: "scope:bad", key: "not-a-fixture-value" }]), /fixed synthetic/);
  assert.equal(one.adapter.get("scope:new"), undefined, "invalid batches cannot partially write");
  one.adapter.remove("scope:two"); assert.equal(one.adapter.get("scope:two"), undefined);
  assert.equal(one.receipt.systemKeychainUsed, false); assert.equal(one.receipt.persistentCredentials, false);
  assert.equal(JSON.stringify(one.receipt).includes("workspace-local-fake-key"), false);
  assert.equal(one.cleanup().syntheticCredentialsCleared, true);
  assert.throws(() => one.adapter.get("scope:one"), /closed/); assert.throws(() => one.adapter.set("scope:x", "workspace-local-fake-key"), /closed/);
  assert.equal(one.cleanup().systemKeychainUsed, false, "cleanup is idempotent and never touches global lists"); two.cleanup();
});

test("packaged native fixture is disabled before filesystem, process or app work, including after signing release", () => {
  assert.throws(() => requirePackagedSyntheticCredentialAdapter(), /packaged Core 1\.0\.2 has no synthetic credential adapter/);
  const root = mkdtempSync(join(tmpdir(), "hara-native-gate-")), missing = join(root, "must-not-create");
  try {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/workspace-native-smoke.mjs", import.meta.url)), join(missing, "shell"), missing],
      { env: { PATH: "/usr/bin:/bin", HOME: root, HARA_NATIVE_SKIP_SCREENSHOTS: "1", HARA_SIGNING_LANE_RELEASED: "1" }, encoding: "utf8", timeout: 5000 });
    assert.equal(child.status, 1); assert.equal(child.stderr.includes("Native credential smoke disabled"), true);
    assert.equal(existsSync(missing), false); assert.deepEqual(readdirSync(root), []);
    const source = readFileSync(new URL("../scripts/workspace-native-vault.mjs", import.meta.url), "utf8");
    assert.equal(/child_process|\/usr\/bin\/security|create-keychain|delete-keychain|default-keychain|list-keychains/.test(source), false);
    const smoke = readFileSync(new URL("../scripts/workspace-native-smoke.mjs", import.meta.url), "utf8");
    assert.equal(/node:(?:fs|child_process|http)|\bspawn\(/.test(smoke), false, "disabled entry has no native driver or filesystem work");
    assert.equal(/createPrivateTestVault|private-test-vault|Keychains\/synthetic/.test(smoke), false);
  } finally { rmSync(root, { recursive: true }); }
});

test("cleanup records later owned resources and a failed overall status when an earlier cleanup throws", async () => {
  const called = [], receipts = new Map();
  await assert.rejects(finishOwnedFixtureCleanup([
    { name: "window-cleanup", run: () => { called.push("window"); throw new Error("private diagnostic not for logs"); } },
    { name: "mock-provider-cleanup", run: () => { called.push("mock"); return { mockProviderStopped: true }; } },
    { name: "synthetic-adapter-cleanup", run: () => { called.push("adapter"); return { syntheticCredentialsCleared: true }; } },
  ], (name, value) => receipts.set(name, value)), /cleanup incomplete/);
  assert.deepEqual(called, ["window", "mock", "adapter"]);
  assert.equal(receipts.get("window-cleanup.json").completed, false);
  assert.equal(receipts.get("mock-provider-cleanup.json").mockProviderStopped, true);
  assert.equal(receipts.get("synthetic-adapter-cleanup.json").syntheticCredentialsCleared, true);
  assert.equal(receipts.get("fixture-cleanup.json").completed, false);
  assert.equal(JSON.stringify([...receipts]).includes("private diagnostic"), false);
});

test("cleanup still runs every stage when receipt writing fails and completes only after all receipts succeed", async () => {
  const called = [];
  const steps = ["one", "two"].map(name => ({ name, run: () => { called.push(name); return {}; } }));
  await assert.rejects(finishOwnedFixtureCleanup(steps, name => { if (name === "one.json") throw new Error("write failed"); }), /cleanup incomplete/);
  assert.deepEqual(called, ["one", "two"]);
  const receipts = new Map(), summary = await finishOwnedFixtureCleanup(steps, (name, receipt) => receipts.set(name, receipt));
  assert.equal(summary.completed, true); assert.equal(receipts.get("fixture-cleanup.json").completed, true);
});
