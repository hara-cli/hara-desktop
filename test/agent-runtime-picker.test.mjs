import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { agentRuntimeLabel, agentRuntimeSelection } from "../src/agent-runtime-selection.ts";

const require = createRequire(import.meta.url);
const agent = { ref: "main", name: "Hara", owner: "personal", spaceId: "personal", revision: "a".repeat(32), allowedActions: ["chat", "edit_profile"],
  runtime: { version: 1, agentRef: "main", spaceId: "personal", runtimeId: "hara", revision: 0, available: true } };
const options = [{ id: "hara", available: true }, { id: "pi", available: false }, { id: "codex", available: true }];

function picker() {
  const source = readFileSync(new URL("../src/AgentRuntimePicker.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  new Function("require", "exports", outputText)((name) => name === "./agent-runtime-selection"
    ? { agentRuntimeLabel, agentRuntimeSelection } : require(name), exports);
  return exports.default;
}

function saveCallback(bindings) {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "saveAgentRuntime") initializer = node.initializer.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed); assert.ok(initializer);
  const { outputText } = ts.transpileModule(`return (${initializer});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } });
  return new Function(...Object.keys(bindings), outputText)(...Object.values(bindings));
}

test("Runtime choices require the exact advertised personal owner and both current revisions", () => {
  assert.equal(agentRuntimeSelection(agent, "pi", options), null);
  assert.equal(agentRuntimeSelection(agent, "hara", options), null);
  assert.deepEqual(agentRuntimeSelection(agent, "codex", options), { ref: "main", runtimeId: "codex", expectedRevision: 0, expectedAgentRevision: agent.revision });
  for (const changed of [
    { ...agent, runtime: undefined }, { ...agent, owner: "organization" }, { ...agent, allowedActions: ["chat"] },
    { ...agent, spaceId: "org:other" }, { ...agent, runtime: { ...agent.runtime, agentRef: "global:other" } },
    { ...agent, runtime: { ...agent.runtime, revision: -1 } },
  ]) assert.equal(agentRuntimeSelection(changed, "codex", options), null);
});

test("the actual picker is folded, labels unavailable engines honestly and does not grant tools", () => {
  const html = renderToStaticMarkup(React.createElement(picker(), { agent, options, locale: "zh", onApply() {} }));
  assert.ok(html.startsWith("<details")); assert.equal(/<details[^>]*\bopen\b/.test(html), false);
  assert.ok(/<option[^>]*value="pi"[^>]*disabled/.test(html));
  assert.ok(html.includes("不是模型或工具授权")); assert.ok(html.includes("旧任务和历史保留原绑定"));
  assert.equal(html.includes("apiKey"), false);
});

test("older engines and company Agents render read-only rather than inventing a Runtime binding", () => {
  const legacy = renderToStaticMarkup(React.createElement(picker(), { agent: { ...agent, runtime: undefined }, options: [], locale: "en" }));
  assert.ok(legacy.includes("Binding not advertised")); assert.equal(legacy.includes("<select"), false);
  const company = renderToStaticMarkup(React.createElement(picker(), { agent: { ...agent, owner: "organization" }, options, locale: "en", onApply() {} }));
  assert.ok(/<select[^>]*disabled/.test(company));
});

function bindings(response) {
  const calls = []; const updates = []; const errors = [];
  const client = { supports: () => true, setAgentRuntime: async (input) => { calls.push(input); return response; } };
  const scope = { clientRef: { current: client }, agentCatalog: { agents: [agent], runtimeOptions: options }, profileAgentRef: "main", profileAgentSaving: false,
    runtimeSaveInFlightRef: { current: false }, agentCatalogRequestRef: { current: 1 }, profileAgentRefLive: { current: "main" }, agentRuntimeSelection,
    setProfileAgentSaving() {}, setProfileAgentError: (value) => errors.push(value), setAgentCatalog: (value) => updates.push(value),
    refreshAgentCatalog: async () => {}, active: "personal-session", server: { cwd: "/fixture" } };
  return { calls, updates, errors, scope };
}

test("the actual save handler sends only the bounded binding choice and keeps profile/history separate", async () => {
  const f = bindings({ catalog: { agents: [agent], runtimeOptions: options } });
  await saveCallback(f.scope)("codex");
  assert.deepEqual(f.calls, [{ ref: "main", runtimeId: "codex", expectedRevision: 0, expectedAgentRevision: agent.revision, sessionId: "personal-session" }]);
  assert.equal(f.updates.length, 1); assert.equal(f.scope.runtimeSaveInFlightRef.current, false);
});

test("duplicate clicks and late replies after changing the Agent cannot overwrite the current UI", async () => {
  let release; const response = new Promise((resolve) => { release = resolve; }); const f = bindings(response);
  const save = saveCallback(f.scope); const first = save("codex");
  await save("codex"); assert.equal(f.calls.length, 1);
  f.scope.profileAgentRefLive.current = "global:other";
  release({ catalog: { agents: [agent] } }); await first;
  assert.equal(f.updates.length, 0); assert.equal(f.scope.runtimeSaveInFlightRef.current, false);
});

test("an unavailable Runtime produces no request, even if a UI event supplies its id", async () => {
  const f = bindings({ catalog: {} }); await saveCallback(f.scope)("pi");
  assert.equal(f.calls.length, 0); assert.equal(f.updates.length, 0);
});
