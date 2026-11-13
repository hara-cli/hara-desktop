import test from "node:test";
import assert from "node:assert/strict";
import { connectionCatalogScope, SettingsConnectionCatalog } from "../src/settings-connection-models.ts";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const reply = (overrides = {}) => ({ connectionId: "c1", revision: 3, source: "live", selectedModelId: "server-selected", models: [{ id: "one", label: "One" }, { id: "two", label: "Two" }], ...overrides });
const setup = () => {
  const context = { connectionId: "c1", supported: true, busy: false,
    draft: { provider: "openai", baseURL: "https://synthetic.example.invalid/v1", keyEdited: false },
    workspace: { workspaceId: "A", resourceGeneration: "g1", syntheticOnly: false, executionMode: "workspace", selectedAgentId: "main", agents: [{ kind: "main", state: "active", agentId: "main", configRevision: 2, agentEpoch: 1, identity: { displayName: "Synthetic Hara" }, runtime: { id: "codex", label: "Codex", available: true } }],
      connections: { revision: 3, connections: [{ id: "c1", status: "active", provider: "openai", baseURL: "https://synthetic.example.invalid/v1", defaultModel: "original", keySaved: true }] } } };
  const current = () => connectionCatalogScope(context.workspace, context.connectionId, context.draft, context.supported, context.busy);
  const calls = [], pending = deferred();
  const controller = new SettingsConnectionCatalog(current, async (...args) => { calls.push(args); return pending.promise; });
  return { context, current, calls, pending, controller };
};

test("render/setup and invalidation never list models; explicit read is single-flight and cannot change a selected model", async () => {
  const { controller, calls, pending } = setup();
  controller.invalidate(); assert.deepEqual(calls, []);
  const running = controller.request(); await controller.request(); assert.deepEqual(calls, [["main", "c1"]]);
  assert.equal(controller.getSnapshot().phase, "loading");
  pending.resolve(reply()); await running;
  assert.equal(controller.getSnapshot().phase, "ready");
  assert.deepEqual(controller.getSnapshot().catalog.models.map(row => row.id), ["one", "two"]);
  assert.equal("value" in controller.getSnapshot(), false, "the controller only provides candidates; server selection is never applied to a form");
});

for (const [name, mutate, reason] of [
  ["new connection", c => { c.connectionId = undefined; }, "new"],
  ["old Host", c => { c.supported = false; }, "upgrade"],
  ["revoked connection", c => { c.workspace.connections.connections[0].status = "revoked"; }, "unavailable"],
  ["no active main", c => { c.workspace.agents[0].state = "archived"; }, "unavailable"],
  ["readonly store", c => { c.workspace.connections.readOnly = true; }, "unavailable"],
  ["migrating store", c => { c.workspace.connections.migrationPending = true; }, "unavailable"],
  ["provider draft changed", c => { c.draft.provider = "anthropic"; }, "sourceChanged"],
  ["endpoint draft changed", c => { c.draft.baseURL += "/other"; }, "sourceChanged"],
  ["replacement key entered", c => { c.draft.keyEdited = true; }, "sourceChanged"],
  ["credential missing", c => { c.workspace.connections.connections[0].credentialRequired = true; }, "keyRequired"],
  ["credential invalid", c => { c.workspace.connections.connections[0].keyState = "invalid"; }, "keyRequired"],
  ["save/unknown", c => { c.busy = true; }, "busy"],
]) test(`no provider read for ${name}`, async () => {
  const { context, current, calls, controller } = setup(); mutate(context); assert.equal(current().reason, reason);
  await controller.request(); assert.deepEqual(calls, []);
});

for (const [name, mutate] of [
  ["workspace", c => { c.workspace.workspaceId = "B"; }],
  ["generation", c => { c.workspace.resourceGeneration = "g2"; }],
  ["global connection revision", c => { c.workspace.connections.revision++; }],
  ["agent configuration", c => { c.workspace.agents[0].configRevision++; }],
  ["agent epoch", c => { c.workspace.agents[0].agentEpoch++; }],
  ["runtime", c => { c.workspace.agents[0].runtime.id = "pi"; }],
  ["connection", c => { c.connectionId = "c2"; }],
  ["key edit", c => { c.draft.keyEdited = true; }],
]) test(`late catalog cannot cross ${name}`, async () => {
  const { context, controller, pending } = setup(); const running = controller.request(); mutate(context);
  pending.resolve(reply()); await running; assert.equal(controller.getSnapshot().catalog, undefined);
});

test("source change and return to the same source still drops the original reply; unmount invalidation drops failure", async () => {
  const { context, controller, pending } = setup(); const running = controller.request();
  context.draft.baseURL += "/other"; controller.invalidate(); context.draft.baseURL = "https://synthetic.example.invalid/v1"; controller.invalidate();
  pending.resolve(reply()); await running; assert.equal(controller.getSnapshot().phase, "idle");
  const next = setup(); const failing = next.controller.request(); next.controller.invalidate(); next.pending.reject(new Error("synthetic token=private")); await failing;
  assert.deepEqual(next.controller.getSnapshot(), { scope: "", phase: "idle" });
});

for (const override of [{ connectionId: "other" }, { revision: 4 }]) test(`wrong catalog binding is stale: ${JSON.stringify(override)}`, async () => {
  const { controller, pending } = setup(); const running = controller.request(); pending.resolve(reply(override)); await running;
  assert.equal(controller.getSnapshot().phase, "stale"); assert.equal(controller.getSnapshot().catalog, undefined);
});

