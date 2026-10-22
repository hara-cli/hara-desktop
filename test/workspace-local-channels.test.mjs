import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WorkspaceLocalChannelsModel } from "../src/workspace-local-channels.ts";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { normalizeShellRoute } from "../src/workspace-shell-state.ts";
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const member = `ag_${randomUUID()}`, otherMember = `ag_${randomUUID()}`;
function fixture({ preferences, catalogs: savedCatalogs, messages: savedMessages, userQuestions = false } = {}) {
  const calls = [], handlers = {}, catalogs = savedCatalogs ?? new Map(), messages = savedMessages ?? new Map();
  if (!savedCatalogs) for (const id of ["A", "B"]) catalogs.set(id, { workspaceId: id, resourceGeneration: `g-${id}`, revision: 0, channels: [] });
  const snapshot = (workspaceId, channelId) => ({ workspaceId, resourceGeneration: `g-${workspaceId}`, channel: catalogs.get(workspaceId).channels.find(row => row.id === channelId),
    revision: 1, state: "idle", messages: messages.get(channelId) ?? [], approvals: [], turns: [] });
  const model = new WorkspaceLocalChannelsModel({ supportsUserQuestions: () => userQuestions, supportsLocalChannels: () => true, async localChannelRequest(method, params) {
    calls.push({ method, params: structuredClone(params) }); if (handlers[method]) return handlers[method](params);
    const catalog = catalogs.get(params.workspaceId);
    if (method === "workspace.channels.list") return structuredClone(catalog);
    if (method === "workspace.channels.create") { catalog.channels.push({ id: params.channelId, name: params.name, memberIds: params.memberIds, createdAt: "2026-10-20T00:00:00Z" }); catalog.revision++; return structuredClone(catalog); }
    if (method === "workspace.channels.update") { Object.assign(catalog.channels.find(row => row.id === params.channelId), { name: params.name, memberIds: params.memberIds }); catalog.revision++; return structuredClone(catalog); }
    if (["workspace.channels.select", "workspace.channels.snapshot"].includes(method)) return structuredClone(snapshot(params.workspaceId, params.channelId));
    if (method === "workspace.channels.send") return { workspaceId: params.workspaceId, resourceGeneration: params.expectedGeneration, channelId: params.channelId, requestId: params.requestId, accepted: true };
    if (method === "workspace.channels.cancel") return { state: "draining" };
    throw new Error(`Unexpected fixture RPC ${method}`);
  } }, undefined, preferences);
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

test("an older catalog read cannot hide a newly created personal channel", async () => {
  const f = fixture(); await f.model.bind("A", "g-A");
  const old = structuredClone(f.catalogs.get("A")), wait = deferred();
  f.handlers["workspace.channels.list"] = () => wait.promise;
  const refreshing = f.model.refresh();
  const id = await create(f);
  wait.resolve(old); await refreshing;
  assert.equal(f.model.getSnapshot().catalog.channels[0]?.id, id);
  assert.equal(f.model.getSnapshot().catalog.revision, 1);
});

test("saving members releases the busy state after switching channels without navigating back", async () => {
  const f = fixture(); await f.model.bind("A", "g-A");
  const a = await create(f, "A1"), b = await create(f, "A2"), wait = deferred();
  await f.model.select(a);
  f.handlers["workspace.channels.update"] = () => wait.promise;
  const saving = f.model.updateMembers("Renamed A1", [member]);
  await f.model.select(b); f.model.setDraft("Keep B draft");
  const catalog = f.catalogs.get("A"); catalog.revision++;
  Object.assign(catalog.channels.find(row => row.id === a), { name: "Renamed A1", memberIds: [member] });
  wait.resolve(structuredClone(catalog));
  assert.equal(await saving, false, "an old dialog must not close or navigate the current room");
  assert.equal(f.model.getSnapshot().saving, false);
  assert.equal(f.model.getSnapshot().catalog.channels.find(row => row.id === a).name, "Renamed A1");
  assert.equal(f.model.getSnapshot().channelId, b);
  assert.equal(f.model.getSnapshot().draft, "Keep B draft");
  assert.equal(await f.model.updateMembers("Renamed B", [otherMember]), true);
});

test("a failed member save after switching channels does not strand or report errors in the other room", async () => {
  const f = fixture(); await f.model.bind("A", "g-A");
  const a = await create(f, "A1"), b = await create(f, "A2"), wait = deferred(); await f.model.select(a);
  f.handlers["workspace.channels.update"] = () => wait.promise;
  const saving = f.model.updateMembers("A1", []); await f.model.select(b);
  wait.reject(Object.assign(new Error("conflict"), { code: -32000 })); await saving;
  assert.equal(f.model.getSnapshot().saving, false);
  assert.equal(f.model.getSnapshot().error, "");
  assert.equal(f.model.getSnapshot().channelId, b);
});

test("a late successful create after A→B→A clears verification without stealing the current selection", async () => {
  const f = fixture(); await f.model.bind("A", "g-A");
  const existing = await create(f, "Existing"), wait = deferred(); let request;
  f.handlers["workspace.channels.create"] = params => { request = params; return wait.promise; };
  const creating = create(f, "New room"); await f.model.bind("B", "g-B"); await f.model.bind("A", "g-A");
  await f.model.select(existing); f.model.setDraft("Still here");
  assert.equal(f.model.getSnapshot().creationUnknown, true);
  const catalog = f.catalogs.get("A"); catalog.revision++;
  catalog.channels.push({ id: request.channelId, name: request.name, memberIds: request.memberIds, createdAt: "2026-10-21T00:00:00Z" });
  wait.resolve(structuredClone(catalog)); assert.equal(await creating, null);
  assert.equal(f.model.getSnapshot().creationUnknown, false);
  assert.equal(f.model.getSnapshot().catalog.channels.length, 2);
  assert.equal(f.model.getSnapshot().channelId, existing);
  assert.equal(f.model.getSnapshot().draft, "Still here");
});

test("an unknown create cannot be resubmitted and verification checks the original member selection", async () => {
  const f = fixture(); await f.model.bind("A", "g-A"); let request;
  f.handlers["workspace.channels.create"] = params => { request = params; throw new Error("lost ACK"); };
  await create(f, "Original", [member, otherMember]);
  await create(f, "Different", []);
  assert.equal(f.calls.filter(row => row.method.endsWith(".create")).length, 1);
  const catalog = f.catalogs.get("A"); catalog.revision++;
  catalog.channels.push({ id: request.channelId, name: request.name, memberIds: [member], createdAt: "2026-10-21T00:00:00Z" });
  assert.equal(await f.model.verifyCreation(), null);
  assert.equal(f.model.getSnapshot().creationUnknown, true);
  catalog.revision++; catalog.channels[0].memberIds = [otherMember, member];
  assert.equal(await f.model.verifyCreation(), request.channelId);
  assert.equal(f.model.getSnapshot().creationUnknown, false);
});

test("all-reply mode includes newly added colleagues without limiting membership; explicit subsets and notes stay explicit", async () => {
  const f = fixture(); await f.model.bind("A", "g-A"); await create(f);
  const many = [member, otherMember, ...Array.from({ length: 140 }, () => `ag_${randomUUID()}`)];
  assert.equal(await f.model.updateMembers("Many colleagues", many), true);
  assert.deepEqual(f.model.getSnapshot().recipientIds, many);
  f.model.setRecipients([otherMember]);
  assert.equal(await f.model.updateMembers("Subset", [otherMember, ...many.slice(2)]), true);
  assert.deepEqual(f.model.getSnapshot().recipientIds, [otherMember]);
  f.model.setRecipients([]); await f.model.updateMembers("Personal note", many);
  assert.deepEqual(f.model.getSnapshot().recipientIds, []);
  f.model.setDraft("Only my note"); await f.model.send([]);
  assert.deepEqual(f.calls.find(row => row.method.endsWith(".send")).params.recipientIds, []);
  assert.equal(f.calls.some(row => /account|login|collaboration/.test(row.method)), false);
});

test("a snapshot started before a member save cannot revert the saved room or responder list", async () => {
  const f = fixture(); await f.model.bind("A", "g-A"); const id = await create(f), wait = deferred();
  const old = structuredClone(f.snapshot("A", id));
  let started; const ready = new Promise(resolve => { started = resolve; }); let reads = 0;
  f.handlers["workspace.channels.snapshot"] = () => { if (++reads === 1) { started(); return wait.promise; } return structuredClone(f.snapshot("A", id)); };
  const refreshing = f.model.refresh(); await ready;
  const third = `ag_${randomUUID()}`, saving = f.model.updateMembers("New name", [member, otherMember, third]);
  wait.resolve(old); await Promise.all([refreshing, saving]);
  assert.equal(f.model.getSnapshot().channel.channel.name, "New name");
  assert.deepEqual(f.model.getSnapshot().channel.channel.memberIds, [member, otherMember, third]);
  assert.deepEqual(f.model.getSnapshot().recipientIds, [member, otherMember, third]);
});

test("a late unknown send after A→B→A can be verified without replaying or losing a newer draft", async () => {
  const f = fixture(); await f.model.bind("A", "g-A"); const id = await create(f), wait = deferred();
  f.handlers["workspace.channels.send"] = () => wait.promise;
  f.model.setDraft("Original message"); const sending = f.model.send([member]);
  await f.model.bind("B", "g-B"); await f.model.bind("A", "g-A"); await f.model.select(id); f.model.setDraft("Newer draft");
  wait.reject(new Error("lost acceptance")); await sending;
  assert.equal(f.model.getSnapshot().pending.state, "unknown");
  const pendingId = f.model.getSnapshot().pending.requestId;
  f.handlers["workspace.channels.receipt"] = params => ({ workspaceId: "A", resourceGeneration: "g-A", channelId: id, requestId: params.requestId, state: "accepted" });
  await f.model.verifyPending();
  assert.equal(f.model.getSnapshot().pending, null); assert.equal(f.model.getSnapshot().draft, "Newer draft");
  assert.equal(f.calls.find(row => row.method.endsWith(".receipt")).params.requestId, pendingId);
  assert.equal(f.calls.filter(row => row.method.endsWith(".send")).length, 1);
});

test("a late explicit creation refusal clears verification after returning to the original Workspace", async () => {
  const f = fixture(); await f.model.bind("A", "g-A"); const wait = deferred();
  f.handlers["workspace.channels.create"] = () => wait.promise;
  const creating = create(f); await f.model.bind("B", "g-B"); await f.model.bind("A", "g-A");
  wait.reject(Object.assign(new Error("conflict"), { code: -32000 })); await creating;
  assert.equal(f.model.getSnapshot().creationUnknown, false);
  assert.equal(f.model.getSnapshot().saving, false);
  delete f.handlers["workspace.channels.create"];
  assert.ok(await create(f, "A deliberate new channel"));
});

test("all-reply and explicit note preferences stay channel-scoped across membership refresh and Workspace switching", async () => {
  const f = fixture(); await f.model.bind("A", "g-A");
  const a = await create(f, "All"), b = await create(f, "Notes"); f.model.setRecipients([]);
  await f.model.bind("B", "g-B"); await f.model.bind("A", "g-A");
  const third = `ag_${randomUUID()}`, catalog = f.catalogs.get("A"); catalog.revision++;
  for (const row of catalog.channels) row.memberIds.push(third);
  await f.model.refresh(); await f.model.select(a);
  assert.deepEqual(f.model.getSnapshot().recipientIds, [member, otherMember, third]);
  await f.model.select(b); assert.deepEqual(f.model.getSnapshot().recipientIds, []);
});

function memoryPreferences() {
  const data = new Map(), writes = [];
  return { data, writes, load(workspaceId, generation) { return structuredClone(data.get(JSON.stringify([workspaceId, generation]))
    ?? { selectedChannelId: null, recipients: {}, pending: {}, creation: null }); },
  save(workspaceId, generation, value) { writes.push(value.selectedChannelId); data.set(JSON.stringify([workspaceId, generation]), structuredClone(value)); } };
}
test("a cold renderer restores the personal channel and explicit responders without an account or message cache", async () => {
  const preferences = memoryPreferences(), f = fixture({ preferences }); await f.model.bind("A", "g-A");
  const members = Array.from({ length: 142 }, () => `ag_${randomUUID()}`), id = await create(f, "Personal", members);
  f.model.setRecipients([members[0], members[141]]); f.model.setDraft("DO_NOT_CACHE_THIS_MESSAGE");
  const cold = fixture({ preferences, catalogs: f.catalogs, messages: f.messages }); await cold.model.bind("A", "g-A");
  assert.equal(cold.model.preferredChannelId(), id); await cold.model.select(id);
  assert.deepEqual(cold.model.getSnapshot().recipientIds, [members[0], members[141]]);
  assert.equal(cold.model.getSnapshot().draft, "");
  assert.equal(JSON.stringify([...preferences.data.values()]).includes("DO_NOT_CACHE_THIS_MESSAGE"), false);
  assert.equal(cold.calls.some(row => /account|login|collaboration|\.send$/.test(row.method)), false);
  await cold.model.bind("B", "g-B"); assert.equal(cold.model.preferredChannelId(), null);
  await cold.model.bind("A", "new-generation"); assert.equal(cold.model.preferredChannelId(), null);
});
test("deliberately leaving a channel does not restore it after restarting", async () => {
  const preferences = memoryPreferences(), f = fixture({ preferences }); await f.model.bind("A", "g-A"); await create(f);
  f.model.clearSelection();
  const cold = fixture({ preferences, catalogs: f.catalogs }); await cold.model.bind("A", "g-A");
  assert.equal(cold.model.preferredChannelId(), null);
});
test("a cold renderer verifies an in-flight nonce without storing its body or repeating the send", async () => {
  const preferences = memoryPreferences(), f = fixture({ preferences }); await f.model.bind("A", "g-A"); const id = await create(f), wait = deferred();
  f.handlers["workspace.channels.send"] = () => wait.promise;
  f.model.setDraft("PRIVATE_BODY_MUST_NOT_PERSIST"); const sending = f.model.send([member]);
  const original = f.calls.find(row => row.method.endsWith(".send")).params;
  const cold = fixture({ preferences, catalogs: f.catalogs });
  cold.handlers["workspace.channels.receipt"] = p => ({ workspaceId: "A", resourceGeneration: "g-A", channelId: id, requestId: p.requestId, state: "unknown" });
  await cold.model.bind("A", "g-A"); await cold.model.select(id);
  assert.equal(cold.model.getSnapshot().pending?.state, "unknown");
  assert.equal(cold.model.getSnapshot().pending.requestId, original.requestId);
  assert.equal(JSON.stringify([...preferences.data.values()]).includes("PRIVATE_BODY_MUST_NOT_PERSIST"), false);
  cold.handlers["workspace.channels.receipt"] = p => ({ workspaceId: "A", resourceGeneration: "g-A", channelId: id, requestId: p.requestId, state: "accepted" });
  await cold.model.verifyPending(); assert.equal(cold.model.getSnapshot().pending, null);
  assert.equal(cold.calls.some(row => row.method.endsWith(".send")), false);
  wait.resolve({ workspaceId: "A", resourceGeneration: "g-A", channelId: id, requestId: original.requestId, accepted: true }); await sending;
});
test("unknown channel creation survives a renderer restart and can only verify its original identity", async () => {
  const preferences = memoryPreferences(), f = fixture({ preferences }); await f.model.bind("A", "g-A"); let original;
  f.handlers["workspace.channels.create"] = p => { original = p; f.catalogs.get("A").revision++;
    f.catalogs.get("A").channels.push({ id: p.channelId, name: p.name, memberIds: p.memberIds, createdAt: "2026-10-21T00:00:00Z" }); throw new Error("lost receipt"); };
  await create(f, "Accepted before restart");
  const cold = fixture({ preferences, catalogs: f.catalogs }); await cold.model.bind("A", "g-A");
  assert.equal(cold.model.getSnapshot().creationUnknown, true);
  assert.equal(await cold.model.verifyCreation(), original.channelId);
  assert.equal(cold.calls.some(row => row.method.endsWith(".create")), false);
});
test("a refresh arriving during a read queues a fresh snapshot instead of losing the accepted turn", async () => {
  const f = fixture(); await f.model.bind("A", "g-A"); const id = await create(f), wait = deferred(), entered = deferred(), accepted = deferred();
  const old = structuredClone(f.snapshot("A", id)); let reads = 0;
  f.handlers["workspace.channels.snapshot"] = () => { if (++reads === 1) { entered.resolve(); return wait.promise; } return structuredClone(f.snapshot("A", id)); };
  f.handlers["workspace.channels.send"] = p => { f.messages.set(id, [{ id: p.requestId, turnId: p.requestId, agentId: null, displayName: "", message: { role: "user", content: p.message } }]);
    return { workspaceId: "A", resourceGeneration: "g-A", channelId: id, requestId: p.requestId, accepted: true }; };
  const refreshing = f.model.refresh(); await entered.promise;
  f.model.setDraft("Accepted while old snapshot is in flight");
  const unsubscribe = f.model.subscribe(() => { if (!f.model.getSnapshot().pending && f.calls.some(row => row.method.endsWith(".send"))) accepted.resolve(); });
  const sending = f.model.send([]); await accepted.promise; wait.resolve(old); await Promise.all([sending, refreshing]); unsubscribe();
  assert.ok(reads >= 2); assert.equal(f.model.getSnapshot().channel.messages.length, 1);
  assert.equal(f.calls.filter(row => row.method.endsWith(".send")).length, 1);
});
test("older conversation revisions cannot roll history back; streaming updates at the same revision remain visible", async () => {
  const f = fixture(); await f.model.bind("A", "g-A"); const id = await create(f);
  const message = text => ({ id: "reply", turnId: "turn", agentId: member, displayName: "Colleague", message: { role: "assistant", text, tools: [] } });
  f.handlers["workspace.channels.snapshot"] = () => ({ ...f.snapshot("A", id), revision: 5, messages: [message("Live text")] }); await f.model.refresh();
  f.handlers["workspace.channels.snapshot"] = () => ({ ...f.snapshot("A", id), revision: 5, messages: [message("Live text continued")] }); await f.model.refresh();
  assert.equal(f.model.getSnapshot().channel.messages[0].message.text, "Live text continued");
  f.handlers["workspace.channels.snapshot"] = () => ({ ...f.snapshot("A", id), revision: 4, messages: [] }); await f.model.refresh();
  assert.equal(f.model.getSnapshot().channel.revision, 5); assert.equal(f.model.getSnapshot().channel.messages.length, 1);
});

test("typing and unchanged membership refreshes do not repeatedly rewrite large recovery records", async () => {
  const preferences = memoryPreferences(), f = fixture({ preferences }); await f.model.bind("A", "g-A");
  await create(f, "Large", Array.from({ length: 1001 }, () => `ag_${randomUUID()}`));
  const before = preferences.writes.length;
  for (let index = 0; index < 100; index++) f.model.setDraft(`Draft ${index}`);
  for (let index = 0; index < 10; index++) await f.model.refresh();
  assert.equal(preferences.writes.length, before);
  assert.equal(f.model.getSnapshot().draft, "Draft 99");
});

test("an unavailable preference adapter cannot block creating or sending in the current session", async () => {
  const f = fixture({ preferences: { load() { throw new Error("blocked"); }, save() { throw new Error("full"); } } });
  await f.model.bind("A", "g-A"); assert.ok(await create(f)); f.model.setDraft("Local message"); await f.model.send([]);
  assert.equal(f.model.getSnapshot().pending, null); assert.equal(f.model.getSnapshot().draft, "");
  assert.equal(f.calls.filter(row => row.method.endsWith(".send")).length, 1);
});

test("history reading windows survive refresh and channel switches, isolated by Workspace generation", async () => {
  const preferences = memoryPreferences(), f = fixture({ preferences }); await f.model.bind("A", "g-A");
  const first = await create(f), second = await create(f, "Second");
  f.model.setHistoryAnchor("second-page"); await f.model.select(first); f.model.setHistoryAnchor("first-page"); await f.model.refresh();
  assert.equal(f.model.getSnapshot().historyAnchor, "first-page");
  await f.model.select(second); assert.equal(f.model.getSnapshot().historyAnchor, "second-page");
  await f.model.bind("B", "g-B"); assert.equal(f.model.getSnapshot().historyAnchor, null);
  await f.model.bind("A", "g-A"); await f.model.select(first); assert.equal(f.model.getSnapshot().historyAnchor, "first-page");
  await f.model.bind("A", "new-generation"); assert.equal(f.model.getSnapshot().historyAnchor, null);
  assert.equal(JSON.stringify([...preferences.data.values()]).includes("first-page"), false, "reading position is transient, not another message cache");
});

test("only an explicit own send returns a history window to latest; typing and reads keep it", async () => {
  const f = fixture(); await f.model.bind("A", "g-A"); await create(f); f.model.setHistoryAnchor("older");
  f.model.setDraft("Own message"); await f.model.refresh(); assert.equal(f.model.getSnapshot().historyAnchor, "older");
  await f.model.send([]); assert.equal(f.model.getSnapshot().historyAnchor, null);
});


test("channel answers bind one colleague and original question without a normal send or draft loss", async () => {
  const f = fixture({ userQuestions: true }); await f.model.bind("A", "g-A"); const id = await create(f);
  const q = { id: randomUUID(), reason: "explicit", question: "Which target?", options: ["Beta"], taskId: "task", runId: "run" };
  f.handlers["workspace.channels.snapshot"] = () => ({ ...f.snapshot("A", id), questions: [{ agentId: member, displayName: "Alpha", conversation: {
    state: "awaiting_user", taskState: "paused", pendingQuestion: q, resumeAdmission: { allowed: true, reason: null } } }] });
  f.handlers["workspace.channels.answer"] = params => ({ workspaceId: "A", resourceGeneration: "g-A", channelId: id, requestId: params.requestId, accepted: true });
  await f.model.refresh(); f.model.setDraft("Keep this separate message");
  await f.model.send([member]); assert.equal(f.calls.some(row => row.method === "workspace.channels.send"), false);
  await f.model.answer(otherMember, q.id, "Beta"); assert.equal(f.calls.some(row => row.method === "workspace.channels.answer"), false);
  await f.model.answer(member, q.id, "Beta");
  const call = f.calls.find(row => row.method === "workspace.channels.answer");
  assert.equal(call.params.channelId, id); assert.equal(call.params.agentId, member); assert.equal(call.params.questionId, q.id);
  assert.equal(call.params.message, "Beta"); assert.equal(call.params.workspaceId, "A"); assert.equal(call.params.expectedGeneration, "g-A");
  assert.equal(f.model.getSnapshot().draft, "Keep this separate message");
  await f.model.bind("B", "g-B"); await f.model.answer(member, q.id, "Beta");
  assert.equal(f.calls.filter(row => row.method === "workspace.channels.answer").length, 1);
});

test("a pending channel pause remains busy across a Workspace round trip", async () => {
  const f = fixture({ userQuestions: true }); await f.model.bind("A", "g-A"); const id = await create(f);
  const q = { id: randomUUID(), reason: "explicit", question: "Which target?", options: [], taskId: "task", runId: "run" };
  f.handlers["workspace.channels.snapshot"] = () => ({ ...f.snapshot("A", id), questions: [{ agentId: member, displayName: "Alpha", conversation: {
    state: "awaiting_user", taskState: "paused", pendingQuestion: q, resumeAdmission: { allowed: true, reason: null } } }] });
  const wait = deferred(); f.handlers["workspace.channels.pause-question"] = () => wait.promise;
  await f.model.refresh(); const pending = f.model.pauseQuestion(member, q.id);
  try {
    await f.model.bind("B", "g-B"); await f.model.bind("A", "g-A"); await f.model.select(id); await f.model.refresh();
    assert.equal(f.model.getSnapshot().saving, true, "returning to the channel must retain its scoped pause");
    await f.model.answer(member, q.id, "Beta");
    assert.equal(f.calls.some(call => call.method === "workspace.channels.answer"), false);
  } finally { wait.resolve({ state: "paused" }); await pending; }
  assert.equal(f.model.getSnapshot().saving, false);
});

test("a pause in another channel neither blocks this channel nor clears its pending message", async () => {
  const f = fixture({ userQuestions: true }); await f.model.bind("A", "g-A"); const first = await create(f), second = await create(f, "Second");
  const q = { id: randomUUID(), reason: "explicit", question: "Which target?", options: [], taskId: "task", runId: "run" };
  f.handlers["workspace.channels.snapshot"] = params => ({ ...f.snapshot("A", params.channelId), questions: params.channelId === first ? [{ agentId: member, displayName: "Alpha", conversation: {
    state: "awaiting_user", taskState: "paused", pendingQuestion: q, resumeAdmission: { allowed: true, reason: null } } }] : [] });
  const wait = deferred(), send = deferred();
  f.handlers["workspace.channels.pause-question"] = () => wait.promise;
  f.handlers["workspace.channels.send"] = async params => { await send.promise; return { workspaceId: "A", resourceGeneration: "g-A", channelId: second, requestId: params.requestId, accepted: true }; };
  await f.model.select(first); await f.model.refresh(); const pausing = f.model.pauseQuestion(member, q.id);
  await f.model.select(second); assert.equal(f.model.getSnapshot().saving, false);
  f.model.setDraft("Independent channel work"); const sending = f.model.send([member]);
  try {
    assert.equal(f.model.getSnapshot().pending.state, "sending");
    wait.resolve({ state: "paused" }); await pausing;
    assert.equal(f.model.getSnapshot().channelId, second); assert.equal(f.model.getSnapshot().pending.state, "sending");
  } finally { wait.resolve({ state: "paused" }); send.resolve(); await Promise.all([pausing, sending]); }
});
