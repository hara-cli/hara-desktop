import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { makeT } from "../src/i18n.ts";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { extensionView } from "../src/workspace-extensions.ts";
const require = createRequire(import.meta.url), React = require("react");
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const sourceId = "global:host:docs", sourceRevision = "a".repeat(64);
const source = patch => ({ sourceId, sourceRevision, kind: "global", name: "Docs", transport: "stdio", executableSummary: "stdio · node", description: "Synthetic docs",
  tools: [{ toolId: "read", name: "Read docs", description: "Read synthetic documentation" }, { toolId: "search", name: "Search docs", description: "Search documentation" }],
  status: "ready", enabled: false, workspaceEnabled: false, allowedTools: [], assignedAgentCount: 0, ...patch });
const view = (workspaceId = "A", patch = {}) => ({ workspaceId, resourceGeneration: `generation-${workspaceId}`, revision: 0, readOnly: false, sources: [source()], ...patch });
const proposal = (change, revision = 0, workspaceId = "A") => ({ proposalId: "11111111-1111-4111-8111-111111111111", workspaceId, resourceGeneration: `generation-${workspaceId}`, revision, change });
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
  new Function("require", "exports", outputText)(name => name === "react" ? { ...React, ...hooks } : name === "./SettingsChrome" ? { SettingsAdvanced: props => props.children, SettingsAttention: () => null } : name === "./workspace-shell-hooks" ? { useWorkspaceLocale: () => ({ t: makeT(props.locale ?? "en"), locale: props.locale ?? "en" }) } : name.endsWith(".css") ? {} : require(name), exports);
  const render = (next = {}) => { props = { ...props, ...next }; cursor = 0; dirty = false; tree = exports.WorkspaceExtensions(props); effects.splice(0).forEach(effect => effect()); return tree; };
  const flush = async () => { await tick(); for (let count = 0; count < 24 && dirty; count++) { render(); await tick(); } };
  const nodes = () => { const list = []; const walk = value => { if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === "object" && value.props) { list.push(value); walk(value.props.children); } }; walk(tree); return list; };
  const text = value => Array.isArray(value) ? value.map(text).join("") : value && typeof value === "object" && value.props ? text(value.props.children) : typeof value === "string" || typeof value === "number" ? String(value) : "";
  const button = label => { const node = nodes().find(node => node.type === "button" && text(node) === label); assert.ok(node, label); return node; };
  const checks = () => nodes().filter(node => node.type === "input");
  const toggle = (index, checked) => { checks()[index].props.onChange({ target: { checked } }); render(); };
  const unmount = () => slots.forEach(slot => slot?.cleanup?.());
  render(); return { render, flush, nodes, button, checks, toggle, unmount, text: () => text(tree), dirtyEvents };
}
const mock = (patch = {}) => ({ supportsExtensions: () => true, extensions: async id => view(id), ...patch });

test("space enable and explicit tools are reviewed before approval; duplicate actions submit once and round-trip saved state", async () => {
  const proposing = deferred(), saving = deferred(), proposals = [], approvals = [];
  const f = mount(mock({ proposeExtensions: (...args) => { proposals.push(args); return proposing.promise; }, approveExtensions: (...args) => { approvals.push(args); return saving.promise; } }));
  await f.flush(); assert.equal(f.checks()[0].props.checked, false); assert.equal(f.checks()[1].props.checked, false);
  f.toggle(0, true); f.toggle(1, true); assert.equal(f.dirtyEvents.at(-1), true); assert.equal(proposals.length, 0);
  f.button("Review change").props.onClick(); f.button("Review change").props.onClick(); assert.equal(proposals.length, 1); assert.equal(approvals.length, 0);
  const change = proposals[0][0]; assert.deepEqual(change.allowedTools, ["read"]); assert.equal(change.target, "workspace");
  proposing.resolve(proposal(change)); await f.flush(); assert.match(f.text(), /Review plugin permissions/); assert.equal(f.checks()[0].props.disabled, true);
  f.button("Confirm change").props.onClick(); f.button("Confirm change").props.onClick(); assert.equal(approvals.length, 1); assert.equal(approvals[0][1], true);
  saving.resolve(view("A", { revision: 1, sources: [source({ enabled: true, workspaceEnabled: true, allowedTools: ["read"] })] })); await f.flush();
  assert.match(f.text(), /Permissions saved/); assert.equal(f.checks()[0].props.checked, true); assert.equal(f.checks()[1].props.checked, true); assert.equal(f.checks()[2].props.checked, false); assert.equal(f.dirtyEvents.at(-1), false); f.unmount();
});

