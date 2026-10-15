import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceCollaborationModel } from "../src/workspace-collaboration-state.ts";

const ok = value => ({ ok: true, value }), fail = code => ({ ok: false, error: { code } });
const mention = principalId => ({ kind: "human", principalId });
const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
function fixture() {
  const sends = []; let serial = 0;
  const client = {
    supportsCollaborationMembers: () => true, supportsCollaborationMentions: () => true,
    async listCollaborationWorkspaces() { return ok({ schemaVersion: 1, accountScope: "scope", accountRegion: "CN", nextCursor: null,
      workspaces: ["A", "B"].map(workspaceId => ({ workspaceId, membership: { role: "OWNER", membershipVersion: 1, policyVersion: 1 } })) }); },
    async bootstrapCollaborationWorkspace(workspaceId) { return ok({ workspaceId, displayName: workspaceId, cursor: "live",
      membership: { principalId: "self", role: "OWNER", epoch: 1 }, channels: ["general", "other"].map(id => ({ id, slug: id, displayName: id })) }); },
    async listCollaborationMembers(input) { return ok({ workspaceId: input.workspaceId,
      members: Array.from({ length: 12 }, (_, i) => ({ ...mention(input.workspaceId + "-person-" + String(i).padStart(2, "0")), displayName: "Same name", role: "MEMBER" })), nextCursor: null }); },
    async sendCollaborationMessage(input) { sends.push({ method: "plain", input: structuredClone(input) }); return sent(input); },
    async sendCollaborationMentionedMessage(input) { sends.push({ method: "mentioned", input: structuredClone(input) }); return sent(input); },
    async syncCollaborationWorkspace(workspaceId, cursor) { return ok({ workspaceId, cursor, hasMore: false, events: [] }); },
  };
  const sent = input => ok({ workspaceId: input.workspaceId, channelId: input.channelId, messageId: "message-" + sends.length,
    senderPrincipalId: "self", createdAt: "2026-10-16T00:00:00Z", ...(input.mentions ? { mentions: input.mentions } : {}) });
  const model = new WorkspaceCollaborationModel(client, () => "request-" + ++serial);
  return { client, model, sends, sent, async ready() { await model.loadDirectory(); await model.selectWorkspace("A"); await settle(); } };
}
test("only explicit loaded human principals can be selected, bounded to ten; selecting never sends", async () => {
  const f = fixture(); await f.ready();
  f.model.setMention("unknown", true); f.model.setMention("Same name", true);
  for (let i = 11; i >= 0; i--) f.model.setMention("A-person-" + String(i).padStart(2, "0"), true);
  const selected = f.model.getSnapshot().draftMentions;
  assert.equal(selected.length, 10); assert.deepEqual(selected, [...selected].sort((a, b) => a.principalId < b.principalId ? -1 : 1));
  f.model.setMention(selected[0].principalId, true); assert.equal(f.model.getSnapshot().draftMentions.length, 10);
  assert.equal(f.sends.length, 0); assert.equal(f.model.getSnapshot().draft, "");
});
test("literal @ text uses the unchanged plain wire; explicit mentions use their distinct method", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("@Same name hello"); await f.model.send();
  assert.equal(f.sends[0].method, "plain"); assert.deepEqual(Object.keys(f.sends[0].input).sort(), ["accountScope", "body", "channelId", "idempotencyKey", "workspaceId"]);
  f.model.setMention("A-person-01", true); f.model.setMention("A-person-00", true); f.model.setDraft("hello"); await f.model.send();
  assert.equal(f.sends[1].method, "mentioned"); assert.deepEqual(f.sends[1].input.mentions, [mention("A-person-00"), mention("A-person-01")]);
  assert.deepEqual(f.model.getSnapshot().messages.at(-1).mentions, f.sends[1].input.mentions);
  assert.deepEqual(f.model.getSnapshot().draftMentions, []);
});
test("a first definite target rejection can return to an editable draft without sending", async () => {
  const f = fixture(); await f.ready();
  f.client.sendCollaborationMentionedMessage = async input => { f.sends.push({ method: "mentioned", input }); return fail("MENTION_TARGET_UNAVAILABLE"); };
  f.model.setDraft("retain me"); f.model.setMention("A-person-00", true); await f.model.send();
  assert.equal(f.model.getSnapshot().pending.state, "failed");
  f.model.returnMentionToDraft(); assert.equal(f.sends.length, 1); assert.equal(f.model.getSnapshot().pending, null);
  assert.equal(f.model.getSnapshot().draft, "retain me"); assert.deepEqual(f.model.getSnapshot().draftMentions, [mention("A-person-00")]);
  f.model.setMention("A-person-00", false); await f.model.send();
  assert.equal(f.sends[1].method, "plain"); assert.notEqual(f.sends[0].input.idempotencyKey, f.sends[1].input.idempotencyKey);
});
test("once outcome is unknown, a later target error cannot permit editing or claim not sent", async () => {
  const f = fixture(); await f.ready();
  f.client.sendCollaborationMentionedMessage = async input => { f.sends.push({ input }); return fail(f.sends.length === 1 ? "OUTCOME_UNKNOWN" : "MENTION_TARGET_UNAVAILABLE"); };
  f.model.setDraft("frozen"); f.model.setMention("A-person-00", true); await f.model.send();
  f.model.setMention("A-person-01", true); await f.model.send(true);
  assert.deepEqual(f.sends[1].input, f.sends[0].input); assert.equal(f.model.getSnapshot().pending.state, "unknown");
  assert.equal(f.model.getSnapshot().error, "OUTCOME_UNKNOWN"); f.model.returnMentionToDraft();
  assert.equal(f.model.getSnapshot().pending.idempotencyKey, "request-1");
  assert.deepEqual(f.model.getSnapshot().draftMentions, [mention("A-person-00")]);
});
test("roster staleness and lost capability preserve frozen targets; neither falls back to plain", async () => {
  const f = fixture(); await f.ready();
  f.client.sendCollaborationMentionedMessage = async input => { f.sends.push({ input }); return fail("OUTCOME_UNKNOWN"); };
  f.model.setDraft("frozen"); f.model.setMention("A-person-00", true); await f.model.send();
  f.client.listCollaborationMembers = async () => fail("MEMBERS_STALE"); await f.model.loadMembers();
  assert.deepEqual(f.model.getSnapshot().members.items, []);
  f.client.supportsCollaborationMentions = () => false; await f.model.send(true);
  assert.equal(f.sends.length, 1); assert.equal(f.model.getSnapshot().pending.idempotencyKey, "request-1");
  f.client.supportsCollaborationMentions = () => true;
  f.client.sendCollaborationMentionedMessage = async input => { f.sends.push({ input }); return f.sent(input); };
  await f.model.send(true); assert.deepEqual(f.sends[1].input, f.sends[0].input); assert.equal(f.model.getSnapshot().pending, null);
});
test("mention drafts are channel and Workspace scoped; unknown A→B→A cannot be replaced by a late ack", async () => {
  const f = fixture(); await f.ready();
  f.model.setMention("A-person-00", true); f.model.setDraft("A draft"); f.model.selectChannel("other");
  assert.deepEqual(f.model.getSnapshot().draftMentions, []); f.model.selectChannel("general");
  assert.deepEqual(f.model.getSnapshot().draftMentions, [mention("A-person-00")]);
  let resolve; f.client.sendCollaborationMentionedMessage = input => new Promise(done => { resolve = () => done(f.sent(input)); });
  const send = f.model.send(); await f.model.selectWorkspace("B"); await settle();
  assert.deepEqual(f.model.getSnapshot().draftMentions, []); f.model.setMention("B-person-00", true);
  await f.model.selectWorkspace("A"); await settle(); resolve(); await send;
  assert.equal(f.model.getSnapshot().pending.state, "unknown"); assert.deepEqual(f.model.getSnapshot().draftMentions, [mention("A-person-00")]);
  assert.deepEqual(f.model.getSnapshot().messages, []);
});
test("missing or wrong receipt targets remain uncertain; actual sender denial clears scoped data", async () => {
  for (const mentions of [undefined, [], [mention("A-person-01")]]) {
    const f = fixture(); await f.ready(); f.model.setDraft("text"); f.model.setMention("A-person-00", true);
    f.client.sendCollaborationMentionedMessage = async input => ok({ ...f.sent(input).value, mentions });
    await f.model.send(); assert.equal(f.model.getSnapshot().pending.state, "unknown");
    assert.equal(f.model.getSnapshot().draft, "text"); f.model.returnMentionToDraft(); assert.ok(f.model.getSnapshot().pending);
    f.client.sendCollaborationMentionedMessage = async () => fail("ACCESS_CHANGED"); await f.model.send(true);
    assert.equal(f.model.getSnapshot().workspaceId, null); assert.deepEqual(f.model.getSnapshot().draftMentions, []);
  }
});
test("older engines do not select mentions or change ordinary text behavior", async () => {
  const f = fixture(); f.client.supportsCollaborationMentions = () => false; await f.ready();
  f.model.setMention("A-person-00", true); assert.deepEqual(f.model.getSnapshot().draftMentions, []);
  assert.equal(f.model.getSnapshot().mentionsSupported, false); f.model.setDraft("@Same name"); await f.model.send();
  assert.equal(f.sends[0].method, "plain");
});
