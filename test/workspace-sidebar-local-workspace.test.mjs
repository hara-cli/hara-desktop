import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import test from "node:test";
import assert from "node:assert/strict";

// Design §10 with Jeff's Q7–Q9 (2026-11-08): the local edition has one personal workspace; creating another needs a
// Hara account. "Recent" appears only when pinned rows or folders sit above it; rows breathe with whitespace.
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [fileURLToPath(new URL("../src/WorkspaceSidebarC.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react-dom"], loader: { ".css": "empty", ".svg": "empty", ".png": "empty", ".webp": "empty" }, write: false, logLevel: "silent" });
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const source = readFileSync(new URL("../src/WorkspaceSidebarC.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/desktop-redesign.css", import.meta.url), "utf8");

const noop = () => {};
const colleague = (id, name) => ({ id, kind: "colleague", name, role: "", preview: "Hi", order: 1, unread: 0, agent: { agentId: id, kind: "colleague", state: "active", identity: { displayName: name } } });
const directory = count => ({ revision: 1, activeWorkspaceId: "w1", syntheticOnly: false,
  workspaces: Array.from({ length: count }, (_, i) => ({ workspaceId: `w${i + 1}`, label: `Space ${i + 1}`, role: "owner", active: true })) });
const render = ({ workspaces = 1, preferences = {}, search = "" } = {}) => renderToStaticMarkup(createElement(module.exports.WorkspaceSidebarC, {
  locale: "en", workspaceId: "w1", workspaceName: "Space 1", directory: directory(workspaces), mainPreview: "", mainActive: false, selectedId: null,
  entries: [colleague("a", "Mia"), colleague("b", "Ops")], preferences, search, needsYou: 0, count: 2, disconnected: false, loading: false, inert: false,
  menuOpen: false, userLabel: "Jeff", settingsLabel: "Settings", onSearch: noop, onSelect: noop, onContextMenu: noop, onPreference: noop, onNeedsYou: noop,
  onColleagues: noop, onWorkspace: noop, onDiscuss: noop, onSettings: noop, onAccount: noop }));

test("one local workspace: no switch chevrons; several existing workspaces keep them", () => {
  const single = render();
  assert.match(single, /aria-label="Workspace and account"/u);
  assert.match(single, /<small>Space 1<\/small>/u, "no ⌃⌄ when there is nothing to switch to");
  assert.match(render({ workspaces: 2 }), /<small>Space 1 ⌃⌄<\/small>/u, "an existing multi-workspace install can still switch");
});

test("New Workspace is gone from the + menu and greyed out, with its reason, in the switcher menu", () => {
  assert.doesNotMatch(source, /onNewWorkspace/u, "the sidebar no longer opens workspace creation");
  const plusMenu = source.match(/className="hd-sidebar-popup hd-new-menu"[^\n]*/u)?.[0] ?? "";
  assert.doesNotMatch(plusMenu, /newWorkspace/u);
  const switcher = source.match(/className="hd-sidebar-popup hd-workspace-menu"[^\n]*/u)?.[0] ?? "";
  assert.match(switcher, /role="menuitemradio"/u, "existing workspaces stay switchable");
  assert.match(switcher, /className="hd-menu-unavailable" aria-disabled="true"[^>]*>\{r\("newWorkspace"\)\}<small[^>]*>\{r\("newWorkspaceUnavailable"\)\}<\/small><\/button>/u);
  assert.doesNotMatch(switcher, /hd-menu-unavailable[^>]*onClick/u, "the unavailable item does nothing");
  const copy = readFileSync(new URL("../src/desktop-redesign-copy.ts", import.meta.url), "utf8");
  assert.match(copy, /newWorkspaceUnavailable: \["需要 Hara 账号 · 即将推出", "Requires a Hara account · Coming soon", "需要 Hara 帳號 · 即將推出"\]/u);
});

test("Recent is shown only when pinned rows or folders sit above it", () => {
  const plain = render();
  assert.doesNotMatch(plain, /<h3 class="hd-roster-heading">Recent<\/h3>/u);
  assert.match(plain, /<section aria-label="Recent"><div class="hd-roster-gap" aria-hidden="true"><\/div>/u, "screen readers still hear the section name");
  assert.match(render({ preferences: { a: { pinned: true } } }), /<h3 class="hd-roster-heading">Recent<\/h3>/u);
  assert.match(render({ preferences: { a: { section: "Design" } } }), /<h3 class="hd-roster-heading">Recent<\/h3>/u);
  const searching = render({ search: "o" });
  assert.doesNotMatch(searching, /hd-roster-heading">Recent|hd-roster-gap/u);
});

test("roster rows use 44px with 2px between rows instead of separators", () => {
  assert.match(css, /\.hs\.hd-redesign\.vg-app \.hd-sidebar \.hd-roster-row\{height:44px;min-height:44px;padding:5px 8px\}/u);
  assert.match(css, /\.hs\.hd-redesign\.vg-app \.hd-sidebar \.hd-roster-row \.hd-row-text\{gap:2px\}/u);
  assert.match(css, /\.hd-row-wrap\+\.hd-row-wrap\{margin-top:2px\}/u);
});
