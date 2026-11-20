import assert from "node:assert/strict";
import test from "node:test";
import { withWorkspace } from "../scripts/windows-install-smoke.mjs";

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
