import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  archiveEntriesAreSafe,
  lockedPackageSpec,
  lockedSidecarSpecs,
  officialTarballUrl,
  packageForTarget,
  verifySha512,
} from "../scripts/hydrate-locked-sidecar-dependencies.mjs";

const piPackage = "@earendil-works/pi-coding-agent";
const piLock = () => ({ lockfileVersion: 3, packages: {
  "": { dependencies: { [piPackage]: "1.1.0" } },
  [`node_modules/${piPackage}`]: { version: "1.1.0", integrity: `sha512-${createHash("sha512").update("pi fixture").digest("base64")}` },
} });
test("the formal Pi-only lock requires zero retired SDK tarballs on either Mac architecture", () => {
  for (const target of ["aarch64-apple-darwin", "x86_64-apple-darwin"]) assert.deepEqual(lockedSidecarSpecs(piLock(),target),[]);
  assert.throws(()=>lockedSidecarSpecs(piLock(),"x86_64-unknown-linux-gnu"),/unsupported signed sidecar target/);
});
test("Pi-only hydration cannot silently accept a missing/corrupt/unpinned Pi lock or orphan SDK", () => {
  for (const change of [lock=>delete lock.packages[`node_modules/${piPackage}`],
    lock=>delete lock.packages[`node_modules/${piPackage}`].integrity,
    lock=>lock.packages[""].dependencies[piPackage]="^1.1.0",
    lock=>lock.packages["node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64"]={version:"0.3.250"}]) {
    const lock=piLock();change(lock);assert.throws(()=>lockedSidecarSpecs(lock,"aarch64-apple-darwin"));
  }
  assert.throws(()=>lockedSidecarSpecs({packages:[]},"aarch64-apple-darwin"),/lockfile/);
});
test("a legacy SDK explicitly locked by old source still requires its target and full SHA512 integrity", () => {
  const lock=piLock(),sdk="@anthropic-ai/claude-agent-sdk",native=packageForTarget("aarch64-apple-darwin");
  lock.packages[`node_modules/${sdk}`]={version:"0.3.250",integrity:lock.packages[`node_modules/${piPackage}`].integrity};
  assert.throws(()=>lockedSidecarSpecs(lock,"aarch64-apple-darwin"),/does not lock/);
  lock.packages[`node_modules/${native}`]={...lock.packages[`node_modules/${sdk}`]};
  assert.deepEqual(lockedSidecarSpecs(lock,"aarch64-apple-darwin").map(row=>row.packageName),[sdk,native]);
  delete lock.packages[`node_modules/${native}`].integrity;
  assert.throws(()=>lockedSidecarSpecs(lock,"aarch64-apple-darwin"),/SHA-512/);
});
test("the actual formal hydration CLI does not download or create any SDK/cache for Pi-only Core", t => {
  const home=mkdtempSync(join(tmpdir(),"hara-pi-hydration-"));t.after(()=>rmSync(home,{recursive:true,force:true}));
  const manifest=join(home,"node_modules",piPackage,"package.json"),cache=join(home,"must-not-create-cache");
  mkdirSync(join(manifest,".."),{recursive:true});writeFileSync(manifest,JSON.stringify({name:piPackage,version:"1.1.0"}));
  writeFileSync(join(home,"package-lock.json"),JSON.stringify(piLock()));
  const execute=target=>spawnSync(process.execPath,[fileURLToPath(new URL("../scripts/hydrate-locked-sidecar-dependencies.mjs",import.meta.url)),home,target],
    {encoding:"utf8",env:{...process.env,HOME:home,USERPROFILE:home,HARA_LOCKED_TARBALL_CACHE:cache},timeout:10000});
  for(const target of ["aarch64-apple-darwin","x86_64-apple-darwin"]){const result=execute(target);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Pi-only sidecar lock/);}
  assert.equal(existsSync(cache),false);assert.equal(existsSync(join(home,"node_modules/@anthropic-ai")),false);
  rmSync(manifest);const missing=execute("aarch64-apple-darwin");assert.equal(missing.status,1);assert.match(missing.stderr,/locked Pi dependency is not installed/);
  assert.equal(existsSync(cache),false);
});

test("locked sidecar SDK packages follow the signed macOS target", () => {
  assert.equal(packageForTarget("aarch64-apple-darwin"), "@anthropic-ai/claude-agent-sdk-darwin-arm64");
  assert.equal(packageForTarget("x86_64-apple-darwin"), "@anthropic-ai/claude-agent-sdk-darwin-x64");
  assert.throws(() => packageForTarget("x86_64-unknown-linux-gnu"), /unsupported signed sidecar target/);
});

test("locked sidecar tarballs can only resolve to the official npm registry", () => {
  assert.equal(
    officialTarballUrl("@anthropic-ai/claude-agent-sdk", "0.3.250"),
    "https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.250.tgz",
  );
  assert.throws(() => officialTarballUrl("https://example.test/package", "0.3.250"), /unsafe locked package name/);
  assert.throws(() => officialTarballUrl("@anthropic-ai/claude-agent-sdk", "latest"), /unsafe locked package version/);
});

test("locked sidecar hydration requires a single SHA-512 lockfile integrity", () => {
  const contents = Buffer.from("locked fixture", "utf8");
  const integrity = `sha512-${createHash("sha512").update(contents).digest("base64")}`;
  const packageName = "@anthropic-ai/claude-agent-sdk";
  const spec = lockedPackageSpec({
    packages: {
      [`node_modules/${packageName}`]: { version: "0.3.250", integrity },
    },
  }, packageName);
  assert.deepEqual(spec, { packageName, version: "0.3.250", integrity });
  assert.equal(verifySha512(contents, integrity), true);
  assert.equal(verifySha512(Buffer.from("tampered", "utf8"), integrity), false);
  assert.throws(
    () => lockedPackageSpec({ packages: { [`node_modules/${packageName}`]: { version: "0.3.250" } } }, packageName),
    /no single SHA-512 integrity/,
  );
});

test("locked sidecar archives reject traversal, absolute paths, and links", () => {
  assert.equal(archiveEntriesAreSafe("package/\npackage/package.json\n", "drwxr-xr-x package/\n-rw-r--r-- package/package.json\n"), true);
  assert.equal(archiveEntriesAreSafe("package/../escape\n", "-rw-r--r-- package/../escape\n"), false);
  assert.equal(archiveEntriesAreSafe("/package/file\n", "-rw-r--r-- /package/file\n"), false);
  assert.equal(archiveEntriesAreSafe("package/link\n", "lrwxr-xr-x package/link -> ../../escape\n"), false);
});
