import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateChannelSmokeScope } from "../scripts/local-channel-smoke-scope.mjs";
const options = { skip: process.platform === "win32" ? "POSIX-only CLI fixture requires owned mode-0700 directories" : false };
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "hara-channel-scope-"))), core = join(root, "core"), evidence = join(root, "evidence"), sha = "a".repeat(40);
  fs.mkdirSync(core); fs.mkdirSync(evidence, { mode: 0o700 });
  return { root, core, evidence, sha, close() { fs.rmSync(root, { recursive: true, force: true }); } };
}
test("a pinned checkout and empty private temporary evidence work on any POSIX workstation", options, () => {
  const f = fixture(); try { assert.doesNotThrow(() => validateChannelSmokeScope(f.core, f.evidence, f.sha)); } finally { f.close(); }
});
test("non-temporary, shared or already-used evidence cannot become a data directory", options, () => {
  const f = fixture(); try {
    assert.throws(() => validateChannelSmokeScope(f.core, f.evidence, f.sha, f.core));
    fs.chmodSync(f.evidence, 0o755); assert.throws(() => validateChannelSmokeScope(f.core, f.evidence, f.sha)); fs.chmodSync(f.evidence, 0o700);
    fs.writeFileSync(join(f.evidence, "existing-record"), "synthetic"); assert.throws(() => validateChannelSmokeScope(f.core, f.evidence, f.sha));
  } finally { f.close(); }
});
test("linked or overlapping Core/evidence paths and missing source identities fail before imports", options, () => {
  const f = fixture(); try {
    const alias = join(f.root, "alias"); fs.symlinkSync(f.evidence, alias); assert.throws(() => validateChannelSmokeScope(f.core, alias, f.sha));
    assert.throws(() => validateChannelSmokeScope(f.evidence, f.evidence, f.sha));
    const nested = join(f.core, "nested"); fs.mkdirSync(nested, { mode: 0o700 }); assert.throws(() => validateChannelSmokeScope(f.core, nested, f.sha));
    for (const sha of [undefined, "main", "a".repeat(39)]) assert.throws(() => validateChannelSmokeScope(f.core, f.evidence, sha));
  } finally { f.close(); }
});
