import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { agentRuntimeLabel } from "../src/agent-runtime-selection.ts";
import * as talent from "../src/talent-blueprint.ts";
import { HARA_CURATED_BLUEPRINTS } from "../src/talent-blueprints.ts";

const require = createRequire(import.meta.url);
const options = [{ id: "hara", available: true }, { id: "pi", available: true }, { id: "codex", available: false }];
function dialog(chosen) {
  const source = readFileSync(new URL("../src/HireAgentDialog.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  let index = 0;
  const hooks = chosen === undefined ? React : { ...React, useState: (initial) => [index++ === 0 ? chosen : typeof initial === "function" ? initial() : initial, () => {}],
    useMemo: (calculate) => calculate(), useId: () => "synthetic-note", useEffect() {} };
  const exports = {};
  new Function("require", "exports", outputText)((name) => {
    if (name === "react") return hooks;
    if (name.endsWith(".css")) return {};
    if (name === "./agent-runtime-selection") return { agentRuntimeLabel };
    if (name === "./AgentPortrait") return { AgentPortrait: () => React.createElement("span", null, "portrait") };
    if (name === "./talent-blueprint") return talent;
    return require(name);
  }, exports);
  return exports.default;
}
function nodes(element, found = []) {
  if (!element || typeof element !== "object") return found;
  if (Array.isArray(element)) { for (const child of element) nodes(child, found); return found; }
  if (element.props) { found.push(element); nodes(element.props.children, found); }
  return found;
}

test("the actual hiring dialog recommends built-in Pi and disables unregistered Runtimes without exposing keys", () => {
  const html = renderToStaticMarkup(React.createElement(dialog(), { locale: "zh", runtimeOptions: options, onClose() {}, onHire() {} }));
  assert.ok(/<option[^>]*value="pi"[^>]*selected/.test(html));
  assert.ok(/<option[^>]*value="codex"[^>]*disabled/.test(html));
  assert.ok(html.includes("Pi 已内建")); assert.ok(html.includes("引擎不授予工具权限"));
  assert.equal(html.includes("apiKey"), false);
});

test("the actual hire action sends a verified Runtime choice, but refuses a stale or forged unavailable choice", () => {
  const sent = [];
  const props = { locale: "zh", runtimeOptions: options, blueprint: HARA_CURATED_BLUEPRINTS[0], onClose() {}, onHire: (input) => sent.push(input) };
  const render = dialog(""); const button = nodes(render(props)).find((node) => node.type === "button" && node.props.children === "确认雇佣");
  assert.equal(button.props.disabled, false); button.props.onClick(); assert.equal(sent[0].runtimeId, "pi");
  assert.equal(Object.hasOwn(sent[0], "allowTools"), false);
  const stale = nodes(dialog("codex")(props)).find((node) => node.type === "button" && node.props.children === "确认雇佣");
  assert.equal(stale.props.disabled, true); stale.props.onClick(); assert.equal(sent.length, 1);
});

test("old engines receive no invented Runtime field and retain the existing hiring path", () => {
  const sent = [];
  const button = nodes(dialog("")({ locale: "en", runtimeOptions: [], blueprint: HARA_CURATED_BLUEPRINTS[0], onClose() {}, onHire: (input) => sent.push(input) }))
    .find((node) => node.type === "button" && node.props.children === "Hire Agent");
  button.props.onClick(); assert.equal(Object.hasOwn(sent[0], "runtimeId"), false);
});

test("role suggestions are optional browsing, never hiring or a mandatory catalog step", () => {
  let browsed = 0;
  let hired = 0;
  const props = { locale: "zh", runtimeOptions: options, onClose() {}, onHire() { hired++; }, onBrowseCandidates() { browsed++; } };
  const render = dialog("");
  const suggestion = nodes(render(props)).find((node) => node.type === "button" && node.props.className === "ghost hire-agent-recommendations");
  suggestion.props.onClick();
  assert.equal(browsed, 1);
  assert.equal(hired, 0);
  const hidden = nodes(render({ ...props, suspended: true }));
  assert.equal(hidden[0].props.hidden, true);
  assert.equal(hidden[0].props.inert, true);
  hidden.find((node) => node.type === "button" && node.props.className === "ghost hire-agent-recommendations").props.onClick();
  assert.equal(browsed, 1);
  const existing = nodes(render({ ...props, blueprint: HARA_CURATED_BLUEPRINTS[0] }));
  assert.equal(existing.some((node) => node.props?.className === "ghost hire-agent-recommendations"), false);
});

test("a suspended onboarding form cannot hire or dismiss while the candidate browser owns interaction", () => {
  const events = [];
  const elements = nodes(dialog("")({ locale: "zh", runtimeOptions: options, suspended: true,
    blueprint: HARA_CURATED_BLUEPRINTS[0], onClose() { events.push("close"); }, onHire() { events.push("hire"); } }));
  const action = elements.find((node) => node.type === "button" && node.props.children === "确认雇佣");
  assert.equal(action.props.disabled, true);
  action.props.onClick();
  const cancel = elements.find((node) => node.type === "button" && node.props.children === "取消");
  assert.equal(cancel.props.disabled, true);
  cancel.props.onClick();
  const overlay = elements[0];
  overlay.props.onMouseDown({ target: overlay, currentTarget: overlay });
  assert.deepEqual(events, []);
});
