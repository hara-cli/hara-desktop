// Tauri invokes `codesign` via PATH. Select the existing dedicated keychain explicitly;
// never repair the user's search list, default keychain, ACL or partition configuration.
import assert from "node:assert/strict";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const IDENTITY = "Developer ID Application: Wuxi Nanhara Technologies Co., Ltd. (4GMBSXJ67T)";
export function explicitKeychainArgs(args, keychain) {
  const signIndexes = args.flatMap((arg, index) => arg === "-s" || arg === "--sign" ? [index] : []);
  if (!signIndexes.length && !args.some(arg => arg.startsWith("--sign=") || /^-s.+/.test(arg))) return [...args];
  assert.equal(signIndexes.length, 1, "Dedicated signing requires one explicit signing identity");
  assert.equal(args[signIndexes[0] + 1], IDENTITY, "Unexpected signing identity; no ad-hoc fallback");
  // This is a macOS codesign target path, including when tested on another host.
  assert(typeof keychain === "string" && posix.isAbsolute(keychain) && posix.normalize(keychain) === keychain
    && !/[\r\n\0]/.test(keychain), "Dedicated keychain must be an absolute normalized path");
  assert(!args.some(arg => arg === "--keychain" || arg.startsWith("--keychain=")), "Conflicting keychain selection");
  return ["--keychain", keychain, ...args];
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = explicitKeychainArgs(process.argv.slice(2), process.env.HARA_CODESIGN_KEYCHAIN);
    const result = spawnSync("/usr/bin/codesign", args, { stdio: "inherit" });
    process.exitCode = result.status ?? 1;
  } catch { console.error("Dedicated codesign invocation rejected; no keychain settings were changed"); process.exitCode = 1; }
}
