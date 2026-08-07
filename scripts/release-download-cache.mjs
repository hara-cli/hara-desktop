#!/usr/bin/env node

// Retain only release assets whose completed bytes match GitHub's authoritative size and SHA-256.
// This lets a bounded `gh release download --skip-existing` retry keep verified large files without
// ever trusting a partial response or an unexpected pathname from an earlier attempt.
import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function requireAssets(metadata) {
  const assets = Array.isArray(metadata) ? metadata : metadata?.assets;
  if (!Array.isArray(assets) || assets.length === 0) {
    throw new Error("release asset metadata must contain a non-empty assets array");
  }
  const expected = new Map();
  for (const asset of assets) {
    const name = String(asset?.name ?? "");
    const digest = String(asset?.digest ?? "");
    if (!name || basename(name) !== name || name === "." || name === "..") {
      throw new Error(`release asset name is unsafe: ${JSON.stringify(name)}`);
    }
    if (expected.has(name)) throw new Error(`duplicate release asset metadata: ${name}`);
    if (!Number.isSafeInteger(asset?.size) || asset.size < 0) {
      throw new Error(`release asset size is invalid: ${name}`);
    }
    if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
      throw new Error(`release asset SHA-256 is missing or invalid: ${name}`);
    }
    expected.set(name, { size: asset.size, sha256: digest.slice("sha256:".length) });
  }
  return expected;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function reconcileReleaseDownloadCache(directory, metadata, { complete = false } = {}) {
  const root = resolve(directory);
  const rootInfo = lstatSync(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("release download cache must be a real directory");
  }
  const expected = requireAssets(metadata);
  const retained = new Set();

  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const wanted = expected.get(entry);
    const info = lstatSync(path);
    if (
      !wanted ||
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      statSync(path).size !== wanted.size ||
      sha256File(path) !== wanted.sha256
    ) {
      rmSync(path, { recursive: true, force: true });
      continue;
    }
    retained.add(entry);
  }

  if (complete) {
    const missing = [...expected.keys()].filter((name) => !retained.has(name));
    if (missing.length > 0) {
      throw new Error(`release download cache is incomplete: ${missing.join(", ")}`);
    }
  }
  return { expected: expected.size, retained: retained.size };
}

function main() {
  const [, , metadataPath, directory, flag] = process.argv;
  if (!metadataPath || !directory || (flag && flag !== "--complete")) {
    console.error("usage: node scripts/release-download-cache.mjs <assets.json> <directory> [--complete]");
    process.exitCode = 2;
    return;
  }
  const metadata = JSON.parse(readFileSync(resolve(metadataPath), "utf8"));
  const result = reconcileReleaseDownloadCache(directory, metadata, { complete: flag === "--complete" });
  console.log(`release-download-cache: retained ${result.retained}/${result.expected} verified asset(s)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(`release-download-cache: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
