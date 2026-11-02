import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { WorkspaceLocalChannelsModel } from "../src/workspace-local-channels.ts";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { makeT } from "../src/i18n.ts";

const first = `ag_${randomUUID()}`, second = `ag_${randomUUID()}`, third = `ag_${randomUUID()}`;
const people = [first, second, third].map((agentId, index) => ({ agentId, kind: "colleague", state: "active", identity: { displayName: `Colleague ${index}` }, runtime: { id: "pi", label: "Pi", available: true } }));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const passed = agentId => ({ agentId, displayName: people.find(person => person.agentId === agentId).identity.displayName, state: "passed", passedBy: "prefilter", passReason: "role_unrelated" });
function fixture({ pass = true, queue = true, fields = true } = {}) {
  const calls = [], handlers = new Map(), snapshots = new Map(); let sequence = 0;
  const get = (workspaceId = "A", generation = "g-A", channelId = "room") => {
    const key = JSON.stringify([workspaceId, generation, channelId]);
    if (!snapshots.has(key)) snapshots.set(key, { workspaceId, resourceGeneration: generation, revision: 1, state: "completed",
      channel: { id: channelId, name: channelId, memberIds: [first, second, third], createdAt: "2026-11-03T00:00:00Z" },
      messages: [{ id: "user", turnId: "original", agentId: null, displayName: "", createdAt: "2026-11-03T00:00:00Z", message: { role: "user", content: `Earlier question @${second} @Colleague 2` } }],
      turns: [{ id: "original", state: "completed", replies: [passed(first), passed(second)] }], approvals: [], ...(fields ? { pendingCount: 0, queueNeedsResume: false } : {}) });
    return snapshots.get(key);
  };
  const model = new WorkspaceLocalChannelsModel({ supportsLocalChannels: () => true, supportsLocalChannelPass: () => pass, supportsLocalChannelQueue: () => queue,
    async localChannelRequest(method, params) {
      calls.push({ method, params: structuredClone(params) });
      if (handlers.has(method)) return handlers.get(method)(params);
      const snapshot = get(params.workspaceId, params.expectedGeneration, params.channelId);
      if (method === "workspace.channels.list") return { workspaceId: params.workspaceId, resourceGeneration: params.expectedGeneration, revision: 1, channels: ["room", "other"].map(id => get(params.workspaceId, params.expectedGeneration, id).channel) };
      if (["workspace.channels.select", "workspace.channels.snapshot"].includes(method)) return structuredClone(snapshot);
      if (method === "workspace.channels.send") {
        const queued = queue && fields && (["running", "draining"].includes(snapshot.state) || snapshot.pendingCount > 0);
        snapshot.turns.push({ id: params.requestId, state: queued ? "queued" : "running", replies: params.recipientIds.map(agentId => ({ agentId, displayName: agentId, state: "queued" })) });
        snapshot.messages.push({ id: `user-${params.requestId}`, turnId: params.requestId, agentId: null, displayName: "", message: { role: "user", content: params.message } });
        if (queued) snapshot.pendingCount++;
        snapshot.revision++;
        return { workspaceId: params.workspaceId, resourceGeneration: params.expectedGeneration, channelId: params.channelId, requestId: params.requestId, accepted: true, ...(queue && fields ? { queued, position: queued ? snapshot.pendingCount : 0 } : {}) };
      }
      if (method === "workspace.channels.cancel") { snapshot.state = "cancelled"; snapshot.queueNeedsResume = snapshot.pendingCount > 0; snapshot.revision++; return { state: "draining" }; }
      if (method === "workspace.channels.resumeQueue") { snapshot.queueNeedsResume = false; snapshot.state = "running"; snapshot.revision++; return structuredClone(snapshot); }
      if (method === "workspace.channels.clearQueue") { snapshot.pendingCount = 0; snapshot.queueNeedsResume = false; snapshot.turns = snapshot.turns.filter(turn => turn.state !== "queued"); snapshot.revision++; return structuredClone(snapshot); }
      throw new Error(`Unexpected fixture method ${method}`);
    } }, () => `request-${++sequence}`, null);
  return { model, calls, handlers, get, async open(workspaceId = "A", generation = "g-A", channelId = "room") { await model.bind(workspaceId, generation); await model.select(channelId); }, guard() { const view = model.getSnapshot(); return { scope: view.scope, channelId: view.channelId, historyAnchor: view.historyAnchor }; } };
}
function queued(f, count = 2) {
  const snapshot = f.get(); snapshot.pendingCount = count; snapshot.queueNeedsResume = true;
  for (let index = 0; index < count; index++) snapshot.turns.push({ id: `queued-${index}`, state: "queued", replies: [] });
  return snapshot;
}
const sends = f => f.calls.filter(call => call.method === "workspace.channels.send");

