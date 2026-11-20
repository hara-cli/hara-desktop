// Hosted Windows only. Exercise the actual installer, its Desktop, and its adjacent Workspace Core.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { binarySHA, readWindowsVaultBinding, verifyWindowsVaultSidecar, windowsVaultRequired } from "./windows-vault-bundle.mjs";

class SmokeError extends Error {}
const check = (condition, message) => { if (!condition) throw new SmokeError(message); };
const model = "hara-vault-smoke-model";
const origin = "127.0.0.1";

function command(name, args, { windowsVerbatimArguments = false, accepted = [0] } = {}) {
  const result = spawnSync(name, args, { encoding: "utf8", timeout: 300_000, windowsHide: true,
    ...(windowsVerbatimArguments ? { windowsVerbatimArguments: true, argv0: `"${name}"` } : {}) });
  check(!result.error && accepted.includes(result.status), `Installer or process check failed (${result.status ?? "no exit status"})`);
  return result.stdout;
}

function installer(release, kind) {
  const dir = join(release, "bundle", kind);
  const files = readdirSync(dir).filter(name => name.endsWith(kind === "msi" ? ".msi" : "-setup.exe"));
  check(files.length === 1, `Expected exactly one ${kind} installer`);
  return join(dir, files[0]);
}

function install(artifact, kind, dest) {
  check(!existsSync(dest), "Refusing to install into an existing location");
  if (kind === "msi") {
    command("msiexec.exe", ["/i", artifact, "/qn", "/norestart", `INSTALLDIR=${dest}`], { accepted: [0, 3010] });
    return () => command("msiexec.exe", ["/x", artifact, "/qn", "/norestart"], { accepted: [0, 3010] });
  }
  // NSIS requires the /D argument to be last and its path unquoted, including any spaces.
  command(artifact, ["/S", `/D=${dest}`], { windowsVerbatimArguments: true });
  return () => {
    const uninstaller = join(dest, "uninstall.exe");
    check(existsSync(uninstaller), "Installed NSIS uninstaller missing");
    command(uninstaller, ["/S"]);
  };
}

function checkCoreChild(record, desktop, sidecar) {
  check(Number.isSafeInteger(record.pid) && record.pid > 1, "Discovery did not contain a valid Core PID");
  const row = JSON.parse(command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `Get-CimInstance Win32_Process -Filter 'ProcessId = ${record.pid}' | Select-Object ProcessId,ParentProcessId,ExecutablePath | ConvertTo-Json -Compress`]));
  check(row?.ProcessId === record.pid && row.ParentProcessId === desktop.pid && row.ExecutablePath
    && realpathSync.native(row.ExecutablePath).toLowerCase() === realpathSync.native(sidecar).toLowerCase(),
  "The discovered Core is not the installed Desktop's adjacent child");
}

