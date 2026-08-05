import assert from "node:assert/strict";
import test from "node:test";

import {
  executionViewExpandsLog,
  executionViewShowsLog,
  executionViewShowsUsage,
  parseExecutionViewMode,
} from "../src/execution-view.ts";

test("execution display preferences fail back to the quiet default", () => {
  assert.equal(parseExecutionViewMode(null), "concise");
  assert.equal(parseExecutionViewMode(""), "concise");
  assert.equal(parseExecutionViewMode("verbose"), "concise");
  assert.equal(parseExecutionViewMode("standard"), "standard");
  assert.equal(parseExecutionViewMode("debug"), "debug");
});

test("concise, standard, and debug expose progressively more local evidence", () => {
  assert.deepEqual(
    ["concise", "standard", "debug"].map((mode) => ({
      mode,
      log: executionViewShowsLog(mode),
      expanded: executionViewExpandsLog(mode),
      usage: executionViewShowsUsage(mode),
    })),
    [
      { mode: "concise", log: false, expanded: false, usage: false },
      { mode: "standard", log: true, expanded: false, usage: false },
      { mode: "debug", log: true, expanded: true, usage: true },
    ],
  );
});
