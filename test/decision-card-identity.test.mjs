import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decisionCardIdentity } from "../src/decision-card-identity.ts";

const request = ["session-1", "task-1", "turn-1", "Which next?", ["Source", "Tests"]];

test("refreshing the same choice keeps its pending-submission identity", () => {
  assert.equal(decisionCardIdentity(...request), decisionCardIdentity(...structuredClone(request)));
});

test("each new session, task, turn, question or option gets independent choice state", () => {
  const before = decisionCardIdentity(...request);
  for (const index of [0, 1, 2, 3, 4]) {
    const changed = structuredClone(request);
    changed[index] = index === 4 ? ["Source", "All files"] : `${changed[index]}-new`;
    assert.notEqual(decisionCardIdentity(...changed), before, `changed field ${index}`);
  }
});

test("choice identities preserve field boundaries and option ordering", () => {
  assert.notEqual(
    decisionCardIdentity("s:t", "u", undefined, "q", ["a", "b"]),
    decisionCardIdentity("s", "t:u", undefined, "q", ["a", "b"]),
  );
  assert.notEqual(decisionCardIdentity(...request), decisionCardIdentity(...request.slice(0, 4), ["Tests", "Source"]));
});

test("the real timeline keys choice state by durable request fields, never progress timestamps", () => {
  const timeline = readFileSync(new URL("../src/ConversationTimeline.tsx", import.meta.url), "utf8");
  const card = timeline.match(/<DecisionCard([\s\S]*?)\n\s*\/>/)?.[1] ?? "";
  assert.match(card, /key=\{decisionCardIdentity\(/);
  assert.match(card, /sessionId,\s*visibleTask\?\.taskId,\s*visibleTask\?\.turnId,\s*dependency\.detail,\s*decisionOptions,/);
  assert.doesNotMatch(card, /updatedAt|sequence|Date\.now|Math\.random/,
    "ordinary snapshots must not unlock an already submitted question");
});