async function start(root, home, { previousInstance, direct = false } = {}) {
  const workspaceRoot = join(home, ".hara", "workspaces-v1"), core = join(root, "hara.exe");
  if (direct) mkdirSync(workspaceRoot, { recursive: true });
  // Start the copied CLI with a small environment so the Desktop marker cannot be inherited.
  const env = direct
    ? { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, HOME: home, USERPROFILE: home,
        HARA_WORKSPACE_HOST_HOME: home, HARA_WORKSPACE_DISCOVERY_HOME: home, HARA_WORKSPACE_LEGACY_SOURCE_HOME: home,
        HARA_CLIENT_LOCALE: "en", HARA_UPDATE_CHECK: "0" }
    : { ...process.env, HOME: home, USERPROFILE: home, WEBVIEW2_USER_DATA_FOLDER: join(home, "webview") };
  const args = direct ? ["workspace", "serve", "--root", workspaceRoot, "--port", "0"] : [];
  const child = spawn(direct ? core : join(root, "hara-desktop.exe"), args, { windowsHide: true, stdio: "ignore", env });
  let launchError = false, ownedCore = null;
  child.once("error", () => { launchError = true; });
  const stop = async () => {
    const childRunning = () => !!child.pid && child.exitCode === null && child.signalCode === null;
    const coreRunning = () => {
      if (!ownedCore) return false;
      try { process.kill(ownedCore.pid, 0); return true; }
      catch (error) { if (error.code === "ESRCH") return false; throw error; }
    };
    if (childRunning()) command("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"]);
    else if (coreRunning()) {
      checkCoreChild(ownedCore, child, core);
      command("taskkill.exe", ["/PID", String(ownedCore.pid), "/T", "/F"]);
    }
    for (let i = 0; i < 50 && (childRunning() || coreRunning()); i++) await wait(100);
    check(!childRunning() && !coreRunning(), "Smoke Workspace process tree did not stop");
  };
  const deadline = Date.now() + 180_000;
  const discovery = join(workspaceRoot, "home", ".hara", "workspace-runtime", "serve-v2.json");
  try {
    while (Date.now() < deadline && !launchError && child.exitCode === null && child.signalCode === null) {
      let record = null;
      try { record = JSON.parse(readFileSync(discovery, "utf8")); } catch { /* File not yet published. */ }
      if (record && record.instanceId !== previousInstance) {
        check(record.schemaVersion === 2 && record.executionMode === "workspace" && typeof record.instanceId === "string"
          && /^[a-f0-9]{64}$/u.test(record.token) && Number.isSafeInteger(record.port) && record.port > 0 && record.port < 65536,
        "Invalid Workspace discovery");
        if (direct) check(record.pid === child.pid, "Discovery PID did not match the directly launched Core");
        else {
          checkCoreChild(record, child, core);
          ownedCore = record;
        }
        return { record, stop };
      }
      await wait(400);
    }
    throw new SmokeError("Installed Workspace engine did not publish discovery");
  } catch (error) {
    await stop();
    throw error;
  }
}

async function withWorkspace(record, action, backend = "windows-dpapi") {
  const socket = new WebSocket(`ws://${origin}:${record.port}`);
  let id = 0;
  try {
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        socket.removeEventListener("open", opened);
        socket.removeEventListener("error", failed);
        socket.removeEventListener("close", failed);
        if (error) reject(error); else resolve();
      };
      const opened = () => finish();
      const failed = () => finish(new SmokeError("Installed Core WebSocket could not connect"));
      const timer = setTimeout(failed, 8000);
      socket.addEventListener("open", opened);
      socket.addEventListener("error", failed);
      socket.addEventListener("close", failed);
    });
    const rpc = (method, params = {}, expectedVaultError) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const finish = (error, result) => {
        clearTimeout(timer);
        socket.removeEventListener("message", receive);
        socket.removeEventListener("close", failed);
        socket.removeEventListener("error", failed);
        if (error) reject(error); else resolve(result);
      };
      const receive = event => {
        let response;
        try { response = JSON.parse(String(event.data)); } catch { return; }
        if (response.id !== requestId) return;
        if (expectedVaultError) {
          const error = response.error;
          if (error?.data?.domain !== "credential-vault" || error.data.code !== expectedVaultError) return failed();
          if (expectedVaultError === "unsupported" &&
              (error.data.retry !== "none" || typeof error.message !== "string" || !error.message.includes("Hara Desktop"))) return failed();
          finish(null, true);
        } else if (response.error || !Object.hasOwn(response, "result")) failed();
        else finish(null, response.result);
      };
      const failed = () => finish(new SmokeError(`Installed Core did not return the expected result for ${method}`));
      const timer = setTimeout(failed, 35_000);
      socket.addEventListener("message", receive);
      socket.addEventListener("close", failed);
      socket.addEventListener("error", failed);
      try { socket.send(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })); } catch { failed(); }
    });
    const init = await rpc("initialize", { token: record.token });
    check(init.capabilities?.includes("workspace.v1") && init.capabilities.includes("workspace.credential-storage.v1")
      && init.credentialStorage?.backend === backend, "Core did not advertise the expected credential backend");
    const workspaceId = init.workspace?.activeWorkspaceId ?? init.workspace?.workspaces?.[0]?.workspaceId;
    check(typeof workspaceId === "string", "Installed Core has no smoke Workspace");
    return await action(rpc, () => rpc("workspace.snapshot", { workspaceId, agentId: null }));
  } finally { socket.close(); }
}

function scope(view) {
  return { workspaceId: view.workspaceId, expectedGeneration: view.resourceGeneration };
}

