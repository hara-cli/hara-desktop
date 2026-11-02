import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { makeT } from "../src/i18n.ts";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { normalizeRuntimeProxyUrl, runtimeProxyView } from "../src/workspace-runtime-proxy.ts";

const require = createRequire(import.meta.url), React = require("react"), tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const view = (workspaceId = "A", proxyUrl = null, patch = {}) => ({ workspaceId, resourceGeneration: `generation-${workspaceId}`, revision: 0, proxyUrl, readOnly: false, ...patch });
const source = readFileSync(new URL("../src/WorkspaceRuntimeProxy.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });

// Execute the form's actual events and effects with deferred RPCs; no DOM/network dependency.
function mount(model, patch = {}) {
  const slots = [], effects = [], dirtyEvents = [];
  let cursor = 0, dirty = false, tree, props = { model, workspaceId: "A", generation: "generation-A", onDirty: value => dirtyEvents.push(value), ...patch };
  const hooks = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], next => { const value = typeof next === "function" ? next(slots[index]) : next; if (!Object.is(slots[index], value)) { slots[index] = value; dirty = true; } }]; },
    useEffect(action, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((dep, n) => !Object.is(dep, old.deps[n]))) effects.push(() => {
      old?.cleanup?.(); slots[index] = { deps, cleanup: action() };
    }); },
  };
  const exports = {};
  new Function("require", "exports", outputText)(name => name === "react" ? { ...React, ...hooks }
    : name === "./workspace-shell-hooks" ? { useWorkspaceLocale: () => ({ t: makeT(props.locale ?? "en") }) }
    : name === "./workspace-runtime-proxy.ts" ? { normalizeRuntimeProxyUrl } : require(name), exports);
  function render(next = {}) { props = { ...props, ...next }; cursor = 0; dirty = false; tree = exports.WorkspaceRuntimeProxy(props); effects.splice(0).forEach(effect => effect()); return tree; }
  async function flush() { await tick(); for (let count = 0; count < 20 && dirty; count++) { render(); await tick(); } return tree; }
  function nodes() { const result = []; const visit = value => { if (Array.isArray(value)) return value.forEach(visit); if (value && typeof value === "object" && value.props) { result.push(value); visit(value.props.children); } }; visit(tree); return result; }
  function text(value) { if (Array.isArray(value)) return value.map(text).join(""); if (value && typeof value === "object" && value.props) return text(value.props.children); return typeof value === "string" ? value : ""; }
  const input = () => nodes().find(node => node.type === "input");
  const submit = () => nodes().find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  const button = label => { const found = nodes().find(node => node.type === "button" && text(node) === label); assert.ok(found, label); return found; };
  const change = value => { input().props.onChange({ target: { value } }); render(); };
  const unmount = () => slots.forEach(slot => slot?.cleanup?.());
  render(); return { render, flush, nodes, input, submit, button, change, text: () => text(tree), dirtyEvents, unmount };
}

test("proxy input supports explicit HTTP/HTTPS and rejects credentials, remote paths and bypass syntax", () => {
  assert.equal(normalizeRuntimeProxyUrl("  "), null);
  assert.equal(normalizeRuntimeProxyUrl("http://127.0.0.1:18888"), "http://127.0.0.1:18888");
  assert.equal(normalizeRuntimeProxyUrl("https://[::1]:8443"), "https://[::1]:8443");
  for (const value of ["socks5://localhost:1080", "http://user:secret@localhost:80", "http://@localhost:80", "http://localhost/path", "http://localhost?", "http://localhost#", "http://local host", "http://localhost/\nsecret"]) assert.throws(() => normalizeRuntimeProxyUrl(value));
});

