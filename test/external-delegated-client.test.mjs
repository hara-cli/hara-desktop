import assert from "node:assert/strict";
import test from "node:test";
import { HaraClient, supportsAgentDelegatedInteractions, supportsExternalDelegatedInteractions } from "../src/client.ts";

const methods = ["external.question.reply", "external.approval.reply"];
const events = ["external.question.request", "external.question.resolved", "external.approval.request", "external.approval.resolved"];
const features = ["external.questions.v1", "external.delegated-interaction.v1"];
const agentMethods = ["agent.question.reply", "agent.approval.reply"];
const agentEvents = ["agent.question.request", "agent.question.resolved", "agent.approval.request", "agent.approval.resolved"];
test("colleague cards require their own complete contract, not just native coding-card support", () => {
  const all = { supports: (name) => [...methods, ...agentMethods].includes(name), supportsEvent: (name) => [...events, ...agentEvents].includes(name),
    supportsFeature: (name) => [...features, "agent.delegated-interaction.v1"].includes(name) };
  assert.equal(supportsAgentDelegatedInteractions(all), true);
  assert.equal(supportsAgentDelegatedInteractions(null), false);
  for (const method of agentMethods) assert.equal(supportsAgentDelegatedInteractions({ ...all, supports: (name) => name !== method && all.supports(name) }), false);
  for (const event of agentEvents) assert.equal(supportsAgentDelegatedInteractions({ ...all, supportsEvent: (name) => name !== event && all.supportsEvent(name) }), false);
  assert.equal(supportsAgentDelegatedInteractions({ ...all, supportsFeature: (name) => name !== "agent.delegated-interaction.v1" && all.supportsFeature(name) }), false);
});
test("delegated interaction UI requires complete negotiated contract; legacy and partial engines remain off", () => {
  const all = { supports: (name) => methods.includes(name), supportsEvent: (name) => events.includes(name), supportsFeature: (name) => features.includes(name) };
  assert.equal(supportsExternalDelegatedInteractions(all), true);
  assert.equal(supportsExternalDelegatedInteractions(null), false);
  for (const method of methods) assert.equal(supportsExternalDelegatedInteractions({ ...all, supports: (name) => name !== method && methods.includes(name) }), false);
  for (const event of events) assert.equal(supportsExternalDelegatedInteractions({ ...all, supportsEvent: (name) => name !== event && events.includes(name) }), false);
  for (const feature of features) assert.equal(supportsExternalDelegatedInteractions({ ...all, supportsFeature: (name) => name !== feature && features.includes(name) }), false);
});

test("actual client negotiates support and sends only original identity for question and one-action approval", async (t) => {
  const oldWebSocket = globalThis.WebSocket;
  const oldWindow = globalThis.window;
  const calls = [];
  let rejectApproval = false;
  class FakeWebSocket {
    OPEN = 1; readyState = 1;
    constructor() { queueMicrotask(() => this.onopen?.()); }
    send(raw) {
      const call = JSON.parse(raw); calls.push(call);
      const result = call.method === "initialize" ? { name:"hara",version:"test",protocol:1,cwd:"/fixture",provider:"fixture",model:"fixture",capabilities:{
        methods: [...methods, ...agentMethods], events: [...events, ...agentEvents], features: [...features, "agent.delegated-interaction.v1"],
      } } : {};
      queueMicrotask(() => this.onmessage?.({data:JSON.stringify({jsonrpc:"2.0",id:call.id,
        ...(rejectApproval && call.method === "external.approval.reply" ? {error:{code:-32009,message:"approval expired"}} : {result}),
      })}));
    }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  globalThis.WebSocket = FakeWebSocket;
  globalThis.window = { setTimeout, clearTimeout };
  const client = new HaraClient();
  t.after(() => { client.close(); globalThis.WebSocket = oldWebSocket; globalThis.window = oldWindow; });
  await client.connect("127.0.0.1",4242);
  await client.initialize("fixture-token");
  assert.ok(calls[0].params.capabilities.features.includes("external.delegated-interaction.v1"));
  assert.ok(calls[0].params.capabilities.features.includes("agent.delegated-interaction.v1"));
  assert.equal(supportsAgentDelegatedInteractions(client), true);
  assert.equal(supportsExternalDelegatedInteractions(client),true);
  await client.replyExternalQuestion({questionId:"q1",sessionId:"external-1",turnId:"turn-1",answers:{scope:{answers:["Source"]}},commandId:"cmd-q",
    parentSessionId:"parent-1",agentPath:"/root/code"});
  assert.equal(calls.at(-1).method,"external.question.reply");
  assert.deepEqual(Object.keys(calls.at(-1).params).sort(),["questionId","sessionId","turnId","answers","commandId"].sort());
  await client.replyExternalApproval({approvalId:"a1",sessionId:"external-2",turnId:"turn-2",allow:false,commandId:"cmd-a",
    parentSessionId:"parent-1",agentPath:"/root/code",always:true,forTask:true});
  assert.equal(calls.at(-1).method,"external.approval.reply");
  assert.deepEqual(calls.at(-1).params,{approvalId:"a1",sessionId:"external-2",turnId:"turn-2",allow:false,commandId:"cmd-a"});
  await client.replyAgentQuestion({questionId:"q-agent",sessionId:"colleague-session",turnId:"colleague-turn",answers:{decision:{answers:["B"]}},commandId:"cmd-agent-q",
    parentSessionId:"untrusted-parent",agentPath:"untrusted-path",executorAgentRef:"untrusted-role"});
  assert.equal(calls.at(-1).method,"agent.question.reply");
  assert.deepEqual(Object.keys(calls.at(-1).params).sort(),["questionId","sessionId","turnId","answers","commandId"].sort());
  await client.replyAgentApproval({approvalId:"a-agent",sessionId:"colleague-session",turnId:"colleague-turn",allow:true,commandId:"cmd-agent-a",always:true,forTask:true});
  assert.equal(calls.at(-1).method,"agent.approval.reply");
  assert.deepEqual(calls.at(-1).params,{approvalId:"a-agent",sessionId:"colleague-session",turnId:"colleague-turn",allow:true,commandId:"cmd-agent-a"});
  rejectApproval = true;
  await assert.rejects(client.replyExternalApproval({approvalId:"a1",sessionId:"external-2",turnId:"turn-2",allow:true}),/approval expired/);
  assert.equal(calls.filter((call)=>call.method==="approval.reply").length,0,"never downgrade a delegated approval to legacy authority");
});
