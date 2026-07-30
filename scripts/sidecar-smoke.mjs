#!/usr/bin/env node
// Native sidecar release gate shared by CI, local signed builds, and package-smoke.
// A target-specific binary must run on its native host; cross-target "built successfully" is not
// accepted as execution evidence.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const waitFor = async (condition, timeoutMs, message) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await condition();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(message);
};

const reservePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    server.close((error) => error ? reject(error) : resolvePort(port));
  });
});

const waitForChildExit = (processHandle, timeoutMs) => {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolveExit(true);
    };
    const timeout = setTimeout(() => {
      processHandle.off("exit", onExit);
      resolveExit(false);
    }, timeoutMs);
    processHandle.once("exit", onExit);
  });
};

const rpcCall = (socket, id, method, params, timeoutMs = 10_000) =>
  new Promise((resolveCall, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error(`${method} response timed out`));
    }, timeoutMs);
    const onMessage = (event) => {
      let message;
      try {
        message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      } catch {
        return;
      }
      if (message.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      resolveCall(message);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });

async function smokeServeCapabilities(binary, expectedVersion) {
  const home = process.env.HOME;
  if (!home) throw new Error("sidecar capability smoke requires an isolated HOME");
  const discoveryPath = join(home, ".hara", "serve.json");
  const port = await reservePort();
  const child = spawn(binary, [
    "serve",
    "--host", "127.0.0.1",
    "--port", String(port),
    "--cwd", process.cwd(),
    "--approval", "suggest",
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout = `${stdout}${String(chunk)}`.slice(-8_000);
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-8_000);
  });
  let socket;
  try {
    const record = await waitFor(() => {
      if (child.exitCode !== null) {
        throw new Error(`Serve exited ${child.exitCode}: ${(stderr || stdout).trim().slice(-2_000)}`);
      }
      if (!existsSync(discoveryPath)) return null;
      try {
        return JSON.parse(readFileSync(discoveryPath, "utf8"));
      } catch {
        return null;
      }
    }, 15_000, "Serve discovery timed out");
    if (
      record.version !== expectedVersion
      || record.port !== port
      || record.pid !== child.pid
      || typeof record.token !== "string"
      || record.token.length < 16
    ) throw new Error("Serve discovery identity did not match the sidecar process");

    socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolveOpen, reject) => {
      const timeout = setTimeout(() => reject(new Error("Serve WebSocket open timed out")), 10_000);
      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolveOpen();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("Serve WebSocket open failed"));
      }, { once: true });
    });
    const initialized = await rpcCall(socket, 1, "initialize", { token: record.token });
    if (initialized.error || initialized.result?.version !== expectedVersion) {
      throw new Error("Serve initialize failed");
    }
    const methods = new Set(initialized.result?.capabilities?.methods ?? []);
    const features = new Set(initialized.result?.capabilities?.features ?? []);
    for (const method of ["desk.connections.list", "desk.snapshot", "desk.task.get"]) {
      if (!methods.has(method)) throw new Error(`actual sidecar is missing ${method}`);
    }
    if (!features.has("collaboration.remote.v1")) {
      throw new Error("actual sidecar is missing collaboration.remote.v1");
    }
    const connections = await rpcCall(socket, 2, "desk.connections.list", {});
    if (
      connections.error
      || !Array.isArray(connections.result?.connections)
      || typeof connections.result?.legacyUnbound !== "boolean"
    ) throw new Error("actual sidecar Desk inventory RPC failed");
    const shutdown = await rpcCall(socket, 3, "server.shutdown", {});
    if (shutdown.error || shutdown.result?.accepted !== true) {
      throw new Error("actual sidecar authenticated shutdown failed");
    }
    await waitFor(
      () => child.exitCode !== null,
      10_000,
      "actual sidecar did not exit after authenticated shutdown",
    );
    if (child.exitCode !== 0) {
      throw new Error(`actual sidecar exited ${child.exitCode}: ${(stderr || stdout).trim().slice(-2_000)}`);
    }
    if (existsSync(discoveryPath)) throw new Error("actual sidecar left a stale Serve discovery file");
    console.log("✓ actual sidecar advertises and serves native organization Desk capabilities");
  } finally {
    try {
      socket?.close();
    } catch {
      // best effort
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      if (!(await waitForChildExit(child, 5_000))) {
        child.kill("SIGKILL");
        await waitForChildExit(child, 5_000);
      }
    }
  }
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

    let sessions;
    try {
      sessions = runSidecar(["sessions"], true, env);
    } catch (error) {
      throw new Error(`${label} sessions failed: ${shortError(error)}`);
    }
    if (!sessions.includes("No sessions yet.")) {
      throw new Error(`${label} sessions did not initialize an empty session index: ${sessions.trim() || "<empty>"}`);
    }
    if (existsSync(ambientPreloadMarker)) {
      throw new Error(`${label} executed cwd bunfig.toml preload during session index initialization`);
    }

    try {
      run(
        process.execPath,
        [fileURLToPath(import.meta.url), "--serve-capabilities", path, expectedVersion],
        true,
        env,
        smokeHome,
      );
    } catch (error) {
      throw new Error(`${label} native Desk capability smoke failed: ${shortError(error)}`);
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
    `  ✓ ${label} runs ${execution} (${expectedTarget}, hara ${version}; ambient config blocked; sessions; native Desk RPCs; SAB-disabled; --help; serve --help)`,
  );
  return version;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const [, , first, second, third] = process.argv;
  if (first === "--serve-capabilities") {
    if (!second || !third) {
      console.error("usage: node scripts/sidecar-smoke.mjs --serve-capabilities <binary> <expected-version>");
      process.exit(2);
    }
    try {
      await smokeServeCapabilities(resolve(second), third);
    } catch (error) {
      console.error(`sidecar capability smoke: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    process.exit(0);
  }
  const binary = first;
  const expectedVersion = second;
  const expectedTarget = third;
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