test("blank inherited setting can save an explicit proxy, deduplicate submit, then clear to null", async () => {
  const saved = deferred(), writes = []; let current = view();
  const f = mount({ runtimeProxy: async () => current, saveRuntimeProxy: (...args) => { writes.push(args); return writes.length === 1 ? saved.promise : Promise.resolve(current = view("A", null, { revision: 2 })); } });
  assert.equal(f.input().props.disabled, true); await f.flush(); assert.equal(f.input().props.value, "");
  f.change("http://127.0.0.1:18888"); assert.equal(f.dirtyEvents.at(-1), true); f.submit(); f.submit();
  assert.deepEqual(writes, [["http://127.0.0.1:18888", 0, "A", "generation-A"]]); await f.flush(); assert.equal(f.input().props.disabled, true);
  current = view("A", "http://127.0.0.1:18888", { revision: 1 }); saved.resolve(current); await f.flush();
  assert.equal(f.input().props.value, current.proxyUrl); assert.equal(f.dirtyEvents.at(-1), false);
  assert.match(f.text(), /Proxy connectivity has not been tested/);
  f.button("Use inherited environment").props.onClick(); await f.flush();
  assert.deepEqual(writes[1], [null, 1, "A", "generation-A"]); assert.equal(f.input().props.value, ""); f.unmount();
});

test("read-only settings and invalid proxy drafts never submit a mutation", async () => {
  let writes = 0;
  const readonly = mount({ runtimeProxy: async () => view("A", null, { readOnly: true }), saveRuntimeProxy: async () => { writes++; } });
  await readonly.flush(); readonly.submit(); assert.equal(readonly.input().props.disabled, true); assert.match(readonly.text(), /read-only/); readonly.unmount();
  const editable = mount({ runtimeProxy: async () => view(), saveRuntimeProxy: async () => { writes++; } });
  await editable.flush(); editable.change("http://user:secret@localhost:18888"); editable.submit(); await editable.flush();
  assert.match(editable.text(), /without credentials/); assert.equal(writes, 0); editable.unmount();
});

test("load failure stays disabled and a manual reload recovers without showing raw errors", async () => {
  let reads = 0;
  const f = mount({ runtimeProxy: async () => { if (++reads === 1) throw Error("private-credential"); return view(); } });
  await f.flush(); assert.equal(f.input().props.disabled, true); assert.match(f.text(), /Could not load/); assert.doesNotMatch(f.text(), /private-credential/);
  f.button("Reload saved settings").props.onClick(); await f.flush(); assert.equal(f.input().props.disabled, false); assert.equal(reads, 2); f.unmount();
});

test("unknown save outcome requires a reload before any further mutation", async () => {
  let writes = 0, reads = 0;
  const f = mount({ runtimeProxy: async () => { reads++; return view("A", reads === 1 ? null : "http://localhost:18888", { revision: reads - 1 }); },
    saveRuntimeProxy: async () => { writes++; throw Error("private-credential"); } });
  await f.flush(); f.change("http://localhost:18888"); f.submit(); await f.flush();
  assert.equal(f.input().props.disabled, true); assert.match(f.text(), /Saving is not yet confirmed/); assert.doesNotMatch(f.text(), /private-credential/);
  f.submit(); assert.equal(writes, 1); assert.equal(f.dirtyEvents.at(-1), true);
  f.button("Reload saved settings").props.onClick(); await f.flush(); assert.equal(f.input().props.value, "http://localhost:18888"); assert.equal(f.input().props.disabled, false); f.unmount();
});

test("old load/save completions cannot overwrite another workspace, even after returning to the first scope", async () => {
  const old = deferred(), writing = deferred(); let reads = 0;
  const model = { runtimeProxy: async id => { reads++; return reads === 1 ? old.promise : view(id, id === "A" ? "http://localhost:18888" : null); }, saveRuntimeProxy: () => writing.promise };
  const f = mount(model); f.render({ workspaceId: "B", generation: "generation-B" }); await f.flush();
  f.render({ workspaceId: "A", generation: "generation-A" }); await f.flush();
  old.resolve(view("A", "http://obsolete.invalid")); await f.flush(); assert.equal(f.input().props.value, "http://localhost:18888");
  f.change("http://localhost:18889"); f.submit(); f.render({ workspaceId: "B", generation: "generation-B" }); await f.flush();
  writing.resolve(view("A", "http://localhost:18889", { revision: 1 })); await f.flush();
  assert.equal(f.input().props.value, ""); assert.doesNotMatch(f.text(), /Saved\./); f.unmount();
});