function savedConnection(view, id) {
  const row = view.connections.connections.find(connection => id ? connection.id === id : connection.label === "Windows smoke");
  check(row?.keySaved === true && row.keyState === "saved" && typeof row.credentialGeneration === "string",
    "Installed Core did not report a saved credential");
  return row;
}

async function credentials(root, home) {
  const keys = [randomBytes(24).toString("hex"), randomBytes(24).toString("hex")];
  let expected = null, seen = 0, unexpected = 0;
  const server = createServer((req, res) => {
    if (!expected || req.method !== "GET" || req.url !== "/v1/models" || req.headers.authorization !== `Bearer ${expected}`) {
      unexpected++;
      res.writeHead(403).end();
      return;
    }
    seen++;
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data: [{ id: model }] }));
  });
  const listening = once(server, "listening");
  server.listen(0, origin);
  await listening;
  const input = apiKey => ({ label: "Windows smoke", provider: "openai", baseURL: `http://${origin}:${server.address().port}/v1`, defaultModel: model, apiKey });
  async function verifyRead(rpc, view, row, key) {
    const before = seen;
    expected = key;
    try {
      const catalog = await rpc("workspace.connection.listModels", { ...scope(view), agentId: view.selectedAgentId, connectionId: row.id });
      check(seen === before + 1 && unexpected === 0 && catalog.source === "live" && catalog.models.some(item => item.id === model),
        "Installed Core did not return the expected loopback readback");
    } finally { expected = null; }
  }

  try {
    const first = await start(root, home);
    let saved;
    try {
      saved = await withWorkspace(first.record, async (rpc, snapshot) => {
        const before = await snapshot();
        await rpc("workspace.connection.add", { ...scope(before), expectedRevision: before.connections.revision, input: input(keys[0]) });
        const after = await snapshot();
        const row = savedConnection(after);
        check(after.connections.revision > before.connections.revision, "Add did not advance connection revision");
        return row;
      });
    } finally { await first.stop(); }
    const second = await start(root, home, { previousInstance: first.record.instanceId });
    try {
      return await withWorkspace(second.record, async (rpc, snapshot) => {
        const reopened = await snapshot();
        const original = savedConnection(reopened, saved.id);
        check(original.credentialGeneration === saved.credentialGeneration && original.revision === saved.revision,
          "Restart did not preserve the saved connection");
        await verifyRead(rpc, reopened, original, keys[0]);
        await rpc("workspace.connection.edit", { ...scope(reopened), connectionId: saved.id, expectedRevision: reopened.connections.revision, input: input(keys[1]) });
        const updated = await snapshot();
        const rotated = savedConnection(updated, saved.id);
        check(updated.connections.revision > reopened.connections.revision && rotated.credentialGeneration !== original.credentialGeneration,
          "Edit did not rotate the credential and advance the revision");
        await verifyRead(rpc, updated, rotated, keys[1]);
        await rpc("workspace.connection.delete", { ...scope(updated), connectionId: rotated.id, expectedRevision: updated.connections.revision, approved: true });
        return { keySaved: true, restartReadback: true, rotationReadback: true, addedRevision: reopened.connections.revision,
          rotatedRevision: updated.connections.revision, loopbackCatalogRequests: seen, loopbackUnexpected: unexpected };
      });
    } finally { await second.stop(); }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function verifyCredentialRefusal(installed, profile, reason, binding) {
  const direct = reason === "windows_desktop_required";
  const code = direct ? "unsupported" : "unavailable";
  const testRoot = join(profile, reason), launcher = join(testRoot, "app"), home = join(testRoot, "home");
  mkdirSync(launcher, { recursive: true });
  mkdirSync(home);
  // Use private copies of the installed executables. The installer and installed files stay untouched.
  const binaries = direct ? ["hara.exe", "hara-credential-worker.exe"] : ["hara-desktop.exe", "hara.exe", "herdr.exe"];
  for (const binary of binaries) copyFileSync(join(installed, binary), join(launcher, binary));
  if (direct) verifyWindowsVaultSidecar(join(launcher, "hara.exe"), binding);
  if (reason === "helper_invalid") {
    const worker = join(launcher, "hara-credential-worker.exe");
    copyFileSync(join(process.env.RUNNER_TEMP, "hara-vault-unbound-worker", "hara-credential-worker.exe"), worker);
    check(binarySHA(worker) !== binding.expectedWorkerSHA256, "Wrong-digest worker fixture did not change bytes");
    command(worker, [], { accepted: [65] }); // Valid worker executable takes the empty-stdin exit.
  }
  const localAppData = command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "[Environment]::GetFolderPath('LocalApplicationData')"]).trim();
  const namespace = createHash("sha256").update("hara-host-home-v1\0")
    .update(realpathSync.native(home).replaceAll("/", "\\")).digest("hex");
  check(/^[a-z]:\\/iu.test(localAppData), "Cannot determine hosted DPAPI storage location");
  const vaultHome = join(localAppData, "Hara", "credential-vault", "v1", namespace);
  check(!existsSync(vaultHome), "Negative fixture vault namespace already exists");

  const host = await start(launcher, home, { direct });
  try {
    return await withWorkspace(host.record, async (rpc, snapshot) => {
      const before = await snapshot();
      await rpc("workspace.connection.add", { ...scope(before), expectedRevision: before.connections.revision,
        input: { label: "Windows negative smoke", provider: "openai", baseURL: "http://127.0.0.1:1/v1",
          defaultModel: model, apiKey: randomBytes(24).toString("hex") } }, code);
      const after = await snapshot(), status = await rpc("workspace.credentialStorage.get");
      check(status.state === code && status.reason === reason && status.supported === !direct,
        "Windows credential refusal did not report the expected status");
      check(after.connections.revision === before.connections.revision
        && after.connections.connections.length === before.connections.connections.length && !existsSync(vaultHome),
      "Refused credential operation changed the connection store or the vault");
      return { code, reason, configured: false, writes: 0 };
    }, direct ? "none" : "windows-dpapi");
  } finally { await host.stop(); }
}

