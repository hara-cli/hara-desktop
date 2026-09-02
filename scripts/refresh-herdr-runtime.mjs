#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(join(root, "scripts", "herdr-runtime-lock.json"), "utf8"));
const target = process.argv[2];
const providedArchive = process.argv[3];
const entry = lock.targets[target];
if (!target || !entry) {
  throw new Error(`unsupported Herdr runtime target: ${target || "<missing>"}`);
}

const windows = target.includes("windows");
const extension = windows ? ".exe" : "";
const destination = join(root, "src-tauri", "binaries", `herdr-${target}${extension}`);
const digest = (value) => createHash("sha256").update(value).digest("hex");

if (!windows) {
  try {
    const existing = await readFile(destination);
    if (digest(existing) === entry.sha256) {
      await chmod(destination, 0o755);
      console.log(`✓ Herdr ${lock.version} already verified for ${target}`);
      process.exit(0);
    }
  } catch {
    // Missing or stale output is replaced only after the pinned download verifies.
  }
}

const url = `${lock.repository}/releases/download/v${lock.version}/${entry.asset}`;
await mkdir(dirname(destination), { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), "hara-herdr-"));
let stagedDestination;
try {
  let body = providedArchive ? await readFile(resolve(providedArchive)) : undefined;
  let fetchError;
  if (!body) {
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      body = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      fetchError = error;
    }
  }
  if (!body) {
    const archive = join(scratch, entry.asset);
    const curl = spawnSync("curl", [
      "-fL", "--retry", "3", "--retry-all-errors", "--connect-timeout", "20", "--max-time", "300",
      "--output", archive, url,
    ], { encoding: "utf8", timeout: 330_000, windowsHide: true });
    if (curl.error || curl.status !== 0) {
      throw new Error(`download ${basename(url)} failed: ${curl.stderr || curl.error || fetchError}`);
    }
    body = await readFile(archive);
  }
  const actual = digest(body);
  if (actual !== entry.sha256) {
    throw new Error(`Herdr archive checksum mismatch for ${target}: expected ${entry.sha256}, got ${actual}`);
  }

  let executable = body;
  if (windows) {
    // Keep extractor operands relative to the verified scratch directory. On Windows the release
    // shell is Git Bash: its GNU tar treats `C:\\...` as a remote address and cannot unpack ZIP,
    // while Windows PowerShell's built-in Expand-Archive handles the pinned Herdr ZIP directly.
    const archiveName = basename(entry.asset);
    const extractedName = "extracted";
    const archive = join(scratch, archiveName);
    const extracted = join(scratch, extractedName);
    await mkdir(extracted);
    await writeFile(archive, body, { mode: 0o600 });
    let result;
    if (process.platform === "win32") {
      const extractorName = "extract-herdr.ps1";
      await writeFile(join(scratch, extractorName), [
        "param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Destination)",
        "$ErrorActionPreference = 'Stop'",
        "Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force",
      ].join("\r\n"), { mode: 0o600 });
      result = spawnSync("powershell.exe", [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", extractorName, archiveName, extractedName,
      ], { cwd: scratch, encoding: "utf8", windowsHide: true });
    } else {
      result = spawnSync("tar", ["-xf", archiveName, "-C", extractedName], {
        cwd: scratch,
        encoding: "utf8",
        windowsHide: true,
      });
    }
    if (result.error || result.status !== 0) {
      throw new Error(`extract Herdr Windows archive: ${result.stderr || result.stdout || result.error}`);
    }
    const queue = [extracted];
    let found;
    while (queue.length && !found) {
      const directory = queue.shift();
      for (const item of await readdir(directory, { withFileTypes: true })) {
        const candidate = join(directory, item.name);
        if (item.isDirectory()) queue.push(candidate);
        else if (item.name.toLowerCase() === "herdr.exe") {
          found = candidate;
          break;
        }
      }
    }
    if (!found) throw new Error("Herdr Windows archive does not contain herdr.exe");
    executable = await readFile(found);
  }
  // Stage beside the final sidecar so POSIX rename is an atomic replacement even when the system
  // temp directory lives on another volume. Windows cannot replace an existing executable with rename,
  // so its build lane removes only the exact ignored destination after the verified stage is durable.
  stagedDestination = join(dirname(destination), `.${basename(destination)}.${basename(scratch)}.tmp`);
  await writeFile(stagedDestination, executable, { mode: windows ? 0o600 : 0o755 });
  if (!windows) await chmod(stagedDestination, 0o755);
  if (windows) await rm(destination, { force: true });
  await rename(stagedDestination, destination);
  stagedDestination = undefined;
  console.log(`✓ Herdr ${lock.version} verified → ${destination}`);
} finally {
  if (stagedDestination) await rm(stagedDestination, { force: true });
  await rm(scratch, { recursive: true, force: true });
}
