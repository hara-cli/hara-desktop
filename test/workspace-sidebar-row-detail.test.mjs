import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import test from "node:test";
import assert from "node:assert/strict";

// Jeff Q43–Q44, 2026-11-09: name · short role; the second line always shows a real preview or No messages yet.
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [fileURLToPath(new URL("../src/WorkspaceSidebarC.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react-dom"], loader: { ".css": "empty", ".svg": "empty", ".png": "empty", ".webp": "empty" }, write: false, logLevel: "silent" });
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");

const agent = (agentId, displayName, title) => ({ agentId, kind: "colleague", state: "active", identity: { displayName, ...(title === undefined ? {} : { title }) } });
const entry = (id, name, role, preview, order) => ({ id, kind: "colleague", name, role, preview, order, unread: 0, agent: agent(id, name, role || undefined) });
const noop = () => {};
function render(entries) {
  const html = renderToStaticMarkup(createElement(module.exports.WorkspaceSidebarC, { locale: "en", workspaceId: "ws", workspaceName: "My workspace", directory: null,
    mainPreview: "", mainActive: false, selectedId: null, entries, preferences: {}, search: "", needsYou: 0, count: entries.length,
    disconnected: false, loading: false, inert: false, menuOpen: false, userLabel: "You", settingsLabel: "Settings",
    onSearch: noop, onSelect: noop, onContextMenu: noop, onPreference: noop, onNeedsYou: noop, onColleagues: noop, onWorkspace: noop,
    onNewWorkspace: noop, onDiscuss: noop, onSettings: noop, onAccount: noop }));
  return id => {
    const start = html.indexOf(`data-roster-id="${id}"`); assert.ok(start >= 0, `row ${id} rendered`);
    const row = html.slice(start, html.indexOf("</button>", start));
    const text = row.match(/<span class="hd-row-text">([\s\S]*)$/u)?.[1] ?? "";
    return { heading: text.match(/<span class="hd-row-heading">([\s\S]*?)<\/span>/u)?.[1] ?? "",
      detail: text.match(/<span class="(hd-row-preview[^"]*)">([^<]*)<\/span>/u) };
  };
}

test("colleague rows keep short roles on the heading and reserve the second line for messages", () => {
  const row = render([entry("titled", "Mia", "Designer", "", 3), entry("untitled", "Ops", "", "", 2), entry("talking", "Coder", "Engineer", "Shipped the patch", 1)]);
  const titled = row("titled");
  assert.match(titled.heading, /<strong class="hd-row-name">Mia<\/strong><span class="hd-row-role">· Designer/u);
  assert.equal(titled.detail?.[2], "No messages yet"); assert.equal(titled.detail?.[1], "hd-row-preview is-empty");
  const untitled = row("untitled");
  assert.match(untitled.heading, /<strong class="hd-row-name">Ops<\/strong>$/u);
  assert.equal(untitled.detail?.[2], "No messages yet");
  const talking = row("talking");
  assert.match(talking.heading, /<strong class="hd-row-name">Coder<\/strong><span class="hd-row-role">· Engineer/u);
  assert.equal(talking.detail?.[2], "Shipped the patch"); assert.equal(talking.detail?.[1], "hd-row-preview");
});

test("group rows keep their member count and the empty-conversation notice", () => {
  const row = render([{ id: "channel:1", kind: "group", name: "Launch", role: "3 members", preview: "", order: 1, unread: 0 }]);
  const group = row("channel:1");
  assert.match(group.heading, /Launch<\/strong><span class="hd-row-role">· 3 members$/u);
  assert.equal(group.detail?.[2], "No messages yet");
});
