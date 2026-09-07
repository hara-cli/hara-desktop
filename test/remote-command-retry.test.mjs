import assert from "node:assert/strict";
import test from "node:test";

import { RemoteCommandRetryTracker } from "../src/remote-command-retry.ts";

const UUIDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];

const memoryStorage = () => {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

const tracker = (storage, ids, now = () => 1_000) => new RemoteCommandRetryTracker({
  storage,
  now,
  uuid: () => ids.shift(),
  fingerprint: async (input) => {
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(input).digest("hex");
  },
});

test("remote command retry keeps one UUID across a renderer replacement without storing prompt text", async () => {
  const storage = memoryStorage();
  const first = tracker(storage, [...UUIDS]);
  const commandId = await first.begin("external.sessions.submit", "ext_codex_safe", "sensitive instruction");
  assert.equal(commandId, UUIDS[1]);
  assert.doesNotMatch(storage.values.values().next().value, /sensitive instruction/);

  const replacement = tracker(storage, UUIDS.slice(2));
  assert.equal(
    await replacement.begin("external.sessions.submit", "ext_codex_safe", "sensitive instruction"),
    commandId,
  );
  const distinct = await replacement.begin("external.sessions.submit", "ext_codex_safe", "different instruction");
  assert.notEqual(distinct, commandId);
  replacement.settle(commandId);
  assert.equal(
    await replacement.begin("external.sessions.submit", "ext_codex_safe", "sensitive instruction"),
    UUIDS[3],
  );
});

test("remote command retry expires uncertain receipts instead of growing forever", async () => {
  const storage = memoryStorage();
  let now = 1_000;
  const first = tracker(storage, [...UUIDS], () => now);
  const old = await first.begin("external.sessions.interrupt", "ext_codex_safe", "turn-a");
  now += 24 * 60 * 60 * 1_000 + 1;
  const replacement = tracker(storage, UUIDS.slice(2), () => now);
  const fresh = await replacement.begin("external.sessions.interrupt", "ext_codex_safe", "turn-a");
  assert.notEqual(fresh, old);
});
