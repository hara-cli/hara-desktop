import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { rosterConversationActivity, rosterGroupMembers, rosterShortRole, rosterTooltipText } from "../src/workspace-roster.ts";

import { agentAvatarAccent, agentVisualTokens } from "../src/agent-visual.ts";
import { redesignText } from "../src/desktop-redesign-copy.ts";

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

test("imported dark or malformed avatar colours fall back to this colleague's stable palette colour", () => {
  for (const id of ["fixture-a", "fixture-b"]) {
    const fallback = agentVisualTokens(id).accent;
    for (const value of [undefined, null, 42, "invalid", "#333333", "#000000", "#ffffff", "#438db3; color: red"]) assert.equal(agentAvatarAccent(id, { accent: value }), fallback);
    assert.equal(agentAvatarAccent(id, { accent: "#438DB3" }), "#438db3");
  }
});
test("full titles get a tooltip only when omitted; groups and main Hara only need one for a truncated name", () => {
  const short = { kind: "colleague", name: "Mia", role: "Designer" };
  assert.equal(rosterTooltipText(short, false), null);
  assert.equal(rosterTooltipText(short, true), "Mia");
  const long = { ...short, role: "Responsible for synthetic visual checks", shortRole: "Reviewer" };
  assert.equal(rosterTooltipText(long, false), long.role);
  assert.equal(rosterTooltipText(long, true), `Mia · ${long.role}`);
  assert.equal(rosterTooltipText({ ...long, kind: "group", role: "6 members" }, false), null);
  assert.equal(rosterTooltipText({ ...long, kind: "group", role: "6 members" }, true), "Mia");
  assert.equal(rosterTooltipText(long, false, true), null);
  assert.equal(rosterTooltipText(long, true, true), "Mia");
});
test("English single-item markers use singular wording and Traditional Chinese SSR stays localized", () => {
  assert.equal(redesignText("en", "needsYouCount", { n: 1 }), "1 item needs your attention");
  assert.equal(redesignText("en", "mutedUnread", { n: 1 }), "Muted · 1 unread message");
  assert.equal(redesignText("en", "unreadCount", { n: 1 }), "1 unread message");
  assert.match(render({ locale: "zh-Hant" }), /尚無訊息/u);
});
test("main selection, uploaded avatars and preview descriptions remain accessible independently of the visual tooltip", () => {
  const main = { ...agent, agentId: "main", kind: "main", identity: { displayName: "Hara" } };
  const html = render({ main, mainActive: true });
  const mainRow = html.match(/data-roster-id="main"[\s\S]*?<\/button>/u)?.[0] ?? "";
  assert.match(mainRow, /aria-current="page"/u);
  assert.match(mainRow, /aria-describedby=/u);
  assert.match(html, /role="group" aria-label="Conversation shortcuts"/u);
  const uploaded = render({ entries: [{ ...entry, agent: { ...agent, identity: { ...agent.identity, avatar: "/avatars/synthetic.png" } } }] });
  assert.ok(/<img src="\/avatars\/synthetic.png" alt=""[^>]*\/>/u.test(uploaded), "Stored avatars remain decorative images when safe rendering attributes are added");
  assert.match(uploaded, /class="hd-visually-hidden">No messages yet/u);
});

test("character-only identities keep the same palette colour in private rows, group tiles and portraits", () => {
  for (let index = 0; index < 50; index++) {
    const id = `salted-${index}`, identity = { displayName: "Synthetic specialist", character: "specialist" };
    const expected = agentVisualTokens(id, identity).accent;
    const html = render({ entries: [
      { ...entry, id, name: identity.displayName, agent: { ...agent, agentId: id, identity } },
      { ...entry, id: `channel:${index}`, kind: "group", agent: undefined, members: [{ id, accent: expected }] },
    ] });
    assert.equal((html.match(new RegExp(`background:${expected}`, "gu")) ?? []).length, 2, id);
  }
});
