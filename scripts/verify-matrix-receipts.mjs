#!/usr/bin/env node
// Bind the single-writer draft assembly to the exact bytes cryptographically verified on each
// native matrix runner. Successful receipts are consumed so they can never become release assets.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireGitCommit, requireStableVersion } from "./release-policy.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const sidecarVersion = readFileSync(join(root, "src-tauri", "binaries", "SIDECAR_VERSION"), "utf8").trim();
const sidecarCommit = requireGitCommit(
  readFileSync(join(root, "src-tauri", "binaries", "SIDECAR_COMMIT"), "utf8").trim(),
  "locked sidecar commit",
);
const nodeVersion = readFileSync(join(root, ".node-version"), "utf8").trim();
const bunVersion = readFileSync(join(root, ".bun-version"), "utf8").trim();
const rustVersion = readFileSync(join(root, ".rust-version"), "utf8").trim();
const directory = resolve(process.argv[2] || "");
const desktopCommitArgument = process.argv[3];
const cliCommitArgument = process.argv[4];
if (!process.argv[2] || !desktopCommitArgument || !cliCommitArgument) {
  console.error(
    "usage: node scripts/verify-matrix-receipts.mjs <merged-asset-directory> <desktop-commit> <cli-commit>",
  );
  process.exit(2);
}
const desktopCommit = requireGitCommit(desktopCommitArgument, "Desktop commit");
const cliCommit = requireGitCommit(cliCommitArgument, "CLI commit");
if (cliCommit !== sidecarCommit) {
  throw new Error(`CLI commit does not match SIDECAR_COMMIT: ${cliCommit} != ${sidecarCommit}`);
}
requireStableVersion(version, "Desktop version");
requireStableVersion(sidecarVersion, "sidecar version");
requireStableVersion(nodeVersion, "Node version");
requireStableVersion(bunVersion, "Bun version");
requireStableVersion(rustVersion, "Rust version");

const targets = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "x86_64-unknown-linux-gnu",
  "x86_64-pc-windows-msvc",
];
const receiptNames = targets.map((target) => `matrix-receipt-${target}.json`);
const actualReceipts = readdirSync(directory).filter((name) => name.startsWith("matrix-receipt-")).sort();
if (JSON.stringify(actualReceipts) !== JSON.stringify([...receiptNames].sort())) {
  throw new Error(`matrix receipt set mismatch: ${actualReceipts.join(", ") || "<none>"}`);
}

const claimedFiles = new Set();
for (const target of targets) {
  const receiptPath = join(directory, `matrix-receipt-${target}.json`);
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (
    receipt.schema !== 3 ||
    receipt.desktopVersion !== version ||
    receipt.desktopCommit !== desktopCommit ||
    receipt.sidecarVersion !== sidecarVersion ||
    receipt.cliCommit !== cliCommit ||
    receipt.nodeVersion !== nodeVersion ||
    receipt.bunVersion !== bunVersion ||
    receipt.rustVersion !== rustVersion ||
    receipt.target !== target ||
    receipt.updaterSignaturesVerified !== true ||
    !receipt.files ||
    typeof receipt.files !== "object" ||
    Array.isArray(receipt.files)
  ) {
    throw new Error(`invalid matrix verification receipt: ${receiptPath}`);
  }
  for (const [name, expectedHash] of Object.entries(receipt.files)) {
    if (name !== basename(name) || !/^[0-9a-f]{64}$/.test(expectedHash)) {
      throw new Error(`invalid matrix receipt file claim: ${name}`);
    }
    if (claimedFiles.has(name)) throw new Error(`release asset was claimed by multiple matrix receipts: ${name}`);
    claimedFiles.add(name);
    const path = join(directory, name);
    if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
      throw new Error(`matrix-verified release asset missing or empty: ${name}`);
    }
    const actualHash = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (actualHash !== expectedHash) throw new Error(`matrix-verified release asset hash mismatch: ${name}`);
  }
  rmSync(receiptPath);
  console.log(`  ✓ verified and consumed ${target} matrix receipt`);
}

const remainingFiles = readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name);
for (const name of remainingFiles) {
  if (!claimedFiles.has(name)) throw new Error(`unclaimed file remained after matrix receipt verification: ${name}`);
}
console.log(`matrix receipts verified ${claimedFiles.size} exact release assets`);
