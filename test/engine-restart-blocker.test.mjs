import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { collectEngineBlockingTasks } from "../src/engine-restart-blocker.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const labels = {
  personalSpace: "Personal",
  conversation: "Conversation",
  project: "Project",
  automation: "Automation",
  unknownTask: "Unknown task",
  running: "Running",
  waiting: "Needs input",
  stopping: "Stopping",
};

test("engine restart blockers retain the session identity, location, and actionable state", () => {
  const tasks = collectEngineBlockingTasks(
    { project: true, chat: true, done: false },
    [
      {
        id: "project",
        title: "Ship the mobile pairing flow",
        cwd: "/work/hara-mobile",
        model: "qwen",
        spaceId: "personal",
        updatedAt: "2026-09-11T08:00:00.000Z",
        source: "interactive",
      },
      {
        id: "chat",
        title: "Review launch copy",
        cwd: "/Users/me/.hara/workspace",
        model: "qwen",
        spaceId: "org:nanhara",
        updatedAt: "2026-09-11T08:05:00.000Z",
        source: "interactive",
      },
    ],
    {
      chat: {
        version: 1,
        sessionId: "chat",
        taskId: "task-chat",
        turnId: "turn-chat",
        objective: "Review launch copy",
        state: "waiting",
        taskStatus: "running",
        phase: "approval",
        at: "2026-09-11T08:05:00.000Z",
        updatedAt: "2026-09-11T08:05:00.000Z",
        checkpoint: { done: 1, total: 2 },
      },
    },
    {
      activeId: "personal",
      activeProfileId: "personal",
      activeSource: "default",
      switchLocked: false,
      spaces: [
        {
          id: "personal",
          name: "Personal",
          kind: "personal",
          profileId: "personal",
          active: true,
          authoritative: true,
          agentProfilePermission: "edit",
        },
        {
          id: "org:nanhara",
          name: "Nanhara",
          kind: "organization",
          profileId: "company",
          active: false,
          authoritative: true,
          agentProfilePermission: "view",
        },
      ],
    },
    labels,
    "project",
  );

  assert.deepEqual(tasks.map((task) => task.sessionId), ["project", "chat"]);
  assert.equal(tasks[0].title, "Ship the mobile pairing flow");
  assert.equal(tasks[0].context, "Personal · Project · hara-mobile");
  assert.equal(tasks[1].statusLabel, "Needs input");
  assert.equal(tasks[1].context, "Nanhara · Conversation");
});

test("a reconnect gap still exposes an identifiable blocker that can be stopped", () => {
  const [task] = collectEngineBlockingTasks(
    { "session-123456789": true },
    [],
    {
      "session-123456789": {
        version: 1,
        sessionId: "session-123456789",
        taskId: "task",
        turnId: "turn",
        objective: "  Continue   the restored task  ",
        state: "running",
        taskStatus: "running",
        phase: "restored",
        at: "2026-09-11T08:00:00.000Z",
        updatedAt: "2026-09-11T08:00:00.000Z",
        checkpoint: { done: 0, total: 1 },
      },
    },
    null,
    labels,
  );

  assert.equal(task.title, "Continue the restored task");
  assert.equal(task.context, "Unknown task");
  assert.equal(task.statusLabel, "Running");
});

test("the restart interlock presents view and stop controls instead of a dead-end error", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const blocker = readFileSync(`${root}/src/EngineRestartBlocker.tsx`, "utf8");

  assert.match(app, /collectEngineBlockingTasks\(/);
  assert.match(app, /setEngineRestartInterlockOpen\(true\)/);
  assert.match(app, /onViewTask=/);
  assert.match(app, /onStopTask=/);
  assert.doesNotMatch(app, /disabled=\{engineRestarting \|\| Object\.values\(busy\)\.some\(Boolean\)\}/);
  assert.match(blocker, /copy\.viewTask/);
  assert.match(blocker, /copy\.stopTask/);
});
