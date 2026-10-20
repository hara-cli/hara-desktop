import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";
import ts from "typescript";
import { makeT } from "../src/i18n.ts";
import { WORKSPACE_KEYS, WORKSPACE_EXTRA_KEYS } from "../src/workspace-i18n.ts";
import { WORKSPACE_SETTINGS_KEYS } from "../src/workspace-settings-i18n.ts";
import { workspaceMessageText, settingsStateText, runtimeOperationText } from "../src/workspace-settings-copy.ts";
import { updateDefaults } from "../src/workspace-updater-state.ts";
import { WorkspaceViewError } from "../src/workspace-dev-errors.ts";

const locales = ["en", "zh-Hans", "zh-Hant"], require = createRequire(import.meta.url);
const files = ["WorkspaceSettings.tsx", "WorkspaceSettingsPanels.tsx", "WorkspaceRuntimeSettings.tsx", "WorkspaceSoftwareUpdate.tsx"];
const bundle = await build({ stdin: { contents: `export {SettingsContent} from "./src/WorkspaceSettings.tsx";
  export {WorkspaceConnections, WorkspaceFeaturePanel, WorkspaceThemeSettings} from "./src/WorkspaceSettingsPanels.tsx";
  export {WorkspaceConnectionForm, default as Runtime} from "./src/WorkspaceRuntimeSettings.tsx";
  export {WorkspaceSoftwareUpdate, WorkspaceUpdateNotice} from "./src/WorkspaceSoftwareUpdate.tsx";`,
  loader: "tsx", resolveDir: new URL("../", import.meta.url).pathname }, bundle: true, platform: "node", format: "cjs", jsx: "automatic",
  external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
function render(name, props, locale) {
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => key === "hara.locale" ? locale : null } });
  try { return renderToStaticMarkup(createElement(module.exports[name], props)); }
  finally { if (before) Object.defineProperty(globalThis, "localStorage", before); else delete globalThis.localStorage; }
}
const workspace = { workspaceId: "A", resourceGeneration: "generation-A", label: "Workspace Alpha", selectedAgentId: "main", syntheticOnly: false, executionMode: "workspace",
  agents: [{ agentId: "main", kind: "main", state: "active", identity: { displayName: "Hara" }, runtime: { id: "pi", label: "Pi", available: true } }],
  connections: { revision: 1, defaultConnectionId: "one", connections: [{ id: "one", label: "Connection Alpha", provider: "openai", defaultModel: "fixture-model", baseURL: "https://example.invalid/v1", keyState: "saved", keySaved: true, status: "active" }] },
  approvals: [], conversation: { history: [], state: "idle", usage: { modelCalls: 0 }, runUsage: { modelCalls: 0 } } };
const info = { desktop: "1.1.0", engine: "1.0.2", channel: "fixture", arch: "aarch64" };
const theme = { preference: "system", settings: { readOnly: false }, notice: "", change() {}, changeDetails() {} };
const updateView = (patch = {}) => ({ phase: "latest", version: "1.1.1", notes: "Fixture release notes", downloaded: 50, total: 100,
  notice: true, message: "", preferences: updateDefaults(), installing: false, ...patch });
const updater = value => ({ getSnapshot: () => value, subscribe: () => () => {} });
const escape = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
function localized(html, locale) {
  assert.equal(/ws\.(?:settings|connections|runtimes|skills|schedules|updates|theme)\./.test(html), false, "no unresolved translation key");
  if (locale === "en") assert.equal(/\p{Script=Han}/u.test(html.replace(/<option value="zh-(?:Hans|Hant)"[^>]*>[^<]*<\/option>/g, "")), false, "English controls do not fall back to Chinese");
}

