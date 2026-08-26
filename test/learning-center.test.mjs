import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HaraClient } from "../src/client.ts";

const root = new URL("..", import.meta.url).pathname;

test("Desktop negotiates every learning RPC and preserves typed user-dependency evidence", async (t) => {
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

    constructor() {
      socket = this;
      queueMicrotask(() => this.onopen?.());
    }

    send(raw) {
      const request = JSON.parse(raw);
      requests.push(request);
      const result = request.method === "initialize"
        ? {
            name: "hara",
            version: "0.150.0",
            protocol: 1,
            cwd: "/workspace",
            provider: "deepseek",
            model: "deepseek-chat",
            capabilities: {
              methods: ["learning.list", "learning.review", "learning.submit", "learning.sync"],
              events: ["event.task_state"],
              features: ["learning.review.v1", "learning.organization-review.v1", "agent.action-ownership.v1"],
            },
          }
        : request.method === "learning.list"
          ? {
              learnings: [],
              summary: { total: 0, pending: 0, approved: 0, stable: 0 },
              organization: { active: true, profileId: "org-a", submitAvailable: true, syncAvailable: true },
            }
          : request.method === "learning.review"
            ? { learning: { id: request.params.id, revision: request.params.expectedRevision + 1 } }
            : request.method === "learning.submit"
              ? { remoteId: "remote-a", status: "submitted", revision: 2, candidate: { id: request.params.id } }
              : { version: 7, learnings: [] };
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
  assert.equal(client.supportsFeature("agent.action-ownership.v1"), true);

  await client.listLearnings("/workspace");
  assert.deepEqual(requests.at(-1).params, { cwd: "/workspace", limit: 1_000 });
  await client.reviewLearning("learning-a", "approve", 3, "/workspace");
  assert.deepEqual(requests.at(-1).params, {
    id: "learning-a",
    decision: "approve",
    expectedRevision: 3,
    cwd: "/workspace",
  });
  await client.submitOrganizationLearning("learning-a", "/workspace");
  assert.equal(requests.at(-1).method, "learning.submit");
  await client.syncOrganizationLearnings("/workspace");
  assert.equal(requests.at(-1).method, "learning.sync");

  const events = [];
  client.onEvent = (event) => events.push(event);
  socket.onmessage({ data: JSON.stringify({
    method: "event.task_state",
    params: {
      version: 1,
      sessionId: "session-a",
      taskId: "task-a",
      state: "blocked",
      updatedAt: "2026-08-22T00:00:00.000Z",
      checkpoint: {
        completed: [],
        pending: [],
        verification: [],
        completion: {
          state: "awaiting_user",
          evidence: ["Deployment token is absent."],
          dependency: {
            kind: "missing_secret",
            detail: "A deployment credential is required.",
            evidence: ["No credential is configured for this target."],
          },
        },
      },
    },
  }) });
  assert.equal(events[0].checkpoint.completion.dependency.kind, "missing_secret");
  assert.deepEqual(events[0].checkpoint.completion.dependency.evidence, ["No credential is configured for this target."]);
});

test("Learning Center is lazy, review-gated, bounded, and globally locks mutations", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const center = readFileSync(`${root}/src/LearningCenter.tsx`, "utf8");
  const client = readFileSync(`${root}/src/client.ts`, "utf8");
  assert.match(app, /const loadLearningCenter = \(\) => import\("\.\/LearningCenter"\)/);
  assert.match(app, /const LearningCenter = lazy\(loadLearningCenter\)/);
  assert.match(center, /item\.evidence\.slice\(-3\)\.reverse\(\)/, "only a bounded receipt preview is rendered");
  assert.match(center, /item\.stability !== "stable" \|\| !organizationSubmitAvailable/);
  assert.match(center, /busy=\{busy !== null\}/, "one review locks every row against racing decisions");
  assert.match(center, /setBusy\("refresh"\)/);
  assert.match(client, /expectedRevision/);
  assert.match(client, /"learning\.review"/);
});

test("blocked task UI maps every permitted user dependency instead of giving vague advice", () => {
  const timeline = readFileSync(`${root}/src/ConversationTimeline.tsx`, "utf8");
  for (const dependency of [
    "missing_secret",
    "missing_authority",
    "physical_action",
    "material_choice",
    "external_state",
    "destructive_confirmation",
  ]) {
    assert.match(timeline, new RegExp(`${dependency}:`));
  }
  assert.match(timeline, /checkpoint\.completion\?\.state === "awaiting_user"/);
  assert.match(timeline, /dependency\?\.detail/);
  assert.match(timeline, /dependency\.evidence\[0\]/);
  assert.match(timeline, /authenticationPausePresentation/);
  assert.match(timeline, /taskAuthenticationExpired/);
  assert.match(timeline, /taskAuthenticationDetails/);
  assert.match(timeline, /onContinueTask/);
});
