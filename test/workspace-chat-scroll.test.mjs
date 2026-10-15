import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceChatScroll, submitsWorkspaceMessage } from "../src/workspace-chat-scroll.ts";
test("chat follows new messages only while near the bottom", () => {
  const state = new WorkspaceChatScroll(), node = { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 };
  state.layout(node, "A", "m1", null, false); assert.equal(node.scrollTop, 1000);
  node.scrollTop = 200; state.observe(node);
  node.scrollHeight = 1200; state.layout(node, "A", "m2", null, false);
  assert.equal(node.scrollTop, 200); assert.equal(state.unread, true);
  state.latest(node); assert.equal(node.scrollTop, 1200); assert.equal(state.unread, false);
  node.scrollHeight = 1300; state.layout(node, "A", "m3", null, false); assert.equal(node.scrollTop, 1300);
});
test("prepending older records preserves the viewport anchor and does not invent unread messages", () => {
  const state = new WorkspaceChatScroll(), node = { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 };
  state.layout(node, "A", "m50", null, false);
  node.scrollTop = 20; state.beforeOlder(node); state.layout(node, "A", "m50", null, true);
  node.scrollHeight = 1800; state.layout(node, "A", "m50", null, false);
  assert.equal(node.scrollTop, 820); assert.equal(state.unread, false); assert.equal(state.following, false);
});
test("channel switch discards old scroll intent and explicit own send follows the bottom", () => {
  const state = new WorkspaceChatScroll(), node = { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 };
  state.layout(node, "A", "m1", null, false); node.scrollTop = 0; state.observe(node);
  state.layout(node, "A", "m1", "own-send", false); assert.equal(node.scrollTop, 1000);
  node.scrollTop = 0; state.beforeOlder(node); state.layout(node, "B", "b1", null, false);
  assert.equal(node.scrollTop, 1000); assert.equal(state.following, true); assert.equal(state.unread, false);
});
test("IME, repeated or modified Enter never submits; only explicit plain Enter does", () => {
  assert.equal(submitsWorkspaceMessage({ key: "Enter" }), true);
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { shiftKey: true },
    { ctrlKey: true }, { metaKey: true }, { altKey: true }]) assert.equal(submitsWorkspaceMessage({ key: "Enter", ...extra }), false);
  assert.equal(submitsWorkspaceMessage({ key: "a" }), false);
});
