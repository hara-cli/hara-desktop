// Test-only OS vault in a fresh private HOME. Never use or enumerate credential items in login.
import assert from "node:assert/strict";
import fs from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
const SYSTEM_HOME = "/Users/zhujianbo";
export function createPrivateTestVault(home, execute = spawnSync) {
  assert(home === resolve(home) && /^\/private\/tmp\/hara-redesign-native-20261020\/native-(arm64|intel)(-[0-9]+)?\/app-home$/.test(home));
  assert(fs.statSync(home).isDirectory() && !fs.lstatSync(home).isSymbolicLink());
  const path = join(home, "Library/Keychains/synthetic.keychain-db");
  const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, USERPROFILE: home, TMPDIR: "/private/tmp" };
  const call = (args, scoped = true, absent = false) => {
    const result = execute("/usr/bin/security", args, { env: scoped ? env : { ...env, HOME: SYSTEM_HOME, USERPROFILE: SYSTEM_HOME }, encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
    if (absent) { assert.notEqual(result.status, 0, "private Home must have no existing default Keychain"); return ""; }
    assert.equal(result.status, 0, "private test Keychain operation failed; stop, never use login fallback"); return String(result.stdout ?? "");
  };
  const metadata = () => ({ default: call(["default-keychain", "-d", "user"], false), search: call(["list-keychains", "-d", "user"], false) });
  const before = metadata(); call(["default-keychain", "-d", "user"], true, true);
  assert(!fs.existsSync(path)); fs.mkdirSync(join(home, "Library/Keychains"), { recursive: true, mode: 0o700 });
  // security may report success setting the default but cannot persist/read it without this directory.
  fs.mkdirSync(join(home, "Library/Preferences"), { recursive: true, mode: 0o700 });
  // Random throwaway password stays in process memory only; no user/signing/updater secret is used.
  const password = randomBytes(24).toString("hex");
  call(["create-keychain", "-p", password, path]);
  call(["set-keychain-settings", "-lut", "600", path]); call(["unlock-keychain", "-p", password, path]);
  call(["default-keychain", "-d", "user", "-s", path]); call(["list-keychains", "-d", "user", "-s", path]);
  assert.equal(call(["default-keychain", "-d", "user"]).trim().replaceAll('"', ""), path);
  const entries = [...call(["list-keychains", "-d", "user"]).matchAll(/"([^"\n]+)"/g)].map(row => row[1]); assert.deepEqual(entries, [path]);
  assert.deepEqual(metadata(), before, "STOP real user Keychain metadata changed");
  const receipt = { path, privateHome: home, onlySyntheticCredentials: true, realUserDefaultAndSearchUnchanged: true };
  return { receipt, cleanup() {
    call(["lock-keychain", path]); call(["default-keychain", "-d", "user", "-s"]); call(["list-keychains", "-d", "user", "-s"]); call(["delete-keychain", path]);
    assert(!fs.existsSync(path)); assert.deepEqual(metadata(), before, "STOP real user Keychain metadata changed");
    return { onlyOwnedSyntheticVaultDeleted: true, realUserDefaultAndSearchUnchanged: true };
  } };

}
