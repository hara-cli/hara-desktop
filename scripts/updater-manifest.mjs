#!/usr/bin/env node
// Build or validate latest.json from the exact, canonical release asset set. This is intentionally
// single-writer: matrix jobs never read/modify/write the updater manifest concurrently.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireStableTag } from "./release-policy.mjs";
import { assertUpdaterSignatureKey } from "./updater-signature.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const repository = "hara-cli/hara-desktop";

const platformAssets = [
  ["darwin-aarch64", "Hara_aarch64.app.tar.gz"],
  ["darwin-aarch64-app", "Hara_aarch64.app.tar.gz"],
  ["darwin-x86_64", "Hara_x64.app.tar.gz"],
  ["darwin-x86_64-app", "Hara_x64.app.tar.gz"],
  ["linux-x86_64", `Hara_${version}_amd64.deb`],
  ["linux-x86_64-deb", `Hara_${version}_amd64.deb`],
  ["linux-x86_64-rpm", `Hara-${version}-1.x86_64.rpm`],
  ["windows-x86_64", `Hara_${version}_x64_en-US.msi`],
  ["windows-x86_64-msi", `Hara_${version}_x64_en-US.msi`],
  ["windows-x86_64-nsis", `Hara_${version}_x64-setup.exe`],
];

const updaterArtifacts = [...new Set(platformAssets.map(([, asset]) => asset))];
const releaseArtifacts = [
  `Hara_${version}_aarch64.dmg`,
  `Hara_${version}_x64.dmg`,
  "release-source-provenance.json",
  ...updaterArtifacts,
];
const expectedAssetFiles = [
  ...releaseArtifacts,
  ...updaterArtifacts.map((asset) => `${asset}.sig`),
].sort();

function die(message) {
  console.error(`updater-manifest: ${message}`);
  process.exit(1);
}

function validateTag(tag) {
  try {
    requireStableTag(tag, version);
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }
}

function assertFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    die(`${label} missing or empty: ${path}`);
  }
}

function assertExactAssetSet(directory, manifestAllowed) {
  const actual = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => manifestAllowed || name !== "latest.json")
    .sort();
  const expected = manifestAllowed ? [...expectedAssetFiles, "latest.json"].sort() : expectedAssetFiles;
  const missing = expected.filter((name) => !actual.includes(name));
  const extra = actual.filter((name) => !expected.includes(name));
  if (missing.length || extra.length) {
    die(`release asset set mismatch; missing=[${missing.join(", ")}], extra=[${extra.join(", ")}]`);
  }
  for (const name of expectedAssetFiles) assertFile(join(directory, name), `release asset ${name}`);
}

function signatureFor(directory, artifact) {
  const path = join(directory, `${artifact}.sig`);
  assertFile(path, `signature for ${artifact}`);
  const signature = readFileSync(path, "utf8").trim();
  if (signature.length <= 50) die(`signature for ${artifact} is suspiciously short`);
  try {
    assertUpdaterSignatureKey(signature, `signature for ${artifact}`);
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }
  return signature;
}

function expectedPlatforms(directory, tag) {
  const baseUrl = `https://github.com/${repository}/releases/download/${tag}`;
  return Object.fromEntries(
    platformAssets.map(([platform, artifact]) => [
      platform,
      {
        signature: signatureFor(directory, artifact),
        url: `${baseUrl}/${encodeURIComponent(artifact)}`,
      },
    ]),
  );
}

function assertManifest(manifest, directory, tag) {
  if (manifest.version !== version) die(`manifest version must be ${version}, got ${manifest.version ?? "<missing>"}`);
  if (typeof manifest.notes !== "string") die("manifest notes must be a string");
  if (typeof manifest.pub_date !== "string" || Number.isNaN(Date.parse(manifest.pub_date))) {
    die(`manifest pub_date is invalid: ${manifest.pub_date ?? "<missing>"}`);
  }
  const expected = expectedPlatforms(directory, tag);
  const actualKeys = Object.keys(manifest.platforms ?? {}).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    die(`platform keys mismatch; expected ${expectedKeys.join(", ")}, got ${actualKeys.join(", ")}`);
  }
  for (const [platform, value] of Object.entries(expected)) {
    const actual = manifest.platforms[platform];
    if (actual.url !== value.url) die(`${platform} URL mismatch: ${actual.url ?? "<missing>"}`);
    if (actual.signature !== value.signature) die(`${platform} signature does not match ${basename(value.url)}.sig`);
  }
}

const [, , command, directoryArgument, tag, fourth] = process.argv;
if (!command || !directoryArgument || !tag || !["build", "validate"].includes(command)) {
  console.error("usage:");
  console.error("  node scripts/updater-manifest.mjs build <asset-directory> <tag> <pub-date>");
  console.error("  node scripts/updater-manifest.mjs validate <asset-directory> <tag> [manifest-path]");
  process.exit(2);
}

const directory = resolve(directoryArgument);
validateTag(tag);

if (command === "build") {
  const pubDate = fourth;
  if (!pubDate || Number.isNaN(Date.parse(pubDate))) die(`pub-date is invalid: ${pubDate || "<empty>"}`);
  assertExactAssetSet(directory, false);
  const manifest = {
    version,
    notes: `Hara Desktop ${version}`,
    pub_date: new Date(pubDate).toISOString(),
    platforms: expectedPlatforms(directory, tag),
  };
  const manifestPath = join(directory, "latest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assertExactAssetSet(directory, true);
  assertManifest(manifest, directory, tag);
  console.log(`updater-manifest: built and validated ${manifestPath}`);
} else {
  const manifestPath = resolve(fourth || join(directory, "latest.json"));
  assertExactAssetSet(directory, true);
  assertFile(manifestPath, "latest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assertManifest(manifest, directory, tag);
  console.log(`updater-manifest: validated ${manifestPath}`);
}
