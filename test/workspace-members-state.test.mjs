import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceCollaborationModel } from "../src/workspace-collaboration-state.ts";
import { workspaceMemberLabels } from "../src/workspace-member-labels.ts";

const ok = value => ({ ok: true, value }), fail = code => ({ ok: false, error: { code } });
const member = (principalId, displayName = principalId) => ({ principalId, displayName, kind: "human", role: "MEMBER" });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function fixture() {
  const calls = [];
  const client = {
    supportsCollaborationMembers: () => true,
    async listCollaborationWorkspaces() { return ok({ schemaVersion: 1, accountScope: "scope", accountRegion: "CN", nextCursor: null,
      workspaces: ["A", "B"].map(workspaceId => ({ workspaceId, membership: { role: "OWNER", membershipVersion: 1, policyVersion: 1 } })) }); },
    async bootstrapCollaborationWorkspace(workspaceId) { return ok({ workspaceId, displayName: workspaceId, cursor: "live-0",
      membership: { principalId: "self", role: "OWNER", epoch: 1 }, channels: [{ id: "general", slug: "general", displayName: "General" }] }); },
    async listCollaborationMembers(input) { calls.push(input); return ok({ workspaceId: input.workspaceId, members: [member(input.workspaceId + "-person")], nextCursor: "more" }); },
    async sendCollaborationMessage() { return fail("OUTCOME_UNKNOWN"); },
  };
  const model = new WorkspaceCollaborationModel(client, () => "frozen-send");
  return { client, model, calls, async ready() { await model.loadDirectory(); await model.selectWorkspace("A"); await settle(); } };
}
test("selected Workspace loads one authorized member page without touching drafts or live cursor", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("keep");
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0], { workspaceId: "A", accountScope: "scope" });
  assert.equal(f.model.getSnapshot().members.items[0].principalId, "A-person");
  assert.equal(f.model.getSnapshot().bootstrap.cursor, "live-0"); assert.equal(f.model.getSnapshot().draft, "keep");
});
test("older engines do not invent a member capability or request", async () => {
  const f = fixture(); f.client.supportsCollaborationMembers = () => false; await f.ready();
  assert.equal(f.calls.length, 0); assert.equal(f.model.getSnapshot().members.phase, "unsupported");
});
test("member paging deduplicates scoped principals without conflating duplicate names", async () => {
  const f = fixture(); await f.ready();
  f.client.listCollaborationMembers = async input => ok({ workspaceId: input.workspaceId,
    members: [member("A-person", "Renamed"), member("another", "Renamed")], nextCursor: null });
  await f.model.loadMembers(true);
  assert.deepEqual(f.model.getSnapshot().members.items.map(m => m.principalId), ["A-person", "another"]);
  assert.equal(f.model.getSnapshot().members.items[0].displayName, "Renamed");
});
test("A→B→A roster replies cannot reveal an old Workspace snapshot", async () => {
  const f = fixture(), old = deferred(); let count = 0;
  f.client.listCollaborationMembers = async input => ++count === 1 ? old.promise : ok({ workspaceId: input.workspaceId, members: [member("fresh-" + input.workspaceId)], nextCursor: null });
  await f.ready(); await f.model.selectWorkspace("B"); await f.model.selectWorkspace("A"); await settle();
  old.resolve(ok({ workspaceId: "A", members: [member("obsolete")], nextCursor: null })); await settle();
  assert.deepEqual(f.model.getSnapshot().members.items.map(m => m.principalId), ["fresh-A"]);
});
test("roster pagination staleness clears names but retains uncertain send body and identity", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("pending text"); await f.model.send();
  const pending = f.model.getSnapshot().pending;
  f.client.listCollaborationMembers = async () => fail("MEMBERS_STALE"); await f.model.loadMembers(true);
  assert.deepEqual(f.model.getSnapshot().members.items, []); assert.equal(f.model.getSnapshot().members.nextCursor, null);
  assert.deepEqual(f.model.getSnapshot().pending, pending); assert.equal(f.model.getSnapshot().draft, "pending text");
  assert.equal(f.model.getSnapshot().bootstrap.workspaceId, "A");
});
test("read network failure retains page cursor and parallel reads do not overlap", async () => {
  const f = fixture(); await f.ready(); const wait = deferred(); let count = 0;
  f.client.listCollaborationMembers = () => { count++; return wait.promise; };
  const read = f.model.loadMembers(true); await f.model.loadMembers(true); assert.equal(count, 1);
  wait.resolve(fail("UNAVAILABLE")); await read;
  assert.equal(f.model.getSnapshot().members.nextCursor, "more"); assert.equal(f.model.getSnapshot().members.items.length, 1);
});
test("real account/access denial and foreign-scope member page hide all old account data", async () => {
  for (const code of ["SCOPE_CHANGED", "AUTH_REQUIRED", "ACCESS_CHANGED"]) {
    const f = fixture(); await f.ready(); f.model.setDraft("private");
    f.client.listCollaborationMembers = async () => fail(code); await f.model.loadMembers();
    assert.equal(f.model.getSnapshot().workspaceId, null); assert.equal(f.model.getSnapshot().draft, "");
    assert.deepEqual(f.model.getSnapshot().members.items, []);
  }
  const f = fixture(); await f.ready();
  f.client.listCollaborationMembers = async () => ok({ workspaceId: "B", members: [member("foreign")], nextCursor: null });
  await f.model.loadMembers(); assert.equal(f.model.getSnapshot().error, "SCOPE_CHANGED");
});
test("repeated member cursors do not loop and complete refresh removes old names", async () => {
  const f = fixture(); await f.ready();
  await f.model.loadMembers(true); assert.equal(f.model.getSnapshot().members.error, "MEMBERS_STALE");
  f.client.listCollaborationMembers = async input => ok({ workspaceId: input.workspaceId, members: [member("new")], nextCursor: null });
  await f.model.loadMembers(); assert.deepEqual(f.model.getSnapshot().members.items.map(m => m.principalId), ["new"]);
});
test("roster memory is bounded and a full page does not initiate hidden additional reads", async () => {
  const f = fixture(); let reads = 0;
  f.client.listCollaborationMembers = async input => { const start = reads++ * 50;
    return ok({ workspaceId: input.workspaceId, members: Array.from({ length: 50 }, (_, i) => member("p" + (start + i))), nextCursor: String(reads) }); };
  await f.ready(); for (let i = 0; i < 19; i++) await f.model.loadMembers(true);
  assert.equal(f.model.getSnapshot().members.items.length, 1000); assert.equal(f.model.getSnapshot().members.limited, true);
  await f.model.loadMembers(true); assert.equal(reads, 20);
});
test("display labels disambiguate equal names without treating names as principals or markup", () => {
  const labels = workspaceMemberLabels([member("first-principal", "Jeff"), member("other-principal", "jeff"), member("third", "<script>")]);
  assert.equal(labels.get("first-principal"), "Jeff · first-principal");
  assert.equal(labels.get("other-principal"), "jeff · other-principal");
  assert.equal(labels.get("third"), "<script>");
  assert.equal(labels.size, 3);
  const exact = workspaceMemberLabels([member("first-principal", "Jeff"), member("other-principal", "Jeff")]);
  assert.notEqual(exact.get("first-principal"), exact.get("other-principal"));
});
