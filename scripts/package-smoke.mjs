#!/usr/bin/env node
// Verify the actual packaged app, updater artifacts, target architecture, and bundled sidecar.
// Every release target runs this on a native runner before a draft release may become stable.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeTarget, smokeSidecar } from "./sidecar-smoke.mjs";
import { smokeMacDmg } from "./mac-dmg-smoke.mjs";
import { smokeMacUpdaterArchive } from "./mac-updater-smoke.mjs";
import { verifyUpdaterArtifactSignature } from "./updater-signature.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const triple = process.env.TAURI_TARGET || "";
const expectedTarget = triple || nativeTarget();
const releaseBase = triple
  ? join(root, "src-tauri", "target", triple, "release")
  : join(root, "src-tauri", "target", "release");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const stampPath = join(root, "src-tauri", "binaries", "SIDECAR_VERSION");
const sidecarVersion = existsSync(stampPath) ? readFileSync(stampPath, "utf8").trim() : "";
const platform = process.platform;
let failures = 0;
const EXTRACTION_BUFFER_BYTES = 512 * 1024 * 1024;
const EXTRACTION_TIMEOUT_MS = 5 * 60_000;

const ok = (message) => console.log(`  ✓ ${message}`);
const fail = (message) => {
  console.error(`  ✗ ${message}`);
  failures++;
};

function executable(path, label) {
  if (!existsSync(path)) return fail(`${label} missing: ${path}`), false;
  const stat = statSync(path);
  if (!stat.isFile() || stat.size === 0) return fail(`${label} is not a non-empty file: ${path}`), false;
  if (platform !== "win32" && (stat.mode & 0o111) === 0) return fail(`${label} is not executable: ${path}`), false;
  ok(`${label} present + executable`);
  return true;
}

function filesWithSuffix(dir, suffix) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(suffix))
    .map((name) => join(dir, name));
}

function updaterArtifact(dir, suffix, label, versioned = true, signatureRequired = true) {
  const candidates = filesWithSuffix(dir, suffix).filter((path) => !path.endsWith(`${suffix}.sig`));
  const artifact = candidates.find((path) => !versioned || basename(path).includes(manifest.version));
  if (!artifact) {
    fail(`${label} missing for desktop ${manifest.version}`);
    return undefined;
  }
  if (statSync(artifact).size === 0) {
    fail(`${label} is empty: ${artifact}`);
    return undefined;
  }
  ok(`${label} present (${basename(artifact)})`);

  if (!signatureRequired) return artifact;

  const signature = `${artifact}.sig`;
  if (!existsSync(signature)) {
    fail(`${label} updater signature missing: ${basename(signature)}`);
  } else {
    const value = readFileSync(signature, "utf8").trim();
    if (value.length <= 50) {
      fail(`${label} updater signature is suspiciously short`);
    } else {
      try {
        const keyId = verifyUpdaterArtifactSignature(artifact, signature, label);
        ok(`${label} updater signature cryptographically verified with configured key ${keyId}`);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    }
  }
  return artifact;
}

function sidecar(path, label = "packaged sidecar") {
  if (!executable(path, label)) return;
  if (!sidecarVersion) return fail("SIDECAR_VERSION missing/empty");
  try {
    smokeSidecar({ binary: path, expectedVersion: sidecarVersion, expectedTarget, label });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function commandFailure(result, includeStdout) {
  const output = [result.error?.message, result.stderr?.toString(), includeStdout ? result.stdout?.toString() : undefined]
    .filter(Boolean)
    .join("\n")
    .replaceAll(/\s+/g, " ")
    .trim();
  return output.slice(0, 800) || `exit status ${result.status ?? "unknown"}`;
}

function runExtractionTool(command, args, label, { cwd, input, binaryOutput = false, acceptedStatuses = [0] } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    input,
    encoding: binaryOutput ? null : "utf8",
    maxBuffer: EXTRACTION_BUFFER_BYTES,
    timeout: EXTRACTION_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error || !acceptedStatuses.includes(result.status)) {
    if (result.error?.code === "ENOENT") throw new Error(`${label}: required tool ${command} was not found on PATH`);
    throw new Error(`${label}: ${command} failed: ${commandFailure(result, !binaryOutput)}`);
  }
  return result.stdout;
}

function findFilesNamed(rootDir, wantedName) {
  const matches = [];
  const directories = [rootDir];
  const caseInsensitive = platform === "win32";
  const wanted = caseInsensitive ? wantedName.toLowerCase() : wantedName;

  while (directories.length > 0) {
    const directory = directories.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        directories.push(path);
      } else if (entry.isFile() && (caseInsensitive ? entry.name.toLowerCase() : entry.name) === wanted) {
        matches.push(path);
      }
    }
  }
  return matches.sort();
}

