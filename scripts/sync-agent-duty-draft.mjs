#!/usr/bin/env node
// Offline mechanical C6 -> browser adapter. Only the two declared import adaptations are permitted.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lf = text => text.replace(/\r\n/g, "\n");
export const sha256 = text => createHash("sha256").update(lf(text)).digest("hex");
export const ALLOWED_TRANSFORMS = Object.freeze({
  "c0Import": {
    "from": "from \"./agent-boundaries-contract.js\";",
    "to": "from \"./agent-boundaries-v1.ts\";"
  },
  "deepFreezeImport": "import { deepFreeze } from \"./local-state.js\";\n",
  "deepFreezeInline": "exact pinned function with leading export removed; no other source edits"
});
const read = path => lf(readFileSync(resolve(root, path), "utf8"));
export function readInputs() {
  return { source: read("test/fixtures/agent-duty-draft-upstream.txt"), freeze: read("test/fixtures/agent-duty-draft-freeze-upstream.txt"),
    c0: read("src/contracts/agent-boundaries-v1.ts"), fixtures: read("test/fixtures/agent-duty-draft-v1.json"),
    lock: JSON.parse(read("docs/contracts/agent-duty-draft-v1.lock.json")) };
}
function once(text, from, to) {
  assert.equal(text.split(from).length, 2, "each import adaptation must occur exactly once");
  return text.replace(from, to);
}
export function renderMirror({ source, freeze, c0, fixtures, lock }) {
  assert.equal(lock.contract, "hara.agent-duty-draft.v1");
  assert.equal(lock.canonicalRepository, "hara-cli/hara");
  assert.match(lock.canonicalCommit, /^[0-9a-f]{40}$/);
  assert.equal(lock.canonicalSource, "src/workspace/agent-duty-draft.ts");
  assert.equal(lock.canonicalFreezeSource, "src/workspace/local-state.ts");
  assert.equal(lock.runtimeEnabled, false);
  assert.deepEqual(lock.allowedTransforms, ALLOWED_TRANSFORMS, "no extra transform is allowed");
  for (const [text, key] of [[source, "sourceSha256"], [freeze, "freezeFunctionSha256"], [c0, "c0SourceSha256"], [fixtures, "fixturesSha256"]])
    assert.equal(sha256(text), lock[key], `${key} differs from the frozen upstream inputs`);
  assert.ok(freeze.startsWith("export function deepFreeze<T>(value: T): Readonly<T> {\n"), "expected pinned pure function");
  let result = once(lf(source), ALLOWED_TRANSFORMS.c0Import.from, ALLOWED_TRANSFORMS.c0Import.to);
  result = once(result, ALLOWED_TRANSFORMS.deepFreezeImport, lf(freeze).replace(/^export /, ""));
  assert.equal(sha256(result), lock.mirrorSha256, "mirror lock must match the exact allowed transform");
  return result;
}
export function assertMirror(mirror, inputs = readInputs()) {
  assert.equal(lf(mirror), renderMirror(inputs), "browser mirror differs outside the two allowed import adaptations");
  return true;
}
export function checkCoreRepository(directory, inputs = readInputs()) {
  const upstream = name => lf(execFileSync("git", ["-C", resolve(directory), "show", `${inputs.lock.canonicalCommit}:${name}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  assert.equal(upstream(inputs.lock.canonicalSource), inputs.source, "canonical Core source differs");
  const localState = upstream(inputs.lock.canonicalFreezeSource);
  assert.equal(sha256(localState), inputs.lock.canonicalFreezeFileSha256, "canonical freeze file differs");
  assert.ok(localState.includes(inputs.freeze), "inline deepFreeze is not the pinned Core function");
  assert.equal(upstream("src/workspace/agent-boundaries-contract.ts"), inputs.c0, "C0 canonical source differs");
  return true;
}
function main(argv) {
  const write = argv.includes("--write"), check = argv.includes("--check"), index = argv.indexOf("--core-repository");
  assert(write !== check, "use exactly one of --check or --write");
  const allowed = new Set(["--write", "--check", "--core-repository"]);
  for (let i = 0; i < argv.length; i++) {
    assert(allowed.has(argv[i]), "unknown option");
    if (argv[i] === "--core-repository") { assert(argv[i + 1] && !argv[i + 1].startsWith("--"), "Core repository required"); i++; }
  }
  const inputs = readInputs(), result = renderMirror(inputs);
  if (index >= 0) checkCoreRepository(argv[index + 1], inputs);
  const target = resolve(root, "src/contracts/agent-duty-draft-v1.ts");
  if (write) writeFileSync(target, result); else assertMirror(readFileSync(target, "utf8"), inputs);
  console.log(JSON.stringify({ contract: inputs.lock.contract, mode: write ? "write" : "check", canonicalCommit: inputs.lock.canonicalCommit,
    mirrorSha256: sha256(result), coreChecked: index >= 0, runtimeEnabled: false }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2));
