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
                "artifact.validate",
                "artifact.export",
                "presentation.create",
                "presentation.import",
                "presentation.update",
                "presentation.get",
                "presentation.validate",
                "presentation.preview",
                "presentation.preview-file",
                "presentation.export",
                "presentation.render",
                "settings.gateways.login.start",
                "settings.gateways.login.status",
                "settings.gateways.login.cancel",
                "desk.connections.list",
                "desk.snapshot",
                "desk.task.get",
              ],
              events: ["event.task_state", "event.surface"],
              features: ["composer.attachments.v1", "models.capabilities.v1", "collaboration.remote.v1"],
            },
          } : request.method.startsWith("settings.gateways.login.")
            ? { login }
            : request.method === "desk.connections.list"
              ? {
                  connections: [{
                    profileId: "org-a",
                    configured: true,
                    bindingRevision: "binding-revision-a",
                    host: "desk.example.test",
                    agentId: "agent-a",
                    owner: "owner-a",
                  }],
                  legacyUnbound: false,
                }
              : request.method === "desk.snapshot"
                ? {
                    profileId: request.params.profileId,
                    fetchedAt: 100,
                    me: {
                      id: "agent-a",
                      name: "Agent A",
                      owner: "owner-a",
                      client: "hara-cli",
                      role: "member",
                      createdAt: 1,
                      lastSeen: 2,
                      revoked: false,
                    },
                    tasks: [],
                    agents: [],
                    events: [],
                    circles: [],
                    truncated: false,
                  }
                : request.method === "desk.task.get"
                  ? {
                      profileId: request.params.profileId,
                      task: {
                        id: request.params.taskId,
                        kind: "dispatch",
                        title: "Task",
                        excerpt: "",
                        body: "",
                        risk: "low",
                        state: "open",
                        createdBy: "agent-a",
                        claimedBy: null,
                        ackedBy: null,
                        createdAt: 1,
                        updatedAt: 2,
                      },
                      events: [],
                    }
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
  assert.equal(client.supports("artifact.validate"), true);
  assert.equal(client.supports("artifact.export"), true);
  assert.equal(client.supports("presentation.preview"), true);
  assert.equal(client.supports("presentation.update"), true);
  assert.equal(client.supports("presentation.render"), true);
  assert.equal(client.supports("presentation.export"), true);
  assert.equal(client.supportsEvent("event.task_state"), true);
  assert.equal(client.supportsEvent("event.surface"), true);
  assert.equal(client.supportsFeature("composer.attachments.v1"), true);
  assert.equal(client.supportsFeature("collaboration.remote.v1"), true);

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

  await client.send("session-1", "", [{
    clientId: "attachment-1",
    kind: "directory",
    path: "/workspace/参考 目录",
  }]);
  assert.deepEqual(requests.at(-1), {
    jsonrpc: "2.0",
    id: 7,
    method: "session.send",
    params: {
      sessionId: "session-1",
      text: "",
      attachments: [{
        clientId: "attachment-1",
        kind: "directory",
        path: "/workspace/参考 目录",
      }],
    },
  });

  const deskConnections = await client.listDeskConnections();
  assert.equal(deskConnections.connections[0].profileId, "org-a");
  assert.equal(deskConnections.connections[0].bindingRevision, "binding-revision-a");
  assert.deepEqual(requests.at(-1), {
    jsonrpc: "2.0",
    id: 8,
    method: "desk.connections.list",
    params: {},
  });

  const deskSnapshot = await client.deskSnapshot("org-a", "open");
  assert.equal(deskSnapshot.profileId, "org-a");
  assert.deepEqual(requests.at(-1), {
    jsonrpc: "2.0",
    id: 9,
    method: "desk.snapshot",
    params: { profileId: "org-a", state: "open" },
  });

  const deskTask = await client.getDeskTask("org-a", "t_abcd");
  assert.equal(deskTask.task.id, "t_abcd");
  assert.deepEqual(requests.at(-1), {
    jsonrpc: "2.0",
    id: 10,
    method: "desk.task.get",
    params: { profileId: "org-a", taskId: "t_abcd" },
  });

  await client.validateArtifact("art_123", "rev_456");
  assert.deepEqual(requests.at(-1), {
    jsonrpc: "2.0",
    id: 11,
    method: "artifact.validate",
    params: { artifactId: "art_123", revisionId: "rev_456" },
  });
  await client.exportArtifact({
    artifactId: "art_123",
    revisionId: "rev_456",
    validationReportId: "val_789",
    destinationPath: "/workspace/brief-copy.docx",
  });
  assert.deepEqual(requests.at(-1), {
    jsonrpc: "2.0",
    id: 12,
    method: "artifact.export",
    params: {
      artifactId: "art_123",
      revisionId: "rev_456",
      validationReportId: "val_789",
      destinationPath: "/workspace/brief-copy.docx",
    },
  });

  await client.createPresentation({ title: "Release review" });
  assert.deepEqual(requests.at(-1), {
    jsonrpc: "2.0",
    id: 13,
    method: "presentation.create",
    params: { title: "Release review" },
  });
  const project = {
    schemaVersion: "hara.presentation/1",
    title: "Release review",
    widthEmu: 12192000,
    heightEmu: 6858000,
    brief: {},
    slides: [{
      id: "slide-1",
      claim: "Evidence is complete.",
      takeawayTitle: "Ready to ship",
      blocks: [{ id: "heading-1", type: "heading", literal: "Ready to ship" }],
    }],
  };
  await client.updatePresentation({
    artifactId: "art_presentation",
    baseRevisionId: "rev_presentation",
    project,
  });
  assert.deepEqual(requests.at(-1), {
    jsonrpc: "2.0",
    id: 14,
    method: "presentation.update",
    params: {
      artifactId: "art_presentation",
      baseRevisionId: "rev_presentation",
      project,
    },
  });
  await client.renderPresentation(project);
  assert.deepEqual(requests.at(-1), {
    jsonrpc: "2.0",
    id: 15,
    method: "presentation.render",
    params: { project },
  });
  await client.getPresentationPreview("art_presentation", "rev_presentation");
  assert.deepEqual(requests.at(-1), {
    jsonrpc: "2.0",
    id: 16,
    method: "presentation.preview",
    params: { artifactId: "art_presentation", revisionId: "rev_presentation" },
  });
  await client.createPresentationPreviewFile("art_presentation", "rev_presentation");
  assert.deepEqual(requests.at(-1), {
    jsonrpc: "2.0",
    id: 17,
    method: "presentation.preview-file",
    params: { artifactId: "art_presentation", revisionId: "rev_presentation" },
  });
  await client.exportPresentation({
    artifactId: "art_presentation",
    revisionId: "rev_presentation",
    validationReportId: "val_presentation",
    destinationPath: "/workspace/release-review.pptx",
    format: "pptx",
  });
  assert.deepEqual(requests.at(-1), {
    jsonrpc: "2.0",
    id: 18,
    method: "presentation.export",
    params: {
      artifactId: "art_presentation",
      revisionId: "rev_presentation",
      validationReportId: "val_presentation",
      destinationPath: "/workspace/release-review.pptx",
      format: "pptx",
    },
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

  socket.onmessage({
    data: JSON.stringify({
      jsonrpc: "2.0",
      method: "event.surface",
      params: {
        sessionId: "session-1",
        kind: "browser",
        title: "Local preview",
        resource: { type: "url", url: "http://127.0.0.1:5173/" },
      },
    }),
  });
  assert.deepEqual(received, {
    method: "event.surface",
    sessionId: "session-1",
    kind: "browser",
    title: "Local preview",
    resource: { type: "url", url: "http://127.0.0.1:5173/" },
  });
});