test("pass and queue capabilities remain independent and missing snapshot fields keep old busy behavior", async () => {
  const rpc = capabilities => ({ supportsCapability: name => capabilities.includes(name) });
  const old = new WorkspaceDevModel(rpc(["workspace.local-channels.v1"]));
  assert.equal(old.supportsLocalChannelPass(), false); assert.equal(old.supportsLocalChannelQueue(), false);
  const modern = new WorkspaceDevModel(rpc(["workspace.channel-pass.v1", "workspace.channel-queue.v1"]));
  assert.equal(modern.supportsLocalChannelPass(), true); assert.equal(modern.supportsLocalChannelQueue(), true);
  for (const settings of [{ pass: false, queue: false }, { fields: false }]) {
    const f = fixture(settings); f.get().state = "running"; await f.open(); f.model.setDraft("draft");
    await f.model.send([first]); await f.model.resumeQueue(); await f.model.clearQueue();
    assert.equal(sends(f).length, 0); assert.equal(f.model.getSnapshot().draft, "draft");
    assert.equal(f.calls.some(call => /resumeQueue|clearQueue/.test(call.method)), false);
    f.get().state = "completed"; f.get().revision++; await f.model.refresh(); await f.model.send([first]);
    assert.equal(sends(f).length, 1, "legacy idle send still works without a queue receipt");
  }
});

test("snapshot extension accepts only the closed pass reason and bounded queue metadata", async () => {
  for (const invalid of [snapshot => { snapshot.pendingCount = 6; }, snapshot => { snapshot.queueNeedsResume = "yes"; }, snapshot => { snapshot.turns[0].replies[0].passReason = "raw untrusted reason"; }, snapshot => { snapshot.turns[0].replies[0].passedBy = "model"; }]) {
    const f = fixture(); invalid(f.get()); await f.open(); assert.equal(f.model.getSnapshot().channel, null); assert.equal(f.model.getSnapshot().error, "ws.channels.loadFailed");
  }
  const f = fixture(); await f.open(); assert.equal(f.model.getSnapshot().channel.turns[0].replies[0].passReason, "role_unrelated");
});

test("explicit passed reply is a new single-recipient user turn, quotes cannot widen mentions, and the draft survives", async () => {
  const f = fixture(); await f.open(); const original = structuredClone(f.model.getSnapshot().channel.turns[0]);
  f.model.setDraft("unfinished user draft"); await f.model.speakPassed("original", first, makeT("en")("ws.channels.passAsk"), f.guard());
  assert.equal(sends(f).length, 1); const sent = sends(f)[0].params;
  assert.deepEqual(sent.recipientIds, [first]); assert.equal(sent.message.startsWith(`@${first} `), true);
  assert.equal((sent.message.match(/@/g) ?? []).length, 1); assert.ok(sent.message.includes(`＠${second}`));
  assert.equal(sent.requestId, "request-1"); assert.equal(sent.workspaceId, "A"); assert.equal(sent.expectedGeneration, "g-A");
  assert.equal(f.model.getSnapshot().draft, "unfinished user draft"); assert.deepEqual(f.get().turns[0], original);
  assert.equal(f.get().turns.length, 2); assert.equal(f.get().messages.at(-1).message.role, "user");
});

test("explicit passed reply truncates the quotation, requires a visible matching passed turn, and rejects stale scope/channel/page", async () => {
  const f = fixture(); f.get().messages[0].message.content = `@${third} ${"x".repeat(4500)}`; await f.open();
  const guard = f.guard(); f.model.setDraft("keep");
  for (const wrong of [{ ...guard, scope: '["B","g-B"]' }, { ...guard, scope: '["A","new-generation"]' }, { ...guard, channelId: "other" }, { ...guard, historyAnchor: "older-page" }]) await f.model.speakPassed("original", first, "Please reply:", wrong);
  await f.model.speakPassed("missing", first, "Please reply:", guard); await f.model.speakPassed("original", third, "Please reply:", guard);
  assert.equal(sends(f).length, 0);
  await f.model.speakPassed("original", first, "Please reply:", guard); assert.equal(sends(f)[0].params.message.length, 4000); assert.ok(sends(f)[0].params.message.endsWith("…"));
  assert.equal(f.model.getSnapshot().draft, "keep");
});

