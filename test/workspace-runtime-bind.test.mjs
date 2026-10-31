import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { makeT } from "../src/i18n.ts";
import { workspaceMessageText } from "../src/workspace-settings-copy.ts";

const require = createRequire(import.meta.url), React = require("react");
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const Picker = () => null, Dialog = () => null;
const source = readFileSync(new URL("../src/WorkspaceRuntimeAccess.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} });

// Execute the component's real callbacks/effects with controlled promise completion order.
// Children stay shallow: the existing picker and ShellDialog have their own rendering tests.
function mount(patch = {}) {
  const slots = [], effects = [], requests = [], changes = [], registrations = [], models = [];
  let cursor = 0, dirty = false, tree, props;
  const hooks = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], next => {
        const value = typeof next === "function" ? next(slots[index]) : next;
        if (!Object.is(slots[index], value)) { slots[index] = value; dirty = true; }
      }];
    },
    useEffect(action, deps) {
      const index = cursor++, old = slots[index];
      if (!old || deps.some((dep, n) => !Object.is(dep, old.deps[n]))) effects.push(() => {
        old?.cleanup?.(); slots[index] = { deps, cleanup: action() };
      });
    },
  };
  const exports = {};
  new Function("require", "exports", outputText)(name => name === "react" ? { ...React, ...hooks }
    : name === "./i18n" ? { makeT } : name === "./AgentRuntimePicker" ? { WorkspaceAgentRuntimePicker: Picker }
    : name === "./WorkspaceShell" ? { ShellDialog: Dialog } : name === "./workspace-settings-copy" ? { workspaceMessageText } : require(name), exports);
  const agent = { agentId: "main", kind: "main", configRevision: 2, agentEpoch: 1, identity: { displayName: "Hara" },
    runtime: { id: "pi", label: "Pi", available: true } };
  props = { agent, workspace: { workspaceId: "fixture", resourceGeneration: "generation-1",
    runtimeOptions: [{ id: "pi", label: "Pi", available: true }, { id: "codex", label: "Codex", available: true }],
    conversation: { state: "completed", history: [] } }, locale: "en",
    listModels: async runtimeId => { requests.push(runtimeId); return { runtimeId, revision: 3, selectedModelId: runtimeId + "-one",
      models: [{ id: runtimeId + "-one", label: runtimeId + " model" }, { id: runtimeId + "-two", label: runtimeId + " second" }] }; },
    onApplyRuntime: async (id, restart) => { changes.push([id, restart]); props = { ...props, agent: { ...props.agent,
      configRevision: props.agent.configRevision + 1, runtime: { id, label: id, available: true } } }; },
    onApplyModel: async (...args) => models.push(args), onRescan: async () => {},
    onRegisterRuntime: async (...args) => registrations.push(args), onRuntimeDirectory() {}, ...patch };
  function render(next = {}) {
    props = { ...props, ...next }; dirty = false; cursor = 0;
    tree = exports.default(props);
    effects.splice(0).forEach(effect => effect());
    return tree;
  }
  const all = () => {
    const nodes = [];
    function visit(value) {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object") return;
      nodes.push(value); visit(value.props?.children);
    }
    visit(tree); return nodes;
  };
  const text = node => {
    if (Array.isArray(node)) return node.map(text).join("");
    if (typeof node === "string" || typeof node === "number") return String(node);
    return node?.props ? text(node.props.children) : "";
  };
  const button = label => {
    const node = all().find(node => node.type === "button" && text(node) === label);
    assert.ok(node, "button exists: " + label); return node;
  };
  async function flush() {
    for (let count = 0; count < 8; count++) { await tick(); if (dirty) render(); }
  }
  render();
  return { render, flush, all, text: () => text(tree), button, requests, changes, registrations, models, props: () => props,
    picker: () => all().find(node => node.type === Picker),
    dialog: () => all().find(node => node.type === Dialog) };
}

test("Apply opens a named confirmation before any binding RPC; cancel is read-only", async () => {
  const f = mount(); await f.flush();
  f.picker().props.onApply("codex"); f.render();
  assert.deepEqual(f.changes, []); assert.ok(f.dialog());
  assert.ok(f.text().includes("Switch Hara to Codex"));
  assert.ok(f.text().includes("Migrate conversation (keep)"));
  assert.ok(f.text().includes("Clean restart (fresh)"));
  assert.ok(f.text().includes("Neither choice transfers an engine session"));
  f.button("Cancel").props.onClick(); f.render();
  assert.equal(f.dialog(), undefined); assert.deepEqual(f.changes, []);
});

