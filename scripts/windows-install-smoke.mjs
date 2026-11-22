// Hosted Windows only. Exercise the actual installer, its Desktop, and its adjacent Workspace Core.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { binarySHA, readWindowsVaultBinding, verifyWindowsVaultSidecar, windowsVaultRequired } from "./windows-vault-bundle.mjs";
import { assertMsiRegistrationClear, assertNoLegacyMsi, installedBinaries, installNsis, windowsSmokeInstallers,
  withMsiInstallation } from "./windows-install-layout.mjs";
import { SmokeProcessError, observeCoreExit, observeCoreIdentity, sameCoreDiscovery, smokeRuntime, verifyIdentity } from "./windows-install-process.mjs";
import { SmokeError, check, origin, withWorkspace } from "./windows-install-workspace.mjs";

const model = "hara-vault-smoke-model";

function installer(release, kind) {
  const dir = join(release, "bundle", kind);
  const files = readdirSync(dir).filter(name => name.endsWith(kind === "msi" ? ".msi" : "-setup.exe"));
  check(files.length === 1, `Expected exactly one ${kind} installer`);
  return join(dir, files[0]);
}

async function identify(runtime, kind, pid, options = {}) {
  check(Number.isSafeInteger(pid) && pid > 1, "Invalid smoke process ID");
  const { stdout } = await runtime.command(kind, "process.identify", "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($null -eq $p) { 'null' } else { $p | Select-Object ProcessId,ParentProcessId,ExecutablePath,@{Name='Started';Expression={$_.CreationDate.ToUniversalTime().Ticks.ToString()}} | ConvertTo-Json -Compress }`],
  { ...options, capture: true });
  const row = JSON.parse(stdout);
  if (row === null) return null;
  check(row?.ProcessId === pid && typeof row.ExecutablePath === "string" && /^\d+$/u.test(row.Started), "Invalid smoke process identity");
  return row;
}

