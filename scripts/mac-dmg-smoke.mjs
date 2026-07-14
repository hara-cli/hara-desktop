#!/usr/bin/env node
// Mount the DMG users actually download, then inspect and execute the app/sidecar from that mounted
// container. Checking only bundle/macos/Hara.app can miss a stale or malformed DMG assembled beside it.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { smokeSidecar } from "./sidecar-smoke.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const sidecarVersion = readFileSync(join(root, "src-tauri", "binaries", "SIDECAR_VERSION"), "utf8").trim();
const COMMAND_TIMEOUT_MS = 120_000;

function run(command, args, label) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: COMMAND_TIMEOUT_MS,
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

export function smokeMacDmg({ dmg, expectedTarget, requireSignatures = false }) {
  if (process.platform !== "darwin") throw new Error("DMG smoke requires a macOS host");
  const path = resolve(dmg);
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error(`DMG is missing or empty: ${path}`);
  }
  const expectedArch =
    expectedTarget === "aarch64-apple-darwin" ? "arm64" : expectedTarget === "x86_64-apple-darwin" ? "x86_64" : "";
  if (!expectedArch) throw new Error(`unsupported macOS DMG target: ${expectedTarget}`);

  const mountRoot = mkdtempSync(join(tmpdir(), "hara-dmg-smoke-"));
  const mountPoint = join(mountRoot, "mounted");
  mkdirSync(mountPoint, { mode: 0o700 });
  let attached = false;
  try {
    run(
      "/usr/bin/hdiutil",
      ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mountPoint, path],
      "DMG attach",
    );
    attached = true;

    const app = join(mountPoint, "Hara.app");
    const shell = join(app, "Contents", "MacOS", "hara-desktop");
    const sidecar = join(app, "Contents", "MacOS", "hara");
    if (!existsSync(app) || !statSync(app).isDirectory()) throw new Error("DMG does not contain Hara.app");
    requireExecutable(shell, "DMG desktop shell");
    requireExecutable(sidecar, "DMG sidecar");

    const shellArchs = run("/usr/bin/lipo", ["-archs", shell], "DMG shell architecture").trim().split(/\s+/);
    if (!shellArchs.includes(expectedArch)) {
      throw new Error(`DMG shell architecture mismatch: expected ${expectedArch}, got ${shellArchs.join(", ")}`);
    }
    smokeSidecar({ binary: sidecar, expectedVersion: sidecarVersion, expectedTarget, label: "DMG sidecar" });

    if (requireSignatures) {
      run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], "DMG app codesign");
      run("/usr/sbin/spctl", ["-a", "-vv", app], "DMG app Gatekeeper assessment");
      run("/usr/bin/xcrun", ["stapler", "validate", app], "DMG app notarization staple");
    }
    console.log(
      `  ✓ DMG mounted and bundled sidecar executed (${expectedTarget}${requireSignatures ? "; signed + notarized app" : ""})`,
    );
  } finally {
    if (attached) run("/usr/bin/hdiutil", ["detach", mountPoint, "-force"], "DMG detach");
    rmSync(mountRoot, { recursive: true, force: true });
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const [, , dmg, expectedTarget, flag] = process.argv;
  if (!dmg || !expectedTarget || (flag && flag !== "--require-signatures")) {
    console.error("usage: node scripts/mac-dmg-smoke.mjs <dmg> <target> [--require-signatures]");
    process.exit(2);
  }
  try {
    smokeMacDmg({ dmg, expectedTarget, requireSignatures: flag === "--require-signatures" });
  } catch (error) {
    console.error(`mac-dmg-smoke: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
