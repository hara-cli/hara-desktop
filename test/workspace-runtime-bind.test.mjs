import * as runtimeExpansion from "../src/runtime-expansion.ts";
import * as runtimeVersion from "../src/runtime-version-drift.ts";
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
    : name === "./runtime-version-drift" ? runtimeVersion : name === "./WorkspaceRuntimeVersion" ? { WorkspaceRuntimeVersion: () => null }
    : name === "./WorkspaceShell" ? { ShellDialog: Dialog } : name === "./workspace-settings-copy" ? { workspaceMessageText } : name === "./runtime-expansion" ? runtimeExpansion : require(name), exports);
  const agent = { agentId: "main", kind: "main", configRevision: 2, agentEpoch: 1, identity: { displayName: "Hara" },
    runtime: { id: "pi", label: "Pi", available: true } };
  props = { agent, workspace: { workspaceId: "fixture", resourceGeneration: "generation-1",
    runtimeOptions: [{ id: "pi", label: "Pi", available: true }, { id: "codex", label: "Codex", available: true }],
    connections: { revision: 1, activeConnectionId: "primary", defaultConnectionId: "primary",
      connections: [{ id: "primary", status: "active", defaultModel: "pi-one" }] },
    conversation: { state: "completed", history: [] } }, locale: "en",
    connectionModelSupported: true,
    listModels: async runtimeId => { requests.push(runtimeId); return { runtimeId, revision: 3, selectedModelId: runtimeId + "-one",
      models: [{ id: runtimeId + "-one", label: runtimeId + " model" }, { id: runtimeId + "-two", label: runtimeId + " second" }] }; },
    listConnectionModels: async (_agentId, connectionId) => { const result = await props.listModels("pi");
      if (result.runtimeId !== "pi") throw Error("model catalog does not match current binding");
      return { ...result, connectionId, source: "live" }; },
    onApplyRuntime: async (id, restart) => { changes.push([id, restart]); props = { ...props, agent: { ...props.agent,
      configRevision: props.agent.configRevision + 1, runtime: { id, label: id, available: true } } }; },
    onApplyModel: async (...args) => models.push(args), onApplyConnectionModel: async (...args) => models.push(args), onRescan: async () => {},
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

test("Pi connection catalog marks documented results and applies model with its connection revision", async () => {
  const f = mount({ listConnectionModels: async (_agentId, connectionId) => ({ connectionId, revision: 7,
    source: "documented", selectedModelId: "pi-one", selectedEffort: null,
    models: [{ id: "pi-one", label: "Pi one" }, { id: "pi-two", label: "Pi two", supportedReasoningEfforts: ["off", "high"] }] }) });
  await f.flush();
  assert.ok(f.text().includes("Documented list, not live"));
  f.all().find(node => node.type === "select" && node.props["aria-label"] === "This Hara colleague's model").props.onChange({ target: { value: "pi-two" } }); f.render();
  f.all().find(node => node.type === "select" && node.props["aria-label"] === "Reasoning effort").props.onChange({ target: { value: "high" } }); f.render();
  f.button("Apply model").props.onClick(); await f.flush();
  assert.deepEqual(f.models, [["primary", "pi-two", 7, "high"]]);
});

for (const [levels, expected] of [
  [["low", "medium", "high", "max"], ""],
  [["off", "low", "high"], ""],
]) test(`a new Codex model stays automatic with ${levels.join(",")}`, async () => {
  const f = mount({ agent: { agentId: "main", kind: "main", configRevision: 2, agentEpoch: 1,
    identity: { displayName: "Hara" }, runtime: { id: "codex", label: "Codex", available: true } },
  listModels: async () => ({ runtimeId: "codex", revision: 1, selectedModelId: "codex-one", selectedEffort: null,
    models: [{ id: "codex-one", label: "Codex one" }, { id: "codex-two", label: "Codex two", supportedReasoningEfforts: levels }] }) });
  await f.flush();
  f.all().find(node => node.type === "select" && node.props["aria-label"] === "This Hara colleague's model")
    .props.onChange({ target: { value: "codex-two" } }); f.render();
  assert.ok(f.text().includes("Automatic uses low effort for short answers"));
  assert.equal(f.all().find(node => node.type === "select" && node.props["aria-label"] === "Reasoning effort").props.value, expected);
  f.button("Apply model").props.onClick(); await f.flush();
  assert.deepEqual(f.models, [["codex", "codex-two", 1, null]]);
});

test("OpenCode model card omits effort and its registration card offers host login only", async () => {
  const f = mount({ agent: { agentId: "main", kind: "main", configRevision: 2, agentEpoch: 1,
    identity: { displayName: "Hara" }, runtime: { id: "opencode", label: "OpenCode", available: false } },
    workspace: { workspaceId: "fixture", resourceGeneration: "generation-1", conversation: { state: "completed", history: [] },
      runtimeOptions: [{ id: "opencode", label: "OpenCode", available: false, reason: "not_registered" }],
      runtimes: { options: [{ runtimeId: "opencode", label: "OpenCode", state: "detected", registered: false,
        installed: true, fingerprint: "fixture", path: "/fixture/opencode", loginSource: "isolated" }] } } });
  await f.flush();
  f.button(makeT("en")("ws.runtimeAccess.register")).props.onClick(); f.render();
  const radios = f.all().filter(node => node.type === "input" && node.props.type === "radio" && node.props.name === "inspector-login-source");
  assert.equal(radios.length, 1);
  assert.equal(radios[0].props.checked, true);
  assert.equal(f.text().includes("Reasoning effort"), false);
  f.button(makeT("en")("ws.runtimes.register")).props.onClick(); await f.flush();
  assert.deepEqual(f.registrations, [["opencode", "fixture", "host"]]);
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
  f.all().find(node => node.type === "select" && node.props["aria-label"] === "This Hara colleague's model").props.onChange({ target: { value: "codex-two" } }); f.render();
  f.button("Apply model").props.onClick(); await f.flush();
  assert.deepEqual(f.models, [["codex", "codex-two", 3, null]]);
  assert.equal(f.requests.at(-1), "codex");
});

test("empty, detected and missing have different guidance; rescan does not install or bind", async () => {
  let scans = 0;
  const f = mount({ agent: { agentId: "main", kind: "main", configRevision: 2, agentEpoch: 1, identity: { displayName: "Hara" },
    runtime: { id: "claude", label: "Claude Code", available: false } },
    workspace: { workspaceId: "fixture", resourceGeneration: "g1", runtimeOptions: [{ id: "claude", label: "Claude Code", available: false, reason: "not_installed" }],
    conversation: { state: "completed" }, runtimes: { options: [
      { runtimeId: "codex", label: "Codex", state: "detected", registered: false, fingerprint: "fixture-fingerprint", path: "/fixture/codex" },
      { runtimeId: "claude", label: "Claude Code", state: "not_installed" },
    ] } }, onRescan: async () => { scans++; } });
  await f.flush();
  assert.ok(f.text().includes("No usable runtime"));
  assert.ok(f.text().includes(makeT("en")("ws.runtimeAccess.detected", { runtime: "Codex" })));
  assert.ok(f.text().includes("Claude Code · No usable installation"));
  assert.deepEqual(f.requests, []);
  f.button("Rescan local runtimes").props.onClick(); await f.flush();
  assert.equal(scans, 1); assert.deepEqual(f.changes, []); assert.deepEqual(f.registrations, []);
  f.button(makeT("en")("ws.runtimeAccess.register")).props.onClick(); f.render();
  assert.equal(f.registrations.length, 0); assert.ok(f.dialog());
  f.button(makeT("en")("ws.runtimes.register")).props.onClick(); await f.flush();
  assert.deepEqual(f.registrations, [["codex", "fixture-fingerprint", "host"]]); assert.deepEqual(f.changes, []);
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
  f.button("Install in Settings… ↗").props.onClick(); f.render();
  assert.equal(opens, 1); assert.equal(f.text().includes("Install in Settings"), false);
});

test("available binding hides detected discovery cards; listModels failures surface the error", async () => {
  const f = mount({ workspace: { workspaceId: "fixture", resourceGeneration: "g1",
    runtimeOptions: [{ id: "codex", label: "Codex", available: true }],
    conversation: { state: "completed" }, runtimes: { options: [
      { runtimeId: "claude", label: "Claude Code", state: "detected", registered: false, fingerprint: "fixture-claude", path: "/fixture/claude" },
      { runtimeId: "agy", label: "Antigravity", state: "detected", registered: false, fingerprint: "fixture-agy", path: "/fixture/agy" },
    ] } }, agent: { agentId: "main", kind: "main", configRevision: 2, agentEpoch: 1, identity: { displayName: "Hara" },
      runtime: { id: "codex", label: "Codex", available: true } } });
  await f.flush();
  assert.equal(f.text().includes(makeT("en")("ws.runtimeAccess.detected", { runtime: "Claude Code" })), false);
  assert.equal(f.text().includes(makeT("en")("ws.runtimeAccess.detected", { runtime: "Antigravity" })), false);
  assert.equal(f.text().includes(makeT("en")("ws.runtimeAccess.register")), false);
  assert.ok(f.text().includes("This Hara colleague's model"));
  assert.equal(f.text().includes("This bot's model"), false);
  const heading = node => {
    if (Array.isArray(node)) return node.map(heading).join("");
    if (typeof node === "string" || typeof node === "number") return String(node);
    return node?.props ? heading(node.props.children) : "";
  };
  assert.equal(f.all().some(node => node.type === "h3" && heading(node) === "Runtime"), false);

  const fail = mount({ listModels: async () => { throw new Error("codex model inventory failed"); } });
  await fail.flush();
  assert.ok(fail.text().includes("Model list unavailable"));
  assert.ok(fail.text().includes("codex model inventory failed"));
  const alert = fail.all().find(node => node.type === "p" && node.props?.role === "alert");
  assert.ok(alert); assert.ok(fail.text().includes("codex model inventory failed"));
});

test("applying the current runtime never opens a keep/fresh confirmation", async () => {
  const f = mount(); await f.flush();
  f.picker().props.onApply("pi"); f.render();
  assert.equal(f.dialog(), undefined); assert.deepEqual(f.changes, []);
});

for (const kind of ["main", "colleague"]) test(kind + " inventory failure keeps the same disabled model controls and rescan repairs them", async () => {
  let broken = true, scans = 0;
  const f = mount({ listModels: async runtimeId => {
    if (broken) throw new Error("fixture inventory unavailable");
    return { runtimeId, revision: 4, selectedModelId: "one", models: [{ id: "one", label: "Recovered model" }] };
  }, onRescan: async () => { scans++; broken = false; } });
  f.render({ agent: { ...f.props().agent, kind }, workspace: { ...f.props().workspace,
    runtimeOptions: [...f.props().workspace.runtimeOptions, { id: "claude", label: "Claude Code", available: false, reason: "not_installed" }],
    runtimes: { options: [{ runtimeId: "claude", label: "Claude Code", state: "detected", registered: false, fingerprint: "fixture" }] } } });
  await f.flush();
  assert.ok(f.text().includes("fixture inventory unavailable"));
  assert.equal(f.all().find(node => node.type === "select" && node.props["aria-label"] === "This Hara colleague's model").props.disabled, true);
  assert.equal(f.button("Apply model").props.disabled, true);
  assert.equal(f.text().includes(makeT("en")("ws.runtimeAccess.register")), false);
  assert.equal(f.text().includes("Install in Settings"), false);
  const rescan = f.button("Rescan local runtimes");
  assert.equal(rescan.props.className, "vg-runtime-rescan");
  rescan.props.onClick(); await f.flush();
  assert.equal(scans, 1);
  assert.equal(f.all().find(node => node.type === "select" && node.props["aria-label"] === "This Hara colleague's model").props.disabled, false);
  assert.ok(f.text().includes("Recovered model"));
  assert.equal(f.text().includes(makeT("en")("ws.runtimeAccess.register")), false);
  assert.equal(f.text().includes("Install in Settings"), false);
  assert.ok(f.picker()); assert.equal(f.button("Rescan local runtimes").props.className, rescan.props.className);
});

test("failure recovery links only the current missing installation, never integrity or inventory", async () => {
  for (const reason of ["not_registered", "not_installed", "integrity_failed", "inventory_failed", "adapter_pending_p05"]) {
    const f = mount();
    f.render({ workspace: { ...f.props().workspace,
      runtimeOptions: [{ id: "pi", label: "Pi", available: false, reason }, { id: "claude", label: "Claude Code", available: false, reason: "not_installed" }],
      runtimes: { options: [{ runtimeId: "pi", label: "Pi", state: "detected", registered: false, fingerprint: "fixture" }] } } });
    await f.flush();
    const missing = reason === "not_registered" || reason === "not_installed";
    assert.equal(f.text().includes("Install in Settings"), missing, reason);
    assert.equal(f.text().includes(makeT("en")("ws.runtimeAccess.register")), missing, reason);
    assert.equal(f.all().find(node => node.type === "select" && node.props["aria-label"] === "This Hara colleague's model").props.disabled, true, reason);
    const actions = f.all().find(node => node.props?.className === "vg-runtime-recovery-actions");
    const buttons = actions.props.children.flat().filter(Boolean);
    assert.equal(buttons[0].props.className, "vg-runtime-rescan");
    if (missing) assert.equal(buttons[1].props.className, "vg-runtime-install");
  }
});

test("a missing local installation without registry options still offers the install escape", async () => {
  const f = mount({ agent: { agentId: "main", kind: "main", configRevision: 2, agentEpoch: 1, identity: { displayName: "Hara" },
    runtime: { id: "agy", label: "Antigravity", available: false } }, workspace: { workspaceId: "fixture", resourceGeneration: "g1", runtimeOptions: [],
    runtimes: { options: [{ runtimeId: "agy", label: "Antigravity", state: "not_installed", registered: false }] } } });
  await f.flush();
  assert.ok(f.text().includes("Antigravity · No usable installation found"));
  assert.ok(f.text().includes("Install in Settings"));
  assert.deepEqual(f.requests, []);
});

test("recovery actions use a full-width brand primary over a text secondary with a 10px gap", () => {
  const css = readFileSync(new URL("../src/violet-workspace.css", import.meta.url), "utf8");
  assert.match(css, /\.vg-runtime-recovery-actions\{display:grid;grid-template-columns:minmax\(0,1fr\);gap:10px\}/);
  assert.match(css, /\.vg-runtime-access \.vg-runtime-rescan\{width:100%;background:#7C3AED;border-color:#7C3AED;color:#fff/);
  assert.match(css, /\.vg-runtime-access \.vg-runtime-install\{[^}]*background:transparent/);
  assert.match(css, /\.vg-runtime-access button:disabled\{[^}]*opacity:\.45/);
});

test("rescan invalidates an older inventory response even if the rescan fails", async () => {
  const pending = deferred();
  const f = mount({ listModels: () => pending.promise, onRescan: async () => { throw new Error("fixture rescan failed"); } });
  f.button("Rescan local runtimes").props.onClick(); await f.flush();
  pending.resolve({ runtimeId: "pi", revision: 1, selectedModelId: "old", models: [{ id: "old", label: "Stale model" }] });
  await f.flush();
  assert.equal(f.all().find(node => node.type === "select" && node.props["aria-label"] === "This Hara colleague's model").props.disabled, true);
  assert.ok(f.text().includes("fixture rescan failed"));
  assert.equal(f.text().includes("Stale model"), false);
});

test("a selected model exposes only declared effort levels and applies model plus effort once", async () => {
  const f = mount({ agent: { agentId: "main", kind: "main", configRevision: 2, agentEpoch: 1, identity: { displayName: "Hara" }, runtime: { id: "codex", label: "Codex", available: true } },
    listModels: async runtimeId => ({ runtimeId, revision: 7, selectedModelId: "known", selectedEffort: null,
      models: [{ id: "known", label: "Known", supportedReasoningEfforts: ["low", "high"] }, { id: "unknown", label: "Unknown" }] }) });
  await f.flush();
  const effortPicker = () => f.all().find(node => node.type === "select" && node.props["aria-label"] === "Reasoning effort");
  assert.ok(effortPicker());
  assert.deepEqual(f.all().filter(node => node.type === "option" && ["low", "high"].includes(node.props.value)).map(node => node.props.value), ["low", "high"]);
  effortPicker().props.onChange({ target: { value: "high" } }); f.render();
  f.button("Apply model").props.onClick(); await f.flush();
  assert.deepEqual(f.models, [["codex", "known", 7, "high"]]);
  f.all().find(node => node.type === "select" && node.props["aria-label"] === "This Hara colleague's model").props.onChange({ target: { value: "unknown" } }); f.render();
  assert.equal(effortPicker(), undefined);
  assert.ok(f.text().includes("does not report reasoning effort"));
});

test("an old isolated Codex binding offers an explicit host-login confirmation", async () => {
  const f = mount({ agent: { agentId: "main", kind: "main", configRevision: 2, agentEpoch: 1, identity: { displayName: "Hara" }, runtime: { id: "codex", label: "Codex", available: true } },
    workspace: { workspaceId: "fixture", resourceGeneration: "g1", runtimeOptions: [{ id: "codex", label: "Codex", available: true }], conversation: { state: "completed", history: [] },
      runtimes: { options: [{ runtimeId: "codex", label: "Codex", registered: true, state: "local_registered", fingerprint: "fixture-fingerprint", path: "/fixture/codex", loginSource: "isolated" }] } } });
  await f.flush();
  f.button("Use this Mac's login").props.onClick(); f.render();
  assert.ok(f.dialog()); assert.ok(f.text().includes("Use the Codex login on this Mac (recommended)"));
  f.button(makeT("en")("ws.runtimes.register")).props.onClick(); await f.flush();
  assert.deepEqual(f.registrations, [["codex", "fixture-fingerprint", "host"]]);
});

for (const [runtimeId, levels] of [["copilot", []], ["copilot", ["low", "high"]], ["cursor", []], ["grok", []]]) test(runtimeId + " real runtime card labels inventory source and hides unsupported effort " + levels.length, async () => {
  const source = runtimeId === "cursor" ? "live" : "documented";
  const f = mount({
    agent: { agentId: "main", kind: "main", configRevision: 2, agentEpoch: 1, identity: { displayName: "Hara" }, runtime: { id: runtimeId, label: runtimeId, available: true } },
    workspace: { workspaceId: "fixture", resourceGeneration: "g-one", runtimeOptions: [{ id: runtimeId, label: runtimeId, available: true }],
      runtimes: { options: [{ runtimeId, registered: true, loginSource: "host", state: "local_registered" }] }, conversation: { state: "completed", history: [] } },
    listModels: async id => ({ runtimeId: id, source, revision: 1, selectedModelId: "fixture", selectedEffort: null, models: [{ id: "fixture", label: "Fixture", supportedReasoningEfforts: levels }] }),
  });
  await f.flush();
  assert.ok(f.text().includes(makeT("en")(source === "live" ? "ws.runtimeExpansion.modelsLive" : "ws.runtimes.documentedModels")));
  const controls = f.all().filter(node => node.type === "select" && node.props["aria-label"] === "Reasoning effort");
  assert.equal(controls.length, levels.length ? 1 : 0);
  if (!levels.length) assert.equal(f.text().includes("Reasoning effort"), false);
});
for (const runtimeId of ["copilot", "cursor", "grok"]) test(runtimeId + " registration offers only reuse of the host login", async () => {
  const f = mount({
    agent: { agentId: "main", kind: "main", configRevision: 2, agentEpoch: 1, identity: { displayName: "Hara" }, runtime: { id: runtimeId, label: runtimeId, available: false } },
    workspace: { workspaceId: "fixture", resourceGeneration: "g-one", runtimeOptions: [{ id: runtimeId, label: runtimeId, available: false, reason: "not_registered" }],
      runtimes: { options: [{ runtimeId, label: runtimeId, registered: false, state: "detected", fingerprint: "fixture-fingerprint", path: "/fixture/runtime" }] }, conversation: { state: "completed", history: [] } },
  });
  await f.flush();
  f.button(makeT("en")("ws.runtimeAccess.register")).props.onClick(); f.render();
  assert.equal(f.all().filter(node => node.type === "input" && node.props.name === "inspector-login-source").length, 1);
  f.button(makeT("en")("ws.runtimes.register")).props.onClick(); await f.flush();
  assert.equal(f.registrations[0][2], "host");
});

test("binding and runtime-switch confirmations disclose inherited extensions for every expanded runtime and locale", async () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) for (const id of ["copilot", "cursor", "grok"]) {
    const t = makeT(locale), f = mount({ locale, workspace: { runtimeOptions: [{ id, label: id, available: true }],
      runtimes: { options: [{ runtimeId: id, label: id, fingerprint: "fixture-fp", state: "detected", registered: false }] } } });
    f.all().find(node => node.type === Picker).props.onApply(id); f.render();
    assert.ok(f.text().includes(t("ws.runtimeExpansion.extensionsInherited")));
    assert.deepEqual(f.changes, [], "a visible warning is not an automatic bind");
    const g = mount({ locale, agent: { agentId: "main", kind: "main", configRevision: 2, agentEpoch: 1, identity: { displayName: "Hara" }, runtime: { id, label: id, available: false } },
      workspace: { workspaceId: "fixture", resourceGeneration: "g-one", runtimeOptions: [{ id, label: id, available: false, reason: "not_registered" }],
        runtimes: { options: [{ runtimeId: id, label: id, fingerprint: "fixture-fp", state: "detected", registered: false }] }, conversation: { state: "completed", history: [] } } });
    g.button(t("ws.runtimeAccess.register")).props.onClick(); g.render();
    assert.ok(g.text().includes(t("ws.runtimeExpansion.extensionsInherited")));
    assert.equal(g.all().filter(node => node.type === "input" && node.props.name === "inspector-login-source").length, 1);
  }
});

for (const configured of [null, "auto", "low", "medium", "high", "xhigh", "max"])
  test(`effort picker preserves ${configured ?? "unset"} and permits a fixed selection`, async () => {
    const f = mount({ agent: { agentId: "colleague", kind: "colleague", configRevision: 2, agentEpoch: 1,
      identity: { displayName: "Tester" }, runtime: { id: "codex", label: "Codex", available: true } },
      listModels: async () => ({ runtimeId: "codex", revision: 5, selectedModelId: "codex-one", selectedEffort: configured,
        models: [{ id: "codex-one", label: "Codex one", supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"] }] }) });
    await f.flush();
    const picker = () => f.all().find(node => node.type === "select" && node.props["aria-label"] === "Reasoning effort");
    assert.equal(picker().props.value, configured === "auto" || configured === null ? "" : configured);
    picker().props.onChange({ target: { value: "high" } }); f.render();
    assert.equal(picker().props.value, "high");
    if (configured !== "high") {
      f.button("Apply model").props.onClick(); await f.flush();
      assert.deepEqual(f.models, [["codex", "codex-one", 5, "high"]]);
    }
  });
