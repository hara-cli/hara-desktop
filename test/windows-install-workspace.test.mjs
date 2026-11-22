import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { assertMsiRegistrationClear, assertNoLegacyMsi, classifyMsiDirectory, installNsis, windowsSmokeInstallers,
  withMsiInstallation } from "../scripts/windows-install-layout.mjs";
import { check, withWorkspace } from "../scripts/windows-install-workspace.mjs";

const record = { port: 1, token: "local-fixture-token" };
const init = { capabilities: ["workspace.v1", "workspace.credential-storage.v1"],
  credentialStorage: { backend: "windows-dpapi", state: "not_checked", reason: null }, workspace: { activeWorkspaceId: null, workspaces: [] } };
const empty = { revision: 7, activeWorkspaceId: null, workspaces: [] };
const active = { revision: 8, activeWorkspaceId: "ws_smoke", workspaces: [{ workspaceId: "ws_smoke", active: true }] };
const snapshot = { workspaceId: "ws_smoke", resourceGeneration: "gen_fixture" };

const socketClosed = Symbol("socket closed");

function fixture(t, responses) {
  const calls = [];
  const previous = globalThis.WebSocket;
  globalThis.WebSocket = class extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    send(frame) {
      const { id, method, params } = JSON.parse(frame);
      calls.push([method, params]);
      const result = responses[method];
      if (result === socketClosed) {
        queueMicrotask(() => this.dispatchEvent(new Event("close")));
        return;
      }
      const reply = typeof result === "function" ? result() : Object.hasOwn(responses, method)
        ? { result } : { error: { code: -32601 } };
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id, ...reply }) })));
    }
    close() {}
  };
  t.after(() => { globalThis.WebSocket = previous; });
  return calls;
}

test("installer smoke creates the fixture through the empty directory's revision", async t => {
  const calls = fixture(t, { initialize: init, "workspace.list": empty, "workspace.create": snapshot, "workspace.snapshot": snapshot });
  assert.deepEqual(await withWorkspace(record, (_, takeSnapshot) => takeSnapshot()), snapshot);
  assert.deepEqual(calls, [
    ["initialize", { token: record.token }], ["workspace.list", {}],
    ["workspace.create", { label: "Windows smoke Workspace", expectedRevision: 7 }],
    ["workspace.snapshot", { workspaceId: "ws_smoke", agentId: null }],
  ]);
});

test("installer smoke rereads the same Workspace after restart without creating one", async t => {
  const calls = fixture(t, { initialize: init, "workspace.list": active, "workspace.snapshot": snapshot });
  assert.deepEqual(await withWorkspace(record, (_, takeSnapshot) => takeSnapshot(), { expectedWorkspaceId: "ws_smoke" }), snapshot);
  assert.deepEqual(calls.map(([method]) => method), ["initialize", "workspace.list", "workspace.snapshot"]);
});

test("installer smoke never creates a replacement after restart", async t => {
  const calls = fixture(t, { initialize: init, "workspace.list": empty });
  await assert.rejects(withWorkspace(record, assert.fail, { expectedWorkspaceId: "ws_smoke" }), /no active smoke Workspace/);
  assert.deepEqual(calls.map(([method]) => method), ["initialize", "workspace.list"]);
});

test("installer smoke refuses a different active Workspace after restart", async t => {
  const calls = fixture(t, { initialize: init, "workspace.list": active });
  await assert.rejects(withWorkspace(record, assert.fail, { expectedWorkspaceId: "ws_original" }), /did not reopen the same smoke Workspace/);
  assert.deepEqual(calls.map(([method]) => method), ["initialize", "workspace.list"]);
});

test("installer smoke requires the negotiated credential backend before provisioning", async t => {
  const calls = fixture(t, { initialize: { ...init, credentialStorage: { backend: "none" } } });
  await assert.rejects(withWorkspace(record, assert.fail), /expected credential backend/);
  assert.deepEqual(calls.map(([method]) => method), ["initialize"]);
});

