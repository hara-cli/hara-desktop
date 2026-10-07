import assert from "node:assert/strict";
import test from "node:test";
import { HaraClient, supportsTaskApprovals } from "../src/client.ts";

test("task UI is unavailable unless the whole negotiated contract is present", () => {
  const all = {
    supportsFeature: (feature) => feature === "task.approvals.v1",
    supports: (method) => ["approval.reply", "session.task-approval.revoke"].includes(method),
    supportsEvent: (event) => event === "event.task_approval_state",
  };
  assert.equal(supportsTaskApprovals(all), true);
  assert.equal(supportsTaskApprovals(null), false);
  assert.equal(supportsTaskApprovals({ ...all, supportsFeature:()=>false }), false);
  assert.equal(supportsTaskApprovals({ ...all, supportsEvent:()=>false }), false);
  assert.equal(supportsTaskApprovals({ ...all, supports:(method)=>method === "approval.reply" }), false);
  assert.equal(supportsTaskApprovals({ ...all, supports:(method)=>method === "session.task-approval.revoke" }), false);
});

test("actual client sends exact human task choice/revoke, keeps ordinary allow single-action, propagates conflict", async (t) => {
  const oldWebSocket = globalThis.WebSocket, oldWindow = globalThis.window;
  const calls = [];
  const active = { active:true, toolFamilies:["bash"], expiresAt:"2099-01-01T00:15:00Z", canRevoke:true };
  const inactive = { active:false, toolFamilies:[], canRevoke:false };
  const pending = { approvalId:"a1", question:"Review files?", allowAlways:false, allowForTask:true, expiresAt:"2099-01-01T00:00:00Z", taskApproval:{summary:"Review project",toolFamily:"bash",durationMs:900_000} };
  let conflict = false;
  let taskFeature = true;
  class FakeWebSocket {
    OPEN = 1; readyState = 1;
    constructor() { queueMicrotask(() => this.onopen?.()); }
    send(raw) {
      const call = JSON.parse(raw); calls.push(call);
      const result = call.method === "initialize" ? { name:"hara",version:"fixture",protocol:1,cwd:"/fixture",provider:"fixture",model:"fixture",capabilities:{
        methods:["approval.reply","session.task-approval.revoke","session.set-approval"], events:["event.task_approval_state"], features:taskFeature ? ["task.approvals.v1"] : [],
      } } : call.method === "session.resume" ? {sessionId:call.params.sessionId,history:[],pendingApprovals:[pending],taskApprovalState:active}
        : call.method === "session.task-approval.revoke" ? {taskApprovalState:inactive}
          : call.params.forTask ? {taskApprovalState:active} : {};
      queueMicrotask(() => this.onmessage?.({data:JSON.stringify({jsonrpc:"2.0",id:call.id,
        ...(conflict && call.method === "approval.reply" && call.params.forTask ? {error:{code:-32009,message:"task approval is no longer pending"}} : {result}),
      })}));
    }
    close() { this.readyState=3; this.onclose?.(); }
  }
  globalThis.WebSocket = FakeWebSocket; globalThis.window = {setTimeout,clearTimeout};
  const client = new HaraClient();
  t.after(() => {client.close(); globalThis.WebSocket=oldWebSocket; globalThis.window=oldWindow;});
  await client.connect("127.0.0.1",4242); await client.initialize("fixture-token");
  assert.ok(calls[0].params.capabilities.features.includes("task.approvals.v1"));
  assert.equal(supportsTaskApprovals(client), true);
  const commandId = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual((await client.approveForTask("a1","s1",commandId)).taskApprovalState, active);
  assert.deepEqual(calls.at(-1).params, {approvalId:"a1",sessionId:"s1",scope:"session",allow:true,forTask:true,commandId});
  assert.equal(calls.at(-1).params.always, undefined);
  await client.approveForTask("a1","s1",commandId);
  assert.equal(calls.at(-1).params.commandId, commandId, "transport preserves exact retry identity");
  await client.approvalReply("ordinary",true,false);
  assert.deepEqual(calls.at(-1).params, {approvalId:"ordinary",allow:true,always:false});
  assert.equal(calls.at(-1).params.forTask, undefined);
  const resumed = await client.resumeSession("s1", "full-auto");
  assert.deepEqual(calls.at(-1).params, {sessionId:"s1"}, "busy task-aware recovery never mutates approval despite a configured default");
  assert.deepEqual(resumed.pendingApprovals, [pending]);
  assert.deepEqual(resumed.taskApprovalState, active);
  await client.setSessionApproval("s1", "auto-edit");
  assert.deepEqual(calls.at(-1).params, {sessionId:"s1",approval:"auto-edit"}, "an explicitly requested setting change remains separate");
  assert.deepEqual(await client.revokeTaskApproval("s1",commandId), {taskApprovalState:inactive});
  assert.equal(calls.at(-1).method, "session.task-approval.revoke");
  assert.deepEqual(calls.at(-1).params, {sessionId:"s1",commandId});
  conflict = true;
  await assert.rejects(client.approveForTask("a1","s2",commandId), /no longer pending/);
  taskFeature = false;
  const legacy = new HaraClient();
  t.after(() => legacy.close());
  await legacy.connect("127.0.0.1",4243); await legacy.initialize("fixture-token");
  assert.equal(supportsTaskApprovals(legacy), false);
  await legacy.resumeSession("legacy-s1", "auto-edit");
  assert.deepEqual(calls.at(-1).params, {sessionId:"legacy-s1",approval:"auto-edit"}, "legacy engine resume behavior is retained");
});
