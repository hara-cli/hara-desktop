#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const OFFICIAL_NPM_REGISTRY = "https://registry.npmjs.org";
const SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";
const TARGET_PACKAGES = Object.freeze({
  "aarch64-apple-darwin": "@anthropic-ai/claude-agent-sdk-darwin-arm64",
  "x86_64-apple-darwin": "@anthropic-ai/claude-agent-sdk-darwin-x64",
});

export function packageForTarget(target) {
  const packageName = TARGET_PACKAGES[target];
  if (!packageName) throw new Error(`unsupported signed sidecar target: ${target}`);
  return packageName;
}

export function officialTarballUrl(packageName, version) {
  if (!/^@[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(packageName)) {
    throw new Error(`unsafe locked package name: ${packageName}`);
  }
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`unsafe locked package version: ${version}`);
  }
  return `${OFFICIAL_NPM_REGISTRY}/${packageName}/-/${basename(packageName)}-${version}.tgz`;
}

export function lockedPackageSpec(lockfile, packageName) {
  const entry = lockfile?.packages?.[`node_modules/${packageName}`];
  if (!entry || typeof entry !== "object") {
    throw new Error(`package-lock.json does not lock ${packageName}`);
  }
  const version = typeof entry.version === "string" ? entry.version : "";
  const integrity = typeof entry.integrity === "string" ? entry.integrity : "";
  officialTarballUrl(packageName, version);
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(integrity)) {
    throw new Error(`package-lock.json has no single SHA-512 integrity for ${packageName}@${version}`);
  }
  return { packageName, version, integrity };
}

export function verifySha512(contents, integrity) {
  const expected = Buffer.from(integrity.slice("sha512-".length), "base64");
  const actual = createHash("sha512").update(contents).digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function archiveEntriesAreSafe(entries, verboseEntries = "") {
  const paths = String(entries).split(/\r?\n/u).filter(Boolean);
  if (paths.length === 0) return false;
  for (const entry of paths) {
    if (entry.includes("\0") || entry.startsWith("/") || entry.includes("\\")) return false;
    const segments = entry.split("/").filter(Boolean);
    if (segments[0] !== "package" || segments.some((segment) => segment === "..")) return false;
  }
  if (verboseEntries) {
    for (const line of String(verboseEntries).split(/\r?\n/u).filter(Boolean)) {
      if (line[0] !== "-" && line[0] !== "d") return false;
    }
  }
  return true;
}

function run(command, args, { cwd, maxBuffer = 16 * 1024 * 1024, timeout = 660_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer,
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(`${command} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout;
}

function verifyInstalledPackage(destination, spec) {
  const manifestPath = join(destination, "package.json");
  if (!existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return manifest.name === spec.packageName && manifest.version === spec.version;
  } catch {
    return false;
  }
}

function downloadLockedTarball(spec, cacheDirectory) {
  const cacheKey = createHash("sha256").update(spec.integrity).digest("hex").slice(0, 16);
  const cacheName = `${spec.packageName.replaceAll(/[\/@]/gu, "-")}-${spec.version}-${cacheKey}.tgz`;
  const archivePath = join(cacheDirectory, cacheName);
  if (existsSync(archivePath)) {
    if (verifySha512(readFileSync(archivePath), spec.integrity)) return archivePath;
    rmSync(archivePath, { force: true });
  }

  const downloadDirectory = mkdtempSync(join(cacheDirectory, "download-"));
  const temporaryArchive = join(downloadDirectory, "package.tgz");
  try {
    run("curl", [
      "--fail",
      "--location",
      "--silent",
      "--show-error",
      "--retry", "4",
      "--retry-delay", "3",
      "--retry-all-errors",
      "--connect-timeout", "20",
      "--max-time", "600",
      "--output", temporaryArchive,
      officialTarballUrl(spec.packageName, spec.version),
    ]);
    const contents = readFileSync(temporaryArchive);
    if (!verifySha512(contents, spec.integrity)) {
      throw new Error(`official npm tarball integrity mismatch for ${spec.packageName}@${spec.version}`);
    }
    renameSync(temporaryArchive, archivePath);
    chmodSync(archivePath, 0o600);
    return archivePath;
  } finally {
    rmSync(downloadDirectory, { recursive: true, force: true });
  }
}

function extractLockedPackage(cliRoot, spec, archivePath) {
  const nodeModulesRoot = resolve(cliRoot, "node_modules");
  const destination = resolve(nodeModulesRoot, spec.packageName);
  if (!destination.startsWith(`${nodeModulesRoot}${sep}`)) {
    throw new Error(`refusing to extract outside node_modules: ${destination}`);
  }
  const entries = run("tar", ["-tzf", archivePath]);
  const verboseEntries = run("tar", ["-tvzf", archivePath]);
  if (!archiveEntriesAreSafe(entries, verboseEntries)) {
    throw new Error(`unsafe archive structure for ${spec.packageName}@${spec.version}`);
  }
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  run("tar", ["-xzf", archivePath, "-C", destination, "--strip-components=1"]);
  if (!verifyInstalledPackage(destination, spec)) {
    throw new Error(`extracted package identity mismatch for ${spec.packageName}@${spec.version}`);
  }
}

export function hydrateLockedSidecarDependencies(cliRoot, target) {
  const resolvedRoot = resolve(cliRoot);
  const lockfile = JSON.parse(readFileSync(join(resolvedRoot, "package-lock.json"), "utf8"));
  const specs = [SDK_PACKAGE, packageForTarget(target)]
    .map((packageName) => lockedPackageSpec(lockfile, packageName));
  const cacheDirectory = resolve(
    process.env.HARA_LOCKED_TARBALL_CACHE || join(homedir(), ".cache", "hara-release", "npm"),
  );
  mkdirSync(cacheDirectory, { recursive: true, mode: 0o700 });

  for (const spec of specs) {
    const destination = resolve(resolvedRoot, "node_modules", spec.packageName);
    if (verifyInstalledPackage(destination, spec)) {
      process.stdout.write(`✓ locked sidecar dependency present: ${spec.packageName}@${spec.version}\n`);
      continue;
    }
    const archivePath = downloadLockedTarball(spec, cacheDirectory);
    extractLockedPackage(resolvedRoot, spec, archivePath);
    process.stdout.write(`✓ hydrated locked sidecar dependency: ${spec.packageName}@${spec.version}\n`);
  }
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  const [, , cliRoot, target] = process.argv;
  if (!cliRoot || !target) {
    process.stderr.write("usage: hydrate-locked-sidecar-dependencies.mjs <cli-root> <target>\n");
    process.exitCode = 2;
  } else {
    try {
      hydrateLockedSidecarDependencies(cliRoot, target);
    } catch (error) {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