function extractPackage(artifact, kind, destination) {
  if (kind === "deb") {
    runExtractionTool("dpkg-deb", ["--extract", artifact, destination], "Debian package extraction");
  } else if (kind === "rpm") {
    // libarchive reads the RPM container directly and streams files to disk. This avoids buffering
    // an entire cpio payload in Node and works with payload/compression variants that older
    // rpm2cpio builds can reject without an actionable diagnostic.
    runExtractionTool(
      "bsdtar",
      ["--extract", "--file", artifact, "--directory", destination, "--no-same-owner", "--no-same-permissions"],
      "RPM package extraction",
    );
  } else if (kind === "msi") {
    runExtractionTool(
      "msiexec.exe",
      ["/a", artifact, "/qn", "/norestart", `TARGETDIR=${destination}`],
      "MSI administrative extraction",
      { acceptedStatuses: [0, 3010] },
    );
  } else if (kind === "nsis") {
    runExtractionTool("7z.exe", ["x", artifact, "-y", `-o${destination}`], "NSIS archive extraction");
  } else {
    throw new Error(`unsupported package extraction kind: ${kind}`);
  }
}

function smokeInstalledSidecars(artifact, kind, label, wantedName) {
  if (!artifact) return;
  const extractionRoot = mkdtempSync(join(tmpdir(), `hara-${kind}-smoke-`));
  try {
    extractPackage(artifact, kind, extractionRoot);
    const candidates = findFilesNamed(extractionRoot, wantedName);
    if (candidates.length === 0) {
      fail(`${label} does not contain ${wantedName}: ${basename(artifact)}`);
      return;
    }
    ok(`${label} extracted (${candidates.length} ${wantedName} candidate${candidates.length === 1 ? "" : "s"})`);
    for (const candidate of candidates) sidecar(candidate, `${label} sidecar`);
  } catch (error) {
    fail(`${label} smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(extractionRoot, { recursive: true, force: true });
  }
}

console.log(`package-smoke (${platform}, ${expectedTarget}, desktop ${manifest.version}, hara ${sidecarVersion || "<missing>"})`);
if (!existsSync(releaseBase)) fail(`release output missing: ${releaseBase}`);

if (platform === "darwin") {
  const app = join(releaseBase, "bundle", "macos", "Hara.app");
  const shell = join(app, "Contents", "MacOS", "hara-desktop");
  const bundledSidecar = join(app, "Contents", "MacOS", "hara");
  existsSync(app) ? ok("Hara.app present") : fail("Hara.app missing");
  executable(shell, "desktop shell");
  sidecar(bundledSidecar);
  const dmg = updaterArtifact(join(releaseBase, "bundle", "dmg"), ".dmg", "DMG", true, false);
  if (dmg) {
    try {
      smokeMacDmg({
        dmg,
        expectedTarget,
        requireSignatures: process.env.HARA_REQUIRE_MAC_SIGNATURES === "1",
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }
  const updaterArchive = updaterArtifact(
    join(releaseBase, "bundle", "macos"),
    ".app.tar.gz",
    "macOS updater archive",
    false,
  );
  if (updaterArchive) {
    try {
      smokeMacUpdaterArchive({
        archive: updaterArchive,
        expectedTarget,
        requireSignatures: process.env.HARA_REQUIRE_MAC_SIGNATURES === "1",
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }
} else if (platform === "linux") {
  const deb = updaterArtifact(join(releaseBase, "bundle", "deb"), ".deb", "Debian package");
  const rpm = updaterArtifact(join(releaseBase, "bundle", "rpm"), ".rpm", "RPM package");
  smokeInstalledSidecars(deb, "deb", "Debian package", "hara");
  smokeInstalledSidecars(rpm, "rpm", "RPM package", "hara");
} else if (platform === "win32") {
  const msi = updaterArtifact(join(releaseBase, "bundle", "msi"), ".msi", "MSI installer");
  const nsis = updaterArtifact(join(releaseBase, "bundle", "nsis"), "-setup.exe", "NSIS installer");
  smokeInstalledSidecars(msi, "msi", "MSI installer", "hara.exe");
  smokeInstalledSidecars(nsis, "nsis", "NSIS installer", "hara.exe");
} else {
  fail(`unsupported release platform: ${platform}`);
}

if (failures) {
  console.error(`package-smoke: ${failures} failure(s)`);
  process.exit(1);
}
console.log("package-smoke: all green");
