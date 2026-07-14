#!/usr/bin/env node
// Copy a target's verified Tauri outputs into one flat, canonical release-asset directory.
// Keeping this separate from GitHub Release upload lets every native matrix job finish its
// package smoke before a single aggregation job creates latest.json and touches the draft.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireGitCommit, requireStableVersion } from "./release-policy.mjs";
import { verifyUpdaterArtifactSignature } from "./updater-signature.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const sidecarVersion = readFileSync(join(root, "src-tauri", "binaries", "SIDECAR_VERSION"), "utf8").trim();
const sidecarCommit = requireGitCommit(
  readFileSync(join(root, "src-tauri", "binaries", "SIDECAR_COMMIT"), "utf8").trim(),
  "locked sidecar commit",
);
const nodeVersion = readFileSync(join(root, ".node-version"), "utf8").trim();
const bunVersion = readFileSync(join(root, ".bun-version"), "utf8").trim();
const rustVersion = readFileSync(join(root, ".rust-version"), "utf8").trim();
const COMMAND_TIMEOUT_MS = 30_000;
const [, , target, outputArgument, desktopCommitArgument, cliCommitArgument] = process.argv;

if (!target || !outputArgument || !desktopCommitArgument || !cliCommitArgument) {
  console.error(
    "usage: node scripts/collect-release-assets.mjs <tauri-target> <output-directory> <desktop-commit> <cli-commit>",
  );
  process.exit(2);
}

const releaseBase = join(root, "src-tauri", "target", target, "release");
const output = resolve(outputArgument);
const version = manifest.version;
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
const checkedOutCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  timeout: COMMAND_TIMEOUT_MS,
}).trim().toLowerCase();
if (checkedOutCommit !== desktopCommit) {
  throw new Error(`Desktop checkout mismatch: expected ${desktopCommit}, got ${checkedOutCommit}`);
}
const worktreeStatus = execFileSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
  timeout: COMMAND_TIMEOUT_MS,
}).trim();
if (worktreeStatus) {
  throw new Error(`Desktop worktree changed during the matrix build:\n${worktreeStatus}`);
}
if (process.versions.node !== nodeVersion) {
  throw new Error(`Node version mismatch: expected ${nodeVersion}, got ${process.versions.node}`);
}
const activeRustVersion = execFileSync("rustc", ["--version"], {
  encoding: "utf8",
  timeout: COMMAND_TIMEOUT_MS,
}).trim().split(/\s+/)[1];
if (activeRustVersion !== rustVersion) {
  throw new Error(`Rust version mismatch: expected ${rustVersion}, got ${activeRustVersion || "unknown"}`);
}

const targetAssets = {
  "aarch64-apple-darwin": [
    [`bundle/dmg/Hara_${version}_aarch64.dmg`, `Hara_${version}_aarch64.dmg`],
    ["bundle/macos/Hara.app.tar.gz", "Hara_aarch64.app.tar.gz"],
    ["bundle/macos/Hara.app.tar.gz.sig", "Hara_aarch64.app.tar.gz.sig"],
  ],
  "x86_64-apple-darwin": [
    [`bundle/dmg/Hara_${version}_x64.dmg`, `Hara_${version}_x64.dmg`],
    ["bundle/macos/Hara.app.tar.gz", "Hara_x64.app.tar.gz"],
    ["bundle/macos/Hara.app.tar.gz.sig", "Hara_x64.app.tar.gz.sig"],
  ],
  "x86_64-unknown-linux-gnu": [
    [`bundle/deb/Hara_${version}_amd64.deb`, `Hara_${version}_amd64.deb`],
    [`bundle/deb/Hara_${version}_amd64.deb.sig`, `Hara_${version}_amd64.deb.sig`],
    [`bundle/rpm/Hara-${version}-1.x86_64.rpm`, `Hara-${version}-1.x86_64.rpm`],
    [`bundle/rpm/Hara-${version}-1.x86_64.rpm.sig`, `Hara-${version}-1.x86_64.rpm.sig`],
  ],
  "x86_64-pc-windows-msvc": [
    [`bundle/msi/Hara_${version}_x64_en-US.msi`, `Hara_${version}_x64_en-US.msi`],
    [`bundle/msi/Hara_${version}_x64_en-US.msi.sig`, `Hara_${version}_x64_en-US.msi.sig`],
    [`bundle/nsis/Hara_${version}_x64-setup.exe`, `Hara_${version}_x64-setup.exe`],
    [`bundle/nsis/Hara_${version}_x64-setup.exe.sig`, `Hara_${version}_x64-setup.exe.sig`],
  ],
};

const assets = targetAssets[target];
if (!assets) {
  console.error(`unsupported release target: ${target}`);
  process.exit(1);
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const [relativeSource, releaseName] of assets) {
  const source = join(releaseBase, relativeSource);
  if (!existsSync(source) || !statSync(source).isFile() || statSync(source).size === 0) {
    throw new Error(`verified release output is missing or empty: ${source}`);
  }
  if (source.endsWith(".sig") && readFileSync(source, "utf8").trim().length <= 50) {
    throw new Error(`updater signature is suspiciously short: ${source}`);
  }
  copyFileSync(source, join(output, releaseName));
  console.log(`  ✓ ${basename(source)} -> ${releaseName}`);
}

const releaseNames = assets.map(([, releaseName]) => releaseName);
for (const artifact of releaseNames.filter((name) => !name.endsWith(".sig") && !name.endsWith(".dmg"))) {
  const signature = `${artifact}.sig`;
  if (!releaseNames.includes(signature)) throw new Error(`collected updater signature missing for ${artifact}`);
  verifyUpdaterArtifactSignature(join(output, artifact), join(output, signature), `collected ${artifact}`);
  console.log(`  ✓ cryptographically verified collected ${artifact}`);
}

const files = Object.fromEntries(
  releaseNames
    .sort()
    .map((name) => [name, createHash("sha256").update(readFileSync(join(output, name))).digest("hex")]),
);
const receiptName = `matrix-receipt-${target}.json`;
writeFileSync(
  join(output, receiptName),
  `${JSON.stringify(
    {
      schema: 3,
      desktopVersion: version,
      desktopCommit,
      sidecarVersion,
      cliCommit,
      nodeVersion,
      bunVersion,
      rustVersion,
      target,
      updaterSignaturesVerified: true,
      files,
    },
    null,
    2,
  )}\n`,
);
console.log(`  ✓ wrote ${receiptName}`);

console.log(`collected ${assets.length} verified ${target} release assets`);
