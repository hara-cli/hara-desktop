import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { WorkspaceDevConnectionClient } from "../src/workspace-dev-rpc.ts";
import { WorkspaceRpcWaitError } from "../src/workspace-dev-errors.ts";
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
test("formal connection accepts workspace.v1 only, not a Lab or real-key acceptance host", async () => {
  for (const reply of [{ capabilities: ["workspace.v1"], executionMode: "workspace", syntheticOnly: false }, { capabilities: ["workspace.local-dev.v2"], executionMode: "synthetic", syntheticOnly: true }]) {
    const client = new WorkspaceDevConnectionClient({ ...info(), syntheticOnly: false, executionMode: "workspace" }, () => {}), socket = Socket.instances.at(-1);
    const ready = client.initialize(info().token), outcome = reply.executionMode === "workspace" ? ready : assert.rejects(ready);
    socket.open(); await tick(); socket.reply(socket.sent[0].id, reply); await outcome; assert.equal(socket.closes, reply.executionMode === "workspace" ? 0 : 1); client.close();
  }
});
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
test('change notifications preserve an optional colleague identity without accepting malformed metadata', async () => {
  const f=await setup(), changes=[];f.client.setChangedListener((workspaceId,agentId)=>changes.push([workspaceId,agentId]));
  f.socket.message({method:'workspace.changed',params:{workspaceId:'A',agentId:'colleague-141'}});
  f.socket.message({method:'workspace.changed',params:{workspaceId:'A',agentId:42}});
  f.socket.message({method:'workspace.changed',params:{agentId:'colleague-141'}});
  assert.deepEqual(changes,[['A','colleague-141'],['A',undefined]]);
  assert.equal(f.socket.sent.length,1,'Notifications do not dispatch mutations');
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
test("15-second transport expiry is typed unknown, late ACK is ignored and no mutation is resent", async t => {
  const f = await setup(); t.mock.timers.enable({ apis: ["setTimeout"] });
  let settled = false;
  const request = f.client.request("workspace.session.resume", { requestId: "one-original-nonce" });
  const checked = assert.rejects(request, error => { settled = true; return error instanceof WorkspaceRpcWaitError && error.method === "workspace.session.resume"; });
  const id = f.socket.sent.at(-1).id; t.mock.timers.tick(14999); await tick(); assert.equal(settled, false);
  t.mock.timers.tick(1); await checked; f.socket.reply(id, { runId: "accepted-before-expiry" });
  const lookup = f.client.request("workspace.session.receipt", { requestId: "one-original-nonce" });
  f.socket.reply(f.socket.sent.at(-1).id, { state: "accepted" }); assert.deepEqual(await lookup, { state: "accepted" });
  assert.equal(f.socket.sent.filter(row => row.method === "workspace.session.resume").length, 1);
});
test("a synchronous transport send failure cleans its timer without reconnecting or retrying", async () => {
  const f = await setup(), originalSend = f.socket.send;
  f.socket.send = () => { throw new Error("synthetic socket failure"); };
  await assert.rejects(f.client.request("workspace.session.send", {}), /勿重送/);
  f.socket.send = originalSend;
  const lookup = f.client.request("workspace.session.receipt", {}); f.socket.reply(f.socket.sent.at(-1).id, { state: "unknown" }); await lookup;
  assert.equal(Socket.instances.length, 1); assert.equal(f.socket.sent.some(row => row.method === "workspace.session.send"), false);
});
