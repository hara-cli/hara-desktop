import assert from "node:assert/strict";
import test from "node:test";
import { restoreSessionApprovals } from "../src/approval-restoration.ts";

const presentation = {
  kind: "agent-create", username: "ada", name: "Ada", role: "Research",
  description: "Checks evidence", instructions: "Ask before sending. ".repeat(120),
};
const pending = { approvalId: "create-1", question: "Create Ada?", allowAlways: false, presentation };
const task = { sessionId: "s1", state: "waiting", approval: { id: pending.approvalId, question: pending.question } };
const history = [{ kind: "user", text: "Please create a colleague." }];
const card = { kind: "approval", ...pending };

test("foreground resume restores the full proposal from a clean history without ambient persona fields", () => {
  const restored = restoreSessionApprovals(history, "s1", task, [pending]);
  assert.deepEqual(restored, [...history, card]);
  assert.equal(restored.at(-1).presentation.instructions, presentation.instructions);
  assert.equal(task.approval.presentation, undefined, "ambient task state stays presentation-free");
});

test("a matching live card keeps its proposal through an old-engine resume", () => {
  assert.deepEqual(restoreSessionApprovals(history, "s1", task, undefined, { sessionId: "s1", items: [card] }), [...history, card]);
  const merged = restoreSessionApprovals([{ kind: "approval", approvalId: "create-1", question: "old" }], "s1", task, [pending]);
  assert.deepEqual(merged, [card], "foreground request replaces incomplete recovered presentation");
});

test("explicitly empty pending approvals remove stale live cards, even if a task approval lingers", () => {
  assert.deepEqual(restoreSessionApprovals(history, "s1", task, [], { sessionId: "s1", items: [card] }), history);
  assert.deepEqual(restoreSessionApprovals([card], "s1", task, []), []);
});

test("answered cards remain history and are never resurrected by resume or late pending snapshots", () => {
  for (const answered of ["allow", "deny", "expired"]) {
    const closed = { ...card, answered };
    assert.deepEqual(restoreSessionApprovals(history, "s1", task, [pending], { sessionId: "s1", items: [closed] }), [...history, closed]);
    assert.deepEqual(restoreSessionApprovals(history, "s1", task, undefined, { sessionId: "s1", items: [closed] }), [...history, closed]);
    assert.deepEqual(restoreSessionApprovals([card], "s1", task, [pending], { sessionId: "s1", items: [closed] }), [closed], "a stale live item cannot overwrite a resolved same-session card");
  }
});

test("legacy fallback cannot import another session's task or proposal", () => {
  assert.deepEqual(restoreSessionApprovals(history, "s2", task, undefined, { sessionId: "s1", items: [card] }), history);
  const plain = restoreSessionApprovals(history, "s1", task, undefined, { sessionId: "s2", items: [card] }).at(-1);
  assert.equal(plain.presentation, undefined);
  assert.equal(plain.approvalId, "create-1");
  assert.deepEqual(restoreSessionApprovals(history, "s1", { ...task, state: "completed" }, undefined), history);
});
