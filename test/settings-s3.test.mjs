import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { makeT } from "../src/i18n.ts";

const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: 'export {SettingsContent} from "./src/WorkspaceSettings.tsx"; export {WorkspaceThemeSettings, WorkspaceAppearanceAdvanced} from "./src/WorkspaceSettingsPanels.tsx"; export {WorkspaceDeletedColleagues} from "./src/WorkspaceDeletedColleagues.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const panels = readFileSync(new URL("../src/WorkspaceSettingsPanels.tsx", import.meta.url), "utf8");
const esc = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");

function render(element, locale = "zh-Hans", store = {}) {
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => key === "hara.locale" ? locale : store[key] ?? null, setItem() {} } });
  try { return renderToStaticMarkup(element); }
  finally { if (before) Object.defineProperty(globalThis, "localStorage", before); else delete globalThis.localStorage; }
}
const agent = (agentId, patch = {}) => ({ agentId, kind: "colleague", state: "active", identity: { displayName: agentId, title: "Writer" }, runtime: { id: "codex", label: "Codex", available: true }, ...patch });
const workspace = (patch = {}) => ({ workspaceId: "ws_123", resourceGeneration: "g", label: "Alpha", selectedAgentId: "main", syntheticOnly: false, executionMode: "workspace",
  agents: [{ agentId: "main", kind: "main", state: "active", identity: { displayName: "Hara" }, runtime: { id: "pi", label: "Pi", available: true } }, agent("Ann"), agent("Bo"), agent("Old", { state: "archived", archivedAt: "2026-11-01T00:00:00Z" })],
  connections: { revision: 1, defaultConnectionId: "one", connections: [{ id: "one", label: "OpenRouter", provider: "openai", defaultModel: "m", baseURL: "https://x.invalid", keyState: "saved", keySaved: true, status: "active" }] },
  runtimes: { options: [{ runtimeId: "codex", label: "Codex", registered: true, state: "registered" }, { runtimeId: "claude", label: "Claude Code", registered: false, state: "detected" }], operations: [] },
  approvals: [], conversation: { history: [], state: "idle", pastTaskCount: 3, usage: { modelCalls: 7 }, runUsage: { modelCalls: 0 } }, ...patch });
const updater = { getSnapshot: () => ({ phase: "latest", version: "", notes: "", downloaded: 0, total: 0, notice: false, message: "", preferences: { autoCheck: true, lastChecked: null }, installing: false }), subscribe: () => () => {} };
const theme = (patch = {}) => ({ preference: "system", settings: { readOnly: false, alwaysShowTimingDiagnostics: false }, notice: "", change() {}, changeDetails() {}, chooseTheme() {}, changeAppearance() {}, changeTimingDiagnostics() {}, appearance: { darkTheme: "violet-glass", transparency: "system", motion: "system" }, ...patch });
function settings(page, { locale = "zh-Hans", kind = "personal", ws = workspace() } = {}) {
  const value = { workspaceId: ws.workspaceId, workspace: ws, directory: { workspaces: [{ workspaceId: ws.workspaceId, label: ws.label, role: "owner", active: true, kind }] }, error: "" };
  const model = { getSnapshot: () => value, subscribe: () => () => {}, supportsAgentArchive: () => true };
  return render(createElement(module.exports.SettingsContent, { model, mainModel: model, initialPage: page, root: "/private/fixture", production: false, updater, versionInfo: { desktop: "1.3.0", engine: "1.3.0", channel: "stable", arch: "aarch64" }, onClose() {}, onCreateSkill() {}, theme: theme() }), locale);
}

for (const locale of ["zh-Hans", "en", "zh-Hant"]) test(`overview cards state the page's situation in one line (${locale})`, () => {
  const t = makeT(locale), html = settings("overview", { locale });
  assert.ok(html.includes(`<p>${esc(t("ws.settings.summary.colleagues", { n: 2 }))}</p>`), "archived colleagues are not counted");
  assert.ok(html.includes(`<p>${esc(t("ws.settings.summary.connectionCurrent", { count: t("ws.settings.connectionOne", { n: 1 }), name: "OpenRouter" }))}</p>`));
  assert.ok(html.includes(`<p>${esc(t("ws.settings.summary.runtimes", { n: 1 }))}</p>`), "only enabled engines are counted");
  assert.ok(html.includes(`<p>${esc(`${t("ws.settings.personal")} · ${t("ws.settings.general.owner")}`)}</p>`));
});