test("unknown passed-reply acceptance keeps its original nonce and only verifies a receipt without resending", async () => {
  const f = fixture(); await f.open(); f.model.setDraft("keep this draft");
  f.handlers.set("workspace.channels.send", () => { throw new Error("lost acknowledgement"); });
  await f.model.speakPassed("original", first, "Please reply:", f.guard());
  const pending = f.model.getSnapshot().pending; assert.equal(pending.state, "unknown");
  await f.model.speakPassed("original", second, "Please reply:", f.guard()); await f.model.send([third]); assert.equal(sends(f).length, 1);
  f.handlers.set("workspace.channels.receipt", params => ({ workspaceId: params.workspaceId, resourceGeneration: params.expectedGeneration, channelId: params.channelId, requestId: params.requestId, state: "accepted" }));
  await f.model.verifyPending(); assert.equal(f.model.getSnapshot().pending, null); assert.equal(f.model.getSnapshot().draft, "keep this draft");
  assert.equal(sends(f).length, 1); assert.equal(f.calls.find(call => call.method.endsWith(".receipt")).params.requestId, pending.requestId);
});

test("an accepted busy send stays latched until its receipt, then shows its durable queue position", async () => {
  const f = fixture(); f.get().state = "running"; await f.open(); f.model.setDraft("queued message");
  const wait = deferred(); f.handlers.set("workspace.channels.send", () => wait.promise);
  const sending = f.model.send([first]); assert.equal(f.model.getSnapshot().pending.state, "sending");
  f.model.setRecipients([second]); await f.model.send([second]); assert.equal(sends(f).length, 1); assert.deepEqual(f.model.getSnapshot().recipientIds, [first, second, third]);
  const sent = sends(f)[0].params, snapshot = f.get(); snapshot.pendingCount = 1; snapshot.revision++;
  snapshot.turns.push({ id: sent.requestId, state: "queued", replies: [] });
  wait.resolve({ workspaceId: "A", resourceGeneration: "g-A", channelId: "room", requestId: sent.requestId, accepted: true, queued: true, position: 1 }); await sending;
  assert.equal(f.model.getSnapshot().pending, null); assert.equal(f.model.getSnapshot().queuedPosition, 1); assert.equal(f.model.getSnapshot().channel.pendingCount, 1); assert.equal(f.model.getSnapshot().draft, "");
  f.model.setRecipients([second]); assert.deepEqual(f.model.getSnapshot().recipientIds, [second]);
});

test("a full queue refuses another send locally and malformed queue receipts stay unknown", async () => {
  const full = fixture(); queued(full, 5); full.get().state = "running"; await full.open(); full.model.setDraft("not accepted"); await full.model.send([first]);
  assert.equal(sends(full).length, 0); assert.equal(full.model.getSnapshot().error, "ws.channels.queueFull"); assert.equal(full.model.getSnapshot().draft, "not accepted");
  for (const receipt of [{}, { position: 1 }, { queued: true, position: 6 }, { queued: true }, { queued: false, position: 2 }, { queued: "true", position: 1 }]) {
    const f = fixture(); f.get().state = "running"; await f.open(); f.model.setDraft("retained");
    f.handlers.set("workspace.channels.send", params => ({ workspaceId: "A", resourceGeneration: "g-A", channelId: "room", requestId: params.requestId, accepted: true, ...receipt }));
    await f.model.send([first]); assert.equal(f.model.getSnapshot().pending.state, "unknown"); assert.equal(f.model.getSnapshot().draft, "retained");
  }
});

