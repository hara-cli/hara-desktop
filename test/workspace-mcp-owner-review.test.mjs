import { sharedSettingsUi } from "./support/shared-settings-ui.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { makeT } from "../src/i18n.ts";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { mcpReviewList, mcpReviewDetail, MCP_REVIEW_REASONS } from "../src/workspace-mcp-review.ts";
const require = createRequire(import.meta.url), React = require("react");
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const recordId = "11111111-1111-4111-8111-111111111111", sourceId = "global:host:fixture";
const list = (workspaceId = "A", patch = {}) => ({ workspaceId, resourceGeneration: `generation-${workspaceId}`, revision: 0, readOnly: false, allowed: true, reason: null,
  sources: [{ sourceId, recordId, name: "Synthetic fixture", status: "candidate", reason: null }], ...patch });
const detail = (workspaceId = "A", patch = {}) => ({ workspaceId, resourceGeneration: `generation-${workspaceId}`, revision: 0, recordId, sourceId, name: "Synthetic fixture", transport: "stdio", phase: "code", reason: null,
  hasReview: false, canInspect: true, canApprove: false, binaryPath: "~/.local/bin/node", packagePath: "~/fixture", binaryDigest: "a".repeat(64), packageDigest: "b".repeat(64), launchSummary: '"~/fixture/server.mjs"', network: "proxy_only", credentials: "none", tools: [], ...patch });
const tools = [{ name: "fixture_change", description: "Synthetic upstream tool", schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] }, schemaDigest: "c".repeat(64), effect: "exec" }];
const inspected = (workspaceId = "A", patch = {}) => detail(workspaceId, { phase: "tools", canInspect: false, canApprove: true, tools, ...patch });
const mock = patch => ({ mcpReviews: async id => list(id), describeMcpReview: async (_record, id) => detail(id), cancelMcpReview: async () => {}, ...patch });
const component = readFileSync(new URL("../src/WorkspaceExtensions.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(component, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
function mount(model, patch = {}) {
  const slots = [], effects = [], dirtyEvents = []; let cursor = 0, dirty = false, tree;
  let props = { model, workspaceId: "A", generation: "generation-A", onDirty: value => dirtyEvents.push(value), ...patch };
  const hooks = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], next => { const value = typeof next === "function" ? next(slots[index]) : next; if (!Object.is(slots[index], value)) { slots[index] = value; dirty = true; } }]; },
    useEffect(action, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((dep, n) => !Object.is(dep, old.deps[n]))) effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: action() }; }); },
  };
  const exports = {};
  new Function("require", "exports", outputText)(name => ["./SettingsActionDialog", "./settings-device-copy"].includes(name) ? sharedSettingsUi(name) : name === "react" ? { ...React, ...hooks } : name === "./SettingsChrome" ? { SettingsAdvanced: props => props.children, SettingsAttention: () => null } : name === "./workspace-shell-hooks" ? { useWorkspaceLocale: () => ({ t: makeT(props.locale ?? "en"), locale: props.locale ?? "en" }) } : name.endsWith(".css") ? {} : require(name), exports);
  const render = (next = {}) => { props = { ...props, ...next }; cursor = 0; dirty = false; tree = exports.WorkspaceMcpOwnerReview(props); effects.splice(0).forEach(effect => effect()); return tree; };
  const flush = async () => { await tick(); for (let count = 0; count < 24 && dirty; count++) { render(); await tick(); } };
  const nodes = () => { const list = []; const walk = value => { if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === "object" && value.props) { list.push(value); walk(value.props.children); } }; walk(tree); return list; };
  const text = value => Array.isArray(value) ? value.map(text).join("") : value && typeof value === "object" && value.props ? text(value.props.children) : typeof value === "string" || typeof value === "number" ? String(value) : "";
  const button = label => { const node = nodes().find(node => node.type === "button" && text(node) === label); assert.ok(node, label); return node; };
  const checks = () => nodes().filter(node => node.type === "input");
  const toggle = (index, checked) => { checks()[index].props.onChange({ target: { checked } }); render(); };
  const unmount = () => slots.forEach(slot => slot?.cleanup?.());
  render(); return { render, flush, nodes, button, checks, toggle, unmount, text: () => text(tree), dirtyEvents };
}

