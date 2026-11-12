import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { ADVANCED_STORAGE_KEY, loadAdvancedOpen, saveAdvancedOpen, settingsAttentionPages } from "../src/settings-advanced-state.ts";

const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: 'export {SettingsAdvanced,SettingsRowMenu,SettingsAttention} from "./src/SettingsChrome.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");

function memoryStore(initial = {}) { const data = { ...initial }; return { data, getItem: key => key in data ? data[key] : null, setItem: (key, value) => { data[key] = String(value); } }; }
function render(element, { locale = "zh-Hans", saved = null } = {}) {
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => key === "hara.locale" ? locale : key === ADVANCED_STORAGE_KEY ? saved : null, setItem() {} } });
  try { return renderToStaticMarkup(element); }
  finally { if (before) Object.defineProperty(globalThis, "localStorage", before); else delete globalThis.localStorage; }
}
const advanced = props => createElement(module.exports.SettingsAdvanced, { page: "runtimes", items: ["网络代理", "安装位置"], ...props }, createElement("input", { "aria-label": "inside" }));

test("Advanced is one collapsed section whose summary lists its items and says they usually need no change", () => {
  const html = render(advanced());
  assert.match(html, /^<details class="wss-advanced" data-settings-advanced="runtimes">/);
  assert.equal(html.includes(" open"), false, "collapsed by default");
  for (const text of ["高级", "· 网络代理、安装位置", "一般不用改"]) assert.ok(html.includes(text), text);
  assert.equal(html.includes("已自定义"), false, "no customized marker while everything is default");
  assert.ok(html.includes('aria-label="inside"'), "controls stay mounted so they keep their own state and RPCs");
});

test("a non-default value inside stays visible on the collapsed row, in all three languages", () => {
  assert.ok(render(advanced({ customized: ["网络代理"] })).includes("已自定义：网络代理"));
  const en = render(advanced({ items: ["Network proxy", "Install location"], customized: ["Network proxy"] }), { locale: "en" });
  for (const text of ["Advanced", "· Network proxy, Install location", "Customized: Network proxy", "Usually no need to change"]) assert.ok(en.includes(text), text);
  const hant = render(advanced({ items: ["網路代理"], customized: ["網路代理"] }), { locale: "zh-Hant" });
  for (const text of ["進階", "已自訂：網路代理", "一般不用改"]) assert.ok(hant.includes(text), text);
});

test("expansion is remembered per page on this Mac only and survives unavailable storage", () => {
  const store = memoryStore();
  assert.equal(loadAdvancedOpen("runtimes", store), false);
  saveAdvancedOpen("runtimes", true, store);
  assert.equal(loadAdvancedOpen("runtimes", store), true);
  assert.equal(loadAdvancedOpen("connections", store), false, "each page keeps its own state");
  saveAdvancedOpen("connections", true, store); saveAdvancedOpen("runtimes", false, store);
  assert.deepEqual(JSON.parse(store.data[ADVANCED_STORAGE_KEY]), { connections: true });
  assert.ok(render(advanced(), { saved: JSON.stringify({ runtimes: true }) }).startsWith('<details class="wss-advanced" data-settings-advanced="runtimes" open="">'));
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(loadAdvancedOpen("runtimes", broken), false);
  assert.doesNotThrow(() => saveAdvancedOpen("runtimes", true, broken));
  assert.equal(loadAdvancedOpen("runtimes", memoryStore({ [ADVANCED_STORAGE_KEY]: "{not json" })), false);
  assert.equal(loadAdvancedOpen("runtimes", memoryStore({ [ADVANCED_STORAGE_KEY]: JSON.stringify({ runtimes: "yes" }) })), false, "only booleans count");
  assert.equal(loadAdvancedOpen("runtimes", null), false);
});

