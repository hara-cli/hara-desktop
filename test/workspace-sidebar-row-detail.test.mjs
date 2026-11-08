import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import test from "node:test";
import assert from "node:assert/strict";

// Jeff 2026-11-08: a colleague row shows only its name on the first line. The second line is the latest message,
// else the colleague's title, else nothing; "No messages yet" is no longer shown for colleagues.
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

test("colleague rows: name only on the first line; latest message, else title, else no second line", () => {
  const row = render([entry("titled", "Mia", "Designer", "", 3), entry("untitled", "Ops", "", "", 2), entry("talking", "Coder", "Engineer", "Shipped the patch", 1)]);

  const titled = row("titled");
  assert.match(titled.heading, /<strong class="hd-row-name">Mia<\/strong>$/u, "no role after the name");
  assert.equal(titled.detail?.[2], "Designer"); assert.equal(titled.detail?.[1], "hd-row-preview hd-row-title");

  const untitled = row("untitled");
  assert.match(untitled.heading, /<strong class="hd-row-name">Ops<\/strong>$/u);
  assert.equal(untitled.detail, null, "no empty second line");

  const talking = row("talking");
  assert.match(talking.heading, /<strong class="hd-row-name">Coder<\/strong>$/u, "the title is not repeated beside the name");
  assert.equal(talking.detail?.[2], "Shipped the patch"); assert.equal(talking.detail?.[1], "hd-row-preview");

  for (const id of ["titled", "untitled", "talking"]) assert.doesNotMatch(JSON.stringify(row(id)), /No messages yet/u);
});

test("group rows keep their member count and the empty-conversation notice", () => {
  const row = render([{ id: "channel:1", kind: "group", name: "Launch", role: "3 members", preview: "", order: 1, unread: 0 }]);
  const group = row("channel:1");
  assert.match(group.heading, /Launch<\/strong><span class="hd-row-role">· 3 members$/u);
  assert.equal(group.detail?.[2], "No messages yet");
});
