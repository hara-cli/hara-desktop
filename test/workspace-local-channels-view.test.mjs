import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { makeT } from "../src/i18n.ts";
const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const bundled = await build({ stdin: { contents: 'export * from "./src/WorkspaceLocalChannels.tsx"; export {Transcript} from "./src/WorkspaceLocalDev.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, module, module.exports);
const { LocalChannelRows, LocalChannelDialog, LocalChannelThread, LocalChannelComposer, Transcript, channelTranscriptGroups, channelHistoryRows } = module.exports;
const { createElement: h } = require("react"), { renderToStaticMarkup: render } = require("react-dom/server");
const colleagues = Array.from({ length: 13 }, (_, index) => ({ agentId: `person-${index}`, kind: "colleague", state: "active", identity: { displayName: `Colleague ${index}` }, runtime: { id: "pi", label: "Pi", available: true } }));
const channel = { id: "room", name: "Local <script> discussion", memberIds: colleagues.map(row => row.agentId), createdAt: "2026-10-20T00:00:00Z" };
const view = { scope: "A", supported: true, catalog: { workspaceId: "A", resourceGeneration: "g-A", revision: 1, channels: [channel] }, channelId: "room", loading: false, saving: false, draft: "draft", pending: null, error: "", creationUnknown: false,
  channel: { workspaceId: "A", resourceGeneration: "g-A", channel, revision: 1, state: "completed", approvals: [], turns: [{ id: "turn", state: "completed", replies: [] }], messages: [
    { id: "user", turnId: "turn", agentId: null, displayName: "", message: { role: "user", content: "Discuss <script>this</script>" } },
    { id: "reply", turnId: "turn", agentId: "person-0", displayName: "Colleague 0", message: { role: "assistant", text: "First reply", tools: [] } },
    { id: "reply2", turnId: "turn", agentId: "person-1", displayName: "Colleague 1", message: { role: "assistant", text: "Second reply", tools: [] } },
  ] } };
test("real local channel controls expose all 13 members and complete English, Simplified and Traditional copy", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale), rows = render(h(LocalChannelRows, { view, t, search: "", selected: "room", onOpen() {} }));
    assert.ok(rows.includes(t("ws.channels.memberCount", { n: 13 }))); assert.ok(rows.includes('aria-current="page"')); assert.equal(rows.includes("<script>"), false);
    const dialog = render(h(LocalChannelDialog, { mode: "create", view, model: {}, colleagues, t, onClose() {}, onCreated() {} }));
    assert.equal((dialog.match(/type="checkbox"/g) ?? []).length, 13); assert.ok(dialog.includes(t("ws.channels.new"))); assert.equal(/10 \/|coming soon|即将推出|即將推出/.test(dialog), false);
    const invite = render(h(LocalChannelDialog, { mode: "invite", view, model: {}, colleagues, t, onClose() {}, onCreated() {} }));
    assert.ok(invite.includes(t("ws.channels.inviteBody"))); assert.equal(/type="email"|href=|type="submit"/.test(invite), false);
  }
});
test("one colleague uses singular English in the sidebar and the explicit recipient choice", () => {
  const t = makeT("en"), one = { ...view, catalog: { ...view.catalog, channels: [{ ...channel, memberIds: ["person-0"] }] } };
  assert.ok(render(h(LocalChannelRows, { view: one, t, search: "", selected: "room", onOpen() {} })).includes("You + 1 colleague"));
  const composer = render(h(LocalChannelComposer, { view: { ...view, recipientIds: ["person-0"] }, model: {}, colleagues, t, disconnected: false, hasConnection: true, configure() {} }));
  assert.ok(composer.includes("1 colleague replies")); assert.equal(composer.includes("1 colleagues"), false);
  const onlyMember = { ...view, channel: { ...view.channel, channel: { ...channel, memberIds: ["person-0"] } } };
  assert.ok(render(h(LocalChannelComposer, { view: onlyMember, model: {}, colleagues, t, disconnected: false, hasConnection: true, configure() {} })).includes("1 colleague replies"));
});
test("the reply summary gives the full selected count and empty channels can save a note without a model connection", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale), props = { model: {}, colleagues, t, disconnected: false, hasConnection: true, configure() {} };
    const all = render(h(LocalChannelComposer, { ...props, view }));
    assert.ok(all.includes(t("ws.channels.replyAll", { n: 13 })));
    assert.equal((all.match(/type="checkbox"/g) ?? []).length, 13);
    const empty = render(h(LocalChannelComposer, { ...props, hasConnection: false, view: { ...view, channel: { ...view.channel, channel: { ...channel, memberIds: [] } } } }));
    assert.ok(empty.includes(t("ws.channels.notesOnly"))); assert.equal(empty.includes(t("ws.connection.configure")), false);
    assert.ok(empty.includes(t("ws.channels.noRecipients"))); assert.equal(empty.includes(t("ws.channels.noColleagues")), false);
    assert.equal(/class="hs-send"[^>]*disabled/.test(empty), false);
  }
});
test("actual group transcript identifies each colleague, escapes content and preserves failed replies", () => {
  const t = makeT("zh-Hans");
  const html = render(h(LocalChannelThread, { view, colleagues, t, retry() {}, transcript: (history, agent) => h(Transcript, { history, agent, t }), approval() {} }));
  assert.ok(html.includes("Colleague 0")); assert.ok(html.includes("Colleague 1")); assert.equal((html.match(/hs-msg me/g) ?? []).length, 1);
  assert.ok(html.includes("Discuss &lt;script&gt;this&lt;/script&gt;")); assert.equal(html.includes("<script>"), false);
  const failed = { ...view, channel: { ...view.channel, state: "interrupted", turns: [{ id: "turn", state: "interrupted", replies: [{ agentId: "person-0", displayName: "Colleague 0", state: "failed" }] }] } };
  const error = render(h(LocalChannelThread, { view: failed, colleagues, t, retry() {}, transcript: (history, agent) => h(Transcript, { history, agent, t }), approval() {} }));
  assert.ok(error.includes(t("ws.channels.failedReply", { name: "Colleague 0" }))); assert.ok(error.includes(t("ws.channels.interrupted")));
});
test("unknown channel acceptance shows read-only verification and freezes sends while retaining the draft", () => {
  const t = makeT("en"), html = render(h(LocalChannelComposer, { view: { ...view, pending: { body: "draft", state: "unknown", requestId: "nonce", recipientIds: [] } }, model: {}, colleagues, t, disconnected: false, hasConnection: true, configure() {} }));
  assert.ok(html.includes("draft")); assert.ok(html.includes(t("ws.composer.verify"))); assert.equal(html.includes('aria-label="Send"'), false);
});

