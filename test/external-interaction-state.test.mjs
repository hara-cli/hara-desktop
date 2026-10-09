import assert from "node:assert/strict";
import test from "node:test";
import {
  createDelegatedApprovalSubmission, externalInteractionInConversation, externalInteractionReplyAllowed,
  interruptDelegatedApprovals, readableDelegatedApproval, receiveDelegatedApproval, resolveDelegatedApproval,
  restoreDelegatedApprovals, validExternalInteractionPresentation,
} from "../src/external-interaction-state.ts";
import { receiveExternalQuestion, resolveExternalQuestion, restoreExternalQuestions } from "../src/external-question-state.ts";
import { externalSessionSourceGroups } from "../src/external-session-presentation.ts";

const request = { approvalId: "approval-1", sessionId: "external-1", turnId: "turn-1", parentSessionId: "parent-1",
  agentPath: "/root/code", expiresAt: "2099-01-01T00:00:00Z", question: "Edit these files?" };
const question = { ...request, questionId: "00000000-0000-4000-8000-000000000001", questions: [{ id: "choice", question: "Which scope?" }] };
const context = { activeSessionId: "parent-1", selectedExternalSessionId: "unrelated-external", personal: true, readOnly: false };

test("parent routing is foreground Personal presentation, never an external reply identity", () => {
  assert.equal(externalInteractionInConversation(request, "parent-1", true), true);
  assert.equal(externalInteractionInConversation(request, "parent-2", true), false);
  assert.equal(externalInteractionInConversation(request, "parent-1", false), false);
  assert.equal(externalInteractionReplyAllowed(request, context), true);
  for (const changes of [{ activeSessionId: "parent-2" }, { personal: false }, { readOnly: true }, { activeSessionId: null }]) {
    assert.equal(externalInteractionReplyAllowed(request, { ...context, ...changes }), false);
  }
  const legacy = { sessionId: "external-1" };
  assert.equal(externalInteractionReplyAllowed(legacy, context), false);
  assert.equal(externalInteractionReplyAllowed(legacy, { ...context, selectedExternalSessionId: "external-1" }), true);
  assert.equal(request.sessionId, "external-1");
  assert.equal(request.turnId, "turn-1");
});

test("invalid presentation metadata is rejected rather than downgraded to a legacy card", () => {
  for (const parentSessionId of ["", 1, {}, "x".repeat(513), "parent\nsecret", "__proto__"]) {
    assert.equal(validExternalInteractionPresentation({ parentSessionId }), false);
    assert.deepEqual(receiveDelegatedApproval({}, { ...request, parentSessionId }), {});
    assert.deepEqual(receiveExternalQuestion({}, { ...question, parentSessionId }), {});
  }
  assert.equal(readableDelegatedApproval({ ...request, agentPath: "x".repeat(513) }), false);
  assert.deepEqual(receiveDelegatedApproval({}, { ...request, turnId: undefined }), {});
  assert.deepEqual(receiveDelegatedApproval({}, { ...request, expiresAt: "unknown" }), {});
});

test("two agents and turns on one parent stay distinct; wrong identity cannot close either", () => {
  const second = { ...request, approvalId: "approval-2", sessionId: "external-2", turnId: "turn-2", agentPath: "/root/tests" };
  const state = receiveDelegatedApproval(receiveDelegatedApproval({}, request), second);
  assert.strictEqual(receiveDelegatedApproval(state, { ...request, parentSessionId: "other" }), state);
  for (const changes of [{ sessionId: "external-2" }, { turnId: "turn-2" }]) {
    assert.strictEqual(resolveDelegatedApproval(state, { ...request, ...changes, outcome: "answered" }), state);
  }
  const interrupted = interruptDelegatedApprovals(state, [request.sessionId], request.turnId);
  assert.equal(interrupted[request.approvalId].outcome, "interrupted");
  assert.equal(interrupted[second.approvalId].outcome, undefined);
});

test("snapshot recovery retains parent metadata but terminal cards and early tombstones never revive", () => {
  const restored = restoreDelegatedApprovals({}, [request]);
  assert.deepEqual(restored[request.approvalId].request, request);
  assert.equal(restoreDelegatedApprovals(restored, [])[request.approvalId].outcome, "interrupted");
  for (const outcome of ["answered", "cancelled", "timed_out", "interrupted"]) {
    const closed = resolveDelegatedApproval(restored, { ...request, outcome });
    assert.equal(restoreDelegatedApprovals(closed, [request])[request.approvalId].outcome, outcome);
    const early = resolveDelegatedApproval({}, { ...request, outcome });
    assert.strictEqual(receiveDelegatedApproval(early, request), early);
    const questions = restoreExternalQuestions({}, [question]);
    assert.equal(questions[question.questionId].request.parentSessionId, request.parentSessionId);
    const resolved = resolveExternalQuestion(questions, { ...question, outcome });
    assert.equal(restoreExternalQuestions(resolved, [question])[question.questionId].outcome, outcome);
  }
});

test("approval tombstones are bounded; malformed IDs never become object authority", () => {
  let state = {};
  for (let n = 0; n < 300; n++) state = resolveDelegatedApproval(state, { ...request, approvalId: `a${n}`, outcome: "answered" });
  assert.equal(Object.keys(state).length, 128);
  for (const approvalId of ["__proto__", "constructor", "prototype", ""]) {
    assert.strictEqual(resolveDelegatedApproval(state, { ...request, approvalId, outcome: "answered" }), state);
  }
});

test("uncertain approval retries retain one decision and command across card remounts without parent authority", async () => {
  let sequence = 0;
  const submission = createDelegatedApprovalSubmission(() => `command-${++sequence}`);
  const sent = [];
  await assert.rejects(submission.submit(request, true, async (reply) => { sent.push(reply); throw Error("lost ACK"); }));
  await assert.rejects(submission.submit(request, false, async () => assert.fail("changed verdict must not send")), /original decision/);
  await assert.rejects(submission.submit({ ...request, turnId: "new-turn" }, true, async () => assert.fail("changed turn must not send")), /original decision/);
  await submission.submit({ ...request }, true, async (reply) => sent.push(reply));
  assert.deepEqual(sent[0], sent[1]);
  assert.deepEqual(Object.keys(sent[0]).sort(), ["approvalId", "sessionId", "turnId", "allow", "commandId"].sort());
  assert.equal(sent[0].sessionId, "external-1");
  assert.equal(sent[0].turnId, "turn-1");
  await assert.rejects(submission.submit(request, true, async () => assert.fail("settled must not send")), /already submitted/);
});

test("approval submission locks synchronously and does not automatically retry a failed request", async () => {
  const submission = createDelegatedApprovalSubmission(() => "command-1");
  let calls = 0;
  let release;
  const first = submission.submit(request, false, () => { calls++; return new Promise((resolve) => { release = resolve; }); });
  await assert.rejects(submission.submit(request, false, async () => calls++), /already submitted/);
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal(calls, 1);
});

test("source groups keep all wire identities and put the Hara-managed terminal outside engine choices", () => {
  const sources = ["runtime", "codex", "claude", "opencode"].map((id) => ({ id, state: "ready", label: id, capabilities: {} }));
  const grouped = externalSessionSourceGroups(sources);
  assert.deepEqual(grouped.engines.map((source) => source.id), ["codex", "claude", "opencode"]);
  assert.deepEqual(grouped.terminals.map((source) => source.id), ["runtime"]);
  assert.strictEqual(grouped.terminals[0], sources[0]);
  assert.deepEqual(sources.map((source) => source.id), ["runtime", "codex", "claude", "opencode"]);
});
