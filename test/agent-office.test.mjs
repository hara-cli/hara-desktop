import test from "node:test";
import assert from "node:assert/strict";
import {
  agentCapability,
  latestAgentSession,
  officeActors,
} from "../src/agent-office.ts";

const agents = [
  { ref: "main", name: "Hara", description: "Main Hara Agent", identity: { version: 1, displayName: "Hara", source: "hara" }, home: "/work/a", scope: "main" },
  { ref: "alpha:coder", name: "coder", description: "Builds and reviews code", identity: { version: 1, displayName: "Linus", title: "Chief Engineer", source: "openclaw" }, home: "/work/a", scope: "project", project: "alpha" },
  { ref: "alpha:designer", name: "designer", description: "Product visual design", identity: { version: 1, displayName: "Jony", title: "Chief Design Officer", source: "openclaw" }, home: "/work/a", scope: "project", project: "alpha" },
];

const office = {
  id: "project:alpha",
  name: "alpha",
  cwd: "/work/a",
  kind: "project",
  project: "alpha",
  agentRefs: agents.map((agent) => agent.ref),
};

test("Agent session selection never reuses another persona's history", () => {
  const sessions = [
    { id: "main", title: "", cwd: "/work/a", model: "m", updatedAt: "2026-08-22T01:00:00Z" },
    { id: "coder-old", title: "", cwd: "/work/a", model: "m", agentRef: "alpha:coder", updatedAt: "2026-08-22T02:00:00Z" },
    { id: "coder-new", title: "", cwd: "/work/a", model: "m", agentRef: "alpha:coder", updatedAt: "2026-08-22T03:00:00Z" },
    { id: "other-home", title: "", cwd: "/work/b", model: "m", agentRef: "alpha:coder", updatedAt: "2026-08-22T04:00:00Z" },
  ];
  assert.equal(latestAgentSession(sessions, "/work/a", "main")?.id, "main");
  assert.equal(latestAgentSession(sessions, "/work/a", "alpha:coder")?.id, "coder-new");
  assert.equal(latestAgentSession(sessions, "/work/a", "alpha:designer"), undefined);
});

test("office residents stay idle until a real lifecycle actor updates the selected Agent", () => {
  const idle = officeActors({ office, agents, sessionCwd: "/work/a", sessionAgentRef: "alpha:coder" });
  assert.equal(idle.length, 3);
  assert.ok(idle.every((actor) => actor.state === "idle" && actor.resident));
  assert.equal(agentCapability(agents[1]), "code");
  assert.equal(agentCapability(agents[2]), "design");

  const snapshot = {
    version: 1,
    streamId: "workforce",
    sequence: 1,
    sessionId: "coder-new",
    taskId: "task",
    turnId: "turn",
    mode: "snapshot",
    actors: [
      {
        actorId: "root:coder-new",
        kind: "root",
        role: "orchestrator",
        capability: "orchestration",
        state: "working",
        activity: "running",
        startedAt: "2026-08-22T03:00:00Z",
        updatedAt: "2026-08-22T03:00:01Z",
      },
      {
        actorId: "subagent:1",
        kind: "subagent",
        role: "research",
        capability: "research",
        state: "queued",
        activity: "planning",
        startedAt: "2026-08-22T03:00:01Z",
        updatedAt: "2026-08-22T03:00:01Z",
      },
    ],
  };
  const live = officeActors({
    office,
    agents,
    sessionCwd: "/work/a",
    sessionAgentRef: "alpha:coder",
    snapshot,
  });
  const coder = live.find((actor) => actor.agentRef === "alpha:coder");
  assert.equal(coder?.state, "working");
  assert.equal(coder?.role, "coder");
  assert.equal(coder?.identity?.displayName, "Linus");
  assert.equal(live.find((actor) => actor.agentRef === "alpha:designer")?.state, "idle");
  assert.equal(live.find((actor) => actor.agentRef === "alpha:designer")?.identity?.displayName, "Jony");
  assert.ok(live.some((actor) => actor.actorId === "subagent:1" && !actor.agentRef));

  const anotherOffice = officeActors({
    office: { ...office, id: "project:beta", cwd: "/work/b" },
    agents,
    sessionCwd: "/work/a",
    sessionAgentRef: "alpha:coder",
    snapshot,
  });
  assert.ok(anotherOffice.every((actor) => actor.state === "idle"));
});

test("a full office keeps real collaborators visible by yielding resident seats", () => {
  const manyAgents = Array.from({ length: 30 }, (_, index) => ({
    ref: index === 0 ? "main" : `global:agent-${index}`,
    name: index === 0 ? "Hara" : `agent-${index}`,
    description: "General teammate",
    home: "/work/a",
    scope: index === 0 ? "main" : "global",
  }));
  const crowdedOffice = { ...office, agentRefs: manyAgents.map((agent) => agent.ref) };
  const idle = officeActors({ office: crowdedOffice, agents: manyAgents });
  assert.equal(idle.length, 24);

  const snapshot = {
    version: 1,
    streamId: "workforce",
    sequence: 2,
    sessionId: "main",
    taskId: "task",
    turnId: "turn",
    mode: "snapshot",
    actors: [
      {
        actorId: "root:main",
        kind: "root",
        role: "orchestrator",
        capability: "orchestration",
        state: "working",
        activity: "running",
        startedAt: "2026-08-22T03:00:00Z",
        updatedAt: "2026-08-22T03:00:01Z",
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        actorId: `subagent:${index}`,
        kind: "subagent",
        role: "research",
        capability: "research",
        state: "working",
        activity: "running",
        startedAt: "2026-08-22T03:00:00Z",
        updatedAt: "2026-08-22T03:00:01Z",
      })),
    ],
  };
  const live = officeActors({
    office: crowdedOffice,
    agents: manyAgents,
    snapshot,
    sessionCwd: "/work/a",
    sessionAgentRef: undefined,
  });
  assert.equal(live.length, 24);
  assert.equal(live.filter((actor) => actor.kind === "subagent").length, 4);
  assert.equal(live[0].kind, "root");
  assert.equal(live[0].state, "working");
});
