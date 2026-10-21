import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readDevToolsAnnouncement, stopOwnedBrowser } from "../scripts/browser-process.mjs";

const url = "ws://127.0.0.1:9222/devtools/browser/local-fixture";
const line = `DevTools listening on ${url}\n`;

test("a readiness line preceding more than 4KB of Linux diagnostics is not lost by tail truncation", () => {
  const chunk = Buffer.from(line + "[fixture diagnostic]\n".repeat(600));
  assert.equal(/DevTools listening on/.test(chunk.toString().slice(-4000)), false, "reproduce the old trim-before-match gap");
  const parsed = readDevToolsAnnouncement("", chunk);
  assert.equal(parsed.url, url); assert.equal(parsed.tail.length, 4000);
});

test("readiness may span chunks but a partial WebSocket URL is never used", () => {
  const first = readDevToolsAnnouncement("", Buffer.from(line.slice(0, 40)));
  assert.equal(first.url, null);
  const second = readDevToolsAnnouncement(first.tail, Buffer.from(line.slice(40)));
  assert.equal(second.url, url);
  assert.equal(readDevToolsAnnouncement("", Buffer.from("unrelated diagnostic\n")).url, null);
});

class Child extends EventEmitter {
  exitCode = null; signalCode = null; signals = [];
  finish(signal) { this.signalCode = signal; this.emit("exit", null, signal); }
}

test("a browser that already exited by signal is not killed or awaited for a second exit", async () => {
  const child = new Child(); child.finish("SIGTERM"); child.kill = () => assert.fail("already exited");
  await stopOwnedBrowser(child);
  assert.equal(child.listenerCount("exit"), 0);
});

test("exit listeners are installed before killing, including a synchronous TERM exit", async () => {
  const child = new Child(); child.kill = signal => { child.signals.push(signal); child.finish(signal); return true; };
  await stopOwnedBrowser(child);
  assert.deepEqual(child.signals, ["SIGTERM"]); assert.equal(child.listenerCount("exit"), 0);
});

test("an unresponsive browser escalates only its owned child and cannot leave an unsettled await", async () => {
  const child = new Child(); child.kill = signal => { child.signals.push(signal); if (signal === "SIGKILL") child.finish(signal); return true; };
  await stopOwnedBrowser(child, {graceMs: 2});
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]); assert.equal(child.listenerCount("exit"), 0);
  const stuck = new Child(); stuck.kill = () => true;
  await assert.rejects(stopOwnedBrowser(stuck, {graceMs: 2}), /cleanup bounds/);
  assert.equal(stuck.listenerCount("exit"), 0);
});