for (const source of ["live", "documented"]) test(`${source} and empty lists are honest read results, not a model test`, async () => {
  const { controller, pending } = setup(); const running = controller.request(); pending.resolve(reply({ source, models: [] })); await running;
  assert.equal(controller.getSnapshot().phase, "ready"); assert.equal(controller.getSnapshot().catalog.source, source); assert.deepEqual(controller.getSnapshot().catalog.models, []);
});

test("malformed replies and raw provider errors expose no unsafe detail and never retain an old catalog", async () => {
  for (const value of [reply({ source: "invented" }), reply({ models: [{ id: "", label: "bad" }] }), reply({ models: {} }), null]) {
    const { controller, pending } = setup(); const running = controller.request(); pending.resolve(value); await running;
    assert.equal(controller.getSnapshot().phase, "failed"); assert.equal(controller.getSnapshot().catalog, undefined);
  }
  const { controller, pending } = setup(); const running = controller.request(); pending.reject(new Error("Authorization Bearer synthetic-private")); await running;
  assert.equal(controller.getSnapshot().phase, "failed"); assert.ok(!JSON.stringify(controller.getSnapshot()).includes("synthetic-private"));
});

test("failed explicit reads can retry; selection and form writes are never part of this controller", async () => {
  const { current } = setup(); let attempts = 0;
  const controller = new SettingsConnectionCatalog(current, async () => { if (!attempts++) throw new Error("synthetic"); return reply(); });
  await controller.request(); assert.equal(controller.getSnapshot().phase, "failed");
  await controller.request(); assert.equal(controller.getSnapshot().phase, "ready"); assert.equal(attempts, 2);
});

test("Settings catalog uses the real model RPC shape and a saved connection; no write or invented revision field", async () => {
  const calls = [], { context } = setup();
  const model = new WorkspaceDevModel({ supportsCapability: name => name === "workspace.connection-models.v1", async request(method, params) {
    calls.push({ method, params: structuredClone(params) });
    if (method === "workspace.list") return { revision: 1, syntheticOnly: false, executionMode: "workspace", activeWorkspaceId: "A", workspaces: [{ workspaceId: "A", active: true }] };
    if (method === "workspace.select" || method === "workspace.snapshot") return { ...context.workspace, label: "Synthetic", approvals: [], conversation: { history: [], state: "idle" } };
    if (method === "workspace.connection.listModels") return reply();
    throw new Error("Unexpected call: " + method);
  } }, () => "synthetic", false, "workspace");
  await model.selectWorkspace("A"); calls.length = 0;
  const controller = new SettingsConnectionCatalog(() => connectionCatalogScope(model.getSnapshot().workspace, "c1", context.draft, model.supportsConnectionModels(), false), (agentId, connectionId) => model.listConnectionModels(agentId, connectionId));
  await controller.request(); assert.equal(controller.getSnapshot().phase, "ready");
  assert.deepEqual(calls, [{ method: "workspace.connection.listModels", params: { workspaceId: "A", expectedGeneration: "g1", agentId: "main", connectionId: "c1" } }]);
});


test("a click from an old rendered workspace cannot start a read in the newly selected workspace", async () => {
  const { current, context, controller, calls, pending } = setup(); const renderedScope = current().key;
  context.workspace.workspaceId = "B"; const running = controller.request(renderedScope);
  pending.resolve(reply()); await running;
  assert.deepEqual(calls, [], "the renderer's exact scope must match the live model before sending anything");
});


test("the actual Settings field renders manual fallback or an inline catalog without sending a request in any locale", async () => {
  const { createElement } = await import("react"), { renderToStaticMarkup } = await import("react-dom/server");
  const { sharedSettingsUi } = await import("./support/shared-settings-ui.mjs"), { makeT } = await import("../src/i18n.ts");
  const { SettingsConnectionModelField } = sharedSettingsUi("./SettingsConnectionModelField");
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => key === "hara.locale" ? locale : null } });
      const { context, calls } = setup(), t = makeT(locale);
      const model = { getSnapshot() { return { workspace: context.workspace }; }, supportsConnectionModels: () => true, listConnectionModels() { calls.push("unexpected"); throw new Error("No automatic read"); } };
      const props = { model, workspace: context.workspace, draft: context.draft, value: "manual-model", disabled: false, onChange() {} };
      const newer = renderToStaticMarkup(createElement(SettingsConnectionModelField, props));
      assert.ok(!newer.includes('role="combobox"') && !newer.includes('class="wsd-model-list-read"'));
      assert.ok(newer.includes(t("ws.connections.models.needsSaved")) && newer.includes('required=""'));
      const edited = renderToStaticMarkup(createElement(SettingsConnectionModelField, { ...props, existing: context.workspace.connections.connections[0] }));
      assert.ok(edited.includes('role="combobox"') && edited.includes('class="wsd-model-list-read"') && edited.includes('required=""'));
      const oldHost = renderToStaticMarkup(createElement(SettingsConnectionModelField, { ...props, model: { ...model, supportsConnectionModels: () => false }, existing: context.workspace.connections.connections[0] }));
      assert.ok(!oldHost.includes('role="combobox"') && oldHost.includes(t("ws.connections.models.upgrade")));
      assert.deepEqual(calls, []);
    }
  } finally { if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor); else delete globalThis.localStorage; }
});
