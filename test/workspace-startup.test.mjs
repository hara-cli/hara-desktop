import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceStartupModel, workspaceStartupDiagnostic } from "../src/workspace-startup.ts";
const tick = () => new Promise(done => setImmediate(done));
const deferred = () => { let resolve, reject;const promise = new Promise((yes, no) => { resolve = yes;reject = no; });return { promise, resolve, reject }; };
const info = { port: 12345, token: "a".repeat(64), instanceId: "local-fixture", root: "/private/fixture", syntheticOnly: true };
function fixture() {
  const calls = [], handlers = {}, clients = [], models = [];
  const startup = new WorkspaceStartupModel(async () => { calls.push("native-attach");return handlers.connect ? handlers.connect() : info; }, {
    client(_info, disconnected) {
      const client = { closes: 0, disconnected, async initialize() { calls.push("initialize");await handlers.initialize?.(); },
        close() { this.closes++;disconnected(); }, setChangedListener(fn) { this.changed = fn; }, request() { throw new Error("No business RPC expected"); }, supportsCapability() { return false; } };
      clients.push(client);return client;
    },
    model(_client, _info, settingsOnly) {
      const model = { view: { directory: null, workspace: null }, settingsOnly, getSnapshot() { return this.view; },
        async loadDirectory() { calls.push("directory");await handlers.directory?.();this.view.directory = { activeWorkspaceId: "A", workspaces: [{ workspaceId: "A", active: true }] }; },
        async selectWorkspace(id) { calls.push("snapshot:" + id);await handlers.select?.();this.view.workspace = { workspaceId: id }; },
        setSettingsFactory(fn) { this.settings = fn; }, workspaceChanged() { calls.push("changed"); } };
      models.push(model);return model;
    },
  });return { startup, calls, handlers, clients, models };
}
test("repeated reconnect clicks share one attachment and show each real stage before becoming ready", async () => {
  const f = fixture(), native = deferred(), auth = deferred(), directory = deferred();
  f.handlers.connect = () => native.promise;f.handlers.initialize = () => auth.promise;f.handlers.directory = () => directory.promise;
  const first = f.startup.start();assert.equal(f.startup.start(), first);assert.equal(f.startup.getSnapshot().attempt, 1);
  assert.deepEqual(f.calls, ["native-attach"]);native.resolve(info);await tick();
  assert.equal(f.startup.getSnapshot().phase, "handshake");assert.equal(f.startup.getSnapshot().model, null);
  auth.resolve();await tick();assert.equal(f.startup.getSnapshot().phase, "loading");assert.equal(f.startup.getSnapshot().model, null);
  directory.resolve();await first;assert.equal(f.startup.getSnapshot().phase, "ready");
  assert.equal(f.startup.getSnapshot().model, f.models[0]);assert.equal(f.startup.getSnapshot().root, info.root);
  assert.equal(JSON.stringify(f.startup.getSnapshot()).includes(info.token), false);
  assert.deepEqual(f.calls, ["native-attach", "initialize", "directory", "snapshot:A"]);f.startup.stop();
});
test("native failure gives a safe result and only an explicit later click starts attempt two", async () => {
  const f = fixture();f.handlers.connect = () => { throw "The exact Hara Core sidecar is unavailable"; };
  await f.startup.start();assert.equal(f.startup.getSnapshot().diagnostic, "CORE_SIDECAR_UNAVAILABLE");
  assert.equal(f.startup.getSnapshot().phase, "failed");await tick();assert.deepEqual(f.calls, ["native-attach"]);
  delete f.handlers.connect;await f.startup.start();assert.equal(f.startup.getSnapshot().phase, "ready");
  assert.equal(f.startup.getSnapshot().attempt, 2);assert.equal(f.calls.filter(item => item === "native-attach").length, 2);f.startup.stop();
});
for (const [stage, diagnostic] of [["initialize", "CORE_HANDSHAKE_FAILED"], ["directory", "WORKSPACE_LOAD_FAILED"], ["select", "WORKSPACE_LOAD_FAILED"]]) {
  test(`${stage} failure closes its client, reports the right stage and never reflects private text`, async () => {
    const f = fixture();f.handlers[stage] = () => { throw new Error("private-path?token=" + info.token); };
    await f.startup.start();const view = f.startup.getSnapshot();assert.equal(view.phase, "failed");assert.equal(view.diagnostic, diagnostic);
    assert.equal(view.model, null);assert.equal(f.clients[0].closes, 1);assert.equal(/private-path|token=/.test(JSON.stringify(view)), false);
    delete f.handlers[stage];await f.startup.start();assert.equal(f.startup.getSnapshot().phase, "ready");assert.equal(f.startup.getSnapshot().attempt, 2);f.startup.stop();
  });
}
test("a disposed native attachment cannot create a socket or replace a later successful attempt", async () => {
  const f = fixture(), old = deferred();f.handlers.connect = () => old.promise;const first = f.startup.start();
  f.startup.stop();delete f.handlers.connect;await f.startup.start();const current = f.startup.getSnapshot();
  old.resolve(info);await first;assert.equal(f.startup.getSnapshot(), current);assert.equal(f.clients.length, 1);f.startup.stop();
});
test("late handshake completion and old disconnect callbacks cannot overwrite the new connection", async () => {
  const f = fixture(), old = deferred();f.handlers.initialize = () => old.promise;const first = f.startup.start();await tick();
  f.startup.stop();delete f.handlers.initialize;await f.startup.start();const current = f.startup.getSnapshot();
  f.clients[0].disconnected();old.resolve();await first;assert.equal(f.startup.getSnapshot(), current);
  assert.equal(f.calls.filter(item => item === "directory").length, 1);f.startup.stop();
});
test("a live disconnect keeps the visible model but never reconnects or resumes by itself", async () => {
  const f = fixture();await f.startup.start();const model = f.startup.getSnapshot().model;
  f.clients[0].disconnected();assert.equal(f.startup.getSnapshot().phase, "disconnected");assert.equal(f.startup.getSnapshot().model, model);
  await tick();assert.equal(f.calls.filter(item => item === "native-attach").length, 1);f.startup.stop();
});
test("disconnect during a delayed workspace load cannot publish a dead model or trap the next reconnect behind the old promise", async () => {
  const f = fixture(), old = deferred();f.handlers.directory = () => old.promise;
  const first = f.startup.start();await tick();assert.equal(f.startup.getSnapshot().phase, "loading");
  f.clients[0].disconnected();assert.equal(f.startup.getSnapshot().phase, "failed");assert.equal(f.startup.getSnapshot().diagnostic, "WORKSPACE_LOAD_FAILED");assert.equal(f.startup.getSnapshot().model, null);
  delete f.handlers.directory;const second = f.startup.start();assert.notEqual(second, first);await second;
  const current = f.startup.getSnapshot();assert.equal(current.phase, "ready");assert.equal(current.attempt, 2);
  old.resolve();await first;assert.equal(f.startup.getSnapshot(), current);f.startup.stop();
});
test("settings gets a separately closed authenticated client without replacing the chat model", async () => {
  const f = fixture();await f.startup.start();const original = f.startup.getSnapshot();
  const settings = await f.models[0].settings();assert.equal(settings.model.settingsOnly, true);
  settings.close();assert.equal(f.clients[1].closes, 1);assert.equal(f.clients[0].closes, 0);assert.equal(f.startup.getSnapshot(), original);f.startup.stop();
});
test("only exact known native errors get specific diagnostics; other contents cannot become UI or log text", () => {
  assert.equal(workspaceStartupDiagnostic("Cannot start Workspace Core", "connecting"), "CORE_START_FAILED");
  assert.equal(workspaceStartupDiagnostic("Workspace Core startup failed; original data preserved", "connecting"), "CORE_EXITED");
  assert.equal(workspaceStartupDiagnostic("Workspace startup is not yet confirmed; attachment may be retried without restarting or resending tasks", "connecting"), "CORE_START_PENDING");
  for (const error of ["Cannot start Workspace Core: /private/real-path", new Error("Bearer secret"), { code: "private", message: "raw" }, null]) assert.equal(workspaceStartupDiagnostic(error, "connecting"), "CORE_CONNECT_FAILED");
});