test("saving one source preserves unrelated unsaved source drafts and keeps the leave guard dirty", async () => {
  const second = source({ sourceId: "global:host:other", name: "Other docs" });
  let current = view("A", { sources: [source(), second] });
  const f = mount(mock({ extensions: async () => current, proposeExtensions: async change => proposal(change, current.revision), approveExtensions: async (value, approved) => {
    if (approved) current = view("A", { revision: current.revision + 1, sources: [source({ enabled: value.change.enabled, workspaceEnabled: value.change.enabled }), second] }); return current;
  } }));
  await f.flush(); f.toggle(0, true); f.toggle(3, true);
  f.nodes().find(node => node.type === "button" && node.props.children === "Review change").props.onClick(); await f.flush();
  f.button("Confirm change").props.onClick(); await f.flush();
  assert.equal(f.checks()[0].props.checked, true); assert.equal(f.checks()[3].props.checked, true); assert.equal(f.dirtyEvents.at(-1), true);
  const reviews = f.nodes().filter(node => node.type === "button" && node.props.children === "Review change"); assert.equal(reviews[1].props.disabled, false);
  f.unmount();
});

test("colleague assignments carry exact epoch and expose only space-allowed tools; rejection changes no grant", async () => {
  const agent = { agentId: "main", agentEpoch: 7 }, calls = [];
  const current = view("A", { ...agent, sources: [source({ enabled: true, workspaceEnabled: true, allowedTools: ["read"], assignmentEnabled: false, assignedTools: [], effectiveTools: [] })] });
  const f = mount(mock({ extensions: async () => current, proposeExtensions: async change => { calls.push(change); return proposal(change); }, approveExtensions: async (_value, approved) => { calls.push(approved); return current; } }), { agent });
  await f.flush(); assert.equal(f.checks()[2].props.disabled, true); f.toggle(0, true); f.toggle(1, true);
  f.button("Review change").props.onClick(); await f.flush(); assert.equal(calls[0].target, "agent"); assert.equal(calls[0].agentEpoch, 7); assert.deepEqual(calls[0].allowedTools, ["read"]);
  f.button("Cancel change").props.onClick(); await f.flush(); assert.equal(calls[1], false); assert.equal(f.checks()[0].props.checked, false); f.unmount();
});

test("unsupported clients are unavailable and issue no discovery or mutation RPC", async () => {
  let calls = 0; const f = mount(mock({ supportsExtensions: () => false, extensions: async () => { calls++; } })); await f.flush();
  assert.match(f.text(), /Update Hara Core/); assert.equal(f.checks().length, 0); assert.equal(calls, 0); f.unmount();
});

test("read-only and space-disabled assignments cannot propose grants", async () => {
  let writes = 0;
  const a = mount(mock({ extensions: async () => view("A", { readOnly: true }), proposeExtensions: async () => { writes++; } }));
  await a.flush(); assert.equal(a.checks()[0].props.disabled, true); a.toggle(0, true); a.button("Review change").props.onClick(); assert.equal(writes, 0); a.unmount();
  const agent = { agentId: "main", agentEpoch: 1 };
  const b = mount(mock({ extensions: async () => view("A", { ...agent, sources: [source({ assignmentEnabled: false, assignedTools: [], effectiveTools: [] })] }) }), { agent });
  await b.flush(); assert.equal(b.checks()[0].props.disabled, true); assert.match(b.text(), /workspace settings first/); b.unmount();
});

