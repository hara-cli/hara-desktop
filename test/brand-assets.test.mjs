import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalizeIcns } from "../scripts/canonicalize-icns.mjs";

function container(types) {
  const header = Buffer.alloc(8);
  header.write("icns");
  const entries = types.map(type => {
    const entry = Buffer.alloc(9);
    entry.write(type);
    entry.writeUInt32BE(9, 4);
    entry[8] = type.charCodeAt(3);
    return entry;
  });
  header.writeUInt32BE(8 + entries.length * 9, 4);
  return Buffer.concat([header, ...entries]);
}

test("ICNS normalization is deterministic and preserves every frame", () => {
  assert.deepEqual(canonicalizeIcns(container(["ic10", "ic07", "ic09"])), canonicalizeIcns(container(["ic09", "ic10", "ic07"])));
  const current = readFileSync(new URL("../src-tauri/icons/icon.icns", import.meta.url));
  assert.equal(canonicalizeIcns(current).length, current.length);
  const normalized = canonicalizeIcns(current);
  assert.deepEqual(canonicalizeIcns(normalized), normalized);
});

test("ICNS normalization rejects truncation, size mismatch, and duplicate frame types", () => {
  assert.throws(() => canonicalizeIcns(Buffer.alloc(7)));
  assert.throws(() => canonicalizeIcns(container(["ic10"]).subarray(0, 10)));
  assert.throws(() => canonicalizeIcns(container(["ic10", "ic10"])));
});
