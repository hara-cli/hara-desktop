import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";

const defer = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
function fixture(supports = true) {
  const calls = [], handlers = {};
  let snapshot = (workspaceId = "A") => ({ workspaceId, resourceGeneration: "generation-1", selectedAgentId: "main", label: workspaceId,
    agents: [{ agentId: "main", kind: "main", configRevision: 1, agentEpoch: 1, state: "active", identity: { displayName: "Hara" }, runtime: { id: "codex", label: "Codex", available: true } }],
    syntheticOnly: true, connections: { revision: 1, defaultConnectionId: "synthetic", connections: [] }, approvals: [],
    conversation: { revision: 7, state: "blocked", sessionId: "retained-session", taskId: "task", runId: "run", taskState: "paused", objective: "Retained task", history: [{ role: "user", content: "Keep this record" }], pastTaskCount: 0,
      usage: { modelCalls: 1, inputTokens: 1000, outputTokens: 20 }, runUsage: { modelCalls: 1, inputTokens: 1000, outputTokens: 20 }, completion: null,
      nativeSession: { runtimeId: "codex", revision: 3, status: "new_session_required", contextTokens: 97020, contextLimit: 96000,
        lastAttempt: { input: 97000, output: 20, cachedInput: 96000 }, lastResetRequestId: null } } });
  const rpc = { supportsCapability: cap => supports && cap === "workspace.native-session.v1", async request(method, params) {
    calls.push({ method, params }); if (handlers[method]) return handlers[method](params);
    if (method === "workspace.list") return { revision: 1, activeWorkspaceId: "A", syntheticOnly: true, workspaces: ["A", "B"].map(workspaceId => ({ workspaceId, label: workspaceId, active: true, role: "OWNER" })) };
    if (["workspace.select", "workspace.snapshot"].includes(method)) return snapshot(params.workspaceId);
    if (method === "workspace.session.new") return { requestId: params.requestId, revision: 4 };
    return {};
  } };
  const model = new WorkspaceDevModel(rpc, randomUUID);
  return { model, calls, handlers, ready: () => model.selectWorkspace("A"), setSnapshot(fn) { const before = snapshot; snapshot = id => fn(before(id)); } };
}

test("new session is a scoped explicit mutation; drafts, task history and usage remain intact without sending", async () => {
  const f=fixture(); await f.ready(); f.model.setDraft("My next task"); const before=structuredClone(f.model.getSnapshot().workspace.conversation);
  await f.model.newNativeSession();
  const writes=f.calls.filter(row=>row.method==="workspace.session.new"); assert.equal(writes.length,1);
  assert.equal(writes[0].params.workspaceId,"A");assert.equal(writes[0].params.expectedGeneration,"generation-1");assert.equal(writes[0].params.agentId,"main");
  assert.equal(writes[0].params.expectedRevision,7);assert.equal(writes[0].params.expectedNativeRevision,3);assert.equal(writes[0].params.approved,true);
  assert.equal("actorId" in writes[0].params,false);assert.equal("threadId" in writes[0].params,false);
  assert.deepEqual(f.model.getSnapshot().workspace.conversation,before);assert.equal(f.model.getSnapshot().draft,"My next task");
  assert.equal(f.calls.some(row=>/workspace.session.(send|resume)/.test(row.method)),false);
  assert.equal(f.model.getSnapshot().syncNotice,"ws.native.newReady");
});

test("old Core, non-Codex, pending interaction and running/draining state cannot reset",async()=>{
  for(const kind of ["old","pi","running","draining","question","async"]){
    const f=fixture(kind!=="old"); f.setSnapshot(w=>{if(kind==="pi")w.agents[0].runtime.id="pi";
      if(["running","draining"].includes(kind))w.conversation.state=kind;
      if(kind==="question")w.conversation.pendingQuestion={id:"q"};if(kind==="async")w.conversation.pendingInteractions=[{kind:"ask_user_question"}];return w;});
    await f.ready(); await f.model.newNativeSession();assert.equal(f.calls.some(row=>row.method==="workspace.session.new"),false,kind);
  }
});

test("duplicate clicks coalesce and an unknown reset blocks send/runtime changes until its exact nonce is read back",async()=>{
  const f=fixture(), pending=defer();f.handlers["workspace.session.new"]=()=>pending.promise;await f.ready();
  const reset=f.model.newNativeSession();await f.model.newNativeSession();assert.equal(f.calls.filter(row=>row.method==="workspace.session.new").length,1);
  pending.reject(new Error("transport disconnected"));await reset;
  assert.equal(f.model.getSnapshot().pendingUnknown,true);f.model.setDraft("No implicit send");await f.model.send();await f.model.newNativeSession();
  await assert.rejects(f.model.setAgentRuntime(f.model.getSnapshot().workspace.agents[0],"pi"));
  assert.equal(f.calls.some(row=>row.method==="workspace.session.send"),false);assert.equal(f.calls.filter(row=>row.method==="workspace.session.new").length,1);
  f.setSnapshot(w=>{w.conversation.nativeSession.lastResetRequestId=randomUUID();return w;});await f.model.verifyPending();assert.equal(f.model.getSnapshot().pendingUnknown,true);
  const requestId=f.calls.find(row=>row.method==="workspace.session.new").params.requestId;
  f.setSnapshot(w=>{w.conversation.nativeSession.lastResetRequestId=requestId;w.conversation.nativeSession.revision=4;w.conversation.nativeSession.status="empty";return w;});
  await f.model.verifyPending();assert.equal(f.model.getSnapshot().pendingUnknown,false);assert.equal(f.model.getSnapshot().syncNotice,"ws.native.newReady");
  assert.equal(f.calls.filter(row=>row.method==="workspace.session.new").length,1);
});

test("late reset response cannot apply another workspace's state and explicit refusal preserves the draft",async()=>{
  const f=fixture(), pending=defer();f.handlers["workspace.session.new"]=()=>pending.promise;await f.ready();const reset=f.model.newNativeSession();
  const requestId=f.calls.find(row=>row.method==="workspace.session.new").params.requestId;await f.model.selectWorkspace("B");f.model.setDraft("B draft");
  pending.resolve({requestId,revision:4});await reset;assert.equal(f.model.getSnapshot().workspaceId,"B");assert.equal(f.model.getSnapshot().draft,"B draft");assert.equal(f.model.getSnapshot().syncNotice,"");
  f.handlers["workspace.session.new"]=()=>{throw Object.assign(new Error("stale revision"),{code:-32000});};await f.model.newNativeSession();
  assert.equal(f.model.getSnapshot().error,"ws.native.resetRejected");assert.equal(f.model.getSnapshot().draft,"B draft");assert.equal(f.model.getSnapshot().pendingUnknown,false);
});
