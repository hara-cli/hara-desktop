#!/usr/bin/env node
// Pre-tag rehearsal of the protected signer's metadata-only merge (1.2.3), with no credentials and no
// GitHub access. It builds a canonical 17-asset draft signed by a throwaway updater key, records it the
// way assemble_draft does, then drives the same CLI commands release-mac-assets.sh runs: check-draft,
// the small-file selection, `updater-manifest --digest-bound` validate/build with only small files and
// the replaced Mac assets present, and check-final against simulated post-upload GitHub metadata.
// Negative controls must all be refused.
//
//   node scripts/release-metadata-merge-rehearsal.mjs <empty-work-dir> <throwaway-private-key-path> <tag>
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const [workArgument, keyPath, tag] = process.argv.slice(2);
if (!workArgument || !keyPath || !tag) {
  console.error("usage: node scripts/release-metadata-merge-rehearsal.mjs <empty-work-dir> <private-key-path> <tag>");
  process.exit(2);
}
const work = resolve(workArgument);
if (readdirSync(work).length) throw new Error("rehearsal work directory must be empty");

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
function run(args, { env = {}, expectFailure = false, reason, label }) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
  const ok = result.status === 0;
  if (ok === expectFailure) {
    throw new Error(`${label}: expected ${expectFailure ? "refusal" : "success"}, got exit ${result.status}\n${result.stdout}${result.stderr}`);
  }
  if (expectFailure && !reason.test(result.stderr)) {
    throw new Error(`${label}: refused for the wrong reason:\n${result.stderr}`);
  }
  console.log(`  ${expectFailure ? "refused" : "ok     "} ${label}${expectFailure ? `: ${(result.stderr.trim().split("\n").pop() ?? "").slice(0, 160)}` : ""}`);
  return result.stdout;
}
function sign(file) {
  const result = spawnSync(process.execPath, [join(root, "node_modules/@tauri-apps/cli/tauri.js"), "signer", "sign", "-f", keyPath, "-p", "", file], {
    cwd: root, encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`signer failed for ${file}: ${result.stderr}`);
}
function metadataFor(directory, names) {
  return {
    assets: names.map((name, index) => ({
      name,
      size: statSync(join(directory, name)).size,
      digest: `sha256:${sha256(join(directory, name))}`,
      state: "uploaded",
      apiUrl: `https://api.github.com/repos/hara-cli/hara-desktop/releases/assets/${1000 + index}`,
      url: `https://github.com/hara-cli/hara-desktop/releases/download/${tag}/${name}`,
    })),
  };
}

const updaters = ["Hara_aarch64.app.tar.gz", "Hara_x64.app.tar.gz", `Hara_${version}_amd64.deb`,
  `Hara-${version}-1.x86_64.rpm`, `Hara_${version}_x64_en-US.msi`, `Hara_${version}_x64-setup.exe`];
const binaries = [...updaters, `Hara_${version}_aarch64.dmg`, `Hara_${version}_x64.dmg`];
const replaced = [`Hara_${version}_aarch64.dmg`, "Hara_aarch64.app.tar.gz", "Hara_aarch64.app.tar.gz.sig",
  `Hara_${version}_x64.dmg`, "Hara_x64.app.tar.gz", "Hara_x64.app.tar.gz.sig", "latest.json"];
const macUpdaters = ["Hara_aarch64.app.tar.gz", "Hara_x64.app.tar.gz"];

console.log(`metadata-only merge rehearsal for ${tag} (${version})`);
// 1. The hosted draft as assemble_draft sees it.
const draft = join(work, "draft");
mkdirSync(draft);
for (const name of binaries) writeFileSync(join(draft, name), randomBytes(64 * 1024));
for (const name of updaters) sign(join(draft, name));
writeFileSync(join(draft, "release-source-provenance.json"), `${JSON.stringify({ rehearsal: true, tag })}\n`);
run(["scripts/updater-manifest.mjs", "build", draft, tag, new Date().toISOString()], { label: "assemble: build latest.json" });
writeFileSync(join(draft, `Hara_${version}_source-packs.zip`), randomBytes(4096));
const draftNames = readdirSync(draft).sort();
if (draftNames.length !== 17) throw new Error(`rehearsal draft must have 17 assets, has ${draftNames.length}`);
const record = run(["scripts/release-asset-digests.mjs", "record", draft], { label: "assemble: record verified draft digests" }).trim();
const env = { HARA_DRAFT_ASSET_DIGESTS: record };
const draftMetadata = join(work, "draft-assets.json");
writeFileSync(draftMetadata, JSON.stringify(metadataFor(draft, draftNames)));

// 2. Signer, before upload: metadata only, then only the small files.
run(["scripts/release-asset-digests.mjs", "check-draft", draftMetadata, "-env", ...replaced], { env, label: "signer: check-draft by GitHub digest" });
const small = JSON.parse(run(["scripts/release-asset-digests.mjs", "small", draftMetadata], { label: "signer: select small files" }));
const signer = join(work, "signer");
mkdirSync(signer);
for (const { name } of small.assets) copyFileSync(join(draft, name), join(signer, name));
run(["scripts/release-asset-digests.mjs", "check-local", signer, "-env", ...replaced], { env, label: "signer: downloaded small files equal the record" });
const smallBytes = small.assets.reduce((total, asset) => total + asset.size, 0);
console.log(`  signer holds ${small.assets.length} small files (${smallBytes} bytes); large assets are digest-bound only`);
run(["scripts/updater-manifest.mjs", "validate", signer, tag, "--digest-bound", "-env"], { env, label: "signer: validate draft latest.json (digest-bound)" });

// 3. Replace the Mac assets with "signed" bytes, re-sign, rebuild latest.json digest-bound.
for (const name of [`Hara_${version}_aarch64.dmg`, `Hara_${version}_x64.dmg`, ...macUpdaters]) writeFileSync(join(signer, name), randomBytes(80 * 1024));
for (const name of macUpdaters) { rmSync(join(signer, `${name}.sig`)); sign(join(signer, name)); }
const pubDate = JSON.parse(readFileSync(join(signer, "latest.json"), "utf8")).pub_date;
rmSync(join(signer, "latest.json"));
run(["scripts/updater-manifest.mjs", "build", signer, tag, pubDate, "--digest-bound", "-env"], { env, label: "signer: rebuild latest.json (digest-bound)" });

// 4. Simulated GitHub metadata after the upload of exactly the replaced assets.
const remote = join(work, "remote");
mkdirSync(remote);
for (const name of draftNames) copyFileSync(join(replaced.includes(name) ? signer : draft, name), join(remote, name));
const finalMetadata = join(work, "signed-assets.json");
writeFileSync(finalMetadata, JSON.stringify(metadataFor(remote, draftNames)));
run(["scripts/release-asset-digests.mjs", "check-final", finalMetadata, "-env", signer, ...replaced], { env, label: "signer: check-final by GitHub digest" });

// 5. Negative controls.
const mutate = (source, change) => { const copy = JSON.parse(readFileSync(source, "utf8")); change(copy.assets); const path = join(work, `negative-${randomBytes(4).toString("hex")}.json`); writeFileSync(path, JSON.stringify(copy)); return path; };
const flip = (digest) => `sha256:${digest.slice("sha256:".length).replace(/^./u, (c) => (c === "0" ? "1" : "0"))}`;
const linux = `Hara_${version}_amd64.deb`;
run(["scripts/release-asset-digests.mjs", "check-draft", mutate(draftMetadata, (a) => { a.find((x) => x.name === linux).digest = flip(a.find((x) => x.name === linux).digest); }), "-env", ...replaced], { env, expectFailure: true, reason: /differs from the verified draft record/u, label: "negative: changed non-Mac digest before upload" });
run(["scripts/release-asset-digests.mjs", "check-draft", mutate(draftMetadata, (a) => { a.push({ ...a[0], name: "unexpected.bin", apiUrl: `${a[0].apiUrl}9` }); }), "-env", ...replaced], { env, expectFailure: true, reason: /extra=\[unexpected\.bin\]/u, label: "negative: extra asset" });
run(["scripts/release-asset-digests.mjs", "check-draft", mutate(draftMetadata, (a) => { a.splice(a.findIndex((x) => x.name === linux), 1); }), "-env", ...replaced], { env, expectFailure: true, reason: /missing=\[Hara_[^\]]+_amd64\.deb\]/u, label: "negative: missing asset" });
run(["scripts/release-asset-digests.mjs", "check-final", mutate(finalMetadata, (a) => { const x = a.find((y) => y.name === "Hara_x64.app.tar.gz"); x.digest = flip(x.digest); }), "-env", signer, ...replaced], { env, expectFailure: true, reason: /uploaded Hara_x64\.app\.tar\.gz does not match the local signed bytes/u, label: "negative: uploaded Mac bytes differ from local" });
run(["scripts/release-asset-digests.mjs", "check-final", mutate(finalMetadata, (a) => { const x = a.find((y) => y.name === linux); x.digest = flip(x.digest); }), "-env", signer, ...replaced], { env, expectFailure: true, reason: /amd64\.deb differs from the verified draft record/u, label: "negative: non-Mac asset changed during upload" });
const swapped = join(work, "swapped");
mkdirSync(swapped);
copyFileSync(join(signer, `${linux}.sig`), join(swapped, `${linux}.sig`));
writeFileSync(join(swapped, `${linux}.sig`), "swapped between metadata checks\n", { flag: "a" });
run(["scripts/release-asset-digests.mjs", "check-local", swapped, "-env", ...replaced], { env, expectFailure: true, reason: /downloaded Hara_[^ ]+_amd64\.deb\.sig differs from the verified draft record/u, label: "negative: small file swapped after the metadata check" });
const partialRecord = JSON.stringify(JSON.parse(record).filter((entry) => entry.name !== linux));
run(["scripts/updater-manifest.mjs", "validate", signer, tag, "--digest-bound", "-env"], { env: { HARA_DRAFT_ASSET_DIGESTS: partialRecord }, expectFailure: true, reason: /release asset set mismatch; missing=\[Hara_[^\]]+_amd64\.deb\]/u, label: "negative: binary neither local nor in the record" });
run(["scripts/release-asset-digests.mjs", "check-draft", draftMetadata, "-env", ...replaced], { env: { HARA_DRAFT_ASSET_DIGESTS: "" }, expectFailure: true, reason: /HARA_DRAFT_ASSET_DIGESTS is empty/u, label: "negative: missing assembly record" });
console.log("metadata-only merge rehearsal passed");
