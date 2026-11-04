import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";
import * as stages from "../src/runtime-stage-events.ts";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { makeT } from "../src/i18n.ts";
import * as runtimeFailure from "../src/runtime-failure.ts";
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const workspaceId = `ws_${uuid(1)}`, agentId = `ag_${uuid(2)}`, generation = uuid(3), sessionId = uuid(4);
const history = [{ role: "user", content: "content must not be exported" }, { role: "assistant", text: "private reply", tools: [] }];
const event = (patch = {}) => ({ seq: 1, kind: "model_roundtrip", phase: "start", offsetMs: 10, durationMs: null,
  call: 1, toolName: null, outcome: null, source: "host", errorKind: null, ...patch });
const report = (patch = {}) => ({ schemaVersion: 1, workspaceId, resourceGeneration: generation, agentId, sessionId,
  runId: uuid(5), attemptId: uuid(6), historyStart: 0, runtime: { id: "codex", version: "0.166.0", loginSource: "host", model: "gpt-example", effort: "medium" },
  state: "completed", durationMs: 1200, errorKind: null,
  events: [event(), event({ seq: 2, phase: "end", offsetMs: 1100, durationMs: 1090, outcome: "completed" }),
    event({ seq: 3, kind: "first_output", phase: "mark", call: null, offsetMs: 1150, durationMs: null, source: "native_event" }),
    event({ seq: 4, kind: "complete", phase: "mark", call: null, offsetMs: 1200, durationMs: 1200, outcome: "completed" })], droppedEvents: 0, ...patch });
