import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { WorkspaceRpcWaitError } from "../src/workspace-dev-errors.ts";

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
test("pending inheritance is visible without claiming deletion, completion or retrying import",async()=>{
  const f=fixture();f.handlers["workspace.select"]=params=>({...snapshot(params.workspaceId),...(params.workspaceId==="A"?{inheritance:{state:"pending",handoff:false}}:{})});await f.ready();
  assert.equal(f.model.getSnapshot().syncNotice,"ws.notice.inheritancePending");
  assert.equal(f.model.getSnapshot().workspace.agents.length,2);assert.equal(f.calls.some(row=>/import|migration/.test(row.method)),false);
  await f.model.selectWorkspace("B");assert.equal(f.model.getSnapshot().workspace.workspaceId,"B");assert.equal(f.model.getSnapshot().syncNotice,"");
});
test("rolled-back inheritance explains why automatic restart will not repeat it",async()=>{
  const f=fixture();f.handlers["workspace.select"]=()=>({...snapshot(),inheritance:{state:"rolled_back",handoff:false}});await f.ready();
  assert.equal(f.model.getSnapshot().syncNotice,"ws.notice.inheritanceRolledBack");
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
test("unknown outcome verifies the original nonce read-only, never retries a mutation", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("original"); f.handlers["workspace.session.send"] = () => { throw new Error("timeout"); };
  await f.model.send(); assert.equal(f.model.getSnapshot().pendingUnknown, true); f.model.setDraft("new draft"); await f.model.send();
  assert.equal(f.calls.filter(call => call.method === "workspace.session.send").length, 1);
  f.handlers["workspace.session.receipt"] = p => ({ ...p, resourceGeneration: p.expectedGeneration, state: "accepted", runId: "run", reason: null });
  await f.model.send(false, true);
  const sends = f.calls.filter(call => call.method === "workspace.session.send"); assert.equal(sends.length, 1);
  assert.deepEqual(f.calls.find(call => call.method === "workspace.session.receipt").params,
    { workspaceId: "A", expectedGeneration: "generation-1", agentId: "main", requestId: sends[0].params.requestId });
  assert.equal(f.model.getSnapshot().draft, "new draft"); assert.equal(f.model.getSnapshot().pendingUnknown, false);
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
  const refresh = f.model.refresh(), joinedOne = f.model.refresh(), joinedTwo = f.model.refresh();
  first.resolve({ ...snapshot(), conversation: { ...snapshot().conversation, state: "running" } }); await refresh; await tick();
  await Promise.all([joinedOne, joinedTwo]);
  assert.equal(count, 2); assert.equal(f.model.getSnapshot().workspace.conversation.state, "completed");
});
test("coalesced refresh callers wait for the actual snapshot instead of returning against stale state", async () => {
  const f = fixture(); await f.ready(); const wait = defer(); let joined = false;
  f.handlers["workspace.snapshot"] = () => wait.promise;
  const first = f.model.refresh(), second = f.model.refresh().then(() => { joined = true; });
  await tick(); assert.equal(joined, false);
  wait.resolve({ ...snapshot(), label: "actually refreshed" }); await Promise.all([first, second]);
  assert.equal(f.model.getSnapshot().workspace.label, "actually refreshed");
});
function largeOverviewFixture() {
  const f = fixture();
  const roster = [agents[0], ...Array.from({length:142}, (_, index) => ({...agents[1],agentId:`colleague-${index}`}))];
  const large = (workspaceId = 'A', agentId = 'main', generation = 'generation-1') => ({...snapshot(workspaceId,agentId,generation),agents:roster});
  f.handlers['workspace.select'] = p => large(p.workspaceId);
  f.handlers['workspace.snapshot'] = p => large(p.workspaceId,p.agentId);
  return {...f,large};
}
test('unscoped notifications refresh all 142 colleagues with at most four overview reads at once', async () => {
  const f = largeOverviewFixture(); await f.ready();
  let active = 0, peak = 0, reads = 0, revision = 0;
  const staleCard = {id:'obsolete',workspaceId:'A',resourceGeneration:'generation-1',agentId:'colleague-141'};
  f.handlers['workspace.snapshot'] = async p => {
    active++;peak=Math.max(peak,active);reads++;await tick();active--;
    const value=f.large(p.workspaceId,p.agentId);
    return {...value,approvals:revision===0&&p.agentId===staleCard.agentId?[staleCard]:[],
      conversation:{...value.conversation,revision}};
  };
  const initial = await f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true});
  assert.equal(initial.snapshots.length,143);assert.equal(initial.incomplete,false);assert.equal(reads,142);assert.equal(peak,4);
  assert.deepEqual(initial.snapshots.find(row=>row.selectedAgentId===staleCard.agentId).approvals,[staleCard]);
  f.model.workspaceChanged('foreign');await tick();
  await f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true});
  assert.equal(reads,142,'Foreign notifications cannot invalidate this Workspace');
  revision=1;
  for(let i=0;i<200;i++)f.model.workspaceChanged('A');
  await f.model.refresh();await tick();
  const before=reads, latest=await f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true});
  assert.equal(reads-before,142,'A notification without an agent ID must refresh every background colleague');
  assert.equal(latest.snapshots.length,143);assert.equal(latest.incomplete,false);
  assert.ok(latest.snapshots.every(row=>row.conversation.revision===1&&row.approvals.length===0));
  assert.ok(before<=144,'The notification burst needs at most an active refresh and a trailing one');
  assert.equal(peak,4);
  const refreshed=reads;await f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true});
  assert.equal(reads,refreshed,'A completed refresh clears the dirty rows');
  assert.equal(f.calls.some(row=>/\.send$|\.resume$|approval\.respond/.test(row.method)),false);
});
test('targeted background changes refresh only that colleague and retain urgent approval cards', async () => {
  const f=largeOverviewFixture();await f.ready();await f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true});
  const card={id:'urgent',workspaceId:'A',resourceGeneration:'generation-1',agentId:'colleague-141'};
  f.handlers['workspace.snapshot']=p=>({...f.large(p.workspaceId,p.agentId),approvals:p.agentId===card.agentId?[card]:[]});
  f.model.workspaceChanged('foreign',card.agentId);f.model.workspaceChanged('A',card.agentId);await f.model.refresh();await tick();
  const before=f.calls.length, result=await f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true});
  assert.deepEqual(f.calls.slice(before).map(row=>row.params.agentId),[card.agentId]);
  assert.deepEqual(result.snapshots.find(row=>row.selectedAgentId===card.agentId).approvals,[card]);
  assert.equal(result.incomplete,false);
});
for (const agentId of [undefined,'coder']) test(`a ${agentId?'targeted':'Workspace-wide'} change during a coalesced overview read is fetched again`, async () => {
  const f=fixture();await f.ready();const wait=defer();let count=0;
  f.handlers['workspace.snapshot']=p=>p.agentId==='coder'&&++count===1?wait.promise:snapshot(p.workspaceId,p.agentId);
  const first=f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true});
  f.model.workspaceChanged('A',agentId);await f.model.refresh();await tick();
  const joined=f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true});
  wait.resolve({...snapshot('A','coder'),label:'outdated'});await first;
  const latest=await joined;assert.equal(count,2);assert.equal(latest.snapshots.find(row=>row.selectedAgentId==='coder').label,'A');assert.equal(latest.incomplete,false);
});
test('unchanged colleague IDs reuse overview reads while roster metadata remains current', async () => {
  const f=largeOverviewFixture();await f.ready();await f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true});
  const roster=f.large().agents.map(agent=>({...agent,state:'busy',identity:{displayName:`Updated ${agent.agentId}`,title:'Updated title'},
    runtime:{...agent.runtime,label:'Updated runtime',available:false}}));
  f.handlers['workspace.snapshot']=p=>({...f.large(p.workspaceId,p.agentId),agents:roster});
  await f.model.refresh();const before=f.calls.length;
  const result=await f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true});
  assert.equal(f.calls.length,before,'Metadata changes must not reread all private conversations');
  assert.deepEqual(f.model.getSnapshot().roster,roster);assert.deepEqual(result.snapshots[0].agents,roster);
  assert.equal(result.snapshots.length,143);assert.equal(result.incomplete,false);
});
test('adding, reordering and removing colleague IDs invalidate the overview within the same generation', async () => {
  const f=fixture();await f.ready();await f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true});
  const extra={...agents[1],agentId:'ops'};
  for(const [index,roster] of [[...agents,extra],[agents[0],extra,agents[1]],[agents[0],extra]].entries()) {
    f.handlers['workspace.snapshot']=p=>{const value=snapshot(p.workspaceId,p.agentId);return {...value,agents:roster,conversation:{...value.conversation,revision:index+1}};};
    await f.model.refresh();const before=f.calls.length;
    const result=await f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true});
    const expected=roster.filter(agent=>agent.agentId!=='main').map(agent=>agent.agentId);
    assert.deepEqual(f.calls.slice(before).map(row=>row.params.agentId),expected);
    assert.deepEqual(result.snapshots.map(row=>row.selectedAgentId),['main',...expected]);
    assert.ok(result.snapshots.every(row=>row.resourceGeneration==='generation-1'&&row.conversation.revision===index+1));
    assert.equal(result.incomplete,false);
  }
});
test('switching Workspace stops queued overview reads and cannot cache late foreign snapshots', async () => {
  const f=largeOverviewFixture();await f.ready();const wait=defer();let readsA=0;
  f.handlers['workspace.snapshot']=p=>p.workspaceId==='A'?(readsA++,wait.promise):f.large(p.workspaceId,p.agentId);
  const first=f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true});const refused=assert.rejects(first,/Overview view changed/);
  assert.equal(readsA,4);await f.model.selectWorkspace('B');
  wait.resolve(f.large('A','colleague-0'));await refused;assert.equal(readsA,4,'Unsent old-scope reads must stop');
  const latest=await f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true});assert.equal(latest.snapshots.length,143);assert.ok(latest.snapshots.every(row=>row.workspaceId==='B'));
});
test('manual overview refresh invalidates cached rows and failed or foreign reads stay incomplete', async () => {
  const f=fixture();await f.ready();await f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true});
  f.model.invalidateOverview();f.handlers['workspace.snapshot']=p=>snapshot('foreign',p.agentId);
  const result=await f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true});assert.equal(result.incomplete,true);assert.ok(result.snapshots.every(row=>row.workspaceId==='A'));
  f.handlers['workspace.snapshot']=p=>snapshot('A',p.agentId);assert.equal((await f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true})).incomplete,false);
});
test('roster and generation changes discard old overview data instead of retaining removed colleagues', async () => {
  const f=fixture();await f.ready();await f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true});
  const fresh=p=>({...snapshot('A',p.agentId,'generation-2'),agents:[agents[0]]});
  f.handlers['workspace.snapshot']=fresh;await f.model.refresh();
  const result=await f.model.readOverview(f.model.getSnapshot().workspace, {reuseUnchanged:true});
  assert.equal(result.snapshots.length,1);assert.equal(result.snapshots[0].resourceGeneration,'generation-2');assert.equal(result.incomplete,false);
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
  assert.equal(f.calls.some(call => call.method.startsWith("workspace.session.")), false); assert.equal(f.model.getSnapshot().error,"ws.notice.syntheticRequired");
});
test("real mode is bound to native attachment and never accepts a synthetic directory or transcript", async () => {
  const calls = [], handlers = { "workspace.list": () => ({ revision: 1, activeWorkspaceId: null, workspaces: [], syntheticOnly: true }) };
  const rpc = { async request(method, params) { calls.push({ method, params }); return handlers[method](); } };
  const model = new WorkspaceDevModel(rpc, () => "nonce", false);
  await assert.rejects(model.loadDirectory(), { messageKey: "ws.notice.modeMismatch" });
  assert.equal(model.getSnapshot().directory, null);
  handlers["workspace.list"] = () => ({ revision: 1, activeWorkspaceId: null, workspaces: [{ workspaceId: "A", active: true }], syntheticOnly: false, executionMode: "ark-real-key" });
  await model.loadDirectory(); handlers["workspace.select"] = () => snapshot();
  await model.selectWorkspace("A"); assert.equal(model.getSnapshot().workspace, null);
  assert.equal(model.getSnapshot().error,"ws.notice.invalidView");
});
test("transport ACK expiry reconciles an accepted background run with one read, not a failed task or resend", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("hello");
  f.handlers["workspace.session.send"] = () => { throw new WorkspaceRpcWaitError("workspace.session.send"); };
  f.handlers["workspace.session.receipt"] = p => ({ ...p, resourceGeneration: p.expectedGeneration, state: "accepted", runId: "original-run", reason: null });
  f.handlers["workspace.snapshot"] = () => ({ ...snapshot(), conversation: { ...snapshot().conversation, runId: "original-run", state: "running", taskState: "running" } });
  await f.model.send(); const view = f.model.getSnapshot();
  assert.equal(view.workspace.conversation.state, "running"); assert.equal(view.error, ""); assert.equal(view.pendingUnknown, false); assert.equal(view.draft, "");
  assert.equal(f.calls.filter(c => c.method === "workspace.session.send").length, 1);
  assert.equal(f.calls.filter(c => c.method === "workspace.session.receipt").length, 1);
  assert.equal(f.calls.find(c => c.method === "workspace.session.send").params.source, "ui");
  f.handlers["workspace.snapshot"] = () => ({ ...snapshot(), conversation: { ...snapshot().conversation, runId: "original-run", state: "completed", taskState: "completed", completion: { state: "verified" } } });
  await f.model.refresh(); assert.equal(f.model.getSnapshot().workspace.conversation.completion.state, "verified");
  assert.equal(f.calls.filter(c => c.method === "workspace.session.send").length, 1);
});
test("read-only refresh expiry retains known running state and uses a neutral sync status", async () => {
  const f = fixture(); await f.ready();
  f.handlers["workspace.snapshot"] = () => ({ ...snapshot(), conversation: { ...snapshot().conversation, state: "running" } }); await f.model.refresh();
  f.handlers["workspace.snapshot"] = () => { throw new WorkspaceRpcWaitError("workspace.snapshot"); }; await f.model.refresh();
  assert.equal(f.model.getSnapshot().workspace.conversation.state, "running"); assert.equal(f.model.getSnapshot().error, "");
  assert.equal(f.model.getSnapshot().syncNotice, "ws.notice.syncing"); assert.equal(f.calls.some(c => c.method.startsWith("workspace.session.")), false);
  f.handlers["workspace.snapshot"] = () => snapshot(); await f.model.refresh(); assert.equal(f.model.getSnapshot().syncNotice, "");
});
test("unknown receipt and repeated verification never send or auto-resume again", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("original");
  f.handlers["workspace.session.send"] = () => { throw new WorkspaceRpcWaitError("workspace.session.send"); };
  f.handlers["workspace.session.receipt"] = p => ({ ...p, resourceGeneration: p.expectedGeneration, state: "unknown", runId: null, reason: null });
  await f.model.send(); await f.model.verifyPending(); await f.model.send();
  assert.equal(f.model.getSnapshot().pendingUnknown, true); assert.equal(f.model.getSnapshot().draft, "original");
  assert.equal(f.calls.filter(c => c.method === "workspace.session.send").length, 1); assert.equal(f.calls.some(c => c.method === "workspace.session.resume"), false);
});
test("foreign/generation receipts cannot settle or repaint a new view", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("old");
  f.handlers["workspace.session.send"] = () => { throw new WorkspaceRpcWaitError("workspace.session.send"); };
  f.handlers["workspace.session.receipt"] = p => ({ ...p, resourceGeneration: "other-generation", state: "accepted", runId: "foreign", reason: null });
  await f.model.send(); assert.equal(f.model.getSnapshot().pendingUnknown, true); assert.equal(f.model.getSnapshot().draft, "old");
  const wait = defer(); f.handlers["workspace.session.receipt"] = () => wait.promise;
  const check = f.model.verifyPending(); await f.model.selectWorkspace("B"); f.model.setDraft("B draft");
  wait.resolve({ workspaceId: "A", agentId: "main", resourceGeneration: "generation-1", requestId: "nonce-1", state: "accepted", runId: "original", reason: null }); await check;
  assert.equal(f.model.getSnapshot().workspaceId, "B"); assert.equal(f.model.getSnapshot().draft, "B draft");
});
test("exhausted resume button/typed continue has no mutation and startup reads never resume", async () => {
  const f = fixture(); await f.ready();
  f.handlers["workspace.snapshot"] = () => ({ ...snapshot(), conversation: { ...snapshot().conversation, state: "blocked", resumeAdmission: { allowed: false, reason: "run_tokens" } } });
  await f.model.refresh(); await f.model.send(true); f.model.setDraft("/continue"); await f.model.send();
  assert.equal(f.calls.some(c => c.method.startsWith("workspace.session.")), false);
  assert.equal(f.model.getSnapshot().error, "ws.notice.resumeBudget");
});
test("typed continuation and the resume action refuse connection failures without requests, nonces or draft loss", async () => {
  for (const patch of [
    { resumeAdmission: { allowed: false, reason: "connection_model_unavailable" } },
    { resumeAdmission: { allowed: false, reason: "connection_auth_required" } },
    { resumeAdmission: { allowed: false, reason: "connection_quota_exhausted" } },
    { blockReason: "[openai error] 404 The requested model does not support the agent plan feature" },
  ]) {
    const f = fixture();await f.ready();
    f.handlers["workspace.snapshot"] = () => ({ ...snapshot(), conversation: { ...snapshot().conversation, state: "blocked", ...patch } });
    await f.model.refresh();const history = structuredClone(f.model.getSnapshot().workspace.conversation.history);
    await f.model.send(true);f.model.setDraft("/continue");await f.model.send();await f.model.send();
    assert.equal(f.calls.some(c => c.method.startsWith("workspace.session.")), false);
    assert.equal(f.model.getSnapshot().error, "ws.notice.resumeConnection");assert.equal(f.model.getSnapshot().draft, "/continue");
    assert.deepEqual(f.model.getSnapshot().workspace.conversation.history, history);assert.equal(f.model.getSnapshot().pendingUnknown, false);
  }
});
test("explicit server refusal is not marked unknown or retried", async () => {
  const f = fixture(); await f.ready(); f.model.setDraft("/continue");
  f.handlers["workspace.session.resume"] = () => { throw Object.assign(new Error("budget refused"), { code: -32602 }); };
  await f.model.send(); assert.equal(f.model.getSnapshot().pendingUnknown, false); assert.equal(f.model.getSnapshot().draft, "/continue");
  assert.equal(f.calls.filter(c => c.method === "workspace.session.resume").length, 1); assert.equal(f.calls.some(c => c.method === "workspace.session.receipt"), false);
});

test("rate-window quota errors allow one explicit resume instead of being mistaken for exhausted allowance", async () => {
  for (const suffix of ["", " — the provider reported this account allowance or balance is exhausted; select another authorized connection or wait for its reset"]) {
    const f = fixture();await f.ready();
    f.handlers["workspace.snapshot"] = () => ({ ...snapshot(), conversation: { ...snapshot().conversation, state: "blocked",
      blockReason: `[openai error] 429 exceeded your requests per minute quota${suffix}`, resumeAdmission: { allowed: true, reason: null } } });
    await f.model.refresh();assert.equal(f.calls.some(call => call.method.startsWith("workspace.session.")), false);
    f.model.setDraft("/continue");await f.model.send();
    assert.equal(f.calls.filter(call => call.method === "workspace.session.resume").length, 1);
    assert.notEqual(f.model.getSnapshot().error, "ws.notice.resumeConnection");
  }
});
