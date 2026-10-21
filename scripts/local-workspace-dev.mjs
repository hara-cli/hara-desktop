#!/usr/bin/env node
// Explicit opt-in native lab. Real-key slice requires an explicit file reference; never a Key value.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LAB_IDENTIFIER = "com.nanhara.hara.workspace-lab";
export function parseOptions(args) {
  const options = { smoke: false };
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--smoke" && !options.smoke) options.smoke = true;
    else if (["--root", "--core", "--ark-key-file", "--ark-slice"].includes(key) && !options[key.slice(2)] && args[index + 1]) options[key.slice(2)] = args[++index];
    else throw new Error("Use --core ABSOLUTE_CORE_WORKTREE --root ABSOLUTE_PRIVATE_FIXTURE [--smoke] [--ark-key-file ABSOLUTE_PRIVATE_FILE]");
  }
  assert.ok(isAbsolute(options.root ?? "") && isAbsolute(options.core ?? ""), "Explicit absolute --core and --root are required");
  if (options["ark-key-file"]) assert.ok(isAbsolute(options["ark-key-file"]), "Key reference must be an absolute file path, never a Key value");
  if (options["ark-slice"]) assert.ok(options["ark-key-file"] && options["ark-slice"] === "context-trim-20261017", "Unknown or unapproved real-key slice");
  return options;
}
export function isolatedEnvironment(source, home, native = false) {
  const env = { PATH: `${dirname(process.execPath)}${delimiter}${source.PATH ?? ""}`, HOME: home, USERPROFILE: home,
    NO_COLOR: "1", HARA_UPDATE_CHECK: "0", CARGO_NET_OFFLINE: "true" };
  for (const key of ["TMPDIR", "LANG", "LC_ALL", "USER", "LOGNAME", "SHELL"]) if (source[key]) env[key] = source[key];
  if (native) {
    // Cargo needs its existing offline cache/toolchain; Hara's own native storage is explicit.
    env.HOME = source.HOME; env.USERPROFILE = source.HOME;
    env.HARA_DESKTOP_DEV_HOME = home; env.HARA_DESKTOP_WORKSPACE_DEV_ROOT = resolve(home, "..");
    env.VITE_HARA_WORKSPACE_DEV = "1";
    for (const key of ["RUSTUP_HOME", "CARGO_HOME", "SDKROOT", "DEVELOPER_DIR", "MACOSX_DEPLOYMENT_TARGET"]) if (source[key]) env[key] = source[key];
  }
  return env;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function checkout(directory, branch) {
  const git = args => { const out = spawnSync("git", ["-C", directory, ...args], { encoding: "utf8", timeout: 5000 }); assert.equal(out.status, 0, "Cannot verify candidate checkout"); return out.stdout.trim(); };
  assert.equal(git(["branch", "--show-current"]), branch, "Refusing an unrelated/shared checkout");
  assert.equal(git(["status", "--porcelain", "--untracked-files=no"]), "", "Commit this candidate's source before starting the native lab");
  return git(["rev-parse", "HEAD"]);
}
async function assertFree(port) {
  const server = createServer(); await new Promise((resolve, reject) => { server.once("error", () => reject(new Error(`Lab port ${port} is occupied; no process was stopped`))); server.listen(port, "127.0.0.1", resolve); });
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
async function authenticate(record, realKey) {
  const socket = new WebSocket(`ws://127.0.0.1:${record.port}`);
  try {
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Lab handshake timed out")), 10000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Lab socket unavailable")); }, { once: true }); });
    const initialized = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Lab authentication timed out")), 10000);
      socket.addEventListener("message", event => { const value = JSON.parse(String(event.data)); if (value.id !== 1) return;
        clearTimeout(timer); if (value.error) reject(new Error("Lab authentication rejected")); else resolve(value.result); }); });
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { token: record.token } }));
    const result = await initialized;
    assert.equal(result.syntheticOnly, !realKey); assert.ok(result.capabilities.includes("workspace.local-dev.v2"));
    if (realKey) { assert.equal(result.executionMode, "ark-real-key"); assert.ok(result.capabilities.includes("workspace.real-key-slice.v1")); }
    return result;
  } finally { socket.close(); }
}
export async function main(args) {
  assert.ok(Number(process.versions.node.split(".")[0]) >= 22, "Use the repository's modern Node, not the system Node");
  const options = parseOptions(args), desktop = realpathSync.native(fileURLToPath(new URL("../", import.meta.url))), core = realpathSync.native(options.core);
  const realKey = Boolean(options["ark-key-file"]), keyArgs = realKey ? ["--ark-key-file", options["ark-key-file"]] : [];
  if (options["ark-slice"]) keyArgs.push("--ark-slice", options["ark-slice"]);
  const root = realpathSync.native(options.root), info = lstatSync(root);
  assert.equal(root, options.root, "Use a canonical root, not a symlink alias");
  assert.ok(info.isDirectory() && !info.isSymbolicLink() && (process.platform === "win32" || (info.uid === process.getuid() && (info.mode & 0o077) === 0)), "Fixture root must be private/owned");
  const coreSha = checkout(core, "feat/local-workspace-dev-20261017"), desktopSha = checkout(desktop, "feat/local-workspace-shell-20261017");
  if (!options.smoke) { await assertFree(1437); await assertFree(1438); }
  const evidence = realpathSync.native(mkdtempSync(join(tmpdir(), "hara-workspace-lab-"))), scratchHome = join(evidence, "build-home");
  mkdirSync(scratchHome, { mode: 0o700 });
  const logs = [], log = name => { const fd = openSync(join(evidence, name), "wx", 0o600); logs.push(fd); return fd; };
  let serve, ui, stopping = false;
  const receipt = { schemaVersion: 1, root, core, desktop, coreSha, desktopSha, evidence, node: process.version,
    identifier: LAB_IDENTIFIER, syntheticOnly: !realKey, ...(realKey ? { budgetFile: join(root, ".hara/real-key-budget-v1.json"), slice: options["ark-slice"] ?? "original" } : { realModelCalls: 0 }), state: "starting" };
  const recordReceipt = () => writeFileSync(join(evidence, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  const stop = async () => {
    if (stopping) return; stopping = true;
    if (ui && ui.exitCode === null && ui.signalCode === null) {
      // Only the detached group created by this invocation, never port-derived/arbitrary processes.
      try { if (process.platform !== "win32") process.kill(-ui.pid, "SIGTERM"); else ui.kill("SIGTERM"); } catch {}
    }
    if (serve && serve.exitCode === null && serve.signalCode === null) {
      serve.kill("SIGTERM"); const until = Date.now() + 10000;
      while (serve.exitCode === null && serve.signalCode === null && Date.now() < until) await delay(50);
      if (serve.exitCode === null && serve.signalCode === null) { receipt.state = "drain-not-confirmed"; process.exitCode = 1; }
    }
    if (receipt.state !== "drain-not-confirmed") receipt.state = "stopped";
    receipt.stoppedAt = new Date().toISOString(); recordReceipt(); for (const fd of logs) closeSync(fd);
  };
  const onSignal = () => { void stop(); };
  process.once("SIGTERM", onSignal); process.once("SIGINT", onSignal);
  try {
    const buildLog = log("core-build.log");
    const build = spawnSync("npm", ["run", "build"], { cwd: core, env: isolatedEnvironment(process.env, scratchHome), stdio: ["ignore", buildLog, buildLog], timeout: 120000 });
    assert.equal(build.status, 0, "Candidate Core build failed; inspect private core-build.log");
    const entry = join(core, "dist/cli.js"); receipt.coreEntrySha256 = createHash("sha256").update(readFileSync(entry)).digest("hex");
    const home = join(root, "home"), env = isolatedEnvironment(process.env, home), engineLog = log("engine.log");
    const initialized = spawnSync(process.execPath, [entry, "workspace-dev", "init", "--root", root, ...keyArgs], { cwd: core, env, stdio: ["ignore", engineLog, engineLog], timeout: 15000 });
    assert.equal(initialized.status, 0, "Fixture initialization refused; existing files were not adopted");
    if (stopping) return;
    serve = spawn(process.execPath, [entry, "workspace-dev", "serve", "--root", root, "--port", "0", ...keyArgs], { cwd: core, env, stdio: ["ignore", engineLog, engineLog] });
    let startupError; serve.once("error", error => { startupError = error; });
    const discovery = join(home, ".hara/workspace-local-dev/serve-v2.json"), deadline = Date.now() + 20000;
    let record;
    while (!startupError && serve.exitCode === null && !stopping && Date.now() < deadline) {
      if (existsSync(discovery)) {
        const metadata = lstatSync(discovery);
        assert.ok(metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1 && (process.platform === "win32" || (metadata.uid === process.getuid() && (metadata.mode & 0o077) === 0)), "Unsafe private discovery");
        const candidate = JSON.parse(readFileSync(discovery, "utf8"));
        if (candidate.pid === serve.pid) { record = candidate; break; }
      }
      await delay(50);
    }
    if (stopping) return;
    assert.ok(record && !startupError, "Isolated Core did not become ready; inspect private engine.log");
    assert.equal(record.capability, "workspace.local-dev.v2"); assert.ok(/^[a-f0-9]{64}$/.test(record.token));
    await authenticate(record, realKey); if (stopping) return;
    receipt.enginePid = serve.pid; receipt.enginePort = record.port; receipt.state = "ready"; recordReceipt();
    console.log(JSON.stringify({ root, evidence, receipt: join(evidence, "receipt.json"), coreSha, desktopSha, syntheticOnly: !realKey,
      ...(realKey ? { budgetFile: receipt.budgetFile } : { realModelCalls: 0 }) }));
    if (options.smoke) return;
    const uiLog = log("desktop.log"), nativeEnv = isolatedEnvironment(process.env, home, true);
    nativeEnv.CARGO_TARGET_DIR = process.env.HARA_WORKSPACE_LAB_TARGET ?? join(evidence, "target");
    const config = { productName: "Hara Workspace Lab", identifier: LAB_IDENTIFIER,
      build: { devUrl: "http://127.0.0.1:1437" }, bundle: { active: false, externalBin: [] },
      app: { windows: [{ label: "main", create: false, title: "Hara Workspace Lab", width: 1180, height: 820, minWidth: 720, minHeight: 480 }] } };
    ui = spawn("npm", ["run", "tauri", "--", "dev", "--no-watch", "--config", JSON.stringify(config)],
      { cwd: desktop, env: nativeEnv, detached: process.platform !== "win32", stdio: ["ignore", uiLog, uiLog] });
    receipt.uiGroupPid = ui.pid; recordReceipt();
    await new Promise((resolve, reject) => { ui.once("error", () => reject(new Error("Native lab launch failed; inspect desktop.log")));
      ui.once("exit", code => code && !stopping ? reject(new Error("Native lab exited with errors; inspect desktop.log")) : resolve()); });
  } finally { await stop(); process.removeListener("SIGTERM", onSignal); process.removeListener("SIGINT", onSignal); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
