import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalAgentRoster,
  hiredAgentCount,
  isRootAgent,
  mainAgentRef,
} from "../src/agent-session.ts";

const agent = (ref, options = {}) => ({
  ref,
  name: options.name ?? ref,
  description: `${ref} role`,
  home: "/work/hara",
  scope: ref === "main" ? "main" : "global",
  spaceId: "personal",
  owner: "personal",
  allowedActions: [],
  ...options,
});

test("the main Agent remains one permanent roster entry and is not counted as a hire", () => {
  const fallback = agent("main", { name: "Hara", systemRole: "root_orchestrator" });
  const customized = agent("main", { name: "Kai", systemRole: "root_orchestrator" });
  const designer = agent("global:designer", { name: "Mori" });
  const roster = canonicalAgentRoster([designer, customized, customized], fallback);

  assert.deepEqual(roster.map((item) => item.ref), ["main", "global:designer"]);
  assert.equal(roster[0].name, "Kai", "the Engine identity replaces the renderer fallback");
  assert.equal(hiredAgentCount(roster), 1);
  assert.equal(isRootAgent(roster[0]), true);
  assert.equal(mainAgentRef(), "main");
});

test("a legacy catalog without main still receives the non-hire root coordinator", () => {
  const fallback = agent("main", { name: "Hara", systemRole: "root_orchestrator" });
  const roster = canonicalAgentRoster([agent("global:researcher")], fallback);

  assert.deepEqual(roster.map((item) => item.ref), ["main", "global:researcher"]);
  assert.equal(hiredAgentCount(roster), 1);
});
