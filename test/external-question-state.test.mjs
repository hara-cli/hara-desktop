import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExternalQuestionAnswers, createExternalQuestionSubmission, externalQuestionPending,
  interruptExternalQuestions, readableExternalQuestion, receiveExternalQuestion,
  resolveExternalQuestion, restoreExternalQuestions, prepareExternalQuestionAnswers, externalQuestionDockMode,
} from "../src/external-question-state.ts";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const request = {
  questionId: id(1), sessionId: "external:s1", turnId: "turn1", expiresAt: "2099-01-01T00:00:00.000Z",
  questions: [{ id: "color", question: "Choose a color", options: [{ label: "Red" }, { label: "Blue" }], isOther: true }],
};
const draft = (selected = [], custom = "", useCustom = false) => ({ selected, custom, useCustom });

test("ordinary questions have no default; all questions must be answered with allowed labels or explicit custom text", () => {
  assert.equal(buildExternalQuestionAnswers(request, {}), null);
  assert.deepEqual(buildExternalQuestionAnswers(request, { color: draft(["Blue"]) }), { color: { answers: ["Blue"] } });
  assert.equal(buildExternalQuestionAnswers(request, { color: draft(["Not an option"]) }), null);
  assert.equal(buildExternalQuestionAnswers(request, { color: draft(["Blue", "Not an option"]) }), null);
  assert.equal(buildExternalQuestionAnswers(request, { color: draft(["Red", "Blue"]) }), null);
  assert.deepEqual(buildExternalQuestionAnswers(request, { color: draft([], "  Green  ", true) }), { color: { answers: ["Green"] } });
  assert.equal(buildExternalQuestionAnswers({ ...request, questions: [{ ...request.questions[0], isOther: false }] }, { color: draft([], "Green", true) }), null);
});

test("multiquestion and multiselect preserve label binding and reject missing text answers", () => {
  const multi = { ...request, questions: [{ ...request.questions[0], multiSelect: true }, { id: "context", question: "Context?" }] };
  assert.equal(buildExternalQuestionAnswers(multi, { color: draft(["Red"]) }), null);
  assert.deepEqual(buildExternalQuestionAnswers(multi, { color: draft(["Red", "Blue"], "Green", true), context: draft([], "Details") }), {
    color: { answers: ["Red", "Blue", "Green"] }, context: { answers: ["Details"] },
  });
});

test("answer limits agree with the provider: 4,000 characters, 32 choices, and 32 KiB UTF-8 total", () => {
  const free = { ...request, questions: [{ id: "text", question: "Details?" }] };
  assert.ok(buildExternalQuestionAnswers(free, { text: draft([], "x".repeat(4000)) }));
  assert.equal(prepareExternalQuestionAnswers(free, { text: draft([], "x".repeat(4001)) }).error, "limit");
  const options = Array.from({ length: 32 }, (_, n) => ({ label: `Option ${n}` }));
  const multi = { ...request, questions: [{ id: "all", question: "Select", options, multiSelect: true, isOther: true }] };
  assert.equal(prepareExternalQuestionAnswers(multi, { all: draft(options.map((option) => option.label), "Extra", true) }).error, "limit");
  const many = { ...request, questions: ["one", "two", "three"].map((id) => ({ id, question: "Details?" })) };
  assert.equal(prepareExternalQuestionAnswers(many, Object.fromEntries(many.questions.map((question) => [question.id, draft([], "中".repeat(4000))]))).error, "limit");
});

test("secret or malformed requests are dropped before rendering or storing their body", () => {
  for (const invalid of [
    { ...request, questions: [...request.questions, { id: "secret", question: "Private", isSecret: true }] },
    { ...request, questionId: "constructor" }, { ...request, sessionId: 1 }, { ...request, turnId: {} },
    { ...request, expiresAt: "invalid" }, { ...request, questions: [null] },
    ...[false, 0, ""].map((options) => ({ ...request, questions: [{ ...request.questions[0], options }] })),
    { ...request, questions: [{ id: "__proto__", question: "Question" }] },
    { ...request, questions: [request.questions[0], request.questions[0]] },
  ]) {
    assert.equal(readableExternalQuestion(invalid), false);
    assert.deepEqual(receiveExternalQuestion({}, invalid), {});
  }
});

test("a pending question temporarily reveals chat without changing the terminal preference, then restores it", () => {
  const entries = [{ request }];
  const preferred = "maximized";
  assert.equal(externalQuestionDockMode(preferred, entries, request.sessionId), "docked");
  assert.equal(preferred, "maximized");
  assert.equal(externalQuestionDockMode(preferred, entries, "external:s2"), "maximized");
  for (const outcome of ["answered", "cancelled", "timed_out", "interrupted"]) {
    assert.equal(externalQuestionDockMode(preferred, [{ request, outcome }], request.sessionId), "maximized");
  }
  assert.equal(externalQuestionDockMode(preferred, entries, request.sessionId, Date.parse(request.expiresAt)), "maximized");
  assert.equal(externalQuestionDockMode("docked", [{ request, outcome: "answered" }], request.sessionId), "docked");
});