test("personal channel member controls and reply summary expose 142 colleagues without a quota or cloud sign-in", () => {
  const many = Array.from({ length: 142 }, (_, index) => ({ ...colleagues[0], agentId: `many-${index}`, identity: { displayName: `Member ${index}` } }));
  const room = { ...channel, memberIds: many.map(row => row.agentId) };
  const manyView = { ...view, catalog: { ...view.catalog, channels: [room] }, channel: { ...view.channel, channel: room }, recipientIds: room.memberIds };
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale);
    const html = render(h(LocalChannelDialog, { mode: "members", view: manyView, model: {}, colleagues: many, t, onClose() {}, onCreated() {} }));
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, 142);
    assert.equal((html.match(/type="checkbox" checked=""/g) ?? []).length, 142);
    assert.ok(html.includes(t("ws.channels.memberCount", { n: 142 })));
    const composer = render(h(LocalChannelComposer, { view: manyView, model: {}, colleagues: many, t, disconnected: false, hasConnection: true, configure() {} }));
    assert.ok(composer.includes(t("ws.channels.replyAll", { n: 142 })));
    assert.equal(/coming soon|即将推出|即將推出|type="email"|AI 同事/.test(html + composer), false);
    assert.ok(html.includes(t("ws.channels.localNote")));
  }
});

