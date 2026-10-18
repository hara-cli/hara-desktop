import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
export function assertPiOnlyConfiguration(config) {
  assert.deepEqual(config.bundle.externalBin, ["binaries/hara", "binaries/herdr"], "Only Core/Pi and the non-Agent browser helper may be preinstalled");
}
export function assertNoOptionalRuntimeFiles(root) {
  const queue = [root]; let visited = 0;
  while (queue.length) {
    const directory = queue.pop();
    for (const name of readdirSync(directory)) {
      if (++visited > 100000) throw new Error("Packaged runtime inventory exceeded bound");
      if (/^(?:hara-code-runtime|opencode|codex|claude)(?:\.exe)?$/i.test(name) || name === "claude-agent-sdk" || /^opencode-(?:darwin|linux|windows)-/.test(name)) throw new Error("Package unexpectedly preinstalls an optional Agent runtime");
      const path = join(directory, name), info = lstatSync(path);
      if (info.isDirectory() && !info.isSymbolicLink()) queue.push(path);
    }
  }
}
export function assertPiRuntimeManifest(raw) {
  const value = JSON.parse(raw); assert.equal(value.schemaVersion, 1); assert.deepEqual(value.preinstalled, ["pi"]);
  assert.equal(value.piSdkVersion, "1.1.0"); assert.deepEqual(value.optional, ["opencode", "codex", "claude"]);
}
if (process.argv[1] && basename(process.argv[1]) === "check-runtime-distribution.mjs") {
  const root = fileURLToPath(new URL("..", import.meta.url));
  assertPiOnlyConfiguration(JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8")));
  if (process.argv[2]) { assert.ok(existsSync(process.argv[2])); assertNoOptionalRuntimeFiles(process.argv[2]); }
  console.log("Pi-only external runtime configuration verified; final package absence/runtime-manifest smoke remains required");
}
