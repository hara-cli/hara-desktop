import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { requireStableTag } from "../scripts/release-policy.mjs";
const root = new URL("../", import.meta.url).pathname, read = file => readFileSync(join(root, file), "utf8"), version = JSON.parse(read("package.json")).version;
// Public-key-ID-only fixture for manifest shape tests; cryptographic signing has a separate local gate.
const publicText = Buffer.from(JSON.parse(read("src-tauri/tauri.conf.json")).plugins.updater.pubkey, "base64").toString("utf8");
const packet = Buffer.from(publicText.split("\n").find(line => line && !line.startsWith("untrusted")), "base64");
const signaturePacket = Buffer.concat([Buffer.from("ED"), packet.subarray(2, 10), Buffer.alloc(64)]);
const signature = Buffer.from(`untrusted comment: fixture only\n${signaturePacket.toString("base64")}\ntrusted comment: fixture\n${Buffer.alloc(64).toString("base64")}\n`).toString("base64");
const assets = [`Hara_${version}_aarch64.dmg`, `Hara_${version}_x64.dmg`, "release-source-provenance.json", "Hara_aarch64.app.tar.gz", "Hara_x64.app.tar.gz", `Hara_${version}_amd64.deb`, `Hara-${version}-1.x86_64.rpm`, `Hara_${version}_x64_en-US.msi`, `Hara_${version}_x64-setup.exe`];
for (const channel of ["candidate", "stable"]) test(`${channel} updater manifests generate and validate without crossing channels`, () => {
  const directory = mkdtempSync(join(tmpdir(), "hara-channel-test-"));
  try {
    for (const asset of assets) { writeFileSync(join(directory, asset), "fixture artifact"); if (!asset.endsWith(".dmg") && asset !== "release-source-provenance.json") writeFileSync(join(directory, asset + ".sig"), signature); }
    const run = args => spawnSync(process.execPath, ["scripts/updater-manifest.mjs", ...args, "--channel", channel], { cwd: root, encoding: "utf8" });
    assert.equal(run(["build", directory, `v${version}`, "2026-10-18T00:00:00Z"]).status, 0);
    assert.equal(run(["validate", directory, `v${version}`]).status, 0);
    const manifest = JSON.parse(readFileSync(join(directory, "latest.json"), "utf8")); assert.equal(manifest.version, version);
    for (const value of Object.values(manifest.platforms)) assert.equal(value.url.startsWith(channel === "candidate" ? `https://assets.nanhara.com/hara/desktop/candidate/${version}/` : `https://github.com/hara-cli/hara-desktop/releases/download/v${version}/`), true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("stable release guards and embedded public key remain unchanged; updater private file has no read path", () => {
  assert.throws(() => requireStableTag("v0.1.188-rc.1", "0.1.188-rc.1"));
  assert.equal(read("scripts/build-mac-signed.sh").includes('cat "$HOME/.tauri/hara-desktop.key"'), false);
  const helper = read("scripts/with-updater-keychain.sh"); assert.match(helper, /\/usr\/bin\/security find-generic-password/); assert.match(helper, /com\.nanhara\.hara\.updater-signing/); assert.match(helper, /UPDATER_KEYCHAIN_ACCOUNT=desktop-updater/);
  assert.equal(helper.includes("hara-desktop.key"), false); assert.match(helper, /no plaintext fallback/); assert.match(helper, /set \+x/);
  const native = read("src-tauri/src/lib.rs"); assert.match(native, /updater_builder\(\)\.endpoints\(urls\)/); assert.match(native, /#\[cfg\(debug_assertions\)\]/);
  assert.equal(JSON.parse(read("src-tauri/tauri.conf.json")).plugins.updater.endpoints.length, 2);
});
