import test from "node:test";
import assert from "node:assert/strict";
import { requestCdp } from "../scripts/browser-cdp-request.mjs";

test("a synchronous CDP socket failure preserves its original error without a detached pending rejection", async () => {
  const pending = new Map(), failure = new Error("fixture socket closed");
  await assert.rejects(requestCdp({ send() { throw failure; } }, pending, { id: 1, method: "Runtime.evaluate", step: "boot-hover" }), error => error === failure);
  assert.equal(pending.size, 0, "cleanup must not reject an orphaned promise and mask the first failure");
});

test("a missing CDP response expires with its method and stage and removes the pending request", async () => {
  const pending = new Map();
  await assert.rejects(requestCdp({ send() {} }, pending, { id: 2, method: "Page.navigate", step: "boot-dark", timeoutMs: 10 }), /Page.navigate timed out at boot-dark \(request 2\)/);
  assert.equal(pending.size, 0);
});
