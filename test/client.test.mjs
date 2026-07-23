import assert from "node:assert/strict";
import test from "node:test";
import { HaraClient } from "../src/client.ts";

test("serve client negotiates lifecycle events and sends expected-turn steering", async (t) => {
  const originalWebSocket = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const requests = [];
  let socket;

  class FakeWebSocket {
    OPEN = 1;
    readyState = 1;
    onopen;
    onerror;
    onclose;
    onmessage;

    constructor(url) {
      assert.equal(url, "ws://127.0.0.1:4242");
      socket = this;
      queueMicrotask(() => this.onopen?.());
    }

    send(raw) {
      const request = JSON.parse(raw);
      requests.push(request);
      const login = {
        id: "weixin-login-1",
        platform: "weixin",
        phase: request.method === "settings.gateways.login.cancel" ? "cancelled" : "waiting",
        qrPayload: request.method === "settings.gateways.login.cancel" ? undefined : "weixin://local-qr",
        qrRevision: 1,
        startedAt: 100,
        updatedAt: 100,
        deadlineAt: 1_000,
      };
      const result = request.method === "initialize" ? {
            name: "hara",
            version: "0.127.0",
            protocol: 1,
            cwd: "/workspace",
            provider: "qwen",
            model: "glm-5",
            capabilities: {
              methods: [
                "session.send",
                "session.steer",
                "artifact.import",
                "artifact.list",
                "settings.gateways.login.start",
                "settings.gateways.login.status",
                "settings.gateways.login.cancel",
              ],
              events: ["event.task_state"],
            },
          } : request.method.startsWith("settings.gateways.login.")
            ? { login }
            : { accepted: true, taskId: "task-1", turnId: "turn-1" };
      queueMicrotask(() => this.onmessage?.({
        data: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
      }));
    }

    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }

  globalThis.WebSocket = FakeWebSocket;
  globalThis.window = { setTimeout, clearTimeout };
  t.after(() => {
    globalThis.WebSocket = originalWebSocket;
    globalThis.window = originalWindow;
  });

  const client = new HaraClient();
  await client.connect("127.0.0.1", 4242);
  await client.initialize("redacted-token");
  assert.equal(client.supports("session.steer"), true);
  assert.equal(client.supports("artifact.import"), true);
  assert.equal(client.supportsEvent("event.task_state"), true);

  await client.steer("session-1", "Use the new title", "turn-1");
  assert.deepEqual(requests.at(-1), {
    jsonrpc: "2.0",
    id: 2,
    method: "session.steer",
    params: {
      sessionId: "session-1",
      text: "Use the new title",
      expectedTurnId: "turn-1",
    },
  });

  await client.importArtifact("/workspace/brief.docx", { title: "Client brief", kind: "document" });
  assert.deepEqual(requests.at(-1), {
    jsonrpc: "2.0",
    id: 3,
    method: "artifact.import",
    params: {
      sourcePath: "/workspace/brief.docx",
      title: "Client brief",
      kind: "document",
    },
  });

  const startedLogin = await client.startGatewayLogin("weixin");
  assert.equal(startedLogin.qrPayload, "weixin://local-qr");
  assert.deepEqual(requests.at(-1), {
    jsonrpc: "2.0",
    id: 4,
    method: "settings.gateways.login.start",
    params: { platform: "weixin" },
  });
  await client.gatewayLoginStatus("weixin", "weixin-login-1");
  assert.deepEqual(requests.at(-1), {
    jsonrpc: "2.0",
    id: 5,
    method: "settings.gateways.login.status",
    params: { platform: "weixin", id: "weixin-login-1" },
  });
  const cancelledLogin = await client.cancelGatewayLogin("weixin", "weixin-login-1");
  assert.equal(cancelledLogin.phase, "cancelled");
  assert.deepEqual(requests.at(-1), {
    jsonrpc: "2.0",
    id: 6,
    method: "settings.gateways.login.cancel",
    params: { platform: "weixin", id: "weixin-login-1" },
  });

  let received;
  client.onEvent = (event) => {
    received = event;
  };
  socket.onmessage({
    data: JSON.stringify({
      jsonrpc: "2.0",
      method: "event.task_state",
      params: {
        version: 1,
        streamId: "serve-1",
        sequence: 12,
        sessionId: "session-1",
        taskId: "task-1",
        turnId: "turn-1",
        objective: "Make the deck",
        state: "waiting",
        taskStatus: "running",
        phase: "approval",
        at: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z",
        checkpoint: { done: 1, total: 2, current: "Approve export" },
        approval: { id: "approval-1", question: "Export the file?" },
      },
    }),
  });
  assert.equal(received.method, "event.task_state");
  assert.equal(received.streamId, "serve-1");
  assert.equal(received.sequence, 12);
  assert.equal(received.state, "waiting");
  assert.equal(received.approval.id, "approval-1");
});
