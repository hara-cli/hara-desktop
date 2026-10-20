import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { explicitKeychainArgs } from "../scripts/codesign-explicit-keychain.mjs";
const identity = "Developer ID Application: Wuxi Nanhara Technologies Co., Ltd. (4GMBSXJ67T)";
const keychain = "/private/fixture/signing.keychain-db";
test("Tauri codesign gets an explicit existing keychain without global configuration", () => {
  const args = ["--force", "-s", identity, "--options", "runtime", "--entitlements", "fixture.plist", "fixture.app"];
  assert.deepEqual(explicitKeychainArgs(args, keychain), ["--keychain", keychain, ...args]);
  assert.deepEqual(args.slice(0, 3), ["--force", "-s", identity]);
  assert.deepEqual(explicitKeychainArgs(["--sign", identity, "fixture.dmg"], keychain), ["--keychain", keychain, "--sign", identity, "fixture.dmg"]);
});
test("verify and detail operations do not require or access a keychain", () => {
  for (const args of [["--verify", "--deep", "--strict", "fixture.app"], ["-d", "--verbose=4", "fixture.app"]]) assert.deepEqual(explicitKeychainArgs(args), args);
});
test("dedicated codesign refuses ambiguous identities, keychains and ad-hoc fallback", () => {
  for (const args of [["--sign", "-", "fixture"], ["--sign=other", "fixture"], ["-sother", "fixture"], ["-s", identity, "--sign", identity, "fixture"], ["-s", identity, "--keychain", "other", "fixture"]]) assert.throws(() => explicitKeychainArgs(args, keychain));
  for (const path of [undefined, "relative", "/private/../signing", "/private/signing\n"]) assert.throws(() => explicitKeychainArgs(["-s", identity, "fixture"], path));
});
test("formal signer no longer mutates global keychain configuration", () => {
  const source = readFileSync(new URL("../scripts/build-mac-signed.sh", import.meta.url), "utf8");
  assert.doesNotMatch(source, /security (?:list-keychains|default-keychain|set-keychain-settings|set-key-partition-list|create-keychain|delete-keychain)\b/);
  assert.match(source, /PATH="\$PWD\/scripts\/codesign-bin:\$PATH" HARA_CODESIGN_KEYCHAIN="\$CODESIGN_KEYCHAIN"/);
  const shim = readFileSync(new URL("../scripts/codesign-bin/codesign", import.meta.url), "utf8");
  assert.match(shim, /exec node .*codesign-explicit-keychain\.mjs/);
});
