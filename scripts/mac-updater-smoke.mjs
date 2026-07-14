#!/usr/bin/env node
// Verify the application users actually receive through Tauri's macOS updater archive. CI executes
// each architecture natively; the controlled Apple Silicon release flow may explicitly use Rosetta
// for the already-native-CI-verified Intel archive.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { smokeSidecar } from "./sidecar-smoke.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const sidecarVersion = readFileSync(join(root, "src-tauri", "binaries", "SIDECAR_VERSION"), "utf8").trim();

function run(command, args, label) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      windowsHide: true,
    });
  } catch (error) {
    const detail = [error?.stderr?.toString(), error?.stdout?.toString(), error?.message]
      .filter(Boolean)
      .join(" ")
      .replaceAll(/\s+/g, " ")
      .slice(0, 1000);
    throw new Error(`${label} failed: ${detail || "unknown error"}`);
  }
}

function requireExecutable(path, label) {
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error(`${label} is missing or empty: ${path}`);
  }
  if ((statSync(path).mode & 0o111) === 0) throw new Error(`${label} is not executable: ${path}`);
}

export function smokeMacUpdaterArchive({ archive, expectedTarget, requireSignatures = false }) {
  if (process.platform !== "darwin") throw new Error("macOS updater archive smoke requires a macOS host");
  const path = resolve(archive);
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error(`macOS updater archive is missing or empty: ${path}`);
  }
  const expectedArch =
    expectedTarget === "aarch64-apple-darwin" ? "arm64" : expectedTarget === "x86_64-apple-darwin" ? "x86_64" : "";
  if (!expectedArch) throw new Error(`unsupported macOS updater target: ${expectedTarget}`);

  const extractionRoot = mkdtempSync(join(tmpdir(), "hara-mac-updater-smoke-"));
  try {
    run("/usr/bin/tar", ["-xzf", path, "-C", extractionRoot], "macOS updater archive extraction");
    const app = join(extractionRoot, "Hara.app");
    const shell = join(app, "Contents", "MacOS", "hara-desktop");
    const sidecar = join(app, "Contents", "MacOS", "hara");
    if (!existsSync(app) || !statSync(app).isDirectory()) throw new Error("updater archive does not contain Hara.app");
    requireExecutable(shell, "updater archive desktop shell");
    requireExecutable(sidecar, "updater archive sidecar");

    const shellArchs = run("/usr/bin/lipo", ["-archs", shell], "updater archive shell architecture").trim().split(/\s+/);
    if (!shellArchs.includes(expectedArch)) {
      throw new Error(`updater archive shell architecture mismatch: expected ${expectedArch}, got ${shellArchs.join(", ")}`);
    }
    smokeSidecar({
      binary: sidecar,
      expectedVersion: sidecarVersion,
      expectedTarget,
      label: "updater archive sidecar",
    });

    if (requireSignatures) {
      run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], "updater archive codesign");
      run("/usr/sbin/spctl", ["-a", "-vv", app], "updater archive Gatekeeper assessment");
      run("/usr/bin/xcrun", ["stapler", "validate", app], "updater archive notarization staple");
    }
    console.log(
      `  ✓ macOS updater archive extracted and executed (${expectedTarget}${requireSignatures ? "; signed + notarized" : ""})`,
    );
  } finally {
    rmSync(extractionRoot, { recursive: true, force: true });
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const [, , archive, expectedTarget, flag] = process.argv;
  if (!archive || !expectedTarget || (flag && flag !== "--require-signatures")) {
    console.error("usage: node scripts/mac-updater-smoke.mjs <archive> <target> [--require-signatures]");
    process.exit(2);
  }
  try {
    smokeMacUpdaterArchive({ archive, expectedTarget, requireSignatures: flag === "--require-signatures" });
  } catch (error) {
    console.error(`mac-updater-smoke: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
