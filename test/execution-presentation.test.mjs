import assert from "node:assert/strict";
import test from "node:test";
import {
  countExecutionDetails,
  groupConversationItems,
  isExecutionDetail,
} from "../src/execution-presentation.ts";

test("execution evidence is collapsed without changing conversation order or rewind indexes", () => {
  const items = [
    { kind: "user", text: "run it" },
    { kind: "reasoning", text: "private analysis" },
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
    [0, 1, 2, 3, 4, 5, 6],
    "the projection neither drops nor reorders transcript evidence",
  );
  assert.equal(segments[2].item.kind, "notice", "actionable notices remain in the main transcript");
  assert.deepEqual(countExecutionDetails(segments[1].items), {
    tools: 1,
    changes: 1,
    reasoning: 1,
  });
});

test("only reasoning, tool activity, and diffs are execution details", () => {
  for (const item of [
    { kind: "reasoning", text: "r" },
    { kind: "tool", name: "read_file", preview: "x" },
    { kind: "diff", text: "+x" },
  ]) {
    assert.equal(isExecutionDetail(item), true);
  }
  for (const item of [
    { kind: "user", text: "u" },
    { kind: "text", text: "a" },
    { kind: "notice", text: "n" },
    { kind: "end", usage: { input: 1, output: 2 } },
  ]) {
    assert.equal(isExecutionDetail(item), false);
  }
});