test("all settings pages, model connection states, runtimes and appearance render in each locale", () => {
  for (const locale of locales) {
    const t = makeT(locale), value = { workspaceId: "A", workspace, directory: { workspaces: [{ workspaceId: "A", label: workspace.label, active: true, kind: "team", role: "admin" }] }, error: "ws.connections.saveUnknown" };
    const model = { getSnapshot: () => value, subscribe: () => () => {} };
    for (const page of ["overview", "connections", "runtimes", "schedules", "skills", "members", "general", "appearance", "updates"]) {
      const html = render("SettingsContent", { model, mainModel: model, initialPage: page, root: "/synthetic", production: true,
        theme, updater: updater(updateView()), versionInfo: info, onClose() {}, onCreateSkill() {} }, locale);
      assert.ok(html.includes(escape(t(`ws.settings.page.${page}`))), `${locale} ${page}`);
      assert.ok(html.includes(escape(t("ws.connections.saveUnknown"))), "existing model error follows the page language");
      localized(html, locale);
      if (page === "general") {
        assert.ok(html.includes(`<dd>${t("ws.settings.team")}</dd>`));
        assert.ok(html.includes(`<dd>${t("ws.settings.general.admin")}</dd>`));
        assert.equal(html.includes(t("ws.settings.general.personalNote")), false, "a team workspace is never presented as personal");
      }
    }
    for (const flags of [{}, { readOnly: true, migrationPending: true }, { readOnly: true, recovered: true }, { readOnly: true, unavailable: true }, { readOnly: true }]) {
      const html = render("WorkspaceConnections", { model: {}, workspace: { ...workspace, connections: { ...workspace.connections, ...flags } } }, locale);
      localized(html, locale); assert.ok(html.includes("••••••••••••"));
    }
    for (const keyState of ["invalid", "pending"]) {
      const html = render("WorkspaceConnections", { model: {}, workspace: { ...workspace, connections: { ...workspace.connections, connections: [{ ...workspace.connections.connections[0], keyState, keySaved: keyState !== "pending" }] } } }, locale);
      assert.ok(html.includes(t(keyState === "invalid" ? "ws.connections.invalidKey" : "ws.connections.pending")));
    }
    const form = render("WorkspaceConnectionForm", { model: {}, existing: workspace.connections.connections[0] }, locale);
    for (const key of ["name", "protocol", "model", "keepKey", "save"]) assert.ok(form.includes(escape(t(`ws.connections.${key}`))), key);
    assert.match(form, /type="password"[^>]*value=""/); localized(form, locale);
    const runtime = render("Runtime", { model: {}, workspace: { ...workspace, runtimes: { options: [], operations: ["downloading", "registered", "failed", "cancelled"].map(state => ({ id: state, runtimeId: "fixture", state })) } } }, locale);
    assert.ok(runtime.includes(t("ws.runtimes.title"))); localized(runtime, locale);
    assert.ok(runtime.includes(t("ws.runtimes.cancelled")));
  }
});

test("every updater phase, notice and candidate page uses the current locale without touching updater operations", () => {
  for (const locale of locales) {
    const t = makeT(locale);
    for (const [phase, title] of [["latest", "checkTitle"], ["checking", "checking"], ["available", "available"], ["downloading", "downloading"], ["ready", "ready"], ["error", "failed"]]) {
      const value = updateView({ phase, message: "ws.updates.signatureFailed" });
      const html = render("WorkspaceSoftwareUpdate", { controller: updater(value), info }, locale);
      assert.ok(html.includes(t(`ws.updates.${title}`, { version: value.version })));
      assert.ok(html.includes(escape(t("ws.updates.signatureFailed"))));
      assert.ok(html.includes(`aria-label="${escape(t("ws.updates.previewFuture"))}" aria-checked="false" disabled=""`));
      localized(html, locale);
      if (["available", "ready"].includes(phase)) localized(render("WorkspaceUpdateNotice", { controller: updater(value), onView() {} }, locale), locale);
    }
    const candidate = render("WorkspaceSoftwareUpdate", { controller: updater(updateView()), info: { ...info, isolatedCandidate: true } }, locale);
    assert.ok(candidate.includes(escape(t("ws.updates.candidateNote"))));
    assert.equal(/role="switch"|data-update-state/.test(candidate), false, "candidate retains its public updater boundary"); localized(candidate, locale);
  }
});

