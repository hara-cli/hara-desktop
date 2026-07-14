#!/usr/bin/env node
// Persist the exact source/toolchain identity shared by all native matrix artifacts. The signed
// promotion flow validates this public release asset before replacing Mac bytes, preventing a
// mutable or re-pointed tag from mixing Windows/Linux and Mac sidecars from different commits.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { requireGitCommit, requireStableTag, requireStableVersion } from "./release-policy.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { version: desktopVersion } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const sidecarVersion = readFileSync(join(root, "src-tauri", "binaries", "SIDECAR_VERSION"), "utf8").trim();
const sidecarCommit = requireGitCommit(
  readFileSync(join(root, "src-tauri", "binaries", "SIDECAR_COMMIT"), "utf8").trim(),
  "locked sidecar commit",
);
const nodeVersion = readFileSync(join(root, ".node-version"), "utf8").trim();
const bunVersion = readFileSync(join(root, ".bun-version"), "utf8").trim();
const rustVersion = readFileSync(join(root, ".rust-version"), "utf8").trim();
const targets = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "x86_64-unknown-linux-gnu",
  "x86_64-pc-windows-msvc",
];

export function expectedReleaseSource({ tag, desktopCommit, cliCommit }) {
  requireStableTag(tag, desktopVersion);
  requireStableVersion(sidecarVersion, "sidecar version");
  requireStableVersion(nodeVersion, "Node version");
  requireStableVersion(bunVersion, "Bun version");
  requireStableVersion(rustVersion, "Rust version");
  const pinnedCliCommit = requireGitCommit(cliCommit, "CLI commit");
  if (pinnedCliCommit !== sidecarCommit) {
    throw new Error(`CLI commit does not match SIDECAR_COMMIT: ${pinnedCliCommit} != ${sidecarCommit}`);
  }
  return {
    schema: 2,
    desktopVersion,
    desktopTag: tag,
    desktopCommit: requireGitCommit(desktopCommit, "Desktop commit"),
    sidecarVersion,
    cliTag: `v${sidecarVersion}`,
    cliCommit: pinnedCliCommit,
    nodeVersion,
    bunVersion,
    rustVersion,
    targets,
  };
}

export function assertReleaseSource(actual, expected, label = "release source provenance") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} does not match the pinned Desktop/CLI source and toolchain`);
  }
  return actual;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
const [, , command, pathArgument, tag, desktopCommit, cliCommit] = process.argv;
if (invoked && !["build", "validate"].includes(command)) {
  console.error("usage:");
  console.error("  node scripts/release-source-provenance.mjs build <path> <tag> <desktop-commit> <cli-commit>");
  console.error("  node scripts/release-source-provenance.mjs validate <path> <tag> <desktop-commit> <cli-commit>");
  process.exit(2);
}

if (invoked) {
  if (!pathArgument || !tag || !desktopCommit || !cliCommit) {
    console.error("release-source-provenance: all path/tag/commit arguments are required");
    process.exit(2);
  }
  try {
    const path = resolve(pathArgument);
    const expected = expectedReleaseSource({ tag, desktopCommit, cliCommit });
    if (command === "build") {
      // The caller owns directory creation so a misspelled release directory cannot be created here.
      writeFileSync(path, `${JSON.stringify(expected, null, 2)}\n`, { mode: 0o644 });
      console.log(`release-source-provenance: wrote ${path}`);
    } else {
      const actual = JSON.parse(readFileSync(path, "utf8"));
      assertReleaseSource(actual, expected, path);
      console.log(`release-source-provenance: validated ${path}`);
    }
  } catch (error) {
    console.error(`release-source-provenance: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
