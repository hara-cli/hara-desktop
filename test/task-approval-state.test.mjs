import assert from "node:assert/strict";
import test from "node:test";
import {
  TASK_APPROVAL_MAX_DURATION, TASK_APPROVAL_STATE_LIMIT,
  approvalDockMode, approvalRequestExpired, createTaskApprovalSubmission, createTaskApprovalRevisionClock,
  inactiveTaskApprovalState, normalizeTaskApprovalState, offeredTaskApproval,
  projectTaskApprovalReceipt, projectTaskApprovalState, restoreTaskApprovalStates,
  taskApprovalActive, taskApprovalEstimatedExpired, taskApprovalStateForSession,
  terminalTaskApprovalState, validTaskApprovalState,
} from "../src/task-approval-state.ts";
import { restoreSessionApprovals } from "../src/approval-restoration.ts";

const now = Date.parse("2026-10-08T01:00:00Z");
const deadline = "2026-10-08T01:05:00Z";
const offer = {
  approvalId: "a1", question: "Check project files?", allowAlways: false, allowForTask: true,
  expiresAt: deadline, taskApproval: { summary: "Review this project", toolFamily: "bash", durationMs: TASK_APPROVAL_MAX_DURATION },
};
const active = { active: true, toolFamilies: ["bash"], expiresAt: "2026-10-08T01:15:00Z", canRevoke: true };

test("task choice requires a complete eligible offer and negotiated contract; legacy/creation never enable it", () => {
  assert.equal(offeredTaskApproval(offer, true, now), true);
  for (const changes of [
    { allowForTask: false }, { allowForTask: undefined }, { expiresAt: undefined }, { expiresAt: "invalid" },
    { expiresAt: "2026-10-08T01:00:00Z" }, { taskApproval: undefined },
    { taskApproval: { ...offer.taskApproval, toolFamily: "computer" } },
    { taskApproval: { ...offer.taskApproval, durationMs: TASK_APPROVAL_MAX_DURATION + 1 } },
    { taskApproval: { ...offer.taskApproval, durationMs: 0 } },
    { taskApproval: { ...offer.taskApproval, summary: "" } },
    { taskApproval: { ...offer.taskApproval, summary: "x".repeat(4001) } },
    { presentation: { kind: "agent-create", instructions: "Never share permissions" } },
  ]) assert.equal(offeredTaskApproval({ ...offer, ...changes }, true, now), false, JSON.stringify(changes));
  assert.equal(offeredTaskApproval(offer, false, now), false);
  assert.equal(approvalRequestExpired(undefined, now), false, "old ordinary allow remains usable without new metadata");
  assert.equal(approvalRequestExpired(deadline, Date.parse(deadline)), true);
  assert.equal(approvalRequestExpired("invalid", now), true);
});

test("server-confirmed state stays scoped and revocable despite client clock jumps; metadata is not a grant writer", () => {
  const states = restoreTaskApprovalStates([{ sessionId: "s1", ...active }]);
  assert.deepEqual(taskApprovalStateForSession(states, "s1", true), active);
  assert.equal(taskApprovalStateForSession(states, "s2", true), undefined);
  assert.equal(taskApprovalStateForSession(states, "s1", false), undefined);
  assert.equal(taskApprovalActive(active), true);
  assert.equal(taskApprovalEstimatedExpired(active, now), false);
  assert.equal(taskApprovalEstimatedExpired(active, Date.parse("2099-01-01T00:00:00Z")), true);
  assert.equal(taskApprovalStateForSession(states, "s1", true).canRevoke, true);
  assert.deepEqual(normalizeTaskApprovalState({ ...active, toolFamilies: ["computer"] }), inactiveTaskApprovalState());
  assert.equal(validTaskApprovalState({ ...active, toolFamilies: ["bash", "bash"] }), false);
  assert.equal(validTaskApprovalState({ ...active, expiresAt: "invalid" }), false);
  assert.deepEqual(restoreTaskApprovalStates(undefined), {});
  assert.deepEqual(restoreTaskApprovalStates([]), {});
  assert.deepEqual(restoreTaskApprovalStates([null, false, {sessionId: "__proto__", ...active}, {sessionId: "constructor", ...active}]), {});
});

test("state events are deduplicated, terminal lifecycle clears only its session, maps remain bounded", () => {
  const s1 = projectTaskApprovalState({}, "s1", active);
  assert.equal(projectTaskApprovalState(s1, "s1", active), s1);
  const both = projectTaskApprovalState(s1, "s2", { ...active, toolFamilies: ["python"] });
  const finished = terminalTaskApprovalState(both, "s1");
  assert.equal(taskApprovalStateForSession(finished, "s1", true), undefined);
  assert.equal(taskApprovalStateForSession(finished, "s2", true).toolFamilies[0], "python");
  assert.equal(projectTaskApprovalState(finished, "constructor", active), finished);
  let bounded = {};
  for (let i = 0; i < TASK_APPROVAL_STATE_LIMIT + 50; i++) bounded = projectTaskApprovalState(bounded, `s${i}`, active);
  assert.equal(Object.keys(bounded).length, TASK_APPROVAL_STATE_LIMIT);
  for (let i = 0; i < 500; i++) bounded = projectTaskApprovalState(bounded, `closed${i}`, inactiveTaskApprovalState());
  assert.equal(Object.keys(bounded).length, TASK_APPROVAL_STATE_LIMIT, "inactive history cannot accumulate");
  assert.equal(Object.keys(restoreTaskApprovalStates(Array.from({length:500}, (_, i) => ({sessionId:`s${i}`, ...active})))).length, TASK_APPROVAL_STATE_LIMIT);
});