test("unknown approval outcome blocks further changes until read-back; raw failures never render", async () => {
  let reads = 0, writes = 0;
  const f = mount(mock({ extensions: async () => view("A", reads++ ? { revision: 1, sources: [source({ enabled: true, workspaceEnabled: true, allowedTools: [] })] } : {}),
    proposeExtensions: async change => proposal(change), approveExtensions: async () => { writes++; throw Error("PRIVATE_SECRET"); } }));
  await f.flush(); f.toggle(0, true); f.button("Review change").props.onClick(); await f.flush(); f.button("Confirm change").props.onClick(); await f.flush();
  assert.match(f.text(), /not confirmed/); assert.doesNotMatch(f.text(), /PRIVATE_SECRET/); assert.equal(f.checks()[0].props.disabled, true);
  f.button("Review change").props.onClick(); assert.equal(writes, 1); f.button("Reload saved settings").props.onClick(); await f.flush();
  assert.equal(f.checks()[0].props.checked, true); assert.equal(f.checks()[0].props.disabled, false); assert.equal(f.dirtyEvents.at(-1), false); f.unmount();
});

test("load errors stay fixed and recover through a bounded manual reload", async () => {
  let reads = 0; const f = mount(mock({ extensions: async () => { if (!reads++) throw Error("PRIVATE_SECRET"); return view(); } }));
  await f.flush(); assert.match(f.text(), /Could not load/); assert.doesNotMatch(f.text(), /PRIVATE_SECRET/); assert.equal(f.checks().length, 0);
  f.button("Reload saved settings").props.onClick(); await f.flush(); assert.equal(f.checks().length, 3); f.unmount();
});

test("late A-B-A loads and old scope handlers cannot replace the current catalog or submit another scope", async () => {
  const old = deferred(); let reads = 0, writes = 0;
  const f = mount(mock({ extensions: async id => ++reads === 1 ? old.promise : view(id), proposeExtensions: async () => { writes++; } }));
  f.render({ workspaceId: "B", generation: "generation-B" }); await f.flush(); f.render({ workspaceId: "A", generation: "generation-A" }); await f.flush();
  old.resolve(view("A", { readOnly: true })); await f.flush(); assert.equal(f.checks()[0].props.disabled, false);
  f.toggle(0, true); const oldReview = f.button("Review change").props.onClick;
  f.render({ workspaceId: "B", generation: "generation-B" }); await f.flush(); oldReview(); assert.equal(writes, 0); f.unmount();
});

test("stale handlers remain inert after A-B-A or model replacement, and failed reloads disable old grants", async () => {
  let writes = 0, fail = false;
  const model = mock({ extensions: async id => { if (fail) throw Error("PRIVATE_SECRET"); return view(id); }, proposeExtensions: async () => { writes++; } });
  const f = mount(model); await f.flush(); f.toggle(0, true); const firstReview = f.button("Review change").props.onClick;
  f.render({ workspaceId: "B", generation: "generation-B" }); await f.flush(); f.render({ workspaceId: "A", generation: "generation-A" }); await f.flush(); firstReview(); assert.equal(writes, 0);
  f.toggle(0, true); const oldModelReview = f.button("Review change").props.onClick;
  f.render({ model: mock({ proposeExtensions: async () => { writes++; } }) }); await f.flush(); oldModelReview(); assert.equal(writes, 0); f.unmount();
  const g = mount(model); await g.flush(); fail = true; g.button("Reload saved settings").props.onClick(); await g.flush();
  assert.equal(g.checks()[0].props.disabled, true); assert.doesNotMatch(g.text(), /PRIVATE_SECRET/); g.unmount();
});

test("late proposal/approval completions after colleague epoch changes or unmount never update the new view", async () => {
  const saving = deferred(); const agent = { agentId: "main", agentEpoch: 1 };
  const f = mount(mock({ extensions: async (_id, _generation, selected) => view("A", { ...selected, sources: [source({ enabled: true, workspaceEnabled: true, allowedTools: ["read"], assignmentEnabled: false, assignedTools: [], effectiveTools: [] })] }),
    proposeExtensions: async change => proposal(change), approveExtensions: () => saving.promise }), { agent });
  await f.flush(); f.toggle(0, true); f.button("Review change").props.onClick(); await f.flush(); f.button("Confirm change").props.onClick();
  f.render({ agent: { ...agent, agentEpoch: 2 } }); await f.flush(); assert.equal(f.checks()[0].props.checked, false);
  f.unmount(); const dirtyCount = f.dirtyEvents.length;
  saving.resolve(view("A", { ...agent, revision: 1, sources: [source({ assignmentEnabled: true, assignedTools: [], effectiveTools: [] })] })); await f.flush();
  assert.equal(f.dirtyEvents.length, dirtyCount); assert.doesNotMatch(f.text(), /Permissions saved/);
});

