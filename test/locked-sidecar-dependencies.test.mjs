import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  archiveEntriesAreSafe,
  lockedPackageSpec,
  officialTarballUrl,
  packageForTarget,
  verifySha512,
} from "../scripts/hydrate-locked-sidecar-dependencies.mjs";

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
