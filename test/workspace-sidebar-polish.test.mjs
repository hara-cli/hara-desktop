import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { rosterConversationActivity, rosterGroupMembers, rosterShortRole } from "../src/workspace-roster.ts";

const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [fileURLToPath(new URL("../src/WorkspaceSidebarC.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react-dom"],
  loader: { ".css": "empty", ".svg": "empty", ".png": "empty", ".webp": "empty" }, write: false, logLevel: "silent" });
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const noop = () => {};
const agent = { agentId: "synthetic-a", kind: "colleague", state: "active", identity: { displayName: "林安", title: "Responsible for synthetic visual checks", accent: "#438db3" }, runtime: { id: "pi", available: true, label: "Pi" } };
const entry = { id: agent.agentId, kind: "colleague", name: agent.identity.displayName, role: agent.identity.title, preview: "", order: 0, unread: 3, needsYou: 2, agent };
const render = (patch = {}) => renderToStaticMarkup(createElement(module.exports.WorkspaceSidebarC, {
  locale: "en", workspaceId: "fixture", workspaceName: "Fixture", directory: null, mainPreview: "", mainActive: false, selectedId: entry.id,
  entries: [entry], preferences: {}, search: "", needsYou: 2, count: 1, disconnected: false, loading: false, inert: false, menuOpen: false,
  userLabel: "Fixture", settingsLabel: "Settings", onSearch: noop, onSelect: noop, onContextMenu: noop, onPreference: noop,
  onNeedsYou: noop, onColleagues: noop, onWorkspace: noop, onDiscuss: noop, onSettings: noop, onAccount: noop, ...patch }));

test("roles stay whole: explicit short title wins, otherwise only titles of at most 12 Unicode characters fit", () => {
  assert.equal(rosterShortRole("Operations"), "Operations");
  assert.equal(rosterShortRole("Responsible for visual checks"), "");
  assert.equal(rosterShortRole("Responsible for visual checks", "Reviewer"), "Reviewer");
  assert.equal(rosterShortRole("", "一二三四五六七八九十一二"), "一二三四五六七八九十一二");
  assert.equal(rosterShortRole("", "一二三四五六七八九十一二三"), "");
});

test("tool activity, empty tool prose and internal reminders cannot change message preview, order fingerprint or timestamp", () => {
  const first = { role: "assistant", text: "Visible synthetic receipt", tools: [], createdAt: "2026-11-10T04:00:00Z" };
  const before = rosterConversationActivity([first]);
  const after = rosterConversationActivity([first,
    { role: "assistant", text: "   ", tools: ["background"], createdAt: "2026-11-10T05:00:00Z" },
    { role: "tool", results: [{ id: "background", name: "shell", content: "PRIVATE TOOL", isError: false }] },
    { role: "user", content: "<system-reminder>PRIVATE REMINDER</system-reminder>", createdAt: "2026-11-10T06:00:00Z" }]);
  assert.deepEqual(after, before);
  const human = rosterConversationActivity([first, { role: "user", content: "[HARA_DESKTOP_ACTIVE_WORK_OBJECT fixture]\n\nVisible request", createdAt: "2026-11-10T07:00:00Z" }]);
  assert.equal(human.preview, "Visible request"); assert.notEqual(human.fingerprint, before.fingerprint);
  assert.equal(human.timestamp, "2026-11-10T07:00:00Z");
});

test("empty conversations never use responsibilities as preview; full title remains available to assistive technology", () => {
  const html = render();
  assert.match(html, /class="hd-row-preview is-empty">No messages yet<\/span>/u);
  assert.match(html, /aria-label="林安, Responsible for synthetic visual checks, 3 unread messages, 2 items need your attention"/u);
  assert.doesNotMatch(html, /hd-row-preview[^>]*>Responsible/u);
  assert.match(html, /background:#438db3/u); assert.match(html, />林<\/span>/u);
  assert.match(render({ entries: [{ ...entry, shortRole: "Reviewer", preview: "Latest receipt" }] }), /hd-row-role">· Reviewer<\/span>/u);
});

test("selection, unread and attention coexist; reading and completing an action remove only their own marker", () => {
  const selected = render();
  assert.match(selected, /aria-current="page"/u); assert.match(selected, /class="hd-unread" aria-label="3 unread messages"/u);
  assert.match(selected, /class="hd-row-needs-you"/u);
  const read = render({ entries: [{ ...entry, unread: 0 }] });
  assert.doesNotMatch(read, /aria-label="3 unread messages"/u); assert.match(read, /class="hd-row-needs-you"/u);
  const settled = render({ entries: [{ ...entry, needsYou: 0 }], needsYou: 0 });
  assert.match(settled, /class="hd-unread"/u); assert.doesNotMatch(settled, /class="hd-row-needs-you"/u);
  const muted = render({ preferences: { [entry.id]: { muted: true } } });
  assert.match(muted, /class="hd-unread-dot" aria-label="Muted · 3 unread messages"/u); assert.match(muted, /class="hd-row-needs-you"/u);
});

test("composite group avatars retain stable member colours and order recent speakers first without duplicating them", () => {
  const members = Array.from({ length: 6 }, (_, i) => ({ id: `member-${i}`, accent: i % 2 ? "#438db3" : "#d99a32" }));
  const ordered = rosterGroupMembers(members, ["member-4", "member-4", "member-2", "not-in-group"]);
  assert.deepEqual(ordered.map(row => row.id), ["member-4", "member-2", "member-0", "member-1", "member-3", "member-5"]);
  assert.deepEqual(members.map(row => row.id), ["member-0", "member-1", "member-2", "member-3", "member-4", "member-5"]);
  for (const n of [2, 3, 4, 6]) {
    const html = render({ entries: [{ ...entry, id: "channel:fixture", kind: "group", agent: undefined, role: `${n} members`, members: members.slice(0, n) }] });
    assert.match(html, new RegExp(`data-members="${Math.min(n, 4)}"`, "u"));
    assert.equal((html.match(/<i style="background:/gu) ?? []).length, Math.min(n, n > 4 ? 3 : 4));
    if (n > 4) assert.match(html, /<b>\+3<\/b>/u);
  }
});
