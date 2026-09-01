import test from "node:test";
import assert from "node:assert/strict";
import { resolveAutomationRun } from "../src/automation-run.js";

test("a run's own outcome wins over the job's latest outcome", () => {
  assert.deepEqual(
    resolveAutomationRun(
      { status: "ok", error: "" },
      { lastStatus: "error", lastError: "newer failure" },
      true,
    ),
    { status: "ok", error: undefined },
  );
});

test("the latest legacy run falls back to its job error instead of showing no result", () => {
  assert.deepEqual(
    resolveAutomationRun(
      {},
      { lastStatus: "error", lastError: "agent repeated a failing tool call" },
      true,
    ),
    { status: "error", error: "agent repeated a failing tool call" },
  );
});

test("historical legacy runs never inherit the job's latest failure", () => {
  assert.deepEqual(
    resolveAutomationRun(
      {},
      { lastStatus: "error", lastError: "newer failure" },
      false,
    ),
    { status: undefined, error: undefined },
  );
});
