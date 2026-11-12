import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { makeT } from "../src/i18n.ts";
import * as runtimeSelection from "../src/agent-runtime-selection.ts";
import * as runtimeExpansion from "../src/runtime-expansion.ts";
import { parseRuntimeFailure, runtimeLoginCommand, runtimeDiagnosticSummary } from "../src/runtime-failure.ts";
import { formatList, toLocale } from "../src/i18n-runtime.ts";
const require = createRequire(import.meta.url), React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
// WorkspaceRuntimeSettings now imports the shared settings chrome (S0); give the standalone loader the real module.
const settingsChrome = { exports: {} };
{ const { build } = await import("esbuild"), { fileURLToPath } = await import("node:url");
  const out = await build({ stdin: { contents: 'export * from "./src/SettingsChrome.tsx";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx" },
    bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty" }, write: false });
  new Function("require", "module", "exports", out.outputFiles[0].text)(createRequire(import.meta.url), settingsChrome, settingsChrome.exports); }
function load(file, mocks = {}) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  new Function("require", "exports", outputText)(name => mocks[name] ?? (name === "./SettingsChrome" ? settingsChrome.exports : name === "./agent-runtime-selection" ? runtimeSelection : name === "./i18n" ? { makeT } : name === "./i18n-runtime.ts" ? { formatList, toLocale } : name === "./runtime-expansion" ? runtimeExpansion : require(name)), exports);
  return exports;
}
const picker = load("AgentRuntimePicker.tsx");
for (const [locale, unavailable, guide] of [["en", "not installed", "Official installation guide"], ["zh-Hans", "未安装", "官方安装说明"], ["zh-Hant", "未安裝", "官方安裝說明"]]) {
  test(`Gemini/Kimi registry options and manual installation copy in ${locale}`, () => {
    const agent = { agentId: "fixture", configRevision: 1, agentEpoch: 1, runtime: { id: "pi", label: "Pi" } };
    const options = [{ id: "pi", label: "Pi", available: true }, ...["gemini", "kimi"].map(id => ({ id, available: false, reason: "not_installed" }))];
    const html = renderToStaticMarkup(React.createElement(picker.WorkspaceAgentRuntimePicker, { agent, options, locale, saving: false, onApply() {} }));
    assert.ok(html.includes("Gemini CLI") && html.includes("Kimi Code") && html.includes(unavailable));
    const settings = load("WorkspaceRuntimeSettings.tsx", { "./WorkspaceRuntimeProxy": { WorkspaceRuntimeProxy: () => null },
      "./workspace-shell-hooks": { useWorkspaceLocale: () => ({ t: makeT(locale), locale }) }, "./workspace-settings-copy": { runtimeOperationText: (_t, state) => state } });
    const workspace = { workspaceId: "fixture", resourceGeneration: "one", runtimes: { options: ["gemini", "kimi"].map(runtimeId => ({ runtimeId,
      label: runtimeId === "gemini" ? "Gemini CLI" : "Kimi Code", state: "not_installed", registered: false, installed: false, version: null })), operations: [] } };
    const output = renderToStaticMarkup(React.createElement(settings.default, { model: {}, workspace }));
    assert.ok(output.includes(runtimeSelection.runtimePersonalExtensionsNotice("kimi", locale)));
    const bound = renderToStaticMarkup(React.createElement(picker.WorkspaceAgentRuntimePicker, { agent: { ...agent, runtime: { id: "kimi", label: "Kimi Code" } }, options: [{ id: "kimi", label: "Kimi Code", available: true }], locale, saving: false, onApply() {} }));
    assert.ok(bound.includes(runtimeSelection.runtimePersonalExtensionsNotice("kimi", locale)));
    const gemini = renderToStaticMarkup(React.createElement(picker.WorkspaceAgentRuntimePicker, { agent: { ...agent, runtime: { id: "gemini", label: "Gemini CLI" } }, options: [{ id: "gemini", available: true }], locale, saving: false, onApply() {} }));
    assert.ok(!gemini.includes(runtimeSelection.runtimePersonalExtensionsNotice("kimi", locale)));
    assert.ok(output.includes(guide)); assert.ok(output.includes("geminicli.com/docs/get-started/installation/")); assert.ok(output.includes("moonshotai.github.io/kimi-code/en/guides/getting-started.html"));
    assert.ok(!output.includes('name="settings-install-login"'), "manual-only CLIs do not expose an automatic install confirmation");
  });
}
for (const runtime of ["gemini", "kimi"]) test(`${runtime} diagnostics retain closed schema and the correct host recovery command`, () => {
  const diagnostic = { runtime, kind: "runtime_auth_rejected", version: "1.2.3", loginSource: "host", homeMatchesAccount: true,
    elapsedMs: 10, retryAtMs: 0, consecutiveFailures: 1 };
  const parsed = parseRuntimeFailure("hara_runtime_failure_v1=" + JSON.stringify(diagnostic), runtime);
  assert.deepEqual(parsed, diagnostic); assert.equal(parseRuntimeFailure("hara_runtime_failure_v1=" + JSON.stringify({ ...diagnostic, secret: "not allowed" }), runtime), null);
  assert.equal(runtimeLoginCommand(runtime), runtime === "gemini" ? "gemini" : "kimi login");
});

test("inherited Kimi diagnostics preserve the closed extension field and reject forged or duplicate fields", () => {
  const base = { runtime: "kimi", kind: "runtime_auth_rejected", version: "1.2.3", loginSource: "host", homeMatchesAccount: true, elapsedMs: 1, retryAtMs: 0, consecutiveFailures: 1 };
  const current = { ...base, extensionsIsolation: "inherited" }, prefix = "hara_runtime_failure_v1=";
  assert.deepEqual(parseRuntimeFailure(prefix + JSON.stringify(current)), current);
  assert.deepEqual(parseRuntimeFailure(prefix + JSON.stringify(base)), base, "old saved diagnostics remain valid without claiming inheritance");
  for (const row of [{ ...current, unknown: true }, { ...current, extensionsIsolation: "isolated" }, { ...current, extensionsIsolation: null }, { ...current, runtime: "gemini" }]) assert.equal(parseRuntimeFailure(prefix + JSON.stringify(row)), null);
  assert.equal(parseRuntimeFailure(prefix + JSON.stringify(current).replace('"inherited"', '"inherited","extensionsIsolation":"inherited"')), null);
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const summary = runtimeDiagnosticSummary(current, makeT(locale));
    assert.ok(summary.includes("extensionsIsolation: inherited")); assert.ok(summary.includes(runtimeSelection.runtimePersonalExtensionsNotice("kimi", locale)));
  }
});

for (const locale of ["en", "zh-Hans", "zh-Hant"]) test(`unverified host runtimes retain their extension notice and acceptance status in ${locale}`, () => {
 const t=makeT(locale),agent={agentId:"fixture",configRevision:1,agentEpoch:1};
 for(const id of ["kimi","copilot","cursor","grok"]){const html=renderToStaticMarkup(React.createElement(picker.WorkspaceAgentRuntimePicker,{agent:{...agent,runtime:{id,label:id}},options:[{id,label:id,available:true}],locale,saving:false,onApply(){}}));assert.ok(html.includes('data-runtime-acceptance="unverified"'));assert.ok(html.includes(t("ws.runtimeExpansion.unverified")));assert.ok(html.includes(runtimeSelection.runtimePersonalExtensionsNotice(id,locale)));}
 const settings=load("WorkspaceRuntimeSettings.tsx",{"./WorkspaceRuntimeProxy":{WorkspaceRuntimeProxy:()=>null},"./workspace-shell-hooks":{useWorkspaceLocale:()=>({t,locale})},"./workspace-settings-copy":{runtimeOperationText:(_t,state)=>state}});
 const html=renderToStaticMarkup(React.createElement(settings.default,{model:{},workspace:{workspaceId:"fixture",resourceGeneration:"one",runtimes:{options:[{runtimeId:"kimi",label:"Kimi Code",state:"legacy_unsupported",installed:false,registered:false}],operations:[]}}}));assert.ok(html.includes(t("ws.runtimeExpansion.legacyUnsupported")));assert.ok(!html.includes('class="wsd-primary"'));
});