test("«Members» has no entry in any workspace, since it is not released", () => {
  for (const kind of ["personal", "team"]) {
    const html = settings("overview", { kind });
    assert.equal(html.includes(">成员<"), false, kind);
  }
});

test("colleagues open on the active tab and show each colleague's engine; deleted stays one tab away", () => {
  const html = render(createElement(module.exports.WorkspaceDeletedColleagues, { model: { supportsAgentArchive: () => true }, workspace: workspace(), locale: "zh-Hans" }));
  assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*>同事 ·/);
  assert.ok(html.includes("<strong>Ann</strong><span>Writer</span><small class=\"hd-colleague-engine\">Codex</small>"));
  assert.equal(html.includes("<strong>Old</strong>"), false, "deleted colleagues are on the other tab");
});

for (const locale of ["zh-Hans", "en", "zh-Hant"]) test(`workspace general keeps name, kind, role and history visible; ID and path move under Advanced (${locale})`, () => {
  const t = makeT(locale), html = settings("general", { locale }), fold = html.indexOf('data-settings-advanced="general"');
  const before = html.slice(0, fold), inside = html.slice(fold);
  assert.ok(before.includes(t("ws.settings.general.kind")) && before.includes(t("ws.settings.general.role")) && before.includes(t("ws.settings.general.history")));
  assert.equal(before.includes("ws_123"), false); assert.equal(before.includes("/private/fixture/project/ws_123"), false);
  assert.ok(inside.includes("ws_123") && inside.includes("/private/fixture/project/ws_123") && inside.includes(`>${t("ws.settings.general.copyPath")}</button>`));
});

test("appearance: three cards and «Follow system» in one place; all three stored values remain reachable", () => {
  const html = render(createElement(module.exports.WorkspaceThemeSettings, { theme: theme() }));
  assert.match(html, /跟随系统<\/span><button type="button" role="switch" aria-label="跟随系统" aria-checked="true"/);
  assert.doesNotMatch(html, /<select aria-label="主题"/, "the duplicate drop-down is gone");
  assert.match(panels, /onCheckedChange=\{checked => void \(checked \? theme\.change\("system"\) : theme\.chooseTheme\(systemPrefersLight\(\) \? "daylight" : appearance\.darkTheme\)\)\}/,
    "on → system; off → the card that matches what is showing (light or dark), via the existing save calls");
  assert.match(panels, /onClick=\{\(\) => void theme\.chooseTheme\(value\)\}/, "cards still choose light / dark explicitly");
  for (const text of ["vg-material-pref", "#7C3AED"]) assert.equal(html.includes(text), false, `${text} moved to Advanced`);
});

test("appearance Advanced holds transparency, motion, timing diagnostics and the brand note, and shows what was customized", () => {
  const plain = render(createElement(module.exports.WorkspaceAppearanceAdvanced, { theme: theme() }));
  assert.ok(plain.includes('data-settings-advanced="appearance"') && plain.includes("vg-material-pref") && plain.includes("#7C3AED"));
  assert.equal(plain.includes("wss-advanced-custom"), false, "defaults show no customized marker");
  const changed = render(createElement(module.exports.WorkspaceAppearanceAdvanced, { theme: theme({ appearance: { darkTheme: "obsidian", transparency: "off", motion: "system" }, settings: { readOnly: false, alwaysShowTimingDiagnostics: true } }) }));
  const t = makeT("zh-Hans");
  assert.ok(changed.includes(t("ws.settings.advanced.customized", { items: [t("vg.transparency"), t("ws.stages.alwaysShow")].join(t("ws.settings.listSeparator")) })));
});

test("software update: status and auto-check stay visible; cadence and version details move under Advanced; previews are hidden", () => {
  const html = settings("updates"), fold = html.indexOf('data-settings-advanced="updates"');
  assert.ok(html.slice(0, fold).includes("自动检查更新") || html.slice(0, fold).includes(makeT("zh-Hans")("ws.updates.auto")));
  assert.ok(html.slice(fold).includes(makeT("zh-Hans")("ws.updates.cadence")) && html.slice(fold).includes("版本详情（反馈问题时用）"));
  assert.equal(html.includes("接收预览版"), false);
});