const scope = () => ({ workspaceId, resourceGeneration: generation, agentId, sessionId, history });
const receipt = () => ({ fileName: "runtime-feedback-00000000.json", path: "/fixture/diagnostics/runtime-feedback-00000000.json", bytes: 2048, sha256: "a".repeat(64) });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test("closed stage projection rejects unknown fields, content, credential-shaped metadata and unsafe measurements", () => {
  assert.deepEqual(stages.parseRuntimeStageReport(report()), report());
  for (const value of [report({ prompt: "secret prompt" }), report({ runtime: { ...report().runtime, token: "sk-do-not-show" } }),
    report({ runtime: { ...report().runtime, model: "sk-do-not-show" } }), report({ runtime: { ...report().runtime, model: "https://private.example/path" } }),
    report({ runtime: { ...report().runtime, model: "/Users/private/model" } }),
    report({ runtime: { ...report().runtime, model: "private/home/user" } }),
    report({ runtime: { ...report().runtime, model: "a".repeat(40) } }),
    report({ runtime: { ...report().runtime, effort: "sk-private" } }), report({ durationMs: -1 }), report({ historyStart: 4001 }),
    report({ runtime: { ...report().runtime, version: "error with a credential" } }),
    report({ events: [event({ output: "private native output" })] }), report({ events: [event({ durationMs: NaN })] })]) {
    assert.equal(stages.parseRuntimeStageReport(value), null);
  }
});
test("event order, bounds and missing token measurements stay honest across cancellation and truncated records", () => {
  assert.equal(stages.parseRuntimeStageReport(report({ events: [event({ seq: 2 }), event({ seq: 1 })] })), null);
  assert.equal(stages.parseRuntimeStageReport(report({ events: [event({ offsetMs: 10 }), event({ seq: 2, offsetMs: 5 })] })), null);
  assert.equal(stages.parseRuntimeStageReport(report({ events: Array.from({ length: 257 }, (_,i) => event({ seq: i+1 })) })), null);
  assert.equal(stages.parseRuntimeStageReport(report({ events: [event({ kind: "first_token", source: "host" })] })), null);
  const partial = report({ state: "cancelled", durationMs: 55, events: [event(), event({ seq: 200, kind: "complete", phase: "mark", call: null,
    offsetMs: 55, durationMs: 55, outcome: "cancelled" })], droppedEvents: 198 });
  assert.ok(stages.parseRuntimeStageReport(partial));
  const delivered = report({ events: report().events.map(row => row.kind === "first_output" ? { ...row, source: "host" } : row) });
  assert.ok(stages.parseRuntimeStageReport(delivered));
  assert.equal(stages.parseRuntimeStageReport(report({ state: "running" })), null);
  assert.equal(stages.parseRuntimeStageReport(report({ events: report().events.slice(0, 3) })), null);
  assert.ok(stages.parseRuntimeStageReport(report({ state: "incomplete", durationMs: null, events: [event()] })));
  const rows = stages.runtimeStageActivities(partial);
  assert.equal(rows[0].endRecorded, false); assert.equal(rows[0].durationMs, null);
  assert.equal(rows[1].kind, "complete"); assert.equal(rows[1].outcome, "cancelled");
  assert.equal(partial.events.some(row => row.kind === "first_token"), false);
});
test("projection binds workspace, generation, colleague, session and a real user-message anchor", () => {
  for (const patch of [{ workspaceId: `ws_${uuid(11)}` }, { resourceGeneration: uuid(12) }, { agentId: `ag_${uuid(13)}` },
    { sessionId: uuid(14) }, { historyStart: 1 }]) assert.deepEqual(stages.parseRuntimeStageReports([report(patch)], scope()), []);
  assert.equal(stages.parseRuntimeStageReports([report(), report()], scope()).length, 1);
  assert.deepEqual(stages.parseRuntimeStageReports(Array.from({ length: 17 }, () => report()), scope()), []);
  assert.deepEqual(stages.parseRuntimeStageReports([report({ arbitrary: "private" }), report()], scope()), [report()]);
});
test("round panels stay before the next user input and hide locally-cleared history", () => {
  const all = [...history, { role: "user", content: "next" }, { role: "assistant", text: "second", tools: [] }];
  const second = report({ historyStart: 2, attemptId: uuid(7), runId: uuid(8) });
  assert.deepEqual([...stages.runtimeStagesBefore([report(), second], all).keys()], [2,4]);
  const cleared = stages.runtimeStagesBefore([report(), second], all.slice(2), 2);
  assert.deepEqual([...cleared.keys()], [4]); assert.deepEqual(cleared.get(4), [second]);
});
test("file receipts accept only bounded local paths and metadata, never raw result bodies", () => {
  assert.deepEqual(stages.parseRuntimeDiagnosticReceipt(receipt()), receipt());
  for (const value of [{ ...receipt(), token: "secret" }, { ...receipt(), path: "https://private.example/file.json" },
    { ...receipt(), path: "/fixture/../runtime-feedback-00000000.json" }, { ...receipt(), fileName: "../unsafe.json" },
    { ...receipt(), path: "/fixture/another.json" }, { ...receipt(), path: "/fixture/\n"+receipt().fileName }, { ...receipt(), bytes: 0 }]) {
    assert.equal(stages.parseRuntimeDiagnosticReceipt(value), null);
  }
});
function modelFixture(capability = true) {
  const calls = []; let selected = workspaceId, exported = async () => receipt(), projectSnapshot = value => value;
  const snapshot = (id = workspaceId, selectedAgentId = agentId) => ({ workspaceId: id, resourceGeneration: generation, selectedAgentId, label: "Fixture",
    agents: [{ agentId: selectedAgentId, state: "active", kind: "main", identity: { displayName: "Hara" }, runtime: { id: "codex", label: "Codex", available: true } }],
    syntheticOnly: true, connections: { revision: 1, defaultConnectionId: "fixture", connections: [] }, approvals: [],
    conversation: { revision: 1, state: "completed", sessionId, taskId: uuid(15), runId: uuid(5), taskState: "completed", objective: "not diagnostics",
      history, pastTaskCount: 0, usage: { modelCalls: 1, inputTokens: 10, outputTokens: 2 }, runUsage: { modelCalls: 1, inputTokens: 10, outputTokens: 2 },
      completion: { state: "verified" }, runtimeStages: [report({ workspaceId: id, agentId: selectedAgentId })] } });
  const rpc = { supportsCapability: key => capability && key === "workspace.runtime-stage-events.v1", async request(method, params) {
    calls.push({ method, params });
    if (method === "workspace.list") return { revision: 1, syntheticOnly: true, activeWorkspaceId: selected,
      workspaces: [workspaceId, `ws_${uuid(20)}`].map(id => ({ workspaceId: id, label: id, active: true, role: "OWNER" })) };
    if (["workspace.select", "workspace.agent.select", "workspace.snapshot"].includes(method)) { selected = params.workspaceId; return projectSnapshot(snapshot(params.workspaceId, params.agentId)); }
    if (method === "workspace.runtime.diagnostics.export") return exported(params);
    return {};
  } };
  const model = new WorkspaceDevModel(rpc);
  return { model, calls, setExport: fn => { exported = fn; }, setSnapshot: fn => { projectSnapshot = fn; }, ready: () => model.selectWorkspace(workspaceId) };
}
test("local export feature-detects and sends only the existing attempt's six scope fields", async () => {
  const f = modelFixture(); await f.ready(); const stagesBefore = f.model.runtimeStageReports();
  assert.equal(stagesBefore.length, 1); assert.deepEqual(await f.model.exportRuntimeDiagnostic(stagesBefore[0]), receipt());
  assert.deepEqual(f.calls.find(row => row.method === "workspace.runtime.diagnostics.export").params,
    { workspaceId, expectedGeneration: generation, agentId, sessionId, runId: uuid(5), attemptId: uuid(6) });
  await assert.rejects(f.model.exportRuntimeDiagnostic(report({ attemptId: uuid(99) })), /ws.notice.scopeChanged/);
  const old = modelFixture(false); await old.ready(); assert.deepEqual(old.model.runtimeStageReports(), []);
  await assert.rejects(old.model.exportRuntimeDiagnostic(report()), /ws.stages.unsupported/);
  assert.equal(old.calls.some(row => row.method === "workspace.runtime.diagnostics.export"), false);
});
test("an export response cannot cross a workspace switch, and errors never expose raw server values", async () => {
  const f = modelFixture(); await f.ready(); const pending = deferred(); f.setExport(() => pending.promise);
  const exportPromise = f.model.exportRuntimeDiagnostic(f.model.runtimeStageReports()[0]);
  await f.model.selectWorkspace(`ws_${uuid(20)}`); pending.resolve(receipt());
  await assert.rejects(exportPromise, /ws.notice.scopeChanged/);
  f.setExport(async () => ({ ...receipt(), prompt: "never show this private text" }));
  await assert.rejects(f.model.exportRuntimeDiagnostic(f.model.runtimeStageReports()[0]), error => error.message === "ws.stages.exportFailed");
  f.setExport(async () => { throw Error("Bearer private-server-value"); });
  await assert.rejects(f.model.exportRuntimeDiagnostic(f.model.runtimeStageReports()[0]), error => error.message === "ws.stages.exportFailed");
});
test("late local-file receipts are fenced across resource, session, run and attempt refreshes", async () => {
  for (const change of [
    value => { value.resourceGeneration = uuid(70); value.conversation.runtimeStages[0].resourceGeneration = uuid(70); },
    value => { value.conversation.sessionId = uuid(71); value.conversation.runtimeStages[0].sessionId = uuid(71); },
    value => { value.conversation.runId = uuid(72); value.conversation.runtimeStages[0].runId = uuid(72); },
    value => { value.conversation.runtimeStages[0].attemptId = uuid(73); },
    value => { value.conversation.runtimeStages = []; },
  ]) {
    const f = modelFixture(); await f.ready(); const pending = deferred(); f.setExport(() => pending.promise);
    const exporting = f.model.exportRuntimeDiagnostic(f.model.runtimeStageReports()[0]);
    f.setSnapshot(value => { const next = structuredClone(value); change(next); return next; });
    await f.model.refresh(); pending.resolve(receipt());
    await assert.rejects(exporting, /ws.notice.scopeChanged/);
  }
});
const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: 'export { Transcript } from "./src/WorkspaceLocalDev.tsx"; export { WorkspaceRuntimeStages } from "./src/WorkspaceRuntimeStages.tsx";export { WorkspaceThemeSettings } from "./src/WorkspaceSettingsPanels.tsx";',
  resolveDir: root, loader: "tsx" }, bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"],
  loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
