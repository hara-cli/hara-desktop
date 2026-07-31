#!/usr/bin/env node
// Convert the already validated GitHub latest.json into the first-party updater manifest. Artifact
// bytes and minisign signatures remain identical; only the immutable download origin changes.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireStableTag } from "./release-policy.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const githubReleaseOrigin = "https://github.com/hara-cli/hara-desktop/releases/download";
const firstPartyReleaseOrigin = "https://assets.nanhara.com/hara/desktop";

export const updaterPlatformAssets = Object.freeze({
  "darwin-aarch64": "Hara_aarch64.app.tar.gz",
  "darwin-aarch64-app": "Hara_aarch64.app.tar.gz",
  "darwin-x86_64": "Hara_x64.app.tar.gz",
  "darwin-x86_64-app": "Hara_x64.app.tar.gz",
  "linux-x86_64": `Hara_${version}_amd64.deb`,
  "linux-x86_64-deb": `Hara_${version}_amd64.deb`,
  "linux-x86_64-rpm": `Hara-${version}-1.x86_64.rpm`,
  "windows-x86_64": `Hara_${version}_x64_en-US.msi`,
  "windows-x86_64-msi": `Hara_${version}_x64_en-US.msi`,
  "windows-x86_64-nsis": `Hara_${version}_x64-setup.exe`,
});

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} keys mismatch; expected ${wanted.join(", ")}, got ${actual.join(", ")}`);
  }
}

function expectedUrl(origin, tag, asset) {
  return `${origin}/${tag}/${encodeURIComponent(asset)}`;
}

function validateManifest(manifest, tag, origin, label) {
  requireStableTag(tag, version);
  assertPlainObject(manifest, label);
  assertExactKeys(manifest, ["version", "notes", "pub_date", "platforms"], label);
  if (manifest.version !== version) {
    throw new Error(`${label} version must be ${version}, got ${manifest.version ?? "<missing>"}`);
  }
  if (typeof manifest.notes !== "string") throw new Error(`${label} notes must be a string`);
  if (typeof manifest.pub_date !== "string" || Number.isNaN(Date.parse(manifest.pub_date))) {
    throw new Error(`${label} pub_date is invalid: ${manifest.pub_date ?? "<missing>"}`);
  }
  assertPlainObject(manifest.platforms, `${label} platforms`);
  assertExactKeys(manifest.platforms, Object.keys(updaterPlatformAssets), `${label} platforms`);

  const signatures = new Map();
  for (const [platform, asset] of Object.entries(updaterPlatformAssets)) {
    const entry = manifest.platforms[platform];
    assertPlainObject(entry, `${label} ${platform}`);
    assertExactKeys(entry, ["signature", "url"], `${label} ${platform}`);
    const wantedUrl = expectedUrl(origin, tag, asset);
    if (entry.url !== wantedUrl) {
      throw new Error(`${label} ${platform} URL mismatch: ${entry.url ?? "<missing>"}`);
    }
    if (typeof entry.signature !== "string" || entry.signature.trim().length <= 50) {
      throw new Error(`${label} ${platform} signature is missing or suspiciously short`);
    }
    const priorSignature = signatures.get(asset);
    if (priorSignature && priorSignature !== entry.signature) {
      throw new Error(`${label} duplicate platform signature mismatch for ${asset}`);
    }
    signatures.set(asset, entry.signature);
  }
  return manifest;
}

export function validateCanonicalManifest(manifest, tag) {
  return validateManifest(manifest, tag, githubReleaseOrigin, "canonical updater manifest");
}

export function validateMirrorManifest(manifest, tag) {
  return validateManifest(manifest, tag, firstPartyReleaseOrigin, "first-party updater manifest");
}

export function buildMirrorManifest(canonicalManifest, tag) {
  validateCanonicalManifest(canonicalManifest, tag);
  const platforms = Object.fromEntries(
    Object.entries(updaterPlatformAssets).map(([platform, asset]) => [
      platform,
      {
        signature: canonicalManifest.platforms[platform].signature,
        url: expectedUrl(firstPartyReleaseOrigin, tag, asset),
      },
    ]),
  );
  return validateMirrorManifest(
    {
      version: canonicalManifest.version,
      notes: canonicalManifest.notes,
      pub_date: canonicalManifest.pub_date,
      platforms,
    },
    tag,
  );
}

function usage() {
  console.error("usage:");
  console.error(
    "  node scripts/updater-mirror-manifest.mjs build <canonical-latest.json> <tag> <output-latest.json>",
  );
  console.error("  node scripts/updater-mirror-manifest.mjs validate <mirror-latest.json> <tag>");
}

function main() {
  const [, , command, manifestArgument, tag, outputArgument] = process.argv;
  if (!manifestArgument || !tag || !["build", "validate"].includes(command)) {
    usage();
    process.exitCode = 2;
    return;
  }

  const manifestPath = resolve(manifestArgument);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (command === "build") {
    if (!outputArgument) {
      usage();
      process.exitCode = 2;
      return;
    }
    const outputPath = resolve(outputArgument);
    const mirror = buildMirrorManifest(manifest, tag);
    writeFileSync(outputPath, `${JSON.stringify(mirror, null, 2)}\n`);
    console.log(`updater-mirror-manifest: built and validated ${outputPath}`);
    return;
  }
  validateMirrorManifest(manifest, tag);
  console.log(`updater-mirror-manifest: validated ${manifestPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(
      `updater-mirror-manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
