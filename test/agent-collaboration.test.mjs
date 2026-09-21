import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HaraClient } from "../src/client.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

const member = {
  id: "11111111-1111-4111-8111-111111111111",
  path: "/root/reviewer",
  name: "reviewer",
  parentPath: "/root",
  runtime: "hara",
  runtimeGrants: ["codex"],
  status: "completed",
  generation: 1,
  createdAt: "2026-09-21T00:00:00.000Z",
  updatedAt: "2026-09-21T00:00:01.000Z",
  queuedAt: "2026-09-21T00:00:00.000Z",
  pendingMessages: 0,
  hasResult: true,
};

test("Desktop Agent collaboration client preserves runtime grants, command receipts, and live state", async (t) => {
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
      const room = {
        id: "22222222-2222-4222-8222-222222222222",
        name: "release_review",
        ownerPath: "/root",
        participantPaths: ["/root", member.path],
        createdAt: "2026-09-21T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
        messageCount: 0,
      };
      const result = request.method === "initialize"
        ? {
            name: "hara",
            version: "0.178.1",
            protocol: 1,
            cwd: "/workspace",
            provider: "qwen",
            model: "qwen3.8-max",
            capabilities: {
              methods: [
                "session.agents.list",
                "session.agents.spawn",
                "session.agents.message",
                "session.agents.interrupt",
                "session.agent-rooms.create",
                "session.agent-rooms.read",
                "session.agent-rooms.post",
                "session.agent-rooms.close",
              ],
              events: ["event.agent_state"],
              features: [],
            },
          }
        : request.method === "session.agents.list"
          ? { sessionId: request.params.sessionId, agents: [member], rooms: [], budget: { exhausted: false } }
          : request.method === "session.agents.spawn"
            ? { sessionId: request.params.sessionId, agent: { ...member, runtimeGrants: request.params.runtimeGrants ?? [] } }
            : request.method === "session.agents.message"
              ? { sessionId: request.params.sessionId, agent: { ...member, generation: 2 } }
              : request.method === "session.agents.interrupt"
                ? { sessionId: request.params.sessionId, agent: { ...member, status: "stopping" } }
                : request.method === "session.agent-rooms.create" || request.method === "session.agent-rooms.close"
                  ? { sessionId: request.params.sessionId, room }
                  : request.method === "session.agent-rooms.read" || request.method === "session.agent-rooms.post"
                    ? { sessionId: request.params.sessionId, room: { ...room, messages: [] } }
                    : {};
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
  const listed = await client.listSessionAgentTeam("session-1");
  assert.deepEqual(listed.agents[0].runtimeGrants, ["codex"]);

  await client.spawnSessionAgent({
    sessionId: "session-1",
    taskName: "reviewer",
    message: "Review the implementation.",
    runtime: "hara",
    runtimeGrants: ["codex", "claude"],
    workspace: "read-only",
    commandId: "33333333-3333-4333-8333-333333333333",
  });
  assert.deepEqual(requests.at(-1).params, {
    sessionId: "session-1",
    taskName: "reviewer",
    message: "Review the implementation.",
    runtime: "hara",
    runtimeGrants: ["codex", "claude"],
    workspace: "read-only",
    commandId: "33333333-3333-4333-8333-333333333333",
  });

  await client.messageSessionAgent({
    sessionId: "session-1",
    target: member.id,
    message: "Continue with the compatibility review.",
    wake: true,
  });
  assert.match(requests.at(-1).params.commandId, /^[0-9a-f-]{36}$/u);
  assert.equal(requests.at(-1).params.wake, true);

  await client.createAgentRoom({
    sessionId: "session-1",
    name: "release_review",
    members: [member.id],
  });
  assert.match(requests.at(-1).params.commandId, /^[0-9a-f-]{36}$/u);
  await client.postAgentRoom({
    sessionId: "session-1",
    room: "22222222-2222-4222-8222-222222222222",
    message: "Compare the risks.",
    wake: true,
  });
  assert.equal(requests.at(-1).params.wake, true);

  const events = [];
  const unsubscribe = client.onServerEvent((event) => events.push(event));
  socket.onmessage({
    data: JSON.stringify({
      jsonrpc: "2.0",
      method: "event.agent_state",
      params: { sessionId: "session-1", agent: { ...member, status: "working" } },
    }),
  });
  assert.equal(events[0].method, "event.agent_state");
  assert.equal(events[0].agent.status, "working");
  unsubscribe();
  client.close();
});

test("Agent collaboration UI separates persistent identity from direct coding workers", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const surface = readFileSync(`${root}/src/AgentCollaborationSurface.tsx`, "utf8");
  const client = readFileSync(`${root}/src/client.ts`, "utf8");

  assert.match(app, /const loadAgentCollaborationSurface = \(\) => import\("\.\/AgentCollaborationSurface"\)/);
  assert.match(app, /const AgentCollaborationSurface = lazy\(loadAgentCollaborationSurface\)/,
    "the collaboration workbench stays out of the main Desktop bundle");
  assert.match(surface, /runtime === "hara" && runtimeGrants\.length > 0 \? \{ runtimeGrants \} : \{\}/,
    "coding grants belong only to persistent Hara Agents");
  assert.match(surface, /runtime === "hara" && agentRef !== "main"/,
    "a direct coding worker never pretends to inherit a private Hara persona");
  assert.match(surface, /wake: true/,
    "user-authored direct and group messages explicitly wake bounded Agent generations");
  assert.match(surface, /isolated Worktree/,
    "the write boundary is explained where the user grants coding capability");
  assert.match(client, /runtimeGrants\?: Array<Exclude<AgentTeamRuntime, "hara">>/,
    "the typed transport carries per-Agent coding grants");
});