test("late approval ACK cannot reactivate a grant after a newer terminal or revoke event", () => {
  const states = projectTaskApprovalState({}, "s1", active);
  const terminal = terminalTaskApprovalState(states, "s1");
  assert.equal(projectTaskApprovalReceipt(terminal, "s1", active, 1, 2), terminal);
  assert.equal(projectTaskApprovalReceipt(states, "s1", undefined, 1, 1), states, "malformed/missing ACK metadata does not erase confirmed state");
  assert.deepEqual(projectTaskApprovalReceipt({}, "s1", active, 2, 2), { s1: active });
  assert.deepEqual(projectTaskApprovalReceipt(states, "s1", inactiveTaskApprovalState(), 2, 2), {});
});

test("receipt epochs isolate sessions, reject newer terminal events and fail closed after bounded eviction or engine change", () => {
  const clock = createTaskApprovalRevisionClock();
  const submitted = clock.capture("s1");
  clock.advance("s2");
  assert.equal(clock.current("s1"), submitted, "another Agent's event cannot hide this session's actual receipt");
  clock.advance("s1");
  assert.notEqual(clock.current("s1"), submitted);
  const newSubmission = clock.capture("s1");
  clock.advance();
  assert.notEqual(clock.current("s1"), newSubmission, "engine/snapshot reset invalidates earlier ACKs");
  const beforeEviction = clock.capture("s1");
  for (let i = 0; i < TASK_APPROVAL_STATE_LIMIT + 10; i++) clock.advance(`other${i}`);
  assert.notEqual(clock.current("s1"), beforeEviction, "bounded eviction cannot make a stale receipt current again");
});

test("duplicate task submits share one ID; uncertain failure blocks changed verdict but keeps exact retry", async () => {
  let idCount = 0, unlock;
  const ids = [];
  const submission = createTaskApprovalSubmission(() => `intent-${++idCount}`);
  assert.equal(submission.canChoose("deny"), true);
  const first = submission.submit((id) => { ids.push(id); return new Promise((resolve) => { unlock = resolve; }); });
  assert.equal(await submission.submit(async () => { throw new Error("duplicate delivery"); }), false);
  assert.equal(submission.canChoose("allow"), false);
  assert.equal(submission.canChoose("deny"), false);
  assert.equal(submission.canChoose("always"), false);
  unlock(); await first;
  assert.equal(await submission.submit(async () => {}), false);
  assert.equal(idCount, 1);
  const retry = createTaskApprovalSubmission(() => `intent-${++idCount}`);
  await assert.rejects(retry.submit(async (id) => { ids.push(id); throw new Error("ACK lost or CONFLICT"); }), /ACK lost/);
  assert.equal(retry.isLocked(), false);
  assert.equal(retry.canChoose("deny"), false, "cannot mislabel an uncertain granted request as denied");
  assert.equal(retry.canChoose("task"), true);
  await retry.submit(async (id) => { ids.push(id); });
  assert.equal(ids.at(-1), ids.at(-2));
  assert.equal(idCount, 2);
});

test("foreground recovery preserves uncertain intent and exact expiry, but never revives answered or crosses sessions", async () => {
  const previous = { kind: "approval", ...offer, taskApprovalCommandId: "same-intent" };
  const restored = restoreSessionApprovals([], "s1", undefined, [offer], { sessionId: "s1", items: [previous] }).at(-1);
  assert.equal(restored.taskApprovalCommandId, "same-intent");
  assert.equal(restored.expiresAt, deadline);
  const retry = createTaskApprovalSubmission(() => { throw new Error("must reuse restored ID"); }, restored.taskApprovalCommandId);
  assert.equal(retry.canChoose("allow"), false);
  await retry.submit(async (id) => { assert.equal(id, "same-intent"); });
  const answered = { ...previous, answered: "task" };
  assert.deepEqual(restoreSessionApprovals([], "s1", undefined, [offer], { sessionId: "s1", items: [answered] }), [answered]);
  const another = restoreSessionApprovals([], "s2", undefined, [offer], { sessionId: "s1", items: [previous] }).at(-1);
  assert.equal(another.taskApprovalCommandId, undefined);
});

test("pending permission briefly reveals chat from terminal-only without mutating user preferences", () => {
  const preferred = "maximized";
  const pending = [{ kind: "approval", ...offer }];
  assert.equal(approvalDockMode(preferred, pending, now), "docked");
  assert.equal(preferred, "maximized");
  assert.equal(approvalDockMode(preferred, [{ ...pending[0], answered: "task" }], now), preferred);
  assert.equal(approvalDockMode(preferred, pending, Date.parse(deadline)), preferred);
  assert.equal(approvalDockMode(preferred, [], now), preferred, "changing session leaves no temporary split");
  assert.equal(approvalDockMode("docked", pending, now), "docked");
});