test("Desk client methods feature-detect an older Serve without probing remote collaboration", async (t) => {
  const originalWebSocket = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const requests = [];

  class OlderWebSocket {
    onopen;
    onerror;
    onclose;
    onmessage;

    constructor() {
      queueMicrotask(() => this.onopen?.());
    }

    send(raw) {
      const request = JSON.parse(raw);
      requests.push(request);
      queueMicrotask(() => this.onmessage?.({
        data: JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            name: "hara",
            version: "0.134.0",
            protocol: 1,
            cwd: "/workspace",
            provider: "qwen",
            model: "glm-5",
            capabilities: {
              methods: ["session.send"],
              events: [],
              features: [],
            },
          },
        }),
      }));
    }

    close() {
      this.onclose?.();
    }
  }

  globalThis.WebSocket = OlderWebSocket;
  globalThis.window = { setTimeout, clearTimeout };
  t.after(() => {
    globalThis.WebSocket = originalWebSocket;
    globalThis.window = originalWindow;
  });

  const client = new HaraClient();
  await client.connect("127.0.0.1", 4242);
  await client.initialize("redacted-token");
  assert.equal(await client.listDeskConnections(), null);
  assert.equal(await client.deskSnapshot("org-a"), null);
  assert.equal(await client.getDeskTask("org-a", "t_abcd"), null);
  assert.equal(requests.length, 1, "unsupported Desk methods are not probed");
});
