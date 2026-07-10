#!/usr/bin/env node
// Package smoke (quality-gate roadmap #2, cc-haha pattern): verify the PACKAGED app is structurally
// sound — bundle layout, sidecar executes and matches its version stamp, updater artifacts present.
// Runs after `tauri build`; used locally and as a CI post-build gate. Exit non-zero on any failure.
import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)); // URL.pathname breaks on Windows (/C:/…)
// CI builds with --target <triple> → bundles live under target/<triple>/release; local default builds
// under target/release. Resolve whichever exists (TAURI_TARGET is set by the CI matrix).
const triple = process.env.TAURI_TARGET || "";
const releaseBase =
  [`src-tauri/target/${triple}/release`, "src-tauri/target/release"].map((p) => join(root, p)).find((p) => existsSync(p)) ??
  join(root, "src-tauri/target/release");
const REL_PREFIX = "src-tauri/target/release/";
const rel = (p) => (p.startsWith(REL_PREFIX) ? join(releaseBase, p.slice(REL_PREFIX.length)) : join(root, p));
const plat = process.platform; // darwin | win32 | linux
let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => (console.error(`  ✗ ${msg}`), failures++);

console.log(`package-smoke (${plat})`);

if (plat === "darwin") {
  const app = rel("src-tauri/target/release/bundle/macos/Hara.app");
  const shell = join(app, "Contents/MacOS/hara-desktop");
  const sidecar = join(app, "Contents/MacOS/hara");
  existsSync(app) ? ok("Hara.app present") : fail("Hara.app missing");
  existsSync(shell) && statSync(shell).mode & 0o111 ? ok("shell executable") : fail("shell missing/not executable");
  if (existsSync(sidecar) && statSync(sidecar).mode & 0o111) {
    ok("sidecar bundled + executable");
    try {
      const v = execFileSync(sidecar, ["--version"], { timeout: 30_000 }).toString().trim();
      ok(`sidecar runs: hara ${v}`);
      const stamp = rel("src-tauri/binaries/SIDECAR_VERSION");
      if (existsSync(stamp)) {
        const want = readFileSync(stamp, "utf8").trim();
        v === want ? ok(`version matches stamp (${want})`) : fail(`version ${v} != stamp ${want}`);
      }
    } catch (e) {
      fail(`sidecar --version failed: ${e.message}`);
    }
  } else fail("sidecar missing/not executable");
  const dmgDir = rel("src-tauri/target/release/bundle/dmg");
  const dmg = existsSync(dmgDir) && execFileSync("ls", [dmgDir]).toString().includes(".dmg");
  dmg ? ok("dmg produced") : fail("dmg missing");
  const targz = rel("src-tauri/target/release/bundle/macos/Hara.app.tar.gz");
  const sig = `${targz}.sig`;
  existsSync(targz) ? ok("updater archive present") : fail("updater archive missing");
  if (existsSync(sig)) {
    const s = readFileSync(sig, "utf8").trim();
    s.length > 50 ? ok("updater signature present") : fail("updater signature suspiciously short");
  } else fail("updater .sig missing (set TAURI_SIGNING_PRIVATE_KEY)");
} else if (plat === "linux") {
  const dir = rel("src-tauri/target/release/bundle");
  const has = (sub) => existsSync(join(dir, sub));
  has("appimage") || has("deb") ? ok("appimage/deb produced") : fail("no linux bundles");
} else if (plat === "win32") {
  const dir = rel("src-tauri/target/release/bundle");
  const has = (sub) => existsSync(join(dir, sub));
  has("msi") || has("nsis") ? ok("msi/nsis produced") : fail("no windows bundles");
}

if (failures) {
  console.error(`package-smoke: ${failures} failure(s)`);
  process.exit(1);
}
console.log("package-smoke: all green");