test("plugin controls, review text and notices translate in all three locales", async () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const f = mount(mock(), { locale }); await f.flush(); assert.doesNotMatch(f.text(), /ws\.extensions\./); assert.match(f.text(), /MCP|插件|外掛/); f.unmount();
  }
});

function modelFixture(supported = true) {
  const calls = [], handlers = {}, epochs = { A: 1, B: 1 };
  const snapshot = id => ({ workspaceId: id, resourceGeneration: `generation-${id}`, label: id, syntheticOnly: false, executionMode: "workspace", selectedAgentId: "main",
    agents: [{ agentId: "main", agentEpoch: epochs[id], state: "active", kind: "main", identity: { displayName: "Hara" }, runtime: { id: "pi", label: "Pi", available: true } }],
    approvals: [], connections: { revision: 0, defaultConnectionId: null, connections: [] }, conversation: { history: [], state: "idle" } });
  const model = new WorkspaceDevModel({ supportsCapability: capability => supported && capability === "workspace.extensions.v1", async request(method, params) {
    calls.push({ method, params }); if (handlers[method]) return handlers[method](params);
    if (method === "workspace.list") return { revision: 1, syntheticOnly: false, executionMode: "workspace", workspaces: ["A", "B"].map(workspaceId => ({ workspaceId, active: true })) };
    return snapshot(params.workspaceId);
  } }, () => "request", false, "workspace");
  handlers["workspace.extensions.list"] = params => view(params.workspaceId);
  handlers["workspace.extensions.propose"] = params => proposal({ ...params.change, allowedTools: [...params.change.allowedTools].sort() }, params.expectedRevision, params.workspaceId);
  handlers["workspace.extensions.approve"] = params => view(params.workspaceId, { revision: 1 });
  return { model, calls, handlers, epochs };
}

test("actual model binds capability, scope, revision, approval and current colleague epoch", async () => {
  const f = modelFixture(); await f.model.selectWorkspace("A"); await f.model.extensions("A", "generation-A");
  const change = { target: "workspace", sourceId, sourceRevision, enabled: true, allowedTools: ["read"] };
  const proposed = await f.model.proposeExtensions(change, 0, "A", "generation-A");
  assert.equal(f.calls.some(row => row.method === "workspace.extensions.approve"), false);
  await f.model.approveExtensions(proposed, true);
  assert.deepEqual(f.calls.find(row => row.method === "workspace.extensions.approve").params, { proposalId: proposed.proposalId, approved: true, expectedRevision: 0, workspaceId: "A", expectedGeneration: "generation-A" });
  const before = f.calls.length; await assert.rejects(f.model.extensions("A", "generation-A", { agentId: "main", agentEpoch: 2 })); assert.equal(f.calls.length, before);
  await f.model.selectWorkspace("B"); const sent = f.calls.length; await assert.rejects(f.model.approveExtensions(proposed, true)); assert.equal(f.calls.length, sent);
  const old = modelFixture(false); await old.model.selectWorkspace("A"); const oldCalls = old.calls.length;
  await assert.rejects(old.model.extensions("A", "generation-A")); assert.equal(old.calls.length, oldCalls);
});

test("actual model rejects late results, changed epochs and malformed/scope-mismatched safe views", async () => {
  const f = modelFixture(), pending = deferred(); await f.model.selectWorkspace("A");
  f.handlers["workspace.extensions.list"] = () => pending.promise; const request = f.model.extensions("A", "generation-A");
  await f.model.selectWorkspace("B"); pending.resolve(view()); await assert.rejects(request);
  for (const patch of [{ workspaceId: "B" }, { resourceGeneration: "old" }, { revision: -1 }, { readOnly: undefined }, { sources: [source(), source()] }, { sources: [source({ allowedTools: ["unreviewed"] })] }]) assert.throws(() => extensionView(view("A", patch), "A", "generation-A"));
  await f.model.selectWorkspace("A"); const proposalPending = deferred(); f.handlers["workspace.extensions.propose"] = () => proposalPending.promise;
  const change = { target: "agent", agentId: "main", agentEpoch: 1, sourceId, sourceRevision, enabled: true, allowedTools: [] };
  const proposing = f.model.proposeExtensions(change, 0, "A", "generation-A"); f.epochs.A = 2; await f.model.refresh(); proposalPending.resolve(proposal(change)); await assert.rejects(proposing);
});


