import assert from "node:assert/strict";
import test from "node:test";
import { HaraClient, supportsExternalUserQuestions } from "../src/client.ts";

test("external question UI requires the entire negotiated contract, not a partial method", () => {
  const all = {
    supports: (name) => name === "external.question.reply",
    supportsEvent: (name) => ["external.question.request", "external.question.resolved"].includes(name),
    supportsFeature: (name) => name === "external.questions.v1",
  };
  assert.equal(supportsExternalUserQuestions(all), true);
  assert.equal(supportsExternalUserQuestions(null), false);
  assert.equal(supportsExternalUserQuestions({ ...all, supportsFeature: () => false }), false);
  assert.equal(supportsExternalUserQuestions({ ...all, supports: () => false }), false);
  assert.equal(supportsExternalUserQuestions({ ...all, supportsEvent: (name) => name === "external.question.request" }), false);
});

test("the actual client negotiates question support and sends fully bound reply/cancellation RPCs", async (t) => {
  const oldWebSocket = globalThis.WebSocket;
  const oldWindow = globalThis.window;
  const calls = [];
  let rejectReply = false;
  class FakeWebSocket {
    OPEN = 1; readyState = 1;
    constructor() { queueMicrotask(() => this.onopen?.()); }
    send(raw) {
      const call = JSON.parse(raw); calls.push(call);
      const result = call.method === "initialize" ? { name: "hara", version: "test", protocol: 1, cwd: "/fixture", provider: "fixture", model: "fixture", capabilities: {
        methods: ["external.question.reply"], events: ["external.question.request", "external.question.resolved"], features: ["external.questions.v1"],
      } } : call.method === "session.resume" ? { sessionId: "s1", history: [], pendingApprovals: [] } : {};
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", id: call.id,
        ...(rejectReply && call.method === "external.question.reply" ? { error: { code: -32009, message: "question is no longer pending" } } : { result }),
      }) }));
    }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  globalThis.WebSocket = FakeWebSocket;
  globalThis.window = { setTimeout, clearTimeout };
  const client = new HaraClient();
  t.after(() => { client.close(); globalThis.WebSocket = oldWebSocket; globalThis.window = oldWindow; });
  await client.connect("127.0.0.1", 4242);
  await client.initialize("fixture-token");
  assert.ok(calls[0].params.capabilities.features.includes("external.questions.v1"));
  assert.equal(supportsExternalUserQuestions(client), true);
  const reply = { questionId: "00000000-0000-4000-8000-000000000001", sessionId: "external:s1", turnId: "turn1", answers: { direction: { answers: ["Inspect"] } }, commandId: "00000000-0000-4000-8000-000000000002" };
  await client.replyExternalQuestion(reply);
  assert.deepEqual(calls.at(-1).params, reply);
  assert.equal(calls.at(-1).method, "external.question.reply");
  await client.replyExternalQuestion({ ...reply, answers: {}, cancelled: true });
  assert.deepEqual(calls.at(-1).params.answers, {});
  assert.equal(calls.at(-1).params.cancelled, true);
  assert.deepEqual((await client.resumeSession("s1")).pendingApprovals, []);
  rejectReply = true;
  await assert.rejects(client.replyExternalQuestion(reply), /question is no longer pending/);
});
