import { sharedSettingsUi } from "./support/shared-settings-ui.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { makeT } from "../src/i18n.ts";
import * as expansion from "../src/runtime-expansion.ts";
const require = createRequire(import.meta.url), React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
// WorkspaceRuntimeSettings now imports the shared settings chrome (S0); give the standalone loader the real module.
const settingsChrome = { exports: {} };
{ const { build } = await import("esbuild"), { fileURLToPath } = await import("node:url");
  const out = await build({ stdin: { contents: 'export * from "./src/SettingsChrome.tsx";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx" },
    bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty" }, write: false });
  new Function("require", "module", "exports", out.outputFiles[0].text)(createRequire(import.meta.url), settingsChrome, settingsChrome.exports); }
const tick = () => new Promise(resolve => setImmediate(resolve));
const source = readFileSync(new URL("../src/WorkspaceRuntimeSettings.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
function mount(locale, initialState) {
  const slots = [], effects = [], calls = []; let cursor = 0, dirty = false, tree;
  const hooks = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(initial) {
      const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], next => { const value = typeof next === "function" ? next(slots[index]) : next;
        if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; } }];
    },
    useEffect(action, deps) {
      const index = cursor++, old = slots[index];
      if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) effects.push(() => {
        old?.cleanup?.(); slots[index] = { deps, cleanup: action() };
      });
    },
  };
  const exports = {}, t = makeT(locale);
  new Function("require", "exports", outputText)(name => ["./SettingsActionDialog", "./SettingsConnectionModelField", "./settings-device-copy"].includes(name) ? sharedSettingsUi(name) : name === "react" ? { ...React, ...hooks }
    : name === "./SettingsChrome" ? settingsChrome.exports
    : name === "./runtime-expansion" ? expansion : name === "./WorkspaceRuntimeProxy" ? { WorkspaceRuntimeProxy: () => null }
    : name === "./workspace-shell-hooks" ? { useWorkspaceLocale: () => ({ t, locale }) }
    : name === "./workspace-settings-copy" ? { runtimeOperationText: (_t, state) => state } : require(name), exports);
  const model = { async detectRuntimes() { calls.push("detect"); }, async registerLocalRuntime() { calls.push("register"); } };
  const row = state => ({ runtimeId: "copilot", label: "GitHub Copilot", installed: state === "detected", registered: false,
    version: state === "detected" ? "1.0.105" : null, fingerprint: state === "detected" ? "fixture" : null,
    path: "/fixture/copilot", loginSource: "host", generalAgentDriverAvailable: false, state });
  let workspace = { workspaceId: "fixture", resourceGeneration: "generation-one", runtimes: { options: [row(initialState)], operations: [] } };
  function render(state) {
    if (state) workspace = { ...workspace, runtimes: { ...workspace.runtimes, options: [row(state)] } };
    cursor = 0; dirty = false; tree = exports.default({ model, workspace });
    effects.splice(0).forEach(effect => effect()); return renderToStaticMarkup(tree);
  }
  async function flush() { for (let i = 0; i < 3; i++) { await tick(); if (dirty) render(); } return renderToStaticMarkup(tree); }
  render(); return { render, flush, calls, t, dispose() { slots.forEach(value => value?.cleanup?.()); } };
}

for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
  test(`pending Copilot remains checking after the initial scan ends, then becomes registrable on its background snapshot in ${locale}`, async () => {
    const f = mount(locale, "detecting");
    try {
      let html = await f.flush(); assert.deepEqual(f.calls, ["detect"]);
      assert.ok(html.includes(f.t("ws.runtimes.checking"))); assert.equal(html.includes(f.t("ws.runtimes.missing")), false);
      assert.equal(html.includes(f.t("ws.runtimes.useLocal")), false);
      assert.equal(html.includes(f.t("ws.runtimeExpansion.manualInstall")), false);
      html = f.render("detected");
      assert.ok(html.includes("1.0.105")); assert.ok(html.includes(f.t("ws.runtimes.useLocal")));
      assert.equal(html.includes(f.t("ws.runtimes.missing")), false); assert.deepEqual(f.calls, ["detect"]);
    } finally { f.dispose(); }
  });
  test(`unconfirmed Copilot displays a retryable detection failure without an installation claim in ${locale}`, async () => {
    const f = mount(locale, "detection_failed");
    try {
      const html = await f.flush(); assert.deepEqual(f.calls, ["detect"]);
      assert.ok(html.includes(f.t("ws.runtimes.detectFailed"))); assert.equal(html.includes(f.t("ws.runtimes.missing")), false);
      assert.equal(html.includes(f.t("ws.runtimes.useLocal")), false);
      assert.equal(html.includes(f.t("ws.runtimeExpansion.manualInstall")), false);
      assert.ok(html.includes(f.t("ws.runtimes.detect")));
    } finally { f.dispose(); }
  });
}

for (const locale of ["en", "zh-Hans", "zh-Hant"]) test(`the not-installed fold says «checking» until this page's own detection finishes (${locale})`, async () => {
  const f = mount(locale, "not_installed");
  try {
    const before = f.render();
    assert.ok(before.includes(`<summary>${f.t("ws.runtimes.otherChecking")}</summary>`), "no «N not installed» verdict while detection is still running");
    assert.equal(before.includes(f.t("ws.runtimes.otherMissing", { n: 1 })), false);
    const after = await f.flush(); assert.deepEqual(f.calls, ["detect"]);
    assert.ok(after.includes(`<summary>${f.t("ws.runtimes.otherMissing", { n: 1 })}</summary>`), "the count appears once detection has completed");
  } finally { f.dispose(); }
});
