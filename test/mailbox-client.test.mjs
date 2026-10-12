import test from "node:test";
import assert from "node:assert/strict";
import { HaraClient } from "../src/client.ts";
import { MailboxScopeGuard, MailboxRequestKeys } from "../src/mailbox-state.ts";

test("mailbox reads discard responses from the previous company and retry keys retain uncertain mutations", () => {
  const guard = new MailboxScopeGuard(), old = guard.begin();
  assert.equal(old(), true);
  const next = guard.begin(); assert.equal(old(), false); assert.equal(next(), true);
  guard.invalidate(); assert.equal(next(), false);
  let n = 0; const keys = new MailboxRequestKeys(() => `request-${++n}`), body = { title: "Draft", projectId: "hara" };
  const first = keys.get("tasks.create", body);
  assert.equal(keys.get("tasks.create", { ...body }), first);
  assert.notEqual(keys.get("tasks.create", { ...body, title: "Changed" }), first);
  keys.complete("tasks.create", body); assert.notEqual(keys.get("tasks.create", body), first);
});

test("mailbox client negotiates capabilities and carries a fixed company/profile on every call", async t => {
  const previousSocket = globalThis.WebSocket, previousWindow = globalThis.window;
  const requests = []; let advertised = true;
  class Socket {
    OPEN = 1; readyState = 1;
    constructor() { queueMicrotask(() => this.onopen?.()); }
    send(raw) {
      const r = JSON.parse(raw); requests.push(r);
      const result = r.method === "initialize" ? { name: "hara", version: "test", protocol: 1, capabilities: { methods: advertised ? ["mail.connections.list", "mail.runtime.status", "mail.command", "mail.auth.status", "desk.taskbus.request"] : [], features: [], events: [] } } : { ok: true };
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", id: r.id, result }) }));
    }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  globalThis.WebSocket = Socket; globalThis.window = { setTimeout, clearTimeout };
  t.after(() => { globalThis.WebSocket = previousSocket; globalThis.window = previousWindow; });
  const client = new HaraClient(); await client.connect("127.0.0.1", 4242); await client.initialize("test-token");
  await client.mailConnections("company-a", "org-a");
  await client.mailRuntimeStatus("company-a", "org-a");
  await client.mailCommand("company-a", "org-a", "pause", { id: "mail-1", expectedRevision: 3, requestKey: "pause-1" });
  await client.mailAuthStatus("company-a", "org-a");
  await client.taskbusRequest("company-a", "org-a", "tasks.accept", { taskId: "task-1", expectedRevision: 4, resultHash: "hash-1", requestKey: "accept-1" });
  for (const r of requests.slice(1)) { assert.equal(r.params.profileId, "company-a"); assert.equal(r.params.spaceId, "org-a"); }
  assert.equal(requests.at(-1).params.input.resultHash, "hash-1");
  client.close(); advertised = false;
  const old = new HaraClient(); await old.connect("127.0.0.1", 4242); await old.initialize("test-token");
  const before = requests.length;
  await assert.rejects(old.mailCommand("company-b", "org-b", "bind"), /Update Hara Engine/);
  await assert.rejects(old.mailRuntimeStatus("company-b", "org-b"), /Update Hara Engine/);
  await assert.rejects(old.taskbusRequest("company-b", "org-b", "tasks.create"), /Update Hara Engine/);
  assert.equal(requests.length, before, "unsupported engines receive no fallback mutations"); old.close();
});
