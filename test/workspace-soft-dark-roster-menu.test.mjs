import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";
import test from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [fileURLToPath(new URL("../src/WorkspaceRosterMenu.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", jsx: "automatic", external: ["react"], write: false });
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const props = kind => ({ agent: { agentId: kind, kind, identity: { displayName: kind === "main" ? "Hara" : "Dora" } }, x: 10, y: 10, locale: "en", pinned: false, conversationId: "session-1",
  onClose() {}, onManage() {}, onPin() {}, onMove() {}, onUnread() {}, onRename() {}, onCopyId() {}, onHide() {} });
const render = kind => { const old = globalThis.window; globalThis.window = { innerWidth: 1000, innerHeight: 900 };
  try { return renderToStaticMarkup(createElement(module.exports.WorkspaceRosterMenu, props(kind))); }
  finally { if (old === undefined) delete globalThis.window; else globalThis.window = old; } };

test("colleague menu exposes available actions, an actual folder submenu and optional archive authority", () => {
  const html = render("colleague");
  for (const label of ["Pin", "Move to Folder", "Mark as Unread", "Rename Colleague…", "Hide from Sidebar", "Manage Colleague…"]) assert.ok(html.includes(label), label);
  assert.match(html, /aria-haspopup="menu"/); assert.doesNotMatch(html, /Copy Conversation ID|Delete Colleague|Archive|disabled=""/);
  const withArchive = renderToStaticMarkup(createElement(module.exports.WorkspaceRosterMenu, { ...props("colleague"), onArchive() {} }));
  assert.match(withArchive, /Delete Colleague/);
});
test("main Hara has only Unread, Manage and an actually supported New Session", () => {
  const html = render("main"); assert.match(html, /Manage Hara/); assert.match(html, /Mark as Unread/);
  assert.doesNotMatch(html, /Hide from Sidebar|Delete|Move to Folder|Pin|New Session/);
  const supported = renderToStaticMarkup(createElement(module.exports.WorkspaceRosterMenu, { ...props("main"), onNewSession() {} })); assert.match(supported, /New Session/);
});
test("group menus omit deletion and internal identifiers; names have custom focus tooltips", () => {
  const html = renderToStaticMarkup(createElement(module.exports.WorkspaceRosterMenu, { ...props("colleague"), targetKind: "group", onArchive() {} }));
  assert.match(html, /Rename Group/); assert.match(html, /Manage Group/); assert.doesNotMatch(html, /Delete|session-1/);
  const source = readFileSync(new URL("src/WorkspaceSidebarC.tsx", new URL("../", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /title=/); assert.match(source, /role="tooltip"/);
});
