import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { navigateCdp } from "../scripts/browser-cdp-navigation.mjs";

class Socket extends EventTarget {
  listeners = new Set();
  addEventListener(type, handler) { this.listeners.add(handler); super.addEventListener(type, handler); }
  removeEventListener(type, handler) { this.listeners.delete(handler); super.removeEventListener(type, handler); }
  loaded(frameId = "frame", loaderId = "new", sessionId = "session") {
    this.dispatchEvent(new MessageEvent("message", {data: JSON.stringify({sessionId, method: "Page.lifecycleEvent", params: {name: "DOMContentLoaded", frameId, loaderId}})}));
  }
}
const options = {url: "http://127.0.0.1/fixture", sessionId: "session", step: "fixture/dark"};
const result = {frameId: "frame", loaderId: "new"};

test("a navigation acknowledgement and an old ready document cannot release the next evaluation", async () => {
  const socket = new Socket(); let evaluations = 0, calls = 0;
  const next = navigateCdp(async method => { assert.equal(method, "Page.navigate"); calls++; return result; }, socket, options)
    .then(() => { evaluations++; });
  socket.loaded("frame", "old"); socket.loaded("iframe"); socket.loaded("frame", "new", "another-session");
  await setImmediate();
  assert.equal(evaluations, 0, "do not evaluate the previous fixture while it is navigating away");
  socket.loaded(); await next;
  assert.equal(evaluations, 1); assert.equal(calls, 1); assert.equal(socket.listeners.size, 0);
});

test("the exact loader can finish before the Page.navigate response without losing its event", async () => {
  const socket = new Socket();
  assert.deepEqual(await navigateCdp(async () => { socket.loaded(); return result; }, socket, options), result);
  assert.equal(socket.listeners.size, 0);
});

test("navigation failures and lost targets fail once rather than resending navigation or user actions", async () => {
  for (const failure of [{...result, errorText: "net::ERR_FAILED"}, {frameId: "frame"}, {...result, isDownload: true}]) {
    const socket = new Socket(); let calls = 0;
    await assert.rejects(navigateCdp(async () => { calls++; return failure; }, socket, options), /Document navigation failed/);
    assert.equal(calls, 1); assert.equal(socket.listeners.size, 0);
  }
  const socket = new Socket(); const failure = new Error("Inspected target navigated or closed"); let calls = 0;
  await assert.rejects(navigateCdp(async () => { calls++; throw failure; }, socket, options), error => error === failure);
  assert.equal(calls, 1); assert.equal(socket.listeners.size, 0);
});

test("a closed socket rejects a pending navigation immediately and removes its listeners", async () => {
  const socket = new Socket();
  const pending = navigateCdp(() => new Promise(() => {}), socket, options);
  socket.dispatchEvent(new Event("close"));
  await assert.rejects(pending, /Navigation target closed at fixture\/dark/);
  assert.equal(socket.listeners.size, 0);
});

test("an absent matching document fails within the bounded deadline without a retry", async () => {
  const socket = new Socket(); let calls = 0;
  await assert.rejects(navigateCdp(async () => { calls++; return result; }, socket, {...options, timeoutMs: 10}), /Document navigation timed out/);
  assert.equal(calls, 1); assert.equal(socket.listeners.size, 0);
});
