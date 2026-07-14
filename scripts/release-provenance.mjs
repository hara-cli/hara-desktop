#!/usr/bin/env node
// Bind locally signed/notarized Mac assets to the exact clean Desktop tag that built them. The
// marker is not a replacement for code signing; it prevents accidentally promoting stale output
// left in target/ from a different commit.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireGitCommit, requireStableTag } from "./release-policy.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const sidecarVersion = readFileSync(join(root, "src-tauri", "binaries", "SIDECAR_VERSION"), "utf8").trim();
const sidecarCommit = requireGitCommit(
  readFileSync(join(root, "src-tauri", "binaries", "SIDECAR_COMMIT"), "utf8").trim(),
  "locked sidecar commit",
);
const [, , command, bundleArgument, target, tag, desktopCommit, cliCommit] = process.argv;

if (!bundleArgument || !target || !tag || !desktopCommit || !cliCommit || !["write", "verify"].includes(command)) {
  console.error(
    "usage: node scripts/release-provenance.mjs <write|verify> <bundle-directory> <target> <tag> <desktop-commit> <cli-commit>",
  );
  process.exit(2);
}
requireStableTag(tag, version);
requireGitCommit(desktopCommit, "Desktop commit");
const pinnedCliCommit = requireGitCommit(cliCommit, "CLI commit");
if (pinnedCliCommit !== sidecarCommit) {
  throw new Error(`CLI commit does not match SIDECAR_COMMIT: ${pinnedCliCommit} != ${sidecarCommit}`);
}

const architecture =
  target === "aarch64-apple-darwin" ? "aarch64" : target === "x86_64-apple-darwin" ? "x64" : undefined;
if (!architecture) throw new Error(`unsupported signed Mac target: ${target}`);

const bundle = resolve(bundleArgument);
const paths = {
  dmg: join(bundle, "dmg", `Hara_${version}_${architecture}.dmg`),
  updaterArchive: join(bundle, "macos", "Hara.app.tar.gz"),
  updaterSignature: join(bundle, "macos", "Hara.app.tar.gz.sig"),
};
const marker = join(bundle, `hara-release-provenance-${target}.json`);

function sha256(path) {
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error(`release provenance input is missing or empty: ${path}`);
  }
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function expected() {
  return {
    schema: 1,
    desktopVersion: version,
    desktopTag: tag,
    desktopCommit: desktopCommit.toLowerCase(),
    sidecarVersion,
    cliCommit: cliCommit.toLowerCase(),
    target,
    files: Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, sha256(path)])),
  };
}

if (command === "write") {
  const value = expected();
  writeFileSync(marker, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  console.log(`release-provenance: wrote ${marker}`);
} else {
  if (!existsSync(marker)) throw new Error(`release provenance marker is missing: ${marker}`);
  const actual = JSON.parse(readFileSync(marker, "utf8"));
  const wanted = expected();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`release assets do not match their tagged build provenance: ${marker}`);
  }
  console.log(`release-provenance: verified ${target} at ${desktopCommit}`);
}
