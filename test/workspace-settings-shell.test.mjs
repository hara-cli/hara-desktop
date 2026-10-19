import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { WorkspaceUpdater, updateDefaults } from "../src/workspace-updater-state.ts";
import { localeFromSystem, makeT } from "../src/i18n.ts";
const require = createRequire(import.meta.url), root = new URL("../", import.meta.url).pathname;
const bundle = await build({ stdin: { contents: 'export {SettingsContent} from "./src/WorkspaceSettings.tsx"; export {WorkspaceSoftwareUpdate} from "./src/WorkspaceSoftwareUpdate.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const render = (name, props) => renderToStaticMarkup(createElement(module.exports[name], props));
const snapshot = id => ({ workspaceId: id, resourceGeneration: "generation-" + id, label: id, selectedAgentId: "main", syntheticOnly: false, executionMode: "workspace",
  agents: [{ agentId: "main", kind: "main", state: "active", identity: { displayName: "Hara" }, runtime: { id: "pi", label: "Pi", available: true } }],
  connections: { revision: 1, defaultConnectionId: null, connections: [] }, approvals: [], conversation: { history: [], state: "idle", usage: { modelCalls: 0 }, runUsage: { modelCalls: 0 } } });
function controller() { return new WorkspaceUpdater({ load: async () => updateDefaults(), save: async () => {}, check: async () => null, activity: async () => ({ running: 0 }), prepare: async () => ({ id: "fixture" }), release: async () => {}, restart: async () => {}, error: () => "Fixture error" }); }
const info = { desktop: "1.0.0", engine: "1.0.0", channel: "candidate", arch: "aarch64" };
function settings(page, kind = "personal") {
  const workspace = snapshot("A"), value = { workspaceId: "A", workspace, directory: { workspaces: [{ workspaceId: "A", label: "A", role: "owner", active: true, kind }] }, error: "" };
  const model = { getSnapshot: () => value, subscribe: () => () => {} };
  return render("SettingsContent", { model, mainModel: model, initialPage: page, root: "/private/fixture", production: true, updater: controller(), versionInfo: info, onClose() {}, onCreateSkill() {},
    theme: { preference: "system", settings: { readOnly: false }, notice: "", change() {}, changeDetails() {} } });
}
test("full-window settings has two scopes, accessible navigation and no drawer/template or unapproved browser settings", () => {
  const html = settings("overview");
  for (const value of ['aria-label="设置导航"', 'aria-current="page"', 'aria-haspopup="menu"', "返回 Hara", "仅当前空间", "所有空间", "连接", "运行时", "定时任务", "技能", "外观与语言", "软件更新"]) assert.equal(html.includes(value), true, value);
  assert.equal(/wsd-settings|模板|浏览器扩展|>成员<|WORKSPACE LAB/.test(html), false);
  assert.equal(settings("overview", "team").includes(">成员<"), true);
});
test("workspace and device page scope chips are distinct; appearance has no unapproved language switch", () => {
  assert.equal(settings("general").includes("■ 仅本空间"), true);
  const appearance = settings("appearance"); assert.equal(appearance.includes("○ 这台 Mac · 所有空间"), true); assert.equal(appearance.includes("默认折叠执行详情"), true);
  assert.equal(appearance.includes('aria-label="界面语言"'), false);
});
test("preview updates row is present but disabled/off, and version copy contains only safe build metadata", () => {
  const html = settings("updates"); assert.equal(html.includes("接收预览版，以后提供"), true); assert.equal(/aria-label="接收预览版，以后提供" aria-checked="false" disabled=""/.test(html), true);
  for (const value of ["Desktop", "引擎", "candidate", "aarch64", "复制版本信息"]) assert.equal(html.includes(value), true);
  assert.equal(html.includes("1.0.0"), true, "the prepared Desktop/Core version is visible without changing the installed app");
  assert.equal(/API Key|agent|Codex|Claude|OpenCode/.test(html), false);
});
test("settings-only model uses a separate view selection route, with no catalog selection or automatic mutation", async () => {
  const calls = [], rpc = { async request(method, params) { calls.push({ method, params }); return method === "workspace.list" ? { revision: 4, executionMode: "workspace", syntheticOnly: false, workspaces: ["A", "B"].map(workspaceId => ({ workspaceId, active: true })) } : snapshot(params.workspaceId); } };
  const model = new WorkspaceDevModel(rpc, () => "fixture", false, "workspace", true); await model.selectWorkspace("B");
  assert.equal(model.getSnapshot().workspaceId, "B"); assert.equal(calls.some(call => call.method === "workspace.select"), false); assert.equal(calls.filter(call => call.method === "workspace.settings.select").length, 1);
});
test("generic zh chooses Simplified Chinese without introducing a full language-selection flow", () => {
  assert.equal(localeFromSystem("zh"), "zh"); assert.equal(makeT(localeFromSystem("zh"))("cancel"), "取消"); assert.equal(localeFromSystem("en-US"), "en");
});
test("unsaved edits require confirmation before scope/page/return; passwords never populate saved forms", () => {
  const source = readFileSync(new URL("../src/WorkspaceSettings.tsx", import.meta.url), "utf8"), form = readFileSync(new URL("../src/WorkspaceRuntimeSettings.tsx", import.meta.url), "utf8");
  assert.equal(source.includes("window.confirm"), false, "Native settings cannot rely on optional WebView host dialogs");
  assert.equal(source.includes('role="alertdialog" aria-modal="true"'), true); assert.equal(source.includes("放弃未保存的修改？"), true);
  for (const kind of ["page", "scope", "close", "skill"]) assert.equal(source.includes(`requestLeave({ kind: "${kind}"`), true, kind);
  assert.equal(source.includes("onDirty={leaveGuard.setDirty}"), true); assert.equal(source.includes("leaveGuard.confirm()"), true);
  assert.equal(source.includes('event.key === "Escape"'), true); assert.equal(source.includes('event.key === "Tab"'), true);
  assert.equal(source.includes("inert={Boolean(decision)}"), true);
  assert.equal(form.includes('[apiKey, setKey] = useState("")'), true); assert.equal(form.includes('autoComplete="new-password"'), true);
});