test("installer smoke runs its hosted runner gate when invoked through a directory alias", t => {
  const scratch = mkdtempSync(join(tmpdir(), "hara-install-smoke-entry-"));
  const link = join(scratch, "scripts-link");
  const scripts = fileURLToPath(new URL("../scripts/", import.meta.url));
  const windows = process.platform === "win32";
  symlinkSync(scripts, link, windows ? "junction" : "dir");
  t.after(() => {
    (windows ? rmdirSync : unlinkSync)(link);
    rmdirSync(scratch);
  });

  const entry = join(link, "windows-install-smoke.mjs");
  assert.notEqual(entry, realpathSync(entry));
  const result = spawnSync(process.execPath, [entry], {
    encoding: "utf8", timeout: 5000, windowsHide: true,
    env: { ...(windows ? { SystemRoot: process.env.SystemRoot } : {}), GITHUB_ACTIONS: "false" },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^windows-install-smoke: GitHub-hosted Windows runner only\r?\n$/);
});

test("installer smoke reports only allowed RPC data and reads back the credential descriptor", async t => {
  const privateText = "private-path-or-credential";
  const calls = fixture(t, { initialize: { ...init,
    credentialStorage: { ...init.credentialStorage, state: privateText, reason: privateText, home: privateText },
  }, "workspace.list": active,
    "workspace.connection.add": () => ({ error: { code: -32602, message: privateText,
      data: { domain: "credential-vault", code: "unavailable", reason: privateText, retry: "explicit_user_only",
        params: { key: privateText }, technicalDetail: privateText } } }),
    "workspace.credentialStorage.get": { state: "unavailable", reason: "helper_invalid", home: privateText },
  });
  let diagnostic;
  await assert.rejects(withWorkspace(record, rpc => rpc("workspace.connection.add", { input: { apiKey: privateText } }),
    { onRpcFailure: value => { diagnostic = value; } }), /Installed Core RPC failed: workspace.connection.add/);
  assert.deepEqual(diagnostic, { method: "workspace.connection.add", kind: "rpc_error",
    error: { code: -32602, data: { domain: "credential-vault", code: "unavailable", reason: "other", retry: "explicit_user_only" } },
    initialCredentialStorage: { state: "other", reason: "other" },
    credentialStorage: { state: "unavailable", reason: "helper_invalid" } });
  assert(!JSON.stringify(diagnostic).includes(privateText));
  assert.deepEqual(calls.map(([method]) => method), ["initialize", "workspace.list", "workspace.connection.add", "workspace.credentialStorage.get"]);
});

test("installer smoke discards unlisted methods, codes and provider text", async t => {
  const unknown = "unlisted-private-value";
  const calls = fixture(t, { initialize: init, "workspace.list": active,
    [unknown]: () => ({ error: { code: -34567, message: unknown, data: { domain: unknown, code: unknown, reason: unknown, retry: unknown } } }),
  });
  let diagnostic;
  await assert.rejects(withWorkspace(record, rpc => rpc(unknown), { onRpcFailure: value => { diagnostic = value; } }), /RPC failed: unknown/);
  assert.deepEqual(diagnostic, { method: null, kind: "rpc_error",
    error: { code: null, data: { domain: "other", code: "other", reason: null, retry: null } },
    initialCredentialStorage: { state: "not_checked", reason: null }, credentialStorage: null });
  assert.equal(calls.length, 3);
});

test("installer smoke distinguishes WebSocket closure from an RPC error", async t => {
  const calls = fixture(t, { initialize: init, "workspace.list": active, "workspace.connection.add": socketClosed });
  let diagnostic;
  await assert.rejects(withWorkspace(record, rpc => rpc("workspace.connection.add"),
    { onRpcFailure: value => { diagnostic = value; } }), /socket_closed/);
  assert.deepEqual(diagnostic, { method: "workspace.connection.add", kind: "socket_closed", error: null,
    initialCredentialStorage: { state: "not_checked", reason: null }, credentialStorage: null });
  assert.deepEqual(calls.map(([method]) => method), ["initialize", "workspace.list", "workspace.connection.add"]);
});

test("installer smoke preserves an expected credential refusal without publishing a failure", async t => {
  fixture(t, { initialize: init, "workspace.list": active,
    "workspace.connection.add": () => ({ error: { code: -32602, data: { domain: "credential-vault", code: "unavailable" } } }),
  });
  assert.equal(await withWorkspace(record, rpc => rpc("workspace.connection.add", {}, "unavailable"), { onRpcFailure: assert.fail }), true);
});

function missingWorkerFixture(t, { supported = true, number = -32602, retry = "explicit_user_only" } = {}) {
  const unavailable = { ...init.credentialStorage, supported: true, state: "unavailable", reason: "helper_missing" };
  const view = { ...snapshot, connections: { revision: 1, connections: [] } };
  const calls = fixture(t, {
    initialize: { ...init, credentialStorage: { ...unavailable, supported } },
    "workspace.list": empty,
    "workspace.create": view,
    "workspace.snapshot": view,
    "workspace.connection.add": () => ({ error: { code: number, data: { domain: "credential-vault", code: "unavailable", retry } } }),
    "workspace.credentialStorage.get": unavailable,
  });
  const script = readFileSync(new URL("../scripts/windows-install-smoke.mjs", import.meta.url), "utf8");
  const refusal = script.match(/^async function verifyCredentialRefusal\([\s\S]*?^\}/mu)?.[0];
  assert(refusal, "test must execute the actual installer refusal");
  let stopped = false;
  const runRefusal = runInNewContext(refusal + "\nverifyCredentialRefusal", {
    check, withWorkspace, join, createHash, randomBytes, model: "fixture-model",
    mkdirSync() {}, copyFileSync() {}, existsSync: () => false, realpathSync: { native: value => value },
    scope: view => ({ workspaceId: view.workspaceId, expectedGeneration: view.resourceGeneration }),
    start: async () => ({ record, stop: async () => { stopped = true; } }),
  });
  const harness = { command: async () => ({ stdout: "C:\\fixture-local-appdata" }), remaining: () => Infinity };
  return { run: onRpcFailure => runRefusal(harness, "installed", "fixture-profile", "helper_missing", {}, onRpcFailure),
    calls, stopped: () => stopped };
}

test("missing-worker installer accepts the complete initialize and add contract before signing zero writes", async t => {
  const { run, calls, stopped } = missingWorkerFixture(t);
  const receipt = await run(assert.fail);
  assert.deepEqual(JSON.parse(JSON.stringify(receipt)), { code: "unavailable", reason: "helper_missing", configured: false, writes: 0 });
  assert.deepEqual(calls.map(([method]) => method), ["initialize", "workspace.list", "workspace.create", "workspace.snapshot",
    "workspace.connection.add", "workspace.snapshot", "workspace.credentialStorage.get"]);
  assert.equal(stopped(), true);
});

for (const [label, bad, diagnostic] of [
  ["initialize supported=false", { supported: false }, null],
  ["add numeric error -32603", { number: -32603 }, { code: null, retry: "explicit_user_only" }],
  ["add retry none", { retry: "none" }, { code: -32602, retry: "none" }],
]) {
  test("missing-worker installer rejects " + label, async t => {
    const { run, calls, stopped } = missingWorkerFixture(t, bad);
    let observed;
    await assert.rejects(run(value => { observed = value; }), diagnostic ? /workspace\.connection\.add/ : /Missing worker not reported/);
    const methods = calls.map(([method]) => method);
    if (diagnostic) {
      assert.equal(observed.error.code, diagnostic.code);
      assert.equal(observed.error.data.retry, diagnostic.retry);
      assert.deepEqual(methods, ["initialize", "workspace.list", "workspace.create", "workspace.snapshot",
        "workspace.connection.add", "workspace.credentialStorage.get"]);
    } else {
      assert.equal(observed, undefined);
      assert.deepEqual(methods, ["initialize"]);
    }
    assert.equal(stopped(), true);
  });
}

const hostBindingUnavailable = { state: "unavailable", reason: "host_binding_unavailable" };
for (const [description, initial] of [
  ["an already unavailable Host binding", hostBindingUnavailable],
  ["a binding failure first observed after add", { state: "not_checked", reason: null }],
]) {
  test("installer smoke distinguishes " + description, async t => {
    const calls = fixture(t, { initialize: { ...init, credentialStorage: { ...init.credentialStorage, ...initial } },
      "workspace.list": active,
      "workspace.connection.add": () => ({ error: {
        code: -32602, data: { domain: "credential-vault", code: "unavailable", retry: "explicit_user_only" },
      } }),
      "workspace.credentialStorage.get": hostBindingUnavailable,
    });
    let diagnostic, observedAtInitialize;
    await assert.rejects(withWorkspace(record, rpc => rpc("workspace.connection.add"), {
      onInitialized(value) {
        assert.deepEqual(calls.map(([method]) => method), ["initialize"]);
        observedAtInitialize = value;
      },
      onRpcFailure: value => { diagnostic = value; },
    }), /workspace.connection.add/);
    assert.deepEqual(observedAtInitialize, initial);
    assert.deepEqual(diagnostic.initialCredentialStorage, initial);
    assert.deepEqual(diagnostic.credentialStorage, hostBindingUnavailable);
    assert.deepEqual(calls.map(([method]) => method),
      ["initialize", "workspace.list", "workspace.connection.add", "workspace.credentialStorage.get"]);
  });
}

test("installer smoke has no initial credential state when initialize fails", async t => {
  const calls = fixture(t, { initialize: () => ({ error: { code: -32001 } }) });
  let diagnostic;
  await assert.rejects(withWorkspace(record, assert.fail, { onRpcFailure: value => { diagnostic = value; } }),
    /RPC failed: initialize/);
  assert.equal(diagnostic.initialCredentialStorage, null);
  assert.equal(diagnostic.credentialStorage, null);
  assert.deepEqual(calls.map(([method]) => method), ["initialize"]);
});

const requestedMsiRoot = "C:\\private fixture\\installed-msi";
const installedMsi = { productState: 5, defaultPresent: false, installDirPresent: true, installDir: requestedMsiRoot };
const absentMsi = { productState: -1, defaultPresent: false, installDirPresent: false, installDir: null };
const presentFiles = { desktopPresent: true, corePresent: true, workerPresent: true };

for (const [description, directory, expected] of [
  ["normalizes a trailing backslash", requestedMsiRoot + "\\", "requested"],
  ["compares case-insensitively", requestedMsiRoot.toUpperCase(), "requested"],
  ["identifies the old NSIS directory", "C:\\private fixture\\installed-nsis", "previous_nsis"],
  ["classifies any other private directory without exposing it", "D:\\private unexpected path", "other"],
  ["identifies the default Program Files directory", "C:\\Program Files\\Hara\\", "default_program_files"],
  ["treats a missing or non-absolute path as unknown", "\\installed-msi", "unknown"],
]) {
  test("installer smoke " + description, () => {
    assert.equal(classifyMsiDirectory(directory, requestedMsiRoot, "C:\\Program Files"), expected);
  });
}

function msiFixture(states, { installCode = 0, uninstallCode = 0, files = presentFiles, runtime } = {}) {
  const steps = [], observation = {};
  const run = () => withMsiInstallation("test.msi", requestedMsiRoot, observation, async () => steps.push("credentials"), {
    runtime,
    readRegistration(artifact) {
      assert.equal(artifact, "test.msi");
      steps.push("read");
      return states.shift();
    },
    invoke(action, artifact, root) {
      assert.equal(artifact, "test.msi");
      assert.equal(root, requestedMsiRoot);
      steps.push(action);
      return action === "/i" ? installCode : uninstallCode;
    },
    binaries(root) {
      assert.equal(root, requestedMsiRoot);
      steps.push("binaries");
      return files;
    },
  });
  return { steps, observation, run };
}

test("rehearsal selects each installer independently and leaves formal and older defaults intact", () => {
  assert.deepEqual(windowsSmokeInstallers(true, "--msi-precheck-only"), ["msi"]);
  assert.deepEqual(windowsSmokeInstallers(true, "--msi-only"), ["msi"]);
  assert.deepEqual(windowsSmokeInstallers(true, "--nsis-only"), ["nsis"]);
  assert.deepEqual(windowsSmokeInstallers(true, undefined), ["msi", "nsis"]);
  assert.deepEqual(windowsSmokeInstallers(true, "--release-only"), ["msi", "nsis"]);
  assert.deepEqual(windowsSmokeInstallers(false, undefined), ["nsis"]);
  assert.deepEqual(windowsSmokeInstallers(false, "--release-only"), []);
  for (const mode of ["--msi-precheck-only", "--msi-only", "--nsis-only"]) {
    assert.throws(() => windowsSmokeInstallers(false, mode), /requires Windows credential storage/);
  }
  assert.throws(() => windowsSmokeInstallers(true, "--unexpected"), /Invalid Windows install smoke arguments/);
});

test("separate MSI preflight only reads registration and fails closed on residue or unreadable state", async () => {
  const runtime = {};
  const probe = state => (artifact, actualRuntime, stage) => {
    assert.equal(artifact, "fixture.msi");
    assert.equal(actualRuntime, runtime);
    assert.equal(stage, "msi.precheck");
    return state;
  };
  await assertMsiRegistrationClear("fixture.msi", runtime, probe(absentMsi));
  for (const present of [{ defaultPresent: true }, { installDirPresent: true }, { productState: 5 }]) {
    await assert.rejects(assertMsiRegistrationClear("fixture.msi", runtime, probe({ ...absentMsi, ...present })),
      /msi_preexisting_registration/);
  }
  await assert.rejects(assertMsiRegistrationClear("fixture.msi", runtime, probe(null)), /msi_registration_unavailable/);
});

test("MSI install and uninstall explicitly suppress reboots with the same quiet settings", async () => {
  const calls = [], states = [absentMsi, installedMsi, absentMsi];
  const runtime = {
    canInstallOrRemove: () => true,
    command(kind, stage, executable, args, options) {
      calls.push({ kind, stage, executable, args, options });
      return { exitCode: 0 };
    },
  };
  await withMsiInstallation("fixture.msi", requestedMsiRoot, {}, () => {}, {
    runtime, readRegistration: () => states.shift(), binaries: () => presentFiles,
  });
  const quiet = ["fixture.msi", "/qn", "/norestart", "REBOOT=ReallySuppress"];
  assert.deepEqual(calls, [
    { kind: "msi", stage: "msi.install", executable: "msiexec.exe", args: ["/i", ...quiet, "INSTALLDIR=" + requestedMsiRoot],
      options: { cleanup: false, accepted: [0, 3010] } },
    { kind: "msi", stage: "msi.uninstall", executable: "msiexec.exe", args: ["/x", ...quiet],
      options: { cleanup: true, accepted: [0, 3010] } },
  ]);
});

test("split MSI rejects a matching HKLM residue on its own VM after ProductCode and HKCU clear", async () => {
  const operations = ["msi.precheck", "msi.layout", "msi.removal_check", "msi.migration_removal_check"];
  for (const [migration, expected, reason] of [
    [{ legacyMsiPresent: true }, false, "msi_legacy_registration_remaining"],
    [null, null, "msi_legacy_registration_unavailable"],
    [new Error("synthetic query failure"), null, "msi_legacy_registration_unavailable"],
    [{ legacyMsiPresent: false }, true, null],
  ]) {
    const observation = {}, commands = [], readings = [];
    const states = [absentMsi, installedMsi, absentMsi, migration];
    const runtime = { canInstallOrRemove: () => true };
    const install = withMsiInstallation("fixture.msi", requestedMsiRoot, observation,
      () => commands.push("credentials"), {
        runtime, mode: "--msi-only",
        readRegistration(artifact, actualRuntime, operation, cleanup) {
          assert.equal(artifact, "fixture.msi");
          assert.equal(actualRuntime, runtime);
          readings.push([operation, cleanup]);
          const state = states.shift();
          if (state instanceof Error) throw state;
          return state;
        },
        invoke(action) { commands.push(action); return 0; },
        binaries: () => presentFiles,
      });
    if (reason) await assert.rejects(install);
    else await install;
    assert.deepEqual(commands, ["/i", "credentials", "/x"]);
    assert.deepEqual(readings, operations.map((operation, index) => [operation, index >= 2]));
    assert.equal(observation.registrationClearAfter, true);
    assert.equal(observation.legacyMsiClearAfter, expected);
    assert.equal(observation.cleanupReason, reason);
  }
});

test("installer smoke verifies MSI registration and directory before credentials and confirms removal before NSIS", async () => {
  const { steps, observation, run } = msiFixture([absentMsi, installedMsi, absentMsi]);
  await run();
  assert.deepEqual(steps, ["read", "/i", "binaries", "read", "credentials", "/x", "read"]);
  assert.deepEqual(observation, { ...presentFiles, registrationClearBefore: true, installExitCode: 0, directory: "requested",
    uninstallExitCode: 0, registrationClearAfter: true, reason: null, cleanupReason: null });
});

test("installer smoke rejects a preexisting default value, named value or product before invoking MSI", async () => {
  for (const activeRegistration of [{ defaultPresent: true }, { installDirPresent: true }, { productState: 2 }]) {
    const { steps, observation, run } = msiFixture([{ ...absentMsi, ...activeRegistration }]);
    await assert.rejects(run(), /msi_preexisting_registration/);
    assert.deepEqual(steps, ["read"]);
    assert.equal(observation.registrationClearBefore, false);
  }
});

test("installer smoke keeps unreadable registry observations distinct from an empty registry", async () => {
  const { steps, observation, run } = msiFixture([null]);
  await assert.rejects(run(), /msi_registration_unavailable/);
  assert.deepEqual(steps, ["read"]);
  assert.equal(observation.registrationClearBefore, null);
});

test("installer smoke rejects an MSI redirected to NSIS and reports each missing file separately", async () => {
  const files = { desktopPresent: false, corePresent: true, workerPresent: false };
  const { steps, observation, run } = msiFixture([
    absentMsi, { ...installedMsi, installDir: "C:\\PRIVATE FIXTURE\\installed-nsis\\" }, absentMsi,
  ], { files });
  await assert.rejects(run(), /msi_install_dir_redirected/);
  assert.deepEqual(steps, ["read", "/i", "binaries", "read", "/x", "read"]);
  for (const name of Object.keys(files)) assert.equal(observation[name], files[name]);
  assert.equal(observation.directory, "previous_nsis");
  assert.equal(observation.registrationClearAfter, true);
  assert.doesNotMatch(JSON.stringify(observation), /private fixture|test\.msi/iu);
});

test("installer smoke refuses MSI with a missing named InstallDir", async () => {
  const { steps, observation, run } = msiFixture([
    absentMsi, { ...installedMsi, installDirPresent: false, installDir: null }, absentMsi,
  ]);
  await assert.rejects(run(), /msi_install_dir_redirected/);
  assert(!steps.includes("credentials"));
  assert.equal(observation.directory, "unknown");
});

test("installer smoke refuses to continue to NSIS when the MSI product or directory registration remains", async () => {
  for (const residue of [{ productState: 5 }, { installDirPresent: true }]) {
    const { observation, run } = msiFixture([absentMsi, installedMsi, { ...absentMsi, ...residue }]);
    await assert.rejects(run(), /msi_residue_before_nsis/);
    assert.equal(observation.registrationClearAfter, false);
    assert.equal(observation.cleanupReason, "msi_residue_before_nsis");
  }
});

test("installer smoke keeps the MSI reboot exit code and refuses to sign off", async () => {
  const pendingInstall = msiFixture([absentMsi, absentMsi], { installCode: 3010 });
  await assert.rejects(pendingInstall.run(), /msi_reboot_required/);
  assert(!pendingInstall.steps.includes("credentials"));
  assert.equal(pendingInstall.observation.installExitCode, 3010);
  assert.equal(pendingInstall.observation.registrationClearAfter, true);

  const pendingRemoval = msiFixture([absentMsi, installedMsi], { uninstallCode: 3010 });
  await assert.rejects(pendingRemoval.run(), /msi_reboot_required/);
  assert.equal(pendingRemoval.observation.uninstallExitCode, 3010);
  assert.equal(pendingRemoval.observation.registrationClearAfter, null);
});

test("installer skips MSI cleanup when child exit is unconfirmed", async () => {
  const { observation, steps, run } = msiFixture([absentMsi, installedMsi], { runtime: { canInstallOrRemove: () => false } });
  await assert.rejects(run(), /exit_unconfirmed/);
  assert.deepEqual(steps, ["read", "/i", "binaries", "read", "credentials"]);
  assert.equal(observation.cleanupReason, "exit_unconfirmed");
});

test("installer refuses unknown or matching legacy MSI registration before NSIS", async () => {
  const runtime = {};
  const fixture = value => async (artifact, context, operation) => {
    assert.equal(artifact, "fixture.msi");
    assert.equal(context, runtime);
    assert.equal(operation, "nsis.migration_check");
    return value;
  };
  await assertNoLegacyMsi("fixture.msi", runtime, fixture({ legacyMsiPresent: false }));
  await assert.rejects(assertNoLegacyMsi("fixture.msi", runtime, fixture({ legacyMsiPresent: true })), /nsis_legacy_msi_present/);
  await assert.rejects(assertNoLegacyMsi("fixture.msi", runtime, fixture(null)), /nsis_migration_registration_unavailable/);
});

test("installer never sends the next RPC after the shared work budget runs out", async t => {
  const calls = fixture(t, { initialize: init });
  await assert.rejects(withWorkspace(record, assert.fail, { remaining: () => 0 }), /timeout/);
  assert.deepEqual(calls, []);
});

for (const remains of [false, true]) {
  test("installer waits for the copied NSIS uninstaller and " + (remains ? "rejects leftover files" : "confirms file removal"), async t => {
    const profile = mkdtempSync(join(tmpdir(), "hara nsis fixture "));
    const dest = join(profile, "installed-nsis");
    const binary = join(dest, "hara.exe");
    const uninstaller = join(dest, "uninstall.exe");
    const copy = join(profile, "nsis-uninstall.exe");
    t.after(() => {
      if (remains) unlinkSync(binary);
      unlinkSync(uninstaller);
      unlinkSync(copy);
      rmdirSync(dest);
      rmdirSync(profile);
    });
    const calls = [];
    const runtime = {
      canInstallOrRemove: () => true,
      remaining: () => 0,
      phase: (_, __, action) => action(),
      async command(kind, phase, file, args, options) {
        calls.push([kind, phase, file, args, options]);
        if (phase === "nsis.install") {
          mkdirSync(dest);
          writeFileSync(binary, "fixture");
          writeFileSync(uninstaller, "uninstaller fixture");
        } else {
          assert.equal(readFileSync(copy, "utf8"), "uninstaller fixture");
          if (!remains) unlinkSync(binary);
        }
      },
    };
    const uninstall = await installNsis(runtime, "setup.exe", dest, profile);
    if (remains) await assert.rejects(uninstall(), /nsis_uninstall_files_remain/);
    else await uninstall();
    assert.deepEqual(calls, [
      ["nsis", "nsis.install", "setup.exe", ["/S", "/D=" + dest], { windowsVerbatimArguments: true }],
      ["nsis", "nsis.uninstall", copy, ["/S", "_?=" + dest], { cleanup: true, windowsVerbatimArguments: true }],
    ]);
  });
}

test("installer stops after MSI reports that it initiated a reboot", async () => {
  const { observation, steps, run } = msiFixture([absentMsi], { installCode: 1641 });
  await assert.rejects(run(), /msi_install_failed/);
  assert.equal(observation.installExitCode, 1641);
  assert.deepEqual(steps, ["read", "/i"]);
});
