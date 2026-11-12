import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { makeT } from "../src/i18n.ts";
import { connectionsNeedAttention, settingsAttentionPages } from "../src/settings-advanced-state.ts";

const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: 'export {WorkspaceConnections} from "./src/WorkspaceSettingsPanels.tsx"; export {WorkspaceConnectionForm} from "./src/WorkspaceRuntimeSettings.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const panels = readFileSync(new URL("../src/WorkspaceSettingsPanels.tsx", import.meta.url), "utf8");
function render(element, locale = "zh-Hans") {
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => key === "hara.locale" ? locale : null, setItem() {} } });
  try { return renderToStaticMarkup(element); }
  finally { if (before) Object.defineProperty(globalThis, "localStorage", before); else delete globalThis.localStorage; }
}
const row = (id, patch = {}) => ({ id, label: id === "one" ? "OpenRouter" : "Local", provider: "openai", defaultModel: "m", baseURL: `https://${id}.example.invalid/v1`, keyState: "saved", keySaved: true, status: "active", ...patch });
const workspace = (connections, patch = {}) => ({ workspaceId: "A", resourceGeneration: "g", label: "A", agents: [], connections: { revision: 3, defaultConnectionId: "one", connections, ...patch } });
const model = { legacyConnections: async () => [], workspaceRequest: async () => ({}), refresh: async () => {}, changeConnection: async () => {} };
const esc = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
const page = (ws, locale) => render(createElement(module.exports.WorkspaceConnections, { model, workspace: ws }), locale);

for (const locale of ["zh-Hans", "en", "zh-Hant"]) test(`connection rows keep the main task visible and move URLs and long notes into Advanced (${locale})`, () => {
  const t = makeT(locale), html = page(workspace([row("one"), row("two")]), locale);
  const fold = html.indexOf('data-settings-advanced="connections"'), before = html.slice(0, fold), inside = html.slice(fold);
  for (const text of ["OpenRouter", t("ws.connections.setCurrent"), t("ws.connections.add")]) assert.ok(before.includes(text), text);
  assert.equal(before.includes("one.example.invalid"), false, "service URL is not shown on the row");
  assert.ok(inside.includes("https://one.example.invalid/v1") && inside.includes("https://two.example.invalid/v1"), "URLs remain readable under Advanced");
  assert.ok(inside.includes(esc(t("ws.connections.keyNote"))) && inside.includes(esc(t("ws.connections.scopeNote"))));
  assert.ok(inside.includes(`${t("ws.settings.advanced")}</strong><span class="wss-advanced-items">· ${[t("ws.connections.advanced.urls"), t("ws.connections.advanced.keyStorage"), t("ws.connections.advanced.scope")].join(t("ws.settings.listSeparator"))}`));
  assert.equal(new RegExp(`>${t("ws.connections.edit")}</button>|>${t("ws.connections.delete")}</button>`).test(before), false, "edit and delete are not inline");
  assert.ok(before.includes(`aria-label="${t("ws.settings.rowMenu", { name: "OpenRouter" })}"`));
});

test("delete from the row menu still goes through the original confirmation and RPC", () => {
  assert.match(panels, /\{ id: "delete", label: t\("ws\.connections\.deleteMenu"\), danger: true, onSelect: \(\) => setConfirmDelete\(connection\) \}/);
  assert.match(panels, /onClick=\{\(\) => void perform\(\(\) => model\.changeConnection\(confirmDelete\.id, true\)\)\}>\{t\("ws\.connections\.deleteConfirm"\)\}/);
});

for (const locale of ["zh-Hans", "en", "zh-Hant"]) test(`states that need the user are pinned bars with one action (${locale})`, () => {
  const t = makeT(locale);
  const invalid = page(workspace([row("one", { keyState: "invalid" }), row("two", { cleanupPending: true })]), locale);
  assert.ok(invalid.indexOf('data-settings-attention="key-one"') < invalid.indexOf(`<h3>${t("ws.connections.heading")}</h3>`), "pinned above the list");
  assert.ok(invalid.includes(esc(t("ws.connections.attention.invalidKey", { name: "OpenRouter" }))) && invalid.includes(`>${t("ws.connections.attention.updateKey")}</button>`));
  assert.ok(invalid.includes('data-settings-attention="cleanup-two"') && invalid.includes(esc(t("ws.connections.attention.cleanup", { name: "Local" }))) && invalid.includes(`>${t("ws.connections.cleanup")}</button>`));
  const migration = page(workspace([row("one", { keySaved: false })], { migrationPending: true, readOnly: false }), locale);
  assert.ok(migration.includes('data-settings-attention="migration"') && migration.includes(esc(t("ws.connections.migrationPending"))));
  assert.equal((migration.match(new RegExp(t("ws.connections.migrationPending").slice(0, 12), "g")) ?? []).length, 1, "the migration notice is not repeated");
  assert.equal(page(workspace([row("one")]), locale).includes("wss-attention"), false, "no bar when nothing needs the user");
});

test("nav dot for connections uses the same conditions as the bars", () => {
  assert.equal(connectionsNeedAttention(undefined), false);
  assert.equal(connectionsNeedAttention({ connections: [row("one")] }), false);
  assert.equal(connectionsNeedAttention({ connections: [row("one", { keyState: "invalid" })] }), true);
  assert.equal(connectionsNeedAttention({ connections: [row("one", { credentialRequired: true })] }), true);
  assert.equal(connectionsNeedAttention({ connections: [row("one", { status: "deleted", cleanupPending: true })] }), true);
  assert.equal(connectionsNeedAttention({ migrationPending: true, connections: [] }), true);
  assert.equal(connectionsNeedAttention({ migrationPending: true, recovered: true, connections: [row("one", { keyState: "invalid" })] }), false, "read-only recovered store has nothing to act on");
  assert.deepEqual([...settingsAttentionPages({ updateAttention: false, connections: { connections: [row("one", { keyState: "invalid" })] } })], ["connections"]);
});

test("the add/edit form keeps one short key line; the long notes live under Advanced; legacy import opens itself when there is no connection", () => {
  for (const locale of ["zh-Hans", "en", "zh-Hant"]) {
    const t = makeT(locale), form = render(createElement(module.exports.WorkspaceConnectionForm, { model }), locale);
    assert.ok(form.includes(esc(t("ws.connections.keyNoteShort"))));
    assert.equal(form.includes(esc(t("ws.connections.keyNote"))) || form.includes(esc(t("ws.connections.scopeNote"))), false);
  }
  assert.match(panels, /<details className="wsd-legacy-import" open=\{active\.length === 0\}>/);
});
