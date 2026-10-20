import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { makeT } from "../src/i18n.ts";
const require = createRequire(import.meta.url), root = new URL("../", import.meta.url).pathname;
const bundled = await build({ stdin: { contents: 'export * from "./src/WorkspaceLocalChannels.tsx"; export {Transcript} from "./src/WorkspaceLocalDev.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, module, module.exports);
const { LocalChannelRows, LocalChannelDialog, LocalChannelThread, LocalChannelComposer, Transcript } = module.exports;
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
