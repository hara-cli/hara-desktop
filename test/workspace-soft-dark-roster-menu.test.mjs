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

test("colleague roster menu matches the available actions plus Manage while deletion is undecided", () => {
  const html = render("colleague");
  for (const label of ["Pin", "Move to new section", "Mark as Unread", "Rename Bot", "Copy conversation ID", "Hide from sidebar", "Manage"])
    assert.match(html, new RegExp(`>${label}</button>`));
  assert.equal((html.match(/role="menuitem"/g) ?? []).length, 7);
  assert.doesNotMatch(html, /Duplicate|Archive/);
});

test("main Hara can open Manage but cannot Delete or Hide", () => {
  const html = render("main");
  assert.match(html, />Manage<\/button>/);
  assert.doesNotMatch(html, />Delete<\/button>/);
  assert.match(html, /disabled=""[^>]*>Hide from sidebar<\/button>/);
});

test("no Delete entry, internal archive code name, or row title tooltips remain", () => {
  const source = readFileSync(new URL("../src/WorkspaceLocalDev.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /rosterDelete|setRosterDelete|Soft Dark|title=\{(?:row\.identity\.displayName|item\.row\.agent\.identity\.displayName|item\.row\.name)\}/);
  assert.doesNotMatch(render("colleague"), />Delete<\/button>/);
  assert.match(source, /onManage=\{\(\) => void manageRosterAgent\(menuAgent\)\}/);
});
