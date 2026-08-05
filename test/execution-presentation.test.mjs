import assert from "node:assert/strict";
import test from "node:test";
import {
  countExecutionDetails,
  executionToolNames,
  groupConversationItems,
  isExecutionDetail,
} from "../src/execution-presentation.ts";

test("execution evidence is collapsed without changing conversation order or rewind indexes", () => {
  const items = [
    { kind: "user", text: "run it" },
    { kind: "tool", name: "task_intake", preview: "internal checkpoint" },
    { kind: "diff", text: "+ change" },
    { kind: "notice", text: "approval is needed" },
    { kind: "tool", name: "exec", preview: "npm test" },
    { kind: "text", text: "Done." },
  ];

  const segments = groupConversationItems(items);

  assert.deepEqual(
    segments.map((segment) => segment.kind),
    ["item", "execution", "item", "execution", "item"],
  );
  assert.deepEqual(
    segments.flatMap((segment) =>
      segment.kind === "execution"
        ? segment.items.map((entry) => entry.index)
        : [segment.index],
    ),
    [0, 1, 2, 3, 4, 5],
    "the projection neither drops nor reorders transcript evidence",
  );
  assert.equal(segments[2].item.kind, "notice", "actionable notices remain in the main transcript");
  assert.deepEqual(countExecutionDetails(segments[1].items), {
    tools: 1,
    changes: 1,
  });
  assert.deepEqual(executionToolNames(segments[1].items), ["task_intake"]);
});

test("standard summaries list a bounded set of distinct tool names", () => {
  const segment = groupConversationItems([
    { kind: "tool", name: "read_file", preview: "one" },
    { kind: "tool", name: "read_file", preview: "two" },
    { kind: "tool", name: "edit_file", preview: "three" },
    { kind: "tool", name: "bash", preview: "four" },
    { kind: "tool", name: "python", preview: "five" },
  ])[0];
  assert.equal(segment.kind, "execution");
  assert.deepEqual(executionToolNames(segment.items), ["read_file", "edit_file", "bash"]);
  assert.deepEqual(executionToolNames(segment.items, 1), ["read_file"]);
  assert.deepEqual(executionToolNames(segment.items, 0), []);
});

test("only user-visible tool activity and diffs are execution details", () => {
  for (const item of [
    { kind: "tool", name: "read_file", preview: "x" },
    { kind: "diff", text: "+x" },
  ]) {
    assert.equal(isExecutionDetail(item), true);
  }
  for (const item of [
    { kind: "reasoning", text: "private provider state" },
    { kind: "user", text: "u" },
    { kind: "text", text: "a" },
    { kind: "notice", text: "n" },
    { kind: "end", usage: { input: 1, output: 2 } },
  ]) {
    assert.equal(isExecutionDetail(item), false);
  }
});
