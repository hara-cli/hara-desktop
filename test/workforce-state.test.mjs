import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  WORKFORCE_ACTOR_LIMIT,
  boundedWorkforceState,
  workforceFromTask,
  workforceStateIsNewer,
} from "../src/workforce-state.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

const event = (sequence, overrides = {}) => ({
  version: 1,
  streamId: "stream-a",
  sequence,
  sessionId: "session-a",
  taskId: "task-a",
  turnId: "turn-a",
  mode: "snapshot",
  actors: [],
  ...overrides,
});

test("workforce reducer rejects stale and malformed snapshots", () => {
  assert.equal(workforceStateIsNewer(event(2), event(1)), false);
  assert.equal(workforceStateIsNewer(event(2), event(3)), true);
  assert.equal(workforceStateIsNewer(event(9), event(1, { streamId: "stream-b" })), true);
  assert.equal(workforceStateIsNewer(undefined, event(0)), false);
});

test("older engines project only the authoritative root task", () => {
  const snapshot = workforceFromTask("session-a", {
    version: 1,
    sessionId: "session-a",
    taskId: "task-a",
    turnId: "turn-a",
    objective: "private objective",
    state: "waiting",
    taskStatus: "running",
    phase: "approval",
    at: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    checkpoint: { done: 0, total: 0 },
  });
  assert.equal(snapshot.actors.length, 1);
  assert.equal(snapshot.actors[0].state, "waiting");
  assert.equal(snapshot.actors[0].activity, "awaiting_approval");
  assert.doesNotMatch(JSON.stringify(snapshot), /private objective/);
});

test("renderer bounds actor count and strips unsafe role text", () => {
  const snapshot = boundedWorkforceState(event(1, {
    actors: Array.from({ length: WORKFORCE_ACTOR_LIMIT + 4 }, (_, index) => ({
      actorId: `agent-${index}`,
      kind: index ? "subagent" : "root",
      role: index === 1 ? "unsafe role" : "research",
      capability: "research",
      state: "working",
      activity: "running",
      startedAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
    })),
  }));
  assert.equal(snapshot.actors.length, WORKFORCE_ACTOR_LIMIT);
  assert.equal(snapshot.actors[1].role, undefined);
});

test("renderer drops actors with invalid wire enums or timestamps", () => {
  const valid = {
    actorId: "agent-valid",
    kind: "subagent",
    role: "ui-design",
    capability: "design",
    state: "working",
    activity: "running",
    startedAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:01.000Z",
  };
  const snapshot = boundedWorkforceState(event(1, {
    actors: [
      valid,
      { ...valid, actorId: "bad-state", state: "teleporting" },
      { ...valid, actorId: "bad-capability", capability: "credentials" },
      { ...valid, actorId: "bad-time", updatedAt: "not-a-date" },
    ],
    untrusted: "must not survive",
  }));
  assert.deepEqual(snapshot.actors.map((actor) => actor.actorId), ["agent-valid"]);
  assert.equal("untrusted" in snapshot, false);
});

test("Agent Office uses one Hara identity with capability tools and zoned workstations", () => {
  const surface = readFileSync(`${root}/src/WorkforceSurface.tsx`, "utf8");
  const css = readFileSync(`${root}/src/WorkforceSurface.css`, "utf8");
  assert.match(surface, /BUILTIN_HARA_PET\.imageUrl/);
  assert.doesNotMatch(surface, /OFFICIAL_HARA_PETS|petForActor/);
  assert.match(surface, /CAPABILITY_VISUALS/);
  assert.match(surface, /seat\.zone === desiredZone/);
  assert.match(surface, /workforce-role-tool/);
  for (const capability of ["code", "browser", "research", "design", "files", "office", "communication"]) {
    assert.match(css, new RegExp(`is-capability-${capability} \\.workforce-role-tool`));
  }
});
