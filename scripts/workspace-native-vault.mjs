// Test-only dependency injection for an in-process Core host. No OS vault or process execution.
import assert from "node:assert/strict";

const SYNTHETIC_VALUES = new Set(["workspace-local-fake-key", "hara-synthetic-local-only"]);
export const PINNED_CORE = "4e507e7f1595e618527e5c95a1890ae9271615e7";

export function requirePackagedSyntheticCredentialAdapter() {
  // Core 1.0.2 exposes CredentialVault injection only to its host constructor, not its CLI.
  // Do not substitute HOME, a temporary OS Keychain, a plaintext file or a different Core.
  throw new Error("Native credential smoke disabled: packaged Core 1.0.2 has no synthetic credential adapter entry. Stop before fixture creation or app launch; use the offline injected adapter. No OS Keychain operations are allowed.");
}

export function createSyntheticTestVault() {
  const values = new Map();
  let closed = false;
  const active = () => assert.equal(closed, false, "Synthetic credential adapter is closed");
  const entry = (ref, value) => {
    active();
    assert.equal(typeof ref === "string" && /^[a-zA-Z0-9_.:-]{1,240}$/.test(ref), true, "Invalid synthetic credential reference");
    assert.equal(SYNTHETIC_VALUES.has(value), true, "Only the fixture's fixed synthetic credentials are accepted");
  };
  const adapter = Object.freeze({
    get(ref) { active(); return values.get(ref); },
    set(ref, value) { entry(ref, value); values.set(ref, value); },
    setMany(entries) {
      active();
      // Validate the complete batch before changing anything.
      for (const row of entries) entry(row.ref, row.key);
      for (const row of entries) values.set(row.ref, row.key);
    },
    remove(ref) { active(); values.delete(ref); },
  });
  const receipt = Object.freeze({ adapter: "synthetic-memory-v1", onlySyntheticCredentials: true,
    systemKeychainUsed: false, persistentCredentials: false, packagedCoreInjectionAvailable: false });
  return Object.freeze({ adapter, receipt, cleanup() {
    values.clear(); closed = true;
    return { adapter: receipt.adapter, syntheticCredentialsCleared: true, systemKeychainUsed: false };
  } });
}
