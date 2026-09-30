import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Tauri's ICNS encoder emits equivalent frames in hash-map order. Sort container entries
// without touching pixel data so regenerating the same brand assets is byte-for-byte stable.
export function canonicalizeIcns(input) {
  if (input.length < 8 || input.toString("ascii", 0, 4) !== "icns" || input.readUInt32BE(4) !== input.length) {
    throw new Error("Invalid ICNS container");
  }
  const entries = [];
  const seen = new Set();
  for (let offset = 8; offset < input.length;) {
    if (offset + 8 > input.length) throw new Error("Truncated ICNS entry");
    const length = input.readUInt32BE(offset + 4);
    const type = input.toString("ascii", offset, offset + 4);
    if (length < 8 || offset + length > input.length || seen.has(type)) throw new Error("Invalid ICNS entry");
    seen.add(type);
    entries.push(input.subarray(offset, offset + length));
    offset += length;
  }
  entries.sort((a, b) => Buffer.compare(a.subarray(0, 4), b.subarray(0, 4)));
  return Buffer.concat([input.subarray(0, 8), ...entries]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error("Usage: canonicalize-icns.mjs <generated icon.icns>");
  writeFileSync(process.argv[2], canonicalizeIcns(readFileSync(process.argv[2])));
}
