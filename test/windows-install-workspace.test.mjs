import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withWorkspace } from "../scripts/windows-install-workspace.mjs";

const record = { port: 1, token: "local-fixture-token" };
const init = { capabilities: ["workspace.v1", "workspace.credential-storage.v1"],
  credentialStorage: { backend: "windows-dpapi" }, workspace: { activeWorkspaceId: null, workspaces: [] } };
const empty = { revision: 7, activeWorkspaceId: null, workspaces: [] };
const active = { revision: 8, activeWorkspaceId: "ws_smoke", workspaces: [{ workspaceId: "ws_smoke", active: true }] };
const snapshot = { workspaceId: "ws_smoke", resourceGeneration: "gen_fixture" };

function fixture(t, responses) {
  const calls = [];
  const previous = globalThis.WebSocket;
  globalThis.WebSocket = class extends EventTarget {
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    send(frame) {
      const { id, method, params } = JSON.parse(frame);
      calls.push([method, params]);
      const result = responses[method];
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({
        id, ...(Object.hasOwn(responses, method) ? { result } : { error: { code: -32601 } }),
      }) })));
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