test("real turn panel renders all three locales, missing-token truth and separate overlapping waits", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale), html = renderToStaticMarkup(React.createElement(module.exports.WorkspaceRuntimeStages, { report: report({ events: report().events.map(row => row.kind === "first_output" ? { ...row, source: "host" } : row) }), t, alwaysShow: true, onExport: async () => receipt() }));
    for (const key of ["ws.stages.title", "ws.stages.firstUnknown", "ws.stages.overlap", "ws.stages.privacy", "ws.stages.export"]) assert.ok(html.includes(t(key)), key);
    assert.ok(html.includes(t("ws.stages.kind.model_roundtrip", { n: 1 })));
    assert.ok(html.includes("1.09 s")); assert.ok(html.includes("1.15 s"));
    assert.equal(html.includes("content must not be exported"), false); assert.equal(html.includes("private reply"), false);
    assert.equal(html.includes('open=""'), false); assert.equal(html.includes("ws.stages."), false);
  }
});
test("transcript anchors the panel after its reply and before the next input, never in cleared history", () => {
  const all = [...history, { role: "user", content: "next public question" }], t = makeT("en");
  const html = renderToStaticMarkup(React.createElement(module.exports.Transcript, { history: all, stages: [report()], t, alwaysShowTimingDiagnostics: true }));
  assert.ok(html.indexOf("private reply") < html.indexOf(t("ws.stages.title")));
  assert.ok(html.indexOf(t("ws.stages.title")) < html.indexOf("next public question"));
  const cleared = renderToStaticMarkup(React.createElement(module.exports.Transcript, { history: all.slice(2), historyOffset: 2, stages: [report()], t, alwaysShowTimingDiagnostics: true }));
  assert.equal(cleared.includes(t("ws.stages.title")), false);
});
const componentSource = readFileSync(new URL("../src/WorkspaceRuntimeStages.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(componentSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function mountedPanel(initial = {}) {
  const slots = [], effects = []; let cursor = 0, dirty = false, tree;
  let props = { report: report(), t: makeT("en"), alwaysShow: true, onExport: async () => receipt(), ...initial };
  const hooks = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; dirty = true; }]; },
    useEffect(fn, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((dep,n) => !Object.is(dep,old.deps[n]))) effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; }); },
  };
  const exports = {}; new Function("require", "exports", compiled)(name => name === "react" ? { ...React, ...hooks }
    : name === "./runtime-stage-events" ? stages : name === "./runtime-failure" ? runtimeFailure : name.endsWith(".css") ? {} : require(name), exports);
  function render(next = {}) { props = { ...props, ...next }; cursor = 0; dirty = false; tree = exports.WorkspaceRuntimeStages(props); effects.splice(0).forEach(fn => fn()); }
  function all(value = tree, nodes = []) { if (Array.isArray(value)) value.forEach(item => all(item,nodes)); else if (value && typeof value === "object") { nodes.push(value); all(value.props?.children,nodes); } return nodes; }
  function text(value = tree) { if (Array.isArray(value)) return value.map(item => text(item)).join(""); return typeof value === "string" || typeof value === "number" ? String(value) : value?.props ? text(value.props.children) : ""; }
  render(); return { render, text, button: () => all().find(node => node.type === "button"), async flush() { for(let i=0;i<8;i++){await tick();if(dirty)render();} } };
}
test("duplicate export clicks have one request and a late receipt stays outside a new attempt", async () => {
  const wait = deferred(); let calls = 0; const f = mountedPanel({ onExport: async () => { calls++; return wait.promise; } });
  f.button().props.onClick(); f.button().props.onClick(); await f.flush(); assert.equal(calls, 1);
  f.render({ report: report({ attemptId: uuid(90) }) }); wait.resolve(receipt()); await f.flush();
  assert.equal(f.text().includes(receipt().path), false); assert.equal(f.text().includes(makeT("en")("ws.stages.saved")), false);
});
test("export failure keeps a fixed message and never reports a file as saved", async () => {
  const f = mountedPanel({ onExport: async () => { throw Error("secret-server-value"); } }); f.button().props.onClick(); await f.flush();
  assert.ok(f.text().includes(makeT("en")("ws.stages.exportFailed")));
  assert.equal(f.text().includes("secret-server-value"), false); assert.equal(f.text().includes(makeT("en")("ws.stages.saved")), false);
});