test("owner UI displays code before explicit catalog startup and requires a second final approval", async () => {
  const operations = [], inspecting = deferred(), approving = deferred(), changed = [], busy = [];
  const f = mount(mock({ decideMcpReview: (...args) => { operations.push(args); return args[0] === "inspect" ? inspecting.promise : approving.promise; } }), { onBusy: value => busy.push(value), onChanged: async id => changed.push(id) });
  const t = makeT("en"); await f.flush(); assert.equal(operations.length, 0);
  f.button(t("ws.mcpReview.open")).props.onClick(); await f.flush();
  assert.ok(f.text().includes("~/.local/bin/node")); assert.ok(f.text().includes("b".repeat(64))); assert.ok(f.text().includes(t("ws.mcpReview.network")));
  assert.equal(f.nodes().some(node => node.type === "button" && node.props.children === t("ws.mcpReview.approve")), false);
  const start = f.button(t("ws.mcpReview.inspect")).props.onClick; start(); start(); await f.flush();
  assert.deepEqual(operations, [["inspect", recordId, "A", "generation-A"]]); assert.deepEqual(changed, []);
  inspecting.resolve(inspected()); await f.flush(); assert.ok(f.text().includes("fixture_change")); assert.ok(f.text().includes('"required"'));
  const approve = f.button(t("ws.mcpReview.approve")).props.onClick; approve(); approve(); await f.flush(); assert.equal(operations.length, 2);
  approving.resolve(inspected("A", { phase: "approved", revision: 1, canApprove: false, hasReview: true })); await f.flush(); assert.deepEqual(changed, [sourceId]);
  f.button(t("ws.mcpReview.revoke")).props.onClick(); await f.flush(); assert.ok(f.text().includes(t("ws.mcpReview.revokeWarning")));
  f.button(t("ws.extensions.cancel")).props.onClick(); await f.flush(); assert.equal(operations.length, 2);
  f.button(t("ws.mcpReview.close")).props.onClick(); await f.flush(); assert.equal(busy.at(-1), false); f.unmount();
});

test("unknown writes are never retried, private errors stay hidden, and explicit reload is required", async () => {
  let attempts = 0;
  const f = mount(mock({ decideMcpReview: async () => { attempts++; throw Error("PRIVATE_KEY_DO_NOT_SHOW"); } })), t = makeT("en");
  await f.flush(); f.button(t("ws.mcpReview.open")).props.onClick(); await f.flush();
  const oldStart = f.button(t("ws.mcpReview.inspect")).props.onClick; oldStart(); await f.flush(); oldStart(); await f.flush();
  assert.equal(attempts, 1); assert.doesNotMatch(f.text(), /PRIVATE_KEY/); assert.ok(f.text().includes(t("ws.mcpReview.saveUnknown")));
  assert.equal(f.button(t("ws.mcpReview.inspect")).props.disabled, true); f.unmount();
});

test("closing an in-flight inspection cancels the opaque record; its late result cannot publish or approve", async () => {
  const wait = deferred(), cancelled = [], changed = [], f = mount(mock({ decideMcpReview: () => wait.promise, cancelMcpReview: async (...args) => cancelled.push(args) }), { onChanged: async id => changed.push(id) });
  const t = makeT("en"); await f.flush(); f.button(t("ws.mcpReview.open")).props.onClick(); await f.flush(); f.button(t("ws.mcpReview.inspect")).props.onClick(); await f.flush();
  f.button(t("ws.mcpReview.close")).props.onClick(); await f.flush(); wait.resolve(inspected()); await f.flush();
  assert.deepEqual(cancelled, [[recordId, "A", "generation-A"]]); assert.deepEqual(changed, []); assert.ok(!f.text().includes("fixture_change")); f.unmount();
});

test("A-B-A, model replacement and unmount invalidate old review handlers and responses", async () => {
  const opening = deferred(); let writes = 0, reads = 0;
  const model = mock({ describeMcpReview: async (_id, workspaceId) => ++reads === 1 ? opening.promise : detail(workspaceId), decideMcpReview: async () => { writes++; return inspected(); } });
  const f = mount(model), t = makeT("en"); await f.flush(); const oldOpen = f.button(t("ws.mcpReview.open")).props.onClick; oldOpen(); await f.flush();
  f.render({ workspaceId: "B", generation: "generation-B" }); await f.flush(); f.render({ workspaceId: "A", generation: "generation-A" }); await f.flush();
  opening.resolve(inspected()); await f.flush(); assert.ok(!f.text().includes("fixture_change")); oldOpen(); assert.equal(reads, 1);
  f.button(t("ws.mcpReview.open")).props.onClick(); await f.flush(); const oldStart = f.button(t("ws.mcpReview.inspect")).props.onClick;
  f.render({ model: mock({ decideMcpReview: async () => { writes++; } }) }); await f.flush(); oldStart(); assert.equal(writes, 0); f.unmount(); oldStart(); assert.equal(writes, 0);
});