for (const restart of ["keep", "fresh"]) test("confirmation " + restart + " refreshes only the successfully bound runtime's models", async () => {
  const f = mount(); await f.flush();
  f.picker().props.onApply("codex"); f.render();
  if (restart === "fresh") { f.all().filter(node => node.type === "input")[1].props.onChange(); f.render(); }
  const confirm = f.button("Confirm runtime change");
  confirm.props.onClick(); confirm.props.onClick(); await f.flush();
  assert.deepEqual(f.changes, [["codex", restart]], "duplicate click has one effect");
  assert.equal(f.requests[0], "pi"); assert.equal(f.requests.at(-1), "codex");
  assert.equal(f.dialog(), undefined);
  assert.ok(f.all().some(node => node.type === "option" && node.props.value === "codex-two"));
  assert.equal(f.all().some(node => node.type === "option" && node.props.value === "pi-two"), false);
  f.all().find(node => node.type === "select").props.onChange({ target: { value: "codex-two" } }); f.render();
  f.button("Apply model").props.onClick(); await f.flush();
  assert.deepEqual(f.models, [["codex", "codex-two", 3]]);
  assert.equal(f.requests.at(-1), "codex");
});

test("empty, detected and missing have different guidance; rescan does not install or bind", async () => {
  let scans = 0;
  const f = mount({ workspace: { workspaceId: "fixture", resourceGeneration: "g1", runtimeOptions: [],
    conversation: { state: "completed" }, runtimes: { options: [
      { runtimeId: "codex", label: "Codex", state: "detected", registered: false, fingerprint: "fixture-fingerprint", path: "/fixture/codex" },
      { runtimeId: "claude", label: "Claude Code", state: "not_installed" },
    ] } }, onRescan: async () => { scans++; } });
  await f.flush();
  assert.ok(f.text().includes("No usable runtime"));
  assert.ok(f.text().includes("Codex detected"));
  assert.ok(f.text().includes("Claude Code · No usable installation"));
  assert.deepEqual(f.requests, []);
  f.button("Rescan local runtimes").props.onClick(); await f.flush();
  assert.equal(scans, 1); assert.deepEqual(f.changes, []); assert.deepEqual(f.registrations, []);
  f.button("Register for binding").props.onClick(); f.render();
  assert.equal(f.registrations.length, 0); assert.ok(f.dialog());
  f.button("Confirm registration").props.onClick(); await f.flush();
  assert.deepEqual(f.registrations, [["codex", "fixture-fingerprint"]]); assert.deepEqual(f.changes, []);
});

test("models arriving after a binding change cannot overwrite the new runtime", async () => {
  const old = deferred(), f = mount({ listModels: runtimeId => runtimeId === "pi" ? old.promise
    : Promise.resolve({ runtimeId, revision: 4, selectedModelId: "new-model", models: [{ id: "new-model", label: "New model" }] }) });
  f.render({ agent: { ...f.props().agent, runtime: { id: "codex", label: "Codex", available: true } } });
  await f.flush();
  old.resolve({ runtimeId: "pi", revision: 1, selectedModelId: "stale", models: [{ id: "stale", label: "Wrong model" }] });
  await f.flush();
  assert.ok(f.text().includes("New model")); assert.equal(f.text().includes("Wrong model"), false);
});

test("reject mismatched catalogs, expired confirmations and unavailable targets", async () => {
  const f = mount({ listModels: async () => ({ runtimeId: "claude", revision: 1, selectedModelId: "wrong", models: [{ id: "wrong", label: "Wrong model" }] }) });
  await f.flush(); assert.ok(f.text().includes("does not match")); assert.equal(f.text().includes("Wrong model"), false);
  f.picker().props.onApply("codex"); f.render();
  const confirm = f.button("Confirm runtime change");
  f.render({ agent: { ...f.props().agent, configRevision: 3 } });
  assert.equal(f.dialog(), undefined);
  confirm.props.onClick(); await f.flush(); assert.deepEqual(f.changes, []);
  f.picker().props.onApply("codex"); f.render();
  f.render({ workspace: { ...f.props().workspace, runtimeOptions: [{ id: "codex", label: "Codex", available: false, reason: "not_installed" }] } });
  assert.equal(f.button("Confirm runtime change").props.disabled, true);
  f.button("Confirm runtime change").props.onClick(); await f.flush(); assert.deepEqual(f.changes, []);
});

test("both Hara and colleagues use the same confirmation and active work blocks fresh", async () => {
  for (const kind of ["main", "colleague"]) {
    const f = mount();
    f.render({ agent: { ...f.props().agent, kind, identity: { displayName: kind === "main" ? "Hara" : "Dora" } },
      workspace: { ...f.props().workspace, conversation: { state: "running" } } });
    f.picker().props.onApply("codex"); f.render();
    assert.ok(f.text().includes("Switch " + (kind === "main" ? "Hara" : "Dora") + " to Codex"));
    assert.equal(f.all().filter(node => node.type === "input")[1].props.disabled, true);
  }
});

test("Settings directory link remains one-shot and only for the A-prime reasons", async () => {
  let opens = 0;
  const f = mount({ onRuntimeDirectory() { opens++; } });
  f.render({ workspace: { ...f.props().workspace, runtimeOptions: [{ id: "pi", label: "Pi", available: false, reason: "not_registered" }] } });
  f.button("Manage local runtimes… ↗").props.onClick(); f.render();
  assert.equal(opens, 1); assert.equal(f.text().includes("Manage local runtimes"), false);
});
