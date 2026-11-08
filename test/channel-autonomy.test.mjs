import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { WorkspaceLocalChannelsModel } from "../src/workspace-local-channels.ts";
import { makeT } from "../src/i18n.ts";

const first = `ag_${randomUUID()}`, second = `ag_${randomUUID()}`;
const people = [first, second].map((agentId, index) => ({ agentId, kind: "colleague", state: "active", identity: { displayName: `Colleague ${index}` }, runtime: { id: "pi", label: "Pi", available: true } }));
const metadata = () => ({ schemaVersion: 1, mode: "mention", mutedAgentIds: [], cooldownMs: 600000 });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture({ capability = true, fields = true } = {}) {
  const calls = [], handlers = new Map(), catalogs = new Map(), snapshots = new Map();
  const scopeKey = (workspaceId, generation) => JSON.stringify([workspaceId, generation]);
  const catalog = (workspaceId = "A", generation = "g-A") => {
    const key = scopeKey(workspaceId, generation);
    if (!catalogs.has(key)) catalogs.set(key, { workspaceId, resourceGeneration: generation, revision: 7, channels: ["room", "other"].map(id => ({ id, name: `Group ${id}`, memberIds: [first, second], createdAt: "2026-11-03T00:00:00Z", ...(fields ? { autonomy: metadata() } : {}) })) });
    return catalogs.get(key);
  };
  const snapshot = (workspaceId = "A", generation = "g-A", channelId = "room") => {
    const key = JSON.stringify([workspaceId, generation, channelId]);
    if (!snapshots.has(key)) snapshots.set(key, { workspaceId, resourceGeneration: generation, channel: catalog(workspaceId, generation).channels.find(row => row.id === channelId), revision: 91, state: "completed", pendingCount: 0, queueNeedsResume: false,
      messages: [{ id: "user", turnId: "user-root", agentId: null, displayName: "", message: { role: "user", content: "Earlier question" } }], approvals: [], turns: [{ id: "user-root", state: "completed", replies: [{ agentId: first, displayName: "Colleague 0", state: "completed" }] }] });
    return snapshots.get(key);
  };
  const model = new WorkspaceLocalChannelsModel({ supportsLocalChannels: () => true, supportsLocalChannelQueue: () => true, supportsLocalChannelAutonomy: () => capability,
    async localChannelRequest(method, params) {
      calls.push({ method, params: structuredClone(params) });
      if (handlers.has(method)) return handlers.get(method)(params);
      if (method === "workspace.channels.list") return structuredClone(catalog(params.workspaceId, params.expectedGeneration));
      if (["workspace.channels.select", "workspace.channels.snapshot"].includes(method)) return structuredClone(snapshot(params.workspaceId, params.expectedGeneration, params.channelId));
      if (method === "workspace.channels.update") {
        const saved = catalog(params.workspaceId, params.expectedGeneration), row = saved.channels.find(channel => channel.id === params.channelId);
        assert.equal(params.expectedRevision, saved.revision); row.name = params.name; row.memberIds = [...params.memberIds];
        if (params.autonomy) row.autonomy = structuredClone(params.autonomy); saved.revision++;
        return structuredClone(saved);
      }
      if (method === "workspace.channels.send") return { workspaceId: params.workspaceId, resourceGeneration: params.expectedGeneration, channelId: params.channelId, requestId: params.requestId, accepted: true, queued: false, position: 0 };
      throw new Error(`Unexpected fixture method ${method}`);
    } }, () => randomUUID(), null);
  return { model, calls, handlers, catalog, snapshot, async open(workspaceId = "A", generation = "g-A", channelId = "room") { await model.bind(workspaceId, generation); await model.select(channelId); }, guard() { const view = model.getSnapshot(); return { scope: view.scope, channelId: view.channelId }; } };
}
const updates = f => f.calls.filter(call => call.method === "workspace.channels.update");