function readDiscovery(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

async function start(runtime, kind, root, home, { previousInstance, direct = false } = {}) {
  const workspaceRoot = join(home, ".hara", "workspaces-v1"), core = join(root, "hara.exe");
  const executable = direct ? core : join(root, "hara-desktop.exe");
  if (direct) mkdirSync(workspaceRoot, { recursive: true });
  const env = direct
    ? { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, HOME: home, USERPROFILE: home,
        HARA_WORKSPACE_HOST_HOME: home, HARA_WORKSPACE_DISCOVERY_HOME: home, HARA_WORKSPACE_LEGACY_SOURCE_HOME: home,
        HARA_CLIENT_LOCALE: "en", HARA_UPDATE_CHECK: "0" }
    : { ...process.env, HOME: home, USERPROFILE: home, WEBVIEW2_USER_DATA_FOLDER: join(home, "webview") };
  const args = direct ? ["workspace", "serve", "--root", workspaceRoot, "--port", "0"] : [];
  let child, launchError = false, owner, ownedCore, unseenCore, firstUnseenCore;
  const reportCoreExit = (sample, record) => {
    const observation = observeCoreExit(home, record.pid);
    try {
      writeSync(process.stdout.fd, JSON.stringify({ stage: "core.exit_probe", installerKind: kind, sample,
        sameGenerationAsFirstUnseen: sameCoreDiscovery(firstUnseenCore, record), ...observation }) + "\n");
    } catch { /* Diagnostic output cannot change ownership, credential or cleanup gates. */ }
  };
  const running = () => child?.pid && child.exitCode === null && child.signalCode === null;
  const stop = async () => {
    if (!child?.pid) return;
    try {
      await runtime.phase(kind, "desktop.stop", async () => {
        const options = { cleanup: true };
        const stopTree = pid => runtime.command(kind, "process.stop", "taskkill.exe", ["/PID", String(pid), "/T", "/F"], options);
        const target = await identify(runtime, kind, child.pid, options);
        if (target) {
          check(owner, "exit_unconfirmed");
          verifyIdentity(target, executable, owner.Started);
          await stopTree(child.pid);
        } else if (ownedCore) {
          const current = await identify(runtime, kind, ownedCore.ProcessId, options);
          if (current) {
            verifyIdentity(current, core, ownedCore.Started);
            check(current.ParentProcessId === child.pid, "Smoke Core ownership changed");
            await stopTree(current.ProcessId);
          }
        }
        const exitsBy = performance.now() + Math.min(5000, runtime.remaining(options));
        while (running() && performance.now() < exitsBy) await wait(50);
        // An early Desktop exit can leave a Core that never published discovery.
        if (running() || (!direct && !ownedCore)) throw new SmokeProcessError("exit_unconfirmed");
        if (ownedCore && await identify(runtime, kind, ownedCore.ProcessId, options)) {
          throw new SmokeProcessError("exit_unconfirmed");
        }
      }, { cleanup: true });
    } catch (error) {
      runtime.markUnsafe();
      child.unref();
      if (error instanceof SmokeProcessError) throw error;
      throw new SmokeProcessError("exit_unconfirmed");
    }
  };
  const deadline = performance.now() + 180_000;
  const discovery = join(workspaceRoot, "home", ".hara", "workspace-runtime", "serve-v2.json");
  try {
    await runtime.phase(kind, "desktop.start", async () => {
      child = spawn(executable, args, { windowsHide: true, stdio: "ignore", env });
      child.on("error", () => { launchError = true; });
      if (!child.pid) throw new SmokeProcessError("spawn_failed");
      owner = await identify(runtime, kind, child.pid, { until: deadline });
      verifyIdentity(owner, executable);
    }, { until: deadline });
    return await runtime.phase(kind, "core.ready", async () => {
      const pendingOutcomes = new Set();
      while (runtime.remaining({ until: deadline }) && !launchError && running()) {
        const record = readDiscovery(discovery);
        if (record && record.instanceId !== previousInstance) {
          check(record.schemaVersion === 2 && record.executionMode === "workspace" && typeof record.instanceId === "string"
            && /^[a-f0-9]{64}$/u.test(record.token) && Number.isSafeInteger(record.port) && record.port > 0 && record.port < 65536,
          "Invalid Workspace discovery");
          if (direct) {
            check(record.pid === child.pid, "Discovery PID did not match the directly launched Core");
            return { record, stop };
          }
          const row = await identify(runtime, kind, record.pid, { until: deadline });
          unseenCore = undefined;
          const observed = observeCoreIdentity(record, readDiscovery(discovery), row, core, child.pid);
          if (observed.outcome === "core_pid_unseen") unseenCore = record;
          if (observed.row) {
            ownedCore = observed.row;
            if (!runtime.remaining({ until: deadline })) throw new SmokeProcessError("timeout");
            if (launchError || !running()) break;
            return { record, stop };
          }
          if (!pendingOutcomes.has(observed.outcome)) {
            pendingOutcomes.add(observed.outcome);
            if (unseenCore) {
              firstUnseenCore = unseenCore;
              reportCoreExit("first_unseen", unseenCore);
            }
            writeSync(process.stdout.fd, JSON.stringify({ stage: "core.identity", installerKind: kind, outcome: observed.outcome }) + "\n");
          }
        }
        await wait(Math.min(400, runtime.remaining({ until: deadline })));
      }
      if (!runtime.remaining({ until: deadline })) throw new SmokeProcessError("timeout");
      throw new SmokeError("Installed Workspace engine did not publish discovery");
    }, { until: deadline });
  } catch (error) {
    if (unseenCore && sameCoreDiscovery(unseenCore, readDiscovery(discovery))) {
      reportCoreExit("before_cleanup", unseenCore);
    }
    try { await stop(); } catch { /* The stop phase records the separate reason. */ }
    throw error;
  }
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

async function credentials(runtime, kind, root, home, { onInitialized, onRpcFailure }) {
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
  const listener = new AbortController();
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
    await runtime.phase(kind, "http.listen", () => {
      const listening = once(server, "listening", { signal: listener.signal });
      server.listen({ port: 0, host: origin, signal: listener.signal });
      return runtime.waitFor(listening, 5000);
    });
    const first = await start(runtime, kind, root, home);
    let saved;
    try {
      saved = await runtime.phase(kind, "vault.save", () => withWorkspace(first.record, async (rpc, snapshot) => {
        const before = await snapshot();
        await rpc("workspace.connection.add", { ...scope(before), expectedRevision: before.connections.revision, input: input(keys[0]) });
        const after = await snapshot();
        const row = savedConnection(after);
        check(after.connections.revision > before.connections.revision, "Add did not advance connection revision");
        return { workspaceId: before.workspaceId, row };
      }, { onInitialized, onRpcFailure, remaining: runtime.remaining }));
    } finally { await first.stop(); }
    const second = await runtime.phase(kind, "vault.restart",
      () => start(runtime, kind, root, home, { previousInstance: first.record.instanceId }));
    try {
      return await runtime.phase(kind, "vault.rotate", () => withWorkspace(second.record, async (rpc, snapshot) => {
        const reopened = await snapshot();
        const original = savedConnection(reopened, saved.row.id);
        check(original.credentialGeneration === saved.row.credentialGeneration && original.revision === saved.row.revision,
          "Restart did not preserve the saved connection");
        await verifyRead(rpc, reopened, original, keys[0]);
        await rpc("workspace.connection.edit", { ...scope(reopened), connectionId: original.id, expectedRevision: reopened.connections.revision, input: input(keys[1]) });
        const updated = await snapshot();
        const rotated = savedConnection(updated, original.id);
        check(updated.connections.revision > reopened.connections.revision && rotated.credentialGeneration !== original.credentialGeneration,
          "Edit did not rotate the credential and advance the revision");
        await verifyRead(rpc, updated, rotated, keys[1]);
        await rpc("workspace.connection.delete", { ...scope(updated), connectionId: rotated.id, expectedRevision: updated.connections.revision, approved: true });
        return { keySaved: true, restartReadback: true, rotationReadback: true, addedRevision: reopened.connections.revision,
          rotatedRevision: updated.connections.revision, loopbackCatalogRequests: seen, loopbackUnexpected: unexpected };
      }, { expectedWorkspaceId: saved.workspaceId, onRpcFailure, remaining: runtime.remaining }));
    } finally { await second.stop(); }
  } finally {
    try {
      await runtime.phase(kind, "http.close", () => runtime.waitFor(new Promise(resolve => server.close(resolve)),
        5000, { cleanup: true }), { cleanup: true });
    } catch (error) {
      server.closeAllConnections();
      server.unref();
      throw error;
    } finally {
      listener.abort();
    }
  }
}

async function verifyCredentialRefusal(runtime, installed, profile, reason, binding, onRpcFailure) {
  const direct = reason === "windows_desktop_required";
  const code = direct ? "unsupported" : "unavailable";
  const testRoot = join(profile, reason), launcher = join(testRoot, "app"), home = join(testRoot, "home");
  mkdirSync(launcher, { recursive: true });
  mkdirSync(home);
  // Use private copies of the installed executables. The installer and installed files stay untouched.
  const binaries = direct ? ["hara.exe", "hara-credential-worker.exe"] : ["hara-desktop.exe", "hara.exe", "herdr.exe"];
  for (const binary of binaries) copyFileSync(join(installed, binary), join(launcher, binary));
  if (direct) verifyWindowsVaultSidecar(join(launcher, "hara.exe"), binding);
  if (reason === "helper_missing") check(!existsSync(join(launcher, "hara-credential-worker.exe")), "Missing-worker fixture contains a worker");
  if (reason === "helper_invalid") {
    const worker = join(launcher, "hara-credential-worker.exe");
    copyFileSync(join(process.env.RUNNER_TEMP, "hara-vault-unbound-worker", "hara-credential-worker.exe"), worker);
    check(binarySHA(worker) !== binding.expectedWorkerSHA256, "Wrong-digest worker fixture did not change bytes");
    await runtime.command("nsis", "worker.empty_input", worker, [], { accepted: [65] }); // Valid worker executable takes the empty-stdin exit.
  }
  const { stdout } = await runtime.command("nsis", "vault.app_data", "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); [Environment]::GetFolderPath('LocalApplicationData')"], { capture: true });
  const localAppData = stdout.trim();
  const namespace = createHash("sha256").update("hara-host-home-v1\0")
    .update(realpathSync.native(home).replaceAll("/", "\\")).digest("hex");
  check(/^[a-z]:\\/iu.test(localAppData), "Cannot determine hosted DPAPI storage location");
  const vaultHome = join(localAppData, "Hara", "credential-vault", "v1", namespace);
  check(!existsSync(vaultHome), "Negative fixture vault namespace already exists");

  const host = await start(runtime, "nsis", launcher, home, { direct });
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
    }, { backend: direct ? "none" : "windows-dpapi", onRpcFailure, remaining: runtime.remaining,
      expectMissingWorker: reason === "helper_missing" });
  } finally { await host.stop(); }
}

