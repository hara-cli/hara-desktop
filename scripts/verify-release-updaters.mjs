#!/usr/bin/env node
// Cryptographically verify every updater artifact in a flat assembled/downloaded release directory.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyUpdaterArtifactSignature } from "./updater-signature.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const directory = resolve(process.argv[2] || "");
if (!process.argv[2]) {
  console.error("usage: node scripts/verify-release-updaters.mjs <release-asset-directory> [artifact...]");
  process.exit(2);
}

const allArtifacts = [
  "Hara_aarch64.app.tar.gz",
  "Hara_x64.app.tar.gz",
  `Hara_${version}_amd64.deb`,
  `Hara-${version}-1.x86_64.rpm`,
  `Hara_${version}_x64_en-US.msi`,
  `Hara_${version}_x64-setup.exe`,
];
// Optional subset (1.2.3 metadata-only merge: the signer holds only the Mac updater archives; the
// other platforms were verified by their hosted matrix builds and are bound by digest).
const requested = process.argv.slice(3);
for (const name of requested) {
  if (!allArtifacts.includes(name)) {
    console.error(`verify-release-updaters: unknown updater artifact ${name}`);
    process.exit(2);
  }
}
const artifacts = requested.length ? requested : allArtifacts;
for (const artifact of artifacts) {
  const keyId = verifyUpdaterArtifactSignature(
    join(directory, artifact),
    join(directory, `${artifact}.sig`),
    artifact,
  );
  console.log(`  ✓ ${artifact} cryptographically verified (${keyId})`);
}
console.log(requested.length ? `${artifacts.length} requested updater artifact(s) cryptographically verified` : "all release updater artifacts cryptographically verified");
