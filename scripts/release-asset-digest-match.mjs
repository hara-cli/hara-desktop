#!/usr/bin/env node

// Reconcile an uncertain release upload response against GitHub's authoritative asset digest.
// A successful upload can become visible in release metadata before the upload client receives its
// response, so promotion must compare exact bytes instead of treating a later name conflict as proof
// of failure.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function releaseAssetMatches(sourcePath, metadata) {
  const source = resolve(sourcePath);
  const sourceInfo = lstatSync(source);
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
    throw new Error("local release asset must be a regular file");
  }

  const assets = Array.isArray(metadata) ? metadata : metadata?.assets;
  if (!Array.isArray(assets)) throw new Error("release asset metadata must contain an assets array");
  const assetName = basename(source);
  const matches = assets.filter((asset) => asset?.name === assetName);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one remote release asset named ${assetName}, found ${matches.length}`);
  }

  const remote = matches[0];
  if (!Number.isSafeInteger(remote?.size) || remote.size < 0) {
    throw new Error(`remote release asset size is invalid: ${assetName}`);
  }
  const digest = String(remote?.digest ?? "");
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new Error(`remote release asset SHA-256 is missing or invalid: ${assetName}`);
  }
  if (sourceInfo.size !== remote.size) return false;
  const localDigest = createHash("sha256").update(readFileSync(source)).digest("hex");
  return digest === `sha256:${localDigest}`;
}

function main() {
  const [, , metadataPath, sourcePath] = process.argv;
  if (!metadataPath || !sourcePath) {
    console.error("usage: node scripts/release-asset-digest-match.mjs <assets.json> <asset>");
    process.exitCode = 2;
    return;
  }
  const metadata = JSON.parse(readFileSync(resolve(metadataPath), "utf8"));
  if (!releaseAssetMatches(sourcePath, metadata)) {
    console.error(`release-asset-digest: remote bytes do not match ${basename(sourcePath)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`release-asset-digest: remote bytes match ${basename(sourcePath)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(`release-asset-digest: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