test("autonomy requires its own capability and metadata; old records remain user/depth zero", async () => {
  const rpc = names => ({ supportsCapability: name => names.includes(name) });
  assert.equal(new WorkspaceDevModel(rpc(["workspace.channel-queue.v1"])).supportsLocalChannelAutonomy(), false);
  assert.equal(new WorkspaceDevModel(rpc(["workspace.channel-autonomy.v1"])).supportsLocalChannelAutonomy(), true);
  for (const options of [{ capability: false }, { fields: false }]) {
    const f = fixture(options); await f.open(); assert.ok(f.model.getSnapshot().channel);
    assert.equal(await f.model.updateAutonomy({ mode: "off" }, f.guard()), false); assert.equal(updates(f).length, 0);
  }
  const f = fixture(); await f.open(); assert.equal(f.model.getSnapshot().channel.channel.autonomy.mode, "mention");
  assert.equal(f.model.getSnapshot().channel.turns[0].origin, undefined); assert.equal(f.model.getSnapshot().channel.turns[0].replies[0].depth, undefined);
});

test("metadata parsing rejects extra/private keys, invalid schema/cooldown/mutes and noncanonical ISO", async () => {
  for (const invalid of [{ schemaVersion: 2 }, { mode: "automatic" }, { cooldownMs: 1 }, { mutedAgentIds: [first, first] }, { mutedAgentIds: ["unknown"] }, { pausedUntil: "tomorrow" }, { pausedUntil: "2026-11-03T10:00:00+08:00" }, { counters: {} }, { rootTurnId: "private" }, { maxTokens: 16000 }, { lastAutonomousAt: {} }]) {
    const f = fixture(); Object.assign(f.catalog().channels[0].autonomy, invalid); await f.open(); assert.equal(f.model.getSnapshot().channel, null, JSON.stringify(invalid));
    assert.equal(f.model.getSnapshot().error, "ws.channels.loadFailed");
  }
});

test("busy updates change only autonomy using the catalog revision and preserve drafts, responders, history and runtime state", async () => {
  const f = fixture(); f.snapshot().state = "running"; await f.open(); f.model.setDraft("unfinished draft"); f.model.setRecipients([second]);
  const before = structuredClone(f.model.getSnapshot().channel), expected = f.guard();
  assert.equal(await f.model.updateMembers("Renamed group", [first]), false, "busy name/member writes stay blocked");
  assert.equal(await f.model.updateAutonomy({ mode: "off" }, expected), true);
  const params = updates(f)[0].params;
  assert.deepEqual(params, { workspaceId: "A", expectedGeneration: "g-A", channelId: "room", name: "Group room", memberIds: [first, second], expectedRevision: 7, autonomy: { ...metadata(), mode: "off" } });
  const after = f.model.getSnapshot(); assert.equal(after.channel.revision, 91, "history revision is not the catalog revision"); assert.equal(after.catalog.revision, 8);
  assert.deepEqual(after.channel.turns, before.turns); assert.deepEqual(after.channel.messages, before.messages); assert.equal(after.channel.state, "running");
  assert.equal(after.draft, "unfinished draft"); assert.deepEqual(after.recipientIds, [second]); assert.equal(after.channel.channel.autonomy.mode, "off");
});

test("pause/resume and member mute preserve other preferences and cannot reset counters or enable ambient", async () => {
  const f = fixture(); await f.open(); const guard = f.guard(), until = "2030-11-03T00:30:00.000Z";
  assert.equal(await f.model.updateAutonomy({ pausedUntil: until }, guard), true);
  assert.equal(await f.model.updateAutonomy({ mutedAgentIds: [first] }, guard), true);
  assert.deepEqual(f.model.getSnapshot().channel.channel.autonomy, { ...metadata(), pausedUntil: until, mutedAgentIds: [first] });
  assert.equal(await f.model.updateAutonomy({ pausedUntil: null }, guard), true); assert.equal("pausedUntil" in updates(f).at(-1).params.autonomy, false);
  const before = updates(f).length;
  for (const patch of [{ mode: "ambient" }, { mutedAgentIds: [first, first] }, { mutedAgentIds: ["unknown"] }, { mutedAgentIds: "bad" }, { cooldownMs: 0 }, { counters: {} }, { rootTurnId: "root" }, { budget: {} }]) assert.equal(await f.model.updateAutonomy(patch, guard), false);
  assert.equal(updates(f).length, before); assert.equal(f.calls.some(call => /send|resumeQueue|clearQueue|cancel/.test(call.method)), false);
  assert.equal(await f.model.updateAutonomy({ mode: "off" }, guard), true); assert.equal(await f.model.updateAutonomy({ mode: "mention" }, guard), true);
});