async function main([releaseBase, output, mode]) {
  check(process.platform === "win32" && process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted"
    && process.env.RUNNER_TEMP && process.env.USERPROFILE, "GitHub-hosted Windows runner only");
  check(releaseBase && output && (mode === undefined || ["--release-only", "--msi-only", "--nsis-only", "--msi-precheck-only"].includes(mode)),
    "Invalid Windows install smoke arguments");
  mkdirSync(output, { recursive: true });
  const receiptPath = join(output, "windows-install-smoke.json");
  // One smoke invocation owns this runner output. Clear previous run files before publishing.
  rmSync(receiptPath, { force: true });
  const progressFile = join(output, "windows-install-progress.jsonl");
  rmSync(progressFile, { force: true });
  const runtime = smokeRuntime({ progressFile });
  const result = { schemaVersion: 1, desktopCommit: null, coreCommit: null, results: [], refusals: [], installationChecks: [] };
  let installerKind = null, scenario = null, rpcFailure = null;
  const onRpcFailure = diagnostic => { rpcFailure = diagnostic; };
  const publish = value => {
    const pending = join(output, `.windows-install-smoke-${randomBytes(8).toString("hex")}.tmp`);
    writeFileSync(pending, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
    renameSync(pending, receiptPath);
    writeSync(process.stdout.fd, JSON.stringify(value) + "\n");
  };
  try {
    await runtime.phase("none", "smoke", async () => {
      const required = windowsVaultRequired();
      const kinds = windowsSmokeInstallers(required, mode);
      if (!kinds.length) return;
      if (mode === "--msi-precheck-only") {
        installerKind = "msi";
        scenario = "precheck";
        await assertMsiRegistrationClear(installer(resolve(releaseBase), "msi"), runtime);
        return;
      }
      // prepackage may check out a commit different from GITHUB_SHA.
      const { stdout } = await runtime.command("none", "git.head", "git", ["rev-parse", "HEAD"], { capture: true });
      const desktopCommit = stdout.trim();
      check(/^[a-f0-9]{40}$/u.test(desktopCommit), "Installed smoke requires a known Desktop commit");
      result.desktopCommit = desktopCommit;
      const receipt = required ? readWindowsVaultBinding() : null;
      result.coreCommit = receipt?.coreCommit ?? null;
      const profile = mkdtempSync(join(process.env.USERPROFILE, "hara-install-smoke-"));
      const msiArtifact = required ? installer(resolve(releaseBase), "msi") : null;
      for (const kind of kinds) {
        check(runtime.remaining() > 0, "smoke_budget_exhausted");
        installerKind = kind;
        scenario = "installed";
        const artifact = kind === "msi" ? msiArtifact : installer(resolve(releaseBase), kind);
        const root = join(profile, `installed-${kind}`), home = join(profile, `home-${kind}`);
        mkdirSync(home);
        const installation = { kind, desktopPresent: null, corePresent: null, workerPresent: null };
        result.installationChecks.push(installation);
        const exercise = async () => {
          check(installation.desktopPresent && installation.corePresent, "Installed Desktop or Core missing");
          if (receipt) {
            const workerSHA256 = verifyWindowsVaultSidecar(join(root, "hara.exe"), receipt);
            result.results.push({ kind, installerSHA256: binarySHA(artifact), expectedWorkerSHA256: receipt.expectedWorkerSHA256,
              workerSHA256, ...await credentials(runtime, kind, root, home, {
                onRpcFailure,
                onInitialized(credentialStorage) {
                  writeSync(process.stdout.fd, JSON.stringify({ stage: "initialize", installerKind, credentialStorage }) + "\n");
                },
              }) });
            if (kind === "nsis" && mode !== "--release-only") {
              // Keep the copied-CLI receipt before the missing-worker startup diagnostic can block the run.
              for (const reason of ["helper_invalid", "windows_desktop_required", "helper_missing"]) {
                scenario = reason;
                result.refusals.push(await runtime.phase(kind, `refusal.${reason}`,
                  () => verifyCredentialRefusal(runtime, root, profile, reason, receipt, onRpcFailure)));
              }
            }
          } else {
            const app = await start(runtime, kind, root, home);
            await app.stop();
            result.results.push({ kind, workspaceStarted: true });
          }
        };

        if (kind === "msi") {
          await withMsiInstallation(artifact, root, installation, exercise, { runtime, mode });
        } else {
          if (msiArtifact) await assertNoLegacyMsi(msiArtifact, runtime);
          const uninstall = await installNsis(runtime, artifact, root, profile);
          let failed = false;
          try {
            Object.assign(installation, installedBinaries(root));
            await exercise();
          } catch (error) {
            failed = true;
            throw error;
          } finally {
            if (runtime.canInstallOrRemove()) {
              try { await uninstall(); } catch (error) { if (!failed) throw error; }
            }
          }
        }
      }
    });
  } catch (error) {
    publish({ ...result, failure: { installerKind, scenario, rpc: rpcFailure } });
    throw error;
  }
  if (result.desktopCommit !== null) publish(result);
}
await main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof SmokeError ? `windows-install-smoke: ${error.message}` : "windows-install-smoke: unexpected installer or fixture failure");
  process.exitCode = 1;
});