test("fixed notices retranslate after a language change while user data and unknown protocol states remain intact", () => {
  for (const locale of locales) {
    const t = makeT(locale);
    for (const [key] of [...WORKSPACE_SETTINGS_KEYS, ...WORKSPACE_EXTRA_KEYS.filter(row => row[0].startsWith("ws.notice."))]) assert.equal(workspaceMessageText(t, key), t(key));
    const error = new WorkspaceViewError("ws.notice.invalidReceipt");
    assert.equal(workspaceMessageText(t, String(error)), t("ws.notice.invalidReceipt"));
    for (const raw of ["User title · 資料与内容", "future_state", "constructor", "__proto__"]) {
      assert.equal(workspaceMessageText(t, raw), raw); assert.equal(settingsStateText(t, raw), raw); assert.equal(runtimeOperationText(t, raw), raw);
    }
    assert.equal(settingsStateText(t, "failed"), t("ws.schedules.failed"));
    assert.equal(runtimeOperationText(t, "failed"), t("ws.runtimes.failed"));
    const name = "User title · 資料与内容";
    const html = render("WorkspaceConnectionForm", { model: {}, existing: { ...workspace.connections.connections[0], label: name } }, locale);
    assert.ok(html.includes(escape(name)), "saved names are never converted or translated");
    assert.equal(makeT(locale)("ws.schedules.runConfirm", { name: "Task One", workspace: "Space Two" }).includes("{"), false);
  }
});

test("settings Chinese dictionaries do not mix the common Simplified and Traditional character variants", () => {
  const traditional = /[連啟閉顯檔儲讀寫請權鑰憑設預認選擇當為這個還後時開關體語復過進務執環發級匯刪優無鎖變記與僅頁獨簡備據歷覽敗餘點號對暫則網絡驗運導傳]/u;
  const simplified = /[连启闭显档储读写请权钥凭设预认选择当为这个还后时开关体语复过进务执环发级汇删优无锁变记与仅页独简备据历览败余点号对暂则网络验运导传]/u;
  for (const [key, , hans, hant] of [...WORKSPACE_SETTINGS_KEYS, ...WORKSPACE_EXTRA_KEYS.filter(row => row[0].startsWith("ws.notice."))]) {
    assert.equal(traditional.test(hans), false, `${key} Simplified`);
    assert.equal(simplified.test(hant), false, `${key} Traditional`);
  }
});

test("settings source routes visible copy and async notices through the three-language dictionaries", () => {
  const known = new Set([...WORKSPACE_KEYS, ...WORKSPACE_EXTRA_KEYS].map(row => row[0]));
  for (const file of [...files, "workspace-updater-state.ts", "workspace-dev-state.ts", "workspace-dev-errors.ts"]) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), violations = [];
    function visit(node) {
      if (ts.isJsxText(node) && /\p{Script=Han}/u.test(node.text)) {
        const option = node.parent;
        const value = ts.isJsxElement(option) && option.openingElement.tagName.getText(ast) === "option"
          ? option.openingElement.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "value")?.initializer?.text : undefined;
        if (!(file === "WorkspaceSettings.tsx" && ((value === "zh-Hans" && node.text === "简体中文") || (value === "zh-Hant" && node.text === "繁體中文")))) violations.push(node.text);
      }
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateSpan(node)) && /\p{Script=Han}/u.test(node.getText(ast))) violations.push(node.getText(ast));
      if (ts.isStringLiteral(node) && node.text.startsWith("ws.")) assert.ok(known.has(node.text), `${file}: ${node.text}`);
      ts.forEachChild(node, visit);
    }
    visit(ast); assert.deepEqual(violations, [], file);
  }
});