test("raw ambient cannot be persisted by partial edits and explicit ambient writes are rejected", async () => {
  const f = fixture(); f.catalog().channels[0].autonomy.mode = "ambient"; await f.open();
  assert.equal(await f.model.updateAutonomy({ mutedAgentIds: [first] }, f.guard()), false);
  assert.equal(await f.model.updateAutonomy({ pausedUntil: "2030-11-03T00:30:00.000Z" }, f.guard()), false);
  assert.equal(await f.model.updateAutonomy({ mode: "ambient" }, f.guard()), false); assert.equal(updates(f).length, 0);
});

test("unknown settings writes remain latched without resending; explicit user messages still work and verification is read only", async () => {
  const f = fixture(); await f.open(); f.model.setDraft("explicit user message");
  f.handlers.set("workspace.channels.update", () => { throw new Error("lost acknowledgement"); });
  await f.model.updateAutonomy({ mutedAgentIds: [first] }, f.guard()); assert.equal(f.model.getSnapshot().autonomyUnknown, true);
  await f.model.updateAutonomy({ mode: "off" }, f.guard()); await f.model.refresh(); assert.equal(updates(f).length, 1); assert.equal(f.model.getSnapshot().autonomyUnknown, true);
  await f.model.send([second]); assert.equal(f.calls.filter(call => call.method.endsWith(".send")).length, 1, "future proactive mute must not lock explicit user turns");
  const before = f.calls.length; await f.model.verifyAutonomy(); assert.equal(f.model.getSnapshot().autonomyUnknown, false);
  assert.equal(f.calls.slice(before).every(call => ["workspace.channels.list", "workspace.channels.snapshot"].includes(call.method)), true); assert.equal(updates(f).length, 1);
  assert.deepEqual(f.model.getSnapshot().channel.channel.autonomy.mutedAgentIds, [], "the current saved settings are displayed without claiming the unknown write succeeded");
});

test("explicit refusal releases the settings latch without changing the saved policy or draft", async () => {
  const f = fixture(); await f.open(); f.model.setDraft("keep draft");
  f.handlers.set("workspace.channels.update", () => { throw Object.assign(new Error("conflict"), { code: -32000 }); });
  assert.equal(await f.model.updateAutonomy({ mode: "off" }, f.guard()), false); assert.equal(f.model.getSnapshot().autonomyUnknown, false);
  assert.equal(f.model.getSnapshot().error, "ws.channels.autonomyFailed"); assert.equal(f.model.getSnapshot().channel.channel.autonomy.mode, "mention"); assert.equal(f.model.getSnapshot().draft, "keep draft");
});

test("late settings receipts preserve the current channel/Workspace/generation and A→B→A views", async () => {
  for (const where of ["channel", "workspace", "generation", "roundtrip"]) {
    const f = fixture(); await f.open(); const wait = deferred(), receipt = structuredClone(f.catalog()); receipt.revision++;
    receipt.channels[0].autonomy.mode = "off"; f.handlers.set("workspace.channels.update", () => wait.promise);
    const saving = f.model.updateAutonomy({ mode: "off" }, f.guard());
    if (where === "channel") await f.model.select("other");
    if (where === "workspace") await f.open("B", "g-B");
    if (where === "generation") await f.open("A", "g-next");
    if (where === "roundtrip") { await f.open("B", "g-B"); await f.open(); }
    const channel = structuredClone(f.model.getSnapshot().channel), catalog = structuredClone(f.model.getSnapshot().catalog);
    wait.resolve(receipt); assert.equal(await saving, false); assert.deepEqual(f.model.getSnapshot().channel, channel, where); assert.deepEqual(f.model.getSnapshot().catalog, catalog, where);
  }
});