test("interleaved replies follow the accepted colleague order and duplicate row identities update in place", () => {
  const row = (id, agentId, text) => ({ id, agentId, turnId: "turn", displayName: agentId ?? "", message: agentId ? { role: "assistant", text, tools: [] } : { role: "user", content: text } });
  const snapshot = { ...view.channel, turns: [{ id: "turn", state: "completed", replies: ["person-0", "person-1", "person-2"].map(agentId => ({ agentId, displayName: agentId, state: "completed" })) }],
    messages: [row("b1", "person-1", "partial"), row("user", null, "One user turn"), row("a1", "person-0", "same text"), row("c1", "person-2", "Third"),
      row("a2", "person-0", "same text"), row("b1", "person-1", "Completed reply")] };
  const groups = channelTranscriptGroups(snapshot);
  assert.deepEqual(groups.map(group => group.agentId), [null, "person-0", "person-1", "person-2"]);
  assert.deepEqual(groups[1].history.map(message => message.text), ["same text", "same text"], "different row identities keep legitimate identical replies");
  assert.deepEqual(groups[2].history.map(message => message.text), ["Completed reply"]);
  const html = render(h(LocalChannelThread, { view: { ...view, channel: snapshot }, colleagues, t: makeT("en"), retry() {}, transcript: history => h("p", null, JSON.stringify(history)), approval() {} }));
  assert.deepEqual([...html.matchAll(/data-channel-speaker="([^"]+)"/g)].map(match => match[1]), ["user", "person-0", "person-1", "person-2"]);
});

test("out-of-order turns and duplicate deliveries retain all 142 colleagues per accepted turn", () => {
  const count = 142, turns = Array.from({ length: 30 }, (_, index) => ({ id: `turn-${index}`, state: "completed", replies: Array.from({ length: count }, (_, member) => ({ agentId: `member-${member}`, displayName: `Member ${member}`, state: "completed" })) }));
  const messages = turns.toReversed().flatMap(turn => [{ id: turn.id, turnId: turn.id, agentId: null, displayName: "", message: { role: "user", content: turn.id } },
    ...turn.replies.toReversed().map(reply => ({ id: `${turn.id}:${reply.agentId}`, turnId: turn.id, agentId: reply.agentId, displayName: reply.displayName, message: { role: "assistant", text: "Reply", tools: [] } }))]);
  const snapshot = { ...view.channel, turns, messages: [...messages, ...messages] }, groups = channelTranscriptGroups(snapshot);
  assert.equal(groups.length, 30 * 143);
  for (let index = 0; index < turns.length; index++) {
    const group = groups.slice(index * 143, (index + 1) * 143);
    assert.ok(group.every(row => row.turnId === `turn-${index}`));
    assert.deepEqual(group.map(row => row.agentId), [null, ...turns[index].replies.map(row => row.agentId)]);
    assert.ok(group.every(row => row.history.length === 1));
  }
});

test("a 142-colleague long discussion mounts only 100 history records and preserves all projection identities", () => {
  const turns = Array.from({ length: 100 }, (_, index) => ({ id: `turn-${index}`, state: "completed", replies: [] }));
  const messages = turns.flatMap(turn => Array.from({ length: 142 }, (_, index) => ({ id: `${turn.id}:${index}`, turnId: turn.id, agentId: `member-${index}`, displayName: `同事 ${index}`, message: { role: "assistant", text: `${turn.id}:${index}`, tools: [] } })));
  const snapshot = { ...view.channel, turns, messages }, projection = channelHistoryRows(snapshot);
  assert.equal(projection.length, 14200);
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale), props = { view: { ...view, channel: snapshot }, colleagues, t, retry() {}, transcript: history => h("p", null, history[0].text), approval() {} };
    const latest = render(h(LocalChannelThread, props));
    assert.equal((latest.match(/data-channel-speaker=/g) ?? []).length, 100);
    assert.ok(latest.includes("turn-99:141")); assert.equal(latest.includes("turn-0:0<"), false);
    assert.ok(latest.includes(t("ws.channels.history.older"))); assert.ok(latest.includes(t("ws.channels.history.range", { from: 14101, to: 14200, total: 14200 })));
    const earlier = render(h(LocalChannelThread, { ...props, view: { ...props.view, historyAnchor: projection[99].id } }));
    assert.ok(earlier.includes("turn-0:0")); assert.ok(earlier.includes(t("ws.channels.history.newer"))); assert.ok(earlier.includes(t("ws.channels.history.latest")));
  }
});

test("history windows retain failed reply records and keep live approval authority outside paging", () => {
  const replies = Array.from({ length: 142 }, (_, index) => ({ agentId: `member-${index}`, displayName: `同事 ${index}`, state: "failed" }));
  const snapshot = { ...view.channel, messages: [], turns: [{ id: "failed-turn", state: "interrupted", replies }], approvals: [{ id: "live-approval" }] };
  const projected = channelHistoryRows(snapshot); assert.equal(projected.length, 142); assert.equal(projected[0].failedName, "同事 0");
  for (const historyAnchor of [null, projected[41].id]) {
    const html = render(h(LocalChannelThread, { view: { ...view, channel: snapshot, historyAnchor }, colleagues, t: makeT("zh-Hans"), retry() {}, transcript() {}, approval: card => h("button", { "data-live-approval": card.id }, "核对") }));
    assert.equal((html.match(/data-live-approval=/g) ?? []).length, 1);
    assert.ok(html.includes(historyAnchor ? "同事 0" : "同事 141"));
  }
});