async function main([releaseBase, output, mode]) {
  check(process.platform === "win32" && process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted"
    && process.env.RUNNER_TEMP && process.env.USERPROFILE, "GitHub-hosted Windows runner only");
  check(releaseBase && output && (mode === undefined || mode === "--release-only"), "Invalid Windows install smoke arguments");
  const required = windowsVaultRequired();
  if (!required && mode === "--release-only") return;
  const receipt = required ? readWindowsVaultBinding() : null;
  const profile = mkdtempSync(join(process.env.USERPROFILE, "hara-install-smoke-"));
  mkdirSync(output, { recursive: true });
  const results = [], refusals = [];
  for (const kind of required ? ["nsis", "msi"] : ["nsis"]) {
    const artifact = installer(resolve(releaseBase), kind);
    const root = join(profile, `installed-${kind}`), home = join(profile, `home-${kind}`);
    mkdirSync(home);
    const uninstall = install(artifact, kind, root);
    console.log(`Verifying installed ${kind} Desktop and Core`);
    try {
      check(existsSync(join(root, "hara-desktop.exe")) && existsSync(join(root, "hara.exe")), "Installed Desktop or Core missing");
      if (receipt) {
        const workerSHA256 = verifyWindowsVaultSidecar(join(root, "hara.exe"), receipt);
        results.push({ kind, installerSHA256: binarySHA(artifact), expectedWorkerSHA256: receipt.expectedWorkerSHA256,
          workerSHA256, ...await credentials(root, home) });
        if (kind === "nsis" && mode !== "--release-only") {
          for (const reason of ["helper_invalid", "helper_missing", "windows_desktop_required"])
            refusals.push(await verifyCredentialRefusal(root, profile, reason, receipt));
        }
      } else {
        const app = await start(root, home);
        await app.stop();
        results.push({ kind, workspaceStarted: true });
      }
    } finally { uninstall(); }
  }
  // prepackage may check out a commit different from GITHUB_SHA.
  const desktopCommit = command("git", ["rev-parse", "HEAD"]).trim();
  check(/^[a-f0-9]{40}$/u.test(desktopCommit), "Installed smoke requires a known Desktop commit");
  const result = { schemaVersion: 1, desktopCommit, coreCommit: receipt?.coreCommit ?? null, results, refusals };
  writeFileSync(join(output, "windows-install-smoke.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
}
await main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof SmokeError ? `windows-install-smoke: ${error.message}` : "windows-install-smoke: unexpected installer or fixture failure");
  process.exitCode = 1;
});
