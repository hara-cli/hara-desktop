import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyMsiDirectory, withMsiInstallation } from "../scripts/windows-install-layout.mjs";
import { withWorkspace } from "../scripts/windows-install-workspace.mjs";

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

function msiFixture(states, { installCode = 0, uninstallCode = 0, files = presentFiles } = {}) {
  const steps = [], observation = {};
  const run = () => withMsiInstallation("test.msi", requestedMsiRoot, observation, async () => steps.push("credentials"), {
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
