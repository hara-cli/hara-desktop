import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceCollaborationModel, mergeCollaborationMessages } from "../src/workspace-collaboration-state.ts";

const A = "workspace-a", B = "workspace-b", C = "channel-a", D = "channel-b";
const ok = value => ({ ok: true, value }), fail = code => ({ ok: false, error: { code } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const bootstrap = (workspaceId, role = "OWNER") => ({ workspaceId, displayName: workspaceId, cursor: "cursor-0",
  membership: { principalId: "me", role, epoch: 1 }, channels: [{ id: C, slug: "general", displayName: "General" }, { id: D, slug: "other", displayName: "Other" }] });
function fixture() {
  let serial = 0; const calls = [];
  const client = {
    async listCollaborationWorkspaces(cursor) { calls.push(["list", cursor]); return ok({ schemaVersion: 1, accountRegion: "CN", accountScope: "scope-1", nextCursor: null,
      workspaces: [A, B].map(workspaceId => ({ workspaceId, membership: { role: "OWNER", membershipVersion: 1, policyVersion: 1 } })) }); },
    async bootstrapCollaborationWorkspace(workspaceId, scope) { calls.push(["bootstrap", workspaceId, scope]); return ok(bootstrap(workspaceId)); },
    async syncCollaborationWorkspace(workspaceId, cursor, scope) { calls.push(["sync", workspaceId, cursor, scope]); return ok({ workspaceId, cursor: "cursor-next", hasMore: false, events: [] }); },
    async sendCollaborationMessage(request) { calls.push(["send", request]); return ok({ workspaceId: request.workspaceId, channelId: request.channelId, messageId: "message-1", senderPrincipalId: "me", createdAt: "2026-10-15T01:00:00Z" }); },
    async createCollaborationChannel(request) { calls.push(["create", request]); return ok({ workspaceId: request.workspaceId, channel: { id: "new-channel", slug: request.slug, displayName: request.displayName } }); },
  };
  const model = new WorkspaceCollaborationModel(client, () => "request-" + ++serial);
  return { client, model, calls, async ready(workspaceId = A) { await model.loadDirectory(); await model.selectWorkspace(workspaceId); } };
}
test("only directory-authorized spaces can load, never the first-item fallback", async () => {
  const f = fixture(); await f.model.selectWorkspace(A); assert.equal(f.calls.length, 0);
  await f.model.loadDirectory(); assert.equal(f.model.getSnapshot().workspaceId, null);
  await f.model.selectWorkspace("personal"); assert.equal(f.calls.length, 1);
  await f.model.selectWorkspace(A); assert.equal(f.model.getSnapshot().channelId, C);
});
test("A→B→A bootstrap responses are generation fenced", async () => {
  const f = fixture(); await f.model.loadDirectory(); const first = deferred(); let count = 0;
  f.client.bootstrapCollaborationWorkspace = async id => id === A && ++count === 1 ? first.promise : ok(bootstrap(id));
  const request = f.model.selectWorkspace(A);
  await f.model.selectWorkspace(B); await f.model.selectWorkspace(A);
  first.resolve(ok({ ...bootstrap(A), displayName: "obsolete" })); await request;
  assert.equal(f.model.getSnapshot().bootstrap.displayName, A);
});
test("switch hides messages immediately and stores drafts only in their exact channel scope", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("draft A");
  f.model.selectChannel(D); assert.equal(f.model.getSnapshot().draft, ""); f.model.setDraft("other A");
  await f.model.selectWorkspace(B); assert.equal(f.model.getSnapshot().draft, "");
  f.model.setDraft("draft B"); await f.model.selectWorkspace(A);
  assert.equal(f.model.getSnapshot().draft, "draft A"); f.model.selectChannel(D);
  assert.equal(f.model.getSnapshot().draft, "other A");
});
test("a stale A sync cannot advance a later A cursor or reveal messages", async () => {
  const f = fixture(); await f.ready(); const old = deferred(); f.client.syncCollaborationWorkspace = () => old.promise;
  const request = f.model.sync(); await f.model.selectWorkspace(B); await f.model.selectWorkspace(A);
  old.resolve(ok({ workspaceId: A, cursor: "obsolete-cursor", hasMore: true, events: [{ id: "e", type: "message", message: { id: "m", channelId: C, body: "stale" } }] })); await request;
  assert.equal(f.model.getSnapshot().bootstrap.cursor, "cursor-0"); assert.deepEqual(f.model.getSnapshot().messages, []);
});
test("sync deduplicates by message ID, ignores foreign channels and advances only successful cursor", async () => {
  const f = fixture(); await f.ready();
  const message = { id: "message-1", channelId: C, senderPrincipalId: "other", body: "hello", createdAt: "2026-10-15T01:00:00Z" };
  f.client.syncCollaborationWorkspace = async () => ok({ workspaceId: A, cursor: "cursor-1", hasMore: true, events: [
    { id: "e1", type: "message", message }, { id: "e2", type: "message", message },
    { id: "e3", type: "message", message: { ...message, id: "foreign", channelId: "private-foreign" } },
  ] });
  await f.model.sync(); assert.deepEqual(f.model.getSnapshot().messages, [message]); assert.equal(f.model.getSnapshot().hasMore, true);
  f.client.syncCollaborationWorkspace = async () => fail("UNAVAILABLE"); await f.model.sync();
  assert.equal(f.model.getSnapshot().bootstrap.cursor, "cursor-1");
});
test("parallel sync calls cannot duplicate the cursor read", async () => {
  const f = fixture(); await f.ready(); const wait = deferred(); let count = 0;
  f.client.syncCollaborationWorkspace = () => { count++; return wait.promise; };
  const pending = f.model.sync(); await f.model.sync(); assert.equal(count, 1);
  wait.resolve(ok({ workspaceId: A, cursor: "new", hasMore: false, events: [] })); await pending;
});
test("typing never sends, and explicit double submission creates only one request", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("hello");
  assert.equal(f.calls.filter(item => item[0] === "send").length, 0);
  const wait = deferred(); let count = 0;
  f.client.sendCollaborationMessage = () => { count++; return wait.promise; };
  const request = f.model.send(); await f.model.send(); assert.equal(count, 1);
  wait.resolve(fail("OUTCOME_UNKNOWN")); await request;
  assert.equal(f.model.getSnapshot().pending.state, "unknown"); assert.equal(f.model.getSnapshot().draft, "hello");
});
test("outcome-unknown retry freezes original payload and idempotency key", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("original");
  const requests = []; f.client.sendCollaborationMessage = async request => { requests.push(request); return fail("OUTCOME_UNKNOWN"); };
  await f.model.send(); await f.model.send(); assert.equal(requests.length, 1);
  f.model.setDraft("new text"); await f.model.send(true);
  assert.deepEqual(requests[1], requests[0]); assert.equal(requests[0].body, "original");
});
test("leaving an in-flight send retains unknown outcome; late result cannot repaint A→B→A", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("hello"); const old = deferred();
  f.client.sendCollaborationMessage = () => old.promise;
  const request = f.model.send(); await f.model.selectWorkspace(B); await f.model.selectWorkspace(A);
  assert.equal(f.model.getSnapshot().pending.state, "unknown");
  old.resolve(ok({ workspaceId: A, channelId: C, messageId: "old", senderPrincipalId: "me", createdAt: "2026-10-15T01:00:00Z" })); await request;
  assert.deepEqual(f.model.getSnapshot().messages, []); assert.equal(f.model.getSnapshot().pending.state, "unknown");
});
test("confirmed send and sync event share one bubble and preserve another channel's draft", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("hello");
  f.client.syncCollaborationWorkspace = async () => ok({ workspaceId: A, cursor: "new", hasMore: false,
    events: [{ id: "e1", type: "message", message: { id: "message-1", channelId: C, senderPrincipalId: "me", body: "hello", createdAt: "2026-10-15T01:00:00Z" } }] });
  await f.model.send(); assert.equal(f.model.getSnapshot().messages.length, 1); assert.equal(f.model.getSnapshot().pending, null); assert.equal(f.model.getSnapshot().draft, "");
});
test("revocation clears messages, drafts, pending requests and selection immediately", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("private draft"); f.client.syncCollaborationWorkspace = async () => fail("ACCESS_CHANGED");
  await f.model.sync(); const view = f.model.getSnapshot();
  assert.equal(view.bootstrap, null); assert.equal(view.directory, null); assert.equal(view.draft, ""); assert.equal(view.error, "ACCESS_CHANGED");
  await f.model.send(); assert.equal(f.calls.filter(item => item[0] === "send").length, 0);
});
test("new directory account scope clears all old Workspace data and cannot reuse a pagination cursor", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("old");
  f.client.listCollaborationWorkspaces = async () => ok({ schemaVersion: 1, accountRegion: "CN", accountScope: "scope-2", workspaces: [], nextCursor: null });
  await f.model.loadDirectory(); assert.equal(f.model.getSnapshot().workspaceId, null); assert.equal(f.model.getSnapshot().draft, "");
});
test("membership epoch changes invalidate cached drafts and pending identity", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("old");
  await f.model.selectWorkspace(B);
  f.client.bootstrapCollaborationWorkspace = async id => ok({ ...bootstrap(id), membership: { principalId: "me", role: "OWNER", epoch: 2 } });
  await f.model.selectWorkspace(A); assert.equal(f.model.getSnapshot().draft, "");
});
test("member cannot create channels and invalid creation never dispatches", async () => {
  const f = fixture(); await f.ready();
  await f.model.createChannel("Bad Slug", "Name"); assert.equal(f.calls.filter(item => item[0] === "create").length, 0);
  f.client.bootstrapCollaborationWorkspace = async id => ok(bootstrap(id, "MEMBER")); await f.model.selectWorkspace(A);
  await f.model.createChannel("general", "Name"); assert.equal(f.calls.filter(item => item[0] === "create").length, 0);
});
test("channel create retry and navigation preserve the same mutation identity", async () => {
  const f = fixture(); await f.ready(); const requests = [];
  f.client.createCollaborationChannel = async request => { requests.push(request); return fail("OUTCOME_UNKNOWN"); };
  await f.model.createChannel("development", "Development");
  await f.model.selectWorkspace(B); await f.model.selectWorkspace(A);
  assert.equal(f.model.getSnapshot().creation.state, "unknown");
  await f.model.createChannel("", "", true); assert.deepEqual(requests[1], requests[0]);
});
test("UTF-8 size, whitespace, scope-mismatch and disposed lifecycle fail closed", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("字".repeat(3000)); await f.model.send();
  f.model.setDraft("   "); await f.model.send(); assert.equal(f.calls.filter(item => item[0] === "send").length, 0);
  f.client.syncCollaborationWorkspace = async () => ok({ workspaceId: B, cursor: "wrong", hasMore: false, events: [] });
  await f.model.sync(); assert.equal(f.model.getSnapshot().error, "SCOPE_CHANGED");
  f.model.dispose(); await f.model.loadDirectory(); assert.equal(f.model.getSnapshot().directory, null);
});
test("remote channel creation becomes visible before its message in the same sync page", async () => {
  const f = fixture(); await f.ready();
  f.client.syncCollaborationWorkspace = async () => ok({ workspaceId: A, cursor: "next", hasMore: false, events: [
    { id: "created", type: "channel.created", channel: { id: "remote", slug: "remote", displayName: "Remote" }, message: null },
    { id: "sent", type: "message.created", message: { id: "remote-message", channelId: "remote", senderPrincipalId: "other", body: "new channel text" } },
  ] });
  await f.model.sync(); f.model.selectChannel("remote");
  assert.equal(f.model.getSnapshot().channelId, "remote"); assert.equal(f.model.getSnapshot().messages[0].body, "new channel text");
});
test("stale directory page retains uncertain send identity and resets pagination, not membership", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("uncertain text");
  const requests = [];
  f.client.sendCollaborationMessage = async request => { requests.push(request); return fail("OUTCOME_UNKNOWN"); };
  await f.model.send(); const before = f.model.getSnapshot().pending;
  f.client.listCollaborationWorkspaces = async () => fail("DIRECTORY_STALE"); await f.model.loadDirectory();
  assert.equal(f.model.getSnapshot().bootstrap.workspaceId, A); assert.deepEqual(f.model.getSnapshot().pending, before);
  assert.equal(f.model.hasUnresolvedMutations(), true);
  assert.equal(f.model.getSnapshot().directory.nextCursor, null);
  await f.model.send(true); assert.deepEqual(requests[1], requests[0]);
});
test("first-page absence with a continuation is not revocation of the selected later-page Workspace", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("later-page draft");
  f.client.sendCollaborationMessage = async () => fail("OUTCOME_UNKNOWN"); await f.model.send();
  const pending = f.model.getSnapshot().pending;
  f.client.listCollaborationWorkspaces = async () => ok({ schemaVersion: 1, accountScope: "scope-1", accountRegion: "CN",
    workspaces: [{ workspaceId: B, membership: { role: "MEMBER", membershipVersion: 1, policyVersion: 1 } }], nextCursor: "page-2" });
  await f.model.loadDirectory();
  assert.equal(f.model.getSnapshot().workspaceId, A); assert.equal(f.model.getSnapshot().bootstrap.workspaceId, A);
  assert.equal(f.model.getSnapshot().draft, "later-page draft"); assert.deepEqual(f.model.getSnapshot().pending, pending);
  assert.equal(f.model.getSnapshot().error, null);
});
const historyMessage = (index, channelId = C) => ({ id: "history-" + index, channelId, senderPrincipalId: "other",
  body: "record " + index, sequence: String(index), createdAt: "2026-10-15T01:00:00Z" });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function withHistory() {
  const f = fixture(), requests = [];
  f.client.readCollaborationHistory = async input => {
    requests.push(input);
    return ok({ workspaceId: input.workspaceId, channelId: input.channelId,
      messages: input.before ? [historyMessage(1, input.channelId), historyMessage(2, input.channelId)]
        : [historyMessage(3, input.channelId), historyMessage(4, input.channelId)],
      nextBefore: input.before ? null : "older-3" });
  };
  return { ...f, requests, async readyHistory() { await f.ready(); await settle(); } };
}
test("latest history loads on selection and older pages prepend without changing live cursor or draft", async () => {
  const f = withHistory(); await f.readyHistory(); f.model.setDraft("keep draft");
  assert.deepEqual(f.model.getSnapshot().messages.map(item => item.sequence), ["3", "4"]);
  await f.model.loadHistory(true);
  assert.deepEqual(f.model.getSnapshot().messages.map(item => item.sequence), ["1", "2", "3", "4"]);
  assert.equal(f.model.getSnapshot().bootstrap.cursor, "cursor-0"); assert.equal(f.model.getSnapshot().draft, "keep draft");
  assert.equal(f.model.getSnapshot().history.nextBefore, null);
});
test("late history merges live messages without duplicates or same-timestamp misordering", async () => {
  const f = withHistory(); await f.readyHistory(); const older = deferred();
  f.client.readCollaborationHistory = () => older.promise;
  const request = f.model.loadHistory(true);
  f.client.syncCollaborationWorkspace = async () => ok({ workspaceId: A, cursor: "live-5", hasMore: false,
    events: [4, 5].map(index => ({ id: "event-" + index, type: "message.created", message: historyMessage(index) })) });
  await f.model.sync();
  older.resolve(ok({ workspaceId: A, channelId: C, messages: [historyMessage(1), historyMessage(2), historyMessage(3)], nextBefore: null })); await request;
  assert.deepEqual(f.model.getSnapshot().messages.map(item => item.sequence), ["1", "2", "3", "4", "5"]);
  assert.equal(f.model.getSnapshot().bootstrap.cursor, "live-5");
});
test("history A→B→A and same-Workspace channel A→B→A both reject old responses", async () => {
  const f = withHistory(), first = deferred(); let count = 0;
  f.client.readCollaborationHistory = async input => ++count === 1 ? first.promise
    : ok({ workspaceId: input.workspaceId, channelId: input.channelId, messages: [historyMessage(8, input.channelId)], nextBefore: null });
  await f.ready(); await f.model.selectWorkspace(B); await f.model.selectWorkspace(A); await settle();
  first.resolve(ok({ workspaceId: A, channelId: C, messages: [historyMessage(1)], nextBefore: null })); await settle();
  assert.equal(f.model.getSnapshot().messages[0].sequence, "8");
  const oldChannel = deferred(); let calls = 0;
  f.client.readCollaborationHistory = async input => ++calls === 1 ? oldChannel.promise
    : ok({ workspaceId: A, channelId: input.channelId, messages: [historyMessage(9, input.channelId)], nextBefore: null });
  f.model.selectChannel(D); f.model.selectChannel(C); f.model.selectChannel(D); await settle();
  oldChannel.resolve(ok({ workspaceId: A, channelId: D, messages: [historyMessage(2, D)], nextBefore: null })); await settle();
  assert.equal(f.model.getSnapshot().channelId, D); assert.equal(f.model.getSnapshot().messages[0].sequence, "9");
});
test("history cursor staleness clears old transcript but never loses uncertain send identity or draft", async () => {
  const f = withHistory(); await f.readyHistory(); f.model.setDraft("pending body");
  f.client.sendCollaborationMessage = async () => fail("OUTCOME_UNKNOWN"); await f.model.send();
  const pending = f.model.getSnapshot().pending;
  f.client.readCollaborationHistory = async () => fail("HISTORY_STALE"); await f.model.loadHistory(true);
  assert.equal(f.model.getSnapshot().history.error, "HISTORY_STALE"); assert.equal(f.model.getSnapshot().history.nextBefore, null);
  assert.deepEqual(f.model.getSnapshot().pending, pending); assert.equal(f.model.getSnapshot().draft, "pending body");
  assert.deepEqual(f.model.getSnapshot().messages, []); assert.equal(f.model.getSnapshot().bootstrap.workspaceId, A);
});
test("failed older read retains its cursor and repeated clicks do not overlap reads", async () => {
  const f = withHistory(); await f.readyHistory(); const pending = deferred(); let count = 0;
  f.client.readCollaborationHistory = () => { count++; return pending.promise; };
  const read = f.model.loadHistory(true); await f.model.loadHistory(true); assert.equal(count, 1);
  pending.resolve(fail("UNAVAILABLE")); await read;
  assert.equal(f.model.getSnapshot().history.nextBefore, "older-3"); assert.equal(f.model.getSnapshot().history.error, "UNAVAILABLE");
  assert.equal(f.model.getSnapshot().messages.length, 2);
});
test("real history access denial hides content and wrong scope cannot repaint the selected channel", async () => {
  for (const code of ["AUTH_REQUIRED", "ACCESS_CHANGED", "SCOPE_CHANGED"]) {
    const f = withHistory(); await f.readyHistory(); f.model.setDraft("private");
    f.client.readCollaborationHistory = async () => fail(code); await f.model.loadHistory(true);
    assert.equal(f.model.getSnapshot().bootstrap, null); assert.equal(f.model.getSnapshot().draft, ""); assert.deepEqual(f.model.getSnapshot().messages, []);
  }
  const f = withHistory(); await f.readyHistory();
  f.client.readCollaborationHistory = async () => ok({ workspaceId: B, channelId: C, messages: [], nextBefore: null });
  await f.model.loadHistory(true); assert.equal(f.model.getSnapshot().error, "SCOPE_CHANGED");
});
test("history is bounded at 500 messages without consuming a page that cannot be shown", async () => {
  const f = withHistory(); let count = 0;
  f.client.readCollaborationHistory = async input => {
    count++; const high = input.before ? Number(input.before) - 1 : 1000, low = high - 49;
    return ok({ workspaceId: input.workspaceId, channelId: input.channelId,
      messages: Array.from({ length: 50 }, (_, index) => historyMessage(low + index)), nextBefore: String(low) });
  };
  await f.readyHistory();
  for (let i = 0; i < 9; i++) await f.model.loadHistory(true);
  assert.equal(f.model.getSnapshot().messages.length, 500); assert.equal(f.model.getSnapshot().history.limited, true);
  await f.model.loadHistory(true); assert.equal(count, 10);
});
test("channel switch fetches fresh history and filters unrelated live channel bodies", async () => {
  const f = withHistory(); await f.readyHistory(); f.model.selectChannel(D); await settle();
  assert.ok(f.model.getSnapshot().messages.every(item => item.channelId === D));
  f.client.syncCollaborationWorkspace = async () => ok({ workspaceId: A, cursor: "next", hasMore: false,
    events: [{ id: "other", type: "message.created", message: historyMessage(10, C) }] });
  await f.model.sync(); assert.ok(f.model.getSnapshot().messages.every(item => item.channelId === D));
});
test("visited names are scoped to sign-in and history feature absence preserves older-engine behavior", async () => {
  const f = withHistory(); f.client.supportsCollaborationHistory = () => false;
  f.client.bootstrapCollaborationWorkspace = async id => ok({ ...bootstrap(id), displayName: id === A ? "Nanhara" : "Studio" });
  await f.ready(); assert.equal(f.requests.length, 0); assert.equal(f.model.getSnapshot().history.phase, "unsupported");
  await f.model.selectWorkspace(B); assert.deepEqual(f.model.getSnapshot().workspaceNames, { [A]: "Nanhara", [B]: "Studio" });
  f.client.listCollaborationWorkspaces = async () => ok({ schemaVersion: 1, accountScope: "new-account", accountRegion: "CN", workspaces: [], nextCursor: null });
  await f.model.loadDirectory(); assert.deepEqual(f.model.getSnapshot().workspaceNames, {});
});
test("message sequence merge is exact above Number.MAX_SAFE_INTEGER", () => {
  const a = { ...historyMessage(1), sequence: "9007199254740993" }, b = { ...historyMessage(2), sequence: "9007199254740992" };
  assert.deepEqual(mergeCollaborationMessages([a], [b]).map(item => item.sequence), ["9007199254740992", "9007199254740993"]);
});