test("stale command scopes and invalid write receipts do not apply optimistic preferences", async () => {
  const f = fixture(); await f.open(); const guard = f.guard();
  for (const wrong of [{ ...guard, scope: '["B","g-B"]' }, { ...guard, scope: '["A","g-next"]' }, { ...guard, channelId: "other" }]) assert.equal(await f.model.updateAutonomy({ mode: "off" }, wrong), false);
  assert.equal(updates(f).length, 0);
  for (const invalid of [row => { row.workspaceId = "B"; }, row => { delete row.channels[0].autonomy; }, row => { row.channels[0].name = "Foreign name"; }, row => { row.channels[0].autonomy.mode = "ambient"; }]) {
    const bad = fixture(); await bad.open(); const receipt = structuredClone(bad.catalog()); receipt.revision++; receipt.channels[0].autonomy.mode = "off"; invalid(receipt);
    bad.handlers.set("workspace.channels.update", () => receipt); await bad.model.updateAutonomy({ mode: "off" }, bad.guard());
    assert.equal(bad.model.getSnapshot().autonomyUnknown, true); assert.equal(bad.model.getSnapshot().channel.channel.autonomy.mode, "mention");
  }
});

test("lineage parser keeps old records readable but refuses invalid depth/origin and peer-wake contradictions", async () => {
  const valid = fixture(); Object.assign(valid.snapshot().turns[0], { origin: "autonomy", rootTurnId: "earlier-user" }); valid.snapshot().turns[0].replies[0].depth = 1;
  await valid.open(); assert.equal(valid.model.getSnapshot().channel.turns[0].origin, "autonomy");
  for (const patch of [{ origin: "bot", depth: 0 }, { origin: "user", depth: 1 }, { depth: 1 }, { origin: "autonomy", depth: 2 }, { origin: "autonomy", depth: 1, wokenBy: second }]) {
    const f = fixture(), turn = f.snapshot().turns[0]; if (patch.origin !== undefined) turn.origin = patch.origin; turn.replies[0].depth = patch.depth; if (patch.wokenBy) turn.replies[0].wokenBy = patch.wokenBy;
    await f.open(); assert.equal(f.model.getSnapshot().channel, null, JSON.stringify(patch));
  }
});

const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const bundled = await build({ stdin: { contents: 'export {LocalChannelAutonomyControls,LocalChannelThread} from "./src/WorkspaceLocalChannels.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, platform: "node", format: "cjs", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const compiled = { exports: {} }; new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, compiled, compiled.exports);
const { LocalChannelAutonomyControls, LocalChannelThread } = compiled.exports;
const { createElement: h } = require("react"), { renderToStaticMarkup: render } = require("react-dom/server");
const uiModel = { supportsAutonomy: () => true, updateAutonomy() {}, verifyAutonomy() {}, setHistoryAnchor() {} };
function settings(view, t, extra = {}) { return render(h(LocalChannelAutonomyControls, { view, colleagues: people, t, model: uiModel, now: Date.parse("2026-11-03T00:00:00.000Z"), ...extra })); }
function thread(view, t, extra = {}) { return render(h(LocalChannelThread, { view, colleagues: people, t, model: uiModel, retry() {}, transcript: history => h("p", null, history.map(message => message.text ?? message.content).join(" ")), approval() {}, ...extra })); }

test("three-language future-autonomy controls default to mention, expose no ambient option and preserve explicit response semantics", async () => {
  const f = fixture(); await f.open(); const view = f.model.getSnapshot();
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale), html = settings(view, t);
    for (const key of ["autonomyFuture", "autonomyExplicitUnaffected", "autonomyMentionDefault", "autonomyAmbientUnavailable", "autonomyPause30", "autonomyMute"]) assert.ok(html.includes(t(`ws.channels.${key}`)), key);
    assert.equal((html.match(/<option/g) ?? []).length, 2); assert.ok(/<option value="mention" selected/.test(html)); assert.equal(html.includes('value="ambient"'), false);
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2); assert.equal(/<fieldset[^>]*disabled/.test(html), false);
    assert.equal(settings(view, t, { model: { ...uiModel, supportsAutonomy: () => false } }), "");
    assert.equal(settings({ ...view, channel: { ...view.channel, channel: { ...view.channel.channel, autonomy: undefined } } }, t), "");
  }
});

