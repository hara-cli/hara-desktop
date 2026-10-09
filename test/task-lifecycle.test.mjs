import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  taskLifecycleIsNewer,
  terminalTaskLifecycleFallback,
  terminalTaskState,
  terminalTurnIsCurrent,
} from "../src/task-lifecycle.ts";

function task(state = "running", turnId = "turn-current") {
  return {
    version: 1, streamId: "stream-current", sequence: 12,
    sessionId: "session-current", taskId: "task-current", turnId,
    objective: "Upload once, then verify", state, taskStatus: state === "waiting" ? "running" : state,
    phase: "checkpoint", at: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z",
    checkpoint: { done: 1, total: 2, artifacts: ["existing upload receipt"], nextStep: "Verify processing" },
    approval: { id: "approval-current", question: "Continue?" },
  };
}

test("terminal classification preserves explicit pauses without turning errors into success", () => {
  assert.equal(terminalTaskState(undefined, "paused"), "paused");
  assert.equal(terminalTaskState(undefined, "completed"), "completed");
  assert.equal(terminalTaskState(undefined, undefined), "completed", "legacy successful terminal event");
  for (const outcome of ["error", "empty", "halted", "future-failure"]) {
    assert.equal(terminalTaskState(undefined, outcome), "blocked");
  }
  assert.equal(terminalTaskState("provider failure", "paused"), "blocked", "an explicit error wins over paused copy");
  assert.equal(terminalTaskState("interrupted", "error", true), "paused", "human interruption remains a pause");
});

test("missing final task state falls back to paused while preserving receipts and retiring approval", () => {
  for (const state of ["running", "waiting"]) {
    const current = task(state);
    const before = structuredClone(current);
    const next = terminalTaskLifecycleFallback(current, current.turnId,
      terminalTaskState(undefined, "paused"), "2026-10-09T00:01:00.000Z");
    assert.equal(next.state, "paused");
    assert.equal(next.taskStatus, "paused");
    assert.equal(next.phase, "finished");
    assert.deepEqual(next.checkpoint, current.checkpoint);
    assert.equal(next.approval, undefined);
    assert.deepEqual(current, before, "the received typed snapshot is not mutated");
  }
});

test("fallback never overwrites a typed terminal checkpoint or a different turn", () => {
  for (const state of ["paused", "completed", "blocked"]) {
    assert.equal(terminalTaskLifecycleFallback(task(state), "turn-current", "completed", "later"), undefined);
    assert.equal(terminalTaskLifecycleFallback(task(state), "turn-current", "blocked", "later"), undefined);
  }
  assert.equal(terminalTaskLifecycleFallback(task(), "turn-old", "blocked", "later"), undefined);
  assert.equal(terminalTaskLifecycleFallback(task(), undefined, "completed", "later"), undefined);
  assert.equal(terminalTaskLifecycleFallback(undefined, "turn-current", "completed", "later"), undefined);
});

test("old terminal turns are rejected before clearing newer activity, including after typed completion", () => {
  assert.equal(terminalTurnIsCurrent(task(), "turn-old", "turn-current"), false);
  assert.equal(terminalTurnIsCurrent(task("completed"), "turn-old", undefined), false);
  assert.equal(terminalTurnIsCurrent(task(), "turn-current", "turn-current"), true);
  assert.equal(terminalTurnIsCurrent(task("paused"), "turn-current", undefined), true);
  assert.equal(terminalTurnIsCurrent(task("paused", "turn-old"), "turn-current", "turn-current"), true,
    "a new turn_start is authoritative even when its task snapshot was lost");
  assert.equal(terminalTurnIsCurrent(undefined, "turn-current", undefined), true);
  assert.equal(terminalTurnIsCurrent(task(), undefined, undefined), true, "legacy no-turn-ID events remain supported");
});

test("typed lifecycle ordering continues to reject stale and duplicate same-stream snapshots", () => {
  const current = task();
  assert.equal(taskLifecycleIsNewer(current, { ...current, sequence: 11 }), false);
  assert.equal(taskLifecycleIsNewer(current, { ...current, sequence: 12 }), false);
  assert.equal(taskLifecycleIsNewer(current, { ...current, sequence: 13 }), true);
  assert.equal(taskLifecycleIsNewer(current, { ...current, streamId: "stream-restarted", sequence: 1 }), true);
});

test("App gates terminal side effects by turn and derives fallback from the shared pure classifier", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const terminal = app.slice(app.indexOf('case "event.turn_end": {'));
  const guard = terminal.indexOf("if (!terminalTurnIsCurrent(typedTask, e.turnId, activeTurnsRef.current[e.sessionId])) break;");
  assert.ok(guard >= 0);
  for (const mutation of ["taskApprovalRevisionClock.advance", "delete activeTurnsRef.current", "reconcileTerminalReply", "setSessionBusy(e.sessionId, false)"]) {
    assert.ok(guard < terminal.indexOf(mutation), `${mutation} must not run for an old terminal turn`);
  }
  assert.match(terminal, /terminalTaskState\(e\.error, e\.status, interrupted\)/);
  assert.match(terminal, /setTaskStates\(\(current\) => \(\{ \.\.\.current, \[e\.sessionId\]: taskFallback \}\)\)/);
  assert.doesNotMatch(terminal.slice(0, terminal.indexOf("interruptedSessionsRef.current.delete")), /e\.status !== "completed"/);
});
