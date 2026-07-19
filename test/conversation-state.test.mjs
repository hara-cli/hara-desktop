import assert from "node:assert/strict";
import test from "node:test";
import {
  persistedUserTurnsFrom,
  resolveOptimisticUser,
  restoreAuthoritativeConversation,
} from "../src/conversation-state.ts";

test("canceled optimistic messages never become rewindable server turns", () => {
  const items = [
    { kind: "user", text: "persisted" },
    { kind: "text", text: "answer" },
    { kind: "user", text: "queued", pendingId: "pending-1" },
  ];

  assert.equal(persistedUserTurnsFrom(items, 0), 1);
  assert.deepEqual(resolveOptimisticUser(items, "pending-1", false), [
    { kind: "user", text: "persisted" },
    { kind: "text", text: "answer" },
  ]);
});

test("accepted optimistic messages retain their display position and become rewindable", () => {
  const items = [
    { kind: "user", text: "queued", pendingId: "pending-1" },
    { kind: "notice", text: "still working" },
  ];
  const accepted = resolveOptimisticUser(items, "pending-1", true);

  assert.deepEqual(accepted, [
    { kind: "user", text: "queued" },
    { kind: "notice", text: "still working" },
  ]);
  assert.equal(persistedUserTurnsFrom(accepted, 0), 1);
});

test("reconnect hydration drops partial output and keeps only unsent optimistic messages", () => {
  const authoritative = [
    { kind: "user", text: "persisted" },
    { kind: "text", text: "complete answer" },
  ];
  const local = [
    { kind: "user", text: "persisted" },
    { kind: "text", text: "partial ghost" },
    { kind: "notice", text: "engine disconnected" },
    { kind: "user", text: "queued", pendingId: "pending-2" },
  ];

  assert.deepEqual(
    restoreAuthoritativeConversation(authoritative, local),
    [
      ...authoritative,
      { kind: "user", text: "queued", pendingId: "pending-2" },
    ],
  );
});