test("a successful local receipt appears only after the export request resolves", async () => {
  const pending = deferred(), f = mountedPanel({ onExport: () => pending.promise });
  f.button().props.onClick(); await f.flush();
  assert.equal(f.text().includes(makeT("en")("ws.stages.saved")), false);
  assert.equal(f.text().includes(receipt().path), false);
  pending.resolve(receipt()); await f.flush();
  assert.ok(f.text().includes(makeT("en")("ws.stages.saved")));
  assert.ok(f.text().includes(receipt().path)); assert.ok(f.text().includes(receipt().sha256));
});

test("metadata parser rejects trailing control whitespace in versions, models and tool names", () => {
  for (const suffix of ["\n", "\r", "\t", " "]) {
    for (const runtime of [{ ...report().runtime, version: "1.2.3" + suffix }, { ...report().runtime, model: "provider/model" + suffix }])
      assert.equal(stages.parseRuntimeStageReport(report({ runtime })), null);
    assert.equal(stages.parseRuntimeStageReport(report({ events: report().events.map((row, index) => index === 0 ? { ...row, toolName: "workspace_read" + suffix } : row) })), null);
  }
});

test("stage reports retain inherited mode only for the approved expanded runtimes", () => {
  for (const id of ["copilot", "cursor", "grok"]) {
    const value = report({ runtime: { ...report().runtime, id, extensionsIsolation: "inherited" } });
    assert.deepEqual(stages.parseRuntimeStageReport(value), value);
    assert.equal(stages.parseRuntimeStageReport(report({ runtime: { ...value.runtime, extensionsIsolation: "PRIVATE" } })), null);
  }
  for (const id of ["pi", "claude", "codex", "opencode"]) assert.equal(stages.parseRuntimeStageReport(report({ runtime: { ...report().runtime, id, extensionsIsolation: "inherited" } })), null);
});


