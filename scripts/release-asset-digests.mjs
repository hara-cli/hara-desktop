#!/usr/bin/env node
// Metadata-only release merge (1.2.3). The hosted assembly job downloads and revalidates the exact
// hidden draft, then records every asset's name, size and SHA-256. The protected signer never
// re-downloads the large non-Mac assets: it binds them by requiring GitHub's server-side digest to
// equal this record, replaces only the signed Mac assets plus latest.json, and checks those against
// the exact local bytes it signed. The hosted public-edge job still downloads the complete release.
//
//   record <directory>                               print the compact JSON record for every regular file
//   check-draft <assets.json> <record> <replaced...>  before upload: every non-replaced asset is unchanged
//   check-final <assets.json> <record> <localdir> <replaced...>
//                                                     after upload: replaced assets equal local bytes
//   small <assets.json>                               print metadata reduced to the small files the signer needs
//   check-local <dir> <record> <replaced...>          every downloaded non-replaced file equals the record
//
// <record> is a file path, or "-env" to read HARA_DRAFT_ASSET_DIGESTS.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}$/u;
// Files the signer must read to rebuild and validate latest.json: updater signatures, the manifest
// itself and source provenance. Everything else is bound by digest only.
export const SMALL_ASSET = /^(?:.+\.sig|latest\.json|release-source-provenance\.json)$/u;
export const SMALL_ASSET_MAX_BYTES = 64 * 1024;

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function regularFile(path) {
  try {
    const info = lstatSync(path);
    return info.isFile() && !info.isSymbolicLink();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function recordDirectory(directory) {
  const root = resolve(directory);
  const entries = readdirSync(root, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
  if (entries.length === 0) throw new Error("release asset directory is empty");
  return entries.map((name) => {
    const path = join(root, name);
    if (!SAFE_NAME.test(name) || !regularFile(path)) throw new Error(`unexpected release asset entry: ${name}`);
    return { name, size: lstatSync(path).size, sha256: sha256File(path) };
  });
}

export function parseRecord(value) {
  const record = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(record) || record.length === 0) throw new Error("asset digest record must be a non-empty array");
  const names = new Set();
  for (const entry of record) {
    if (!SAFE_NAME.test(entry?.name ?? "") || names.has(entry.name)) {
      throw new Error(`asset digest record has an unsafe or duplicate name: ${JSON.stringify(entry?.name)}`);
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error(`asset digest record size is invalid: ${entry.name}`);
    if (!SHA256.test(entry.sha256 ?? "")) throw new Error(`asset digest record sha256 is invalid: ${entry.name}`);
    names.add(entry.name);
  }
  return new Map(record.map((entry) => [entry.name, entry]));
}

// GitHub `gh release view --json assets` metadata → Map(name → {size, sha256, state}).
export function parseRemote(metadata) {
  const assets = Array.isArray(metadata) ? metadata : metadata?.assets;
  if (!Array.isArray(assets) || assets.length === 0) throw new Error("release metadata must contain a non-empty assets array");
  const remote = new Map();
  for (const asset of assets) {
    const name = String(asset?.name ?? "");
    if (!SAFE_NAME.test(name) || remote.has(name)) throw new Error(`release metadata has an unsafe or duplicate asset: ${JSON.stringify(name)}`);
    const digest = /^sha256:([a-f0-9]{64})$/u.exec(String(asset?.digest ?? ""));
    if (!digest) throw new Error(`GitHub did not report a SHA-256 digest for ${name}`);
    if (!Number.isSafeInteger(asset?.size) || asset.size < 0) throw new Error(`release metadata size is invalid: ${name}`);
    if (asset?.state !== undefined && asset.state !== "uploaded") throw new Error(`release asset is not uploaded: ${name}`);
    remote.set(name, { size: asset.size, sha256: digest[1] });
  }
  return remote;
}

function requireSameNames(remote, record) {
  const missing = [...record.keys()].filter((name) => !remote.has(name)).sort();
  const extra = [...remote.keys()].filter((name) => !record.has(name)).sort();
  if (missing.length || extra.length) {
    throw new Error(`release asset set differs from the verified draft; missing=[${missing.join(", ")}], extra=[${extra.join(", ")}]`);
  }
}

function requireReplacedKnown(record, replaced) {
  if (replaced.length === 0) throw new Error("no replaced asset names given");
  for (const name of replaced) {
    if (!record.has(name)) throw new Error(`replaced asset ${name} is not part of the verified draft`);
  }
}

function requireUnchanged(remote, record, replaced) {
  for (const [name, expected] of record) {
    if (replaced.includes(name)) continue;
    const actual = remote.get(name);
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
      throw new Error(`GitHub digest for ${name} differs from the verified draft record (sha256:${actual.sha256} != sha256:${expected.sha256})`);
    }
  }
}

export function checkDraft(metadata, recordValue, replaced) {
  const record = parseRecord(recordValue);
  const remote = parseRemote(metadata);
  requireReplacedKnown(record, replaced);
  requireSameNames(remote, record);
  requireUnchanged(remote, record, replaced);
  return { unchanged: record.size - replaced.length, replaced: replaced.length };
}

export function checkFinal(metadata, recordValue, localDirectory, replaced) {
  const record = parseRecord(recordValue);
  const remote = parseRemote(metadata);
  requireReplacedKnown(record, replaced);
  requireSameNames(remote, record);
  requireUnchanged(remote, record, replaced);
  const root = resolve(localDirectory);
  for (const name of replaced) {
    const path = join(root, name);
    if (!regularFile(path)) throw new Error(`local signed asset is missing: ${name}`);
    const local = { size: lstatSync(path).size, sha256: sha256File(path) };
    const actual = remote.get(name);
    if (actual.size !== local.size || actual.sha256 !== local.sha256) {
      throw new Error(`GitHub digest for uploaded ${name} does not match the local signed bytes (sha256:${actual.sha256} != sha256:${local.sha256})`);
    }
  }
  return { unchanged: record.size - replaced.length, replaced: replaced.length };
}

// The small files are downloaded between the two metadata checks; bind their bytes to the record
// directly so nothing can be swapped in between.
export function checkLocal(directory, recordValue, replaced) {
  const record = parseRecord(recordValue);
  const root = resolve(directory);
  let checked = 0;
  for (const name of readdirSync(root).filter((entry) => !entry.startsWith(".")).sort()) {
    if (replaced.includes(name)) continue;
    const expected = record.get(name);
    if (!expected) throw new Error(`downloaded ${name} is not part of the verified draft`);
    const path = join(root, name);
    if (!regularFile(path) || lstatSync(path).size !== expected.size || sha256File(path) !== expected.sha256) {
      throw new Error(`downloaded ${name} differs from the verified draft record`);
    }
    checked += 1;
  }
  return checked;
}

export function smallAssets(metadata) {
  const assets = Array.isArray(metadata) ? metadata : metadata?.assets;
  if (!Array.isArray(assets)) throw new Error("release metadata must contain an assets array");
  const small = assets.filter((asset) => SMALL_ASSET.test(String(asset?.name ?? "")));
  for (const asset of small) {
    if (!Number.isSafeInteger(asset?.size) || asset.size > SMALL_ASSET_MAX_BYTES) {
      throw new Error(`small release asset ${asset?.name} is unexpectedly large: ${asset?.size}`);
    }
  }
  if (small.length === 0) throw new Error("release metadata has no signature/manifest assets");
  return { assets: small };
}

function readRecord(argument) {
  if (argument === "-env") {
    const value = process.env.HARA_DRAFT_ASSET_DIGESTS ?? "";
    if (!value) throw new Error("HARA_DRAFT_ASSET_DIGESTS is empty (the assembly job did not record the verified draft)");
    return value;
  }
  return readFileSync(resolve(argument), "utf8");
}

const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "record" && rest.length === 1) {
      process.stdout.write(`${JSON.stringify(recordDirectory(rest[0]))}\n`);
    } else if (command === "check-draft" && rest.length >= 3) {
      const [metadata, record, ...replaced] = rest;
      const result = checkDraft(readJson(metadata), readRecord(record), replaced);
      console.log(`release-asset-digests: ${result.unchanged} verified draft assets unchanged by GitHub digest; ${result.replaced} to replace`);
    } else if (command === "check-final" && rest.length >= 4) {
      const [metadata, record, local, ...replaced] = rest;
      const result = checkFinal(readJson(metadata), readRecord(record), local, replaced);
      console.log(`release-asset-digests: ${result.unchanged} unchanged + ${result.replaced} replaced assets match by GitHub digest`);
    } else if (command === "check-local" && rest.length >= 3) {
      const [directory, record, ...replaced] = rest;
      console.log(`release-asset-digests: ${checkLocal(directory, readRecord(record), replaced)} downloaded files equal the verified draft record`);
    } else if (command === "small" && rest.length === 1) {
      process.stdout.write(`${JSON.stringify(smallAssets(readJson(rest[0])))}\n`);
    } else {
      console.error("usage: node scripts/release-asset-digests.mjs record <dir> | check-draft <assets.json> <record|-env> <name...> | check-final <assets.json> <record|-env> <localdir> <name...> | small <assets.json>");
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(`release-asset-digests: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