test("cancel preserves the waiting queue, manual resume uses its own RPC, and clear never calls cancel", async () => {
  const f = fixture(); queued(f); f.get().state = "running"; f.get().queueNeedsResume = false; await f.open();
  await f.model.resumeQueue(); assert.equal(f.calls.some(call => call.method.endsWith(".resumeQueue")), false);
  await f.model.cancel(); assert.equal(f.model.getSnapshot().channel.pendingCount, 2); assert.equal(f.model.getSnapshot().channel.queueNeedsResume, true);
  await f.model.resumeQueue(); assert.equal(f.model.getSnapshot().channel.state, "running"); assert.equal(f.model.getSnapshot().channel.queueNeedsResume, false);
  await f.model.clearQueue(); assert.equal(f.model.getSnapshot().channel.pendingCount, 0); assert.equal(f.model.getSnapshot().channel.state, "running");
  assert.equal(f.calls.filter(call => call.method.endsWith(".cancel")).length, 1);
  for (const method of ["workspace.channels.resumeQueue", "workspace.channels.clearQueue"]) {
    const call = f.calls.find(row => row.method === method); assert.deepEqual(call.params, { workspaceId: "A", expectedGeneration: "g-A", channelId: "room" });
  }
});

test("unknown queue actions lock new mutations and verify only a snapshot; refresh never auto-resumes", async () => {
  const f = fixture(); queued(f); await f.open();
  f.handlers.set("workspace.channels.resumeQueue", () => { throw new Error("connection lost"); });
  await f.model.resumeQueue(); assert.equal(f.model.getSnapshot().queueUnknown, true); f.model.setDraft("keep");
  await f.model.resumeQueue(); await f.model.clearQueue(); await f.model.send([first]); await f.model.refresh();
  assert.equal(f.calls.filter(call => /resumeQueue|clearQueue/.test(call.method)).length, 1); assert.equal(sends(f).length, 0); assert.equal(f.model.getSnapshot().queueUnknown, true);
  const before = f.calls.filter(call => call.method.endsWith(".snapshot")).length; await f.model.verifyQueue();
  assert.equal(f.calls.filter(call => call.method.endsWith(".snapshot")).length, before + 1); assert.equal(f.model.getSnapshot().queueUnknown, false);
  assert.equal(f.model.getSnapshot().channel.queueNeedsResume, true); assert.equal(f.model.getSnapshot().draft, "keep");
});

test("late queue-action snapshots cannot overwrite a different channel, Workspace, generation, or A→B→A revision", async () => {
  for (const selection of ["channel", "workspace", "generation", "roundtrip"]) {
    const f = fixture(); queued(f); await f.open(); const wait = deferred(); f.handlers.set("workspace.channels.clearQueue", () => wait.promise);
    const action = f.model.clearQueue(), late = { ...structuredClone(f.get()), revision: 50, pendingCount: 0, queueNeedsResume: false };
    if (selection === "channel") await f.model.select("other");
    if (selection === "workspace") await f.open("B", "g-B");
    if (selection === "generation") await f.open("A", "new-generation");
    if (selection === "roundtrip") { await f.open("B", "g-B"); await f.open(); }
    const current = structuredClone(f.model.getSnapshot().channel); wait.resolve(late); await action;
    assert.deepEqual(f.model.getSnapshot().channel, current, selection);
  }
});