test("the Advanced preference is local UI state, not a workspace setting or RPC", () => {
  const source = readFileSync(new URL("../src/settings-advanced-state.ts", import.meta.url), "utf8") + readFileSync(new URL("../src/SettingsChrome.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /workspaceRequest|savePreference|workspace\.preferences|model\./);
});

test("Advanced inside a read-only page can still open while its controls stay disabled", () => {
  const html = render(createElement("fieldset", { disabled: true }, advanced()));
  assert.match(html, /<fieldset disabled="">.*<summary>/s, "summary is not a form control and remains operable");
});

test("row-end menu is a labelled, closed menu button that only exposes items when opened", () => {
  const items = [{ id: "edit", label: "编辑", onSelect() {} }, { id: "delete", label: "删除", danger: true, onSelect() {} }];
  const html = render(createElement(module.exports.SettingsRowMenu, { label: "OpenRouter", items }));
  assert.ok(html.includes('aria-label="OpenRouter的更多操作"'));
  assert.ok(html.includes('aria-haspopup="menu"') && html.includes('aria-expanded="false"'));
  assert.equal(/role="menu"|删除/.test(html), false, "destructive items are not rendered inline");
  assert.ok(render(createElement(module.exports.SettingsRowMenu, { label: "x", items: [] })).includes('disabled=""'), "an empty menu cannot open");
  assert.ok(render(createElement(module.exports.SettingsRowMenu, { label: "x", items: [{ id: "a", label: "a", disabled: true, onSelect() {} }] })).includes('disabled=""'), "a menu whose items are all disabled cannot open (it could not be closed from the keyboard)");
  const source = readFileSync(new URL("../src/SettingsChrome.tsx", import.meta.url), "utf8");
  for (const pattern of [/"Escape"/, /"ArrowDown"/, /"ArrowUp"/, /"Home"/, /"End"/, /trigger\.current\?\.focus\(\)/, /is-up/])
    assert.match(source, pattern, "keyboard, focus return and flip are implemented");
});

test("attention bar is pinned, one sentence plus one button, and renders nothing when clear", () => {
  assert.equal(render(createElement(module.exports.SettingsAttention, { items: [] })), "");
  const html = render(createElement(module.exports.SettingsAttention, { items: [{ id: "key", text: "OpenRouter 的 Key 失效了", action: { label: "更新 Key", onClick() {} } }] }));
  assert.ok(html.includes('role="status"') && html.includes('data-settings-attention="key"') && html.includes("OpenRouter 的 Key 失效了") && html.includes(">更新 Key</button>"));
});

test("nav attention dots come from one derived source and keep today's update behaviour", () => {
  assert.deepEqual([...settingsAttentionPages({ updateAttention: true })], ["updates"]);
  assert.deepEqual([...settingsAttentionPages({ updateAttention: false })], []);
  const shell = readFileSync(new URL("../src/WorkspaceSettings.tsx", import.meta.url), "utf8");
  assert.match(shell, /settingsAttentionPages\(\{ updateAttention: hasUpdateAttention\(updates\) \}\)/);
  assert.match(shell, /attention\.has\(id\) \? <i className="wss-update-dot" role="img" aria-label=\{t\("ws\.settings\.attention"\)\} \/>/);
});

test("chrome colours come from DESIGN.md tokens that follow the theme (menu, danger, warning) and amber is kept for attention only", () => {
  const css = readFileSync(new URL("../src/workspace-settings.css", import.meta.url), "utf8");
  assert.match(css, /^\/\*[\s\S]*?\*\/\n@import "\.\/hara-tokens\.generated\.css" layer\(hara-tokens\);/, "tokens are layered so existing --hara-* values keep precedence");
  const rule = selector => css.slice(css.indexOf(selector)).split("}")[0];
  assert.match(rule(".wss-row-menu-list{"), /background:var\(--hara-menu\)/);
  assert.match(rule('[role="menuitem"].is-danger{'), /color:var\(--hara-danger\)/);
  assert.match(rule(".wss-attention{"), /background:var\(--hara-warning-soft\)/);
  assert.match(rule(".wss-attention>.hico{"), /color:var\(--hara-warning\)/);
  assert.doesNotMatch(rule(".wss-advanced-custom{"), /warning|waiting|EAB308/, "Customized is informational, not an alert colour");
  const chrome = css.slice(css.indexOf("/* S0 settings chrome"));
  assert.doesNotMatch(chrome, /status-failed|status-waiting|#EAB308|#EF4444|border-radius:\d+px/, "no fixed status colours or off-scale radii");
});
