import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";

const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const agents = ["main", "coder"].map(agentId => ({ agentId, kind: agentId === "main" ? "main" : "colleague", state: "active",
  identity: { displayName: agentId }, runtime: { id: "pi", label: "Pi", available: true } }));
const directory = { revision: 2, activeWorkspaceId: null, syntheticOnly: true, workspaces: ["A", "B"].map(workspaceId => ({ workspaceId, label: workspaceId, active: true, role: "OWNER" })) };
const snapshot = (workspaceId = "A", selectedAgentId = "main", resourceGeneration = "generation-1") => ({ workspaceId, selectedAgentId, resourceGeneration,
  label: workspaceId, agents, syntheticOnly: true, connections: { revision: 1, defaultConnectionId: "synthetic", connections: [] }, approvals: [],
  conversation: { revision: 0, state: "completed", sessionId: `${workspaceId}-${selectedAgentId}`, taskId: null, runId: null, taskState: null,
    objective: "", history: [], pastTaskCount: 0, usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0 }, runUsage: { modelCalls: 0, inputTokens: 0, outputTokens: 0 }, completion: null } });
function fixture() {
  const calls = [], handlers = {}; let serial = 0;
  const rpc = { async request(method, params) { calls.push({ method, params }); if (handlers[method]) return handlers[method](params);
    if (method === "workspace.list") return directory;
    if (["workspace.select", "workspace.snapshot", "workspace.agent.select"].includes(method)) return snapshot(params.workspaceId, params.agentId);
    return {}; } };
  const model = new WorkspaceDevModel(rpc, () => `nonce-${++serial}`);
  return { model, calls, handlers, ready: () => model.selectWorkspace("A") };
}
test("empty startup lists only; never selects the first Workspace", async () => {
  const f = fixture(); await f.model.loadDirectory(); assert.equal(f.model.getSnapshot().workspaceId, null);
  await f.model.selectWorkspace("foreign"); assert.equal(f.calls.some(call => call.method === "workspace.select"), false);
});
test("a delayed directory cannot dispatch a stale Workspace mutation", async () => {
  const f = fixture(), old = defer(); let count = 0;
  f.handlers["workspace.list"] = () => ++count === 1 ? old.promise : directory;
  const first = f.model.selectWorkspace("A"); await f.model.selectWorkspace("B"); old.resolve(directory); await first;
  assert.deepEqual(f.calls.filter(call => call.method === "workspace.select").map(call => call.params.workspaceId), ["B"]);
});
test("A→B→A ignores old snapshots and immediately hides old history", async () => {
  const f = fixture(), old = defer(); let count = 0;
  f.handlers["workspace.select"] = p => p.workspaceId === "A" && ++count === 1 ? old.promise : snapshot(p.workspaceId);
  const first = f.model.selectWorkspace("A"); await tick(); await f.model.selectWorkspace("B");
  const third = f.model.selectWorkspace("A"); assert.equal(f.model.getSnapshot().workspace, null); await third;
  old.resolve({ ...snapshot(), label: "obsolete" }); await first; assert.equal(f.model.getSnapshot().workspace.label, "A");
});
test("Workspace, resource generation and Agent each isolate drafts", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("A main"); await f.model.selectAgent("coder");
  assert.equal(f.model.getSnapshot().draft, ""); f.model.setDraft("A coder"); await f.model.selectWorkspace("B"); f.model.setDraft("B main");
  await f.model.selectWorkspace("A"); assert.equal(f.model.getSnapshot().draft, "A main");
  await f.model.selectAgent("coder"); assert.equal(f.model.getSnapshot().draft, "A coder");
  f.handlers["workspace.snapshot"] = () => snapshot("A", "coder", "new-generation"); await f.model.refresh(); assert.equal(f.model.getSnapshot().draft, "");
});
test("Agent transition keeps roster but never displays the prior transcript", async () => {
  const f = fixture(); await f.ready(); const old = defer(); f.handlers["workspace.agent.select"] = () => old.promise;
  const change = f.model.selectAgent("coder"); assert.deepEqual(f.model.getSnapshot().roster, agents); assert.equal(f.model.getSnapshot().workspace, null);
  old.resolve(snapshot("A", "coder")); await change; assert.equal(f.model.getSnapshot().agentId, "coder");
});
test("typing is local, and double submission sends exactly one nonce", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("hello"); assert.equal(f.calls.some(call => call.method === "workspace.session.send"), false);
  const wait = defer(); f.handlers["workspace.session.send"] = () => wait.promise;
  const first = f.model.send(); await f.model.send(); assert.equal(f.calls.filter(call => call.method === "workspace.session.send").length, 1);
  wait.resolve({ runId: "run" }); await first; assert.equal(f.model.getSnapshot().draft, "");
});
test("unknown outcome retains original message and nonce for explicit retry", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("original"); f.handlers["workspace.session.send"] = () => { throw new Error("timeout"); };
  await f.model.send(); assert.equal(f.model.getSnapshot().pendingUnknown, true); f.model.setDraft("new draft"); await f.model.send();
  assert.equal(f.calls.filter(call => call.method === "workspace.session.send").length, 1);
  f.handlers["workspace.session.send"] = () => ({}); await f.model.send(false, true);
  const sends = f.calls.filter(call => call.method === "workspace.session.send"); assert.deepEqual(sends[1], sends[0]); assert.equal(f.model.getSnapshot().draft, "new draft");
});
test("an in-flight A send cannot repaint B and has no B retry authority", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("A body"); const wait = defer(); f.handlers["workspace.session.send"] = () => wait.promise;
  const first = f.model.send(); await f.model.selectWorkspace("B"); wait.reject(new Error("unknown")); await first;
  assert.equal(f.model.getSnapshot().workspaceId, "B"); assert.equal(f.model.getSnapshot().pendingUnknown, false);
  await f.model.selectWorkspace("A"); assert.equal(f.model.getSnapshot().pendingUnknown, true);
});
test("an old generation send completion cannot clear a new generation draft", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("old"); const wait = defer(); f.handlers["workspace.session.send"] = () => wait.promise;
  const send = f.model.send(); f.handlers["workspace.snapshot"] = () => snapshot("A", "main", "new"); await f.model.refresh(); f.model.setDraft("new");
  wait.resolve({}); await send; assert.equal(f.model.getSnapshot().draft, "new"); assert.equal(f.model.getSnapshot().workspace.resourceGeneration, "new");
});
test("A→B→A settles the exact pending nonce instead of leaving sending stuck", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("original"); const wait = defer(); f.handlers["workspace.session.send"] = () => wait.promise;
  const send = f.model.send(); await f.model.selectWorkspace("B"); await f.model.selectWorkspace("A"); f.model.setDraft("new draft");
  assert.equal(f.model.getSnapshot().sending, true); wait.resolve({}); await send;
  assert.equal(f.model.getSnapshot().sending, false); assert.equal(f.model.getSnapshot().draft, "new draft");
});
test("notifications during refresh are coalesced, not lost at final completion", async () => {
  const f = fixture(); await f.ready(); const first = defer(); let count = 0;
  f.handlers["workspace.snapshot"] = () => ++count === 1 ? first.promise : snapshot();
  const refresh = f.model.refresh(); await f.model.refresh(); await f.model.refresh();
  first.resolve({ ...snapshot(), conversation: { ...snapshot().conversation, state: "running" } }); await refresh; await tick();
  assert.equal(count, 2); assert.equal(f.model.getSnapshot().workspace.conversation.state, "completed");
});
test("stale or foreign approval cards never dispatch", async () => {
  const f = fixture(); await f.ready(); const card = { id: "approval", workspaceId: "A", resourceGeneration: "generation-1", agentId: "main" };
  f.handlers["workspace.snapshot"] = () => ({ ...snapshot(), approvals: [card] }); await f.model.refresh();
  for (const invalid of [{ ...card, workspaceId: "B" }, { ...card, agentId: "coder" }, { ...card, resourceGeneration: "old" }, { ...card, id: "old" }]) await f.model.respond(invalid, true);
  assert.equal(f.calls.some(call => call.method === "workspace.approval.respond"), false);
  await f.model.respond(card, true); assert.equal(f.calls.filter(call => call.method === "workspace.approval.respond").length, 1);
});
test("read-only refresh never sends/resumes; missing connection refuses execution", async () => {
  const f = fixture(); await f.ready(); f.handlers["workspace.snapshot"] = () => ({ ...snapshot(), connections: { revision: 0, defaultConnectionId: null, connections: [] } });
  await f.model.refresh(); f.model.setDraft("hello"); await f.model.send(); await f.model.send(true);
  assert.equal(f.calls.some(call => call.method.startsWith("workspace.session.")), false); assert.ok(f.model.getSnapshot().error.includes("合成連接"));
});