test("read-only, nonowner and dirty grant views expose no active approval path", async () => {
  const t = makeT("en"); let reads = 0;
  for (const patch of [{ readOnly: true }, { allowed: false, readOnly: true, sources: [] }]) {
    const f = mount(mock({ mcpReviews: async () => list("A", patch), describeMcpReview: async () => { reads++; } })); await f.flush();
    for (const button of f.nodes().filter(node => node.type === "button" && node.props.children === t("ws.mcpReview.open"))) assert.equal(button.props.disabled, true);
    f.unmount();
  }
  const dirty = mount(mock({ describeMcpReview: async () => { reads++; } }), { blocked: true }); await dirty.flush(); dirty.button(t("ws.mcpReview.open")).props.onClick(); await dirty.flush(); assert.equal(reads, 0); dirty.unmount();
});

test("all owner refusal reasons and review details have English, Simplified and Traditional copy", async () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale);
    for (const reason of MCP_REVIEW_REASONS) {
      const f = mount(mock({ describeMcpReview: async () => detail("A", { phase: "failed", canInspect: false, canApprove: false, reason }) }), { locale }); await f.flush(); f.button(t("ws.mcpReview.open")).props.onClick(); await f.flush();
      assert.ok(f.text().includes(t(`ws.mcpReview.${reason}`))); assert.doesNotMatch(f.text(), /ws\.mcpReview\./); f.unmount();
    }
  }
});

function modelFixture() {
  const calls = [], handlers = {}; let selectedAgentId = "main", epoch = 1;
  const snapshot = id => ({ workspaceId: id, resourceGeneration: `generation-${id}`, label: id, syntheticOnly: false, executionMode: "workspace", selectedAgentId,
    agents: [{ agentId: "main", agentEpoch: epoch, state: "active", kind: "main" }, { agentId: "colleague", agentEpoch: 1, state: "active", kind: "colleague" }], approvals: [], connections: { revision: 0, defaultConnectionId: null, connections: [] }, conversation: { history: [], state: "idle" } });
  const model = new WorkspaceDevModel({ supportsCapability: () => true, async request(method, params) {
    calls.push({ method, params }); if (handlers[method]) return handlers[method](params);
    if (method === "workspace.list") return { revision: 1, syntheticOnly: false, executionMode: "workspace", workspaces: ["A", "B"].map(workspaceId => ({ workspaceId, active: true })) };
    if (method === "workspace.agent.select") selectedAgentId = params.agentId;
    return snapshot(params.workspaceId);
  } }, () => "request", false, "workspace");
  handlers["workspace.extensions.review.list"] = params => list(params.workspaceId);
  handlers["workspace.extensions.review.describe"] = params => detail(params.workspaceId);
  handlers["workspace.extensions.review.inspect"] = params => inspected(params.workspaceId);
  handlers["workspace.extensions.review.approve"] = params => inspected(params.workspaceId, { phase: "approved", revision: 1, canApprove: false, hasReview: true });
  return { model, calls, handlers, setColleague: () => { selectedAgentId = "colleague"; }, bumpEpoch: () => epoch++ };
}

test("real Desk model sends only opaque record id, confirmation and normal scope; A-B-A cannot approve", async () => {
  const f = modelFixture(); await f.model.selectWorkspace("A"); await f.model.mcpReviews("A", "generation-A"); await f.model.describeMcpReview(recordId, "A", "generation-A");
  await f.model.decideMcpReview("inspect", recordId, "A", "generation-A"); await f.model.decideMcpReview("approve", recordId, "A", "generation-A");
  assert.deepEqual(f.calls.find(call => call.method.endsWith("review.approve")).params, { recordId, confirmed: true, workspaceId: "A", expectedGeneration: "generation-A" });
  assert.ok(f.calls.filter(call => call.method.includes("review.")).every(call => Object.keys(call.params).every(key => ["workspaceId", "expectedGeneration", "recordId", "confirmed"].includes(key))));
  await f.model.selectWorkspace("B"); await f.model.selectWorkspace("A"); const before = f.calls.length; await assert.rejects(f.model.decideMcpReview("approve", recordId, "A", "generation-A")); assert.equal(f.calls.length, before);
  await f.model.selectAgent("colleague"); const count = f.calls.length; await assert.rejects(f.model.mcpReviews("A", "generation-A")); assert.equal(f.calls.length, count);
});

test("owner DTO rejects wrong scope, mismatched record, impossible approval flags and duplicate tools", () => {
  assert.equal(mcpReviewList(list(), "A", "generation-A").allowed, true); mcpReviewDetail(inspected(), "A", "generation-A", recordId);
  for (const patch of [{ workspaceId: "B" }, { resourceGeneration: "old" }, { revision: -1 }, { allowed: false }]) assert.throws(() => mcpReviewList(list("A", patch), "A", "generation-A"));
  for (const patch of [{ recordId: "other" }, { phase: "failed" }, { reason: "schema_unsupported" }, { tools: [tools[0], tools[0]] }, { credentials: "inherited" }]) assert.throws(() => mcpReviewDetail(inspected("A", patch), "A", "generation-A", recordId));
});
