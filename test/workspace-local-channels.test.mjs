import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WorkspaceLocalChannelsModel } from "../src/workspace-local-channels.ts";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { normalizeShellRoute } from "../src/workspace-shell-state.ts";
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const member = `ag_${randomUUID()}`, otherMember = `ag_${randomUUID()}`;
function fixture() {
  const calls = [], handlers = {}, catalogs = new Map(), messages = new Map();
  for (const id of ["A", "B"]) catalogs.set(id, { workspaceId: id, resourceGeneration: `g-${id}`, revision: 0, channels: [] });
  const snapshot = (workspaceId, channelId) => ({ workspaceId, resourceGeneration: `g-${workspaceId}`, channel: catalogs.get(workspaceId).channels.find(row => row.id === channelId),
    revision: 1, state: "idle", messages: messages.get(channelId) ?? [], approvals: [], turns: [] });
  const model = new WorkspaceLocalChannelsModel({ supportsLocalChannels: () => true, async localChannelRequest(method, params) {
    calls.push({ method, params: structuredClone(params) }); if (handlers[method]) return handlers[method](params);
    const catalog = catalogs.get(params.workspaceId);
    if (method === "workspace.channels.list") return structuredClone(catalog);
    if (method === "workspace.channels.create") { catalog.channels.push({ id: params.channelId, name: params.name, memberIds: params.memberIds, createdAt: "2026-10-20T00:00:00Z" }); catalog.revision++; return structuredClone(catalog); }
    if (method === "workspace.channels.update") { Object.assign(catalog.channels.find(row => row.id === params.channelId), { name: params.name, memberIds: params.memberIds }); catalog.revision++; return structuredClone(catalog); }
    if (["workspace.channels.select", "workspace.channels.snapshot"].includes(method)) return structuredClone(snapshot(params.workspaceId, params.channelId));
    if (method === "workspace.channels.send") return { workspaceId: params.workspaceId, resourceGeneration: params.expectedGeneration, channelId: params.channelId, requestId: params.requestId, accepted: true };
    if (method === "workspace.channels.cancel") return { state: "draining" };
    throw new Error(`Unexpected fixture RPC ${method}`);
  } });
  return { model, calls, handlers, catalogs, messages, snapshot };
}
async function create(f, name = "Group", members = [member, otherMember]) { return f.model.create(name, members); }
test("a local channel is created without an account; exact scope and unlimited selected members are forwarded", async () => {
  const f = fixture(); await f.model.bind("A", "g-A"); const members = Array.from({ length: 130 }, () => `ag_${randomUUID()}`);
  const id = await create(f, "All colleagues", members);
  assert.equal(f.model.getSnapshot().channelId, id); assert.equal(f.model.getSnapshot().channel.channel.memberIds.length, 130);
  const call = f.calls.find(row => row.method === "workspace.channels.create");
  assert.equal(call.params.workspaceId, "A"); assert.equal(call.params.expectedGeneration, "g-A"); assert.deepEqual(call.params.memberIds, members);
  assert.equal(f.calls.some(row => /account|collaboration|login/.test(row.method)), false);
});
test("channel drafts survive switching, settings-style refresh and A→B→A without entering another channel", async () => {
  const f = fixture(); await f.model.bind("A", "g-A"); const a = await create(f, "A1"), b = await create(f, "A2");
  f.model.setDraft("channel two draft"); f.model.setRecipients([]); await f.model.select(a); f.model.setDraft("channel one draft"); f.model.setRecipients([member]); await f.model.refresh();
  assert.deepEqual(f.model.getSnapshot().recipientIds, [member]);
  assert.equal(f.model.getSnapshot().draft, "channel one draft"); await f.model.select(b); assert.equal(f.model.getSnapshot().draft, "channel two draft"); assert.deepEqual(f.model.getSnapshot().recipientIds, []);
  await f.model.bind("B", "g-B"); assert.equal(f.model.getSnapshot().catalog.channels.length, 0); assert.equal(f.model.getSnapshot().draft, "");
  await f.model.bind("A", "g-A"); await f.model.select(a); assert.equal(f.model.getSnapshot().draft, "channel one draft"); assert.deepEqual(f.model.getSnapshot().recipientIds, [member]);
});
test("a late channel read cannot replace the current Workspace or channel", async () => {
  const f = fixture(); await f.model.bind("A", "g-A"); const a = await create(f), wait = deferred();
  f.handlers["workspace.channels.snapshot"] = () => wait.promise;
  const refresh = f.model.refresh(); await Promise.resolve(); await f.model.bind("B", "g-B");
  wait.resolve(f.snapshot("A", a)); await refresh; assert.equal(f.model.getSnapshot().channel, null); assert.equal(f.model.getSnapshot().catalog.workspaceId, "B");
});
test("unknown acceptance preserves one nonce and draft; receipt verification never resends", async () => {
  const f = fixture(); await f.model.bind("A", "g-A"); const channelId = await create(f); f.model.setDraft("one message");
  f.handlers["workspace.channels.send"] = () => { throw new Error("connection interrupted"); }; await f.model.send([member]);
  const pending = f.model.getSnapshot().pending; assert.equal(pending.state, "unknown"); assert.equal(f.model.getSnapshot().draft, "one message");
  await f.model.send([otherMember]); assert.equal(f.calls.filter(row => row.method.endsWith(".send")).length, 1);
  f.handlers["workspace.channels.receipt"] = params => ({ workspaceId: "A", resourceGeneration: "g-A", channelId, requestId: params.requestId, state: "unknown" });
  await f.model.verifyPending(); assert.equal(f.model.getSnapshot().pending.requestId, pending.requestId);
  f.handlers["workspace.channels.receipt"] = params => ({ workspaceId: "A", resourceGeneration: "g-A", channelId, requestId: params.requestId, state: "accepted" });
  await f.model.verifyPending(); assert.equal(f.model.getSnapshot().pending, null); assert.equal(f.model.getSnapshot().draft, "");
  assert.equal(f.calls.filter(row => row.method.endsWith(".send")).length, 1);
});
test("accepted A→B→A sends settle their original nonce and never apply a foreign transcript or erase a newer draft", async () => {
  const f = fixture(); await f.model.bind("A", "g-A"); const channelId = await create(f), wait = deferred();
  f.handlers["workspace.channels.send"] = () => wait.promise; f.model.setDraft("original"); const sending = f.model.send([member]);
  const request = f.calls.find(row => row.method.endsWith(".send")).params;
  await f.model.bind("B", "g-B"); await f.model.bind("A", "g-A"); await f.model.select(channelId); f.model.setDraft("newer draft");
  wait.resolve({ workspaceId: "A", resourceGeneration: "g-A", channelId, requestId: request.requestId, accepted: true }); await sending;
  assert.equal(f.model.getSnapshot().draft, "newer draft"); assert.equal(f.model.getSnapshot().pending, null);
});
test("unknown creation verifies the original channel id rather than creating a second one", async () => {
  const f = fixture(); await f.model.bind("A", "g-A"); let saved;
  f.handlers["workspace.channels.create"] = params => { saved = params; f.catalogs.get("A").channels.push({ id: params.channelId, name: params.name, memberIds: params.memberIds, createdAt: "2026-10-20T00:00:00Z" }); throw new Error("lost ACK"); };
  assert.equal(await create(f), null); assert.equal(f.model.getSnapshot().creationUnknown, true);
  assert.equal(await f.model.verifyCreation(), saved.channelId); assert.equal(f.model.getSnapshot().creationUnknown, false);
  assert.equal(f.calls.filter(row => row.method.endsWith(".create")).length, 1);
});
test("explicit refusal keeps the draft and permits a deliberate new request; only original-room approvals can be sent", async () => {
  const f = fixture(); await f.model.bind("A", "g-A"); const channelId = await create(f); f.model.setDraft("retained");
  f.handlers["workspace.channels.send"] = () => { throw Object.assign(new Error("rejected"), { code: -32000 }); };
  await f.model.send([member]); assert.equal(f.model.getSnapshot().pending, null); assert.equal(f.model.getSnapshot().draft, "retained");
  const card = { id: "card", channelId, workspaceId: "A", resourceGeneration: "g-A", agentId: member };
  await f.model.respond(card, true); assert.equal(f.calls.some(row => row.method === "workspace.approval.respond"), false);
  f.handlers["workspace.channels.snapshot"] = () => ({ ...f.snapshot("A", channelId), approvals: [card] }); await f.model.refresh();
  const decision = deferred(); f.handlers["workspace.approval.respond"] = () => decision.promise;
  const approved = f.model.respond(card, true); await f.model.respond(card, true); decision.resolve({ accepted: true }); await approved;
  assert.equal(f.calls.filter(row => row.method === "workspace.approval.respond").length, 1);
});
test("old engines fail closed and Desktop never retargets a stale channel create to another Workspace", async () => {
  const old = new WorkspaceLocalChannelsModel({ supportsLocalChannels: () => false, localChannelRequest() { assert.fail("no channel capability"); } });
  await old.bind("A", "g-A"); assert.equal(old.getSnapshot().supported, false);
  let calls = 0; const main = new WorkspaceDevModel({ request() { calls++; } });
  await assert.rejects(main.localChannelRequest("workspace.channels.create", { workspaceId: "A", expectedGeneration: "g-A" })); assert.equal(calls, 0);
  const id = randomUUID(); assert.equal(normalizeShellRoute(`#channels/${id}`).channelId, id);
  assert.equal(normalizeShellRoute("#channels/../private").section, "chat");
});