test("requests deduplicate, resolutions bind both session and turn, and answered questions never revive", () => {
  const state = receiveExternalQuestion({}, request);
  assert.strictEqual(receiveExternalQuestion(state, request), state);
  assert.strictEqual(resolveExternalQuestion(state, { ...request, sessionId: "different", outcome: "answered" }), state);
  assert.strictEqual(resolveExternalQuestion(state, { ...request, turnId: "different", outcome: "answered" }), state);
  const closed = resolveExternalQuestion(state, { ...request, outcome: "answered" });
  assert.equal(closed[request.questionId].outcome, "answered");
  assert.strictEqual(receiveExternalQuestion(closed, request), closed);
  assert.equal(restoreExternalQuestions(closed, [request])[request.questionId].outcome, "answered");
  const early = resolveExternalQuestion({}, { ...request, outcome: "cancelled" });
  assert.strictEqual(receiveExternalQuestion(early, request), early, "resolved-before-request tombstone prevents replay resurrection");
});

test("authoritative snapshots close removed questions, recover current requests, and interrupt only their own turn", () => {
  const next = { ...request, questionId: id(2), sessionId: "external:s2", turnId: "turn2" };
  const state = receiveExternalQuestion(receiveExternalQuestion({}, request), next);
  const interrupted = interruptExternalQuestions(state, [request.sessionId], request.turnId);
  assert.equal(interrupted[request.questionId].outcome, "interrupted");
  assert.equal(interrupted[next.questionId].outcome, undefined);
  const restored = restoreExternalQuestions(state, [next]);
  assert.equal(restored[request.questionId].outcome, "interrupted");
  assert.equal(externalQuestionPending(restored[next.questionId]), true);
  assert.equal(externalQuestionPending({ request: { ...request, expiresAt: "2000-01-01T00:00:00Z" } }), false);
});

test("unknown resolved tombstones are bounded and malformed binding never throws or mutates state", () => {
  let state = {};
  for (let n = 1; n <= 300; n++) state = resolveExternalQuestion(state, { ...request, questionId: id(n), outcome: "answered" });
  assert.equal(Object.keys(state).length, 128);
  for (const malformed of [{ ...request, questionId: "__proto__" }, { ...request, questionId: "constructor" }, { ...request, sessionId: null }, { ...request, turnId: 12 }]) {
    assert.strictEqual(resolveExternalQuestion(state, { ...malformed, outcome: "answered" }), state);
  }
});

test("submission is single-flight and uncertain retries reuse a command; success never submits twice", async () => {
  let ids = 0;
  const submission = createExternalQuestionSubmission(() => id(++ids));
  const calls = [];
  let rejectFirst;
  const first = submission.submit(request, { color: { answers: ["Red"] } }, false, (reply) => {
    calls.push(reply); return new Promise((_, reject) => { rejectFirst = reject; });
  });
  assert.equal(submission.isLocked(), true, "a second UI click returns before changing its sending state");
  assert.equal(await submission.submit(request, {}, true, async (reply) => calls.push(reply)), false);
  rejectFirst(new Error("socket closed before ACK"));
  await assert.rejects(first);
  assert.equal(submission.isLocked(), false);
  const beforeRetry = calls[0];
  await submission.submit(request, { color: { answers: ["Red"] } }, false, async (reply) => calls.push(reply));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].commandId, beforeRetry.commandId);
  assert.equal(submission.isLocked(), true, "an accepted card remains settled even before React rerenders");
  assert.equal(await submission.submit(request, {}, true, async (reply) => calls.push(reply)), false);
  assert.equal(calls.length, 2);
});

test("editing an uncertain answer uses a new command and cancellation sends no fabricated answers", async () => {
  let ids = 0;
  const submission = createExternalQuestionSubmission(() => id(++ids));
  const calls = [];
  await assert.rejects(submission.submit(request, { color: { answers: ["Red"] } }, false, async (reply) => { calls.push(reply); throw Error("offline"); }));
  await submission.submit(request, {}, true, async (reply) => calls.push(reply));
  assert.notEqual(calls[0].commandId, calls[1].commandId);
  assert.equal(calls[1].cancelled, true);
  assert.deepEqual(calls[1].answers, {});
  assert.equal(calls[1].sessionId, request.sessionId);
  assert.equal(calls[1].turnId, request.turnId);
});
