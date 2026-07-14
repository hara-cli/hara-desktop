#!/usr/bin/env node
// Native sidecar release gate shared by CI, local signed builds, and package-smoke.
// A target-specific binary must run on its native host; cross-target "built successfully" is not
// accepted as execution evidence.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const COMMAND_TIMEOUT_MS = 30_000;

export function nativeTarget() {
  if (process.platform === "darwin") {
    if (process.arch === "arm64") return "aarch64-apple-darwin";
    if (process.arch === "x64") return "x86_64-apple-darwin";
  }
  if (process.platform === "win32" && process.arch === "x64") return "x86_64-pc-windows-msvc";
  if (process.platform === "linux") {
    if (process.arch === "arm64") return "aarch64-unknown-linux-gnu";
    if (process.arch === "x64") return "x86_64-unknown-linux-gnu";
  }
  return `${process.platform}-${process.arch}`;
}

export function canUseRosettaSmoke({
  env = process.env,
  host = nativeTarget(),
  expectedTarget,
  ci = /^(?:1|true)$/i.test(env.CI || "") || /^(?:1|true)$/i.test(env.GITHUB_ACTIONS || ""),
} = {}) {
  if (
    env.HARA_ALLOW_ROSETTA_SMOKE !== "1" ||
    host !== "aarch64-apple-darwin" ||
    expectedTarget !== "x86_64-apple-darwin"
  ) {
    return false;
  }
  if (!ci) return true;

  const tag = env.GITHUB_REF_NAME || "";
  const runId = env.GITHUB_RUN_ID || "";
  const sha = env.GITHUB_SHA || "";
  return (
    /^(?:1|true)$/i.test(env.GITHUB_ACTIONS || "") &&
    env.GITHUB_REPOSITORY === "hara-cli/hara-desktop" &&
    env.GITHUB_EVENT_NAME === "push" &&
    env.GITHUB_REF_TYPE === "tag" &&
    /^(?:1|true)$/i.test(env.GITHUB_REF_PROTECTED || "") &&
    /^v\d+\.\d+\.\d+$/.test(tag) &&
    /^[0-9a-f]{40}$/i.test(sha) &&
    env.GITHUB_WORKFLOW_SHA === sha &&
    env.GITHUB_WORKFLOW_REF === `hara-cli/hara-desktop/.github/workflows/build.yml@refs/tags/${tag}` &&
    runId.length > 0 &&
    env.HARA_PROTECTED_SIGNING_JOB === runId
  );
}

function shortError(error) {
  const pieces = [error?.message, error?.stderr?.toString(), error?.stdout?.toString()].filter(Boolean);
  return pieces.join("\n").replaceAll(/\s+/g, " ").slice(0, 800);
}