test("normal turns are hidden by default; only failed or measured-over-30-second turns get a compact closed row", () => {
  const render = props => renderToStaticMarkup(React.createElement(module.exports.WorkspaceRuntimeStages, { t: makeT("en"), ...props }));
  assert.equal(render({ report: report() }), "");
  const slow = durationMs => report({ durationMs, events: [...report().events.slice(0, -1), event({ seq: 4, kind: "complete", phase: "mark", call: null, offsetMs: durationMs, durationMs, outcome: "completed" })] });
  assert.equal(render({ report: slow(30000) }), "");
  const slowHtml = render({ report: slow(30001) });
  assert(slowHtml.includes('data-stage-display="compact"')); assert.equal(slowHtml.includes('open=""'), false);
  const failed = report({ state: "error", errorKind: "runtime_failed", events: report().events.map(row => row.kind === "complete" ? { ...row, outcome: "error", errorKind: "runtime_failed" } : row) });
  assert(render({ report: failed }).includes('data-stage-display="compact"'));
  assert(render({ report: report(), alwaysShow: true }).includes('data-stage-display="always"'));
  const running = report({ state: "running", durationMs: null, events: [event(), event({ seq: 2, kind: "first_token", phase: "mark", offsetMs: 30001, call: null, source: "provider_stream" })] });
  assert(render({ report: running }).includes('data-stage-display="compact"'));
});

test("hiding a short turn does not trim the complete safe diagnostic or its copy/export scope", async () => {
  const f = modelFixture(); await f.ready(); const reports = f.model.runtimeStageReports();
  assert.equal(stages.showRuntimeStageReport(reports[0]), false);
  const text = stages.runtimeStageDiagnosticsText(reports);
  assert.deepEqual(JSON.parse(text).runtimeStages, reports);
  assert.equal(stages.runtimeStageDiagnosticsText([report({ prompt: "PRIVATE" })]), null);
  const diagnostic = { runtime: "codex", kind: "runtime_failed", version: "1.2.3", loginSource: "host", homeMatchesAccount: true, elapsedMs: 1200, consecutiveFailures: 1, retryAtMs: 0 };
  const summary = runtimeFailure.runtimeDiagnosticSummary(diagnostic, makeT("zh-Hant"), reports), copied = [];
  assert.equal(await runtimeFailure.copyRuntimeDiagnostic(summary, async value => copied.push(value)), "copied");
  assert(copied[0].includes(text)); assert.equal(copied[0].includes("private reply"), false);
  assert.deepEqual(await f.model.exportRuntimeDiagnostic(reports[0]), receipt());
});

test("the timing preference is saved explicitly with a fresh revision without resending other fields", async () => {
  const calls = [], model = new WorkspaceDevModel({ async request(method, params) { calls.push({ method, params });
    return method === "workspace.preferences.get" ? { theme: "dark", revision: 7, alwaysShowTimingDiagnostics: false } : { theme: "dark", revision: 8, alwaysShowTimingDiagnostics: params.alwaysShowTimingDiagnostics }; } });
  assert.equal((await model.saveTimingDiagnosticsPreference(true)).alwaysShowTimingDiagnostics, true);
  assert.deepEqual(calls.map(row => row.method), ["workspace.preferences.get", "workspace.preferences.set"]);
  assert.deepEqual(calls[1].params, { theme: "dark", expectedRevision: 7, alwaysShowTimingDiagnostics: true });
});


test("the always-show switch is off by default and has explicit labels in all three locales", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) for (const enabled of [undefined, true]) {
    const t = makeT(locale), theme = { preference: "system", appearance: { darkTheme: "violet-glass", motion: "standard", transparency: "standard" },
      settings: { theme: "system", readOnly: false, alwaysShowTimingDiagnostics: enabled }, notice: "", change() {}, chooseTheme() {}, changeAppearance() {}, changeDetails() {}, changeTimingDiagnostics() {} };
    const html = renderToStaticMarkup(React.createElement(module.exports.WorkspaceThemeSettings, { theme, locale }));
    const toggle = (html.match(/<button[^>]*>/g) ?? []).find(tag => tag.includes('aria-label="' + t("ws.stages.alwaysShow") + '"'));
    assert(toggle, locale); assert(toggle.includes('aria-checked="' + (enabled === true ? "true" : "false") + '"'));
  }
});
