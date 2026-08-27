import assert from "node:assert/strict";
import test from "node:test";
import {
  persistedUserTurnsFrom,
  reconcileTerminalReply,
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

test("turn end restores an entirely dropped final reply after execution details", () => {
  const items = [
    { kind: "user", text: "finish it" },
    { kind: "text", text: "I will inspect it." },
    { kind: "tool", name: "exec", preview: "test" },
    { kind: "diff", text: "+ fixed" },
  ];

  assert.deepEqual(reconcileTerminalReply(items, "Fixed and verified."), [
    ...items,
    { kind: "text", text: "Fixed and verified." },
  ]);
});

test("turn end completes a partial streamed reply without duplicating it", () => {
  const items = [
    { kind: "user", text: "finish it" },
    { kind: "tool", name: "exec", preview: "test" },
    { kind: "text", text: "Fixed and " },
  ];

  assert.deepEqual(reconcileTerminalReply(items, "Fixed and verified."), [
    { kind: "user", text: "finish it" },
    { kind: "tool", name: "exec", preview: "test" },
    { kind: "text", text: "Fixed and verified." },
  ]);
});

test("turn end leaves a complete streamed reply and prior commentary unchanged", () => {
  const items = [
    { kind: "user", text: "finish it" },
    { kind: "text", text: "I will inspect it." },
    { kind: "tool", name: "exec", preview: "test" },
    { kind: "text", text: "Fixed and verified." },
    { kind: "notice", text: "Conversation compacted." },
  ];

  assert.equal(reconcileTerminalReply(items, "Fixed and verified."), items);
});

test("turn end replaces a gapped terminal stream but preserves notices and earlier commentary", () => {
  const items = [
    { kind: "user", text: "finish it" },
    { kind: "text", text: "I will inspect it." },
    { kind: "tool", name: "exec", preview: "test" },
    { kind: "text", text: "Fixed " },
    { kind: "notice", text: "Still connected." },
    { kind: "text", text: "verified." },
  ];

  assert.deepEqual(reconcileTerminalReply(items, "Fixed and fully verified."), [
    { kind: "user", text: "finish it" },
    { kind: "text", text: "I will inspect it." },
    { kind: "tool", name: "exec", preview: "test" },
    { kind: "text", text: "Fixed and fully verified." },
    { kind: "notice", text: "Still connected." },
  ]);
});

test("turn end ignores empty terminal replies used by paused or failed turns", () => {
  const items = [{ kind: "user", text: "continue" }];
  assert.equal(reconcileTerminalReply(items, ""), items);
  assert.equal(reconcileTerminalReply(items, "   "), items);
});
