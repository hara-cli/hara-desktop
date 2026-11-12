import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { makeT } from "../src/i18n.ts";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";

const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: 'export {SettingsContent} from "./src/WorkspaceSettings.tsx"; export {WorkspaceDefaultRuntime} from "./src/WorkspaceDefaultRuntime.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const source = readFileSync(new URL("../src/WorkspaceDefaultRuntime.tsx", import.meta.url), "utf8");
function render(element, locale = "zh-Hans") {
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => key === "hara.locale" ? locale : null, setItem() {} } });
  try { return renderToStaticMarkup(element); }
  finally { if (before) Object.defineProperty(globalThis, "localStorage", before); else delete globalThis.localStorage; }
}
const workspace = { workspaceId: "A", resourceGeneration: "g", label: "A", selectedAgentId: "main", syntheticOnly: false, executionMode: "workspace",
  agents: [{ agentId: "main", kind: "main", state: "active", identity: { displayName: "Hara" }, runtime: { id: "pi", label: "Pi", available: true } }],
  connections: { revision: 1, defaultConnectionId: null, connections: [] }, approvals: [], conversation: { history: [], state: "idle", usage: { modelCalls: 0 }, runUsage: { modelCalls: 0 } },
  runtimes: { options: [{ runtimeId: "codex", label: "Codex", registered: true, state: "registered" }, { runtimeId: "copilot", label: "GitHub Copilot", registered: true, state: "registered", generalAgentDriverAvailable: false },
    { runtimeId: "claude", label: "Claude Code", registered: false, state: "detected" }], operations: [] } };

test("the default-engine choice is offered only when Core advertises G1", () => {
  const shell = supported => { const value = { workspaceId: "A", workspace, directory: { workspaces: [{ workspaceId: "A", label: "A", role: "owner", active: true, kind: "personal" }] }, error: "" };
    const model = { getSnapshot: () => value, subscribe: () => () => {}, supportsDefaultRuntime: () => supported, preferences: async () => ({ revision: 1, theme: "system", readOnly: false, recovered: false }), detectRuntimes: async () => {}, runtimeProxy: async () => ({}) };
    return render(createElement(module.exports.SettingsContent, { model, mainModel: model, initialPage: "runtimes", root: "/x", production: true, updater: { getSnapshot: () => ({ phase: "latest", preferences: {} }), subscribe: () => () => {} }, versionInfo: null, onClose() {}, onCreateSkill() {}, theme: { preference: "system", settings: { readOnly: false }, notice: "", change() {}, changeDetails() {} } })); };
  assert.equal(shell(false).includes("wsd-default-runtime"), false, "no entry without the Core capability");
  const html = shell(true), t = makeT("zh-Hans");
  assert.ok(html.indexOf("wsd-default-runtime") < html.indexOf("wsd-runtime-settings"), "heads the engines page");
  assert.ok(html.includes(t("ws.runtimes.default.title")) && html.includes(t("ws.runtimes.default.note")));
});

for (const locale of ["zh-Hans", "en", "zh-Hant"]) test(`options are Pi-first (null), Pi and enabled engines that can drive colleagues (${locale})`, () => {
  const t = makeT(locale), html = render(createElement(module.exports.WorkspaceDefaultRuntime, { model: { preferences: () => new Promise(() => {}) }, workspace }), locale);
  assert.ok(html.includes(`<option value="" selected="">${t("ws.runtimes.default.piFirst")}</option>`), "null means the existing Pi-first behaviour and is the default");
  assert.ok(html.includes('<option value="pi">Pi</option>') && html.includes('<option value="codex">Codex</option>'));
  assert.equal(html.includes('value="claude"'), false, "not-enabled engines are not offered");
  assert.equal(html.includes('value="copilot"'), false, "engines that cannot drive colleagues are not offered");
  assert.match(html, /<select[^>]*disabled=""/, "disabled until the saved value has loaded");
});

test("saving sends only the G1 fields with a fresh revision and never probes or starts an engine", async () => {
  const calls = [], rpc = { supportsCapability: capability => capability === "workspace.preferences.default-runtime.v1", async request(method, params) { calls.push({ method, params }); return { revision: 5, theme: "system", readOnly: false, recovered: false, defaultRuntimeId: params.defaultRuntimeId ?? null }; } };
  const model = new WorkspaceDevModel(rpc, () => "fixture", false, "workspace", true);
  assert.equal(model.supportsDefaultRuntime(), true);
  await model.saveDefaultRuntime("codex", 4); await model.saveDefaultRuntime(null, 5);
  assert.deepEqual(calls, [{ method: "workspace.preferences.set", params: { defaultRuntimeId: "codex", expectedRevision: 4 } }, { method: "workspace.preferences.set", params: { defaultRuntimeId: null, expectedRevision: 5 } }]);
  const without = new WorkspaceDevModel({ async request() { throw new Error("must not be called"); } }, () => "fixture", false, "workspace", true);
  await assert.rejects(() => without.saveDefaultRuntime("codex", 1), "no capability → no request");
  assert.match(source, /const fresh = await model\.preferences\(\); setValue\(await model\.saveDefaultRuntime\(next, fresh\.revision\)\)/, "uses the current shared revision");
  assert.doesNotMatch(source, /listModels|detectRuntimes|registerLocalRuntime|approveRuntime/);
});