test("pause, mute, busy, unknown, disconnect and raw ambient are represented honestly without enabling settings retries", async () => {
  const f = fixture(); f.catalog().channels[0].autonomy = { ...metadata(), pausedUntil: "2030-11-03T00:30:00.000Z", mutedAgentIds: [first] }; await f.open(); const view = f.model.getSnapshot();
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale), html = settings(view, t); assert.ok(html.includes(t("ws.channels.autonomyResume"))); assert.equal((html.match(/checked=""/g) ?? []).length, 1);
    assert.equal(/<fieldset[^>]*disabled/.test(settings({ ...view, channel: { ...view.channel, state: "running" } }, t)), false, "metadata-only updates stay available while busy");
    for (const flags of [{ autonomySaving: true }, { autonomyUnknown: true }, { pending: { state: "unknown" } }, { saving: true }, { queueUnknown: true }]) assert.ok(/<fieldset[^>]*disabled/.test(settings({ ...view, ...flags }, t)));
    const unknown = settings({ ...view, autonomyUnknown: true }, t); assert.ok(unknown.includes(t("ws.channels.autonomyVerify")));
    assert.ok(/<fieldset[^>]*disabled/.test(settings(view, t, { disabled: true })));
    const ambient = settings({ ...view, channel: { ...view.channel, channel: { ...view.channel.channel, autonomy: { ...metadata(), mode: "ambient" } } } }, t);
    assert.ok(ambient.includes('data-channel-autonomy="off"')); assert.ok(ambient.includes(t("ws.channels.autonomyAmbientOff"))); assert.ok(/<fieldset[^>]*disabled/.test(ambient)); assert.equal(ambient.includes('value="ambient"'), false);
  }
});

test("only real autonomy-turn depth-one replies receive the proactive badge; peerWake and contradictory metadata do not", async () => {
  const f = fixture(); await f.open(); const view = structuredClone(f.model.getSnapshot()); view.channel.turns = []; view.channel.messages = [];
  const add = (id, origin, depth, wokenBy) => {
    view.channel.turns.push({ id, state: "completed", ...(origin ? { origin } : {}), rootTurnId: "user-root", replies: [{ agentId: first, displayName: "Colleague 0", state: "completed", ...(depth === undefined ? {} : { depth }), ...(wokenBy ? { wokenBy } : {}) }] });
    view.channel.messages.push({ id: `reply-${id}`, turnId: id, agentId: first, displayName: "Colleague 0", message: { role: "assistant", text: id, tools: [] } });
  };
  add("old-user", undefined, undefined); add("ordinary-user", "user", 0); add("peer-wake", "user", 0, second); add("real-autonomy", "autonomy", 1);
  add("contradictory-user", "user", 1); add("contradictory-depth", "autonomy", 0); add("contradictory-peer", "autonomy", 1, second);
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale), html = thread(view, t); assert.equal((html.match(/data-channel-proactive="true"/g) ?? []).length, 1);
    assert.ok(html.includes(`data-channel-proactive="true">${t("ws.channels.proactive")}</span>`)); assert.ok(html.includes('data-channel-woken="started"'));
    const real = html.indexOf("real-autonomy</p>"), badge = html.indexOf('data-channel-proactive="true"'); assert.ok(badge < real && badge > html.indexOf("peer-wake</p>"));
    assert.equal(thread(view, t, { model: { ...uiModel, supportsAutonomy: () => false } }).includes('data-channel-proactive="true"'), false);
  }
});
