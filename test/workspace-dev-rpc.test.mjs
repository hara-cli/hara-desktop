import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { WorkspaceDevConnectionClient } from "../src/workspace-dev-rpc.ts";
const original = globalThis.WebSocket;
class Socket extends EventTarget {
  static OPEN = 1; static CONNECTING = 0; static CLOSED = 3; static instances = [];
  readyState = 0; sent = []; closes = 0;
  constructor(url) { super(); this.url = url; Socket.instances.push(this); }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  message(value) { const event = new Event("message"); event.data = typeof value === "string" ? value : JSON.stringify(value); this.dispatchEvent(event); }
  reply(id, result) { this.message({ jsonrpc: "2.0", id, result }); }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { if (this.readyState === 3) return; this.closes++; this.readyState = 3; this.dispatchEvent(new Event("close")); }
}
beforeEach(() => { Socket.instances = []; globalThis.WebSocket = Socket; });
afterEach(() => { for (const socket of Socket.instances) socket.close(); globalThis.WebSocket = original; });
const info = () => ({ port: 12345, token: "a".repeat(64), instanceId: "synthetic", root: "/private/fixture", syntheticOnly: true });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function setup() {
  let disconnects = 0; const client = new WorkspaceDevConnectionClient(info(), () => disconnects++), socket = Socket.instances.at(-1);
  const ready = client.initialize(info().token); socket.open(); await tick();
  socket.reply(socket.sent[0].id, { capabilities: ["workspace.local-dev.v2"], syntheticOnly: true }); await ready;
  return { client, socket, disconnects: () => disconnects };
}
test("invalid native transport metadata never opens a socket or falls back", () => {
  for (const invalid of [{ ...info(), port: 0 }, { ...info(), port: 65536 }, { ...info(), token: "bad" }, { ...info(), syntheticOnly: false }]) {
    assert.throws(() => new WorkspaceDevConnectionClient(invalid, () => {}));
  }
  assert.equal(Socket.instances.length, 0);
});
test("unsupported/legacy capability closes rather than calling old initialization/config", async () => {
  const client = new WorkspaceDevConnectionClient(info(), () => {}), socket = Socket.instances.at(-1);
  const ready = client.initialize(info().token); const rejected = assert.rejects(ready, /不支援/); socket.open(); await tick();
  socket.reply(socket.sent[0].id, { capabilities: ["legacy"], syntheticOnly: false }); await rejected;
  assert.equal(socket.closes, 1); assert.deepEqual(socket.sent.map(row => row.method), ["initialize"]);
});
test("authentication token is sent only in initialize, not business mutations", async () => {
  const f = await setup(); assert.equal(f.socket.url, "ws://127.0.0.1:12345");
  const request = f.client.request("workspace.list", {}); const sent = f.socket.sent.at(-1);
  assert.equal(JSON.stringify(sent).includes(info().token), false); f.socket.reply(sent.id, { revision: 0 }); assert.deepEqual(await request, { revision: 0 });
});
test("malformed/foreign replies do not settle a request and scoped notifications are metadata only", async () => {
  const f = await setup(), changed = []; f.client.setChangedListener(id => changed.push(id));
  const request = f.client.request("workspace.snapshot", { workspaceId: "A", agentId: "main" }); const id = f.socket.sent.at(-1).id;
  f.socket.message("invalid json"); f.socket.reply(id + 10, { wrong: true });
  f.socket.message({ method: "workspace.changed", params: { workspaceId: "A" } }); assert.deepEqual(changed, ["A"]);
  f.socket.reply(id, { expected: true }); assert.deepEqual(await request, { expected: true });
});
test("disconnect rejects every pending request without automatic resend or reconnection", async () => {
  const f = await setup(), one = f.client.request("workspace.list", {}), two = f.client.request("workspace.snapshot", { workspaceId: "A" });
  const replies = Promise.allSettled([one, two]); f.socket.close(); assert.ok((await replies).every(row => row.status === "rejected"));
  assert.equal(f.disconnects(), 1); assert.equal(Socket.instances.length, 1); assert.equal(f.socket.sent.length, 3);
});
test("real-key attachment requires matching private native mode and exact new capability, never downgrades", async () => {
  for (const result of [
    { capabilities: ["workspace.local-dev.v2"], syntheticOnly: false, executionMode: "ark-real-key" },
    { capabilities: ["workspace.local-dev.v2", "workspace.real-key-slice.v1"], syntheticOnly: true, executionMode: "synthetic" },
    { capabilities: ["workspace.local-dev.v2", "workspace.real-key-slice.v1"], syntheticOnly: false, executionMode: "ark-real-key" },
  ]) {
    const client = new WorkspaceDevConnectionClient({ ...info(), syntheticOnly: false, executionMode: "ark-real-key" }, () => {});
    const socket = Socket.instances.at(-1), ready = client.initialize(info().token);
    const checked = result.syntheticOnly === false && result.capabilities.length === 2 ? ready : assert.rejects(ready, /不支援/);
    socket.open(); await tick(); socket.reply(socket.sent[0].id, result); await checked; client.close();
  }
});
