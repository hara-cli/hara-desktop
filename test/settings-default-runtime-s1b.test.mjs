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

const g1 = (patch = {}) => ({ schemaVersion: 1, workspaceId: "A", defaultRuntimeId: null, revision: 1, readOnly: false, recovered: false, ...patch });
test("the per-workspace default engine is offered only when Core advertises workspace.default-runtime.v1, inside the workspace fieldset", () => {
  const shell = supported => { const value = { workspaceId: "A", workspace, directory: { workspaces: [{ workspaceId: "A", label: "A", role: "owner", active: true, kind: "personal" }] }, error: "" };
    const model = { getSnapshot: () => value, subscribe: () => () => {}, supportsDefaultRuntime: () => supported, defaultRuntime: () => new Promise(() => {}), preferences: async () => ({ revision: 1, theme: "system", readOnly: false, recovered: false }), detectRuntimes: async () => {}, runtimeProxy: async () => ({}) };
    return render(createElement(module.exports.SettingsContent, { model, mainModel: model, initialPage: "runtimes", root: "/x", production: true, updater: { getSnapshot: () => ({ phase: "latest", preferences: {} }), subscribe: () => () => {} }, versionInfo: null, onClose() {}, onCreateSkill() {}, theme: { preference: "system", settings: { readOnly: false }, notice: "", change() {}, changeDetails() {} } })); };
  assert.equal(shell(false).includes("wsd-default-runtime"), false, "no entry without the Core capability (old Cores)");
  const html = shell(true), t = makeT("zh-Hans");
  assert.ok(html.indexOf("wsd-default-runtime") < html.indexOf("wsd-runtime-settings"), "heads the engines page");
  assert.ok(html.indexOf('<fieldset class="wss-content"') < html.indexOf("wsd-default-runtime"), "per workspace, so inside the read-only fieldset (members cannot change it)");
  const section = html.slice(html.indexOf('class="wsd-default-runtime"'));
  assert.ok(section.includes(`<small>${t("ws.runtimes.default.scope")}</small>`), "says it is saved for this workspace (the page already carries «This workspace only»)");
  assert.equal(section.slice(0, section.indexOf("</section>")).includes("wss-scope-chip"), false, "no second scope chip");
  assert.equal(section.includes(t("ws.settings.allSpaces")), false);
});

for (const locale of ["zh-Hans", "en", "zh-Hant"]) test(`options are «Pi (default)» (null) and enabled engines that can drive colleagues (${locale})`, () => {
  const t = makeT(locale), html = render(createElement(module.exports.WorkspaceDefaultRuntime, { model: { defaultRuntime: () => new Promise(() => {}) }, workspace }), locale);
  assert.ok(html.includes(`<option value="" selected="">${t("ws.runtimes.default.pi")}</option>`), "null means the existing Pi-first behaviour and is the default");
  assert.equal(html.includes('value="pi"'), false, "a separate «Pi» would behave exactly like the default, so there is only one");
  assert.ok(html.includes('<option value="codex">Codex</option>'));
  assert.equal(html.includes('value="claude"'), false, "not-enabled engines are not offered");
  assert.equal(html.includes('value="copilot"'), false, "engines that cannot drive colleagues are not offered");
  assert.match(html, /<select[^>]*disabled=""/, "disabled until the saved value has loaded");
});

function modelFixture(capabilities, handlers = {}) {
  const calls = [];
  const snapshot = id => ({ workspaceId: id, resourceGeneration: `generation-${id}`, label: id, syntheticOnly: false, executionMode: "workspace", selectedAgentId: "main", agents: [], approvals: [],
    connections: { revision: 0, defaultConnectionId: null, connections: [] }, conversation: { history: [], state: "idle" } });
  const model = new WorkspaceDevModel({ supportsCapability: name => capabilities.includes(name), async request(method, params) {
    calls.push({ method, params });
    if (method === "workspace.list") return { revision: 1, syntheticOnly: false, executionMode: "workspace", workspaces: ["A", "B"].map(workspaceId => ({ workspaceId, active: true })) };
    if (handlers[method]) return handlers[method](params);
    return snapshot(params.workspaceId);
  } }, () => "request", false, "workspace");
  return { model, calls };
}

test("G1 RPCs are workspace-scoped with exactly the contract fields; stale scopes and old Cores send nothing", async () => {
  const f = modelFixture(["workspace.default-runtime.v1"], {
    "workspace.defaultRuntime.get": params => g1({ workspaceId: params.workspaceId }),
    "workspace.defaultRuntime.set": params => g1({ workspaceId: params.workspaceId, defaultRuntimeId: params.defaultRuntimeId, revision: params.expectedRevision + 1 }) });
  await f.model.selectWorkspace("A");
  assert.equal(f.model.supportsDefaultRuntime(), true);
  assert.deepEqual(await f.model.defaultRuntime("A", "generation-A"), g1());
  assert.deepEqual(await f.model.saveDefaultRuntime("codex", 1, "A", "generation-A"), g1({ defaultRuntimeId: "codex", revision: 2 }));
  assert.deepEqual(f.calls.filter(call => call.method.startsWith("workspace.defaultRuntime.")), [
    { method: "workspace.defaultRuntime.get", params: { workspaceId: "A", expectedGeneration: "generation-A" } },
    { method: "workspace.defaultRuntime.set", params: { expectedRevision: 1, defaultRuntimeId: "codex", workspaceId: "A", expectedGeneration: "generation-A" } }]);
  await assert.rejects(() => f.model.defaultRuntime("B", "generation-B"), "stale scope rejected before sending");
  assert.equal(f.calls.some(call => call.method === "workspace.preferences.set"), false, "the old host-level preference is never written");
  const old = modelFixture(["workspace.preferences.default-runtime.v1"]); await old.model.selectWorkspace("A");
  assert.equal(old.model.supportsDefaultRuntime(), false, "the superseded host-level capability does not count");
  await assert.rejects(() => old.model.saveDefaultRuntime("codex", 1, "A", "generation-A"));
  assert.equal(old.calls.some(call => call.method.startsWith("workspace.defaultRuntime.")), false);
});

test("a reply for another workspace or of the wrong shape is rejected", async () => {
  const f = modelFixture(["workspace.default-runtime.v1"], { "workspace.defaultRuntime.get": () => g1({ workspaceId: "B" }) });
  await f.model.selectWorkspace("A");
  await assert.rejects(() => f.model.defaultRuntime("A", "generation-A"));
});

test("saving uses the current revision, reloads on failure, and never probes or starts an engine", () => {
  assert.match(source, /const fresh = await model\.defaultRuntime\(workspaceId, generation\); setValue\(await model\.saveDefaultRuntime\(next, fresh\.revision, workspaceId, generation\)\)/);
  assert.match(source, /catch \{ setNotice\("ws\.runtimes\.default\.saveFailed"\); void reload\(\)\.catch\(\(\) => \{\}\); \}/, "stale revision → reload and ask again, no blind overwrite");
  assert.doesNotMatch(source, /listModels|detectRuntimes|registerLocalRuntime|approveRuntime|preferences/);
});

test("a saved \"pi\" shows as «Pi (default)», since the fallback chain makes them identical", () => {
  assert.match(source, /const current = value\?\.defaultRuntimeId && value\.defaultRuntimeId !== "pi" \? value\.defaultRuntimeId : null;/);
});