test("callable state and honest last-call diagnostics render in every locale without issuing a call", async () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) for (const outcome of ["server_reported_success", "outcome_unknown", "denied", "tool_error"]) {
    let writes = 0; const t = makeT(locale), row = source({ enabled: true, workspaceEnabled: true, allowedTools: ["read"], callable: true, managerStatus: "reviewed",
      lastCall: { at: "2026-11-04T04:00:00.000Z", durationMs: 25, toolId: "read", outcome, code: outcome === "server_reported_success" ? null : "mcp_schema_stale" } });
    extensionView(view("A", { sources: [row] }), "A", "generation-A");
    const f = mount(mock({ supportsExtensionManager: () => true, extensions: async () => view("A", { sources: [row] }), proposeExtensions: async () => { writes++; } }), { locale });
    await f.flush(); assert.ok(f.text().includes(t("ws.extensions.callable"))); assert.ok(f.text().includes(t("ws.extensions.lastCall")));
    assert.ok(f.text().includes(t(`ws.extensions.outcome.${outcome}`))); assert.ok(f.text().includes("25 ms"));
    assert.doesNotMatch(f.text(), /mcp_schema_stale|ws\.extensions\./); assert.equal(writes, 0); f.unmount();
  }
});

test("malformed or inconsistent invocation diagnostics fail closed instead of claiming callable", () => {
  const callable = source({ enabled: true, workspaceEnabled: true, allowedTools: ["read"], callable: true, managerStatus: "reviewed" });
  for (const patch of [{ managerStatus: "unreviewed" }, { workspaceEnabled: false }, { allowedTools: [] }, { status: "needs-review" },
    { lastCall: { at: "invalid", durationMs: 1, toolId: "read", outcome: "outcome_unknown", code: null } },
    { lastCall: { at: "2026-11-04", durationMs: -1, toolId: "read", outcome: "verified", code: "RAW_ERROR" } }]) {
    assert.throws(() => extensionView(view("A", { sources: [{ ...callable, ...patch }] }), "A", "generation-A"));
  }
  assert.throws(() => extensionView(view("A", { readOnly: true, sources: [callable] }), "A", "generation-A"));
});

test("S2b: tools fold into «a of b tools selected · used by n» and open by themselves on first enable; diagnostics sit in Details", async () => {
  const t = makeT("en"), f = mount(mock()); await f.flush();
  const tools = () => f.nodes().find(node => node.type === "details" && node.props.className === "wse-tools");
  assert.equal(f.text().includes(`${t("ws.extensions.toolSummary", { a: 0, b: 2 })} · ${t("ws.extensions.usedBy", { n: 0 })}`), true);
  assert.equal(tools().props.open, false, "folded until needed");
  f.toggle(0, true); assert.equal(tools().props.open, true, "switching the source on opens its tool list");
  const details = f.nodes().find(node => node.type === "details" && node.props.className === "wse-details");
  assert.ok(f.text().includes("stdio · stdio · node") || JSON.stringify(details.props.children).includes("stdio"), "transport and start command are inside Details");
  f.unmount();
});

test("S2b: one tool / one colleague read naturally", async () => {
  const t = makeT("en"), f = mount(mock({ extensions: async id => view(id, { sources: [source({ tools: [{ toolId: "read", name: "Read docs", description: "" }], assignedAgentCount: 1 })] }) })); await f.flush();
  assert.ok(f.text().includes(`${t("ws.extensions.toolSummaryOne", { a: 0 })} · ${t("ws.extensions.usedByOne")}`), f.text());
  assert.equal(t("ws.extensions.toolSummaryOne", { a: 1 }), "1 of 1 tool selected");
});