test("unmounted forms ignore a pending save and old-view submit handlers cannot write another scope", async () => {
  const writing = deferred(), writes = [];
  const f = mount({ runtimeProxy: async id => view(id), saveRuntimeProxy: (...args) => { writes.push(args); return writing.promise; } });
  await f.flush(); f.change("http://localhost:18888"); const oldSubmit = f.nodes().find(node => node.type === "form").props.onSubmit;
  f.render({ workspaceId: "B", generation: "generation-B" }); await f.flush(); oldSubmit({ preventDefault() {} }); assert.equal(writes.length, 0);
  f.change("http://localhost:18889"); f.submit(); await f.flush(); f.unmount(); const afterUnmount = f.dirtyEvents.length;
  writing.resolve(view("B", "http://localhost:18889", { revision: 1 })); await f.flush();
  assert.equal(f.dirtyEvents.length, afterUnmount); assert.doesNotMatch(f.text(), /Saved\./);
});

test("runtime proxy notices and controls are translated in all three locales", async () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const f = mount({ runtimeProxy: async () => view() }, { locale }); await f.flush();
    assert.doesNotMatch(f.text(), /ws\.runtimeProxy\./); assert.match(f.text(), /Codex/); assert.match(f.text(), /HTTP/); f.unmount();
  }
});

function modelFixture() {
  const calls = [], handlers = {};
  const snapshot = id => ({ workspaceId: id, resourceGeneration: `generation-${id}`, label: id, syntheticOnly: false, executionMode: "workspace", selectedAgentId: "main", agents: [], approvals: [],
    connections: { revision: 0, defaultConnectionId: null, connections: [] }, conversation: { history: [], state: "idle" } });
  const model = new WorkspaceDevModel({ async request(method, params) {
    calls.push({ method, params }); if (handlers[method]) return handlers[method](params);
    if (method === "workspace.list") return { revision: 1, syntheticOnly: false, executionMode: "workspace", workspaces: ["A", "B"].map(workspaceId => ({ workspaceId, active: true })) };
    return snapshot(params.workspaceId);
  } }, () => "request", false, "workspace");
  handlers["workspace.runtime.proxy.get"] = params => view(params.workspaceId);
  handlers["workspace.runtime.proxy.set"] = params => view(params.workspaceId, params.proxyUrl, { revision: params.expectedRevision + 1 });
  return { model, calls, handlers };
}

test("model proxy RPCs bind workspace/generation and reject stale callers before sending", async () => {
  const f = modelFixture(); await f.model.selectWorkspace("A");
  assert.deepEqual(await f.model.runtimeProxy("A", "generation-A"), view());
  await f.model.saveRuntimeProxy(null, 0, "A", "generation-A");
  assert.deepEqual(f.calls.filter(row => row.method.startsWith("workspace.runtime.proxy")), [
    { method: "workspace.runtime.proxy.get", params: { workspaceId: "A", expectedGeneration: "generation-A" } },
    { method: "workspace.runtime.proxy.set", params: { proxyUrl: null, expectedRevision: 0, workspaceId: "A", expectedGeneration: "generation-A" } },
  ]);
  await f.model.selectWorkspace("B"); const before = f.calls.length;
  await assert.rejects(f.model.saveRuntimeProxy("http://localhost:18888", 0, "A", "generation-A"));
  await assert.rejects(f.model.saveRuntimeProxy(null, 0, "B", "generation-A"));
  assert.equal(f.calls.length, before);
});

test("model rejects late RPC results and malformed or cross-workspace proxy views", async () => {
  const f = modelFixture(), old = deferred(); await f.model.selectWorkspace("A");
  f.handlers["workspace.runtime.proxy.get"] = () => old.promise;
  const reading = f.model.runtimeProxy("A", "generation-A"); await f.model.selectWorkspace("B"); old.resolve(view()); await assert.rejects(reading);
  for (const patch of [{ workspaceId: "other" }, { resourceGeneration: "other" }, { revision: -1 }, { readOnly: undefined }, { proxyUrl: "http://user:secret@localhost" }, { proxyUrl: undefined }]) assert.throws(() => runtimeProxyView(view("A", null, patch), "A", "generation-A"));
});