function run(binary, args, capture = false, env = process.env, cwd) {
  return execFileSync(binary, args, {
    cwd,
    encoding: "utf8",
    env,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "ignore",
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
}

function assertMacArchitecture(binary, target) {
  if (process.platform !== "darwin") return;
  const required = target === "aarch64-apple-darwin" ? "arm64" : target === "x86_64-apple-darwin" ? "x86_64" : "";
  if (!required) return;
  const architectures = run("/usr/bin/lipo", ["-archs", binary], true).trim().split(/\s+/);
  if (!architectures.includes(required)) {
    throw new Error(`sidecar architecture mismatch: expected ${required}, found ${architectures.join(", ") || "unknown"}`);
  }
}

export function smokeSidecar({ binary, expectedVersion, expectedTarget = nativeTarget(), label = "sidecar" }) {
  const path = resolve(binary);
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  const stat = statSync(path);
  if (!stat.isFile() || stat.size === 0) throw new Error(`${label} is not a non-empty file: ${path}`);
  if (process.platform !== "win32" && (stat.mode & 0o111) === 0) throw new Error(`${label} is not executable: ${path}`);

  const host = nativeTarget();
  const ci = /^(?:1|true)$/i.test(process.env.CI || "") || /^(?:1|true)$/i.test(process.env.GITHUB_ACTIONS || "");
  const translated = canUseRosettaSmoke({ env: process.env, host, expectedTarget, ci });
  if (expectedTarget && expectedTarget !== host && !translated) {
    throw new Error(`cannot validate ${label} for ${expectedTarget} on ${host}; use a native runner for this release target`);
  }
  assertMacArchitecture(path, expectedTarget);
  if (translated) {
    try {
      run("/usr/bin/arch", ["-x86_64", "/usr/bin/true"]);
    } catch (error) {
      throw new Error(`${label} requires Rosetta 2 to execute ${expectedTarget}: ${shortError(error)}`);
    }
  }

  const smokeHome = mkdtempSync(join(tmpdir(), "hara-sidecar-smoke-"));
  const runSidecar = (args, capture, env) =>
    translated
      ? run("/usr/bin/arch", ["-x86_64", path, ...args], capture, env, smokeHome)
      : run(path, args, capture, env, smokeHome);
  const env = {
    ...process.env,
    HOME: smokeHome,
    USERPROFILE: smokeHome,
    XDG_CONFIG_HOME: smokeHome,
    APPDATA: smokeHome,
    LOCALAPPDATA: smokeHome,
    NO_COLOR: "1",
  };
  for (const key of Object.keys(env)) {
    if (
      ["BUN_OPTIONS", "NODE_OPTIONS", "DOTENV_CONFIG_PATH"].includes(key) ||
      /^HARA_/i.test(key) ||
      /(?:^|_)(?:API_KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|CREDENTIALS?|PRIVATE_KEY)(?:$|_)/i.test(key)
    ) {
      delete env[key];
    }
  }
  env.HARA_UPDATE_CHECK = "0";

  // A Desktop sidecar is a Bun standalone and must not execute or import configuration from the
  // project directory before Hara's own permission boundary starts. Keep this fixture in the same
  // cwd used by every probe so normal, signed, and installer-extracted sidecars all exercise it.
  const ambientPreloadMarker = join(smokeHome, "AMBIENT_PRELOAD_EXECUTED");
  const ambientModelMarker = "HARA_DESKTOP_DOTENV_MUST_NOT_LOAD";
  writeFileSync(join(smokeHome, ".env"), `HARA_MODEL=${ambientModelMarker}\n`, { mode: 0o600 });
  writeFileSync(join(smokeHome, "bunfig.toml"), 'preload = ["./ambient-preload.cjs"]\n', { mode: 0o600 });
  writeFileSync(
    join(smokeHome, "ambient-preload.cjs"),
    [
      'const { writeFileSync } = require("node:fs");',
      `writeFileSync(${JSON.stringify(ambientPreloadMarker)}, "executed\\n", { mode: 0o600 });`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  let version;
  try {
    try {
      version = runSidecar(["--version"], true, env).trim();
    } catch (error) {
      throw new Error(`${label} --version failed: ${shortError(error)}`);
    }
    if (version !== expectedVersion) {
      throw new Error(`${label} version mismatch: expected ${expectedVersion}, got ${version || "<empty>"}`);
    }
    if (existsSync(ambientPreloadMarker)) {
      throw new Error(`${label} executed cwd bunfig.toml preload before Hara startup`);
    }

    let doctor;
    try {
      doctor = runSidecar(["doctor"], true, env);
    } catch (error) {
      throw new Error(`${label} doctor failed: ${shortError(error)}`);
    }
    if (doctor.includes(ambientModelMarker)) {
      throw new Error(`${label} loaded cwd .env before Hara startup`);
    }
    if (existsSync(ambientPreloadMarker)) {
      throw new Error(`${label} executed cwd bunfig.toml preload during Hara startup`);
    }

    // v0.122.2 only crashed on Bun hosts where SAB was unavailable. Recreate that runtime boundary
    // before the compiled entrypoint loads so a normal-host smoke cannot hide the regression.
    const noSabPreload = join(smokeHome, "without-shared-array-buffer.cjs");
    const noSabMarker = join(smokeHome, "without-shared-array-buffer.marker");
    writeFileSync(
      noSabPreload,
      [
        'const { writeFileSync } = require("node:fs");',
        'Object.defineProperty(globalThis, "SharedArrayBuffer", { value: undefined, configurable: true });',
        `writeFileSync(${JSON.stringify(noSabMarker)}, typeof globalThis.SharedArrayBuffer, { mode: 0o600 });`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    const noSabEnv = { ...env, BUN_OPTIONS: `--preload=${noSabPreload}` };
    let noSabVersion;
    try {
      noSabVersion = runSidecar(["--version"], true, noSabEnv).trim();
    } catch (error) {
      throw new Error(`${label} --version without SharedArrayBuffer failed: ${shortError(error)}`);
    }
    if (!existsSync(noSabMarker)) {
      throw new Error(`${label} SAB-disabled preload did not execute (marker was not written)`);
    }
    const noSabState = readFileSync(noSabMarker, "utf8");
    if (noSabState !== "undefined") {
      throw new Error(`${label} SAB-disabled preload was ineffective: SharedArrayBuffer was ${noSabState || "<empty>"}`);
    }
    if (noSabVersion !== expectedVersion) {
      throw new Error(`${label} SAB-disabled version mismatch: expected ${expectedVersion}, got ${noSabVersion || "<empty>"}`);
    }

    for (const args of [["--help"], ["serve", "--help"]]) {
      try {
        runSidecar(args, false, env);
      } catch (error) {
        throw new Error(`${label} ${args.join(" ")} failed: ${shortError(error)}`);
      }
    }
  } finally {
    rmSync(smokeHome, { recursive: true, force: true });
  }

  const execution = translated ? "translated via Rosetta on Apple Silicon" : "natively";
  console.log(
    `  ✓ ${label} runs ${execution} (${expectedTarget}, hara ${version}; ambient config blocked; SAB-disabled; --help; serve --help)`,
  );
  return version;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const [, , binary, expectedVersion, expectedTarget] = process.argv;
  if (!binary || !expectedVersion) {
    console.error("usage: node scripts/sidecar-smoke.mjs <binary> <expected-version> [expected-target]");
    process.exit(2);
  }
  try {
    smokeSidecar({ binary, expectedVersion, expectedTarget: expectedTarget || nativeTarget() });
  } catch (error) {
    console.error(`sidecar-smoke: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
