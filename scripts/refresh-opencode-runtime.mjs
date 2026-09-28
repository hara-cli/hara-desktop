#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(join(root, "scripts", "opencode-runtime-lock.json"), "utf8"));
const target = process.argv[2];
const providedArchive = process.argv[3];
const entry = lock.targets[target];
if (!target || !entry) throw new Error(`unsupported Hara Code Runtime target: ${target || "<missing>"}`);

const windows = target.includes("windows");
const extension = windows ? ".exe" : "";
const destination = join(root, "src-tauri", "binaries", `hara-code-runtime-${target}${extension}`);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const cacheDirectory = join(tmpdir(), "hara-release-code-runtime-cache", lock.version);
const cachedArchive = join(cacheDirectory, entry.asset);
const partialArchive = `${cachedArchive}.partial`;
const url = `${lock.repository}/releases/download/v${lock.version}/${entry.asset}`;

await mkdir(dirname(destination), { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), "hara-code-runtime-"));
let stagedDestination;
try {
  let archive = providedArchive ? await readFile(resolve(providedArchive)) : undefined;
  if (!archive) {
    try {
      const cached = await readFile(cachedArchive);
      if (digest(cached) === entry.sha256) {
        archive = cached;
        console.log(`✓ Hara Code Runtime ${lock.version} archive cache verified for ${target}`);
      } else {
        await rm(cachedArchive, { force: true });
      }
    } catch {
      // A missing or stale cache is populated below.
    }
  }
  if (!archive) {
    await mkdir(cacheDirectory, { recursive: true });
    const deadline = Date.now() + 900_000;
    let curl;
    for (let attempt = 1; attempt <= 13; attempt += 1) {
      const remainingSeconds = Math.max(1, Math.floor((deadline - Date.now()) / 1_000));
      const transferSeconds = Math.min(300, remainingSeconds);
      curl = spawnSync("curl", [
        "--fail", "--location", "--silent", "--show-error", "--http1.1",
        "--connect-timeout", "20", "--max-time", String(transferSeconds), "--continue-at", "-",
        "--output", partialArchive, url,
      ], { encoding: "utf8", timeout: (transferSeconds + 30) * 1_000, windowsHide: true });
      if (!curl.error && curl.status === 0) break;
      if (attempt === 13 || Date.now() >= deadline - 2_000) break;
      console.warn(`warning: Hara Code Runtime download interrupted (${attempt}/13); retaining partial cache and resuming`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
    }
    if (!curl || curl.error || curl.status !== 0) {
      throw new Error(
        `download ${basename(url)} failed after bounded resumable retries; partial cache retained: ${curl?.stderr || curl?.error || "no curl result"}`,
      );
    }
    archive = await readFile(partialArchive);
    const downloadedDigest = digest(archive);
    if (downloadedDigest !== entry.sha256) {
      await rm(partialArchive, { force: true });
      throw new Error(
        `Hara Code Runtime archive checksum mismatch for ${target}: expected ${entry.sha256}, got ${downloadedDigest}`,
      );
    }
    await rm(cachedArchive, { force: true });
    await rename(partialArchive, cachedArchive);
    console.log(`✓ Hara Code Runtime ${lock.version} resumable archive cache verified for ${target}`);
  }

  const actual = digest(archive);
  if (actual !== entry.sha256) {
    throw new Error(`Hara Code Runtime archive checksum mismatch for ${target}: expected ${entry.sha256}, got ${actual}`);
  }

  const archiveName = basename(entry.asset);
  const extractedName = "extracted";
  const archivePath = join(scratch, archiveName);
  const extracted = join(scratch, extractedName);
  await mkdir(extracted);
  await writeFile(archivePath, archive, { mode: 0o600 });
  let extraction;
  if (process.platform === "win32" && archiveName.endsWith(".zip")) {
    const extractorName = "extract-code-runtime.ps1";
    await writeFile(join(scratch, extractorName), [
      "param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Destination)",
      "$ErrorActionPreference = 'Stop'",
      "Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force",
    ].join("\r\n"), { mode: 0o600 });
    extraction = spawnSync("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", extractorName, archiveName, extractedName,
    ], { cwd: scratch, encoding: "utf8", windowsHide: true });
  } else {
    extraction = spawnSync("tar", ["-xf", archiveName, "-C", extractedName], {
      cwd: scratch,
      encoding: "utf8",
      windowsHide: true,
    });
  }
  if (extraction.error || extraction.status !== 0) {
    throw new Error(`extract Hara Code Runtime archive: ${extraction.stderr || extraction.stdout || extraction.error}`);
  }

  const queue = [extracted];
  let found;
  while (queue.length && !found) {
    const directory = queue.shift();
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const candidate = join(directory, item.name);
      if (item.isDirectory()) queue.push(candidate);
      else if (item.isFile() && item.name.toLowerCase() === (windows ? "opencode.exe" : "opencode")) {
        found = candidate;
        break;
      }
    }
  }
  if (!found) throw new Error(`verified ${entry.asset} does not contain the OpenCode executable`);
  const executable = await readFile(found);
  if (executable.length < 1024 * 1024) throw new Error("Hara Code Runtime executable is unexpectedly small");

  stagedDestination = join(dirname(destination), `.${basename(destination)}.${basename(scratch)}.tmp`);
  await writeFile(stagedDestination, executable, { mode: windows ? 0o600 : 0o755 });
  if (!windows) await chmod(stagedDestination, 0o755);
  if (windows) await rm(destination, { force: true });
  await rename(stagedDestination, destination);
  stagedDestination = undefined;

  const nativeTarget = process.platform === "darwin"
    ? `${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`
    : process.platform === "linux"
      ? `${process.arch === "arm64" ? "aarch64" : "x86_64"}-unknown-linux-gnu`
      : process.platform === "win32" && process.arch === "x64"
        ? "x86_64-pc-windows-msvc"
        : "";
  if (target === nativeTarget) {
    const version = spawnSync(destination, ["--version"], { encoding: "utf8", timeout: 15_000, windowsHide: true });
    const output = `${version.stdout || ""}\n${version.stderr || ""}`;
    if (version.error || version.status !== 0 || !output.includes(lock.version)) {
      throw new Error(`Hara Code Runtime version smoke failed: ${output.trim().slice(0, 240) || version.error || version.status}`);
    }
  }
  console.log(`✓ Hara Code Runtime ${lock.version} verified → ${destination}`);
} finally {
  if (stagedDestination) await rm(stagedDestination, { force: true });
  await rm(scratch, { recursive: true, force: true });
}