const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const bundled = await build({ stdin: { contents: 'export {LocalChannelThread,LocalChannelComposer,channelHistoryRows,channelTranscriptGroups} from "./src/WorkspaceLocalChannels.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const compiled = { exports: {} }; new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, compiled, compiled.exports);
const { LocalChannelThread, LocalChannelComposer, channelHistoryRows, channelTranscriptGroups } = compiled.exports;
const { createElement: h } = require("react"), { renderToStaticMarkup: render } = require("react-dom/server");
const uiModel = { supportsPass: () => true, supportsQueue: () => true, speakPassed() {}, setHistoryAnchor() {} };
const submitTag = html => html.match(/<button[^>]*data-channel-submit="(?:send|queue)"[^>]*>/)?.[0] ?? "";
function thread(view, t, extra = {}) { return render(h(LocalChannelThread, { view, colleagues: people, t, model: uiModel, retry() {}, transcript: history => h("p", null, history.map(message => message.content ?? message.text).join(" ")), approval() {}, ...extra })); }
function composer(view, t, extra = {}) { return render(h(LocalChannelComposer, { view, colleagues: people, t, model: uiModel, disconnected: false, hasConnection: true, configure() {}, ...extra })); }

test("passed colleagues are one collapsed status per turn with translated reason and no assistant bubble or raw reason", async () => {
  const f = fixture(); await f.open(); const view = structuredClone(f.model.getSnapshot());
  view.channel.messages.push({ id: "phantom", turnId: "original", agentId: first, displayName: "Colleague 0", message: { role: "assistant", text: "MUST NEVER RENDER", tools: [] } });
  assert.equal(channelTranscriptGroups(view.channel).some(group => group.agentId === first), false); assert.equal(channelHistoryRows(view.channel).filter(row => row.passed).length, 1);
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale), html = thread(view, t);
    assert.ok(html.includes(t("ws.channels.passed", { n: 2 }))); assert.ok(html.includes(t("ws.channels.passReason.role_unrelated")));
    assert.equal((html.match(/class="hs-channel-passed"/g) ?? []).length, 1); assert.equal(/<details[^>]*\bopen/.test(html), false);
    assert.equal((html.match(/Ask Colleague \d to reply|请 Colleague \d 也说一句|請 Colleague \d 也說一句/g) ?? []).length, 2);
    assert.equal(/MUST NEVER RENDER|prefilter|role_unrelated/.test(html), false);
  }
  assert.equal(thread(view, makeT("en"), { model: { ...uiModel, supportsPass: () => false } }).includes("Ask them to reply"), false);
});

test("busy queue UI permits enqueue and recipient edits alongside Stop, while in-flight/unknown/scope locks remain", async () => {
  const f = fixture(); f.get().state = "running"; await f.open(); f.model.setDraft("next question"); const view = f.model.getSnapshot(), t = makeT("en");
  const busy = composer(view, t); assert.ok(submitTag(busy).includes('data-channel-submit="queue"')); assert.equal(submitTag(busy).includes("disabled"), false);
  assert.ok(busy.includes(t("ws.composer.stop"))); assert.equal(/<fieldset[^>]*disabled/.test(busy), false);
  for (const locked of [{ saving: true }, { pending: { state: "sending" } }, { queueAction: "clear" }, { queueUnknown: true }]) assert.ok(submitTag(composer({ ...view, ...locked }, t)).includes("disabled"));
  const unknown = composer({ ...view, pending: { state: "unknown" } }, t); assert.equal(submitTag(unknown), ""); assert.ok(unknown.includes(t("ws.composer.verify")));
  assert.ok(submitTag(composer(view, t, { disconnected: true })).includes("disabled"));
  const answering = { ...view, channel: { ...view.channel, questions: [{ agentId: first, conversation: { pendingQuestion: { id: "question" } } }] } };
  assert.ok(submitTag(composer(answering, t)).includes("disabled"), "an answer must not masquerade as an ordinary queued message");
  await f.model.send([first], { questionId: "question", body: "answer" }); assert.equal(sends(f).length, 0);
  for (const model of [{ ...uiModel, supportsQueue: () => false }, uiModel]) {
    const legacy = composer({ ...view, channel: { ...view.channel, pendingCount: undefined, queueNeedsResume: undefined } }, t, { model });
    assert.equal(submitTag(legacy), ""); assert.equal(legacy.includes("Resume queue"), false);
  }
});

test("saved queues expose manual resume, position/count, and distinct Stop versus clear semantics in all locales", async () => {
  const f = fixture(); queued(f); await f.open(); f.model.setDraft("next"); const view = { ...f.model.getSnapshot(), queuedPosition: 2 };
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale), html = composer(view, t);
    for (const key of ["queueHeld", "queueResume", "queueClear", "queueClearHint", "queueActionsHint"]) assert.ok(html.includes(t(`ws.channels.${key}`)), key);
    assert.ok(html.includes(t("ws.channels.queueCount", { n: 2 }))); assert.ok(html.includes(t("ws.channels.turnQueued", { n: 2 })));
    const rows = thread(view, t); assert.equal((rows.match(/data-channel-queued=/g) ?? []).length, 2);
    const unknown = composer({ ...view, queueUnknown: true }, t); assert.ok(unknown.includes(t("ws.channels.queueVerify"))); assert.equal(unknown.includes(`>${t("ws.channels.queueResume")}<`), false);
    const full = composer({ ...view, channel: { ...view.channel, pendingCount: 5 } }, t); assert.ok(full.includes(t("ws.channels.queueFull"))); assert.ok(submitTag(full).includes("disabled"));
    const stopped = thread({ ...view, channel: { ...view.channel, state: "cancelled" } }, t); assert.ok(stopped.includes(t("ws.channels.currentStopped")));
  }
});