test("S2b: a source that changed after review is pinned at the top and the bar goes to its card", async () => {
  const t = makeT("en"), f = mount(mock({ extensions: async id => view(id, { sources: [source({ status: "needs-review" }), source({ sourceId: "global:host:ok", name: "Fine" })] }) })); await f.flush();
  const bar = f.nodes().find(node => Array.isArray(node.props.items));
  assert.deepEqual(bar.props.items.map(item => item.text), [t("ws.extensions.attentionReview", { name: "Docs" })]);
  assert.equal(bar.props.items[0].action.label, t("ws.extensions.attentionOpen"));
  assert.ok(f.nodes().some(node => node.type === "article" && node.props.id === `wse-${sourceId}`), "the card carries the id the bar scrolls to");
});

test("S2b: «Reload» is under Advanced in Settings, in the header when loading failed or in a colleague's panel; the two notes are one line", () => {
  assert.match(component, /\{supported && \(agent \|\| needsReload\) \? reload : null\}/);
  assert.match(component, /\{!agent && supported && !needsReload \? <SettingsAdvanced page="extensions" items=\{\[t\("ws\.extensions\.reloadShort"\)\]\}>\{reload\}<\/SettingsAdvanced> : null\}/);
  assert.match(component, /<p className="wse-note">\{t\(model\.supportsExtensionManager\?\.\(\) \? "ws\.extensions\.managerNoteLine" : "ws\.extensions\.noteLine"\)\}<\/p>/);
  assert.doesNotMatch(component, /ws\.extensions\.timing/);
});

test("S2b skills: id stays the name, «New version» visible, edit in ⋯, source and hash in Details, long note under Advanced", () => {
  const panels = readFileSync(new URL("../src/WorkspaceSettingsPanels.tsx", import.meta.url), "utf8");
  assert.match(panels, /<strong>\{row\.id\}<\/strong>\{newer \? <span className="wsd-skill-new">\{t\("ws\.skills\.newVersion"\)\}<\/span> : null\}/);
  assert.match(panels, /<SettingsRowMenu label=\{row\.id\} disabled=\{pending\} items=\{\[\{ id: "edit", label: t\("ws\.skills\.edit"\), onSelect: \(\) => void editSkill\(row\.id\) \}\]\} \/>/);
  assert.match(panels, /<details className="wsd-runtime-details"><summary>\{t\("ws\.skills\.details"\)\}<\/summary>[\s\S]*row\.version\.slice\(0, 12\)/);
  assert.match(panels, /<SettingsAdvanced page="skills" items=\{\[t\("ws\.skills\.howItWorks"\)\]\}><p>\{t\("ws\.skills\.note"\)\}<\/p><\/SettingsAdvanced>/);
});

test("review of #95: read-only viewers get a bar that asks the owner, with no button that would do nothing (L1)", async () => {
  const t = makeT("en"), f = mount(mock({ extensions: async id => view(id, { readOnly: true, sources: [source({ status: "needs-review" })] }) })); await f.flush();
  const bar = f.nodes().find(node => Array.isArray(node.props.items));
  assert.deepEqual(bar.props.items.map(item => [item.text, item.action]), [[t("ws.extensions.attentionReviewOwner", { name: "Docs" }), undefined]]);
});

for (const locale of ["zh-Hans", "en", "zh-Hant"]) test(`review of #95, M1: the one-line note says removing access blocks new calls, not that it «takes effect» (${locale})`, () => {
  const t = makeT(locale), want = { "zh-Hans": "撤权后立即阻止新的调用", en: "removing access immediately blocks new calls", "zh-Hant": "撤權後立即阻止新的呼叫" }[locale];
  for (const key of ["ws.extensions.noteLine", "ws.extensions.managerNoteLine"]) assert.ok(t(key).includes(want), `${key}: ${t(key)}`);
});

test("review of #95, L2: the four retired keys are gone from all locales and keys.json", () => {
  const keys = readFileSync(new URL("../src/locales/keys.json", import.meta.url), "utf8");
  for (const locale of ["zh-Hans", "en", "zh-Hant"]) {
    const strings = JSON.parse(readFileSync(new URL(`../src/locales/${locale}/ws.json`, import.meta.url), "utf8"));
    for (const key of ["ws.extensions.note", "ws.extensions.managerNote", "ws.extensions.timing", "ws.extensions.colleagues"]) { assert.equal(key in strings, false, `${locale} ${key}`); assert.equal(keys.includes(`"${key}"`), false, key); }
  }
});
